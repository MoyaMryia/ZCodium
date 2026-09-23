# Brief — Fixed-canvas creative documents

Applies to documents whose page is a designed surface with exact dimensions and
no reflow: certificates, form letters on letterhead, slides exported as PDF,
social-format exports, infographic posters. The page size is part of the
specification; every element is placed against it.

The method is the same editorial-then-components approach as `creative.md` —
read that file for the reasoning behind each component. This brief covers what
changes when the canvas is fixed: the geometry is a requirement, nothing
reflows, and autofit never saves you.

## Specify the canvas before anything else

- **Exact size in real units**: A4 landscape 297 × 210 mm, a certificate at
  210 × 297 mm, a slide at 13.333 × 7.5 in (16:9) or 10 × 7.5 in (4:3), a
  social export at 1080 × 1080 px at 300 dpi. The size is a requirement, not a
  default.
- **Safe margin, then bleed.** Nothing that carries meaning goes inside ~10 mm
  of the trim edge; full-bleed prints extend artwork 3 mm past it. Text stays
  inside the safe margin always.
- **One canvas per file**: never mix page sizes in one PDF.
- **Absolute placement is the point**: a `tikz` overlay against `current page`,
  CSS absolute layers on a fixed-size page box, or the generator's own
  coordinate system. Snap every element to the grid — two elements 3 mm off
  alignment read as a mistake even when each is individually fine.

## Phase 1 — the editorial eye (content transformation)

Design starts by cutting. A fixed-canvas document is read once, at a distance,
and judged in seconds.

### 1. The word budget

| element | budget |
| --- | --- |
| headline | ≤ 12 words |
| standfirst / lede | ≤ 40 words |
| section leads | ≤ 25 words each |
| body blocks | ≤ 80 words each |
| captions | ≤ 20 words |
| stat callouts | number + ≤ 8 words |

The budget is a hard constraint. A canvas that needs 300 words of body copy is
a flowing document, and it wants `creative.md`.

### 2. Typographic hierarchy extraction

- **the claim** — the one sentence the page exists to make (the headline);
- **the evidence** — the numbers, the before/after, the quote that backs it;
- **the context** — who, when, where, source;
- **the detail** — everything else, most of which does not survive.

If two items claim the same role, the content is not decided yet.

## Phase 2 — the component lexicon

The same lexicon as `creative.md` — `Hero_Typography`, `Glass_Canvas`,
`Floating_Meta`, `Hairline_Divider`, `Stat_Block`, `Image_Asset`,
`Page_Ghost_Number`, `Delta_Widget`, `Process_List`, `Sidenote_Block` — with
three fixed-canvas differences:

### Measurement replaces reflow

Nothing reflows, so nothing can be "roughly right". Measure the longest string
at the chosen size before committing: a headline that wraps to an unplanned
second line on a certificate is a redesign, not a tweak. Text boxes get their
final size at layout time — never rely on autofit to shrink text into a box
that was drawn too small.

### Type scale is a distance decision

A certificate is read at arm's length, a poster from two metres, a slide from
the back of a room. Set the ladder from the viewing distance first:

| canvas | body | display |
| --- | --- | --- |
| A4 document | 10–11 pt | 28–40 pt |
| slide (16:9) | 18–24 pt | 40–72 pt |
| poster (A0) | 24–32 pt | 90–150 pt |

### Elements are drawn, not flowed

Forms and certificates: variable fields (name, date, serial) get defined zones
with the type style fixed per zone; signature lines are drawn elements with
measured space, not underscores. Letterhead: logo lockup, address block and
rule placed on the grid, with the body area reserved before the letter text is
written. Data one-pagers: the headline metric in display size, supporting
numbers in a small table, one chart at most.

## Composition rules

- Grid first: margins, columns, gutter, and the fixed positions every component
  snaps to.
- One accent per canvas; the accent marks the thing the eye lands on.
- Hierarchy in three levels: hero → section leads → detail.
- White space is sized: margins and gutters are components, not leftovers.

## Verify by rendering

- Render to PNG at the intended viewing size and inspect: overflow past the
  safe margin, collisions, elements snapped to the wrong grid line, text that
  vanished behind an overlay.
- Verify the exported page box is the specified size — "A4 instead of
  1080 × 1080 px" is the most common fixed-canvas failure.
- For print: confirm the bleed boxes exist in the PDF and that no text sits in
  the bleed zone.
