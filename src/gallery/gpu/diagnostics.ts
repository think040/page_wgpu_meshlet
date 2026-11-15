// WebGPU 오류를 콘솔과 화면에 명확히 드러내는 도구 모음.
import { mapComposedLine, type ComposedShader } from './shaderLib';

export type ErrorSink = (message: string) => void;

const TAG = '[WebGPU]';

/** 셰이더 모듈을 만들고 getCompilationInfo 결과를 원본 .wgsl 파일·줄 기준으로 출력한다. */
export async function createShaderModuleChecked(
  device: GPUDevice,
  shader: ComposedShader,
  onError?: ErrorSink,
): Promise<GPUShaderModule> {
  const module = device.createShaderModule({ label: shader.label, code: shader.code });
  const info = await module.getCompilationInfo();
  const lines = shader.code.split('\n');
  let errors = 0;
  for (const m of info.messages) {
    const where = mapComposedLine(shader, m.lineNum);
    const src = lines[m.lineNum - 1] ?? '';
    const text =
      `${TAG} 셰이더 ${m.type} — ${shader.label}\n` +
      `  ${where.name}:${where.line}:${m.linePos}  ${m.message}\n` +
      `  > ${src.trim()}`;
    if (m.type === 'error') {
      errors++;
      console.error(text);
      onError?.(text);
    } else if (m.type === 'warning') {
      console.warn(text);
    } else {
      console.info(text);
    }
  }
  if (errors > 0) throw new Error(`${shader.label}: 셰이더 컴파일 오류 ${errors}건 (콘솔 참고)`);
  return module;
}

/** fn 안에서 생긴 validation / out-of-memory 오류를 잡아 라벨과 함께 출력한다. */
export async function withErrorScope<T>(
  device: GPUDevice,
  label: string,
  fn: () => T,
  onError?: ErrorSink,
): Promise<T> {
  device.pushErrorScope('out-of-memory');
  device.pushErrorScope('validation');
  try {
    return fn();
  } finally {
    const validation = await device.popErrorScope();
    const oom = await device.popErrorScope();
    const found: Array<[string, GPUError | null]> = [
      ['검증 오류', validation],
      ['메모리 부족', oom],
    ];
    for (const [kind, err] of found) {
      if (err) {
        const text = `${TAG} ${kind} — ${label}\n  ${err.message}`;
        console.error(text);
        onError?.(text);
      }
    }
  }
}

/** 범위 밖에서 생긴 오류와 디바이스 손실을 잡는다. 해제 함수를 돌려준다. */
export function installDeviceDiagnostics(device: GPUDevice, onError: ErrorSink): () => void {
  let reported = 0;
  const onUncaptured = (ev: Event) => {
    const err = (ev as GPUUncapturedErrorEvent).error;
    // 매 프레임 같은 오류가 반복되면 콘솔이 넘치므로 처음 20건만 출력
    if (reported++ < 20) {
      const text = `${TAG} 처리되지 않은 ${err.constructor.name}\n  ${err.message}`;
      console.error(text);
      onError(text);
    }
  };
  device.addEventListener('uncapturederror', onUncaptured);
  let active = true;
  void device.lost.then((info) => {
    if (!active || info.reason === 'destroyed') return;
    const text = `${TAG} 디바이스 손실 (${info.reason})\n  ${info.message}`;
    console.error(text);
    onError(text);
  });
  return () => {
    active = false;
    device.removeEventListener('uncapturederror', onUncaptured);
  };
}
