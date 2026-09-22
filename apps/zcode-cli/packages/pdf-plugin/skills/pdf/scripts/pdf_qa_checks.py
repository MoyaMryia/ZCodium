"""The fifteen pdf_qa rules: the things a reader notices and a clean build hides.

Every rule answers one question about the rendered pages, not about PDF legality,
and returns a Finding; the runner in pdf_qa.py decides how loud to be and what the
exit status is. Each threshold is a named constant, because a quality gate whose
numbers are scattered through the logic cannot be retuned or argued with. The
measurements the rules share — lines, columns, script classification — live in
pdf_qa_text.py.
"""

from __future__ import annotations

from dataclasses import dataclass

from pdf_qa_document import PdfContext
from pdf_qa_text import (
    FORMULA_MATH_RATIO,
    LINE_Y_TOLERANCE_PTS,
    compact_indexes,
    doubled_punctuation,
    fullwidth_beside_latin,
    halfwidth_beside_cjk,
    has_cjk,
    has_toc,
    hex_color,
    is_cjk_capable,
    is_latin_base,
    looks_like_cover,
    luminance,
    math_ratio,
    table_blocks,
    text_column_right,
)

SEVERITY_OK = "OK"
SEVERITY_WARN = "WARN"
SEVERITY_ERROR = "ERROR"

# 填充率：中间页铺不到这个比例就像一张没写完的纸；末页允许更空——结论、致谢、
# 参考文献的尾巴本来就短。低于 EMPTY 一档且几乎没字，那就不是"短"，是"漏了一页"。
MIDDLE_PAGE_FILL_MIN = 0.40
LAST_PAGE_FILL_MIN = 0.25
LAST_PAGE_EMPTY_FILL = 0.12
LAST_PAGE_EMPTY_WORDS = 10
# 容差（pt）：浮点误差不该报页尺寸不一致；poppler 的字形框偶尔会真超出一两个点。
PAGE_SIZE_TOLERANCE_PTS = 1.0
OVERFLOW_TOLERANCE_PTS = 1.0
# 左右边距相差超过这个值就是不对称：2.5cm 与 2cm 相差 14pt，肉眼可辨。
MARGIN_ASYMMETRY_TOLERANCE_PTS = 24.0
# 表格中线偏离页面中线超过这个值算未居中。
TABLE_CENTER_TOLERANCE_PTS = 12.0
# 海报封面背景离页边的距离占比；超过它就是没有出血。
BLEED_TOLERANCE = 0.05
# 用掉这么多不同颜色就不再是配色，是调色盘打翻了；亮度高于 NEAR_WHITE 的印不出来。
MAX_DISTINCT_COLORS = 8
NEAR_WHITE_LUMINANCE = 0.97
# 空白页判定的着墨率：一点抗锯齿都不算，但一个像素的墨迹也不算空白。
BLANK_INK_COVERAGE = 0.0005
# 公式行超出正文右边界这个值算溢出。
FORMULA_OVERFLOW_TOLERANCE_PTS = 2.0


@dataclass
class Finding:
    """One rule's conclusion. `ok` is derived: only OK counts as passing."""

    name: str
    severity: str
    message: str

    @property
    def ok(self) -> bool:
        return self.severity == SEVERITY_OK

    def to_dict(self) -> dict:
        return {"name": self.name, "ok": self.ok, "severity": self.severity, "message": self.message}


@dataclass
class Options:
    """The four switches, resolved once by the CLI."""

    poster: bool = False
    skip_cover: bool = False
    no_tables: bool = False
    formulas: bool = False


def check_last_page_fill(doc: PdfContext, options: Options) -> Finding:
    """A last page with almost nothing on it is a page that was forgotten."""
    if doc.page_count < 2:
        return Finding("last_page_fill", SEVERITY_OK, "single-page document; skipped")
    page = doc.pages[-1]
    if page.ink is None:
        return Finding("last_page_fill", SEVERITY_WARN, "last page could not be rendered; not judged")
    if page.ink.fill < LAST_PAGE_EMPTY_FILL and page.word_count <= LAST_PAGE_EMPTY_WORDS:
        return Finding(
            "last_page_fill",
            SEVERITY_ERROR,
            f"page {page.index} is {page.ink.fill:.0%} filled with {page.word_count} word(s)",
        )
    return Finding("last_page_fill", SEVERITY_OK, f"page {page.index} is {page.ink.fill:.0%} filled")


