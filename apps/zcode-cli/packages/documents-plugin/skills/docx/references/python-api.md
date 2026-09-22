# Python API reference

The programming surface of this plugin: seven modules under `skills/docx/scripts/`,
three command-line scripts, and nothing else. There is no JavaScript layer, no
`node_modules`, and no document-generation library — every capability described here
is Python.

This reference replaces the two JavaScript-library documents that shipped with the
upstream plugin. Those described a library this plugin does not use. What follows
describes what it does use, signature by signature, and is derived from the code
rather than from any external document.

## 1. How to import

Two different rules, and mixing them up is the most common way to get an
`ImportError`.

**`document.py` and everything it pulls in use relative imports.** They must be
imported as `scripts.document`, with `skills/docx` on `sys.path`:

```python
import sys

sys.path.insert(0, "<plugin>/skills/docx")
from scripts.document import Document
```

`python3 -m scripts.document` fails from `skills/docx`, and so does
`import document` from inside `scripts/`.

**`postcheck*.py`, `fix_footer_fields.py` and `add_toc_placeholders.py` use flat
module names.** They are run by file path:

```bash
python3 <plugin>/skills/docx/scripts/postcheck.py report.docx
```

They also import each other by flat name (`postcheck.py` does
`from postcheck_document import load_document`), which works because Python puts the
script's own directory on `sys.path`. To call them from your own code, add that
directory:

```python
import sys

sys.path.insert(0, "<plugin>/skills/docx/scripts")
from postcheck_document import load_document
from postcheck_rules import RULES, DEFAULT_RULES, Finding
```

`scripts/__init__.py` exists to make the directory a package for the relative
imports; it exports nothing.

`defusedxml` is the only third-party dependency. Every XML parse in the plugin goes
through it.

## 2. Module map

| module               | provides                                                         | used by                                        |
| -------------------- | ---------------------------------------------------------------- | ---------------------------------------------- |
| `document.py`        | `Document` — the entry point                                     | you                                            |
| `utilities.py`       | `XMLEditor` — parse, find, mutate, save one part                 | `DocxXMLEditor`                                |
| `docx_editor.py`     | `DocxXMLEditor` — `XMLEditor` plus automatic bookkeeping         | `Document.__getitem__`                         |
| `tracked_changes.py` | `TrackedChangeMixin` — the four tracked-change operations        | `DocxXMLEditor`                                |
| `comments.py`        | `CommentMixin` — comment XML and package metadata                | `Document`                                     |
| `packing.py`         | `_pack_document`, `_strip_formatting_whitespace`, `TEMPLATE_DIR` | `document.py`, `comments.py`                   |
| `identifiers.py`     | id generation and schema-ordered settings insertion              | `document.py`, `comments.py`, `docx_editor.py` |

## 3. `Document` — `scripts/document.py`

```python
class Document(CommentMixin):
    def __init__(
        self,
        unpacked_dir,
        rsid=None,
        track_revisions=False,
        author="ZCodium",
        initials="C",
    )
    def __getitem__(self, xml_path: str) -> DocxXMLEditor
    def add_comment(self, start, end, text: str) -> int
    def reply_to_comment(self, parent_comment_id: int, text: str) -> int
    def __del__(self)
    def validate(self) -> None
    def save(self, destination=None, validate=True) -> None
```

### `__init__`

