export const FOLIATE_BRIDGE_PART_1 = String.raw`: []) {
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
      const current = cur`;

