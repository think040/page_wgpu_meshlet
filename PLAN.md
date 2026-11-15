# 0단계 구현 계획 — 스튜디오 결 / 메시릿 감상실

> 상태: **승인됨 (2026-11-15, P-1~P-10 전부 채택)** · P-1 결과: TS 7.0.2로 `next build` 타입 체크 통과 → 7.0.2 유지 · 기준 문서: `PROJECT_BRIEF.md` · 작성일 2026-11-15
> 이 문서는 계획만 담는다. 코드는 1단계부터 작성한다.

---

## 0. 확인한 버전과 도구 (2026-11-15, npm registry 기준)

| 항목 | 버전 | 비고 |
|---|---|---|
| Next.js | **16.4.6** (latest) | App Router. Turbopack이 기본 번들러 |
| React / React DOM | 19.3.1 | Next 16 peer 범위 `^19` |
| TypeScript | 7.0.2(latest) / **5.9.3** | 아래 제안 P-1 참고 |
| @webgpu/types | 0.1.74 | |
| wabt (npm) | 1.0.39 | `wat2wasm` JS 포팅. 네이티브 설치 불필요 |
| Vitest | 5.1.0 | CPU 로직 단위 테스트 |
| Node | 24.21.0 (로컬) | |

**`.wgsl` 임포트 (Next.js 공식 문서 `turbopack` 설정 페이지 확인):**
Next 16.2+의 `turbopack.rules`는 로더 없이 모듈 타입을 지정하는 `type` 옵션을 지원하며, `raw`(= `text`)는 파일 내용을 문자열로 export한다.

```ts
// next.config.ts (계획)
turbopack: { rules: { '*.wgsl': { type: 'raw' } } },
webpack: (cfg) => { cfg.module.rules.push({ test: /\.wgsl$/, type: 'asset/source' }); return cfg; },
```

- Turbopack(기본)용 규칙과 `--webpack` 대비용 `asset/source` 규칙을 둘 다 둔다. 1단계에서 `next dev`와 `next build` 양쪽 결과를 확인한다.
- `src/types/wgsl.d.ts`: `declare module '*.wgsl' { const src: string; export default src; }`
- Vitest는 별도의 작은 플러그인(`.wgsl` → `export default "<내용>"`)으로 같은 임포트를 처리한다. 레이아웃 검증 테스트가 WGSL 파일을 읽어야 하기 때문이다.

---

## 1. 폴더 구조

