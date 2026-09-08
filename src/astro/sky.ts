/**
 * The sky, from underneath it.
 *
 * Every other view in this simulation looks at things from outside. This one
 * is the view from the ground, and it is a different problem: what you see is
 * not an object but the air itself, lit from the side by a star that is
 * usually below or near the horizon when it is worth looking at.
 *
 * Three questions decide what a sky looks like, and all three have answers
 * that follow from the planet rather than from taste:
 *
 *  - **How much air is there, and how well does it scatter?** Rayleigh's
 *    coefficient goes as the inverse fourth power of wavelength, which is why
 *    a sky is blue and a sunset is red - but the *absolute* scale comes from
 *    the gas's refractive index and its number density, and those come from
 *    the surface pressure, temperature, gravity and composition. Earth's
 *    atmosphere has a zenith optical depth near 0.1 in the green, so a tenth
 *    of the sunlight overhead is scattered and the sky is a bright blue vault.
 *    Mars has 0.003 of the same thing, which is why the Martian sky is nearly
 *    black at midday and its actual butterscotch colour is dust rather than
 *    air. Venus has about eighteen, which is why nothing on its surface has
 *    ever seen the Sun. None of that is put in by hand; it falls out.
 *
 *  - **How long is the path through it?** Not sec(z): a plane-parallel
 *    atmosphere has infinite air mass at the horizon, which would make every
 *    sunset a black wall. The right answer is the Chapman function, which
 *    accounts for the curvature of the shell and gives sqrt(pi X / 2) at the
 *    horizon with X the planet's radius over the scale height - about 35 air
 *    masses for Earth. It also has a branch for a Sun that is already *below*
 *    the horizon, which is the whole of twilight.
 *
 *  - **Where is the star?** Declination from the obliquity and the season,
 *    hour angle from the rotation, and then the same spherical triangle that
 *    every sundial ever built solves. It gives midnight sun above the arctic
 *    circle, no seasons at all for a planet with no tilt, and a star nailed
 *    to one spot in the sky for a tidally locked one - which is most habitable
 *    planets in the galaxy, since most stars are red dwarfs.
 */

import { K_B, M_PROTON, R_EARTH } from '../core/constants';
import type { Planet } from './planets';

// ---------------------------------------------------------------------------
// Gases
// ---------------------------------------------------------------------------

/** Loschmidt's number: molecules per cubic metre at 0 C and one atmosphere. */
export const LOSCHMIDT = 2.6867811e25;

/** Number density at the conditions the refractivities below are quoted at. */
const N_REF = 2.546899e25; // 15 C, 1 atm - the usual standard for optics

export interface Gas {
  name: string;
  /** Molar mass, atomic mass units. */
  molarMassAmu: number;
  /** n - 1 at the reference density, dimensionless. */
  refractivity: number;
  /** Depolarisation factor: how far from spherical the molecule is. */
  depolarisation: number;
}

/**
 * The gases a planet's air can be made of.
 *
 * Refractivities are measured values at 550 nm and standard conditions.
 * They matter more than they look: scattering goes as the *square* of the
 * refractivity, so carbon dioxide scatters two and a half times as strongly
 * as air per molecule and hydrogen only a quarter as strongly.
 */
export const GASES: Record<string, Gas> = {
  air: { name: 'air', molarMassAmu: 28.96, refractivity: 2.78e-4, depolarisation: 0.0279 },
  N2: { name: 'N₂', molarMassAmu: 28.013, refractivity: 2.98e-4, depolarisation: 0.0305 },
  O2: { name: 'O₂', molarMassAmu: 31.998, refractivity: 2.66e-4, depolarisation: 0.054 },
  CO2: { name: 'CO₂', molarMassAmu: 44.01, refractivity: 4.49e-4, depolarisation: 0.0805 },
  H2: { name: 'H₂', molarMassAmu: 2.016, refractivity: 1.36e-4, depolarisation: 0.0221 },
  He: { name: 'He', molarMassAmu: 4.0026, refractivity: 3.48e-5, depolarisation: 0.0025 },
  CH4: { name: 'CH₄', molarMassAmu: 16.043, refractivity: 4.41e-4, depolarisation: 0.0 },
  H2O: { name: 'H₂O', molarMassAmu: 18.015, refractivity: 2.55e-4, depolarisation: 0.02 },
  N2O2: { name: 'N₂/O₂', molarMassAmu: 28.96, refractivity: 2.78e-4, depolarisation: 0.0279 },
  SO2: { name: 'SO₂', molarMassAmu: 64.066, refractivity: 6.86e-4, depolarisation: 0.09 },
  NH3: { name: 'NH₃', molarMassAmu: 17.031, refractivity: 3.76e-4, depolarisation: 0.03 },
  Ar: { name: 'Ar', molarMassAmu: 39.948, refractivity: 2.81e-4, depolarisation: 0.0 },
  Na: { name: 'Na', molarMassAmu: 22.99, refractivity: 1.9e-4, depolarisation: 0.0 },
};