| argument          | meaning                                                                                                                                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unpacked_dir`    | path to an unpacked `.docx` directory. Must exist and be a directory, else `ValueError: Directory not found: …`. A package with no `word/document.xml` is refused here, not later — the constructor opens that part to build `self._document`. |
| `rsid`            | revision-save ID stamped onto new elements. An 8-hex-digit one is generated when omitted, and the chosen value is printed to stdout.                                                                                                           |
| `track_revisions` | when true, also writes `<w:trackRevisions/>` into `word/settings.xml`.                                                                                                                                                                         |
| `author`          | default author for comments and tracked changes.                                                                                                                                                                                               |
| `initials`        | default author initials for comments.                                                                                                                                                                                                          |

The constructor copies the tree into a temp directory and packs the original into a
baseline `.docx` beside it, then sets up the comment infrastructure: `people.xml`
from the template with this author appended, its content type and relationship, the
session RSID in `settings.xml`, and `<w:updateFields w:val="true"/>` unless already
present. It reads existing comments so `next_comment_id` continues above the highest
`w:id` in the file.

It prints `Using RSID: <value>`. That is expected output, not an error.

`__del__` removes the temp directory. Finish reading before dropping the last
reference.

### `__getitem__`

Lazily builds and caches one `DocxXMLEditor` per part. Raises
`ValueError: XML file not found: <path>` for a part absent from the temp copy. Every
editor is constructed with this session's `rsid`, `author` and `initials`, so
anything inserted anywhere in the package carries the same bookkeeping.

### `add_comment`

`start` and `end` are DOM elements of `word/document.xml`; run-level anchors are
allowed. Inserts `<w:commentRangeStart>` before `start`, and `<w:commentRangeEnd>`
plus a reference run after `end` — appended _inside_ `end` when `end` is a `w:p`.
Writes the comment into `word/comments.xml` and its metadata into
`commentsExtended.xml`, `commentsIds.xml` and `commentsExtensible.xml`, copying those
parts from `scripts/templates/` on first use. Returns the new `w:id` as an `int`.

### `reply_to_comment`

Raises `ValueError: Parent comment with id=N not found` when the parent id is
unknown — neither in the file nor created in this session. Anchors the reply's range
after the parent's `commentRangeStart` and reference run, and records the parent link
in `commentsExtended.xml` as `w15:paraIdParent`. Returns the reply's `w:id`.

### `validate`

A presence check, not a schema check. Raises
`ValueError: Validation failed: word/document.xml not found` and returns `None`
otherwise. A document that passes it can still be malformed OOXML. A package that
never carried the part is rejected by the constructor instead, so this fires when the
part disappears mid-session — it is the last gate before `save()` writes.

### `save`

Four steps in order: ensures comment relationships and content types when comment
parts exist, writes every part touched through an editor, validates unless
`validate=False`, then copies the whole unpacked tree to `destination`
(`dirs_exist_ok=True`). When `destination` is omitted the tree is copied back over
the input directory.

Also importable from `scripts.document` by way of its own imports, though all are
private: `DocxXMLEditor`, `CommentMixin`, `TEMPLATE_DIR`, `_pack_document`,
`_strip_formatting_whitespace`, `_generate_hex_id`, `_generate_rsid`,
`_insert_settings_element`, `_CT_SETTINGS_ORDER`.

## 4. `DocxXMLEditor` — `scripts/docx_editor.py`

```python
class DocxXMLEditor(XMLEditor, TrackedChangeMixin):
    def __init__(self, xml_path, rsid: str, author: str = "ZCodium", initials: str = "Z")
    def replace_node(self, elem, new_content)
    def insert_after(self, elem, xml_content)
    def insert_before(self, elem, xml_content)
    def append_to(self, elem, xml_content)
```

The editor every `doc[...]` returns. It extends `XMLEditor` with the four tracked
change operations and overrides the four mutators so that every insertion goes
through `_inject_attributes_to_nodes`. Constructing one directly is rarely needed —
`Document.__getitem__` is the supported path, and it supplies the RSID, author and
initials for you. (The signature default for `initials` is `"Z"` while its docstring
says `"C"`; through `Document` the value always comes from the session, so the
default only shows up in direct construction.)

`rsid` is required. Without it there is nothing to stamp onto new paragraphs.

The overrides keep their parent's contract — parse the fragment in this part's own
namespaces, return the inserted nodes, require at least one element — and add
attribute injection on top. The injection covers the inserted node and all its
descendants:

| element                    | attributes added                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `w:p`                      | `w:rsidR`, `w:rsidRDefault`, `w:rsidP`, `w14:paraId`, `w14:textId`                    |
| `w:r`                      | `w:rsidR`, or `w:rsidDel` when inside a `w:del`                                       |
| `w:t`                      | `xml:space="preserve"` when the text has leading or trailing whitespace               |
| `w:ins` / `w:del`          | `w:id` (next free, from `_get_next_change_id`), `w:author`, `w:date`, `w16du:dateUtc` |
| `w:comment`                | `w:author`, `w:date`, `w:initials`                                                    |
| `w16cex:commentExtensible` | `w16cex:dateUtc`                                                                      |

Existing attributes are never overwritten, so a fragment that already carries its own
ids keeps them. The three `_ensure_*_namespace` helpers declare `w14`, `w16cex` and
`w16du` on the part's root element when an injected attribute needs them.

## 5. `XMLEditor` — `scripts/utilities.py`

```python
class XMLEditor:
    def __init__(self, xml_path)
    def get_node(
        self,
        tag: str,
        attrs: Optional[dict[str, str]] = None,
        line_number: Optional[Union[int, range]] = None,
        contains: Optional[str] = None,
    )
    def replace_node(self, elem, new_content)
    def insert_after(self, elem, xml_content)
    def insert_before(self, elem, xml_content)
    def append_to(self, elem, xml_content)
    def get_next_rid(self)
    def save(self)
