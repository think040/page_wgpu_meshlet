'use client';
// Inspector용 기본 입력 컨트롤: 숫자, 슬라이더, 색, 체크박스, 드롭다운, Vec3, 접이식 섹션.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { SceneStore } from '../store/sceneStore';
import { useStore } from '../store/sceneStore';
import type { SceneState } from '../store/sceneStore';

export const StoreContext = createContext<SceneStore | null>(null);

export function useSceneStore(): SceneStore {
  const s = useContext(StoreContext);
  if (!s) throw new Error('StoreContext 없음');
  return s;
}

export function useScene<R>(selector: (s: SceneState) => R): R {
  return useStore(useSceneStore(), selector);
}

const fmt = (v: number, digits: number) => {
  const s = v.toFixed(digits);
  return s === `-${(0).toFixed(digits)}` ? (0).toFixed(digits) : s;
};

export function NumberField({
  value,
  onChange,
  step = 0.1,
  digits = 2,
  min,
  max,
  label,
  readOnly,
}: {
  value: number;
  onChange?: (v: number) => void;
  step?: number;
  digits?: number;
  min?: number;
  max?: number;
  label?: string;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? fmt(value, digits);
  const commit = (text: string) => {
    const v = Number.parseFloat(text);
    if (!Number.isFinite(v)) return;
    let c = v;
    if (min !== undefined) c = Math.max(min, c);
    if (max !== undefined) c = Math.min(max, c);
    onChange?.(c);
  };
  return (
    <label className="ctl-number">
      {label && <span className="ctl-axis">{label}</span>}
      <input
        type="number"
        value={shown}
        step={step}
        readOnly={readOnly}
        onFocus={() => setDraft(fmt(value, digits))}
        onBlur={() => setDraft(null)}
        onChange={(e) => {
          setDraft(e.target.value);
          commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

export function Vec3Field({
  value,
  onChange,
  step = 0.1,
  digits = 2,
  min,
}: {
  value: readonly [number, number, number];
  onChange: (v: [number, number, number]) => void;
  step?: number;
  digits?: number;
  min?: number;
}) {
  return (
    <div className="ctl-vec3">
      {(['X', 'Y', 'Z'] as const).map((axis, i) => (
        <NumberField
          key={axis}
          label={axis}
          value={value[i]!}
          step={step}
          digits={digits}
          min={min}
          onChange={(v) => {
            const next = [...value] as [number, number, number];
            next[i] = v;
            onChange(next);
          }}
        />
      ))}
    </div>
  );
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 0.01,
  digits = 2,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  digits?: number;
}) {
  return (
    <div className="ctl-slider">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <NumberField value={value} onChange={onChange} step={step} digits={digits} min={min} max={max} />
    </div>
  );
}

const toHex = (c: readonly [number, number, number]) =>
  '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
const fromHex = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255,
];

export function ColorField({ value, onChange }: { value: readonly [number, number, number]; onChange: (v: [number, number, number]) => void }) {
  return (
    <div className="ctl-color">
      <input type="color" value={toHex(value)} onChange={(e) => onChange(fromHex(e.target.value))} />
      <span>{toHex(value)}</span>
    </div>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="ctl-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label && <span>{label}</span>}
    </label>
  );
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (v: T) => void;
}) {
  return (
    <select
      className="ctl-select"
      value={String(value)}
      onChange={(e) => {
        const hit = options.find(([v]) => String(v) === e.target.value);
        if (hit) onChange(hit[0]);
      }}
    >
      {options.map(([v, label]) => (
        <option key={String(v)} value={String(v)}>
          {label}
        </option>
      ))}
    </select>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="insp-row">
      <span className="insp-label">{label}</span>
      <div className="insp-value">{children}</div>
    </div>
  );
}

export function Foldout({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="foldout">
      <button type="button" className="foldout-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="foldout-arrow">{open ? '▾' : '▸'}</span>
        {title}
      </button>
      {open && <div className="foldout-body">{children}</div>}
    </section>
  );
}

/** 브라우저에서만 렌더(SSR과 클라이언트 값이 다를 수 있는 부분) */
export function ClientOnly({ children }: { children: ReactNode }) {
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(true), []);
  return ok ? <>{children}</> : null;
}
