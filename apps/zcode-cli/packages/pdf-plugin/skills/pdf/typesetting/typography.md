# Typography

The type layer of a typeset document: what to choose, what to set explicitly,
and the failures that show up in the rendered page.

## Choose two families, no more

- A serif for the body (the shapes hold up over long stretches), a sans for
  headings — or one family used at deliberate weights. A third family needs a
  reason a reviewer can name.
- The families must exist on the build machine. A font named in the preamble
  but not installed renders as a substitution, and the substitution's metrics
  re-wrap every line — the classic "it looked fine on my machine" defect.
- For CJK text pick the face explicitly (`ctex`, `xeCJK` with a named font);
  the default fallback differs per machine and per engine.

## Set the scale explicitly

| element | typical size (body 10–11pt document) |
| --- | --- |
| part / chapter title | 17–20 pt, bold |
| section | 13–14 pt, bold |
| subsection | 11–12 pt, bold |
| body | 10–11 pt |
| caption / footnote | 8–9 pt |

- One ladder, used document-wide. Sizes invented per element are what make a
  document look assembled rather than designed.
- Leading around 1.25 for paper, up to 1.5 for a draft read on screen. Set it
  (`\linespread`, `setspace`) — the class default varies and is usually too
  tight.
- Line length 45–75 characters for a single column; `twocolumn` for anything
  wider. Over-long lines are the most common readability failure in reports
  set with a small margin.

## Microtypography

- `\usepackage{microtype}` on pdfLaTeX; it is on by default in LuaLaTeX and
  XeLaTeX. Protrusion and expansion improve justification at zero visual cost.
- Justified with hyphenation enabled (`babel`/`polyglossia`); ragged-right only
  for narrow columns.
- Real quotes and dashes: `` `` '' '' `` for quotes, `--`/`---` for en/em
  dashes. Straight quotes in a typeset document read as a draft.
- Non-breaking spaces before `\ref`/`\cite` and inside numbers with units
  (`10~kg`); a figure number orphaned onto the next line is a visible defect.

## Fonts and the engine

| engine | font system | use when |
| --- | --- | --- |
| pdfLaTeX | Type 1 via packages (`lmodern`, `newtx`, `libertine`) | maximum package compatibility, ASCII/Latin text |
| XeLaTeX | system OpenType/TrueType via `fontspec` | system fonts, CJK, Unicode text |
| LuaLaTeX | `fontspec` + LuaTeX extras | `fontspec` needs plus Lua-side scripting |

- `\usepackage[T1]{fontenc}` on pdfLaTeX — without it, hyphenation of accented
  words breaks and copied text comes out garbled.
- Load `fontspec` before packages that must see the font setup; load order
  failures produce "font not found" errors that name the wrong package.

## The failures to look for in the render

- Overfull hboxes in the log = text into the margin in the PDF. Read the log
  for `Overfull \hbox`, then confirm in the page image.
- Tofu boxes (□) = a missing glyph: wrong engine for the font, or a character
  the face does not cover.
- A bibliography or index printed as `??` = a missing build pass, not missing
  data.
- Substituted fonts = check the PDF's font list (`pdffonts`) against what the
  preamble names.
