# Brief — Creative documents

Applies to the visual one-pager family: infographic reports, visual briefs,
one-page summaries, campaign documents. `creative-fixed-canvas.md` is the
sibling brief for exact-dimension pages (certificates, slides-as-PDF); this one
is for designed pages whose size is conventional (A4/Letter) but whose layout is
a canvas, not a column.

The method below is the editorial-then-components approach: transform the
content into a budgeted set of typographic roles, then map those roles onto a
fixed component lexicon. Type and colour decisions follow the public guidance
in `beautiful-web-type` (MIT) and `awesome-latex-drawing` (MIT); see the plugin
`NOTICE.md`.

## Phase 1 — the editorial eye (content transformation)

Design starts by cutting. A creative document is not the report with colours;
it is the report reduced to what survives being read once, at a distance.

### 1. The word budget

Write the budget before the layout, in words:

| element | budget |
| --- | --- |
| headline | ≤ 12 words |
| standfirst / lede | ≤ 40 words |
| section leads | ≤ 25 words each |
| body blocks | ≤ 80 words each |
| captions | ≤ 20 words |
| stat callouts | number + ≤ 8 words |

The budget is a hard constraint, not guidance. A document that needs 300 words
of body copy is a report, and it wants `briefs/report.md`.

### 2. Typographic hierarchy extraction

From the source material, extract the roles that exist and discard the rest:

- **the claim** — the one sentence the page exists to make (the headline);
- **the evidence** — the numbers, the before/after, the quote that backs it;
- **the context** — who, when, where, source;
- **the detail** — everything else, most of which does not survive.

Mark each extracted item with its role before designing anything. If two items
claim the same role, the content is not decided yet — decide, then design.

## Phase 2 — the component lexicon

A fixed set of components, each with one job. A page is an arrangement of
these, never a free-form collage. The lexicon is the design system; adding a
component means adding it here first.

### `Hero_Typography`

The headline block. Display size from the type ladder (54–96 pt on A4), tight
leading (0.95–1.1), left-aligned unless the composition says otherwise. One
claim per hero. The block reserves its measure; a headline that wraps past
three lines means the claim is two claims.

### `Glass_Canvas`

A translucent panel (85–92 % opacity over the background) that carries text
over an image or a colour field. The scrim is a contrast device: behind it,
text must clear the contrast floor on its busiest area, not on average.
Corner radius and border stay consistent across the document — one value,
reused.

### `Floating_Meta`

The metadata strip: date, author, reference number, category. Small type
(9–10 pt), letter-spaced, muted colour, positioned at a fixed offset from the
hero. It is the element readers use to date the document, so it never moves
between pages of a series.

### `Hairline_Divider`

A 0.5–1 pt rule in a support tone, separating sections without a box. Spacing
around it is fixed (one measure above, one below). Dividers mark section
boundaries only — never decorative.

### `Stat_Block`

One number and its label. The number is set in display size, the label in
small caps beneath; the unit rides with the number. A stat block carries
exactly one metric — three stat blocks carry three metrics, arranged on the
grid, not stacked into one.

### `Image_Asset`

A placed image with a defined crop and a fixed aspect. Full-bleed within its
grid cell or inset with a caption band — one treatment per document. Every
image is referenced or captioned; an uncaptioned image reads as filler.

### `Page_Ghost_Number`

An oversized page number or section marker set in a tint of the field colour,
used as a compositional anchor. Decorative by definition, so it never carries
meaning the document depends on.

### `Delta_Widget`

A before/after or change indicator: two values and the delta between them,
with the direction carried by an arrow or a sign — never by colour alone.

### `Process_List`

A numbered sequence of 3–7 steps, each a short label plus one line. Steps are
the document's process claims; if a step needs a paragraph it is a section,
not a step.

### `Sidenote_Block`

A marginal note in small type, aligned to the grid's outer column, holding
context that would break the main flow. One per page region at most; a page
with four sidenotes is a two-column document that has not admitted it.

## Composition rules

- **Grid first**: margins, columns, gutter, and the fixed positions every
  component snaps to. Components without a grid drift between pages.
- **One accent per page**: the accent marks the thing the eye lands on; two
  accents halve the emphasis of both.
- **Hierarchy in three levels**: hero → section leads → detail. If everything
  is bold, nothing is.
- **White space is sized**: the margins and guters are components, not
  leftovers.

## Delivery

- Render to PNG at print scale and inspect all four edges: overflow, collisions,
  elements past the safe margin, text that vanished under an overlay.
- Export at 300 dpi for print, or at the exact pixel canvas for screen; check
  the PDF's page box is what was specified.
- Embed fonts, or confirm the text is still selectable when it should be.
