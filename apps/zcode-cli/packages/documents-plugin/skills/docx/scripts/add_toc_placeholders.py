#!/usr/bin/env python3
"""Show something in a freshly built TOC instead of an empty field.

A TOC in a .docx is a field: begin → instruction → separate → cached result →
end. Word fills the cached result when the document opens, but only if
<w:updateFields/> is set; until then the reader sees whatever is cached, and a
programmatically built document caches nothing. The reader gets a blank block
where the table of contents should be.

This writes placeholder entries into the cached region, taken from the
document's own headings, and makes sure updateFields is on so Word replaces
them with real page numbers on first open.

Usage:
    python3 add_toc_placeholders.py <file.docx>              # auto-extract H1-H3
    python3 add_toc_placeholders.py <file.docx> --entries '[{"level":1,"text":"…","page":"1"}]'
    python3 add_toc_placeholders.py <file.docx> --dry-run
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

# ElementTree 默认把未注册的前缀序列化成 ns0/ns1。语义上等价，但会让整个部件
# 的前缀在一夜之间全变，diff 噪声大到没法 review，所以显式注册。
ET.register_namespace("w", W[1:-1])

# 图表题注不是章节标题，混进目录会让读者以为少了一章。
CAPTION_PREFIX = re.compile(r"^\s*(表|图|附表|插图|表格|图表|Figure|Fig\.?|Table)\s*[\d一二三四五六七八九十]*[:：.]")
MAX_LEVEL = 3
# 占位页码。Word 打开时会用 updateFields 重算，这里只求看起来不像坏的。
PLACEHOLDER_PAGE = "1"


def _local(tag: str) -> str:
    return tag.split("}")[-1]


def extract_headings(document_xml: str, max_level: int = MAX_LEVEL) -> list[dict]:
    """Headings in document order, with the level Word will render them at."""
    root = ET.fromstring(document_xml)
    headings: list[dict] = []
    for paragraph in root.iter(f"{W}p"):
        ppr = paragraph.find(f"{W}pPr")
        if ppr is None:
            continue
        pstyle = ppr.find(f"{W}pStyle")
        if pstyle is None:
            continue
        style = (pstyle.get(f"{W}val") or "").lower()
        if not style.startswith("heading"):
            continue
        try:
            level = int(style.replace("heading", "").strip())
        except ValueError:
            continue
        if level > max_level:
            continue
        text = "".join(node.text or "" for node in paragraph.iter(f"{W}t")).strip()
        if not text or CAPTION_PREFIX.match(text):
            continue
        headings.append({"level": level, "text": text})
    return headings


def _field_char_spans(root: ET.Element) -> list[ET.Element]:
    return [n for n in root.iter(f"{W}fldChar")]


def _has_toc_field(root: ET.Element) -> bool:
    """True when the body carries a TOC field (begin … separate … end)."""
    chars = [c.get(f"{W}fldCharType") for c in _field_char_spans(root)]
    return "begin" in chars and "separate" in chars and "end" in chars


def _entry_paragraph(entry: dict) -> ET.Element:
    level = int(entry.get("level", 1))
    text = str(entry.get("text", ""))
    page = str(entry.get("page", PLACEHOLDER_PAGE))
    indent = "240" if level <= 1 else "480"
    xml = (
        f'<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f'<w:pPr><w:pStyle w:val="TOC{level}"/>'
        f'<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9000"/></w:tabs>'
        f'<w:ind w:left="{indent}"/></w:pPr>'
        f'<w:r><w:t xml:space="preserve">{_escape(text)}</w:t></w:r>'
        f'<w:r><w:tab/></w:r>'
        f'<w:r><w:t>{_escape(page)}</w:t></w:r>'
        f"</w:p>"
    )
    return ET.fromstring(xml)


def _escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def ensure_update_fields(settings_xml: str) -> tuple[str, bool]:
    """Turn on <w:updateFields> so Word recomputes the TOC when the file opens."""
    root = ET.fromstring(settings_xml)
    if root.find(f"{W}updateFields") is not None:
        return settings_xml, False
    node = ET.Element(f"{W}updateFields")
    node.set(f"{W}val", "true")
    # CT_Settings 里 updateFields 位于 defaultTabStop 之后、compat 之前。
    # 标准库 ElementTree 没有 lxml 的 addnext，用 insert + 索引。
    anchor_index = None
    for tag in ("defaultTabStop", "hyphenationZone"):
        found = root.find(f"{W}{tag}")
        if found is not None:
            anchor_index = list(root).index(found)
            break
    if anchor_index is not None:
        root.insert(anchor_index + 1, node)
    else:
        root.insert(0, node)
    return ET.tostring(root, encoding="unicode"), True


def insert_placeholders(document_xml: str, entries: list[dict]) -> tuple[str, int, bool]:
    """Put placeholder entries between the TOC field's separate and end chars.

    Returns the new XML, how many entries were placed, and whether the XML
    actually changed. Re-running on an already-patched document places the same
    entries again but changes nothing, so the third value stays False.
    """
    root = ET.fromstring(document_xml)
    if not _has_toc_field(root):
        return document_xml, 0, False

    chars = _field_char_spans(root)
    separate_at = next(
        (i for i, c in enumerate(chars) if c.get(f"{W}fldCharType") == "separate"), None
    )
    end_at = next(
        (i for i, c in enumerate(chars) if c.get(f"{W}fldCharType") == "end"), None
    )
    if separate_at is None or end_at is None or end_at <= separate_at:
        return document_xml, 0, False

    # 域字符散落在各 run 里，先定位它们所属的顶层块，再在块之间插入。
    body = root.find(f"{W}body")
    if body is None:
        return document_xml, 0, False
    blocks = list(body)
    sep_block = _block_index_of(chars[separate_at], blocks)
    end_block = _block_index_of(chars[end_at], blocks)
    if sep_block is None or end_block is None or end_block <= sep_block:
        return document_xml, 0, False

    # 清掉 separate 与 end 之间的旧内容，避免重复运行不断累积。
    for block in blocks[sep_block + 1 : end_block]:
        body.remove(block)

    # 删除后 end_block 已经失效：end 块此刻的新下标正是 sep_block + 1。
    # 若沿用旧的 end_block，条目会被插到 end 域字符之后，第二遍就跑出域外。
    insert_at = sep_block + 1
    for entry in reversed(entries):
        body.insert(insert_at, _entry_paragraph(entry))
    updated = ET.tostring(root, encoding="unicode")
    return updated, len(entries), updated != document_xml


def _block_index_of(node: ET.Element, blocks: list[ET.Element]) -> int | None:
    for index, block in enumerate(blocks):
        if any(descendant is node for descendant in block.iter()):
            return index
    return None


def add_toc_placeholders(
    docx_path: str | Path,
    entries: list[dict] | None = None,
    dry_run: bool = False,
) -> dict:
    docx_path = Path(docx_path)
    with zipfile.ZipFile(docx_path) as archive:
        names = archive.namelist()
        contents = {name: archive.read(name) for name in names}

    document_name = "word/document.xml"
    document_xml = contents[document_name].decode("utf-8")
    used_auto = entries is None
    if used_auto:
        entries = extract_headings(document_xml)

    updated, inserted, document_changed = insert_placeholders(document_xml, entries)
    contents[document_name] = updated.encode("utf-8")

    settings_changed = False
    settings_name = "word/settings.xml"
    if settings_name in contents:
        settings_xml, settings_changed = ensure_update_fields(
            contents[settings_name].decode("utf-8")
        )
        if settings_changed:
            contents[settings_name] = settings_xml.encode("utf-8")

    wrote = (document_changed or settings_changed) and not dry_run
    if wrote:
        handle = tempfile.NamedTemporaryFile(
            dir=docx_path.parent, suffix=".docx", delete=False
        )
        temporary = Path(handle.name)
        handle.close()
        try:
            with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED) as out:
                for name in names:
                    out.writestr(name, contents[name])
            shutil.move(str(temporary), str(docx_path))
        finally:
            temporary.unlink(missing_ok=True)

    return {
        "entries_inserted": inserted,
        "entries_source": "auto-extracted headings" if used_auto else "explicit --entries",
        "update_fields_ensured": settings_changed,
        "document_changed": document_changed,
        "written": wrote,
        "dry_run": dry_run,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("docx")
    parser.add_argument("--entries", default="", help="JSON array of {level,text,page}")
    parser.add_argument("--dry-run", action="store_true", help="report without writing")
    args = parser.parse_args(argv)

    if not Path(args.docx).is_file():
        print(f"error: not a file: {args.docx}", file=sys.stderr)
        return 2

    entries = None
    if args.entries:
        try:
            entries = json.loads(args.entries)
        except json.JSONDecodeError as error:
            print(f"error: --entries is not valid JSON: {error}", file=sys.stderr)
            return 2
        if not isinstance(entries, list):
            print("error: --entries must be a JSON array", file=sys.stderr)
            return 2

    result = add_toc_placeholders(args.docx, entries, dry_run=args.dry_run)
    print(f"entries source:    {result['entries_source']}")
    print(f"entries inserted:  {result['entries_inserted']}")
    print(f"updateFields on:   {result['update_fields_ensured']}")
    print(f"written:           {result['written']}")
    if result["dry_run"]:
        print("dry run: nothing written")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
