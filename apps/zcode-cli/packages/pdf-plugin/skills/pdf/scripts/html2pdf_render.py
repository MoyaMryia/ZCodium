"""The rendering half of html2pdf.py: options, page CSS and the LibreOffice call.

The CLI in html2pdf.py parses arguments; everything that touches the filesystem or
the converter lives here, so cover_render.py can render a page through the same
machinery without going through argv. One Options object describes one render
request, and render_one() turns it into a PDF next to the source.

Three facts about the toolchain shape this module, all measured on LibreOffice
7.3 rather than assumed:

  * the default HTML import filter (writer_web) drops the body's first block
    element and prepends a blank page, so the Writer filter is named explicitly;
  * `@page { size: …; margin: … }` is honoured — but only with explicit
    dimensions, because named sizes other than A4 are ignored;
  * page-break rules are honoured on real block elements and ignored on `div`,
    and `page-break-inside` is ignored outright.

A missing `soffice` raises RenderError; nothing here degrades quietly.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

SOFFICE_CANDIDATES = ("soffice", "libreoffice")
HTML_INFILTER = "HTML (StarWriter)"
TOOL_TIMEOUT_SECONDS = 120

DEFAULT_PAGE_FORMAT = "a4"
DEFAULT_ORIENTATION = "portrait"
# 与 LibreOffice 页面样式默认边距一致；显式注入是为了让输出不随版本漂移。
DEFAULT_MARGIN = "2cm"
DEFAULT_UNIT = "pt"
DEFAULT_IMAGE_TYPE = "jpeg"
DEFAULT_IMAGE_QUALITY = 0.95
LEGACY_BREAK_CLASS = "html2pdf__page-break"
PAGEBREAK_MODES = ("avoid-all", "css", "legacy")
DEFAULT_PAGEBREAK_MODES = ("css",)
IMAGE_TYPES = ("jpeg", "png", "webp")
ORIENTATIONS = ("portrait", "landscape")
# jsPDF 的 format 名 → CSS 尺寸（毫米）。LibreOffice 只认显式尺寸：实测
# `size: letter` 与 `size: A3` 被忽略，`size: 215.9mm 279.4mm` 才生效。
PAGE_SIZES_MM = {
    "a3": (297.0, 420.0),
    "a4": (210.0, 297.0),
    "a5": (148.0, 210.0),
    "b5": (176.0, 250.0),
    "letter": (215.9, 279.4),
    "legal": (215.9, 355.6),
    "tabloid": (279.4, 431.8),
}
UNIT_TO_CSS = {"pt": "pt", "mm": "mm", "cm": "cm", "in": "in", "px": "px", "pc": "pc"}
LENGTH_RE = re.compile(r"^(?P<value>\d+(?:\.\d+)?)(?P<unit>[a-zA-Z]*)$")
SELECTOR_FORBIDDEN = set("{};<>")
AVOID_ALL_SELECTORS = (
    "p", "h1", "h2", "h3", "h4", "h5", "h6",
    "table", "ul", "ol", "li", "img", "blockquote", "pre",
)
TAG_RE = re.compile(r"<(?P<name>[a-zA-Z][a-zA-Z0-9]*)(?P<attrs>[^>]*)>")
ATTR_RE = re.compile(
    r"(?P<name>[a-zA-Z-]+)\s*=\s*(?:\"(?P<dq>[^\"]*)\"|'(?P<sq>[^']*)'|(?P<bare>[^\s>]*))"
)
# 每个 pagebreak 选项对应的 CSS 声明。
BREAK_DECLARATIONS = {
    "before": "page-break-before: always",
    "after": "page-break-after: always",
    "avoid": "page-break-inside: avoid",
}
# 中间文件名后缀：与正文同目录写入，页面里的相对资源才能解析；输出后再改名。
WORK_SUFFIX = ".html2pdf.html"


class RenderError(RuntimeError):
    """A missing tool, an unreadable input, or a converter that failed."""


@dataclass
class Options:
    """One render request, resolved once by the CLI (or by cover_render.py)."""

    inputs: list[str] = field(default_factory=list)
    outdir: str | None = None
    filename: str | None = None
    margin: str = DEFAULT_MARGIN
    unit: str = DEFAULT_UNIT
    page_format: str = DEFAULT_PAGE_FORMAT
    orientation: str = DEFAULT_ORIENTATION
    image_type: str = DEFAULT_IMAGE_TYPE
    image_quality: float = DEFAULT_IMAGE_QUALITY
    pagebreak_modes: tuple[str, ...] = DEFAULT_PAGEBREAK_MODES
    pagebreak_before: tuple[str, ...] = ()
    pagebreak_after: tuple[str, ...] = ()
    pagebreak_avoid: tuple[str, ...] = ()
    html2canvas: dict = field(default_factory=dict)
    js_pdf: dict = field(default_factory=dict)
    keep_html: bool = False

    def summary(self) -> dict:
        """The resolved options, echoed in --json so a render is reproducible."""
        return {
            "margin": self.margin,
            "unit": self.unit,
            "format": self.page_format,
            "orientation": self.orientation,
            "image": {"type": self.image_type, "quality": self.image_quality},
            "pagebreak": {
                "mode": list(self.pagebreak_modes),
                "before": list(self.pagebreak_before),
                "after": list(self.pagebreak_after),
                "avoid": list(self.pagebreak_avoid),
            },
            "jsPDF": self.js_pdf,
            "html2canvas": self.html2canvas,
        }


def parse_length(text: str, unit: str) -> str:
    """`20`, `20pt`, `2cm` → a CSS length; a bare number takes the active unit."""
    match = LENGTH_RE.match(text.strip())
    if match is None:
        raise RenderError(f"not a length: {text!r}")
    suffix = match.group("unit").lower()
    if suffix and suffix not in UNIT_TO_CSS:
        raise RenderError(
            f"unsupported unit in {text!r}: expected one of {', '.join(sorted(UNIT_TO_CSS))}"
        )
    return f"{float(match.group('value')):g}{suffix or unit}"


def parse_margin(spec: str, unit: str) -> dict[str, str]:
    """html2pdf.js 的 margin：单值、`[上下, 左右]`、`[上, 左, 下, 右]` 或 JSON 对象。"""
    spec = spec.strip()
    if spec.startswith("{"):
        try:
            values = json.loads(spec)
        except json.JSONDecodeError as error:
            raise RenderError(f"margin is not valid JSON: {error}") from error
        if not isinstance(values, dict):
            raise RenderError("margin object must map top/left/bottom/right to lengths")
        return {
            side: parse_length(str(values.get(side, "0")), unit)
            for side in ("top", "left", "bottom", "right")
        }
    parts = [part.strip() for part in spec.split(",")]
    if len(parts) == 1:
        top = right = bottom = left = parse_length(parts[0], unit)
    elif len(parts) == 2:
        top = bottom = parse_length(parts[0], unit)
        left = right = parse_length(parts[1], unit)
    elif len(parts) == 4:
        top, left, bottom, right = (parse_length(part, unit) for part in parts)
    else:
        raise RenderError("margin takes 1, 2 or 4 comma-separated values")
    return {"top": top, "right": right, "bottom": bottom, "left": left}


def page_css(margin: dict[str, str], page_format: str, orientation: str) -> str:
    """The `@page` rule that fixes stock and margins for the whole document."""
    width, height = PAGE_SIZES_MM[page_format]
    if orientation == "landscape":
        width, height = height, width
    return (
        f"@page {{ size: {width:g}mm {height:g}mm; "
        f"margin: {margin['top']} {margin['right']} {margin['bottom']} {margin['left']}; }}"
    )


def check_selector(selector: str) -> str:
    """A selector is injected into a stylesheet; braces and tags are refused."""
    if not selector.strip() or SELECTOR_FORBIDDEN & set(selector):
        raise RenderError(f"not a usable CSS selector: {selector!r}")
    return selector.strip()


def pagebreak_css(options: Options, edits: list[tuple[str, str, str]]) -> str:
    """Stylesheet rules: the mode-wide ones, plus selectors that need no inline form."""
    rules: list[str] = []
    if "avoid-all" in options.pagebreak_modes:
        rules.append(", ".join(AVOID_ALL_SELECTORS) + " { page-break-inside: avoid; }")
    for kind, selector, declaration in edits:
        if kind == "css":
            rules.append(f"{selector} {{ {declaration}; }}")
    return "\n".join(rules)


def pagebreak_edits(options: Options) -> list[tuple[str, str, str]]:
    """Selectors that must be applied inline rather than through a stylesheet.

    Measured on LibreOffice 7.3: a class selector whose name contains an
    underscore is silently dropped by the HTML import (`.a_b` and `.a__b` do
    nothing, `.a-b` works), and attribute selectors are not supported at all.
    html2pdf.js's legacy class is `html2pdf__page-break` — exactly the shape
    that breaks — so class and id selectors are realised as inline styles on
    the matching elements instead. Everything else (element and compound
    selectors) stays a stylesheet rule.
    """
    edits: list[tuple[str, str, str]] = []
    if "legacy" in options.pagebreak_modes:
        edits.append(("class", LEGACY_BREAK_CLASS, BREAK_DECLARATIONS["after"]))
    for side, selectors in (
        ("before", options.pagebreak_before),
        ("after", options.pagebreak_after),
        ("avoid", options.pagebreak_avoid),
    ):
        for selector in selectors:
            check_selector(selector)
            declaration = BREAK_DECLARATIONS[side]
            if selector.startswith("."):
                edits.append(("class", selector[1:], declaration))
            elif selector.startswith("#"):
                edits.append(("id", selector[1:], declaration))
            else:
                edits.append(("css", selector, declaration))
    return edits


def _attribute(attrs: str, name: str) -> tuple[str, tuple[int, int, str]] | None:
    """One attribute's value, its span, and the quote style it used."""
    for match in ATTR_RE.finditer(attrs):
        if match.group("name").lower() != name:
            continue
        for group in ("dq", "sq", "bare"):
            if match.group(group) is not None:
                return match.group(group), (*match.span(group), group)
    return None


