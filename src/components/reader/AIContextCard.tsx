import React, { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type NoteReference } from '../../aiContext';
import { ReaderPalette } from '../../ui/theme';
import { styles } from '../../ui/styles';

type AIContextCardProps = {
  palette: ReaderPalette;
  label: string;
  position?: number;
  excerpt: string;
  excerptIsImage: boolean;
  imageUris: string[];
  notes: NoteReference[];
  requestText?: string;
  onImagePress: (uri: string) => void;
};

export function AIContextCard(props: AIContextCardProps) {
  const [requestExpanded, setRequestExpanded] = useState(false);
  useEffect(() => setRequestExpanded(false), [props.requestText]);

  return (
    <View style={[styles.contextCard, { backgroundColor: props.palette.surfaceAlt, borderLeftColor: props.palette.accent }]}>
      <View style={styles.contextLabelRow}>
        <Text style={[styles.contextLabel, { color: props.palette.accent }]}>{props.label}{props.position === undefined ? '' : ` · 位置 ${props.position + 1}`}</Text>
        <View style={styles.contextSummary}>
          <Text style={[styles.contextSummaryText, { color: props.palette.muted }]}>{props.imageUris.length} 张图片</Text>
          <Text style={[styles.contextSummaryText, { color: props.palette.muted }]}>{props.notes.length} 条注释</Text>
        </View>
      </View>
      <Text numberOfLines={5} style={[styles.contextText, { color: props.palette.text }]}>{props.excerptIsImage ? '当前是一幅插图，AI 将结合图片内容理解。' : props.excerpt}</Text>
      {!!props.imageUris.length && <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.contextImages}>
        {props.imageUris.map((uri, index) => <Pressable key={`${index}-${uri.slice(0, 32)}`} accessibilityLabel={`放大查看上下文图片 ${index + 1}`} onPress={() => props.onImagePress(uri)} style={({ pressed }) => [styles.contextImagePress, pressed && styles.pressed]}>
          <Image source={{ uri }} style={[styles.contextImage, { borderColor: props.palette.line }]} />
          <View style={[styles.contextImageIndex, { backgroundColor: props.palette.scrim }]}><Text style={[styles.contextImageIndexText, { color: props.palette.onAccent }]}>{index + 1}</Text></View>
        </Pressable>)}
      </ScrollView>}
      {!!props.notes.length && <View style={[styles.contextNotes, { borderTopColor: props.palette.line }]}>
        <View style={styles.contextNotesHeader}><Ionicons name="bookmark-outline" size={14} color={props.palette.accent} /><Text style={[styles.contextNotesHeaderText, { color: props.palette.accent }]}>注释</Text><Text style={[styles.contextSummaryText, { color: props.palette.muted }]}>{props.notes.length} 条</Text></View>
        <ScrollView horizontal nestedScrollEnabled keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.contextNotesRail}>
          {props.notes.map((note, index) => <View key={`${note.id}-${index}`} style={[styles.contextNoteCard, { backgroundColor: props.palette.control, borderColor: props.palette.line }]}>
            <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="always" showsVerticalScrollIndicator persistentScrollbar style={styles.contextNoteScroll} contentContainerStyle={styles.contextNoteScrollContent}>
              <Text selectable style={[styles.contextNoteText, { color: props.palette.text }]}>{note.label ? <Text style={{ color: props.palette.accent, fontWeight: '800' }}>{note.label} </Text> : null}{note.text}</Text>
            </ScrollView>
          </View>)}
        </ScrollView>
      </View>}
      {!!props.requestText && <View style={[styles.contextRequest, { borderTopColor: props.palette.line }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={requestExpanded ? '收起 AI 发送正文' : '展开 AI 发送正文'}
          onPress={() => setRequestExpanded((expanded) => !expanded)}
          style={({ pressed }) => [styles.contextRequestHeader, pressed && styles.pressed]}
        >
          <View style={styles.contextRequestTitle}><Ionicons name="document-text-outline" size={14} color={props.palette.accent} /><Text style={[styles.contextNotesHeaderText, { color: props.palette.accent }]}>AI 发送正文</Text></View>
          <View style={styles.contextRequestMeta}><Text style={[styles.contextSummaryText, { color: props.palette.muted }]}>{props.requestText.length} 字</Text><Ionicons name={requestExpanded ? 'chevron-up' : 'chevron-down'} size={15} color={props.palette.muted} /></View>
        </Pressable>
        {requestExpanded && <View style={[styles.contextRequestBody, { backgroundColor: props.palette.control, borderColor: props.palette.line }]}>
          <Text selectable style={[styles.contextRequestText, { color: props.palette.text }]}>{props.requestText}</Text>
        </View>}
      </View>}
    </View>
  );
}
