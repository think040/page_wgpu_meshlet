// 「결」 연작 6점의 SDF 정의. 모든 형태는 작품 로컬 좌표 [-1,1]³ 안에 들어간다(+y가 위).
//
// 각 작품은 같은 식을 두 가지 형태로 갖는다.
//  - program(): 커널(블록 배열 연산)로 격자를 평가 — TS 참조 커널과 WAT 커널이 공유
//  - evalPoint(): 임의의 점 1개 평가 — 브릭 생략 판정과 테스트용(Math 사용 가능)
// 삼각함수는 브리프 4장 규칙: 「비틀림」 y 표, 「침식」 축별 표, 「매듭」 점열 → 선분 체인.

import type { GridSpec } from '../types';
import {
  makeSegments,
  roundBox,
  segDist,
  shellsDist,
  sminPoly,
  smaxPoly,
  type KernelTables,
  type SdfKernel,
  type Slot,
} from './kernel';

export interface Aabb {
  min: [number, number, number];
  max: [number, number, number];
}

export interface ArtworkSdf {
  id: number;
  /** 립시츠 상한(≥1). 브릭 생략 판정에서 |d|를 이 값으로 나눈다. */
  lipschitz: number;
  /** 로컬 좌표에서 형태의 가장 낮은 y (좌대 위 배치용) */
  minY: number;
  tables(grid: GridSpec): KernelTables;
  /** 커널로 현재 블록을 평가하고 결과 슬롯을 돌려준다. box = 블록의 로컬 AABB */
  program(k: SdfKernel, box: Aabb, grid: GridSpec): Slot;
  evalPoint(x: number, y: number, z: number): number;
}

const len3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);
const sphereD = (x: number, y: number, z: number, cx: number, cy: number, cz: number, r: number) =>
  len3(x - cx, y - cy, z - cz) - r;

// ─────────────────────────────── 1 「응결」 ───────────────────────────────
const DROPS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.0, -0.42, 0.0, 0.5],
  [0.36, -0.05, 0.1, 0.36],
  [-0.3, 0.0, -0.15, 0.36],
  [0.05, 0.34, 0.05, 0.31],
  [-0.15, 0.62, 0.12, 0.2],
  [0.3, 0.5, -0.2, 0.17],
  [-0.45, -0.42, 0.28, 0.22],
  [0.22, -0.5, -0.42, 0.2],
];
const DROP_K = 0.18;

const condensation: ArtworkSdf = {
  id: 0,
  lipschitz: 1.1,
  minY: Math.min(...DROPS.map((d) => d[1] - d[3])),
  tables: () => ({}),
  program(k) {
    const [c0, ...rest] = DROPS;
    k.sphere(0, c0![0], c0![1], c0![2], c0![3]);
    for (const d of rest) {
      k.sphere(1, d[0], d[1], d[2], d[3]);
      k.smoothUnion(0, 0, 1, DROP_K);
    }
    return 0;
  },
  evalPoint(x, y, z) {
    let d = Infinity;
    for (const s of DROPS) {
      const e = sphereD(x, y, z, s[0], s[1], s[2], s[3]);
      d = d === Infinity ? e : sminPoly(d, e, DROP_K);
    }
    return d;
  },
};

// ─────────────────────────────── 2 「매듭」 ───────────────────────────────
// (2,3) 토러스 매듭: r(φ) = cos 3φ + 2,  (r cos 2φ, r sin 2φ, −sin 3φ) — xy 평면에 세워 둔다.
const KNOT_SAMPLES = 384;
const KNOT_SCALE = 0.27;
const KNOT_TUBE = 0.13;

function knotPoints(): Float32Array {
  const pts = new Float32Array(KNOT_SAMPLES * 3);
  for (let i = 0; i < KNOT_SAMPLES; i++) {
    const phi = (i / KNOT_SAMPLES) * Math.PI * 2;
    const r = Math.cos(3 * phi) + 2;
    pts[i * 3] = r * Math.cos(2 * phi) * KNOT_SCALE;
    pts[i * 3 + 1] = r * Math.sin(2 * phi) * KNOT_SCALE;
    pts[i * 3 + 2] = -Math.sin(3 * phi) * KNOT_SCALE;
  }
  return pts;
}
const KNOT_POINTS = knotPoints();
const KNOT_SEGS = makeSegments(KNOT_POINTS, true);
const KNOT_SEG_COUNT = KNOT_SEGS.length / 8;
const knotScratch = new Float32Array(KNOT_SEGS.length);

