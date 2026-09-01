/**
 * The primordial matter power spectrum.
 *
 * P(k) = A k^ns T(k)^2 D(a)^2
 *
 * where T(k) is the Eisenstein & Hu (1998) fitting formula for the CDM+baryon
 * transfer function, *including* the baryon acoustic oscillations. Those wiggles
 * are the sound waves that were frozen into the plasma at recombination; they
 * survive today as a ~150 Mpc preferred separation between galaxies, and they
 * are visible in the structure this simulation grows.
 *
 * Reference: Eisenstein & Hu, ApJ 496, 605 (1998), eqns 1-31.
 * All wavenumbers here are in Mpc^-1 (physical, not h/Mpc).
 */

import { Cosmology, h as hOf } from './lcdm';

interface EHParams {
  omhh: number;      // Om h^2
  obhh: number;      // Ob h^2
  theta: number;     // Tcmb / 2.7 K
  fBaryon: number;   // Ob / Om
  fCdm: number;
  zEq: number;
  kEq: number;       // Mpc^-1
  zDrag: number;
  Rdrag: number;
  Req: number;
  soundHorizon: number; // Mpc
  kSilk: number;     // Mpc^-1
  alphaC: number;
  betaC: number;
  alphaB: number;
  betaB: number;
  betaNode: number;
}

export function ehParams(c: Cosmology): EHParams {
  const hh = hOf(c);
  const omhh = c.Om * hh * hh;
  const obhh = c.Ob * hh * hh;
  const theta = c.Tcmb / 2.7;
  const fBaryon = Math.max(c.Ob / c.Om, 1e-6);
  const fCdm = 1 - fBaryon;

  const zEq = 2.5e4 * omhh * Math.pow(theta, -4);
  const kEq = 7.46e-2 * omhh * Math.pow(theta, -2);

  const b1 = 0.313 * Math.pow(omhh, -0.419) * (1 + 0.607 * Math.pow(omhh, 0.674));
  const b2 = 0.238 * Math.pow(omhh, 0.223);
  const zDrag =
    (1291 * Math.pow(omhh, 0.251) / (1 + 0.659 * Math.pow(omhh, 0.828))) *
    (1 + b1 * Math.pow(obhh, b2));

  // Baryon-photon momentum density ratio R(z) = 3 rho_b / 4 rho_gamma
  const Rof = (z: number) => (31.5 * obhh * Math.pow(theta, -4) * 1000) / z;
  const Rdrag = Rof(zDrag);
  const Req = Rof(zEq);

  // Comoving sound horizon at the drag epoch (Mpc)
  const soundHorizon =
    ((2 / (3 * kEq)) * Math.sqrt(6 / Req)) *
    Math.log((Math.sqrt(1 + Rdrag) + Math.sqrt(Rdrag + Req)) / (1 + Math.sqrt(Req)));

  const kSilk =
    1.6 * Math.pow(obhh, 0.52) * Math.pow(omhh, 0.73) * (1 + Math.pow(10.4 * omhh, -0.95));

  const a1 = Math.pow(46.9 * omhh, 0.670) * (1 + Math.pow(32.1 * omhh, -0.532));
  const a2 = Math.pow(12.0 * omhh, 0.424) * (1 + Math.pow(45.0 * omhh, -0.582));
  const alphaC = Math.pow(a1, -fBaryon) * Math.pow(a2, -(fBaryon * fBaryon * fBaryon));

  const bb1 = 0.944 / (1 + Math.pow(458 * omhh, -0.708));
  const bb2 = Math.pow(0.395 * omhh, -0.0266);
  const betaC = 1 / (1 + bb1 * (Math.pow(fCdm, bb2) - 1));

  const y = (1 + zEq) / (1 + zDrag);
  const sq = Math.sqrt(1 + y);
  const Gy = y * (-6 * sq + (2 + 3 * y) * Math.log((sq + 1) / (sq - 1)));
  const alphaB = 2.07 * kEq * soundHorizon * Math.pow(1 + Rdrag, -0.75) * Gy;
  const betaB =
    0.5 + fBaryon + (3 - 2 * fBaryon) * Math.sqrt(Math.pow(17.2 * omhh, 2) + 1);
  const betaNode = 8.41 * Math.pow(omhh, 0.435);

  return {
    omhh, obhh, theta, fBaryon, fCdm, zEq, kEq, zDrag, Rdrag, Req,
    soundHorizon, kSilk, alphaC, betaC, alphaB, betaB, betaNode,
  };
}

