# Advanced workbook features

The features that separate a data dump from a tool: data validation,
conditional formatting, named ranges, protection, print setup and the
performance habits that keep a large workbook usable. Everything here is
openpyxl/XlsxWriter public API.

## Data validation

    from openpyxl.worksheet.datavalidation import DataValidation

    dv = DataValidation(type="list", formula1='"Draft,Sent,Paid"', allow_blank=True)
    dv.error = "Pick a value from the list."
    dv.errorTitle = "Invalid status"
    sheet.add_data_validation(dv)
    dv.add("D2:D500")

- `type="list"` with an inline list has a 255-character ceiling; longer lists
  point at a range (`formula1="=Lists!$A$2:$A$50"`).
- `type="whole"` / `"decimal"` / `"date"` / `"textLength"` with `operator`
  (`between`, `greaterThan`, …) for numeric constraints.
- `showInputMessage` with a prompt turns the validation into documentation —
  the cheapest input-help a workbook can carry.
- Validation restricts typing, not pasting. A paste over a validated cell
  bypasses it; the audit in `quality/pipeline.md` is the real gate.

## Conditional formatting

    from openpyxl.formatting.rule import CellIsRule, ColorScaleRule

    sheet.conditional_formatting.add("B2:B500",
        CellIsRule(operator="lessThan", formula=["0"],
                   font=Font(color="FFCC0000")))

- Rules are evaluated by the consumer, in order; the first matching rule wins
  unless `stopIfTrue` is set.
- `ColorScaleRule` for heatmaps, `FormulaRule` for anything stateful (a rule
  that depends on another column).
- Keep the palette from `engines/design.md` — conditional colour that invents
  new hues breaks the workbook's colour language.
- Performance: a conditional format over a whole column (`B:B`) is slower than
  over the used range; bound the range.

## Named ranges and defined names

    workbook.defined_names.add(DefinedName("TaxRate", attr_text="Assumptions!$B$7"))

- A named range makes formulas readable (`=Revenue*TaxRate`) and survives row
  insertion — the reason to use them for assumptions.
- Names are workbook-scoped by default; sheet-scoped names shadow them and
  confuse. Prefer one scope per name.
- A name pointing at a deleted range becomes `#REF!` in every formula that
  uses it — audit names after structural edits (`scenes/edit-patterns.md`).

## Tables (ListObjects)

- `openpyxl.worksheet.table.Table` with a style gives banded rows, filter
  buttons and structured references (`Table1[Revenue]`).
- One table per sheet region; tables cannot overlap, and a table's header row
  must be unique and non-empty.
- Structured references are Excel/Calc syntax; a formula using them breaks in
  older consumers. Prefer plain ranges for anything that leaves the machine.

## Protection

- Cell-level: unlock the input cells, then `sheet.protection.sheet = True`.
- Workbook-level: `workbook.security` locks the structure (no adding,
  deleting, hiding or renaming sheets).
- State the protection in the delivery note (`scenes/edit-patterns.md`).

## Print setup

- `sheet.print_area`, `sheet.print_title_rows = "1:1"` (repeat the header on
  every page), `sheet.page_setup.orientation`, `fitToWidth`.
- A workbook that prints as fourteen unlabelled pages is a defect; the print
  setup is part of the deliverable, not an afterthought.
- Verify by exporting to PDF (`scenes/convert.md`) and counting pages.

## Performance

- Write with `write_only=True` (openpyxl) or in batches (XlsxWriter) for large
  outputs — a cell-at-a-time loop over 100k rows is minutes, not seconds.
- Avoid whole-column conditional formats and whole-column formulas; bound them
  to the used range.
- Recalculation is the expensive step; run `scripts/recalc.py` once on the
  final file, not after every save.
- Styles: reuse format objects. Thousands of near-identical formats inflate
  the file and slow every consumer.

## Large file handling (>100K rows)

A workbook that loads eagerly will exhaust memory; the modes below are the
difference between seconds and a timeout.

### Read-only mode

    workbook = load_workbook(path, read_only=True, data_only=True)
    for row in workbook["Data"].iter_rows(values_only=True):
        ...

- `read_only=True` streams the sheet instead of building the whole cell model.
- `data_only=True` returns the **cached** values — a workbook nobody
  recalculated returns `None` for every formula cell. Recalculate first
  (`scripts/recalc.py`) or read the inputs and recompute yourself.
- `max_row`/`max_column` are unreliable in read-only mode; count while
  streaming.

### Write-only mode

    workbook = Workbook(write_only=True)
    sheet = workbook.create_sheet()
    sheet.append(row)          # append, never index
    workbook.save(path)

- No random access, no styles after the fact: set the column formats up front
  and append. The mode exists for generated artifacts, not for workbooks a
  human will edit.

### Chunked processing with pandas

    for chunk in pd.read_excel(path, sheet_name="Data", chunksize=50_000):
        process(chunk)

- `chunksize` bounds memory regardless of file size. pandas is optional
  (`SKILL.md` §9); nothing here depends on it.

## Batch processing multiple files

- One function per file, a loop over the directory, and a **result log** — a
  batch that fails on file 7 of 40 must say which 39 succeeded.
- Never write the output next to the input in the same directory with a
  similar name; the "overwrote my input" failure is always a naming failure.
- Recalculate each output before the batch moves on, so a recalc failure names
  the file that caused it.
- The batch is idempotent: running it twice produces the same outputs, not
  doubled rows.

## Conditional formatting at scale

- Bound the rule range to the used range. A conditional format over a whole
  column (`B:B`) is slower than over `B2:B5000` and the difference is visible
  at 100k rows.
- Rules are evaluated in order; the first matching rule wins unless
  `stopIfTrue` is set.
- `FormulaRule` for anything stateful (a rule that depends on another column);
  `CellIsRule` for the simple comparisons; `ColorScaleRule` for heatmaps.
- Keep the palette from `engines/design.md` — conditional colour that invents
  new hues breaks the workbook's colour language.
