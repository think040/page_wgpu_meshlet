'use client';
// 감상실 오버레이 UI: 개발자 툴바, 통계 패널, 로딩 진행률, 감상 모드 안내.

import { ARTWORKS } from '@/content/site';
import { statsStore, useStore, VIEW_NAMES } from '../store/sceneStore';
import { useScene, useSceneStore } from './controls';

export function Toolbar() {
  const store = useSceneStore();
  const mode = useScene((s) => s.settings.gizmoMode);
  const space = useScene((s) => s.settings.gizmoSpace);
  const cam = useScene((s) => s.settings.activeCamera);
  const display = useScene((s) => s.settings.displayMode);
  const wire = useScene((s) => s.settings.wireframe);
  const freeze = useScene((s) => s.settings.freezeCulling);
  const btn = (active: boolean) => `tb-btn${active ? ' on' : ''}`;
  return (
    <div className="dev-toolbar" role="toolbar" aria-label="개발자 도구">
      <div className="tb-group">
        <button type="button" className={btn(mode === 'translate')} title="이동 (1)" onClick={() => store.updateSettings({ gizmoMode: 'translate' })}>
          ✥ 이동 <kbd>1</kbd>
        </button>
        <button type="button" className={btn(mode === 'rotate')} title="회전 (2)" onClick={() => store.updateSettings({ gizmoMode: 'rotate' })}>
          ⟳ 회전 <kbd>2</kbd>
        </button>
        <button type="button" className={btn(mode === 'scale')} title="크기 (3)" onClick={() => store.updateSettings({ gizmoMode: 'scale' })}>
          ⤢ 크기 <kbd>3</kbd>
        </button>
        <button
          type="button"
          className="tb-btn"
          title="이동·회전 기준 축 (크기는 항상 로컬)"
          onClick={() => store.updateSettings({ gizmoSpace: space === 'world' ? 'local' : 'world' })}
        >
          {space === 'world' ? '🌐 월드' : '◫ 로컬'}
        </button>
      </div>
      <div className="tb-group">
        <button type="button" className={btn(cam === 'main')} onClick={() => store.updateSettings({ activeCamera: 'main' })}>
          메인 카메라
        </button>
        <button type="button" className={btn(cam === 'debug')} onClick={() => store.updateSettings({ activeCamera: 'debug' })}>
          디버그 카메라
        </button>
      </div>
      <div className="tb-group">
        <button type="button" className={btn(display === 'shaded')} onClick={() => store.updateSettings({ displayMode: 'shaded' })}>
          셰이딩
        </button>
        <button type="button" className={btn(display === 'meshlet')} onClick={() => store.updateSettings({ displayMode: 'meshlet' })}>
          메시릿
        </button>
        <button type="button" className={btn(display === 'lod')} onClick={() => store.updateSettings({ displayMode: 'lod' })}>
          LOD
        </button>
        <button type="button" className={btn(wire)} onClick={() => store.updateSettings({ wireframe: !wire })}>
          Wire
        </button>
        <button type="button" className={btn(freeze)} onClick={() => store.updateSettings({ freezeCulling: !freeze })}>
          ❄ 고정
        </button>
      </div>
    </div>
  );
}

const n = (v: number) => v.toLocaleString();

