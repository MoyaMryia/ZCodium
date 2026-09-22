# Brief — Exam papers and reference sheets

Applies to an exam paper, a quiz, an open-book reference sheet, and any short
dense handout whose job is to be read under time pressure. A reference sheet is an
exam document with the questions removed: same geometry, same density, same
column mechanics.

## 1. Orientation and columns

- Landscape A4 for a reference sheet or a wide question paper; portrait for a
  conventional exam. Decide before writing — the column count follows from it.
- The paper size is the section's `w:pgSz`. Landscape A4 is
  `<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>`; portrait A4 is the same
  two numbers swapped with `w:orient` omitted or `portrait`.
- Columns come from the section properties, not from a table:
  `<w:cols w:num="7" w:space="284"/>` inside `w:sectPr`. The attribute is a twip gap
  between columns; the count is whatever the content needs. Word's dialogue tops out
  at a few columns, so write the element directly rather than trying to reach a
  seven-column sheet through the UI.
- A forced column break is `<w:br w:type="column"/>` inside a run — the equivalent
  of the LaTeX `\columnbreak`. Use it to start a new topic at the top of a column
  instead of letting it straddle the break.
- **Do not build columns out of a table.** A seven-column layout table is a
  seven-column failure: `table-pagination` wants a `w:tblHeader` header row on every
  multi-row table and `w:cantSplit` on every row, `table-margins` wants `w:tcMar` on
  every cell, and none of those mean anything for a layout grid.

## 2. Margins and the sealing line

- Margins 1.5–2 cm all round on a reference sheet; 2.5 cm plus a wider binding edge
  on a bound exam paper.
- A reference sheet uses the full printable area on purpose. A bound exam paper does
  not: the binding edge needs the extra width so the staple does not eat the first
  column.
- The candidate information block — name, id, seat — sits at the top of page 1, in a
  bordered box or under a rule, and is the only place those fields appear.

## 3. Type scale under time pressure

- A conventional exam: body 10.5–12 pt, questions at body size, sub-questions one
  step smaller.
- A reference sheet: 5–7 pt body. At 5 pt the leading must be set explicitly —
  `w:spacing/@w:line` at roughly the same value as the font size in half-points
  times 1.2, or the lines collide.
- One family for everything. A reference sheet has no hierarchy to buy with a
  second family; it has colour, and colour is cheaper.
- For Chinese content use 宋体 for body and 黑体 for headings. Both are safe;
  `font-fallback` flags only Noto Sans SC, Noto Serif SC, Source Han Sans, Source
  Han Serif, LXGW WenKai and 霞鹜文楷.

## 4. Colour as the only hierarchy

On a dense sheet, colour is what makes it navigable, and it has to be systematic:
a fixed palette of five or six roles, each with one meaning, applied by a paragraph
style or a character style rather than run by run.

| role                | typical use                                   | mechanism                                    |
| ------------------- | --------------------------------------------- | -------------------------------------------- |
| section banner      | a topic block heading, on a tinted background | paragraph shading `w:shd/@w:fill` on `w:pPr` |
| sub-section heading | a sub-topic                                   | bold text in a single accent colour          |
| key term            | vocabulary a candidate must recall            | text colour, one accent                      |
| process or step     | a named procedure                             | text colour, a second accent                 |
| category label      | "advantages", "pitfalls"                      | bold text in a third accent                  |
| inline key          | a `key: value` pair                           | bold or plain, a muted accent                |

Rules that keep the palette honest:

- One meaning per colour. A colour that marks both "term" and "step" marks nothing.
- Tinted backgrounds come from `w:shd/@w:fill` with `w:val="clear"` and a real hex
  fill. `w:val="clear"` with a fill of `000000`, `auto`, or empty is the "whole cell
  turned black" failure that `shading-type` reports.
- Contrast is a print question, not a screen question. A pale tint that reads on a
  monitor disappears on a mono laser printer; a dark tint eats the toner and the
  text with it.
