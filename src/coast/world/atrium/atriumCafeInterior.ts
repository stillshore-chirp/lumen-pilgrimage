import {
  BufferGeometry, CanvasTexture, CylinderGeometry, DataTexture, Float32BufferAttribute,
  Group, LatheGeometry, LinearFilter, Mesh, MeshStandardMaterial, RepeatWrapping, RGBAFormat,
  SRGBColorSpace, TorusGeometry, Vector2, Vector3,
} from 'three';
import type { Material } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { TenantBuildContext } from './atriumTenantArchitecture';
import type { TenantFixture } from './atriumTenantPlan';
import { ATRIUM_CAFE_PLAN, ATRIUM_CAFE_SPEAKERS, atriumCafeLocalPoint } from './atriumCafePlan';

type CafeMaterials = ReturnType<typeof cafeMaterials>;
type Contact = readonly [u: number, d: number, radiusU: number, radiusD: number, loss: number];

function surfaceTexture(kind: 'oak' | 'fabric' | 'mineral'): DataTexture {
  const size = 128, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const grain = Math.sin(x * .43 + 1.7 * Math.sin(y * .026)) + .35 * Math.sin(x * 2.13 + y * .011);
    const weave = (x % 4 < 2 ? 1 : -1) * 2 + (y % 4 < 2 ? 1 : -1) * 1.5;
    const base = kind === 'oak' ? [174, 158, 135] : kind === 'fabric' ? [234, 234, 230] : [240, 239, 233];
    const variation = kind === 'oak' ? grain * 3.2 : kind === 'fabric' ? weave :
      (Math.sin(x * 17.19 + y * 91.73) * 43758.54 % 1) * 1.6;
    const at = (y * size + x) * 4;
    for (let channel = 0; channel < 3; channel++) pixels[at + channel] = base[channel] + variation;
    pixels[at + 3] = 255;
  }
  const texture = new DataTexture(pixels, size, size, RGBAFormat);
  texture.name = `Cafe original restrained ${kind} surface`;
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  const repeat = kind === 'oak' ? .75 : kind === 'fabric' ? 10 : 2;
  texture.repeat.set(repeat, repeat);
  texture.magFilter = LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function cafeMaterials(context: TenantBuildContext) {
  const oak = surfaceTexture('oak'), weave = surfaceTexture('fabric');
  const material = (name: string, color: number, roughness: number, metalness = 0) =>
    new MeshStandardMaterial({ name: `Cafe ${name}`, color, roughness, metalness });
  const wood = material('matte oak joinery', 0xd2d0c7, .76);
  wood.map = oak;
  const darkWood = material('smoked oak frame', 0x8b8b80, .79);
  darkWood.map = oak;
  const fabric = material('sage woven upholstery', 0x8b978e, .96);
  fabric.map = weave;
  const paleFabric = material('warm grey acoustic fabric', 0xc7c7bc, .97);
  paleFabric.map = weave;
  const stone = context.palette.cream.clone();
  stone.name = 'Cafe pale honed mineral worktop'; stone.color.setHex(0xd4d1c5); stone.roughness = .60;
  stone.map = surfaceTexture('mineral');
  const metal = material('warm graphite metal', 0x3d423e, .43, .55);
  const steel = material('brushed service steel', 0xa6aeaa, .31, .78);
  const ceramic = material('ivory ceramic', 0xe0dfd5, .30);
  const dark = material('rubber and shadow recess', 0x252b28, .85);
  const soil = material('dark potting soil', 0x3d3a2e, 1);
  const leaf = material('deep green leaves', 0x435a45, .82);
  const leafLight = material('quiet leaf highlights', 0x687b59, .84);
  const plaster = material('warm mineral wall', 0xd3d1c5, .92);
  const terracotta = material('muted ceramic vessel', 0x8b8473, .82);
  return { wood, darkWood, fabric, paleFabric, stone, metal, steel, ceramic, dark, soil, leaf, leafLight, plaster, terracotta };
}

