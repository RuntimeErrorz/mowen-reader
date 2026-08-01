import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StatusBar as NativeStatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Markdown from 'react-native-markdown-display';
import Slider from '@react-native-community/slider';
import { FoliateBookmarkSelection, FoliateLocation, FoliateLongPress, FoliateReader, FoliateReaderHandle, FoliateTOCItem } from './src/FoliateReader';
import { askAI, AIIntent } from './src/ai';
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
  saveBook,
  saveLibrary,
  savePrefs,
  summarizeBook,
} from './src/storage';
import { AIConversation, AIMessage, AISettings, Book, Bookmark, BookSummary, EpubLocator, ReaderPrefs } from './src/types';

const C = {
  ink: '#132E35',
  ink2: '#203D42',
  sea: '#63AAA5',
  seaPale: '#C6DDDA',
  paper: '#E9ECE5',
  text: '#172A2D',
  muted: '#65767A',
  line: '#CBD2CC',
  white: '#F8FAF6',
  ember: '#D8895B',
};

const BOOK_COVER_ASPECT_RATIO = 0.71;

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
        Alert.alert(
          '需要重新导入一次',
          '这本书是旧版本导入的，书库里没有保留原始 EPUB。请重新导入同一本书；阅读进度会保留，之后将由 Foliate 排版。'
        );
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
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/epub+zip', 'application/octet-stream'],
        copyToCacheDirectory: true,
      });
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
    const next = library.map((item) => item.id === id ? {
      ...item,
      currentChapter: chapter,
      currentParagraph: paragraph,
      progress: locator?.locations?.totalProgression ?? Math.min(1, (blocksBefore + paragraph + 1) / Math.max(1, totalBlocks)),
      lastReadAt: Date.now(),
      locator: locator ?? item.locator,
    } : item);
    setLibrary(next);
    await saveLibrary(next);
  };

  const removeBook = (item: BookSummary) => {
    Alert.alert('移出书架？', `“${item.title}”的阅读进度也会删除。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '移出', style: 'destructive', onPress: async () => {
          await deleteBookFile(item.id);
          const next = library.filter((bookItem) => bookItem.id !== item.id);
          setLibrary(next);
          await saveLibrary(next);
        },
      },
    ]);
  };

  if (!ready) return <Splash />;

  return (
    <SafeAreaProvider>
      <View style={styles.app}>
        <StatusBar style={screen === 'library' ? 'light' : prefs.theme === 'night' ? 'light' : 'dark'} />
        {screen === 'library' ? (
          <LibraryScreen
            library={library}
            palette={getReaderPalette(prefs.theme)}
            importing={importing}
            openingBookId={openingBookId}
            onImport={importBook}
            onOpen={openBook}
            onRemove={removeBook}
            onSettings={() => setSettingsOpen(true)}
          />
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
              const next = index >= 0
                ? conversations.map((item) => item.id === conversation.id ? conversation : item)
                : [...conversations, conversation];
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
        <AISettingsModal
          visible={settingsOpen}
          value={aiSettings}
          palette={getReaderPalette(prefs.theme)}
          onClose={() => setSettingsOpen(false)}
          onAutoSave={async (value) => { setAiSettings(value); await saveAISettings(value); }}
          onSave={async (value) => { setAiSettings(value); await saveAISettings(value); setSettingsOpen(false); }}
        />
      </View>
    </SafeAreaProvider>
  );
}

function Splash() {
  return (
    <View style={styles.splash}>
      <StatusBar style="light" />
      <View style={styles.mark}><Text style={styles.markText}>墨</Text></View>
      <Text style={styles.splashName}>墨问</Text>
      <Text style={styles.splashTag}>读到深处，自有回声</Text>
    </View>
  );
}

function LibraryScreen(props: {
  library: BookSummary[];
  palette: ReaderPalette;
  importing: boolean;
  openingBookId: string | null;
  onImport: () => void;
  onOpen: (book: BookSummary) => void;
  onRemove: (book: BookSummary) => void;
  onSettings: () => void;
}) {
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.library, { backgroundColor: props.palette.bg }]}>
      <NativeStatusBar backgroundColor={props.palette.bg} barStyle={props.palette.bg === '#142428' ? 'light-content' : 'dark-content'} />
      <View style={styles.libraryHeader}>
        <View>
          <Text style={[styles.eyebrow, { color: props.palette.accent }]}>MÒ WÈN · READER</Text>
          <Text style={[styles.libraryTitle, { color: props.palette.text }]}>墨问</Text>
        </View>
        <Pressable accessibilityLabel="AI 设置" onPress={props.onSettings} style={({ pressed }) => [styles.iconButtonDark, { borderColor: props.palette.line, backgroundColor: props.palette.surfaceAlt }, pressed && styles.pressed]}>
          <Ionicons name="options-outline" size={22} color={props.palette.text} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.libraryScroll} showsVerticalScrollIndicator={false}>
        <View style={styles.sectionHead}>
          <Text style={[styles.sectionTitle, { color: props.palette.text }]}>书架</Text>
          <Text style={[styles.sectionCount, { color: props.palette.muted }]}>{props.library.length} 本</Text>
        </View>
        <View style={styles.bookGrid}>
          {props.library.map((item, index) => (
            <BookTile palette={props.palette} key={item.id} item={item} index={index} loading={props.openingBookId === item.id} disabled={!!props.openingBookId} onOpen={() => props.onOpen(item)} onRemove={() => props.onRemove(item)} />
          ))}
          <View style={styles.addTileWrap}>
            <Pressable onPress={props.onImport} style={({ pressed }) => [styles.addTile, { borderColor: props.palette.line, backgroundColor: props.palette.surface }, pressed && styles.cardPressed]}>
              {props.importing ? <ActivityIndicator color={props.palette.accent} /> : <Ionicons name="add" size={30} color={props.palette.accent} />}
              <Text style={[styles.addText, { color: props.palette.accent }]}>{props.importing ? '正在导入…' : '导入 EPUB'}</Text>
              <Text style={[styles.addHint, { color: props.palette.muted }]}>文件仅保存在本机</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function BookTile({ palette, item, index, loading, disabled, onOpen, onRemove }: { palette: ReaderPalette; item: BookSummary; index: number; loading: boolean; disabled: boolean; onOpen: () => void; onRemove: () => void }) {
  const covers = [
    ['#8DA9A6', '#355B61'], ['#A5A797', '#4E554F'], ['#B58D73', '#654B42'], ['#78919E', '#354D59'],
  ];
  const colors = covers[index % covers.length] as [string, string];
  return (
    <View style={styles.bookTileWrap}>
      <Pressable disabled={disabled} onPress={onOpen} onLongPress={onRemove} style={({ pressed }) => [styles.bookTile, pressed && styles.cardPressed]}>
        {item.cover ? <Image source={{ uri: item.cover }} style={styles.coverImage} /> : (
          <LinearGradient colors={colors} style={styles.coverFallback}>
            <View style={styles.coverLine} />
            <Text numberOfLines={4} style={styles.coverTitle}>{item.title}</Text>
            <Text numberOfLines={1} style={styles.coverAuthor}>{item.author}</Text>
            <Text style={styles.coverSeal}>墨问</Text>
          </LinearGradient>
        )}
        {loading && <View style={styles.bookOpening}><ActivityIndicator color={C.white} /></View>}
        {item.progress > 0 && <View style={styles.bookProgress}><View style={[styles.bookProgressFill, { width: `${item.progress * 100}%` }]} /></View>}
      </Pressable>
      <Text numberOfLines={1} style={[styles.tileTitle, { color: palette.text }]}>{item.title}</Text>
      <Text numberOfLines={1} style={[styles.tileAuthor, { color: palette.muted }]}>{item.author}</Text>
    </View>
  );
}

type ReaderScreenProps = {
  book: Book;
  summary: BookSummary;
  prefs: ReaderPrefs;
  aiSettings: AISettings;
  bookmarks: Bookmark[];
  conversations: AIConversation[];
  onBack: () => void;
  onPrefs: (value: ReaderPrefs) => void;
  onProgress: (chapter: number, paragraph: number, locator?: EpubLocator) => void;
  onAISettings: () => void;
  onBookmarksChange: (bookmarks: Bookmark[]) => void;
  onConversationSave: (conversation: AIConversation) => void;
  onConversationDelete: (id: string) => void;
};

function FoliateReaderScreen(props: ReaderScreenProps & { epubUri: string }) {
  const palette = useMemo(() => getReaderPalette(props.prefs.theme), [props.prefs.theme]);
  const readerRef = useRef<FoliateReaderHandle>(null);
  const initialCfi = useRef(props.summary.locator?.type === 'application/epub+cfi' ? props.summary.locator.href : undefined);
  const [toc, setToc] = useState<FoliateTOCItem[]>([]);
  const [location, setLocation] = useState<FoliateLocation | undefined>();
  const [chapterIndex, setChapterIndex] = useState(Math.min(props.summary.currentChapter, props.book.chapters.length - 1));
  const [paragraphIndex, setParagraphIndex] = useState(props.summary.currentParagraph);
  const [tocOpen, setTocOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [bookmarkSelecting, setBookmarkSelecting] = useState(false);
  const [bookmarkSelection, setBookmarkSelection] = useState<FoliateBookmarkSelection | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiSelection, setAiSelection] = useState('');
  const [aiImage, setAiImage] = useState('');
  const [aiLocator, setAiLocator] = useState<EpubLocator | undefined>();
  const [activeHistory, setActiveHistory] = useState<AIConversation | null>(null);
  const [chromeVisible, setChromeVisible] = useState(false);
  const [dragProgress, setDragProgress] = useState<number | null>(null);
  const [readerNavigation, setReaderNavigation] = useState({ canGoBack: false, noteOpen: false });
  const chromeAnim = useRef(new Animated.Value(0)).current;
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressPreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressPreviewValue = useRef(props.summary.progress);
  const progressDragStart = useRef({ x: 0, value: props.summary.progress });
  const progressDraft = useRef(props.summary.progress);
  const progressDragging = useRef(false);
  const { width: windowWidth } = useWindowDimensions();

  const mapLocation = useCallback((next: FoliateLocation) => {
    const normalizedTitle = next.title?.replace(/\s+/g, ' ').trim();
    const tocIndex = normalizedTitle ? Math.max(0, toc.findIndex((item) => item.label.replace(/\s+/g, ' ').trim() === normalizedTitle)) : Math.max(0, next.sectionIndex);
    const tocTitle = normalizedTitle || toc[tocIndex]?.label.replace(/\s+/g, ' ').trim();
    let mappedChapter = tocTitle ? props.book.chapters.findIndex((chapter) => chapter.title.replace(/\s+/g, ' ').trim() === tocTitle) : -1;
    if (mappedChapter < 0) mappedChapter = Math.min(props.book.chapters.length - 1, Math.max(0, next.sectionIndex));
    const mappedParagraph = Math.min(
      Math.max(0, props.book.chapters[mappedChapter]?.paragraphs.length - 1),
      Math.max(0, Math.round(next.sectionProgression * Math.max(0, (props.book.chapters[mappedChapter]?.paragraphs.length ?? 1) - 1)))
    );
    return { chapter: mappedChapter, paragraph: mappedParagraph, tocIndex };
  }, [props.book.chapters, toc]);

  const handleLocationChange = useCallback((next: FoliateLocation) => {
    setLocation(next);
    const mapped = mapLocation(next);
    setChapterIndex(mapped.chapter);
    setParagraphIndex(mapped.paragraph);
    if (!progressDragging.current) progressDraft.current = next.progression;
    const locator: EpubLocator = {
      href: next.cfi,
      type: 'application/epub+cfi',
      title: next.title,
      locations: { progression: next.sectionProgression, position: next.position, totalProgression: next.progression },
    };
    if (!progressDragging.current) {
      if (progressTimer.current) clearTimeout(progressTimer.current);
      progressTimer.current = setTimeout(() => props.onProgress(mapped.chapter, mapped.paragraph, locator), 350);
    }
  }, [mapLocation, props.onProgress]);

  const handleLongPress = useCallback((selection: FoliateLongPress) => {
    let nextChapter = chapterIndex;
    let nextParagraph = paragraphIndex;
    if (!location || selection.sectionIndex !== location.sectionIndex) {
      nextChapter = Math.min(props.book.chapters.length - 1, Math.max(0, selection.sectionIndex));
      nextParagraph = 0;
    }
    if (selection.kind === 'text' && selection.text.trim()) {
      const needle = selection.text.replace(/\s+/g, '').slice(0, 80);
      const candidates = [nextChapter, ...props.book.chapters.map((_item, index) => index).filter((index) => index !== nextChapter)];
      for (const candidate of candidates) {
        const found = props.book.chapters[candidate]?.paragraphs.findIndex((paragraph) => {
          const normalized = paragraph.replace(/\[\[MOWEN_[^\]]+\]\]/g, '').replace(/\s+/g, '');
          return !!needle && (normalized.includes(needle) || needle.includes(normalized.slice(0, 80)));
        }) ?? -1;
        if (found >= 0) { nextChapter = candidate; nextParagraph = found; break; }
      }
    }
    setChapterIndex(nextChapter);
    setParagraphIndex(Math.min(Math.max(0, props.book.chapters[nextChapter]?.paragraphs.length - 1), nextParagraph));
    setAiSelection(selection.text);
    setAiImage(selection.kind === 'image' ? selection.imageData || '' : '');
    setAiLocator({
      href: selection.cfi || location?.cfi || '',
      type: 'application/epub+cfi',
      title: location?.title,
      locations: {
        progression: location?.sectionProgression ?? 0,
        position: location?.position,
        totalProgression: location?.progression,
      },
      text: selection.kind === 'text' ? { highlight: selection.text } : undefined,
    });
    setChromeVisible(false);
    chromeAnim.setValue(0);
    setAiOpen(true);
  }, [chapterIndex, chromeAnim, location, paragraphIndex, props.book.chapters]);

  useEffect(() => () => {
    if (progressTimer.current) clearTimeout(progressTimer.current);
    if (progressPreviewTimer.current) clearTimeout(progressPreviewTimer.current);
  }, []);
  const exactProgress = dragProgress ?? location?.progression ?? props.summary.progress;
  const currentToc = Math.max(0, location?.title ? toc.findIndex((item) => item.label.replace(/\s+/g, ' ').trim() === location.title?.replace(/\s+/g, ' ').trim()) : location?.sectionIndex ?? 0);
  const chapter = props.book.chapters[chapterIndex] ?? props.book.chapters[0];

  const toggleChrome = () => {
    if (progressDragging.current) return;
    const next = !chromeVisible;
    setChromeVisible(next);
    chromeAnim.setValue(next ? 1 : 0);
  };
  const goToProgress = (value: number) => {
    readerRef.current?.goToFraction(value);
  };
  const beginProgressDrag = (pageX: number) => {
    const value = location?.progression ?? props.summary.progress;
    progressDragging.current = true;
    setChromeVisible(true);
    chromeAnim.setValue(1);
    progressDragStart.current = { x: pageX, value };
    progressDraft.current = value;
    progressPreviewValue.current = value;
    setDragProgress(value);
  };
  const moveProgressDrag = (pageX: number) => {
    const value = Math.max(0, Math.min(1, progressDragStart.current.value + (pageX - progressDragStart.current.x) / Math.max(180, windowWidth - 72)));
    progressDraft.current = value;
    progressPreviewValue.current = value;
    setDragProgress(value);
    if (!progressPreviewTimer.current) {
      progressPreviewTimer.current = setTimeout(() => {
        progressPreviewTimer.current = null;
        readerRef.current?.previewFraction(progressPreviewValue.current);
      }, 70);
    }
  };
  const finishProgressDrag = () => {
    if (progressPreviewTimer.current) {
      clearTimeout(progressPreviewTimer.current);
      progressPreviewTimer.current = null;
    }
    goToProgress(progressDraft.current);
    setDragProgress(null);
    requestAnimationFrame(() => { progressDragging.current = false; });
  };
  const chooseToc = (index: number) => {
    const link = toc[index];
    if (link?.href) readerRef.current?.goTo(link.href);
    setTocOpen(false);
  };
  const goToChapter = (index: number) => {
    const title = props.book.chapters[index]?.title.replace(/\s+/g, ' ').trim();
    const link = toc.find((item) => item.label.replace(/\s+/g, ' ').trim() === title) ?? toc[index];
    if (link?.href) readerRef.current?.goTo(link.href);
  };
  const cancelBookmarkSelection = () => {
    readerRef.current?.endBookmarkSelection();
    setBookmarkSelecting(false);
    setBookmarkSelection(null);
  };
  const saveBookmarkSelection = () => {
    if (!bookmarkSelection?.cfi || !bookmarkSelection.text.trim()) return;
    let nextChapter = Math.min(props.book.chapters.length - 1, Math.max(0, bookmarkSelection.sectionIndex));
    let nextParagraph = 0;
    const needle = bookmarkSelection.text.replace(/\s+/g, '').slice(0, 80);
    const candidates = [nextChapter, ...props.book.chapters.map((_item, index) => index).filter((index) => index !== nextChapter)];
    for (const candidate of candidates) {
      const found = props.book.chapters[candidate]?.paragraphs.findIndex((paragraph) => paragraph.replace(/\[\[MOWEN_[^\]]+\]\]/g, '').replace(/\s+/g, '').includes(needle)) ?? -1;
      if (found >= 0) { nextChapter = candidate; nextParagraph = found; break; }
    }
    const selectedChapter = props.book.chapters[nextChapter] ?? chapter;
    const excerpt = bookmarkSelection.text.replace(/\s+/g, ' ').trim().slice(0, 240);
    const bookmarkLocator: EpubLocator = {
      href: bookmarkSelection.cfi,
      type: 'application/epub+cfi',
      title: location?.title,
      locations: { progression: location?.sectionProgression ?? 0, position: location?.position, totalProgression: location?.progression },
      text: { highlight: excerpt },
    };
    const nextBookmarks = [...props.bookmarks, {
      id: `bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      bookId: props.book.id,
      chapterIndex: nextChapter,
      paragraphIndex: nextParagraph,
      sectionIndex: bookmarkSelection.sectionIndex,
      chapterTitle: selectedChapter.title,
      excerpt,
      locator: bookmarkLocator,
      createdAt: Date.now(),
    }];
    console.log('[MOWEN_BOOKMARK] add count=' + nextBookmarks.length);
    readerRef.current?.setBookmarks(nextBookmarks);
    props.onBookmarksChange(nextBookmarks);
    cancelBookmarkSelection();
  };
  const deleteBookmark = (bookmark: Bookmark) => {
    const nextBookmarks = props.bookmarks.filter((item) => item.id !== bookmark.id);
    console.log('[MOWEN_BOOKMARK] delete count=' + nextBookmarks.length);
    readerRef.current?.setBookmarks(nextBookmarks);
    props.onBookmarksChange(nextBookmarks);
  };
  const openConversation = (conversation: AIConversation) => {
    if (conversation.locator?.type === 'application/epub+cfi' && conversation.locator.href) {
      readerRef.current?.goTo(conversation.locator.href);
    } else {
      const total = props.book.chapters.reduce((sum, item) => sum + Math.max(1, item.paragraphs.length), 0);
      const before = props.book.chapters.slice(0, conversation.chapterIndex).reduce((sum, item) => sum + Math.max(1, item.paragraphs.length), 0);
      const chapterSize = Math.max(1, props.book.chapters[conversation.chapterIndex]?.paragraphs.length ?? 1);
      readerRef.current?.goToFraction(Math.max(0, Math.min(1, (before + Math.min(conversation.paragraphIndex, chapterSize - 1)) / Math.max(1, total))));
    }
    setBookmarksOpen(false);
    setTimeout(() => setActiveHistory(conversation), 100);
  };
  const closeConversation = useCallback(() => {
    setActiveHistory(null);
    readerRef.current?.back();
  }, []);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (bookmarkSelecting) { cancelBookmarkSelection(); return true; }
      if (readerNavigation.noteOpen) {
        readerRef.current?.back();
        return true;
      }
      if (activeHistory) { closeConversation(); return true; }
      if (aiOpen) { setAiOpen(false); return true; }
      if (bookmarksOpen) { setBookmarksOpen(false); return true; }
      if (typeOpen) { setTypeOpen(false); return true; }
      if (tocOpen) { setTocOpen(false); return true; }
      if (chromeVisible) {
        setChromeVisible(false);
        chromeAnim.setValue(0);
        return true;
      }
      if (readerNavigation.canGoBack) {
        readerRef.current?.back();
        return true;
      }
      props.onBack();
      return true;
    });
    return () => subscription.remove();
  }, [activeHistory, aiOpen, bookmarkSelecting, bookmarksOpen, chromeAnim, chromeVisible, closeConversation, props.onBack, readerNavigation.canGoBack, readerNavigation.noteOpen, tocOpen, typeOpen]);

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={[styles.reader, { backgroundColor: palette.bg }]}>
      <NativeStatusBar backgroundColor={palette.bg} barStyle={props.prefs.theme === 'night' ? 'light-content' : 'dark-content'} />
      <FoliateReader
        ref={readerRef}
        epubUri={props.epubUri}
        title={props.book.title}
        bookmarks={props.bookmarks}
        prefs={props.prefs}
        palette={palette}
        initialCfi={initialCfi.current}
        initialProgress={props.summary.progress}
        onReady={setToc}
        onLocationChange={handleLocationChange}
        onCenterTap={toggleChrome}
        onLongPress={handleLongPress}
        onBookmarkSelection={setBookmarkSelection}
        onBookmarkSelectionModeChange={(active) => {
          setBookmarkSelecting(active);
          if (!active) setBookmarkSelection(null);
          if (active) { setChromeVisible(false); chromeAnim.setValue(0); }
        }}
        onNavigationStateChange={setReaderNavigation}
        onError={(message) => Alert.alert('Foliate 无法打开 EPUB', message)}
      />
      {!!location && !chromeVisible && !readerNavigation.noteOpen && (
        <Text pointerEvents="none" style={{ position: 'absolute', right: Math.max(16, props.prefs.pagePaddingRight), bottom: 16, color: palette.muted, fontSize: 11 }}>
          {location.position} / {location.totalPositions}
        </Text>
      )}
      {!readerNavigation.noteOpen && (
        <ReaderToolbar
          visible={chromeVisible}
          animation={chromeAnim}
          palette={palette}
          progress={exactProgress}
          chapter={chapterIndex}
          chapterCount={Math.max(1, toc.length || props.book.chapters.length)}
          marginCount={props.bookmarks.length + props.conversations.length}
          onBack={props.onBack}
          onContents={() => setTocOpen(true)}
          onAppearance={() => setTypeOpen(true)}
          onMargins={() => setBookmarksOpen(true)}
          onProgressStart={beginProgressDrag}
          onProgressMove={moveProgressDrag}
          onProgressEnd={finishProgressDrag}
        />
      )}
      {bookmarkSelecting && !readerNavigation.noteOpen && (
        <View style={styles.bookmarkSelectionActions}>
          <Pressable accessibilityLabel="取消摘录" onPress={cancelBookmarkSelection} style={[styles.bookmarkSelectionButton, { backgroundColor: palette.control, borderColor: palette.line }]}><Text style={[styles.bookmarkSelectionButtonText, { color: palette.muted }]}>取消</Text></Pressable>
          <Pressable accessibilityLabel="保存摘录书签" disabled={!bookmarkSelection?.cfi} onPress={saveBookmarkSelection} style={[styles.bookmarkSelectionButton, { backgroundColor: palette.accent, borderColor: palette.accent }, !bookmarkSelection?.cfi && { opacity: 0.4 }]}><Text style={[styles.bookmarkSelectionButtonText, { color: palette.onAccent }]}>标记</Text></Pressable>
        </View>
      )}
      {dragProgress !== null && !readerNavigation.noteOpen && (
        <View pointerEvents="none" style={[styles.liveProgressCard, { backgroundColor: palette.bar, borderColor: palette.line }]}>
          <View style={styles.liveProgressTop}><Text style={[styles.liveProgressLabel, { color: palette.accent }]}>全书进度</Text><Text style={[styles.liveProgressPercent, { color: palette.text }]}>{Math.round(dragProgress * 100)}%</Text></View>
          <Text numberOfLines={1} style={[styles.liveProgressChapter, { color: palette.text }]}>{chapter.title}</Text>
          <View style={[styles.liveProgressTrack, { backgroundColor: palette.line }]}><View style={[styles.liveProgressFill, { backgroundColor: palette.accent, width: `${dragProgress * 100}%` }]} /></View>
          <Text style={[styles.liveProgressHint, { color: palette.muted }]}>左右拖动预览，松手跳转</Text>
        </View>
      )}
      <TOCModal palette={palette} visible={tocOpen} chapters={(toc.length ? toc.map((item) => `${'　'.repeat(item.depth)}${item.label}`) : props.book.chapters.map((item) => item.title))} current={currentToc} onChoose={chooseToc} onClose={() => setTocOpen(false)} />
      <TypeModal visible={typeOpen} value={props.prefs} onChange={props.onPrefs} onClose={() => setTypeOpen(false)} />
      <AIPanel
        visible={aiOpen}
        bookId={props.book.id}
        chapterIndex={chapterIndex}
        bookTitle={props.book.title}
        bookAuthor={props.book.author}
        bookDescription={props.book.description}
        chapter={chapter}
        paragraphIndex={paragraphIndex}
        selectedText={aiSelection}
        selectedImage={aiImage}
        locator={aiLocator}
        settings={props.aiSettings}
        palette={palette}
        onSaveConversation={props.onConversationSave}
        onSettings={() => { setAiOpen(false); props.onAISettings(); }}
        onClose={() => setAiOpen(false)}
      />
      <BookmarksModal
        visible={bookmarksOpen}
        bookmarks={props.bookmarks}
        chapterTitle={chapter.title}
        paragraphIndex={paragraphIndex}
        onChoose={(bookmark) => { setBookmarksOpen(false); if (bookmark.locator?.type === 'application/epub+cfi') readerRef.current?.goTo(bookmark.locator.href); else goToChapter(bookmark.chapterIndex); }}
        onDelete={deleteBookmark}
        conversations={props.conversations}
        onChooseConversation={openConversation}
        onDeleteConversation={props.onConversationDelete}
        onClose={() => setBookmarksOpen(false)}
        palette={palette}
      />
      <ConversationViewerModal
        conversation={activeHistory}
        book={props.book}
        settings={props.aiSettings}
        palette={palette}
        onUpdate={(conversation) => { setActiveHistory(conversation); props.onConversationSave(conversation); }}
        onReturn={closeConversation}
        onStay={() => setActiveHistory(null)}
      />
    </SafeAreaView>
  );
}

