#!/usr/bin/env python3
"""Revise the archived residence PDF from pinned, shared plan coordinates.

This is a reproducible vector revision, not the recovered original generator.
See docs/residence/source/README.md for inputs, limits and verification.
"""

from __future__ import annotations

import argparse
from hashlib import sha256
from importlib.metadata import version
from io import BytesIO
import json
from pathlib import Path
import re
from struct import unpack_from

from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/residence/source'
POINTS_PER_METRE = 1000 * 72 / 25.4
INK = HexColor('#1b2930')
MID = HexColor('#43575d')
CANOPY = HexColor('#8a4f2f')


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def digest(data: bytes) -> str:
    return sha256(data).hexdigest()


def numbers(text: str) -> list[float]:
    return [float(value.strip()) for value in text.split(',')]


def block(text: str, start: str, end: str) -> str:
    require(text.count(start) == 1, f'Plan declaration missing or ambiguous: {start}')
    return text.split(start, 1)[1].split(end, 1)[0]


def partition_geometry(text: str, spec: dict) -> dict:
    wall = re.search(
        r"wall\('e', (9\.95), ([\d.]+), ([\d.]+), 'interior', "
        r"\[door\('bedroom-02', '[^']+', ([\d.]+), ([\d.]+), bedroomSwing\)\]\)", text)
    require(wall is not None, 'Bedroom partition declaration is not supported')
    north, west, east, door_from, door_to = map(float, wall.groups())
    thickness_match = re.search(r"thickness = kind === 'interior' \? ([\d.]+) :", text)
    require(thickness_match is not None, 'Interior wall thickness declaration missing')
    thickness = float(thickness_match.group(1))
    require({'north': north, 'west': west, 'east': east, 'thickness': thickness}
            == spec['planPage']['partition'], 'Partition coordinates differ from revision specification')
    require([door_from, door_to] == spec['planPage']['bedroomDoor'], 'Bedroom door differs')
    primary = re.search(r"door\('primary-bedroom', '[^']+', ([\d.]+), ([\d.]+),", text)
    require(primary is not None and list(map(float, primary.groups()))
            == spec['planPage']['primaryDoor'], 'Primary bedroom door differs')
    return {'partition': [spec['planPage']['oldPartitionEastMetres'], north, east, thickness]}


def tea_geometry(text: str) -> dict:
    parts_text = block(text, 'export const RESIDENCE_TEA_CEILING_PARTS:', '\n];')
    parts = re.findall(r'rect: \[([^\]]+)\], bottom: ([\d.]+), top: ([\d.]+)', parts_text)
    require(len(parts) == 6, 'Expected six tea ceiling parts')
    rects = [numbers(part[0]) for part in parts]
    support_text = block(text, 'export const RESIDENCE_TEA_CEILING_SUSPENSION = {', '\n} as const;')
    points = re.findall(r"id: '[^']+', east: ([\d.]+), north: ([\d.]+), "
                        r'braceEast: ([\d.]+), braceNorth: ([\d.]+)', support_text)
    require(len(points) == 4, 'Expected four tea ceiling suspension points')
    soffit = re.search(r'soffit: ([\d.]+)', support_text)
    slab = re.search(r'export const RESIDENCE_UPPER_SLAB_BOTTOM = ([\d.]+);', text)
    require(soffit is not None and slab is not None, 'Ceiling or slab height missing')
    require('anchor: RESIDENCE_UPPER_SLAB_BOTTOM' in support_text, 'Suspension is not tied to slab')
    return {
        'canopyBounds': [min(r[0] for r in rects), min(r[1] for r in rects),
                         max(r[2] for r in rects), max(r[3] for r in rects)],
        'suspensionPoints': [list(map(float, point)) for point in points],
        'panelBottom': float(parts[0][1]),
        'beamBottom': min(float(part[1]) for part in parts[1:]),
        'soffit': float(soffit.group(1)), 'anchor': float(slab.group(1)),
    }


