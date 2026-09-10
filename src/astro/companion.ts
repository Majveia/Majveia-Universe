/**
 * The other body in your sky.
 *
 * A gas giant has no bottom - you can fall through one for ever and never
 * arrive - and for that reason the ladder used to stop at it. But a giant is
 * not one world, it is a dozen: Jupiter has four you could walk on and Saturn
 * has one with a thicker atmosphere than Earth's. So the ladder goes on, down
 * onto a moon, and from there the view back up is the best in any solar
 * system.
 *
 * What makes it the best is arithmetic. The Moon is four hundred thousand
 * kilometres from Earth and half a degree wide. Europa is *sixteen times
 * closer* to something eleven times bigger, so Jupiter is twelve degrees
 * across in Europa's sky - as wide as your hand at arm's length, and two
 * thousand times the area of a full moon. And it never moves. A close moon is
 * tidally locked to what it orbits, so the planet hangs at one fixed spot,
 * going through its phases in place, never rising and never setting. Walk far
 * enough round the moon and it sets once, permanently, below the horizon
 * behind you.
 *
 * Three consequences worth having, and each one falls out of the geometry
 * rather than being decided:
 *
 *  - **Half the moon never sees it at all.** The planet is above the horizon
 *    exactly on the hemisphere facing it, minus a sliver taken by parallax,
 *    because the moon is not a point and you are standing on the outside of it.
 *  - **The phases run backwards from the ones the planet sees.** When it is
 *    new moon at Jupiter it is full Jupiter at Europa: the two are always
 *    complementary, because it is the same terminator seen from opposite sides.
 *  - **There is an eclipse nearly every orbit.** A giant casts an umbra tens of
 *    millions of kilometres long and its moons orbit within a millionth of
 *    that, so they pass through the middle of it. Europa is eclipsed every
 *    three and a half days, and for a couple of hours the brightest thing in
 *    its sky is a black disc with a ring of refracted sunset round it.
 */

import { G, K_B, M_PROTON, M_SUN, R_SUN, R_EARTH, AU, YEAR } from '../core/constants';
import { jeansParameter, radiusFromMass, type Moon, type Planet, type Ring } from './planets';

// ---------------------------------------------------------------------------
// A moon, as a place to stand
// ---------------------------------------------------------------------------

/** Surface gravity of a body, m/s^2. */
export function surfaceGravity(massKg: number, radiusM: number): number {
  if (radiusM <= 0) return 0;
  return (G * massKg) / (radiusM * radiusM);
}

/**
 * How much a moon is flexed by the planet it orbits, W/m^2 at its surface.
 *
 * A moon on an eccentric orbit is squeezed harder at pericentre than at
 * apocentre, and the difference is worked into it as heat. The scaling is
 * brutal - the sixth power of the radius over the seventh power of the
 * distance - which is why Io, closest of the four, is the most volcanically
 * active object in the solar system and Callisto, four times further out, is a
 * dead ball of ice. Io gets about two and a half watts per square metre this
 * way: half of what the distant Sun gives it, and twenty times the heat coming
 * out of the Earth.
 *
 * The rigidity and dissipation of the interior are wrapped into one constant
 * because nobody knows them for any moon but ours.
 */
export function tidalHeatFlux(
  moonRadiusM: number, moonAM: number, eccentricity: number, parentMassKg: number,
): number {
  if (moonAM <= 0 || moonRadiusM <= 0) return 0;
  const n = Math.sqrt((G * parentMassKg) / moonAM ** 3); // mean motion
  // Power ~ (21/2) k2/Q * (G M^2 R^5 n e^2) / a^6, over the surface area.
  const K = 1.7e-2; // k2/Q calibrated so Io lands on its measured 2.5 W/m^2
  const power = K * ((G * parentMassKg ** 2 * moonRadiusM ** 5 * n * eccentricity ** 2)
    / moonAM ** 6) * 10.5;
  return power / (4 * Math.PI * moonRadiusM * moonRadiusM);
}

