// [C2] 뷰별 메시릿 컬링 — Amplification Shader 역할.
// 워크그룹 1개 = 청크 1개, 스레드 1개 = 메시릿 1개.
// 프러스텀(바운딩 스피어) + 노멀 콘 백페이스 판정 후, 통과 수를 워크그룹 공유 atomic으로 모아
// 전역 atomicAdd 1회로 가시 목록에 자리를 받는다. instanceCount = 가시 메시릿 수(CPU readback 없음).

@group(0) @binding(0) var<uniform> view : View;
@group(0) @binding(1) var<uniform> frame : Frame;
@group(0) @binding(2) var<storage, read> instances : array<Instance>;
@group(0) @binding(3) var<storage, read> bounds : array<MeshletBounds>;
@group(0) @binding(4) var<storage, read> meshlets : array<Meshlet>;
@group(0) @binding(5) var<storage, read> chunks : array<Chunk>;
@group(0) @binding(6) var<storage, read_write> visibleList : array<vec2u>;
@group(0) @binding(7) var<storage, read_write> drawArgs : DrawArgs;
@group(0) @binding(8) var<storage, read_write> counters : Counters;

var<workgroup> wgCount : atomic<u32>;
var<workgroup> wgTris : atomic<u32>;
var<workgroup> wgBase : u32;

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wid : vec3u, @builtin(local_invocation_index) li : u32) {
  if (li == 0u) {
    atomicStore(&wgCount, 0u);
    atomicStore(&wgTris, 0u);
  }
  workgroupBarrier();

  var isVisible = false;
  var slot = 0u;
  var entry = vec2u(0u);
  let chunkIdx = wid.x;
  if (chunkIdx < frame.chunkCap) {
    let ch = chunks[chunkIdx];
    if (li < ch.count) {
      let m = ch.firstMeshlet + li;
      let inst = instances[ch.instance];
      let b = bounds[m];
      let center = (inst.model * vec4f(b.sphere.xyz, 1.0)).xyz;
      let radius = b.sphere.w * inst.material.z;
      isVisible = true;
      // 프러스텀
      if ((view.flags.x & 1u) != 0u) {
        for (var p = 0u; p < 6u; p++) {
          let pl = view.planes[p];
          if (dot(pl.xyz, center) + pl.w < -radius) {
            isVisible = false;
          }
        }
      }
      // 노멀 콘 (원근 뷰, 균등 스케일 인스턴스, 퇴화 콘 제외)
      if (isVisible && (view.flags.x & 2u) != 0u && inst.material.w > 0.5 && b.cone.w < 1.0) {
        let axis = normalize(inst.normalMat * b.cone.xyz);
        var culled = false;
        if (view.cullEye.w > 0.5) {
          let d = center - view.cullEye.xyz;
          culled = dot(d, axis) >= b.cone.w * length(d) + radius;
        } else {
          culled = dot(view.cullDir.xyz, axis) >= b.cone.w;
        }
        if (culled) {
          isVisible = false;
        }
      }
      if (isVisible) {
        slot = atomicAdd(&wgCount, 1u);
        entry = vec2u(ch.instance | (ch.lod << 24u), m);
        atomicAdd(&wgTris, meshlets[m].primCount);
      }
    }
  }
  workgroupBarrier();
  if (li == 0u) {
    let n = atomicLoad(&wgCount);
    wgBase = atomicAdd(&drawArgs.instanceCount, n);
    atomicAdd(&counters.viewTriangles[view.flags.y], atomicLoad(&wgTris));
  }
  workgroupBarrier();
  if (isVisible) {
    let idx = wgBase + slot;
    if (idx < frame.visibleCap) {
      visibleList[idx] = entry;
    } else {
      atomicAdd(&counters.overflow, 1u);
    }
  }
}