def active_revisions(spec: dict) -> list[str]:
    revisions = spec.get('activeRevisionIds')
    require(isinstance(revisions, list) and len(revisions) > 0
            and all(isinstance(item, str) for item in revisions), 'Explicit revision IDs are required')
    require(len(set(revisions)) == len(revisions), 'Duplicate residence drawing revision ID')
    require(set(revisions) <= {'teaSupport', 'partition'}, 'Unknown residence drawing revision ID')
    return revisions


def plan_geometry(text: str, spec: dict, revisions: list[str]) -> dict:
    """Parse only the selected revisions; the complete Plan file is still hash-pinned."""
    geometry = {}
    if 'partition' in revisions:
        geometry.update(partition_geometry(text, spec))
    if 'teaSupport' in revisions:
        geometry.update(tea_geometry(text))
    return geometry


def checked_font(font_path: Path, spec: dict) -> str:
    data = font_path.read_bytes()
    require(digest(data) == spec['font']['sha256'], 'Font hash differs from the pinned input')
    fs_type = None
    for index in range(unpack_from('>H', data, 4)[0]):
        tag, _, offset, _ = unpack_from('>4sIII', data, 12 + index * 16)
        if tag == b'OS/2':
            fs_type = unpack_from('>H', data, offset + 8)[0]
    require(fs_type == spec['font']['fsType'], 'Font embedding flags differ')
    name = 'ResidenceRevisionJapanese'
    pdfmetrics.registerFont(TTFont(name, str(font_path)))
    return name


def set_content(page, data: bytes) -> None:
    stream = DecodedStreamObject()
    stream.set_data(data)
    page.replace_contents(stream)


def move_plan_labels(page, spec: dict) -> None:
    data = page.get_contents().get_data()
    shift = spec['labelSouthShiftMetres'] * POINTS_PER_METRE / spec['scaleDenominator']
    for x, y in spec['labelMatricesPoints']:
        old = f'1 0 0 1 {x} {y} Tm'.encode('ascii')
        new = f'1 0 0 1 {x} {y - shift:.6f} Tm'.encode('ascii')
        require(data.count(old) == 1, 'Baseline bedroom label matrix missing or ambiguous')
        data = data.replace(old, new)
    set_content(page, data)


def remove_tea_notes(page, spec: dict) -> None:
    data = page.get_contents().get_data()
    for y in spec['originalNoteBaselinesPoints']:
        pattern = (rb'BT 1 0 0 1 ' + str(spec['noteXPoints']).encode('ascii') + b' '
                   + str(y).encode('ascii') + rb' Tm [^\n]+\n')
        data, count = re.subn(pattern, b'', data)
        require(count == 1, 'Baseline tea note missing or ambiguous')
    set_content(page, data)


def overlay(page_size: list[float], draw) -> PdfReader:
    stream = BytesIO()
    canvas = Canvas(stream, pagesize=page_size, invariant=1, pageCompression=1)
    draw(canvas)
    canvas.showPage()
    canvas.save()
    stream.seek(0)
    return PdfReader(stream)


def draw_partition(canvas: Canvas, spec: dict, geometry: dict) -> None:
    scale = POINTS_PER_METRE / spec['scaleDenominator']
    ox, oy = spec['originPoints']
    west, north, east, thickness = geometry['partition']
    canvas.setFillColor(INK)
    canvas.rect(ox + west * scale, oy + (north - thickness / 2) * scale,
                (east - west) * scale, thickness * scale, fill=1, stroke=0)


