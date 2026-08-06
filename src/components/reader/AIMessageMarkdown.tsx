import React from 'react';
import Markdown, { MarkdownIt } from 'react-native-markdown-display';
import { ReaderPalette } from '../../ui/theme';
import { markdownStyles } from '../../ui/styles';
import { splitAIAnswer, themedMarkdownStyles } from './readerUtils';

const aiMarkdown = new MarkdownIt({ html: false, breaks: true, linkify: true, typographer: true });

export function AIMessageMarkdown({ content, palette }: { content: string; palette: ReaderPalette }) {
  return (
    <Markdown markdownit={aiMarkdown} style={{ ...markdownStyles, ...themedMarkdownStyles(palette) }}>
      {splitAIAnswer(content).content}
    </Markdown>
  );
}
