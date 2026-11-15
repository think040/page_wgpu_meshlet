import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Turbopack(기본 번들러): .wgsl 파일 내용을 문자열로 export
  turbopack: {
    rules: {
      '*.wgsl': { type: 'raw' },
    },
  },
  // `next dev --webpack` / `next build --webpack` 대비
  webpack: (config) => {
    config.module.rules.push({ test: /\.wgsl$/, type: 'asset/source' });
    return config;
  },
};

export default nextConfig;
