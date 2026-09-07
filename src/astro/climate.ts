/**
 * Climate.
 *
 * Until now every planet in this simulation had exactly one temperature. That
 * is the one number about a world that a single number cannot carry: the Earth
 * averages 288 K, and that average is true of nowhere. It is 300 K at the
 * equator and 250 K at the poles, it swings forty degrees between January and
 * July over Siberia and four over the open Pacific, and the difference between
 * those two facts is why one of them has trees.
 *
 * So this solves the actual equation. A one-dimensional diffusive energy
 * balance model - Budyko and Sellers in 1969, put on a proper footing by North
 * in 1975 - integrated through the seasons:
 *
 *     C(x) dT/dt = S(x,t) [1 - a(T)] - OLR(T) + d/dx [ D (1-x^2) dT/dx ]
 *                  ~~~~~~~~~~~~~~~~~   ~~~~~~~   ~~~~~~~~~~~~~~~~~~~~~~
 *                   what arrives        what      what the winds and
 *                                       leaves    currents carry away
 *
 * with x = sin(latitude), so every band has the same area and a global mean is
 * an unweighted one. Four things are worth saying about it.
 *
 * **It is not a fit.** The insolation comes from Kepler and spherical
 * trigonometry, the outgoing radiation from a grey atmosphere with a
 * Clausius-Clapeyron water column, the heat capacity from the depth of an ocean
 * mixed layer against the mass of an air column, and the transport coefficient
 * from the published scaling in rotation rate, pressure and molecular weight.
 * Given Earth's numbers it returns Earth's climate. Nothing in it was aimed at
 * that.
 *
 * **The ice-albedo feedback makes it nonlinear, and nonlinear means multiple
 * answers.** The same planet under the same star has more than one stable
 * climate: a temperate one and a frozen one. Which you get depends on where you
 * start. Dim the star gradually and a temperate world will cool, and cool, and
 * then at a threshold collapse to a snowball in a single step; brighten it back
 * and it stays frozen long past the point where it froze. That hysteresis is
 * not coded anywhere in this file. It is what the equation does, and it is what
 * the Earth did, twice, in the Cryogenian.
 *
 * **The seasonal cycle is a fluid-dynamical measurement of the ocean.** Land
 * has the heat capacity of the air above it; the sea has fifty metres of water.
 * The model gives continental interiors a seasonal swing three times a
 * maritime one, which is the difference between Winnipeg and Vancouver, and it
 * gives a waterworld almost none at all.
 *
 * **A tidally locked world is the same equation with a different coordinate.**
 * Replace latitude with the angle from the substellar point and there are no
 * seasons, no day and no night - only a fixed hot spot, a terminator ring, and
 * a permanent dark side that will freeze the atmosphere out of the sky if the
 * winds cannot get heat there fast enough. That last condition has a threshold
 * in pressure, and it decides whether the most common kind of planet around the
 * most common kind of star can hold on to its air.
 */

import { DEG, R_EARTH, SIGMA_SB } from '../core/constants';
import {
  albedoAt, equilibriumSurfaceTemperature, liquidWaterPossible, opticalDepth,
  outgoingLongwave, planetaryAlbedo, radiativeDamping, scaleHeight,
  T_FREEZE, T_CRITICAL_WATER, RUNAWAY_GREENHOUSE_LIMIT,
  type AlbedoModel, type Atmosphere,
} from './radiation';
import {
  circulation, itczLatitude, precipitation, type Circulation,
} from './circulation';
import {
  dailyInsolation, globalMeanInsolation, lockedInsolation,
  longitudeAt, type OrbitGeometry,
} from './insolation';

// ---------------------------------------------------------------------------
// Inputs and outputs
// ---------------------------------------------------------------------------

export interface ClimateInputs {
  /** Irradiance at the orbit's semi-major axis, W/m^2. */
  irradiance: number;
  /** Orbital period, s. */
  periodS: number;
  /** Sidereal rotation period, s. Sign ignored. */
  dayS: number;
  obliquity: number;
  eccentricity: number;
  /** Longitude of periapsis from the vernal equinox, rad. */
  precession: number;
  atmosphere: Atmosphere;
  gravity: number;
  radiusM: number;
  /** Fraction of the surface underlain by a water reservoir, frozen or not. */
  oceanFraction: number;
  /**
   * Planetary Bond albedo of the world with no ice on it - ground, cloud and
   * sky together. The ice the climate grows is added to it from the inside.
   */
  albedo: number;
  tidallyLocked: boolean;
  /** Effective temperature of the star, for the Rayleigh term. */
  starTeff?: number;
  /**
   * Where to start the integration, K. Left out, it starts from the warm
   * branch - a planet cools into its climate from a molten one, so that is the
   * branch a real world reaches first. Set it low to find the frozen branch,
   * which is how the hysteresis is traced.
   */
  initialK?: number;
  /** Latitude bands. Odd, so one of them straddles the equator. */
  bands?: number;
  /** Samples per orbit. */
  seasons?: number;
}

