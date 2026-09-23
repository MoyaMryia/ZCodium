# Third-party notices

## skills/pptx/references/design.md — MIT-derived

The design guidance in `skills/pptx/references/design.md` — palette roles and the
reference palettes, the visual-detail catalogues, the chart styling rules, the
two-column layout default and the consistency pass — is adapted from the `pptx`
skill of:

    appautomaton/document-SKILLs
    https://github.com/appautomaton/document-SKILLs
    Copyright (c) 2026 appautomaton
    MIT License

The upstream work is licensed under the MIT License, which permits use, copying,
modification, merging, publication and distribution on the condition that the
copyright notice and the permission notice are carried along. The notice is
reproduced in the header comment of `references/design.md` and recorded here.

The deltas from the upstream file: the upstream `pptx/SKILL.md` bundles design
guidance together with a PptxGenJS/html2pptx build workflow; this repository
keeps the OOXML-level guidance it already had in `SKILL.md` and takes only the
design-decision layer, restructured into audience/palette/type-scale decisions,
palette roles, and a consistency pass. No generator-specific instructions were
carried over, and the palette list was trimmed to swatches that work as
starting points. `agents/visual-judge.md` and `SKILL.md` remain original work.

## Removed proprietary license

The previous `skills/pptx/LICENSE.txt` carried a proprietary non-commercial
license that conflicted with the repository's Apache-2.0 license. It described
upstream vendor terms, not the content actually shipped here, and was removed.