def check_punctuation(doc: PdfContext, options: Options) -> Finding:
    """Chinese set with halfwidth commas reads as machine translation."""
    text = doc.text
    if not has_cjk(text):
        return Finding("punctuation", SEVERITY_OK, "no CJK text; punctuation mixing not judged")
    problems: list[str] = []

    halfwidth = halfwidth_beside_cjk(text)
    if halfwidth:
        problems.append(f"{len(halfwidth)} halfwidth mark(s) beside Chinese (e.g. {halfwidth[0]!r})")

    fullwidth = fullwidth_beside_latin(text)
    if fullwidth:
        problems.append(f"{len(fullwidth)} fullwidth mark(s) beside Latin (e.g. {fullwidth[0]!r})")

    repeated = doubled_punctuation(text)
    if repeated:
        problems.append(f"{len(repeated)} doubled mark(s) (e.g. {repeated[0]!r})")

    if problems:
        return Finding("punctuation", SEVERITY_WARN, "; ".join(problems))
    return Finding("punctuation", SEVERITY_OK, "punctuation is consistent with the surrounding script")


def check_blank_pages(doc: PdfContext, options: Options) -> Finding:
    """A page with neither words nor ink prints as an empty sheet."""
    blank = [
        page.index
        for page in doc.pages
        if page.word_count == 0 and page.ink is not None and page.ink.coverage < BLANK_INK_COVERAGE
    ]
    if blank:
        return Finding("blank_pages", SEVERITY_ERROR, "blank page(s): " + ", ".join(str(n) for n in blank))
    empty = [page.index for page in doc.pages if page.word_count == 0]
    if empty:
        return Finding(
            "blank_pages",
            SEVERITY_WARN,
            "page(s) with no extractable text but carrying ink: " + ", ".join(str(n) for n in empty),
        )
    return Finding("blank_pages", SEVERITY_OK, f"no blank pages among {doc.page_count}")


def check_colors(doc: PdfContext, options: Options) -> Finding:
    """Too many colours is noise; a near-white one is invisible on paper."""
    colors = doc.colors
    if not colors.scanned:
        return Finding("colors", SEVERITY_WARN, colors.note)
    if not colors.used:
        return Finding("colors", SEVERITY_OK, "no colour operators in any content stream")
    problems: list[str] = []
    if colors.distinct > MAX_DISTINCT_COLORS:
        problems.append(f"{colors.distinct} distinct colours exceeds {MAX_DISTINCT_COLORS}")
    invisible = sorted(color for color in colors.used if luminance(color) >= NEAR_WHITE_LUMINANCE)
    if invisible:
        sample = ", ".join(hex_color(color) for color in invisible[:3])
        problems.append(f"{len(invisible)} near-white colour(s) that will not print: {sample}")
    if problems:
        return Finding("colors", SEVERITY_WARN, "; ".join(problems))
    return Finding("colors", SEVERITY_OK, f"{colors.distinct} distinct colour(s), all visible on white")


def check_page_size_consistency(doc: PdfContext, options: Options) -> Finding:
    """One stock for the whole document; a mixed-size PDF is a paste-up."""
    if doc.page_count < 2:
        return Finding("page_size_consistency", SEVERITY_OK, "single-page document; skipped")
    groups: list[tuple[float, float, list[int]]] = []
    for page in doc.pages:
        for width, height, indexes in groups:
            close = (
                abs(width - page.width) <= PAGE_SIZE_TOLERANCE_PTS
                and abs(height - page.height) <= PAGE_SIZE_TOLERANCE_PTS
            )
            if close:
                indexes.append(page.index)
                break
        else:
            groups.append((page.width, page.height, [page.index]))
    if len(groups) <= 1:
        width, height, _ = groups[0]
        return Finding(
            "page_size_consistency",
            SEVERITY_OK,
            f"{doc.page_count} pages at {width:.0f}x{height:.0f} pt",
        )
    detail = "; ".join(
        f"{width:.0f}x{height:.0f} pt on page(s) {compact_indexes(indexes)}"
        for width, height, indexes in groups
    )
    return Finding("page_size_consistency", SEVERITY_ERROR, f"{len(groups)} page sizes: {detail}")


def check_text_overflow(doc: PdfContext, options: Options) -> Finding:
    """A word whose box leaves the page is cut off by the trim, not by the margin."""
    offenders: list[str] = []
    for page in doc.pages:
        for word in page.words:
            if (
                word.x_max > page.width + OVERFLOW_TOLERANCE_PTS
                or word.x_min < -OVERFLOW_TOLERANCE_PTS
                or word.y_max > page.height + OVERFLOW_TOLERANCE_PTS
                or word.y_min < -OVERFLOW_TOLERANCE_PTS
            ):
                offenders.append(f"page {page.index}: {word.text!r}")
    if offenders:
        return Finding(
            "text_overflow",
            SEVERITY_ERROR,
            f"{len(offenders)} word(s) outside the page box (e.g. {offenders[0]})",
        )
    return Finding("text_overflow", SEVERITY_OK, "every word sits inside its page")


