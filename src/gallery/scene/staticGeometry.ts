// 메시릿이 아닌 일반 파이프라인으로 그리는 정적 메시: 바닥, 벽·천장, 좌대, 선반, 라이트·카메라 표식.
// 정점 = pos f32×3 + normal f32×3 (24B). 모든 메시를 한 정점/인덱스 버퍼에 모은다.

import { PEDESTAL, PEDESTAL_POSITIONS, ROOM, SHELF } from './defaultScene';

export type StaticMeshName = 'floor' | 'walls' | 'pedestals' | 'shelf' | 'sphere' | 'camera';

export interface MeshRange {
  firstIndex: number;
  indexCount: number;
}

export interface StaticGeometry {
  vertices: Float32Array;
  indices: Uint32Array;
  ranges: Record<StaticMeshName, MeshRange>;
}

class Builder {
  v: number[] = [];
  i: number[] = [];
  get vertexCount() {
    return this.v.length / 6;
  }
  vert(p: [number, number, number], n: [number, number, number]) {
    this.v.push(p[0], p[1], p[2], n[0], n[1], n[2]);
    return this.vertexCount - 1;
  }
  /** 사각형 (a,b,c,d 반시계 = 노멀 쪽에서 볼 때) */
  quad(
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
    n: [number, number, number],
  ) {
    const i0 = this.vert(a, n);
    const i1 = this.vert(b, n);
    const i2 = this.vert(c, n);
    const i3 = this.vert(d, n);
    this.i.push(i0, i1, i2, i0, i2, i3);
  }
  /** 축 정렬 상자. inward=true면 안쪽을 향한다. skip = 생략할 면(예: 'bottom') */
  box(min: [number, number, number], max: [number, number, number], inward = false, skip: string[] = []) {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    const faces: Array<[string, [number, number, number][], [number, number, number]]> = [
      ['right', [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0]],
      ['left', [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0]],
      ['top', [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0]],
      ['bottom', [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]],
      ['front', [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]],
      ['back', [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1]],
    ];
    for (const [name, p, n] of faces) {
      if (skip.includes(name)) continue;
      if (inward) this.quad(p[3]!, p[2]!, p[1]!, p[0]!, [-n[0], -n[1], -n[2]]);
      else this.quad(p[0]!, p[1]!, p[2]!, p[3]!, n);
    }
  }
  sphere(r: number, seg = 12, rings = 8) {
    const base = this.vertexCount;
    for (let y = 0; y <= rings; y++) {
      const th = (y / rings) * Math.PI;
      for (let x = 0; x <= seg; x++) {
        const ph = (x / seg) * Math.PI * 2;
        const n: [number, number, number] = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
        this.vert([n[0] * r, n[1] * r, n[2] * r], n);
      }
    }
    for (let y = 0; y < rings; y++) {
      for (let x = 0; x < seg; x++) {
        const a = base + y * (seg + 1) + x;
        const b = a + seg + 1;
        this.i.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
}

export function buildStaticGeometry(): StaticGeometry {
  const b = new Builder();
  const ranges = {} as Record<StaticMeshName, MeshRange>;
  const begin = () => b.i.length;
  const end = (name: StaticMeshName, start: number) => {
    ranges[name] = { firstIndex: start, indexCount: b.i.length - start };
  };

  let s = begin();
  b.quad([-ROOM.halfX, 0, ROOM.halfZ], [ROOM.halfX, 0, ROOM.halfZ], [ROOM.halfX, 0, -ROOM.halfZ], [-ROOM.halfX, 0, -ROOM.halfZ], [0, 1, 0]);
  end('floor', s);

  s = begin();
  b.box([-ROOM.halfX, 0, -ROOM.halfZ], [ROOM.halfX, ROOM.height, ROOM.halfZ], true, ['bottom']);
  end('walls', s);

  s = begin();
  for (const [x, z] of PEDESTAL_POSITIONS) {
    b.box([x - PEDESTAL.half, 0, z - PEDESTAL.half], [x + PEDESTAL.half, PEDESTAL.height, z + PEDESTAL.half], false, ['bottom']);
  }
  end('pedestals', s);

  // 선반: 그룹 로컬 좌표(뒷벽 앞, z=0이 선반 앞쪽 중심선)
  s = begin();
  const hz = SHELF.depth / 2;
  for (const y of SHELF.boardYs) {
    b.box([-SHELF.halfWidth, y - SHELF.thickness / 2, -hz], [SHELF.halfWidth, y + SHELF.thickness / 2, hz]);
  }
  const topY = SHELF.boardYs[SHELF.boardYs.length - 1]! + 0.25;
  for (const x of [-SHELF.halfWidth - 0.04, SHELF.halfWidth + 0.04]) {
    b.box([x - 0.04, 0, -hz], [x + 0.04, topY, hz]);
  }
  end('shelf', s);

  s = begin();
  b.sphere(0.12);
  end('sphere', s);

  // 카메라 표식: 몸체 상자 + 앞쪽(−Z) 렌즈
  s = begin();
  b.box([-0.15, -0.11, -0.05], [0.15, 0.11, 0.22]);
  b.box([-0.07, -0.07, -0.2], [0.07, 0.07, -0.05]);
  end('camera', s);

  return { vertices: Float32Array.from(b.v), indices: Uint32Array.from(b.i), ranges };
}
