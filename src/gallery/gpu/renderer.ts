// 프레임 그래프: 초기화 → 컬링(Compute) → 그림자 → 반사 → 메인(MSAA) → [피킹] → 통계 복사.
// 계획서 4·5장의 구조를 그대로 따른다.

import {
  mat4,
  mat4FromTRS,
  maxScale,
  normalMatrix,
  type Mat4,
  type Vec3,
} from '../math/math';
import {
  artworkIdsByInstance,
  DEBUG_CAMERA_ID,
  FLOOR_ID,
  LIGHT_IDS,
  MAIN_CAMERA_ID,
  ROOM_ID,
  SHELF_GROUP_ID,
} from '../scene/defaultScene';
import { isActive, worldMatrix } from '../scene/sceneGraph';
import { buildStaticGeometry, type StaticGeometry, type StaticMeshName } from '../scene/staticGeometry';
import type { CameraObject, LightObject, SceneObject, SceneState } from '../store/sceneStore';
import type { GpuContext } from './device';
import { createShaderModuleChecked, withErrorScope, type ErrorSink } from './diagnostics';
import { GeometryPool } from './geometryPool';
import {
  CULL_FLAG,
  CULL_VIEW_COUNT,
  INSTANCE_FLAG,
  LAYOUT,
  PICK_ID,
  STATIC_MATERIAL,
  VERTS_PER_MESHLET,
  VIEW,
  VIEW_SLOT_COUNT,
  VIEW_STRIDE,
  writeInstance,
} from './layout';
import { SHADERS } from './shaders';
import {
  cameraMatrices,
  lightMatrices,
  mainAndReflection,
  POINT_SHADOW_NEAR,
  SPOT_SHADOW_NEAR,
  ViewBufferWriter,
  type CameraMatrices,
  type MainCull,
} from './views';

export const INSTANCE_COUNT = 54;
const VISIBLE_CAP = 1 << 17; // 뷰당 가시 메시릿 최대
const CHUNK_CAP = 1 << 14; // 뷰당 청크 최대(< 65535)
const MAIN_DEPTH: GPUTextureFormat = 'depth24plus';
const SHADOW_FORMAT: GPUTextureFormat = 'depth32float';
const REFLECTION_FORMAT: GPUTextureFormat = 'rgba16float';
const ID_FORMAT: GPUTextureFormat = 'r32uint';
const OVERLAY_STRIDE = 28; // pos f32×3 + color f32×4

/** 정적 오브젝트 표(Instance 레이아웃 재사용) */
const STATIC = {
  floor: 0,
  walls: 1,
  pedestals: 2,
  shelf: 3,
  lightMarker0: 4, // 4,5,6
  cameraMarker: 7,
} as const;
const STATIC_COUNT = 8;
const STATIC_MESH: StaticMeshName[] = ['floor', 'walls', 'pedestals', 'shelf', 'sphere', 'sphere', 'sphere', 'camera'];
const LIGHT_ORDER = [LIGHT_IDS.directional, LIGHT_IDS.spot, LIGHT_IDS.point] as const;

export interface OverlayGeometry {
  linesOnTop: number[]; // 정점마다 x,y,z,r,g,b,a
  linesDepth: number[];
  trisOnTop: number[];
}

export interface FrameInput {
  state: SceneState;
  width: number;
  height: number;
  time: number;
  overlay: OverlayGeometry;
  /** 메인 카메라 컬링 동결 사본(없으면 현재 카메라) */
  frozenCull: MainCull | null;
}

export interface FrameInfo {
  mainCamera: CameraMatrices;
  renderCamera: CameraMatrices;
  cull: MainCull;
}

interface MainSet {
  meshlet: GPURenderPipeline;
  static: GPURenderPipeline;
  floor: GPURenderPipeline;
  linesOnTop: GPURenderPipeline;
  linesDepth: GPURenderPipeline;
  trisOnTop: GPURenderPipeline;
}

interface ShadowMap {
  size: number;
  texture: GPUTexture;
  sampleView: GPUTextureView;
  layerViews: GPUTextureView[];
}

interface PickRequest {
  x: number;
  y: number;
  resolve: (id: number) => void;
}

export class Renderer {
  readonly geometry: GeometryPool;
  private readonly device: GPUDevice;
  private readonly format: GPUTextureFormat;
  private readonly staticGeom: StaticGeometry;

  // 버퍼
  private readonly viewBuffer: GPUBuffer;
  private readonly frameBuffer: GPUBuffer;
  private readonly instanceBuffer: GPUBuffer;
  private readonly instanceLodBuffer: GPUBuffer;
  private readonly countersBuffer: GPUBuffer;
  private readonly staticObjBuffer: GPUBuffer;
  private readonly lightBuffer: GPUBuffer;
  private readonly staticVB: GPUBuffer;
  private readonly staticIB: GPUBuffer;
  private readonly chunks: GPUBuffer[] = [];
  private readonly dispatchArgs: GPUBuffer[] = [];
  private readonly visible: GPUBuffer[] = [];
  private readonly drawArgs: GPUBuffer[] = [];
  private readonly templateBuffer: GPUBuffer;
  private overlayBuffer: GPUBuffer;
  private overlayCapacity = 64 * 1024;

  // CPU 사본
  private readonly views = new ViewBufferWriter();
  private readonly frameData = new ArrayBuffer(LAYOUT.Frame.size);
  private readonly instanceData = new ArrayBuffer(INSTANCE_COUNT * LAYOUT.Instance.size);
  private readonly staticData = new ArrayBuffer(STATIC_COUNT * LAYOUT.Instance.size);
  private readonly lightData = new ArrayBuffer(3 * LAYOUT.Light.size);
  private instanceIds: string[] = [];
  private lastObjects: Record<string, SceneObject> | null = null;
  private lastSelection: string | null | undefined = undefined;
  private lastMode = '';
  private lastActiveCam = '';

  // 레이아웃·파이프라인
  private bgl!: Record<
    'viewFrame' | 'lodSelect' | 'instanceCull' | 'meshletCull' | 'geom' | 'visible' | 'lighting' | 'staticObj' | 'floor' | 'empty',
    GPUBindGroupLayout
  >;
  private modules!: Record<keyof typeof SHADERS, GPUShaderModule>;
  private compute!: { lodSelect: GPUComputePipeline; instanceCull: GPUComputePipeline; meshletCull: GPUComputePipeline };
  private fixed!: {
    meshletDepth: GPURenderPipeline;
    meshletReflect: GPURenderPipeline;
    meshletId: GPURenderPipeline;
    staticDepth: GPURenderPipeline;
    staticReflect: GPURenderPipeline;
    staticId: GPURenderPipeline;
  };
  private mainPipelines = new Map<number, MainSet>();

  // 바인드 그룹
  private viewFrameBG: GPUBindGroup[] = [];
  private lodSelectBG!: GPUBindGroup;
  private instanceCullBG: GPUBindGroup[] = [];
  private meshletCullBG: GPUBindGroup[] = [];
  private geomBG!: GPUBindGroup;
  private visibleBG: GPUBindGroup[] = [];
  private staticObjBG!: GPUBindGroup;
  private emptyBG!: GPUBindGroup;
  private lightingBG: GPUBindGroup | null = null;
  private floorBG: GPUBindGroup | null = null;
  private geomVersion = -1;

  // 렌더 타깃
  private readonly comparisonSampler: GPUSampler;
  private readonly linearSampler: GPUSampler;
  private shadow: { dir: ShadowMap | null; spot: ShadowMap | null; point: ShadowMap | null } = { dir: null, spot: null, point: null };
  private main: { w: number; h: number; samples: number; color: GPUTexture | null; depth: GPUTexture | null } = {
    w: 0,
    h: 0,
    samples: 0,
    color: null,
    depth: null,
  };
  private reflection: { w: number; h: number; color: GPUTexture | null; depth: GPUTexture | null } = { w: 0, h: 0, color: null, depth: null };
  private pickTarget: { w: number; h: number; id: GPUTexture | null; depth: GPUTexture | null } = { w: 0, h: 0, id: null, depth: null };
  targetGeneration = 0;

