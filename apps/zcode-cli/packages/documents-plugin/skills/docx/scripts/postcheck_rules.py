"""Postcheck rules: the things a human would notice and a schema check would not.

Every rule answers one question about the rendered page, not about XML legality.
Each returns a Finding; the runner in postcheck.py decides how loud to be.

Rules are registered by name so a caller can run a subset — the SKILL tells the
agent which subset matters for the route it took.
"""

from __future__ import annotations

from dataclasses import dataclass

from postcheck_document import DocumentContext

# 连续空段落到这个数量就开始像一页空白，而不是"留白"。
BLANK_PARAGRAPH_RUN = 5
# 中文正文首行缩进的合理区间（缇）。缺缩进的中文正文读起来是一堵墙。
CJK_INDENT_MIN = 200
CJK_INDENT_MAX = 800
# 短于这个长度的段落视为标题/标签而非正文：首行缩进对单行文本没有意义，
# 拿它去要求封面标题只会产出噪声。
CJK_BODY_MIN_CHARS = 20
# 这些字体常不在目标机器上，出现就要提示。
FALLBACK_RISK_FONTS = {
    "Noto Sans SC",
    "Noto Serif SC",
    "Source Han Sans",
    "Source Han Serif",
    "LXGW WenKai",
    "霞鹜文楷",
}
CJK_RE = None


@dataclass
class Finding:
    name: str
    ok: bool
    message: str
    severity: str = "warning"

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "ok": self.ok,
            "message": self.message,
            "severity": self.severity,
        }


def _has_cjk(text: str) -> bool:
    global CJK_RE
    if CJK_RE is None:
        import re

        CJK_RE = re.compile(r"[一-鿿㐀-䶿]")
    return bool(CJK_RE.search(text))


def check_blank_pages(doc: DocumentContext) -> Finding:
    """Trailing page breaks and long empty runs — both render as a blank page."""
    paragraphs = doc.paragraphs
    if not paragraphs:
        return Finding("blank-pages", True, "no paragraph content")

    problems: list[str] = []

    # 文档末尾一个只含分页符的段落，会在最后一页后再吐一张空白页。
    last = paragraphs[-1]
    if last.has_page_break and not last.text.strip() and not last.has_drawing:
        problems.append("trailing page break at document end")

    # 连续空段：留白和空白页的区别只在数量上。
    run = 0
    worst = 0
    for paragraph in paragraphs:
        empty = (
            not paragraph.text.strip()
            and not paragraph.has_page_break
            and not paragraph.has_drawing
        )
        run = run + 1 if empty else 0
        worst = max(worst, run)
    if worst >= BLANK_PARAGRAPH_RUN:
        problems.append(f"{worst} consecutive empty paragraphs")

    if problems:
        return Finding("blank-pages", False, "; ".join(problems))
    return Finding("blank-pages", True, f"no blank-page pattern (longest empty run {worst})")


def check_line_spacing(doc: DocumentContext) -> Finding:
    """Body paragraphs should share one line spacing; mixed values read as noise."""
    spacings: dict[str, int] = {}
    for paragraph in doc.paragraphs:
        if paragraph.is_in_table or paragraph.is_list_item:
            continue
        if not paragraph.text.strip():
            continue
        for spacing in paragraph.element.iter(f"{{http://schemas.openxmlformats.org/wordprocessingml/2006/main}}spacing"):
            value = spacing.get(f"{{http://schemas.openxmlformats.org/wordprocessingml/2006/main}}line")
            if value:
                spacings[value] = spacings.get(value, 0) + 1
    if len(spacings) <= 1:
        return Finding("line-spacing", True, "body line spacing is uniform")
    return Finding(
        "line-spacing",
        False,
        f"{len(spacings)} distinct line spacings in body text: {sorted(spacings)}",
    )


def check_table_margins(doc: DocumentContext) -> Finding:
    """Cells without padding put text hard against the grid line."""
    if not doc.tables:
        return Finding("table-margins", True, "no tables")
    missing = sum(t.cells_without_margins for t in doc.tables)
    if missing:
        return Finding("table-margins", False, f"{missing} cell(s) have no tcMar padding")
    return Finding("table-margins", True, "all cells carry padding")


def check_table_pagination(doc: DocumentContext) -> Finding:
    """Header rows need tblHeader; data rows need cantSplit, or a row splits across pages."""
    if not doc.tables:
        return Finding("table-pagination", True, "no tables")
    without_header = [t for t in doc.tables if t.row_count > 1 and t.header_rows_with_tblHeader == 0]
    splittable = sum(t.rows_without_cantSplit for t in doc.tables)
    problems = []
    if without_header:
        problems.append(f"{len(without_header)} multi-row table(s) have no tblHeader header row")
    if splittable:
        problems.append(f"{splittable} row(s) lack cantSplit")
    if problems:
        return Finding("table-pagination", False, "; ".join(problems))
    return Finding("table-pagination", True, "header rows repeat and data rows do not split")


