// 메시릿 변환기 — 정점 64개 / 삼각형 126개 한도 (D3D12 샘플과 동일).
//
// 인접 삼각형을 따라가며 채운다:
//  1. 시드 = 아직 배정되지 않은 삼각형 중 모턴 순서(공간 순서)상 첫 번째
//  2. 메시릿에 정점이 추가될 때마다 그 정점을 쓰는 미배정 삼각형을 후보로 넣는다.
//     후보는 "추가 시 새로 늘어나는 정점 수(0~3)" 버킷에 들어가고, 가장 낮은 버킷의
//     가장 최근 후보(LIFO → 공간적으로 가까움)를 고른다.
//  3. 한도를 넘는 후보는 건너뛰고, 넣을 후보가 없으면 메시릿을 닫는다.

import { GrowU32 } from './growable';
import { MAX_MESHLET_PRIMS, MAX_MESHLET_VERTS, packPrim, type MeshletSet } from './types';

function part1by2(v: number): number {
  v &= 0x3ff;
  v = (v | (v << 16)) & 0x030000ff;
  v = (v | (v << 8)) & 0x0300f00f;
  v = (v | (v << 4)) & 0x030c30c3;
  v = (v | (v << 2)) & 0x09249249;
  return v >>> 0;
}

function mortonOrder(positions: Float32Array, indices: Uint32Array): Uint32Array {
  const triCount = indices.length / 3;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]!);
    minY = Math.min(minY, positions[i + 1]!);
    minZ = Math.min(minZ, positions[i + 2]!);
    maxX = Math.max(maxX, positions[i]!);
    maxY = Math.max(maxY, positions[i + 1]!);
    maxZ = Math.max(maxZ, positions[i + 2]!);
  }
  const ext = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-9);
  const keys = new Float64Array(triCount);
  for (let t = 0; t < triCount; t++) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k]! * 3;
      cx += positions[v]!;
      cy += positions[v + 1]!;
      cz += positions[v + 2]!;
    }
    const qx = Math.min(1023, Math.floor(((cx / 3 - minX) / ext) * 1024));
    const qy = Math.min(1023, Math.floor(((cy / 3 - minY) / ext) * 1024));
    const qz = Math.min(1023, Math.floor(((cz / 3 - minZ) / ext) * 1024));
    keys[t] = (part1by2(qx) | (part1by2(qy) << 1) | (part1by2(qz) << 2)) >>> 0;
  }
  const order = new Uint32Array(triCount);
  for (let i = 0; i < triCount; i++) order[i] = i;
  order.sort((a, b) => keys[a]! - keys[b]!);
  return order;
}