  // 피킹·통계
  private pickRequest: PickRequest | null = null;
  private readonly pickBuffer: GPUBuffer;
  private pickBusy = false;
  private readonly statsRing: { buffer: GPUBuffer; busy: boolean }[] = [];
  private statsCounter = 0;
  onStats: ((s: { counters: Uint32Array; visible: Uint32Array }) => void) | null = null;

  private constructor(private readonly gpu: GpuContext, private readonly onError: ErrorSink) {
    const device = gpu.device;
    this.device = device;
    this.format = gpu.format;
    this.geometry = new GeometryPool(device);
    this.staticGeom = buildStaticGeometry();

    const buf = (label: string, size: number, usage: number) => device.createBuffer({ label, size, usage });
    const S = GPUBufferUsage;
    this.viewBuffer = buf('views', VIEW_SLOT_COUNT * VIEW_STRIDE, S.UNIFORM | S.COPY_DST);
    this.frameBuffer = buf('frame', LAYOUT.Frame.size, S.UNIFORM | S.COPY_DST);
    this.instanceBuffer = buf('instances', INSTANCE_COUNT * LAYOUT.Instance.size, S.STORAGE | S.COPY_DST);
    this.instanceLodBuffer = buf('instanceLod', INSTANCE_COUNT * 4, S.STORAGE);
    this.countersBuffer = buf('counters', LAYOUT.Counters.size, S.STORAGE | S.COPY_DST | S.COPY_SRC);
    this.staticObjBuffer = buf('staticObjects', STATIC_COUNT * LAYOUT.Instance.size, S.STORAGE | S.COPY_DST);
    this.lightBuffer = buf('lights', 3 * LAYOUT.Light.size, S.STORAGE | S.COPY_DST);
    this.staticVB = buf('static-vb', this.staticGeom.vertices.byteLength, S.VERTEX | S.COPY_DST);
    this.staticIB = buf('static-ib', this.staticGeom.indices.byteLength, S.INDEX | S.COPY_DST);
    device.queue.writeBuffer(this.staticVB, 0, this.staticGeom.vertices);
    device.queue.writeBuffer(this.staticIB, 0, this.staticGeom.indices);
    for (let v = 0; v < CULL_VIEW_COUNT; v++) {
      this.chunks.push(buf(`chunks-${v}`, CHUNK_CAP * LAYOUT.Chunk.size, S.STORAGE));
      this.dispatchArgs.push(buf(`dispatchArgs-${v}`, 16, S.STORAGE | S.INDIRECT | S.COPY_DST));
      this.visible.push(buf(`visible-${v}`, VISIBLE_CAP * 8, S.STORAGE));
      this.drawArgs.push(buf(`drawArgs-${v}`, LAYOUT.DrawArgs.size, S.STORAGE | S.INDIRECT | S.COPY_DST | S.COPY_SRC));
    }
    // 초기화 템플릿: [dispatch x=0,y=1,z=1,pad][draw 378,0,0,0][counters 0…]
    this.templateBuffer = buf('templates', 32 + LAYOUT.Counters.size, S.COPY_SRC | S.COPY_DST);
    const tpl = new Uint32Array((32 + LAYOUT.Counters.size) / 4);
    tpl.set([0, 1, 1, 0, VERTS_PER_MESHLET, 0, 0, 0]);
    device.queue.writeBuffer(this.templateBuffer, 0, tpl);
    this.overlayBuffer = buf('overlay', this.overlayCapacity, S.VERTEX | S.COPY_DST);
    this.pickBuffer = buf('pick-readback', 256, S.MAP_READ | S.COPY_DST);
    for (let i = 0; i < 3; i++) {
      this.statsRing.push({ buffer: buf(`stats-readback-${i}`, 256, S.MAP_READ | S.COPY_DST), busy: false });
    }
    this.comparisonSampler = device.createSampler({
      label: 'shadow-compare',
      compare: 'less',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
    });
    this.linearSampler = device.createSampler({ label: 'linear-clamp', magFilter: 'linear', minFilter: 'linear' });
  }

  static async create(gpu: GpuContext, onError: ErrorSink): Promise<Renderer> {
    const r = new Renderer(gpu, onError);
    await r.init();
    return r;
  }

  private async init() {
    const d = this.device;
    const entries = Object.entries(SHADERS) as [keyof typeof SHADERS, (typeof SHADERS)[keyof typeof SHADERS]][];
    const mods = await Promise.all(entries.map(([, s]) => createShaderModuleChecked(d, s, this.onError)));
    this.modules = Object.fromEntries(entries.map(([k], i) => [k, mods[i]!])) as Record<keyof typeof SHADERS, GPUShaderModule>;

    await withErrorScope(d, '바인드 그룹 레이아웃', () => this.createLayouts(), this.onError);
    // 파이프라인은 비동기로 만든다 — 메인 스레드를 막지 않는다(실패는 GPUPipelineError로 거부됨)
    try {
      await this.createFixedPipelines();
      await this.buildMainSet(4);
    } catch (e) {
      const msg = `[WebGPU] 파이프라인 생성 실패\n  ${e instanceof Error ? e.message : String(e)}`;
      console.error(msg);
      this.onError(msg);
      throw e;
    }
    await withErrorScope(d, '정적 바인드 그룹', () => this.createStaticBindGroups(), this.onError);
    // 기본 섀도 맵(라이트 설정이 오면 크기를 맞춘다)
    this.ensureShadowMaps(1024, 1024, 1024);
  }

  // ───────────────────────── 레이아웃 ─────────────────────────
  private createLayouts() {
    const d = this.device;
    const V = GPUShaderStage.VERTEX;
    const F = GPUShaderStage.FRAGMENT;
    const C = GPUShaderStage.COMPUTE;
    const ro = { type: 'read-only-storage' } as const;
    const rw = { type: 'storage' } as const;
    const uni = { type: 'uniform' } as const;
    const mk = (label: string, e: GPUBindGroupLayoutEntry[]) => d.createBindGroupLayout({ label, entries: e });
    this.bgl = {
      viewFrame: mk('bgl-viewFrame', [
        { binding: 0, visibility: V | F | C, buffer: uni },
        { binding: 1, visibility: V | F | C, buffer: uni },
      ]),
      lodSelect: mk('bgl-lodSelect', [
        { binding: 0, visibility: C, buffer: uni },
        { binding: 1, visibility: C, buffer: ro },
        { binding: 2, visibility: C, buffer: ro },
        { binding: 3, visibility: C, buffer: rw },
        { binding: 4, visibility: C, buffer: rw },
      ]),
      instanceCull: mk('bgl-instanceCull', [
        { binding: 0, visibility: C, buffer: uni },
        { binding: 1, visibility: C, buffer: uni },
        { binding: 2, visibility: C, buffer: ro },
        { binding: 3, visibility: C, buffer: ro },
        { binding: 4, visibility: C, buffer: ro },
        { binding: 5, visibility: C, buffer: rw },
        { binding: 6, visibility: C, buffer: rw },
      ]),
      meshletCull: mk('bgl-meshletCull', [
        { binding: 0, visibility: C, buffer: uni },
        { binding: 1, visibility: C, buffer: uni },
        { binding: 2, visibility: C, buffer: ro },
        { binding: 3, visibility: C, buffer: ro },
        { binding: 4, visibility: C, buffer: ro },
        { binding: 5, visibility: C, buffer: ro },
        { binding: 6, visibility: C, buffer: rw },
        { binding: 7, visibility: C, buffer: rw },
        { binding: 8, visibility: C, buffer: rw },
      ]),
      geom: mk('bgl-geom', [
        { binding: 0, visibility: V, buffer: ro },
        { binding: 1, visibility: V, buffer: ro },
        { binding: 2, visibility: V, buffer: ro },
        { binding: 3, visibility: V, buffer: ro },
        { binding: 4, visibility: V | F, buffer: ro },
      ]),
      visible: mk('bgl-visible', [{ binding: 0, visibility: V, buffer: ro }]),
      lighting: mk('bgl-lighting', [
        { binding: 0, visibility: F, buffer: ro },
        { binding: 1, visibility: F, texture: { sampleType: 'depth', viewDimension: '2d' } },
        { binding: 2, visibility: F, texture: { sampleType: 'depth', viewDimension: '2d' } },
        { binding: 3, visibility: F, texture: { sampleType: 'depth', viewDimension: 'cube' } },
        { binding: 4, visibility: F, sampler: { type: 'comparison' } },
      ]),
      staticObj: mk('bgl-staticObj', [{ binding: 0, visibility: V | F, buffer: ro }]),
      floor: mk('bgl-floor', [
        { binding: 0, visibility: F, texture: { sampleType: 'float', viewDimension: '2d' } },
        { binding: 1, visibility: F, sampler: { type: 'filtering' } },
      ]),
      empty: mk('bgl-empty', []),
    };
  }

