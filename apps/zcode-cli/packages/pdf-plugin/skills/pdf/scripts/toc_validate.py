#!/usr/bin/env python3
"""Validate a document's table of contents: entries, page numbers, hierarchy.

A table of contents is the one part of a document a reader navigates by, and the
one part a build can quietly get wrong: an entry whose section no longer exists,
a page number left at the placeholder, a hierarchy that skips a level. This
checks the printed contents against the document it sits in — not the outline
bookmarks, which viewers synthesise and which can disagree with the page.

    python3 toc_validate.py <file.pdf> [more.pdf ...] [--json] [--skip-page-check]

Positional arguments are glob patterns; every file gets its own report.

The six checks, in the order they run:

    toc_present         a contents heading exists in the first pages
    entries_resolve     every entry matches a heading in the body
    headings_covered    every heading in the body has an entry
    page_placeholder    every entry's page number is a real number
    page_agreement      every entry points at the page its heading is on
    level_sequence      the hierarchy never skips a level

Judgement model, severities and exit status follow `pdf_qa.py` (§6.5): `ERROR` is
a defect the reader sees, `WARN` is a judgement call, and only `ERROR` fails the
gate.

    exit 0  every check passed, or reported at most a warning
    exit 1  usage error, an unreadable file, or a missing poppler tool
    exit 2  at least one check reported an ERROR

Boundaries, stated plainly:

  * The contents must be *printed* text on a page carrying a contents heading in
    the first few pages; PDF outline bookmarks are not consulted, and a document
    whose contents live in the outline alone is reported as having none.
  * Page agreement is judged against an offset derived from the entries
    themselves, so front matter in roman numerals and a body restarting at 1 are
    both handled; pass `--skip-page-check` to turn the check off entirely.
  * Levels come from the numbering prefix when the contents carry no
    indentation, and from the indents themselves when they do — calibrated per
    document, not assumed.
  * Heading detection is a height heuristic (a line whose glyphs are a quarter
    taller than the document's median, and only a few words long). It is
    conservative on purpose: a missed heading is reported, a false heading is
    not invented.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys
from dataclasses import dataclass

from toc_validate_document import Entry, Heading, TocError, TocFacts, load

EXIT_CLEAN = 0
EXIT_USAGE = 1
EXIT_DEFECT = 2

SEVERITY_OK = "OK"
SEVERITY_WARN = "WARN"
SEVERITY_ERROR = "ERROR"

# 每条 finding 最多列几条明细，避免一份坏目录刷满屏幕。
MAX_DETAILS = 5
# 匹配前把空白与大小写抹掉：目录标题与正文标题只应差这些。
NOISE_RE = re.compile(r"\s+")


@dataclass
class Finding:
    """One check's conclusion. `ok` is derived: only OK counts as passing."""

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
    """The one switch, resolved once by the CLI."""

    skip_page_check: bool = False


def normalize(text: str) -> str:
    """Comparison form: no whitespace, no case, no trailing sentence marks."""
    return NOISE_RE.sub("", text).casefold().strip("。．.,，;；")


def titles_match(entry_title: str, heading_text: str) -> bool:
    """Equal after normalising, or one containing the other (numbering differs)."""
    left, right = normalize(entry_title), normalize(heading_text)
    return bool(left) and bool(right) and (left == right or left in right or right in left)


def resolve(entry: Entry, headings: list[Heading]) -> Heading | None:
    """The body heading an entry claims, or None when there is none."""
    for heading in headings:
        if titles_match(entry.title, heading.text):
            return heading
    return None


def page_offset(entries: list[Entry], resolved: dict[int, Heading]) -> int | None:
    """Claimed → physical page shift, from the entries that did resolve.

    A body that restarts at 1 after roman front matter needs this; taking the
    most common difference keeps one wrong entry from poisoning the rest.
    """
    counts: dict[int, int] = {}
    for entry in entries:
        heading = resolved.get(entry.index)
        if entry.page_kind != "arabic" or heading is None or entry.page_number is None:
            continue
        counts[heading.page - entry.page_number] = counts.get(heading.page - entry.page_number, 0) + 1
    if not counts:
        return None
    return max(counts, key=lambda shift: counts[shift])


