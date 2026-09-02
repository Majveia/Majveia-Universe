import { describe, it, expect } from 'vitest';
import {
  coreCollapseRate, typeIaRate, lightCurve, peakMagnitude, magnitudeToLuminosity,
  sedovRadius, sedovVelocity, remnantLifetimeYears, compactRemnantMass, supernovaColor,
  remnantRadius, remnantVelocity, radiativeTransitionYears,
} from '../src/astro/supernova';
import { PC } from '../src/core/constants';

describe('supernova rates', () => {
  it('gives the Milky Way about two per century', () => {
    // SFR ~ 1.6 Msun/yr, stellar mass ~ 6e10
    const rate = coreCollapseRate(1.6) + typeIaRate(6e10, 1.6);
    expect(rate * 100).toBeGreaterThan(1);
    expect(rate * 100).toBeLessThan(5);
  });

  it('makes core collapse track star formation and Ia track stellar mass', () => {
    expect(coreCollapseRate(10) / coreCollapseRate(1)).toBeCloseTo(10, 6);
    // An elliptical with no star formation still has type Ia supernovae
    expect(typeIaRate(1e11, 0)).toBeGreaterThan(0);
    expect(coreCollapseRate(0)).toBe(0);
  });
});

describe('light curves', () => {
  it('peaks a type Ia near -19.3 at about nineteen days', () => {
    expect(lightCurve('Ia', 19)).toBeCloseTo(peakMagnitude('Ia'), 1);
    expect(lightCurve('Ia', 1)).toBeGreaterThan(lightCurve('Ia', 19));
    expect(lightCurve('Ia', 100)).toBeGreaterThan(lightCurve('Ia', 19));
  });

  it('declines a type Ia on the cobalt slope', () => {
    // ~0.0098 mag/day on the radioactive tail
    const slope = (lightCurve('Ia', 200) - lightCurve('Ia', 120)) / 80;
    expect(slope).toBeGreaterThan(0.006);
    expect(slope).toBeLessThan(0.016);
  });

  it('gives a type II-P a plateau then a drop', () => {
    const onPlateau = lightCurve('II-P', 60) - lightCurve('II-P', 30);
    const afterDrop = lightCurve('II-P', 130) - lightCurve('II-P', 105);
    expect(Math.abs(onPlateau)).toBeLessThan(0.4);
    expect(afterDrop).toBeGreaterThan(1.5);
  });

  it('outshines its whole galaxy at peak', () => {
    // A type Ia at peak is ~5e9 Lsun, comparable to a small galaxy
    expect(magnitudeToLuminosity(peakMagnitude('Ia'))).toBeGreaterThan(1e9);
  });

  it('is dark before it explodes', () => {
    expect(lightCurve('Ia', -1)).toBeGreaterThan(50);
  });
});

describe('remnant expansion', () => {
  it('reproduces the Sedov-Taylor scaling R ~ t^(2/5)', () => {
    const a = sedovRadius(1e51, 1000);
    const b = sedovRadius(1e51, 4000);
    expect(b / a).toBeCloseTo(Math.pow(4, 0.4), 4);
  });

  it('gives a ten-parsec remnant at ten thousand years', () => {
    const r = sedovRadius(1e51, 1e4, 1) / PC;
    expect(r).toBeGreaterThan(5);
    expect(r).toBeLessThan(25);
  });

  it('expands faster in a thinner medium', () => {
    expect(sedovRadius(1e51, 1e4, 0.1)).toBeGreaterThan(sedovRadius(1e51, 1e4, 1));
  });

  it('starts fast and slows down', () => {
    expect(sedovVelocity(1e51, 100)).toBeGreaterThan(sedovVelocity(1e51, 10000));
    // A young remnant's shock is thousands of km/s
    expect(sedovVelocity(1e51, 300) / 1000).toBeGreaterThan(1000);
  });

  it('goes radiative after about thirty thousand years', () => {
    const t = radiativeTransitionYears(1e51, 1);
    expect(t).toBeGreaterThan(1e4);
    expect(t).toBeLessThan(1e5);
  });

  it('merges with the interstellar medium after a few hundred thousand years', () => {
    // Pure Sedov would predict several megayears; including the radiative
    // phase, where the interior loses pressure support and the shell coasts on
    // momentum, brings it back to the observed few hundred thousand.
    const t = remnantLifetimeYears();
    expect(t).toBeGreaterThan(5e4);
    expect(t).toBeLessThan(1.5e6);
  });

  it('runs through free expansion, Sedov and snowplow in order', () => {
    const r = (t: number) => remnantRadius(t, 1e51, 1, 5);
    // Free expansion: linear
    expect(r(60) / r(30)).toBeCloseTo(2, 1);
    // Sedov: t^0.4
    expect(r(8000) / r(2000)).toBeCloseTo(Math.pow(4, 0.4), 1);
    // Snowplow: t^(2/7), shallower than Sedov
    expect(r(400000) / r(100000)).toBeLessThan(Math.pow(4, 0.4));
    expect(r(400000) / r(100000)).toBeCloseTo(Math.pow(4, 2 / 7), 1);
  });

  it('is continuous across the phase transitions', () => {
    for (const t of [200, 300, 2.9e4 * 0.99, 2.9e4 * 1.01]) {
      const a = remnantRadius(t * 0.999);
      const b = remnantRadius(t * 1.001);
      expect(Math.abs(b / a - 1)).toBeLessThan(0.02);
    }
  });

  it('slows monotonically', () => {
    let prev = Infinity;
    for (const t of [500, 2000, 1e4, 5e4, 2e5]) {
      const v = remnantVelocity(t);
      expect(v).toBeLessThan(prev);
      prev = v;
    }
  });
});

describe('remnants and colour', () => {
  it('leaves a neutron star below twenty solar masses and a black hole above', () => {
    expect(compactRemnantMass(5)).toBe(0);
    expect(compactRemnantMass(15)).toBeGreaterThan(1.2);
    expect(compactRemnantMass(15)).toBeLessThan(3);
    expect(compactRemnantMass(40)).toBeGreaterThan(5);
  });

  it('cools from blue-white to red as the photosphere expands', () => {
    const [r0, , b0] = supernovaColor('Ia', 2);
    const [r1, , b1] = supernovaColor('Ia', 250);
    expect(b0 / r0).toBeGreaterThan(b1 / r1);
  });
});
