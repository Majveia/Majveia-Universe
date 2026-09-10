/**
 * The rest of the sky.
 *
 * Standing on a world, the star is not the only thing up there. Everything
 * else in the system is too, and it has been the whole time - a handful of
 * points that are brighter than any star and that do not stay put. That is the
 * observation the word *planet* is: a wanderer.
 *
 * This module works out where they are, and it does it the only honest way,
 * which is to propagate the actual orbits and subtract. A planet's place in
 * your sky is the difference of two heliocentric vectors, and everything that
 * makes planetary motion strange falls out of that subtraction without being
 * asked for:
 *
 *  - **Inner planets never leave the sun.** Venus and Mercury are on smaller
 *    circles than you are, so the angle between them and the star can never
 *    exceed asin(a/a_obs) - forty-six degrees for Venus, twenty-eight for
 *    Mercury. They are morning stars or evening stars and nothing else, and no
 *    rule enforces it.
 *  - **Outer planets go backwards.** Twice a year Earth overtakes Mars on the
 *    inside and Mars appears to stop, reverse, and loop. Ptolemy needed
 *    epicycles for that. A vector difference needs nothing.
 *  - **They are brightest when they are nearest, except when they aren't.**
 *    Venus is closest to us at inferior conjunction and almost invisible then,
 *    because the side facing us is the night side. The brightness is a fight
 *    between an inverse square and a phase function, and the crescent wins.
 *
 * The magnitudes are the standard photometric system: an absolute magnitude
 * from the body's size and albedo, then the inverse-square falloff over the
 * two legs of the light's journey, then a phase function for how much of the
 * lit hemisphere is turned toward you, then extinction by the air you are
 * standing under. Run on the real solar system it puts Venus at about -4,
 * Jupiter at -2, and Uranus just at the naked-eye limit, which is where they
 * are.
 *
 * The second thing here is the geometry of one disc in front of another,
 * which is what an eclipse is. It costs one circle-circle intersection, and it
 * is worth having exactly because nothing has to schedule it: line the bodies
 * up and the light goes out.
 */

import { AU, R_SUN } from '../core/constants';
import { stateAt, type OrbitalElements, type StateVector } from '../physics/kepler';

export type Vec3 = [number, number, number];

// ---------------------------------------------------------------------------
// Small vector arithmetic
//
// Three components, no allocation discipline to speak of, and called a few
// hundred times a frame at most. three.js is not imported here on purpose:
// this file is physics and it is tested without a renderer.
// ---------------------------------------------------------------------------

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.sqrt(dot(a, a));
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1];
}

/** The angle between two vectors, robust at both ends. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const u = normalize(a), v = normalize(b);
  // atan2 of the cross and dot, rather than acos of the dot: acos loses all
  // its precision near zero and pi, which is exactly where conjunctions and
  // oppositions are.
  return Math.atan2(length(cross(u, v)), dot(u, v));
}

export const positionOf = (el: OrbitalElements, muStar: number, t: number): Vec3 => {
  const s = stateAt(el, muStar, t);
  return [s.x, s.y, s.z];
};

// ---------------------------------------------------------------------------
// Which way is up, out there
// ---------------------------------------------------------------------------

/** The normal of an orbit, from the angular momentum that defines it. */
export function orbitNormal(s: StateVector): Vec3 {
  return normalize(cross([s.x, s.y, s.z], [s.vx, s.vy, s.vz]));
}

/**
 * A world's rotation axis: its orbit normal, tipped by the obliquity.
 *
 * Which way it is tipped matters, because that is what makes seasons happen
 * in a particular month rather than another. The tip is taken about the
 * orbit's ascending node, a direction fixed in space for a fixed orbit - so
 * the axis is fixed too, and points at the same distant place all year. That
 * is the whole mechanism: the axis does not lean toward the star and away
 * again, it does not move at all, and the planet carries it round a circle so
 * that first one hemisphere and then the other is presented.
 */
export function spinAxis(s: StateVector, obliquity: number): Vec3 {
  const n = orbitNormal(s);
  // The node line, where the orbit crosses the reference plane. Degenerate
  // only for an orbit already in that plane, which needs any perpendicular.
  let node = cross([0, 0, 1], n);
  if (length(node) < 1e-9) node = [1, 0, 0];
  node = normalize(node);
  const c = Math.cos(obliquity), sn = Math.sin(obliquity);
  const perp = cross(node, n);
  return normalize([
    n[0] * c + perp[0] * sn, n[1] * c + perp[1] * sn, n[2] * c + perp[2] * sn,
  ]);
}

// ---------------------------------------------------------------------------
// From out there to over your head
// ---------------------------------------------------------------------------

/**
 * The scene's unit vector for an altitude and azimuth.
 *
 * Azimuth is measured from north turning east, the way every almanac and every
 * compass does it; the scene has y up and takes north as -z.
 */
