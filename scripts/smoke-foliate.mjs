import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const epubPath = process.argv[2];
if (!epubPath) throw new Error('Usage: npm run smoke:foliate -- <book.epub>');

const component = await readFile(new URL('../src/FoliateReader.tsx', import.meta.url), 'utf8');
const generated = await readFile(new URL('../src/generated/foliateBundle.ts', import.meta.url), 'utf8');
const html = component.match(/const FOLIATE_HTML = `([\s\S]*?)`;/)?.[1];
const bridge = component.match(/const FOLIATE_BRIDGE = String\.raw`([\s\S]*?)`;/)?.[1];
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
  console.log(`Foliate smoke test passed: page-turn CFI advanced at ${state.relocate}, footnote ${footnote === 'clicked' ? 'rendered' : 'not present'}`);
} finally {
  socket?.close();
  const exited = new Promise(resolve => browser.once('exit', resolve));
  browser.kill();
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
  try {
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  } catch (error) {
    console.warn(`Smoke test passed but could not remove temporary browser profile: ${error.message}`);
  }
}
