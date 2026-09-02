/**
 * Structure formation by the Zel'dovich approximation.
 *
 * The recipe, which is exactly what a real N-body initial-condition generator does:
 *
 *  1. Draw a Gaussian random field delta(k) with variance P(k)/V. Each Fourier
 *     mode is independent, so this is embarrassingly parallel; Hermitian
 *     symmetry is enforced by seeding conjugate pairs from the same hash.
 *  2. Solve grad^2 phi = delta in Fourier space, giving the displacement field
 *     Psi(k) = i k / k^2 * delta(k). Three inverse FFTs bring it to real space.
 *  3. Move every particle ballistically along its displacement:
 *        x(q, a) = q + D(a) * Psi(q)
 *     Because the time dependence is a single scalar D(a), the *entire history
 *     of cosmic structure formation* is one uniform in the vertex shader. That
 *     is why this runs at 120 fps while 2 million particles assemble the cosmic
 *     web in front of you.
 *  4. The Jacobian of that map gives the density exactly:
 *        1 + delta = 1 / [(1 - D l1)(1 - D l2)(1 - D l3)]
 *     where l1 >= l2 >= l3 are eigenvalues of the deformation tensor. Storing
 *     the three eigenvalues per particle also gives the T-web classification
 *     (how many l_i have collapsed): 3 = knot, 2 = filament, 1 = sheet, 0 = void.
 *
 * Zel'dovich is first-order Lagrangian perturbation theory. It is *quantitatively*
 * right until shell crossing and remains qualitatively right after, which is why
 * it is still the standard way to set up cosmological simulations.
 */

import { Cosmology, growthFactor, growthRate, E as Efn, h as hOf } from './lcdm';
import { PowerSpectrum } from './powerspectrum';
import { FFT3D } from './fft';
import { hash3 } from '../core/rng';

export interface CosmicWebOptions {
  /** Grid resolution per side; must be a power of two. 128 -> 2.1M particles. */
  n: number;
  /** Comoving box size in Mpc. 500 Mpc shows several BAO wavelengths. */
  boxMpc: number;
  seed: number;
  cosmology: Cosmology;
  /**
   * Gaussian pre-smoothing of the displacement field in units of grid cells.
   * "Truncated Zel'dovich": suppressing sub-cell power sharpens the caustics
   * instead of smearing them into thick pancakes. 1.0-1.5 looks best.
   */
  smoothCells?: number;
}

export interface CosmicWebField {
  n: number;
  boxMpc: number;
  count: number;
  /** Lagrangian (unperturbed) comoving positions, Mpc. Interleaved xyz. */
  q: Float32Array;
  /** Zel'dovich displacement at D = 1, Mpc. Interleaved xyz. */
  psi: Float32Array;
  /** Deformation-tensor eigenvalues l1 >= l2 >= l3, per particle. */
  lambda: Float32Array;
  /** rms of |Psi| at D = 1, Mpc - useful for auto-scaling the camera. */
  rmsDisplacement: number;
  /** Comoving sound horizon (BAO ruler) for this cosmology, Mpc. */
  baoScaleMpc: number;
  /** rms of the linear density field on the grid, for peak-height statistics. */
  sigmaGrid: number;
  /** Collapsed peaks: candidate sites for clusters and galaxies. */
  knots: Knot[];
}

/**
 * A collapsed peak of the density field. In a real simulation these would be
 * found by a friends-of-friends or spherical-overdensity halo finder; here they
 * are the local maxima of the smallest deformation eigenvalue (all three axes
 * collapsing) with a mutual-exclusion radius, which selects the same objects to
 * within the accuracy Zel'dovich itself has.
 */
