// .wgsl 조각들을 문자열 결합으로 합치고, 컴파일 오류 줄 번호를 원본 파일 기준으로 되돌린다.

export interface ShaderChunk {
  /** 원본 파일 경로(오류 출력용), 예: 'common/frame.wgsl' */
  name: string;
  code: string;
}

interface ChunkRange {
  name: string;
  /** 결합 결과에서 이 조각 본문이 시작하는 줄(1-based) */
  firstLine: number;
  lineCount: number;
}

export interface ComposedShader {
  label: string;
  code: string;
  ranges: readonly ChunkRange[];
}

function countLines(s: string): number {
  let n = 1;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

export function composeShader(label: string, chunks: readonly ShaderChunk[]): ComposedShader {
  const parts: string[] = [];
  const ranges: ChunkRange[] = [];
  let line = 1;
  for (const chunk of chunks) {
    const header = `// ──── ${chunk.name} ────`;
    const body = chunk.code.replace(/\r\n/g, '\n').replace(/\n+$/, '');
    parts.push(header, body);
    const bodyLines = countLines(body);
    ranges.push({ name: chunk.name, firstLine: line + 1, lineCount: bodyLines });
    line += 1 + bodyLines;
  }
  return { label, code: parts.join('\n') + '\n', ranges };
}

/** 결합 결과의 줄 번호 → 원본 파일과 줄 번호 */
export function mapComposedLine(shader: ComposedShader, line: number): { name: string; line: number } {
  for (const r of shader.ranges) {
    if (line >= r.firstLine && line < r.firstLine + r.lineCount) {
      return { name: r.name, line: line - r.firstLine + 1 };
    }
  }
  return { name: `${shader.label}(결합 헤더)`, line };
}
