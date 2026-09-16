/**
 * How long things take, and why it is the same question as how big they are.
 *
 * The simulation already has one axis that every scale shares: length, forty-
 * three decades of it along the bottom of the window. This is the other one.
 *
 * Every object has two clocks. The first is not really its own - it is the
 * time light takes to cross it, `size / c`, which is the shortest interval in
 * which one side of the thing can learn anything about the other. Nothing an
 * object does can be faster than that, so it is a floor rather than a rate.
 * The second is the time the object actually takes to do the thing it does:
 * go round once, fall in, ring, turn. That is `size / v`, where v is whatever
 * moves there - an orbital speed, the speed of sound in a crystal, an
 * electron, a nucleon.
 *
 * Divide one by the other and the size cancels:
 *
 *     own clock / light clock  =  c / v
 *
 * So the distance between an object's two clocks, measured in decades on a
 * logarithmic axis, is `log10(c/v)` and nothing else. It says how relativistic
 * the thing is, and it says it for a galaxy cluster and a quartz cell in the
 * same units.
 *
 * For anything held together by gravity, v is the orbital speed at its own
 * surface, and then
 *
 *     c / v = sqrt( 2R / r_s )
 *
 * where r_s is the thing's Schwarzschild radius - so the gap between the two
 * clocks is the square root of how far the object is from being a black hole.
 * That is exact, not an estimate, and at a horizon it comes out at root two.
 * It closes only where gravity turns relativistic, and on the whole ladder
 * there are exactly two places where it closes: a horizon, and the universe as
 * a whole, where the Hubble length recedes at exactly c and the two clocks are
 * the same clock.
 *
 * Below the waterline gravity is irrelevant and the speeds come from
 * electromagnetism and the strong force instead, but the rule survives intact.
 * In a crystal v is the speed of sound and the gap is c/v_s. In an atom v is
 * the electron's, which for hydrogen is alpha*c, so the gap there is
 * 1/alpha = 137.036 exactly; heavier atoms are screened and sit in higher
 * shells, which moves it but does not change where it came from. In a nucleus
 * v is the Fermi speed, about 0.27c, and the gap is nearly closed.
 *
 * Which gives the ladder a shape it did not obviously have: the gap is widest
 * in the middle, at the scales we live on, and closes at both ends. The fast
 * parts of the universe are the very largest and the very smallest, and
 * everything in between - planets, us, rocks - is the slow part.
 */

import { C, G, H_PLANCK, K_B, MPC, YEAR } from '../core/constants';
import { FINE_STRUCTURE } from './atom';

/**
 * A place's two clocks, expressed as the only two numbers they need.
 *
 * Storing the size and the speed rather than the two times is deliberate: the
 * whole point is that both times are that one size divided by a speed, and a
 * structure that held `light` and `own` as independent fields could hold a
 * pair that no object could actually have.
 */
export interface Clock {
  /** The length that sets both times, metres. */
  size: number;
  /** How fast whatever moves here moves, m/s. */
  speed: number;
  /** What moves - one or two words, for the readout. */
  what: string;
}

/** Light-crossing time: the floor, seconds. */
export const lightTime = (k: Clock): number => k.size / C;

/** The time the thing itself takes, seconds. */
export const ownTime = (k: Clock): number => k.size / k.speed;

/**
 * How many times longer the object's own clock is than its light clock.
 *
 * The size cancels, so this is c/v and nothing else - which is why two things
 * forty decades apart in size can have the same gap, and why the number is
 * worth putting on the screen.
 */
export const clockGap = (k: Clock): number => C / k.speed;

/** The gap in decades, which is the distance between the two marks on the axis. */
export const gapDecades = (k: Clock): number => Math.log10(clockGap(k));

/** Speed as a fraction of light, which is the same statement upside down. */
export const beta = (k: Clock): number => k.speed / C;

// ---------------------------------------------------------------------------
// Gravity
// ---------------------------------------------------------------------------

/** Circular orbital speed at radius r around mass M, m/s. */
export const orbitSpeed = (massKg: number, radiusM: number): number =>
  Math.sqrt((G * massKg) / radiusM);

/**
 * The clock of anything gravity holds together.
 *
 * `size/speed` is sqrt(r^3/GM), the inverse mean motion - a radian of orbit
 * rather than a whole one. The full period is 2*pi of these, and the factor is
 * left out on purpose: a radian is the time in which the system actually
 * changes, and it is the quantity that free fall, orbit and collapse all agree
 * on to within a small number.
 */
export const gravitating = (massKg: number, radiusM: number, what = 'orbit'): Clock => ({
  size: radiusM,
  speed: orbitSpeed(massKg, radiusM),
  what,
});

/** Schwarzschild radius, m. Duplicated from constants so this module stands alone. */
export const schwarzschild = (massKg: number): number => (2 * G * massKg) / (C * C);

/** r_s / R: how close a thing is to being a black hole. 1 at the horizon. */
export const compactness = (massKg: number, radiusM: number): number =>
  schwarzschild(massKg) / radiusM;

/**
 * Free-fall time of a uniform sphere of density rho, seconds.
 *
 *     t_ff = sqrt( 3*pi / (32 G rho) )
 *
 * Every mass in it arrives at the centre simultaneously, and the answer
 * depends on nothing but the density - not on the size, not on the mass. This
 * is the deepest thing in the file: it is why a galaxy, a star and a cloud of
 * gas at the same density collapse in the same time, and why the number below
 * for the universe comes out to within a factor of two of its own age.
 */
export const freeFallTime = (densityKgM3: number): number =>
  Math.sqrt((3 * Math.PI) / (32 * G * densityKgM3));

