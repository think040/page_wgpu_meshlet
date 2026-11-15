// CPU 전처리 공용 타입과 상수.

/** 작품 로컬 좌표 [-1,1]³ 바깥으로 여백을 둔 격자 영역의 반폭. LOD3(32셀)에서도 표면과 경계 사이 2셀 이상. */
export const GRID_HALF_EXTENT = 1.2;

/** LOD → 격자 셀 수 (계획서 2.1: N³ = 셀 N개, 샘플 N+1개) */
export const LOD_GRID = [256, 128, 64, 32] as const;
export const LOD_COUNT = LOD_GRID.length;

export const MAX_MESHLET_VERTS = 64;
export const MAX_MESHLET_PRIMS = 126;

/** 모든 축이 같은 정육면체 격자. 좌표 = origin + index × step */
export interface GridSpec {
  n: number;
  origin: number;
  step: number;
}

export function gridSpec(n: number): GridSpec {
  return { n, origin: -GRID_HALF_EXTENT, step: (2 * GRID_HALF_EXTENT) / n };
}

/** 인덱스 메시(정점 공유) */
export interface IndexedMesh {
  positions: Float32Array; // xyz
  normals: Float32Array; // xyz (정규화)
  indices: Uint32Array; // 삼각형 3개씩, 바깥에서 볼 때 CCW
}

/** 메시릿 변환 결과. meshlets는 메시릿당 u32 4개(vertOffset, vertCount, primOffset, primCount). */
export interface MeshletSet {
  meshlets: Uint32Array;
  vertexIndices: Uint32Array; // 메시릿이 참조하는 (메시 기준) 정점 인덱스
  primitives: Uint32Array; // 삼각형 1개 = 로컬 인덱스 3×8bit
}

/** 메시릿별 컬링 데이터: (cx, cy, cz, r, ax, ay, az, cutoff) */
export const BOUNDS_STRIDE = 8;

export interface LodTimings {
  sdf: number;
  mc: number;
  meshlet: number;
  bounds: number;
  total: number;
}

/** 워커 → 메인 스레드로 넘기는 결과(모두 transferable) */
export interface LodMeshData {
  artwork: number;
  lod: number;
  vertexCount: number;
  triangleCount: number;
  meshletCount: number;
  /** 정점 16B: pos f32×3 + 옥타헤드럴 노멀 snorm16×2 */
  vertices: ArrayBuffer;
  meshlets: Uint32Array;
  vertexIndices: Uint32Array;
  primitives: Uint32Array;
  bounds: Float32Array;
  timings: LodTimings;
  backend: string;
}

export function packPrim(a: number, b: number, c: number): number {
  return (a | (b << 8) | (c << 16)) >>> 0;
}

export function unpackPrim(p: number): [number, number, number] {
  return [p & 0xff, (p >>> 8) & 0xff, (p >>> 16) & 0xff];
}