export interface ClimateBand {
  /** Band centre. Latitude for a free rotator, angle from the substellar point for a locked one. */
  lat: number;
  /** Annual mean temperature, K. */
  meanK: number;
  maxK: number;
  minK: number;
  /** Annual mean insolation, W/m^2. */
  insolation: number;
  /** Fraction of the year with liquid water possible at the surface. */
  liquidFraction: number;
  /** Fraction of the year below freezing. */
  frozenFraction: number;
  /** Relative precipitation, global mean 1. */
  precipitation: number;
}

export type ClimateState =
  | 'temperate'    // liquid water over a decent share of the surface
  | 'snowball'     // frozen pole to pole; the other stable branch
  | 'frozen'       // too far out for liquid water at any latitude
  | 'runaway'      // absorbing more than a wet atmosphere can radiate
  | 'hot'          // no water to run away with, and hot anyway
  | 'airless'      // no atmosphere to move heat: local radiative equilibrium
  | 'giant';       // no surface for any of this to be about

export interface Climate {
  bands: ClimateBand[];
  /** Global mean surface temperature, K. */
  meanK: number;
  /** Equator-to-pole difference in the annual mean, K. Earth's is 45. */
  gradientK: number;
  /** Mean peak-to-trough seasonal swing over the surface, K. */
  seasonalK: number;
  /** Latitude of the annual-mean ice edge, rad. pi/2 means no permanent ice. */
  iceLineLat: number;
  /** Fraction of the surface below freezing in the annual mean. */
  iceFraction: number;
  /** Fraction of the surface where liquid water is possible at some point in the year. */
  liquidFraction: number;
  /** Fraction of surface-area times time that is habitable. */
  habitability: number;
  state: ClimateState;
  /** Meridional transport coefficient used, W/m^2/K. Earth's is 0.58. */
  diffusion: number;
  /** Planetary albedo actually realised, including ice. */
  albedo: number;
  /**
   * Temperature the planet radiates at, K - what an infrared telescope
   * measures. For a world with weak heat transport this is *above* the
   * area-weighted mean surface temperature, because emission goes as T^4 and
   * the hot places do most of the radiating.
   */
  effectiveK: number;
  /** Greenhouse warming, K: Earth's 33, Venus's 505. */
  greenhouseK: number;
  circulation: Circulation;
  /** Whether the atmosphere freezes out on the night side of a locked world. */
  atmosphericCollapse: boolean;
  /** Seasonal temperature field, `seasons` rows of `bands` values, K. */
  field: Float32Array;
  seasons: number;
  bandCount: number;
  /** Whether the coordinate is latitude (false) or angle from the substellar point (true). */
  locked: boolean;
  /** Orbits integrated before the answer stopped moving. */
  orbits: number;
}

// ---------------------------------------------------------------------------
// Heat capacity
// ---------------------------------------------------------------------------

/** Specific heat of liquid water, J/kg/K. */
const C_WATER = 4218;
/** Depth of the wind-mixed layer a seasonal cycle actually reaches, m. */
const MIXED_LAYER_M = 50;
/** Depth of ocean that stays in contact with the air once sea ice caps it, m. */
const SEA_ICE_LAYER_M = 2.5;
/** Heat capacity of the ground the seasons reach into, J/m^2/K. */
const C_GROUND = 5.5e6;

/** Heat capacity of the air column itself, J/m^2/K: the mass above times its cp. */
export const airColumnCapacity = (atm: Atmosphere, gravity: number): number =>
  (atm.cp * atm.pressureBar * 1e5) / Math.max(gravity, 1e-6);

/**
 * Effective heat capacity of a band, J/m^2/K.
 *
 * The single most important number for the shape of the seasonal cycle, and it
 * differs by a factor of twenty between sea and land. Freezing the sea over
 * removes almost all of it, which is why the Arctic swings so much harder than
 * the Southern Ocean.
 */
export function bandCapacity(
  atm: Atmosphere, gravity: number, oceanFraction: number, frozen: boolean,
): number {
  const air = airColumnCapacity(atm, gravity);
  const depth = frozen ? SEA_ICE_LAYER_M : MIXED_LAYER_M;
  const sea = 1000 * C_WATER * depth;
  return air + oceanFraction * sea + (1 - oceanFraction) * C_GROUND;
}

/**
 * Meridional heat transport coefficient, W/m^2/K.
 *
 * Williams and Kasting (1997), calibrated to Earth's 0.58: transport scales
 * with the mass of the atmosphere doing the carrying, with its heat capacity
 * per unit mass, inversely with the square of the molecular weight, and
 * inversely with the square of the rotation rate - because a faster-spinning
 * planet has a smaller Rossby radius and its eddies carry heat a shorter way.
 *
 * The rotation term is the interesting one. It is why Venus, turning once in
 * 243 days, is within a few kelvin of the same temperature everywhere on its
 * surface including the poles, and why Jupiter's belts do not smear into each
 * other.
 */
