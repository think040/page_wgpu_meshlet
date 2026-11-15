// SDF 격자 평가 커널 인터페이스와 TypeScript 참조 구현.
//
// 함수는 "점 1개"가 아니라 "블록 전체(배열)"를 한 번에 처리한다(브리프 4장).
// 블록 = 격자 샘플 인덱스 범위 [ix0, ix0+nx) × [iy0, iy0+ny) × [iz0, iz0+nz).
// 슬롯 배열 레이아웃: idx = (y * nz + z) * rowStride + x,  rowStride = nx를 4의 배수로 올림(SIMD 레인).
// WAT 커널(9단계)은 같은 인터페이스·같은 레이아웃을 구현하며, 테스트가 두 결과를 비교한다.

import type { GridSpec } from '../types';

export type Slot = number;
export const SLOT_COUNT = 6;

/** 블록 최대 크기(샘플): x 8, y 슬랩 높이 + 여유, z 8 */
export const MAX_BLOCK_X = 8;
export const MAX_BLOCK_Y = 24;
export const MAX_BLOCK_Z = 8;
export const MAX_BLOCK_SAMPLES = MAX_BLOCK_X * MAX_BLOCK_Y * MAX_BLOCK_Z;

export interface BlockDesc {
  ix0: number;
  iy0: number;
  iz0: number;
  nx: number;
  ny: number;
  nz: number;
}

/** 축별 삼각함수 표(TS에서 Math로 미리 계산, 인덱스 = 전역 샘플 인덱스) */
export interface KernelTables {
  /** 「비틀림」: y 샘플별 cos θ(y), sin θ(y) */
  twistCos?: Float32Array;
  twistSin?: Float32Array;
  /** 「침식」: 축 샘플별 sin(f·x), cos(f·x) — 격자가 정육면체라 세 축이 같은 표를 쓴다 */
  gyroSin?: Float32Array;
  gyroCos?: Float32Array;
}

export interface SdfKernel {
  readonly name: string;
  begin(grid: GridSpec, tables: KernelTables): void;
  setBlock(b: BlockDesc): void;
  readonly rowStride: number;

  sphere(dst: Slot, cx: number, cy: number, cz: number, r: number): void;
  capsule(dst: Slot, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): void;
  /** 둥근 박스(반폭 h, 모서리 반경 round)를 y에 따라 xz 회전 — 회전은 twistCos/Sin 표 */
  twistBox(dst: Slot, hx: number, hy: number, hz: number, round: number): void;
  /** 선분 체인까지의 최소 거리 − r. segs = 선분당 f32 8개(ax,ay,az, bax,bay,baz, 1/|ba|², 0) */
  capsuleChain(dst: Slot, segs: Float32Array, count: number, r: number): void;
  /** gyroid 껍질: (|g| − thickness) × scale,  g = sx·cy + sy·cz + sz·cx (표 사용) */
  gyroid(dst: Slot, thickness: number, scale: number): void;
  /** 동심 구면 껍질: min_k | |p−c| − (r0 + k·dr) | − t,  k = 0..count−1 */
  shells(dst: Slot, cx: number, cy: number, cz: number, r0: number, dr: number, count: number, t: number): void;
  /** 반공간: dot(p, n) − d */
  plane(dst: Slot, nx: number, ny: number, nz: number, d: number): void;

  smoothUnion(dst: Slot, a: Slot, b: Slot, k: number): void;
  /** a에서 b를 부드럽게 빼기: smax(a, −b) */
  smoothSub(dst: Slot, a: Slot, b: Slot, k: number): void;
  max(dst: Slot, a: Slot, b: Slot): void;
  min(dst: Slot, a: Slot, b: Slot): void;

  /** 슬롯 내용 보기(rowStride 레이아웃). 다음 커널 호출 전까지만 유효. */
  read(slot: Slot): Float32Array;
}

// ── 스칼라 공용 수식 (TS 커널과 점 평가가 같이 쓴다) ──

