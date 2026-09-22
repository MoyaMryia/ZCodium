# Table of contents fields

How a TOC is built in OOXML, what `add_toc_placeholders.py` actually does to one, and
where it stops.

## 1. The anatomy of a TOC field

A table of contents is not a list of paragraphs with links. It is a **field**, and a
field is five pieces living inside ordinary runs:

```xml
<w:p>
  <w:r><w:fldChar w:fldCharType="begin"/></w:r>
  <w:r><w:instrText xml:space="preserve"> TOC \o "1-3" \h \z \u </w:instrText></w:r>
  <w:r><w:fldChar w:fldCharType="separate"/></w:r>
</w:p>
<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr><w:r><w:t>第一章 概述</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr><w:r><w:t>1</w:t></w:r></w:p>
<w:p>
  <w:r><w:fldChar w:fldCharType="end"/></w:r>
</w:p>
```

| piece         | element                               | role                                                            |
| ------------- | ------------------------------------- | --------------------------------------------------------------- |
| begin         | `w:fldChar/@w:fldCharType="begin"`    | opens the field                                                 |
| instruction   | `w:instrText`                         | what to build — here `TOC \o "1-3"` means heading levels 1 to 3 |
| separate      | `w:fldChar/@w:fldCharType="separate"` | ends the instruction, begins the cached result                  |
| cached result | ordinary paragraphs                   | what the reader sees until the field is refreshed               |
| end           | `w:fldChar/@w:fldCharType="end"`      | closes the field                                                |

The instruction and the result are separated for a reason: Word shows the cached
result immediately and recomputes it lazily. Nothing in the file says "these page
numbers are stale".

Two consequences drive everything below:

- **A programmatically built document caches nothing.** The begin, instruction,
  separate and end are written by the build path, and the region between `separate`
  and `end` is empty. The reader gets a blank gap where the contents belong.
- **Word only refreshes when asked.** The trigger is `<w:updateFields/>` in
  `word/settings.xml`. Without it the cached result — empty — is what ships.

The `TOC1`, `TOC2`, `TOC3` styles referenced by the cached paragraphs are ordinary
paragraph styles in `word/styles.xml`. A TOC field does not create them.

## 2. What `add_toc_placeholders.py` does

```
python3 add_toc_placeholders.py <file.docx> [--entries '[{"level":1,"text":"…","page":"1"}]'] [--dry-run]
```

It works on the packed archive, rewrites `word/document.xml` and
`word/settings.xml`, and swaps the file atomically through a temporary beside it.

### Step 1 — collect the entries

With no `--entries`, headings are extracted from `word/document.xml` in document
order:

- a paragraph qualifies when its `w:pStyle` starts with `heading`, case-insensitively;
- the level is the numeric suffix of that style name, and levels above 3 are dropped;
- the text is the concatenation of the paragraph's `w:t` nodes, stripped;
- empty headings are skipped;
- headings whose text matches `CAPTION_PREFIX` are skipped — `图 1：`, `表 2.`,
  `Table 3.`, `Figure 4.`, `Fig. 5`, and the Chinese forms `表`, `图`, `附表`,
  `插图`, `表格`, `图表`, each followed by digits or Chinese numerals and then `:`,
  `：` or `.`.

The caption filter exists because a caption in the contents makes the reader think a
chapter is missing.

`--entries` supplies the list explicitly as a JSON array of
`{"level": int, "text": str, "page": str}`. `page` defaults to `"1"` and `level` to
`1`. Anything unparseable, or not an array, exits `2` before the archive is opened.

### Step 2 — find the field

The script locates the field by `w:fldChar` type, not by the instruction text:

1. every `w:fldChar` in the document is collected in document order;
2. the first one whose type is `separate` and the first whose type is `end` are taken;
3. each is mapped to the top-level body block — the direct child of `w:body` — that
   contains it.

Both must resolve, and the end block must come strictly after the separate block.
When they do not, nothing is inserted.

### Step 3 — clear and write

Everything between the separate block and the end block is removed, then one
paragraph per entry is inserted, in order, starting at the block right after the
separate block:

```xml
<w:p>
  <w:pPr>
    <w:pStyle w:val="TOC{level}"/>
    <w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9000"/></w:tabs>
    <w:ind w:left="{240 if level <= 1 else 480}"/>
  </w:pPr>
  <w:r><w:t xml:space="preserve">{text}</w:t></w:r>
  <w:r><w:tab/></w:r>
  <w:r><w:t>{page}</w:t></w:r>
</w:p>
```

