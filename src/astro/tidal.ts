/**
 * Tidal disruption: a star that came too close, and what is left of it.
 *
 * There are three ways for a star to end. Below about eight solar masses it
 * blows its envelope off as a planetary nebula and leaves a white dwarf; above
 * that its core collapses and leaves a neutron star or a black hole. This is
 * the third, and it has nothing to do with the star's mass at all. It is a
 * matter of where the star happens to wander.
 *
 * A black hole's gravity is not what tears a star apart - gravity alone would
 * simply move it. What tears it apart is the *difference* in gravity across
 * it, which grows as the inverse cube of the distance while the star's own
 * self-gravity stays where it is. Set those equal and there is a radius inside
 * which the star loses:
 *
 *     r_t = R* (M_bh / M*)^(1/3)
 *
 * For the Sun and a million-solar-mass hole that is about 0.7 astronomical
 * units - which is to say, inside the orbit of Venus, from an object four
 * million times heavier than the Sun and no bigger than the Sun itself.
 *
 * Three things then follow, and each of them is measurable:
 *
 *  - **There is a heaviest black hole that can do it.** The tidal radius grows
 *    as the cube root of the mass and the horizon grows linearly, so above
 *    about a hundred million solar masses the tidal radius is *inside* the
 *    horizon and the star is swallowed whole, with no flare and nothing to see.
 *    That is the Hills mass, and it is the reason tidal disruptions are only
 *    ever seen around the smaller supermassive black holes. M87's, at six and
 *    a half billion, can never make one.
 *  - **Exactly half the star escapes.** The near side of the star is deeper in
 *    the potential than the far side, so the debris comes away with a spread of
 *    orbital energies straddling zero. Half of it is unbound and leaves at
 *    thousands of kilometres a second, never to return. The other half falls
 *    back.
 *  - **It falls back as t^(-5/3).** The spread of energies is very nearly flat,
 *    and Kepler's third law turns a flat distribution in energy into a power
 *    law in time with that exponent. It is one of the cleanest predictions in
 *    astrophysics and it has been seen, in dozens of objects, over decades.
 *
 * The flare that results is briefly brighter than the entire galaxy around it,
 * and then fades on that power law for years. Half a star's worth of gas is
 * more than the hole can swallow: the peak rate is a hundred times the
 * Eddington limit, and what happens to the excess is still argued about.
 */

import { G, C, M_SUN, R_SUN, AU, YEAR, DAY } from '../core/constants';

/** Radiative efficiency of accretion onto a non-spinning black hole. */
export const ETA = 0.1;

export interface Disruption {
  /** Black hole mass, kg. */
  holeKg: number;
  /** Star mass, kg. */
  starKg: number;
  /** Star radius, m. */
  starR: number;
  /** How deep it went: the tidal radius over the pericentre distance. */
  beta: number;
  /** Whether there is anything to see, or the star went in whole. */
  visible: boolean;
}

/** Schwarzschild radius, m. */
export function horizonRadius(holeKg: number): number {
  return (2 * G * holeKg) / (C * C);
}

/**
 * The tidal radius: where the difference in the hole's pull across the star
 * matches the star's own grip on itself.
 */
export function tidalRadius(holeKg: number, starKg: number, starR: number): number {
  return starR * Math.cbrt(holeKg / starKg);
}

/**
 * The heaviest black hole that can tear this star apart rather than swallow it.
 *
 * The tidal radius goes as the cube root of the hole's mass and the horizon
 * goes as the first power, so they cross - and above the crossing the star
 * passes the horizon intact and nothing at all is seen. For a Sun-like star
 * that is about a hundred million solar masses.
 *
 * A spinning hole raises the limit, because a prograde orbit can approach
 * closer than the Schwarzschild radius suggests; the number below is the
 * non-spinning case, which is the conservative one.
 */
export function hillsMassKg(starKg: number, starR: number): number {
  // r_t = r_s  =>  R (M/M*)^(1/3) = 2GM/c^2  =>  M^(2/3) = R c^2 / (2 G M*^(1/3))
  const x = (starR * C * C) / (2 * G * Math.cbrt(starKg));
  return Math.pow(x, 1.5);
}

/**
 * The spread in specific orbital energy across the star at the moment it comes
 * apart, J/kg.
 *
 * The near side of the star sits deeper in the hole's potential than the far
 * side by the tidal potential across one stellar radius, and once the star's
 * own gravity has let go, that difference is all there is. It is the single
 * number the whole light curve comes out of.
 */
export function energySpread(holeKg: number, starKg: number, starR: number): number {
  const rt = tidalRadius(holeKg, starKg, starR);
  return (G * holeKg * starR) / (rt * rt);
}

/**
 * How fast the unbound half leaves, m/s. Several thousand kilometres a second:
 * fast enough to escape the galaxy, and it does.
 */
export function ejectaSpeed(holeKg: number, starKg: number, starR: number): number {
  return Math.sqrt(2 * energySpread(holeKg, starKg, starR));
}

/**
 * When the first debris comes back, seconds after the disruption.
 *
 * The most tightly bound material has the shortest orbit, and this is its
 * period. About forty days for a Sun around a million-solar-mass hole - which
 * is why these events are found by surveys that look at the same patch of sky
 * every few nights, and were not found at all until such surveys existed.
 */
export function fallbackTime(holeKg: number, starKg: number, starR: number): number {
  const dE = energySpread(holeKg, starKg, starR);
  return (2 * Math.PI * G * holeKg) / Math.pow(2 * dE, 1.5);
}

