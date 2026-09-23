# Charts

Data figures inside a typeset document: choosing the form, building it, and the
defects that make a chart mislead rather than inform.

## Choose the form from the claim

| the claim is… | the form is… |
| --- | --- |
| compare magnitudes across categories | horizontal bar (long labels) or vertical bar (short) |
| compare to a total | stacked bar or a single 100% bar |
| trend over time | line (few series) or small multiples (many) |
| distribution | histogram or a dot/strip plot |
| two variables' relationship | scatter, with a fitted line only if the claim is the fit |
| part-to-whole over time | stacked area, sparingly |

- Bars start at zero, always. A truncated axis on a bar chart is a lie the
  reader cannot detect.
- Lines may use a truncated axis when the claim is about change, and the axis
  labels must make the truncation obvious.
- One chart, one claim. A figure carrying three claims is three figures.

## Build it in the document's system

- Vector output: `pgfplots` for plots generated in LaTeX, matplotlib with
  `pdf`/`svg` output for everything else. A raster chart at screen resolution
  is a defect in a print document.
- The palette from `palette.md`: one series in the accent, the rest in greys.
- Type inside the figure matches the document family; sizes scaled to the
  figure so a chart at `0.8\textwidth` keeps readable labels (≥ 8 pt at final
  size).
- `\includegraphics[width=\textwidth]{}` — never a hard-coded size, and only
  `width`, so the aspect survives.

## Labeling

- Axis labels carry units; tick labels carry the unit when it is uniform
  ("Revenue ($mm)" in the axis title, not per tick).
- Direct data labels on marks beat a legend whenever there is room; a legend
  only when marks cannot be labelled.
- No gridlines, or minimal horizontal ones in a light tone. Vertical gridlines
  are almost always noise.
- The caption states the claim in its first sentence, then the details: source,
  method, sample size. A caption that only says "Revenue by region" wastes the
  most-read text in the document.

## Tables vs charts

- Few numbers, exact values matter → a table (`booktabs`, no vertical rules,
  units in headers).
- Shape, trend, comparison → a chart.
- Both a table and a chart of the same data is acceptable only when the chart
  shows the shape and the table is the reference appendix.

## Defects to check in the render

- Labels clipped at the figure edge (matplotlib `bbox_inches="tight"` or
  pgfplots' default clipping).
- Legend overlapping data.
- Axis tick labels rotated into unreadability — shorten labels or rotate the
  whole figure.
- A chart whose numbers disagree with the sentence beside it (the most
  embarrassing defect, and the one reviewers always find).
- Colour as the only series distinction.

## Diagrams are not charts

Flow diagrams, architecture figures and timelines are drawings, not plots:
TikZ for layout-precise work, with a consistent node/arrow language across the
document and a legend at the first diagram. See `process-advanced.md` for
diagram practice inside a build.

## Label collision prevention (anti-stacking)

The most common chart defect is not wrong data — it is labels that overlap until
neither is readable. Prevent it by construction:

- **Pie/donut**: never more than ~6 slices with direct labels. Labels go
  outside the arc with leader lines, or the chart becomes a bar chart with
  extra steps. A slice too small for its label is aggregated into "other".
- **Bar**: value labels at the bar end, outside the bar, never inside unless
  the bar is long enough to hold them. Horizontal bars keep the category labels
  left of the axis, never rotated.
- **Line**: label the first and last point of each series, not every point. A
  label per point on a 50-point series is noise; the series name at the end of
  the line is the convention.
- **Scatter**: no per-point labels unless the claim is about specific points —
  then label only those, with offsets chosen so they do not collide.
- **Universal pre-check**: render the chart and look at it. If two labels are
  within one line-height of each other, the chart is not done — reduce the
  label count, not the font size.

## Visual refinement

The difference between a chart that looks generated and one that looks designed
is a short list:

- **Axis and grid**: horizontal gridlines only, in a light support tone, behind
  the data. No gridline at the accent colour, no vertical grid unless the x
  axis is categorical and sparse. Axis lines thinner than the data marks.
- **No chartjunk**: no 3-D, no gradient fills on series, no drop shadows, no
  picture fills. Each of these makes the numbers harder to read and adds
  nothing.
- **Geometry refinement**: rounded bar ends (2–3 px at final size), a consistent
  marker size across series, and a line weight that survives the final rendered
  size — a hairline that prints invisibly is a defect.
- **Direct labelling beats a legend** whenever there is room; a legend only when
  the marks cannot carry their names.
- **One series in the accent, the rest in greys** (`palette.md`), and the
  greyscale test before delivery.
