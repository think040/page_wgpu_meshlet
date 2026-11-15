// .wgsl 임포트 = 파일 내용 문자열 (next.config.ts의 turbopack/webpack 규칙과 짝)
declare module '*.wgsl' {
  const source: string;
  export default source;
}
