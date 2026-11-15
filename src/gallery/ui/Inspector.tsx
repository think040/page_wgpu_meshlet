'use client';
// 우측 Inspector: 선택한 오브젝트의 컴포넌트를 접이식 섹션으로 표시(Unity 방식).
// 각 필드는 자신이 쓰는 값만 구독한다 → 슬라이더 조작이 캔버스나 다른 패널을 다시 렌더링하지 않는다.

import { useRef } from 'react';
import { quatFromEuler, quatToEuler, type Vec3 } from '../math/math';
import { statsStore, useStore, type ArtworkObject, type CameraObject, type FloorObject, type LightObject, type RenderSettings, type SceneObject } from '../store/sceneStore';
import { Checkbox, ColorField, Foldout, NumberField, Row, Select, Slider, useScene, useSceneStore, Vec3Field } from './controls';
import { RENDER_SETTINGS_ID } from './Hierarchy';

function useObject<T extends SceneObject>(id: string): T | undefined {
  return useScene((s) => s.objects[id] as T | undefined);
}

function TransformSection({ id, allowScale }: { id: string; allowScale: boolean }) {
  const store = useSceneStore();
  const t = useScene((s) => s.objects[id]!.transform);
  // 오일러 편집값 캐시: 쿼터니언 → 오일러 변환이 다른 해로 튀는 것을 막는다
  const euler = useRef<{ q: readonly number[]; e: Vec3 } | null>(null);
  if (!euler.current || euler.current.q !== t.rotation) euler.current = { q: t.rotation, e: quatToEuler(t.rotation) };
  const e = euler.current.e;
  return (
    <Foldout title="Transform">
      <Row label="위치">
        <Vec3Field value={t.position} onChange={(v) => store.setTransform(id, { position: v })} />
      </Row>
      <Row label="회전(°)">
        <Vec3Field
          value={e}
          step={1}
          digits={1}
          onChange={(v) => {
            const q = quatFromEuler(v);
            euler.current = { q, e: v };
            store.setTransform(id, { rotation: q });
          }}
        />
      </Row>
      {allowScale && (
        <Row label="크기">
          <Vec3Field value={t.scale} step={0.05} digits={3} min={0.001} onChange={(v) => store.setTransform(id, { scale: v })} />
        </Row>
      )}
    </Foldout>
  );
}

function CameraSection({ id }: { id: string }) {
  const store = useSceneStore();
  const cam = useObject<CameraObject>(id)!.camera;
  const set = (p: Partial<CameraObject['camera']>) => store.updateObject<CameraObject>(id, (o) => ({ ...o, camera: { ...o.camera, ...p } }));
  return (
    <Foldout title="Camera">
      <Row label="FOV(°)">
        <Slider value={cam.fov} min={20} max={100} step={1} digits={0} onChange={(v) => set({ fov: v })} />
      </Row>
      <Row label="Near">
        <NumberField value={cam.near} step={0.01} digits={3} min={0.001} onChange={(v) => set({ near: Math.min(v, cam.far - 0.01) })} />
      </Row>
      <Row label="Far">
        <NumberField value={cam.far} step={1} digits={1} min={0.1} onChange={(v) => set({ far: Math.max(v, cam.near + 0.01) })} />
      </Row>
    </Foldout>
  );
}

function LightSection({ id }: { id: string }) {
  const store = useSceneStore();
  const L = useObject<LightObject>(id)!.light;
  const set = (p: Partial<LightObject['light']>) => store.updateObject<LightObject>(id, (o) => ({ ...o, light: { ...o.light, ...p } }));
  return (
    <>
      <Foldout title={`Light (${L.type === 'directional' ? 'Directional' : L.type === 'spot' ? 'Spot' : 'Point'})`}>
        <Row label="색">
          <ColorField value={L.color} onChange={(v) => set({ color: v })} />
        </Row>
        <Row label="세기">
          <Slider value={L.intensity} min={0} max={L.type === 'directional' ? 8 : 120} step={0.1} digits={1} onChange={(v) => set({ intensity: v })} />
        </Row>
        {L.type !== 'directional' && (
          <Row label="범위">
            <Slider value={L.range} min={0.5} max={40} step={0.1} digits={1} onChange={(v) => set({ range: v })} />
          </Row>
        )}
        {L.type === 'spot' && (
          <>
            <Row label="Spot 각도(°)">
              <Slider value={L.spotAngle} min={5} max={150} step={1} digits={0} onChange={(v) => set({ spotAngle: v })} />
            </Row>
            <Row label="경계 부드러움">
              <Slider value={L.spotBlend} min={0} max={1} step={0.01} onChange={(v) => set({ spotBlend: v })} />
            </Row>
          </>
        )}
      </Foldout>
      <Foldout title="Shadow">
        <Row label="그림자">
          <Checkbox checked={L.castShadow} onChange={(v) => set({ castShadow: v })} />
        </Row>
        <Row label="깊이 바이어스">
          <Slider value={L.shadowBias} min={0} max={0.02} step={0.0001} digits={4} onChange={(v) => set({ shadowBias: v })} />
        </Row>
        <Row label="노멀 바이어스">
          <Slider value={L.shadowNormalBias} min={0} max={0.2} step={0.001} digits={3} onChange={(v) => set({ shadowNormalBias: v })} />
        </Row>
        <Row label="섀도 맵 해상도">
          <Select
            value={L.shadowMapSize}
            options={[
              [256, '256'],
              [512, '512'],
              [1024, '1024'],
              [2048, '2048'],
              [4096, '4096'],
            ]}
            onChange={(v) => set({ shadowMapSize: v })}
          />
        </Row>
      </Foldout>
    </>
  );
}