function ReaderScreen(props: ReaderScreenProps) {
  if (!props.book.epubUri) return null;
  return <FoliateReaderScreen {...props} epubUri={props.book.epubUri} />;
}

function TOCModal({ palette, visible, chapters, current, onChoose, onClose }: { palette: ReaderPalette; visible: boolean; chapters: string[]; current: number; onChoose: (index: number) => void; onClose: () => void }) {
  const listRef = useRef<FlatList<string>>(null);
  useEffect(() => {
    if (!visible || !chapters.length) return;
    const timer = setTimeout(() => listRef.current?.scrollToIndex({ index: Math.min(current, chapters.length - 1), viewPosition: 0.35, animated: false }), 80);
    return () => clearTimeout(timer);
  }, [visible, current, chapters.length]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <DraggableSheet visible={visible} onClose={onClose} palette={palette}>
        <View style={styles.sheetHeader}><View><Text style={[styles.sheetEyebrow, { color: palette.accent }]}>CONTENTS</Text><Text style={[styles.sheetTitle, { color: palette.text }]}>目录</Text></View><Pressable onPress={onClose} style={[styles.closeButton, { backgroundColor: palette.surfaceAlt }]}><Ionicons name="close" size={20} color={palette.text} /></Pressable></View>
        <FlatList
          ref={listRef}
          style={styles.tocList}
          data={chapters}
          keyExtractor={(title, index) => `${title}-${index}`}
          getItemLayout={(_data, index) => ({ length: 60, offset: 60 * index, index })}
          initialScrollIndex={Math.min(current, Math.max(0, chapters.length - 1))}
          onScrollToIndexFailed={(info) => listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false })}
          renderItem={({ item: title, index }) => (
            <Pressable onPress={() => onChoose(index)} style={[styles.tocItem, { borderBottomColor: palette.line }, index === current && { backgroundColor: palette.focus, marginHorizontal: -8, paddingHorizontal: 16, borderBottomWidth: 0 }]}>
              <Text style={[styles.tocNumber, { color: index === current ? palette.accent : palette.muted }]}>{String(index + 1).padStart(2, '0')}</Text>
              <Text numberOfLines={2} style={[styles.tocTitle, { color: index === current ? palette.accent : palette.text }]}>{title}</Text>
              {index === current && <View style={[styles.currentDot, { backgroundColor: palette.accent }]} />}
            </Pressable>
          )}
          ListFooterComponent={<View style={{ height: 30 }} />}
        />
      </DraggableSheet>
    </Modal>
  );
}

