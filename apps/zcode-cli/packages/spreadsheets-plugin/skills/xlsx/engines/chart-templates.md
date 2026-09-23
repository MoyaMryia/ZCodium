# Chart templates

Ready-made chart configurations for the recurring claims, in XlsxWriter and
openpyxl syntax. Palette and typography from `engines/design.md`; the encoding
decisions from `engines/chart.md`. Each template names the claim it serves —
use it only for that claim.

Shared palette (one accent, greys for the rest):

    ACCENT   = "#1F6FEB"   # the one series that matters
    SUPPORT  = "#8A94A6"   # every other series
    GRID     = "#E3E7EE"
    INK      = "#1A1A1A"

## 1. Magnitude by category (horizontal bar)

Claim: "X is bigger than Y". Categories with long names.

    chart = workbook.add_chart({"type": "bar"})
    chart.add_series({
        "name": "Revenue",
        "categories": "=Data!$A$2:$A$13",
        "values": "=Data!$B$2:$B$13",
        "fill": {"color": ACCENT},
        "data_labels": {"value": True},
    })
    chart.set_legend({"none": True})
    chart.set_x_axis({"name": "Revenue ($mm)", "num_format": "$#,##0"})
    chart.set_y_axis({"reverse": True})       # first row at the top

The `reverse` on the category axis is what puts the largest bar at the top —
without it the chart reads bottom-up.

## 2. Trend over time (line)

Claim: "it went up since March".

    chart = workbook.add_chart({"type": "line"})
    chart.add_series({
        "name": "Revenue",
        "categories": "=Data!$A$2:$A$25",     # dates, temporal
        "values": "=Data!$B$2:$B$25",
        "line": {"color": ACCENT, "width": 2.25},
    })
    chart.set_x_axis({"date_axis": True, "num_format": "mmm yyyy"})
    chart.set_y_axis({"name": "Revenue ($mm)"})

`date_axis: True` makes the axis calendar-aware — equal time spacing even when
a month is missing from the data.

## 3. This period vs last (clustered column)

Claim: "growth came from these two regions".

    chart = workbook.add_chart({"type": "column"})
    chart.add_series({"name": "FY2024", "categories": "=Data!$A$2:$A$9",
                      "values": "=Data!$B$2:$B$9", "fill": {"color": SUPPORT}})
    chart.add_series({"name": "FY2025", "categories": "=Data!$A$2:$A$9",
                      "values": "=Data!$C$2:$C$9", "fill": {"color": ACCENT}})

The current period takes the accent; the comparison period is grey. Growth
numbers go in the caption, not as a third series.

## 4. Composition (stacked bar, 100%)

Claim: "the mix shifted".

    chart = workbook.add_chart({"type": "bar", "subtype": "percent_stacked"})

`percent_stacked` normalises each row to 100%. Use it when the claim is about
share; use plain `stacked` when the absolute total also matters and say so in
the axis title.

## 5. Distribution (histogram via column)

Claim: "most values sit here".

Build the bins with `FREQUENCY`/`COUNTIFS` in the sheet, then plot the bin
counts as a column chart with no gaps:

    chart = workbook.add_chart({"type": "column"})
    chart.add_series({... "fill": {"color": ACCENT}})
    chart.set_legend({"none": True})
    chart.set_x_axis({"name": "Amount ($)"})
    chart.set_y_axis({"name": "Count"})

Excel has no histogram mark; the bins are a column of formulas, which also
makes the bin edges auditable.

## 6. Relationship (scatter)

Claim: "these two move together".

    chart = workbook.add_chart({"type": "scatter"})
    chart.add_series({
        "name": "Accounts",
        "categories": "=Data!$A$2:$A$200",   # x values, quantitative
        "values": "=Data!$B$2:$B$200",       # y values
        "marker": {"type": "circle", "size": 5, "fill": {"color": ACCENT}},
        "line": {"none": True},
    })

Both axes start at zero or the truncation is stated. A trendline only when the
claim is the fit — and then the fit's R² goes in the caption.

## 7. Top-N with remainder

Claim: "the head dominates".

Compute the top-N and an "other" row in the sheet (`scenes/analyze-recipes.md`
§5), then template 1 over N+1 rows. The "other" bar is drawn in SUPPORT — it
is context, not a category.

## Anti-patterns (all three fail review)

- `type: "pie"` with more than ~5 slices, or 3-D anything.
- A secondary y-axis: two scales on one plot invites the reader to compare
  things that cannot be compared. Use two charts.
- A gradient or picture fill on a data series: the fill now encodes nothing
  and the legend lies.
