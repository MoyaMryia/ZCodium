# Design system

The type scale, the spacing scale, the colour palette, and the component specs that
a `.docx` built or reviewed by this plugin should hold to. Everything here is
expressed in OOXML terms, because `word/styles.xml` is where a design system lives
in a Word document — not in a config file, not in a build script.

## 1. What the system is, and where it lives

A document has one source of typographic truth: `word/styles.xml`. Every paragraph
references a paragraph style, every character-level override references a character
style, and the defaults sit in `w:docDefaults`.

Three consequences:

- **A style change is a document-wide change.** Fix the body style once and every
  paragraph that uses it is fixed. Fix a paragraph by hand and the next paragraph
  still carries the defect.
- **Direct formatting is a bug report.** A run with a hand-set size is telling you
  the style it came from is missing something. Add the style, remove the override.
- **The gate reads styles, not pixels.** `heading-continuity` reads the numeric
  suffix of each `headingN` paragraph style; `add_toc_placeholders.py` collects
  headings by the same mechanism. A heading formatted by hand is invisible to both.

## 2. The type scale

Sizes in OOXML are half-points: `w:sz w:val="21"` is 10.5 pt.

Pick one ratio and derive every size from it. The scale below is a ratio of about
1.2 from 10.5 pt, which is enough steps for a document and few enough to stay
recognisable:

| role       | `w:sz` | size    | used for                            |
| ---------- | ------ | ------- | ----------------------------------- |
| display    | 56     | 28 pt   | a cover title, a poster headline    |
| title      | 44     | 22 pt   | a document title, a chapter opening |
| heading 1  | 32     | 16 pt   | a top-level section                 |
| heading 2  | 29     | 14.5 pt | a subsection                        |
| heading 3  | 26     | 13 pt   | a sub-subsection                    |
| body large | 24     | 12 pt   | 小四, the Chinese body default      |
| body       | 21     | 10.5 pt | 五号, the Latin body default        |
| body small | 18     | 9 pt    | table content, captions             |
| footnote   | 16     | 8 pt    | footnotes, 版记                     |

Rules:

- **Two adjacent sizes must be visibly different.** 21 and 22 half-points is not a
  hierarchy, it is an inconsistency.
- **One size per role, everywhere.** A document with body text at both 21 and 24 is
  a document with two body styles, whichever one the author intended.
- **Nothing below 16 half-points** (8 pt) in a document meant to be read. 8 pt is
  the floor for a footnote, not for content.
- A Chinese body at 3 号 is 32 half-points; at 小四 it is 24; at 五号 it is 21.
- Character styles carry their own `w:sz` only when they are genuinely a different
  size — a caption style at 18, a superscript style at 21 with `w:vertAlign`.

## 3. Families

Two families, three at the outside, and each has a declared role:

| role               | Latin                                         | East Asian  |
| ------------------ | --------------------------------------------- | ----------- |
| body               | a serif — a Times-like or a Georgia-like face | 宋体 / 仿宋 |
| headings           | a sans — a Helvetica-like or a system sans    | 黑体        |
| display (optional) | a third face for the cover only               | 小标宋      |

**Declare both runs.** `w:rFonts` takes `w:ascii` for Latin, `w:eastAsia` for CJK,
and `w:hAnsi` for high-ANSI. One attribute does not cover the other script, and a
Latin-only declaration leaves the Chinese characters to whatever the reader happens
to have installed.

Six fonts are on the fallback-risk list and must not be declared: Noto Sans SC,
Noto Serif SC, Source Han Sans, Source Han Serif, LXGW WenKai, 霞鹜文楷. They exist
on the build machine, they substitute silently on the reader's, and
`font-fallback` reports them. A document that must use them needs the font embedded
or re-pointed at a face the recipient has.

A monospaced face for code, identifiers and paths is a third family and is allowed —
it is a different kind of content, not a different level of hierarchy.

## 4. Spacing

Four knobs, each with one job:

| attribute                          | job                      | typical                                                    |
| ---------------------------------- | ------------------------ | ---------------------------------------------------------- |
| `w:spacing/@w:line`                | leading                  | 312 (1.3×) for a draft, 276 (1.15×) for a final            |
| `w:spacing/@w:lineRule`            | how `@w:line` is read    | `auto` for a multiple, `atLeast`/`exact` for a fixed value |
| `w:spacing/@w:before` / `@w:after` | space around a paragraph | 0–120 twips                                                |
| `w:ind/@w:firstLine`               | first-line indent        | 200–800 twips for Chinese body                             |

