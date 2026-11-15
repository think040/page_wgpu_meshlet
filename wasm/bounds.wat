;; 메시릿 컬링 데이터(바운딩 스피어 + 노멀 콘) — WASM SIMD(v128).
;; TS 참조 구현: src/gallery/mesh/bounds.ts (computeMeshletBounds) — 같은 순서·같은 규칙.
;;
;; meshlet_bounds(pos, meshlets, count, vidx, prims, out, scratch)
;;   pos      : 정점 위치 f32×3 (12B 간격, 마지막 정점 뒤 4B 여유 필요 — v128로 읽는다)
;;   meshlets : 메시릿당 u32×4 (vertOffset, vertCount, primOffset, primCount)
;;   vidx     : 메시릿 정점 → 메시 정점 인덱스 u32
;;   prims    : 삼각형 = 로컬 인덱스 3×8bit
;;   out      : 메시릿당 f32×8 (cx, cy, cz, r, ax, ay, az, cutoff)
;;   scratch  : 삼각형 단위 노멀 126개 × 16B
;; 3차원 벡터는 v128 한 개(xyz, w=0)로 계산한다.

(module
  (memory (export "memory") 1)

  ;; 정점 i(메시릿 로컬)의 위치 (w = 0)
  (func $P (param $pos i32) (param $vidx i32) (param $vOff i32) (param $i i32) (result v128)
    (f32x4.replace_lane 3
      (v128.load
        (i32.add (local.get $pos)
          (i32.mul
            (i32.load (i32.add (local.get $vidx) (i32.shl (i32.add (local.get $vOff) (local.get $i)) (i32.const 2))))
            (i32.const 12))))
      (f32.const 0)))

  (func $dot3 (param $a v128) (param $b v128) (result f32)
    (local $m v128)
    (local.set $m (f32x4.mul (local.get $a) (local.get $b)))
    (f32.add (f32.add (f32x4.extract_lane 0 (local.get $m)) (f32x4.extract_lane 1 (local.get $m))) (f32x4.extract_lane 2 (local.get $m))))

  ;; a × b = a.yzx·b.zxy − a.zxy·b.yzx
  (func $cross (param $a v128) (param $b v128) (result v128)
    (f32x4.sub
      (f32x4.mul
        (i8x16.shuffle 4 5 6 7 8 9 10 11 0 1 2 3 12 13 14 15 (local.get $a) (local.get $a))
        (i8x16.shuffle 8 9 10 11 0 1 2 3 4 5 6 7 12 13 14 15 (local.get $b) (local.get $b)))
      (f32x4.mul
        (i8x16.shuffle 8 9 10 11 0 1 2 3 4 5 6 7 12 13 14 15 (local.get $a) (local.get $a))
        (i8x16.shuffle 4 5 6 7 8 9 10 11 0 1 2 3 12 13 14 15 (local.get $b) (local.get $b)))))

  (func (export "meshlet_bounds") (param $pos i32) (param $meshlets i32) (param $count i32) (param $vidx i32) (param $prims i32) (param $out i32) (param $scratch i32)
    (local $m i32) (local $mp i32) (local $vOff i32) (local $vCnt i32) (local $pOff i32) (local $pCnt i32)
    (local $i i32) (local $bi i32) (local $bj i32) (local $best f32) (local $d f32)
    (local $a v128) (local $c v128) (local $v v128) (local $r f32) (local $nr f32)
    (local $prim i32) (local $p0 v128) (local $n v128) (local $l f32) (local $sum v128) (local $valid i32)
    (local $sl f32) (local $axis v128) (local $mindp f32) (local $cutoff f32) (local $sp i32) (local $o i32)
    (block $done (loop $ml
      (br_if $done (i32.ge_u (local.get $m) (local.get $count)))
      (local.set $mp (i32.add (local.get $meshlets) (i32.shl (local.get $m) (i32.const 4))))
      (local.set $vOff (i32.load (local.get $mp)))
      (local.set $vCnt (i32.load offset=4 (local.get $mp)))
      (local.set $pOff (i32.load offset=8 (local.get $mp)))
      (local.set $pCnt (i32.load offset=12 (local.get $mp)))

      ;; ── Ritter: 정점 0에서 가장 먼 점 bi
      (local.set $a (call $P (local.get $pos) (local.get $vidx) (local.get $vOff) (i32.const 0)))
      (local.set $best (f32.const -1))
      (local.set $bi (i32.const 0))
      (local.set $i (i32.const 0))
      (block $b1 (loop $l1
        (br_if $b1 (i32.ge_u (local.get $i) (local.get $vCnt)))
        (local.set $v (f32x4.sub (call $P (local.get $pos) (local.get $vidx) (local.get $vOff) (local.get $i)) (local.get $a)))
        (local.set $d (call $dot3 (local.get $v) (local.get $v)))
        (if (f32.gt (local.get $d) (local.get $best))
          (then (local.set $best (local.get $d)) (local.set $bi (local.get $i))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l1)))
      ;; bi에서 가장 먼 점 bj
      (local.set $a (call $P (local.get $pos) (local.get $vidx) (local.get $vOff) (local.get $bi)))
      (local.set $best (f32.const -1))
      (local.set $bj (i32.const 0))
      (local.set $i (i32.const 0))
      (block $b2 (loop $l2
        (br_if $b2 (i32.ge_u (local.get $i) (local.get $vCnt)))
        (local.set $v (f32x4.sub (call $P (local.get $pos) (local.get $vidx) (local.get $vOff) (local.get $i)) (local.get $a)))
        (local.set $d (call $dot3 (local.get $v) (local.get $v)))
        (if (f32.gt (local.get $d) (local.get $best))
          (then (local.set $best (local.get $d)) (local.set $bj (local.get $i))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l2)))
      (local.set $c
        (f32x4.mul (f32x4.add (local.get $a) (call $P (local.get $pos) (local.get $vidx) (local.get $vOff) (local.get $bj))) (f32x4.splat (f32.const 0.5))))
      (local.set $r (f32.mul (f32.sqrt (local.get $best)) (f32.const 0.5)))
      ;; 밖의 점이 있으면 구를 키운다
      (local.set $i (i32.const 0))
      (block $b3 (loop $l3
        (br_if $b3 (i32.ge_u (local.get $i) (local.get $vCnt)))
        (local.set $v (f32x4.sub (call $P (local.get $pos) (local.get $vidx) (local.get $vOff) (local.get $i)) (local.get $c)))
        (local.set $d (f32.sqrt (call $dot3 (local.get $v) (local.get $v))))
        (if (f32.gt (local.get $d) (local.get $r))
          (then
            (local.set $nr (f32.mul (f32.add (local.get $r) (local.get $d)) (f32.const 0.5)))
            (local.set $c (f32x4.add (local.get $c)
              (f32x4.mul (local.get $v) (f32x4.splat (f32.div (f32.sub (local.get $nr) (local.get $r)) (local.get $d))))))
            (local.set $r (local.get $nr))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l3)))
      (local.set $r (f32.mul (local.get $r) (f32.const 1.0001)))

      ;; ── 노멀 콘: 삼각형 단위 노멀(면적 0이면 w=0으로 표시)
      (local.set $sum (f32x4.splat (f32.const 0)))
      (local.set $valid (i32.const 0))
      (local.set $i (i32.const 0))
      (block $b4 (loop $l4
        (br_if $b4 (i32.ge_u (local.get $i) (local.get $pCnt)))
        (local.set $prim (i32.load (i32.add (local.get $prims) (i32.shl (i32.add (local.get $pOff) (local.get $i)) (i32.const 2)))))
        (local.set $p0 (call $P (local.get $pos) (local.get $vidx) (local.get $vOff) (i32.and (local.get $prim) (i32.const 255))))
        (local.set $n
          (call $cross
            (f32x4.sub (call $P (local.get $pos) (local.get $vidx) (local.get $vOff) (i32.and (i32.shr_u (local.get $prim) (i32.const 8)) (i32.const 255))) (local.get $p0))
            (f32x4.sub (call $P (local.get $pos) (local.get $vidx) (local.get $vOff) (i32.and (i32.shr_u (local.get $prim) (i32.const 16)) (i32.const 255))) (local.get $p0))))
        (local.set $l (f32.sqrt (call $dot3 (local.get $n) (local.get $n))))
        (local.set $sp (i32.add (local.get $scratch) (i32.shl (local.get $i) (i32.const 4))))
        (if (f32.lt (local.get $l) (f32.const 1e-20))
          (then (v128.store (local.get $sp) (f32x4.splat (f32.const 0))))
          (else
            (local.set $n (f32x4.replace_lane 3 (f32x4.div (local.get $n) (f32x4.splat (local.get $l))) (f32.const 1)))
            (v128.store (local.get $sp) (local.get $n))
            (local.set $sum (f32x4.add (local.get $sum) (local.get $n)))
            (local.set $valid (i32.add (local.get $valid) (i32.const 1)))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l4)))
      (local.set $sum (f32x4.replace_lane 3 (local.get $sum) (f32.const 0)))
      (local.set $sl (f32.sqrt (call $dot3 (local.get $sum) (local.get $sum))))
      (local.set $cutoff (f32.const 1))
      (local.set $axis (v128.const f32x4 0 0 1 0))
      (if (i32.and (i32.gt_s (local.get $valid) (i32.const 0)) (f32.gt (local.get $sl) (f32.const 1e-12)))
        (then
          (local.set $axis (f32x4.div (local.get $sum) (f32x4.splat (local.get $sl))))
          (local.set $mindp (f32.const 1))
          (local.set $i (i32.const 0))
          (block $b5 (loop $l5
            (br_if $b5 (i32.ge_u (local.get $i) (local.get $pCnt)))
            (local.set $n (v128.load (i32.add (local.get $scratch) (i32.shl (local.get $i) (i32.const 4)))))
            (if (f32.gt (f32x4.extract_lane 3 (local.get $n)) (f32.const 0.5))
              (then (local.set $mindp (f32.min (local.get $mindp) (call $dot3 (local.get $axis) (local.get $n))))))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $l5)))
          (if (f32.gt (local.get $mindp) (f32.const 0))
            (then (local.set $cutoff (f32.sqrt (f32.sub (f32.const 1) (f32.mul (local.get $mindp) (local.get $mindp)))))))))

      ;; 출력 (cx, cy, cz, r, ax, ay, az, cutoff)
      (local.set $o (i32.add (local.get $out) (i32.shl (local.get $m) (i32.const 5))))
      (v128.store (local.get $o) (f32x4.replace_lane 3 (local.get $c) (local.get $r)))
      (v128.store offset=16 (local.get $o) (f32x4.replace_lane 3 (local.get $axis) (local.get $cutoff)))
      (local.set $m (i32.add (local.get $m) (i32.const 1)))
      (br $ml))))
)
