# Edit patterns

The recurring transformations on an existing workbook, each with the trap that
makes the naive version wrong. `scenes/edit.md` carries the method; this file
is the lookup.

## Append rows to a table

    first_empty = sheet.max_row + 1

Trap: `max_row` counts formatted-but-empty cells. Verify the real last data row
by scanning up from `max_row` for the first non-empty one.

Trap: the totals row's range does not extend itself. Rewrite the total's
formula (`=SUM(B2:B99)` → `=SUM(B2:B199)`) or the new rows are invisible to it.

## Insert a row in the middle

Trap: openpyxl's `insert_rows` moves cells but **does not rewrite formulas**.
Every range that spanned the insertion point is now off by one. After
inserting, audit the totals and any SUM/AVERAGE/VLOOKUP that ranged over the
moved region.

Safer pattern for a sorted table: append at the end and re-sort, or rebuild
the sheet.

## Add a computed column

    for row in range(2, last + 1):
        sheet.cell(row=row, column=4,
                   value=f"=B{row}*C{row}")

Trap: writing the computed value instead of the formula. The workbook must
compute; see `scenes/create.md` §"Shared rules".

Trap: the new column needs the sheet's number format and the formula-colour
role (black), not the default.

## Replace values in place (a "what-if" edit)

- Inputs are blue; replace the input cell, never the formula cell.
- After replacing, recalculate (`scripts/recalc.py`) — the cached values in
  the file are stale until a real engine runs.
- Keep the original: copy the file, edit the copy, name it for the scenario.
  Overwriting the only copy of a model to test a number is how models are lost.

## Split one workbook into many (per-region exports)

Trap: copying the sheet object between workbooks does not work in openpyxl —
build a new workbook per output and write the rows, reusing the style objects.
Charts and images must be rebuilt.

Trap: each output needs the same conventions (formats, widths, freeze panes) —
extract them into a helper (`templates/base.py`) rather than re-deriving per
script.

## Merge many workbooks into one

- Read each source with `data_only=True` **after recalculating it**, or the
  formulas contribute `None`.
- Normalise the column sets first: sources that disagree on a column name or a
  date format produce a merged sheet that cannot be grouped.
- Record provenance — a `source_file` column — so a merged row can be traced
  back. A merge without provenance cannot be audited.

## Rename a sheet

Trap: formulas referencing `'Old Name'!A1` break silently (they become `#REF!`
only after a recalc). openpyxl does not rewrite them. Rename through the
defined-names audit: list every formula containing the old sheet name, rewrite
them, then rename.

## Protect a workbook

- `sheet.protection.sheet = True` with the specific cells that must stay
  editable unlocked (`cell.protection = Protection(locked=False)`).
- Protect the *structure* (adding/deleting sheets) separately from cell
  protection; a workbook whose structure is unprotected loses its hidden
  sheets to the first stray click.
- State the protection in the delivery note — a protected workbook that
  surprises the recipient generates a support request.

## Fill a template

- Locate the input cells by their labels or named ranges, never by fixed
  coordinates — a template revision that inserts a row shifts every coordinate.
- Write values, then recalculate, then verify the template's own totals moved
  as expected.
- Save as a new file; the template is the asset, the output is the artifact.

## Pattern: block detection

Real sheets are not one table — they are several tables stacked with blank
rows and section titles between them. Detect the blocks before transforming:

```python
def blocks(sheet):
    current, start = [], None
    for row in range(1, sheet.max_row + 1):
        empty = all(sheet.cell(row=row, column=c).value in (None, "")
                    for c in range(1, sheet.max_column + 1))
        if empty:
            if current:
                yield start, row - 1, current
                current = []
            start = None
        else:
            if start is None:
                start = row
            current.append(row)
    if current:
        yield start, sheet.max_row, current
```

A transform applied to "the data" without block detection silently merges two
tables and corrupts both. The block boundaries are the first thing to record.

## Pattern: pre-filter null rows

A null row inside a data region is either a separator (see block detection) or
a gap. Filter before transforming:

```python
rows = [r for r in rows if any(cell not in (None, "") for cell in r)]
```

And **count what was filtered** — a silently dropped row is the defect that
surfaces three steps later as a total that is off by one.

## Pattern: sort with formula rewrite

Sorting a region that contains formulas breaks the references — a formula that
said `=B5*C5` now computes the wrong row's product after the sort. The pattern:

1. Sort the **values** (or the source columns).
2. Rewrite the formula column **after** the sort, filling one formula down.
3. Recalculate and verify the first and last rows by hand.

A sorted region with un-rewritten formulas is worse than an unsorted one: it
is wrong and looks right.

## Pattern: zero-as-blank output

Financial output renders zeros as `-` (the number format), but an **empty cell
and a zero are different facts**. The pattern for the output layer:

```python
if value == 0:
    cell.value = None            # truly nothing to report
else:
    cell.value = value
cell.number_format = "$#,##0;($#,##0);-"
```

Use `None` only when the absence is the truth (no activity in the period).
Use `0` when the zero is the fact (activity happened, it totalled zero). The
format makes both display as `-`; the underlying value keeps the distinction
the reader needs.
