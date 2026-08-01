import React from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StatusBar as NativeStatusBar, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BookSummary } from '../types';
import { C, ReaderPalette } from '../ui/theme';
import { styles } from '../ui/styles';

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
  onRemove: (book: BookSummary) => void;
  onSettings: () => void;
};

export function LibraryScreen(props: LibraryScreenProps) {
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.library, { backgroundColor: props.palette.bg }]}>
      <NativeStatusBar backgroundColor={props.palette.bg} barStyle={props.palette.bg === '#142428' ? 'light-content' : 'dark-content'} />
      <View style={styles.libraryHeader}>
        <View>
          <Text style={[styles.eyebrow, { color: props.palette.accent }]}>MÒ WÈN · READER</Text>
          <Text style={[styles.libraryTitle, { color: props.palette.text }]}>墨问</Text>
        </View>
        <Pressable accessibilityLabel="AI 设置" onPress={props.onSettings} style={({ pressed }) => [styles.iconButtonDark, { borderColor: props.palette.line, backgroundColor: props.palette.surfaceAlt }, pressed && styles.pressed]}>
          <Ionicons name="options-outline" size={22} color={props.palette.text} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.libraryScroll} showsVerticalScrollIndicator={false}>
        <View style={styles.sectionHead}>
          <Text style={[styles.sectionTitle, { color: props.palette.text }]}>书架</Text>
          <Text style={[styles.sectionCount, { color: props.palette.muted }]}>{props.library.length} 本</Text>
        </View>
        <View style={styles.bookGrid}>
          {props.library.map((item, index) => (
            <BookTile palette={props.palette} key={item.id} item={item} index={index} loading={props.openingBookId === item.id} disabled={!!props.openingBookId} onOpen={() => props.onOpen(item)} onRemove={() => props.onRemove(item)} />
          ))}
          <View style={styles.addTileWrap}>
            <Pressable onPress={props.onImport} style={({ pressed }) => [styles.addTile, { borderColor: props.palette.line, backgroundColor: props.palette.surface }, pressed && styles.cardPressed]}>
              {props.importing ? <ActivityIndicator color={props.palette.accent} /> : <Ionicons name="add" size={30} color={props.palette.accent} />}
              <Text style={[styles.addText, { color: props.palette.accent }]}>{props.importing ? '正在导入…' : '导入 EPUB'}</Text>
              <Text style={[styles.addHint, { color: props.palette.muted }]}>文件仅保存在本机</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function BookTile({ palette, item, index, loading, disabled, onOpen, onRemove }: { palette: ReaderPalette; item: BookSummary; index: number; loading: boolean; disabled: boolean; onOpen: () => void; onRemove: () => void }) {
  const covers = [
    ['#8DA9A6', '#355B61'], ['#A5A797', '#4E554F'], ['#B58D73', '#654B42'], ['#78919E', '#354D59'],
  ];
  const colors = covers[index % covers.length] as [string, string];
  return (
    <View style={styles.bookTileWrap}>
      <Pressable disabled={disabled} onPress={onOpen} onLongPress={onRemove} style={({ pressed }) => [styles.bookTile, pressed && styles.cardPressed]}>
        {item.cover ? <Image source={{ uri: item.cover }} style={styles.coverImage} /> : (
          <LinearGradient colors={colors} style={styles.coverFallback}>
            <View style={styles.coverLine} />
            <Text numberOfLines={4} style={styles.coverTitle}>{item.title}</Text>
            <Text numberOfLines={1} style={styles.coverAuthor}>{item.author}</Text>
            <Text style={styles.coverSeal}>墨问</Text>
          </LinearGradient>
        )}
        {loading && <View style={styles.bookOpening}><ActivityIndicator color={C.white} /></View>}
        {item.progress > 0 && <View style={styles.bookProgress}><View style={[styles.bookProgressFill, { width: `${item.progress * 100}%` }]} /></View>}
      </Pressable>
      <Text numberOfLines={1} style={[styles.tileTitle, { color: palette.text }]}>{item.title}</Text>
      <Text numberOfLines={1} style={[styles.tileAuthor, { color: palette.muted }]}>{item.author}</Text>
    </View>
  );
}