- **One `@w:line` value across all body paragraphs.** `line-spacing` counts the
  distinct values in body paragraphs outside tables and lists and reports any
  document with more than one. Headings may have their own; list items may have
  their own; body prose may not.
- **Space between paragraphs is `@w:after`, not empty paragraphs.** Five or more
  consecutive empty paragraphs is what `blank-pages` counts as a blank page, so a
  document that spaces its blocks with blank lines eventually trips the gate.
- **Chinese body indent is `w:ind/@w:firstLine`, not `w:firstLineChars`.** Word
  writes the `Chars` form for a two-character indent and it renders identically, but
  `cjk-indent` reads only `@w:firstLine`. Two characters at 12 pt is 480 twips; the
  rule accepts 200–800.
- **Headings use `@w:before` for their air and `@w:after` for the gap to the text.**
  A heading with no space before it reads as a run-in label.
- `@w:lineRule="exact"` clips anything taller than the line — an inline image, a
  large formula, a stacked fraction. Use `atLeast` when the paragraph can contain
  one.

## 5. Colour

A palette is a small set of named values, each with one job:

| slot    | count       | use                                                                  |
| ------- | ----------- | -------------------------------------------------------------------- |
| text    | 1           | near-black, `1A1A1A` or `262626` — never pure black for body text    |
| rule    | 1           | a mid grey, `BFBFBF` or `A6A6A6`                                     |
| tint    | 2–3         | 5%, 10%, 15% of one hue — see `decorations.md` §4 for the arithmetic |
| accent  | 1           | one hue, for a call to action, a link, a highlighted series          |
| shading | never unset | an omitted `w:fill` paints black; `shading-type` reports it          |

- **Near-black, not black.** Pure black body text on white is harsher than it needs
  to be and prints heavier.
- **One accent.** A second accent colour is a second message.
- **Tints come from one hue at three lightness steps.** That gives a two- or
  three-level hierarchy without adding a hue.
- **Contrast is a print question.** Below about 8% a tint is invisible on paper;
  above about 20% it competes with the text on it.
- **Greyscale must work.** If a colour is carrying meaning, weight or position has
  to carry it too.
- Colour on text is `w:color`; colour behind text is `w:shd/@w:fill`. They are
  different attributes and setting one does not set the other.

## 6. Component specs

### 6.1 Headings

| level      | size | weight              | alignment       | numbering         |
| ---------- | ---- | ------------------- | --------------- | ----------------- |
| heading 1  | 32   | bold                | left or centred | `1.` or `一、`    |
| heading 2  | 29   | bold                | left            | `1.1` or `（一）` |
| heading 3  | 26   | bold or bold italic | left            | `1.1.1` or `1.`   |
| heading 4+ | 21   | bold italic, run-in | left            | `（1）`           |

- Levels are used in order. `heading-continuity` reports every jump of more than
  one.
- `w:keepNext` on every heading, so a heading never ends a page alone.
- The style id starts with `heading` followed by the level — that is what the gate
  and the TOC collector read.

### 6.2 Body

- `w:jc="both"` for justified Latin prose, `w:jc="left"` for ragged-right short
  copy, `w:jc="center"` only for a headline or a pull quote.
- One `@w:line` value; see §4.
- Chinese body: `w:ind/@w:firstLine` in 200–800 twips. Latin body: no first-line
  indent, with `@w:after` separating paragraphs.

### 6.3 Lists

- Real lists: `w:numPr` with a `numId` from `word/numbering.xml`. A typed hyphen is
  not a list.
- The `numId` values in use must be contiguous integers — `numbering-continuity`
  reports any gap, and a list copied in from another document usually brings one.
- Two levels at most in body text. A third level is a paragraph that should have
  been a sentence.
- List items are exempt from `cjk-indent` and from `line-spacing`. That is what
  makes a bulleted Chinese resume legal.

### 6.4 Tables

