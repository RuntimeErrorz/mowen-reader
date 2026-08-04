export const FOLIATE_BRIDGE_PART_8 = String.raw`identifier !== heldHandle.id && !state.bookmarkOuterPageGesture) {
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
        identifier: point.identifier,
        x: point.clientX,
        y: point.clientY,
        lastScreenY: point.screenY,
        screenX: point.screenX,
        started: Date.now(),
        target: event.target,
        image: imageFromEvent(event),
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
          void emitLongPress(touch.image || touch.target);
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
            held.clientY = handleTo`;