const knot: ArtworkSdf = {
  id: 1,
  lipschitz: 1.05,
  minY: (() => {
    let m = Infinity;
    for (let i = 1; i < KNOT_POINTS.length; i += 3) m = Math.min(m, KNOT_POINTS[i]!);
    return m - KNOT_TUBE;
  })(),
  tables: () => ({}),
  program(k, box, grid) {
    // 블록 근처 선분만 골라 넘긴다. 여유 = 튜브 반경 + 4셀 (계획서 2.3)
    const m = KNOT_TUBE + 4 * grid.step;
    let count = 0;
    for (let i = 0; i < KNOT_SEG_COUNT; i++) {
      const o = i * 8;
      const ax = KNOT_SEGS[o]!;
      const ay = KNOT_SEGS[o + 1]!;
      const az = KNOT_SEGS[o + 2]!;
      const bx = ax + KNOT_SEGS[o + 3]!;
      const by = ay + KNOT_SEGS[o + 4]!;
      const bz = az + KNOT_SEGS[o + 5]!;
      if (
        Math.max(ax, bx) < box.min[0] - m ||
        Math.min(ax, bx) > box.max[0] + m ||
        Math.max(ay, by) < box.min[1] - m ||
        Math.min(ay, by) > box.max[1] + m ||
        Math.max(az, bz) < box.min[2] - m ||
        Math.min(az, bz) > box.max[2] + m
      )
        continue;
      knotScratch.set(KNOT_SEGS.subarray(o, o + 8), count * 8);
      count++;
    }
    if (count === 0) {
      // 블록 전체가 튜브에서 멀다 — 양수로 채운다(구 대신 아주 먼 점까지의 거리)
      k.sphere(0, 100, 100, 100, 0);
      return 0;
    }
    k.capsuleChain(0, knotScratch, count, KNOT_TUBE);
    return 0;
  },
  evalPoint(x, y, z) {
    let m = Infinity;
    for (let i = 0; i < KNOT_SEG_COUNT; i++) m = Math.min(m, segDist(x, y, z, KNOT_SEGS, i));
    return m - KNOT_TUBE;
  },
};

// ─────────────────────────────── 3 「비틀림」 ───────────────────────────────
const TW_H: readonly [number, number, number] = [0.33, 0.92, 0.33];
const TW_ROUND = 0.08;
const TW_TURNS = 0.75; // 전체 높이에 걸친 회전 수

function twistAngle(y: number) {
  return ((y + TW_H[1]) / (2 * TW_H[1])) * TW_TURNS * Math.PI * 2;
}

const twist: ArtworkSdf = {
  id: 2,
  lipschitz: 1.6,
  minY: -TW_H[1],
  tables(grid) {
    const cos = new Float32Array(grid.n + 1);
    const sin = new Float32Array(grid.n + 1);
    for (let i = 0; i <= grid.n; i++) {
      const a = twistAngle(grid.origin + i * grid.step);
      cos[i] = Math.cos(a);
      sin[i] = Math.sin(a);
    }
    return { twistCos: cos, twistSin: sin };
  },
  program(k) {
    k.twistBox(0, TW_H[0], TW_H[1], TW_H[2], TW_ROUND);
    return 0;
  },
  evalPoint(x, y, z) {
    const a = twistAngle(y);
    const c = Math.cos(a);
    const s = Math.sin(a);
    return roundBox(c * x + s * z, y, -s * x + c * z, TW_H[0], TW_H[1], TW_H[2], TW_ROUND);
  },
};

// ─────────────────────────────── 4 「빈 자리」 ───────────────────────────────
const EGG_LOW = [0, -0.25, 0, 0.62] as const;
const EGG_TOP = [0, 0.3, 0, 0.45] as const;
const EGG_K = 0.45;
const HOLE_A = [0.32, 0.22, 0.4, 0.3] as const;
const HOLE_B = [-0.2, 0.58, -0.3, 0.18] as const;
const HOLE_CAP = [-0.75, -0.3, -0.2, 0.3, 0.15, 0.75, 0.17] as const;
const CARVE_K = 0.07;
const HOLE_CAP_SEG = makeSegments(new Float32Array(HOLE_CAP.slice(0, 6)), false);

