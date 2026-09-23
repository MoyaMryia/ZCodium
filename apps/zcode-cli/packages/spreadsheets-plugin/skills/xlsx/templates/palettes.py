#!/usr/bin/env python3
"""Workbook colour palettes.

Original work for this repository. Colour roles and hex values are facts of
the workbook convention (engines/design.md); the palette sets are composed
here so a workbook draws every colour from one module.

Usage:

    from templates.palettes import PALETTES, accent_series, series_colors

    colors = series_colors("navy", count=3)   # accent first, greys after
"""

from __future__ import annotations

# Each palette: (field, ink, support, accent). Roles from engines/design.md §1.
PALETTES: dict[str, dict[str, str]] = {
    "navy": {
        "field": "#F4F6F6",
        "ink": "#1C2833",
        "support": "#2E4053",
        "accent": "#1F6FEB",
    },
    "slate": {
        "field": "#FCFCFC",
        "ink": "#292929",
        "support": "#98ACB5",
        "accent": "#277884",
    },
    "forest": {
        "field": "#FCFCFC",
        "ink": "#191A19",
        "support": "#4E9F3D",
        "accent": "#1E5128",
    },
    "burgundy": {
        "field": "#FAF7F2",
        "ink": "#5D1D2E",
        "support": "#951233",
        "accent": "#C15937",
    },
    "sage": {
        "field": "#F4F1DE",
        "ink": "#2C2C2C",
        "support": "#87A96B",
        "accent": "#E07A5F",
    },
    "mono": {
        "field": "#FFFFFF",
        "ink": "#1A1A1A",
        "support": "#8A94A6",
        "accent": "#1A1A1A",
    },
}

# Greys that follow the accent for series 2..n. One accent, the rest quiet.
_SERIES_GREYS = ["#8A94A6", "#AAB7B8", "#C7CDD6", "#DFE3E9"]


def accent_series(palette: str, count: int) -> list[str]:
    """``count`` series colours: the accent first, greys after.

    The accent is reserved for the one series the claim is about; everything
    else is quiet so the emphasis survives (engines/chart.md §Encode).
    """
    roles = PALETTES.get(palette) or PALETTES["mono"]
    colors = [roles["accent"]]
    index = 0
    while len(colors) < max(count, 1):
        colors.append(_SERIES_GREYS[index % len(_SERIES_GREYS)])
        index += 1
    return colors[: max(count, 1)]


def series_colors(palette: str, count: int) -> list[str]:
    """Alias of accent_series, named for chart-building call sites."""
    return accent_series(palette, count)


def role_color(palette: str, role: str) -> str:
    """One role colour, e.g. ``role_color('navy', 'ink')``."""
    roles = PALETTES.get(palette) or PALETTES["mono"]
    return roles.get(role, roles["ink"])


def openpyxl_rgb(hex_color: str) -> str:
    """``#RRGGBB`` -> openpyxl ``FFRRGGBB`` (openpyxl wants the alpha prefix)."""
    cleaned = hex_color.lstrip("#").upper()
    return cleaned if len(cleaned) == 8 else f"FF{cleaned}"


def contrast_ink(palette: str, background_role: str = "field") -> str:
    """The ink colour that reads on a given background role.

    A dark field (support used as a fill) needs the light ink; everything
    else uses the palette's own ink.
    """
    roles = PALETTES.get(palette) or PALETTES["mono"]
    if background_role in {"support", "accent"}:
        return "#FFFFFF"
    return roles["ink"]


if __name__ == "__main__":  # pragma: no cover - manual smoke check
    print("palettes:", ", ".join(sorted(PALETTES)))
    print("navy series(4):", accent_series("navy", 4))