/** UV0 follows metres. AO uses an independent floor-wide UV1 below. */
function metricUV(mesh: Mesh, w: number, h: number, l: number): Mesh {
  const material = mesh.material;
  if (!(material instanceof MeshStandardMaterial) || !material.map) return mesh;
  const geometry = mesh.geometry.clone(), uv = geometry.getAttribute('uv'), normal = geometry.getAttribute('normal');
  if (!uv || !normal) return mesh;
  for (let i = 0; i < uv.count; i++) {
    const horizontal = Math.abs(normal.getX(i)) > .5 ? l : w;
    const vertical = Math.abs(normal.getY(i)) > .5 ? l : h;
    uv.setXY(i, uv.getX(i) * horizontal, uv.getY(i) * vertical);
  }
  mesh.geometry = geometry;
  return mesh;
}

function curvedBack(width: number, bottom: number, top: number, offset: number, thickness: number): BufferGeometry {
  const vertices: number[] = [], indices: number[] = [], count = 12;
  for (let i = 0; i <= count; i++) {
    const x = -width / 2 + width * i / count;
    const z = offset + .07 * (x / (width / 2)) ** 2;
    vertices.push(x, bottom, z - thickness / 2, x, top, z - thickness / 2,
      x, bottom, z + thickness / 2, x, top, z + thickness / 2);
    if (i < count) {
      const a = i * 4, b = a + 4;
      for (const [p, q] of [[0, 1], [3, 2], [1, 3], [2, 0]]) {
        indices.push(a + p, b + p, a + q, a + q, b + p, b + q);
      }
    }
  }
  indices.push(0, 1, 2, 2, 1, 3, count * 4, count * 4 + 2, count * 4 + 1,
    count * 4 + 1, count * 4 + 2, count * 4 + 3);
  for (let i = 0; i < indices.length; i += 3) [indices[i], indices[i + 2]] = [indices[i + 2], indices[i]];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(vertices.flatMap((value, i) =>
    i % 3 === 0 ? [value + width / 2, vertices[i + 1]] : []), 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

export function buildCafeInterior(context: TenantBuildContext): void {
  const { box, cylinder, point, group } = context, m = cafeMaterials(context);
  const contacts: Contact[] = [];
  const b = (material: Material, u: number, y: number, d: number, w: number, h: number, l: number, name: string) =>
    metricUV(box(material, u, y, d, w, h, l, name), w, h, l);
  const rounded = (material: Material, u: number, y: number, d: number, w: number, h: number, l: number, name: string, radius = .016) => {
    const mesh = new Mesh(new RoundedBoxGeometry(w, h, l, 2, Math.min(radius, h * .45)), material);
    mesh.name = name; mesh.position.copy(point(u, y, d)); mesh.rotation.y = Math.PI / 2;
    mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
    return metricUV(mesh, w, h, l);
  };
  // Replace only the R2 room surfaces; neighbouring tenants retain their palette.
  for (const child of group.children) {
    if (!(child instanceof Mesh)) continue;
    if (child.name === 'R2 finished back wall' || child.name === 'R2 side wall with visible return') child.material = m.plaster;
    if (['Cafe floor-to-head side post', 'Cafe continuous side head', 'Cafe supported transverse ceiling beam'].includes(child.name)) {
      child.material = m.darkWood; metricUV(child, child.scale.x, child.scale.y, child.scale.z);
    }
    if (child.name === 'R2 timber ceiling lining') {
      child.material = m.wood; metricUV(child, child.scale.x, child.scale.y, child.scale.z);
    }
    if (child.name === 'R2 tenant floor at FL0' && child.material instanceof MeshStandardMaterial) {
      const finish = child.material.clone(); finish.name = 'Cafe quiet mineral floor'; finish.color.setHex(0xc6cbc6);
      finish.roughness = .78; child.material = finish;
    }
  }
  const cup = (u: number, d: number, y: number, name: string) => {
    cylinder(m.ceramic, u, y + .061, d, .044, .09, `${name} ceramic cup`);
    cylinder(m.dark, u, y + .107, d, .033, .004, `${name} dark coffee surface`);
    cylinder(m.ceramic, u, y + .008, d, .067, .016, `${name} saucer`);
    const handle = new Mesh(new TorusGeometry(.023, .007, 5, 12), m.ceramic);
    handle.name = `${name} cup handle`; handle.position.copy(point(u + .045, y + .068, d));
    handle.rotation.y = Math.PI / 2; group.add(handle);
  };
  const table = (item: TenantFixture) => {
    const [u, d, w, l] = item.rect, cu = u + w / 2, cd = d + l / 2;
    rounded(m.stone, cu, item.height - .026, cd, w, .052, l, `${item.id} honed table top`);
    const underside = item.height - .052;
    cylinder(m.metal, cu, (.034 + underside) / 2, cd, .044, underside - .034, `${item.id} pedestal stem`);
    rounded(m.metal, cu, .017, cd, Math.min(.52, w * .76), .034, Math.min(.52, l * .76), `${item.id} grounded foot plate`, .012);
    contacts.push([cu, cd, .31, .31, .25]);
    if (item.id === 'R2-T02' || item.id === 'R2-T05' || item.id === 'R2-F02') cup(cu, cd, item.height, item.id);
  };
  const chair = (item: TenantFixture) => {
    const [u, d, w, l] = item.rect, cu = u + w / 2, cd = d + l / 2;
    const seat = item.seatHeight ?? .45, back = item.backHeight ?? item.height;
    const yaw = item.id.startsWith('R2-C') ? Math.PI / 2 : item.id.endsWith('C1') || item.id.endsWith('C2') ? 0 : Math.PI;
    const chairGroup = new Group(); chairGroup.name = `${item.id} supported dining chair`;
    chairGroup.position.copy(point(cu, 0, cd)); chairGroup.rotation.y = Math.PI / 2 + yaw; group.add(chairGroup);
    const add = (geometry: BufferGeometry, material: Material, x: number, y: number, z: number, name: string) => {
      const mesh = new Mesh(geometry, material); mesh.name = `${item.id} ${name}`;
      mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; chairGroup.add(mesh); return mesh;
    };
    add(new RoundedBoxGeometry(.49, .09, .45, 2, .026), m.fabric, 0, seat - .045, 0, 'woven seat at450mm');
    add(new RoundedBoxGeometry(.45, .055, .42, 1, .014), m.wood, 0, seat - .1125, 0, 'seat support frame');
    add(curvedBack(.48, seat + .02, back, -.225, .034), m.wood, 0, 0, 0, 'bent oak back');
    add(curvedBack(.425, seat + .17, back - .06, -.200, .018), m.fabric, 0, 0, 0, 'curved upholstered back pad');
    for (const x of [-.18, .18]) for (const z of [-.145, .145]) {
      const foot = new Vector3(Math.sign(x) * .215, .006, Math.sign(z) * .205), top = new Vector3(x, seat - .11, z);
      const leg = add(new CylinderGeometry(.018, .022, top.distanceTo(foot), 8), m.darkWood,
        (top.x + foot.x) / 2, (top.y + foot.y) / 2, (top.z + foot.z) / 2, 'splayed timber leg');
      leg.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), top.clone().sub(foot).normalize());
      add(new CylinderGeometry(.025, .025, .006, 10), m.dark, foot.x, .003, foot.z, 'floor-contact glide');
      const du = Math.cos(yaw) * foot.x + Math.sin(yaw) * foot.z;
      const dd = -Math.sin(yaw) * foot.x + Math.cos(yaw) * foot.z;
      contacts.push([cu + du, cd + dd, .065, .065, .28]);
    }
  };
  for (const item of context.bay.fixtures) {
    if (item.type === 'table') table(item);
    if (item.type === 'seat') chair(item);
  }
  // Continuous seat and plinth; the back is split at every structural column.
  b(m.darkWood, 9.39, .04, 10.40, .52, .08, 15.40, 'Cafe banquette grounded recessed plinth');
  b(m.wood, 9.39, .235, 10.40, .54, .31, 15.40, 'Cafe banquette supported lower joinery');
  for (let d = 2.72; d < 18.05; d += .80) {
    const length = Math.min(.775, 18.08 - d);
    rounded(m.fabric, 9.39, .405, d + length / 2, .54, .09, length, 'Cafe tailored banquette seat cushion', .025);
  }
  const backSegments: [number, number][] = [[2.70, 7.96], [8.24, 15.46], [15.74, 17.96]];
  for (const [start, end] of backSegments) {
    b(m.wood, 9.67, .36, (start + end) / 2, .10, .06, end - start, 'Cafe banquette back cleat into base');
    b(m.darkWood, 9.76, .72, (start + end) / 2, .15, .80, end - start, 'Cafe banquette column-notched back support');
    rounded(m.fabric, 9.66, .815, (start + end) / 2, .14, .61, end - start - .025, 'Cafe upholstered banquette back', .025);
  }
  contacts.push([9.39, 10.4, .38, 7.82, .22]);
  for (const d of [2.70, 18.10]) b(m.wood, 9.39, .31, d, .54, .62, .045, 'Cafe banquette finished end cheek');
  // The bar and the low parallel-approach order point share a continuous service side.
  for (const id of ['R2-01', 'R2-02']) {
    const item = context.bay.fixtures.find(f => f.id === id)!;
    const [u, d, w, l] = item.rect, height = item.height;
    b(m.dark, u + w / 2, .04, d + l / 2, w - .12, .08, l - .06, `${id} floor plinth`);
    b(m.wood, u + w / 2, (height - .055 + .08) / 2, d + l / 2, w - .025, height - .135, l - .025, `${id} cabinet body`);
    rounded(m.stone, u + w / 2, height - .0275, d + l / 2, w + .035, .055, l + .025, `${id} rounded mineral counter`);
    for (let joint = d + .035; joint < d + l - .02; joint += .065) {
      b(m.darkWood, u + w + .002, (height + .12) / 2, joint, .013, height - .24, .012, `${id} fine cabinet relief`);
    }
    contacts.push([u + w / 2, d + l / 2, w / 2, l / 2, .20]);
  }
  b(m.wood, .60, .43, 4.685, .65, .86, 3.97, 'Cafe back bar grounded dry cabinetry');
  b(m.wood, .60, .43, 7.355, .65, .86, .49, 'Cafe back bar cleaning end cabinet');
  b(m.wood, .60, .30, 6.89, .65, .60, .44, 'Cafe lower sink cabinet without false top');
  for (const u of [.295, .905]) b(m.wood, u, .73, 6.89, .04, .26, .44, 'Cafe sink cabinet side support');
  b(m.stone, .60, .895, 4.685, .68, .05, 3.97, 'Cafe back bar dry worktop');
  b(m.stone, .60, .895, 7.355, .68, .05, .49, 'Cafe cleaning end worktop');
  for (const u of [.32, .88]) b(m.stone, u, .895, 6.89, .12, .05, .44, 'Cafe sink countertop side');
  const basin = new Mesh(new LatheGeometry([
    new Vector2(0, -.14), new Vector2(.12, -.14), new Vector2(.18, -.12), new Vector2(.22, -.015),
    new Vector2(.22, 0), new Vector2(.195, -.015), new Vector2(.155, -.105), new Vector2(0, -.11),
  ], 24), m.steel);
  basin.name = 'Cafe open washing basin with inner and outer walls'; basin.position.copy(point(.60, .92, 6.89)); group.add(basin);
  b(m.steel, .32, 1.035, 6.89, .025, .28, .025, 'Cafe cleaning tap upright');
  b(m.steel, .40, 1.17, 6.89, .18, .025, .025, 'Cafe tap bridge');
  b(m.steel, .48, 1.14, 6.89, .025, .06, .025, 'Cafe tap downward spout');
  for (const y of [1.48, 1.89, 2.30]) {
    b(m.wood, .465, y, 4.70, .57, .035, 3.80, 'Cafe back bar supported shelf');
    for (const d of [2.85, 4.75, 6.55]) b(m.metal, .425, y - .11, d, .49, .20, .018, 'Cafe shelf load bracket');
  }
  for (const d of [3.05, 3.34, 3.63, 5.90, 6.15]) {
    cylinder(m.ceramic, .48, 1.57, d, .065, .15, 'Cafe clean ceramic shelf vessel');
  }
  b(m.steel, .927, .45, 5.80, .016, .68, .60, 'Cafe refrigeration cabinet at shared equipment source');
  b(m.metal, .946, .67, 5.80, .025, .018, .45, 'Cafe refrigerator handle');
  for (let row = 0; row < 6; row++) b(m.dark, .938, .21 + row * .024, 5.80,
    .006, .009, .48, 'Cafe refrigerator ventilation slots');
  const menu = new MeshStandardMaterial({ name: 'Cafe original service menu', color: 0xe0dfd5, roughness: .92 });
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
    const ink = canvas.getContext('2d');
    if (ink) {
      ink.fillStyle = '#deded2'; ink.fillRect(0, 0, 1024, 256);
      ink.fillStyle = '#37433b'; ink.textAlign = 'center';
      ink.font = '40px Georgia, serif'; ink.fillText('COFFEE  /  TEA', 512, 67);
      ink.font = '27px system-ui, sans-serif'; ink.fillText('Espresso     Filter     Latte', 512, 126);
      ink.fillText('Tea     Cacao     Baked daily', 512, 181);
      const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
      texture.name = 'Cafe original typeset menu'; texture.anisotropy = 4; menu.map = texture;
    }
  }
  b(m.darkWood, .20, 2.67, 4.70, .045, .76, 2.72, 'Cafe menu supported timber frame');
  box(menu, .227, 2.67, 4.70, .018, .68, 2.60, 'Cafe legible service menu');
  const shelfGlow = context.glow('Cafe concealed service shelf light', 0xffe4ba, .45);
  b(shelfGlow, .73, 1.455, 4.70, .018, .014, 3.66, 'Cafe screened under-shelf diffuser');
  // Readable independent service equipment, without external brands or logos.
  rounded(m.metal, .61, 1.14, 4.60, .47, .46, .80, 'Cafe two-group espresso machine');
  b(m.steel, .852, 1.16, 4.60, .025, .28, .67, 'Cafe espresso brushed front panel');
  for (const d of [4.38, 4.80]) {
    b(m.steel, .89, 1.15, d, .09, .04, .10, 'Cafe supported group arm');
    cylinder(m.steel, .91, 1.10, d, .028, .08, 'Cafe brew group'); cup(.94, d, .9575, 'Cafe service cup');
  }
  b(m.steel, .88, .94, 4.60, .20, .035, .70, 'Cafe espresso drip tray');
  cylinder(m.metal, .57, 1.075, 5.42, .095, .31, 'Cafe grinder motor');
  cylinder(context.palette.caseGlass, .57, 1.35, 5.42, .105, .24, 'Cafe grinder hopper');
  cylinder(m.darkWood, .57, 1.34, 5.42, .088, .18, 'Cafe hopper beans');
  b(m.metal, 3.25, .88, 3.15, .20, .04, .20, 'Cafe terminal grounded counter base');
  b(m.metal, 3.25, .9175, 3.15, .04, .035, .04, 'Cafe terminal support stem');
  rounded(m.metal, 3.25, 1.025, 3.15, .25, .24, .24, 'Cafe compact payment terminal');
  b(m.dark, 3.379, 1.09, 3.15, .008, .10, .17, 'Cafe payment display');
  b(m.stone, 3.13, 1.066, 7.22, .47, .032, .55, 'Cafe return tray'); cup(3.08, 7.22, 1.082, 'Cafe returned cup');
  // Closed gate and the rear stock room read as staff access, not missing floors.
  b(m.wood, 1.825, .45, 2.70, 1.85, .90, .12, 'Cafe service front return');
  b(m.darkWood, 1.825, .90, 7.60, 1.85, 1.80, .09, 'Cafe closed staff access gate');
  b(m.steel, 2.40, 1.04, 7.657, .16, .018, .028, 'Cafe staff gate handle');
  b(m.plaster, 2.15, 1.725, 17.025, 3.60, 3.45, 2.35, 'Cafe closed stock room');
  b(m.darkWood, 3.40, 1.15, 15.842, .96, 2.34, .024, 'Cafe stock room door frame');
  b(m.wood, 3.40, 1.14, 15.824, .89, 2.28, .026, 'Cafe closed flush stock door');
  b(m.steel, 3.72, 1.03, 15.803, .12, .016, .025, 'Cafe stock door lever');
  for (const u of [.75, 1.45, 2.15]) {
    b(m.wood, u, 1.25, 15.838, .67, 2.50, .025, 'Cafe stock wall quiet oak panel');
  }
  // Rear destination and acoustic wall fields break the long blank enclosure.
  for (const u of [5.10, 6.65, 8.20]) {
    b(m.darkWood, u, 1.93, 18.39, 1.35, 1.57, .04, 'Cafe rear wall framed relief');
    b(m.paleFabric, u, 1.93, 18.36, 1.29, 1.51, .025, 'Cafe rear acoustic fabric field');
    for (const offset of [-.34, .05, .37]) {
      b(m.wood, u + offset, 1.95, 18.34, .075, .77 + offset * .4, .025, 'Cafe original timber relief element');
    }
  }
  for (let d = 3.0; d < 17.9; d += .75) {
    b(m.wood, 9.915, 1.75, d, .035, 1.14, .65, 'Cafe banquette oak acoustic wall field');
  }
  for (const item of context.bay.fixtures.filter(f => f.type === 'plant')) {
    const [u, d, w, l] = item.rect, cu = u + w / 2, cd = d + l / 2;
    cylinder(m.terracotta, cu, .225, cd, .25, .45, `${item.id} grounded ceramic planter`);
    cylinder(m.soil, cu, .449, cd, .215, .006, `${item.id} soil and rooted stems`);
    contacts.push([cu, cd, .30, .30, .20]);
    for (let i = 0; i < 9; i++) {
      const angle = i * 2.399, lift = item.height - .45;
      const height = lift * (i === 8 ? .66 : .42 + (i % 4) * .06);
      const du = i === 8 ? 0 : Math.sin(angle) * .14, dd = i === 8 ? 0 : Math.cos(angle) * .14;
      const root = point(cu, .45, cd), tip = point(cu + du, .45 + height, cd + dd);
      const stem = new Mesh(new CylinderGeometry(.007, .010, root.distanceTo(tip), 6), m.leaf);
      stem.name = `${item.id} continuous rooted leaf stem`; stem.position.copy(root.clone().add(tip).multiplyScalar(.5));
      stem.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), tip.clone().sub(root).normalize()); group.add(stem);
      const geometry = leafBlade(.14, lift * (i === 8 ? .34 : .26 + (i % 3) * .04));
      const mesh = new Mesh(geometry, i % 3 ? m.leaf : m.leafLight);
      mesh.name = `${item.id} cupped leaf blade`; mesh.position.copy(point(cu + du, .45 + height, cd + dd));
      mesh.rotation.set(i === 8 ? 0 : -.12 + (i % 3) * .12, angle, i === 8 ? 0 : (i % 2 ? 1 : -1) * .22);
      mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
    }
  }
  const [entryLow, entryHigh, recess] = context.bay.entry;
  b(m.terracotta, (entryLow + entryHigh) / 2, 3.00, recess + .18,
    entryHigh - entryLow - .24, .12, .30, 'Cafe supported overhead planting trough');
  b(m.soil, (entryLow + entryHigh) / 2, 3.061, recess + .18,
    entryHigh - entryLow - .28, .003, .25, 'Cafe overhead planting soil');
  for (let i = 0; i < 22; i++) {
    const u = entryLow + .17 + (entryHigh - entryLow - .34) * (i + .5) / 22;
    const leaf = new Mesh(leafBlade(.13, .20 + i % 3 * .02), i % 3 ? m.leaf : m.leafLight);
    leaf.name = 'Cafe overhead band rooted leaf'; leaf.position.copy(point(u, 3.055, recess + .18));
    leaf.rotation.set(.08 * (i % 3), i * 2.399, (i % 2 ? 1 : -1) * .96); group.add(leaf);
  }
  for (const d of ATRIUM_CAFE_PLAN.frameStations) for (const u of [.30, 9.80]) contacts.push([u, d, .20, .20, .20]);
  contacts.push([.60, 5.15, .43, 2.50, .18], [2.15, 15.85, 1.85, .12, .15], [3.95, 17.0, .12, 1.2, .15]);
  for (const [u, d, w, l] of ATRIUM_CAFE_PLAN.ceilingPanels) {
    b(m.paleFabric, u + w / 2, (ATRIUM_CAFE_PLAN.ceilingPanelBottom + ATRIUM_CAFE_PLAN.ceiling) / 2,
      d + l / 2, w, ATRIUM_CAFE_PLAN.ceiling - ATRIUM_CAFE_PLAN.ceilingPanelBottom, l,
      'Cafe acoustic finish fixed to the ceiling substrate');
  }
  addSpeakers(context, m);
  applyFloorContactAO(context, contacts);
}

