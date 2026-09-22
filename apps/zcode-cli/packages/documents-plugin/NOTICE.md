# Third-party notices

## scripts/document.py, scripts/utilities.py, scripts/templates/*.xml

These files derive from the Anthropic `document-skills` lineage. The reference
implementation used for the clean-room rewrite is:

    appautomaton/document-SKILLs
    https://github.com/appautomaton/document-SKILLs
    Copyright (c) 2026 appautomaton
    MIT License

`document.py` and `utilities.py` are rewrites, not copies; the deltas from that
reference are enumerated in the module docstring of `document.py`. The five
`templates/*.xml` parts are byte-identical to the reference's and are covered by
the MIT notice above.

## Everything else in this plugin

`postcheck.py`, `postcheck_document.py`, `postcheck_rules.py`,
`fix_footer_fields.py`, `add_toc_placeholders.py` and the `SKILL.md`,
`references/` and `routes/` documents are original work written for this
repository. They are covered by the repository's root Apache-2.0 license.

Six documents under `skills/docx/scenes/` and `skills/docx/references/` are
**knowledge-derived** from MIT-licensed LaTeX repositories. No upstream file is
copied, vendored or distributed with this plugin; each document was written from
the upstream repository's structure and typographic conventions, restated in this
repository's own words and in `.docx` / OOXML terms. The upstream copyright and
permission notices are reproduced below as the MIT License requires.

| this repository's file | upstream repository | licence file |
| --- | --- | --- |
| `skills/docx/scenes/resume.md` | `billryan/resume` — https://github.com/billryan/resume | `LICENSE` at the repository root (upstream leaves the copyright-holder line blank) |
| `skills/docx/scenes/academic.md` | `pmichaillat/latex-paper` — https://github.com/pmichaillat/latex-paper, Copyright (c) 2022–present Pascal Michaillat | `LICENSE.md` at the repository root |
| `skills/docx/scenes/report.md` | `NemoYuan2008/SJTU-Thesis-Proposal` — https://github.com/NemoYuan2008/SJTU-Thesis-Proposal, Copyright (c) 2023 Boshi Yuan | `LICENSE` at the repository root |
| `skills/docx/scenes/exam.md` | `Purestone/chitshit` — https://github.com/Purestone/chitshit, Copyright (c) 2025 Puyan | `LICENSE` at the repository root |
| `skills/docx/references/chart-templates.md` | `xinychen/awesome-latex-drawing` — https://github.com/xinychen/awesome-latex-drawing, Copyright (c) 2019 Xinyu Chen | `LICENSE` at the repository root |
| `skills/docx/references/decorations.md` | `xinychen/awesome-latex-drawing` — https://github.com/xinychen/awesome-latex-drawing, Copyright (c) 2019 Xinyu Chen | `LICENSE` at the repository root |

Each of the six files carries the same attribution, with the upstream URL and the
path to its licence file, in a `## Source` section at the end of the document, so a
copy of any one of them on its own still carries the notice.

The MIT License text, in full, is at https://opensource.org/licenses/MIT. The
deltas from each upstream are documented in the `## Source` section of the
corresponding file: the upstream material is LaTeX template and gallery source,
while these documents describe OOXML and the behaviour of this plugin's own scripts.
Two repositories were considered and rejected on licence grounds:
`posquit0/Awesome-CV` and `VicaYang/THU-Exam-LaTeX-Template` (LPPL-1.3c, which
requires modified files to be renamed before distribution) and
`xiaohanyu/awesome-tikz` (no licence grant at all).

No upstream vendor's source, license text or copyright notice is distributed
with this plugin. The previous `skills/docx/LICENSE.txt` carried a proprietary
non-commercial license that conflicted with the repository's Apache-2.0 license
and did not describe any of the code actually shipped here; it was removed in
favour of the two sections above.
