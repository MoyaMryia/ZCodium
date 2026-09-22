"""Colours a PDF actually paints, read straight out of its content streams.

No poppler tool reports colour — `pdfinfo` stops at geometry and `pdffonts` at
fonts — so this is the one place pdf_qa reads the file as bytes. Every stream is
inflated and its operators replayed, and a colour is recorded only once a text or
path operator consumes it. Without that last condition every PDF that writes its
default colour explicitly would be reported as painting white.

The scan is bounded: past MAX_COLOR_SCAN_BYTES it stops and says so rather than
pulling a gigabyte into memory for a handful of findings.
"""

from __future__ import annotations

import re
import zlib
from dataclasses import dataclass, field

# 超过这个体积的 PDF 不再逐字节扫内容流找颜色操作符。
MAX_COLOR_SCAN_BYTES = 32 * 1024 * 1024

# 内容流里给文字或路径上色的操作符：只有它们出现，前面的颜色才算真的用上。
PAINT_OPERATORS = frozenset(
    {b"Tj", b"TJ", b"'", b'"', b"f", b"F", b"f*", b"B", b"B*", b"b", b"b*", b"S", b"s"}
)
COLOR_OPERATORS = frozenset({b"rg", b"RG", b"g", b"G", b"k", b"K"})
NUMBER_RE = re.compile(rb"^[-+]?(\d+\.?\d*|\.\d+)$")
STREAM_RE = re.compile(rb"stream(?:\r\n|\n|\r)(.*?)(?:\r\n|\n|\r)endstream", re.S)


@dataclass
class ColorFacts:
    """Colours a content stream actually painted."""

    used: set[tuple[float, float, float]] = field(default_factory=set)
    scanned: bool = True
    note: str = ""

    @property
    def distinct(self) -> int:
        return len(self.used)


def scan_colors(raw: bytes) -> ColorFacts:
    """Replay every stream in `raw` and collect the colours that were painted."""
    colors = ColorFacts()
    for match in STREAM_RE.finditer(raw):
        stream = _inflate(match.group(1))
        if stream is not None:
            _replay_operators(stream, colors)
    return colors


def _inflate(payload: bytes) -> bytes | None:
    """Content streams are usually Flate-compressed; some ship uncompressed."""
    try:
        return zlib.decompress(payload)
    except zlib.error:
        return payload if b" Tf" in payload else None


def _replay_operators(stream: bytes, colors: ColorFacts) -> None:
    operands: list[float] = []
    current: tuple[float, float, float] | None = None
    for token in stream.split():
        if token in PAINT_OPERATORS:
            if current is not None:
                colors.used.add(current)
            continue
        if token in COLOR_OPERATORS:
            current = _color_of(token, operands)
            operands = []
            continue
        if NUMBER_RE.match(token):
            operands.append(float(token))
            if len(operands) > 6:
                operands.pop(0)
            continue
        # 名字、字符串一类的操作数不参与下一个颜色操作。
        operands = []


def _color_of(token: bytes, operands: list[float]) -> tuple[float, float, float] | None:
    if token in (b"g", b"G"):
        return (operands[-1],) * 3 if operands else None
    if token in (b"k", b"K"):
        if len(operands) < 4:
            return None
        cyan, magenta, yellow, black = operands[-4:]
        return (
            (1 - cyan) * (1 - black),
            (1 - magenta) * (1 - black),
            (1 - yellow) * (1 - black),
        )
    if len(operands) < 3:
        return None
    return (operands[-3], operands[-2], operands[-1])
