# Route: edit

Propose text as a tracked change, or take a side on one that is already there.

Four methods, two directions:

| method                   | direction                                               |
| ------------------------ | ------------------------------------------------------- |
| `suggest_deletion(elem)` | propose removing something that is currently plain text |
| `suggest_paragraph(xml)` | propose adding a paragraph                              |
| `revert_insertion(elem)` | reject an insertion someone else made                   |
| `revert_deletion(elem)`  | reject a deletion someone else made                     |

All four live on the editor returned by `doc[...]`, and all four mutate the DOM in
memory. Nothing reaches disk until `save()`.

## 1. Set the session up for revisions

```python
doc = Document("unpacked", track_revisions=True, author="Editor", initials="E")
```

`track_revisions=True` writes `<w:trackRevisions/>` into `word/settings.xml`, at its
schema-valid position per the `CT_Settings` child-order table. Without it Word stops
recording _new_ edits as revisions — the markup written below still renders as a
tracked change, but anything typed into the document afterwards is applied silently.

## 2. Propose a deletion

```python
editor = doc["word/document.xml"]
run = editor.get_node(tag="w:r", attrs={"w:rsidR": "7ACC09CE"})
editor.suggest_deletion(run)
```

`suggest_deletion` accepts exactly two element kinds and raises
`ValueError: Element must be w:r or w:p, got <tag>` for anything else.

**On a `w:r`** — converts `w:t` to `w:delText`, moves `w:rsidR` to `w:rsidDel`, wraps
the run in a new `<w:del>`, and returns that wrapper. The run itself keeps its
`w:rPr`, so the struck-out text keeps its formatting. A run that already contains
`w:delText` raises `ValueError: w:r element already contains w:delText` — the method
refuses to delete something twice.

**On a `w:p`** — the paragraph must not already carry tracked changes, or it raises
`ValueError: w:p element already contains tracked changes`. Every `w:t` in it becomes
`w:delText`, every run's `w:rsidR` becomes `w:rsidDel`, and all non-`w:pPr` children
are wrapped in a single `<w:del>` inside the paragraph. The return value is the
`w:p` itself, not the wrapper.

The extra step for numbered list items: a paragraph whose `w:pPr` carries `w:numPr`
also gets `<w:del/>` added to `w:pPr/w:rPr`. Without that marker Word deletes the
text but keeps the list number, and the numbering silently renumbers.

## 3. Propose an insertion

```python
xml = editor.suggest_paragraph("<w:p><w:r><w:t>新增的一段。</w:t></w:r></w:p>")
editor.insert_after(anchor, xml)
```

`suggest_paragraph` is a **static** method that takes a `<w:p>` XML string and
returns a transformed string. It does not touch the DOM, and it cannot be called on
an element — the two-step shape is deliberate, because the transformed XML has to go
through `insert_after` to get its bookkeeping attributes stamped.

The transformation: `<w:ins/>` is added to `w:pPr/w:rPr` (creating `w:pPr` and `w:rPr`
when absent, and inserting the marker as the first child of `w:rPr`), and every
non-`w:pPr` child of the paragraph is wrapped in one `<w:ins>`.

The `<w:ins/>` inside `w:rPr` is the paragraph mark revision — it is what makes Word
treat the paragraph break itself as inserted, so accepting the change does not leave
an empty paragraph behind. It is a `w:ins` element as far as attribute injection is
concerned, so it too receives `w:id`, `w:author` and `w:date`, and it consumes a
change id — a document whose first tracked change is an insertion therefore carries
both an empty `w:ins` marker and the `w:ins` that wraps the runs.

Because placement goes through `insert_after`, the new `w:ins` receives `w:id`,
`w:author`, `w:date` and `w16du:dateUtc`, the runs receive `w:rsidR`, and the
paragraph receives `w:rsidR`, `w:rsidRDefault`, `w:rsidP`, `w14:paraId` and
`w14:textId`. None of that has to be written by hand.

## 4. Take a side on an existing change

```python
ins = editor.get_node(tag="w:ins", attrs={"w:id": "5"})
editor.revert_insertion(ins)

dele = editor.get_node(tag="w:del", attrs={"w:id": "3"})
nodes = editor.revert_deletion(dele)
```

### What each accepts

Both methods take either the tracked-change element itself or any container holding
them. The branch is on `elem.tagName`:

- `revert_insertion` — a single `w:ins`, or a container (`w:p`, `w:body`, `w:tbl`,
  anything) whose descendants include `w:ins`;