export function meshletize(positions: Float32Array, indices: Uint32Array): MeshletSet {
  const vertexCount = positions.length / 3;
  const triCount = indices.length / 3;

  // 정점 → 삼각형 인접(CSR)
  const adjStart = new Uint32Array(vertexCount + 1);
  for (let i = 0; i < indices.length; i++) adjStart[indices[i]! + 1]!++;
  for (let v = 0; v < vertexCount; v++) adjStart[v + 1]! += adjStart[v]!;
  const adjFill = adjStart.slice(0, vertexCount);
  const adj = new Uint32Array(indices.length);
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k]!;
      adj[adjFill[v]!++] = t;
    }
  }

  const order = mortonOrder(positions, indices);
  const assigned = new Uint8Array(triCount);
  const vStamp = new Int32Array(vertexCount).fill(-1); // 이 정점이 들어 있는 메시릿 번호
  const vLocal = new Uint8Array(vertexCount);

  const meshlets = new GrowU32(4 * Math.ceil(triCount / 100) + 16);
  const vertexIndices = new GrowU32(triCount);
  const primitives = new GrowU32(triCount);

  // 후보 버킷: (tri, newVertCount) 쌍을 스택으로
  const buckets = [new GrowU32(256), new GrowU32(256), new GrowU32(256), new GrowU32(256)];

  // 삼각형 중심
  const triC = new Float32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k]! * 3;
      triC[t * 3] = triC[t * 3]! + positions[v]! / 3;
      triC[t * 3 + 1] = triC[t * 3 + 1]! + positions[v + 1]! / 3;
      triC[t * 3 + 2] = triC[t * 3 + 2]! + positions[v + 2]! / 3;
    }
  }
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;

  let meshletId = 0;
  let cursor = 0;
  let vCount = 0;
  let pCount = 0;
  let vOffset = 0;
  let pOffset = 0;

  const newVerts = (t: number) => {
    let c = 0;
    for (let k = 0; k < 3; k++) if (vStamp[indices[t * 3 + k]!] !== meshletId) c++;
    return c;
  };

  const pushCandidatesOf = (v: number) => {
    for (let i = adjStart[v]!; i < adjStart[v + 1]!; i++) {
      const t = adj[i]!;
      if (assigned[t]) continue;
      const c = newVerts(t);
      const b = buckets[c]!;
      b.push(t);
    }
  };

  const addTriangle = (t: number) => {
    assigned[t] = 1;
    const loc = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k]!;
      if (vStamp[v] !== meshletId) {
        vStamp[v] = meshletId;
        vLocal[v] = vCount++;
        sumX += positions[v * 3]!;
        sumY += positions[v * 3 + 1]!;
        sumZ += positions[v * 3 + 2]!;
        vertexIndices.push(v);
        pushCandidatesOf(v);
      }
      loc[k] = vLocal[v]!;
    }
    primitives.push(packPrim(loc[0]!, loc[1]!, loc[2]!));
    pCount++;
  };

  const closeMeshlet = () => {
    if (pCount === 0) return;
    meshlets.push(vOffset);
    meshlets.push(vCount);
    meshlets.push(pOffset);
    meshlets.push(pCount);
    vOffset += vCount;
    pOffset += pCount;
    vCount = 0;
    pCount = 0;
    sumX = 0;
    sumY = 0;
    sumZ = 0;
    meshletId++;
    for (const b of buckets) b.length = 0;
  };

  let remaining = triCount;
  while (remaining > 0) {
    while (assigned[order[cursor]!]) cursor++;
    addTriangle(order[cursor]!);
    remaining--;
    for (;;) {
      if (pCount >= MAX_MESHLET_PRIMS) break;
      let picked = -1;
      // 새 정점이 0개인 후보는 공짜 — 바로 넣는다
      const b0 = buckets[0]!;
      while (b0.length > 0) {
        const t = b0.data[--b0.length]!;
        if (assigned[t] || newVerts(t) !== 0) continue;
        picked = t;
        break;
      }
      if (picked < 0) {
        // 정점이 늘어나는 후보 중에서는 메시릿 중심에 가장 가까운 것(둥글게 자라도록)
        const inv = 1 / vCount;
        const mx = sumX * inv;
        const my = sumY * inv;
        const mz = sumZ * inv;
        let bestScore = Infinity;
        let bestBucket = -1;
        let bestIdx = -1;
        for (let c = 1; c < 4; c++) {
          const b = buckets[c]!;
          let w = 0;
          for (let i = 0; i < b.length; i++) {
            const t = b.data[i]!;
            if (assigned[t]) continue;
            const nv = newVerts(t);
            // nv < c: 더 낮은 버킷에 새 항목이 이미 있다 / 한도 초과: 이 메시릿엔 못 넣음
            if (nv !== c || vCount + nv > MAX_MESHLET_VERTS) continue;
            const dx = triC[t * 3]! - mx;
            const dy = triC[t * 3 + 1]! - my;
            const dz = triC[t * 3 + 2]! - mz;
            const score = (dx * dx + dy * dy + dz * dz) * (1 + 0.3 * (c - 1));
            b.data[w] = t;
            if (score < bestScore) {
              bestScore = score;
              bestBucket = c;
              bestIdx = w;
            }
            w++;
          }
          b.length = w;
        }
        if (bestBucket > 0) {
          const b = buckets[bestBucket]!;
          picked = b.data[bestIdx]!;
          b.data[bestIdx] = b.data[--b.length]!;
        }
      }
      if (picked < 0) break;
      addTriangle(picked);
      remaining--;
    }
    closeMeshlet();
  }

  return {
    meshlets: meshlets.toArray(),
    vertexIndices: vertexIndices.toArray(),
    primitives: primitives.toArray(),
  };
}
