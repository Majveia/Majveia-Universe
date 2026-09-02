import { describe, it, expect } from 'vitest';
import { solarSystem, theSun, planetIndex } from '../src/astro/solsystem';
import { radiusFromMass, equilibriumTemperature, snowLine } from '../src/astro/planets';
import { stateAt, period } from '../src/physics/kepler';
import { M_EARTH, R_EARTH, G, M_SUN, DAY, YEAR } from '../src/core/constants';

const SYS = solarSystem();
const at = (name: string) => {
  const p = SYS.planets[planetIndex(name)];
  if (!p) throw new Error(`no ${name}`);
  return p;
};

describe('the Sun', () => {
  it('is a G2 V star of one solar everything', () => {
    const s = theSun();
    expect(s.massMsun).toBe(1);
    expect(s.luminosityLsun).toBe(1);
    expect(s.teff).toBe(5772);
    expect(`${s.spectralClass}${s.subClass} ${s.luminosityClass}`).toBe('G2 V');
    expect(s.habitableZoneAu[0]).toBeLessThan(1);
    expect(s.habitableZoneAu[1]).toBeGreaterThan(1);
  });
});

describe('the planets, against the ephemeris', () => {
  it('gives Earth a year of 365.25 days', () => {
    expect(at('Earth').periodS / DAY).toBeCloseTo(365.25, 0);
    expect(at('Earth').periodS / YEAR).toBeCloseTo(1, 3);
  });

  it('gives every planet the period the third law demands', () => {
    for (const p of SYS.planets) {
      expect(p.periodS).toBeCloseTo(period(p.elements.a, G * M_SUN), -3);
    }
    // Jupiter takes 11.86 years, Neptune 164.8.
    expect(at('Jupiter').periodS / YEAR).toBeCloseTo(11.86, 1);
    expect(at('Neptune').periodS / YEAR).toBeCloseTo(164.8, 0);
  });

  it('gives Earth the right size, mass, gravity and escape velocity', () => {
    const e = at('Earth');
    expect(e.massKg / M_EARTH).toBe(1);
    expect(e.radiusM / R_EARTH).toBeCloseTo(1, 3);
    expect(e.gravity).toBeCloseTo(9.82, 1);
    expect(e.escapeVelocity / 1e3).toBeCloseTo(11.2, 1);
    expect(e.density).toBeCloseTo(5514, -2);
  });

  it('orders the planets by distance and spans 0.39 to 30 AU', () => {
    for (let i = 1; i < SYS.planets.length; i++) {
      expect(SYS.planets[i].au).toBeGreaterThan(SYS.planets[i - 1].au);
    }
    expect(SYS.planets[0].au).toBeCloseTo(0.387, 2);
    expect(SYS.planets[SYS.planets.length - 1].au).toBeCloseTo(30.07, 1);
  });

  it('puts Earth at 29.8 km/s and Neptune at 5.4', () => {
    const speed = (name: string) => {
      const p = at(name);
      const s = stateAt(p.elements, G * M_SUN, 0);
      return Math.hypot(s.vx, s.vy, s.vz) / 1e3;
    };
    expect(speed('Earth')).toBeGreaterThan(28);
    expect(speed('Earth')).toBeLessThan(31);
    expect(speed('Neptune')).toBeGreaterThan(5);
    expect(speed('Neptune')).toBeLessThan(6);
  });

  it('turns Venus and Uranus backwards', () => {
    expect(at('Venus').dayS).toBeLessThan(0);
    expect(at('Uranus').dayS).toBeLessThan(0);
    expect(at('Earth').dayS / 3600).toBeCloseTo(23.93, 1);
  });

  it('lays Uranus on its side', () => {
    expect((at('Uranus').obliquity * 180) / Math.PI).toBeCloseTo(97.77, 1);
    expect((at('Earth').obliquity * 180) / Math.PI).toBeCloseTo(23.44, 1);
  });
});