/**
 * Look a gas up by the label the planet generator uses.
 *
 * Falls back to air, because a sky made of something unlisted is still a sky
 * and a missing entry should not produce a black one.
 */
export function gasFor(atmosphere: string): Gas {
  const a = atmosphere.trim();
  for (const g of Object.values(GASES)) if (g.name === a) return g;
  // Mixtures are named for what dominates them. Longest name first, because
  // "CO₂" contains "O₂" and matching the short one would turn every carbon
  // dioxide atmosphere in the simulation into oxygen.
  const byLength = Object.values(GASES).sort((x, y) => y.name.length - x.name.length);
  for (const g of byLength) if (a.includes(g.name)) return g;
  return GASES.air;
}

/**
 * King's correction factor, (6+3d)/(6-7d).
 *
 * Real molecules are not spheres, so scattered light is not fully polarised
 * and rather more of it comes out than the simple theory says. For air it is
 * a five per cent effect; for carbon dioxide, ten.
 */
export function kingFactor(depolarisation: number): number {
  return (6 + 3 * depolarisation) / (6 - 7 * depolarisation);
}

// ---------------------------------------------------------------------------
// An atmosphere
// ---------------------------------------------------------------------------

/** The three wavelengths the renderer works in, metres. */
export const RGB_LAMBDA: [number, number, number] = [680e-9, 550e-9, 440e-9];

export interface Atmosphere {
  /** Surface pressure, Pa. Zero for an airless world. */
  pressurePa: number;
  tempK: number;
  /** Surface gravity, m/s^2. */
  gravity: number;
  /** Planet radius, m. */
  radiusM: number;
  gas: Gas;
  /** Pressure scale height, m. */
  scaleHeightM: number;
  /** Molecules per cubic metre at the surface. */
  numberDensity: number;
  /** Rayleigh scattering coefficient at the surface, per metre, per channel. */
  betaR: [number, number, number];
  /**
   * Aerosol extinction at the surface, per metre - and grey.
   *
   * A dust grain is much larger than a wavelength, so how much light it takes
   * out of a beam barely depends on colour. What depends on colour is what it
   * does with it.
   */
  betaM: number;
  /**
   * Single-scattering albedo of the aerosol, per channel: the fraction of the
   * light it removes that it scatters rather than absorbs.
   *
   * This is where a dusty sky gets its colour, and it is worth being careful
   * about the direction. Martian dust is iron oxide - rust - which absorbs
   * blue and passes red, so its albedo is high in the red and low in the blue.
   * Extinction stays grey, so the Sun through it is dimmed without much
   * reddening; but the light that reaches you *sideways*, having been
   * scattered, has had its blue absorbed away, and that is the butterscotch
   * sky. Making the dust scatter less blue instead would have produced a blue
   * sky on Mars, which is the opposite of the truth.
   */
  aerosolAlbedo: [number, number, number];
  /** Aerosol scale height, m. Dust and cloud sit far lower than the air does. */
  aerosolScaleHeightM: number;
  /** Aerosol asymmetry: how forward-throwing the haze is, 0 to 1. */
  aerosolG: number;
}

/**
 * Pressure scale height, kT / (mu m_u g).
 *
 * About 8.4 km for Earth, 11 km for Mars - Mars is colder but its gravity is
 * a third of Earth's, and gravity wins. It is the single number that decides
 * how thick an atmosphere looks from inside it.
 */
