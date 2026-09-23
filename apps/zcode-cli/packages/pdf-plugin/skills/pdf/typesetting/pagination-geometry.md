# Pagination geometry

The arithmetic of the page: text block, margins, and the numbers that decide
whether a page holds what you think it holds. `geometry.md` sets these; this
file is the reference for what they mean and how they interact.

## The page stack

    ┌─────────────────────────────┐  ← paper edge (trim)
    │  bleed (print, 3mm)         │
    │  ┌───────────────────────┐  │  ← top margin
    │  │  header               │  │
    │  │  ────────────────────  │  │  ← headsep
    │  │                       │  │
    │  │      text block       │  │  ← \textheight
    │  │                       │  │
    │  │  ────────────────────  │  │  ← footskip
    │  │  footer / folio       │  │
    │  └───────────────────────┘  │  ← bottom margin
    └─────────────────────────────┘

- `\paperheight` and `\paperwidth` are the paper; everything else is derived.
- `\textheight` is what the body fills; the header and footer live in the
  margins, reached through `\headsep` and `\footskip`.
- `heightrounded` (geometry) rounds `\textheight` to whole lines — without it,
  the last line of a page can be clipped in half.

## Deriving the numbers

With A4 (297 mm), 2.5 cm margins and `includeheadfoot`:

- text block height ≈ 297 − 25 − 25 − header − footer − separators
- at 11 pt with 13.6 pt leading, one line ≈ 4.79 mm → roughly 48–50 lines per
  page on A4 with those margins.

Use the arithmetic to sanity-check a document before building: a thesis chapter
that "should be 20 pages" and computes to 3 means the content, not the layout,
is missing.

## `twoside` mirroring

- `inner` grows toward the binding; `outer` is the trim edge. In a `twoside`
  document, `inner` must include the binding offset — 8–12 mm for a stapled
  document, more for a bound one.
- Odd pages are recto (right-hand), even are verso. `\cleardoublepage` opens
  chapters on a recto, inserting a blank verso when needed.

## Landscape and special pages

- A landscape page inside a portrait document swaps paper dimensions for that
  page group (`\newgeometry` + `\begin{landscape}` with `pdflscape`, or a
  physically rotated page). Headers and folios rotate with it — check they
  remain readable.
- Overlay pages (covers, full-bleed figures) ignore the text block entirely:
  they position against `current page`. See `cover.md` and
  `cover-backgrounds.md`.

## Sizing figures and tables against the block

| width to use | when |
| --- | --- |
| `\textwidth` | full-width floats and tables |
| `\linewidth` | inside a list or `minipage` (the *current* line width) |
| `\columnwidth` | a float in one column of `twocolumn` |
| `figure*`/`table*` | spanning both columns in `twocolumn` |

`\linewidth` is almost always what you want inside an environment; `\textwidth`
is right at the top level. Using the wrong one is the classic "my table sticks
out inside the list" bug.

## Checklist

1. Paper size and orientation stated once.
2. Margins + binding offset for bound output.
3. `heightrounded` on; text block holds whole lines.
4. Header/footer measured inside the margins.
5. Figures and tables sized from the block width, not hard-coded.
6. Render confirms: nothing clipped, nothing into the margin.
