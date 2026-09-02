/**
 * Gravitational waves from a compact binary.
 *
 * Two black holes in orbit are a time-varying mass quadrupole, and general
 * relativity says a time-varying quadrupole radiates. The radiation carries
 * energy away, the orbit shrinks, the frequency rises, and the whole thing runs
 * away into a merger. That runaway is the chirp, and almost every number in it
 * is fixed by a single combination of the two masses:
 *
 *     Mc = (m1 m2)^(3/5) / (m1 + m2)^(1/5)
 *
 * the **chirp mass**. The rate at which the frequency sweeps depends on Mc and
 * on nothing else at leading order, which is why the first thing anyone
 * measures from a detection is the chirp mass, and why they can measure it
 * without knowing the distance, the inclination or the individual masses.
 *
 * The pieces here:
 *
 *  - **Inspiral.** The quadrupole formula gives the orbital decay
 *    `da/dt = −64/5 · G³ m1 m2 M / (c⁵ a³)`, which integrates to a time to
 *    merger going as `a⁴`. Frequency and amplitude follow.
 *  - **Merger.** The post-Newtonian expansion fails when the holes touch. The
 *    inspiral is taken to end at the innermost stable circular orbit of the
 *    total mass, `r = 6GM/c²`, which for two 30 M☉ holes is a gravitational-wave
 *    frequency of 68 Hz. That is a lower bound and a known underestimate for
 *    comparable masses: the real waveform runs on past it and peaks near the
 *    ringdown frequency, about 250 Hz, which is what is interpolated to here.
 *  - **Ringdown.** What is left is one distorted hole settling down by radiating
 *    its quasi-normal modes. The frequency and damping time of the fundamental
 *    mode are functions of the final mass and spin alone (Berti, Cardoso &
 *    Will 2006), so the ringdown is a test that the object really is a Kerr
 *    black hole and not something else.
 *
 * Checked against GW150914 throughout: 36 + 29 M☉ merging at about 410 Mpc,
 * chirp mass 28.6 M☉, peak strain 1.0e-21, final mass 62 M☉, final spin 0.67,
 * and three solar masses of rest energy radiated in a fifth of a second.
 */

import { C, G, M_SUN, MPC } from '../core/constants';

/** Chirp mass from two component masses, in whatever units they come in. */
export function chirpMass(m1: number, m2: number): number {
  const m = m1 + m2;
  if (!(m > 0)) return 0;
  return Math.pow(m1 * m2, 0.6) / Math.pow(m, 0.2);
}

/** Symmetric mass ratio η = m1 m2 / (m1+m2)². 0.25 for equal masses. */
export function symmetricRatio(m1: number, m2: number): number {
  const m = m1 + m2;
  return m > 0 ? (m1 * m2) / (m * m) : 0;
}

/**
 * Rate at which a circular orbit shrinks to gravitational radiation, m/s.
 * Negative: the separation always decreases.
 */
export function separationDecay(aM: number, m1Kg: number, m2Kg: number): number {
  const M = m1Kg + m2Kg;
  return (-64 / 5) * ((G ** 3 * m1Kg * m2Kg * M) / (C ** 5 * aM ** 3));
}

/**
 * Time from a given separation to coalescence, seconds.
 *
 * `τ = 5 c⁵ a⁴ / (256 G³ m1 m2 M)`. The fourth power is why binaries spend
 * essentially all their lives wide and quiet and then merge in an eyeblink: the
 * Hulse-Taylor pulsar has 300 million years left, and the last second of that
 * covers the final few hundred kilometres.
 */
export function timeToMerger(aM: number, m1Kg: number, m2Kg: number): number {
  const M = m1Kg + m2Kg;
  return (5 * C ** 5 * aM ** 4) / (256 * G ** 3 * m1Kg * m2Kg * M);
}

/** Separation that leaves a given time to merger - the inverse of the above. */
export function separationAtTime(tauS: number, m1Kg: number, m2Kg: number): number {
  const M = m1Kg + m2Kg;
  return Math.pow((256 * G ** 3 * m1Kg * m2Kg * M * Math.max(tauS, 0)) / (5 * C ** 5), 0.25);
}

/** Orbital angular frequency of a circular binary, rad/s. */
export function orbitalOmega(aM: number, mTotKg: number): number {
  return Math.sqrt((G * mTotKg) / aM ** 3);
}

/**
 * Gravitational-wave frequency, Hz. The quadrupole pattern repeats twice per
 * orbit - a binary looks the same after half a turn - so the wave comes out at
 * twice the orbital frequency, and that factor of two is a direct consequence
 * of the radiation being quadrupolar rather than dipolar.
 */
