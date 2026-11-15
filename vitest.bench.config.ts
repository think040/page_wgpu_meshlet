import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.ts';

// 성능 측정(수동 실행): npm run bench:mesh
export default mergeConfig(base, defineConfig({ test: { testTimeout: 1_200_000 } }), true);
