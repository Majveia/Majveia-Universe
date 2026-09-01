/**
 * Flat LambdaCDM background cosmology.
 *
 * Everything here is derived from the Friedmann equations with a
 * radiation + matter + curvature + cosmological-constant energy budget:
 *
 *   E(a) = H(a)/H0 = sqrt( Or a^-4 + Om a^-3 + Ok a^-2 + OL )
 *
 * The default parameters are Planck 2018; a different `Cosmology` object can be
 * passed to explore alternate universes (that is a supported gameplay feature,
 * not an accident - see `PRESET_COSMOLOGIES`).
 */

import {
  C,
  GYR,
  H0 as H0_SI,
  HUBBLE_TIME,
  MPC,
  OMEGA_LAMBDA,
  OMEGA_M,
  OMEGA_R,
  T_CMB,
} from '../core/constants';

export interface Cosmology {
  name: string;
  /** H0 in km/s/Mpc. */
  H0: number;
  /** Matter density parameter today. */
  Om: number;
  /** Baryon density parameter today. */
  Ob: number;
  /** Dark energy density parameter today. */
  OL: number;
  /** Radiation density parameter today. */
  Or: number;
  /** Scalar spectral index. */
  ns: number;
  /** sigma_8 normalisation. */
  sigma8: number;
  /** CMB temperature today, K. */
  Tcmb: number;
  /** Dark energy equation of state w = p/rho (-1 is a cosmological constant). */
  w: number;
}

export const PLANCK18: Cosmology = {
  name: 'Planck 2018',
  H0: 67.66,
  Om: OMEGA_M,
  Ob: 0.04897,
  OL: OMEGA_LAMBDA,
  Or: OMEGA_R,
  ns: 0.9665,
  sigma8: 0.8102,
  Tcmb: T_CMB,
  w: -1,
};

/** Alternate universes the player can switch to. Each one really is simulated. */
export const PRESET_COSMOLOGIES: Cosmology[] = [
  PLANCK18,
  {
    ...PLANCK18,
    name: 'Einstein-de Sitter',
    Om: 1,
    OL: 0,
    Or: 0,
    sigma8: 0.9,
  },
  {
    ...PLANCK18,
    name: 'Cold and Empty',
    Om: 0.05,
    Ob: 0.05,
    OL: 0.95,
    sigma8: 0.4,
  },
  {
    ...PLANCK18,
    name: 'Clumpy',
    Om: 0.45,
    OL: 0.55,
    sigma8: 1.3,
  },
  {
    ...PLANCK18,
    name: 'Phantom Energy',
    w: -1.35,
  },
];

/** Little h. */
export const h = (c: Cosmology): number => c.H0 / 100;

/** Curvature density parameter, from closure. */
export const Ok = (c: Cosmology): number => 1 - c.Om - c.OL - c.Or;

/** H0 in SI units (1/s). */
export const H0si = (c: Cosmology): number => (c.H0 * 1e3) / MPC;

/**
 * Dimensionless expansion rate E(a) = H(a)/H0.
 * Dark energy scales as a^{-3(1+w)}.
 */
export function E(c: Cosmology, a: number): number {
  const de = c.OL * Math.pow(a, -3 * (1 + c.w));
  return Math.sqrt(c.Or / (a * a * a * a) + c.Om / (a * a * a) + Ok(c) / (a * a) + de);
}

/** Hubble parameter at scale factor a, in 1/s. */
export const Hofa = (c: Cosmology, a: number): number => H0si(c) * E(c, a);

/** Hubble parameter at scale factor a, in km/s/Mpc. */
export const HofaKmsMpc = (c: Cosmology, a: number): number => c.H0 * E(c, a);

export const aFromZ = (z: number): number => 1 / (1 + z);
export const zFromA = (a: number): number => 1 / a - 1;

/** Matter density parameter at scale factor a. */
export function Om_a(c: Cosmology, a: number): number {
  const e = E(c, a);
  return (c.Om / (a * a * a)) / (e * e);
}

/** CMB temperature at scale factor a, K. */
export const Tcmb_a = (c: Cosmology, a: number): number => c.Tcmb / a;

/**
 * Adaptive Simpson integration on [lo, hi].
 * Used everywhere below; cosmological integrands are smooth so this converges fast.
 */
export function integrate(f: (x: number) => number, lo: number, hi: number, n = 2048): number {
  if (hi <= lo) return 0;
  const m = n % 2 === 0 ? n : n + 1;
  const dx = (hi - lo) / m;
  let s = f(lo) + f(hi);
  for (let i = 1; i < m; i++) {
    s += f(lo + i * dx) * (i % 2 === 0 ? 2 : 4);
  }
  return (s * dx) / 3;
}

/**
 * Cosmic time since the Big Bang at scale factor a, in seconds.
 *   t(a) = (1/H0) * Int_0^a da' / (a' E(a'))
 * The integrand goes as a' in radiation domination so the integral converges;
 * we substitute a = u^2 to remove the sqrt-like behaviour near zero.
 */
export function ageAt(c: Cosmology, a: number): number {
  const t0 = 1 / H0si(c);
  const u = Math.sqrt(Math.max(a, 0));
  // da = 2u du  ->  Int 2 du / (u E(u^2))
  const val = integrate((uu) => {
    const aa = uu * uu;
    if (aa <= 0) return 0;
    return 2 / (uu * E(c, aa));
  }, 1e-8, u, 1024);
  return t0 * val;
}

/** Age of the universe today, in Gyr. */
export const ageToday = (c: Cosmology): number => ageAt(c, 1) / GYR;

