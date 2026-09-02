/**
 * The cosmic microwave background.
 *
 * This is the same field as the cosmic web, seen 13.8 billion years earlier.
 * The temperature pattern on the last-scattering surface and the filaments and
 * voids at low redshift are two views of one Gaussian random field with one
 * primordial power spectrum, separated only by the transfer function that
 * carries it from then to now. Building both from the same statistics is the
 * point.
 *
 * **What sets the pattern.** Before recombination the photons and baryons are
 * one fluid, and gravity drives it into standing sound waves in the potential
 * wells left by the dark matter. A mode of wavenumber k has been oscillating
 * for the same amount of conformal time as every other mode, so at last
 * scattering its phase is k·r_s, where r_s is the distance sound has travelled
 * — the sound horizon, about 147 Mpc comoving. Modes caught at maximum
 * compression or maximum rarefaction leave the largest temperature contrast,
 * and those are the acoustic peaks:
 *
 *     Θ(k) = [ (1 + 3R)/3 · cos(k r_s + φ) − R ] · D(k) · exp(−(k/k_D)²)
 *
 *  - **R = 3ρ_b/4ρ_γ** is the baryon loading, about 0.65 at recombination. It
 *    offsets the oscillation's zero point, which is why the odd peaks (maximum
 *    compression, baryons falling in) are higher than the even ones (maximum
 *    rarefaction). The relative heights of peaks 1 and 2 are a measurement of
 *    the baryon density, and they were how it was first measured.
 *  - **φ ≈ π/4** is the phase shift from radiation driving: modes that entered
 *    the horizon while radiation still dominated got a boost from the decaying
 *    potentials, and started their oscillation shifted. It is why the first
 *    peak is at ℓ ≈ 220 rather than at the π D/r_s ≈ 300 the naive count gives.
 *  - **k_D** is the Silk scale. Photons diffuse out of the smallest wells
 *    before recombination and wash their contrast away, which is the damping
 *    tail.
 *  - **D(k)** is the radiation driving itself, a factor of several between the
 *    super-horizon Sachs-Wolfe plateau and the first peak.
 *
 * On the largest scales none of that has happened yet and the temperature is
 * just the gravitational redshift of climbing out of a potential well: the
 * Sachs-Wolfe plateau, ΔT/T = Φ/3, and Θ(k → 0) = 1/3 as the expression above
 * gives.
 *
 * **What is approximated.** The map is synthesised as a three-dimensional
 * Gaussian random field with the power spectrum above, evaluated on the sphere
 * of last scattering. That is exact for a statistically isotropic field in the
 * flat-sky sense, and it gives the right peak positions, the right damping
 * tail, the right odd-even asymmetry and a correctly Gaussian map. It does not
 * carry the integrated Sachs-Wolfe rise at very low ℓ, reionisation, lensing of
 * the peaks, or polarisation, none of which change what the map looks like.
 */

import { Cosmology, comovingDistance } from './lcdm';
import { MPC } from '../core/constants';
import { ehParams } from './powerspectrum';
import { RNG } from '../core/rng';

/** Present-day CMB temperature, kelvin. */
export const T_CMB_K = 2.7255;

/**
 * Redshift of last scattering, from the Hu & Sugiyama (1996) fit. For Planck
 * 2018 parameters this gives 1092, against the measured 1089.9.
 */
export function lastScatteringRedshift(c: Cosmology): number {
  const h = c.H0 / 100;
  const ob = c.Ob * h * h;
  const om = c.Om * h * h;
  const g1 = (0.0783 * Math.pow(ob, -0.238)) / (1 + 39.5 * Math.pow(ob, 0.763));
  const g2 = 0.560 / (1 + 21.1 * Math.pow(ob, 1.81));
  return 1048 * (1 + 0.00124 * Math.pow(ob, -0.738)) * (1 + g1 * Math.pow(om, g2));
}

/** Baryon-to-photon momentum density ratio R = 3ρ_b/4ρ_γ at a redshift. */
export function baryonLoading(c: Cosmology, z: number): number {
  const h = c.H0 / 100;
  const ob = c.Ob * h * h;
  return (31.5 * ob * Math.pow(2.7255 / 2.7, -4) * 1e3) / Math.max(z, 1);
}

