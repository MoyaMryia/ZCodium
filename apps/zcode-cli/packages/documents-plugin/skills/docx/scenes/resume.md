# Brief — Resumes and CVs

Applies to a one-page resume, a two-page CV, and the short professional profile
that is emailed rather than printed. A resume is read twice: once by a parser that
extracts the text, once by a person who spends ninety seconds on it. Every decision
below serves the second reading without breaking the first.

## 1. The page budget is an input

Decide the page count before writing, then fit the content to it.

- One page for a resume under roughly eight years of experience; two for a CV with
  publications, teaching, or a long project list.
- Fit by deleting, never by shrinking type. The order of preference is: drop a
  section, drop a bullet, tighten the wording, and only then reduce the leading.
- Body size 10.5–11 pt. Nothing below 10 pt — at that point the document is being
  made unreadable to satisfy a page count that should have been met by deleting a
  bullet.
- Margins: left and right 2 cm, top 1.8 cm, bottom 1.4 cm. Below 1.5 cm a resume
  prints badly and reads as if it is hiding something.
- No running head. A resume has one page of authority; a header repeating the
  owner's name on page two spends it.

## 2. The header block

Name and contact details form a full-width block at the top, before any column
structure begins.

- Name centred, one or two steps above body size, in the heading family.
- Contact on the next line, centred, in the body family at body size: email, phone,
  location, and one link. Icons are optional; the text is not.
- Contact details are plain paragraphs, not a table. A parser reads a table's cell
  order and may reassemble the fields in the wrong sequence.
- The block is followed by a rule, not by extra empty paragraphs. Five or more
  consecutive empty paragraphs is what `blank-pages` counts as a blank page.

## 3. Section headings

- One heading level only. A resume has no subsections, so `heading-continuity` has
  nothing to gap-check; adding a second level invites a skip.
- Heading text left-aligned, a step above body size, small capitals or bold, with a
  single horizontal rule underneath. In OOXML the rule is a `w:pBdr/w:bottom` on the
  heading paragraph — a paragraph border, not a drawn line and not a table.
- No numbering. A numbered section heading ("1. Experience") on a resume reads as a
  report that lost its chapters.
- Standard section names, spelled plainly: Experience, Education, Skills, Projects.
  A parser looking for a known heading drops a creative one.

## 4. Entries, and where the date goes

- Reverse chronological inside every section, most recent first, with one date
  format throughout. A reader scans the top entry of each section and stops.
- The date is right-aligned on the same line as the role or degree. The OOXML
  mechanism is a right-aligned tab stop at the right margin with the date after a
  `w:tab`; a table with the date in a second column also works but then
  `table-margins` and `table-pagination` both apply to it (§7).
- Role or degree on its own line, employer or institution on the same line or the
  next, then bullets. One achievement per bullet, action verb first, and a number
  wherever a number exists.
- Never let an entry straddle a page break. `w:keepNext` on the role line and
  `w:keepLines` on the bullets keep an entry whole.

## 5. Bullets

- A real list: `w:numPr` on each paragraph with a `numId` from `word/numbering.xml`.
  A typed hyphen is not a list, and `numbering-continuity` only sees real ones.
- Tight vertical spacing. Default list spacing wastes a fifth of a page.
- List items are exempt from `cjk-indent` — that is what makes a Chinese-language
  resume's bullets legal without a first-line indent.
- Bullets are also exempt from `line-spacing`, which only counts body paragraphs
  outside tables and lists. Set the prose paragraphs to one spacing value and the
  bullets may keep their own.

## 6. Two columns, and why not a table

Density buys readability and costs parseability. Both are real, so the split is
deliberate.

- Name and contact stay full width. They are the fields a parser keys on.
- Use a real column section: `<w:cols w:num="2" w:space="425"/>` inside the
  section's `w:sectPr`. Word balances and flows the columns itself.
- **Do not build the columns out of a table.** A multi-row layout table with no
  `w:tblHeader` header row fails `table-pagination`, and every row additionally
  needs `w:cantSplit` to pass the same rule. A one-row table is not exempt — the
  rule counts rows lacking `cantSplit` across every table, including a single-row
  one. Every cell also needs `w:tcMar` padding to pass `table-margins`, and a
  layout table has no padding to give.
- The left column carries experience and education, the content that must be read in
  order. The right column carries skills, tools, languages and certifications —
  short, order-independent items where a misread sequence costs nothing.
- No entry spans the column break. Each one stays inside one column, whole.

## 7. A photo

Only when the market the resume is aimed at expects one, and then it is an inline
image sized against the text column. `image-overflow` compares an image's width in
EMU against the narrowest usable text column across all sections, at 635 EMU per
twip; a photo wider than the column fails the gate. Width, not height, is what is
measured.

## 8. Chinese-language resumes

- The body face is a serif Chinese face (宋体) or a sans one (黑体); the heading
  face is the other one. Two families, no more.
- Do not declare Noto Sans SC, Noto Serif SC, Source Han Sans, Source Han Serif,
  LXGW WenKai or 霞鹜文楷. `font-fallback` flags all six as fonts that only exist on
  the build machine.
- A summary paragraph of twenty or more Chinese characters, not centred and not a
  list item, needs a first-line indent in the 200–800 twip range. Bullets and the
  centred contact line are exempt; a prose paragraph is not.
- The indent must be `w:ind/@w:firstLine`. Word's `w:firstLineChars="200"` — the
  usual way to ask for a two-character indent — is not read by the rule and the
  paragraph is reported as unindented.

## 9. Self-check before handing this over

- Exactly the intended page count. One page means one page.
- Every date aligned and formatted identically.
- No entry split across a page or column break.
- Nothing below 10 pt.
- The email address survives text extraction intact, as one token.
- `postcheck.py out.docx --only blank-pages,line-spacing,image-overflow,font-fallback,cjk-indent,heading-continuity,table-pagination,table-margins`
  — a one-section resume fails `cover-separation` by design, so scope the run.

## Source

The structure of this brief — the centred name and contact block, the ruled
left-aligned section heading with no number, the date right-aligned on the entry
line, the zero paragraph indent, the tight list spacing and the 11 pt body — follows
the conventions of:

    billryan/resume
    https://github.com/billryan/resume
    Copyright (c) Bill Ryan (upstream LICENSE leaves the holder line blank)
    MIT License — https://github.com/billryan/resume/blob/master/LICENSE

The knowledge above is restated in this repository's own words and in `.docx` terms;
no upstream file is distributed with this plugin.