const vacancy: ArtworkSdf = {
  id: 3,
  lipschitz: 1.1,
  minY: EGG_LOW[1] - EGG_LOW[3],
  tables: () => ({}),
  program(k) {
    k.sphere(0, ...EGG_LOW);
    k.sphere(1, ...EGG_TOP);
    k.smoothUnion(0, 0, 1, EGG_K);
    k.sphere(1, ...HOLE_A);
    k.smoothSub(0, 0, 1, CARVE_K);
    k.sphere(1, ...HOLE_B);
    k.smoothSub(0, 0, 1, CARVE_K);
    k.capsule(1, ...HOLE_CAP);
    k.smoothSub(0, 0, 1, CARVE_K);
    return 0;
  },
  evalPoint(x, y, z) {
    let d = sminPoly(sphereD(x, y, z, ...EGG_LOW), sphereD(x, y, z, ...EGG_TOP), EGG_K);
    d = smaxPoly(d, -sphereD(x, y, z, ...HOLE_A), CARVE_K);
    d = smaxPoly(d, -sphereD(x, y, z, ...HOLE_B), CARVE_K);
    d = smaxPoly(d, -(segDist(x, y, z, HOLE_CAP_SEG, 0) - HOLE_CAP[6]), CARVE_K);
    return d;
  },
};

// ─────────────────────────────── 5 「침식」 ───────────────────────────────
const ER_R = 0.92;
const ER_PERIOD = 0.62;
const ER_FREQ = (Math.PI * 2) / ER_PERIOD;
const ER_THICK = 0.42;
const ER_SCALE = 1 / (ER_FREQ * 1.5);
const ER_BASE = 0.78; // y = −0.78 아래를 평평하게 잘라 좌대에 앉힌다

const erosion: ArtworkSdf = {
  id: 4,
  lipschitz: 1.8,
  minY: -ER_BASE,
  tables(grid) {
    const sin = new Float32Array(grid.n + 1);
    const cos = new Float32Array(grid.n + 1);
    for (let i = 0; i <= grid.n; i++) {
      const v = ER_FREQ * (grid.origin + i * grid.step);
      sin[i] = Math.sin(v);
      cos[i] = Math.cos(v);
    }
    return { gyroSin: sin, gyroCos: cos };
  },
  program(k) {
    k.sphere(0, 0, 0, 0, ER_R);
    k.gyroid(1, ER_THICK, ER_SCALE);
    k.max(0, 0, 1);
    k.plane(1, 0, -1, 0, ER_BASE);
    k.max(0, 0, 1);
    return 0;
  },
  evalPoint(x, y, z) {
    const sx = Math.sin(ER_FREQ * x);
    const sy = Math.sin(ER_FREQ * y);
    const sz = Math.sin(ER_FREQ * z);
    const cx = Math.cos(ER_FREQ * x);
    const cy = Math.cos(ER_FREQ * y);
    const cz = Math.cos(ER_FREQ * z);
    const g = sx * cy + sy * cz + sz * cx;
    let d = Math.max(len3(x, y, z) - ER_R, (Math.abs(g) - ER_THICK) * ER_SCALE);
    d = Math.max(d, -y - ER_BASE);
    return d;
  },
};

// ─────────────────────────────── 6 「겹」 ───────────────────────────────
const SH_R0 = 0.42;
const SH_DR = 0.2;
const SH_COUNT = 3;
const SH_T = 0.045;
const SH_CUT_N = (() => {
  const v = [0.5, 0.8, 0.35];
  const l = len3(v[0]!, v[1]!, v[2]!);
  return [v[0]! / l, v[1]! / l, v[2]! / l] as const;
})();
const SH_CUT_D = 0.12;
const SH_BASE = 0.7;

const layers: ArtworkSdf = {
  id: 5,
  lipschitz: 1.05,
  minY: -SH_BASE,
  tables: () => ({}),
  program(k) {
    k.shells(0, 0, 0, 0, SH_R0, SH_DR, SH_COUNT, SH_T);
    k.plane(1, SH_CUT_N[0], SH_CUT_N[1], SH_CUT_N[2], SH_CUT_D);
    k.max(0, 0, 1);
    k.plane(1, 0, -1, 0, SH_BASE);
    k.max(0, 0, 1);
    return 0;
  },
  evalPoint(x, y, z) {
    let d = shellsDist(len3(x, y, z), SH_R0, SH_DR, SH_COUNT, SH_T);
    d = Math.max(d, x * SH_CUT_N[0] + y * SH_CUT_N[1] + z * SH_CUT_N[2] - SH_CUT_D);
    d = Math.max(d, -y - SH_BASE);
    return d;
  },
};

export const ARTWORK_SDFS: readonly ArtworkSdf[] = [condensation, knot, twist, vacancy, erosion, layers];
