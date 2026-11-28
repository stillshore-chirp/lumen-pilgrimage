import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const version = '0.184.0';
const installed = JSON.parse(await readFile(new URL('node_modules/three/package.json', root), 'utf8'));
if (installed.version !== version) throw new Error('Review the adopted Three.js version before regenerating its notice');
const license = await readFile(new URL('node_modules/three/LICENSE', root));
const destination = new URL('public/licenses/', root);
const name = `three-${version}-LICENSE.txt`;
const metadata = {
  package: 'three', version, license: 'MIT',
  upstream: 'https://github.com/mrdoob/three.js/blob/r184/LICENSE',
  source: 'node_modules/three/LICENSE',
  file: name, sha256: createHash('sha256').update(license).digest('hex'), bytes: license.length,
  generator: 'scripts/prepare-cinema-code-licenses.mjs',
  adoptedBy: 'Cinema speaker enclosure and mounting geometry',
};
await mkdir(destination, { recursive: true });
await writeFile(new URL(name, destination), license);
await writeFile(new URL(`three-${version}.json`, destination), `${JSON.stringify(metadata, null, 2)}\n`);
console.log(`Prepared three@${version} notice: ${metadata.sha256} (${metadata.bytes} bytes)`);
