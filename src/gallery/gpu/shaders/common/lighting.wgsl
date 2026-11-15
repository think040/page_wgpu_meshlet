// 포워드 셰이딩: Directional / Spot / Point, 섀도 맵(비교 샘플러 + PCF).
// 필요 바인딩(group 3): 라이트 목록, 섀도 맵 3종, 비교 샘플러. frame(Frame)은 각 셰이더에서 선언한다.

@group(3) @binding(0) var<storage, read> lights : array<Light>;
@group(3) @binding(1) var shadowDir : texture_depth_2d;
@group(3) @binding(2) var shadowSpot : texture_depth_2d;
@group(3) @binding(3) var shadowPoint : texture_depth_cube;
@group(3) @binding(4) var shadowSampler : sampler_comparison;

const PI : f32 = 3.14159265;

fn pcf2D(useSpot : bool, uv : vec2f, refDepth : f32, texel : f32) -> f32 {
  var sum = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let o = vec2f(f32(x), f32(y)) * texel;
      if (useSpot) {
        sum += textureSampleCompareLevel(shadowSpot, shadowSampler, uv + o, refDepth);
      } else {
        sum += textureSampleCompareLevel(shadowDir, shadowSampler, uv + o, refDepth);
      }
    }
  }
  return sum / 9.0;
}

fn shadowFactor(L : Light, P : vec3f, N : vec3f) -> f32 {
  if (L.shadow.x < 0.5) {
    return 1.0;
  }
  let kind = u32(L.position.w);
  let biased = P + N * L.shadow.z;
  if (kind == 2u) {
    // 큐브 섀도 맵: 지배 축 거리로 투영 깊이를 복원해 비교
    let toFrag = biased - L.position.xyz;
    let d = max(abs(toFrag.x), max(abs(toFrag.y), abs(toFrag.z)));
    let n = L.spot.z;
    let f = L.spot.w;
    let depth = f / (f - n) - (n * f) / ((f - n) * d);
    let refDepth = depth - L.shadow.y;
    let dir = toFrag / max(length(toFrag), 1e-5);
    let up = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(dir.y) > 0.9);
    let t1 = normalize(cross(dir, up));
    let t2 = cross(dir, t1);
    let r = 2.0 * L.shadow.w;
    var sum = 0.0;
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let sd = dir + (t1 * f32(x) + t2 * f32(y)) * r;
        sum += textureSampleCompareLevel(shadowPoint, shadowSampler, sd, refDepth);
      }
    }
    return sum / 9.0;
  }
  let clip = L.viewProj * vec4f(biased, 1.0);
  let ndc = clip.xyz / clip.w;
  let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  if (clip.w <= 0.0 || any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || ndc.z > 1.0) {
    return 1.0;
  }
  return pcf2D(kind == 1u, uv, ndc.z - L.shadow.y, L.shadow.w);
}

fn shade(albedo : vec3f, roughIn : f32, metal : f32, P : vec3f, N : vec3f, V : vec3f, ambient : f32) -> vec3f {
  let rough = clamp(roughIn, 0.04, 1.0);
  let F0 = mix(vec3f(0.04), albedo, metal);
  let NdotV = max(dot(N, V), 1e-4);
  // 반구 앰비언트 + 금속의 약한 환경 반사 근사
  var color = albedo * (1.0 - metal) * ambient * (0.65 + 0.35 * N.y) + F0 * ambient * 0.6;
  for (var i = 0u; i < frame.lightCount; i++) {
    let L = lights[i];
    if (L.color.w < 0.5) {
      continue;
    }
    let kind = u32(L.position.w);
    var Ldir : vec3f;
    var atten = 1.0;
    if (kind == 0u) {
      Ldir = -normalize(L.direction.xyz);
    } else {
      let d = L.position.xyz - P;
      let dist = length(d);
      Ldir = d / max(dist, 1e-5);
      let x = dist / max(L.direction.w, 1e-3);
      let win = clamp(1.0 - x * x * x * x, 0.0, 1.0);
      atten = win * win / (dist * dist + 0.01);
      if (kind == 1u) {
        let cd = dot(-Ldir, normalize(L.direction.xyz));
        atten *= smoothstep(L.spot.x, L.spot.y, cd);
      }
    }
    let NdotL = dot(N, Ldir);
    if (NdotL <= 0.0 || atten <= 0.0) {
      continue;
    }
    let sh = shadowFactor(L, P, N);
    let H = normalize(V + Ldir);
    let NdotH = max(dot(N, H), 0.0);
    let VdotH = max(dot(V, H), 0.0);
    let a = rough * rough;
    let a2 = a * a;
    let dd = NdotH * NdotH * (a2 - 1.0) + 1.0;
    let D = a2 / (PI * dd * dd);
    let k = (rough + 1.0) * (rough + 1.0) / 8.0;
    let G = (NdotV / (NdotV * (1.0 - k) + k)) * (NdotL / (NdotL * (1.0 - k) + k));
    let F = F0 + (1.0 - F0) * pow(1.0 - VdotH, 5.0);
    let spec = D * G * F / (4.0 * NdotV * NdotL + 1e-4);
    let kd = (1.0 - F) * (1.0 - metal);
    color += (kd * albedo / PI + spec) * L.color.rgb * NdotL * atten * sh;
  }
  return color;
}
