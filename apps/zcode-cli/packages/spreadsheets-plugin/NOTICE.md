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
