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
  const { getImageData, themedMarkdownStyles } = module.exports;

  assert.equal(getImageData('[[MOWEN_IMAGE_DATA:data:image/png;base64,abc]]'), 'data:image/png;base64,abc');
  assert.equal(getImageData('[[MOWEN_IMAGE_FILE:file:///tmp/image.png|120|80]]'), 'file:///tmp/image.png');
  assert.equal(getImageData('正文'), undefined);

  const palette = { text: '#111', accent: '#222', surfaceAlt: '#333', line: '#444' };
  assert.deepEqual(JSON.parse(JSON.stringify(themedMarkdownStyles(palette))), {
    body: { color: '#111' },
    text: { color: '#111' },
    paragraph: { color: '#111' },
    heading1: { color: '#111' },
    heading2: { color: '#111' },
    heading3: { color: '#111' },
    strong: { color: '#111' },
    link: { color: '#222' },
    blockquote: { backgroundColor: '#333', borderLeftColor: '#222' },
    code_inline: { color: '#111', backgroundColor: '#333' },
    bullet_list_icon: { color: '#222' },
    hr: { backgroundColor: '#444' },
  });
});

test('keyboard-aware sheets clear Android avoidance after the keyboard hides', async () => {
  const aiPanel = await read('src/components/reader/AIPanel.tsx');
  const readerOverlays = await read('src/components/reader/ReaderOverlays.tsx');
  const searchModal = await read('src/components/reader/SearchModal.tsx');
  const draggableSheet = await read('src/components/reader/DraggableSheet.tsx');
  const keyboardVisibility = await read('src/components/reader/useKeyboardVisibility.ts');
  const uiStyles = await read('src/ui/styles.ts');
  for (const source of [aiPanel, readerOverlays, searchModal]) {
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

test('AGENTS.md documents the canonical ownership boundaries', async () => {
  const agents = await read('AGENTS.md');
  assert.match(agents, /本仓库的规范文件名是根目录 `AGENTS\.md`/);
  assert.match(agents, /src\/foliate\/runtime\.ts/);
  assert.match(agents, /不要另建大小写不同或内容重复的 `agent\.md`/);
});
