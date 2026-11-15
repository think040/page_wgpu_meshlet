'use client';

import Link from 'next/link';
import { memo, useEffect, useRef, useState } from 'react';
import { SITE } from '@/content/site';
import { GalleryApp, type GalleryStatus } from './gpu/app';
import { useSceneStore } from './ui/controls';
import type { MesherBackend } from './workers/protocol';

/**
 * 감상실 캔버스. 렌더러는 React 밖에서 돌고, 이 컴포넌트는 상태 변화(로딩/오류)에만 리렌더된다.
 * 장면 저장소를 구독하지 않으므로 Inspector 조작이 이 컴포넌트를 다시 렌더링하지 않는다.
 */
function GalleryCanvas() {
  const store = useSceneStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<GalleryStatus>({ kind: 'loading' });
  const [errors, setErrors] = useState<string[]>([]);
  const renders = useRef(0);
  renders.current++;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const params = new URLSearchParams(window.location.search);
    const backend = params.get('mesher') === 'ts' ? 'ts' : ('wasm' as MesherBackend);
    const workersParam = Number(params.get('workers'));
    const app = new GalleryApp(
      canvas,
      store,
      {
        onStatus: setStatus,
        onError: (msg) => setErrors((prev) => (prev.length >= 5 ? prev : [...prev, msg])),
      },
      {
        initialWork: params.get('work'),
        // ?gpu=low 로 내장 GPU를 요청할 수 있다(비교용)
        powerPreference: params.get('gpu') === 'low' ? 'low-power' : 'high-performance',
        backend,
        workers: Number.isFinite(workersParam) && workersParam > 0 ? workersParam : undefined,
      },
    );
    void app.start();
    return () => app.dispose();
  }, [store]);

  if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
    (window as unknown as { __galleryCanvasRenders?: number }).__galleryCanvasRenders = renders.current;
  }

  return (
    <>
      <canvas ref={canvasRef} className="gallery-canvas" aria-label="3D 감상실" />
      {status.kind === 'loading' && (
        <div className="gallery-message">
          <div>WebGPU를 준비하는 중…</div>
        </div>
      )}
      {(status.kind === 'unsupported' || status.kind === 'failed') && (
        <div className="gallery-message solid">
          <div>
            <p>{SITE.galleryUnsupported}</p>
            <p className="detail">{status.reason}</p>
            <p>
              <Link href="/">홈으로 돌아가기</Link>
            </p>
          </div>
        </div>
      )}
      {errors.length > 0 && (
        <div className="gallery-error" role="alert">
          <button type="button" className="gallery-error-close" onClick={() => setErrors([])} aria-label="닫기">
            ×
          </button>
          {errors.join('\n\n')}
        </div>
      )}
    </>
  );
}

export default memo(GalleryCanvas);
