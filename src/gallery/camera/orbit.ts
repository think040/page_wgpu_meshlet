// 카메라 조작기(감상·개발자 모드 공통): 키보드(WASD/QE)로 이동, 오른쪽 드래그로 제자리 회전.
// 상태는 (target, yaw, pitch, distance)이고 결과 Transform을 장면 저장소에 기록한다.
// target은 카메라 앞 distance 지점이며 작품 앞으로 날아가기(flyTo) 보간에 쓰인다.
// Inspector에서 카메라 Transform을 바꾸면 그 값으로부터 궤도 상태를 다시 만든다.

import {
  add,
  cross,
  normalize,
  quatLookRotation,
  quatRotate,
  scale,
  sub,
  type Quat,
  type Vec3,
} from '../math/math';
import type { CameraObject, SceneStore } from '../store/sceneStore';

export interface OrbitState {
  target: Vec3;
  yaw: number;
  pitch: number;
  distance: number;
}

const PITCH_MIN = -1.45;
const PITCH_MAX = 1.45;
const LOOK_SPEED = 0.004; // rad / px

export class OrbitController {
  state: OrbitState;
  private written: { position: Vec3; rotation: Quat } | null = null;
  private anim: { from: OrbitState; to: OrbitState; t: number; duration: number } | null = null;
  bounds: { min: Vec3; max: Vec3 } | null = null;

  constructor(
    private readonly store: SceneStore,
    readonly cameraId: string,
    distance: number,
  ) {
    this.state = { target: [0, 0, 0], yaw: 0, pitch: 0, distance };
    this.syncFromStore(true);
  }

  private camera(): CameraObject {
    return this.store.state.objects[this.cameraId] as CameraObject;
  }

  /** 저장소의 Transform이 외부(Inspector·기즈모)에서 바뀌었으면 궤도 상태를 다시 계산 */
  syncFromStore(force = false) {
    const t = this.camera().transform;
    if (!force && this.written && t.position === this.written.position && t.rotation === this.written.rotation) return;
    const fwd = normalize(quatRotate(t.rotation, [0, 0, -1]));
    const d = this.state.distance;
    this.state = {
      target: add(t.position, scale(fwd, d)),
      yaw: Math.atan2(-fwd[0], -fwd[2]),
      pitch: Math.asin(Math.max(-1, Math.min(1, -fwd[1]))),
      distance: d,
    };
    this.written = { position: t.position, rotation: t.rotation };
    this.anim = null;
  }

  private offsetDir(s: OrbitState): Vec3 {
    return [Math.cos(s.pitch) * Math.sin(s.yaw), Math.sin(s.pitch), Math.cos(s.pitch) * Math.cos(s.yaw)];
  }

  private eye(s: OrbitState = this.state): Vec3 {
    return add(s.target, scale(this.offsetDir(s), s.distance));
  }

  private apply() {
    const s = this.state;
    const o = this.offsetDir(s);
    let position = add(s.target, scale(o, s.distance));
    if (this.bounds) {
      const b = this.bounds;
      position = [
        Math.min(b.max[0], Math.max(b.min[0], position[0])),
        Math.min(b.max[1], Math.max(b.min[1], position[1])),
        Math.min(b.max[2], Math.max(b.min[2], position[2])),
      ];
      // 벽에 막히면 대상점도 같이 멈춰서 시선 방향이 틀어지지 않게 한다
      s.target = sub(position, scale(o, s.distance));
    }
    const rotation = quatLookRotation(sub(s.target, position));
    this.written = { position, rotation };
    this.store.setTransform(this.cameraId, { position, rotation });
  }

  /** 오른쪽 드래그: 카메라 위치는 그대로 두고 시선만 돌린다(1인칭 둘러보기) */
  look(dx: number, dy: number) {
    this.anim = null;
    const eye = this.eye();
    this.state.yaw -= dx * LOOK_SPEED;
    this.state.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, this.state.pitch + dy * LOOK_SPEED));
    this.state.target = sub(eye, scale(this.offsetDir(this.state), this.state.distance));
    this.apply();
  }

  /** 휠: 시선 방향(수평면)으로 앞뒤 이동. amount는 m, 양수가 앞 */
  dolly(amount: number) {
    if (!amount) return;
    this.anim = null;
    const o = this.offsetDir(this.state);
    const f = normalize([-o[0], 0, -o[2]]);
    this.state.target = add(this.state.target, scale(f, amount));
    this.apply();
  }

  /** 키보드: W/S 앞뒤, A/D 좌우(수평면), E/Q 위아래. speed는 m/s */
  move(forward: number, right: number, up: number, dt: number, speed: number) {
    if (!forward && !right && !up) return;
    this.anim = null;
    const o = this.offsetDir(this.state);
    const f = normalize([-o[0], 0, -o[2]]);
    const r = normalize(cross(f, [0, 1, 0]));
    const len = Math.hypot(forward, right, up) || 1;
    const k = (speed * dt) / len; // 대각선 이동이 더 빨라지지 않게
    this.state.target = add(this.state.target, add(add(scale(f, forward * k), scale(r, right * k)), [0, up * k, 0]));
    this.apply();
  }

  /** 부드럽게 이동(작품 앞으로 날아가기) */
  flyTo(to: OrbitState, duration = 1.1) {
    const from = { ...this.state, target: [...this.state.target] as Vec3 };
    // yaw는 가까운 쪽으로 돈다
    let dy = to.yaw - from.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.anim = { from, to: { ...to, yaw: from.yaw + dy }, t: 0, duration };
  }

  get animating() {
    return this.anim !== null;
  }

  update(dt: number) {
    this.syncFromStore();
    if (!this.anim) return;
    const a = this.anim;
    a.t = Math.min(1, a.t + dt / a.duration);
    const e = a.t < 0.5 ? 4 * a.t * a.t * a.t : 1 - Math.pow(-2 * a.t + 2, 3) / 2;
    const L = (x: number, y: number) => x + (y - x) * e;
    this.state = {
      target: [L(a.from.target[0], a.to.target[0]), L(a.from.target[1], a.to.target[1]), L(a.from.target[2], a.to.target[2])],
      yaw: L(a.from.yaw, a.to.yaw),
      pitch: L(a.from.pitch, a.to.pitch),
      distance: L(a.from.distance, a.to.distance),
    };
    this.apply();
    if (a.t >= 1) this.anim = null;
  }
}
