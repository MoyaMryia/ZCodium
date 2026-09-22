---
name: xlsx
description: Use whenever a spreadsheet (.xlsx, .xlsm, .csv, .tsv) is the artifact being produced, edited, or reviewed — a financial model, budget, forecast, schedule, invoice, data table, reconciliation or dashboard sheet. Covers zero-error formula construction, reading and writing through openpyxl (formulas, fonts, fills, number formats, column widths), and formula recalculation plus error scanning with `skills/xlsx/scripts/recalc.py`, which drives LibreOffice headless. Use it when the user asks to build, fill, fix, merge or audit a workbook, or reports symptoms such as #REF!, #DIV/0!, #VALUE! or #NAME? errors, a total that stops updating when a row is inserted, formulas that show nothing until the file is opened in Excel, `####` in a column, a flattened template whose formatting conventions were overwritten, or a wide sheet that gets split across several printed pages. Does not cover .docx / .pptx / PDF authoring, GUI spreadsheet applications, or native Excel charts and VBA macros.
---

# XLSX Spreadsheet Production

Build, edit and verify `.xlsx` workbooks through `openpyxl`, and gate every result on a real recalculation rather than on the formula strings. The deliverable is a workbook that opens with values already in it and zero formula errors.

## 1. What this skill covers

- creating and editing workbooks — cells, formulas, fonts, fills, borders, number formats, column widths, merged cells, multiple sheets;
- reading existing workbooks without losing their formulas or formatting;
- recalculating formulas and scanning every cell for Excel error values, through one script: `skills/xlsx/scripts/recalc.py`;
- the verification checklist that has to pass before a workbook with formulas is handed over.

It does **not**:

- produce native Excel chart objects, conditional-formatting rules, data validation, pivot tables or VBA macros — none of that is written by this skill, and openpyxl's support for it ranges from absent to partial;
- author `.docx`, `.pptx` or PDF files — those are the `docx`, `pptx` and `pdf` skills;
- drive a spreadsheet GUI. Everything here is a file-level operation.

## 2. Environment prerequisites

Two external dependencies, neither optional for their own step. Check before promising a recalculated file.

| Need                                          | What satisfies it                                                 | Missing behaviour                                                                                                           |
| --------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `openpyxl` in the Python that runs the script | `pip install openpyxl`, or `apt-get install python3-openpyxl`     | the script dies at import: `ModuleNotFoundError: No module named 'openpyxl'`. Nothing else in this skill works              |
| LibreOffice `soffice` on `PATH`               | `apt-get install libreoffice` / `brew install --cask libreoffice` | `recalc()` returns `{"error": "LibreOffice ('soffice') not found on PATH…"}`, and the script prints that JSON and exits `0` |
| `pandas`                                      | `pip install pandas`                                              | only §9 is unavailable; the openpyxl paths are unaffected                                                                   |
| `gtimeout` (coreutils), macOS only | not needed | no longer used — the timeout is enforced in-process |

The timeout argument is enforced in-process. `soffice` is started in its own process group and, on expiry, the whole group is killed — the `soffice` launcher spawns `soffice.bin` to do the work, and killing only the launcher used to leave `soffice.bin` orphaned while it kept the pipes open, which hung the script forever.

The script declares `requires-python = ">=3.10"` and `dependencies = ["openpyxl"]` in its PEP 723 header; it runs on the 3.10 the CLI already assumes.

Confirm rather than assume:

```bash
python3 -c "import openpyxl; print('openpyxl', openpyxl.__version__)"
command -v soffice || echo "soffice missing — recalculation unavailable"
python3 -c "import pandas" 2>/dev/null && echo "pandas present" || echo "pandas missing (optional)"
```

## 3. Rules every workbook must satisfy

### Zero formula errors

Every workbook leaves your hands with zero formula errors — `#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?`, `#NULL!`, `#NUM!`, `#N/A`. An error that survives into the delivered file is a broken deliverable, not a cosmetic problem, and a printout of one reads as a defect.

### Respect the existing template

When modifying a workbook that already has conventions, study them and match them exactly:

- keep the existing number formats, fonts, fills, column widths, freeze panes, sheet names, print setup and header rows;
- never impose a standardised layout on a file with an established pattern — a "cleaner" rewrite that drops the template's conventions destroys the thing the reader relies on;
- if the template already puts assumptions in a dedicated block, keep putting them there. Existing conventions always outrank anything in this document.

