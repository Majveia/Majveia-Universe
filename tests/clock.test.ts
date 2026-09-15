import { describe, expect, it } from 'vitest';
import {
  DURATIONS, atomClock, beta, clockGap, compactness, debyePeriod, expanding,
  freeFallTime, gapDecades, gravitating, hubbleTimeOf, latticeClock, lightTime,
  meanDensity, nucleusClock, orbitSpeed, ownTime, schwarzschild,
  surfaceOrbitPeriod,
} from '../src/physics/clock';
import { BOHR, FINE_STRUCTURE } from '../src/physics/atom';
import { fermiSpeed, nuclearRadius } from '../src/physics/nucleus';
import { mineral, soundSpeed, unitSpacing } from '../src/physics/crystal';
import { PLANCK18, H0si, ageToday, Hofa } from '../src/cosmology/lcdm';
import {
  AU, C, GYR, G, M_EARTH, M_SUN, R_EARTH, R_SUN, YEAR,
} from '../src/core/constants';

describe('two clocks', () => {
  it('divides out the size, so the gap is c/v and nothing else', () => {
    // The point of the whole module. Two objects thirty decades apart in size
    // with the same speed have the same gap.
    const big = { size: 1e20, speed: 2.2e5, what: 'orbit' };
    const small = { size: 1e-10, speed: 2.2e5, what: 'orbit' };
    expect(clockGap(big)).toBeCloseTo(clockGap(small), 6);
    expect(clockGap(big)).toBeCloseTo(C / 2.2e5, 6);
    expect(ownTime(big) / lightTime(big)).toBeCloseTo(clockGap(big), 6);
  });

  it('measures the gap in decades, which is what the axis draws', () => {
    const k = { size: 1, speed: C / 1000, what: 'x' };
    expect(gapDecades(k)).toBeCloseTo(3, 9);
  });

  it('closes the gap exactly when the thing moves at c', () => {
    const k = { size: 1e26, speed: C, what: 'light' };
    expect(clockGap(k)).toBeCloseTo(1, 9);
    expect(gapDecades(k)).toBeCloseTo(0, 9);
    expect(ownTime(k)).toBeCloseTo(lightTime(k), 9);
    expect(beta(k)).toBeCloseTo(1, 12);
  });
});

describe('gravity', () => {
  it('gets the orbital speed at the surface of the Earth', () => {
    // 7.905 km/s: the speed of a satellite skimming the ground, which is also
    // the speed the first stage of anything has to reach.
    expect(orbitSpeed(M_EARTH, R_EARTH)).toBeCloseTo(7905, -1);
  });

  it('puts the two clocks of the Earth four and a half decades apart', () => {
    const k = gravitating(M_EARTH, R_EARTH);
    // Light crosses an Earth radius in 21 ms; a satellite takes 806 s, which
    // is the eighty-four minute period over 2*pi.
    expect(lightTime(k)).toBeCloseTo(0.02125, 5);
    expect(ownTime(k)).toBeCloseTo(806, -1);
    expect(clockGap(k)).toBeCloseTo(37900, -2);
    expect(gapDecades(k)).toBeCloseTo(4.58, 1);
  });

  it('makes that gap the square root of how far the thing is from a horizon', () => {
    // c/v = sqrt(2R/r_s) - the cleanest statement of what the gap means, and
    // it is exact rather than approximate.
    for (const [m, r] of [[M_EARTH, R_EARTH], [M_SUN, R_SUN], [1.4 * M_SUN, 1.2e4]]) {
      const k = gravitating(m, r);
      expect(clockGap(k)).toBeCloseTo(Math.sqrt(2 / compactness(m, r)), 3);
    }
  });

  it('leaves a neutron star barely more than a decade apart, and a horizon nowhere', () => {
    // A 1.4-solar-mass star twelve kilometres across orbits at 0.4c: the gap
    // is down to a factor of two and a half, which is what "relativistic"
    // means said in time rather than in speed.
    const ns = gravitating(1.4 * M_SUN, 1.2e4);
    expect(beta(ns)).toBeGreaterThan(0.35);
    expect(beta(ns)).toBeLessThan(0.5);
    expect(gapDecades(ns)).toBeLessThan(0.5);
    // And at the Schwarzschild radius itself the Newtonian orbital speed is
    // c/sqrt(2), so the gap is sqrt(2) - as close to closed as gravity gets.
    const horizon = gravitating(M_SUN, schwarzschild(M_SUN));
    expect(clockGap(horizon)).toBeCloseTo(Math.SQRT2, 6);
  });

  it('gets the Sun right, and the gap that goes with it', () => {
    const k = gravitating(M_SUN, R_SUN);
    expect(k.speed).toBeCloseTo(4.37e5, -3);   // 437 km/s at the photosphere
    expect(lightTime(k)).toBeCloseTo(2.32, 2); // 2.3 s across a solar radius
    expect(clockGap(k)).toBeCloseTo(686, -1);
  });
});