/** Stefan-Boltzmann, for turning a flux into a temperature. */
const SIGMA = 5.670374419e-8;

/**
 * The surface temperature of a moon, K.
 *
 * Sunlight at the parent's distance, minus what it reflects, plus whatever
 * tidal flexing puts in. The tidal term matters for exactly the moons where it
 * matters and is negligible everywhere else, which is the point of computing
 * it rather than assuming it.
 */
export function moonTemperature(
  starLsun: number, auFromStar: number, albedo: number, tidalFlux: number,
): number {
  const solar = (1361 * starLsun) / Math.max(auFromStar * auFromStar, 1e-9);
  const absorbed = (solar * (1 - albedo)) / 4;
  return Math.pow(Math.max(absorbed + tidalFlux, 1e-6) / SIGMA, 0.25);
}

/**
 * Whether a moon has managed to hold on to an atmosphere.
 *
 * There is exactly one example in the solar system, so this is calibrated on
 * one point and says so. The Jeans parameter alone does not do it: Ganymede's
 * is 120 and Callisto's 88, both comfortably retentive, and both are bare
 * rock. Titan's is 140 and it has half again Earth's surface pressure.
 *
 * Three things separate it, and each has a reason:
 *
 *  - **A large margin on escape.** Not the textbook threshold of thirty, which
 *    only says nitrogen does not boil off this week, but enough that it
 *    survives four and a half billion years of a slowly brightening star.
 *  - **Ice.** A moon that formed inside its system's snow line never had the
 *    ammonia that photolysed into Titan's nitrogen in the first place. Escape
 *    is irrelevant if there was nothing to escape.
 *  - **Distance from the parent.** Ganymede sits fifteen Jupiter radii out,
 *    deep inside the most energetic magnetosphere in the solar system, and
 *    what it might have had has been sputtered off it. Titan is twenty-one
 *    Saturn radii out and spends much of its orbit outside Saturn's altogether.
 */
export function retainsAtmosphere(
  massKg: number, radiusM: number, tempK: number, icy: boolean,
  aOverParentRadius: number,
): boolean {
  if (!icy) return false;
  if (aOverParentRadius < 18) return false;
  return jeansParameter(massKg, radiusM, tempK, 28.013) > 130;
}

/**
 * Turn a moon into somewhere you can stand.
 *
 * The result is shaped like a planet, because from the ground it is one: it
 * has gravity, a sky, a day and a surface, and nothing downstream of here
 * needs to know it is in orbit around something else.
 */
export function moonAsWorld(
  m: Moon, parent: Planet, starLsun: number, index: number,
): Planet {
  const gravity = surfaceGravity(m.massKg, m.radiusM);
  const flux = tidalHeatFlux(m.radiusM, m.a, Math.max(m.e, 0.0015), parent.massKg);
  const surfaceK = moonTemperature(starLsun, parent.au, m.albedo, flux);
  const air = retainsAtmosphere(m.massKg, m.radiusM, surfaceK, m.icy,
    m.a / Math.max(parent.radiusM, 1));
  // Titan is 1.45 bar; scale from how comfortably it clears escape.
  const lam = jeansParameter(m.massKg, m.radiusM, surfaceK, 28.013);
  const pressureBar = air ? Math.min(4, 0.02 * Math.max(0, lam - 55)) : 0;

  // A moon this close is locked, which is nearly all of them: the timescale
  // goes as the sixth power of the distance and they are all very close.
  const periodS = 2 * Math.PI * Math.sqrt(m.a ** 3 / (G * parent.massKg));

  // Volcanic when the flexing is putting out watts per square metre, which
  // happens to exactly one body in this solar system.
  const warm = flux > 1.0;
  return {
    index,
    name: m.name,
    cls: warm ? 'lava' : m.icy ? 'ice' : 'iron',
    massKg: m.massKg,
    radiusM: m.radiusM,
    density: m.massKg / ((4 / 3) * Math.PI * m.radiusM ** 3),
    gravity,
    escapeVelocity: Math.sqrt((2 * G * m.massKg) / m.radiusM),
    elements: { a: m.a, e: m.e, i: m.i, Omega: 0, omega: 0, M0: m.phase, epoch: 0 },
    au: parent.au,
    periodS,
    // Locked: its day is its month, which is why the planet never moves.
    dayS: periodS,
    obliquity: 0,
    albedo: m.albedo,
    teqK: surfaceK,
    surfaceK,
    pressureBar,
    atmosphere: air ? 'N₂' : 'none',
    // Ice is not liquid. A tidally heated icy moon has an ocean, but it is
    // under ten kilometres of crust and you are standing on the crust.
    oceanFraction: 0,
    cloudCover: air ? 0.55 : 0,
    tidallyLocked: true,
    habitable: false,
    biosphere: 0,
    moons: [],
    rings: [],
    color: m.color,
    color2: [
      m.color[0] * 0.45 + 0.16, m.color[1] * 0.45 + 0.15, m.color[2] * 0.45 + 0.14,
    ],
    surfaceSeed: Math.abs(Math.round(m.a)) ^ 0x9e37,
    magnetism: 0,
  };
}

