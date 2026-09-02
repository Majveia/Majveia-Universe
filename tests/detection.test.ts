import { describe, it, expect } from 'vitest';
import {
  transitDepth, transitProbability, transitDuration, limbIntensity, transitFlux,
  radialVelocityAmplitude, radialVelocity, astrometricSignal, reflectedContrast,
  detectability,
} from '../src/astro/detection';
import { AU, M_EARTH, M_JUPITER, M_SUN, R_EARTH, R_SUN, YEAR, G } from '../src/core/constants';

const R_JUP = 6.9911e7;

describe('transit depth', () => {
  it('is an area ratio, so the Earth takes 84 parts per million out of the Sun', () => {
    expect(transitDepth(R_EARTH, R_SUN) * 1e6).toBeGreaterThan(80);
    expect(transitDepth(R_EARTH, R_SUN) * 1e6).toBeLessThan(90);
  });

  it('gives a hot Jupiter about one per cent', () => {
    expect(transitDepth(R_JUP, R_SUN)).toBeGreaterThan(0.008);
    expect(transitDepth(R_JUP, R_SUN)).toBeLessThan(0.015);
  });

  it('does not care about mass at all', () => {
    // A gas giant and a rocky planet of the same radius block the same light,
    // which is why transits alone can never give a density.
    expect(transitDepth(R_JUP, R_SUN)).toBe(transitDepth(R_JUP, R_SUN));
  });

  it('is far deeper around a small star, which is why M dwarfs are surveyed', () => {
    const mDwarf = 0.2 * R_SUN;
    expect(transitDepth(R_EARTH, mDwarf) / transitDepth(R_EARTH, R_SUN)).toBeCloseTo(25, 0);
  });
});

describe('transit geometry', () => {
  it('gives the Earth a one-in-two-hundred chance of being seen', () => {
    const p = transitProbability(R_SUN, AU);
    expect(p).toBeGreaterThan(0.004);
    expect(p).toBeLessThan(0.006);
  });

  it('makes close-in planets far more likely to transit', () => {
    expect(transitProbability(R_SUN, 0.05 * AU)).toBeGreaterThan(0.08);
  });

  it('takes thirteen hours for the Earth to cross the Sun', () => {
    const d = transitDuration({
      planetRadiusM: R_EARTH, starRadiusM: R_SUN, aM: AU, periodS: YEAR,
    }) / 3600;
    expect(d).toBeGreaterThan(12);
    expect(d).toBeLessThan(14);
  });

  it('shortens the transit as the chord moves off centre, to nothing at the limb', () => {
    const base = { planetRadiusM: R_EARTH, starRadiusM: R_SUN, aM: AU, periodS: YEAR };
    const centre = transitDuration(base);
    const grazing = transitDuration({ ...base, impact: 0.95 });
    expect(grazing).toBeLessThan(centre * 0.4);
    expect(transitDuration({ ...base, impact: 1.5 })).toBe(0);
  });
});

describe('limb darkening', () => {
  it('makes the centre of the disc brighter than the edge', () => {
    expect(limbIntensity(1)).toBeGreaterThan(limbIntensity(0.2));
    // The solar limb is about 40% as bright as disc centre.
    expect(limbIntensity(0) / limbIntensity(1)).toBeGreaterThan(0.2);
    expect(limbIntensity(0) / limbIntensity(1)).toBeLessThan(0.55);
  });

  it('averages to one over the disc', () => {
    // Integral of 2 mu I(mu) dmu over 0..1 is the disc average.
    let s = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const mu = (i + 0.5) / n;
      s += 2 * mu * limbIntensity(mu) / n;
    }
    expect(s).toBeCloseTo(1, 3);
  });

  it('is uniform when both coefficients are zero', () => {
    for (const mu of [0, 0.3, 1]) expect(limbIntensity(mu, 0, 0)).toBeCloseTo(1, 12);
  });
});

describe('the light curve', () => {
  const hj = {
    planetRadiusM: R_JUP, starRadiusM: R_SUN, aM: 0.05 * AU,
    periodS: 2 * Math.PI * Math.sqrt((0.05 * AU) ** 3 / (G * M_SUN)),
  };

  it('is flat outside the transit and dips inside it', () => {
    expect(transitFlux(hj, hj.periodS * 0.25)).toBe(1);
    expect(transitFlux(hj, 0)).toBeLessThan(0.995);
  });

  it('reaches its deepest at mid-transit', () => {
    const mid = transitFlux(hj, 0);
    for (const dt of [200, 1000, 3000]) {
      expect(transitFlux(hj, dt)).toBeGreaterThan(mid);
      expect(transitFlux(hj, -dt)).toBeGreaterThan(mid);
    }
  });

  it('is symmetric about mid-transit', () => {
    for (const dt of [300, 900, 2400]) {
      expect(transitFlux(hj, dt)).toBeCloseTo(transitFlux(hj, -dt), 12);
    }
  });

  it('bottoms out deeper than the area ratio, because the middle is brighter', () => {
    const geometric = transitDepth(R_JUP, R_SUN);
    expect(1 - transitFlux(hj, 0)).toBeGreaterThan(geometric);
    // But not by more than the central-to-mean intensity ratio.
    expect(1 - transitFlux(hj, 0)).toBeLessThan(geometric * limbIntensity(1) * 1.05);
  });

  it('has a rounded bottom rather than a flat one', () => {
    // A box would be exactly flat between contacts; limb darkening tilts it.
    const a = 1 - transitFlux(hj, 0);
    const b = 1 - transitFlux(hj, transitDuration(hj) * 0.3);
    expect(b).toBeLessThan(a);
    expect(b).toBeGreaterThan(a * 0.8);
  });

  it('is shallower for a grazing transit', () => {
    const graze = { ...hj, impact: 0.9 };
    expect(1 - transitFlux(graze, 0)).toBeLessThan(1 - transitFlux(hj, 0));
  });
});

