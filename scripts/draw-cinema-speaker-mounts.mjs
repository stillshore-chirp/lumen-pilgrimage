import { writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Vector3 } from 'three';

const source = new URL('../src/coast/world/cinema/', import.meta.url).href;
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    const local = context.parentURL?.startsWith(source) && specifier.startsWith('./') && !specifier.endsWith('.ts');
    return nextResolve(local ? `${specifier}.ts` : specifier, context);
  },
});
const { CINEMA_SPEAKER_EQUIPMENT } = await import('../src/coast/world/cinema/cinemaSpeakerGeometry.ts');
const { CINEMA_SPEAKER_DETAIL } = await import('../src/coast/world/cinema/cinemaSpeakerEquipment.ts');
hook.deregister();

const equipment = CINEMA_SPEAKER_EQUIPMENT.find(({ id }) => id === 'top-R-05');
const cabinet = equipment.boxes.find(({ part }) => part === 'cabinet');
const grille = equipment.boxes.find(({ part }) => part === 'grille');
const project = point => [80 + (point.x - 5.8) * 300, 840 - (point.y - 19.8) * 300];
const number = value => Number(value.toFixed(3));
const section = box => {
  const corners = [-.5, .5].flatMap(x => [-.5, .5].flatMap(y => [-.5, .5]
    .map(z => project(new Vector3(x, y, z).applyMatrix4(box.matrix)))));
  const points = [...new Map(corners.map(point => [point.map(number).join(','), point])).values()]
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const hull = sequence => {
    const output = [];
    for (const point of sequence) {
      while (output.length >= 2 && cross(output.at(-2), output.at(-1), point) <= 0) output.pop();
      output.push(point);
    }
    return output.slice(0, -1);
  };
  return [...hull(points), ...hull([...points].reverse())].map(point => point.map(number).join(',')).join(' ');
};
const elements = [];
const text = (x, y, content, size = 20, fill = '#273c42') =>
  elements.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}">${content}</text>`);
const rect = (x, y, width, height, fill, extra = '') =>
  elements.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" ${extra}/>`);
const line = (x, y, x2, y2, color = '#829496', width = 2, extra = '') =>
  elements.push(`<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" ${extra}/>`);

rect(0, 0, 1400, 960, '#f4f5f1');
text(60, 52, 'LUMEN PILGRIMAGE / CINEMA SPEAKER MOUNTS', 28);
text(60, 84, 'Nominal dimensions in millimetres; positions in metres. Generated from the runtime geometry.', 17);
text(80, 134, 'TOP-R-05: transverse section at z = 32 m', 22);

const roof = project(new Vector3(5.8, 22, 32));
rect(80, roof[1] - 20, 600, 20, '#c2c9c6');
line(80, roof[1], 680, roof[1], '#40575c', 3);
const coffer = project(new Vector3(6.875, 21.965, 32));
rect(coffer[0], coffer[1], 680 - coffer[0], .330 * 300, '#d7d8d0');
text(422, coffer[1] + 52, 'Adjacent coffer', 16);
text(422, coffer[1] + 76, 'lining; no support load', 14);

for (const box of equipment.boxes.filter(({ part }) => part === 'support')) {
  const start = project(new Vector3(0, -.5, 0).applyMatrix4(box.matrix));
  const end = project(new Vector3(0, .5, 0).applyMatrix4(box.matrix));
  line(...start, ...end, '#59666a', CINEMA_SPEAKER_DETAIL.supportDiameter * 300);
}
for (const box of equipment.boxes.filter(({ part }) => part === 'mount')) {
  elements.push(`<polygon points="${section(box)}" fill="#737e80" stroke="#344b50" stroke-width="1.5"/>`);
}
elements.push(`<polygon points="${section(cabinet)}" fill="#485659" stroke="#193d45" stroke-width="2"/>`);
elements.push(`<polygon points="${section(grille)}" fill="#192b31" stroke="#193d45" stroke-width="2"/>`);
const front = project(new Vector3(...equipment.acousticCenter));
elements.push(`<circle cx="${front[0]}" cy="${front[1]}" r="5" fill="#bc753b"/>`);
const target = project(new Vector3(...equipment.acousticCenter).addScaledVector(equipment.front, .65));
line(...front, ...target, '#bc753b', 3, 'marker-end="url(#arrow)"');
text(86, 746, 'Grille centre = acoustic centre', 17);
text(86, 771, '(6.655, 20.381, 32.000)', 17);
text(86, 802, 'Front axis follows the shared aim', 17, '#9b5c2b');
text(86, 878, 'Roof pad centres stay inside |x| = 6.750 m.', 17);
text(86, 903, 'Coffer starts at |x| = 6.875 m; support paths clear it.', 17);

