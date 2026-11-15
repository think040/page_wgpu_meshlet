import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    {
      // 번들러와 같게 .wgsl을 문자열로 임포트
      name: 'wgsl-raw',
      load(id) {
        if (!id.endsWith('.wgsl')) return null;
        return `export default ${JSON.stringify(readFileSync(id, 'utf8'))};`;
      },
    },
  ],
  test: {
    include: ['tests/**/*.test.ts', 'bench/**/*.bench.test.ts'],
    testTimeout: 120_000,
  },
});