def check_image_overflow(doc: DocumentContext) -> Finding:
    """An image wider than the text column spills into or past the margin."""
    usable = doc.widest_usable_twips()
    if usable is None:
        return Finding("image-overflow", True, "page geometry unknown; skipped")
    emu_per_twip = 635  # 1 twip = 635 EMU
    overflow = [i for i in doc.images if i.width_emu and i.width_emu > usable * emu_per_twip]
    if overflow:
        return Finding(
            "image-overflow",
            False,
            f"{len(overflow)} image(s) exceed the {usable}-twip text column",
        )
    return Finding("image-overflow", True, f"{len(doc.images)} image(s) within the text column")


def check_font_fallback(doc: DocumentContext) -> Finding:
    """Fonts that only exist on the build machine substitute silently on the user's."""
    risky = sorted(doc.fonts_declared & FALLBACK_RISK_FONTS)
    if risky:
        return Finding(
            "font-fallback",
            False,
            f"fonts likely missing on the target machine: {', '.join(risky)}",
        )
    return Finding("font-fallback", True, "no known fallback-risk fonts declared")


def check_cjk_indent(doc: DocumentContext) -> Finding:
    """Chinese body paragraphs need a first-line indent; Latin convention does not apply."""
    offenders = []
    for paragraph in doc.paragraphs:
        if paragraph.is_in_table or paragraph.is_list_item or paragraph.is_centered:
            continue
        if not _has_cjk(paragraph.text):
            continue
        if paragraph.style and "heading" in paragraph.style.lower():
            continue
        # 单行短文本是标题或标签，不是正文——缩进规则不适用。
        if len(paragraph.text.strip()) < CJK_BODY_MIN_CHARS:
            continue
        indent = paragraph.first_line_indent_twips
        if indent is None or not (CJK_INDENT_MIN <= indent <= CJK_INDENT_MAX):
            offenders.append(paragraph.index)
    if offenders:
        return Finding(
            "cjk-indent",
            False,
            f"{len(offenders)} Chinese body paragraph(s) without a 2-character first-line indent",
        )
    return Finding("cjk-indent", True, "Chinese body paragraphs are indented")


def check_heading_continuity(doc: DocumentContext) -> Finding:
    """Skipping a level (H1 → H3) breaks the document outline readers navigate by."""
    levels = []
    for paragraph in doc.paragraphs:
        style = (paragraph.style or "").lower()
        if style.startswith("heading"):
            try:
                levels.append(int(style.replace("heading", "").strip()))
            except ValueError:
                continue
    gaps = [
        (a, b) for a, b in zip(levels, levels[1:]) if b > a + 1
    ]
    if gaps:
        return Finding(
            "heading-continuity",
            False,
            f"heading levels skip: {[(a, b) for a, b in gaps]}",
        )
    return Finding("heading-continuity", True, "heading levels are contiguous")


def check_numbering_continuity(doc: DocumentContext) -> Finding:
    """A numbered list with gaps in its numId sequence restarts visibly."""
    if not doc.numbering_ids:
        return Finding("numbering-continuity", True, "no numbered lists")
    ids = sorted(doc.numbering_ids, key=lambda v: (len(v), v))
    numeric = [int(v) for v in ids if v.isdigit()]
    gaps = [b for a, b in zip(numeric, numeric[1:]) if b != a + 1]
    if gaps:
        return Finding(
            "numbering-continuity",
            False,
            f"numbering ids are not contiguous: {numeric}",
        )
    return Finding("numbering-continuity", True, f"{len(ids)} numbering id(s), contiguous")


def check_cover_separation(doc: DocumentContext) -> Finding:
    """Cover and body must sit in different sections, or page numbering runs from the cover."""
    if len(doc.sections) < 2:
        return Finding(
            "cover-separation",
            False,
            "only one section: the cover cannot have its own page numbering",
        )
    return Finding("cover-separation", True, f"{len(doc.sections)} sections")


def check_shading_type(doc: DocumentContext) -> Finding:
    """SOLID fill with a dark colour is the "whole cell turned black" failure."""
    black = []
    for table in doc.tables:
        for shading in table.element.iter(
            f"{{http://schemas.openxmlformats.org/wordprocessingml/2006/main}}shd"
        ):
            fill = (shading.get(
                f"{{http://schemas.openxmlformats.org/wordprocessingml/2006/main}}fill"
            ) or "").lower()
            if fill in ("000000", "auto", "") and shading.get(
                f"{{http://schemas.openxmlformats.org/wordprocessingml/2006/main}}val"
            ) == "clear":
                black.append(table.index)
                break
    if black:
        return Finding(
            "shading-type",
            False,
            f"{len(black)} table(s) shade cells with a black/auto clear fill",
        )
    return Finding("shading-type", True, "no black-fill shading")


RULES = {
    "blank-pages": check_blank_pages,
    "line-spacing": check_line_spacing,
    "table-margins": check_table_margins,
    "table-pagination": check_table_pagination,
    "image-overflow": check_image_overflow,
    "font-fallback": check_font_fallback,
    "cjk-indent": check_cjk_indent,
    "heading-continuity": check_heading_continuity,
    "numbering-continuity": check_numbering_continuity,
    "cover-separation": check_cover_separation,
    "shading-type": check_shading_type,
}

DEFAULT_RULES = tuple(RULES)
