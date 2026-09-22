# Route: comment

Attach a comment to a span of an existing document, and thread a reply onto it.

Everything here goes through `Document` — you never hand-write the comment parts.
`add_comment` and `reply_to_comment` write `word/comments.xml` and the four metadata
parts that Word 2013+ expects, insert the range markers into `word/document.xml`, and
register the relationships and content types. None of that is persisted until
`save()`.

## 1. What `start` and `end` are

```python
doc.add_comment(start, end, text) -> int
```

`start` and `end` are **elements of `word/document.xml`'s DOM** — the objects
`get_node` returns, not strings, not line numbers, not XPath. Run-level anchors are
allowed: a `w:r` works as well as a `w:p`.

```python
editor = doc["word/document.xml"]
first = editor.get_node(tag="w:p", contains="第一章 概述")
last = editor.get_node(tag="w:p", contains="1.1 背景")
cid = doc.add_comment(start=first, end=last, text="这两节之间缺少过渡段。")
```

What gets written into `word/document.xml`:

- `<w:commentRangeStart w:id="N"/>` immediately **before** `start`;
- `<w:commentRangeEnd w:id="N"/>` plus a reference run, **after** `end`.

The one asymmetry: when `end` is a `w:p`, the range end and the reference run are
appended _inside_ it, as its last children. For anything else — a run, a table — they
are inserted after it as siblings. So a comment whose `end` is a paragraph closes at
the end of that paragraph's content, and one whose `end` is a run closes right after
that run, mid-paragraph.

The reference run is the clickable anchor in the margin:

```xml
<w:commentRangeEnd w:id="0"/>
<w:r>
  <w:rPr><w:rStyle w:val="CommentReference"/></w:rPr>
  <w:commentReference w:id="0"/>
</w:r>
```

In parallel, `add_comment` writes into the comment parts — creating each from
`scripts/templates/` on first use:

| part                          | what lands there                                                    |
| ----------------------------- | ------------------------------------------------------------------- |
| `word/comments.xml`           | a `w:comment` with the text, plus the `annotationRef` reference run |
| `word/commentsExtended.xml`   | a `w15:commentEx` carrying the paragraph id, `w15:done="0"`         |
| `word/commentsIds.xml`        | a `w16cid:commentId` linking paragraph id to a durable id           |
| `word/commentsExtensible.xml` | a `w16cex:commentExtensible` carrying the durable id                |
| `word/people.xml`             | the author, once per session, from `__init__`                       |

`w:author`, `w:date`, `w:initials` on the `w:comment`, the `w:rsid*` attributes on
its paragraph, and the `w:rsidR` on the reference run are stamped automatically by
the editor. The text is escaped for `&`, `<` and `>` before insertion; nothing else
in it is interpreted.

## 2. What the returned id is for

`add_comment` returns the new comment's `w:id` as an `int`. It is the handle for
three things:

- `reply_to_comment(cid, text)` — the parent link;
- finding the comment again, `editor.get_node(tag="w:comment", attrs={"w:id": str(cid)})`
  on the `word/comments.xml` editor;
- locating its anchor in the body, `get_node(tag="w:commentRangeStart", attrs={"w:id": str(cid)})`.

Ids continue after the highest existing one: `Document.__init__` reads
`word/comments.xml` when present and starts `next_comment_id` above the maximum
`w:id` found there. On a package with no comments part, the first id is `0`.

## 3. Thread a reply

```python
reply = doc.reply_to_comment(parent_comment_id=cid, text="已确认，下版修订。")
```

The parent id must be known — either present in `word/comments.xml` or created
earlier in this session. An unknown id raises
`ValueError: Parent comment with id=N not found`; note that a comment whose
paragraph carries no `w14:paraId` is skipped when existing comments are loaded, and
therefore cannot be replied to.

The reply's anchors are placed relative to the parent's, not the document's:

- its `commentRangeStart` goes immediately after the parent's `commentRangeStart`;
- its `commentRangeEnd` and reference run go after the parent's reference run.

So a reply reuses the parent's span rather than opening a new one, which is what
Word renders as a collapsed thread. The parent link itself is recorded in
`word/commentsExtended.xml` as `w15:paraIdParent`, matching paragraph ids — which is
why loading existing comments reads `w14:paraId` off each comment's `w:p` and not
something else.

Replies are comments in every other respect: own `w:id`, own entry in all four
comment parts, own durable id. `reply_to_comment` returns that id, so replies can be
chained.

## 4. Save and repack

```python
doc.save("reviewed")
```

`save()` is where the relationship and content-type registration happens — but only
when comment parts exist. `word/comments.xml` and its three siblings get their
`Relationship` entries in `word/_rels/document.xml.rels` and their `Override` entries
in `[Content_Types].xml` at that point, each added only when missing. A package that
already declares them is left alone, so saving twice adds nothing.

`people.xml` is the exception: its relationship and content type are written during
`__init__`, because the author is registered before the first comment exists.

Then repack and gate:

```bash
python3 <plugin>/skills/docx/scripts/postcheck.py reviewed.docx --json
```

The gate runs after the comments are saved and packed, because comments rewrite the
XML the gate reads. Comments do not by themselves trip any of the eleven rules, but
the session that produced them may have.

## 5. Full sequence

```python
import sys

sys.path.insert(0, "<plugin>/skills/docx")
from scripts.document import Document

doc = Document("unpacked", author="Reviewer", initials="R")
editor = doc["word/document.xml"]

first = editor.get_node(tag="w:p", contains="第一章 概述")
last = editor.get_node(tag="w:p", contains="1.1 背景")
cid = doc.add_comment(start=first, end=last, text="这两节之间缺少过渡。")
doc.reply_to_comment(cid, "已确认，下版补一句承接。")

doc.save("reviewed")
```

## 6. Verifying the result

```bash
unzip -p reviewed.docx word/comments.xml | head -c 600
unzip -p reviewed.docx word/document.xml | tr '>' '>\n' | grep -n "comment" | head
```

The first shows the comment body with its `w:id`; the second shows the range markers
and reference runs in document order, which is where an anchor in the wrong place
becomes visible.

## Failure modes

| symptom                                          | cause                                                                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `ValueError: Parent comment with id=N not found` | the id was never created in this session and is not in `word/comments.xml`, or that comment's paragraph has no `w14:paraId` |
| comment appears at the wrong place               | `start`/`end` were line numbers or strings; they must be DOM elements                                                       |
| comment range ends mid-paragraph                 | `end` was a run rather than the paragraph; pass the paragraph to close at its end                                           |
| no comment parts in the output                   | `save()` was never called, or the destination was not repacked                                                              |
| `ValueError: Multiple nodes found: <w:p>`        | the anchor text appears in more than one paragraph; narrow with `attrs` or a longer `contains`                              |
