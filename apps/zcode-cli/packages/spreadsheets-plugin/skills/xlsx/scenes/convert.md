# Convert between formats

Moving tabular data in and out of `.xlsx`. The tool is LibreOffice headless —
the same engine `scripts/recalc.py` uses — and the rules are about what
conversion does and does not preserve.

## The command

    soffice --headless --convert-to <target> --outdir <dir> <file>

| from → to | command suffix | what survives |
| --- | --- | --- |
| xlsx → csv | `csv:"Text - txt - csv (StarCalc)":44,34,76,1,,0,false,true,true` | values only; the **first sheet only** |
| xlsx → pdf | `pdf` | the print ranges and page setup; charts as drawn |
| xlsx → ods | `ods` | formulas, formats, charts |
| csv → xlsx | `xlsx` | values; every column arrives as text unless parsed |
| xls → xlsx | `xlsx` | most content; VBA projects are the exception |

The CSV filter options after the format name matter: field separator (44),
text delimiter (34), charset (76 = UTF-8), first row as header (1). Without
them LibreOffice picks locale defaults and a comma-decimal locale silently
writes garbage.

## Rules

- **CSV is a value dump, not a workbook.** Formulas, formats, multiple sheets
  and charts are gone; only the active/first sheet is written. Convert to CSV
  for interchange, never as the working format.
- **Round-tripping loses things**: conditional formatting, data validation and
  charts survive xlsx→ods→xlsx imperfectly. Keep the xlsx as the source of
  truth.
- **Encoding**: write UTF-8 (charset 76) and state it; a Chinese workbook
  converted with the default charset produces mojibake that looks fine in the
  terminal.
- **Dates**: CSV has no date type. Dates arrive as formatted strings — parse
  them on the way in rather than letting Excel guess.
- **Numbers as text**: a csv→xlsx conversion leaves everything as text; SUM
  over the column returns 0. Re-type the columns after import.
- **Headless LibreOffice is not interactive**: no macros, no prompts. A
  conversion that would ask a question fails instead — the exit code and the
  log are the only diagnostics.

## Verifying a conversion

- Check the output exists and is non-empty (LibreOffice exits 0 on some
  failures).
- Open the target and check the row count and one known total against the
  source.
- For csv: check the encoding (`file -i`), the delimiter, and that quoted
  fields containing the delimiter survived.

## When not to convert

- The task is "recalculate and keep the formulas" — that is `recalc.py`, not a
  conversion.
- The target audience needs the formulas: convert to PDF for reading, keep the
  xlsx for editing, and ship both.

## The conversion matrix

| from → to | tool | what survives |
| --- | --- | --- |
| csv/tsv → xlsx | openpyxl write | values only; **every column arrives as text** |
| json → xlsx | openpyxl write | values and types; nested objects need flattening first |
| xlsx → csv | LibreOffice `--convert-to csv` | values, the **first sheet only**, one locale's dialect |
| xlsx → json | openpyxl read | values (cached); formulas are strings, not results |
| pdf table → xlsx | pdfplumber / manual | whatever the extraction got right — verify every cell |

The two rules underneath the matrix: **CSV is a value dump, not a workbook**
(formulas, formats, sheets and charts are gone), and **a conversion is not
verified until the output has been read**.

## CSV/TSV → XLSX, correctly

```python
import csv
from openpyxl import Workbook

with open("data.csv", newline="", encoding="utf-8-sig") as handle:
    rows = list(csv.reader(handle))

workbook = Workbook()
sheet = workbook.active
for row in rows:
    sheet.append(row)
```

- `utf-8-sig` strips the BOM Excel writes; plain `utf-8` leaves it glued to the
  first header cell.
- **Every value is text until re-typed.** A column of numbers written as text
  sums to 0. Re-type the numeric columns after the append, and check with
  `=SUM()` over one row before trusting the column.
- The delimiter is a fact of the file, not a guess: sniff it, or take it from
  the user. A comma-decimal locale writes `;`-separated files.

## JSON → XLSX

- Flatten nested objects before writing: a dict in a cell becomes a string,
  and a list in a cell becomes a string nobody can query.
- State the schema in the header row, and keep the types — a JSON number is a
  number, a JSON string is text, and writing both as text loses the
  distinction.

## XLSX → CSV/JSON

- LibreOffice's CSV filter options matter (field separator, text delimiter,
  charset, header row); without them it picks locale defaults and a
  comma-decimal locale silently writes garbage.
- Only the first sheet is written. If the workbook has several, convert each
  explicitly or export a purpose-built flat sheet.
- JSON export reads **cached** values — recalculate first or the formulas
  contribute `null`.

## Encoding gotchas

- UTF-8 everywhere, stated explicitly. A Chinese workbook converted with the
  default charset produces mojibake that looks fine in the terminal.
- `file -i output.csv` is the check; reading the file back and comparing one
  known value is the better one.

## Quality checks after conversion

1. The output exists and is non-empty (LibreOffice exits 0 on some failures).
2. Row count and one known total match the source.
3. The encoding is what was intended.
4. Numbers are numbers: `=SUM()` over one row of the converted file.
5. Dates are dates, not formatted strings.