export function transportCoefficient(atm: Atmosphere, dayS: number): number {
  const OMEGA_EARTH = 7.292115e-5;
  const omega = (2 * Math.PI) / Math.max(Math.abs(dayS), 1);
  const d = 0.58
    * (atm.pressureBar / 1.0)
    * (atm.cp / 1004)
    * (28.97 / Math.max(atm.molarMass, 1)) ** 2
    * (OMEGA_EARTH / Math.max(omega, 1e-12)) ** 2;
  return Math.max(1e-5, Math.min(300, d));
}

// ---------------------------------------------------------------------------
// The zero-dimensional balance, for when the full model is more than is needed
// ---------------------------------------------------------------------------

export interface GlobalBalance {
  tempK: number;
  albedo: number;
  /** True when the absorbed flux exceeds what a wet atmosphere can radiate. */
  runaway: boolean;
  frozen: boolean;
  /** How many stable states this planet has under this star. Two is the interesting case. */
  equilibria: number;
}

/**
 * Global-mean surface temperature, solved together with the albedo.
 *
 * Absorbed flux depends on how much ice there is; how much ice there is depends
 * on the temperature. So this is not a formula, it is a root find - and because
 * the ice-albedo feedback is strong, the function being rooted can cross zero
 * three times. Two of those crossings are stable climates and the middle one is
 * the tipping point between them.
 *
 * Newton's method is no good here: it converges to whichever root it happens to
 * fall into, and from a hot start it will step straight past the temperate
 * solution and land on the snowball. So the whole curve is scanned instead, the
 * roots are counted, and the *warmest* is returned - which is the branch a
 * planet cooling out of its formation actually settles on, and the one it keeps
 * until something knocks it off.
 */
export function globalBalance(
  irradiance: number, e: number, albedo: AlbedoModel, atm: Atmosphere, startK = 0,
): GlobalBalance {
  // Already the global mean over the whole sphere: S / (4 sqrt(1 - e^2)).
  const S = globalMeanInsolation(irradiance, e);
  const absorbedAt = (T: number): number => S * (1 - albedoAt(T, albedo));
  // Positive means the planet is gaining heat and will warm.
  const net = (T: number): number => absorbedAt(T) - outgoingLongwave(T, atm);

  if (atm.water && absorbedAt(1e4) > RUNAWAY_GREENHOUSE_LIMIT) {
    return {
      tempK: T_CRITICAL_WATER + 100, albedo: albedo.warm,
      runaway: true, frozen: false, equilibria: 0,
    };
  }

  // Bracket the answer from the physics rather than from a fixed ceiling. No
  // equilibrium can be colder than a bare rock under the brightest albedo, nor
  // hotter than the same rock under the thickest blanket the air can manage -
  // so the search only ever has to cover the decade or so between those, which
  // is what makes a fine scan affordable.
  const aMin = Math.min(albedo.warm, albedo.ice);
  const aMax = Math.max(albedo.warm, albedo.ice);
  const bare = Math.pow(Math.max(S * (1 - aMax), 1e-12) / SIGMA_SB, 0.25);
  const blanket = Math.pow(
    (Math.max(S * (1 - aMin), 1e-12) / SIGMA_SB) * (1 + 0.75 * opticalDepth(1200, atm)), 0.25);
  const floorK = Math.max(2.5, bare * 0.5);
  let top = Math.max(startK, blanket * 1.3, floorK * 1.2);
  // A grey model can always be surprised; expand until the planet really is
  // losing heat at the top of the range.
  for (let i = 0; i < 24 && net(top) > 0; i++) top *= 1.8;

  // Scan down. A crossing from cooling to warming, going down, is a stable
  // equilibrium: warmer than it the planet cools, colder than it the planet
  // warms.
  const steps = 220;
  let stable = 0;
  let warmest: number | null = null;
  let prevT = top, prevN = net(top);
  for (let i = 1; i <= steps; i++) {
    const T = top * Math.pow(floorK / top, i / steps);
    const n = net(T);
    if (prevN <= 0 && n > 0) {
      stable++;
      if (warmest === null) {
        let lo = T, hi = prevT;
        for (let j = 0; j < 60; j++) {
          const mid = 0.5 * (lo + hi);
          if (net(mid) > 0) lo = mid; else hi = mid;
        }
        warmest = 0.5 * (lo + hi);
      }
    }
    prevT = T; prevN = n;
  }
  const T = warmest ?? floorK;
  return {
    tempK: T, albedo: albedoAt(T, albedo), runaway: false,
    frozen: T < T_FREEZE, equilibria: stable,
  };
}

// ---------------------------------------------------------------------------
// The seasonal model
// ---------------------------------------------------------------------------

