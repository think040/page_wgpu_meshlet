// ─────────────────────────────────────────────────────────────
// 모든 GPU 버퍼 구조체의 원본 정의. TS 쪽 오프셋은 gpu/layout.ts에 있고,
// tests/layout.test.ts가 이 파일을 파싱해 WGSL 정렬 규칙으로 계산한 오프셋과 대조한다.
// 규칙: 단독 vec3 필드는 쓰지 않는다(vec3 + 스칼라 또는 vec4로 패딩을 명시).
// ─────────────────────────────────────────────────────────────

struct Frame {
  resolution         : vec2f,
  time               : f32,
  displayMode        : u32,   // 0 셰이딩, 1 메시릿 색, 2 LOD 색
  lodParams          : vec4f, // LOD 전환 거리 3개(반경 배수), bias(log2)
  cullEye            : vec4f, // LOD 선택 기준 = 메인 카메라(동결 시 고정 사본)
  instanceCount      : u32,
  lodForce           : i32,   // −1 자동
  visibleCap         : u32,
  chunkCap           : u32,
  wireframe          : u32,
  lightCount         : u32,
  selectedObject     : u32,
  flags              : u32,   // bit0 개발자 모드, bit1 바닥 반사 사용
  floorY             : f32,
  reflectionStrength : f32,
  ambient            : f32,
  exposure           : f32,
}

struct View {
  viewProj : mat4x4f,         // 그리기용
  planes   : array<vec4f, 6>, // 컬링용 프러스텀(안쪽 양수)
  eye      : vec4f,           // 셰이딩용 카메라 위치
  cullEye  : vec4f,           // 컬링용 위치, w = 1 원근 / 0 직교
  cullDir  : vec4f,           // 직교 뷰의 시선 방향
  flags    : vec4u,           // x 컬링(1 프러스텀, 2 노멀 콘), y 뷰 번호, z 반사 뷰, w 그림자 뷰
  viewport : vec4f,           // 타깃 w, h, 1/w, 1/h
}

struct Instance {
  model     : mat4x4f,
  normalMat : mat3x3f,
  color     : vec4f,
  material  : vec4f,          // roughness, metallic, maxScale, coneOk(균등 스케일이면 1)
  artwork   : u32,            // 메시릿 작품 번호, 정적 메시는 재질 코드
  objectId  : u32,            // 피킹 ID (0 = 없음)
  lodForce  : i32,
  flags     : u32,            // bit0 활성, bit1 선택됨, bit2 그림자 드리움, bit3 발광(표식)
}

struct Vertex {
  pos : vec3f,
  nrm : u32,                  // 옥타헤드럴 snorm16×2
}

struct Meshlet {
  vertOffset : u32,
  vertCount  : u32,
  primOffset : u32,
  primCount  : u32,
}

struct MeshletBounds {
  sphere : vec4f,             // 로컬 중심, 반경
  cone   : vec4f,             // 로컬 축, cutoff
}

struct ArtworkLod {
  meshletOffset : u32,
  meshletCount  : u32,
  triCount      : u32,
  available     : u32,
}

struct Chunk {
  instance     : u32,
  firstMeshlet : u32,
  count        : u32,
  lod          : u32,
}

struct DrawArgs {
  vertexCount   : u32,
  instanceCount : atomic<u32>,
  firstVertex   : u32,
  firstInstance : u32,
}

struct DispatchArgs {
  x : atomic<u32>,
  y : u32,
  z : u32,
}

struct Counters {
  lodInstances      : array<atomic<u32>, 4>,
  selectedMeshlets  : atomic<u32>,
  selectedTriangles : atomic<u32>,
  overflow          : atomic<u32>,
  pad0              : u32,
  viewTriangles     : array<atomic<u32>, 12>,
}

struct Light {
  viewProj  : mat4x4f,        // Directional/Spot 섀도 맵 행렬
  position  : vec4f,          // xyz, w = 종류(0 dir, 1 spot, 2 point)
  direction : vec4f,          // 빛이 나아가는 방향 xyz, w = range
  color     : vec4f,          // rgb × 세기, w = 활성(0/1)
  spot      : vec4f,          // cos 바깥, cos 안쪽, 그림자 near, 그림자 far
  shadow    : vec4f,          // 사용(0/1), 깊이 바이어스, 노멀 바이어스, 텍셀 크기(1/해상도)
}

const VERTS_PER_MESHLET : u32 = 378u; // 126 × 3
const INVALID : u32 = 0xffffffffu;
