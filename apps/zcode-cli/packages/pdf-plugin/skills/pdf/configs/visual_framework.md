# Visual framework

The document's design system: the small set of decisions that every page
inherits. Made once, before the first section is written; recorded in the
preamble so the document can be re-themed by changing one block.

## The decisions

| decision | values to choose between | recorded as |
| --- | --- | --- |
| paper | A4 / Letter / A5, orientation | `geometry` options |
| text block | margins, binding offset, `heightrounded` | `geometry` options |
| families | one serif or sans for body, one for headings | `fontspec` / font packages |
| type scale | display / section / body / caption sizes | `titlesec` + class options |
| palette | ink, field, support, accent | `\definecolor` block |
| emphasis | the one accent rule (headings, rules, or both) | preamble comment |
| components | the catalogue in `components.md` | preamble environments |

## Rules that make it a system

- **One palette block, one type-scale block.** A hex literal or a font size in
  the body is a decision that escaped the system; the next re-theme will miss
  it.
- **One accent, used sparingly.** Section rules and headings, or the accent in
  figures — not everything at once. If everything is accented, nothing is.
- **Consistent component usage.** The same callout environment everywhere, the
  same table style, the same caption position (below figures, above tables).
- **The framework survives re-theming.** Changing the palette block and the
  family lines should re-skin the whole document. If it does not, something was
  hard-coded in the body.

## Document-specific calibration

| document kind | framework notes |
| --- | --- |
| report / thesis | conservative palette, serif body, numbered sections, front matter in roman numerals |
| academic paper | the venue's class \emph{is} the framework; override nothing |
| resume / CV | see `references/resume-*.tex` for two complete frameworks |
| creative one-pager | the canvas is the framework — see `briefs/creative.md` |
| process document | sans body at 10–11pt, code blocks prominent, numbered steps in the margin |

## Recording it

A short comment block at the top of the preamble, naming the six decisions and
where each lives. It costs five lines and answers every "why is this 10pt?"
question a future editor will have.
