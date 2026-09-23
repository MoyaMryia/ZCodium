# Component catalogue

The reusable pieces a document is assembled from. Define each once — in the
preamble or in one CSS file — and use the definition everywhere; a component
invented per page is how a document drifts.

## Title block

- Title, subtitle, author, date, and the document's reference number or version
  when it has one. Nothing else.
- The block is sized for the longest title it must hold; a title that wraps to
  four lines means a smaller display size or a split, not a smaller margin.
- The cover is a separate, fixed-canvas page (`typesetting/cover.md`) — do not
  conflate the two.

## Headings

- One ladder: part / section / subsection, with sizes from
  `typesetting/typography.md`. Numbered when the document is referenced by
  number (procedures, specs), unnumbered when it is read linearly (essays).
- Headings are nouns or noun phrases; they are looked up, not read.

## Body

- One column of 45–75 characters; `twocolumn` beyond that.
- Lists: `itemize` for unordered sets, `enumerate` for sequences a reader will
  refer to by number. Nested past two levels almost always means the content
  wants a table.
- Block quotes for quoted matter; inline code for identifiers, paths and
  commands (`\texttt` or a real listing environment — never bold, never
  quotes).

## Code listings

- `listings` or `minted`, with a frame, a caption, and a language. Line numbers
  on for anything a reader will refer to by line.
- Break long lines deliberately (`breaklines`) or reformat the snippet; a
  listing that runs into the margin is an overflow bug like any other.
- Escape the characters that break the listing parser (`\`, `%`, `_`,
  `#`) — a listing that fails to compile is usually an unescaped underscore in
  a path.

## Tables

- `booktabs` rules, no vertical lines, units in headers, one header row.
- Long tables are `longtable` with `\endhead`; a continuation page without a
  repeated header is a defect.
- Numeric columns right-aligned and decimal-aligned (`siunitx` or
  `dcolumn`); text columns left-aligned.

## Figures

- Vector first; raster only for photographs, 300 dpi at placed size.
- Caption below the figure, first sentence = the claim, then source and method.
- Referenced from the body text, placed near the first reference.

## Callouts and notes

- Three kinds at most: note, warning, and a destructive-action warning. Each is
  a defined environment (or a CSS class) with a fixed visual treatment —
  a `tcolorbox`, or a coloured rule with a label.
- A callout that is not one of the defined kinds is body text.

## Footnotes and margin notes

- Footnotes for citations and asides that would break the sentence; margin
  notes (`\marginpar`) only in documents designed with a wide margin.
- Never both for the same content.

## Front and back matter

- Table of contents for anything over ~10 pages; lists of figures/tables when
  the document is used as a reference.
- Index, bibliography, glossary, changelog — each a decision made once, in the
  front matter plan, not appended at the end.
