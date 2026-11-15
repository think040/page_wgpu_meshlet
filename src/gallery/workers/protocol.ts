// 메인 스레드 ↔ 메시 워커 메시지 형식.
import type { LodMeshData } from '../mesh/types';

export type MesherBackend = 'wasm' | 'ts';

export type ToWorker =
  | { type: 'init'; backend: MesherBackend; wasmBase: string }
  | { type: 'job'; jobId: number; artwork: number; lod: number };

export type FromWorker =
  | { type: 'ready'; backend: string; simd: boolean; note?: string }
  | { type: 'progress'; jobId: number; fraction: number }
  | { type: 'result'; jobId: number; data: LodMeshData }
  | { type: 'error'; jobId: number; message: string };

/** 결과 안의 transferable 목록(소유권 이전) */
export function transferablesOf(d: LodMeshData): Transferable[] {
  return [d.vertices, d.meshlets.buffer, d.vertexIndices.buffer, d.primitives.buffer, d.bounds.buffer];
}
