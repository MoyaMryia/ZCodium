# Analysis recipes

The recurring shapes, each as a short recipe. Encoding vocabulary from
vega-lite's documentation (BSD-3-Clause); mechanics from openpyxl/pandas public
APIs. `scenes/analyze.md` carries the method; this file is the lookup.

## 1. Total and mix

Question: how big, and what makes it up.

    summary = (
        frame.groupby("region", as_index=False)["revenue"]
        .sum()
        .assign(share=lambda d: d["revenue"] / d["revenue"].sum())
    )

Chart: one horizontal bar sorted by the measure, with the share labelled on
each mark. A pie only when the parts are few and the claim is "dominated by
one thing".

## 2. Change over time

Question: is it going up, and since when.

    monthly = (
        frame.assign(month=pd.to_datetime(frame["date"]).dt.to_period("M"))
        .groupby("month")["revenue"].sum()
    )

Chart: a line over a temporal axis. Mark the period the claim is about; state
the baseline in the caption. Do not connect across a gap in the data — break
the line or say the period is missing.

## 3. This period vs last

Question: growth.

    pivot = frame.pivot_table(index="region", columns="year",
                              values="revenue", aggfunc="sum")
    pivot["growth"] = pivot[2025] / pivot[2024] - 1

Chart: paired bars (this/last) with the growth labelled — not a single bar of
growth rates with no base. State the base period in the axis title.

## 4. Distribution

Question: where does the mass sit, what are the tails.

    counts, edges = np.histogram(frame["amount"], bins=20)

Chart: a histogram with equal-width bins, bin edges labelled, or a boxplot per
category when comparing several distributions. Never a mean alone — the mean
hides the bimodality that is usually the finding.

## 5. Top-N with a long tail

Question: what dominates.

    top = (frame.groupby("product")["revenue"].sum()
           .sort_values(ascending=False))
    top10 = top.head(10)

Chart: a horizontal bar of the top 10, plus an explicit "other" bar for the
remainder — the remainder is part of the answer. Sorted descending; category
labels never rotated.

## 6. Relationship between two measures

Question: do they move together.

Chart: a scatter, one point per entity, both axes quantitative, axes starting
at zero or with the truncation stated. A fitted line only when the claim is the
fit, and then report the fit's uncertainty, not just the line.

## 7. Conversion / funnel

Question: where do we lose them.

Chart: a horizontal bar per stage, each labelled with its absolute count and
the conversion from the previous stage. A funnel chart that skips the absolute
numbers is decoration.

## 8. Cohort retention

Question: do they stay.

    cohorts = frame.assign(
        cohort=frame.groupby("customer")["date"].transform("min").dt.to_period("M")
    )

Chart: a table-heatmap (cohort × period-since-start), cells coloured by
retention, values printed. Rows are cohorts, columns are periods since start —
never calendar months on both axes.

## 9. Outlier check

Question: is this row real?

    q1, q3 = frame["amount"].quantile([0.25, 0.75])
    iqr = q3 - q1
    outliers = frame[(frame["amount"] < q1 - 1.5 * iqr)
                     | (frame["amount"] > q3 + 3 * iqr)]

Report the outliers **with their identity**, not just their count — "3 rows
above 3×IQR" is not actionable; "orders #1042, #2210, #3198" is. Outliers are
a question for the data owner, not a deletion.

## 10. Reconciliation

Question: does this workbook agree with that one?

    left = frame_a.groupby("key")["amount"].sum()
    right = frame_b.groupby("key")["amount"].sum()
    diff = left.subtract(right, fill_value=0)
    breaks = diff[diff.abs() > 0.005]

A reconciliation that ends "difference: 0" without showing the comparison was
run is not a reconciliation. Show both totals, the break list, and the
tolerance used.

## The pandas → openpyxl bridge

The recurring shape: analyse with pandas, land the result in a workbook that
keeps the conventions.

```python
import pandas as pd
from openpyxl import load_workbook

summary = (
    frame.groupby("region", as_index=False)["revenue"].sum()
    .sort_values("revenue", ascending=False)
)

workbook = load_workbook("report.xlsx")
sheet = workbook["Summary"]
sheet.append([])                                   # one blank row first
sheet.append(["Region", "Revenue ($mm)"])         # header, conventions hold
for _, row in summary.iterrows():
    sheet.append([row["region"], round(float(row["revenue"]), 1)])
```

- The result lands with a header row, the unit in the header, and the number
  format from `engines/design.md` — derived output follows the same
  conventions as authored output.
- Round **once**, at the boundary, and state the precision in the header. A
  raw float in a report cell is a formatting defect.
- `as_index=False` keeps the group key as a column, which is what the sheet
  needs; the pandas-native index is a pandas artifact, not a spreadsheet
  concept.

## The KPI summary card

The one-screen answer, and the pattern is fixed:

| element | rule |
| --- | --- |
| the metric | one per card, named in the header with its unit |
| the value | display size, the number format from `engines/design.md` |
| the comparison | previous period, and the delta with its sign |
| the source | the sheet and range the number came from, in a note |

- One card per metric. Three metrics on one card is three cards.
- The delta is `current / previous - 1`, formatted as a percentage with the
  sign — never a bare number whose direction the reader must infer.
- The source note is what makes the card auditable; without it the card is a
  claim.
- The card reads from the model with formulas, not from pasted values — a
  card of typed numbers is a table pretending to be a dashboard.