### Financial-model conventions

Unless the workbook's own conventions or the user say otherwise:

- **Blue** text (RGB `0,0,255`, openpyxl `FF0000FF`) — hardcoded inputs and scenario drivers;
- **Black** text (RGB `0,0,0`, openpyxl `FF000000`) — every formula and calculation;
- **Green** text (RGB `0,128,0`, openpyxl `FF008000`) — references into other sheets of the same workbook;
- **Red** text (RGB `255,0,0`, openpyxl `FFFF0000`) — links to other files;
- **Yellow** fill (RGB `255,255,0`, openpyxl `FFFFFF00`) — key assumptions that need attention.

Number formats:

- years as text (`"2024"`, not `2,024`);
- currency `$#,##0`, with the unit stated in the header (`Revenue ($mm)`);
- zeros rendered as `-`: `$#,##0;($#,##0);-`;
- percentages at one decimal (`0.0%`);
- multiples as `0.0x`;
- negatives in parentheses, `(123)` rather than `-123`.

## 4. Use formulas, not hardcoded values

A computation that Excel could perform belongs in a cell as a formula, never as a value computed in Python. Hardcoding freezes the workbook: the moment a source row changes, every downstream number silently goes stale, and no reader can tell which cells were meant to move.

```python
sheet['B10'] = '=SUM(B2:B9)'        # not: sheet['B10'] = 5000
sheet['C5'] = '=(C4-C2)/C2'         # not: sheet['C5'] = 0.15
sheet['D20'] = '=AVERAGE(D2:D19)'   # not: sheet['D20'] = 42.5
```

This covers totals, subtotals, growth rates, margins, ratios, variances, differences — every numeric relationship in the workbook. Assumptions go into their own cells and get referenced:

```python
# growth rate lives in B6 as an input; every period references it
sheet['C7'] = '=B5*(1+$B$6)'
```

A hardcoded value that cannot come from a formula (a figure transcribed from a filing) is an input, and it needs a source note in an adjacent cell or a cell comment: `Source: <system or document>, <date>, <specific reference>, <URL if applicable>`.

## 5. openpyxl workflow

### 5.1 Creating a workbook

```python
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment

wb = Workbook()
sheet = wb.active
sheet['A1'] = 'Quarter'
sheet['B1'] = 'Revenue'
sheet['A2'] = 'Q1'
sheet['B2'] = 1200

# Assumption cells first, formulas reference them
sheet['D1'] = 'Growth'
sheet['D2'] = 0.08
sheet['B3'] = '=B2*(1+$D$2)'

sheet['B2'].font = Font(color='FF0000FF')                 # blue input
sheet['B3'].font = Font(color='FF000000')                 # black formula
sheet['B2'].number_format = '$#,##0;($#,##0);-'
sheet['D2'].fill = PatternFill('solid', start_color='FFFFFF00')
for cell in sheet[1]:
    cell.font = Font(bold=True)
sheet.column_dimensions['A'].width = 20
sheet.freeze_panes = 'A2'

wb.save('model.xlsx')
```

Two openpyxl colour rules that bite: colour strings are `AARRGGBB` eight-digit hex, not the web `#RRGGBB` — `Font(color='0000FF')` is a _transparent_ blue; and `fill_type='solid'` is required for a fill to render at all. Where the file is created rather than edited, set every property you care about on the cell: openpyxl writes only what you set.

### 5.2 Editing an existing workbook

```python
from openpyxl import load_workbook

wb = load_workbook('report.xlsx')        # default: formulas preserved
wb.active                               # first sheet
wb['Summary']                           # by name
for name in wb.sheetnames:
    print(name, wb[name].max_row, wb[name].max_column)

ws = wb['Summary']
ws['A1'] = 'Total'
ws['B1'] = '=SUM(B2:B9)'

new = wb.create_sheet('Assumptions')
new['A1'] = 'Growth'
new['B1'] = 0.08

wb.save('report.xlsx')
```

**Loading with `data_only=True` reads cached values and destroys formulas on save.** If the file was last written by openpyxl, the cache is empty and every formula cell reads back `None` — which is exactly the gap §6 closes. Pass `data_only=True` only to read results, and never save from such a handle.

## 6. Recalculating formulas