```
/
├─ PROJECT_BRIEF.md · PLAN.md
├─ package.json            # scripts: build:wasm, predev, prebuild, test
├─ next.config.ts · tsconfig.json(strict) · vitest.config.ts
├─ wasm/                   # WAT 소스 (9단계)
│  ├─ sdf.wat              # SDF 격자 평가 + 결합 연산
│  └─ bounds.wat           # 메시릿 바운딩 스피어 · 노멀 콘
├─ scripts/build-wasm.mjs  # wabt(npm)로 wasm/*.wat → public/wasm/*.wasm (SIMD feature on)
├─ public/wasm/            # 빌드 산출물 (git 제외)
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx · globals.css
│  │  ├─ page.tsx          # /  히어로·소개·작품 6점·클래스·문의
│  │  ├─ gallery/page.tsx  # /gallery  (서버 컴포넌트 → 클라이언트 셸만 로드)
│  │  └─ class/page.tsx    # /class  클래스 상세 + 예약 문의 폼(UI만)
│  ├─ content/site.ts      # ★ 가상 작가·작품·클래스 문구 전부 (한 파일)
│  ├─ components/          # 사이트 공용 UI (Header, Footer, ArtworkCard …)
│  ├─ types/wgsl.d.ts
│  └─ gallery/             # 감상실 — 전부 'use client', SSR 금지
│     ├─ GalleryShell.tsx  # next/dynamic(ssr:false) 진입점, WebGPU 미지원 안내
│     ├─ GalleryCanvas.tsx # 캔버스 + 렌더러 생명주기(마운트/클린업)
│     ├─ store/            # 장면 저장소(React 밖), 구독 훅
│     ├─ ui/               # Hierarchy, Inspector, Toolbar, Stats, Loading, 감상 모드 패널
│     │  └─ controls/      # NumberField, Slider, ColorField, Checkbox, Select, Vec3Field, Foldout
│     ├─ math/             # vec3, mat4, quat, frustum, ray, euler (Float32Array 기반)
│     ├─ camera/           # OrbitController(감상), FlyController(디버그), 카메라 이동 애니메이션
│     ├─ gizmo/            # 핸들 메시 생성, 광선 판정, 드래그 수식 (11단계)
│     ├─ scene/            # 방·좌대·선반 지오메트리, 기본 장면 구성(작품 6 + 선반 48)
│     ├─ mesh/             # CPU 전처리 — TS 참조 구현
│     │  ├─ sdf/           # 프리미티브·연산·작품별 SDF 정의, 삼각함수 표 생성
│     │  ├─ marchingCubes.ts · mcTables.ts
│     │  ├─ meshletize.ts  # 64v / 126t 메시릿 변환
│     │  └─ bounds.ts      # 바운딩 스피어 · 노멀 콘 (TS 참조)
│     ├─ workers/          # meshWorker.ts, pool.ts, wasmBridge.ts(SIMD 감지·폴백)
│     └─ gpu/
│        ├─ device.ts      # 어댑터/디바이스, limits, lost 처리, 오류 로깅
│        ├─ diagnostics.ts # getCompilationInfo 출력, pushErrorScope 래퍼, uncapturederror
│        ├─ layout.ts      # ★ 모든 GPU 구조체 레이아웃의 단일 정의(오프셋·크기·쓰기 헬퍼)
│        ├─ shaderLib.ts   # .wgsl 임포트 + 문자열 결합
│        ├─ targets.ts     # 해상도 의존 렌더 타깃 관리
│        ├─ geometryPool.ts# 전역 storage buffer(성장형 아레나)
│        ├─ views.ts       # 뷰 10개의 행렬·프러스텀·플래그
│        ├─ passes/        # cull.ts, shadow.ts, reflection.ts, main.ts, pick.ts, overlay.ts, stats.ts
│        ├─ renderer.ts    # 프레임 그래프(패스 순서 조립)
│        └─ shaders/
│           ├─ common/     # structs.wgsl, math.wgsl, hash.wgsl, lighting.wgsl, shadow.wgsl
│           ├─ cull/       # lod_select.wgsl, instance_cull.wgsl, meshlet_cull.wgsl
│           ├─ draw/       # meshlet.wgsl, static.wgsl, depth_only.wgsl, id.wgsl
│           └─ overlay/    # lines.wgsl, gizmo.wgsl
└─ tests/                  # vitest: sdf, mc, meshletize, bounds, wat-vs-ts, layout
```

---

## 2. CPU 전처리 설계

### 2.1 격자 정의
- "N³"은 **셀 N개**(샘플 N+1개)로 정의한다. 작품은 단위 바운딩 박스 `[-1,1]³`에 맞춰 설계하고, 격자는 경계에 2셀 여백을 두어 표면이 항상 닫히게 한다(경계 샘플은 양수 보장).
- LOD0=256, LOD1=128, LOD2=64, LOD3=32. 같은 SDF를 그대로 다시 평가한다(단순화 없음).

### 2.2 스트리밍 슬랩 평가 (제안 P-2)
257³ 샘플 전체를 한 번에 담으면 float 67MB이고, 워커 여러 개가 동시에 들면 메모리가 크게 늘어난다. 그래서 **y축(높이) 방향 슬랩**으로 나눠 평가하고 MC가 바로 소비한다.
- 슬랩 = 높이 16셀 + 위아래 1샘플 여유(노멀 중앙차분용). 메모리 ≈ 257×257×19×4B ≈ 5MB.
- 높이 축으로 자르는 이유: 「비틀림」의 회전각 표가 y 인덱스로 바로 조회된다.

### 2.3 브릭 단위 원거리 생략 (제안 P-3)
「매듭」은 점마다 선분 수백 개와 거리를 재야 해서 256³에서 비용이 큰 편이다. 슬랩을 8³ 셀 브릭으로 나누고:
1. 브릭 중심에서 SDF 값을 구한다(TS, Math 사용 가능).
2. `|d| > 브릭 반대각선 + 2셀 여유`(립시츠 상수 보정 포함)이면 브릭 전체를 그 부호의 상수로 채우고 넘어간다. MC는 부호만 보므로 결과가 바뀌지 않는다.
3. 그 외 브릭만 정밀 평가한다(9단계부터는 WAT). 「매듭」은 브릭 근처 선분만 골라 넘긴다.
- 표면에 닿는 셀의 이웃은 생략 대상이 될 수 없으므로(여유 2셀) 노멀 중앙차분도 정확하다.
- 단위 테스트로 **생략 ON/OFF 결과 메시가 완전히 같음**을 확인한다.

