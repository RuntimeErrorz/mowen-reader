import { AIMessage, AISettings, Chapter } from './types';
import * as FileSystem from 'expo-file-system/legacy';
import { expandNoteReferences, expandSelectedTextWithNotes } from './aiContext';

type AIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail: 'auto' } };

export type AIResponse = {
  content: string;
  thinking?: string;
};

type AITextFields = {
  content?: unknown;
  reasoning_content?: unknown;
  reasoning?: unknown;
};

type AIStreamChunk = {
  choices?: Array<{
    delta?: AITextFields;
    message?: AITextFields;
  }>;
};

const questionTask = '顺着读者的问题直接作答；以当前上下文作为切入点，也可以自然补充相关背景、概念、例子和延伸信息。只有答案确实存在不确定性或需要额外条件时，才简短说明。';

const CONVERSATION_TITLE_MAX_LENGTH = 28;

export function normalizeConversationTitle(value: string): string {
  const withoutThinking = value
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:[a-z-]+)?/gi, '')
    .replace(/```/g, '');
  const firstLine = withoutThinking.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
  const title = firstLine
    .replace(/^(?:标题|title)\s*[:：]\s*/i, '')
    .replace(/^[`"'“‘]+|[`"'”’]+$/g, '')
    .replace(/^[#*_\s]+|[#*_\s]+$/g, '')
    .replace(/[。！？!?；;：:]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(title).slice(0, CONVERSATION_TITLE_MAX_LENGTH).join('').trim();
}

function isImageMarker(text: string) {
  return /^\[\[MOWEN_IMAGE_(?:DATA|FILE|EPUB):[\s\S]+\]\]$/.test(text);
}

export function buildAIRequestText(options: {
  bookTitle: string;
  bookAuthor: string;
  bookDescription?: string;
  chapter: Chapter;
  paragraphIndex: number;
  selectedText?: string;
  selectedImage?: string;
  question?: string;
  contextRadius?: number;
  imageCount?: number;
}) {
  const radius = Math.max(1, Math.min(20, options.contextRadius ?? 5));
  const chapterTitle = options.chapter.title.replace(/\s+/g, ' ').trim();
  const start = Math.max(0, options.paragraphIndex - radius);
  const end = Math.min(options.chapter.paragraphs.length, options.paragraphIndex + radius + 1);
  const contextParts: string[] = [];
  for (let index = start; index < end; index++) {
    const text = options.chapter.paragraphs[index];
    const current = index === options.paragraphIndex;
    const expandedText = expandNoteReferences(text, options.chapter.notes);
    const safeText = current && options.selectedImage?.trim()
      ? '【当前是一幅插图，见随附图片】'
      : current && options.selectedText?.trim()
      ? expandSelectedTextWithNotes(options.selectedText.trim(), text, options.chapter.notes)
      : isImageMarker(text)
      ? '【此处有一幅插图，见随附图片】'
      : expandedText;
    contextParts.push(`${current ? '【当前段】' : '【上下文】'}${safeText}`);
  }
  const bookInfo = options.bookDescription
    ? `《${options.bookTitle}》，作者：${options.bookAuthor}。书籍简介：${options.bookDescription}`
    : `《${options.bookTitle}》，作者：${options.bookAuthor}。当前没有可用的 EPUB 书籍简介，请勿自行杜撰。`;
  const imageHint = options.imageCount ? `\n随附 ${options.imageCount} 张图片，请结合图片中的图表、文字或视觉关系回答。` : '';
  return `书籍信息：${bookInfo}\n当前章节：${chapterTitle}\n上下文范围：当前位置前后各 ${radius} 个内容块\n\n${contextParts.join('\n\n')}\n\n任务：${questionTask}${options.question ? `\n读者的问题：${options.question}` : ''}${imageHint}`;
}

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

function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((part) => {
    if (!part || typeof part !== 'object') return '';
    const text = (part as { text?: unknown }).text;
    return typeof text === 'string' ? text : '';
  }).join('');
}

function createSseParser(onDelta?: (delta: string) => void, onThinkingDelta?: (delta: string) => void) {
  let buffer = '';
  let content = '';
  let thinking = '';
  const consumeLine = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    try {
      const chunk = JSON.parse(data) as AIStreamChunk;
      const fields = chunk.choices?.[0]?.delta;
      const delta = extractText(fields?.content);
      const thinkingDelta = extractText(fields?.reasoning_content ?? fields?.reasoning);
      if (delta) { content += delta; onDelta?.(delta); }
      if (thinkingDelta) { thinking += thinkingDelta; onThinkingDelta?.(thinkingDelta); }
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
      return { content: content.trim(), thinking: thinking.trim() || undefined };
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

function requestWithXhr(url: string, apiKey: string, requestBody: Record<string, unknown>, signal: AbortSignal | undefined, onDelta?: (delta: string) => void, onThinkingDelta?: (delta: string) => void): Promise<AIResponse> {
  return new Promise<AIResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const parser = createSseParser(onDelta, onThinkingDelta);
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
      if (streamed.content) {
        settled = true; cleanup(); resolve(streamed); return;
      }
      try {
        const data = JSON.parse(xhr.responseText) as AIStreamChunk;
        const message = data.choices?.[0]?.message;
        const content = extractText(message?.content).trim();
        const thinking = extractText(message?.reasoning_content ?? message?.reasoning).trim() || undefined;
        if (!content) throw new Error('模型没有返回可显示的内容');
        settled = true; cleanup(); resolve({ content, thinking });
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
  selectedImage?: string;
  question?: string;
  contextRadius?: number;
  additionalImages?: string[];
  history?: AIMessage[];
  enableThinking?: boolean;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
  onThinkingDelta?: (delta: string) => void;
}): Promise<AIResponse> {
  const { settings, bookTitle, bookAuthor, bookDescription, chapter, paragraphIndex, question, signal, onDelta, onThinkingDelta } = options;
  const radius = Math.max(1, Math.min(20, options.contextRadius ?? 5));
  const chapterTitle = chapter.title.replace(/\s+/g, ' ').trim();
  const start = Math.max(0, paragraphIndex - radius);
  const end = Math.min(chapter.paragraphs.length, paragraphIndex + radius + 1);
  const contextImages: string[] = [];
  const contextParts: string[] = [];
  const contextParagraphs = chapter.paragraphs.slice(start, end);
  const resolvedImages = await Promise.all(contextParagraphs.map((text) => resolveImageBlock(text)));
  for (let i = 0; i < contextParagraphs.length; i++) {
    const text = contextParagraphs[i];
    const current = start + i === paragraphIndex;
    const image = resolvedImages[i];
    if (image && image.length <= 6_000_000) contextImages.push(image);
    const expandedText = expandNoteReferences(text, chapter.notes);
    const safeText = current && options.selectedImage?.trim()
      ? '【当前是一幅插图，见随附图片】'
      : current && options.selectedText?.trim()
      ? expandSelectedTextWithNotes(options.selectedText.trim(), text, chapter.notes)
      : image
      ? `【此处有一幅插图${image.length > 6_000_000 ? '，因文件过大未上传' : '，见随附图片'}】`
      : expandedText;
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
  const prompt = `书籍信息：${bookInfo}\n当前章节：${chapterTitle}\n上下文范围：当前位置前后各 ${radius} 个内容块\n\n${context}\n\n任务：${questionTask}${question ? `\n读者的问题：${question}` : ''}${allImages.length ? `\n随附 ${allImages.length} 张图片，请结合图片中的图表、文字或视觉关系回答。` : ''}`;
  const userContent: string | AIContentPart[] = allImages.length
    ? [
        { type: 'text', text: prompt },
        ...allImages.map((url): AIContentPart => ({ type: 'image_url', image_url: { url, detail: 'auto' } })),
      ]
    : prompt;
  const baseUrl = settings.baseUrl.replace(/\/$/, '');
  const customRequestParams = parseCustomRequestParams(typeof settings.customRequestParams === 'string' ? settings.customRequestParams : '');
  const systemPrompt = [
    '你是墨问里的通用阅读与问答助手。把提供的书籍上下文当作理解问题的切入点，同时关注读者真正想了解的事情。',
    '回答要自然、完整、像在和读者交流；问题延伸到书外时，顺势结合可靠的一般知识、常识和推理补充，不必刻意说明哪些内容来自原文。',
    '如果书中内容与补充知识需要区分，简短点明即可；对可能随时间变化或无法可靠确认的事实，说明不确定性并避免编造。',
    '不要把内部逐步推理混入最终回答。除非用户要求，先给结论，再给必要说明，使用简洁的 Markdown。',
  ].join('\n');
  const requestBody: Record<string, unknown> = {
    ...customRequestParams,
    model: settings.model,
    temperature: customRequestParams.temperature ?? 0.35,
    enable_thinking: options.enableThinking ?? false,
    stream: true,
    messages: [
      { role: 'system', content: systemPrompt },
      ...(options.history ?? []).map(({ role, content }) => ({ role, content })),
      { role: 'user', content: userContent },
    ],
  };
  return requestWithXhr(`${baseUrl}/chat/completions`, settings.apiKey, requestBody, signal, onDelta, onThinkingDelta);
}

export async function generateConversationTitle(options: {
  settings: AISettings;
  bookTitle: string;
  bookAuthor: string;
  bookDescription?: string;
  chapter: Chapter;
  paragraphIndex: number;
  selectedText?: string;
  question: string;
  answer: string;
  contextRadius?: number;
  signal?: AbortSignal;
}): Promise<string> {
  const answerExcerpt = options.answer.replace(/\s+/g, ' ').trim().slice(0, 1600);
  const titleQuestion = [
    '请为这次阅读对话生成一个简洁、准确的标题。',
    '只输出标题本身，不要解释，不要引号、Markdown、前缀或句号。',
    '使用与读者问题相同的语言，长度控制在 8 到 18 个汉字或字符，概括读者真正想问的核心。',
    `读者问题：${options.question}`,
    `助手回答：${answerExcerpt}`,
  ].join('\n');
  const response = await askAI({
    settings: options.settings,
    bookTitle: options.bookTitle,
    bookAuthor: options.bookAuthor,
    bookDescription: options.bookDescription,
    chapter: options.chapter,
    paragraphIndex: options.paragraphIndex,
    selectedText: options.selectedText,
    question: titleQuestion,
    contextRadius: options.contextRadius,
    enableThinking: false,
    signal: options.signal,
  });
  return normalizeConversationTitle(response.content);
}
