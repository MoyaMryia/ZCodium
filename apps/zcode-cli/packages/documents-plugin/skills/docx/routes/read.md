# Route: read

Locate things inside an unpacked document, and run the quality gate over the packed
one.

Reading is the step every other route starts from: comments, revisions and
formatting repairs all begin by finding the node they act on. Two tools cover it —
`get_node` for "which element is this", `postcheck.py` for "what is wrong with this
document".

## 1. Get an editor for a part

```python
import sys

sys.path.insert(0, "<plugin>/skills/docx")
from scripts.document import Document

doc = Document("unpacked")
editor = doc["word/document.xml"]
```

`__getitem__` builds one `DocxXMLEditor` per part and caches it, so two lookups of
the same path return the same object and see each other's mutations. A path that
does not exist raises `ValueError: XML file not found: <path>` — the check is against
the _temp copy_, so a part that exists in your directory but not in the one you
unpacked from is still missing.

Any part of the package can be edited this way, not just `document.xml`:
`word/comments.xml`, `word/styles.xml`, `word/settings.xml`, `word/_rels/document.xml.rels`,
`[Content_Types].xml`. Constructing `Document` already opened several of them.

## 2. Find a node

```python
editor.get_node(tag, attrs=None, line_number=None, contains=None)
```

Every filter is optional; every filter you pass must match. Exactly one element has
to survive, and the method raises `ValueError` on zero or on more than one, with a
hint naming the filters that were used. That strictness is the point — silently
returning the first match is how an edit lands in the wrong paragraph.

**`tag`** — the prefixed name as it appears in the file: `"w:p"`, `"w:r"`, `"w:ins"`,
`"w:del"`, `"w:commentRangeStart"`, `"w:tbl"`. It is matched against
`getElementsByTagName`, so it is the literal qualified name, not a local name.

**`attrs`** — a dict of attribute equalities, all of which must hold:

```python
editor.get_node(tag="w:del", attrs={"w:id": "3"})
editor.get_node(tag="w:commentRangeStart", attrs={"w:id": "0"})
editor.get_node(tag="w:p", attrs={"w14:paraId": "1A2B3C4D"})
```

Values are compared as strings, so `{"w:id": "3"}` does not match `w:id="03"`.

One trap: the comparison goes through `getAttribute`, which returns an empty string
for an attribute the element does not have. Filtering on an attribute name the file
never uses therefore matches every element that lacks it, and you get
`Multiple nodes found` rather than a clean miss. Read the value off the element
first and check it is non-empty before filtering on it.

**`line_number`** — an int or a `range`, 1-indexed against the file as it was parsed:

```python
editor.get_node(tag="w:r", line_number=519)
editor.get_node(tag="w:p", line_number=range(100, 200))
```

The position comes from the line-tracking SAX parser installed by
`XMLEditor.__init__` (`utilities.py`), which stamps every element with a
`parse_position` of `(line, column)`. The range is inclusive of `start` and
exclusive of `stop`, Python semantics.

**`contains`** — a substring of the element's own text, gathered recursively from
non-whitespace text nodes:

```python
editor.get_node(tag="w:p", contains="第一章 概述")
editor.get_node(tag="w:t", contains="&#8220;Agreement")
editor.get_node(tag="w:t", contains="\u201cAgreement")
```

The search string is `html.unescape`d first, so the entity notation and the literal
character both match the same text. Whitespace-only text nodes are skipped, so
indentation inside the element does not break the match.

### Choosing a filter

Line numbers are the weakest of the three. Every mutation shifts them, and text is
often split across runs, so `contains` fails where the words are there. Prefer, in
order:

1. `attrs` — stable across edits, unique by construction for ids;
2. `contains` — stable as long as the wording is in one element's text;
3. `line_number` — only for a file you have just parsed and not yet touched.

When nothing matches, the error names the filters you used: `Text may be split
across elements or use different wording.` for `contains`, `Line numbers may have
changed if document was modified.` for `line_number`, `Verify attribute values are
correct.` for `attrs`. Read it as the diagnostic it is rather than retrying with the
same arguments.

## 3. Read what the editor knows about the part

The editor is also the thing that tells you what inserting content will stamp on.
Before you edit, these are worth reading directly off the DOM:

- `editor.dom` — the parsed `defusedxml.minidom` document; every element carries its
  `parse_position`;
- `editor.encoding` — `"ascii"` or `"utf-8"`, detected from the first 200 bytes of
  the file header and preserved on `save()`;