export function dirFromAltAz(altitude: number, azimuth: number): Vec3 {
  const c = Math.cos(altitude);
  return [c * Math.sin(azimuth), Math.sin(altitude), -c * Math.cos(azimuth)];
}

/** And back again. */
export function altAzOf(v: Vec3): { altitude: number; azimuth: number } {
  const u = normalize(v);
  return {
    altitude: Math.asin(Math.max(-1, Math.min(1, u[1]))),
    azimuth: Math.atan2(u[0], -u[2]),
  };
}

/**
 * The rotation that carries one frame onto another, given two directions
 * known in both.
 *
 * This is the join between the ephemeris and the ground. Out in space a
 * planet's direction is a vector in the star's frame; underfoot it needs to be
 * an altitude and an azimuth. Two non-parallel directions pin a rotation
 * completely, and there are two to hand: the world's rotation axis, which
 * points at its own celestial pole and so stands at an altitude equal to the
 * latitude due north; and the star itself, whose place in the sky the
 * observer already knows because it is what makes the day.
 *
 * Building the map from those two rather than from Euler angles means the
 * star lands exactly where the sundial says it does - the correspondence is
 * imposed, not hoped for - and everything else is then carried along rigidly
 * and correctly with it.
 */
export function frameMap(
  aIn: Vec3, bIn: Vec3, aOut: Vec3, bOut: Vec3,
): (v: Vec3) => Vec3 {
  const tri = (a: Vec3, b: Vec3): [Vec3, Vec3, Vec3] => {
    const e1 = normalize(a);
    let r = sub(normalize(b), scale(e1, dot(normalize(b), e1)));
    // Degenerate when the two directions coincide - a star directly over the
    // pole, which a world of ninety degrees obliquity really does have at its
    // solstice. Any perpendicular will do; the roll about the axis is then
    // genuinely unconstrained.
    if (length(r) < 1e-9) {
      r = Math.abs(e1[0]) < 0.9 ? cross(e1, [1, 0, 0]) : cross(e1, [0, 1, 0]);
    }
    const e2 = normalize(r);
    return [e1, e2, cross(e1, e2)];
  };
  const [e1, e2, e3] = tri(aIn, bIn);
  const [f1, f2, f3] = tri(aOut, bOut);
  return (v: Vec3): Vec3 => {
    const p = dot(v, e1), q = dot(v, e2), s = dot(v, e3);
    return [
      f1[0] * p + f2[0] * q + f3[0] * s,
      f1[1] * p + f2[1] * q + f3[1] * s,
      f1[2] * p + f2[2] * q + f3[2] * s,
    ];
  };
}

// ---------------------------------------------------------------------------
// How bright a wanderer is
// ---------------------------------------------------------------------------

/**
 * The constant in the standard size-brightness relation, km.
 *
 * D = (1329 / sqrt(p)) * 10^(-H/5) is how every asteroid's diameter is
 * estimated from its brightness, and it runs backwards just as well. The
 * number is not arbitrary: it is what the solar constant, the magnitude
 * zero point and an astronomical unit come to when they are folded together.
 */
export const MAG_SIZE_CONST_KM = 1329;

/**
 * Absolute magnitude: how bright the body would look one AU from the star and
 * one AU from you, seen fully lit.
 *
 * Geometric albedo, not Bond albedo. The two differ by the phase integral -
 * how much light goes sideways rather than straight back - and taking them
 * equal is a simplification worth about a third of a magnitude on the real
 * planets. It is inside the error of everything else here.
 */
export function absoluteMagnitude(radiusM: number, geometricAlbedo: number): number {
  const dKm = (2 * radiusM) / 1000;
  const p = Math.max(1e-4, geometricAlbedo);
  if (dKm <= 0) return Infinity;
  return 5 * Math.log10(MAG_SIZE_CONST_KM / (dKm * Math.sqrt(p)));
}

/**
 * The fraction of full brightness left at a given phase angle, for a sphere
 * that scatters like matte paper.
 *
 * At opposition it is one. At quadrature it is 1/pi, not a half: the crescent
 * you can see is not only smaller in area, it is also lit at a slant. At new
 * it is zero. Real planets depart from this - Venus's clouds throw light
 * forward and it beats the law near new; the Moon's dust throws light straight
 * back and it beats the law at full - but the shape is right, and it is the
 * shape that makes Venus brightest as a crescent rather than as a full disc.
 */
export function lambertPhase(alphaRad: number): number {
  const a = Math.min(Math.PI, Math.max(0, alphaRad));
  return (Math.sin(a) + (Math.PI - a) * Math.cos(a)) / Math.PI;
}

