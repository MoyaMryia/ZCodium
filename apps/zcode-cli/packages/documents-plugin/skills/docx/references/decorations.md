# Decorations

The small amount of ink that is not text: rules, boxes, tints, and the block
diagrams built out of them. This plugin has no drawing canvas — a decoration in a
`.docx` is a paragraph border, a table border, or a cell fill. That is a smaller
toolkit than a vector graphics package, and it is enough for almost everything a
document needs.

## 1. The three primitives, and their OOXML homes

| what you want                          | mechanism                                         | where it lives          |
| -------------------------------------- | ------------------------------------------------- | ----------------------- |
| a rule above or below a paragraph      | `w:pBdr/w:top` / `w:bottom`                       | the paragraph's `w:pPr` |
| a tinted block behind a paragraph      | `w:pPr/w:shd`                                     | the paragraph's `w:pPr` |
| a box around a paragraph               | `w:pBdr` with all four sides                      | the paragraph's `w:pPr` |
| a box around a cell, or one side of it | `w:tcBorders`                                     | the cell's `w:tcPr`     |
| a tinted cell                          | `w:tcPr/w:shd`                                    | the cell's `w:tcPr`     |
| rules inside and around a table        | `w:tblBorders`                                    | the table's `w:tblPr`   |
| a block diagram                        | nested single-cell tables, or bordered paragraphs | as above                |

Everything else — a vector shape, an arrow, a callout — is a `w:drawing` with a
shape inside it, which this plugin can insert as a fragment but cannot build. Prefer
the primitives; they reflow, they print, and they survive an edit.

## 2. Border attributes

A border element carries four attributes:

| attribute | meaning                               | notes                                                              |
| --------- | ------------------------------------- | ------------------------------------------------------------------ |
| `w:val`   | the line style                        | `single`, `dotted`, `dashed`, `double`, `none`, and a dozen others |
| `w:sz`    | the weight                            | **in eighths of a point** — `w:sz="8"` is 1 pt                     |
| `w:space` | the gap between the text and the line | in points, 0–31                                                    |
| `w:color` | the line colour                       | a hex RGB value                                                    |

The `w:sz` unit is the one that surprises people. A rule meant to be hairline is
`w:sz="4"` (0.5 pt); `w:sz="4"` intending 4 pt produces a line four times heavier
than anything else in the document.

Weights come in three sizes and no more:

| use                                                     | `w:sz` |
| ------------------------------------------------------- | ------ |
| hairline, a separator inside a table or under a caption | 4      |
| normal, a rule under a heading or a table's outer frame | 8      |
| heavy, a rule above a 版记 or under a document head     | 12–24  |

`w:space` matters more than it looks. A rule with `w:space="0"` sits on the
descenders; 1–4 pt of space is what makes it read as a rule rather than as a
strikethrough.

## 3. Shading, and the one failure that turns a cell black

A shading element has two colour attributes and a style:

```xml
<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>
```

- `w:val` — the pattern. `clear` means "no pattern, fill the area with `w:fill`";
  `solid` means a solid pattern painted in `w:color`. Reach for `clear` — it is the
  one whose colour attribute is the one you set.
- `w:color` — the pattern (foreground) colour.
- `w:fill` — the background colour, which is the one that shows for `clear`.

**The failure.** `w:val="clear"` with a `w:fill` of `000000`, `auto`, or empty
paints the area in the default colour, which is black. `shading-type` in
`postcheck.py` reports exactly that — a cell whose entire area turned black. It is
the single most common way a document gets ruined by a style, and it happens because
a fill was omitted rather than set.

So: never write `w:shd` without a `w:fill`. If you want a tint, name the tint. If
you want no shading, omit the element.

## 4. Tints are percentages

A vector package expresses a tint as a percentage of a hue — `green!10` is ten
percent green. OOXML has no percentage: you compute the hex. The arithmetic is the
same one a designer does by eye:

