# Analyse data

Reading a workbook as data and answering a question about it. The encoding
theory below follows the vega-lite documentation (BSD-3-Clause,
https://github.com/vega/vega-lite); the mechanics are openpyxl for reading and
pandas for the shape work.

## Read

    from openpyxl import load_workbook

    workbook = load_workbook("data.xlsx", data_only=True, read_only=True)
    sheet = workbook["Sheet1"]
    rows = sheet.iter_rows(values_only=True)
    header = next(rows)
    records = [dict(zip(header, row)) for row in rows]

- `data_only=True` returns the last **cached** values. A workbook that was
  never recalculated by a real engine returns `None` for every formula cell —
  recalculate first (`scripts/recalc.py`), or read the inputs and recompute
  yourself.
- `read_only=True` streams; use it for large files (a 100k-row workbook loaded
  eagerly will exhaust memory).
- Skip formatting rows and merged banners by locating the real header row
  (the first row whose cells are all non-empty strings) rather than assuming
  row 1.
- Normalise types on the way in: numbers stored as text, dates as formatted
  strings, empty strings vs `None` — all of them break arithmetic silently.

## Shape

    import pandas as pd

    frame = pd.DataFrame(records)
    frame["revenue"] = pd.to_numeric(frame["revenue"], errors="coerce")
    summary = (
        frame.groupby("region")["revenue"]
        .sum()
        .sort_values(ascending=False)
    )

- pandas is a convenience, not a dependency (`SKILL.md` §9): it is absent from
  some environments, and the openpyxl read above is unaffected.
- `errors="coerce"` turns unparseable values into `NaN` so one bad cell does
  not abort the analysis — and **count the NaNs**; a silently coerced column is
  a finding, not a footnote.
- Answer the question asked. "Revenue by region, this year vs last" is a
  groupby and a ratio, not a pivot table with every dimension in it.

## Encode the answer (vega-lite theory)

The grammar that decides the chart form, before any library is involved:

- **mark** — the geometric form: `bar`, `line`, `point`, `area`, `boxplot`,
  `tick`, `arc`. Choose from the claim, not from habit
  (`engines/chart.md` §1).
- **encoding channels** — position (`x`, `y`), colour, size, shape, text.
  Position is the strongest channel; colour the weakest for quantities and the
  strongest for categories.
- **data types** — `quantitative` (a magnitude, aggregate with sum/mean),
  `nominal` (unordered categories, no aggregation), `ordinal` (ordered
  categories), `temporal` (dates; the axis handles the calendar). Getting this
  wrong is what produces "average of a postcode".
- **aggregation is explicit** — `aggregate: "sum"` / `"mean"` / `"count"` on
  the quantitative channel. A raw scatter of transactional rows is not a
  summary.
- **scale** — `zero: false` is legitimate for lines (change is the claim) and a
  lie for bars (magnitude is the claim).
- **guides** — axis titles carry units; legends only when marks cannot be
  labelled directly.

The same grammar applies whichever library draws the chart: the encoding
decision is library-independent, so make it before writing plotting code.

## Deliver

- The answer as a sentence, then the number that backs it, then the workbook
  or figure that shows it — in that order.
- A written analysis names its source, its period, and any row it excluded
  (and why). An undocumented exclusion is the first thing a reader challenges.
- New sheets written into the analysis workbook follow `engines/design.md` —
  conventions hold for derived output too.

## Pitfalls

- Averaging percentages (of different bases) and calling it the average.
- Grouping on a column that has trailing whitespace in half its rows.
- Reading cached values from a workbook nobody recalculated.
- Presenting a pivot with every dimension as "the analysis" — the answer is
  one table, the rest is appendix.
