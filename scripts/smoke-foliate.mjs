import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const epubPath = process.argv[2];
if (!epubPath) throw new Error('Usage: npm run smoke:foliate -- <book.epub>');

const FOLIATE_BRIDGE_PART_COUNT = 12;
const runtime = await readFile(new URL('../src/foliate/runtime.ts', import.meta.url), 'utf8');
const generated = await readFile(new URL('../src/generated/foliateBundle.ts', import.meta.url), 'utf8');
const html = runtime.match(/export const FOLIATE_HTML = `([\s\S]*?)`;/)?.[1];
const bridgePartSources = await Promise.all(Array.from({ length: FOLIATE_BRIDGE_PART_COUNT }, (_value, index) => readFile(new URL(`../src/foliate/runtimePart${index}.ts`, import.meta.url), 'utf8')));
const bridge = bridgePartSources.map((source) => source.match(/String\.raw`([\s\S]*?)`;\s*$/)?.[1] ?? '').join('');
const bundleSource = generated.match(/export const FOLIATE_BUNDLE = ([\s\S]*);\s*$/)?.[1];
if (!html || !bridge || !bundleSource) throw new Error('Could not extract the generated Foliate runtime');

const bundle = JSON.parse(bundleSource);
const base64 = (await readFile(epubPath)).toString('base64');
const chunks = [];
for (let offset = 0; offset < base64.length; offset += 256 * 1024) chunks.push(base64.slice(offset, offset + 256 * 1024));
const config = {
  prefs: {
    readingMode: 'paged', fontSize: 24, lineHeight: 1.4, theme: 'wheat', fontStyle: 'sans',
    pagePadding: 24, pagePaddingTop: 8, pagePaddingRight: 24, pagePaddingBottom: 36, pagePaddingLeft: 24,
    paragraphSpacing: 24, firstLineIndent: false, textAlign: 'justify',
  },
  palette: { bg: '#F0DEB7', text: '#211A12', muted: '#776851', line: '#D3BA8D', accent: '#A95D2D', focus: '#E5C994' },
};
const directory = await mkdtemp(join(tmpdir(), 'mowen-foliate-smoke-'));
const testPath = join(directory, 'index.html');
await writeFile(testPath, html);

const browserCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
let browserPath;
for (const browser of browserCandidates) {
  try { await access(browser); browserPath = browser; break; } catch { /* try the next browser */ }
}
if (!browserPath) throw new Error('Chrome or Edge is required for the Foliate smoke test');

