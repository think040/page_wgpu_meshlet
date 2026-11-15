// 공용 함수: 노멀 복원, 해시 색, 노이즈, 톤 매핑.

fn signNotZero(v : vec2f) -> vec2f {
  return select(vec2f(-1.0), vec2f(1.0), v >= vec2f(0.0));
}

// 옥타헤드럴 노멀 복원 (TS encodeOctNormal과 짝)
fn decodeOct(p : u32) -> vec3f {
  let e = unpack2x16snorm(p);
  var n = vec3f(e, 1.0 - abs(e.x) - abs(e.y));
  if (n.z < 0.0) {
    n = vec3f((1.0 - abs(n.yx)) * signNotZero(n.xy), n.z);
  }
  return normalize(n);
}

fn hash32(x : u32) -> u32 {
  var h = x * 747796405u + 2891336453u;
  h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  return (h >> 22u) ^ h;
}

fn hashColor(id : u32) -> vec3f {
  let h = hash32(id);
  let c = vec3f(f32(h & 255u), f32((h >> 8u) & 255u), f32((h >> 16u) & 255u)) / 255.0;
  return c * 0.75 + 0.2;
}

fn lodColor(lod : u32) -> vec3f {
  switch (lod) {
    case 0u: { return vec3f(0.2, 0.85, 0.3); }   // LOD0 초록
    case 1u: { return vec3f(0.25, 0.55, 1.0); }  // LOD1 파랑
    case 2u: { return vec3f(1.0, 0.82, 0.2); }   // LOD2 노랑
    default: { return vec3f(1.0, 0.3, 0.25); }   // LOD3 빨강
  }
}

fn hash3f(p : vec3f) -> f32 {
  let q = vec3u(bitcast<u32>(i32(floor(p.x))), bitcast<u32>(i32(floor(p.y))), bitcast<u32>(i32(floor(p.z))));
  return f32(hash32(q.x ^ hash32(q.y ^ hash32(q.z)))) / 4294967295.0;
}

// 값 노이즈 (재질 무늬용)
fn valueNoise(p : vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash3f(i);
  let b = hash3f(i + vec3f(1.0, 0.0, 0.0));
  let c = hash3f(i + vec3f(0.0, 1.0, 0.0));
  let d = hash3f(i + vec3f(1.0, 1.0, 0.0));
  let e = hash3f(i + vec3f(0.0, 0.0, 1.0));
  let f1 = hash3f(i + vec3f(1.0, 0.0, 1.0));
  let g = hash3f(i + vec3f(0.0, 1.0, 1.0));
  let h = hash3f(i + vec3f(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, f1, u.x), mix(g, h, u.x), u.y), u.z);
}

// ACES 근사 + 감마 (캔버스 포맷이 비-sRGB이므로 직접 인코딩)
fn tonemap(c : vec3f, exposure : f32) -> vec3f {
  let x = c * exposure;
  let t = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
  return pow(t, vec3f(1.0 / 2.2));
}