function leafBlade(width: number, length: number): BufferGeometry {
  const positions: number[] = [], indices: number[] = [];
  for (let row = 0; row <= 8; row++) {
    const t = row / 8, half = width * Math.sin(Math.PI * t) / 2;
    for (const side of [-1, 0, 1]) positions.push(side * half, t * length, .06 * Math.sin(Math.PI * t) + Math.abs(side) * .018);
    if (row < 8) for (let col = 0; col < 2; col++) {
      const a = row * 3 + col; indices.push(a, a + 1, a + 3, a + 1, a + 4, a + 3);
    }
  }
  const offset = positions.length / 3;
  const front = [...positions], frontIndices = [...indices];
  for (let i = 0; i < front.length; i += 3) positions.push(front[i], front[i + 1], front[i + 2] - .002);
  for (let i = 0; i < frontIndices.length; i += 3) indices.push(frontIndices[i + 2] + offset, frontIndices[i + 1] + offset, frontIndices[i] + offset);
  for (let row = 0; row < 8; row++) for (const col of [0, 2]) {
    const a = row * 3 + col, b = a + 3;
    if (col === 0) indices.push(a, b, a + offset, a + offset, b, b + offset);
    else indices.push(a, a + offset, b, a + offset, b + offset, b);
  }
  const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}

