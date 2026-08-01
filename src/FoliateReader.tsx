import * as FileSystem from 'expo-file-system/legacy';
import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { FOLIATE_BUNDLE } from './generated/foliateBundle';
import { Bookmark, ReaderPrefs } from './types';

export type FoliatePalette = {
  bg: string;
  text: string;
  muted: string;
  line: string;
  accent: string;
  focus: string;
};

export type FoliateTOCItem = {
  label: string;
  href: string;
  depth: number;
};

export type FoliateLocation = {
  cfi: string;
  progression: number;
  sectionIndex: number;
  sectionProgression: number;
  position: number;
  totalPositions: number;
  title?: string;
};

export type FoliateLongPress = {
  cfi: string;
  sectionIndex: number;
  text: string;
  kind: 'text' | 'image';
  imageData?: string;
  imageTransferId?: string;
};

export type FoliateBookmarkSelection = {
  cfi: string;
  sectionIndex: number;
  text: string;
};

export type FoliateReaderHandle = {
  next: () => void;
  previous: () => void;
  goTo: (target: string) => void;
  goToFraction: (fraction: number) => void;
  previewFraction: (fraction: number) => void;
  back: () => void;
  beginBookmarkSelection: () => void;
  endBookmarkSelection: () => void;
  setBookmarks: (bookmarks: Bookmark[]) => void;
};

type Props = {
  epubUri: string;
  title: string;
  bookmarks: Bookmark[];
  prefs: ReaderPrefs;
  palette: FoliatePalette;
  initialCfi?: string;
  initialProgress: number;
  onReady: (toc: FoliateTOCItem[]) => void;
  onLocationChange: (location: FoliateLocation) => void;
  onCenterTap: () => void;
  onLongPress: (selection: FoliateLongPress) => void;
  onBookmarkSelection: (selection: FoliateBookmarkSelection) => void;
  onBookmarkSelectionModeChange: (active: boolean) => void;
  onNavigationStateChange: (state: { canGoBack: boolean; noteOpen: boolean }) => void;
  onError: (message: string) => void;
};

type HostMessage =
  | { type: 'host-ready' }
  | { type: 'book-ready'; toc: FoliateTOCItem[] }
  | ({ type: 'relocate' } & FoliateLocation)
  | { type: 'center-tap' }
  | ({ type: 'long-press' } & FoliateLongPress)
  | ({ type: 'bookmark-selection' } & FoliateBookmarkSelection)
  | { type: 'bookmark-selection-mode'; active: boolean }
  | { type: 'image-transfer-start'; transferId: string }
  | { type: 'image-transfer-chunk'; transferId: string; chunk: string }
  | { type: 'image-transfer-end'; transferId: string }
  | { type: 'navigation-state'; canGoBack: boolean; noteOpen: boolean }
  | { type: 'error'; message: string };


import { FOLIATE_BRIDGE, FOLIATE_HTML } from './foliate/runtime';


const injectCall = (method: string, ...args: unknown[]) =>
  `globalThis.__MOWEN__?.${method}(${args.map((arg) => JSON.stringify(arg)).join(',')});true;`;