text(780, 134, 'TOP ENCLOSURE: front elevation', 22);
const x = 840, y = 211, scale = 500, width = cabinet.size.x * scale, height = cabinet.size.y * scale;
rect(x, y, width, height, '#485659', `rx="${CINEMA_SPEAKER_DETAIL.cabinetRadius * scale}"`);
const gx = x + (cabinet.size.x - grille.size.x) * scale / 2;
const gy = y + (cabinet.size.y - grille.size.y) * scale / 2;
rect(gx, gy, grille.size.x * scale, grille.size.y * scale, '#7a8485', 'rx="3"');
const rim = CINEMA_SPEAKER_DETAIL.grilleRim * scale;
rect(gx + rim, gy + rim, grille.size.x * scale - 2 * rim, grille.size.y * scale - 2 * rim, '#192b31', 'rx="2"');
for (const u of [-1, 1]) for (const v of [-1, 1]) {
  const cx = x + width / 2 + u * (grille.size.x * scale - rim) / 2;
  const cy = y + height / 2 + v * (grille.size.y * scale - rim) / 2;
  elements.push(`<circle cx="${cx}" cy="${cy}" r="${CINEMA_SPEAKER_DETAIL.fixingDiameter * scale / 2}" fill="#bec6c3"/>`);
}
line(x, y - 30, x + width, y - 30, '#718b91', 1.5, 'marker-start="url(#arrow)" marker-end="url(#arrow)"');
text(x + width / 2 - 18, y - 42, String(cabinet.size.x * 1000), 19);
line(x + width + 35, y, x + width + 35, y + height, '#718b91', 1.5, 'marker-start="url(#arrow)" marker-end="url(#arrow)"');
text(x + width + 48, y + height / 2, String(cabinet.size.y * 1000), 19);
text(780, 658, 'Closed enclosure: 12 mm corner radius', 18);
text(780, 688, 'Grille frame: 26 mm; fixings: diameter 8 mm', 18);
text(780, 718, 'Supports: diameter 35 mm; mount edge radius: 3 mm', 18);
text(780, 766, 'Nominal enclosure width x height x depth', 19);
text(780, 797, 'Side: 610 x 920 x 750 / Rear: 620 x 910 x 630', 17);
text(780, 824, 'Top: 610 x 770 x 430 / Roof pad: 180 x 60 x 180', 17);
text(780, 872, 'Collision uses the shared oriented envelopes.', 17);
text(780, 898, 'Maximum enclosure corner difference: 8.8 mm.', 17);
text(60, 940, 'Source: cinemaSpeakerGeometry.ts + cinemaSpeakerEquipment.ts / node scripts/draw-cinema-speaker-mounts.mjs', 15);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="960" viewBox="0 0 1400 960"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 Z" fill="#718b91"/></marker></defs><g font-family="Arial,Helvetica,sans-serif">${elements.join('\n')}</g></svg>\n`;
const output = new URL('../docs/cinema/cinema-speaker-mounts.svg', import.meta.url);
writeFileSync(output, svg);
console.log(`Wrote ${fileURLToPath(output)} (${Buffer.byteLength(svg)} bytes).`);
