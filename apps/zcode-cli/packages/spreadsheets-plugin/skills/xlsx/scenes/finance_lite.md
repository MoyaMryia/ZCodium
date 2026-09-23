# Lightweight financial workbooks

The small-budget sibling of `finance.md`: a personal budget, a small project
tracker, a household sheet — workbooks where the full analyst apparatus
(colour-coded models, source-documented hardcodes, scenario blocks) is more
ceremony than the job needs. The conventions below are the subset that still
earns its keep at small scale.

## What carries over from `finance.md`

- **Formulas, not typed-in results.** A budget whose "total spent" was computed
  in someone's head and typed in is wrong the moment a row changes. This rule
  has no small-scale exception.
- **Units in headers**, and one number format per column.
- **Assumptions in their own cells** when there are assumptions — a budget with
  a savings rate has one; a flat expense log has none and should not grow a
  block for form's sake.

## What drops

- The full colour-coding table. Keep **one** distinction: inputs (what you
  typed) vs formulas (what the sheet computed) — blue vs black, or nothing at
  all if every number is an input.
- Source-documentation comments. A personal budget cites nothing. A workbook
  that leaves the household is no longer lite — apply `finance.md`.
- Scenario blocks and sensitivity tables. A lite workbook has one set of
  numbers and a note saying what changed if it is edited later.

## The structure that fits

Three sheets maximum:

1. **Inputs** — the numbers you type, one table, one header row. Categories in
   a column, amounts in another, dates in a third.
2. **Summary** — formulas over the inputs only: totals per category, per month,
   remaining budget. Never a typed number.
3. **Notes** — what the sheet is, what the categories mean, when it was last
   reconciled. Three lines; the sheet's future self is the reader.

## Monthly reconciliation

The one ritual that makes a budget workbook trustworthy:

1. Enter the period's actuals into Inputs.
2. Recalculate (`scripts/recalc.py`) and confirm zero formula errors.
3. Check the Summary's totals against the bank's own total — not against last
   month's copy of the sheet.
4. Write the reconciliation date and the checked total into Notes.

A budget that has never been reconciled against its source is a guess with
formatting.

## Anti-patterns

- A category added mid-period without a formula update, so the period total
  silently excludes it.
- A "miscellaneous" category larger than any real one — the taxonomy is wrong,
  not the data.
- The sheet growing a fourth tab. When a lite workbook needs a fourth tab, it
  is not lite anymore: rebuild it with `finance.md` conventions or split it.

## Formula patterns for the small workbook

The three formulas a lite workbook needs, and nothing more:

    period total      =SUMIFS(Amount, Month, $A2)
    category total    =SUMIFS(Amount, Category, $B2)
    remaining         =Budget - SUMIFS(Amount, Category, $B2)

- `SUMIFS` over a typed total: the workbook computes, and a new row is counted
  without editing a formula. This is the whole point.
- The criteria reference the label cell (`$A2`), never a typed string — the
  label is the contract between the row and the formula.
- A `remaining` that goes negative is information, not an error: format it with
  the negatives-in-parentheses rule and let it show.

## Conditional formatting (simple)

One rule, used for one purpose: a `remaining` below zero, or a category over
its budget, turns red.

```python
sheet.conditional_formatting.add("C2:C50",
    CellIsRule(operator="lessThan", formula=["0"],
               font=Font(color="FFCC0000")))
```

- One rule per workbook. A lite workbook with five conditional formats is not
  lite.
- The colour carries a meaning the label already states ("over budget") — it
  is a signal, not the only signal.
- Bound the range to the used rows; a whole-column rule is slower and the
  difference is visible even at this scale.

## Quick templates

Three sheets, and the file is done:

```
Inputs     one table: date, category, amount, note. One header row, frozen.
Summary    =SUMIFS over Inputs by category and by month; the budget column.
Notes      what the categories mean, when it was last reconciled, three lines.
```

When the workbook needs a fourth sheet, it is not lite anymore — rebuild it
with `finance.md` conventions or split it by purpose. That sentence is the
whole scope rule, and it is the reason the template has exactly three sheets.
