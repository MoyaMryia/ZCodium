# Brief — Reports and technical documents

Applies to reports, technical documents, white papers, manuals, theses and
academic papers that have no publisher-supplied template. When the venue does
supply a class, use it and borrow only the figure, float, caption and
bibliography parts of this brief.

## Page setup

- A4 (210 × 297 mm) or US Letter, decided by where the document will be read and
  printed — not by the author's own habit. Never mix the two across a document.
- Outer margins 2.5 cm, inner margin 2.5 cm plus a binding offset of 8–12 mm when
  the document will be bound or stapled. Margins below 2 cm on a report read as
  cramped and leave no room for a reader's annotations.
- `\usepackage[a4paper,margin=2.5cm,bindingoffset=8mm]{geometry}`. Set this once
  and stop; `\textwidth` is the number every figure and table is sized against.

## Type and page furniture

- A serif text face for the body — the shapes hold up over long stretches of
  reading. A sans face for headings, or a matching sans throughout for a document
  that will be read on screen. Two families, no more.
- Body size 10–11 pt. Leading around 1.5 for a draft or a review copy, 1.15–1.3
  for a final document that will be read on paper. Set it explicitly with
  `\linespread{1.25}` or `setspace`'s `\onehalfspacing` rather than relying on the
  class default, which varies.
- `\usepackage{microtype}` — protrusion and expansion. It is the cheapest single
  improvement to justification and costs nothing visually.
- Justified body text with hyphenation enabled (`babel` / `polyglossia`). A report
  set ragged-right loses the column shape that makes dense text navigable.

## Structure

- `\section` → `\subsection` → `\subsubsection` in order, never skipping a level.
  The numbering is what a reader uses to cite the document; a skipped level is
  visible even when the numbers look plausible.
- Front matter on its own pages with roman numeral page numbers
  (`\pagenumbering{roman}`), the body restarting at arabic 1
  (`\pagenumbering{arabic}`). Without the restart, the cover is page 1 of the
  body and every later reference is off by the length of the front matter.
- `\tableofcontents` in the front matter, `\listoffigures` and `\listoftables`
  only when the document has enough of them to be worth navigating by — eight or
  more. Two of these lists on a six-page report is noise.
- A title page carrying the title, the author, the date and, where it matters, an
  abstract or an executive summary. Keep it in its own section so it can carry its
  own page numbering.

## Figures and tables

- `\caption` **below** a figure and **above** a table. Readers navigate by this
  convention; inverting it makes a caption read as a stray heading.
- `\label` immediately after `\caption`, never before, and always prefixed
  (`fig:`, `tab:`, `eq:`, `sec:`). A label placed on the float itself resolves to
  the enclosing section counter and produces silently wrong references.
- Numbered continuously through the document, or per chapter with
  `\counterwithin` — pick one and keep it. Cross-reference every figure and table
  from the body text; a float that nothing points at is decoration.
- `[htbp]` placement, with `\FloatBarrier` (`placeins`) at the end of each section
  so a float stays near the text that introduces it. A document whose figures all
  collected at the end got deferred floats, not a long build.
- Tables built with `booktabs` rules: three horizontal rules, no vertical lines,
  no boxed grid. Vertical rules and heavy boxes make a table harder to read, not
  more precise.
- A table or figure wider than `\textwidth` is a defect, not a layout choice.
  Resize the content, use `tabularx` or `longtable`, or rotate the float with
  `sidewaystable` — never `\resizebox` a table down until its type is smaller than
  the body text.
- A table that spans pages uses `longtable`, with the header row repeating. A
  multi-page table built from a plain `tabular` loses its header on every page
  after the first.

## Headers and footers

- `fancyhdr`, or `scrlayer-scrpage` if the document uses a KOMA-Script class.
  Keep the running head short: chapter or section title on one side, page number
  on the other.
- No running head on the title page. `\thispagestyle{empty}`.
- Page numbers in the footer, not the header, when the document is likely to be
  printed double-sided — a header page number sits under a thumb.

## Bibliography

- `biblatex` with `backend=biber` for anything new. `natbib` with `bibtex` when
  the venue or a collaborator requires it. One system per document; mixing them
  produces two bibliography sections.
- Cite with `\cite` / `\parencite` / `\textcite` rather than typing `[12]` by
  hand, so the numbering survives reordering.
- Every entry cited in the text appears in the bibliography and vice versa. A
  bibliography entry nothing cites means a `\cite` was dropped in editing.
- `\printbibliography` in the back matter, after the appendices, unless the venue
  asks for it before them.
- `latexmk` runs `biber` for you. A bibliography that prints `[?]` means the
  bibliography tool never ran or ran too early — rerun the build, do not edit the
  source.

