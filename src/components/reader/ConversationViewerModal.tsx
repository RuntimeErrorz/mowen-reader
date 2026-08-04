import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import { askAI, buildAIRequestText } from '../../ai';
import { labelNoteReferences, noteReferenceItemsIn, type NoteReference } from '../../aiContext';
import { AIConversation, AIMessage, AISettings, Book } from '../../types';
import { ReaderPalette } from '../../ui/theme';
import { markdownStyles, styles } from '../../ui/styles';
import { AIContextCard } from './AIContextCard';
import { DraggableSheet, SheetBackdrop } from './DraggableSheet';
import { formatMessageTime, getImageData, themedMarkdownStyles } from './readerUtils';
import { useKeyboardVisibility } from './useKeyboardVisibility';

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
  const [answerTimestamp, setAnswerTimestamp] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [requestText, setRequestText] = useState('');
  const controller = useRef<AbortController | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const keyboardVisible = useKeyboardVisibility(!!props.conversation);

  useEffect(() => {
    if (!props.conversation) return;
    setMessages(props.conversation.messages);
    setQuestion(''); setAnswer(''); setAnswerTimestamp(null); setError(''); setLoading(false); setRequestText(''); setPreviewImage(null);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 80);
    return () => controller.current?.abort();
  }, [props.conversation?.id]);

  const conversation = props.conversation;
  const chapter = conversation ? props.book.chapters[conversation.chapterIndex] ?? props.book.chapters[0] : undefined;
  const paragraphIndex = conversation?.paragraphIndex ?? 0;
  const radius = conversation?.contextRadius ?? 5;
  const start = Math.max(0, paragraphIndex - radius);
  const end = chapter ? Math.min(chapter.paragraphs.length, paragraphIndex + radius + 1) : 0;
  const sourceExcerpt = conversation && chapter ? conversation.selectedText?.trim() || chapter.paragraphs[paragraphIndex] || conversation.anchorExcerpt : '';
  const excerpt = labelNoteReferences(sourceExcerpt);
  const contextImageUris = useMemo(() => {
    if (!conversation || !chapter) return [];
    const values: string[] = conversation.selectedImage ? [conversation.selectedImage] : [];
    for (let index = start; index < end; index++) {
      if (conversation.selectedImage && index === paragraphIndex) continue;
      const uri = getImageData(chapter.paragraphs[index]);
      if (uri) values.push(uri);
    }
    return values.filter((value, index, all) => all.indexOf(value) === index);
  }, [chapter, conversation, end, paragraphIndex, start]);
  const contextNotes = useMemo(() => {
    if (!chapter) return [];
    const values: NoteReference[] = [];
    const seen = new Set<string>();
    for (let index = start; index < end; index++) {
      for (const note of noteReferenceItemsIn(chapter.paragraphs[index], chapter.notes)) {
        if (!seen.has(note.id)) { seen.add(note.id); values.push(note); }
      }
    }
    return values;
  }, [chapter, end, start]);

  useEffect(() => {
    if (!conversation || !chapter) return;
    const firstQuestion = conversation.messages.find((message) => message.role === 'user')?.content;
    setRequestText(buildAIRequestText({
      bookTitle: props.book.title,
      bookAuthor: props.book.author,
      bookDescription: props.book.description,
      chapter,
      paragraphIndex,
      selectedText: conversation.selectedText,
      selectedImage: conversation.selectedImage,
      intent: 'question',
      question: firstQuestion || undefined,
      contextRadius: radius,
      imageCount: contextImageUris.length,
    }));
  }, [conversation?.id]);

  if (!conversation || !chapter) return null;
  const excerptIsImage = !!conversation.selectedImage || !!getImageData(sourceExcerpt);

  const continueConversation = async () => {
    const text = question.trim();
    if (!text || loading) return;
    if (!props.settings.apiKey.trim()) { setError('模型密钥不可用，请先在设置中配置。'); return; }
    const priorMessages = messages;
    const userCreatedAt = Date.now();
    setRequestText(buildAIRequestText({
      bookTitle: props.book.title,
      bookAuthor: props.book.author,
      bookDescription: props.book.description,
      chapter,
      paragraphIndex,
      selectedText: conversation.selectedText,
      selectedImage: conversation.selectedImage,
      intent: 'question',
      question: text,
      contextRadius: radius,
      imageCount: contextImageUris.length,
    }));
    const pendingMessages: AIMessage[] = [...priorMessages, { role: 'user', content: text, createdAt: userCreatedAt }];
    setMessages(pendingMessages);
    setQuestion(''); setAnswer(''); setAnswerTimestamp(Date.now()); setLoading(true); setError('');
    controller.current?.abort();
    controller.current = new AbortController();
    try {
      const result = await askAI({
        settings: props.settings,
        bookTitle: props.book.title,
        bookAuthor: props.book.author,
        bookDescription: props.book.description,
        chapter,
        paragraphIndex,
        selectedText: conversation.selectedText,
        selectedImage: conversation.selectedImage,
        additionalImages: conversation.selectedImage ? [conversation.selectedImage] : undefined,
        contextRadius: radius,
        intent: 'question',
        question: text,
        history: priorMessages,
        signal: controller.current.signal,
        onDelta: (delta) => setAnswer((current) => current + delta),
      });
      const next: AIMessage[] = [...pendingMessages, { role: 'assistant', content: result, createdAt: Date.now() }];
      setMessages(next); setAnswer(''); setAnswerTimestamp(null);
      props.onUpdate({ ...conversation, messages: next, updatedAt: Date.now() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    } catch (cause) {
      setAnswerTimestamp(null);
      if ((cause as Error).name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : '继续对话失败');
    } finally { setLoading(false); }
  };
  const stay = () => { Keyboard.dismiss(); props.onStay(); };
  const returnToAnchor = () => { Keyboard.dismiss(); props.onReturn(); };

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={stay}>
      <View style={styles.aiOverlayRoot}>
        <SheetBackdrop palette={props.palette} onPress={stay} />
        <KeyboardAvoidingView pointerEvents="box-none" behavior={Platform.OS === 'ios' ? 'padding' : keyboardVisible ? 'height' : undefined} style={styles.modalRoot}>
          <DraggableSheet visible onClose={stay} palette={props.palette} fillBelow showScrim={false} style={[styles.aiSheet, styles.aiSheetExpanded]}>
            <View style={[styles.historyHeader, { borderBottomColor: props.palette.line }]}>
              <View style={{ flex: 1 }}><Text numberOfLines={1} style={[styles.historyChapter, { color: props.palette.text }]}>{conversation.chapterTitle}</Text></View>
              <Pressable onPress={returnToAnchor} style={[styles.returnButton, { borderColor: props.palette.line }]}><Ionicons name="arrow-undo" size={16} color={props.palette.accent} /><Text style={[styles.returnButtonText, { color: props.palette.accent }]}>返回原处</Text></Pressable>
            </View>
            <ScrollView ref={scrollRef} style={styles.historyScroll} contentContainerStyle={styles.historyMessages} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <AIContextCard
                palette={props.palette}
                label="当时的上下文"
                position={paragraphIndex}
                excerpt={excerpt}
                excerptIsImage={excerptIsImage}
                imageUris={contextImageUris}
                notes={contextNotes}
                requestText={requestText || buildAIRequestText({
                  bookTitle: props.book.title,
                  bookAuthor: props.book.author,
                  bookDescription: props.book.description,
                  chapter,
                  paragraphIndex,
                  selectedText: conversation.selectedText,
                  selectedImage: conversation.selectedImage,
                  intent: 'question',
                  question: conversation.messages.find((message) => message.role === 'user')?.content,
                  contextRadius: radius,
                  imageCount: contextImageUris.length,
                })}
                onImagePress={setPreviewImage}
              />
              {messages.map((message, index) => message.role === 'user' ? (
                <View key={`${message.role}-${index}`} style={[styles.historyQuestionBlock, index === 0 && styles.historyFirstQuestionBlock, { backgroundColor: props.palette.focus }]}>
                  <Text style={[styles.historyQuestionText, { color: props.palette.text }]}>{message.content}</Text>
                  <Text style={[styles.messageTime, styles.questionMessageTime, { color: props.palette.muted }]}>{formatMessageTime(message.createdAt, conversation.createdAt)}</Text>
                </View>
              ) : (
                <View key={`${message.role}-${index}`} style={[styles.historyAnswerBlock, { backgroundColor: props.palette.control, borderColor: props.palette.line }]}>
                  <Markdown style={{ ...markdownStyles, ...themedMarkdownStyles(props.palette) }}>{message.content}</Markdown>
                  <Text style={[styles.messageTime, { color: props.palette.muted }]}>{formatMessageTime(message.createdAt, conversation.createdAt)}</Text>
                </View>
              ))}
              {!!answer && <View style={[styles.historyAnswerBlock, { backgroundColor: props.palette.control, borderColor: props.palette.line }]}>
                <Markdown style={{ ...markdownStyles, ...themedMarkdownStyles(props.palette) }}>{answer}</Markdown>
                <Text style={[styles.messageTime, { color: props.palette.muted }]}>{formatMessageTime(answerTimestamp ?? undefined, conversation.createdAt)}</Text>
              </View>}
              {loading && <View style={styles.historyThinking}><ActivityIndicator color={props.palette.accent} /><Text style={[styles.thinkingNote, { color: props.palette.muted }]}>正在生成回复…</Text></View>}
              {!!error && <Text style={[styles.historyError, { color: props.palette.text, backgroundColor: props.palette.surfaceAlt }]}>{error}</Text>}
            </ScrollView>
            <View style={[styles.historyComposer, { backgroundColor: props.palette.surface, borderTopColor: props.palette.line }]}>
              <TextInput value={question} onChangeText={setQuestion} placeholder="继续追问这段对话…" placeholderTextColor={props.palette.muted} multiline style={[styles.historyInput, { backgroundColor: props.palette.control, borderColor: props.palette.line, color: props.palette.text }]} />
              <Pressable disabled={!question.trim() || loading} onPress={continueConversation} style={[styles.sendButton, { backgroundColor: props.palette.accent }, (!question.trim() || loading) && { opacity: 0.45 }]}><Ionicons name="arrow-up" size={18} color={props.palette.onAccent} /></Pressable>
            </View>
          </DraggableSheet>
          {!!previewImage && <View style={[StyleSheet.absoluteFill, styles.imagePreviewRoot, { backgroundColor: props.palette.scrim }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setPreviewImage(null)} />
            <View style={[styles.imagePreviewCard, { backgroundColor: props.palette.surface, borderColor: props.palette.line }]}>
              <Image source={{ uri: previewImage }} resizeMode="contain" style={styles.imagePreviewImage} />
              <View style={[styles.imagePreviewFooter, { borderTopColor: props.palette.line }]}>
                <Text style={[styles.imagePreviewLabel, { color: props.palette.muted }]}>上下文图片 {Math.max(0, contextImageUris.indexOf(previewImage) + 1)} / {contextImageUris.length}</Text>
                <Pressable accessibilityLabel="关闭图片预览" onPress={() => setPreviewImage(null)} style={[styles.closeButton, { backgroundColor: props.palette.surfaceAlt }]}><Ionicons name="close" size={20} color={props.palette.text} /></Pressable>
              </View>
            </View>
          </View>}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
