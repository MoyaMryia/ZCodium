"""Read-only facts about a document's table of contents, for toc_validate.py.

The validator judges; this module measures. It asks poppler twice — `pdfinfo`
for the page count, `pdftotext` for the text and the word boxes — and derives
four things: which pages carry the table of contents, what the entries on them
say, which pages hold the body, and which lines in the body are headings.

How each is decided, because every one of them is a heuristic:

  * TOC pages  — the first pages are scanned for a contents heading
    (`目录` / `Contents` / …); the heading page and every following page that
    still carries enough entry lines belong to the table of contents.
  * Entries    — a line is an entry when it ends in a page-like token, or
    carries leader dots or a numbering prefix. A wrapped continuation of a long
    title has none of those and is not an entry, which is also why a missing
    page number is only reported when one of the three markers is present.
  * Levels     — from the numbering prefix (`1.2.` → 3) when the TOC has no
    indentation to read, otherwise from the distinct indents of the entries
    themselves, so the scale is calibrated per document rather than assumed.
  * Headings   — a body line whose glyphs are noticeably taller than the
    document's median word and that stays under a few words long.

Nothing here returns a verdict; a missing poppler tool raises TocError.
"""

from __future__ import annotations

import re
import shutil
import statistics
import subprocess
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

POPPLER_TOOLS = ("pdftotext", "pdfinfo")
TOOL_TIMEOUT_SECONDS = 120
BBOX_NS = "{http://www.w3.org/1999/xhtml}"

# 前几页里出现这个标题，就认为遇到了目录。
TOC_SCAN_PAGES = 5
TOC_HEADING_RE = re.compile(r"^\s*(目\s*录|目次|table\s+of\s+contents|contents)\s*$", re.IGNORECASE | re.MULTILINE)
# 目录页至少要有多长条目行，才算"这一页仍是目录"。
TOC_MIN_ENTRIES = 3
# 编号前缀：`1.`、`1.2.`、`第三章`。层级由它推断。
NUMBERING_RE = re.compile(r"^(?:(?P<dotted>\d+(?:\.\d+)*)\.?|第\s*(?P<cjk>[一二三四五六七八九十百]+)\s*(?P<cjk_unit>[章节部篇]))\s+")
CJK_UNIT_LEVELS = {"章": 1, "篇": 1, "部": 1, "节": 2, "小节": 3}
# 引导点：中英文目录都用一串点或省略号连接标题与页码。
LEADER_RE = re.compile(r"[.·…]{2,}\s*$")
PAGE_TOKEN_RE = re.compile(r"^(?:\d+|[ivxlcdm]{1,7})$", re.IGNORECASE)
# 页码占位符：非数字的常见写法；"00" 由数字分支按 0 处理。
PLACEHOLDER_PAGES = {"x", "xx", "?", "-", "--", "…", "n/a", "tbd", "todo"}
# 同一行的字按上边缘归行时的容差（pt）。
LINE_Y_TOLERANCE_PTS = 2.0
# 标题行判定：比前后各 HEADING_WINDOW_LINES 行的中位行高高出这个倍率（含容差），
# 且词数不超过 HEADING_MAX_WORDS。局部比较而不是全局中位数：稀疏页、中英混排
# （拉丁字形的字高只有表意文字的七成）都会把全局统计带偏。
HEADING_WINDOW_LINES = 3
HEADING_SIZE_RATIO = 1.15
HEADING_SIZE_TOLERANCE_PTS = 0.5
HEADING_MAX_WORDS = 12
# 标题行读起来像句子：至少一个字母或汉字，且字符大多不是符号——把展示公式挡在外面。
HEADING_PROSE_RE = re.compile(r"[A-Za-z\u4e00-\u9fff]")
HEADING_PROSE_RATIO = 0.8


class TocError(RuntimeError):
    """A tool is missing, the file is unreadable, or poppler refused it."""


@dataclass
class Word:
    x_min: float
    y_min: float
    x_max: float
    y_max: float
    text: str

    @property
    def height(self) -> float:
        return self.y_max - self.y_min


@dataclass
class Entry:
    """One line of the printed table of contents."""

    index: int
    title: str
    level: int
    page_field: str
    page_kind: str  # arabic | roman | placeholder
    page_number: int | None


@dataclass
class Heading:
    """A body line the heuristics read as a heading."""

    page: int
    text: str


