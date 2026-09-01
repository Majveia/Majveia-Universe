/**
 * Two-body orbital mechanics.
 *
 * Everything that orbits in this universe - moons, planets, binary stars,
 * stars around a galactic centre, comets on hyperbolic flybys - is propagated
 * with these routines. Orbits are stored as classical elements and evaluated
 * analytically, so a planet's position after ten million years costs exactly as
 * much to compute as its position one second from now, and never drifts.
 */

import { C, G, TAU } from '../core/constants';

export interface OrbitalElements {
  /** Semi-major axis, m. Negative for hyperbolic orbits. */
  a: number;
  /** Eccentricity. */
  e: number;
  /** Inclination, rad. */
  i: number;
  /** Longitude of the ascending node, rad. */
  Omega: number;
  /** Argument of periapsis, rad. */
  omega: number;
  /** Mean anomaly at the epoch, rad. */
  M0: number;
  /** Epoch, s (simulation time). */
  epoch: number;
}

export interface StateVector {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
}

/** Standard gravitational parameter of a body of mass m (kg), m^3/s^2. */
export const mu = (massKg: number): number => G * massKg;

/** Orbital period from Kepler's third law, s. */
export const period = (a: number, muTotal: number): number =>
  TAU * Math.sqrt((a * a * a) / muTotal);

/** Mean motion, rad/s. */
export const meanMotion = (a: number, muTotal: number): number =>
  Math.sqrt(muTotal / (a * a * a));

/** Orbital speed at radius r (vis-viva equation), m/s. */
export const visViva = (r: number, a: number, muTotal: number): number =>
  Math.sqrt(muTotal * (2 / r - 1 / a));

/** Escape velocity at radius r, m/s. */
export const escapeVelocity = (r: number, muTotal: number): number => Math.sqrt((2 * muTotal) / r);

/** Circular orbital velocity at radius r, m/s. */
export const circularVelocity = (r: number, muTotal: number): number => Math.sqrt(muTotal / r);

export const periapsis = (a: number, e: number): number => a * (1 - e);
export const apoapsis = (a: number, e: number): number => a * (1 + e);

/**
 * Solve Kepler's equation M = E - e sin E for the eccentric anomaly.
 *
 * Uses the Markley-style starter followed by Newton-Raphson with a Halley
 * correction; converges to double precision in 2-3 iterations even at e = 0.99,
 * where a naive E = M starter needs dozens.
 */
export function solveKeplerElliptic(M: number, e: number): number {
  let m = M % TAU;
  if (m < 0) m += TAU;
  if (e < 1e-12) return m;

  // E = M + e sin E, and |e sin E| <= e, so the root is rigorously bracketed.
  // Keeping that bracket makes the iteration unconditionally convergent - a
  // bare Newton/Halley step diverges above e ~ 0.95, which matters because
  // long-period comets in this simulation reach e = 0.999.
  let lo = m - e;
  let hi = m + e;
  let E = m + e * Math.sin(m) * (1 + e * Math.cos(m));

  for (let it = 0; it < 64; it++) {
    if (E <= lo || E >= hi) E = 0.5 * (lo + hi);
    const s = Math.sin(E), c = Math.cos(E);
    const f = E - e * s - m;
    if (Math.abs(f) < 1e-15) return E;
    if (f > 0) hi = E; else lo = E;
    const f1 = 1 - e * c;
    const f2 = e * s;
    // Halley step, guarded against a vanishing denominator near e -> 1
    const den = f1 - (0.5 * f * f2) / f1;
    let next = Math.abs(den) > 1e-30 ? E - f / den : E - f / f1;
    if (!(next > lo && next < hi) || !Number.isFinite(next)) next = 0.5 * (lo + hi);
    if (Math.abs(next - E) < 1e-16) return next;
    E = next;
  }
  return E;
}

