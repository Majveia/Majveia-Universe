import { describe, it, expect } from 'vitest';
import {
  EJECTION_SPEED, planetaryNebula, shellRadius, shellThickness, shellBrightness,
  doublyIonisedFraction, shellChord, coreLuminosityLsun, coreRadiusRsun,
  transitionTimeS, ionisedFraction, reflectedBrightness,
} from '../src/astro/planetarynebula';
import { YEAR } from '../src/core/constants';

const LY = 9.4607304725808e15;

describe('who makes one', () => {
  it('takes a star between about one and eight solar masses', () => {
    expect(planetaryNebula(1).occurs).toBe(true);
    expect(planetaryNebula(3).occurs).toBe(true);
    expect(planetaryNebula(7.5).occurs).toBe(true);
    // A red dwarf has not finished its main sequence in the age of the universe
    expect(planetaryNebula(0.3).occurs).toBe(false);
    // Above eight the core collapses: the envelope leaves as a supernova
    expect(planetaryNebula(9).occurs).toBe(false);
    expect(planetaryNebula(25).occurs).toBe(false);
  });

  it('leaves the Sun as a half-solar-mass core and throws the rest away', () => {
    const pn = planetaryNebula(1);
    // Models of the Sun's future put its white dwarf near 0.53-0.55 solar
    // masses; nothing a single star leaves is lighter than about half.
    expect(pn.remnantMsun).toBeGreaterThan(0.5);
    expect(pn.remnantMsun).toBeLessThan(0.58);
    expect(pn.ejectedMsun + pn.remnantMsun).toBeCloseTo(1, 9);
    // Half the star leaves. That is the single most surprising number here.
    expect(pn.ejectedMsun / 1).toBeGreaterThan(0.45);
  });

  it('throws away almost all of a more massive star', () => {
    // 5 Msun leaves a 0.94 Msun white dwarf: 81% of it is returned to the galaxy
    const pn = planetaryNebula(5);
    expect(pn.ejectedMsun / 5).toBeGreaterThan(0.78);
    expect(pn.remnantMsun).toBeLessThan(1.4); // still under Chandrasekhar
  });
});

describe('the exposed core', () => {
  it('reaches a hundred thousand kelvin, and hotter for a heavier core', () => {
    const sun = planetaryNebula(1).centralTempK;
    const mid = planetaryNebula(3).centralTempK;
    expect(sun).toBeGreaterThan(50_000);
    expect(sun).toBeLessThan(120_000);
    expect(mid).toBeGreaterThan(sun);
    expect(mid).toBeLessThan(200_000);
  });

  it('never exceeds the hottest central stars observed', () => {
    for (const m of [1, 2, 4, 6, 7.9]) {
      expect(planetaryNebula(m).centralTempK).toBeLessThanOrEqual(220_000);
    }
  });
});

describe('the shell', () => {
  it('expands at the observed twenty-five kilometres a second', () => {
    expect(EJECTION_SPEED).toBe(25e3);
    const pn = planetaryNebula(1);
    // Ten thousand years on, it is a light-year or two across - which is what
    // the Helix and the Ring actually measure.
    const r = shellRadius(pn, 10_000 * YEAR);
    expect((2 * r) / LY).toBeGreaterThan(1);
    expect((2 * r) / LY).toBeLessThan(3);
  });

  it('grows linearly and starts from nothing', () => {
    const pn = planetaryNebula(1);
    expect(shellRadius(pn, 0)).toBe(0);
    expect(shellRadius(pn, -5)).toBe(0);
    expect(shellRadius(pn, 2000 * YEAR)).toBeCloseTo(2 * shellRadius(pn, 1000 * YEAR), 6);
  });

  it('gets relatively thinner as it expands, so the ring sharpens', () => {
    const pn = planetaryNebula(1);
    const early = shellThickness(pn, 2000 * YEAR);
    const late = shellThickness(pn, 20_000 * YEAR);
    expect(early).toBeGreaterThan(late);
    expect(late).toBeGreaterThan(0.02);
    expect(early).toBeLessThanOrEqual(0.6);
  });

  it('lasts a few tens of thousands of years and no longer', () => {
    for (const m of [1, 2, 5]) {
      const pn = planetaryNebula(m);
      const kyr = pn.lifetimeS / YEAR / 1000;
      expect(kyr).toBeGreaterThan(12);
      expect(kyr).toBeLessThan(35);
    }
  });

  it('fades from the moment it is thrown', () => {
    const pn = planetaryNebula(1);
    const t = (f: number) => shellBrightness(pn, f * pn.lifetimeS);
    expect(t(0.02)).toBeGreaterThan(t(0.1));
    expect(t(0.1)).toBeGreaterThan(t(0.5));
    expect(t(0.5)).toBeGreaterThan(t(1.0));
    expect(shellBrightness(pn, 3 * pn.lifetimeS)).toBe(0);
    // The fall is steep: n^2 L with n ~ r^-3 leaves very little by the end
    expect(t(1.0) / t(0.1)).toBeLessThan(0.25);
  });
});

