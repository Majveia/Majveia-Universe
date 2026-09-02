/**
 * How a planet like this would actually be found.
 *
 * Everything else in this simulation is the system as it is. This is the system
 * as it would be *measured*, which is a different and much narrower thing:
 * almost nothing about a planet is observable, and the few things that are come
 * through two narrow doors.
 *
 *  - **Transits.** If the orbit happens to be edge-on enough, the planet crosses
 *    the star and takes a bite out of its light. The bite is `(Rp/R*)²` deep -
 *    an area ratio, not a mass ratio - which is 1% for a hot Jupiter and 84
 *    parts per million for the Earth. The catch is the word *happens*: the
 *    geometric probability is only `R★/a`, half a per cent for an Earth at 1 AU,
 *    so the method finds one system in two hundred and is blind to the rest.
 *  - **Radial velocity.** The star orbits the barycentre too, and the Doppler
 *    shift of its spectrum gives that motion along the line of sight. The
 *    amplitude is `K ∝ Mp sin i / (M* P)^(1/3)`, 12.5 m/s for Jupiter and 9 cm/s
 *    for the Earth - a walking pace and a slow crawl, measured on a star four
 *    light years away by watching its absorption lines move a ten-millionth of
 *    their width.
 *
 * The two are complementary and that is the whole reason both exist: transits
 * give the radius, radial velocity gives the mass, and only a planet with both
 * has a density and therefore a composition. Nothing else here can be known
 * about a world at all.
 *
 * The transit shape is the small-planet approximation: the overlapping area of
 * two discs, weighted by the limb-darkened intensity of the part of the star
 * being covered. It is accurate to better than the depth itself for
 * `Rp/R* < 0.1`, and it produces the rounded bottom of a real light curve
 * rather than a box, because the middle of a stellar disc is brighter than
 * its edge.
 */

import { AU, G, M_EARTH, M_SUN, R_EARTH, R_SUN, YEAR } from '../core/constants';
import { discOverlapFraction } from '../physics/eclipse';

export interface TransitInput {
  /** Planet radius, metres. */
  planetRadiusM: number;
  /** Star radius, metres. */
  starRadiusM: number;
  /** Semi-major axis, metres. */
  aM: number;
  /** Orbital period, seconds. */
  periodS: number;
  /** Impact parameter in stellar radii. 0 is a central transit. */
  impact?: number;
  /** Quadratic limb-darkening coefficients. Solar values by default. */
  u1?: number;
  u2?: number;
}

/** Depth of a transit at mid-point ignoring limb darkening: the area ratio. */
export function transitDepth(planetRadiusM: number, starRadiusM: number): number {
  const k = planetRadiusM / Math.max(starRadiusM, 1);
  return k * k;
}

/**
 * Geometric probability that a randomly oriented orbit transits at all.
 * `R★/a`, ignoring the planet's own radius - 0.47% for the Earth.
 */
export function transitProbability(starRadiusM: number, aM: number): number {
  return Math.min(1, starRadiusM / Math.max(aM, 1));
}

/**
 * Duration of a transit from first to last contact, seconds.
 *
 * `T = (P/π) · asin( (R★/a) · √((1+k)² − b²) )`, which for a central transit of
 * a small planet reduces to the time to cross a stellar diameter.
 */
export function transitDuration(t: TransitInput): number {
  const k = t.planetRadiusM / Math.max(t.starRadiusM, 1);
  const b = t.impact ?? 0;
  const x = (1 + k) * (1 + k) - b * b;
  if (x <= 0) return 0;
  const s = (t.starRadiusM / Math.max(t.aM, 1)) * Math.sqrt(x);
  return (t.periodS / Math.PI) * Math.asin(Math.min(1, s));
}

/**
 * Quadratic limb darkening: the intensity of the stellar disc at a point where
 * the cosine of the angle between the surface normal and the line of sight is
 * mu, normalised so the disc-averaged intensity is one.
 *
 * The Sun is about 40% fainter at its limb than at its centre in visible light,
 * because a slanted line of sight only reaches the cooler upper photosphere.
 */
export function limbIntensity(mu: number, u1 = 0.44, u2 = 0.23): number {
  const m = Math.min(Math.max(mu, 0), 1);
  const i = 1 - u1 * (1 - m) - u2 * (1 - m) * (1 - m);
  const mean = 1 - u1 / 3 - u2 / 6;
  return i / Math.max(mean, 1e-9);
}

/**
 * Relative flux during a transit, 1 outside and `1 − depth` at the bottom.
 *
 * @param phase time from mid-transit, seconds
 */
export function transitFlux(t: TransitInput, phase: number): number {
  const rs = Math.max(t.starRadiusM, 1);
  const k = t.planetRadiusM / rs;
  const b = t.impact ?? 0;
  // Projected separation of the two discs in stellar radii. The planet moves
  // essentially in a straight line across the face at the orbital speed.
  const n = (2 * Math.PI) / Math.max(t.periodS, 1e-9);
  const x = (t.aM / rs) * Math.sin(n * phase);
  const z = Math.hypot(x, b);
  if (z >= 1 + k) return 1;
  // Fraction of the *stellar* disc covered, from the same two-circle overlap
  // the eclipse code uses.
  const covered = discOverlapFraction(1, k, z);
  // Weighted by how bright the covered patch is: the middle of the disc is
  // brighter than the edge, which is what rounds the bottom of a light curve.
  const mu = Math.sqrt(Math.max(0, 1 - Math.min(z, 1) ** 2));
  return 1 - covered * limbIntensity(mu, t.u1, t.u2);
}