export function sminPoly(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export function smaxPoly(a: number, b: number, k: number): number {
  return -sminPoly(-a, -b, k);
}

export function roundBox(px: number, py: number, pz: number, hx: number, hy: number, hz: number, r: number): number {
  const qx = Math.abs(px) - (hx - r);
  const qy = Math.abs(py) - (hy - r);
  const qz = Math.abs(pz) - (hz - r);
  const mx = Math.max(qx, 0);
  const my = Math.max(qy, 0);
  const mz = Math.max(qz, 0);
  return Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r;
}

export function segDist(
  px: number,
  py: number,
  pz: number,
  segs: Float32Array,
  i: number,
): number {
  const o = i * 8;
  const pax = px - segs[o]!;
  const pay = py - segs[o + 1]!;
  const paz = pz - segs[o + 2]!;
  const bax = segs[o + 3]!;
  const bay = segs[o + 4]!;
  const baz = segs[o + 5]!;
  let h = (pax * bax + pay * bay + paz * baz) * segs[o + 6]!;
  h = h < 0 ? 0 : h > 1 ? 1 : h;
  const dx = pax - bax * h;
  const dy = pay - bay * h;
  const dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function shellsDist(len: number, r0: number, dr: number, count: number, t: number): number {
  let m = Infinity;
  for (let k = 0; k < count; k++) m = Math.min(m, Math.abs(len - (r0 + k * dr)));
  return m - t;
}

/** 선분 배열을 커널 형식(선분당 8 float)으로 만든다. 닫힌 폴리라인이면 마지막→처음도 포함. */
export function makeSegments(points: Float32Array, closed: boolean): Float32Array {
  const n = points.length / 3;
  const count = closed ? n : n - 1;
  const segs = new Float32Array(count * 8);
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % n;
    const ax = points[i * 3]!;
    const ay = points[i * 3 + 1]!;
    const az = points[i * 3 + 2]!;
    const bax = points[j * 3]! - ax;
    const bay = points[j * 3 + 1]! - ay;
    const baz = points[j * 3 + 2]! - az;
    const o = i * 8;
    segs[o] = ax;
    segs[o + 1] = ay;
    segs[o + 2] = az;
    segs[o + 3] = bax;
    segs[o + 4] = bay;
    segs[o + 5] = baz;
    segs[o + 6] = 1 / Math.max(bax * bax + bay * bay + baz * baz, 1e-12);
    segs[o + 7] = 0;
  }
  return segs;
}

// ── TypeScript 참조 커널 ──

export class TsKernel implements SdfKernel {
  readonly name = 'ts';
  private grid: GridSpec = { n: 0, origin: 0, step: 0 };
  private tables: KernelTables = {};
  private block: BlockDesc = { ix0: 0, iy0: 0, iz0: 0, nx: 0, ny: 0, nz: 0 };
  private stride = 0;
  private readonly slots: Float32Array[] = Array.from({ length: SLOT_COUNT }, () => new Float32Array(MAX_BLOCK_SAMPLES));

  get rowStride() {
    return this.stride;
  }

  begin(grid: GridSpec, tables: KernelTables) {
    this.grid = grid;
    this.tables = tables;
  }

  setBlock(b: BlockDesc) {
    if (b.nx > MAX_BLOCK_X || b.ny > MAX_BLOCK_Y || b.nz > MAX_BLOCK_Z) throw new Error('block too large');
    this.block = b;
    this.stride = (b.nx + 3) & ~3;
  }

  read(slot: Slot) {
    return this.slots[slot]!;
  }

  /** 블록의 각 샘플에 대해 f(x,y,z, ix,iy,iz)를 기록 */
  private each(dst: Slot, f: (x: number, y: number, z: number, ix: number, iy: number, iz: number) => number) {
    const out = this.slots[dst]!;
    const { ix0, iy0, iz0, nx, ny, nz } = this.block;
    const { origin, step } = this.grid;
    const stride = this.stride;
    for (let ly = 0; ly < ny; ly++) {
      const iy = iy0 + ly;
      const y = origin + iy * step;
      for (let lz = 0; lz < nz; lz++) {
        const iz = iz0 + lz;
        const z = origin + iz * step;
        const row = (ly * nz + lz) * stride;
        for (let lx = 0; lx < nx; lx++) {
          const ix = ix0 + lx;
          out[row + lx] = f(origin + ix * step, y, z, ix, iy, iz);
        }
      }
    }
  }

  private binary(dst: Slot, a: Slot, b: Slot, op: (x: number, y: number) => number) {
    const out = this.slots[dst]!;
    const A = this.slots[a]!;
    const B = this.slots[b]!;
    const n = this.stride * this.block.ny * this.block.nz;
    for (let i = 0; i < n; i++) out[i] = op(A[i]!, B[i]!);
  }

  sphere(dst: Slot, cx: number, cy: number, cz: number, r: number) {
    this.each(dst, (x, y, z) => Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy) + (z - cz) * (z - cz)) - r);
  }

  capsule(dst: Slot, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number) {
    const seg = makeSegments(new Float32Array([ax, ay, az, bx, by, bz]), false);
    this.each(dst, (x, y, z) => segDist(x, y, z, seg, 0) - r);
  }

  twistBox(dst: Slot, hx: number, hy: number, hz: number, round: number) {
    const cosT = this.tables.twistCos;
    const sinT = this.tables.twistSin;
    if (!cosT || !sinT) throw new Error('twist tables missing');
    this.each(dst, (x, y, z, _ix, iy) => {
      const c = cosT[iy]!;
      const s = sinT[iy]!;
      return roundBox(c * x + s * z, y, -s * x + c * z, hx, hy, hz, round);
    });
  }

  capsuleChain(dst: Slot, segs: Float32Array, count: number, r: number) {
    this.each(dst, (x, y, z) => {
      let m = Infinity;
      for (let i = 0; i < count; i++) m = Math.min(m, segDist(x, y, z, segs, i));
      return m - r;
    });
  }

  gyroid(dst: Slot, thickness: number, scale: number) {
    const S = this.tables.gyroSin;
    const C = this.tables.gyroCos;
    if (!S || !C) throw new Error('gyroid tables missing');
    this.each(dst, (_x, _y, _z, ix, iy, iz) => {
      const g = S[ix]! * C[iy]! + S[iy]! * C[iz]! + S[iz]! * C[ix]!;
      return (Math.abs(g) - thickness) * scale;
    });
  }

  shells(dst: Slot, cx: number, cy: number, cz: number, r0: number, dr: number, count: number, t: number) {
    this.each(dst, (x, y, z) => shellsDist(Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy) + (z - cz) * (z - cz)), r0, dr, count, t));
  }

  plane(dst: Slot, nx: number, ny: number, nz: number, d: number) {
    this.each(dst, (x, y, z) => x * nx + y * ny + z * nz - d);
  }

  smoothUnion(dst: Slot, a: Slot, b: Slot, k: number) {
    this.binary(dst, a, b, (x, y) => sminPoly(x, y, k));
  }

  smoothSub(dst: Slot, a: Slot, b: Slot, k: number) {
    this.binary(dst, a, b, (x, y) => smaxPoly(x, -y, k));
  }

  max(dst: Slot, a: Slot, b: Slot) {
    this.binary(dst, a, b, Math.max);
  }

  min(dst: Slot, a: Slot, b: Slot) {
    this.binary(dst, a, b, Math.min);
  }
}
