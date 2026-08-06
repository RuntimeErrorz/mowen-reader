import { File } from 'expo-file-system';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { decode } from 'html-entities';
import { Book, Chapter } from './types';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
const asArray = <T,>(value: T | T[] | undefined): T[] => value == null ? [] : Array.isArray(value) ? value : [value];
const attr = (node: any, name: string) => node?.[`@_${name}`] ?? '';

function dirname(path: string) {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index + 1);
}

function resolvePath(base: string, target: string) {
  const clean = decodeURIComponent(target.split('#')[0]);
  const pieces = `${base}${clean}`.split('/');
  const out: string[] = [];
  for (const piece of pieces) {
    if (!piece || piece === '.') continue;
    if (piece === '..') out.pop(); else out.push(piece);
  }
  return out.join('/');
}

function textValue(value: any): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (value && typeof value === 'object') return String(value['#text'] ?? '');
  return '';
}

export function normalizeChapterTitle(value?: string): string {
  return decode(String(value ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function extractFootnotes(html: string) {
  const notes: Record<string, string> = {};
  const noteListRegex = /<ol\b[^>]*class=["'][^"']*footnote-content[^"']*["'][^>]*>[\s\S]*?<\/ol>/gi;
  for (const list of html.match(noteListRegex) ?? []) {
    const itemRegex = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;
    let item: RegExpExecArray | null;
    while ((item = itemRegex.exec(list))) {
      const id = item[1].match(/\bid=["']([^"']+)["']/i)?.[1];
      const className = item[1].match(/\bclass=["']([^"']+)["']/i)?.[1] ?? '';
      if (!id || !className.includes('footnote-item')) continue;
      notes[id] = decode(item[2].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    }
  }
  const standaloneRegex = /<(?:p|li|aside)\b([^>]*(?:class=["'][^"']*(?:fncontent|footnote)[^"']*["']|epub:type=["'](?:footnote|endnote)["'])[^>]*)>([\s\S]*?)<\/(?:p|li|aside)>/gi;
  let standalone: RegExpExecArray | null;
  while ((standalone = standaloneRegex.exec(html))) {
    const ownId = standalone[1].match(/\bid=["']([^"']+)["']/i)?.[1];
    const anchorId = standalone[2].match(/<a\b[^>]*\bid=["']([^"']+)["'][^>]*>/i)?.[1];
    const id = ownId || anchorId;
    if (!id) continue;
    const withoutBacklink = standalone[2].replace(/<a\b[^>]*>[\s\S]*?<\/a>/i, '');
    notes[id] = decode(withoutBacklink.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  }
  return notes;
}

function stripHtml(
  html: string,
  globalNotes: Record<string, string> = {},
  imageMarker?: (source: string) => string,
) {
  const notes: Record<string, string> = {};
  const noteListRegex = /<ol\b[^>]*class=["'][^"']*footnote-content[^"']*["'][^>]*>[\s\S]*?<\/ol>/gi;
  const standaloneNoteRegex = /<(?:p|li|aside)\b[^>]*(?:class=["'][^"']*(?:fncontent|footnote)[^"']*["']|epub:type=["'](?:footnote|endnote)["'])[^>]*>[\s\S]*?<\/(?:p|li|aside)>/gi;
  const heading = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1];
  const title = heading ? normalizeChapterTitle(heading) : '';
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(noteListRegex, '')
    .replace(standaloneNoteRegex, '')
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_tag, attributes, inner) => {
      const href = attributes.match(/\bhref=["']([^"']+)["']/i)?.[1] ?? '';
      const id = href.includes('#') ? href.split('#').pop() ?? '' : '';
      if (id && globalNotes[id]) {
        notes[id] = globalNotes[id];
        const label = decode(inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).match(/(?:\(\s*\d{1,3}\s*\)|（\s*\d{1,3}\s*）|\[\s*\d{1,3}\s*\]|［\s*\d{1,3}\s*］|[⁰¹²³⁴⁵⁶⁷⁸⁹]+)/u)?.[0] || '';
        return `[[MOWEN_NOTE_REF:${id}${label ? `|${encodeURIComponent(label)}` : ''}]]`;
      }
      return inner;
    })
    .replace(/<img\b([^>]*)>/gi, (_tag, attributes) => {
      const source = attributes.match(/\bsrc=["']([^"']+)["']/i)?.[1] ?? '';
      const marker = imageMarker?.(source);
      return `\n${marker || '〔插图〕'}\n`;
    })
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  body = decode(body).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n');
  const raw = body.split(/\n+/).map((part) => part.trim()).filter((part) => part.length > 1);
  const paragraphs = raw.flatMap((part) => {
    if (part.length < 700) return [part];
    return part.match(/.{1,420}(?:[。！？.!?；;]|$)/g)?.map((x) => x.trim()).filter(Boolean) ?? [part];
  });
  return { title, paragraphs, notes };
}

function navLabels(html: string, base: string) {
  const labels = new Map<string, string>();
  const regex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) {
    labels.set(resolvePath(base, match[1]), normalizeChapterTitle(match[2]));
  }
  return labels;
}

export async function parseEpub(uri: string, fallbackName: string): Promise<Book> {
  const zip = await JSZip.loadAsync(await new File(uri).arrayBuffer());
  const containerText = await zip.file('META-INF/container.xml')?.async('text');
  if (!containerText) throw new Error('这不是有效的 EPUB：缺少 container.xml');
  const container = parser.parse(containerText);
  const rootfile = asArray(container?.container?.rootfiles?.rootfile)[0];
  const opfPath = attr(rootfile, 'full-path');
  const opfText = await zip.file(opfPath)?.async('text');
  if (!opfText) throw new Error('无法读取 EPUB 内容清单');

  const pkg = parser.parse(opfText)?.package;
  const metadata = pkg?.metadata ?? {};
  const title = textValue(metadata['dc:title']) || fallbackName.replace(/\.epub$/i, '') || '未命名书籍';
  const author = textValue(asArray(metadata['dc:creator'])[0]) || '未知作者';
  const description = decode(textValue(metadata['dc:description']).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  const opfBase = dirname(opfPath);
  const manifestItems = asArray<any>(pkg?.manifest?.item);
  const byId = new Map(manifestItems.map((item) => [attr(item, 'id'), item]));
  const imageMimeByPath = new Map(
    manifestItems
      .filter((item) => String(attr(item, 'media-type')).startsWith('image/'))
      .map((item) => [resolvePath(opfBase, attr(item, 'href')), attr(item, 'media-type')]),
  );
  const spineItems = asArray<any>(pkg?.spine?.itemref);

  const navItem = manifestItems.find((item) => String(attr(item, 'properties')).includes('nav'));
  let labels = new Map<string, string>();
  if (navItem) {
    const navPath = resolvePath(opfBase, attr(navItem, 'href'));
    const navText = await zip.file(navPath)?.async('text');
    if (navText) labels = navLabels(navText, dirname(navPath));
  }

  const documents = (await Promise.all(spineItems.map(async (spineItem, index) => {
    const item = byId.get(attr(spineItem, 'idref'));
    if (!item) return null;
    const path = resolvePath(opfBase, attr(item, 'href'));
    const html = await zip.file(path)?.async('text');
    return html ? { index, item, path, html } : null;
  }))).filter((document): document is { index: number; item: any; path: string; html: string } => document !== null);
  const globalNotes: Record<string, string> = {};
  documents.forEach(({ html }) => Object.assign(globalNotes, extractFootnotes(html)));

  const chapters = documents.flatMap<Chapter>(({ index, item, path, html }) => {
    const parsed = stripHtml(html, globalNotes, (source) => {
      if (!source) return '';
      if (/^data:image\//i.test(source)) return `[[MOWEN_IMAGE_DATA:${source}]]`;
      const imagePath = resolvePath(dirname(path), source.split(/[?#]/)[0]);
      const mime = imageMimeByPath.get(imagePath) || '';
      return `[[MOWEN_IMAGE_EPUB:${imagePath}${mime ? `|${mime}` : ''}]]`;
    });
    if (!parsed.paragraphs.length) return [];
    return [{
      id: `${index}-${attr(item, 'id')}`,
      title: labels.get(path) || parsed.title || `第 ${index + 1} 章`,
      paragraphs: parsed.paragraphs,
      notes: parsed.notes,
    }];
  });
  if (!chapters.length) throw new Error('没有在这本 EPUB 中找到可阅读的正文');

  let cover: string | undefined;
  const coverMeta = asArray<any>(metadata.meta).find((item) => attr(item, 'name') === 'cover');
  const coverItem = (coverMeta && byId.get(attr(coverMeta, 'content'))) || manifestItems.find((item) => String(attr(item, 'properties')).includes('cover-image'));
  if (coverItem) {
    const coverPath = resolvePath(opfBase, attr(coverItem, 'href'));
    const coverData = await zip.file(coverPath)?.async('base64');
    if (coverData && coverData.length < 2_500_000) cover = `data:${attr(coverItem, 'media-type') || 'image/jpeg'};base64,${coverData}`;
  }

  return { id: `book-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, title, author, description: description || undefined, cover, epubUri: uri, chapters, addedAt: Date.now() };
}