The right-aligned dot-leader tab sits at 9000 twips regardless of the page width.
The indent is 240 twips at level 1 and 480 at levels 2 and 3. Every page number is
the placeholder `1`.

Clearing first is what makes repeated runs safe, and the re-insertion is byte-stable:
the second run removes the same paragraphs and writes identical ones back, so the
serialised document does not change and the report says `written: False`.

### Step 4 — turn on `updateFields`

`word/settings.xml` gains `<w:updateFields w:val="true"/>` when it does not already
have one. Placement follows the `CT_Settings` child order: after `defaultTabStop` or
`hyphenationZone` when either exists, otherwise at the front of the element. An
existing `w:updateFields` is left exactly as it is — value and position.

This is the step that makes the placeholders temporary. On the first open in Word the
field is recomputed, the real headings and their real page numbers replace the
placeholders, and the dot leaders re-align.

## 3. Idempotency

| run          | document.xml                                  | settings.xml                |
| ------------ | --------------------------------------------- | --------------------------- |
| first        | entries written between the markers           | `updateFields` added        |
| second       | cleared and rewritten identically — no change | already present — no change |
| third onward | same                                          | same                        |

The report reflects it: `entries inserted` counts the entries written every time,
while `written` is `False` once nothing changed. `--dry-run` reports without touching
the file and always reports `written: False`.

`update_fields_ensured` in the report means "the element is present and correctly
placed after this run", not "this run added it".

## 4. Known limitations

**Separate and end in the same paragraph.** Placement works on whole top-level
blocks. When the entire field — begin, instruction, separate, cached result and end —
sits inside a single `w:p`, the separate and the end map to the same block, the
end-block check fails, and the script inserts nothing. The report says
`entries inserted: 0` and only the settings change lands. This is the common shape
for a TOC generated by a build path that writes one paragraph per field piece only
when it does not; when it does, the fix is to split the field across paragraphs.

**No TOC field.** A document with no `w:fldChar` triple of begin, separate and end
changes only in `settings.xml`. `entries inserted: 0`, exit `0`.

**The field is found by type, not by instruction.** The first `separate` and the
first `end` in document order win, whatever field they belong to. A body-level field
earlier in the document — a cross-reference, a `NUMPAGES`, a page-number field typed
into the text rather than placed in a footer — carries its own begin/separate/end and
becomes the target. When that field's markers share one paragraph the script inserts
nothing at all; when they span paragraphs, the entries land in the wrong field. If
the document has body fields before the TOC, pass `--entries` and verify the result
by reading `word/document.xml`.

**An end before a separate.** A field written as begin/end with no separate, ahead of
the TOC, makes the first `end` precede the first `separate`. The check rejects it and
nothing is inserted.

**`TOC{level}` styles are assumed to exist.** The placeholder paragraphs reference
`TOC1`, `TOC2`, `TOC3` by style id. A `word/styles.xml` that does not define them
renders the entries in the default paragraph style — the field still refreshes
correctly in Word, but the cached view looks unstyled until it does.

**Placeholder pages are all `1`.** By design. They exist so the block does not look
broken; `<w:updateFields/>` is what replaces them. A reader who opens the file in
something that ignores `updateFields` sees page `1` on every line.

**`ElementTree` re-serialisation.** `word/document.xml` is rewritten through
`xml.etree.ElementTree` with the `w` prefix explicitly registered, so prefixes stay
stable, but attribute order within an element and the choice between self-closing and
paired empty tags follow ElementTree's rules rather than the original file's. Run
this script after any edit whose result you need to diff against the source.

**It does not build the TOC field.** If the document has no field, this script does
not create one; it only fills and refreshes a field that already exists.

## 5. Relationship to `Document`

`Document.__init__` writes `<w:updateFields w:val="true"/>` into `word/settings.xml`
on every construction, unless it is already there — so a document that has been
through a `Document` session already satisfies step 4, and
`add_toc_placeholders.py` reports `update_fields_ensured: False` for it. The two
writers agree on the element and its value; they differ only in placement, because
`Document` uses the full `CT_Settings` order table from `identifiers.py` while the
script places after `defaultTabStop` / `hyphenationZone` when either exists.