- take the hue's RGB;
- take the paper's RGB, `FFFFFF`;
- the result is `hue × p + white × (1 − p)` per channel, rounded to an integer.

`green!10` on a `00B050` green is `(0×0.1 + 255×0.9, 176×0.1 + 255×0.9,
80×0.1 + 255×0.9)` ≈ `(230, 242, 232)`, so `E6F2E8`. A 5% tint is a highlight; a
10–15% tint is a panel; 25% and above is a colour block that competes with the text
on it.

Two tints of the same hue at different percentages give you a two-level hierarchy
with one hue. That is cheaper and calmer than two hues.

## 5. What a decoration is for

A rule or a tint is doing one of three jobs. Name which one before adding it:

| job       | example                                                           | mechanism                                         |
| --------- | ----------------------------------------------------------------- | ------------------------------------------------- |
| separate  | a rule under a heading, a hairline between table rows             | `w:pBdr/w:bottom`, `w:tblBorders/w:insideH`       |
| group     | a tinted panel behind a set of paragraphs, a box around a callout | `w:shd` on the paragraphs, or a single-cell table |
| emphasise | a heavy rule above a footer block, a coloured left edge           | `w:pBdr/w:bottom` at `w:sz="24"`, `w:pBdr/w:left` |

A decoration doing none of the three is noise. Two rules under one heading is noise.
A tint behind a paragraph that is already inside a tinted table is noise.

## 6. Block diagrams out of the primitives

A block diagram is nested rectangles with labels and arrows between them. The
primitives map directly:

- **a block** is a single-cell table with a border and, optionally, a tint. The
  label is the cell's paragraph.
- **nesting** is a table inside a cell. Two levels deep is readable; three is where
  a reader loses track of which box they are in.
- **an arrow** is a `→` or `⇒` character in a paragraph between the blocks, or a
  single-cell table with only a bottom border standing in for a connector. There is
  no arrow primitive in the border set.
- **dimensions and parameters** are set once and named, exactly as a vector package
  would: the widths of a diagram's three columns are three constants, not three
  literals typed into three cells. When the diagram needs to be a centimetre
  narrower, that is three edits.
- **alignment** is the table's alignment plus each cell's paragraph alignment. A
  diagram whose blocks are individually centred rather than aligned to a shared
  column reads as a pile of boxes.

If a diagram needs real vector shapes — curved arrows, layered 3-D blocks, a
coordinate grid — it does not belong in a `.docx` built by this plugin. Build it as
an image, size it against the text column, and caption it as a figure; see
`chart-templates.md` §2 for the extent arithmetic.

## 7. The rules that watch decorations

| rule               | what it checks                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `shading-type`     | a cell shaded `w:val="clear"` with a `000000`, `auto`, or empty fill                                          |
| `table-margins`    | any cell with no `w:tcMar` padding — a decorated table usually has the padding removed along with the borders |
| `table-pagination` | a multi-row table with no `w:tblHeader` header row, or any row without `w:cantSplit`                          |
| `blank-pages`      | five or more consecutive empty paragraphs — the way a "boxed callout" is usually faked                        |

The last one is worth spelling out. A callout is not four empty paragraphs with
borders; it is one paragraph with `w:pBdr` on all four sides and `w:shd` behind it,
with `w:space` giving the text room inside the box.

## 8. Print, not screen

- A tint that reads on a monitor can vanish on a mono laser printer. Anything below
  about 8% is a screen effect.
- A dark tint with dark text on it is unreadable in print and eats the toner. Text
  on a tint wants the tint at 10–15% and the text at full weight.
- Greyscale first. If a decoration's job disappears in greyscale, the job was being
  done by colour and needs to be redone with weight, position, or a rule.
- Double rules (`w:val="double"`) print as two hairlines and are heavier than they
  look on screen. Prefer one heavier rule to two thin ones.

## Source