function BookmarksModal(props: {
  palette: ReaderPalette;
  visible: boolean;
  bookmarks: Bookmark[];
  chapterTitle: string;
  paragraphIndex: number;
  onChoose: (bookmark: Bookmark) => void;
  onDelete: (bookmark: Bookmark) => void;
  conversations: AIConversation[];
  onChooseConversation: (conversation: AIConversation) => void;
  onDeleteConversation: (id: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'bookmarks' | 'conversations'>('bookmarks');
  const ordered = [...props.bookmarks].sort((a, b) => a.chapterIndex - b.chapterIndex || a.paragraphIndex - b.paragraphIndex);
  const orderedConversations = [...props.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose}>
      <DraggableSheet visible={props.visible} onClose={props.onClose} palette={props.palette} style={styles.bookmarksSheet}>
        <View style={styles.sheetHeader}>
          <View><Text style={[styles.sheetEyebrow, { color: props.palette.accent }]}>MARGINALIA</Text><Text style={[styles.sheetTitle, { color: props.palette.text }]}>页边</Text></View>
          <Pressable onPress={props.onClose} style={[styles.closeButton, { backgroundColor: props.palette.surfaceAlt }]}><Ionicons name="close" size={20} color={props.palette.text} /></Pressable>
        </View>
        <View style={[styles.marginTabs, { borderBottomColor: props.palette.line }]}>
          <Pressable onPress={() => setTab('bookmarks')} style={[styles.marginTab, tab === 'bookmarks' && { borderBottomColor: props.palette.accent }]}><Text style={[styles.marginTabText, { color: tab === 'bookmarks' ? props.palette.accent : props.palette.muted }, tab === 'bookmarks' && styles.marginTabTextActive]}>书签 {props.bookmarks.length}</Text></Pressable>
          <Pressable onPress={() => setTab('conversations')} style={[styles.marginTab, tab === 'conversations' && { borderBottomColor: props.palette.accent }]}><Text style={[styles.marginTabText, { color: tab === 'conversations' ? props.palette.accent : props.palette.muted }, tab === 'conversations' && styles.marginTabTextActive]}>AI 对话 {props.conversations.length}</Text></Pressable>
        </View>
        {tab === 'bookmarks' ? <>
        <FlatList
          data={ordered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={ordered.length ? styles.bookmarksList : styles.bookmarksEmptyList}
          ListEmptyComponent={<View style={styles.bookmarksEmpty}><Ionicons name="bookmark-outline" size={29} color={props.palette.muted} /><Text style={[styles.bookmarksEmptyTitle, { color: props.palette.text }]}>还没有书签</Text><Text style={[styles.bookmarksEmptyText, { color: props.palette.muted }]}>滚动到想留下的位置，再点击上方添加。</Text></View>}
          renderItem={({ item }) => (
            <Pressable onPress={() => props.onChoose(item)} style={({ pressed }) => [styles.bookmarkItem, { borderBottomColor: props.palette.line }, pressed && styles.pressed]}>
              <View style={styles.bookmarkRail}><View style={[styles.bookmarkDot, { backgroundColor: props.palette.accent }]} /><View style={[styles.bookmarkLine, { backgroundColor: props.palette.line }]} /></View>
              <View style={styles.bookmarkContent}>
                <Text numberOfLines={1} style={[styles.bookmarkChapter, { color: props.palette.accent }]}>{item.chapterTitle}</Text>
                <Text style={[styles.bookmarkLocation, { color: props.palette.muted }]}>第 {item.chapterIndex + 1} 章 · 位置 {item.paragraphIndex + 1}</Text>
                <Text numberOfLines={3} style={[styles.bookmarkExcerpt, { color: props.palette.text }]}>{item.excerpt}</Text>
              </View>
              <Pressable accessibilityLabel="删除书签" onPress={(event) => { event.stopPropagation(); props.onDelete(item); }} style={styles.bookmarkDelete}><Ionicons name="close" size={17} color={props.palette.muted} /></Pressable>
            </Pressable>
          )}
        />
        </> : <FlatList
          data={orderedConversations}
          keyExtractor={(item) => item.id}
          contentContainerStyle={orderedConversations.length ? styles.bookmarksList : styles.bookmarksEmptyList}
          ListEmptyComponent={<View style={styles.bookmarksEmpty}><Ionicons name="sparkles-outline" size={29} color={props.palette.muted} /><Text style={[styles.bookmarksEmptyTitle, { color: props.palette.text }]}>还没有 AI 对话</Text><Text style={[styles.bookmarksEmptyText, { color: props.palette.muted }]}>长按正文提问后，对话会留在对应页边。</Text></View>}
          renderItem={({ item }) => {
            const firstQuestion = item.messages.find((message) => message.role === 'user')?.content ?? '阅读提问';
            const lastAnswer = [...item.messages].reverse().find((message) => message.role === 'assistant')?.content ?? '';
            return (
              <Pressable onPress={() => props.onChooseConversation(item)} style={({ pressed }) => [styles.conversationItem, { borderBottomColor: props.palette.line }, pressed && styles.pressed]}>
                <View style={[styles.conversationSpark, { backgroundColor: props.palette.accent }]}><Ionicons name="sparkles" size={14} color={props.palette.onAccent} /></View>
                <View style={styles.bookmarkContent}>
                  <Text numberOfLines={1} style={[styles.bookmarkChapter, { color: props.palette.accent }]}>{item.chapterTitle}</Text>
                  <Text style={[styles.bookmarkLocation, { color: props.palette.muted }]}>第 {item.chapterIndex + 1} 章 · 位置 {item.paragraphIndex + 1} · {item.messages.length / 2} 轮</Text>
                  <Text numberOfLines={1} style={[styles.conversationQuestion, { color: props.palette.text }]}>{firstQuestion}</Text>
                  <Text numberOfLines={2} style={[styles.bookmarkExcerpt, { color: props.palette.text }]}>{lastAnswer.replace(/[#*_>`]/g, '')}</Text>
                </View>
                <Pressable accessibilityLabel="删除对话" onPress={(event) => { event.stopPropagation(); props.onDeleteConversation(item.id); }} style={styles.bookmarkDelete}><Ionicons name="close" size={17} color={props.palette.muted} /></Pressable>
              </Pressable>
            );
          }}
        />}
      </DraggableSheet>
    </Modal>
  );
}

function ConversationViewerModal(props: {
  conversation: AIConversation | null;
  book: Book;
  settings: AISettings;
  palette: ReaderPalette;
  onUpdate: (conversation: AIConversation) => void;
  onReturn: () => void;
  onStay: () => void;
}) {
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const translateY = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);
  const { height: windowHeight } = useWindowDimensions();
  useEffect(() => {
    if (!props.conversation) return;
    setMessages(props.conversation.messages);
    setQuestion(''); setError(''); setLoading(false);
    translateY.setValue(windowHeight);
    Animated.spring(translateY, { toValue: 0, useNativeDriver: true, speed: 24, bounciness: 2 }).start();
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 80);
  }, [props.conversation?.id]);
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (_event, gesture) => { if (gesture.dy > 0) translateY.setValue(gesture.dy); },
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dy > 95 || gesture.vy > 0.85) {
        const duration = Math.max(130, Math.min(260, 240 - Math.max(0, gesture.vy) * 70));
        Animated.timing(translateY, { toValue: windowHeight, duration, useNativeDriver: true }).start(props.onStay);
      } else Animated.spring(translateY, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 4 }).start();
    },
    onPanResponderTerminate: () => Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start(),
  }), [props.onStay, translateY, windowHeight]);
  if (!props.conversation) return null;
  const conversation = props.conversation;
  const scrimOpacity = translateY.interpolate({ inputRange: [0, Math.max(1, windowHeight * 0.7)], outputRange: [1, 0], extrapolate: 'clamp' });
  const chapter = props.book.chapters[conversation.chapterIndex];
  const continueConversation = async () => {
    const text = question.trim();
    if (!text || loading) return;
    if (!props.settings.apiKey.trim()) { setError('模型密钥不可用，请先在设置中配置。'); return; }
    setLoading(true); setError('');
    try {
      const answer = await askAI({
        settings: props.settings,
        bookTitle: props.book.title,
        bookAuthor: props.book.author,
        bookDescription: props.book.description,
        chapter,
        paragraphIndex: conversation.paragraphIndex,
        contextRadius: conversation.contextRadius,
        intent: 'question',
        question: text,
        history: messages,
      });
      const next: AIMessage[] = [...messages, { role: 'user', content: text }, { role: 'assistant', content: answer }];
      setMessages(next); setQuestion('');
      props.onUpdate({ ...conversation, messages: next, updatedAt: Date.now() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '继续对话失败');
    } finally { setLoading(false); }
  };
  return (
    <Modal visible transparent animationType="none" onRequestClose={props.onReturn}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalRoot}>
        <Animated.View style={[styles.scrim, { backgroundColor: props.palette.scrim, opacity: scrimOpacity }]}><Pressable style={StyleSheet.absoluteFill} onPress={props.onReturn} /></Animated.View>
        <Animated.View style={[styles.sheet, styles.conversationViewer, { backgroundColor: props.palette.surface, transform: [{ translateY }] }]}>
          <View style={styles.dragHandleZone} {...panResponder.panHandlers}>
            <SheetHandle color={props.palette.line} />
          </View>
          <View style={[styles.historyHeader, { borderBottomColor: props.palette.line }]}>
            <View style={[styles.historyTeleportMark, { backgroundColor: props.palette.accent }]}><Ionicons name="return-down-back" size={17} color={props.palette.onAccent} /></View>
            <View style={{ flex: 1 }}><Text style={[styles.historyMode, { color: props.palette.accent }]}>临时回看 · 拖动上方灰条可留在这里</Text><Text numberOfLines={1} style={[styles.historyChapter, { color: props.palette.text }]}>{conversation.chapterTitle}</Text></View>
            <Pressable onPress={props.onReturn} style={[styles.returnButton, { borderColor: props.palette.line }]}><Ionicons name="arrow-undo" size={16} color={props.palette.accent} /><Text style={[styles.returnButtonText, { color: props.palette.accent }]}>返回原处</Text></Pressable>
          </View>
          <View style={[styles.historyAnchor, { backgroundColor: props.palette.surfaceAlt, borderLeftColor: props.palette.accent }]}>
            <Text style={[styles.historyAnchorLabel, { color: props.palette.accent }]}>当时的原文 · 位置 {conversation.paragraphIndex + 1}</Text>
            <Text numberOfLines={3} style={[styles.historyAnchorText, { color: props.palette.text }]}>{conversation.anchorExcerpt}</Text>
          </View>
          <ScrollView ref={scrollRef} style={styles.historyScroll} contentContainerStyle={styles.historyMessages} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {messages.map((message, index) => message.role === 'user' ? (
              <View key={`${message.role}-${index}`} style={[styles.historyQuestionBlock, { backgroundColor: props.palette.focus }]}>
                <Text style={[styles.historyQuestionLabel, { color: props.palette.accent }]}>你问</Text><Text style={[styles.historyQuestionText, { color: props.palette.text }]}>{message.content}</Text>
              </View>
            ) : (
              <View key={`${message.role}-${index}`} style={[styles.historyAnswerBlock, { backgroundColor: props.palette.control, borderColor: props.palette.line }]}>
                <Text style={[styles.answerLabel, { color: props.palette.accent }]}>墨问批注</Text><Markdown style={{ ...markdownStyles, ...themedMarkdownStyles(props.palette) }}>{message.content}</Markdown>
              </View>
            ))}
            {loading && <View style={styles.historyThinking}><ActivityIndicator color={props.palette.accent} /><Text style={[styles.thinkingNote, { color: props.palette.muted }]}>沿着原对话继续思考…</Text></View>}
            {!!error && <Text style={[styles.historyError, { color: props.palette.text, backgroundColor: props.palette.surfaceAlt }]}>{error}</Text>}
            <Text style={[styles.historyEnd, { color: props.palette.muted }]}>这段对话留在此处 · {new Date(conversation.updatedAt).toLocaleString()}</Text>
          </ScrollView>
          <View style={[styles.historyComposer, { backgroundColor: props.palette.surface, borderTopColor: props.palette.line }]}>
            <TextInput value={question} onChangeText={setQuestion} placeholder="继续追问这段对话…" placeholderTextColor={props.palette.muted} multiline style={[styles.historyInput, { backgroundColor: props.palette.control, borderColor: props.palette.line, color: props.palette.text }]} />
            <Pressable disabled={!question.trim() || loading} onPress={continueConversation} style={[styles.sendButton, { backgroundColor: props.palette.accent }, (!question.trim() || loading) && { opacity: 0.45 }]}><Ionicons name="arrow-up" size={18} color={props.palette.onAccent} /></Pressable>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function TypeModal({ visible, value, onChange, onClose }: { visible: boolean; value: ReaderPrefs; onChange: (value: ReaderPrefs) => void; onClose: () => void }) {
  const previewPalette = getReaderPalette(value.theme);
  const themes: { key: ReaderPrefs['theme']; name: string; color: string }[] = [
    { key: 'paper', name: '纸白', color: '#E9ECE5' },
    { key: 'wheat', name: '麦纸', color: '#F1DFB7' },
    { key: 'mist', name: '雾蓝', color: '#DDE7E5' },
    { key: 'night', name: '夜墨', color: '#17292D' },
  ];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <DraggableSheet visible={visible} onClose={onClose} palette={previewPalette} style={styles.typeSheet}>
        <View style={styles.sheetHeader}><Text style={[styles.sheetTitle, { color: previewPalette.text }]}>阅读外观</Text><Pressable onPress={onClose} style={[styles.closeButton, { backgroundColor: previewPalette.surfaceAlt }]}><Ionicons name="close" size={20} color={previewPalette.text} /></Pressable></View>
        <ScrollView contentContainerStyle={styles.typeScroll} showsVerticalScrollIndicator={false}>
        <View style={styles.layoutPairRow}>
          <View style={styles.layoutPairGroup}>
            <Text style={[styles.controlLabel, styles.layoutPairLabel, { color: previewPalette.muted }]}>翻页方式</Text>
            <View style={styles.optionRow}>
              <AppearanceOption palette={previewPalette} label="上下连续" active={value.readingMode === 'scroll'} onPress={() => onChange({ ...value, readingMode: 'scroll' })} />
              <AppearanceOption palette={previewPalette} label="左右翻页" active={value.readingMode === 'paged'} onPress={() => onChange({ ...value, readingMode: 'paged' })} />
            </View>
          </View>
          <View style={styles.layoutPairGroup}>
            <Text style={[styles.controlLabel, styles.layoutPairLabel, { color: previewPalette.muted }]}>文字对齐</Text>
            <View style={styles.optionRow}>
              <AppearanceOption palette={previewPalette} label="左对齐" active={value.textAlign === 'left'} onPress={() => onChange({ ...value, textAlign: 'left' })} />
              <AppearanceOption palette={previewPalette} label="两端对齐" active={value.textAlign === 'justify'} onPress={() => onChange({ ...value, textAlign: 'justify' })} />
            </View>
          </View>
        </View>
        <View style={styles.fontSizeSliderRow}>
          <SpacingSlider
            palette={previewPalette}
            label="字号"
            value={value.fontSize}
            minimum={14}
            maximum={36}
            step={1}
            format={(next) => `${Math.round(next)} pt`}
            onChange={(fontSize) => onChange({ ...value, fontSize })}
          />
        </View>

        <Text style={[styles.controlLabel, { color: previewPalette.muted }]}>正文字体</Text>
        <View style={styles.optionRow}>
          <AppearanceOption palette={previewPalette} label="宋体" active={value.fontStyle === 'serif'} onPress={() => onChange({ ...value, fontStyle: 'serif' })} />
          <AppearanceOption palette={previewPalette} label="黑体" active={value.fontStyle === 'sans'} onPress={() => onChange({ ...value, fontStyle: 'sans' })} />
        </View>

        <View style={[styles.inlineSettingRow, { backgroundColor: previewPalette.control, borderColor: previewPalette.line }]}>
          <View style={styles.inlineSettingCopy}>
            <Text style={[styles.inlineSettingTitle, { color: previewPalette.text }]}>首行缩进</Text>
            <Text style={[styles.inlineSettingHint, { color: previewPalette.muted }]}>正文段落缩进两个汉字</Text>
          </View>
          <View style={styles.inlineSettingControl}>
            <Text style={[styles.inlineSettingValue, { color: value.firstLineIndent ? previewPalette.accent : previewPalette.muted }]}>{value.firstLineIndent ? '打开' : '关闭'}</Text>
            <Switch
              accessibilityLabel="首行缩进"
              value={value.firstLineIndent}
              onValueChange={(firstLineIndent) => onChange({ ...value, firstLineIndent })}
              trackColor={{ false: previewPalette.line, true: previewPalette.focus }}
              thumbColor={value.firstLineIndent ? previewPalette.accent : previewPalette.muted}
            />
          </View>
        </View>

        <Text style={[styles.controlLabel, { color: previewPalette.muted }]}>排版间距</Text>
        <View style={styles.spacingSliderRow}>
          <SpacingSlider palette={previewPalette} label="行距" value={value.lineHeight} minimum={1} maximum={3} step={0.1} format={(next) => next.toFixed(1)} onChange={(lineHeight) => onChange({ ...value, lineHeight })} />
          <SpacingSlider palette={previewPalette} label="段间距" value={value.paragraphSpacing} minimum={0} maximum={64} step={2} format={(next) => String(Math.round(next))} onChange={(paragraphSpacing) => onChange({ ...value, paragraphSpacing })} />
        </View>

        <Text style={[styles.controlLabel, { color: previewPalette.muted }]}>页面边距</Text>
        <View style={styles.marginGrid}>
          <MarginSlider palette={previewPalette} icon="arrow-up" label="上边" value={value.pagePaddingTop} onChange={(pagePaddingTop) => onChange({ ...value, pagePaddingTop })} />
          <MarginSlider palette={previewPalette} icon="arrow-down" label="下边" value={value.pagePaddingBottom} onChange={(pagePaddingBottom) => onChange({ ...value, pagePaddingBottom })} />
          <MarginSlider palette={previewPalette} icon="arrow-back" label="左边" value={value.pagePaddingLeft} onChange={(pagePaddingLeft) => onChange({ ...value, pagePaddingLeft, pagePadding: Math.round((pagePaddingLeft + value.pagePaddingRight) / 2) })} />
          <MarginSlider palette={previewPalette} icon="arrow-forward" label="右边" value={value.pagePaddingRight} onChange={(pagePaddingRight) => onChange({ ...value, pagePaddingRight, pagePadding: Math.round((value.pagePaddingLeft + pagePaddingRight) / 2) })} />
        </View>

        <Text style={[styles.controlLabel, { color: previewPalette.muted }]}>纸张</Text>
        <View style={styles.themeRow}>
          {themes.map((theme) => <Pressable key={theme.key} onPress={() => onChange({ ...value, theme: theme.key })} style={[styles.themeChoice, { borderColor: value.theme === theme.key ? previewPalette.accent : previewPalette.line, backgroundColor: value.theme === theme.key ? previewPalette.focus : previewPalette.surface }]}><View style={[styles.themeSwatch, { backgroundColor: theme.color, borderColor: previewPalette.line }]} /><Text style={[styles.themeName, { color: previewPalette.text }]}>{theme.name}</Text></Pressable>)}
        </View>
        </ScrollView>
      </DraggableSheet>
    </Modal>
  );
}

