---
name: pdf
description: Use whenever a PDF is the artifact being produced — a report, resume or CV, poster, academic paper, thesis, letter, invoice, handout or slide notes — in other words whenever the deliverable is a typeset PDF rather than an editable Office file or a web page. Covers routing the document to a typesetting brief, choosing a LaTeX document class and engine, driving a latexmk build with xelatex / lualatex / pdflatex, resolving bibliography passes with biber or bibtex, and rasterizing pages to PNG for the visual-judge gate. Use it when the user asks to write, generate, typeset, lay out or format a PDF, asks why a generated PDF looks wrong, or reports symptoms such as a blank page, a table broken across pages, tofu boxes or missing glyphs, fonts that exist only on the build machine, a bibliography printed as question marks, a table of contents with placeholder page numbers, text running into the margin, a resume spilling onto a second page, or a poster whose body text is unreadable at arm's length.
---

# PDF Production

Typeset a PDF from LaTeX source. This skill routes the document to a brief, drives the build, and gates the result on rendered page images rather than on the compile log.

## 1. What this skill covers

Producing a PDF whose content is _typeset_: the source is LaTeX, the output is a `.pdf`, and the layout is decided by a document class plus a preamble rather than by dragging boxes.

It does **not**:

- edit an existing PDF's page content — no form filling, annotation, redaction or page surgery, and no script ships here for any of it;
- convert between formats — no `.docx` → PDF exporter, no PDF → text extraction pipeline;
- ship a design engine, a template library or a renderer of its own. Everything below runs on a TeX distribution plus the poppler / mupdf / ghostscript utilities that already sit beside it.

Keep the `.tex` source next to the output. The build is reproducible, the reader will ask for changes, and a PDF whose source has been thrown away cannot be revised.

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

```bash
pdftoppm -png -r 150 main.pdf page        # page-1.png, page-2.png, …
```

Then dispatch the `visual-judge` agent with the page paths and the brief items. This is the only visual gate: either dispatch `visual-judge`, or (only when it is unavailable) read the images directly — do not skim the pages first and then dispatch, because that reviews the same pages twice and burns a render pass. `visual-judge` reports one JSON line per page and fixes nothing; act on what it returns, rebuild, and re-gate the pages that failed.

Resolution: 150 dpi is enough to read type and spot overflow on A4. For a poster, rasterize at a lower dpi (the point is the composition) but never below the resolution at which the smallest text is legible to you.

### Step 8 — Iterate

Fix the source, rebuild, re-rasterize, re-gate. The loop is source → PDF → PNG → verdict → source. Never patch the PDF; there is no tool here that edits one, and a hand-patched PDF diverges from its source on the next build.

## 6. Defects and self-check

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

## 7. Pitfalls

- **`hyperref` late, `cleveref` after it.** Load order is not cosmetic.
- **Never `\label` before `\caption`.** The label resolves to the section counter instead of the figure counter.
- **`latexmk` needs the `-pdf` / `-xelatex` / `-lualatex` flag** to know which engine to drive. Without it, `latexmk` defaults to `pdflatex` even when the preamble requires a Unicode engine.
- **`\input` / `\include` paths are relative to the working directory**, not to the including file, unless `TEXINPUTS` is set. A multi-file document that builds in one directory and fails in another is usually this.
- **`\include` forces a `\clearpage`.** Use `\input` for fragments that must not start a new page.
- **A missing package is a distribution problem, not a source problem.** `tlmgr install` (TeX Live) or the MiKTeX console fixes it; editing the source to avoid a package hides the real gap and usually breaks portability.
- **Bitmapped fonts do not scale.** A `Type 3` font in `pdffonts` output means a bitmap font was used; it prints badly and zooms badly.
- **`\resizebox` scales the type inside a table too.** A table shrunk to fit also shrinks its font below the body size, which is a defect the reader sees. Prefer `tabularx`, `longtable` or a smaller table.
- **The PDF is a build artifact.** Regenerate it; never edit it.
