import { describe, it, expect } from 'vitest';
import {
  multiplicityFraction, sampleCompanion, sTypeCritical, pTypeCritical,
  planetRegion, combinedLuminosity, binaryPeriodDays, isInteracting,
} from '../src/astro/binary';
import { makeStar } from '../src/astro/stellar';
import { RNG } from '../src/core/rng';
import { AU, DAY, G, M_SUN } from '../src/core/constants';

describe('multiplicity', () => {
  it('rises with mass, as it does in the surveys', () => {
    expect(multiplicityFraction(0.2)).toBeLessThan(multiplicityFraction(1));
    expect(multiplicityFraction(1)).toBeLessThan(multiplicityFraction(10));
  });

  it('puts solar-type stars near half', () => {
    expect(multiplicityFraction(1)).toBeGreaterThan(0.35);
    expect(multiplicityFraction(1)).toBeLessThan(0.55);
  });

  it('leaves most M dwarfs single', () => {
    expect(multiplicityFraction(0.2)).toBeLessThan(0.4);
  });
});

describe('Holman & Wiegert stability', () => {
  it('gives an equal-mass circular binary the published limits', () => {
    // mu = 0.5, e = 0. The polynomial fits evaluate to 0.274 and 2.3875; the
    // integrations they were fitted to give 0.27 and 2.28, so the fit carries
    // a few per cent of residual, which is what the paper quotes.
    expect(sTypeCritical(0, 0.5)).toBeCloseTo(0.274, 3);
    expect(pTypeCritical(0, 0.5)).toBeCloseTo(2.3875, 3);
    expect(pTypeCritical(0, 0.5)).toBeGreaterThan(2.2);
    expect(pTypeCritical(0, 0.5)).toBeLessThan(2.5);
  });

  it('shrinks the circumstellar region and widens the circumbinary one with eccentricity', () => {
    expect(sTypeCritical(0.5, 0.3)).toBeLessThan(sTypeCritical(0, 0.3));
    expect(pTypeCritical(0.5, 0.3)).toBeGreaterThan(pTypeCritical(0, 0.3));
  });

  it('leaves a gap between the two stable regions', () => {
    for (const e of [0, 0.2, 0.5]) {
      for (const mu of [0.1, 0.3, 0.5]) {
        expect(pTypeCritical(e, mu)).toBeGreaterThan(sTypeCritical(e, mu));
      }
    }
  });

  it('matches where Kepler-16b actually sits', () => {
    // Kepler-16: a_bin 0.224 AU, e 0.159, mu = 0.202/(0.69+0.202) = 0.227.
    // The planet is at 0.705 AU, just outside the critical radius.
    const crit = pTypeCritical(0.159, 0.227) * 0.224;
    expect(crit).toBeLessThan(0.705);
    expect(crit).toBeGreaterThan(0.4);
  });
});

describe('companions', () => {
  const primary = makeStar(1, 4.6, 0);

  it('produces companions no more massive than the primary', () => {
    const rng = new RNG(3);
    for (let i = 0; i < 400; i++) {
      const c = sampleCompanion(rng, primary, 4.6, 0);
      if (!c) continue;
      expect(c.star.massMsun).toBeLessThanOrEqual(primary.massMsun + 1e-9);
      expect(c.mu).toBeGreaterThan(0);
      expect(c.mu).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });

  it('obeys Kepler\'s third law for the pair', () => {
    const rng = new RNG(11);
    for (let i = 0; i < 200; i++) {
      const c = sampleCompanion(rng, primary, 4.6, 0);
      if (!c) continue;
      const mu = G * (primary.currentMassMsun + c.star.currentMassMsun) * M_SUN;
      const T = 2 * Math.PI * Math.sqrt(c.aM ** 3 / mu);
      expect(T / c.periodS).toBeCloseTo(1, 6);
    }
  });

  it('circularises short-period pairs', () => {
    const rng = new RNG(19);
    let close = 0, closeCircular = 0;
    for (let i = 0; i < 3000; i++) {
      const c = sampleCompanion(rng, primary, 4.6, 0);
      if (!c) continue;
      if (binaryPeriodDays(c) < 12) { close++; if (c.e < 0.1) closeCircular++; }
    }
    expect(close).toBeGreaterThan(5);
    expect(closeCircular / close).toBeGreaterThan(0.9);
  });

  it('spans hours to millennia in period', () => {
    const rng = new RNG(23);
    let minP = Infinity, maxP = 0;
    for (let i = 0; i < 3000; i++) {
      const c = sampleCompanion(rng, primary, 4.6, 0);
      if (!c) continue;
      minP = Math.min(minP, binaryPeriodDays(c));
      maxP = Math.max(maxP, binaryPeriodDays(c));
    }
    expect(minP).toBeLessThan(30);
    expect(maxP).toBeGreaterThan(1e5);
  });
});

describe('where planets can live', () => {
  const primary = makeStar(1, 4.6, 0);

  it('leaves a single star unrestricted', () => {
    const r = planetRegion(primary, null);
    expect(r.host).toBe('single');
    expect(r.innerAu).toBe(0);
  });

  it('makes a close pair circumbinary and a wide pair circumstellar', () => {
    const rng = new RNG(5);
    let sawP = false, sawS = false;
    for (let i = 0; i < 500; i++) {
      const c = sampleCompanion(rng, primary, 4.6, 0);
      if (!c) continue;
      const r = planetRegion(primary, c);
      if (c.aM / AU < 0.5) { expect(r.host).toBe('circumbinary'); sawP = true; }
      if (c.aM / AU > 400) { expect(r.host).toBe('circumstellar'); sawS = true; }
    }
    expect(sawP || sawS).toBe(true);
  });

  it('never allows a planet inside the unstable gap', () => {
    const rng = new RNG(31);
    for (let i = 0; i < 400; i++) {
      const c = sampleCompanion(rng, primary, 4.6, 0);
      if (!c) continue;
      const r = planetRegion(primary, c);
      if (r.host === 'circumbinary') expect(r.innerAu * AU).toBeGreaterThanOrEqual(c.pTypeLimit);
      if (r.host === 'circumstellar') expect(r.outerAu * AU).toBeLessThanOrEqual(c.sTypeLimit);
    }
  });
});

describe('two suns', () => {
  it('adds the luminosities for a circumbinary world', () => {
    const a = makeStar(1, 4.6, 0);
    const rng = new RNG(7);
    let c = null;
    while (!c) c = sampleCompanion(rng, a, 4.6, 0);
    expect(combinedLuminosity(a, c)).toBeCloseTo(a.luminosityLsun + c.star.luminosityLsun, 9);
    expect(combinedLuminosity(a, null)).toBe(a.luminosityLsun);
  });

  it('flags a contact pair as interacting', () => {
    const giant = makeStar(1.2, 6.5, 0);
    const rng = new RNG(2);
    let c = null;
    while (!c) c = sampleCompanion(rng, giant, 6.5, 0);
    // Force a very tight orbit and check the Roche test fires
    const tight = { ...c, aM: giant.radiusRsun * 6.957e8 * 1.5, e: 0 };
    expect(isInteracting(giant, tight)).toBe(true);
    const wide = { ...c, aM: 100 * AU, e: 0 };
    expect(isInteracting(giant, wide)).toBe(false);
  });
});

describe('units', () => {
  it('converts period to days consistently', () => {
    const rng = new RNG(13);
    let c = null;
    while (!c) c = sampleCompanion(rng, makeStar(1, 4.6, 0), 4.6, 0);
    expect(binaryPeriodDays(c)).toBeCloseTo(c.periodS / DAY, 6);
  });
});
