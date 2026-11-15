// 최소 수학 라이브러리. 오른손 좌표계, +Y 위, 카메라는 −Z를 본다.
// 행렬은 열 우선(column-major) Float32Array(16) — WGSL mat4x4f와 같은 메모리 배치.
// 투영의 깊이 범위는 WebGPU 규약 [0, 1].

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w
export type Mat4 = Float32Array;

export const DEG = Math.PI / 180;

// ───────── Vec3 ─────────
export const v3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const mulv = (a: Vec3, b: Vec3): Vec3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3) => Math.sqrt(dot(a, a));
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 0];
};
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export const distance = (a: Vec3, b: Vec3) => length(sub(a, b));

// ───────── Quat ─────────
export const quatIdentity = (): Quat => [0, 0, 0, 1];

export function quatAxisAngle(axis: Vec3, angle: number): Quat {
  const n = normalize(axis);
  const s = Math.sin(angle / 2);
  return [n[0] * s, n[1] * s, n[2] * s, Math.cos(angle / 2)];
}

export function quatMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export const quatConj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

export function quatNormalize(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

export function quatRotate(q: Quat, v: Vec3): Vec3 {
  // v' = q v q*
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

/** 회전 행렬(열 r, u, b)에서 쿼터니언 */
export function quatFromBasis(r: Vec3, u: Vec3, b: Vec3): Quat {
  const m00 = r[0], m10 = r[1], m20 = r[2];
  const m01 = u[0], m11 = u[1], m21 = u[2];
  const m02 = b[0], m12 = b[1], m22 = b[2];
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return quatNormalize(q);
}

/** 로컬 −Z가 forward를 향하는 회전 */
export function quatLookRotation(forward: Vec3, up: Vec3 = [0, 1, 0]): Quat {
  const f = normalize(forward);
  let r = cross(f, up);
  if (length(r) < 1e-6) r = cross(f, [0, 0, 1]);
  r = normalize(r);
  const u = cross(r, f);
  return quatFromBasis(r, u, scale(f, -1));
}

/** 오일러(도) ↔ 쿼터니언. Unity와 같은 순서: Z → X → Y (q = qY · qX · qZ) */
export function quatFromEuler(deg: Vec3): Quat {
  const qx = quatAxisAngle([1, 0, 0], deg[0] * DEG);
  const qy = quatAxisAngle([0, 1, 0], deg[1] * DEG);
  const qz = quatAxisAngle([0, 0, 1], deg[2] * DEG);
  return quatNormalize(quatMul(quatMul(qy, qx), qz));
}

export function quatToEuler(q: Quat): Vec3 {
  // R = Ry · Rx · Rz 분해
  const [x, y, z, w] = q;
  const m12 = 2 * (y * z - w * x); // row1 col2
  const sx = Math.max(-1, Math.min(1, -m12));
  const ex = Math.asin(sx);
  let ey: number;
  let ez: number;
  if (Math.abs(sx) < 0.99999) {
    const m02 = 2 * (x * z + w * y);
    const m22 = 1 - 2 * (x * x + y * y);
    const m10 = 2 * (x * y + w * z);
    const m11 = 1 - 2 * (x * x + z * z);
    ey = Math.atan2(m02, m22);
    ez = Math.atan2(m10, m11);
  } else {
    const m01 = 2 * (x * y - w * z);
    const m00 = 1 - 2 * (y * y + z * z);
    ey = Math.atan2(-2 * (x * z - w * y), m00);
    ez = 0;
    void m01;
  }
  return [ex / DEG, ey / DEG, ez / DEG];
}

// ───────── Mat4 ─────────
export const mat4 = (): Mat4 => {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
};

export function mat4Mul(a: Mat4, b: Mat4, out: Mat4 = new Float32Array(16)): Mat4 {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4]!, b1 = b[c * 4 + 1]!, b2 = b[c * 4 + 2]!, b3 = b[c * 4 + 3]!;
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r]! * b0 + a[4 + r]! * b1 + a[8 + r]! * b2 + a[12 + r]! * b3;
    }
  }
  return out;
}

