import * as FileSystem from 'expo-file-system/legacy';
import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { FOLIATE_BUNDLE } from './generated/foliateBundle';
import { ReaderPrefs } from './types';

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
};

export type FoliateReaderHandle = {
  next: () => void;
  previous: () => void;
  goTo: (target: string) => void;
  goToFraction: (fraction: number) => void;
};

type Props = {
  epubUri: string;
  title: string;
  prefs: ReaderPrefs;
  palette: FoliatePalette;
  initialCfi?: string;
  initialProgress: number;
  onReady: (toc: FoliateTOCItem[]) => void;
  onLocationChange: (location: FoliateLocation) => void;
  onCenterTap: () => void;
  onLongPress: (selection: FoliateLongPress) => void;
  onError: (message: string) => void;
};

type HostMessage =
  | { type: 'host-ready' }
  | { type: 'book-ready'; toc: FoliateTOCItem[] }
  | ({ type: 'relocate' } & FoliateLocation)
  | { type: 'center-tap' }
  | ({ type: 'long-press' } & FoliateLongPress)
  | { type: 'debug'; event: string; data?: Record<string, unknown> }
  | { type: 'error'; message: string };

const FOLIATE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob: data:; font-src blob: data:; style-src 'unsafe-inline' blob:; connect-src blob: data:; frame-src blob:; script-src 'none';">
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body,foliate-view{margin:0;width:100%;height:100%;overflow:hidden}
html,body{background:#fff}
#reader-shell{position:fixed;inset:0;overflow:hidden}
foliate-view{display:block}
foliate-view::part(head),foliate-view::part(foot){display:none}
#note-backdrop{display:none;position:fixed;z-index:100;inset:0;background:rgba(0,0,0,.24);padding:18px;align-items:flex-end}
#note-backdrop.open{display:flex}
#note-card{position:relative;width:100%;max-height:58%;border-radius:16px;overflow:hidden;border:1px solid var(--line);background:var(--bg);box-shadow:0 12px 40px rgba(0,0,0,.25)}
#note-title{padding:16px 54px 10px 20px;color:var(--text);font-size:15px;font-weight:700;border-bottom:1px solid var(--line)}
#note-content{display:block;width:100%;max-width:100%;max-height:min(42vh,420px);padding:14px 20px 22px;overflow-x:hidden;overflow-y:auto;color:var(--text);font-size:16px;line-height:1.75;overflow-wrap:anywhere;word-break:break-word}
#note-content article{display:block;width:100%;max-width:100%;min-width:0}
#note-content article *{box-sizing:border-box!important;max-width:100%!important;min-width:0!important}
#note-content p,#note-content div,#note-content li,#note-content blockquote,#note-content dd,#note-content dt{width:auto!important;white-space:normal!important;overflow-wrap:anywhere!important;word-break:break-word!important}
#note-content p{margin:0 0 .8em}
#note-content pre,#note-content code{white-space:pre-wrap!important;overflow-wrap:anywhere!important;word-break:break-word!important}
#note-content table{display:table!important;width:100%!important;table-layout:fixed!important;border-collapse:collapse}
#note-content th,#note-content td{width:auto!important;white-space:normal!important;overflow-wrap:anywhere!important;word-break:break-word!important}
#note-content img,#note-content svg,#note-content video{display:block;max-width:100%!important;width:auto!important;height:auto!important;margin-inline:auto}
#note-content a{color:var(--accent)}
#note-close{position:absolute;z-index:2;right:8px;top:8px;width:34px;height:34px;border:0;border-radius:17px;background:var(--bg);color:var(--muted);font-size:22px}
</style></head><body><div id="reader-shell"></div><div id="note-backdrop"><div id="note-card"><button id="note-close" aria-label="关闭">×</button><div id="note-title">注释</div><div id="note-content"></div></div></div></body></html>`;

const FOLIATE_BRIDGE = String.raw`
(() => {
  const send = value => globalThis.ReactNativeWebView?.postMessage(JSON.stringify(value));
  const debug = (event, data) => send({ type: 'debug', event, data });
  const state = { chunks: [], config: null, view: null };
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
  const applyConfig = config => {
    state.config = config;
    const shell = document.getElementById('reader-shell');
    shell.style.inset = config.prefs.pagePaddingTop + 'px ' + config.prefs.pagePaddingRight + 'px ' + config.prefs.pagePaddingBottom + 'px ' + config.prefs.pagePaddingLeft + 'px';
    document.documentElement.style.setProperty('--bg', config.palette.bg);
    document.documentElement.style.setProperty('--text', config.palette.text);
    document.documentElement.style.setProperty('--muted', config.palette.muted);
    document.documentElement.style.setProperty('--line', config.palette.line);
    document.documentElement.style.setProperty('--accent', config.palette.accent);
    const noteContent = document.getElementById('note-content');
    noteContent.style.fontSize = config.prefs.fontSize + 'px';
    noteContent.style.lineHeight = String(config.prefs.lineHeight);
    document.documentElement.style.background = config.palette.bg;
    document.body.style.background = config.palette.bg;
    const renderer = state.view?.renderer;
    if (!renderer) return;
    renderer.removeAttribute('animated');
    renderer.setAttribute('flow', config.prefs.readingMode === 'scroll' ? 'scrolled' : 'paginated');
    renderer.setAttribute('margin', '0px');
    renderer.setAttribute('gap', '0%');
    renderer.setAttribute('max-column-count', '1');
    renderer.setStyles?.(styleText(config));
  };
  const attachDocumentGestures = ({ doc, index }) => {
    let touch = null;
    let longPressTimer = 0;
    let suppressClickUntil = 0;
    const interactive = target => target?.closest?.('a[href],button,input,textarea,select,label');
    const longPressBlocked = target => target?.closest?.('button,input,textarea,select,label');
    const screenWidth = () => Math.max(1, doc.defaultView?.screen?.width || globalThis.screen?.width || state.view?.renderer?.size || 1);
    const clearLongPress = () => {
      if (longPressTimer) doc.defaultView?.clearTimeout(longPressTimer);
      longPressTimer = 0;
    };
    const readableBlock = target => target?.closest?.('p,li,blockquote,h1,h2,h3,h4,h5,h6,dd,dt,figcaption');
    const blobDataURL = blob => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(reader.error || new Error('无法读取图片'));
      reader.readAsDataURL(blob);
    });
    const imageDataOf = async image => {
      const src = image?.currentSrc || image?.src || '';
      if (src.startsWith('data:image/')) return src;
      if (!src) return '';
      try {
        const response = await fetch(src);
        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) return '';
        return await blobDataURL(blob);
      } catch { return ''; }
    };
    const emitLongPress = async target => {
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
        send({ type: 'long-press', cfi, sectionIndex: index, text, kind: 'image', imageData });
        return true;
      }
      const block = readableBlock(target);
      if (!block) return false;
      const selection = doc.getSelection?.();
      const range = doc.createRange();
      range.selectNodeContents(block);
      const text = block.textContent?.replace(/\s+/g, ' ').trim() || '';
      if (!text) return false;
      selection?.removeAllRanges?.();
      selection?.addRange?.(range);
      let cfi = '';
      try { cfi = state.view?.getCFI?.(index, range) || ''; } catch {}
      send({ type: 'long-press', cfi, sectionIndex: index, text: text.slice(0, 1600), kind: 'text' });
      return true;
    };
    const handleTap = screenX => {
      if (state.config?.prefs.readingMode === 'scroll') { debug('tap', { action: 'menu', mode: 'scroll', section: index }); send({ type: 'center-tap' }); return; }
      const ratio = screenX / screenWidth();
      const action = ratio < .3 ? 'previous' : ratio > .7 ? 'next' : 'menu';
      debug('tap', { action, ratio, screenX, width: screenWidth(), section: index });
      if (action === 'previous') state.view?.prev();
      else if (action === 'next') state.view?.next();
      else send({ type: 'center-tap' });
    };
    doc.addEventListener('touchstart', event => {
      if (event.touches.length !== 1) return;
      doc.getSelection?.()?.removeAllRanges?.();
      const point = event.touches[0];
      touch = { x: point.clientX, y: point.clientY, screenX: point.screenX, started: Date.now(), target: event.target, moved: false, longPressed: false };
      clearLongPress();
      if (!longPressBlocked(event.target)) {
        longPressTimer = doc.defaultView?.setTimeout(() => {
          if (!touch || touch.moved) return;
          touch.longPressed = true;
          suppressClickUntil = Date.now() + 700;
          globalThis.navigator?.vibrate?.(24);
          void emitLongPress(touch.target);
        }, 520) || 0;
      }
    }, { passive: true });
    doc.addEventListener('touchmove', event => {
      if (!touch || event.touches.length !== 1) return;
      const point = event.touches[0];
      if (Math.hypot(point.clientX - touch.x, point.clientY - touch.y) > 9) {
        touch.moved = true;
        clearLongPress();
      } else event.stopImmediatePropagation();
    }, { passive: true, capture: true });
    doc.addEventListener('touchend', event => {
      clearLongPress();
      if (!touch) return;
      const finished = touch;
      touch = null;
      if (!finished.moved) event.stopImmediatePropagation();
      if (finished.longPressed) { event.preventDefault(); return; }
      if (finished.moved || Date.now() - finished.started > 500 || interactive(finished.target)) return;
      if (doc.getSelection?.()?.toString?.().trim()) return;
      event.preventDefault();
      suppressClickUntil = Date.now() + 500;
      doc.defaultView?.requestAnimationFrame(() => doc.defaultView?.requestAnimationFrame(() => handleTap(finished.screenX)));
    }, { passive: false, capture: true });
    doc.addEventListener('touchcancel', () => { clearLongPress(); touch = null; }, { passive: true });
    doc.addEventListener('click', event => {
      if (Date.now() < suppressClickUntil || event.defaultPrevented || interactive(event.target)) return;
      const x = event.screenX || (((event.clientX % (state.view?.renderer?.size || screenWidth())) + screenWidth()) % screenWidth());
      handleTap(x);
    }, false);
    doc.addEventListener('contextmenu', event => {
      if (longPressBlocked(event.target)) return;
      event.preventDefault();
      suppressClickUntil = Date.now() + 700;
      void emitLongPress(event.target);
    }, false);
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
  const showNote = (fragment, marker) => {
    const article = document.createElement('article');
    article.appendChild(document.importNode(fragment, true));
    article.querySelectorAll('script,style,[role="doc-backlink"],[epub\\:type~="backlink"]').forEach(element => element.remove());
    article.querySelectorAll('a[href]').forEach(element => element.removeAttribute('href'));
    const content = document.getElementById('note-content');
    content.replaceChildren(article);
    document.getElementById('note-title').textContent = marker ? '注释 ' + marker : '注释';
    document.getElementById('note-backdrop').classList.add('open');
  };
  const showNoteError = (marker, message) => {
    const text = document.createElement('p');
    text.textContent = message || '无法显示这条注释的内容';
    document.getElementById('note-content').replaceChildren(text);
    document.getElementById('note-title').textContent = marker ? '注释 ' + marker : '注释';
    document.getElementById('note-backdrop').classList.add('open');
  };
  const setupFootnotes = view => {
    view.addEventListener('link', event => {
      const { a, href } = event.detail || {};
      const note = isNoteLink(a);
      debug('link', { href: String(href || ''), rawHref: a?.getAttribute?.('href') || '', className: a?.getAttribute?.('class') || '', note });
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
  const closeNote = () => document.getElementById('note-backdrop').classList.remove('open');
  const start = () => {
    document.getElementById('note-close').addEventListener('click', closeNote);
    document.getElementById('note-backdrop').addEventListener('click', event => { if (event.target.id === 'note-backdrop') closeNote(); });
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
      document.getElementById('reader-shell').replaceChildren(view);
      view.addEventListener('load', event => attachDocumentGestures(event.detail));
      view.addEventListener('relocate', event => {
        const d = event.detail || {};
        const location = d.location || {};
        const sectionIndex = d.section?.current ?? 0;
        const sectionFractions = view.getSectionFractions?.() || [];
        const sectionStart = sectionFractions[sectionIndex] ?? 0;
        const sectionEnd = sectionFractions[sectionIndex + 1] ?? 1;
        const sectionProgression = Math.max(0, Math.min(1, ((d.fraction ?? sectionStart) - sectionStart) / Math.max(Number.EPSILON, sectionEnd - sectionStart)));
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
      });
      setupFootnotes(view);
      await view.open(file);
      applyConfig(config);
      await view.init({ lastLocation: initialCfi || (initialProgress > 0 ? { fraction: initialProgress } : null), showTextStart: !initialCfi && !(initialProgress > 0) });
      send({ type: 'book-ready', toc: flattenTOC(view.book.toc) });
    } catch (error) {
      send({ type: 'error', message: error?.stack || error?.message || String(error) });
    }
  };
  globalThis.__MOWEN__ = {
    appendChunk: chunk => state.chunks.push(chunk),
    open,
    configure: applyConfig,
    next: () => state.view?.next(),
    previous: () => state.view?.prev(),
    goTo: target => state.view?.goTo(target),
    goToFraction: fraction => state.view?.goToFraction(Math.max(0, Math.min(1, Number(fraction)))),
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
  const config = { prefs: props.prefs, palette: props.palette };

  const call = useCallback((method: string, ...args: unknown[]) => {
    webView.current?.injectJavaScript(injectCall(method, ...args));
  }, []);

  useImperativeHandle(ref, () => ({
    next: () => call('next'),
    previous: () => call('previous'),
    goTo: (target) => call('goTo', target),
    goToFraction: (fraction) => call('goToFraction', fraction),
  }), [call]);

  useEffect(() => {
    if (!loading && !error) call('configure', config);
  }, [error, loading, props.palette, props.prefs, call]);

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
    if (message.type === 'long-press') { props.onLongPress(message); return; }
    if (message.type === 'debug') { console.info(`[Foliate] ${message.event}`, message.data ?? {}); return; }
    if (message.type === 'error') {
      setError(message.message);
      setLoading(false);
      props.onError(message.message);
    }
  }, [props.onCenterTap, props.onError, props.onLocationChange, props.onLongPress, props.onReady, sendBook]);

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