export function scaleHeight(tempK: number, molarMassAmu: number, gravity: number): number {
  if (gravity <= 0 || molarMassAmu <= 0) return 0;
  return (K_B * tempK) / (molarMassAmu * M_PROTON * gravity);
}

/** Molecules per cubic metre, from the ideal gas law. */
export function numberDensity(pressurePa: number, tempK: number): number {
  if (tempK <= 0) return 0;
  return pressurePa / (K_B * tempK);
}

/**
 * Rayleigh scattering coefficient, per metre.
 *
 *     beta = 8 pi^3 (n^2 - 1)^2 / (3 N lambda^4) * King
 *
 * evaluated with the refractivity at a reference density and then scaled to
 * the density actually present. For air at sea level and 550 nm it comes to
 * 1.15e-5 per metre, which over a scale height is an optical depth of 0.098 -
 * both of those are the measured numbers, and neither is fitted here.
 */
export function rayleighBeta(
  numberDens: number, refractivity: number, king: number, lambdaM: number,
): number {
  if (numberDens <= 0) return 0;
  const nsq1 = 2 * refractivity + refractivity * refractivity; // n^2 - 1
  const num = 8 * Math.PI ** 3 * nsq1 * nsq1;
  const den = 3 * N_REF * Math.pow(lambdaM, 4);
  return (num / den) * (numberDens / N_REF) * king;
}

/**
 * Work out the air over a planet.
 *
 * The aerosol load is the one thing here that is estimated rather than
 * derived, because it depends on weather and history rather than on physics
 * you can write down: a dry world with any air at all raises dust, a wet one
 * makes cloud and haze instead, and a thick atmosphere holds more of either.
 * The numbers are anchored on the two cases anybody has measured from the
 * ground - Earth's haze at about 2e-5 per metre and Mars's dust at an optical
 * depth near a half.
 */
export function atmosphereOf(p: Planet): Atmosphere {
  const gas = gasFor(p.atmosphere);
  const pressurePa = p.pressureBar * 1e5;
  const tempK = Math.max(20, p.surfaceK);
  const gravity = Math.max(0.01, p.gravity);
  const H = scaleHeight(tempK, gas.molarMassAmu, gravity);
  const N = numberDensity(pressurePa, tempK);
  const king = kingFactor(gas.depolarisation);
  const betaR = RGB_LAMBDA.map((l) => rayleighBeta(N, gas.refractivity, king, l)) as
    [number, number, number];

  // Dust needs air to lift it and dryness to expose it, and it saturates:
  // beyond a certain thickness of atmosphere the surface is not being scoured
  // any more, it is being sheltered.
  const dryness = Math.max(0, 1 - p.oceanFraction * 2.2);
  const lift = Math.min(1, Math.pow(p.pressureBar / 0.006, 0.35));
  // A typical Martian day sits near an optical depth of a half; a storm goes
  // to five, and this does not model storms.
  const dustDepth = 0.55 * dryness * lift * Math.exp(-p.pressureBar / 4);
  // Cloud and water haze, which is grey rather than red and sits lower still.
  const hazeDepth = 0.12 * p.cloudCover * Math.min(1, p.pressureBar);
  const aerosolScaleHeightM = Math.max(400, H * 0.14);
  const depth = dustDepth + hazeDepth;
  const betaM = depth / Math.max(aerosolScaleHeightM, 1);

  // Rust absorbs blue and passes red; water droplets absorb almost nothing at
  // any colour. Interpolating between them by how much of the haze is dust.
  const dustFrac = depth > 0 ? dustDepth / depth : 0;
  const albedo: [number, number, number] = [
    1 - 0.06 * dustFrac,
    1 - 0.26 * dustFrac,
    1 - 0.48 * dustFrac,
  ];

  return {
    pressurePa, tempK, gravity, radiusM: p.radiusM, gas,
    scaleHeightM: H, numberDensity: N, betaR,
    betaM,
    aerosolAlbedo: albedo,
    aerosolScaleHeightM,
    aerosolG: 0.62 + 0.14 * dustFrac,
  };
}

