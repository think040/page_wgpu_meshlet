// wasm/*.wat → public/wasm/*.wasm (wabt, SIMD on, relaxed SIMD off)
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initWabt from 'wabt';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'wasm');
const outDir = path.join(root, 'public', 'wasm');

const wabt = await initWabt();
await mkdir(outDir, { recursive: true });

const files = (await readdir(srcDir).catch(() => [])).filter((f) => f.endsWith('.wat'));
if (files.length === 0) {
  console.log('[build:wasm] wasm/ 에 .wat 파일 없음 — 건너뜀');
}
let failed = false;
for (const file of files) {
  // 문자열로 넘기면 비ASCII(한글 주석)가 깨지므로 UTF-8 바이트 그대로 넘긴다
  const src = new Uint8Array(await readFile(path.join(srcDir, file)));
  try {
    const mod = wabt.parseWat(file, src, { simd: true, relaxed_simd: false });
    mod.resolveNames();
    mod.validate({ simd: true });
    const { buffer } = mod.toBinary({ log: false, write_debug_names: true });
    const out = path.join(outDir, file.replace(/\.wat$/, '.wasm'));
    await writeFile(out, buffer);
    console.log(`[build:wasm] ${file} → public/wasm/${path.basename(out)} (${buffer.length} B)`);
    mod.destroy();
  } catch (err) {
    failed = true;
    console.error(`[build:wasm] ${file} 변환 실패:\n${err instanceof Error ? err.message : err}`);
  }
}
if (failed) process.exit(1);
