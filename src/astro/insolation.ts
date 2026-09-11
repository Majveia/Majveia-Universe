/**
 * Where the light falls.
 *
 * A planet's climate begins with a purely geometric question: how much starlight
 * lands on a square metre at a given latitude, averaged over one rotation, at a
 * given point in the orbit. Nothing about the atmosphere enters yet - this is
 * spherical trigonometry and Kepler's second law, and it has been solvable since
 * 1619.
 *
 * The answer is the most consequential formula in climate science, because its
 * *shape* is what makes a planet have seasons, ice caps and a tropics at all:
 *
 *   q(phi, lambda) = (S/pi) (a/r)^2 [ H0 sin(phi) sin(dec) + cos(phi) cos(dec) sin(H0) ]
 *
 * with the declination from the obliquity, `sin(dec) = sin(eps) sin(lambda)`,
 * and the half-day-length H0 from `cos(H0) = -tan(phi) tan(dec)`, which has no
 * solution when the sun never sets or never rises - the polar day and the polar
 * night, falling out of the arithmetic rather than being written in.
 *
 * Three things follow that are worth stating because they are surprising and
 * they are both consequences of that one line:
 *
 *  - **The summer pole is the sunniest place on the planet.** Earth's north
 *    pole receives 520 W/m^2 in daily mean at the June solstice; the equator
 *    never exceeds 440. Twenty-four hours of slanted sun beats twelve hours of
 *    overhead sun. It is cold there for reasons of transport and albedo, not
 *    because the light is missing.
 *
 *  - **Obliquity trades the equator against the poles**, and past about 54
 *    degrees the annual mean at the pole exceeds the annual mean at the
 *    equator. A high-obliquity world has its ice at the *equator*, if anywhere.
 *
 *  - **Eccentricity changes the global annual mean**, by (1 - e^2)^(-1/2) -
 *    faster motion near periapsis means less time spent there, and the two
 *    effects do not cancel. It also makes one hemisphere's seasons harsher than
 *    the other's, and which hemisphere that is precesses over tens of thousands
 *    of years. That is Milankovitch's mechanism, and it is in here for free.
 */

import { AU, DEG, L_SUN } from '../core/constants';
import { solveKeplerElliptic, trueFromEccentric } from '../physics/kepler';

/** Total solar irradiance at 1 AU, W/m^2 (TSIS-1, 2019). */
export const SOLAR_CONSTANT = 1361;

export interface OrbitGeometry {
  /** Axial tilt, radians. */
  obliquity: number;
  /** Orbital eccentricity. */
  e: number;
  /**
   * Longitude of periapsis measured from the northern vernal equinox, radians.
   * Earth's is 282.9 degrees: periapsis falls in early January, a fortnight
   * after the northern winter solstice, which is why northern winters are
   * currently the mild ones.
   */
  precession: number;
}

/** Irradiance at the top of the atmosphere at distance `au`, W/m^2. */
export function irradiance(luminosityLsun: number, au: number): number {
  return (luminosityLsun * L_SUN) / (4 * Math.PI * (au * AU) ** 2);
}

/**
 * Solar declination for a true longitude measured from the vernal equinox.
 * At lambda = 0 the star is over the equator; at pi/2 it is over the tropic.
 */
export const declination = (lambda: number, obliquity: number): number =>
  Math.asin(Math.sin(obliquity) * Math.sin(lambda));

/**
 * Half the length of the day in radians of hour angle: pi is a full day of
 * sunlight, 0 is a full night. The clamp is not a numerical guard - it is the
 * polar day and the polar night.
 */
export function sunsetHourAngle(lat: number, dec: number): number {
  const c = -Math.tan(lat) * Math.tan(dec);
  if (c <= -1) return Math.PI;
  if (c >= 1) return 0;
  return Math.acos(c);
}

/** Distance factor (a/r)^2 at true anomaly nu, from the conic section. */
export const distanceFactor = (nu: number, e: number): number =>
  ((1 + e * Math.cos(nu)) / (1 - e * e)) ** 2;

/**
 * Daily-mean insolation at a latitude, for a star of irradiance `S` at the
 * orbit's semi-major axis, at orbital longitude `lambda` measured from the
 * northern vernal equinox.
 */
