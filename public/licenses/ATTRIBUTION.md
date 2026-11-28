# Cinema geometry software notices

The cinema speaker enclosures and mounts use `three@0.184.0`, including the
`RoundedBoxGeometry` and `BufferGeometryUtils.mergeGeometries` addons and the
core cylinder, matrix and instancing APIs. The geometry is generated at runtime;
no external model or bitmap is included in this change.

| Software | Source and terms | Distributed files |
| --- | --- | --- |
| Three.js 0.184.0 | [Version r184 original license](https://github.com/mrdoob/three.js/blob/r184/LICENSE). Copyright 2010–2026 three.js authors, MIT license. Preserve the copyright, permission and disclaimer text. | [Exact license text](three-0.184.0-LICENSE.txt) and [version, SHA-256 and source record](three-0.184.0.json). |

Run `node scripts/prepare-cinema-code-licenses.mjs` from the repository root after
installing the locked dependencies. It checks the adopted package version and
copies `node_modules/three/LICENSE` without changing its bytes. A version change
requires reviewing the source and terms before updating the generator.

The runtime imports are bundled by Vite. Vite copies `public/licenses/` unchanged
to `dist/licenses/`, so the full notice accompanies the compiled code at
`/licenses/three-0.184.0-LICENSE.txt`. Compare its SHA-256 with the source record
after building. This record covers the software adopted for the cinema geometry;
the measured audio data has its own [source and terms](../cinema-audio/ATTRIBUTION.md).
