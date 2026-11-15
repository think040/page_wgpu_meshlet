// 워커 풀: (작품, LOD) 쌍 단위로 작업을 나눈다. 가벼운 LOD3부터 먼저 큐에 넣어 먼저 화면에 나오게 한다.
// SharedArrayBuffer·COOP/COEP 없이 transferable만 쓴다.

import type { LodMeshData } from '../mesh/types';
import { LOD_GRID } from '../mesh/types';
import type { FromWorker, MesherBackend, ToWorker } from './protocol';

export interface PoolCallbacks {
  onResult: (data: LodMeshData) => void;
  onProgress: (done: number, total: number, fraction: number) => void;
  onReady?: (info: { backend: string; note?: string; workers: number }) => void;
  onError: (message: string) => void;
  onFinished: (elapsedMs: number) => void;
}

interface Job {
  id: number;
  artwork: number;
  lod: number;
  weight: number; // 진행률 가중치 = 셀 수
  fraction: number;
}

export function defaultWorkerCount(): number {
  const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  return Math.max(1, Math.min(8, hc - 1));
}

export class MeshWorkerPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Job[] = [];
  private running = new Map<Worker, Job>();
  private jobs: Job[] = [];
  private done = 0;
  private start = 0;
  private disposed = false;
  private readyCount = 0;

  constructor(
    private readonly cb: PoolCallbacks,
    private readonly opts: { backend: MesherBackend; workers: number; artworks: number[] },
  ) {}

  run() {
    this.start = performance.now();
    let id = 0;
    // LOD3 → LOD0 순서
    for (let lod = LOD_GRID.length - 1; lod >= 0; lod--) {
      for (const artwork of this.opts.artworks) {
        const n = LOD_GRID[lod]!;
        this.jobs.push({ id: id++, artwork, lod, weight: n * n * n, fraction: 0 });
      }
    }
    this.queue = [...this.jobs];
    const count = Math.min(this.opts.workers, this.jobs.length);
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL('./meshWorker.ts', import.meta.url), { type: 'module', name: `mesh-worker-${i}` });
      w.onmessage = (ev: MessageEvent<FromWorker>) => this.onMessage(w, ev.data);
      w.onerror = (ev) => this.cb.onError(`[워커] ${ev.message}`);
      const init: ToWorker = { type: 'init', backend: this.opts.backend, wasmBase: `${location.origin}/wasm/` };
      w.postMessage(init);
      this.workers.push(w);
    }
  }

  private onMessage(w: Worker, msg: FromWorker) {
    if (this.disposed) return;
    switch (msg.type) {
      case 'ready':
        this.readyCount++;
        if (this.readyCount === 1) this.cb.onReady?.({ backend: msg.backend, note: msg.note, workers: this.workers.length });
        if (msg.note) console.warn(`[워커] ${msg.note}`);
        this.idle.push(w);
        this.pump();
        break;
      case 'progress': {
        const job = this.running.get(w);
        if (job) job.fraction = msg.fraction;
        this.reportProgress();
        break;
      }
      case 'result': {
        const job = this.running.get(w);
        if (job) job.fraction = 1;
        this.running.delete(w);
        this.done++;
        this.cb.onResult(msg.data);
        this.reportProgress();
        this.idle.push(w);
        this.pump();
        if (this.done === this.jobs.length) this.cb.onFinished(performance.now() - this.start);
        break;
      }
      case 'error': {
        this.cb.onError(`[워커] 작업 ${msg.jobId} 실패: ${msg.message}`);
        const job = this.running.get(w);
        if (job) job.fraction = 1;
        this.running.delete(w);
        this.done++;
        this.idle.push(w);
        this.pump();
        if (this.done === this.jobs.length) this.cb.onFinished(performance.now() - this.start);
        break;
      }
    }
  }

  private pump() {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const w = this.idle.pop()!;
      const job = this.queue.shift()!;
      this.running.set(w, job);
      const msg: ToWorker = { type: 'job', jobId: job.id, artwork: job.artwork, lod: job.lod };
      w.postMessage(msg);
    }
  }

  private reportProgress() {
    let total = 0;
    let acc = 0;
    for (const j of this.jobs) {
      total += j.weight;
      acc += j.weight * j.fraction;
    }
    this.cb.onProgress(this.done, this.jobs.length, total > 0 ? acc / total : 1);
  }

  dispose() {
    this.disposed = true;
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
    this.running.clear();
  }
}