/**
 * The rate at which debris returns, kg/s, at a time after the disruption.
 *
 * Flat in energy, so t^(-5/3) in time - Kepler's third law does the conversion
 * and nothing else is needed. Integrating it from the first return to infinity
 * gives half the star, which is the half that was bound.
 */
export function fallbackRate(d: Disruption, tS: number): number {
  const tm = fallbackTime(d.holeKg, d.starKg, d.starR);
  if (tS <= tm) return 0;
  return (d.starKg / (3 * tm)) * Math.pow(tS / tm, -5 / 3);
}

/** Eddington luminosity, W: where radiation pressure balances gravity. */
export function eddingtonLuminosity(holeKg: number): number {
  return 1.26e31 * (holeKg / M_SUN);
}

/**
 * What the flare puts out, W.
 *
 * The accretion luminosity is a tenth of the rest mass of everything that goes
 * in - but only up to a point. The returning gas at the peak is a hundred times
 * more than the hole can swallow at the Eddington rate, and what a hundred
 * times Eddington actually does is one of the open questions in the subject.
 * The cap here is generous rather than certain, and it is a cap and not a
 * calculation.
 */
export function flareLuminosity(d: Disruption, tS: number): number {
  const raw = ETA * fallbackRate(d, tS) * C * C;
  const cap = eddingtonLuminosity(d.holeKg);
  // A soft ceiling. Super-Eddington flows do exceed the limit, but only
  // logarithmically, and the observed flares sit within a factor of a few of
  // it however far above it the supply rate is - which is itself the evidence
  // that something is throwing most of the returning gas away again.
  return raw <= cap ? raw : cap * (1 + 0.35 * Math.log(raw / cap));
}

/**
 * The temperature a flare radiates at, K.
 *
 * Around thirty thousand kelvin, which puts the peak in the ultraviolet - and
 * is one of the puzzles, because the gas near the hole should be far hotter
 * than that. Whatever is doing the emitting sits much further out than the
 * accretion disc does.
 */
export function flareTemperature(d: Disruption, tS: number): number {
  const l = flareLuminosity(d, tS);
  if (l <= 0) return 0;
  const SIGMA = 5.670374419e-8;
  const r = emittingRadius(d.holeKg);
  return Math.pow(l / (4 * Math.PI * r * r * SIGMA), 0.25);
}

/**
 * How big the thing that is actually shining appears to be, m.
 *
 * Fitted from the flares themselves rather than derived, because nothing
 * derives it: a blackbody fit to a tidal disruption gives ten thousand
 * gravitational radii, which is thousands of times larger than the accretion
 * disc and far too cool for gas that close to a black hole. Something -
 * an envelope of reprocessing debris, or the collision where the returning
 * stream runs into itself - is absorbing what the disc emits and radiating it
 * again from much further out. That is why these flares are found in the
 * ultraviolet and not in X-rays, and it is not settled.
 */
export function emittingRadius(holeKg: number): number {
  return 1.0e13 * Math.sqrt(holeKg / (1e6 * M_SUN));
}

/** Build a disruption, and say whether there is anything to see. */
export function disruption(
  holeMsun: number, starMsun: number, starRsun: number, beta = 1.2,
): Disruption {
  const holeKg = holeMsun * M_SUN;
  const starKg = starMsun * M_SUN;
  const starR = starRsun * R_SUN;
  return {
    holeKg,
    starKg,
    starR,
    beta,
    visible: tidalRadius(holeKg, starKg, starR) > horizonRadius(holeKg),
  };
}

/**
 * One piece of the star, as an orbit.
 *
 * This is the whole model. Every particle starts at the same place, at the
 * pericentre of the star's original orbit, moving at the same speed - except
 * for a small offset in specific energy, spread evenly across the star from
 * the near side to the far. That one difference is enough: it makes some of
 * them bound and some unbound, gives the bound ones a range of periods, and
 * the range of periods is the light curve.
 *
 * @param frac  where in the star this piece came from, -1 near side to +1 far
 */
export function debrisOrbit(
  d: Disruption, frac: number,
): { a: number; e: number; boundS: number } {
  const mu = G * d.holeKg;
  const rt = tidalRadius(d.holeKg, d.starKg, d.starR);
  const rp = rt / Math.max(d.beta, 0.05);
  // The star arrives on a very nearly parabolic orbit - it came from far away,
  // so its energy before disruption is close to zero - and the debris straddles
  // that.
  const dE = energySpread(d.holeKg, d.starKg, d.starR);
  const eps = frac * dE;
  if (Math.abs(eps) < 1e-12) return { a: Infinity, e: 1, boundS: Infinity };
  // Specific orbital energy is -mu/2a, so the semi-major axis follows directly,
  // and its sign says whether this piece ever comes back.
  const a = -mu / (2 * eps);
  const e = Math.abs(1 - rp / a);
  const boundS = a > 0 ? 2 * Math.PI * Math.sqrt((a * a * a) / mu) : Infinity;
  return { a, e, boundS };
}

/**
 * How often this happens to a galaxy: about one every thirty thousand years.
 *
 * Rare enough that none has ever been seen twice in the same galaxy, common
 * enough that a survey watching a hundred thousand galaxies finds a few a year.
 */
export const RATE_PER_GALAXY_PER_YEAR = 3e-5;

export { AU, YEAR, DAY, M_SUN, R_SUN };
