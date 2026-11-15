// 디버그 오버레이: 프러스텀 선, 바운딩 스피어, 변환 기즈모. 정점 = 월드 위치 + sRGB 색.

@group(0) @binding(0) var<uniform> view : View;

struct OOut {
  @builtin(position) clip : vec4f,
  @location(0) color : vec4f,
}

@vertex
fn vs_overlay(@location(0) pos : vec3f, @location(1) color : vec4f) -> OOut {
  var out : OOut;
  out.clip = view.viewProj * vec4f(pos, 1.0);
  out.color = color;
  return out;
}

@fragment
fn fs_overlay(in : OOut) -> @location(0) vec4f {
  return in.color;
}