// ---------------------------------------------------------------------------
// How far the light has come
// ---------------------------------------------------------------------------

/**
 * The scaled complementary error function, exp(x^2) erfc(x), for x >= 0.
 *
 * The Chapman function below needs erfc of arguments around twenty, where
 * erfc itself is 1e-170 and multiplying it by an equally enormous exponential
 * is not something floating point will forgive. Scaled, it stays near 1/x and
 * everything behaves. This is Numerical Recipes' Chebyshev fit for erfc with
 * the exponential factor left out of it, good to about a part in a million.
 */
export function erfcx(x: number): number {
  const t = 1 / (1 + 0.5 * Math.abs(x));
  const poly = -1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418
    + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587
      + t * (-0.82215223 + t * 0.17087277))))))));
  const v = t * Math.exp(poly);
  // erfc(-x) = 2 - erfc(x), so erfcx(-x) = 2 exp(x^2) - erfcx(x).
  return x >= 0 ? v : 2 * Math.exp(x * x) - v;
}

/**
 * The Chapman function: relative air mass through a spherical shell.
 *
 * Secant of the zenith angle is the plane-parallel answer and it is wrong in
 * the only place it matters, going to infinity at the horizon instead of to
 * about thirty-five. The spherical answer for an exponential atmosphere is
 *
 *     ch(X, z) = sqrt(pi X / 2) * erfcx( sqrt(X/2) cos z )
 *
 * with X the planet's radius over its scale height. It is 1 overhead and
 * sqrt(pi X / 2) at the horizon by inspection, which for Earth is 34.5.
 *
 * Past the horizon there is a second branch, and it is the interesting one:
 * light from a Sun a few degrees down still crosses the upper atmosphere and
 * still gets scattered to you. That is twilight, and without this term the
 * sky would go out like a switch at sunset.
 *
 * That branch diverges once the ray is aimed well below the horizon, and it
 * is right to: this is the air mass through an exponential atmosphere with no
 * floor under it, and a ray pointed at the centre of such a thing really does
 * pass through infinite gas. Real planets have a surface, and `blocked` is
 * what knows about it - by the time a path is steep enough to overflow here,
 * `opticalDepth` has already returned infinity for running into the ground.
 */
export function chapman(X: number, zenithRad: number): number {
  if (!(X > 0)) return 1;
  const c = Math.cos(zenithRad);
  const root = Math.sqrt((Math.PI * X) / 2);
  const half = Math.sqrt(X / 2);
  if (c >= 0) return root * erfcx(half * c);
  // Below the horizon: the path grazes to a tangent height and comes back up.
  // The subtraction can go negative for a shell so thick that "shell" is the
  // wrong word for it - the approximation assumes the atmosphere is thin
  // against the radius - so it is held at the horizon value, which is the
  // least it can physically be.
  const s = Math.sin(zenithRad);
  const grazing = 2 * Math.sqrt((Math.PI * X * s) / 2) * Math.exp(X * (1 - s));
  return Math.max(root, grazing - root * erfcx(half * -c));
}

/** Relative air mass along a ray leaving a height at a zenith angle. */
export function airMass(a: Atmosphere, zenithRad: number, heightM = 0): number {
  if (a.scaleHeightM <= 0) return 0;
  return chapman((a.radiusM + heightM) / a.scaleHeightM, zenithRad);
}

/**
 * Does a ray leaving this height in this direction escape, or hit the ground?
 *
 * Only ever a question below the local horizon. The ray's closest approach to
 * the centre is (R+h) sin z, and if that is inside the planet the light never
 * gets there - which is why the sky goes out at night and does not merely dim.
 */
export function blocked(a: Atmosphere, zenithRad: number, heightM = 0): boolean {
  if (Math.cos(zenithRad) >= 0) return false;
  return (a.radiusM + heightM) * Math.sin(zenithRad) < a.radiusM;
}

/**
 * Optical depth along that ray, per channel: Rayleigh plus aerosol.
 *
 * Infinite when the ray runs into the planet, which is the honest answer and
 * the one the exponential downstream wants.
 */
