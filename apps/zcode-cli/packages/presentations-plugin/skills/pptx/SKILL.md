---
name: pptx
description: Use whenever a .pptx / PowerPoint deck is the artifact being produced, edited, or reviewed. Covers the OOXML package structure of a deck (presentation part, slide parts, layouts, masters, theme, media, chart parts, embedded workbooks), how to unpack and repack one without breaking content types or relationships, how placeholder inheritance and autofit decide whether text survives a projector, and the defects that make a deck fail in front of an audience — text overflowing its shape, body copy too small to read from the back, charts whose labels vanish, stretched images, letterboxing from a slide size that changed, fonts missing on the presenting machine, and titles drifting between slides. Use it when the user asks to build a deck, add or restructure slides, restyle an existing one, fix a broken file, or review deck quality; and when the reported symptoms are text spilling outside a text box, a chart that renders blank, images that look squashed, a font that fell back on someone else's machine, a table taller than the slide, or a PDF export that lost the design.
---

# PPTX Production

## 1. Scope

This skill is knowledge about `.pptx` decks as OOXML packages: how one is put together, how to change it without corrupting it, and what makes a deck fail in front of an audience.

- structural guidance for building, editing and reviewing decks through whatever generator the task already uses (python-pptx, PptxGenJS, a template filled in by hand, LibreOffice);
- the review route: render slides to page images, then hand them to the `visual-judge` agent, which owns the visual gate.

It does **not** ship a generator (there are no scripts in this plugin), does not validate against the OOXML schemas (a file that opens is not necessarily well-formed), and does not render anything itself (no LibreOffice or PDF pipeline lives here — call the tools on the machine).

## 2. What a .pptx actually is

A `.pptx` is a ZIP of XML parts, not a single document. Reading one means reading a small graph of parts joined by relationships:

| part | what it holds |
| --- | --- |
| `[Content_Types].xml` | a Default or Override for every part by extension or path; a part missing here is invisible to the reader |
| `_rels/.rels` | the package entry point: which part is the presentation |
| `ppt/presentation.xml` | the slide id list, slide size, default text styles, embedded font list |
| `ppt/_rels/presentation.xml.rels` | which slide, master, theme and notes-master parts the presentation points at |
| `ppt/slides/slideN.xml` | one slide's content: shapes, text, pictures, tables, chart frames |
| `ppt/slideLayouts/slideLayoutM.xml` | the arrangement a slide inherits placeholders from |
| `ppt/slideMasters/slideMasterK.xml` | deck-wide background, placeholders and text styles |
| `ppt/theme/themeJ.xml` | the colour scheme, font scheme and effect scheme the master draws on |
| `ppt/media/*` | the actual image binaries the slides reference |
| `ppt/charts/chartN.xml` | a chart's own definition, plus `ppt/embeddings/*.xlsx` as its cached data |
| `ppt/notesSlides/notesSlideN.xml` | speaker notes for a slide |
| `docProps/` | title, author and other metadata |

Two rules follow from the shape and matter more than any tag name:

- **Order is declared, not implied.** Which layout a slide uses is whatever its own `.rels` says, not the next layout in the folder; the slide sequence is the order of the id list in `presentation.xml`, not the slide file names. Renaming or reordering files on disk changes nothing until the relationships are changed too.
- **Every reference is a two-step.** A picture on a slide is a `r:embed` id, that id is a relationship in the slide's `.rels`, and that relationship names the media part. Add a part without both the content type and the relationship and the file opens broken or not at all.

Slide size lives in `presentation.xml` as width and height in EMU (914400 per inch). 16:9 is 12192000 × 6858000, 4:3 is 9144000 × 6858000. Changing it after the fact rescales nothing by itself — shapes keep their coordinates and the deck letterboxes or overflows.

## 3. Working on an existing deck

1. Unpack: `unzip deck.pptx -d unpacked/` — keep `[Content_Types].xml`, `_rels/` and `ppt/` exactly where they are.
2. Edit the parts you need, in place, keeping the namespace prefixes each part declares (`p:` presentationml, `a:` drawingml, `r:` relationships, `c:` chart).
3. Repack with the unpacked directory as the archive root, so `[Content_Types].xml` sits at the top level.

Keep relationship ids unique inside each `.rels` part, and add an Override for every new part type you introduce. A generator library does this bookkeeping for you; hand-editing means you own it.

## 4. Where the design actually lives

Most "the slide looks wrong" reports are really master, layout or theme problems, not slide problems.

- **Placeholders inherit.** A title placeholder on a slide carries a type and index; its position, size and text style come from the matching layout placeholder, and whatever the layout leaves unset comes from the master, and whatever the master leaves unset comes from the theme. Editing the shape on one slide overrides the chain for that slide only, which is how decks end up with one title in the wrong place.
- **Autofit has two flavours and neither is magic.** Shrink-text-on-overflow is a stored scale factor that the editing application computes when it lays the text out; resize-shape-to-fit-text is a stored preference. Generated XML usually carries neither, so a renderer that does not recompute shows the text at full size — outside the shape. Never assume overflow was handled; check the render.
- **Fonts are resolved on the presenting machine.** The theme names a Latin face, an East Asian face and a complex-script face; a name that does not exist there is substituted, and metrics change, which re-wraps every paragraph. Fonts that exist only on the build machine are a defect, not a portability detail.
- **Theme colours are referenced, not copied.** Shape fills point at theme colour slots with optional luminance modifiers, so restyling the theme restyles the deck — and a shape with a hard-coded fill does not follow.

