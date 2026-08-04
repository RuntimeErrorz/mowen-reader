import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, BackHandler, Pressable, StatusBar as NativeStatusBar, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FoliateBookmarkSelection, FoliateLocation, FoliateLongPress, FoliateReader, FoliateReaderHandle, FoliateSearchResult, FoliateTOCItem } from '../../FoliateReader';
import { paragraphMatchesSelection } from '../../aiContext';
import { AIConversation, AISettings, Book, Bookmark, BookSummary, EpubLocator, ReaderPrefs } from '../../types';
import { getReaderPalette } from '../../ui/theme';
import { styles } from '../../ui/styles';
import { AIPanel } from './AIPanel';
import { BookmarksModal, ReaderToolbar, TOCModal, TypeModal } from './ReaderOverlays';
import { ConversationViewerModal } from './ConversationViewerModal';
import { SearchModal } from './SearchModal';

export type ReaderScreenProps = {
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

function normalizeLocationTitle(value?: string) {
  const title = value?.replace(/\s+/g, ' ').trim() || '';
  return title === '未命名章节' ? '' : title;
}

function FoliateReaderScreen(props: ReaderScreenProps & { epubUri: string }) {
  const palette = React.useMemo(() => getReaderPalette(props.prefs.theme), [props.prefs.theme]);
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
  const [readerNavigation, setReaderNavigation] = useState({ canGoBack: false, noteOpen: false, imageOpen: false });
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FoliateSearchResult[]>([]);
  const [searchRunning, setSearchRunning] = useState(false);
  const [searchProgress, setSearchProgress] = useState<number | null>(null);
  const [searchError, setSearchError] = useState('');
  const chromeAnim = useRef(new Animated.Value(0)).current;
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressPreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressPreviewValue = useRef(props.summary.progress);
  const progressDragStart = useRef({ x: 0, value: props.summary.progress });
  const progressDraft = useRef(props.summary.progress);
  const progressDragging = useRef(false);
  const searchRequestId = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { width: windowWidth } = useWindowDimensions();
  const tocItems = React.useMemo<FoliateTOCItem[]>(() => toc.length ? toc : props.book.chapters.map((item) => ({ label: item.title, href: '', depth: 0 })), [props.book.chapters, toc]);

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
      const candidates = [nextChapter, ...props.book.chapters.map((_item, index) => index).filter((index) => index !== nextChapter)];
      for (const candidate of candidates) {
        const found = props.book.chapters[candidate]?.paragraphs.findIndex((paragraph) => paragraphMatchesSelection(paragraph, selection.text)) ?? -1;
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
      locations: { progression: location?.sectionProgression ?? 0, position: location?.position, totalProgression: location?.progression },
      text: selection.kind === 'text' ? { highlight: selection.text } : undefined,
    });
    setChromeVisible(false);
    chromeAnim.setValue(0);
    setAiOpen(true);
  }, [chapterIndex, chromeAnim, location, paragraphIndex, props.book.chapters]);

  useEffect(() => () => {
    if (progressTimer.current) clearTimeout(progressTimer.current);
    if (progressPreviewTimer.current) clearTimeout(progressPreviewTimer.current);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    readerRef.current?.clearSearch();
  }, []);
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const requestId = searchRequestId.current + 1;
    searchRequestId.current = requestId;
    setSearchResults([]);
    setSearchProgress(null);
    setSearchError('');
    const query = searchQuery.trim();
    if (!query) {
      setSearchRunning(false);
      readerRef.current?.clearSearch();
      return;
    }
    setSearchRunning(true);
    searchTimer.current = setTimeout(() => readerRef.current?.search(query, requestId), 240);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchQuery]);
  const handleSearchResults = useCallback((payload: { requestId: number; sectionIndex: number; sectionTitle: string; results: FoliateSearchResult[] }) => {
    if (payload.requestId !== searchRequestId.current) return;
    setSearchResults((current) => [...current, ...payload.results]);
  }, []);
  const handleSearchProgress = useCallback((payload: { requestId: number; progress: number }) => {
    if (payload.requestId !== searchRequestId.current) return;
    setSearchProgress(payload.progress);
  }, []);
  const handleSearchComplete = useCallback((requestId: number) => {
    if (requestId !== searchRequestId.current) return;
    setSearchRunning(false);
    setSearchProgress(null);
  }, []);
  const handleSearchError = useCallback((payload: { requestId: number; message: string }) => {
    if (payload.requestId !== searchRequestId.current) return;
    setSearchRunning(false);
    setSearchProgress(null);
    setSearchError(payload.message);
  }, []);
  const exactProgress = dragProgress ?? location?.progression ?? props.summary.progress;
  const locationTitle = normalizeLocationTitle(location?.title);
  const locationTocIndex = locationTitle ? tocItems.findIndex((item) => normalizeLocationTitle(item.label) === locationTitle) : -1;
  const currentToc = locationTocIndex >= 0 ? locationTocIndex : Math.max(0, location?.sectionIndex ?? 0);
  const chapter = props.book.chapters[chapterIndex] ?? props.book.chapters[0];
  const progressChapterTitle = locationTitle || normalizeLocationTitle(tocItems[currentToc]?.label) || chapter?.title || '';

  const toggleChrome = () => {
    if (progressDragging.current) return;
    const next = !chromeVisible;
    setChromeVisible(next);
    chromeAnim.setValue(next ? 1 : 0);
  };
  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setChromeVisible(false);
    chromeAnim.setValue(0);
  }, [chromeAnim]);
  const closeSearchPanel = useCallback(() => {
    setSearchOpen(false);
  }, []);
  const clearSearchQuery = useCallback(() => {
    searchRequestId.current += 1;
    setSearchQuery('');
    setSearchResults([]);
    setSearchError('');
    setSearchRunning(false);
    setSearchProgress(null);
    readerRef.current?.clearSearch();
  }, []);
  const chooseSearchResult = useCallback((result: FoliateSearchResult) => {
    setSearchOpen(false);
    setChromeVisible(false);
    chromeAnim.setValue(0);
    readerRef.current?.goTo(result.cfi);
  }, [chromeAnim]);
  const goToProgress = (value: number) => readerRef.current?.goToFraction(value);
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
    const link = tocItems[index];
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
    const candidates = [nextChapter, ...props.book.chapters.map((_item, index) => index).filter((index) => index !== nextChapter)];
    for (const candidate of candidates) {
      const found = props.book.chapters[candidate]?.paragraphs.findIndex((paragraph) => paragraphMatchesSelection(paragraph, bookmarkSelection.text)) ?? -1;
      if (found >= 0) { nextChapter = candidate; nextParagraph = found; break; }
    }
    const selectedChapter = props.book.chapters[nextChapter] ?? chapter;
    const excerpt = bookmarkSelection.text.replace(/\s+/g, ' ').trim().slice(0, 240);
    const bookmarkLocator: EpubLocator = { href: bookmarkSelection.cfi, type: 'application/epub+cfi', title: location?.title, locations: { progression: location?.sectionProgression ?? 0, position: location?.position, totalProgression: location?.progression }, text: { highlight: excerpt } };
    const nextBookmarks = [...props.bookmarks, { id: `bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, bookId: props.book.id, chapterIndex: nextChapter, paragraphIndex: nextParagraph, sectionIndex: bookmarkSelection.sectionIndex, chapterTitle: selectedChapter.title, excerpt, locator: bookmarkLocator, createdAt: Date.now() }];
    readerRef.current?.setBookmarks(nextBookmarks);
    props.onBookmarksChange(nextBookmarks);
    cancelBookmarkSelection();
  };
  const deleteBookmark = (bookmark: Bookmark) => {
    const nextBookmarks = props.bookmarks.filter((item) => item.id !== bookmark.id);
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
      if (readerNavigation.imageOpen) { readerRef.current?.back(); return true; }
      if (readerNavigation.noteOpen) { readerRef.current?.back(); return true; }
      if (activeHistory) { closeConversation(); return true; }
      if (aiOpen) { setAiOpen(false); return true; }
      if (searchOpen) { closeSearchPanel(); return true; }
      if (bookmarksOpen) { setBookmarksOpen(false); return true; }
      if (typeOpen) { setTypeOpen(false); return true; }
      if (tocOpen) { setTocOpen(false); return true; }
      if (chromeVisible) { setChromeVisible(false); chromeAnim.setValue(0); return true; }
      if (readerNavigation.canGoBack) { readerRef.current?.back(); return true; }
      props.onBack();
      return true;
    });
    return () => subscription.remove();
  }, [activeHistory, aiOpen, bookmarkSelecting, bookmarksOpen, chromeAnim, chromeVisible, closeConversation, closeSearchPanel, props.onBack, readerNavigation.canGoBack, readerNavigation.imageOpen, readerNavigation.noteOpen, searchOpen, tocOpen, typeOpen]);
  const modalOverlayVisible = aiOpen || !!activeHistory || searchOpen;
  const imageViewerOpen = readerNavigation.imageOpen;

  return (
    <View style={[styles.readerRoot, { backgroundColor: imageViewerOpen ? '#000' : palette.bg }]}>
      <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={[styles.reader, { backgroundColor: imageViewerOpen ? '#000' : palette.bg }]}>
        <NativeStatusBar backgroundColor={imageViewerOpen ? '#000' : palette.bg} barStyle={imageViewerOpen || modalOverlayVisible || props.prefs.theme === 'night' ? 'light-content' : 'dark-content'} />
        <FoliateReader ref={readerRef} epubUri={props.epubUri} title={props.book.title} bookmarks={props.bookmarks} prefs={props.prefs} palette={palette} initialCfi={initialCfi.current} initialProgress={props.summary.progress} onReady={setToc} onLocationChange={handleLocationChange} onCenterTap={toggleChrome} onLongPress={handleLongPress} onBookmarkSelection={setBookmarkSelection} onBookmarkSelectionModeChange={(active) => { setBookmarkSelecting(active); if (!active) setBookmarkSelection(null); if (active) { setChromeVisible(false); chromeAnim.setValue(0); } }} onNavigationStateChange={setReaderNavigation} onSearchResults={handleSearchResults} onSearchProgress={handleSearchProgress} onSearchComplete={handleSearchComplete} onSearchError={handleSearchError} onError={(message) => Alert.alert('Foliate 无法打开 EPUB', message)} />
        {!!location && !chromeVisible && !readerNavigation.noteOpen && !imageViewerOpen && <Text pointerEvents="none" style={{ position: 'absolute', right: Math.max(16, props.prefs.pagePaddingRight), bottom: 16, color: palette.muted, fontSize: 11 }}>{location.position} / {location.totalPositions}</Text>}
        {!readerNavigation.noteOpen && !imageViewerOpen && <ReaderToolbar visible={chromeVisible} animation={chromeAnim} palette={palette} progress={exactProgress} chapter={chapterIndex} chapterCount={Math.max(1, toc.length || props.book.chapters.length)} marginCount={props.bookmarks.length + props.conversations.length} onBack={props.onBack} onContents={() => setTocOpen(true)} onSearch={openSearch} onAppearance={() => setTypeOpen(true)} onMargins={() => setBookmarksOpen(true)} onProgressStart={beginProgressDrag} onProgressMove={moveProgressDrag} onProgressEnd={finishProgressDrag} />}
        {bookmarkSelecting && !readerNavigation.noteOpen && !imageViewerOpen && <View style={styles.bookmarkSelectionActions}><Pressable accessibilityLabel="取消摘录" onPress={cancelBookmarkSelection} style={[styles.bookmarkSelectionButton, { backgroundColor: palette.control, borderColor: palette.line }]}><Text style={[styles.bookmarkSelectionButtonText, { color: palette.muted }]}>取消</Text></Pressable><Pressable accessibilityLabel="保存摘录书签" disabled={!bookmarkSelection?.cfi} onPress={saveBookmarkSelection} style={[styles.bookmarkSelectionButton, { backgroundColor: palette.accent, borderColor: palette.accent }, !bookmarkSelection?.cfi && { opacity: 0.4 }]}><Text style={[styles.bookmarkSelectionButtonText, { color: palette.onAccent }]}>标记</Text></Pressable></View>}
        {dragProgress !== null && !readerNavigation.noteOpen && !imageViewerOpen && <View pointerEvents="none" style={[styles.liveProgressCard, { backgroundColor: palette.bar, borderColor: palette.line }]}><View style={styles.liveProgressTop}><Text style={[styles.liveProgressLabel, { color: palette.accent }]}>全书进度</Text><Text style={[styles.liveProgressPercent, { color: palette.text }]}>{Math.round(dragProgress * 100)}%</Text></View><Text numberOfLines={1} style={[styles.liveProgressChapter, { color: palette.text }]}>{progressChapterTitle}</Text><View style={[styles.liveProgressTrack, { backgroundColor: palette.line }]}><View style={[styles.liveProgressFill, { backgroundColor: palette.accent, width: `${dragProgress * 100}%` }]} /></View></View>}
        <TOCModal palette={palette} visible={tocOpen} chapters={tocItems} current={currentToc} onChoose={chooseToc} onClose={() => setTocOpen(false)} />
        <TypeModal visible={typeOpen} value={props.prefs} onChange={props.onPrefs} onClose={() => setTypeOpen(false)} />
        <BookmarksModal visible={bookmarksOpen} bookmarks={props.bookmarks} chapterTitle={chapter.title} paragraphIndex={paragraphIndex} onChoose={(bookmark) => { setBookmarksOpen(false); if (bookmark.locator?.type === 'application/epub+cfi') readerRef.current?.goTo(bookmark.locator.href); else goToChapter(bookmark.chapterIndex); }} onDelete={deleteBookmark} conversations={props.conversations} onChooseConversation={openConversation} onDeleteConversation={props.onConversationDelete} onClose={() => setBookmarksOpen(false)} palette={palette} />
        <SearchModal visible={searchOpen} palette={palette} query={searchQuery} results={searchResults} searching={searchRunning} progress={searchProgress} error={searchError} onQueryChange={setSearchQuery} onChoose={chooseSearchResult} onClear={clearSearchQuery} onClose={closeSearchPanel} />
      </SafeAreaView>
      <AIPanel visible={aiOpen} bookId={props.book.id} chapterIndex={chapterIndex} bookTitle={props.book.title} bookAuthor={props.book.author} bookDescription={props.book.description} chapter={chapter} paragraphIndex={paragraphIndex} selectedText={aiSelection} selectedImage={aiImage} locator={aiLocator} settings={props.aiSettings} palette={palette} onSaveConversation={props.onConversationSave} onSettings={() => { setAiOpen(false); props.onAISettings(); }} onClose={() => setAiOpen(false)} />
      <ConversationViewerModal conversation={activeHistory} book={props.book} settings={props.aiSettings} palette={palette} onUpdate={(conversation) => { setActiveHistory(conversation); props.onConversationSave(conversation); }} onReturn={closeConversation} onStay={() => setActiveHistory(null)} />
    </View>
  );
}

export function ReaderScreen(props: ReaderScreenProps) {
  if (!props.book.epubUri) return null;
  return <FoliateReaderScreen {...props} epubUri={props.book.epubUri} />;
}