type ReaderPalette = ReturnType<typeof getReaderPalette>;

const ReaderToolbar = memo(function ReaderToolbar(props: {
  visible: boolean;
  animation: Animated.Value;
  palette: ReaderPalette;
  progress: number;
  chapter: number;
  chapterCount: number;
  marginCount: number;
  onBack: () => void;
  onContents: () => void;
  onAppearance: () => void;
  onMargins: () => void;
  onProgressStart: (pageX: number) => void;
  onProgressMove: (pageX: number) => void;
  onProgressEnd: () => void;
}) {
  return <Animated.View
    pointerEvents={props.visible ? 'auto' : 'none'}
    style={[styles.readerBottom, {
      backgroundColor: props.palette.bar,
      borderColor: props.palette.line,
      opacity: props.animation,
      transform: [{ translateY: props.animation.interpolate({ inputRange: [0, 1], outputRange: [82, 0] }) }],
    }]}
  >
    <Pressable accessibilityLabel="返回" onPress={props.onBack} style={styles.bottomAction}><Ionicons name="arrow-back" size={22} color={props.palette.muted} /><Text style={[styles.bottomLabel, { color: props.palette.muted }]}>返回</Text></Pressable>
    <Pressable onPress={props.onContents} style={styles.bottomAction}><Ionicons name="list" size={22} color={props.palette.muted} /><Text style={[styles.bottomLabel, { color: props.palette.muted }]}>目录</Text></Pressable>
    <View
      accessibilityLabel="长按调整全书进度"
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(event) => props.onProgressStart(event.nativeEvent.pageX)}
      onResponderMove={(event) => props.onProgressMove(event.nativeEvent.pageX)}
      onResponderRelease={props.onProgressEnd}
      onResponderTerminate={props.onProgressEnd}
      onResponderTerminationRequest={() => false}
      style={styles.progressPill}
    ><Text style={[styles.progressMain, { color: props.palette.text }]}>{Math.round(props.progress * 100)}%</Text><Text style={[styles.progressText, { color: props.palette.muted }]}>按住拖动 · {props.chapter + 1}/{props.chapterCount} 章</Text></View>
    <Pressable onPress={props.onAppearance} style={styles.bottomAction}><Text style={[styles.bottomAa, { color: props.palette.muted }]}>Aa</Text><Text style={[styles.bottomLabel, { color: props.palette.muted }]}>外观</Text></Pressable>
    <Pressable onPress={props.onMargins} style={styles.bottomAction}><Ionicons name="albums-outline" size={21} color={props.marginCount ? props.palette.accent : props.palette.muted} /><Text style={[styles.bottomLabel, { color: props.palette.muted }]}>页边 {props.marginCount || ''}</Text></Pressable>
  </Animated.View>;
});

