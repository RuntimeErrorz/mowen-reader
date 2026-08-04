const NOTE_REFERENCE = /\[\[MOWEN_NOTE_REF:([^|\]]+)(?:\|([^\]]*))?\]\]/g;
const MOWEN_MARKER = /\[\[MOWEN_[^\]]+\]\]/g;
const VISIBLE_FOOTNOTE_LABEL = /(?:\(\s*\d{1,3}\s*\)|（\s*\d{1,3}\s*）|\[\s*\d{1,3}\s*\]|［\s*\d{1,3}\s*］|[⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g;

export type NoteReference = {
  id: string;
  label?: string;
  text: string;
};

function noteText(value: string | undefined) {
  return value?.replace(/\s+/g, ' ').trim() || '';
}

function decodeLabel(value: string | undefined) {
  if (!value) return undefined;
  try { return decodeURIComponent(value) || undefined; } catch { return value; }
}

function fallbackLabel(id: string) {
  return id.match(/(?:note|notef|footnote|fn)[_-]?(\d+)$/i)?.[1];
}

function noteLabel(id: string, encodedLabel?: string) {
  return decodeLabel(encodedLabel) || fallbackLabel(id);
}

export function noteReferenceItemsIn(text: string, notes?: Record<string, string>): NoteReference[] {
  if (!notes) return [];
  const values: NoteReference[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(NOTE_REFERENCE)) {
    const id = match[1];
    const value = noteText(notes[id]);
    if (value && !seen.has(id)) {
      seen.add(id);
      values.push({ id, label: noteLabel(id, match[2]), text: value });
    }
  }
  return values;
}

export function noteReferencesIn(text: string, notes?: Record<string, string>) {
  return noteReferenceItemsIn(text, notes).map((item) => item.text);
}

export function expandNoteReferences(text: string, notes?: Record<string, string>) {
  return text.replace(NOTE_REFERENCE, (_marker, id: string, encodedLabel?: string) => {
    const value = noteText(notes?.[id]);
    const label = noteLabel(id, encodedLabel);
    return value ? `〔注释${label ? ` ${label}` : ''}：${value}〕` : '〔注释〕';
  });
}

export function labelNoteReferences(text: string) {
  return text.replace(NOTE_REFERENCE, (_marker, id: string, encodedLabel?: string) => {
    const label = noteLabel(id, encodedLabel);
    return label ? `〔注 ${label}〕` : '〔注〕';
  });
}

function normalizedLabel(value: string) {
  return value.replace(/[()（）\[\]［］\s]/g, '');
}

export function expandSelectedTextWithNotes(selection: string, paragraph: string, notes?: Record<string, string>) {
  const references = noteReferenceItemsIn(paragraph, notes);
  if (!references.length) return selection;
  const normalizedParagraph = normalizedLookupText(paragraph.replace(MOWEN_MARKER, ''));
  const normalizedSelection = normalizedLookupText(selection);
  if (normalizedSelection === normalizedParagraph) return expandNoteReferences(paragraph, notes);
  const expandedSelection = expandNoteReferences(selection, notes);
  if (expandedSelection !== selection) return expandedSelection;
  let nextReference = 0;
  return selection.replace(VISIBLE_FOOTNOTE_LABEL, (visibleLabel) => {
    const normalizedVisible = normalizedLabel(visibleLabel);
    const matchedIndex = references.findIndex((reference, index) => index >= nextReference && reference.label && normalizedLabel(reference.label) === normalizedVisible);
    const referenceIndex = matchedIndex >= 0 ? matchedIndex : nextReference;
    const reference = references[referenceIndex];
    if (!reference) return visibleLabel;
    nextReference = referenceIndex + 1;
    return `〔注释${reference.label ? ` ${reference.label}` : ''}：${reference.text}〕`;
  });
}

function normalizedLookupText(value: string) {
  return value.replace(/\s+/g, '').trim();
}

export function paragraphMatchesSelection(paragraph: string, selection: string) {
  const normalizedParagraph = normalizedLookupText(paragraph.replace(MOWEN_MARKER, ''));
  if (!normalizedParagraph) return false;
  const normalizedSelection = normalizedLookupText(selection);
  const withoutVisibleFootnoteLabels = normalizedSelection.replace(VISIBLE_FOOTNOTE_LABEL, '');
  return [normalizedSelection, withoutVisibleFootnoteLabels].some((candidate) => {
    const needle = candidate.slice(0, 80);
    return !!needle && (normalizedParagraph.includes(needle) || needle.includes(normalizedParagraph.slice(0, 80)));
  });
}
