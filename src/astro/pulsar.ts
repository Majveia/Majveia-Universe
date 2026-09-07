/**
 * Pulsars: the lighthouse at the end of a massive star.
 *
 * A star above about eight solar masses does not blow its envelope off gently.
 * Its core collapses in about a second from the size of the Earth to the size
 * of a city, and what stops the collapse is neutron degeneracy - a sphere
 * twelve kilometres across holding one and a half suns, at the density of an
 * atomic nucleus. A teaspoon of it weighs a billion tonnes.
 *
 * Two things are conserved through that collapse and both are conserved
 * absurdly well. Angular momentum: a core turning once a month arrives turning
 * a hundred times a second. And magnetic flux: a field of a hundred gauss,
 * squeezed by a factor of ten thousand in radius, arrives at a trillion. The
 * result is a magnet the size of a city spinning at aircraft-propeller speeds,
 * and a rotating magnet radiates.
 *
 * Almost everything below follows from that one fact. The star is braked by its
 * own radiation, so it slows; the rate at which it slows measures the field it
 * cannot otherwise be seen to have; how long it has been slowing measures its
 * age; and when the field and the spin between them can no longer make pairs
 * above the polar cap, the beam switches off and the star goes dark forever.
 *
 * The one relation everything hangs on:
 *
 *     B = 3.2e19 sqrt(P Pdot) gauss
 *
 * which is nothing but the vacuum dipole formula rearranged, and which is how
 * every magnetic field in this file - and every one in the catalogues - is
 * actually known. Nobody has measured a neutron star's field directly.
 *
 * The vacuum dipole is also known to be wrong, and known exactly how wrong: it
 * predicts a braking index of three, and the four pulsars whose braking index
 * has been measured give 2.5, 2.8, 2.0 and 1.4. A real pulsar is not in a
 * vacuum - it is inside a magnetosphere of its own making, and the wind that
 * magnetosphere blows carries away angular momentum the vacuum formula knows
 * nothing about. That discrepancy is not noise; it is the subject.
 */

/** Speed of light, cm/s - this file works in cgs, because gauss do. */
const C_CGS = 2.99792458e10;
/** Canonical neutron star radius, cm. Ten kilometres, by convention. */
export const NS_RADIUS_CM = 1e6;
/** Canonical moment of inertia, g cm^2. */
export const NS_INERTIA = 1e45;
/** Canonical mass, solar. */
export const NS_MASS_MSUN = 1.4;

/**
 * The braking constant: P Pdot = BRAKING * B^2, in cgs.
 *
 * From equating the rotational energy a star is losing to the power a rotating
 * magnetic dipole radiates. Everything else in the file is this, rearranged.
 */
export const BRAKING = (8 * Math.PI ** 2 * NS_RADIUS_CM ** 6) / (3 * C_CGS ** 3 * NS_INERTIA);

export interface Pulsar {
  /** Spin period, seconds. */
  periodS: number;
  /** How fast the period is lengthening, seconds per second. */
  pdot: number;
  /** Surface magnetic field, gauss - inferred, never measured. */
  fieldG: number;
  /** Angle between the magnetic and spin axes, radians. */
  obliquity: number;
  /** Whether the beam is still switched on. */
  alive: boolean;
  /** True age, years, where it is known. */
  ageYears: number;
  /** Distance, parsecs - used for the dispersion measure. */
  distancePc: number;
  name?: string;
}

/**
 * The magnetic field, from the period and how fast it is lengthening.
 *
 * This single relation is how every neutron star field in the literature is
 * known. The Crab's period is 33 milliseconds and lengthens by 4.2e-13 seconds
 * every second; put those in and four trillion gauss comes out, which is the
 * number in the catalogues.
 */
export function fieldFromSpin(periodS: number, pdot: number): number {
  return Math.sqrt(Math.max(periodS * pdot, 0) / BRAKING);
}

/** How fast a field of a given strength brakes a given spin. */
export function pdotFromField(periodS: number, fieldG: number): number {
  return (BRAKING * fieldG * fieldG) / Math.max(periodS, 1e-6);
}

/**
 * The characteristic age: how long the star would have taken to slow to this
 * period, had it been born spinning infinitely fast and braked as a vacuum
 * dipole ever since.
 *
 * Both assumptions are false, so it is an estimate and not a measurement - but
 * it is usually the only age there is. Where the true age *is* known, from a
 * supernova the Chinese wrote down, the two can be compared: the Crab exploded
 * in 1054 and its characteristic age is about thirteen centuries. Thirty per
 * cent out, in the direction the assumptions predict.
 */