function ArtworkSection({ id }: { id: string }) {
  const store = useSceneStore();
  const A = useObject<ArtworkObject>(id)!.artwork;
  const info = useStore(statsStore, (s) => s.lodInfo[A.artworkId]!);
  const set = (p: Partial<ArtworkObject['artwork']>) => store.updateObject<ArtworkObject>(id, (o) => ({ ...o, artwork: { ...o.artwork, ...p } }));
  return (
    <>
      <Foldout title="Material">
        <Row label="기본색">
          <ColorField value={A.color} onChange={(v) => set({ color: v })} />
        </Row>
        <Row label="거칠기">
          <Slider value={A.roughness} min={0.04} max={1} onChange={(v) => set({ roughness: v })} />
        </Row>
        <Row label="금속성">
          <Slider value={A.metallic} min={0} max={1} onChange={(v) => set({ metallic: v })} />
        </Row>
      </Foldout>
      <Foldout title="Meshlet LOD">
        <Row label="LOD 강제">
          <Select
            value={A.lodForce}
            options={[
              [-1, '자동'],
              [0, 'LOD0 (256³)'],
              [1, 'LOD1 (128³)'],
              [2, 'LOD2 (64³)'],
              [3, 'LOD3 (32³)'],
            ]}
            onChange={(v) => set({ lodForce: v })}
          />
        </Row>
        <table className="insp-table">
          <thead>
            <tr>
              <th>LOD</th>
              <th>메시릿</th>
              <th>삼각형</th>
              <th>정점</th>
            </tr>
          </thead>
          <tbody>
            {info.map((r, lod) => (
              <tr key={lod}>
                <td>{lod}</td>
                <td>{r ? r.meshlets.toLocaleString() : '…'}</td>
                <td>{r ? r.triangles.toLocaleString() : '…'}</td>
                <td>{r ? r.vertices.toLocaleString() : '…'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Foldout>
    </>
  );
}

function FloorSection({ id }: { id: string }) {
  const store = useSceneStore();
  const F = useObject<FloorObject>(id)!.floor;
  const set = (p: Partial<FloorObject['floor']>) => store.updateObject<FloorObject>(id, (o) => ({ ...o, floor: { ...o.floor, ...p } }));
  return (
    <Foldout title="Floor">
      <Row label="반사">
        <Checkbox checked={F.reflection} onChange={(v) => set({ reflection: v })} />
      </Row>
      <Row label="반사 강도">
        <Slider value={F.reflectionStrength} min={0} max={1} onChange={(v) => set({ reflectionStrength: v })} />
      </Row>
    </Foldout>
  );
}

export function RenderSettingsPanel() {
  const store = useSceneStore();
  const s = useScene((st) => st.settings);
  const set = (p: Partial<RenderSettings>) => store.updateSettings(p);
  const setPass = (k: keyof RenderSettings['passes'], v: boolean) => set({ passes: { ...s.passes, [k]: v } });
  return (
    <>
      <Foldout title="표시">
        <Row label="표시 모드">
          <Select
            value={s.displayMode}
            options={[
              ['shaded', '기본 셰이딩'],
              ['meshlet', '메시릿별 색'],
              ['lod', 'LOD별 색'],
            ]}
            onChange={(v) => set({ displayMode: v })}
          />
        </Row>
        <Row label="Wireframe">
          <Checkbox checked={s.wireframe} onChange={(v) => set({ wireframe: v })} />
        </Row>
        <Row label="바운딩 스피어">
          <Checkbox checked={s.showBoundingSpheres} onChange={(v) => set({ showBoundingSpheres: v })} label="선택한 작품" />
        </Row>
        <Row label="카메라">
          <Select
            value={s.activeCamera}
            options={[
              ['main', '메인 카메라'],
              ['debug', '디버그 카메라'],
            ]}
            onChange={(v) => set({ activeCamera: v })}
          />
        </Row>
      </Foldout>
      <Foldout title="컬링">
        <Row label="프러스텀">
          <Checkbox checked={s.frustumCulling} onChange={(v) => set({ frustumCulling: v })} />
        </Row>
        <Row label="노멀 콘">
          <Checkbox checked={s.coneCulling} onChange={(v) => set({ coneCulling: v })} />
        </Row>
        <Row label="컬링 고정">
          <Checkbox checked={s.freezeCulling} onChange={(v) => set({ freezeCulling: v })} label="freeze" />
        </Row>
      </Foldout>
      <Foldout title="Dynamic LOD">
        {(['LOD0→1', 'LOD1→2', 'LOD2→3'] as const).map((label, i) => (
          <Row key={label} label={`${label} 거리`}>
            <Slider
              value={s.lodDistances[i]!}
              min={0.5}
              max={60}
              step={0.5}
              digits={1}
              onChange={(v) => {
                const d = [...s.lodDistances] as [number, number, number];
                d[i] = v;
                for (let k = i + 1; k < 3; k++) d[k] = Math.max(d[k]!, d[k - 1]!);
                for (let k = i - 1; k >= 0; k--) d[k] = Math.min(d[k]!, d[k + 1]!);
                set({ lodDistances: d });
              }}
            />
          </Row>
        ))}
        <Row label="LOD 바이어스">
          <Slider value={s.lodBias} min={-3} max={3} step={0.1} digits={1} onChange={(v) => set({ lodBias: v })} />
        </Row>
        <Row label="LOD 강제(전역)">
          <Select
            value={s.forceLod}
            options={[
              [-1, '자동'],
              [0, 'LOD0'],
              [1, 'LOD1'],
              [2, 'LOD2'],
              [3, 'LOD3'],
            ]}
            onChange={(v) => set({ forceLod: v })}
          />
        </Row>
        <p className="insp-note">거리 = 카메라 거리 ÷ 인스턴스 반경(크기 반영)</p>
      </Foldout>
      <Foldout title="패스">
        <Row label="메인">
          <Checkbox checked={s.passes.main} onChange={(v) => setPass('main', v)} />
        </Row>
        <Row label="바닥 반사">
          <Checkbox checked={s.passes.reflection} onChange={(v) => setPass('reflection', v)} />
        </Row>
        <Row label="그림자 Directional">
          <Checkbox checked={s.passes.shadowDirectional} onChange={(v) => setPass('shadowDirectional', v)} />
        </Row>
        <Row label="그림자 Spot">
          <Checkbox checked={s.passes.shadowSpot} onChange={(v) => setPass('shadowSpot', v)} />
        </Row>
        <Row label="그림자 Point(6면)">
          <Checkbox checked={s.passes.shadowPoint} onChange={(v) => setPass('shadowPoint', v)} />
        </Row>
      </Foldout>
      <Foldout title="해상도·안티앨리어싱">
        <Row label="MSAA 4x">
          <Checkbox checked={s.msaa} onChange={(v) => set({ msaa: v })} />
        </Row>
        <Row label="렌더 스케일">
          <Slider value={s.renderScale} min={0.5} max={2} step={0.05} onChange={(v) => set({ renderScale: v })} />
        </Row>
        <Row label="반사 해상도 비율">
          <Slider value={s.reflectionScale} min={0.25} max={1} step={0.05} onChange={(v) => set({ reflectionScale: v })} />
        </Row>
      </Foldout>
    </>
  );
}

function ObjectHeader({ id }: { id: string }) {
  const store = useSceneStore();
  const name = useScene((s) => s.objects[id]!.name);
  const active = useScene((s) => s.objects[id]!.active);
  const kind = useScene((s) => s.objects[id]!.kind);
  const kindLabel: Record<string, string> = { camera: '카메라', light: '라이트', artwork: '작품', group: '그룹', floor: '바닥', room: '방' };
  return (
    <div className="insp-header">
      <Checkbox checked={active} onChange={(v) => store.updateObject(id, (o) => ({ ...o, active: v }))} />
      <div>
        <div className="insp-name">{name}</div>
        <div className="insp-kind">{kindLabel[kind]}</div>
      </div>
    </div>
  );
}

export function Inspector() {
  const selection = useScene((s) => s.selection);
  const kind = useScene((s) => (s.selection ? s.objects[s.selection]?.kind : undefined));
  return (
    <aside className="dev-panel inspector" aria-label="Inspector">
      <div className="panel-title">Inspector</div>
      <div className="panel-scroll">
        {(!selection || selection === RENDER_SETTINGS_ID || !kind) && (
          <>
            {selection !== RENDER_SETTINGS_ID && <p className="insp-note">선택된 오브젝트가 없습니다. 화면이나 Hierarchy에서 선택하세요.</p>}
            <div className="insp-name pad">렌더 설정 (전역)</div>
            <RenderSettingsPanel />
          </>
        )}
        {selection && kind && (
          <>
            <ObjectHeader id={selection} />
            <TransformSection key={selection} id={selection} allowScale={kind !== 'light' && kind !== 'camera'} />
            {kind === 'camera' && <CameraSection id={selection} />}
            {kind === 'light' && <LightSection id={selection} />}
            {kind === 'artwork' && <ArtworkSection id={selection} />}
            {kind === 'floor' && <FloorSection id={selection} />}
          </>
        )}
      </div>
    </aside>
  );
}
