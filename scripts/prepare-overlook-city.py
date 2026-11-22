"""Build the overlook's road mask and city placements from Census TIGER/Line.

Usage: python3 scripts/prepare-overlook-city.py tl_2025_06037_roads.zip
Requires Pillow and NumPy. The ZIP is the Census 2025 ROADS file for FIPS
06037. Raw GIS records and road names are excluded from the game.
"""
from collections.abc import Iterator
import gzip
from math import atan2, hypot, pi
from pathlib import Path
from random import Random
import struct
import sys
from zipfile import ZipFile

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

MIN_X, MAX_X = -23000, 23000
MIN_Z, MAX_Z = -26000, 11000
WIDTH, HEIGHT = 2560, 2059
ORIGIN_LAT, ORIGIN_LON = 34.11843, -118.30040
PIXELS_PER_METRE = WIDTH / (MAX_X - MIN_X)
OUTPUT = Path(__file__).resolve().parents[1] / 'public' / 'coast-overlook'
CLASSES = {'S1100': 3, 'S1200': 2, 'S1400': 1, 'S1630': 2}
# Reserve the hill park, golf courses, reservoirs, and cemeteries.
OPEN_SPACES = (
    (-530, 1770, 2390, 1870),
    (530, -490, 470, 385),
    (2460, 1020, 830, 1610),
    (-3050, 630, 390, 430),
    (2960, -1960, 300, 530),
    (3660, -4940, 190, 230),
    (5940, -4210, 810, 765),
    (-1740, -3250, 310, 320),
    (-11300, -4770, 740, 565),
)
HIGHWAY_NAMES = ('I-', 'US Hwy ', 'State Hwy ')


def projected(lat: float, lon: float) -> tuple[float, float]:
    return (lon - ORIGIN_LON) * 92170, (lat - ORIGIN_LAT) * 110950


def parts(zip_path: Path) -> Iterator[tuple[int, list[tuple[float, float]]]]:
    with ZipFile(zip_path) as archive:
        dbf_name = next(name for name in archive.namelist() if name.endswith('.dbf'))
        with archive.open(dbf_name) as dbf, archive.open(dbf_name[:-3] + 'shp') as shp:
            header = dbf.read(32)
            count, header_size, record_size = struct.unpack_from('<IHH', header, 4)
            fields = dbf.read(header_size - 32)
            offsets = {}
            offset = 1
            for pos in range(0, len(fields) - 1, 32):
                key = fields[pos:pos + 11].split(b'\0')[0]
                length = fields[pos + 16]
                offsets[key] = slice(offset, offset + length)
                offset += length
            shp.read(100)
            for _ in range(count):
                row = dbf.read(record_size)
                _, content_words = struct.unpack('>2i', shp.read(8))
                geometry = shp.read(content_words * 2)
                road_class = CLASSES.get(row[offsets[b'MTFCC']].decode('ascii').strip())
                if road_class is None or len(geometry) < 44:
                    continue
                name = row[offsets[b'FULLNAME']].decode('latin1').strip()
                if road_class == 1 and name.startswith(HIGHWAY_NAMES):
                    road_class = 2
                min_lon, min_lat, max_lon, max_lat = struct.unpack_from('<4d', geometry, 4)
                west, south = projected(min_lat, min_lon)
                east, north = projected(max_lat, max_lon)
                if east < MIN_X or west > MAX_X or north < MIN_Z or south > MAX_Z:
                    continue
                part_count, point_count = struct.unpack_from('<2i', geometry, 36)
                starts = (*struct.unpack_from(f'<{part_count}i', geometry, 44), point_count)
                points = [projected(lat, lon) for lon, lat in struct.iter_unpack('<2d', geometry[44 + 4 * part_count:])]
                for a, b in zip(starts, starts[1:]):
                    if b - a > 1:
                        yield road_class, points[a:b]


def to_pixel(x: float, z: float) -> tuple[float, float]:
    return (x - MIN_X) * PIXELS_PER_METRE, (z - MIN_Z) * PIXELS_PER_METRE


def in_bounds(x: float, z: float) -> bool:
    return MIN_X <= x < MAX_X and MIN_Z <= z < MAX_Z


def open_space(x: float, z: float) -> bool:
    return any(((x - a) / w) ** 2 + ((z - b) / h) ** 2 < 1 for a, b, w, h in OPEN_SPACES)


def street_samples(points: list[tuple[float, float]], spacing: float, phase: float):
    remaining = spacing * phase
    for (x0, z0), (x1, z1) in zip(points, points[1:]):
        dx, dz = x1 - x0, z1 - z0
        length = hypot(dx, dz)
        if length < 0.1:
            continue
        while remaining < length:
            fraction = remaining / length
            yield x0 + dx * fraction, z0 + dz * fraction, dx / length, dz / length
            remaining += spacing
        remaining -= length