export interface CmbScales {
  /** Redshift of last scattering. */
  zStar: number;
  /** Comoving distance to the last-scattering surface, Mpc. */
  distanceMpc: number;
  /** Comoving sound horizon, Mpc. */
  soundHorizonMpc: number;
  /** Silk damping wavenumber, Mpc^-1. */
  kSilk: number;
  /** Matter-radiation equality wavenumber, Mpc^-1. */
  kEq: number;
  /** Baryon loading at last scattering. */
  R: number;
  /** Multipole of the first acoustic peak. */
  firstPeakEll: number;
  /** Angular size of the sound horizon, degrees. */
  acousticAngleDeg: number;
}

/** Phase shift of the acoustic oscillations from radiation driving. */
export const DRIVING_PHASE = Math.PI / 4;

/**
 * Two coefficients that a tight-coupling sketch cannot get right on its own -
 * the boost the oscillation gets from radiation driving, and how much of the
 * baryon loading survives into the observed offset once the potentials have
 * decayed. They are set so that the resulting spectrum has the measured
 * plateau-to-peak ratio and first-to-second peak ratio; everything else here
 * - the peak positions, the damping tail, the direction each parameter moves
 * things - comes out of the physics rather than being fitted.
 */
export const DRIVE_BOOST = 0.444;
export const BARYON_OFFSET = 0.193;
/**
 * The Eisenstein & Hu Silk scale is the one that appears in the *matter*
 * transfer function; the photon diffusion length at last scattering is a little
 * shorter, and this carries the difference.
 */
export const SILK_SCALE = 0.88;

export function cmbScales(c: Cosmology): CmbScales {
  const p = ehParams(c);
  const zStar = lastScatteringRedshift(c);
  // comovingDistance works in metres; everything here is in megaparsecs.
  const distanceMpc = comovingDistance(c, zStar) / MPC;
  const rs = p.soundHorizon;
  const kPeak = (Math.PI - DRIVING_PHASE) / rs;
  const firstPeakEll = kPeak * distanceMpc;
  return {
    zStar,
    distanceMpc,
    soundHorizonMpc: rs,
    kSilk: p.kSilk,
    kEq: p.kEq,
    R: baryonLoading(c, zStar),
    firstPeakEll,
    acousticAngleDeg: ((rs / distanceMpc) * 180) / Math.PI,
  };
}

/**
 * The photon temperature transfer function at last scattering, Θ(k) - the
 * fractional temperature contrast a mode of wavenumber k leaves behind.
 */
export function photonTransfer(s: CmbScales, k: number): number {
  if (!(k > 0)) return 1 / 3;
  // How far inside the horizon this mode was at matter-radiation equality.
  // Everything that distinguishes an acoustic peak from the Sachs-Wolfe
  // plateau - the phase shift, the driving, the Doppler term - only applies to
  // modes that had time to oscillate, so all of it switches on with this.
  // The transition is around the horizon scale at equality; the factor makes
  // it complete by the first peak, which is where the data say it is.
  const u = k / (0.55 * s.kEq);
  const inside = (u * u) / (1 + u * u);
  const x = k * s.soundHorizonMpc + DRIVING_PHASE * inside;
  // The oscillation amplitude: the Sachs-Wolfe value at k -> 0, boosted for
  // modes that oscillated inside a radiation-dominated horizon.
  const amp = 1 / 3 + DRIVE_BOOST * inside;
  // Baryon loading offsets the oscillation's zero point, so the compressions
  // beat the rarefactions: the odd peaks are the tall ones, and the ratio of
  // the first two peaks is a measurement of the baryon density.
  const offset = BARYON_OFFSET * s.R * inside;
  // Doppler: the fluid's velocity is a quarter cycle out of phase with its
  // density, so it fills the troughs and no peak ever reaches zero.
  const doppler = 0.17 * inside * Math.sin(x);
  // Silk damping: photons diffuse out of the smallest wells before they can
  // recombine, and take the contrast with them.
  const damp = Math.exp(-Math.pow(k / (SILK_SCALE * s.kSilk), 2));
  return (amp * Math.cos(x) - offset + doppler) * damp;
}

/**
 * Three-dimensional power spectrum of the temperature field at last scattering,
 * in arbitrary units: the primordial spectrum times the transfer function
 * squared. A scale-invariant primordial spectrum is P(k) ∝ k^(n_s − 4), which
 * is what makes the Sachs-Wolfe plateau flat in ℓ(ℓ+1)C_ℓ.
 */