### 2.4 SDF 정의 (작품별)
| # | 구성 | 삼각함수 처리 |
|---|---|---|
| 1 응결 | 구 8개 smooth union (k≈0.15) | 없음 |
| 2 매듭 | (2,3) 토러스 매듭 곡선을 TS에서 점 ~384개로 샘플링 → 폐곡선 캡슐 체인 최소거리 − 튜브 반경 | 규칙 2 (점열) |
| 3 비틀림 | 둥근 사각 기둥, 높이 y에 따라 xz 회전. 회전각 cos/sin을 **y 샘플 인덱스별 표**로 전달 | 규칙 1 (y 표) |
| 4 빈 자리 | 달걀형(y 방향 비대칭 타원체 근사) − smooth(구 2 + 캡슐 1) | 없음 |
| 5 침식 | 구 ∩ gyroid 껍질. `sin x cos y + sin y cos z + sin z cos x` → x/y/z 인덱스별 sin·cos 표 6개 | 규칙 1 (축별 표) |
| 6 겹 | 동심 구면 껍질 4겹 `min_i(|‖p‖−r_i|) − t`, 비스듬한 평면 반공간과 교차 | 없음 (sqrt는 SIMD 기본) |

- gyroid·smooth 연산은 정확한 거리가 아니라서 브릭 생략 판정에 작품별 안전 계수(립시츠 상한)를 둔다.
- 규칙 3(다항식 근사)은 현재 설계상 필요 없다. 필요해지면 그때 제안한다.

### 2.5 Marching Cubes
- 256개 케이스 전체 표(Bourke 표). 슬랩 안에서 y층 2개 분의 "모서리 → 정점 인덱스" 배열로 **격자 모서리 기준 중복 제거**를 한다(해시맵 불필요).
- 정점 위치는 모서리 선형 보간. **노멀 = SDF 격자 중앙차분 기울기를 모서리 양 끝에서 구해 보간 후 정규화**(제안 P-4: 격자 위 값만 쓰므로 축별 삼각함수 표가 그대로 유효하다).
- 테스트: 구 SDF로 닫힌 다양체(모든 모서리를 정확히 2개 삼각형이 공유), 정점 중복 없음, 노멀과 해석해 노멀의 각도 오차 상한.

### 2.6 메시릿 변환 (64 정점 / 126 삼각형)
1. 삼각형 인접 정보(모서리 공유) 구축.
2. 시드 = 아직 배정 안 된 삼각형 중 공간 순서(모턴 코드)상 첫 번째.
3. 프런티어(현재 메시릿과 모서리/정점을 공유하는 미배정 삼각형)에서 점수가 가장 좋은 것을 추가. 점수 = 새로 늘어나는 정점 수가 적을수록 + 메시릿 중심과 가까울수록. 정점 64 또는 삼각형 126을 넘기면 종료.
4. 출력: `meshlets[] {vertOffset, vertCount, primOffset, primCount}`, `uniqueVertexIndices: Uint32Array`, `primitiveIndices: Uint32Array`(삼각형 1개 = u32 1개에 로컬 인덱스 3개를 8비트씩 패킹).
- 테스트: 한도 준수, **모든 삼각형이 정확히 한 메시릿에 속함**, 복원한 삼각형 집합 = 원본(방향 포함).

### 2.7 컬링 데이터
- 바운딩 스피어: 메시릿 정점들에 대한 Ritter 근사 + 전체 포함 보정.
- 노멀 콘(meshoptimizer 방식, apex 없는 형태): 축 = 삼각형 노멀 평균 정규화, `mindp = min(dot(axis, n_i))`. `mindp ≤ 0`이면 퇴화로 보고 `cutoff = 1`(절대 컬링 안 됨). 아니면 `cutoff = sqrt(1 − mindp²)`.
- GPU 판정: `dot(c − eye, axis) ≥ cutoff · ‖c − eye‖ + r` 이면 뒷면이라서 컬링한다.

