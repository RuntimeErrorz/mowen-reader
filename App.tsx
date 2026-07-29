import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
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
import { askAI, AIIntent } from './src/ai';
import { demoBook } from './src/demoBook';
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
import { AIConversation, AIMessage, AISettings, Book, Bookmark, BookSummary, ReaderPrefs } from './src/types';

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

  useEffect(() => {
    (async () => {
      try {
        const [savedLibrary, savedPrefs, savedAI, savedBookmarks, savedConversations] = await Promise.all([loadLibrary(), loadPrefs(), loadAISettings(), loadBookmarks(), loadConversations()]);
        setPrefs(savedPrefs);
        setAiSettings(savedAI);
        setBookmarks(savedBookmarks);
        setConversations(savedConversations);
        if (!savedLibrary.length) {
          await saveBook(demoBook);
          const seeded = [summarizeBook(demoBook)];
          await saveLibrary(seeded);
          setLibrary(seeded);
        } else setLibrary(savedLibrary);
      } catch (error) {
        Alert.alert('无法打开书架', error instanceof Error ? error.message : '本地数据读取失败');
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const openBook = async (summary: BookSummary) => {
    const fullBook = await loadBook(summary.id);
    if (!fullBook) {
      Alert.alert('找不到这本书', '书籍文件可能已被系统清理，请重新导入。');
      return;
    }
    setBook(fullBook);
    setScreen('reader');
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
      await saveBook(parsed);
      const next = [summarizeBook(parsed), ...library];
      setLibrary(next);
      await saveLibrary(next);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await openBook(summarizeBook(parsed));
    } catch (error) {
      Alert.alert('导入失败', error instanceof Error ? error.message : '无法解析这个文件');
    } finally {
      setImporting(false);
    }
  };

  const updateProgress = async (id: string, chapter: number, paragraph: number, fullBook: Book) => {
    const totalBlocks = fullBook.chapters.reduce((sum, item) => sum + item.paragraphs.length, 0);
    const blocksBefore = fullBook.chapters.slice(0, chapter).reduce((sum, item) => sum + item.paragraphs.length, 0);
    const next = library.map((item) => item.id === id ? {
      ...item,
      currentChapter: chapter,
      currentParagraph: paragraph,
      progress: Math.min(1, (blocksBefore + paragraph + 1) / Math.max(1, totalBlocks)),
      lastReadAt: Date.now(),
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
            importing={importing}
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
            onProgress={(chapter, paragraph) => updateProgress(book.id, chapter, paragraph, book)}
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
  importing: boolean;
  onImport: () => void;
  onOpen: (book: BookSummary) => void;
  onRemove: (book: BookSummary) => void;
  onSettings: () => void;
}) {
  const active = [...props.library].sort((a, b) => b.lastReadAt - a.lastReadAt)[0];
  const totalProgress = props.library.reduce((sum, item) => sum + item.progress, 0);
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.library}>
      <NativeStatusBar backgroundColor={C.ink} />
      <View style={styles.libraryHeader}>
        <View>
          <Text style={styles.eyebrow}>MÒ WÈN · READER</Text>
          <Text style={styles.libraryTitle}>墨问</Text>
        </View>
        <Pressable accessibilityLabel="AI 设置" onPress={props.onSettings} style={({ pressed }) => [styles.iconButtonDark, pressed && styles.pressed]}>
          <Ionicons name="options-outline" size={22} color={C.white} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.libraryScroll} showsVerticalScrollIndicator={false}>
        <View style={styles.quoteBlock}>
          <View style={styles.quoteRule} />
          <Text style={styles.quote}>书页沉默，{`\n`}问题让它开口。</Text>
          <Text style={styles.quoteNote}>长按任意段落，沿着上下文继续理解</Text>
        </View>

        {active && (
          <Pressable onPress={() => props.onOpen(active)} style={({ pressed }) => [styles.continueCard, pressed && styles.cardPressed]}>
            <LinearGradient colors={['#294B50', '#1A373D']} style={styles.continueInner}>
              <View style={styles.continueTop}>
                <Text style={styles.continueLabel}>继续阅读</Text>
                <Text style={styles.continuePercent}>{Math.round(active.progress * 100)}%</Text>
              </View>
              <Text numberOfLines={2} style={styles.continueTitle}>{active.title}</Text>
              <Text numberOfLines={1} style={styles.continueAuthor}>{active.author}</Text>
              <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.max(3, active.progress * 100)}%` }]} /></View>
              <View style={styles.continueFoot}>
                <Text style={styles.continueMeta}>第 {active.currentChapter + 1} / {active.chapterCount} 章</Text>
                <View style={styles.arrowCircle}><Ionicons name="arrow-forward" size={17} color={C.ink} /></View>
              </View>
            </LinearGradient>
          </Pressable>
        )}

        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>书架</Text>
          <Text style={styles.sectionCount}>{props.library.length} 本 · 累计进度 {Math.round(totalProgress * 100)}%</Text>
        </View>
        <View style={styles.bookGrid}>
          {props.library.map((item, index) => (
            <BookTile key={item.id} item={item} index={index} onOpen={() => props.onOpen(item)} onRemove={() => props.onRemove(item)} />
          ))}
          <Pressable onPress={props.onImport} style={({ pressed }) => [styles.addTile, pressed && styles.cardPressed]}>
            {props.importing ? <ActivityIndicator color={C.sea} /> : <Ionicons name="add" size={30} color={C.sea} />}
            <Text style={styles.addText}>{props.importing ? '正在拆书…' : '导入 EPUB'}</Text>
            <Text style={styles.addHint}>文件仅保存在本机</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function BookTile({ item, index, onOpen, onRemove }: { item: BookSummary; index: number; onOpen: () => void; onRemove: () => void }) {
  const covers = [
    ['#8DA9A6', '#355B61'], ['#A5A797', '#4E554F'], ['#B58D73', '#654B42'], ['#78919E', '#354D59'],
  ];
  const colors = covers[index % covers.length] as [string, string];
  return (
    <View style={styles.bookTileWrap}>
      <Pressable onPress={onOpen} onLongPress={onRemove} style={({ pressed }) => [styles.bookTile, pressed && styles.cardPressed]}>
        {item.cover ? <Image source={{ uri: item.cover }} style={styles.coverImage} /> : (
          <LinearGradient colors={colors} style={styles.coverFallback}>
            <View style={styles.coverLine} />
            <Text numberOfLines={4} style={styles.coverTitle}>{item.title}</Text>
            <Text numberOfLines={1} style={styles.coverAuthor}>{item.author}</Text>
            <Text style={styles.coverSeal}>墨问</Text>
          </LinearGradient>
        )}
        {item.progress > 0 && <View style={styles.bookProgress}><View style={[styles.bookProgressFill, { width: `${item.progress * 100}%` }]} /></View>}
      </Pressable>
      <Text numberOfLines={1} style={styles.tileTitle}>{item.title}</Text>
      <Text numberOfLines={1} style={styles.tileAuthor}>{item.author}</Text>
    </View>
  );
}

function ReaderScreen(props: {
  book: Book;
  summary: BookSummary;
  prefs: ReaderPrefs;
  aiSettings: AISettings;
  bookmarks: Bookmark[];
  conversations: AIConversation[];
  onBack: () => void;
  onPrefs: (value: ReaderPrefs) => void;
  onProgress: (chapter: number, paragraph: number) => void;
  onAISettings: () => void;
  onBookmarksChange: (bookmarks: Bookmark[]) => void;
  onConversationSave: (conversation: AIConversation) => void;
  onConversationDelete: (id: string) => void;
}) {
  const [chapterIndex, setChapterIndex] = useState(Math.min(props.summary.currentChapter, props.book.chapters.length - 1));
  const [paragraphIndex, setParagraphIndex] = useState(props.summary.currentParagraph);
  const [tocOpen, setTocOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [progressDragging, setProgressDragging] = useState(false);
  const [dragProgress, setDragProgress] = useState(0);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [activeHistory, setActiveHistory] = useState<AIConversation | null>(null);
  const [chromeVisible, setChromeVisible] = useState(false);
  const chromeAnim = useRef(new Animated.Value(0)).current;
  const lastLongPressAt = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const blockPositions = useRef<Record<number, number>>({});
  const currentBlockRef = useRef(paragraphIndex);
  const progressSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressDragActive = useRef(false);
  const progressDragStartX = useRef(0);
  const progressDragStartValue = useRef(0);
  const liveChapterRef = useRef(chapterIndex);
  const liveParagraphRef = useRef(paragraphIndex);
  const scrollRequestRef = useRef(0);
  const lastDragUpdate = useRef(0);
  const historyReturnRef = useRef<{ chapter: number; paragraph: number } | null>(null);
  const historyTeleporting = useRef(false);
  const { width: windowWidth } = useWindowDimensions();
  const chapter = props.book.chapters[chapterIndex];
  const palette = getReaderPalette(props.prefs.theme);
  const totalBlocks = useMemo(() => props.book.chapters.reduce((sum, item) => sum + item.paragraphs.length, 0), [props.book]);
  const blocksBeforeChapter = useMemo(() => props.book.chapters.slice(0, chapterIndex).reduce((sum, item) => sum + item.paragraphs.length, 0), [props.book, chapterIndex]);
  const exactProgress = Math.min(1, (blocksBeforeChapter + paragraphIndex + 1) / Math.max(1, totalBlocks));

  const scrollToBlock = (index: number, animated = false) => {
    const request = ++scrollRequestRef.current;
    const attempt = (remaining: number) => {
      if (request !== scrollRequestRef.current) return;
      const y = blockPositions.current[index];
      if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated });
      else if (remaining > 0) setTimeout(() => attempt(remaining - 1), 80);
    };
    setTimeout(() => attempt(5), 30);
  };
  const chooseChapter = (index: number, targetParagraph = 0, persist = true) => {
    if (index !== chapterIndex) blockPositions.current = {};
    setChapterIndex(index);
    setParagraphIndex(targetParagraph);
    liveChapterRef.current = index;
    liveParagraphRef.current = targetParagraph;
    currentBlockRef.current = targetParagraph;
    setTocOpen(false);
    if (targetParagraph === 0) scrollRef.current?.scrollTo({ y: 0, animated: false });
    else scrollToBlock(targetParagraph);
    if (persist) props.onProgress(index, targetParagraph);
  };
  const focusParagraph = (index: number, openAI = false) => {
    setParagraphIndex(index);
    currentBlockRef.current = index;
    liveChapterRef.current = chapterIndex;
    liveParagraphRef.current = index;
    props.onProgress(chapterIndex, index);
    if (openAI) {
      lastLongPressAt.current = Date.now();
      Haptics.selectionAsync();
      setAiOpen(true);
      setChromeVisible(false);
      Animated.timing(chromeAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start();
    }
  };
  const toggleChrome = () => {
    if (Date.now() - lastLongPressAt.current < 600) return;
    const next = !chromeVisible;
    setChromeVisible(next);
    Animated.timing(chromeAnim, { toValue: next ? 1 : 0, duration: 180, useNativeDriver: true }).start();
  };
  useEffect(() => () => {
    if (progressSaveTimer.current) clearTimeout(progressSaveTimer.current);
    if (progressHoldTimer.current) clearTimeout(progressHoldTimer.current);
  }, []);
  const trackVisibleBlock = (offsetY: number) => {
    if (progressDragActive.current || historyTeleporting.current) return;
    const targetY = offsetY + 90;
    let visibleIndex = 0;
    for (const [indexText, y] of Object.entries(blockPositions.current).sort((a, b) => a[1] - b[1])) {
      if (y > targetY) break;
      visibleIndex = Number(indexText);
    }
    if (visibleIndex === currentBlockRef.current) return;
    currentBlockRef.current = visibleIndex;
    setParagraphIndex(visibleIndex);
    if (progressSaveTimer.current) clearTimeout(progressSaveTimer.current);
    progressSaveTimer.current = setTimeout(() => props.onProgress(chapterIndex, visibleIndex), 500);
  };
  const currentBookmark = props.bookmarks.find((item) => item.chapterIndex === chapterIndex && item.paragraphIndex === paragraphIndex);
  const locateProgress = (value: number) => {
    let target = Math.min(totalBlocks - 1, Math.max(0, Math.round(value * Math.max(0, totalBlocks - 1))));
    for (let index = 0; index < props.book.chapters.length; index++) {
      const count = props.book.chapters[index].paragraphs.length;
      if (target < count) return { chapter: index, paragraph: target };
      target -= count;
    }
    const lastChapter = props.book.chapters.length - 1;
    return { chapter: lastChapter, paragraph: Math.max(0, props.book.chapters[lastChapter].paragraphs.length - 1) };
  };
  const previewProgress = (value: number) => {
    const now = Date.now();
    if (now - lastDragUpdate.current < 45) return;
    lastDragUpdate.current = now;
    const clamped = Math.max(0, Math.min(1, value));
    const target = locateProgress(clamped);
    setDragProgress(clamped);
    if (target.chapter !== liveChapterRef.current) blockPositions.current = {};
    liveChapterRef.current = target.chapter;
    liveParagraphRef.current = target.paragraph;
    currentBlockRef.current = target.paragraph;
    setChapterIndex(target.chapter);
    setParagraphIndex(target.paragraph);
    if (target.paragraph === 0) scrollRef.current?.scrollTo({ y: 0, animated: false });
    else scrollToBlock(target.paragraph);
  };
  const finishProgressDrag = () => {
    if (progressHoldTimer.current) clearTimeout(progressHoldTimer.current);
    if (!progressDragActive.current) return;
    progressDragActive.current = false;
    setProgressDragging(false);
    props.onProgress(liveChapterRef.current, liveParagraphRef.current);
    Haptics.selectionAsync();
  };
  const toggleCurrentBookmark = () => {
    if (currentBookmark) {
      props.onBookmarksChange(props.bookmarks.filter((item) => item.id !== currentBookmark.id));
      Haptics.selectionAsync();
      return;
    }
    const rawExcerpt = chapter.paragraphs[paragraphIndex] ?? '';
    const excerpt = rawExcerpt.startsWith('[[MOWEN_IMAGE_DATA:')
      ? '〔插图〕'
      : rawExcerpt.replace(/\[\[MOWEN_NOTE_REF:[^\]]+\]\]/g, '〔注〕').slice(0, 120);
    const bookmark: Bookmark = {
      id: `bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      bookId: props.book.id,
      chapterIndex,
      paragraphIndex,
      chapterTitle: chapter.title,
      excerpt,
      createdAt: Date.now(),
    };
    props.onBookmarksChange([...props.bookmarks, bookmark]);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };
  const openConversationHistory = (conversation: AIConversation) => {
    historyReturnRef.current = { chapter: chapterIndex, paragraph: paragraphIndex };
    historyTeleporting.current = true;
    setBookmarksOpen(false);
    chooseChapter(conversation.chapterIndex, conversation.paragraphIndex, false);
    setTimeout(() => setActiveHistory(conversation), 180);
  };
  const closeConversationHistory = () => {
    setActiveHistory(null);
    const returnTo = historyReturnRef.current;
    if (!returnTo) { historyTeleporting.current = false; return; }
    chooseChapter(returnTo.chapter, returnTo.paragraph, false);
    historyReturnRef.current = null;
    setTimeout(() => { historyTeleporting.current = false; }, 450);
  };
  const stayAtConversationHistory = () => {
    setActiveHistory(null);
    historyReturnRef.current = null;
    historyTeleporting.current = false;
    props.onProgress(liveChapterRef.current, liveParagraphRef.current);
    Haptics.selectionAsync();
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.reader, { backgroundColor: palette.bg }]}>
      <NativeStatusBar backgroundColor={palette.bg} barStyle={props.prefs.theme === 'night' ? 'light-content' : 'dark-content'} />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.readerScroll, { paddingHorizontal: props.prefs.pagePadding }]}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={100}
        onScroll={(event) => trackVisibleBlock(event.nativeEvent.contentOffset.y)}
      >
        <Text style={[styles.chapterKicker, { color: palette.accent }]}>CHAPTER {String(chapterIndex + 1).padStart(2, '0')}</Text>
        <Text style={[styles.chapterTitle, { color: palette.text }]}>{chapter.title}</Text>
        <View style={[styles.chapterRule, { backgroundColor: palette.accent }]} />
        {chapter.paragraphs.map((paragraph, index) => {
          const imageData = getImageData(paragraph);
          if (imageData) return (
            <EpubImage
              key={`${chapter.id}-${index}`}
              uri={imageData}
              lineColor={palette.line}
              selected={(aiOpen || !!activeHistory) && index === paragraphIndex}
              accent={palette.accent}
              onPress={toggleChrome}
              onLongPress={() => focusParagraph(index, true)}
              onLayout={(event) => { blockPositions.current[index] = event.nativeEvent.layout.y; }}
            />
          );
          return (
            <Pressable
              key={`${chapter.id}-${index}`}
              delayLongPress={280}
              onPress={toggleChrome}
              onLongPress={() => focusParagraph(index, true)}
              onLayout={(event) => { blockPositions.current[index] = event.nativeEvent.layout.y; }}
              style={[styles.paragraphWrap, { marginBottom: props.prefs.paragraphSpacing }, (aiOpen || !!activeHistory) && index === paragraphIndex && { backgroundColor: palette.focus }]}
            >
              {(aiOpen || !!activeHistory) && index === paragraphIndex && <View style={[styles.focusMark, { backgroundColor: palette.accent }]} />}
              <RichParagraph
                text={paragraph}
                color={palette.text}
                accent={palette.accent}
                fontSize={props.prefs.fontSize}
                lineHeight={props.prefs.fontSize * props.prefs.lineHeight}
                fontStyle={props.prefs.fontStyle}
                textAlign={props.prefs.textAlign}
                onNote={setOpenNoteId}
              />
            </Pressable>
          );
        })}
        <View style={styles.chapterEnd}><View style={[styles.endLine, { backgroundColor: palette.line }]} /><Text style={[styles.endText, { color: palette.muted }]}>本章完</Text><View style={[styles.endLine, { backgroundColor: palette.line }]} /></View>
        {chapterIndex < props.book.chapters.length - 1 && (
          <Pressable onPress={() => chooseChapter(chapterIndex + 1)} style={[styles.nextChapter, { borderColor: palette.line }]}>
            <View><Text style={[styles.nextLabel, { color: palette.muted }]}>下一章</Text><Text numberOfLines={1} style={[styles.nextTitle, { color: palette.text }]}>{props.book.chapters[chapterIndex + 1].title}</Text></View>
            <Ionicons name="arrow-forward" size={20} color={palette.accent} />
          </Pressable>
        )}
      </ScrollView>

      <Animated.View
        pointerEvents={chromeVisible ? 'auto' : 'none'}
        style={[
          styles.readerBottom,
          {
            backgroundColor: palette.bar,
            borderColor: palette.line,
            opacity: chromeAnim,
            transform: [{ translateY: chromeAnim.interpolate({ inputRange: [0, 1], outputRange: [82, 0] }) }],
          },
        ]}
      >
        <Pressable accessibilityLabel="返回书架" onPress={props.onBack} style={styles.bottomAction}><Ionicons name="chevron-back" size={22} color={palette.muted} /><Text style={[styles.bottomLabel, { color: palette.muted }]}>返回</Text></Pressable>
        <Pressable onPress={() => setTocOpen(true)} style={styles.bottomAction}><Ionicons name="list" size={22} color={palette.muted} /><Text style={[styles.bottomLabel, { color: palette.muted }]}>目录</Text></Pressable>
        <View
          accessibilityLabel="长按调整全书进度"
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={(event) => {
            progressDragStartX.current = event.nativeEvent.pageX;
            progressDragStartValue.current = exactProgress;
            progressHoldTimer.current = setTimeout(() => {
              progressDragActive.current = true;
              liveChapterRef.current = chapterIndex;
              liveParagraphRef.current = paragraphIndex;
              setDragProgress(exactProgress);
              setProgressDragging(true);
              Haptics.selectionAsync();
            }, 280);
          }}
          onResponderMove={(event) => {
            if (!progressDragActive.current) return;
            // Half-screen travel is enough to reach either end from any starting point.
            const usableWidth = Math.max(160, (windowWidth - 36) / 2);
            const value = progressDragStartValue.current + (event.nativeEvent.pageX - progressDragStartX.current) / usableWidth;
            previewProgress(value);
          }}
          onResponderRelease={finishProgressDrag}
          onResponderTerminate={finishProgressDrag}
          style={styles.progressPill}
        ><Text style={[styles.progressMain, { color: palette.text }]}>{Math.round(exactProgress * 100)}%</Text><Text style={[styles.progressText, { color: palette.muted }]}>按住拖动 · {chapterIndex + 1}/{props.book.chapters.length} 章</Text></View>
        <Pressable onPress={() => setTypeOpen(true)} style={styles.bottomAction}><Text style={[styles.bottomAa, { color: palette.muted }]}>Aa</Text><Text style={[styles.bottomLabel, { color: palette.muted }]}>外观</Text></Pressable>
        <Pressable onPress={() => setBookmarksOpen(true)} style={styles.bottomAction}><Ionicons name="albums-outline" size={21} color={(props.bookmarks.length + props.conversations.length) ? palette.accent : palette.muted} /><Text style={[styles.bottomLabel, { color: palette.muted }]}>页边 {(props.bookmarks.length + props.conversations.length) || ''}</Text></Pressable>
      </Animated.View>

      {progressDragging && (
        <View pointerEvents="none" style={[styles.liveProgressCard, { backgroundColor: palette.bar, borderColor: palette.line }]}>
          <View style={styles.liveProgressTop}><Text style={[styles.liveProgressLabel, { color: palette.accent }]}>正在跳转</Text><Text style={[styles.liveProgressPercent, { color: palette.text }]}>{Math.round(dragProgress * 100)}%</Text></View>
          <Text numberOfLines={1} style={[styles.liveProgressChapter, { color: palette.text }]}>{props.book.chapters[liveChapterRef.current]?.title}</Text>
          <View style={[styles.liveProgressTrack, { backgroundColor: palette.line }]}><View style={[styles.liveProgressFill, { backgroundColor: palette.accent, width: `${dragProgress * 100}%` }]} /></View>
          <Text style={[styles.liveProgressHint, { color: palette.muted }]}>左右拖动，正文实时跳转；松手保存</Text>
        </View>
      )}

      <TOCModal visible={tocOpen} chapters={props.book.chapters.map((c) => c.title)} current={chapterIndex} onChoose={chooseChapter} onClose={() => setTocOpen(false)} />
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
        settings={props.aiSettings}
        onSaveConversation={props.onConversationSave}
        onSettings={() => { setAiOpen(false); props.onAISettings(); }}
        onClose={() => setAiOpen(false)}
      />
      <FootnoteModal
        visible={!!openNoteId}
        note={openNoteId ? chapter.notes?.[openNoteId] : undefined}
        onClose={() => setOpenNoteId(null)}
      />
      <BookmarksModal
        visible={bookmarksOpen}
        bookmarks={props.bookmarks}
        currentBookmark={currentBookmark}
        chapterTitle={chapter.title}
        paragraphIndex={paragraphIndex}
        onToggleCurrent={toggleCurrentBookmark}
        onChoose={(bookmark) => { setBookmarksOpen(false); chooseChapter(bookmark.chapterIndex, bookmark.paragraphIndex); }}
        onDelete={(bookmark) => props.onBookmarksChange(props.bookmarks.filter((item) => item.id !== bookmark.id))}
        conversations={props.conversations}
        onChooseConversation={openConversationHistory}
        onDeleteConversation={props.onConversationDelete}
        onClose={() => setBookmarksOpen(false)}
      />
      <ConversationViewerModal
        conversation={activeHistory}
        book={props.book}
        settings={props.aiSettings}
        onUpdate={(conversation) => { setActiveHistory(conversation); props.onConversationSave(conversation); }}
        onReturn={closeConversationHistory}
        onStay={stayAtConversationHistory}
      />
    </SafeAreaView>
  );
}

