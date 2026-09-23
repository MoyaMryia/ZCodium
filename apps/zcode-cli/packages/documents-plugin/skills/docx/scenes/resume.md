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

## 10. Resume type routing

Not every resume is the same document. Route on the first read, because the
type changes the page budget, the section order, and what counts as evidence.

| type | who | what changes |
| --- | --- | --- |
| **General** (default) | any professional role | experience-first; sections in reverse-chronological order |
| **New graduate** | ≤ 2 years, no full-time history | education moves above experience; projects and coursework carry the weight a work history cannot |
| **Technical role** | engineering, data, infra | a skills block near the top, named tools with the level of use stated; projects over duties |
| **Academic CV** | research, faculty positions | publications and grants first, in a full list; no page budget; teaching and service included |

The routing is a decision, not a discovery: if the input does not say which,
ask once. A new-graduate resume built on the general template buries the only
evidence the candidate has.

## 11. Input processing rules

- **Never invent.** A date range, a title, a metric or a tool that is not in
  the input does not appear. A missing field renders as an explicit gap to
  fill, never as a plausible guess.
- **Dates are ranges or single points, consistently.** `2021.03–2023.07` or
  `Mar 2021 – Jul 2023`; mixing formats within one document is the defect a
  reviewer notices first.
- **One entry per role**, not per task: the role carries the title, the
  organisation, the dates; the bullets carry what was done.
- **Quantify only what was given.** "Reduced load time by 40%" is input;
  "significantly improved performance" is padding; "improved performance"
  without a number is what the input said, and stays as it was.
- **Contact block is verified, not assumed**: the email and phone in the
  document are the ones the candidate supplied, character for character.

## 12. Content quality constraints

### Core principles

- **Every bullet is an achievement or a responsibility, never a duty
  statement.** "Responsible for the build system" says nothing; "migrated the
  build from Make to Bazel, cutting CI time from 22 to 9 minutes" is a bullet.
- **Verb first, past tense, active voice.** Led, built, migrated, shipped —
  not "was responsible for", not "helped with".
- **One claim per bullet.** A bullet with two claims reads as two half-claims.
- **No first person.** "I led" → "Led". The pronoun costs space and buys
  nothing.
- **Tail tense**: current roles in the present tense, past roles in the past.

### Experience writing standards

- **Scope, then action, then result**: what you owned, what you did, what
  changed. Three clauses, one bullet.
- **Tools appear where they were used**, not in a separate list unless the
  type routing put a skills block at the top.
- **Promotions and role changes inside one organisation** are separate entries
  with their own dates — the progression is the evidence.
- **Gaps are not hidden and not explained in the document.** A date range that
  ends is a date range that ends; the interview is where the conversation
  happens.

### Profile summary / self-assessment

- Three lines maximum, at the top, below the header block.
- It states the role being sought, the years of relevant experience, and the
  one thing the candidate is known for — nothing else.
- No adjectives that cannot be checked: "results-driven", "team player",
  "passionate" are all deleted on sight. The summary that survives is the one
  a reviewer could verify from the bullets below it.