describe('free fall, which knows only the density', () => {
  it('collapses the Earth in a quarter of an hour', () => {
    const rho = meanDensity(M_EARTH, R_EARTH);
    expect(rho).toBeCloseTo(5514, -2);
    expect(freeFallTime(rho)).toBeCloseTo(895, -1);   // 14.9 minutes
  });

  it('collapses the Sun in half an hour, which is the textbook number', () => {
    const rho = meanDensity(M_SUN, R_SUN);
    expect(rho).toBeCloseTo(1408, -2);
    expect(freeFallTime(rho)).toBeCloseTo(1770, -2);
  });

  it('does not care about the size at all, only the density', () => {
    // A pebble of Earth's density and a world the size of the Sun made of it
    // collapse in the same fifteen minutes. This is the whole content of the
    // formula and it is worth pinning.
    const rho = meanDensity(M_EARTH, R_EARTH);
    const pebble = meanDensity(rho * (4 / 3) * Math.PI * 1e-3, 0.1);
    expect(freeFallTime(pebble)).toBeCloseTo(freeFallTime(rho), 6);
  });

  it('gives eighty-four minutes for a low orbit round anything Earth-density', () => {
    // The Schuler period. Low Earth orbit, a pendulum down a hole through the
    // planet, and the tuning of every inertial navigation system ever built.
    const rho = meanDensity(M_EARTH, R_EARTH);
    // 84.35 rather than the 84.4 usually quoted, because that number is taken
    // at the equatorial radius and this simulation runs on the volumetric mean.
    expect(surfaceOrbitPeriod(rho) / 60).toBeCloseTo(84.35, 1);
    // And it really is the orbit: the period is 2*pi times the radian clock.
    const k = gravitating(M_EARTH, R_EARTH);
    expect(surfaceOrbitPeriod(rho)).toBeCloseTo(2 * Math.PI * ownTime(k), 3);
  });

  it('is sqrt(32) times shorter than the orbit it belongs to', () => {
    const rho = 3000;
    expect(surfaceOrbitPeriod(rho) / freeFallTime(rho)).toBeCloseTo(Math.sqrt(32), 9);
  });

  it('gives the Moon a longer low orbit than the Earth, because it is lighter for its size', () => {
    const moon = meanDensity(7.342e22, 1.7374e6);
    expect(moon).toBeCloseTo(3344, -2);
    expect(surfaceOrbitPeriod(moon) / 60).toBeCloseTo(108, 0);
  });
});

