// 정적 메시(방·바닥·좌대·선반·표식) — 일반 정점 버퍼 파이프라인. 그림자·반사 패스에도 포함된다.

@group(0) @binding(0) var<uniform> view : View;
@group(0) @binding(1) var<uniform> frame : Frame;
@group(1) @binding(0) var<storage, read> objects : array<Instance>;
@group(2) @binding(0) var reflectionTex : texture_2d<f32>;
@group(2) @binding(1) var reflectionSampler : sampler;

struct SOut {
  @builtin(position) clip : vec4f,
  @location(0) worldPos : vec3f,
  @location(1) normal : vec3f,
  @location(2) localPos : vec3f,
  @location(3) @interpolate(flat) obj : u32,
}

@vertex
fn vs_static(@location(0) pos : vec3f, @location(1) nrm : vec3f, @builtin(instance_index) ii : u32) -> SOut {
  let O = objects[ii];
  let world = O.model * vec4f(pos, 1.0);
  var out : SOut;
  out.clip = view.viewProj * world;
  out.worldPos = world.xyz;
  out.normal = O.normalMat * nrm;
  out.localPos = pos;
  out.obj = ii;
  return out;
}

fn staticAlbedo(code : u32, base : vec3f, p : vec3f, wp : vec3f) -> vec3f {
  switch (code) {
    case 101u: { // 벽: 은은한 석회 질감
      return base * (0.94 + 0.06 * valueNoise(wp * 2.5));
    }
    case 103u: { // 선반: 나뭇결
      let g = sin((wp.x * 9.0 + valueNoise(wp * vec3f(1.0, 6.0, 6.0)) * 4.0)) * 0.5 + 0.5;
      return base * (0.82 + 0.18 * g);
    }
    default: { return base; }
  }
}

fn finish(color : vec3f) -> vec4f {
  if (view.flags.z != 0u) {
    return vec4f(color, 1.0);
  }
  return vec4f(tonemap(color, frame.exposure), 1.0);
}

@fragment
fn fs_static(in : SOut) -> @location(0) vec4f {
  if (view.flags.z != 0u && in.worldPos.y < frame.floorY - 0.002) {
    discard;
  }
  let O = objects[in.obj];
  if ((O.flags & 8u) != 0u) {
    // 표식(라이트·카메라): 조명 없이 발광
    var c = O.color.rgb;
    if ((O.flags & 2u) != 0u) { c = mix(c, vec3f(1.0, 0.55, 0.1), 0.6); }
    return vec4f(pow(c, vec3f(1.0 / 2.2)), 1.0);
  }
  let N = normalize(in.normal);
  let V = normalize(view.eye.xyz - in.worldPos);
  let albedo = staticAlbedo(O.artwork, O.color.rgb, in.localPos, in.worldPos);
  var color = shade(albedo, O.material.x, O.material.y, in.worldPos, N, V, frame.ambient);
  if ((O.flags & 2u) != 0u) {
    color += vec3f(1.0, 0.5, 0.1) * 0.12;
  }
  return finish(color);
}

@fragment
fn fs_floor(in : SOut) -> @location(0) vec4f {
  // 반사 텍스처는 화면 좌표로 샘플링한다(반사 카메라는 메인과 같은 투영을 쓴다).
  let uv = in.clip.xy / frame.resolution;
  let refl = textureSampleLevel(reflectionTex, reflectionSampler, uv, 0.0).rgb;
  let O = objects[in.obj];
  let N = vec3f(0.0, 1.0, 0.0);
  let V = normalize(view.eye.xyz - in.worldPos);
  // 연마한 콘크리트 타일
  let tile = fract(in.worldPos.xz / 1.5);
  let seam = 1.0 - (1.0 - smoothstep(0.0, 0.012, tile.x) * smoothstep(1.0, 0.988, tile.x))
                 - (1.0 - smoothstep(0.0, 0.012, tile.y) * smoothstep(1.0, 0.988, tile.y));
  var albedo = O.color.rgb * (0.9 + 0.12 * valueNoise(in.worldPos * 3.0) + 0.05 * hash3f(in.worldPos * 160.0));
  albedo *= mix(0.7, 1.0, clamp(seam, 0.0, 1.0));
  var color = shade(albedo, O.material.x, O.material.y, in.worldPos, N, V, frame.ambient);
  if ((frame.flags & 2u) != 0u) {
    let NdotV = max(dot(N, V), 0.0);
    let fresnel = 0.04 + 0.96 * pow(1.0 - NdotV, 5.0);
    let k = clamp((0.2 + 0.8 * fresnel) * frame.reflectionStrength, 0.0, 1.0);
    color = mix(color, refl, k);
  }
  if ((O.flags & 2u) != 0u) {
    color += vec3f(1.0, 0.5, 0.1) * 0.08;
  }
  return finish(color);
}

@fragment
fn fs_static_id(in : SOut) -> @location(0) u32 {
  return objects[in.obj].objectId;
}
