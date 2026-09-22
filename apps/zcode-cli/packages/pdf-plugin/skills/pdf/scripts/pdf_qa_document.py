"""Read-only facts about a PDF, derived once for every pdf_qa rule.

Every rule needs the same handful of facts: how many pages there are, how big
each one is, where the words actually landed, how much of each page carries ink,
which fonts are embedded, and what the document claims about itself. Asking
poppler once per rule would mean five tools times fifteen rules and, worse,
fifteen chances to disagree about what a "page" is. This module asks each tool
exactly once and hands every rule the same view.

Poppler is the only source of truth: `pdfinfo` for page count and metadata,
`pdftotext -bbox` for word boxes, `pdftotext -layout` for text, `pdffonts` for
embedding, `pdftoppm` for the ink map that blank and half-empty pages are judged
from. No PDF library is imported, so a missing tool is a hard error rather than a
silently degraded run. The only thing written is a temporary render directory,
removed before this module returns.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

from pdf_qa_colors import MAX_COLOR_SCAN_BYTES, ColorFacts, scan_colors

# 渲染分辨率：只需要"有没有墨、墨铺了多少行"，不需要可读字形。
INK_DPI = 40
# 0-255 灰度。低于这个值的像素算着墨；245 让抗锯齿边缘仍然算白。
INK_LEVEL = 245
# 单次 poppler 调用的上限，避免一个畸形文件把检查器挂住。
TOOL_TIMEOUT_SECONDS = 120

POPPLER_TOOLS = ("pdftotext", "pdfinfo", "pdffonts", "pdftoppm")
BBOX_NS = "{http://www.w3.org/1999/xhtml}"


class PdfQaError(RuntimeError):
    """A tool is missing, the file is unreadable, or poppler refused it."""


@dataclass
class WordBox:
    """One word as poppler measured it, in points, origin top-left."""

    x_min: float
    y_min: float
    x_max: float
    y_max: float
    text: str


@dataclass
class InkMap:
    """Per-page raster summary: how much of the page carries ink, and where."""

    width: int
    height: int
    ink_pixels: int
    coverage: float
    fill: float
    left: float
    right: float
    top: float
    bottom: float
    center: float


@dataclass
class PageFacts:
    index: int
    width: float
    height: float
    words: list[WordBox] = field(default_factory=list)
    text: str = ""
    ink: InkMap | None = None

    @property
    def word_count(self) -> int:
        return len(self.words)

    def lines(self, tolerance: float) -> list[list[WordBox]]:
        """Words grouped into visual lines by their top edge."""
        buckets: dict[int, list[WordBox]] = {}
        for word in self.words:
            buckets.setdefault(round(word.y_min / tolerance), []).append(word)
        return [sorted(buckets[key], key=lambda word: word.x_min) for key in sorted(buckets)]


@dataclass
class FontFacts:
    name: str
    kind: str
    encoding: str
    embedded: bool
    unicode_mapped: bool


@dataclass
class PdfContext:
    path: str
    page_count: int
    pages: list[PageFacts] = field(default_factory=list)
    fonts: list[FontFacts] = field(default_factory=list)
    metadata: dict[str, str] = field(default_factory=dict)
    colors: ColorFacts = field(default_factory=ColorFacts)

    @property
    def text(self) -> str:
        return "\n".join(page.text for page in self.pages)


def require_tools() -> None:
    """Fail loudly when the poppler toolchain is not on PATH."""
    missing = [tool for tool in POPPLER_TOOLS if shutil.which(tool) is None]
    if missing:
        raise PdfQaError(
            "missing poppler tool(s) on PATH: "
            + ", ".join(missing)
            + " — install poppler-utils (Debian/Ubuntu: apt install poppler-utils; macOS: brew install poppler)"
        )


def load_pdf(path: str | Path) -> PdfContext:
    """Derive every fact pdf_qa needs, with one call per poppler tool."""
    require_tools()
    target = Path(path)
    if not target.is_file():
        raise PdfQaError(f"not a file: {path}")

    info = _parse_info(_run("pdfinfo", [str(target)]))
    page_count = int(info.get("pages", "0") or 0)
    if page_count <= 0:
        raise PdfQaError(f"pdfinfo reported no pages: {path}")

    words = _parse_bbox(_run("pdftotext", ["-bbox", str(target), "-"]))
    page_text = _split_pages(_run("pdftotext", ["-layout", str(target), "-"]), page_count)
    fonts = _parse_fonts(_run("pdffonts", [str(target)]))
    ink = _render_ink(str(target), page_count)

    pages: list[PageFacts] = []
    for index in range(1, page_count + 1):
        boxed = words[index - 1] if index <= len(words) else ([], 0.0, 0.0)
        page_words, width, height = boxed
        pages.append(
            PageFacts(
                index=index,
                width=width,
                height=height,
                words=page_words,
                text=page_text[index - 1] if index <= len(page_text) else "",
                ink=ink[index - 1] if index <= len(ink) else None,
            )
        )
    return PdfContext(
        path=str(target),
        page_count=page_count,
        pages=pages,
        fonts=fonts,
        metadata=info,
        colors=_scan_colors(target),
    )


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
        raise PdfQaError(f"{tool} is not on PATH") from error
    except subprocess.TimeoutExpired as error:
        raise PdfQaError(f"{tool} timed out after {TOOL_TIMEOUT_SECONDS}s") from error
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip().splitlines()
        raise PdfQaError(f"{tool} exited {completed.returncode}: {detail[-1] if detail else 'no output'}")
    return completed.stdout


def _parse_info(output: str) -> dict[str, str]:
    """pdfinfo prints `Label:   value`; a missing value is an empty string."""
    info: dict[str, str] = {}
    for line in output.splitlines():
        label, separator, value = line.partition(":")
        if separator:
            info[label.strip().lower().replace(" ", "_")] = value.strip()
    return info


def _parse_bbox(output: str) -> list[tuple[list[WordBox], float, float]]:
    """`pdftotext -bbox` emits XHTML: one <page> per page, one <word> per word."""
    pages: list[tuple[list[WordBox], float, float]] = []
    if not output.strip():
        return pages
    try:
        root = ET.fromstring(output)
    except ET.ParseError as error:
        raise PdfQaError(f"could not parse pdftotext -bbox output: {error}") from error
    for page in root.iter(f"{BBOX_NS}page"):
        words = [
            WordBox(
                x_min=float(word.get("xMin") or 0.0),
                y_min=float(word.get("yMin") or 0.0),
                x_max=float(word.get("xMax") or 0.0),
                y_max=float(word.get("yMax") or 0.0),
                text=word.text or "",
            )
            for word in page.iter(f"{BBOX_NS}word")
        ]
        pages.append(
            (
                words,
                float(page.get("width") or 0.0),
                float(page.get("height") or 0.0),
            )
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


def _parse_fonts(output: str) -> list[FontFacts]:
    """pdffonts prints a fixed-width table; the dashes under the header give the columns."""
    lines = output.splitlines()
    spans = _font_columns(lines[1]) if len(lines) > 1 else []
    fonts: list[FontFacts] = []
    for line in lines[2:]:
        if not line.strip():
            continue
        if len(spans) >= 6:
            name, kind, encoding, embedded, _, unicode_mapped = (
                line[start:end].strip() for start, end in spans[:6]
            )
        else:
            # 表头被改写或本地化时退回按空白切：type 一列可能自带一个空格（"Type 1"）。
            parts = line.split()
            if len(parts) < 8:
                continue
            name = " ".join(parts[:-7])
            kind, encoding, embedded, _, unicode_mapped = parts[-7:-2]
        fonts.append(
            FontFacts(
                name=name,
                kind=kind,
                encoding=encoding,
                embedded=embedded.lower() == "yes",
                unicode_mapped=unicode_mapped.lower() == "yes",
            )
        )
    return fonts


def _font_columns(dashes: str) -> list[tuple[int, int]]:
    """Column spans, read off the runs of dashes under the pdffonts header."""
    spans: list[tuple[int, int]] = []
    start: int | None = None
    for index, char in enumerate(dashes + " "):
        if char == "-" and start is None:
            start = index
        elif char != "-" and start is not None:
            spans.append((start, index))
            start = None
    return spans


def _render_ink(path: str, page_count: int) -> list[InkMap]:
    """Rasterize every page once and reduce each one to an ink map."""
    with tempfile.TemporaryDirectory(prefix="pdf-qa-") as directory:
        prefix = str(Path(directory) / "page")
        _run(
            "pdftoppm",
            ["-gray", "-r", str(INK_DPI), "-f", "1", "-l", str(page_count), path, prefix],
        )
        rendered = sorted(
            Path(directory).glob("page-*.pgm"),
            key=lambda item: int(item.stem.split("-")[-1]),
        )
        return [_ink_map(str(item)) for item in rendered]


def _ink_map(path: str) -> InkMap:
    width, height, raster, deep = _read_pgm(path)
    if width <= 0 or height <= 0:
        raise PdfQaError(f"empty render: {path}")
    stride = width * (2 if deep else 1)
    # 把"是否着墨"做成查找表，行扫描与列扫描就都走 C 而不是 Python 循环。
    table = bytes(1 if level < INK_LEVEL else 0 for level in range(256))
    mask = raster.translate(table)
    rows = [mask[start : start + stride] for start in range(0, len(mask), stride)]
    top = next((index for index, row in enumerate(rows) if 1 in row), None)
    bottom = next((index for index in range(len(rows) - 1, -1, -1) if 1 in rows[index]), None)
    left = next((column for column in range(width) if 1 in mask[column::stride]), None)
    right = next((column for column in range(width - 1, -1, -1) if 1 in mask[column::stride]), None)
    if top is None or bottom is None or left is None or right is None:
        # 纯白页：四边留白都是整页，墨带居中无意义。
        return InkMap(width, height, 0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 0.5)
    return InkMap(
        width=width,
        height=height,
        ink_pixels=mask.count(1),
        coverage=mask.count(1) / (width * height),
        fill=(bottom - top + 1) / height,
        left=left / width,
        right=(width - 1 - right) / width,
        top=top / height,
        bottom=(height - 1 - bottom) / height,
        center=(top + bottom + 1) / 2 / height,
    )


def _read_pgm(path: str) -> tuple[int, int, bytes, bool]:
    """Minimal binary PGM reader: `P5`, width, height, maxval, then samples."""
    with open(path, "rb") as handle:
        data = handle.read()
    position = 2
    values: list[int] = []
    while len(values) < 3 and position < len(data):
        while position < len(data) and data[position : position + 1].isspace():
            position += 1
        if data[position : position + 1] == b"#":
            while position < len(data) and data[position : position + 1] != b"\n":
                position += 1
            continue
        start = position
        while position < len(data) and not data[position : position + 1].isspace():
            position += 1
        values.append(int(data[start:position]))
    if len(values) < 3:
        raise PdfQaError(f"not a binary PGM: {path}")
    width, height, maxval = values
    return width, height, data[position + 1 :], maxval > 255


def _scan_colors(target: Path) -> ColorFacts:
    """Bound the colour scan by file size before reading the whole thing in."""
    try:
        size = target.stat().st_size
    except OSError as error:
        raise PdfQaError(f"cannot stat {target}: {error}") from error
    if size > MAX_COLOR_SCAN_BYTES:
        skipped = ColorFacts(scanned=False)
        skipped.note = f"skipped: {size} bytes exceeds the {MAX_COLOR_SCAN_BYTES}-byte scan limit"
        return skipped
    return scan_colors(target.read_bytes())

