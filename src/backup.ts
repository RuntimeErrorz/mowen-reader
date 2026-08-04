import { File } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import JSZip from 'jszip';
import { Platform } from 'react-native';
import { parseEpub } from './epub';
import { defaultPrefs, saveBook as persistBook, summarizeBook } from './storage';
import { AIConversation, AIMessage, AISettings, Book, BookSummary, Bookmark, EpubLocator, ReaderPrefs } from './types';

const BACKUP_FORMAT = 'mowen-backup';
const BACKUP_VERSION = 1;
const MANIFEST_FILE = 'mowen-backup.json';
const BOOKS_DIRECTORY = 'books/';

export type BackupAISettings = Pick<AISettings, 'baseUrl' | 'model' | 'customRequestParams'>;

export type BackupBookRecord = Omit<BookSummary, 'cover' | 'epubUri'> & { hasEpub: boolean };

export type BackupData = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: number;
  library: BackupBookRecord[];
  prefs: ReaderPrefs;
  aiSettings: BackupAISettings;
  bookmarks: Bookmark[];
  conversations: AIConversation[];
};

export type BackupPreview = {
  fileName: string;
  createdAt: number;
  bookCount: number;
  availableBookCount: number;
  missingBookCount: number;
  bookmarkCount: number;
  conversationCount: number;
  messageCount: number;
};

export type BackupArchive = { data: BackupData; preview: BackupPreview };

export type BackupSelection = { uri: string; fileName: string; preview: BackupPreview };

export type BackupBuildResult = { uri: string; fileName: string; missingBooks: string[] };

export type BackupSaveResult = BackupBuildResult & { saved: boolean };

export type BackupRestoreResult = {
  library: BookSummary[];
  prefs: ReaderPrefs;
  aiSettings: AISettings;
  bookmarks: Bookmark[];
  conversations: AIConversation[];
  restoredBookCount: number;
  skippedBooks: string[];
};

type RuntimeArchive = BackupArchive & { zip: JSZip };

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const textOr = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const numberOr = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const intOr = (value: unknown, fallback: number) => Math.round(numberOr(value, fallback));
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const clampInt = (value: unknown, min: number, max: number, fallback: number) => clamp(intOr(value, fallback), min, max);

function backupBookPath(id: string) {
  return `${BOOKS_DIRECTORY}${encodeURIComponent(id)}.epub`;
}

function backupFileName() {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `mowen-backup-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.mowen.zip`;
}

function normalizeLocator(value: unknown): EpubLocator | undefined {
  if (!isRecord(value) || typeof value.href !== 'string' || typeof value.type !== 'string') return undefined;
  return value as unknown as EpubLocator;
}

function normalizePrefs(value: unknown): ReaderPrefs {
  const saved = isRecord(value) ? value : {};
  const themes: ReaderPrefs['theme'][] = ['paper', 'wheat', 'mist', 'night'];
  const fontStyles: ReaderPrefs['fontStyle'][] = ['serif', 'sans'];
  const readingModes: ReaderPrefs['readingMode'][] = ['scroll', 'paged'];
  const textAlignments: ReaderPrefs['textAlign'][] = ['left', 'justify'];
  const legacyPadding = clamp(numberOr(saved.pagePadding, defaultPrefs.pagePadding), 0, 80);
  return {
    ...defaultPrefs,
    readingMode: readingModes.includes(saved.readingMode as ReaderPrefs['readingMode']) ? saved.readingMode as ReaderPrefs['readingMode'] : defaultPrefs.readingMode,
    fontSize: clamp(numberOr(saved.fontSize, defaultPrefs.fontSize), 12, 48),
    lineHeight: clamp(numberOr(saved.lineHeight, defaultPrefs.lineHeight), 1, 2.4),
    theme: themes.includes(saved.theme as ReaderPrefs['theme']) ? saved.theme as ReaderPrefs['theme'] : defaultPrefs.theme,
    fontStyle: fontStyles.includes(saved.fontStyle as ReaderPrefs['fontStyle']) ? saved.fontStyle as ReaderPrefs['fontStyle'] : defaultPrefs.fontStyle,
    pagePadding: legacyPadding,
    pagePaddingTop: clamp(numberOr(saved.pagePaddingTop, defaultPrefs.pagePaddingTop), 0, 80),
    pagePaddingBottom: clamp(numberOr(saved.pagePaddingBottom, defaultPrefs.pagePaddingBottom), 0, 100),
    pagePaddingLeft: clamp(numberOr(saved.pagePaddingLeft, legacyPadding), 0, 80),
    pagePaddingRight: clamp(numberOr(saved.pagePaddingRight, legacyPadding), 0, 80),
    paragraphSpacing: clamp(numberOr(saved.paragraphSpacing, defaultPrefs.paragraphSpacing), 0, 80),
    firstLineIndent: saved.firstLineIndent === true,
    textAlign: textAlignments.includes(saved.textAlign as ReaderPrefs['textAlign']) ? saved.textAlign as ReaderPrefs['textAlign'] : defaultPrefs.textAlign,
  };
}

