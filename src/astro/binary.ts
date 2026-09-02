/**
 * Binary and multiple star systems.
 *
 * Most stars are not alone. About half of solar-type stars have a companion,
 * and the fraction climbs with mass - nearly every O star is in a multiple
 * system, while only a fifth of M dwarfs are. Ignoring that would make this
 * universe wrong about the majority of its stars.
 *
 * Where planets can survive around a pair is not a matter of taste. Holman &
 * Wiegert (1999) integrated tens of thousands of test particles around binaries
 * and fitted the boundary of the stable region; those fits are used verbatim
 * here. They give two families:
 *
 *  - S-type, a planet orbiting one star with the other outside. Stable only
 *    inside a few tenths of the binary separation.
 *  - P-type, a planet orbiting both. Stable only outside two to four times the
 *    separation - which is exactly where Kepler-16b and its successors were
 *    found, sitting just beyond the critical radius.
 *
 * Everything between those two limits is unstable, and this simulation leaves
 * it empty.
 */

import { AU, DAY, DEG, G, M_SUN, YEAR } from '../core/constants';
import { RNG } from '../core/rng';
import { makeStar, type Star } from './stellar';
import { period, type OrbitalElements } from '../physics/kepler';

/**
 * Fraction of stars of a given mass that have at least one companion
 * (Duchene & Kraus 2013). Rises monotonically with mass: massive stars form in
 * dense, high-accretion environments that make pairing easy, and they are also
 * harder to unbind once paired.
 */
export function multiplicityFraction(massMsun: number): number {
  if (massMsun < 0.1) return 0.22;
  if (massMsun < 0.5) return 0.26 + 0.12 * ((massMsun - 0.1) / 0.4);
  if (massMsun < 1.3) return 0.38 + 0.12 * ((massMsun - 0.5) / 0.8);
  if (massMsun < 5) return 0.50 + 0.14 * ((massMsun - 1.3) / 3.7);
  if (massMsun < 16) return 0.64 + 0.20 * ((massMsun - 5) / 11);
  return 0.90;
}

export interface Companion {
  star: Star;
  /** Semi-major axis of the relative orbit, metres. */
  aM: number;
  e: number;
  inclination: number;
  periodS: number;
  /** Mass ratio m2/(m1+m2). */
  mu: number;
  elements: OrbitalElements;
  /** Outer limit for planets orbiting one star alone, metres. NaN if none. */
  sTypeLimit: number;
  /** Inner limit for planets orbiting both, metres. */
  pTypeLimit: number;
}

/**
 * Critical semi-major axis for an S-type (circumstellar) planet, as a fraction
 * of the binary separation. Holman & Wiegert (1999), equation 1.
 */
export function sTypeCritical(e: number, mu: number): number {
  return 0.464 - 0.380 * mu - 0.631 * e + 0.586 * mu * e
    + 0.150 * e * e - 0.198 * mu * e * e;
}

/**
 * Critical semi-major axis for a P-type (circumbinary) planet, as a multiple of
 * the binary separation. Holman & Wiegert (1999), equation 3.
 */
export function pTypeCritical(e: number, mu: number): number {
  return 1.60 + 5.10 * e - 2.22 * e * e + 4.12 * mu
    - 4.27 * e * mu - 5.09 * mu * mu + 4.61 * e * e * mu * mu;
}

/**
 * Draw a companion, or null for a single star.
 *
 * The period distribution is Raghavan et al. (2010): log-normal in days with a
 * mean of 5.03 and a width of 2.28 dex - a span from contact binaries with
 * hour-long orbits to pairs taking a million years, which is why "binary"
 * covers systems with nothing else in common. Orbits shorter than about twelve
 * days are circularised by tides, and this reproduces that too.
 */
