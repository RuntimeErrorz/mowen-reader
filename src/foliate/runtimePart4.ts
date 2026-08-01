export const FOLIATE_BRIDGE_PART_4 = String.raw`mViewport = (clientX, clientY) => {
      const renderer = state.view?.renderer;
      const rect = renderer?.getBoundingClientRect?.();
      if (!renderer || !rect || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
      if (renderer.scrollProp === 'scrollLeft')
        return { clientX: clientX - rect.left + rendererPageOffset(renderer), clientY: clientY - rect.top };
      return { clientX: clientX - rect.left, clientY: clientY - rect.top + rendererPageOffset(renderer) };
    };
    const heldHandleContentPoint = held => {
      if (!held) return null;
      const clientX = held.clientX + (held.caretOffsetX || 0);
      const clientY = held.clientY + (held.caretOffsetY || 0);
      return held.source === 'custom'
        ? contentPointFromViewport(clientX, clientY)
        : { clientX, clientY };
    };
    const viewportPointFromContent = point => {
      const renderer = state.view?.renderer;
      const rect = renderer?.getBoundingClientRect?.();
      if (!renderer || !rect || !point) return null;
      if (renderer.scrollProp === 'scrollLeft')
        return { clientX: rect.left + point.clientX - rendererPageOffset(renderer), clientY: rect.top + point.clientY, rect };
      return { clientX: rect.left + point.clientX, clientY: rect.top + point.clientY - rendererPageOffset(renderer), rect };
    };
    const rememberBookmarkPageTouch = (gesture, point, fromInnerDocument) => {
      if (!gesture || !point) return;
      const viewport = fromInnerDocument
        ? viewportPointFromContent({ clientX: point.clientX, clientY: point.clientY })
        : point;
      if (!viewport) return;
      gesture.pageClientX = viewport.clientX;
      gesture.pageClientY = viewport.clientY;
    };
    const hideBookmarkHandle = () => {
      for (const handle of document.querySelectorAll('.bookmark-selection-handle'))
        handle.classList.remove('visible');
    };
    const placeBookmarkHandle = (handle, point, followsPage) => {
      const viewport = viewportPointFromContent(point);
      const renderer = state.view?.renderer;
      const held = state.bookmarkHeldHandle?.source === 'custom'
        && state.bookmarkHeldHandle.endpoint === handle?.dataset?.endpoint
        ? state.bookmarkHeldHandle
        : null;
      // renderer.getBoundingClientRect() already contains the current page
      // surface transform. Unheld handles therefore need no extra offset;
      // a held handle stays under its finger while the other finger moves the
      // page, so use its live touch position instead of the content rect.
      const dragOffset = followsPage ? 0 : -state.bookmarkPageDragOffset;
      const clientX = held
        ? held.clientX + (held.caretOffsetX || 0)
        : viewport?.clientX + (renderer?.scrollProp === 'scrollLeft' ? dragOffset : 0);
      const clientY = held
        ? held.clientY + (held.caretOffsetY || 0)
        : viewport?.clientY + (renderer?.scrollProp === 'scrollLeft' ? 0 : dragOffset);
      if (
        !viewport
        || clientX < viewport.rect.left - 12
        || clientX > viewport.rect.right + 12
        || clientY < viewport.rect.top - 12
        || clientY > viewport.rect.bottom + 12
      ) {
        handle?.classList.remove('visible');
        return false;
      }
      handle.style.transform = 'translate3d(' + (clientX - 22) + 'px,' + (clientY - 8) + 'px,0)';
      handle.classList.add('visible');
      return true;
    };
    const renderBookmarkHandle = () => {
      const model = state.bookmarkSelectionModel;
      const range = bookmarkModelRange(model);
      const startHandle = document.getElementById('bookmark-selection-handle-start');
      const endHandle = document.getElementById('bookmark-selection-handle-end');
      if (!state.bookmarkSelecting || !model?.managed || !range || !startHandle || !endHandle) {
        hideBookmarkHandle();
        return false;
      }
      const points = selectionHandlePoints(range);
      if (!points) { hideBookmarkHandle(); return false; }
      const heldEndpoint = state.bookmarkHeldHandle?.endpoint;
      const startVisible = placeBookmarkHandle(startHandle, points.start, heldEndpoint !== 'start');
      const endVisible = placeBookmarkHandle(endHandle, points.end, heldEndpoint !== 'end');
      return startVisible || endVisible;
    };
    const moveBookmarkSelectionTo = point => {
      const model = state.bookmarkSelectionModel;
      if (!model || model.doc !== doc || !point?.node?.isConnected) return false;
      model.movingNode = point.node;
      model.movingOffset = point.offset;
      if (!applyBookmarkSelectionModel()) return false;
      renderBookmarkHandle();
      return true;
    };
    const beginCustomBookmarkSelection = initialTouch => {
      const visible = state.visibleRange;
      const point = visible ? caretPointAt(visible, initialTouch.clientX, initialTouch.clientY, 1) : null;
      const value = point?.node?.nodeValue || '';
      if (!point || !value) return false;
      let start = Math.max(0, Math.min(value.length - 1, point.offset === value.length ? point.offset - 1 : point.offset));
      let end = Math.min(value.length, start + 1);
      try {
        const Segmenter = doc.defaultView?.Intl?.Segmenter;
        if (Segmenter) {
          const segments = new Segmenter(doc.documentElement.lang || 'zh', { granularity: 'word' }).segment(value);
          for (const segment of segments) {
            const from = segment.index;
            const to = from + segment.segment.length;
            if (start >= from && start < to && /\S/u.test(segment.segment)) {
              start = from;
              end = to;
              break;
            }
          }
        }
      } catch {}
      const fixedRange = doc.createRange();
      fixedRange.setStart(point.node, start);
      fixedRange.setEnd(point.node, end);
      const points = selectionHandlePoints(fixedRange);
      state.bookmarkSelectionModel = {
        doc,
        index,
        fixedNode: point.node,
        fixedOffset: start,
        movingNode: point.node,
        movingOffset: end,
        movingStart: false,
        managed: true,
      };
      applyBookmarkSelectionModel();
      renderBookmarkHandle();
      const endPoint = points?.end;
      state.bookmarkHeldHandle = {
        id: initialTouch.id,
        source: 'native',
        endpoint: 'end',
        clientX: initialTouch.clientX,
        clientY: initialTouch.clientY,
        caretOffsetX: endPoint ? endPoint.clientX - initialTouch.clientX : 0,
        caretOffsetY: endPoint ? endPoint.clientY - initialTouch.clientY : 0,
      };
      globalThis.navigator?.vibrate?.(20);
      return true;
    };
    const prepareBookmarkSelectionRestore = (direction, reportedHandlePoint, scrolledStartOverride, reportedPageViewportPoint) => {
      if (!state.bookmarkSelecting || state.bookmarkPageTurning) return null;
      const model = state.bookmarkSelectionModel?.doc === doc ? state.bookmarkSelectionModel : null;
      const selection = doc.getSelection?.();
      if (!model && (!selection?.rangeCount || selection.getRangeAt(0).collapsed)) return null;
      const renderer = state.view?.renderer;
      if (!renderer) return null;
      if (renderer.scrolled) {
        const atBoundary = direction < 0
          ? renderer.start <= 2
          : renderer.viewSize - renderer.end <= 2;
        if (atBoundary) return null;
      } else if (direction < 0 ? renderer.page <= 1 : renderer.page >= renderer.pages - 2) return null;
      const selectedRange = model ? bookmarkModelRange(model) : selection.getRangeAt(0).cloneRange();
      if (!selectedRange || selectedRange.collapsed) return null;
      const handles = selectionHandlePoints(selectedRange);
      const horizontal = renderer.scrollProp === 'scrollLeft';
      // In scrolled flow the second finger's viewport position is the target
      // for the moving endpoint. Paginated flow keeps the held-handle point
      // for its page-local coordinate sy`;