function TOCModal({ visible, chapters, current, onChoose, onClose }: { visible: boolean; chapters: string[]; current: number; onChoose: (index: number) => void; onClose: () => void }) {
  const listRef = useRef<FlatList<string>>(null);
  useEffect(() => {
    if (!visible || !chapters.length) return;
    const timer = setTimeout(() => listRef.current?.scrollToIndex({ index: Math.min(current, chapters.length - 1), viewPosition: 0.35, animated: false }), 80);
    return () => clearTimeout(timer);
  }, [visible, current, chapters.length]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} />
      <View style={styles.sheet}>
        <SheetHandle />
        <View style={styles.sheetHeader}><View><Text style={styles.sheetEyebrow}>CONTENTS</Text><Text style={styles.sheetTitle}>目录</Text></View><Pressable onPress={onClose} style={styles.closeButton}><Ionicons name="close" size={20} color={C.text} /></Pressable></View>
        <FlatList
          ref={listRef}
          style={styles.tocList}
          data={chapters}
          keyExtractor={(title, index) => `${title}-${index}`}
          getItemLayout={(_data, index) => ({ length: 60, offset: 60 * index, index })}
          initialScrollIndex={Math.min(current, Math.max(0, chapters.length - 1))}
          onScrollToIndexFailed={(info) => listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false })}
          renderItem={({ item: title, index }) => (
            <Pressable onPress={() => onChoose(index)} style={[styles.tocItem, index === current && styles.tocItemActive]}>
              <Text style={[styles.tocNumber, index === current && styles.tocActiveText]}>{String(index + 1).padStart(2, '0')}</Text>
              <Text numberOfLines={2} style={[styles.tocTitle, index === current && styles.tocActiveText]}>{title}</Text>
              {index === current && <View style={styles.currentDot} />}
            </Pressable>
          )}
          ListFooterComponent={<View style={{ height: 30 }} />}
        />
      </View>
    </Modal>
  );
}