const port = 12000 + Math.floor(Math.random() * 20000);
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
  `--remote-debugging-port=${port}`, `--user-data-dir=${join(directory, 'profile')}`,
  pathToFileURL(testPath).href,
], { stdio: 'ignore' });
let socket;
try {
  const browserDeadline = Date.now() + 45_000;
  let target;
  while (Date.now() < browserDeadline) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
      target = pages.find(page => page.type === 'page' && page.url.startsWith('file:'));
      if (target) break;
    } catch { /* Chromium is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!target) throw new Error('Could not connect to headless Chromium');

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let commandId = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    pending.get(message.id)(message);
    pending.delete(message.id);
  });
  const evaluate = (expression, timeout = 5000) => new Promise((resolve, reject) => {
    const id = ++commandId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Chromium evaluation timed out')); }, timeout);
    pending.set(id, message => {
      clearTimeout(timer);
      if (message.result?.exceptionDetails) reject(new Error(message.result.exceptionDetails.exception?.description || message.result.exceptionDetails.text));
      else resolve(message.result?.result?.value);
    });
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  });

  await evaluate(`document.readyState==='complete'||new Promise(resolve=>globalThis.addEventListener('load',resolve,{once:true}))`);
  const shellReady = await evaluate(`!!document.getElementById('reader-shell')&&!!document.getElementById('note-close')`);
  if (!shellReady) {
    const pageState = await evaluate(`JSON.stringify({url:location.href,ready:document.readyState,body:document.body?.innerHTML?.slice(0,300)})`);
    throw new Error(`Smoke page did not load the reader shell: ${pageState}`);
  }
  await evaluate(`globalThis.ReactNativeWebView={postMessage(raw){const message=JSON.parse(raw);document.documentElement.dataset.lastMessage=message.type;if(message.type==='book-ready')document.documentElement.dataset.foliate='ready';if(message.type==='relocate')document.documentElement.dataset.relocate=String(message.position)+'/'+String(message.totalPositions);if(message.type==='error')document.documentElement.dataset.error=message.message;}};true;`);
  await evaluate(bundle, 15_000);
  await evaluate(bridge, 15_000);
  for (const chunk of chunks) await evaluate(`globalThis.__MOWEN__.appendChunk(${JSON.stringify(chunk)});true;`);
  await evaluate(`globalThis.__MOWEN__.open(${JSON.stringify({ name: 'smoke.epub', initialProgress: 0, config })})`, 45_000);

  let state = {};
  const readyDeadline = Date.now() + 45_000;
  while (Date.now() < readyDeadline) {
    const value = await evaluate('JSON.stringify({...document.documentElement.dataset})');
    state = value ? JSON.parse(value) : {};
    if (state.error || state.foliate === 'ready' && state.relocate) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (state.error || state.foliate !== 'ready' || !state.relocate) {
    throw new Error(state.error || `Foliate did not become ready (last message: ${state.lastMessage || 'none'})`);
  }
  let pagerState = {};
  const pagerDeadline = Date.now() + 15_000;
  while (Date.now() < pagerDeadline) {
    pagerState = JSON.parse(await evaluate(`JSON.stringify(globalThis.__MOWEN__.pagerStatus())`));
    if (pagerState.nextReady) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!pagerState.nextReady) throw new Error('Foliate next-page preview did not become ready');
  const previousLocation = state.relocate;
  const previousCfi = pagerState.currentCfi;
  await evaluate(`globalThis.__MOWEN__.next();true`);
  const turnDeadline = Date.now() + 15_000;
  while (Date.now() < turnDeadline) {
    const value = await evaluate(`JSON.stringify({...document.documentElement.dataset,pager:globalThis.__MOWEN__.pagerStatus()})`);
    state = value ? JSON.parse(value) : {};
    if (state.error || state.pager?.currentCfi && state.pager.currentCfi !== previousCfi && !state.pager?.turning) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (state.error || state.pager?.currentCfi === previousCfi || state.pager?.turning) {
    throw new Error(state.error || `Foliate composited page turn did not settle: ${JSON.stringify({ previousLocation, previousCfi, state })}`);
  }
  const initialCustomSetup = JSON.parse(await evaluate(`(()=>{globalThis.__MOWEN__.beginBookmarkSelection();const view=document.querySelector('foliate-view');const doc=view.renderer.getContents()[0].doc;const rect=Array.from(view.lastLocation.range.getClientRects()).find(rect=>rect.width>2&&rect.height>2);if(!rect)return JSON.stringify({started:false});const win=doc.defaultView;const point=new win.Touch({identifier:77,target:doc.body,clientX:rect.left+Math.min(12,rect.width/2),clientY:rect.top+rect.height/2,pageX:rect.left+Math.min(12,rect.width/2),pageY:rect.top+rect.height/2,screenX:Math.min(120,view.renderer.size*.3),screenY:rect.top+rect.height/2});globalThis.__mowenInitialTouch=point;doc.dispatchEvent(new win.TouchEvent('touchstart',{touches:[point],targetTouches:[point],changedTouches:[point],bubbles:true,cancelable:true}));return JSON.stringify({started:true})})()`));
  if (!initialCustomSetup.started) throw new Error('Foliate custom bookmark selection had no visible text target');
  await new Promise(resolve => setTimeout(resolve, 560));
  const initialCustomState = JSON.parse(await evaluate(`(()=>{const view=document.querySelector('foliate-view');const doc=view.renderer.getContents()[0].doc;const win=doc.defaultView;const point=globalThis.__mowenInitialTouch;doc.dispatchEvent(new win.TouchEvent('touchend',{touches:[],targetTouches:[],changedTouches:[point],bubbles:true,cancelable:true}));delete globalThis.__mowenInitialTouch;const selection=doc.getSelection();return JSON.stringify({text:selection?.toString?.()||'',collapsed:selection?.rangeCount?selection.getRangeAt(0).collapsed:true,visibleHandles:document.querySelectorAll('.bookmark-selection-handle.visible').length})})()`));
  if (!initialCustomState.text.trim() || initialCustomState.collapsed || initialCustomState.visibleHandles !== 2)
    throw new Error(`Foliate initial custom selection failed: ${JSON.stringify(initialCustomState)}`);
  await evaluate(`globalThis.__MOWEN__.endBookmarkSelection();true`);
  for (let attempt = 0; attempt < 2; attempt++) {
    const selectionSetup = JSON.parse(await evaluate(`(()=>{const view=document.querySelector('foliate-view');const renderer=view?.renderer;const visible=view?.lastLocation?.range?.cloneRange?.();if(!renderer||!visible)return JSON.stringify({direction:0,reason:'missing-visible-range'});const direction=${attempt}>0&&renderer.page>1?-1:renderer.page<renderer.pages-2?1:renderer.page>1?-1:0;if(!direction)return JSON.stringify({direction:0,reason:'no-adjacent-page-in-section'});const rects=Array.from(visible.getClientRects()).filter(rect=>rect.width>0&&rect.height>0);if(!rects.length)return JSON.stringify({direction:0,reason:'selection-has-no-rects'});globalThis.__MOWEN__.beginBookmarkSelection();const selection=visible.startContainer.ownerDocument.defaultView.getSelection();selection.removeAllRanges();selection.addRange(visible);const endpoint=direction<0?rects[0]:rects[rects.length-1];const left=Math.min(...rects.map(rect=>rect.left));const right=Math.max(...rects.map(rect=>rect.right));const doc=visible.startContainer.ownerDocument;return JSON.stringify({direction,initialText:selection.toString(),point:{clientX:direction<0?endpoint.left:endpoint.right,clientY:endpoint.bottom},pageLeft:left,pageRight:right,width:renderer.size,height:doc.documentElement.clientHeight})})()`));
    if (!selectionSetup.direction) break;
    const selectionStartCfi = JSON.parse(await evaluate(`JSON.stringify(globalThis.__MOWEN__.pagerStatus())`)).currentCfi;
    await evaluate(`(()=>{const view=document.querySelector('foliate-view');const doc=view.renderer.getContents()[0].doc;const win=doc.defaultView;const makeTouch=(identifier,clientX,clientY,screenX)=>new win.Touch({identifier,target:doc.body,clientX,clientY,pageX:clientX,pageY:clientY,screenX,screenY:clientY});const handle=makeTouch(101,${selectionSetup.point.clientX},${selectionSetup.point.clientY + 23},${selectionSetup.direction < 0 ? selectionSetup.width * 0.2 : selectionSetup.width * 0.8});const startClientX=${selectionSetup.direction < 0 ? selectionSetup.pageLeft + selectionSetup.width * 0.2 : selectionSetup.pageRight - selectionSetup.width * 0.2};const endClientX=startClientX+${selectionSetup.direction < 0 ? selectionSetup.width * 0.6 : -selectionSetup.width * 0.6};const startScreenX=${selectionSetup.direction < 0 ? selectionSetup.width * 0.2 : selectionSetup.width * 0.8};const endScreenX=${selectionSetup.direction < 0 ? selectionSetup.width * 0.8 : selectionSetup.width * 0.2};const y=${selectionSetup.height * 0.5};const start=makeTouch(202,startClientX,y,startScreenX);const end=makeTouch(202,endClientX,y,endScreenX);const fire=(type,touches,changedTouches)=>doc.dispatchEvent(new win.TouchEvent(type,{touches,targetTouches:touches,changedTouches,bubbles:true,cancelable:true}));fire('touchstart',[handle,start],[start]);fire('touchmove',[handle,end],[end]);fire('touchend',[handle],[end]);return true})()`);
    const expectedHandle = {
      clientX: selectionSetup.point.clientX + selectionSetup.direction * selectionSetup.width,
      clientY: selectionSetup.point.clientY,
    };
    const selectionDeadline = Date.now() + 15_000;
    let selectionState;
    while (Date.now() < selectionDeadline) {
      selectionState = JSON.parse(await evaluate(`(()=>{const view=document.querySelector('foliate-view');const doc=view?.renderer?.getContents?.()[0]?.doc;const selection=doc?.getSelection?.();const range=selection?.rangeCount?selection.getRangeAt(0):null;const rects=range?Array.from(range.getClientRects()).filter(rect=>rect.width>0&&rect.height>0):[];const handle=rects.length?(${selectionSetup.direction}<0?rects[0]:rects[rects.length-1]):null;const visible=view?.lastLocation?.range;const visibleRects=visible?Array.from(visible.getClientRects()).filter(rect=>rect.width>0&&rect.height>0):[];const caret=doc?.caretPositionFromPoint?.(${expectedHandle.clientX},${expectedHandle.clientY});const managed=document.querySelector('.bookmark-selection-handle.visible');const managedRect=managed?.getBoundingClientRect?.();return JSON.stringify({pager:globalThis.__MOWEN__.pagerStatus(),page:view?.renderer?.page,text:selection?.toString?.()||'',collapsed:range?.collapsed??true,handle:handle?{clientX:${selectionSetup.direction}<0?handle.left:handle.right,clientY:handle.bottom}:null,managedHandle:managed?{visible:true,left:managedRect.left,top:managedRect.top}:null,visible:visibleRects.length?{left:Math.min(...visibleRects.map(rect=>rect.left)),right:Math.max(...visibleRects.map(rect=>rect.right)),top:Math.min(...visibleRects.map(rect=>rect.top)),bottom:Math.max(...visibleRects.map(rect=>rect.bottom))}:null,caret:caret?{offset:caret.offset,node:caret.offsetNode?.nodeValue?.slice?.(0,30)||caret.offsetNode?.nodeName}:null})})()`));
      const handleArrived = selectionState.handle
        && Math.abs(selectionState.handle.clientX - expectedHandle.clientX) <= selectionSetup.width * 0.2
        && Math.abs(selectionState.handle.clientY - expectedHandle.clientY) <= 80;
      if (selectionState.pager?.currentCfi && selectionState.pager.currentCfi !== selectionStartCfi && !selectionState.pager.turning && !selectionState.collapsed && handleArrived && selectionState.managedHandle?.visible) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const handleMiss = !selectionState?.handle
      || Math.abs(selectionState.handle.clientX - expectedHandle.clientX) > selectionSetup.width * 0.2
      || Math.abs(selectionState.handle.clientY - expectedHandle.clientY) > 80;
    if (!selectionState?.text?.trim() || selectionState.collapsed || selectionState.pager?.currentCfi === selectionStartCfi || handleMiss || !selectionState.managedHandle?.visible) {
      throw new Error(`Foliate cross-page selection did not reach the held handle: ${JSON.stringify({ selectionSetup, expectedHandle, selectionState })}`);
    }
    if (attempt === 0 && selectionSetup.direction > 0) {
      await evaluate(`(()=>{const view=document.querySelector('foliate-view');const doc=view.renderer.getContents()[0].doc;const win=doc.defaultView;const held=new win.Touch({identifier:101,target:doc.body,clientX:${expectedHandle.clientX},clientY:${expectedHandle.clientY},pageX:${expectedHandle.clientX},pageY:${expectedHandle.clientY},screenX:${selectionSetup.width * 0.8},screenY:${expectedHandle.clientY}});doc.dispatchEvent(new win.TouchEvent('touchend',{touches:[],targetTouches:[],changedTouches:[held],bubbles:true,cancelable:true}));return true})()`);
      const continuedStartCfi = selectionState.pager.currentCfi;
      const continuedStarted = await evaluate(`(()=>{const handle=document.querySelector('.bookmark-selection-handle.visible');const handleRect=handle.getBoundingClientRect();const held=new Touch({identifier:303,target:handle,clientX:handleRect.left+22,clientY:handleRect.top+31,pageX:handleRect.left+22,pageY:handleRect.top+31,screenX:handleRect.left+22,screenY:handleRect.top+31});globalThis.__mowenSmokeHeld=held;handle.dispatchEvent(new TouchEvent('touchstart',{touches:[held],targetTouches:[held],changedTouches:[held],bubbles:true,cancelable:true}));const renderer=document.querySelector('foliate-view').renderer;if(renderer.page>=renderer.pages-2)return false;const makePage=screenX=>new Touch({identifier:404,target:document.body,clientX:screenX,clientY:${selectionSetup.height * 0.5},pageX:screenX,pageY:${selectionSetup.height * 0.5},screenX,screenY:${selectionSetup.height * 0.5}});const start=makePage(renderer.size*.8);const end=makePage(renderer.size*.2);const fire=(type,touches,changedTouches)=>document.dispatchEvent(new TouchEvent(type,{touches,targetTouches:touches,changedTouches,bubbles:true,cancelable:true}));fire('touchstart',[held,start],[start]);fire('touchmove',[held,end],[end]);fire('touchend',[held],[end]);return true})()`);
      if (continuedStarted) {
        const continuedDeadline = Date.now() + 15_000;
        let continuedState;
        while (Date.now() < continuedDeadline) {
          continuedState = JSON.parse(await evaluate(`(()=>{const view=document.querySelector('foliate-view');const doc=view.renderer.getContents()[0].doc;const selection=doc.getSelection();const handle=document.querySelector('.bookmark-selection-handle.visible');return JSON.stringify({pager:globalThis.__MOWEN__.pagerStatus(),text:selection?.toString?.()||'',collapsed:selection?.rangeCount?selection.getRangeAt(0).collapsed:true,handleVisible:!!handle})})()`));
          if (continuedState.pager.currentCfi !== continuedStartCfi && !continuedState.pager.turning && !continuedState.collapsed && continuedState.handleVisible && continuedState.text.length > selectionState.text.length && continuedState.text.includes(selectionSetup.initialText)) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (
          continuedState?.pager?.currentCfi === continuedStartCfi
          || continuedState?.collapsed
          || !continuedState?.handleVisible
          || continuedState.text.length <= selectionState.text.length
          || !continuedState.text.includes(selectionSetup.initialText)
        ) throw new Error(`Foliate continued selection did not preserve its fixed endpoint: ${JSON.stringify({ selectionSetup, selectionState, continuedState })}`);
        await evaluate(`(()=>{let handle=document.querySelector('.bookmark-selection-handle.visible');const held=globalThis.__mowenSmokeHeld;handle.dispatchEvent(new TouchEvent('touchend',{touches:[],targetTouches:[],changedTouches:[held],bubbles:true,cancelable:true}));handle=document.querySelector('.bookmark-selection-handle.visible');const rect=handle.getBoundingClientRect();const start=new Touch({identifier:505,target:handle,clientX:rect.left+22,clientY:rect.top+31,pageX:rect.left+22,pageY:rect.top+31,screenX:rect.left+22,screenY:rect.top+31});const moveY=Math.max(24,rect.top-41);const move=new Touch({identifier:505,target:handle,clientX:rect.left+22,clientY:moveY,pageX:rect.left+22,pageY:moveY,screenX:rect.left+22,screenY:moveY});const fire=(type,touches,changedTouches)=>handle.dispatchEvent(new TouchEvent(type,{touches,targetTouches:touches,changedTouches,bubbles:true,cancelable:true}));fire('touchstart',[start],[start]);fire('touchmove',[move],[move]);fire('touchend',[],[move]);delete globalThis.__mowenSmokeHeld;return true})()`);
        await new Promise(resolve => setTimeout(resolve, 300));
        const adjustedState = JSON.parse(await evaluate(`(()=>{const view=document.querySelector('foliate-view');const doc=view.renderer.getContents()[0].doc;const selection=doc.getSelection();return JSON.stringify({text:selection?.toString?.()||'',collapsed:selection?.rangeCount?selection.getRangeAt(0).collapsed:true,handleVisible:!!document.querySelector('.bookmark-selection-handle.visible')})})()`));
        if (adjustedState.collapsed || !adjustedState.handleVisible || !adjustedState.text.includes(selectionSetup.initialText) || adjustedState.text === continuedState.text)
          throw new Error(`Foliate managed selection handle was not adjustable: ${JSON.stringify({ selectionSetup, continuedState, adjustedState })}`);
      }
    }
    await evaluate(`globalThis.__MOWEN__.endBookmarkSelection();true`);
  }
  const footnote = await evaluate(`(async()=>{const view=document.querySelector('foliate-view');for(let index=0;index<view.book.sections.length;index++){const source=await view.book.sections[index].createDocument?.();if(!source?.querySelector('a[href] sup'))continue;await view.goTo(index);const live=view.renderer.getContents()[0]?.doc;const link=live?.querySelector('a[href] sup')?.closest('a[href]');if(!link)return 'missing-live-link';link.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:live.defaultView}));return 'clicked';}return 'none';})()`, 30_000);
  if (footnote === 'clicked') {
    let noteOpen = false;
    const noteDeadline = Date.now() + 15_000;
    while (Date.now() < noteDeadline) {
      noteOpen = await evaluate(`document.getElementById('note-backdrop').classList.contains('open')`);
      if (noteOpen) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!noteOpen) throw new Error('Foliate found a footnote link but did not render its content');
  } else if (footnote !== 'none') throw new Error(`Foliate footnote test failed: ${footnote}`);
} finally {
  socket?.close();
  const exited = new Promise(resolve => browser.once('exit', resolve));
  browser.kill();
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
  try {
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  } catch { }
}
