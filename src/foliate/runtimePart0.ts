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
    searchToken: 0,
    searchIterator: null,
  };
  const labelOf = value => typeof value === 'string' ? value : value && typeof value === 'object' ? String(value.zh || value['zh-CN'] || value.en || Object.values(value)[0] || '') : '';
  const flattenTOC = (items, depth = 0, output = []) => {
    for (const item of items || []) {
      output.push({ label: labelOf(item.label) || '未命名章节', href: item.href || '', depth });
      flattenTOC(item.subitems, depth + 1, output);
    }
    return output;
  };
  const parseFontScale = (value, baseSize) => {
    const match = String(value || '').trim().match(/^([0-9.]+)(em|rem|%|px|pt)$/i);
    if (!match) return 1;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return 1;
    const unit = match[2].toLowerCase();
    if (unit === 'em' || unit === 'rem') return amount;
    if (unit === '%') return amount / 100;
    if (unit === 'pt') return amount * 96 / 72 / Math.max(1, baseSize);
    return amount / Math.max(1, baseSize);
  };
  const sourceFontScales = doc => {
    const baseSize = Number.parseFloat(doc.defaultView?.getComputedStyle?.(doc.body)?.fontSize) || 16;
    const scales = new Map();
    const visitRules = rules => {
      for (const rule of Array.from(rules || [])) {
        if (rule.cssRules) visitRules(rule.cssRules);
        const selector = rule.selectorText;
        const scale = parseFontScale(rule.style?.getPropertyValue?.('font-size') || rule.style?.fontSize, baseSize);
        if (!selector || scale <= 1) continue;
        for (const match of selector.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
          const token = match[1];
          scales.set(token, Math.max(scales.get(token) || 1, scale));
        }
      }
    };
    for (const sheet of Array.from(doc.styleSheets || [])) {
      try { visitRules(sheet.cssRules); } catch {}
    }
    return { baseSize, scales, computedScales: new WeakMap() };
  };
  const fontScaleForNode = (node, source) => {
    if (!node) return 1;
    if (source.computedScales.has(node)) return source.computedScales.get(node);
    let scale = parseFontScale(node.style?.fontSize, source.baseSize);
    for (const token of Array.from(node.classList || [])) scale = Math.max(scale, source.scales.get(token) || 1);
    const computed = node.ownerDocument?.defaultView?.getComputedStyle?.(node);
    scale = Math.max(scale, parseFontScale(computed?.fontSize, source.baseSize));
    source.computedScales.set(node, scale);
    return scale;
  };
  const scaledTextRatio = (element, source) => {
    const filter = element.ownerDocument?.defaultView?.NodeFilter?.SHOW_TEXT || 4;
    const walker = element.ownerDocument.createTreeWalker(element, filter);
    let total = 0;
    let scaled = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = String(node.nodeValue || '').replace(/\s+/g, '');
      if (!value) continue;
      total += value.length;
      let scale = 1;
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        scale = Math.max(scale, fontScaleForNode(parent, source));
        if (parent === element) break;
      }
      if (scale >= 1.25) scaled += value.length;
    }
    return total ? scaled / total : 0;
  };
  const markLegacyHeadings = doc => {
    if (!doc?.body?.querySelectorAll) return;
    const source = sourceFontScales(doc);
    const candidates = doc.body.querySelectorAll('p,div,blockquote');
    for (const element of candidates) {
      if (element.matches('h1,h2,h3,h4,h5,h6,[data-mowen-heading]')) continue;
      if (element.closest('figure,table,nav,ol,ul,pre,code')) continue;
      if (element.tagName.toLowerCase() !== 'blockquote' && element.closest('blockquote')) continue;
      if (element.querySelector('img,svg,video,canvas,p,div,section,article,blockquote,figure,table,ol,ul,pre')) continue;
      const text = String(element.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length < 2 || text.length > 140) continue;
      let scale = fontScaleForNode(element, source);
      for (const child of element.querySelectorAll('*')) scale = Math.max(scale, fontScaleForNode(child, source));
      if (scale < 1.25 || scaledTextRatio(element, source) < .6) continue;
      element.setAttribute('data-mowen-heading', scale >= 1.55 ? 'major' : 'minor');
    }
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
      ':root:root body h1 { font-size: 1.75em !important; line-height: 1.3 !important; margin-block: 1.6em .75em !important; margin-inline: 0 !important; text-align: center !important; color: ' + c.text + ' !important; }',
      ':root:root body h2 { font-size: 1.55em !important; line-height: 1.35 !important; margin-block: 1.2em .6em !important; margin-inline: 0 !important; text-align: center !important; color: ' + c.text + ' !important; }',
      ':root:root body h3 { font-size: 1.35em !important; line-height: 1.4 !important; margin-block: 1em .5em !important; margin-inline: 0 !important; text-align: left !important; color: ' + c.text + ' !important; }',
      ':root:root body h4, :root:root body h5, :root:root body h6 { font-size: 1.15em !important; line-height: 1.45 !important; margin-block: .85em .4em !important; margin-inline: 0 !important; text-align: left !important; color: ' + c.text + ' !important; }',
      ':root:root body h1, :root:root body h2, :root:root body h3, :root:root body h4, :root:root body h5, :root:root body h6 { break-after: avoid !important; page-break-after: avoid !important; }',
      ':root:root body h1, :root:root body h2, :root:root body h3, :root:root body h4, :root:root body h5, :root:root body h6, :root:root body [role="heading"], :root:root body [class*="title" i], :root:root body [class*="heading" i], :root:root body [class*="biaoti" i], :root:root body [class*="title" i] p, :root:root body [class*="heading" i] p, :root:root body [class*="biaoti" i] p { text-indent: 0 !important; }',
      ':root:root body [role="heading"]:not(h1):not(h2):not(h3):not(h4):not(h5):not(h6), :root:root body [class*="heading" i]:not(h1):not(h2):not(h3):not(h4):not(h5):not(h6), :root:root body [class*="biaoti" i]:not(h1):not(h2):not(h3):not(h4):not(h5):not(h6) { margin-block: 1em .5em !important; margin-inline: 0 !important; font-size: 1.2em !important; font-weight: 700 !important; line-height: 1.35 !important; text-align: left !important; break-after: avoid !important; page-break-after: avoid !important; }',
      ':root:root body [data-mowen-heading="major"] { display: block !important; margin-block: 1.35em .65em !important; margin-inline: 0 !important; padding: 0 !important; border: 0 !important; font-size: 1.55em !important; font-weight: 700 !important; line-height: 1.3 !important; text-align: center !important; text-indent: 0 !important; color: ' + c.text + ' !important; break-after: avoid !important; page-break-after: avoid !important; }',
      ':root:root body [data-mowen-heading="minor"] { display: block !important; margin-block: 1em .5em !important; margin-inline: 0 !important; padding: 0 !important; border: 0 !important; font-size: 1.3em !important; font-weight: 700 !important; line-height: 1.4 !important; text-align: left !important; text-indent: 0 !important; color: ' + c.text + ' !important; break-after: avoid !important; page-break-after: avoid !important; }',
      ':root:root body small, :root:root body figcaption, :root:root body .tushuo, :root:root body .tuti, :root:root body .tuzhu { font-size: .85em !important; line-height: 1.55 !important; }',
      ':root:root body sup, :root:root body sub, :root:root body rt { font-size: .72em !important; line-height: 0 !important; }',
      ':root:root body pre, :root:root body code, :root:root body kbd, :root:root body samp { font-family: monospace !important; font-size: .9em !important; }',
      ':root:root body p, :root:root body li, :root:root body blockquote, :root:root body dd, :root:root body dt { text-align: ' + align + ' !important; }',
      'body p { margin-block-start: 0 !important; margin-block-end: ' + p.paragraphSpacing + 'px !important; text-indent: ' + (p.firstLineIndent ? '2em' : '0') + ' !important; }',
      'figure p, figcaption, .caption, .tushuo, .tuti { margin-block: 0 .35em !important; text-align: center !important; text-indent: 0 !important; }',
      'caption { margin-block: 0 .35em !important; text-align: center !important; text-indent: 0 !important; }',
      'td p, th p, li > p, nav p, [epub\\:type~="titlepage"] p, [epub\\:type~="toc"] p, .tuzhu { margin-block: 0 .35em !important; text-align: left !important; text-indent: 0 !important; }',
      ':root:root body ol, :root:root body ul { margin-block: .6em !important; padding-inline-start: 1.5em !important; }',
      ':root:root body li { margin-block: .2em !important; padding-inline-start: .1em !important; }',
      'body, p, div, section, article, li, blockquote, h1, h2, h3, h4, h5, h6 { color: ' + c.text + ' !important; }',
      ':root:root body a, :root:root body a:visited { color: ' + c.accent + ' !important; }',
      ':root:root body blockquote { margin-block: 1em !important; margin-inline: 0 !important; padding: .1em 0 .1em 1em !important; border-inline-start: .18em solid ' + c.accent + ' !important; }',
      ':root:root body table { width: 100% !important; max-width: 100% !important; margin-block: 1em !important; border-collapse: collapse !important; table-layout: auto !important; font-size: .92em !important; }',
      ':root:root body th, :root:root body td { padding: .45em .5em !important; border: 1px solid ' + c.line + ' !important; text-align: left !important; vertical-align: top !important; overflow-wrap: anywhere !important; word-break: break-word !important; }',
      ':root:root body pre { margin-block: 1em !important; padding: .75em !important; background: ' + c.focus + ' !important; border: 1px solid ' + c.line + ' !important; text-align: left !important; white-space: pre-wrap !important; overflow-wrap: anywhere !important; word-break: break-word !important; }',
      ':root:root body code, :root:root body kbd, :root:root body samp { padding: .08em .25em !important; background: ' + c.focus + ' !important; border-radius: .25em !important; }',
      ':root:root body hr { height: 0 !important; margin-block: 1.2em !important; border: 0 !important; border-top: 1px solid ' + c.line + ' !important; }',
      'img, svg, video, canvas { max-inline-size: 100% !important; block-size: auto; object-fit: contain; }',
      ':root:root body figure, :root:root body .chatu_img, :root:root body .chatu_img-l, :root:root body .illustration, :root:root body .image, :root:root body .figure { display: block !important; inline-size: 100% !important; max-inline-size: 100% !important; margin-block: 1em !important; margin-inline: 0 !important; text-align: center !important; break-inside: avoid !important; page-break-inside: avoid !important; }',
      ':root:root body figure :is(img, svg, video, canvas), :root:root body .chatu_img :is(img, svg, video, canvas), :root:root body .chatu_img-l :is(img, svg, video, canvas), :root:root body .illustration :is(img, svg, video, canvas), :root:root body .image :is(img, svg, video, canvas), :root:root body .figure :is(img, svg, video, canvas) { display: block !important; max-inline-size: 100% !important; max-block-size: 68vh !important; block-size: auto !important; margin-inline: auto !important; object-fit: contain !important; }',
      'figcaption, .tuti, .tuzhu { break-before: avoid; break-inside: avoid; }',
      'aside[epub|type~="endnote"], aside[epub|type~="footnote"], aside[epub|type~="note"], aside[epub|type~="rearnote"] { display: none !important; }',
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
