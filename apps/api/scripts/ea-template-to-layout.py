#!/usr/bin/env python3
"""
Turn LHDN's Borang EA spreadsheet (C.P.8A) into the layout Kuwick's EA PDF draws.

    pip install openpyxl
    python3 apps/api/scripts/ea-template-to-layout.py \
        docs/templates/EA_Pin2017_1.xlsx apps/api/src/workforce/ea-layout/cp8a-pin2017.ts

Run it again when LHDN or the auditor issues a newer template, then point
`EA_LAYOUT` in ea-form-pdf.ts at the new file and check the field cells in
ea-form-pdf.ts still match. Only geometry and printed text are copied: column
widths, row heights, merged cells, borders, fills and fonts, in points.
"""
import json
import re
import sys
import zipfile

import openpyxl
from openpyxl.utils import get_column_letter, range_boundaries

SRC, OUT = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(SRC)
ws = wb.worksheets[0]

# The print area decides the page: rows and columns outside it are not drawn.
area = (ws.print_area or ws.dimensions).split("!")[-1].replace("$", "")
c1, r1, c2, r2 = range_boundaries(area)

# Theme colours, for the light-blue entry boxes ("theme 4 with a tint").
theme_xml = zipfile.ZipFile(SRC).read("xl/theme/theme1.xml").decode()
theme = re.findall(r'<a:(?:sysClr[^>]*lastClr|srgbClr val)="([0-9A-F]{6})"', theme_xml)
# Office order: dk1, lt1, dk2, lt2, accent1..6 -> theme index 0..9 (0/1 and 2/3 swap in Excel's indexing).
theme_index = {0: theme[1], 1: theme[0], 2: theme[3], 3: theme[2]}
for i in range(4, 10):
    theme_index[i] = theme[i]
INDEXED = {8: "000000", 9: "FFFFFF"}


def colour(c):
    if c is None:
        return None
    if c.type == "rgb" and isinstance(c.rgb, str):
        return c.rgb[-6:]
    if c.type == "indexed":
        return INDEXED.get(c.indexed)
    if c.type == "theme":
        base = theme_index.get(c.theme, "000000")
        tint = c.tint or 0
        rgb = [int(base[i : i + 2], 16) for i in (0, 2, 4)]
        rgb = [round(v + (255 - v) * tint) if tint > 0 else round(v * (1 + tint)) for v in rgb]
        return "".join(f"{v:02X}" for v in rgb)
    return None


# Excel column width (characters of the default font) -> points. Calibri 11's
# digit is 7 px wide; px -> pt at 96 dpi is * 0.75.
def width_pt(chars):
    px = int(((256 * chars + int(128 / 7)) / 256) * 7)
    return px * 0.75


default_width = ws.sheet_format.defaultColWidth or 8.43
cols = {}
for dim in ws.column_dimensions.values():
    if dim.min and dim.width:
        for i in range(dim.min, dim.max + 1):
            cols[i] = dim.width
col_widths = [round(width_pt(cols.get(i, default_width)), 2) for i in range(c1, c2 + 1)]
default_height = ws.sheet_format.defaultRowHeight or 15
row_heights = [ws.row_dimensions[r].height or default_height for r in range(r1, r2 + 1)]

merged = {}
for rng in ws.merged_cells.ranges:
    merged[(rng.min_row, rng.min_col)] = (rng.max_row, rng.max_col)
covered = {(r, c) for (rr, cc), (r2_, c2_) in merged.items() for r in range(rr, r2_ + 1) for c in range(cc, c2_ + 1) if (r, c) != (rr, cc)}

cells, borders = [], []
for r in range(r1, r2 + 1):
    for c in range(c1, c2 + 1):
        cell = ws.cell(r, c)
        sides = {}
        for side in ("left", "right", "top", "bottom"):
            s = getattr(cell.border, side)
            if s is not None and s.style:
                sides[side] = s.style
        # Inside a merged box Excel draws only the box's outline, whatever the
        # first cell stores; drop the sides that fall inside the box.
        for (mr, mc), (mr2, mc2) in merged.items():
            if mr <= r <= mr2 and mc <= c <= mc2:
                if c > mc:
                    sides.pop("left", None)
                if c < mc2:
                    sides.pop("right", None)
                if r > mr:
                    sides.pop("top", None)
                if r < mr2:
                    sides.pop("bottom", None)
                break
        if sides:
            borders.append({"r": r - r1, "c": c - c1, **sides})
        if (r, c) in covered:
            continue
        fill = colour(cell.fill.fgColor) if cell.fill is not None and cell.fill.fill_type == "solid" else None
        if cell.value is None and not fill:
            continue
        end = merged.get((r, c), (r, c))
        cells.append(
            {
                "ref": f"{get_column_letter(c)}{r}",
                "r": r - r1,
                "c": c - c1,
                "r2": end[0] - r1,
                "c2": end[1] - c1,
                "text": None if cell.value is None else str(cell.value).rstrip(),
                "size": cell.font.sz or 11,
                "bold": bool(cell.font.b),
                "color": colour(cell.font.color) if cell.font.color is not None else None,
                "fill": fill,
                "h": cell.alignment.horizontal,
                "v": cell.alignment.vertical,
                "wrap": bool(cell.alignment.wrap_text),
            }
        )

margins = ws.page_margins
layout = {
    "source": SRC.split("/")[-1],
    "sheet": ws.title,
    "paper": "A4" if ws.page_setup.paperSize in (9, "9") else str(ws.page_setup.paperSize),
    "marginsPt": {k: round((getattr(margins, k) or 0) * 72, 2) for k in ("left", "right", "top", "bottom")},
    "scale": (ws.page_setup.scale or 100) / 100,
    "colWidthsPt": col_widths,
    "rowHeightsPt": row_heights,
    "cells": cells,
    "borders": borders,
}
with open(OUT, "w") as f:
    # A TypeScript module, so the API build carries it like any other source file.
    f.write(f"// Generated from docs/templates/{layout['source']} by apps/api/scripts/ea-template-to-layout.py. Do not edit by hand.\n")
    f.write("export const LAYOUT = " + json.dumps(layout, separators=(",", ":")) + " as const;\n")
print(f"{OUT}: {len(col_widths)} columns, {len(row_heights)} rows, {len(cells)} cells, {len(borders)} bordered cells")