export function characteristicAgeYears(p: Pulsar): number {
  if (p.pdot <= 0) return Infinity;
  return p.periodS / (2 * p.pdot) / 3.15576e7;
}

/**
 * Spin-down luminosity, erg/s: the rate at which rotational energy is being
 * lost. For the Crab it is 4.5e38 - a hundred thousand times the Sun's output,
 * and it is what lights the whole nebula around it. That nebula has no star
 * heating it; it shines on the rotational energy of the corpse at its centre.
 */
export function spinDownPower(p: Pulsar): number {
  return (4 * Math.PI ** 2 * NS_INERTIA * p.pdot) / p.periodS ** 3;
}

/** Rotational energy currently stored, erg. */
export function rotationalEnergy(periodS: number): number {
  const omega = (2 * Math.PI) / periodS;
  return 0.5 * NS_INERTIA * omega * omega;
}

/**
 * The light cylinder: the radius at which a point co-rotating with the star
 * would be moving at the speed of light, cm.
 *
 * Nothing can co-rotate beyond it, so this is where the magnetosphere has to
 * end and where the field lines are torn open. Everything a pulsar does that
 * can be seen from Earth happens because of that boundary.
 */
export function lightCylinderCm(periodS: number): number {
  return (C_CGS * periodS) / (2 * Math.PI);
}

/**
 * Half-angle of the polar cap, radians: the patch of the surface whose field
 * lines reach past the light cylinder instead of closing.
 *
 * It is tiny. On the Crab it is four and a half degrees, a few hundred metres
 * across, and the entire radio beam comes out of it.
 */
export function polarCapAngle(periodS: number): number {
  return Math.asin(Math.min(1, Math.sqrt(NS_RADIUS_CM / lightCylinderCm(periodS))));
}

/**
 * Half-width of the emission beam, radians.
 *
 * Empirical, from the widths of measured pulse profiles (Rankin 1993): about
 * five and a half degrees divided by the square root of the period. A slow
 * pulsar has a narrow pencil beam and a fast one has a wide fan, which is why
 * millisecond pulsars are seen from a much larger fraction of the sky.
 */
export function beamAngle(periodS: number): number {
  // Capped, because the relation is fitted to normal pulsars and extrapolating
  // it to a millisecond period gives a beam wider than the sky. What the fast
  // ones really have is a duty cycle approaching a half, which this reaches
  // and does not exceed.
  return Math.min(Math.PI / 3, (5.4 * Math.PI) / 180 / Math.sqrt(Math.max(periodS, 1e-4)));
}

/**
 * What fraction of the sky the two beams sweep - and so the chance that any
 * given pulsar points at us at all.
 *
 * About a fifth for a normal pulsar. Which means that for every pulsar in the
 * catalogues there are four more out there, beaming at somebody else.
 */
export function beamingFraction(p: Pulsar): number {
  const rho = beamAngle(p.periodS);
  const alpha = p.obliquity;
  // The solid angle swept by two cones of half-width rho, whose axes are at
  // alpha to the spin axis, as the star turns.
  const f = Math.sin(alpha) * Math.sin(rho);
  return Math.min(1, Math.max(0.02, 2 * f + (1 - Math.cos(rho)) * 0.5));
}

/**
 * Whether a pulsar is still switched on.
 *
 * The radio emission is powered by electron-positron pairs made in the electric
 * field above the polar cap, and that field weakens as the star slows. Below
 * roughly B/P^2 = 1.7e11 gauss per second squared there are no pairs, no
 * cascade, and no beam - the star is still there, still spinning, and
 * completely invisible. Almost every neutron star ever formed is on the far
 * side of that line; the thousands in the catalogues are the young ones.
 */
export const DEATH_LINE = 1.7e11;

export function isAlive(periodS: number, fieldG: number): boolean {
  return fieldG / (periodS * periodS) > DEATH_LINE;
}

/**
 * The period after a given time, for a star braking as a vacuum dipole with a
 * constant field.
 *
 * P Pdot is a constant, so P squared grows linearly with time. That is the
 * whole of pulsar evolution in one line, and it is why the population drifts
 * to the right across the period-period-derivative plane and piles up against
 * the death line.
 */