describe('the universe', () => {
  it('is the one thing whose own clock is its light clock', () => {
    const k = expanding(H0si(PLANCK18));
    expect(clockGap(k)).toBeCloseTo(1, 12);
    expect(ownTime(k)).toBeCloseTo(lightTime(k), 6);
    // And that shared value is the Hubble time: 14.45 Gyr at Planck's H0.
    expect(ownTime(k) / GYR).toBeCloseTo(14.45, 1);
  });

  it('runs faster in the past, so the gap stays shut while the clock speeds up', () => {
    const now = expanding(H0si(PLANCK18));
    const then = expanding(Hofa(PLANCK18, 1 / 11));   // z = 10
    expect(ownTime(then)).toBeLessThan(ownTime(now) / 10);
    expect(clockGap(then)).toBeCloseTo(1, 12);
  });

  it('has a Hubble time longer than its own age, because it has not always gone this fast', () => {
    expect(hubbleTimeOf(PLANCK18.H0) / GYR).toBeCloseTo(14.45, 1);
    expect(hubbleTimeOf(PLANCK18.H0) / GYR).toBeGreaterThan(ageToday(PLANCK18));
  });

  it('would collapse at its own critical density in exactly pi/2 Hubble times', () => {
    // A closed-form coincidence that is not a coincidence: t_ff = sqrt(3pi/32Grho)
    // and 1/H = sqrt(3/8piGrho_c) differ by exactly pi/2, so the universe's
    // free-fall time is 22.7 Gyr against a Hubble time of 14.45. The age of the
    // universe and the time it would take to fall in on itself are the same
    // number to within a factor of two, and this is why.
    const H = H0si(PLANCK18);
    const rhoCrit = (3 * H * H) / (8 * Math.PI * G);
    expect(freeFallTime(rhoCrit) * H).toBeCloseTo(Math.PI / 2, 9);
    expect(freeFallTime(rhoCrit) / GYR).toBeCloseTo(22.7, 0);
  });
});

describe('below the waterline the rule survives', () => {
  it('gives a crystal the speed of sound, and a gap of about sixty thousand', () => {
    const q = mineral('quartz');
    const k = latticeClock(unitSpacing(q), soundSpeed(q));
    expect(k.speed).toBeGreaterThan(3000);
    expect(k.speed).toBeLessThan(7000);
    expect(gapDecades(k)).toBeGreaterThan(4.5);
    expect(gapDecades(k)).toBeLessThan(5.2);
  });

  it('agrees with the Debye period to within a factor of about two', () => {
    // Two independent routes to the same fact - the cell crossed at the speed
    // of sound, and h/k_B theta_D - so if either drifts this notices.
    for (const key of ['quartz', 'iron', 'periclase', 'ice']) {
      const m = mineral(key);
      const crossing = ownTime(latticeClock(unitSpacing(m), soundSpeed(m)));
      const debye = debyePeriod(m.debyeK);
      expect(debye / crossing, key).toBeGreaterThan(0.5);
      expect(debye / crossing, key).toBeLessThan(6);
    }
  });

  it('gets the Debye periods of diamond and lead', () => {
    expect(debyePeriod(2230) * 1e15).toBeCloseTo(21.5, 0);   // 22 fs
    expect(debyePeriod(105) * 1e15).toBeCloseTo(457, -1);    // 460 fs
  });

  it('makes the atom the atomic unit of time, and its gap exactly 1/alpha', () => {
    const k = atomClock(BOHR, 1);
    // a0/(alpha c) = hbar/E_h = 24.188843 as, which is the atomic unit of time
    // arriving from the other direction rather than being put in by hand.
    expect(ownTime(k) * 1e18).toBeCloseTo(24.1888, 3);
    expect(clockGap(k)).toBeCloseTo(1 / FINE_STRUCTURE, 6);
    expect(clockGap(k)).toBeCloseTo(137.036, 2);
    // The whole 1s orbit is 2*pi of those: 152 attoseconds.
    expect(2 * Math.PI * ownTime(k) * 1e18).toBeCloseTo(152.0, 0);
  });

  it('speeds the electron up with Z, and closes the gap as it goes', () => {
    // A 1s electron in gold is at 0.58c, which is why gold is yellow and
    // mercury is a liquid - and here it shows up as a gap of under two.
    expect(clockGap(atomClock(BOHR, 79))).toBeCloseTo(137.036 / 79, 2);
    expect(beta(atomClock(BOHR, 79))).toBeCloseTo(0.577, 2);
  });

  it('leaves the nucleus a factor of four from closed', () => {
    const k = nucleusClock(nuclearRadius(56), fermiSpeed(56));
    expect(beta(k)).toBeGreaterThan(0.2);
    expect(beta(k)).toBeLessThan(0.32);
    expect(gapDecades(k)).toBeLessThan(0.7);
    // Light crosses an iron nucleus in 1.43e-23 s; the nucleons take 5.3e-23.
    expect(lightTime(k)).toBeCloseTo(1.43e-23, 24);
    expect(ownTime(k)).toBeLessThan(1e-22);
  });
});

