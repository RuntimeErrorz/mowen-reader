import { AIMessage, AISettings, Chapter } from './types';
import * as FileSystem from 'expo-file-system/legacy';

export type AIIntent = 'explain' | 'thread' | 'simple' | 'question';

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

async function readStreamingResponse(response: Response, onDelta?: (delta: string) => void) {
  const reader = response.body?.getReader();
  if (!reader) {
    console.log('[墨问AI] response.body unavailable; falling back to full-body parsing');
    return null;
  }
  const decoder = new TextDecoder();
  let buffer = '';
  let raw = '';
  let mode: 'sse' | 'json' | null = null;
  let content = '';
  const consumeLine = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    try {
      const chunk = JSON.parse(data) as { choices?: Array<{ delta?: { content?: unknown } }> };
      const delta = extractDeltaContent(chunk.choices?.[0]?.delta?.content);
      if (delta) { content += delta; onDelta?.(delta); }
    } catch {
      console.warn('[墨问AI] failed to parse one SSE frame', { firstChar: data[0] ?? '', length: data.length });
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    raw += chunk;
    if (!mode) {
      const start = raw.trimStart();
      if (start.startsWith('data:')) {
        mode = 'sse';
        console.log('[墨问AI] response mode: SSE');
      } else if (start.startsWith('{') || start.startsWith('[')) {
        mode = 'json';
        console.log('[墨问AI] response mode: JSON');
      }
    }
    if (mode === 'sse') {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      lines.forEach(consumeLine);
    }
  }
  const tail = decoder.decode();
  raw += tail;
  if (mode === 'sse') {
    buffer += tail;
    consumeLine(buffer);
    return content.trim();
  }
  if (mode === 'json') {
    const data = JSON.parse(raw) as { choices?: Array<{ message?: { content?: unknown } }> };
    return extractDeltaContent(data.choices?.[0]?.message?.content).trim();
  }
  return null;
}

function createSseParser(onDelta?: (delta: string) => void) {
  let buffer = '';
  let content = '';
  let frameCount = 0;
  const consumeLine = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    try {
      const chunk = JSON.parse(data) as { choices?: Array<{ delta?: { content?: unknown } }> };
      const delta = extractDeltaContent(chunk.choices?.[0]?.delta?.content);
      if (delta) { content += delta; frameCount++; onDelta?.(delta); }
    } catch {
      console.warn('[墨问AI] failed to parse XHR SSE frame', { firstChar: data[0] ?? '', length: data.length });
    }
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
      console.log('[墨问AI] XHR SSE complete', { frames: frameCount, contentLength: content.length });
      return content.trim();
    },
  };
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
    console.log('[墨问AI] using XHR progress streaming');
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
  const userContent: any = allImages.length
    ? [
        { type: 'text', text: prompt },
        ...allImages.map((url) => ({ type: 'image_url', image_url: { url, detail: 'auto' } })),
      ]
    : prompt;
  const baseUrl = settings.baseUrl.replace(/\/$/, '');
  const requestBody: Record<string, unknown> = {
    model: settings.model,
    temperature: 0.35,
    stream: true,
    messages: [
      { role: 'system', content: 'You are an EPUB reading assistant. Answer using the provided book context.' },
      ...(options.history ?? []),
      { role: 'user', content: userContent },
    ],
  };
  return requestWithXhr(`${baseUrl}/chat/completions`, settings.apiKey, requestBody, signal, onDelta);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.35,
      stream: true,
      messages: [
        {
          role: 'system',
          content: '你是嵌在 EPUB 阅读器页边的阅读助手。你的职责是帮助读者回到原文并理解它，而不是炫耀知识。只依据所给文本判断；先给一句核心解释，再分点说明。语言简洁、准确，不超过 450 个中文字符。可以使用简洁的 Markdown，包括粗体、列表、引用和必要的小标题。',
        },
        ...(options.history ?? []),
        {
          role: 'user',
          content: userContent,
        },
      ],
    }),
    signal,
  });
  console.log('[墨问AI] response received', {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    hasBody: !!response.body,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`模型接口返回 ${response.status}${body ? `：${body.slice(0, 120)}` : ''}`);
  }
  const streamed = await readStreamingResponse(response, onDelta);
  if (streamed !== null) {
    if (!streamed) throw new Error('妯″瀷娌℃湁杩斿洖鍙樉绀虹殑鍐呭');
    return streamed as string;
  }
  const body = await response.text();
  const bodyStart = body.trimStart();
  console.log('[墨问AI] full-body fallback', { length: body.length, startsWithData: bodyStart.startsWith('data:') });
  if (bodyStart.startsWith('data:')) {
    let content = '';
    for (const line of body.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const chunk = JSON.parse(data) as { choices?: Array<{ delta?: { content?: unknown } }> };
        const delta = extractDeltaContent(chunk.choices?.[0]?.delta?.content);
        if (delta) { content += delta; onDelta?.(delta); }
      } catch {
        console.warn('[墨问AI] failed to parse fallback SSE frame', { firstChar: data[0] ?? '', length: data.length });
      }
    }
    if (content.trim()) return content.trim();
  }
  const data = JSON.parse(body) as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = extractDeltaContent(data.choices?.[0]?.message?.content);
  if (!content) throw new Error('模型没有返回可显示的内容');
  return content.trim();
}