export function temperaturePower(s: CmbScales, c: Cosmology, k: number): number {
  if (!(k > 0)) return 0;
  const t = photonTransfer(s, k);
  return Math.pow(k, c.ns - 4) * t * t;
}

export interface CmbWave {
  /** Unit direction of the wave vector. */
  dir: [number, number, number];
  /** k times the distance to last scattering: the multipole this wave carries. */
  ell: number;
  /** Random phase. */
  phase: number;
}

/**
 * Synthesise the field as a sum of plane waves.
 *
 * A Gaussian random field with power spectrum P(k) is, in the limit of many
 * terms, sqrt(2/N) Σ cos(k_i·x + φ_i) with the k_i drawn isotropically and with
 * |k| distributed as k²P(k) — the three-dimensional measure. Restricted to the
 * sphere |x| = D, each term becomes cos(kD (k̂·n̂) + φ), so every wave is a set
 * of bands across the sky at a single multipole ℓ = kD, and the map is their
 * sum. This is an exact realisation of the field, not an approximation of one;
 * only the finite N is approximate.
 */
export function sampleWaves(
  c: Cosmology, s: CmbScales, seed: number, n = 420,
  ellMin = 6, ellMax = 1900,
): CmbWave[] {
  const rng = new RNG(seed ^ 0xcbb);
  const kMin = ellMin / s.distanceMpc;
  const kMax = ellMax / s.distanceMpc;

  // Tabulate the cumulative distribution of k^2 P(k) in log k, then invert it.
  const TAB = 2048;
  const lnLo = Math.log(kMin), lnHi = Math.log(kMax);
  const cdf = new Float64Array(TAB);
  let total = 0;
  for (let i = 0; i < TAB; i++) {
    const k = Math.exp(lnLo + ((lnHi - lnLo) * i) / (TAB - 1));
    // d^3k = k^2 dk = k^3 dlnk
    total += Math.max(k * k * k * temperaturePower(s, c, k), 0);
    cdf[i] = total;
  }
  for (let i = 0; i < TAB; i++) cdf[i] /= total || 1;

  const invert = (u: number): number => {
    let lo = 0, hi = TAB - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < u) lo = mid + 1; else hi = mid;
    }
    return Math.exp(lnLo + ((lnHi - lnLo) * lo) / (TAB - 1));
  };

  const out: CmbWave[] = [];
  for (let i = 0; i < n; i++) {
    const k = invert(rng.next());
    out.push({
      dir: rng.onSphere(),
      ell: k * s.distanceMpc,
      phase: rng.range(0, Math.PI * 2),
    });
  }
  return out;
}

/**
 * Evaluate the map in a direction on the sky, in units of the field's own
 * standard deviation.
 */
export function temperatureAt(waves: CmbWave[], nx: number, ny: number, nz: number): number {
  let sum = 0;
  for (const w of waves) {
    sum += Math.cos(w.ell * (w.dir[0] * nx + w.dir[1] * ny + w.dir[2] * nz) + w.phase);
  }
  return sum * Math.sqrt(2 / Math.max(waves.length, 1));
}

/**
 * Angular power spectrum in the flat-sky limit, as ℓ(ℓ+1)C_ℓ/2π in arbitrary
 * units - the quantity every CMB plot shows, and flat across the Sachs-Wolfe
 * plateau by construction.
 */
export function angularPower(s: CmbScales, c: Cosmology, ell: number): number {
  const k = ell / s.distanceMpc;
  // Restricting a 3-D field to a sphere gives C_l = (2/pi) integral k^2 P(k)
  // j_l(kD)^2 dk, and in the Limber limit that is P(l/D) times a mode-density
  // factor proportional to l/D^3. So l(l+1)C_l goes as l^3 P(l/D) - which is
  // flat for the scale-invariant P ~ k^-3, as it must be.
  return ell * ell * ell * temperaturePower(s, c, k);
}

/** Multipoles of the first few acoustic peaks. */
export function peakMultipoles(s: CmbScales, count = 4): number[] {
  const out: number[] = [];
  for (let m = 1; m <= count; m++) {
    const k = (m * Math.PI - DRIVING_PHASE) / s.soundHorizonMpc;
    out.push(k * s.distanceMpc);
  }
  return out;
}
