import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import JSZip from 'jszip';
import { normalizeChapterTitle, parseEpub } from './epub';
import { AIConversation, AISettings, Book, Bookmark, BookSummary, ReaderPrefs } from './types';

const LIBRARY_KEY = 'mowen:library:v1';
const PREFS_KEY = 'mowen:prefs:v1';
const AI_KEY = 'mowen:ai:v1';
const AI_SECRET_KEY = 'mowen.ai-secret.v1';
const BOOKMARKS_KEY = 'mowen:bookmarks:v1';
const BOOK_FORMAT_VERSION = 6;
const BOOK_DIR = `${FileSystem.documentDirectory}mowen-books/`;
const CONVERSATIONS_FILE = `${FileSystem.documentDirectory}mowen-ai-conversations.json`;
const bookCache = new Map<string, Book>();
const BOOK_CACHE_LIMIT = 3;

type StoredBookMetadata = Omit<Book, 'chapters'> & {
  formatVersion: number;
  chapterFiles: string[];
};

const safeBookName = (id: string) => encodeURIComponent(id);
const bookFolder = (id: string) => `${BOOK_DIR}${safeBookName(id)}/`;

function rememberBook(book: Book) {
  bookCache.delete(book.id);
  bookCache.set(book.id, book);
  while (bookCache.size > BOOK_CACHE_LIMIT) bookCache.delete(bookCache.keys().next().value!);
}

function dataImage(value?: string) {
  return value?.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
}

function imageExtension(mime: string) {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/svg+xml') return 'svg';
  return mime.split('/')[1]?.replace(/[^a-zA-Z0-9]/g, '') || 'img';
}

