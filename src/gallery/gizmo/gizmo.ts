// 변환 기즈모(이동·회전·크기). 핸들 선택 판정과 변환량 계산은 CPU에서 마우스 광선으로 처리한다(ID 패스 미사용).
// 화면상 크기는 카메라 거리와 무관하게 일정하고, 깊이 테스트 없이 항상 위에 그린다.

import {
  add,
  cross,
  dot,
  length,
  normalize,
  quatAxisAngle,
  quatMul,
  quatNormalize,
  quatRotate,
  rayLineClosest,
  rayPlane,
  raySegmentDistance,
  scale,
  sub,
  type Quat,
  type Ray,
  type Vec3,
} from '../math/math';
import { toParentLocal, toParentLocalRotation, worldPosition, worldRotation } from '../scene/sceneGraph';
import type { GizmoMode, SceneObject, SceneStore } from '../store/sceneStore';
import { circlePoints, pushCone, pushCube, pushLine, type Rgba } from './overlayBuilder';
import type { OverlayGeometry } from '../gpu/renderer';

export interface Handle {
  kind: 'axis' | 'ring' | 'center';
  axis: number; // 0 x, 1 y, 2 z, −1 center
}

const AXIS_COLORS: Rgba[] = [
  [0.95, 0.25, 0.25, 1],
  [0.35, 0.88, 0.3, 1],
  [0.3, 0.5, 1, 1],
];
const HOVER: Rgba = [1, 0.85, 0.1, 1];
const CENTER: Rgba = [0.92, 0.92, 0.92, 1];

interface Drag {
  handle: Handle;
  objectId: string;
  mode: GizmoMode;
  startPos: Vec3; // 월드
  startRot: Quat; // 월드
  startScale: Vec3; // 로컬
  axisDir: Vec3; // 월드 방향
  s0: number; // 축 매개변수(이동·크기)
  v0: Vec3 | null; // 회전 시작 벡터
  startPx: [number, number];
}

export class Gizmo {
  hover: Handle | null = null;
  private drag: Drag | null = null;

  constructor(private readonly store: SceneStore) {}

  get dragging() {
    return this.drag !== null;
  }

  /** 기즈모를 표시할 대상(개발자 모드 + 선택된 변환 가능한 오브젝트) */
  target(): { obj: SceneObject; pos: Vec3; rot: Quat; mode: GizmoMode } | null {
    const s = this.store.state;
    if (s.mode !== 'dev' || !s.selection) return null;
    const obj = s.objects[s.selection];
    if (!obj) return null;
    let mode = s.settings.gizmoMode;
    // 라이트에는 크기 기즈모를 표시하지 않는다
    if (obj.kind === 'light' && mode === 'scale') return null;
    // 지금 보고 있는 카메라 자체는 조작하지 않는다
    if (obj.kind === 'camera') {
      const viewing = s.settings.activeCamera === 'debug' ? 'debug' : 'main';
      if (obj.role === viewing) return null;
      if (mode === 'scale') return null;
    }
    if (obj.kind === 'floor' && mode !== 'translate') mode = 'translate';
    return { obj, pos: worldPosition(s, obj), rot: worldRotation(s, obj), mode };
  }

  private axes(rot: Quat, mode: GizmoMode): [Vec3, Vec3, Vec3] {
    const space = mode === 'scale' ? 'local' : this.store.state.settings.gizmoSpace;
    if (space === 'world') return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    return [quatRotate(rot, [1, 0, 0]), quatRotate(rot, [0, 1, 0]), quatRotate(rot, [0, 0, 1])];
  }

  static size(eye: Vec3, pos: Vec3, fovDeg: number) {
    return length(sub(pos, eye)) * Math.tan((fovDeg * Math.PI) / 360) * 0.25;
  }

  hitTest(ray: Ray, eye: Vec3, fovDeg: number): Handle | null {
    const t = this.target();
    if (!t) return null;
    const S = Gizmo.size(eye, t.pos, fovDeg);
    const axes = this.axes(t.rot, t.mode);
    let best: Handle | null = null;
    let bestD = Infinity;
    const consider = (d: number, h: Handle, threshold: number) => {
      if (d < threshold && d < bestD) {
        bestD = d;
        best = h;
      }
    };
    if (t.mode === 'scale') {
      // 중앙 핸들: 광선과 중심점 사이 거리(축 핸들보다 우선하도록 가중)
      const dc = raySegmentDistance(ray, t.pos, t.pos);
      consider(dc * 0.7, { kind: 'center', axis: -1 }, S * 0.12);
    }
    for (let i = 0; i < 3; i++) {
      const a = axes[i]!;
      if (t.mode === 'rotate') {
        const pts = circlePoints(t.pos, a, S, 48);
        let m = Infinity;
        for (let k = 0; k < 48; k++) m = Math.min(m, raySegmentDistance(ray, pts[k]!, pts[k + 1]!));
        consider(m, { kind: 'ring', axis: i }, S * 0.07);
      } else {
        consider(raySegmentDistance(ray, add(t.pos, scale(a, S * 0.15)), add(t.pos, scale(a, S * 1.1))), { kind: 'axis', axis: i }, S * 0.08);
      }
    }
    return best;
  }

