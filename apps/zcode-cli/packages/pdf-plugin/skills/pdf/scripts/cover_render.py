#!/usr/bin/env python3
"""Render a cover page and put it in front of a body PDF.

A cover is a special page, not the first page of the body: it usually carries no
header or footer, sits on different margins, and is sometimes on another stock or
in landscape. The reliable way to honour that is to render it as its own one-page
document and concatenate it before the body — which is what this does. The cover
and the body are therefore allowed to disagree about size, orientation and
margins, and the body's own geometry is left untouched.

    python3 cover_render.py --cover cover.html --body body.pdf -o final.pdf
    python3 cover_render.py --cover cover.html --body body.html -o final.pdf

`--body` takes a PDF (already built, kept as it is) or an HTML file (rendered
here through the same LibreOffice path as html2pdf.py, §6.6). `--margin`,
`--format` and `--orientation` describe the **body** and apply only when the body
is HTML; `--cover-margin`, `--cover-format` and `--cover-orientation` describe the
cover. A PDF body keeps its own geometry, so those three are ignored for it.

Boundaries, stated plainly:

  * The cover must fit one page. A cover that overflows is a defect, not a
    two-page cover, so the script refuses to write anything and says so.
  * Merging is page concatenation through pypdf — there is no qpdf in this
    environment, and none is needed for putting one page in front of another.
    Internal links and the outline of a PDF body ride along as far as pypdf
    carries them.
  * The cover is page 1 of the output. The report prints page 1's extracted
    first line so that is verifiable without opening a viewer.

Exit status:
    0  the output was written
    1  usage error, a missing dependency, a cover that is not one page, or a
       render/merge failure
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from html2pdf_render import (
    DEFAULT_MARGIN,
    DEFAULT_ORIENTATION,
    DEFAULT_PAGE_FORMAT,
    Options,
    RenderError,
    render_one,
)
from pypdf import PdfReader, PdfWriter

EXIT_OK = 0
EXIT_ERROR = 1

# 封面只能是一页；报告里展示的首页文本预览长度。
COVER_PAGES = 1
PREVIEW_CHARS = 60


class CoverError(RuntimeError):
    """A missing dependency, a bad input, a multi-page cover, or a failed merge."""


@dataclass
class Geometry:
    """Page stock and margins for one side of the merge."""

    margin: str = DEFAULT_MARGIN
    page_format: str = DEFAULT_PAGE_FORMAT
    orientation: str = DEFAULT_ORIENTATION


def render_cover(cover: Path, geometry: Geometry, keep_html: bool, workdir: Path) -> Path:
    """Render the cover HTML into `workdir` as its own one-page PDF.

    Only the PDF goes to `workdir`: html2pdf_render still writes its prepared
    HTML beside the source, so the cover's relative resources resolve.
    """
    options = Options(
        outdir=str(workdir),
        margin=geometry.margin,
        page_format=geometry.page_format,
        orientation=geometry.orientation,
        keep_html=keep_html,
    )
    record = render_one(str(cover), options)
    return Path(record["output"])


def render_body(body: Path, geometry: Geometry, keep_html: bool, workdir: Path) -> Path:
    """Render an HTML body, or hand back a PDF body unchanged."""
    if body.suffix.lower() == ".pdf":
        return body
    options = Options(
        outdir=str(workdir),
        margin=geometry.margin,
        page_format=geometry.page_format,
        orientation=geometry.orientation,
        keep_html=keep_html,
    )
    return Path(render_one(str(body), options)["output"])


def page_facts(pdf: Path) -> tuple[int, tuple[float, float], str]:
    """(page count, first-page size in points, first line of page-1 text)."""
    reader = PdfReader(str(pdf))
    if reader.is_encrypted:
        raise CoverError(f"{pdf} is encrypted; decrypt it before merging")
    pages = len(reader.pages)
    box = reader.pages[0].mediabox
    text = (reader.pages[0].extract_text() or "").strip().splitlines()
    return pages, (float(box.width), float(box.height)), (text[0].strip() if text else "")


def merge(cover: Path, body: Path, output: Path) -> dict:
    """Concatenate the cover in front of the body and describe the result."""
    writer = PdfWriter()
    try:
        writer.append(str(cover))
        writer.append(str(body))
    except Exception as error:  # noqa: BLE001 - pypdf raises a dozen unrelated types
        raise CoverError(f"could not merge {cover} + {body}: {error}") from error
    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "wb") as handle:
        writer.write(handle)
    pages, size, preview = page_facts(output)
    return {"output": str(output), "pages": pages, "page1_size_pt": [round(size[0]), round(size[1])], "page1_text": preview[:PREVIEW_CHARS]}


def run(args: argparse.Namespace) -> dict:
    """Render, check the cover, merge, and report what landed where."""
    cover = Path(args.cover).expanduser()
    body = Path(args.body).expanduser()
    output = Path(args.output).expanduser()
    for label, path in (("--cover", cover), ("--body", body)):
        if not path.is_file():
            raise CoverError(f"{label} is not a file: {path}")
    if output.resolve() in (cover.resolve(), body.resolve()):
        raise CoverError("--output would overwrite an input; choose another name")

    cover_geometry = Geometry(args.cover_margin, args.cover_format, args.cover_orientation)
    body_geometry = Geometry(args.margin, args.format, args.orientation)
    with tempfile.TemporaryDirectory(prefix="cover-render-") as workdir:
        cover_pdf = render_cover(cover, cover_geometry, args.keep_html, Path(workdir))
        cover_pages, cover_size, _ = page_facts(cover_pdf)
        if cover_pages != COVER_PAGES:
            raise CoverError(
                f"cover rendered {cover_pages} pages, but a cover is one page — "
                "shorten the cover HTML or shrink --cover-margin"
            )
        body_pdf = render_body(body, body_geometry, args.keep_html, Path(workdir))
        body_pages, _, _ = page_facts(body_pdf)
        record = merge(cover_pdf, body_pdf, output)
    record.update(
        {
            "cover": str(cover),
            "body": str(body),
            "cover_pages": cover_pages,
            "cover_size_pt": [round(cover_size[0]), round(cover_size[1])],
            "body_pages": body_pages,
        }
    )
    return record


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="cover_render.py",
        description="Render a cover page and put it in front of a body PDF.",
    )
    parser.add_argument("--cover", required=True, help="cover HTML file")
    parser.add_argument("--body", required=True, help="body PDF (kept as is) or body HTML (rendered here)")
    parser.add_argument("-o", "--output", required=True, help="the merged PDF to write")
    parser.add_argument("--cover-margin", default=DEFAULT_MARGIN, help="cover margin (html2pdf margin syntax)")
    parser.add_argument("--cover-format", default=DEFAULT_PAGE_FORMAT, help="cover page format (default: a4)")
    parser.add_argument("--cover-orientation", default=DEFAULT_ORIENTATION, help="cover orientation (default: portrait)")
    parser.add_argument("--margin", default=DEFAULT_MARGIN, help="body margin, when the body is HTML")
    parser.add_argument("--format", default=DEFAULT_PAGE_FORMAT, help="body page format, when the body is HTML")
    parser.add_argument("--orientation", default=DEFAULT_ORIENTATION, help="body orientation, when the body is HTML")
    parser.add_argument("--json", action="store_true", help="emit JSON")
    parser.add_argument("--keep-html", action="store_true", help="keep the prepared HTML beside its source")
    args = parser.parse_args(argv)

    try:
        record = run(args)
    except (CoverError, RenderError) as error:
        if args.json:
            print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False, indent=2))
        else:
            print(f"error: {error}", file=sys.stderr)
        return EXIT_ERROR

    if args.json:
        print(json.dumps({"ok": True, **record}, ensure_ascii=False, indent=2))
    else:
        print(f"cover_render {record['cover']} + {record['body']} -> {record['output']}")
        print(
            f"  cover: page 1 of {record['pages']} at "
            f"{record['cover_size_pt'][0]}x{record['cover_size_pt'][1]} pt — {record['page1_text']!r}"
        )
        print(f"  body: {record['body_pages']} page(s) appended after it")
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
