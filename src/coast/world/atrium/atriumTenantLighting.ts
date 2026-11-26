import {
  Color, DoubleSide, FrontSide, MeshStandardMaterial, NoColorSpace, PointLight, RepeatWrapping,
  SRGBColorSpace, TextureLoader, Vector2,
} from 'three';
import type { Texture } from 'three';
import type { TenantBuildContext } from './atriumTenantArchitecture';
import { ATRIUM_TENANT_LIGHTING } from './atriumTenantPlan';

/** Shared finishes for the first-floor tenant bays.
 *
 * The fields deliberately use the standard material path. Transparent shop
 * fronts use alpha/depthWrite settings on the same path, keeping the number of
 * shader programs stable while preserving the layered glass reading.
 */
export interface TenantPalette {
  wood: MeshStandardMaterial;
  lightWood: MeshStandardMaterial;
  darkWood: MeshStandardMaterial;
  stone: MeshStandardMaterial;
  cream: MeshStandardMaterial;
  plaster: MeshStandardMaterial;
  dark: MeshStandardMaterial;
  bronze: MeshStandardMaterial;
  brass: MeshStandardMaterial;
  glass: MeshStandardMaterial;
  caseGlass: MeshStandardMaterial;
  fabric: MeshStandardMaterial;
  white: MeshStandardMaterial;
}

type GlowRecord = {
  material: MeshStandardMaterial;
  onIntensity: number;
};

type TenantTexture = {
  texture: Texture;
  colorSpace: typeof SRGBColorSpace | typeof NoColorSpace;
  repeat: readonly [number, number];
};

async function loadTenantTexture(file: string, colorSpace: TenantTexture['colorSpace'], repeat: readonly [number, number]): Promise<Texture | null> {
  if (typeof document === 'undefined') return null;
  const loader = new TextureLoader();
  try {
    const texture = await loader.loadAsync(`${import.meta.env.BASE_URL}residence-materials/${file}.webp`);
    texture.name = `tenant ${file}`;
    texture.colorSpace = colorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.set(repeat[0], repeat[1]);
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    return texture;
  } catch {
    return null;
  }
}

function standard(name: string, color: number, roughness: number, metalness = 0): MeshStandardMaterial {
  return new MeshStandardMaterial({ name, color, roughness, metalness });
}

function transparent(name: string, color: number, opacity: number, roughness: number,
  side: typeof DoubleSide | typeof FrontSide = DoubleSide): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    name, color, roughness, metalness: 0.02, transparent: true, opacity,
    depthWrite: false, side,
  });
  material.forceSinglePass = true;
  return material;
}

function applyOakMaps(material: MeshStandardMaterial, color: number, maps: readonly (Texture | null)[]): void {
  material.color.set(color);
  material.map = maps[0];
  material.normalMap = maps[1];
  material.roughnessMap = maps[2];
  material.normalScale = new Vector2(.37, .37);
  material.roughness = .74;
  material.envMapIntensity = .22;
  material.needsUpdate = true;
}

/** Load the permitted residence textures and create named tenant finishes. */
export async function createTenantFinishes(stoneMap: Texture | null): Promise<{
  palette: TenantPalette;
  glow(name: string, color: number, onIntensity: number): MeshStandardMaterial;
  setLighting(on: boolean): void;
}> {
  const [oakColor, oakNormal, oakRoughness] = await Promise.all([
    loadTenantTexture('oak-color', SRGBColorSpace, [1 / 1.8, 1 / 1.45]),
    loadTenantTexture('oak-normal', NoColorSpace, [1 / 1.8, 1 / 1.45]),
    loadTenantTexture('oak-roughness', NoColorSpace, [1 / 1.8, 1 / 1.45]),
  ]);
  const maps = [oakColor, oakNormal, oakRoughness] as const;

  const wood = standard('Tenant oak wood', 0xb58a61, .74);
  const lightWood = standard('Tenant light oak wood', 0xd1ae82, .74);
  const darkWood = standard('Tenant dark oak wood', 0x62452f, .78);
  applyOakMaps(wood, 0xb58a61, maps);
  applyOakMaps(lightWood, 0xd1ae82, maps);
  applyOakMaps(darkWood, 0x62452f, maps);

  const stoneTexture = stoneMap?.clone() ?? null;
  if (stoneTexture) {
    stoneTexture.name = 'tenant wall stone';
    stoneTexture.wrapS = stoneTexture.wrapT = RepeatWrapping;
    stoneTexture.repeat.set(1 / 2.7, 1 / 1.8);
    stoneTexture.needsUpdate = true;
  }
  const stone = standard('Tenant warm stone', 0xd1c3b0, .52);
  stone.map = stoneTexture;
  stone.normalScale = new Vector2(.24, .24);
  stone.envMapIntensity = .18;
  stone.needsUpdate = true;

  const palette: TenantPalette = {
    wood,
    lightWood,
    darkWood,
    stone,
    cream: standard('Tenant cream limestone', 0xd9ccb8, .60),
    plaster: standard('Tenant warm mineral plaster', 0xe6ddd0, .86),
    dark: standard('Tenant dark microcement', 0x242126, .82),
    bronze: standard('Tenant dark bronze', 0x3a2c27, .40, .58),
    brass: standard('Tenant satin brass', 0xb89462, .29, .70),
    glass: transparent('Tenant low iron facade glass', 0xcbdad7, .07, .10, FrontSide),
    caseGlass: transparent('Tenant low iron case glass', 0xe2eee9, .25, .07),
    fabric: standard('Tenant greige display fabric', 0xb7aa9b, .93),
    white: standard('Tenant warm white display surface', 0xede9df, .72),
  };

  const glows: GlowRecord[] = [];
  function glow(name: string, color: number, onIntensity: number): MeshStandardMaterial {
    const material = new MeshStandardMaterial({
      name,
      color: new Color(color).multiplyScalar(.24),
      emissive: color,
      emissiveIntensity: onIntensity,
      roughness: .38,
      metalness: .02,
    });
    glows.push({ material, onIntensity });
    return material;
  }
  function setLighting(on: boolean): void {
    for (const { material, onIntensity } of glows) {
      material.emissiveIntensity = on ? onIntensity : 0;
      material.needsUpdate = true;
    }
  }

  return { palette, glow, setLighting };
}

