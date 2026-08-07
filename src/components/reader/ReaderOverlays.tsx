import React, { memo, useEffect, useRef, useState } from 'react';
import { Animated, FlatList, Modal, Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { FoliateTOCItem } from '../../FoliateReader';
import { normalizeChapterTitle } from '../../epub';
import { AIConversation, Bookmark, ReaderPrefs } from '../../types';
import { getReaderPalette, ReaderPalette } from '../../ui/theme';
import { styles } from '../../ui/styles';
import { DraggableSheet, SheetBackdrop } from './DraggableSheet';
import { conversationAnswerPreview } from './readerUtils';

type TocRow = FoliateTOCItem & {
  index: number;
  parentIndex: number | null;
  hasChildren: boolean;
};

function buildTocRows(items: FoliateTOCItem[]): TocRow[] {
  const parentAtDepth: Array<number | undefined> = [];
  return items.map((item, index) => {
    const depth = Math.max(0, item.depth);
    parentAtDepth.length = depth;
    const parentIndex = depth > 0 ? parentAtDepth[depth - 1] ?? null : null;
    parentAtDepth[depth] = index;
    parentAtDepth.length = depth + 1;
    return {
      ...item,
      depth,
      index,
      parentIndex,
      hasChildren: (items[index + 1]?.depth ?? -1) > depth,
    };
  });
}

export function TOCModal({ palette, visible, chapters, current, onChoose, onClose }: { palette: ReaderPalette; visible: boolean; chapters: FoliateTOCItem[]; current: number; onChoose: (index: number) => void; onClose: () => void }) {
  const listRef = useRef<FlatList<TocRow>>(null);
  const rows = React.useMemo(() => buildTocRows(chapters), [chapters]);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const visibleRows = React.useMemo(() => rows.filter((row) => {
    let parentIndex = row.parentIndex;
    while (parentIndex !== null) {
      if (!expanded.has(parentIndex)) return false;
      parentIndex = rows[parentIndex]?.parentIndex ?? null;
    }
    return true;
  }), [expanded, rows]);
  const currentIndex = Math.min(Math.max(0, current), Math.max(0, rows.length - 1));
  const currentVisibleIndex = visibleRows.findIndex((row) => row.index === currentIndex);

  useEffect(() => {
    setExpanded(new Set());
  }, [rows, visible]);

  useEffect(() => {
    if (!visible || currentVisibleIndex < 0) return;
    const timer = setTimeout(() => listRef.current?.scrollToIndex({ index: currentVisibleIndex, viewPosition: 0.35, animated: false }), 80);
    return () => clearTimeout(timer);
  }, [currentVisibleIndex, visible]);

  const toggleRow = (index: number) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <DraggableSheet visible={visible} onClose={onClose} palette={palette}>
        <View style={styles.sheetHeader}><View><Text style={[styles.sheetEyebrow, { color: palette.accent }]}>CONTENTS</Text><Text style={[styles.sheetTitle, { color: palette.text }]}>目录</Text></View><Pressable onPress={onClose} style={[styles.closeButton, { backgroundColor: palette.surfaceAlt }]}><Ionicons name="close" size={20} color={palette.text} /></Pressable></View>
        <FlatList
          ref={listRef}
          style={styles.tocList}
          data={visibleRows}
          keyExtractor={(item) => `${item.index}-${item.href}-${item.label}`}
          getItemLayout={(_data, index) => ({ length: 60, offset: 60 * index, index })}
          initialScrollIndex={Math.max(0, currentVisibleIndex)}
          onScrollToIndexFailed={(info) => listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false })}
          renderItem={({ item }) => {
            const isCurrent = item.index === currentIndex;
            const itemPaddingLeft = item.depth * 12;
            return (
              <Pressable
                accessibilityRole="button"
                onPress={() => onChoose(item.index)}
                style={[styles.tocItem, { borderBottomColor: palette.line, paddingLeft: itemPaddingLeft }, isCurrent && { backgroundColor: palette.focus, borderBottomWidth: 0 }]}
              >
                {item.hasChildren ? <Pressable
                  accessibilityLabel={expanded.has(item.index) ? `收起${item.label}` : `展开${item.label}`}
                  accessibilityRole="button"
                  onPress={(event) => { event.stopPropagation(); toggleRow(item.index); }}
                  style={styles.tocDisclosure}
                ><Ionicons name={expanded.has(item.index) ? 'chevron-down' : 'chevron-forward'} size={17} color={isCurrent ? palette.accent : palette.muted} /></Pressable> : <View style={styles.tocDisclosureSpacer} />}
                <Text numberOfLines={2} style={[styles.tocTitle, { color: isCurrent ? palette.accent : palette.text }]}>{item.label}</Text>
                {isCurrent && <View style={[styles.currentDot, { backgroundColor: palette.accent }]} />}
              </Pressable>
            );
          }}
          ListFooterComponent={<View style={{ height: 30 }} />}
        />
      </DraggableSheet>
    </Modal>
  );
}

