import { writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const source = new URL('../src/coast/world/cinema/', import.meta.url).href;
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    const local = context.parentURL?.startsWith(source) && specifier.startsWith('./') && !specifier.endsWith('.ts');
    return nextResolve(local ? `${specifier}.ts` : specifier, context);
  },
});
const { CINEMA_RETURN_OUTLETS, CINEMA_RETURN_COFFER_BOXES, CINEMA_VENTILATION_PARTS,
  cinemaVentilationWallBoxes } = await import('../src/coast/world/cinema/cinemaVentilation.ts');
hook.deregister();

const parts = [
  ...CINEMA_RETURN_COFFER_BOXES.map(box => ({ kind: 'coffer', box })),
  ...CINEMA_VENTILATION_PARTS,
  ...cinemaVentilationWallBoxes([[20.14, 11, 25.4, .28, 22, 57]]).map(box => ({ kind: 'wall', box })),
];
const colours = { coffer: '#72858d', frame: '#be8a43', liner: '#324950', duct: '#6b9aa4', support: '#a3997d', wall: '#ced4cf' };
const elements = [];
const number = value => Number(value.toFixed(3));
const text = (x, y, content, size = 18, colour = '#233e45') =>
  elements.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${colour}">${content}</text>`);
const rect = (x, y, width, height, fill, extra = '') =>
  elements.push(`<rect x="${number(x)}" y="${number(y)}" width="${number(width)}" height="${number(height)}" fill="${fill}" ${extra}/>`);
const line = (x1, y1, x2, y2, colour = '#809696', extra = '') =>
  elements.push(`<line x1="${number(x1)}" y1="${number(y1)}" x2="${number(x2)}" y2="${number(y2)}" stroke="${colour}" ${extra}/>`);
const section = (axis, plane, horizontalAxis, verticalAxis, project, clip) => {
  elements.push(`<g clip-path="url(#${clip})">`);
  for (const { kind, box } of parts) {
    if (box[0] < 0 || Math.abs(box[axis] - plane) >= box[axis + 3] / 2 + 1e-9) continue;
    const lower = project(box[horizontalAxis] - box[horizontalAxis + 3] / 2,
      box[verticalAxis] + box[verticalAxis + 3] / 2);
    const upper = project(box[horizontalAxis] + box[horizontalAxis + 3] / 2,
      box[verticalAxis] - box[verticalAxis + 3] / 2);
    rect(lower[0], lower[1], upper[0] - lower[0], upper[1] - lower[1], colours[kind]);
  }
  elements.push('</g>');
};

rect(0, 0, 1500, 1100, '#f4f5ef');
text(55, 48, 'LUMEN PILGRIMAGE / CINEMA RETURN-AIR OPENINGS', 27);
text(55, 78, 'Runtime geometry sections. Positions in metres; nominal dimensions in millimetres.', 18);
text(55, 108, 'Independent virtual installation; airflow, plant capacity and structural certification are not simulated.', 16);

text(85, 156, 'X/Y SECTION AT z = 19 m  /  VERTICAL SCALE EXAGGERATED', 21);
const xy = (x, y) => [90 + (x - 12.8) * 163, 480 - (y - 21.54) * 590];
for (const y of [21.62, 21.655, 21.945, 22]) {
  const [x, py] = xy(12.8, y);
  line(x, py, 1380, py, '#d7dfd8');
  text(20, py + 5, String(y), 15);
}
section(2, 19, 0, 1, xy, 'xy');
// Supports beside the cut plane are projected separately, never presented as
// solids intersecting the z=19 section.
for (const { kind, box } of parts) {
  if (kind !== 'support' || box[0] < 12.8 || Math.abs(box[2] - 19) > 1.5) continue;
  const lower = xy(box[0] - box[3] / 2, box[1] + box[4] / 2);
  const upper = xy(box[0] + box[3] / 2, box[1] - box[4] / 2);
  rect(lower[0], lower[1], upper[0] - lower[0], upper[1] - lower[1], 'none',
    `stroke="${colours.support}" stroke-width="2" stroke-dasharray="4 3"`);
}
const roof = xy(12.8, 22);
line(...roof, 1380, roof[1], '#233e45', 'stroke-width="3"');
text(1130, roof[1] - 12, 'ROOF y = 22', 17);
const mouth = xy(14, 21.62);
elements.push(`<circle cx="${mouth[0]}" cy="${mouth[1]}" r="5" fill="#b64936"/>`);
line(...mouth, 335, 514, '#b64936', 'stroke-width="2"');
text(90, 542, 'Shared visible mouth / audio source: (14, 21.620, 19)', 18, '#93412e');
text(590, 300, 'Hollow coffer: 20 mm skins', 18);
text(590, 327, 'Clear interior y = 21.655 ... 21.945', 17);
text(590, 355, 'Dashed roof posts: projected from adjacent Z', 16);
text(940, 453, 'Duct outer y = 21.680 ... 21.920', 16);

text(85, 599, 'X/Z PLAN AT y = 21.8 m  /  EQUAL AXIS SCALES', 21);
const xz = (x, z) => [90 + (x - 18.9) * 440, 1030 - (z - 18.84) * 440];
section(1, 21.8, 0, 2, xz, 'xz');
const route = [[19.15, 19], [20.37, 19], [20.37, 19.60]].map(([x, z]) => xz(x, z));
elements.push(`<polyline points="${route.map(point => point.map(number).join(',')).join(' ')}" fill="none" stroke="#b64936" stroke-width="3" stroke-dasharray="8 6"/>`);
text(155, 1055, 'Coffer takeoff', 16);
text(575, 1055, 'Side wall / real cut', 16);
const service = xz(20.37, 19.60);
line(...service, 842, 694, '#b64936', 'stroke-width="2"');
text(870, 679, 'Service-network interface', 20);
text(870, 708, '(20.37, 21.8, 19.60)', 18);
text(870, 737, 'Clear section 140 x 220 mm', 18);
text(870, 776, 'The elbow turns outside the wall.', 18);
text(870, 804, 'Its end closes the straight outdoor sightline.', 17);
text(870, 843, 'Four outlets: x = -14 / +14; z = 19 / 43', 18);
text(870, 871, `Shared source height: ${CINEMA_RETURN_OUTLETS[0][1].toFixed(3)} m`, 18);
text(870, 911, 'Mouth 2000 x 180; shell cut 2020 x 200', 17);
text(870, 939, 'Frame 2080 x 260; liner depth 80', 17);
text(870, 981, 'Legend:', 17);
Object.entries(colours).forEach(([kind, colour], i) => {
  const column = i % 3, row = Math.floor(i / 3);
  rect(870 + column * 170, 997 + row * 31, 17, 17, colour);
  text(895 + column * 170, 1011 + row * 31, kind, 16);
});

const output = `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1100" viewBox="0 0 1500 1100"><title>Cinema return-air opening and wall takeoff sections</title><desc>Generated from the same coffer shells, ventilation solids and wall subtraction as rendering and navigation. The audio source lies at the opening; the external elbow ends at a service-network interface.</desc><defs><clipPath id="xy"><rect x="85" y="178" width="1310" height="306"/></clipPath><clipPath id="xz"><rect x="85" y="626" width="740" height="410"/></clipPath></defs><g font-family="Arial, sans-serif">${elements.join('\n')}</g></svg>\n`;
writeFileSync(new URL('../docs/cinema/cinema-ventilation.svg', import.meta.url), output);
console.log(`Cinema ventilation diagram written: ${CINEMA_RETURN_COFFER_BOXES.length} coffer boxes, ${CINEMA_VENTILATION_PARTS.length} equipment solids.`);
