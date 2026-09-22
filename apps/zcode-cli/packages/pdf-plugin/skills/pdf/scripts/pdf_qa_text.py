"""Text and geometry analysis over the read-only PDF view.

The rules need to answer questions like "is this line a table row", "is this
line a formula", "does this page read as a cover". Answering them means grouping
words into lines, splitting lines into columns and classifying text by script.
That analysis is shared by several rules, so it lives here rather than being
re-derived — and disagreed about — inside each one.

Nothing here judges the document: these are measurements, not verdicts.
"""

from __future__ import annotations

import re

from pdf_qa_document import FontFacts, PageFacts, PdfContext, WordBox

# 中日韩表意文字、假名与谚文的区段。标点与字形判定都以它为前提。
CJK_RANGES = "㐀-䶿一-鿿豈-﫿぀-ヿ가-힯"
CJK_RE = re.compile(f"[{CJK_RANGES}]")
# 句读类半角标点：出现在中文旁边就是中英混用。
HALFWIDTH_PUNCTUATION = ",.;:!?"
# 中文句读：夹在拉丁词中间同样是混用。
FULLWIDTH_PUNCTUATION = "，。！？；："
DOUBLE_PUNCTUATION_RE = re.compile(rf"([{re.escape(FULLWIDTH_PUNCTUATION)},;:!?])\1")
# 三个点是省略号，四个点起就是手滑。
DOT_RUN_RE = re.compile(r"\.{4,}")
TOC_HEADING_RE = re.compile(r"^\s*(目\s*录|目次|contents|table of contents)\s*$", re.IGNORECASE | re.MULTILINE)
TOC_LEADER_RE = re.compile(r"\.{4,}\s*\d+\s*$", re.MULTILINE)
# 前几页里出现这么多带引导点的目录行，就认为文档有目录。
TOC_SCAN_PAGES = 3
TOC_LEADER_MIN_LINES = 3
# 封面判定：字数少，且内容（含图形）的墨带大致落在页面中段。
COVER_MAX_WORDS = 40
COVER_CENTER_TOLERANCE = 0.30
# 同一行的字按上边缘归行时的容差（pt）。
LINE_Y_TOLERANCE_PTS = 2.0
# 一行内超过这个间隔（pt）的空隙算作一列的分界。
TABLE_GAP_PTS = 8.0
# 至少这么多列、这么多连续行才认为遇到了表格，避免把两端对齐的段落当表格。
TABLE_MIN_COLUMNS = 3
TABLE_MIN_ROWS = 2
# 一行里这个比例的字符是数学符号就认为是公式行。
FORMULA_MATH_RATIO = 0.35
MATH_CHARACTERS = set("=+-*/^_<>|()[]{}%\\∑∫√∞≈≠≤≥±×÷∈∉∀∃∴∵")
GREEK_RANGE = ("\u03b0", "\u03ff")
# 只有这些基座字体没有中日韩字形；CJK 文本配上它们必然出豆腐块。
LATIN_BASE_FONTS = ("helvetica", "arial", "times", "courier")
# pdffonts 的字体名里出现这些片段，说明它有 CJK 字形。
CJK_FONT_HINTS = (
    "cjk", "song", "hei", "kai", "ming", "gothic", "mincho", "source han",
    "noto sans sc", "noto serif sc", "pingfang", "hiragino", "simsun", "simhei",
    "songti", "stheiti", "stsong", "stkaiti", "stxihei", "uming", "ukai", "wqy",
    "droid sans fallback", "nanum", "ipaex", "ar pl",
)


def has_cjk(text: str) -> bool:
    return bool(CJK_RE.search(text))


def halfwidth_beside_cjk(text: str) -> list[str]:
    """Halfwidth sentence punctuation touching Chinese, ignoring decimals and clocks."""
    found: list[str] = []
    for match in re.finditer(rf"([{CJK_RANGES}])([{re.escape(HALFWIDTH_PUNCTUATION)}])", text):
        following = text[match.end() : match.end() + 1]
        if match.group(2) in ".,:" and following.isdigit():
            continue
        found.append(match.group(0))
    for match in re.finditer(rf"([{re.escape(HALFWIDTH_PUNCTUATION)}])([{CJK_RANGES}])", text):
        found.append(match.group(0))
    return found


