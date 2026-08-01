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
  | { type: 'debug'; message: string }
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

const FOLIATE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob: data:; font-src blob: data:; style-src 'unsafe-inline' blob:; connect-src blob: data:; frame-src blob:; script-src 'none';">
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body,foliate-view,foliate-paginator{margin:0;width:100%;height:100%;overflow:hidden}
html,body{background:#fff}
#reader-shell{position:fixed;inset:0;overflow:hidden}
#page-stage,#page-current,.page-preview{position:absolute;inset:0;overflow:hidden}
#page-stage{contain:layout paint;isolation:isolate}
#page-current,.page-preview{transform:translate3d(0,0,0);transition:none!important;backface-visibility:hidden}
#page-current{z-index:2}
.page-preview{z-index:1;pointer-events:none;contain:strict}
#page-preview-prev{transform:translate3d(-100%,0,0)}
#page-preview-next{transform:translate3d(100%,0,0)}
.bookmark-selection-handle{display:none;position:fixed;z-index:6;left:0;top:0;width:44px;height:52px;touch-action:none;user-select:none;-webkit-user-select:none;transform:translate3d(-100px,-100px,0)}
.bookmark-selection-handle.visible{display:block}
.bookmark-selection-handle::before{content:"";position:absolute;left:20px;top:5px;width:4px;height:22px;border-radius:2px;background:var(--accent)}
.bookmark-selection-handle::after{content:"";position:absolute;left:14px;top:23px;width:16px;height:16px;border:2px solid var(--bg);border-radius:50%;background:var(--accent);box-shadow:0 1px 4px rgba(0,0,0,.28)}
foliate-view,foliate-paginator{display:block}
foliate-view::part(head),foliate-view::part(foot){display:none}
#note-backdrop{display:none;position:fixed;z-index:2147483647;inset:0;background:rgba(0,0,0,.24);padding:18px;align-items:flex-end}
#note-backdrop.open{display:flex}
#note-card{position:relative;width:100%;max-height:58%;border-radius:16px;overflow:hidden;border:1px solid var(--line);background:var(--bg);box-shadow:0 12px 40px rgba(0,0,0,.25)}
#note-title{padding:15px 54px 10px 20px;color:var(--text);font-size:13px;line-height:1.45;font-weight:700;border-bottom:1px solid var(--line)}
#note-content{display:block;width:100%;max-width:100%;max-height:min(42vh,420px);padding:13px 20px 20px;overflow-x:hidden;overflow-y:auto;color:var(--text);font-size:16px;line-height:1.65;overflow-wrap:anywhere;word-break:break-word}
#note-content article{display:block;width:100%;max-width:100%;min-width:0}
#note-content article *{box-sizing:border-box!important;max-width:100%!important;min-width:0!important;color:inherit!important;font-size:inherit!important;line-height:inherit!important}
#note-content article :is(sup,sub){font-size:.75em!important;line-height:0!important}
#note-content p,#note-content div,#note-content li,#note-content blockquote,#note-content dd,#note-content dt{width:auto!important;white-space:normal!important;overflow-wrap:anywhere!important;word-break:break-word!important}
#note-content p{margin:0 0 .8em}
#note-content pre,#note-content code{white-space:pre-wrap!important;overflow-wrap:anywhere!important;word-break:break-word!important}
#note-content table{display:table!important;width:100%!important;table-layout:fixed!important;border-collapse:collapse}
#note-content th,#note-content td{width:auto!important;white-space:normal!important;overflow-wrap:anywhere!important;word-break:break-word!important}
#note-content img,#note-content svg,#note-content video{display:block;max-width:100%!important;width:auto!important;height:auto!important;margin-inline:auto}
#note-content article a{color:var(--accent)!important}
#note-close{position:absolute;z-index:2;right:8px;top:8px;width:34px;height:34px;border:0;border-radius:17px;background:var(--bg);color:var(--muted);font-size:22px}
</style></head><body><div id="reader-shell"><div id="page-stage"><div id="page-preview-prev" class="page-preview"></div><div id="page-current"></div><div id="page-preview-next" class="page-preview"></div></div></div><div id="bookmark-selection-handle-start" class="bookmark-selection-handle" data-endpoint="start" aria-hidden="true"></div><div id="bookmark-selection-handle-end" class="bookmark-selection-handle" data-endpoint="end" aria-hidden="true"></div><div id="note-backdrop"><div id="note-card"><button id="note-close" aria-label="关闭">×</button><div id="note-title">注释</div><div id="note-content"></div></div></div></body></html>`;

const FOLIATE_BRIDGE = String.raw`
(() => {
  const send = value => globalThis.ReactNativeWebView?.postMessage(JSON.stringify(value));
  const debug = message => send({ type: 'debug', message: '[MOWEN_BOOKMARK] ' + String(message) });
  const state = {
    chunks: [],
    config: null,
    view: null,
    currentCfi: '',
    visibleRange: null,
    previews: null,
    previewToken: 0,
    turn: null,
    gesture: null,
    pageWidth: 0,
    lastTurnDir: 1,
    resizeFrame: 0,
    scrollIntentDir: 0,
    scrollIntentUntil: 0,
    scrollTurn: false,
    scrollCheckFrame: 0,
    bookmarkSelecting: false,
    bookmarkPageTurning: false,
    bookmarkSelectionRestore: null,
    bookmarkSelectionPageTurn: null,
    bookmarkSelectionModel: null,
    bookmarkHandleController: null,
    bookmarkHeldHandle: null,
    bookmarkOuterPageGesture: null,
    bookmarkPageDragOffset: 0,
    bookmarkHighlightKeys: new Set(),
  };
  const labelOf = value => typeof value === 'string' ? value : value && typeof value === 'object' ? String(value.zh || value['zh-CN'] || value.en || Object.values(value)[0] || '') : '';
  const flattenTOC = (items, depth = 0, output = []) => {
    for (const item of items || []) {
      output.push({ label: labelOf(item.label) || '未命名章节', href: item.href || '', depth });
      flattenTOC(item.subitems, depth + 1, output);
    }
    return output;
  };
  const styleText = config => {
    const p = config.prefs;
    const c = config.palette;
    const family = p.fontStyle === 'sans'
      ? '-apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans CJK SC",sans-serif'
      : 'Iowan Old Style,"Songti SC","Noto Serif CJK SC",serif';
    const align = p.textAlign === 'justify' ? 'justify' : 'left';
    return [
      ':root { color-scheme: ' + (p.theme === 'night' ? 'dark' : 'light') + '; background: ' + c.bg + ' !important; color: ' + c.text + ' !important; }',
      'html, body { margin: 0 !important; padding: 0 !important; background: ' + c.bg + ' !important; color: ' + c.text + ' !important; }',
      'html, body { touch-action: ' + (p.readingMode === 'paged' ? 'none' : 'pan-y') + ' !important; overscroll-behavior: ' + (p.readingMode === 'paged' ? 'none' : 'auto') + ' !important; }',
      'body { font-family: ' + family + ' !important; font-size: ' + p.fontSize + 'px !important; line-height: ' + p.lineHeight + ' !important; text-align: ' + align + '; overflow-wrap: break-word; }',
      ':root:root body * { font-family: inherit !important; font-size: 1em !important; line-height: inherit !important; color: inherit !important; }',
      ':root:root body h1 { font-size: 1.75em !important; line-height: 1.3 !important; color: ' + c.text + ' !important; }',
      ':root:root body h2 { font-size: 1.55em !important; line-height: 1.35 !important; color: ' + c.text + ' !important; }',
      ':root:root body h3 { font-size: 1.35em !important; line-height: 1.4 !important; color: ' + c.text + ' !important; }',
      ':root:root body h4, :root:root body h5, :root:root body h6 { font-size: 1.15em !important; line-height: 1.45 !important; color: ' + c.text + ' !important; }',
      ':root:root body h1, :root:root body h2, :root:root body h3, :root:root body h4, :root:root body h5, :root:root body h6, :root:root body [role="heading"], :root:root body [class*="title" i], :root:root body [class*="heading" i], :root:root body [class*="biaoti" i], :root:root body [class*="title" i] p, :root:root body [class*="heading" i] p, :root:root body [class*="biaoti" i] p { text-indent: 0 !important; }',
      ':root:root body small, :root:root body figcaption, :root:root body .tushuo, :root:root body .tuti, :root:root body .tuzhu { font-size: .85em !important; line-height: 1.55 !important; }',
      ':root:root body sup, :root:root body sub, :root:root body rt { font-size: .72em !important; line-height: 0 !important; }',
      ':root:root body pre, :root:root body code, :root:root body kbd, :root:root body samp { font-family: monospace !important; font-size: .9em !important; }',
      'body p { margin-block-start: 0 !important; margin-block-end: ' + p.paragraphSpacing + 'px !important; text-indent: ' + (p.firstLineIndent ? '2em' : '0') + ' !important; }',
      'figure p, figcaption, caption, td p, th p, li > p, nav p, [epub\\:type~="titlepage"] p, [epub\\:type~="toc"] p, .caption, .tushuo, .tuti, .tuzhu { text-indent: 0 !important; }',
      'body, p, div, section, article, li, blockquote, h1, h2, h3, h4, h5, h6 { color: ' + c.text + ' !important; }',
      ':root:root body a, :root:root body a:visited { color: ' + c.accent + ' !important; }',
      'img, svg, video { max-inline-size: 100% !important; block-size: auto; object-fit: contain; }',
      'figure, .chatu_img, .chatu_img-l, .illustration, .image, .figure { break-inside: avoid; page-break-inside: avoid; }',
      'figure > img, .chatu_img > img, .chatu_img-l > img { max-block-size: 68vh !important; }',
      'figcaption, .tuti, .tuzhu { break-before: avoid; break-inside: avoid; }',
      'aside[epub|type~="endnote"], aside[epub|type~="footnote"], aside[epub|type~="note"], aside[epub|type~="rearnote"] { display: none; }',
      'ol.footnote-content, ul.footnote-content, section.footnote-content { display: none !important; }',
      '::selection { background: ' + c.focus + '; color: ' + c.text + '; }',
    ].join('\n');
  };
  let surfaceCache = null;
  const surfaces = () => surfaceCache ??= {
    shell: document.getElementById('reader-shell'),
    stage: document.getElementById('page-stage'),
    current: document.getElementById('page-current'),
    previous: document.getElementById('page-preview-prev'),
    next: document.getElementById('page-preview-next'),
  };
  const currentSurface = () => surfaces().current;
  const previewSurface = dir => dir < 0 ? surfaces().previous : surfaces().next;
  const measurePageWidth = () => {
    state.pageWidth = Math.max(1, surfaces().shell.getBoundingClientRect().width);
    return state.pageWidth;
  };
  const pageWidth = () => state.pageWidth || measurePageWidth();
  const setSurfaceX = (surface, value) => {
    if (!surface) return;
    const scale = Math.max(1, globalThis.devicePixelRatio || 1);
    const aligned = Math.round(value * scale) / scale;
    surface.style.transform = 'translate3d(' + aligned + 'px,0,0)';
  };
  const configureRenderer = (renderer, config) => {
    if (!renderer) return;
    const paged = config.prefs.readingMode === 'paged';
    renderer.removeAttribute('animated');
    renderer.setAttribute('flow', paged ? 'paginated' : 'scrolled');
    renderer.setAttribute('margin', '0px');
    const horizontalInset = config.prefs.pagePaddingLeft + config.prefs.pagePaddingRight;
    const desiredGap = horizontalInset / Math.max(1, globalThis.innerWidth || 1);
    // Foliate expands the declared percentage into both page-edge padding and
    // the inter-column gap. Invert that expansion so the user-set margins stay
    // visually accurate on every screen width.
    const gap = Math.min(40, desiredGap / (1 + desiredGap) * 100);
    renderer.setAttribute('gap', paged ? gap + '%' : '0%');
    renderer.setAttribute('max-column-count', '1');
    renderer.setStyles?.(styleText(config));
  };
  const resetSurfaces = () => {
    state.bookmarkPageDragOffset = 0;
    const width = pageWidth();
    const current = currentSurface();
    const previous = previewSurface(-1);
    const next = previewSurface(1);
    setSurfaceX(current, 0);
    setSurfaceX(previous, -width);
    setSurfaceX(next, width);
    if (current) {
      if (state.config?.prefs.readingMode === 'paged') current.style.willChange = 'transform';
      else current.style.removeProperty('will-change');
    }
    for (const surface of [previous, next]) surface?.style.removeProperty('will-change');
    if (!state.bookmarkPageTurning) state.bookmarkHandleController?.render?.();
  };
  const disposePreviews = () => {
    state.previewToken++;
    for (const preview of state.previews ? [state.previews.previous, state.previews.next] : []) {
      try { preview.renderer.destroy?.(); } catch {}
      preview.surface.replaceChildren();
    }
    state.previews = null;
    resetSurfaces();
  };
  const createPreview = dir => {
    const surface = previewSurface(dir);
    const renderer = document.createElement('foliate-paginator');
    const preview = {
      dir,
      surface,
      renderer,
      detail: null,
      ready: false,
      baseCfi: '',
      targetCfi: '',
      requestedToken: 0,
      preparing: false,
      retryAfter: 0,
      queue: Promise.resolve(),
    };
    renderer.addEventListener('relocate', event => { preview.detail = event.detail || null; });
    renderer.open(state.view.book);
    configureRenderer(renderer, state.config);
    surface.replaceChildren(renderer);
    return preview;
  };
  const ensurePreviews = () => {
    if (state.previews || !state.view?.book || state.config?.prefs.readingMode !== 'paged') return state.previews;
    state.previews = {
      previous: createPreview(-1),
      next: createPreview(1),
    };
    return state.previews;
  };
  const preparePreview = (preview, cfi, token) => {
    if (!preview || preview.requestedToken === token && (preview.ready || preview.preparing)) return;
    if (preview.retryAfter > performance.now()) return;
    const continuesFromTarget = preview.ready && preview.targetCfi === cfi;
    preview.requestedToken = token;
    preview.preparing = true;
    preview.ready = false;
    preview.baseCfi = '';
    preview.targetCfi = '';
    preview.surface.style.removeProperty('will-change');
    preview.queue = preview.queue.catch(() => {}).then(async () => {
      if (token !== state.previewToken || !state.view || state.config?.prefs.readingMode !== 'paged') return;
      if (!continuesFromTarget) {
        const resolved = state.view.resolveNavigation?.(cfi);
        if (!resolved) return;
        preview.detail = null;
        await preview.renderer.goTo(resolved);
        if (token !== state.previewToken) return;
      }
      preview.detail = null;
      await (preview.dir < 0 ? preview.renderer.prev() : preview.renderer.next());
      if (token !== state.previewToken || !preview.detail) return;
      let targetCfi = '';
      try { targetCfi = state.view.getCFI(preview.detail.index, preview.detail.range) || ''; } catch {}
      if (!targetCfi || targetCfi === cfi) return;
      preview.baseCfi = cfi;
      preview.targetCfi = targetCfi;
      preview.ready = true;
      preview.retryAfter = 0;
      preview.surface.style.willChange = 'transform';
      if (state.gesture) queueGestureFrame(state.gesture);
    }).catch(() => {
      if (token === state.previewToken) preview.retryAfter = performance.now() + 240;
    }).finally(() => {
      if (preview.requestedToken !== token) return;
      preview.preparing = false;
      if (!preview.ready) preview.retryAfter = Math.max(preview.retryAfter, performance.now() + 240);
    });
  };
  const preparePreviews = cfi => {
    if (!cfi || state.config?.prefs.readingMode !== 'paged') return;
    const previews = ensurePreviews();
    if (!previews) return;
    const token = ++state.previewToken;
    const primary = state.lastTurnDir < 0 ? previews.previous : previews.next;
    const secondary = state.lastTurnDir < 0 ? previews.next : previews.previous;
    // Each preview owns its own paginator and queue, so preparing both here is
    // parallel. This avoids arriving at a spine boundary before the opposite
    // direction has left the idle queue.
    preparePreview(primary, cfi, token);
    preparePreview(secondary, cfi, token);
  };
  const preparedPreview = dir => {
    const preview = dir < 0 ? state.previews?.previous : state.previews?.next;
    return preview?.ready && preview.baseCfi === state.currentCfi ? preview : null;
  };
  const drawDrag = (rawDelta, gesture) => {
    const width = gesture.width;
    const dir = rawDelta < 0 ? 1 : -1;
    const preview = preparedPreview(dir);
    const delta = preview ? Math.max(-width, Math.min(width, rawDelta)) : rawDelta * .16;
    state.bookmarkPageDragOffset = delta;
    if (gesture.activeDir !== dir || gesture.activePreview !== preview) {
      if (gesture.activePreview) {
        setSurfaceX(
          gesture.activePreview.surface,
          gesture.activePreview.dir < 0 ? -width : width,
        );
      }
      gesture.activeDir = dir;
      gesture.activePreview = preview;
      if (!preview && gesture.requestedDir !== dir) {
        gesture.requestedDir = dir;
        const candidate = dir < 0 ? state.previews?.previous : state.previews?.next;
        preparePreview(candidate, state.currentCfi, state.previewToken);
      }
    }
    setSurfaceX(currentSurface(), delta);
    if (gesture.activePreview) {
      const activePreview = gesture.activePreview;
      activePreview.surface.style.willChange = 'transform';
      setSurfaceX(activePreview.surface, delta + (dir > 0 ? width : -width));
    }
    state.bookmarkHandleController?.render?.();
  };
  const flushGestureFrame = gesture => {
    if (!gesture) return;
    if (gesture.frame) {
      globalThis.cancelAnimationFrame(gesture.frame);
      gesture.frame = 0;
    }
    drawDrag(gesture.pendingDelta, gesture);
  };
  const queueGestureFrame = gesture => {
    if (gesture.frame) return;
    gesture.frame = globalThis.requestAnimationFrame(() => {
      gesture.frame = 0;
      if (state.gesture === gesture) drawDrag(gesture.pendingDelta, gesture);
    });
  };
  const finishTurn = turn => {
    if (state.turn !== turn) return;
    state.turn = null;
    resetSurfaces();
    preparePreviews(state.currentCfi);
  };
  const turnPage = dir => {
    if (!state.view || state.config?.prefs.readingMode !== 'paged' || state.turn) return false;
    const width = pageWidth();
    const preview = preparedPreview(dir);
    const turn = { id: Date.now() + Math.random(), dir };
    state.lastTurnDir = dir;
    state.turn = turn;
    if (preview) {
      state.bookmarkPageDragOffset = dir > 0 ? -width : width;
      setSurfaceX(currentSurface(), state.bookmarkPageDragOffset);
      setSurfaceX(preview.surface, 0);
      state.bookmarkHandleController?.render?.();
    } else resetSurfaces();
    const navigation = dir > 0 ? state.view.next() : state.view.prev();
    Promise.resolve(navigation).catch(() => {}).finally(() => finishTurn(turn));
    return true;
  };
  const maybeTurnScrolledSection = () => {
    if (
      !state.view
      || state.config?.prefs.readingMode !== 'scroll'
      || state.scrollTurn
      || state.scrollIntentUntil < performance.now()
    ) return false;
    const renderer = state.view.renderer;
    const dir = state.scrollIntentDir;
    const atBoundary = dir > 0
      ? renderer.viewSize - renderer.end <= 2
      : dir < 0 && renderer.start <= 2;
    if (!dir || !atBoundary) return false;
    state.scrollTurn = true;
    state.scrollIntentDir = 0;
    state.scrollIntentUntil = 0;
    const navigation = dir > 0 ? state.view.next() : state.view.prev();
    Promise.resolve(navigation).catch(() => {}).finally(() => {
      globalThis.setTimeout(() => { state.scrollTurn = false; }, 80);
    });
    return true;
  };
  const queueScrolledBoundaryCheck = () => {
    if (state.scrollCheckFrame || state.config?.prefs.readingMode !== 'scroll') return;
    state.scrollCheckFrame = globalThis.requestAnimationFrame(() => {
      state.scrollCheckFrame = 0;
      maybeTurnScrolledSection();
    });
  };
  const pager = {
    begin(x, y, time) {
      if (state.config?.prefs.readingMode !== 'paged' || state.turn) return false;
      ensurePreviews();
      const width = measurePageWidth();
      const gesture = {
        startX: x,
        startY: y,
        lastX: x,
        lastTime: time,
        delta: 0,
        pendingDelta: 0,
        velocity: 0,
        axis: null,
        frame: 0,
        width,
        activeDir: 0,
        activePreview: null,
        requestedDir: 0,
      };
      state.gesture = gesture;
      const current = currentSurface();
      if (current) current.style.willChange = 'transform';
      return true;
    },
    move(x, y, time) {
      const gesture = state.gesture;
      if (!gesture) return false;
      const dx = x - gesture.startX;
      const dy = y - gesture.startY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      const dt = Math.max(1, time - gesture.lastTime);
      const instantVelocity = (x - gesture.lastX) / dt;
      gesture.velocity = gesture.velocity * .72 + instantVelocity * .28;
      gesture.lastX = x;
      gesture.lastTime = time;
      gesture.delta = dx;
      gesture.pendingDelta = dx;
      if (!gesture.axis && Math.max(absX, absY) >= 3)
        gesture.axis = absY > absX * 1.15 ? 'vertical' : 'horizontal';
      if (gesture.axis === 'vertical') {
        resetSurfaces();
        return false;
      }
      if (!gesture.axis && absY > absX) return true;
      queueGestureFrame(gesture);
      return true;
    },
    end(beforeTurn) {
      const gesture = state.gesture;
      if (!gesture) return { moved: false, committed: false };
      state.gesture = null;
      flushGestureFrame(gesture);
      const width = gesture.width;
      const moved = gesture.axis === 'horizontal' && Math.abs(gesture.delta) >= 4;
      const projectedDelta = gesture.delta + gesture.velocity * 180;
      const dir = projectedDelta < 0 ? 1 : -1;
      const distanceTowardTarget = dir > 0 ? -gesture.delta : gesture.delta;
      const velocityTowardTarget = dir > 0 ? -gesture.velocity : gesture.velocity;
      let committed = moved
        && (distanceTowardTarget >= width * .16 || velocityTowardTarget >= .32);
      if (committed && beforeTurn?.(dir) === false) committed = false;
      if (committed) turnPage(dir);
      else resetSurfaces();
      return { moved, committed, dir };
    },
    cancel() {
      const gesture = state.gesture;
      state.gesture = null;
      if (gesture?.frame) globalThis.cancelAnimationFrame(gesture.frame);
      resetSurfaces();
    },
    turn: turnPage,
    relocate(cfi) {
      state.currentCfi = cfi || '';
      if (state.turn) {
        const turn = state.turn;
        state.turn = null;
        resetSurfaces();
        Promise.resolve().then(() => { if (state.turn !== turn) preparePreviews(state.currentCfi); });
      } else preparePreviews(state.currentCfi);
    },
  };
  const applyConfig = config => {
    state.config = config;
    const shell = surfaces().shell;
    const paged = config.prefs.readingMode === 'paged';
    // A paginated view must own the horizontal margins. Keeping them on this
    // shell turns the page into a smaller moving viewport, leaving its margins
    // behind while Foliate follows a finger.
    shell.style.inset = paged
      ? config.prefs.pagePaddingTop + 'px 0 ' + config.prefs.pagePaddingBottom + 'px 0'
      : config.prefs.pagePaddingTop + 'px ' + config.prefs.pagePaddingRight + 'px ' + config.prefs.pagePaddingBottom + 'px ' + config.prefs.pagePaddingLeft + 'px';
    state.pageWidth = 0;
    document.documentElement.style.setProperty('--bg', config.palette.bg);
    document.documentElement.style.setProperty('--text', config.palette.text);
    document.documentElement.style.setProperty('--muted', config.palette.muted);
    document.documentElement.style.setProperty('--line', config.palette.line);
    document.documentElement.style.setProperty('--accent', config.palette.accent);
    document.documentElement.style.background = config.palette.bg;
    document.body.style.background = config.palette.bg;
    configureRenderer(state.view?.renderer, config);
    for (const preview of state.previews ? [state.previews.previous, state.previews.next] : [])
      configureRenderer(preview.renderer, config);
    pager.cancel();
    const contents = state.view?.renderer?.getContents?.() || [];
    debug('configure contents=' + contents.length + ' bookmarks=' + (state.config?.bookmarks?.length || 0));
    for (const { doc, index, overlayer } of contents) applyBookmarkHighlights(doc, index, overlayer);
    if (paged) {
      state.scrollIntentDir = 0;
      state.scrollIntentUntil = 0;
      ensurePreviews();
      preparePreviews(state.currentCfi);
    } else disposePreviews();
  };
  const applyBookmarks = bookmarks => {
    const next = Array.isArray(bookmarks) ? bookmarks : [];
    debug('configureBookmarks received count=' + next.length + ' config=' + (!!state.config) + ' view=' + (!!state.view));
    if (!state.config) {
      debug('configureBookmarks skipped: config is not ready');
      return;
    }
    state.config = { ...state.config, bookmarks: next };
    const contents = state.view?.renderer?.getContents?.() || [];
    debug('configureBookmarks contents=' + contents.length);
    for (const { doc, index, overlayer } of contents) applyBookmarkHighlights(doc, index, overlayer);
  };
  const bookmarkRange = (doc, needle) => {
    const target = needle.replace(/\s+/g, ' ').trim();
    if (!target) return null;
    const nodes = [];
    let raw = '';
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest('script,style,noscript')) continue;
      nodes.push({ node, start: raw.length });
      raw += node.nodeValue || '';
    }
    let normalized = '';
    const map = [];
    for (let offset = 0; offset < raw.length; offset++) {
      if (/\s/.test(raw[offset])) {
        if (normalized.endsWith(' ')) continue;
        normalized += ' ';
      } else normalized += raw[offset];
      map.push(offset);
    }
    const start = normalized.indexOf(target);
    if (start < 0) return null;
    const end = start + target.length;
    const locate = offset => {
      const entry = nodes.findLast(item => item.start <= offset) || nodes[0];
      return { node: entry.node, offset: Math.max(0, Math.min((entry.node.nodeValue || '').length, offset - entry.start)) };
    };
    const range = doc.createRange();
    const startPoint = locate(map[start]);
    const endPoint = locate(map[end - 1] + 1);
    range.setStart(startPoint.node, startPoint.offset);
    range.setEnd(endPoint.node, endPoint.offset);
    return range;
  };
  const drawBookmarkHighlight = rects => {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('fill', '#FFF86E');
    group.setAttribute('opacity', '1');
    group.style.mixBlendMode = 'multiply';
    for (const rect of rects || []) {
      if (!rect.width || !rect.height) continue;
      const element = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      element.setAttribute('x', String(rect.left));
      element.setAttribute('y', String(rect.top));
      element.setAttribute('width', String(rect.width));
      element.setAttribute('height', String(rect.height));
      group.append(element);
    }
    return group;
  };
  const bookmarkOverlayer = doc => (state.view?.renderer?.getContents?.() || []).find(item => item.doc === doc)?.overlayer;
  const applyBookmarkHighlights = (doc, index, overlayer = bookmarkOverlayer(doc)) => {
    let cfiMatches = 0;
    let excerptMatches = 0;
    let overlayAdds = 0;
    let overlayErrors = 0;
    for (const key of state.bookmarkHighlightKeys) overlayer?.remove?.(key);
    state.bookmarkHighlightKeys.clear();
    const ranges = [];
    for (const bookmark of state.config?.bookmarks || []) {
      if (Number.isInteger(bookmark.sectionIndex) && bookmark.sectionIndex !== index) continue;
      let range = null;
      const cfi = bookmark.locator?.href;
      if (cfi && typeof state.view?.resolveCFI === 'function') {
        try {
          const resolved = state.view.resolveCFI(cfi);
          if (resolved?.index === index && typeof resolved.anchor === 'function') {
            range = resolved.anchor(doc);
            if (range?.collapsed || !range?.toString?.().trim()) range = null;
            else cfiMatches++;
          }
        } catch {}
      }
      if (!range) {
        const excerpt = bookmark.excerpt || bookmark.locator?.text?.highlight || '';
        range = bookmarkRange(doc, excerpt);
        if (range) excerptMatches++;
      }
      if (range && overlayer?.add) {
        const key = 'mowen-bookmark:' + (bookmark.id || cfi || bookmark.excerpt);
        try {
          overlayer.add(key, range, drawBookmarkHighlight);
          state.bookmarkHighlightKeys.add(key);
          overlayAdds++;
        } catch { overlayErrors++; }
      } else if (range) ranges.push(range);
    }
    // Keep a CSS Highlight fallback for renderers without Foliate's overlay.
    const css = doc.defaultView?.CSS;
    if (!overlayer?.add && css?.highlights && typeof doc.defaultView?.Highlight === 'function') {
      css.highlights.delete('mowen-bookmark');
      if (ranges.length) css.highlights.set('mowen-bookmark', new doc.defaultView.Highlight(...ranges));
    }
    debug('apply index=' + index + ' bookmarks=' + (state.config?.bookmarks?.length || 0)
      + ' overlayer=' + (!!overlayer?.add) + ' cfi=' + cfiMatches + ' excerpt=' + excerptMatches
      + ' added=' + overlayAdds + ' errors=' + overlayErrors);
  };
  const attachDocumentGestures = ({ doc, index }) => {
    applyBookmarkHighlights(doc, index, bookmarkOverlayer(doc));
    let touch = null;
    let longPressTimer = 0;
    let suppressClickUntil = 0;
    let selectionTimer = 0;
    let bookmarkShortcut = false;
    let bookmarkSelectionTouch = null;
    let bookmarkSelectionTimer = 0;
    const interactive = target => target?.closest?.('a[href],button,input,textarea,select,label');
    const longPressBlocked = target => target?.closest?.('button,input,textarea,select,label');
    const screenWidth = () => Math.max(1, doc.defaultView?.screen?.width || globalThis.screen?.width || state.view?.renderer?.size || 1);
    const touchCoordinates = point => ({
      x: Number.isFinite(point?.clientX) ? point.clientX : point?.screenX,
      y: Number.isFinite(point?.clientY) ? point.clientY : point?.screenY,
    });
    const clearLongPress = () => {
      if (longPressTimer) doc.defaultView?.clearTimeout(longPressTimer);
      longPressTimer = 0;
    };
    const setBookmarkSelecting = active => {
      state.bookmarkSelecting = !!active;
      touch = null;
      clearLongPress();
      if (bookmarkSelectionTimer) doc.defaultView?.clearTimeout(bookmarkSelectionTimer);
      bookmarkSelectionTimer = 0;
      bookmarkSelectionTouch = null;
      pager.cancel();
      if (!active) {
        doc.getSelection?.()?.removeAllRanges?.();
        state.bookmarkSelectionModel = null;
        state.bookmarkHeldHandle = null;
        state.bookmarkOuterPageGesture = null;
        state.bookmarkHandleController?.hide?.();
      }
      send({ type: 'bookmark-selection-mode', active: state.bookmarkSelecting });
    };
    const visibleTextEdge = (visible, direction) => {
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      let lastPoint = null;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const value = node.nodeValue || '';
        if (!value) continue;
        const probe = doc.createRange();
        probe.selectNodeContents(node);
        if (
          probe.compareBoundaryPoints(Range.START_TO_END, visible) <= 0
          || probe.compareBoundaryPoints(Range.END_TO_START, visible) >= 0
        ) continue;
        const from = node === visible.startContainer ? visible.startOffset : 0;
        const to = node === visible.endContainer ? visible.endOffset : value.length;
        const slice = value.slice(from, to);
        if (direction > 0) {
          const match = slice.match(/\S/u);
          if (match) return { node, offset: from + (match.index || 0) + match[0].length };
        } else {
          for (const match of slice.matchAll(/\S/gu)) lastPoint = { node, offset: from + (match.index || 0) };
        }
      }
      return lastPoint;
    };
    const caretPointAt = (visible, clientX, clientY, direction, allowOutsideVisible = false) => {
      try {
        const caret = doc.caretPositionFromPoint?.(clientX, clientY);
        const fallbackRange = !caret ? doc.caretRangeFromPoint?.(clientX, clientY) : null;
        const node = caret?.offsetNode || fallbackRange?.startContainer;
        const offset = caret?.offset ?? fallbackRange?.startOffset;
        if ((node?.nodeType === 3 || node?.nodeType === 4) && Number.isInteger(offset)) {
          const point = doc.createRange();
          point.setStart(node, offset);
          point.collapse(true);
          if (allowOutsideVisible || (
            point.compareBoundaryPoints(Range.START_TO_START, visible) >= 0
            && point.compareBoundaryPoints(Range.END_TO_END, visible) <= 0
          )) return { node, offset };
        }
      } catch {}
      return visibleTextEdge(visible, direction);
    };
    const selectionHandlePoints = range => {
      const rects = Array.from(range.getClientRects?.() || []).filter(rect => rect.width > 0 && rect.height > 0);
      if (!rects.length) return null;
      const first = rects[0];
      const last = rects[rects.length - 1];
      return {
        start: { clientX: first.left, clientY: first.bottom },
        end: { clientX: last.right, clientY: last.bottom },
      };
    };
    const bookmarkModelRange = model => {
      if (!model || model.doc !== doc || !model.fixedNode?.isConnected || !model.movingNode?.isConnected) return null;
      try {
        const moving = doc.createRange();
        moving.setStart(model.movingNode, model.movingOffset);
        moving.collapse(true);
        const fixed = doc.createRange();
        fixed.setStart(model.fixedNode, model.fixedOffset);
        fixed.collapse(true);
        const movingFirst = moving.compareBoundaryPoints(Range.START_TO_START, fixed) <= 0;
        const range = doc.createRange();
        if (movingFirst) {
          range.setStart(model.movingNode, model.movingOffset);
          range.setEnd(model.fixedNode, model.fixedOffset);
        } else {
          range.setStart(model.fixedNode, model.fixedOffset);
          range.setEnd(model.movingNode, model.movingOffset);
        }
        model.movingStart = movingFirst;
        return range;
      } catch { return null; }
    };
    const selectionMatchesBookmarkModel = selection => {
      const model = state.bookmarkSelectionModel;
      if (!model || model.doc !== doc || !selection?.rangeCount) return false;
      return selection.anchorNode === model.fixedNode
        && selection.anchorOffset === model.fixedOffset
        && selection.focusNode === model.movingNode
        && selection.focusOffset === model.movingOffset;
    };
    const applyBookmarkSelectionModel = () => {
      const model = state.bookmarkSelectionModel;
      const range = bookmarkModelRange(model);
      const selection = doc.getSelection?.();
      if (!range || !selection) return false;
      try {
        if (selection.setBaseAndExtent)
          selection.setBaseAndExtent(model.fixedNode, model.fixedOffset, model.movingNode, model.movingOffset);
        else {
          selection.removeAllRanges();
          selection.addRange(range);
        }
        return true;
      } catch { return false; }
    };
    const rendererPageOffset = renderer => {
      const inlineSign = renderer.getAttribute?.('dir') === 'rtl' ? -1 : 1;
      const start = Number(renderer.start);
      // In scrolled flow the document coordinates already start at the
      // beginning of the section. Only paginated flow has the extra leading
      // column, so applying the page offset there would shift vertical
      // selection handles by one viewport.
      if (renderer.scrolled) return Number.isFinite(start) ? start : 0;
      if (Number.isFinite(start)) return start - renderer.size * inlineSign;
      return Math.max(0, Number(renderer.page || 1) - 1) * renderer.size * inlineSign;
    };
    const contentPointFromViewport = (clientX, clientY) => {
      const renderer = state.view?.renderer;
      const rect = renderer?.getBoundingClientRect?.();
      if (!renderer || !rect || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
      if (renderer.scrollProp === 'scrollLeft')
        return { clientX: clientX - rect.left + rendererPageOffset(renderer), clientY: clientY - rect.top };
      return { clientX: clientX - rect.left, clientY: clientY - rect.top + rendererPageOffset(renderer) };
    };
    const heldHandleContentPoint = held => {
      if (!held) return null;
      const clientX = held.clientX + (held.caretOffsetX || 0);
      const clientY = held.clientY + (held.caretOffsetY || 0);
      return held.source === 'custom'
        ? contentPointFromViewport(clientX, clientY)
        : { clientX, clientY };
    };
    const viewportPointFromContent = point => {
      const renderer = state.view?.renderer;
      const rect = renderer?.getBoundingClientRect?.();
      if (!renderer || !rect || !point) return null;
      if (renderer.scrollProp === 'scrollLeft')
        return { clientX: rect.left + point.clientX - rendererPageOffset(renderer), clientY: rect.top + point.clientY, rect };
      return { clientX: rect.left + point.clientX, clientY: rect.top + point.clientY - rendererPageOffset(renderer), rect };
    };
    const rememberBookmarkPageTouch = (gesture, point, fromInnerDocument) => {
      if (!gesture || !point) return;
      const viewport = fromInnerDocument
        ? viewportPointFromContent({ clientX: point.clientX, clientY: point.clientY })
        : point;
      if (!viewport) return;
      gesture.pageClientX = viewport.clientX;
      gesture.pageClientY = viewport.clientY;
    };
    const hideBookmarkHandle = () => {
      for (const handle of document.querySelectorAll('.bookmark-selection-handle'))
        handle.classList.remove('visible');
    };
    const placeBookmarkHandle = (handle, point, followsPage) => {
      const viewport = viewportPointFromContent(point);
      const renderer = state.view?.renderer;
      const held = state.bookmarkHeldHandle?.source === 'custom'
        && state.bookmarkHeldHandle.endpoint === handle?.dataset?.endpoint
        ? state.bookmarkHeldHandle
        : null;
      // renderer.getBoundingClientRect() already contains the current page
      // surface transform. Unheld handles therefore need no extra offset;
      // a held handle stays under its finger while the other finger moves the
      // page, so use its live touch position instead of the content rect.
      const dragOffset = followsPage ? 0 : -state.bookmarkPageDragOffset;
      const clientX = held
        ? held.clientX + (held.caretOffsetX || 0)
        : viewport?.clientX + (renderer?.scrollProp === 'scrollLeft' ? dragOffset : 0);
      const clientY = held
        ? held.clientY + (held.caretOffsetY || 0)
        : viewport?.clientY + (renderer?.scrollProp === 'scrollLeft' ? 0 : dragOffset);
      if (
        !viewport
        || clientX < viewport.rect.left - 12
        || clientX > viewport.rect.right + 12
        || clientY < viewport.rect.top - 12
        || clientY > viewport.rect.bottom + 12
      ) {
        handle?.classList.remove('visible');
        return false;
      }
      handle.style.transform = 'translate3d(' + (clientX - 22) + 'px,' + (clientY - 8) + 'px,0)';
      handle.classList.add('visible');
      return true;
    };
    const renderBookmarkHandle = () => {
      const model = state.bookmarkSelectionModel;
      const range = bookmarkModelRange(model);
      const startHandle = document.getElementById('bookmark-selection-handle-start');
      const endHandle = document.getElementById('bookmark-selection-handle-end');
      if (!state.bookmarkSelecting || !model?.managed || !range || !startHandle || !endHandle) {
        hideBookmarkHandle();
        return false;
      }
      const points = selectionHandlePoints(range);
      if (!points) { hideBookmarkHandle(); return false; }
      const heldEndpoint = state.bookmarkHeldHandle?.endpoint;
      const startVisible = placeBookmarkHandle(startHandle, points.start, heldEndpoint !== 'start');
      const endVisible = placeBookmarkHandle(endHandle, points.end, heldEndpoint !== 'end');
      return startVisible || endVisible;
    };
    const moveBookmarkSelectionTo = point => {
      const model = state.bookmarkSelectionModel;
      if (!model || model.doc !== doc || !point?.node?.isConnected) return false;
      model.movingNode = point.node;
      model.movingOffset = point.offset;
      if (!applyBookmarkSelectionModel()) return false;
      renderBookmarkHandle();
      return true;
    };
    const beginCustomBookmarkSelection = initialTouch => {
      const visible = state.visibleRange;
      const point = visible ? caretPointAt(visible, initialTouch.clientX, initialTouch.clientY, 1) : null;
      const value = point?.node?.nodeValue || '';
      if (!point || !value) return false;
      let start = Math.max(0, Math.min(value.length - 1, point.offset === value.length ? point.offset - 1 : point.offset));
      let end = Math.min(value.length, start + 1);
      try {
        const Segmenter = doc.defaultView?.Intl?.Segmenter;
        if (Segmenter) {
          const segments = new Segmenter(doc.documentElement.lang || 'zh', { granularity: 'word' }).segment(value);
          for (const segment of segments) {
            const from = segment.index;
            const to = from + segment.segment.length;
            if (start >= from && start < to && /\S/u.test(segment.segment)) {
              start = from;
              end = to;
              break;
            }
          }
        }
      } catch {}
      const fixedRange = doc.createRange();
      fixedRange.setStart(point.node, start);
      fixedRange.setEnd(point.node, end);
      const points = selectionHandlePoints(fixedRange);
      state.bookmarkSelectionModel = {
        doc,
        index,
        fixedNode: point.node,
        fixedOffset: start,
        movingNode: point.node,
        movingOffset: end,
        movingStart: false,
        managed: true,
      };
      applyBookmarkSelectionModel();
      renderBookmarkHandle();
      const endPoint = points?.end;
      state.bookmarkHeldHandle = {
        id: initialTouch.id,
        source: 'native',
        endpoint: 'end',
        clientX: initialTouch.clientX,
        clientY: initialTouch.clientY,
        caretOffsetX: endPoint ? endPoint.clientX - initialTouch.clientX : 0,
        caretOffsetY: endPoint ? endPoint.clientY - initialTouch.clientY : 0,
      };
      globalThis.navigator?.vibrate?.(20);
      return true;
    };
    const prepareBookmarkSelectionRestore = (direction, reportedHandlePoint, scrolledStartOverride, reportedPageViewportPoint) => {
      if (!state.bookmarkSelecting || state.bookmarkPageTurning) return null;
      const model = state.bookmarkSelectionModel?.doc === doc ? state.bookmarkSelectionModel : null;
      const selection = doc.getSelection?.();
      if (!model && (!selection?.rangeCount || selection.getRangeAt(0).collapsed)) return null;
      const renderer = state.view?.renderer;
      if (!renderer) return null;
      if (renderer.scrolled) {
        const atBoundary = direction < 0
          ? renderer.start <= 2
          : renderer.viewSize - renderer.end <= 2;
        if (atBoundary) return null;
      } else if (direction < 0 ? renderer.page <= 1 : renderer.page >= renderer.pages - 2) return null;
      const selectedRange = model ? bookmarkModelRange(model) : selection.getRangeAt(0).cloneRange();
      if (!selectedRange || selectedRange.collapsed) return null;
      const handles = selectionHandlePoints(selectedRange);
      const horizontal = renderer.scrollProp === 'scrollLeft';
      // In scrolled flow the second finger's viewport position is the target
      // for the moving endpoint. Paginated flow keeps the held-handle point
      // for its page-local coordinate system.
      const validReportedViewportPoint = renderer.scrolled
        && Number.isFinite(reportedPageViewportPoint?.clientX) && Number.isFinite(reportedPageViewportPoint?.clientY)
        ? reportedPageViewportPoint
        : null;
      const validReportedPoint = !renderer.scrolled
        && Number.isFinite(reportedHandlePoint?.clientX) && Number.isFinite(reportedHandlePoint?.clientY)
        ? reportedHandlePoint
        : validReportedViewportPoint
          ? contentPointFromViewport(validReportedViewportPoint)
          : null;
      const movingStart = model ? model.movingStart : validReportedPoint && handles
        ? Math.hypot(validReportedPoint.clientX - handles.start.clientX, validReportedPoint.clientY - handles.start.clientY)
          <= Math.hypot(validReportedPoint.clientX - handles.end.clientX, validReportedPoint.clientY - handles.end.clientY)
        : direction < 0;
      const handlePoint = validReportedPoint || (movingStart ? handles?.start : handles?.end);
      if (!handlePoint) return null;
      const stationaryNode = model?.fixedNode || (movingStart ? selectedRange.endContainer : selectedRange.startContainer);
      const stationaryOffset = model?.fixedOffset ?? (movingStart ? selectedRange.endOffset : selectedRange.startOffset);
      if (!stationaryNode || stationaryNode.ownerDocument !== doc) return null;
      const inlineSign = renderer.getAttribute?.('dir') === 'rtl' ? -1 : 1;
      const startBeforeTurn = Number.isFinite(scrolledStartOverride)
        ? scrolledStartOverride
        : Number(renderer.start);
      const pageDelta = direction * renderer.size * inlineSign;
      const targetHandlePoint = {
        clientX: handlePoint.clientX + (horizontal ? pageDelta : 0),
        clientY: handlePoint.clientY + (horizontal ? 0 : pageDelta),
      };
      const targetIsCurrentViewportPoint = !!validReportedViewportPoint;
      return async visible => {
        if (!renderer.scrolled)
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (!visible || visible.startContainer?.ownerDocument !== doc || !stationaryNode.isConnected) return;
        const actualDelta = renderer.scrolled && Number.isFinite(startBeforeTurn) && Number.isFinite(Number(renderer.start))
          ? Number(renderer.start) - startBeforeTurn
          : 0;
        const currentViewportPoint = targetIsCurrentViewportPoint
          ? contentPointFromViewport(reportedPageViewportPoint)
          : null;
        const point = caretPointAt(
          visible,
          currentViewportPoint
            ? currentViewportPoint.clientX
            : renderer.scrolled && horizontal
              ? handlePoint.clientX + actualDelta * inlineSign
              : targetHandlePoint.clientX,
          currentViewportPoint
            ? currentViewportPoint.clientY
            : renderer.scrolled && !horizontal
              ? handlePoint.clientY + actualDelta
              : targetHandlePoint.clientY,
          direction,
          renderer.scrolled && targetIsCurrentViewportPoint,
        );
        if (!point) return;
        state.bookmarkSelectionModel = {
          doc,
          index,
          fixedNode: stationaryNode,
          fixedOffset: stationaryOffset,
          movingNode: point.node,
          movingOffset: point.offset,
          movingStart,
          managed: true,
        };
        applyBookmarkSelectionModel();
        renderBookmarkHandle();
        // Android ends its native handle session when the paginator scrolls.
        // Re-assert the logical range after that stale native touch sequence
        // settles; from this point the in-reader handle owns further edits.
        if (!renderer.scrolled) {
          doc.defaultView?.setTimeout(() => {
            if (state.bookmarkSelectionModel?.doc !== doc || state.bookmarkPageTurning) return;
            if (!selectionMatchesBookmarkModel(doc.getSelection?.())) applyBookmarkSelectionModel();
            renderBookmarkHandle();
          }, 120);
        }
        doc.defaultView?.focus?.();
        globalThis.navigator?.vibrate?.(12);
      };
    };
    const queueBookmarkSelectionRestore = (direction, handlePoint, scrolledStartOverride, pageViewportPoint) => {
      const run = prepareBookmarkSelectionRestore(direction, handlePoint, scrolledStartOverride, pageViewportPoint);
      if (!run) return false;
      const restore = { run, timeout: 0 };
      restore.timeout = globalThis.setTimeout(() => {
        if (state.bookmarkSelectionRestore !== restore) return;
        state.bookmarkSelectionRestore = null;
        state.bookmarkPageTurning = false;
        resetSurfaces();
      }, 1600);
      state.bookmarkSelectionRestore = restore;
      state.bookmarkPageTurning = true;
      const renderer = state.view?.renderer;
      if (renderer?.scrolled) {
        state.bookmarkSelectionRestore = null;
        Promise.resolve(restore.run(state.visibleRange)).finally(() => {
          state.bookmarkPageTurning = false;
          state.bookmarkHandleController?.render?.();
        });
      }
      return true;
    };
    const scrollBookmarkPage = direction => {
      const renderer = state.view?.renderer;
      if (!renderer?.scrolled) return false;
      const delta = direction * renderer.size;
      // Use Foliate's public navigation methods instead of Paginator.scrollBy.
      // scrollBy clamps against a private bounds snapshot which can be stale
      // after continuous layout/section changes.
      const navigate = delta >= 0 ? renderer.next?.(delta) : renderer.prev?.(-delta);
      Promise.resolve(navigate).catch(() => {});
      return true;
    };
    const turnBookmarkSelectionPage = (direction, handlePoint) => {
      // Selection restoration is best effort. It must not veto the page turn:
      // when Android has already dropped the native selection range, the
      // previous behavior made both vertical and horizontal swipes snap back.
      queueBookmarkSelectionRestore(direction, handlePoint);
      if (state.view?.renderer?.scrolled) return scrollBookmarkPage(direction);
      if (pager.turn(direction)) return true;
      if (state.bookmarkSelectionRestore?.timeout) globalThis.clearTimeout(state.bookmarkSelectionRestore.timeout);
      state.bookmarkSelectionRestore = null;
      state.bookmarkPageTurning = false;
      return false;
    };
    const beginBookmarkPageGesture = (x, y, time) => {
      if (state.config?.prefs.readingMode === 'paged') {
        return { kind: 'paged', active: pager.begin(x, y, time) };
      }
      if (state.config?.prefs.readingMode !== 'scroll') return null;
      const renderer = state.view?.renderer;
      const gesture = {
        kind: 'scroll',
        startX: x,
        startY: y,
        lastX: x,
        lastY: y,
        lastTime: time,
        scrollStart: Number(state.view?.renderer?.start),
        deltaY: 0,
        velocityY: 0,
        pendingScroll: 0,
        scrollApplying: false,
        scrollCancelled: false,
      };
      return gesture;
    };
    const queueBookmarkGestureScroll = (gesture, renderer, delta) => {
      if (!renderer?.scrolled || !Number.isFinite(delta) || Math.abs(delta) < .01) return;
      gesture.pendingScroll += delta;
      if (gesture.scrollApplying) return;
      gesture.scrollApplying = true;
      const drain = async () => {
        try {
          while (!gesture.scrollCancelled && Math.abs(gesture.pendingScroll) >= .01) {
            const amount = gesture.pendingScroll;
            gesture.pendingScroll = 0;
            const activeRenderer = state.view?.renderer || renderer;
            const navigate = amount > 0
              ? activeRenderer.next?.(amount)
              : activeRenderer.prev?.(-amount);
            // Foliate returns undefined while its page/section transition lock
            // is held. Keep the distance and retry on the next frame so a
            // fast second-finger drag cannot silently lose movement.
            if (navigate === undefined) {
              gesture.pendingScroll += amount;
              await new Promise(resolve => doc.defaultView?.requestAnimationFrame(resolve));
              continue;
            }
            await Promise.resolve(navigate);
          }
        } catch {} finally {
          gesture.scrollApplying = false;
        }
      };
      gesture.scrollQueue = drain();
    };
    const moveBookmarkPageGesture = (gesture, x, y, time) => {
      if (!gesture) return false;
      if (gesture.kind === 'paged') return gesture.active && pager.move(x, y, time);
      const renderer = state.view?.renderer;
      const horizontal = renderer?.scrollProp === 'scrollLeft';
      const deltaX = x - gesture.lastX;
      const deltaY = y - gesture.lastY;
      const dt = Math.max(1, time - gesture.lastTime);
      const delta = horizontal ? deltaX : deltaY;
      const instantVelocity = delta / dt;
      gesture.velocityY = gesture.velocityY * .72 + instantVelocity * .28;
      gesture.lastX = x;
      gesture.lastY = y;
      gesture.deltaY = horizontal ? x - gesture.startX : y - gesture.startY;
      // The held selection handle has touch-action:none. Letting the browser
      // perform native scrolling would therefore cancel the whole two-finger
      // gesture on Android. Move Foliate's scrolled renderer through its
      // public navigation API, which refreshes its internal scroll bounds.
      if (renderer?.scrolled) {
        const scrollDelta = horizontal ? -deltaX : -deltaY;
        queueBookmarkGestureScroll(gesture, renderer, scrollDelta);
        if (Math.abs(delta) >= 1) {
          // next/prev(distance) handles the section boundary itself. Do not
          // start the independent boundary turner for this same gesture.
          state.scrollIntentDir = 0;
          state.scrollIntentUntil = 0;
        }
        state.bookmarkHandleController?.render?.();
      }
      gesture.lastTime = time;
      return true;
    };
    const endBookmarkPageGesture = (gesture, handlePoint, adjustsSelection = true) => {
      if (!gesture) return { moved: false, committed: false };
      if (gesture.kind === 'paged') {
        return gesture.active
          ? pager.end(adjustsSelection ? direction => {
            queueBookmarkSelectionRestore(direction, handlePoint);
            return true;
          } : undefined)
          : { moved: false, committed: false };
      }
      const renderer = state.view?.renderer;
      const size = Number(renderer?.size) || 1;
      const moved = Math.abs(gesture.deltaY) >= 4;
      const projectedDelta = gesture.deltaY + gesture.velocityY * 180;
      const direction = projectedDelta < 0 ? 1 : -1;
      const distanceTowardTarget = direction > 0 ? -gesture.deltaY : gesture.deltaY;
      const velocityTowardTarget = direction > 0 ? -gesture.velocityY : gesture.velocityY;
      const committed = moved
        && (distanceTowardTarget >= size * .16 || velocityTowardTarget >= .32)
        && (adjustsSelection
          ? queueBookmarkSelectionRestore(
            direction,
            handlePoint,
            gesture.scrollStart,
            Number.isFinite(gesture.pageClientX) && Number.isFinite(gesture.pageClientY)
              ? { clientX: gesture.pageClientX, clientY: gesture.pageClientY }
              : null,
          )
          : true);
      return { moved, committed, dir: direction };
    };
    const cancelBookmarkPageGesture = gesture => {
      if (!gesture) return;
      gesture.scrollCancelled = true;
      if (gesture.kind === 'paged' && gesture.active) pager.cancel();
    };
    state.bookmarkSelectionPageTurn = turnBookmarkSelectionPage;
    const chooseBookmarkMovingEndpoint = endpoint => {
      const model = state.bookmarkSelectionModel;
      if (!model || model.doc !== doc) return false;
      bookmarkModelRange(model);
      const wantsStart = endpoint === 'start';
      if (model.movingStart !== wantsStart) {
        const fixedNode = model.fixedNode;
        const fixedOffset = model.fixedOffset;
        model.fixedNode = model.movingNode;
        model.fixedOffset = model.movingOffset;
        model.movingNode = fixedNode;
        model.movingOffset = fixedOffset;
        bookmarkModelRange(model);
        applyBookmarkSelectionModel();
      }
      return true;
    };
    state.bookmarkHandleController = {
      render: renderBookmarkHandle,
      hide: hideBookmarkHandle,
      start: event => {
        if (!state.bookmarkSelecting) return;
        const changed = Array.from(event.changedTouches || []);
        const held = state.bookmarkHeldHandle;
        if (held?.source === 'custom') {
          const pageTouch = changed.find(point => point.identifier !== held.id);
          if (!pageTouch || state.bookmarkOuterPageGesture) return;
          const { x, y } = touchCoordinates(pageTouch);
          const gesture = beginBookmarkPageGesture(x, y, event.timeStamp);
          const heldPoint = heldHandleContentPoint(held);
          rememberBookmarkPageTouch(gesture, pageTouch, false);
          state.bookmarkOuterPageGesture = {
            id: pageTouch.identifier,
            handleClientX: heldPoint?.clientX,
            handleClientY: heldPoint?.clientY,
            adjustsSelection: !!heldPoint,
            gesture,
          };
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        const model = state.bookmarkSelectionModel;
        if (!model?.managed || model.doc !== doc) return;
        const handle = event.target?.closest?.('.bookmark-selection-handle');
        const point = changed[0];
        if (!handle || !point || !chooseBookmarkMovingEndpoint(handle.dataset.endpoint)) return;
        const handleRect = handle.getBoundingClientRect();
        state.bookmarkHeldHandle = {
          id: point.identifier,
          source: 'custom',
          endpoint: handle.dataset.endpoint,
          clientX: point.clientX,
          clientY: point.clientY,
          caretOffsetX: handleRect.left + 22 - point.clientX,
          caretOffsetY: handleRect.top + 8 - point.clientY,
        };
        event.preventDefault();
        event.stopImmediatePropagation();
        globalThis.navigator?.vibrate?.(8);
      },
      move: event => {
        const held = state.bookmarkHeldHandle;
        const pageGesture = state.bookmarkOuterPageGesture;
        if (pageGesture) {
          const pageTouch = Array.from(event.touches || []).find(point => point.identifier === pageGesture.id);
          if (pageTouch && pageGesture.gesture) {
            const { x, y } = touchCoordinates(pageTouch);
            rememberBookmarkPageTouch(pageGesture.gesture, pageTouch, false);
            moveBookmarkPageGesture(pageGesture.gesture, x, y, event.timeStamp);
          }
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (held?.source !== 'custom') return;
        const touchPoint = Array.from(event.touches || []).find(point => point.identifier === held.id);
        if (!touchPoint) return;
        held.clientX = touchPoint.clientX;
        held.clientY = touchPoint.clientY;
        const contentPoint = heldHandleContentPoint(held);
        const visible = state.visibleRange;
        const model = state.bookmarkSelectionModel;
        if (contentPoint && visible && model?.doc === doc) {
          const point = caretPointAt(visible, contentPoint.clientX, contentPoint.clientY, model.movingStart ? -1 : 1);
          if (point) moveBookmarkSelectionTo(point);
        }
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      end: event => {
        const held = state.bookmarkHeldHandle;
        const changed = Array.from(event.changedTouches || []);
        const pageGesture = state.bookmarkOuterPageGesture;
        if (pageGesture && changed.some(point => point.identifier === pageGesture.id)) {
          const pageTouch = changed.find(point => point.identifier === pageGesture.id);
          if (pageTouch && pageGesture.gesture) {
            const { x, y } = touchCoordinates(pageTouch);
            rememberBookmarkPageTouch(pageGesture.gesture, pageTouch, false);
            moveBookmarkPageGesture(pageGesture.gesture, x, y, event.timeStamp);
          }
          state.bookmarkOuterPageGesture = null;
          if (pageGesture.gesture) endBookmarkPageGesture(pageGesture.gesture, heldHandleContentPoint(held));
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (held?.source !== 'custom') return;
        if (!changed.some(point => point.identifier === held.id)) return;
        if (state.bookmarkOuterPageGesture) cancelBookmarkPageGesture(state.bookmarkOuterPageGesture.gesture);
        state.bookmarkOuterPageGesture = null;
        state.bookmarkHeldHandle = null;
        event.preventDefault();
        event.stopImmediatePropagation();
        renderBookmarkHandle();
      },
      cancel: event => {
        const held = state.bookmarkHeldHandle;
        if (state.bookmarkOuterPageGesture) {
          cancelBookmarkPageGesture(state.bookmarkOuterPageGesture.gesture);
          state.bookmarkOuterPageGesture = null;
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (held?.source !== 'custom') return;
        state.bookmarkHeldHandle = null;
        event.preventDefault();
        event.stopImmediatePropagation();
        renderBookmarkHandle();
      },
    };
    const readableBlock = target => target?.closest?.('p,li,blockquote,h1,h2,h3,h4,h5,h6,dd,dt,figcaption');
    const visibleSelectionRange = range => {
      const visible = state.visibleRange;
      const RangeType = doc.defaultView?.Range;
      if (!visible || !RangeType || visible.startContainer?.ownerDocument !== doc) return range;
      try {
        if (
          range.compareBoundaryPoints(RangeType.START_TO_END, visible) <= 0
          || range.compareBoundaryPoints(RangeType.END_TO_START, visible) >= 0
        ) return range;
        const clipped = doc.createRange();
        if (range.compareBoundaryPoints(RangeType.START_TO_START, visible) < 0)
          clipped.setStart(visible.startContainer, visible.startOffset);
        else clipped.setStart(range.startContainer, range.startOffset);
        if (range.compareBoundaryPoints(RangeType.END_TO_END, visible) > 0)
          clipped.setEnd(visible.endContainer, visible.endOffset);
        else clipped.setEnd(range.endContainer, range.endOffset);
        return clipped.collapsed ? range : clipped;
      } catch {
        return range;
      }
    };
    const blobDataURL = blob => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(reader.error || new Error('无法读取图片'));
      reader.readAsDataURL(blob);
    });
    const imageDataOf = async image => {
      const src = image?.currentSrc || image?.src || '';
      if (src.startsWith('data:image/')) return src;
      if (src) {
        try {
          const response = await fetch(src);
          const blob = await response.blob();
          if (blob.type.startsWith('image/')) return await blobDataURL(blob);
        } catch {}
      }
      // Some Android WebView versions cannot fetch a blob URL from a nested
      // EPUB document even though the image is already decoded on screen.
      try {
        await image?.decode?.();
        const width = image?.naturalWidth || image?.width;
        const height = image?.naturalHeight || image?.height;
        if (!width || !height) return '';
        const canvas = doc.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d')?.drawImage(image, 0, 0, width, height);
        return canvas.toDataURL('image/png');
      } catch { return ''; }
    };
    const emitLongPress = async target => {
      // Foliate treats any selection created between pointerdown and pointerup
      // as an actively dragged selection and turns the page when it crosses the
      // visible range. This selection is created by our long-press action, so
      // end that pointer-selection state before setting the programmatic range.
      try {
        const EventType = doc.defaultView?.Event;
        if (EventType) doc.dispatchEvent(new EventType('pointerup'));
      } catch {}
      const image = target?.closest?.('img');
      if (image) {
        const range = doc.createRange();
        range.selectNode(image);
        const selection = doc.getSelection?.();
        selection?.removeAllRanges?.();
        selection?.addRange?.(range);
        let cfi = '';
        try { cfi = state.view?.getCFI?.(index, range) || ''; } catch {}
        const figure = image.closest?.('figure');
        const text = (image.getAttribute('alt') || figure?.querySelector?.('figcaption')?.textContent || '插图').replace(/\s+/g, ' ').trim();
        const imageData = await imageDataOf(image);
        if (!imageData) {
          send({ type: 'long-press', cfi, sectionIndex: index, text, kind: 'image' });
          return true;
        }
        const transferId = 'image-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        // Open the AI panel immediately, then transfer the potentially large
        // data URL in small bridge messages so Android does not drop it.
        send({ type: 'long-press', cfi, sectionIndex: index, text, kind: 'image', imageTransferId: transferId });
        send({ type: 'image-transfer-start', transferId });
        const chunkSize = 128 * 1024;
        for (let offset = 0; offset < imageData.length; offset += chunkSize) {
          send({ type: 'image-transfer-chunk', transferId, chunk: imageData.slice(offset, offset + chunkSize) });
          await new Promise(resolve => doc.defaultView?.setTimeout(resolve, 0));
        }
        send({ type: 'image-transfer-end', transferId });
        return true;
      }
      const block = readableBlock(target);
      if (!block) return false;
      const selection = doc.getSelection?.();
      const range = doc.createRange();
      range.selectNodeContents(block);
      const text = block.textContent?.replace(/\s+/g, ' ').trim() || '';
      if (!text) return false;
      const selectedRange = visibleSelectionRange(range);
      selection?.removeAllRanges?.();
      selection?.addRange?.(selectedRange);
      let cfi = '';
      try { cfi = state.view?.getCFI?.(index, selectedRange) || ''; } catch {}
      send({ type: 'long-press', cfi, sectionIndex: index, text: text.slice(0, 1600), kind: 'text' });
      return true;
    };
    const handleTap = screenX => {
      if (state.config?.prefs.readingMode === 'scroll') { send({ type: 'center-tap' }); return; }
      const ratio = screenX / screenWidth();
      const action = ratio < .3 ? 'previous' : ratio > .7 ? 'next' : 'menu';
      if (action === 'previous') pager.turn(-1);
      else if (action === 'next') pager.turn(1);
      else send({ type: 'center-tap' });
    };
    doc.addEventListener('touchstart', event => {
      if (!state.bookmarkSelecting && event.touches.length === 2) {
        bookmarkShortcut = true;
        event.preventDefault();
        event.stopImmediatePropagation();
        globalThis.navigator?.vibrate?.(20);
        setBookmarkSelecting(true);
        return;
      }
      if (state.bookmarkSelecting) {
        // Android may drop the native DOM range as soon as the second finger
        // lands. The held custom/native handle is the reliable signal that
        // this touch is the page gesture, so do not require activeRange here.
        const heldHandle = state.bookmarkHeldHandle;
        const pageTouch = event.changedTouches[event.changedTouches.length - 1];
        if (heldHandle && pageTouch && pageTouch.identifier !== heldHandle.id && !state.bookmarkOuterPageGesture) {
          const heldPoint = heldHandleContentPoint(heldHandle);
          const { x, y } = touchCoordinates(pageTouch);
          const gesture = beginBookmarkPageGesture(x, y, event.timeStamp);
          rememberBookmarkPageTouch(gesture, pageTouch, true);
          state.bookmarkOuterPageGesture = {
            id: pageTouch.identifier,
            handleClientX: heldPoint?.clientX,
            handleClientY: heldPoint?.clientY,
            adjustsSelection: !!heldPoint,
            gesture,
          };
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (state.bookmarkOuterPageGesture) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        const selection = doc.getSelection?.();
        const selectedRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
        const model = state.bookmarkSelectionModel?.doc === doc ? state.bookmarkSelectionModel : null;
        const activeRange = model ? bookmarkModelRange(model) : selectedRange;
        if (activeRange && !activeRange.collapsed && event.changedTouches.length) {
          const pageTouch = event.changedTouches[event.changedTouches.length - 1];
          const handles = selectionHandlePoints(activeRange);
          const nearestHandle = handles && (
            Math.hypot(pageTouch.clientX - handles.start.clientX, pageTouch.clientY - handles.start.clientY)
              <= Math.hypot(pageTouch.clientX - handles.end.clientX, pageTouch.clientY - handles.end.clientY)
              ? handles.start
              : handles.end
          );
          const nearHandle = nearestHandle
            && Math.hypot(pageTouch.clientX - nearestHandle.clientX, pageTouch.clientY - nearestHandle.clientY) <= 56;
          if (nearHandle && !model?.managed) {
            state.bookmarkHeldHandle = {
              id: pageTouch.identifier,
              source: 'native',
              endpoint: nearestHandle === handles.start ? 'start' : 'end',
              clientX: pageTouch.clientX,
              clientY: pageTouch.clientY,
              caretOffsetX: nearestHandle.clientX - pageTouch.clientX,
              caretOffsetY: nearestHandle.clientY - pageTouch.clientY,
            };
            event.stopImmediatePropagation();
            return;
          }
          let held = state.bookmarkHeldHandle;
          const handleTouch = Array.from(event.touches).find(touchPoint => touchPoint.identifier !== pageTouch.identifier);
          if (!held && handleTouch) {
            const nearest = handles && (
              Math.hypot(handleTouch.clientX - handles.start.clientX, handleTouch.clientY - handles.start.clientY)
                <= Math.hypot(handleTouch.clientX - handles.end.clientX, handleTouch.clientY - handles.end.clientY)
                ? handles.start
                : handles.end
            );
            held = state.bookmarkHeldHandle = {
              id: handleTouch.identifier,
              source: 'native',
              endpoint: nearest === handles?.start ? 'start' : 'end',
              clientX: handleTouch.clientX,
              clientY: handleTouch.clientY,
              caretOffsetX: nearest ? nearest.clientX - handleTouch.clientX : 0,
              caretOffsetY: nearest ? nearest.clientY - handleTouch.clientY : 0,
            };
          }
          if (handleTouch && held?.source === 'native' && handleTouch.identifier === held.id) {
            held.clientX = handleTouch.clientX;
            held.clientY = handleTouch.clientY;
          }
          // A selected range must not disable ordinary vertical scrolling.
          // Only a held selection handle plus another finger owns this path.
          if (state.config?.prefs.readingMode === 'scroll' && !state.bookmarkHeldHandle)
            return;
          const heldPoint = heldHandleContentPoint(held);
          const { x, y } = touchCoordinates(pageTouch);
          const gesture = beginBookmarkPageGesture(x, y, event.timeStamp);
          rememberBookmarkPageTouch(gesture, pageTouch, true);
          state.bookmarkOuterPageGesture = {
            id: pageTouch.identifier,
            handleClientX: heldPoint?.clientX,
            handleClientY: heldPoint?.clientY,
            adjustsSelection: !!heldPoint,
            gesture,
          };
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if ((!activeRange || activeRange.collapsed) && event.touches.length === 1 && event.changedTouches.length) {
          const point = event.changedTouches[0];
          bookmarkSelectionTouch = {
            id: point.identifier,
            clientX: point.clientX,
            clientY: point.clientY,
            startX: point.clientX,
            startY: point.clientY,
          };
          if (bookmarkSelectionTimer) doc.defaultView?.clearTimeout(bookmarkSelectionTimer);
          bookmarkSelectionTimer = doc.defaultView?.setTimeout(() => {
            bookmarkSelectionTimer = 0;
            const initialTouch = bookmarkSelectionTouch;
            if (!initialTouch || state.bookmarkSelectionModel) return;
            if (beginCustomBookmarkSelection(initialTouch)) bookmarkSelectionTouch = null;
          }, 460) || 0;
          // With no active selection, continuous mode must keep Foliate's
          // native vertical scrolling alive. The long-press timer still
          // creates a selection when the finger stays still.
          if (state.config?.prefs.readingMode !== 'scroll') {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
          return;
        }
        event.stopImmediatePropagation();
        return;
      }
      if (event.touches.length !== 1) return;
      doc.getSelection?.()?.removeAllRanges?.();
      const point = event.touches[0];
      touch = {
        x: point.clientX,
        y: point.clientY,
        lastScreenY: point.screenY,
        screenX: point.screenX,
        started: Date.now(),
        target: event.target,
        moved: false,
        longPressed: false
      };
      if (state.config?.prefs.readingMode === 'paged') {
        pager.begin(point.screenX, point.screenY, event.timeStamp);
        if (!interactive(event.target)) event.preventDefault();
        event.stopImmediatePropagation();
      } else {
        state.scrollIntentDir = 0;
        state.scrollIntentUntil = 0;
      }
      clearLongPress();
      if (!longPressBlocked(event.target)) {
        longPressTimer = doc.defaultView?.setTimeout(() => {
          if (!touch || touch.moved) return;
          touch.longPressed = true;
          pager.cancel();
          suppressClickUntil = Date.now() + 700;
          globalThis.navigator?.vibrate?.(24);
          void emitLongPress(touch.target);
        }, 520) || 0;
      }
    }, { passive: false, capture: true });
    doc.addEventListener('touchmove', event => {
      if (state.bookmarkOuterPageGesture) {
        const pageGesture = state.bookmarkOuterPageGesture;
        const pageTouch = Array.from(event.touches).find(point => point.identifier === pageGesture.id);
        const handleTouch = Array.from(event.touches).find(point => point.identifier !== pageGesture.id);
        if (pageTouch && pageGesture.gesture) {
          const { x, y } = touchCoordinates(pageTouch);
          rememberBookmarkPageTouch(pageGesture.gesture, pageTouch, true);
          moveBookmarkPageGesture(pageGesture.gesture, x, y, event.timeStamp);
          rememberBookmarkPageTouch(pageGesture.gesture, pageTouch, true);
        }
        if (handleTouch && state.bookmarkHeldHandle?.source !== 'custom') {
          const held = state.bookmarkHeldHandle;
          if (held?.source === 'native' && held.id === handleTouch.identifier) {
            held.clientX = handleTouch.clientX;
            held.clientY = handleTouch.clientY;
          }
          const heldPoint = heldHandleContentPoint(held);
          if (heldPoint) {
            pageGesture.handleClientX = heldPoint.clientX;
            pageGesture.handleClientY = heldPoint.clientY;
          }
        } else if (state.bookmarkHeldHandle?.source === 'custom') {
          const heldPoint = heldHandleContentPoint(state.bookmarkHeldHandle);
          if (heldPoint) {
            pageGesture.handleClientX = heldPoint.clientX;
            pageGesture.handleClientY = heldPoint.clientY;
          }
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (bookmarkShortcut) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      if (bookmarkSelectionTouch) {
        const point = Array.from(event.touches).find(point => point.identifier === bookmarkSelectionTouch.id);
        if (point && Math.hypot(point.clientX - bookmarkSelectionTouch.startX, point.clientY - bookmarkSelectionTouch.startY) > 8) {
          if (bookmarkSelectionTimer) doc.defaultView?.clearTimeout(bookmarkSelectionTimer);
          bookmarkSelectionTimer = 0;
          bookmarkSelectionTouch = null;
        }
        if (state.config?.prefs.readingMode !== 'scroll') {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        return;
      }
      if (state.bookmarkSelecting) {
        const held = state.bookmarkHeldHandle;
        const handleTouch = held?.source === 'native'
          ? Array.from(event.touches).find(point => point.identifier === held.id)
          : null;
        if (handleTouch && state.bookmarkHeldHandle?.source !== 'custom') {
          held.clientX = handleTouch.clientX;
          held.clientY = handleTouch.clientY;
        }
        if (state.config?.prefs.readingMode === 'scroll' && !held) return;
        event.stopImmediatePropagation();
        return;
      }
      if (!touch || event.touches.length !== 1) return;
      const point = event.touches[0];
      const moveThreshold = state.config?.prefs.readingMode === 'paged' ? 4 : 9;
      if (Math.hypot(point.clientX - touch.x, point.clientY - touch.y) > moveThreshold) {
        touch.moved = true;
        clearLongPress();
      }
      if (state.config?.prefs.readingMode === 'paged') {
        const consumed = pager.move(point.screenX, point.screenY, event.timeStamp);
        event.stopImmediatePropagation();
        if (consumed) event.preventDefault();
      } else {
        const deltaY = point.screenY - touch.lastScreenY;
        touch.lastScreenY = point.screenY;
        if (Math.abs(deltaY) >= 1) {
          state.scrollIntentDir = deltaY < 0 ? 1 : -1;
          state.scrollIntentUntil = performance.now() + 1600;
          queueScrolledBoundaryCheck();
        }
      }
    }, { passive: false, capture: true });
    doc.addEventListener('touchend', event => {
      if (state.bookmarkOuterPageGesture && Array.from(event.changedTouches).some(point => point.identifier === state.bookmarkOuterPageGesture.id)) {
        const gesture = state.bookmarkOuterPageGesture;
        const endedTouch = Array.from(event.changedTouches).find(point => point.identifier === gesture.id);
        if (endedTouch && gesture.gesture) {
          const { x, y } = touchCoordinates(endedTouch);
          rememberBookmarkPageTouch(gesture.gesture, endedTouch, true);
          moveBookmarkPageGesture(gesture.gesture, x, y, event.timeStamp);
          rememberBookmarkPageTouch(gesture.gesture, endedTouch, true);
        }
        const handleTouch = Array.from(event.touches).find(point => point.identifier !== gesture.id);
        if (handleTouch && state.bookmarkHeldHandle?.source !== 'custom') {
          const held = state.bookmarkHeldHandle;
          if (held?.source === 'native' && held.id === handleTouch.identifier) {
            held.clientX = handleTouch.clientX;
            held.clientY = handleTouch.clientY;
          }
          const heldPoint = heldHandleContentPoint(held);
          if (heldPoint) {
            gesture.handleClientX = heldPoint.clientX;
            gesture.handleClientY = heldPoint.clientY;
          }
        } else if (state.bookmarkHeldHandle?.source === 'custom') {
          const heldPoint = heldHandleContentPoint(state.bookmarkHeldHandle);
          if (heldPoint) {
            gesture.handleClientX = heldPoint.clientX;
            gesture.handleClientY = heldPoint.clientY;
          }
        }
        state.bookmarkOuterPageGesture = null;
        event.preventDefault();
        event.stopImmediatePropagation();
        const handlePoint = Number.isFinite(gesture.handleClientX) && Number.isFinite(gesture.handleClientY)
          ? { clientX: gesture.handleClientX, clientY: gesture.handleClientY }
          : null;
        if (gesture.gesture)
          endBookmarkPageGesture(gesture.gesture, gesture.adjustsSelection ? handlePoint : null, gesture.adjustsSelection);
        return;
      }
      if (bookmarkSelectionTouch && Array.from(event.changedTouches).some(point => point.identifier === bookmarkSelectionTouch.id)) {
        if (bookmarkSelectionTimer) doc.defaultView?.clearTimeout(bookmarkSelectionTimer);
        bookmarkSelectionTimer = 0;
        bookmarkSelectionTouch = null;
        if (state.config?.prefs.readingMode !== 'scroll') {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        return;
      }
      if (bookmarkShortcut) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.touches.length) bookmarkShortcut = false;
        return;
      }
      if (state.bookmarkSelecting) {
        const held = state.bookmarkHeldHandle;
        if (held?.source === 'native' && Array.from(event.changedTouches).some(point => point.identifier === held.id)) {
          state.bookmarkHeldHandle = null;
          if (state.bookmarkSelectionModel?.doc === doc) {
            event.preventDefault();
            doc.defaultView?.requestAnimationFrame(() => {
              if (!selectionMatchesBookmarkModel(doc.getSelection?.())) applyBookmarkSelectionModel();
              renderBookmarkHandle();
            });
          }
        }
        if (state.config?.prefs.readingMode === 'scroll' && !held) return;
        event.stopImmediatePropagation();
        return;
      }
      clearLongPress();
      if (!touch) return;
      const finished = touch;
      touch = null;
      const pageResult = state.config?.prefs.readingMode === 'paged'
        ? pager.end()
        : { moved: false, committed: false };
      if (state.config?.prefs.readingMode === 'paged') event.stopImmediatePropagation();
      if (pageResult.moved) {
        suppressClickUntil = Date.now() + 500;
        event.preventDefault();
        return;
      }
      if (state.config?.prefs.readingMode === 'scroll' && finished.moved) {
        state.scrollIntentUntil = performance.now() + 1600;
        queueScrolledBoundaryCheck();
      }
      if (finished.longPressed) { event.preventDefault(); return; }
      if (finished.moved || Date.now() - finished.started > 500 || interactive(finished.target)) return;
      if (doc.getSelection?.()?.toString?.().trim()) return;
      event.preventDefault();
      suppressClickUntil = Date.now() + 500;
      doc.defaultView?.requestAnimationFrame(() => doc.defaultView?.requestAnimationFrame(() => handleTap(finished.screenX)));
    }, { passive: false, capture: true });
    doc.addEventListener('touchcancel', event => {
      if (state.bookmarkOuterPageGesture && Array.from(event.changedTouches).some(point => point.identifier === state.bookmarkOuterPageGesture.id)) {
        const gesture = state.bookmarkOuterPageGesture;
        cancelBookmarkPageGesture(gesture.gesture);
        state.bookmarkOuterPageGesture = null;
        event.stopImmediatePropagation();
        return;
      }
      if (bookmarkSelectionTouch) {
        if (bookmarkSelectionTimer) doc.defaultView?.clearTimeout(bookmarkSelectionTimer);
        bookmarkSelectionTimer = 0;
        bookmarkSelectionTouch = null;
        event.stopImmediatePropagation();
        return;
      }
      if (bookmarkShortcut) {
        bookmarkShortcut = false;
        event.stopImmediatePropagation();
        return;
      }
      if (state.bookmarkSelecting) {
        const held = state.bookmarkHeldHandle;
        if (held?.source === 'native' && Array.from(event.changedTouches).some(point => point.identifier === held.id))
          state.bookmarkHeldHandle = null;
        if (state.bookmarkSelectionModel?.doc === doc) {
          applyBookmarkSelectionModel();
          renderBookmarkHandle();
        }
        if (state.config?.prefs.readingMode === 'scroll' && !held) return;
        event.stopImmediatePropagation();
        return;
      }
      clearLongPress();
      touch = null;
      state.scrollIntentDir = 0;
      state.scrollIntentUntil = 0;
      pager.cancel();
    }, { passive: true, capture: true });
    doc.addEventListener('click', event => {
      if (state.bookmarkSelecting) return;
      if (Date.now() < suppressClickUntil || event.defaultPrevented || interactive(event.target)) return;
      const x = event.screenX || (((event.clientX % (state.view?.renderer?.size || screenWidth())) + screenWidth()) % screenWidth());
      handleTap(x);
    }, false);
    doc.addEventListener('selectstart', event => {
      if (state.bookmarkSelecting) event.preventDefault();
    }, { capture: true });
    doc.addEventListener('contextmenu', event => {
      if (state.bookmarkSelecting) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (longPressBlocked(event.target)) return;
      event.preventDefault();
      suppressClickUntil = Date.now() + 700;
      void emitLongPress(event.target);
    }, false);
    doc.addEventListener('selectionchange', () => {
      if (!state.bookmarkSelecting) return;
      if (selectionTimer) doc.defaultView?.clearTimeout(selectionTimer);
      selectionTimer = doc.defaultView?.setTimeout(() => {
        selectionTimer = 0;
        let selection = doc.getSelection?.();
        let model = state.bookmarkSelectionModel;
        if (!model && selection?.rangeCount && !selection.getRangeAt(0).collapsed) {
          const range = selection.getRangeAt(0);
          model = state.bookmarkSelectionModel = {
            doc,
            index,
            fixedNode: range.startContainer,
            fixedOffset: range.startOffset,
            movingNode: range.endContainer,
            movingOffset: range.endOffset,
            movingStart: false,
            managed: true,
          };
          applyBookmarkSelectionModel();
          renderBookmarkHandle();
          selection = doc.getSelection?.();
        }
        if (model?.managed && model.doc === doc && !selectionMatchesBookmarkModel(selection)) {
          applyBookmarkSelectionModel();
          renderBookmarkHandle();
          selection = doc.getSelection?.();
        }
        if (!selection?.rangeCount) {
          send({ type: 'bookmark-selection', cfi: '', sectionIndex: index, text: '' });
          return;
        }
        const range = selection.getRangeAt(0);
        const text = selection.toString().replace(/\s+/g, ' ').trim();
        if (range.collapsed || !text) {
          send({ type: 'bookmark-selection', cfi: '', sectionIndex: index, text: '' });
          return;
        }
        let cfi = '';
        try { cfi = state.view?.getCFI?.(index, range) || ''; } catch {}
        if (cfi) send({ type: 'bookmark-selection', cfi, sectionIndex: index, text: text.slice(0, 4000) });
        renderBookmarkHandle();
      }, 120) || 0;
    });
  };
  const isNoteLink = anchor => {
    if (!anchor?.getAttribute) return false;
    const href = anchor.getAttribute('href') || '';
    if (!href.includes('#')) return false;
    const type = anchor?.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type') || '';
    const role = anchor?.getAttribute?.('role') || '';
    const classes = (anchor.getAttribute('class') || '') + ' ' + (anchor.getAttribute('id') || '');
    const marker = (anchor.textContent || '').replace(/\s+/g, '').trim();
    const semantic = /(?:doc-)?(?:note|gloss|biblio)ref/i.test(type + ' ' + role);
    const named = /(?:^|[\s_-])(footnote|endnote|note|noteref|fn|ref|jzyy)(?:[\s_-]|$)/i.test(classes);
    const numbered = /^[（(\[]?[0-9一二三四五六七八九十百]+[）)\].、]?$/u.test(marker);
    return semantic || named || (numbered && (!!anchor.querySelector('sup') || anchor.parentElement?.tagName?.toLowerCase() === 'sup'));
  };
  const noteBlock = (node, source) => {
    if (node?.nodeType === 3) node = node.parentElement;
    if (node?.startContainer) node = node.startContainer.nodeType === 3 ? node.startContainer.parentElement : node.startContainer;
    const inline = 'a,span,sup,sub,em,strong,i,b,small,big';
    while (node?.matches?.(inline) && node.parentElement && node.parentElement !== source.body) node = node.parentElement;
    return node?.closest?.('li,p,aside,blockquote,dd,dt,section,div') || node;
  };
  const noteIsOpen = () => document.getElementById('note-backdrop')?.classList.contains('open') ?? false;
  const emitNavigationState = () => send({
    type: 'navigation-state',
    canGoBack: noteIsOpen() || !!state.view?.history?.canGoBack,
    noteOpen: noteIsOpen(),
  });
  const showNote = (fragment, marker) => {
    const article = document.createElement('article');
    article.appendChild(document.importNode(fragment, true));
    article.querySelectorAll('script,style,[role="doc-backlink"],[epub\\:type~="backlink"]').forEach(element => element.remove());
    article.querySelectorAll('a[href]').forEach(element => element.removeAttribute('href'));
    const content = document.getElementById('note-content');
    content.replaceChildren(article);
    document.getElementById('note-title').textContent = marker ? '注释 ' + marker : '注释';
    document.getElementById('note-backdrop').classList.add('open');
    emitNavigationState();
  };
  const showNoteError = (marker, message) => {
    const text = document.createElement('p');
    text.textContent = message || '无法显示这条注释的内容';
    document.getElementById('note-content').replaceChildren(text);
    document.getElementById('note-title').textContent = marker ? '注释 ' + marker : '注释';
    document.getElementById('note-backdrop').classList.add('open');
    emitNavigationState();
  };
  const isBacklink = anchor => {
    const type = anchor?.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type') || '';
    const role = anchor?.getAttribute?.('role') || '';
    const classes = (anchor?.getAttribute?.('class') || '') + ' ' + (anchor?.getAttribute?.('id') || '');
    return /(?:doc-)?backlink/i.test(type + ' ' + role)
      || /(?:^|[\s_-])(backlink|backref|return)(?:[\s_-]|$)/i.test(classes);
  };
  const setupFootnotes = view => {
    view.addEventListener('link', event => {
      const { a, href } = event.detail || {};
      const note = isNoteLink(a);
      if (!note && isBacklink(a) && view.history?.canGoBack) {
        event.preventDefault();
        view.history.back();
        return;
      }
      if (!note) return;
      event.preventDefault();
      const rawHref = a?.getAttribute?.('href') || '';
      const markerText = (a?.textContent || '').replace(/\s+/g, ' ').trim()
        || (String(rawHref).split('#').pop()?.match(/[0-9一二三四五六七八九十百]+/u)?.[0] || '');
      Promise.resolve(view.book.resolveHref(href || rawHref)).then(async target => {
        if (!target || target.index == null) throw new Error('无法定位注释内容');
        const source = await view.book.sections[target.index]?.createDocument?.();
        if (!source) throw new Error('无法读取注释所在章节');
        let node = target.anchor?.(source);
        let fragment;
        if (node?.cloneContents && !node.collapsed) {
          const ranged = node.cloneContents();
          if (ranged.textContent?.trim() || ranged.querySelector?.('img,svg')) fragment = ranged;
        }
        if (!fragment) {
          node = noteBlock(node, source);
          if (node === source.body || !node) {
            const id = decodeURIComponent(String(href || rawHref).split('#').pop() || '');
            const found = id ? source.getElementById(id) : null;
            node = noteBlock(found, source) || found?.nextElementSibling;
          }
          if (!node) throw new Error('注释目标没有可显示的内容');
          fragment = node.cloneNode(true);
        }
        showNote(fragment, markerText);
      }).catch(error => showNoteError(markerText, error?.message || String(error)));
    });
  };
  const closeNote = () => {
    document.getElementById('note-backdrop').classList.remove('open');
    emitNavigationState();
  };
  const back = () => {
    if (noteIsOpen()) {
      closeNote();
      return true;
    }
    if (!state.view?.history?.canGoBack) return false;
    pager.cancel();
    state.view.history.back();
    return true;
  };
  const previewFraction = fraction => {
    const value = Math.max(0, Math.min(1, Number(fraction)));
    const resolved = state.view?.resolveNavigation?.({ fraction: value });
    return resolved ? state.view?.renderer?.goTo?.(resolved) : undefined;
  };
  const start = () => {
    document.getElementById('note-close').addEventListener('click', closeNote);
    document.getElementById('note-backdrop').addEventListener('click', event => { if (event.target.id === 'note-backdrop') closeNote(); });
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
      document.addEventListener(type, event => {
        state.bookmarkHandleController?.[type.slice(5)]?.(event);
      }, { passive: false, capture: true });
    }
    globalThis.addEventListener('resize', () => {
      state.pageWidth = 0;
      if (state.resizeFrame) globalThis.cancelAnimationFrame(state.resizeFrame);
      state.resizeFrame = globalThis.requestAnimationFrame(() => {
        state.resizeFrame = 0;
        pager.cancel();
        measurePageWidth();
        state.bookmarkHandleController?.render?.();
      });
    }, { passive: true });
    send({ type: 'host-ready' });
  };
  const open = async ({ name, initialCfi, initialProgress, config }) => {
    try {
      const binary = atob(state.chunks.join(''));
      state.chunks.length = 0;
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      const file = new File([bytes], name || 'book.epub', { type: 'application/epub+zip' });
      const view = document.createElement('foliate-view');
      state.view = view;
      document.getElementById('page-current').replaceChildren(view);
      view.addEventListener('load', event => attachDocumentGestures(event.detail));
      view.addEventListener('relocate', event => {
        const d = event.detail || {};
        state.visibleRange = d.range?.cloneRange?.() || null;
        const location = d.location || {};
        const sectionIndex = d.section?.current ?? 0;
        const sectionFractions = view.getSectionFractions?.() || [];
        const sectionStart = sectionFractions[sectionIndex] ?? 0;
        const sectionEnd = sectionFractions[sectionIndex + 1] ?? 1;
        const sectionProgression = Math.max(0, Math.min(1, ((d.fraction ?? sectionStart) - sectionStart) / Math.max(Number.EPSILON, sectionEnd - sectionStart)));
        pager.relocate(d.cfi || '');
        send({
          type: 'relocate',
          cfi: d.cfi || '',
          progression: Number.isFinite(d.fraction) ? d.fraction : 0,
          sectionIndex,
          sectionProgression,
          position: (location.current ?? 0) + 1,
          totalPositions: Math.max(1, location.total ?? 1),
          title: labelOf(d.tocItem?.label),
        });
        const bookmarkRestore = state.bookmarkSelectionRestore;
        if (bookmarkRestore) {
          state.bookmarkSelectionRestore = null;
          if (bookmarkRestore.timeout) globalThis.clearTimeout(bookmarkRestore.timeout);
          Promise.resolve(bookmarkRestore.run(state.visibleRange)).catch(() => {}).finally(() => {
            state.bookmarkPageTurning = false;
            state.bookmarkHandleController?.render?.();
          });
        } else if (state.bookmarkSelecting)
          globalThis.requestAnimationFrame(() => state.bookmarkHandleController?.render?.());
      });
      setupFootnotes(view);
      view.history?.addEventListener?.('index-change', emitNavigationState);
      await view.open(file);
      view.renderer.addEventListener('scroll', () => {
        if (state.bookmarkSelecting && !state.bookmarkPageTurning
          && !state.bookmarkHeldHandle && !state.bookmarkOuterPageGesture)
          state.bookmarkHandleController?.render?.();
        if (state.scrollIntentUntil >= performance.now()) queueScrolledBoundaryCheck();
      });
      applyConfig(config);
      await view.init({
        lastLocation: initialCfi || (initialProgress > 0 ? { fraction: initialProgress } : null),
        // A newly imported book has no saved locator. Foliate's text-start
        // helper intentionally skips cover/frontmatter, so let init enter the
        // first linear section instead. Existing books still restore their CFI
        // or total progression above.
        showTextStart: false
      });
      debug('book ready contents=' + (view.renderer?.getContents?.().length || 0));
      emitNavigationState();
      send({ type: 'book-ready', toc: flattenTOC(view.book.toc) });
    } catch (error) {
      send({ type: 'error', message: error?.stack || error?.message || String(error) });
    }
  };
  globalThis.__MOWEN__ = {
    appendChunk: chunk => state.chunks.push(chunk),
    open,
    configure: applyConfig,
    configureBookmarks: applyBookmarks,
    next: () => pager.turn(1),
    previous: () => pager.turn(-1),
    goTo: target => state.view?.goTo(target),
    goToFraction: fraction => state.view?.goToFraction(Math.max(0, Math.min(1, Number(fraction)))),
    previewFraction,
    back,
    turnBookmarkSelectionPage: (direction, point) => {
      const rect = state.view?.renderer?.getBoundingClientRect?.() || currentSurface()?.getBoundingClientRect?.();
      const clientX = Number(point?.clientX);
      const clientY = Number(point?.clientY);
      const contentPoint = rect && Number.isFinite(clientX) && Number.isFinite(clientY)
        ? { clientX: clientX - rect.left, clientY: clientY - rect.top }
        : null;
      return state.bookmarkSelectionPageTurn?.(direction < 0 ? -1 : 1, contentPoint) || false;
    },
    beginBookmarkSelection: () => {
      state.bookmarkSelecting = true;
      state.bookmarkSelectionModel = null;
      state.bookmarkHeldHandle = null;
      state.bookmarkOuterPageGesture = null;
      state.bookmarkHandleController?.hide?.();
      pager.cancel();
      send({ type: 'bookmark-selection-mode', active: true });
    },
    endBookmarkSelection: () => {
      state.bookmarkSelecting = false;
      pager.cancel();
      if (state.bookmarkSelectionRestore?.timeout) globalThis.clearTimeout(state.bookmarkSelectionRestore.timeout);
      state.bookmarkSelectionRestore = null;
      state.bookmarkPageTurning = false;
      state.bookmarkSelectionModel = null;
      state.bookmarkHeldHandle = null;
      state.bookmarkOuterPageGesture = null;
      state.bookmarkHandleController?.hide?.();
      state.view?.renderer?.getContents?.().forEach(({ doc }) => doc.getSelection?.()?.removeAllRanges?.());
      send({ type: 'bookmark-selection-mode', active: false });
    },
    pagerStatus: () => ({
      currentCfi: state.currentCfi,
      previousReady: !!preparedPreview(-1),
      nextReady: !!preparedPreview(1),
      turning: !!state.turn,
      dragging: !!state.gesture,
    }),
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
`;

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
    console.log('[MOWEN_BOOKMARK] native setBookmarks count=' + bookmarks.length + ' webView=' + (!!webView.current));
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
    if (message.type === 'debug') { console.log(message.message); return; }
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
