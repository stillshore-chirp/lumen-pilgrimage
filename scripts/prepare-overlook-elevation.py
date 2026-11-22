"""Convert uncompressed 32-bit 3DEP GeoTIFF exports to the overlook height grids."""

import argparse
import math
import struct
from pathlib import Path

ORIGIN_LON = -118.30040
ORIGIN_LAT = 34.11843
METERS_PER_DEGREE_X = 92170
METERS_PER_DEGREE_Z = 110950


def pack_grid(source, destination):
    contents = source.read_bytes()
    order = "<" if contents[:2] == b"II" else ">"
    if struct.unpack_from(f"{order}H", contents, 2)[0] != 42:
        raise ValueError("Expected a GeoTIFF")
    directory = struct.unpack_from(f"{order}I", contents, 4)[0]
    entries = struct.unpack_from(f"{order}H", contents, directory)[0]
    tags = {}
    for i in range(entries):
        position = directory + 2 + i * 12
        tag, kind, size, data = struct.unpack_from(f"{order}HHII", contents, position)
        fmt = {3: "H", 4: "I", 12: "d"}.get(kind)
        if fmt is None:
            continue
        count = struct.calcsize(fmt) * size
        tags[tag] = struct.unpack_from(f"{order}{size}{fmt}", contents, data if count > 4 else position + 8)

    width, height = tags[256][0], tags[257][0]
    if tags[258] != (32,) or tags[259] != (1,) or tags[339] != (3,):
        raise ValueError("Expected an uncompressed single-channel Float32 GeoTIFF")

    heights = [0.] * (width * height)
    if 324 in tags:
        tile_width, tile_height = tags[322][0], tags[323][0]
        columns = math.ceil(width / tile_width)
        for tile, offset in enumerate(tags[324]):
            start_x, start_y = (tile % columns) * tile_width, (tile // columns) * tile_height
            for row in range(min(tile_height, height - start_y)):
                count = min(tile_width, width - start_x)
                head = (start_y + row) * width + start_x
                heights[head:head + count] = struct.unpack_from(f"{order}{count}f", contents, offset + row * tile_width * 4)
    else:
        row = 0
        rows_per_strip = tags.get(278, (height,))[0]
        for offset in tags[273]:
            count = min(rows_per_strip, height - row) * width
            start = row * width
            heights[start:start + count] = struct.unpack_from(f"{order}{count}f", contents, offset)
            row += rows_per_strip

    dx, dz, _ = tags[33550]
    ix, iz, _, lon, lat, _ = tags[33922]
    west = (lon + (0.5 - ix) * dx - ORIGIN_LON) * METERS_PER_DEGREE_X
    north = (lat - (0.5 - iz) * dz - ORIGIN_LAT) * METERS_PER_DEGREE_Z
    header = struct.pack("<4sHH4f", b"HILL", width, height, west, north, dx * METERS_PER_DEGREE_X, dz * METERS_PER_DEGREE_Z)
    heights = [round(h * 4) if math.isfinite(h) and -100 < h < 8191 else 0 for h in heights]
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(header + struct.pack(f"<{len(heights)}h", *heights))
    print(f"{destination.name}: {width}×{height}, quarter-meter heights, {min(heights)/4:.2f}–{max(heights)/4:.2f} m")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("regional", type=Path)
    parser.add_argument("nearby", type=Path)
    parser.add_argument("--output", type=Path, default=Path("public/coast-overlook"))
    args = parser.parse_args()
    pack_grid(args.regional, args.output / "overlook-elevation.bin")
    pack_grid(args.nearby, args.output / "overlook-detail.bin")


if __name__ == "__main__":
    main()