### 2.8 Web Worker 풀 (9단계에서 WAT로 교체, 2~8단계는 TS 참조 구현이 같은 워커에서 동작)
- 워커 수 = `clamp(hardwareConcurrency − 1, 1, 8)`. 각 워커가 WASM 인스턴스 1개(`fetch('/wasm/sdf.wasm')`)를 따로 둔다.
- 작업 = (작품, LOD) 24개. 큐 순서: **LOD3 6개 → LOD2 → LOD1 → LOD0**. 가벼운 것이 먼저 화면에 나온다.
- 결과(정점·메시릿·인덱스·컬링 데이터)는 `ArrayBuffer` transferable로 넘긴다. SharedArrayBuffer와 COOP/COEP는 쓰지 않는다.
- 진행률 = 작업별 슬랩 진행 메시지(가중치 = 셀 수)의 합.
- 워커 생성은 `new Worker(new URL('./meshWorker.ts', import.meta.url), { type: 'module' })` 형태로 한다(webpack·Turbopack 공통 지원 형태). 1단계에서 dev/build 양쪽을 확인한다.
- `memory.grow` 이후에는 매 호출 전에 `Float32Array` 뷰를 다시 만드는 `views()` 헬퍼를 둔다.

### 2.9 WAT 함수 목록 (9단계, 모두 배열 단위, TS 참조 구현과 1:1)
| 함수 | 입력 → 출력 |
|---|---|
| `grid_sphere / grid_ellipsoid / grid_capsule / grid_round_box_twist / grid_capsule_chain / grid_gyroid / grid_shells / grid_halfspace` | 브릭 기술자(원점, 간격, nx·ny·nz) + 파라미터(+ 표 포인터) → 거리 배열 |
| `op_min / op_max / op_smooth_union / op_smooth_sub / op_smooth_intersect / op_offset / op_abs` | 배열 a, b → 배열 out (개수 n) |
| `meshlet_bounds` | 메시릿 배열, 정점, uniqueIdx, prim → (center, radius, axis, cutoff) 배열 |
- x축 4개 샘플을 `f32x4`로 묶어 처리한다. sqrt/min/max/abs는 SIMD 기본 명령으로 한다. Relaxed SIMD는 쓰지 않는다.
- SIMD 미지원(`WebAssembly.validate`로 감지)이면 TS 참조 구현으로 폴백한다.
- 테스트: 무작위 파라미터로 WAT와 TS 결과의 최대 오차 ≤ 1e-5 (상대). 로딩 시간 비교(TS 단일 스레드 / TS 워커 / WAT 워커)를 수치로 낸다.

---

## 3. GPU 버퍼 레이아웃

### 3.1 레이아웃 단일 관리 (제안 P-5)
- 구조체 정의는 `shaders/common/structs.wgsl`에 둔다(WGSL이 원본). TS 쪽 `gpu/layout.ts`에 같은 구조체의 필드·오프셋·크기와 쓰기 헬퍼를 둔다.
- **단위 테스트가 `structs.wgsl`을 파싱해 WGSL 정렬 규칙(vec3 align 16, mat3x3 = vec3 3열 = 48B 등)으로 오프셋을 계산하고 `layout.ts`와 비교**한다. 어긋나면 테스트가 실패한다.
- 원칙: 버퍼 구조체에는 `vec3` 단독 필드를 쓰지 않고 `vec4`나 `vec3 + 스칼라` 묶음으로 패딩을 명시한다.

### 3.2 전역 지오메트리 (storage, 모든 작품·LOD 공용)
| 버퍼 | 원소 | 크기 |
|---|---|---|
| `vertices` | `Vertex { pos: vec3f, nrm: u32 }` — 노멀은 옥타헤드럴 `pack2x16snorm` | 16B |
| `meshlets` | `Meshlet { vertOffset, vertCount, primOffset, primCount: u32 }` (오프셋은 업로드 시 전역 기준으로 보정) | 16B |
| `meshletBounds` | `Bounds { sphere: vec4f(c, r), cone: vec4f(axis, cutoff) }` | 32B |
| `uniqueVertexIndices` | `u32` (전역 정점 인덱스) | 4B |
| `primitiveIndices` | `u32` (로컬 인덱스 3×8bit) | 4B |
| `artworkLods` | `ArtworkLod { meshletOffset, meshletCount, triCount, flags(available) }` × (6작품 × 4LOD) | 16B |