function FoliateReaderComponent(props: Props, ref: React.ForwardedRef<FoliateReaderHandle>) {
  const webView = useRef<WebView>(null);
  const started = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const imageTransfers = useRef(new Map<string, { selection: FoliateLongPress; chunks: string[] }>()).current;
  const config = {
    prefs: props.prefs,
    palette: props.palette,
    bookmarks: props.bookmarks.map((bookmark) => ({
      id: bookmark.id,
      sectionIndex: bookmark.sectionIndex,
      excerpt: bookmark.excerpt,
      locator: bookmark.locator,
    })),
  };

  const bookmarkConfig = useCallback((bookmarks: Bookmark[]) => bookmarks.map((bookmark) => ({
    id: bookmark.id,
    sectionIndex: bookmark.sectionIndex,
    excerpt: bookmark.excerpt,
    locator: bookmark.locator,
  })), []);

  const call = useCallback((method: string, ...args: unknown[]) => {
    webView.current?.injectJavaScript(injectCall(method, ...args));
  }, []);

  const setBookmarks = useCallback((bookmarks: Bookmark[]) => {
    call('configureBookmarks', bookmarkConfig(bookmarks));
  }, [bookmarkConfig, call]);

  useImperativeHandle(ref, () => ({
    next: () => call('next'),
    previous: () => call('previous'),
    goTo: (target) => call('goTo', target),
    goToFraction: (fraction) => call('goToFraction', fraction),
    previewFraction: (fraction) => call('previewFraction', fraction),
    back: () => call('back'),
    beginBookmarkSelection: () => call('beginBookmarkSelection'),
    endBookmarkSelection: () => call('endBookmarkSelection'),
    setBookmarks,
  }), [call, setBookmarks]);

  useEffect(() => {
    if (!loading && !error) call('configure', config);
  }, [error, loading, props.palette, props.prefs, call]);
  useEffect(() => {
    if (!loading && !error) setBookmarks(props.bookmarks);
  }, [error, loading, props.bookmarks, setBookmarks]);

  const sendBook = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    try {
      const base64 = await FileSystem.readAsStringAsync(props.epubUri, { encoding: FileSystem.EncodingType.Base64 });
      const chunkSize = 256 * 1024;
      for (let offset = 0; offset < base64.length; offset += chunkSize) {
        call('appendChunk', base64.slice(offset, offset + chunkSize));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      call('open', {
        name: `${props.title.replace(/[\\/:*?"<>|]/g, '_') || 'book'}.epub`,
        initialCfi: props.initialCfi,
        initialProgress: props.initialProgress,
        config,
      });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '无法读取 EPUB 文件';
      setError(message);
      props.onError(message);
    }
  }, [call, config, props.epubUri, props.initialCfi, props.initialProgress, props.onError, props.title]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    let message: HostMessage;
    try { message = JSON.parse(event.nativeEvent.data) as HostMessage; }
    catch { return; }
    if (message.type === 'host-ready') { void sendBook(); return; }
    if (message.type === 'book-ready') { setLoading(false); props.onReady(message.toc); return; }
    if (message.type === 'relocate') { props.onLocationChange(message); return; }
    if (message.type === 'center-tap') { props.onCenterTap(); return; }
    if (message.type === 'long-press') {
      props.onLongPress(message);
      if (message.kind === 'image' && message.imageTransferId) {
        imageTransfers.set(message.imageTransferId, { selection: message, chunks: [] });
      }
      return;
    }
    if (message.type === 'bookmark-selection') {
      if (typeof message.cfi === 'string' && typeof message.text === 'string' && Number.isInteger(message.sectionIndex) && message.sectionIndex >= 0)
        props.onBookmarkSelection(message);
      return;
    }
    if (message.type === 'bookmark-selection-mode') {
      if (typeof message.active === 'boolean') props.onBookmarkSelectionModeChange(message.active);
      return;
    }
    if (message.type === 'image-transfer-start') {
      if (!imageTransfers.has(message.transferId)) imageTransfers.set(message.transferId, { selection: { cfi: '', sectionIndex: 0, text: '插图', kind: 'image', imageTransferId: message.transferId }, chunks: [] });
      return;
    }
    if (message.type === 'image-transfer-chunk') {
      imageTransfers.get(message.transferId)?.chunks.push(message.chunk);
      return;
    }
    if (message.type === 'image-transfer-end') {
      const transfer = imageTransfers.get(message.transferId);
      if (transfer) {
        imageTransfers.delete(message.transferId);
        props.onLongPress({ ...transfer.selection, imageData: transfer.chunks.join('') });
      }
      return;
    }
    if (message.type === 'navigation-state') {
      props.onNavigationStateChange({ canGoBack: message.canGoBack, noteOpen: message.noteOpen });
      return;
    }
    if (message.type === 'error') {
      setError(message.message);
      setLoading(false);
      props.onError(message.message);
    }
  }, [props.onBookmarkSelection, props.onBookmarkSelectionModeChange, props.onCenterTap, props.onError, props.onLocationChange, props.onLongPress, props.onNavigationStateChange, props.onReady, sendBook]);

  return (
    <View style={[styles.container, { backgroundColor: props.palette.bg }]}>
      <WebView
        ref={webView}
        source={{ html: FOLIATE_HTML, baseUrl: 'https://mowen.local/' }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled={false}
        allowFileAccess={false}
        allowUniversalAccessFromFileURLs={false}
        setSupportMultipleWindows={false}
        mixedContentMode="never"
        injectedJavaScriptBeforeContentLoaded={`${FOLIATE_BUNDLE}\n${FOLIATE_BRIDGE}\ntrue;`}
        onMessage={onMessage}
        onError={(event) => {
          const message = event.nativeEvent.description || 'WebView 无法启动';
          setError(message);
          setLoading(false);
          props.onError(message);
        }}
        style={{ backgroundColor: props.palette.bg }}
      />
      {loading && !error && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, styles.loading, { backgroundColor: props.palette.bg }]}>
          <ActivityIndicator color={props.palette.accent} />
          <Text style={[styles.loadingText, { color: props.palette.muted }]}>Foliate 正在解析 EPUB…</Text>
        </View>
      )}
      {error && (
        <View style={[StyleSheet.absoluteFillObject, styles.loading, { backgroundColor: props.palette.bg }]}>
          <Text style={[styles.errorTitle, { color: props.palette.text }]}>无法打开这本书</Text>
          <Text selectable style={[styles.errorText, { color: props.palette.muted }]}>{error}</Text>
        </View>
      )}
    </View>
  );
}

export const FoliateReader = memo(forwardRef(FoliateReaderComponent));

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
  loading: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  loadingText: { marginTop: 12, fontSize: 14 },
  errorTitle: { fontSize: 18, fontWeight: '700', marginBottom: 10 },
  errorText: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
});
