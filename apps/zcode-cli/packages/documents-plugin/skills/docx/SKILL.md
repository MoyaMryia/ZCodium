---
name: docx
description: Use whenever a .docx / Word document is the artifact being produced, edited, or reviewed. Covers comment and tracked-change editing through the `Document` / `DocxXMLEditor` Python API on an unpacked .docx, plus three command-line scripts — `postcheck.py` (11 visual and typesetting quality rules), `fix_footer_fields.py` (footer page numbers that print the raw field text in WPS), and `add_toc_placeholders.py` (a freshly built table of contents that renders as an empty block). Use it when the user asks to add or reply to comments, to apply revisions, or to check the quality of a generated document, and when the reported symptoms are a blank trailing page, a table header row that does not repeat across pages, Chinese body text with no first-line indent, fonts that exist only on the build machine, images wider than the text column, skipped heading levels, or a cover that shares page numbering with the body.
---

# DOCX Comments, Tracked Changes, and Post-Build Checks

## 1. Scope

This skill edits and reviews `.docx` files that already exist as OOXML packages:

- comments and comment threads, and tracked-change edits, through the Python API in `scripts/document.py` and `scripts/utilities.py`;
- three command-line scripts in the same directory: `postcheck.py`, `fix_footer_fields.py`, `add_toc_placeholders.py`.

It does **not** build a document from scratch (there is no generator here), does not validate against the OOXML schemas (`validate()` is a presence check), does not render or convert anything (no LibreOffice or PDF pipeline ships in this plugin), and does not auto-repair (`--fix` is accepted and fixes nothing).

When the document has a recognisable type, read its brief under `scenes/` before touching the package: `academic.md`, `contract.md`, `copywriting.md`, `exam.md`, `official-doc.md`, `report.md`, `resume.md`. Each one fixes the page geometry, the heading and numbering conventions and the postcheck rules that type of document trips — a contract's clause numbering and continuous page numbering, a Chinese official document's fonts and margins, a resume's single-page budget. They are guidance, not API manuals; the calls are in `routes/`. The shared rules those briefs assume live under `references/`: `design-system.md` (type scale, spacing, colour, component specs), `common-rules.md` (naming, structure, maintainability), `math-formulas.md`, `chart-templates.md`, `decorations.md` and `faq.md`.

## 2. Working shape

A `.docx` is a ZIP. The Python API works on an **unpacked directory**, never on the archive:

1. Unpack: `unzip report.docx -d unpacked/` — keep the `[Content_Types].xml`, `_rels/`, and `word/` layout intact.
2. Construct `Document("unpacked")`. It copies the tree into a temp directory and edits the copy.
3. Edit through `doc["word/document.xml"]` (and the comment parts it creates on demand).
4. `doc.save("out")` writes the whole tree; `out` may be a fresh directory.
5. Repack into a `.docx` (`cd out && zip -r ../report.docx .`), or import `_pack_document` (§5).
6. Run the three scripts against the packed `.docx`.

Sequence matters: comments and tracked changes rewrite the XML that `postcheck.py` reads, so the gate runs after the edits are saved and packed.

## 3. `Document` — the entry point (`scripts/document.py`)

```python
import sys

sys.path.insert(0, "<plugin>/skills/docx")  # document.py uses a relative import
from scripts.document import Document

doc = Document("unpacked", track_revisions=False, author="ZCodium", initials="C")
```

Constructor arguments:

- `unpacked_dir` — must exist and be a directory (`ValueError` otherwise); the unpacked `word/` subtree lives inside it. A missing `word/document.xml` fails **in the constructor**, because `__init__` opens that part eagerly — not later from `validate()` or `save()`.
- `rsid` — revision-save ID stamped onto new elements; an 8-hex-digit one is generated when omitted, and the chosen value is printed to stdout.
- `track_revisions` — when true, also writes `<w:trackRevisions/>` into `word/settings.xml`.
- `author`, `initials` — defaults for comments and tracked changes.

Construction is idempotent and sets up everything a comment session needs:

- creates `word/people.xml` from `scripts/templates/people.xml` when absent, and registers its content type and relationship;
- adds this session's RSID to `word/settings.xml`, creating the `<w:rsids>` section when needed;
- always writes `<w:updateFields w:val="true"/>` unless it is already there, which makes Word recalculate TOC page numbers and cross-references at open time;
- reads existing comments from `word/comments.xml` when present, so `next_comment_id` continues after the highest existing `w:id` and replies can target them.

Public methods:

- `add_comment(start, end, text) -> int` — `start` and `end` are elements of `word/document.xml`'s DOM (run-level anchors are allowed). Inserts `<w:commentRangeStart>` before `start`, and `<w:commentRangeEnd>` plus a reference run after `end` — appended *inside* `end` when `end` is a `w:p`. Writes the comment into `word/comments.xml` and its metadata into `commentsExtended.xml`, `commentsIds.xml`, and `commentsExtensible.xml`, copying those parts from `scripts/templates/` on first use. Returns the new `w:id`.
- `reply_to_comment(parent_comment_id, text) -> int` — raises `ValueError` when the parent id is unknown (neither in the file nor created in this session). Anchors the reply's range after the parent's `commentRangeStart` and reference run, and records the parent link in `commentsExtended.xml`.
- `validate() -> None` — a presence check, not a schema check. In practice the constructor has already opened `word/document.xml`, so the missing-part branch is unreachable through the normal path; call it to catch parts that vanish mid-session.
- `save(destination=None, validate=True)` — ensures comment relationships and content types once comment parts exist, writes every part touched through an editor, validates unless disabled, then copies the whole unpacked tree to `destination`, or back over the input directory when `destination` is omitted.

## 4. The editor returned by `doc[...]`

`__getitem__` lazily builds and caches one `DocxXMLEditor` per part; a path that does not exist raises `ValueError`. The editor extends `XMLEditor` (`scripts/utilities.py`) and stamps bookkeeping attributes onto everything you insert, so fragments stay Word-shaped without hand-written IDs.

Finding nodes — `get_node(tag, attrs=None, line_number=None, contains=None)`:

- exactly one match is required; zero or many matches raise `ValueError` with a hint;
- `attrs` — attribute equality, e.g. `{"w:id": "3"}`;
- `line_number` — an int or a `range`, 1-indexed against the file as parsed;
- `contains` — a substring of the element's text; `&#8220;` and the literal `“` both match.

Mutating — `replace_node(elem, xml)`, `insert_before(elem, xml)`, `insert_after(elem, xml)`, `append_to(elem, xml)`: each parses the fragment in the edited part's own namespaces (write `w:`-prefixed XML for `word/*.xml` parts), returns the inserted nodes, and requires at least one element in the fragment.

Relationship IDs — `get_next_rid()` scans a `.rels` part for the highest `rIdN` and returns the next free one. `save()` writes the part back to its own path, preserving the encoding detected from the file header.

What is stamped automatically onto inserted content:

- `w:p` → `w:rsidR`, `w:rsidRDefault`, `w:rsidP`, `w14:paraId`, `w14:textId`
- `w:r` → `w:rsidR`, or `w:rsidDel` when inside a `w:del`
- `w:t` → `xml:space="preserve"` when the text has leading or trailing whitespace
- `w:ins` / `w:del` → `w:id`, `w:author`, `w:date`, `w16du:dateUtc`
- `w:comment` → `w:author`, `w:date`, `w:initials`; `w16cex:commentExtensible` → `w16cex:dateUtc`

Line and column tracking is installed by the parser itself: `XMLEditor.__init__` parses through the line-tracking SAX parser built by `_create_line_tracking_parser` in `utilities.py`, whose patched `setContentHandler` stamps every element with its `parse_position`. That is what makes the `line_number` filter work; there is no separate hook for you to call.

Tracked changes:

- `suggest_deletion(elem)` — marks a `w:r` or `w:p` as deleted: wraps the content in `w:del`, converts `w:t` to `w:delText`, and adds `<w:del/>` to `w:pPr/w:rPr` for numbered list items. Raises `ValueError` for an element that already carries tracked changes, or is neither `w:r` nor `w:p`.
- `suggest_paragraph(xml)` (static) — transforms a `<w:p>` XML string into a tracked insertion: wraps the runs in `w:ins` and adds `<w:ins/>` to `w:pPr/w:rPr`.
- `revert_insertion(elem)` — rejects an insertion by wrapping its runs in `w:del` (`w:t` → `w:delText`); accepts a single `w:ins` or any container. Raises `ValueError` when no `w:ins` is found.
- `revert_deletion(elem)` — rejects a deletion by cloning the deleted runs into a new `w:ins` placed after the `w:del` (`w:delText` → `w:t`). Returns `[elem]`, or `[w:del, new w:ins]` when given a single deletion. Raises `ValueError` when no `w:del` is found.

## 5. Module-level helpers worth knowing