  updateHover(ray: Ray | null, eye: Vec3, fovDeg: number) {
    if (this.drag) return;
    this.hover = ray ? this.hitTest(ray, eye, fovDeg) : null;
  }

  begin(ray: Ray, eye: Vec3, fovDeg: number, px: [number, number]): boolean {
    const h = this.hitTest(ray, eye, fovDeg);
    const t = this.target();
    if (!h || !t) return false;
    const axes = this.axes(t.rot, t.mode);
    const axisDir = h.axis >= 0 ? axes[h.axis]! : ([0, 0, 0] as Vec3);
    let s0 = 0;
    let v0: Vec3 | null = null;
    if (h.kind === 'axis') s0 = rayLineClosest(ray, t.pos, axisDir).s;
    if (h.kind === 'ring') {
      const hit = rayPlane(ray, t.pos, axisDir);
      v0 = hit ? normalize(sub(hit, t.pos)) : null;
      if (!v0) return false;
    }
    this.drag = {
      handle: h,
      objectId: t.obj.id,
      mode: t.mode,
      startPos: t.pos,
      startRot: t.rot,
      startScale: [...t.obj.transform.scale] as Vec3,
      axisDir,
      s0,
      v0,
      startPx: px,
    };
    this.hover = h;
    return true;
  }

  move(ray: Ray, px: [number, number]) {
    const g = this.drag;
    if (!g) return;
    const s = this.store.state;
    const obj = s.objects[g.objectId];
    if (!obj) return;
    if (g.mode === 'translate' && g.handle.kind === 'axis') {
      const r = rayLineClosest(ray, g.startPos, g.axisDir);
      const world = add(g.startPos, scale(g.axisDir, r.s - g.s0));
      this.store.setTransform(obj.id, { position: toParentLocal(s, obj, world) });
    } else if (g.mode === 'rotate' && g.handle.kind === 'ring' && g.v0) {
      const hit = rayPlane(ray, g.startPos, g.axisDir) ?? rayPlane({ origin: ray.origin, dir: ray.dir }, g.startPos, scale(g.axisDir, -1));
      if (!hit) return;
      const v = normalize(sub(hit, g.startPos));
      if (length(v) < 0.5) return;
      // 회전각 = 마우스 광선과 링 평면 교점의 각도 변화
      const angle = Math.atan2(dot(cross(g.v0, v), g.axisDir), dot(g.v0, v));
      const worldRot = quatNormalize(quatMul(quatAxisAngle(g.axisDir, angle), g.startRot));
      this.store.setTransform(obj.id, { rotation: toParentLocalRotation(s, obj, worldRot) });
    } else if (g.mode === 'scale') {
      const next: Vec3 = [...g.startScale] as Vec3;
      if (g.handle.kind === 'center') {
        const f = Math.exp(((px[0] - g.startPx[0]) - (px[1] - g.startPx[1])) * 0.006);
        for (let i = 0; i < 3; i++) next[i] = Math.max(0.001, g.startScale[i]! * f);
      } else {
        const r = rayLineClosest(ray, g.startPos, g.axisDir);
        const f = g.s0 !== 0 ? r.s / g.s0 : 1;
        next[g.handle.axis] = Math.max(0.001, g.startScale[g.handle.axis]! * f);
      }
      this.store.setTransform(obj.id, { scale: next });
    }
  }

  end() {
    this.drag = null;
  }

  build(out: OverlayGeometry, eye: Vec3, fovDeg: number) {
    const t = this.target();
    if (!t) return;
    const S = Gizmo.size(eye, t.pos, fovDeg);
    const axes = this.axes(t.rot, t.mode);
    const active = this.drag?.handle ?? this.hover;
    const colorOf = (i: number, kind: Handle['kind']): Rgba => (active && active.axis === i && active.kind === kind ? HOVER : AXIS_COLORS[i]!);
    for (let i = 0; i < 3; i++) {
      const a = axes[i]!;
      if (t.mode === 'rotate') {
        const c = colorOf(i, 'ring');
        const pts = circlePoints(t.pos, a, S, 64);
        for (let k = 0; k < 64; k++) pushLine(out.linesOnTop, pts[k]!, pts[k + 1]!, c);
        // 두께감을 위해 조금 작은 링을 한 번 더
        const pts2 = circlePoints(t.pos, a, S * 0.985, 64);
        for (let k = 0; k < 64; k++) pushLine(out.linesOnTop, pts2[k]!, pts2[k + 1]!, c);
      } else {
        const c = colorOf(i, 'axis');
        const tip = add(t.pos, scale(a, S));
        pushLine(out.linesOnTop, t.pos, tip, c);
        if (t.mode === 'translate') pushCone(out.trisOnTop, tip, a, S * 0.06, S * 0.22, c);
        else pushCube(out.trisOnTop, tip, axes, S * 0.06, c);
      }
    }
    if (t.mode === 'scale') {
      const c = active?.kind === 'center' ? HOVER : CENTER;
      pushCube(out.trisOnTop, t.pos, axes, S * 0.08, c);
    }
  }
}