function ProgressModal({ visible, book, progress, onJump, onClose }: { visible: boolean; book: Book; progress: number; onJump: (chapter: number, paragraph: number) => void; onClose: () => void }) {
  const [preview, setPreview] = useState(progress);
  useEffect(() => { if (visible) setPreview(progress); }, [visible, progress]);
  const totalBlocks = Math.max(1, book.chapters.reduce((sum, item) => sum + item.paragraphs.length, 0));
  const locate = (value: number) => {
    let target = Math.min(totalBlocks - 1, Math.max(0, Math.round(value * (totalBlocks - 1))));
    for (let chapter = 0; chapter < book.chapters.length; chapter++) {
      const count = book.chapters[chapter].paragraphs.length;
      if (target < count) return { chapter, paragraph: target };
      target -= count;
    }
    const chapter = book.chapters.length - 1;
    return { chapter, paragraph: Math.max(0, book.chapters[chapter].paragraphs.length - 1) };
  };
  const location = locate(preview);
  const finish = (value: number) => {
    const target = locate(value);
    onJump(target.chapter, target.paragraph);
    Haptics.selectionAsync();
    onClose();
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.progressScrim} onPress={onClose}>
        <Pressable style={styles.progressCard} onPress={() => undefined}>
          <View style={styles.progressCardTop}>
            <View><Text style={styles.progressCardLabel}>全书进度</Text><Text numberOfLines={1} style={styles.progressChapterTitle}>{book.chapters[location.chapter]?.title}</Text></View>
            <Text style={styles.progressBig}>{Math.round(preview * 100)}%</Text>
          </View>
          <Slider
            style={styles.progressSlider}
            minimumValue={0}
            maximumValue={1}
            step={1 / Math.max(1, totalBlocks - 1)}
            value={preview}
            onValueChange={setPreview}
            onSlidingComplete={finish}
            minimumTrackTintColor={C.sea}
            maximumTrackTintColor="#CBD5CF"
            thumbTintColor={C.sea}
          />
          <View style={styles.progressScale}><Text style={styles.progressScaleText}>开头</Text><Text style={styles.progressPositionText}>第 {location.chapter + 1} 章 · 位置 {location.paragraph + 1}</Text><Text style={styles.progressScaleText}>结尾</Text></View>
          <Text style={styles.progressHint}>拖动时预览，松手跳转</Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function BookmarksModal(props: {
  visible: boolean;
  bookmarks: Bookmark[];
  currentBookmark?: Bookmark;
  chapterTitle: string;
  paragraphIndex: number;
  onToggleCurrent: () => void;
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
      <Pressable style={styles.scrim} onPress={props.onClose} />
      <View style={[styles.sheet, styles.bookmarksSheet]}>
        <SheetHandle />
        <View style={styles.sheetHeader}>
          <View><Text style={styles.sheetEyebrow}>MARGINALIA</Text><Text style={styles.sheetTitle}>页边</Text></View>
          <Pressable onPress={props.onClose} style={styles.closeButton}><Ionicons name="close" size={20} color={C.text} /></Pressable>
        </View>
        <View style={styles.marginTabs}>
          <Pressable onPress={() => setTab('bookmarks')} style={[styles.marginTab, tab === 'bookmarks' && styles.marginTabActive]}><Text style={[styles.marginTabText, tab === 'bookmarks' && styles.marginTabTextActive]}>书签 {props.bookmarks.length}</Text></Pressable>
          <Pressable onPress={() => setTab('conversations')} style={[styles.marginTab, tab === 'conversations' && styles.marginTabActive]}><Text style={[styles.marginTabText, tab === 'conversations' && styles.marginTabTextActive]}>AI 对话 {props.conversations.length}</Text></Pressable>
        </View>
        {tab === 'bookmarks' ? <>
        <Pressable onPress={props.onToggleCurrent} style={[styles.currentBookmarkAction, props.currentBookmark && styles.currentBookmarkActionRemove]}>
          <View style={[styles.bookmarkActionIcon, props.currentBookmark && styles.bookmarkActionIconRemove]}><Ionicons name={props.currentBookmark ? 'bookmark' : 'bookmark-outline'} size={19} color={props.currentBookmark ? C.ember : C.sea} /></View>
          <View style={{ flex: 1 }}><Text style={styles.currentBookmarkTitle}>{props.currentBookmark ? '移除当前位置' : '添加当前位置'}</Text><Text numberOfLines={1} style={styles.currentBookmarkMeta}>{props.chapterTitle} · 位置 {props.paragraphIndex + 1}</Text></View>
        </Pressable>
        <FlatList
          data={ordered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={ordered.length ? styles.bookmarksList : styles.bookmarksEmptyList}
          ListEmptyComponent={<View style={styles.bookmarksEmpty}><Ionicons name="bookmark-outline" size={29} color="#9BACAA" /><Text style={styles.bookmarksEmptyTitle}>还没有书签</Text><Text style={styles.bookmarksEmptyText}>滚动到想留下的位置，再点击上方添加。</Text></View>}
          renderItem={({ item }) => (
            <Pressable onPress={() => props.onChoose(item)} style={({ pressed }) => [styles.bookmarkItem, pressed && styles.pressed]}>
              <View style={styles.bookmarkRail}><View style={styles.bookmarkDot} /><View style={styles.bookmarkLine} /></View>
              <View style={styles.bookmarkContent}>
                <Text numberOfLines={1} style={styles.bookmarkChapter}>{item.chapterTitle}</Text>
                <Text style={styles.bookmarkLocation}>第 {item.chapterIndex + 1} 章 · 位置 {item.paragraphIndex + 1}</Text>
                <Text numberOfLines={3} style={styles.bookmarkExcerpt}>{item.excerpt}</Text>
              </View>
              <Pressable accessibilityLabel="删除书签" onPress={(event) => { event.stopPropagation(); props.onDelete(item); }} style={styles.bookmarkDelete}><Ionicons name="close" size={17} color="#889796" /></Pressable>
            </Pressable>
          )}
        />
        </> : <FlatList
          data={orderedConversations}
          keyExtractor={(item) => item.id}
          contentContainerStyle={orderedConversations.length ? styles.bookmarksList : styles.bookmarksEmptyList}
          ListEmptyComponent={<View style={styles.bookmarksEmpty}><Ionicons name="sparkles-outline" size={29} color="#9BACAA" /><Text style={styles.bookmarksEmptyTitle}>还没有 AI 对话</Text><Text style={styles.bookmarksEmptyText}>长按正文提问后，对话会留在对应页边。</Text></View>}
          renderItem={({ item }) => {
            const firstQuestion = item.messages.find((message) => message.role === 'user')?.content ?? '阅读提问';
            const lastAnswer = [...item.messages].reverse().find((message) => message.role === 'assistant')?.content ?? '';
            return (
              <Pressable onPress={() => props.onChooseConversation(item)} style={({ pressed }) => [styles.conversationItem, pressed && styles.pressed]}>
                <View style={styles.conversationSpark}><Ionicons name="sparkles" size={14} color={C.white} /></View>
                <View style={styles.bookmarkContent}>
                  <Text numberOfLines={1} style={styles.bookmarkChapter}>{item.chapterTitle}</Text>
                  <Text style={styles.bookmarkLocation}>第 {item.chapterIndex + 1} 章 · 位置 {item.paragraphIndex + 1} · {item.messages.length / 2} 轮</Text>
                  <Text numberOfLines={1} style={styles.conversationQuestion}>{firstQuestion}</Text>
                  <Text numberOfLines={2} style={styles.bookmarkExcerpt}>{lastAnswer.replace(/[#*_>`]/g, '')}</Text>
                </View>
                <Pressable accessibilityLabel="删除对话" onPress={(event) => { event.stopPropagation(); props.onDeleteConversation(item.id); }} style={styles.bookmarkDelete}><Ionicons name="close" size={17} color="#889796" /></Pressable>
              </Pressable>
            );
          }}
        />}
      </View>
    </Modal>
  );
}

function ConversationViewerModal(props: {
  conversation: AIConversation | null;
  book: Book;
  settings: AISettings;
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
        <Animated.View style={[styles.scrim, { opacity: scrimOpacity }]}><Pressable style={StyleSheet.absoluteFill} onPress={props.onReturn} /></Animated.View>
        <Animated.View style={[styles.sheet, styles.conversationViewer, { transform: [{ translateY }] }]}>
          <View style={styles.dragHandleZone} {...panResponder.panHandlers}>
            <SheetHandle />
          </View>
          <View style={styles.historyHeader}>
            <View style={styles.historyTeleportMark}><Ionicons name="return-down-back" size={17} color={C.white} /></View>
            <View style={{ flex: 1 }}><Text style={styles.historyMode}>临时回看 · 拖动上方灰条可留在这里</Text><Text numberOfLines={1} style={styles.historyChapter}>{conversation.chapterTitle}</Text></View>
            <Pressable onPress={props.onReturn} style={styles.returnButton}><Ionicons name="arrow-undo" size={16} color={C.sea} /><Text style={styles.returnButtonText}>返回原处</Text></Pressable>
          </View>
          <View style={styles.historyAnchor}>
            <Text style={styles.historyAnchorLabel}>当时的原文 · 位置 {conversation.paragraphIndex + 1}</Text>
            <Text numberOfLines={3} style={styles.historyAnchorText}>{conversation.anchorExcerpt}</Text>
          </View>
          <ScrollView ref={scrollRef} style={styles.historyScroll} contentContainerStyle={styles.historyMessages} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {messages.map((message, index) => message.role === 'user' ? (
              <View key={`${message.role}-${index}`} style={styles.historyQuestionBlock}>
                <Text style={styles.historyQuestionLabel}>你问</Text><Text style={styles.historyQuestionText}>{message.content}</Text>
              </View>
            ) : (
              <View key={`${message.role}-${index}`} style={styles.historyAnswerBlock}>
                <Text style={styles.answerLabel}>墨问批注</Text><Markdown style={markdownStyles}>{message.content}</Markdown>
              </View>
            ))}
            {loading && <View style={styles.historyThinking}><ActivityIndicator color={C.sea} /><Text style={styles.thinkingNote}>沿着原对话继续思考…</Text></View>}
            {!!error && <Text style={styles.historyError}>{error}</Text>}
            <Text style={styles.historyEnd}>这段对话留在此处 · {new Date(conversation.updatedAt).toLocaleString()}</Text>
          </ScrollView>
          <View style={styles.historyComposer}>
            <TextInput value={question} onChangeText={setQuestion} placeholder="继续追问这段对话…" placeholderTextColor="#879598" multiline style={styles.historyInput} />
            <Pressable disabled={!question.trim() || loading} onPress={continueConversation} style={[styles.sendButton, (!question.trim() || loading) && styles.sendDisabled]}><Ionicons name="arrow-up" size={18} color={C.white} /></Pressable>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function TypeModal({ visible, value, onChange, onClose }: { visible: boolean; value: ReaderPrefs; onChange: (value: ReaderPrefs) => void; onClose: () => void }) {
  const [trackWidth, setTrackWidth] = useState(1);
  const previewPalette = getReaderPalette(value.theme);
  const themes: { key: ReaderPrefs['theme']; name: string; color: string }[] = [
    { key: 'paper', name: '纸白', color: '#E9ECE5' },
    { key: 'wheat', name: '麦纸', color: '#F1DFB7' },
    { key: 'mist', name: '雾蓝', color: '#DDE7E5' },
    { key: 'night', name: '夜墨', color: '#17292D' },
  ];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} />
      <View style={[styles.sheet, styles.typeSheet]}>
        <SheetHandle />
        <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>阅读外观</Text><Pressable onPress={onClose} style={styles.closeButton}><Ionicons name="close" size={20} color={C.text} /></Pressable></View>
        <ScrollView contentContainerStyle={styles.typeScroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.controlLabel}>字号</Text>
        <View style={styles.sizeControl}>
          <Pressable accessibilityLabel="减小字号" onPress={() => onChange({ ...value, fontSize: Math.max(15, value.fontSize - 1) })} style={({ pressed }) => [styles.sizeButton, pressed && styles.sizeButtonPressed]}><Ionicons name="remove" size={21} color={C.text} /></Pressable>
          <Pressable
            accessibilityRole="adjustable"
            accessibilityLabel={`字号 ${value.fontSize}`}
            onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
            onPress={(event) => {
              const ratio = Math.max(0, Math.min(1, event.nativeEvent.locationX / trackWidth));
              onChange({ ...value, fontSize: 15 + Math.round(ratio * 11) });
            }}
            style={styles.sizeTrackTouch}
          >
            <View style={styles.sizeTrack}>
              <View style={[styles.sizeFill, { width: `${((value.fontSize - 15) / 11) * 100}%` }]} />
              <View style={[styles.sizeThumb, { left: `${((value.fontSize - 15) / 11) * 100}%` }]} />
            </View>
          </Pressable>
          <Pressable accessibilityLabel="增大字号" onPress={() => onChange({ ...value, fontSize: Math.min(26, value.fontSize + 1) })} style={({ pressed }) => [styles.sizeButton, pressed && styles.sizeButtonPressed]}><Ionicons name="add" size={21} color={C.text} /></Pressable>
        </View>
        <Text style={styles.sizeValue}>{value.fontSize} pt · 行距 {value.lineHeight.toFixed(1)}</Text>
        <View style={[styles.typePreview, { backgroundColor: previewPalette.bg }]}><Text numberOfLines={3} style={[styles.typePreviewText, { color: previewPalette.text, fontSize: value.fontSize, lineHeight: value.fontSize * value.lineHeight, fontFamily: readerFontFamily(value.fontStyle), textAlign: value.textAlign }]}>阅读让问题在页边生长，也让熟悉的文字重新显出纹理。</Text></View>

        <Text style={styles.controlLabel}>正文字体</Text>
        <View style={styles.optionRow}>
          <AppearanceOption label="宋体" active={value.fontStyle === 'serif'} onPress={() => onChange({ ...value, fontStyle: 'serif' })} />
          <AppearanceOption label="黑体" active={value.fontStyle === 'sans'} onPress={() => onChange({ ...value, fontStyle: 'sans' })} />
        </View>

        <Text style={styles.controlLabel}>行距</Text>
        <View style={styles.optionRow}>
          {[1.5, 1.7, 1.9, 2.1].map((lineHeight) => <AppearanceOption key={lineHeight} label={lineHeight.toFixed(1)} active={value.lineHeight === lineHeight} onPress={() => onChange({ ...value, lineHeight })} />)}
        </View>

        <Text style={styles.controlLabel}>页边距</Text>
        <View style={styles.optionRow}>
          {[{ label: '窄', value: 18 }, { label: '适中', value: 26 }, { label: '宽', value: 34 }].map((item) => <AppearanceOption key={item.value} label={item.label} active={value.pagePadding === item.value} onPress={() => onChange({ ...value, pagePadding: item.value })} />)}
        </View>

        <Text style={styles.controlLabel}>段间距</Text>
        <View style={styles.optionRow}>
          {[{ label: '紧凑', value: 4 }, { label: '适中', value: 10 }, { label: '舒展', value: 18 }].map((item) => <AppearanceOption key={item.value} label={item.label} active={value.paragraphSpacing === item.value} onPress={() => onChange({ ...value, paragraphSpacing: item.value })} />)}
        </View>

        <Text style={styles.controlLabel}>文字对齐</Text>
        <View style={styles.optionRow}>
          <AppearanceOption label="左对齐" active={value.textAlign === 'left'} onPress={() => onChange({ ...value, textAlign: 'left' })} />
          <AppearanceOption label="两端对齐" active={value.textAlign === 'justify'} onPress={() => onChange({ ...value, textAlign: 'justify' })} />
        </View>

        <Text style={styles.controlLabel}>纸张</Text>
        <View style={styles.themeRow}>
          {themes.map((theme) => <Pressable key={theme.key} onPress={() => onChange({ ...value, theme: theme.key })} style={[styles.themeChoice, value.theme === theme.key && styles.themeChoiceActive]}><View style={[styles.themeSwatch, { backgroundColor: theme.color }]} /><Text style={styles.themeName}>{theme.name}</Text></Pressable>)}
        </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function AppearanceOption({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.appearanceOption, active && styles.appearanceOptionActive, pressed && styles.pressed]}>
      <Text style={[styles.appearanceOptionText, active && styles.appearanceOptionTextActive]}>{label}</Text>
    </Pressable>
  );
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
  settings: AISettings;
  onSaveConversation: (conversation: AIConversation) => void;
  onSettings: () => void;
  onClose: () => void;
}) {
  const [answer, setAnswer] = useState('');
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [contextRadius, setContextRadius] = useState(2);
  const [conversationMessages, setConversationMessages] = useState<AIMessage[]>([]);
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
    setLoading(true); setError(''); setAnswer('');
    controller.current?.abort();
    controller.current = new AbortController();
    try {
      const priorMessages = messagesRef.current;
      const result = await askAI({
        ...props,
        intent,
        question: question.trim(),
        contextRadius,
        history: priorMessages,
        signal: controller.current.signal,
      });
      const userLabel: Record<AIIntent, string> = {
        explain: '解释这段',
        thread: '联系上下文',
        simple: '说简单点',
        question: question.trim(),
      };
      const nextMessages: AIMessage[] = [...priorMessages, { role: 'user', content: userLabel[intent] }, { role: 'assistant', content: result }];
      messagesRef.current = nextMessages;
      setConversationMessages(nextMessages);
      setAnswer(result);
      const rawExcerpt = props.chapter.paragraphs[props.paragraphIndex] ?? '';
      props.onSaveConversation({
        id: sessionId.current,
        bookId: props.bookId,
        chapterIndex: props.chapterIndex,
        paragraphIndex: props.paragraphIndex,
        chapterTitle: props.chapter.title,
        anchorExcerpt: rawExcerpt.startsWith('[[MOWEN_IMAGE_DATA:') ? '〔插图〕' : rawExcerpt.replace(/\[\[MOWEN_NOTE_REF:[^\]]+\]\]/g, '〔注〕').slice(0, 180),
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
  const excerpt = props.chapter.paragraphs[props.paragraphIndex] ?? '';
  const excerptIsImage = excerpt.startsWith('[[MOWEN_IMAGE_DATA:');
  const start = Math.max(0, props.paragraphIndex - contextRadius);
  const end = Math.min(props.chapter.paragraphs.length, props.paragraphIndex + contextRadius + 1);
  const bookImageCount = props.chapter.paragraphs.slice(start, end).filter((item) => item.startsWith('[[MOWEN_IMAGE_DATA:')).length;

  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalRoot}>
        <Pressable style={styles.scrim} onPress={props.onClose} />
        <View style={[styles.sheet, styles.aiSheet]}>
          <SheetHandle />
          <View style={styles.aiHeader}>
            <View style={styles.aiTitleRow}><View style={styles.miniSpark}><Ionicons name="sparkles" size={15} color={C.white} /></View><Text style={styles.aiTitle}>理解此处</Text></View>
            <Pressable onPress={props.onClose} style={styles.closeButton}><Ionicons name="close" size={20} color={C.text} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.contextCard}>
              <View style={styles.contextLabelRow}><Text style={styles.contextLabel}>正在阅读 · 位置 {props.paragraphIndex + 1}</Text><Text style={styles.contextRange}>{bookImageCount} 张图片</Text></View>
              <Text numberOfLines={3} style={styles.contextText}>{excerptIsImage ? '当前是一幅插图，AI 将结合图片内容理解。' : excerpt}</Text>
            </View>
            <Text style={styles.contextControlLabel}>上下文范围</Text>
            <View style={styles.contextOptions}>
              {[1, 2, 5, 10].map((radius) => (
                <Pressable
                  key={radius}
                  onPress={() => { setContextRadius(radius); setAnswer(''); }}
                  style={[styles.contextOption, contextRadius === radius && styles.contextOptionActive]}
                >
                  <Text style={[styles.contextOptionText, contextRadius === radius && styles.contextOptionTextActive]}>前后 {radius}</Text>
                </Pressable>
              ))}
            </View>
            {!answer && !loading && (
              <View style={styles.intentGrid}>
                <IntentButton title="解释这段" onPress={() => run('explain')} />
                <IntentButton title="联系上下文" onPress={() => run('thread')} />
                <IntentButton title="说简单点" onPress={() => run('simple')} />
              </View>
            )}
            {loading && <View style={styles.thinking}><View style={styles.thinkingOrb}><ActivityIndicator color={C.white} /></View><View><Text style={styles.thinkingTitle}>沿着上下文阅读…</Text><Text style={styles.thinkingNote}>只发送当前段落附近的内容</Text></View></View>}
            {!!answer && <View style={styles.answerCard}><Text style={styles.answerLabel}>墨问批注</Text><Markdown style={markdownStyles}>{answer}</Markdown><Pressable onPress={() => { setAnswer(''); setQuestion(''); }} style={styles.askAgain}><Ionicons name="refresh" size={15} color={C.sea} /><Text style={styles.askAgainText}>换一种问法</Text></Pressable></View>}
            {!!error && <View style={styles.errorCard}><Ionicons name="information-circle-outline" size={19} color={C.ember} /><Text style={styles.errorText}>{error}</Text>{!props.settings.apiKey && <Pressable onPress={props.onSettings}><Text style={styles.errorLink}>去配置</Text></Pressable>}</View>}
            <View style={styles.questionBox}>
              <TextInput value={question} onChangeText={setQuestion} placeholder="也可以直接问一个问题…" placeholderTextColor="#879598" multiline style={styles.questionInput} />
              <Pressable disabled={!question.trim() || loading} onPress={() => run('question')} style={[styles.sendButton, (!question.trim() || loading) && styles.sendDisabled]}><Ionicons name="arrow-up" size={18} color={C.white} /></Pressable>
            </View>
            <Text style={styles.privacyNote}>发送范围：书籍信息、所选上下文及范围内插图</Text>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function IntentButton({ title, onPress }: { title: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.intentButton, pressed && styles.pressed]}><Text style={styles.intentTitle}>{title}</Text></Pressable>;
}

function AISettingsModal({ visible, value, onSave, onAutoSave, onClose }: { visible: boolean; value: AISettings; onSave: (value: AISettings) => void; onAutoSave: (value: AISettings) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (visible) setDraft(value); }, [visible, value]);
  useEffect(() => {
    if (!visible || JSON.stringify(draft) === JSON.stringify(value)) return;
    const timer = setTimeout(() => onAutoSave(draft), 500);
    return () => clearTimeout(timer);
  }, [draft, visible, value, onAutoSave]);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.settingsPage}>
        <StatusBar style="dark" />
        <View style={styles.settingsTop}><Pressable onPress={onClose} style={styles.readerIcon}><Ionicons name="close" size={24} color={C.text} /></Pressable><Text style={styles.settingsTopTitle}>AI 理解设置</Text><Pressable onPress={() => onSave(draft)}><Text style={styles.saveText}>完成</Text></Pressable></View>
        <ScrollView contentContainerStyle={styles.settingsScroll} keyboardShouldPersistTaps="handled">
          <View style={styles.settingsIntro}><View style={styles.settingsMark}><Ionicons name="sparkles" size={22} color={C.white} /></View><Text style={styles.settingsIntroTitle}>连接你的模型</Text><Text style={styles.settingsIntroText}>墨问支持 OpenAI-compatible 接口。密钥仅保存在这台设备上，每次只发送你正在阅读位置附近的 5 个段落。</Text></View>
          <Field label="接口地址" value={draft.baseUrl} onChangeText={(baseUrl) => setDraft({ ...draft, baseUrl })} placeholder="https://api.openai.com/v1" autoCapitalize="none" />
          <Field label="模型" value={draft.model} onChangeText={(model) => setDraft({ ...draft, model })} placeholder="qwen3.7-flash" autoCapitalize="none" />
          <Field label="API 密钥 · 系统安全存储" value={draft.apiKey} onChangeText={(apiKey) => setDraft({ ...draft, apiKey })} placeholder="sk-…" autoCapitalize="none" secureTextEntry />
          <Text style={styles.autoSaveNote}>修改会自动保存；API 密钥写入系统安全存储。</Text>
          <View style={styles.privacyCard}><Ionicons name="shield-checkmark-outline" size={23} color={C.sea} /><View style={{ flex: 1 }}><Text style={styles.privacyTitle}>内容边界</Text><Text style={styles.privacyBody}>导入、解析和阅读进度都在本机完成。只有你主动提问时，书籍信息、所选位置附近的文本和随附图片才会发往上面的接口。</Text></View></View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, ...inputProps } = props;
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput {...inputProps} placeholderTextColor="#91A0A1" style={styles.fieldInput} /></View>;
}

function SheetHandle() { return <View style={styles.handle} />; }

function RichParagraph(props: { text: string; color: string; accent: string; fontSize: number; lineHeight: number; fontStyle: ReaderPrefs['fontStyle']; textAlign: ReaderPrefs['textAlign']; onNote: (id: string) => void }) {
  const parts = props.text.split(/(\[\[MOWEN_NOTE_REF:[^\]]+\]\])/g);
  return (
    <Text style={[styles.paragraph, { color: props.color, fontSize: props.fontSize, lineHeight: props.lineHeight, fontFamily: readerFontFamily(props.fontStyle), textAlign: props.textAlign }]}>
      {parts.map((part, index) => {
        const id = part.match(/^\[\[MOWEN_NOTE_REF:([^\]]+)\]\]$/)?.[1];
        if (!id) return part;
        return (
          <Text
            key={`${id}-${index}`}
            accessibilityRole="button"
            accessibilityLabel="查看脚注"
            onPress={() => props.onNote(id)}
            style={[styles.noteRef, { color: props.accent, borderColor: props.accent }]}
          >注</Text>
        );
      })}
    </Text>
  );
}

