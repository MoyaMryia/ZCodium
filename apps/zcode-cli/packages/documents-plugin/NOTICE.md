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
`references/`, `routes/` and `scenes/` documents are original work written for
this repository. They are covered by the repository's root Apache-2.0 license.

No upstream vendor's source, license text or copyright notice is distributed
with this plugin. The previous `skills/docx/LICENSE.txt` carried a proprietary
non-commercial license that conflicted with the repository's Apache-2.0 license
and did not describe any of the code actually shipped here; it was removed in
favour of the two sections above.