def check_content_fill_ratio(doc: PdfContext, options: Options) -> Finding:
    """A half-empty middle page means a float or a break landed wrong."""
    if doc.page_count < 2:
        return Finding("content_fill_ratio", SEVERITY_OK, "single-page document; skipped")
    problems: list[str] = []
    judged = 0
    for page in doc.pages:
        if page.ink is None:
            continue
        judged += 1
        threshold = LAST_PAGE_FILL_MIN if page.index == doc.page_count else MIDDLE_PAGE_FILL_MIN
        if page.ink.fill < threshold:
            problems.append(f"page {page.index} is {page.ink.fill:.0%} filled (< {threshold:.0%})")
    if not judged:
        return Finding("content_fill_ratio", SEVERITY_WARN, "no page could be rendered; not judged")
    if problems:
        return Finding("content_fill_ratio", SEVERITY_WARN, "; ".join(problems))
    return Finding("content_fill_ratio", SEVERITY_OK, f"{judged} page(s) filled above threshold")


def check_cover_bleed(doc: PdfContext, options: Options) -> Finding:
    """A poster cover whose background stops short of the edge cannot be trimmed."""
    if not options.poster:
        return Finding("cover_bleed", SEVERITY_OK, "skipped: pass --poster to check cover bleed")
    page = doc.pages[0]
    if page.ink is None:
        return Finding("cover_bleed", SEVERITY_WARN, "cover page could not be rendered; not judged")
    borders = (
        ("left", page.ink.left * page.width, page.width),
        ("right", page.ink.right * page.width, page.width),
        ("top", page.ink.top * page.height, page.height),
        ("bottom", page.ink.bottom * page.height, page.height),
    )
    side, gap, extent = max(borders, key=lambda border: border[1] / border[2])
    if gap / extent > BLEED_TOLERANCE:
        return Finding(
            "cover_bleed",
            SEVERITY_ERROR,
            f"cover ink stops {gap:.0f} pt short of the {side} edge ({gap / extent:.0%} of the page)",
        )
    return Finding("cover_bleed", SEVERITY_OK, "cover ink reaches every edge")


def check_margin_symmetry(doc: PdfContext, options: Options) -> Finding:
    """A body whose left and right margins differ reads as a mis-set geometry."""
    pages = doc.pages[1:] if options.skip_cover else doc.pages
    problems: list[str] = []
    for page in pages:
        if page.word_count == 0:
            continue
        left = min(word.x_min for word in page.words)
        right = page.width - max(word.x_max for word in page.words)
        if abs(left - right) > MARGIN_ASYMMETRY_TOLERANCE_PTS:
            problems.append(f"page {page.index}: left {left:.0f} pt vs right {right:.0f} pt")
    if problems:
        return Finding("margin_symmetry", SEVERITY_WARN, "; ".join(problems))
    skipped = " (first page skipped)" if options.skip_cover and doc.pages else ""
    return Finding("margin_symmetry", SEVERITY_OK, f"left and right margins agree{skipped}")


def check_table_centering(doc: PdfContext, options: Options) -> Finding:
    """A table that hangs to one side of the text column is visibly off-centre."""
    if options.no_tables:
        return Finding("table_centering", SEVERITY_OK, "skipped: pass without --no-tables to check centering")
    off_centre: list[str] = []
    tables = 0
    for page in doc.pages:
        for block in table_blocks(page):
            tables += 1
            left = min(word.x_min for row in block for word in row)
            right = max(word.x_max for row in block for word in row)
            offset = abs((left + right) / 2 - page.width / 2)
            if offset > TABLE_CENTER_TOLERANCE_PTS:
                off_centre.append(f"page {page.index}: centre off by {offset:.0f} pt")
    if not tables:
        return Finding("table_centering", SEVERITY_OK, "no table-like rows found")
    if off_centre:
        return Finding("table_centering", SEVERITY_WARN, "; ".join(off_centre))
    return Finding("table_centering", SEVERITY_OK, f"{tables} table(s) centred on the text column")


