#!/usr/bin/env python3
"""Quality gate for a finished PDF: fifteen checks a reader would notice.

This is not schema validation. A PDF can be perfectly legal and still print
wrong: a blank sheet where a section should end, one page on a different stock,
a font that only exists on the build machine, Chinese set in Helvetica and
coming out as boxes, a last page holding two orphan lines. Those are the things
this checks — on the artifact, with poppler, after the build is done.

Usage:
    python3 pdf_qa.py <file.pdf> [more.pdf ...] [--json] [--poster] [--skip-cover] [--no-tables] [--formulas]

    --json          machine-readable output
    --poster        poster mode: also check that the cover background bleeds
    --skip-cover    skip the first page when judging margin symmetry
    --no-tables     do not judge table centering
    --formulas      also check display formulas against the text column

Positional arguments are glob patterns, so a whole build directory can be gated
in one call; every file gets its own report, separated by a blank line.

The fifteen checks, in the order they run:

    last_page_fill, punctuation, blank_pages, colors, page_size_consistency,
    text_overflow, content_fill_ratio, cover_bleed, margin_symmetry,
    table_centering, font_embedding, helvetica_in_cjk, metadata,
    toc_without_cover, formula_overflow

Exit status:
    0  every check passed, or reported at most a warning
    1  usage error, unreadable file, or a missing poppler tool
    2  at least one check reported an ERROR

Only ERROR fails the gate. A warning is a judgement call the author makes; an
error is a defect the reader sees.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys

from pdf_qa_checks import DEFAULT_RULES, RULES, Finding, Options
from pdf_qa_document import PdfQaError, load_pdf

EXIT_CLEAN = 0
EXIT_USAGE = 1
EXIT_DEFECT = 2


def check_pdf(path: str, options: Options) -> list[Finding]:
    """Run every rule against one PDF; a rule that raises is itself a finding."""
    document = load_pdf(path)
    findings: list[Finding] = []
    for name in DEFAULT_RULES:
        try:
            findings.append(RULES[name](document, options))
        except Exception as error:  # noqa: BLE001 - one bad rule must not hide the rest
            findings.append(Finding(name, "ERROR", f"rule raised {type(error).__name__}: {error}"))
    return findings


def count(findings: list[Finding], severity: str) -> int:
    return sum(1 for finding in findings if finding.severity == severity)


def render_human(path: str, findings: list[Finding]) -> list[str]:
    lines = [f"pdf_qa {path}"]
    for finding in findings:
        lines.append(f"  [{finding.severity:<5}] {finding.name}: {finding.message}")
    lines.append(
        f"  {count(findings, 'OK')} ok, {count(findings, 'WARN')} warning(s), {count(findings, 'ERROR')} error(s)"
    )
    return lines


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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="pdf_qa.py",
        description="Quality gate for a finished PDF: fifteen checks a reader would notice.",
    )
    parser.add_argument("pdfs", nargs="*", metavar="file.pdf", help="PDF(s) to check; glob patterns are expanded")
    parser.add_argument("--json", action="store_true", help="emit JSON")
    parser.add_argument("--poster", action="store_true", help="poster mode: also check cover bleed")
    parser.add_argument("--skip-cover", action="store_true", help="skip the first page in the margin check")
    parser.add_argument("--no-tables", action="store_true", help="do not judge table centering")
    parser.add_argument("--formulas", action="store_true", help="also check display formulas")
    args = parser.parse_args(argv)

    if not args.pdfs:
        parser.print_usage(sys.stderr)
        print("error: no PDF given", file=sys.stderr)
        return EXIT_USAGE

    targets, failure = expand(args.pdfs)
    if failure is not None:
        print(f"error: {failure}", file=sys.stderr)
        return EXIT_USAGE

    options = Options(
        poster=args.poster,
        skip_cover=args.skip_cover,
        no_tables=args.no_tables,
        formulas=args.formulas,
    )

    reports: list[dict] = []
    blocks: list[str] = []
    status = EXIT_CLEAN
    failures = 0
    for target in targets:
        try:
            findings = check_pdf(target, options)
        except PdfQaError as error:
            # 读不了的文件不能算通过：它是用法/环境错误，退出码与缺陷不同。
            status = EXIT_USAGE
            failures += 1
            reports.append({"path": target, "error": str(error)})
            if not args.json:
                print(f"error: {target}: {error}", file=sys.stderr)
            continue
        errors = count(findings, "ERROR")
        if errors:
            status = EXIT_DEFECT
        reports.append(
            {
                "path": target,
                "findings": [finding.to_dict() for finding in findings],
                "errors": errors,
                "warnings": count(findings, "WARN"),
            }
        )
        blocks.append("\n".join(render_human(target, findings)))

    if args.json:
        print(
            json.dumps(
                {
                    "files": reports,
                    "errors": sum(report.get("errors", 0) for report in reports),
                    "warnings": sum(report.get("warnings", 0) for report in reports),
                    "unreadable": failures,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        print("\n\n".join(blocks))
        if len(blocks) > 1:
            print(f"\n{len(blocks)} file(s) checked")
    return status


if __name__ == "__main__":
    raise SystemExit(main())
