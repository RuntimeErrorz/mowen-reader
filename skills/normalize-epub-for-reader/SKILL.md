---
name: normalize-epub-for-reader
description: Normalize EPUB files for the Mowen/Foliate reader by inspecting and repairing non-standard footnotes, custom image annotations, EPUB container details, and other structural compatibility issues. Use when the user asks to convert, repair, standardize, or make one or more .epub files readable in this reader, especially when notes appear as images or custom attributes, links do not open, or a book opens inconsistently.
---

# Normalize EPUB for Reader

Use this skill to produce a compatible copy of an EPUB without baking a book-specific workaround into the reader. Keep the original file untouched unless the user explicitly requests an in-place replacement.

## Workflow

1. Identify the exact EPUB input and inspect the archive before changing it.
2. Prefer a generic reader/runtime fix when the problem is caused by untrusted CSS or a recurring semantic structure. Do not add selectors based on a filename, chapter number, or one book's generated class names.
3. When the source contains non-standard note data or the user asks to rewrite the book, run the bundled normalizer:

   ```powershell
   python "$env:USERPROFILE\.codex\skills\normalize-epub-for-reader\scripts\normalize_epub.py" `
     "C:\path\book.epub" `
     "C:\path\book - 标准兼容版.epub"
   ```

   If the skill is installed elsewhere, resolve the script path from the skill directory rather than assuming the example path.

4. Never overwrite the input by default. Use `--force` only when the user explicitly wants the chosen output path replaced.
5. Report what was changed, what was preserved, and the output path. Do not copy user EPUBs into the repository or commit generated books.

## What to normalize

The bundled script makes conservative, structural changes:

- Convert image markers carrying `zy-footnote`, `data-footnote`, `data-footnote-text`, or `data-note-text` into ordinary links containing a superscript `注` marker.
- Add `epub:type="noteref"` and `role="doc-noteref"` to each reference.
- Add an `aside epub:type="footnote" role="doc-footnote"` containing the original note text and an `epub:type="backlink"` return link.
- Add the EPUB namespace only when the generated semantic attributes need it.
- Keep the original XHTML text, images, CSS, OPF, navigation, and archive entries unless a targeted conversion requires changing an XHTML content document.
- Rebuild the archive with `mimetype` as the first, uncompressed entry.

The default marker is `注` because many converter-generated EPUBs use a small image displaying that symbol. Use `--marker-style number` when numbered superscripts are preferable.

Do not flatten all book CSS, rewrite every class name, remove unused resources, or convert ordinary illustrations into notes. The reader's Foliate runtime owns typography, captions, images, pagination, and semantic compatibility rules.

## Validation

The normalizer validates the output before replacing it:

- ZIP integrity passes.
- `mimetype` is exactly `application/epub+zip`, first, and stored without compression.
- Every generated reference has one matching footnote and backlink ID.
- Converted custom note attributes are gone from XHTML documents.
- The changed XHTML documents declare `xmlns:epub`.

For a visual or interaction check in the Mowen app, open the generated copy and test at least one note reference, one image/caption section, and one long chapter. If changing the app runtime instead of a book, follow the repository's Foliate smoke-test instructions and preserve the single Foliate rendering path.

## Decision boundaries

- Use this skill for a requested book conversion or a source format that the reader cannot interpret.
- Fix recurring structural patterns in `src/foliate/runtime*.ts` when the user wants all EPUBs to look consistent; do not preprocess every book for a layout preference that belongs in the reader.
- Keep standard EPUB links and existing semantic notes unless they are demonstrably broken.
- Treat popup behavior as reader-dependent: standard links and note content must remain usable even when a reading system does not provide a popup.

## Bundled resources

- `scripts/normalize_epub.py`: deterministic EPUB copy-and-normalize tool.
- `references/standard-annotations.md`: EPUB note semantics and compatibility boundaries.