export interface RadialVelocityInput {
  /** Star mass, kg. */
  starMassKg: number;
  /** Planet mass, kg. */
  planetMassKg: number;
  /** Semi-major axis, metres. */
  aM: number;
  /** Eccentricity. */
  e?: number;
  /** Orbital inclination to the sky plane, radians. π/2 is edge-on. */
  inclination?: number;
  /** Argument of periastron, radians. */
  omega?: number;
}

/**
 * Semi-amplitude of the star's radial velocity, m/s.
 *
 * `K = (2πG/P)^(1/3) · Mp sin i / (M* + Mp)^(2/3) / √(1 − e²)`.
 *
 * Jupiter moves the Sun at 12.5 m/s; the Earth at 9 cm/s. The first is a brisk
 * walk and was measurable in 1995; the second is the speed of a tortoise and
 * still is not, which is why there is no radial-velocity detection of an
 * Earth analogue.
 */
export function radialVelocityAmplitude(r: RadialVelocityInput): number {
  const inc = r.inclination ?? Math.PI / 2;
  const e = r.e ?? 0;
  const M = r.starMassKg + r.planetMassKg;
  const P = 2 * Math.PI * Math.sqrt(r.aM ** 3 / (G * M));
  return (
    Math.pow((2 * Math.PI * G) / P, 1 / 3)
    * ((r.planetMassKg * Math.sin(inc)) / Math.pow(M, 2 / 3))
    / Math.sqrt(Math.max(1 - e * e, 1e-9))
  );
}

/**
 * The star's radial velocity through one orbit, m/s.
 *
 * `v = K[cos(ν + ω) + e cos ω]`. For a circular orbit that is a sinusoid; for
 * an eccentric one it is the lopsided sawtooth that gives the eccentricity
 * away, and reading that shape is how orbital elements are recovered from a
 * spectrograph.
 *
 * @param trueAnomaly ν, radians
 */
export function radialVelocity(K: number, trueAnomaly: number, e = 0, omega = 0): number {
  return K * (Math.cos(trueAnomaly + omega) + e * Math.cos(omega));
}

/**
 * Astrometric wobble of the star on the sky, microarcseconds - the third door,
 * and the one Gaia opened. The star swings by `(Mp/M*)·a`, and at a distance d
 * that is an angle. Jupiter moves the Sun by 500 µas seen from ten parsecs;
 * the Earth moves it by 0.3.
 */
export function astrometricSignal(
  starMassKg: number, planetMassKg: number, aM: number, distancePc: number,
): number {
  const aStarAU = ((planetMassKg / Math.max(starMassKg, 1)) * aM) / AU;
  return (aStarAU / Math.max(distancePc, 1e-6)) * 1e6;
}

/**
 * Contrast ratio between a planet in reflected light and its star.
 *
 * `A (Rp/a)²` at full phase. For Jupiter that is 1e-9 and for the Earth 1e-10:
 * a firefly beside a lighthouse, at arm's length, from a thousand miles.
 */
export function reflectedContrast(albedo: number, planetRadiusM: number, aM: number): number {
  const x = planetRadiusM / Math.max(aM, 1);
  return albedo * x * x;
}

export interface Detectability {
  /** Transit depth in parts per million. */
  depthPpm: number;
  /** Transit duration, hours, for a central transit. */
  durationHours: number;
  /** Probability a random observer sees transits at all. */
  probability: number;
  /** Radial-velocity semi-amplitude, m/s, for an edge-on orbit. */
  rvAmplitude: number;
  /** Astrometric signal at 10 pc, microarcseconds. */
  astrometryUas: number;
  /** Reflected-light contrast. */
  contrast: number;
  /** What would find it, given what current instruments can do. */
  method: 'transit' | 'radial velocity' | 'both' | 'astrometry' | 'none';
}

/**
 * What could be measured about this planet, and by which method.
 *
 * The thresholds are roughly what is actually achieved: a few hundred parts per
 * million from the ground and a few tens from space, 0.3 m/s from the best
 * stabilised spectrographs, and about 20 µas from Gaia over its mission.
 */
export function detectability(
  planetRadiusM: number, planetMassKg: number, aM: number,
  starRadiusM: number, starMassKg: number,
): Detectability {
  const periodS = 2 * Math.PI * Math.sqrt(aM ** 3 / (G * (starMassKg + planetMassKg)));
  const depthPpm = transitDepth(planetRadiusM, starRadiusM) * 1e6;
  const rv = radialVelocityAmplitude({ starMassKg, planetMassKg, aM });
  const astro = astrometricSignal(starMassKg, planetMassKg, aM, 10);
  const seesTransit = depthPpm > 20;
  const seesRv = rv > 0.3;
  const method: Detectability['method'] = seesTransit && seesRv ? 'both'
    : seesTransit ? 'transit'
      : seesRv ? 'radial velocity'
        : astro > 20 ? 'astrometry' : 'none';
  return {
    depthPpm,
    durationHours: transitDuration({
      planetRadiusM, starRadiusM, aM, periodS,
    }) / 3600,
    probability: transitProbability(starRadiusM, aM),
    rvAmplitude: rv,
    astrometryUas: astro,
    contrast: reflectedContrast(0.3, planetRadiusM, aM),
    method,
  };
}

export { AU, G, M_EARTH, M_SUN, R_EARTH, R_SUN, YEAR };
