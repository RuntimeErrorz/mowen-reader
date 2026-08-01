import React, { memo, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import Slider from '@react-native-community/slider';
import { askAI } from '../../ai';
import { AIConversation, AIMessage, AISettings, Bookmark, Book, ReaderPrefs } from '../../types';
import { getReaderPalette, ReaderPalette } from '../../ui/theme';
import { markdownStyles, styles } from '../../ui/styles';
import { DraggableSheet } from './DraggableSheet';
import { themedMarkdownStyles } from './readerUtils';

export function TOCModal({ palette, visible, chapters, current, onChoose, onClose }: { palette: ReaderPalette; visible: boolean; chapters: string[]; current: number; onChoose: (index: number) => void; onClose: () => void }) {
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

export function ConversationViewerModal(props: {
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
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (!props.conversation) return;
    setMessages(props.conversation.messages);
    setQuestion(''); setAnswer(''); setError(''); setLoading(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 80);
    return () => controller.current?.abort();
  }, [props.conversation?.id]);
  if (!props.conversation) return null;
  const conversation = props.conversation;
  const chapter = props.book.chapters[conversation.chapterIndex];
  const continueConversation = async () => {
    const text = question.trim();
    if (!text || loading) return;
    if (!props.settings.apiKey.trim()) { setError('模型密钥不可用，请先在设置中配置。'); return; }
    const priorMessages = messages;
    const pendingMessages: AIMessage[] = [...priorMessages, { role: 'user', content: text }];
    setMessages(pendingMessages);
    setQuestion(''); setAnswer(''); setLoading(true); setError('');
    controller.current?.abort();
    controller.current = new AbortController();
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
        history: priorMessages,
        signal: controller.current.signal,
        onDelta: (delta) => setAnswer((current) => current + delta),
      });
      const next: AIMessage[] = [...pendingMessages, { role: 'assistant', content: answer }];
      setMessages(next); setAnswer('');
      props.onUpdate({ ...conversation, messages: next, updatedAt: Date.now() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    } catch (cause) {
      if ((cause as Error).name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : '继续对话失败');
    } finally { setLoading(false); }
  };
  return (
    <View style={styles.aiOverlayRoot}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalRoot}>
        <DraggableSheet visible onClose={props.onStay} palette={props.palette} animateIn fillBelow style={[styles.aiSheet, styles.aiSheetExpanded]}>
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
            {!!answer && <View style={[styles.historyAnswerBlock, { backgroundColor: props.palette.control, borderColor: props.palette.line }]}>
              <Text style={[styles.answerLabel, { color: props.palette.accent }]}>墨问批注</Text><Markdown style={{ ...markdownStyles, ...themedMarkdownStyles(props.palette) }}>{answer}</Markdown>
            </View>}
            {loading && <View style={styles.historyThinking}><ActivityIndicator color={props.palette.accent} /><Text style={[styles.thinkingNote, { color: props.palette.muted }]}>沿着原对话继续思考…</Text></View>}
            {!!error && <Text style={[styles.historyError, { color: props.palette.text, backgroundColor: props.palette.surfaceAlt }]}>{error}</Text>}
            <Text style={[styles.historyEnd, { color: props.palette.muted }]}>这段对话留在此处 · {new Date(conversation.updatedAt).toLocaleString()}</Text>
          </ScrollView>
          <View style={[styles.historyComposer, { backgroundColor: props.palette.surface, borderTopColor: props.palette.line }]}>
            <TextInput value={question} onChangeText={setQuestion} placeholder="继续追问这段对话…" placeholderTextColor={props.palette.muted} multiline style={[styles.historyInput, { backgroundColor: props.palette.control, borderColor: props.palette.line, color: props.palette.text }]} />
            <Pressable disabled={!question.trim() || loading} onPress={continueConversation} style={[styles.sendButton, { backgroundColor: props.palette.accent }, (!question.trim() || loading) && { opacity: 0.45 }]}><Ionicons name="arrow-up" size={18} color={props.palette.onAccent} /></Pressable>
          </View>
        </DraggableSheet>
      </KeyboardAvoidingView>
    </View>
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
  onAppearance: () => void;
  onMargins: () => void;
  onProgressStart: (pageX: number) => void;
  onProgressMove: (pageX: number) => void;
  onProgressEnd: () => void;
}) {
  return <Animated.View pointerEvents={props.visible ? 'auto' : 'none'} style={[styles.readerBottom, { backgroundColor: props.palette.bar, borderColor: props.palette.line, opacity: props.animation, transform: [{ translateY: props.animation.interpolate({ inputRange: [0, 1], outputRange: [82, 0] }) }] }]}>
    <Pressable accessibilityLabel="返回" onPress={props.onBack} style={styles.bottomAction}><Ionicons name="arrow-back" size={22} color={props.palette.muted} /><Text style={[styles.bottomLabel, { color: props.palette.muted }]}>返回</Text></Pressable>
    <Pressable onPress={props.onContents} style={styles.bottomAction}><Ionicons name="list" size={22} color={props.palette.muted} /><Text style={[styles.bottomLabel, { color: props.palette.muted }]}>目录</Text></Pressable>
    <View accessibilityLabel="长按调整全书进度" onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true} onResponderGrant={(event) => props.onProgressStart(event.nativeEvent.pageX)} onResponderMove={(event) => props.onProgressMove(event.nativeEvent.pageX)} onResponderRelease={props.onProgressEnd} onResponderTerminate={props.onProgressEnd} onResponderTerminationRequest={() => false} style={styles.progressPill}><Text style={[styles.progressMain, { color: props.palette.text }]}>{Math.round(props.progress * 100)}%</Text><Text style={[styles.progressText, { color: props.palette.muted }]}>按住拖动 · {props.chapter + 1}/{props.chapterCount} 章</Text></View>
    <Pressable onPress={props.onAppearance} style={styles.bottomAction}><Text style={[styles.bottomAa, { color: props.palette.muted }]}>Aa</Text><Text style={[styles.bottomLabel, { color: props.palette.muted }]}>外观</Text></Pressable>
    <Pressable onPress={props.onMargins} style={styles.bottomAction}><Ionicons name="albums-outline" size={21} color={props.marginCount ? props.palette.accent : props.palette.muted} /><Text style={[styles.bottomLabel, { color: props.palette.muted }]}>页边 {props.marginCount || ''}</Text></Pressable>
  </Animated.View>;
});

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