describe('ionisation, which is the colour', () => {
  it('puts the doubly-ionised zone inside and hydrogen outside', () => {
    const T = planetaryNebula(1).centralTempK;
    expect(doublyIonisedFraction(0, T)).toBeCloseTo(1, 6);
    expect(doublyIonisedFraction(0.2, T)).toBeGreaterThan(doublyIonisedFraction(0.4, T));
    expect(doublyIonisedFraction(1, T)).toBe(0);
    expect(doublyIonisedFraction(1.4, T)).toBe(0);
  });

  it('pushes the teal further out for a hotter core', () => {
    const cool = planetaryNebula(1).centralTempK;
    const hot = planetaryNebula(4).centralTempK;
    expect(hot).toBeGreaterThan(cool);
    expect(doublyIonisedFraction(0.55, hot)).toBeGreaterThan(doublyIonisedFraction(0.55, cool));
  });
});

describe('why a shell looks like a ring', () => {
  const rIn = 0.88, rOut = 1;

  it('runs far longer through the limb than through the centre', () => {
    const centre = shellChord(0, rIn, rOut);
    const limb = shellChord(rIn, rIn, rOut);
    expect(centre).toBeCloseTo(2 * (rOut - rIn), 9);
    expect(limb / centre).toBeGreaterThan(3);
  });

  it('peaks exactly where the sightline grazes the inner cavity', () => {
    let best = 0, bestB = 0;
    for (let i = 0; i <= 2000; i++) {
      const b = (i / 2000) * rOut;
      const c = shellChord(b, rIn, rOut);
      if (c > best) { best = c; bestB = b; }
    }
    expect(bestB).toBeCloseTo(rIn, 2);
  });

  it('is continuous across the inner surface and zero outside', () => {
    const below = shellChord(rIn - 1e-6, rIn, rOut);
    const above = shellChord(rIn + 1e-6, rIn, rOut);
    expect(Math.abs(below - above)).toBeLessThan(1e-2);
    expect(shellChord(rOut, rIn, rOut)).toBe(0);
    expect(shellChord(2, rIn, rOut)).toBe(0);
    expect(shellChord(-0.5, rIn, rOut)).toBeCloseTo(shellChord(0.5, rIn, rOut), 9);
  });

  it('sharpens the ring as the shell thins', () => {
    const contrast = (thick: number) => {
      const ri = 1 - thick;
      return shellChord(ri, ri, 1) / shellChord(0, ri, 1);
    };
    expect(contrast(0.06)).toBeGreaterThan(contrast(0.3));
  });
});

describe('the star at the centre', () => {
  it('crosses the diagram at thousands of solar luminosities', () => {
    // A post-AGB star is bright: it has to be, to ionise a light-year of gas
    expect(coreLuminosityLsun(planetaryNebula(1))).toBeGreaterThan(200);
    const mid = coreLuminosityLsun(planetaryNebula(3));
    expect(mid).toBeGreaterThan(5_000);
    expect(mid).toBeLessThan(30_000);
  });

  it('is a tenth of a solar radius, not yet an Earth-sized white dwarf', () => {
    for (const m of [1, 2, 4]) {
      const r = coreRadiusRsun(planetaryNebula(m));
      expect(r).toBeGreaterThan(0.02);
      expect(r).toBeLessThan(0.4);
      // and it is far smaller than the giant it was ten thousand years earlier
      expect(r).toBeLessThan(1);
    }
  });

  it('is consistent with Stefan-Boltzmann', () => {
    const pn = planetaryNebula(2);
    const t = pn.centralTempK / 5772;
    expect(coreRadiusRsun(pn) ** 2 * t ** 4).toBeCloseTo(coreLuminosityLsun(pn) / 1, 3);
  });
});

describe('the dark years before it lights up', () => {
  it('takes a low-mass core far longer to switch on', () => {
    const light = transitionTimeS(planetaryNebula(1)) / YEAR;
    const heavy = transitionTimeS(planetaryNebula(4)) / YEAR;
    expect(light).toBeGreaterThan(heavy * 5);
    // Both land inside the range the post-AGB tracks give
    expect(light).toBeGreaterThan(1_000);
    expect(light).toBeLessThan(40_000);
    expect(heavy).toBeGreaterThan(10);
    expect(heavy).toBeLessThan(2_000);
  });

  it('is not ionised while the envelope is still crossing the planets', () => {
    const pn = planetaryNebula(1);
    // Sixty years: the shell has just passed Neptune's orbit
    expect(ionisedFraction(pn, 60 * YEAR)).toBe(0);
    expect(ionisedFraction(pn, 0)).toBe(0);
    // And fully lit long before the nebula has faded
    expect(ionisedFraction(pn, 3 * transitionTimeS(pn))).toBeCloseTo(1, 6);
  });

  it('shines by reflection first and by its own light after', () => {
    const pn = planetaryNebula(1);
    const early = reflectedBrightness(pn, 20 * YEAR);
    const later = reflectedBrightness(pn, 2000 * YEAR);
    expect(early).toBeGreaterThan(0.5);
    expect(early).toBeGreaterThan(later);
    // Once the gas is ionised there is no reflection nebula left to see
    expect(reflectedBrightness(pn, 4 * transitionTimeS(pn))).toBeCloseTo(0, 6);
  });

  it('never has both at full strength at once', () => {
    const pn = planetaryNebula(2);
    for (let yr = 1; yr < 60_000; yr *= 1.6) {
      const tS = yr * YEAR;
      expect(reflectedBrightness(pn, tS) + ionisedFraction(pn, tS)).toBeLessThanOrEqual(1.0001);
    }
  });
});