export function BookmarksModal(props: {
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
  const [tab, setTab] = useState<'bookmarks' | 'conversations'>('conversations');
  const ordered = [...props.bookmarks].sort((a, b) => a.chapterIndex - b.chapterIndex || a.paragraphIndex - b.paragraphIndex);
  const orderedConversations = [...props.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <Modal visible={props.visible} transparent animationType="slide" statusBarTranslucent onRequestClose={props.onClose}>
      <DraggableSheet visible={props.visible} onClose={props.onClose} palette={props.palette} style={styles.bookmarksSheet}>
        <View style={styles.sheetHeader}>
          <View><Text style={[styles.sheetEyebrow, { color: props.palette.accent }]}>MARGINALIA</Text><Text style={[styles.sheetTitle, { color: props.palette.text }]}>页边</Text></View>
          <Pressable onPress={props.onClose} style={[styles.closeButton, { backgroundColor: props.palette.surfaceAlt }]}><Ionicons name="close" size={20} color={props.palette.text} /></Pressable>
        </View>
        <View style={[styles.marginTabs, { borderBottomColor: props.palette.line }]}>
          <Pressable onPress={() => setTab('conversations')} style={[styles.marginTab, tab === 'conversations' && { borderBottomColor: props.palette.accent }]}><Text style={[styles.marginTabText, { color: tab === 'conversations' ? props.palette.accent : props.palette.muted }, tab === 'conversations' && styles.marginTabTextActive]}>AI 对话 {props.conversations.length}</Text></Pressable>
          <Pressable onPress={() => setTab('bookmarks')} style={[styles.marginTab, tab === 'bookmarks' && { borderBottomColor: props.palette.accent }]}><Text style={[styles.marginTabText, { color: tab === 'bookmarks' ? props.palette.accent : props.palette.muted }, tab === 'bookmarks' && styles.marginTabTextActive]}>书签 {props.bookmarks.length}</Text></Pressable>
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
                <Text numberOfLines={1} style={[styles.bookmarkChapter, { color: props.palette.accent }]}>{normalizeChapterTitle(item.chapterTitle)}</Text>
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
            const conversationTitle = (item.title?.trim() || firstQuestion).replace(/\s+/g, ' ');
            return (
              <Pressable onPress={() => props.onChooseConversation(item)} style={({ pressed }) => [styles.conversationItem, { borderBottomColor: props.palette.line }, pressed && styles.pressed]}>
                <View style={styles.bookmarkContent}>
                  <Text numberOfLines={1} style={[styles.bookmarkChapter, { color: props.palette.accent }]}>{normalizeChapterTitle(item.chapterTitle)}</Text>
                  <Text style={[styles.bookmarkLocation, { color: props.palette.muted }]}>第 {item.chapterIndex + 1} 章 · 位置 {item.paragraphIndex + 1} · {item.messages.length / 2} 轮</Text>
                  <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.conversationTitle, { color: props.palette.text }]}>{conversationTitle}</Text>
                  <Text numberOfLines={2} ellipsizeMode="tail" style={[styles.conversationExcerpt, { color: props.palette.text }]}>{conversationAnswerPreview(lastAnswer)}</Text>
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

export function TypeModal({ visible, value, onChange, onClose }: { visible: boolean; value: ReaderPrefs; onChange: (value: ReaderPrefs) => void; onClose: () => void }) {
  const previewPalette = getReaderPalette(value.theme);
  const themes: { key: ReaderPrefs['theme']; name: string; color: string }[] = [
    { key: 'paper', name: '纸白', color: '#E9ECE5' },
    { key: 'wheat', name: '麦纸', color: '#F1DFB7' },
    { key: 'mist', name: '雾蓝', color: '#DDE7E5' },
    { key: 'night', name: '夜墨', color: '#17292D' },
  ];
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
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
          <SpacingSlider palette={previewPalette} label="字号" value={value.fontSize} minimum={14} maximum={36} step={1} format={(next) => `${Math.round(next)} pt`} onChange={(fontSize) => onChange({ ...value, fontSize })} />
        </View>
        <Text style={[styles.controlLabel, { color: previewPalette.muted }]}>正文字体</Text>
        <View style={styles.optionRow}>
          <AppearanceOption palette={previewPalette} label="宋体" active={value.fontStyle === 'serif'} onPress={() => onChange({ ...value, fontStyle: 'serif' })} />
          <AppearanceOption palette={previewPalette} label="黑体" active={value.fontStyle === 'sans'} onPress={() => onChange({ ...value, fontStyle: 'sans' })} />
        </View>
        <View style={[styles.inlineSettingRow, { backgroundColor: previewPalette.control, borderColor: previewPalette.line }]}>
          <View style={styles.inlineSettingCopy}><Text style={[styles.inlineSettingTitle, { color: previewPalette.text }]}>首行缩进</Text><Text style={[styles.inlineSettingHint, { color: previewPalette.muted }]}>正文段落缩进两个汉字</Text></View>
          <View style={styles.inlineSettingControl}><Text style={[styles.inlineSettingValue, { color: value.firstLineIndent ? previewPalette.accent : previewPalette.muted }]}>{value.firstLineIndent ? '打开' : '关闭'}</Text><Switch accessibilityLabel="首行缩进" value={value.firstLineIndent} onValueChange={(firstLineIndent) => onChange({ ...value, firstLineIndent })} trackColor={{ false: previewPalette.line, true: previewPalette.focus }} thumbColor={value.firstLineIndent ? previewPalette.accent : previewPalette.muted} /></View>
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
        <View style={styles.themeRow}>{themes.map((theme) => <Pressable key={theme.key} onPress={() => onChange({ ...value, theme: theme.key })} style={[styles.themeChoice, { borderColor: value.theme === theme.key ? previewPalette.accent : previewPalette.line, backgroundColor: value.theme === theme.key ? previewPalette.focus : previewPalette.surface }]}><View style={[styles.themeSwatch, { backgroundColor: theme.color, borderColor: previewPalette.line }]} /><Text style={[styles.themeName, { color: previewPalette.text }]}>{theme.name}</Text></Pressable>)}</View>
        </ScrollView>
      </DraggableSheet>
    </Modal>
  );
}

export const ReaderToolbar = memo(function ReaderToolbar(props: {
  visible: boolean;
  animation: Animated.Value;
  palette: ReaderPalette;
  progress: number;
  chapter: number;
  chapterCount: number;
  marginCount: number;
  onBack: () => void;
  onContents: () => void;
  onSearch: () => void;
  onAppearance: () => void;
  onMargins: () => void;
  onProgressStart: (pageX: number) => void;
  onProgressMove: (pageX: number) => void;
  onProgressEnd: () => void;
}) {
  return <Animated.View pointerEvents={props.visible ? 'auto' : 'none'} style={[styles.readerBottom, { backgroundColor: props.palette.bar, borderColor: props.palette.line, opacity: props.animation, transform: [{ translateY: props.animation.interpolate({ inputRange: [0, 1], outputRange: [82, 0] }) }] }]}>
    <Pressable accessibilityLabel="返回" onPress={props.onBack} style={styles.bottomAction}><Ionicons name="arrow-back" size={22} color={props.palette.muted} /><Text style={[styles.bottomLabel, { color: props.palette.muted }]}>返回</Text></Pressable>
    <Pressable accessibilityLabel="搜索正文" onPress={props.onSearch} style={styles.bottomAction}><Ionicons name="search" size={21} color={props.palette.muted} /><Text style={[styles.bottomLabel, { color: props.palette.muted }]}>搜索</Text></Pressable>
    <ProgressPill palette={props.palette} progress={props.progress} chapter={props.chapter} chapterCount={props.chapterCount} onContents={props.onContents} onProgressStart={props.onProgressStart} onProgressMove={props.onProgressMove} onProgressEnd={props.onProgressEnd} />
    <Pressable onPress={props.onAppearance} style={styles.bottomAction}><Text style={[styles.bottomAa, { color: props.palette.muted }]}>Aa</Text><Text style={[styles.bottomLabel, { color: props.palette.muted }]}>外观</Text></Pressable>
    <Pressable onPress={props.onMargins} style={styles.bottomAction}><Ionicons name="albums-outline" size={21} color={props.marginCount ? props.palette.accent : props.palette.muted} /><Text style={[styles.bottomLabel, { color: props.palette.muted }]}>页边 {props.marginCount || ''}</Text></Pressable>
  </Animated.View>;
});

function ProgressPill(props: { palette: ReaderPalette; progress: number; chapter: number; chapterCount: number; onContents: () => void; onProgressStart: (pageX: number) => void; onProgressMove: (pageX: number) => void; onProgressEnd: () => void }) {
  const start = useRef({ x: 0, y: 0 });
  const dragging = useRef(false);
  const moved = useRef(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [longPressed, setLongPressed] = useState(false);
  useEffect(() => () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);
  const clearLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };
  const begin = (event: { nativeEvent: { pageX: number; pageY: number } }) => {
    start.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
    dragging.current = false;
    moved.current = false;
    clearLongPress();
    longPressTimer.current = setTimeout(() => {
      dragging.current = true;
      setLongPressed(true);
      props.onProgressStart(start.current.x);
    }, 150);
  };
  const move = (event: { nativeEvent: { pageX: number; pageY: number } }) => {
    if (dragging.current) {
      props.onProgressMove(event.nativeEvent.pageX);
      return;
    }
    if (Math.abs(event.nativeEvent.pageX - start.current.x) > 8 || Math.abs(event.nativeEvent.pageY - start.current.y) > 8) {
      moved.current = true;
      clearLongPress();
    }
  };
  const end = () => {
    clearLongPress();
    if (dragging.current) props.onProgressEnd();
    else if (!moved.current) props.onContents();
    dragging.current = false;
    moved.current = false;
    setLongPressed(false);
  };
  const cancel = () => {
    clearLongPress();
    if (dragging.current) props.onProgressEnd();
    dragging.current = false;
    setLongPressed(false);
  };
  return (
    <View
      accessibilityRole="button"
      accessibilityLabel="目录与全书进度"
      accessibilityHint="单击打开目录，长按后拖动调整全书进度"
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={begin}
      onResponderMove={move}
      onResponderRelease={end}
      onResponderTerminate={cancel}
      onResponderTerminationRequest={() => false}
      style={styles.progressPill}
    >
      <Text style={[styles.progressMain, { color: props.palette.text }]}>{Math.round(props.progress * 100)}%</Text>
      <Text style={[styles.progressText, { color: longPressed ? props.palette.accent : props.palette.muted }]}>{longPressed ? '松手跳转' : `单击/长按 · ${props.chapter + 1}/${props.chapterCount} 章`}</Text>
    </View>
  );
}

function AppearanceOption({ palette, label, active, onPress }: { palette: ReaderPalette; label: string; active: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.appearanceOption, { borderColor: active ? palette.accent : palette.line, backgroundColor: active ? palette.focus : palette.control }, pressed && styles.pressed]}><Text style={[styles.appearanceOptionText, { color: active ? palette.accent : palette.muted }, active && styles.appearanceOptionTextActive]}>{label}</Text></Pressable>;
}

