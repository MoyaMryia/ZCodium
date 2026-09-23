# Chart templates

What a chart is made of, what it must satisfy when it lands in a `.docx`, and the
checks that catch the failures. This plugin has no chart generator: a chart arrives
as an inline image inside a run, so everything here is about the image's extent, the
type inside it, and the caption around it.

## 1. The five parts of a chart

Every chart in the reference collection is the same five pieces, and a chart missing
one of them is usually a chart that was never finished:

| part        | what it is                                   | what goes wrong                                                       |
| ----------- | -------------------------------------------- | --------------------------------------------------------------------- |
| frame       | the axis lines and the plot background       | a full box around the data adds ink and no information                |
| axes        | the two scales, their limits and their ticks | auto-chosen limits that make a 2% difference look like a collapse     |
| tick labels | the numbers on the ticks                     | scientific notation, or `×10³` factored onto the axis                 |
| series      | the data itself                              | thinner than the frame, so the data is quieter than its own container |
| legend      | what each series is                          | repeating what the axis label already says                            |

The frame is drawn with two axis lines meeting at the origin — no top, no right, no
box. The series is drawn at one and a half to three times the weight of the frame.
That ratio is the whole reason a chart is readable at arm's length: the loudest ink
on the page is the data.

## 2. The size rule

**Compile the chart at the size it will occupy.** A chart built at one width and
scaled to another scales its type with everything else, so a chart reduced to 60%
carries type at 60% of the size you chose — and the type is the first thing to
become unreadable.

The size is set on the chart, in absolute units, not inherited:

- width and height in centimetres, chosen against the text column;
- the chart's own margins trimmed to a couple of millimetres, so the image's
  bounding box is the plot plus its labels and nothing else.

In the `.docx`, the image extent is `wp:extent/@cx` and `@cy` in EMU. **1 twip is
635 EMU**, so an image that should fill a text column of N twips needs
`cx = N × 635`. `image-overflow` makes exactly that comparison — an image wider than
the narrowest usable text column across all sections fails the gate, and it compares
width only.

Consequences worth knowing:

- The narrowest column wins, not the first one. A document whose second section has
  a wider margin is judged against the narrower of the two.
- The check is on the drawing's declared extent. An image whose extent says 16 cm in
  a 15 cm column fails even if the picture inside it has white space at the edges.
- Landscape and portrait sections in the same document produce very different
  columns; measure against the section the chart actually sits in.

## 3. Type inside the chart

- The chart's tick labels and axis labels are set in the chart's own family and at a
  size chosen against the document's body size, not against the chart's own canvas.
  The rule of thumb: a tick label is never smaller than the body text it will sit
  beside.
- A chart set in a sans family inside a serif document is fine, and is the common
  choice — tick labels are short and the sans shapes survive being small. What is not
  fine is a third family appearing only inside the chart.
- Pin the chart's compatibility level. Charting packages change behaviour between
  versions, and a chart that compiled one way last year can compile differently
  today without any change to its source. `compat=newest` is a decision; so is
  pinning an older level.
- Tick label style is set explicitly — the family and the size of the numbers are
  not inherited from anything you control.

## 4. Numbers on the axes

Three specific failures, all of which come from the defaults:

- **Scientific notation.** A tick reading `1.5e-3` on a business chart is a defect.
  The fix is a number-format key on the chart, not a manual tick list.
- **A factored scale.** An axis labelled `×10⁶` with ticks reading `1 2 3` is the
  same defect in a different disguise. Turn scaled ticks off and let the labels carry
  the magnitude.
- **Too many ticks.** Auto-chosen tick density on a narrow chart produces labels
  that collide. Set the tick positions explicitly and set their labels explicitly
  when the labels are not plain numbers — `T`, `2T`, `3T` rather than `15`, `30`,
  `45` is the pattern: a symbolic label on a numeric tick.

Air above the data (`enlargelimits`) is not padding. Without it the topmost point
sits exactly on the frame and reads as clipped.

## 5. Series, and where the data lives

- A series is either an expression or a file. An expression is written once as a
  named function and referenced, so a parameter change is one edit and not five.
- Data in a file is better than data inline, for a document that will be revised:
  the numbers live in one place, they can be regenerated, and the chart source stays
  readable. Keep the data file next to the output, not embedded in the document
  source.
- Several series share one axis only when they share a scale. Two series with
  different units on one axis is a chart that cannot be read.
- Smoothing is a claim about the data. `smooth` on a series of discrete measurements
  invents values between the points; leave the points alone unless the underlying
  function really is continuous.
- Markers are for discrete observations, lines are for continuous functions. A line
  through five measured points asserts something the measurements do not.

## 6. Annotation

- An annotation band is a filled rectangle drawn **after** the series, so it sits on
  top. Draw it first and the series disappears under it.
- A tinted band is a tint, not a colour. `green!10` — ten percent of the colour —
  is the pattern: enough to separate a region, not enough to compete with the data
  or to eat a printer's toner.
- A band needs a legend entry or a caption note, or the reader does not know what it
  marks. An unexplained shaded region is decoration.

## 7. Colour, and the greyscale test

- One hue per series, or one hue at several lightness steps when there are more
  series than hues. Never two mid-tone colours of similar lightness — they are
  indistinguishable to a reader with reduced colour vision and identical in a
  greyscale print.