/** Lookback time from today back to scale factor a, in Gyr. */
export const lookbackTime = (c: Cosmology, a: number): number => (ageAt(c, 1) - ageAt(c, a)) / GYR;

/**
 * Invert t(a) to get the scale factor at a given cosmic time (seconds).
 * Bisection on a monotone function - robust, and only ever called at UI rates.
 */
export function scaleFactorAtTime(c: Cosmology, tSeconds: number): number {
  if (tSeconds <= 0) return 1e-10;
  let lo = 1e-10;
  let hi = 1e4;
  for (let i = 0; i < 90; i++) {
    const mid = Math.sqrt(lo * hi); // geometric bisection: a spans many decades
    if (ageAt(c, mid) < tSeconds) lo = mid;
    else hi = mid;
  }
  return Math.sqrt(lo * hi);
}

/** Comoving distance to redshift z, in metres. */
export function comovingDistance(c: Cosmology, z: number): number {
  const dh = C / H0si(c);
  return dh * integrate((zz) => 1 / E(c, aFromZ(zz)), 0, z, 1024);
}

/** Transverse comoving distance (accounts for curvature), metres. */
export function transverseComovingDistance(c: Cosmology, z: number): number {
  const dc = comovingDistance(c, z);
  const ok = Ok(c);
  if (Math.abs(ok) < 1e-6) return dc;
  const dh = C / H0si(c);
  const x = (Math.sqrt(Math.abs(ok)) * dc) / dh;
  return ok > 0 ? (dh / Math.sqrt(ok)) * Math.sinh(x) : (dh / Math.sqrt(-ok)) * Math.sin(x);
}

/** Angular diameter distance, metres. */
export const angularDiameterDistance = (c: Cosmology, z: number): number =>
  transverseComovingDistance(c, z) / (1 + z);

/** Luminosity distance, metres. */
export const luminosityDistance = (c: Cosmology, z: number): number =>
  transverseComovingDistance(c, z) * (1 + z);

/** Comoving particle horizon at scale factor a (how far light has travelled), metres. */
export function particleHorizon(c: Cosmology, a: number): number {
  const dh = C / H0si(c);
  const u = Math.sqrt(a);
  return dh * integrate((uu) => {
    const aa = uu * uu;
    if (aa <= 0) return 0;
    return 2 / (uu * uu * uu * E(c, aa));
  }, 1e-6, u, 1024);
}

/** Comoving event horizon: the furthest we will *ever* see. Finite when OL > 0. */
export function eventHorizon(c: Cosmology, a: number): number {
  const dh = C / H0si(c);
  return dh * integrate((x) => {
    const aa = 1 / x;
    return 1 / (aa * E(c, aa));
  }, 1e-6, 1 / a, 2048);
}

/**
 * Linear growth factor of density perturbations, normalised to D(a=1) = 1.
 *
 *   D(a) ∝ E(a) * Int_0^a da' / (a' E(a'))^3
 *
 * This is the exact growing-mode solution for a matter perturbation in a
 * smooth dark-energy background, and it is what turns a primordial Gaussian
 * field into the cosmic web.
 */
export function growthFactorUnnormalised(c: Cosmology, a: number): number {
  const e = E(c, a);
  const val = integrate((uu) => {
    const aa = uu * uu;
    if (aa <= 0) return 0;
    const ee = E(c, aa);
    return 2 / (uu * uu * uu * uu * uu * (ee * ee * ee));
  }, 1e-6, Math.sqrt(a), 1024);
  return 2.5 * c.Om * e * val;
}

/** Cache the today-normalisation: it is an integral we would otherwise redo constantly. */
const growthNorms = new WeakMap<Cosmology, number>();

export function growthFactor(c: Cosmology, a: number): number {
  let n = growthNorms.get(c);
  if (n === undefined) {
    n = growthFactorUnnormalised(c, 1);
    growthNorms.set(c, n);
  }
  return growthFactorUnnormalised(c, a) / n;
}

/**
 * Logarithmic growth rate f = dlnD/dlna.
 * The Om^0.55 approximation is accurate to <0.5% for LCDM; we use the exact
 * numerical derivative so that exotic w-values behave correctly too.
 */
export function growthRate(c: Cosmology, a: number): number {
  const dl = 1e-3;
  const d1 = growthFactor(c, a * Math.exp(-dl));
  const d2 = growthFactor(c, a * Math.exp(dl));
  return (Math.log(d2) - Math.log(d1)) / (2 * dl);
}

/** Critical density at scale factor a, kg/m^3. */
export function criticalDensity(c: Cosmology, a: number): number {
  const H = Hofa(c, a);
  return (3 * H * H) / (8 * Math.PI * 6.6743e-11);
}

/**
 * Deceleration parameter q = -a''a/a'^2. Negative today: the expansion accelerates.
 */
export function decelerationParameter(c: Cosmology, a: number): number {
  const e2 = E(c, a) ** 2;
  const rad = (2 * c.Or) / (a * a * a * a);
  const mat = c.Om / (a * a * a);
  const de = (1 + 3 * c.w) * c.OL * Math.pow(a, -3 * (1 + c.w));
  return (rad + 0.5 * mat + 0.5 * de) / e2;
}

/** Redshift when dark energy started to dominate matter (equality). */
export function darkEnergyEqualityRedshift(c: Cosmology): number {
  if (c.OL <= 0) return NaN;
  const a = Math.pow(c.Om / c.OL, -1 / (3 * c.w));
  return zFromA(a);
}

/** Matter-radiation equality redshift. */
export const matterRadiationEqualityRedshift = (c: Cosmology): number =>
  c.Or > 0 ? c.Om / c.Or - 1 : Infinity;

export { HUBBLE_TIME, H0_SI };
