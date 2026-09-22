---
name: pdf
description: Use whenever a PDF is the artifact being produced — a report, resume or CV, poster, academic paper, thesis, letter, invoice, handout or slide notes — in other words whenever the deliverable is a typeset PDF rather than an editable Office file or a web page. Covers routing the document to a typesetting brief, choosing a LaTeX document class and engine, driving a latexmk build with xelatex / lualatex / pdflatex, resolving bibliography passes with biber or bibtex, and rasterizing pages to PNG for the visual-judge gate. Also use it to finish an existing PDF — fill its AcroForm fields or stamp text annotations onto a flat page — and to render a PDF's pages to PNG. Use it when the user asks to write, generate, typeset, lay out or format a PDF, asks why a generated PDF looks wrong, or reports symptoms such as a blank page, a table broken across pages, tofu boxes or missing glyphs, fonts that exist only on the build machine, a bibliography printed as question marks, a table of contents with placeholder page numbers, text running into the margin, a resume spilling onto a second page, a poster whose body text is unreadable at arm's length, or asks to fill out or complete a PDF form.
---

# PDF Production

Typeset a PDF from LaTeX source. This skill routes the document to a brief, drives the build, and gates the result on rendered page images rather than on the compile log.

## 1. What this skill covers

Two jobs, one artifact. The first is **producing** a PDF whose content is _typeset_: the source is LaTeX, the output is a `.pdf`, and the layout is decided by a document class plus a preamble rather than by dragging boxes. The second is **finishing an existing PDF**: filling its form — whether it exposes AcroForm fields or is only a flat page you annotate — and rendering its pages to PNG so the `visual-judge` gate can look at them (§6).

It does **not**:

- convert between formats — no `.docx` → PDF exporter, no PDF → text extraction pipeline, no HTML or poster renderer;
- redact or do page surgery — no script here removes content, splits or merges pages, or strips annotations; form filling adds fields and annotations, it does not rewrite page content;
- ship a design engine, a template library or a LaTeX renderer of its own. The typesetting path runs on a TeX distribution plus the poppler / mupdf / ghostscript utilities that already sit beside it; the scripts under `skills/pdf/scripts/` are thin Python wrappers over `pdf2image` and `pypdf`, and `pdf2image` in turn shells out to poppler.

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

The scripts under `skills/pdf/scripts/` are thin, MIT-derived Python wrappers over `pdf2image` and `pypdf`. They are utilities, not a framework: each takes file paths on the command line, prints a short human-readable line, and exits. None of them touches the LaTeX path above, and none is required to typeset — they cover the two jobs §1 names: render a page for the judge, and fill a form.

### 6.1 Dependencies are real, not assumed

| Dependency         | Used by                                                                                                    | Missing behaviour                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `pdf2image`        | `convert_pdf_to_images.py`                                                                                 | `import` fails — the script will not start                    |
| poppler `pdftoppm` | the raster backend `pdf2image` shells out to                                                                | `convert_from_path` raises (`PDFInfoNotInstalledError`)        |
| `pypdf`            | `check_fillable_fields.py`, `extract_form_field_info.py`, `fill_fillable_fields.py`, `fill_pdf_form_with_annotations.py` | `import` fails — the script will not start |
| `Pillow` (`PIL`)   | `create_validation_image.py`                                                                               | `import` fails — the script will not start                    |

Detect before promising a result:

```bash
python3 -c "import pdf2image, pypdf, PIL"   # the three Python packages
which pdftoppm                              # the raster backend pdf2image calls
```

`check_bounding_boxes.py` and `check_bounding_boxes_test.py` are the exception: they import only the standard library and run anywhere. Do not describe any of the others as unconditionally available — a missing dependency is an `ImportError` at start (or, for poppler, a raised exception on first render), not a degraded run.

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
- **`fill_pdf_form_with_annotations.py` overlays text; it does not create a field.** The stamped text is a `FreeText` annotation a viewer shows but a recipient cannot edit as a form value. A PDF whose filled values must stay editable needs real AcroForm fields, which the non-fillable path does not add.
