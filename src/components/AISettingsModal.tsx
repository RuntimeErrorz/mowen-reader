import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AISettings } from '../types';
import { ReaderPalette } from '../ui/theme';
import { styles } from '../ui/styles';

export function AISettingsModal({ palette, visible, value, onSave, onAutoSave, onClose }: { palette: ReaderPalette; visible: boolean; value: AISettings; onSave: (value: AISettings) => void; onAutoSave: (value: AISettings) => void; onClose: () => void }) {
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