def draw_canopy(canvas: Canvas, spec: dict, geometry: dict, font: str) -> None:
    scale = POINTS_PER_METRE / spec['scaleDenominator']
    oe, on = spec['originMetres']
    ox, oy = spec['originPoints']

    def point(east: float, north: float) -> tuple[float, float]:
        return ox + (east - oe) * scale, oy + (north - on) * scale

    west, south, east, north = geometry['canopyBounds']
    canvas.saveState()
    canvas.setStrokeColor(CANOPY)
    canvas.setLineWidth(.7)
    canvas.setDash(3, 2)
    canvas.rect(*point(west, south), (east - west) * scale, (north - south) * scale,
                fill=0, stroke=1)
    for e, n, brace_e, brace_n in geometry['suspensionPoints']:
        x, y = point(e, n)
        canvas.line(x, y, *point(brace_e, brace_n))
    canvas.setDash()
    for e, n, _, _ in geometry['suspensionPoints']:
        x, y = point(e, n)
        canvas.circle(x, y, 2.5, fill=0, stroke=1)
    canvas.restoreState()
    canvas.setFont(font, 9.5)
    canvas.setFillColor(MID)
    values = {key: f'{geometry[key]:g}' for key in ['panelBottom', 'beamBottom', 'soffit', 'anchor']}
    for text, y in zip(spec['notes'], spec['revisedNoteBaselinesPoints'], strict=True):
        text = text.format(**values)
        require(pdfmetrics.stringWidth(text, font, 9.5) <= 524.40942,
                'Tea annotation exceeds the original note column')
        canvas.drawString(spec['noteXPoints'], y, text)


def generate(spec: dict, font_path: Path) -> tuple[bytes, dict]:
    require(spec['schemaVersion'] == 2, 'Unsupported residence drawing revision schema')
    revisions = active_revisions(spec)
    for package, required_version in spec['tools'].items():
        require(version(package) == required_version, f'Use {package} {required_version}')
    baseline = (SOURCE / spec['baseline']['file']).read_bytes()
    require(len(baseline) == spec['baseline']['bytes'] and digest(baseline)
            == spec['baseline']['sha256'], 'Baseline PDF size or hash differs')
    plan = (ROOT / spec['plan']['file']).read_bytes()
    require(digest(plan) == spec['plan']['sha256'], 'Plan hash differs; review and update the revision input first')
    geometry = plan_geometry(plan.decode('utf-8'), spec, revisions)
    reader = PdfReader(BytesIO(baseline))
    require(len(reader.pages) == spec['baseline']['pages'], 'Baseline page count differs')
    for page in reader.pages:
        require(list(map(float, page.mediabox[2:])) == spec['baseline']['pageSizePoints'],
                'Baseline page size differs')
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    writer.pdf_header = reader.pdf_header
    if 'partition' in revisions:
        first = writer.pages[0]
        move_plan_labels(first, spec['planPage'])
        first.merge_page(overlay(spec['baseline']['pageSizePoints'],
                                lambda c: draw_partition(c, spec['planPage'], geometry)).pages[0])
    if 'teaSupport' in revisions:
        font = checked_font(font_path, spec)
        tea = writer.pages[3]
        remove_tea_notes(tea, spec['teaPage'])
        tea.merge_page(overlay(spec['baseline']['pageSizePoints'],
                              lambda c: draw_canopy(c, spec['teaPage'], geometry, font)).pages[0])
    writer.add_metadata({'/Creator': 'Lumen Pilgrimage residence drawing revision',
                         '/Producer': f"pypdf {spec['tools']['pypdf']}; ReportLab {spec['tools']['reportlab']}",
                         '/ModDate': 'D:20000101000000Z'})
    result = BytesIO()
    writer.write(result)
    return result.getvalue(), geometry


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'docs/residence/residence-70f-drawings.pdf')
    parser.add_argument('--font', type=Path, default=Path('/Library/Fonts/Arial Unicode.ttf'))
    parser.add_argument('--check', action='store_true', help='Compare reproducible bytes without writing')
    args = parser.parse_args()
    spec = json.loads((SOURCE / 'residence-70f-revisions.json').read_text())
    try:
        data, geometry = generate(spec, args.font)
        if args.check:
            require(args.output.read_bytes() == data, 'PDF differs from reproducible generation')
        else:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_bytes(data)
    except (ValueError, OSError) as error:
        parser.exit(1, f'Residence drawing revision failed: {error}\n')
    print(json.dumps({'status': 'match' if args.check else 'written', 'sha256': digest(data),
                      'bytes': len(data), 'pages': spec['baseline']['pages'],
                      'activeRevisionIds': spec['activeRevisionIds'],
                      'geometryMetres': geometry}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