describe('what the measured values say that the derived ones do not', () => {
  it('shows the greenhouse effect as the gap between two numbers', () => {
    // Equilibrium temperature is what a bare rock at that distance and albedo
    // would sit at; the surface temperature is what is measured.
    const v = at('Venus');
    expect(equilibriumTemperature(1, v.au, v.albedo)).toBeCloseTo(v.teqK, -1);
    expect(v.surfaceK - v.teqK).toBeGreaterThan(450);
    const e = at('Earth');
    expect(e.surfaceK - e.teqK).toBeGreaterThan(30);
    expect(e.surfaceK - e.teqK).toBeLessThan(40);
    // Mars has almost no atmosphere and almost no greenhouse.
    expect(Math.abs(at('Mars').surfaceK - at('Mars').teqK)).toBeLessThan(12);
  });

  it('agrees with the mass-radius relation for the rocky planets it was fitted to', () => {
    for (const name of ['Venus', 'Earth']) {
      const p = at(name);
      const predicted = radiusFromMass(p.massKg / M_EARTH);
      expect(p.radiusM / R_EARTH / predicted).toBeGreaterThan(0.9);
      expect(p.radiusM / R_EARTH / predicted).toBeLessThan(1.1);
    }
  });

  it('puts the snow line where the asteroid belt is', () => {
    expect(SYS.snowLineAu).toBeGreaterThan(SYS.asteroidBelts[0].innerAu * 0.6);
    expect(SYS.snowLineAu).toBeLessThan(SYS.asteroidBelts[0].outerAu * 1.2);
    // And the simple luminosity scaling gets close to it.
    expect(snowLine(1)).toBeCloseTo(2.7, 1);
  });
});

describe('moons and rings', () => {
  it('gives Earth one moon at 384,400 km', () => {
    const m = at('Earth').moons;
    expect(m).toHaveLength(1);
    expect(m[0].a / 1e3).toBeCloseTo(384399, -3);
    expect(m[0].radiusM / 1e3).toBeCloseTo(1737, -1);
  });

  it('gives Jupiter the four Galileans, in order, with Io heated and Europa icy', () => {
    const m = at('Jupiter').moons;
    expect(m.map((x) => x.name)).toEqual(['Io', 'Europa', 'Ganymede', 'Callisto']);
    for (let i = 1; i < m.length; i++) expect(m[i].a).toBeGreaterThan(m[i - 1].a);
    expect(m[0].tidallyHeated).toBe(true);
    expect(m[1].icy).toBe(true);
    // Ganymede is the largest moon in the solar system, bigger than Mercury.
    expect(m[2].radiusM).toBeGreaterThan(at('Mercury').radiusM);
  });

  it('gives Saturn rings that sit inside its Roche limit', () => {
    const s = at('Saturn');
    expect(s.rings).toHaveLength(1);
    // The A ring's outer edge is 2.27 Saturn radii out.
    expect(s.rings[0].outerM / s.radiusM).toBeGreaterThan(2.1);
    expect(s.rings[0].outerM / s.radiusM).toBeLessThan(2.4);
    expect(s.rings[0].iceFraction).toBeGreaterThan(0.9);
    // Titan is far outside them.
    expect(s.moons[0].a / s.radiusM).toBeGreaterThan(15);
  });

  it('sends Triton round backwards', () => {
    const t = at('Neptune').moons[0];
    expect((t.i * 180) / Math.PI).toBeGreaterThan(90);
  });
});

describe('as a system', () => {
  it('is a single star with eight planets and one habitable world', () => {
    expect(SYS.companion).toBeNull();
    expect(SYS.planets).toHaveLength(8);
    expect(SYS.planets.filter((p) => p.habitable).map((p) => p.name)).toEqual(['Earth']);
  });

  it('places the main belt between Mars and Jupiter', () => {
    const belt = SYS.asteroidBelts[0];
    expect(belt.innerAu).toBeGreaterThan(at('Mars').au);
    expect(belt.outerAu).toBeLessThan(at('Jupiter').au);
  });

  it('puts the Kuiper belt beyond Neptune', () => {
    expect(SYS.outerBeltAu[0]).toBeGreaterThanOrEqual(at('Neptune').au - 0.1);
  });

  it('is the same system every time it is asked for', () => {
    const a = solarSystem(), b = solarSystem();
    expect(a.planets.map((p) => p.au)).toEqual(b.planets.map((p) => p.au));
    expect(a.comets.map((c) => c.elements.a)).toEqual(b.comets.map((c) => c.elements.a));
  });
});
