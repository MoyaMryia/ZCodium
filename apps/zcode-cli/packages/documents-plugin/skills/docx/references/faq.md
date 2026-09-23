# Frequently asked questions

The questions that come up when this plugin is used on a real document, answered
against the code rather than against folklore. Each answer names the file that
decides it.

## Getting started

### There is no "create a document" command. How do I start?

There is no generator in this plugin. `routes/create.md` builds the _package_ and the
_session_; the words come from elsewhere. Two origins: unpack a `.docx` another path
produced (`unzip report.docx -d unpacked/`), or assemble the five-part minimal
package by hand and let `Document.__init__` create the rest on demand.

### Can I convert a `.docx` to PDF, or a PDF to `.docx`?

No. There is no renderer, no converter, no LibreOffice and no PDF pipeline here.
Convert with whatever tool your environment has, then hand the page images to the
`visual-judge` agent for the visual gate.

### Which Python import works?

Two different rules, and mixing them is the most common `ImportError`:

- `document.py` uses a relative import — `sys.path.insert(0, "<plugin>/skills/docx")`
  then `from scripts.document import Document`.
- `postcheck.py` and friends use flat module names — run them by file path,
  `python3 …/scripts/postcheck.py report.docx`, or add `scripts/` to `sys.path`.

`python3 -m scripts.postcheck` fails. `python3 -m scripts.document` fails. Both are
expected.

## Package and part errors

### `ValueError: XML file not found: word/settings.xml`

The package has no settings part. `Document.__init__` writes the RSID and
`<w:updateFields/>` into it, so it must exist. Create a minimal
`<w:settings xmlns:w="…"/>` before constructing. The same applies to
`word/_rels/document.xml.rels`.

### `ValueError: Directory not found: …`

The path does not exist, or is a file. `Document` takes an unpacked directory, never
an archive.

### Word says the file is corrupt.

A part is declared in `[Content_Types].xml` or a `.rels` but missing on disk, or a
relationship points at a target that does not exist. The minimal package in
`routes/create.md` §2 references `styles.xml` in its rels — drop that relationship if
you do not create the part.

### `validate()` passed. Is the document valid?

No. `validate()` is a presence check for `word/document.xml`, not a schema check. No
XSD ships with this plugin. A document that passes it can still be malformed OOXML.

### My edits disappeared.

`save()` was never called, or the destination was never repacked. Nothing persists
until `save()`, and `save()` writes a directory — you still have to zip it, or import
`_pack_document`.

### The input directory changed after `save()`.

`save()` without a destination copies the tree back over the input directory. Pass
one whenever the original must survive.

### `Document` edits a temp copy — so where is my file?

In a temp directory, removed when the instance is garbage-collected. Finish reading
before dropping the last reference. `__del__` cleans it up.

## Comments and tracked changes

### `ValueError: Parent comment with id=N not found`

The id was never created in this session and is not in `word/comments.xml`, or that
comment's paragraph carries no `w14:paraId` — comments without one are skipped when
existing comments are loaded, and therefore cannot be replied to.

### The comment appears in the wrong place.

`start` and `end` must be DOM elements, not strings or line numbers. When `end` is a
`w:p`, the range end and the reference run are appended _inside_ it, so the comment
closes at the end of that paragraph. Pass a run as `end` to close mid-paragraph.

### `ValueError: Multiple nodes found: <w:p>`

The anchor text appears in more than one paragraph. Narrow with `attrs` or a longer
`contains`. Note that text split across runs will not match `contains` at all.

### `AssertionError: Fragment must contain at least one element`

The XML fragment was text only. Every `insert_*` / `replace_node` call needs at least
one element, and must use the edited part's own namespace prefix.

### `ValueError` from `suggest_deletion` on a paragraph.

It raises for any element that is neither `w:r` nor `w:p`, for a `w:r` that already
contains `w:delText`, and for a `w:p` that already contains `w:ins` or `w:del`.

## The quality gate

