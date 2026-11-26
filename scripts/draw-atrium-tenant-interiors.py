#!/usr/bin/env python3
"""商業アトリウム1階テナント内装図面のPDF作図。

Run from the repository root with the design JSON and an output PDF path.
The drawing set uses vector paths and searchable text.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas


PAGE_W, PAGE_H = landscape(A3)
MARGIN = 13 * mm
HEADER_H = 15 * mm
FOOTER_H = 8 * mm

INK = HexColor("#252b2d")
MID = HexColor("#5c6669")
LIGHT = HexColor("#d9ddda")
GRID = HexColor("#b9c1bf")
PAPER = HexColor("#fbfcfa")
FLOOR = HexColor("#eef1ed")
WALL = HexColor("#535d5d")
GLASS = HexColor("#6ca8ad")
DOOR = HexColor("#b7644d")
ROUTE = HexColor("#b33d38")
LIGHTING = HexColor("#d89b36")
ACCENT = HexColor("#355f70")
GREEN = HexColor("#64816d")
WOOD = HexColor("#c4a17c")
BLACK = HexColor("#303336")
REPRESENTATIVE_BAYS = {"L1", "L2", "R1", "R2"}


def register_japanese_font() -> str:
    """Register a font covering Japanese, with a portable CID fallback."""

    font_name = "AtriumJapanese"
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
    ]
    for candidate in candidates:
        if not os.path.exists(candidate):
            continue
        try:
            pdfmetrics.registerFont(TTFont(font_name, candidate, subfontIndex=0))
            return font_name
        except Exception:
            pass
    pdfmetrics.registerFont(UnicodeCIDFont("HeiseiKakuGo-W5"))
    return "HeiseiKakuGo-W5"


FONT = register_japanese_font()


def num(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def fmt(value: Any, digits: int = 2) -> str:
    number = num(value)
    if abs(number - round(number)) < 10 ** (-(digits + 1)):
        return str(int(round(number)))
    return f"{number:.{digits}f}".rstrip("0").rstrip(".")


def stext(value: Any, fallback: str = "") -> str:
    if value is None:
        return fallback
    if isinstance(value, bool):
        return "有" if value else "無"
    return str(value)


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def pair(value: Any, default: Sequence[float] = (0.0, 0.0)) -> tuple[float, float]:
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)) and len(value) >= 2:
        return num(value[0], default[0]), num(value[1], default[1])
    return num(default[0]), num(default[1])


def rect4(value: Any) -> tuple[float, float, float, float] | None:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)) or len(value) < 4:
        return None
    return tuple(num(value[index]) for index in range(4))  # type: ignore[return-value]


def safe_json(path: Path) -> Mapping[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as stream:
            raw = json.load(stream)
    except FileNotFoundError as exc:
        raise SystemExit(f"入力JSONが見つかりません: {path}") from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(f"入力JSONを読めません: {path} ({exc.msg})") from exc
    if not isinstance(raw, Mapping):
        raise SystemExit("入力JSONの最上位はオブジェクトで指定してください")
    return raw


def normalize(raw: Mapping[str, Any]) -> dict[str, Any]:
    """Normalize grid-only and enriched production data to one drawing model."""

    common = dict(raw.get("common") or raw.get("site") or {})
    top_lighting = dict(raw.get("lighting") or {})
    source_bays = raw.get("bays") or raw.get("tenants") or raw.get("shops") or []
    bays: list[dict[str, Any]] = []
    for source in source_bays:
        if not isinstance(source, Mapping):
            continue
        bay = dict(source)
        bay["id"] = stext(bay.get("id"), f"B{len(bays) + 1}")
        bay["name"] = stext(bay.get("name"), bay["id"])
        side = stext(bay.get("side"), "west").lower()
        bay["side"] = side
        span = bay.get("span") or bay.get("range") or [0, num(bay.get("width"), 1)]
        if not isinstance(span, Sequence) or len(span) < 2:
            span = [0, num(bay.get("width"), 1)]
        bay["span"] = [num(span[0]), num(span[1])]
        bay["width"] = num(bay.get("w", bay.get("width", abs(bay["span"][1] - bay["span"][0]))), abs(bay["span"][1] - bay["span"][0]))
        if bay["width"] <= 0:
            bay["width"] = abs(bay["span"][1] - bay["span"][0]) or 1.0
        bay["depth"] = num(bay.get("d", bay.get("depth", 4.0)), 4.0)
        bay["height"] = num(bay.get("h", bay.get("height", bay.get("ceiling", 3.2))), 3.2)
        bay["ceiling"] = bay["height"]
        entry = bay.get("entry", [bay["width"] * 0.35, bay["width"] * 0.65, 0.0])
        if not isinstance(entry, Sequence) or len(entry) < 2:
            entry = [bay["width"] * 0.35, bay["width"] * 0.65, 0.0]
        bay["entry"] = [num(entry[0]), num(entry[1]), num(entry[2]) if len(entry) > 2 else 0.0]
        bay["clearWidth"] = num(bay.get("clearWidth", bay["entry"][1] - bay["entry"][0]), bay["entry"][1] - bay["entry"][0])
        bay["entryHeight"] = num(bay.get("entryHeight", bay["height"] * 0.8), bay["height"] * 0.8)
        bay["doorType"] = stext(bay.get("doorType"), "引違いガラス戸")
        bay["route"] = list(bay.get("route") or [])
        bay["fixtures"] = [dict(item) for item in (bay.get("fixtures") or []) if isinstance(item, Mapping)]
        bay["frontage"] = [dict(item) for item in (bay.get("frontage") or []) if isinstance(item, Mapping)]
        bay["lighting"] = dict(bay.get("lighting") or {})
        # Production data keeps the区画別照明表 at the route root.  Preserve
        # that summary separately from any optional fixture-ID lighting map.
        summary = bay["lighting"] if any(key in bay["lighting"] for key in ("ambient", "accent", "cct", "aim")) else top_lighting.get(bay["id"], {})
        bay["_lighting_summary"] = dict(summary) if isinstance(summary, Mapping) else {}
        if any(key in bay["lighting"] for key in ("ambient", "accent", "cct", "aim")):
            bay["lighting"] = {}
        bay["islands"] = [dict(item) for item in (bay.get("islands") or []) if isinstance(item, Mapping)]
        bay["mounts"] = [dict(item) for item in (bay.get("mounts") or []) if isinstance(item, Mapping)]
        bay["lights"] = [dict(item) for item in (bay.get("lights") or []) if isinstance(item, Mapping)]
        bay["elevation"] = dict(bay.get("elevation") or {})
        bays.append(bay)
    return {
        "raw": raw,
        "common": common,
        "bays": bays,
        "islands": [dict(item) for item in (raw.get("islands") or []) if isinstance(item, Mapping)],
        "lighting": top_lighting,
        "title": stext(raw.get("name"), "商業アトリウム 1階テナント内装"),
    }


def bay_sort_key(bay: Mapping[str, Any]) -> tuple[int, float, str]:
    identifier = stext(bay.get("id"))
    order = {"L": 0, "R": 1, "F": 2}
    prefix = identifier[:1].upper()
    return order.get(prefix, 3), num((bay.get("span") or [0])[0]), identifier


def ordered_bays(model: Mapping[str, Any]) -> list[dict[str, Any]]:
    return sorted((dict(item) for item in model["bays"]), key=bay_sort_key)


def draw_text(c: Canvas, x: float, y: float, text: Any, size: float = 8, color: colors.Color = INK, align: str = "left", leading: float | None = None) -> None:
    value = stext(text)
    c.setFont(FONT, size)
    c.setFillColor(color)
    if align == "right":
        c.drawRightString(x, y, value)
    elif align == "center":
        c.drawCentredString(x, y, value)
    else:
        c.drawString(x, y, value)


def text_width(text: Any, size: float) -> float:
    return pdfmetrics.stringWidth(stext(text), FONT, size)


def wrap_text(text: Any, max_width: float, size: float = 7.5, max_lines: int = 4) -> list[str]:
    value = stext(text)
    if not value:
        return []
    # Japanese can wrap at every character.  ASCII words are kept together
    # where possible so specifications remain legible.
    lines: list[str] = []
    for paragraph in value.splitlines() or [""]:
        current = ""
        for char in paragraph:
            candidate = current + char
            if current and text_width(candidate, size) > max_width:
                lines.append(current)
                current = char
            else:
                current = candidate
        lines.append(current)
    if len(lines) <= max_lines:
        return lines
    lines = lines[:max_lines]
    last = lines[-1]
    while last and text_width(last + "…", size) > max_width:
        last = last[:-1]
    lines[-1] = last + "…"
    return lines


def draw_wrapped(c: Canvas, x: float, y: float, text: Any, max_width: float, size: float = 7.5, leading: float | None = None, max_lines: int = 4, color: colors.Color = INK) -> float:
    line_height = leading or size * 1.35
    for index, line in enumerate(wrap_text(text, max_width, size, max_lines)):
        draw_text(c, x, y - index * line_height, line, size, color)
    return y - line_height * len(wrap_text(text, max_width, size, max_lines))


def line(c: Canvas, x1: float, y1: float, x2: float, y2: float, color: colors.Color = INK, width: float = 0.6, dash: Sequence[float] | None = None) -> None:
    c.setStrokeColor(color)
    c.setLineWidth(width)
    if dash:
        c.setDash(*dash)
    else:
        c.setDash()
    c.line(x1, y1, x2, y2)
    c.setDash()


def rect(c: Canvas, x: float, y: float, width: float, height: float, stroke: colors.Color = INK, fill: colors.Color | None = None, line_width: float = 0.6, dash: Sequence[float] | None = None) -> None:
    c.setStrokeColor(stroke)
    c.setLineWidth(line_width)
    if fill is not None:
        c.setFillColor(fill)
    if dash:
        c.setDash(*dash)
    else:
        c.setDash()
    c.rect(x, y, width, height, stroke=1 if stroke is not None else 0, fill=1 if fill is not None else 0)
    c.setDash()


def arrow(c: Canvas, x1: float, y1: float, x2: float, y2: float, color: colors.Color = INK, width: float = 0.6, head: float = 4.0) -> None:
    line(c, x1, y1, x2, y2, color, width)
    angle = math.atan2(y2 - y1, x2 - x1)
    for offset in (math.pi * 0.82, -math.pi * 0.82):
        line(c, x2, y2, x2 + math.cos(angle + offset) * head, y2 + math.sin(angle + offset) * head, color, width)


def polyline(c: Canvas, points: Sequence[tuple[float, float]], color: colors.Color = INK, width: float = 0.7, dash: Sequence[float] | None = None, arrows: bool = False) -> None:
    if len(points) < 2:
        return
    c.setStrokeColor(color)
    c.setLineWidth(width)
    if dash:
        c.setDash(*dash)
    else:
        c.setDash()
    path = c.beginPath()
    path.moveTo(*points[0])
    for point in points[1:]:
        path.lineTo(*point)
    c.drawPath(path, stroke=1, fill=0)
    c.setDash()
    if arrows:
        for first, second in zip(points[:-1], points[1:]):
            if math.hypot(second[0] - first[0], second[1] - first[1]) > 12:
                arrow(c, first[0] * .45 + second[0] * .55, first[1] * .45 + second[1] * .55, second[0], second[1], color, width, 3.5)
                break


def dim_h(c: Canvas, x1: float, x2: float, y: float, label: str, ext_y: float | None = None, color: colors.Color = MID) -> None:
    if ext_y is not None:
        line(c, x1, ext_y, x1, y, color, 0.35)
        line(c, x2, ext_y, x2, y, color, 0.35)
    line(c, x1, y, x2, y, color, 0.4)
    arrow(c, x1, y, x1 + min(4, abs(x2 - x1) * .15), y, color, 0.4, 2.5)
    arrow(c, x2, y, x2 - min(4, abs(x2 - x1) * .15), y, color, 0.4, 2.5)
    draw_text(c, (x1 + x2) / 2, y + 2, label, 6.5, color, "center")


def dim_v(c: Canvas, y1: float, y2: float, x: float, label: str, ext_x: float | None = None, color: colors.Color = MID) -> None:
    if ext_x is not None:
        line(c, ext_x, y1, x, y1, color, 0.35)
        line(c, ext_x, y2, x, y2, color, 0.35)
    line(c, x, y1, x, y2, color, 0.4)
    arrow(c, x, y1, x, y1 + min(4, abs(y2 - y1) * .15), color, 0.4, 2.5)
    arrow(c, x, y2, x, y2 - min(4, abs(y2 - y1) * .15), color, 0.4, 2.5)
    c.saveState()
    c.translate(x + 5.5, (y1 + y2) / 2)
    c.rotate(90)
    draw_text(c, 0, 0, label, 6.5, color, "center")
    c.restoreState()


def scale_bar(c: Canvas, x: float, y: float, scale: float, metres: float = 5.0) -> None:
    length = metres * scale
    half = length / 2
    rect(c, x, y, half, 3.5, stroke=INK, fill=INK, line_width=.35)
    rect(c, x + half, y, half, 3.5, stroke=INK, fill=PAPER, line_width=.35)
    draw_text(c, x, y - 8, "0", 6, MID)
    draw_text(c, x + length, y - 8, f"{fmt(metres)} m", 6, MID, "right")
    draw_text(c, x + length / 2, y + 6, f"1:{fmt(1000 * mm / scale, 1)}", 6, MID, "center")


def north_arrow(c: Canvas, x: float, y: float, size: float = 22) -> None:
    # The overall plan places +s on the horizontal long edge of the A3 sheet.
    arrow(c, x, y, x + size, y, INK, 1.0, 5)
    draw_text(c, x + size / 2, y + 8, "+s  奥", 7, INK, "center")


def draw_header(c: Canvas, title: str, sheet_id: str, subtitle: str, index: int, total: int) -> tuple[float, float, float, float]:
    rect(c, 0, 0, PAGE_W, PAGE_H, stroke=PAPER, fill=PAPER, line_width=0)
    line(c, MARGIN, PAGE_H - HEADER_H, PAGE_W - MARGIN, PAGE_H - HEADER_H, INK, 1.0)
    draw_text(c, MARGIN, PAGE_H - 10.2 * mm, title, 15, INK)
    draw_text(c, MARGIN, PAGE_H - 14.1 * mm, subtitle, 7.2, MID)
    draw_text(c, PAGE_W - MARGIN, PAGE_H - 10.2 * mm, sheet_id, 11, INK, "right")
    draw_text(c, PAGE_W - MARGIN, PAGE_H - 14.1 * mm, "A3 横 / 1階内装設計", 7.2, MID, "right")
    plot_x = MARGIN
    plot_y = FOOTER_H + 5 * mm
    plot_w = PAGE_W - 2 * MARGIN
    plot_h = PAGE_H - HEADER_H - FOOTER_H - 10 * mm
    line(c, MARGIN, FOOTER_H, PAGE_W - MARGIN, FOOTER_H, INK, .65)
    draw_text(c, MARGIN, 3.4 * mm, "LUMEN PILGRIMAGE / 商業アトリウム設計資料", 6.5, MID)
    draw_text(c, PAGE_W / 2, 3.4 * mm, "図面は入力JSONの寸法・座標から生成 / 写真参照は未組込", 6.5, MID, "center")
    draw_text(c, PAGE_W - MARGIN, 3.4 * mm, f"SHEET {index:02d} / {total:02d}", 6.5, MID, "right")
    return plot_x, plot_y, plot_w, plot_h


def label_box(c: Canvas, x: float, y: float, width: float, height: float, title: str, body: str = "", fill: colors.Color = PAPER, text_size: float = 6.8, max_lines: int = 6) -> None:
    rect(c, x, y, width, height, stroke=GRID, fill=fill, line_width=.45)
    draw_text(c, x + 5, y + height - 12, title, 7.5, INK)
    if body:
        draw_wrapped(c, x + 5, y + height - 24, body, width - 10, text_size, max_lines=max_lines, color=MID)


def common_value(model: Mapping[str, Any], key: str, fallback: Any = None) -> Any:
    return (model.get("common") or {}).get(key, fallback)


def world_rect(bay: Mapping[str, Any], common: Mapping[str, Any]) -> tuple[float, float, float, float]:
    side = stext(bay.get("side"), "west").lower()
    span = bay.get("span") or [0, num(bay.get("width"), 1)]
    depth = num(bay.get("depth"), 4)
    if side in ("west", "left", "l"):
        x0 = -num(common.get("halfWidth"), 11.4)
        return x0 - depth, num(span[0]), x0, num(span[1])
    if side in ("east", "right", "r"):
        x0 = num(common.get("halfWidth"), 11.4)
        return x0, num(span[0]), x0 + depth, num(span[1])
    plane = num(bay.get("plane"), num(common.get("rearS"), 60))
    return num(span[0]), plane, num(span[1]), plane + depth


def side_frontage(bay: Mapping[str, Any]) -> list[dict[str, Any]]:
    frontage = [dict(item) for item in (bay.get("frontage") or []) if isinstance(item, Mapping)]
    if frontage:
        return frontage
    width = num(bay.get("width"), 1)
    entry = bay.get("entry") or [width * .35, width * .65]
    u0, u1 = num(entry[0]), num(entry[1])
    result: list[dict[str, Any]] = []
    if u0 > 0:
        result.append({"u": [0, u0], "kind": "glass", "detail": "ショーウィンドウ"})
    result.append({"u": [u0, u1], "kind": "door", "detail": stext(bay.get("doorType"), "入口")})
    if u1 < width:
        result.append({"u": [u1, width], "kind": "glass", "detail": "ショーウィンドウ"})
    return result


def frontage_code(kind: Any) -> str:
    """Return the compact drawing key used on frontage geometry.

    Full ``detail`` prose belongs in the note panel.  Keeping only this short
    key on the linework prevents the long Japanese specifications from
    colliding with dimensions and neighboring storefronts.
    """

    return {
        "glass": "GL",
        "door": "DR",
        "wall": "WL",
        "open": "OP",
    }.get(stext(kind, "wall").lower(), "FR")


def compact_id(value: Any) -> str:
    """Use the sheet-local suffix for compact section/elevation callouts."""

    text = stext(value)
    return text.rsplit("-", 1)[-1] if "-" in text else text


def local_island(bay: Mapping[str, Any], island: Mapping[str, Any], common: Mapping[str, Any]) -> tuple[float, float, float, float] | None:
    size = island.get("size") or island.get("rect")
    if not isinstance(size, Sequence) or len(size) < 2:
        return None
    width, depth = num(size[0]), num(size[1])
    center = island.get("center") or island.get("position")
    if not isinstance(center, Sequence) or len(center) < 2:
        return None
    cx, cy = num(center[0]), num(center[1])
    if 0 <= cx <= num(bay.get("width"), 0) and 0 <= cy <= num(bay.get("depth"), 0):
        return cx, cy, width, depth
    side = stext(bay.get("side"), "west").lower()
    span = bay.get("span") or [0, num(bay.get("width"), 0)]
    s0 = num(span[0])
    if side in ("west", "left", "l", "east", "right", "r"):
        front_x = -num(common.get("halfWidth"), 11.4) if side in ("west", "left", "l") else num(common.get("halfWidth"), 11.4)
        return cx - s0 if side in ("west", "left", "l") else cx - s0, abs(cy - front_x), width, depth
    plane = num(bay.get("plane"), num(common.get("rearS"), 60))
    return cx - num(span[0]), cy - plane, width, depth


def draw_frontage_plan(c: Canvas, bay: Mapping[str, Any], x: float, y: float, scale: float) -> None:
    for segment in side_frontage(bay):
        u = segment.get("u") or [0, 0]
        u0, u1 = num(u[0]), num(u[1])
        kind = stext(segment.get("kind"), "wall").lower()
        color = GLASS if kind == "glass" else DOOR if kind == "door" else GREEN if kind == "open" else WALL
        line_width = 1.1 if kind in ("wall", "door") else .75
        line(c, x + u0 * scale, y, x + u1 * scale, y, color, line_width)
        if kind in ("door", "open"):
            left, right = x + u0 * scale, x + u1 * scale
            entry = bay.get("entry") or [u0, u1, 0]
            recess = max(0.0, num(entry[2]) if len(entry) > 2 else 0.0)
            threshold_y = y + recess * scale
            if recess > 0:
                line(c, left, y, left, threshold_y, color, .6)
                line(c, right, y, right, threshold_y, color, .6)
                line(c, left, threshold_y, right, threshold_y, color, .75)
            if kind == "door":
                mid = (left + right) / 2
                offset = (right - left) * .32
                if "片引き" in stext(bay.get("doorType")):
                    line(c, mid - offset, threshold_y + 3, mid + offset, threshold_y + 3, DOOR, .65)
                else:
                    arrow(c, mid - 2, threshold_y + 3, mid - offset, threshold_y + 3, DOOR, .65, 2)
                    arrow(c, mid + 2, threshold_y + 3, mid + offset, threshold_y + 3, DOOR, .65, 2)
        # Geometry carries a compact key; the full finish specification is
        # moved to the separate note panel on each tenant sheet.
        draw_text(c, x + (u0 + u1) * scale / 2, y + 4, frontage_code(kind), 5.4, color, "center")


def fixture_fill(kind: str) -> colors.Color:
    text = kind.lower()
    if any(token in text for token in ("rack", "hanger", "衣", "棚")):
        return WOOD
    if any(token in text for token in ("counter", "レジ", "カウンター")):
        return HexColor("#d3b7a0")
    if any(token in text for token in ("case", "display", "展示", "什器")):
        return HexColor("#b6cdd0")
    if any(token in text for token in ("plant", "植栽")):
        return HexColor("#b3c7a5")
    if any(token in text for token in ("seat", "table", "椅子", "テーブル")):
        return HexColor("#d6d0be")
    return HexColor("#c8ced0")


def draw_fixture_plan(c: Canvas, citem: Mapping[str, Any], x: float, y: float, scale: float) -> tuple[float, float, float, float] | None:
    bounds = rect4(citem.get("rect"))
    if bounds is None:
        return None
    u, d, width, depth = bounds
    kind = stext(citem.get("type"), "器具")
    rect(c, x + u * scale, y + d * scale, width * scale, depth * scale, stroke=ACCENT, fill=fixture_fill(kind), line_width=.55)
    label = stext(citem.get("label"), stext(citem.get("id"), kind))
    if width * scale > 24 and depth * scale > 12:
        draw_wrapped(c, x + (u + width / 2) * scale, y + (d + depth / 2) * scale + 2, label, width * scale - 4, 5.4, leading=6, max_lines=2, color=INK)
    return bounds


def route_points(bay: Mapping[str, Any]) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    for item in bay.get("route") or []:
        if isinstance(item, Sequence) and len(item) >= 2:
            points.append((num(item[0]), num(item[1])))
    if points:
        return points
    width, depth = num(bay.get("width"), 1), num(bay.get("depth"), 1)
    entry = bay.get("entry") or [width * .35, width * .65]
    return [((num(entry[0]) + num(entry[1])) / 2, 0.15), (width * .5, max(.2, depth - .25))]


def light_center(item: Mapping[str, Any], bounds: tuple[float, float, float, float] | None) -> tuple[float, float] | None:
    if bounds is None:
        return None
    u, d, width, depth = bounds
    return u + width / 2, d + depth / 2


def draw_light_symbol(c: Canvas, x: float, y: float, label: str, accent: bool = False) -> None:
    c.setStrokeColor(LIGHTING if not accent else ACCENT)
    c.setFillColor(PAPER)
    c.setLineWidth(.7)
    c.circle(x, y, 3.1, stroke=1, fill=1)
    line(c, x - 2.0, y - 2.0, x + 2.0, y + 2.0, LIGHTING if not accent else ACCENT, .6)
    if label:
        draw_text(c, x + 5, y - 2, label, 5.8, LIGHTING if not accent else ACCENT)


def side_note(bay: Mapping[str, Any]) -> str:
    side = stext(bay.get("side"), "west").lower()
    return "u → s増加 / d → 店内" if side in ("west", "east", "left", "right", "l", "r") else "u → 世界x増加 / d → s増加"


def draw_bay_plan(c: Canvas, bay: Mapping[str, Any], common: Mapping[str, Any], px: float, py: float, pw: float, ph: float) -> None:
    width = num(bay.get("width"), 1)
    depth = num(bay.get("depth"), 1)
    scale = min((pw - 64) / width, (ph - 95) / depth)
    origin_x = px + 32
    origin_y = py + 56
    rect(c, origin_x, origin_y, width * scale, depth * scale, stroke=INK, fill=FLOOR, line_width=.8)
    # Back wall and dimension frames.
    line(c, origin_x, origin_y + depth * scale, origin_x + width * scale, origin_y + depth * scale, WALL, 1.8)
    draw_frontage_plan(c, bay, origin_x, origin_y, scale)
    entry = bay.get("entry") or [width * .35, width * .65, 0]
    entry_u0, entry_u1 = num(entry[0]), num(entry[1])
    dim_h(c, origin_x + entry_u0 * scale, origin_x + entry_u1 * scale, origin_y - 10, f"有効 {fmt(entry_u1 - entry_u0)} m", origin_y)
    recess = max(0.0, num(entry[2]) if len(entry) > 2 else 0.0)
    if recess > 0.01:
        dim_v(c, origin_y, origin_y + recess * scale, origin_x + entry_u1 * scale + 9, f"引込 {fmt(recess)}", origin_x + entry_u1 * scale)
    for fixture in bay.get("fixtures") or []:
        draw_fixture_plan(c, fixture, origin_x, origin_y, scale)
    for mount in bay.get("mounts") or []:
        bounds = rect4(mount.get("rect"))
        if bounds is None:
            continue
        u, d, mount_w, mount_depth = bounds
        kind = stext(mount.get("kind"), "吊り")
        rect(c, origin_x + u * scale, origin_y + d * scale, mount_w * scale, mount_depth * scale, stroke=ACCENT, fill=HexColor("#d5e0e5"), line_width=.7, dash=[3, 2])
        # Long mount descriptions are kept in the schedule/specification;
        # only the stable drawing ID is placed inside the plan geometry.
        draw_text(c, origin_x + (u + mount_w / 2) * scale, origin_y + (d + mount_depth / 2) * scale, compact_id(mount.get("id")) or kind, 5.2, ACCENT, "center")
    for light in bay.get("lights") or []:
        center = light.get("center") or [light.get("u"), light.get("d")]
        if not isinstance(center, Sequence) or len(center) < 2 or center[0] is None or center[1] is None:
            continue
        lu, ld = num(center[0]), num(center[1])
        draw_light_symbol(c, origin_x + lu * scale, origin_y + ld * scale, stext(light.get("id")), stext(light.get("kind")).lower() in ("accent", "spot", "縦光"))
    for island in bay.get("islands") or []:
        bounds = local_island(bay, island, common)
        if bounds:
            u, d, w, l = bounds
            rect(c, origin_x + u * scale, origin_y + d * scale, w * scale, l * scale, stroke=GREEN, fill=HexColor("#d8e4d8"), line_width=.55)
            draw_text(c, origin_x + (u + w / 2) * scale, origin_y + (d + l / 2) * scale, stext(island.get("label"), stext(island.get("id"), "島什器")), 5.6, GREEN, "center")
    points = route_points(bay)
    polyline(c, [(origin_x + u * scale, origin_y + d * scale) for u, d in points], ROUTE, 1.15, [4, 3], True)
    for index, (u, d) in enumerate(points):
        c.setFillColor(ROUTE)
        c.circle(origin_x + u * scale, origin_y + d * scale, 1.8, stroke=0, fill=1)
        if index == 0:
            draw_text(c, origin_x + u * scale + 4, origin_y + d * scale + 2, "入口", 5.6, ROUTE)
    light_items: dict[str, tuple[float, float]] = {}
    for fixture in bay.get("fixtures") or []:
        bounds = rect4(fixture.get("rect"))
        center = light_center(fixture, bounds)
        if center:
            identifier = stext(fixture.get("id"))
            lighting = bay.get("lighting", {}).get(identifier, {})
            if lighting:
                light_items[identifier] = center
    for identifier, (u, d) in light_items.items():
        info = bay.get("lighting", {}).get(identifier, {})
        draw_light_symbol(c, origin_x + u * scale, origin_y + d * scale, identifier, bool(num(info.get("accent"), 0)))
    if bay.get("id") in REPRESENTATIVE_BAYS:
        cut_x = origin_x + (entry_u0 + entry_u1) * scale / 2
        cut_top = origin_y + depth * scale
        line(c, cut_x, origin_y, cut_x, cut_top, ACCENT, .5, [3, 3])
        draw_text(c, cut_x + 5, cut_top + 3, "A", 7, ACCENT)
        draw_text(c, cut_x + 5, origin_y - 16, "A", 7, ACCENT)
    dim_h(c, origin_x, origin_x + width * scale, origin_y - 23, f"W {fmt(width)} m", origin_y)
    dim_v(c, origin_y, origin_y + depth * scale, origin_x - 22, f"D {fmt(depth)} m", origin_x)
    draw_text(c, origin_x, origin_y + depth * scale + 12, "平面図  1階 / 室内側", 8.5, INK)
    draw_text(c, origin_x + width * scale, origin_y + depth * scale + 12, side_note(bay), 6.4, MID, "right")
    scale_bar(c, origin_x, origin_y - 43, scale, 1 if scale > 28 else 2)


def draw_bay_notes(c: Canvas, bay: Mapping[str, Any], px: float, py: float, pw: float, ph: float) -> None:
    width = num(bay["width"])
    depth = num(bay["depth"])
    note_w = (pw - 24) / 3
    label_box(c, px, py, note_w, ph, "計画諸元", "")
    rows = [
        ("区画", f"{stext(bay.get('id'))}  {stext(bay.get('name'))}"),
        ("面積", f"{fmt(width * depth)} m2  (W {fmt(width)} x D {fmt(depth)})"),
        ("天井高", f"{fmt(num(bay.get('height'), 3.2))} m"),
        ("入口", f"内法 {fmt(bay['entry'][1] - bay['entry'][0])} × {fmt(bay['entryHeight'])} m"),
        ("建具", bay["doorType"]),
        ("主通路", f"{fmt(num(bay.get('clearWidth'), 1.2))} m"),
        ("動線", "主通路中心線を赤破線で表示"),
    ]
    row_y = py + ph - 29
    for label, value in rows:
        draw_text(c, px + 8, row_y, label, 8, MID)
        draw_wrapped(c, px + 55, row_y, value, note_w - 63, 8, max_lines=2)
        row_y -= 14
    lighting_rows = []
    summary = bay.get("_lighting_summary") or {}
    if isinstance(summary, Mapping) and summary:
        cct = stext(summary.get("cct"), "-")
        if cct != "-" and not cct.upper().endswith("K"):
            cct += "K"
        lighting_rows.append(f"区画照明: {stext(summary.get('ambient'), '-')} / {stext(summary.get('accent'), '-')} / {cct} / {stext(summary.get('aim'), '-')}")
    for identifier, info in (bay.get("lighting") or {}).items():
        if isinstance(info, Mapping):
            cct = stext(info.get("cct"), "-")
            if cct != "-" and not cct.upper().endswith("K"):
                cct += "K"
            lighting_rows.append(f"{identifier}: {stext(info.get('ambient'), '-')} / {stext(info.get('accent'), '-')} / {cct} / {stext(info.get('aim'), '-')}")
    label_box(c, px + note_w + 12, py, note_w, ph, "照明", "\n".join(lighting_rows), text_size=8, max_lines=9)
    finish_notes = []
    for segment in side_frontage(bay):
        detail = stext(segment.get("detail"))
        if detail:
            finish_notes.append(f"{frontage_code(segment.get('kind'))}: {detail}")
    finish_body = "GL=ガラス / DR=入口 / WL=壁 / OP=開口\n" + "\n".join(finish_notes)
    label_box(c, px + 2 * (note_w + 12), py, note_w, ph, "正面仕上ノート", finish_body, HexColor("#f4f6f2"), text_size=7.5, max_lines=10)


def draw_bay_elevation(c: Canvas, bay: Mapping[str, Any], x: float, y: float, width: float, height: float) -> None:
    bay_w = num(bay.get("width"), 1)
    bay_h = num(bay.get("height"), 3.2)
    elevation = bay.get("elevation") or {}
    bands = [item for item in (elevation.get("bands") or []) if isinstance(item, Mapping)]
    band_high = max((num(item.get("high")) for item in bands), default=bay_h)
    portal_head = num(elevation.get("portalHead"), band_high)
    plot_h = max(bay_h, band_high, portal_head, 3.2)
    scale = min((width - 55) / bay_w, (height - 87) / plot_h)
    origin_x = x + 20
    origin_y = y + 60
    east_frontage = bay.get("side") in ("east", "right")

    def screen_u(u: float) -> float:
        return origin_x + (bay_w - u if east_frontage else u) * scale

    rect(c, origin_x, origin_y, bay_w * scale, plot_h * scale, stroke=INK, fill=PAPER, line_width=.8)

    # Projected fixtures are drawn first, from back to front.  A light
    # silhouette keeps the storefront readable when glazing is overlaid.
    fixture_items = []
    for fixture in bay.get("fixtures") or []:
        bounds = rect4(fixture.get("rect"))
        if bounds is not None:
            fixture_items.append((bounds[1], fixture, bounds))
    for _d, fixture, bounds in sorted(fixture_items, key=lambda item: item[0], reverse=True):
        u, _d, fw, _fd = bounds
        fh = num(fixture.get("height"), .95)
        if fw * scale <= 4 or fh * scale <= 4:
            continue
        kind = stext(fixture.get("type"), "器具").lower()
        stroke = WALL if kind == "wall" else ACCENT
        fill = HexColor("#fafaf7") if kind == "wall" else HexColor("#eef2ef")
        rect(c, min(screen_u(u), screen_u(u + fw)), origin_y, fw * scale, min(fh, bay_h) * scale, stroke=stroke, fill=fill, line_width=.45)
        if fw * scale > 22 and fh * scale > 16:
            draw_text(c, screen_u(u + fw / 2), origin_y + min(fh, bay_h) * scale + 3, compact_id(fixture.get("id")), 4.8, stroke, "center")

    # Hanging elements share the same depth-first ordering and remain visible
    # above the pale fixture silhouettes.
    for mount in bay.get("mounts") or []:
        bounds = rect4(mount.get("rect"))
        if bounds is None:
            continue
        u, _d, mount_w, _mount_depth = bounds
        bottom = clamp(num(mount.get("bottom"), bay_h - .5), 0, plot_h)
        top = clamp(num(mount.get("top"), bottom + .2), bottom + .04, plot_h)
        rect(c, min(screen_u(u), screen_u(u + mount_w)), origin_y + bottom * scale, mount_w * scale, (top - bottom) * scale,
             stroke=ACCENT, fill=HexColor("#f1f5f1"), line_width=.45, dash=[3, 2])
        if mount_w * scale > 18:
            draw_text(c, screen_u(u + mount_w / 2), origin_y + top * scale + 2,
                      compact_id(mount.get("id")) or "M", 4.8, ACCENT, "center")

    # Storefront base linework follows the interior silhouettes.  Glazing is
    # deliberately unfilled so the rear fixtures remain legible through it.
    for segment in side_frontage(bay):
        u = segment.get("u") or [0, 0]
        u0, u1 = num(u[0]), num(u[1])
        left, right = sorted((screen_u(u0), screen_u(u1)))
        kind = stext(segment.get("kind"), "wall").lower()
        color = GLASS if kind == "glass" else DOOR if kind == "door" else GREEN if kind == "open" else WALL
        if kind == "glass":
            rect(c, left, origin_y, right - left, bay_h * scale, stroke=color, fill=None, line_width=.6)
        elif kind in ("door", "open"):
            rect(c, left, origin_y, right - left, num(bay["entryHeight"]) * scale, stroke=color, fill=None, line_width=.75)
        else:
            line(c, left, origin_y, right, origin_y, color, 1.5)
        draw_text(c, (left + right) / 2, origin_y - 12, frontage_code(kind), 6, color, "center")
    line(c, origin_x, origin_y + bay_h * scale, origin_x + bay_w * scale, origin_y + bay_h * scale, WALL, 1.2)
    # Continuous sign/light band is kept visible even when the frontage is
    # mostly glass.  It is a shared façade reference, not a decorative photo.
    sign_h = min(.32, bay_h * .14)
    sign_y = max(num(bay.get("entryHeight"), bay_h * .8) + .08, bay_h - .48)
    rect(c, origin_x, origin_y + sign_y * scale, bay_w * scale, sign_h * scale, stroke=WALL, fill=HexColor("#d5d9d4"), line_width=.45)
    line(c, origin_x + 2, origin_y + (sign_y - .055) * scale, origin_x + bay_w * scale - 2, origin_y + (sign_y - .055) * scale, LIGHTING, .85)
    draw_text(c, origin_x + bay_w * scale / 2, origin_y + (sign_y + sign_h * .34) * scale, "看板帯 / 間接光", 5.7, MID, "center")
    band_colors = {
        "warm": HexColor("#e4b27b"), "dark": HexColor("#4a4b4c"),
        "light": HexColor("#e9ece8"), "wood": HexColor("#bd9a70"),
        "stone": HexColor("#c7c5bc"), "plant": HexColor("#b4c8a9"),
    }
    for band in bands:
        low = clamp(num(band.get("low")), 0, plot_h)
        high = clamp(num(band.get("high"), low + .1), low + .02, plot_h)
        kind = stext(band.get("kind"), "light").lower()
        fill = band_colors.get(kind, HexColor("#d9ddda"))
        rect(c, origin_x, origin_y + low * scale, bay_w * scale, (high - low) * scale, stroke=fill, fill=fill, line_width=.45)
        draw_text(c, origin_x + bay_w * scale / 2, origin_y + (low + high) * scale / 2 - 2, stext(band.get("label"), kind), 5.2, BLACK if kind != "dark" else PAPER, "center")

    # Final overlay: glazing joints, entry outlines and representative light
    # lines are the foreground reading of the elevation.
    for segment in side_frontage(bay):
        u = segment.get("u") or [0, 0]
        u0, u1 = num(u[0]), num(u[1])
        left, right = sorted((screen_u(u0), screen_u(u1)))
        kind = stext(segment.get("kind"), "wall").lower()
        if kind == "glass":
            nominal_pitch = 1.35 if bay.get("id") == "R1" else .95
            panel_count = max(1, round((u1 - u0) / nominal_pitch))
            for index in range(1, panel_count):
                cursor = left + (right - left) * index / panel_count
                line(c, cursor, origin_y, cursor, origin_y + bay_h * scale, HexColor("#8fbabd"), .4)
        elif kind == "door" and ("両引き" in stext(bay.get("doorType")) or "引分け" in stext(bay.get("doorType"))):
            mid = (left + right) / 2
            line(c, mid, origin_y, mid, origin_y + num(bay["entryHeight"]) * scale, DOOR, .55)
    for light in bay.get("lights") or []:
        u = light.get("u")
        if u is None:
            center = light.get("center")
            u = center[0] if isinstance(center, Sequence) and center else None
        if u is None:
            continue
        u_px = screen_u(num(u))
        level = clamp(num(light.get("y"), bay_h - .12), .08, plot_h)
        kind = stext(light.get("kind")).lower()
        color = ACCENT if kind in ("accent", "spot", "wash", "縦光") else LIGHTING
        if kind in ("accent", "spot", "wash", "縦光"):
            line(c, u_px, origin_y + .06 * scale, u_px, origin_y + level * scale, color, .7)
        else:
            line(c, u_px - 3, origin_y + level * scale, u_px + 3, origin_y + level * scale, color, .7)
        draw_text(c, u_px + 3, origin_y + level * scale + 2, stext(light.get("id"), "L"), 4.8, color)
    if portal_head > bay_h + .02:
        line(c, origin_x, origin_y + portal_head * scale, origin_x + bay_w * scale, origin_y + portal_head * scale, ACCENT, .55, [3, 2])
        draw_text(c, origin_x + bay_w * scale + 4, origin_y + portal_head * scale - 2, f"portal +{fmt(portal_head)}", 5.5, ACCENT)
    dim_h(c, origin_x, origin_x + bay_w * scale, origin_y - 27, f"W {fmt(bay_w)} m", origin_y)
    dim_v(c, origin_y, origin_y + bay_h * scale, origin_x + bay_w * scale + 18, f"H {fmt(bay_h)} m", origin_x + bay_w * scale)
    draw_text(c, origin_x, origin_y + plot_h * scale + 11, "正面立面  共用通路から", 8.5, INK)
    draw_text(c, origin_x + bay_w * scale, origin_y + plot_h * scale + 11, "u減少 →" if east_frontage else "u増加 →", 6.5, MID, "right")
    scale_bar(c, origin_x, origin_y - 46, scale, 1 if scale > 28 else 2)


def draw_bay_sheet(c: Canvas, model: Mapping[str, Any], bay: Mapping[str, Any], index: int, total: int, sheet_id: str) -> None:
    px, py, pw, ph = draw_header(c, f"{stext(bay.get('id'))}  {stext(bay.get('name'))}", sheet_id, "テナント別平面図・正面立面 / 寸法単位 m", index, total)
    common = model.get("common") or {}
    plot_y = py + 158
    plot_h = ph - 175
    draw_bay_plan(c, bay, common, px, plot_y, pw * .49, plot_h)
    draw_bay_elevation(c, bay, px + pw * .51, plot_y + 85, pw * .48, plot_h - 85)
    draw_bay_notes(c, bay, px, py + 5, pw, 127)
    x0, s0, x1, s1 = world_rect(bay, common)
    location = (
        f"配置: {stext(bay.get('side'))} / 世界範囲 x {fmt(x0)} - {fmt(x1)}, s {fmt(s0)} - {fmt(s1)}"
        f"  |  FL±0 / 庇光帯下端 +{fmt(common.get('soffit', 4.03))} / 階上FL +{fmt(common.get('firstFloor', 4.55))}"
    )
    draw_text(c, px, py + 142, location, 8, MID)


def draw_section(c: Canvas, model: Mapping[str, Any], bay: Mapping[str, Any], index: int, total: int, sheet_id: str) -> None:
    px, py, pw, ph = draw_header(c, f"{stext(bay.get('id'))}  代表断面・入口詳細", sheet_id, "室内断面 / 入口の内法立面 / 寸法単位 m", index, total)
    depth = num(bay.get("depth"), 1)
    height = num(bay.get("height"), 3.2)
    entry_u0, entry_u1, recess = bay["entry"]
    entry_width = entry_u1 - entry_u0
    cut_u = (entry_u0 + entry_u1) / 2
    entry_h = num(bay["entryHeight"])
    open_entry = any(segment.get("kind") == "open" for segment in side_frontage(bay))
    common = model.get("common") or {}
    soffit = num(common.get("soffit"), 4.03)
    first_floor = num(common.get("firstFloor"), 4.55)
    section_x = px + 24
    section_y = py + ph * .24
    section_w = pw * .60
    section_h = ph * .53
    scale = min((section_w - 96) / (depth + .75), (section_h - 42) / (first_floor + .25))
    origin_x = section_x + 28
    origin_y = section_y + 25
    rect(c, origin_x, origin_y, depth * scale, height * scale, stroke=INK, fill=FLOOR, line_width=.75)
    line(c, origin_x, origin_y + height * scale, origin_x + depth * scale, origin_y + height * scale, WALL, 1.35)
    line(c, origin_x + depth * scale, origin_y, origin_x + depth * scale, origin_y + height * scale, WALL, 1.25)
    threshold_x = origin_x + recess * scale
    head_y = origin_y + entry_h * scale
    line(c, origin_x - 24, origin_y, origin_x + depth * scale, origin_y, WALL, 1.25)
    line(c, threshold_x, origin_y, threshold_x, head_y, GREEN if open_entry else DOOR, .6, [3, 2] if open_entry else None)
    line(c, threshold_x - 3, head_y, threshold_x + 6, head_y, WALL, .9)
    dim_h(c, origin_x, threshold_x, origin_y - 9, f"引込 {fmt(recess)}", origin_y)
    for level, label, color in ((soffit, f"庇光帯下端 +{fmt(soffit)}", LIGHTING), (first_floor, f"階上FL +{fmt(first_floor)}", ACCENT)):
        y = origin_y + level * scale
        line(c, origin_x - 24, y, origin_x + depth * scale, y, color, .45, [3, 2])
        draw_text(c, origin_x + depth * scale + 5, y - 2, label, 6, color)
    for band in bay.get("elevation", {}).get("bands", []):
        low, high = num(band["low"]), num(band["high"])
        planted = band.get("kind") == "plant"
        band_x = threshold_x if planted else origin_x
        band_depth = .32 if planted else .12
        rect(c, band_x, origin_y + low * scale, band_depth * scale, (high - low) * scale, stroke=WALL, fill=HexColor("#b4c8a9" if planted else "#d5d9d4"), line_width=.55)
        draw_text(c, band_x + band_depth * scale + 5, origin_y + (low + high) * scale / 2 - 2, stext(band.get("label")), 6.2, MID)
    for fixture in bay.get("fixtures") or []:
        bounds = rect4(fixture.get("rect"))
        if bounds is None:
            continue
        u, d, w, fixture_depth = bounds
        fh = clamp(num(fixture.get("height"), .95), .08, height - .06)
        on_cut = u <= cut_u <= u + w
        rect(c, origin_x + d * scale, origin_y, max(3, fixture_depth * scale), fh * scale,
             stroke=ACCENT, fill=fixture_fill(stext(fixture.get("type"))) if on_cut else None, line_width=.65 if on_cut else .4)
        if fixture_depth * scale > 16:
            draw_text(c, origin_x + (d + fixture_depth / 2) * scale, origin_y + fh * scale + 3, compact_id(fixture.get("id")), 5.4, ACCENT, "center")
    for mount in bay.get("mounts") or []:
        bounds = rect4(mount.get("rect"))
        if bounds is None:
            continue
        _u, d, _w, mount_depth = bounds
        bottom = num(mount.get("bottom"), max(.05, height - .5))
        top = clamp(num(mount.get("top"), bottom + .2), bottom + .04, height)
        rect(c, origin_x + d * scale, origin_y + bottom * scale, max(3, mount_depth * scale), (top - bottom) * scale, stroke=ACCENT, fill=HexColor("#d5e0e5"), line_width=.6, dash=[3, 2])
        # Section callouts stay as stable IDs; the long mount specification is
        # available in the schedule and does not collide with level labels.
        draw_text(c, origin_x + (d + mount_depth / 2) * scale, origin_y + top * scale + 3, compact_id(mount.get("id")) or "M", 5.2, ACCENT, "center")
    for light in bay.get("lights") or []:
        center = light.get("center") or [light.get("u"), light.get("d")]
        if not isinstance(center, Sequence) or len(center) < 2 or center[1] is None:
            continue
        d, level = num(center[1]), num(light.get("y"), height - .18)
        draw_light_symbol(c, origin_x + d * scale, origin_y + clamp(level, .05, height) * scale, stext(light.get("id")), stext(light.get("kind")).lower() in ("accent", "spot", "縦光"))
    dim_h(c, origin_x, origin_x + depth * scale, origin_y - 19, f"D {fmt(depth)} m", origin_y)
    dim_v(c, origin_y, origin_y + height * scale, origin_x + depth * scale + 18, f"H {fmt(height)} m", origin_x + depth * scale)
    draw_text(c, origin_x, origin_y + first_floor * scale + 13, f"A–A 室内断面  入口中央 u={fmt(cut_u)} m / 什器は奥行方向に投影", 8.5, INK)
    scale_bar(c, origin_x, origin_y - 38, scale, 1 if scale > 28 else 2)

    # Enlarged storefront / threshold detail.
    detail_x = px + pw * .69
    detail_y = py + ph * .25
    detail_w = pw * .27
    detail_h = ph * .52
    label_box(c, detail_x, detail_y + detail_h + 10, detail_w, 43, "入口詳細立面", stext(bay["doorType"]), text_size=7.8, max_lines=2)
    dscale = min((detail_w - 55) / entry_width, (detail_h - 72) / entry_h)
    ox, oy = detail_x + 20, detail_y + 55
    right, top = ox + entry_width * dscale, oy + entry_h * dscale
    rect(c, ox, oy, right - ox, top - oy, stroke=GREEN if open_entry else GLASS,
         fill=None if open_entry else HexColor("#e4f1f0"), line_width=.7)
    if not open_entry:
        mid = (ox + right) / 2
        line(c, mid, oy, mid, top, DOOR, .75)
        arrow(c, mid - 5, oy + 14, ox + 10, oy + 14, DOOR, .65)
        arrow(c, mid + 5, oy + 14, right - 10, oy + 14, DOOR, .65)
    line(c, ox - 8, oy, right + 8, oy, WALL, 1.2)
    line(c, ox, top, right, top, WALL, 1.25)
    draw_text(c, ox, oy + 4, "FL±0", 6.5, MID, "right")
    draw_text(c, (ox + right) / 2, top + 7, "開口上端" if open_entry else "戸の上枠", 7, WALL, "center")
    dim_h(c, ox, right, oy - 19, f"内法 {fmt(entry_width)} m", oy)
    dim_v(c, oy, top, right + 16, f"H {fmt(entry_h)} m", right)
    scale_bar(c, ox, oy - 43, dscale, 1)
    notes = "\n".join(stext(segment.get("detail")) for segment in side_frontage(bay) if segment.get("detail"))
    label_box(c, px, py + 12, pw * .60, ph * .14, "正面仕上と取付", notes, HexColor("#f4f6f2"), text_size=7.5, max_lines=8)
    note = (
        f"共通基準: FL±0 / 庇光帯下端 +{fmt(soffit)} m / 階上FL +{fmt(first_floor)} m\n"
        f"当該区画天井: +{fmt(height)} m / 入口有効幅: {fmt(entry_width)} m / 主通路幅: {fmt(num(bay.get('clearWidth'), 1.2))} m"
    )
    label_box(c, px + pw * .69, py + 12, pw * .27, ph * .14, "高さ基準", note, HexColor("#f4f6f2"), text_size=7.5)


def overall_bounds(model: Mapping[str, Any]) -> tuple[float, float, float, float]:
    common = model.get("common") or {}
    half = num(common.get("halfWidth"), 11.4)
    s_min = num(common.get("nearS"), -3)
    s_max = num(common.get("rearS"), 60)
    x_min, x_max = -half, half
    for bay in model.get("bays") or []:
        bx0, bs0, bx1, bs1 = world_rect(bay, common)
        x_min, x_max = min(x_min, bx0), max(x_max, bx1)
        s_min, s_max = min(s_min, bs0), max(s_max, bs1)
    for reveal in common.get("rearReveals") or []:
        if not isinstance(reveal, Mapping):
            continue
        xr = reveal.get("x") or []
        sr = reveal.get("s") or []
        if isinstance(xr, Sequence) and len(xr) >= 2 and isinstance(sr, Sequence) and len(sr) >= 2:
            x0, x1, s0, s1 = num(xr[0]), num(xr[1]), num(sr[0]), num(sr[1])
            x_min, x_max = min(x_min, x0), max(x_max, x1)
            s_min, s_max = min(s_min, s0), max(s_max, s1)
    return x_min - 1.5, s_min - 1.5, x_max + 1.5, s_max + 1.5


def common_rect(value: Any) -> tuple[float, float, float, float] | None:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        return None
    if len(value) >= 4:
        return num(value[0]), num(value[1]), num(value[2]), num(value[3])
    return None


def draw_overall(c: Canvas, model: Mapping[str, Any], index: int, total: int) -> None:
    px, py, pw, ph = draw_header(c, "商業アトリウム 1階  総合配置図", "A-001", "共用部・テナント配置 / 方位と縮尺は図中記載 / 寸法単位 m", index, total)
    xmin, smin, xmax, smax = overall_bounds(model)
    # Put the long s axis on the long edge of the A3 sheet.  This keeps the
    # 63 m atrium readable at one consistent scale instead of leaving a tall,
    # narrow drawing with unused paper on both sides.
    map_w, map_h = pw * .72, ph * .78
    scale = min((map_w - 58) / max(smax - smin, 1), (map_h - 54) / max(xmax - xmin, 1))
    scale = max(4.5, scale)
    origin_x = px + 33
    origin_y = py + 92
    tx = lambda s: origin_x + (s - smin) * scale
    ty = lambda x: origin_y + (x - xmin) * scale
    common = model.get("common") or {}
    # Common floor plate.
    half_width = num(common_value(model, "halfWidth", 11.4))
    near_s = num(common_value(model, "nearS", -3))
    rear_s = num(common_value(model, "rearS", 60))
    rect(c, tx(near_s), ty(-half_width), (rear_s - near_s) * scale, 2 * half_width * scale, stroke=GRID, fill=FLOOR, line_width=.55)
    draw_text(c, tx(near_s + .7), ty(0) - 11, "正面通路 / 共用部", 7.2, MID, "left")
    # Rear reveal / low sightline bands connect the s=60 exploration boundary
    # to each rear storefront frontage.  They stay separate from the tenant
    # footprints so the old boundary remains legible in the overall plan.
    for reveal in common.get("rearReveals") or []:
        if not isinstance(reveal, Mapping):
            continue
        xr = reveal.get("x") or [0, 0]
        sr = reveal.get("s") or [rear_s, rear_s]
        if not isinstance(xr, Sequence) or len(xr) < 2 or not isinstance(sr, Sequence) or len(sr) < 2:
            continue
        rx0, rx1 = num(xr[0]), num(xr[1])
        rs0, rs1 = num(sr[0]), num(sr[1])
        if rx1 <= rx0 or rs1 <= rs0:
            continue
        floor_start = num(reveal.get("floorStartS"), rs0)
        if floor_start < rs0:
            rect(c, tx(floor_start), ty(rx0), (rs0 - floor_start) * scale, (rx1 - rx0) * scale,
                 stroke=HexColor("#c0cec3"), fill=HexColor("#f2f5f0"), line_width=.35)
            line(c, tx(floor_start), ty(rx0), tx(floor_start), ty(rx1), HexColor("#9aaca4"), .45, [2, 2])
        rect(c, tx(rs0), ty(rx0), (rs1 - rs0) * scale, (rx1 - rx0) * scale,
             stroke=HexColor("#9aaca4"), fill=HexColor("#edf3ee"), line_width=.45, dash=[2.5, 2])
        draw_text(c, tx((rs0 + rs1) / 2), ty((rx0 + rx1) / 2),
                  f"{stext(reveal.get('id'), 'rear reveal')}  H{fmt(reveal.get('head'), 2)}",
                  5.2, MID, "center")
    # Shops and rear expansion.
    for bay in ordered_bays(model):
        bx0, bs0, bx1, bs1 = world_rect(bay, common)
        rect(c, tx(bs0), ty(bx0), (bs1 - bs0) * scale, (bx1 - bx0) * scale, stroke=INK, fill=HexColor("#f5f6f2"), line_width=.7)
        # Keep long tenant names out of the geometry.  The ID here maps to
        # the full name in the right-hand tenant legend and each tenant sheet.
        draw_text(c, tx((bs0 + bs1) / 2), ty((bx0 + bx1) / 2), stext(bay.get("id")), 6.6, INK, "center")
        for island in bay.get("islands") or []:
            center = island.get("center") or island.get("position")
            size = island.get("size") or island.get("rect")
            if not isinstance(center, Sequence) or len(center) < 2 or not isinstance(size, Sequence) or len(size) < 2:
                continue
            ix, is_ = num(center[0]), num(center[1])
            iw, il = num(size[0]), num(size[1])
            # Production islands use world [x, s].  A local [u, d] is also
            # accepted when it clearly falls inside the bay footprint.
            if bx0 <= ix <= bx1 and bs0 <= is_ <= bs1:
                cx, cs = ix, is_
            else:
                local = local_island(bay, island, common)
                if local is None:
                    continue
                lu, ld, _lw, _ll = local
                side = stext(bay.get("side"), "west").lower()
                if side in ("west", "east", "left", "right", "l", "r"):
                    front_x = -num(common.get("halfWidth"), 11.4) if side in ("west", "left", "l") else num(common.get("halfWidth"), 11.4)
                    cx, cs = (front_x - ld if side in ("west", "left", "l") else front_x + ld), num((bay.get("span") or [0])[0]) + lu
                else:
                    cx, cs = num((bay.get("span") or [0])[0]) + lu, num(bay.get("plane"), num(common.get("rearS"), 60)) + ld
            rect(c, tx(cs - il / 2), ty(cx - iw / 2), il * scale, iw * scale, stroke=GREEN, fill=HexColor("#d8e4d8"), line_width=.5)
            draw_text(c, tx(cs), ty(cx), stext(island.get("label"), stext(island.get("id"), "島什器")), 5.4, GREEN, "center")
    rear = rear_s
    line(c, tx(rear), ty(xmin + 1), tx(rear), ty(xmax - 1), WALL, .9, [5, 3])
    draw_text(c, tx(rear) - 4, ty(xmax - .8), "奥展開", 6.2, MID, "right")
    # Lounge first; its fill is intentionally behind the loose furniture and
    # route islands so the common-area objects stay visible.
    lounge = common_value(model, "lounge")
    lounge_rect = common_rect(lounge)
    if lounge_rect:
        x, s, rx, rz = lounge_rect
        c.setStrokeColor(HexColor("#b6c7b6"))
        c.setFillColor(HexColor("#e5ede4"))
        c.ellipse(tx(s - rz), ty(x - rx), tx(s + rz), ty(x + rx), stroke=1, fill=1)
        draw_text(c, tx(s), ty(x), "ラウンジ", 6.1, GREEN, "center")

    # Production islands live at the route root (I1-I3), not inside a bay.
    # Draw them after the lounge fill and keep their IDs compact on the plan.
    for island in model.get("islands") or []:
        if not isinstance(island, Mapping):
            continue
        center = island.get("center") or []
        size = island.get("size") or island.get("rect") or []
        if not isinstance(center, Sequence) or len(center) < 2 or not isinstance(size, Sequence) or len(size) < 2:
            continue
        cx, cs = num(center[0]), num(center[1])
        iw, il = num(size[0]), num(size[1])
        rect(c, tx(cs - il / 2), ty(cx - iw / 2), il * scale, iw * scale,
             stroke=GREEN, fill=HexColor("#d8e4d8"), line_width=.55)
        draw_text(c, tx(cs), ty(cx), stext(island.get("id"), "I"), 5.5, GREEN, "center")

    tree = common.get("tree") or []
    if isinstance(tree, Sequence) and len(tree) >= 3:
        tree_x, tree_s, tree_r = num(tree[0]), num(tree[1]), max(.05, num(tree[2]))
        c.setStrokeColor(GREEN)
        c.setFillColor(HexColor("#c8d9c5"))
        c.circle(tx(tree_s), ty(tree_x), tree_r * scale, stroke=1, fill=1)
        line(c, tx(tree_s), ty(tree_x - tree_r * .55), tx(tree_s), ty(tree_x + tree_r * .55), GREEN, .65)
        draw_text(c, tx(tree_s), ty(tree_x), "樹", 5.8, GREEN, "center")

    # Sofa is redrawn after the lounge and root islands so its outline remains
    # readable in the shared seating zone.
    sofa = common_value(model, "sofa")
    sofa_rect = common_rect(sofa)
    if sofa_rect:
        x, s, w, d = sofa_rect
        rect(c, tx(s - d / 2), ty(x - w / 2), d * scale, w * scale, stroke=ACCENT, fill=HexColor("#d6dde1"), line_width=.65)
        draw_text(c, tx(s), ty(x), "ソファ", 6.3, ACCENT, "center")
    # Stair schematic; common source uses x,s pairs.
    stair = common.get("stairCenterline") or []
    stair_points = [(tx(num(point[1])), ty(num(point[0]))) for point in stair if isinstance(point, Sequence) and len(point) >= 2]
    if len(stair_points) >= 2:
        polyline(c, stair_points, HexColor("#8b8d8c"), max(5, num(common.get("stairWidth"), 5) * scale * .50), None)
        polyline(c, stair_points, HexColor("#fafbf8"), max(3, num(common.get("stairWidth"), 5) * scale * .33), None)
        for p1, p2 in zip(stair_points[:-1], stair_points[1:]):
            distance = math.hypot(p2[0] - p1[0], p2[1] - p1[1])
            if distance > 12:
                arrow(c, p1[0], p1[1], p2[0], p2[1], HexColor("#717776"), .5, 3)
        draw_text(c, tx(41.0), ty(1.8), "主階段（模式図）", 6.3, MID)
    elevator = common_rect(common.get("elevator"))
    if elevator:
        x0, s0, x1, s1 = elevator
        rect(c, tx(s0), ty(x0), (s1 - s0) * scale, (x1 - x0) * scale, stroke=ACCENT, fill=HexColor("#dce7ea"), line_width=.65)
        draw_text(c, tx((s0 + s1) / 2), ty((x0 + x1) / 2), "昇降塔", 6.1, ACCENT, "center")
    cafe = pair(common.get("cafe"))
    rect(c, tx(cafe[1] - 1.4), ty(cafe[0] - .8), 2.8 * scale, 1.6 * scale, stroke=GREEN, fill=HexColor("#e1e9dc"), line_width=.6)
    draw_text(c, tx(cafe[1]), ty(cafe[0]), "カフェ", 6.1, GREEN, "center")
    # Main dimensions and virtual direction.  The long dimension is now the
    # horizontal s axis; the cross-atrium width is the vertical dimension.
    dim_h(c, tx(near_s), tx(rear_s), py + 46, f"共用部 D / s {fmt(rear_s - near_s)} m")
    dim_v(c, ty(-half_width), ty(half_width), px + 13, f"共用部 W {fmt(2 * half_width)} m")
    north_arrow(c, px + map_w - 40, py + map_h - 10, 24)
    scale_bar(c, px + 10, py + 3, scale, 5 if scale > 9 else 10)

    note_x = px + pw * .76
    note_y = py + ph - 20
    note_w = pw * .22
    representative_count = sum(bay["id"] in REPRESENTATIVE_BAYS for bay in model["bays"])
    schedule_pages = max(1, math.ceil(len(all_fixtures(model)) / 17))
    rear_floor_notes = []
    for reveal in common.get("rearReveals") or []:
        if not isinstance(reveal, Mapping):
            continue
        sr = reveal.get("s") or []
        if isinstance(sr, Sequence) and len(sr) >= 1 and "floorStartS" in reveal:
            rear_floor_notes.append(f"{stext(reveal.get('id'))}: 床始 s={fmt(reveal.get('floorStartS'), 2)} / 見切り s={fmt(sr[0], 2)}")
    rear_floor_text = "\n".join(rear_floor_notes)
    overview_text = f"共用部境界、店舗の外周、正面奥の展開、ソファ、カフェ、昇降塔、主階段、I1-I3島什器、樹を一枚に集約。\n\n全図面 {total} 枚: 配置1 / テナント{len(ordered_bays(model))} / 代表断面{representative_count} / 器具表{schedule_pages}。"
    if rear_floor_text:
        overview_text += f"\n\n背面床・見切り:\n{rear_floor_text}"
    label_box(c, note_x, note_y - 112, note_w, 104, "配置要点", overview_text, max_lines=8)
    label_box(c, note_x, note_y - 207, note_w, 82, "方位・座標", "+s 奥。側面店舗は u = s 増加方向、d = 店内。正面奥は u = 世界 x 増加方向、d = s 増加方向。")
    label_box(c, note_x, note_y - 303, note_w, 82, "凡例", "薄灰: 床 / 白: 店舗区画 / 青: 昇降塔・ガラス / 緑: 植栽・カフェ・I1-I3 / 太線: 階段模式 / 赤破線: 店内動線 / s=60: 探索境界")
    label_box(c, note_x, py + 24, note_w, 134, "テナント一覧", "\n".join(f"{stext(b.get('id'))}  {stext(b.get('name'))}" for b in ordered_bays(model)) or "入力データに区画がありません", text_size=5.8, max_lines=14)


def all_fixtures(model: Mapping[str, Any]) -> list[tuple[Mapping[str, Any], Mapping[str, Any]]]:
    rows: list[tuple[Mapping[str, Any], Mapping[str, Any]]] = []
    for bay in ordered_bays(model):
        known_ids: set[str] = set()
        for fixture in bay.get("fixtures") or []:
            rows.append((bay, fixture))
            known_ids.add(stext(fixture.get("id")))
        for mount in bay.get("mounts") or []:
            item = dict(mount)
            item.setdefault("type", "吊り・上部什器")
            item.setdefault("height", num(item.get("top"), 0) - num(item.get("bottom"), 0))
            rows.append((bay, item))
            known_ids.add(stext(item.get("id")))
        for light in bay.get("lights") or []:
            item = dict(light)
            item.setdefault("type", "照明")
            item.setdefault("height", item.get("y", "-"))
            item.setdefault("spec", item.get("aim", ""))
            rows.append((bay, item))
            known_ids.add(stext(item.get("id")))
        for identifier, info in (bay.get("lighting") or {}).items():
            if stext(identifier) in known_ids or not isinstance(info, Mapping):
                continue
            rows.append((bay, {
                "id": identifier,
                "type": "照明設定",
                "height": "-",
                "label": "",
                "spec": stext(info.get("aim"), ""),
            }))
    return rows


def draw_schedule(c: Canvas, model: Mapping[str, Any], index: int, total: int, sheet_id: str, schedule_page: int = 1, schedule_pages: int = 1) -> None:
    rows = all_fixtures(model)
    page_rows = rows[(schedule_page - 1) * 17:schedule_page * 17]
    px, py, pw, ph = draw_header(c, "器具・仕上・照明表", sheet_id, f"全テナント共通 / 器具・吊り・照明 {schedule_page}/{schedule_pages} ページ", index, total)
    if not rows:
        label_box(c, px + 10, py + ph - 110, pw - 20, 95, "器具入力待ち", "grid.json単体では器具データが未入力です。本番JSONの bays[].fixtures と bays[].lighting が入ると、この表と各平面図へ自動反映されます。", HexColor("#f4f6f2"))
    table_x = px + 8
    table_y = py + ph - 135
    table_w = pw - 16
    headers = ["No.", "区画", "器具ID", "種別", "寸法 u,d,w,d", "H", "表示名", "仕様", "照明 ambient / accent / CCT / aim"]
    widths = [28, 42, 58, 76, 80, 30, 112, 206, table_w - (28 + 42 + 58 + 76 + 80 + 30 + 112 + 206)]
    row_h = 27
    c.setFillColor(HexColor("#e5e9e6"))
    c.setStrokeColor(GRID)
    c.rect(table_x, table_y, table_w, row_h, stroke=1, fill=1)
    cursor = table_x
    for header, col_w in zip(headers, widths):
        line(c, cursor, table_y, cursor, table_y + row_h, GRID, .45)
        draw_wrapped(c, cursor + 3, table_y + 18, header, col_w - 6, 6.3, leading=7, max_lines=2, color=INK)
        cursor += col_w
    line(c, cursor, table_y, cursor, table_y + row_h, GRID, .45)
    y = table_y - row_h
    for offset, (bay, fixture) in enumerate(page_rows, (schedule_page - 1) * 17 + 1):
        if y < py + 35:
            break
        rect(c, table_x, y, table_w, row_h, stroke=GRID, fill=PAPER, line_width=.35)
        bounds = rect4(fixture.get("rect"))
        size_text = "-" if bounds is None else ", ".join(fmt(v) for v in bounds)
        identifier = stext(fixture.get("id"), f"F-{offset:02d}")
        info = (bay.get("lighting") or {}).get(identifier, {})
        if not isinstance(info, Mapping):
            info = {}
        light_text = " / ".join(stext(info.get(key), "-") for key in ("ambient", "accent", "cct", "aim"))
        values = [
            str(offset), stext(bay.get("id")), identifier, stext(fixture.get("type"), "-")[:18], size_text, fmt(fixture.get("height"), 2),
            stext(fixture.get("label"), "-"), stext(fixture.get("spec"), "-"), light_text,
        ]
        cursor = table_x
        for value, col_w in zip(values, widths):
            line(c, cursor, y, cursor, y + row_h, GRID, .35)
            draw_wrapped(c, cursor + 3, y + 16, value, col_w - 6, 6.1, leading=7, max_lines=2, color=INK)
            cursor += col_w
        line(c, cursor, y, cursor, y + row_h, GRID, .35)
        y -= row_h
    draw_text(c, table_x, y - 18, f"器具・吊り・照明総数: {len(rows)} / 表示: {((schedule_page - 1) * 17 + 1) if rows else 0} - {min(schedule_page * 17, len(rows)) if rows else 0} / 寸法は rect=[u0,d0,w,depth]", 6.8, MID)
    # Frontage legend and standards.
    box_x = px + 8
    box_y = py + 35
    box_w = pw - 16
    box_h = max(66, min(105, table_y - box_y - 34))
    label_box(c, box_x, box_y, box_w, box_h, "正面・図面記号", "青線=ガラス、濃灰=壁、赤線=扉・見切り、緑線=開口・植栽、赤破線=動線、黄丸=照明器具。各区画の詳細はテナント別シートを参照。", HexColor("#f4f6f2"))


def build_pdf(model: Mapping[str, Any], output: Path, invariant: bool = False) -> int:
    bays = ordered_bays(model)
    representatives = [bay for bay in bays if bay["id"] in REPRESENTATIVE_BAYS]
    fixture_count = len(all_fixtures(model))
    schedule_pages = max(1, math.ceil(fixture_count / 17))
    sheet_count = 1 + len(bays) + len(representatives) + schedule_pages
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas = Canvas(str(output), pagesize=(PAGE_W, PAGE_H), pageCompression=1, invariant=1 if invariant else 0)
    canvas.setTitle(stext(model.get("title"), "商業アトリウム 1階テナント内装"))
    canvas.setAuthor("Lumen Pilgrimage design documentation")
    canvas.setSubject("商業アトリウム 1階テナント設計図")
    page = 1
    draw_overall(canvas, model, page, sheet_count)
    canvas.bookmarkPage("A-001")
    canvas.addOutlineEntry("A-001 総合配置図", "A-001", level=0, closed=False)
    canvas.showPage()
    page += 1
    for bay in bays:
        sheet_id = f"A-{page:03d}"
        draw_bay_sheet(canvas, model, bay, page, sheet_count, sheet_id)
        canvas.bookmarkPage(sheet_id)
        canvas.addOutlineEntry(f"{stext(bay.get('id'))} 平面・立面", sheet_id, level=0, closed=False)
        canvas.showPage()
        page += 1
    for bay in representatives:
        sheet_id = f"A-{page:03d}"
        draw_section(canvas, model, bay, page, sheet_count, sheet_id)
        canvas.bookmarkPage(sheet_id)
        canvas.addOutlineEntry(f"{stext(bay.get('id'))} 代表断面", sheet_id, level=0, closed=False)
        canvas.showPage()
        page += 1
    for schedule_page in range(1, schedule_pages + 1):
        schedule_id = f"A-{page:03d}"
        draw_schedule(canvas, model, page, sheet_count, schedule_id, schedule_page, schedule_pages)
        canvas.bookmarkPage(schedule_id)
        canvas.addOutlineEntry(f"{schedule_id} 器具・仕上・照明表 {schedule_page}/{schedule_pages}", schedule_id, level=0, closed=False)
        canvas.showPage()
        page += 1
    canvas.save()
    return sheet_count


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="商業アトリウム1階テナントのA3横ベクトルPDFを生成します。",
    )
    parser.add_argument("data", type=Path, help="テナント配置JSON")
    parser.add_argument("output", type=Path, help="出力PDF")
    parser.add_argument("--invariant", action="store_true", help="再生成時のPDFメタデータとIDを固定（検証用）")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    model = normalize(safe_json(args.data))
    sheet_count = build_pdf(model, args.output, args.invariant)
    print(f"created {args.output} ({sheet_count} sheets)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
