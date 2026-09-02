import { describe, it, expect } from 'vitest';
import {
  planck, wienPeakNm, lineStrength, blanketing, fluxAt, sampleSpectrum,
  prominentLines, wavelengthRGB, LINES,
} from '../src/astro/spectrum';

const line = (species: string, nm: number) => {
  const l = LINES.find((x) => x.species === species && Math.abs(x.nm - nm) < 1);
  if (!l) throw new Error(`no ${species} at ${nm}`);
  return l;
};

describe('the Planck continuum', () => {
  it('peaks where Wien says it does', () => {
    for (const T of [3000, 5772, 12000, 30000]) {
      const peak = wienPeakNm(T);
      const here = planck(peak * 1e-9, T);
      expect(planck(peak * 0.8e-9, T)).toBeLessThan(here);
      expect(planck(peak * 1.25e-9, T)).toBeLessThan(here);
    }
  });

  it('puts the solar peak in the green, at 502 nm', () => {
    expect(wienPeakNm(5772)).toBeCloseTo(502, 0);
  });

  it('rises everywhere with temperature, as Planck curves never cross', () => {
    for (const nm of [400, 550, 700]) {
      let last = 0;
      for (const T of [2000, 4000, 6000, 10000, 25000]) {
        const f = planck(nm * 1e-9, T);
        expect(f).toBeGreaterThan(last);
        last = f;
      }
    }
  });

  it('does not underflow at the long-wavelength end', () => {
    expect(planck(1e-3, 2.7)).toBeGreaterThan(0);
    expect(Number.isFinite(planck(1e-3, 2.7))).toBe(true);
  });
});

describe('line strengths follow ionisation, not abundance', () => {
  it('peaks the Balmer series at A0 and not at the coolest stars', () => {
    const ha = line('H I', 656.28);
    const atA0 = lineStrength(ha, 9500);
    expect(atA0).toBeCloseTo(1, 6);
    // Hydrogen is the most abundant element in all three, and yet:
    expect(lineStrength(ha, 3200)).toBeLessThan(0.06);   // M: no excited atoms
    expect(lineStrength(ha, 35000)).toBeLessThan(0.06);  // O: no atoms left
  });

  it('needs an O star to show ionised helium and a B star for neutral', () => {
    const he1 = line('He I', 447.15);
    const he2 = line('He II', 468.57);
    expect(lineStrength(he2, 40000)).toBeGreaterThan(lineStrength(he2, 20000) * 5);
    expect(lineStrength(he1, 19000)).toBeGreaterThan(lineStrength(he1, 5772) * 100);
    expect(lineStrength(he1, 5772)).toBeLessThan(1e-6);
  });

  it('makes Ca II H and K the strongest thing in a solar spectrum', () => {
    const k = line('Ca II', 393.37);
    const solar = LINES.map((l) => ({ l, s: l.depth * lineStrength(l, 5772) }))
      .sort((a, b) => b.s - a.s);
    expect(solar[0].l.nm).toBeCloseTo(k.nm, 2);
  });

  it('only lets molecules survive in the coolest photospheres', () => {
    for (const l of LINES.filter((x) => x.species === 'TiO')) {
      expect(lineStrength(l, 3000)).toBeGreaterThan(0.5);
      expect(lineStrength(l, 5772)).toBeLessThan(0.02);
      expect(lineStrength(l, 12000)).toBeLessThan(1e-6);
    }
  });
});

describe('the spectrum as a whole', () => {
  it('cuts a visible notch at H-alpha in an A star', () => {
    const T = 9500;
    const inLine = fluxAt(656.28, T);
    const nearby = fluxAt(646, T);
    expect(inLine / nearby).toBeLessThan(0.55);
  });

  it('cuts a far shallower one in an M dwarf, where hydrogen has no electrons up', () => {
    // Not a clean measurement in the real world either: the whole region is
    // under a TiO band by then. So the comparison is with the same pair of
    // wavelengths in an A star, where the notch is unmistakable.
    const notch = (T: number) => fluxAt(656.28, T) / fluxAt(646, T);
    expect(notch(3200)).toBeGreaterThan(notch(9500) * 1.5);
  });

  it('turns an M dwarf spectrum into a comb of molecular bands', () => {
    const s = sampleSpectrum(3100, 400);
    let dips = 0;
    for (let i = 2; i < s.length - 2; i++) {
      if (s[i] < s[i - 2] && s[i] < s[i + 2] && s[i] < 0.9) dips++;
    }
    expect(dips).toBeGreaterThan(4);
  });

  it('normalises to a peak of one', () => {
    for (const T of [2800, 5772, 30000]) {
      const s = sampleSpectrum(T, 200);
      expect(Math.max(...s)).toBeCloseTo(1, 6);
      expect(Math.min(...s)).toBeGreaterThanOrEqual(0);
    }
  });

  it('slopes to the blue for a hot star and to the red for a cool one', () => {
    const hot = sampleSpectrum(25000, 200);
    const cool = sampleSpectrum(3000, 200);
    expect(hot[5]).toBeGreaterThan(hot[195]);
    expect(cool[5]).toBeLessThan(cool[195]);
  });

  it('depresses the blue continuum of a cool metal-rich star', () => {
    expect(blanketing(700, 4500)).toBe(1);
    expect(blanketing(400, 4500)).toBeLessThan(0.85);
    expect(blanketing(400, 4500, 0.4)).toBeLessThan(blanketing(400, 4500, -0.4));
    expect(blanketing(400, 12000)).toBe(1);
  });

  it('deepens metal lines with metallicity and leaves hydrogen alone', () => {
    const rich = fluxAt(589.16, 4500, { metallicity: 0.5 });
    const poor = fluxAt(589.16, 4500, { metallicity: -0.8 });
    expect(rich / poor).toBeLessThan(1);
    const hRich = fluxAt(656.28, 9500, { metallicity: 0.5 });
    const hPoor = fluxAt(656.28, 9500, { metallicity: -0.8 });
    expect(hRich / hPoor).toBeCloseTo(1, 6);
  });

  it('washes lines out with rotation without moving the continuum', () => {
    const sharp = fluxAt(486.13, 9500, { vsini: 0 });
    const smeared = fluxAt(486.13, 9500, { vsini: 250 });
    expect(smeared).toBeGreaterThan(sharp);
    expect(fluxAt(700, 9500, { vsini: 250 }) / fluxAt(700, 9500)).toBeCloseTo(1, 4);
  });

  it('names different lines for different stars', () => {
    const names = (T: number) => prominentLines(T).map((l) => l.label);
    expect(names(9500)).toContain('Hα');
    expect(names(5772)).toContain('K');
    expect(names(3100)).toContain('TiO');
    expect(names(3100)).not.toContain('Hα');
    expect(names(40000)).toContain('He II');
  });
});

describe('the spectrum strip', () => {
  it('runs violet through red across the visible band', () => {
    const [, , b400] = wavelengthRGB(400);
    const [r650] = wavelengthRGB(650);
    const [, g530] = wavelengthRGB(530);
    expect(b400).toBeGreaterThan(0.5);
    expect(r650).toBeGreaterThan(0.9);
    expect(g530).toBeGreaterThan(0.9);
  });

  it('fades out at both ends of what the eye can see', () => {
    const near = wavelengthRGB(385);
    const far = wavelengthRGB(775);
    expect(Math.max(...near)).toBeLessThan(0.45);
    expect(Math.max(...far)).toBeLessThan(0.45);
  });
});
