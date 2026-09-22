# Brief — Chinese official documents (公文)

Applies to a 党政机关公文, an administrative notice, a formal letter of reply, and
any document whose shape is fixed by GB/T 9704. The standard is the authority here;
where this brief and the standard disagree, the standard wins.

## 1. Page geometry

- A4, and the margins are not a taste decision:

| edge           | distance |
| -------------- | -------- |
| top            | 3.7 cm   |
| bottom         | 3.5 cm   |
| left (binding) | 2.8 cm   |
| right          | 2.6 cm   |

That leaves a text block of about 156 × 225 mm, which is what makes the line and
character counts below come out right. Change the margins and the 22-lines-per-page
convention stops holding.

In OOXML the margins live in the section's `w:pgMar` as twips (1 cm = 567 twips) and
the paper size in `w:pgSz`. `image-overflow` derives the usable column from those
numbers, so an image sized by eye against the wrong margins fails the gate.

## 2. The 版头 — document head

Top to bottom, before the title:

| element        | convention                                                                  |
| -------------- | --------------------------------------------------------------------------- |
| 份号           | serial number, top left, only when the document is numbered                 |
| 密级和保密期限 | e.g. `秘密★1年`, below 份号                                                 |
| 紧急程度       | `特急` or `加急`, below the classification                                  |
| 发文机关标志   | the issuing body's name, red, centred, large                                |
| 发文字号       | e.g. `×政发〔2026〕12号`, centred below the emblem                          |
| 签发人         | the signer's name, right-aligned on the same line as 发文字号, on an 上行文 |
| 分隔线         | a full-width red rule under the 发文字号                                    |

The red rule is a paragraph bottom border (`w:pBdr/w:bottom`) on the 发文字号
paragraph, with the colour and width set in `w:bottom/@w:color` and `@w:sz`. Not a
drawn line, not an image, not a typed rule.

The 份号, classification and urgency are ordinary paragraphs at body size, left
aligned, with no first-line indent. They are short, so the indent rule does not
apply to them (see §5).

## 3. The 主体 — body

- **标题** — the document title, 2 号 小标宋体, centred, one or two lines. It may
  break across lines but must break at a phrase boundary, never mid-word.
- **主送机关** — the recipient body, 3 号 仿宋, flush left at the top of the text
  block, followed by a colon.
- **正文** — 3 号 仿宋\_GB2312, first line indented two characters, about 22 lines to
  a page and 28 characters to a line.
- **附件说明** — `附件：1. …` at the left margin after the body, before the signature.
- **发文机关署名** and **成文日期** — right aligned, the date in Arabic numerals
  (`2026年9月22日`), with the seal over the date.
- **附注** — `（联系人：…；电话：…）` in parentheses, left aligned, below the date.
- **附件** — the attachments themselves, each starting on a new page with
  `附件` at the top left and its own number.

## 4. Structural levels

The convention is fixed, and it is a font convention rather than a numbering one:

| level | form                 | face                 |
| ----- | -------------------- | -------------------- |
| 1     | `一、` `二、` `三、` | 黑体                 |
| 2     | `（一）` `（二）`    | 楷体                 |
| 3     | `1.` `2.`            | 仿宋 (bold optional) |
| 4     | `（1）` `（2）`      | 仿宋                 |

The level marker is part of the heading text at levels 1 and 2, and a real numbered
list at levels 3 and 4 — where `w:numPr` renumbers correctly. A typed `1.` at level
3 does not.

## 5. Body text mechanics

- First-line indent of two characters. 3 号 is 16 pt, so two characters is 640 twips
  — inside the 200–800 range the rule accepts.
- **The indent must be `w:ind/@w:firstLine`.** Word writes
  `w:firstLineChars="200"` for a two-character indent, it renders identically, and it
  is not what `cjk-indent` reads. A 公文 built the Word way is reported as unindented
  throughout.
- Line spacing: one fixed value for the whole body, so that a page holds 22 lines. At
  a 225 mm text block that is about 28.9 pt — `w:spacing/@w:line="580"` with
  `w:lineRule="exact"`. Use `atLeast` rather than `exact` if the document contains
  anything taller than a line of 3 号 text, because `exact` clips it.
