#!/usr/bin/env python3
"""Reproducibly extract koto single-note technical comparison candidates.

This script reads locally supplied, hash-locked official preview decodes. It does
not download files, authorize publication, recover the original WAV, or copy a
recorded phrase. NumPy is an offline analysis dependency, never a browser one.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
import wave
from pathlib import Path

import numpy as np


SCRIPT_VERSION = "1"
RATE = 48_000
SOURCE_HASHES = {
    "365215": "eddcf1922325756d0928293297d93b64beeb5f0ba43e11730f7eaf2741bf9f36",
    "365242": "133eff375b227d0d2480bec544cbaa535994adf8cbeb5708235d8c73c5c47430",
}
# Start positions precede the detected attack by 3 ms. Ends precede the next
# foreign-string event; truncation is deliberately exposed, never looped away.
CUTS = (
    ("low-151", "365242", 30.803, 31.650, 151.6, 0.070),
    ("mid-319", "365215", 49.572, 49.840, 319.5, 0.055),
    ("mid-452", "365215", 33.225, 33.700, 452.1, 0.070),
    ("high-640", "365215", 25.849, 26.180, 639.6, 0.055),
    ("high-792", "365215", 13.028, 14.200, 792.5, 0.100),
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def decibels(value: float) -> float:
    return 20 * math.log10(max(value, 1e-12))


def read_source(path: Path, expected: str) -> np.ndarray:
    if sha256(path) != expected:
        raise ValueError("Source hash differs from the reviewed preview decode.")
    with wave.open(str(path), "rb") as stream:
        if (stream.getframerate(), stream.getnchannels(), stream.getsampwidth()) != (RATE, 2, 2):
            raise ValueError("Expected 48 kHz, stereo, PCM16 source decode.")
        return np.frombuffer(stream.readframes(stream.getnframes()), "<i2").reshape(-1, 2).astype(np.float64) / 32768


def estimate_root(samples: np.ndarray, hint: float) -> tuple[float, float]:
    # Long-enough root-specific window plus log-parabolic peak refinement.
    window = samples[round(0.073 * RATE):min(len(samples), round(0.253 * RATE))]
    fft_size = 2 ** math.ceil(math.log2(len(window) * 8))
    spectrum = np.abs(np.fft.rfft((window - window.mean()) * np.hanning(len(window)), fft_size))
    frequency = np.fft.rfftfreq(fft_size, 1 / RATE)
    lower, upper = np.searchsorted(frequency, [hint * 0.98, hint * 1.02])
    peak = lower + int(np.argmax(spectrum[lower:upper]))
    a, b, c = np.log(spectrum[peak - 1:peak + 2] + 1e-30)
    correction = 0.5 * (a - c) / (a - 2 * b + c)
    root = float((peak + correction) * RATE / fft_size)
    harmonic_mask = np.zeros(len(spectrum), dtype=bool)
    for harmonic in range(1, math.floor(10_000 / root) + 1):
        harmonic_mask |= np.abs(frequency - root * harmonic) < max(12, root * harmonic * 0.012)
    purity = float(np.sum(spectrum[harmonic_mask] ** 2) / np.sum(spectrum ** 2))
    return root, purity


def onset_report(samples: np.ndarray) -> list[dict]:
    # Screening aid only: rises can also be beating or handling noise.
    frame_size = 480
    frames = samples[:len(samples) // frame_size * frame_size].reshape(-1, frame_size)
    db = 20 * np.log10(np.maximum(np.sqrt(np.mean(frames ** 2, axis=1)), 1e-12))
    rise = db - np.r_[np.repeat(db[0], 4), db[:-4]]
    candidates = []
    for index in range(4, len(db) - 10):
        if rise[index] > 5 and db[index] > -43 and rise[index] >= max(rise[index - 3:index + 4]):
            if not candidates or index * 0.01 - candidates[-1]["seconds"] > 0.22:
                candidates.append({"seconds": round(index * 0.01, 3), "riseDb": round(float(rise[index]), 2)})
    return candidates


def prepare(source_dir: Path, output_dir: Path) -> dict:
    sources = {sid: read_source(source_dir / f"{sid}-decoded-available-preview.wav", digest)
               for sid, digest in SOURCE_HASHES.items()}
    output_dir.mkdir(parents=True, exist_ok=True)
    extracted = []
    for sample_id, sid, start, end, hint, fade_seconds in CUTS:
        first, last = round(start * RATE), round(end * RATE)
        stereo = sources[sid][first:last]
        # Keep the same physical microphone channel for every root. Averaging
        # negatively correlated channels would change the attack spectrum.
        samples = stereo[:, 0].copy()
        root, purity = estimate_root(samples, hint)
        original_mean = float(samples.mean())
        samples -= original_mean
        fade_in = round(0.0005 * RATE)
        samples[:fade_in] *= np.sin(np.linspace(0, math.pi / 2, fade_in)) ** 2
        fade_out = round(fade_seconds * RATE)
        samples[-fade_out:] *= np.cos(np.linspace(0, math.pi / 2, fade_out)) ** 2
        extracted.append((samples, {
            "id": sample_id, "sourceId": sid, "sourceSha256": SOURCE_HASHES[sid],
            "sourceStartFrame": first, "sourceEndFrameExclusive": last,
            "sourceStartSeconds": first / RATE, "sourceEndSeconds": last / RATE,
            "channel": 0, "rootFrequency": root, "sampleRate": RATE,
            "attackPreRollSeconds": 0.003, "fadeInSeconds": 0.0005,
            "fadeOutSeconds": fade_seconds, "removedDc": original_mean,
            "harmonicEnergyRatioScreening": purity,
            "stereoCorrelation": float(np.corrcoef(stereo.T)[0, 1]),
            "sourceChannelRmsDbfs": [decibels(float(np.sqrt(np.mean(stereo[:, index] ** 2)))) for index in (0, 1)],
            "tailTruncatedBeforeNextEvent": sample_id != "high-792",
        }))
    # One bank gain, not per-note normalization or compression. Unknown source
    # recording gain and player force still prevent calibrated velocity layers.
    common_gain = 0.55 / max(float(np.max(np.abs(samples))) for samples, _ in extracted)
    bank = []
    for samples, entry in extracted:
        samples *= common_gain
        pcm = np.rint(np.clip(samples, -1, 1) * 32767).astype("<i2")
        path = output_dir / f"{entry['id']}.wav"
        with wave.open(str(path), "wb") as stream:
            stream.setnchannels(1)
            stream.setsampwidth(2)
            stream.setframerate(RATE)
            stream.writeframes(pcm.tobytes())
        entry.update({"path": path.name, "frames": len(samples), "durationSeconds": len(samples) / RATE,
                      "bytes": path.stat().st_size, "sha256": sha256(path), "commonBankGain": common_gain,
                      "peakDbfs": decibels(float(np.max(np.abs(pcm))) / 32768),
                      "rmsDbfs": decibels(float(np.sqrt(np.mean((pcm.astype(float) / 32768) ** 2))))})
        bank.append(entry)
    report = {
        "version": SCRIPT_VERSION, "status": "technical-comparison-candidates-human-listening-pending",
        "sourceKind": "partial-official-lossy-mp3-preview-decodes-not-original-wav",
        "instrumentStringCount": "unverified", "humanListening": "not-performed",
        "sampleRate": RATE, "maxTransposeSemitones": 5, "referenceVelocity": 0.6,
        "toolVersions": {"python": platform.python_version(), "numpy": np.__version__},
        "processing": "channel 0; per-cut DC removal; 0.5 ms sine-squared fade-in; cosine-squared tail; one common bank gain; PCM16 quantization; no loop, denoise, time-stretch or note/phrase reuse",
        "reproduction": "python3 scripts/prepare-koto-samples.py --source-dir INPUT --output-dir OUTPUT",
        "sourceScreening": [{"id": sid, "sha256": SOURCE_HASHES[sid], "frames": len(samples),
                             "durationSeconds": len(samples) / RATE,
                             "onsetCandidatesNotConfirmedNotes": onset_report(samples[:, 0])}
                            for sid, samples in sources.items()],
        "samples": bank,
        "limitations": ["13-string instrument not verified", "lossy and incomplete previews",
                        "uncontrolled non-anechoic recording and player force", "short cut tails for several roots",
                        "harmonic energy is a screening metric, not proof of naturalness or isolated performance",
                        "A3 and Bb3 unsupported within five semitones; pure-sample 39-second score unavailable"],
    }
    (output_dir / "bank.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    try:
        report = prepare(args.source_dir, args.output_dir)
    except (OSError, ValueError, wave.Error):
        raise SystemExit("Koto preparation failed; verify the local reviewed source files and arguments.") from None
    print(json.dumps({"status": report["status"], "samples": len(report["samples"]),
                      "output": str(args.output_dir / "bank.json")}))


if __name__ == "__main__":
    main()
