"""Docx comment/tracked-change editing.

Clean-room reimplementation. The API surface and the comment-XML shapes follow
the upstream Anthropic document-skills lineage, whose MIT-licensed reference
implementation lives at:

    https://github.com/appautomaton/document-SKILLs
    Copyright (c) 2026 appautomaton, MIT License

This file is a rewrite, not a copy. Differences from that reference, all
deliberate:

  * Self-contained packing. The reference delegates to ooxml/scripts/pack.py
    and to two XSD validators in the same tree; neither ships here, so
    _pack_document / _strip_formatting_whitespace below replace them.
  * validate() is a structural precondition check rather than a schema check,
    for the same reason. It still fails closed on a missing word/document.xml.
  * _update_settings gained `update_fields`, which writes <w:updateFields
    w:val="true"/> so Word recomputes TOC page numbers on open.
  * Insertion keeps the reference's full CT_Settings order table instead of a
    hand-written "insert before defaultTabStop" heuristic. See the note in
    _update_settings for why that matters.
  * Default author is "ZCodium" rather than a vendor name.

The five templates/ XML parts are byte-identical to the reference's and carry
the same MIT notice via NOTICE.md at the repository root.
"""


import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from .comments import CommentMixin
from .docx_editor import DocxXMLEditor
from .identifiers import (
    _CT_SETTINGS_ORDER,
    _generate_hex_id,
    _generate_rsid,
    _insert_settings_element,
)
from .packing import TEMPLATE_DIR, _pack_document, _strip_formatting_whitespace


