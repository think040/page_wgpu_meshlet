// 오브젝트의 월드 변환 계산(부모 1단계: 선반 그룹 → 수강생 작품).

import {
  mat4FromTRS,
  mat4Invert,
  mat4Mul,
  quatConj,
  quatMul,
  quatRotate,
  transformPoint,
  type Mat4,
  type Quat,
  type Vec3,
} from '../math/math';
import type { SceneObject, SceneState, Transform } from '../store/sceneStore';

export function localMatrix(t: Transform): Mat4 {
  return mat4FromTRS(t.position, t.rotation, t.scale);
}

export function parentMatrix(state: SceneState, o: SceneObject): Mat4 | null {
  if (!o.parent) return null;
  const p = state.objects[o.parent];
  return p ? localMatrix(p.transform) : null;
}

export function worldMatrix(state: SceneState, o: SceneObject): Mat4 {
  const local = localMatrix(o.transform);
  const pm = parentMatrix(state, o);
  return pm ? mat4Mul(pm, local) : local;
}

export function worldPosition(state: SceneState, o: SceneObject): Vec3 {
  const pm = parentMatrix(state, o);
  return pm ? transformPoint(pm, o.transform.position) : o.transform.position;
}

export function worldRotation(state: SceneState, o: SceneObject): Quat {
  if (!o.parent) return o.transform.rotation;
  const p = state.objects[o.parent];
  return p ? quatMul(p.transform.rotation, o.transform.rotation) : o.transform.rotation;
}

/** 오브젝트가 활성인지(부모까지 포함) */
export function isActive(state: SceneState, o: SceneObject): boolean {
  if (!o.active) return false;
  if (o.parent) {
    const p = state.objects[o.parent];
    if (p && !p.active) return false;
  }
  return true;
}

/** 월드 위치 → 부모 로컬 위치 */
export function toParentLocal(state: SceneState, o: SceneObject, world: Vec3): Vec3 {
  const pm = parentMatrix(state, o);
  return pm ? transformPoint(mat4Invert(pm), world) : world;
}

/** 월드 회전 → 부모 로컬 회전 */
export function toParentLocalRotation(state: SceneState, o: SceneObject, world: Quat): Quat {
  if (!o.parent) return world;
  const p = state.objects[o.parent];
  return p ? quatMul(quatConj(p.transform.rotation), world) : world;
}

export function forwardOf(q: Quat): Vec3 {
  return quatRotate(q, [0, 0, -1]);
}