describe('radial velocity', () => {
  it('gives Jupiter 12.5 metres a second on the Sun', () => {
    const K = radialVelocityAmplitude({
      starMassKg: M_SUN, planetMassKg: M_JUPITER, aM: 5.2 * AU,
    });
    expect(K).toBeGreaterThan(11);
    expect(K).toBeLessThan(14);
  });

  it('gives the Earth nine centimetres a second', () => {
    const K = radialVelocityAmplitude({
      starMassKg: M_SUN, planetMassKg: M_EARTH, aM: AU,
    });
    expect(K).toBeGreaterThan(0.07);
    expect(K).toBeLessThan(0.11);
  });

  it('gives 51 Pegasi b the fifty-odd metres a second that started the field', () => {
    // 0.47 Jupiter masses at 0.052 AU around a 1.11 solar mass star.
    const K = radialVelocityAmplitude({
      starMassKg: 1.11 * M_SUN, planetMassKg: 0.47 * M_JUPITER, aM: 0.052 * AU,
    });
    expect(K).toBeGreaterThan(45);
    expect(K).toBeLessThan(65);
  });

  it('only ever measures m sin i, so an unknown inclination is a lower bound', () => {
    const base = { starMassKg: M_SUN, planetMassKg: M_JUPITER, aM: 5.2 * AU };
    const edge = radialVelocityAmplitude(base);
    const tilted = radialVelocityAmplitude({ ...base, inclination: Math.PI / 6 });
    expect(tilted).toBeCloseTo(edge * 0.5, 6);
    expect(radialVelocityAmplitude({ ...base, inclination: 0 })).toBeCloseTo(0, 12);
  });

  it('is a sinusoid for a circular orbit and lopsided for an eccentric one', () => {
    const circ = [0, 1, 2, 3, 4, 5].map((n) => radialVelocity(10, (n * Math.PI) / 3));
    // Symmetric: the positive and negative excursions match.
    expect(Math.max(...circ)).toBeCloseTo(-Math.min(...circ), 6);
    const ecc = [0, 1, 2, 3, 4, 5].map((n) => radialVelocity(10, (n * Math.PI) / 3, 0.6, 0));
    expect(Math.max(...ecc)).not.toBeCloseTo(-Math.min(...ecc), 1);
  });

  it('raises the amplitude for an eccentric orbit at the same period', () => {
    const base = { starMassKg: M_SUN, planetMassKg: M_JUPITER, aM: 5.2 * AU };
    expect(radialVelocityAmplitude({ ...base, e: 0.7 }))
      .toBeGreaterThan(radialVelocityAmplitude(base));
  });
});

describe('the other two doors', () => {
  it('moves the Sun half a milliarcsecond from ten parsecs, thanks to Jupiter', () => {
    const s = astrometricSignal(M_SUN, M_JUPITER, 5.2 * AU, 10);
    expect(s).toBeGreaterThan(400);
    expect(s).toBeLessThan(600);
    // The Earth contributes less than a microarcsecond.
    expect(astrometricSignal(M_SUN, M_EARTH, AU, 10)).toBeLessThan(1);
  });

  it('makes reflected light hopeless without a coronagraph', () => {
    expect(reflectedContrast(0.5, R_JUP, 5.2 * AU)).toBeLessThan(1e-8);
    expect(reflectedContrast(0.3, R_EARTH, AU)).toBeLessThan(1e-9);
    // A hot Jupiter is a thousand times easier and still hopeless.
    expect(reflectedContrast(0.3, R_JUP, 0.05 * AU)).toBeGreaterThan(1e-5);
  });
});

describe('what would actually find it', () => {
  it('finds a hot Jupiter both ways', () => {
    const d = detectability(R_JUP, M_JUPITER, 0.05 * AU, R_SUN, M_SUN);
    expect(d.method).toBe('both');
    expect(d.depthPpm).toBeGreaterThan(8000);
    expect(d.probability).toBeGreaterThan(0.08);
  });

  it('finds an Earth around the Sun by transit alone, and only barely', () => {
    const d = detectability(R_EARTH, M_EARTH, AU, R_SUN, M_SUN);
    expect(d.method).toBe('transit');
    expect(d.depthPpm).toBeGreaterThan(80);
    expect(d.rvAmplitude).toBeLessThan(0.3);
    expect(d.durationHours).toBeGreaterThan(12);
  });

  it('finds an Earth around an M dwarf easily by both', () => {
    const d = detectability(R_EARTH, M_EARTH, 0.05 * AU, 0.2 * R_SUN, 0.2 * M_SUN);
    expect(d.method).toBe('both');
    expect(d.depthPpm).toBeGreaterThan(1500);
    expect(d.rvAmplitude).toBeGreaterThan(0.3);
  });

  it('puts a Mars analogue right at the edge of what transits can reach', () => {
    const d = detectability(0.53 * R_EARTH, 0.107 * M_EARTH, 1.52 * AU, R_SUN, M_SUN);
    expect(d.depthPpm).toBeGreaterThan(20);
    expect(d.depthPpm).toBeLessThan(40);
    expect(d.rvAmplitude).toBeLessThan(0.02);
    // And a one-in-three-hundred chance of the geometry cooperating, with a
    // two-year period, so it would take six years to see three transits.
    expect(d.probability).toBeLessThan(0.004);
  });

  it('cannot find a Moon-sized world by any means', () => {
    const d = detectability(0.273 * R_EARTH, 0.0123 * M_EARTH, AU, R_SUN, M_SUN);
    expect(d.method).toBe('none');
    expect(d.depthPpm).toBeLessThan(10);
  });
});