- **규모 추정**: LOD0 작품당 삼각형 20만~100만(「침식」이 최대). 전체 LOD 합 약 4~6M 삼각형, 메시릿 약 4~5만 개, vertices 약 40~60MB. 기본 한도(`maxStorageBufferBindingSize` 128MiB, `maxBufferSize` 256MiB) 안에 들어간다. 시작 시 어댑터 한도를 로그로 남기고, 필요하면 어댑터가 허용하는 범위까지 `requiredLimits`를 요청한다.
- **성장형 아레나**: 작업 결과가 도착하는 순서대로(LOD3 먼저) 이어 붙인다. 용량이 모자라면 2배 버퍼를 만들어 `copyBufferToBuffer` 후 바인드 그룹을 다시 만든다. 아직 도착하지 않은 LOD는 `available` 플래그가 꺼져 있고, LOD 선택이 **가장 가까운 사용 가능한 LOD**로 대체한다.

### 3.3 인스턴스 (storage, 작품 6 + 선반 48 = 54)
```
Instance (160B)
  model        : mat4x4f   // 64
  normalMat    : mat3x3f   // 48  (역전치, CPU 계산)
  color        : vec4f     // 16  기본색 (선반은 개별 색)
  material     : vec4f     // 16  roughness, metallic, maxScale, anisotropy
  artwork      : u32       // 작품 번호 0..5
  objectId     : u32       // 피킹용 (0 = 없음)
  lodForce     : i32       // -1 = 자동
  flags        : u32       // active, selected, castShadow …
```
- 장면 저장소 버전이 바뀐 인스턴스만 `writeBuffer`로 부분 갱신한다.

### 3.4 프레임 · 뷰 유니폼
```
View (256B 정렬, 10개를 dynamic offset으로 한 버퍼에)
  viewProj     : mat4x4f
  frustum      : array<vec4f, 6>   // 정규화된 평면
  eye          : vec4f             // xyz, w = 1 원근 / 0 직교
  dir          : vec4f             // 직교 뷰 방향
  flags        : u32               // frustumCull, coneCull, isReflection, depthOnly
  viewIndex    : u32
Frame (uniform)
  renderViewProj (디버그 카메라 시 디버그 카메라 행렬), cullEye, lodParams(거리 3개, bias, forceLod),
  displayMode, wireframe, reflectionStrength, resolution, time …
```

### 3.5 뷰별 컬링 버퍼 (뷰 10개 각각 따로 — 읽기·쓰기 동시 바인딩 방지)
| 버퍼 | 내용 | 용도 |
|---|---|---|
| `chunks[v]` | `Chunk { instance, firstMeshlet, count(≤64), lod }` | 인스턴스 단계 출력 → 메시릿 단계 입력 |
| `dispatchArgs[v]` | `{ x: atomic<u32>, y=1, z=1 }` | `dispatchWorkgroupsIndirect` |
| `visible[v]` | `vec2<u32>(instance \| lod<<24, globalMeshlet)` | 정점 셰이더 입력 |
| `drawArgs[v]` | `{ vertexCount=378, instanceCount: atomic<u32>, 0, 0 }` | `drawIndirect` |
| `counters` (공용 1개) | 뷰별 삼각형 수, LOD별 인스턴스 수 | 통계 readback 전용 |

- 매 프레임 시작에 상수 템플릿 버퍼에서 `copyBufferToBuffer`로 인자를 초기화한다(y=z=1, vertexCount=378, 카운터 0).
- `dispatchArgs.x`는 64,000 근처에서 상한을 건다(`maxComputeWorkgroupsPerDimension` 65535). 용량은 뷰별 `chunks`/`visible` 최대치로 미리 잡고 넘치면 버린다(경고 카운터 기록).

---

## 4. 컬링 단계 설계 (Amplification Shader 대체)

```
프레임당:
 [C0] lod_select        dispatch ceil(54/64)          — 1회, 모든 뷰가 공유
 뷰 v마다 (켜진 뷰만):
 [C1] instance_cull(v)  dispatch ceil(54/64)          — 인스턴스 스피어 vs 뷰 프러스텀 → 청크 생성
 [C2] meshlet_cull(v)   dispatchWorkgroupsIndirect     — 워크그룹 1개 = 청크 1개(64 스레드 = 메시릿 64개)
```

