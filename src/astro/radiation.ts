/**
 * What a planet does with the light once it has it.
 *
 * Two functions decide a world's temperature: how much starlight it absorbs,
 * and how much thermal radiation it can get out through its own air. This file
 * is the second one, and it is where the interesting physics lives, because the
 * relationship is not monotone and the place where it stops being monotone is
 * Venus.
 *
 * ---------------------------------------------------------------------------
 * The dry greenhouse
 *
 * A grey atmosphere in radiative equilibrium emits
 *
 *     OLR = sigma Ts^4 / (1 + 3 tau / 4)
 *
 * where tau is the infrared optical depth of the column. That single relation,
 * with an optical depth fitted as a power law in the greenhouse-gas column
 * `x p^2` - the square because pressure broadening widens every line, so a
 * given number of molecules absorbs more when there is more gas above them -
 * spans the Solar System:
 *
 *   | world | p (bar) | tau   | greenhouse | measured |
 *   |-------|---------|-------|------------|----------|
 *   | Mars  | 0.006   | 0.08  | +3 K       | +5 K     |
 *   | Earth | 1.0     | 0.82  | +33 K      | +33 K    |
 *   | Titan | 1.5     | 1.8   | +20 K      | +12 K *  |
 *   | Venus | 92      | 141   | +505 K     | +505 K   |
 *
 * Two parameters were fitted, to Earth and Venus. Mars and Titan are therefore
 * predictions. (* Titan also has an anti-greenhouse: its haze absorbs sunlight
 * a hundred kilometres up, and the surface is about 9 K colder than the
 * greenhouse alone would leave it.)
 *
 * ---------------------------------------------------------------------------
 * The moist greenhouse, and why it has a ceiling
 *
 * Water is different from every other greenhouse gas in one respect: its
 * abundance is not a property of the planet but a function of the temperature.
 * Warm the surface and Clausius-Clapeyron puts more vapour in the air, which
 * warms the surface further. On Earth that feedback roughly halves the rate at
 * which outgoing radiation rises with temperature - the observed 2.1 W/m^2/K
 * against the 3.3 that a transparent atmosphere would give.
 *
 * Push it far enough and the feedback wins outright. Once the air is
 * water-dominated, the level from which the planet radiates sits inside the
 * saturated part of the column, and its temperature stops depending on the
 * ground's. The emission then has a hard ceiling near 282 W/m^2 no matter how
 * hot the surface gets. Simpson noticed the problem in 1927; Nakajima, Hayashi
 * and Abe made it precise in 1992.
 *
 * A planet absorbing more than that ceiling has no equilibrium with an ocean on
 * it. The ocean evaporates - all of it - the surface runs to well over a
 * thousand kelvin, and hydrogen escapes to space until the water is gone and
 * the carbon that would have been locked into carbonate rock is left in the air
 * instead. Nothing in this file is told about Venus. It is what comes out when
 * you ask where the ceiling is.
 */

import { SIGMA_SB } from '../core/constants';

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

/** Latent heat of vaporisation of water, J/kg. */
export const L_VAP = 2.501e6;
/** Latent heat of sublimation, J/kg. */
export const L_SUB = 2.834e6;
/** Specific gas constant of water vapour, J/kg/K. */
export const R_VAPOUR = 461.5;
/** Specific gas constant of dry air, J/kg/K. */
export const R_DRY_AIR = 287.05;
/** Triple point of water, K. */
export const T_FREEZE = 273.15;
/** Critical temperature of water, K: above this there is no liquid at any pressure. */
export const T_CRITICAL_WATER = 647.1;

/**
 * Saturation vapour pressure of water, Pa. Magnus form over liquid above
 * freezing and over ice below it, which matters: ice has the lower vapour
 * pressure, and the difference is what lets ice crystals grow at the expense of
 * supercooled droplets and so makes most of the rain that falls on Earth.
 */
