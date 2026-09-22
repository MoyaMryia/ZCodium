# Third-party notices

## skills/pdf/scripts/ — MIT-derived

Nine files under `skills/pdf/scripts/` carry MIT-derived notices. They come from
two upstream projects, recorded separately below because the derivations differ
in kind: eight are ports of upstream scripts, one is an interface derivation
with no upstream code in it.

### appautomaton/document-SKILLs — the eight rendering and form scripts

Eight of the files under `skills/pdf/scripts/` derive from the `pdf/scripts/`
directory of the reference implementation:

    appautomaton/document-SKILLs
    https://github.com/appautomaton/document-SKILLs
    Copyright (c) 2026 appautomaton
    MIT License

That covers `convert_pdf_to_images.py`, `create_validation_image.py`,
`check_fillable_fields.py`, `extract_form_field_info.py`,
`fill_fillable_fields.py`, `fill_pdf_form_with_annotations.py`,
`check_bounding_boxes.py` and its unit test `check_bounding_boxes_test.py`.

The upstream work is licensed under the MIT License, which permits use, copying,
modification, merging, publication and distribution on the condition that the
copyright notice and the permission notice are carried along. Both are
reproduced in full — the copyright, permission, warranty and liability clauses —
in the header comment of each script, so a copy of any script on its own still
carries them; the derivation is recorded here as well.

The deltas from the upstream files are enumerated in each header. Summarised:
the PEP 723 header of each of the seven executable scripts declares
`requires-python = ">=3.10"`, the lowest interpreter that actually parses and
runs them (the upstream `>=3.12` is higher than the 3.10 this repository
targets, and the code uses no post-3.10 syntax); the test carries no PEP 723
header and is otherwise unchanged. No logic, argument or output was altered, and
each script's declared dependencies (`pdf2image`, `pypdf`, `Pillow`, or none for
the bounding-box checker and its test) are retained as upstream had them.

### eKoopmans/html2pdf.js — the option model of `html2pdf.py`

The ninth file, `html2pdf.py`, derives its option model from `html2pdf.js`:

    eKoopmans/html2pdf.js
    https://github.com/eKoopmans/html2pdf.js
    Copyright (c) 2017-2019 Erik Koopmans
    MIT License

The MIT clauses are reproduced in full in the file header, alongside the
copyright and the upstream project name, so the script carries them on its own.
The derivation is an interface derivation, and the delta is the whole rendering
path:

- **What is borrowed:** the option names, shapes and defaults — `margin` (single
  value, `[v, h]`, `[top, left, bottom, right]` or an object), `filename`,
  `image.type` / `image.quality`, the `pagebreak` modes (`css`, `legacy`,
  `avoid-all`) with their `before` / `after` / `avoid` selectors and the legacy
  `html2pdf__page-break` class, and the `html2canvas` / `jsPDF` passthrough
  objects.
- **What is not borrowed:** any code. Upstream is a browser library — it
  rasterises a DOM through `html2canvas` into a jsPDF image, and both stages
  require a DOM, so it cannot run under Node without jsdom plus node-canvas.
  None of its worker, pagebreak plugin or DOM clone is vendored here, and
  neither jsdom, node-canvas nor puppeteer is a dependency of this plugin.
- **Where the rendering lands:** on this repository's own toolchain.
  `html2pdf.py` and its module `html2pdf_render.py` delegate to the local
  LibreOffice HTML import (`soffice --headless`), which typesets vector text —
  searchable and small, where upstream produces a picture of text.
- **Consequences of that delta, stated so nobody expects upstream behaviour:**
  the `image` and `html2canvas` options are accepted, validated and echoed, and
  have no effect (there is no canvas stage); the `jsPDF` options survive only
  where they describe page geometry (`unit`, `format`, `orientation`); `margin`
  is honoured through CSS `@page` rather than jsPDF's unit conversion; and the
  page-break rules are subject to the LibreOffice import's own limits, which
  §6.6 of the skill documents and the script's headers record.

`cover_render.py` and `toc_validate.py` import `html2pdf_render.py` and add the
cover merge and the contents checks around it; both are original work.

## Everything else in this plugin

`package.json`, `.zcode-plugin/plugin.json`, this `NOTICE.md`,
`agents/visual-judge.md`, `skills/pdf/SKILL.md`, the three typesetting briefs
under `skills/pdf/briefs/`, the `pdf_qa` family
(`pdf_qa.py`, `pdf_qa_document.py`, `pdf_qa_text.py`, `pdf_qa_checks.py`,
`pdf_qa_colors.py`) and the typesetting additions
(`cover_render.py`, `toc_validate.py`, `toc_validate_document.py`, and the
render half `html2pdf_render.py`) are original work written for this repository,
apart from the option-model derivation recorded above. They are covered by the
repository's root Apache-2.0 license, which is why the `license` field of both
manifests reads `Apache-2.0`, with no `SEE LICENSE IN` pointer.

The typesetting content in `SKILL.md` and the briefs is derived from publicly
available LaTeX and typesetting knowledge — document class and engine behaviour,
page geometry, float and widow control, font selection, bibliography and
rasterization tooling. Where a factual conclusion restates a widely published
typesetting convention (a body leading around 1.5, margins near 2 cm, poster body
text sized for a viewing distance of one to two metres), that convergence is a
property of the public convention, not of any particular upstream document. The
MIT scripts above are the only third-party licensed code present; everything else
in the skill and brief layer is independent of any upstream vendor's material.

## What is deliberately absent

No upstream vendor's LaTeX typesetting scripts, design engine, template,
proprietary license text or copyright notice is distributed with this plugin. An
earlier packaging of this skill carried a proprietary non-commercial
`LICENSE.txt` alongside a set of typesetting-rendering scripts; neither the
license text nor any of those scripts ships here, which is why the two manifests
carry no `SEE LICENSE IN` pointer and why the typesetting knowledge is written
from public LaTeX practice rather than derived from that package. That earlier
package's form-filling and rendering scripts are **not** the source of the
MIT-derived files under `skills/pdf/scripts/`; the eight ports come from
`appautomaton/document-SKILLs` and the option model of `html2pdf.py` comes from
`eKoopmans/html2pdf.js`, under the two notices reproduced above.

A PDF produced with this skill embeds the fonts and packages of whichever TeX
distribution ran the build. Those retain their own licenses, and the obligations
of the fonts a document actually embeds are the document author's to settle.
