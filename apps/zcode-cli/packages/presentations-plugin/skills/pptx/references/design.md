# Slide design guidance

Design decisions for a deck built from scratch. This file carries the working
detail; `SKILL.md` §5–§6 carry the workflow that calls it. Nothing here depends
on a particular generator library — the decisions are about the deck.

---

## 1. Decide before you build

Four decisions, made once, before the first slide exists:

1. **Audience and room.** A board room seen on a laptop and a hall seen from the
   back row are different documents. The room sets the minimum body size, the
   contrast floor, and how much a slide may carry.
2. **Content shape.** How many ideas, how much evidence each needs, whether the
   deck is read or presented. One idea per slide is the default; a section
   divider is not an idea.
3. **Palette.** Three to five colours: a dominant field colour, one or two
   supporting tones, one accent that means "look here". More than five and
   nothing stands out.
4. **Type scale.** Title, subtitle, body, caption — in points, on the slide.
   Fix the scale before placing text so every slide inherits it.

Write the four decisions down and check every later choice against them. Most
"this looks off" reports are a violation of a decision nobody wrote down.

## 2. Palette selection

**Start from the subject, not from a default.** Ask what the topic is, what
industry it belongs to, what mood it needs, who is listening, and whether the
user named a brand. A finance deck does not have to be navy; a health deck does
not have to be green; the autopilot choice is the one the audience has already
seen a hundred times.

**Build the palette in roles, not in swatches:**

| role      | job                                                        |
| --------- | ---------------------------------------------------------- |
| field     | the background most slides sit on (often a near-white or a deep tone) |
| support   | secondary surfaces: panels, table headers, chart series 2..n |
| ink       | body text; must clear the contrast floor on the field       |
| accent    | the one thing per slide the eye should land on              |

**Check contrast before committing.** Text on its background needs a clear
ratio; an accent that cannot carry white text is a decoration, not a button.
Colour-blind safety matters more than taste: never let red and green alone
carry a distinction, and keep series distinguishable in greyscale.

**Reference palettes** (starting points to adapt, not prescriptions):

- Navy field `#1C2833`, slate `#2E4053`, silver `#AAB7B8`, off-white `#F4F6F6`
- Teal `#5EA8A7`, deep teal `#277884`, coral `#FE4447`, white
- Cream `#FFE1C7`, forest `#40695B`, near-white `#FCFCFC`
- Burgundy `#5D1D2E`, crimson `#951233`, rust `#C15937`, gold `#997929`
- Charcoal `#292929`, red `#E33737`, light grey `#CCCBCB`
- Sage `#87A96B`, terracotta `#E07A5F`, cream `#F4F1DE`, charcoal `#2C2C2C`
- Purple `#B165FB`, dark blue `#181B24`, emerald `#40695B`, white

Two rules that survive any palette: **one accent per slide**, and **the deck
uses one palette** — a second accent colour needs a reason a viewer can name.

## 3. Visual details

Small structural devices, in rough order of how much they buy:

**Geometry and layout**

- Asymmetric column splits (30/70, 40/60) instead of even halves.
- Diagonal section dividers instead of a horizontal rule.
- A sidebar column (20–30% width) carrying navigation or context.
- Modular grids: 3×3 or 4×4 blocks for agenda, roadmap, comparison slides.
- Full-bleed image with a text overlay, where the image actually supports the claim.
- Negative space as a decision, not as leftovers.

**Emphasis devices**

- Extreme size contrast: a 60–72pt headline against 14–18pt body.
- All-caps headers with wide letter spacing; numbered sections in display type.
- Underline accents beneath headers (3–5pt), corner brackets instead of full frames.
- Monospace for data, code and identifiers; a condensed face for dense tables.
- Outlined text for emphasis — sparingly, it ages fast.

**Chart and data styling**

- One series in the accent colour, the rest in greys.
- Data labels directly on the marks; a legend only when marks cannot be labelled.
- Horizontal bars beat vertical bars for long category names; dot plots beat bars for small counts.
- Minimal gridlines or none; no 3-D anything; no dual axes on one plot.
- An oversized number for the one metric that matters.

**Backgrounds**

- A solid colour block occupying 40–60% of the slide.
- Split backgrounds (two colours, vertical or diagonal).
- Vertical or diagonal gradients only; radial gradients read as 2010.

## 4. Layout rules for content slides

When a slide carries a chart, table or figure:

- **Two-column layout is the default.** Header spans the full width; text in one
  column, the featured content in the other, with unequal widths (40/60 suits
  most chart-plus-commentary slides).
- **Full-slide layout when the content is the point.** One large chart with a
  one-line takeaway beats a chart shrunk beside a bullet list.
- **Never vertically stack** a chart below a paragraph in a single column: the
  chart ends up small, the paragraph long, and both unreadable.

For text slides: one idea, at most six bullets, at most two levels of nesting,
and a sentence where a phrase belongs.

## 5. The consistency pass

After building, before rendering, check:

- Titles occupy the same position at the same size on every content slide.
- One typeface pair, one palette, one accent rule.
- Numbering continuous; no layout used exactly once.
- The same chart type for the same kind of claim across the deck.
- Speaker notes match the slide they belong to.

The pass costs minutes; the review it prevents costs a rebuild cycle.

---

*Design principles and the palette/visual-detail catalogues in this file are
adapted from the `pptx` skill of `appautomaton/document-SKILLs`
(https://github.com/appautomaton/document-SKILLs, MIT License, Copyright (c)
2026 appautomaton); see the plugin `NOTICE.md` for the derivation record.*
