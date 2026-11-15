// 감상실 렌더러의 생명주기: 초기화 → 메시 워커 풀 → 렌더 루프 → 정리(dispose).
// React 개발 모드의 이중 마운트에서도 디바이스·워커·루프·옵저버가 중복으로 남지 않도록
// 모든 비동기 단계 뒤에 disposed를 확인하고, dispose()가 만든 것을 전부 해제한다.

import { ARTWORKS } from '@/content/site';
import { OrbitController, type OrbitState } from '../camera/orbit';
import { emptyOverlay, pushCircle, pushLine } from '../gizmo/overlayBuilder';
import { Gizmo } from '../gizmo/gizmo';
import { mat4Invert, rayFromNdc, transformPoint, type Ray, type Vec3 } from '../math/math';
import { BOUNDS_STRIDE } from '../mesh/types';
import {
  artworkIdsByInstance,
  artworkObjectId,
  DEBUG_CAMERA_ID,
  FLOOR_ID,
  LIGHT_IDS,
  MAIN_CAMERA_ID,
  ROOM,
  ROOM_ID,
  SHELF_GROUP_ID,
} from '../scene/defaultScene';
import { worldMatrix } from '../scene/sceneGraph';
import { statsStore, type CameraObject, type SceneStore } from '../store/sceneStore';
import { defaultWorkerCount, MeshWorkerPool } from '../workers/pool';
import type { MesherBackend } from '../workers/protocol';
import { initGpu, type GpuContext } from './device';
import { installDeviceDiagnostics } from './diagnostics';
import { PICK_ID } from './layout';
import { Renderer, type FrameInfo } from './renderer';
import { CanvasResolution } from './resolution';
import { frustumCorners } from './views';

export type GalleryStatus =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'failed'; reason: string };

export interface GalleryCallbacks {
  onStatus: (status: GalleryStatus) => void;
  onError: (message: string) => void;
}

export interface GalleryOptions {
  /** 처음 다가갈 작품 slug(/gallery?work=…) */
  initialWork?: string | null;
  backend?: MesherBackend;
  workers?: number;
  /** 내장/외장 GPU 선택 힌트(기본 high-performance = 외장) */
  powerPreference?: GPUPowerPreference;
}

export const RENDER_SCALE_MIN = 0.5;
export const RENDER_SCALE_MAX = 2.0;

let liveApps = 0;

declare global {
  interface Window {
    /** 개발 모드 콘솔 디버그 핸들 */
    __gallery?: GalleryApp;
  }
}