## 5. Building slides

Pick the build path the task already implies and stay with it:

- **Template-driven (python-pptx and friends)**: open an existing deck, write into its placeholders, add shapes through its API. The design comes from the template's master and layouts; do not fight them by absolutely positioning everything.
- **Generated from scratch (PptxGenJS and friends)**: you own layout, so decide the grid first — margins, title band, content area, footer — and place every slide against it. Ad-hoc coordinates per slide are what produce the drift the reviewer will flag.
- **Hand-edited XML**: only for surgical fixes on a deck that already exists, and only after §3.

Whatever the path, decide these before writing the first slide: slide size, the type scale (title, subtitle, body, caption — in points, on the slide, not in the file's internal units), the palette, and how many ideas one slide carries.

## 6. Production workflow

1. **Outline first.** One idea per slide, in an order that survives being read backwards. The outline is the spec; the visual gate checks against it.
2. **Settle the design surface.** Slide size, master or layout choice, type scale, palette, and the grid every slide is placed on.
3. **Build the slides** against that grid, in outline order, reusing layouts instead of re-deriving positions.
4. **Consistency pass.** Titles in the same place at the same size, one palette, one typeface pair, numbering continuous, no orphan layouts. This pass is cheaper than the review it prevents.
5. **Render and gate.** Export the deck to page images and hand them to `visual-judge` with the outline as the brief.
6. **Repair loop.** Act on the verdicts, rebuild, re-render, re-gate. A slide that failed stays failed until the render says otherwise.

## 7. Rendering for review

This plugin renders nothing. On the machine, a LibreOffice conversion followed by a PDF-to-image step produces one PNG per slide, which is what the gate consumes. Two caveats:

- LibreOffice is not PowerPoint. Autofit, effects, and substituted fonts render differently, so a difference between the two is a risk to note, not a defect to invent.
- The gate reads page images only. Handing it a `.pptx` or a PDF where a PNG was expected yields `Unverified`, not a verdict.

## 8. Defects that reach the audience

Grouped by what the viewer notices:

- **Cannot read it.** Body copy below roughly 18pt on a projected slide, hairline borders, light grey on white, white on a pale fill, all-caps paragraphs, and lines long enough that the eye loses its place returning to the next line.
- **Too much on one slide.** Two ideas sharing a slide, bullets nested past two levels, bullet lists that run past about six items, and a paragraph pasted where a phrase belonged.
- **Text does not fit.** Copy spilling outside its shape, autofit that shrank words to nothing, a text box that grew off the slide edge, and a title that wrapped to three lines and pushed the content down.
- **Pictures lie.** Stretched or squashed images because the drawn extent ignored the intrinsic aspect, images cropped so the point is gone, screenshots at a resolution that turns text to mush, and stock filler that has nothing to do with the slide.
- **Charts mislead.** The wrong chart type for the claim, axis labels and legends smaller than the body text, numbers too cramped to read, unlabelled units, a legend detached from its plot, and a chart whose numbers disagree with the sentence next to it.
- **The deck disagrees with itself.** Titles drifting between slides, a typeface or colour that changes without a reason, numbering that restarts, a layout that appears once, and speaker notes that contradict the slide they belong to.
- **It breaks on someone else's machine.** Fonts missing there, letterboxing because the slide size changed, a table taller than the slide, blank slides, and placeholder prompt text left visible because a placeholder was never filled.
- **Leftovers.** Watermarks, placeholder scribbles, "click to add title" prompts, an old logo, and a draft title still on the last slide.

## 9. Pitfalls

- **There is no generator here.** Do not invent script paths in this plugin; use the build path the task already has, or install one.
- **Do not judge a deck from its XML.** Overflow, autofit and font substitution only show up in a render. Build, render, then gate.
- **`sz` is hundredths of a point and extents are EMU.** 1800 means 18pt; one inch is 914400 EMU. Mixing the units is the classic "my text is enormous" bug.
- **Slide order is the id list, not the file names.** Reordering `slideN.xml` files on disk does nothing until the id list and relationships agree.
- **A table cannot repeat a header across slides.** It is not a Word table: rows that do not fit the slide simply run off it, so split the table across slides by hand.
- **Editing one slide's placeholder breaks the chain for that slide only.** Fix the layout or the master when the problem is deck-wide.
- **Charts carry their own parts and a cached workbook.** Editing the cached numbers without the chart definition leaves the two disagreeing.
- **Notes are separate parts.** A slide can look finished while its notes still hold the old story.

## 10. Environment

Content-only skill: no scripts, no bundled assets, no third-party dependencies. Whatever the build path needs (a generator library, LibreOffice for rendering) is expected on the machine, not in this plugin.