function imageDimensions(base64: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let index = 0; index < base64.length && bytes.length < 65_536; index++) {
    const value = alphabet.indexOf(base64[index]);
    if (value < 0) { if (base64[index] === '=') break; else continue; }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >> bits) & 255); buffer &= (1 << bits) - 1; }
  }
  let width = 0;
  let height = 0;
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    width = (((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0);
    height = (((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0);
  } else if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    width = bytes[6] | (bytes[7] << 8); height = bytes[8] | (bytes[9] << 8);
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const frames = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    for (let offset = 2; offset + 8 < bytes.length;) {
      if (bytes[offset++] !== 0xff) continue;
      const marker = bytes[offset++];
      if (frames.has(marker)) { height = (bytes[offset + 3] << 8) | bytes[offset + 4]; width = (bytes[offset + 5] << 8) | bytes[offset + 6]; break; }
      if (marker === 0xd9 || marker === 0xda) break;
      const length = (bytes[offset] << 8) | bytes[offset + 1];
      if (length < 2) break;
      offset += length;
    }
  }
  return width > 0 && height > 0 ? { width, height } : undefined;
}

export const defaultPrefs: ReaderPrefs = {
  readingMode: 'paged',
  fontSize: 24,
  lineHeight: 1.4,
  theme: 'wheat',
  fontStyle: 'sans',
  pagePadding: 24,
  pagePaddingTop: 0,
  pagePaddingBottom: 36,
  pagePaddingLeft: 24,
  pagePaddingRight: 24,
  paragraphSpacing: 24,
  firstLineIndent: false,
  textAlign: 'justify',
};
export const defaultAI: AISettings = {
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: process.env.EXPO_PUBLIC_DASHSCOPE_API_KEY ?? '',
  model: 'qwen3.7-flash',
  customRequestParams: '',
};

async function ensureBookDir() {
  const info = await FileSystem.getInfoAsync(BOOK_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(BOOK_DIR, { intermediates: true });
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function loadLibrary(): Promise<BookSummary[]> {
  const value = await AsyncStorage.getItem(LIBRARY_KEY);
  return value ? JSON.parse(value) : [];
}

export async function saveLibrary(items: BookSummary[]) {
  await AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(items));
}

export async function saveBook(book: Book): Promise<Book> {
  await ensureBookDir();
  const root = bookFolder(book.id);
  const chaptersDir = `${root}chapters/`;
  const assetsDir = `${root}assets/`;
  for (const directory of [root, chaptersDir, assetsDir]) {
    const info = await FileSystem.getInfoAsync(directory);
    if (!info.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  }
  let epubUri = book.epubUri;
  const persistedEpub = `${root}publication.epub`;
  if (epubUri && epubUri !== persistedEpub) {
    const sourceInfo = await FileSystem.getInfoAsync(epubUri);
    if (sourceInfo.exists) {
      const destinationInfo = await FileSystem.getInfoAsync(persistedEpub);
      if (destinationInfo.exists) await FileSystem.deleteAsync(persistedEpub);
      await FileSystem.copyAsync({ from: epubUri, to: persistedEpub });
      epubUri = persistedEpub;
    }
  }
  let epubZip: JSZip | null = null;
  const epubSourceUri = epubUri;
  if (epubSourceUri) {
    try {
      epubZip = await JSZip.loadAsync(await new File(epubSourceUri).arrayBuffer());
    } catch {
      epubZip = null;
    }
  }
  const chapters = await mapConcurrent(book.chapters, 4, async (chapter, chapterIndex) => {
    const paragraphs: string[] = [];
    for (let paragraphIndex = 0; paragraphIndex < chapter.paragraphs.length; paragraphIndex++) {
      const paragraph = chapter.paragraphs[paragraphIndex];
      const existingFile = paragraph.match(/^\[\[MOWEN_IMAGE_FILE:([^|\]]+)(?:\|(\d+)\|(\d+))?\]\]$/);
      if (existingFile) {
        if (existingFile[2] && existingFile[3]) { paragraphs.push(paragraph); continue; }
        try {
          const base64 = await FileSystem.readAsStringAsync(existingFile[1], { encoding: FileSystem.EncodingType.Base64 });
          const dimensions = imageDimensions(base64);
          paragraphs.push(`[[MOWEN_IMAGE_FILE:${existingFile[1]}${dimensions ? `|${dimensions.width}|${dimensions.height}` : ''}]]`);
        } catch { paragraphs.push(paragraph); }
        continue;
      }
      const epubImage = paragraph.match(/^\[\[MOWEN_IMAGE_EPUB:([^|\]]+)(?:\|([^\]]+))?\]\]$/);
      if (epubImage && epubZip) {
        const epubPath = epubImage[1];
        const mime = epubImage[2] || 'image/png';
        try {
          const base64 = await epubZip.file(epubPath)?.async('base64');
          if (base64) {
            const path = `${assetsDir}${chapterIndex}-${paragraphIndex}.${imageExtension(mime)}`;
            await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
            const dimensions = imageDimensions(base64);
            paragraphs.push(`[[MOWEN_IMAGE_FILE:${path}${dimensions ? `|${dimensions.width}|${dimensions.height}` : ''}]]`);
            continue;
          }
        } catch {
          // Keep the marker below if the source image cannot be extracted.
        }
      }
      const raw = paragraph.match(/^\[\[MOWEN_IMAGE_DATA:(data:image\/[\s\S]+)\]\]$/)?.[1];
      const parsed = dataImage(raw);
      if (!parsed) { paragraphs.push(paragraph); continue; }
      const path = `${assetsDir}${chapterIndex}-${paragraphIndex}.${imageExtension(parsed[1])}`;
      await FileSystem.writeAsStringAsync(path, parsed[2], { encoding: FileSystem.EncodingType.Base64 });
      const dimensions = imageDimensions(parsed[2]);
      paragraphs.push(`[[MOWEN_IMAGE_FILE:${path}${dimensions ? `|${dimensions.width}|${dimensions.height}` : ''}]]`);
    }
    const normalizedChapter = { ...chapter, title: normalizeChapterTitle(chapter.title), paragraphs };
    await FileSystem.writeAsStringAsync(`${chaptersDir}${chapterIndex}.json`, JSON.stringify(normalizedChapter));
    return normalizedChapter;
  });
  let cover = book.cover;
  const parsedCover = dataImage(cover);
  if (parsedCover) {
    const coverPath = `${assetsDir}cover.${imageExtension(parsedCover[1])}`;
    await FileSystem.writeAsStringAsync(coverPath, parsedCover[2], { encoding: FileSystem.EncodingType.Base64 });
    cover = coverPath;
  }
  const normalized = { ...book, cover, epubUri, chapters };
  const metadata: StoredBookMetadata = {
    id: normalized.id,
    title: normalized.title,
    author: normalized.author,
    description: normalized.description,
    cover: normalized.cover,
    epubUri: normalized.epubUri,
    addedAt: normalized.addedAt,
    formatVersion: BOOK_FORMAT_VERSION,
    chapterFiles: chapters.map((_chapter, index) => `chapters/${index}.json`),
  };
  await FileSystem.writeAsStringAsync(`${root}metadata.json`, JSON.stringify(metadata));
  rememberBook(normalized);
  return normalized;
}

