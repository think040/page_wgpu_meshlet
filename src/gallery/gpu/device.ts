// 어댑터·디바이스·캔버스 컨텍스트 초기화. 브라우저에서만 호출된다.

export interface GpuContext {
  adapter: GPUAdapter;
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  /** 실제로 잡힌 어댑터 설명(예: "nvidia / ampere") */
  adapterLabel: string;
  powerPreference: GPUPowerPreference;
}

export type GpuInitResult =
  | { ok: true; gpu: GpuContext }
  | { ok: false; cancelled: boolean; reason: string };

/** 기본값보다 크게 받을 한도 — 전역 지오메트리 버퍼용(계획서 3.2). 어댑터가 허용하는 만큼만 요청. */
const WANTED_LIMITS = ['maxBufferSize', 'maxStorageBufferBindingSize'] as const;

const fail = (reason: string): GpuInitResult => ({ ok: false, cancelled: false, reason });
const cancelled: GpuInitResult = { ok: false, cancelled: true, reason: 'cancelled' };

/**
 * powerPreference: 노트북처럼 내장·외장 GPU가 함께 있을 때 어느 쪽을 쓸지에 대한 "힌트".
 * 'high-performance' = 외장 GPU 우선. 브라우저·OS가 무시할 수 있으므로(특히 Windows),
 * 실제로 잡힌 어댑터는 콘솔과 통계 패널에 표시한다.
 */
export async function initGpu(
  canvas: HTMLCanvasElement,
  isCancelled: () => boolean,
  powerPreference: GPUPowerPreference = 'high-performance',
): Promise<GpuInitResult> {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    return fail('이 브라우저에는 WebGPU API(navigator.gpu)가 없습니다.');
  }
  let adapter: GPUAdapter | null;
  try {
    // Windows Chrome/Edge는 powerPreference를 무시하고 경고만 낸다(crbug.com/369219127).
    // 그곳에서는 OS 그래픽 설정이나 chrome://flags/#force-high-performance-gpu로 외장 GPU를 고른다.
    const ignored = /Windows/i.test(navigator.userAgent);
    adapter = await navigator.gpu.requestAdapter(ignored ? undefined : { powerPreference });
    // 힌트로 어댑터를 못 얻는 환경이면 기본 요청으로 다시 시도
    if (!adapter) adapter = await navigator.gpu.requestAdapter();
  } catch (e) {
    return fail(`GPU 어댑터 요청 실패: ${String(e)}`);
  }
  if (!adapter) {
    return fail('WebGPU 어댑터를 얻지 못했습니다. 브라우저의 GPU 가속이 꺼져 있거나 이 GPU가 차단 목록에 있을 수 있습니다.');
  }
  if (isCancelled()) return cancelled;

  const requiredLimits: Record<string, number> = {};
  for (const key of WANTED_LIMITS) requiredLimits[key] = adapter.limits[key];

  let device: GPUDevice;
  try {
    device = await adapter.requestDevice({ label: 'gallery-device', requiredLimits });
  } catch (e) {
    return fail(`GPU 디바이스 생성 실패: ${String(e)}`);
  }
  if (isCancelled()) {
    device.destroy();
    return cancelled;
  }

  const context = canvas.getContext('webgpu');
  if (!context) {
    device.destroy();
    return fail('캔버스에서 webgpu 컨텍스트를 만들지 못했습니다.');
  }
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  const info = adapter.info;
  const adapterLabel = [info.vendor, info.architecture, info.description].filter(Boolean).join(' / ') || '알 수 없음';
  const mib = (n: number) => `${(n / 2 ** 20).toFixed(0)}MiB`;
  console.info(
    `[WebGPU] 어댑터: ${adapterLabel} (요청: ${powerPreference})\n` +
      `  캔버스 포맷 ${format} · maxTextureDimension2D ${device.limits.maxTextureDimension2D} · ` +
      `maxStorageBufferBindingSize ${mib(device.limits.maxStorageBufferBindingSize)} · ` +
      `maxBufferSize ${mib(device.limits.maxBufferSize)}`,
  );
  return { ok: true, gpu: { adapter, device, context, format, adapterLabel, powerPreference } };
}
