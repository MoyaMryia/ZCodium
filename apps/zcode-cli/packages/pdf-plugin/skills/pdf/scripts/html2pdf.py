#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# ///
#
# Option model derived from `html2pdf.js`
# (https://github.com/eKoopmans/html2pdf.js),
# Copyright (c) 2017-2019 Erik Koopmans, MIT License.
#
# MIT License
#
# Copyright (c) 2017-2019 Erik Koopmans
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.
#
# Delta from upstream: only the option model is derived. No upstream code is
# vendored — not the worker, not the pagebreak plugin, not the DOM clone — and
# neither jsdom, node-canvas nor puppeteer is introduced. The rendering path is
# entirely different: upstream rasterises a DOM through html2canvas into a jsPDF
# image; this script delegates to the local LibreOffice HTML import, which
# typesets vector text. The `image` and `html2canvas` options therefore have no
# effect here (there is no canvas stage), the `jsPDF` options survive only where
# they describe page geometry, and `margin` is honoured through CSS `@page`
# rather than through jsPDF's unit conversion.

"""Render an HTML document to PDF through the local LibreOffice, carrying the
html2pdf.js option model.

html2pdf.js (eKoopmans/html2pdf.js, MIT) is a browser library: it rasterises a DOM
with html2canvas and writes the result into jsPDF. Both stages need a DOM, so it
cannot run under Node, and this plugin vendors none of its code. What is borrowed
is the interface — the option names, their shapes and their defaults: `margin`,
`filename`, `image.type`/`image.quality`, the `pagebreak` modes and the two
passthrough configuration objects — so a document authored against that model
renders here without rewriting its options.

The rendering path is ours: the HTML is handed to `soffice --headless` with the
Writer HTML import filter, which typesets real, selectable vector text (upstream's
raster route produces a picture of text, neither searchable nor small). Page
geometry is set by injecting an `@page` rule; page breaks by injecting the break
rules the options ask for.

Usage:
    python3 html2pdf.py <file.html> [more.html ...] [--outdir DIR] [--margin SPEC]
        [--filename NAME] [--image-type jpeg|png|webp] [--image-quality 0..1]
        [--pagebreak-mode css|legacy|avoid-all[,...]] [--pagebreak-before SEL]
        [--pagebreak-after SEL] [--pagebreak-avoid SEL] [--format a4|letter|...]
        [--orientation portrait|landscape] [--js-pdf KEY=VALUE]
        [--html2canvas KEY=VALUE] [--json] [--keep-html]

Positional arguments are glob patterns, so a whole directory of pages can be
rendered in one call; each file gets its own line of report.

The option model, and where each option lands here:

    margin        a number, `v,h`, `t,l,b,r`, or a JSON object; unitless numbers
                  are points unless jsPDF's `unit` says otherwise, and a unit
                  suffix (`2cm`) always wins. Injected as the `@page` margin,
                  which LibreOffice honours exactly on the left, right and
                  bottom; the top sits one line-height lower because the first
                  paragraph keeps its own leading.
    filename      name of the produced PDF; defaults to the input's stem. The PDF
                  is written next to the input unless --outdir says otherwise.
    image         `type`/`quality` describe upstream's raster stage. There is no
                  raster stage here, so both are accepted, validated and echoed,
                  and change nothing.
    pagebreak     `css` respects the document's own break rules (the default);
                  `legacy` adds a page break after elements carrying the class
                  `html2pdf__page-break`; `avoid-all` asks the renderer to keep
                  block elements whole. LibreOffice honours break rules on real
                  block elements (`p`, `h1`-`h6`, `table`, `li`) and ignores them
                  on `div`, and ignores `page-break-inside` outright, so
                  `avoid-all` is accepted with no observable effect.
    jsPDF         `unit`, `format` and `orientation` set the page geometry; any
                  other key is echoed only.
    html2canvas   accepted and echoed; there is no canvas stage to configure.

Exit status:
    0  every input rendered
    1  usage error, an unreadable input, or a missing or failing `soffice`

A failed render is never silent: the report names the input, the converter's exit
status and the last line of its stderr.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys

from html2pdf_render import (
    DEFAULT_IMAGE_QUALITY,
    DEFAULT_IMAGE_TYPE,
    DEFAULT_MARGIN,
    DEFAULT_ORIENTATION,
    DEFAULT_PAGE_FORMAT,
    DEFAULT_PAGEBREAK_MODES,
    DEFAULT_UNIT,
    IMAGE_TYPES,
    ORIENTATIONS,
    PAGE_SIZES_MM,
    PAGEBREAK_MODES,
    UNIT_TO_CSS,
    Options,
    RenderError,
    parse_margin,
    plan,
    render_one,
)

EXIT_OK = 0
EXIT_ERROR = 1


def expand(patterns: list[str]) -> tuple[list[str], str | None]:
    """Glob every positional argument; report the first one that matches nothing."""
    targets: list[str] = []
    for pattern in patterns:
        matches = sorted(glob.glob(pattern))
        if not matches:
            reason = "is a directory" if os.path.isdir(pattern) else "no such file"
            return [], f"{reason}: {pattern}"
        targets.extend(matches)
    return targets, None


def parse_pairs(pairs: list[str]) -> dict:
    """`KEY=VALUE` arguments, values decoded as JSON when they look like it."""
    parsed: dict = {}
    for pair in pairs:
        key, separator, value = pair.partition("=")
        if not separator or not key.strip():
            raise RenderError(f"expected KEY=VALUE, got {pair!r}")
        try:
            parsed[key.strip()] = json.loads(value)
        except json.JSONDecodeError:
            parsed[key.strip()] = value
    return parsed


def resolve(key: str, js_pdf: dict, override, default):
    """CLI flag beats the jsPDF passthrough object beats the default."""
    if override is not None:
        return override
    if key in js_pdf:
        return js_pdf[key]
    return default


def build_options(args: argparse.Namespace) -> Options:
    """Validate everything up front: a bad option must not half-render."""
    js_pdf = parse_pairs(args.js_pdf)
    html2canvas = parse_pairs(args.html2canvas)
    unit = resolve("unit", js_pdf, args.unit, DEFAULT_UNIT)
    if unit not in UNIT_TO_CSS:
        raise RenderError(f"unsupported jsPDF unit {unit!r}: expected one of {', '.join(sorted(UNIT_TO_CSS))}")
    page_format = resolve("format", js_pdf, args.format, DEFAULT_PAGE_FORMAT)
    if page_format not in PAGE_SIZES_MM:
        raise RenderError(f"unknown page format {page_format!r}: expected one of {', '.join(sorted(PAGE_SIZES_MM))}")
    orientation = resolve("orientation", js_pdf, args.orientation, DEFAULT_ORIENTATION)
    if orientation not in ORIENTATIONS:
        raise RenderError(f"unknown orientation {orientation!r}: expected one of {', '.join(ORIENTATIONS)}")
    if args.image_type not in IMAGE_TYPES:
        raise RenderError(f"unknown image type {args.image_type!r}: expected one of {', '.join(IMAGE_TYPES)}")
    if not 0 < args.image_quality <= 1:
        raise RenderError(f"image quality must be in (0, 1], got {args.image_quality}")
    modes = tuple(dict.fromkeys(mode.strip() for mode in args.pagebreak_mode.split(",") if mode.strip()))
    unknown = [mode for mode in modes if mode not in PAGEBREAK_MODES]
    if unknown:
        raise RenderError(f"unknown pagebreak mode(s) {unknown}: expected one of {', '.join(PAGEBREAK_MODES)}")
    if args.filename is not None and len(args.inputs) > 1:
        raise RenderError("--filename names one output; pass it with a single input")
    if args.filename is not None and len(args.inputs) > 1:
        raise RenderError("--filename names one output; pass it with a single input")
    parse_margin(args.margin, unit)
    return Options(
        inputs=args.inputs,
        outdir=args.outdir,
        filename=args.filename,
        margin=args.margin,
        unit=unit,
        page_format=page_format,
        orientation=orientation,
        image_type=args.image_type,
        image_quality=args.image_quality,
        pagebreak_modes=modes or DEFAULT_PAGEBREAK_MODES,
        pagebreak_before=tuple(args.pagebreak_before),
        pagebreak_after=tuple(args.pagebreak_after),
        pagebreak_avoid=tuple(args.pagebreak_avoid),
        html2canvas=html2canvas,
        js_pdf=js_pdf,
        keep_html=args.keep_html,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="html2pdf.py",
        description="Render HTML to PDF through the local LibreOffice, with the html2pdf.js option model.",
    )
    parser.add_argument("inputs", nargs="*", metavar="file.html", help="HTML file(s) to render; glob patterns are expanded")
    parser.add_argument("--outdir", help="directory for the PDFs (default: beside each input)")
    parser.add_argument("--filename", help="name of the produced PDF (single input only)")
    parser.add_argument("--margin", default=DEFAULT_MARGIN, help="number, `v,h`, `t,l,b,r` or a JSON object; unitless = points")
    parser.add_argument("--unit", help="unit for unitless margin numbers (default: pt)")
    parser.add_argument("--format", help=f"page format (default: {DEFAULT_PAGE_FORMAT})")
    parser.add_argument("--orientation", help=f"page orientation (default: {DEFAULT_ORIENTATION})")
    parser.add_argument("--image-type", default=DEFAULT_IMAGE_TYPE, help="accepted for compatibility; no effect on vector output")
    parser.add_argument("--image-quality", type=float, default=DEFAULT_IMAGE_QUALITY, help="accepted for compatibility; no effect on vector output")
    parser.add_argument("--pagebreak-mode", default=",".join(DEFAULT_PAGEBREAK_MODES), help="comma-separated: css, legacy, avoid-all")
    parser.add_argument("--pagebreak-before", action="append", default=[], help="selector: start a new page before each match")
    parser.add_argument("--pagebreak-after", action="append", default=[], help="selector: start a new page after each match")
    parser.add_argument("--pagebreak-avoid", action="append", default=[], help="selector: keep each match on one page")
    parser.add_argument("--js-pdf", action="append", default=[], metavar="KEY=VALUE", help="jsPDF passthrough option; unit/format/orientation are honoured")
    parser.add_argument("--html2canvas", action="append", default=[], metavar="KEY=VALUE", help="html2canvas passthrough option; echoed only")
    parser.add_argument("--json", action="store_true", help="emit JSON")
    parser.add_argument("--keep-html", action="store_true", help="keep the prepared HTML beside the output")
    args = parser.parse_args(argv)
    args.inputs = list(args.inputs)

    if not args.inputs:
        parser.print_usage(sys.stderr)
        print("error: no HTML given", file=sys.stderr)
        return EXIT_ERROR

    try:
        options = build_options(args)
        targets, failure = expand(args.inputs)
        if failure is not None:
            raise RenderError(failure)
        if options.filename is not None and len(targets) > 1:
            raise RenderError("--filename names one output; pass it with a single input")
    except RenderError as error:
        print(f"error: {error}", file=sys.stderr)
        return EXIT_ERROR

    # 输出撞名要在渲染前发现：事后再报，第一次的产物已经被覆盖了。
    grouped: dict[str, list[str]] = {}
    try:
        for target in targets:
            grouped.setdefault(str(plan(target, options)[2]), []).append(target)
    except RenderError as error:
        print(f"error: {error}", file=sys.stderr)
        return EXIT_ERROR
    collisions = {path: sources for path, sources in grouped.items() if len(sources) > 1}
    if collisions:
        detail = "; ".join(f"{path} <- {', '.join(sources)}" for path, sources in collisions.items())
        print(f"error: outputs collide: {detail}", file=sys.stderr)
        return EXIT_ERROR

    records: list[dict] = []
    lines: list[str] = []
    status = EXIT_OK
    for target in targets:
        entry = {"source": target, "options": options.summary()}
        try:
            entry.update(render_one(target, options))
        except RenderError as error:
            # 渲染失败不是"跳过这一页"：报出输入与原因，退出码非 0。
            entry["error"] = str(error)
            status = EXIT_ERROR
            if not args.json:
                print(f"error: {target}: {error}", file=sys.stderr)
        else:
            lines.append(f"html2pdf {target} -> {entry['output']}")
        records.append(entry)

    if args.json:
        print(json.dumps({"files": records, "ok": status == EXIT_OK}, ensure_ascii=False, indent=2))
    else:
        print("\n".join(lines))
        if len(records) > 1:
            print(f"\n{len(records)} file(s) rendered, {len(lines)} succeeded")
    return status


if __name__ == "__main__":
    raise SystemExit(main())
