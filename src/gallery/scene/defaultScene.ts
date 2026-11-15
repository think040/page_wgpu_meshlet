// 기본 장면: 전시실, 좌대 6개 위 「결」 연작 6점, 뒷벽 선반의 수강생 작품 48점, 라이트 3종, 카메라 2대.

import { ARTWORKS } from '@/content/site';
import { ARTWORK_SDFS } from '../mesh/sdf/artworks';
import { normalize, quatFromEuler, quatLookRotation, sub, type Vec3 } from '../math/math';
import type {
  ArtworkObject,
  CameraObject,
  LightObject,
  RenderSettings,
  SceneObject,
  SceneState,
  Transform,
} from '../store/sceneStore';

export const ROOM = { halfX: 8, halfZ: 6, height: 4.5 } as const;
export const PEDESTAL = { half: 0.4, height: 1.0 } as const;
export const FEATURED_SCALE = 0.62;
export const SHELF_ITEM_SCALE = 0.17;
export const SHELF = {
  z: -5.55,
  boardYs: [0.85, 1.6, 2.35] as const,
  halfWidth: 6.6,
  depth: 0.42,
  thickness: 0.05,
  perBoard: 16,
} as const;

// 앞뒤 두 줄을 지그재그로 엇갈려 정면에서 서로 가리지 않게 둔다
export const PEDESTAL_POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [-6, -1.6],
  [-3.6, 1.4],
  [-1.2, -1.6],
  [1.2, 1.4],
  [3.6, -1.6],
  [6, 1.4],
];

/** 작품별 기본 재질 */
export const ARTWORK_MATERIALS: ReadonlyArray<{ color: Vec3; roughness: number; metallic: number }> = [
  { color: [0.93, 0.92, 0.89], roughness: 0.85, metallic: 0 }, // 흰 석고
  { color: [0.78, 0.5, 0.24], roughness: 0.32, metallic: 1 }, // 청동
  { color: [0.52, 0.52, 0.5], roughness: 0.65, metallic: 0 }, // 회색 화강암
  { color: [0.94, 0.93, 0.9], roughness: 0.22, metallic: 0 }, // 대리석
  { color: [0.17, 0.17, 0.18], roughness: 0.8, metallic: 0 }, // 현무암
  { color: [0.95, 0.95, 0.93], roughness: 0.55, metallic: 0 }, // 무광 백자
];

