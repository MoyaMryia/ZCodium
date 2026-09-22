# Brief — Contracts and agreements

Applies to a sales contract, a service agreement, an NDA, a lease, and any document
whose authority comes from being citable clause by clause. A contract is not a
report: it is read for one clause at a time, by someone looking for the number.

## 1. The four parts

| part | contents                                                               |
| ---- | ---------------------------------------------------------------------- |
| 首部 | title, party identification, recitals (鉴于…)                          |
| 正文 | definitions, then the operative clauses                                |
| 尾部 | signature and seal block, effective date, attachments list             |
| 附件 | schedules, annexes, technical specifications — numbered 附件一, 附件二 |

The recitals are not decoration. They are the context a court reads when the
operative text is ambiguous, and they belong before clause 1, numbered with the same
scheme or set as unnumbered paragraphs under a heading.

## 2. Clause numbering

- Three levels: `第一条` / `1.1` / `1.1.1`. Articles run continuously through the
  whole contract; sub-clauses restart at each article; sub-sub-clauses restart at
  each sub-clause.
- Each level is a separate numbering definition in `word/numbering.xml` with its own
  indents, so a level change is a style change and not a re-typed number.
- The number belongs to the paragraph, not to the text. A typed `1.1` does not
  renumber when a clause is inserted, and a contract that gains a clause mid-life is
  the normal case.
- **`numbering-continuity` requires the `numId` values actually in use to be
  contiguous integers.** A contract assembled from clauses copied out of three
  templates typically ends up with `numId` 1, 4, 7 — the document renders correctly
  and the gate reports a gap. Renumber the definitions to be contiguous before
  delivering.
- Cross-references (`按照第 5.2 条`) are text, so they drift when clauses move.
  Either re-check them after any structural edit, or use a cross-reference field that
  resolves the clause number. A stale cross-reference in a contract is worse than a
  missing one.

## 3. Defined terms and consistency

- Definitions live in one clause near the top, quoted and bold on first use, and
  then used verbatim everywhere. "The Supplier" and "供应商" in the same contract is
  two parties.
- Amounts appear in both Arabic numerals and Chinese characters, so a transcription
  error in one form is visible against the other: `¥1,200,000.00` beside
  `人民币壹佰贰拾万元整`.
- Dates in ISO form (`2026-09-22`) or in the local long form, one of them throughout.
  A contract mixing `2026/9/22` and `22 September 2026` invites an argument about
  which one governs.
- Units, currency and rounding rules stated once, in a definitions or interpretation
  clause, rather than repeated per clause where they can disagree.

## 4. Layout

- Body 10.5–12 pt, one family, justified, first-line indent of two characters for
  Chinese body paragraphs.
- The indent must be `w:ind/@w:firstLine` in the 200–800 twip range. Word writes
  `w:firstLineChars="200"` for a two-character indent and it looks identical, but the
  rule reads only `@w:firstLine`.
- One `w:spacing/@w:line` value across every body paragraph outside tables and
  lists. Two values fail `line-spacing`, and a contract whose clauses have different
  leading reads as two documents stapled together.
- Headings are real heading styles, contiguous, so the outline and any table of
  contents work. A long contract carries a table of contents; a two-page NDA does
  not.
- No page number restart anywhere. See §6.

## 5. The signature block

- Two parties, one per side, on the same line or on facing halves of the page:
  `甲方（盖章）` on the left, `乙方（盖章）` on the right, a right-aligned tab at the
  right margin to place the second.
- Under each: 法定代表人或授权代表（签字）, then an underlined blank for the
  signature, then 日期 with an underlined blank.
- The underline is a bottom border — `w:pBdr/w:bottom` on the run's paragraph, or a
  cell's `w:tcBorders/w:bottom` — never a typed run of underscores. A typed rule does
  not survive an edit, does not align, and looks wrong the moment the font changes.
- The two-column layout is a two-cell borderless table when each side needs several
  lines. If it is a table, then it is a table for the gate's purposes: `w:tcMar`
  padding on every cell (`table-margins`), and because it has more than one row it
  needs `w:tblHeader` on a row plus `w:cantSplit` on every row (`table-pagination`).
  A signature block split across a page break is a real defect, so `w:cantSplit` is
  worth adding for its own sake.
- The effective date and the signature dates are different fields. The effective date
  is a clause; the signature date is written by hand at signing.

## 6. Page numbering is one continuous sequence

This is the rule a contract breaks most often, because the document is assembled
from parts.

- One numbering sequence, running from the first page to the last, including the
  signature page and every attachment. A reader citing "page 12 of the Agreement"
  means one document.
- Continuity is expressed by the absence of a restart: a section's
  `<w:pgNumType w:fmt="decimal"/>` with no `w:start` attribute continues from the
  previous section. A `w:start` on a later section is a restart, and a restart in the
  middle of a contract is a defect.
- **Do not leave an empty `<w:pgNumType/>` on any section.** `fix_footer_fields.py`
  drops those, because WPS reads an empty one as an instruction to restart numbering
  — which is exactly the failure it exists to prevent. Run
  `python3 fix_footer_fields.py contract.docx` before delivering.
- To suppress the number on page 1 without breaking continuity, use a different
  first page: `<w:titlePg/>` in the section properties plus an empty first-page
  footer. Restarting the sequence at 0 to hide the first number is not the same
  thing and is wrong.
- The page number is a `PAGE` field in the footer. A freshly built footer often
  carries the bare keyword with no format switch, and WPS then prints
  `PAGE \* arabic \* MERGEFORMAT` where the number belongs — `fix_footer_fields.py`
  §1 in `routes/format.md` is the repair.
- A contract has no cover section in the report sense, so `cover-separation` reports
  `only one section` for a single-section agreement. That is the rule working as
  designed; scope the run with `--only` and record why.

## 7. Attachments and a revision record

- Attachments start after the signature block, each on a new page, each titled
  `附件一 …` and referenced from the clause that introduces it.
- A revision record at the end — version, date, author, what changed — is what makes
  a contract maintainable. It is a small table, and it is a real table:
  `w:tblHeader` on the header row, `w:cantSplit` on every row, `w:tcMar` on every
  cell.

## 8. Self-check before handing this over

- One page-numbering sequence, no restart, no empty `w:pgNumType` anywhere.
- Page number present on every page except a deliberately suppressed first page.
- `numId` values in use contiguous, or the gate scoped and the reason recorded.
- One line-spacing value across all body paragraphs.
- Every Chinese body paragraph carrying `w:ind/@w:firstLine` in 200–800 twips.
- No typed underscores used as a rule.
- Cross-references re-checked after any clause insertion or deletion.
- `postcheck.py contract.docx --only line-spacing,cjk-indent,numbering-continuity,heading-continuity,table-pagination,table-margins,font-fallback,blank-pages`
