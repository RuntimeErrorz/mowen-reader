export const FOLIATE_BRIDGE_PART_3 = String.raw`    } catch {}
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
  };
  const attachDocumentGestures = ({ doc, index }) => {
    markLegacyHeadings(doc);
    applyBookmarkHighlights(doc, index, bookmarkOverlayer(doc));
    let touch = null;
    let longPressTimer = 0;
    let suppressClickUntil = 0;
    let selectionTimer = 0;
    let bookmarkShortcut = false;
    let bookmarkSelectionTouch = null;
    let bookmarkSelectionTimer = 0;
    const interactive = target => target?.closest?.('a[href],button,input,textarea,select,label');
    const imageFromTarget = target => {
      if (target?.nodeType === 3) target = target.parentElement;
      if (target?.tagName?.toLowerCase?.() === 'img') return target;
      return target?.closest?.('img') || null;
    };
    const imageFromEvent = event => imageFromTarget(event?.target)
      || event?.composedPath?.().map(imageFromTarget).find(Boolean)
      || null;
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
    const contentPointFro`;