def check_toc_present(facts: TocFacts, options: Options) -> Finding:
    """No contents in the first pages means there is nothing to validate."""
    if not facts.toc_pages:
        return Finding("toc_present", SEVERITY_WARN, "no table of contents found in the first pages; nothing to validate")
    listed = ", ".join(str(page) for page in facts.toc_pages)
    return Finding("toc_present", SEVERITY_OK, f"table of contents on page(s) {listed}")


def check_entries_resolve(facts: TocFacts, resolved: dict[int, Heading], options: Options) -> Finding:
    """An entry with no heading behind it points the reader at nothing."""
    missing = [entry for entry in facts.entries if entry.index not in resolved]
    if not missing:
        return Finding("entries_resolve", SEVERITY_OK, f"all {len(facts.entries)} entries match a heading")
    detail = "; ".join(f"{entry.title!r}" for entry in missing[:MAX_DETAILS])
    more = f" (+{len(missing) - MAX_DETAILS} more)" if len(missing) > MAX_DETAILS else ""
    return Finding(
        "entries_resolve",
        SEVERITY_ERROR,
        f"{len(missing)} entr{'y is' if len(missing) == 1 else 'ies are'} without a heading: {detail}{more}",
    )


def check_headings_covered(facts: TocFacts, options: Options) -> Finding:
    """A heading with no entry is a section the reader cannot find."""
    unmatched = [
        heading
        for heading in facts.headings
        if not any(titles_match(entry.title, heading.text) for entry in facts.entries)
    ]
    if not unmatched:
        return Finding("headings_covered", SEVERITY_OK, f"every heading appears in the contents ({len(facts.headings)} checked)")
    detail = "; ".join(f"page {heading.page}: {heading.text!r}" for heading in unmatched[:MAX_DETAILS])
    more = f" (+{len(unmatched) - MAX_DETAILS} more)" if len(unmatched) > MAX_DETAILS else ""
    return Finding(
        "headings_covered",
        SEVERITY_ERROR,
        f"{len(unmatched)} heading(s) missing from the contents: {detail}{more}",
    )


def check_page_placeholder(facts: TocFacts, options: Options) -> Finding:
    """`00`, `x`, an empty field: the build never resolved the page."""
    placeholders = [entry for entry in facts.entries if entry.page_kind == "placeholder"]
    if not placeholders:
        numbered = sum(1 for entry in facts.entries if entry.page_kind == "arabic")
        return Finding("page_placeholder", SEVERITY_OK, f"{numbered} entr{'y has' if numbered == 1 else 'ies have'} a real page number")
    detail = "; ".join(
        f"{entry.title!r} -> {entry.page_field!r}" if entry.page_field else f"{entry.title!r} -> no page number"
        for entry in placeholders[:MAX_DETAILS]
    )
    more = f" (+{len(placeholders) - MAX_DETAILS} more)" if len(placeholders) > MAX_DETAILS else ""
    return Finding("page_placeholder", SEVERITY_ERROR, f"{len(placeholders)} placeholder page number(s): {detail}{more}")


def check_page_agreement(
    facts: TocFacts,
    resolved: dict[int, Heading],
    shift: int | None,
    options: Options,
) -> Finding:
    """An entry that points at the wrong page sends the reader to the wrong sheet."""
    if options.skip_page_check:
        return Finding("page_agreement", SEVERITY_OK, "skipped: pass without --skip-page-check to check page numbers")
    if shift is None:
        return Finding(
            "page_agreement",
            SEVERITY_WARN,
            "no entry could be located, so no page offset could be derived; not judged",
        )
    wrong: list[str] = []
    judged = 0
    for entry in facts.entries:
        heading = resolved.get(entry.index)
        if entry.page_kind != "arabic" or heading is None or entry.page_number is None:
            continue
        judged += 1
        if heading.page != entry.page_number + shift:
            wrong.append(f"{entry.title!r}: contents says {entry.page_number}, heading is on page {heading.page}")
    if not wrong:
        return Finding("page_agreement", SEVERITY_OK, f"{judged} entr{'y points' if judged == 1 else 'ies point'} at the right page")
    detail = "; ".join(wrong[:MAX_DETAILS])
    more = f" (+{len(wrong) - MAX_DETAILS} more)" if len(wrong) > MAX_DETAILS else ""
    return Finding("page_agreement", SEVERITY_ERROR, f"{len(wrong)} wrong page number(s): {detail}{more}")


