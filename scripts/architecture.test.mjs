import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = async (relativePath) => readFile(new URL(relativePath, root), 'utf8');

test('application responsibilities remain split into bounded modules', async () => {
  const files = [
    ['App.tsx', 260],
    ['src/FoliateReader.tsx', 320],
    ['src/components/reader/ReaderScreen.tsx', 360],
    ['src/components/reader/ReaderOverlays.tsx', 420],
    ['src/components/reader/AIPanel.tsx', 300],
    ['src/components/reader/ConversationViewerModal.tsx', 300],
  ];
  for (const [file, maximum] of files) {
    const lines = (await read(file)).split(/\r?\n/).length;
    assert.ok(lines <= maximum, `${file} has ${lines} lines; expected <= ${maximum}`);
  }
});

test('Foliate smoke extraction reads the same runtime consumed by WebView', async () => {
  const wrapper = await read('src/FoliateReader.tsx');
  const runtime = await read('src/foliate/runtime.ts');
  const smoke = await read('scripts/smoke-foliate.mjs');
  const bridgeParts = (await Promise.all(Array.from({ length: 12 }, (_value, index) => read(`src/foliate/runtimePart${index}.ts`)))).join('\n');
  assert.match(wrapper, /from '\.\/foliate\/runtime'/);
  assert.match(runtime, /export const FOLIATE_HTML = `/);
  const runtimeParts = await read('src/foliate/runtimeParts.ts');
  assert.match(runtime, /export const FOLIATE_BRIDGE = FOLIATE_BRIDGE_PARTS\.join/);
  assert.match(runtimeParts, /FOLIATE_BRIDGE_PART_0/);
  assert.match(smoke, /\.\/src\/foliate\/runtime\.ts/);
  assert.doesNotMatch(wrapper, /const FOLIATE_(?:HTML|BRIDGE)/);
  assert.match(bridgeParts, /globalThis\.__MOWEN__/);
  assert.match(bridgeParts, /type: 'book-ready'/);
  assert.match(bridgeParts, /type: 'relocate'/);
});

test('reader utility behavior is preserved after extraction', async () => {
  const source = await read('src/components/reader/readerUtils.ts');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports }, { filename: 'readerUtils.ts' });
  const { getImageData, normalizeAIAnswer, normalizeAIThinking, splitAIAnswer, themedMarkdownStyles } = module.exports;

  assert.equal(getImageData('[[MOWEN_IMAGE_DATA:data:image/png;base64,abc]]'), 'data:image/png;base64,abc');
  assert.equal(getImageData('[[MOWEN_IMAGE_FILE:file:///tmp/image.png|120|80]]'), 'file:///tmp/image.png');
  assert.equal(getImageData('正文'), undefined);
  assert.equal(normalizeAIAnswer('\\*\\*转义\\*\\* 和 ＊＊全角＊＊'), '**转义** 和 **全角**');
  assert.equal(normalizeAIAnswer('** 前后有空格 **'), '**前后有空格**');
  assert.equal(normalizeAIAnswer('**第一** 和 **第二**'), '**第一** 和 **第二**');
  assert.equal(normalizeAIAnswer('<think>内部过程</think>**答案**'), '**答案**');
  assert.equal(normalizeAIAnswer('```markdown\n**标题**\n```'), '**标题**');
  assert.equal(normalizeAIAnswer('`**代码**` **正文**'), '`**代码**` **正文**');
  assert.equal(normalizeAIThinking('先看上下文\n\n再组织答案'), '先看上下文\n\n再组织答案');
  const split = splitAIAnswer('<think>先看上下文</think>**答案**');
  assert.equal(split.content, '**答案**');
  assert.equal(split.thinking, '先看上下文');

  const palette = { text: '#111', accent: '#222', surfaceAlt: '#333', line: '#444' };
  assert.deepEqual(JSON.parse(JSON.stringify(themedMarkdownStyles(palette))), {
    body: { color: '#111' },
    text: { color: '#111' },
    paragraph: { color: '#111' },
    heading1: { color: '#111' },
    heading2: { color: '#111' },
    heading3: { color: '#111' },
    strong: { color: '#111', fontWeight: '800' },
    link: { color: '#222' },
    blockquote: { backgroundColor: '#333', borderLeftColor: '#222' },
    code_inline: { color: '#111', backgroundColor: '#333' },
    bullet_list_icon: { color: '#222' },
    hr: { backgroundColor: '#444' },
  });
});

test('EPUB chapter titles collapse markup whitespace before display', async () => {
  const source = await read('src/epub.ts');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  const requires = {
    jszip: {},
    'fast-xml-parser': { XMLParser: class {} },
    'html-entities': { decode: (value) => value },
  };
  vm.runInNewContext(compiled, { module, exports: module.exports, require: (id) => requires[id] }, { filename: 'epub.ts' });
  const { normalizeChapterTitle } = module.exports;

  assert.equal(normalizeChapterTitle('<span>第2章</span><br class="calibre7"/>\n    大众疯狂'), '第2章 大众疯狂');
});

test('keyboard-aware sheets clear Android avoidance after the keyboard hides', async () => {
  const aiPanel = await read('src/components/reader/AIPanel.tsx');
  const conversationViewer = await read('src/components/reader/ConversationViewerModal.tsx');
  const searchModal = await read('src/components/reader/SearchModal.tsx');
  const draggableSheet = await read('src/components/reader/DraggableSheet.tsx');
  const keyboardVisibility = await read('src/components/reader/useKeyboardVisibility.ts');
  const uiStyles = await read('src/ui/styles.ts');
  for (const source of [aiPanel, conversationViewer, searchModal]) {
    assert.match(source, /statusBarTranslucent(?=\s|=\{true\})/);
    assert.match(source, /behavior=\{Platform\.OS === 'ios' \? 'padding' : keyboardVisible \? 'height' : undefined\}/);
    assert.match(source, /<SheetBackdrop[\s\S]+<KeyboardAvoidingView/);
    assert.match(source, /showScrim=\{false\}/);
  }
  assert.match(searchModal, /animationType="none"/);
  assert.match(searchModal, /onOpenComplete=\{focusInput\}/);
  assert.match(uiStyles, /searchSheet: \{[^\n]+minHeight: 0/);
  assert.doesNotMatch(draggableSheet, /Keyboard\.addListener|avoidKeyboard|keyboardOffset/);
  assert.match(keyboardVisibility, /keyboardDidShow/);
  assert.match(keyboardVisibility, /keyboardDidHide/);
});

test('AI thinking stays separate from answers and image swipes stay page gestures', async () => {
  const ai = await read('src/ai.ts');
  const aiPanel = await read('src/components/reader/AIPanel.tsx');
  const conversationViewer = await read('src/components/reader/ConversationViewerModal.tsx');
  const thinkingToggle = await read('src/components/reader/AIThinkingToggle.tsx');
  const thinkingTrace = await read('src/components/reader/AIThinkingTrace.tsx');
  const autoScroll = await read('src/components/reader/useAutoScrollToLatest.ts');
  const runtime = await read('src/foliate/runtimePart9.ts');
  assert.match(ai, /enable_thinking: options\.enableThinking \?\? false/);
  assert.match(ai, /reasoning_content/);
  assert.match(ai, /onThinkingDelta/);
  assert.match(aiPanel, /AIThinkingToggle/);
  assert.match(aiPanel, /AIThinkingTrace/);
  assert.match(aiPanel, /questionBoxFooter[\s\S]*AIThinkingToggle/);
  assert.match(aiPanel, /aiSheetInitial/);
  assert.match(await read('src/ui/styles.ts'), /aiSheetInitial: \{ maxHeight: '72%' \}/);
  assert.match(aiPanel, /paddingBottom: keyboardVisible \? 5 : 16/);
  assert.match(conversationViewer, /questionBoxFooter[\s\S]*AIThinkingToggle/);
  assert.match(conversationViewer, /paddingBottom: keyboardVisible \? 7 : 16/);
  assert.match(await read('src/components/reader/AIContextCard.tsx'), /numberOfLines=\{5\}/);
  assert.match(conversationViewer, /numberOfLines=\{1\} ellipsizeMode="clip"/);
  assert.doesNotMatch(conversationViewer, /adjustsFontSizeToFit|minimumFontScale/);
  assert.doesNotMatch(thinkingTrace, /ActivityIndicator/);
  assert.doesNotMatch(thinkingTrace, /thinkingTraceMark|thinkingTraceHint/);
  assert.match(thinkingTrace, /chevron-down/);
  assert.match(aiPanel, /defaultExpanded=\{thinkingEnabled\}/);
  assert.match(aiPanel, /enableThinking: thinkingEnabled/);
  assert.doesNotMatch(aiPanel, /IntentButton|fillPreset|intentGrid/);
  assert.doesNotMatch(thinkingToggle, /qwen/i);
  assert.match(autoScroll, /followLatestRef/);
  assert.match(autoScroll, /scrollToEnd/);
  assert.match(aiPanel, /onContentSizeChange=\{handleContentSizeChange\}/);
  assert.match(conversationViewer, /onContentSizeChange=\{handleContentSizeChange\}/);
  assert.match(thinkingTrace, /onContentSizeChange=\{handleContentSizeChange\}/);
  assert.match(aiPanel, /const text = question\.trim\(\);[\s\S]*Keyboard\.dismiss\(\);/);
  assert.match(conversationViewer, /const text = question\.trim\(\);[\s\S]*Keyboard\.dismiss\(\);/);
  assert.doesNotMatch(runtime, /const image = finished\.image \|\| imageFromEvent\(event\)/);
  assert.match(runtime, /if \(finished\.moved\) \{[\s\S]*suppressClickUntil/);
  assert.doesNotMatch(runtime, /imageTap/);
});

test('AGENTS.md documents the canonical ownership boundaries', async () => {
  const agents = await read('AGENTS.md');
  assert.match(agents, /本仓库的规范文件名是根目录 `AGENTS\.md`/);
  assert.match(agents, /src\/foliate\/runtime\.ts/);
  assert.match(agents, /不要另建大小写不同或内容重复的 `agent\.md`/);
});