export function waveFrequency(aM: number, mTotKg: number): number {
  return orbitalOmega(aM, mTotKg) / Math.PI;
}

/**
 * Gravitational-wave frequency at a time τ before coalescence, Hz, straight
 * from the chirp mass:
 *
 *     f = (1/π) (5/(256 τ))^(3/8) (G Mc/c³)^(−5/8)
 */
export function chirpFrequency(tauS: number, chirpKg: number): number {
  const tau = Math.max(tauS, 1e-9);
  const mc = (G * chirpKg) / C ** 3;
  return (1 / Math.PI) * Math.pow(5 / (256 * tau), 3 / 8) * Math.pow(mc, -5 / 8);
}

/**
 * Strain amplitude at a distance, dimensionless:
 *
 *     h = (4/d) (G Mc/c²)^(5/3) (π f/c)^(2/3)
 *
 * This is the sky- and inclination-averaged scale. GW150914 peaked at 1e-21,
 * which over LIGO's four-kilometre arms is four thousandths of a proton radius.
 */
export function strainAmplitude(chirpKg: number, freqHz: number, distanceM: number): number {
  const gm = (G * chirpKg) / C ** 2;
  return (4 / Math.max(distanceM, 1)) * Math.pow(gm, 5 / 3) * Math.pow((Math.PI * freqHz) / C, 2 / 3);
}

/** Innermost stable circular orbit of a Schwarzschild hole of this mass, m. */
export function iscoRadius(mTotKg: number): number {
  return (6 * G * mTotKg) / C ** 2;
}

/**
 * Gravitational-wave frequency at the ISCO, where the inspiral ends and the
 * post-Newtonian description stops being useful.
 */
export function iscoFrequency(mTotKg: number): number {
  return waveFrequency(iscoRadius(mTotKg), mTotKg);
}

/**
 * Fraction of the total rest mass radiated as gravitational waves.
 *
 * Anchored at both ends. In the test-mass limit the answer is exactly the
 * binding energy at the Schwarzschild ISCO, `1 − √(8/9) = 0.0572`, per unit of
 * reduced mass; the quadratic term carries it up to the 4.8% that numerical
 * relativity finds for equal masses. GW150914 comes out at 4.7%, or three
 * solar masses of rest energy, which is what was measured.
 *
 * It is the most efficient process known by a wide margin: hydrogen fusion
 * converts 0.7%, and accretion onto a maximally spinning hole about 30% - but
 * that has to be radiated slowly, and this is radiated in a fifth of a second.
 */
export function radiatedFraction(m1: number, m2: number): number {
  const eta = symmetricRatio(m1, m2);
  return 0.0572 * eta * (1 + 9.43 * eta);
}

/**
 * Dimensionless spin of the remnant, from the same class of fits. Two
 * non-spinning holes of equal mass leave one spinning at a = 0.686, and no
 * merger of non-spinning holes can leave a hole spinning faster than that.
 */
export function finalSpin(m1: number, m2: number): number {
  const eta = symmetricRatio(m1, m2);
  return Math.min(0.998, 2 * Math.sqrt(3) * eta - 3.871 * eta * eta + 4.028 * eta * eta * eta);
}

/** Mass of the remnant, in the same units as the inputs. */
export function finalMass(m1: number, m2: number): number {
  return (m1 + m2) * (1 - radiatedFraction(m1, m2));
}

/**
 * Fundamental quasi-normal mode of a Kerr hole - the note it rings at as it
 * settles. Berti, Cardoso & Will (2006) fits for the l = m = 2 mode.
 *
 * @returns frequency in Hz and damping time in seconds
 */
export function ringdown(finalMassKg: number, spin: number):
{ freqHz: number; tauS: number; quality: number } {
  const a = Math.min(Math.max(spin, 0), 0.998);
  const f1 = 1.5251, f2 = -1.1568, f3 = 0.1292;
  const q1 = 0.7000, q2 = 1.4187, q3 = -0.4990;
  const mOmega = f1 + f2 * Math.pow(1 - a, f3);
  const quality = q1 + q2 * Math.pow(1 - a, q3);
  const freqHz = (mOmega * C ** 3) / (2 * Math.PI * G * finalMassKg);
  return { freqHz, tauS: quality / (Math.PI * freqHz), quality };
}

export interface Binary {
  /** Component masses, solar. */
  m1: number;
  m2: number;
  /** Luminosity distance, Mpc. */
  distanceMpc: number;
}

