import { describe, it, expect } from 'vitest';
import {
  solveKeplerElliptic, solveKeplerHyperbolic, stateAt, elementsFromState, period,
  visViva, relativisticPrecessionPerOrbit, hillRadius, isco, mu as muOf,
} from '../src/physics/kepler';
import { AU, DAY, GM_SUN, M_EARTH, M_SUN, R_EARTH, TAU, YEAR, DEG, G } from '../src/core/constants';
import { blackbodyRGB, wienPeak, planck, blackbodyHex } from '../src/astro/blackbody';
import {
  makeStar, msLifetimeGyr, msLuminosity, sampleKroupaIMF, spectralClassOf,
  habitableZone, teffFrom, remnantMass,
} from '../src/astro/stellar';
import { RNG } from '../src/core/rng';

describe('Kepler solver', () => {
  it('inverts Kepler\'s equation across all eccentricities', () => {
    for (const e of [0, 0.1, 0.5, 0.9, 0.97, 0.999]) {
      for (let i = 0; i < 32; i++) {
        const M = (i / 32) * TAU;
        const E = solveKeplerElliptic(M, e);
        expect(E - e * Math.sin(E)).toBeCloseTo(M, 9);
      }
    }
  });

  it('solves the hyperbolic form', () => {
    for (const e of [1.1, 2, 5]) {
      for (const M of [-8, -1, 0.3, 4, 40]) {
        const H = solveKeplerHyperbolic(M, e);
        expect(e * Math.sinh(H) - H).toBeCloseTo(M, 7);
      }
    }
  });
});

describe('orbits', () => {
  it('reproduces Earth\'s year from its semi-major axis', () => {
    const T = period(AU, GM_SUN + G * M_EARTH);
    expect(T / DAY).toBeCloseTo(365.25, 0);
  });

  it('gives Earth\'s mean orbital speed as ~29.8 km/s', () => {
    expect(visViva(AU, AU, GM_SUN) / 1000).toBeCloseTo(29.78, 1);
  });

  it('round-trips elements -> state -> elements', () => {
    const el = { a: 2.3 * AU, e: 0.42, i: 17 * DEG, Omega: 1.1, omega: 2.4, M0: 0.77, epoch: 0 };
    const s = stateAt(el, GM_SUN, 1234.5);
    const back = elementsFromState(s, GM_SUN, 1234.5);
    expect(back.a / AU).toBeCloseTo(el.a / AU, 6);
    expect(back.e).toBeCloseTo(el.e, 8);
    expect(back.i).toBeCloseTo(el.i, 8);
    expect(back.Omega).toBeCloseTo(el.Omega, 8);
    expect(back.omega).toBeCloseTo(el.omega, 8);
  });

  it('conserves energy and angular momentum along an eccentric orbit', () => {
    const el = { a: 1.5 * AU, e: 0.6, i: 0.3, Omega: 0.2, omega: 1.0, M0: 0, epoch: 0 };
    const T = period(el.a, GM_SUN);
    let e0 = 0, h0 = 0;
    for (let k = 0; k < 12; k++) {
      const s = stateAt(el, GM_SUN, (k / 12) * T);
      const r = Math.hypot(s.x, s.y, s.z);
      const v2 = s.vx ** 2 + s.vy ** 2 + s.vz ** 2;
      const energy = v2 / 2 - GM_SUN / r;
      const h = Math.hypot(
        s.y * s.vz - s.z * s.vy, s.z * s.vx - s.x * s.vz, s.x * s.vy - s.y * s.vx);
      if (k === 0) { e0 = energy; h0 = h; }
      expect(energy / e0).toBeCloseTo(1, 8);
      expect(h / h0).toBeCloseTo(1, 8);
    }
  });

  it('returns to the same place after exactly one period', () => {
    const el = { a: 3 * AU, e: 0.3, i: 0.5, Omega: 1, omega: 2, M0: 0.5, epoch: 0 };
    const T = period(el.a, GM_SUN);
    const s1 = stateAt(el, GM_SUN, 0);
    const s2 = stateAt(el, GM_SUN, T);
    expect(s2.x / AU).toBeCloseTo(s1.x / AU, 6);
    expect(s2.y / AU).toBeCloseTo(s1.y / AU, 6);
  });

  it('reproduces Mercury\'s 43 arcsec/century GR precession', () => {
    const a = 0.387098 * AU, e = 0.205630;
    const perOrbit = relativisticPrecessionPerOrbit(a, e, GM_SUN);
    const orbitsPerCentury = (100 * YEAR) / period(a, GM_SUN);
    const arcsecPerCentury = perOrbit * orbitsPerCentury * (180 / Math.PI) * 3600;
    expect(arcsecPerCentury).toBeGreaterThan(42);
    expect(arcsecPerCentury).toBeLessThan(44);
  });

  it('gives the Earth-Moon Hill radius as ~1.5 million km', () => {
    const rh = hillRadius(AU, 0.0167, M_EARTH, M_SUN) / 1e9;
    expect(rh).toBeGreaterThan(1.4);
    expect(rh).toBeLessThan(1.6);
  });

  it('puts the ISCO of a solar-mass black hole at ~8.9 km', () => {
    expect(isco(muOf(M_SUN)) / 1000).toBeCloseTo(8.85, 0);
  });

  it('gives Earth\'s escape velocity as 11.2 km/s', () => {
    expect(Math.sqrt((2 * G * M_EARTH) / R_EARTH) / 1000).toBeCloseTo(11.19, 1);
  });
});

