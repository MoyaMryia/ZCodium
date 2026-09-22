# Brief — Resumes and CVs

Applies to one-page resumes, two-page CVs and short professional profiles. The
constraints here are different in kind from a report's: the page budget is fixed
before a single line is written, and the document is read by a parser before it is
read by a person.

## The one-page constraint

Treat the page budget as a hard input, not an outcome.

- Decide the page count from the content first: one page for a resume with under
  roughly eight years of experience, two for a CV with publications, teaching or a
  long project list. Then fit the content to it.
- Fit by cutting content, not by shrinking type. The order of preference is:
  drop a section, drop a bullet, tighten the wording, and only then reduce the
  leading or the margins.
- Margins 1.5–2 cm. Below 1.5 cm a resume prints badly and looks like it is
  hiding something.
- Body size 10–11 pt. Never below 10 pt to make room — at that point the document
  is being made unreadable to satisfy a page count that should have been met by
  deleting a bullet.
- Set `\raggedbottom` so a short final page does not stretch its spacing to fill
  the sheet.
- Name and contact details in a full-width block at the top, before any column
  structure begins.

## Information density

- Reverse chronological within every section, most recent first, with consistent
  date formatting throughout. A reader scans the top entry of each section and
  stops.
- Dates right-aligned on the same line as the role or degree, in a `tabular` or
  with `\hfill`. Left-aligned dates that drift per entry read as sloppiness.
- Bullets under each role, action verb first, one achievement per bullet, and a
  number wherever a number exists. "Reduced build time by 40%" carries information
  that "Improved build performance" does not.
- Section order: experience, then projects or education depending on which is
  stronger, then skills, then the short list of extras. Education first only for a
  new graduate.
- No objective statement, no "references available on request", no photo unless
  the market the resume is aimed at expects one.
- Every line earns its place. A resume is a list of claims, not a narrative.

## ATS readability

Applicant tracking systems parse the PDF's text layer before any human sees it.
This is the part that a purely visual review misses.

- **Real, selectable text.** No image of a resume, no scanned page, no text baked
  into a figure. Verify by selecting text in a viewer, or by extracting it.
- **Embedded fonts.** A font that is not embedded may render as a substitute on
  the reader's machine, and extraction can return garbage. Check `pdffonts`; `emb`
  must be `yes` for every font.
- **Standard section headings.** "Experience", "Education", "Skills" — spelled
  plainly. A creative heading like "Where I've Been" can be dropped by a parser
  that is looking for a known section name.
- **Contact details as plain text**, not only inside a header/footer or a logo
  image, and not split across lines in a way that breaks the email address.
- **Build with a Unicode engine** (`xelatex` / `lualatex`) so the text layer keeps
  correct character codes; `pdflatex` with a legacy encoding can extract accented
  characters and ligatures incorrectly.
- **No text in tables for the critical fields.** Name, contact, employer names,
  job titles, dates and degrees read left-to-right through a table's cell order,
  which a parser may reassemble in the wrong sequence.
- **Keep the two-column structure shallow.** See below.
- **Links as real hyperlinks** with visible text, so a printed copy still carries
  the address.

## Columns

Two columns buy density and cost parseability. Both effects are real, so the
split is deliberate:

- Name and contact full width at the top. They are the fields a parser keys on.
- The left column, roughly 62–65% of `\textwidth`, carries experience and
  education — the content that must be read in order.
- The right column carries skills, tools, languages, certifications — short,
  scannable, order-independent items where a misread sequence costs nothing.
- `paracol`, or two `minipage` environments of fixed width inside a `noindent`
  row. `multicol` balances its columns automatically, which is wrong here: the two
  columns have deliberately different lengths.
- Never let a single role or degree straddle the column break. Each entry stays
  inside one column, whole.
- Check the reading order after extraction. If the parser emits the right column
  before the left, the section ordering has been lost and the document needs
  restructuring, not a different package.

## Typography

- One family for headings and one for the body, or a single family at two weights.
  Three or more families on one page is decoration, not hierarchy.
- Bullets with `enumitem`, tight spacing (`itemsep` near zero, `parsep` small).
  Default list spacing wastes a fifth of a page.
- Section rules — a single `\rule` or a `titlesec` rule under each heading — give
  the scan structure that colour cannot be relied on to give in a printed or
  greyscale copy.
- Consistent capitalisation and punctuation across all section headings.
- Hyperlinks in a restrained colour, underlined or not, but present.

## Self-check before handing this over

- Exactly the intended page count (`pdfinfo`). One page means one page.
- Page size matches the target market's stock — A4 or Letter, not both.
- Text extracts in a sensible order; the email address survives extraction intact.
- Every font embedded (`pdffonts`).
- No overfull `hbox` pushing a line past the margin.
- Dates aligned on every entry, formatting identical throughout.
- No entry split across the column break.
- Nothing below 10 pt.
