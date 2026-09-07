/**
 * The Sunyaev-Zel'dovich effect: a cluster's shadow on the beginning of time.
 *
 * The microwave background has been travelling since the universe was four
 * hundred thousand years old, and on the way some of it goes through galaxy
 * clusters. A cluster is a hundred million degrees of ionised gas, and its
 * electrons are moving fast enough that a photon which scatters off one comes
 * away with more energy than it arrived with. About one photon in a hundred
 * scatters. The ones that do get kicked up the spectrum, and the ones that
 * would have been there at low frequency are missing.
 *
 * So a cluster appears as a **cold spot** below 217 GHz, as nothing at all at
 * 217 GHz, and as a **hot spot** above it. It is the same gas in all three
 * cases; what changes is which side of the spectrum you are looking at.
 * Photographs of the same cluster in the two bands are negatives of each other,
 * and that inversion is the signature - nothing else in the sky does it.
 *
 * Two things about this are worth the whole rest of the file:
 *
 *  - **It does not care how far away the cluster is.** Every other way of
 *    finding a cluster gets harder with distance, because flux falls as the
 *    inverse square. This is not a flux: it is a *fractional distortion* of a
 *    background that fills the sky uniformly, so a cluster at redshift one
 *    makes exactly the same dent as the same cluster next door. Surveys built
 *    on it find clusters at any distance they can resolve, which is why the
 *    South Pole Telescope and Planck catalogues look nothing like the optical
 *    ones.
 *
 *  - **It measures the pressure, and the pressure is the mass.** The
 *    distortion integrates n_e T_e along the line of sight, which is the
 *    electron pressure; integrate that over the cluster's face and you have
 *    the total thermal energy of its gas, which tracks the halo mass with a
 *    scatter of about fifteen per cent. It is the cleanest mass proxy anyone
 *    has for a cluster.
 *
 * There is a second, much smaller effect from the cluster's own motion: the
 * scattering electrons carry the cluster's velocity, so the scattered light
 * is Doppler shifted. That one is frequency independent - it cannot be
 * separated by colour, only by knowing the thermal part well enough to
 * subtract it - and it is about a tenth the size. It was first measured in
 * 2012, forty years after it was predicted.
 */

import { C, SIGMA_THOMSON, T_CMB, H_PLANCK, K_B, M_PROTON, MPC, M_SUN } from '../core/constants';

/** Electron rest energy, keV. The number the whole effect is scaled by. */
export const MEC2_KEV = 510.99895;

/** Hydrogen mass fraction of primordial gas, from big-bang nucleosynthesis. */
export const HYDROGEN_FRACTION = 0.76;

/**
 * Mean molecular weight per electron, in proton masses.
 *
 * Fully ionised hydrogen and helium give one electron per proton for the
 * hydrogen and one per two nucleons for the helium: 2/(1+X) = 1.14.
 */
export const MU_E = 2 / (1 + HYDROGEN_FRACTION);

/** Dimensionless frequency x = h nu / k T_cmb. */
export function dimensionlessFrequency(ghz: number): number {
  return (H_PLANCK * ghz * 1e9) / (K_B * T_CMB);
}

/** And back again. */
export function frequencyGHz(x: number): number {
  return (x * K_B * T_CMB) / (H_PLANCK * 1e9);
}

/**
 * The thermal SZ spectral shape, g(x) = x coth(x/2) - 4.
 *
 * Negative at low frequency, zero at x = 3.830, positive above. In the
 * Rayleigh-Jeans limit it tends to -2, which is where the rule of thumb
 * "the decrement is twice the y parameter" comes from.
 *
 * This is the non-relativistic form. A ten-keV cluster has electrons at a
 * fifth of the speed of light and the relativistic corrections are a few per
 * cent, which matters for a measurement and not for a picture.
 */
export function szSpectrum(x: number): number {
  if (x < 1e-6) return -2;
  // coth(x/2) written so it does not overflow for large x
  const e = Math.exp(-x);
  return x * ((1 + e) / (1 - e)) - 4;
}

/**
 * Where the thermal effect vanishes: the root of x coth(x/2) = 4, to the last
 * digit a double can hold. About 217.5 GHz, and Planck put a band on it.
 */
export const SZ_NULL_X = 3.8300160963090746;
export const SZ_NULL_GHZ = frequencyGHz(SZ_NULL_X);

/** The four Planck high-frequency bands that bracket the null, GHz. */
export const PLANCK_BANDS = [100, 143, 217, 353] as const;

/**
 * Compton y from an electron column density and a gas temperature.
 *
 * y = integral (k T_e / m_e c^2) n_e sigma_T dl - the fraction of the photon
 * energy the gas can redistribute. A rich cluster reaches 1e-4 through its
 * centre, which is one part in ten thousand of a two-point-seven-kelvin sky:
 * about half a millikelvin, and it took twenty years to measure the first one.
 */
export function comptonY(columnPerM2: number, kTeKeV: number): number {
  return (columnPerM2 * SIGMA_THOMSON * kTeKeV) / MEC2_KEV;
}

/** Thomson optical depth of an electron column: about one per cent. */
export function thomsonDepth(columnPerM2: number): number {
  return columnPerM2 * SIGMA_THOMSON;
}

