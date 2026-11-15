// 메시릿 그리기 — Mesh Shader 대체.
// drawIndirect 1회: 인스턴스 1개 = 가시 메시릿 1개, 정점 378개(126 삼각형 × 3) 고정.
// 정점 셰이더가 가시 목록에서 (인스턴스, 메시릿)을 찾아 storage buffer에서 정점·인덱스를 직접 읽는다(vertex pulling).
// 메시릿의 실제 삼각형 수를 넘는 정점은 퇴화 삼각형(SV_CullPrimitive 대체).

@group(0) @binding(0) var<uniform> view : View;
@group(0) @binding(1) var<uniform> frame : Frame;
@group(1) @binding(0) var<storage, read> vertices : array<Vertex>;
@group(1) @binding(1) var<storage, read> meshlets : array<Meshlet>;
@group(1) @binding(2) var<storage, read> vertexIndices : array<u32>;
@group(1) @binding(3) var<storage, read> primitives : array<u32>;
@group(1) @binding(4) var<storage, read> instances : array<Instance>;
@group(2) @binding(0) var<storage, read> visibleList : array<vec2u>;

struct VsOut {
  @builtin(position) clip : vec4f,
  @location(0) worldPos : vec3f,
  @location(1) normal : vec3f,
  @location(2) bary : vec3f,
  @location(3) localPos : vec3f,
  @location(4) @interpolate(flat) ids : vec4u, // 인스턴스, 전역 메시릿, LOD
}

@vertex
fn vs_main(@builtin(instance_index) ii : u32, @builtin(vertex_index) vi : u32) -> VsOut {
  var out : VsOut;
  out.clip = vec4f(0.0, 0.0, 0.0, 1.0);
  if (ii >= frame.visibleCap) {
    return out;
  }
  let e = visibleList[ii];
  let instIdx = e.x & 0xffffffu;
  let lod = e.x >> 24u;
  let m = meshlets[e.y];
  let tri = vi / 3u;
  let corner = vi % 3u;
  if (tri >= m.primCount) {
    return out; // 퇴화 삼각형: 세 꼭짓점이 모두 같은 점
  }
  let packed = primitives[m.primOffset + tri];
  let local = (packed >> (corner * 8u)) & 0xffu;
  let v = vertices[vertexIndices[m.vertOffset + local]];
  let I = instances[instIdx];
  let world = I.model * vec4f(v.pos, 1.0);
  out.clip = view.viewProj * world;
  out.worldPos = world.xyz;
  out.normal = I.normalMat * decodeOct(v.nrm);
  out.bary = vec3f(f32(corner == 0u), f32(corner == 1u), f32(corner == 2u));
  out.localPos = v.pos;
  out.ids = vec4u(instIdx, e.y, lod, 0u);
  return out;
}

fn materialAlbedo(I : Instance, p : vec3f) -> vec3f {
  var c = I.color.rgb;
  if (I.flags & 16u) != 0u {
    return c; // 선반 작품: 단색
  }
  switch (I.artwork) {
    case 2u: { // 화강암: 잔 반점
      let n = hash3f(p * 90.0);
      let n2 = valueNoise(p * 14.0);
      c *= 0.8 + 0.25 * n * n + 0.15 * n2;
      if (n > 0.985) { c = vec3f(0.18, 0.17, 0.17); }
    }
    case 3u: { // 대리석: 결
      let w = valueNoise(p * 3.0) * 2.0 + valueNoise(p * 7.0);
      let v = abs(sin((p.x * 1.5 + p.y * 2.5 + p.z) * 3.0 + w * 3.0));
      c = mix(vec3f(0.55, 0.56, 0.6), c, smoothstep(0.0, 0.18, v));
    }
    case 4u: { // 현무암: 거친 얼룩
      c *= 0.75 + 0.5 * valueNoise(p * 22.0);
    }
    case 0u: { // 석고: 아주 미세한 얼룩
      c *= 0.96 + 0.06 * valueNoise(p * 9.0);
    }
    default: {}
  }
  return c;
}

// 선 색은 픽셀마다 정하지 않는다. 픽셀 albedo로 고르면 메시릿마다 무작위인 디버그 색이나
// 화강암 반점·대리석 결처럼 밝기가 바뀌는 곳에서 밝은 선/어두운 선이 뒤바뀐다.
// - 메시릿·LOD 표시: 디버그 색은 모두 밝은 편(≥0.2)이므로 항상 어두운 선
// - 셰이딩 표시: 물체의 기본 색(I.color) 하나로 정해 물체 전체에서 같은 선 색
fn wireMix(color : vec3f, baseColor : vec3f, debugColors : bool, bary : vec3f, fw : vec3f) -> vec3f {
  let a = smoothstep(vec3f(0.0), fw * 1.1, bary);
  let edge = 1.0 - min(a.x, min(a.y, a.z));
  let dark = vec3f(0.02, 0.03, 0.05);
  let light = vec3f(0.75, 0.9, 1.0);
  let lum = dot(baseColor, vec3f(0.3, 0.6, 0.1));
  let lineColor = select(select(light, dark, lum > 0.3), dark, debugColors);
  return mix(color, lineColor, edge * 0.75);
}

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4f {
  let fw = fwidth(in.bary); // 미분은 균일 흐름에서 먼저
  if (view.flags.z != 0u && in.worldPos.y < frame.floorY - 0.002) {
    discard; // 반사 패스: 바닥 아래 제거(clip_distances 대체)
  }
  let I = instances[in.ids.x];
  let N = normalize(in.normal);
  let V = normalize(view.eye.xyz - in.worldPos);
  var albedo : vec3f;
  var rough = I.material.x;
  var metal = I.material.y;
  if (frame.displayMode == 1u) {
    albedo = hashColor(in.ids.y);
    rough = 0.7;
    metal = 0.0;
  } else if (frame.displayMode == 2u) {
    albedo = lodColor(in.ids.z);
    rough = 0.7;
    metal = 0.0;
  } else {
    albedo = materialAlbedo(I, in.localPos);
  }
  var color = shade(albedo, rough, metal, in.worldPos, N, V, frame.ambient);
  if (frame.displayMode != 0u) {
    color = max(color, albedo * 0.25); // 디버그 색은 어두운 곳에서도 구분되게
  }
  if ((I.flags & 2u) != 0u) {
    let rim = pow(1.0 - max(dot(N, V), 0.0), 2.0);
    color += vec3f(1.0, 0.5, 0.1) * (0.03 + rim * 0.7);
  }
  if (frame.wireframe != 0u) {
    color = wireMix(color, I.color.rgb, frame.displayMode != 0u, in.bary, fw);
  }
  if (view.flags.z != 0u) {
    return vec4f(color, 1.0); // 반사 텍스처는 선형 HDR
  }
  return vec4f(tonemap(color, frame.exposure), 1.0);
}

@fragment
fn fs_id(in : VsOut) -> @location(0) u32 {
  return instances[in.ids.x].objectId;
}