// ---------------------------------------------------------------------------
// The parent, from the moon's surface
// ---------------------------------------------------------------------------

/** Angular radius of the parent from the moon's centre, radians. */
/**
 * The oblateness of a spinning world, as the J2 of its gravity field.
 *
 * A rotating body is not a sphere - it bulges at the equator, because the
 * material there is being flung outward and only gravity is holding it in. How
 * much it bulges is set by the ratio of that centrifugal effect at the surface
 * to the gravity holding it together, and J2 is very nearly half of it for
 * anything not wildly centrally condensed. Earth comes out at 1.7e-3 against a
 * measured 1.08e-3, Jupiter at 4e-2 against 1.5e-2: high, but J2 enters the
 * radius below as a fifth root, so a factor of three here is a quarter there.
 */
export function oblatenessJ2(massKg: number, radiusM: number, rotationS: number): number {
  const p = Math.abs(rotationS);
  if (!(p > 0) || !(massKg > 0) || !(radiusM > 0)) return 0;
  const omega = (2 * Math.PI) / p;
  const q = (omega * omega * radiusM ** 3) / (G * massKg);
  // Runaway rotation is not a shape, it is a break-up: cap it well short.
  return Math.min(0.25, 0.5 * q);
}

/**
 * The Laplace radius: where a moon stops caring about its planet's equator and
 * starts caring about its planet's orbit.
 *
 * Two torques are fighting over the plane a moon orbits in. Close in, the
 * planet's equatorial bulge wins and drags the orbit into the equator. Far
 * out, the star's tide wins and drags it into the planet's own orbital plane.
 * They are equal at this radius, and it is the reason the answer to "does a
 * moon orbit over the equator" is different for Jupiter than for us.
 *
 * Ten Earth radii for Earth - and our Moon is at sixty, which is why it follows
 * the ecliptic to within five degrees and why eclipses come in seasons twice a
 * year. Thirty-two Jupiter radii for Jupiter - and every Galilean is inside
 * that, which is why they sit in its equator to a fraction of a degree and are
 * eclipsed on almost every orbit.
 */
export function laplaceRadius(
  j2: number, planetRadiusM: number, planetAuM: number,
  planetMassKg: number, starMassKg: number,
): number {
  if (!(j2 > 0) || !(planetMassKg > 0) || !(starMassKg > 0)) return Infinity;
  const r5 = 2 * j2 * planetRadiusM * planetRadiusM * planetAuM ** 3
    * (planetMassKg / starMassKg);
  return r5 > 0 ? Math.pow(r5, 0.2) : Infinity;
}