`openpyxl` stores a formula as a string and never evaluates it. A workbook written by openpyxl therefore has no cached values: Excel, WPS and LibreOffice compute them on open, but any downstream reader — a script, a CSV export, a preview renderer — sees blanks. The recalculation script is what makes the file self-describing.

```bash
python3 <plugin>/skills/xlsx/scripts/recalc.py <excel_file> [timeout_seconds]
```

`<plugin>` is the plugin root that carries this skill, so the real path is
`skills/xlsx/scripts/recalc.py` inside this plugin. The timeout defaults to 30
seconds and is enforced in-process, so it needs no external `timeout` or
`gtimeout` binary on any platform.

What the script does, in order:

1. refuses a path that does not exist, returning `{"error": "File … does not exist"}`;
2. refuses to continue when `soffice` is not on `PATH`, returning the install hint above — a missing LibreOffice is reported, not crashed on;
3. writes a `RecalculateAndSave` Basic macro into the LibreOffice user profile on first run (idempotent — a profile that already has it is left alone), so no manual macro setup is needed;
4. runs `soffice --headless --norestore` over the file, under a timeout wrapper where one exists;
5. reopens the file with `data_only=True` and scans **every cell of every sheet** for the seven error values — no row or column limit;
6. reopens it with `data_only=False` and counts cells whose value starts with `=`, for the `total_formulas` figure.

The file is modified in place: LibreOffice's `store()` writes the recalculated values back through the same path. Point it at a copy when the original has to survive.

### Reading the result

```json
{
  "status": "success",
  "total_errors": 0,
  "error_summary": {},
  "total_formulas": 2
}
```

```json
{
  "status": "errors_found",
  "total_errors": 2,
  "error_summary": {
    "#DIV/0!": { "count": 1, "locations": ["Sheet!A3"] },
    "#REF!": { "count": 1, "locations": ["Sheet!A2"] }
  },
  "total_formulas": 2
}
```

- `status` — `success` or `errors_found`;
- `total_errors` — error cells found across all sheets;
- `total_formulas` — cells whose content starts with `=` (a context figure, not a check);
- `error_summary` — present only when `total_errors > 0`; each key lists at most the first 20 locations;
- a single `error` key instead means the run never got to the scan, and its text is the reason.

`errors_found` is not a tail: fix, re-run, repeat until `status` is `success`.

Re-run it after **every** change that touches a formula — including a fix — because a repair routinely moves a reference and creates a fresh `#REF!`. Run it again after adding rows or deleting columns, and run it once on the final file as the last action before delivery.

## 7. Formula verification checklist

Essential checks:

- test two or three references before building the full model — verify what they pull;
- column letters map as expected (column 64 is `BL`, not `BK`);
- rows are 1-indexed: DataFrame row 5 is Excel row 6;
- every formula is consistent across all projection periods — one divergent cell in a row of 120 is invisible to the eye and wrong in the total.

Pitfalls that produce errors:

- `#DIV/0!` — check the denominator, and prefer `IFERROR(x/y,"")` where an empty period is legitimate;
- `#REF!` — the reference points at a deleted cell, row or column;
- `#VALUE!` — the operand type is wrong (text where a number belongs);
- `#NAME?` — the function name is misspelled, or missing quotes around a literal;
- cross-sheet references use `Sheet1!A1`, and a sheet name with a space needs `'My Sheet'!A1`;
- no unintended circular reference;
- edge cases: zero, negative, and very large values.

Two properties of the scanner itself, so its output is read correctly:

- it matches by substring, so a **text** cell that contains the literal characters `#N/A` is counted as an error. Confirm whether a hit is a label before treating it as a broken formula;
- `locations` is capped at 20 entries per error type, while `count` is the real total. When `count` exceeds the list, the list is the first 20 only.

## 8. Workflow

1. Check the environment (§2) — `openpyxl` for every path, `soffice` for the recalculation step.
2. Load the workbook if it exists (§3) and record its conventions before touching anything.
3. Choose the library: `openpyxl` for formulas and formatting, `pandas` for bulk data (optional, §9).
4. Put assumptions in their own cells, blue and labelled, then write formulas against them (§4).
5. Format: number formats, column widths, freeze panes (§5.1).
6. `wb.save(...)`, then `python3 …/skills/xlsx/scripts/recalc.py <file>` (§6).
7. Read `status`; act on `error_summary` until `status` is `success`; run the §7 checks against anything still doubtful.
8. Re-run the script once more on the final file, then hand it over.

