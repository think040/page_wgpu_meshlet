// [C0] 인스턴스별 LOD 선택 — 프레임당 1회, 메인 카메라(frame.cullEye) 기준.
// 결과는 모든 뷰(메인·반사·그림자)가 공유한다 → 뷰마다 LOD가 달라질 수 없다.

@group(0) @binding(0) var<uniform> frame : Frame;
@group(0) @binding(1) var<storage, read> instances : array<Instance>;
@group(0) @binding(2) var<storage, read> lods : array<ArtworkLod>;
@group(0) @binding(3) var<storage, read_write> instanceLod : array<u32>;
@group(0) @binding(4) var<storage, read_write> counters : Counters;

const LOCAL_RADIUS : f32 = 1.7320508; // 작품 로컬 영역 [-1,1]³의 외접구

// 원하는 LOD가 아직 로드되지 않았으면 가장 가까운 로드된 LOD(거친 쪽 우선)
fn pickAvailable(artwork : u32, want : u32) -> u32 {
  for (var d = 0u; d < 4u; d++) {
    let coarser = want + d;
    if (coarser < 4u && lods[artwork * 4u + coarser].available != 0u) {
      return coarser;
    }
    if (d <= want) {
      let finer = want - d;
      if (lods[artwork * 4u + finer].available != 0u) {
        return finer;
      }
    }
  }
  return INVALID;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= frame.instanceCount) {
    return;
  }
  let inst = instances[i];
  if ((inst.flags & 1u) == 0u) {
    instanceLod[i] = INVALID;
    return;
  }
  var want = 0u;
  if (inst.lodForce >= 0) {
    want = u32(inst.lodForce);
  } else if (frame.lodForce >= 0) {
    want = u32(frame.lodForce);
  } else {
    let center = (inst.model * vec4f(0.0, 0.0, 0.0, 1.0)).xyz;
    let radius = LOCAL_RADIUS * inst.material.z;
    let d = distance(center, frame.cullEye.xyz) / max(radius, 1e-4) * exp2(frame.lodParams.w);
    want = select(0u, 1u, d > frame.lodParams.x) + select(0u, 1u, d > frame.lodParams.y) + select(0u, 1u, d > frame.lodParams.z);
  }
  let lod = pickAvailable(inst.artwork, min(want, 3u));
  instanceLod[i] = lod;
  if (lod == INVALID) {
    return;
  }
  let L = lods[inst.artwork * 4u + lod];
  atomicAdd(&counters.lodInstances[lod], 1u);
  atomicAdd(&counters.selectedMeshlets, L.meshletCount);
  atomicAdd(&counters.selectedTriangles, L.triCount);
}
