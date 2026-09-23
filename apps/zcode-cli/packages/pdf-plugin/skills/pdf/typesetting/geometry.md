# Page geometry

The numbers every other decision is measured against. Set them once, in the
preamble, and treat `\textwidth` / `\textheight` as the contract every figure,
table and full-width environment is sized to.

## Paper and orientation

| size | mm | use |
| --- | --- | --- |
| A4 | 210 × 297 | default almost everywhere outside North America |
| US Letter | 216 × 279 | North American business and academic documents |
| A5 | 148 × 210 | booklets, handouts |
| legal | 216 × 356 | contracts in jurisdictions that use it |

Decide by where the document is read and printed, never by author habit. Never
mix sizes in one document — a single stray page size prints wrong and reads as
a defect.

## Margins

- Body documents: 2.5 cm outer, 2.5 cm inner + 8–12 mm binding offset when
  bound or stapled. Below 2 cm reads cramped and leaves no room for a reader's
  annotations.
- Wide-margin documents (thesis drafts, review copies): 3–4 cm inner margin is
  a feature — it is where the reviewer writes.
- Symmetric vs asymmetric: `oneside` documents use symmetric margins; `twoside`
  books mirror them (`inner` grows toward the binding).

    \usepackage[a4paper,margin=2.5cm,bindingoffset=8mm]{geometry}

Set `geometry` once. Changing paper or margins mid-document invalidates every
figure width and forces a full re-check.

## The text block

- `\textwidth` is the number. Figures sized `\textwidth`, tables sized
  `\textwidth`, margin notes sized to `\marginparwidth`.
- Line length lives or dies here: `\textwidth` above ~90 characters on a
  single column means either smaller type, bigger margins, or `twocolumn`.
- `\textheight` should hold a whole number of text lines plus the header and
  footer — `geometry`'s `heightrounded` and the `includeheadfoot` options exist
  for exactly this. A text block that cuts a line in half at the page bottom is
  a geometry bug, not a spacing bug.

## Headers and footers

- `fancyhdr` (or the class's own page style) for running heads and folios.
  Chapter/section name on one side, page number on the other; `\pagestyle`
  switched to `plain` on chapter-opening pages only when the class does it for
  you.
- Front matter in roman numerals, arabic from the main body
  (`\pagenumbering{roman}` … `\pagenumbering{arabic}`). A thesis whose abstract
  is page 1 has the numbering wrong.

## Special pages

- Full-bleed and overlay pages (covers, wide figures): `geometry`'s
  `\newgeometry` per page group, or `tikz` with `remember picture, overlay`
  against `current page` — the latter survives when the page style changes.
- Landscape pages inside a portrait document (`pdflscape`'s `landscape`
  environment, or a rotated PDF page) for wide tables; check the rotation
  direction and that the page number stays readable.

## Checklist

1. Paper size and orientation stated once.
2. Margins with binding offset where needed.
3. `heightrounded` on, text block holds whole lines.
4. Header/footer style set; page numbering scheme correct for front matter.
5. Every figure and table sized against `\textwidth`, not a hard-coded `cm`.
6. Render confirms: no text into the margin, no clipped page bottoms.

## Visual anchors

An anchor is the element a page's composition is built around. Every layout
decision is measured from an anchor, not from the page edge:

- **The type block anchor**: the text block's top-left corner. Everything that
  aligns with the body aligns with it.
- **The optical anchor**: the largest element on the page (usually the display
  headline or the main figure). The eye lands there first; the composition is
  judged from it.
- **The baseline anchor**: a shared baseline grid across columns and pages.
  Text that shares a baseline grid reads as one document; text that does not
  reads as blocks that happen to be near each other.

Choosing the anchor is the first layout decision; placing elements before the
anchor exists is what produces the drift a reviewer flags.

## Basic shape vocabulary

The shapes a composed page is built from, in the order they appear:

| shape | role |
| --- | --- |
| rectangle / column | the default container; the grid's unit |
| full-bleed field | the background statement; carries no content itself |
| rule | separation at the lightest weight |
| arc / curve | movement and flow; the only non-rectilinear element |
| angle / slash | dynamism; a diagonal cut across a static composition |
| circle / badge | a point of emphasis; a number, a seal, an icon |

Two or three of these per page is a composition; six is a collage.

## Composition patterns

### Pattern 1 — Offset stacking

Two or more blocks sharing an edge, offset by a fixed step (a column width, a
baseline, or a fraction of the block). The offset is constant across the
document — that is what makes it a pattern rather than an accident.

### Pattern 2 — Scale contrast

One element at display scale against the rest at body scale, with nothing in
between. The gap is the point: intermediate sizes dilute both ends.

### Pattern 3 — Grid intersection

Elements aligned to a visible or implied grid, with one element deliberately
breaking it — a full-bleed field, an oversized number, a rotated label. One
break per composition; two and the grid is gone.

### Pattern 4 — Arc flow

A curved element (an arc, a circle segment, a curved rule) carrying the eye from
the entry point to the content. The arc is a path, not a decoration: it must
start where the eye enters and end where the content begins.

### Pattern 5 — Geometric collage

Blocks overlapping at fixed angles, sharing transparency levels. The highest
-risk pattern: it needs a strict palette (`palette.md`) and a fixed overlap
order, or it reads as noise. Use it when the content is genuinely fragmented —
a portfolio index, a mood board — not to make a text document look designed.

## Applying the patterns

1. Choose the anchor.
2. Choose one pattern.
3. Place the content blocks against it.
4. Render and check: does the eye enter where intended, and does it reach the
   content without doubling back?
5. If the answer is no, change the pattern — not the content.
