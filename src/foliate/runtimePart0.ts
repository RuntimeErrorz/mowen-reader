export const FOLIATE_BRIDGE_PART_0 = String.raw`
(() => {
  const send = value => globalThis.ReactNativeWebView?.postMessage(JSON.stringify(value));
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
    for (const preview of state.previews ? [state.previews.previous, state.previews.next] `;
