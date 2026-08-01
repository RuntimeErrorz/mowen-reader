export const FOLIATE_BRIDGE_PART_2 = String.raw`rentSurface();
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
    if (!state.config) {
      return;
    }
    state.config = { ...state.config, bookmarks: next };
    const contents = state.view?.renderer?.getContents?.() || [];
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
    `;
