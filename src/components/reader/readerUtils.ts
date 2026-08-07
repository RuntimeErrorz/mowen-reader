import type { ReaderPalette } from '../../ui/theme';

export function getImageData(value: string) {
  const match = value.match(/^\[\[MOWEN_IMAGE_(?:DATA|FILE):([\s\S]+)\]\]$/);
  return match?.[1].split('|')[0];
}

export function formatMessageTime(timestamp: number | undefined, fallback: number) {
  const value = typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : fallback;
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function trimBoldMarkerSpacing(value: string) {
  const markers: number[] = [];
  for (let index = 0; index < value.length - 1; index++) {
    if (value.startsWith('**', index)) { markers.push(index); index++; }
  }
  let normalized = value;
  for (let pair = Math.floor(markers.length / 2) - 1; pair >= 0; pair--) {
    const start = markers[pair * 2];
    const end = markers[pair * 2 + 1];
    const content = value.slice(start + 2, end).replace(/^[ \t]+|[ \t]+$/g, '');
    normalized = `${normalized.slice(0, start)}**${content}**${normalized.slice(end + 2)}`;
  }
  return normalized;
}

function normalizeMarkdownSegment(value: string) {
  const normalized = value
    .replace(/＊＊/g, '**')
    .replace(/＊/g, '*')
    .replace(/\\(\*\*|__|~~|\*|_|`|#|>)/g, '$1')
    .replace(/<\s*(?:strong|b)\s*>/gi, '**')
    .replace(/<\s*\/\s*(?:strong|b)\s*>/gi, '**')
    .replace(/<\s*(?:em|i)\s*>/gi, '*')
    .replace(/<\s*\/\s*(?:em|i)\s*>/gi, '*');
  return trimBoldMarkerSpacing(normalized);
}

function mapOutsideInlineCode(value: string, transform: (segment: string) => string) {
  return value.split(/(`+[^`\n]*`+)/g).map((segment, index) => index % 2 ? segment : transform(segment)).join('');
}

function countBoldMarkers(value: string) {
  return value.split(/(`+[^`\n]*`+)/g).reduce((total, segment, index) => {
    if (index % 2) return total;
    let count = 0;
    for (let cursor = 0; cursor < segment.length; cursor++) {
      if (segment[cursor] === '\\') { cursor++; continue; }
      if (segment.startsWith('**', cursor)) { count++; cursor++; }
    }
    return total + count;
  }, 0);
}

function normalizeMarkdownBlock(value: string) {
  return value.split(/(\n\s*\n)/g).map((block) => {
    const normalized = mapOutsideInlineCode(block, normalizeMarkdownSegment);
    return countBoldMarkers(normalized) % 2 ? `${normalized}**` : normalized;
  }).join('');
}

export function normalizeAIThinking(value: string) {
  const normalized = value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/<\s*\/?\s*(?:think|thinking|reasoning)\b[^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (normalized.length <= 6000) return normalized;
  return `${normalized.slice(0, 6000).trimEnd()}…`;
}

export function splitAIAnswer(value: string) {
  const thinkingParts: string[] = [];
  const withoutThinking = value.replace(/<\s*(?:think|thinking|reasoning)\b[^>]*>([\s\S]*?)(?:<\s*\/\s*(?:think|thinking|reasoning)\s*>|$)/gi, (_match, body: string) => {
    if (body.trim()) thinkingParts.push(body);
    return '';
  });
  const thinking = normalizeAIThinking(thinkingParts.join('\n\n'));
  return {
    content: normalizeAIAnswer(withoutThinking),
    thinking: thinking || undefined,
  };
}

/** Normalize common model-output variants before handing text to the native Markdown renderer. */
export function normalizeAIAnswer(value: string) {
  let normalized = value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/<\s*(?:think|thinking|reasoning)\b[^>]*>[\s\S]*?(?:<\s*\/\s*(?:think|thinking|reasoning)\s*>|$)/gi, '')
    .replace(/<\s*\/\s*(?:think|thinking|reasoning)\s*>/gi, '')
    .trim();
  const markdownWrapper = normalized.match(/^\s*(`{3,}|~{3,})[ \t]*(?:markdown|md)[ \t]*\n([\s\S]*?)\n\s*\1\s*$/i);
  if (markdownWrapper) normalized = markdownWrapper[2];

  const lines = normalized.split('\n');
  const output: string[] = [];
  let plainLines: string[] = [];
  let fence: '`' | '~' | null = null;
  const flushPlain = () => {
    if (plainLines.length) output.push(normalizeMarkdownBlock(plainLines.join('\n')));
    plainLines = [];
  };
  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (!fence && fenceMatch) {
      flushPlain();
      fence = fenceMatch[1][0] as '`' | '~';
      output.push(line);
      continue;
    }
    if (fence) {
      output.push(line);
      if (fenceMatch?.[1][0] === fence) fence = null;
      continue;
    }
    plainLines.push(line);
  }
  flushPlain();
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function stripPreviewFormatting(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/(\*\*|__|~~|`+)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Flatten an AI answer for the compact conversation-list preview. */
export function conversationAnswerPreview(value: string) {
  const normalized = normalizeAIAnswer(value);
  return stripPreviewFormatting(normalized);
}

export function themedMarkdownStyles(palette: ReaderPalette) {
  return {
    body: { color: palette.text },
    text: { color: palette.text },
    paragraph: { color: palette.text },
    heading1: { color: palette.text },
    heading2: { color: palette.text },
    heading3: { color: palette.text },
    strong: { color: palette.text, fontWeight: '800' as const },
    link: { color: palette.accent },
    blockquote: { backgroundColor: palette.surfaceAlt, borderLeftColor: palette.accent },
    code_inline: { color: palette.text, backgroundColor: palette.surfaceAlt },
    bullet_list_icon: { color: palette.accent },
    hr: { backgroundColor: palette.line },
  };
}