export function saturationVapourPressure(tempK: number): number {
  const t = tempK - T_FREEZE;
  if (tempK >= T_FREEZE) {
    return 611.2 * Math.exp((17.62 * t) / (tempK - 30.03));
  }
  return 611.2 * Math.exp((22.46 * t) / (tempK - 0.53));
}

/**
 * Whether liquid water is thermodynamically possible at this temperature and
 * pressure: warmer than freezing, colder than the critical point, and under
 * enough pressure that it does not simply sublimate. Mars fails the last test
 * over most of its surface - at 6 mbar, ice goes straight to vapour.
 */
export function liquidWaterPossible(tempK: number, pressureBar: number): boolean {
  if (tempK <= T_FREEZE || tempK >= T_CRITICAL_WATER) return false;
  // The triple-point pressure, 611 Pa, is the floor.
  return pressureBar * 1e5 > 611.657 && pressureBar * 1e5 > saturationVapourPressure(tempK) * 0.999;
}

// ---------------------------------------------------------------------------
// Atmosphere
// ---------------------------------------------------------------------------

export interface Atmosphere {
  /** Surface pressure, bar. */
  pressureBar: number;
  /**
   * Mole fraction of the infrared-active, non-condensing component - CO2,
   * methane, whatever the world runs on. Earth's is 4 parts in ten thousand.
   */
  greenhouseFraction: number;
  /** Mean molecular weight, amu. */
  molarMass: number;
  /** Specific heat at constant pressure, J/kg/K. */
  cp: number;
  /** Whether there is a surface water reservoir to feed a moist greenhouse. */
  water: boolean;
  /** Column-mean relative humidity, 0 to 1. Earth's is about 0.7. */
  humidity: number;
}

export const EARTH_AIR: Atmosphere = {
  pressureBar: 1.0,
  greenhouseFraction: 4.2e-4,
  molarMass: 28.97,
  cp: 1004,
  water: true,
  humidity: 0.7,
};

/**
 * Optical depth of the non-condensing column.
 *
 * `tau = k (x p^2)^s`, k = 4.229 and s = 0.390, fitted to Earth's 33 K and
 * Venus's 505 K. The square on pressure is pressure broadening; the exponent
 * below one is band saturation - once the centre of an absorption line is
 * opaque, more gas only widens the wings, so the return on column diminishes.
 */
export function dryOpticalDepth(atm: Atmosphere): number {
  const p = Math.max(atm.pressureBar, 0);
  const column = Math.max(atm.greenhouseFraction, 0) * p * p;
  if (column <= 0) return 0;
  return Math.min(4000, 4.229 * Math.pow(column, 0.390));
}

/**
 * Optical depth added by water vapour at a given surface temperature, for a
 * column at the atmosphere's relative humidity.
 *
 * The exponent, 0.28, is not fitted to a temperature - it is fitted to a
 * *slope*: it is the value that reproduces Earth's observed 2.1 W/m^2/K rise of
 * outgoing radiation with surface temperature. Get that wrong and every
 * feedback in the model is wrong with it.
 */
export function vapourOpticalDepth(tempK: number, atm: Atmosphere): number {
  if (!atm.water || tempK >= T_CRITICAL_WATER) return atm.water ? 40 : 0;
  const pv = atm.humidity * saturationVapourPressure(tempK);
  // Vapour cannot exceed the total pressure; past that the atmosphere *is*
  // steam and the column is set by the ocean it came from.
  const frac = Math.min(pv / 1e5, Math.max(atm.pressureBar, 0.05) * 4);
  if (frac <= 0) return 0;
  return 2.125 * Math.pow(frac, 0.28);
}

/** Total infrared optical depth of the column at a given surface temperature. */
export const opticalDepth = (tempK: number, atm: Atmosphere): number =>
  dryOpticalDepth(atm) + vapourOpticalDepth(tempK, atm);

/**
 * The Simpson-Nakajima limit: the largest thermal flux a water-saturated
 * atmosphere can radiate, W/m^2. Modern line-by-line calculations put it at
 * 282 for an Earth-like column (Goldblatt et al. 2013).
 */