```

`__init__` parses the file through a line-tracking SAX parser
(`_create_line_tracking_parser`, module-private) that stamps every element with a
`parse_position` of `(line, column)`, and detects the encoding from the first 200
bytes of the header — `"ascii"` or `"utf-8"`, preserved by `save()`. Raises
`ValueError: XML file not found: <path>` when the file is absent.

`get_node` requires exactly one match and raises `ValueError` on zero or many, with a
hint naming the filters used:

- `tag` — the literal qualified name, e.g. `"w:del"`, matched via
  `getElementsByTagName`;
- `attrs` — attribute equalities, all of which must hold; values compare as strings;
- `line_number` — an `int` or a `range`, 1-indexed against the file as parsed
  (`range` is inclusive of `start`, exclusive of `stop`);
- `contains` — a substring of the element's recursively gathered text,
  `html.unescape`d before comparison so `"&#8220;x"` and `"“x"` match alike;
  whitespace-only text nodes are skipped.

`replace_node`, `insert_after`, `insert_before` and `append_to` all take a DOM
element plus an XML string, parse the fragment inside a wrapper carrying the part's
own namespace declarations, import the nodes, and return them. A fragment with no
element raises `AssertionError: Fragment must contain at least one element` — text
alone is not accepted.

`get_next_rid` scans a `.rels` part for the highest `rIdN` and returns the next free
one as `"rIdN"`.

`save` serialises the DOM and writes it back to `xml_path` in the detected encoding.

`_get_element_text` and `_parse_fragment` are private. `set_content_handler` is not
a method of this class at all: it is a closure inside `_create_line_tracking_parser`
that is assigned onto the parser instance.

## 6. `TrackedChangeMixin` — `scripts/tracked_changes.py`

```python
class TrackedChangeMixin:
    def revert_insertion(self, elem)
    def revert_deletion(self, elem)
    @staticmethod
    def suggest_paragraph(xml_content: str) -> str
    def suggest_deletion(self, elem)
```

The mixin expects its host editor to provide `dom`, `rsid`,
`_inject_attributes_to_nodes` and `insert_after`; it is reached through
`DocxXMLEditor`, never on its own.

- `revert_insertion(elem)` — accepts a single `w:ins` or any container holding
  `w:ins` descendants. Wraps the runs inside each `w:ins` in a new `w:del`,
  converting `w:t` to `w:delText` and `w:rsidR` to `w:rsidDel`. Returns `[elem]`.
  Raises `ValueError` when no `w:ins` is found.
- `revert_deletion(elem)` — accepts a single `w:del` or any container holding
  `w:del` descendants. Clones the deleted runs into a new `w:ins` placed after the
  `w:del`, converting `w:delText` back to `w:t` and `w:rsidDel` back to `w:rsidR`.
  Returns `[elem, new w:ins]` for a single `w:del` that carried runs, and `[elem]`
  for a container. Raises `ValueError` when no `w:del` is found.
- `suggest_paragraph(xml_content)` — **static and pure**. Takes a `<w:p>` XML string,
  wraps its non-`w:pPr` children in one `w:ins`, adds `<w:ins/>` to
  `w:pPr/w:rPr`, and returns the transformed string. Nothing is inserted; place the
  result with `insert_after` so bookkeeping attributes get stamped.
- `suggest_deletion(elem)` — in-place, on a `w:r` or a `w:p` only. For a `w:r`:
  converts `w:t` to `w:delText`, moves `w:rsidR` to `w:rsidDel`, wraps the run in a
  new `w:del`, and returns that wrapper. For a `w:p`: converts every `w:t`, moves
  every run's `w:rsidR`, wraps all non-`w:pPr` children in one `w:del`, adds
  `<w:del/>` to `w:pPr/w:rPr` when the paragraph is a numbered list item, and
  returns the `w:p`. Raises `ValueError` for any other tag, for a `w:r` that already
  contains `w:delText`, and for a `w:p` that already contains `w:ins` or `w:del`.

## 7. `CommentMixin` — `scripts/comments.py`

```python
class CommentMixin:
    ...
