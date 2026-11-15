// GPU 버퍼 레이아웃의 TS 쪽 단일 정의. 원본은 shaders/common/structs.wgsl이며
// tests/layout.test.ts가 두 정의(필드 오프셋, 구조체 크기)가 같은지 검사한다.

export interface StructLayout {
  size: number;
  fields: Record<string, number>; // 바이트 오프셋
}

export const LAYOUT = {
  Frame: {
    size: 96,
    fields: {
      resolution: 0,
      time: 8,
      displayMode: 12,
      lodParams: 16,
      cullEye: 32,
      instanceCount: 48,
      lodForce: 52,
      visibleCap: 56,
      chunkCap: 60,
      wireframe: 64,
      lightCount: 68,
      selectedObject: 72,
      flags: 76,
      floorY: 80,
      reflectionStrength: 84,
      ambient: 88,
      exposure: 92,
    },
  },
  View: {
    size: 240,
    fields: { viewProj: 0, planes: 64, eye: 160, cullEye: 176, cullDir: 192, flags: 208, viewport: 224 },
  },
  Instance: {
    size: 160,
    fields: { model: 0, normalMat: 64, color: 112, material: 128, artwork: 144, objectId: 148, lodForce: 152, flags: 156 },
  },
  Vertex: { size: 16, fields: { pos: 0, nrm: 12 } },
  Meshlet: { size: 16, fields: { vertOffset: 0, vertCount: 4, primOffset: 8, primCount: 12 } },
  MeshletBounds: { size: 32, fields: { sphere: 0, cone: 16 } },
  ArtworkLod: { size: 16, fields: { meshletOffset: 0, meshletCount: 4, triCount: 8, available: 12 } },
  Chunk: { size: 16, fields: { instance: 0, firstMeshlet: 4, count: 8, lod: 12 } },
  DrawArgs: { size: 16, fields: { vertexCount: 0, instanceCount: 4, firstVertex: 8, firstInstance: 12 } },
  DispatchArgs: { size: 12, fields: { x: 0, y: 4, z: 8 } },
  Counters: {
    size: 80,
    fields: { lodInstances: 0, selectedMeshlets: 16, selectedTriangles: 20, overflow: 24, pad0: 28, viewTriangles: 32 },
  },
  Light: {
    size: 144,
    fields: { viewProj: 0, position: 64, direction: 80, color: 96, spot: 112, shadow: 128 },
  },
} as const satisfies Record<string, StructLayout>;

/** 동적 오프셋 정렬(minUniformBufferOffsetAlignment 기본 256) */
export const VIEW_STRIDE = 256;
export const VERTS_PER_MESHLET = 378;

export const INSTANCE_FLAG = { active: 1, selected: 2, castShadow: 4, emissive: 8 } as const;

/** 뷰 슬롯 번호 */
export const VIEW = {
  main: 0,
  reflection: 1,
  directional: 2,
  spot: 3,
  pointFirst: 4, // 4..9
  debugRender: 10, // 컬링 없음, 디버그 카메라로 그리기만
} as const;
export const CULL_VIEW_COUNT = 10;
export const VIEW_SLOT_COUNT = 11;

export const CULL_FLAG = { frustum: 1, cone: 2 } as const;

/** 정적 메시 재질 코드(Instance.artwork 자리에 들어간다) */
export const STATIC_MATERIAL = { floor: 100, wall: 101, pedestal: 102, shelf: 103, marker: 104 } as const;

/** 피킹 ID */
export const PICK_ID = {
  artworkBase: 1, // 1..54 = 인스턴스 + 1
  floor: 200,
  room: 201,
  shelf: 202,
  lightBase: 210, // 210..212
  mainCamera: 220,
} as const;

export const LOD_SLOTS = 6 * 4; // 작품 × LOD

export interface InstanceData {
  model: Float32Array; // 16
  normalMat: Float32Array; // 12 (mat3x3f 레이아웃)
  color: readonly [number, number, number];
  roughness: number;
  metallic: number;
  maxScale: number;
  coneOk: boolean;
  artwork: number;
  objectId: number;
  lodForce: number;
  flags: number;
}

/** Instance 하나를 f32/u32/i32 뷰에 기록. byteOffset은 Instance 시작. */
export function writeInstance(f32: Float32Array, u32: Uint32Array, i32: Int32Array, byteOffset: number, d: InstanceData) {
  const o = byteOffset / 4;
  const F = LAYOUT.Instance.fields;
  f32.set(d.model, o + F.model / 4);
  f32.set(d.normalMat, o + F.normalMat / 4);
  const c = o + F.color / 4;
  f32[c] = d.color[0];
  f32[c + 1] = d.color[1];
  f32[c + 2] = d.color[2];
  f32[c + 3] = 1;
  const m = o + F.material / 4;
  f32[m] = d.roughness;
  f32[m + 1] = d.metallic;
  f32[m + 2] = d.maxScale;
  f32[m + 3] = d.coneOk ? 1 : 0;
  u32[o + F.artwork / 4] = d.artwork;
  u32[o + F.objectId / 4] = d.objectId;
  i32[o + F.lodForce / 4] = d.lodForce;
  u32[o + F.flags / 4] = d.flags;
}
