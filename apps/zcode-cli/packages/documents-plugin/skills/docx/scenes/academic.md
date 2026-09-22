# Brief — Academic papers

Applies to a journal submission, a working paper, a preprint and a conference paper
that has no publisher-supplied template. When the venue does supply a class, use it
and borrow only the abstract, figure, caption and bibliography parts of this brief.

## 1. Page setup

- A4 or US Letter, decided by where the paper will be read, never mixed inside one
  document.
- Margins: top 2.5 cm, bottom 3 cm, left and right 3.3 cm, footer 1.8 cm from the
  bottom edge. Wider side margins than a report's, because a paper is annotated in
  the margin as often as it is read.
- `\textwidth` — the usable column — is the number every figure and table is sized
  against. In OOXML the equivalent is the section's page width minus both margins;
  `image-overflow` derives it the same way.

## 2. Front matter

- Title, author list, affiliations and the date on a page of their own. That page is
  its own section, which is what lets it carry no page number at all.
- The abstract is a single paragraph, indented on both sides, with no first-line
  indent, preceded by the word "Abstract" in bold. Keywords follow as one line.
- Front matter in roman numerals, the body restarting at arabic 1. Two sections, two
  numbering sequences — see `routes/format.md` §1, which is what makes the roman
  footer print `i` rather than `1`.
- A table of contents is not standard in a journal paper. It belongs in a thesis, a
  long working paper and a survey.

## 3. Headings

- Three levels, used in order, never skipping one. `heading-continuity` compares the
  numeric suffix of each `headingN` style and reports every jump of more than one.
- Level 1 centred, one step above body size, bold. Level 2 left-aligned, bold, body
  size. Level 3 run-in — bold italic on the first line of the paragraph, terminated
  by a period. A run-in level 3 saves a line and reads as a lead-in, not as a
  heading.
- Numbered as `1.`, `1.1`, `1.1.1` with a period after the last component. The
  number is part of the heading text or of the numbering definition, never typed
  twice.

## 4. Theorems, definitions and proofs

An academic paper has three paragraph kinds that are neither body text nor headings.
Each is a paragraph style, so the document stays greppable:

| kind                                                                   | shape                                                                                           |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| theorem, lemma, proposition, corollary, definition, assumption, remark | italic body, small-capitals label, period after the label, one em of space                      |
| proof                                                                  | upright body, label "Proof." in small capitals, ends with a square end-mark at the right margin |
| example                                                                | upright body, label "Example." — not italic, so it does not read as a theorem                   |

The environments share one counter when they belong to the same numbering family
(theorem 3, lemma 4, proposition 5 are one sequence), and restart per section or per
appendix. A counter that does not restart at the appendix produces A.1, A.2 …
continuing from the body, which is what the appendix is for preventing.

The end-mark is a right-aligned tab, not a literal character in the text: a typed
square stops aligning the moment the paragraph reflows.

## 5. Equations

- Display equations are centred and numbered; inline equations are part of the
  sentence and take the sentence's punctuation.
- Number on the right, at the right margin, in parentheses, aligned on the equation.
- Punctuation after a display equation when it ends a sentence, none when the text
  continues.
- See `references/math-formulas.md` for the numbering and alignment mechanics.

## 6. Figures and tables

- Caption **below** a figure, **above** a table. Readers navigate by this
  convention; inverting it makes a caption read as a stray heading.
- Label immediately after the caption, prefixed (`fig:`, `tab:`, `eq:`). A label on
  the float itself resolves to the enclosing counter and produces silently wrong
  references.
- Numbered continuously, or per section with the counter reset — pick one.
- Three horizontal rules on a table, no vertical lines, no boxed grid. Vertical
  rules make a table harder to read, not more precise.
- A table or figure wider than the text column is a defect, not a layout choice.
- A table spanning pages repeats its header row: `w:tblHeader` on the first row and
  `w:cantSplit` on every row, which is exactly what `table-pagination` checks.

## 7. Header, footer and page numbers

- Page number centred in the footer. Nothing in the header on body pages.
- No page number and no header on the title page: its section declares an empty
  footer reference.
- The page number is a `PAGE` field, and a freshly built one often carries no format
  switch. WPS then prints the instruction instead of the number — run
  `python3 fix_footer_fields.py paper.docx` before delivering.

## 8. Bibliography

- One system per document. Author–year or numeric, decided by the venue, never
  mixed — two systems produce two bibliography sections.
- Every entry cited in the text appears in the list and vice versa. An entry nothing
  cites means a citation was dropped in editing.
- The list sits in the back matter, after the appendices, unless the venue asks for
  it before them.
- Hanging indent on every entry, so the author names line up and the eye finds the
  entry it is looking for.

## 9. The appendix

- Numbered `A`, `B`, … with its own counters. Equations, theorems, figures and
  tables all restart at 1 and are prefixed with the appendix letter.
- Cross-references from the body into the appendix keep their prefix, so a reader
  sees `A.3` and knows they have left the main text.

## 10. Self-check before handing this over

- Heading levels contiguous, no skips.
- Abstract on the title page, front matter in roman numerals, body restarting at 1.
- Every figure and table cross-referenced from the body; no orphan entries.
- Every table wider-than-column check passed, every multi-page table repeating its
  header.
- Page numbers present in the body footer and absent on the title page.
- `postcheck.py paper.docx --only heading-continuity,table-pagination,image-overflow,line-spacing,font-fallback,cover-separation`

## Source

The structure of this brief — the geometry, the centred level-1 heading, the run-in
level 3 terminated by a period, the italic theorem body with a small-capitals label
and a period, the proof environment with its right-aligned end-mark, the
caption-above-table and caption-below-figure convention, the centred footer page
number with an empty title page, and the appendix counter reset — follows the
conventions of:

    pmichaillat/latex-paper
    https://github.com/pmichaillat/latex-paper
    Copyright (c) 2022–present Pascal Michaillat
    MIT License — https://github.com/pmichaillat/latex-paper/blob/main/LICENSE.md

The knowledge above is restated in this repository's own words and in `.docx` terms;
no upstream file is distributed with this plugin.
