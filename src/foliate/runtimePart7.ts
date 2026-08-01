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
      const image = target?.closest?.('img');
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