- Print one page in black and white before delivering. If two series merge, they
  needed a different lightness or a different marker, not a different colour.
- Restraint: a chart with an accent colour for the series that matters and grey for
  the rest says more than a chart with five saturated colours.

## 8. The caption

- Caption **below** a figure, above a table. Readers navigate by this convention;
  inverting it makes a caption read as a stray heading.
- The label goes immediately after the caption and is prefixed (`fig:`). A label on
  the image itself resolves to the enclosing counter and produces silently wrong
  references.
- The caption says what the chart shows and what the reader should take from it. "图
  3 各方案耗时对比" is a title; "图 3 方案 B 在 10 万行以上明显优于方案 A" is a
  caption.
- Every chart is cross-referenced from the body text. A chart nothing points at is
  decoration.

## 9. Checklist before handing a document with charts over

- Every chart compiled at the width it occupies, type inside it at or above body
  size.
- `image-overflow` passes: every `wp:extent` within the narrowest usable text column
  (twips × 635 EMU).
- No scientific notation and no factored scale on any axis.
- One family per chart, two at most across the document.
- Series distinguishable in greyscale; annotation bands tinted, not saturated.
- Caption below, label after the caption, every chart referenced from the text.
- `postcheck.py report.docx --only image-overflow,blank-pages,line-spacing`

## Source

The structure of this brief — a chart as its own document with trimmed margins and
an explicitly pinned compatibility level, two axis lines rather than a box, the
series drawn heavier than the frame, tick label style set explicitly, the
fixed-decimal number format and the disabled scaled ticks, symbolic labels on
numeric ticks, the named-function pattern for a parametrised expression, data held
in a separate file and plotted from it, and annotation bands drawn over the series
as a tint — follows the conventions of:

    xinychen/awesome-latex-drawing
    https://github.com/xinychen/awesome-latex-drawing
    Copyright (c) 2019 Xinyu Chen
    MIT License — https://github.com/xinychen/awesome-latex-drawing/blob/master/LICENSE

The knowledge above is restated in this repository's own words and in `.docx` terms;
no upstream file is distributed with this plugin.

## 10. The six chart types

The parts above are shared; each type adds its own rules. Choose from the
claim, not from habit.

### Bar chart

- **Use for**: magnitude comparison across categories.
- **Rules**: bars start at zero, always. Horizontal bars when category labels
  are long; vertical when they are short. One series in the accent, the rest
  grey. Data labels on the marks; a legend only when the marks cannot be
  labelled. Sorted descending unless the order carries meaning.
- **Grouped bars** (this vs last): the current period takes the accent, the
  comparison period is grey. Growth numbers go in the caption, never as a
  third series.

### Line chart

- **Use for**: trend over time.
- **Rules**: a temporal axis with calendar-aware ticks (equal time spacing even
  when a period is missing). Markers only when the individual points matter;
  a smooth line without markers hides gaps. Truncated axes are allowed here —
  the claim is change — and the truncation must be visible in the axis labels.
- **Many series**: small multiples (one panel per series) beat ten lines on one
  plot.

### Pie chart

- **Use for**: part-to-whole at a single moment, with few parts.
- **Rules**: ≤ 5 slices, or the chart becomes unreadable. Slices sorted from
  twelve o'clock clockwise, largest first. Direct labels with values, never a
  legend alone. Never a 3-D pie: the perspective distorts the areas the chart
  exists to compare.

### Box plot

- **Use for**: distribution comparison across groups.
- **Rules**: the box spans Q1–Q3, the median is marked distinctly from the
  mean, whiskers to 1.5 × IQR with outliers as individual points. State the
  n per group — a box plot without the n hides a group of three.
- Boxes in greys with the group of interest in the accent.

### Radar chart

- **Use for**: multivariate profile comparison across few axes (3–8).
- **Rules**: axes share one scale, labelled with units, and the same direction
  of "better" on every axis. Two or three overlaid polygons maximum; more and
  the plot becomes spaghetti. Radar charts flatter differences — use only when
  the profile shape is the claim.

### Heatmap

- **Use for**: a matrix of values where the pattern is the claim (cohorts,
  correlations, calendars).
- **Rules**: a perceptually uniform sequential palette; the colour scale legend
  states the range and the direction. Cell values printed when the matrix is
  small enough. Row and column order chosen to reveal the pattern (clustered,
  chronological), never alphabetical by default.

## 11. Embedding rules (mandatory)

- **Preserve the aspect ratio**: set the width, never both width and height —
  a chart with both set is stretched, and a stretched chart misreports its own
  data.
- **Size from the text block**: `\linewidth` at the point of insertion (inside
  a list or table cell the width is the cell's, not the page's).
- **Anchor, do not float blindly**: charts referenced from the text belong near
  their first reference; a float that drifts three pages away is a defect.
- **Caption below the chart**, first sentence = the claim, then source and
  method. The caption is the most-read text in the figure.
- **Vector first**: EMF/SVG for charts that will be printed; PNG at 300 dpi
  when the chart must be a bitmap. A screenshot of a chart is not a chart.
- **The greyscale test**: print the page in greyscale. If two series become
  indistinguishable, colour was carrying meaning alone — fix it before
  delivery.