function AppearanceOption({ palette, label, active, onPress }: { palette: ReaderPalette; label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.appearanceOption, { borderColor: active ? palette.accent : palette.line, backgroundColor: active ? palette.focus : palette.control }, pressed && styles.pressed]}>
      <Text style={[styles.appearanceOptionText, { color: active ? palette.accent : palette.muted }, active && styles.appearanceOptionTextActive]}>{label}</Text>
    </Pressable>
  );
}

function SpacingSlider(props: {
  palette: ReaderPalette;
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  return <View style={[styles.spacingSliderCard, { backgroundColor: props.palette.control, borderColor: props.palette.line }]}>
    <View style={styles.spacingSliderHead}>
      <Text style={[styles.spacingSliderLabel, { color: props.palette.text }]}>{props.label}</Text>
      <Text style={[styles.spacingSliderValue, { color: props.palette.accent }]}>{props.format(draft)}</Text>
    </View>
    <Slider
      accessibilityLabel={props.label}
      style={styles.spacingSlider}
      minimumValue={props.minimum}
      maximumValue={props.maximum}
      step={props.step}
      value={draft}
      onValueChange={setDraft}
      onSlidingComplete={props.onChange}
      minimumTrackTintColor={props.palette.accent}
      maximumTrackTintColor={props.palette.line}
      thumbTintColor={props.palette.accent}
    />
  </View>;
}

function MarginSlider({ palette, icon, label, value, onChange }: { palette: ReaderPalette; icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <View style={[styles.marginSliderCard, { backgroundColor: palette.control, borderColor: palette.line }]}>
    <View style={styles.marginSliderHead}>
      <View style={[styles.marginDirectionIcon, { backgroundColor: palette.focus }]}><Ionicons name={icon} size={13} color={palette.accent} /></View>
      <Text style={[styles.marginDirection, { color: palette.text }]}>{label}</Text>
      <Text style={[styles.marginValue, { color: palette.accent }]}>{Math.round(draft)}</Text>
    </View>
    <Slider
      accessibilityLabel={`${label}距`}
      style={styles.marginSlider}
      minimumValue={0}
      maximumValue={96}
      step={2}
      value={draft}
      onValueChange={setDraft}
      onSlidingComplete={(next) => onChange(Math.round(next))}
      minimumTrackTintColor={palette.accent}
      maximumTrackTintColor={palette.line}
      thumbTintColor={palette.accent}
    />
  </View>;
}

function AIPanel(props: {
  visible: boolean;
  bookId: string;
  chapterIndex: number;
  bookTitle: string;
  bookAuthor: string;
  bookDescription?: string;
  chapter: Book['chapters'][number];
  paragraphIndex: number;
  selectedText?: string;
  selectedImage?: string;
  locator?: EpubLocator;
  settings: AISettings;
  palette: ReaderPalette;
  onSaveConversation: (conversation: AIConversation) => void;
  onSettings: () => void;
  onClose: () => void;
}) {
  const [answer, setAnswer] = useState('');
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [contextRadius, setContextRadius] = useState(5);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [conversationMessages, setConversationMessages] = useState<AIMessage[]>([]);
  const questionInputRef = useRef<TextInput>(null);
  const controller = useRef<AbortController | null>(null);
  const messagesRef = useRef<AIMessage[]>([]);
  const sessionId = useRef('');
  const sessionCreatedAt = useRef(0);
  useEffect(() => {
    if (props.visible) {
      setAnswer(''); setQuestion(''); setError(''); setLoading(false); setConversationMessages([]);
      messagesRef.current = [];
      sessionCreatedAt.current = Date.now();
      sessionId.current = `conversation-${sessionCreatedAt.current}-${Math.random().toString(36).slice(2, 6)}`;
    }
    return () => controller.current?.abort();
  }, [props.visible, props.paragraphIndex]);
  const run = async (intent: AIIntent) => {
    if (!props.settings.apiKey.trim()) { setError('先配置模型接口，墨问才知道该去哪里思考。'); return; }
    const text = question.trim();
    setQuestion('');
    setLoading(true); setError(''); setAnswer('');
    controller.current?.abort();
    controller.current = new AbortController();
    try {
      const priorMessages = messagesRef.current;
      const pendingMessages: AIMessage[] = [...priorMessages, { role: 'user', content: text }];
      setConversationMessages(pendingMessages);
      const result = await askAI({
        ...props,
        intent,
        question: text,
        contextRadius,
        additionalImages: props.selectedImage ? [props.selectedImage] : undefined,
        history: priorMessages,
        signal: controller.current.signal,
        onDelta: (delta) => setAnswer((current) => current + delta),
      });
      const userLabel: Record<AIIntent, string> = {
        explain: '解释这段',
        thread: '联系上下文',
        simple: '说简单点',
        question: text,
      };
      const nextMessages: AIMessage[] = [...pendingMessages.slice(0, -1), { role: 'user', content: userLabel[intent] }, { role: 'assistant', content: result }];
      messagesRef.current = nextMessages;
      setConversationMessages(nextMessages);
      setAnswer('');
      const rawExcerpt = props.selectedImage ? '〔插图〕' : props.selectedText?.trim() || props.chapter.paragraphs[props.paragraphIndex] || '';
      props.onSaveConversation({
        id: sessionId.current,
        bookId: props.bookId,
        chapterIndex: props.chapterIndex,
        paragraphIndex: props.paragraphIndex,
        chapterTitle: props.chapter.title,
        anchorExcerpt: getImageData(rawExcerpt) ? '〔插图〕' : rawExcerpt.replace(/\[\[MOWEN_NOTE_REF:[^\]]+\]\]/g, '〔注〕').slice(0, 180),
        locator: props.locator,
        contextRadius,
        messages: nextMessages,
        createdAt: sessionCreatedAt.current,
        updatedAt: Date.now(),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(e instanceof Error ? e.message : '暂时无法连接模型');
    } finally { setLoading(false); }
  };
  const fillPreset = (prompt: string) => {
    setQuestion(prompt);
    setAnswer('');
    setError('');
    requestAnimationFrame(() => questionInputRef.current?.focus());
  };
  const openImagePreview = (uri: string) => setPreviewImage(uri);
  const excerpt = props.selectedText?.trim() || props.chapter.paragraphs[props.paragraphIndex] || '';
  const excerptIsImage = !!props.selectedImage || !!getImageData(excerpt);
  const start = Math.max(0, props.paragraphIndex - contextRadius);
  const end = Math.min(props.chapter.paragraphs.length, props.paragraphIndex + contextRadius + 1);
  const contextImageUris = useMemo(() => {
    const values: string[] = [];
    if (props.selectedImage) values.push(props.selectedImage);
    for (let index = start; index < end; index++) {
      // When an image was long-pressed, the selected image is already supplied
      // separately; don't show/count the same image twice from the chapter marker.
      if (props.selectedImage && index === props.paragraphIndex) continue;
      const uri = getImageData(props.chapter.paragraphs[index]);
      if (uri) values.push(uri);
    }
    return values.filter((value, index, all) => all.indexOf(value) === index);
  }, [end, props.chapter.paragraphs, props.paragraphIndex, props.selectedImage, start]);
  const bookImageCount = contextImageUris.length;
  const hasConversationContent = loading || conversationMessages.length > 0;
  if (!props.visible) return null;

  return (
    <View style={styles.aiOverlayRoot}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalRoot}>
        <DraggableSheet
          visible={props.visible}
          onClose={props.onClose}
          palette={props.palette}
          animateIn
          fillBelow
          style={[styles.aiSheet, hasConversationContent && styles.aiSheetExpanded]}
        >
          <View style={styles.aiHeader}>
            <View style={styles.aiTitleRow}><View style={[styles.miniSpark, { backgroundColor: props.palette.accent }]}><Ionicons name="sparkles" size={15} color={props.palette.onAccent} /></View><Text style={[styles.aiTitle, { color: props.palette.text }]}>理解此处</Text></View>
            <Pressable onPress={props.onClose} style={[styles.closeButton, { backgroundColor: props.palette.surfaceAlt }]}><Ionicons name="close" size={20} color={props.palette.text} /></Pressable>
          </View>
          <ScrollView style={styles.aiScroll} contentContainerStyle={styles.aiScrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={[styles.contextCard, { backgroundColor: props.palette.surfaceAlt, borderLeftColor: props.palette.accent }]}>
              <View style={styles.contextLabelRow}><Text style={[styles.contextLabel, { color: props.palette.accent }]}>正在阅读 · 位置 {props.paragraphIndex + 1}</Text><Text style={[styles.contextRange, { color: props.palette.muted }]}>{bookImageCount} 张图片</Text></View>
              <Text numberOfLines={3} style={[styles.contextText, { color: props.palette.text }]}>{excerptIsImage ? '当前是一幅插图，AI 将结合图片内容理解。' : excerpt}</Text>
              {!!contextImageUris.length && <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.contextImages}>
                {contextImageUris.map((uri, index) => <Pressable key={`${index}-${uri.slice(0, 32)}`} accessibilityLabel={`放大查看上下文图片 ${index + 1}`} onPress={() => openImagePreview(uri)} style={({ pressed }) => [styles.contextImagePress, pressed && styles.pressed]}>
                  <Image source={{ uri }} style={[styles.contextImage, { borderColor: props.palette.line }]} />
                  <View style={[styles.contextImageIndex, { backgroundColor: props.palette.scrim }]}><Text style={[styles.contextImageIndexText, { color: props.palette.onAccent }]}>{index + 1}</Text></View>
                </Pressable>)}
              </ScrollView>}
            </View>
            <View style={styles.contextSliderHead}>
              <Text style={[styles.contextControlLabel, { color: props.palette.muted }]}>上下文范围</Text>
              <Text style={[styles.contextSliderValue, { color: props.palette.accent }]}>前后 {contextRadius} 个内容块</Text>
            </View>
            <Slider
              value={contextRadius}
              minimumValue={1}
              maximumValue={20}
              step={1}
              onValueChange={(value) => { setContextRadius(Math.round(value)); setAnswer(''); }}
              minimumTrackTintColor={props.palette.accent}
              maximumTrackTintColor={props.palette.line}
              thumbTintColor={props.palette.accent}
              style={styles.contextSlider}
            />
            <View style={styles.contextSliderMeta}>
              <Text style={[styles.contextSliderHint, { color: props.palette.muted }]}>近</Text>
              <Text style={[styles.contextSliderHint, { color: props.palette.muted }]}>远 · 最多前后 20 个内容块</Text>
            </View>
            {!answer && !loading && (
              <View style={styles.intentGrid}>
                <IntentButton palette={props.palette} title="解释这段" onPress={() => fillPreset('请解释这段内容的核心意思、关键概念和隐含逻辑。')} />
                <IntentButton palette={props.palette} title="联系上下文" onPress={() => fillPreset('请结合前后文，说明这段内容在本章论证中的作用。')} />
                <IntentButton palette={props.palette} title="说简单点" onPress={() => fillPreset('请用更直白的中文改写这段内容，并举一个贴切的小例子。')} />
              </View>
            )}
            {conversationMessages.map((message, index) => message.role === 'user' ? (
              <View key={`${message.role}-${index}`} style={[styles.historyQuestionBlock, { backgroundColor: props.palette.focus }]}>
                <Text style={[styles.historyQuestionLabel, { color: props.palette.accent }]}>你问</Text>
                <Text style={[styles.historyQuestionText, { color: props.palette.text }]}>{message.content}</Text>
              </View>
            ) : (
              <View key={`${message.role}-${index}`} style={[styles.historyAnswerBlock, { backgroundColor: props.palette.control, borderColor: props.palette.line }]}>
                <Text style={[styles.answerLabel, { color: props.palette.accent }]}>墨问批注</Text>
                <Markdown style={{ ...markdownStyles, ...themedMarkdownStyles(props.palette) }}>{message.content}</Markdown>
              </View>
            ))}
            {!!answer && <View style={[styles.historyAnswerBlock, { backgroundColor: props.palette.control, borderColor: props.palette.line }]}>
              <Text style={[styles.answerLabel, { color: props.palette.accent }]}>墨问批注</Text>
              <Markdown style={{ ...markdownStyles, ...themedMarkdownStyles(props.palette) }}>{answer}</Markdown>
            </View>}
            {loading && <View style={styles.thinking}><View style={[styles.thinkingOrb, { backgroundColor: props.palette.accent }]}><ActivityIndicator color={props.palette.onAccent} /></View><View><Text style={[styles.thinkingTitle, { color: props.palette.text }]}>沿着上下文阅读…</Text><Text style={[styles.thinkingNote, { color: props.palette.muted }]}>只发送当前段落附近的内容</Text></View></View>}
            {!!error && <View style={[styles.errorCard, { backgroundColor: props.palette.surfaceAlt }]}><Ionicons name="information-circle-outline" size={19} color={C.ember} /><Text style={[styles.errorText, { color: props.palette.text }]}>{error}</Text>{!props.settings.apiKey && <Pressable onPress={props.onSettings}><Text style={[styles.errorLink, { color: props.palette.accent }]}>去配置</Text></Pressable>}</View>}
          </ScrollView>
          <View style={[styles.aiComposer, { backgroundColor: props.palette.surface, borderTopColor: props.palette.line }]}>
            <View style={[styles.questionBox, { backgroundColor: props.palette.control, borderColor: props.palette.line }]}>
              <TextInput ref={questionInputRef} value={question} onChangeText={setQuestion} placeholder="也可以直接问一个问题…" placeholderTextColor={props.palette.muted} multiline style={[styles.questionInput, { color: props.palette.text }]} />
              <Pressable disabled={!question.trim() || loading} onPress={() => run('question')} style={[styles.sendButton, { backgroundColor: props.palette.accent }, (!question.trim() || loading) && { opacity: 0.45 }]}><Ionicons name="arrow-up" size={18} color={props.palette.onAccent} /></Pressable>
            </View>
            <Text style={[styles.privacyNote, { color: props.palette.muted }]}>发送范围：书籍信息、所选上下文及范围内插图</Text>
          </View>
        </DraggableSheet>
        {!!previewImage && <View style={[StyleSheet.absoluteFill, styles.imagePreviewRoot, { backgroundColor: props.palette.scrim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPreviewImage(null)} />
          <View style={[styles.imagePreviewCard, { backgroundColor: props.palette.surface, borderColor: props.palette.line }]}>
            {previewImage && <Image source={{ uri: previewImage }} resizeMode="contain" style={styles.imagePreviewImage} />}
            <View style={[styles.imagePreviewFooter, { borderTopColor: props.palette.line }]}>
              <Text style={[styles.imagePreviewLabel, { color: props.palette.muted }]}>上下文图片 {Math.max(0, contextImageUris.indexOf(previewImage ?? '') + 1)} / {contextImageUris.length}</Text>
              <Pressable accessibilityLabel="关闭图片预览" onPress={() => setPreviewImage(null)} style={[styles.closeButton, { backgroundColor: props.palette.surfaceAlt }]}><Ionicons name="close" size={20} color={props.palette.text} /></Pressable>
            </View>
          </View>
        </View>}
      </KeyboardAvoidingView>
    </View>
  );
}

function IntentButton({ palette, title, onPress }: { palette: ReaderPalette; title: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.intentButton, { backgroundColor: palette.control, borderColor: palette.line }, pressed && styles.pressed]}><Text style={[styles.intentTitle, { color: palette.text }]}>{title}</Text></Pressable>;
}

function AISettingsModal({ palette, visible, value, onSave, onAutoSave, onClose }: { palette: ReaderPalette; visible: boolean; value: AISettings; onSave: (value: AISettings) => void; onAutoSave: (value: AISettings) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (visible) setDraft(value); }, [visible, value]);
  useEffect(() => {
    if (!visible || JSON.stringify(draft) === JSON.stringify(value)) return;
    const timer = setTimeout(() => onAutoSave(draft), 500);
    return () => clearTimeout(timer);
  }, [draft, visible, value, onAutoSave]);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={[styles.settingsPage, { backgroundColor: palette.bg }]}>
        <StatusBar style={palette.bg === '#142428' ? 'light' : 'dark'} />
        <View style={[styles.settingsTop, { borderBottomColor: palette.line }]}><Pressable onPress={onClose} style={styles.readerIcon}><Ionicons name="close" size={24} color={palette.text} /></Pressable><Text style={[styles.settingsTopTitle, { color: palette.text }]}>AI 理解设置</Text><Pressable onPress={() => onSave(draft)}><Text style={[styles.saveText, { color: palette.accent }]}>完成</Text></Pressable></View>
        <ScrollView contentContainerStyle={styles.settingsScroll} keyboardShouldPersistTaps="handled">
          <View style={styles.settingsIntro}><View style={[styles.settingsMark, { backgroundColor: palette.accent }]}><Ionicons name="sparkles" size={22} color={palette.onAccent} /></View><Text style={[styles.settingsIntroTitle, { color: palette.text }]}>连接你的模型</Text><Text style={[styles.settingsIntroText, { color: palette.muted }]}>墨问支持 OpenAI-compatible 接口。密钥仅保存在这台设备上，每次只发送你正在阅读位置附近的 5 个段落。</Text></View>
          <Field palette={palette} label="接口地址" value={draft.baseUrl} onChangeText={(baseUrl) => setDraft({ ...draft, baseUrl })} placeholder="https://api.openai.com/v1" autoCapitalize="none" />
          <Field palette={palette} label="模型" value={draft.model} onChangeText={(model) => setDraft({ ...draft, model })} placeholder="qwen3.7-flash" autoCapitalize="none" />
          <Field palette={palette} label="API 密钥 · 系统安全存储" value={draft.apiKey} onChangeText={(apiKey) => setDraft({ ...draft, apiKey })} placeholder="sk-…" autoCapitalize="none" secureTextEntry />
          <Text style={[styles.autoSaveNote, { color: palette.muted }]}>修改会自动保存；API 密钥写入系统安全存储。</Text>
          <View style={[styles.privacyCard, { borderTopColor: palette.line }]}><Ionicons name="shield-checkmark-outline" size={23} color={palette.accent} /><View style={{ flex: 1 }}><Text style={[styles.privacyTitle, { color: palette.text }]}>内容边界</Text><Text style={[styles.privacyBody, { color: palette.muted }]}>导入、解析和阅读进度都在本机完成。只有你主动提问时，书籍信息、所选位置附近的文本和随附图片才会发往上面的接口。</Text></View></View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string; palette: ReaderPalette }) {
  const { label, palette, ...inputProps } = props;
  return <View style={styles.field}><Text style={[styles.fieldLabel, { color: palette.text }]}>{label}</Text><TextInput {...inputProps} placeholderTextColor={palette.muted} style={[styles.fieldInput, { backgroundColor: palette.control, borderColor: palette.line, color: palette.text }]} /></View>;
}

function DraggableSheet(props: {
  visible: boolean;
  onClose: () => void;
  palette?: ReaderPalette;
  animateIn?: boolean;
  fillBelow?: boolean;
  style?: React.ComponentProps<typeof Animated.View>['style'];
  children: React.ReactNode;
}) {
  const palette = props.palette ?? getReaderPalette('paper');
  const { height: windowHeight } = useWindowDimensions();
  const translateY = useRef(new Animated.Value(props.animateIn ? windowHeight : 0)).current;
  useEffect(() => {
    if (!props.visible) return;
    if (!props.animateIn) { translateY.setValue(0); return; }
    const frame = requestAnimationFrame(() => {
      Animated.timing(translateY, { toValue: 0, duration: 190, useNativeDriver: true }).start();
    });
    return () => cancelAnimationFrame(frame);
  }, [props.animateIn, props.visible, translateY]);
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy > 2 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderGrant: () => translateY.stopAnimation(),
    onPanResponderMove: (_event, gesture) => translateY.setValue(Math.max(0, gesture.dy)),
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dy > 95 || gesture.vy > 0.85) {
        const duration = Math.max(130, Math.min(260, 240 - Math.max(0, gesture.vy) * 70));
        Animated.timing(translateY, { toValue: windowHeight, duration, useNativeDriver: true }).start(props.onClose);
      } else {
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 4 }).start();
      }
    },
    onPanResponderTerminate: () => Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start(),
  }), [props.onClose, translateY, windowHeight]);
  const scrimOpacity = translateY.interpolate({
    inputRange: [0, Math.max(1, windowHeight * 0.7)],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  return <>
    <Animated.View style={[styles.scrim, { backgroundColor: palette.scrim, opacity: scrimOpacity }]}><Pressable style={StyleSheet.absoluteFill} onPress={props.onClose} /></Animated.View>
    <Animated.View style={[styles.sheet, { backgroundColor: palette.surface }, props.style, { transform: [{ translateY }] }]}>
      {props.fillBelow && <View pointerEvents="none" style={[styles.sheetFillBelow, { height: windowHeight, backgroundColor: palette.surface }]} />}
      <View style={styles.dragHandleZone} {...panResponder.panHandlers}><SheetHandle color={palette.line} /></View>
      {props.children}
    </Animated.View>
  </>;
}

function SheetHandle({ color = '#C2CAC5' }: { color?: string }) { return <View style={[styles.handle, { backgroundColor: color }]} />; }

function getImageData(value: string) {
  const match = value.match(/^\[\[MOWEN_IMAGE_(?:DATA|FILE):([\s\S]+)\]\]$/);
  return match?.[1].split('|')[0];
}

function themedMarkdownStyles(palette: ReaderPalette) {
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

function getReaderPalette(theme: ReaderPrefs['theme']) {
  if (theme === 'night') return { bg: '#142428', bar: '#1A2E32', surface: '#1B3034', surfaceAlt: '#223A3E', control: '#263F43', text: '#E3E9E3', muted: '#9AAEAD', line: '#385055', accent: '#8CB9B2', focus: '#2C4347', scrim: 'rgba(3,10,12,.76)', onAccent: '#102629' };
  if (theme === 'mist') return { bg: '#DCE8E6', bar: '#E6EFED', surface: '#EDF3F1', surfaceAlt: '#D5E3E0', control: '#F5F8F6', text: '#183034', muted: '#607779', line: '#B8CAC6', accent: '#466E82', focus: '#CBDCE2', scrim: 'rgba(13,35,38,.54)', onAccent: '#F7FBF8' };
  if (theme === 'wheat') return { bg: '#F0DEB7', bar: '#F6E8CB', surface: '#F8EBCF', surfaceAlt: '#EAD6AC', control: '#FFF5DE', text: '#211A12', muted: '#776851', line: '#D3BA8D', accent: '#97552F', focus: '#E4C99D', scrim: 'rgba(40,27,13,.55)', onAccent: '#FFF8E9' };
  return { bg: C.paper, bar: '#EEF0EB', surface: '#F4F6F1', surfaceAlt: '#E3E9E3', control: '#FAFBF8', text: C.text, muted: C.muted, line: C.line, accent: '#34756F', focus: '#DCE8E3', scrim: 'rgba(4,18,21,.58)', onAccent: '#F8FAF6' };
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: C.ink },
  splash: { flex: 1, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  mark: { width: 66, height: 78, borderWidth: 1, borderColor: C.sea, alignItems: 'center', justifyContent: 'center', borderTopLeftRadius: 30, borderBottomRightRadius: 30 },
  markText: { color: C.white, fontSize: 32, fontFamily: Platform.select({ android: 'serif', ios: 'Songti SC' }) },
  splashName: { marginTop: 20, color: C.white, fontSize: 28, letterSpacing: 8, fontFamily: Platform.select({ android: 'serif', ios: 'Songti SC' }) },
  splashTag: { marginTop: 10, color: '#89A5A7', fontSize: 12, letterSpacing: 2 },
  library: { flex: 1, backgroundColor: C.ink },
  libraryHeader: { height: 86, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { color: C.sea, fontSize: 9, letterSpacing: 2.8, fontWeight: '700' },
  libraryTitle: { color: C.white, fontSize: 30, marginTop: 2, letterSpacing: 5, fontFamily: Platform.select({ android: 'serif', ios: 'Songti SC' }) },
  iconButtonDark: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: '#385057', alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.65, transform: [{ scale: 0.97 }] },
  libraryScroll: { paddingHorizontal: 24, paddingBottom: 48 },
  cardPressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 34, marginBottom: 18 },
  sectionTitle: { color: C.white, fontSize: 19, letterSpacing: 2, fontFamily: Platform.select({ android: 'serif', ios: 'Songti SC' }) },
  sectionCount: { color: '#789092', fontSize: 10 },
  bookGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start' },
  bookTileWrap: { width: '46%', marginBottom: 28 },
  bookTile: { width: '100%', aspectRatio: BOOK_COVER_ASPECT_RATIO, backgroundColor: '#35565A', elevation: 4, shadowColor: '#071315', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8 },
  coverImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  coverFallback: { flex: 1, padding: 16, overflow: 'hidden' },
  coverLine: { height: 1, width: 28, backgroundColor: 'rgba(255,255,255,.65)', marginTop: 5, marginBottom: 20 },
  coverTitle: { color: C.white, fontSize: 20, lineHeight: 28, fontFamily: Platform.select({ android: 'serif', ios: 'Songti SC' }) },
  coverAuthor: { color: 'rgba(255,255,255,.7)', fontSize: 10, marginTop: 10 },
  coverSeal: { position: 'absolute', right: 10, bottom: 11, color: 'rgba(255,255,255,.5)', fontSize: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,.35)', padding: 4 },
  bookProgress: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, backgroundColor: 'rgba(0,0,0,.25)' },
  bookProgressFill: { height: 3, backgroundColor: C.seaPale },
  bookOpening: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,31,35,.45)', alignItems: 'center', justifyContent: 'center' },
  tileTitle: { color: C.white, fontSize: 13, fontWeight: '600', marginTop: 10 },
  tileAuthor: { color: '#7F9698', fontSize: 10, marginTop: 4 },
  addTileWrap: { width: '46%', marginBottom: 28 },
  addTile: { width: '100%', aspectRatio: BOOK_COVER_ASPECT_RATIO, borderWidth: 1, borderStyle: 'dashed', borderColor: '#466065', alignItems: 'center', justifyContent: 'center' },
  addText: { color: C.seaPale, marginTop: 10, fontSize: 12, fontWeight: '600' },
  addHint: { color: '#687E80', fontSize: 9, marginTop: 5 },
  reader: { flex: 1 },
  readerIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  readerBottom: { position: 'absolute', zIndex: 20, bottom: 26, left: 14, right: 14, height: 62, borderWidth: StyleSheet.hairlineWidth, borderRadius: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', elevation: 9, shadowColor: '#071315', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.24, shadowRadius: 12 },
  bottomAction: { width: 50, height: 52, alignItems: 'center', justifyContent: 'center', gap: 2 },
  bottomLabel: { fontSize: 11 },
  bottomAa: { fontFamily: 'serif', fontSize: 20, fontWeight: '600', lineHeight: 22 },
  progressPill: { minWidth: 82, alignItems: 'center' },
  progressMain: { fontSize: 16, fontWeight: '700', marginBottom: 2 },
  progressText: { fontSize: 10 },
  liveProgressCard: { position: 'absolute', zIndex: 30, left: 18, right: 18, bottom: 88, borderWidth: StyleSheet.hairlineWidth, borderRadius: 7, paddingHorizontal: 16, paddingTop: 13, paddingBottom: 12, elevation: 11, shadowColor: '#071315', shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.26, shadowRadius: 14 },
  liveProgressTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  liveProgressLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  liveProgressPercent: { fontSize: 20, fontWeight: '800' },
  liveProgressChapter: { fontFamily: Platform.select({ android: 'serif', ios: 'Songti SC' }), fontSize: 14, marginTop: -1, marginBottom: 11 },
  liveProgressTrack: { height: 3, overflow: 'hidden' },
  liveProgressFill: { height: 3 },
  liveProgressHint: { fontSize: 9, textAlign: 'center', marginTop: 9 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  aiOverlayRoot: { ...StyleSheet.absoluteFillObject, zIndex: 100, elevation: 100 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4,18,21,.58)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '82%', minHeight: 350, backgroundColor: '#F3F5F0', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 22 },
  sheetFillBelow: { position: 'absolute', top: '100%', left: 0, right: 0 },
  handle: { width: 34, height: 4, borderRadius: 2, backgroundColor: '#C2CAC5', alignSelf: 'center', marginTop: 10, marginBottom: 8 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  sheetEyebrow: { color: C.sea, fontSize: 9, letterSpacing: 2, fontWeight: '800' },
  sheetTitle: { color: C.text, fontSize: 23, fontFamily: 'serif' },
  closeButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#E4E8E2', alignItems: 'center', justifyContent: 'center' },
  tocList: { marginTop: 3 },
  tocItem: { height: 60, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  tocItemActive: { backgroundColor: '#E0EBE7', marginHorizontal: -8, paddingHorizontal: 16, borderBottomWidth: 0 },
  tocNumber: { width: 37, color: '#8A999A', fontSize: 10, letterSpacing: 1 },
  tocTitle: { flex: 1, color: C.text, fontFamily: 'serif', fontSize: 15 },
  tocActiveText: { color: '#347673' },
  currentDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.sea },
  bookmarksSheet: { height: '78%', maxHeight: '78%' },
  marginTabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.line, marginBottom: 12 },
  marginTab: { flex: 1, height: 39, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  marginTabActive: { borderBottomColor: C.sea },
  marginTabText: { color: C.muted, fontSize: 11 },
  marginTabTextActive: { fontWeight: '800' },
  bookmarkSelectionActions: { position: 'absolute', alignSelf: 'center', bottom: 10, flexDirection: 'row', gap: 8 },
  bookmarkSelectionButton: { minWidth: 52, height: 44, borderWidth: 1, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 12, elevation: 8 },
  bookmarkSelectionButtonText: { fontSize: 11, fontWeight: '800' },
  bookmarkActionIconRemove: { backgroundColor: '#F8F1EB' },
  bookmarksList: { paddingBottom: 28 },
  bookmarksEmptyList: { flexGrow: 1 },
  bookmarksEmpty: { flex: 1, minHeight: 260, alignItems: 'center', justifyContent: 'center' },
  bookmarksEmptyTitle: { color: C.text, fontSize: 14, fontWeight: '700', marginTop: 10 },
  bookmarksEmptyText: { color: C.muted, fontSize: 10, marginTop: 5 },
  bookmarkItem: { flexDirection: 'row', paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  bookmarkRail: { width: 18, alignItems: 'center', paddingTop: 5 },
  bookmarkDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.sea },
  bookmarkLine: { width: 1, flex: 1, backgroundColor: '#D5DDD7', marginTop: 5 },
  bookmarkContent: { flex: 1, paddingHorizontal: 8 },
  bookmarkChapter: { color: '#397A76', fontSize: 11, fontWeight: '800' },
  bookmarkLocation: { color: '#8A9898', fontSize: 9, marginTop: 3 },
  bookmarkExcerpt: { color: C.text, fontFamily: Platform.select({ android: 'serif', ios: 'Songti SC' }), fontSize: 13, lineHeight: 20, marginTop: 7 },
  bookmarkDelete: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  conversationItem: { minHeight: 126, flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  conversationSpark: { width: 30, height: 34, borderTopLeftRadius: 15, borderTopRightRadius: 5, borderBottomRightRadius: 15, borderBottomLeftRadius: 5, backgroundColor: C.sea, alignItems: 'center', justifyContent: 'center', marginTop: 3 },
  conversationQuestion: { color: C.text, fontSize: 12, fontWeight: '700', marginTop: 7 },
  conversationViewer: { height: '86%', maxHeight: '86%' },
  dragHandleZone: { height: 27, marginHorizontal: -22, alignItems: 'center', justifyContent: 'flex-start' },
  historyHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  historyTeleportMark: { width: 34, height: 39, borderTopLeftRadius: 17, borderTopRightRadius: 5, borderBottomRightRadius: 17, borderBottomLeftRadius: 5, backgroundColor: C.sea, alignItems: 'center', justifyContent: 'center' },
  historyMode: { color: C.sea, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  historyChapter: { color: C.text, fontFamily: 'serif', fontSize: 14, marginTop: 3 },
  returnButton: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 34, paddingHorizontal: 9, borderWidth: 1, borderColor: '#BCD1CA' },
  returnButtonText: { color: '#397B77', fontSize: 10, fontWeight: '800' },
  historyAnchor: { backgroundColor: '#E4EAE4', borderLeftWidth: 2, borderLeftColor: C.sea, padding: 12, marginTop: 11 },
  historyAnchorLabel: { color: '#397873', fontSize: 9, fontWeight: '800', marginBottom: 5 },
  historyAnchorText: { color: '#526466', fontFamily: 'serif', fontSize: 12, lineHeight: 19 },
  historyMessages: { paddingTop: 14, paddingBottom: 35 },
  historyScroll: { flex: 1 },
  historyQuestionBlock: { alignSelf: 'flex-end', maxWidth: '88%', backgroundColor: '#DDEBE6', paddingHorizontal: 13, paddingVertical: 10, marginBottom: 11 },
  historyQuestionLabel: { color: '#43827D', fontSize: 8, fontWeight: '800', marginBottom: 4 },
  historyQuestionText: { color: C.text, fontSize: 13, lineHeight: 19 },
  historyAnswerBlock: { backgroundColor: C.white, borderWidth: 1, borderColor: '#D5DDD7', padding: 15, marginBottom: 14 },
  historyEnd: { color: '#94A09F', fontSize: 9, textAlign: 'center', marginTop: 4 },
  historyThinking: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingVertical: 14 },
  historyError: { color: '#9A5D42', backgroundColor: '#F4E6DC', fontSize: 10, lineHeight: 16, padding: 10, marginBottom: 10 },
  historyComposer: { minHeight: 58, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3F5F0', paddingVertical: 7 },
  historyInput: { flex: 1, minHeight: 40, maxHeight: 88, backgroundColor: C.white, borderWidth: 1, borderColor: '#CAD3CC', color: C.text, fontSize: 12, paddingHorizontal: 12, paddingVertical: 8, marginRight: 8 },
  typeSheet: { height: '82%', maxHeight: '82%', paddingBottom: 0 },
  typeScroll: { paddingBottom: 34 },
  controlLabel: { color: C.muted, fontSize: 11, marginTop: 15, marginBottom: 8 },
  typePreview: { minHeight: 86, marginTop: 14, paddingHorizontal: 15, paddingVertical: 10, justifyContent: 'center' },
  typePreviewText: { color: C.text, fontFamily: Platform.select({ android: 'serif', ios: 'Songti SC' }), textAlign: 'center' },
  layoutPairRow: { flexDirection: 'row', gap: 10 },
  layoutPairGroup: { flex: 1, minWidth: 0 },
  layoutPairLabel: { marginTop: 0 },
  fontSizeSliderRow: { flexDirection: 'row', marginTop: 15 },
  optionRow: { flexDirection: 'row', gap: 7 },
  inlineSettingRow: { minHeight: 58, marginTop: 15, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inlineSettingCopy: { flex: 1, paddingRight: 12 },
  inlineSettingTitle: { fontSize: 12, fontWeight: '700' },
  inlineSettingHint: { fontSize: 9, marginTop: 4 },
  inlineSettingControl: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  inlineSettingValue: { fontSize: 10, fontWeight: '700' },
  spacingSliderRow: { flexDirection: 'row', gap: 8 },
  spacingSliderCard: { flex: 1, minHeight: 70, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingTop: 9, paddingBottom: 3 },
  spacingSliderHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  spacingSliderLabel: { fontSize: 11, fontWeight: '700' },
  spacingSliderValue: { minWidth: 28, textAlign: 'right', fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] },
  spacingSlider: { width: '100%', height: 36, marginTop: 2 },
  marginGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  marginSliderCard: { width: '48.5%', minHeight: 72, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingTop: 9, paddingBottom: 3 },
  marginSliderHead: { flexDirection: 'row', alignItems: 'center' },
  marginDirectionIcon: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  marginDirection: { flex: 1, marginLeft: 7, fontSize: 11, fontWeight: '700' },
  marginValue: { minWidth: 24, textAlign: 'right', fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] },
  marginSlider: { width: '100%', height: 34, marginTop: 1 },
  appearanceOption: { flex: 1, minHeight: 38, borderWidth: 1, borderColor: C.line, backgroundColor: C.white, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
  appearanceOptionActive: { borderColor: C.sea, backgroundColor: '#E0ECE8' },
  appearanceOptionText: { color: C.muted, fontSize: 11 },
  appearanceOptionTextActive: { fontWeight: '800' },
  themeRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 7 },
  themeChoice: { flex: 1, borderWidth: 1, borderColor: C.line, padding: 8, alignItems: 'center' },
  themeChoiceActive: { borderColor: C.sea, backgroundColor: '#E7EFEB' },
  themeSwatch: { height: 35, alignSelf: 'stretch', borderWidth: StyleSheet.hairlineWidth, borderColor: '#B9C1BC' },
  themeName: { color: C.text, fontSize: 11, marginTop: 7 },
  aiSheet: { minHeight: 0, maxHeight: '82%' },
  aiSheetExpanded: { height: '82%' },
  aiScroll: { flexShrink: 1 },
  aiScrollContent: { paddingBottom: 12 },
  aiHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9 },
  aiTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  miniSpark: { width: 30, height: 34, borderTopLeftRadius: 15, borderTopRightRadius: 5, borderBottomLeftRadius: 5, borderBottomRightRadius: 15, backgroundColor: C.sea, alignItems: 'center', justifyContent: 'center' },
  aiTitle: { color: C.text, fontSize: 21, fontFamily: 'serif' },
  contextCard: { backgroundColor: '#E5EAE4', borderLeftWidth: 2, borderLeftColor: C.sea, padding: 14, marginTop: 10 },
  contextLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 7 },
  contextLabel: { color: '#397873', fontSize: 10, fontWeight: '700' },
  contextRange: { color: '#819091', fontSize: 9 },
  contextText: { color: '#4E6264', fontFamily: 'serif', fontSize: 13, lineHeight: 21 },
  contextImages: { gap: 8, paddingTop: 10, paddingBottom: 2 },
  contextImagePress: { width: 62, height: 62 },
  contextImage: { width: 62, height: 62, borderWidth: 1, backgroundColor: '#DDE5DF', resizeMode: 'cover' },
  contextImageIndex: { position: 'absolute', right: 3, bottom: 3, minWidth: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  contextImageIndexText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
  contextControlLabel: { color: C.muted, fontSize: 10, fontWeight: '700', marginTop: 14, marginBottom: 7 },
  contextSliderHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 14 },
  contextSliderValue: { fontSize: 11, fontWeight: '800', marginBottom: 7 },
  contextSlider: { width: '100%', height: 36, marginTop: -1 },
  contextSliderMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: -4 },
  contextSliderHint: { fontSize: 9 },
  intentGrid: { flexDirection: 'row', gap: 7, marginTop: 12 },
  intentButton: { flex: 1, height: 38, backgroundColor: C.white, borderWidth: 1, borderColor: '#D0D9D3', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  intentTitle: { color: C.text, fontSize: 11, fontWeight: '700' },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 35, justifyContent: 'center' },
  thinkingOrb: { width: 42, height: 48, borderTopLeftRadius: 21, borderTopRightRadius: 6, borderBottomRightRadius: 21, borderBottomLeftRadius: 6, backgroundColor: C.sea, alignItems: 'center', justifyContent: 'center' },
  thinkingTitle: { color: C.text, fontSize: 14, fontWeight: '700' },
  thinkingNote: { color: C.muted, fontSize: 10, marginTop: 4 },
  answerCard: { marginTop: 17, backgroundColor: C.white, padding: 18, borderWidth: 1, borderColor: '#D5DDD7' },
  answerLabel: { color: C.sea, fontSize: 10, letterSpacing: 1.5, fontWeight: '800', marginBottom: 11 },
  answerText: { color: C.text, fontSize: 15, lineHeight: 25 },
  askAgain: { flexDirection: 'row', gap: 5, alignItems: 'center', marginTop: 15 },
  askAgainText: { color: C.sea, fontSize: 11, fontWeight: '700' },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F5E8DF', padding: 12, marginTop: 12 },
  errorText: { flex: 1, color: '#745543', fontSize: 11, lineHeight: 17 },
  errorLink: { color: '#A35E3D', fontSize: 11, fontWeight: '800' },
  aiComposer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, paddingBottom: 5 },
  questionBox: { minHeight: 50, borderWidth: 1, borderColor: '#CAD3CC', backgroundColor: C.white, flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  questionInput: { flex: 1, color: C.text, fontSize: 13, paddingHorizontal: 14, paddingVertical: 10, maxHeight: 90 },
  sendButton: { width: 34, height: 34, borderRadius: 17, marginRight: 7, backgroundColor: C.sea, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { backgroundColor: '#B8C3BF' },
  privacyNote: { color: '#8A9899', fontSize: 9, textAlign: 'center', marginBottom: 4 },
  imagePreviewRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18 },
  imagePreviewCard: { width: '100%', maxWidth: 520, height: '82%', maxHeight: 476, borderWidth: 1, overflow: 'hidden', elevation: 18, shadowColor: '#071315', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 22 },
  imagePreviewImage: { width: '100%', flex: 1, minHeight: 0, backgroundColor: '#0A1719' },
  imagePreviewFooter: { minHeight: 56, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 16, paddingRight: 10 },
  imagePreviewLabel: { fontSize: 11, fontWeight: '700' },
  settingsPage: { flex: 1, backgroundColor: C.paper },
  settingsTop: { height: 62, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  settingsTopTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  saveText: { color: '#397F7B', fontSize: 14, fontWeight: '800', width: 42, textAlign: 'center' },
  settingsScroll: { padding: 24, paddingBottom: 50 },
  settingsIntro: { marginBottom: 30 },
  settingsMark: { width: 46, height: 53, borderTopLeftRadius: 23, borderTopRightRadius: 6, borderBottomLeftRadius: 6, borderBottomRightRadius: 23, backgroundColor: C.sea, alignItems: 'center', justifyContent: 'center', marginBottom: 17 },
  settingsIntroTitle: { color: C.text, fontFamily: 'serif', fontSize: 25 },
  settingsIntroText: { color: C.muted, fontSize: 12, lineHeight: 20, marginTop: 9 },
  field: { marginBottom: 18 },
  fieldLabel: { color: C.text, fontSize: 11, fontWeight: '700', marginBottom: 8 },
  fieldInput: { height: 50, backgroundColor: '#F7F8F4', borderWidth: 1, borderColor: C.line, paddingHorizontal: 14, color: C.text, fontSize: 13 },
  privacyCard: { flexDirection: 'row', gap: 12, borderTopWidth: 1, borderTopColor: C.line, marginTop: 10, paddingTop: 21 },
  privacyTitle: { color: C.text, fontWeight: '700', fontSize: 12 },
  privacyBody: { color: C.muted, fontSize: 11, lineHeight: 18, marginTop: 5 },
  autoSaveNote: { color: '#6E8281', fontSize: 10, marginTop: -6, marginBottom: 14 },
});

