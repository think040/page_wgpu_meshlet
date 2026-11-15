// 장면 저장소 — React state가 아닌 별도 저장소(브리프 6장).
// 렌더러는 매 프레임 store.state를 직접 읽고, UI는 useScene(selector)로 필요한 값만 구독한다.
// 갱신은 불변(immutable) 방식이라 렌더러는 참조 비교로 바뀐 오브젝트만 GPU에 반영한다.

import { useSyncExternalStore } from 'react';
import type { Quat, Vec3 } from '../math/math';

export interface Transform {
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
}

export type ObjectKind = 'camera' | 'light' | 'artwork' | 'group' | 'floor' | 'room';
export type LightType = 'directional' | 'spot' | 'point';

interface ObjectBase {
  id: string;
  name: string;
  active: boolean;
  transform: Transform;
  parent?: string;
}

export interface CameraObject extends ObjectBase {
  kind: 'camera';
  role: 'main' | 'debug';
  camera: { fov: number; near: number; far: number };
}

export interface LightObject extends ObjectBase {
  kind: 'light';
  light: {
    type: LightType;
    color: Vec3;
    intensity: number;
    range: number;
    spotAngle: number; // 바깥 원뿔 전체 각도(도)
    spotBlend: number; // 0..1 경계 부드러움
    castShadow: boolean;
    shadowBias: number;
    shadowNormalBias: number;
    shadowMapSize: number;
  };
}

export interface ArtworkObject extends ObjectBase {
  kind: 'artwork';
  artwork: {
    artworkId: number; // 0..5 형태
    instanceIndex: number; // GPU 인스턴스 번호
    featured: boolean; // 좌대 위 원작(=true) / 선반 수강생 작품
    color: Vec3;
    roughness: number;
    metallic: number;
    lodForce: number; // −1 자동
  };
}

export interface GroupObject extends ObjectBase {
  kind: 'group';
}

export interface FloorObject extends ObjectBase {
  kind: 'floor';
  floor: { reflection: boolean; reflectionStrength: number };
}

export interface RoomObject extends ObjectBase {
  kind: 'room';
}

export type SceneObject = CameraObject | LightObject | ArtworkObject | GroupObject | FloorObject | RoomObject;

export type DisplayMode = 'shaded' | 'meshlet' | 'lod';
export type GizmoMode = 'translate' | 'rotate' | 'scale';

export interface RenderSettings {
  displayMode: DisplayMode;
  wireframe: boolean;
  frustumCulling: boolean;
  coneCulling: boolean;
  freezeCulling: boolean;
  showBoundingSpheres: boolean;
  lodDistances: [number, number, number]; // 반경 배수 단위
  lodBias: number;
  forceLod: number; // −1 자동
  passes: {
    main: boolean;
    reflection: boolean;
    shadowDirectional: boolean;
    shadowSpot: boolean;
    shadowPoint: boolean;
  };
  msaa: boolean;
  renderScale: number;
  reflectionScale: number;
  activeCamera: 'main' | 'debug';
  gizmoMode: GizmoMode;
  gizmoSpace: 'world' | 'local';
}

export interface LoadingState {
  done: number;
  total: number;
  progress: number; // 0..1
  finished: boolean;
  message: string;
  elapsedMs: number;
  backend: string;
}

export interface SceneState {
  objects: Record<string, SceneObject>;
  /** Hierarchy 표시 순서(트리 루트와 자식 모두) */
  order: string[];
  selection: string | null;
  mode: 'view' | 'dev';
  settings: RenderSettings;
  loading: LoadingState;
  /** 감상 모드에서 마지막으로 다가간 작품 오브젝트 id */
  focus: string | null;
  /** UI → 렌더러 카메라 이동 요청(작품 id 또는 'overview') */
  focusRequest: { target: string; nonce: number } | null;
}

type Listener = () => void;

export class Store<T> {
  private listeners = new Set<Listener>();
  constructor(public state: T) {}
  getState = () => this.state;
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  set(updater: (s: T) => T) {
    const next = updater(this.state);
    if (next === this.state) return;
    this.state = next;
    for (const l of this.listeners) l();
  }
}

export class SceneStore extends Store<SceneState> {
  updateObject<K extends SceneObject>(id: string, fn: (o: K) => K) {
    this.set((s) => {
      const o = s.objects[id] as K | undefined;
      if (!o) return s;
      const next = fn(o);
      if (next === o) return s;
      return { ...s, objects: { ...s.objects, [id]: next } };
    });
  }

  setTransform(id: string, t: Partial<Transform>) {
    this.updateObject(id, (o) => ({ ...o, transform: { ...o.transform, ...t } }));
  }

  updateSettings(patch: Partial<RenderSettings>) {
    this.set((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  }

  select(id: string | null) {
    this.set((s) => (s.selection === id ? s : { ...s, selection: id }));
  }
}

export function useStore<T, R>(store: Store<T>, selector: (s: T) => R): R {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.state),
    () => selector(store.state),
  );
}

// ── 통계(자주 바뀌므로 별도 저장소) ──
export interface Stats {
  fps: number;
  frameMs: number;
  totalMeshlets: number; // 업로드된 전체(모든 LOD)
  selectedMeshlets: number; // 선택된 LOD 기준 후보
  selectedTriangles: number;
  visibleMeshlets: number[]; // 뷰별
  viewTriangles: number[]; // 뷰별 그려진 삼각형
  lodInstances: number[];
  gpuReadbackFrames: number;
  /** 작품×LOD별 메시릿·삼각형 수(로드된 것만) */
  lodInfo: Array<Array<{ meshlets: number; triangles: number; vertices: number; ms: number } | null>>;
  overflow: number;
  adapter: string;
}

export const VIEW_NAMES = ['메인', '반사', 'Directional', 'Spot', 'Point +X', 'Point −X', 'Point +Y', 'Point −Y', 'Point +Z', 'Point −Z'];

export const statsStore = new Store<Stats>({
  fps: 0,
  frameMs: 0,
  totalMeshlets: 0,
  selectedMeshlets: 0,
  selectedTriangles: 0,
  visibleMeshlets: new Array(10).fill(0),
  viewTriangles: new Array(10).fill(0),
  lodInstances: [0, 0, 0, 0],
  gpuReadbackFrames: 0,
  lodInfo: Array.from({ length: 6 }, () => [null, null, null, null]),
  overflow: 0,
  adapter: '',
});
