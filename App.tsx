import React, { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AISettingsModal } from './src/components/AISettingsModal';
import { DataBackupModal } from './src/components/DataBackupModal';
import { LibraryScreen, Splash } from './src/components/LibraryScreen';
import { ReaderScreen } from './src/components/reader/ReaderScreen';
import { BackupSelection, createBackupFile, inspectBackup, restoreBackupFile, saveBackupFile } from './src/backup';
import { parseEpub } from './src/epub';
import {
  defaultAI,
  defaultPrefs,
  deleteBookFile,
  loadAISettings,
  loadBookmarks,
  loadConversations,
  loadBook,
  loadLibrary,
  loadPrefs,
  saveAISettings,
  saveBookmarks,
  saveConversations,
  saveLibrary,
  saveBook,
  savePrefs,
  summarizeBook,
} from './src/storage';
import { AIConversation, AISettings, Book, Bookmark, BookSummary, EpubLocator, ReaderPrefs } from './src/types';
import { getReaderPalette } from './src/ui/theme';
import { styles } from './src/ui/styles';

type Screen = 'library' | 'reader';

export default function App() {
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>('library');
  const [library, setLibrary] = useState<BookSummary[]>([]);
  const [book, setBook] = useState<Book | null>(null);
  const [prefs, setPrefs] = useState<ReaderPrefs>(defaultPrefs);
  const [aiSettings, setAiSettings] = useState<AISettings>(defaultAI);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [conversations, setConversations] = useState<AIConversation[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [openingBookId, setOpeningBookId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [savedLibrary, savedPrefs, savedAI, savedBookmarks, savedConversations] = await Promise.all([loadLibrary(), loadPrefs(), loadAISettings(), loadBookmarks(), loadConversations()]);
        setPrefs(savedPrefs);
        setAiSettings(savedAI);
        setBookmarks(savedBookmarks);
        setConversations(savedConversations);
        setLibrary(savedLibrary);
      } catch (error) {
        Alert.alert('无法打开书架', error instanceof Error ? error.message : '本地数据读取失败');
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const openBook = async (summary: BookSummary) => {
    if (openingBookId) return;
    setOpeningBookId(summary.id);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      const fullBook = await loadBook(summary.id);
      if (!fullBook) {
        Alert.alert('找不到这本书', '书籍文件可能已被系统清理，请重新导入。');
        return;
      }
      if (!fullBook.epubUri) {
        Alert.alert('需要重新导入一次', '这本书是旧版本导入的，书库里没有保留原始 EPUB。请重新导入同一本书；阅读进度会保留，之后将由 Foliate 排版。');
        return;
      }
      if (fullBook.cover !== summary.cover || fullBook.epubUri !== summary.epubUri) {
        const migratedLibrary = library.map((item) => item.id === summary.id ? { ...item, cover: fullBook.cover, epubUri: fullBook.epubUri } : item);
        setLibrary(migratedLibrary);
        await saveLibrary(migratedLibrary);
      }
      setBook(fullBook);
      setScreen('reader');
    } finally {
      setOpeningBookId(null);
    }
  };

  const importBook = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['application/epub+zip', 'application/octet-stream'], copyToCacheDirectory: true });
      if (result.canceled) return;
      setImporting(true);
      const asset = result.assets[0];
      const parsed = await parseEpub(asset.uri, asset.name);
      const existing = library.find((item) => item.title === parsed.title && item.author === parsed.author);
      const savedBook = await saveBook(existing ? { ...parsed, id: existing.id, addedAt: existing.addedAt } : parsed);
      const freshSummary = summarizeBook(savedBook);
      const savedSummary = existing ? {
        ...freshSummary,
        currentChapter: Math.min(existing.currentChapter, savedBook.chapters.length - 1),
        currentParagraph: Math.min(existing.currentParagraph, Math.max(0, savedBook.chapters[Math.min(existing.currentChapter, savedBook.chapters.length - 1)].paragraphs.length - 1)),
        progress: existing.progress,
        lastReadAt: existing.lastReadAt,
        locator: existing.locator,
      } : freshSummary;
      const next = existing ? library.map((item) => item.id === existing.id ? savedSummary : item) : [savedSummary, ...library];
      setLibrary(next);
      await saveLibrary(next);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await openBook(savedSummary);
    } catch (error) {
      Alert.alert('导入失败', error instanceof Error ? error.message : '无法解析这个文件');
    } finally {
      setImporting(false);
    }
  };

  const updateProgress = async (id: string, chapter: number, paragraph: number, fullBook: Book, locator?: EpubLocator) => {
    const totalBlocks = fullBook.chapters.reduce((sum, item) => sum + item.paragraphs.length, 0);
    const blocksBefore = fullBook.chapters.slice(0, chapter).reduce((sum, item) => sum + item.paragraphs.length, 0);
    const next = library.map((item) => item.id === id ? { ...item, currentChapter: chapter, currentParagraph: paragraph, progress: locator?.locations?.totalProgression ?? Math.min(1, (blocksBefore + paragraph + 1) / Math.max(1, totalBlocks)), lastReadAt: Date.now(), locator: locator ?? item.locator } : item);
    setLibrary(next);
    await saveLibrary(next);
  };

  const removeBook = (item: BookSummary) => {
    Alert.alert('移出书架？', `“${item.title}”的阅读进度也会删除。`, [
      { text: '取消', style: 'cancel' },
      { text: '移出', style: 'destructive', onPress: async () => {
        await deleteBookFile(item.id);
        const next = library.filter((bookItem) => bookItem.id !== item.id);
        setLibrary(next);
        await saveLibrary(next);
      } },
    ]);
  };

  const exportBackup = async () => {
    const result = await createBackupFile({ library, prefs, aiSettings, bookmarks, conversations });
    return saveBackupFile(result);
  };

  const pickBackup = async (): Promise<BackupSelection | null> => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/zip', 'application/octet-stream'], copyToCacheDirectory: true });
    if (result.canceled || !result.assets[0]) return null;
    const asset = result.assets[0];
    const inspected = await inspectBackup(asset.uri, asset.name);
    return { uri: asset.uri, fileName: asset.name, preview: inspected.preview };
  };

  const restoreBackup = async (selection: BackupSelection) => {
    const result = await restoreBackupFile(selection.uri, selection.fileName, {
      currentLibrary: library,
      currentPrefs: prefs,
      currentAISettings: aiSettings,
      currentBookmarks: bookmarks,
      currentConversations: conversations,
      saveBook,
    });
    setLibrary(result.library);
    setPrefs(result.prefs);
    setAiSettings(result.aiSettings);
    setBookmarks(result.bookmarks);
    setConversations(result.conversations);
    await Promise.all([
      saveLibrary(result.library),
      savePrefs(result.prefs),
      saveAISettings(result.aiSettings),
      saveBookmarks(result.bookmarks),
      saveConversations(result.conversations),
    ]);
    return result;
  };

  if (!ready) return <Splash />;

  return (
    <SafeAreaProvider>
      <View style={styles.app}>
        {screen === 'library' ? (
          <LibraryScreen library={library} palette={getReaderPalette(prefs.theme)} importing={importing} openingBookId={openingBookId} onImport={importBook} onOpen={openBook} onRemove={removeBook} onSettings={() => setSettingsOpen(true)} onData={() => setDataOpen(true)} />
        ) : book ? (
          <ReaderScreen
            book={book}
            summary={library.find((item) => item.id === book.id) ?? summarizeBook(book)}
            prefs={prefs}
            aiSettings={aiSettings}
            bookmarks={bookmarks.filter((item) => item.bookId === book.id)}
            conversations={conversations.filter((item) => item.bookId === book.id)}
            onBack={() => { setScreen('library'); setBook(null); }}
            onPrefs={async (value) => { setPrefs(value); await savePrefs(value); }}
            onProgress={(chapter, paragraph, locator) => updateProgress(book.id, chapter, paragraph, book, locator)}
            onAISettings={() => setSettingsOpen(true)}
            onBookmarksChange={async (nextBookBookmarks) => {
              const next = [...bookmarks.filter((item) => item.bookId !== book.id), ...nextBookBookmarks];
              setBookmarks(next);
              await saveBookmarks(next);
            }}
            onConversationSave={async (conversation) => {
              const index = conversations.findIndex((item) => item.id === conversation.id);
              const next = index >= 0 ? conversations.map((item) => item.id === conversation.id ? conversation : item) : [...conversations, conversation];
              setConversations(next);
              await saveConversations(next);
            }}
            onConversationDelete={async (id) => {
              const next = conversations.filter((item) => item.id !== id);
              setConversations(next);
              await saveConversations(next);
            }}
          />
        ) : null}
        <AISettingsModal visible={settingsOpen} value={aiSettings} palette={getReaderPalette(prefs.theme)} onClose={() => setSettingsOpen(false)} onAutoSave={async (value) => { setAiSettings(value); await saveAISettings(value); }} onSave={async (value) => { setAiSettings(value); await saveAISettings(value); setSettingsOpen(false); }} />
        <DataBackupModal visible={dataOpen} palette={getReaderPalette(prefs.theme)} bookCount={library.length} bookmarkCount={bookmarks.length} messageCount={conversations.reduce((sum, item) => sum + item.messages.length, 0)} onClose={() => setDataOpen(false)} onExport={exportBackup} onPickBackup={pickBackup} onRestore={restoreBackup} />
      </View>
    </SafeAreaProvider>
  );
}