export const RUNAWAY_GREENHOUSE_LIMIT = 282;

/**
 * Outgoing longwave radiation from a surface at Ts, W/m^2.
 *
 * The grey result, softened onto the runaway ceiling where a water reservoir
 * exists. The soft minimum - `x / (1 + (x/L)^n)^(1/n)` with n = 12 - is used
 * rather than a hard `min` because the *derivative* is what the climate solver
 * needs, and a kink in it would put a false equilibrium exactly at the
 * threshold that matters most.
 */
export function outgoingLongwave(tempK: number, atm: Atmosphere): number {
  const tau = opticalDepth(tempK, atm);
  const grey = (SIGMA_SB * Math.pow(Math.max(tempK, 1), 4)) / (1 + 0.75 * tau);
  if (!atm.water) return grey;
  const r = grey / RUNAWAY_GREENHOUSE_LIMIT;
  const n = 12;
  return grey / Math.pow(1 + Math.pow(r, n), 1 / n);
}

/**
 * dOLR/dT, W/m^2/K - the climate feedback parameter, by finite difference.
 *
 * Earth's is about 1.8: a one-degree warming buys back not quite two watts per
 * square metre. A transparent atmosphere would give 5.4, and the difference is
 * the water-vapour feedback eating three-fifths of the planet's ability to cool
 * itself. Near the runaway threshold it goes to zero, which is the runaway.
 */
export function radiativeDamping(tempK: number, atm: Atmosphere): number {
  const h = 0.5;
  return (outgoingLongwave(tempK + h, atm) - outgoingLongwave(tempK, atm)) / h;
}

/**
 * Surface temperature that balances a given absorbed flux, K.
 *
 * Returns `null` when no equilibrium exists - which is precisely the runaway
 * greenhouse: absorb more than the ceiling and there is no surface temperature,
 * however high, at which the books balance while an ocean remains.
 */
