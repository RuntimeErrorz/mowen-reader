export type Chapter = {
  id: string;
  title: string;
  paragraphs: string[];
  notes?: Record<string, string>;
};

export type Book = {
  id: string;
  title: string;
  author: string;
  description?: string;
  cover?: string;
  chapters: Chapter[];
  addedAt: number;
};

export type BookSummary = Omit<Book, 'chapters'> & {
  chapterCount: number;
  currentChapter: number;
  currentParagraph: number;
  progress: number;
  lastReadAt: number;
};

export type ReaderPrefs = {
  fontSize: number;
  lineHeight: number;
  theme: 'paper' | 'wheat' | 'night' | 'mist';
  fontStyle: 'serif' | 'sans';
  pagePadding: number;
  paragraphSpacing: number;
  textAlign: 'left' | 'justify';
};

export type AISettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type AIMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type Bookmark = {
  id: string;
  bookId: string;
  chapterIndex: number;
  paragraphIndex: number;
  chapterTitle: string;
  excerpt: string;
  createdAt: number;
};

export type AIConversation = {
  id: string;
  bookId: string;
  chapterIndex: number;
  paragraphIndex: number;
  chapterTitle: string;
  anchorExcerpt: string;
  contextRadius: number;
  messages: AIMessage[];
  createdAt: number;
  updatedAt: number;
};