export function StatsPanel() {
  const st = useStore(statsStore, (s) => s);
  const lodColors = ['#33d94d', '#408cff', '#ffd133', '#ff4d40'];
  return (
    <div className="stats-panel" aria-label="통계">
      <div className="stats-row big">
        <span>FPS</span>
        <b>{st.fps.toFixed(0)}</b>
        <span className="muted">{st.frameMs.toFixed(1)} ms</span>
      </div>
      <div className="stats-row">
        <span>GPU</span>
        <b className="stats-gpu">{st.adapter || '…'}</b>
      </div>
      <div className="stats-row">
        <span>업로드된 메시릿(전체 LOD)</span>
        <b>{n(st.totalMeshlets)}</b>
      </div>
      <div className="stats-row">
        <span>선택 LOD 메시릿 / 삼각형</span>
        <b>
          {n(st.selectedMeshlets)} / {n(st.selectedTriangles)}
        </b>
      </div>
      <div className="stats-row">
        <span>가시 메시릿(메인)</span>
        <b>{n(st.visibleMeshlets[0] ?? 0)}</b>
      </div>
      <div className="stats-row">
        <span>그려진 삼각형(메인)</span>
        <b>{n(st.viewTriangles[0] ?? 0)}</b>
      </div>
      <div className="stats-row">
        <span>LOD별 인스턴스</span>
        <b>
          {st.lodInstances.map((c, i) => (
            <span key={i} style={{ color: lodColors[i], marginLeft: 6 }}>
              {i}:{c}
            </span>
          ))}
        </b>
      </div>
      <table className="stats-table">
        <thead>
          <tr>
            <th>뷰</th>
            <th>가시 메시릿</th>
            <th>삼각형</th>
          </tr>
        </thead>
        <tbody>
          {VIEW_NAMES.map((name, v) => (
            <tr key={name} className={st.visibleMeshlets[v] ? '' : 'muted'}>
              <td>{name}</td>
              <td>{n(st.visibleMeshlets[v] ?? 0)}</td>
              <td>{n(st.viewTriangles[v] ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {st.overflow > 0 && <div className="stats-warn">가시 목록 용량 초과 {n(st.overflow)}</div>}
      <div className="stats-foot muted">GPU 카운터 비동기 readback {n(st.gpuReadbackFrames)}회</div>
    </div>
  );
}

export function LoadingOverlay() {
  const l = useScene((s) => s.loading);
  if (l.finished && l.total > 0) return null;
  return (
    <div className="loading-panel" role="status" aria-live="polite">
      <div className="loading-text">
        작품 메시 생성 중 {Math.round(l.progress * 100)}%{' '}
        <span className="muted">
          ({l.done}/{l.total || 24}
          {l.backend ? ` · ${l.backend}` : ''})
        </span>
      </div>
      <div className="loading-bar">
        <div style={{ width: `${Math.round(l.progress * 100)}%` }} />
      </div>
      <div className="muted small">가벼운 LOD부터 먼저 나타나고, 가까이 가면 점점 정밀해집니다.</div>
    </div>
  );
}

export function ViewerPanel() {
  const focus = useScene((s) => s.focus);
  const artId = useScene((s) => {
    const o = s.focus ? s.objects[s.focus] : undefined;
    return o?.kind === 'artwork' ? o.artwork.artworkId : -1;
  });
  const featured = useScene((s) => {
    const o = s.focus ? s.objects[s.focus] : undefined;
    return o?.kind === 'artwork' ? o.artwork.featured : false;
  });
  const art = artId >= 0 ? ARTWORKS[artId] : undefined;
  return (
    <div className="viewer-panel">
      {art && focus ? (
        <div className="viewer-card">
          <div className="viewer-eyebrow">{featured ? '「결」 연작' : '원데이 클래스 수강생 작품'}</div>
          <h2>{featured ? `「${art.title}」` : `「${art.title}」을 따라 만든 작품`}</h2>
          <p className="viewer-meta">{featured ? art.material : '석고, 채색'}</p>
          <p>{featured ? art.description : '수강생이 클래스에서 작가의 형태를 작게 깎아 본 작품입니다.'}</p>
        </div>
      ) : (
        <div className="viewer-card">
          <div className="viewer-eyebrow">3D 감상실</div>
          <h2>「결」 연작 6점</h2>
          <p>작품을 누르면 그 앞으로 다가갑니다.</p>
        </div>
      )}
      <ul className="viewer-help">
        <li>W A S D / 방향키 — 이동 (Q·E 아래·위, Shift 빠르게)</li>
        <li>휠 — 앞·뒤로 이동</li>
        <li>오른쪽 버튼 드래그 — 둘러보기</li>
        <li>작품 클릭 — 작품 앞으로</li>
      </ul>
    </div>
  );
}

/** 감상 모드: 작품 바로가기 막대 */
export function WorkBar() {
  const store = useSceneStore();
  const focus = useScene((s) => s.focus);
  const go = (target: string) => store.set((s) => ({ ...s, focusRequest: { target, nonce: (s.focusRequest?.nonce ?? 0) + 1 } }));
  return (
    <nav className="work-bar" aria-label="작품 바로가기">
      <button type="button" className={focus === null ? 'on' : ''} onClick={() => go('overview')}>
        전체 보기
      </button>
      {ARTWORKS.map((a) => (
        <button key={a.id} type="button" className={focus === `art-${a.id}` ? 'on' : ''} onClick={() => go(`art-${a.id}`)}>
          「{a.title}」
        </button>
      ))}
    </nav>
  );
}