/** Solve the hyperbolic Kepler equation M = e sinh H - H. */
export function solveKeplerHyperbolic(M: number, e: number): number {
  let H = Math.sign(M) * Math.log((2 * Math.abs(M)) / e + 1.8);
  if (!Number.isFinite(H)) H = M;
  for (let it = 0; it < 60; it++) {
    const sh = Math.sinh(H), ch = Math.cosh(H);
    const f = e * sh - H - M;
    const f1 = e * ch - 1;
    const d = f / f1;
    H -= d;
    if (Math.abs(d) < 1e-14) break;
  }
  return H;
}

/** True anomaly from eccentric anomaly (elliptic). */
export const trueFromEccentric = (E: number, e: number): number =>
  2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));

/** Eccentric anomaly from true anomaly (elliptic). */
export const eccentricFromTrue = (nu: number, e: number): number =>
  2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));

/**
 * Position and velocity in the parent's inertial frame at time t.
 * Handles elliptic (e < 1) and hyperbolic (e > 1) orbits.
 */
export function stateAt(el: OrbitalElements, muTotal: number, t: number, out?: StateVector): StateVector {
  const o = out ?? { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  const dt = t - el.epoch;
  let xp: number, yp: number, vxp: number, vyp: number;

  if (el.e < 1) {
    const n = meanMotion(el.a, muTotal);
    const M = el.M0 + n * dt;
    const E = solveKeplerElliptic(M, el.e);
    const cE = Math.cos(E), sE = Math.sin(E);
    const r = el.a * (1 - el.e * cE);
    xp = el.a * (cE - el.e);
    yp = el.a * Math.sqrt(1 - el.e * el.e) * sE;
    const rdot = (Math.sqrt(muTotal * el.a) / r);
    vxp = -rdot * sE;
    vyp = rdot * Math.sqrt(1 - el.e * el.e) * cE;
  } else {
    const aAbs = Math.abs(el.a);
    const n = Math.sqrt(muTotal / (aAbs * aAbs * aAbs));
    const M = el.M0 + n * dt;
    const H = solveKeplerHyperbolic(M, el.e);
    const cH = Math.cosh(H), sH = Math.sinh(H);
    const r = aAbs * (el.e * cH - 1);
    xp = aAbs * (el.e - cH);
    yp = aAbs * Math.sqrt(el.e * el.e - 1) * sH;
    const rdot = Math.sqrt(muTotal * aAbs) / r;
    vxp = -rdot * sH;
    vyp = rdot * Math.sqrt(el.e * el.e - 1) * cH;
  }

  // Rotate perifocal -> inertial: Rz(Omega) Rx(i) Rz(omega)
  const co = Math.cos(el.omega), so = Math.sin(el.omega);
  const cO = Math.cos(el.Omega), sO = Math.sin(el.Omega);
  const ci = Math.cos(el.i), si = Math.sin(el.i);

  const m11 = cO * co - sO * so * ci;
  const m12 = -cO * so - sO * co * ci;
  const m21 = sO * co + cO * so * ci;
  const m22 = -sO * so + cO * co * ci;
  const m31 = so * si;
  const m32 = co * si;

  o.x = m11 * xp + m12 * yp;
  o.y = m21 * xp + m22 * yp;
  o.z = m31 * xp + m32 * yp;
  o.vx = m11 * vxp + m12 * vyp;
  o.vy = m21 * vxp + m22 * vyp;
  o.vz = m31 * vxp + m32 * vyp;
  return o;
}

/** Convert a Cartesian state vector into classical orbital elements. */
export function elementsFromState(s: StateVector, muTotal: number, epoch: number): OrbitalElements {
  const rx = s.x, ry = s.y, rz = s.z;
  const vx = s.vx, vy = s.vy, vz = s.vz;
  const r = Math.hypot(rx, ry, rz);
  const v2 = vx * vx + vy * vy + vz * vz;

  // Specific angular momentum h = r x v
  const hx = ry * vz - rz * vy;
  const hy = rz * vx - rx * vz;
  const hz = rx * vy - ry * vx;
  const hMag = Math.hypot(hx, hy, hz);

  // Eccentricity vector e = (v x h)/mu - r/|r|
  const ex = (vy * hz - vz * hy) / muTotal - rx / r;
  const ey = (vz * hx - vx * hz) / muTotal - ry / r;
  const ez = (vx * hy - vy * hx) / muTotal - rz / r;
  const e = Math.hypot(ex, ey, ez);

  const energy = v2 / 2 - muTotal / r;
  const a = Math.abs(energy) < 1e-30 ? Infinity : -muTotal / (2 * energy);
  const i = Math.acos(Math.max(-1, Math.min(1, hz / hMag)));

  // Node vector n = z x h
  const nx = -hy, ny = hx;
  const nMag = Math.hypot(nx, ny);

  let Omega = nMag > 1e-12 ? Math.acos(Math.max(-1, Math.min(1, nx / nMag))) : 0;
  if (ny < 0) Omega = TAU - Omega;

  let omega = 0;
  if (nMag > 1e-12 && e > 1e-12) {
    omega = Math.acos(Math.max(-1, Math.min(1, (nx * ex + ny * ey) / (nMag * e))));
    if (ez < 0) omega = TAU - omega;
  } else if (e > 1e-12) {
    omega = Math.atan2(ey, ex);
  }

  let nu = 0;
  if (e > 1e-12) {
    nu = Math.acos(Math.max(-1, Math.min(1, (ex * rx + ey * ry + ez * rz) / (e * r))));
    if (rx * vx + ry * vy + rz * vz < 0) nu = TAU - nu;
  } else {
    nu = Math.atan2(ry, rx) - Omega;
  }

  let M0: number;
  if (e < 1) {
    const E = eccentricFromTrue(nu, e);
    M0 = E - e * Math.sin(E);
  } else {
    const H = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
    M0 = e * Math.sinh(H) - H;
  }

  return { a, e, i, Omega, omega, M0, epoch };
}

/**
 * Hill sphere radius: how far a secondary's gravity dominates over the primary's.
 * Moons must orbit inside ~1/3 to 1/2 of this to be stable.
 */
export const hillRadius = (a: number, e: number, mSecondary: number, mPrimary: number): number =>
  a * (1 - e) * Math.cbrt(mSecondary / (3 * (mPrimary + mSecondary)));

/** Laplace sphere of influence - the usual patched-conic handover radius. */
export const sphereOfInfluence = (a: number, mSecondary: number, mPrimary: number): number =>
  a * Math.pow(mSecondary / mPrimary, 0.4);

/**
 * General-relativistic apsidal precession, radians per orbit:
 *   dphi = 6 pi G M / (c^2 a (1 - e^2))
 * For Mercury this gives 43 arcsec/century, the classic test of GR - and the
 * simulation applies it, so Mercury's orbit really does rotate.
 */
export const relativisticPrecessionPerOrbit = (a: number, e: number, muTotal: number): number =>
  (6 * Math.PI * muTotal) / (C * C * a * (1 - e * e));

/** Innermost stable circular orbit around a Schwarzschild black hole, m. */
export const isco = (muBH: number): number => (6 * muBH) / (C * C);

/** Photon sphere radius around a Schwarzschild black hole, m. */
export const photonSphere = (muBH: number): number => (3 * muBH) / (C * C);

/**
 * Tidal-locking timescale, very roughly (Gladman et al. 1996 scaling).
 * Used to decide whether a close-in planet keeps a day.
 */
export function tidalLockingTimeYears(
  aMeters: number, mPlanetKg: number, rPlanetM: number, mStarKg: number, Q = 100, k2 = 0.3,
): number {
  const numerator = Q * Math.pow(aMeters, 6) * mPlanetKg;
  const denom = 3 * k2 * G * mStarKg * mStarKg * Math.pow(rPlanetM, 3);
  return numerator / denom / 3.15576e7;
}
