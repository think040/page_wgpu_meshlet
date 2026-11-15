/// <reference lib="webworker" />
// 메시 워커: (작품, LOD) 작업을 받아 SDF → MC → 메시릿 → 컬링 데이터를 만들고 결과를 transferable로 넘긴다.
// 워커마다 WASM 인스턴스를 따로 띄운다. SIMD 미지원이면 TS 참조 구현으로 대체한다.

import { buildLod, type BoundsFn } from '../mesh/buildLod';
import { computeMeshletBounds } from '../mesh/bounds';
import { TsKernel, type SdfKernel } from '../mesh/sdf/kernel';
import { createWasmMesher } from '../mesh/wasm/wasmMesher';
import { transferablesOf, type FromWorker, type ToWorker } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let kernel: SdfKernel = new TsKernel();
let boundsFn: BoundsFn = computeMeshletBounds;

const post = (msg: FromWorker, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    if (msg.backend === 'wasm') {
      try {
        const wasm = await createWasmMesher(msg.wasmBase);
        if (wasm) {
          kernel = wasm.kernel;
          boundsFn = wasm.bounds;
          post({ type: 'ready', backend: 'wasm', simd: true });
          return;
        }
        post({ type: 'ready', backend: 'ts', simd: false, note: 'WASM SIMD 미지원 — TS 참조 구현으로 대체' });
        return;
      } catch (e) {
        post({ type: 'ready', backend: 'ts', simd: false, note: `WASM 로드 실패 — TS로 대체: ${String(e)}` });
        return;
      }
    }
    post({ type: 'ready', backend: 'ts', simd: false });
    return;
  }
  if (msg.type === 'job') {
    try {
      let last = 0;
      const data = buildLod(msg.artwork, msg.lod, kernel, boundsFn, (fraction) => {
        const now = performance.now();
        if (now - last > 50 || fraction >= 1) {
          last = now;
          post({ type: 'progress', jobId: msg.jobId, fraction });
        }
      });
      post({ type: 'result', jobId: msg.jobId, data }, transferablesOf(data));
    } catch (e) {
      post({ type: 'error', jobId: msg.jobId, message: e instanceof Error ? `${e.message}\n${e.stack}` : String(e) });
    }
  }
};
