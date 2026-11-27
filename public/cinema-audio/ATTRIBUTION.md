# Cinema HRTF attribution

`cinema-hrtf-kemar-48k-144tap-symmetric.i16le.bin` is a derived subset of the
MIT Media Lab KEMAR compact HRTF measurements by Bill Gardner and Keith Martin.

Source and primary terms:

- [MIT Media Lab KEMAR measurements](https://sound.media.mit.edu/resources/KEMAR.html)
- [MIT KEMAR README](https://sound.media.mit.edu/resources/KEMAR/README)
- [MIT KEMAR measurement documentation](https://sound.media.mit.edu/resources/KEMAR/hrtfdoc.txt)

The MIT page states that the data is provided free with no restrictions on use,
provided Gardner and Martin are cited when the data is used in research or a
commercial application. The archive and its documentation identify the source
as 44.1 kHz, 16-bit signed data. The compact files contain 128 taps per ear,
with big-endian signed 16-bit left/right samples interleaved. The source
measurement distance is 1.4 m.

This repository distributes a derived table, not the original archive:

- five source elevations: -20°, 0°, +20°, +60°, +80°;
- azimuths 0° through 330° at 30° increments;
- 48 kHz, 144 taps per ear, little-endian signed 16-bit samples;
- records are elevation-major, then azimuth-major, then tap-major, with
  left/right samples interleaved;
- the table is 60 directions × 144 taps × 2 ears = 34,560 bytes;
- the compact archive's published crop is retained; no additional common
  propagation delay is added or removed, and directional interaural time
  difference remains in the data;
- the MIT compact set is the source's symmetric, left-ear-derived pair. It is
  deliberately small and does not retain individual median-plane interaural
  differences; the full archive is the source to choose if that cue is needed;
- azimuth 0° is directly ahead, positive azimuth is to the listener's right,
  and positive elevation is above the horizontal plane.

For a direction index `i`, read `i * 576` bytes. Within that record, tap `t`
starts at `i * 576 + t * 4`; the left sample is the little-endian int16 at
offset 0 and the right sample is the little-endian int16 at offset 2.
`cinema-hrtf-kemar-48k-144tap-symmetric.json` contains the complete direction
table, source archive hash, output hash, and processing details.

The reproducible preparation script is
[`scripts/prepare-cinema-hrtf.py`](../../scripts/prepare-cinema-hrtf.py). It
accepts the official `compact.tar.Z` or an extracted `compact/` directory and
uses a deterministic 16-sample-radius Hann-windowed sinc resampler. The source
archive is intentionally not committed to this repository.

Required citation:

> Bill Gardner and Keith Martin, MIT Media Lab, “HRTF Measurements of a KEMAR
> Dummy-Head Microphone,” 1994.
