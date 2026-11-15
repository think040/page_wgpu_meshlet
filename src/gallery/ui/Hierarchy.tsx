'use client';
// 좌측 Hierarchy: 카메라, 라이트, 작품, 선반 그룹(수강생 작품), 환경, 렌더 설정.

import { memo, useState } from 'react';
import { useScene, useSceneStore } from './controls';
import { DEBUG_CAMERA_ID, FLOOR_ID, LIGHT_IDS, MAIN_CAMERA_ID, ROOM_ID, SHELF_GROUP_ID } from '../scene/defaultScene';

export const RENDER_SETTINGS_ID = '__render';

const Item = memo(function Item({ id, depth = 0, icon }: { id: string; depth?: number; icon: string }) {
  const store = useSceneStore();
  const name = useScene((s) => s.objects[id]?.name ?? (id === RENDER_SETTINGS_ID ? '렌더 설정 (전역)' : id));
  const active = useScene((s) => s.objects[id]?.active ?? true);
  const selected = useScene((s) => s.selection === id);
  return (
    <button
      type="button"
      className={`hier-item${selected ? ' selected' : ''}${active ? '' : ' inactive'}`}
      style={{ paddingLeft: 10 + depth * 14 }}
      onClick={() => store.select(id)}
    >
      <span className="hier-icon">{icon}</span>
      {name}
    </button>
  );
});

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="hier-group">
      <div className="hier-title">{title}</div>
      {children}
    </div>
  );
}

export function Hierarchy() {
  const artworkIds = useScene((s) => s.order).filter((id) => id.startsWith('art-'));
  const shelfIds = useScene((s) => s.order).filter((id) => id.startsWith('shelf-'));
  const [shelfOpen, setShelfOpen] = useState(false);
  return (
    <aside className="dev-panel hierarchy" aria-label="Hierarchy">
      <div className="panel-title">Hierarchy</div>
      <div className="panel-scroll">
        <Item id={RENDER_SETTINGS_ID} icon="⚙" />
        <Group title="카메라">
          <Item id={MAIN_CAMERA_ID} icon="🎥" />
          <Item id={DEBUG_CAMERA_ID} icon="🎥" />
        </Group>
        <Group title="라이트">
          <Item id={LIGHT_IDS.directional} icon="☀" />
          <Item id={LIGHT_IDS.spot} icon="◔" />
          <Item id={LIGHT_IDS.point} icon="●" />
        </Group>
        <Group title="작품 (「결」 연작)">
          {artworkIds.map((id) => (
            <Item key={id} id={id} icon="◆" />
          ))}
        </Group>
        <Group title="선반 그룹">
          <div className="hier-row">
            <button type="button" className="hier-toggle" onClick={() => setShelfOpen(!shelfOpen)} aria-label="선반 펼치기">
              {shelfOpen ? '▾' : '▸'}
            </button>
            <Item id={SHELF_GROUP_ID} icon="▤" />
          </div>
          {shelfOpen && shelfIds.map((id) => <Item key={id} id={id} icon="◇" depth={1} />)}
        </Group>
        <Group title="환경">
          <Item id={FLOOR_ID} icon="▭" />
          <Item id={ROOM_ID} icon="⌂" />
        </Group>
      </div>
    </aside>
  );
}