function addSpeakers(context: TenantBuildContext, m: CafeMaterials): void {
  const { speakerCabinet: cabinet, speakerBracket: bracket } = ATRIUM_CAFE_PLAN;
  for (const speaker of ATRIUM_CAFE_SPEAKERS) {
    const { u, d } = atriumCafeLocalPoint(speaker.position[0], speaker.position[2]);
    const left = u < ATRIUM_CAFE_PLAN.width / 2;
    context.box(m.metal, left ? bracket.centerU : ATRIUM_CAFE_PLAN.width - bracket.centerU, speaker.position[1], d,
      bracket.width, bracket.height, bracket.depth, `${speaker.id} wall-anchored bracket`);
    const assembly = new Group(); assembly.name = `${speaker.id} compact coaxial cabinet`;
    assembly.position.set(...speaker.position); assembly.lookAt(new Vector3(...speaker.position).add(new Vector3(...speaker.aim)));
    context.group.add(assembly);
    const body = new Mesh(new RoundedBoxGeometry(cabinet.width, cabinet.height, cabinet.depth, 2, .015), m.metal);
    body.name = `${speaker.id} closed cabinet`; body.castShadow = body.receiveShadow = true; assembly.add(body);
    const grille = new Mesh(new RoundedBoxGeometry(.185, .30, .012, 1, .008), m.dark);
    grille.position.z = .106; grille.name = `${speaker.id} recessed front grille`; assembly.add(grille);
    const ring = new Mesh(new TorusGeometry(.059, .006, 5, 24), m.metal);
    ring.position.set(0, -.025, .116); ring.name = `${speaker.id} coaxial driver surround`; assembly.add(ring);
    const driver = new Mesh(new CylinderGeometry(.052, .052, .007, 20), m.darkWood);
    driver.rotation.x = Math.PI / 2; driver.position.set(0, -.025, .117); driver.name = `${speaker.id} driver front`; assembly.add(driver);
    const tweeter = new Mesh(new CylinderGeometry(.017, .017, .009, 12), m.steel);
    tweeter.rotation.x = Math.PI / 2; tweeter.position.set(0, -.025, .125); tweeter.name = `${speaker.id} central tweeter`; assembly.add(tweeter);
  }
}