  private layout(label: string, groups: GPUBindGroupLayout[]) {
    return this.device.createPipelineLayout({ label, bindGroupLayouts: groups });
  }

  private static readonly STATIC_VB_LAYOUT: GPUVertexBufferLayout = {
    arrayStride: 24,
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },
      { shaderLocation: 1, offset: 12, format: 'float32x3' },
    ],
  };

  private async createFixedPipelines() {
    const d = this.device;
    const b = this.bgl;
    const m = this.modules;
    const [lodSelect, instanceCull, meshletCull] = await Promise.all([
      d.createComputePipelineAsync({
        label: 'lod_select',
        layout: this.layout('pl-lodSelect', [b.lodSelect]),
        compute: { module: m.lodSelect, entryPoint: 'main' },
      }),
      d.createComputePipelineAsync({
        label: 'instance_cull',
        layout: this.layout('pl-instanceCull', [b.instanceCull]),
        compute: { module: m.instanceCull, entryPoint: 'main' },
      }),
      d.createComputePipelineAsync({
        label: 'meshlet_cull',
        layout: this.layout('pl-meshletCull', [b.meshletCull]),
        compute: { module: m.meshletCull, entryPoint: 'main' },
      }),
    ]);
    this.compute = { lodSelect, instanceCull, meshletCull };
    const meshletDepthLayout = this.layout('pl-meshlet-depth', [b.viewFrame, b.geom, b.visible]);
    const meshletLitLayout = this.layout('pl-meshlet-lit', [b.viewFrame, b.geom, b.visible, b.lighting]);
    const staticDepthLayout = this.layout('pl-static-depth', [b.viewFrame, b.staticObj]);
    const staticLitLayout = this.layout('pl-static-lit', [b.viewFrame, b.staticObj, b.empty, b.lighting]);
    const shadowDepth: GPUDepthStencilState = { format: SHADOW_FORMAT, depthWriteEnabled: true, depthCompare: 'less' };
    const reflDepth: GPUDepthStencilState = { format: MAIN_DEPTH, depthWriteEnabled: true, depthCompare: 'less' };
    const fixed = {
      // 그림자: 컬링 없음(라이트를 등진 면도 그림자를 드리운다)
      meshletDepth: d.createRenderPipelineAsync({
        label: 'meshlet-depth',
        layout: meshletDepthLayout,
        vertex: { module: m.meshlet, entryPoint: 'vs_main' },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: shadowDepth,
      }),
      // 반사: 삼각형 앞뒷면 방향이 뒤집히므로 frontFace를 cw로
      meshletReflect: d.createRenderPipelineAsync({
        label: 'meshlet-reflect',
        layout: meshletLitLayout,
        vertex: { module: m.meshlet, entryPoint: 'vs_main' },
        fragment: { module: m.meshlet, entryPoint: 'fs_main', targets: [{ format: REFLECTION_FORMAT }] },
        primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'cw' },
        depthStencil: reflDepth,
      }),
      meshletId: d.createRenderPipelineAsync({
        label: 'meshlet-id',
        layout: meshletDepthLayout,
        vertex: { module: m.meshlet, entryPoint: 'vs_main' },
        fragment: { module: m.meshlet, entryPoint: 'fs_id', targets: [{ format: ID_FORMAT }] },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: { format: MAIN_DEPTH, depthWriteEnabled: true, depthCompare: 'less' },
      }),
      staticDepth: d.createRenderPipelineAsync({
        label: 'static-depth',
        layout: staticDepthLayout,
        vertex: { module: m.static, entryPoint: 'vs_static', buffers: [Renderer.STATIC_VB_LAYOUT] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: shadowDepth,
      }),
      staticReflect: d.createRenderPipelineAsync({
        label: 'static-reflect',
        layout: staticLitLayout,
        vertex: { module: m.static, entryPoint: 'vs_static', buffers: [Renderer.STATIC_VB_LAYOUT] },
        fragment: { module: m.static, entryPoint: 'fs_static', targets: [{ format: REFLECTION_FORMAT }] },
        primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'cw' },
        depthStencil: reflDepth,
      }),
      staticId: d.createRenderPipelineAsync({
        label: 'static-id',
        layout: staticDepthLayout,
        vertex: { module: m.static, entryPoint: 'vs_static', buffers: [Renderer.STATIC_VB_LAYOUT] },
        fragment: { module: m.static, entryPoint: 'fs_static_id', targets: [{ format: ID_FORMAT }] },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: { format: MAIN_DEPTH, depthWriteEnabled: true, depthCompare: 'less' },
      }),
    };
    const keys = Object.keys(fixed) as (keyof typeof fixed)[];
    const done = await Promise.all(keys.map((k) => fixed[k]));
    this.fixed = Object.fromEntries(keys.map((k, i) => [k, done[i]!])) as unknown as typeof this.fixed;
  }

  /** 메인 패스 파이프라인 — 같은 패스의 모든 파이프라인이 같은 sampleCount를 쓴다 */
  /** MSAA 전환 시 새 파이프라인이 준비될 때까지는 이전 sampleCount로 계속 그린다 */
  private building = new Map<number, Promise<void>>();
  private readySamples = 0;

  private mainSet(samples: number): { samples: number; set: MainSet } {
    const hit = this.mainPipelines.get(samples);
    if (hit) return { samples, set: hit };
    if (!this.building.has(samples)) {
      this.building.set(
        samples,
        this.buildMainSet(samples).catch((e: unknown) => {
          const msg = `[WebGPU] 메인 파이프라인 생성 실패 x${samples}\n  ${e instanceof Error ? e.message : String(e)}`;
          console.error(msg);
          this.onError(msg);
        }),
      );
    }
    return { samples: this.readySamples, set: this.mainPipelines.get(this.readySamples)! };
  }

  private async buildMainSet(samples: number) {
    const d = this.device;
    const b = this.bgl;
    const m = this.modules;
    const multisample: GPUMultisampleState = { count: samples };
    const depth: GPUDepthStencilState = { format: MAIN_DEPTH, depthWriteEnabled: true, depthCompare: 'less' };
    const blend: GPUBlendState = {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    };
    const overlayVB: GPUVertexBufferLayout = {
      arrayStride: OVERLAY_STRIDE,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x4' },
      ],
    };
    const overlay = (label: string, topology: GPUPrimitiveTopology, compare: GPUCompareFunction) =>
      d.createRenderPipelineAsync({
        label,
        layout: this.layout(`pl-${label}`, [b.viewFrame]),
        vertex: { module: m.overlay, entryPoint: 'vs_overlay', buffers: [overlayVB] },
        fragment: { module: m.overlay, entryPoint: 'fs_overlay', targets: [{ format: this.format, blend }] },
        primitive: { topology, cullMode: 'none' },
        depthStencil: { format: MAIN_DEPTH, depthWriteEnabled: false, depthCompare: compare },
        multisample,
      });
    const set = {
      meshlet: d.createRenderPipelineAsync({
        label: `meshlet-main-x${samples}`,
        layout: this.layout('pl-meshlet-main', [b.viewFrame, b.geom, b.visible, b.lighting]),
        vertex: { module: m.meshlet, entryPoint: 'vs_main' },
        fragment: { module: m.meshlet, entryPoint: 'fs_main', targets: [{ format: this.format }] },
        primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
        depthStencil: depth,
        multisample,
      }),
      static: d.createRenderPipelineAsync({
        label: `static-main-x${samples}`,
        layout: this.layout('pl-static-main', [b.viewFrame, b.staticObj, b.empty, b.lighting]),
        vertex: { module: m.static, entryPoint: 'vs_static', buffers: [Renderer.STATIC_VB_LAYOUT] },
        fragment: { module: m.static, entryPoint: 'fs_static', targets: [{ format: this.format }] },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: depth,
        multisample,
      }),
      floor: d.createRenderPipelineAsync({
        label: `floor-main-x${samples}`,
        layout: this.layout('pl-floor', [b.viewFrame, b.staticObj, b.floor, b.lighting]),
        vertex: { module: m.static, entryPoint: 'vs_static', buffers: [Renderer.STATIC_VB_LAYOUT] },
        fragment: { module: m.static, entryPoint: 'fs_floor', targets: [{ format: this.format }] },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: depth,
        multisample,
      }),
      linesOnTop: overlay(`overlay-lines-top-x${samples}`, 'line-list', 'always'),
      linesDepth: overlay(`overlay-lines-depth-x${samples}`, 'line-list', 'less-equal'),
      trisOnTop: overlay(`overlay-tris-top-x${samples}`, 'triangle-list', 'always'),
    };
    const [meshlet, stat, floor, linesOnTop, linesDepth, trisOnTop] = await Promise.all([
      set.meshlet,
      set.static,
      set.floor,
      set.linesOnTop,
      set.linesDepth,
      set.trisOnTop,
    ]);
    this.mainPipelines.set(samples, { meshlet, static: stat, floor, linesOnTop, linesDepth, trisOnTop });
    this.readySamples = samples;
    this.building.delete(samples);
  }

  // ───────────────────────── 바인드 그룹 ─────────────────────────
  private createStaticBindGroups() {
    const d = this.device;
    const b = this.bgl;
    this.viewFrameBG = [];
    for (let s = 0; s < VIEW_SLOT_COUNT; s++) {
      this.viewFrameBG.push(
        d.createBindGroup({
          label: `bg-viewFrame-${s}`,
          layout: b.viewFrame,
          entries: [
            { binding: 0, resource: { buffer: this.viewBuffer, offset: s * VIEW_STRIDE, size: LAYOUT.View.size } },
            { binding: 1, resource: { buffer: this.frameBuffer } },
          ],
        }),
      );
    }
    this.visibleBG = this.visible.map((buffer, v) =>
      d.createBindGroup({ label: `bg-visible-${v}`, layout: b.visible, entries: [{ binding: 0, resource: { buffer } }] }),
    );
    this.staticObjBG = d.createBindGroup({
      label: 'bg-staticObj',
      layout: b.staticObj,
      entries: [{ binding: 0, resource: { buffer: this.staticObjBuffer } }],
    });
    this.emptyBG = d.createBindGroup({ label: 'bg-empty', layout: b.empty, entries: [] });
  }

  /** 지오메트리 버퍼가 바뀌면(성장) 이를 참조하는 바인드 그룹을 다시 만든다 */
  private ensureGeometryBindGroups() {
    if (this.geomVersion === this.geometry.version) return;
    const d = this.device;
    const b = this.bgl;
    const g = this.geometry;
    this.geomBG = d.createBindGroup({
      label: 'bg-geom',
      layout: b.geom,
      entries: [
        { binding: 0, resource: { buffer: g.vertices.buffer } },
        { binding: 1, resource: { buffer: g.meshlets.buffer } },
        { binding: 2, resource: { buffer: g.vertexIndices.buffer } },
        { binding: 3, resource: { buffer: g.primitives.buffer } },
        { binding: 4, resource: { buffer: this.instanceBuffer } },
      ],
    });
    this.lodSelectBG = d.createBindGroup({
      label: 'bg-lodSelect',
      layout: b.lodSelect,
      entries: [
        { binding: 0, resource: { buffer: this.frameBuffer } },
        { binding: 1, resource: { buffer: this.instanceBuffer } },
        { binding: 2, resource: { buffer: g.lodTable } },
        { binding: 3, resource: { buffer: this.instanceLodBuffer } },
        { binding: 4, resource: { buffer: this.countersBuffer } },
      ],
    });
    this.instanceCullBG = [];
    this.meshletCullBG = [];
    for (let v = 0; v < CULL_VIEW_COUNT; v++) {
      const viewRes = { buffer: this.viewBuffer, offset: v * VIEW_STRIDE, size: LAYOUT.View.size };
      this.instanceCullBG.push(
        d.createBindGroup({
          label: `bg-instanceCull-${v}`,
          layout: b.instanceCull,
          entries: [
            { binding: 0, resource: viewRes },
            { binding: 1, resource: { buffer: this.frameBuffer } },
            { binding: 2, resource: { buffer: this.instanceBuffer } },
            { binding: 3, resource: { buffer: g.lodTable } },
            { binding: 4, resource: { buffer: this.instanceLodBuffer } },
            { binding: 5, resource: { buffer: this.chunks[v]! } },
            { binding: 6, resource: { buffer: this.dispatchArgs[v]! } },
          ],
        }),
      );
      this.meshletCullBG.push(
        d.createBindGroup({
          label: `bg-meshletCull-${v}`,
          layout: b.meshletCull,
          entries: [
            { binding: 0, resource: viewRes },
            { binding: 1, resource: { buffer: this.frameBuffer } },
            { binding: 2, resource: { buffer: this.instanceBuffer } },
            { binding: 3, resource: { buffer: g.bounds.buffer } },
            { binding: 4, resource: { buffer: g.meshlets.buffer } },
            { binding: 5, resource: { buffer: this.chunks[v]! } },
            { binding: 6, resource: { buffer: this.visible[v]! } },
            { binding: 7, resource: { buffer: this.drawArgs[v]! } },
            { binding: 8, resource: { buffer: this.countersBuffer } },
          ],
        }),
      );
    }
    this.geomVersion = g.version;
  }

  // ───────────────────────── 렌더 타깃 ─────────────────────────
  private makeShadowMap(label: string, size: number, layers: number): ShadowMap {
    const texture = this.device.createTexture({
      label,
      size: { width: size, height: size, depthOrArrayLayers: layers },
      format: SHADOW_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const layerViews: GPUTextureView[] = [];
    for (let i = 0; i < layers; i++) {
      layerViews.push(texture.createView({ label: `${label}-layer${i}`, dimension: '2d', baseArrayLayer: i, arrayLayerCount: 1 }));
    }
    const sampleView = texture.createView({ label: `${label}-sample`, dimension: layers === 6 ? 'cube' : '2d' });
    return { size, texture, sampleView, layerViews };
  }

  /** 섀도 맵 해상도는 캔버스와 무관 — Inspector에서 바뀔 때만 다시 만든다 */
  private ensureShadowMaps(dirSize: number, spotSize: number, pointSize: number) {
    let changed = false;
    const lim = this.device.limits.maxTextureDimension2D;
    const fit = (s: number) => Math.max(64, Math.min(lim, s));
    if (this.shadow.dir?.size !== fit(dirSize)) {
      this.shadow.dir?.texture.destroy();
      this.shadow.dir = this.makeShadowMap('shadow-dir', fit(dirSize), 1);
      changed = true;
    }
    if (this.shadow.spot?.size !== fit(spotSize)) {
      this.shadow.spot?.texture.destroy();
      this.shadow.spot = this.makeShadowMap('shadow-spot', fit(spotSize), 1);
      changed = true;
    }
    if (this.shadow.point?.size !== fit(pointSize)) {
      this.shadow.point?.texture.destroy();
      this.shadow.point = this.makeShadowMap('shadow-point', fit(pointSize), 6);
      changed = true;
    }
    if (changed || !this.lightingBG) {
      this.lightingBG = this.device.createBindGroup({
        label: 'bg-lighting',
        layout: this.bgl.lighting,
        entries: [
          { binding: 0, resource: { buffer: this.lightBuffer } },
          { binding: 1, resource: this.shadow.dir!.sampleView },
          { binding: 2, resource: this.shadow.spot!.sampleView },
          { binding: 3, resource: this.shadow.point!.sampleView },
          { binding: 4, resource: this.comparisonSampler },
        ],
      });
    }
  }

  /** 해상도 의존 타깃: MSAA 색·깊이, 반사, 피킹 ID — 크기·샘플 수가 바뀔 때만 재생성 */
  private ensureTargets(w: number, h: number, samples: number, reflScale: number) {
    const d = this.device;
    const RA = GPUTextureUsage.RENDER_ATTACHMENT;
    if (this.main.w !== w || this.main.h !== h || this.main.samples !== samples) {
      this.main.color?.destroy();
      this.main.depth?.destroy();
      this.main.color =
        samples > 1
          ? d.createTexture({ label: `main-msaa-color ${w}x${h}`, size: { width: w, height: h }, format: this.format, sampleCount: samples, usage: RA })
          : null;
      this.main.depth = d.createTexture({
        label: `main-depth ${w}x${h} x${samples}`,
        size: { width: w, height: h },
        format: MAIN_DEPTH,
        sampleCount: samples,
        usage: RA,
      });
      this.main.w = w;
      this.main.h = h;
      this.main.samples = samples;
      this.targetGeneration++;
    }
    const lim = d.limits.maxTextureDimension2D;
    const rw = Math.max(1, Math.min(lim, Math.round(w * reflScale)));
    const rh = Math.max(1, Math.min(lim, Math.round(h * reflScale)));
    if (this.reflection.w !== rw || this.reflection.h !== rh) {
      this.reflection.color?.destroy();
      this.reflection.depth?.destroy();
      this.reflection.color = d.createTexture({
        label: `reflection-color ${rw}x${rh}`,
        size: { width: rw, height: rh },
        format: REFLECTION_FORMAT,
        usage: RA | GPUTextureUsage.TEXTURE_BINDING,
      });
      this.reflection.depth = d.createTexture({ label: 'reflection-depth', size: { width: rw, height: rh }, format: MAIN_DEPTH, usage: RA });
      this.reflection.w = rw;
      this.reflection.h = rh;
      this.floorBG = d.createBindGroup({
        label: 'bg-floor',
        layout: this.bgl.floor,
        entries: [
          { binding: 0, resource: this.reflection.color.createView() },
          { binding: 1, resource: this.linearSampler },
        ],
      });
      this.targetGeneration++;
    }
    if (this.pickTarget.w !== w || this.pickTarget.h !== h) {
      this.pickTarget.id?.destroy();
      this.pickTarget.depth?.destroy();
      this.pickTarget.id = d.createTexture({ label: 'pick-id', size: { width: w, height: h }, format: ID_FORMAT, usage: RA | GPUTextureUsage.COPY_SRC });
      this.pickTarget.depth = d.createTexture({ label: 'pick-depth', size: { width: w, height: h }, format: MAIN_DEPTH, usage: RA });
      this.pickTarget.w = w;
      this.pickTarget.h = h;
      this.targetGeneration++;
    }
  }

  // ───────────────────────── 장면 → 버퍼 ─────────────────────────
  private updateInstances(state: SceneState) {
    if (
      state.objects === this.lastObjects &&
      state.selection === this.lastSelection &&
      state.mode === this.lastMode &&
      state.settings.activeCamera === this.lastActiveCam
    )
      return;
    this.lastObjects = state.objects;
    this.lastSelection = state.selection;
    this.lastMode = state.mode;
    this.lastActiveCam = state.settings.activeCamera;
    if (this.instanceIds.length === 0) this.instanceIds = artworkIdsByInstance(state);

    const f32 = new Float32Array(this.instanceData);
    const u32 = new Uint32Array(this.instanceData);
    const i32 = new Int32Array(this.instanceData);
    const nm = new Float32Array(12);
    for (let i = 0; i < INSTANCE_COUNT; i++) {
      const o = state.objects[this.instanceIds[i]!];
      if (!o || o.kind !== 'artwork') continue;
      const model = worldMatrix(state, o);
      normalMatrix(model, nm, 0);
      const s = o.transform.scale;
      const parent = o.parent ? state.objects[o.parent] : undefined;
      const ps = parent ? parent.transform.scale : ([1, 1, 1] as Vec3);
      const ws: Vec3 = [s[0] * ps[0], s[1] * ps[1], s[2] * ps[2]];
      const ms = maxScale(ws);
      const minS = Math.min(Math.abs(ws[0]), Math.abs(ws[1]), Math.abs(ws[2]));
      let flags = INSTANCE_FLAG.castShadow;
      if (isActive(state, o)) flags |= INSTANCE_FLAG.active;
      if (state.selection === o.id || (parent && state.selection === parent.id)) flags |= INSTANCE_FLAG.selected;
      if (!o.artwork.featured) flags |= 16;
      writeInstance(f32, u32, i32, i * LAYOUT.Instance.size, {
        model,
        normalMat: nm,
        color: o.artwork.color,
        roughness: o.artwork.roughness,
        metallic: o.artwork.metallic,
        maxScale: ms,
        coneOk: minS > 0 && ms / minS < 1.01,
        artwork: o.artwork.artworkId,
        objectId: PICK_ID.artworkBase + i,
        lodForce: o.artwork.lodForce,
        flags,
      });
    }
    this.device.queue.writeBuffer(this.instanceBuffer, 0, this.instanceData);
    this.updateStaticObjects(state);
  }

  private staticActive: boolean[] = new Array(STATIC_COUNT).fill(false);
  private staticShadow: boolean[] = new Array(STATIC_COUNT).fill(false);

  private updateStaticObjects(state: SceneState) {
    const f32 = new Float32Array(this.staticData);
    const u32 = new Uint32Array(this.staticData);
    const i32 = new Int32Array(this.staticData);
    const nm = new Float32Array(12);
    const dev = state.mode === 'dev';
    const put = (
      idx: number,
      model: Mat4,
      color: readonly [number, number, number],
      rough: number,
      metal: number,
      code: number,
      objectId: number,
      active: boolean,
      castShadow: boolean,
      selected: boolean,
      emissive = false,
    ) => {
      normalMatrix(model, nm, 0);
      let flags = 0;
      if (active) flags |= INSTANCE_FLAG.active;
      if (selected) flags |= INSTANCE_FLAG.selected;
      if (castShadow) flags |= INSTANCE_FLAG.castShadow;
      if (emissive) flags |= INSTANCE_FLAG.emissive;
      writeInstance(f32, u32, i32, idx * LAYOUT.Instance.size, {
        model,
        normalMat: nm,
        color,
        roughness: rough,
        metallic: metal,
        maxScale: 1,
        coneOk: true,
        artwork: code,
        objectId,
        lodForce: -1,
        flags,
      });
      this.staticActive[idx] = active;
      this.staticShadow[idx] = castShadow && active;
    };
    const floor = state.objects[FLOOR_ID]!;
    const room = state.objects[ROOM_ID]!;
    const shelf = state.objects[SHELF_GROUP_ID]!;
    const sel = state.selection;
    put(STATIC.floor, worldMatrix(state, floor), [0.2, 0.195, 0.19], 0.4, 0, STATIC_MATERIAL.floor, PICK_ID.floor, floor.active, false, sel === FLOOR_ID);
    put(STATIC.walls, worldMatrix(state, room), [0.86, 0.84, 0.8], 0.92, 0, STATIC_MATERIAL.wall, PICK_ID.room, room.active, false, sel === ROOM_ID);
    put(STATIC.pedestals, worldMatrix(state, room), [0.92, 0.91, 0.89], 0.6, 0, STATIC_MATERIAL.pedestal, PICK_ID.room, room.active, true, sel === ROOM_ID);
    put(STATIC.shelf, worldMatrix(state, shelf), [0.56, 0.39, 0.24], 0.7, 0, STATIC_MATERIAL.shelf, PICK_ID.shelf, shelf.active, true, sel === SHELF_GROUP_ID);
    LIGHT_ORDER.forEach((id, k) => {
      const l = state.objects[id] as LightObject;
      const c = l.light.color;
      const m = Math.max(c[0], c[1], c[2], 1e-3);
      put(
        STATIC.lightMarker0 + k,
        mat4FromTRS(l.transform.position, [0, 0, 0, 1], [1, 1, 1]),
        [c[0] / m, c[1] / m, c[2] / m],
        1,
        0,
        STATIC_MATERIAL.marker,
        PICK_ID.lightBase + k,
        dev && l.active,
        false,
        sel === id,
        true,
      );
    });
    const mainCam = state.objects[MAIN_CAMERA_ID] as CameraObject;
    put(
      STATIC.cameraMarker,
      mat4FromTRS(mainCam.transform.position, mainCam.transform.rotation, [1.6, 1.6, 1.6]),
      [1, 0.85, 0.2],
      1,
      0,
      STATIC_MATERIAL.marker,
      PICK_ID.mainCamera,
      dev && state.settings.activeCamera === 'debug',
      false,
      sel === MAIN_CAMERA_ID,
      true,
    );
    this.device.queue.writeBuffer(this.staticObjBuffer, 0, this.staticData);
  }

  private shadowEnabled = { dir: false, spot: false, point: false };

  private updateLights(state: SceneState) {
    const f32 = new Float32Array(this.lightData);
    const P = state.settings.passes;
    const passOn = [P.shadowDirectional, P.shadowSpot, P.shadowPoint];
    const F = LAYOUT.Light.fields;
    const sizes = [1024, 1024, 1024];
    const lightVP: Mat4[][] = [];
    LIGHT_ORDER.forEach((id, k) => {
      const l = state.objects[id] as LightObject;
      const L = l.light;
      const mats = lightMatrices(l);
      lightVP.push(mats.viewProj);
      sizes[k] = L.shadowMapSize;
      const o = (k * LAYOUT.Light.size) / 4;
      f32.set(mats.viewProj[0]!, o + F.viewProj / 4);
      const kind = L.type === 'directional' ? 0 : L.type === 'spot' ? 1 : 2;
      f32.set([l.transform.position[0], l.transform.position[1], l.transform.position[2], kind], o + F.position / 4);
      f32.set([mats.dir[0], mats.dir[1], mats.dir[2], L.range], o + F.direction / 4);
      f32.set([L.color[0] * L.intensity, L.color[1] * L.intensity, L.color[2] * L.intensity, l.active ? 1 : 0], o + F.color / 4);
      const half = (L.spotAngle / 2) * (Math.PI / 180);
      const inner = half * (1 - Math.max(0.01, L.spotBlend));
      const near = kind === 2 ? POINT_SHADOW_NEAR : SPOT_SHADOW_NEAR;
      f32.set([Math.cos(half), Math.cos(inner), near, Math.max(L.range, 0.5)], o + F.spot / 4);
      const on = l.active && L.castShadow && passOn[k]!;
      if (k === 0) this.shadowEnabled.dir = on;
      if (k === 1) this.shadowEnabled.spot = on;
      if (k === 2) this.shadowEnabled.point = on;
      f32.set([on ? 1 : 0, L.shadowBias, L.shadowNormalBias, 1 / L.shadowMapSize], o + F.shadow / 4);
    });
    this.device.queue.writeBuffer(this.lightBuffer, 0, this.lightData);
    this.ensureShadowMaps(sizes[0]!, sizes[1]!, sizes[2]!);
    return lightVP;
  }

  // ───────────────────────── 프레임 ─────────────────────────
  render(input: FrameInput): FrameInfo {
    const { state, width: w, height: h } = input;
    const d = this.device;
    const settings = state.settings;
    const chosen = this.mainSet(settings.msaa ? 4 : 1);
    const samples = chosen.samples;
    const set = chosen.set;
    this.ensureGeometryBindGroups();
    this.ensureTargets(w, h, samples, settings.reflectionScale);
    this.updateInstances(state);
    const lightVP = this.updateLights(state);

    // ── 카메라와 뷰 ──
    const aspect = w / h;
    const mainCam = state.objects[MAIN_CAMERA_ID] as CameraObject;
    const debugCam = state.objects[DEBUG_CAMERA_ID] as CameraObject;
    const mainM = cameraMatrices(mainCam, aspect);
    const useDebug = state.mode === 'dev' && settings.activeCamera === 'debug';
    const renderM = useDebug ? cameraMatrices(debugCam, aspect) : mainM;
    const cull: MainCull = input.frozenCull ?? { viewProj: mainM.viewProj, eye: mainM.eye };
    const floor = state.objects[FLOOR_ID]!;
    const floorY = floor.transform.position[1];
    const reflW = this.reflection.w;
    const reflH = this.reflection.h;
    const mr = mainAndReflection(mainM, cull, floorY, settings.frustumCulling, settings.coneCulling, [w, h], [reflW, reflH]);
    this.views.write(VIEW.main, mr.main);
    this.views.write(VIEW.reflection, mr.reflection);
    const shadowFlags = settings.frustumCulling ? CULL_FLAG.frustum : 0;
    const shadowSlot = (slot: number, vp: Mat4, eye: Vec3, size: number, persp: boolean, dir: Vec3) =>
      this.views.write(slot, {
        renderViewProj: vp,
        cullViewProj: vp,
        eye,
        cullEye: eye,
        perspective: persp,
        cullDir: dir,
        cullFlags: shadowFlags,
        index: slot,
        reflection: false,
        shadow: true,
        viewport: [size, size],
      });
    const lights = LIGHT_ORDER.map((id) => state.objects[id] as LightObject);
    const dirL = lights[0]!;
    const spotL = lights[1]!;
    const pointL = lights[2]!;
    shadowSlot(VIEW.directional, lightVP[0]![0]!, dirL.transform.position, this.shadow.dir!.size, false, [0, -1, 0]);
    shadowSlot(VIEW.spot, lightVP[1]![0]!, spotL.transform.position, this.shadow.spot!.size, true, [0, -1, 0]);
    for (let f = 0; f < 6; f++) {
      shadowSlot(VIEW.pointFirst + f, lightVP[2]![f]!, pointL.transform.position, this.shadow.point!.size, true, [0, -1, 0]);
    }
    this.views.write(VIEW.debugRender, {
      renderViewProj: renderM.viewProj,
      cullViewProj: renderM.viewProj,
      eye: renderM.eye,
      cullEye: renderM.eye,
      perspective: true,
      cullDir: [0, 0, -1],
      cullFlags: 0,
      index: VIEW.main,
      reflection: false,
      shadow: false,
      viewport: [w, h],
    });
    d.queue.writeBuffer(this.viewBuffer, 0, this.views.data);

    // ── 활성 뷰 ──
    const P = settings.passes;
    const reflOn = P.main && P.reflection && floor.active && (floor as { floor: { reflection: boolean } }).floor.reflection && !useDebug;
    const active: number[] = [];
    if (P.main) active.push(VIEW.main);
    if (reflOn) active.push(VIEW.reflection);
    if (this.shadowEnabled.dir) active.push(VIEW.directional);
    if (this.shadowEnabled.spot) active.push(VIEW.spot);
    if (this.shadowEnabled.point) for (let f = 0; f < 6; f++) active.push(VIEW.pointFirst + f);

    // ── Frame 유니폼 ──
    this.writeFrame(state, w, h, input.time, cull.eye, floorY, reflOn);

    const enc = d.createCommandEncoder({ label: 'frame' });
    // 0. indirect 인자·카운터 초기화
    for (const v of active) {
      enc.copyBufferToBuffer(this.templateBuffer, 0, this.dispatchArgs[v]!, 0, 12);
      enc.copyBufferToBuffer(this.templateBuffer, 16, this.drawArgs[v]!, 0, 16);
    }
    enc.copyBufferToBuffer(this.templateBuffer, 32, this.countersBuffer, 0, LAYOUT.Counters.size);

    // 1. 컬링 (Compute): C0 LOD 선택 → 뷰마다 C1 인스턴스 → C2 메시릿(indirect)
    {
      const cp = enc.beginComputePass({ label: 'culling' });
      cp.setPipeline(this.compute.lodSelect);
      cp.setBindGroup(0, this.lodSelectBG);
      cp.dispatchWorkgroups(Math.ceil(INSTANCE_COUNT / 64));
      for (const v of active) {
        cp.setPipeline(this.compute.instanceCull);
        cp.setBindGroup(0, this.instanceCullBG[v]!);
        cp.dispatchWorkgroups(Math.ceil(INSTANCE_COUNT / 64));
        cp.setPipeline(this.compute.meshletCull);
        cp.setBindGroup(0, this.meshletCullBG[v]!);
        cp.dispatchWorkgroupsIndirect(this.dispatchArgs[v]!, 0);
      }
      cp.end();
    }

    // 2. 그림자 (라이트마다 따로 컬링한 결과로)
    const shadowPass = (view: GPUTextureView, v: number, label: string) => {
      const p = enc.beginRenderPass({
        label,
        colorAttachments: [],
        depthStencilAttachment: { view, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      p.setPipeline(this.fixed.meshletDepth);
      p.setBindGroup(0, this.viewFrameBG[v]!);
      p.setBindGroup(1, this.geomBG);
      p.setBindGroup(2, this.visibleBG[v]!);
      p.drawIndirect(this.drawArgs[v]!, 0);
      p.setPipeline(this.fixed.staticDepth);
      p.setBindGroup(0, this.viewFrameBG[v]!);
      p.setBindGroup(1, this.staticObjBG);
      this.drawStatic(p, (i) => this.staticShadow[i]!);
      p.end();
    };
    if (this.shadowEnabled.dir) shadowPass(this.shadow.dir!.layerViews[0]!, VIEW.directional, 'shadow-directional');
    if (this.shadowEnabled.spot) shadowPass(this.shadow.spot!.layerViews[0]!, VIEW.spot, 'shadow-spot');
    if (this.shadowEnabled.point) {
      for (let f = 0; f < 6; f++) shadowPass(this.shadow.point!.layerViews[f]!, VIEW.pointFirst + f, `shadow-point-${f}`);
    }

    // 3. 바닥 반사 (바닥 자체는 그리지 않는다)
    if (reflOn) {
      const p = enc.beginRenderPass({
        label: 'reflection',
        colorAttachments: [
          { view: this.reflection.color!.createView(), clearValue: { r: 0.03, g: 0.03, b: 0.035, a: 1 }, loadOp: 'clear', storeOp: 'store' },
        ],
        depthStencilAttachment: { view: this.reflection.depth!.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
      });
      p.setPipeline(this.fixed.meshletReflect);
      p.setBindGroup(0, this.viewFrameBG[VIEW.reflection]!);
      p.setBindGroup(1, this.geomBG);
      p.setBindGroup(2, this.visibleBG[VIEW.reflection]!);
      p.setBindGroup(3, this.lightingBG!);
      p.drawIndirect(this.drawArgs[VIEW.reflection]!, 0);
      p.setPipeline(this.fixed.staticReflect);
      p.setBindGroup(1, this.staticObjBG);
      p.setBindGroup(2, this.emptyBG);
      this.drawStatic(p, (i) => i !== STATIC.floor && this.staticActive[i]!);
      p.end();
    }

    // 4. 메인 (MSAA → 캔버스 resolve)
    const canvasView = this.gpu.context.getCurrentTexture().createView({ label: 'canvas' });
    const renderSlot = useDebug ? VIEW.debugRender : VIEW.main;
    {
      const p = enc.beginRenderPass({
        label: 'main',
        colorAttachments: [
          samples > 1
            ? { view: this.main.color!.createView(), resolveTarget: canvasView, clearValue: { r: 0.05, g: 0.05, b: 0.055, a: 1 }, loadOp: 'clear', storeOp: 'discard' }
            : { view: canvasView, clearValue: { r: 0.05, g: 0.05, b: 0.055, a: 1 }, loadOp: 'clear', storeOp: 'store' },
        ],
        depthStencilAttachment: { view: this.main.depth!.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
      });
      if (P.main) {
        // 디버그 카메라로 볼 때도 메인 카메라의 가시 목록(뷰 0)을 그대로 그린다
        p.setPipeline(set.meshlet);
        p.setBindGroup(0, this.viewFrameBG[renderSlot]!);
        p.setBindGroup(1, this.geomBG);
        p.setBindGroup(2, this.visibleBG[VIEW.main]!);
        p.setBindGroup(3, this.lightingBG!);
        p.drawIndirect(this.drawArgs[VIEW.main]!, 0);
        p.setPipeline(set.static);
        p.setBindGroup(0, this.viewFrameBG[renderSlot]!);
        p.setBindGroup(1, this.staticObjBG);
        p.setBindGroup(2, this.emptyBG);
        p.setBindGroup(3, this.lightingBG!);
        this.drawStatic(p, (i) => i !== STATIC.floor && this.staticActive[i]!);
        if (this.staticActive[STATIC.floor]) {
          p.setPipeline(set.floor);
          p.setBindGroup(2, this.floorBG!);
          this.drawStatic(p, (i) => i === STATIC.floor);
        }
      }
      this.drawOverlay(p, input.overlay, set, renderSlot);
      p.end();
    }

    // 5. 피킹 ID 패스 (클릭이 있을 때만, MSAA 없음, 메인 가시 목록 재사용)
    let pickIssued: PickRequest | null = null;
    if (this.pickRequest && !this.pickBusy && P.main) {
      const req = this.pickRequest;
      this.pickRequest = null;
      const px = Math.min(w - 1, Math.max(0, Math.floor(req.x)));
      const py = Math.min(h - 1, Math.max(0, Math.floor(req.y)));
      const p = enc.beginRenderPass({
        label: 'pick-id',
        colorAttachments: [{ view: this.pickTarget.id!.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
        depthStencilAttachment: { view: this.pickTarget.depth!.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
      });
      p.setPipeline(this.fixed.meshletId);
      p.setBindGroup(0, this.viewFrameBG[renderSlot]!);
      p.setBindGroup(1, this.geomBG);
      p.setBindGroup(2, this.visibleBG[VIEW.main]!);
      p.drawIndirect(this.drawArgs[VIEW.main]!, 0);
      p.setPipeline(this.fixed.staticId);
      p.setBindGroup(1, this.staticObjBG);
      this.drawStatic(p, (i) => this.staticActive[i]!);
      p.end();
      enc.copyTextureToBuffer(
        { texture: this.pickTarget.id!, origin: { x: px, y: py } },
        { buffer: this.pickBuffer, bytesPerRow: 256 },
        { width: 1, height: 1 },
      );
      pickIssued = req;
    }

    // 6. 통계 복사 (비어 있는 readback 슬롯이 있을 때만 — 프레임을 막지 않는다)
    const slot = this.statsRing.find((s) => !s.busy);
    const doStats = !!slot && (this.statsCounter++ & 7) === 0;
    if (doStats && slot) {
      enc.copyBufferToBuffer(this.countersBuffer, 0, slot.buffer, 0, LAYOUT.Counters.size);
      for (let v = 0; v < CULL_VIEW_COUNT; v++) {
        if (active.includes(v)) enc.copyBufferToBuffer(this.drawArgs[v]!, 4, slot.buffer, 128 + v * 4, 4);
      }
    }

    d.queue.submit([enc.finish()]);

    if (pickIssued) {
      const req = pickIssued;
      this.pickBusy = true;
      this.pickBuffer
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          const id = new Uint32Array(this.pickBuffer.getMappedRange(0, 4))[0]!;
          this.pickBuffer.unmap();
          this.pickBusy = false;
          req.resolve(id);
        })
        .catch(() => {
          this.pickBusy = false;
          req.resolve(0);
        });
    }
    if (doStats && slot) {
      slot.busy = true;
      const activeSet = new Set(active);
      slot.buffer
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          const raw = new Uint32Array(slot.buffer.getMappedRange(0, 256)).slice();
          slot.buffer.unmap();
          slot.busy = false;
          const visible = raw.slice(32, 32 + CULL_VIEW_COUNT);
          for (let v = 0; v < CULL_VIEW_COUNT; v++) if (!activeSet.has(v)) visible[v] = 0;
          this.onStats?.({ counters: raw.slice(0, LAYOUT.Counters.size / 4), visible });
        })
        .catch(() => {
          slot.busy = false;
        });
    }
    return { mainCamera: mainM, renderCamera: renderM, cull };
  }

  private drawStatic(p: GPURenderPassEncoder, include: (i: number) => boolean) {
    p.setVertexBuffer(0, this.staticVB);
    p.setIndexBuffer(this.staticIB, 'uint32');
    for (let i = 0; i < STATIC_COUNT; i++) {
      if (!include(i)) continue;
      const r = this.staticGeom.ranges[STATIC_MESH[i]!];
      p.drawIndexed(r.indexCount, 1, r.firstIndex, 0, i);
    }
  }

  private drawOverlay(p: GPURenderPassEncoder, o: OverlayGeometry, set: MainSet, slot: number) {
    const total = o.linesOnTop.length + o.linesDepth.length + o.trisOnTop.length;
    if (total === 0) return;
    const bytes = total * 4;
    if (bytes > this.overlayCapacity) {
      this.overlayBuffer.destroy();
      while (this.overlayCapacity < bytes) this.overlayCapacity *= 2;
      this.overlayBuffer = this.device.createBuffer({ label: 'overlay', size: this.overlayCapacity, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    const data = new Float32Array(total);
    data.set(o.linesDepth, 0);
    data.set(o.linesOnTop, o.linesDepth.length);
    data.set(o.trisOnTop, o.linesDepth.length + o.linesOnTop.length);
    this.device.queue.writeBuffer(this.overlayBuffer, 0, data);
    const stride = OVERLAY_STRIDE / 4;
    const nDepth = o.linesDepth.length / stride;
    const nTop = o.linesOnTop.length / stride;
    const nTris = o.trisOnTop.length / stride;
    p.setBindGroup(0, this.viewFrameBG[slot]!);
    p.setVertexBuffer(0, this.overlayBuffer);
    if (nDepth > 0) {
      p.setPipeline(set.linesDepth);
      p.draw(nDepth, 1, 0, 0);
    }
    if (nTris > 0) {
      p.setPipeline(set.trisOnTop);
      p.draw(nTris, 1, nDepth + nTop, 0);
    }
    if (nTop > 0) {
      p.setPipeline(set.linesOnTop);
      p.draw(nTop, 1, nDepth, 0);
    }
  }

  private writeFrame(state: SceneState, w: number, h: number, time: number, cullEye: Vec3, floorY: number, reflOn: boolean) {
    const F = LAYOUT.Frame.fields;
    const f32 = new Float32Array(this.frameData);
    const u32 = new Uint32Array(this.frameData);
    const i32 = new Int32Array(this.frameData);
    const s = state.settings;
    f32[F.resolution / 4] = w;
    f32[F.resolution / 4 + 1] = h;
    f32[F.time / 4] = time;
    u32[F.displayMode / 4] = s.displayMode === 'shaded' ? 0 : s.displayMode === 'meshlet' ? 1 : 2;
    f32.set([s.lodDistances[0], s.lodDistances[1], s.lodDistances[2], s.lodBias], F.lodParams / 4);
    f32.set([cullEye[0], cullEye[1], cullEye[2], 1], F.cullEye / 4);
    u32[F.instanceCount / 4] = INSTANCE_COUNT;
    i32[F.lodForce / 4] = s.forceLod;
    u32[F.visibleCap / 4] = VISIBLE_CAP;
    u32[F.chunkCap / 4] = CHUNK_CAP;
    u32[F.wireframe / 4] = s.wireframe ? 1 : 0;
    u32[F.lightCount / 4] = 3;
    u32[F.selectedObject / 4] = 0;
    u32[F.flags / 4] = (state.mode === 'dev' ? 1 : 0) | (reflOn ? 2 : 0);
    f32[F.floorY / 4] = floorY;
    const floor = state.objects[FLOOR_ID];
    f32[F.reflectionStrength / 4] = floor?.kind === 'floor' ? floor.floor.reflectionStrength : 0;
    f32[F.ambient / 4] = 0.16;
    f32[F.exposure / 4] = 1.0;
    this.device.queue.writeBuffer(this.frameBuffer, 0, this.frameData);
  }

  /** 렌더 해상도 기준 픽셀 좌표로 피킹 요청 — 다음 프레임에 ID 패스가 돈다 */
  pick(x: number, y: number): Promise<number> {
    return new Promise((resolve) => {
      this.pickRequest?.resolve(0);
      this.pickRequest = { x, y, resolve };
    });
  }

  /** 현재 LOD(CPU 근사) — 바운딩 스피어 표시용 */
  cpuLod(state: SceneState, instanceIndex: number, eye: Vec3): number {
    const id = this.instanceIds[instanceIndex];
    const o = id ? state.objects[id] : undefined;
    if (!o || o.kind !== 'artwork') return -1;
    const s = state.settings;
    let want: number;
    if (o.artwork.lodForce >= 0) want = o.artwork.lodForce;
    else if (s.forceLod >= 0) want = s.forceLod;
    else {
      const m = worldMatrix(state, o);
      const c: Vec3 = [m[12]!, m[13]!, m[14]!];
      const parent = o.parent ? state.objects[o.parent] : undefined;
      const ps = parent ? maxScale(parent.transform.scale) : 1;
      const r = 1.7320508 * maxScale(o.transform.scale) * ps;
      const dd = (Math.hypot(c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]) / Math.max(r, 1e-4)) * 2 ** s.lodBias;
      want = (dd > s.lodDistances[0] ? 1 : 0) + (dd > s.lodDistances[1] ? 1 : 0) + (dd > s.lodDistances[2] ? 1 : 0);
    }
    return this.geometry.pickAvailable(o.artwork.artworkId, Math.min(3, want));
  }

  dispose() {
    this.geometry.destroy();
    for (const b of [
      this.viewBuffer,
      this.frameBuffer,
      this.instanceBuffer,
      this.instanceLodBuffer,
      this.countersBuffer,
      this.staticObjBuffer,
      this.lightBuffer,
      this.staticVB,
      this.staticIB,
      this.templateBuffer,
      this.overlayBuffer,
      ...this.chunks,
      ...this.dispatchArgs,
      ...this.visible,
      ...this.drawArgs,
    ])
      b.destroy();
    for (const t of [this.main.color, this.main.depth, this.reflection.color, this.reflection.depth, this.pickTarget.id, this.pickTarget.depth]) t?.destroy();
    for (const s of [this.shadow.dir, this.shadow.spot, this.shadow.point]) s?.texture.destroy();
    void mat4;
  }
}