export function sampleCompanion(
  rng: RNG, primary: Star, ageGyr: number, metallicity: number,
): Companion | null {
  if (!rng.chance(multiplicityFraction(primary.massMsun))) return null;

  // Mass ratio: close to flat for solar-type primaries, with a slight
  // preference for near-equal pairs at the top end.
  const q = Math.max(0.06, Math.min(1, rng.range(0.08, 1.0) ** 0.85));
  const m2 = Math.max(0.05, primary.massMsun * q);
  const secondary = makeStar(m2, ageGyr, metallicity);

  const logPdays = rng.normal(5.03, 2.28);
  const periodDays = Math.max(0.2, Math.min(1e9, Math.pow(10, logPdays)));
  const mu = m2 / (primary.massMsun + m2);
  const muTotal = G * (primary.currentMassMsun + secondary.currentMassMsun) * M_SUN;
  const periodS = periodDays * DAY;
  const aM = Math.cbrt((muTotal * periodS * periodS) / (4 * Math.PI * Math.PI));

  // Tidal circularisation below ~12 days; wider pairs keep their eccentricity.
  const e = periodDays < 12
    ? Math.min(0.05, Math.abs(rng.normal(0, 0.02)))
    : Math.min(0.92, Math.abs(rng.normal(0.4, 0.24)));

  const inclination = Math.acos(rng.range(-1, 1));
  return {
    star: secondary,
    aM,
    e,
    inclination,
    periodS,
    mu,
    sTypeLimit: aM * Math.max(0, sTypeCritical(e, mu)),
    pTypeLimit: aM * pTypeCritical(e, mu),
    elements: {
      a: aM,
      e,
      i: inclination,
      Omega: rng.range(0, Math.PI * 2),
      omega: rng.range(0, Math.PI * 2),
      M0: rng.range(0, Math.PI * 2),
      epoch: 0,
    },
  };
}

export type PlanetHost = 'single' | 'circumstellar' | 'circumbinary';

/**
 * Decide where planets can live in this system, and over what range of
 * semi-major axes.
 *
 * A close pair leaves a large clear region outside itself, so its planets are
 * circumbinary. A wide pair leaves a large clear region around each star, so
 * its planets orbit one of them. In between - separations of a few to a few
 * tens of AU - neither region is big enough to hold much, and the observed
 * planet occurrence really does drop there.
 */
export function planetRegion(
  _primary: Star, companion: Companion | null,
): { host: PlanetHost; innerAu: number; outerAu: number } {
  if (!companion) return { host: 'single', innerAu: 0, outerAu: Infinity };
  const sepAu = companion.aM / AU;
  const sAu = companion.sTypeLimit / AU;
  const pAu = companion.pTypeLimit / AU;
  // Prefer whichever region is larger in log space.
  const sSpan = Math.log10(Math.max(sAu, 1e-6) / 0.02);
  const pSpan = Math.log10(200 / Math.max(pAu, 1e-6));
  if (sepAu < 1 || pSpan > sSpan) {
    return { host: 'circumbinary', innerAu: pAu * 1.05, outerAu: Infinity };
  }
  return { host: 'circumstellar', innerAu: 0, outerAu: sAu * 0.9 };
}

/**
 * Combined luminosity seen by a circumbinary planet. Two stars means a
 * habitable zone further out than either would give alone - and one whose
 * insolation varies over the binary period, which is a real complication for
 * circumbinary climates and not a rendering artefact.
 */
export const combinedLuminosity = (primary: Star, companion: Companion | null): number =>
  primary.luminosityLsun + (companion?.star.luminosityLsun ?? 0);

/** Orbital period of the pair in days, for the readout. */
export const binaryPeriodDays = (c: Companion): number => c.periodS / DAY;

/** Whether the two stars are close enough to exchange mass. */
export function isInteracting(primary: Star, c: Companion): boolean {
  // Roche lobe of the primary (Eggleton 1983) against its radius at periapsis.
  const q = primary.currentMassMsun / Math.max(c.star.currentMassMsun, 1e-6);
  const rl = (0.49 * Math.cbrt(q) ** 2) /
    (0.6 * Math.cbrt(q) ** 2 + Math.log(1 + Math.cbrt(q)));
  const periapsis = c.aM * (1 - c.e);
  return primary.radiusRsun * 6.957e8 > rl * periapsis;
}

export { period, YEAR, DEG };