/** Tridiagonal solve (Thomas algorithm), in place on scratch buffers. */
function tridiagonal(
  a: Float64Array, b: Float64Array, c: Float64Array, d: Float64Array,
  out: Float64Array, cp: Float64Array, dp: Float64Array,
): void {
  const n = out.length;
  cp[0] = c[0] / b[0];
  dp[0] = d[0] / b[0];
  for (let i = 1; i < n; i++) {
    const m = b[i] - a[i] * cp[i - 1];
    cp[i] = c[i] / m;
    dp[i] = (d[i] - a[i] * dp[i - 1]) / m;
  }
  out[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i--) out[i] = dp[i] - cp[i] * out[i + 1];
}

/**
 * Run the model.
 *
 * Backward Euler on the diffusion so the step is not limited by stability, with
 * the outgoing radiation linearised about the previous step - which is what
 * makes each step a single tridiagonal solve rather than an iteration - and the
 * albedo taken explicitly, which is what lets the ice-albedo feedback find
 * whichever branch the initial condition belongs to instead of being told.
 */
export function solveClimate(inp: ClimateInputs): Climate {
  const nb = inp.bands ?? 41;
  const ns = inp.seasons ?? 32;
  const atm = inp.atmosphere;
  const locked = inp.tidallyLocked;

  const orb: OrbitGeometry = {
    obliquity: inp.obliquity, e: inp.eccentricity, precession: inp.precession,
  };

  // The input is already a planetary Bond albedo - ground, cloud and sky
  // together - for the world with no ice on it. Adding the sky's own
  // scattering again here would count it twice; that combination is done where
  // the pressure is the unknown, in the carbon cycle below.
  const warmAlbedo = Math.min(0.92, Math.max(inp.albedo, 0));
  // How much of the surface has water available to freeze. A bare rock does
  // not whiten when it cools, so it has no ice-albedo feedback and no snowball
  // branch - the bistability is a property of worlds with oceans.
  const waterAvail = Math.min(1, Math.max(inp.oceanFraction, 0) * 4);
  const albedoModel: AlbedoModel = {
    warm: warmAlbedo,
    ice: warmAlbedo + (Math.max(0.62, warmAlbedo) - warmAlbedo) * waterAvail,
    width: 8,
  };

  // Band centres, equally spaced in x so every band has the same area. For a
  // locked world x is the cosine of the angle from the substellar point, which
  // is equal-area for exactly the same reason.
  const dx = 2 / nb;
  const x = new Float64Array(nb);
  const lat = new Float64Array(nb);
  for (let i = 0; i < nb; i++) {
    x[i] = -1 + dx * (i + 0.5);
    lat[i] = locked ? Math.acos(-x[i]) : Math.asin(x[i]);
  }

  const D = transportCoefficient(atm, locked ? inp.periodS : inp.dayS);

  // Where to start. The warm branch unless told otherwise.
  const start0 = globalBalance(inp.irradiance, inp.eccentricity, albedoModel, atm);
  const T0 = inp.initialK ?? (start0.runaway ? 900 : start0.tempK);

  const T = new Float64Array(nb).fill(T0);
  const Tn = new Float64Array(nb);
  const S = new Float64Array(nb);
  const a = new Float64Array(nb);
  const b = new Float64Array(nb);
  const c = new Float64Array(nb);
  const rhs = new Float64Array(nb);
  const cp = new Float64Array(nb);
  const dp = new Float64Array(nb);

  const field = new Float32Array(ns * nb);
  const insol = new Float64Array(nb);

  const period = Math.max(inp.periodS, 1);
  const dt = period / ns;
  // How many orbits to run: enough for the slowest thing in the system - the
  // ocean - to come into balance, and at least a few for the seasons to settle.
  const cRef = bandCapacity(atm, inp.gravity, inp.oceanFraction, false);
  const relax = cRef / Math.max(radiativeDamping(Math.max(T0, 100), atm), 0.05);
  const maxOrbits = Math.max(6, Math.min(80, Math.ceil((6 * relax) / period)));

  let runaway = start0.runaway;
  const k = D / (dx * dx);
  const tFrost = atm.pressureBar > 1e-6 ? condensationTemperature(atm) : 0;

  /** One step of length dt, at time `t` into the orbit. */
  const step = (t: number, record: boolean, s: number): void => {
    // --- What arrives.
    if (locked) {
      for (let i = 0; i < nb; i++) S[i] = lockedInsolation(inp.irradiance, lat[i]);
    } else {
      const lambda = longitudeAt(t, period, orb);
      for (let i = 0; i < nb; i++) S[i] = dailyInsolation(inp.irradiance, lat[i], lambda, orb);
    }

    // --- Assemble the tridiagonal system.
    for (let i = 0; i < nb; i++) {
      const frozen = T[i] < T_FREEZE;
      const C = bandCapacity(atm, inp.gravity, inp.oceanFraction, frozen);
      const B = Math.max(radiativeDamping(T[i], atm), 0.02);
      // Low sun angles reflect more: the classic P2 term of the North model.
      const p2 = 0.5 * (3 * x[i] * x[i] - 1);
      const alb = Math.min(0.95, albedoAt(T[i], albedoModel) + (locked ? 0 : 0.06 * p2));
      // The (1 - x^2) factor vanishes at the poles, so no heat leaves through
      // them and the boundary condition needs no special case: it is geometry.
      const wMinus = i > 0 ? 1 - ((x[i] + x[i - 1]) * 0.5) ** 2 : 0;
      const wPlus = i < nb - 1 ? 1 - ((x[i] + x[i + 1]) * 0.5) ** 2 : 0;

      a[i] = -k * wMinus;
      c[i] = -k * wPlus;
      b[i] = C / dt + B + k * (wMinus + wPlus);
      rhs[i] = (C / dt) * T[i] + S[i] * (1 - alb) - outgoingLongwave(T[i], atm) + B * T[i];
      if (record) insol[i] += S[i] / ns;
    }
    tridiagonal(a, b, c, rhs, Tn, cp, dp);

    for (let i = 0; i < nb; i++) {
      let v = Tn[i];
      if (!Number.isFinite(v)) v = T[i];
      // A world with no equilibrium runs away; it does not run away to
      // infinity, because the water eventually leaves and the model with it.
      if (v > 1600) { v = 1600; runaway = runaway || atm.water; }
      // The air cannot get colder than its own frost point. Below it the
      // atmosphere condenses onto the ground, and the latent heat released
      // holds the temperature there until it has all fallen out. Mars does
      // this every winter: a quarter of its air snows onto the winter pole as
      // dry ice, and the planet's surface pressure rises and falls by that
      // much over the year.
      T[i] = Math.max(2.7, Math.max(v, tFrost));
      if (record) field[s * nb + i] = T[i];
    }
  };

  let orbits = 0;
  let lastMean = Infinity;
  for (let orbit = 0; orbit < maxOrbits; orbit++) {
    orbits = orbit + 1;
    for (let s = 0; s < ns; s++) step((s + 0.5) * dt, false, s);

    let mean = 0;
    for (let i = 0; i < nb; i++) mean += T[i];
    mean /= nb;
    if (orbit >= 4 && Math.abs(mean - lastMean) < 0.01) break;
    lastMean = mean;
  }
  // One final orbit with the answer settled, to record the seasonal cycle and
  // the insolation that produced it.
  for (let s = 0; s < ns; s++) step((s + 0.5) * dt, true, s);

  const out = summarise(inp, field, insol, lat, ns, nb, D, albedoModel, runaway, locked);
  out.orbits = orbits;
  return out;
}