/**
 * The tilt of a moon's Laplace plane out of its planet's equator.
 *
 * Zero deep inside the Laplace radius, the full obliquity far outside it, and
 * a smooth handover in between - which is the actual solution to the balance
 * of the two torques, not an interpolation put in by hand.
 */
export function laplaceTilt(obliquity: number, aM: number, laplaceM: number): number {
  if (!(aM > 0)) return 0;
  if (!Number.isFinite(laplaceM)) return 0;
  const k = 2 * Math.pow(laplaceM / aM, 5);
  if (!Number.isFinite(k)) return 0;
  const num = Math.sin(2 * obliquity);
  const den = Math.cos(2 * obliquity) + k;
  return 0.5 * Math.atan2(num, den);
}

export function parentAngularRadius(parentRadiusM: number, aM: number): number {
  return Math.atan2(parentRadiusM, Math.max(aM, 1));
}

/**
 * How high the parent stands above the horizon, radians, at an angular
 * distance from the point directly under it.
 *
 * Ninety degrees at the sub-planet point and falling to slightly *below* zero
 * at ninety degrees away - not exactly zero, because the moon has a radius and
 * you are standing on the outside of it. That parallax is what makes the
 * planet visible from a little less than half the moon rather than exactly
 * half, and on a big moon close in it is a degree or more.
 *
 * Negative means it has set: on that side of the moon it has never been seen.
 */
export function parentAltitude(
  aM: number, moonRadiusM: number, angleFromSubpoint: number,
): number {
  const c = Math.cos(angleFromSubpoint);
  const d = Math.sqrt(aM * aM + moonRadiusM * moonRadiusM - 2 * aM * moonRadiusM * c);
  if (d <= 0) return Math.PI / 2;
  return Math.asin(Math.max(-1, Math.min(1, (aM * c - moonRadiusM) / d)));
}

/**
 * The angular distance from the sub-planet point at which the parent sets,
 * radians. Just under ninety degrees.
 */
export function parentHorizonAngle(aM: number, moonRadiusM: number): number {
  return Math.acos(Math.max(-1, Math.min(1, moonRadiusM / aM)));
}

/**
 * How far the parent wanders about its fixed spot, radians.
 *
 * A locked moon turns at a constant rate but sweeps its orbit at a varying
 * one, so the two only cancel exactly on a circular orbit. The mismatch is
 * twice the eccentricity in longitude, and it is why the Moon shows us
 * fifty-nine per cent of its surface rather than fifty.
 */
export function librationAmplitude(e: number): number {
  return 2 * Math.abs(e);
}

/** Illuminated fraction of a disc at a given phase angle. */
export function illuminatedFraction(phaseAngleRad: number): number {
  return (1 + Math.cos(phaseAngleRad)) / 2;
}

// ---------------------------------------------------------------------------
// Eclipses
// ---------------------------------------------------------------------------

/**
 * How long a body's full shadow reaches behind it, metres.
 *
 * The umbra is a cone that closes where the body stops covering the star, at
 * L = R d / (R* - R). For Jupiter it is ninety million kilometres, and its
 * moons orbit inside the first per cent of it - so they do not graze the
 * shadow, they pass through the deepest part of it.
 */
export function umbraLength(
  bodyRadiusM: number, starRadiusM: number, starDistanceM: number,
): number {
  if (starRadiusM <= bodyRadiusM) return Infinity;
  return (bodyRadiusM * starDistanceM) / (starRadiusM - bodyRadiusM);
}

/** Radius of the umbra at a distance behind the body, metres. Zero past its tip. */
export function umbraRadiusAt(
  bodyRadiusM: number, starRadiusM: number, starDistanceM: number, atM: number,
): number {
  const L = umbraLength(bodyRadiusM, starRadiusM, starDistanceM);
  if (!Number.isFinite(L)) return bodyRadiusM;
  return Math.max(0, bodyRadiusM * (1 - atM / L));
}

