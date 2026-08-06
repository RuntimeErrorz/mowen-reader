import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { askAI, buildAIRequestText } from '../../ai';
import { labelNoteReferences, noteReferenceItemsIn, type NoteReference } from '../../aiContext';
import { normalizeChapterTitle } from '../../epub';
import { AIConversation, AIMessage, AISettings, Book, EpubLocator } from '../../types';
import { C, ReaderPalette } from '../../ui/theme';
import { styles } from '../../ui/styles';
import { DraggableSheet, SheetBackdrop } from './DraggableSheet';
import { AIContextCard } from './AIContextCard';
import { formatMessageTime, getImageData, normalizeAIThinking, splitAIAnswer } from './readerUtils';
import { useKeyboardVisibility } from './useKeyboardVisibility';
import { AIMessageMarkdown } from './AIMessageMarkdown';
import { AIThinkingTrace } from './AIThinkingTrace';
import { AIThinkingToggle } from './AIThinkingToggle';
import { useAutoScrollToLatest } from './useAutoScrollToLatest';

type AIPanelProps = {
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
};

export function AIPanel(props: AIPanelProps) {
  const [answer, setAnswer] = useState('');
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [contextRadius, setContextRadius] = useState(5);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [requestText, setRequestText] = useState('');
  const [conversationMessages, setConversationMessages] = useState<AIMessage[]>([]);
  const [answerTimestamp, setAnswerTimestamp] = useState<number | null>(null);
  const [answerThinking, setAnswerThinking] = useState('');
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const messagesRef = useRef<AIMessage[]>([]);
  const sessionId = useRef('');
  const sessionCreatedAt = useRef(0);
  const { scrollRef, beginFollowing, resetFollowing, handleScroll, handleContentSizeChange } = useAutoScrollToLatest();
  const keyboardVisible = useKeyboardVisibility(props.visible);
  useEffect(() => {
    if (props.visible) {
      resetFollowing();
      setAnswer(''); setAnswerThinking(''); setQuestion(''); setError(''); setLoading(false); setRequestText(''); setConversationMessages([]); setAnswerTimestamp(null);
      messagesRef.current = [];
      sessionCreatedAt.current = Date.now();
      sessionId.current = `conversation-${sessionCreatedAt.current}-${Math.random().toString(36).slice(2, 6)}`;
    }
    return () => controller.current?.abort();
  }, [props.visible, props.paragraphIndex]);
  const run = async () => {
    if (!props.settings.apiKey.trim()) { setError('先配置模型接口，墨问才知道该去哪里思考。'); return; }
    const text = question.trim();
    Keyboard.dismiss();
    const currentRequestText = buildAIRequestText({
      bookTitle: props.bookTitle,
      bookAuthor: props.bookAuthor,
      bookDescription: props.bookDescription,
      chapter: props.chapter,
      paragraphIndex: props.paragraphIndex,
      selectedText: props.selectedText,
      selectedImage: props.selectedImage,
      question: text || undefined,
      contextRadius,
      imageCount: contextImageUris.length,
    });
    setRequestText(currentRequestText);
    const userCreatedAt = Date.now();
    setQuestion('');
    setLoading(true); setError(''); setAnswer(''); setAnswerThinking(''); setAnswerTimestamp(Date.now());
    beginFollowing();
    controller.current?.abort();
    controller.current = new AbortController();
    try {
      const priorMessages = messagesRef.current;
      const pendingMessages: AIMessage[] = [...priorMessages, { role: 'user', content: text, createdAt: userCreatedAt }];
      setConversationMessages(pendingMessages);
      const response = await askAI({
        ...props,
        question: text,
        contextRadius,
        selectedImage: props.selectedImage,
        additionalImages: props.selectedImage ? [props.selectedImage] : undefined,
        history: priorMessages,
        enableThinking: thinkingEnabled,
        signal: controller.current.signal,
        onDelta: (delta) => setAnswer((current) => current + delta),
        onThinkingDelta: thinkingEnabled ? (delta) => setAnswerThinking((current) => current + delta) : undefined,
      });
      const parsed = splitAIAnswer(response.content);
      const result = parsed.content;
      const thinking = thinkingEnabled ? normalizeAIThinking([response.thinking, parsed.thinking].filter(Boolean).join('\n\n')) : undefined;
      const nextMessages: AIMessage[] = [...pendingMessages.slice(0, -1), { role: 'user', content: text, createdAt: userCreatedAt }, { role: 'assistant', content: result, thinking, createdAt: Date.now() }];
      messagesRef.current = nextMessages;
      setConversationMessages(nextMessages);
      setAnswer(''); setAnswerThinking(''); setAnswerTimestamp(null);
      const selectedText = props.selectedText?.trim() || undefined;
      const rawExcerpt = props.selectedImage ? '〔插图〕' : props.selectedText?.trim() || props.chapter.paragraphs[props.paragraphIndex] || '';
      props.onSaveConversation({
        id: sessionId.current,
        bookId: props.bookId,
        chapterIndex: props.chapterIndex,
        paragraphIndex: props.paragraphIndex,
        chapterTitle: normalizeChapterTitle(props.chapter.title),
        anchorExcerpt: getImageData(rawExcerpt) ? '〔插图〕' : labelNoteReferences(rawExcerpt).slice(0, 180),
        selectedText,
        selectedImage: props.selectedImage || undefined,
        locator: props.locator,
        contextRadius,
        messages: nextMessages,
        createdAt: sessionCreatedAt.current,
        updatedAt: Date.now(),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setAnswerTimestamp(null);
      if ((e as Error).name !== 'AbortError') setError(e instanceof Error ? e.message : '暂时无法连接模型');
    } finally { setLoading(false); }
  };
  const openImagePreview = (uri: string) => setPreviewImage(uri);
  const excerpt = labelNoteReferences(props.selectedText?.trim() || props.chapter.paragraphs[props.paragraphIndex] || '');
  const excerptIsImage = !!props.selectedImage || !!getImageData(excerpt);
  const start = Math.max(0, props.paragraphIndex - contextRadius);
  const end = Math.min(props.chapter.paragraphs.length, props.paragraphIndex + contextRadius + 1);
  const contextImageUris = useMemo(() => {
    const values: string[] = [];
    if (props.selectedImage) values.push(props.selectedImage);
    for (let index = start; index < end; index++) {
      if (props.selectedImage && index === props.paragraphIndex) continue;
      const uri = getImageData(props.chapter.paragraphs[index]);
      if (uri) values.push(uri);
    }
    return values.filter((value, index, all) => all.indexOf(value) === index);
  }, [end, props.chapter.paragraphs, props.paragraphIndex, props.selectedImage, start]);
  const contextNotes = useMemo(() => {
    const values: NoteReference[] = [];
    const seen = new Set<string>();
    for (let index = start; index < end; index++) {
      for (const note of noteReferenceItemsIn(props.chapter.paragraphs[index], props.chapter.notes)) {
        if (!seen.has(note.id)) { seen.add(note.id); values.push(note); }
      }
    }
    return values;
  }, [end, props.chapter.notes, props.chapter.paragraphs, start]);
  const hasStartedConversation = loading || !!answer || conversationMessages.length > 0;
  const showConversationSetup = !hasStartedConversation;
  if (!props.visible) return null;
  const close = () => {
    Keyboard.dismiss();
    props.onClose();
  };

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={close}>
      <View style={styles.aiOverlayRoot}>
        <SheetBackdrop palette={props.palette} onPress={close} />
        <KeyboardAvoidingView pointerEvents="box-none" behavior={Platform.OS === 'ios' ? 'padding' : keyboardVisible ? 'height' : undefined} style={styles.modalRoot}>
        <DraggableSheet
          visible={props.visible}
          onClose={close}
          palette={props.palette}
          fillBelow
          showScrim={false}
          style={[styles.aiSheet, !hasStartedConversation && !keyboardVisible && styles.aiSheetInitial, hasStartedConversation && styles.aiSheetExpanded]}
        >
          <ScrollView ref={scrollRef} onScroll={handleScroll} onContentSizeChange={handleContentSizeChange} scrollEventThrottle={16} style={styles.aiScroll} contentContainerStyle={styles.aiScrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <AIContextCard
              palette={props.palette}
              label="正在阅读"
              position={props.paragraphIndex}
              excerpt={excerpt}
              excerptIsImage={excerptIsImage}
              imageUris={contextImageUris}
              notes={contextNotes}
              requestText={requestText || buildAIRequestText({
                bookTitle: props.bookTitle,
                bookAuthor: props.bookAuthor,
                bookDescription: props.bookDescription,
                chapter: props.chapter,
                paragraphIndex: props.paragraphIndex,
                selectedText: props.selectedText,
                selectedImage: props.selectedImage,
                question: question.trim() || undefined,
                contextRadius,
                imageCount: contextImageUris.length,
              })}
              onImagePress={openImagePreview}
            />
            {showConversationSetup && <>
               <View style={styles.contextSliderHead}>
                 <Text style={[styles.contextControlLabel, { color: props.palette.muted }]}>上下文范围</Text>
                 <Text style={[styles.contextSliderValue, { color: props.palette.accent }]}>前后 {contextRadius} 个内容块</Text>
               </View>
               <Slider
                 value={contextRadius}
                 minimumValue={1}
                 maximumValue={20}
                 step={1}
                 onValueChange={(value) => { setContextRadius(Math.round(value)); setAnswer(''); setRequestText(''); }}
                 minimumTrackTintColor={props.palette.accent}
                 maximumTrackTintColor={props.palette.line}
                 thumbTintColor={props.palette.accent}
                 style={styles.contextSlider}
               />
               <View style={styles.contextSliderMeta}>
                 <Text style={[styles.contextSliderHint, { color: props.palette.muted }]}>近</Text>
                 <Text style={[styles.contextSliderHint, { color: props.palette.muted }]}>远 · 最多前后 20 个内容块</Text>
               </View>
            </>}
            {conversationMessages.map((message, index) => message.role === 'user' ? (
              <View key={`${message.role}-${index}`} style={[styles.historyQuestionBlock, index === 0 && styles.historyFirstQuestionBlock, { backgroundColor: props.palette.focus }]}>
                <Text style={[styles.historyQuestionText, { color: props.palette.text }]}>{message.content}</Text>
                <Text style={[styles.messageTime, styles.questionMessageTime, { color: props.palette.muted }]}>{formatMessageTime(message.createdAt, sessionCreatedAt.current)}</Text>
              </View>
            ) : (
              <View key={`${message.role}-${index}`} style={[styles.historyAnswerBlock, { backgroundColor: props.palette.control, borderColor: props.palette.line }]}>
                <AIThinkingTrace palette={props.palette} thinking={message.thinking} defaultExpanded={thinkingEnabled && index === conversationMessages.length - 1} />
                <AIMessageMarkdown palette={props.palette} content={message.content} />
                <Text style={[styles.messageTime, { color: props.palette.muted }]}>{formatMessageTime(message.createdAt, sessionCreatedAt.current)}</Text>
              </View>
            ))}
            {!!answer && <View style={[styles.historyAnswerBlock, { backgroundColor: props.palette.control, borderColor: props.palette.line }]}>
              <AIThinkingTrace palette={props.palette} active={loading && thinkingEnabled} thinking={[answerThinking, splitAIAnswer(answer).thinking].filter(Boolean).join('\n\n')} defaultExpanded={thinkingEnabled} />
              <AIMessageMarkdown palette={props.palette} content={answer} />
              <Text style={[styles.messageTime, { color: props.palette.muted }]}>{formatMessageTime(answerTimestamp ?? undefined, sessionCreatedAt.current)}</Text>
            </View>}
            {loading && thinkingEnabled && !answer && <AIThinkingTrace palette={props.palette} active thinking={answerThinking} defaultExpanded />}
            {loading && !thinkingEnabled && <View style={styles.thinking}><ActivityIndicator color={props.palette.accent} /><Text style={[styles.thinkingTitle, { color: props.palette.text }]}>正在生成回复…</Text></View>}
            {!!error && <View style={[styles.errorCard, { backgroundColor: props.palette.surfaceAlt }]}><Ionicons name="information-circle-outline" size={19} color={C.ember} /><Text style={[styles.errorText, { color: props.palette.text }]}>{error}</Text>{!props.settings.apiKey && <Pressable onPress={props.onSettings}><Text style={[styles.errorLink, { color: props.palette.accent }]}>去配置</Text></Pressable>}</View>}
          </ScrollView>
          <View style={[styles.aiComposer, { backgroundColor: props.palette.surface, borderTopColor: props.palette.line, paddingBottom: keyboardVisible ? 5 : 16 }]}>
            <View style={[styles.questionBox, { backgroundColor: props.palette.control, borderColor: props.palette.line }]}>
              <TextInput value={question} onChangeText={setQuestion} multiline style={[styles.questionInput, { color: props.palette.text }]} />
              <View style={styles.questionBoxFooter}>
                <AIThinkingToggle palette={props.palette} value={thinkingEnabled} onChange={setThinkingEnabled} disabled={loading} />
                <Pressable hitSlop={5} disabled={!question.trim() || loading} onPress={run} style={[styles.sendButton, { backgroundColor: props.palette.accent }, (!question.trim() || loading) && { opacity: 0.45 }]}><Ionicons name="arrow-up" size={18} color={props.palette.onAccent} /></Pressable>
              </View>
            </View>
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
    </Modal>
  );
}
