---
name: pdf
description: Use whenever a PDF is the artifact being produced — a report, resume or CV, poster, academic paper, thesis, letter, invoice, handout or slide notes — in other words whenever the deliverable is a typeset PDF rather than an editable Office file or a web page. Covers routing the document to a typesetting brief, choosing a LaTeX document class and engine, driving a latexmk build with xelatex / lualatex / pdflatex, resolving bibliography passes with biber or bibtex, and rasterizing pages to PNG for the visual-judge gate. Also use it to finish an existing PDF — fill its AcroForm fields or stamp text annotations onto a flat page — and to render a PDF's pages to PNG. Use it when the user asks to write, generate, typeset, lay out or format a PDF, asks why a generated PDF looks wrong, or reports symptoms such as a blank page, a table broken across pages, tofu boxes or missing glyphs, fonts that exist only on the build machine, a bibliography printed as question marks, a table of contents with placeholder page numbers, text running into the margin, a resume spilling onto a second page, a poster whose body text is unreadable at arm's length, or asks to fill out or complete a PDF form.
---

# PDF Production

Typeset a PDF from LaTeX source. This skill routes the document to a brief, drives the build, and gates the result on rendered page images rather than on the compile log.

## 1. What this skill covers

Two jobs, one artifact. The first is **producing** a PDF whose content is _typeset_: the source is LaTeX, the output is a `.pdf`, and the layout is decided by a document class plus a preamble rather than by dragging boxes. The second is **finishing an existing PDF**: filling its form — whether it exposes AcroForm fields or is only a flat page you annotate — and rendering its pages to PNG so the `visual-judge` gate can look at them (§6).

It does **not**:

- convert between Office formats — no `.docx` → PDF exporter, no PDF → text extraction pipeline, no poster renderer. The one exception is HTML → PDF (§6.6): a plain HTML page can be typeset through the local LibreOffice, because that path shares nothing with the LaTeX pipeline and needs no extra toolchain beyond what §3 already requires;
- redact or do page surgery — no script here removes content, splits or merges pages, or strips annotations; form filling adds fields and annotations, it does not rewrite page content. Putting a rendered cover in front of a body PDF (§6.6) is concatenation of whole pages, not surgery on them;
- ship a design engine, a template library or a LaTeX renderer of its own. The typesetting path runs on a TeX distribution plus the poppler / mupdf / ghostscript utilities that already sit beside it. The scripts under `skills/pdf/scripts/` are thin Python wrappers: the rendering and form-filling ones over `pdf2image` and `pypdf` (`pdf2image` in turn shells out to poppler), the HTML path over the LibreOffice HTML import, and the quality gate over the standard library plus the poppler command-line tools.

Keep the `.tex` source next to the output. The build is reproducible, the reader will ask for changes, and a PDF whose source has been thrown away cannot be revised. A form you fill is different in kind: keep the `fields.json` and the field values beside the output so a correction is a re-run of the fill step, not a fresh analysis of the page.

## 2. Route the document to a brief first

Decide what kind of document this is before writing any preamble. The brief fixes the page geometry, the type scale, the column structure and the checks that matter; picking them ad hoc per document is how a resume ends up two pages long and a poster ends up unreadable.

| The artifact is…                                                                                               | Read                          | What the brief settles                                                                                |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| a report, technical document, white paper, manual, book chapter, or an academic paper with no journal template | `skills/pdf/briefs/report.md` | section hierarchy, figure and table numbering, table of contents, headers and footers, bibliography   |
| a resume, CV, or a one-page professional profile                                                               | `skills/pdf/briefs/resume.md` | the single-page constraint, information density, ATS readability, two-column structure                |
| a conference, event or exhibition poster on A0 / A1 stock                                                      | `skills/pdf/briefs/poster.md` | large-format geometry, viewing distance and the type scale it forces, colour blocks, figure rescaling |

Rules of thumb while routing:

- An academic paper with a publisher template (`\documentclass{...}` supplied by the venue) uses that template and borrows only the _figure, caption, float and bibliography_ parts of `report.md`. Never fight the venue's class.
- A thesis follows `report.md` with `\documentclass{report}` or a KOMA-Script `scrreprt`, plus front matter in roman numerals.
- A letter or an invoice is short-form `report.md`: skip the table of contents, keep one section at most.
- A document that will be printed and bound needs a binding offset (`bindingoffset` in `geometry`), which changes the inner margin and nothing else.

Read the brief before the first `\documentclass`, not after the first failed build.

## 3. Environment prerequisites

The build is a TeX toolchain. Confirm what is installed before promising a PDF.

| Need                              | What satisfies it                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| a TeX distribution                | TeX Live (2020 or later), MiKTeX, or MacTeX. Provides `pdflatex`, `xelatex`, `lualatex`, `bibtex`, `biber` |
| the build driver                  | `latexmk`, which ships with all three distributions                                                        |
| the packages the document loads   | from the distribution; `tlmgr install <pkg>` on TeX Live, MiKTeX installs on demand                        |
| rasterization for the visual gate | `pdftoppm` / `pdftocairo` (poppler), `mutool draw` (mupdf), or `magick` / `gs` (ImageMagick / ghostscript) |
| output inspection                 | `pdfinfo` and `pdffonts` (poppler) for page count, page size and font embedding                            |
| the HTML path (§6.6)              | LibreOffice `soffice` — the only renderer `html2pdf.py` and `cover_render.py` use                          |