## Self-check before handing this over

- Page count and page size match the target stock (`pdfinfo`).
- Every font embedded (`pdffonts`, `emb` = `yes`).
- No overfull `hbox` running past the text block; the few that remain are short
  URLs, not whole lines.
- Table of contents entries present, nesting matching the headings they point to,
  no placeholder page numbers.
- Front matter in roman numerals, body restarting at arabic 1, no page number on
  the cover.
- No figure or table stranded from the text that references it; no blank page.
- Every figure and table cross-referenced; no orphan bibliography entries.

## Production workflow

The sections above are the specification; this is the order to produce it in.

1. **BRIEF** — one paragraph each: audience, reading context (screen/print/
   bound), page budget, figure budget, and the document's single claim. A
   report without a written claim becomes a data dump with headings.
2. **DESIGN** — the palette and font plan, decided before the first section is
   written (below).
3. **EDIT** — transform the source material into typographic roles before
   typesetting anything (below).
4. **BUILD** — the pipeline in SKILL.md §5, against the geometry set in step 1.
5. **PREFLIGHT** — render every page, run `pdf_qa.py`, read the log.
6. **DELIVER** — the final PDF plus the source tree; check the page count
   against the budget one last time.

## Step 2 — DESIGN: palette and font plan

### Generate the palette before writing

Three to five colours in fixed roles, chosen from the subject rather than from
habit (`typesetting/palette.md` carries the method):

| role | job |
| --- | --- |
| ink | body text — near-black, never pure black on paper |
| field | the page background |
| support | table rules, panel fills, secondary surfaces |
| accent | the one thing that means "look here" |

Write the palette into the preamble as named `\definecolor` entries; a hex
literal in the body is a decision that escaped the plan.

### Colour application rules

- Section headings and rules carry the accent; body text is ink; panels and
  rules are support tones.
- One accent per document. A second accent colour halves the emphasis of both.
- Tables: `booktabs` rules in a support tone, header row on a panel fill, no
  vertical lines.
- Charts inherit the palette: one series in the accent, the rest in greys.

### Forbidden

- Rainbow section headings, one hue per chapter.
- Accent on more than a handful of elements per page.
- Colour as the only signal ("the red rows are late").
- Tinted full pages without checking the print bleed.

## Step 3 — EDIT: content transformation

### Typographic role extraction

Before typesetting, mark each block of source material with its role: claim,
evidence, context, or detail. Blocks that cannot be classified are the ones to
cut — they are the reason reports run long.

### Section pacing

- One idea per section, and the section's first sentence states it.
- Alternate dense and open pages; a document where every page carries the same
  weight reads as a wall.
- A section that fits on one page stays on one page (`needspace` before its
  heading); a section that spans pages repeats its context in the running head.

## Character safety rule

Typeset documents break on characters the font does not cover:

- Non-Latin text (CJK, Cyrillic, Greek) forces the engine choice — XeLaTeX or
  LuaLaTeX with the faces named explicitly (`configs/fonts.md`).
- Symbols from `amssymb`/`unicode-math`, never from a font's private-use area.
- A build that succeeds but prints tofu boxes is a font-coverage failure, not a
  success; `pdffonts` on the output is the check.

## Font setup

### Allowed fonts only

Fonts that exist on the build machine, declared in the preamble, with the
fallback chain spelled out (`configs/fonts.md` and `env_setup/font_list.txt`
list the safe families). A font named but not installed is a substitution, and
the substituted metrics re-wrap every line — the classic "it looked fine on my
machine" defect.

### Registration template (XeLaTeX/LuaLaTeX)

    \setmainfont{TeX Gyre Pagella}
    \IfFontExistsTF{Noto Serif CJK SC}{%
      \newfontfamily\cjkfont{Noto Serif CJK SC}%
    }{%
      \newfontfamily\cjkfont{WenQuanYi Micro Hei}%
    }

### Font configuration by document type

| document | body | headings |
| --- | --- | --- |
| technical report | serif (Pagella, Libertinus) | matching sans or same family |
| thesis | serif, per the institution's template | as the template dictates |
| screen-first document | sans throughout | same family, heavier weight |
| CJK document | the named CJK face + Latin companion | same |

## Chinese plot PNG method

Matplotlib figures with Chinese labels need the face named in the plotting
script, not in the document:

```python
import matplotlib
matplotlib.rcParams["font.sans-serif"] = ["Noto Sans CJK SC", "WenQuanYi Micro Hei"]
matplotlib.rcParams["axes.unicode_minus"] = False
```

Without `axes.unicode_minus = False` the minus sign renders as tofu. Export at
300 dpi at the final placed size, and check the PNG — not the terminal — for
missing glyphs.