- `editor.rsid`, `editor.author`, `editor.initials` — the values stamped onto
  anything you insert.

`get_next_rid()` scans a `.rels` part for the highest `rIdN` and returns the next
free one, which is how you add a relationship without colliding with an existing
one.

## 4. Run the quality gate

```bash
python3 <plugin>/skills/docx/scripts/postcheck.py report.docx
python3 <plugin>/skills/docx/scripts/postcheck.py report.docx --json
python3 <plugin>/skills/docx/scripts/postcheck.py report.docx --only table-pagination,image-overflow
```

The gate reads the **packed** `.docx`, not the unpacked directory, so pack first
(`routes/create.md` §6). Run it by file path: it imports `postcheck_document` and
`postcheck_rules` by flat module name, so `python3 -m scripts.postcheck` fails while
`python3 …/scripts/postcheck.py` works from any directory.

Exit status is `0` when every selected rule passes and `1` as soon as one reports
anything, which is what makes it droppable into a build step. A path that is not a
file exits `2`.

Human output is one line per rule plus a summary:

```
[PASS] blank-pages: no blank-page pattern (longest empty run 0)
[WARN] cjk-indent: 1 Chinese body paragraph(s) without a 2-character first-line indent
[PASS] cover-separation: 2 sections

10/11 checks passed
```

`--json` prints the same findings as objects with `name`, `ok`, `message` and
`severity`, which is the shape to parse when the gate drives a repair loop.

The eleven rules, and what each one is actually looking at:

| rule                   | fails when                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `blank-pages`          | the last paragraph is a page break with no text and no drawing, or 5 or more consecutive empty paragraphs                                              |
| `line-spacing`         | body text (outside tables and lists, non-empty) mixes more than one `w:spacing/@w:line` value                                                          |
| `table-margins`        | any table cell has no `w:tcMar` padding                                                                                                                |
| `table-pagination`     | a multi-row table has no `w:tblHeader` header row, or any row lacks `w:cantSplit`                                                                      |
| `image-overflow`       | an image is wider than the narrowest usable text column across sections (1 twip = 635 EMU)                                                             |
| `font-fallback`        | a declared font is in the fallback-risk list: Noto Sans SC, Noto Serif SC, Source Han Sans, Source Han Serif, LXGW WenKai, 霞鹜文楷                    |
| `cjk-indent`           | a Chinese body paragraph (20 characters or more, not a heading, table cell, list item, or centered) has no first-line indent in the 200–800 twip range |
| `heading-continuity`   | heading levels skip, e.g. H1 followed by H3                                                                                                            |
| `numbering-continuity` | the numId values used by numbered lists are not contiguous                                                                                             |
| `cover-separation`     | the document has a single section, so the cover cannot carry its own page numbering                                                                    |
| `shading-type`         | a cell is shaded with `w:val="clear"` and a black, `auto`, or empty fill                                                                               |

Rules report severity `warning`, so a failing rule renders `[WARN]`. `[FAIL]` is
reserved for `error` severity, which means an unknown rule name in `--only` or a
rule that raised — read `[FAIL]` as "the gate is broken", not "the document is".
`--fix` is accepted for CLI compatibility and fixes nothing; the repair tools are
`fix_footer_fields.py` and `add_toc_placeholders.py` (`routes/format.md`).

Two rules need scoping on ordinary documents:

- `cover-separation` fails any single-section document by design. A one-page memo
  always trips it. Run `--only` without it, or accept the warning knowingly.
- `numbering-continuity` only gap-checks ids that are all digits. A non-numeric
  `w:numId` is dropped from the comparison entirely, so a document mixing
  `w:numId="a"` with `w:numId="7"` is judged on `[7]` alone and cannot report a gap.

## 5. Reading without mutating

`Document.__init__` is not read-only: it copies the tree, writes `people.xml`,
touches `[Content_Types].xml`, `word/_rels/document.xml.rels` and
`word/settings.xml`. None of that reaches your input directory until `save()`, so a
read-only session is simply one you never save.

When you want the parsed view the gate uses, without constructing a session:

```python
import sys

sys.path.insert(0, "<plugin>/skills/docx/scripts")
from postcheck_document import load_document

doc = load_document("report.docx")
print(len(doc.paragraphs), len(doc.tables), len(doc.sections))
```

`load_document` opens the archive and derives the shared facts once — sections and
page geometry, paragraphs, tables, image extents, declared fonts, numbering ids —
and mutates nothing. It reads `word/document.xml` and, when present,
`word/styles.xml`.