The structure of this brief — decorations built from a small set of primitives
(`draw`, `filldraw`, `node`) rather than from bespoke shapes, parameters named once
and reused, tints expressed as a percentage of a hue, a tint light enough not to
compete with the content, and block diagrams assembled from filled rectangles and
nodes — follows the conventions of:

    xinychen/awesome-latex-drawing
    https://github.com/xinychen/awesome-latex-drawing
    Copyright (c) 2019 Xinyu Chen
    MIT License — https://github.com/xinychen/awesome-latex-drawing/blob/master/LICENSE

The knowledge above is restated in this repository's own words and in `.docx` terms;
no upstream file is distributed with this plugin.

## 9. The element library

Concrete patterns built from the three primitives. Each is a named, reusable
specification — not a one-off arrangement. An element that is not in this
library is an element that has not been specified.

### `Rule_Hairline`

A 0.5 pt single rule, full text width, in the `rule` colour. Separates sections
where a heading is not wanted. Spacing: 6 pt above, 6 pt below — set once, in
the paragraph's `w:spacing`, not with empty paragraphs.

### `Rule_Accent_Short`

A 2–3 pt rule, 1.5–3 cm wide, in the accent colour, sitting under a title or
a section heading. The width is fixed in the spec, not "whatever looks right".
This is the only element allowed to use the accent.

### `Panel_Tint`

A paragraph (or table cell) with a `w:shd` fill at `tint10` and no border, or
a left border only (3 pt, accent) with no fill. Carries a callout, a quote, or
a summary block. Padding comes from the paragraph's indent, not from spaces.

### `Frame_Box`

A full box: 0.5 pt border in the `rule` colour, no fill. For a candidate
information block, a seal-line frame, a form field group. Never for body text —
a boxed paragraph is unreadable at length.

### `Corner_Brackets`

Two L-shaped borders (top+left, bottom+right) framing a title or a figure.
Built from four border specifications on one paragraph. The bracket thickness
matches `Rule_Accent_Short`; the gap from the text is a fixed indent.

### `Table_Header_Band`

A table's header row with a `tint10` fill and a bottom border at 1 pt in the
`rule` colour, no vertical rules anywhere in the table (`common-rules.md`
§2.3). The band is what makes a table scannable; vertical lines are what make
it a grid of cells nobody reads.

### `Number_Badge`

A number or short label set in a small tinted cell (a 1×1 table), used to
number sections in a document whose heading style must stay unnumbered. The
badge's size is fixed; the number comes from the numbering definition, never
typed.

## 10. Usage scenarios

Which element, where — the mapping is the design system's second half.

| scenario | elements | notes |
| --- | --- | --- |
| report / paper title block | `Rule_Accent_Short` | one short rule under the title; nothing else |
| section separation | `Rule_Hairline` | only where the heading style does not already separate |
| callout / warning | `Panel_Tint` | the tint is the only signal; no border, no icon font |
| candidate info block (exam) | `Frame_Box` | full box; the only framed element in the document |
| letterhead | `Rule_Hairline` + logo | the rule separates the lockup from the body |
| contract clause group | none | a contract has no decorations; the numbering is the structure |
| official document | none beyond the 版头 | GB/T 9704 defines the furniture; nothing is added |
| table of contents | `Rule_Hairline` between groups | dot leaders are a tab stop, not a decoration |

**The default is none.** A document whose decorations are all default has no
decoration defects; a document that adds elements because they exist has a
design problem. Each element above must earn its place in a specific scenario,
and the scenario table is where that place is recorded.

## 11. Decoration budget

Per document, the ceiling:

| element | max per document |
| --- | --- |
| `Rule_Accent_Short` | one per section heading, or one for the whole document |
| `Rule_Hairline` | one per section boundary |
| `Panel_Tint` | as many as there are callouts — but a callout that is not one of the defined kinds is body text |
| `Frame_Box` | one, or one per form-field group |
| `Corner_Brackets` | one (a title or a cover) |
| `Number_Badge` | as many as there are unnumbered sections |

A document that exceeds the budget is not "richly decorated" — it is a document
whose hierarchy is being asked to do a job the styles should be doing.