function normalizeBook(value: unknown): BackupBookRecord {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.title !== 'string' || typeof value.author !== 'string') {
    throw new Error('备份中包含无效的书籍记录');
  }
  return {
    id: value.id,
    title: value.title,
    author: value.author,
    description: typeof value.description === 'string' ? value.description : undefined,
    addedAt: numberOr(value.addedAt, Date.now()),
    chapterCount: clampInt(value.chapterCount, 0, 100_000, 0),
    currentChapter: Math.max(0, intOr(value.currentChapter, 0)),
    currentParagraph: Math.max(0, intOr(value.currentParagraph, 0)),
    progress: clamp(numberOr(value.progress, 0), 0, 1),
    lastReadAt: Math.max(0, numberOr(value.lastReadAt, 0)),
    locator: normalizeLocator(value.locator),
    hasEpub: value.hasEpub === true,
  };
}

function normalizeMessage(value: unknown): AIMessage | null {
  if (!isRecord(value) || (value.role !== 'user' && value.role !== 'assistant') || typeof value.content !== 'string') return null;
  return {
    role: value.role,
    content: value.content,
    ...(typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? { createdAt: value.createdAt } : {}),
  };
}

function normalizeBookmark(value: unknown): Bookmark | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.bookId !== 'string' || typeof value.chapterTitle !== 'string' || typeof value.excerpt !== 'string') return null;
  return {
    id: value.id,
    bookId: value.bookId,
    chapterIndex: Math.max(0, intOr(value.chapterIndex, 0)),
    paragraphIndex: Math.max(0, intOr(value.paragraphIndex, 0)),
    sectionIndex: typeof value.sectionIndex === 'number' && Number.isFinite(value.sectionIndex) ? Math.max(0, intOr(value.sectionIndex, 0)) : undefined,
    chapterTitle: value.chapterTitle,
    excerpt: value.excerpt,
    locator: normalizeLocator(value.locator),
    createdAt: Math.max(0, numberOr(value.createdAt, Date.now())),
  };
}

function normalizeConversation(value: unknown): AIConversation | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.bookId !== 'string' || typeof value.chapterTitle !== 'string' || typeof value.anchorExcerpt !== 'string') return null;
  const messages = Array.isArray(value.messages) ? value.messages.map(normalizeMessage).filter((item): item is AIMessage => !!item) : [];
  return {
    id: value.id,
    bookId: value.bookId,
    chapterIndex: Math.max(0, intOr(value.chapterIndex, 0)),
    paragraphIndex: Math.max(0, intOr(value.paragraphIndex, 0)),
    chapterTitle: value.chapterTitle,
    anchorExcerpt: value.anchorExcerpt,
    ...(typeof value.selectedText === 'string' ? { selectedText: value.selectedText } : {}),
    ...(typeof value.selectedImage === 'string' ? { selectedImage: value.selectedImage } : {}),
    locator: normalizeLocator(value.locator),
    contextRadius: clampInt(value.contextRadius, 1, 20, 5),
    messages,
    createdAt: Math.max(0, numberOr(value.createdAt, Date.now())),
    updatedAt: Math.max(0, numberOr(value.updatedAt, Date.now())),
  };
}

