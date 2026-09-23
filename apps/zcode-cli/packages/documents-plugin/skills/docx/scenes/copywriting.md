# Brief — Copywriting and short-form documents

Applies to a landing page's text, a product announcement, a press release, a
one-page pitch, a slogan sheet, and any document whose job is to be read once and
acted on. The constraints are the opposite of a report's: the page budget is small,
the margins are generous, and the hierarchy has one level.

## 1. One page, one idea

- Decide the deliverable's length before writing: a headline plus three supporting
  blocks, or one page of body copy, or a press release of a fixed shape.
- Fit by cutting, never by shrinking type or tightening the leading. Short-form copy
  that has been compressed to fit reads as dense, and dense is the one property this
  kind of document cannot have.
- A second page is acceptable when the content genuinely needs it. A second page
  holding three lines is not.

## 2. Margins and whitespace

- Margins 2.5–3 cm all round, wider than a report's. Whitespace is the layout here;
  it is what tells the reader where one idea ends and the next begins.
- Space between blocks is paragraph spacing, not empty paragraphs. Five or more
  consecutive empty paragraphs is what `blank-pages` counts as a blank page, so a
  document that spaces its blocks with blank lines eventually trips the gate.
- A single accent element — one rule, one tinted block, one image — is enough. Two
  competing accents cancel each other.

## 3. Title hierarchy

- One `heading 1`, which is the headline. That is the whole hierarchy in most
  short-form documents.
- If the body needs internal structure, use `heading 2` under it. Never jump to
  `heading 3`: `heading-continuity` compares the numeric suffix of each heading
  style and reports every skip.
- The headline is a real heading paragraph, not a run made large and bold by hand.
  A hand-formatted headline is invisible to the outline and to the gate.
- Do not number headings in copy. A numbered headline in a product announcement
  reads as a manual that lost its content.

## 4. Paragraphs and lines

- One idea per paragraph. Three sentences is long; one is normal.
- Left-aligned, ragged right, for short-form Latin text — justification only pays
  off in a measure wide enough to need it, and short lines justify badly.
- Centred text for a headline, a pull quote, or a call to action. Centred body copy
  is not a layout choice, it is an unreadable one.
- No first-line indent. Short-form copy separates paragraphs with space, not with an
  indent, and a first-line indent on a two-line paragraph is noise.
- One `w:spacing/@w:line` value across every body paragraph outside tables and
  lists. `line-spacing` counts distinct values; a document where the intro paragraph
  has 1.5 and the rest have 1.15 fails.

## 5. Chinese copy and the indent rule

Chinese body paragraphs of twenty or more characters that are not centred, not in a
table and not list items need a first-line indent in the 200–800 twip range
(`cjk-indent`). Short-form copy wants no indent, so the rule and the genre pull in
opposite directions. Four ways out, in order of preference:

1. Keep paragraphs short. Under twenty characters the paragraph is treated as a
   label, not as body text, and the rule does not apply.
2. Centre the block. Centred paragraphs are exempt.
3. Make it a list. List items are exempt, and a short-form document with three
   benefits genuinely is a list.
4. Accept the indent. A 200-twip first-line indent on a Chinese paragraph is not
   wrong; it is the convention this repository checks for.

Whatever is chosen, it must be `w:ind/@w:firstLine`. Word writes
`w:firstLineChars="200"` for a two-character indent and it looks identical, but the
rule reads only `@w:firstLine`.

## 6. Type and colour

- A display face for the headline and one body face. Two families; a third is
  decoration.
- The headline is two to three steps above body size. Body 10.5–11 pt for a printed
  one-pager, 11–12 pt for anything read on screen.
- One accent colour, used for the call to action and nothing else.
- For Chinese copy: 黑体 or 宋体 for the headline, 宋体 or 仿宋 for the body. All
  safe. `font-fallback` flags only Noto Sans SC, Noto Serif SC, Source Han Sans,
  Source Han Serif, LXGW WenKai and 霞鹜文楷.

## 7. Page furniture

- No table of contents, no running head, no list of figures. There is nothing to
  navigate.
- A page number is optional. When there is one it is a `PAGE` field in the footer,
  and a freshly built footer often carries the bare keyword with no format switch —
  WPS then prints the instruction instead of the number. Run
  `python3 fix_footer_fields.py copy.docx` before delivering.
- A single-section document fails `cover-separation` by design. Scope the run with
  `--only`.

## 8. Self-check before handing this over

- One `heading 1`; no skipped heading level.
- One line-spacing value across all body paragraphs.
- No run of five or more consecutive empty paragraphs.
- Two font families at most; no fallback-risk font declared.
- Any Chinese body paragraph of twenty or more characters either centred, a list
  item, under twenty characters, or carrying a `w:ind/@w:firstLine` in 200–800 twips.
- `postcheck.py copy.docx --only blank-pages,line-spacing,cjk-indent,heading-continuity,font-fallback,image-overflow`

## 9. Palette for copy

Copywriting is the one scene where the palette is allowed to be warm, and the
rules still hold:

- The Warm recipe from `references/design-system.md` §9 (`field #FAF7F2`,
  `ink #2C2C2C`, `support #D9CBB8`, `accent #C15937`) is the default; Muted is
  the internal-note variant.
- The accent appears on the headline's key word and nowhere else. One accent,
  fewer than five accented elements per page.
- A tinted field (`tint10`) behind the opening paragraph is the only panel a
  copy document needs.
- Greyscale must work: photocopy the page, or convert it, and check the
  hierarchy survives without the hue.

## 10. Scene-specific quality checks

Beyond the shared checklist in `common-rules.md`:

- [ ] One idea per page, and the idea is stated in the first line.
- [ ] The word budget from the routing held: no page needed cutting to fit.
- [ ] The title hierarchy has exactly three levels, and no fourth level
      appears anywhere.
- [ ] Every paragraph is at most four lines; a fifth line means the paragraph
      is two paragraphs.
- [ ] Chinese copy uses the indent rule (§5) consistently — no mixed
      first-line-indent and space-between styles.
- [ ] The palette is one of the two copy recipes, and the accent count on the
      busiest page is under five.
- [ ] Nothing is centred that is not a title or a short label — centred body
      copy is the defect that makes copy look generated.
- [ ] The document still reads correctly in greyscale.
