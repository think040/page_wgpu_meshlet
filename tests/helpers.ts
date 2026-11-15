import type { ArtworkSdf } from '@/gallery/mesh/sdf/artworks';
import type { IndexedMesh } from '@/gallery/mesh/types';

/** 테스트용 구 SDF */
export function sphereArtwork(r = 0.73, c: [number, number, number] = [0.013, -0.021, 0.007]): ArtworkSdf {
  return {
    id: 99,
    lipschitz: 1,
    minY: c[1] - r,
    tables: () => ({}),
    program(k) {
      k.sphere(0, c[0], c[1], c[2], r);
      return 0;
    },
    evalPoint: (x, y, z) => Math.hypot(x - c[0], y - c[1], z - c[2]) - r,
  };
}

/** 닫힌 2-다양체이며 방향이 일관된지: 모든 방향 모서리 (a,b)가 정확히 한 번, 그 역 (b,a)도 정확히 한 번 */
export function checkClosedOriented(mesh: IndexedMesh): { ok: boolean; problems: number } {
  const idx = mesh.indices;
  const directed = new Map<string, number>();
  for (let t = 0; t < idx.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = idx[t + k]!;
      const b = idx[t + ((k + 1) % 3)]!;
      const key = `${a},${b}`;
      directed.set(key, (directed.get(key) ?? 0) + 1);
    }
  }
  let problems = 0;
  for (const [key, count] of directed) {
    const [a, b] = key.split(',');
    if (count !== 1 || directed.get(`${b},${a}`) !== 1) problems++;
  }
  return { ok: problems === 0, problems };
}
