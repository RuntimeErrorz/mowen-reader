export const FOLIATE_BRIDGE_PART_6 = String.raw`ment.
            if (navigate === undefined) {
              gesture.pendingScroll += amount;
              await new Promise(resolve => doc.defaultView?.requestAnimationFrame(resolve));
              continue;
            }
            await Promise.resolve(navigate);
          }
        } catch {} finally {
          gesture.scrollApplying = false;
        }
      };
      gesture.scrollQueue = drain();
    };
    const moveBookmarkPageGesture = (gesture, x, y, time) => {
      if (!gesture) return false;
      if (gesture.kind === 'paged') return gesture.active && pager.move(x, y, time);
      const renderer = state.view?.renderer;
      const horizontal = renderer?.scrollProp === 'scrollLeft';
      const deltaX = x - gesture.lastX;
      const deltaY = y - gesture.lastY;
      const dt = Math.max(1, time - gesture.lastTime);
      const delta = horizontal ? deltaX : deltaY;
      const instantVelocity = delta / dt;
      gesture.velocityY = gesture.velocityY * .72 + instantVelocity * .28;
      gesture.lastX = x;
      gesture.lastY = y;
      gesture.deltaY = horizontal ? x - gesture.startX : y - gesture.startY;
      // The held selection handle has touch-action:none. Letting the browser
      // perform native scrolling would therefore cancel the whole two-finger
      // gesture on Android. Move Foliate's scrolled renderer through its
      // public navigation API, which refreshes its internal scroll bounds.
      if (renderer?.scrolled) {
        const scrollDelta = horizontal ? -deltaX : -deltaY;
        queueBookmarkGestureScroll(gesture, renderer, scrollDelta);
        if (Math.abs(delta) >= 1) {
          // next/prev(distance) handles the section boundary itself. Do not
          // start the independent boundary turner for this same gesture.
          state.scrollIntentDir = 0;
          state.scrollIntentUntil = 0;
        }
        state.bookmarkHandleController?.render?.();
      }
      gesture.lastTime = time;
      return true;
    };
    const endBookmarkPageGesture = (gesture, handlePoint, adjustsSelection = true) => {
      if (!gesture) return { moved: false, committed: false };
      if (gesture.kind === 'paged') {
        return gesture.active
          ? pager.end(adjustsSelection ? direction => {
            queueBookmarkSelectionRestore(direction, handlePoint);
            return true;
          } : undefined)
          : { moved: false, committed: false };
      }
      const renderer = state.view?.renderer;
      const size = Number(renderer?.size) || 1;
      const moved = Math.abs(gesture.deltaY) >= 4;
      const projectedDelta = gesture.deltaY + gesture.velocityY * 180;
      const direction = projectedDelta < 0 ? 1 : -1;
      const distanceTowardTarget = direction > 0 ? -gesture.deltaY : gesture.deltaY;
      const velocityTowardTarget = direction > 0 ? -gesture.velocityY : gesture.velocityY;
      const committed = moved
        && (distanceTowardTarget >= size * .16 || velocityTowardTarget >= .32)
        && (adjustsSelection
          ? queueBookmarkSelectionRestore(
            direction,
            handlePoint,
            gesture.scrollStart,
            Number.isFinite(gesture.pageClientX) && Number.isFinite(gesture.pageClientY)
              ? { clientX: gesture.pageClientX, clientY: gesture.pageClientY }
              : null,
          )
          : true);
      return { moved, committed, dir: direction };
    };
    const cancelBookmarkPageGesture = gesture => {
      if (!gesture) return;
      gesture.scrollCancelled = true;
      if (gesture.kind === 'paged' && gesture.active) pager.cancel();
    };
    state.bookmarkSelectionPageTurn = turnBookmarkSelectionPage;
    const chooseBookmarkMovingEndpoint = endpoint => {
      const model = state.bookmarkSelectionModel;
      if (!model || model.doc !== doc) return false;
      bookmarkModelRange(model);
      const wantsStart = endpoint === 'start';
      if (model.movingStart !== wantsStart) {
        const fixedNode = model.fixedNode;
        const fixedOffset = model.fixedOffset;
        model.fixedNode = model.movingNode;
        model.fixedOffset = model.movingOffset;
        model.movingNode = fixedNode;
        model.movingOffset = fixedOffset;
        bookmarkModelRange(model);
        applyBookmarkSelectionModel();
      }
      return true;
    };
    state.bookmarkHandleController = {
      render: renderBookmarkHandle,
      hide: hideBookmarkHandle,
      start: event => {
        if (!state.bookmarkSelecting) return;
        const changed = Array.from(event.changedTouches || []);
        const held = state.bookmarkHeldHandle;
        if (held?.source === 'custom') {
          const pageTouch = changed.find(point => point.identifier !== held.id);
          if (!pageTouch || state.bookmarkOuterPageGesture) return;
          const { x, y } = touchCoordinates(pageTouch);
          const gesture = beginBookmarkPageGesture(x, y, event.timeStamp);
          const heldPoint = heldHandleContentPoint(held);
          rememberBookmarkPageTouch(gesture, pageTouch, false);
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
        const model = state.bookmarkSelectionModel;
        if (!model?.managed || model.doc !== doc) return;
        const handle = event.target?.closest?.('.bookmark-selection-handle');
        const point = changed[0];
        if (!handle || !point || !chooseBookmarkMovingEndpoint(handle.dataset.endpoint)) return;
        const handleRect = handle.getBoundingClientRect();
        state.bookmarkHeldHandle = {
          id: point.identifier,
          source: 'custom',
          endpoint: handle.dataset.endpoint,
          clientX: point.clientX,
          clientY: point.clientY,
          caretOffsetX: handleRect.left + 22 - point.clientX,
          caretOffsetY: handleRect.top + 8 - point.clientY,
        };
        event.preventDefault();
        event.stopImmediatePropagation();
        globalThis.navigator?.vibrate?.(8);
      },
      move: event => {
        const held = state.bookmarkHeldHandle;
        const pageGesture = state.bookmarkOuterPageGesture;
        if (pageGesture) {
          const pageTouch = Array.from(event.touches || []).find(point => point.identifier === pageGesture.id);
          if (pageTouch && pageGesture.gesture) {
            const { x, y } = touchCoordinates(pageTouch);
            rememberBookmarkPageTouch(pageGesture.gesture, pageTouch, false);
            moveBookmarkPageGesture(pageGesture.gesture, x, y, event.timeStamp);
          }
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (held?.source !== 'custom') return;
        const touchPoint = Array.from(event.touches || []).find(point => point.identifier === held.id);
        if (!touchPoint) return;
        held.clientX = touchPoint.clientX;
        held.clientY = touchPoint.clientY;
        const contentPoint = heldHandleContentPoint(held);
        const visible = state.visibleRange;
        const model = state.bookmarkSelectionModel;
        if (contentPoint && visible && model?.doc === doc) {
          const point = caretPointAt(visible, contentPoint.clientX, contentPoint.clientY, model.movingStart ? -1 : 1);
          if (point) moveBookmarkSelectionTo(point);
        }
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      end: event => {
        const held = state.bookmarkHeldHandle;
        const changed = Array.from(event.changedTouches || []);
        const pageGesture = state.bookmarkOuterPageGesture;
        if (pageGesture && changed.some(point => point.identifier === pageGesture.id)) {
          const pageTouch = c`;

