/**
 * Gravitational lensing by a cluster.
 *
 * The lens equation maps an observed direction to the true direction of the
 * source that produced it:
 *
 *     beta = theta - alpha(theta)
 *
 * When that map stops being one-to-one, one source appears as several images,
 * and where the Jacobian is singular a point source is stretched into an arc.
 * Everything a cluster lens does follows from those two facts.
 *
 * The mass model is a non-singular isothermal ellipsoid, the standard
 * parametrisation for cluster lenses, with lensing potential
 *
 *     psi(x, y) = theta_E sqrt(theta_c^2 + x^2/q + y^2 q)
 *
 * and alpha = grad psi. These routines are the reference implementation; the
 * shader in render/lensedfield.ts transcribes `deflection` exactly, and the
 * tests here are what keep the two honest.
 */

/** Speed of light, km/s. */
const C_KMS = 299792.458;

/**
 * Einstein angle of an isothermal sphere for sources far behind the lens:
 *
 *     theta_E = 4 pi (sigma/c)^2 * D_LS/D_S
 *
 * With D_LS/D_S -> 1 this is about 40 arcseconds for a 1200 km/s cluster,
 * which is why cluster arcs are a telescope phenomenon.
 */
export function einsteinAngle(sigmaKms: number, dlsOverDs = 1): number {
  const b = sigmaKms / C_KMS;
  return 4 * Math.PI * b * b * dlsOverDs;
}

export interface LensModel {
  /** Einstein angle, radians. */
  thetaE: number;
  /** Core radius, radians. A core comparable to thetaE makes the lens sub-critical. */
  thetaCore: number;
  /** Projected axis ratio of the mass distribution, 0 < q <= 1. */
  q: number;
  /** Position angle of the major axis, radians. */
  pa: number;
}

/**
 * Deflection of the non-singular isothermal ellipsoid, radians.
 * Transcribed verbatim into the fragment shader; keep them in step.
 */
export function deflection(m: LensModel, tx: number, ty: number): [number, number] {
  const c = Math.cos(m.pa), s = Math.sin(m.pa);
  const rx = tx * c + ty * s;
  const ry = -tx * s + ty * c;
  const q = Math.max(m.q, 0.15);
  const d = Math.sqrt(m.thetaCore * m.thetaCore + (rx * rx) / q + ry * ry * q);
  const ax = (m.thetaE * (rx / q)) / Math.max(d, 1e-30);
  const ay = (m.thetaE * (ry * q)) / Math.max(d, 1e-30);
  return [ax * c - ay * s, ax * s + ay * c];
}

/** Source-plane position of an observed direction. */
export function lensEquation(m: LensModel, tx: number, ty: number): [number, number] {
  const [ax, ay] = deflection(m, tx, ty);
  return [tx - ax, ty - ay];
}

/**
 * Determinant of the lens Jacobian A = d beta / d theta. Its zeros are the
 * critical curves; the magnification is 1/|det A|, so it formally diverges
 * there - which is what an arc is.
 */
export function jacobianDet(m: LensModel, tx: number, ty: number, h?: number): number {
  const step = h ?? Math.max(m.thetaE * 1e-3, 1e-12);
  const [axp, ayp] = deflection(m, tx + step, ty);
  const [axm, aym] = deflection(m, tx - step, ty);
  const [axq, ayq] = deflection(m, tx, ty + step);
  const [axr, ayr] = deflection(m, tx, ty - step);
  const dxdx = (axp - axm) / (2 * step);
  const dydx = (ayp - aym) / (2 * step);
  const dxdy = (axq - axr) / (2 * step);
  const dydy = (ayq - ayr) / (2 * step);
  return (1 - dxdx) * (1 - dydy) - dydx * dxdy;
}

export const magnification = (m: LensModel, tx: number, ty: number): number =>
  1 / Math.abs(jacobianDet(m, tx, ty));

/**
 * Images of a source on the major axis of a circularly symmetric lens.
 *
 * Along that line the problem is one-dimensional: solve theta - alpha(theta) =
 * beta by scanning for sign changes and bisecting. A supercritical lens gives
 * two images for a source inside its caustic, one on each side of the centre,
 * and the classic result that the outer image is the brighter one.
 */
export function imagesOnAxis(m: LensModel, beta: number, span = 6): number[] {
  const f = (t: number) => t - deflection(m, t, 0)[0] - beta;
  const lo = -span * m.thetaE;
  const hi = span * m.thetaE;
  const N = 4000;
  const out: number[] = [];
  let prev = f(lo);
  for (let i = 1; i <= N; i++) {
    const t = lo + ((hi - lo) * i) / N;
    const cur = f(t);
    if (prev === 0) out.push(lo + ((hi - lo) * (i - 1)) / N);
    else if (prev * cur < 0) {
      let a = lo + ((hi - lo) * (i - 1)) / N;
      let b = t;
      for (let k = 0; k < 80; k++) {
        const mid = (a + b) / 2;
        if (f(a) * f(mid) <= 0) b = mid; else a = mid;
      }
      out.push((a + b) / 2);
    }
    prev = cur;
  }
  return out;
}

/** Radius of the tangential critical curve, radians, or NaN if sub-critical. */
export function tangentialCriticalRadius(m: LensModel): number {
  // For a circular lens the tangential eigenvalue is 1 - alpha(theta)/theta.
  const f = (t: number) => 1 - deflection(m, t, 0)[0] / t;
  let lo = m.thetaE * 1e-4;
  let hi = m.thetaE * 6;
  if (f(lo) * f(hi) > 0) return NaN;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Whether the lens produces multiple images at all. */
export const isSupercritical = (m: LensModel): boolean =>
  Number.isFinite(tangentialCriticalRadius(m));

/**
 * Projected mass inside the Einstein radius:
 *   M_E = theta_E^2 c^2 D_L D_S / (4 G D_LS)
 * For an isothermal sphere with sources far behind, this reduces to
 * pi sigma^2 D_L theta_E / G. It is the quantity a lensing measurement
 * actually returns, and it needs no assumption of dynamical equilibrium -
 * which is why lensing and velocity dispersions are independent ways of
 * weighing a cluster.
 */
export function einsteinMass(sigmaKms: number, distanceMpc: number): number {
  const G = 4.30091e-9; // Mpc (km/s)^2 / Msun
  return (Math.PI * sigmaKms * sigmaKms * distanceMpc * einsteinAngle(sigmaKms)) / G;
}
