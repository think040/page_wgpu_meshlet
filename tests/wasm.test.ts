// WAT(SIMD) 함수와 TS 참조 구현의 결과 비교. 먼저 npm run build:wasm (pretest에서 자동 실행).
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { createWasmMesherFromBytes, simdSupported, type WasmMesher } from '@/gallery/mesh/wasm/wasmMesher';
import { TsKernel, type SdfKernel } from '@/gallery/mesh/sdf/kernel';
import { ARTWORK_SDFS } from '@/gallery/mesh/sdf/artworks';
import { meshArtwork } from '@/gallery/mesh/sdf/grid';
import { meshletize } from '@/gallery/mesh/meshletize';
import { computeMeshletBounds } from '@/gallery/mesh/bounds';
import { BOUNDS_STRIDE, gridSpec } from '@/gallery/mesh/types';
import { checkClosedOriented } from './helpers';

let wasm: WasmMesher;

beforeAll(async () => {
  expect(simdSupported()).toBe(true);
  const m = await createWasmMesherFromBytes(readFileSync('public/wasm/sdf.wasm'), readFileSync('public/wasm/bounds.wasm'));
  expect(m).not.toBeNull();
  wasm = m!;
});

function evalBlock(k: SdfKernel, art: (typeof ARTWORK_SDFS)[number], n: number, b: { ix0: number; iy0: number; iz0: number; nx: number; ny: number; nz: number }) {
  const g = gridSpec(n);
  k.begin(g, art.tables(g));
  k.setBlock(b);
  const box = {
    min: [g.origin + b.ix0 * g.step, g.origin + b.iy0 * g.step, g.origin + b.iz0 * g.step] as [number, number, number],
    max: [g.origin + (b.ix0 + b.nx - 1) * g.step, g.origin + (b.iy0 + b.ny - 1) * g.step, g.origin + (b.iz0 + b.nz - 1) * g.step] as [number, number, number],
  };
  const out = k.read(art.program(k, box, g));
  const vals: number[] = [];
  for (let y = 0; y < b.ny; y++) for (let z = 0; z < b.nz; z++) for (let x = 0; x < b.nx; x++) vals.push(out[(y * b.nz + z) * k.rowStride + x]!);
  return vals;
}

describe('WAT SDF 커널 = TS 참조 구현', () => {
  const rnd = (() => {
    let s = 777;
    return () => (s = (s * 1103515245 + 12345) >>> 0) / 0x100000000;
  })();
  for (const art of ARTWORK_SDFS) {
    it(`작품 ${art.id}: 무작위 블록 30개의 격자 값이 일치(오차 ≤ 1e-4)`, () => {
      let maxErr = 0;
      for (let t = 0; t < 30; t++) {
        const n = [32, 64, 128, 256][t % 4]!;
        const nx = 1 + Math.floor(rnd() * 8);
        const nz = 1 + Math.floor(rnd() * 8);
        const ny = 1 + Math.floor(rnd() * 19);
        const b = {
          ix0: Math.floor(rnd() * (n + 1 - nx)),
          iy0: Math.floor(rnd() * (n + 1 - ny)),
          iz0: Math.floor(rnd() * (n + 1 - nz)),
          nx,
          ny,
          nz,
        };
        const a = evalBlock(new TsKernel(), art, n, b);
        const w = evalBlock(wasm.kernel, art, n, b);
        for (let i = 0; i < a.length; i++) maxErr = Math.max(maxErr, Math.abs(a[i]! - w[i]!) / Math.max(1, Math.abs(a[i]!)));
      }
      expect(maxErr).toBeLessThan(1e-4);
    });

    it(`작품 ${art.id}: WAT로 만든 메시(n=64)가 닫힌 다양체이고 TS와 삼각형 수 차이 0.5% 이내`, () => {
      const a = meshArtwork(art, 64, new TsKernel());
      const w = meshArtwork(art, 64, wasm.kernel);
      expect(checkClosedOriented(w.mesh).ok).toBe(true);
      const ta = a.mesh.indices.length;
      const tw = w.mesh.indices.length;
      expect(Math.abs(ta - tw) / ta).toBeLessThan(0.005);
    });
  }
});

describe('WAT 메시릿 컬링 데이터 = TS 참조 구현', () => {
  for (const art of [ARTWORK_SDFS[0]!, ARTWORK_SDFS[4]!]) {
    it(`작품 ${art.id}: 스피어·콘 일치, 스피어가 모든 정점 포함`, () => {
      const { mesh } = meshArtwork(art, 64, new TsKernel());
      const set = meshletize(mesh.positions, mesh.indices);
      const ref = computeMeshletBounds(mesh.positions, set);
      const got = wasm.bounds(mesh.positions, set);
      expect(got.length).toBe(ref.length);
      const count = set.meshlets.length / 4;
      for (let m = 0; m < count; m++) {
        const o = m * BOUNDS_STRIDE;
        for (let k = 0; k < 4; k++) expect(Math.abs(got[o + k]! - ref[o + k]!)).toBeLessThan(1e-4);
        const dotAxis = got[o + 4]! * ref[o + 4]! + got[o + 5]! * ref[o + 5]! + got[o + 6]! * ref[o + 6]!;
        expect(dotAxis).toBeGreaterThan(0.9999);
        expect(Math.abs(got[o + 7]! - ref[o + 7]!)).toBeLessThan(2e-3);
        const vOff = set.meshlets[m * 4]!;
        const vCnt = set.meshlets[m * 4 + 1]!;
        for (let i = 0; i < vCnt; i++) {
          const v = set.vertexIndices[vOff + i]! * 3;
          const d = Math.hypot(mesh.positions[v]! - got[o]!, mesh.positions[v + 1]! - got[o + 1]!, mesh.positions[v + 2]! - got[o + 2]!);
          expect(d).toBeLessThanOrEqual(got[o + 3]! * 1.00001 + 1e-6);
        }
      }
    });
  }

  it('memory.grow 이후에도 결과가 같다(큰 입력 → 작은 입력 → 큰 입력)', () => {
    const big = meshArtwork(ARTWORK_SDFS[4]!, 128, new TsKernel()).mesh;
    const small = meshArtwork(ARTWORK_SDFS[0]!, 32, new TsKernel()).mesh;
    const sb = meshletize(big.positions, big.indices);
    const ss = meshletize(small.positions, small.indices);
    const r1 = wasm.bounds(big.positions, sb);
    const r2 = wasm.bounds(small.positions, ss);
    const r3 = wasm.bounds(big.positions, sb);
    expect(Array.from(r3)).toEqual(Array.from(r1));
    expect(r2.length).toBe((ss.meshlets.length / 4) * BOUNDS_STRIDE);
  });
});