export interface Knot {
  /** Eulerian comoving position today, Mpc. */
  x: number; y: number; z: number;
  /** Lagrangian position and displacement, so the knot can be tracked to any epoch. */
  qx: number; qy: number; qz: number;
  px: number; py: number; pz: number;
  /** Peak height nu = delta_linear / sigma. Sets the halo mass function. */
  nu: number;
  /** Estimated halo mass, solar masses (Press-Schechter style scaling). */
  massMsun: number;
  /** Collapse redshift: when D(a) * lambda3 first reaches the 1.686 threshold. */
  zCollapse: number;
}

type Progress = (fraction: number, label: string) => void;

/**
 * Two independent standard normals from a 32-bit hash, via the Box-Muller
 * transform. Stateless so that mode (k) and mode (-k) can be generated
 * independently in any order and still come out as conjugates.
 */
function gauss2(hv: number): [number, number] {
  const u1 = ((hv >>> 8) + 0.5) / 16777216;
  const u2 = ((hash3(hv, 0x51ed, 0x2f9b) >>> 8) + 0.5) / 16777216;
  const r = Math.sqrt(-2 * Math.log(u1));
  return [r * Math.cos(2 * Math.PI * u2), r * Math.sin(2 * Math.PI * u2)];
}

export function generateCosmicWeb(opts: CosmicWebOptions, onProgress?: Progress): CosmicWebField {
  const { n, boxMpc, seed, cosmology } = opts;
  const smoothCells = opts.smoothCells ?? 1.15;
  const n3 = n * n * n;
  const L = boxMpc;
  const V = L * L * L;
  const dk = (2 * Math.PI) / L;
  const dx = L / n;

  onProgress?.(0.02, 'sampling the primordial power spectrum');

  // --- Tabulate P(k) on a log grid. Evaluating Eisenstein & Hu 2M times would
  //     dominate the runtime; interpolation is accurate to ~1e-4 here.
  const ps = new PowerSpectrum(cosmology);
  const TAB = 4096;
  const lnkLo = Math.log(dk * 0.5);
  const lnkHi = Math.log(dk * n * 1.8);
  const tab = new Float64Array(TAB);
  for (let i = 0; i < TAB; i++) {
    tab[i] = Math.sqrt(ps.P(Math.exp(lnkLo + ((lnkHi - lnkLo) * i) / (TAB - 1))) / V);
  }
  const invStep = (TAB - 1) / (lnkHi - lnkLo);
  const sigmaOfK = (k: number): number => {
    const t = (Math.log(k) - lnkLo) * invStep;
    if (t <= 0) return tab[0];
    if (t >= TAB - 1) return tab[TAB - 1];
    const i = t | 0;
    const f = t - i;
    return tab[i] * (1 - f) + tab[i + 1] * f;
  };

  // --- Step 1: the Gaussian random field, built directly in Fourier space.
  onProgress?.(0.06, 'seeding quantum fluctuations');
  const dRe = new Float32Array(n3);
  const dIm = new Float32Array(n3);
  const half = n >> 1;
  const smoothR = smoothCells * dx;

  for (let i = 0; i < n; i++) {
    const kx = (i < half ? i : i - n) * dk;
    for (let j = 0; j < n; j++) {
      const ky = (j < half ? j : j - n) * dk;
      const rowBase = (i * n + j) * n;
      for (let l = 0; l < n; l++) {
        const kz = (l < half ? l : l - n) * dk;
        const idx = rowBase + l;
        const k2 = kx * kx + ky * ky + kz * kz;
        if (k2 === 0) { dRe[idx] = 0; dIm[idx] = 0; continue; }

        // Canonical representative of the conjugate pair {k, -k}: whichever has
        // the lexicographically larger signed index. Both members hash the same
        // triple, so delta(-k) = conj(delta(k)) exactly and the field is real.
        const ii = i < half ? i : i - n;
        const jj = j < half ? j : j - n;
        const ll = l < half ? l : l - n;
        let flip = false;
        if (ii < 0) flip = true;
        else if (ii === 0) { if (jj < 0) flip = true; else if (jj === 0 && ll < 0) flip = true; }
        const ai = flip ? -ii : ii, aj = flip ? -jj : jj, al = flip ? -ll : ll;

        const hv = hash3(ai + 8192, aj + 8192, al + 8192, seed);
        const [g1, g2] = gauss2(hv);
        const k = Math.sqrt(k2);
        let amp = sigmaOfK(k);
        if (smoothR > 0) amp *= Math.exp(-0.5 * k2 * smoothR * smoothR);

        // Self-conjugate modes (k == -k modulo the grid) must be purely real.
        const selfConj =
          (ii === 0 || ii === -half) && (jj === 0 || jj === -half) && (ll === 0 || ll === -half);
        if (selfConj) {
          dRe[idx] = amp * g1;
          dIm[idx] = 0;
        } else {
          const s = amp * Math.SQRT1_2;
          dRe[idx] = s * g1;
          dIm[idx] = (flip ? -1 : 1) * s * g2;
        }
      }
    }
    onProgress?.(0.06 + (i / n) * 0.12, 'seeding quantum fluctuations');
  }

  // --- Step 2: Psi(k) = i k / k^2 delta(k), one inverse FFT per component.
  const fft = new FFT3D(n);
  const re = new Float64Array(n3);
  const im = new Float64Array(n3);
  const psi = new Float32Array(n3 * 3);
  const axisNames = ['x', 'y', 'z'];

  for (let c = 0; c < 3; c++) {
    const base = 0.18 + c * 0.18;
    onProgress?.(base, `solving Poisson: displacement ${axisNames[c]}`);
    for (let i = 0; i < n; i++) {
      const kx = (i < half ? i : i - n) * dk;
      for (let j = 0; j < n; j++) {
        const ky = (j < half ? j : j - n) * dk;
        const rowBase = (i * n + j) * n;
        for (let l = 0; l < n; l++) {
          const kz = (l < half ? l : l - n) * dk;
          const idx = rowBase + l;
          const k2 = kx * kx + ky * ky + kz * kz;
          if (k2 === 0) { re[idx] = 0; im[idx] = 0; continue; }
          const kc = c === 0 ? kx : c === 1 ? ky : kz;
          const f = kc / k2;
          // multiply by i*f:  (a + bi) * i f = -b f + a f i
          re[idx] = -f * dIm[idx];
          im[idx] = f * dRe[idx];
        }
      }
    }
    fft.transform(re, im, +1, (t) => onProgress?.(base + t * 0.17, `inverse transform ${axisNames[c]}`));
    for (let p = 0; p < n3; p++) psi[p * 3 + c] = re[p];
  }

  // --- Step 3: the deformation tensor on the grid.
  //
  //   M_ab = d Psi_a / d q_b
  //
  // computed by central differences. Analytically M is the Hessian of the
  // velocity potential and therefore symmetric, so only six components are
  // independent; we symmetrise to remove the small asymmetry discretisation
  // introduces.
  onProgress?.(0.72, 'measuring the tidal field');
  const t00 = new Float32Array(n3), t11 = new Float32Array(n3), t22 = new Float32Array(n3);
  const t01 = new Float32Array(n3), t02 = new Float32Array(n3), t12 = new Float32Array(n3);
  const inv2dx = 1 / (2 * dx);
  const wrap = (v: number) => (v + n) % n;

  for (let i = 0; i < n; i++) {
    const ip = wrap(i + 1), imn = wrap(i - 1);
    for (let j = 0; j < n; j++) {
      const jp = wrap(j + 1), jm = wrap(j - 1);
      for (let l = 0; l < n; l++) {
        const lp = wrap(l + 1), lm = wrap(l - 1);
        const idx = (i * n + j) * n + l;
        const xa = (ip * n + j) * n + l, xb = (imn * n + j) * n + l;
        const ya = (i * n + jp) * n + l, yb = (i * n + jm) * n + l;
        const za = (i * n + j) * n + lp, zb = (i * n + j) * n + lm;
        const dPx_dx = (psi[xa * 3] - psi[xb * 3]) * inv2dx;
        const dPy_dy = (psi[ya * 3 + 1] - psi[yb * 3 + 1]) * inv2dx;
        const dPz_dz = (psi[za * 3 + 2] - psi[zb * 3 + 2]) * inv2dx;
        const dPy_dx = (psi[xa * 3 + 1] - psi[xb * 3 + 1]) * inv2dx;
        const dPx_dy = (psi[ya * 3] - psi[yb * 3]) * inv2dx;
        const dPz_dx = (psi[xa * 3 + 2] - psi[xb * 3 + 2]) * inv2dx;
        const dPx_dz = (psi[za * 3] - psi[zb * 3]) * inv2dx;
        const dPz_dy = (psi[ya * 3 + 2] - psi[yb * 3 + 2]) * inv2dx;
        const dPy_dz = (psi[za * 3 + 1] - psi[zb * 3 + 1]) * inv2dx;
        // lambda are eigenvalues of -M, the Zel'dovich sign convention
        t00[idx] = -dPx_dx; t11[idx] = -dPy_dy; t22[idx] = -dPz_dz;
        t01[idx] = -0.5 * (dPy_dx + dPx_dy);
        t02[idx] = -0.5 * (dPz_dx + dPx_dz);
        t12[idx] = -0.5 * (dPz_dy + dPy_dz);
      }
    }
    onProgress?.(0.72 + (i / n) * 0.14, 'measuring the tidal field');
  }

  // --- Step 3b: stratified (jittered) Lagrangian sampling.
  //
  // Sampling the displacement field exactly on its own grid leaves the initial
  // cubic lattice visible wherever matter has not moved far - the voids come
  // out looking like graph paper. Real simulations avoid this with "glass" or
  // random initial conditions. Here each particle is placed uniformly at random
  // inside its own cell, and both the displacement and the tidal tensor are
  // trilinearly interpolated to that position. The result is stratified (no
  // Poisson clumping), unbiased, and the lattice disappears completely.
  onProgress?.(0.86, 'placing matter');
  const qOut = new Float32Array(n3 * 3);
  const psiOut = new Float32Array(n3 * 3);
  const lambda = new Float32Array(n3 * 3);
  let sumPsi2 = 0;

  const lerpField = (
    f: Float32Array, comp: number, stride: number,
    i0: number, i1: number, j0: number, j1: number, l0: number, l1: number,
    u: number, v: number, w: number,
  ): number => {
    const at = (a: number, b: number, c: number) => f[((a * n + b) * n + c) * stride + comp];
    const c00 = at(i0, j0, l0) * (1 - u) + at(i1, j0, l0) * u;
    const c10 = at(i0, j1, l0) * (1 - u) + at(i1, j1, l0) * u;
    const c01 = at(i0, j0, l1) * (1 - u) + at(i1, j0, l1) * u;
    const c11 = at(i0, j1, l1) * (1 - u) + at(i1, j1, l1) * u;
    const c0 = c00 * (1 - v) + c10 * v;
    const c1 = c01 * (1 - v) + c11 * v;
    return c0 * (1 - w) + c1 * w;
  };

  let jst = (seed ^ 0x2545f491) >>> 0;
  const nextF = () => {
    jst ^= jst << 13; jst >>>= 0;
    jst ^= jst >>> 17;
    jst ^= jst << 5; jst >>>= 0;
    return jst / 4294967296;
  };

  for (let i = 0; i < n; i++) {
    const i1 = wrap(i + 1);
    for (let j = 0; j < n; j++) {
      const j1 = wrap(j + 1);
      for (let l = 0; l < n; l++) {
        const l1 = wrap(l + 1);
        const idx = (i * n + j) * n + l;
        const u = nextF(), v = nextF(), w = nextF();

        const px = lerpField(psi, 0, 3, i, i1, j, j1, l, l1, u, v, w);
        const py = lerpField(psi, 1, 3, i, i1, j, j1, l, l1, u, v, w);
        const pz = lerpField(psi, 2, 3, i, i1, j, j1, l, l1, u, v, w);

        const a = lerpField(t00, 0, 1, i, i1, j, j1, l, l1, u, v, w);
        const d = lerpField(t11, 0, 1, i, i1, j, j1, l, l1, u, v, w);
        const f6 = lerpField(t22, 0, 1, i, i1, j, j1, l, l1, u, v, w);
        const b = lerpField(t01, 0, 1, i, i1, j, j1, l, l1, u, v, w);
        const c = lerpField(t02, 0, 1, i, i1, j, j1, l, l1, u, v, w);
        const e = lerpField(t12, 0, 1, i, i1, j, j1, l, l1, u, v, w);
        const [e1, e2, e3] = symmetricEigenvalues3(a, b, c, d, e, f6);

        qOut[idx * 3] = (i + u) * dx;
        qOut[idx * 3 + 1] = (j + v) * dx;
        qOut[idx * 3 + 2] = (l + w) * dx;
        psiOut[idx * 3] = px; psiOut[idx * 3 + 1] = py; psiOut[idx * 3 + 2] = pz;
        lambda[idx * 3] = e1; lambda[idx * 3 + 1] = e2; lambda[idx * 3 + 2] = e3;
        sumPsi2 += px * px + py * py + pz * pz;
      }
    }
    onProgress?.(0.86 + (i / n) * 0.12, 'placing matter');
  }
  const q = qOut;

  // --- Step 4: locate collapsed peaks (future clusters and galaxies).
  onProgress?.(0.985, 'finding collapsed haloes');
  let s2 = 0;
  for (let i = 0; i < n3; i++) {
    const d = lambda[i * 3] + lambda[i * 3 + 1] + lambda[i * 3 + 2];
    s2 += d * d;
  }
  const sigmaGrid = Math.sqrt(s2 / n3);
  const knots = findKnots(n, dx, q, psiOut, lambda, sigmaGrid, cosmology);

  // --- Step 5: shuffle. Particles are stored in a random order so that drawing
  // only the first M of them is a uniform subsample of the whole box - which is
  // how the renderer does level of detail and how the quality slider works,
  // with no extra buffers and no popping.
  onProgress?.(0.99, 'shuffling for level of detail');
  let st = (seed ^ 0x5bf03635) >>> 0;
  const nextU = () => {
    st ^= st << 13; st >>>= 0;
    st ^= st >>> 17;
    st ^= st << 5; st >>>= 0;
    return st;
  };
  for (let i = n3 - 1; i > 0; i--) {
    const j = nextU() % (i + 1);
    if (i === j) continue;
    for (let c = 0; c < 3; c++) {
      let t = q[i * 3 + c]; q[i * 3 + c] = q[j * 3 + c]; q[j * 3 + c] = t;
      t = psiOut[i * 3 + c]; psiOut[i * 3 + c] = psiOut[j * 3 + c]; psiOut[j * 3 + c] = t;
      t = lambda[i * 3 + c]; lambda[i * 3 + c] = lambda[j * 3 + c]; lambda[j * 3 + c] = t;
    }
  }

  onProgress?.(1, 'universe ready');
  return {
    n,
    boxMpc: L,
    count: n3,
    q,
    psi: psiOut,
    lambda,
    rmsDisplacement: Math.sqrt(sumPsi2 / n3),
    baoScaleMpc: ps.baoScaleMpc,
    sigmaGrid,
    knots,
  };
}