function applyFloorContactAO(context: TenantBuildContext, contacts: readonly Contact[]): void {
  const floor = context.group.children.find(child => child.name === 'R2 tenant floor at FL0');
  if (!(floor instanceof Mesh) || !(floor.material instanceof MeshStandardMaterial)) return;
  const size = 512, pixels = new Uint8Array(size * size * 4).fill(255);
  for (const [u, d, ru, rd, loss] of contacts) {
    const minX = Math.max(0, Math.floor((u - ru * 1.8) / ATRIUM_CAFE_PLAN.width * size));
    const maxX = Math.min(size - 1, Math.ceil((u + ru * 1.8) / ATRIUM_CAFE_PLAN.width * size));
    const minY = Math.max(0, Math.floor((d - rd * 1.8) / ATRIUM_CAFE_PLAN.depth * size));
    const maxY = Math.min(size - 1, Math.ceil((d + rd * 1.8) / ATRIUM_CAFE_PLAN.depth * size));
    for (let iy = minY; iy <= maxY; iy++) for (let ix = minX; ix <= maxX; ix++) {
      const dist = ((ix / size * ATRIUM_CAFE_PLAN.width - u) / ru) ** 2 + ((iy / size * ATRIUM_CAFE_PLAN.depth - d) / rd) ** 2;
      const r = Math.round(255 * (1 - loss * Math.exp(-dist * 2.2))), at = (iy * size + ix) * 4;
      pixels[at] = pixels[at + 1] = pixels[at + 2] = Math.min(pixels[at], r);
    }
  }
  const ao = new DataTexture(pixels, size, size, RGBAFormat); ao.name = 'Cafe geometry-derived contact approximation';
  ao.magFilter = LinearFilter; ao.needsUpdate = true; ao.channel = 1;
  floor.material.aoMap = ao; floor.material.aoMapIntensity = 1; floor.material.needsUpdate = true;
  context.group.updateMatrixWorld(true);
  const geometry = floor.geometry.clone(), position = geometry.getAttribute('position'), uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const p = new Vector3().fromBufferAttribute(position, i).applyMatrix4(floor.matrixWorld);
    const local = atriumCafeLocalPoint(p.x, p.z); uv[i * 2] = local.u / ATRIUM_CAFE_PLAN.width; uv[i * 2 + 1] = local.d / ATRIUM_CAFE_PLAN.depth;
  }
  geometry.setAttribute('uv1', new Float32BufferAttribute(uv, 2)); floor.geometry = geometry;
}