def inject_inline_styles(html: str, edits: list[tuple[str, str, str]]) -> str:
    """Write each class/id break declaration onto the elements it names."""
    wanted: dict[tuple[str, str], list[str]] = {}
    for kind, name, declaration in edits:
        if kind == "css":
            continue
        wanted.setdefault((kind, name), []).append(declaration)

    def rewrite(match: re.Match) -> str:
        name, attrs = match.group("name"), match.group("attrs")
        extra: list[str] = []
        classes = _attribute(attrs, "class")
        if classes is not None:
            for token in classes[0].split():
                extra.extend(wanted.get(("class", token), []))
        identifier = _attribute(attrs, "id")
        if identifier is not None:
            extra.extend(wanted.get(("id", identifier[0]), []))
        if not extra:
            return match.group(0)
        declaration = "; ".join(dict.fromkeys(extra))
        style = _attribute(attrs, "style")
        if style is None:
            return f'<{name}{attrs} style="{declaration}">'
        (_, (start, end, quote)) = style
        if quote == "bare":
            return f'<{name}{attrs[:start]}"{attrs[start:end]}; {declaration}"{attrs[end:]}>'
        return f"<{name}{attrs[:start]}{attrs[start:end]}; {declaration}{attrs[end:]}>"

    return TAG_RE.sub(rewrite, html)