## 9. Optional: data analysis with pandas

`pandas` is a convenience for bulk data work, not a dependency of this skill — it is absent from this environment, and the openpyxl paths above are unaffected when it is missing. Install it when the task is genuinely tabular: multi-sheet reads, pivots, joins, cleaning.

```python
import pandas as pd

df = pd.read_excel('file.xlsx')                          # first sheet
all_sheets = pd.read_excel('file.xlsx', sheet_name=None)  # dict of frames
df.head(); df.info(); df.describe()

# Pivot, aggregate, merge
pd.pivot_table(df, values='sales', index='region', columns='product', aggfunc='sum', fill_value=0)
df.groupby('region')['sales'].sum()
df1.merge(df2, on='customer_id', how='left')
```

Performance and correctness notes:

- specify dtypes (`pd.read_excel('f.xlsx', dtype={'id': str})`) instead of letting inference decide;
- read only the columns needed (`usecols=['A', 'C']`) and chunk very large files (`chunksize=10000`);
- cast dates yourself (`parse_dates=['d']`) — Excel serial dates otherwise arrive as floats;
- a frame written with `to_excel` is plain data. Any formula still has to be added through openpyxl, and the file still needs recalculation (§6) exactly as an openpyxl-written file does.

## 10. Best practices and performance

- keep generated code minimal: no comments that restate the line, no redundant temporaries, no prints left in a script that writes a workbook;
- annotate the workbook itself — cell comments on complex formulas, a source note beside every hardcode, section labels on long sheets;
- for large files use `load_workbook(path, read_only=True)` when reading and `Workbook(write_only=True)` when writing; both stream and neither keeps the whole tree in memory;
- set `column_dimensions` explicitly. Width matters more than font size for legibility: a column too narrow for its content prints `####`, and no number format rescues that;
- freeze panes below the header row on any sheet whose header scrolls away;
- set print setup on a wide sheet before delivery — `ws.page_setup.orientation`, `ws.sheet_properties.pageSetUpPr.fitToPage`, `ws.print_title_rows` — otherwise a 40-column model arrives as eight portrait pages of orphan columns;
- prefer `iter_rows()` over random `ws.cell()` access when scanning, and avoid re-opening the workbook inside a loop.

## 11. Pitfalls

- **Saving from openpyxl discards cached values.** Every formula in the saved file has no result until something recalculates it — run §6.
- **`recalc.py` modifies its input in place.** LibreOffice stores back through the same path; work on a copy when the original is read-only or shared.
- **`soffice` missing is a reported error, not a crash** — `{"error": …}` and exit `0`. Check for that key before reading `status`.
- **The script does not own the file.** It only runs LibreOffice over a path it is given; it never reads a directory, never writes a second file, and never touches anything else in the tree.
- **`total_formulas` is not a validation.** It counts text starting with `=`, including cells that are not meant to be formulas — a leading `=` in a note is counted.
- **openpyxl is not Excel.** It does not evaluate, so a formula that is syntactically valid can still be semantically wrong; the scan finds error _values_, not intent. A wrong `SUM` range that picks up an empty row returns `0`, not an error.
- **A stale document lock can wedge LibreOffice, but the timeout now breaks it.** LibreOffice signals an open workbook with a `.~lock.<file>#` file beside it, and headless LibreOffice sometimes blocks outright on such a lock. When it does, the script kills the whole process group after the timeout and returns `{"error": "LibreOffice did not finish within <N>s. A stale document lock (.~lock.<name>#) beside the file leaves soffice.bin blocked; remove it and retry."}` instead of hanging. The condition is intermittent — a lock that wedges one run may not wedge the next — so the reliable move is still to close the workbook in Excel, WPS or LibreOffice before running.
- **`Font(color=...)` takes `AARRGGBB`**, and `PatternFill` needs `fill_type='solid'` to render.
- **Merged cells hide the data under them.** Write to the top-left anchor only; the rest read back `None`.

## 12. Environment

Python 3.10 or later with `openpyxl` installed (the only hard third-party dependency; `pandas` is optional), plus LibreOffice `soffice` on `PATH` for recalculation. No external `timeout` or `gtimeout` binary is needed — the timeout is enforced in-process.