Detect, do not assume:

```bash
which latexmk xelatex lualatex pdflatex pdftoppm pdfinfo pdffonts
```

Cross-platform notes:

- **Windows** — MiKTeX installs missing packages on the fly, which turns a missing package into a prompt instead of an error; pass `-interaction=nonstopmode` so the build never blocks on a console question. Executables live under `%LOCALAPPDATA%\Programs\MiKTeX\miktex\bin\x64`, not on a bare `PATH` in every shell.
- **macOS** — MacTeX puts the binaries in `/Library/TeX/texbin`, which the installer adds to `PATH`; a shell that predates the install will not see them.
- **Linux** — a minimal TeX Live install often omits `latexmk`, `biber`, `collection-fontsrecommended` and the language collections. A document that builds on one machine and fails on another is almost always a package-collection difference, not a source difference.

When the text is not Latin — Chinese, Japanese, Korean, Cyrillic, Greek, or heavy symbol use — the engine choice stops being optional; see §4.

## 4. Choose the engine before the class

The engine is a build-time decision that the preamble depends on, so it cannot be swapped later without editing the source.

| Engine     | Use when                                                         | Consequences                                                                                                                            |
| ---------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `pdflatex` | Latin-script text, maximum package compatibility, fastest builds | reads only `.tfm`/Type1 fonts with `fontenc`; no access to installed system fonts; no Unicode in the source beyond what `inputenc` maps |
| `xelatex`  | system fonts, Unicode source, CJK, emoji-adjacent symbols        | `fontspec` and `ctex` become available; slower, and a few older packages misbehave                                                      |
| `lualatex` | all of the above plus Lua scripting and `luatexja` for Japanese  | slowest build; the most predictable Unicode handling                                                                                    |

Rules:

- **Anything with CJK text uses `xelatex` or `lualatex`.** `pdflatex` cannot resolve the codepoints; the symptom is tofu boxes or a hard error on the first Chinese character.
- **`fontspec` and `ctex` require a Unicode engine.** Loading either under `pdflatex` fails immediately.
- **A publisher template usually pins the engine.** Honour it.
- Pick one engine per document and keep it. A source that switches engines mid-life needs its font and encoding preamble rewritten each time.

## 5. The build pipeline

Work in this order. Each step has a failure mode that the next step will not catch.

### Step 1 — Fix the geometry

```latex
\usepackage[a4paper,margin=2.5cm,bindingoffset=8mm]{geometry}
```

The paper size and the margins are the two numbers every later decision depends on: the type scale, the column widths, the largest figure that fits, and whether the document is one page or three. Set them from the brief, then leave them alone.

`\textwidth` is the real constraint, not the paper size. Every figure, table and box is sized against it.

### Step 2 — Load the preamble in dependency order

A LaTeX preamble is order-sensitive. The order that works:

1. `fontenc` / `inputenc` (pdflatex only) — `\usepackage[T1]{fontenc}` fixes hyphenation and gives proper glyphs in the output PDF.
2. `geometry` — must come before anything that measures the text block.
3. `fontspec` or `ctex` (Unicode engines) or `lmodern` / a font package (pdflatex) — fonts before anything that uses them.
4. `xcolor` — before `tcolorbox`, `tikz` and anything that defines colours.
5. `babel` or `polyglossia` — language-dependent hyphenation, before `microtype`.
6. `microtype` — margin kerning and protrusion; it is the cheapest justification improvement available.
7. Layout and content packages: `booktabs`, `graphicx`, `caption`, `subcaption`, `enumitem`, `tabularx`, `tcolorbox`, `tikz`, `pgfplots`.
8. `fancyhdr` or `scrlayer-scrpage` — headers and footers.
9. `hyperref` — near the end, because it rewrites cross-reference and citation internals.
10. `cleveref` — after `hyperref`, so `\cref` can resolve the link targets.
11. `biblatex` with `backend=biber` (or `natbib` with `bibtex`).

`hyperref` and `cleveref` late is not a style preference: loading them early produces `\ref` that points at the wrong counter and citations that lose their link.

### Step 3 — Write the body with real structure

- `\section`, `\subsection`, `\subsection` in order. Never skip a level; a heading hierarchy that jumps from `\section` to `\subsubsection` is a defect the reader sees even when the numbering looks fine.
- Figures and tables float. Use `[htbp]`, and put a `\FloatBarrier` (`placeins`) at the end of each section so floats stay near the text that introduces them.
- `\caption` goes **below** a figure and **above** a table. This is the convention in every major style guide, and readers navigate by it.
- Cross-reference with `\label` immediately after `\caption`, never before it, and never on a bare `\section` line without a suffix (`fig:`, `tab:`, `sec:`, `eq:`). `\cref` then needs no disambiguation.
- Break long URLs with `\usepackage{xurl}` or `\Urlmuskip`, or let `hyperref`'s `breaklinks` handle it. An unbreakable URL is the single most common overfull hbox in a technical report.