- One value, everywhere, outside tables and lists. `line-spacing` counts distinct
  values in body paragraphs; two of them fail the rule.
- The head elements (份号, 密级, 紧急程度) and the 附注 are exempt: they are under
  twenty characters, and the rule treats a short paragraph as a label rather than as
  body text.

## 6. The 版记 — document tail

- 抄送机关 and 印发机关和印发日期 sit at the bottom of the last page, separated from
  the body by rules.
- The rules are paragraph borders again: a `w:pBdr/w:top` on the first 版记 paragraph
  and a `w:pBdr/w:bottom` on the last.
- 版记 is 4 号 仿宋, one step below body size.
- A 版记 that lands mid-page is acceptable; one that lands on a page of its own is
  not. Keep it with the last body paragraph (`w:keepNext`) if it is at risk.

## 7. Page numbers

- 4 号 宋体 Arabic numerals, with a thin rule on each side of the digits —
  `— 1 —`, not `1`.
- Odd pages: the number sits at the right margin, one character in from the edge.
  Even pages: at the left margin, one character in. That needs
  `<w:evenAndOddHeaders/>` in `word/settings.xml`, plus a default (odd) footer and a
  separate even footer referenced with `w:type="even"`.
- No page number on the first page of the document: `<w:titlePg/>` in the section
  properties with an empty first-page footer. Do not express this by restarting
  numbering.
- Numbering is one continuous sequence. A section's `<w:pgNumType w:fmt="decimal"/>`
  with no `w:start` continues from the previous section.
- **Never leave an empty `<w:pgNumType/>` on a section.** `fix_footer_fields.py`
  drops those, because WPS reads an empty one as an instruction to restart numbering.
  Run `python3 fix_footer_fields.py notice.docx` before delivering.
- The page number is a `PAGE` field. A freshly built footer often carries the bare
  keyword with no format switch, and WPS prints
  `PAGE \* arabic \* MERGEFORMAT` where the number belongs — `routes/format.md` §1 is
  the repair.

## 8. Attachments and multiple documents

- A document with attachments is one section per attachment when an attachment has
  its own numbering, and one section when it does not.
- Attachments restart their own structural numbering but not the page numbering.
- The main document is a single section in the common case, so `cover-separation`
  reports `only one section`. That is the rule working as designed; scope the run
  with `--only`.

## 9. Fonts

- 小标宋, 黑体, 楷体, 仿宋 and 宋体 are the five faces the standard names, and none
  of them is in the fallback-risk list.
- `font-fallback` flags Noto Sans SC, Noto Serif SC, Source Han Sans, Source Han
  Serif, LXGW WenKai and 霞鹜文楷 — fonts that exist on the build machine and
  substitute silently on the reader's. If a machine only has the Noto family, the
  document has to be re-pointed at a font the recipient has, or the font has to be
  embedded.
- Declare the font for the Latin run and the East Asian run separately
  (`w:rFonts/@w:ascii` and `@w:eastAsia`). One attribute does not cover both, and a
  Latin-only declaration leaves the Chinese characters to whatever the reader has.

## 10. Self-check before handing this over

- Margins 3.7 / 3.5 / 2.8 / 2.6 cm; A4; about 22 lines and 28 characters per page.
- Title 2 号 小标宋 centred; body 3 号 仿宋 with a two-character first-line indent.
- Level 1 黑体, level 2 楷体, levels 3 and 4 仿宋.
- One `w:spacing/@w:line` value across every body paragraph.
- Every Chinese body paragraph of twenty or more characters carrying
  `w:ind/@w:firstLine` in 200–800 twips.
- Page numbers as `— N —`, odd right and even left, continuous, none on page 1.
- No empty `<w:pgNumType/>`; `fix_footer_fields.py` run and clean.
- `postcheck.py notice.docx --only line-spacing,cjk-indent,heading-continuity,numbering-continuity,font-fallback,blank-pages,image-overflow`
