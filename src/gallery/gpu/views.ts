// 뷰 10개(+디버그 그리기 1개)의 행렬·프러스텀과 라이트 버퍼 내용을 CPU에서 계산한다.

import {
  DEG,
  extractPlanes,
  mat4Invert,
  mat4LookAt,
  mat4Mul,
  mat4Ortho,
  mat4Perspective,
  mat4ReflectY,
  mat4ViewFromBasis,
  mat4ViewFromTransform,
  normalize,
  quatRotate,
  transformPoint,
  type Mat4,
  type Vec3,
} from '../math/math';
import type { CameraObject, LightObject } from '../store/sceneStore';
import { CULL_FLAG, LAYOUT, VIEW, VIEW_SLOT_COUNT, VIEW_STRIDE } from './layout';

export interface CameraMatrices {
  eye: Vec3;
  view: Mat4;
  proj: Mat4;
  viewProj: Mat4;
}

export function cameraMatrices(cam: CameraObject, aspect: number): CameraMatrices {
  const { position, rotation } = cam.transform;
  const view = mat4ViewFromTransform(position, rotation);
  const proj = mat4Perspective(cam.camera.fov * DEG, aspect, cam.camera.near, cam.camera.far);
  return { eye: [...position] as Vec3, view, proj, viewProj: mat4Mul(proj, view) };
}

