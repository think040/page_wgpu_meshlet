// (작품, LOD) 하나를 처리한다: SDF 격자 → Marching Cubes → 메시릿 → 컬링 데이터 → GPU 정점 포맷.
// 워커 안에서 돈다(메인 스레드에서도 테스트로 호출 가능).

import { ARTWORK_SDFS } from './sdf/artworks';
import { meshArtwork } from './sdf/grid';
import type { SdfKernel } from './sdf/kernel';
import { meshletize } from './meshletize';
import { computeMeshletBounds } from './bounds';
import { LOD_GRID, type LodMeshData, type MeshletSet } from './types';

/** 메시릿 컬링 데이터 계산 함수(참조 구현 또는 WASM) */
export type BoundsFn = (positions: Float32Array, set: MeshletSet) => Float32Array;

/** 옥타헤드럴 노멀 → snorm16×2 패킹(WGSL unpack2x16snorm과 짝) */
export function encodeOctNormal(nx: number, ny: number, nz: number): number {
  const l = Math.abs(nx) + Math.abs(ny) + Math.abs(nz) || 1;
  let x = nx / l;
  let y = ny / l;
  if (nz < 0) {
    const ox = x;
    x = (1 - Math.abs(y)) * (ox >= 0 ? 1 : -1);
    y = (1 - Math.abs(ox)) * (y >= 0 ? 1 : -1);
  }
  const q = (v: number) => Math.round(Math.max(-1, Math.min(1, v)) * 32767) & 0xffff;
  return (q(x) | (q(y) << 16)) >>> 0;
}

export function decodeOctNormal(p: number): [number, number, number] {
  const s = (v: number) => {
    const i = v >= 0x8000 ? v - 0x10000 : v;
    return Math.max(i / 32767, -1);
  };
  let x = s(p & 0xffff);
  let y = s(p >>> 16);
  const z = 1 - Math.abs(x) - Math.abs(y);
  if (z < 0) {
    const ox = x;
    x = (1 - Math.abs(y)) * (ox >= 0 ? 1 : -1);
    y = (1 - Math.abs(ox)) * (y >= 0 ? 1 : -1);
  }
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

export function packVertices(positions: Float32Array, normals: Float32Array): ArrayBuffer {
  const count = positions.length / 3;
  const buf = new ArrayBuffer(count * 16);
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  for (let i = 0; i < count; i++) {
    f[i * 4] = positions[i * 3]!;
    f[i * 4 + 1] = positions[i * 3 + 1]!;
    f[i * 4 + 2] = positions[i * 3 + 2]!;
    u[i * 4 + 3] = encodeOctNormal(normals[i * 3]!, normals[i * 3 + 1]!, normals[i * 3 + 2]!);
  }
  return buf;
}

export function buildLod(
  artwork: number,
  lod: number,
  kernel: SdfKernel,
  boundsFn: BoundsFn = computeMeshletBounds,
  onProgress?: (fraction: number) => void,
): LodMeshData {
  const art = ARTWORK_SDFS[artwork];
  const n = LOD_GRID[lod];
  if (!art || n === undefined) throw new Error(`bad job ${artwork}/${lod}`);
  const tStart = performance.now();
  const r = meshArtwork(art, n, kernel, { onProgress: (f) => onProgress?.(f * 0.85) });
  const t1 = performance.now();
  const set = meshletize(r.mesh.positions, r.mesh.indices);
  const t2 = performance.now();
  const bounds = boundsFn(r.mesh.positions, set);
  const t3 = performance.now();
  const vertices = packVertices(r.mesh.positions, r.mesh.normals);
  onProgress?.(1);
  return {
    artwork,
    lod,
    vertexCount: r.mesh.positions.length / 3,
    triangleCount: r.mesh.indices.length / 3,
    meshletCount: set.meshlets.length / 4,
    vertices,
    meshlets: set.meshlets,
    vertexIndices: set.vertexIndices,
    primitives: set.primitives,
    bounds,
    timings: { sdf: r.sdfMs, mc: t1 - tStart - r.sdfMs, meshlet: t2 - t1, bounds: t3 - t2, total: performance.now() - tStart },
    backend: kernel.name,
  };
}
