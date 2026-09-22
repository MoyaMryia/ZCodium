# Route: format

Repair the two defects a build path leaves behind and no validator reports: a footer
that prints its own field instruction, and a table of contents that renders as an
empty block.

Both are command-line scripts that work on a **packed `.docx`**, not on an unpacked
directory. Both rewrite the archive atomically. Neither is a general-purpose
formatter.

```bash
python3 <plugin>/skills/docx/scripts/fix_footer_fields.py report.docx [--dry-run]
python3 <plugin>/skills/docx/scripts/add_toc_placeholders.py report.docx [--entries '[{"level":1,"text":"…","page":"1"}]'] [--dry-run]
```

Run them by file path, like `postcheck.py`. A path that is not a file exits `2`.

## 1. `fix_footer_fields.py` — page numbers that survive WPS

**The symptom.** Where a page number belongs, the reader finds the literal text
`PAGE \* arabic \* MERGEFORMAT`. Word resolves the number format from the section's
`<w:pgNumType>` and prints `3`; WPS skips that lookup and renders the instruction
itself.

**The repair, part one — format switches.** For every footer part, the script decides
the numbering style from the section that points at it through
`<w:footerReference>`, then rewrites the unformatted `PAGE` keyword into
`PAGE \* arabic \* MERGEFORMAT`, or `PAGE \* ROMAN \* MERGEFORMAT` when the style
is `upperRoman` or `lowerRoman`.

The lookup follows references rather than positions because a section carrying no
`footerReference` of its own keeps using the previous section's footer — OOXML's
inheritance rule. Resolving by index silently attaches the wrong format to every
footer after the first section. The chain is: `w:footerReference/@r:id` in
`word/document.xml` → `word/_rels/document.xml.rels` → the footer part name. A footer
no section points at is handled as decimal.

The spaces around the switch belong to the field grammar; a switch glued to the
keyword is not recognised.

**The repair, part two — empty `pgNumType`.** The placeholder `<w:pgNumType/>`
elements a build path emits on cover sections are dropped, because WPS reads an
empty one as an instruction to restart numbering — the cover becomes page 1 of the
body. They are removed from the footers and from `word/document.xml`, where the
cover sections live.

**Idempotence.** Only the bare keyword is matched: the pattern is `PAGE` not followed
by optional whitespace and a literal `\*`. A footer that already carries a switch is
untouched, so a second run changes nothing.

**Output.**

```
footers scanned: 2
footers changed: 1 ['word/footer2.xml']
footer formats:  {'word/footer1.xml': 'decimal', 'word/footer2.xml': 'upperRoman'}
empty pgNumType removed: 1
dry run: nothing written
```

`--dry-run` reports without touching the file. A real run writes a temporary archive
beside the original and moves it over, so an interrupted run cannot leave a
half-written `.docx`.

## 2. `add_toc_placeholders.py` — a TOC that is not an empty block

**The symptom.** A freshly built document has nothing cached where the contents
belong, so the reader sees an empty gap.

**Why.** A TOC in OOXML is a field with five pieces: a `begin` marker, the
instruction, a `separate` marker, the cached result, and an `end` marker. Word
refreshes the cached result while opening the file — but only when the settings ask
for it with `<w:updateFields/>`. See `references/toc.md` for the field anatomy.

**The repair, part one — placeholder entries.** The script collects headings from
level 1 through 3 in document order and writes one placeholder paragraph per heading
between the `separate` and `end` markers:

```xml
<w:p>
  <w:pPr>
    <w:pStyle w:val="TOC1"/>
    <w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9000"/></w:tabs>
    <w:ind w:left="240"/>
  </w:pPr>
  <w:r><w:t xml:space="preserve">第一章 概述</w:t></w:r>
  <w:r><w:tab/></w:r>
  <w:r><w:t>1</w:t></w:r>
</w:p>
```

The right-aligned dot-leader tab sits at 9000 twips, the indent is 240 twips at
level 1 and 480 below, and every page number is the placeholder `1` — the point is
that the block does not look broken, because Word replaces the numbers on open.

Heading selection: a paragraph counts when its `w:pStyle` starts with `heading`
(case-insensitively) and its numeric suffix is 3 or less. The text is the
concatenation of the paragraph's `w:t` nodes, stripped. Empty headings are skipped,
and so are ones that read like captions — `图 1：…`, `表 2. …`, `Table 3. …`,
`Figure 4. …`, `Fig. 5 …` and their Chinese equivalents (`表`, `图`, `附表`, `插图`,
`表格`, `图表`) — because a caption in the contents makes the reader think a chapter
is missing.