function summarise(
  inp: ClimateInputs, field: Float32Array, insol: Float64Array, lat: Float64Array,
  ns: number, nb: number, D: number, albedoModel: AlbedoModel, runaway: boolean, locked: boolean,
): Climate {
  const atm = inp.atmosphere;
  const bands: ClimateBand[] = [];
  let mean = 0, seasonal = 0, ice = 0, liquid = 0, habitable = 0, albedoSum = 0;

  for (let i = 0; i < nb; i++) {
    let m = 0, hi = -Infinity, lo = Infinity, liq = 0, froz = 0;
    for (let s = 0; s < ns; s++) {
      const t = field[s * nb + i];
      m += t;
      if (t > hi) hi = t;
      if (t < lo) lo = t;
      if (liquidWaterPossible(t, atm.pressureBar)) liq++;
      if (t < T_FREEZE) froz++;
    }
    m /= ns;
    mean += m;
    seasonal += hi - lo;
    liq /= ns; froz /= ns;
    if (froz > 0.5) ice++;
    if (liq > 0) liquid++;
    habitable += liq;
    albedoSum += albedoAt(m, albedoModel);
    bands.push({
      lat: lat[i], meanK: m, maxK: hi, minK: lo,
      insolation: insol[i], liquidFraction: liq, frozenFraction: froz,
      precipitation: 1,
    });
  }
  mean /= nb; seasonal /= nb;
  // Cold is not the same as icy: Mercury's night side is 100 K and there is no
  // ice on it, because there is no water.
  const iceFraction = inp.oceanFraction > 0.005 ? ice / nb : 0;
  const liquidFraction = liquid / nb;
  // Water has to exist before it can be liquid: a bone-dry world in the
  // habitable zone is still bone dry.
  const water = Math.min(1, inp.oceanFraction * 3);
  habitable = (habitable / nb) * water;

  // Equator to pole, in the annual mean. For a locked world it is substellar
  // to antistellar, which is the same measurement asked of a different axis:
  // there, band 0 is the point under the star and band n-1 the point that has
  // never seen it.
  const eq = bands[Math.floor(nb / 2)].meanK;
  const pole = 0.5 * (bands[0].meanK + bands[nb - 1].meanK);
  const gradient = locked ? bands[0].meanK - bands[nb - 1].meanK : eq - pole;

  // The ice edge: the latitude the permanent ice reaches down to, which is the
  // poleward-most band that still thaws. A world with no ice has none, and a
  // world frozen from pole to pole has it at the equator.
  let iceLine = 0;
  for (let i = 0; i < nb; i++) {
    if (bands[i].frozenFraction <= 0.5) iceLine = Math.max(iceLine, Math.abs(lat[i]));
  }
  if (inp.oceanFraction <= 0.005) iceLine = locked ? Math.PI : Math.PI / 2;
  if (iceFraction <= 1e-9) iceLine = locked ? Math.PI : Math.PI / 2;
  else if (iceFraction >= 0.999) iceLine = 0;

  const circ = circulation({
    dayS: locked ? inp.periodS : inp.dayS,
    radiusM: inp.radiusM,
    gravity: inp.gravity,
    pressureBar: atm.pressureBar,
    gradientK: Math.abs(gradient),
    meanK: mean,
    scaleHeightM: scaleHeight(mean, inp.gravity, atm.molarMass),
  });
  const itcz = itczLatitude(0, circ.hadleyEdge);
  let pSum = 0;
  for (const bnd of bands) { bnd.precipitation = precipitation(bnd.lat, circ, itcz); pSum += bnd.precipitation; }
  const pMean = pSum / nb || 1;
  for (const bnd of bands) bnd.precipitation /= pMean;

  // Atmospheric collapse: on a locked world, if the coldest place is below the
  // condensation point of the air itself, the atmosphere snows out there and
  // keeps snowing until the pressure is gone.
  const coldest = Math.min(...bands.map((bnd) => bnd.minK));
  const condense = condensationTemperature(atm);
  const collapse = locked && atm.pressureBar > 0 && coldest < condense;

  // The emission temperature, from the flux the planet actually absorbs.
  const emission = Math.pow(
    Math.max(inp.irradiance * (1 - albedoSum / nb) / 4, 1e-9) / SIGMA_SB, 0.25);
  // The greenhouse is a property of the air, not of the map: it is the gap
  // between the surface and the emission temperature *at the global mean
  // flux*, which is the definition under which Earth's is 33 K. Differencing
  // the area-weighted mean instead would fold in the concavity of T^4 and
  // report a negative greenhouse for Mars, which has a positive one.
  const balanced = equilibriumSurfaceTemperature(
    (inp.irradiance / 4) * (1 - albedoSum / nb), atm);
  const greenhouse = balanced === null ? Infinity : balanced - emission;

  let state: ClimateState;
  if (atm.pressureBar < 1e-4) state = 'airless';
  else if (runaway) state = 'runaway';
  else if (iceFraction > 0.97) state = liquidFraction > 0 ? 'snowball' : 'frozen';
  else if (mean > T_CRITICAL_WATER) state = 'hot';
  else state = 'temperate';

  return {
    bands, meanK: mean, gradientK: gradient, seasonalK: seasonal,
    iceLineLat: iceLine, iceFraction, liquidFraction, habitability: habitable,
    state, diffusion: D, albedo: albedoSum / nb,
    effectiveK: emission, greenhouseK: greenhouse,
    circulation: circ, atmosphericCollapse: collapse,
    field, seasons: ns, bandCount: nb, locked, orbits: 0,
  };
}