export interface BinaryState {
  /** Time relative to coalescence, seconds. Negative before the merger. */
  t: number;
  /** Separation, metres. Zero after the merger. */
  separationM: number;
  /** Orbital phase, radians. */
  phase: number;
  /** Gravitational-wave frequency, Hz. */
  freqHz: number;
  /** Strain amplitude at the given distance. */
  strain: number;
  /** Plus polarisation, face-on. */
  hPlus: number;
  /** Cross polarisation, face-on. */
  hCross: number;
  /** 'inspiral', 'merger' or 'ringdown'. */
  stage: 'inspiral' | 'merger' | 'ringdown';
}

/**
 * The whole waveform: inspiral up to the ISCO, a short merger, then ringdown.
 *
 * The phase is integrated in closed form from the chirp - `Φ(τ) ∝ τ^(5/8)` -
 * rather than stepped, so evaluating at any time is exact and the waveform does
 * not drift however far it is scrubbed.
 */
export function binaryState(b: Binary, t: number): BinaryState {
  const m1 = b.m1 * M_SUN, m2 = b.m2 * M_SUN;
  const M = m1 + m2;
  const mc = chirpMass(m1, m2);
  const d = b.distanceMpc * MPC;

  const fIsco = iscoFrequency(M);
  // Time before coalescence at which the inspiral reaches the ISCO.
  const tauIsco = (5 / 256) * Math.pow((G * mc) / C ** 3, -5 / 3)
    * Math.pow(Math.PI * fIsco, -8 / 3);

  if (t < -tauIsco) {
    const tau = -t;
    const f = chirpFrequency(tau, mc);
    const a = separationAtTime(tau, m1, m2);
    // Phi(tau) = -2 (5 G Mc / c^3)^(-5/8) tau^(5/8), from integrating omega dt.
    const phase = -2 * Math.pow(tau / (5 * ((G * mc) / C ** 3)), 5 / 8);
    const h = strainAmplitude(mc, f, d);
    return {
      t, separationM: a, phase, freqHz: f, strain: h,
      hPlus: h * Math.cos(2 * phase), hCross: h * Math.sin(2 * phase),
      stage: 'inspiral',
    };
  }

  const mf = finalMass(m1, m2);
  const spin = finalSpin(m1, m2);
  const rd = ringdown(mf, spin);
  // Peak strain, taken at the ISCO and carried through the merger.
  const hPeak = strainAmplitude(mc, fIsco, d);
  const phaseIsco = -2 * Math.pow(tauIsco / (5 * ((G * mc) / C ** 3)), 5 / 8);

  if (t < 0) {
    // Merger: a few light-crossing times of the final hole, during which the
    // amplitude peaks and the frequency runs from the ISCO value up to the
    // ringdown's. Interpolated, because this is exactly the regime where only
    // numerical relativity gets it right.
    const u = 1 - -t / tauIsco;
    const f = fIsco + (rd.freqHz - fIsco) * u * u;
    const phase = phaseIsco + Math.PI * f * (t + tauIsco);
    const h = hPeak * (1 + 0.6 * u);
    return {
      t, separationM: iscoRadius(M) * (1 - u), phase, freqHz: f, strain: h,
      hPlus: h * Math.cos(2 * phase), hCross: h * Math.sin(2 * phase),
      stage: 'merger',
    };
  }

  const h = hPeak * 1.6 * Math.exp(-t / rd.tauS);
  const phase = Math.PI * rd.freqHz * t;
  return {
    t, separationM: 0, phase, freqHz: rd.freqHz, strain: h,
    hPlus: h * Math.cos(2 * phase), hCross: h * Math.sin(2 * phase),
    stage: 'ringdown',
  };
}

/**
 * How much of the wave a detector at a given inclination sees. Face-on is
 * brightest and circularly polarised; edge-on is a factor of two fainter and
 * linearly polarised, which is how inclination is measured at all.
 */
export function inclinationResponse(inclinationRad: number): { plus: number; cross: number } {
  const c = Math.cos(inclinationRad);
  return { plus: (1 + c * c) / 2, cross: c };
}

/**
 * Peak luminosity in gravitational waves, watts.
 *
 * The scale is `c⁵/G ≈ 3.6e52 W` - a power built only out of constants, and the
 * ceiling on what anything can radiate. GW150914 reached about a thousandth of
 * it: 3.6e49 W, which for a fifth of a second outshone every star in the
 * observable universe put together by a factor of a hundred, in a form of
 * radiation that passed through all of them without being noticed.
 */
export function peakLuminosity(m1: number, m2: number): number {
  const eta = symmetricRatio(m1, m2);
  // Fit to numerical relativity, in units of c^5/G.
  return 0.0164 * eta * eta * (C ** 5 / G);
}

/** The Planck luminosity c⁵/G, watts: the ceiling on any radiated power. */
export const PLANCK_LUMINOSITY = C ** 5 / G;