function normalizeBackup(value: unknown): BackupData {
  if (!isRecord(value) || value.format !== BACKUP_FORMAT || value.version !== BACKUP_VERSION) {
    throw new Error('不是受支持的墨问备份文件');
  }
  if (!Array.isArray(value.library) || !Array.isArray(value.bookmarks) || !Array.isArray(value.conversations)) {
    throw new Error('备份文件结构不完整');
  }
  const ai = isRecord(value.aiSettings) ? value.aiSettings : {};
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: Math.max(0, numberOr(value.createdAt, Date.now())),
    library: value.library.map(normalizeBook),
    prefs: normalizePrefs(value.prefs),
    aiSettings: {
      baseUrl: textOr(ai.baseUrl),
      model: textOr(ai.model),
      customRequestParams: textOr(ai.customRequestParams),
    },
    bookmarks: value.bookmarks.map(normalizeBookmark).filter((item): item is Bookmark => !!item),
    conversations: value.conversations.map(normalizeConversation).filter((item): item is AIConversation => !!item),
  };
}

function previewOf(data: BackupData, fileName: string): BackupPreview {
  return {
    fileName,
    createdAt: data.createdAt,
    bookCount: data.library.length,
    availableBookCount: data.library.filter((book) => book.hasEpub).length,
    missingBookCount: data.library.filter((book) => !book.hasEpub).length,
    bookmarkCount: data.bookmarks.length,
    conversationCount: data.conversations.length,
    messageCount: data.conversations.reduce((sum, conversation) => sum + conversation.messages.length, 0),
  };
}

async function readRuntimeArchive(uri: string, fileName: string): Promise<RuntimeArchive> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await new File(uri).arrayBuffer());
  } catch {
    throw new Error('无法读取备份压缩包');
  }
  const manifest = zip.file(MANIFEST_FILE);
  if (!manifest) throw new Error('备份文件缺少清单');
  let raw: unknown;
  try {
    raw = JSON.parse(await manifest.async('text'));
  } catch {
    throw new Error('备份清单损坏，无法导入');
  }
  const data = normalizeBackup(raw);
  return { zip, data, preview: previewOf(data, fileName) };
}

export async function inspectBackup(uri: string, fileName: string): Promise<BackupArchive> {
  const { data, preview } = await readRuntimeArchive(uri, fileName);
  return { data, preview };
}

