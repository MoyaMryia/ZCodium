# Pagination

Controlling where pages break and where they do not. The default break points
are competent; the failures come from floats, display math and section headings
landing badly.

## The primitives

| tool | effect |
| --- | --- |
| `\clearpage` | flush all pending floats, then break — ends a float queue |
| `\cleardoublepage` | same, and open on a recto in `twoside` |
| `\newpage` | break, keep pending floats waiting |
| `\nopagebreak` / `\nolinebreak` | forbid a break at this point |
| `\needspace{<len>}` (needspace) | break unless `<len>` of space remains |
| `\enlargethispage{<len>}` | stretch the current page by a line or two |

Prefer `needspace` over hand-placed `\newpage`: a manual break fixed for one
edit is wrong after the next edit. `\newpage` inside a paragraph context is the
source of half-empty pages that nobody can explain.

## Widows and orphans

    \clubpenalty=10000   % no orphan: first line alone at page bottom
    \widowpenalty=10000  % no widow: last line alone at page top

or `\usepackage[all]{nowidow}`. A single line carried to the next page is the
most common pagination defect in a long document, and it is invisible in the
source — only the render shows it.

## Section headings

- A heading must not sit alone at the bottom of a page. Classes provide
  `\@afterindentfalse`-style machinery; the practical fix is `needspace` before
  the heading or the class's own `titlesec`/KOMA options.
- Headings have implicit penalties (`\@startsection`); raising them
  (`\usepackage{titlesec}` or the class option) keeps a heading with at least
  two following lines.

## Floats

- Floats drift to the next page by design; a float that must stay put is not a
  float — use the `H` specifier (`float` package) or a non-floating
  `minipage`/`center` block.
- Control the queue: `\usepackage{flafter}` (never before the reference),
  `[tb]`/`[!t]` placement, and `\clearpage` between chapters so figures do not
  pile up at a section end.
- `[H]` everywhere produces the opposite disease: a page break after every
  figure and half-empty pages throughout.
- Float parameters (`\topfraction`, `\textfraction`) decide how much of a page
  floats may occupy; the LaTeX defaults are deliberately conservative and
  usually fine — change them when a document genuinely needs denser float
  pages, not preemptively.

## Display math

- Never split a display equation from its paragraph: `\nopagebreak` after the
  display, or the `\abovedisplayskip` penalties via `amsmath`'s defaults.
- Multi-line derivations (`align`, `gather`) break at `\\` with `\allowdisplaybreaks`
  only when the break is meaningful — otherwise let the whole block move.

## Tables that must not split

- `longtable` for tables that legitimately span pages, with a repeated header
  (`\endhead`) and a footer (`\endfoot`) — a continuation page without a header
  is unreadable.
- A table that must stay whole: wrap in `\begin{minipage}{\textwidth}` inside a
  `[H]` float, or shrink it to fit.

## Verifying pagination

- Read the page images, not the log: half-empty pages, orphaned headings,
  widow lines, float pile-ups at chapter ends, continuation tables without
  headers.
- `check_bounding_boxes.py` and `pdf_qa.py` (see SKILL.md §6) catch the
  mechanical versions — text into the margin, content off the page.

## CJK punctuation placement (禁则)

Chinese, Japanese and Korean typesetting has line-break prohibitions that LaTeX
does not apply by default, and violating them is the defect a CJK reader sees
first:

- **Cannot start a line**: `。，、；：？！）】》」』%…—·` and closing quotes.
- **Cannot end a line**: `（【《「『` and opening quotes.
- **Cannot split**: a number with its unit, a Latin word, an inline formula.

With `xeCJK`/ `CTeX` the prohibitions are handled by the package's default
settings; with plain `fontspec` they are not. The practical checks:

- Enable the CJK line-breaking the package provides (`xeCJK`'s
  `\xeCJKsetup{CJKmath=true}` and the default ` kinsoku` settings) rather than
  assuming it.
- Verify in the render, not the source: scan the first and last character of
  every line in a CJK paragraph. A line starting with `。` is a defect, and it
  is invisible in the editor.
- Punctuation compression (`\usepackage[CJKmath]{...}`-adjacent settings, or
  `ctex`'s `punct` option) is what makes a full-width comma at a line end look
  intentional rather than like a bug.

## Last-page blank control

A document whose last page is blank, or carries one orphan line, is the most
common "the PDF looks wrong" report:

- The cause is almost always a float deferred to a page that then has nothing
  else, or a `\clearpage` after the last section.
- `\raggedbottom` plus a final `\clearpage` only where the float queue genuinely
  needs flushing — never a reflexive `\clearpage` at the end of the document.
- Check by rendering the last two pages: the last page must carry content, and
  the second-to-last must not be a widow.

## Table cross-page integrity

A table that splits badly is worse than a table that does not split:

- A table longer than a page uses `longtable` with `\endhead` (repeated header)
  and `\endfoot` (continuation note). A continuation page without a header is
  unreadable.
- A table that must stay whole is wrapped in a non-floating `minipage` or given
  `[H]`; splitting it means the rows were designed wrong.
- Never split a row across pages: `\\*` or the `longtable` equivalent. A row
  whose cells land on two pages cannot be read as one row.
- On the HTML path (`cover_render.py` and friends), the same rule is a CSS
  decision: `break-inside: avoid` on rows, `thead` repetition, and a check in
  the rendered pages — the browser will split a table wherever it lands
  otherwise.
