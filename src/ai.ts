import { AIMessage, AISettings, Chapter } from './types';

export type AIIntent = 'explain' | 'thread' | 'simple' | 'question';

const intentText: Record<AIIntent, string> = {
  explain: '解释这段话真正表达的意思、关键概念和隐含逻辑。',
  thread: '结合前后文，说明这段话在本章论证中起什么作用。',
  simple: '用更直白的中文改写，并给一个贴切的小例子。',
  question: '回答读者的问题；如果原文不足以支持结论，要明确说明。',
};

export async function askAI(options: {
  settings: AISettings;
  bookTitle: string;
  bookAuthor: string;
  bookDescription?: string;
  chapter: Chapter;
  paragraphIndex: number;
  intent: AIIntent;
  question?: string;
  contextRadius?: number;
  additionalImages?: string[];
  history?: AIMessage[];
  signal?: AbortSignal;
}) {
  const { settings, bookTitle, bookAuthor, bookDescription, chapter, paragraphIndex, intent, question, signal } = options;
  const radius = Math.max(1, Math.min(10, options.contextRadius ?? 2));
  const start = Math.max(0, paragraphIndex - radius);
  const end = Math.min(chapter.paragraphs.length, paragraphIndex + radius + 1);
  const contextImages: string[] = [];
  const context = chapter.paragraphs.slice(start, end).map((text, i) => {
    const current = start + i === paragraphIndex;
    const image = text.match(/^\[\[MOWEN_IMAGE_DATA:(data:image\/[\s\S]+)\]\]$/)?.[1];
    if (image && image.length <= 6_000_000 && contextImages.length < 4) contextImages.push(image);
    const safeText = image
      ? `【此处有一幅插图${image.length > 6_000_000 ? '，因文件过大未上传' : '，见随附图片'}】`
      : text.replace(/\[\[MOWEN_NOTE_REF:[^\]]+\]\]/g, '〔脚注〕');
    return `${current ? '【当前段】' : '【上下文】'}${safeText}`;
  }).join('\n\n');
  // Explicit user attachments take priority when the four-image request limit is reached.
  const allImages = [...(options.additionalImages ?? []), ...contextImages]
    .filter((value, index, values) => value.startsWith('data:image/') && values.indexOf(value) === index)
    .slice(0, 4);
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
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.35,
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
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`模型接口返回 ${response.status}${body ? `：${body.slice(0, 120)}` : ''}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('模型没有返回可显示的内容');
  return String(content).trim();
}
