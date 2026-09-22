# Environment setup

Everything the `docx` skill runs is Python. There is no Node runtime, no
`node_modules`, and no npm install step — the document-generation library that
upstream documentation describes is not part of this plugin, and nothing here
depends on it.

## What is required

| requirement  | version       | why                                       |
| ------------ | ------------- | ----------------------------------------- |
| Python       | 3.10 or newer | every script under `skills/docx/scripts/` |
| `defusedxml` | any recent    | every XML parse in the plugin             |

That is the whole list. There is nothing to build, no lockfile, and no transitive
dependency.

## Python

`python3` must be on `PATH`. The scripts are plain standard-library Python plus
`defusedxml`; they are invoked as

```bash
python3 <plugin>/skills/docx/scripts/postcheck.py report.docx
```

and the same interpreter is used when you import the API from your own code.

The floor is 3.10 because the code uses `X | Y` union syntax and builtin generics in
annotations, and `from __future__ import annotations` is relied on rather than
treated as optional. Older interpreters fail at import time, not at run time, so the
error is immediate and unambiguous. Newer versions are fine; nothing here uses a
feature removed after 3.10.

## defusedxml

`defusedxml` is the only third-party dependency. It is used in two places:

- `utilities.py` — `defusedxml.minidom` to parse each part and `defusedxml.sax` to
  build the line-tracking parser;
- `packing.py` — `defusedxml.minidom` while stripping formatting whitespace.

Every XML parse in the plugin goes through it. A `.docx` is an untrusted archive:
entity-expansion and external-entity attacks are the standard ways a malicious
document turns a parser into a file read or a hang, and `defusedxml` closes both.
Substituting the standard library's `xml` package is not a drop-in change.

Install it with the interpreter you will actually run:

```bash
python3 -m pip install defusedxml
```

On a distribution that marks the system Python as externally managed (PEP 668), that
command refuses to run. Pick one:

```bash
python3 -m pip install --user defusedxml     # installs into the user site
python3 -m venv .venv && .venv/bin/pip install defusedxml
```

A virtual environment is the safer of the two when several projects share the
machine, because the plugin then runs under whichever interpreter is first on
`PATH` and a system-wide install is visible to all of them.

Verify:

```bash
python3 -c "import defusedxml.minidom, defusedxml.sax; print('defusedxml ok')"
```

## Optional: archive tools

The Python API takes an unpacked directory. Two ways to get one:

```bash
unzip report.docx -d unpacked/          # and back: cd unpacked && zip -r ../report.docx .
```

```python
import sys
sys.path.insert(0, "<plugin>/skills/docx")
from scripts.document import _pack_document
_pack_document("unpacked", "report.docx")
```

`_pack_document` is preferred when the tree has ever been pretty-printed, because it
strips the inter-element whitespace that Word is order-sensitive about. `unzip` and
`zip` are convenience only — nothing in the plugin shells out to them.

On Windows, where `unzip` and `zip` are usually absent, use `_pack_document` and
Python's `zipfile` for unpacking. The scripts themselves are platform-independent:
paths go through `pathlib`, and the archive work goes through `zipfile`.

## Checking the environment

```bash
bash <plugin>/skills/docx/env_setup/env_check.sh
```

It verifies the interpreter version, that `defusedxml` imports, and that the script
files the skill depends on are present. Exit status is `0` when everything passes and
`1` otherwise, so it drops into a setup step.

```bash
bash <plugin>/skills/docx/setup.sh
```

`setup.sh` is the entry point that prepares the environment: it runs the same checks
and installs `defusedxml` when it is missing. Pass `--check-only` to skip the
install, or `--yes` to install without the confirmation prompt.

## Not required

- **Node.js, npm, pnpm** — no JavaScript runs anywhere in this plugin.
- **Any JavaScript document-generation library** — the upstream plugin generated
  documents through one; this one does not generate them at all. Nothing here
  imports, vendors or shells out to it.
- **LibreOffice, Word, poppler** — the plugin neither renders nor converts. Turning a
  `.docx` into page images for the `visual-judge` gate is a separate step done with
  whatever converter the host has.
- **An OOXML schema set** — `validate()` is a presence check, and `postcheck.py`
  reads the package with `xml.etree.ElementTree`. No XSD ships here.
