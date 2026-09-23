# Brief — Posters

Applies to conference, event and exhibition posters printed on large stock. A
poster is not a report on bigger paper: the constraints come from the viewing
distance, and almost every defect a poster has is a type-scale defect.

## Format

- A0 (841 × 1189 mm) portrait, or A1 (594 × 841 mm) when the venue or the board
  limits it. Landscape when the content is a timeline or a wide figure; portrait
  otherwise. Decide before writing, because the column count follows from it.
- `\usepackage[a0paper,margin=20mm]{geometry}`, or a dedicated poster class
  (`beamerposter`, `tikzposter`, `a0poster`) when one is available. A dedicated
  class gets the block structure and the colour handling right for free.
- Set the paper size in the geometry, never by scaling an A4 document. `\resizebox`
  on the whole page scales the type down with everything else and produces a
  poster whose body text is unreadable.
- Leave 15–20 mm of clear margin all round. Printers cannot print to the edge, and
  a poster whose content touches the trim gets clipped.
- Verify the result: `pdfinfo` must report the intended page size. A poster
  reporting A4 has a geometry bug.

## Viewing distance sets the type scale

This is the single most important rule in the brief. A poster is read from one to
two metres away, not from forty centimetres, so type sizes are not a report's
sizes multiplied by enthusiasm.

At A0, as starting points:

| Element                   | Size      |
| ------------------------- | --------- |
| title                     | 90–140 pt |
| authors and affiliations  | 48–60 pt  |
| section headings          | 60–72 pt  |
| body text                 | 28–36 pt  |
| figure and table captions | 24–28 pt  |
| references                | 20–24 pt  |

Scale these with the paper: at A1, roughly 0.7× each value; at A0 landscape,
the same values with more columns. The relationship to preserve is that body text
stays around 28 pt at A0 — the point at which it is legible at a metre without the
reader leaning in.

Set the sizes once, in the preamble, as named lengths:

```latex
\newcommand{\postertitle}{96pt}
\newcommand{\posterbody}{30pt}
```

so the whole document scales from one place. Scattering sizes through the body is
how a poster ends up with three different body sizes and nobody notices until it
is printed.

## Column structure

- Three or four columns on A0 portrait; two or three on A0 landscape. Fewer
  columns and the lines run too long to track back to the start; more and each
  column is too narrow for a figure.
- Column width roughly 250–280 mm on A0 portrait, with a 20–30 mm gutter. The
  gutter is what stops adjacent columns reading as one block of text.
- `beamerposter`'s `columns` environment, or fixed-width `minipage` environments in
  a row. `multicol` is the wrong tool here: its balanced columns are right for
  text flow and wrong for a poster, whose blocks are deliberately different
  heights.
- Reading order is top-to-bottom within a column, then left-to-right across
  columns. Number the sections, or make the headings large enough that the order
  is unmistakable. A reader who cannot tell where to look next has been failed by
  the layout, not by their attention.
- Balance the columns by eye. The last column ending a third short is normal and
  fine; the first column ending short pushes the whole poster's weight to the
  right.

## Colour blocks

- Two or three colours plus neutrals: a dominant background, one accent for
  headings and rules, one for emphasis. A palette wider than that reads as noise
  at poster scale.
- Define the palette once in the preamble with `xcolor`, then reference the names.
  Never write a hex value inline.
- Colour blocks carry the structure. A tinted panel behind each section, a solid
  band behind the title, a rule under each heading. These do the work that
  whitespace does on a report page, and they survive a crowded poster better.
- `tcolorbox` for panels — it handles the rounded corners, the padding and the
  page breaks that a hand-built `\colorbox` does not.
- Contrast is a legibility requirement, not a taste question. Dark text on a light
  panel, light text on a dark one, and never mid-grey text on a mid-grey ground.
- Avoid saturated full-bleed backgrounds behind body text. A deep tinted
  background across a whole column costs ink and reduces contrast; use it behind
  the title block only.
- Print is usually RGB from a PDF but reproduced in CMYK, and saturated blues and
  greens shift. Choose colours that survive a channel shift, and check the printed
  proof rather than the screen.

## Figures at poster scale

Figures are where posters most often fail, because a figure designed for a page is
simply not legible at poster distance.