export function dailyInsolation(S: number, lat: number, lambda: number, orb: OrbitGeometry): number {
  const dec = declination(lambda, orb.obliquity);
  const H0 = sunsetHourAngle(lat, dec);
  if (H0 <= 0) return 0;
  const nu = lambda - orb.precession;
  const f = distanceFactor(nu, orb.e);
  const q = H0 * Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.sin(H0);
  return Math.max(0, (S / Math.PI) * f * q);
}

/**
 * Fraction of the day the star is above the horizon. Sets how much of the
 * seasonal cycle is diurnal and how much is a polar night that no amount of
 * rotation will end.
 */
export const daylightFraction = (lat: number, lambda: number, obliquity: number): number =>
  sunsetHourAngle(lat, declination(lambda, obliquity)) / Math.PI;

/**
 * Orbital longitude as a function of time since periapsis.
 *
 * Kepler's second law is the reason this is not just `2 pi t / P`: a planet on
 * an eccentric orbit spends unequal time in each season, and on a very
 * eccentric orbit one hemisphere's summer can be over in a fraction of the year
 * while its winter drags on.
 */
export function longitudeAt(tSincePeriapsis: number, periodS: number, orb: OrbitGeometry): number {
  const M = (2 * Math.PI * tSincePeriapsis) / Math.max(periodS, 1e-9);
  const E = solveKeplerElliptic(M, orb.e);
  const nu = trueFromEccentric(E, orb.e);
  return nu + orb.precession;
}

/**
 * Time from periapsis at which the planet reaches a given orbital longitude -
 * the inverse of `longitudeAt`, needed to sample a season at equal steps of
 * *time* rather than of angle.
 */
export function timeAtLongitude(lambda: number, periodS: number, orb: OrbitGeometry): number {
  const nu = lambda - orb.precession;
  const e = orb.e;
  const E = Math.atan2(Math.sqrt(1 - e * e) * Math.sin(nu), e + Math.cos(nu));
  const M = E - e * Math.sin(E);
  const frac = ((M / (2 * Math.PI)) % 1 + 1) % 1;
  return frac * periodS;
}

/**
 * Annual-mean insolation at a latitude, integrated over the orbit in equal
 * steps of *time*.
 *
 * At zero obliquity this is the familiar `S cos(phi) / pi`. Tilt the axis and
 * it flattens; tilt it past 54 degrees and it inverts, so the poles are the
 * warm places and the equator is the cold one. That is not a curiosity: it is
 * the reason obliquity is one of the three parameters that pace ice ages.
 */
export function annualMeanInsolation(S: number, lat: number, orb: OrbitGeometry, samples = 180): number {
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    // Equal steps in mean anomaly are equal steps in time.
    const M = (2 * Math.PI * (i + 0.5)) / samples;
    const E = solveKeplerElliptic(M, orb.e);
    const lambda = trueFromEccentric(E, orb.e) + orb.precession;
    sum += dailyInsolation(S, lat, lambda, orb);
  }
  return sum / samples;
}

/**
 * Global annual mean, which for any obliquity is `S / (4 sqrt(1 - e^2))`. The
 * eccentricity factor is small - Earth's orbit adds 0.014% - but it is not
 * zero, and it is the reason a planet on a wildly eccentric orbit is warmer on
 * average than a circular one at the same semi-major axis.
 */
export const globalMeanInsolation = (S: number, e: number): number =>
  S / (4 * Math.sqrt(Math.max(1 - e * e, 1e-12)));

/**
 * The obliquity at which the annual mean at the pole equals the annual mean at
 * the equator. Solved rather than quoted, so it tracks the eccentricity too.
 */
export function polarCrossoverObliquity(e = 0): number {
  let lo = 30 * DEG, hi = 80 * DEG;
  const diff = (eps: number): number => {
    const orb = { obliquity: eps, e, precession: 0 };
    return annualMeanInsolation(1, Math.PI / 2 - 1e-6, orb, 240)
      - annualMeanInsolation(1, 0, orb, 240);
  };
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (diff(mid) < 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Insolation on a tidally locked world, as a function of the angle from the
 * substellar point. There is no day, no season and no rotation to average over:
 * the star hangs in one place forever, and half the planet has never seen it.
 */
export const lockedInsolation = (S: number, angleFromSubstellar: number): number =>
  S * Math.max(0, Math.cos(angleFromSubstellar));
