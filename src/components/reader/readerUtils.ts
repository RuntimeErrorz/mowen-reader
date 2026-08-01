import type { ReaderPalette } from '../../ui/theme';

export function getImageData(value: string) {
  const match = value.match(/^\[\[MOWEN_IMAGE_(?:DATA|FILE):([\s\S]+)\]\]$/);
  return match?.[1].split('|')[0];
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
