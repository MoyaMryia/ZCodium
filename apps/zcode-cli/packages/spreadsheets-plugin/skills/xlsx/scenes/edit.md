# Edit an existing workbook

The most common spreadsheet task, and the one where the rules invert: the
workbook's own conventions outrank everything in this skill. Read before
writing; match what is there.

## Read first

1. **Inventory the sheets** — names, order, which are data, which are
   presentation, which are hidden. A hidden sheet is usually load-bearing.
2. **Record the conventions** — number formats, fonts, fills, column widths,
   freeze panes, print setup, header rows, named ranges, defined names. Write
   them down; they are the specification for the edit.
3. **Find the formulas** — which cells compute, which are inputs, which are
   links to other sheets or other files. The colour roles (`engines/design.md`
   §1) tell you at a glance; when the workbook does not use them, infer from
   the formulas.
4. **Check for merged cells, data validation, conditional formatting and
   protection** — all of them constrain where you can write.
5. **Look for the totals row** and how it is computed; new rows must extend the
   range, not sit outside it.

## openpyxl edit loop

    from openpyxl import load_workbook

    workbook = load_workbook("model.xlsx")          # formulas stay live
    sheet = workbook["Data"]

    # extend the data region
    first_empty = sheet.max_row + 1
    for offset, row in enumerate(new_rows):
        sheet.cell(row=first_empty + offset, column=1, value=row[0])

    # extend the total's range so the new rows are counted
    sheet["B100"] = "=SUM(B2:B99)"

    workbook.save("model.xlsx")

- `load_workbook(path)` keeps formulas as strings; `data_only=True` returns the
  last cached values instead (read-only use — saving from it destroys the
  formulas).
- Insert rows with `sheet.insert_rows(idx, amount)` and then **verify every
  formula that ranged over the moved region** — openpyxl does not rewrite
  references.
- `max_row` / `max_column` reflect the used range; a stray formatted cell
  inflates them. Check before trusting.
- Saving drops charts and images that openpyxl does not model. If the workbook
  has charts, prefer editing values only, or rebuild the chart after saving.

## Matching conventions

- New cells inherit the sheet's style only when written through the same path
  the existing data uses; otherwise copy the style object from a neighbouring
  cell.
- New columns go where the sheet's own layout puts them — appended at the
  region's edge, not inserted at a "logical" place that breaks the print area.
- A number written as text (or text written as a number) is invisible on
  screen and fatal to a SUM. Match the neighbouring cells' types exactly.

## When NOT to edit in place

- The edit restructures the workbook (sheet split, layout change): build the
  new workbook from `scenes/create.md` and migrate the data, keeping the
  conventions.
- The file is a generated report: regenerate from the source that produced it.
- The workbook is protected and the protection is meaningful: unlock what the
  edit needs, and re-lock afterwards.

## Verification

- Recalculate with `scripts/recalc.py` and confirm zero formula errors
  (`quality/pipeline.md`).
- Diff the totals against the pre-edit values: the ones that should not have
  moved did not.
- Open the saved file and check the sheets, the freeze panes and the print
  setup survived.

## Inspect before touching anything

The first minute of an edit is reading, and the reading is a checklist:

```python
workbook = load_workbook(path)
for sheet in workbook.worksheets:
    print(sheet.title, sheet.sheet_state, sheet.dimensions,
          "merged:", len(sheet.merged_cells.ranges),
          "freeze:", sheet.freeze_panes,
          "dv:", len(sheet.data_validations.dataValidation))
```

- **`sheet_state`**: a hidden sheet is usually load-bearing. Find out what
  reads it before changing or removing it.
- **`dimensions` vs reality**: a stray formatted cell inflates `max_row`.
  Scan up from `max_row` for the first non-empty row before trusting it.
- **`merged`**: every merge inside a data region is a constraint — no sorting,
  no filtering, no range formula over it.
- **`data_validations`**: validation restricts typing but not pasting; the
  audit in `quality/pipeline.md` is the real gate.
- **Defined names**: list them. A name pointing at a deleted range becomes
  `#REF!` in every formula that uses it.

## Common edit operations, and their traps

| operation | the trap |
| --- | --- |
| append rows | the totals row's range does not extend itself — rewrite it |
| insert a row | openpyxl moves cells but does **not** rewrite formulas; audit every range that spanned the point |
| add a computed column | writing the value instead of the formula (the #1 defect this skill exists to prevent) |
| replace values in place | the cached values are stale until a real engine recalculates — recalc, then read |
| rename a sheet | formulas referencing `'Old Name'!A1` break silently; rewrite them first |
| protect a sheet | unlock the input cells **before** protecting, or the sheet is unusable |

## Dangerous operations

- **Saving over the only copy.** Copy first; the exception path leaves a
  truncated file otherwise.
- **`load_workbook(data_only=True)` then saving.** It returns cached values and
  saving from it destroys the formulas — that mode is for reading, never for
  writing.
- **Deleting a sheet another formula references.** The formulas become `#REF!`
  at the next recalc, and the file looks fine until then.
- **Round-tripping charts.** openpyxl rebuilds what it models; charts authored
  elsewhere lose styling. Verify after saving.
- **"Beautifying" a template.** Re-applying a standard format to a file with
  established conventions destroys the thing the reader relies on
  (`quality/pipeline.md` §6).
