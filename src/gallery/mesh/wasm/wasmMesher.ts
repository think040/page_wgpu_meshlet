// WAT + SIMD 모듈 래퍼. wasm/sdf.wat(격자 평가)와 wasm/bounds.wat(메시릿 컬링 데이터)를
// TS 참조 구현과 같은 인터페이스(SdfKernel, BoundsFn)로 감싼다.
// 주의: memory.grow 후에는 기존 TypedArray 뷰가 무효가 되므로 뷰는 매번 memory.buffer에서 새로 만든다.

import type { BoundsFn } from '../buildLod';
import { makeSegments, MAX_BLOCK_SAMPLES, SLOT_COUNT, type BlockDesc, type KernelTables, type SdfKernel, type Slot } from '../sdf/kernel';
import type { GridSpec, MeshletSet } from '../types';

interface SdfExports {
  memory: WebAssembly.Memory;
  set_grid(origin: number, step: number): void;
  set_block(ix0: number, iy0: number, iz0: number, ny: number, nz: number, stride: number): void;
  sphere(dst: number, cx: number, cy: number, cz: number, r: number): void;
  capsule_chain(dst: number, segs: number, count: number, r: number): void;
  twist_box(dst: number, hx: number, hy: number, hz: number, round: number, cosT: number, sinT: number): void;
  gyroid(dst: number, t: number, scale: number, sinT: number, cosT: number): void;
  shells(dst: number, cx: number, cy: number, cz: number, r0: number, dr: number, count: number, t: number): void;
  plane(dst: number, nx: number, ny: number, nz: number, d: number): void;
  smooth_union(dst: number, a: number, b: number, n: number, k: number): void;
  smooth_sub(dst: number, a: number, b: number, n: number, k: number): void;
  op_max(dst: number, a: number, b: number, n: number): void;
  op_min(dst: number, a: number, b: number, n: number): void;
}

interface BoundsExports {
  memory: WebAssembly.Memory;
  meshlet_bounds(pos: number, meshlets: number, count: number, vidx: number, prims: number, out: number, scratch: number): void;
}

/** SIMD 지원 감지용 최소 모듈: (func (result v128) i32.const 0 i8x16.splat i8x16.popcnt) */
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

