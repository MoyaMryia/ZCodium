# `XMLEditor` API reference

`XMLEditor` is the base class in `scripts/utilities.py`. `DocxXMLEditor` extends it,
so every method below is available on the editor you get from
`doc["word/<part>.xml"]`. Split out of `python-api.md` to keep both files under
the 400-line limit; the module map in `python-api.md` §2 points here.

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