def check_font_embedding(doc: PdfContext, options: Options) -> Finding:
    """An unembedded font is substituted on the reader's machine and fails preflight."""
    if not doc.fonts:
        return Finding("font_embedding", SEVERITY_WARN, "no font reported by pdffonts")
    missing = sorted({font.name for font in doc.fonts if not font.embedded})
    if missing:
        return Finding("font_embedding", SEVERITY_ERROR, "font(s) not embedded: " + ", ".join(missing))
    return Finding("font_embedding", SEVERITY_OK, f"all {len(doc.fonts)} font(s) embedded")


def check_helvetica_in_cjk(doc: PdfContext, options: Options) -> Finding:
    """Chinese set in a base-14 Latin font prints as boxes, not as characters."""
    cjk_pages = [page.index for page in doc.pages if has_cjk(page.text)]
    if not cjk_pages:
        return Finding("helvetica_in_cjk", SEVERITY_OK, "no CJK text")
    capable = sorted({font.name for font in doc.fonts if is_cjk_capable(font)})
    if capable:
        return Finding(
            "helvetica_in_cjk",
            SEVERITY_OK,
            f"CJK text on page(s) {compact_indexes(cjk_pages)} set in {', '.join(capable)}",
        )
    latin = sorted({font.name for font in doc.fonts if is_latin_base(font)})
    if not latin:
        return Finding(
            "helvetica_in_cjk",
            SEVERITY_WARN,
            f"CJK text on page(s) {compact_indexes(cjk_pages)} with no CJK-capable font reported",
        )
    return Finding(
        "helvetica_in_cjk",
        SEVERITY_ERROR,
        f"CJK text on page(s) {compact_indexes(cjk_pages)} set in {', '.join(latin)}, which has no CJK glyphs",
    )


def check_metadata(doc: PdfContext, options: Options) -> Finding:
    """Title and author are what a reader sees in a viewer's title bar and library."""
    missing = [label for label in ("title", "author") if not doc.metadata.get(label)]
    if missing:
        return Finding("metadata", SEVERITY_WARN, "missing metadata field(s): " + ", ".join(missing))
    return Finding("metadata", SEVERITY_OK, "title and author are present")


def check_toc_without_cover(doc: PdfContext, options: Options) -> Finding:
    """A table of contents as the first thing a reader sees means the cover is missing."""
    if doc.page_count < 2:
        return Finding("toc_without_cover", SEVERITY_OK, "single-page document; skipped")
    if not has_toc(doc):
        return Finding("toc_without_cover", SEVERITY_OK, "no table of contents")
    if looks_like_cover(doc.pages[0]):
        return Finding("toc_without_cover", SEVERITY_OK, "table of contents follows a cover page")
    return Finding("toc_without_cover", SEVERITY_WARN, "table of contents present but page 1 is not a cover page")


def check_formula_overflow(doc: PdfContext, options: Options) -> Finding:
    """Display math is the widest thing on the page and the first to run over."""
    if not options.formulas:
        return Finding("formula_overflow", SEVERITY_OK, "skipped: pass --formulas to check formula overflow")
    column_right = text_column_right(doc)
    if column_right is None:
        return Finding("formula_overflow", SEVERITY_OK, "no plain text line to measure the column against")
    offenders: list[str] = []
    for page in doc.pages:
        for line in page.lines(LINE_Y_TOLERANCE_PTS):
            if math_ratio(" ".join(word.text for word in line)) < FORMULA_MATH_RATIO:
                continue
            reach = max(word.x_max for word in line)
            if reach > column_right + FORMULA_OVERFLOW_TOLERANCE_PTS:
                offenders.append(f"page {page.index}: reaches {reach:.0f} pt past the {column_right:.0f} pt column")
    if offenders:
        return Finding("formula_overflow", SEVERITY_ERROR, "; ".join(offenders[:3]))
    return Finding("formula_overflow", SEVERITY_OK, "formula lines stay inside the text column")


RULES = {
    "last_page_fill": check_last_page_fill,
    "punctuation": check_punctuation,
    "blank_pages": check_blank_pages,
    "colors": check_colors,
    "page_size_consistency": check_page_size_consistency,
    "text_overflow": check_text_overflow,
    "content_fill_ratio": check_content_fill_ratio,
    "cover_bleed": check_cover_bleed,
    "margin_symmetry": check_margin_symmetry,
    "table_centering": check_table_centering,
    "font_embedding": check_font_embedding,
    "helvetica_in_cjk": check_helvetica_in_cjk,
    "metadata": check_metadata,
    "toc_without_cover": check_toc_without_cover,
    "formula_overflow": check_formula_overflow,
}

DEFAULT_RULES = tuple(RULES)