**C0 — LOD 선택 (메인 카메라 기준 1회)**
- `d = ‖인스턴스 중심 − cullEye‖ / (인스턴스 반경 × LOD 크기 기준)`에 bias를 더한 값으로 0~3을 고른다. 전역/인스턴스 강제 LOD가 우선한다. 사용 불가 LOD는 가까운 가용 LOD로 대체한다.
- 결과를 `instanceLod[]`에 기록하고 LOD별 인스턴스 수를 atomic으로 센다.
- `cullEye`는 메인 카메라다. 디버그 카메라는 절대 쓰지 않고, freeze 중에는 고정된 메인 카메라 사본을 쓴다. 뷰마다 LOD가 달라지는 일이 구조적으로 생기지 않는다.

**C1 — 인스턴스 컬링 (뷰별)**
- 인스턴스 월드 바운딩 스피어로 프러스텀 판정(비활성 인스턴스, 그림자 비활성 라이트 뷰도 여기서 거른다).
- 통과하면 `instanceLod`의 메시릿 범위를 64개 단위 청크로 쪼개 `atomicAdd(dispatchArgs.x, nChunks)`로 자리를 잡고 기록한다.
- D3D12 샘플의 AS가 "AS 그룹 1개 = 메시릿 32개"를 처리하는 구조와 대응한다.

**C2 — 메시릿 컬링 (뷰별, AS 역할)**
- 스레드 = 메시릿 1개. 월드 스피어 = model × center, 반경 × maxScale.
- 프러스텀 판정(뷰 flags), 노멀 콘 판정(메인·반사 뷰만). 축은 normalMat로 변환한다. **비균등 스케일(anisotropy > 1.01) 인스턴스는 콘 판정을 건너뛴다**(보수적, 제안 P-6).
- 반사 뷰의 콘 판정은 반사된 카메라 위치(eye)를 월드 공간에서 그대로 쓰면 맞다. 기하는 뒤집히지 않고 카메라만 뒤집히기 때문이다. 래스터의 앞뒷면 반전은 파이프라인 `frontFace: 'cw'`로 처리한다.
- 통과 개수를 **워크그룹 공유 atomic으로 모은 뒤 전역 `atomicAdd` 1회**로 `drawArgs.instanceCount`에서 자리를 받아 `visible`에 기록한다(경합 감소). 메인 뷰는 삼각형 수도 누적한다.
- CPU readback 없이 바로 `drawIndirect(drawArgs[v])`로 이어진다.

**정점 셰이더 (Mesh Shader 대체)**
- `@builtin(instance_index)` → `visible[v][i]` → (인스턴스, LOD, 메시릿).
- `@builtin(vertex_index)` → `tri = vi / 3`, `corner = vi % 3`. `tri ≥ primCount`면 세 꼭짓점 모두 `vec4(0)`을 출력해 퇴화 삼각형으로 만든다(SV_CullPrimitive 대체).
- `primitiveIndices[primOffset+tri]`에서 로컬 인덱스를 꺼내고 → `uniqueVertexIndices[vertOffset+local]` → `vertices[...]` 순으로 읽는다.
- 출력: 월드 위치, 노멀, 메시릿 ID, LOD, 인스턴스, **barycentric = corner 원-핫**(인덱스 없는 draw라 꼭짓점마다 고유하므로 정확하다).
- 정점 단계 storage buffer 6개(visible, instances, meshlets, uniqueIdx, prims, vertices)로, 기본 한도 8 안에 든다.

---

## 5. 렌더 패스 구성 (프레임 그래프)

```
0  reset            copyBufferToBuffer (indirect 인자·카운터 초기화)
1  compute          C0 → (C1, C2) × 활성 뷰                         [컬링 최대 10회]
2  shadow: dir      depth32float, 직교, 메시릿(depth_only) + 정적 메시    (1)
3  shadow: spot     depth32float, 원근                                (1)
4  shadow: point    depth32float 큐브(6레이어) 면마다 렌더 패스 1개   (6)
5  reflection       rgba16float + depth, 반사율 0.5배 해상도, frontFace 'cw',
                    바닥 제외, y<0 프래그먼트 discard                   (1)
6  main             MSAA 4x(또는 1x) color+depth → 캔버스로 resolve
                    메시릿 → 정적 메시(방·좌대·선반) → 바닥(반사 샘플) →
                    [개발자] 프러스텀 선·카메라 마커·바운딩 스피어 → 기즈모(깊이 always)  (1)
7  pick (클릭 시만)  r32uint + depth24plus, 1x, 메인 visible 재사용, 1픽셀 copyTextureToBuffer
8  stats            카운터 → 링 스테이징 버퍼(3개) copy, 비어 있는 슬롯만 mapAsync
```

