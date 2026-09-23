# Quality pipeline

What "done" means for a workbook, and the order the checks run in. The gate is
mechanical: a file that has not passed it is not delivered, whatever it looks
like on screen.

## 1. Recalculate with a real engine

The library that wrote the file did not compute the formulas — it stored them.
Every consumer sees cached values until something recalculates. Run
`scripts/recalc.py` (LibreOffice headless) before any other check, and read the
errors it reports rather than assuming the file is fine.

    python3 scripts/recalc.py model.xlsx

If LibreOffice is missing the script reports it instead of failing silently; a
recalc that could not run is an unverified file, not a passed one.

## 2. Zero formula errors

No `#REF!`, `#DIV/0!`, `#VALUE!`, `#N/A`, `#NAME?` in any delivered cell. This
is the first thing a reviewer checks and the last thing you want found for you.
Any error cell means the file is not delivered.

## 3. Structural checks

- No merged cells inside data regions.
- No formula with a hardcoded magic number where an assumption belongs.
- Consistent formulas across projection rows and columns.
- Ranges verified after writing (off-by-one shows up as a wrong total).
- Frozen headers and set column widths on long tables.

## 4. Convention checks

- Colour roles hold: blue only on inputs, black on formulas, green/red on links.
- Number formats hold: years as text, zeros as `-`, negatives in parentheses,
  units in headers.
- An existing template's conventions were matched, not overridden.

## 5. Spot-check the arithmetic

Pick three totals and recompute them independently — by hand, with a calculator,
or with a one-off script that does not reuse the workbook's own formulas. A
model that agrees with itself is not the same as a model that is right.

## 6. Preserve what was there

When updating an existing workbook: study its format, style and conventions
first and match them exactly. Never impose standardised formatting on a file
with established patterns — the file's own history is a requirement, not an
inconvenience.

---

*The zero-formula-error and template-preservation requirements in this file are
adapted from the `xlsx` skill of `appautomaton/document-SKILLs`
(https://github.com/appautomaton/document-SKILLs, MIT License, Copyright (c)
2026 appautomaton); see the plugin `NOTICE.md` for the derivation record.*