- Regenerate every figure at poster size. Do not include a PDF or PNG built for an
  A4 paper and let the poster scale it up — the type inside it scales with the
  pixels and turns to mush.
- Type inside a figure must be at least as large as the poster's caption size,
  24–28 pt at A0. Axis labels, tick labels and legend entries all count.
- Line widths and marker sizes need scaling too: a 0.4 pt line that reads correctly
  on paper disappears at poster scale.
- One idea per figure. A poster figure with six panels and a shared legend asks the
  reader to stand still and study it, which defeats the format.
- Prefer a figure with a takeaway in its caption over a bare plot. The caption is
  read at a distance; the axes are not.
- Vector output (`pdflatex`-friendly PDF figures, or TikZ / PGFPlots source) scales
  cleanly. Bitmaps need to be rendered at the physical size they will occupy.

## Build and rendering

- Use a Unicode engine (`xelatex` / `lualatex`) so large font sizes and any
  non-Latin text resolve correctly.
- `latexmk -xelatex -interaction=nonstopmode poster.tex`. A poster is a single page
  with a lot on it; a single error can leave the page half-built, so read the log
  rather than trusting the exit code.
- Rasterize at a lower resolution than a report — the composition is what the
  visual gate needs — but not so low that the smallest type is unreadable.
- The visual gate matters more here than anywhere else, because the defects that
  matter (type too small, a figure that has turned to mush, a column that reads in
  the wrong order) are only visible on the rendered page.

## Self-check before handing this over

- `pdfinfo` reports the intended page size, A0 or A1 as designed.
- Body text is at least ~28 pt at A0; nothing on the poster is below ~20 pt.
- Title is the largest element on the sheet by a clear margin.
- Every figure was regenerated at poster scale; no upscaled A4 artwork.
- Type inside every figure is legible at arm's length.
- No content within 15 mm of the trim edge.
- Colour blocks have adequate contrast; the palette is two or three colours.
- Column count matches the paper size and orientation, and the reading order is
  unambiguous.
- All fonts embedded (`pdffonts`).

## Production workflow

1. **BRIEF** — the venue and stock (A0/A1, portrait/landscape), the viewing
   distance it implies, the three things a passer-by must take away, and the
   QR/contact destination. Posters are read standing up, at speed, once.
2. **DESIGN** — the palette and the type ladder from the viewing distance
   (below), decided before the first block is placed.
3. **EDIT** — extract the roles: claim (the title), evidence (the figures),
   method (one short block), context (authors, affiliation, logo). Everything
   else is a handout, not a poster.
4. **BUILD** — the canvas in `creative-fixed-canvas.md` at poster dimensions,
   blocks placed on the grid.
5. **PREFLIGHT** — render at reduced scale *and* at 100 % on a detail region:
   reduced scale shows the composition, 100 % shows whether the body text
   survives its own size.
6. **DELIVER** — print PDF with bleed, plus a screen version for the virtual
   session most conferences now run.

## Block budget

A poster is a fixed set of blocks on a grid, in reading order:

| block | share of the canvas | content |
| --- | --- | --- |
| title band | 10–15 % | title, authors, affiliation, logo |
| the claim | 10 % | one sentence, display size |
| figures | 40–50 % | 2–4 figures, each with a one-line takeaway |
| method / results text | 20–25 % | short blocks, 24–32 pt |
| footer | 5 % | contact, QR, grant number |

Blocks that do not fit are cut, not shrunk below the ladder's minimum.

## Colour at poster scale

- Large fields of saturated colour band in print; prefer deep tones with the
  accent used sparingly, or a light field with dark ink.
- Colour blocks (not rules) separate sections — a hairline that reads at A4
  vanishes at A0.
- Contrast is checked at viewing distance: print a test strip at final size and
  look at it from two metres before committing.

## Common poster failures

- Body text set at document size (10–11 pt) — unreadable from arm's length.
- A figure that was designed for a paper and scaled up: its labels scale with
  it and become blocky. Re-make figures for the poster canvas.
- The QR code placed where the poster will be rolled or folded.
- No clear reading order: the eye enters at the title and must be able to walk
  the grid without doubling back.