- `revert_deletion` — a single `w:del`, or a container whose descendants include
  `w:del`.

Neither walks up: given a `w:r` that sits inside a `w:ins`, `revert_insertion` finds
no `w:ins` among the run's own descendants and raises
`ValueError: revert_insertion requires w:ins elements. The provided element <w:r>
contains no insertions.` Pass the `w:ins`, or a container above it.

### What each does

`revert_insertion` keeps the `w:ins` where it is and wraps the runs _inside_ it in a
new `w:del`, converting `w:t` to `w:delText` and `w:rsidR` to `w:rsidDel`. The
result is an insertion that is itself struck out — Word shows the text as inserted
and deleted, and accepting all changes leaves nothing.

`revert_deletion` clones the deleted runs into a new `w:ins` placed immediately
_after_ the `w:del`, converting `w:delText` back to `w:t` and `w:rsidDel` back to
`w:rsidR`. The `w:del` is left in place, so both readings survive: rejecting the
deletion restores the text, accepting it removes it again.

### What each returns — and why they differ

| input                      | `revert_insertion` | `revert_deletion`   |
| -------------------------- | ------------------ | ------------------- |
| a single `w:ins` / `w:del` | `[elem]`           | `[elem, new w:ins]` |
| a container                | `[elem]`           | `[elem]`            |

`revert_deletion` on a single `w:del` hands back the newly created insertion as the
second list item, because that node did not exist before and there is no other way
to reach it. `revert_insertion` has no equivalent: the `w:del` it creates is always
inside the `w:ins` you already passed in.

For a container, `revert_deletion` returns only `[elem]` even though it created
insertions — one per `w:del` found. To reach them, query again:

```python
for new_ins in editor.dom.getElementsByTagName("w:ins"):
    ...
```

Both raise when there is nothing to act on: `revert_deletion` with no `w:del`
descendant raises `ValueError: revert_deletion requires w:del elements. …`, and
`revert_insertion` likewise for `w:ins`. Neither is a no-op.

## 5. Save, repack, gate

```python
doc.save("revised")
```

```bash
python3 <plugin>/skills/docx/scripts/postcheck.py revised.docx --json
```

Two rules interact with tracked changes specifically:

- `numbering-continuity` reads the `w:numId` values actually used, so a paragraph
  you struck out still counts. It gap-checks only ids that are all digits.
- `heading-continuity` reads paragraph styles regardless of whether the heading is
  inside a `w:ins` or a `w:del`, so deleting a heading can open a level gap that the
  gate then reports. That is the gate being right.

## 6. Full sequence

```python
import sys

sys.path.insert(0, "<plugin>/skills/docx")
from scripts.document import Document

doc = Document("unpacked", track_revisions=True, author="Editor", initials="E")
editor = doc["word/document.xml"]

# strike out a run
run = editor.get_node(tag="w:r", attrs={"w:rsidR": "7ACC09CE"})
editor.suggest_deletion(run)

# insert a paragraph as a tracked insertion
anchor = editor.get_node(tag="w:p", contains="1.1 背景")
xml = editor.suggest_paragraph("<w:p><w:r><w:t>补充说明一段。</w:t></w:r></w:p>")
editor.insert_after(anchor, xml)

# reject someone else's insertion
ins = editor.get_node(tag="w:ins", attrs={"w:id": "5"})
editor.revert_insertion(ins)

# reject someone else's deletion
dele = editor.get_node(tag="w:del", attrs={"w:id": "3"})
nodes = editor.revert_deletion(dele)
print(len(nodes))  # 2 — the w:del and the w:ins that restores its text

doc.save("revised")
```

## Failure modes

| symptom                                                    | cause                                                                                              |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `ValueError: Element must be w:r or w:p, got <tag>`        | `suggest_deletion` was given a table, a `w:t`, or a `w:del`                                        |
| `ValueError: w:r element already contains w:delText`       | the run is already deleted; deleting it again is refused                                           |
| `ValueError: w:p element already contains tracked changes` | the paragraph already carries `w:ins` or `w:del`; revert it first, or edit a different paragraph   |
| `revert_insertion` raises on a run                         | it does not walk up to the enclosing `w:ins`; pass the `w:ins` or a container                      |
| the new `w:ins` has no `w:id`                              | the XML was placed with a raw DOM call instead of `insert_after`, so attribute injection never ran |
| `suggest_paragraph` returns a string, nothing changed      | it is static and pure; the returned XML still has to be inserted                                   |
