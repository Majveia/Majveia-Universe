/**
 * Star colour, computed rather than art-directed.
 *
 * Planck's law gives spectral radiance at temperature T; integrating it against
 * the CIE 1931 colour-matching functions gives tristimulus XYZ; a linear
 * transform gives sRGB. So an M dwarf comes out orange, the Sun comes out
 * white-with-a-hint-of-yellow, and a Wolf-Rayet star comes out blue-white -
 * because that is what the physics says, not because someone picked a swatch.
 *
 * The colour-matching functions use the multi-lobe Gaussian fits of
 * Wyman, Sloan & Shirley (JCGT 2013), accurate to well under a JND.
 */

import { C, H_PLANCK, K_B, WIEN_B } from '../core/constants';

/** Spectral radiance of a blackbody, W sr^-1 m^-3, for wavelength in metres. */
export function planck(lambdaM: number, T: number): number {
  const l5 = lambdaM ** 5;
  const x = (H_PLANCK * C) / (lambdaM * K_B * T);
  return (2 * H_PLANCK * C * C) / (l5 * (Math.exp(x) - 1));
}

/** Peak emission wavelength, m (Wien's displacement law). */
export const wienPeak = (T: number): number => WIEN_B / T;

/** Piecewise Gaussian used by the CIE fits. */
function pg(x: number, mu_: number, s1: number, s2: number): number {
  const t = (x - mu_) * (x < mu_ ? 1 / s1 : 1 / s2);
  return Math.exp(-0.5 * t * t);
}

/** CIE 1931 colour matching functions, wavelength in nm. */
export function cieXYZBar(nm: number): [number, number, number] {
  const x = 1.056 * pg(nm, 599.8, 37.9, 31.0) + 0.362 * pg(nm, 442.0, 16.0, 26.7)
    - 0.065 * pg(nm, 501.1, 20.4, 26.2);
  const y = 0.821 * pg(nm, 568.8, 46.9, 40.5) + 0.286 * pg(nm, 530.9, 16.3, 31.1);
  const z = 1.217 * pg(nm, 437.0, 11.8, 36.0) + 0.681 * pg(nm, 459.0, 26.0, 13.8);
  return [x, y, z];
}

/** Integrate a blackbody spectrum against the CIE functions -> XYZ (Y normalised to 1). */
export function blackbodyXYZ(T: number): [number, number, number] {
  let X = 0, Y = 0, Z = 0;
  for (let nm = 360; nm <= 830; nm += 2) {
    const I = planck(nm * 1e-9, T);
    const [xb, yb, zb] = cieXYZBar(nm);
    X += I * xb; Y += I * yb; Z += I * zb;
  }
  if (Y <= 0) return [0, 0, 0];
  return [X / Y, 1, Z / Y];
}

/** Linear sRGB primaries (D65). */
export function xyzToLinearSRGB(X: number, Y: number, Z: number): [number, number, number] {
  return [
    3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
    -0.969266 * X + 1.8760108 * Y + 0.041556 * Z,
    0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z,
  ];
}

export function linearToSRGB(u: number): number {
  const v = Math.max(0, Math.min(1, u));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

const bbCache = new Map<number, [number, number, number]>();

/**
 * Linear-light RGB for a blackbody of temperature T, normalised so the
 * brightest channel is 1. Rendering multiplies this by physical luminosity;
 * keeping the hue and the intensity separate is what lets an OLED show a
 * red dwarf next to an O star without one of them clipping to white.
 */
export function blackbodyRGB(T: number): [number, number, number] {
  const key = Math.round(Math.max(500, Math.min(60000, T)) / 25) * 25;
  const hit = bbCache.get(key);
  if (hit) return hit;
  const [X, Y, Z] = blackbodyXYZ(key);
  let [r, g, b] = xyzToLinearSRGB(X, Y, Z);
  // Desaturate slightly out-of-gamut extremes rather than clipping to a hue shift
  const minC = Math.min(r, g, b);
  if (minC < 0) { r -= minC; g -= minC; b -= minC; }
  const maxC = Math.max(r, g, b, 1e-9);
  const out: [number, number, number] = [r / maxC, g / maxC, b / maxC];
  bbCache.set(key, out);
  return out;
}

/** Hex string for UI chips. */
export function blackbodyHex(T: number): string {
  const [r, g, b] = blackbodyRGB(T);
  const to = (v: number) => Math.round(linearToSRGB(v) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * Approximate B-V colour index from effective temperature
 * (Ballesteros 2012, inverted). Handy for labelling stars the way catalogues do.
 */
export function bvFromTeff(T: number): number {
  // T = 4600 (1/(0.92 BV + 1.7) + 1/(0.92 BV + 0.62))
  let lo = -0.4, hi = 2.5;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const t = 4600 * (1 / (0.92 * mid + 1.7) + 1 / (0.92 * mid + 0.62));
    if (t > T) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
