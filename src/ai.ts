import { AIMessage, AISettings, Chapter } from './types';
import * as FileSystem from 'expo-file-system/legacy';

export type AIIntent = 'explain' | 'thread' | 'simple' | 'question';

type AIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail: 'auto' } };

const intentText: Record<AIIntent, string> = {
  explain: '解释这段话真正表达的意思、关键概念和隐含逻辑。',
  thread: '结合前后文，说明这段话在本章论证中起什么作用。',
  simple: '用更直白的中文改写，并给一个贴切的小例子。',
  question: '回答读者的问题；如果原文不足以支持结论，要明确说明。',
};

function imageMime(uri: string) {
  const extension = uri.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'svg') return 'image/svg+xml';
  return 'image/png';
}

async function resolveImageBlock(text: string) {
  const inline = text.match(/^\[\[MOWEN_IMAGE_DATA:(data:image\/[\s\S]+)\]\]$/)?.[1];
  if (inline) return inline;
  const uri = text.match(/^\[\[MOWEN_IMAGE_FILE:([\s\S]+)\]\]$/)?.[1].split('|')[0];
  if (!uri) return undefined;
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    return `data:${imageMime(uri)};base64,${base64}`;
  } catch {
    return undefined;
  }
}

function extractDeltaContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((part) => {
    if (!part || typeof part !== 'object') return '';
    const text = (part as { text?: unknown }).text;
    return typeof text === 'string' ? text : '';
  }).join('');
}

function createSseParser(onDelta?: (delta: string) => void) {
  let buffer = '';
  let content = '';
  const consumeLine = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    try {
      const chunk = JSON.parse(data) as { choices?: Array<{ delta?: { content?: unknown } }> };
      const delta = extractDeltaContent(chunk.choices?.[0]?.delta?.content);
      if (delta) { content += delta; onDelta?.(delta); }
    } catch { }
  };
  return {
    feed(chunk: string) {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      lines.forEach(consumeLine);
    },
    finish() {
      consumeLine(buffer);
      return content.trim();
    },
  };
}

function parseCustomRequestParams(value: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (!trimmed) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('自定义请求参数不是有效的 JSON，请输入一个 JSON 对象。');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('自定义请求参数必须是 JSON 对象，例如 {"reasoning_effort":"medium"}。');
  }
  return parsed as Record<string, unknown>;
}

function requestWithXhr(url: string, apiKey: string, requestBody: Record<string, unknown>, signal: AbortSignal | undefined, onDelta?: (delta: string) => void): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const parser = createSseParser(onDelta);
    let processedLength = 0;
    let settled = false;
    const abortError = () => {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      return error;
    };
    const cleanup = () => signal?.removeEventListener('abort', handleAbort);
    const handleAbort = () => { xhr.abort(); if (!settled) { settled = true; cleanup(); reject(abortError()); } };
    const fail = (error: Error) => { if (!settled) { settled = true; cleanup(); reject(error); } };
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', `Bearer ${apiKey}`);
    xhr.onprogress = () => {
      const next = xhr.responseText.slice(processedLength);
      processedLength = xhr.responseText.length;
      if (next) parser.feed(next);
    };
    xhr.onerror = () => fail(new Error('模型接口网络请求失败'));
    xhr.onabort = () => { if (!settled) fail(abortError()); };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        fail(new Error(`模型接口返回 ${xhr.status}`));
        return;
      }
      const rest = xhr.responseText.slice(processedLength);
      if (rest) parser.feed(rest);
      const streamed = parser.finish();
      if (streamed) {
        settled = true; cleanup(); resolve(streamed); return;
      }
      try {
        const data = JSON.parse(xhr.responseText) as { choices?: Array<{ message?: { content?: unknown } }> };
        const content = extractDeltaContent(data.choices?.[0]?.message?.content).trim();
        if (!content) throw new Error('模型没有返回可显示的内容');
        settled = true; cleanup(); resolve(content);
      } catch (error) { fail(error instanceof Error ? error : new Error('模型返回内容无法解析')); }
    };
    signal?.addEventListener('abort', handleAbort, { once: true });
    xhr.send(JSON.stringify(requestBody));
  });
}

