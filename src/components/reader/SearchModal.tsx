import React, { useCallback, useRef } from 'react';
import { ActivityIndicator, FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FoliateSearchResult } from '../../FoliateReader';
import { ReaderPalette } from '../../ui/theme';
import { styles } from '../../ui/styles';
import { DraggableSheet, SheetBackdrop } from './DraggableSheet';
import { useKeyboardVisibility } from './useKeyboardVisibility';

type SearchModalProps = {
  visible: boolean;
  palette: ReaderPalette;
  query: string;
  results: FoliateSearchResult[];
  searching: boolean;
  progress: number | null;
  error: string;
  onQueryChange: (value: string) => void;
  onChoose: (result: FoliateSearchResult, index: number) => void;
  onClear: () => void;
  onClose: () => void;
};

export function SearchModal(props: SearchModalProps) {
  const inputRef = useRef<TextInput>(null);
  const keyboardVisible = useKeyboardVisibility(props.visible);
  const focusInput = useCallback(() => inputRef.current?.focus(), []);

  const close = () => {
    Keyboard.dismiss();
    props.onClose();
  };
  const query = props.query.trim();
  const status = !query
    ? '输入一段文字，查找它在书中的位置'
    : props.searching
      ? `正在查找${props.progress === null ? '…' : ` · ${Math.round(props.progress * 100)}%`}`
      : props.results.length
        ? `找到 ${props.results.length} 处`
        : `没有找到“${query}”`;

  return (
    <Modal visible={props.visible} transparent animationType="none" statusBarTranslucent onRequestClose={close}>
      <View style={styles.aiOverlayRoot}>
      <SheetBackdrop palette={props.palette} onPress={close} />
      <KeyboardAvoidingView pointerEvents="box-none" behavior={Platform.OS === 'ios' ? 'padding' : keyboardVisible ? 'height' : undefined} style={styles.modalRoot}>
        <DraggableSheet visible={props.visible} onClose={close} palette={props.palette} fillBelow showScrim={false} onOpenComplete={focusInput} style={styles.searchSheet}>
          <View style={styles.sheetHeader}>
            <View style={styles.searchHeaderCopy}>
              <Text style={[styles.sheetEyebrow, { color: props.palette.accent }]}>FIND IN BOOK</Text>
              <Text style={[styles.sheetTitle, { color: props.palette.text }]}>全文查找</Text>
            </View>
            <Pressable accessibilityLabel="关闭查找" onPress={close} style={[styles.closeButton, { backgroundColor: props.palette.surfaceAlt }]}>
              <Ionicons name="close" size={20} color={props.palette.text} />
            </Pressable>
          </View>
          <View style={[styles.searchInputRow, { backgroundColor: props.palette.control, borderColor: props.palette.accent }]}>
            <Ionicons name="search-outline" size={18} color={props.palette.accent} />
            <TextInput
              ref={inputRef}
              value={props.query}
              onChangeText={props.onQueryChange}
              placeholder="查找本书中的文字"
              placeholderTextColor={props.palette.muted}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="never"
              style={[styles.searchInput, { color: props.palette.text }]}
            />
            {!!props.query && (
              <Pressable accessibilityLabel="清除查找文字" onPress={props.onClear} style={styles.searchClearButton}>
                <Ionicons name="close-circle" size={18} color={props.palette.muted} />
              </Pressable>
            )}
          </View>
          <View style={styles.searchStatusRow}>
            <Text numberOfLines={1} style={[styles.searchStatus, { color: props.searching ? props.palette.accent : props.palette.muted }]}>{status}</Text>
            {props.searching && <ActivityIndicator size="small" color={props.palette.accent} />}
          </View>
          {!!props.error && <Text style={[styles.searchError, { color: props.palette.text, backgroundColor: props.palette.surfaceAlt, borderColor: props.palette.line }]}>{props.error}</Text>}
          <FlatList
            data={props.results}
            keyExtractor={(item, index) => `${item.cfi}-${index}`}
            style={styles.searchList}
            contentContainerStyle={props.results.length ? styles.searchListContent : styles.searchEmptyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.searchEmpty}>
                <Ionicons name={query ? 'document-text-outline' : 'search-outline'} size={30} color={props.palette.muted} />
                <Text style={[styles.searchEmptyTitle, { color: props.palette.text }]}>{query && !props.searching ? '正文里没有这段文字' : '从一段文字开始'}</Text>
                <Text style={[styles.searchEmptyText, { color: props.palette.muted }]}>{query && !props.searching ? '可以换个词，或只输入更短的片段。' : '结果会按章节列出，点击即可回到原文。'}</Text>
              </View>
            }
            renderItem={({ item, index }) => (
              <SearchResultRow palette={props.palette} result={item} index={index} showSection={index === 0 || props.results[index - 1]?.sectionTitle !== item.sectionTitle} onPress={() => { Keyboard.dismiss(); props.onChoose(item, index); }} />
            )}
          />
        </DraggableSheet>
      </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function SearchResultRow({ palette, result, index, showSection, onPress }: { palette: ReaderPalette; result: FoliateSearchResult; index: number; showSection: boolean; onPress: () => void }) {
  return (
    <View>
      {showSection && <View style={styles.searchSectionLabel}><Text numberOfLines={1} style={[styles.searchSectionText, { color: palette.accent }]}>{result.sectionTitle || `第 ${result.sectionIndex + 1} 章`}</Text><Text style={[styles.searchSectionCount, { color: palette.muted }]}>匹配</Text></View>}
      <Pressable accessibilityLabel={`跳转到第 ${index + 1} 个查找结果`} onPress={onPress} style={({ pressed }) => [styles.searchResult, { borderBottomColor: palette.line }, pressed && styles.pressed]}>
        <Text numberOfLines={3} style={[styles.searchExcerpt, { color: palette.text }]}>…{result.excerpt.pre}<Text style={[styles.searchMatch, { color: palette.accent, backgroundColor: palette.focus }]}>{result.excerpt.match}</Text>{result.excerpt.post}…</Text>
        <Ionicons name="chevron-forward" size={16} color={palette.muted} />
      </Pressable>
    </View>
  );
}
