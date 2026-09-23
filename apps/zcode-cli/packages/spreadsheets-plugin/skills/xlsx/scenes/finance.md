# Financial and analyst-grade workbooks

A workbook that another person will open, check, or hand onward is a different
artifact from a scratch data file. The conventions below exist so a reviewer can
tell, at a glance and without opening a single formula, which cells are inputs,
which are calculations, and which came from somewhere else.

They apply **unless the user or an existing template says otherwise**. An
established template's conventions always override this file — matching the file
you were asked to edit is the first rule.

## 1. Colour coding

Text colour is metadata in analyst workbooks. The convention:

| colour            | meaning                                              |
| ----------------- | ---------------------------------------------------- |
| blue `RGB(0,0,255)`   | hardcoded input, or a number a user will change for scenarios |
| black `RGB(0,0,0)`    | every formula and calculation                        |
| green `RGB(0,128,0)`  | a link pulling from another sheet in the same workbook |
| red `RGB(255,0,0)`    | an external link to another file                     |
| yellow fill `RGB(255,255,0)` | a key assumption that needs attention, or a cell awaiting input |

Two rules that make the scheme work: **never colour a formula blue**, and **a
cell that is not a plain input is not blue**. The point is that a reviewer can
change every blue cell safely and break nothing.

## 2. Number formats

| value kind   | format                                             |
| ------------ | -------------------------------------------------- |
| years        | text, `2024` — never `2,024`                       |
| currency     | `$#,##0`, with the unit stated in the header ("Revenue ($mm)") |
| zeros        | display as `-`, e.g. `$#,##0;($#,##0);-`            |
| percentages  | `0.0%` — one decimal by default                    |
| multiples    | `0.0x` for EV/EBITDA, P/E and friends              |
| negatives    | parentheses, `(123)`, not `-123`                   |

Units in headers, not in cells. A column of bare numbers with the unit only in
the title is the most common cause of a factor-of-a-thousand review comment.

## 3. Assumptions live in their own cells

Every growth rate, margin, multiple and driver goes in a visible assumption
cell, and formulas reference it:

    wrong:  =B5*1.05
    right:  =B5*(1+$B$6)

A formula with a magic number inside it cannot be scenario-tested, cannot be
reviewed, and hides the assumption from the person who needs to argue with it.
Assumptions that share one sheet, one block, one label style.

## 4. Formula hygiene

- Verify every reference after writing — an off-by-one range is invisible until
  the total is wrong.
- One formula across a row: fill the same formula across all projection periods
  rather than editing the last column to be "special".
- Test the edges: zero values, negative values, an empty period.
- No circular references. If the model needs one, it needs an iteration setting
  the reviewer was told about, not a silent cycle.

## 5. Document every hardcode

A number that is not a formula and not an assumption is a fact from somewhere.
Say where — as a cell comment, or in a column beside the table when the sheet
ends at a boundary:

    Source: Company 10-K, FY2024, Page 45, Revenue Note, [SEC EDGAR URL]
    Source: Company 10-Q, Q2 2025, Exhibit 99.1, [SEC EDGAR URL]
    Source: Bloomberg Terminal, 8/15/2025, AAPL US Equity

"Source: management" is documentation too, and better than nothing. What is not
acceptable is an undocumented number in a delivered model.

## 6. Delivery gate

Before the file leaves:

1. Recalculate with a real engine (LibreOffice headless), not the writing
   library's cached values — see `scripts/recalc.py`.
2. Zero formula errors: no `#REF!`, `#DIV/0!`, `#VALUE!`, `#N/A`, `#NAME?`. Any
   error cell means the file is not delivered.
3. Spot-check three totals against an independent calculation.
4. Confirm the colour and format conventions above hold on the sheets a
   reviewer will actually open.

---

*The colour, number-format, assumption and hardcode-documentation conventions in
this file are adapted from the `xlsx` skill of `appautomaton/document-SKILLs`
(https://github.com/appautomaton/document-SKILLs, MIT License, Copyright (c)
2026 appautomaton); see the plugin `NOTICE.md` for the derivation record.*

## Model architecture

The sheet structure below is what a reviewer expects to find. Deviating needs a
reason the reviewer accepts.

### Standard sheet structure

```
Assumptions   every input, blue, labelled — nothing else on this sheet
Drivers       intermediate calculations referencing Assumptions only
Model         the computation; black formulas throughout
Outputs       the presentation layer: summaries, charts, the sheets a reader sees
Checks        reconciliation rows: does the model agree with its source
```

### Formula construction rules

- One direction of reference: Assumptions → Drivers → Model → Outputs. A
  formula in Assumptions that reads from Model is a circular dependency in
  waiting.
- Fill one formula across a whole row or column; a hand-edited exception column
  is a future bug with a comment apologising for it.
- Verify ranges after writing — off-by-one is invisible until the total is wrong.
- Test the edges: zero, negative, empty period.
- No undocumented hardcodes: a number that is neither a formula nor an
  assumption carries a source comment (§5 of this file).

### Assumptions sheet layout

- One block, one label style, one column of values, one column of units.
- Named ranges for the assumptions formulas reference by name — a named
  assumption survives row insertion; a coordinate reference does not.
- Scenario switches (base/upside/downside) as a single cell driving `CHOOSE` /
  `INDEX` over a scenario table, not as three parallel blocks that drift apart.

## Number formatting (the critical section)

Formats are read before numbers. The table in `engines/design.md` §2 is the
reference; what matters here is that **the format is part of the model, not
decoration**:

- Years as text (`2024`, never `2,024`) — a year formatted as a number with a
  thousands separator is the defect a reviewer catches in one second.
- Currency with the unit in the header, and the zero rendered as `-`:
  `$#,##0;($#,##0);-`.
- Percentages at one decimal; multiples as `0.0x`; negatives in parentheses.
- Dates as dates, with a format that survives a locale change
  (`yyyy-mm-dd` is the portable choice).
- A column whose format differs between rows is a defect: select the column
  and apply one format.

## Layout rules for a reviewable model

- **Section headers** are labelled rows with a panel fill, not merged cells —
  a merged header breaks sorting and every range formula over the column.
- **Line items down, periods across** — the orientation every financial reader
  expects. A period column exists even when empty; a gap breaks the SUM range
  and the chart's category axis.
- **Totals at the bottom or right of the region they total**, labelled, and
  computed by range formula rather than a sum of the visible rows.
- **The Checks sheet is not optional**: reconciliation rows comparing the
  model's totals against an independent calculation, with the tolerance stated.
  A model without one cannot be audited; with one, an error announces itself.
