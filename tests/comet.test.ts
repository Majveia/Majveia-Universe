import { describe, it, expect } from 'vitest';
import {
  betaOfGrain, grainOfBeta, activity, comaRadius, apparentMagnitude,
  releaseGrain, sampleBeta, ionTailAberration, makeComet,
} from '../src/astro/comet';
import { stateAt, elementsFromState } from '../src/physics/kepler';
import { RNG } from '../src/core/rng';
import { AU, GM_SUN } from '../src/core/constants';

describe('radiation pressure on dust', () => {
  it('blows the smallest grains straight out of the system', () => {
    // beta > 1 means radiation pressure beats gravity
    expect(betaOfGrain(1e-7)).toBeGreaterThan(1);
    // A millimetre grain barely notices
    expect(betaOfGrain(1e-3)).toBeLessThan(0.01);
  });

  it('inverts consistently', () => {
    for (const b of [0.001, 0.05, 0.5]) {
      expect(betaOfGrain(grainOfBeta(b))).toBeCloseTo(b, 10);
    }
  });

  it('scales inversely with grain size and density', () => {
    expect(betaOfGrain(2e-6) / betaOfGrain(1e-6)).toBeCloseTo(0.5, 9);
    expect(betaOfGrain(1e-6, 4000) / betaOfGrain(1e-6, 2000)).toBeCloseTo(0.5, 9);
  });

  it('samples betas inside the requested range', () => {
    const rng = new RNG(4);
    for (let i = 0; i < 2000; i++) {
      const b = sampleBeta(rng, 1e-3, 0.8);
      expect(b).toBeGreaterThanOrEqual(1e-3);
      expect(b).toBeLessThanOrEqual(0.8);
    }
  });
});

describe('activity', () => {
  it('switches on inside the ice line and off outside it', () => {
    expect(activity(0.5, 3)).toBeGreaterThan(activity(2, 3));
    expect(activity(2, 3)).toBeGreaterThan(activity(6, 3));
    expect(activity(30, 3)).toBeLessThan(1e-3);
  });

  it('saturates near the Sun rather than diverging', () => {
    expect(activity(0.05, 3)).toBeLessThanOrEqual(1);
  });

  it('grows the coma as the comet approaches', () => {
    expect(comaRadius(0.8)).toBeGreaterThan(comaRadius(4));
  });

  it('brightens faster than a bare reflector would', () => {
    // n = 4 rather than 2: the comet gets intrinsically brighter, not just
    // better lit, so halving the distance gains more than two magnitudes.
    const near = apparentMagnitude(8, 1, 1);
    const far = apparentMagnitude(8, 2, 2);
    expect(far - near).toBeGreaterThan(3);
  });
});

describe('dust grains stay on Kepler orbits', () => {
  const rng = new RNG(9);
  const el = { a: 3 * AU, e: 0.85, i: 0.5, Omega: 1, omega: 2, M0: 0.4, epoch: 0 };

  it('leaves a released grain where the comet was', () => {
    const t = 3.2e7;
    const s = stateAt(el, GM_SUN, t);
    const g = releaseGrain(s, GM_SUN, 0.1, 0, t, rng);
    const back = stateAt(g, GM_SUN * 0.9, t);
    expect(back.x / AU).toBeCloseTo(s.x / AU, 6);
    expect(back.y / AU).toBeCloseTo(s.y / AU, 6);
    expect(back.z / AU).toBeCloseTo(s.z / AU, 6);
  });

  it('sends higher-beta grains further from the Sun over time', () => {
    const t0 = 0;
    const s = stateAt(el, GM_SUN, t0);
    const slow = releaseGrain(s, GM_SUN, 0.02, 0, t0, new RNG(1));
    const fast = releaseGrain(s, GM_SUN, 0.6, 0, t0, new RNG(1));
    const later = t0 + 2e7;
    const rSlow = (() => { const p = stateAt(slow, GM_SUN * 0.98, later); return Math.hypot(p.x, p.y, p.z); })();
    const rFast = (() => { const p = stateAt(fast, GM_SUN * 0.4, later); return Math.hypot(p.x, p.y, p.z); })();
    expect(rFast).toBeGreaterThan(rSlow);
  });

  it('unbinds a grain whose beta exceeds a half at perihelion', () => {
    // With beta > 0.5 the reduced gravity cannot hold a grain released from a
    // near-circular orbit; its orbit becomes unbound.
    const circ = { a: AU, e: 0.001, i: 0, Omega: 0, omega: 0, M0: 0, epoch: 0 };
    const s = stateAt(circ, GM_SUN, 0);
    const g = releaseGrain(s, GM_SUN, 0.7, 0, 0, new RNG(2));
    const back = elementsFromState(s, GM_SUN * 0.3, 0);
    expect(g.e).toBeGreaterThan(1);
    expect(back.e).toBeGreaterThan(1);
  });
});

