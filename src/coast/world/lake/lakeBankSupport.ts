type BankPoint = Readonly<{ x: number; y: number; z: number }>;
type BankTriangle = {
  a: BankPoint; b: BankPoint; c: BankPoint;
  determinant: number;
  minX: number; maxX: number; minZ: number; maxZ: number;
};

// This index is built from the same vertices and winding as the visible bank. It exists
// during basin construction; plants retain only their sampled heights, not the index.
export class LakeBankSupport {
  private readonly vertices = new Map<number, BankPoint>();
  private readonly cells = new Map<string, BankTriangle[]>();
  private readonly cellSize = 8;

  addVertex(index: number, x: number, y: number, z: number): void {
    // PlantSurface uploads Float32 positions. Sampling those same values also keeps
    // points next to a triangle edge consistent with an independent mesh raycast.
    this.vertices.set(index, { x: Math.fround(x), y: Math.fround(y), z: Math.fround(z) });
  }

  addTriangle(aIndex: number, bIndex: number, cIndex: number): void {
    const a = this.vertices.get(aIndex)!;
    const b = this.vertices.get(bIndex)!;
    const c = this.vertices.get(cIndex)!;
    const determinant = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
    if (Math.abs(determinant) < 1e-10) return;
    const triangle = {
      a, b, c, determinant,
      minX: Math.min(a.x, b.x, c.x), maxX: Math.max(a.x, b.x, c.x),
      minZ: Math.min(a.z, b.z, c.z), maxZ: Math.max(a.z, b.z, c.z),
    };
    for (let x = Math.floor(triangle.minX / this.cellSize); x <= Math.floor(triangle.maxX / this.cellSize); x += 1) {
      for (let z = Math.floor(triangle.minZ / this.cellSize); z <= Math.floor(triangle.maxZ / this.cellSize); z += 1) {
        const key = `${x},${z}`;
        const bucket = this.cells.get(key);
        if (bucket) bucket.push(triangle);
        else this.cells.set(key, [triangle]);
      }
    }
  }

  heightAt(x: number, z: number): number | undefined {
    const triangles = this.cells.get(`${Math.floor(x / this.cellSize)},${Math.floor(z / this.cellSize)}`);
    let height: number | undefined;
    for (const triangle of triangles ?? []) {
      if (x < triangle.minX - 1e-7 || x > triangle.maxX + 1e-7
        || z < triangle.minZ - 1e-7 || z > triangle.maxZ + 1e-7) continue;
      const { a, b, c, determinant } = triangle;
      const bWeight = ((x - a.x) * (c.z - a.z) - (c.x - a.x) * (z - a.z)) / determinant;
      const cWeight = ((b.x - a.x) * (z - a.z) - (x - a.x) * (b.z - a.z)) / determinant;
      const aWeight = 1 - bWeight - cWeight;
      if (aWeight < -1e-7 || bWeight < -1e-7 || cWeight < -1e-7) continue;
      const y = aWeight * a.y + bWeight * b.y + cWeight * c.y;
      height = height === undefined ? y : Math.max(height, y);
    }
    return height;
  }
}
