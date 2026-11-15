;; SDF 격자 평가 커널 — WASM SIMD(v128). TS 참조 구현: src/gallery/mesh/sdf/kernel.ts (TsKernel)
;;
;; 모든 함수는 "블록 전체(배열)"를 한 번에 처리한다. 블록은 set_block으로 지정한 격자 샘플 범위이며
;; 출력 배열 레이아웃은 idx = (ly * nz + lz) * stride + lx  (stride = nx를 4의 배수로 올림).
;; x 방향 샘플 4개를 f32x4 한 레인 묶음으로 계산한다. Relaxed SIMD는 쓰지 않는다.
;; 삼각함수는 쓰지 않는다: 「비틀림」은 y별 cos/sin 표, 「침식」은 축별 sin/cos 표를 JS가 넘긴다.

(module
  (memory (export "memory") 1)

  (global $origin (mut f32) (f32.const 0))
  (global $step (mut f32) (f32.const 0))
  (global $ix0 (mut i32) (i32.const 0))
  (global $iy0 (mut i32) (i32.const 0))
  (global $iz0 (mut i32) (i32.const 0))
  (global $ny (mut i32) (i32.const 0))
  (global $nz (mut i32) (i32.const 0))
  (global $stride (mut i32) (i32.const 0))

  (func (export "set_grid") (param $origin f32) (param $step f32)
    (global.set $origin (local.get $origin))
    (global.set $step (local.get $step)))

  (func (export "set_block") (param $ix0 i32) (param $iy0 i32) (param $iz0 i32) (param $ny i32) (param $nz i32) (param $stride i32)
    (global.set $ix0 (local.get $ix0))
    (global.set $iy0 (local.get $iy0))
    (global.set $iz0 (local.get $iz0))
    (global.set $ny (local.get $ny))
    (global.set $nz (local.get $nz))
    (global.set $stride (local.get $stride)))

  ;; 격자 인덱스 → 좌표
  (func $coord (param $i i32) (result f32)
    (f32.add (global.get $origin) (f32.mul (f32.convert_i32_s (local.get $i)) (global.get $step))))

  ;; 열 lx부터 x 좌표 4개
  (func $xvec (param $lx i32) (result v128)
    (f32x4.add
      (f32x4.splat (call $coord (i32.add (global.get $ix0) (local.get $lx))))
      (f32x4.mul (f32x4.splat (global.get $step)) (v128.const f32x4 0 1 2 3))))

  ;; 행(ly, lz)의 출력 시작 주소
  (func $rowptr (param $base i32) (param $ly i32) (param $lz i32) (result i32)
    (i32.add (local.get $base)
      (i32.shl
        (i32.mul (i32.add (i32.mul (local.get $ly) (global.get $nz)) (local.get $lz)) (global.get $stride))
        (i32.const 2))))

  ;; ───────── 구: |p − c| − r ─────────
  (func (export "sphere") (param $dst i32) (param $cx f32) (param $cy f32) (param $cz f32) (param $r f32)
    (local $ly i32) (local $lz i32) (local $lx i32) (local $p i32)
    (local $dy f32) (local $dz f32) (local $yz v128) (local $dx v128)
    (local.set $ly (i32.const 0))
    (block $by (loop $ly_l
      (br_if $by (i32.ge_s (local.get $ly) (global.get $ny)))
      (local.set $dy (f32.sub (call $coord (i32.add (global.get $iy0) (local.get $ly))) (local.get $cy)))
      (local.set $lz (i32.const 0))
      (block $bz (loop $lz_l
        (br_if $bz (i32.ge_s (local.get $lz) (global.get $nz)))
        (local.set $dz (f32.sub (call $coord (i32.add (global.get $iz0) (local.get $lz))) (local.get $cz)))
        (local.set $yz (f32x4.splat (f32.add (f32.mul (local.get $dy) (local.get $dy)) (f32.mul (local.get $dz) (local.get $dz)))))
        (local.set $p (call $rowptr (local.get $dst) (local.get $ly) (local.get $lz)))
        (local.set $lx (i32.const 0))
        (block $bx (loop $lx_l
          (br_if $bx (i32.ge_s (local.get $lx) (global.get $stride)))
          (local.set $dx (f32x4.sub (call $xvec (local.get $lx)) (f32x4.splat (local.get $cx))))
          (v128.store (local.get $p)
            (f32x4.sub
              (f32x4.sqrt (f32x4.add (f32x4.mul (local.get $dx) (local.get $dx)) (local.get $yz)))
              (f32x4.splat (local.get $r))))
          (local.set $p (i32.add (local.get $p) (i32.const 16)))
          (local.set $lx (i32.add (local.get $lx) (i32.const 4)))
          (br $lx_l)))
        (local.set $lz (i32.add (local.get $lz) (i32.const 1)))
        (br $lz_l)))
      (local.set $ly (i32.add (local.get $ly) (i32.const 1)))
      (br $ly_l))))

  ;; ───────── 선분 체인까지 최소 거리 − r ─────────
  ;; segs: 선분당 f32 8개 (ax, ay, az, bax, bay, baz, 1/|ba|², 0)
  (func (export "capsule_chain") (param $dst i32) (param $segs i32) (param $count i32) (param $r f32)
    (local $ly i32) (local $lz i32) (local $lx i32) (local $p i32) (local $s i32) (local $end i32)
    (local $y f32) (local $z f32) (local $x v128) (local $m v128)
    (local $pax v128) (local $pay f32) (local $paz f32) (local $bax f32) (local $bay f32) (local $baz f32)
    (local $h v128) (local $ex v128) (local $ey v128) (local $ez v128)
    (local.set $end (i32.add (local.get $segs) (i32.shl (local.get $count) (i32.const 5))))
    (local.set $ly (i32.const 0))
    (block $by (loop $ly_l
      (br_if $by (i32.ge_s (local.get $ly) (global.get $ny)))
      (local.set $y (call $coord (i32.add (global.get $iy0) (local.get $ly))))
      (local.set $lz (i32.const 0))
      (block $bz (loop $lz_l
        (br_if $bz (i32.ge_s (local.get $lz) (global.get $nz)))
        (local.set $z (call $coord (i32.add (global.get $iz0) (local.get $lz))))
        (local.set $p (call $rowptr (local.get $dst) (local.get $ly) (local.get $lz)))
        (local.set $lx (i32.const 0))
        (block $bx (loop $lx_l
          (br_if $bx (i32.ge_s (local.get $lx) (global.get $stride)))
          (local.set $x (call $xvec (local.get $lx)))
          (local.set $m (f32x4.splat (f32.const inf)))
          (local.set $s (local.get $segs))
          (block $bs (loop $s_l
            (br_if $bs (i32.ge_u (local.get $s) (local.get $end)))
            (local.set $pax (f32x4.sub (local.get $x) (f32x4.splat (f32.load (local.get $s)))))
            (local.set $pay (f32.sub (local.get $y) (f32.load offset=4 (local.get $s))))
            (local.set $paz (f32.sub (local.get $z) (f32.load offset=8 (local.get $s))))
            (local.set $bax (f32.load offset=12 (local.get $s)))
            (local.set $bay (f32.load offset=16 (local.get $s)))
            (local.set $baz (f32.load offset=20 (local.get $s)))
            ;; h = clamp(dot(pa, ba) / |ba|², 0, 1)
            (local.set $h
              (f32x4.min (f32x4.splat (f32.const 1))
                (f32x4.max (f32x4.splat (f32.const 0))
                  (f32x4.mul
                    (f32x4.add
                      (f32x4.mul (local.get $pax) (f32x4.splat (local.get $bax)))
                      (f32x4.splat (f32.add (f32.mul (local.get $pay) (local.get $bay)) (f32.mul (local.get $paz) (local.get $baz)))))
                    (f32x4.splat (f32.load offset=24 (local.get $s)))))))
            (local.set $ex (f32x4.sub (local.get $pax) (f32x4.mul (f32x4.splat (local.get $bax)) (local.get $h))))
            (local.set $ey (f32x4.sub (f32x4.splat (local.get $pay)) (f32x4.mul (f32x4.splat (local.get $bay)) (local.get $h))))
            (local.set $ez (f32x4.sub (f32x4.splat (local.get $paz)) (f32x4.mul (f32x4.splat (local.get $baz)) (local.get $h))))
            (local.set $m
              (f32x4.min (local.get $m)
                (f32x4.add (f32x4.mul (local.get $ex) (local.get $ex))
                  (f32x4.add (f32x4.mul (local.get $ey) (local.get $ey)) (f32x4.mul (local.get $ez) (local.get $ez))))))
            (local.set $s (i32.add (local.get $s) (i32.const 32)))
            (br $s_l)))
          (v128.store (local.get $p) (f32x4.sub (f32x4.sqrt (local.get $m)) (f32x4.splat (local.get $r))))
          (local.set $p (i32.add (local.get $p) (i32.const 16)))
          (local.set $lx (i32.add (local.get $lx) (i32.const 4)))
          (br $lx_l)))
        (local.set $lz (i32.add (local.get $lz) (i32.const 1)))
        (br $lz_l)))
      (local.set $ly (i32.add (local.get $ly) (i32.const 1)))
      (br $ly_l))))

  ;; ───────── 비틀린 둥근 박스 ─────────
  ;; p' = (c·x + s·z, y, −s·x + c·z),  c, s = 표[iy]
  (func (export "twist_box") (param $dst i32) (param $hx f32) (param $hy f32) (param $hz f32) (param $rr f32) (param $cosT i32) (param $sinT i32)
    (local $ly i32) (local $lz i32) (local $lx i32) (local $p i32) (local $iy i32)
    (local $y f32) (local $z f32) (local $c f32) (local $s f32) (local $qy f32) (local $qy0 f32)
    (local $x v128) (local $px v128) (local $pz v128) (local $qx v128) (local $qz v128) (local $mx v128) (local $mz v128) (local $zero v128)
    (local.set $zero (f32x4.splat (f32.const 0)))
    (local.set $ly (i32.const 0))
    (block $by (loop $ly_l
      (br_if $by (i32.ge_s (local.get $ly) (global.get $ny)))
      (local.set $iy (i32.add (global.get $iy0) (local.get $ly)))
      (local.set $y (call $coord (local.get $iy)))
      (local.set $c (f32.load (i32.add (local.get $cosT) (i32.shl (local.get $iy) (i32.const 2)))))
      (local.set $s (f32.load (i32.add (local.get $sinT) (i32.shl (local.get $iy) (i32.const 2)))))
      (local.set $qy (f32.sub (f32.abs (local.get $y)) (f32.sub (local.get $hy) (local.get $rr))))
      (local.set $qy0 (f32.max (local.get $qy) (f32.const 0)))
      (local.set $lz (i32.const 0))
      (block $bz (loop $lz_l
        (br_if $bz (i32.ge_s (local.get $lz) (global.get $nz)))
        (local.set $z (call $coord (i32.add (global.get $iz0) (local.get $lz))))
        (local.set $p (call $rowptr (local.get $dst) (local.get $ly) (local.get $lz)))
        (local.set $lx (i32.const 0))
        (block $bx (loop $lx_l
          (br_if $bx (i32.ge_s (local.get $lx) (global.get $stride)))
          (local.set $x (call $xvec (local.get $lx)))
          (local.set $px (f32x4.add (f32x4.mul (f32x4.splat (local.get $c)) (local.get $x)) (f32x4.splat (f32.mul (local.get $s) (local.get $z)))))
          (local.set $pz (f32x4.add (f32x4.mul (f32x4.splat (f32.neg (local.get $s))) (local.get $x)) (f32x4.splat (f32.mul (local.get $c) (local.get $z)))))
          (local.set $qx (f32x4.sub (f32x4.abs (local.get $px)) (f32x4.splat (f32.sub (local.get $hx) (local.get $rr)))))
          (local.set $qz (f32x4.sub (f32x4.abs (local.get $pz)) (f32x4.splat (f32.sub (local.get $hz) (local.get $rr)))))
          (local.set $mx (f32x4.max (local.get $qx) (local.get $zero)))
          (local.set $mz (f32x4.max (local.get $qz) (local.get $zero)))
          (v128.store (local.get $p)
            (f32x4.sub
              (f32x4.add
                (f32x4.sqrt
                  (f32x4.add (f32x4.mul (local.get $mx) (local.get $mx))
                    (f32x4.add (f32x4.splat (f32.mul (local.get $qy0) (local.get $qy0))) (f32x4.mul (local.get $mz) (local.get $mz)))))
                (f32x4.min
                  (f32x4.max (local.get $qx) (f32x4.max (f32x4.splat (local.get $qy)) (local.get $qz)))
                  (local.get $zero)))
              (f32x4.splat (local.get $rr))))
          (local.set $p (i32.add (local.get $p) (i32.const 16)))
          (local.set $lx (i32.add (local.get $lx) (i32.const 4)))
          (br $lx_l)))
        (local.set $lz (i32.add (local.get $lz) (i32.const 1)))
        (br $lz_l)))
      (local.set $ly (i32.add (local.get $ly) (i32.const 1)))
      (br $ly_l))))

  ;; ───────── gyroid 껍질: (|sx·cy + sy·cz + sz·cx| − t) × scale ─────────
  ;; sinT/cosT: 축 샘플 인덱스별 표(세 축 공용), x 방향은 4개씩 바로 읽는다(표 끝에 4칸 여유 필요)
  (func (export "gyroid") (param $dst i32) (param $t f32) (param $scale f32) (param $sinT i32) (param $cosT i32)
    (local $ly i32) (local $lz i32) (local $lx i32) (local $p i32) (local $o i32)
    (local $sy f32) (local $cy f32) (local $sz f32) (local $cz f32) (local $syz v128)
    (local $g v128)
    (local.set $ly (i32.const 0))
    (block $by (loop $ly_l
      (br_if $by (i32.ge_s (local.get $ly) (global.get $ny)))
      (local.set $o (i32.shl (i32.add (global.get $iy0) (local.get $ly)) (i32.const 2)))
      (local.set $sy (f32.load (i32.add (local.get $sinT) (local.get $o))))
      (local.set $cy (f32.load (i32.add (local.get $cosT) (local.get $o))))
      (local.set $lz (i32.const 0))
      (block $bz (loop $lz_l
        (br_if $bz (i32.ge_s (local.get $lz) (global.get $nz)))
        (local.set $o (i32.shl (i32.add (global.get $iz0) (local.get $lz)) (i32.const 2)))
        (local.set $sz (f32.load (i32.add (local.get $sinT) (local.get $o))))
        (local.set $cz (f32.load (i32.add (local.get $cosT) (local.get $o))))
        (local.set $syz (f32x4.splat (f32.mul (local.get $sy) (local.get $cz))))
        (local.set $p (call $rowptr (local.get $dst) (local.get $ly) (local.get $lz)))
        (local.set $lx (i32.const 0))
        (block $bx (loop $lx_l
          (br_if $bx (i32.ge_s (local.get $lx) (global.get $stride)))
          (local.set $o (i32.shl (i32.add (global.get $ix0) (local.get $lx)) (i32.const 2)))
          (local.set $g
            (f32x4.add
              (f32x4.add
                (f32x4.mul (v128.load (i32.add (local.get $sinT) (local.get $o))) (f32x4.splat (local.get $cy)))
                (local.get $syz))
              (f32x4.mul (f32x4.splat (local.get $sz)) (v128.load (i32.add (local.get $cosT) (local.get $o))))))
          (v128.store (local.get $p)
            (f32x4.mul (f32x4.sub (f32x4.abs (local.get $g)) (f32x4.splat (local.get $t))) (f32x4.splat (local.get $scale))))
          (local.set $p (i32.add (local.get $p) (i32.const 16)))
          (local.set $lx (i32.add (local.get $lx) (i32.const 4)))
          (br $lx_l)))
        (local.set $lz (i32.add (local.get $lz) (i32.const 1)))
        (br $lz_l)))
      (local.set $ly (i32.add (local.get $ly) (i32.const 1)))
      (br $ly_l))))

  ;; ───────── 동심 구면 껍질: min_k ||p−c| − (r0 + k·dr)| − t ─────────
  (func (export "shells") (param $dst i32) (param $cx f32) (param $cy f32) (param $cz f32) (param $r0 f32) (param $dr f32) (param $count i32) (param $t f32)
    (local $ly i32) (local $lz i32) (local $lx i32) (local $p i32) (local $k i32)
    (local $dy f32) (local $dz f32) (local $yz v128) (local $dx v128) (local $len v128) (local $m v128)
    (local.set $ly (i32.const 0))
    (block $by (loop $ly_l
      (br_if $by (i32.ge_s (local.get $ly) (global.get $ny)))
      (local.set $dy (f32.sub (call $coord (i32.add (global.get $iy0) (local.get $ly))) (local.get $cy)))
      (local.set $lz (i32.const 0))
      (block $bz (loop $lz_l
        (br_if $bz (i32.ge_s (local.get $lz) (global.get $nz)))
        (local.set $dz (f32.sub (call $coord (i32.add (global.get $iz0) (local.get $lz))) (local.get $cz)))
        (local.set $yz (f32x4.splat (f32.add (f32.mul (local.get $dy) (local.get $dy)) (f32.mul (local.get $dz) (local.get $dz)))))
        (local.set $p (call $rowptr (local.get $dst) (local.get $ly) (local.get $lz)))
        (local.set $lx (i32.const 0))
        (block $bx (loop $lx_l
          (br_if $bx (i32.ge_s (local.get $lx) (global.get $stride)))
          (local.set $dx (f32x4.sub (call $xvec (local.get $lx)) (f32x4.splat (local.get $cx))))
          (local.set $len (f32x4.sqrt (f32x4.add (f32x4.mul (local.get $dx) (local.get $dx)) (local.get $yz))))
          (local.set $m (f32x4.splat (f32.const inf)))
          (local.set $k (i32.const 0))
          (block $bk (loop $k_l
            (br_if $bk (i32.ge_s (local.get $k) (local.get $count)))
            (local.set $m
              (f32x4.min (local.get $m)
                (f32x4.abs (f32x4.sub (local.get $len)
                  (f32x4.splat (f32.add (local.get $r0) (f32.mul (f32.convert_i32_s (local.get $k)) (local.get $dr))))))))
            (local.set $k (i32.add (local.get $k) (i32.const 1)))
            (br $k_l)))
          (v128.store (local.get $p) (f32x4.sub (local.get $m) (f32x4.splat (local.get $t))))
          (local.set $p (i32.add (local.get $p) (i32.const 16)))
          (local.set $lx (i32.add (local.get $lx) (i32.const 4)))
          (br $lx_l)))
        (local.set $lz (i32.add (local.get $lz) (i32.const 1)))
        (br $lz_l)))
      (local.set $ly (i32.add (local.get $ly) (i32.const 1)))
      (br $ly_l))))

  ;; ───────── 반공간: dot(p, n) − d ─────────
  (func (export "plane") (param $dst i32) (param $nx f32) (param $ny f32) (param $nz f32) (param $d f32)
    (local $ly i32) (local $lz i32) (local $lx i32) (local $p i32)
    (local $yv f32) (local $yz v128)
    (local.set $ly (i32.const 0))
    (block $by (loop $ly_l
      (br_if $by (i32.ge_s (local.get $ly) (global.get $ny)))
      (local.set $yv (f32.mul (call $coord (i32.add (global.get $iy0) (local.get $ly))) (local.get $ny)))
      (local.set $lz (i32.const 0))
      (block $bz (loop $lz_l
        (br_if $bz (i32.ge_s (local.get $lz) (global.get $nz)))
        (local.set $yz (f32x4.splat
          (f32.sub (f32.add (local.get $yv) (f32.mul (call $coord (i32.add (global.get $iz0) (local.get $lz))) (local.get $nz))) (local.get $d))))
        (local.set $p (call $rowptr (local.get $dst) (local.get $ly) (local.get $lz)))
        (local.set $lx (i32.const 0))
        (block $bx (loop $lx_l
          (br_if $bx (i32.ge_s (local.get $lx) (global.get $stride)))
          (v128.store (local.get $p)
            (f32x4.add (f32x4.mul (call $xvec (local.get $lx)) (f32x4.splat (local.get $nx))) (local.get $yz)))
          (local.set $p (i32.add (local.get $p) (i32.const 16)))
          (local.set $lx (i32.add (local.get $lx) (i32.const 4)))
          (br $lx_l)))
        (local.set $lz (i32.add (local.get $lz) (i32.const 1)))
        (br $lz_l)))
      (local.set $ly (i32.add (local.get $ly) (i32.const 1)))
      (br $ly_l))))

  ;; ───────── 결합 연산 (배열 a, b → out, 원소 n개: 4의 배수) ─────────
  ;; 다항식 smooth min: h = max(k − |a−b|, 0) / k;  min(a,b) − h²·k/4
  (func $smin (param $a v128) (param $b v128) (param $k f32) (result v128)
    (local $h v128)
    (local.set $h
      (f32x4.div
        (f32x4.max (f32x4.sub (f32x4.splat (local.get $k)) (f32x4.abs (f32x4.sub (local.get $a) (local.get $b)))) (f32x4.splat (f32.const 0)))
        (f32x4.splat (local.get $k))))
    (f32x4.sub (f32x4.min (local.get $a) (local.get $b))
      (f32x4.mul (f32x4.mul (local.get $h) (local.get $h)) (f32x4.splat (f32.mul (local.get $k) (f32.const 0.25))))))

  (func (export "smooth_union") (param $dst i32) (param $a i32) (param $b i32) (param $n i32) (param $k f32)
    (local $i i32) (local $end i32)
    (local.set $end (i32.shl (local.get $n) (i32.const 2)))
    (block $done (loop $l
      (br_if $done (i32.ge_u (local.get $i) (local.get $end)))
      (v128.store (i32.add (local.get $dst) (local.get $i))
        (call $smin (v128.load (i32.add (local.get $a) (local.get $i))) (v128.load (i32.add (local.get $b) (local.get $i))) (local.get $k)))
      (local.set $i (i32.add (local.get $i) (i32.const 16)))
      (br $l))))

  ;; smax(a, −b) = −smin(−a, b)
  (func (export "smooth_sub") (param $dst i32) (param $a i32) (param $b i32) (param $n i32) (param $k f32)
    (local $i i32) (local $end i32)
    (local.set $end (i32.shl (local.get $n) (i32.const 2)))
    (block $done (loop $l
      (br_if $done (i32.ge_u (local.get $i) (local.get $end)))
      (v128.store (i32.add (local.get $dst) (local.get $i))
        (f32x4.neg (call $smin (f32x4.neg (v128.load (i32.add (local.get $a) (local.get $i)))) (v128.load (i32.add (local.get $b) (local.get $i))) (local.get $k))))
      (local.set $i (i32.add (local.get $i) (i32.const 16)))
      (br $l))))

  (func (export "op_max") (param $dst i32) (param $a i32) (param $b i32) (param $n i32)
    (local $i i32) (local $end i32)
    (local.set $end (i32.shl (local.get $n) (i32.const 2)))
    (block $done (loop $l
      (br_if $done (i32.ge_u (local.get $i) (local.get $end)))
      (v128.store (i32.add (local.get $dst) (local.get $i))
        (f32x4.max (v128.load (i32.add (local.get $a) (local.get $i))) (v128.load (i32.add (local.get $b) (local.get $i)))))
      (local.set $i (i32.add (local.get $i) (i32.const 16)))
      (br $l))))

  (func (export "op_min") (param $dst i32) (param $a i32) (param $b i32) (param $n i32)
    (local $i i32) (local $end i32)
    (local.set $end (i32.shl (local.get $n) (i32.const 2)))
    (block $done (loop $l
      (br_if $done (i32.ge_u (local.get $i) (local.get $end)))
      (v128.store (i32.add (local.get $dst) (local.get $i))
        (f32x4.min (v128.load (i32.add (local.get $a) (local.get $i))) (v128.load (i32.add (local.get $b) (local.get $i)))))
      (local.set $i (i32.add (local.get $i) (i32.const 16)))
      (br $l))))
)
