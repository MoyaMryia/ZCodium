"""Parsed view of a generated .docx, shared by every postcheck rule.

Each rule needs the same handful of facts — paragraphs, tables, sections, page
geometry, image extents. Recomputing them per rule means walking the tree a
dozen times and, worse, a dozen chances to disagree about what a "paragraph"
is. This module derives them once.

Read-only: nothing here mutates the document.
"""

from __future__ import annotations

import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
WP = "{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"

NS = {"w": W[1:-1]}


@dataclass
class Section:
    """One <w:sectPr>, i.e. one page-geometry region."""

    index: int
    page_width_twips: int | None
    page_height_twips: int | None
    margin_left: int | None
    margin_right: int | None
    is_last: bool

    @property
    def usable_width_twips(self) -> int | None:
        if None in (self.page_width_twips, self.margin_left, self.margin_right):
            return None
        return self.page_width_twips - self.margin_left - self.margin_right


@dataclass
class Paragraph:
    index: int
    element: ET.Element
    style: str | None
    text: str
    has_page_break: bool
    has_drawing: bool
    is_centered: bool
    is_in_table: bool
    is_list_item: bool
    first_line_indent_twips: int | None


@dataclass
class Table:
    index: int
    element: ET.Element
    row_count: int
    header_rows_with_tblHeader: int
    rows_without_cantSplit: int
    cells_without_margins: int
    has_solid_shading: bool


@dataclass
class Image:
    index: int
    width_emu: int | None
    height_emu: int | None
    paragraph_index: int


@dataclass
class DocumentContext:
    root: ET.Element
    sections: list[Section] = field(default_factory=list)
    paragraphs: list[Paragraph] = field(default_factory=list)
    tables: list[Table] = field(default_factory=list)
    images: list[Image] = field(default_factory=list)
    fonts_declared: set[str] = field(default_factory=set)
    numbering_ids: set[str] = field(default_factory=set)

    @property
    def body(self) -> ET.Element | None:
        return self.root.find(f"{W}body")

    def widest_usable_twips(self) -> int | None:
        usable = [s.usable_width_twips for s in self.sections]
        usable = [u for u in usable if u is not None]
        return min(usable) if usable else None


def _twips(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _text_of(paragraph: ET.Element) -> str:
    return "".join(node.text or "" for node in paragraph.iter(f"{W}t"))


def _is_centered(paragraph: ET.Element) -> bool:
    for justification in paragraph.iter(f"{W}jc"):
        if justification.get(f"{W}val") == "center":
            return True
    return False


def _first_line_indent(paragraph: ET.Element) -> int | None:
    for ind in paragraph.iter(f"{W}ind"):
        value = _twips(ind.get(f"{W}firstLine"))
        if value is not None:
            return value
    return None


def _in_table(paragraph: ET.Element, table_paragraphs: set[int]) -> bool:
    return id(paragraph) in table_paragraphs


def load_document(docx_path: str | Path) -> DocumentContext:
    """Read word/document.xml out of a .docx and derive the shared facts."""
    with zipfile.ZipFile(docx_path) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))
        try:
            styles = ET.fromstring(archive.read("word/styles.xml"))
        except KeyError:
            styles = None

    context = DocumentContext(root=root)

    # 表格内的段落要单独标记：缩进、行距一类规则对它们不适用。
    table_paragraphs = set()
    for table in root.iter(f"{W}tbl"):
        for paragraph in table.iter(f"{W}p"):
            table_paragraphs.add(id(paragraph))

    context.sections = _read_sections(root)
    context.paragraphs = _read_paragraphs(root, table_paragraphs)
    context.tables = _read_tables(root)
    context.images = _read_images(root, context.paragraphs)
    context.fonts_declared = _read_fonts(root, styles)
    context.numbering_ids = {
        num.get(f"{W}numId") for num in root.iter(f"{W}numPr") if num.get(f"{W}numId")
    }
    return context


