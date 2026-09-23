# Environment setup

What the xlsx skill needs on a machine, what each piece is for, and how to get
it. `env_check.sh` detects; `setup_mac_linux.sh` installs the small pieces on
macOS and Linux; `setup_windows.ps1` does the same on Windows.

The dependency list is deliberately short — the whole skill runs on three
things:

| piece | why | how it arrives |
| --- | --- | --- |
| Python ≥ 3.10 | runs `scripts/recalc.py`, `xlsx.py`, `templates/` | package manager or python.org |
| openpyxl | every read/write path in `SKILL.md` and `xlsx.py` | `python3 -m pip install openpyxl` |
| LibreOffice (`soffice`) | recalculation — the only real formula engine | large (~400 MB); install on demand |

## Python

3.10 is the floor: the scripts parse and run on 3.10 and use no later syntax.
A virtual environment is recommended when several projects share the machine;
set `PYTHON` to the interpreter that should be used:

    PYTHON=.venv/bin/python bash env_setup/env_check.sh

## openpyxl

Required at import time by every path in this skill — without it, nothing
loads. Install with pip; PEP 668 (externally-managed environment) refusals are
handled with `--user`, a venv, or by pointing `PYTHON` at the venv interpreter.

    python3 -m pip install openpyxl

pandas is optional (`SKILL.md` §9): it is a convenience for bulk data work,
absent from some environments, and nothing in the core paths depends on it.

## LibreOffice — install on demand, never substituted

`scripts/recalc.py` drives LibreOffice headless to actually compute the
formulas. The library that wrote the file only stored them, so a workbook that
has not been recalculated by a real engine still carries stale cached values —
that is why recalculation is step 1 of `quality/pipeline.md`.

When `soffice` is absent, `recalc.py` reports
`{"error": ...}` rather than failing silently, and the workbook is unverified,
not passed. It is never substituted with another program and the recalc step
is never skipped because the download is large.

If it is already on disk but off `PATH`, register the binary instead of
reinstalling:

- macOS: `sudo ln -sf /Applications/LreOffice.app/Contents/MacOS/soffice /usr/local/bin/soffice`
- Linux: `sudo ln -sf /opt/libreoffice*/program/soffice /usr/local/bin/soffice`
- Windows: add `%PROGRAMFILES%\LibreOffice\program` to the user `PATH`, then
  re-verify `soffice --version`

## Fonts

`font_list.txt` lists the faces workbooks should name and the metric-compatible
fallbacks (Calibri → Carlito). A workbook opened where the named face is
missing substitutes, and the substituted metrics re-wrap every cell — the PDF
export in `scenes/convert.md` is how you see it.

## Verifying

```bash
bash env_setup/env_check.sh     # exit 0 = buildable
```

`[WARN]` is a conditional gap (soffice, when the task is read-only); `[FAIL]`
is a blocker. Re-run after installing anything.
