# Third-party notices

## skills/xlsx/scripts/recalc.py

This file derives from the `xlsx/recalc.py` of the reference implementation:

    appautomaton/document-SKILLs
    https://github.com/appautomaton/document-SKILLs
    Copyright (c) 2026 appautomaton
    MIT License

The upstream work is licensed under the MIT License, which permits use, copying,
modification, merging, publication and distribution on the condition that the
copyright notice and the permission notice are carried along. Both are
reproduced in full in the header comment of `skills/xlsx/scripts/recalc.py`, so
a copy of the script on its own still carries them; the derivation is recorded
here as well.

The deltas from the upstream file are enumerated in that header. Summarised
here: the PEP 723 header declares `requires-python = ">=3.10"`, the lowest
interpreter that actually parses and runs it (the upstream `>=3.12` is higher
than the 3.10 this repository targets, and the code uses no post-3.10 syntax),
and the usage text names this repository's `python3` invocation instead of
`uv run`. Formula recalculation, LibreOffice macro setup, error scanning and
the JSON result shape are unchanged, and the `openpyxl` dependency declaration
is retained as upstream had it.

`skills/xlsx/SKILL.md` is adapted from the same project's `xlsx/SKILL.md`,
also MIT-licensed under the notice above. It is a rewrite rather than a copy:
the structure, ordering, phrasing and every section heading differ, the
"when an agent needs to work with spreadsheets" framing is gone in favour of
this repository's skill voice, and sections have been rewritten to describe the
dependency reality of this environment — `openpyxl` is required by the script
at import time, `soffice` is required by the recalculation step and reports a
missing LibreOffice as `{"error": …}` rather than failing, and `pandas` is
usable only where it is actually installed. The upstream knowledge domains
(the zero-formula-error requirement, preserving an existing template's
conventions, formulas over hardcoded values, openpyxl read and write, the
verification checklist, reading the recalculation output, and the performance
notes) are the substance carried across.

## skills/xlsx/scenes/finance.md, skills/xlsx/engines/design.md, skills/xlsx/quality/pipeline.md

These three files derive from the same project's `xlsx/SKILL.md` (MIT, notice
above), extending the earlier `SKILL.md` adaptation:

- `scenes/finance.md` carries the financial-model layer — the colour-coding
  table, the number-format table, the assumption-cell rule, formula hygiene and
  the hardcode source-comment format — as the scene a reviewer will audit.
- `engines/design.md` carries the shared design surface (colour roles, number
  formats, sheet structure, table layout) that every scene sits on.
- `quality/pipeline.md` carries the delivery gate: recalculate with a real
  engine, zero formula errors, structural checks, convention checks, an
  independent spot-check, and template preservation.

The upstream work is licensed under the MIT License, which permits use, copying,
modification, merging, publication and distribution on the condition that the
copyright notice and the permission notice are carried along. The notice is
reproduced in the footer of each file and recorded here.

The deltas from the upstream file: the upstream `xlsx/SKILL.md` presents these
rules inline inside one document; here they are split by role (scene / engine /
gate) and rewritten in this repository's voice, with the openpyxl RGB colour
literals dropped in favour of plain RGB triples, and the openpyxl-specific
invocations left to `SKILL.md`. The conventions themselves — blue inputs, black
formulas, green cross-sheet links, red external links, yellow assumption fills,
years as text, zeros as `-`, negatives in parentheses, units in headers,
formulas over hardcodes, zero-error delivery, template preservation — are the
substance carried across.

## skills/xlsx/scenes/create.md, scenes/edit-patterns.md, scenes/analyze.md, scenes/analyze-recipes.md, engines/chart.md, engines/chart-templates.md — API-fact references

These files are original prose written against the public, documented APIs of
third-party libraries, used as factual sources (interface names, option
names, and documented behaviour — none of which is copyrightable expression):

| project | license | what was used |
| --- | --- | --- |
| `jmcnamara/XlsxWriter` (https://github.com/jmcnamara/XlsxWriter) | BSD-2-Clause | the documented `Workbook` / `add_format` / `write_formula` / `add_series` / `set_*` chart API in `scenes/create.md`, `engines/chart.md`, `engines/chart-templates.md` |
| `vega/vega-lite` (https://github.com/vega/vega-lite) | BSD-3-Clause | the documented mark / encoding-channel / data-type / aggregation grammar in `scenes/analyze.md`, `scenes/analyze-recipes.md`, `engines/chart.md` |
| `scanny/python-pptx` — not used by this plugin; recorded in the survey for the presentations plugin | MIT | — |

No upstream source code is vendored into these files, and no upstream file is
reproduced. The code samples are written for this repository against the
documented interfaces.

## skills/xlsx/templates/base.py, templates/palettes.py, xlsx.py — original code

Original work for this repository. They implement the conventions in
`engines/design.md` (colour roles, number formats, assumption blocks, the
quality gate) against the public APIs named above. They carry no third-party
source and are covered by the repository's root Apache-2.0 license.

## skills/xlsx/scenes/finance_lite.md, scenes/vba.md, scenes/advanced.md, scenes/edit.md, scenes/convert.md, engines/vba-templates.md — original work

Written from public knowledge (VBA's public grammar, the OOXML spreadsheet
format, the LibreOffice headless CLI) with no third-party base. Covered by the
repository's root Apache-2.0 license.

## Everything else in this plugin

`package.json`, `.zcodium-plugin/plugin.json`, this `NOTICE.md` and
`agents/visual-judge.md` are original work written for this repository. They
are covered by the repository's root Apache-2.0 license, which is why the
`license` field of both manifests reads `Apache-2.0`, with no
`SEE LICENSE IN` pointer.

No `LICENSE.txt` ships with this plugin. An earlier packaging of this family of
skills carried a proprietary non-commercial license text; the MIT material
described above is the only third-party licensed content present, and its
obligations are satisfied by the two notices reproduced inside
`skills/xlsx/scripts/recalc.py`.