/**
 * Temperature at which the atmosphere's own main constituent condenses out at
 * its surface pressure, K. CO2 frosts at 195 K at one bar; nitrogen at 77.
 */
export function condensationTemperature(atm: Atmosphere): number {
  const p = Math.max(atm.pressureBar, 1e-9);
  // Clausius-Clapeyron anchored on the one-bar boiling point of the dominant
  // species, guessed from the molecular weight: CO2 at 44, N2 at 28, H2 at 2.
  const mu = atm.molarMass;
  const [tRef, lOverR] = mu > 38 ? [194.7, 3100] : mu > 20 ? [77.4, 700] : [20.3, 110];
  return tRef / Math.max(1 - (Math.log(p) * tRef) / lOverR, 0.1);
}

/**
 * Sample the seasonal field. `latitude` in radians (or angle from the
 * substellar point on a locked world), `phase` a fraction of the orbit. Both
 * are interpolated, so the shader can ask for any point on the surface at any
 * time of year and get a continuous answer.
 */
export function sampleClimate(cl: Climate, latitude: number, phase: number): number {
  const nb = cl.bandCount, ns = cl.seasons;
  const x = cl.locked ? -Math.cos(latitude) : Math.sin(latitude);
  const fi = Math.min(nb - 1, Math.max(0, ((x + 1) / 2) * nb - 0.5));
  const i0 = Math.floor(fi), i1 = Math.min(nb - 1, i0 + 1), fx = fi - i0;
  const fs = (((phase % 1) + 1) % 1) * ns - 0.5;
  const s0 = ((Math.floor(fs) % ns) + ns) % ns, s1 = (s0 + 1) % ns;
  const fy = fs - Math.floor(fs);
  const t00 = cl.field[s0 * nb + i0], t01 = cl.field[s0 * nb + i1];
  const t10 = cl.field[s1 * nb + i0], t11 = cl.field[s1 * nb + i1];
  return (t00 * (1 - fx) + t01 * fx) * (1 - fy) + (t10 * (1 - fx) + t11 * fx) * fy;
}

