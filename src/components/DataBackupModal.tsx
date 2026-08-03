import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StatusBar as NativeStatusBar, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { BackupRestoreResult, BackupSaveResult, BackupSelection } from '../backup';
import { ReaderPalette } from '../ui/theme';
import { styles } from '../ui/styles';

type DataBackupModalProps = {
  visible: boolean;
  palette: ReaderPalette;
  bookCount: number;
  bookmarkCount: number;
  messageCount: number;
  onClose: () => void;
  onExport: () => Promise<BackupSaveResult>;
  onPickBackup: () => Promise<BackupSelection | null>;
  onRestore: (selection: BackupSelection) => Promise<BackupRestoreResult>;
};

type BusyState = 'export' | 'pick' | 'restore' | null;

export function DataBackupModal(props: DataBackupModalProps) {
  const [selection, setSelection] = useState<BackupSelection | null>(null);
  const [restored, setRestored] = useState<BackupRestoreResult | null>(null);
  const [busy, setBusy] = useState<BusyState>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!props.visible) return;
    setSelection(null);
    setRestored(null);
    setBusy(null);
    setError('');
    setNotice('');
  }, [props.visible]);

  const handleExport = async () => {
    setBusy('export');
    setError('');
    setNotice('');
    try {
      const result = await props.onExport();
      if (!result.saved) {
        setNotice('已取消保存，备份文件未写入设备。');
        return;
      }
      setNotice(result.missingBooks.length ? `备份已保存；${result.missingBooks.length} 本书找不到原始 EPUB，仅保存了它的阅读记录。` : '备份已保存到你选择的位置。');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '备份生成失败');
    } finally {
      setBusy(null);
    }
  };

  const handlePickBackup = async () => {
    setBusy('pick');
    setError('');
    setNotice('');
    try {
      const next = await props.onPickBackup();
      if (next) setSelection(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取这个备份');
    } finally {
      setBusy(null);
    }
  };

  const handleRestore = async () => {
    if (!selection) return;
    setBusy('restore');
    setError('');
    try {
      const result = await props.onRestore(selection);
      setRestored(result);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导入失败');
    } finally {
      setBusy(null);
    }
  };

  const goHome = () => {
    if (busy) return;
    setSelection(null);
    setRestored(null);
    setError('');
    setNotice('');
  };

  const close = () => {
    if (!busy) props.onClose();
  };

  const barStyle = props.palette.bg === '#142428' ? 'light-content' : 'dark-content';
  return (
    <Modal visible={props.visible} animationType="slide" statusBarTranslucent onRequestClose={close}>
      <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={[styles.dataPage, { backgroundColor: props.palette.bg }]}>
        <NativeStatusBar translucent backgroundColor={props.palette.bg} barStyle={barStyle} />
        <View style={[styles.dataTop, { borderBottomColor: props.palette.line }]}>
          {selection || restored ? (
            <Pressable accessibilityLabel="返回数据管理" onPress={goHome} style={styles.readerIcon}>
              <Ionicons name="arrow-back" size={22} color={props.palette.text} />
            </Pressable>
          ) : <View style={styles.readerIcon} />}
          <Text style={[styles.dataTopTitle, { color: props.palette.text }]}>数据管理</Text>
          <Pressable accessibilityLabel="关闭数据管理" onPress={close} style={styles.readerIcon}>
            <Ionicons name="close" size={23} color={props.palette.text} />
          </Pressable>
        </View>

        {restored ? (
          <RestoreComplete palette={props.palette} result={restored} onDone={close} />
        ) : selection ? (
          <BackupPreviewView palette={props.palette} selection={selection} busy={busy === 'restore'} error={error} onBack={goHome} onRestore={handleRestore} />
        ) : (
          <ScrollView contentContainerStyle={styles.dataScroll} showsVerticalScrollIndicator={false}>
            <View style={[styles.dataHero, { backgroundColor: props.palette.surface, borderColor: props.palette.line }]}>
              <Text style={[styles.dataKicker, { color: props.palette.accent }]}>LOCAL ARCHIVE</Text>
              <View style={styles.dataHeroRow}>
                <View style={[styles.dataHeroMark, { backgroundColor: props.palette.accent }]}><Ionicons name="archive-outline" size={24} color={props.palette.onAccent} /></View>
                <View style={styles.dataHeroCopy}>
                  <Text style={[styles.dataHeroTitle, { color: props.palette.text }]}>把阅读带走</Text>
                  <Text style={[styles.dataHeroSubtitle, { color: props.palette.muted }]}>书籍、进度和思考，放进一个备份文件</Text>
                </View>
              </View>
              <Text style={[styles.dataHeroBody, { color: props.palette.muted }]}>导出后可以保存到云盘、电脑或另一台设备；导入会先检查文件，再合并到当前书架。</Text>
            </View>

            <View style={[styles.dataStats, { backgroundColor: props.palette.surfaceAlt, borderColor: props.palette.line }]}>
              <Stat palette={props.palette} value={props.bookCount} label="书籍" />
              <Stat palette={props.palette} value={props.bookmarkCount} label="书签" />
              <Stat palette={props.palette} value={props.messageCount} label="AI 消息" />
            </View>

            <DataAction
              palette={props.palette}
              icon="save-outline"
              title="导出完整备份"
              description="原始 EPUB、阅读位置、阅读外观、书签、AI 对话和接口参数"
              button="生成并保存"
              busy={busy === 'export'}
              onPress={handleExport}
            />
            <DataAction
              palette={props.palette}
              icon="folder-open-outline"
              title="从备份恢复"
              description="选择 .mowen.zip；先查看内容，确认后合并导入，不会清空当前书架"
              button="选择备份文件"
              busy={busy === 'pick'}
              onPress={handlePickBackup}
              secondary
            />

            <View style={[styles.dataSecurity, { backgroundColor: props.palette.surfaceAlt, borderColor: props.palette.line }]}>
              <Ionicons name="shield-checkmark-outline" size={19} color={props.palette.accent} />
              <View style={styles.dataSecurityCopy}>
                <Text style={[styles.dataSecurityTitle, { color: props.palette.text }]}>API 密钥留在本机</Text>
                <Text style={[styles.dataSecurityText, { color: props.palette.muted }]}>备份包含接口地址、模型和自定义参数，但不会写入 API 密钥。导入后继续使用当前设备保存的密钥。</Text>
              </View>
            </View>
            {!!notice && <Text style={[styles.dataNotice, { color: props.palette.muted }]}>{notice}</Text>}
            {!!error && <Text style={[styles.dataError, { color: props.palette.text, backgroundColor: props.palette.surfaceAlt, borderColor: props.palette.line }]}>{error}</Text>}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function Stat({ palette, value, label }: { palette: ReaderPalette; value: number; label: string }) {
  return <View style={styles.dataStat}><Text style={[styles.dataStatValue, { color: palette.text }]}>{value}</Text><Text style={[styles.dataStatLabel, { color: palette.muted }]}>{label}</Text></View>;
}

function DataAction({ palette, icon, title, description, button, busy, onPress, secondary = false }: { palette: ReaderPalette; icon: React.ComponentProps<typeof Ionicons>['name']; title: string; description: string; button: string; busy: boolean; onPress: () => void; secondary?: boolean }) {
  return (
    <View style={[styles.dataAction, { backgroundColor: palette.surface, borderColor: palette.line }]}>
      <View style={styles.dataActionTop}>
        <View style={[styles.dataActionIcon, { backgroundColor: secondary ? palette.surfaceAlt : palette.accent }]}><Ionicons name={icon} size={21} color={secondary ? palette.accent : palette.onAccent} /></View>
        <View style={styles.dataActionCopy}>
          <Text style={[styles.dataActionTitle, { color: palette.text }]}>{title}</Text>
          <Text style={[styles.dataActionText, { color: palette.muted }]}>{description}</Text>
        </View>
      </View>
      <Pressable disabled={busy} onPress={onPress} style={({ pressed }) => [styles.dataActionButton, { backgroundColor: secondary ? palette.control : palette.accent, borderColor: secondary ? palette.line : palette.accent }, pressed && styles.pressed, busy && { opacity: 0.55 }]}>
        {busy ? <ActivityIndicator color={secondary ? palette.accent : palette.onAccent} /> : <Text style={[styles.dataActionButtonText, { color: secondary ? palette.text : palette.onAccent }]}>{button}</Text>}
      </Pressable>
    </View>
  );
}

function BackupPreviewView({ palette, selection, busy, error, onBack, onRestore }: { palette: ReaderPalette; selection: BackupSelection; busy: boolean; error: string; onBack: () => void; onRestore: () => void }) {
  const { preview } = selection;
  return (
    <ScrollView contentContainerStyle={styles.dataScroll} showsVerticalScrollIndicator={false}>
      <View style={[styles.dataPreviewHero, { backgroundColor: palette.surface, borderColor: palette.line }]}>
        <View style={[styles.dataPreviewStamp, { backgroundColor: palette.accent }]}><Ionicons name="archive" size={20} color={palette.onAccent} /></View>
        <Text style={[styles.dataPreviewEyebrow, { color: palette.accent }]}>BACKUP FOUND</Text>
        <Text numberOfLines={2} style={[styles.dataPreviewFile, { color: palette.text }]}>{preview.fileName}</Text>
        <Text style={[styles.dataPreviewDate, { color: palette.muted }]}>生成于 {new Date(preview.createdAt).toLocaleString()}</Text>
      </View>

      <View style={[styles.dataPreviewStats, { backgroundColor: palette.surfaceAlt, borderColor: palette.line }]}>
        <PreviewStat palette={palette} value={preview.bookCount} label="书籍" />
        <PreviewStat palette={palette} value={preview.bookmarkCount} label="书签" />
        <PreviewStat palette={palette} value={preview.conversationCount} label="对话" />
      </View>

      <View style={[styles.dataPreviewList, { backgroundColor: palette.surface, borderColor: palette.line }]}>
        <PreviewRow palette={palette} icon="book-outline" text={`${preview.availableBookCount} 本书包含原始 EPUB`} />
        {preview.missingBookCount > 0 && <PreviewRow palette={palette} icon="warning-outline" text={`${preview.missingBookCount} 本书只有阅读记录，原文件未包含在备份中`} warning />}
        <PreviewRow palette={palette} icon="chatbubble-ellipses-outline" text={`${preview.messageCount} 条 AI 消息`} />
        <PreviewRow palette={palette} icon="color-palette-outline" text="阅读外观与 AI 接口参数" />
      </View>

      <Text style={[styles.dataMergeHint, { color: palette.muted }]}>导入方式：合并。备份中相同 ID 的记录会更新当前记录，当前设备独有的书籍和数据会保留。</Text>
      <Pressable disabled={busy} onPress={onRestore} style={({ pressed }) => [styles.dataPrimaryButton, { backgroundColor: palette.accent }, pressed && styles.pressed, busy && { opacity: 0.55 }]}>
        {busy ? <ActivityIndicator color={palette.onAccent} /> : <><Ionicons name="download-outline" size={18} color={palette.onAccent} /><Text style={[styles.dataPrimaryButtonText, { color: palette.onAccent }]}>合并导入</Text></>}
      </Pressable>
      <Pressable disabled={busy} onPress={onBack} style={[styles.dataSecondaryButton, { borderColor: palette.line }]}><Text style={[styles.dataSecondaryButtonText, { color: palette.muted }]}>换一个文件</Text></Pressable>
      {!!error && <Text style={[styles.dataError, { color: palette.text, backgroundColor: palette.surfaceAlt, borderColor: palette.line }]}>{error}</Text>}
    </ScrollView>
  );
}

function PreviewStat({ palette, value, label }: { palette: ReaderPalette; value: number; label: string }) {
  return <View style={styles.dataPreviewStat}><Text style={[styles.dataPreviewStatValue, { color: palette.text }]}>{value}</Text><Text style={[styles.dataPreviewStatLabel, { color: palette.muted }]}>{label}</Text></View>;
}

function PreviewRow({ palette, icon, text, warning = false }: { palette: ReaderPalette; icon: React.ComponentProps<typeof Ionicons>['name']; text: string; warning?: boolean }) {
  return <View style={styles.dataPreviewRow}><Ionicons name={icon} size={17} color={warning ? '#C5774F' : palette.accent} /><Text style={[styles.dataPreviewRowText, { color: warning ? '#A36042' : palette.text }]}>{text}</Text></View>;
}

function RestoreComplete({ palette, result, onDone }: { palette: ReaderPalette; result: BackupRestoreResult; onDone: () => void }) {
  return (
    <View style={styles.dataComplete}>
      <View style={[styles.dataCompleteMark, { backgroundColor: palette.accent }]}><Ionicons name="checkmark" size={33} color={palette.onAccent} /></View>
      <Text style={[styles.dataCompleteTitle, { color: palette.text }]}>导入完成</Text>
      <Text style={[styles.dataCompleteText, { color: palette.muted }]}>已恢复 {result.restoredBookCount} 本书，书签和 AI 对话已合并到当前设备。</Text>
      {!!result.skippedBooks.length && <Text style={[styles.dataCompleteWarning, { color: '#A36042' }]}>以下书籍缺少原始 EPUB，未能恢复：{result.skippedBooks.join('、')}</Text>}
      <Pressable onPress={onDone} style={({ pressed }) => [styles.dataPrimaryButton, { backgroundColor: palette.accent }, pressed && styles.pressed]}><Text style={[styles.dataPrimaryButtonText, { color: palette.onAccent }]}>完成</Text></Pressable>
    </View>
  );
}
