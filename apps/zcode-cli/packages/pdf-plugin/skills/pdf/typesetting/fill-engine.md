# The fill engine

How blank space in a document gets filled: the algorithms LaTeX uses to break
pages, stretch glue and place floats, and the knobs that exist when the output
is wrong. Read this when a page has a hole in it, a paragraph is spaced like a
  telegram, or a float landed somewhere inexplicable.

## Glue: the stretchable space

Every vertical space in LaTeX is *glue* with a natural size plus stretch and
shrink components:

    \vspace{10pt plus 2pt minus 3pt}   % natural 10, can stretch 2, shrink 3

- `\parskip`, `\baselineskip`-derived skips, list spacing and float separations
  are all glue. When a page must be stretched to `\textheight`, the glue is
  what stretches — that is why a short page shows as loose inter-paragraph
  spacing rather than a gap at the bottom.
- `\raggedbottom` (the default in most classes for `oneside`) lets pages end
  short with no stretching; `\flushbottom` (common in `twoside` books) forces
  every page to the text block, stretching glue as needed. A document that
  looks "airy" on some pages under `\flushbottom` is being stretched.
- Infinite glue (`fil`) absorbs all stretch; finite glue shares it proportionally.
  A `\vfill` in the wrong place is why a page breaks where it does.

## Badness and the page builder

- The page builder accumulates material and breaks when the accumulated
  *badness* (how far the glue is from its natural size) exceeds
  `\toleranceshow`… practically: when a page cannot be broken without either
  overflowing or stretching beyond tolerance, LaTeX defers material — which is
  why a float or a paragraph can jump a page.
- `\raggedbottom` accepts short pages; `\flushbottom` pays for them with
  stretched glue. Neither is wrong; pick per document and stay consistent.

## When a page has a hole

| symptom | usual cause | fix |
| --- | --- | --- |
| gap at page bottom, loose spacing | `\flushbottom` stretching finite glue | `\raggedbottom`, or accept it in `twoside` |
| half-empty page after a figure | float deferred, then placed alone | `[!t]`/`[t]`, `\clearpage` to end the queue, or `[H]` if it must be inline |
| section starts halfway down | heading penalty allowed a break after it | `needspace` before the heading |
| everything pushed to the next page | one over-tall float blocking the queue | resize the float; it will never fit as-is |

## Float placement parameters

The page builder reserves fractions of a page for floats:

| parameter | default | meaning |
| --- | --- | --- |
| `\topfraction` | 0.7 | max fraction of a page floats may take at the top |
| `\bottomfraction` | 0.3 | same, at the bottom |
| `\textfraction` | 0.2 | min fraction that must be text |
| `\floatpagefraction` | 0.5 | min fill for a float-only page |

Raising them (e.g. `\renewcommand{\topfraction}{0.9}`) packs floats denser;
lowering `\floatpagefraction` lets sparse float pages form. Change these when a
document genuinely needs denser float pages — the defaults exist because most
documents read better with them.

## Paragraph filling

- Justified text fills a line by stretching interword glue within the
  tolerance; over-long unbreakable strings (URLs) produce `Overfull \hbox`
  rather than a stretched line — see `overflow.md`.
- `\sloppy` relaxes the tolerance (looser spacing, fewer overfulls) — use it
  locally in a narrow `minipage` or a `twocolumn` cell, never document-wide.
- `microtype`'s expansion lets the font itself stretch slightly, which removes
  most bad breaks before glue has to.

## Debugging recipe

1. Read the log: `Overfull`/`Underfull` with sizes.
2. Render to images: which page, which hole.
3. Identify the glue or float responsible (the log's float queue messages help).
4. Apply the smallest fix — `needspace`, a placement specifier, or one
   parameter — and rebuild.
5. Re-render. A pagination fix is not verified until the page image agrees.

## Glue arithmetic

Every vertical skip is glue with a natural size plus stretch and shrink:

    \vspace{10pt plus 2pt minus 3pt}

When a page must be stretched to `\textheight` under `\flushbottom`, the
available stretch is distributed **proportionally to each glue's stretch
component**. The practical consequences:

- A paragraph skip with `plus 2pt` and a display skip with `plus 6pt` share the
  load 1:3 — the display gaps grow three times faster. That is why a stretched
  page shows loose spacing around displays first.
- Infinite glue (`fil`, `fill`) absorbs all stretch and starves finite glue.
  A `\vfill` in a page's vertical list is why the rest of the page cannot
  stretch at all.
- `\raggedbottom` accepts a short page; `\flushbottom` pays for it with
  stretched glue. Neither is wrong — a `twoside` book usually wants
  `\flushbottom` so recto and verso bottoms align.

## The page builder's decision

The page builder accumulates material and breaks when the accumulated badness
exceeds `\tolerance` (default 200 — higher is looser). When it cannot break
without either overflowing or stretching beyond tolerance, it **defers**
material to the next page. That single mechanism explains most "why is there a
hole there" reports:

- a float deferred, then placed alone → a half-empty page after it;
- a paragraph deferred because its last line could not fit → a short page;
- a heading deferred with `needspace` → the section starts on the next page.

## Tuning, in order of preference

1. **`\raggedbottom`** when short pages are acceptable — the cheapest fix for
   loose spacing, and right for most `oneside` documents.
2. **`needspace{<len>}`** instead of a hand-placed `\newpage` — the manual
   break is right for one edit and wrong after the next.
3. **`\enlargethispage{<len>}`** to pull one or two extra lines onto a page
   that is one line short — a one-page-local fix that does not affect the rest.
4. **Float parameters** (`\topfraction` 0.7, `\textfraction` 0.2,
   `\floatpagefraction` 0.5) — raise them only when a document genuinely needs
   denser float pages; the defaults exist because most documents read better
   with them.
5. **`\flushbottom` off** as the last resort for a document whose stretched
   pages look worse than its short ones.

## Debugging recipe

1. Read the log: `Overfull`/`Underfull` with sizes, and the float queue
   messages (`LaTeX Warning: Float too large`).
2. Render to images: identify which page, and which hole.
3. Name the glue or the float responsible.
4. Apply the smallest fix from the list above.
5. Re-render. A pagination fix is not verified until the page image agrees.