function FootnoteModal({ visible, note, onClose }: { visible: boolean; note?: string; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.noteScrim} onPress={onClose}>
        <Pressable style={styles.noteCard} onPress={() => undefined}>
          <View style={styles.noteHeader}>
            <View style={styles.noteBadge}><Text style={styles.noteBadgeText}>注</Text></View>
            <Text style={styles.noteTitle}>页边注</Text>
            <Pressable onPress={onClose} style={styles.noteClose}><Ionicons name="close" size={18} color={C.muted} /></Pressable>
          </View>
          <ScrollView style={styles.noteScroll} showsVerticalScrollIndicator={false}>
            <Text selectable style={styles.noteText}>{note || '没有找到这条脚注的内容。'}</Text>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function getImageData(value: string) {
  const match = value.match(/^\[\[MOWEN_IMAGE_DATA:(data:image\/[\s\S]+)\]\]$/);
  return match?.[1];
}

function readerFontFamily(style: ReaderPrefs['fontStyle']) {
  if (style === 'sans') return Platform.select({ android: 'sans-serif', ios: 'PingFang SC' });
  return Platform.select({ android: 'serif', ios: 'Songti SC' });
}

function EpubImage(props: { uri: string; lineColor: string; accent: string; selected: boolean; onPress: () => void; onLongPress: () => void; onLayout?: (event: any) => void }) {
  const [ratio, setRatio] = useState(1.45);
  useEffect(() => {
    Image.getSize(props.uri, (width, height) => {
      if (width > 0 && height > 0) setRatio(Math.max(0.55, Math.min(2.4, width / height)));
    });
  }, [props.uri]);
  return (
    <Pressable onLayout={props.onLayout} onPress={props.onPress} onLongPress={props.onLongPress} delayLongPress={280} style={[styles.epubImageFrame, { borderColor: props.selected ? props.accent : props.lineColor }]}>
      <Image source={{ uri: props.uri }} resizeMode="contain" style={[styles.epubImage, { aspectRatio: ratio }]} />
      {props.selected && <View style={[styles.imageSelectedBadge, { backgroundColor: props.accent }]}><Ionicons name="sparkles" size={12} color={C.white} /><Text style={styles.imageSelectedText}>可询问此图</Text></View>}
    </Pressable>
  );
}

function getReaderPalette(theme: ReaderPrefs['theme']) {
  if (theme === 'night') return { bg: '#17292D', bar: '#1B3034', text: '#D8DFD8', muted: '#8FA3A3', line: '#2D4448', accent: '#74B7B1', focus: '#213A3D' };
  if (theme === 'mist') return { bg: '#DDE7E5', bar: '#E5ECEA', text: '#183034', muted: '#65787A', line: '#BCCBC8', accent: '#3F8582', focus: '#CEE0DC' };
  if (theme === 'wheat') return { bg: '#F1DFB7', bar: '#F6E8C9', text: '#17140F', muted: '#756A56', line: '#D8C398', accent: '#B76C36', focus: '#E8D1A4' };
  return { bg: C.paper, bar: '#EEF0EB', text: C.text, muted: C.muted, line: C.line, accent: '#4C8E8A', focus: '#DDE5DF' };
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
  quoteBlock: { paddingTop: 12, paddingBottom: 28, position: 'relative' },
  quoteRule: { width: 32, height: 2, backgroundColor: C.ember, marginBottom: 18 },
  quote: { color: C.white, fontSize: 26, lineHeight: 38, letterSpacing: 1, fontFamily: Platform.select({ android: 'serif', ios: 'Songti SC' }) },
  quoteNote: { marginTop: 12, color: '#8DA2A4', fontSize: 12 },
  continueCard: { borderRadius: 2, overflow: 'hidden', elevation: 5, shadowColor: '#071315', shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.25, shadowRadius: 14 },
  continueInner: { padding: 22, minHeight: 205 },
  continueTop: { flexDirection: 'row', justifyContent: 'space-between' },
  continueLabel: { color: C.seaPale, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  continuePercent: { color: C.seaPale, fontSize: 12 },
  continueTitle: { color: C.white, fontSize: 24, lineHeight: 32, marginTop: 18, fontFamily: Platform.select({ android: 'serif', ios: 'Songti SC' }) },
  continueAuthor: { color: '#A9BBBC', fontSize: 12, marginTop: 7 },
  progressTrack: { height: 2, backgroundColor: '#496267', marginTop: 21 },
  progressFill: { height: 2, backgroundColor: C.seaPale },
  continueFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  continueMeta: { color: '#8FA6A8', fontSize: 11 },
  arrowCircle: { width: 31, height: 31, borderRadius: 16, backgroundColor: C.seaPale, alignItems: 'center', justifyContent: 'center' },
  cardPressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 34, marginBottom: 18 },
  sectionTitle: { color: C.white, fontSize: 19, letterSpacing: 2, fontFamily: Platform.select({ android: 'serif', ios: 'Songti SC' }) },
  sectionCount: { color: '#789092', fontSize: 10 },
  bookGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  bookTileWrap: { width: '46%', marginBottom: 28 },
  bookTile: { width: '100%', aspectRatio: 0.71, backgroundColor: '#35565A', elevation: 4, shadowColor: '#071315', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8 },
  coverImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  coverFallback: { flex: 1, padding: 16, overflow: 'hidden' },
  coverLine: { height: 1, width: 28, backgroundColor: 'rgba(255,255,255,.65)', marginTop: 5, marginBottom: 20 },
  coverTitle: { color: C.white, fontSize: 20, lineHeight: 28, fontFamily: Platform.select({ android: 'serif', ios: 'Songti SC' }) },
  coverAuthor: { color: 'rgba(255,255,255,.7)', fontSize: 10, marginTop: 10 },
  coverSeal: { position: 'absolute', right: 10, bottom: 11, color: 'rgba(255,255,255,.5)', fontSize: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,.35)', padding: 4 },
  bookProgress: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, backgroundColor: 'rgba(0,0,0,.25)' },
  bookProgressFill: { height: 3, backgroundColor: C.seaPale },
  tileTitle: { color: C.white, fontSize: 13, fontWeight: '600', marginTop: 10 },
  tileAuthor: { color: '#7F9698', fontSize: 10, marginTop: 4 },
  addTile: { width: '46%', aspectRatio: 0.71, borderWidth: 1, borderStyle: 'dashed', borderColor: '#466065', alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  addText: { color: C.seaPale, marginTop: 10, fontSize: 12, fontWeight: '600' },
  addHint: { color: '#687E80', fontSize: 9, marginTop: 5 },
  reader: { flex: 1 },
  readerIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  readerScroll: { paddingTop: 16, paddingBottom: 104 },
  chapterKicker: { fontSize: 10, letterSpacing: 2.2, fontWeight: '800', marginBottom: 12 },
  chapterTitle: { fontSize: 29, lineHeight: 40, fontFamily: Platform.select({ android: 'serif', ios: 'Songti SC' }) },
  chapterRule: { width: 34, height: 2, marginTop: 22, marginBottom: 29 },
  paragraphWrap: { marginHorizontal: -10, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 2, position: 'relative' },
  focusMark: { position: 'absolute', left: -1, top: 12, bottom: 12, width: 2 },
  paragraph: { fontFamily: Platform.select({ android: 'serif', ios: 'Songti SC' }), letterSpacing: 0.35, textAlign: 'justify' },
  noteRef: { fontFamily: Platform.select({ android: 'sans-serif', ios: 'PingFang SC' }), fontSize: 10, fontWeight: '800', borderWidth: 1, borderRadius: 3, paddingHorizontal: 2, marginHorizontal: 2 },
  noteScrim: { flex: 1, backgroundColor: 'rgba(5,18,21,.5)', justifyContent: 'center', paddingHorizontal: 28 },
  noteCard: { maxHeight: '55%', backgroundColor: '#F4F6F1', borderRadius: 4, padding: 18, elevation: 12, shadowColor: '#071315', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 18 },
  noteHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  noteBadge: { width: 25, height: 25, borderRadius: 4, borderWidth: 1, borderColor: C.sea, alignItems: 'center', justifyContent: 'center' },
  noteBadgeText: { color: C.sea, fontSize: 10, fontWeight: '800' },
  noteTitle: { flex: 1, marginLeft: 9, color: C.text, fontSize: 14, fontWeight: '700' },
  noteClose: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  noteScroll: { flexGrow: 0 },
  noteText: { color: '#33494C', fontSize: 14, lineHeight: 23, fontFamily: Platform.select({ android: 'serif', ios: 'Songti SC' }) },
  epubImageFrame: { width: '100%', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 14, marginVertical: 13 },
  epubImage: { width: '100%', minHeight: 120, maxHeight: 520 },
  imageSelectedBadge: { position: 'absolute', right: 7, bottom: 7, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 12 },
  imageSelectedText: { color: C.white, fontSize: 9, fontWeight: '700' },
  chapterEnd: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 35, marginBottom: 28 },
  endLine: { flex: 1, height: StyleSheet.hairlineWidth },
  endText: { fontSize: 10, letterSpacing: 2 },
  nextChapter: { borderWidth: 1, padding: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nextLabel: { fontSize: 10, marginBottom: 5 },
  nextTitle: { fontFamily: 'serif', fontSize: 16, maxWidth: 250 },
  readerBottom: { position: 'absolute', zIndex: 20, bottom: 14, left: 14, right: 14, height: 62, borderWidth: StyleSheet.hairlineWidth, borderRadius: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', elevation: 9, shadowColor: '#071315', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.24, shadowRadius: 12 },
  bottomAction: { width: 46, alignItems: 'center', gap: 3 },
  bottomLabel: { fontSize: 9 },
  bottomAa: { fontFamily: 'serif', fontSize: 18, fontWeight: '600', lineHeight: 22 },
  progressPill: { minWidth: 82, alignItems: 'center' },
  progressMain: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  progressText: { fontSize: 9 },
  liveProgressCard: { position: 'absolute', zIndex: 30, left: 18, right: 18, bottom: 88, borderWidth: StyleSheet.hairlineWidth, borderRadius: 7, paddingHorizontal: 16, paddingTop: 13, paddingBottom: 12, elevation: 11, shadowColor: '#071315', shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.26, shadowRadius: 14 },
  liveProgressTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  liveProgressLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  liveProgressPercent: { fontSize: 20, fontWeight: '800' },
  liveProgressChapter: { fontFamily: Platform.select({ android: 'serif', ios: 'Songti SC' }), fontSize: 14, marginTop: -1, marginBottom: 11 },
  liveProgressTrack: { height: 3, overflow: 'hidden' },
  liveProgressFill: { height: 3 },
  liveProgressHint: { fontSize: 9, textAlign: 'center', marginTop: 9 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4,18,21,.58)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '82%', minHeight: 350, backgroundColor: '#F3F5F0', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 22 },
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
  progressScrim: { flex: 1, backgroundColor: 'rgba(5,18,21,.52)', justifyContent: 'flex-end', paddingHorizontal: 18, paddingBottom: 30 },
  progressCard: { backgroundColor: '#F3F5F0', borderRadius: 8, paddingHorizontal: 19, paddingTop: 18, paddingBottom: 15, elevation: 12, shadowColor: '#071315', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 18 },
  progressCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 15 },
  progressCardLabel: { color: C.sea, fontSize: 9, fontWeight: '800', letterSpacing: 1.5, marginBottom: 5 },
  progressChapterTitle: { color: C.text, fontFamily: 'serif', fontSize: 15, maxWidth: 250 },
  progressBig: { color: C.text, fontSize: 24, fontWeight: '700' },
  progressSlider: { width: '100%', height: 42, marginTop: 8 },
  progressScale: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: -2 },
  progressScaleText: { color: '#899798', fontSize: 9 },
  progressPositionText: { color: '#52696A', fontSize: 10, fontWeight: '700' },
  progressHint: { color: '#8A9899', fontSize: 9, textAlign: 'center', marginTop: 10 },
  bookmarksSheet: { height: '78%', maxHeight: '78%' },
  marginTabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.line, marginBottom: 12 },
  marginTab: { flex: 1, height: 39, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  marginTabActive: { borderBottomColor: C.sea },
  marginTabText: { color: C.muted, fontSize: 11 },
  marginTabTextActive: { color: '#347975', fontWeight: '800' },
  currentBookmarkAction: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#E4ECE8', borderWidth: 1, borderColor: '#C8D9D2', paddingHorizontal: 13, marginTop: 4, marginBottom: 12 },
  currentBookmarkActionRemove: { backgroundColor: '#F1E7DF', borderColor: '#E3CDBF' },
  bookmarkActionIcon: { width: 38, height: 42, borderTopLeftRadius: 19, borderTopRightRadius: 5, borderBottomRightRadius: 19, borderBottomLeftRadius: 5, backgroundColor: '#F4F7F3', alignItems: 'center', justifyContent: 'center' },
  bookmarkActionIconRemove: { backgroundColor: '#F8F1EB' },
  currentBookmarkTitle: { color: C.text, fontSize: 13, fontWeight: '800' },
  currentBookmarkMeta: { color: C.muted, fontSize: 10, marginTop: 4 },
  bookmarksList: { paddingBottom: 28 },
  bookmarksEmptyList: { flexGrow: 1 },
  bookmarksEmpty: { flex: 1, minHeight: 260, alignItems: 'center', justifyContent: 'center' },
  bookmarksEmptyTitle: { color: C.text, fontSize: 14, fontWeight: '700', marginTop: 10 },
  bookmarksEmptyText: { color: C.muted, fontSize: 10, marginTop: 5 },
  bookmarkItem: { minHeight: 118, flexDirection: 'row', paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
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
  sizeControl: { flexDirection: 'row', alignItems: 'center' },
  sizeButton: { width: 42, height: 42, borderWidth: 1, borderColor: C.line, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: C.white },
  sizeButtonPressed: { backgroundColor: '#DDE9E5', borderColor: C.sea },
  sizeTrackTouch: { flex: 1, height: 42, justifyContent: 'center', marginHorizontal: 12 },
  sizeTrack: { width: '100%', height: 2, backgroundColor: C.line, position: 'relative' },
  sizeFill: { height: 2, backgroundColor: C.sea },
  sizeThumb: { position: 'absolute', top: -6, marginLeft: -7, width: 14, height: 14, borderRadius: 7, backgroundColor: C.sea },
  sizeValue: { textAlign: 'center', color: C.muted, fontSize: 10 },
  typePreview: { minHeight: 86, marginTop: 14, paddingHorizontal: 15, paddingVertical: 10, justifyContent: 'center' },
  typePreviewText: { color: C.text, fontFamily: Platform.select({ android: 'serif', ios: 'Songti SC' }), textAlign: 'center' },
  optionRow: { flexDirection: 'row', gap: 7 },
  appearanceOption: { flex: 1, minHeight: 38, borderWidth: 1, borderColor: C.line, backgroundColor: C.white, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
  appearanceOptionActive: { borderColor: C.sea, backgroundColor: '#E0ECE8' },
  appearanceOptionText: { color: C.muted, fontSize: 11 },
  appearanceOptionTextActive: { color: '#347975', fontWeight: '800' },
  themeRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 7 },
  themeChoice: { flex: 1, borderWidth: 1, borderColor: C.line, padding: 8, alignItems: 'center' },
  themeChoiceActive: { borderColor: C.sea, backgroundColor: '#E7EFEB' },
  themeSwatch: { height: 35, alignSelf: 'stretch', borderWidth: StyleSheet.hairlineWidth, borderColor: '#B9C1BC' },
  themeName: { color: C.text, fontSize: 11, marginTop: 7 },
  aiSheet: { height: '82%', maxHeight: '82%' },
  aiHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9 },
  aiTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  miniSpark: { width: 30, height: 34, borderTopLeftRadius: 15, borderTopRightRadius: 5, borderBottomLeftRadius: 5, borderBottomRightRadius: 15, backgroundColor: C.sea, alignItems: 'center', justifyContent: 'center' },
  aiTitle: { color: C.text, fontSize: 21, fontFamily: 'serif' },
  contextCard: { backgroundColor: '#E5EAE4', borderLeftWidth: 2, borderLeftColor: C.sea, padding: 14, marginTop: 10 },
  contextLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 7 },
  contextLabel: { color: '#397873', fontSize: 10, fontWeight: '700' },
  contextRange: { color: '#819091', fontSize: 9 },
  contextText: { color: '#4E6264', fontFamily: 'serif', fontSize: 13, lineHeight: 21 },
  contextControlLabel: { color: C.muted, fontSize: 10, fontWeight: '700', marginTop: 14, marginBottom: 7 },
  contextOptions: { flexDirection: 'row', gap: 7 },
  contextOption: { flex: 1, height: 34, borderWidth: 1, borderColor: '#CCD5CE', backgroundColor: C.white, alignItems: 'center', justifyContent: 'center' },
  contextOptionActive: { borderColor: C.sea, backgroundColor: '#E0ECE8' },
  contextOptionText: { color: C.muted, fontSize: 10 },
  contextOptionTextActive: { color: '#347975', fontWeight: '800' },
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
  questionBox: { minHeight: 50, borderWidth: 1, borderColor: '#CAD3CC', backgroundColor: C.white, flexDirection: 'row', alignItems: 'center', marginTop: 16, marginBottom: 7 },
  questionInput: { flex: 1, color: C.text, fontSize: 13, paddingHorizontal: 14, paddingVertical: 10, maxHeight: 90 },
  sendButton: { width: 34, height: 34, borderRadius: 17, marginRight: 7, backgroundColor: C.sea, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { backgroundColor: '#B8C3BF' },
  privacyNote: { color: '#8A9899', fontSize: 9, textAlign: 'center', marginBottom: 30 },
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