export function equilibriumSurfaceTemperature(absorbed: number, atm: Atmosphere): number | null {
  if (absorbed <= 0) return 2.7;
  if (atm.water && absorbed > RUNAWAY_GREENHOUSE_LIMIT) return null;
  let lo = 2, hi = 3000;
  for (let i = 0; i < 90; i++) {
    const mid = 0.5 * (lo + hi);
    if (outgoingLongwave(mid, atm) < absorbed) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * Greenhouse warming: how much hotter the surface is than the temperature the
 * planet radiates at. Earth's is 33 K, Venus's is 505 K, and the ratio between
 * those two numbers is the entire difference between the two worlds.
 */
export function greenhouseWarming(absorbed: number, atm: Atmosphere): number {
  const skin = Math.pow(Math.max(absorbed, 1e-9) / SIGMA_SB, 0.25);
  const ts = equilibriumSurfaceTemperature(absorbed, atm);
  return ts === null ? Infinity : ts - skin;
}

// ---------------------------------------------------------------------------
// Albedo
// ---------------------------------------------------------------------------

export interface AlbedoModel {
  /** Bond albedo of the ice-free surface and its air. */
  warm: number;
  /** Bond albedo once the surface is frozen over. */
  ice: number;
  /** Width of the transition between them, K. */
  width: number;
}

/**
 * Planetary albedo as a function of surface temperature.
 *
 * This is the ice-albedo feedback, and it is the single most destabilising
 * process in planetary climate: cool a world and it whitens, whitening it cools
 * it further. Budyko and Sellers found in 1969 that the feedback is strong
 * enough to give the same planet, under the same sunlight, two stable states -
 * one temperate and one frozen from pole to pole. Earth has been in the second
 * one at least twice.
 */
export function albedoAt(tempK: number, m: AlbedoModel): number {
  const t = Math.tanh((tempK - T_FREEZE + 3) / Math.max(m.width, 0.5));
  return m.ice + (m.warm - m.ice) * 0.5 * (1 + t);
}

/**
 * Rayleigh brightening: a thick atmosphere scatters short wavelengths back to
 * space before they ever reach the ground. It is what stops the outer edge of
 * the habitable zone from extending forever - past a few bars, adding CO2 makes
 * a planet brighter faster than it makes it warmer, and that maximum is where
 * the habitable zone ends.
 */
export function rayleighAlbedo(pressureBar: number, starTeff = 5772): number {
  // Rayleigh scattering goes as lambda^-4, so a cool star's redder light is
  // scattered far less - which is why a planet of an M dwarf can hold a much
  // thicker atmosphere before the sky starts throwing the light back.
  const colour = Math.min(1.6, Math.pow(5772 / Math.max(starTeff, 2000), 1.4));
  // Optical depth per bar, for a CO2-rich column at visible wavelengths.
  const tau = 0.13 * pressureBar * colour;
  // Reflectance of a conservatively scattering slab, tau / (tau + 2), capped
  // because a very deep column is not a perfect mirror: near-infrared
  // absorption by the gas itself competes with the scattering.
  return Math.min(0.75, tau / (tau + 2));
}

/**
 * Bond albedo of a scattering atmosphere over a reflecting ground.
 *
 * Not a sum and not a maximum: light the sky sends back never reaches the
 * ground, light the ground sends up is partly scattered back down again, and
 * the series of those reflections closes to
 *
 *     A = A_sky + (1 - A_sky)^2 A_ground / (1 - A_sky A_ground)
 *
 * This is what gives the habitable zone an outer edge. Past a few bars, each
 * further tonne of carbon dioxide brightens the sky faster than it thickens the
 * blanket, and a planet that piles on more of it gets colder. There is a
 * distance beyond which no amount of atmosphere will keep water liquid, and
 * this equation is why.
 */
export function planetaryAlbedo(
  surfaceAlbedo: number, pressureBar: number, starTeff = 5772,
): number {
  const sky = rayleighAlbedo(pressureBar, starTeff);
  const ground = Math.min(0.98, Math.max(surfaceAlbedo, 0));
  return Math.min(0.95, sky + ((1 - sky) ** 2 * ground) / (1 - sky * ground));
}

// ---------------------------------------------------------------------------
// Structure of the air column
// ---------------------------------------------------------------------------

/** Dry adiabatic lapse rate, K/m. Earth's is 9.8 K/km and it is just g/cp. */
export const dryLapseRate = (gravity: number, cp: number): number => gravity / Math.max(cp, 1);

/**
 * Moist adiabatic lapse rate, K/m.
 *
 * Condensation releases latent heat into a rising parcel, so a saturated one
 * cools more slowly than a dry one: Earth's tropics run at 6.5 K/km rather than
 * 9.8. This is why the snow line on a mountain sits where it does, and it is
 * the number that decides whether a peak is white.
 */
export function moistLapseRate(gravity: number, tempK: number, pressureBar: number, cp = 1004): number {
  const dry = dryLapseRate(gravity, cp);
  const p = Math.max(pressureBar, 1e-6) * 1e5;
  const es = saturationVapourPressure(tempK);
  if (es >= p * 0.9) return dry * 0.35;
  const r = (0.622 * es) / Math.max(p - es, 1);      // saturation mixing ratio
  const num = 1 + (L_VAP * r) / (R_DRY_AIR * tempK);
  const den = 1 + (L_VAP * L_VAP * r * 0.622) / (cp * R_DRY_AIR * tempK * tempK);
  return dry * (num / den);
}

/** Pressure scale height, m: H = kT / (mu g), the distance over which air thins by e. */
export const scaleHeight = (tempK: number, gravity: number, molarMassAmu: number): number =>
  (8.314462618 * tempK) / (Math.max(molarMassAmu, 1e-3) * 1e-3 * Math.max(gravity, 1e-6));

export { SIGMA_SB };