### Step 4 — Build with latexmk

```bash
latexmk -pdf -interaction=nonstopmode main.tex          # pdflatex
latexmk -xelatex -interaction=nonstopmode main.tex      # xelatex
latexmk -lualatex -interaction=nonstopmode main.tex     # lualatex
```

`latexmk` is the driver, not a convenience wrapper. It knows the dependency graph: it reruns the engine until `.aux`, `.toc` and `.bbl` stop changing, and it invokes `bibtex` or `biber` when the `.aux` declares a bibliography. Running `xelatex` twice by hand leaves cross-references and the table of contents stale, and the symptom — placeholder page numbers, `[?]` citations — looks like a source bug.

- `-interaction=nonstopmode` keeps the build from stopping at the first error and waiting on stdin, which is what hangs a build inside a tool call.
- `-halt-on-error` stops at the first error instead of scrolling past it; useful while debugging, wrong for a final gate.
- `-quiet` reduces log volume. Keep the full log while debugging.
- `-C` / `-c` clean the intermediates. Never delete `main.aux` by hand mid-build.
- `-shell-escape` enables `\write18` — needed by `minted`, `imakeidx` and a few plotting packages. Enable it deliberately: it lets the document run arbitrary commands.

### Step 5 — Bibliography

With `biblatex`:

```latex
\usepackage[backend=biber,style=numeric,sorting=none]{biblatex}
\addbibresource{refs.bib}
...
\printbibliography
```

With `natbib` + `bibtex`: `\bibliographystyle{...}` plus `\bibliography{refs}`. Pick one per document; mixing them produces duplicate bibliography sections.

`latexmk` runs `biber`/`bibtex` for you, but only when the `.aux` from the previous pass names the `.bcf`/`.aux` bibliography file — which is why a clean build needs the extra pass. A bibliography that prints `[?]` or a `Citation undefined` warning means the bibliography tool never ran or ran before the citation existed: rerun `latexmk`, do not edit the source.

### Step 6 — Inspect the artifact, not the log

A build that exits 0 can still be wrong. Check the output directly:

```bash
pdfinfo main.pdf        # page count, page size, PDF version, producer
pdffonts main.pdf       # every font, and whether it is embedded
```

- **Page count** against what the brief asks for. A resume is one page; a report is whatever it is, but a sudden jump of three pages means a float got deferred.
- **Page size** must match the target stock. A poster built at A4 has a geometry bug, not a scaling problem.
- **Every font must be embedded** (`emb` = `yes`). A font that is not embedded renders as a substitute on the reader's machine and fails print preflight. `pdffonts` reporting a `Type 3` bitmap font is the same problem in a different disguise.

### Step 7 — Rasterize and run the visual gate

Render the pages, then dispatch the `visual-judge` agent with the page paths and the brief items.

```bash
python3 skills/pdf/scripts/convert_pdf_to_images.py main.pdf pages/   # pages/page_1.png, pages/page_2.png, …
```