export async function loadBook(id: string): Promise<Book | null> {
  const cached = bookCache.get(id);
  if (cached) { rememberBook(cached); return cached; }
  const root = bookFolder(id);
  const metadataPath = `${root}metadata.json`;
  const metadataInfo = await FileSystem.getInfoAsync(metadataPath);
  if (metadataInfo.exists) {
    const metadata = JSON.parse(await FileSystem.readAsStringAsync(metadataPath)) as StoredBookMetadata;
    const chapters = await Promise.all(metadata.chapterFiles.map(async (relativePath) => JSON.parse(await FileSystem.readAsStringAsync(`${root}${relativePath}`)) as Book['chapters'][number]));
    const normalizedChapters = chapters.map((chapter) => ({ ...chapter, title: normalizeChapterTitle(chapter.title) }));
    const titlesChanged = normalizedChapters.some((chapter, index) => chapter.title !== chapters[index].title);
    const { formatVersion: _formatVersion, chapterFiles: _chapterFiles, ...bookMetadata } = metadata;
    const book: Book = { ...bookMetadata, chapters: normalizedChapters };
    const formatVersion = Number.isFinite(metadata.formatVersion) ? metadata.formatVersion : 0;
    if (formatVersion < BOOK_FORMAT_VERSION && book.epubUri) {
      try {
        // Older versions replaced EPUB images with a text placeholder. Reparse the
        // original publication once so nearby image context can be recovered.
        const reparsed = await parseEpub(book.epubUri, book.title);
        return saveBook({
          ...reparsed,
          id: book.id,
          addedAt: book.addedAt,
          cover: book.cover ?? reparsed.cover,
        });
      } catch {
        // Fall through and at least migrate the existing chapter files.
      }
    }
    if (formatVersion < BOOK_FORMAT_VERSION) return saveBook(book);
    if (titlesChanged) {
      await Promise.all(normalizedChapters.map((chapter, index) => chapter.title === chapters[index].title ? undefined : FileSystem.writeAsStringAsync(`${root}${metadata.chapterFiles[index]}`, JSON.stringify(chapter))));
    }
    rememberBook(book);
    return book;
  }
  const legacyPath = `${BOOK_DIR}${id}.json`;
  const legacyInfo = await FileSystem.getInfoAsync(legacyPath);
  if (!legacyInfo.exists) return null;
  const legacy = JSON.parse(await FileSystem.readAsStringAsync(legacyPath)) as Book;
  const migrated = await saveBook(legacy);
  await FileSystem.deleteAsync(legacyPath);
  return migrated;
}

export async function deleteBookFile(id: string) {
  bookCache.delete(id);
  for (const path of [bookFolder(id), `${BOOK_DIR}${id}.json`]) {
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) await FileSystem.deleteAsync(path);
  }
}