/** Spherical-collapse linear overdensity threshold. */
export const DELTA_C = 1.686;

/**
 * Local maxima of lambda3 (the last axis to collapse) with a mutual exclusion
 * radius, ranked by peak height. Masses use the Lagrangian volume enclosed by
 * the exclusion radius times the mean matter density - the same logic as
 * Press-Schechter, applied to the actual realisation instead of an ensemble.
 */
function findKnots(
  n: number, dx: number, q: Float32Array, psi: Float32Array, lambda: Float32Array,
  sigmaGrid: number, cosmology: Cosmology,
): Knot[] {
  const n3 = n * n * n;
  const cand: { i: number; l3: number }[] = [];
  const wrap = (v: number) => (v + n) % n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let l = 0; l < n; l++) {
        const idx = (i * n + j) * n + l;
        const v = lambda[idx * 3 + 2];
        if (v <= 0) continue;
        let isMax = true;
        for (let a = -1; a <= 1 && isMax; a++) {
          for (let b = -1; b <= 1 && isMax; b++) {
            for (let c = -1; c <= 1; c++) {
              if (a === 0 && b === 0 && c === 0) continue;
              const nid = ((wrap(i + a) * n + wrap(j + b)) * n + wrap(l + c)) * 3 + 2;
              if (lambda[nid] > v) { isMax = false; break; }
            }
          }
        }
        if (isMax) cand.push({ i: idx, l3: v });
      }
    }
  }
  cand.sort((a, b) => b.l3 - a.l3);

  // Mean matter density in Msun / Mpc^3 (comoving)
  const rhoCritMsunMpc3 = 2.7754e11 * hOf(cosmology) * hOf(cosmology);
  const rhoBar = cosmology.Om * rhoCritMsunMpc3;

  const out: Knot[] = [];
  const maxKnots = Math.min(6000, Math.max(200, Math.floor(n3 / 400)));
  const exclusion = dx * 2.0;
  const excl2 = exclusion * exclusion;
  // Coarse spatial hash so exclusion testing stays linear
  const cell = exclusion;
  const buckets = new Map<string, number[]>();
  const keyOf = (x: number, y: number, z: number) =>
    `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;

  for (const c of cand) {
    if (out.length >= maxKnots) break;
    const p = c.i * 3;
    const x = q[p] + psi[p], y = q[p + 1] + psi[p + 1], z = q[p + 2] + psi[p + 2];
    let clash = false;
    const bx = Math.floor(x / cell), by = Math.floor(y / cell), bz = Math.floor(z / cell);
    for (let a = -1; a <= 1 && !clash; a++)
      for (let b = -1; b <= 1 && !clash; b++)
        for (let d = -1; d <= 1 && !clash; d++) {
          const arr = buckets.get(`${bx + a},${by + b},${bz + d}`);
          if (!arr) continue;
          for (const oi of arr) {
            const k = out[oi];
            const ddx = k.x - x, ddy = k.y - y, ddz = k.z - z;
            if (ddx * ddx + ddy * ddy + ddz * ddz < excl2) { clash = true; break; }
          }
        }
    if (clash) continue;

    const delta = lambda[p] + lambda[p + 1] + lambda[p + 2];
    if (delta <= 0) continue;
    const nu = delta / Math.max(sigmaGrid, 1e-9);
    // Spherical collapse: a peak virialises when its *linear* overdensity
    // D(a) * delta reaches delta_c = 1.686. Peaks whose delta is too small
    // never make it, because D(a) saturates once dark energy takes over -
    // structure formation in this universe is already almost finished.
    const Dcoll = DELTA_C / Math.max(delta, 1e-6);
    const zCollapse = growthRedshift(cosmology, Dcoll);
    // Mass from the Lagrangian volume of the exclusion sphere
    const massMsun = ((4 / 3) * Math.PI * Math.pow(exclusion, 3)) * rhoBar *
      Math.max(0.4, 1 + delta);
    out.push({
      x, y, z,
      qx: q[p], qy: q[p + 1], qz: q[p + 2],
      px: psi[p], py: psi[p + 1], pz: psi[p + 2],
      nu, massMsun, zCollapse,
    });
    const key = keyOf(x, y, z);
    const arr = buckets.get(key);
    if (arr) arr.push(out.length - 1); else buckets.set(key, [out.length - 1]);
  }
  return out;
}

/**
 * Invert D(a) = target to find the redshift at which linear growth reaches a
 * value. Returns NaN when the target is unreachable: in an accelerating
 * universe D(a) tends to a finite limit, so low peaks never collapse at all.
 */
export function growthRedshift(cosmology: Cosmology, targetD: number): number {
  if (targetD <= 0) return Infinity;
  const aMax = 1e4;
  if (targetD > growthFactor(cosmology, aMax)) return NaN;
  let lo = 1e-5, hi = aMax;
  for (let i = 0; i < 60; i++) {
    const mid = Math.sqrt(lo * hi);
    if (growthFactor(cosmology, mid) < targetD) lo = mid; else hi = mid;
  }
  return 1 / Math.sqrt(lo * hi) - 1;
}

/**
 * Eigenvalues of the symmetric 3x3 matrix [[a,b,c],[b,d,e],[c,e,f]],
 * returned sorted descending. Closed-form trigonometric solution - no iteration,
 * which matters when it runs two million times.
 */
export function symmetricEigenvalues3(
  a: number, b: number, c: number, d: number, e: number, f: number,
): [number, number, number] {
  const p1 = b * b + c * c + e * e;
  if (p1 < 1e-30) {
    const v = [a, d, f].sort((x, y) => y - x);
    return [v[0], v[1], v[2]];
  }
  const qm = (a + d + f) / 3;
  const p2 = (a - qm) ** 2 + (d - qm) ** 2 + (f - qm) ** 2 + 2 * p1;
  const p = Math.sqrt(p2 / 6);
  const ip = 1 / p;
  // B = (A - qm I) / p, then r = det(B)/2
  const b00 = ip * (a - qm), b11 = ip * (d - qm), b22 = ip * (f - qm);
  const b01 = ip * b, b02 = ip * c, b12 = ip * e;
  const det =
    b00 * (b11 * b22 - b12 * b12) - b01 * (b01 * b22 - b12 * b02) + b02 * (b01 * b12 - b11 * b02);
  let r = det / 2;
  r = r < -1 ? -1 : r > 1 ? 1 : r;
  const phi = Math.acos(r) / 3;
  const e1 = qm + 2 * p * Math.cos(phi);
  const e3 = qm + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
  const e2 = 3 * qm - e1 - e3;
  return [e1, e2, e3];
}

/** Zel'dovich density contrast at growth factor D for one particle's eigenvalues. */
export function zeldovichDensity(l1: number, l2: number, l3: number, D: number): number {
  const j = (1 - D * l1) * (1 - D * l2) * (1 - D * l3);
  return 1 / j;
}

/**
 * Cosmic-web classification (Hahn et al. 2007 T-web): count how many principal
 * axes have collapsed at this epoch.
 */
export function webType(l1: number, l2: number, l3: number, D: number, thresh = 0.0): 0 | 1 | 2 | 3 {
  let k = 0;
  if (D * l1 > thresh) k++;
  if (D * l2 > thresh) k++;
  if (D * l3 > thresh) k++;
  return k as 0 | 1 | 2 | 3;
}

/**
 * Peculiar velocity from the same displacement field:
 *   v = a * H(a) * f(a) * D(a) * Psi     (km/s for Psi in Mpc)
 * This is the linear continuity equation - the reason galaxies stream toward
 * filaments and clusters rather than sitting still in the Hubble flow.
 */
export function peculiarVelocityFactor(cosmo: Cosmology, a: number): number {
  const f = growthRate(cosmo, a);
  const D = growthFactor(cosmo, a);
  const HkmsMpc = cosmo.H0 * Efn(cosmo, a);
  return a * HkmsMpc * f * D;
}

export { hOf as littleH };