/**
 * Apparent magnitude of a body lit by its star and seen from somewhere else.
 *
 * Two inverse squares - one for the light getting there, one for it getting
 * back - which is why the distances multiply inside a single logarithm.
 */
export function apparentMagnitude(
  absMag: number, heliocentricAu: number, observerDistanceAu: number, alphaRad: number,
): number {
  const phi = lambertPhase(alphaRad);
  if (!(phi > 0) || heliocentricAu <= 0 || observerDistanceAu <= 0) return Infinity;
  return absMag + 5 * Math.log10(heliocentricAu * observerDistanceAu) - 2.5 * Math.log10(phi);
}

/** Magnitudes lost to an optical depth. 2.5 log10(e), and no free parameters. */
export const EXTINCTION_PER_TAU = 2.5 * Math.LOG10E;
export const extinctionMag = (tau: number): number =>
  Number.isFinite(tau) ? EXTINCTION_PER_TAU * Math.max(0, tau) : Infinity;

/** Relative flux of a magnitude, against a chosen zero point. */
export const fluxOfMagnitude = (mag: number, zeroPoint = 0): number =>
  Math.pow(10, -0.4 * (mag - zeroPoint));

/**
 * The angle at the body between the star and the observer.
 *
 * Zero means you are looking straight down the beam and the whole lit face is
 * turned toward you; pi means you are behind it and looking at its night.
 */
export function phaseAngle(observer: Vec3, target: Vec3): number {
  // From the body: one arrow back to the star at the origin, one to the observer.
  return angleBetween(scale(target, -1), sub(observer, target));
}

/**
 * The angle at the observer between the star and the body - how far from the
 * sun it appears in the sky.
 *
 * Small elongation means lost in the glare; a hundred and eighty degrees means
 * opposition, up all night and at its closest. For a planet closer to the star
 * than you are it has a hard ceiling, and that ceiling is the whole reason
 * Venus is only ever seen at dusk or dawn.
 */
export function elongation(observer: Vec3, target: Vec3): number {
  return angleBetween(scale(observer, -1), sub(target, observer));
}

/** The largest elongation an inner planet can ever reach, radians. */
export const maxElongation = (aInner: number, aObserver: number): number =>
  aInner >= aObserver ? Math.PI : Math.asin(aInner / aObserver);

// ---------------------------------------------------------------------------
// One disc in front of another
// ---------------------------------------------------------------------------

/**
 * What fraction of the star's disc is hidden by a body of angular radius
 * `bodyRad` whose centre is `sepRad` away on the sky.
 *
 * The classical two-circle lens area. Every case is a real one and has been
 * stood under by somebody: the body too small and too far to touch it, an
 * annular eclipse where a whole small disc sits inside a larger one and takes
 * a fixed bite out of it, a total eclipse where the star is swallowed
 * entirely, and the partial phases either side.
 *
 * The reason this is one function rather than a state machine is that the
 * light level is then continuous through every one of those transitions, and
 * the eclipse does not begin - it just gets darker.
 */
export function coveredFraction(
  sepRad: number, starRad: number, bodyRad: number,
): number {
  const R = starRad, r = bodyRad, d = Math.abs(sepRad);
  if (!(R > 0)) return 0;
  if (r <= 0) return 0;
  if (d >= R + r) return 0;
  // One disc wholly inside the other.
  if (d <= Math.abs(R - r)) return r >= R ? 1 : (r * r) / (R * R);
  const d2 = d * d, R2 = R * R, r2 = r * r;
  const ca = Math.max(-1, Math.min(1, (d2 + R2 - r2) / (2 * d * R)));
  const cb = Math.max(-1, Math.min(1, (d2 + r2 - R2) / (2 * d * r)));
  const tri = Math.sqrt(Math.max(0,
    (-d + r + R) * (d + r - R) * (d - r + R) * (d + r + R)));
  const area = R2 * Math.acos(ca) + r2 * Math.acos(cb) - 0.5 * tri;
  return Math.max(0, Math.min(1, area / (Math.PI * R2)));
}

/**
 * What an eclipse does to the light, as opposed to the geometry.
 *
 * Not simply one minus the covered fraction, because a star is not a uniform
 * disc. It is limb darkened: looking at the middle of it you see straight down
 * into the photosphere, and looking at the rim you see a slant path that turns
 * opaque higher up and cooler. So the centre is brighter than the edge, the
 * first bite out of the limb costs less light than its area, and the last
 * sliver before totality costs far more.
 *
 * That is not a detail. It is why the light does not fade linearly through a
 * partial eclipse but hangs on and then falls off a cliff, and it is why an
 * annular eclipse - which leaves a full seven percent of the disc showing -
 * still takes ninety-six percent of the light away, because the seven percent
 * it leaves is the faint rim.
 *
 * The integral is done in annuli. For a ring at fractional radius x, the piece
 * of it hidden behind a circular occulter is an arc, and the arc is closed
 * form; the rest is quadrature over x with the linear limb-darkening law as
 * the weight. Two hundred steps, once a frame.
 */