describe('ion tail', () => {
  it('is swept almost straight back from the Sun', () => {
    const el = { a: 2 * AU, e: 0.7, i: 0, Omega: 0, omega: 0, M0: 1.2, epoch: 0 };
    const s = stateAt(el, GM_SUN, 0);
    const ab = ionTailAberration(s);
    // A comet moving at tens of km/s against a 450 km/s wind: a few degrees
    expect(ab).toBeGreaterThan(0);
    expect((ab * 180) / Math.PI).toBeLessThan(12);
  });

  it('is swept back further when the comet moves faster', () => {
    const slow = { x: 5 * AU, y: 0, z: 0, vx: 0, vy: 5e3, vz: 0 };
    const fast = { x: 5 * AU, y: 0, z: 0, vx: 0, vy: 50e3, vz: 0 };
    expect(ionTailAberration(fast)).toBeGreaterThan(ionTailAberration(slow));
  });
});

describe('comet orbits', () => {
  it('makes long-period comets eccentric and randomly inclined', () => {
    const rng = new RNG(17);
    let longPeriod = 0, highIncl = 0, n = 0;
    for (let i = 0; i < 300; i++) {
      const c = makeComet(rng, i, 'X', 40);
      n++;
      if (c.elements.e > 0.95) { longPeriod++; if (c.elements.i > 1) highIncl++; }
      expect(c.elements.e).toBeLessThan(1);
      expect(c.elements.a).toBeGreaterThan(0);
    }
    expect(longPeriod / n).toBeGreaterThan(0.3);
    expect(highIncl).toBeGreaterThan(0);
  });

  it('gives every comet a perihelion inside the ice line region', () => {
    const rng = new RNG(21);
    for (let i = 0; i < 200; i++) {
      const c = makeComet(rng, i, 'X', 40);
      const q = (c.elements.a * (1 - c.elements.e)) / AU;
      expect(q).toBeGreaterThan(0.1);
      expect(q).toBeLessThan(4);
    }
  });

  it('keeps perihelion where it was put when the orbit has to be bounded', () => {
    // A compact system - every planet inside a fraction of an AU - forces the
    // semi-major axis cap hard. Capping a on its own would hold e fixed and so
    // drag q = a(1 - e) down with it, quietly turning ordinary comets into
    // sungrazers that dive through the star. The cap has to move e instead.
    const rng = new RNG(4242);
    const outerAu = 0.12, iceAu = 0.09;
    const aMax = Math.max(outerAu * 40, iceAu * 30);
    for (let i = 0; i < 400; i++) {
      const c = makeComet(rng, i, 'X', outerAu, iceAu);
      const q = (c.elements.a * (1 - c.elements.e)) / AU;
      // Perihelion still lands where a comet's perihelion belongs: inside the
      // ice line, outside the star.
      expect(q).toBeGreaterThan(iceAu * 0.04);
      expect(q).toBeLessThan(iceAu * 1.1);
      expect(c.elements.e).toBeGreaterThanOrEqual(0);
      expect(c.elements.e).toBeLessThan(1);
      // Bounded: nothing is left on a 10,000 AU orbit in a 0.12 AU system.
      expect(c.elements.a / AU).toBeLessThanOrEqual(Math.max(aMax, q * 2) + 1e-9);
    }
  });

  it('scales a comet to its own star rather than to the Sun', () => {
    // The same draw around a red dwarf and around a hot star has to give
    // perihelia in the same ratio as their ice lines, or the comets of a
    // compact system never come inside it and never switch on.
    for (const ice of [0.09, 3, 12]) {
      const rng = new RNG(88);
      for (let i = 0; i < 60; i++) {
        const c = makeComet(rng, i, 'X', ice * 0.5, ice);
        const q = (c.elements.a * (1 - c.elements.e)) / AU;
        expect(q / ice).toBeGreaterThan(0.04);
        expect(q / ice).toBeLessThan(1.1);
        expect(c.activityAu / ice).toBeGreaterThan(0.8);
        expect(c.activityAu / ice).toBeLessThan(1.6);
      }
    }
  });
});
