// 전역 지오메트리 storage buffer(성장형 아레나). 모든 작품·LOD의 정점·메시릿·컬링 데이터를 모은다.
// 워커 결과가 도착하는 순서대로(LOD3 먼저) 이어 붙이고, 모자라면 2배 버퍼로 옮긴다(계획서 3.2).

import type { LodMeshData } from '../mesh/types';
import { LAYOUT, LOD_SLOTS } from './layout';

interface Arena {
  name: string;
  buffer: GPUBuffer;
  capacity: number; // bytes
  used: number; // bytes
}

export interface LodRecord {
  meshletOffset: number;
  meshletCount: number;
  triCount: number;
  vertexCount: number;
  /** CPU 사본(바운딩 스피어 표시용) */
  bounds: Float32Array;
}

const USAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;

export class GeometryPool {
  readonly vertices: Arena;
  readonly meshlets: Arena;
  readonly bounds: Arena;
  readonly vertexIndices: Arena;
  readonly primitives: Arena;
  readonly lodTable: GPUBuffer;
  private readonly lodData = new Uint32Array((LOD_SLOTS * LAYOUT.ArtworkLod.size) / 4);
  readonly records: (LodRecord | null)[] = new Array(LOD_SLOTS).fill(null);
  /** 버퍼가 새로 만들어질 때마다 증가 → 바인드 그룹 재생성 신호 */
  version = 0;
  totalMeshlets = 0;
  totalTriangles = 0;

  constructor(private readonly device: GPUDevice) {
    const mk = (name: string, capacity: number): Arena => ({
      name,
      capacity,
      used: 0,
      buffer: device.createBuffer({ label: `geom-${name}`, size: capacity, usage: USAGE }),
    });
    this.vertices = mk('vertices', 4 << 20);
    this.meshlets = mk('meshlets', 256 << 10);
    this.bounds = mk('bounds', 512 << 10);
    this.vertexIndices = mk('vertexIndices', 1 << 20);
    this.primitives = mk('primitives', 1 << 20);
    this.lodTable = device.createBuffer({ label: 'geom-lodTable', size: this.lodData.byteLength, usage: USAGE });
    device.queue.writeBuffer(this.lodTable, 0, this.lodData);
  }

  private ensure(a: Arena, extra: number) {
    const need = a.used + extra;
    if (need <= a.capacity) return;
    let cap = a.capacity;
    while (cap < need) cap *= 2;
    const limit = this.device.limits.maxStorageBufferBindingSize;
    if (cap > limit) {
      if (need > limit) throw new Error(`${a.name} 버퍼가 maxStorageBufferBindingSize(${limit})를 넘습니다: ${need}`);
      cap = limit;
    }
    const next = this.device.createBuffer({ label: `geom-${a.name}`, size: cap, usage: USAGE });
    const enc = this.device.createCommandEncoder({ label: `grow-${a.name}` });
    if (a.used > 0) enc.copyBufferToBuffer(a.buffer, 0, next, 0, a.used);
    this.device.queue.submit([enc.finish()]);
    a.buffer.destroy(); // 제출된 명령이 끝난 뒤 해제된다
    a.buffer = next;
    a.capacity = cap;
    this.version++;
  }

  add(d: LodMeshData) {
    const slot = d.artwork * 4 + d.lod;
    const vBase = this.vertices.used / 16;
    const viBase = this.vertexIndices.used / 4;
    const pBase = this.primitives.used / 4;
    const mBase = this.meshlets.used / 16;

    // 전역 오프셋으로 보정
    const meshlets = d.meshlets;
    for (let i = 0; i < meshlets.length; i += 4) {
      meshlets[i] = meshlets[i]! + viBase;
      meshlets[i + 2] = meshlets[i + 2]! + pBase;
    }
    const vi = d.vertexIndices;
    for (let i = 0; i < vi.length; i++) vi[i] = vi[i]! + vBase;

    const put = (a: Arena, data: ArrayBufferView | ArrayBuffer) => {
      const bytes = data instanceof ArrayBuffer ? data.byteLength : data.byteLength;
      this.ensure(a, bytes);
      if (bytes > 0) {
        if (data instanceof ArrayBuffer) this.device.queue.writeBuffer(a.buffer, a.used, data);
        else this.device.queue.writeBuffer(a.buffer, a.used, data.buffer, data.byteOffset, data.byteLength);
      }
      a.used += bytes;
    };
    put(this.vertices, d.vertices);
    put(this.vertexIndices, vi);
    put(this.primitives, d.primitives);
    put(this.meshlets, meshlets);
    put(this.bounds, d.bounds);

    const o = (slot * LAYOUT.ArtworkLod.size) / 4;
    this.lodData[o] = mBase;
    this.lodData[o + 1] = d.meshletCount;
    this.lodData[o + 2] = d.triangleCount;
    this.lodData[o + 3] = 1;
    this.device.queue.writeBuffer(this.lodTable, slot * LAYOUT.ArtworkLod.size, this.lodData, o, 4);

    this.records[slot] = {
      meshletOffset: mBase,
      meshletCount: d.meshletCount,
      triCount: d.triangleCount,
      vertexCount: d.vertexCount,
      bounds: d.bounds,
    };
    this.totalMeshlets += d.meshletCount;
    this.totalTriangles += d.triangleCount;
  }

  isAvailable(artwork: number, lod: number) {
    return this.records[artwork * 4 + lod] !== null;
  }

  /** CPU 쪽 LOD 선택(GPU lod_select와 같은 규칙) — 바운딩 스피어 표시·Inspector용 */
  pickAvailable(artwork: number, want: number): number {
    for (let d = 0; d < 4; d++) {
      if (want + d < 4 && this.isAvailable(artwork, want + d)) return want + d;
      if (d <= want && this.isAvailable(artwork, want - d)) return want - d;
    }
    return -1;
  }

  destroy() {
    for (const a of [this.vertices, this.meshlets, this.bounds, this.vertexIndices, this.primitives]) a.buffer.destroy();
    this.lodTable.destroy();
  }
}
