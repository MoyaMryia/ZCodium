# Overflow

Content that does not fit — the failure family that produces most "the PDF
looks wrong" reports. Every item here is visible in the render and invisible in
the source unless you know where to look.

## Diagnose from the log first

| log message | meaning | fix |
| --- | --- | --- |
| `Overfull \hbox (12.0pt too wide)` | a line runs 12pt into the margin | allow hyphenation, reword, or `\sloppy` locally |
| `Underfull \hbox` | a line stretched with loose spaces | usually harmless; persistent ones mean bad breaks |
| `Overfull \vbox` | a page's content exceeds the text block | break earlier, shrink a float, `\enlargethispage` |
| `Float too large for page` | the float exceeds `\textheight` | resize it — it will never fit as-is |

The number in parentheses is exactly how far the content overruns. Small
overfulls (< 5pt) are usually invisible; anything above 10pt is visible at
reading distance.

## Horizontal overflow

- **Long unbreakable strings**: URLs, identifiers, file paths. Fix with
  `\usepackage{xurl}` (`\url` breaks anywhere) or `seqsplit`. A URL that
  cannot break pushes its whole line into the margin.
- **Wide tables**: never exceed `\textwidth`. Fix by `tabularx`/`tabular*` with
  computed column widths, smaller type (`\small`), rotated `sidewaystable`, or
  splitting the table.
- **Wide figures**: set `width=\textwidth` (never a hard-coded `cm`), and keep
  the aspect by setting only `width`.
- **Display math**: `\resizebox{\textwidth}{!}{...}` is the last resort — it
  scales the type down with it. Prefer splitting the equation or using
  `multline`.

## Vertical overflow

- A float taller than `\textheight`: resize or split. LaTeX will defer it
  forever otherwise, and the float queue silently empties the document of its
  figures.
- A `longtable` row taller than the page: split the row's content.
- Page-bottom clipping in the render (content past the paper edge): almost
  always an overlay/`tikz` page or a `\newgeometry` that was never closed with
  `\restoregeometry`.

## The render is the ground truth

- Rasterize and read the page images (`convert_pdf_to_images.py`): overflow at
  the margin edge, content off-page, and float collisions are all visible there
  and invisible in the source.
- `check_bounding_boxes.py` measures content boxes against the page box;
  `pdf_qa.py` runs the full defect gate. Both are described in SKILL.md §6.

## Prevention beats repair

- Every figure and table sized from `\textwidth` / `\linewidth`, never from a
  remembered number.
- `microtype` on — it removes a large fraction of marginal overfulls by itself.
- Tables built with `tabularx`/`longtable` from the start; converting a broken
  `tabular` after the fact costs more than building it right.
- Read the log after every build. `Overfull` warnings are a to-do list, not
  noise — the document that compiles clean is the document whose render matches
  its source.

## The log is a to-do list

Every `Overfull`/`Underfull` line names a location and a magnitude. Treat the
log as work items, not noise:

    Overfull \hbox (12.0pt too wide) in paragraph at lines 88--92

- The number is how far the content overruns, in points. Under ~5 pt is
  usually invisible at reading distance; above 10 pt it is visible; above
  20 pt it is what the reader notices first.
- `in paragraph at lines 88--92` names the source lines. Fix there, not in the
  rendered page.
- `\hbox` = horizontal (a line, a table, a figure); `\vbox` = vertical (a page's
  content, a float taller than the text block).
- A build with zero overfull boxes is the goal, but the last one is not worth
  a hack: a document with two 3 pt overfulls and readable text beats one with
  `\sloppy` document-wide and loose spacing everywhere.

## Repair recipes

### A line runs into the margin

1. **Enable hyphenation** for the document language (`babel`/`polyglossia`) —
   the single most effective fix, and free.
2. **Load `microtype`** — protrusion and expansion remove a large fraction of
   marginal overfulls by themselves.
3. **Allow the offending paragraph to break better**: reword, or move the long
   token. A URL or identifier that cannot break is the usual culprit —
   `xurl`'s `\url` breaks anywhere.
4. **Local `\sloppy`** inside a narrow `minipage` or a `twocolumn` cell — never
   document-wide.

### A table is too wide

1. `tabularx` with computed column widths, or `tabular*` with `\tabcolsep`
   reduced.
2. Smaller type for that table (`\small`/`\footnotesize`) — a legitimate
   design decision, not a defeat.
3. `sidewaystable` when the table is genuinely landscape-shaped.
4. Split the table: fewer columns, or two stacked tables.

### A figure is too wide

- Set only `width=\textwidth` (or `\linewidth` inside an environment); setting
  both width and height stretches the art.
- If the figure is a plot, re-make it at the right aspect instead of scaling.

### Display math overflows

- `multline` for a long single equation; `split`/`aligned` for derivations.
- `\resizebox{\textwidth}{!}{...}` is the last resort — it scales the type down
  with the content, and the equation becomes the smallest thing on the page.

### A float is taller than the text block

- It will never fit as-is: resize it, or split it. LaTeX defers it forever
  otherwise, and the float queue silently empties the document of its figures.

## Prevention checklist

- [ ] Hyphenation enabled for the document's language.
- [ ] `microtype` loaded.
- [ ] Every figure and table sized from `\textwidth` / `\linewidth`.
- [ ] Tables built with `tabularx`/`longtable` from the start.
- [ ] URLs and long identifiers through `xurl` or `seqsplit`.
- [ ] The log read after every build, and the overfulls worked until none
      remains above ~5 pt.
