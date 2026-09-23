# Cover backgrounds

The visual zone of a cover page (see `cover.md`): colour fields, gradients,
images and the geometry that keeps them from failing in print. A background is
the element most likely to survive the build broken, because nothing in the
source shows the edge.

## Build it in the right layer

- **HTML/CSS covers** (`cover_render.py`): backgrounds are CSS — a colour
  block, a linear gradient, or an `<img>` sized to the page box with
  `object-fit: cover`. Gradients rasterise cleanly and print predictably.
- **LaTeX covers**: `\pagecolor` for a full tint, `tikz` overlay for shapes and
  gradients, `\AddToShipoutPicture*` (`eso-pic`) for a full-page image. A
  background image must be placed at the paper size, not the text block.

## Full-bleed geometry

- The background covers the **paper**, not `\textwidth`. In LaTeX that means
  positioning against `current page` in a `tikz` overlay, or `\pagecolor` with
  the stock's bleed in mind.
- Print: extend the background 3 mm past the trim on every side (bleed). Text
  stays inside the ~10 mm safe margin. A background that stops at the trim edge
  shows as a white hairline on any trim variance.
- Screen: no bleed, and the background fills the export canvas exactly — check
  the PDF's page box is the specified size, not A4 by default.

## Images as backgrounds

- Resolution: 300 dpi at placed size. A photo stretched past its native
  resolution is mush at print size even when it looks fine on screen.
- `object-fit: cover` / a crop that survives the aspect change: crop for the
  frame, never letterbox. A background image with visible bars is a defect.
- Text over an image needs a scrim: a semi-transparent overlay, a gradient
  wash, or a solid panel behind the text block. Contrast against a busy photo
  is checked in the render, not assumed.
- Colour-profile mismatch between image and PDF is a print-shift risk; keep the
  image in sRGB for screen exports and convert deliberately for print.

## Gradients and fields

- Vertical or diagonal gradients only. Radial gradients on a cover read as a
  decade stamp.
- Banding in print: smooth gradients over large areas band on press. A subtle
  noise texture or a hard split avoids it; check a proof for anything critical.
- A colour field occupying 40–60% of the page with the rest negative space is
  the reliable composition; the field carries the accent, the text sits on the
  quiet part.

## Checks

- Render the cover to PNG at print scale and inspect all four edges: the
  background reaching them, text staying inside the safe margin, no collision
  between the background's busy area and the title.
- `check_bounding_boxes.py` confirms content boxes against the page box; the
  visual gate in SKILL.md §6.5 is the final word.

## Z-order and clipping

A cover background is a stack of layers, and the failures are always
layer-order or clipping failures:

- **Render order is the z-order**: background field → image → scrim → text.
  Text is always last. On the HTML path (`cover_render.py`) that is document
  order plus `z-index`; in LaTeX it is a `tikz` overlay's drawing sequence.
- **The scrim is a contrast layer, not decoration**: a semi-transparent panel
  between a busy image and the text, sized so the text clears the contrast
  floor on the image's *busiest* area, not its average.
- **Clipping**: an image that must fill a shape is clipped to the shape, never
  squashed. `object-fit: cover` in CSS, `\clip` in TikZ. Letterbox bars are a
  defect, not a fallback.
- **Bleed is a layer property**: the background layers extend past the trim;
  the text layer does not. A background that stops at the trim shows as a white
  hairline under any trim variance.

## Supergraphics

Large geometric statements that carry the cover's identity when there is no
photography:

- **The bleeding circle**: a circle whose edge runs off the page on at least
  one side, sized to the canvas (a diameter of roughly half the page's smaller
  dimension works as a default). It is a field, not a badge — nothing sits
  "inside" it unless the composition says so.
- **The angle slash**: a diagonal cut across the canvas, splitting it into two
  fields. The angle is fixed (30–45°) and reused across a document family; a
  different angle per cover breaks the family.
- Both are palette statements: one carries the accent, the other is the field.
  Neither carries text unless the contrast check passes on the overlap.

## Typographic watermarks

An oversized glyph, word or number set in a tint of the field colour, used as a
compositional anchor:

- The tint is the whole device: 5–10 % of the ink colour. Above that it competes
  with the text; below that it disappears.
- It is decorative by definition — never the only carrier of meaning. If the
  document still works with the watermark removed, it is a watermark; if not,
  it is content that has been hidden.
- One per cover. A watermark behind body text on every page is a pattern that
  should have been a style.
