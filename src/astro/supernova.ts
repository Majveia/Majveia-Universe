/**
 * Supernovae and their remnants.
 *
 * Two populations, with different progenitors and different rates:
 *
 *  - Core collapse (II, Ib/c). A star above about 8 solar masses runs out of
 *    fuel, its iron core collapses in under a second, and the infalling
 *    envelope bounces off the newborn neutron star. These track star formation
 *    directly, because their progenitors live only a few million years - which
 *    is why they go off in spiral arms and never in ellipticals.
 *  - Thermonuclear (Ia). A white dwarf pushed over the Chandrasekhar limit
 *    detonates. Their progenitors are old, so the rate tracks stellar mass
 *    rather than star formation, and they happen everywhere.
 *
 * The light curves are the real ones. A type Ia rises for about 19 days to
 * roughly -19.3 absolute magnitude and then declines at a rate set by the
 * radioactive decay chain 56Ni -> 56Co -> 56Fe: the 6.1-day nickel half-life
 * powers the peak, the 77-day cobalt half-life powers the tail. A type II-P
 * instead sits on a hundred-day plateau while a recombination wave eats inward
 * through its hydrogen envelope, then drops off a cliff when it runs out.
 *
 * The remnant then expands by the Sedov-Taylor solution, the self-similar
 * blast wave of a point explosion in a uniform medium:
 *
 *     R(t) = 1.15 (E t^2 / rho)^{1/5}
 *
 * which is the same solution G. I. Taylor used to work out the yield of the
 * Trinity test from a published photograph.
 */

import { M_SUN, PC, YEAR } from '../core/constants';

export type SupernovaType = 'Ia' | 'II-P' | 'Ib/c';

/**
 * Core-collapse rate, per year. About one supernova per hundred solar masses
 * of stars formed, from the fraction of a Kroupa IMF above 8 solar masses.
 */
export const coreCollapseRate = (sfrMsunYr: number): number => sfrMsunYr / 100;

/**
 * Type Ia rate, per year. Roughly 0.04 per century per 10^10 solar masses of
 * old stars, with a term tracking recent star formation for the prompt channel.
 */
export const typeIaRate = (stellarMassMsun: number, sfrMsunYr: number): number =>
  4e-14 * stellarMassMsun + 5e-4 * sfrMsunYr;

/** Peak absolute bolometric magnitude. */
export function peakMagnitude(type: SupernovaType): number {
  switch (type) {
    case 'Ia': return -19.3;
    case 'Ib/c': return -17.6;
    default: return -16.8;
  }
}

/**
 * Absolute magnitude as a function of days since explosion.
 * Fainter is more positive, so the light curve *rises* by going down.
 */
export function lightCurve(type: SupernovaType, days: number): number {
  if (days < 0) return 99;
  const peak = peakMagnitude(type);
  if (type === 'Ia') {
    const tPeak = 19;
    if (days < tPeak) {
      // Rise goes as t^2 in flux while the fireball expands at constant temperature
      const f = Math.max((days / tPeak) ** 2, 1e-4);
      return peak - 2.5 * Math.log10(f);
    }
    // 56Ni (6.1 d) then 56Co (77.2 d); the tail is the cobalt slope, 0.0098 mag/day
    const dt = days - tPeak;
    const nickel = Math.exp(-dt / 8.8);
    const cobalt = Math.exp(-dt / 111.3);
    const f = 0.55 * nickel + 0.45 * cobalt;
    return peak - 2.5 * Math.log10(Math.max(f, 1e-8));
  }
  if (type === 'II-P') {
    const tRise = 9;
    if (days < tRise) return peak - 2.5 * Math.log10(Math.max((days / tRise) ** 2, 1e-4));
    const plateau = 100;
    if (days < plateau) {
      // The plateau: a hydrogen recombination wave eating inward at ~6500 K
      return peak + 0.0035 * (days - tRise);
    }
    // The drop off the plateau, then the radioactive tail
    const dt = days - plateau;
    return peak + 0.32 + Math.min(2.6, dt * 0.13) + Math.max(0, (dt - 20) * 0.0098);
  }
  const tRise = 15;
  if (days < tRise) return peak - 2.5 * Math.log10(Math.max((days / tRise) ** 2, 1e-4));
  const dt = days - tRise;
  return peak + 2.5 * Math.log10(1 / Math.exp(-dt / 25)) * 0.4 + dt * 0.006;
}

/** Bolometric luminosity in solar units from an absolute magnitude. */
export const magnitudeToLuminosity = (mag: number): number => Math.pow(10, (4.74 - mag) / 2.5);

/**
 * Sedov-Taylor blast radius, metres.
 * @param energyErg  explosion energy, typically 1e51 erg
 * @param years      time since the explosion
 * @param densityCm3 ambient hydrogen number density
 */
export function sedovRadius(energyErg: number, years: number, densityCm3 = 1): number {
  const E = energyErg * 1e-7;                       // joules
  const rho = densityCm3 * 1e6 * 1.67262192369e-27; // kg/m^3
  const t = years * YEAR;
  return 1.15 * Math.pow((E * t * t) / rho, 0.2);
}

/** Expansion speed of a Sedov-Taylor blast wave, m/s: v = 2R/(5t). */
export const sedovVelocity = (energyErg: number, years: number, densityCm3 = 1): number =>
  (2 * sedovRadius(energyErg, years, densityCm3)) / (5 * years * YEAR);

