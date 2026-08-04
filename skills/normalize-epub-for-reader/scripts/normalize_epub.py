#!/usr/bin/env python3
"""Create a conservative, standard-annotation EPUB copy."""

from __future__ import annotations

import argparse
import copy
import html as html_entities
import json
import re
import sys
import tempfile
import zipfile
from pathlib import Path


EPUB_NAMESPACE = "http://www.idpf.org/2007/ops"
XHTML_PATTERN = re.compile(r"\.(?:xhtml?|html?)$", re.IGNORECASE)
NOTE_IMAGE_PATTERN = re.compile(
    r"<img\b(?=[^>]*\b(?:zy-footnote|data-footnote|data-footnote-text|data-note-text)\s*=)[^>]*?/?>",
    re.IGNORECASE | re.DOTALL,
)
NOTE_ATTRIBUTE_PATTERN = re.compile(
    r"\b(?:zy-footnote|data-footnote|data-footnote-text|data-note-text)\s*=\s*([\"'])(.*?)\1",
    re.IGNORECASE | re.DOTALL,
)
EPUB_NAMESPACE_PATTERN = re.compile(r"\bxmlns:epub\s*=", re.IGNORECASE)
HTML_OPEN_PATTERN = re.compile(r"<html\b([^>]*)>", re.IGNORECASE)
BODY_CLOSE_PATTERN = re.compile(r"</body>", re.IGNORECASE)
HTML_CLOSE_PATTERN = re.compile(r"</html>", re.IGNORECASE)
GENERATED_REF_PATTERN = re.compile(
    r'<a\b[^>]*\bid="(mowen-noteref-\d+)"[^>]*href="#(mowen-footnote-\d+)"[^>]*epub:type="noteref"',
    re.IGNORECASE,
)
GENERATED_NOTE_PATTERN = re.compile(
    r'<aside\b[^>]*\bid="(mowen-footnote-\d+)"[^>]*epub:type="footnote"',
    re.IGNORECASE,
)
GENERATED_BACKLINK_PATTERN = re.compile(
    r'<a\b[^>]*href="#(mowen-noteref-\d+)"[^>]*epub:type="backlink"',
    re.IGNORECASE,
)


def normalize_note_text(raw: str) -> str:
    return re.sub(r"\s+", " ", html_entities.unescape(raw)).strip()


def escape_text(value: str) -> str:
    return html_entities.escape(value, quote=False)


def ensure_epub_namespace(source: str) -> str:
    def add_namespace(match: re.Match[str]) -> str:
        attributes = match.group(1)
        if EPUB_NAMESPACE_PATTERN.search(attributes):
            return match.group(0)
        return f'<html{attributes} xmlns:epub="{EPUB_NAMESPACE}">'

    return HTML_OPEN_PATTERN.sub(add_namespace, source, count=1)


def marker_text(number: int, style: str) -> str:
    return "注" if style == "text" else str(number)


def reference_markup(number: int, style: str) -> str:
    suffix = f"{number:04d}"
    reference_id = f"mowen-noteref-{suffix}"
    note_id = f"mowen-footnote-{suffix}"
    visible_marker = escape_text(marker_text(number, style))
    return (
        f'<a id="{reference_id}" href="#{note_id}" epub:type="noteref" '
        f'role="doc-noteref" aria-label="注释"><sup>{visible_marker}</sup></a>'
    )


def note_markup(number: int, text: str) -> str:
    suffix = f"{number:04d}"
    note_id = f"mowen-footnote-{suffix}"
    reference_id = f"mowen-noteref-{suffix}"
    return (
        f'\n    <aside id="{note_id}" epub:type="footnote" role="doc-footnote">'
        f'<p>{escape_text(text)} '
        f'<a href="#{reference_id}" epub:type="backlink" role="doc-backlink">↩</a>'
        f"</p></aside>"
    )


def transform_document(source: str, next_number: int, style: str) -> tuple[str, int, list[dict[str, str | int]]]:
    notes: list[dict[str, str | int]] = []

    def replace_marker(match: re.Match[str]) -> str:
        nonlocal next_number
        attribute = NOTE_ATTRIBUTE_PATTERN.search(match.group(0))
        if not attribute:
            return match.group(0)
        text = normalize_note_text(attribute.group(2))
        if not text:
            return match.group(0)
        number = next_number
        next_number += 1
        notes.append({"number": number, "text": text})
        return reference_markup(number, style)

    transformed = NOTE_IMAGE_PATTERN.sub(replace_marker, source)
    if not notes:
        return source, next_number, notes

    transformed = ensure_epub_namespace(transformed)
    appended_notes = "".join(note_markup(int(note["number"]), str(note["text"])) for note in notes)
    if BODY_CLOSE_PATTERN.search(transformed):
        transformed = BODY_CLOSE_PATTERN.sub(f"{appended_notes}\n</body>", transformed, count=1)
    elif HTML_CLOSE_PATTERN.search(transformed):
        transformed = HTML_CLOSE_PATTERN.sub(f"{appended_notes}\n</html>", transformed, count=1)
    else:
        transformed += appended_notes
    return transformed, next_number, notes


def cloned_info(info: zipfile.ZipInfo, compression: int) -> zipfile.ZipInfo:
    result = copy.copy(info)
    result.compress_type = compression
    return result


