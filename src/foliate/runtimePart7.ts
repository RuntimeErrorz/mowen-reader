export const FOLIATE_BRIDGE_PART_7 = String.raw`hanged.find(point => point.identifier === pageGesture.id);
          if (pageTouch && pageGesture.gesture) {
            const { x, y } = touchCoordinates(pageTouch);
            rememberBookmarkPageTouch(pageGesture.gesture, pageTouch, false);
            moveBookmarkPageGesture(pageGesture.gesture, x, y, event.timeStamp);
          }
          state.bookmarkOuterPageGesture = null;
          if (pageGesture.gesture) endBookmarkPageGesture(pageGesture.gesture, heldHandleContentPoint(held));
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (held?.source !== 'custom') return;
        if (!changed.some(point => point.identifier === held.id)) return;
        if (state.bookmarkOuterPageGesture) cancelBookmarkPageGesture(state.bookmarkOuterPageGesture.gesture);
        state.bookmarkOuterPageGesture = null;
        state.bookmarkHeldHandle = null;
        event.preventDefault();
        event.stopImmediatePropagation();
        renderBookmarkHandle();
      },
      cancel: event => {
        const held = state.bookmarkHeldHandle;
        if (state.bookmarkOuterPageGesture) {
          cancelBookmarkPageGesture(state.bookmarkOuterPageGesture.gesture);
          state.bookmarkOuterPageGesture = null;
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (held?.source !== 'custom') return;
        state.bookmarkHeldHandle = null;
        event.preventDefault();
        event.stopImmediatePropagation();
        renderBookmarkHandle();
      },
    };
    const readableBlock = target => target?.closest?.('p,li,blockquote,h1,h2,h3,h4,h5,h6,dd,dt,figcaption');
    const visibleSelectionRange = range => {
      const visible = state.visibleRange;
      const RangeType = doc.defaultView?.Range;
      if (!visible || !RangeType || visible.startContainer?.ownerDocument !== doc) return range;
      try {
        if (
          range.compareBoundaryPoints(RangeType.START_TO_END, visible) <= 0
          || range.compareBoundaryPoints(RangeType.END_TO_START, visible) >= 0
        ) return range;
        const clipped = doc.createRange();
        if (range.compareBoundaryPoints(RangeType.START_TO_START, visible) < 0)
          clipped.setStart(visible.startContainer, visible.startOffset);
        else clipped.setStart(range.startContainer, range.startOffset);
        if (range.compareBoundaryPoints(RangeType.END_TO_END, visible) > 0)
          clipped.setEnd(visible.endContainer, visible.endOffset);
        else clipped.setEnd(range.endContainer, range.endOffset);
        return clipped.collapsed ? range : clipped;
      } catch {
        return range;
      }
    };
    const blobDataURL = blob => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(reader.error || new Error('无法读取图片'));
      reader.readAsDataURL(blob);
    });
    const imageDataOf = async image => {
      const src = image?.currentSrc || image?.src || '';
      if (src.startsWith('data:image/')) return src;
      if (src) {
        try {
          const response = await fetch(src);
          const blob = await response.blob();
          if (blob.type.startsWith('image/')) return await blobDataURL(blob);
        } catch {}
      }
      // Some Android WebView versions cannot fetch a blob URL from a nested
      // EPUB document even though the image is already decoded on screen.
      try {
        await image?.decode?.();
        const width = image?.naturalWidth || image?.width;
        const height = image?.naturalHeight || image?.height;
        if (!width || !height) return '';
        const canvas = doc.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d')?.drawImage(image, 0, 0, width, height);
        return canvas.toDataURL('image/png');
      } catch { return ''; }
    };
    const emitLongPress = async target => {
      // Foliate treats any selection created between pointerdown and pointerup
      // as an actively dragged selection and turns the page when it crosses the
      // visible range. This selection is created by our long-press action, so
      // end that pointer-selection state before setting the programmatic range.
      try {
        const EventType = doc.defaultView?.Event;
        if (EventType) doc.dispatchEvent(new EventType('pointerup'));
      } catch {}
      const image = imageFromTarget(target);
      const noteAnchor = image?.closest?.('a[href]');
      if (image && isNoteLink(noteAnchor)) {
        suppressClickUntil = 0;
        noteAnchor.click?.();
        return true;
      }
      if (image) {
        const range = doc.createRange();
        range.selectNode(image);
        const selection = doc.getSelection?.();
        selection?.removeAllRanges?.();
        selection?.addRange?.(range);
        let cfi = '';
        try { cfi = state.view?.getCFI?.(index, range) || ''; } catch {}
        const figure = image.closest?.('figure');
        const text = (image.getAttribute('alt') || figure?.querySelector?.('figcaption')?.textContent || '插图').replace(/\s+/g, ' ').trim();
        const imageData = await imageDataOf(image);
        if (!imageData) {
          send({ type: 'long-press', cfi, sectionIndex: index, text, kind: 'image' });
          return true;
        }
        const transferId = 'image-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        // Open the AI panel immediately, then transfer the potentially large
        // data URL in small bridge messages so Android does not drop it.
        send({ type: 'long-press', cfi, sectionIndex: index, text, kind: 'image', imageTransferId: transferId });
        send({ type: 'image-transfer-start', transferId });
        const chunkSize = 128 * 1024;
        for (let offset = 0; offset < imageData.length; offset += chunkSize) {
          send({ type: 'image-transfer-chunk', transferId, chunk: imageData.slice(offset, offset + chunkSize) });
          await new Promise(resolve => doc.defaultView?.setTimeout(resolve, 0));
        }
        send({ type: 'image-transfer-end', transferId });
        return true;
      }
      const block = readableBlock(target);
      if (!block) return false;
      const selection = doc.getSelection?.();
      const range = doc.createRange();
      range.selectNodeContents(block);
      const text = block.textContent?.replace(/\s+/g, ' ').trim() || '';
      if (!text) return false;
      const selectedRange = visibleSelectionRange(range);
      selection?.removeAllRanges?.();
      selection?.addRange?.(selectedRange);
      let cfi = '';
      try { cfi = state.view?.getCFI?.(index, selectedRange) || ''; } catch {}
      send({ type: 'long-press', cfi, sectionIndex: index, text: text.slice(0, 1600), kind: 'text' });
      return true;
    };
    const ensureImageViewer = () => {
      const root = document.getElementById('image-viewer');
      const surface = document.getElementById('image-viewer-surface');
      const image = document.getElementById('image-viewer-image');
      if (!root || !surface || !image) return null;
      if (root.__mowenImageViewer) return root.__mowenImageViewer;
      const viewer = {
        root,
        surface,
        image,
        scale: 1,
        panX: 0,
        panY: 0,
        mode: '',
        startX: 0,
        startY: 0,
        startPanX: 0,
        startPanY: 0,
        startScale: 1,
        pinchDistance: 0,
        startMidpoint: null,
        moved: false,
        lastTapAt: 0,
        token: 0,
      };
      const touchPoint = touch => ({ x: Number(touch?.clientX) || 0, y: Number(touch?.clientY) || 0 });
      const midpoint = (first, second) => ({ x: (first.clientX + second.clientX) / 2, y: (first.clientY + second.clientY) / 2 });
      const distance = (first, second) => Math.max(1, Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY));
      const render = () => {
        viewer.scale = Math.max(1, Math.min(4, viewer.scale));
        const imageWidth = image.offsetWidth || image.clientWidth || surface.clientWidth;
        const imageHeight = image.offsetHeight || image.clientHeight || surface.clientHeight;
        const limitX = Math.max(0, (imageWidth * viewer.scale - surface.clientWidth) / 2 + 64);
        const limitY = Math.max(0, (imageHeight * viewer.scale - surface.clientHeight) / 2 + 64);
        viewer.panX = Math.max(-limitX, Math.min(limitX, viewer.panX));
        viewer.panY = Math.max(-limitY, Math.min(limitY, viewer.panY));
        image.style.transform = 'translate3d(' + viewer.panX + 'px,' + viewer.panY + 'px,0) scale(' + viewer.scale + ')';
      };
      const close = () => {
        viewer.token++;
        viewer.mode = '';
        root.classList.remove('open');
        root.setAttribute('aria-hidden', 'true');
        image.removeAttribute('src');
        emitNavigationState();
      };
      const toggleZoom = () => {
        viewer.scale = viewer.scale > 1.05 ? 1 : 2;
        if (viewer.scale === 1) { viewer.panX = 0; viewer.panY = 0; }
        render();
      };
      surface.addEventListener('touchstart', event => {
        if (!root.classList.contains('open')) return;
        event.preventDefault();
        event.stopPropagation();
        const touches = Array.from(event.touches || []);
        if (touches.length >= 2) {
          viewer.mode = 'pinch';
          viewer.pinchDistance = distance(touches[0], touches[1]);
          viewer.startScale = viewer.scale;
          viewer.startMidpoint = midpoint(touches[0], touches[1]);
          viewer.startPanX = viewer.panX;
          viewer.startPanY = viewer.panY;
          viewer.moved = true;
          return;
        }
        const point = touches[0];
        if (!point) return;
        const start = touchPoint(point);
        viewer.mode = viewer.scale > 1.01 ? 'pan' : 'tap';
        viewer.startX = start.x;
        viewer.startY = start.y;
        viewer.startPanX = viewer.panX;
        viewer.startPanY = viewer.panY;
        viewer.moved = false;
      }, { passive: false });
      surface.addEventListener('touchmove', event => {
        if (!root.classList.contains('open')) return;
        event.preventDefault();
        event.stopPropagation();
        const touches = Array.from(event.touches || []);
        if (touches.length >= 2 && viewer.mode === 'pinch') {
          const center = midpoint(touches[0], touches[1]);
          viewer.scale = viewer.startScale * distance(touches[0], touches[1]) / viewer.pinchDistance;
          viewer.panX = viewer.startPanX + center.x - viewer.startMidpoint.x;
          viewer.panY = viewer.startPanY + center.y - viewer.startMidpoint.y;
          render();
          return;
        }
        if (touches.length !== 1) return;
        const point = touchPoint(touches[0]);
        if (Math.hypot(point.x - viewer.startX, point.y - viewer.startY) > 8) viewer.moved = true;
        if (viewer.mode === 'pan') {
          viewer.panX = viewer.startPanX + point.x - viewer.startX;
          viewer.panY = viewer.startPanY + point.y - viewer.startY;
          render();
        }
      }, { passive: false });
      surface.addEventListener('touchend', event => {
        if (!root.classList.contains('open')) return;
        event.preventDefault();
        event.stopPropagation();
        const touches = Array.from(event.touches || []);
        if (touches.length >= 2) return;
        if (touches.length === 1) {
          const point = touchPoint(touches[0]);
          viewer.mode = viewer.scale > 1.01 ? 'pan' : 'tap';
          viewer.startX = point.x;
          viewer.startY = point.y;
          viewer.startPanX = viewer.panX;
          viewer.startPanY = viewer.panY;
          return;
        }
        if (viewer.mode === 'tap' && !viewer.moved) {
          if (event.target === surface) { close(); return; }
          const now = Date.now();
          if (now - viewer.lastTapAt < 320) toggleZoom();
          viewer.lastTapAt = now;
        }
        viewer.mode = '';
      }, { passive: false });
      surface.addEventListener('touchcancel', event => {
        event.preventDefault();
        viewer.mode = '';
      }, { passive: false });
      surface.addEventListener('click', event => {
        if (event.target === surface) close();
      });
      image.addEventListener('dblclick', event => {
        event.preventDefault();
        event.stopPropagation();
        toggleZoom();
      });
      image.addEventListener('load', render);
      viewer.close = close;
      root.__mowenImageViewer = viewer;
      return viewer;
    };
    const openImageViewer = image => {
      const viewer = ensureImageViewer();
      const source = image?.currentSrc || image?.src || '';
      if (!viewer || !source) return false;
      const token = ++viewer.token;
      viewer.scale = 1;
      viewer.panX = 0;
      viewer.panY = 0;
      viewer.lastTapAt = 0;
      viewer.image.alt = image.getAttribute?.('alt') || '正文图片';
      viewer.image.src = source;
      viewer.root.classList.add('open');
      viewer.root.setAttribute('aria-hidden', 'false');
      viewer.image.style.transform = 'translate3d(0,0,0) scale(1)';
      emitNavigationState();
      void imageDataOf(image).then(data => {
        if (data && viewer.token === token && viewer.root.classList.contains('open')) viewer.image.src = data;
      }).catch(() => {});
      return true;
    };
    const handleTap = screenX => {
      if (state.config?.prefs.readingMode === 'scroll') { send({ type: 'center-tap' }); return; }
      const ratio = screenX / screenWidth();
      const action = ratio < .3 ? 'previous' : ratio > .7 ? 'next' : 'menu';
      if (action === 'previous') pager.turn(-1);
      else if (action === 'next') pager.turn(1);
      else send({ type: 'center-tap' });
    };
    doc.addEventListener('touchstart', event => {
      if (!state.bookmarkSelecting && event.touches.length === 2) {
        bookmarkShortcut = true;
        event.preventDefault();
        event.stopImmediatePropagation();
        globalThis.navigator?.vibrate?.(20);
        setBookmarkSelecting(true);
        return;
      }
      if (state.bookmarkSelecting) {
        // Android may drop the native DOM range as soon as the second finger
        // lands. The held custom/native handle is the reliable signal that
        // this touch is the page gesture, so do not require activeRange here.
        const heldHandle = state.bookmarkHeldHandle;
        const pageTouch = event.changedTouches[event.changedTouches.length - 1];
        if (heldHandle && pageTouch && pageTouch.`;