- `_pack_document(input_dir, output_file)` — packs an unpacked directory back into a `.docx` (DEFLATED), after staging a copy so the input directory is never modified.
- `_strip_formatting_whitespace(xml_file)` — removes inter-element blank text and comments from one XML part, in place. It deliberately skips `*:t` elements, where whitespace is content. Stripping is a correctness requirement, not an optimization: pretty-printing leaves text nodes between elements, and Word is order-sensitive about `settings.xml` children.
- `_generate_hex_id()` — random 8-hex-digit id below `0x7FFFFFFF`, used for `w14:paraId`, `w14:textId`, and comment para/durable ids.
- `_generate_rsid()` — random 8-hex-digit RSID.
- `_insert_settings_element(editor, root, local_name, xml)` — inserts a `settings.xml` child at its schema-valid position per the CT_Settings child-order table, so the result stays valid whatever optional settings the source file already carries. Callers must ensure the element is not already present.

These are private (underscore-prefixed). Read them to understand behavior; do not treat them as a stable API.

## 6. `postcheck.py` — the quality gate

```
python3 postcheck.py <file.docx> [--json] [--only name[,name...]] [--fix]
```

It looks for the defects a reader notices and a validator walks past. Exit status: `0` once every selected rule passes, `1` as soon as one of them reports anything, `2` when the path is not a file — so it drops straight into a build step. Human output prints one `[PASS]` / `[WARN]` / `[FAIL]` line per rule plus an `N/M checks passed` summary; `--json` prints the same findings as objects with `name`, `ok`, `message`, and `severity`. Rules report severity `warning`, so a failing rule renders `[WARN]`; `[FAIL]` is reserved for `error` severity, which means an unknown rule name or a rule that raised. `--fix` is accepted for CLI compatibility and fixes nothing.

The eleven rules:

| rule | fails when |
| --- | --- |
| `blank-pages` | the last paragraph is a page break with no text and no drawing, or 5 or more consecutive empty paragraphs |
| `line-spacing` | body text (outside tables and lists, non-empty) mixes more than one `w:spacing/@w:line` value |
| `table-margins` | any table cell has no `w:tcMar` padding |
| `table-pagination` | a multi-row table has no `w:tblHeader` header row, or any row lacks `w:cantSplit` |
| `image-overflow` | an image is wider than the narrowest usable text column across sections (1 twip = 635 EMU) |
| `font-fallback` | a declared font is in the fallback-risk list: Noto Sans SC, Noto Serif SC, Source Han Sans, Source Han Serif, LXGW WenKai, 霞鹜文楷 |
| `cjk-indent` | a Chinese body paragraph (20 characters or more, not a heading, table cell, list item, or centered) has no first-line indent in the 200–800 twip range |
| `heading-continuity` | heading levels skip, e.g. H1 followed by H3 |
| `numbering-continuity` | the numId values used by numbered lists are not contiguous |
| `cover-separation` | the document has a single section, so the cover cannot carry its own page numbering |
| `shading-type` | a cell is shaded with `w:val="clear"` and a black, `auto`, or empty fill — the "whole cell turned black" failure |

`--only` runs a subset, which is how you scope the gate to the route you took, e.g. `--only table-pagination,image-overflow`.

The runner is a thin shell. `postcheck_document.py` derives the shared read-only view of the package once — sections and page geometry, paragraphs (style, text, page break, drawing, centering, list membership, first-line indent), tables (rows, `tblHeader` / `cantSplit` / `tcMar` counts, shading), image extents, declared fonts, and numbering ids — and `postcheck_rules.py` holds the eleven rules against that view. Neither has a command-line entry of its own; call them through `postcheck.py`.

## 7. `fix_footer_fields.py` — footer page numbers in WPS

```
python3 fix_footer_fields.py <file.docx> [--dry-run]
```

A build through docx-js leaves the keyword `PAGE` sitting in the footer with no format switch attached. Word reads the numbering style off the section's `<w:pgNumType>`; WPS skips that lookup and prints the instruction itself, so where a page number belongs the reader finds the literal text `PAGE \* arabic \* MERGEFORMAT`.

The repair:

1. For every footer part it decides the numbering style from the section that points at it through `<w:footerReference>`. That lookup has to follow references rather than positions, because a section carrying no `footerReference` of its own keeps using the previous section's footer. Each unformatted `PAGE` then becomes ` PAGE \* arabic \* MERGEFORMAT `, or ` PAGE \* ROMAN \* MERGEFORMAT ` when the style is `upperRoman` or `lowerRoman`.
2. It drops the placeholder `<w:pgNumType/>` elements that docx-js puts on cover sections, since WPS treats an empty one as an instruction to restart numbering.

A footer that no section points at is handled as decimal. Because only the unformatted keyword is rewritten, a footer already carrying a switch is untouched and running the script twice changes nothing. The report lists how many footers were scanned and rewritten, the style chosen for each, and the count of empty `pgNumType` elements dropped. `--dry-run` reports without touching the file; a real run swaps the archive atomically through a temporary file beside it.

## 8. `add_toc_placeholders.py` — a TOC that is not an empty block

