import { describe, expect, it } from 'vitest';
import { meshArtwork } from '@/gallery/mesh/sdf/grid';
import { TsKernel } from '@/gallery/mesh/sdf/kernel';
import { ARTWORK_SDFS } from '@/gallery/mesh/sdf/artworks';
import { meshletize } from '@/gallery/mesh/meshletize';
import { coneCulled, computeMeshletBounds } from '@/gallery/mesh/bounds';
import { decodeOctNormal, encodeOctNormal } from '@/gallery/mesh/buildLod';
import { BOUNDS_STRIDE, MAX_MESHLET_PRIMS, MAX_MESHLET_VERTS, unpackPrim, type IndexedMesh, type MeshletSet } from '@/gallery/mesh/types';
import { sphereArtwork } from './helpers';

function checkMeshlets(mesh: IndexedMesh, set: MeshletSet) {
  const triCount = mesh.indices.length / 3;
  const count = set.meshlets.length / 4;
  // 원본 삼각형 → 메시릿 소속 횟수
  const key = (a: number, b: number, c: number) => {
    // 회전은 같은 삼각형(방향 보존)
    const m = Math.min(a, b, c);
    if (m === a) return `${a},${b},${c}`;
    if (m === b) return `${b},${c},${a}`;
    return `${c},${a},${b}`;
  };
  const original = new Map<string, number>();
  for (let t = 0; t < triCount; t++) {
    const k = key(mesh.indices[t * 3]!, mesh.indices[t * 3 + 1]!, mesh.indices[t * 3 + 2]!);
    original.set(k, (original.get(k) ?? 0) + 1);
  }
  let primTotal = 0;
  let expectV = 0;
  let expectP = 0;
  for (let m = 0; m < count; m++) {
    const vOff = set.meshlets[m * 4]!;
    const vCnt = set.meshlets[m * 4 + 1]!;
    const pOff = set.meshlets[m * 4 + 2]!;
    const pCnt = set.meshlets[m * 4 + 3]!;
    expect(vOff).toBe(expectV);
    expect(pOff).toBe(expectP);
    expectV += vCnt;
    expectP += pCnt;
    expect(vCnt).toBeGreaterThan(0);
    expect(vCnt).toBeLessThanOrEqual(MAX_MESHLET_VERTS);
    expect(pCnt).toBeGreaterThan(0);
    expect(pCnt).toBeLessThanOrEqual(MAX_MESHLET_PRIMS);
    // 메시릿 내부 정점은 중복 없음
    const verts = Array.from(set.vertexIndices.subarray(vOff, vOff + vCnt));
    expect(new Set(verts).size).toBe(vCnt);
    for (let p = 0; p < pCnt; p++) {
      const [l0, l1, l2] = unpackPrim(set.primitives[pOff + p]!);
      expect(Math.max(l0, l1, l2)).toBeLessThan(vCnt);
      const k = key(verts[l0]!, verts[l1]!, verts[l2]!);
      const left = original.get(k);
      expect(left, `삼각형 ${k}이 원본에 없거나 두 번 이상 속함`).toBeGreaterThan(0);
      original.set(k, left! - 1);
      primTotal++;
    }
  }
  expect(expectV).toBe(set.vertexIndices.length);
  expect(primTotal).toBe(triCount);
  for (const left of original.values()) expect(left).toBe(0);
}

describe('메시릿 변환', () => {
  it('구(n=64): 한도 준수, 모든 삼각형이 정확히 한 메시릿에 속함', () => {
    const { mesh } = meshArtwork(sphereArtwork(), 64, new TsKernel());
    const set = meshletize(mesh.positions, mesh.indices);
    checkMeshlets(mesh, set);
  });

  for (const art of ARTWORK_SDFS) {
    it(`작품 ${art.id}(n=64): 한도·1:1 소속, 메시릿 채움률`, () => {
      const { mesh } = meshArtwork(art, 64, new TsKernel());
      const set = meshletize(mesh.positions, mesh.indices);
      checkMeshlets(mesh, set);
      const count = set.meshlets.length / 4;
      const avgPrims = mesh.indices.length / 3 / count;
      // 공간적으로 뭉친 채움: 평균 삼각형 수가 한도의 절반을 넘어야 한다
      expect(avgPrims).toBeGreaterThan(MAX_MESHLET_PRIMS * 0.5);
    });
  }
});

