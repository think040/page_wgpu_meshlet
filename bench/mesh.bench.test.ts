// 메시 생성 시간 비교(단일 스레드): TS 참조 구현 vs WAT+SIMD. 실행: npm run bench:mesh
import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { buildLod } from '@/gallery/mesh/buildLod';
import { computeMeshletBounds } from '@/gallery/mesh/bounds';
import { TsKernel } from '@/gallery/mesh/sdf/kernel';
import { createWasmMesherFromBytes } from '@/gallery/mesh/wasm/wasmMesher';

const lods = (process.env.LODS ?? '3,2,1,0').split(',').map(Number);

it('작품 × LOD 처리 시간: TS vs WASM (단일 스레드)', async () => {
  const wasm = (await createWasmMesherFromBytes(readFileSync('public/wasm/sdf.wasm'), readFileSync('public/wasm/bounds.wasm')))!;
  const rows: string[] = [];
  const sum = { ts: { sdf: 0, bounds: 0, total: 0 }, wasm: { sdf: 0, bounds: 0, total: 0 } };
  for (const lod of lods) {
    for (let a = 0; a < 6; a++) {
      const t = buildLod(a, lod, new TsKernel(), computeMeshletBounds);
      const w = buildLod(a, lod, wasm.kernel, wasm.bounds);
      sum.ts.sdf += t.timings.sdf;
      sum.ts.bounds += t.timings.bounds;
      sum.ts.total += t.timings.total;
      sum.wasm.sdf += w.timings.sdf;
      sum.wasm.bounds += w.timings.bounds;
      sum.wasm.total += w.timings.total;
      rows.push(
        `art${a} LOD${lod}: tris ${t.triangleCount}/${w.triangleCount}, meshlets ${t.meshletCount} | ` +
          `SDF ts ${t.timings.sdf.toFixed(0)} → wasm ${w.timings.sdf.toFixed(0)} ms | ` +
          `bounds ts ${t.timings.bounds.toFixed(1)} → wasm ${w.timings.bounds.toFixed(1)} ms | ` +
          `total ts ${t.timings.total.toFixed(0)} → wasm ${w.timings.total.toFixed(0)} ms`,
      );
    }
  }
  const f = (x: number) => x.toFixed(0);
  rows.push(
    `합계 SDF: ts ${f(sum.ts.sdf)} → wasm ${f(sum.wasm.sdf)} ms (×${(sum.ts.sdf / sum.wasm.sdf).toFixed(2)}) | ` +
      `bounds: ts ${f(sum.ts.bounds)} → wasm ${f(sum.wasm.bounds)} ms (×${(sum.ts.bounds / sum.wasm.bounds).toFixed(2)}) | ` +
      `전체: ts ${f(sum.ts.total)} → wasm ${f(sum.wasm.total)} ms (×${(sum.ts.total / sum.wasm.total).toFixed(2)})`,
  );
  console.log(rows.join('\n'));
});