export async function loadPrefs(): Promise<ReaderPrefs> {
  const value = await AsyncStorage.getItem(PREFS_KEY);
  if (!value) return defaultPrefs;
  const saved = JSON.parse(value) as Partial<ReaderPrefs>;
  const legacyHorizontal = saved.pagePadding ?? defaultPrefs.pagePadding;
  return {
    ...defaultPrefs,
    ...saved,
    pagePaddingLeft: saved.pagePaddingLeft ?? legacyHorizontal,
    pagePaddingRight: saved.pagePaddingRight ?? legacyHorizontal,
    pagePaddingTop: saved.pagePaddingTop ?? defaultPrefs.pagePaddingTop,
    pagePaddingBottom: saved.pagePaddingBottom ?? defaultPrefs.pagePaddingBottom,
  };
}

export async function savePrefs(value: ReaderPrefs) {
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(value));
}

export async function loadAISettings(): Promise<AISettings> {
  const [value, apiKey] = await Promise.all([
    AsyncStorage.getItem(AI_KEY),
    SecureStore.getItemAsync(AI_SECRET_KEY),
  ]);
  const resolvedKey = apiKey ?? defaultAI.apiKey;
  if (!apiKey && resolvedKey) await SecureStore.setItemAsync(AI_SECRET_KEY, resolvedKey);
  const saved = value ? JSON.parse(value) as Partial<AISettings> : {};
  return {
    ...defaultAI,
    ...saved,
    customRequestParams: typeof saved.customRequestParams === 'string' ? saved.customRequestParams : defaultAI.customRequestParams,
    apiKey: resolvedKey,
  };
}

export async function saveAISettings(value: AISettings) {
  const { apiKey } = value;
  const publicSettings = { baseUrl: value.baseUrl, model: value.model, customRequestParams: value.customRequestParams };
  await Promise.all([
    AsyncStorage.setItem(AI_KEY, JSON.stringify(publicSettings)),
    apiKey ? SecureStore.setItemAsync(AI_SECRET_KEY, apiKey) : SecureStore.deleteItemAsync(AI_SECRET_KEY),
  ]);
}

export async function loadBookmarks(): Promise<Bookmark[]> {
  const value = await AsyncStorage.getItem(BOOKMARKS_KEY);
  return value ? (JSON.parse(value) as Bookmark[]).map((bookmark) => ({ ...bookmark, chapterTitle: normalizeChapterTitle(bookmark.chapterTitle) })) : [];
}

export async function saveBookmarks(value: Bookmark[]) {
  await AsyncStorage.setItem(BOOKMARKS_KEY, JSON.stringify(value.map((bookmark) => ({ ...bookmark, chapterTitle: normalizeChapterTitle(bookmark.chapterTitle) }))));
}

export async function loadConversations(): Promise<AIConversation[]> {
  const info = await FileSystem.getInfoAsync(CONVERSATIONS_FILE);
  if (!info.exists) return [];
  try {
    return (JSON.parse(await FileSystem.readAsStringAsync(CONVERSATIONS_FILE)) as AIConversation[]).map((conversation) => ({ ...conversation, chapterTitle: normalizeChapterTitle(conversation.chapterTitle) }));
  } catch {
    return [];
  }
}

export async function saveConversations(value: AIConversation[]) {
  await FileSystem.writeAsStringAsync(CONVERSATIONS_FILE, JSON.stringify(value.map((conversation) => ({ ...conversation, chapterTitle: normalizeChapterTitle(conversation.chapterTitle) }))));
}

export function summarizeBook(book: Book): BookSummary {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    cover: book.cover,
    epubUri: book.epubUri,
    addedAt: book.addedAt,
    chapterCount: book.chapters.length,
    currentChapter: 0,
    currentParagraph: 0,
    progress: 0,
    lastReadAt: 0,
  };
}
