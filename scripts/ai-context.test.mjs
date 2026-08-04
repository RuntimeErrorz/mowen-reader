import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';

test('AI context expands EPUB note references to their content', async () => {
  const source = await readFile(new URL('../src/aiContext.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports }, { filename: 'aiContext.ts' });
  const { expandNoteReferences, expandSelectedTextWithNotes, noteReferenceItemsIn, noteReferencesIn, paragraphMatchesSelection } = module.exports;
  const notes = { n1: '这是注释正文。', n2: '第二条说明' };

  assert.equal(expandNoteReferences('原文 [[MOWEN_NOTE_REF:n1]] 继续。', notes), '原文 〔注释：这是注释正文。〕 继续。');
  assert.deepEqual(JSON.parse(JSON.stringify(noteReferencesIn('[[MOWEN_NOTE_REF:n1]] [[MOWEN_NOTE_REF:n1]] [[MOWEN_NOTE_REF:n2]]', notes))), ['这是注释正文。', '第二条说明']);
  assert.equal(expandNoteReferences('[[MOWEN_NOTE_REF:missing]]', notes), '〔注释〕');
  assert.equal(expandNoteReferences('原文 [[MOWEN_NOTE_REF:n1|%283%29]]。', notes), '原文 〔注释 (3)：这是注释正文。〕。');
  assert.equal(expandSelectedTextWithNotes('原文(3)。', '原文 [[MOWEN_NOTE_REF:n1|%283%29]]。', notes), '原文〔注释 (3)：这是注释正文。〕。');
  assert.equal(expandSelectedTextWithNotes('原文。', '原文[[MOWEN_NOTE_REF:n1]]。', notes), '原文〔注释：这是注释正文。〕。');
  assert.deepEqual(JSON.parse(JSON.stringify(noteReferenceItemsIn('原文 [[MOWEN_NOTE_REF:n1|%283%29]]。', notes))), [{ id: 'n1', label: '(3)', text: '这是注释正文。' }]);
  assert.equal(paragraphMatchesSelection('正文开头[[MOWEN_NOTE_REF:n1]]正文结尾', '正文开头(1)正文结尾'), true);
  assert.equal(paragraphMatchesSelection('另一段完全不同的正文', '正文开头(1)正文结尾'), false);
});