- **디버그 카메라 모드**: 컬링은 C0~C2 그대로(메인 기준) 하고, 패스 6만 `renderViewProj = 디버그 카메라`로 그린다. 반사 텍스처는 메인 카메라 기준이라 디버그 뷰에서는 바닥 반사를 끈다.
- **정적 메시(방·좌대·선반)**: 일반 인덱스 버퍼 파이프라인으로 그린다. 컬링하지 않는다(수천 삼각형 수준). 그림자 패스(depth_only 변형)와 반사 패스(바닥 제외)에 포함한다.
- **조명**: `lights` storage 배열(Directional/Spot/Point 공통 구조체 + shadow 인덱스·바이어스). 포워드 셰이딩, 단순 GGX 스페큘러 + 램버트, 재질 = 색·거칠기·금속성.
- **그림자 샘플링**: `sampler_comparison` + 3×3 PCF. 포인트 라이트는 `texture_depth_cube`에 방향 벡터와, 지배 축 거리에서 복원한 투영 깊이로 비교한다. 큐브 면 방향 규약은 7단계에서 공식 스펙으로 확인한 뒤 테스트 렌더로 검증한다.
- **반사 클리핑 (제안 P-7)**: `clip_distances`는 선택 기능(feature)이라 쓰지 않는다. 반사 패스 프래그먼트에서 `worldPos.y < 0`이면 discard한다.
- **바닥**: `uv = fragCoord.xy / mainResolution`으로 반사 텍스처를 샘플링하고 Schlick 프레넬 × 강도로 섞는다.
- **와이어프레임**: barycentric + `fwidth`로 화면 두께가 일정한 선. 표시 모드(셰이딩/메시릿색/LOD색)와 독립적으로 켠다.
- **MSAA 전환**: sampleCount를 키로 파이프라인 캐시를 둔다. 토글 시 메인 패스 파이프라인 전부(메시릿·정적·바닥·선·기즈모)와 타깃을 다시 만든다.
- **해상도**: ResizeObserver(`devicePixelContentBoxSize` 우선, 없으면 contentBoxSize × dpr) × 렌더 스케일 → `[1, maxTextureDimension2D]`로 자른다. 실제로 바뀐 경우만 메인 MSAA·깊이, 반사, 피킹 타깃을 다시 만든다. 섀도 맵은 Inspector 해상도 변경 시에만 다시 만든다.
- **오류 가시성**: 모든 셰이더 모듈 생성 후 `getCompilationInfo()`의 줄·열 단위 메시지를 결합 전 원본 파일 이름 기준으로 역매핑해 출력한다(shaderLib가 조각별 줄 범위를 기록). 패스 생성은 `pushErrorScope('validation')`으로 감싸고, `device.onuncapturederror`, `device.lost`도 콘솔과 화면 배너에 표시한다.

---

## 6. 장면 저장소와 UI

- `store/sceneStore.ts`: 일반 TS 객체 + 항목별 리비전 번호 + 리스너 맵. `useSceneValue(selector)`는 `useSyncExternalStore`로 해당 값만 구독한다.
- 렌더러는 매 프레임 저장소를 직접 읽고, 리비전이 바뀐 항목만 GPU에 반영한다. 캔버스 컴포넌트는 저장소를 구독하지 않는다(슬라이더를 움직여도 리렌더 0회, React DevTools로 확인).
- Transform = position vec3, rotation quat, scale vec3. Inspector는 오일러(도)로 표시하고 입력하면 쿼터니언으로 바꾼다. 짐벌 문제를 피하려고 편집 중인 오일러 값을 캐시한다.
- 작품 카드 → `/gallery?work=<id>` → 로딩 후 해당 작품 앞으로 카메라를 보간 이동한다(피킹과 별개라 10단계에서 동작한다).
- 피킹 ID: 1~54 = 인스턴스, 100+ = 라이트 아이콘/정적 오브젝트, 0 = 빈 곳.

---

## 7. 문서와 다르게 제안하는 부분