```

Every method on this mixin is private. It carries no public API of its own; its
surface is reached entirely through `Document`. What it owns:

- comment part construction — `_add_to_comments_xml`, `_add_to_comments_extended_xml`,
  `_add_to_comments_ids_xml`, `_add_to_comments_extensible_xml`;
- range and reference fragments — `_comment_range_start_xml`,
  `_comment_range_end_xml`, `_comment_ref_run_xml`;
- package metadata — `_add_content_type_for_people`,
  `_add_relationship_for_people`, `_ensure_comment_relationships`,
  `_ensure_comment_content_types`, `_has_relationship`, `_has_override`,
  `_has_author`, `_add_author_to_people`, `_update_people_xml`;
- session setup and id allocation — `_setup_tracking`, `_update_settings`,
  `_get_next_comment_id`, `_load_existing_comments`.

`_update_settings(path, track_revisions=False, update_fields=True)` is the one worth
reading: it inserts new elements at their schema-valid position through
`_insert_settings_element` rather than appending, so the result stays valid whatever
optional settings the source file carries.

## 8. Module-level helpers — `packing.py` and `identifiers.py`

Private, and not a stable API — read them to understand behaviour.

```python
# scripts/packing.py
TEMPLATE_DIR                                        # Path → scripts/templates
_strip_formatting_whitespace(xml_file)              # in place, skips *:t elements
_pack_document(input_dir, output_file)              # DEFLATED .docx, input untouched