const t = (position: Vec3, rotation = quatFromEuler([0, 0, 0]), scale: Vec3 = [1, 1, 1]): Transform => ({
  position,
  rotation,
  scale,
});

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function hsl(h: number, s: number, l: number): Vec3 {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

export const DEFAULT_SETTINGS: RenderSettings = {
  displayMode: 'shaded',
  wireframe: false,
  frustumCulling: true,
  coneCulling: true,
  freezeCulling: false,
  showBoundingSpheres: false,
  lodDistances: [5, 11, 24],
  lodBias: 0,
  forceLod: -1,
  passes: {
    main: true,
    reflection: true,
    shadowDirectional: true,
    shadowSpot: true,
    shadowPoint: true,
  },
  msaa: true,
  renderScale: 1,
  reflectionScale: 0.5,
  activeCamera: 'main',
  gizmoMode: 'translate',
  gizmoSpace: 'world',
};

export const MAIN_CAMERA_ID = 'camera-main';
export const DEBUG_CAMERA_ID = 'camera-debug';
export const SHELF_GROUP_ID = 'shelf';
export const FLOOR_ID = 'floor';
export const ROOM_ID = 'room';
export const LIGHT_IDS = { directional: 'light-dir', spot: 'light-spot', point: 'light-point' } as const;

export const artworkObjectId = (instanceIndex: number) =>
  instanceIndex < 6 ? `art-${instanceIndex}` : `shelf-${instanceIndex - 6}`;

export function createDefaultScene(): SceneState {
  const objects: Record<string, SceneObject> = {};
  const order: string[] = [];
  const addObj = (o: SceneObject) => {
    objects[o.id] = o;
    order.push(o.id);
  };

  // ── 카메라 ──
  const mainPos: Vec3 = [0, 2.4, 5.6];
  addObj({
    id: MAIN_CAMERA_ID,
    name: '메인 카메라',
    kind: 'camera',
    role: 'main',
    active: true,
    transform: t(mainPos, quatLookRotation(sub([0, 1.2, -0.5], mainPos))),
    camera: { fov: 55, near: 0.05, far: 40 },
  } satisfies CameraObject);
  const dbgPos: Vec3 = [11, 10, 14];
  addObj({
    id: DEBUG_CAMERA_ID,
    name: '디버그 카메라',
    kind: 'camera',
    role: 'debug',
    active: true,
    transform: t(dbgPos, quatLookRotation(sub([0, 1, 0], dbgPos))),
    camera: { fov: 55, near: 0.1, far: 120 },
  } satisfies CameraObject);

  // ── 라이트 ──
  const dirPos: Vec3 = [3, 4.2, 4.5];
  addObj({
    id: LIGHT_IDS.directional,
    name: 'Directional 라이트',
    kind: 'light',
    active: true,
    transform: t(dirPos, quatLookRotation(normalize([-0.45, -1, -0.55]))),
    light: {
      type: 'directional',
      color: [1, 0.95, 0.86],
      intensity: 2.0,
      range: 0,
      spotAngle: 0,
      spotBlend: 0,
      castShadow: true,
      shadowBias: 0.0015,
      shadowNormalBias: 0.02,
      shadowMapSize: 2048,
    },
  } satisfies LightObject);
  const spotPos: Vec3 = [-7, 4.1, 4.6];
  addObj({
    id: LIGHT_IDS.spot,
    name: 'Spot 라이트',
    kind: 'light',
    active: true,
    transform: t(spotPos, quatLookRotation(sub([-3.6, 1.2, 1.4], spotPos))),
    light: {
      type: 'spot',
      color: [1, 0.86, 0.66],
      intensity: 45,
      range: 18,
      spotAngle: 40,
      spotBlend: 0.35,
      castShadow: true,
      shadowBias: 0.0006,
      shadowNormalBias: 0.015,
      shadowMapSize: 1024,
    },
  } satisfies LightObject);
  addObj({
    id: LIGHT_IDS.point,
    name: 'Point 라이트',
    kind: 'light',
    active: true,
    transform: t([2.2, 3.0, 0.2]),
    light: {
      type: 'point',
      color: [0.72, 0.84, 1],
      intensity: 9,
      range: 12,
      spotAngle: 0,
      spotBlend: 0,
      castShadow: true,
      shadowBias: 0.004,
      shadowNormalBias: 0.02,
      shadowMapSize: 1024,
    },
  } satisfies LightObject);

  // ── 작품 6점 ──
  ARTWORKS.forEach((a, i) => {
    const [x, z] = PEDESTAL_POSITIONS[i]!;
    const sdf = ARTWORK_SDFS[a.id]!;
    const mat = ARTWORK_MATERIALS[a.id]!;
    addObj({
      id: artworkObjectId(i),
      name: `「${a.title}」`,
      kind: 'artwork',
      active: true,
      transform: t([x, PEDESTAL.height - sdf.minY * FEATURED_SCALE + 0.002, z], quatFromEuler([0, i * 37 - 20, 0]), [
        FEATURED_SCALE,
        FEATURED_SCALE,
        FEATURED_SCALE,
      ]),
      artwork: {
        artworkId: a.id,
        instanceIndex: i,
        featured: true,
        color: mat.color,
        roughness: mat.roughness,
        metallic: mat.metallic,
        lodForce: -1,
      },
    } satisfies ArtworkObject);
  });

  // ── 선반 그룹 + 수강생 작품 48점 ──
  addObj({
    id: SHELF_GROUP_ID,
    name: '선반 (수강생 작품)',
    kind: 'group',
    active: true,
    transform: t([0, 0, SHELF.z]),
  });
  const rand = rng(20261115);
  let inst = 6;
  for (let b = 0; b < SHELF.boardYs.length; b++) {
    for (let k = 0; k < SHELF.perBoard; k++) {
      const artworkId = (k + b * 3) % 6;
      const sdf = ARTWORK_SDFS[artworkId]!;
      const s = SHELF_ITEM_SCALE * (0.85 + rand() * 0.3);
      const x = -SHELF.halfWidth + 0.45 + (k * (2 * SHELF.halfWidth - 0.9)) / (SHELF.perBoard - 1);
      const color = hsl(rand(), 0.25 + rand() * 0.3, 0.55 + rand() * 0.25);
      const idx = inst++;
      addObj({
        id: artworkObjectId(idx),
        name: `수강생 작품 ${idx - 5}`,
        kind: 'artwork',
        active: true,
        parent: SHELF_GROUP_ID,
        transform: t(
          [x, SHELF.boardYs[b]! + SHELF.thickness / 2 - sdf.minY * s + 0.002, 0.02],
          quatFromEuler([0, rand() * 360, 0]),
          [s, s, s],
        ),
        artwork: {
          artworkId,
          instanceIndex: idx,
          featured: false,
          color,
          roughness: 0.6 + rand() * 0.3,
          metallic: 0,
          lodForce: -1,
        },
      } satisfies ArtworkObject);
    }
  }

  // ── 환경 ──
  addObj({
    id: FLOOR_ID,
    name: '바닥',
    kind: 'floor',
    active: true,
    transform: t([0, 0, 0]),
    floor: { reflection: true, reflectionStrength: 0.45 },
  });
  addObj({ id: ROOM_ID, name: '방 (벽·천장·좌대)', kind: 'room', active: true, transform: t([0, 0, 0]) });

  return {
    objects,
    order,
    selection: null,
    mode: 'view',
    settings: DEFAULT_SETTINGS,
    loading: { done: 0, total: 0, progress: 0, finished: false, message: '준비 중', elapsedMs: 0, backend: '' },
    focus: null,
    focusRequest: null,
  };
}

/** 인스턴스 번호 순서의 작품 오브젝트 id 목록 */
export function artworkIdsByInstance(state: SceneState): string[] {
  const list: string[] = [];
  for (const id of state.order) {
    const o = state.objects[id];
    if (o?.kind === 'artwork') list[o.artwork.instanceIndex] = id;
  }
  return list;
}
