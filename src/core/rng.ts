/**
 * Deterministic pseudo-random numbers.
 *
 * The whole universe is a pure function of one 64-bit seed. Nothing in the
 * simulation ever calls Math.random(), so a seed string always regenerates the
 * same galaxies, the same planets, the same cosmic web - which is what makes
 * "share your coordinates" possible.
 */

/** SplitMix64 mixing on a pair of 32-bit halves (JS has no fast u64). */
function mix32(x: number): number {
  x |= 0;
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x21f0aaad) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x735a2d97) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return x >>> 0;
}

/** Hash an arbitrary string to a 32-bit seed (FNV-1a + avalanche). */
export function hashString(s: string): number {
  let hv = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hv ^= s.charCodeAt(i);
    hv = Math.imul(hv, 0x01000193) >>> 0;
  }
  return mix32(hv);
}

/** Stateless integer hash: the backbone of position-seeded procedural content. */
export function hash3(x: number, y: number, z: number, seed = 0): number {
  let hv = mix32((x | 0) ^ 0x9e3779b9);
  hv = mix32(hv ^ Math.imul(y | 0, 0x85ebca6b));
  hv = mix32(hv ^ Math.imul(z | 0, 0xc2b2ae35));
  return mix32(hv ^ (seed | 0));
}

/** xoshiro128** - fast, small state, excellent statistical quality. */
export class RNG {
  private s0: number; private s1: number; private s2: number; private s3: number;

  constructor(seed: number | string = 1) {
    const s = typeof seed === 'string' ? hashString(seed) : mix32(seed);
    this.s0 = mix32(s ^ 0xa341316c) || 1;
    this.s1 = mix32(this.s0 ^ 0xc8013ea4) || 2;
    this.s2 = mix32(this.s1 ^ 0xad90777d) || 3;
    this.s3 = mix32(this.s2 ^ 0x7e95761e) || 4;
    for (let i = 0; i < 12; i++) this.nextUint();
  }

  nextUint(): number {
    const r = (Math.imul(this.s1 * 5, 1) >>> 0);
    const result = (((r << 7) | (r >>> 25)) * 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = ((this.s3 << 11) | (this.s3 >>> 21)) >>> 0;
    return result;
  }

  /** Uniform in [0, 1). */
  next(): number { return this.nextUint() / 4294967296; }
  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number { return lo + (hi - lo) * this.next(); }
  /** Uniform integer in [lo, hi]. */
  int(lo: number, hi: number): number { return lo + Math.floor(this.next() * (hi - lo + 1)); }
  /** True with probability p. */
  chance(p: number): boolean { return this.next() < p; }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length) % arr.length]; }

  private spare: number | null = null;
  /** Standard normal via Marsaglia polar method (cached spare). */
  normal(mu = 0, sigma = 1): number {
    if (this.spare !== null) { const v = this.spare; this.spare = null; return mu + sigma * v; }
    let u: number, v: number, s: number;
    do {
      u = this.next() * 2 - 1;
      v = this.next() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    this.spare = v * m;
    return mu + sigma * u * m;
  }

  /** Log-normal draw. */
  logNormal(medianValue: number, sigmaLog: number): number {
    return medianValue * Math.exp(this.normal(0, sigmaLog));
  }

  /** Sample x in [lo, hi] from p(x) ∝ x^alpha (inverse-CDF; alpha != -1). */
  powerLaw(alpha: number, lo: number, hi: number): number {
    const u = this.next();
    if (Math.abs(alpha + 1) < 1e-9) return lo * Math.pow(hi / lo, u);
    const a1 = alpha + 1;
    return Math.pow(u * (Math.pow(hi, a1) - Math.pow(lo, a1)) + Math.pow(lo, a1), 1 / a1);
  }

  /** A point uniformly distributed on the unit sphere. */
  onSphere(): [number, number, number] {
    const z = this.range(-1, 1);
    const t = this.range(0, Math.PI * 2);
    const r = Math.sqrt(1 - z * z);
    return [r * Math.cos(t), r * Math.sin(t), z];
  }
}

/** A deterministic child stream, so subsystems can't perturb each other's draws. */
export const derive = (seed: number | string, label: string): RNG =>
  new RNG(mix32((typeof seed === 'string' ? hashString(seed) : seed) ^ hashString(label)));
