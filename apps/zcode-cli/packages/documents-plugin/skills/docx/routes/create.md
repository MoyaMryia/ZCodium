# Route: create

Bring a document that does not exist yet into a state this plugin can edit, and pack
it back into a `.docx`.

**Read this first: there is no content generator in this plugin.** Nothing here
writes a sentence, picks a style sheet, or lays out a page. What this route builds is
the _package_ — the unpacked directory tree — and the _session_ — the `Document`
object that owns the edits. The words come from whatever produced the request; the
`.docx` skeleton comes from here.

Two origins, one destination:

- a `.docx` that another build path already produced (the common case — this plugin
  finishes and reviews documents, it does not author them);
- a minimal package you assemble by hand, when nothing has produced a file yet.

Both end in the same place: an unpacked directory, a `Document` on it, and a
repacked `.docx`.

## 1. Unpack an existing `.docx`

```bash
unzip report.docx -d unpacked/
```

Keep the layout intact: `[Content_Types].xml`, `_rels/.rels`, `word/document.xml`,
and whatever else the archive carried. `Document` copies this tree into a temp
directory and edits the copy, so the directory you hand it is only read — but do not
rearrange it, because every part path below is a literal lookup.

## 2. Or assemble the minimal package by hand

`Document.__init__` touches four parts unconditionally. A package that carries
exactly these constructs cleanly; every other part this plugin needs it creates on
demand.

```
[Content_Types].xml
_rels/.rels
word/document.xml
word/_rels/document.xml.rels
word/settings.xml
```

What each one is for, and what breaks without it:

| part                           | why `__init__` needs it                   | symptom when absent                                                                              |
| ------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `[Content_Types].xml`          | receives an `Override` for `people.xml`   | — (always present in a real package)                                                             |
| `_rels/.rels`                  | not read by this plugin                   | the archive is not a valid OOXML package; `postcheck.py` still runs, Word does not open the file |
| `word/document.xml`            | opened by the constructor itself          | `ValueError: XML file not found: word/document.xml`, raised from `Document(...)`                 |
| `word/_rels/document.xml.rels` | receives the `people.xml` relationship    | `ValueError: XML file not found: word/_rels/document.xml.rels`                                   |
| `word/settings.xml`            | receives the RSID and `<w:updateFields/>` | `ValueError: XML file not found: word/settings.xml`                                              |

A working skeleton, one body paragraph long:

```bash
mkdir -p unpacked/_rels unpacked/word/_rels

cat > unpacked/\[Content_Types\].xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
XML

cat > unpacked/_rels/.rels <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
XML

cat > unpacked/word/_rels/document.xml.rels <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>
XML

cat > unpacked/word/settings.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>
XML

cat > unpacked/word/document.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Body text goes here.</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>
  </w:body>
</w:document>
XML
```

Note what the skeleton does _not_ declare: `word/styles.xml`, `word/numbering.xml`,
footers, images. Add them as the content needs them, each with a relationship in
`word/_rels/document.xml.rels` and a content type in `[Content_Types].xml`. The
skeleton above references `styles.xml` in its rels; drop that relationship if you
do not create the part, because Word fails on a relationship whose target is
missing.

## 3. Construct the session

```python
import sys

sys.path.insert(0, "<plugin>/skills/docx")  # document.py uses a relative import
from scripts.document import Document

doc = Document("unpacked", track_revisions=False, author="ZCodium", initials="C")
```

`unpacked_dir` must exist and be a directory; anything else raises
`ValueError: Directory not found: …`. The constructor prints the RSID it chose —
that line is expected output, not an error.

Construction is where the comment infrastructure appears. On a bare skeleton it
writes all of this, and none of it needs a second call from you:

- `word/people.xml`, copied from `scripts/templates/people.xml` when absent, with
  this session's author appended as a `w15:person` and an `html.escape`d
  `w15:presenceInfo`;
