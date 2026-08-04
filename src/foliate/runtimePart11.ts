export const FOLIATE_BRIDGE_PART_11 = String.raw`?.trim() || ranged.querySelector?.('img,svg')) fragment = ranged;
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
    if (imageViewerIsOpen()) {
      document.getElementById('image-viewer')?.__mowenImageViewer?.close?.();
      return true;
    }
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
  const drawSearchHighlight = rects => {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('fill', 'var(--accent)');
    group.setAttribute('opacity', '0.32');
    group.style.mixBlendMode = state.config?.prefs?.theme === 'night' ? 'screen' : 'multiply';
    for (const rect of rects || []) {
      if (!rect.width || !rect.height) continue;
      const element = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      element.setAttribute('x', String(rect.left));
      element.setAttribute('y', String(rect.top));
      element.setAttribute('width', String(rect.width));
      element.setAttribute('height', String(rect.height));
      element.setAttribute('rx', '2');
      group.append(element);
    }
    return group;
  };
  const sectionIndexOf = cfi => {
    try {
      const index = state.view?.resolveCFI?.(cfi)?.index;
      return Number.isInteger(index) && index >= 0 ? index : 0;
    } catch { return 0; }
  };
  const search = async (query, requestId) => {
    const token = ++state.searchToken;
    state.searchIterator?.return?.();
    state.searchIterator = null;
    const text = String(query || '').trim();
    state.view?.clearSearch?.();
    if (!text) {
      send({ type: 'search-complete', requestId });
      return;
    }
    let iterator = null;
    try {
      iterator = state.view?.search?.({
        query: text,
        matchCase: false,
        matchDiacritics: false,
        draw: drawSearchHighlight,
      });
      if (!iterator) throw new Error('正文还没有准备好，请稍后再试');
      state.searchIterator = iterator;
      let completed = false;
      for await (const result of iterator) {
        if (token !== state.searchToken) return;
        if (result === 'done') {
          completed = true;
          send({ type: 'search-complete', requestId });
          break;
        }
        if (Number.isFinite(result?.progress)) {
          send({ type: 'search-progress', requestId, progress: Math.max(0, Math.min(1, Number(result.progress))) });
          continue;
        }
        if (!Array.isArray(result?.subitems) || !result.subitems.length) continue;
        const sectionIndex = sectionIndexOf(result.subitems[0]?.cfi || '');
        const sectionTitle = labelOf(result.label) || '正文';
        send({
          type: 'search-results',
          requestId,
          sectionIndex,
          sectionTitle,
          results: result.subitems
            .filter(item => typeof item?.cfi === 'string' && item.excerpt)
            .map(item => ({
              cfi: item.cfi,
              sectionIndex,
              sectionTitle,
              excerpt: {
                pre: String(item.excerpt.pre || ''),
                match: String(item.excerpt.match || ''),
                post: String(item.excerpt.post || ''),
              },
            })),
        });
      }
      if (!completed && token === state.searchToken) send({ type: 'search-complete', requestId });
    } catch (error) {
      if (token === state.searchToken) send({ type: 'search-error', requestId, message: error?.message || String(error) });
    } finally {
      if (state.searchIterator === iterator) state.searchIterator = null;
    }
  };
  const clearSearch = () => {
    state.searchToken++;
    state.searchIterator?.return?.();
    state.searchIterator = null;
    state.view?.clearSearch?.();
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
    search,
    clearSearch,
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
