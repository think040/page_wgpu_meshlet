// 스트리밍 Marching Cubes — y 방향 셀 행을 차례로 처리하며, 격자 모서리 기준으로 정점을 공유한다.
// 노멀 = SDF 격자 중앙차분 기울기를 모서리 양 끝에서 구해 보간 후 정규화(계획서 P-4).

import { GrowF32, GrowU32 } from './growable';
import { MC_CASE_EDGES, MC_CASE_OFFSETS, MC_EDGES } from './mcTables';
import type { GridSpec, IndexedMesh } from './types';

export class McBuilder {
  private readonly s: number;
  private readonly hx: [Int32Array, Int32Array];
  private readonly hz: [Int32Array, Int32Array];
  private readonly vy: Int32Array;
  private readonly positions = new GrowF32(1 << 16);
  private readonly normals = new GrowF32(1 << 16);
  private readonly indices = new GrowU32(1 << 17);
  private vertexCount = 0;
  private nextRow = 0;

  // 현재 슬랩
  private slab: Float32Array = new Float32Array(0);
  private slabY0 = 0;

  constructor(private readonly grid: GridSpec) {
    const s = grid.n + 1;
    this.s = s;
    const mk = () => new Int32Array(s * s).fill(-1);
    this.hx = [mk(), mk()];
    this.hz = [mk(), mk()];
    this.vy = mk();
  }

  /** 슬랩 값 (전역 샘플 인덱스) */
  private v(x: number, y: number, z: number): number {
    const s = this.s;
    return this.slab[((y - this.slabY0) * s + z) * s + x]!;
  }

  private grad(x: number, y: number, z: number, out: Float32Array, o: number) {
    const n = this.grid.n;
    const xm = x > 0 ? x - 1 : x;
    const xp = x < n ? x + 1 : x;
    const ym = y > 0 ? y - 1 : y;
    const yp = y < n ? y + 1 : y;
    const zm = z > 0 ? z - 1 : z;
    const zp = z < n ? z + 1 : z;
    out[o] = (this.v(xp, y, z) - this.v(xm, y, z)) / (xp - xm);
    out[o + 1] = (this.v(x, yp, z) - this.v(x, ym, z)) / (yp - ym);
    out[o + 2] = (this.v(x, y, zp) - this.v(x, y, zm)) / (zp - zm);
  }

  private readonly g = new Float32Array(6);

  private makeVertex(x0: number, y0: number, z0: number, axis: number): number {
    const x1 = x0 + (axis === 0 ? 1 : 0);
    const y1 = y0 + (axis === 1 ? 1 : 0);
    const z1 = z0 + (axis === 2 ? 1 : 0);
    const a = this.v(x0, y0, z0);
    const b = this.v(x1, y1, z1);
    const t = a / (a - b);
    const { origin, step } = this.grid;
    this.positions.push3(
      origin + (x0 + (x1 - x0) * t) * step,
      origin + (y0 + (y1 - y0) * t) * step,
      origin + (z0 + (z1 - z0) * t) * step,
    );
    const g = this.g;
    this.grad(x0, y0, z0, g, 0);
    this.grad(x1, y1, z1, g, 3);
    let nx = g[0]! + (g[3]! - g[0]!) * t;
    let ny = g[1]! + (g[4]! - g[1]!) * t;
    let nz = g[2]! + (g[5]! - g[2]!) * t;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l > 1e-20) {
      nx /= l;
      ny /= l;
      nz /= l;
    } else {
      nx = 0;
      ny = 1;
      nz = 0;
    }
    this.normals.push3(nx, ny, nz);
    return this.vertexCount++;
  }

  /**
   * 셀 행 [rowStart, rowEnd)를 처리한다. 행은 0부터 순서대로 들어와야 한다.
   * slab은 전역 샘플 y = slabY0.. 범위를 담고, rowStart−1 .. rowEnd+1(경계에서 잘림)을 포함해야 한다.
   */
  processRows(slab: Float32Array, slabY0: number, rowStart: number, rowEnd: number) {
    if (rowStart !== this.nextRow) throw new Error(`MC rows out of order: ${rowStart} != ${this.nextRow}`);
    this.slab = slab;
    this.slabY0 = slabY0;
    const n = this.grid.n;
    const s = this.s;
    const ss = s * s;
    // 꼭짓점 c의 슬랩 내 오프셋
    const coff = new Int32Array(8);
    for (let c = 0; c < 8; c++) coff[c] = (((c >> 1) & 1) * s + ((c >> 2) & 1)) * s + (c & 1);
    // 모서리 e의 (축, 전역 아래 꼭짓점 오프셋)
    const eAxis = MC_EDGES.map((e) => e.axis);
    const eDx = MC_EDGES.map((e) => e.dx);
    const eDy = MC_EDGES.map((e) => e.dy);
    const eDz = MC_EDGES.map((e) => e.dz);
    const cellEdgeVert = new Int32Array(12);

    for (let y = rowStart; y < rowEnd; y++) {
      const lower = y & 1;
      const upper = (y + 1) & 1;
      if (y === 0) {
        this.hx[lower]!.fill(-1);
        this.hz[lower]!.fill(-1);
      }
      this.hx[upper]!.fill(-1);
      this.hz[upper]!.fill(-1);
      this.vy.fill(-1);
      const layerBase = (y - slabY0) * ss;
      for (let z = 0; z < n; z++) {
        let base = layerBase + z * s;
        for (let x = 0; x < n; x++, base++) {
          let mask = 0;
          for (let c = 0; c < 8; c++) if (slab[base + coff[c]!]! < 0) mask |= 1 << c;
          if (mask === 0 || mask === 255) continue;
          const t0 = MC_CASE_OFFSETS[mask]!;
          const t1 = MC_CASE_OFFSETS[mask + 1]!;
          cellEdgeVert.fill(-1);
          for (let i = t0; i < t1; i++) {
            const e = MC_CASE_EDGES[i]!;
            if (cellEdgeVert[e]! >= 0) continue;
            const gx = x + eDx[e]!;
            const gy = y + eDy[e]!;
            const gz = z + eDz[e]!;
            const axis = eAxis[e]!;
            const idx = gz * s + gx;
            const map = axis === 0 ? this.hx[gy & 1]! : axis === 2 ? this.hz[gy & 1]! : this.vy;
            let vi = map[idx]!;
            if (vi < 0) {
              vi = this.makeVertex(gx, gy, gz, axis);
              map[idx] = vi;
            }
            cellEdgeVert[e] = vi;
          }
          for (let i = t0; i < t1; i += 3) {
            this.indices.push3(
              cellEdgeVert[MC_CASE_EDGES[i]!]!,
              cellEdgeVert[MC_CASE_EDGES[i + 1]!]!,
              cellEdgeVert[MC_CASE_EDGES[i + 2]!]!,
            );
          }
        }
      }
    }
    this.nextRow = rowEnd;
  }

  finish(): IndexedMesh {
    return {
      positions: this.positions.toArray(),
      normals: this.normals.toArray(),
      indices: this.indices.toArray(),
    };
  }
}