describe('blackbody colour', () => {
  it('places the Sun\'s peak in the visible green-yellow', () => {
    expect(wienPeak(5772) * 1e9).toBeCloseTo(502, -1);
  });

  it('makes cool stars red and hot stars blue', () => {
    const [r1, , b1] = blackbodyRGB(3000);
    const [r2, , b2] = blackbodyRGB(25000);
    expect(r1).toBeGreaterThan(b1);
    expect(b2).toBeGreaterThan(r2);
  });

  it('makes the Sun nearly white', () => {
    const [r, g, b] = blackbodyRGB(5772);
    expect(Math.min(r, g, b)).toBeGreaterThan(0.6);
    expect(blackbodyHex(5772)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('satisfies the Stefan-Boltzmann integral', () => {
    // Integrating Planck over wavelength and solid angle must give sigma T^4
    const T = 4000;
    let s = 0;
    const d = 1e-9;
    for (let l = 1e-9; l < 5e-5; l += d) s += planck(l, T) * d;
    const total = s * Math.PI; // integrate over the hemisphere
    expect(total / (5.670374419e-8 * T ** 4)).toBeCloseTo(1, 1);
  });
});

describe('stellar physics', () => {
  it('reproduces the Sun', () => {
    const sun = makeStar(1, 4.6, 0);
    expect(sun.teff).toBeGreaterThan(5500);
    expect(sun.teff).toBeLessThan(6100);
    expect(sun.spectralClass).toBe('G');
    expect(sun.kind).toBe('main-sequence');
    expect(sun.luminosityLsun).toBeGreaterThan(0.9);
    expect(sun.luminosityLsun).toBeLessThan(1.4);
  });

  it('puts the Sun\'s habitable zone around 0.95-1.7 AU', () => {
    const [inner, outer] = habitableZone(1, 5772);
    expect(inner).toBeGreaterThan(0.9);
    expect(inner).toBeLessThan(1.05);
    expect(outer).toBeGreaterThan(1.5);
    expect(outer).toBeLessThan(1.9);
  });

  it('gives the Sun a ~10 Gyr main-sequence lifetime and O stars a few Myr', () => {
    expect(msLifetimeGyr(1)).toBeCloseTo(10, 0);
    expect(msLifetimeGyr(40)).toBeLessThan(0.01);
    expect(msLifetimeGyr(0.2)).toBeGreaterThan(100);
  });

  it('makes massive stars vastly more luminous', () => {
    expect(msLuminosity(10) / msLuminosity(1)).toBeGreaterThan(1000);
  });

  it('turns massive old stars into remnants', () => {
    expect(makeStar(15, 1, 0).kind).toBe('neutron-star');
    expect(makeStar(60, 1, 0).kind).toBe('black-hole');
    expect(makeStar(2, 5, 0).kind).toBe('white-dwarf');
    expect(remnantMass(1).kind).toBe('white-dwarf');
  });

  it('samples an IMF dominated by low-mass stars', () => {
    const rng = new RNG(42);
    let below = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) if (sampleKroupaIMF(rng) < 0.5) below++;
    // Kroupa: roughly 3/4 of stars are below half a solar mass
    expect(below / n).toBeGreaterThan(0.6);
    expect(below / n).toBeLessThan(0.9);
  });

  it('never samples outside the requested mass range', () => {
    const rng = new RNG(7);
    for (let i = 0; i < 5000; i++) {
      const m = sampleKroupaIMF(rng, 0.08, 120);
      expect(m).toBeGreaterThanOrEqual(0.08);
      expect(m).toBeLessThanOrEqual(120);
    }
  });

  it('classifies spectral types at the textbook boundaries', () => {
    expect(spectralClassOf(40000)[0]).toBe('O');
    expect(spectralClassOf(9000)[0]).toBe('A');
    expect(spectralClassOf(5772)[0]).toBe('G');
    expect(spectralClassOf(3000)[0]).toBe('M');
  });

  it('is self-consistent between L, R and Teff', () => {
    expect(teffFrom(1, 1)).toBeCloseTo(5772, -2);
  });
});