describe('메시릿 컬링 데이터', () => {
  const { mesh } = meshArtwork(ARTWORK_SDFS[3]!, 64, new TsKernel());
  const set = meshletize(mesh.positions, mesh.indices);
  const bounds = computeMeshletBounds(mesh.positions, set);
  const count = set.meshlets.length / 4;

  it('바운딩 스피어가 메시릿의 모든 정점을 포함', () => {
    for (let m = 0; m < count; m++) {
      const o = m * BOUNDS_STRIDE;
      const vOff = set.meshlets[m * 4]!;
      const vCnt = set.meshlets[m * 4 + 1]!;
      for (let i = 0; i < vCnt; i++) {
        const v = set.vertexIndices[vOff + i]! * 3;
        const d = Math.hypot(mesh.positions[v]! - bounds[o]!, mesh.positions[v + 1]! - bounds[o + 1]!, mesh.positions[v + 2]! - bounds[o + 2]!);
        expect(d).toBeLessThanOrEqual(bounds[o + 3]! * 1.00001 + 1e-6);
      }
    }
  });

  it('노멀 콘으로 컬링된 메시릿은 모든 삼각형이 실제로 뒷면(보수적)', () => {
    let culledCount = 0;
    const rnd = (() => {
      let s = 12345;
      return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
    })();
    for (let trial = 0; trial < 40; trial++) {
      const eye = [rnd() * 4, rnd() * 4, rnd() * 4];
      for (let m = 0; m < count; m++) {
        if (!coneCulled(bounds, m, eye[0]!, eye[1]!, eye[2]!)) continue;
        culledCount++;
        const vOff = set.meshlets[m * 4]!;
        const pOff = set.meshlets[m * 4 + 2]!;
        const pCnt = set.meshlets[m * 4 + 3]!;
        for (let p = 0; p < pCnt; p++) {
          const l = unpackPrim(set.primitives[pOff + p]!).map((x) => set.vertexIndices[vOff + x]! * 3);
          const P = mesh.positions;
          const a = [P[l[0]!]!, P[l[0]! + 1]!, P[l[0]! + 2]!];
          const e1 = [P[l[1]!]! - a[0]!, P[l[1]! + 1]! - a[1]!, P[l[1]! + 2]! - a[2]!];
          const e2 = [P[l[2]!]! - a[0]!, P[l[2]! + 1]! - a[1]!, P[l[2]! + 2]! - a[2]!];
          const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
          const toEye = [eye[0]! - a[0]!, eye[1]! - a[1]!, eye[2]! - a[2]!];
          // 앞면이면 dot > 0 — 컬링된 메시릿에는 없어야 한다
          expect(n[0]! * toEye[0]! + n[1]! * toEye[1]! + n[2]! * toEye[2]!).toBeLessThanOrEqual(1e-9);
        }
      }
    }
    expect(culledCount).toBeGreaterThan(0);
  });
});

describe('옥타헤드럴 노멀', () => {
  it('왕복 오차 0.01 이하', () => {
    for (let i = 0; i < 2000; i++) {
      const v = [Math.sin(i * 1.7), Math.cos(i * 0.9), Math.sin(i * 2.3 + 1)];
      const l = Math.hypot(v[0]!, v[1]!, v[2]!);
      const n = v.map((x) => x / l) as [number, number, number];
      const d = decodeOctNormal(encodeOctNormal(...n));
      expect(Math.hypot(d[0] - n[0], d[1] - n[1], d[2] - n[2])).toBeLessThan(0.01);
    }
  });
});