`convert_pdf_to_images.py` is the executor of this gate — the piece that turns a PDF page into a PNG `visual-judge` can actually read. It renders at 200 dpi through `pdf2image` (which shells out to poppler's `pdftoppm`) and downscales each page so no side exceeds `max_dim` (default 1000 px), keeping the images small enough to hand to the judge without a separate resize step. It needs `pdf2image` importable and `pdftoppm` on `PATH`; when either is missing it fails at import or raises inside `convert_from_path` rather than emitting a page (§6.1). A bare `pdftoppm -png -r 150 main.pdf page` is an acceptable substitute when you are already in a shell that has poppler and you do not want the Python dependency — but the script is the path this skill ships and tests.

This is the only visual gate: either dispatch `visual-judge`, or (only when it is unavailable) read the images directly — do not skim the pages first and then dispatch, because that reviews the same pages twice and burns a render pass. `visual-judge` reports one JSON line per page and fixes nothing; act on what it returns, rebuild, and re-gate the pages that failed.

Resolution: 200 dpi downscaled to ≤1000 px is enough to read type and spot overflow on A4. For a poster, the default downscale keeps the composition legible; rasterize finer only when the smallest text is still unreadable to you.

### Step 8 — Iterate

Fix the source, rebuild, re-rasterize, re-gate. The loop is source → PDF → PNG → verdict → source. Never patch a typeset PDF by hand; a hand-patched PDF diverges from its source on the next build. Filling a form is the one case that edits a finished PDF, and it goes through §6 rather than through the page.

## 6. Rendering, inspection and form filling

The scripts under `skills/pdf/scripts/` are thin Python wrappers. The rendering and form-filling ones wrap `pdf2image` and `pypdf`; the HTML path (`html2pdf.py`, §6.6) shells out to LibreOffice; the quality gate (`pdf_qa.py`, §6.5) and the contents validator (`toc_validate.py`, §6.6) import nothing outside the standard library and shell out to the poppler tools instead. They are utilities, not a framework: each takes file paths on the command line, prints a short human-readable line, and exits. None of them touches the LaTeX path above, and none is required to typeset — they cover the jobs §1 names: render a page for the judge, fill a form, typeset a plain HTML page, put a cover in front of a body, and gate the artifact you built.

### 6.1 Dependencies are real, not assumed

| Dependency         | Used by                                                                                                    | Missing behaviour                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `pdf2image`        | `convert_pdf_to_images.py`                                                                                 | `import` fails — the script will not start                    |
| poppler `pdftoppm` | the raster backend `pdf2image` shells out to                                                                | `convert_from_path` raises (`PDFInfoNotInstalledError`)        |
| `pypdf`            | `check_fillable_fields.py`, `extract_form_field_info.py`, `fill_fillable_fields.py`, `fill_pdf_form_with_annotations.py`, `cover_render.py` | `import` fails — the script will not start |
| `Pillow` (`PIL`)   | `create_validation_image.py`                                                                               | `import` fails — the script will not start                    |
| poppler `pdftotext`, `pdfinfo`, `pdffonts`, `pdftoppm` | `pdf_qa.py` and its four modules (§6.5)                                              | a readable error naming the missing tool, and exit 1 — never a degraded run |
| poppler `pdftotext`, `pdfinfo` | `toc_validate.py` and its module (§6.6)                                                             | a readable error naming the missing tool, and exit 1 — never a degraded run |
| LibreOffice `soffice` | `html2pdf.py`, `html2pdf_render.py`, `cover_render.py` (§6.6)                                          | a readable error naming the tool and the install hint, and exit 1 — never a skipped render |

Detect before promising a result:

```bash
python3 -c "import pdf2image, pypdf, PIL"   # the three Python packages
which pdftoppm pdftotext pdfinfo pdffonts   # the poppler tools
```

`check_bounding_boxes.py` and `check_bounding_boxes_test.py` are the exception: they import only the standard library and run anywhere. The `pdf_qa.py` family is the second exception in the other direction — it too imports only the standard library, but it *requires* the four poppler binaries on `PATH`, because they are the only source of page geometry, word boxes, fonts and ink; `toc_validate.py` needs two of the same four. The HTML family is the third: it imports only the standard library but *requires* `soffice` on `PATH`, because LibreOffice's HTML import is the renderer. Do not describe any of the others as unconditionally available — a missing dependency is an `ImportError` at start (or, for poppler and LibreOffice, a raised exception on first use), not a degraded run.

### 6.2 Render a page to PNG — `convert_pdf_to_images.py`

```bash
python3 skills/pdf/scripts/convert_pdf_to_images.py <input.pdf> <output_dir>
```

Writes one `page_N.png` per page into `<output_dir>` (1-indexed), rendering at 200 dpi and downscaling so no side exceeds `max_dim` (default 1000). This is the renderer both the §5 visual gate and the form workflow call; hand its output straight to `visual-judge` or read it to locate form fields. Needs `pdf2image` + poppler `pdftoppm` (§6.1).

### 6.3 Fill a PDF form

These scripts serve **form filling**, not typesetting; they never touch the LaTeX pipeline. First decide which of two paths applies — a PDF either exposes AcroForm fields, or it does not:

```bash
python3 skills/pdf/scripts/check_fillable_fields.py <input.pdf>
```

It prints one of two lines: the PDF **has** fillable form fields, or it **does not** and you must locate the entry areas by eye. Both paths need `pypdf`.

**Fillable path** — the PDF reports fields:

1. Extract the fields to JSON. Each entry carries `field_id`, `page`, `rect`, and per-type extras — `checked_value`/`unchecked_value` for a checkbox, `radio_options` for a radio group, `choice_options` for a choice list:

   ```bash
   python3 skills/pdf/scripts/extract_form_field_info.py <input.pdf> <field_info.json>
   ```

2. Render the pages (`convert_pdf_to_images.py`) and, reading them beside the extracted rects, write a `field_values.json` — one object per field you fill, each with the `field_id`, its `page`, and the `value` to set. A checkbox or radio uses its `checked_value` / a `radio_options` value.

3. Fill, letting the script validate:

   ```bash
   python3 skills/pdf/scripts/fill_fillable_fields.py <input.pdf> <field_values.json> <output.pdf>
   ```

   It checks every `field_id` against the real fields and every value against the field's type **before** writing; a bad id, a wrong page, or an out-of-range checkbox / radio / choice value prints an `ERROR:` line and exits 1 without writing anything. On success it writes the filled PDF and sets `NeedAppearances` so viewers render the values. Read the value back to confirm the fill landed.

**Non-fillable path** — no AcroForm fields, so you supply the geometry as a `fields.json` (`pages[]` with each page's `image_width`/`image_height`, and `form_fields[]` with a `label_bounding_box`, an `entry_bounding_box`, and the `entry_text` to stamp):

1. Render the pages and, looking at each PNG, mark the label box and the entry box for every field. The two boxes must not overlap, and an entry box must be tall enough for its text.
2. Check the geometry (§6.4) and draw a preview (§6.4) until the red entry boxes cover only input areas.
3. Stamp the text as annotations:

   ```bash
   python3 skills/pdf/scripts/fill_pdf_form_with_annotations.py <input.pdf> <fields.json> <output.pdf>
   ```

   It transforms each `entry_bounding_box` from image coordinates to PDF coordinates against the page's real size and writes a `FreeText` annotation carrying `entry_text`; empty text is skipped. The text is an overlay, not a form field, and its font size and colour are best-effort across viewers.

### 6.4 Inspect the geometry — `check_bounding_boxes.py` and `create_validation_image.py`

```bash
python3 skills/pdf/scripts/check_bounding_boxes.py <fields.json>
```

Reads a `fields.json` and prints `SUCCESS: All bounding boxes are valid`, or one `FAILURE:` line per problem — a label/entry intersection, an intersection between two fields on the same page, or an entry box shorter than its font size — stopping after roughly twenty messages so the output stays readable. Standard-library only. Its unit test, `check_bounding_boxes_test.py`, runs under `unittest` (`python3 check_bounding_boxes_test.py`) and needs no extra dependencies; run it after any change to the checker.

```bash
python3 skills/pdf/scripts/create_validation_image.py <page_number> <fields.json> <input.png> <output.png>
```

Draws red rectangles over entry boxes and blue over label boxes onto a rendered page PNG, so you can confirm the geometry by eye before stamping text. Needs `Pillow`.

### 6.5 Gate the artifact — `pdf_qa.py`

```bash
python3 skills/pdf/scripts/pdf_qa.py <file.pdf> [more.pdf ...] [--json] [--poster] [--skip-cover] [--no-tables] [--formulas]
```

This is the quality gate for a PDF you produced. It does not validate the file against the specification — a PDF can be perfectly legal and still print wrong — it inspects the artifact the way a reader would: page by page, on rendered ink and on extracted word positions. Run it after the build (§5 Step 6) and before or beside the visual gate; it is deterministic, and it catches the defects a compile log never mentions.

Positional arguments are glob patterns, so a whole build directory can be gated in one call. With more than one file each gets its own report, separated by a blank line.

The switches:

| Switch          | Effect                                                                 |
| --------------- | ---------------------------------------------------------------------- |
| `--poster`      | poster mode: also checks that the cover background bleeds to the edge  |
| `--skip-cover`  | skips the first page when judging left/right margin symmetry           |
| `--no-tables`   | does not judge table centering                                          |
| `--formulas`    | also checks display formulas against the text column                   |
| `--json`        | machine-readable output: `{"files":[…], "errors":n, "warnings":n}`     |

The fifteen checks, in the order they run:

| # | Check                   | Reports                                                              |
| - | ----------------------- | -------------------------------------------------------------------- |
| 1 | `last_page_fill`        | a last page that is nearly empty (single-page documents are skipped)  |
| 2 | `punctuation`           | halfwidth punctuation beside Chinese, fullwidth beside Latin, doubled marks |
| 3 | `blank_pages`           | a page with neither extractable text nor ink                          |
| 4 | `colors`                | more than eight distinct painted colours, or a near-white one that will not print |
| 5 | `page_size_consistency` | pages on different stock (single-page documents are skipped)          |
| 6 | `text_overflow`         | a word whose box leaves the page                                      |
| 7 | `content_fill_ratio`    | a middle page under 40% filled, or a last page under 25%              |
| 8 | `cover_bleed`           | cover ink stopping more than 5% short of an edge (`--poster` only)    |
| 9 | `margin_symmetry`       | left and right margins differing by more than 24 pt                   |
| 10 | `table_centering`       | a table hanging more than 12 pt off the page centre (`--no-tables` off) |
| 11 | `font_embedding`        | a font that is not embedded                                          |
| 12 | `helvetica_in_cjk`      | Chinese text set in a base-14 Latin font, which has no CJK glyphs     |
| 13 | `metadata`              | no title, or no author                                                |
| 14 | `toc_without_cover`     | a table of contents with no cover before it (single-page skipped)     |
| 15 | `formula_overflow`      | a formula line reaching past the text column (`--formulas` only)      |

Every conclusion carries a severity. `ERROR` is a defect the reader sees; `WARN` is a judgement call the author makes; `OK` is a pass. Only `ERROR` fails the gate:

| Exit | Meaning                                                              |
| ---- | -------------------------------------------------------------------- |
| 0    | every check passed, or reported at most a warning                    |
| 1    | usage error, a file that is not a readable PDF, or a missing poppler tool |
| 2    | at least one check reported an `ERROR`                               |

A missing poppler tool is an explicit error naming the tool, never a skipped check — a gate that silently passes because `pdftotext` is absent is worse than no gate. Thresholds (fill ratios, bleed, tolerances) are named constants at the top of `pdf_qa_checks.py`, so they can be retuned in one place.

The gate is five files, all standard library plus poppler, with no `pypdf` or `pdfplumber`:

| File                  | Role                                                              |
| --------------------- | ----------------------------------------------------------------- |
| `pdf_qa.py`           | CLI, glob expansion, report layout, exit status                   |
| `pdf_qa_document.py`  | read-only facts: one poppler call per tool, page geometry, word boxes, ink maps, fonts, metadata |
| `pdf_qa_text.py`      | shared measurements: lines, table columns, script and math classification |
| `pdf_qa_checks.py`    | the fifteen rules, their thresholds and the registry              |
| `pdf_qa_colors.py`    | the colour scan, read straight out of the content streams         |

Run them by path from the repository root, as above; they import each other by flat module name, so `python3 skills/pdf/scripts/pdf_qa.py …` works and `import pdf_qa` from elsewhere does not.

### 6.6 Typeset from HTML, put a cover in front, validate the contents

Three entry points cover the part of a document that is not LaTeX: a plain HTML page, a cover that is a special page rather than the body's first page, and the printed table of contents a reader navigates by. They are complementary to the rest of §6 — `convert_pdf_to_images.py` goes PDF → PNG, `html2pdf.py` goes HTML → PDF — and none of them replaces the LaTeX path for a document that should be typeset from source.

#### `html2pdf.py` — HTML to PDF, with the html2pdf.js option model

```bash
python3 skills/pdf/scripts/html2pdf.py <file.html> [more.html ...] [--outdir DIR] [--margin SPEC]
    [--filename NAME] [--image-type jpeg|png|webp] [--image-quality 0..1]
    [--pagebreak-mode css|legacy|avoid-all[,...]] [--pagebreak-before SEL]
    [--pagebreak-after SEL] [--pagebreak-avoid SEL] [--format a4|letter|...]
    [--orientation portrait|landscape] [--js-pdf KEY=VALUE]
    [--html2canvas KEY=VALUE] [--json] [--keep-html]
```

The option model is derived from `html2pdf.js` (MIT, eKoopmans/html2pdf.js) — `margin`, `filename`, `image.type`/`image.quality`, the `pagebreak` modes and the two passthrough objects — so a document authored against that interface renders here without rewriting its options. No upstream code is vendored: the browser library rasterises a DOM through `html2canvas` into `jsPDF`, both of which need a DOM and therefore do not run under Node, while this script delegates to the local LibreOffice HTML import and typesets real vector text (searchable, selectable, small). Positional arguments are glob patterns; the PDF is written next to its input unless `--outdir` says otherwise, and `--filename` renames it (single input only — two inputs mapping to one name is an error, reported before anything is rendered).

| Option | Effect here |
| ------ | ----------- |
| `--margin` | a number, `v,h`, `t,l,b,r`, or a JSON object; unitless numbers are points, a unit suffix (`2cm`) or jsPDF's `unit` overrides. Injected as the `@page` margin, honoured on the left, right and bottom; the top sits one line-height lower because the first paragraph keeps its own leading |
| `--filename` | name of the produced PDF; defaults to the input's stem |
| `--format` / `--orientation` | page stock, from jsPDF's format names (`a3`, `a4`, `a5`, `b5`, `letter`, `legal`, `tabloid`) |
| `--pagebreak-mode` | `css` (default) respects the document's own break rules; `legacy` breaks after elements carrying the class `html2pdf__page-break`; `avoid-all` asks the renderer to keep block elements whole |
| `--pagebreak-before/after/avoid` | the same, for a selector you name — class (`.x`), id (`#x`) or element (`h1`) |
| `--image-type` / `--image-quality` | accepted and echoed; they describe upstream's raster stage, and there is no raster stage here, so they change nothing |
| `--js-pdf KEY=VALUE` | `unit`, `format` and `orientation` set the page geometry; any other key is echoed only |
| `--html2canvas KEY=VALUE` | accepted and echoed; there is no canvas stage to configure |
| `--keep-html` | keep the prepared HTML (the source plus the injected `@page` and break rules) beside the output |

Measured boundaries of the renderer, all of them LibreOffice facts rather than assumptions — check them before promising a layout:

- **The Writer HTML import filter is used explicitly.** The default filter drops the body's first block element and prepends a blank page; the script passes `--infilter="HTML (StarWriter)"` to avoid it.
- **Page breaks work on real block elements and not on `div`.** `page-break-after` on a `<p>`, `<h1>`-`<h6>` or `<table>` paginates; on a `<div>` (empty or not) it is ignored. Put the break class on the last block element of the page, or use `--pagebreak-before` on the first element of the next one.
- **Class selectors containing underscores are dropped by the import** (`.a_b` does nothing, `.a-b` works) — which is why class and id selectors are written onto the matching elements as inline styles instead of into the stylesheet, and why `html2pdf__page-break` still works in `legacy` mode.
- **`page-break-inside` is ignored**, so `avoid-all` and `--pagebreak-avoid` are accepted with no observable effect.
- **Only explicit page dimensions are honoured**: `size: 215.9mm 279.4mm` sets letter, while `size: letter` and `size: A3` are ignored (A4 and A4 landscape are the exceptions). The script emits explicit dimensions for every format name.
- **The document's own `body { margin }` adds to the injected `@page` margin** rather than replacing it; control margins through the option, not through the body rule.

Failure semantics: a missing `soffice` is an error naming the tool and the install hint, a non-zero converter exit is reported with its last stderr line, and both exit 1 — a render is never silently skipped. `--json` reports one record per input with the resolved options, the output path, or the error.

The family is three files, all standard library plus `soffice`:

| File | Role |
| ---- | ---- |
| `html2pdf.py` | CLI, option parsing and validation, glob expansion, report layout, exit status |
| `html2pdf_render.py` | the render itself: option model, `@page` and break CSS, the prepared HTML, the LibreOffice call |
| `cover_render.py` | the cover merge (imports `html2pdf_render`, plus `pypdf`) |

Run them by path from the repository root; they import each other by flat module name, so `python3 skills/pdf/scripts/html2pdf.py …` works and `import html2pdf` from elsewhere does not.

#### `cover_render.py` — the cover as page 1

```bash
python3 skills/pdf/scripts/cover_render.py --cover cover.html --body body.pdf -o final.pdf
    [--cover-margin SPEC] [--cover-format a4|letter|...] [--cover-orientation portrait|landscape]
    [--margin SPEC] [--format ...] [--orientation ...] [--json] [--keep-html]
```

A cover is a special page: no header or footer, different margins, sometimes another stock or landscape. The reliable way to honour that is to render it as its own one-page document and concatenate it in front of the body, which is what this does — so the cover and the body may disagree about size, orientation and margins, and the body's geometry is left untouched. `--body` takes a PDF (used as it is) or an HTML file (rendered here through the same LibreOffice path); `--margin`, `--format` and `--orientation` describe the body and apply only when the body is HTML, while the `--cover-*` trio describes the cover.

- The cover must fit **one page**. A cover that overflows is a defect, not a two-page cover, so the script refuses to write anything and says so.
- Merging is page concatenation through `pypdf` — no `qpdf` is involved or needed. Internal links and a PDF body's outline ride along as far as `pypdf` carries them.
- The report prints page 1's size and the first line of its extracted text, so "the cover is page 1" is verifiable without opening a viewer; `--json` carries the same fields.

#### `toc_validate.py` — the printed contents, checked against the document

```bash
python3 skills/pdf/scripts/toc_validate.py <file.pdf> [more.pdf ...] [--json] [--skip-page-check]
```

`pdf_qa.py` (§6.5) is the gate on the whole artifact; this script judges only the table of contents itself. It reads the *printed* contents — the text on the page carrying a contents heading in the first few pages — and compares it with the document behind it. PDF outline bookmarks are not consulted: viewers synthesise them, and they can disagree with the page.

The six checks, with the same severities and exit status as `pdf_qa.py` (`ERROR` fails the gate, `WARN` is the author's call; exit 0 / 1 / 2):

| Check | Reports |
| ----- | ------- |
| `toc_present` | no contents heading in the first pages — a warning, because a letter legitimately has none |
| `entries_resolve` | an entry whose section does not exist as a heading in the body |
| `headings_covered` | a heading in the body that the contents does not list |
| `page_placeholder` | a page number left at a placeholder (`00`, `x`, empty) |
| `page_agreement` | an entry pointing at the wrong page |
| `level_sequence` | a hierarchy that skips a level |

- Page agreement is judged against an offset derived from the entries themselves, so front matter in roman numerals and a body restarting at 1 both work; `--skip-page-check` turns the check off entirely.
- Levels come from the numbering prefix (`1.2.` → 3, `第三章` → 1) when the contents carry no indentation, and from the entries' own indents when they do — calibrated per document.
- Heading detection is a height heuristic: a line whose glyphs are about 15% taller than the lines around it, only a few words long, and reading as prose rather than as a display formula. It is conservative on purpose — a missed heading is reported as an unresolved entry, and a false heading is not invented.
- Matching is whitespace- and case-insensitive and tolerates a numbering difference between the contents and the heading (`1 Introduction` vs `Introduction`).

The family is two files, standard library plus `pdftotext` / `pdfinfo`:

| File | Role |
| ---- | ---- |
| `toc_validate.py` | CLI, the six checks, report layout, exit status |
| `toc_validate_document.py` | read-only facts: contents pages, entries, body pages, heading lines |

Run them by path from the repository root, as above; they import each other by flat module name, so `python3 skills/pdf/scripts/toc_validate.py …` works and `import toc_validate` from elsewhere does not.

## 7. Defects and self-check

These are the ones a reader notices and a clean compile log walks past. Read the log for them; do not wait for the visual gate.

| Symptom in the output                                                    | Likely cause                                                                             | Fix                                                                                                         |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| text runs into the right margin, or a black box marks an over-wide line  | overfull `hbox`: an unbreakable box wider than `\linewidth`                              | break the URL or long word, wrap the table in `tabularx` / `\resizebox`, or add `\sloppy` to that paragraph |
| a blank page near the end                                                | a `\clearpage` / `\cleardoublepage` after the last float, or a float that no longer fits | drop the forced clear, or move the float earlier                                                            |
| all figures and tables collected at the end                              | every float deferred past the text that references it                                    | `[htbp]` plus `\FloatBarrier` per section; reduce the float's height                                        |
| a caption sits alone on the next page                                    | the float split, or `\captionsetup` spacing pushed it over                               | keep the float on one page, or typeset the figure as a non-floating `minipage`                              |
| a section heading is the last line of a page                             | no widow control on headings                                                             | `titlesec` page-break options, `needspace`, or a manual break                                               |
| table of contents shows placeholder page numbers                         | not enough engine passes                                                                 | rerun `latexmk`; it loops until the `.toc` is stable                                                        |
| citations print `[?]`                                                    | `biber` / `bibtex` never ran, or ran before the citation existed                         | rerun `latexmk`; check the `.bib` path and that `\addbibresource` names it                                  |
| tofu boxes or a missing-glyph error                                      | the font lacks the codepoint, or CJK is being compiled with `pdflatex`                   | switch to `xelatex` / `lualatex` and use `fontspec` / `ctex`                                                |
| a font the build machine has renders as a substitute elsewhere           | the font was never embedded                                                              | check `pdffonts`; use `lmodern` or an installed OTF/TTF with `fontspec`                                     |
| columns of different heights on a two-column page                        | the last column is short, or `multicol` balanced the page badly                          | acceptable on a final page; otherwise move content or rebalance                                             |
| a URL or filename overhangs the margin                                   | an unbreakable token                                                                     | `xurl`, `\seqsplit`, or a manual break                                                                      |
| page numbers missing on the cover but the body restarts at 1 by accident | front matter and body share one numbering sequence                                       | separate the front matter with roman numerals and restart the body with `\pagenumbering{arabic}`            |

Two log lines worth reading every time:

- `Overfull \hbox (...pt too wide)` — real, visible, and almost always a reader-visible defect. A few points of overhang on a URL is tolerable; a line that runs off the paper is not.
- `Underfull \hbox` — loose, gappy justification. Usually a long unbreakable token in a narrow column; `microtype` and `\emergencystretch` fix most of it.

The mechanical half of this table is automated: `pdf_qa.py` (§6.5) reports blank pages, mixed page sizes, an unembedded font, a nearly empty last page, text off the paper and a formula past the column, and `toc_validate.py` (§6.6) reports a contents entry whose section no longer exists, a placeholder page number and a hierarchy that skips a level. Run them instead of re-reading the log by eye, then come back here for the causes they cannot see — a float deferred, a caption orphaned, a heading left alone at the foot of a page.

## 8. Pitfalls

- **`hyperref` late, `cleveref` after it.** Load order is not cosmetic.
- **Never `\label` before `\caption`.** The label resolves to the section counter instead of the figure counter.
- **`latexmk` needs the `-pdf` / `-xelatex` / `-lualatex` flag** to know which engine to drive. Without it, `latexmk` defaults to `pdflatex` even when the preamble requires a Unicode engine.
- **`\input` / `\include` paths are relative to the working directory**, not to the including file, unless `TEXINPUTS` is set. A multi-file document that builds in one directory and fails in another is usually this.
- **`\include` forces a `\clearpage`.** Use `\input` for fragments that must not start a new page.
- **A missing package is a distribution problem, not a source problem.** `tlmgr install` (TeX Live) or the MiKTeX console fixes it; editing the source to avoid a package hides the real gap and usually breaks portability.
- **Bitmapped fonts do not scale.** A `Type 3` font in `pdffonts` output means a bitmap font was used; it prints badly and zooms badly.
- **`\resizebox` scales the type inside a table too.** A table shrunk to fit also shrinks its font below the body size, which is a defect the reader sees. Prefer `tabularx`, `longtable` or a smaller table.
- **The PDF is a build artifact.** Regenerate it; never edit it.
- **The `scripts/` tools are not unconditional.** `pdf2image`, `pypdf` and `Pillow` each fail at import when absent, and `convert_pdf_to_images.py` also needs poppler's `pdftoppm` on `PATH`. Detect the dependencies (§6.1) before promising a render, a fill or a validation image.
- **`pdf_qa.py` needs four poppler binaries, not Python packages.** It imports only the standard library, so a missing `pdftotext` / `pdfinfo` / `pdffonts` / `pdftoppm` shows up as a run-time error naming the tool and exit 1 — not as an `ImportError` at start, and never as a silently passing gate. It also renders every page at 40 dpi to judge ink, so on a very large document that render is the slow part.
- **`html2pdf.py` and `cover_render.py` need `soffice`, and its HTML import has edges.** A missing converter is a named error and exit 1, never a skipped render. When it is present, remember what the import does and does not honour: breaks on real block elements but not on `div`, `page-break-inside` ignored, class names with underscores dropped (the script writes class and id break rules inline for exactly that reason), named page sizes other than A4 ignored, and the document's own `body` margin added to the injected `@page` margin (§6.6). A cover that renders to two pages is refused rather than merged.
- **`fill_pdf_form_with_annotations.py` overlays text; it does not create a field.** The stamped text is a `FreeText` annotation a viewer shows but a recipient cannot edit as a form value. A PDF whose filled values must stay editable needs real AcroForm fields, which the non-fillable path does not add.