@dataclass
class TocFacts:
    path: str
    page_count: int
    pages_text: list[str] = field(default_factory=list)
    toc_pages: list[int] = field(default_factory=list)
    entries: list[Entry] = field(default_factory=list)
    body_pages: list[int] = field(default_factory=list)
    headings: list[Heading] = field(default_factory=list)

    @property
    def body_text(self) -> str:
        return "\n".join(self.pages_text[page - 1] for page in self.body_pages if page <= len(self.pages_text))


def require_tools() -> None:
    """Fail loudly when the poppler toolchain is not on PATH."""
    missing = [tool for tool in POPPLER_TOOLS if shutil.which(tool) is None]
    if missing:
        raise TocError(
            "missing poppler tool(s) on PATH: "
            + ", ".join(missing)
            + " — install poppler-utils (Debian/Ubuntu: apt install poppler-utils; macOS: brew install poppler)"
        )


def load(path: str | Path) -> TocFacts:
    """Derive every fact the validator needs, with one call per poppler tool."""
    require_tools()
    target = Path(path)
    if not target.is_file():
        raise TocError(f"not a file: {path}")

    info = _parse_info(_run("pdfinfo", [str(target)]))
    page_count = int(info.get("pages", "0") or 0)
    if page_count <= 0:
        raise TocError(f"pdfinfo reported no pages: {path}")

    words = _parse_bbox(_run("pdftotext", ["-bbox", str(target), "-"]))
    pages_text = _split_pages(_run("pdftotext", ["-layout", str(target), "-"]), page_count)
    facts = TocFacts(path=str(target), page_count=page_count, pages_text=pages_text)
    facts.toc_pages = find_toc_pages(pages_text)
    facts.entries = parse_entries(pages_text, facts.toc_pages)
    last_toc = facts.toc_pages[-1] if facts.toc_pages else 0
    facts.body_pages = [page for page in range(1, page_count + 1) if page > last_toc]
    _collect_headings(facts, words)
    return facts


def _run(tool: str, args: list[str]) -> str:
    try:
        completed = subprocess.run(
            [tool, *args],
            capture_output=True,
            text=True,
            errors="replace",
            timeout=TOOL_TIMEOUT_SECONDS,
            check=False,
        )
    except FileNotFoundError as error:
        raise TocError(f"{tool} is not on PATH") from error
    except subprocess.TimeoutExpired as error:
        raise TocError(f"{tool} timed out after {TOOL_TIMEOUT_SECONDS}s") from error
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip().splitlines()
        raise TocError(f"{tool} exited {completed.returncode}: {detail[-1] if detail else 'no output'}")
    return completed.stdout


def _parse_info(output: str) -> dict[str, str]:
    info: dict[str, str] = {}
    for line in output.splitlines():
        label, separator, value = line.partition(":")
        if separator:
            info[label.strip().lower().replace(" ", "_")] = value.strip()
    return info


def _parse_bbox(output: str) -> list[list[Word]]:
    """`pdftotext -bbox` emits XHTML: one <page> per page, one <word> per word."""
    pages: list[list[Word]] = []
    if not output.strip():
        return pages
    try:
        root = ET.fromstring(output)
    except ET.ParseError as error:
        raise TocError(f"could not parse pdftotext -bbox output: {error}") from error
    for page in root.iter(f"{BBOX_NS}page"):
        pages.append(
            [
                Word(
                    x_min=float(word.get("xMin") or 0.0),
                    y_min=float(word.get("yMin") or 0.0),
                    x_max=float(word.get("xMax") or 0.0),
                    y_max=float(word.get("yMax") or 0.0),
                    text=word.text or "",
                )
                for word in page.iter(f"{BBOX_NS}word")
            ]
        )
    return pages


def _split_pages(output: str, page_count: int) -> list[str]:
    """pdftotext terminates every page with a form feed, including the last."""
    chunks = output.split("\f")
    if chunks and not chunks[-1].strip():
        chunks.pop()
    if len(chunks) < page_count:
        chunks.extend([""] * (page_count - len(chunks)))
    return chunks[:page_count]


def find_toc_pages(pages_text: list[str]) -> list[int]:
    """The contents heading page plus every entry-rich page that follows it."""
    for index, text in enumerate(pages_text[:TOC_SCAN_PAGES], start=1):
        if not TOC_HEADING_RE.search(text):
            continue
        toc_pages = [index]
        for follow in range(index + 1, len(pages_text) + 1):
            lines = [line for line in pages_text[follow - 1].splitlines() if parse_entry_line(line)]
            if len(lines) >= TOC_MIN_ENTRIES:
                toc_pages.append(follow)
            else:
                break
        return toc_pages
    return []


