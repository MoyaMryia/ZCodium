# Brief — Reports, proposals and theses

Applies to a research proposal, a mid-term report, an annual progress report, a
thesis, and any long structured document whose shape is fixed by an institution's
form rather than by the author. When a form exists, the form wins; this brief covers
the parts the form does not settle.

## 1. The document is at least two sections

Every document of this kind has a cover and a body, and the cover must not share
page numbering with the body.

- Section 1 — cover and front matter: page numbers in roman numerals, and usually
  not displayed at all. Its footer is empty, or carries a roman `PAGE` field.
- Section 2 — body: page numbers restart at arabic 1.

`cover-separation` reports `only one section` for a document that has one, by
design. A proposal delivered as a single section is the failure the rule exists to
catch: the cover becomes page 1 and every later reference is off by the length of
the front matter.

The section break is a `w:sectPr` inside the last paragraph of the front matter, not
a page break. A page break starts a new page; only a section break starts a new
numbering sequence.

## 2. Page geometry

- A4, margins: top and bottom 2.5 cm, left and right 2.8 cm. The left margin is the
  binding edge — the report is bound on the left, so nothing important sits in it.
- The section's `w:pgSz` carries the paper size in twips and `w:pgMar` the four
  margins plus the header and footer distances. `image-overflow` derives the usable
  column from those numbers, so an image sized by eye against the wrong margins
  fails the gate.

## 3. Chinese fonts, by role

The convention is role-based, not taste-based, and it is the fastest way to make a
Chinese report look official:

| role                        | face                                            |
| --------------------------- | ----------------------------------------------- |
| document title on the cover | 黑体 or 小标宋, bold                            |
| level 1 heading             | 仿宋, bold                                      |
| level 2 and 3 headings      | 楷体, bold                                      |
| body text                   | 宋体 (most forms) or 楷体 (some proposal forms) |
| table and figure content    | 宋体, one step below body size                  |
| page number                 | 宋体, one step below body size                  |

All six of these are safe. `font-fallback` flags only Noto Sans SC, Noto Serif SC,
Source Han Sans, Source Han Serif, LXGW WenKai and 霞鹜文楷 — fonts that exist on
the build machine and substitute silently on the reader's.

## 4. Headings

- Level 1: 仿宋 bold, numbered `一、` `二、` `三、` — or `1.` `2.` when the form
  asks for arabic. The number and its separator are part of the heading.
- Level 2 and 3: 楷体 bold, numbered `（一）` `1.` `1.1` as the form requires.
- One level at a time, no skipping. `heading-continuity` reads the numeric suffix of
  each `headingN` paragraph style and reports every jump of more than one.
- Headings are paragraphs with a heading style, not runs made bold and large by
  hand. A hand-formatted heading is invisible to the outline, to the table of
  contents, and to the gate.

## 5. Body text

- First-line indent of two characters on every body paragraph. Two characters at
  小四 (12 pt) is 480 twips; the rule accepts 200–800 twips.
- **The indent must be `w:ind/@w:firstLine`.** Word writes `w:firstLineChars="200"`
  for a two-character indent and it renders identically, but the rule reads only
  `@w:firstLine`. A document that uses the `Chars` form is reported as unindented
  even though it looks right.
- Line spacing is one value for the whole body — 1.5 or a fixed 28 pt. A second
  value anywhere in a body paragraph outside tables and lists fails
  `line-spacing`.
- Paragraph spacing is set once. Mixing `w:spacing/@w:before` values per paragraph
  reads as noise.
- Lists: real `w:numPr` lists, `nosep` spacing. `numbering-continuity` requires the
  `numId` values in use to be contiguous — a list whose numbering definition was
  copied in from another document usually brings a gap with it.

## 6. The cover's field table

The cover carries a two-column table of identity fields — student id, name,
programme, supervisor, title, school, major, date, venue — with the fill-in column
underlined.

- The label column is 楷体 bold; the value column is 仿宋 at one step below body
  size.
- The underline is the cell's bottom border (`w:tcBorders/w:bottom`), one per row,
  not a typed run of underscores. A typed rule does not survive an edit and does not
  align.
- **This table fails two rules unless you prepare it.** It is a multi-row table with
  no header row, so `table-pagination` reports `no tblHeader header row`; and every
  row needs `w:cantSplit` for the same rule to pass. Give the first row
  `w:tblHeader` anyway — it costs nothing and it is what the rule counts — and mark
  every row `w:cantSplit` so a field never splits across a page. Every cell also
  needs `w:tcMar` padding for `table-margins`.

## 7. Front matter and table of contents

- An instruction page between the cover and the contents is normal in this genre:
  how the form is submitted, who reviews it, and what happens after approval.
- A table of contents belongs in the front matter when the body is long enough to
  navigate by. See `references/toc.md` for the field anatomy and
  `routes/format.md` §2 for the repair — a freshly built TOC renders as an empty
  block until `add_toc_placeholders.py` fills it and
  `<w:updateFields w:val="true"/>` asks Word to recompute it on open.

## 8. Figures, tables and the bibliography

- Caption above a table, below a figure. Table and figure content one step smaller
  than body text.
- Bibliography entries hanging-indented, numbered, in the citation style the
  institution specifies.
- A long table spanning pages repeats its header row (`w:tblHeader`) and keeps its
  rows whole (`w:cantSplit`) — the same two properties `table-pagination` checks.

## 9. The signature block

The last page carries a declaration and two signature lines:

- The declaration is one paragraph, at body size, bold, in 仿宋.
- Then `学生签字` on the left and `日期` on the right, on the same line, each
  followed by an underlined blank about 4 cm long. The underline is a bottom-bordered
  run or a cell border, never a typed rule.
- The two lines sit on one line via a right-aligned tab at the right margin.

## 10. Self-check before handing this over

- Two or more sections; front matter roman, body restarting at arabic 1.
- Cover footer empty or roman; body footer arabic and present on every page.
- Every Chinese body paragraph carrying a `w:ind/@w:firstLine` in 200–800 twips.
- One line-spacing value across all body paragraphs.
- Heading levels contiguous; headings carry real heading styles.
- The cover field table has `w:tblHeader` on row 1, `w:cantSplit` on every row, and
  `w:tcMar` on every cell.
- `postcheck.py proposal.docx --only cover-separation,cjk-indent,line-spacing,heading-continuity,numbering-continuity,table-pagination,table-margins,font-fallback`

## Source

The structure of this brief — the A4 geometry with a wider left binding margin, the
role-based Chinese font convention (仿宋 bold level-1 headings, 楷体 bold level-2
and 3, 宋体 or 楷体 body), the cover with its logo, title and underlined two-column
identity table, the roman-numbered undisplayed front matter restarting at arabic 1,
the instruction page, the hanging-indent numbered bibliography, and the closing
declaration with signature and date lines — follows the conventions of:

    NemoYuan2008/SJTU-Thesis-Proposal
    https://github.com/NemoYuan2008/SJTU-Thesis-Proposal
    Copyright (c) 2023 Boshi Yuan
    MIT License — https://github.com/NemoYuan2008/SJTU-Thesis-Proposal/blob/master/LICENSE

The knowledge above is restated in this repository's own words and in `.docx` terms;
no upstream file is distributed with this plugin.
