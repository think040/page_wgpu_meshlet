import { describe, expect, it } from 'vitest';
import { MC_CASE_EDGES, MC_CASE_OFFSETS } from '@/gallery/mesh/mcTables';
import { meshArtwork } from '@/gallery/mesh/sdf/grid';
import { TsKernel } from '@/gallery/mesh/sdf/kernel';
import { ARTWORK_SDFS } from '@/gallery/mesh/sdf/artworks';
import { gridSpec, LOD_GRID } from '@/gallery/mesh/types';
import { checkClosedOriented, sphereArtwork } from './helpers';

describe('Marching Cubes 표', () => {
  it('빈 케이스와 가득 찬 케이스는 삼각형이 없다', () => {
    expect(MC_CASE_OFFSETS[1]! - MC_CASE_OFFSETS[0]!).toBe(0);
    expect(MC_CASE_OFFSETS[256]! - MC_CASE_OFFSETS[255]!).toBe(0);
  });
  it('모든 케이스가 삼각형 단위(3의 배수)이고 최대 5개 이하', () => {
    for (let m = 0; m < 256; m++) {
      const n = MC_CASE_OFFSETS[m + 1]! - MC_CASE_OFFSETS[m]!;
      expect(n % 3).toBe(0);
      expect(n / 3).toBeLessThanOrEqual(5);
      if (m !== 0 && m !== 255) expect(n).toBeGreaterThan(0);
    }
    expect(MC_CASE_EDGES.every((e) => e < 12)).toBe(true);
  });
});

describe('구 SDF → Marching Cubes', () => {
  const art = sphereArtwork();
  for (const n of [16, 32, 64]) {
    it(`n=${n}: 닫힌 다양체, 방향 일관, 바깥을 향함`, () => {
      const { mesh } = meshArtwork(art, n, new TsKernel());
      expect(mesh.indices.length).toBeGreaterThan(0);
      expect(checkClosedOriented(mesh).ok).toBe(true);

      const P = mesh.positions;
      const c = [0.013, -0.021, 0.007];
      let outward = 0;
      let total = 0;
      for (let t = 0; t < mesh.indices.length; t += 3) {
        const [a, b, d] = [mesh.indices[t]! * 3, mesh.indices[t + 1]! * 3, mesh.indices[t + 2]! * 3];
        const e1 = [P[b]! - P[a]!, P[b + 1]! - P[a + 1]!, P[b + 2]! - P[a + 2]!];
        const e2 = [P[d]! - P[a]!, P[d + 1]! - P[a + 1]!, P[d + 2]! - P[a + 2]!];
        const nrm = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
        const area = Math.hypot(nrm[0]!, nrm[1]!, nrm[2]!);
        if (area < 1e-12) continue;
        total++;
        const cen = [(P[a]! + P[b]! + P[d]!) / 3 - c[0]!, (P[a + 1]! + P[b + 1]! + P[d + 1]!) / 3 - c[1]!, (P[a + 2]! + P[b + 2]! + P[d + 2]!) / 3 - c[2]!];
        if (nrm[0]! * cen[0]! + nrm[1]! * cen[1]! + nrm[2]! * cen[2]! > 0) outward++;
      }
      expect(outward).toBe(total);
    });
  }

  it('정점이 표면 위에 있고, 노멀이 해석해와 3° 이내', () => {
    const { mesh } = meshArtwork(art, 64, new TsKernel());
    const c = [0.013, -0.021, 0.007];
    const step = gridSpec(64).step;
    let maxAngle = 0;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const d = [mesh.positions[i]! - c[0]!, mesh.positions[i + 1]! - c[1]!, mesh.positions[i + 2]! - c[2]!];
      const l = Math.hypot(d[0]!, d[1]!, d[2]!);
      expect(Math.abs(l - 0.73)).toBeLessThan(step * 0.2);
      const dot = (d[0]! * mesh.normals[i]! + d[1]! * mesh.normals[i + 1]! + d[2]! * mesh.normals[i + 2]!) / l;
      maxAngle = Math.max(maxAngle, (Math.acos(Math.min(1, dot)) * 180) / Math.PI);
    }
    expect(maxAngle).toBeLessThan(3);
  });

  it('정점 중복이 없다(격자 모서리 기준 공유)', () => {
    const { mesh } = meshArtwork(art, 32, new TsKernel());
    const seen = new Set<string>();
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const key = `${mesh.positions[i]},${mesh.positions[i + 1]},${mesh.positions[i + 2]}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

describe('작품 6점', () => {
  for (const art of ARTWORK_SDFS) {
    it(`작품 ${art.id}: LOD3·LOD2가 닫힌 다양체`, () => {
      for (const n of [LOD_GRID[3], LOD_GRID[2]]) {
        const { mesh } = meshArtwork(art, n, new TsKernel());
        expect(mesh.indices.length).toBeGreaterThan(300);
        expect(checkClosedOriented(mesh).ok).toBe(true);
      }
    });

    it(`작품 ${art.id}: 브릭 생략을 켜도 메시가 완전히 같다 (n=64)`, () => {
      const a = meshArtwork(art, 64, new TsKernel(), { skipFar: true });
      const b = meshArtwork(art, 64, new TsKernel(), { skipFar: false });
      expect(a.bricksSkipped).toBeGreaterThan(0);
      expect(Array.from(a.mesh.indices)).toEqual(Array.from(b.mesh.indices));
      expect(Array.from(a.mesh.positions)).toEqual(Array.from(b.mesh.positions));
      expect(Array.from(a.mesh.normals)).toEqual(Array.from(b.mesh.normals));
    });

    it(`작품 ${art.id}: 격자 평가값이 점 평가(evalPoint)와 일치`, () => {
      const n = 32;
      const g = gridSpec(n);
      const k = new TsKernel();
      k.begin(g, art.tables(g));
      const block = { ix0: 8, iy0: 10, iz0: 12, nx: 8, ny: 19, nz: 8 };
      k.setBlock(block);
      const box = {
        min: [g.origin + 8 * g.step, g.origin + 10 * g.step, g.origin + 12 * g.step] as [number, number, number],
        max: [g.origin + 15 * g.step, g.origin + 28 * g.step, g.origin + 19 * g.step] as [number, number, number],
      };
      const out = k.read(art.program(k, box, g));
      for (let y = 0; y < block.ny; y += 3) {
        for (let z = 0; z < block.nz; z += 2) {
          for (let x = 0; x < block.nx; x += 3) {
            const p = [g.origin + (8 + x) * g.step, g.origin + (10 + y) * g.step, g.origin + (12 + z) * g.step];
            const ref = art.evalPoint(p[0]!, p[1]!, p[2]!);
            const got = out[(y * block.nz + z) * k.rowStride + x]!;
            // 「매듭」은 블록 근처 선분만 쓰므로 먼 곳에서는 값이 더 크다(부호는 같음)
            if (art.id === 1 && ref > 0.3) expect(got).toBeGreaterThan(0);
            else expect(got).toBeCloseTo(ref, 4);
          }
        }
      }
    });
  }
});
