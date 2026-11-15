// 메시릿별 컬링 데이터 — TypeScript 참조 구현 (WAT: wasm/bounds.wat와 같은 동작).
//
// 바운딩 스피어: Ritter 근사(가장 먼 점 두 번 → 구 → 밖의 점으로 키움).
// 노멀 콘(meshoptimizer 방식, apex 없음):
//   axis = 삼각형 단위 노멀 합의 정규화, mindp = min(dot(axis, n_i))
//   mindp ≤ 0 → 퇴화(cutoff = 1, 절대 컬링 안 됨), 아니면 cutoff = sqrt(1 − mindp²)
//   GPU 판정: dot(c − eye, axis) ≥ cutoff·|c − eye| + r 이면 뒷면 → 컬링
// 출력: 메시릿당 (cx, cy, cz, r, ax, ay, az, cutoff)

import { BOUNDS_STRIDE, unpackPrim, type MeshletSet } from './types';

export function computeMeshletBounds(positions: Float32Array, set: MeshletSet): Float32Array {
  const count = set.meshlets.length / 4;
  const out = new Float32Array(count * BOUNDS_STRIDE);
  for (let m = 0; m < count; m++) {
    const vOff = set.meshlets[m * 4]!;
    const vCnt = set.meshlets[m * 4 + 1]!;
    const pOff = set.meshlets[m * 4 + 2]!;
    const pCnt = set.meshlets[m * 4 + 3]!;
    const P = (i: number, k: number) => positions[set.vertexIndices[vOff + i]! * 3 + k]!;

    // ── Ritter ──
    let ax = P(0, 0);
    let ay = P(0, 1);
    let az = P(0, 2);
    let best = -1;
    let bi = 0;
    for (let i = 0; i < vCnt; i++) {
      const d = (P(i, 0) - ax) ** 2 + (P(i, 1) - ay) ** 2 + (P(i, 2) - az) ** 2;
      if (d > best) {
        best = d;
        bi = i;
      }
    }
    ax = P(bi, 0);
    ay = P(bi, 1);
    az = P(bi, 2);
    best = -1;
    let bj = 0;
    for (let i = 0; i < vCnt; i++) {
      const d = (P(i, 0) - ax) ** 2 + (P(i, 1) - ay) ** 2 + (P(i, 2) - az) ** 2;
      if (d > best) {
        best = d;
        bj = i;
      }
    }
    let cx = (ax + P(bj, 0)) / 2;
    let cy = (ay + P(bj, 1)) / 2;
    let cz = (az + P(bj, 2)) / 2;
    let r = Math.sqrt(best) / 2;
    for (let i = 0; i < vCnt; i++) {
      const dx = P(i, 0) - cx;
      const dy = P(i, 1) - cy;
      const dz = P(i, 2) - cz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > r) {
        const nr = (r + d) / 2;
        const k = (nr - r) / d;
        cx += dx * k;
        cy += dy * k;
        cz += dz * k;
        r = nr;
      }
    }
    // 부동소수 오차 대비 아주 조금 키운다
    r *= 1.0001;

    // ── 노멀 콘 ──
    let sx = 0;
    let sy = 0;
    let sz = 0;
    const tn = new Float32Array(pCnt * 3);
    let valid = 0;
    for (let p = 0; p < pCnt; p++) {
      const [l0, l1, l2] = unpackPrim(set.primitives[pOff + p]!);
      const e1x = P(l1, 0) - P(l0, 0);
      const e1y = P(l1, 1) - P(l0, 1);
      const e1z = P(l1, 2) - P(l0, 2);
      const e2x = P(l2, 0) - P(l0, 0);
      const e2y = P(l2, 1) - P(l0, 1);
      const e2z = P(l2, 2) - P(l0, 2);
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (l < 1e-20) {
        tn[p * 3] = NaN; // 면적 0 — 콘 계산에서 제외
        continue;
      }
      nx /= l;
      ny /= l;
      nz /= l;
      tn[p * 3] = nx;
      tn[p * 3 + 1] = ny;
      tn[p * 3 + 2] = nz;
      sx += nx;
      sy += ny;
      sz += nz;
      valid++;
    }
    const sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
    let cutoff = 1;
    let axX = 0;
    let axY = 0;
    let axZ = 1;
    if (valid > 0 && sl > 1e-12) {
      axX = sx / sl;
      axY = sy / sl;
      axZ = sz / sl;
      let mindp = 1;
      for (let p = 0; p < pCnt; p++) {
        const nx = tn[p * 3]!;
        if (Number.isNaN(nx)) continue;
        mindp = Math.min(mindp, axX * nx + axY * tn[p * 3 + 1]! + axZ * tn[p * 3 + 2]!);
      }
      cutoff = mindp <= 0 ? 1 : Math.sqrt(1 - mindp * mindp);
    }
    const o = m * BOUNDS_STRIDE;
    out[o] = cx;
    out[o + 1] = cy;
    out[o + 2] = cz;
    out[o + 3] = r;
    out[o + 4] = axX;
    out[o + 5] = axY;
    out[o + 6] = axZ;
    out[o + 7] = cutoff;
  }
  return out;
}

/** 콘 판정(테스트·CPU 검증용, GPU와 같은 식) — true면 뒷면이라 컬링 */
export function coneCulled(bounds: Float32Array, m: number, ex: number, ey: number, ez: number): boolean {
  const o = m * BOUNDS_STRIDE;
  const dx = bounds[o]! - ex;
  const dy = bounds[o + 1]! - ey;
  const dz = bounds[o + 2]! - ez;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return dx * bounds[o + 4]! + dy * bounds[o + 5]! + dz * bounds[o + 6]! >= bounds[o + 7]! * len + bounds[o + 3]!;
}