### `postcheck.py` exits 1 even though nothing looks wrong.

That is the design. Exit status is `0` only when every selected rule passes, `1` as
soon as one reports anything. It drops straight into a build step, so a non-zero exit
means "look at the findings", not "the file is broken".

### Every rule reports `[WARN]`, never `[FAIL]`.

Rules report severity `warning`. `[FAIL]` is reserved for `error` severity, which
means an unknown rule name or a rule that raised.

### `--fix` did not fix anything.

`--fix` is accepted for CLI compatibility and fixes nothing. `fix_footer_fields.py`
and `add_toc_placeholders.py` are the actual repair tools.

### `cover-separation` fails my one-page memo.

By design. The rule checks that the document has more than one section, so a
single-section document always fails it. Scope the run with
`--only table-pagination,image-overflow` and record why.

### `numbering-continuity` reports a gap but the list looks fine.

The rule compares the `numId` values in use as integers and requires them to be
contiguous. Content copied from another document brings numbering definitions with
non-sequential ids. The rendering is correct; the ids are not. Renumber them, or
scope the rule and record the reason.

### `numbering-continuity` says `no numbered lists` on a document with lists.

Then the paragraphs are not really list items — the rule reads `w:numPr` on each
paragraph. A typed `1.` is text, not a list.

### `cjk-indent` fails a paragraph that is visibly indented.

The indent is `w:ind/@w:firstLineChars`, not `w:ind/@w:firstLine`. Word writes the
`Chars` form for a two-character indent and it renders identically, but the rule
reads only `@w:firstLine`. Add the twip attribute.

### `cjk-indent` fails a paragraph I do not want indented.

The rule applies to a Chinese paragraph of twenty or more characters that is not a
heading, not in a table, not a list item and not centred. Shorten it below twenty
characters, centre it, make it a list, or give it the indent.

### `line-spacing` reports several distinct values.

The rule counts `w:spacing/@w:line` in body paragraphs outside tables and lists.
Headings and list items are exempt. Body prose must share one value.

### `font-fallback` flags a font the document needs.

The six flagged faces only exist on the build machine. Either embed the font or
re-point the document at a face the recipient has. There is no third option that
produces a portable document.

## Footers and page numbers

### The footer prints `PAGE \* arabic \* MERGEFORMAT`.

Word resolves the number format from the section's `<w:pgNumType>`; WPS prints the
instruction. Run `python3 fix_footer_fields.py report.docx` — it attaches the format
switch derived from the referencing section, following references rather than
positions because a section with no `footerReference` inherits the previous
section's footer.

### A footer keeps the wrong number format.

The section referencing it declares no `w:pgNumType/@w:fmt` and inherits from an
earlier section. Give the section an explicit `w:fmt`.

### The cover became page 1 of the body.

An empty `<w:pgNumType/>` on the cover section: WPS reads it as an instruction to
restart numbering. `fix_footer_fields.py` drops those. Give the cover its own
section with a real or absent `pgNumType`, and suppress the number with
`<w:titlePg/>` plus an empty first-page footer rather than by restarting.

### Page numbers restart in the middle of the document.

A later section carries a `w:start` attribute, or the break was a page break where a
section break belonged. Only a section break changes the numbering sequence.

## Table of contents

### The TOC is an empty block.

A programmatically built document caches nothing between the `separate` and `end`
markers, and Word only refreshes when `settings.xml` asks with
`<w:updateFields/>`. Run `python3 add_toc_placeholders.py report.docx`; it writes
placeholder entries and ensures the setting.

### `entries inserted: 0`.

Either the document has no TOC field, or the whole field sits inside a single
paragraph — placement works on whole top-level blocks, so the `separate` and `end`
markers must live in different paragraphs. Split the field across paragraphs.

### Every TOC entry reads page `1`.

By design. `<w:updateFields/>` replaces them on the first open in Word. A reader in
something that ignores the setting sees `1` on every line.

### The entries landed in the wrong field.

