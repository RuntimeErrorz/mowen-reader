export const FOLIATE_BRIDGE_PART_9 = String.raw`uch.clientY;
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
      // Only the initial touch target can be an image tap. Looking at the
      // touchend target makes a swipe that crosses an image look like a tap.
      const image = finished.image || imageFromTarget(finished.target);
      const noteImage = image && isNoteLink(image.closest?.('a[href]'));
      const pageResult = state.config?.prefs.readingMode === 'paged'
        ? pager.end()
        : { moved: false, committed: false };
      if (state.config?.prefs.readingMode === 'paged') event.stopImmediatePropagation();
      if (pageResult.moved) {
        suppressClickUntil = Date.now() + 500;
        event.preventDefault();
        return;
      }
      if (finished.moved) {
        suppressClickUntil = Date.now() + 700;
        if (state.config?.prefs.readingMode === 'scroll') {
          state.scrollIntentUntil = performance.now() + 1600;
          queueScrolledBoundaryCheck();
        }
        event.preventDefault();
        return;
      }
      if (finished.longPressed) { event.preventDefault(); return; }
      if (Date.now() - finished.started > 500 || (interactive(finished.target) && !image)) return;
      if (doc.getSelection?.()?.toString?.().trim()) return;
      if (noteImage) return;
      if (image) {
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressClickUntil = Date.now() + 700;
        openImageViewer(image);
        return;
      }
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
        if (bookmarkSelectionTimer) doc.d`;

