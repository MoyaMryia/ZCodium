# Third-party notices

## Everything in this plugin

`package.json`, `.zcode-plugin/plugin.json`, this `NOTICE.md`,
`agents/visual-judge.md`, `skills/pdf/SKILL.md` and the three typesetting briefs
under `skills/pdf/briefs/` are original work written for this repository. They are
covered by the repository's root Apache-2.0 license, which is why the `license`
field of both manifests reads `Apache-2.0`.

The content is derived from publicly available typesetting and LaTeX knowledge —
document class and engine behaviour, page geometry, float and widow control,
font selection, bibliography and rasterization tooling. Where a factual
conclusion restates a widely published typesetting convention (a body leading
around 1.5, margins near 2 cm, poster body text sized for a viewing distance of
one to two metres), that convergence is a property of the public convention, not
of any particular upstream document.

## What is deliberately absent

No upstream vendor's source code, design engine, script, template, license text
or copyright notice is distributed with this plugin. An earlier packaging of this
skill carried a proprietary non-commercial `LICENSE.txt` alongside a set of
implementation scripts; neither the license text nor any of those scripts ships
here, and the two manifests therefore carry no `SEE LICENSE IN` pointer.

A PDF produced with this skill embeds the fonts and packages of whichever TeX
distribution ran the build. Those retain their own licenses, and the obligations
of the fonts a document actually embeds are the document author's to settle.