/** 큐브 면 기저(WebGPU/D3D 규약): +X, −X, +Y, −Y, +Z, −Z — [right, up, forward] */
export const CUBE_FACES: ReadonlyArray<readonly [Vec3, Vec3, Vec3]> = [
  [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  [[1, 0, 0], [0, 0, 1], [0, -1, 0]],
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
];

export const DIR_SHADOW = { center: [0, 1.8, 0] as Vec3, halfExtent: 11.5, distance: 22, far: 48 };
export const POINT_SHADOW_NEAR = 0.05;
export const SPOT_SHADOW_NEAR = 0.1;

export interface LightMatrices {
  /** 섀도 맵 렌더용 viewProj (point는 면 6개) */
  viewProj: Mat4[];
  eye: Vec3;
  dir: Vec3;
  perspective: boolean;
}

export function lightMatrices(l: LightObject): LightMatrices {
  const pos = l.transform.position;
  const dir = normalize(quatRotate(l.transform.rotation, [0, 0, -1]));
  const L = l.light;
  if (L.type === 'directional') {
    const c = DIR_SHADOW.center;
    const eye: Vec3 = [c[0] - dir[0] * DIR_SHADOW.distance, c[1] - dir[1] * DIR_SHADOW.distance, c[2] - dir[2] * DIR_SHADOW.distance];
    const up: Vec3 = Math.abs(dir[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
    const view = mat4LookAt(eye, c, up);
    const h = DIR_SHADOW.halfExtent;
    const proj = mat4Ortho(-h, h, -h, h, 0.1, DIR_SHADOW.far);
    return { viewProj: [mat4Mul(proj, view)], eye, dir, perspective: false };
  }
  if (L.type === 'spot') {
    const target: Vec3 = [pos[0] + dir[0], pos[1] + dir[1], pos[2] + dir[2]];
    const up: Vec3 = Math.abs(dir[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
    const view = mat4LookAt(pos, target, up);
    const fov = Math.min(170, L.spotAngle + 6) * DEG;
    const proj = mat4Perspective(fov, 1, SPOT_SHADOW_NEAR, Math.max(L.range, 0.5));
    return { viewProj: [mat4Mul(proj, view)], eye: pos, dir, perspective: true };
  }
  const proj = mat4Perspective(90 * DEG, 1, POINT_SHADOW_NEAR, Math.max(L.range, 0.5));
  return {
    viewProj: CUBE_FACES.map(([r, u, f]) => mat4Mul(proj, mat4ViewFromBasis(pos, r, u, f))),
    eye: pos,
    dir,
    perspective: true,
  };
}

export interface ViewSlotData {
  renderViewProj: Mat4;
  cullViewProj: Mat4;
  eye: Vec3;
  cullEye: Vec3;
  perspective: boolean;
  cullDir: Vec3;
  cullFlags: number;
  index: number;
  reflection: boolean;
  shadow: boolean;
  viewport: [number, number];
}

/** 뷰 슬롯 버퍼(VIEW_SLOT_COUNT × 256B) 기록기 */
export class ViewBufferWriter {
  readonly data = new ArrayBuffer(VIEW_SLOT_COUNT * VIEW_STRIDE);
  private readonly f32 = new Float32Array(this.data);
  private readonly u32 = new Uint32Array(this.data);

  write(slot: number, v: ViewSlotData) {
    const F = LAYOUT.View.fields;
    const o = (slot * VIEW_STRIDE) / 4;
    this.f32.set(v.renderViewProj, o + F.viewProj / 4);
    extractPlanes(v.cullViewProj, this.f32, o + F.planes / 4);
    const e = o + F.eye / 4;
    this.f32[e] = v.eye[0];
    this.f32[e + 1] = v.eye[1];
    this.f32[e + 2] = v.eye[2];
    this.f32[e + 3] = 1;
    const c = o + F.cullEye / 4;
    this.f32[c] = v.cullEye[0];
    this.f32[c + 1] = v.cullEye[1];
    this.f32[c + 2] = v.cullEye[2];
    this.f32[c + 3] = v.perspective ? 1 : 0;
    const d = o + F.cullDir / 4;
    this.f32[d] = v.cullDir[0];
    this.f32[d + 1] = v.cullDir[1];
    this.f32[d + 2] = v.cullDir[2];
    this.f32[d + 3] = 0;
    const fl = o + F.flags / 4;
    this.u32[fl] = v.cullFlags;
    this.u32[fl + 1] = v.index;
    this.u32[fl + 2] = v.reflection ? 1 : 0;
    this.u32[fl + 3] = v.shadow ? 1 : 0;
    const vp = o + F.viewport / 4;
    this.f32[vp] = v.viewport[0];
    this.f32[vp + 1] = v.viewport[1];
    this.f32[vp + 2] = 1 / Math.max(1, v.viewport[0]);
    this.f32[vp + 3] = 1 / Math.max(1, v.viewport[1]);
  }
}

export interface MainCull {
  viewProj: Mat4;
  eye: Vec3;
}

/** 메인 카메라 뷰 + 반사 뷰 슬롯 데이터 */
export function mainAndReflection(
  render: CameraMatrices,
  cull: MainCull,
  floorY: number,
  frustum: boolean,
  cone: boolean,
  viewport: [number, number],
  reflectionViewport: [number, number],
): { main: ViewSlotData; reflection: ViewSlotData } {
  const flags = (frustum ? CULL_FLAG.frustum : 0) | (cone ? CULL_FLAG.cone : 0);
  const R = mat4ReflectY(floorY);
  const main: ViewSlotData = {
    renderViewProj: render.viewProj,
    cullViewProj: cull.viewProj,
    eye: render.eye,
    cullEye: cull.eye,
    perspective: true,
    cullDir: [0, 0, -1],
    cullFlags: flags,
    index: VIEW.main,
    reflection: false,
    shadow: false,
    viewport,
  };
  const reflEye = transformPoint(R, render.eye);
  const reflCullEye = transformPoint(R, cull.eye);
  const reflection: ViewSlotData = {
    renderViewProj: mat4Mul(render.viewProj, R),
    cullViewProj: mat4Mul(cull.viewProj, R),
    eye: reflEye,
    cullEye: reflCullEye,
    perspective: true,
    cullDir: [0, -1, 0],
    cullFlags: flags,
    index: VIEW.reflection,
    reflection: true,
    shadow: false,
    viewport: reflectionViewport,
  };
  return { main, reflection };
}

/** 메인 카메라 프러스텀의 꼭짓점 8개(디버그 표시용) */
export function frustumCorners(viewProj: Mat4): Vec3[] {
  const inv = mat4Invert(viewProj);
  const out: Vec3[] = [];
  for (const z of [0, 1]) for (const y of [-1, 1]) for (const x of [-1, 1]) out.push(transformPoint(inv, [x, y, z]));
  return out;
}