class Document(CommentMixin):
    """Manages comments in unpacked Word documents."""

    def __init__(
        self,
        unpacked_dir,
        rsid=None,
        track_revisions=False,
        author="ZCodium",
        initials="C",
    ):
        """
        Initialize with path to unpacked Word document directory.
        Automatically sets up comment infrastructure (people.xml, RSIDs).

        Args:
            unpacked_dir: Path to unpacked DOCX directory (must contain word/ subdirectory)
            rsid: Optional RSID to use for all comment elements. If not provided, one will be generated.
            track_revisions: If True, enables track revisions in settings.xml (default: False)
            author: Default author name for comments (default: "ZCodium")
            initials: Default author initials for comments (default: "C")
        """
        self.original_path = Path(unpacked_dir)

        if not self.original_path.exists() or not self.original_path.is_dir():
            raise ValueError(f"Directory not found: {unpacked_dir}")

        # Create temporary directory with subdirectories for unpacked content and baseline
        self.temp_dir = tempfile.mkdtemp(prefix="docx_")
        self.unpacked_path = Path(self.temp_dir) / "unpacked"
        shutil.copytree(self.original_path, self.unpacked_path)

        # Pack original directory into temporary .docx for validation baseline (outside unpacked dir)
        self.original_docx = Path(self.temp_dir) / "original.docx"
        _pack_document(self.original_path, self.original_docx)

        self.word_path = self.unpacked_path / "word"

        # Generate RSID if not provided
        self.rsid = rsid if rsid else _generate_rsid()
        print(f"Using RSID: {self.rsid}")

        # Set default author and initials
        self.author = author
        self.initials = initials

        # Cache for lazy-loaded editors
        self._editors = {}

        # Comment file paths
        self.comments_path = self.word_path / "comments.xml"
        self.comments_extended_path = self.word_path / "commentsExtended.xml"
        self.comments_ids_path = self.word_path / "commentsIds.xml"
        self.comments_extensible_path = self.word_path / "commentsExtensible.xml"

        # Load existing comments and determine next ID (before setup modifies files)
        self.existing_comments = self._load_existing_comments()
        self.next_comment_id = self._get_next_comment_id()

        # Convenient access to document.xml editor (semi-private)
        self._document = self["word/document.xml"]

        # Setup tracked changes infrastructure
        self._setup_tracking(track_revisions=track_revisions)

        # Add author to people.xml
        self._add_author_to_people(author)

    def __getitem__(self, xml_path: str) -> DocxXMLEditor:
        """
        Get or create a DocxXMLEditor for the specified XML file.

        Enables lazy-loaded editors with bracket notation:
            node = doc["word/document.xml"].get_node(tag="w:p", line_number=42)

        Args:
            xml_path: Relative path to XML file (e.g., "word/document.xml", "word/comments.xml")

        Returns:
            DocxXMLEditor instance for the specified file

        Raises:
            ValueError: If the file does not exist

        Example:
            # Get node from document.xml
            node = doc["word/document.xml"].get_node(tag="w:del", attrs={"w:id": "1"})

            # Get node from comments.xml
            comment = doc["word/comments.xml"].get_node(tag="w:comment", attrs={"w:id": "0"})
        """
        if xml_path not in self._editors:
            file_path = self.unpacked_path / xml_path
            if not file_path.exists():
                raise ValueError(f"XML file not found: {xml_path}")
            # Use DocxXMLEditor with RSID, author, and initials for all editors
            self._editors[xml_path] = DocxXMLEditor(
                file_path, rsid=self.rsid, author=self.author, initials=self.initials
            )
        return self._editors[xml_path]

    def add_comment(self, start, end, text: str) -> int:
        """
        Add a comment spanning from one element to another.

        Args:
            start: DOM element for the starting point
            end: DOM element for the ending point
            text: Comment content

        Returns:
            The comment ID that was created

        Example:
            start_node = cm.get_document_node(tag="w:del", id="1")
            end_node = cm.get_document_node(tag="w:ins", id="2")
            cm.add_comment(start=start_node, end=end_node, text="Explanation")
        """
        comment_id = self.next_comment_id
        para_id = _generate_hex_id()
        durable_id = _generate_hex_id()
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        # Add comment ranges to document.xml immediately
        self._document.insert_before(start, self._comment_range_start_xml(comment_id))

        # If end node is a paragraph, append comment markup inside it
        # Otherwise insert after it (for run-level anchors)
        if end.tagName == "w:p":
            self._document.append_to(end, self._comment_range_end_xml(comment_id))
        else:
            self._document.insert_after(end, self._comment_range_end_xml(comment_id))

        # Add to comments.xml immediately
        self._add_to_comments_xml(
            comment_id, para_id, text, self.author, self.initials, timestamp
        )

        # Add to commentsExtended.xml immediately
        self._add_to_comments_extended_xml(para_id, parent_para_id=None)

        # Add to commentsIds.xml immediately
        self._add_to_comments_ids_xml(para_id, durable_id)

        # Add to commentsExtensible.xml immediately
        self._add_to_comments_extensible_xml(durable_id)

        # Update existing_comments so replies work
        self.existing_comments[comment_id] = {"para_id": para_id}

        self.next_comment_id += 1
        return comment_id

    def reply_to_comment(
        self,
        parent_comment_id: int,
        text: str,
    ) -> int:
        """
        Add a reply to an existing comment.

        Args:
            parent_comment_id: The w:id of the parent comment to reply to
            text: Reply text

        Returns:
            The comment ID that was created for the reply

        Example:
            cm.reply_to_comment(parent_comment_id=0, text="I agree with this change")
        """
        if parent_comment_id not in self.existing_comments:
            raise ValueError(f"Parent comment with id={parent_comment_id} not found")

        parent_info = self.existing_comments[parent_comment_id]
        comment_id = self.next_comment_id
        para_id = _generate_hex_id()
        durable_id = _generate_hex_id()
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        # Add comment ranges to document.xml immediately
        parent_start_elem = self._document.get_node(
            tag="w:commentRangeStart", attrs={"w:id": str(parent_comment_id)}
        )
        parent_ref_elem = self._document.get_node(
            tag="w:commentReference", attrs={"w:id": str(parent_comment_id)}
        )

        self._document.insert_after(
            parent_start_elem, self._comment_range_start_xml(comment_id)
        )
        parent_ref_run = parent_ref_elem.parentNode
        self._document.insert_after(
            parent_ref_run, f'<w:commentRangeEnd w:id="{comment_id}"/>'
        )
        self._document.insert_after(
            parent_ref_run, self._comment_ref_run_xml(comment_id)
        )

        # Add to comments.xml immediately
        self._add_to_comments_xml(
            comment_id, para_id, text, self.author, self.initials, timestamp
        )

        # Add to commentsExtended.xml immediately (with parent)
        self._add_to_comments_extended_xml(
            para_id, parent_para_id=parent_info["para_id"]
        )

        # Add to commentsIds.xml immediately
        self._add_to_comments_ids_xml(para_id, durable_id)

        # Add to commentsExtensible.xml immediately
        self._add_to_comments_extensible_xml(durable_id)

        # Update existing_comments so replies work
        self.existing_comments[comment_id] = {"para_id": para_id}

        self.next_comment_id += 1
        return comment_id

    def __del__(self):
        """Clean up temporary directory on deletion."""
        if hasattr(self, "temp_dir") and Path(self.temp_dir).exists():
            shutil.rmtree(self.temp_dir)

    def validate(self) -> None:
        """
        Check the structural precondition every later edit depends on.

        Upstream additionally validates against the OOXML XSD schemas and a
        redlining rule set. Neither tree ships with this plugin, so this is a
        presence check rather than a schema check — but it still fails closed:
        an unpacked directory without word/document.xml cannot be edited at all.

        Raises:
            ValueError: If word/document.xml is missing.
        """
        if not (self.unpacked_path / "word" / "document.xml").exists():
            raise ValueError("Validation failed: word/document.xml not found")

    def save(self, destination=None, validate=True) -> None:
        """
        Save all modified XML files to disk and copy to destination directory.

        This persists all changes made via add_comment() and reply_to_comment().

        Args:
            destination: Optional path to save to. If None, saves back to original directory.
            validate: If True, validates document before saving (default: True).
        """
        # Only ensure comment relationships and content types if comment files exist
        if self.comments_path.exists():
            self._ensure_comment_relationships()
            self._ensure_comment_content_types()

        # Save all modified XML files in temp directory
        for editor in self._editors.values():
            editor.save()

        # Validate by default
        if validate:
            self.validate()

        # Copy contents from temp directory to destination (or original directory)
        target_path = Path(destination) if destination else self.original_path
        shutil.copytree(self.unpacked_path, target_path, dirs_exist_ok=True)
