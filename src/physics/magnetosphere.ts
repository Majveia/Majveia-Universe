/**
 * Magnetic fields, magnetospheres, and where the aurora goes.
 *
 * An aurora is not decoration. It is the visible footprint of a planet's
 * magnetic field, and its geometry is fixed by three things that can all be
 * computed:
 *
 *  1. **Whether there is a field at all.** A dynamo needs a convecting,
 *     electrically conducting fluid core, and rotation fast enough to organise
 *     the convection into a dipole. Venus rotates once every 243 days and has
 *     no field worth the name; Mars' froze out when its core stopped
 *     convecting. Both are dark at night.
 *
 *  2. **How far out the field holds off the stellar wind.** The magnetopause
 *     sits where the magnetic pressure B²/2μ₀ balances the wind's ram pressure
 *     ρv². For the Earth that is about ten Earth radii; for Jupiter, whose
 *     moment is twenty thousand times larger and whose wind is a twenty-fifth
 *     as dense, it is closer to seventy.
 *
 *  3. **Where the last closed field line comes down.** On a dipole, the line
 *     crossing the equator at L planetary radii reaches the surface at a
 *     colatitude θ with sin²θ = 1/L. Everything poleward of that is open to
 *     the wind, and the ring where it lands is the auroral oval. For the Earth
 *     that is about 18° from the magnetic pole, which is where the aurora
 *     actually is.
 *
 * A stronger field therefore pushes the oval *poleward*, not equatorward: a
 * bigger magnetosphere means a larger L. During a severe storm the wind
 * compresses the magnetosphere, L falls, and the oval slides south far enough
 * to be seen from the Mediterranean. That is one expression, evaluated twice.
 *
 * The dynamo scaling is the honest weak point: field strength from planetary
 * parameters is an open problem, and the form used here follows Christensen &
 * Aubert (2006) in making the field depend on the convective heat flux and not
 * on the rotation rate, with rotation entering only as a gate on whether the
 * dynamo organises into a dipole at all.
 */

import { M_EARTH, R_EARTH } from '../core/constants';

/** Earth's equatorial surface field, tesla. */
export const B_EARTH = 3.05e-5;
/** Solar wind ram pressure at 1 AU, pascals. */
export const P_WIND_1AU = 2.2e-9;
/** Earth's magnetopause standoff, in planetary radii. */
export const L_EARTH = 10.4;

export interface MagneticInput {
  massKg: number;
  radiusM: number;
  /** Sidereal rotation period, seconds. Sign is ignored. */
  dayS: number;
  /** System age, Gyr. */
  ageGyr: number;
  /** True for a body with no metallic core to speak of. */
  gasGiant?: boolean;
  /** Surface temperature, K - a molten world still has a liquid core. */
  surfaceK?: number;
}

/**
 * Equatorial surface field strength, tesla.
 *
 * Convective flux is taken to scale with mass and to decay as the interior
 * cools, and the field with the cube root of that flux. The rotation gate is a
 * Rossby-number stand-in: past a rotation period of a few weeks, convection is
 * no longer rotationally constrained and the field goes multipolar and weak.
 */
export function surfaceField(p: MagneticInput): number {
  const m = p.massKg / M_EARTH;
  const r = p.radiusM / R_EARTH;
  // Heat still coming out of the core: bigger planets stay hot far longer, and
  // a molten surface means the interior has certainly not frozen.
  const molten = (p.surfaceK ?? 288) > 1200 ? 1.6 : 1;
  // Cooling time. A small body has far more surface per unit of stored heat, so
  // it freezes far sooner: Mars ran a dynamo for its first few hundred million
  // years and has been magnetically dead ever since, while the Earth's is still
  // running after four and a half billion.
  const tauGyr = 14 * Math.pow(Math.max(m, 0.01), 1.1);
  const cooling = Math.exp(-Math.max(p.ageGyr, 0) / tauGyr);
  const flux = Math.pow(Math.max(m, 0.01), 0.6) * cooling * molten;
  // Christensen & Aubert: B ~ (rho)^(1/6) F^(1/3), and density barely varies
  // across rocky planets, so the flux term carries it.
  let b = B_EARTH * Math.pow(flux / (Math.pow(1, 0.6) * Math.exp(-4.6 / 14)), 1 / 3);
  // Rotation gate. Rotation does not set the field's strength, but it does
  // decide whether convection organises into a dipole at all: past a few days
  // the Coriolis force stops dominating, the dynamo goes multipolar, and what
  // reaches the surface collapses. Venus turns once in 243 days and has no
  // field; Earth turns in one and has a strong one.
  const periodDays = Math.abs(p.dayS) / 86400;
  b *= Math.min(1, Math.pow(6 / Math.max(periodDays, 1e-6), 1.6));
  // Gas giants run a dynamo in metallic hydrogen: a far larger conducting
  // region, and a correspondingly larger field.
  if (p.gasGiant) b *= 6 * Math.pow(Math.max(r, 1), 0.6);
  // A body too small to have kept a liquid metallic core has no dynamo at all,
  // whatever its heat budget says.
  if (m < 0.3) b *= Math.pow(m / 0.3, 1.2);
  return Math.max(b, 0);
}

