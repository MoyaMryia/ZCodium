#!/usr/bin/env python3
"""Workbook construction helpers.

Original work for this repository, written against the public APIs of
openpyxl (MIT) and XlsxWriter (BSD-2-Clause); see the plugin NOTICE.md. No
third-party source is vendored.

Conventions implemented here (see engines/design.md):
  - blue inputs, black formulas, green cross-sheet links, red external links
  - years as text, zeros as "-", negatives in parentheses, units in headers
  - assumptions in one labelled block, referenced absolutely
  - one header row, no merged cells in data regions, frozen headers

Usage as a library:

    from templates.base import build_model_sheet, style_assumptions

Usage from the CLI (xlsx.py):

    python3 xlsx.py init model.xlsx --assumption growth 0.05

Requires: Python >= 3.10, openpyxl. XlsxWriter paths import lazily so the
openpyxl-only environments can still use the shared helpers.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Sequence

# --------------------------------------------------------------------- palette

# One accent, greys for the rest. Role colours from engines/design.md §1.
COLOR_INPUT = "FF0000FF"      # blue  - hardcoded inputs and scenario drivers
COLOR_FORMULA = "FF000000"    # black - every formula and calculation
COLOR_LINK = "FF008000"       # green - references into other sheets
COLOR_EXTERNAL = "FFFF0000"   # red   - links to other files
COLOR_ASSUMPTION_FILL = "FFFFFF00"  # yellow - assumptions needing attention
COLOR_HEADER_FILL = "FFF4F6F6"      # panel tone for header rows
COLOR_RULE = "FFAAB7B8"

# Number formats from engines/design.md §2.
FMT_YEAR = "@"
FMT_CURRENCY = "$#,##0;($#,##0);-"
FMT_CURRENCY_2DP = "$#,##0.00;($#,##0.00);-"
FMT_PERCENT = "0.0%;(0.0%);-"
FMT_MULTIPLE = '0.0"x"'
FMT_COUNT = "#,##0;(#,##0);-"


@dataclass(frozen=True)
class Style:
    """One visual role. Reuse instances; do not build formats per cell."""

    font_color: str | None = None
    bold: bool = False
    fill: str | None = None
    number_format: str | None = None
    size: int | None = None
    name: str | None = None


INPUT = Style(font_color=COLOR_INPUT, fill=COLOR_ASSUMPTION_FILL)
FORMULA = Style(font_color=COLOR_FORMULA)
LINK = Style(font_color=COLOR_LINK)
HEADER = Style(font_color=COLOR_FORMULA, bold=True, fill=COLOR_HEADER_FILL)
TITLE = Style(font_color=COLOR_FORMULA, bold=True, size=14)


# ------------------------------------------------------------------ openpyxl


def openpyxl_font(style: Style):
    from openpyxl.styles import Font, PatternFill

    return Font(
        name=style.name,
        size=style.size,
        bold=style.bold,
        color=style.font_color,
    )


def openpyxl_fill(style: Style):
    from openpyxl.styles import PatternFill

    if not style.fill:
        return PatternFill()
    return PatternFill(fill_type="solid", start_color=style.fill, end_color=style.fill)


def apply_openpyxl_style(cell, style: Style) -> None:
    """Apply a Style to an openpyxl cell."""
    cell.font = openpyxl_font(style)
    if style.fill:
        cell.fill = openpyxl_fill(style)
    if style.number_format:
        cell.number_format = style.number_format


def write_header_row(sheet, row: int, headers: Sequence[str], start_col: int = 1) -> None:
    """One header row, bold on a panel tone, frozen."""
    for offset, header in enumerate(headers):
        cell = sheet.cell(row=row, column=start_col + offset, value=header)
        apply_openpyxl_style(cell, HEADER)
    sheet.freeze_panes = sheet.cell(row=row + 1, column=1).coordinate


def write_assumption_block(
    sheet,
    start_row: int,
    assumptions: Iterable[tuple[str, float, str]],
    label_col: int = 1,
    value_col: int = 2,
    unit_col: int = 3,
) -> dict[str, str]:
    """Write the labelled assumption block; return name -> absolute reference.

    assumptions: (label, value, unit). The reference returned is absolute
    (``$B$7`` style) so formulas can be filled without drifting.
    """
    references: dict[str, str] = {}
    row = start_row
    for label, value, unit in assumptions:
        sheet.cell(row=row, column=label_col, value=label)
        value_cell = sheet.cell(row=row, column=value_col, value=value)
        apply_openpyxl_style(value_cell, INPUT)
        if unit:
            sheet.cell(row=row, column=unit_col, value=unit)
        references[label] = f"${_col_letter(value_col)}${row}"
        row += 1
    return references


def write_formula_column(
    sheet,
    first_row: int,
    last_row: int,
    col: int,
    template: str,
    number_format: str | None = None,
) -> None:
    """Fill one formula column. ``{r}`` in the template is the row number."""
    for row in range(first_row, last_row + 1):
        cell = sheet.cell(row=row, column=col, value=template.format(r=row))
        apply_openpyxl_style(cell, FORMULA)
        if number_format:
            cell.number_format = number_format


def write_total_row(
    sheet, row: int, label: str, columns: Sequence[int], first_data_row: int, last_data_row: int
) -> None:
    """A labelled total row computed by range formulas, never by summed values."""
    sheet.cell(row=row, column=1, value=label)
    for col in columns:
        letter = _col_letter(col)
        cell = sheet.cell(
            row=row, column=col, value=f"=SUM({letter}{first_data_row}:{letter}{last_data_row})"
        )
        apply_openpyxl_style(cell, FORMULA)


def set_column_widths(sheet, widths: dict[str, int]) -> None:
    for letter, width in widths.items():
        sheet.column_dimensions[letter].width = width


# ----------------------------------------------------------------- XlsxWriter


def xlsxwriter_formats(workbook) -> dict[str, object]:
    """The standard role formats for an XlsxWriter workbook."""
    return {
        "input": workbook.add_format(
            {"font_color": "#0000FF", "bg_color": "#FFFF00"}
        ),
        "formula": workbook.add_format({"font_color": "#000000"}),
        "link": workbook.add_format({"font_color": "#008000"}),
        "header": workbook.add_format(
            {"bold": True, "font_color": "#000000", "bg_color": "#F4F6F6"}
        ),
        "currency": workbook.add_format({"num_format": FMT_CURRENCY}),
        "percent": workbook.add_format({"num_format": FMT_PERCENT}),
        "count": workbook.add_format({"num_format": FMT_COUNT}),
    }


# --------------------------------------------------------------------- shared


@dataclass
class SheetPlan:
    """What one sheet holds; keeps the input/calc/output split explicit."""

    name: str
    role: str  # "inputs" | "calc" | "output" | "notes"
    headers: list[str] = field(default_factory=list)
    widths: dict[str, int] = field(default_factory=dict)


def _col_letter(col: int) -> str:
    letter = ""
    while col > 0:
        col, remainder = divmod(col - 1, 26)
        letter = chr(65 + remainder) + letter
    return letter


def build_model_sheet(sheet, plan: SheetPlan, first_data_row: int = 2) -> None:
    """Openpyxl convenience: title the sheet, write the header, set widths."""
    sheet.title = plan.name
    if plan.headers:
        write_header_row(sheet, 1, plan.headers)
    set_column_widths(sheet, plan.widths)


if __name__ == "__main__":  # pragma: no cover - manual smoke check
    print("templates/base.py loads; styles:", len({INPUT, FORMULA, LINK, HEADER, TITLE}))