/**
 * The temperature the sky appears to change by, K.
 *
 * Signed: negative below the null, positive above it. Independent of the
 * cluster's distance, which is the entire point.
 */
export function thermalSZ(y: number, ghz: number): number {
  return T_CMB * y * szSpectrum(dimensionlessFrequency(ghz));
}

/**
 * The kinetic effect: the cluster's own motion through the background, K.
 *
 * A cluster coming toward you drags the scattered photons up in frequency at
 * every frequency equally, so it shows as a warm spot with no colour to it.
 * Sign convention: a negative line-of-sight velocity is approaching, and gives
 * a positive signal.
 */
export function kineticSZ(tau: number, vLosMs: number): number {
  return -T_CMB * tau * (vLosMs / C);
}

// ---------------------------------------------------------------------------
// A cluster's gas
// ---------------------------------------------------------------------------

/**
 * The electron column through a beta model at a projected radius.
 *
 * The isothermal beta model with beta = 2/3 is what X-ray surface brightness
 * profiles are actually fitted with, n(r) = n0 (1 + r^2/rc^2)^(-1), and at that
 * exponent the line-of-sight integral has a closed form. Truncated at the
 * cluster's outer radius, because an untruncated beta model has infinite mass:
 *
 *     N(b) = 2 n0 rc^2 atan(L / s) / s,  s = sqrt(rc^2 + b^2),
 *                                        L = sqrt(R^2 - b^2)
 *
 * Everything in metres and per cubic metre; the answer is per square metre.
 */
export function betaColumn(
  n0: number, rcM: number, bM: number, cutM: number,
): number {
  if (bM >= cutM) return 0;
  const s = Math.sqrt(rcM * rcM + bM * bM);
  const l = Math.sqrt(Math.max(0, cutM * cutM - bM * bM));
  return (2 * n0 * rcM * rcM * Math.atan(l / s)) / s;
}

/**
 * Central electron density of a beta model holding a given gas mass, per m^3.
 *
 * The enclosed mass of a beta = 2/3 model is 4 pi rho0 rc^3 (Y - atan Y) with
 * Y = R/rc, which inverts directly.
 */
export function betaCentralDensity(
  gasMassKg: number, rcM: number, cutM: number,
): number {
  const Y = cutM / rcM;
  const rho0 = gasMassKg / (4 * Math.PI * rcM * rcM * rcM * (Y - Math.atan(Y)));
  return rho0 / (MU_E * M_PROTON);
}

export interface ClusterGas {
  /** Central electron density, per cubic metre. */
  n0: number;
  /** Core radius, metres. */
  rcM: number;
  /** Outer radius the gas is truncated at, metres. */
  cutM: number;
  /** Electron temperature, keV. */
  kTeKeV: number;
}

/**
 * Describe a cluster's gas from the things a cluster is generated with.
 *
 * Takes the same beta-model shape the intracluster medium is drawn with, so
 * the signal and the picture are the same gas.
 */
export function clusterGas(
  massMsun: number, radiusMpc: number, icmKeV: number,
  gasFraction = 0.12, coreFraction = 0.08,
): ClusterGas {
  const cutM = radiusMpc * MPC;
  const rcM = cutM * coreFraction;
  return {
    n0: betaCentralDensity(gasFraction * massMsun * M_SUN, rcM, cutM),
    rcM,
    cutM,
    kTeKeV: icmKeV,
  };
}

/** Compton y at a projected radius through a cluster, metres. */
export function yAt(g: ClusterGas, bM: number): number {
  return comptonY(betaColumn(g.n0, g.rcM, bM, g.cutM), g.kTeKeV);
}

/** Optical depth at a projected radius. */
export function tauAt(g: ClusterGas, bM: number): number {
  return thomsonDepth(betaColumn(g.n0, g.rcM, bM, g.cutM));
}

/**
 * The integrated Compton parameter, in square metres of solid-angle-weighted
 * area: Y = integral y dA over the cluster's face.
 *
 * This is the mass proxy. It is the total thermal energy of the gas divided by
 * m_e c^2 / sigma_T, so it does not care how the gas is arranged - a merging
 * cluster and a relaxed one of the same mass give nearly the same Y, which
 * is why it scatters half as much against mass as anything measured in
 * X-rays.
 */
export function integratedY(g: ClusterGas, outM = g.cutM): number {
  // 2 pi integral b y(b) db, on a grid fine enough for the core
  const n = 2048;
  let sum = 0;
  const db = outM / n;
  for (let i = 0; i < n; i++) {
    const b = (i + 0.5) * db;
    sum += 2 * Math.PI * b * yAt(g, b) * db;
  }
  return sum;
}

/**
 * The Y-M relation, in the form the surveys quote it: Y in Mpc^2 against mass.
 *
 * Self-similar collapse gives Y proportional to M^(5/3), because the thermal
 * energy is GM^2/R and R goes as M^(1/3). Real clusters follow it to within
 * about fifteen per cent, over two decades of mass, which is remarkable for
 * anything in astrophysics.
 */
export function integratedYMpc2(g: ClusterGas, outM = g.cutM): number {
  return integratedY(g, outM) / (MPC * MPC);
}