export function opticalDepth(
  a: Atmosphere, zenithRad: number, heightM = 0,
): [number, number, number] {
  if (a.pressurePa <= 0 || a.scaleHeightM <= 0) return [0, 0, 0];
  if (blocked(a, zenithRad, heightM)) return [Infinity, Infinity, Infinity];
  const r = a.radiusM + heightM;
  // The vertical column above this height, times the slant factor for it.
  const colR = Math.exp(-heightM / a.scaleHeightM) * a.scaleHeightM
    * chapman(r / a.scaleHeightM, zenithRad);
  const colM = a.aerosolScaleHeightM > 0
    ? Math.exp(-heightM / a.aerosolScaleHeightM) * a.aerosolScaleHeightM
      * chapman(r / a.aerosolScaleHeightM, zenithRad)
    : 0;
  return [0, 1, 2].map((i) => a.betaR[i] * colR + a.betaM * colM) as
    [number, number, number];
}

/** What fraction of the star's light survives the trip down, per channel. */
export function transmittance(
  a: Atmosphere, zenithRad: number, heightM = 0,
): [number, number, number] {
  const t = opticalDepth(a, zenithRad, heightM);
  return [Math.exp(-t[0]), Math.exp(-t[1]), Math.exp(-t[2])];
}

/** The Rayleigh phase function, 3(1 + cos^2 theta) / 16 pi. */
export function rayleighPhase(cosTheta: number): number {
  return (3 / (16 * Math.PI)) * (1 + cosTheta * cosTheta);
}

/** Henyey-Greenstein, for the forward-throwing haze. */
export function miePhase(cosTheta: number, g: number): number {
  const gg = g * g;
  const d = 1 + gg - 2 * g * cosTheta;
  return (1 - gg) / (4 * Math.PI * Math.pow(Math.max(d, 1e-6), 1.5));
}

/**
 * Single-scattered sky radiance in a direction, per channel, in units of the
 * star's irradiance above the atmosphere.
 *
 * Marched rather than solved: at each step along the view ray, work out how
 * much light reaches that point from the star, scatter the right fraction of
 * it toward the viewer, and attenuate it on the way back. Single scattering
 * only, which is exact for a thin atmosphere and increasingly wrong for a
 * thick one - it is why the horizon of a really deep sky comes out darker
 * here than it would be, and it is the standard approximation.
 */
export function skyRadiance(
  a: Atmosphere, viewZenith: number, sunZenith: number, cosScatter: number,
  steps = 24,
): [number, number, number] {
  if (a.pressurePa <= 0 || a.scaleHeightM <= 0) return [0, 0, 0];
  const top = a.scaleHeightM * 9;
  // Where the view ray leaves the atmosphere, from the law of cosines.
  const r = a.radiusM;
  const mu = Math.cos(viewZenith);
  const len = Math.sqrt(Math.max(0, (r + top) ** 2 - r * r * (1 - mu * mu))) - r * mu;
  if (!(len > 0)) return [0, 0, 0];

  const pR = rayleighPhase(cosScatter);
  const pM = miePhase(cosScatter, a.aerosolG);
  const out: [number, number, number] = [0, 0, 0];
  const ds = len / steps;
  // Optical depth accumulated back along the view ray to the eye.
  const viewTau = [0, 0, 0];

  for (let i = 0; i < steps; i++) {
    const s = (i + 0.5) * ds;
    // Height of this sample above the surface, and the zenith angle of the
    // star as seen from it - both change along the ray, and on a small planet
    // with a deep atmosphere they change a lot.
    const h = Math.sqrt(r * r + s * s + 2 * r * s * mu) - r;
    const dR = Math.exp(-h / a.scaleHeightM);
    const dM = Math.exp(-h / a.aerosolScaleHeightM);
    // The local vertical has turned by this much along the ray.
    const bend = Math.asin(Math.min(1, (s * Math.sin(viewZenith)) / (r + h)));
    const sunZ = sunZenith - bend;

    // Down-leg: from the star to this sample. Zero if the planet is in the way,
    // which is what makes the eastern sky dark while the west is still lit.
    const sunTau = opticalDepth(a, sunZ, h);
    for (let c = 0; c < 3; c++) {
      const inScatter = a.betaR[c] * dR * pR
        + a.betaM * a.aerosolAlbedo[c] * dM * pM;
      out[c] += inScatter * Math.exp(-sunTau[c] - viewTau[c]) * ds;
      viewTau[c] += (a.betaR[c] * dR + a.betaM * dM) * ds;
    }
  }
  return out;
}

