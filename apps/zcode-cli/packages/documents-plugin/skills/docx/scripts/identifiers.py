"""Identifier and settings.xml helpers, split from scripts/document.py.

Clean-room reimplementation of the same lineage described in the
scripts/document.py module docstring; the MIT-licensed reference
implementation lives at:

    https://github.com/appautomaton/document-SKILLs
    Copyright (c) 2026 appautomaton, MIT License
"""


import random


def _generate_hex_id() -> str:
    """Generate random 8-character hex ID for para/durable IDs.

    Values are constrained to be less than 0x7FFFFFFF per OOXML spec:
    - paraId must be < 0x80000000
    - durableId must be < 0x7FFFFFFF
    We use the stricter constraint (0x7FFFFFFF) for both.
    """
    return f"{random.randint(1, 0x7FFFFFFE):08X}"


def _generate_rsid() -> str:
    """Generate random 8-character hex RSID."""
    return "".join(random.choices("0123456789ABCDEF", k=8))


# Child element order of CT_Settings per ECMA-376 / ISO-IEC 29500
# (ooxml/schemas/ISO-IEC29500-4_2016/wml.xsd, CT_Settings sequence). Used to
# insert new settings.xml elements at a schema-valid position regardless of
# which optional settings the source document already contains.
_CT_SETTINGS_ORDER = (
    "writeProtection", "view", "zoom", "removePersonalInformation", "removeDateAndTime",
    "doNotDisplayPageBoundaries", "displayBackgroundShape", "printPostScriptOverText",
    "printFractionalCharacterWidth", "printFormsData", "embedTrueTypeFonts", "embedSystemFonts",
    "saveSubsetFonts", "saveFormsData", "mirrorMargins", "alignBordersAndEdges",
    "bordersDoNotSurroundHeader", "bordersDoNotSurroundFooter", "gutterAtTop", "hideSpellingErrors",
    "hideGrammaticalErrors", "activeWritingStyle", "proofState", "formsDesign", "attachedTemplate",
    "linkStyles", "stylePaneFormatFilter", "stylePaneSortMethod", "documentType", "mailMerge",
    "revisionView", "trackRevisions", "doNotTrackMoves", "doNotTrackFormatting", "documentProtection",
    "autoFormatOverride", "styleLockTheme", "styleLockQFSet", "defaultTabStop", "autoHyphenation",
    "consecutiveHyphenLimit", "hyphenationZone", "doNotHyphenateCaps", "showEnvelope", "summaryLength",
    "clickAndTypeStyle", "defaultTableStyle", "evenAndOddHeaders", "bookFoldRevPrinting",
    "bookFoldPrinting", "bookFoldPrintingSheets", "drawingGridHorizontalSpacing",
    "drawingGridVerticalSpacing", "displayHorizontalDrawingGridEvery", "displayVerticalDrawingGridEvery",
    "doNotUseMarginsForDrawingGridOrigin", "drawingGridHorizontalOrigin", "drawingGridVerticalOrigin",
    "doNotShadeFormData", "noPunctuationKerning", "characterSpacingControl", "printTwoOnOne",
    "strictFirstAndLastChars", "noLineBreaksAfter", "noLineBreaksBefore", "savePreviewPicture",
    "doNotValidateAgainstSchema", "saveInvalidXml", "ignoreMixedContent", "alwaysShowPlaceholderText",
    "doNotDemarcateInvalidXml", "saveXmlDataOnly", "useXSLTWhenSaving", "saveThroughXslt",
    "showXMLTags", "alwaysMergeEmptyNamespace", "updateFields", "hdrShapeDefaults", "footnotePr",
    "endnotePr", "compat", "docVars", "rsids", "attachedSchema", "themeFontLang", "clrSchemeMapping",
    "doNotIncludeSubdocsInStats", "doNotAutoCompressPictures", "forceUpgrade", "captions",
    "readModeInkLockDown", "smartTagType", "shapeDefaults", "doNotEmbedSmartTags", "decimalSymbol",
    "listSeparator",
)


def _insert_settings_element(editor, root, local_name, xml):
    """Insert `xml` into <w:settings> at the schema-valid position for `local_name`.

    Inserts before the first existing child that must follow `local_name` per
    _CT_SETTINGS_ORDER; if none exists, appends. Unknown/extension elements are
    skipped when scanning. Caller ensures the element does not already exist.
    """
    try:
        target_idx = _CT_SETTINGS_ORDER.index(local_name)
    except ValueError:
        target_idx = len(_CT_SETTINGS_ORDER)
    for child in root.childNodes:
        if child.nodeType != child.ELEMENT_NODE:
            continue
        child_local = child.tagName.split(":")[-1]
        try:
            child_idx = _CT_SETTINGS_ORDER.index(child_local)
        except ValueError:
            continue
        if child_idx > target_idx:
            editor.insert_before(child, xml)
            return
    editor.append_to(root, xml)
