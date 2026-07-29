import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { AIConversation, AISettings, Book, Bookmark, BookSummary, ReaderPrefs } from './types';

const LIBRARY_KEY = 'mowen:library:v1';
const PREFS_KEY = 'mowen:prefs:v1';
const AI_KEY = 'mowen:ai:v1';
const AI_SECRET_KEY = 'mowen:ai-secret:v1';
const BOOKMARKS_KEY = 'mowen:bookmarks:v1';
const BOOK_DIR = `${FileSystem.documentDirectory}mowen-books/`;
const CONVERSATIONS_FILE = `${FileSystem.documentDirectory}mowen-ai-conversations.json`;

export const defaultPrefs: ReaderPrefs = {
  fontSize: 19,
  lineHeight: 1.9,
  theme: 'paper',
  fontStyle: 'serif',
  pagePadding: 26,
  paragraphSpacing: 10,
  textAlign: 'justify',
};
export const defaultAI: AISettings = {
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: process.env.EXPO_PUBLIC_DASHSCOPE_API_KEY ?? '',
  model: 'qwen3.7-flash',
};

async function ensureBookDir() {
  const info = await FileSystem.getInfoAsync(BOOK_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(BOOK_DIR, { intermediates: true });
}

export async function loadLibrary(): Promise<BookSummary[]> {
  const value = await AsyncStorage.getItem(LIBRARY_KEY);
  return value ? JSON.parse(value) : [];
}

export async function saveLibrary(items: BookSummary[]) {
  await AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(items));
}

export async function saveBook(book: Book) {
  await ensureBookDir();
  await FileSystem.writeAsStringAsync(`${BOOK_DIR}${book.id}.json`, JSON.stringify(book));
}

export async function loadBook(id: string): Promise<Book | null> {
  const path = `${BOOK_DIR}${id}.json`;
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) return null;
  return JSON.parse(await FileSystem.readAsStringAsync(path));
}

export async function deleteBookFile(id: string) {
  const path = `${BOOK_DIR}${id}.json`;
  const info = await FileSystem.getInfoAsync(path);
  if (info.exists) await FileSystem.deleteAsync(path);
}

export async function loadPrefs(): Promise<ReaderPrefs> {
  const value = await AsyncStorage.getItem(PREFS_KEY);
  return value ? { ...defaultPrefs, ...JSON.parse(value) } : defaultPrefs;
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
  return { ...defaultAI, ...(value ? JSON.parse(value) : {}), apiKey: resolvedKey };
}

export async function saveAISettings(value: AISettings) {
  const { apiKey, ...publicSettings } = value;
  await Promise.all([
    AsyncStorage.setItem(AI_KEY, JSON.stringify(publicSettings)),
    apiKey ? SecureStore.setItemAsync(AI_SECRET_KEY, apiKey) : SecureStore.deleteItemAsync(AI_SECRET_KEY),
  ]);
}

export async function loadBookmarks(): Promise<Bookmark[]> {
  const value = await AsyncStorage.getItem(BOOKMARKS_KEY);
  return value ? JSON.parse(value) : [];
}

export async function saveBookmarks(value: Bookmark[]) {
  await AsyncStorage.setItem(BOOKMARKS_KEY, JSON.stringify(value));
}

export async function loadConversations(): Promise<AIConversation[]> {
  const info = await FileSystem.getInfoAsync(CONVERSATIONS_FILE);
  if (!info.exists) return [];
  try {
    return JSON.parse(await FileSystem.readAsStringAsync(CONVERSATIONS_FILE));
  } catch {
    return [];
  }
}

export async function saveConversations(value: AIConversation[]) {
  await FileSystem.writeAsStringAsync(CONVERSATIONS_FILE, JSON.stringify(value));
}

export function summarizeBook(book: Book): BookSummary {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    cover: book.cover,
    addedAt: book.addedAt,
    chapterCount: book.chapters.length,
    currentChapter: 0,
    currentParagraph: 0,
    progress: 0,
    lastReadAt: 0,
  };
}