/**
 * Latitude of the ice edge in one hemisphere at a point in the year, radians
 * from the equator. This is the number the surface shader needs: caps that
 * advance through the winter and retreat through the summer, at the latitude
 * the energy budget puts them.
 */
export function seasonalIceEdge(cl: Climate, phase: number, north: boolean): number {
  const nb = cl.bandCount, ns = cl.seasons;
  const s = Math.min(ns - 1, Math.max(0, Math.floor((((phase % 1) + 1) % 1) * ns)));
  let edge = Math.PI / 2;
  for (let i = 0; i < nb; i++) {
    const idx = north ? nb - 1 - i : i;
    const l = cl.locked ? cl.bands[idx].lat : Math.abs(cl.bands[idx].lat);
    if (cl.field[s * nb + idx] >= T_FREEZE) { edge = l; break; }
  }
  return edge;
}

/**
 * The obliquity below which a world can hold permanent polar caps, and above
 * which the poles get enough summer sun to melt out every year. Earth's 23.4
 * degrees is comfortably below it; at about 54 degrees the poles receive more
 * annual sunlight than the equator and the ice, if there is any, is tropical.
 */
export const CAP_OBLIQUITY_LIMIT = 54 * DEG;

export { T_FREEZE, R_EARTH };

// ---------------------------------------------------------------------------
// The thermostat
// ---------------------------------------------------------------------------

export interface CarbonCycle {
  /** Partial pressure of CO2 left in the air, bar. */
  co2Bar: number;
  /** Total surface pressure once the CO2 is added, bar. */
  pressureBar: number;
  /** Mole fraction of CO2. */
  fraction: number;
  /** Mean surface temperature the cycle settles at, K. */
  tempK: number;
  /**
   * Planetary Bond albedo the world actually ends up with - ground, sky and
   * whatever ice the temperature grew. Reporting it matters: work the emission
   * temperature out from the ice-free albedo instead and a frozen world comes
   * back with a negative greenhouse, which no atmosphere has.
   */
  albedo: number;
  /** Whether the thermostat has run out of room. */
  limit: 'regulated' | 'maximum-greenhouse' | 'runaway' | 'no-cycle';
}

/**
 * The carbonate-silicate cycle: why the Earth is still here.
 *
 * Carbon dioxide dissolves in rain, the rain weathers silicate rock, the
 * products wash into the sea and are buried as carbonate, and volcanoes put the
 * carbon back. The rate of the weathering step rises steeply with temperature
 * and with rainfall - so when a planet warms, it scrubs its own air faster, and
 * when it cools, the volcanoes win and the carbon dioxide builds back up.
 *
 * It is a negative feedback with a gain of a few hundred, and a response time
 * of half a million years, and it is the reason the Sun could brighten by
 * thirty per cent over the Earth's lifetime without either boiling the oceans
 * at the end or leaving them frozen at the start.
 *
 * It also draws the habitable zone. Not as a temperature range - as the range
 * of distances over which the thermostat has any authority:
 *
 *  - Too close, and even a scrubbed-bare atmosphere absorbs more than a wet one
 *    can radiate. The oceans boil, the weathering stops with them, and every
 *    tonne of carbon that would have been buried stays in the sky. That is the
 *    inner edge, and it is Venus.
 *  - Too far, and even a planet that has put its entire carbon inventory into
 *    the air cannot stay above freezing - because past a few bars, adding CO2
 *    makes the sky brighter faster than it makes the ground warmer. That is the
 *    outer edge, and it is Mars.
 *
 * Both edges come out of running this function, not out of a table.
 */