export function mat4FromTRS(t: Vec3, q: Quat, s: Vec3, out: Mat4 = new Float32Array(16)): Mat4 {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  out[0] = (1 - (yy + zz)) * s[0];
  out[1] = (xy + wz) * s[0];
  out[2] = (xz - wy) * s[0];
  out[3] = 0;
  out[4] = (xy - wz) * s[1];
  out[5] = (1 - (xx + zz)) * s[1];
  out[6] = (yz + wx) * s[1];
  out[7] = 0;
  out[8] = (xz + wy) * s[2];
  out[9] = (yz - wx) * s[2];
  out[10] = (1 - (xx + yy)) * s[2];
  out[11] = 0;
  out[12] = t[0];
  out[13] = t[1];
  out[14] = t[2];
  out[15] = 1;
  return out;
}

export function mat4Invert(m: Mat4, out: Mat4 = new Float32Array(16)): Mat4 {
  const a00 = m[0]!, a01 = m[1]!, a02 = m[2]!, a03 = m[3]!;
  const a10 = m[4]!, a11 = m[5]!, a12 = m[6]!, a13 = m[7]!;
  const a20 = m[8]!, a21 = m[9]!, a22 = m[10]!, a23 = m[11]!;
  const a30 = m[12]!, a31 = m[13]!, a32 = m[14]!, a33 = m[15]!;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) det = 1e-20;
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

/** 원근 투영(오른손, 깊이 [0,1]) */
export function mat4Perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = far / (near - far);
  m[11] = -1;
  m[14] = (near * far) / (near - far);
  return m;
}

/** 직교 투영(오른손, 깊이 [0,1]) */
export function mat4Ortho(l: number, r: number, b: number, t: number, near: number, far: number): Mat4 {
  const m = new Float32Array(16);
  m[0] = 2 / (r - l);
  m[5] = 2 / (t - b);
  m[10] = 1 / (near - far);
  m[12] = (l + r) / (l - r);
  m[13] = (b + t) / (b - t);
  m[14] = near / (near - far);
  m[15] = 1;
  return m;
}

/** 기저(r, u, f)와 위치로 뷰 행렬(월드 → 뷰, 뷰는 −Z를 본다) */
export function mat4ViewFromBasis(eye: Vec3, r: Vec3, u: Vec3, f: Vec3): Mat4 {
  const m = new Float32Array(16);
  m[0] = r[0]; m[4] = r[1]; m[8] = r[2];
  m[1] = u[0]; m[5] = u[1]; m[9] = u[2];
  m[2] = -f[0]; m[6] = -f[1]; m[10] = -f[2];
  m[12] = -dot(r, eye);
  m[13] = -dot(u, eye);
  m[14] = dot(f, eye);
  m[15] = 1;
  return m;
}

export function mat4LookAt(eye: Vec3, target: Vec3, up: Vec3 = [0, 1, 0]): Mat4 {
  const f = normalize(sub(target, eye));
  let r = cross(f, up);
  if (length(r) < 1e-6) r = cross(f, [0, 0, 1]);
  r = normalize(r);
  const u = cross(r, f);
  return mat4ViewFromBasis(eye, r, u, f);
}

/** 위치·회전(카메라 오브젝트)으로 뷰 행렬 */
export function mat4ViewFromTransform(pos: Vec3, rot: Quat): Mat4 {
  return mat4ViewFromBasis(pos, quatRotate(rot, [1, 0, 0]), quatRotate(rot, [0, 1, 0]), quatRotate(rot, [0, 0, -1]));
}

export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  const x = m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!;
  const y = m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!;
  const z = m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!;
  const w = m[3]! * p[0] + m[7]! * p[1] + m[11]! * p[2] + m[15]!;
  return w !== 0 && w !== 1 ? [x / w, y / w, z / w] : [x, y, z];
}

export function transformDir(m: Mat4, d: Vec3): Vec3 {
  return [
    m[0]! * d[0] + m[4]! * d[1] + m[8]! * d[2],
    m[1]! * d[0] + m[5]! * d[1] + m[9]! * d[2],
    m[2]! * d[0] + m[6]! * d[1] + m[10]! * d[2],
  ];
}

