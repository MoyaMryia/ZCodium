# Design standards for workbooks

The conventions a reviewer expects before they look at a single number: colour
roles, number formats, sheet structure, and the layout rules that keep a wide
table readable. Scene-specific guidance lives in `scenes/`; this file is the
shared surface all of them sit on.

An existing template's conventions always override this file. The job when
editing someone's workbook is to match it, not to normalise it.

## 1. Colour roles

| colour                     | meaning                                                |
| -------------------------- | ------------------------------------------------------ |
| blue `RGB(0,0,255)`        | hardcoded input, or a number a user will change        |
| black `RGB(0,0,0)`         | every formula and calculation                          |
| green `RGB(0,128,0)`       | link to another sheet in the same workbook             |
| red `RGB(255,0,0)`         | external link to another file                          |
| yellow fill `RGB(255,255,0)` | key assumption needing attention                      |

The scheme earns its keep because it is checkable: a reviewer can change every
blue cell and know they broke nothing. Colour that carries no meaning —
decorative fills, rainbow headers — spends that trust.

## 2. Number formats

| value kind | format                                              |
| ---------- | --------------------------------------------------- |
| years      | text, `2024` — never `2,024`                        |
| currency   | `$#,##0`, unit in the header ("Revenue ($mm)")       |
| zeros      | `-`, e.g. `$#,##0;($#,##0);-`                       |
| percentages| `0.0%` — one decimal                                |
| multiples  | `0.0x` for EV/EBITDA, P/E                           |
| negatives  | parentheses `(123)`, not `-123`                     |

## 3. Sheet structure

- **One sheet, one job.** Inputs, calculations, outputs and documentation are
  separate sheets in a model; a single sheet that mixes all four cannot be
  reviewed.
- **Assumptions in one labelled block**, referenced absolutely
  (`=B5*(1+$B$6)`), never inlined (`=B5*1.05`).
- **Labels above or left of data**, never below or right — a column whose
  meaning is stated underneath it breaks on the first sort.
- **Units in headers.** A column of bare numbers is a factor-of-a-thousand
  waiting to happen.
- **Frozen header row** on any table longer than a screen.

## 4. Table layout

- One header row, one data region, no merged cells inside the data region —
  merged cells break sorting, filtering and every formula that ranges over them.
- Left-align text, right-align numbers, and let the format carry the unit.
- Column widths set for the longest expected value; a `####` column is a defect.
- Totals at the bottom or the right of the region they total, labelled, and
  computed with a range formula rather than a sum of the visible rows.

## 5. Formula hygiene

- Fill one formula across a whole row or column; a hand-edited exception is a
  future bug with a comment apologising for it.
- Verify ranges after writing — off-by-one is invisible until the total is wrong.
- Test the edges: zero, negative, empty period.
- No undocumented hardcodes: a number that is neither a formula nor an
  assumption carries a source comment (`scenes/finance.md` §5).

---

*The colour, number-format and formula conventions in this file are adapted from
the `xlsx` skill of `appautomaton/document-SKILLs`
(https://github.com/appautomaton/document-SKILLs, MIT License, Copyright (c)
2026 appautomaton); see the plugin `NOTICE.md` for the derivation record.*

## 6. Financial-model anatomy

The conventions above are the surface; a model also has a shape. The standard
layout, which every reviewer expects:

```
Assumptions   all inputs, blue, labelled, one block — nothing else lives here
Drivers       intermediate calculations that reference Assumptions only
Model         the computation, black formulas, references Drivers and Assumptions
Outputs       the presentation layer: summaries, charts, the sheets a reader sees
Checks        reconciliation rows: does the model agree with the source
```

Rules that follow from the shape:

- **One direction of reference**: Assumptions → Drivers → Model → Outputs. A
  formula in Assumptions that reads from Model is a circular dependency in
  waiting, and the reviewer's first question.
- **The Checks sheet is not optional.** A model without a reconciliation row
  cannot be audited; with one, an error announces itself.
- **Years as columns, line items as rows** — the orientation every financial
  reader expects. Deviating needs a reason a reviewer accepts.
- **Units in the row label or the column header**, never only in the sheet
  name: `Revenue ($mm)` in the header, `2024` as text in the column.
- **A period column exists even when empty** — a gap in the columns breaks the
  SUM range and the chart's category axis.

## 7. Colour and format worked example

One row of a model, done to convention:

| cell | content | font | format |
| --- | --- | --- | --- |
| B6 | `0.05` (growth input) | blue | `0.0%` |
| C6 | `=B6*(1+$B$7)` (growth applied) | black | `0.0%` |
| D6 | `=SUM(C6:C6)` (first period total) | black | `$#,##0;($#,##0);-` |
| E6 | `='Assumptions'!B12` (cross-sheet link) | green | `$#,##0` |
| F6 | `=[Book1.xlsx]Sheet1!A1` (external link) | red | as the source |
| G6 | comment: `Source: 10-K FY2024 p.45` | — | — |

What the example demonstrates: every cell's colour states its role; the number
format states the unit's presentation; the assumption is absolute-referenced;
the external link is visibly external; the hardcode carries its source.

## 8. Model review checklist

What a reviewer (or you, a day later) checks, in order:

1. Every input is blue and lives in Assumptions — no stray blue cell in the
   Model sheet.
2. No formula contains a magic number where an assumption belongs.
3. Formulas fill whole rows consistently; no hand-edited exception column.
4. Cross-sheet links are green; external links are red and named in the notes.
5. Number formats hold: years as text, zeros as `-`, negatives in parentheses,
   units in headers.
6. The Checks sheet reconciles: totals agree with an independent calculation.
7. `scripts/recalc.py` reports zero formula errors.
8. Opening the file and changing one assumption moves the outputs — the test
   that separates a model from a table of typed numbers.