/**
 * When the shocked gas gets cool and dense enough to radiate away its own
 * thermal energy faster than the shock can resupply it, the Sedov solution
 * stops applying: the interior loses pressure support and the remnant coasts
 * on momentum instead. Blondin et al. (1998) put that transition at
 *
 *     t_rad ~ 2.9e4 E51^{4/17} n^{-9/17} years
 *
 * which for a canonical explosion in a canonical medium is about thirty
 * thousand years - a hundredth of the age the Sedov phase alone would suggest.
 */
export const radiativeTransitionYears = (energyErg = 1e51, densityCm3 = 1): number =>
  2.9e4 * Math.pow(energyErg / 1e51, 4 / 17) * Math.pow(Math.max(densityCm3, 1e-4), -9 / 17);

/**
 * Radius of a supernova remnant through all three of its phases, metres.
 *
 *  - Free expansion, while the ejecta outweigh what they have swept up: R ~ t
 *  - Sedov-Taylor, an energy-conserving blast wave:                    R ~ t^2/5
 *  - Pressure-driven snowplow, after the interior has radiated away:   R ~ t^2/7
 *
 * Each phase is matched to the previous one at the transition, so the curve is
 * continuous and the exponents are the only thing that changes.
 */
export function remnantRadius(
  years: number, energyErg = 1e51, densityCm3 = 1, ejectaMsun = 5,
): number {
  if (years <= 0) return 0;
  const E = energyErg * 1e-7;
  const Mej = ejectaMsun * M_SUN;
  // Free expansion ends when the swept mass equals the ejecta mass.
  const v0 = Math.sqrt((2 * E) / Mej);
  const rho = densityCm3 * 1e6 * 1.67262192369e-27;
  const rFree = Math.cbrt((3 * Mej) / (4 * Math.PI * rho));
  const tFree = rFree / v0 / YEAR;
  if (years < tFree) return v0 * years * YEAR;

  const tRad = radiativeTransitionYears(energyErg, densityCm3);
  if (years < tRad) {
    // Sedov, anchored so it meets the free-expansion radius at tFree
    return rFree * Math.pow(years / tFree, 0.4);
  }
  const rRad = rFree * Math.pow(tRad / tFree, 0.4);
  return rRad * Math.pow(years / tRad, 2 / 7);
}

/** Expansion speed at a given age, m/s, differentiating the radius. */
export function remnantVelocity(
  years: number, energyErg = 1e51, densityCm3 = 1, ejectaMsun = 5,
): number {
  const h = Math.max(years * 1e-3, 1);
  const r0 = remnantRadius(years - h, energyErg, densityCm3, ejectaMsun);
  const r1 = remnantRadius(years + h, energyErg, densityCm3, ejectaMsun);
  return (r1 - r0) / (2 * h * YEAR);
}

/**
 * A remnant stops being a remnant when its shock slows to the sound speed of
 * the surrounding gas, about 10 km/s, and merges into the interstellar medium.
 * Including the radiative phase, that happens after a few hundred thousand
 * years - the age of the oldest remnants that are still identifiable.
 */
export function remnantLifetimeYears(
  energyErg = 1e51, densityCm3 = 1, ejectaMsun = 5,
): number {
  let lo = 100, hi = 1e8;
  for (let i = 0; i < 90; i++) {
    const mid = Math.sqrt(lo * hi);
    if (remnantVelocity(mid, energyErg, densityCm3, ejectaMsun) > 1e4) lo = mid; else hi = mid;
  }
  return Math.sqrt(lo * hi);
}

/** Mass of the compact remnant left behind, solar masses. */
export function compactRemnantMass(progenitorMsun: number): number {
  if (progenitorMsun < 8) return 0;
  if (progenitorMsun < 20) return 1.17 + 0.09 * progenitorMsun;
  return 0.3 * progenitorMsun;
}

export interface Supernova {
  type: SupernovaType;
  /** Position in galaxy coordinates, kpc. */
  x: number; y: number; z: number;
  /** Simulation time of the explosion, Myr. */
  t0: number;
  /** Progenitor mass, solar masses. 0 for a type Ia. */
  progenitorMsun: number;
  /** Ambient density, cm^-3. */
  density: number;
  seed: number;
}

/** Colour of the expanding photosphere as it cools, in linear RGB. */
export function supernovaColor(type: SupernovaType, days: number): [number, number, number] {
  // The photosphere starts at tens of thousands of kelvin and cools as it
  // expands, so a supernova is blue-white at peak and red months later.
  const T = type === 'Ia'
    ? Math.max(4000, 16000 * Math.exp(-days / 55))
    : Math.max(4500, 12000 * Math.exp(-days / 80));
  const t = T / 100;
  const r = t <= 66 ? 1 : Math.min(1, (329.7 * Math.pow(t - 60, -0.1332)) / 255);
  const g = t <= 66
    ? Math.max(0, Math.min(1, (99.47 * Math.log(t) - 161.12) / 255))
    : Math.min(1, (288.12 * Math.pow(t - 60, -0.0755)) / 255);
  const b = t >= 66 ? 1 : t <= 19 ? 0 : Math.max(0, Math.min(1, (138.52 * Math.log(t - 10) - 305.04) / 255));
  return [Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2)];
}

export { M_SUN, PC };
