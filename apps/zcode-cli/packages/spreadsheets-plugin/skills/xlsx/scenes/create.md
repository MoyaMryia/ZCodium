# Create a workbook

Building a new workbook from nothing. The library choice was made in
`SKILL.md` §5: `openpyxl` when the workbook will be edited again or must carry
formulas that stay live; `XlsxWriter` when the file is a generated artifact —
a report, an export, a filled template. This file covers both paths and the
decisions they share.

API sources: XlsxWriter documentation (BSD-2-Clause,
https://github.com/jmcnamara/XlsxWriter) and openpyxl's public API; see the
plugin `NOTICE.md`.

## Before writing a cell

1. **Assumptions first, in their own block** — blue, labelled, one row per
   driver (`engines/design.md` §3). Formulas reference them absolutely.
2. **Units in headers**, one header row, no merged cells in the data region.
3. **Formulas, not computed values** — the workbook computes, Python decides
   structure. `=B5*(1+$B$6)`, never the product baked in.
4. **Sheet split decided up front**: inputs / calculations / output / notes.

## XlsxWriter path

    import xlsxwriter

    workbook = xlsxwriter.Workbook("model.xlsx")
    worksheet = workbook.add_worksheet("Assumptions")

    money = workbook.add_format({"num_format": "$#,##0;($#,##0);-"})
    blue = workbook.add_format({"font_color": "#0000FF"})      # input
    black = workbook.add_format({"font_color": "#000000"})     # formula

    worksheet.write("B5", 1000, blue)                # an input, in blue
    worksheet.write_formula("B6", "=B5*(1+$B$7)", black)  # a formula, in black
    worksheet.set_column("B:B", 14, money)

    workbook.close()   # the file does not exist until close()

- **Formats are objects, reused.** One `add_format` per role; a format literal
  inline at each call is how a workbook ends up with forty near-identical
  formats.
- `write_formula(row, col, formula, cell_format, value)` — the optional
  `value` is the cached result; supply it when the consumer does not
  recalculate (some viewers show the cache).
- `merge_range()` for title bands; never merge inside a data region.
- `set_column(first, last, width, cell_format)` sets the column default; a
  width left unset shows `####` for long numbers.
- `freeze_panes(1, 0)` on every table with a header row.
- `workbook.close()` flushes; forgetting it is the classic "empty file" bug.
- Charts via `workbook.add_chart({"type": "column"})` and
  `worksheet.insert_chart()`; the data ranges are the sheet's own cells, so the
  chart follows the formulas (`engines/chart.md`).

## openpyxl path

    from openpyxl import Workbook

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Assumptions"

    sheet["B5"] = 1000
    sheet["B5"].font = Font(color="FF0000FF")     # blue input
    sheet["B6"] = "=B5*(1+$B$7)"                  # formula, kept live
    sheet["B6"].number_format = "$#,##0;($#,##0);-"
    sheet.column_dimensions["B"].width = 14
    sheet.freeze_panes = "A2"

    workbook.save("model.xlsx")

- Styles are per-cell objects; define them once as variables and assign —
  openpyxl has no format table.
- Formulas are strings and stay live; nothing is computed until a real engine
  recalculates (`quality/pipeline.md` §1).
- `column_dimensions[...].width`, `row_dimensions[...].height`, `freeze_panes`
  for the table basics.
- Loading and re-saving preserves formulas but drops some features (charts
  written by other tools survive poorly) — check the output after a round-trip.

## Shared rules

- Number formats from `engines/design.md` §2 — years as text, zeros as `-`,
  negatives in parentheses, units in headers.
- Colour roles from `engines/design.md` §1 — blue inputs, black formulas.
- Long tables: set the print area and `repeat_rows` so a printout keeps its
  header.
- Delivery: recalculate, then run the gate in `quality/pipeline.md`.

## Pitfalls

- Writing a computed number where a formula belongs (the #1 defect this skill
  exists to prevent).
- A format created inside a loop — thousands of duplicate formats, and a file
  Excel warns about.
- `merge_range` over a data region — sorting, filtering and every range
  formula over it break.
- Saving over the input file with openpyxl and losing the original on the
  first exception.
