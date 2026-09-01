/**
 * Iterative in-place radix-2 complex FFT, plus a 3-D wrapper.
 *
 * This is the workhorse behind the cosmic web: we build a Gaussian random field
 * directly in Fourier space (where the modes are independent) and transform it
 * back to configuration space. A 128^3 transform moves ~2.1 million complex
 * numbers and runs in a Web Worker so the main thread never stalls.
 */

export class FFT1D {
  readonly n: number;
  private readonly rev: Uint32Array;
  private readonly cosT: Float64Array;
  private readonly sinT: Float64Array;

  constructor(n: number) {
    if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${n}`);
    this.n = n;
    const bits = Math.log2(n) | 0;
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.rev[i] = r;
    }
    // Twiddles for every stage, packed as half-length tables.
    this.cosT = new Float64Array(n / 2);
    this.sinT = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      const a = (-2 * Math.PI * i) / n;
      this.cosT[i] = Math.cos(a);
      this.sinT[i] = Math.sin(a);
    }
  }

  /**
   * Transform `re`/`im` in place.
   * @param sign -1 for the forward (x -> k) transform, +1 for the inverse.
   *             Neither direction applies a 1/N factor; callers normalise.
   */
  transform(re: Float64Array, im: Float64Array, off: number, stride: number, sign: number): void {
    const n = this.n;
    const rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        const ai = off + i * stride;
        const aj = off + j * stride;
        let t = re[ai]; re[ai] = re[aj]; re[aj] = t;
        t = im[ai]; im[ai] = im[aj]; im[aj] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let j = 0; j < half; j++) {
          const ti = j * step;
          const wr = this.cosT[ti];
          const wi = sign < 0 ? this.sinT[ti] : -this.sinT[ti];
          const a = off + (i + j) * stride;
          const b = off + (i + j + half) * stride;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  }
}

/**
 * In-place 3-D complex FFT over an N x N x N cube stored as
 * index = (i * N + j) * N + k  (k contiguous).
 */
export class FFT3D {
  readonly n: number;
  private readonly f: FFT1D;

  constructor(n: number) {
    this.n = n;
    this.f = new FFT1D(n);
  }

  transform(re: Float64Array, im: Float64Array, sign: number, onProgress?: (t: number) => void): void {
    const n = this.n;
    const n2 = n * n;
    // Axis k (contiguous, stride 1)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) this.f.transform(re, im, (i * n + j) * n, 1, sign);
      onProgress?.((i / n) * 0.3333);
    }
    // Axis j (stride n)
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < n; k++) this.f.transform(re, im, i * n2 + k, n, sign);
      onProgress?.(0.3333 + (i / n) * 0.3333);
    }
    // Axis i (stride n^2)
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) this.f.transform(re, im, j * n + k, n2, sign);
      onProgress?.(0.6666 + (j / n) * 0.3334);
    }
  }
}