Whatever currently sits between the markers is cleared first, which is what keeps
repeated runs from accumulating entries.

**The repair, part two — `updateFields`.** `word/settings.xml` gets
`<w:updateFields w:val="true"/>`, placed after `defaultTabStop` or
`hyphenationZone` when either exists and at the front otherwise. Without it the
placeholders survive into the delivered file and the reader sees page `1` for every
entry.

**Output.**

```
entries source:    auto-extracted headings
entries inserted:  3
updateFields on:   True
written:           True
```

With `--entries '[{"level":1,"text":"第一章","page":"7"}]'` the headings are supplied
explicitly and `entries source` reads `explicit --entries`. The argument must be a
JSON array; anything unparseable, or not an array, exits `2`.

`--dry-run` reports without touching the file. A real run writes atomically, and only
when something actually changed.

**Idempotence, and its one limit.** Re-running inserts the same entries over the
cleared region and the document serialises back to what it already was, so the
second run reports `entries inserted: 3`, `written: False`. The settings change
likewise lands once.

Placement works on whole top-level blocks: the `separate` and `end` markers have to
live in different top-level paragraphs. When the entire field sits inside a single
paragraph, the report says `entries inserted: 0` and only the settings change lands —
the entries are still not written. A document with no TOC field at all behaves the
same way. Neither case is an error; both exit `0`.

## 3. Building a fixture to run these against

`/tmp/opencode/docx-sample/sample.docx` carries no footer and no TOC field, so both
scripts correctly report nothing to do on it. To exercise the repairs, derive a
fixture that has both:

```bash
cd /tmp/opencode && rm -rf fmt && mkdir fmt && cd fmt
unzip -q -o /tmp/opencode/docx-sample/sample.docx -d unpacked

# a footer with a bare PAGE field, referenced by the last section
cat > unpacked/word/footer1.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>
       <w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
       <w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
</w:ftr>
XML

python3 - <<'PY'
from pathlib import Path

ct = Path("unpacked/[Content_Types].xml")
ct.write_text(ct.read_text(encoding="utf-8").replace(
    "</Types>",
    '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>',
), encoding="utf-8")

rels = Path("unpacked/word/_rels/document.xml.rels")
rels.write_text(rels.read_text(encoding="utf-8").replace(
    "</Relationships>",
    '<Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>',
), encoding="utf-8")

doc = Path("unpacked/word/document.xml")
doc.write_text(doc.read_text(encoding="utf-8").replace(
    "<w:sectPr>",
    '<w:sectPr><w:footerReference w:type="default" r:id="rId8"/><w:pgNumType/>',
), encoding="utf-8")
PY

python3 -c "
import sys; sys.path.insert(0, '<plugin>/skills/docx')
from scripts.document import _pack_document
_pack_document('unpacked', 'fixture.docx')
"
```

The derived `fixture.docx` has a bare `PAGE` field in a referenced footer and an
empty `<w:pgNumType/>` on the section — exactly what the two scripts exist to fix.

## 4. Order of operations

```bash
python3 <plugin>/skills/docx/scripts/fix_footer_fields.py report.docx
python3 <plugin>/skills/docx/scripts/add_toc_placeholders.py report.docx
python3 <plugin>/skills/docx/scripts/postcheck.py report.docx --json
```

Footer first, TOC second, gate last. The order between the two repair scripts does
not matter — they touch different parts — but both must precede the gate, because the
gate reads what they wrote. Note that `add_toc_placeholders.py` re-serialises
`word/document.xml` through ElementTree, so run it after any edit that depends on
the part's exact byte layout.

`postcheck.py --fix` fixes nothing. These two scripts are the actual repair tools.

## Failure modes

| symptom                                              | cause                                                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `error: not a file: …`, exit `2`                     | the path is a directory or missing; these scripts take a packed archive                                   |
| `footers changed: 0` on a document with page numbers | the footers already carry format switches, or the page numbers are plain text rather than a `PAGE` field  |
| `entries inserted: 0`                                | no TOC field, or the whole field sits inside one paragraph                                                |
| every TOC entry reads page `1`                       | `<w:updateFields/>` never landed — the document has no `word/settings.xml`, so there was nothing to patch |
| `error: --entries must be a JSON array`, exit `2`    | the argument is an object or a bare string                                                                |
| a footer keeps the wrong number format               | the section referencing it declares no `w:pgNumType/@w:fmt` and inherits from an earlier section          |