export async function askAI(options: {
  settings: AISettings;
  bookTitle: string;
  bookAuthor: string;
  bookDescription?: string;
  chapter: Chapter;
  paragraphIndex: number;
  selectedText?: string;
  intent: AIIntent;
  question?: string;
  contextRadius?: number;
  additionalImages?: string[];
  history?: AIMessage[];
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
}): Promise<string> {
  const { settings, bookTitle, bookAuthor, bookDescription, chapter, paragraphIndex, intent, question, signal, onDelta } = options;
  const radius = Math.max(1, Math.min(20, options.contextRadius ?? 5));
  const start = Math.max(0, paragraphIndex - radius);
  const end = Math.min(chapter.paragraphs.length, paragraphIndex + radius + 1);
  const contextImages: string[] = [];
  const contextParts: string[] = [];
  const contextParagraphs = chapter.paragraphs.slice(start, end);
  for (let i = 0; i < contextParagraphs.length; i++) {
    const text = contextParagraphs[i];
    const current = start + i === paragraphIndex;
    const image = await resolveImageBlock(text);
    if (image && image.length <= 6_000_000) contextImages.push(image);
    const safeText = current && options.selectedText?.trim()
      ? options.selectedText.trim()
      : image
      ? `【此处有一幅插图${image.length > 6_000_000 ? '，因文件过大未上传' : '，见随附图片'}】`
      : text.replace(/\[\[MOWEN_NOTE_REF:[^\]]+\]\]/g, '〔脚注〕');
    contextParts.push(`${current ? '【当前段】' : '【上下文】'}${safeText}`);
  }
  const context = contextParts.join('\n\n');
  // Keep every distinct image in the selected context. The model/API remains
  // responsible for enforcing its own request-size limit if one exists.
  const allImages = [...(options.additionalImages ?? []), ...contextImages]
    .filter((value, index, values) => value.startsWith('data:image/') && values.indexOf(value) === index);
  const bookInfo = bookDescription
    ? `《${bookTitle}》，作者：${bookAuthor}。书籍简介：${bookDescription}`
    : `《${bookTitle}》，作者：${bookAuthor}。当前没有可用的 EPUB 书籍简介，请勿自行杜撰。`;
  const prompt = `书籍信息：${bookInfo}\n当前章节：${chapter.title}\n上下文范围：当前位置前后各 ${radius} 个内容块\n\n${context}\n\n任务：${intentText[intent]}${question ? `\n读者的问题：${question}` : ''}${allImages.length ? `\n随附 ${allImages.length} 张图片，请结合图片中的图表、文字或视觉关系回答。` : ''}`;
  const userContent: string | AIContentPart[] = allImages.length
    ? [
        { type: 'text', text: prompt },
        ...allImages.map((url): AIContentPart => ({ type: 'image_url', image_url: { url, detail: 'auto' } })),
      ]
    : prompt;
  const baseUrl = settings.baseUrl.replace(/\/$/, '');
  const customRequestParams = parseCustomRequestParams(typeof settings.customRequestParams === 'string' ? settings.customRequestParams : '');
  const systemPrompt = [
    '你是墨问里的通用阅读与问答助手。优先利用提供的书籍上下文，但这不是回答边界。',
    '如果问题涉及书外知识、最新数据、事实核查、计算、图片或图表，请直接尽力回答，不要因为信息不在书中就拒答。',
    '清楚区分“原文说了什么”和“基于一般知识的补充”；对可能随时间变化的事实说明时效性，无法验证时诚实说明，不要编造。',
    '不要展示内部思考过程。除非用户要求，先给结论，再给必要说明，使用简洁的 Markdown。',
  ].join('\n');
  const requestBody: Record<string, unknown> = {
    ...customRequestParams,
    model: settings.model,
    temperature: customRequestParams.temperature ?? 0.35,
    stream: true,
    messages: [
      { role: 'system', content: systemPrompt },
      ...(options.history ?? []),
      { role: 'user', content: userContent },
    ],
  };
  return requestWithXhr(`${baseUrl}/chat/completions`, settings.apiKey, requestBody, signal, onDelta);
}