export function periodAfter(p0S: number, fieldG: number, seconds: number): number {
  return Math.sqrt(p0S * p0S + 2 * BRAKING * fieldG * fieldG * Math.max(seconds, 0));
}

/**
 * The dispersion delay between two frequencies, seconds.
 *
 * A pulse leaves the star at every frequency at once and arrives spread over
 * seconds, because the free electrons between here and there slow the low
 * frequencies more. The delay is proportional to the number of electrons along
 * the line of sight - the dispersion measure - and that is how the distance to
 * a pulsar is known, and how the free electron content of the Galaxy was
 * mapped in the first place. It is also how the first fast radio burst was
 * recognised as extragalactic.
 *
 * @param dm  dispersion measure, pc cm^-3
 * @param f1  lower frequency, MHz
 * @param f2  upper frequency, MHz
 */
export function dispersionDelay(dm: number, f1: number, f2: number): number {
  return 4.148808e3 * dm * (1 / (f1 * f1) - 1 / (f2 * f2));
}

/**
 * A rough dispersion measure for a pulsar at a given distance in the Galactic
 * disc: the mean free electron density near the plane is about 0.03 per cubic
 * centimetre, so a kiloparsec is a dispersion measure of about thirty.
 */
export function dispersionMeasure(distancePc: number): number {
  return 0.03 * distancePc;
}

/**
 * Surface gravity, cm/s^2, and what it means.
 *
 * Two hundred billion times the Earth's. A pebble dropped from a metre hits the
 * surface at about two thousand kilometres a second, and the tallest mountain a
 * neutron star can hold up is a few millimetres.
 */
export function surfaceGravity(massMsun = NS_MASS_MSUN): number {
  const GM = 6.6743e-8 * massMsun * 1.98847e33;
  return GM / (NS_RADIUS_CM * NS_RADIUS_CM);
}

/** Mean density, g/cm^3 - the density of an atomic nucleus. */
export function meanDensity(massMsun = NS_MASS_MSUN): number {
  const m = massMsun * 1.98847e33;
  return m / ((4 / 3) * Math.PI * NS_RADIUS_CM ** 3);
}

/**
 * The equatorial speed of the surface, as a fraction of light speed.
 *
 * For the fastest known millisecond pulsar, spinning 716 times a second, the
 * equator is moving at about a quarter of the speed of light - and the star is
 * held together only because its own gravity is stronger still.
 */
export function surfaceBeta(periodS: number): number {
  return ((2 * Math.PI * NS_RADIUS_CM) / periodS) / C_CGS;
}

/**
 * How fast the star can possibly spin before it flies apart: the period at
 * which the equator's centrifugal acceleration equals the surface gravity.
 * About half a millisecond, which is why nothing faster has ever been found.
 */
export function breakUpPeriodS(massMsun = NS_MASS_MSUN): number {
  return 2 * Math.PI * Math.sqrt(NS_RADIUS_CM / surfaceGravity(massMsun));
}

export interface PulsarClass {
  kind: 'young' | 'normal' | 'millisecond' | 'magnetar' | 'dead';
  label: string;
}

/**
 * Which of the families a pulsar belongs to.
 *
 * The period-period-derivative plane is the neutron star's Hertzsprung-Russell
 * diagram, and it has the same property: the objects do not fill it. They lie
 * in two clumps with a gulf between, and the gulf is not an observational
 * selection - it is a fossil of how the second clump was made. Millisecond
 * pulsars are old, dead pulsars that were spun back up by material falling from
 * a companion star, which is why they are the only ones that are nearly always
 * in binaries, and why their fields are four orders of magnitude weaker: a
 * hundred million years of accretion buries them.
 */
export function classify(p: Pulsar): PulsarClass {
  if (!p.alive) return { kind: 'dead', label: 'past the death line' };
  if (p.fieldG > 4.4e13) return { kind: 'magnetar', label: 'magnetar' };
  if (p.periodS < 0.03 && p.pdot < 1e-17) {
    return { kind: 'millisecond', label: 'recycled millisecond pulsar' };
  }
  if (characteristicAgeYears(p) < 1e5) return { kind: 'young', label: 'young pulsar' };
  return { kind: 'normal', label: 'pulsar' };
}