/**
 * Whether a moon at this orbital phase is inside its planet's shadow.
 *
 * @param phase  0 at the sub-star point (noon on the planet), pi at midnight
 * @param tiltRad how far the moon's orbit is tilted out of the shadow's plane
 */
export function inEclipse(
  m: { a: number; radiusM: number }, parentRadiusM: number,
  starRadiusM: number, starDistanceM: number, phase: number, tiltRad: number,
): boolean {
  // Only ever on the far side from the star.
  if (Math.cos(phase) > 0) return false;
  const shadow = umbraRadiusAt(parentRadiusM, starRadiusM, starDistanceM, Math.abs(m.a * Math.cos(phase)));
  if (shadow <= 0) return false;
  // How far off the shadow's axis this orbit carries it, plus how far round
  // the orbit it is from the anti-star point.
  const off = Math.hypot(m.a * Math.sin(phase), m.a * Math.sin(tiltRad));
  return off < shadow + m.radiusM;
}

/**
 * What fraction of each orbit a moon spends eclipsed, 0 to 1.
 *
 * Zero if its orbit is tilted enough to miss the shadow entirely, which is why
 * our own Moon is eclipsed twice a year rather than once a month.
 */
export function eclipsedFraction(
  m: { a: number; radiusM: number }, parentRadiusM: number,
  starRadiusM: number, starDistanceM: number, tiltRad: number,
): number {
  let hits = 0;
  const n = 2048;
  for (let i = 0; i < n; i++) {
    const p = (2 * Math.PI * (i + 0.5)) / n;
    if (inEclipse(m, parentRadiusM, starRadiusM, starDistanceM, p, tiltRad)) hits++;
  }
  return hits / n;
}

/**
 * The synodic period of two bodies: how long between one lining up with the
 * other and doing it again.
 */
export function synodicPeriod(pA: number, pB: number): number {
  const d = Math.abs(1 / pA - 1 / pB);
  return d < 1e-30 ? Infinity : 1 / d;
}

// ---------------------------------------------------------------------------
// Picking one
// ---------------------------------------------------------------------------

/**
 * Which moon of a planet is worth standing on.
 *
 * Big enough to have settled into a sphere and to hold you down, far enough
 * out that the radiation is survivable in principle, and close enough that the
 * planet is enormous overhead - which is the whole reason for going. Ties go
 * to the one with the biggest planet in its sky.
 */
export function bestMoon(p: Planet, starLsun = 1): number {
  if (!p.moons.length) return -1;
  let best = -1, score = -Infinity;
  for (let i = 0; i < p.moons.length; i++) {
    const m = p.moons[i];
    // Below about four hundred kilometres a body is not round and not a place.
    const round = m.radiusM > 3e5 ? 2 : m.radiusM > 1.5e5 ? 0.5 : -3;
    const sky = parentAngularRadius(p.radiusM, m.a) * (180 / Math.PI);
    // Air counts for more than anything else. One moon in the solar system has
    // any, and standing on it is a different experience from standing on the
    // other hundred and fifty - there is weather, a sky with a colour, and a
    // horizon you cannot see to.
    const flux = tidalHeatFlux(m.radiusM, m.a, Math.max(m.e, 0.0015), p.massKg);
    const t = moonTemperature(starLsun, p.au, m.albedo, flux);
    const air = retainsAtmosphere(m.massKg, m.radiusM, t, m.icy,
      m.a / Math.max(p.radiusM, 1));
    const s = round + Math.log10(Math.max(m.radiusM, 1e4)) + Math.min(3, sky / 4)
      + (air ? 2.5 : 0) + (m.icy ? 0.4 : 0) + (m.tidallyHeated ? 0.6 : 0);
    if (s > score) { score = s; best = i; }
  }
  return best;
}

export { R_SUN, R_EARTH, M_SUN, AU, YEAR, K_B, M_PROTON, radiusFromMass };
export type { Moon, Planet, Ring };
