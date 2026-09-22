#!/usr/bin/env python3
"""Visual and typesetting self-check for a generated .docx.

This is not schema validation. OOXML can be perfectly legal and still look
broken: a trailing page break that prints a blank sheet, a table whose header row
does not repeat, a Chinese body with no first-line indent, a font that only
exists on the machine that built the file. Those are the things this checks.

Usage:
    python3 postcheck.py <file.docx> [--json] [--only name[,name...]] [--fix]

    --json          machine-readable output
    --only          run a subset of rules (comma-separated names)
    --fix           accepted for CLI compatibility; no rule auto-fixes yet

Exit status is 0 when every selected rule passes, 1 otherwise, so it composes
into a build step.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from postcheck_document import load_document
from postcheck_rules import DEFAULT_RULES, RULES, Finding


def run_checks(docx_path: str | Path, only=DEFAULT_RULES) -> list[Finding]:
    doc = load_document(docx_path)
    findings: list[Finding] = []
    for name in only:
        rule = RULES.get(name)
        if rule is None:
            findings.append(
                Finding(name, False, f"unknown rule; available: {sorted(RULES)}", "error")
            )
            continue
        try:
            findings.append(rule(doc))
        except Exception as error:  # noqa: BLE001 - one bad rule must not hide the rest
            findings.append(Finding(name, False, f"rule raised {type(error).__name__}: {error}", "error"))
    return findings


def render_human(findings: list[Finding]) -> str:
    lines = []
    for finding in findings:
        icon = "PASS" if finding.ok else ("FAIL" if finding.severity == "error" else "WARN")
        lines.append(f"[{icon}] {finding.name}: {finding.message}")
    failed = [f for f in findings if not f.ok]
    lines.append("")
    lines.append(f"{len(findings) - len(failed)}/{len(findings)} checks passed")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("docx", help="path to the .docx to check")
    parser.add_argument("--json", action="store_true", help="emit JSON")
    parser.add_argument("--only", default="", help="comma-separated rule names")
    parser.add_argument("--fix", action="store_true", help="accepted; no rule auto-fixes yet")
    args = parser.parse_args(argv)

    only = [n.strip() for n in args.only.split(",") if n.strip()] or list(DEFAULT_RULES)

    if not Path(args.docx).is_file():
        message = f"not a file: {args.docx}"
        if args.json:
            print(json.dumps({"error": message}, ensure_ascii=False))
        else:
            print(f"error: {message}", file=sys.stderr)
        return 2

    findings = run_checks(args.docx, only)
    if args.json:
        print(json.dumps([f.to_dict() for f in findings], ensure_ascii=False, indent=2))
    else:
        print(render_human(findings))
    return 0 if all(f.ok for f in findings) else 1


if __name__ == "__main__":
    raise SystemExit(main())
