import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Pressable, ScrollView, StatusBar as NativeStatusBar, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BookSummary } from '../types';
import { ReaderPalette } from '../ui/theme';
import { styles } from '../ui/styles';
import { SortableBookGrid } from './SortableBookGrid';

export function Splash() {
  return (
    <View style={styles.splash}>
      <StatusBar style="light" />
      <View style={styles.mark}><Text style={styles.markText}>墨</Text></View>
      <Text style={styles.splashName}>墨问</Text>
      <Text style={styles.splashTag}>读到深处，自有回声</Text>
    </View>
  );
}

type LibraryScreenProps = {
  library: BookSummary[];
  palette: ReaderPalette;
  importing: boolean;
  openingBookId: string | null;
  onImport: () => void;
  onOpen: (book: BookSummary) => void;
  onRemove: (book: BookSummary) => Promise<void>;
  onReorder: (books: BookSummary[]) => Promise<void>;
  onSettings: () => void;
  onData: () => void;
};

type Notice = { text: string; error: boolean };
type RemoveRequest = { book: BookSummary; confirm: () => void };

export function LibraryScreen(props: LibraryScreenProps) {
  const insets = useSafeAreaInsets();
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [removeRequest, setRemoveRequest] = useState<RemoveRequest | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  const showNotice = useCallback((text: string, error = false) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ text, error });
    noticeTimer.current = setTimeout(() => setNotice(null), 1900);
  }, []);

  const cancelRemove = useCallback(() => {
    setRemoveRequest(null);
  }, []);

  const requestRemove = useCallback((book: BookSummary, confirm: () => void) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(null);
    setRemoveRequest({ book, confirm });
  }, []);

  const confirmRemove = useCallback(() => {
    const pending = removeRequest;
    if (!pending) return;
    setRemoveRequest(null);
    pending.confirm();
  }, [removeRequest]);

  useEffect(() => {
    if (!removeRequest) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      cancelRemove();
      return true;
    });
    return () => subscription.remove();
  }, [cancelRemove, removeRequest]);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.library, { backgroundColor: props.palette.bg }]}>
      <NativeStatusBar backgroundColor={props.palette.bg} barStyle={props.palette.bg === '#142428' ? 'light-content' : 'dark-content'} />
      <View style={styles.libraryHeader}>
        <View>
          <Text style={[styles.eyebrow, { color: props.palette.accent }]}>MÒ WÈN · READER</Text>
          <Text style={[styles.libraryTitle, { color: props.palette.text }]}>墨问</Text>
        </View>
        <View style={styles.libraryHeaderActions}>
          {removeRequest && (
            <Pressable accessibilityRole="button" accessibilityLabel="确认删除" onPress={confirmRemove} style={({ pressed }) => [styles.libraryRemoveAction, { borderColor: props.palette.danger, backgroundColor: props.palette.bg }, pressed && styles.pressed]}>
              <Ionicons name="trash-outline" size={19} color={props.palette.danger} />
            </Pressable>
          )}
          <Pressable accessibilityLabel="数据管理" onPress={props.onData} style={({ pressed }) => [styles.iconButtonDark, { borderColor: props.palette.line, backgroundColor: props.palette.surfaceAlt }, pressed && styles.pressed]}>
            <Ionicons name="archive-outline" size={21} color={props.palette.text} />
          </Pressable>
          <Pressable accessibilityLabel="AI 设置" onPress={props.onSettings} style={({ pressed }) => [styles.iconButtonDark, { borderColor: props.palette.line, backgroundColor: props.palette.surfaceAlt }, pressed && styles.pressed]}>
            <Ionicons name="options-outline" size={22} color={props.palette.text} />
          </Pressable>
        </View>
      </View>

      <ScrollView scrollEnabled={!dragging} contentContainerStyle={styles.libraryScroll} showsVerticalScrollIndicator={false}>
        <SortableBookGrid books={props.library} palette={props.palette} importing={props.importing} openingBookId={props.openingBookId} onImport={props.onImport} onOpen={props.onOpen} onRemove={props.onRemove} onRemoveRequest={requestRemove} onCancelRemove={cancelRemove} pendingRemovalId={removeRequest?.book.id ?? null} removalPending={!!removeRequest} onReorder={props.onReorder} onNotice={showNotice} onDraggingChange={setDragging} />
        {removeRequest && <Pressable accessibilityRole="button" accessibilityLabel="取消删除" onPress={cancelRemove} style={styles.libraryDismissSpacer} />}
      </ScrollView>

      {notice && <LibraryNotice notice={notice} palette={props.palette} bottomInset={insets.bottom} />}
    </SafeAreaView>
  );
}

function LibraryNotice({ notice, palette, bottomInset }: { notice: Notice; palette: ReaderPalette; bottomInset: number }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();
  }, [notice, opacity]);
  return (
    <Animated.View style={[styles.libraryNotice, { bottom: Math.max(16, bottomInset + 12), backgroundColor: palette.bg, borderTopColor: palette.line, opacity }]}>
      <View style={[styles.libraryNoticeIcon, { backgroundColor: palette.focus }]}>
        <Ionicons name={notice.error ? 'alert-circle-outline' : 'checkmark'} size={16} color={palette.accent} />
      </View>
      <Text numberOfLines={1} style={[styles.libraryNoticeText, { color: palette.text }]}>{notice.text}</Text>
    </Animated.View>
  );
}