def _read_sections(root: ET.Element) -> list[Section]:
    sections: list[Section] = []
    for index, sectpr in enumerate(root.iter(f"{W}sectPr")):
        page_size = sectpr.find(f"{W}pgSz")
        margin = sectpr.find(f"{W}pgMar")
        sections.append(
            Section(
                index=index,
                page_width_twips=_twips(page_size.get(f"{W}w")) if page_size is not None else None,
                page_height_twips=_twips(page_size.get(f"{W}h")) if page_size is not None else None,
                margin_left=_twips(margin.get(f"{W}left")) if margin is not None else None,
                margin_right=_twips(margin.get(f"{W}right")) if margin is not None else None,
                # 文档级 sectPr 位于 body 末尾，描述最后一节。
                is_last=index == len(list(root.iter(f"{W}sectPr"))) - 1,
            )
        )
    return sections


def _read_paragraphs(root: ET.Element, table_paragraphs: set[int]) -> list[Paragraph]:
    paragraphs: list[Paragraph] = []
    for index, element in enumerate(root.iter(f"{W}p")):
        style = None
        ppr = element.find(f"{W}pPr")
        if ppr is not None:
            pstyle = ppr.find(f"{W}pStyle")
            if pstyle is not None:
                style = pstyle.get(f"{W}val")
        paragraphs.append(
            Paragraph(
                index=index,
                element=element,
                style=style,
                text=_text_of(element),
                has_page_break=any(
                    br.get(f"{W}type") == "page" for br in element.iter(f"{W}br")
                ),
                has_drawing=element.find(f".//{WP}inline") is not None
                or element.find(f".//{WP}anchor") is not None,
                is_centered=_is_centered(element),
                is_in_table=id(element) in table_paragraphs,
                is_list_item=element.find(f".//{W}numPr") is not None,
                first_line_indent_twips=_first_line_indent(element),
            )
        )
    return paragraphs


def _read_tables(root: ET.Element) -> list[Table]:
    tables: list[Table] = []
    for index, element in enumerate(root.findall(f".//{W}tbl")):
        rows = element.findall(f"{W}tr")
        header = 0
        no_cant_split = 0
        no_margins = 0
        for row in rows:
            trpr = row.find(f"{W}trPr")
            if trpr is not None and trpr.find(f"{W}tblHeader") is not None:
                header += 1
            if trpr is None or trpr.find(f"{W}cantSplit") is None:
                no_cant_split += 1
            for cell in row.findall(f"{W}tc"):
                tcpr = cell.find(f"{W}tcPr")
                if tcpr is None or tcpr.find(f"{W}tcMar") is None:
                    no_margins += 1
        tables.append(
            Table(
                index=index,
                element=element,
                row_count=len(rows),
                header_rows_with_tblHeader=header,
                rows_without_cantSplit=no_cant_split,
                cells_without_margins=no_margins,
                # SOLID 配上深色填充是"整个单元格变黑"的直接原因。
                has_solid_shading=any(
                    shading.get(f"{W}fill") not in (None, "auto")
                    for shading in element.iter(f"{W}shd")
                ),
            )
        )
    return tables


def _read_images(root: ET.Element, paragraphs: list[Paragraph]) -> list[Image]:
    images: list[Image] = []
    by_id = {id(p.element): p.index for p in paragraphs}
    for index, extent in enumerate(root.iter(f"{WP}extent")):
        # extent 属于某个 drawing，向上找不到对应的 w:p 就归到第一段，
        # 这类图片位置不影响溢出判定（判定用的是宽度）。
        paragraph_index = by_id.get(id(extent), 0)
        images.append(
            Image(
                index=index,
                width_emu=_twips(extent.get("cx")),
                height_emu=_twips(extent.get("cy")),
                paragraph_index=paragraph_index,
            )
        )
    return images


def _read_fonts(root: ET.Element, styles: ET.Element | None) -> set[str]:
    fonts: set[str] = set()
    for node in root.iter(f"{W}rFonts"):
        for attribute in (f"{W}ascii", f"{W}hAnsi", f"{W}eastAsia"):
            value = node.get(attribute)
            if value:
                fonts.add(value)
    if styles is not None:
        for node in styles.iter(f"{W}rFonts"):
            for attribute in (f"{W}ascii", f"{W}hAnsi", f"{W}eastAsia"):
                value = node.get(attribute)
                if value:
                    fonts.add(value)
    return fonts
