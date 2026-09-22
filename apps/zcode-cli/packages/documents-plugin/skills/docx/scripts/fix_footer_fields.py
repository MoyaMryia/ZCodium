#!/usr/bin/env python3
"""Make footer page numbers survive WPS as well as Word.

docx-js writes a bare ``PAGE`` field instruction into footers. Word resolves the
number format from the section's <w:pgNumType>, but WPS ignores that and renders
the raw instruction text — the reader sees "PAGE \\* arabic \\* MERGEFORMAT"
where a page number should be.

Two things get fixed:

  1. Every footer's PAGE field gains an explicit format switch, taken from the
     section that actually references that footer (via <w:footerReference>),
     not from a guessed index.
  2. The empty <w:pgNumType/> elements docx-js emits on cover sections are
     removed; WPS reads them as "restart numbering here".

Usage:
    python3 fix_footer_fields.py <file.docx>
    python3 fix_footer_fields.py <file.docx> --dry-run
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

# 尚未带格式开关的裸 PAGE。
#
# 正则里 `\*` 匹配的是字面星号，不是「反斜杠加星号」——OOXML 的格式开关长这样：
# ` \* arabic `。要匹配字面反斜杠必须写 `\\`。若把负向断言写成 `(?!\s*\*)`，
# 它永远不生效，重复运行会把开关一次次叠上去。
BARE_PAGE = re.compile(r"\bPAGE\b(?!\s*\\\*)")
ARABIC = r" PAGE \* arabic \* MERGEFORMAT "
ROMAN = r" PAGE \* ROMAN \* MERGEFORMAT "
EMPTY_PGNUM = re.compile(r"<w:pgNumType\s*/>")

# 罗马数字的 fmt 取值；其余一律按阿拉伯数字处理。
ROMAN_FORMATS = {"upperRoman", "lowerRoman"}


def _footer_format_map(document_xml: str) -> dict[str, str]:
    """Map each footer part to the page-number format of the section using it.

    A section may reference several footers (first / even / default) and may
    reference none, in which case it inherits the previous section's footer —
    OOXML's inheritance rule, and the reason this cannot be done by index.
    """
    root = ET.fromstring(document_xml)
    inherited = "decimal"
    mapping: dict[str, str] = {}

    for sectpr in root.iter(f"{W}sectPr"):
        pgnum = sectpr.find(f"{W}pgNumType")
        if pgnum is not None and pgnum.get(f"{W}fmt"):
            inherited = pgnum.get(f"{W}fmt")
        for reference in sectpr.findall(f"{W}footerReference"):
            target = reference.get(
                "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
            )
            if target:
                mapping[target] = inherited
    return mapping


def _resolve_footer_targets(document_xml: str, rels_xml: str | None) -> dict[str, str]:
    """rId → footer part name, so the format map can be keyed by part name."""
    if rels_xml is None:
        return {}
    rels = ET.fromstring(rels_xml)
    resolved: dict[str, str] = {}
    for relationship in rels.findall(
        "{http://schemas.openxmlformats.org/package/2006/relationships}Relationship"
    ):
        rid = relationship.get("Id")
        target = relationship.get("Target") or ""
        if rid and target.startswith("footer"):
            resolved[rid] = f"word/{target.lstrip('/')}"
    return resolved


def patch_footer(xml: str, fmt: str) -> tuple[str, int]:
    """Give the PAGE field in one footer an explicit format switch.

    The spaces around the switch belong to the field grammar — a switch glued to
    the keyword is not recognised. Only the bare keyword is matched, so a footer
    that already carries a switch is left alone and re-runs are idempotent.
    """
    replacement = ROMAN if fmt in ROMAN_FORMATS else ARABIC
    return BARE_PAGE.subn(replacement.strip(), xml)


def fix_footer_fields(docx_path: str | Path, dry_run: bool = False) -> dict:
    docx_path = Path(docx_path)
    with zipfile.ZipFile(docx_path) as archive:
        names = archive.namelist()
        contents = {name: archive.read(name) for name in names}

    document_name = "word/document.xml"
    document_xml = contents.get(document_name, b"").decode("utf-8")
    rels_name = "word/_rels/document.xml.rels"
    rels_xml = contents.get(rels_name, b"").decode("utf-8") if rels_name in contents else None

    rid_format = _footer_format_map(document_xml)
    rid_target = _resolve_footer_targets(document_xml, rels_xml)
    part_format = {
        rid_target[rid]: fmt for rid, fmt in rid_format.items() if rid in rid_target
    }

    footers = sorted(
        name for name in names if name.startswith("word/footer") and name.endswith(".xml")
    )

    changed: list[str] = []
    pgnum_removed = 0
    for name in footers:
        xml = contents[name].decode("utf-8")
        # 没有被任何节引用的页脚按阿拉伯数字处理：那是 docx-js 的默认。
        patched, hits = patch_footer(xml, part_format.get(name, "decimal"))
        patched, removed = EMPTY_PGNUM.subn("", patched)
        if hits or removed:
            contents[name] = patched.encode("utf-8")
            changed.append(name)
            pgnum_removed += removed

    # 封面节的空 pgNumType 在 document.xml 里，不在页脚里。
    document_stripped, document_removed = EMPTY_PGNUM.subn("", document_xml)
    if document_removed:
        contents[document_name] = document_stripped.encode("utf-8")
        pgnum_removed += document_removed

    if changed and not dry_run:
        # 原子替换：先写临时文件再搬回，避免写一半损坏原文件。
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
        "footers_scanned": len(footers),
        "footers_changed": len(changed),
        "changed": changed,
        "footer_formats": {name: part_format.get(name, "decimal") for name in footers},
        "empty_pgnum_removed": pgnum_removed,
        "dry_run": dry_run,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("docx")
    parser.add_argument("--dry-run", action="store_true", help="report without writing")
    args = parser.parse_args(argv)

    if not Path(args.docx).is_file():
        print(f"error: not a file: {args.docx}", file=sys.stderr)
        return 2

    result = fix_footer_fields(args.docx, dry_run=args.dry_run)
    print(f"footers scanned: {result['footers_scanned']}")
    print(f"footers changed: {result['footers_changed']} {result['changed']}")
    print(f"footer formats:  {result['footer_formats']}")
    print(f"empty pgNumType removed: {result['empty_pgnum_removed']}")
    if result["dry_run"]:
        print("dry run: nothing written")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