def build_work_html(source: Path, target: Path, css: str, edits: list[tuple[str, str, str]]) -> None:
    """Copy the document beside itself with the injected stylesheet.

    The copy sits in the source's own directory so relative resources (images,
    stylesheets) still resolve; the produced PDF is renamed after conversion.
    """
    html = source.read_text(encoding="utf-8", errors="replace")
    style = f"<style>\n/* injected by html2pdf.py */\n{css}\n</style>\n"
    lowered = html.lower()
    head_close = lowered.find("</head>")
    if head_close != -1:
        html = html[:head_close] + style + html[head_close:]
    else:
        html_open = lowered.find("<html")
        if html_open != -1:
            tag_end = html.find(">", html_open)
            html = html[: tag_end + 1] + f"<head>{style}</head>" + html[tag_end + 1 :]
        elif "<body" in lowered:
            tag_end = html.find(">", lowered.find("<body"))
            html = html[: tag_end + 1] + style + html[tag_end + 1 :]
        else:
            html = style + html
    target.write_text(inject_inline_styles(html, edits), encoding="utf-8")


def find_soffice() -> str:
    """Locate the converter; a missing one is an error, not a skipped render."""
    for name in SOFFICE_CANDIDATES:
        found = shutil.which(name)
        if found is not None:
            return found
    raise RenderError(
        "soffice is not on PATH — install LibreOffice "
        "(Debian/Ubuntu: apt install libreoffice; macOS: brew install --cask libreoffice; "
        "Windows: the installer's program directory must be on PATH)"
    )


