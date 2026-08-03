import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import Slider from '@react-native-community/slider';
import { askAI, AIIntent } from '../../ai';
import { AIConversation, AIMessage, AISettings, Book, EpubLocator } from '../../types';
import { C, ReaderPalette } from '../../ui/theme';
import { markdownStyles, styles } from '../../ui/styles';
import { DraggableSheet, SheetBackdrop } from './DraggableSheet';
import { formatMessageTime, getImageData, themedMarkdownStyles } from './readerUtils';
import { useKeyboardVisibility } from './useKeyboardVisibility';

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
  const [conversationMessages, setConversationMessages] = useState<AIMessage[]>([]);
  const [answerTimestamp, setAnswerTimestamp] = useState<number | null>(null);
  const questionInputRef = useRef<TextInput>(null);
  const controller = useRef<AbortController | null>(null);
  const messagesRef = useRef<AIMessage[]>([]);
  const sessionId = useRef('');
  const sessionCreatedAt = useRef(0);
  const keyboardVisible = useKeyboardVisibility(props.visible);
  useEffect(() => {
    if (props.visible) {
      setAnswer(''); setQuestion(''); setError(''); setLoading(false); setConversationMessages([]); setAnswerTimestamp(null);
      messagesRef.current = [];
      sessionCreatedAt.current = Date.now();
      sessionId.current = `conversation-${sessionCreatedAt.current}-${Math.random().toString(36).slice(2, 6)}`;
    }
    return () => controller.current?.abort();
  }, [props.visible, props.paragraphIndex]);
  const run = async (intent: AIIntent) => {
    if (!props.settings.apiKey.trim()) { setError('先配置模型接口，墨问才知道该去哪里思考。'); return; }
    const text = question.trim();
    const userCreatedAt = Date.now();
    setQuestion('');
    setLoading(true); setError(''); setAnswer(''); setAnswerTimestamp(Date.now());
    controller.current?.abort();
    controller.current = new AbortController();
    try {
      const priorMessages = messagesRef.current;
      const pendingMessages: AIMessage[] = [...priorMessages, { role: 'user', content: text, createdAt: userCreatedAt }];
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
      const nextMessages: AIMessage[] = [...pendingMessages.slice(0, -1), { role: 'user', content: userLabel[intent], createdAt: userCreatedAt }, { role: 'assistant', content: result, createdAt: Date.now() }];
      messagesRef.current = nextMessages;
      setConversationMessages(nextMessages);
      setAnswer(''); setAnswerTimestamp(null);
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
      setAnswerTimestamp(null);
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
      if (props.selectedImage && index === props.paragraphIndex) continue;
      const uri = getImageData(props.chapter.paragraphs[index]);
      if (uri) values.push(uri);
    }
    return values.filter((value, index, all) => all.indexOf(value) === index);
  }, [end, props.chapter.paragraphs, props.paragraphIndex, props.selectedImage, start]);
  const bookImageCount = contextImageUris.length;
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
          style={[styles.aiSheet, hasStartedConversation && styles.aiSheetExpanded]}
        >
          <View style={styles.aiHeader}>
            <View style={styles.aiTitleRow}><View style={[styles.miniSpark, { backgroundColor: props.palette.accent }]}><Ionicons name="sparkles" size={15} color={props.palette.onAccent} /></View><Text style={[styles.aiTitle, { color: props.palette.text }]}>理解此处</Text></View>
            <Pressable onPress={close} style={[styles.closeButton, { backgroundColor: props.palette.surfaceAlt }]}><Ionicons name="close" size={20} color={props.palette.text} /></Pressable>
          </View>
          <ScrollView style={styles.aiScroll} contentContainerStyle={styles.aiScrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {showConversationSetup && <>
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
            </>}
            {showConversationSetup && (
               <View style={styles.intentGrid}>
                 <IntentButton palette={props.palette} title="解释这段" onPress={() => fillPreset('请解释这段内容的核心意思、关键概念和隐含逻辑。')} />
                 <IntentButton palette={props.palette} title="联系上下文" onPress={() => fillPreset('请结合前后文，说明这段内容在本章论证中的作用。')} />
                 <IntentButton palette={props.palette} title="说简单点" onPress={() => fillPreset('请用更直白的中文改写这段内容，并举一个贴切的小例子。')} />
                </View>
             )}
            {conversationMessages.map((message, index) => message.role === 'user' ? (
              <View key={`${message.role}-${index}`} style={[styles.historyQuestionBlock, { backgroundColor: props.palette.focus }]}>
                <Text style={[styles.historyQuestionText, { color: props.palette.text }]}>{message.content}</Text>
                <Text style={[styles.messageTime, styles.questionMessageTime, { color: props.palette.muted }]}>{formatMessageTime(message.createdAt, sessionCreatedAt.current)}</Text>
              </View>
            ) : (
              <View key={`${message.role}-${index}`} style={[styles.historyAnswerBlock, { backgroundColor: props.palette.control, borderColor: props.palette.line }]}>
                <Markdown style={{ ...markdownStyles, ...themedMarkdownStyles(props.palette) }}>{message.content}</Markdown>
                <Text style={[styles.messageTime, { color: props.palette.muted }]}>{formatMessageTime(message.createdAt, sessionCreatedAt.current)}</Text>
              </View>
            ))}
            {!!answer && <View style={[styles.historyAnswerBlock, { backgroundColor: props.palette.control, borderColor: props.palette.line }]}>
              <Markdown style={{ ...markdownStyles, ...themedMarkdownStyles(props.palette) }}>{answer}</Markdown>
              <Text style={[styles.messageTime, { color: props.palette.muted }]}>{formatMessageTime(answerTimestamp ?? undefined, sessionCreatedAt.current)}</Text>
            </View>}
            {loading && <View style={styles.thinking}><ActivityIndicator color={props.palette.accent} /><Text style={[styles.thinkingTitle, { color: props.palette.text }]}>正在生成回复…</Text></View>}
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
    </Modal>
  );
}

function IntentButton({ palette, title, onPress }: { palette: ReaderPalette; title: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.intentButton, { backgroundColor: palette.control, borderColor: palette.line }, pressed && styles.pressed]}><Text style={[styles.intentTitle, { color: palette.text }]}>{title}</Text></Pressable>;
}
