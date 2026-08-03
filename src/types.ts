export type Chapter = {
  id: string;
  title: string;
  paragraphs: string[];
  notes?: Record<string, string>;
};

export type EpubLocator = {
  href: string;
  type: string;
  target?: number;
  title?: string;
  locations?: {
    progression: number;
    position?: number;
    totalProgression?: number;
  };
  text?: {
    before?: string;
    highlight?: string;
    after?: string;
  };
};

export type Book = {
  id: string;
  title: string;
  author: string;
  description?: string;
  cover?: string;
  /** Persisted original EPUB used by the Foliate renderer. */
  epubUri?: string;
  chapters: Chapter[];
  addedAt: number;
};

export type BookSummary = Omit<Book, 'chapters'> & {
  chapterCount: number;
  currentChapter: number;
  currentParagraph: number;
  progress: number;
  lastReadAt: number;
  locator?: EpubLocator;
};

export type ReaderPrefs = {
  readingMode: 'scroll' | 'paged';
  fontSize: number;
  lineHeight: number;
  theme: 'paper' | 'wheat' | 'night' | 'mist';
  fontStyle: 'serif' | 'sans';
  /** Kept for migrating preferences saved by older versions. */
  pagePadding: number;
  pagePaddingTop: number;
  pagePaddingBottom: number;
  pagePaddingLeft: number;
  pagePaddingRight: number;
  paragraphSpacing: number;
  firstLineIndent: boolean;
  textAlign: 'left' | 'justify';
};

export type AISettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
  customRequestParams: string;
};

export type AIMessage = {
  role: 'user' | 'assistant';
  content: string;
  /** Optional for backwards compatibility with conversations saved before timestamps were added. */
  createdAt?: number;
};

export type Bookmark = {
  id: string;
  bookId: string;
  chapterIndex: number;
  paragraphIndex: number;
  sectionIndex?: number;
  chapterTitle: string;
  excerpt: string;
  locator?: EpubLocator;
  createdAt: number;
};

export type AIConversation = {
  id: string;
  bookId: string;
  chapterIndex: number;
  paragraphIndex: number;
  chapterTitle: string;
  anchorExcerpt: string;
  locator?: EpubLocator;
  contextRadius: number;
  messages: AIMessage[];
  createdAt: number;
  updatedAt: number;
};
