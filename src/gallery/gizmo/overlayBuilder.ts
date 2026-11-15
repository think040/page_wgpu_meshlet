// 오버레이 정점 목록 작성 도우미. 정점 = x,y,z,r,g,b,a (sRGB 색).
import { add, cross, normalize, scale, type Vec3 } from '../math/math';
import type { OverlayGeometry } from '../gpu/renderer';

export type Rgba = readonly [number, number, number, number];

export function emptyOverlay(): OverlayGeometry {
  return { linesOnTop: [], linesDepth: [], trisOnTop: [] };
}

export function pushLine(out: number[], a: Vec3, b: Vec3, c: Rgba) {
  out.push(a[0], a[1], a[2], c[0], c[1], c[2], c[3], b[0], b[1], b[2], c[0], c[1], c[2], c[3]);
}

export function pushTri(out: number[], a: Vec3, b: Vec3, d: Vec3, c: Rgba) {
  out.push(a[0], a[1], a[2], c[0], c[1], c[2], c[3]);
  out.push(b[0], b[1], b[2], c[0], c[1], c[2], c[3]);
  out.push(d[0], d[1], d[2], c[0], c[1], c[2], c[3]);
}

/** 축 n에 수직인 단위 기저 두 개 */
export function perpBasis(n: Vec3): [Vec3, Vec3] {
  const helper: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize(cross(n, helper));
  const v = cross(n, u);
  return [u, v];
}

export function circlePoints(center: Vec3, normal: Vec3, radius: number, segments: number): Vec3[] {
  const [u, v] = perpBasis(normalize(normal));
  const pts: Vec3[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(add(center, add(scale(u, Math.cos(a) * radius), scale(v, Math.sin(a) * radius))));
  }
  return pts;
}

export function pushCircle(out: number[], center: Vec3, normal: Vec3, radius: number, segments: number, c: Rgba) {
  const pts = circlePoints(center, normal, radius, segments);
  for (let i = 0; i < segments; i++) pushLine(out, pts[i]!, pts[i + 1]!, c);
}

export function pushCone(out: number[], base: Vec3, dir: Vec3, radius: number, length: number, c: Rgba, segments = 10) {
  const [u, v] = perpBasis(dir);
  const tip = add(base, scale(dir, length));
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const p0 = add(base, add(scale(u, Math.cos(a0) * radius), scale(v, Math.sin(a0) * radius)));
    const p1 = add(base, add(scale(u, Math.cos(a1) * radius), scale(v, Math.sin(a1) * radius)));
    pushTri(out, p0, p1, tip, c);
    pushTri(out, p1, p0, base, c);
  }
}

/** 방향 축(ax, ay, az)에 맞춘 정육면체 */
export function pushCube(out: number[], center: Vec3, axes: [Vec3, Vec3, Vec3], half: number, c: Rgba) {
  const [X, Y, Z] = axes.map((a) => scale(a, half)) as [Vec3, Vec3, Vec3];
  const corner = (sx: number, sy: number, sz: number) => add(center, add(scale(X, sx), add(scale(Y, sy), scale(Z, sz))));
  const faces: Array<[number, number, number][]> = [
    [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]],
    [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]],
    [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]],
    [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]],
    [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
    [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]],
  ];
  for (const f of faces) {
    const p = f.map(([x, y, z]) => corner(x, y, z));
    pushTri(out, p[0]!, p[1]!, p[2]!, c);
    pushTri(out, p[0]!, p[2]!, p[3]!, c);
  }
}
