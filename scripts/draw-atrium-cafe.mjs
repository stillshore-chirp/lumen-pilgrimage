import { registerHooks } from 'node:module';
import { writeFile } from 'node:fs/promises';

const atriumUrl = new URL('../src/coast/world/atrium/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return context.parentURL?.startsWith(atriumUrl) && specifier.startsWith('./') && !specifier.endsWith('.ts')
      ? nextResolve(`${specifier}.ts`, context) : nextResolve(specifier, context);
  },
});
const { ATRIUM_CAFE_BAY: bay, ATRIUM_CAFE_PLAN: plan, ATRIUM_CAFE_SPEAKERS: speakers,
  atriumCafeLocalPoint } = await import('../src/coast/world/atrium/atriumCafePlan.ts');
hooks.deregister();

const scale = 37, ox = 100, oy = 190;
const shapes = [];
const text = (x, y, value, size = 15, anchor = 'start') =>
  shapes.push(`<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}">${value}</text>`);
const line = (x1, y1, x2, y2, color = '#343c3b', width = 1.5, dash = '') =>
  shapes.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`);
const rect = (x, y, width, height, fill, stroke = '#59615b') =>
  shapes.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" stroke="${stroke}"/>`);
const floor = (u, d, w, l, fill) => rect(ox + u * scale, oy + d * scale, w * scale, l * scale, fill);
text(60, 48, '商業アトリウム R2 大型カフェ', 26);
text(60, 78, '平面・長手断面 / 単位 m / 仮想施設の独自設計 / 2026-11-28', 15);
text(100, 115, '平面：u = 間口方向、d = 入口から奥（世界 +X）', 16);
floor(0, 0, plan.width, plan.depth, '#f2efe7');
floor(...plan.aisle, '#d7e7d9');
floor(3.8, 2.7, 1.5, 4.9, '#f5dfb7');
for (const [u, d, w, l] of Object.values(plan.clearAreas)) shapes.push(`<rect x="${ox + u * scale}" y="${oy + d * scale}" width="${w * scale}" height="${l * scale}" fill="none" stroke="#598b8f" stroke-width="1.4" stroke-dasharray="4 3"/>`);
for (const item of bay.fixtures) {
  const color = item.type === 'table' ? '#cfbaa0' : item.type === 'seat' ? '#7e8c81'
    : item.type === 'bench' ? '#9dada2' : item.type === 'plant' ? '#617c59'
      : item.id === 'R2-04' ? '#bbb6aa' : '#ad9276';
  floor(...item.rect, color);
  if (item.type !== 'seat') {
    const [u, d, w, l] = item.rect;
    text(ox + (u + w / 2) * scale, oy + (d + l / 2) * scale + 4, item.id, 10, 'middle');
  }
}
for (const d of plan.frameStations) for (const u of [.30, 9.80]) floor(u - .12, d - .12, .24, .24, '#554d42');
for (const speaker of speakers) {
  const { u, d } = atriumCafeLocalPoint(speaker.position[0], speaker.position[2]);
  shapes.push(`<circle cx="${ox + u * scale}" cy="${oy + d * scale}" r="6" fill="#263c5a"/>`);
}
for (const light of plan.ceilingLights) shapes.push(`<circle cx="${ox + light.u * scale}" cy="${oy + light.d * scale}" r="5" fill="none" stroke="#ad7b32" stroke-width="2"/>`);
for (const [index, point] of bay.route.entries()) {
  const previous = bay.route[Math.max(0, index - 1)];
  line(ox + previous[0] * scale, oy + previous[1] * scale, ox + point[0] * scale, oy + point[1] * scale, '#257349', 3, '7 4');
}
line(ox + bay.entry[0] * scale, oy, ox + bay.entry[1] * scale, oy, '#26764d', 6);
text(ox + (bay.entry[0] + bay.entry[1]) / 2 * scale, oy - 12, '入口 4.20', 14, 'middle');
line(ox, oy - 42, ox + plan.width * scale, oy - 42);
text(ox + plan.width * scale / 2, oy - 48, '10.10（間口保存）', 13, 'middle');
line(ox - 35, oy, ox - 35, oy + plan.depth * scale);
text(ox - 42, oy + plan.depth * scale / 2, '18.40', 13, 'end');
text(500, 240, '主通路 1.80', 16);
text(500, 270, '注文待機 1.50', 16);
text(500, 300, '作業帯 1.85', 16);
text(500, 345, `客席 ${plan.seating.total}：椅子${plan.seating.movableSeats}＋ベンチ${plan.seating.pairedBenchPlaces}（外席別）`, 16);
text(500, 375, '青点：壁付speaker 6基', 15);
text(500, 405, '高さ2.82 / 客席へ25°下向き', 14);
text(500, 435, '金点：天井4系統 / 青破線：回転・接近余白', 14);
text(500, 465, '奥まで床・側壁・天井・奥壁で閉鎖', 15);
text(500, 495, '旧奥壁 d9.10 → 新奥壁 d18.40', 15);
line(ox, oy + 9.1 * scale, ox + plan.width * scale, oy + 9.1 * scale, '#aa7159', 1.5, '6 4');
const sx = 90, sy = 1165, ss = 48;
text(90, 955, '長手断面：u6.40 主動線 / 全体奥行と支持', 18);
rect(sx, sy, plan.depth * ss, .09 * ss, '#aaa28f');
rect(sx, sy - plan.ceiling * ss - .09 * ss, plan.depth * ss, .09 * ss, '#d4cbb9');
rect(sx, sy - plan.roofTop * ss, plan.depth * ss, plan.roofDepth * ss, '#a9aca8');
rect(sx + plan.depth * ss, sy - plan.ceiling * ss, .20 * ss, plan.ceiling * ss, '#ada58f');
for (const d of plan.frameStations) {
  rect(sx + (d - .12) * ss, sy - plan.primaryBeamTop * ss, .24 * ss,
    (plan.primaryBeamTop - plan.primaryBeamBottom) * ss, '#4e595a');
  line(sx + d * ss, sy - 3.54 * ss, sx + d * ss, sy - plan.primaryBeamBottom * ss, '#5b6260');
  rect(sx + (d - .12) * ss, sy - 3.36 * ss, .24 * ss, .18 * ss, '#79664f');
  line(sx + d * ss, sy, sx + d * ss, sy - 3.18 * ss, '#a59985', 1, '4 4');
}
text(90, 1215, 'FL0 / 天井下面3.45 / 化粧梁下3.18 / 主鋼梁3.60–4.04 / 閉じた屋根上面4.16', 15);
text(90, 1245, '柱240角は側壁際u.30/9.80。図の破線は側方支持位置。実施設の構造認証ではない。', 14);
text(90, 1275, '生成元：tenant-interiors.json R2 + atriumCafePlan.ts。客・スタッフ・固定境界を共通座標で照合。', 13);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="1320" viewBox="0 0 1120 1320"><rect width="1120" height="1320" fill="#fffdf8"/><g font-family="Hiragino Sans, Noto Sans CJK JP, sans-serif" fill="#26342f">${shapes.join('')}</g></svg>`;
await writeFile(new URL('../docs/atrium/cafe-plan-section.svg', import.meta.url), svg);
console.log('cafe plan/section SVG generated from the shared design inputs');
