// structs.wgsl을 파싱해 WGSL 정렬 규칙으로 오프셋을 계산하고 gpu/layout.ts와 대조한다.
import { describe, expect, it } from 'vitest';
import structsWgsl from '@/gallery/gpu/shaders/common/structs.wgsl';
import { LAYOUT } from '@/gallery/gpu/layout';

interface TypeInfo {
  align: number;
  size: number;
}

const roundUp = (k: number, n: number) => Math.ceil(n / k) * k;

function parseStructs(src: string) {
  const clean = src.replace(/\/\/.*$/gm, '');
  const structs = new Map<string, { fields: Array<{ name: string; type: string }> }>();
  const re = /struct\s+(\w+)\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    // 꺾쇠 안의 쉼표(array<T, N>)는 건너뛰고 최상위 쉼표로만 나눈다
    const parts: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of m[2]!) {
      if (ch === '<') depth++;
      if (ch === '>') depth--;
      if (ch === ',' && depth === 0) {
        parts.push(cur);
        cur = '';
      } else cur += ch;
    }
    parts.push(cur);
    const fields = parts
      .map((f) => f.trim())
      .filter(Boolean)
      .map((f) => {
        const [name, ...rest] = f.split(':');
        return { name: name!.trim(), type: rest.join(':').trim() };
      });
    structs.set(m[1]!, { fields });
  }
  return structs;
}

function typeInfo(t: string, structs: ReturnType<typeof parseStructs>, cache: Map<string, ReturnType<typeof layoutOf>>): TypeInfo {
  t = t.replace(/\s+/g, '');
  const scalar: Record<string, TypeInfo> = { f32: { align: 4, size: 4 }, u32: { align: 4, size: 4 }, i32: { align: 4, size: 4 } };
  if (scalar[t]) return scalar[t]!;
  const atomic = /^atomic<(\w+)>$/.exec(t);
  if (atomic) return typeInfo(atomic[1]!, structs, cache);
  const vec = /^vec([234])(?:f|u|i|<\w+>)$/.exec(t);
  if (vec) {
    const n = Number(vec[1]);
    return { align: n === 2 ? 8 : 16, size: n * 4 };
  }
  const mat = /^mat([234])x([234])f$/.exec(t);
  if (mat) {
    const cols = Number(mat[1]);
    const rows = Number(mat[2]);
    const colAlign = rows === 2 ? 8 : 16;
    return { align: colAlign, size: cols * colAlign };
  }
  const arr = /^array<(.+),(\d+)>$/.exec(t);
  if (arr) {
    const e = typeInfo(arr[1]!, structs, cache);
    const stride = roundUp(e.align, e.size);
    return { align: e.align, size: stride * Number(arr[2]) };
  }
  if (structs.has(t)) {
    const l = layoutOf(t, structs, cache);
    return { align: l.align, size: l.size };
  }
  throw new Error(`unknown type ${t}`);
}

function layoutOf(name: string, structs: ReturnType<typeof parseStructs>, cache = new Map<string, { align: number; size: number; offsets: Record<string, number> }>()) {
  const hit = cache.get(name);
  if (hit) return hit;
  const s = structs.get(name)!;
  let offset = 0;
  let align = 1;
  const offsets: Record<string, number> = {};
  for (const f of s.fields) {
    const ti = typeInfo(f.type, structs, cache);
    offset = roundUp(ti.align, offset);
    offsets[f.name] = offset;
    offset += ti.size;
    align = Math.max(align, ti.align);
  }
  const out = { align, size: roundUp(align, offset), offsets };
  cache.set(name, out);
  return out;
}

describe('GPU 구조체 레이아웃 (structs.wgsl ↔ layout.ts)', () => {
  const structs = parseStructs(structsWgsl);
  for (const [name, ts] of Object.entries(LAYOUT)) {
    it(name, () => {
      expect(structs.has(name), `${name}이 structs.wgsl에 없음`).toBe(true);
      const w = layoutOf(name, structs);
      expect(w.size).toBe(ts.size);
      expect(w.offsets).toEqual(ts.fields);
    });
  }
  it('structs.wgsl의 모든 구조체가 layout.ts에 있다', () => {
    for (const name of structs.keys()) expect(Object.keys(LAYOUT)).toContain(name);
  });
});