/** 노멀 행렬(상위 3×3의 역전치)을 WGSL mat3x3f 레이아웃(열마다 vec4 패딩, 12 float)으로 */
export function normalMatrix(m: Mat4, out: Float32Array, offset: number) {
  const a00 = m[0]!, a01 = m[1]!, a02 = m[2]!;
  const a10 = m[4]!, a11 = m[5]!, a12 = m[6]!;
  const a20 = m[8]!, a21 = m[9]!, a22 = m[10]!;
  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;
  let det = a00 * b01 + a01 * b11 + a02 * b21;
  det = det ? 1 / det : 0;
  // 역행렬 inv (열 우선) 후 전치
  const i00 = b01 * det;
  const i01 = (-a22 * a01 + a02 * a21) * det;
  const i02 = (a12 * a01 - a02 * a11) * det;
  const i10 = b11 * det;
  const i11 = (a22 * a00 - a02 * a20) * det;
  const i12 = (-a12 * a00 + a02 * a10) * det;
  const i20 = b21 * det;
  const i21 = (-a21 * a00 + a01 * a20) * det;
  const i22 = (a11 * a00 - a01 * a10) * det;
  // 전치: 열 c = inv의 행 c
  out[offset] = i00; out[offset + 1] = i10; out[offset + 2] = i20; out[offset + 3] = 0;
  out[offset + 4] = i01; out[offset + 5] = i11; out[offset + 6] = i21; out[offset + 7] = 0;
  out[offset + 8] = i02; out[offset + 9] = i12; out[offset + 10] = i22; out[offset + 11] = 0;
}

/** viewProj에서 정규화된 프러스텀 평면 6개(left, right, bottom, top, near, far) — 안쪽이 양수 */
export function extractPlanes(m: Mat4, out: Float32Array, offset = 0) {
  const row = (i: number) => [m[i]!, m[4 + i]!, m[8 + i]!, m[12 + i]!];
  const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
  const planes = [
    r3.map((v, i) => v + r0[i]!),
    r3.map((v, i) => v - r0[i]!),
    r3.map((v, i) => v + r1[i]!),
    r3.map((v, i) => v - r1[i]!),
    r2, // WebGPU 깊이 [0,1]: near = row2
    r3.map((v, i) => v - r2[i]!),
  ];
  planes.forEach((p, k) => {
    const l = Math.hypot(p[0]!, p[1]!, p[2]!) || 1;
    for (let i = 0; i < 4; i++) out[offset + k * 4 + i] = p[i]! / l;
  });
}

/** 평면 y = h 기준 반사 행렬 */
export function mat4ReflectY(h: number): Mat4 {
  const m = mat4();
  m[5] = -1;
  m[13] = 2 * h;
  return m;
}

export function maxScale(s: Vec3) {
  return Math.max(Math.abs(s[0]), Math.abs(s[1]), Math.abs(s[2]));
}

// ───────── 광선 ─────────
export interface Ray {
  origin: Vec3;
  dir: Vec3;
}

/** NDC(x,y ∈ [-1,1]) → 월드 광선 */
export function rayFromNdc(invViewProj: Mat4, x: number, y: number): Ray {
  const a = transformPoint(invViewProj, [x, y, 0]);
  const b = transformPoint(invViewProj, [x, y, 1]);
  return { origin: a, dir: normalize(sub(b, a)) };
}

/** 광선과 직선(점 p, 방향 d)의 최근접점: 직선 매개변수 s와 두 점 사이 거리 */
export function rayLineClosest(ray: Ray, p: Vec3, d: Vec3): { s: number; t: number; dist: number } {
  const w0 = sub(ray.origin, p);
  const a = dot(ray.dir, ray.dir);
  const b = dot(ray.dir, d);
  const c = dot(d, d);
  const dd = dot(ray.dir, w0);
  const e = dot(d, w0);
  const den = a * c - b * b;
  let t = 0;
  let s = 0;
  if (Math.abs(den) > 1e-9) {
    t = (b * e - c * dd) / den;
    s = (a * e - b * dd) / den;
  } else {
    s = e / c;
  }
  const pr = add(ray.origin, scale(ray.dir, t));
  const pl = add(p, scale(d, s));
  return { s, t, dist: distance(pr, pl) };
}

export function rayPlane(ray: Ray, p: Vec3, n: Vec3): Vec3 | null {
  const den = dot(ray.dir, n);
  if (Math.abs(den) < 1e-6) return null;
  const t = dot(sub(p, ray.origin), n) / den;
  if (t < 0) return null;
  return add(ray.origin, scale(ray.dir, t));
}

export function raySegmentDistance(ray: Ray, a: Vec3, b: Vec3): number {
  const d = sub(b, a);
  const r = rayLineClosest(ray, a, d);
  if (r.s >= 0 && r.s <= 1 && r.t >= 0) return r.dist;
  // 끝점까지
  const pd = (q: Vec3) => {
    const t = Math.max(0, dot(sub(q, ray.origin), ray.dir));
    return distance(add(ray.origin, scale(ray.dir, t)), q);
  };
  return Math.min(pd(a), pd(b));
}