/** EH98 eqn 19-20: the "pressureless" transfer shape. */
function T0tilde(q: number, alpha: number, beta: number): number {
  const Cq = 14.2 / alpha + 386 / (1 + 69.9 * Math.pow(q, 1.08));
  const L = Math.log(Math.E + 1.8 * beta * q);
  return L / (L + Cq * q * q);
}

/**
 * Full CDM + baryon transfer function T(k), normalised to T(k->0) = 1.
 * `k` in Mpc^-1.
 */
export function transferFunction(p: EHParams, k: number): number {
  if (k <= 0) return 1;
  const q = k / (13.41 * p.kEq);
  const ks = k * p.soundHorizon;

  // --- CDM piece: interpolates between suppressed and unsuppressed growth
  const f = 1 / (1 + Math.pow(ks / 5.4, 4));
  const Tc = f * T0tilde(q, 1, p.betaC) + (1 - f) * T0tilde(q, p.alphaC, p.betaC);

  // --- Baryon piece: acoustic oscillations, Silk-damped
  const sTilde = p.soundHorizon / Math.cbrt(1 + Math.pow(p.betaNode / ks, 3));
  const kst = k * sTilde;
  const j0 = kst === 0 ? 1 : Math.sin(kst) / kst;
  const Tb =
    (T0tilde(q, 1, 1) / (1 + Math.pow(ks / 5.2, 2)) +
      (p.alphaB / (1 + Math.pow(p.betaB / ks, 3))) * Math.exp(-Math.pow(k / p.kSilk, 1.4))) *
    j0;

  return p.fBaryon * Tb + p.fCdm * Tc;
}

/** Top-hat window function in Fourier space. */
export function topHatWindow(x: number): number {
  if (x < 1e-4) return 1 - (x * x) / 10;
  return (3 * (Math.sin(x) - x * Math.cos(x))) / (x * x * x);
}

/**
 * A ready-to-sample power spectrum, normalised so that the rms linear
 * fluctuation inside 8 Mpc/h spheres equals the cosmology's sigma_8.
 */
export class PowerSpectrum {
  readonly params: EHParams;
  readonly amplitude: number;
  readonly ns: number;

  constructor(readonly cosmo: Cosmology) {
    this.params = ehParams(cosmo);
    this.ns = cosmo.ns;
    // Unnormalised sigma_8^2 = 1/(2pi^2) Int P(k) W^2(kR) k^2 dk, R = 8 Mpc/h
    const R = 8 / hOf(cosmo);
    const lnkMin = Math.log(1e-5);
    const lnkMax = Math.log(1e3);
    const n = 4000;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const lnk = lnkMin + ((i + 0.5) * (lnkMax - lnkMin)) / n;
      const k = Math.exp(lnk);
      const t = transferFunction(this.params, k);
      const pk = Math.pow(k, this.ns) * t * t;
      const w = topHatWindow(k * R);
      sum += pk * w * w * k * k * k; // extra k for dlnk
    }
    const sigma2 = (sum * ((lnkMax - lnkMin) / n)) / (2 * Math.PI * Math.PI);
    this.amplitude = (cosmo.sigma8 * cosmo.sigma8) / sigma2;
  }

  /** Linear P(k) today, in Mpc^3, for k in Mpc^-1. */
  P(k: number): number {
    if (k <= 0) return 0;
    const t = transferFunction(this.params, k);
    return this.amplitude * Math.pow(k, this.ns) * t * t;
  }

  /** rms linear fluctuation in spheres of radius R (Mpc). */
  sigmaR(R: number): number {
    const lnkMin = Math.log(1e-5);
    const lnkMax = Math.log(1e3);
    const n = 3000;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const lnk = lnkMin + ((i + 0.5) * (lnkMax - lnkMin)) / n;
      const k = Math.exp(lnk);
      const w = topHatWindow(k * R);
      sum += this.P(k) * w * w * k * k * k;
    }
    return Math.sqrt((sum * ((lnkMax - lnkMin) / n)) / (2 * Math.PI * Math.PI));
  }

  /** Comoving sound horizon at the drag epoch, Mpc: the BAO standard ruler. */
  get baoScaleMpc(): number {
    return this.params.soundHorizon;
  }
}