def run_soffice(work: Path, outdir: Path) -> None:
    """Convert one prepared HTML file; name the failure when it does not work."""
    executable = find_soffice()
    # 独立 profile：并发转换与正在运行的 LibreOffice 实例都不会互相顶掉。
    with tempfile.TemporaryDirectory(prefix="html2pdf-") as profile:
        command = [
            executable,
            "--headless",
            "--norestore",
            f"-env:UserInstallation={Path(profile).as_uri()}",
            f"--infilter={HTML_INFILTER}",
            "--convert-to",
            "pdf",
            "--outdir",
            str(outdir),
            str(work),
        ]
        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                errors="replace",
                timeout=TOOL_TIMEOUT_SECONDS,
                check=False,
            )
        except FileNotFoundError as error:
            raise RenderError(f"{executable} disappeared before the conversion") from error
        except subprocess.TimeoutExpired as error:
            raise RenderError(f"soffice timed out after {TOOL_TIMEOUT_SECONDS}s") from error
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip().splitlines()
        raise RenderError(
            f"soffice exited {completed.returncode}: {detail[-1] if detail else 'no output'}"
        )


def output_stem(source: Path, filename: str | None) -> str:
    """The stem of the produced PDF: --filename when given, else the input's."""
    if filename is None:
        return source.stem
    stem = filename.strip()
    if stem.lower().endswith(".pdf"):
        stem = stem[: -len(".pdf")]
    if not stem or "/" in stem or "\\" in stem or stem in (".", ".."):
        raise RenderError(f"--filename must be a plain file name, not a path: {filename!r}")
    return stem


def plan(source: str, options: Options) -> tuple[Path, Path, Path]:
    """Where one render reads from and writes to: (source, outdir, target)."""
    src = Path(source).expanduser()
    if not src.is_file():
        raise RenderError(f"not a file: {source}")
    resolved = src.resolve()
    outdir = Path(options.outdir).expanduser() if options.outdir else resolved.parent
    return resolved, outdir, outdir / f"{output_stem(resolved, options.filename)}.pdf"


def render_one(source: str, options: Options) -> dict:
    """Render one HTML file and report where it landed."""
    resolved, outdir, target = plan(source, options)
    outdir.mkdir(parents=True, exist_ok=True)
    work = resolved.parent / f"{target.stem}{WORK_SUFFIX}"
    edits = pagebreak_edits(options)
    css = "\n".join(
        part
        for part in (
            page_css(parse_margin(options.margin, options.unit), options.page_format, options.orientation),
            pagebreak_css(options, edits),
        )
        if part
    )
    build_work_html(resolved, work, css, edits)
    try:
        run_soffice(work, outdir)
        produced = outdir / f"{work.stem}.pdf"
        if not produced.is_file():
            raise RenderError(f"soffice reported success but wrote no PDF for {source}")
        if produced != target:
            os.replace(produced, target)
    finally:
        if not options.keep_html:
            work.unlink(missing_ok=True)
    return {"source": str(resolved), "output": str(target)}
