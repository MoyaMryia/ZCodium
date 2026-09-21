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

## skills/docx/LICENSE.txt

The remainder of this plugin — the SKILL.md body, the references/, routes/ and
scenes/ documents, `postcheck.py`, `add_toc_placeholders.py`,
`fix_footer_fields.py` and the env_setup scripts — is covered by the proprietary
non-commercial license in `skills/docx/LICENSE.txt`. It is not MIT-licensed and
not Apache-2.0-licensed, and the repository's root Apache-2.0 license does not
extend to it.
