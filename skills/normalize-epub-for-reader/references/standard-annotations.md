# EPUB annotation compatibility

Use the EPUB 3 structural semantics vocabulary for notes:

- `epub:type="noteref"` on an `a` reference in the main text.
- `epub:type="footnote"` on an `aside` containing one note.
- `epub:type="backlink"` on the link returning to the reference.
- `role="doc-noteref"`, `role="doc-footnote"`, and `role="doc-backlink"` may provide the corresponding accessibility roles.

The reference should have a fragment `href` to an ID in the same XHTML document whenever the note is local. A reader that does not implement popup notes can still follow the ordinary link and display the `aside` content.

Do not treat arbitrary attributes such as `zy-footnote` as standard EPUB semantics. They are converter-specific metadata and are safe to normalize only when the attribute is attached to a clear note marker (for this skill, an image marker with non-empty note text).

Official references:

- https://www.w3.org/TR/epub-ssv-11/
- https://www.w3.org/TR/epub-overview-33/