export class GalleryApp {
  private disposed = false;
  private counted = false;
  private raf = 0;
  private gpu: GpuContext | null = null;
  private renderer: Renderer | null = null;
  private pool: MeshWorkerPool | null = null;
  private resolution: CanvasResolution | null = null;
  private removeDiagnostics: (() => void) | null = null;
  private readonly orbitMain: OrbitController;
  private readonly orbitDebug: OrbitController;
  private readonly gizmo: Gizmo;
  private frozen: FrameInfo['cull'] | null = null;
  private lastInfo: FrameInfo | null = null;
  private lastTime = 0;
  private fpsFrames = 0;
  private fpsAccum = 0;
  private readonly keys = new Set<string>();
  private pointer: { id: number; button: number; x: number; y: number; startX: number; startY: number; moved: boolean; gizmo: boolean } | null =
    null;
  private hoverPx: [number, number] | null = null;
  private loadStart = 0;
  private lastFocusNonce = 0;
  private readonly overview: OrbitState;
  private readonly unlisten: Array<() => void> = [];
  readonly uploadMs: Array<{ artwork: number; lod: number; ms: number }> = [];
  readonly timings: Array<{ artwork: number; lod: number; ms: number; backend: string }> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly store: SceneStore,
    private readonly cb: GalleryCallbacks,
    private readonly opts: GalleryOptions = {},
  ) {
    this.orbitMain = new OrbitController(store, MAIN_CAMERA_ID, 9);
    this.orbitMain.bounds = { min: [-ROOM.halfX + 0.4, 0.3, -ROOM.halfZ + 0.4], max: [ROOM.halfX - 0.4, ROOM.height - 0.3, ROOM.halfZ - 0.4] };
    this.orbitDebug = new OrbitController(store, DEBUG_CAMERA_ID, 18);
    this.overview = { ...this.orbitMain.state, target: [...this.orbitMain.state.target] as Vec3 };
    this.gizmo = new Gizmo(store);
  }

  async start(): Promise<void> {
    this.cb.onStatus({ kind: 'loading' });
    const result = await initGpu(this.canvas, () => this.disposed, this.opts.powerPreference ?? 'high-performance');
    if (!result.ok) {
      if (!result.cancelled && !this.disposed) this.cb.onStatus({ kind: 'unsupported', reason: result.reason });
      return;
    }
    if (this.disposed) {
      result.gpu.device.destroy();
      return;
    }
    this.gpu = result.gpu;
    statsStore.set((s) => ({ ...s, adapter: `${result.gpu.adapterLabel} (${result.gpu.powerPreference})` }));
    liveApps++;
    this.counted = true;
    console.info(`[gallery] 렌더러 시작 (활성 렌더러 ${liveApps}개)`);
    this.removeDiagnostics = installDeviceDiagnostics(result.gpu.device, this.cb.onError);
    this.resolution = new CanvasResolution(this.canvas);

    try {
      this.renderer = await Renderer.create(result.gpu, this.cb.onError);
    } catch (e) {
      if (!this.disposed) this.cb.onStatus({ kind: 'failed', reason: e instanceof Error ? e.message : String(e) });
      return;
    }
    if (this.disposed) {
      this.renderer.dispose();
      return;
    }
    this.renderer.onStats = (s) => this.onGpuStats(s.counters, s.visible);

    this.attachInput();
    this.startMeshing();
    if (this.opts.initialWork) {
      const art = ARTWORKS.find((a) => a.slug === this.opts.initialWork);
      if (art) this.focusObject(artworkObjectId(art.id), 1.6);
    }
    if (process.env.NODE_ENV !== 'production') window.__gallery = this;
    this.cb.onStatus({ kind: 'ready' });
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ───────────────────────── 메시 생성 ─────────────────────────
  private startMeshing() {
    const backend = this.opts.backend ?? 'wasm';
    const workers = this.opts.workers ?? defaultWorkerCount();
    this.loadStart = performance.now();
    this.store.set((s) => ({ ...s, loading: { ...s.loading, message: '메시 생성 준비 중', total: 24, backend } }));
    this.pool = new MeshWorkerPool(
      {
        onReady: (info) => {
          console.info(`[gallery] 메시 워커 ${info.workers}개 (${info.backend}${info.note ? ` — ${info.note}` : ''})`);
          this.store.set((s) => ({ ...s, loading: { ...s.loading, backend: `${info.backend} × ${info.workers}` } }));
        },
        onResult: (data) => {
          if (this.disposed || !this.renderer) return;
          const tu = performance.now();
          try {
            this.renderer.geometry.add(data);
            this.uploadMs.push({ artwork: data.artwork, lod: data.lod, ms: performance.now() - tu });
          } catch (e) {
            this.cb.onError(`[gallery] 지오메트리 업로드 실패: ${e instanceof Error ? e.message : String(e)}`);
          }
          this.timings.push({ artwork: data.artwork, lod: data.lod, ms: data.timings.total, backend: data.backend });
          statsStore.set((s) => {
            const lodInfo = s.lodInfo.map((row) => row.slice());
            lodInfo[data.artwork]![data.lod] = {
              meshlets: data.meshletCount,
              triangles: data.triangleCount,
              vertices: data.vertexCount,
              ms: data.timings.total,
            };
            return { ...s, totalMeshlets: this.renderer!.geometry.totalMeshlets, lodInfo };
          });
        },
        onProgress: (done, total, fraction) => {
          this.store.set((s) => ({
            ...s,
            loading: {
              ...s.loading,
              done,
              total,
              progress: fraction,
              elapsedMs: performance.now() - this.loadStart,
              message: `메시 생성 중 (${done}/${total})`,
            },
          }));
        },
        onError: (m) => this.cb.onError(m),
        onFinished: (ms) => {
          console.info(`[gallery] 전체 메시 생성 ${ms.toFixed(0)} ms`);
          this.store.set((s) => ({ ...s, loading: { ...s.loading, finished: true, progress: 1, elapsedMs: ms, message: '완료' } }));
        },
      },
      { backend, workers, artworks: [0, 1, 2, 3, 4, 5] },
    );
    this.pool.run();
  }

  // ───────────────────────── 프레임 ─────────────────────────
  private readonly frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const renderer = this.renderer;
    const resolution = this.resolution;
    const gpu = this.gpu;
    if (!renderer || !resolution || !gpu) return;
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.updateFps(dt);

    const state0 = this.store.state;
    // UI의 카메라 이동 요청(작품 선택 막대)
    const req = state0.focusRequest;
    if (req && req.nonce !== this.lastFocusNonce) {
      this.lastFocusNonce = req.nonce;
      if (req.target === 'overview') {
        this.orbitMain.flyTo({ ...this.overview, target: [...this.overview.target] as Vec3 });
        this.store.set((st) => ({ ...st, focus: null }));
      } else this.focusObject(req.target);
    }
    const controller = this.activeController();
    // 키보드 이동(감상·개발자 모드 공통): WASD/방향키 수평 이동, E/Q 위아래, Shift 빠르게
    {
      const k = (...codes: string[]) => (codes.some((c) => this.keys.has(c)) ? 1 : 0);
      const base = controller === this.orbitDebug ? 6 : 2.5;
      const speed = base * (k('ShiftLeft', 'ShiftRight') ? 3 : 1);
      controller.move(
        k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown'),
        k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft'),
        k('KeyE') - k('KeyQ'),
        dt,
        speed,
      );
    }
    this.orbitMain.update(dt);
    this.orbitDebug.update(dt);

    const s = state0.settings;
    const scale = Math.min(RENDER_SCALE_MAX, Math.max(RENDER_SCALE_MIN, s.renderScale));
    const size = resolution.target(scale, gpu.device.limits.maxTextureDimension2D);
    if (size.width === 0 || size.height === 0) return;
    if (this.canvas.width !== size.width || this.canvas.height !== size.height) {
      this.canvas.width = size.width;
      this.canvas.height = size.height;
    }

    // 컬링 고정
    if (s.freezeCulling && !this.frozen && this.lastInfo) this.frozen = { ...this.lastInfo.cull };
    if (!s.freezeCulling) this.frozen = null;

    const state = this.store.state;
    const overlay = emptyOverlay();
    if (state.mode === 'dev' && this.lastInfo) this.buildDebugOverlay(overlay, state.settings.activeCamera === 'debug');

    this.lastInfo = renderer.render({
      state,
      width: size.width,
      height: size.height,
      time: now / 1000,
      overlay,
      frozenCull: this.frozen,
    });
  };

  private activeController() {
    const s = this.store.state;
    return s.mode === 'dev' && s.settings.activeCamera === 'debug' ? this.orbitDebug : this.orbitMain;
  }

  private renderCameraFov() {
    const s = this.store.state;
    const id = s.mode === 'dev' && s.settings.activeCamera === 'debug' ? DEBUG_CAMERA_ID : MAIN_CAMERA_ID;
    return (s.objects[id] as CameraObject).camera.fov;
  }

  private buildDebugOverlay(overlay: ReturnType<typeof emptyOverlay>, debugView: boolean) {
    const info = this.lastInfo!;
    const state = this.store.state;
    // 디버그 카메라: 메인 카메라(컬링 기준) 프러스텀
    if (debugView) {
      // 먼 평면은 보기 좋게 14m 앞에서 끊어 그린다(컬링에는 실제 far 사용)
      const full = frustumCorners(info.cull.viewProj);
      const near = full.slice(0, 4);
      const far = full.slice(4).map((f, i) => {
        const n0 = near[i]!;
        const len = Math.hypot(f[0] - n0[0], f[1] - n0[1], f[2] - n0[2]);
        const t = Math.min(1, 14 / Math.max(len, 1e-6));
        return [n0[0] + (f[0] - n0[0]) * t, n0[1] + (f[1] - n0[1]) * t, n0[2] + (f[2] - n0[2]) * t] as Vec3;
      });
      const c = [...near, ...far];
      const col = [1, 0.85, 0.2, 1] as const;
      const e: Array<[number, number]> = [
        [0, 1], [2, 3], [0, 2], [1, 3],
        [4, 5], [6, 7], [4, 6], [5, 7],
        [0, 4], [1, 5], [2, 6], [3, 7],
      ];
      for (const [a, b] of e) pushLine(overlay.linesOnTop, c[a]!, c[b]!, col);
    }
    // 선택한 작품의 메시릿 바운딩 스피어
    if (state.settings.showBoundingSpheres && state.selection && this.renderer) {
      const o = state.objects[state.selection];
      if (o?.kind === 'artwork') {
        const lod = this.renderer.cpuLod(state, o.artwork.instanceIndex, info.cull.eye);
        const rec = lod >= 0 ? this.renderer.geometry.records[o.artwork.artworkId * 4 + lod] : null;
        if (rec) {
          const m = worldMatrix(state, o);
          const sc = Math.hypot(m[0]!, m[1]!, m[2]!);
          const col = [0.3, 0.9, 1, 0.55] as const;
          const count = Math.min(rec.meshletCount, 4000);
          for (let i = 0; i < count; i++) {
            const b = rec.bounds;
            const c = transformPoint(m, [b[i * BOUNDS_STRIDE]!, b[i * BOUNDS_STRIDE + 1]!, b[i * BOUNDS_STRIDE + 2]!]);
            const r = b[i * BOUNDS_STRIDE + 3]! * sc;
            pushCircle(overlay.linesDepth, c, [1, 0, 0], r, 12, col);
            pushCircle(overlay.linesDepth, c, [0, 1, 0], r, 12, col);
            pushCircle(overlay.linesDepth, c, [0, 0, 1], r, 12, col);
          }
        }
      }
    }
    this.gizmo.build(overlay, info.renderCamera.eye, this.renderCameraFov());
  }

  private updateFps(dt: number) {
    this.fpsFrames++;
    this.fpsAccum += dt;
    if (this.fpsAccum >= 0.5) {
      const fps = this.fpsFrames / this.fpsAccum;
      const frameMs = (this.fpsAccum / this.fpsFrames) * 1000;
      this.fpsFrames = 0;
      this.fpsAccum = 0;
      statsStore.set((s) => ({ ...s, fps, frameMs }));
    }
  }

  private onGpuStats(c: Uint32Array, visible: Uint32Array) {
    statsStore.set((s) => ({
      ...s,
      lodInstances: [c[0]!, c[1]!, c[2]!, c[3]!],
      selectedMeshlets: c[4]!,
      selectedTriangles: c[5]!,
      viewTriangles: Array.from(c.slice(8, 18)),
      visibleMeshlets: Array.from(visible),
      overflow: c[6]!,
      gpuReadbackFrames: s.gpuReadbackFrames + 1,
    }));
  }

  // ───────────────────────── 입력 ─────────────────────────
  private toRenderPx(clientX: number, clientY: number): [number, number] {
    // 피킹 좌표는 CSS 픽셀이 아니라 렌더 해상도 기준(devicePixelRatio·렌더 스케일 반영)
    const r = this.canvas.getBoundingClientRect();
    return [((clientX - r.left) * this.canvas.width) / r.width, ((clientY - r.top) * this.canvas.height) / r.height];
  }

  private rayAt(clientX: number, clientY: number): Ray | null {
    if (!this.lastInfo) return null;
    const [x, y] = this.toRenderPx(clientX, clientY);
    const ndcX = (x / this.canvas.width) * 2 - 1;
    const ndcY = 1 - (y / this.canvas.height) * 2;
    return rayFromNdc(mat4Invert(this.lastInfo.renderCamera.viewProj), ndcX, ndcY);
  }

  private attachInput() {
    const c = this.canvas;
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, opts);
      this.unlisten.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    on(c, 'contextmenu', (e) => e.preventDefault());
    on(c, 'pointerdown', (e) => {
      if (this.pointer) return;
      c.setPointerCapture(e.pointerId);
      let gizmo = false;
      if (e.button === 0 && this.store.state.mode === 'dev' && this.lastInfo) {
        const ray = this.rayAt(e.clientX, e.clientY);
        if (ray) gizmo = this.gizmo.begin(ray, this.lastInfo.renderCamera.eye, this.renderCameraFov(), [e.clientX, e.clientY]);
      }
      this.pointer = { id: e.pointerId, button: e.button, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false, gizmo };
    });
    on(c, 'pointermove', (e) => {
      const p = this.pointer;
      if (!p || p.id !== e.pointerId) {
        // 마우스를 올린 기즈모 핸들 강조
        if (this.store.state.mode === 'dev' && this.lastInfo) {
          this.hoverPx = [e.clientX, e.clientY];
          this.gizmo.updateHover(this.rayAt(e.clientX, e.clientY), this.lastInfo.renderCamera.eye, this.renderCameraFov());
        }
        return;
      }
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > 4) p.moved = true;
      if (p.gizmo) {
        // 기즈모 드래그 중에는 카메라 조작이 동작하지 않는다
        const ray = this.rayAt(e.clientX, e.clientY);
        if (ray) this.gizmo.move(ray, [e.clientX, e.clientY]);
        return;
      }
      // 카메라 회전은 오른쪽 드래그 하나뿐(왼쪽은 클릭·기즈모 전용)
      if (p.button === 2) this.activeController().look(dx, dy);
    });
    const up = (e: PointerEvent) => {
      const p = this.pointer;
      if (!p || p.id !== e.pointerId) return;
      this.pointer = null;
      if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
      if (p.gizmo) {
        this.gizmo.end();
        return;
      }
      if (p.button === 0 && !p.moved) void this.handleClick(e.clientX, e.clientY);
    };
    on(c, 'pointerup', up);
    on(c, 'pointercancel', up);
    on(
      c,
      'wheel',
      // 휠: W/S와 같은 수평 앞뒤 이동(위로 굴리면 앞으로)
      (e) => {
        e.preventDefault();
        const ctl = this.activeController();
        // deltaMode 1(줄)·2(페이지)도 픽셀 단위로 맞춘다
        const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
        const step = (ctl === this.orbitDebug ? 0.012 : 0.005) * (e.shiftKey ? 3 : 1);
        ctl.dolly(Math.max(-1.5, Math.min(1.5, -px * step)));
      },
      { passive: false },
    );
    on(window, 'keydown', (e) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return; // 브라우저 단축키와 겹치지 않게
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow')) e.preventDefault(); // 방향키 페이지 스크롤 방지
      if (this.store.state.mode !== 'dev') return;
      // 기즈모 전환은 이동 키(WASD/QE)와 겹치지 않도록 숫자 키 1/2/3
      const mode = e.code === 'Digit1' ? 'translate' : e.code === 'Digit2' ? 'rotate' : e.code === 'Digit3' ? 'scale' : null;
      if (mode) this.store.updateSettings({ gizmoMode: mode });
    });
    on(window, 'keyup', (e) => this.keys.delete(e.code));
    on(window, 'blur', () => this.keys.clear());
  }

  private async handleClick(clientX: number, clientY: number) {
    if (!this.renderer) return;
    const [x, y] = this.toRenderPx(clientX, clientY);
    const id = await this.renderer.pick(x, y);
    if (this.disposed) return;
    const objId = this.objectIdFromPick(id);
    const s = this.store.state;
    if (s.mode === 'dev') {
      this.store.select(objId);
      return;
    }
    // 감상 모드: 작품을 누르면 그 앞으로 이동
    if (objId && s.objects[objId]?.kind === 'artwork') this.focusObject(objId);
  }

  private objectIdFromPick(id: number): string | null {
    if (id === 0) return null;
    if (id >= PICK_ID.artworkBase && id < PICK_ID.artworkBase + 54) {
      return artworkIdsByInstance(this.store.state)[id - PICK_ID.artworkBase] ?? null;
    }
    if (id === PICK_ID.floor) return FLOOR_ID;
    if (id === PICK_ID.room) return ROOM_ID;
    if (id === PICK_ID.shelf) return SHELF_GROUP_ID;
    if (id >= PICK_ID.lightBase && id < PICK_ID.lightBase + 3) {
      return [LIGHT_IDS.directional, LIGHT_IDS.spot, LIGHT_IDS.point][id - PICK_ID.lightBase]!;
    }
    if (id === PICK_ID.mainCamera) return MAIN_CAMERA_ID;
    return null;
  }

  /** 작품 앞으로 메인 카메라를 이동 */
  focusObject(objectId: string, duration = 1.1) {
    const s = this.store.state;
    const o = s.objects[objectId];
    if (!o || o.kind !== 'artwork') return;
    const m = worldMatrix(s, o);
    const center: Vec3 = [m[12]!, m[13]!, m[14]!];
    const sc = Math.hypot(m[0]!, m[1]!, m[2]!);
    let yaw: number;
    let pitch: number;
    let distance: number;
    if (o.artwork.featured) {
      // 가운데 통로(z≈0) 쪽에서 바라본다
      const side = center[2] >= 0 ? -1 : 1;
      yaw = side > 0 ? 0 : Math.PI;
      pitch = 0.2;
      distance = sc * 4.2;
    } else {
      yaw = 0;
      pitch = 0.12;
      distance = Math.max(0.9, sc * 6);
    }
    this.orbitMain.flyTo({ target: center, yaw, pitch, distance }, duration);
    this.store.set((st) => ({ ...st, focus: objectId }));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const u of this.unlisten) u();
    this.pool?.dispose();
    this.resolution?.dispose();
    this.renderer?.dispose();
    this.removeDiagnostics?.();
    if (this.gpu) {
      this.gpu.context.unconfigure();
      this.gpu.device.destroy();
    }
    if (this.counted) {
      liveApps--;
      console.info(`[gallery] 렌더러 정리 (활성 렌더러 ${liveApps}개)`);
    }
    if (typeof window !== 'undefined' && window.__gallery === this) delete window.__gallery;
    this.gpu = null;
    this.renderer = null;
  }

  /** 디버그(자동 테스트용): 월드 좌표 → 브라우저 client 좌표 */
  projectToClient(p: Vec3): [number, number] | null {
    if (!this.lastInfo) return null;
    const vp = this.lastInfo.renderCamera.viewProj;
    const x = vp[0]! * p[0] + vp[4]! * p[1] + vp[8]! * p[2] + vp[12]!;
    const y = vp[1]! * p[0] + vp[5]! * p[1] + vp[9]! * p[2] + vp[13]!;
    const w = vp[3]! * p[0] + vp[7]! * p[1] + vp[11]! * p[2] + vp[15]!;
    const r = this.canvas.getBoundingClientRect();
    return [r.left + ((x / w) * 0.5 + 0.5) * r.width, r.top + (0.5 - (y / w) * 0.5) * r.height];
  }

  /** 디버그: 해상도 정보 */
  describeResolution() {
    return this.resolution?.describe() ?? '';
  }
  get renderTargetGeneration() {
    return this.renderer?.targetGeneration ?? 0;
  }
  get liveRendererCount() {
    return liveApps;
  }
}
