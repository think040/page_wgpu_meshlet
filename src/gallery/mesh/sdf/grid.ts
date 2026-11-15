// SDF 격자를 y 슬랩 단위로 평가해 곧바로 Marching Cubes에 넘긴다(계획서 P-2).
// 슬랩은 다시 x·z 8샘플 브릭으로 나누고, 표면에서 충분히 먼 브릭은 평가를 생략한다(P-3).

import { McBuilder } from '../marchingCubes';
import { gridSpec, type IndexedMesh } from '../types';
import type { ArtworkSdf, Aabb } from './artworks';
import { MAX_BLOCK_X, MAX_BLOCK_Z, type SdfKernel } from './kernel';

export const SLAB_ROWS = 16;

export interface MeshArtworkOptions {
  /** 브릭 생략(기본 true). 테스트에서 끄고 결과가 같은지 비교한다. */
  skipFar?: boolean;
  onProgress?: (fraction: number) => void;
}

export interface MeshArtworkResult {
  mesh: IndexedMesh;
  sdfMs: number;
  mcMs: number;
  bricksTotal: number;
  bricksSkipped: number;
}

export function meshArtwork(
  art: ArtworkSdf,
  n: number,
  kernel: SdfKernel,
  opts: MeshArtworkOptions = {},
): MeshArtworkResult {
  const skipFar = opts.skipFar ?? true;
  const grid = gridSpec(n);
  const { origin, step } = grid;
  const s = n + 1;
  kernel.begin(grid, art.tables(grid));
  const mc = new McBuilder(grid);
  const slab = new Float32Array(s * s * (SLAB_ROWS + 3));
  const box: Aabb = { min: [0, 0, 0], max: [0, 0, 0] };
  const margin = 2 * step;
  let sdfMs = 0;
  let mcMs = 0;
  let bricksTotal = 0;
  let bricksSkipped = 0;

  for (let r0 = 0; r0 < n; r0 += SLAB_ROWS) {
    const r1 = Math.min(n, r0 + SLAB_ROWS);
    const y0 = Math.max(0, r0 - 1);
    const y1 = Math.min(n, r1 + 1);
    const ny = y1 - y0 + 1;
    const t0 = performance.now();

    for (let bz = 0; bz < s; bz += MAX_BLOCK_Z) {
      const nz = Math.min(MAX_BLOCK_Z, s - bz);
      for (let bx = 0; bx < s; bx += MAX_BLOCK_X) {
        const nx = Math.min(MAX_BLOCK_X, s - bx);
        bricksTotal++;
        box.min[0] = origin + bx * step;
        box.min[1] = origin + y0 * step;
        box.min[2] = origin + bz * step;
        box.max[0] = origin + (bx + nx - 1) * step;
        box.max[1] = origin + y1 * step;
        box.max[2] = origin + (bz + nz - 1) * step;
        const cx = (box.min[0] + box.max[0]) / 2;
        const cy = (box.min[1] + box.max[1]) / 2;
        const cz = (box.min[2] + box.max[2]) / 2;
        const hx = (box.max[0] - box.min[0]) / 2;
        const hy = (box.max[1] - box.min[1]) / 2;
        const hz = (box.max[2] - box.min[2]) / 2;
        const halfDiag = Math.sqrt(hx * hx + hy * hy + hz * hz);

        if (skipFar) {
          const d = art.evalPoint(cx, cy, cz) / art.lipschitz;
          if (Math.abs(d) > halfDiag + margin) {
            // 브릭 전체가 같은 부호 — 부호만 맞으면 MC 결과는 같다.
            const fill = Math.sign(d) * Math.max(Math.abs(d) - halfDiag, step);
            for (let ly = 0; ly < ny; ly++) {
              for (let lz = 0; lz < nz; lz++) {
                const o = (ly * s + bz + lz) * s + bx;
                slab.fill(fill, o, o + nx);
              }
            }
            bricksSkipped++;
            continue;
          }
        }

        kernel.setBlock({ ix0: bx, iy0: y0, iz0: bz, nx, ny, nz });
        const out = kernel.read(art.program(kernel, box, grid));
        const stride = kernel.rowStride;
        for (let ly = 0; ly < ny; ly++) {
          for (let lz = 0; lz < nz; lz++) {
            const src = (ly * nz + lz) * stride;
            slab.set(out.subarray(src, src + nx), (ly * s + bz + lz) * s + bx);
          }
        }
      }
    }

    // 격자 경계 샘플은 항상 바깥(양수) — 표면이 반드시 닫히게 한다.
    const pos = step * 0.5;
    for (let ly = 0; ly < ny; ly++) {
      const gy = y0 + ly;
      const layer = ly * s * s;
      if (gy === 0 || gy === n) {
        for (let i = 0; i < s * s; i++) slab[layer + i] = Math.max(slab[layer + i]!, pos);
        continue;
      }
      for (let i = 0; i < s; i++) {
        const a = layer + i; // z = 0
        const b = layer + n * s + i; // z = n
        const c = layer + i * s; // x = 0
        const d = layer + i * s + n; // x = n
        slab[a] = Math.max(slab[a]!, pos);
        slab[b] = Math.max(slab[b]!, pos);
        slab[c] = Math.max(slab[c]!, pos);
        slab[d] = Math.max(slab[d]!, pos);
      }
    }

    const t1 = performance.now();
    mc.processRows(slab, y0, r0, r1);
    const t2 = performance.now();
    sdfMs += t1 - t0;
    mcMs += t2 - t1;
    opts.onProgress?.(r1 / n);
  }

  return { mesh: mc.finish(), sdfMs, mcMs, bricksTotal, bricksSkipped };
}