def parse_entry_line(raw: str) -> Entry | None:
    """One TOC line as an entry, or None when the line is not an entry."""
    line = raw.rstrip()
    body = line.strip()
    if not body or TOC_HEADING_RE.match(line):
        return None
    head, _, tail = body.rpartition(" ")
    if not head:
        head, tail = body, ""
    kind, number = classify_page(tail)
    token = tail.strip().strip("[](){}")
    if kind == "placeholder" and token and not token.isdigit() and token.lower() not in PLACEHOLDER_PAGES:
        # 末 token 不是页码写法（如缺页码的 "1. Introduction"）：整行都是标题。
        head, tail = body, ""
        kind, number = "placeholder", None
    has_leader = bool(LEADER_RE.search(head))
    numbering = NUMBERING_RE.match(head.strip())
    if not (has_leader or numbering or kind != "placeholder"):
        # 既无引导点、也无编号、末 token 也不是页码：这是长标题折行，不是条目。
        return None
    title = LEADER_RE.sub("", head).strip()
    if not title:
        return None
    return Entry(0, title, 0, tail, kind, number)


def classify_page(field: str) -> tuple[str, int | None]:
    """`arabic` with a number, `roman`, or `placeholder` — which is a defect."""
    token = field.strip().strip("[](){}")
    if not token:
        return "placeholder", None
    if token.lower() in PLACEHOLDER_PAGES:
        return "placeholder", None
    if token.isdigit():
        return ("arabic", int(token)) if int(token) >= 1 else ("placeholder", None)
    if PAGE_TOKEN_RE.match(token):
        return "roman", None
    return "placeholder", None


def parse_entries(pages_text: list[str], toc_pages: list[int]) -> list[Entry]:
    """Every entry of the table of contents, in printed order, with levels."""
    raw: list[tuple[str, Entry]] = []
    for page in toc_pages:
        for line in pages_text[page - 1].splitlines():
            entry = parse_entry_line(line)
            if entry is not None:
                indent = len(line) - len(line.lstrip())
                raw.append((indent, entry))
    indents = sorted({indent for indent, _ in raw})
    use_indent = len(indents) > 1
    entries: list[Entry] = []
    for position, (indent, entry) in enumerate(raw, start=1):
        if use_indent:
            level = indents.index(indent) + 1
        else:
            level = numbering_level(entry.title)
        entries.append(
            Entry(
                index=position,
                title=entry.title,
                level=level,
                page_field=entry.page_field,
                page_kind=entry.page_kind,
                page_number=entry.page_number,
            )
        )
    return entries


def numbering_level(title: str) -> int:
    """`1.2.` → 3, `第三章` → 1; a title without a prefix is top level."""
    match = NUMBERING_RE.match(title.strip())
    if match is None:
        return 1
    if match.group("dotted"):
        return len(match.group("dotted").split("."))
    return CJK_UNIT_LEVELS.get(match.group("cjk_unit"), 1)


def _collect_headings(facts: TocFacts, words: list[list[Word]]) -> None:
    """Body lines that read as headings, judged against their own neighbours."""
    for page in facts.body_pages:
        if page > len(words):
            continue
        lines = _lines(words[page - 1])
        for index, line in enumerate(lines):
            text = " ".join(word.text for word in line).strip()
            if not text or len(line) > HEADING_MAX_WORDS or not looks_like_prose(text):
                continue
            neighbours = (
                lines[max(0, index - HEADING_WINDOW_LINES) : index]
                + lines[index + 1 : index + 1 + HEADING_WINDOW_LINES]
            )
            if not neighbours:
                continue
            reference = statistics.median(max(word.height for word in other) for other in neighbours)
            if max(word.height for word in line) >= reference * HEADING_SIZE_RATIO - HEADING_SIZE_TOLERANCE_PTS:
                facts.headings.append(Heading(page=page, text=text))


def looks_like_prose(text: str) -> bool:
    """A heading reads as words; a display formula does not."""
    core = "".join(text.split())
    if not HEADING_PROSE_RE.search(core):
        return False
    alphanumeric = sum(1 for char in core if char.isalnum())
    return alphanumeric >= len(core) * HEADING_PROSE_RATIO


def _lines(words: list[Word]) -> list[list[Word]]:
    """Words grouped into visual lines by their top edge."""
    buckets: dict[int, list[Word]] = {}
    for word in words:
        buckets.setdefault(round(word.y_min / LINE_Y_TOLERANCE_PTS), []).append(word)
    return [sorted(buckets[key], key=lambda word: word.x_min) for key in sorted(buckets)]