describe('the shape of the ladder', () => {
  it('is widest in the middle and closes at both ends', () => {
    // The observation the axis exists to make. Nothing on the ladder is
    // further from the speed of light than the ground we stand on.
    const cosmos = gapDecades(expanding(H0si(PLANCK18)));
    const world = gapDecades(gravitating(M_EARTH, R_EARTH));
    const nucleus = gapDecades(nucleusClock(nuclearRadius(56), fermiSpeed(56)));
    expect(cosmos).toBeLessThan(world);
    expect(nucleus).toBeLessThan(world);
    expect(cosmos).toBeCloseTo(0, 9);
    expect(world).toBeGreaterThan(4);
  });

  it('never has a negative gap: nothing beats light to its own far side', () => {
    const q = mineral('quartz');
    const all = [
      expanding(H0si(PLANCK18)),
      gravitating(1e15 * M_SUN, 2 * 3.0857e22),
      gravitating(1e12 * M_SUN, 15 * 3.0857e19),
      gravitating(M_SUN, AU),
      gravitating(M_EARTH, R_EARTH),
      latticeClock(unitSpacing(q), soundSpeed(q)),
      atomClock(BOHR, 1),
      nucleusClock(nuclearRadius(56), fermiSpeed(56)),
    ];
    for (const k of all) {
      expect(gapDecades(k)).toBeGreaterThanOrEqual(0);
      expect(beta(k)).toBeLessThanOrEqual(1);
      expect(ownTime(k)).toBeGreaterThanOrEqual(lightTime(k) * (1 - 1e-12));
    }
  });

  it('gives an Earth year as the orbit at one AU', () => {
    // The system rung's clock, checked against the only year anybody knows.
    const k = gravitating(M_SUN, AU);
    expect(2 * Math.PI * ownTime(k) / YEAR).toBeCloseTo(1, 2);
    expect(k.speed).toBeCloseTo(29800, -3);
  });
});

describe('the durations on the axis', () => {
  it('are in order and spread out enough to read', () => {
    for (let i = 1; i < DURATIONS.length; i++) {
      expect(DURATIONS[i].s, DURATIONS[i].label).toBeGreaterThan(DURATIONS[i - 1].s);
      expect(Math.log10(DURATIONS[i].s / DURATIONS[i - 1].s)).toBeGreaterThan(0.2);
    }
  });

  it('are the durations those things really have', () => {
    const at = (label: string): number => {
      const d = DURATIONS.find((x) => x.label === label);
      if (!d) throw new Error(`no duration ${label}`);
      return d.s;
    };
    expect(at('a year')).toBeCloseTo(YEAR, 0);
    expect(at('a day') / 86164.0905).toBeCloseTo(1, 6);     // sidereal, not solar
    expect(at('the universe') / GYR).toBeCloseTo(13.787, 2);
    expect(at('the Crab pulsar')).toBeCloseTo(0.0332, 4);   // its measured period
    expect(at('an atomic unit') * 1e18).toBeCloseTo(24.1888, 3);
    expect(at('the Earth') / GYR).toBeCloseTo(4.54, 2);
  });

  it('spans the same range the length axis does, once divided by c', () => {
    // Nothing on it can fall off either end of a ruler that runs from
    // 1e-16 m / c to 1e27 m / c.
    for (const d of DURATIONS) {
      expect(d.s, d.label).toBeGreaterThan(1e-16 / C);
      expect(d.s, d.label).toBeLessThan(1e27 / C);
    }
  });
});
