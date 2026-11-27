#!/usr/bin/env python3
"""Prepare the small, distributable cinema HRTF table from MIT KEMAR.

The MIT compact archive contains 44.1 kHz, 128-tap, big-endian int16 stereo
responses.  This script keeps a regular subset of the published directions,
resamples them to 48 kHz with a deterministic windowed-sinc interpolator, and
writes a little-endian int16 table plus a JSON table description.

No source archive is checked into the repository.  ``--source`` may point to
an extracted ``compact`` directory or to the official ``compact.tar.Z``.  The
archive form is unpacked in a temporary directory and is never modified.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import struct
import subprocess
import tarfile
import tempfile
from pathlib import Path
from typing import Sequence


SCRIPT_VERSION = "1"
SOURCE_RATE_HZ = 44_100
TARGET_RATE_HZ = 48_000
SOURCE_TAP_COUNT = 128
TARGET_TAP_COUNT = 144
SOURCE_STEREO_BYTES = SOURCE_TAP_COUNT * 2 * 2
SOURCE_URL = "https://sound.media.mit.edu/resources/KEMAR.html"
SOURCE_ARCHIVE_URL = "https://sound.media.mit.edu/resources/KEMAR/compact.tar.Z"
SOURCE_README_URL = "https://sound.media.mit.edu/resources/KEMAR/README"
SOURCE_DOC_URL = "https://sound.media.mit.edu/resources/KEMAR/hrtfdoc.txt"

# These are the directions selected for a small regular table.  All are
# present in the compact archive at exactly 30 degree azimuth spacing.  The
# upper rows retain useful ceiling/source elevation cues while keeping the
# table small enough to load as one immutable asset.
ELEVATIONS_DEG = (-20, 0, 20, 60, 80)
AZIMUTHS_DEG = tuple(range(0, 360, 30))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        required=True,
        type=Path,
        help="extracted compact directory or the official compact.tar.Z archive",
    )
    parser.add_argument(
        "--source-readme",
        type=Path,
        help="optional downloaded MIT README whose SHA-256 is recorded",
    )
    parser.add_argument(
        "--source-doc",
        type=Path,
        help="optional downloaded MIT hrtfdoc.txt whose SHA-256 is recorded",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("public/cinema-audio"),
        help="directory receiving the binary table and metadata",
    )
    return parser.parse_args()


def safe_extract(tar_path: Path, destination: Path) -> None:
    with tarfile.open(tar_path, "r:") as archive:
        members = archive.getmembers()
        for member in members:
            member_path = Path(member.name)
            if member.issym() or member.islnk():
                raise ValueError(f"archive links are not allowed: {member.name}")
            if member_path.is_absolute() or ".." in member_path.parts:
                raise ValueError(f"unsafe archive member: {member.name}")
        archive.extractall(destination, members=members)


def source_directory(source: Path, temporary_root: Path) -> tuple[Path, str | None]:
    source = source.expanduser().resolve()
    if source.is_dir():
        compact = source / "compact"
        if compact.is_dir():
            source = compact
        if not (source / "elev0").is_dir():
            raise ValueError(f"source directory is not an extracted KEMAR compact set: {source}")
        return source, None

    if source.name.endswith(".tar.Z"):
        archive_copy = temporary_root / source.name
        shutil.copyfile(source, archive_copy)
        subprocess.run(
            ["uncompress", archive_copy.name],
            cwd=temporary_root,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        tar_path = archive_copy.with_suffix("")
        extract_root = temporary_root / "archive"
        extract_root.mkdir()
        safe_extract(tar_path, extract_root)
        compact = extract_root / "compact"
        if not compact.is_dir():
            raise ValueError("KEMAR archive did not contain compact/")
        return compact, sha256_file(source)

    raise ValueError(f"source must be a directory or .tar.Z archive: {source}")


def parse_source_pair(path: Path) -> tuple[list[int], list[int]]:
    raw = path.read_bytes()
    if len(raw) != SOURCE_STEREO_BYTES:
        raise ValueError(f"{path} has {len(raw)} bytes; expected {SOURCE_STEREO_BYTES}")
    values = struct.unpack(">" + "h" * (SOURCE_TAP_COUNT * 2), raw)
    return list(values[0::2]), list(values[1::2])


def sinc(value: float) -> float:
    if abs(value) < 1e-12:
        return 1.0
    x = math.pi * value
    return math.sin(x) / x


def resample_channel(samples: Sequence[int]) -> tuple[list[int], int]:
    """Resample 128 samples from 44.1 kHz to 144 samples at 48 kHz.

    The output sample times are n * 44,100 / 48,000 in source-sample units.
    A symmetric 16-sample Hann-windowed sinc kernel avoids a phase shift and
    preserves the measured common delay and interaural time difference.
    """

    output: list[int] = []
    clamp_count = 0
    source_per_output = SOURCE_RATE_HZ / TARGET_RATE_HZ
    radius = 16
    for output_index in range(TARGET_TAP_COUNT):
        source_position = output_index * source_per_output
        center = math.floor(source_position)
        total = 0.0
        weight_total = 0.0
        for source_index in range(center - radius + 1, center + radius + 1):
            if source_index < 0 or source_index >= len(samples):
                continue
            distance = source_position - source_index
            window_phase = (distance + radius) / (2.0 * radius)
            window = 0.5 + 0.5 * math.cos(math.pi * (window_phase * 2.0 - 1.0))
            weight = sinc(distance) * window
            total += samples[source_index] * weight
            weight_total += weight
        value = total / weight_total if weight_total else 0.0
        rounded = int(math.floor(value + 0.5)) if value >= 0 else int(math.ceil(value - 0.5))
        clipped = max(-32768, min(32767, rounded))
        clamp_count += clipped != rounded
        output.append(clipped)
    return output, clamp_count


def source_file(compact: Path, elevation: int, azimuth: int) -> Path:
    directory = compact / f"elev{elevation}"
    path = directory / f"H{elevation}e{azimuth:03d}a.dat"
    if not path.is_file():
        raise FileNotFoundError(f"missing selected MIT compact direction: {path}")
    return path


def make_direction_table() -> list[dict[str, int | bool]]:
    table: list[dict[str, int | bool]] = []
    index = 0
    for elevation in ELEVATIONS_DEG:
        for azimuth in AZIMUTHS_DEG:
            canonical = min(azimuth, (360 - azimuth) % 360)
            table.append(
                {
                    "index": index,
                    "elevation_deg": elevation,
                    "azimuth_deg": azimuth,
                    "source_azimuth_deg": canonical,
                    "swap_ears": azimuth > 180,
                }
            )
            index += 1
    return table


def metadata_hash(path: Path) -> str:
    return sha256_file(path)


def document_record(path: Path | None, url: str) -> dict[str, str | None]:
    return {"url": url, "sha256": sha256_file(path) if path else None}


def write_output(compact: Path, output_dir: Path, archive_sha256: str | None, readme: Path | None, doc: Path | None) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    binary_path = output_dir / "cinema-hrtf-kemar-48k-144tap-symmetric.i16le.bin"
    metadata_path = output_dir / "cinema-hrtf-kemar-48k-144tap-symmetric.json"
    directions = make_direction_table()

    raw_output = bytearray()
    clamp_count = 0
    for direction in directions:
        source = source_file(compact, int(direction["elevation_deg"]), int(direction["source_azimuth_deg"]))
        left, right = parse_source_pair(source)
        left, left_clamp_count = resample_channel(left)
        right, right_clamp_count = resample_channel(right)
        clamp_count += left_clamp_count + right_clamp_count
        if bool(direction["swap_ears"]):
            left, right = right, left
        for left_sample, right_sample in zip(left, right):
            raw_output.extend(struct.pack("<hh", left_sample, right_sample))

    binary_path.write_bytes(raw_output)
    metadata = {
        "schema": "lumen.cinema.hrtf.v1",
        "generator": {
            "script": "scripts/prepare-cinema-hrtf.py",
            "version": SCRIPT_VERSION,
            "source_rate_hz": SOURCE_RATE_HZ,
            "target_rate_hz": TARGET_RATE_HZ,
            "target_tap_count": TARGET_TAP_COUNT,
            "resampler": "16-sample-radius Hann-windowed sinc, output times n*44100/48000",
            "clamp_count": clamp_count,
        },
        "source": {
            "dataset": "MIT Media Lab KEMAR compact HRTF measurements",
            "authors": ["Bill Gardner", "Keith Martin"],
            "measurement_rate_hz": SOURCE_RATE_HZ,
            "measurement_distance_m": 1.4,
            "archive_url": SOURCE_ARCHIVE_URL,
            "page_url": SOURCE_URL,
            "readme": document_record(readme, SOURCE_README_URL),
            "documentation": document_record(doc, SOURCE_DOC_URL),
            "archive_sha256": archive_sha256,
            "original_encoding": "signed-int16-big-endian, left/right interleaved, 128 taps per ear",
            "compact_symmetry": "the compact set derives both ears from the left-ear measurements at mirrored azimuths; median-plane interaural differences are therefore not retained",
        },
        "license": {
            "name": "MIT Media Lab KEMAR data usage terms",
            "url": SOURCE_URL,
            "summary": "Free with no usage restrictions; cite Gardner and Martin when used in research or commercial applications.",
            "required_attribution": "Bill Gardner and Keith Martin, MIT Media Lab, HRTF Measurements of a KEMAR Dummy-Head Microphone (1994).",
        },
        "file": {
            "path": binary_path.name,
            "sha256": sha256_file(binary_path),
            "bytes": len(raw_output),
            "encoding": "signed-int16-little-endian",
            "record_layout": "direction-major, tap-major, ear-interleaved",
            "ear_order": ["left", "right"],
            "direction_stride_bytes": TARGET_TAP_COUNT * 2 * 2,
            "tap_stride_bytes": 4,
            "ear_offsets_bytes": {"left": 0, "right": 2},
            "normalization": "none; source int16 full-scale is retained",
        },
        "coordinate": {
            "azimuth_reference": "listener forward",
            "azimuth_positive": "listener right, increasing clockwise when viewed from above",
            "elevation_reference": "horizontal plane",
            "elevation_positive": "up",
            "source_radius_m": 1.4,
            "common_delay_and_itd": "the compact source crop is retained; no additional common delay is added or removed, and directional ITD remains",
            "selected_elevations_deg": list(ELEVATIONS_DEG),
            "selected_azimuths_deg": list(AZIMUTHS_DEG),
            "direction_index": "elevation-major, then azimuth ascending; use directions[index]",
        },
        "directions": directions,
    }
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return binary_path, metadata_path


def main() -> int:
    args = parse_args()
    if args.source_readme and not args.source_readme.is_file():
        raise FileNotFoundError(f"source README does not exist: {args.source_readme}")
    if args.source_doc and not args.source_doc.is_file():
        raise FileNotFoundError(f"source documentation does not exist: {args.source_doc}")
    with tempfile.TemporaryDirectory(prefix="prepare-cinema-hrtf-") as temporary_name:
        compact, archive_sha256 = source_directory(args.source, Path(temporary_name))
        binary_path, metadata_path = write_output(
            compact,
            args.output_dir,
            archive_sha256,
            args.source_readme,
            args.source_doc,
        )
    print(json.dumps({
        "binary": str(binary_path),
        "metadata": str(metadata_path),
        "binary_sha256": sha256_file(binary_path),
        "metadata_sha256": metadata_hash(metadata_path),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