The field is found by type, not by instruction: the first `separate` and the first
`end` in document order win. A body-level field earlier in the document becomes the
target. Pass `--entries` and verify by reading `word/document.xml`.

### `error: --entries must be a JSON array`, exit `2`.

The argument is an object or a bare string. It must be an array of
`{"level": int, "text": str, "page": str}`.

## Tables and images

### `table-pagination` fails my layout table.

A multi-row table needs a `w:tblHeader` header row and `w:cantSplit` on every row. A
layout table has neither, semantically. Use a real column section
(`<w:cols w:num="2" w:space="425"/>` in the section properties) instead of a table
for columns.

### A cell turned completely black.

`w:shd w:val="clear"` with a `w:fill` of `000000`, `auto`, or empty. Always name the
fill; omit the element entirely when you want no shading.

### `image-overflow` on an image that fits.

The rule compares the drawing's declared extent against the narrowest usable text
column across **all** sections, at 635 EMU per twip. A document with a narrower
second section is judged against the narrower one, and an image whose extent
over-declares its visible width still fails.

### `blank-pages` on a document with no blank page.

Either the last paragraph is a page break with no text and no drawing, or there is a
run of five or more consecutive empty paragraphs — usually a document that spaces
its blocks with blank lines.

## The visual gate

### How do I get a verdict on how the document looks?

This plugin has no renderer. Convert the pages to images yourself and hand them to
the `visual-judge` agent, which reports one JSON line per page and fixes nothing.
Act on what it returns, fix the source, and re-gate.

## The specific-bug catalogue

Recurring defects, each with its cause and fix. These are the ones a reader
notices; the gate catches the mechanical subset.

### Table text touching the cell borders

**Cause**: cell margins (`w:tcMar`) at zero — the default some generators emit
— so text starts at the border. **Fix**: set `w:tcMar` on every cell (left and
right ~108 twips, top and bottom ~57). The gate's `table-margins` check names
the cells.

### Numbered list doesn't restart

**Cause**: two lists sharing one `numId`, or a list continuing the previous
list's sequence. **Fix**: each list gets its own `numId` from
`word/numbering.xml`; a restart is a new `numId`, not a manual "1." typed over
the automatic number.

### Cover and content on the same page

**Cause**: no section break after the cover — the cover is the first page of
the body section instead of its own section. **Fix**: a section break
(`w:sectPr`) after the cover, with the body section carrying its own page
numbering. `add_toc_placeholders.py` and the scene briefs both assume the
break exists.

### Three-line table shows all borders

**Cause**: a full grid applied where a `booktabs`-style three-line table was
intended. **Fix**: top and bottom borders on the outer edges plus a rule under
the header row, and no vertical borders anywhere — `common-rules.md` §2's
table style.

### Chinese font size name requested but the output is wrong

**Cause**: a Chinese size name (五号, 小四) mapped to the wrong point value —
the mapping is not uniform across locales and tools. **Fix**: convert through
the table in `common-rules.md` §6 (小四 = 12 pt, 五号 = 10.5 pt) and set the
half-point value directly, never the name.

### Black table cells

**Cause**: a `w:shd` with a fill but no `w:val`, or a theme colour resolved
against the wrong palette — an omitted shading value paints black. **Fix**:
always set `w:val="clear"` with the fill; the gate's `shading-type` check
names the cells.

### Chinese characters garbled in matplotlib charts

**Cause**: the font family named in the plotting script does not cover CJK, or
`axes.unicode_minus` is on. **Fix**: name a CJK face in `rcParams`
(`Noto Sans CJK SC` / `WenQuanYi`), set `axes.unicode_minus = False`, and check
the PNG — not the terminal — for tofu.

### Image stretched or squashed

**Cause**: both width and height set on the image extent, ignoring the
intrinsic aspect. **Fix**: set one dimension and let the other follow, or
compute both from the intrinsic ratio. The gate's `image-overflow` check names
the images that exceed the text block.
