export const FOLIATE_BRIDGE_PART_10 = String.raw`efaultView?.clearTimeout(bookmarkSelectionTimer);
        bookmarkSelectionTimer = 0;
        bookmarkSelectionTouch = null;
        event.stopImmediatePropagation();
        return;
      }
      if (bookmarkShortcut) {
        bookmarkShortcut = false;
        event.stopImmediatePropagation();
        return;
      }
      if (state.bookmarkSelecting) {
        const held = state.bookmarkHeldHandle;
        if (held?.source === 'native' && Array.from(event.changedTouches).some(point => point.identifier === held.id))
          state.bookmarkHeldHandle = null;
        if (state.bookmarkSelectionModel?.doc === doc) {
          applyBookmarkSelectionModel();
          renderBookmarkHandle();
        }
        if (state.config?.prefs.readingMode === 'scroll' && !held) return;
        event.stopImmediatePropagation();
        return;
      }
      clearLongPress();
      touch = null;
      state.scrollIntentDir = 0;
      state.scrollIntentUntil = 0;
      pager.cancel();
    }, { passive: true, capture: true });
    doc.addEventListener('click', event => {
      if (state.bookmarkSelecting) return;
      if (Date.now() < suppressClickUntil || event.defaultPrevented) return;
      const image = imageFromEvent(event);
      const noteImage = image && isNoteLink(image.closest?.('a[href]'));
      if (noteImage) return;
      if (image && !noteImage) {
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressClickUntil = Date.now() + 700;
        openImageViewer(image);
        return;
      }
      if (interactive(event.target)) return;
      const x = event.screenX || (((event.clientX % (state.view?.renderer?.size || screenWidth())) + screenWidth()) % screenWidth());
      handleTap(x);
    }, true);
    doc.addEventListener('selectstart', event => {
      if (state.bookmarkSelecting) event.preventDefault();
    }, { capture: true });
    doc.addEventListener('contextmenu', event => {
      if (state.bookmarkSelecting) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (longPressBlocked(event.target)) return;
      event.preventDefault();
      suppressClickUntil = Date.now() + 700;
      void emitLongPress(event.target);
    }, false);
    doc.addEventListener('selectionchange', () => {
      if (!state.bookmarkSelecting) return;
      if (selectionTimer) doc.defaultView?.clearTimeout(selectionTimer);
      selectionTimer = doc.defaultView?.setTimeout(() => {
        selectionTimer = 0;
        let selection = doc.getSelection?.();
        let model = state.bookmarkSelectionModel;
        if (!model && selection?.rangeCount && !selection.getRangeAt(0).collapsed) {
          const range = selection.getRangeAt(0);
          model = state.bookmarkSelectionModel = {
            doc,
            index,
            fixedNode: range.startContainer,
            fixedOffset: range.startOffset,
            movingNode: range.endContainer,
            movingOffset: range.endOffset,
            movingStart: false,
            managed: true,
          };
          applyBookmarkSelectionModel();
          renderBookmarkHandle();
          selection = doc.getSelection?.();
        }
        if (model?.managed && model.doc === doc && !selectionMatchesBookmarkModel(selection)) {
          applyBookmarkSelectionModel();
          renderBookmarkHandle();
          selection = doc.getSelection?.();
        }
        if (!selection?.rangeCount) {
          send({ type: 'bookmark-selection', cfi: '', sectionIndex: index, text: '' });
          return;
        }
        const range = selection.getRangeAt(0);
        const text = selection.toString().replace(/\s+/g, ' ').trim();
        if (range.collapsed || !text) {
          send({ type: 'bookmark-selection', cfi: '', sectionIndex: index, text: '' });
          return;
        }
        let cfi = '';
        try { cfi = state.view?.getCFI?.(index, range) || ''; } catch {}
        if (cfi) send({ type: 'bookmark-selection', cfi, sectionIndex: index, text: text.slice(0, 4000) });
        renderBookmarkHandle();
      }, 120) || 0;
    });
  };
  const isNoteLink = anchor => {
    if (!anchor?.getAttribute) return false;
    const href = anchor.getAttribute('href') || '';
    if (!href.includes('#')) return false;
    const type = anchor?.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type') || '';
    const role = anchor?.getAttribute?.('role') || '';
    const classes = (anchor.getAttribute('class') || '') + ' ' + (anchor.getAttribute('id') || '');
    const marker = (anchor.textContent || '').replace(/\s+/g, '').trim();
    const semantic = /(?:doc-)?(?:note|gloss|biblio)ref/i.test(type + ' ' + role);
    const named = /(?:^|[\s_-])(footnote|endnote|note|noteref|fn|ref|jzyy)(?:[\s_-]|$)/i.test(classes);
    const numbered = /^[（(\[]?[0-9一二三四五六七八九十百]+[）)\].、]?$/u.test(marker);
    return semantic || named || (numbered && (!!anchor.querySelector('sup') || anchor.parentElement?.tagName?.toLowerCase() === 'sup'));
  };
  const noteBlock = (node, source) => {
    if (node?.nodeType === 3) node = node.parentElement;
    if (node?.startContainer) node = node.startContainer.nodeType === 3 ? node.startContainer.parentElement : node.startContainer;
    const inline = 'a,span,sup,sub,em,strong,i,b,small,big';
    while (node?.matches?.(inline) && node.parentElement && node.parentElement !== source.body) node = node.parentElement;
    return node?.closest?.('li,p,aside,blockquote,dd,dt,section,div') || node;
  };
  const noteIsOpen = () => document.getElementById('note-backdrop')?.classList.contains('open') ?? false;
  const imageViewerIsOpen = () => document.getElementById('image-viewer')?.classList.contains('open') ?? false;
  const emitNavigationState = () => send({
    type: 'navigation-state',
    canGoBack: noteIsOpen() || imageViewerIsOpen() || !!state.view?.history?.canGoBack,
    noteOpen: noteIsOpen(),
    imageOpen: imageViewerIsOpen(),
  });
  const showNote = (fragment, marker) => {
    const article = document.createElement('article');
    article.appendChild(document.importNode(fragment, true));
    article.querySelectorAll('script,style,[role="doc-backlink"],[epub\\:type~="backlink"]').forEach(element => element.remove());
    article.querySelectorAll('a[href]').forEach(element => element.removeAttribute('href'));
    const content = document.getElementById('note-content');
    content.replaceChildren(article);
    document.getElementById('note-title').textContent = marker ? '注释 ' + marker : '注释';
    document.getElementById('note-backdrop').classList.add('open');
    emitNavigationState();
  };
  const showNoteError = (marker, message) => {
    const text = document.createElement('p');
    text.textContent = message || '无法显示这条注释的内容';
    document.getElementById('note-content').replaceChildren(text);
    document.getElementById('note-title').textContent = marker ? '注释 ' + marker : '注释';
    document.getElementById('note-backdrop').classList.add('open');
    emitNavigationState();
  };
  const isBacklink = anchor => {
    const type = anchor?.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type') || '';
    const role = anchor?.getAttribute?.('role') || '';
    const classes = (anchor?.getAttribute?.('class') || '') + ' ' + (anchor?.getAttribute?.('id') || '');
    return /(?:doc-)?backlink/i.test(type + ' ' + role)
      || /(?:^|[\s_-])(backlink|backref|return)(?:[\s_-]|$)/i.test(classes);
  };
  const setupFootnotes = view => {
    view.addEventListener('link', event => {
      const { a, href } = event.detail || {};
      const note = isNoteLink(a);
      if (!note && isBacklink(a) && view.history?.canGoBack) {
        event.preventDefault();
        view.history.back();
        return;
      }
      if (!note) return;
      event.preventDefault();
      const rawHref = a?.getAttribute?.('href') || '';
      const markerText = (a?.textContent || '').replace(/\s+/g, ' ').trim()
        || (String(rawHref).split('#').pop()?.match(/[0-9一二三四五六七八九十百]+/u)?.[0] || '');
      Promise.resolve(view.book.resolveHref(href || rawHref)).then(async target => {
        if (!target || target.index == null) throw new Error('无法定位注释内容');
        const source = await view.book.sections[target.index]?.createDocument?.();
        if (!source) throw new Error('无法读取注释所在章节');
        let node = target.anchor?.(source);
        let fragment;
        if (node?.cloneContents && !node.collapsed) {
          const ranged = node.cloneContents();
          if (ranged.textContent`;

