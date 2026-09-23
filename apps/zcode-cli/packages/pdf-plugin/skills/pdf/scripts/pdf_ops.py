#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pypdf"]
# ///
"""Whole-page surgery on PDFs: merge, split, extract, rotate, metadata.

This script moves and annotates **whole pages**. It never removes content from
inside a page, never re-flows text, and never rewrites a page's drawing
operators — the operations are page-level concatenation, extraction, rotation
and document metadata, which is what makes them safe to run on a file the user
still needs to read.

Usage:
    python3 pdf_ops.py info    <file.pdf> [more.pdf ...]
    python3 pdf_ops.py merge   -o out.pdf in1.pdf [in2.pdf ...]
    python3 pdf_ops.py extract -o out.pdf in.pdf <pages>
    python3 pdf_ops.py split   --outdir <dir> in.pdf [--every N]
    python3 pdf_ops.py rotate  -o out.pdf in.pdf <pages> --by 90|180|270
    python3 pdf_ops.py meta    in.pdf [--set title=... --set author=...] [-o out.pdf]

    <pages> is a comma-separated list of 1-based ranges: "1,3,5-8,12-".

    extract/split/rotate default to writing a new file; nothing is modified in
    place unless -o names the input file explicitly (which is refused for
    safety unless --force is given).

Notes:
- Bookmarks (outline entries) survive merge and extract where the target pages
  carry them; a bookmark pointing at a page that was not extracted is dropped
  rather than redirected to the wrong page.
- Form fields are preserved as-is; filling them is `check_fillable_fields.py`
  and friends, not this script.
- Encrypted files are refused with a clear message: decrypt first, then operate.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from pypdf import PdfReader, PdfWriter
    from pypdf.errors import DependencyError, PdfReadError
except ImportError as error:  # pragma: no cover - environment dependent
    raise SystemExit(
        "pypdf is required: python3 -m pip install pypdf"
    ) from error


# --------------------------------------------------------------------- helpers


def parse_pages(spec: str, total: int) -> list[int]:
    """Parse "1,3,5-8,12-" (1-based, inclusive, open-ended) into 0-based indices."""
    selected: list[int] = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start_s, _, end_s = part.partition("-")
            start = int(start_s) if start_s else 1
            end = int(end_s) if end_s else total
            if start < 1 or end > total or start > end:
                raise SystemExit(
                    f"page range {part!r} is outside 1..{total}"
                )
            selected.extend(range(start - 1, end))
        else:
            page = int(part)
            if page < 1 or page > total:
                raise SystemExit(f"page {page} is outside 1..{total}")
            selected.append(page - 1)
    if not selected:
        raise SystemExit(f"no pages selected from {spec!r}")
    return selected


def open_reader(path: Path) -> PdfReader:
    try:
        reader = PdfReader(str(path))
    except PdfReadError as error:
        raise SystemExit(f"{path}: not a readable PDF ({error})") from error
    if reader.is_encrypted:
        raise SystemExit(
            f"{path}: encrypted — decrypt it first, then operate on the copy"
        )
    return reader


def refuse_same_file(output: Path, inputs: list[Path], force: bool) -> None:
    """Refuse to overwrite an input unless --force is given."""
    if force:
        return
    resolved_output = output.resolve()
    for source in inputs:
        if source.resolve() == resolved_output:
            raise SystemExit(
                f"refusing to overwrite the input {source} — pass --force if that is really intended"
            )


def page_size_summary(reader: PdfReader) -> str:
    boxes = []
    for page in reader.pages:
        box = page.mediabox
        boxes.append((round(float(box.width), 1), round(float(box.height), 1)))
    if not boxes:
        return "no pages"
    unique = sorted(set(boxes))
    if len(unique) == 1:
        return f"{unique[0][0]} x {unique[0][1]} pt"
    return f"{len(unique)} sizes: " + ", ".join(f"{w} x {h}" for w, h in unique[:4])


# ---------------------------------------------------------------------- commands


def cmd_info(args: argparse.Namespace) -> int:
    for path in args.files:
        reader = open_reader(path)
        metadata = reader.metadata or {}
        print(f"{path}")
        print(f"  pages: {len(reader.pages)}")
        print(f"  size:  {page_size_summary(reader)}")
        if metadata.title:
            print(f"  title: {metadata.title}")
        if metadata.author:
            print(f"  author: {metadata.author}")
        if reader.outline:
            print(f"  bookmarks: {len(reader.outline)} top-level entries")
    return 0


def cmd_merge(args: argparse.Namespace) -> int:
    inputs = [Path(p) for p in args.files]
    if len(inputs) < 2:
        raise SystemExit("merge needs at least two input files")
    output = Path(args.output)
    refuse_same_file(output, inputs, args.force)
    writer = PdfWriter()
    for source in inputs:
        reader = open_reader(source)
        # append() carries the bookmarks whose target pages survive, and is the
        # only call needed — adding pages in a loop as well duplicates them.
        try:
            writer.append(reader)
        except Exception as error:  # noqa: BLE001 - a bookmark problem must not lose the merge
            print(
                f"note: {source}: bookmarks could not be carried over ({error})",
                file=sys.stderr,
            )
            for page in reader.pages:
                writer.add_page(page)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as handle:
        writer.write(handle)
    print(f"merged {len(inputs)} files ({len(writer.pages)} pages) -> {output}")
    return 0


def cmd_extract(args: argparse.Namespace) -> int:
    source = Path(args.file)
    output = Path(args.output)
    refuse_same_file(output, [source], args.force)
    reader = open_reader(source)
    pages = parse_pages(args.pages, len(reader.pages))
    writer = PdfWriter()
    for index in pages:
        writer.add_page(reader.pages[index])
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as handle:
        writer.write(handle)
    print(f"extracted {len(pages)} page(s) from {source} -> {output}")
    return 0


def cmd_split(args: argparse.Namespace) -> int:
    source = Path(args.file)
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    reader = open_reader(source)
    total = len(reader.pages)
    if args.every:
        groups = [
            list(range(start, min(start + args.every, total)))
            for start in range(0, total, args.every)
        ]
    else:
        groups = [[index] for index in range(total)]
    written = 0
    for number, group in enumerate(groups, start=1):
        writer = PdfWriter()
        for index in group:
            writer.add_page(reader.pages[index])
        target = outdir / f"{source.stem}-{number:03d}.pdf"
        with target.open("wb") as handle:
            writer.write(handle)
        written += 1
    print(f"split {source} ({total} pages) into {written} file(s) -> {outdir}")
    return 0


def cmd_rotate(args: argparse.Namespace) -> int:
    source = Path(args.file)
    output = Path(args.output)
    refuse_same_file(output, [source], args.force)
    if args.by % 90 != 0:
        raise SystemExit(f"--by must be a multiple of 90, got {args.by}")
    reader = open_reader(source)
    pages = parse_pages(args.pages, len(reader.pages))
    writer = PdfWriter()
    for index, page in enumerate(reader.pages):
        if index in pages:
            page.rotate(args.by)
        writer.add_page(page)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as handle:
        writer.write(handle)
    print(f"rotated {len(pages)} page(s) by {args.by}deg -> {output}")
    return 0


def cmd_meta(args: argparse.Namespace) -> int:
    source = Path(args.file)
    in_place = args.output is None
    output = Path(args.output) if args.output else source
    if not in_place:
        refuse_same_file(output, [source], args.force)
    reader = open_reader(source)
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    existing = dict(reader.metadata or {})
    for assignment in args.set or []:
        if "=" not in assignment:
            raise SystemExit(f"--set wants key=value, got {assignment!r}")
        key, _, value = assignment.partition("=")
        key = key.strip()
        if key.startswith("/"):
            key = key[1:]
        existing[f"/{key}"] = value
    if existing:
        try:
            writer.add_metadata(existing)
        except DependencyError as error:
            raise SystemExit(f"could not write metadata: {error}") from error
    if in_place:
        # Build beside the target and replace atomically: an interrupted write
        # must leave the original file intact, not a truncated PDF.
        temporary = output.with_suffix(output.suffix + ".tmp")
        with temporary.open("wb") as handle:
            writer.write(handle)
        temporary.replace(output)
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("wb") as handle:
            writer.write(handle)
    printable = {k.lstrip("/"): v for k, v in sorted(existing.items())}
    print(f"metadata for {output}: {printable}")
    return 0


# --------------------------------------------------------------------------- cli


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="pdf_ops.py",
        description="Whole-page PDF surgery: merge, split, extract, rotate, metadata.",
    )
    parser.add_argument("--force", action="store_true", help="allow overwriting an input")
    sub = parser.add_subparsers(dest="command", required=True)

    info = sub.add_parser("info", help="page count, page size and metadata summary")
    info.add_argument("files", nargs="+")
    info.set_defaults(func=cmd_info)

    merge = sub.add_parser("merge", help="concatenate whole PDFs")
    merge.add_argument("files", nargs="+")
    merge.add_argument("-o", "--output", required=True)
    merge.set_defaults(func=cmd_merge)

    extract = sub.add_parser("extract", help="pull a page range into one new PDF")
    extract.add_argument("file")
    extract.add_argument("pages", help='e.g. "1,3,5-8,12-"')
    extract.add_argument("-o", "--output", required=True)
    extract.set_defaults(func=cmd_extract)

    split = sub.add_parser("split", help="write one file per page, or per N pages")
    split.add_argument("file")
    split.add_argument("--outdir", required=True)
    split.add_argument("--every", type=int, default=0, help="group size (default: 1)")
    split.set_defaults(func=cmd_split)

    rotate = sub.add_parser("rotate", help="rotate a page range")
    rotate.add_argument("file")
    rotate.add_argument("pages")
    rotate.add_argument("--by", type=int, required=True, help="90, 180 or 270")
    rotate.add_argument("-o", "--output", required=True)
    rotate.set_defaults(func=cmd_rotate)

    meta = sub.add_parser("meta", help="read or write document metadata")
    meta.add_argument("file")
    meta.add_argument("--set", action="append", help="key=value, repeatable")
    meta.add_argument("-o", "--output", help="write to a new file instead of in place")
    meta.set_defaults(func=cmd_meta)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