def ground_atlas(roads):
    oversample = 2
    maps = [Image.new('L', (WIDTH * oversample, HEIGHT * oversample)) for _ in range(3)]
    draws = [ImageDraw.Draw(image) for image in maps]
    for kind, points in roads:
        pixels = [(x * oversample, z * oversample) for x, z in (to_pixel(*point) for point in points)]
        street_width = (0, 11, 22, 20)[kind]
        width = max(1, round(street_width * PIXELS_PER_METRE * oversample))
        draws[0].line(pixels, fill=255, width=width, joint='curve')
        if kind > 1:
            draws[1].line(pixels, fill=255 if kind == 3 else 172, width=width, joint='curve')
        if kind < 3:
            # Convolving a wider strip spreads development into the surrounding blocks
            # and tapers it past the last roads into undeveloped slopes.
            draws[2].line(pixels, fill=255, width=round(132 * PIXELS_PER_METRE * oversample), joint='curve')

    streets, arterial, parcel = [image.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS) for image in maps]
    broad = np.asarray(parcel.filter(ImageFilter.GaussianBlur(8.0)), dtype=np.float32) / 255
    close = np.asarray(parcel.filter(ImageFilter.GaussianBlur(1.8)), dtype=np.float32) / 255
    development = np.clip(broad * 1.15 + close * 0.25 - 0.14, 0, 1)
    pixels_x = np.arange(WIDTH, dtype=np.float32) / PIXELS_PER_METRE + MIN_X
    pixels_z = np.arange(HEIGHT, dtype=np.float32) / PIXELS_PER_METRE + MIN_Z
    for x, z, width, depth in OPEN_SPACES:
        distance = ((pixels_x[None, :] - x) / width) ** 2 + ((pixels_z[:, None] - z) / depth) ** 2
        development *= np.clip((distance - 0.75) * 2.4, 0.02, 1.0)
    dev_mask = (development * 255).astype(np.uint8)
    atlas = Image.merge('RGB', (Image.fromarray(dev_mask), streets, arterial))
    atlas.save(OUTPUT / 'overlook-streets.webp', lossless=True, method=6)
    return dev_mask, np.asarray(streets)


def city_plans(roads, development, streets):
    random = Random(7129245)
    roofs, lights = bytearray(), bytearray()
    occupied_roofs: dict[tuple[int, int], list[tuple[float, float, float]]] = {}
    occupied_lights: set[tuple[int, int, int]] = set()
    for kind, points in roads:
        xm, zm = points[len(points) // 2]
        radius = hypot(xm, zm)
        lamp_spacing = (0, 49, 38, 44)[kind] * (1.0 + min(1.65, max(0, radius - 5100) * 0.000105))
        for x, z, dx, dz in street_samples(points, lamp_spacing, random.random()):
            sidewalk = (0, 6.5, 13, 1)[kind]
            side = random.choice((-1, 1))
            x, z = x - dz * sidewalk * side, z + dx * sidewalk * side
            if not in_bounds(x, z) or (open_space(x, z) and kind == 1):
                continue
            if kind == 1 and random.random() < 0.13 + min(0.46, max(0, radius - 5700) * 0.00004):
                continue
            key = (round(x / 12), round(z / 12), kind)
            if key in occupied_lights:
                continue
            occupied_lights.add(key)
            intensity = random.randrange(75, 255)
            lights.extend(struct.pack('<HHBB', round(x - MIN_X), round(z - MIN_Z), kind, intensity))
        if kind > 2:
            continue

        lot_spacing = 29 + min(115, max(0, radius - 4200) * 0.009)
        for side in (-1, 1):
            for x, z, dx, dz in street_samples(points, lot_spacing, random.random()):
                if not in_bounds(x, z):
                    continue
                # Frontages are smaller close to the deck. Further out a model
                # represents adjoining roofs on the same side of a block.
                distance = hypot(x, z)
                if random.random() < min(0.64, max(0, distance - 4600) * 0.000075):
                    continue
                near = max(0, 1.0 - max(0, distance - 2700) / 13700)
                commercial = kind == 2 or random.random() < 0.095
                industrial = random.random() < 0.17 and distance > 6500
                w = random.uniform(11, 26) + (1 - near) * random.uniform(8, 37)
                d = w * random.uniform(0.66, 1.44)
                if commercial:
                    w *= 1.33
                    d *= 1.27
                setback = (9 if kind == 1 else 14) + d * 0.5 + random.uniform(3, 14)
                x, z = x - dz * setback * side, z + dx * setback * side
                if not in_bounds(x, z) or open_space(x, z):
                    continue
                px, pz = to_pixel(x, z)
                px, pz = min(WIDTH - 1, int(px)), min(HEIGHT - 1, int(pz))
                if development[pz, px] < 49 or streets[pz, px] > 114:
                    continue

                # Pad the footprint centers against adjacent TIGER roads and
                # already placed roofs, particularly at tight intersections.
                footprint = max(w, d) * 0.49
                gx, gz = int(x // 42), int(z // 42)
                overlaps = any(
                    (x - ox) ** 2 + (z - oz) ** 2 < (footprint + other) ** 2
                    for a in range(gx - 2, gx + 3) for b in range(gz - 2, gz + 3)
                    for ox, oz, other in occupied_roofs.get((a, b), ())
                )
                if overlaps:
                    continue
                occupied_roofs.setdefault((gx, gz), []).append((x, z, footprint))
                angle = round((atan2(dz, dx) % pi) * 256 / pi) % 256
                use = 2 if industrial else int(commercial)
                roofs.extend(struct.pack('<HHBBBB', round(x - MIN_X), round(z - MIN_Z),
                                         round(w), round(d), angle, use))
    packed = struct.pack('<4sII', b'OVC1', len(roofs) // 8, len(lights) // 6) + roofs + lights
    (OUTPUT / 'overlook-buildings.bin.gz').write_bytes(gzip.compress(packed, compresslevel=9, mtime=0))
    print(f'{len(roads)} road paths, {len(roofs) // 8} inferred footprints, {len(lights) // 6} street lights')


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    roads = list(parts(Path(sys.argv[1])))
    development, streets = ground_atlas(roads)
    city_plans(roads, development, streets)


if __name__ == '__main__':
    main()