def inspect_archive(path: Path) -> dict[str, object]:
    with zipfile.ZipFile(path, "r") as archive:
        bad_entry = archive.testzip()
        infos = archive.infolist()
        mimetype = archive.read("mimetype") if "mimetype" in archive.namelist() else b""
        first = infos[0].filename if infos else ""
        mimetype_info = archive.getinfo("mimetype") if "mimetype" in archive.namelist() else None
        xhtml_names = [info.filename for info in infos if XHTML_PATTERN.search(info.filename) and not info.is_dir()]
        custom_markers = 0
        noteref_ids: set[str] = set()
        noteref_targets: set[str] = set()
        footnotes: set[str] = set()
        backlinks: set[str] = set()
        for name in xhtml_names:
            text = archive.read(name).decode("utf-8")
            custom_markers += len(NOTE_IMAGE_PATTERN.findall(text))
            noteref_ids.update(match.group(1) for match in GENERATED_REF_PATTERN.finditer(text))
            noteref_targets.update(match.group(2) for match in GENERATED_REF_PATTERN.finditer(text))
            footnotes.update(match.group(1) for match in GENERATED_NOTE_PATTERN.finditer(text))
            backlinks.update(match.group(1) for match in GENERATED_BACKLINK_PATTERN.finditer(text))
        return {
            "zip_ok": bad_entry is None,
            "first_entry": first,
            "mimetype": mimetype.decode("utf-8", errors="replace"),
            "mimetype_first": first == "mimetype",
            "mimetype_uncompressed": bool(mimetype_info and mimetype_info.compress_type == zipfile.ZIP_STORED),
            "xhtml_documents": len(xhtml_names),
            "custom_note_markers": custom_markers,
            "generated_noterefs": len(noteref_ids),
            "generated_footnotes": len(footnotes),
            "generated_backlinks": len(backlinks),
            "generated_ids_match": noteref_ids == backlinks and noteref_targets == footnotes,
        }


def validate_output(path: Path) -> dict[str, object]:
    report = inspect_archive(path)
    required = (
        report["zip_ok"],
        report["mimetype"] == "application/epub+zip",
        report["mimetype_first"],
        report["mimetype_uncompressed"],
        report["custom_note_markers"] == 0,
        report["generated_ids_match"],
    )
    if not all(required):
        raise RuntimeError(f"Output validation failed: {json.dumps(report, ensure_ascii=False)}")
    return report


def normalize(input_path: Path, output_path: Path, style: str, force: bool) -> dict[str, object]:
    if input_path.resolve() == output_path.resolve():
        raise ValueError("Refusing to overwrite the input EPUB; choose a separate output path")
    if output_path.exists() and not force:
        raise FileExistsError(f"Output exists; pass --force to replace it: {output_path}")
    with zipfile.ZipFile(input_path, "r") as source:
        if source.read("mimetype") != b"application/epub+zip":
            raise ValueError("Input is not a valid EPUB container: mimetype is missing or incorrect")
        infos = source.infolist()
        ordered_infos = sorted(infos, key=lambda info: (info.filename != "mimetype", infos.index(info)))
        converted = 0
        changed_documents: list[dict[str, object]] = []
        next_number = 1
        with tempfile.NamedTemporaryFile(prefix="epub-normalize-", suffix=".epub", delete=False, dir=output_path.parent) as handle:
            temporary_path = Path(handle.name)
        try:
            with zipfile.ZipFile(temporary_path, "w", allowZip64=True) as target:
                for info in ordered_infos:
                    data = source.read(info.filename)
                    if XHTML_PATTERN.search(info.filename) and not info.is_dir():
                        source_text = data.decode("utf-8")
                        transformed, next_number, notes = transform_document(source_text, next_number, style)
                        if notes:
                            data = transformed.encode("utf-8")
                            converted += len(notes)
                            changed_documents.append({"name": info.filename, "notes": len(notes)})
                    compression = zipfile.ZIP_STORED if info.filename == "mimetype" or info.is_dir() else zipfile.ZIP_DEFLATED
                    target.writestr(cloned_info(info, compression), data)
            report = validate_output(temporary_path)
            if output_path.exists() and force:
                output_path.unlink()
            temporary_path.replace(output_path)
        finally:
            if temporary_path.exists():
                temporary_path.unlink()
    return {"input": str(input_path), "output": str(output_path), "converted": converted, "changed_documents": changed_documents, "validation": report}


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a standard-annotation EPUB copy for the reader")
    parser.add_argument("input", type=Path, help="Source EPUB; never modified")
    parser.add_argument("output", type=Path, nargs="?", help="Output EPUB; defaults to '<name> - 标准兼容版.epub'")
    parser.add_argument("--force", action="store_true", help="Replace an existing output path")
    parser.add_argument("--dry-run", action="store_true", help="Inspect and report without writing an output EPUB")
    parser.add_argument("--marker-style", choices=("text", "number"), default="text", help="Visible noteref marker: 注 or a sequential number")
    args = parser.parse_args()
    input_path = args.input.resolve()
    if not input_path.is_file():
        raise FileNotFoundError(input_path)
    output_path = (args.output or input_path.with_name(f"{input_path.stem} - 标准兼容版.epub")).resolve()
    if args.dry_run:
        report = inspect_archive(input_path)
        print(json.dumps({"input": str(input_path), "dry_run": True, "inspection": report}, ensure_ascii=False, indent=2))
        return 0
    report = normalize(input_path, output_path, args.marker_style, args.force)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (FileNotFoundError, FileExistsError, ValueError, RuntimeError, zipfile.BadZipFile) as error:
        print(f"normalize_epub.py: {error}", file=sys.stderr)
        raise SystemExit(1)
