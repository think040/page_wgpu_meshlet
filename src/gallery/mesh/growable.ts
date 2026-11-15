// 크기를 모르는 출력용 성장 배열.

export class GrowF32 {
  data: Float32Array;
  length = 0;
  constructor(capacity = 1024) {
    this.data = new Float32Array(capacity);
  }
  reserve(extra: number) {
    if (this.length + extra <= this.data.length) return;
    let cap = this.data.length * 2;
    while (cap < this.length + extra) cap *= 2;
    const next = new Float32Array(cap);
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }
  push3(a: number, b: number, c: number) {
    this.reserve(3);
    const d = this.data;
    const l = this.length;
    d[l] = a;
    d[l + 1] = b;
    d[l + 2] = c;
    this.length = l + 3;
  }
  toArray(): Float32Array {
    return this.data.slice(0, this.length);
  }
}

export class GrowU32 {
  data: Uint32Array;
  length = 0;
  constructor(capacity = 1024) {
    this.data = new Uint32Array(capacity);
  }
  reserve(extra: number) {
    if (this.length + extra <= this.data.length) return;
    let cap = this.data.length * 2;
    while (cap < this.length + extra) cap *= 2;
    const next = new Uint32Array(cap);
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }
  push(v: number) {
    this.reserve(1);
    this.data[this.length++] = v;
  }
  push3(a: number, b: number, c: number) {
    this.reserve(3);
    const d = this.data;
    const l = this.length;
    d[l] = a;
    d[l + 1] = b;
    d[l + 2] = c;
    this.length = l + 3;
  }
  toArray(): Uint32Array {
    return this.data.slice(0, this.length);
  }
}
