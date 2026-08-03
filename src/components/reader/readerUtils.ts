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

export function themedMarkdownStyles(palette: ReaderPalette) {
  return {
    body: { color: palette.text },
    text: { color: palette.text },
    paragraph: { color: palette.text },
    heading1: { color: palette.text },
    heading2: { color: palette.text },
    heading3: { color: palette.text },
    strong: { color: palette.text },
    link: { color: palette.accent },
    blockquote: { backgroundColor: palette.surfaceAlt, borderLeftColor: palette.accent },
    code_inline: { color: palette.text, backgroundColor: palette.surfaceAlt },
    bullet_list_icon: { color: palette.accent },
    hr: { backgroundColor: palette.line },
  };
}
