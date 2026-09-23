# Palette

Colour in a typeset document: how to build a small system, how to apply it in
LaTeX, and the failures that make a document look generated rather than
designed.

## Build the palette first

Four roles, chosen before the first `\definecolor`:

| role | job |
| --- | --- |
| ink | body text — near-black, never pure `#000000` on paper |
| field | the page background — usually white or a tint |
| support | panels, table rules, secondary surfaces |
| accent | the one thing that means "look here" |

- One accent per document. A second accent colour is a second accent role that
  nobody defined, and it halves the emphasis of both.
- Derive tints and shades from the same hue rather than adding new hues; a
  palette of five related tones reads as one system.
- Print vs screen differ: rich blacks and large saturated fills band and moiré
  in print; pure RGB hues that look clean on screen print muddy. When the
  document is printed, check a proof, not the screen.

## Contrast is a requirement

- Text on its background must survive a phone photo of the page. Light grey
  body text on white is the most common self-inflicted defect.
- Colour never carries meaning alone — pair it with a label, a position or a
  shape so the document works in greyscale and for colour-blind readers.
- Charts follow the same rule: series distinguishable without hue.

## Applying it in LaTeX

    \usepackage{xcolor}
    \definecolor{ink}{HTML}{1A1A1A}
    \definecolor{accent}{HTML}{C0392B}
    \definecolor{panel}{HTML}{F4F6F6}

- Define named colours once in the preamble; a hex literal in the body is a
  palette that cannot be changed later.
- `\pagecolor` for tinted pages, `\color`/`\textcolor` for text, and
  `\colorbox`/`\fcolorbox` for panels. Tinted full pages need the bleed in mind
  — the tint reaches the paper edge or it visibly does not.
- Section headings in the accent, body in ink: one emphasis, applied
  consistently. Headings in five colours across a document is noise.
- Table rules in a support tone (`\arrayrulecolor`), not pure black — full-black
  rules fight the text.

## Charts and figures inherit the palette

- One series in the accent, the rest in greys or support tones.
- Direct labels on marks beat a legend; a legend only when marks cannot be
  labelled.
- No 3-D effects, no gradient fills on data, no dual axes on one plot.
- Figures built elsewhere (matplotlib, TikZ) must use the same hex values —
  paste the palette into the figure script.

## Anti-patterns

- Rainbow section headings, one hue per chapter.
- Accent used for more than a handful of elements per page.
- Pure black `#000000` body text (harsh) or pure saturated fills behind body
  text (unreadable).
- Colour as the only signal ("the red rows are late").

## The cascade palette system

A palette that scales with the document instead of being re-invented per
document. Three tiers, chosen once:

| tier | colours | use |
| --- | --- | --- |
| 1 — minimal | ink + field | the default; text documents, papers, contracts |
| 2 — supported | + one support tone | reports with tables and panels |
| 3 — accented | + one accent | covers, creative documents, presentations |

The document declares its tier in the preamble comment, and every later colour
decision is checked against it. A tier-1 document that grows an accent has not
been re-themed; it has been mis-declared.

## Iron rules

1. **One document, one colour family.** Tints come from one hue at fixed
   lightness steps. A second hue is a second document's palette.
2. **Colour count limits**: tier 1 uses 2 values, tier 2 uses 3, tier 3 uses
   4–5. More than 5 is not a palette, it is a collection.
3. **The accent is rationed**: fewer than five accented elements per page. An
   accent on everything emphasises nothing.
4. **Contrast is checked per pair**, not per colour: every text-on-background
   pair in the document, including the ones inside charts and panels.
5. **Greyscale must work**: if a colour carries meaning, weight, position or a
   label must carry it too.
6. **Print is a different medium**: rich blacks band, large saturated fills
   moiré. Check a proof for anything at tier 3 that will be printed.

## Output formats

The same palette, expressed per toolchain — define it once and transcribe:

- **LaTeX**: `\definecolor{ink}{HTML}{1A1A1A}` etc. in the preamble; no hex
  literals in the body.
- **HTML/CSS covers**: CSS custom properties (`--ink: #1A1A1A`) on the page
  root.
- **Figures**: the same hex values pasted into the plotting script, so the
  figure inherits the document's palette rather than approximating it.