/** Magnetic dipole moment, A m². */
export function dipoleMoment(p: MagneticInput): number {
  const b = surfaceField(p);
  // M = 4 pi B R^3 / mu0
  return (4 * Math.PI * b * Math.pow(p.radiusM, 3)) / (4 * Math.PI * 1e-7);
}

/**
 * Stellar wind ram pressure at a given orbital distance, pascals.
 *
 * The wind thins as 1/d², and a more luminous star drives a denser one; an
 * active M dwarf drives a wind far fiercer than its luminosity suggests, which
 * is exactly why the habitable zones of red dwarfs are a problem.
 */
export function windPressure(au: number, luminosityLsun = 1, activity = 1): number {
  const d = Math.max(au, 1e-4);
  return (P_WIND_1AU * activity * Math.pow(Math.max(luminosityLsun, 1e-6), 0.35)) / (d * d);
}

/**
 * Magnetopause standoff distance in planetary radii, from pressure balance
 * between the compressed dipole field and the wind's ram pressure.
 *
 * Returns 1 when the field cannot hold the wind off the surface at all - the
 * planet's atmosphere is then being stripped, which is the Martian story.
 */
export function standoffRadii(p: MagneticInput, windPa: number): number {
  const b = surfaceField(p);
  if (!(b > 0) || !(windPa > 0)) return 1;
  const mu0 = 4 * Math.PI * 1e-7;
  // Compression factor f ~ 2 for the field just inside the magnetopause.
  const f = 2;
  const l = Math.pow((f * f * b * b) / (2 * mu0 * windPa), 1 / 6);
  return Math.max(1, l);
}

/**
 * Colatitude of the auroral oval, radians from the magnetic pole: the footprint
 * of the last closed field line, sin²θ = 1/L.
 */
export function ovalColatitude(standoff: number): number {
  const l = Math.max(standoff, 1.0001);
  return Math.asin(Math.min(1, 1 / Math.sqrt(l)));
}

/** The Earth, as the model sees it - the yardstick everything else is in. */
export const EARTH_LIKE: MagneticInput = {
  massKg: M_EARTH, radiusM: R_EARTH, dayS: 86164, ageGyr: 4.6, surfaceK: 288,
};

/**
 * Auroral power relative to Earth's.
 *
 * The magnetosphere intercepts the wind over its own cross-section, and a fixed
 * fraction of that energy ends up precipitating down the open field lines. So
 * the power goes as the wind pressure times the square of the standoff
 * distance - a large magnetosphere around a weak wind can still outshine a
 * small one in a fierce wind, which is why Jupiter's aurora is the brightest in
 * the solar system by four orders of magnitude.
 */
export function auroralPower(p: MagneticInput, windPa: number): number {
  const l = standoffRadii(p, windPa);
  if (l <= 1.0001) return 0;
  const area = l * l * p.radiusM * p.radiusM;
  const le = standoffRadii(EARTH_LIKE, P_WIND_1AU);
  const earthArea = le * le * R_EARTH * R_EARTH;
  return (windPa / P_WIND_1AU) * (area / earthArea);
}

/**
 * Tilt of the magnetic axis from the rotation axis, radians. Dynamos do not
 * line up neatly: the Earth's is 11° off, Uranus' is 59°. Deterministic in the
 * planet's own seed so a world's aurora is always in the same place.
 */
export function dipoleTilt(seed: number): number {
  const h = Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
  // Most dynamos are near-axial; a long tail allows an Uranus.
  return Math.pow(h, 2.2) * 1.15;
}