export function simdSupported(): boolean {
  try {
    return WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

// ── 선형 메모리 배치(sdf) ──
const SLOT_BYTES = MAX_BLOCK_SAMPLES * 4;
const TABLE_BASE = SLOT_BYTES * SLOT_COUNT;
const TABLE_BYTES = 2048; // 최대 512 float (n+1+여유 4)
const SEG_BASE = TABLE_BASE + TABLE_BYTES * 4;
const MAX_SEGS = 1024;
const SDF_BYTES = SEG_BASE + MAX_SEGS * 32;

function ensureBytes(memory: WebAssembly.Memory, bytes: number) {
  const have = memory.buffer.byteLength;
  if (bytes > have) memory.grow(Math.ceil((bytes - have) / 65536));
}

export class WasmKernel implements SdfKernel {
  readonly name = 'wasm';
  private stride = 0;
  private n = 0;

  constructor(private readonly ex: SdfExports) {
    ensureBytes(ex.memory, SDF_BYTES);
  }

  get rowStride() {
    return this.stride;
  }

  /** 항상 현재 buffer에서 새 뷰(memory.grow 대비) */
  private f32(byteOffset: number, length: number) {
    return new Float32Array(this.ex.memory.buffer, byteOffset, length);
  }

  private slot(s: Slot) {
    return s * SLOT_BYTES;
  }

  private table(i: number) {
    return TABLE_BASE + i * TABLE_BYTES;
  }

  private putTable(i: number, data: Float32Array | undefined) {
    const view = this.f32(this.table(i), TABLE_BYTES / 4);
    view.fill(0);
    if (!data) return;
    if (data.length + 4 > view.length) throw new Error('표가 너무 큽니다');
    view.set(data);
    // x 방향은 4개씩 읽으므로 끝 여유 칸은 마지막 값으로 채운다
    for (let k = 0; k < 4; k++) view[data.length + k] = data[data.length - 1]!;
  }

  begin(grid: GridSpec, tables: KernelTables) {
    this.ex.set_grid(grid.origin, grid.step);
    this.putTable(0, tables.twistCos);
    this.putTable(1, tables.twistSin);
    this.putTable(2, tables.gyroSin);
    this.putTable(3, tables.gyroCos);
  }

  setBlock(b: BlockDesc) {
    this.stride = (b.nx + 3) & ~3;
    this.n = this.stride * b.ny * b.nz;
    if (this.n > MAX_BLOCK_SAMPLES) throw new Error('block too large');
    this.ex.set_block(b.ix0, b.iy0, b.iz0, b.ny, b.nz, this.stride);
  }

  read(s: Slot) {
    return this.f32(this.slot(s), MAX_BLOCK_SAMPLES);
  }

  sphere(dst: Slot, cx: number, cy: number, cz: number, r: number) {
    this.ex.sphere(this.slot(dst), cx, cy, cz, r);
  }

  capsule(dst: Slot, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number) {
    this.f32(SEG_BASE, 8).set(makeSegments(new Float32Array([ax, ay, az, bx, by, bz]), false));
    this.ex.capsule_chain(this.slot(dst), SEG_BASE, 1, r);
  }

  twistBox(dst: Slot, hx: number, hy: number, hz: number, round: number) {
    this.ex.twist_box(this.slot(dst), hx, hy, hz, round, this.table(0), this.table(1));
  }

  capsuleChain(dst: Slot, segs: Float32Array, count: number, r: number) {
    if (count > MAX_SEGS) throw new Error('선분이 너무 많습니다');
    this.f32(SEG_BASE, count * 8).set(segs.subarray(0, count * 8));
    this.ex.capsule_chain(this.slot(dst), SEG_BASE, count, r);
  }

  gyroid(dst: Slot, thickness: number, scale: number) {
    this.ex.gyroid(this.slot(dst), thickness, scale, this.table(2), this.table(3));
  }

  shells(dst: Slot, cx: number, cy: number, cz: number, r0: number, dr: number, count: number, t: number) {
    this.ex.shells(this.slot(dst), cx, cy, cz, r0, dr, count, t);
  }

  plane(dst: Slot, nx: number, ny: number, nz: number, d: number) {
    this.ex.plane(this.slot(dst), nx, ny, nz, d);
  }

  smoothUnion(dst: Slot, a: Slot, b: Slot, k: number) {
    this.ex.smooth_union(this.slot(dst), this.slot(a), this.slot(b), this.n, k);
  }

  smoothSub(dst: Slot, a: Slot, b: Slot, k: number) {
    this.ex.smooth_sub(this.slot(dst), this.slot(a), this.slot(b), this.n, k);
  }

  max(dst: Slot, a: Slot, b: Slot) {
    this.ex.op_max(this.slot(dst), this.slot(a), this.slot(b), this.n);
  }

  min(dst: Slot, a: Slot, b: Slot) {
    this.ex.op_min(this.slot(dst), this.slot(a), this.slot(b), this.n);
  }
}

const align16 = (n: number) => (n + 15) & ~15;

export function wasmBounds(ex: BoundsExports): BoundsFn {
  return (positions: Float32Array, set: MeshletSet) => {
    const count = set.meshlets.length / 4;
    const posPtr = 0;
    const mPtr = align16(posPtr + positions.byteLength + 16);
    const viPtr = align16(mPtr + set.meshlets.byteLength);
    const prPtr = align16(viPtr + set.vertexIndices.byteLength);
    const outPtr = align16(prPtr + set.primitives.byteLength);
    const scratchPtr = align16(outPtr + count * 32);
    const total = scratchPtr + 126 * 16;
    ensureBytes(ex.memory, total);
    // grow 이후의 buffer로 뷰를 만든다
    const buf = ex.memory.buffer;
    new Float32Array(buf, posPtr, positions.length).set(positions);
    new Uint32Array(buf, mPtr, set.meshlets.length).set(set.meshlets);
    new Uint32Array(buf, viPtr, set.vertexIndices.length).set(set.vertexIndices);
    new Uint32Array(buf, prPtr, set.primitives.length).set(set.primitives);
    ex.meshlet_bounds(posPtr, mPtr, count, viPtr, prPtr, outPtr, scratchPtr);
    return new Float32Array(ex.memory.buffer, outPtr, count * 8).slice();
  };
}

export interface WasmMesher {
  kernel: SdfKernel;
  bounds: BoundsFn;
}

export async function createWasmMesherFromBytes(sdf: BufferSource, bounds: BufferSource): Promise<WasmMesher | null> {
  if (!simdSupported()) return null;
  const [a, b] = await Promise.all([WebAssembly.instantiate(sdf), WebAssembly.instantiate(bounds)]);
  return {
    kernel: new WasmKernel(a.instance.exports as unknown as SdfExports),
    bounds: wasmBounds(b.instance.exports as unknown as BoundsExports),
  };
}

/** public/wasm/에서 fetch로 불러온다(번들러 경로 문제 회피) */
export async function createWasmMesher(base: string): Promise<WasmMesher | null> {
  if (!simdSupported()) return null;
  const [sdf, bounds] = await Promise.all(
    ['sdf.wasm', 'bounds.wasm'].map(async (f) => {
      const res = await fetch(base + f);
      if (!res.ok) throw new Error(`${f} ${res.status}`);
      return res.arrayBuffer();
    }),
  );
  return createWasmMesherFromBytes(sdf!, bounds!);
}
