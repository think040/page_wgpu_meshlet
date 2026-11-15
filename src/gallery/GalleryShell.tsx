'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useState } from 'react';
import { SITE } from '@/content/site';
import { createDefaultScene, MAIN_CAMERA_ID } from './scene/defaultScene';
import { SceneStore } from './store/sceneStore';
import { StoreContext, useScene, useSceneStore } from './ui/controls';
import { Hierarchy } from './ui/Hierarchy';
import { Inspector } from './ui/Inspector';
import { LoadingOverlay, StatsPanel, Toolbar, ViewerPanel, WorkBar } from './ui/Panels';
import './gallery.css';

// WebGPU 코드는 브라우저에서만 로드한다(SSR에서 navigator.gpu 접근 금지).
const GalleryCanvas = dynamic(() => import('./GalleryCanvas'), {
  ssr: false,
  loading: () => (
    <div className="gallery-message">
      <div>감상실을 준비하는 중…</div>
    </div>
  ),
});

function DevToggle() {
  const store = useSceneStore();
  const mode = useScene((s) => s.mode);
  return (
    <button
      type="button"
      className={`dev-toggle${mode === 'dev' ? ' on' : ''}`}
      onClick={() =>
        store.set((s) =>
          s.mode === 'dev'
            ? { ...s, mode: 'view', selection: null, settings: { ...s.settings, activeCamera: 'main' } }
            : { ...s, mode: 'dev', selection: s.selection ?? MAIN_CAMERA_ID },
        )
      }
      title="개발자 모드: 컬링·LOD 디버그와 Inspector"
    >
      {mode === 'dev' ? '감상 모드로' : '개발자 모드'}
    </button>
  );
}

function Layout() {
  const mode = useScene((s) => s.mode);
  const dev = mode === 'dev';
  return (
    <div className={`gallery-root${dev ? ' dev' : ''}`}>
      {dev && <Hierarchy />}
      <div className="gallery-stage">
        <GalleryCanvas />
        <div className="gallery-topbar">
          <Link href="/">← 홈으로</Link>
          {dev && <Toolbar />}
        </div>
        <DevToggle />
        <LoadingOverlay />
        {dev ? <StatsPanel /> : <ViewerPanel />}
        {!dev && <WorkBar />}
        <p className="gallery-notice">{SITE.demoNotice}</p>
      </div>
      {dev && <Inspector />}
    </div>
  );
}

export function GalleryShell() {
  // 장면 저장소는 React state 밖에 둔다 — 컴포넌트는 필요한 값만 구독
  const [store] = useState(() => new SceneStore(createDefaultScene()));
  return (
    <StoreContext.Provider value={store}>
      <Layout />
    </StoreContext.Provider>
  );
}