- the `/word/people.xml` `Override` in `[Content_Types].xml` and the `people.xml`
  relationship in `word/_rels/document.xml.rels`, each added only when missing;
- this session's RSID into `word/settings.xml`, creating the `<w:rsids>` section
  when the file has none;
- `<w:updateFields w:val="true"/>`, unless the file already carries it.

`track_revisions=True` additionally writes `<w:trackRevisions/>`, which is what makes
Word record later edits as revisions rather than apply them silently.

New settings elements land at their schema-valid position — `trackRevisions` before
`defaultTabStop`, `updateFields` after it, `rsids` after `compat` — per the
`CT_Settings` child-order table in `scripts/identifiers.py`. That matters on a real
`settings.xml` with dozens of children: appending blindly produces a file Word
refuses to open.

## 4. Validate the precondition

```python
doc.validate()
```

`validate()` is a presence check, not a schema check. It raises
`ValueError: Validation failed: word/document.xml not found` when that part is
missing and returns `None` otherwise. A package that never had the part does not
reach this point — the constructor already refused it (§3) — so in practice this
fires when the part disappears between construction and the call, which is what
makes it the last check before `save()` writes. A document that passes it can still
be malformed OOXML; `postcheck.py` catches a different class of problem, and neither
substitutes for opening the file.

## 5. Save

```python
doc.save("out")            # writes the whole tree to a fresh directory
doc.save()                 # writes it back over the input directory
doc.save("out", validate=False)   # skips the precondition check
```

`save()` does four things in order: ensures comment relationships and content types
when comment parts exist, writes every part touched through an editor, runs
`validate()` unless disabled, then copies the whole unpacked tree to `destination`
(`dirs_exist_ok=True`, so an existing target is merged into). Omit the destination
and it copies back over the input directory — pass one whenever the original must
survive.

Nothing is persisted until `save()`. `add_comment`, `suggest_deletion` and the
`insert_*` family all mutate the in-memory DOM.

## 6. Pack

```python
import sys

sys.path.insert(0, "<plugin>/skills/docx")
from scripts.document import _pack_document

_pack_document("out", "report.docx")
```

`_pack_document(input_dir, output_file)` stages a copy of the tree in a temp
directory — the input directory is never modified — strips inter-element whitespace
and comments from every `*.xml` and `*.rels` part, and writes a DEFLATED archive.
The stripping is a correctness requirement, not a tidy-up: pretty-printed XML leaves
text nodes between elements, and Word is order-sensitive about the children of
`settings.xml`. `*:t` elements are skipped, because there the whitespace is content.

The shell equivalent, when you would rather not import a private name:

```bash
cd out && zip -r ../report.docx .
```

The two are not identical — `zip` keeps whatever whitespace the files already
carry — so prefer `_pack_document` when the tree has ever been pretty-printed.

## 7. Gate the result

```bash
python3 <plugin>/skills/docx/scripts/postcheck.py report.docx
```

A freshly created document fails `cover-separation` by design when it has a single
section, which a one-page memo always does. That is the rule working, not a defect
in the file — scope the run with `--only` when the document genuinely has no cover
(see `routes/read.md`).

## Failure modes

| symptom                                                        | cause                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `ValueError: Directory not found: …`                           | the path does not exist, or is a file                                           |
| `ValueError: XML file not found: word/settings.xml`            | the package has no settings part; create it before constructing                 |
| `ValueError: XML file not found: word/_rels/document.xml.rels` | the package has no document rels; create it before constructing                 |
| `ValueError: XML file not found: word/document.xml`            | the package has no document part; the constructor opens it before anything else |
| `ValueError: Validation failed: word/document.xml not found`   | the part disappeared between construction and `validate()` / `save()`           |
| `Using RSID: …` on stdout                                      | expected; the chosen RSID is printed once per construction                      |
| the input directory changed after `save()`                     | `save()` was called without a destination                                       |
| Word reports the file is corrupt                               | a part is referenced in `[Content_Types].xml` or a `.rels` but missing on disk  |
