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

  // --- Step 3: Lagrangian coordinates and the deformation tensor.
  onProgress?.(0.74, 'measuring the tidal field');
  const q = new Float32Array(n3 * 3);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const rowBase = (i * n + j) * n;
      for (let l = 0; l < n; l++) {
        const p = (rowBase + l) * 3;
        q[p] = i * dx;
        q[p + 1] = j * dx;
        q[p + 2] = l * dx;
      }
    }
  }

  const lambda = new Float32Array(n3 * 3);
  const inv2dx = 1 / (2 * dx);
  const wrap = (v: number) => (v + n) % n;
  const M = new Float64Array(9);
  let sumPsi2 = 0;

  for (let i = 0; i < n; i++) {
    const ip = wrap(i + 1), imn = wrap(i - 1);
    for (let j = 0; j < n; j++) {
      const jp = wrap(j + 1), jm = wrap(j - 1);
      for (let l = 0; l < n; l++) {
        const lp = wrap(l + 1), lm = wrap(l - 1);
        const idx = (i * n + j) * n + l;
        const nb = [
          [(ip * n + j) * n + l, (imn * n + j) * n + l],
          [(i * n + jp) * n + l, (i * n + jm) * n + l],
          [(i * n + j) * n + lp, (i * n + j) * n + lm],
        ];
        // M[a*3+b] = d Psi_a / d q_b
        for (let a = 0; a < 3; a++) {
          for (let b = 0; b < 3; b++) {
            M[a * 3 + b] = (psi[nb[b][0] * 3 + a] - psi[nb[b][1] * 3 + a]) * inv2dx;
          }
        }
        // Symmetrise (analytically M is a Hessian; discretisation breaks it slightly)
        const m01 = 0.5 * (M[1] + M[3]);
        const m02 = 0.5 * (M[2] + M[6]);
        const m12 = 0.5 * (M[5] + M[7]);
        // lambda_i are eigenvalues of -M (the usual Zel'dovich sign convention)
        const [e1, e2, e3] = symmetricEigenvalues3(-M[0], -m01, -m02, -M[4], -m12, -M[8]);
        lambda[idx * 3] = e1;
        lambda[idx * 3 + 1] = e2;
        lambda[idx * 3 + 2] = e3;

        const px = psi[idx * 3], py = psi[idx * 3 + 1], pz = psi[idx * 3 + 2];
        sumPsi2 += px * px + py * py + pz * pz;
      }
    }
    onProgress?.(0.74 + (i / n) * 0.24, 'measuring the tidal field');
  }

  onProgress?.(1, 'universe ready');
  return {
    n,
    boxMpc: L,
    count: n3,
    q,
    psi,
    lambda,
    rmsDisplacement: Math.sqrt(sumPsi2 / n3),
    baoScaleMpc: ps.baoScaleMpc,
  };
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
