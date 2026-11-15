// [C1] 뷰별 인스턴스 컬링 — 인스턴스 바운딩 스피어 vs 뷰 프러스텀.
// 통과한 인스턴스의 (선택된 LOD) 메시릿 범위를 64개 단위 청크로 쪼개 기록하고,
// 청크 수를 dispatchWorkgroupsIndirect 인자(x)에 atomic으로 더한다.

@group(0) @binding(0) var<uniform> view : View;
@group(0) @binding(1) var<uniform> frame : Frame;
@group(0) @binding(2) var<storage, read> instances : array<Instance>;
@group(0) @binding(3) var<storage, read> lods : array<ArtworkLod>;
@group(0) @binding(4) var<storage, read> instanceLod : array<u32>;
@group(0) @binding(5) var<storage, read_write> chunks : array<Chunk>;
@group(0) @binding(6) var<storage, read_write> dispatchArgs : DispatchArgs;

const LOCAL_RADIUS : f32 = 1.7320508;

fn sphereOutside(c : vec3f, r : f32) -> bool {
  for (var p = 0u; p < 6u; p++) {
    let pl = view.planes[p];
    if (dot(pl.xyz, c) + pl.w < -r) {
      return true;
    }
  }
  return false;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= frame.instanceCount) {
    return;
  }
  let lod = instanceLod[i];
  if (lod == INVALID) {
    return;
  }
  let inst = instances[i];
  // 그림자 뷰: 그림자를 드리우지 않는 인스턴스 제외
  if (view.flags.w != 0u && (inst.flags & 4u) == 0u) {
    return;
  }
  if ((view.flags.x & 1u) != 0u) {
    let c = (inst.model * vec4f(0.0, 0.0, 0.0, 1.0)).xyz;
    if (sphereOutside(c, LOCAL_RADIUS * inst.material.z)) {
      return;
    }
  }
  let L = lods[inst.artwork * 4u + lod];
  let n = (L.meshletCount + 63u) / 64u;
  if (n == 0u) {
    return;
  }
  let base = atomicAdd(&dispatchArgs.x, n);
  for (var k = 0u; k < n; k++) {
    let idx = base + k;
    if (idx >= frame.chunkCap) {
      break; // 용량 초과 — 메시릿 단계가 idx ≥ chunkCap 워크그룹을 무시한다
    }
    chunks[idx] = Chunk(i, L.meshletOffset + k * 64u, min(64u, L.meshletCount - k * 64u), lod);
  }
}