export function carbonCycle(
  irradiance: number, e: number, base: Atmosphere, surfaceAlbedo: number,
  oceanFraction: number, maxCo2Bar: number, starTeff = 5772, targetK = 288,
): CarbonCycle {
  const at = (co2: number): { atm: Atmosphere; balance: GlobalBalance } => {
    const p = base.pressureBar + co2;
    const atm: Atmosphere = {
      ...base,
      pressureBar: p,
      // CO2 is heavier than air and holds less heat per kilogram; a thick
      // CO2 atmosphere is therefore both a better blanket and a worse mixer.
      greenhouseFraction: p > 0 ? Math.min(1, co2 / p) : 0,
      molarMass: p > 0 ? (base.molarMass * base.pressureBar + 44.01 * co2) / p : base.molarMass,
      cp: p > 0 ? (base.cp * base.pressureBar + 846 * co2) / p : base.cp,
    };
    const warm = Math.min(0.92, planetaryAlbedo(surfaceAlbedo, p, starTeff));
    const water = Math.min(1, Math.max(oceanFraction, 0) * 4);
    const model: AlbedoModel = {
      warm, ice: warm + (Math.max(0.62, warm) - warm) * water, width: 8,
    };
    return { atm, balance: globalBalance(irradiance, e, model, atm) };
  };

  // Without liquid water there is no weathering, so nothing regulates: every
  // gram of carbon the planet ever outgassed is in the sky.
  if (oceanFraction < 0.01) {
    const r = at(maxCo2Bar);
    return {
      co2Bar: maxCo2Bar, pressureBar: r.atm.pressureBar,
      fraction: r.atm.greenhouseFraction, tempK: r.balance.tempK,
      albedo: r.balance.albedo, limit: 'no-cycle',
    };
  }

  // Scrubbed as clean as weathering can manage. If it still runs away, the
  // thermostat has no authority: this is inside the inner edge.
  const floor = 1e-7;
  const bare = at(floor);
  if (bare.balance.runaway || bare.balance.tempK > targetK + 60) {
    return {
      co2Bar: floor, pressureBar: bare.atm.pressureBar, fraction: bare.atm.greenhouseFraction,
      tempK: bare.balance.tempK, albedo: bare.balance.albedo,
      limit: bare.balance.runaway ? 'runaway' : 'regulated',
    };
  }

  // Every gram of carbon in the air. If it is still frozen, this is outside
  // the outer edge - the maximum greenhouse.
  const full = at(maxCo2Bar);
  if (full.balance.tempK < targetK) {
    return {
      co2Bar: maxCo2Bar, pressureBar: full.atm.pressureBar, fraction: full.atm.greenhouseFraction,
      tempK: full.balance.tempK, albedo: full.balance.albedo,
      limit: full.balance.tempK < T_FREEZE ? 'maximum-greenhouse' : 'regulated',
    };
  }

  // Somewhere in between the thermostat holds. Bisect in log pressure, because
  // the greenhouse is logarithmic in CO2 and a linear search would spend all
  // its steps in the wrong decade.
  let lo = Math.log(floor), hi = Math.log(maxCo2Bar);
  for (let i = 0; i < 30; i++) {
    const mid = 0.5 * (lo + hi);
    if (at(Math.exp(mid)).balance.tempK < targetK) lo = mid; else hi = mid;
  }
  const co2 = Math.exp(0.5 * (lo + hi));
  const r = at(co2);
  return {
    co2Bar: co2, pressureBar: r.atm.pressureBar, fraction: r.atm.greenhouseFraction,
    tempK: r.balance.tempK, albedo: r.balance.albedo, limit: 'regulated',
  };
}


/**
 * The temperature the carbonate-silicate cycle actually settles at.
 *
 * Not 288 K. 288 K is where *Earth's* thermostat sits, and it sits there
 * because Earth's volcanoes put out carbon at the rate Earth's rain takes it
 * back out - no faster and no slower.
 *
 * Silicate weathering runs about twice as fast for every ten degrees of
 * warming (Walker, Hays and Kasting 1981 put the e-folding at 13.7 K), so a
 * world whose volcanoes are twice as busy has to run 9.5 K hotter before its
 * rain can keep up. The setpoint therefore moves with the ratio of supply to
 * demand:
 *
 *     T_set = 288 K + 13.7 K * ln( outgassing / weathering capacity )
 *
 * Two things move it. A young or massive planet has a hotter interior and
 * outgasses harder, so it settles warmer. And weathering needs *rock* - a world
 * with no land has almost nothing for the rain to dissolve, so its thermostat
 * is a weak one, set high. A waterworld is not a safer Earth; it is a hotter
 * one with a broken regulator.
 */
export function thermostatSetpoint(outgassingRelative: number, landFraction: number): number {
  const capacity = Math.max(landFraction, 0.02) / 0.29;
  const ratio = Math.max(outgassingRelative, 1e-3) / capacity;
  return Math.max(255, Math.min(340, 288 + 13.7 * Math.log(ratio)));
}

/**
 * Volcanic outgassing relative to Earth's.
 *
 * The heat that drives it comes from radioactive decay and from the leftover
 * heat of formation, so it falls as a planet ages and rises with how much
 * mantle there is to hold it. A world too small to stay hot inside has no
 * volcanoes, no resupply, and no thermostat - which is most of the story of
 * why Mars is the way it is.
 */
export function outgassingRate(massEarths: number, ageGyr: number): number {
  // Mantle volume goes as the mass; the surface it has to escape through goes
  // as the two-thirds power of it, so the flux per unit area rises with size.
  const size = Math.pow(Math.max(massEarths, 1e-3), 0.5);
  // Radiogenic heating decays with a few-billion-year effective half life.
  const age = Math.exp(-(Math.max(ageGyr, 0) - 4.5) / 6.0);
  // Below about a tenth of an Earth mass a rocky planet freezes through and
  // the volcanoes stop.
  const alive = 1 / (1 + Math.pow(0.12 / Math.max(massEarths, 1e-3), 3));
  return size * age * alive;
}