| # | 제안 | 이유 |
|---|---|---|
| P-1 | TypeScript는 1단계에서 7.0.2로 `next build` 타입 체크를 시도하고, 문제가 있으면 **5.9.3**으로 고정 | 7.x는 네이티브(Go) 컴파일러로 바뀐 메이저라 Next 빌드 타입 체크와의 호환을 실제로 확인해야 함 |
| P-2 | SDF는 y슬랩 스트리밍으로 평가하고 MC가 즉시 소비 | 257³ 전체 격자 67MB × 워커 수를 피함 |
| P-3 | 8³ 브릭 원거리 생략(립시츠 판정) | 「매듭」·「침식」 LOD0 시간 단축. 결과 메시가 같음을 테스트로 보장 |
| P-4 | 노멀 = 격자 중앙차분 기울기의 모서리 보간 | 임의 점 평가가 필요 없어 삼각함수 표 규칙 1·2만으로 충분(다항식 근사 불필요) |
| P-5 | WGSL 구조체 원본 + 테스트가 파싱해 TS 레이아웃과 대조 | ".wgsl 분리" 규칙과 "레이아웃 한곳 관리"를 동시에 만족 |
| P-6 | 비균등 스케일 인스턴스는 노멀 콘 컬링 생략 | 비균등 변환 후 콘 컷오프가 보수성을 잃음. 기즈모로 축별 크기를 바꿔도 구멍이 생기지 않게 함 |
| P-7 | 반사 패스 바닥 아래 클리핑은 fragment discard | `clip_distances`는 선택 기능이라 "핵심 기능만" 제약에 어긋남 |
| P-8 | 인스턴스/메시릿 2단계 + 64개 청크 + `dispatchWorkgroupsIndirect` | 브리프의 검토 요청에 대한 답. 메시릿 단계에서 빈 스레드가 거의 없고 AS 그룹 구조와 대응 |
| P-9 | GPU 시간은 측정하지 않고 FPS는 rAF 기반 | `timestamp-query`는 선택 기능 |
| P-10 | 브리프 문서 표기 수정: "섬도 맵" → "섀도 맵", 삼각함수 처리 참조 "5장" → "4장" | 저장 시 반영함 |

---

## 8. 단계별 확인 체크리스트 요약 (각 단계 종료 시 상세판 제공)

| 단계 | 브라우저에서 확인할 것 |
|---|---|
| 1 | `/`, `/gallery`, `/class` 이동 · `/gallery`에 단색 삼각형 · 창 크기/DPR 변경 시 선명도 유지 · Firefox 등 미지원 브라우저에서 안내 문구 · 콘솔 오류 없음 · `npm run build && npm start`에서도 동일 |
| 2 | `npm test` 통과(SDF·MC 닫힘·메시릿 한도·삼각형 1:1 소속·레이아웃) |
| 3 | 작품 1점이 메시릿별 색 · 궤도 카메라 · Inspector 골격 |
| 4 | 디버그 카메라에서 프러스텀 선 · 프러스텀 밖 메시릿 사라짐 · 노멀 콘 켜기/끄기 차이 · freeze · 통계 수치 |
| 5 | 54 인스턴스 · 거리별 LOD 색 · 그림자·반사 없이도 LOD 통계 일관 |
| 6 | 와이어프레임 · MSAA 토글 · 렌더 스케일 0.5~2.0 · 모든 옵션 조작 · 슬라이더 조작 중 캔버스 리렌더 없음 |
| 7 | 세 라이트 그림자 방향·접지 · PCF · 바이어스/해상도 반응 · 카메라 밖 물체 그림자 유지 |
| 8 | 바닥 반사 위치 정확 · 반사 앞뒷면 정상 · 강도 슬라이더 |
| 9 | WAT=TS 테스트 · 로딩 중 카메라 조작 매끄러움 · LOD3 먼저 표시 · 시간 비교표 |
| 10 | 홈 → 카드 → 감상실 해당 작품 앞 → 클래스 문의 폼 · 모바일 레이아웃 |
| 11 | 클릭 선택 ↔ Hierarchy · W/E/R · 월드/로컬 · 그림자·반사·LOD 즉시 추종 · 감상 모드 클릭 이동 |

---

### 승인 요청 사항
1. P-1 ~ P-10 제안의 채택 여부
2. 위 버퍼·패스·컬링 설계로 1단계 진행 여부