def check_level_sequence(facts: TocFacts, options: Options) -> Finding:
    """A hierarchy that jumps two levels is a section the reader cannot place."""
    jumps: list[str] = []
    previous: Entry | None = None
    for entry in facts.entries:
        if previous is not None and entry.level > previous.level + 1:
            jumps.append(f"{previous.title!r} (level {previous.level}) -> {entry.title!r} (level {entry.level})")
        previous = entry
    if not jumps:
        return Finding("level_sequence", SEVERITY_OK, f"levels ascend by at most one across {len(facts.entries)} entries")
    detail = "; ".join(jumps[:MAX_DETAILS])
    more = f" (+{len(jumps) - MAX_DETAILS} more)" if len(jumps) > MAX_DETAILS else ""
    return Finding("level_sequence", SEVERITY_ERROR, f"{len(jumps)} skipped level(s): {detail}{more}")


def check_pdf(path: str, options: Options) -> list[Finding]:
    """Run every check against one PDF; a tool failure is itself an error."""
    facts = load(path)
    if not facts.entries:
        return [check_toc_present(facts, options)]
    resolved = {
        entry.index: heading
        for entry in facts.entries
        if (heading := resolve(entry, facts.headings)) is not None
    }
    shift = page_offset(facts.entries, resolved)
    findings = [
        check_toc_present(facts, options),
        check_entries_resolve(facts, resolved, options),
        check_headings_covered(facts, options),
        check_page_placeholder(facts, options),
        check_page_agreement(facts, resolved, shift, options),
        check_level_sequence(facts, options),
    ]
    # 目录条目在正文里找不到、但文字确实出现过：降一级为 WARN，说明是标题样式问题。
    for entry in facts.entries:
        if entry.index in resolved:
            continue
        if normalize(entry.title) and normalize(entry.title) in normalize(facts.body_text):
            findings.append(
                Finding(
                    "entries_resolve",
                    SEVERITY_WARN,
                    f"{entry.title!r} appears in the body but not as a heading",
                )
            )
    return findings


def count(findings: list[Finding], severity: str) -> int:
    return sum(1 for finding in findings if finding.severity == severity)


def render_human(path: str, findings: list[Finding]) -> list[str]:
    lines = [f"toc_validate {path}"]
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
        prog="toc_validate.py",
        description="Validate a document's table of contents: entries, page numbers, hierarchy.",
    )
    parser.add_argument("pdfs", nargs="*", metavar="file.pdf", help="PDF(s) to check; glob patterns are expanded")
    parser.add_argument("--json", action="store_true", help="emit JSON")
    parser.add_argument("--skip-page-check", action="store_true", help="do not compare entry page numbers with the body")
    args = parser.parse_args(argv)

    if not args.pdfs:
        parser.print_usage(sys.stderr)
        print("error: no PDF given", file=sys.stderr)
        return EXIT_USAGE

    targets, failure = expand(args.pdfs)
    if failure is not None:
        print(f"error: {failure}", file=sys.stderr)
        return EXIT_USAGE

    options = Options(skip_page_check=args.skip_page_check)
    reports: list[dict] = []
    blocks: list[str] = []
    status = EXIT_CLEAN
    unreadable = 0
    for target in targets:
        try:
            findings = check_pdf(target, options)
        except TocError as error:
            # 读不了的文件不能算通过：它是用法/环境错误，退出码与缺陷不同。
            status = EXIT_USAGE
            unreadable += 1
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
                    "unreadable": unreadable,
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