```
python3 add_toc_placeholders.py <file.docx> [--entries '[{"level":1,"text":"…","page":"1"}]'] [--dry-run]
```

A table of contents in OOXML is a field built from five pieces: a begin marker, the instruction, a separate marker, the cached result that stays on screen until a refresh, and an end marker. Word refreshes that cached result while opening the file, but only when the settings ask for it with `<w:updateFields/>`; a document assembled programmatically has nothing cached, and the reader is left staring at an empty gap where the contents belong.

The repair:

- collects the headings from level 1 through 3 in the order they appear, ignoring empty ones and ones that read like captions (`图 1：…`, `Table 2. …`), unless `--entries` supplies them explicitly as a JSON array of `{level, text, page}`;
- clears whatever currently sits between the separate and end markers and writes placeholder entries in its place, each styled `TOC{level}` with a right-aligned dot-leader tab at 9000 twips, an indent of 240 at level 1 and 480 below, and the page `1`;
- makes sure `word/settings.xml` carries `<w:updateFields w:val="true"/>`, placed after `defaultTabStop` / `hyphenationZone` when either exists, so the first open in Word swaps the placeholders for real page numbers.

`--entries` must be a JSON array; anything unparseable, or not an array, exits `2`. Running it again changes nothing. Placement works on whole paragraphs: the separate and end markers have to live in different top-level paragraphs. When the entire field sits inside a single paragraph the report says `entries inserted: 0` and only the settings change lands. `--dry-run` reports without touching the file; a real run swaps the archive atomically through a temporary file beside it.

## 9. Workflows

### Review pass (comments)

1. Unpack the document, then `doc = Document("unpacked", author="Reviewer")`.
2. `editor = doc["word/document.xml"]`; find anchors with `get_node(tag="w:p", contains="…")`.
3. `cid = doc.add_comment(start=first, end=last, text="…")`, then `doc.reply_to_comment(cid, "…")` for a thread.
4. `doc.save("reviewed")`, repack, and run `postcheck.py` on the result.

### Tracked-change edit

1. Unpack, then `doc = Document("unpacked", track_revisions=True)`.
2. Locate the run or paragraph; call `editor.suggest_deletion(elem)` to strike it out.
3. For an insertion, transform the paragraph first and then place it: `xml = editor.suggest_paragraph("<w:p>…</w:p>")` followed by `editor.insert_after(anchor, xml)`.
4. To take a side on an existing change, `editor.revert_insertion(elem)` or `editor.revert_deletion(elem)`.
5. `doc.save("revised")`, repack, then run the gate.

### Build → gate → repair

1. Produce the `.docx` with whatever build path the task uses.
2. `python3 postcheck.py out.docx --json` — act on the findings and re-run until the selected rules pass.
3. If the build path is docx-js, run `python3 fix_footer_fields.py out.docx` and `python3 add_toc_placeholders.py out.docx`.
4. This plugin has no renderer: convert to page images yourself and hand them to the `visual-judge` agent for the visual gate.

## 10. Pitfalls

- **There is no pack/unpack CLI.** The Python API takes a directory. Unzip and zip yourself, or import `_pack_document(input_dir, output_file)` from `scripts.document`.
- **`save()` without a destination overwrites the input directory.** Pass one when the original must survive.
- **`Document` edits a temp copy**, removed when the instance is garbage-collected. Finish reading before dropping the reference.
- **`get_node` needs a unique target.** Line numbers shift once you mutate; prefer `attrs` or `contains`. Text split across runs will not match `contains`.
- **Fragments must contain at least one element** and must use the edited part's namespace prefix — a prefix the part does not declare cannot be resolved.
- **`validate()` is not a schema check.** A document that passes it can still be malformed OOXML.
- **`cover-separation` fails single-section documents by design**, so a one-page memo always trips it. Scope the run with `--only`.
- **`numbering-continuity` only gap-checks ids that are all digits.** A non-numeric `w:numId` is dropped from the comparison entirely, so a document mixing `w:numId="a"` with `w:numId="7"` is judged on `[7]` alone and cannot report a gap.
- **`postcheck --fix` fixes nothing.** `fix_footer_fields.py` and `add_toc_placeholders.py` are the actual repair tools.
- **Run the scripts by file path.** `postcheck.py` imports `postcheck_document` and `postcheck_rules` by flat module name, so `python3 -m scripts.postcheck` fails while `python3 …/scripts/postcheck.py` works from any directory. `document.py` is the opposite: it uses a relative import, so it must be imported as `scripts.document` with `skills/docx` on `sys.path`.
- **Construction prints the RSID** to stdout. That is expected noise, not an error.

## 11. Environment

Python 3.10 with `defusedxml` installed; every XML parse goes through it, and it is the only third-party dependency.