type FixtureKind = 'ambient' | 'accent' | 'vertical';
type TenantFixtureStyle = Readonly<{
  id: string;
  kind: FixtureKind;
  centerY?: number;
  width: number;
  height: number;
  length: number;
  color: number;
  intensity: number;
  target: string;
}>;

const WARM_2700 = 0xffbd8a;
const WARM_3000 = 0xffd0a0;
const WARM_3200 = 0xffd9ae;
const WARM_3300 = 0xffdfba;
const WARM_3400 = 0xffe5c6;

function ambient(id: string, color: number, target: string): TenantFixtureStyle {
  return {
    id, kind: 'ambient', width: 1.10, height: .035, length: .07, color, intensity: .72, target,
  };
}

function accent(id: string, color: number, target: string): TenantFixtureStyle {
  return { id, kind: 'accent', width: .18, height: .028, length: .18, color, intensity: 1.02, target };
}

function vertical(id: string, color: number, target: string, height = .72, centerY?: number): TenantFixtureStyle {
  return { id, kind: 'vertical', centerY, width: .035, height, length: .045, color, intensity: .92, target };
}

/** Styles for the 27 visible fixtures. Positions come from the readonly design JSON. */
const TENANT_FIXTURE_STYLES: Readonly<Record<string, readonly TenantFixtureStyle[]>> = {
  L1: [
    ambient('A1', WARM_3000, '木面ウォッシュ'),
    accent('P1', WARM_3000, '衣料面'),
  ],
  L2: [
    ambient('A1', WARM_3200, '黒枠内のベース'),
    accent('P1', WARM_3200, '枠内衣料'),
    accent('P2', WARM_3200, '枠内衣料'),
  ],
  L3: [
    ambient('A1', WARM_3000, '入口から奥の棚'),
    vertical('V1', WARM_3000, '奥の棚ウォッシュ'),
  ],
  L4: [
    ambient('A1', WARM_3000, '金色縦目のベース'),
    vertical('V1', WARM_3000, '金色縦目', .58),
  ],
  L5: [
    ambient('A1', WARM_3000, '小間口のベース'),
    accent('P1', WARM_3000, '奥の棚'),
  ],
  R1: [
    ambient('A1', WARM_3400, '全面ガラス'),
    vertical('V1', WARM_3400, '結晶と長い縦光束', 2.30, 1.98),
    accent('P1', WARM_3400, 'ケース天面'),
  ],
  R2: [
    ambient('A1', WARM_3000, '卓上ベース'),
    accent('P1', WARM_3000, '卓上・葉'),
    accent('P2', WARM_3000, '卓上・葉'),
  ],
  R3: [
    ambient('A1', WARM_3300, '明るいガラス'),
    accent('P1', WARM_3300, '小物面'),
  ],
  R4: [
    ambient('A1', WARM_3200, '階段脇の床'),
    accent('P1', WARM_3200, '奥の棚'),
  ],
  F1: [
    ambient('A1', WARM_2700, '暗色壁'),
    vertical('V1', WARM_2700, '暗色壁ウォッシュ', .76, 2.35),
    accent('P1', WARM_3000, '低いケース天面'),
  ],
  F2: [
    ambient('A1', WARM_3200, '背面ガラス'),
    accent('P1', WARM_3200, '台面'),
    accent('P2', WARM_3200, '台面'),
  ],
};

type TenantFixture = TenantFixtureStyle & Readonly<{ u: number; d: number; y: number }>;