/** Build a pulsar from a period and a field, filling in what follows. */
export function pulsar(
  periodS: number, fieldG: number,
  opts: { obliquity?: number; ageYears?: number; distancePc?: number; name?: string } = {},
): Pulsar {
  const pdot = pdotFromField(periodS, fieldG);
  const p: Pulsar = {
    periodS,
    pdot,
    fieldG,
    obliquity: opts.obliquity ?? Math.PI / 3,
    alive: isAlive(periodS, fieldG),
    ageYears: opts.ageYears ?? 0,
    distancePc: opts.distancePc ?? 1000,
    name: opts.name,
  };
  if (!p.ageYears) p.ageYears = characteristicAgeYears(p);
  return p;
}

/**
 * A population, born and aged.
 *
 * Normal pulsars are born spinning tens of times a second with fields around a
 * few times 10^12 gauss, and slow down; recycled ones are the survivors of
 * that, spun back up by material falling from a companion over a hundred
 * million years, which both accelerates them to milliseconds and buries their
 * fields by four orders of magnitude.
 *
 * Drawing both and letting them age is what makes the period-period-derivative
 * plane come out bimodal, with a gulf between the two clumps. The gulf is not
 * an observational selection - nothing is being hidden in it. It is a fossil of
 * the fact that there are two ways to make a pulsar and nothing in between.
 *
 * @param rng  anything that returns uniform numbers in [0, 1)
 */
export function population(
  n: number, rng: () => number,
): Pulsar[] {
  const out: Pulsar[] = [];
  // A normal distribution from two uniforms, for the field, which is
  // log-normal in every survey ever done.
  const gauss = () => {
    const u = Math.max(rng(), 1e-9);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  };
  for (let i = 0; i < n; i++) {
    // About one pulsar in eight in the catalogues has been recycled.
    const recycled = rng() < 0.13;
    if (recycled) {
      const b = Math.pow(10, 8.4 + 0.45 * gauss());
      // Spun up to near the equilibrium period accretion can sustain, then
      // left to slow again for a good fraction of the age of the Galaxy.
      const p0 = 0.0013 * Math.pow(b / 1e8, 6 / 7) * (0.7 + 0.9 * rng());
      const ageS = Math.pow(10, 8 + 2 * rng()) * 3.15576e7;
      const p = periodAfter(p0, b, ageS);
      out.push(pulsar(p, b, {
        obliquity: Math.acos(1 - rng()),
        ageYears: ageS / 3.15576e7,
        distancePc: 200 + 4000 * rng(),
      }));
    } else {
      const b = Math.pow(10, 12.4 + 0.5 * gauss());
      const p0 = 0.02 + 0.28 * rng();
      // Flat in the logarithm of age, from a thousand years to a few hundred
      // million - which is where the radio lifetime ends. A survey finds
      // pulsars of every age in that range, and the young ones are rare only
      // because youth is short. What it never finds is the enormous population
      // beyond it: for every pulsar in the catalogues the Galaxy holds of
      // order a million dark neutron stars that stopped beaming long ago.
      const ageS = Math.pow(10, 3 + 5.6 * rng()) * 3.15576e7;
      const p = periodAfter(p0, b, ageS);
      out.push(pulsar(p, b, {
        obliquity: Math.acos(1 - rng()),
        ageYears: ageS / 3.15576e7,
        distancePc: 200 + 6000 * rng(),
      }));
    }
  }
  return out;
}

/**
 * Four pulsars whose numbers are measured rather than modelled, for the same
 * reason the Solar System is in here: something has to be the check on
 * everything else.
 */
export const MEASURED: { name: string; periodS: number; pdot: number; note: string }[] = [
  {
    name: 'Crab (PSR B0531+21)', periodS: 0.0333924, pdot: 4.209e-13,
    note: 'the supernova of 1054, written down in China and Japan; its true age '
      + 'is known to the year, and is the only real check on a characteristic age',
  },
  {
    name: 'Vela (PSR B0833-45)', periodS: 0.0893, pdot: 1.25e-13,
    note: 'eleven thousand years old, and the first pulsar seen to glitch: it '
      + 'occasionally speeds up, which is the crust catching on the superfluid inside',
  },
  {
    name: 'PSR B1919+21', periodS: 1.3373, pdot: 1.348e-15,
    note: 'the first one found, in 1967, and briefly catalogued LGM-1 while '
      + 'nobody could think of a natural thing that kept time that well',
  },
  {
    name: 'PSR B1937+21', periodS: 0.00155780644887275, pdot: 1.051e-19,
    note: 'six hundred and forty-two turns a second: its equator moves at a '
      + 'seventh of the speed of light, and it was the fastest thing known for '
      + 'a quarter of a century',
  },
];