/**
 * Period of a circular orbit skimming the surface of a body of mean density
 * rho, seconds - and again a function of density alone.
 *
 * For Earth's 5514 kg/m^3 it is eighty-four minutes, which is the period of
 * low Earth orbit, the period of a pendulum swung through a hole bored
 * straight through the planet, and the period every inertial navigation system
 * is tuned to so that its errors oscillate instead of growing. It would be the
 * same eighty-four minutes for a pebble of the same density and for a world
 * the size of the Sun.
 */
export const surfaceOrbitPeriod = (densityKgM3: number): number =>
  Math.sqrt((3 * Math.PI) / (G * densityKgM3));

/** Mean density of a sphere, kg/m^3. */
export const meanDensity = (massKg: number, radiusM: number): number =>
  massKg / ((4 / 3) * Math.PI * radiusM * radiusM * radiusM);

// ---------------------------------------------------------------------------
// The universe
// ---------------------------------------------------------------------------

/**
 * The clock of the expanding universe itself.
 *
 * Its size is the Hubble length c/H, and what moves at that distance is the
 * expansion, which is receding at exactly c - that is what the Hubble length
 * means. So the speed is c, the gap is 1, and the two clocks coincide: the
 * universe is the one object on the ladder whose own clock *is* its light
 * clock, and its value is the Hubble time.
 */
export const expanding = (hubbleSI: number): Clock => ({
  size: C / hubbleSI,
  speed: C,
  what: 'expansion',
});

// ---------------------------------------------------------------------------
// Matter, below the waterline
// ---------------------------------------------------------------------------

/**
 * The clock of a crystal: one cell, crossed at the speed of sound.
 *
 * Sound is how a lattice tells one end of itself about the other, so this is
 * the same construction as the light clock with the relevant signal speed
 * substituted, and the gap is c/v_s - about sixty thousand for rock.
 */
export const latticeClock = (spacingM: number, soundSpeedMs: number): Clock => ({
  size: spacingM,
  speed: soundSpeedMs,
  what: 'sound',
});

/**
 * Debye period, seconds: h / (k_B * theta_D).
 *
 * The shortest vibration the lattice supports - one cell against the next,
 * exactly out of phase, at the edge of the Brillouin zone. Diamond's 2230 K
 * gives 22 fs; lead's 105 K gives 460. Within a factor of about two it is the
 * cell crossed at the speed of sound, which is the check kept in the tests.
 */
export const debyePeriod = (debyeK: number): number => H_PLANCK / (K_B * debyeK);

/**
 * The clock of an atom: its radius, crossed at the speed its electrons move.
 *
 * For hydrogen that speed is alpha*c and the radius is the Bohr radius, so the
 * own clock comes out at a0/(alpha c) = hbar/E_h = 24.19 attoseconds - the
 * atomic unit of time, which is not a coincidence but the definition arriving
 * from the other direction. The gap is 1/alpha = 137.036, the plainest
 * appearance the fine structure constant makes anywhere in this simulation.
 */
export const atomClock = (radiusM: number, zEff: number, n = 1): Clock => ({
  size: radiusM,
  // Bohr's v_n = Z_eff alpha c / n. The shell matters: silicon's outermost
  // electron is in n = 3 and feels 4.15 protons through the screening, so it
  // goes round three times slower than the ratio of charges alone would say.
  speed: (zEff * FINE_STRUCTURE * C) / Math.max(1, n),
  what: 'electron',
});

/**
 * The clock of a nucleus: its radius, crossed by a nucleon at the Fermi speed.
 *
 * About 0.27c, so the gap here is under four - the nucleus is the one place on
 * the ladder below the horizon scale where matter is genuinely relativistic,
 * and the two clocks nearly touch.
 */
export const nucleusClock = (radiusM: number, fermiSpeedMs: number): Clock => ({
  size: radiusM,
  speed: fermiSpeedMs,
  what: 'nucleons',
});

// ---------------------------------------------------------------------------
// Landmarks
// ---------------------------------------------------------------------------

export interface Duration {
  /** Seconds. */
  s: number;
  label: string;
  /** Drawn with a longer notch and always labelled. */
  major?: boolean;
}

/**
 * Real durations, for anchors on the time axis.
 *
 * These are the marks the length axis has no counterpart for: things that
 * *take* this long rather than things light crosses in this long. The
 * crossing marks come from the length landmarks divided by c and are generated
 * rather than listed, because that division is the whole point and writing the
 * results down by hand would let them drift.
 */
export const DURATIONS: Duration[] = [
  { s: 3.06e-23, label: 'a nucleus crossed', major: true },
  { s: 2.4188843e-17, label: 'an atomic unit' },
  { s: 1.0e-13, label: 'a lattice ringing' },
  { s: 1 / 44100, label: 'a sample' },
  { s: 0.0332, label: 'the Crab pulsar', major: true },
  { s: 1, label: 'a second', major: true },
  { s: 86164.0905, label: 'a day', major: true },
  { s: YEAR, label: 'a year', major: true },
  { s: 79 * YEAR, label: 'a life' },
  { s: 2.2e5 * YEAR, label: 'a galactic year', major: true },
  { s: 4.54e9 * YEAR, label: 'the Earth' },
  { s: 1.3787e10 * YEAR, label: 'the universe', major: true },
];

/**
 * Hubble time in seconds for H0 in km/s/Mpc - 14.45 Gyr at Planck's 67.66,
 * against an age of 13.79, because the expansion has not always gone at
 * today's rate.
 */
export const hubbleTimeOf = (h0KmsMpc: number): number => MPC / (h0KmsMpc * 1e3);
