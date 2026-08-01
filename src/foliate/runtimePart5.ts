export const FOLIATE_BRIDGE_PART_5 = String.raw`stem.
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
            // fast second-finger drag cannot silently lose move`;