# scripts/identifiers.py
_CT_SETTINGS_ORDER                                  # CT_Settings child-order tuple
_generate_hex_id() -> str                           # 8 hex digits, < 0x7FFFFFFF
_generate_rsid() -> str                             # 8 random hex digits
_insert_settings_element(editor, root, local_name, xml)
```

`_strip_formatting_whitespace` removes inter-element blank text and XML comments from
one part. It is a correctness requirement, not an optimisation: pretty-printing
leaves text nodes between elements, and Word is order-sensitive about the children of
`settings.xml`. Elements whose tag ends in `:t` are skipped, because there the
whitespace is content.

`_pack_document` stages a copy of the tree in a temp directory — the input directory
is never modified — strips whitespace from every `*.xml` and `*.rels` part, and
writes the archive with `ZIP_DEFLATED`.

`_generate_hex_id` is used for `w14:paraId`, `w14:textId`, and the comment paragraph
and durable ids. The stricter `0x7FFFFFFF` bound is applied to both, since the OOXML
spec requires `paraId < 0x80000000` and `durableId < 0x7FFFFFFF`.

`_insert_settings_element` inserts before the first existing child that must follow
`local_name` per `_CT_SETTINGS_ORDER`, and appends when there is none. Unknown and
extension elements are skipped when scanning. The caller must ensure the element is
not already present.

## 9. The three command-line scripts

### `postcheck.py`

```
python3 postcheck.py <file.docx> [--json] [--only name[,name...]] [--fix]
```

Importable surface:

```python
run_checks(docx_path: str | Path, only=DEFAULT_RULES) -> list[Finding]
render_human(findings: list[Finding]) -> str
main(argv: list[str] | None = None) -> int
```

`postcheck_rules.py` adds `Finding` — a dataclass with `name`, `ok`, `message`,
`severity="warning"` and `to_dict()` — plus `RULES` (name → callable) and
`DEFAULT_RULES` (a tuple of all eleven names). The eleven callables are the
`check_*` functions, one per rule name in the table in `routes/read.md` §4; they
take a `DocumentContext` and return a `Finding`, and calling them directly is
supported but rarely useful.

`postcheck_document.py` adds `load_document(docx_path) -> DocumentContext` and the
dataclasses `DocumentContext`, `Section`, `Paragraph`, `Table`, `Image`. The two
accessors worth knowing on them:

```python
DocumentContext.widest_usable_twips() -> int | None   # narrowest text column across sections
Section.usable_width_twips                            # page width minus both margins
```

`DocumentContext` also carries `root`, `sections`, `paragraphs`, `tables`,
`images`, `fonts_declared` and `numbering_ids`, and a `body` property. Everything
else in that module — `_read_sections`, `_read_paragraphs`, `_twips` and the rest —
is the derivation behind `load_document` and is reached through it, not called
directly. Neither module has a command-line entry.

The thresholds the rules apply are module constants, so a caller can reuse them
rather than restate the numbers: `BLANK_PARAGRAPH_RUN`, `CJK_INDENT_MIN`,
`CJK_INDENT_MAX`, `CJK_BODY_MIN_CHARS`, `FALLBACK_RISK_FONTS`.

### `fix_footer_fields.py`

```
python3 fix_footer_fields.py <file.docx> [--dry-run]
```

```python
fix_footer_fields(docx_path: str | Path, dry_run: bool = False) -> dict
patch_footer(xml: str, fmt: str) -> tuple[str, int]
main(argv: list[str] | None = None) -> int
```

`_footer_format_map(document_xml) -> dict[str, str]` maps footer relationship ids to
the page-number format of the section using them, following OOXML's inheritance rule.
`_resolve_footer_targets(document_xml, rels_xml) -> dict[str, str]` maps those ids to
part names. Module constants: `BARE_PAGE` (the unformatted-keyword pattern),
`ARABIC`, `ROMAN`, `EMPTY_PGNUM`, `ROMAN_FORMATS`.

### `add_toc_placeholders.py`

```
python3 add_toc_placeholders.py <file.docx> [--entries '[{"level":1,"text":"…","page":"1"}]'] [--dry-run]
```

```python
extract_headings(document_xml: str, max_level: int = MAX_LEVEL) -> list[dict]
insert_placeholders(document_xml: str, entries: list[dict]) -> tuple[str, int, bool]
ensure_update_fields(settings_xml: str) -> tuple[str, bool]
add_toc_placeholders(docx_path: str | Path, entries: list[dict] | None = None, dry_run: bool = False) -> dict
main(argv: list[str] | None = None) -> int
```

`insert_placeholders` returns a three-tuple: the new XML, how many entries were
placed, and whether the XML actually changed. That third value is what makes
re-running a no-op. `ensure_update_fields` returns a two-tuple of the new XML and
whether it changed. Module constants: `CAPTION_PREFIX`, `MAX_LEVEL = 3`,
`PLACEHOLDER_PAGE = "1"`. The remaining names in the module — `_local`,
`_field_char_spans`, `_has_toc_field`, `_entry_paragraph`, `_escape`,
`_block_index_of` — are the steps those four functions are made of; `references/toc.md`
describes what each step does.

`fix_footer_fields.py` keeps the same split: `_footer_format_map` and
`_resolve_footer_targets` build the footer → format mapping described in
`routes/format.md`, and `BARE_PAGE`, `ARABIC`, `ROMAN`, `EMPTY_PGNUM` and
`ROMAN_FORMATS` are the patterns and switches that mapping feeds.

## 10. What this API does not do

- **No document generation.** No method here creates paragraphs from content. The
  package and the session come from `routes/create.md`; the words come from
  elsewhere.
- **No schema validation.** `validate()` is a presence check. No XSD ships with the
  plugin.
- **No rendering or conversion.** No LibreOffice, no PDF pipeline, no page images.
- **No auto-repair.** `postcheck.py --fix` is accepted and fixes nothing;
  `fix_footer_fields.py` and `add_toc_placeholders.py` are the repair tools.
- **No archive API beyond `_pack_document`.** There is no pack/unpack CLI. Unzip and
  zip yourself, or import `_pack_document`.
- **No network, no subprocess.** Every operation is local file and XML work.
