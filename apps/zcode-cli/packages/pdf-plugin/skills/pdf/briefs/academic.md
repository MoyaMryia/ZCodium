# Brief — Academic papers

Applies to journal submissions, conference papers, theses and technical reports
where a venue supplies a class or template. The venue's rules win over everything
in this file; what follows is what to do with the parts the venue leaves open.

Structure and conventions follow the pattern of the widely-used minimalist
academic templates (`pmichaillat/latex-paper`, MIT;
`monetjoe/latex_paper_templates`, MIT) and public LaTeX documentation; see the
plugin `NOTICE.md`.

## The six-phase workflow

Academic documents fail differently from creative ones: the failures are
missing passes, broken references and venue violations, not ugly pages. Work in
phases, and do not skip ahead.

### Phase 1 — BRIEF (before writing)

Write down, in one paragraph each:

- **venue and class**: the exact `\documentclass` or template the venue
  requires, and its version. A class swapped mid-project invalidates every
  later choice.
- **page limit and format**: two-column vs one-column, page or word count,
  font size the class forces. The limit is a constraint on what you write, not
  a target to approach at the end.
- **anonymity**: whether the submission is double-blind. If it is, every
  self-identifying reference is removed in Phase 4, not after submission.
- **figure budget**: how many figures and tables the limit allows, and which
  claims they must carry.
- **bibliography style**: the venue's `.bst` or `biblatex` style, matched
  exactly from the first build.

### Phase 2 — SETUP (the skeleton)

```
main.tex          the document; \input the sections, never one 2000-line file
sections/         intro.tex method.tex results.tex discussion.tex
refs.bib          the bibliography database
figures/          one file per figure, vector by default
```

- Load the preamble in dependency order: class → font/engine → math →
  graphics/tables → bibliography → hyperref last. `hyperref` before
  `cleveref`-style packages produces the classic "reference printed as ??".
- `amsmath` for the math environments, `booktabs` for tables, `graphicx` for
  figures, `microtype` for justification. Nothing exotic unless the venue
  requires it.
- Set the geometry the class leaves open (margins, binding offset) once, and
  size every figure against `\textwidth` — never a hard-coded `cm`.
- Numbered equations referenced by `\eqref`; floats referenced by
  `\autoref`/`\cref`, never by hand-written numbers.

### Phase 3 — BUILD (write the document)

Write in this order, not in reading order:

1. **The figures and tables first.** They carry the evidence; the prose
   argues about them. A paper written before its figures exist is rewritten
   after they do.
2. **Method**, reproducible in principle: enough detail that a competent
   reader could redo it, with parameter choices stated rather than implied.
3. **Results**, reporting what happened without arguing.
4. **Introduction last** — it narrows from field to gap to contribution, and
   you cannot know the contribution before the results exist.
5. **Abstract last of all**: problem, what was done, headline result, why it
   matters. No citations, no undefined abbreviations.
6. **Discussion and conclusion**: what is now known that was not, what
   remains open. Not a paragraph-by-paragraph summary.

### Phase 4 — COMPILE (the full pass sequence)

    latexmk -pdf main.tex          # or: xelatex → biber → xelatex → xelatex

The bibliography needs the full sequence; a reference list printed as question
marks is almost always a missing pass, not missing data. Build until the log is
clean of `undefined reference` and `citation ... undefined`.

**Anonymised build check** (double-blind venues): compile the version you will
actually submit and grep the PDF for author names, affiliations, self-citations
phrased as "our previous work [12]", and acknowledgements. Check the PDF
metadata too — `\hypersetup{pdftitle=...,pdfauthor=...}` leaks what the body
hides.

### Phase 5 — PREFLIGHT

- Read the PDF, not the log: float placement, orphaned headings, tables split
  without headers, figures past the margin.
- Every claim that is not yours has a citation; every citation appears in the
  reference list and vice versa.
- Units stated with every quantity; notation consistent across sections; every
  symbol defined at first use.
- Page limit checked after the final content change, not before.

### Phase 6 — DELIVER

- Camera-ready adds the author block, acknowledgements and funding statements —
  then re-check the page limit.
- The source tree ships with the submission when the venue asks for it: the
  `.tex`, the `.bib`, the figures, and nothing that is not needed to build.
- Archive the exact PDF you submitted; the revision that comes back from review
  is a diff against that file.

## Scenario A — math-heavy documents

- Number every display equation and reference it; an unnumbered display cannot
  be pointed at.
- `align` for multi-line derivations, `split` inside `equation` when the whole
  block is one statement. Never fake alignment with spaces.
- Theorems and proofs as environments (`amsthm`), numbered per section, with
  the theorem's dependencies stated in its proof.
- Matrices, cases and piecewise definitions from `amsmath`'s own environments;
  hand-built arrays drift out of alignment at the first edit.
- A notation table early in the document for anything with more than a dozen
  symbols — the reviewer's complaint "notation is inconsistent" is usually
  "there is no notation table".

## Scenario B — diagrams

Two paths, chosen per figure:

- **TikZ native** — the diagram is geometric: axes, plots, automata, trees,
  anything with coordinates. Vector, inherits the document's fonts, survives
  being scaled to `\textwidth`. The drawing catalogs in
  `awesome-latex-drawing` (MIT) are the fact source for the shapes.
- **Playwright/CSS → PNG** — the diagram is layout-driven: org charts, flow
  diagrams with text boxes, anything easier to lay out in HTML/CSS than to
  position by hand. Screenshot at 2× device scale so the PNG holds 300 dpi at
  placed size.

**Decomposition rule**: a complex diagram is several figures, not one crowded
one. Split by phase (before/after), by actor, or by layer — and let the caption
carry the relationship between the parts.

## Scenario C — algorithm pseudocode

- `algorithm` + `algorithmic` (or `algorithm2e`) as floats, referenced like
  figures, with input and output stated in the caption.
- Line numbers on; the text refers to lines ("at line 7 the loop exits").
- One statement per line, consistent indentation, no clever formatting — the
  pseudocode is read by people who will re-implement it.
- The pseudocode matches the prose: if the paper says "greedy" the pseudocode
  must not contain a backtrack.
