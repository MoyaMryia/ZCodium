# Brief — Creative flow documents

Applies to the multi-page visual family: magazine-style reports, lookbooks,
annual reviews, editorial features — documents with pages that turn, a rhythm
across spreads, and images that share the stage with text. Where
`creative.md` designs a single canvas, this brief designs a *sequence* of them.

## The spread is the unit

- Design in **spreads** (two facing pages), not in pages. A single page of a
  spread is half of a composition; the gutter is a real seam — nothing crosses
  it except a deliberate full-bleed image.
- Fix the grid for the whole document first: margins, column count, and the
  header/footer bands. Every page then places content on that grid, which is
  what makes twenty pages look like one document.
- Alternate the rhythm: dense page, open page, image page, dense page. A
  document where every page carries the same weight reads as a wall.

## Page-level composition

- **Entry points per page.** Each page needs one clear place the eye lands —
  usually the largest image or the display headline. If a page has two
  candidates, it is two pages.
- **Image and text share the grid.** Text wraps a real shape (`wrapfig`,
  CSS `float`/`shape-outside`, or a measured text block) rather than sitting in
  a box beside the picture. Boxes floating beside images are the look of a
  template nobody adjusted.
- **Pull quotes and callouts** break a long text run and give the skim-reader
  the argument. One per spread at most; they are seasoning.
- **Folios and running heads** carry the document's identity: page numbers,
  a section name, a rule. They are part of the design, not an afterthought.

## Pacing across the document

- Open with a full-bleed or near-full-page image and a display headline; close
  the document the same way. The middle carries the content pages.
- Section openers may break the grid (full bleed, inverted colours) — but a
  section opener that looks like a content page wastes the transition.
- Keep captions in one voice and one position family across the document; the
  reader learns the pattern by page three and relies on it after that.

## Text on a flow document

- Body in a serif for long runs, or a sturdy sans for a document read on
  screen; the choice is made once for the whole document.
- Column measure of roughly 45–75 characters; multi-column pages need a visible
  gutter (≥5 mm) or the columns merge.
- Widows and orphans are controlled, not accepted: `\clubpenalty`/
  `\widowpenalty` in LaTeX, `orphans`/`widows` in CSS.
- Drop caps, small caps and rules are accents with a job — marking a section
  opening, not decorating every page.

## Images

- One image treatment per document: full-bleed, grid-aligned, or inset with a
  caption band. Mixing all three without a rule is visual noise.
- Crop for the page, not for the original frame; a portrait image forced into a
  landscape slot with letterbox bars is a defect.
- Raster at 300 dpi at placed size; vector wherever the art allows.
- Every image is referenced or captioned; an uncaptioned image in an editorial
  document reads as filler.

## Delivery

- Render the whole document to page images and read the spreads in order:
  gutter collisions, orphaned headings at page bottoms, images that lost their
  crop, rhythm that flatlines.
- Check the PDF's page count and page order against the outline — creative
  documents are reordered often and silently.

## The pagination model

A flow document's pages are a sequence, and the sequence has rules:

**The iron rules:**

1. **One spread, one composition.** The unit of design is the spread, not the
   page; a page designed alone is half a design.
2. **Content flows, design wraps.** The text decides where it ends; the design
   decides what the page looks like around it. Fighting the flow with manual
   breaks produces a page that is wrong after the next edit.
3. **Entry point per page.** Each page has one place the eye lands. Two
   candidates means two pages.
4. **Rhythm alternates.** Dense, open, image, dense. A document where every
   page carries the same weight reads as a wall.
5. **The gutter is a seam.** Nothing crosses it except a deliberate full-bleed
   image.
6. **Pacing is planned**: open and close the document the same way (full-bleed
   or near-full-page), and let the middle carry the content.

**What not to do:**

- Hand-placed `\newpage` after every section: the break is right for one edit
  and wrong after the next. Use `needspace`, class-level section breaks, or the
  pagination rules in `typesetting/pagination.md`.
- Every page full: a document with no open pages has no rhythm.
- Figures floated wherever they land: a figure belongs near its first
  reference, and the reference is what the reader follows.
- A column grid that changes mid-document: the reader learns the grid by page
  three and relies on it after that.

## CSS template (the HTML path)

When the flow document is built through the HTML path (`html2pdf.py`), the
structure is CSS, and the rules above become properties:

```css
@page { size: A4; margin: 18mm 16mm; }
.spread { display: grid; grid-template-columns: 1fr 1fr; column-gap: 8mm; }
.entry  { font-size: 34pt; line-height: 1.05; }   /* one entry point */
.body   { columns: 2; column-gap: 6mm; }
.pull   { float: right; width: 45%; margin: 0 0 4mm 4mm; }
.full-bleed { width: 210mm; margin-left: -16mm; } /* past the text block */
```

- `columns: 2` for the body with a visible gutter; a single long measure is
  what makes a flow document unreadable.
- `break-inside: avoid` on figures, pull quotes and stat blocks.
- `break-before: page` on section openers only — never on ordinary sections.
- The full-bleed rule is arithmetic: page width minus the text block's left
  offset. A background that stops 5 mm short is the tell of a cover built
  without a bleed specification.

## Body background rule

A tinted page on a flow document:

- The tint reaches the paper edge or it visibly does not — there is no
  in-between.
- Text on the tint clears the contrast floor; a 5–8 % tint is invisible in
  print, a 20 % tint competes with the text on it.
- Alternate tinted and white pages only when the rhythm calls for it; a tint
  on every page is a style that should have been a page colour.