export async function createBackupFile(options: {
  library: BookSummary[];
  prefs: ReaderPrefs;
  aiSettings: AISettings;
  bookmarks: Bookmark[];
  conversations: AIConversation[];
}): Promise<BackupBuildResult> {
  const zip = new JSZip();
  const missingBooks: string[] = [];
  const library: BackupBookRecord[] = [];
  for (const item of options.library) {
    let hasEpub = false;
    if (item.epubUri) {
      try {
        const info = await FileSystem.getInfoAsync(item.epubUri);
        if (info.exists) {
          zip.file(backupBookPath(item.id), await new File(item.epubUri).arrayBuffer());
          hasEpub = true;
        }
      } catch {
        hasEpub = false;
      }
    }
    if (!hasEpub) missingBooks.push(item.title);
    const { cover: _cover, epubUri: _epubUri, ...metadata } = item;
    library.push({ ...metadata, hasEpub });
  }
  const data: BackupData = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: Date.now(),
    library,
    prefs: options.prefs,
    aiSettings: {
      baseUrl: options.aiSettings.baseUrl,
      model: options.aiSettings.model,
      customRequestParams: options.aiSettings.customRequestParams,
    },
    bookmarks: options.bookmarks,
    conversations: options.conversations,
  };
  zip.file(MANIFEST_FILE, JSON.stringify(data));
  const base64 = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
  const directory = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  if (!directory) throw new Error('设备没有可用的本地存储空间');
  const fileName = backupFileName();
  const uri = `${directory}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  return { uri, fileName, missingBooks };
}

export async function saveBackupFile(result: BackupBuildResult): Promise<BackupSaveResult> {
  try {
    if (Platform.OS !== 'android') throw new Error('当前仅支持在 Android 上选择保存位置');
    const defaultDirectory = FileSystem.StorageAccessFramework.getUriForDirectoryInRoot('Download');
    const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(defaultDirectory);
    if (!permission.granted) return { ...result, saved: false };
    const destinationUri = await FileSystem.StorageAccessFramework.createFileAsync(permission.directoryUri, result.fileName, 'application/zip');
    const base64 = await FileSystem.readAsStringAsync(result.uri, { encoding: FileSystem.EncodingType.Base64 });
    await FileSystem.StorageAccessFramework.writeAsStringAsync(destinationUri, base64, { encoding: FileSystem.EncodingType.Base64 });
    return { ...result, saved: true };
  } finally {
    try { await FileSystem.deleteAsync(result.uri, { idempotent: true }); } catch {}
  }
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]) {
  const incomingIds = new Set(incoming.map((item) => item.id));
  return [...incoming, ...current.filter((item) => !incomingIds.has(item.id))];
}

function summaryFromBackup(book: Book, record: BackupBookRecord): BookSummary {
  const summary = summarizeBook(book);
  const chapterIndex = clampInt(record.currentChapter, 0, Math.max(0, book.chapters.length - 1), 0);
  const paragraphMax = Math.max(0, (book.chapters[chapterIndex]?.paragraphs.length || 1) - 1);
  return {
    ...summary,
    currentChapter: chapterIndex,
    currentParagraph: clampInt(record.currentParagraph, 0, paragraphMax, 0),
    progress: clamp(record.progress, 0, 1),
    lastReadAt: Math.max(0, record.lastReadAt),
    locator: record.locator,
  };
}

export async function restoreBackupFile(uri: string, fileName: string, options: {
  currentLibrary: BookSummary[];
  currentPrefs: ReaderPrefs;
  currentAISettings: AISettings;
  currentBookmarks: Bookmark[];
  currentConversations: AIConversation[];
  saveBook?: (book: Book) => Promise<Book>;
}): Promise<BackupRestoreResult> {
  const archive = await readRuntimeArchive(uri, fileName);
  const saveImportedBook = options.saveBook || persistBook;
  const restoredSummaries: BookSummary[] = [];
  const skippedBooks: string[] = [];
  for (const record of archive.data.library) {
    const existing = options.currentLibrary.find((item) => item.id === record.id);
    if (!record.hasEpub) {
      if (existing) {
        const { hasEpub: _hasEpub, ...metadata } = record;
        restoredSummaries.push({ ...existing, ...metadata, cover: existing.cover, epubUri: existing.epubUri });
      } else skippedBooks.push(record.title);
      continue;
    }
    const entry = archive.zip.file(backupBookPath(record.id));
    if (!entry) {
      skippedBooks.push(record.title);
      continue;
    }
    const cacheDirectory = FileSystem.cacheDirectory || FileSystem.documentDirectory;
    if (!cacheDirectory) throw new Error('设备没有可用的本地存储空间');
    const temporaryUri = `${cacheDirectory}mowen-restore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.epub`;
    try {
      await FileSystem.writeAsStringAsync(temporaryUri, await entry.async('base64'), { encoding: FileSystem.EncodingType.Base64 });
      const parsed = await parseEpub(temporaryUri, record.title);
      const saved = await saveImportedBook({ ...parsed, id: record.id, addedAt: record.addedAt });
      restoredSummaries.push(summaryFromBackup(saved, record));
    } catch {
      skippedBooks.push(record.title);
    } finally {
      try { await FileSystem.deleteAsync(temporaryUri, { idempotent: true }); } catch {}
    }
  }
  return {
    library: mergeById(options.currentLibrary, restoredSummaries),
    prefs: archive.data.prefs,
    aiSettings: {
      ...options.currentAISettings,
      ...(archive.data.aiSettings.baseUrl ? { baseUrl: archive.data.aiSettings.baseUrl } : {}),
      ...(archive.data.aiSettings.model ? { model: archive.data.aiSettings.model } : {}),
      customRequestParams: archive.data.aiSettings.customRequestParams,
    },
    bookmarks: mergeById(options.currentBookmarks, archive.data.bookmarks),
    conversations: mergeById(options.currentConversations, archive.data.conversations),
    restoredBookCount: restoredSummaries.length,
    skippedBooks,
  };
}
