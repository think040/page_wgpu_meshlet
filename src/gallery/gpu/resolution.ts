// 렌더 해상도 = 캔버스 표시 크기 × devicePixelRatio × 렌더 스케일 (계획서 5장)
// ResizeObserver는 측정값만 기록한다. canvas.width/height 변경과 타깃 재생성은
// 프레임 시작 시 "값이 실제로 바뀌었을 때만" 한 번 일어난다.

export interface RenderSize {
  width: number;
  height: number;
}

export class CanvasResolution {
  /** 장치 픽셀 기준 표시 크기(렌더 스케일 1일 때) */
  private devW = 0;
  private devH = 0;
  private cssW = 0;
  private cssH = 0;
  private readonly observer: ResizeObserver;
  private dprQuery: MediaQueryList | null = null;
  private usesDevicePixelBox = false;

  private readonly onDprChange = () => {
    // 폴백 경로 전용: 모니터 간 이동으로 DPR만 바뀌면 content-box는 그대로라 RO가 울리지 않는다.
    this.devW = Math.round(this.cssW * window.devicePixelRatio);
    this.devH = Math.round(this.cssH * window.devicePixelRatio);
    this.watchDpr();
  };

  constructor(canvas: HTMLCanvasElement) {
    this.observer = new ResizeObserver((entries) => {
      for (const e of entries) {
        const box = e.contentBoxSize[0];
        if (box) {
          this.cssW = box.inlineSize;
          this.cssH = box.blockSize;
        }
        const dpBox = e.devicePixelContentBoxSize?.[0];
        if (dpBox) {
          // 정확한 장치 픽셀 크기(Chrome/Edge). DPR 변경 시에도 RO가 다시 울린다.
          this.devW = dpBox.inlineSize;
          this.devH = dpBox.blockSize;
        } else {
          this.devW = Math.round(this.cssW * window.devicePixelRatio);
          this.devH = Math.round(this.cssH * window.devicePixelRatio);
        }
      }
    });
    try {
      this.observer.observe(canvas, { box: 'device-pixel-content-box' });
      this.usesDevicePixelBox = true;
    } catch {
      this.observer.observe(canvas, { box: 'content-box' });
      this.watchDpr();
    }
  }

  private watchDpr() {
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    this.dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    this.dprQuery.addEventListener('change', this.onDprChange);
  }

  /** 렌더 스케일을 반영한 목표 크기. 표시 크기가 0이면 0×0(그리지 않음). [1, maxDim]으로 자른다. */
  target(renderScale: number, maxDim: number): RenderSize {
    if (this.devW <= 0 || this.devH <= 0) return { width: 0, height: 0 };
    const fit = (v: number) => Math.min(maxDim, Math.max(1, Math.round(v * renderScale)));
    return { width: fit(this.devW), height: fit(this.devH) };
  }

  describe(): string {
    const dpr = this.cssW > 0 ? this.devW / this.cssW : window.devicePixelRatio;
    return `표시 ${Math.round(this.cssW)}×${Math.round(this.cssH)} CSS px · DPR ${dpr.toFixed(2)}${
      this.usesDevicePixelBox ? '' : ' (폴백 측정)'
    }`;
  }

  dispose() {
    this.observer.disconnect();
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    this.dprQuery = null;
  }
}