- Greyscale must still work. Print one page in black and white before delivering —
  if two categories become indistinguishable, they needed weight or position, not
  only hue.

## 5. Question numbering

- Questions are a real numbered list: `w:numPr` on each question paragraph, with a
  `numId` from `word/numbering.xml`. Typed numbers do not renumber and do not
  survive an inserted question.
- Each question group — 选择题, 判断题, 简答题, 计算题 — has its own numbering
  definition so it restarts at 1.
- **`numbering-continuity` requires the `numId` values in use to be contiguous
  integers.** Four question groups numbered with `numId` 1, 3, 7 and 9 fail the rule
  even though the document renders correctly. Either renumber the definitions to be
  contiguous, or scope the gate with `--only` and record why.
- Scores sit at the right margin of the question line: a right-aligned tab at the
  right margin, then `（本题 10 分）`. Not a table cell — a score column as a table
  drags `table-pagination` and `table-margins` into a document that has no data
  table.

## 6. Answer space

- Blank space for a handwritten answer is a paragraph with a fixed height: an empty
  paragraph with a `w:spacing/@w:line` large enough to hold the answer, or several
  of them. Five or more consecutive empty paragraphs is what `blank-pages` counts as
  a blank page, so a long answer area is one paragraph with a tall line, not eight
  empty ones.
- An answer line is a paragraph with a bottom border (`w:pBdr/w:bottom`), repeated
  per line. It reflows with the text; a typed run of underscores does not.
- A machine-read answer sheet is a table, and then it is a real table: `w:tblHeader`
  on the header row, `w:cantSplit` on every row, `w:tcMar` on every cell.

## 7. The instructions block

- A short "考生须知" block at the top: total marks, time allowed, closed or open
  book, whether a calculator is permitted.
- It is body prose, so it is subject to the body rules: Chinese paragraphs of twenty
  or more characters that are not centred, not in a table and not list items need a
  first-line indent in the 200–800 twip range, and every body paragraph outside
  tables and lists must share one `w:spacing/@w:line` value.
- The indent must be `w:ind/@w:firstLine`. Word's `w:firstLineChars="200"` renders
  identically but is not what the rule reads.

## 8. Fitting the content

When the sheet does not fit, the order of preference is:

1. Cut content. A reference sheet that covers everything covers nothing.
2. Tighten the wording.
3. Reduce the column gap (`w:cols/@w:space`).
4. Reduce the leading (`w:spacing/@w:line`).
5. Reduce the font size (`w:sz` in half-points — 5 pt is `w:sz w:val="10"`).
6. Add a column.

Shrinking type first is the failure mode: a sheet at 3 pt is not a dense sheet, it
is an unreadable one, and it prints worse than it looks.

## 9. Self-check before handing this over

- Page orientation and paper size match the intent.
- Column count and gap set in the section properties, not in a table.
- Every question group's numbering definitions contiguous, or the gate scoped.
- No run of five or more consecutive empty paragraphs.
- Every multi-row table carrying `w:tblHeader`, `w:cantSplit` and `w:tcMar`.
- One line-spacing value across all body paragraphs.
- One meaning per colour, and the sheet still readable in greyscale.
- `postcheck.py exam.docx --only blank-pages,line-spacing,numbering-continuity,table-pagination,table-margins,font-fallback,shading-type`
  — a single-section paper fails `cover-separation` by design.

## Source

The structure of this brief — the landscape A4 sheet with deliberately tight
margins, the seven-column layout driven from the section properties, the column
break as the unit of topic placement, the colour-coded markup palette with one
meaning per colour (tinted section banner, accent sub-headings, teal key terms,
purple process names, green category labels, muted inline keys), and the order of
preference for fitting content — follows the conventions of:

    Purestone/chitshit
    https://github.com/Purestone/chitshit
    Copyright (c) 2025 Puyan
    MIT License — https://github.com/Purestone/chitshit/blob/main/LICENSE

The knowledge above is restated in this repository's own words and in `.docx` terms;
no upstream file is distributed with this plugin.
