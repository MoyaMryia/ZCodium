# Covers

The cover as page 1: what it must carry, how it is built, and how it is checked.
A cover is a fixed-canvas page (see `briefs/creative-fixed-canvas.md`) that
happens to be generated — treat it as a designed surface, not as a title page
the class produced.

## What a cover carries

- Title, subtitle (when there is one), author or owner, date or version.
- For reports and proposals: the commissioning party, a reference number, a
  confidentiality marking when the document needs one.
- For theses: degree, institution, department, supervisors — in the order the
  institution's template specifies.
- Nothing else. A cover is not a table of contents and not a summary.

## Build paths

- **`cover_render.py`** (SKILL.md §6.6): the cover as an HTML page rendered to
  PDF, prepended to the document. The productive path when the cover is
  designed — CSS gives real layout, real fonts, gradients and absolute
  placement.
- **LaTeX title page**: `\maketitle` with a custom `\title`/`\author`, or a
  hand-built title page with `tikz` overlay against `current page`. Right when
  the cover must inherit the document's fonts and colours exactly.
- Either way the cover is page 1 of the final PDF and the body's page numbering
  accounts for it (`\setcounter{page}{2}` after the cover, or the cover counted
  as page 1 — decide once and be consistent).

## Layout rules

- One grid, from `creative.md`: title block, meta block, and a visual zone
  (colour field, image, or diagram) placed on the canvas, aligned to the same
  grid the rest of the document uses.
- Type scale from the document's ladder; the title is the largest type in the
  document, and the meta block is the smallest.
- The title's measure is the constraint: a title longer than three lines needs
  a smaller display size or a subtitle split, not a smaller margin.
- Safe margin applies even to a cover — nothing meaningful within ~10 mm of the
  trim edge; full-bleed backgrounds extend past it.
- Institution or brand lockups go where the brand's own guidelines put them,
  not where the grid has room.

## Checks

- Render the cover alone to PNG and read it as an image: overflow, collisions,
  the title colliding with the meta block, a logo that lost its aspect.
- Verify the final PDF's page count and that the cover is page 1 with the body
  starting on page 2 (or the numbering the document declares).
- For print: bleed boxes present in the PDF, no text in the bleed zone, and the
  cover's paper stock accounted for in the page count.

## Common failures

- The class's default `\maketitle` left in place with a custom cover appended —
  two title pages in one document.
- Cover fonts differing from the body fonts because the cover was built in a
  different tool without matching the family.
- A date or version that disagrees with the body's title page.
- A full-bleed background that stops 5 mm short of the edge — the most common
  tell of a cover built without a bleed specification.