export interface TenantLocalLight {
  readonly id: string;
  readonly light: PointLight;
  readonly onIntensity: number;
}

function fallbackStyle(light: TenantBuildContext['bay']['lights'][number]): TenantFixtureStyle {
  const kind: FixtureKind = light.kind === 'wash' ? 'vertical' : light.kind === 'accent' ? 'accent' : 'ambient';
  if (kind === 'vertical') return vertical(light.id, WARM_3000, '設計JSONの洗い出し面');
  if (kind === 'accent') return accent(light.id, WARM_3000, '設計JSONの重点面');
  return ambient(light.id, WARM_3000, '設計JSONのベース面');
}

function closestDisplay(
  context: TenantBuildContext,
  u: number,
  d: number,
): TenantBuildContext['bay']['fixtures'][number] | undefined {
  const candidates = context.bay.fixtures.filter(item =>
    item.type === 'case' || item.type === 'table' || item.type === 'shelf' || item.type === 'counter');
  return candidates.reduce<TenantBuildContext['bay']['fixtures'][number] | undefined>((closest, item) => {
    const [left, front, width, length] = item.rect;
    const centerU = left + width * 0.5;
    const centerD = front + length * 0.5;
    const distance = (centerU - u) ** 2 + (centerD - d) ** 2;
    if (!closest) return item;
    const [closestLeft, closestFront, closestWidth, closestLength] = closest.rect;
    const closestDistance = (closestLeft + closestWidth * 0.5 - u) ** 2
      + (closestFront + closestLength * 0.5 - d) ** 2;
    return distance < closestDistance ? item : closest;
  }, undefined);
}

function addTargetSurface(
  context: TenantBuildContext,
  fixture: TenantFixture,
): void {
  if (fixture.kind !== 'accent') return;
  const target = closestDisplay(context, fixture.u, fixture.d);
  if (!target) return;
  const [u, d, width, length] = target.rect;
  const targetGlow = context.glow(
    `${fixture.id} target surface ${target.id}`,
    fixture.color,
    context.bay.id === 'R1' ? .44 : .30,
  );
  // Keep the low-energy target plane attached to the JSON-selected display
  // piece. The source fixture remains visible at its authored u/d/y point.
  context.box(targetGlow, u + width * .5, target.height + .012, d + length * .5,
    Math.max(.12, width - .12), .014, Math.max(.08, length - .12),
    `${fixture.id} local target highlight`);
}

function createLocalLight(context: TenantBuildContext, fixture: TenantFixture): TenantLocalLight | undefined {
  const spec = context.bay.id === 'L2' && fixture.id.endsWith('-P2')
    ? { intensity: 10, distance: 4.2 }
    : context.bay.id === 'R1' && fixture.id.endsWith('-P1')
      ? { intensity: 12, distance: 4.8 }
      : undefined;
  if (!spec) return undefined;
  const light = new PointLight(fixture.color, spec.intensity, spec.distance, 2);
  light.castShadow = false;
  light.position.copy(context.point(fixture.u, fixture.y, fixture.d));
  light.userData.tenantLighting = {
    id: fixture.id,
    target: fixture.target,
    color: fixture.color,
    cct: ATRIUM_TENANT_LIGHTING[context.bay.id]?.cct,
    u: fixture.u,
    d: fixture.d,
    y: fixture.y,
  };
  return { id: fixture.id, light, onIntensity: spec.intensity };
}

/** Add the scheduled local emissive surfaces to one tenant bay. */
export function addTenantLighting(context: TenantBuildContext): readonly TenantLocalLight[] {
  const styles = TENANT_FIXTURE_STYLES[context.bay.id] ?? [];
  const localLights: TenantLocalLight[] = [];
  context.bay.lights.forEach(light => {
    const style = styles.find(item => item.id === light.id) ?? fallbackStyle(light);
    const fixture = {
      ...style,
      id: `${context.bay.id}-${light.id}`,
      u: light.u,
      d: light.d,
      y: light.y,
    };
    const material = context.glow(
      `${fixture.id} ${fixture.target}`,
      fixture.color,
      fixture.intensity,
    );
    const centerY = fixture.centerY ?? fixture.y;
    const mesh = context.box(material, fixture.u, centerY, fixture.d,
      fixture.width, fixture.height, fixture.length, `${fixture.id} tenant fixture`);
    const sourcePoint = context.point(fixture.u, fixture.y, fixture.d);
    mesh.userData.tenantLighting = {
      id: fixture.id,
      kind: fixture.kind,
      target: fixture.target,
      color: fixture.color,
      cct: ATRIUM_TENANT_LIGHTING[context.bay.id]?.cct,
      u: fixture.u,
      d: fixture.d,
      y: fixture.y,
      sourcePoint: sourcePoint.toArray(),
    };
    addTargetSurface(context, fixture);
    const localLight = createLocalLight(context, fixture);
    if (localLight) localLights.push(localLight);
  });
  return localLights;
}