/**
 * The colour and brightness of the star as seen from the ground.
 *
 * The same transmittance that makes the sky blue takes the blue out of the
 * Sun, and near the horizon it takes almost all of it: thirty-five air masses
 * of Rayleigh scattering is an optical depth of three in the blue and one in
 * the red, which is a sunset.
 */
export function sunColourAtSurface(
  a: Atmosphere, starRGB: [number, number, number], sunZenith: number,
): [number, number, number] {
  const t = transmittance(a, sunZenith);
  return [starRGB[0] * t[0], starRGB[1] * t[1], starRGB[2] * t[2]];
}

// ---------------------------------------------------------------------------
// Where the star is
// ---------------------------------------------------------------------------

/**
 * The star's declination: how far north or south it stands at noon.
 *
 * The obliquity is the whole of it. Zero tilt is a world with no seasons at
 * all, where every day everywhere is twelve hours long forever; Earth's
 * twenty-three and a half degrees is why there is an arctic circle at
 * sixty-six and a half.
 *
 * @param yearFraction where the planet is in its orbit, 0 to 1 from the
 *   northern spring equinox
 */
export function solarDeclination(obliquity: number, yearFraction: number): number {
  return Math.asin(Math.sin(obliquity) * Math.sin(2 * Math.PI * yearFraction));
}

/**
 * The hour angle: how far the planet has turned past local noon, radians.
 *
 * Zero at noon, positive in the afternoon, and it runs from -pi to pi over
 * one solar day.
 */
export function hourAngle(dayFraction: number): number {
  const h = (dayFraction - 0.5) * 2 * Math.PI;
  return h > Math.PI ? h - 2 * Math.PI : h < -Math.PI ? h + 2 * Math.PI : h;
}

/** Where the star is in the sky, from the spherical triangle every sundial solves. */
export function altAz(
  latitude: number, declination: number, hour: number,
): { altitude: number; azimuth: number } {
  const sl = Math.sin(latitude), cl = Math.cos(latitude);
  const sd = Math.sin(declination), cd = Math.cos(declination);
  const ch = Math.cos(hour);
  const sinAlt = sl * sd + cl * cd * ch;
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  // Measured from due north, turning east: the convention every almanac uses.
  const azimuth = Math.atan2(-cd * Math.sin(hour), cd * ch * sl - sd * cl);
  return { altitude, azimuth };
}

/**
 * How long the star stays up, as a fraction of the day.
 *
 * One and zero are both real answers, and both happen: above the arctic
 * circle in summer the star never sets, and in winter it never rises.
 */
export function daylightFraction(latitude: number, declination: number): number {
  const x = -Math.tan(latitude) * Math.tan(declination);
  if (x <= -1) return 1;
  if (x >= 1) return 0;
  return Math.acos(x) / Math.PI;
}

/**
 * The apparent radius of the star from this world, radians.
 *
 * Half a degree from Earth. From a planet in the habitable zone of a red
 * dwarf, where the year is eleven days long, it is two or three times that -
 * a noticeably larger, deeper red sun that never moves.
 */
export function angularRadius(starRadiusM: number, distanceM: number): number {
  return Math.atan2(starRadiusM, Math.max(distanceM, 1));
}

/**
 * How far the horizon is, for an observer at a given height, metres.
 *
 * sqrt(2 R h) to a very good approximation, and it is startlingly close on a
 * small world: five kilometres on Earth from eye level, and under two on a
 * Mars-sized one.
 */
export function horizonDistance(radiusM: number, eyeHeightM: number): number {
  return Math.sqrt(Math.max(0, 2 * radiusM * eyeHeightM + eyeHeightM * eyeHeightM));
}

/** How far below the true horizontal the horizon sits, radians. */
export function horizonDip(radiusM: number, eyeHeightM: number): number {
  return Math.acos(Math.min(1, radiusM / (radiusM + Math.max(eyeHeightM, 0))));
}

export { R_EARTH };
