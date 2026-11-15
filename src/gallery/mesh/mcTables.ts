// Marching Cubes 케이스 표를 코드로 생성한다(256 케이스).
//
// 4,096개 숫자를 손으로 옮겨 적는 대신, 각 케이스에서 면마다 등치선 선분을 만들고
// 선분을 이어 닫힌 고리를 찾은 뒤 부채꼴로 삼각형화한다.
// 모호한 면(대각 두 꼭짓점만 안쪽)은 "안쪽 꼭짓점끼리 분리" 규칙으로 고정한다.
// 이 규칙은 면의 네 꼭짓점 부호에만 의존하므로 이웃 셀이 같은 면을 똑같이 자른다 → 균열 없음.
//
// 꼭짓점 번호: c = x | (y << 1) | (z << 2)
// 모서리 번호: e = axis * 4 + k, k = 다른 두 축 비트(낮은 축이 bit0). 아래쪽 꼭짓점 = 해당 축 비트 0.

export interface McEdge {
  c0: number; // 축 비트가 0인 꼭짓점
  c1: number;
  axis: number; // 0 x, 1 y, 2 z
  /** 셀 원점 기준 아래쪽 꼭짓점 오프셋 */
  dx: number;
  dy: number;
  dz: number;
}

export const MC_EDGES: readonly McEdge[] = (() => {
  const edges: McEdge[] = [];
  for (let axis = 0; axis < 3; axis++) {
    const others = [0, 1, 2].filter((a) => a !== axis);
    for (let k = 0; k < 4; k++) {
      let c0 = 0;
      if (k & 1) c0 |= 1 << others[0]!;
      if (k & 2) c0 |= 1 << others[1]!;
      const c1 = c0 | (1 << axis);
      edges.push({ c0, c1, axis, dx: c0 & 1, dy: (c0 >> 1) & 1, dz: (c0 >> 2) & 1 });
    }
  }
  return edges;
})();

function edgeBetween(a: number, b: number): number {
  for (let e = 0; e < 12; e++) {
    const E = MC_EDGES[e]!;
    if ((E.c0 === a && E.c1 === b) || (E.c0 === b && E.c1 === a)) return e;
  }
  throw new Error(`no edge ${a}-${b}`);
}

/** 면 6개: 꼭짓점 4개를 순환 순서로 */
const FACES: number[][] = (() => {
  const faces: number[][] = [];
  for (let axis = 0; axis < 3; axis++) {
    const [u, v] = [0, 1, 2].filter((a) => a !== axis) as [number, number];
    for (let side = 0; side < 2; side++) {
      const base = side << axis;
      faces.push([base, base | (1 << u), base | (1 << u) | (1 << v), base | (1 << v)]);
    }
  }
  return faces;
})();

const cornerPos = (c: number): [number, number, number] => [c & 1, (c >> 1) & 1, (c >> 2) & 1];

function edgeMid(e: number): [number, number, number] {
  const E = MC_EDGES[e]!;
  const a = cornerPos(E.c0);
  const b = cornerPos(E.c1);
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

function buildCase(mask: number): number[] {
  const inside = (c: number) => ((mask >> c) & 1) === 1;
  // 모서리별 이웃(면 선분) 2개
  const links: number[][] = Array.from({ length: 12 }, () => []);
  const link = (a: number, b: number) => {
    links[a]!.push(b);
    links[b]!.push(a);
  };
  for (const f of FACES) {
    const ins = f.map(inside);
    const fe = f.map((c, i) => edgeBetween(c, f[(i + 1) % 4]!));
    const crossing = [0, 1, 2, 3].filter((i) => ins[i] !== ins[(i + 1) % 4]);
    if (crossing.length === 2) {
      link(fe[crossing[0]!]!, fe[crossing[1]!]!);
    } else if (crossing.length === 4) {
      // 모호한 면: 안쪽 꼭짓점 i를 각각 잘라낸다 → 선분 (e[i−1], e[i])
      for (let i = 0; i < 4; i++) if (ins[i]) link(fe[(i + 3) % 4]!, fe[i]!);
    }
  }
  const tris: number[] = [];
  const used = new Array<boolean>(12).fill(false);
  for (let start = 0; start < 12; start++) {
    if (used[start] || links[start]!.length === 0) continue;
    if (links[start]!.length !== 2) throw new Error(`case ${mask}: edge ${start} degree ${links[start]!.length}`);
    const loop: number[] = [start];
    used[start] = true;
    let prev = start;
    let cur = links[start]![0]!;
    while (cur !== start) {
      loop.push(cur);
      used[cur] = true;
      const nb = links[cur]!;
      const next = nb[0] === prev ? nb[1]! : nb[0]!;
      prev = cur;
      cur = next;
    }
    // Newell 법선이 안쪽→바깥쪽(+SDF) 방향이 되도록 방향을 맞춘다 → 바깥에서 보면 CCW
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < loop.length; i++) {
      const a = edgeMid(loop[i]!);
      const b = edgeMid(loop[(i + 1) % loop.length]!);
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    let score = 0;
    for (const e of loop) {
      const E = MC_EDGES[e]!;
      const inC = inside(E.c0) ? E.c0 : E.c1;
      const outC = inC === E.c0 ? E.c1 : E.c0;
      const pi = cornerPos(inC);
      const po = cornerPos(outC);
      score += nx * (po[0] - pi[0]) + ny * (po[1] - pi[1]) + nz * (po[2] - pi[2]);
    }
    if (score < 0) loop.reverse();
    for (let i = 1; i + 1 < loop.length; i++) tris.push(loop[0]!, loop[i]!, loop[i + 1]!);
  }
  return tris;
}

/** caseOffsets[m]..caseOffsets[m+1] 범위가 케이스 m의 삼각형 모서리 번호들 */
export const MC_CASE_OFFSETS = new Uint16Array(257);
export const MC_CASE_EDGES: Uint8Array = (() => {
  const all: number[] = [];
  for (let m = 0; m < 256; m++) {
    MC_CASE_OFFSETS[m] = all.length;
    all.push(...buildCase(m));
  }
  MC_CASE_OFFSETS[256] = all.length;
  return Uint8Array.from(all);
})();