const markdownStyles = StyleSheet.create({
  body: { color: C.text, fontSize: 15, lineHeight: 25 },
  paragraph: { marginTop: 0, marginBottom: 11 },
  heading1: { color: C.text, fontFamily: 'serif', fontSize: 21, lineHeight: 29, marginTop: 8, marginBottom: 11 },
  heading2: { color: C.text, fontFamily: 'serif', fontSize: 18, lineHeight: 26, marginTop: 8, marginBottom: 9 },
  heading3: { color: C.text, fontSize: 16, lineHeight: 24, fontWeight: '700', marginTop: 6, marginBottom: 7 },
  strong: { color: '#153B3D', fontWeight: '800' },
  em: { color: '#4D6263', fontStyle: 'italic' },
  bullet_list: { marginBottom: 10 },
  ordered_list: { marginBottom: 10 },
  list_item: { marginBottom: 5 },
  bullet_list_icon: { color: C.sea, marginRight: 8 },
  blockquote: { backgroundColor: '#E7ECE6', borderLeftColor: C.sea, borderLeftWidth: 3, paddingHorizontal: 12, paddingVertical: 7, marginVertical: 8 },
  code_inline: { color: '#315B5A', backgroundColor: '#E3E9E4', fontFamily: Platform.select({ android: 'monospace', ios: 'Menlo' }), fontSize: 13, paddingHorizontal: 4 },
  fence: { color: '#D8E7E4', backgroundColor: C.ink2, borderColor: C.ink2, fontFamily: Platform.select({ android: 'monospace', ios: 'Menlo' }), fontSize: 12, lineHeight: 19, padding: 12, marginVertical: 8 },
  link: { color: '#347E79', textDecorationLine: 'underline' },
  hr: { backgroundColor: C.line, height: StyleSheet.hairlineWidth, marginVertical: 14 },
});