| property                   | value                                     | why                                               |
| -------------------------- | ----------------------------------------- | ------------------------------------------------- |
| `w:tblW`                   | 100% or a fixed twip width                | a table narrower than the column looks accidental |
| `w:tblBorders`             | three horizontal rules, no vertical lines | vertical rules make a table harder to read        |
| `w:tblHeader` on row 1     | required                                  | `table-pagination` counts it                      |
| `w:cantSplit` on every row | required                                  | `table-pagination` counts it                      |
| `w:tcMar` on every cell    | required                                  | `table-margins` counts it                         |
| `w:tcPr/w:shd`             | a named tint, never an unset fill         | `shading-type` counts the unset one               |
| cell text size             | one step below body                       | table content is denser than prose                |

- A header row repeats on every page of a multi-page table. A multi-row table with
  no header row fails the gate, so a layout table used for a two-column arrangement
  needs a header row it does not semantically have — use a real column section
  (`w:cols`) instead.
- A table wider than the text column is a defect. Resize the content or the table;
  never scale the type down inside it.

### 6.5 Captions

- Above a table, below a figure. Always.
- One step below body size, with the label prefixed (`fig:`, `tab:`, `eq:`).
- `w:keepNext` on a table's caption so it stays with its table.

### 6.6 Callouts

One paragraph, not several:

```xml
<w:p>
  <w:pPr>
    <w:pBdr>
      <w:top w:val="single" w:sz="4" w:space="4" w:color="BFBFBF"/>
      <w:left w:val="single" w:sz="4" w:space="4" w:color="BFBFBF"/>
      <w:bottom w:val="single" w:sz="4" w:space="4" w:color="BFBFBF"/>
      <w:right w:val="single" w:sz="4" w:space="4" w:color="BFBFBF"/>
    </w:pBdr>
    <w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>
  </w:pPr>
  <w:r><w:t>…</w:t></w:r>
</w:p>
```

`w:space` is what keeps the text off the border; `w:fill` is named, so
`shading-type` has nothing to report.

### 6.7 Header and footer

- Page number in the footer, centred or alternating. A header page number sits under
  a thumb on a double-sided print.
- No header or footer on the cover: its section references an empty footer, or
  carries `<w:titlePg/>` with an empty first-page footer.
- The page number is a `PAGE` field with a format switch. A bare keyword prints its
  own instruction in WPS — `fix_footer_fields.py` is the repair.

### 6.8 Cover

- Its own section, so it can carry its own page numbering. `cover-separation`
  reports `only one section` for a document that has one.
- Title, author, date, and whatever the document needs above the fold. Nothing else.
- Front matter in roman numerals, the body restarting at arabic 1 — two sections,
  two numbering sequences, and no empty `<w:pgNumType/>` on either.

## 7. The gate is the design system's enforcement

The eleven rules in `postcheck.py` are this document's acceptance tests:

| rule                   | the design-system property it defends                      |
| ---------------------- | ---------------------------------------------------------- |
| `line-spacing`         | one leading value in body prose (§4)                       |
| `cjk-indent`           | a two-character first-line indent on Chinese body (§4)     |
| `heading-continuity`   | a contiguous heading hierarchy (§6.1)                      |
| `numbering-continuity` | contiguous numbering definitions (§6.3)                    |
| `font-fallback`        | no build-machine-only font (§3)                            |
| `table-pagination`     | repeating header rows, unsplittable rows (§6.4)            |
| `table-margins`        | padding in every cell (§6.4)                               |
| `shading-type`         | a named fill on every shading (§5)                         |
| `image-overflow`       | every image inside the text column (§6.4)                  |
| `blank-pages`          | spacing by paragraph properties, not empty paragraphs (§4) |
| `cover-separation`     | the cover in its own section (§6.8)                        |

A document that passes all eleven is not automatically well designed. A document
that fails one is definitely not.

## 8. Checklist

- Every size on the scale in §2, two families from §3, both runs declared.
- One `@w:line` value in body prose; paragraph spacing by `@w:after`.
- Chinese body indent as `w:ind/@w:firstLine` in 200–800 twips.
- One accent colour, tints from one hue, every `w:shd` carrying a named `w:fill`.
- Real lists, real headings, real tables — no direct formatting standing in for a
  style.
- Cover in its own section, front matter roman, body arabic.
- `postcheck.py out.docx --json` clean, or the failures explained and scoped with
  `--only`.