def fullwidth_beside_latin(text: str) -> list[str]:
    """Chinese punctuation embedded in a Latin word, the mirror-image mistake."""
    marks = re.escape(FULLWIDTH_PUNCTUATION)
    found: list[str] = []
    for pattern in (rf"([A-Za-z0-9])([{marks}])", rf"([{marks}])([A-Za-z0-9])"):
        found.extend("".join(match) for match in re.findall(pattern, text))
    return found


def doubled_punctuation(text: str) -> list[str]:
    return DOUBLE_PUNCTUATION_RE.findall(text) + DOT_RUN_RE.findall(text)


def math_ratio(text: str) -> float:
    if not text:
        return 0.0
    low, high = GREEK_RANGE
    hits = sum(1 for char in text if char in MATH_CHARACTERS or low <= char <= high)
    return hits / len(text)


def is_cjk_capable(font: FontFacts) -> bool:
    kind = font.kind.lower()
    encoding = font.encoding.lower()
    name = font.name.lower()
    if kind.startswith("cid") or kind == "type 0":
        return True
    if encoding.startswith("identity") or "ucs" in encoding:
        return True
    return any(hint in name for hint in CJK_FONT_HINTS)


def is_latin_base(font: FontFacts) -> bool:
    name = font.name.lower()
    return any(hint in name for hint in LATIN_BASE_FONTS)


def luminance(color: tuple[float, float, float]) -> float:
    red, green, blue = color
    return 0.299 * red + 0.587 * green + 0.114 * blue


def hex_color(color: tuple[float, float, float]) -> str:
    channels = "".join(f"{round(max(0.0, min(1.0, channel)) * 255):02X}" for channel in color)
    return f"#{channels}"


def compact_indexes(indexes: list[int], limit: int = 6) -> str:
    shown = ",".join(str(index) for index in indexes[:limit])
    return shown + ("…" if len(indexes) > limit else "")


def cells(line: list[WordBox]) -> list[list[WordBox]]:
    """Split one visual line into columns at every wide gap."""
    columns: list[list[WordBox]] = [[line[0]]]
    for previous, word in zip(line, line[1:]):
        if word.x_min - previous.x_max >= TABLE_GAP_PTS:
            columns.append([word])
        else:
            columns[-1].append(word)
    return columns


def table_blocks(page: PageFacts) -> list[list[list[WordBox]]]:
    """Consecutive lines with enough column gaps between them to be a table."""
    lines = page.lines(LINE_Y_TOLERANCE_PTS)
    rows = [
        (index, line)
        for index, line in enumerate(lines)
        if len(cells(line)) >= TABLE_MIN_COLUMNS
    ]
    blocks: list[list[tuple[int, list[WordBox]]]] = []
    for row in rows:
        if blocks and row[0] == blocks[-1][-1][0] + 1:
            blocks[-1].append(row)
        else:
            blocks.append([row])
    return [[line for _, line in block] for block in blocks if len(block) >= TABLE_MIN_ROWS]


def has_toc(doc: PdfContext) -> bool:
    leaders = 0
    for page in doc.pages[:TOC_SCAN_PAGES]:
        if TOC_HEADING_RE.search(page.text):
            return True
        leaders += len(TOC_LEADER_RE.findall(page.text))
    return leaders >= TOC_LEADER_MIN_LINES


def looks_like_cover(page: PageFacts) -> bool:
    if page.word_count == 0 or page.word_count > COVER_MAX_WORDS or page.ink is None:
        return False
    return abs(page.ink.center - 0.5) <= COVER_CENTER_TOLERANCE


def text_column_right(doc: PdfContext) -> float | None:
    """The right edge of the body text, measured on the lines that are not formulas."""
    edges = [
        max(word.x_max for word in line)
        for page in doc.pages
        for line in page.lines(LINE_Y_TOLERANCE_PTS)
        if math_ratio(" ".join(word.text for word in line)) < FORMULA_MATH_RATIO
    ]
    return max(edges) if edges else None
