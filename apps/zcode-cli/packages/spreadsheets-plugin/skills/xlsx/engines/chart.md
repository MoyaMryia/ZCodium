# Charts

Data figures inside a workbook: choosing the form, building it with the
libraries' public APIs, and the defects that make a chart mislead. Encoding
vocabulary follows vega-lite's documentation (BSD-3-Clause,
https://github.com/vega/vega-lite); chart construction follows the XlsxWriter
documentation (BSD-2-Clause, https://github.com/jmcnamara/XlsxWriter).

## Choose the form from the claim

| the claim is… | mark | aggregation |
| --- | --- | --- |
| compare magnitudes across categories | bar (horizontal for long labels) | sum |
| compare to a total | stacked bar | sum |
| trend over time | line | sum per period |
| distribution | histogram, boxplot | count |
| relationship of two measures | point (scatter) | none — one point per entity |
| part-to-whole at one moment | arc, sparingly | sum |

- Bars start at zero, always. A truncated axis on a bar chart is undetectable
  by the reader and indefensible by the author.
- Lines may truncate when the claim is about change; label the axis so the
  truncation is visible.
- One chart, one claim. Two claims are two charts.

## Encode deliberately

- **Position** carries magnitude; **colour** carries category or highlights one
  series. Colour as the only series distinction fails colour-blind readers —
  pair it with position or label.
- **Type the channel correctly**: quantitative (magnitude, aggregated),
  nominal (unordered categories), temporal (dates — let the axis own the
  calendar). A date encoded as nominal produces one bar per day in file order.
- **Aggregate explicitly**: `SUM` per category, `AVERAGE` only when the claim
  is about the mean and the reader knows the n.
- **Direct labels beat legends** whenever there is room; a legend is the
  fallback, not the default.

## Build it (XlsxWriter)

    chart = workbook.add_chart({"type": "column"})

    chart.add_series({
        "name": "Revenue",
        "categories": "=Data!$A$2:$A$13",
        "values": "=Data!$B$2:$B$13",
        "fill": {"color": "#1F6FEB"},        # the accent, on the one series
    })

    chart.set_title({"name": "Revenue by region ($mm), FY2025"})
    chart.set_x_axis({"name": "Region"})
    chart.set_y_axis({"name": "Revenue ($mm)", "num_format": "$#,##0"})
    chart.set_legend({"none": True})          # direct labels instead
    chart.set_size({"width": 480, "height": 288})

    worksheet.insert_chart("D2", chart)

- Series ranges are the sheet's own cells, so the chart follows the formulas —
  recalculate before the consumer opens it.
- `set_size` in pixels; a chart inserted at default size overflows its
  neighbours.
- `set_legend({"none": True})` with data labels on the series
  (`"data_labels": {"value": True}`) is the readable default.
- Axis titles carry units (`Revenue ($mm)`), and the number format matches the
  column's format.

## Build it (openpyxl)

    from openpyxl.chart import BarChart, Reference

    chart = BarChart()
    chart.type = "col"
    data = Reference(sheet, min_col=2, min_row=1, max_row=13)
    cats = Reference(sheet, min_col=1, min_row=2, max_row=13)
    chart.add_data(data, titles_from_data=True)
    chart.set_categories(cats)
    chart.title = "Revenue by region ($mm), FY2025"
    chart.y_axis.title = "Revenue ($mm)"
    chart.legend = None
    sheet.add_chart(chart, "D2")

- openpyxl charts are rebuilt on save; a chart authored by another tool and
  round-tripped through openpyxl may lose styling. Verify after saving.

## Defects to check in the render

- The chart whose numbers disagree with the sentence beside it — the most
  embarrassing defect, and the one reviewers always find. Check the source
  range covers exactly the data you mean.
- Labels clipped at the chart edge; the legend overlapping the plot.
- Category labels rotated into unreadability — shorten them or switch to a
  horizontal bar.
- A 3-D chart, a dual axis, or a gradient-filled series: all three make the
  numbers harder to read and none of them add information.
- Colour as the only distinction between series.

## Tables vs charts

Few exact numbers → a table. Shape, trend, comparison → a chart. Both is
acceptable when the chart shows the shape and the table is the reference.