export const LIMB_DARKENING_U = 0.6;
export const LIMB_STEPS = 256;

export function eclipseLight(
  sepRad: number, starRad: number, bodyRad: number, u = LIMB_DARKENING_U,
): number {
  if (!(starRad > 0) || !(bodyRad > 0)) return 1;
  const d = Math.abs(sepRad) / starRad, rho = bodyRad / starRad;
  if (d >= 1 + rho) return 1;
  if (rho >= 1 && d <= rho - 1) return 0;

  let hidden = 0, total = 0;
  const dx = 1 / LIMB_STEPS;
  for (let k = 0; k < LIMB_STEPS; k++) {
    const x = (k + 0.5) * dx;
    // Linear limb darkening: I/I0 = 1 - u(1 - mu), with mu the cosine of the
    // angle between the line of sight and the local vertical.
    const mu = Math.sqrt(Math.max(0, 1 - x * x));
    const w = (1 - u * (1 - mu)) * 2 * x * dx;
    total += w;
    hidden += w * arcCovered(x, d, rho);
  }
  return total > 0 ? Math.max(0, Math.min(1, 1 - hidden / total)) : 1;
}

/**
 * The fraction of a circle of radius x, centred on the star, that lies inside
 * an occulting disc of radius rho whose centre is d away. All in units of the
 * star's radius.
 */
export function arcCovered(x: number, d: number, rho: number): number {
  if (rho <= 0 || x < 0) return 0;
  if (d <= 1e-12) return x <= rho ? 1 : 0;
  if (x <= 1e-12) return d <= rho ? 1 : 0;
  if (x + d <= rho) return 1;          // the ring is swallowed whole
  if (d >= x + rho) return 0;          // the occulter is off past the ring
  if (x >= d + rho) return 0;          // the occulter sits inside the ring
  const c = (x * x + d * d - rho * rho) / (2 * x * d);
  return Math.acos(Math.max(-1, Math.min(1, c))) / Math.PI;
}

// ---------------------------------------------------------------------------
// The whole sky at once
// ---------------------------------------------------------------------------

export interface Wanderer {
  name: string;
  /** Unit vector toward it, in the observer's local frame: y up, north -z. */
  dir: Vec3;
  altitude: number;
  azimuth: number;
  /** Apparent magnitude above the atmosphere. */
  mag: number;
  /** Angular radius as seen from here, radians. */
  angRad: number;
  /** Distance from the observer, AU. */
  distanceAu: number;
  /** Angle from the star on the sky, radians. */
  elongationRad: number;
  /** Angle at the body between star and observer, radians. */
  phaseRad: number;
  /** Fraction of the disc that is lit. */
  litFraction: number;
  color: [number, number, number];
}

export interface Body {
  name: string;
  radiusM: number;
  albedo: number;
  elements: OrbitalElements;
  color: [number, number, number];
}

/**
 * Every other body of the system, placed in the observer's sky.
 *
 * The observer is given as a heliocentric position and a frame map, so this
 * works unchanged whether you are standing on a planet or on one of its moons
 * a million kilometres off to the side - the parallax is simply in the
 * subtraction like everything else.
 */
export function skyBodies(
  bodies: Body[], observerPos: Vec3, muStar: number, t: number,
  toLocal: (v: Vec3) => Vec3, skip = -1,
): Wanderer[] {
  const out: Wanderer[] = [];
  for (let i = 0; i < bodies.length; i++) {
    if (i === skip) continue;
    const b = bodies[i];
    const p = positionOf(b.elements, muStar, t);
    const rel = sub(p, observerPos);
    const distM = length(rel);
    if (distM <= 0) continue;
    const alpha = phaseAngle(observerPos, p);
    const mag = apparentMagnitude(
      absoluteMagnitude(b.radiusM, b.albedo),
      length(p) / AU, distM / AU, alpha,
    );
    const dir = toLocal(normalize(rel));
    const aa = altAzOf(dir);
    out.push({
      name: b.name,
      dir, altitude: aa.altitude, azimuth: aa.azimuth,
      mag,
      angRad: Math.atan2(b.radiusM, distM),
      distanceAu: distM / AU,
      elongationRad: elongation(observerPos, p),
      phaseRad: alpha,
      litFraction: (1 + Math.cos(alpha)) / 2,
      color: b.color,
    });
  }
  out.sort((a, b) => a.mag - b.mag);
  return out;
}

/** The star's own angular radius from wherever the observer is standing. */
export const starAngularRadius = (radiusRsun: number, distanceM: number): number =>
  Math.atan2(radiusRsun * R_SUN, Math.max(1, distanceM));