function SpacingSlider(props: { palette: ReaderPalette; label: string; value: number; minimum: number; maximum: number; step: number; format: (value: number) => string; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  return <View style={[styles.spacingSliderCard, { backgroundColor: props.palette.control, borderColor: props.palette.line }]}><View style={styles.spacingSliderHead}><Text style={[styles.spacingSliderLabel, { color: props.palette.text }]}>{props.label}</Text><Text style={[styles.spacingSliderValue, { color: props.palette.accent }]}>{props.format(draft)}</Text></View><Slider accessibilityLabel={props.label} style={styles.spacingSlider} minimumValue={props.minimum} maximumValue={props.maximum} step={props.step} value={draft} onValueChange={setDraft} onSlidingComplete={props.onChange} minimumTrackTintColor={props.palette.accent} maximumTrackTintColor={props.palette.line} thumbTintColor={props.palette.accent} /></View>;
}

function MarginSlider({ palette, icon, label, value, onChange }: { palette: ReaderPalette; icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <View style={[styles.marginSliderCard, { backgroundColor: palette.control, borderColor: palette.line }]}><View style={styles.marginSliderHead}><View style={[styles.marginDirectionIcon, { backgroundColor: palette.focus }]}><Ionicons name={icon} size={13} color={palette.accent} /></View><Text style={[styles.marginDirection, { color: palette.text }]}>{label}</Text><Text style={[styles.marginValue, { color: palette.accent }]}>{Math.round(draft)}</Text></View><Slider accessibilityLabel={`${label}距`} style={styles.marginSlider} minimumValue={0} maximumValue={96} step={2} value={draft} onValueChange={setDraft} onSlidingComplete={(next) => onChange(Math.round(next))} minimumTrackTintColor={palette.accent} maximumTrackTintColor={palette.line} thumbTintColor={palette.accent} /></View>;
}
