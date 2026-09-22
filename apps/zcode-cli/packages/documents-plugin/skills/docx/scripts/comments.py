"""Comment XML construction and package metadata, split from scripts/document.py.

Clean-room reimplementation of the same lineage described in the
scripts/document.py module docstring; the MIT-licensed reference
implementation lives at:

    https://github.com/appautomaton/document-SKILLs
    Copyright (c) 2026 appautomaton, MIT License

The mixin expects the host document to provide the `__getitem__` editor
registry, the comment part paths, and the RSID/author attributes.
"""


import html
import shutil

from .identifiers import _insert_settings_element
from .packing import TEMPLATE_DIR


class CommentMixin:

    # ==================== Private: Initialization ====================

    def _get_next_comment_id(self):
        """Get the next available comment ID."""
        if not self.comments_path.exists():
            return 0

        editor = self["word/comments.xml"]
        max_id = -1
        for comment_elem in editor.dom.getElementsByTagName("w:comment"):
            comment_id = comment_elem.getAttribute("w:id")
            if comment_id:
                try:
                    max_id = max(max_id, int(comment_id))
                except ValueError:
                    pass
        return max_id + 1

    def _load_existing_comments(self):
        """Load existing comments from files to enable replies."""
        if not self.comments_path.exists():
            return {}

        editor = self["word/comments.xml"]
        existing = {}

        for comment_elem in editor.dom.getElementsByTagName("w:comment"):
            comment_id = comment_elem.getAttribute("w:id")
            if not comment_id:
                continue

            # Find para_id from the w:p element within the comment
            para_id = None
            for p_elem in comment_elem.getElementsByTagName("w:p"):
                para_id = p_elem.getAttribute("w14:paraId")
                if para_id:
                    break

            if not para_id:
                continue

            existing[int(comment_id)] = {"para_id": para_id}

        return existing

    # ==================== Private: Setup Methods ====================

    def _setup_tracking(self, track_revisions=False):
        """Set up comment infrastructure in unpacked directory.

        Args:
            track_revisions: If True, enables track revisions in settings.xml
        """
        # Create or update word/people.xml
        people_file = self.word_path / "people.xml"
        self._update_people_xml(people_file)

        # Update XML files
        self._add_content_type_for_people(self.unpacked_path / "[Content_Types].xml")
        self._add_relationship_for_people(
            self.word_path / "_rels" / "document.xml.rels"
        )

        # Always add RSID to settings.xml, optionally enable trackRevisions
        self._update_settings(
            self.word_path / "settings.xml", track_revisions=track_revisions
        )

    def _update_people_xml(self, path):
        """Create people.xml if it doesn't exist."""
        if not path.exists():
            # Copy from template
            shutil.copy(TEMPLATE_DIR / "people.xml", path)

    def _add_content_type_for_people(self, path):
        """Add people.xml content type to [Content_Types].xml if not already present."""
        editor = self["[Content_Types].xml"]

        if self._has_override(editor, "/word/people.xml"):
            return

        # Add Override element
        root = editor.dom.documentElement
        override_xml = '<Override PartName="/word/people.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.people+xml"/>'
        editor.append_to(root, override_xml)

    def _add_relationship_for_people(self, path):
        """Add people.xml relationship to document.xml.rels if not already present."""
        editor = self["word/_rels/document.xml.rels"]

        if self._has_relationship(editor, "people.xml"):
            return

        root = editor.dom.documentElement
        root_tag = root.tagName  # type: ignore
        prefix = root_tag.split(":")[0] + ":" if ":" in root_tag else ""
        next_rid = editor.get_next_rid()

        # Create the relationship entry
        rel_xml = f'<{prefix}Relationship Id="{next_rid}" Type="http://schemas.microsoft.com/office/2011/relationships/people" Target="people.xml"/>'
        editor.append_to(root, rel_xml)

    def _update_settings(self, path, track_revisions=False, update_fields=True):
        """Add RSID and optionally enable track revisions / field update on open.

        Args:
            path: Path to settings.xml
            track_revisions: If True, adds a <w:trackRevisions/> element
            update_fields: If True, adds <w:updateFields w:val="true"/> so Word
                refreshes TOC page numbers and cross-references when the file opens

        New elements are placed at their schema-valid position via
        _insert_settings_element (CT_Settings child order), so the result
        validates regardless of which optional settings the source file has.
        """
        editor = self["word/settings.xml"]
        root = editor.get_node(tag="w:settings")
        prefix = root.tagName.split(":")[0] if ":" in root.tagName else "w"

        # Conditionally add trackRevisions if requested
        if track_revisions and not editor.dom.getElementsByTagName(
            f"{prefix}:trackRevisions"
        ):
            _insert_settings_element(
                editor, root, "trackRevisions", f"<{prefix}:trackRevisions/>"
            )

        # Ask Word to recompute fields on open. Without it a TOC inserted or
        # edited programmatically keeps whatever page numbers were cached at
        # save time, which for a freshly built document is nothing at all.
        if update_fields and not editor.dom.getElementsByTagName(
            f"{prefix}:updateFields"
        ):
            _insert_settings_element(
                editor,
                root,
                "updateFields",
                f'<{prefix}:updateFields {prefix}:val="true"/>',
            )

        # Ensure an rsids section exists and contains this session's RSID
        rsids_elements = editor.dom.getElementsByTagName(f"{prefix}:rsids")

        if not rsids_elements:
            rsids_xml = f'''<{prefix}:rsids>
  <{prefix}:rsidRoot {prefix}:val="{self.rsid}"/>
  <{prefix}:rsid {prefix}:val="{self.rsid}"/>
</{prefix}:rsids>'''
            _insert_settings_element(editor, root, "rsids", rsids_xml)
        else:
            # Check if this rsid already exists
            rsids_elem = rsids_elements[0]
            rsid_exists = any(
                elem.getAttribute(f"{prefix}:val") == self.rsid
                for elem in rsids_elem.getElementsByTagName(f"{prefix}:rsid")
            )

            if not rsid_exists:
                rsid_xml = f'<{prefix}:rsid {prefix}:val="{self.rsid}"/>'
                editor.append_to(rsids_elem, rsid_xml)

    # ==================== Private: XML File Creation ====================

    def _add_to_comments_xml(
        self, comment_id, para_id, text, author, initials, timestamp
    ):
        """Add a single comment to comments.xml."""
        if not self.comments_path.exists():
            shutil.copy(TEMPLATE_DIR / "comments.xml", self.comments_path)

        editor = self["word/comments.xml"]
        root = editor.get_node(tag="w:comments")

        escaped_text = (
            text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        )
        # Note: w:rsidR, w:rsidRDefault, w:rsidP on w:p, w:rsidR on w:r,
        # and w:author, w:date, w:initials on w:comment are automatically added by DocxXMLEditor
        comment_xml = f'''<w:comment w:id="{comment_id}">
  <w:p w14:paraId="{para_id}" w14:textId="77777777">
    <w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>
    <w:r><w:rPr><w:color w:val="000000"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t>{escaped_text}</w:t></w:r>
  </w:p>
</w:comment>'''
        editor.append_to(root, comment_xml)

    def _add_to_comments_extended_xml(self, para_id, parent_para_id):
        """Add a single comment to commentsExtended.xml."""
        if not self.comments_extended_path.exists():
            shutil.copy(
                TEMPLATE_DIR / "commentsExtended.xml", self.comments_extended_path
            )

        editor = self["word/commentsExtended.xml"]
        root = editor.get_node(tag="w15:commentsEx")

        if parent_para_id:
            xml = f'<w15:commentEx w15:paraId="{para_id}" w15:paraIdParent="{parent_para_id}" w15:done="0"/>'
        else:
            xml = f'<w15:commentEx w15:paraId="{para_id}" w15:done="0"/>'
        editor.append_to(root, xml)

    def _add_to_comments_ids_xml(self, para_id, durable_id):
        """Add a single comment to commentsIds.xml."""
        if not self.comments_ids_path.exists():
            shutil.copy(TEMPLATE_DIR / "commentsIds.xml", self.comments_ids_path)

        editor = self["word/commentsIds.xml"]
        root = editor.get_node(tag="w16cid:commentsIds")

        xml = f'<w16cid:commentId w16cid:paraId="{para_id}" w16cid:durableId="{durable_id}"/>'
        editor.append_to(root, xml)

    def _add_to_comments_extensible_xml(self, durable_id):
        """Add a single comment to commentsExtensible.xml."""
        if not self.comments_extensible_path.exists():
            shutil.copy(
                TEMPLATE_DIR / "commentsExtensible.xml", self.comments_extensible_path
            )

        editor = self["word/commentsExtensible.xml"]
        root = editor.get_node(tag="w16cex:commentsExtensible")

        xml = f'<w16cex:commentExtensible w16cex:durableId="{durable_id}"/>'
        editor.append_to(root, xml)

    # ==================== Private: XML Fragments ====================

    def _comment_range_start_xml(self, comment_id):
        """Generate XML for comment range start."""
        return f'<w:commentRangeStart w:id="{comment_id}"/>'

    def _comment_range_end_xml(self, comment_id):
        """Generate XML for comment range end with reference run.

        Note: w:rsidR is automatically added by DocxXMLEditor.
        """
        return f'''<w:commentRangeEnd w:id="{comment_id}"/>
<w:r>
  <w:rPr><w:rStyle w:val="CommentReference"/></w:rPr>
  <w:commentReference w:id="{comment_id}"/>
</w:r>'''

    def _comment_ref_run_xml(self, comment_id):
        """Generate XML for comment reference run.

        Note: w:rsidR is automatically added by DocxXMLEditor.
        """
        return f'''<w:r>
  <w:rPr><w:rStyle w:val="CommentReference"/></w:rPr>
  <w:commentReference w:id="{comment_id}"/>
</w:r>'''

    # ==================== Private: Metadata Updates ====================

    def _has_relationship(self, editor, target):
        """Check if a relationship with given target exists."""
        for rel_elem in editor.dom.getElementsByTagName("Relationship"):
            if rel_elem.getAttribute("Target") == target:
                return True
        return False

    def _has_override(self, editor, part_name):
        """Check if an override with given part name exists."""
        for override_elem in editor.dom.getElementsByTagName("Override"):
            if override_elem.getAttribute("PartName") == part_name:
                return True
        return False

    def _has_author(self, editor, author):
        """Check if an author already exists in people.xml."""
        for person_elem in editor.dom.getElementsByTagName("w15:person"):
            if person_elem.getAttribute("w15:author") == author:
                return True
        return False

    def _add_author_to_people(self, author):
        """Add author to people.xml (called during initialization)."""
        people_path = self.word_path / "people.xml"

        # people.xml should already exist from _setup_tracking
        if not people_path.exists():
            raise ValueError("people.xml should exist after _setup_tracking")

        editor = self["word/people.xml"]
        root = editor.get_node(tag="w15:people")

        # Check if author already exists
        if self._has_author(editor, author):
            return

        # Add author with proper XML escaping to prevent injection
        escaped_author = html.escape(author, quote=True)
        person_xml = f'''<w15:person w15:author="{escaped_author}">
  <w15:presenceInfo w15:providerId="None" w15:userId="{escaped_author}"/>
</w15:person>'''
        editor.append_to(root, person_xml)

    def _ensure_comment_relationships(self):
        """Ensure word/_rels/document.xml.rels has comment relationships."""
        editor = self["word/_rels/document.xml.rels"]

        if self._has_relationship(editor, "comments.xml"):
            return

        root = editor.dom.documentElement
        root_tag = root.tagName  # type: ignore
        prefix = root_tag.split(":")[0] + ":" if ":" in root_tag else ""
        next_rid_num = int(editor.get_next_rid()[3:])

        # Add relationship elements
        rels = [
            (
                next_rid_num,
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments",
                "comments.xml",
            ),
            (
                next_rid_num + 1,
                "http://schemas.microsoft.com/office/2011/relationships/commentsExtended",
                "commentsExtended.xml",
            ),
            (
                next_rid_num + 2,
                "http://schemas.microsoft.com/office/2016/09/relationships/commentsIds",
                "commentsIds.xml",
            ),
            (
                next_rid_num + 3,
                "http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible",
                "commentsExtensible.xml",
            ),
        ]

        for rel_id, rel_type, target in rels:
            rel_xml = f'<{prefix}Relationship Id="rId{rel_id}" Type="{rel_type}" Target="{target}"/>'
            editor.append_to(root, rel_xml)

    def _ensure_comment_content_types(self):
        """Ensure [Content_Types].xml has comment content types."""
        editor = self["[Content_Types].xml"]

        if self._has_override(editor, "/word/comments.xml"):
            return

        root = editor.dom.documentElement

        # Add Override elements
        overrides = [
            (
                "/word/comments.xml",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml",
            ),
            (
                "/word/commentsExtended.xml",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml",
            ),
            (
                "/word/commentsIds.xml",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsIds+xml",
            ),
            (
                "/word/commentsExtensible.xml",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtensible+xml",
            ),
        ]

        for part_name, content_type in overrides:
            override_xml = (
                f'<Override PartName="{part_name}" ContentType="{content_type}"/>'
            )
            editor.append_to(root, override_xml)
