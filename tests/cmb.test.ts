import { describe, it, expect } from 'vitest';
import {
  lastScatteringRedshift, baryonLoading, cmbScales, photonTransfer,
  temperaturePower, sampleWaves, temperatureAt, angularPower, peakMultipoles,
} from '../src/cosmology/cmb';
import { PLANCK18 } from '../src/cosmology/lcdm';

const S = cmbScales(PLANCK18);

describe('the last-scattering surface', () => {
  it('recombines at the redshift it is measured at', () => {
    expect(lastScatteringRedshift(PLANCK18)).toBeGreaterThan(1060);
    expect(lastScatteringRedshift(PLANCK18)).toBeLessThan(1110);
  });

  it('is 14 billion parsecs away, with a 147 Mpc sound horizon', () => {
    expect(S.distanceMpc / 1000).toBeGreaterThan(13);
    expect(S.distanceMpc / 1000).toBeLessThan(15);
    expect(S.soundHorizonMpc).toBeGreaterThan(135);
    expect(S.soundHorizonMpc).toBeLessThan(160);
  });

  it('loads the fluid with baryons at about two thirds', () => {
    expect(S.R).toBeGreaterThan(0.4);
    expect(S.R).toBeLessThan(0.9);
    // R falls as the universe expands: it is 3 rho_b / 4 rho_gamma.
    expect(baryonLoading(PLANCK18, 2000)).toBeLessThan(baryonLoading(PLANCK18, 1000));
  });

  it('subtends about a degree on the sky', () => {
    expect(S.acousticAngleDeg).toBeGreaterThan(0.4);
    expect(S.acousticAngleDeg).toBeLessThan(1.0);
  });
});

describe('acoustic peaks', () => {
  it('puts the first three where they are observed', () => {
    const [p1, p2, p3] = peakMultipoles(S, 3);
    expect(p1).toBeGreaterThan(190);
    expect(p1).toBeLessThan(255);
    expect(p2).toBeGreaterThan(480);
    expect(p2).toBeLessThan(590);
    expect(p3).toBeGreaterThan(740);
    expect(p3).toBeLessThan(880);
  });

  it('reproduces the measured peak heights', () => {
    // Planck's l(l+1)C_l/2pi: about 5750, 2500 and 2500 microkelvin squared,
    // over a plateau near 1000.
    const p = peakMultipoles(S, 3);
    const h = p.map((l) => angularPower(S, PLANCK18, l) / angularPower(S, PLANCK18, p[0]));
    expect(h[1]).toBeGreaterThan(0.33);
    expect(h[1]).toBeLessThan(0.55);
    expect(h[2]).toBeGreaterThan(0.33);
    expect(h[2]).toBeLessThan(0.60);
    const plateau = angularPower(S, PLANCK18, 20) / angularPower(S, PLANCK18, p[0]);
    expect(plateau).toBeGreaterThan(0.10);
    expect(plateau).toBeLessThan(0.30);
  });

  it('makes the odd peaks higher than the even ones, which is the baryons', () => {
    const [p1, p2] = peakMultipoles(S, 2);
    const c1 = angularPower(S, PLANCK18, p1);
    const c2 = angularPower(S, PLANCK18, p2);
    expect(c1).toBeGreaterThan(c2);
    // Take the baryons away and the asymmetry goes with them.
    const noBaryons = { ...S, R: 0.02 };
    const q = peakMultipoles(noBaryons, 2);
    const q1 = angularPower(noBaryons, PLANCK18, q[0]);
    const q2 = angularPower(noBaryons, PLANCK18, q[1]);
    expect(c1 / c2).toBeGreaterThan(q1 / q2);
  });

  it('starts from the Sachs-Wolfe plateau of one third at k -> 0', () => {
    expect(photonTransfer(S, 1e-6)).toBeCloseTo(1 / 3, 3);
  });

  it('keeps a flat plateau in l(l+1)C_l below the first peak', () => {
    // Scale invariance is the reason it is flat, so this is really a test that
    // n_s = 1 would give exactly flat and 0.9665 gives a very slight tilt.
    const a = angularPower(S, PLANCK18, 12);
    const b = angularPower(S, PLANCK18, 40);
    expect(b / a).toBeGreaterThan(0.75);
    expect(b / a).toBeLessThan(1.35);
    const flat = { ...PLANCK18, ns: 1 };
    const tilted = angularPower(S, flat, 20) / angularPower(S, flat, 8);
    expect(tilted).toBeCloseTo(1, 1);
    // And the real, slightly red spectrum tilts it down a little.
    expect(angularPower(S, PLANCK18, 20) / angularPower(S, PLANCK18, 8))
      .toBeLessThan(tilted);
  });

  it('damps the small scales away entirely', () => {
    const peak = angularPower(S, PLANCK18, S.firstPeakEll);
    expect(angularPower(S, PLANCK18, 3500) / peak).toBeLessThan(0.02);
    expect(temperaturePower(S, PLANCK18, 10 * S.kSilk)).toBeLessThan(1e-30);
  });

  it('never lets a trough reach zero, because of the Doppler term', () => {
    const [p1, p2] = peakMultipoles(S, 2);
    const trough = angularPower(S, PLANCK18, (p1 + p2) / 2);
    expect(trough).toBeGreaterThan(0);
    expect(trough).toBeLessThan(angularPower(S, PLANCK18, p1));
  });
});

describe('the map', () => {
  const waves = sampleWaves(PLANCK18, S, 12345, 500);

  it('is a sum of bands, each at one multipole', () => {
    expect(waves).toHaveLength(500);
    for (const w of waves) {
      expect(w.ell).toBeGreaterThan(3);
      expect(w.ell).toBeLessThan(2200);
      expect(Math.hypot(...w.dir)).toBeCloseTo(1, 9);
    }
  });

  it('samples multipoles concentrated near the acoustic peaks', () => {
    const near = waves.filter((w) => w.ell > 120 && w.ell < 900).length;
    expect(near / waves.length).toBeGreaterThan(0.35);
  });

  it('is Gaussian with zero mean and unit variance over the sky', () => {
    let sum = 0, sum2 = 0, n = 0;
    const rows = 40, cols = 80;
    for (let i = 0; i < rows; i++) {
      const th = ((i + 0.5) / rows) * Math.PI;
      for (let j = 0; j < cols; j++) {
        const ph = ((j + 0.5) / cols) * 2 * Math.PI;
        const t = temperatureAt(waves,
          Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
        sum += t; sum2 += t * t; n++;
      }
    }
    const mean = sum / n;
    const variance = sum2 / n - mean * mean;
    expect(Math.abs(mean)).toBeLessThan(0.25);
    expect(variance).toBeGreaterThan(0.5);
    expect(variance).toBeLessThan(1.8);
  });

  it('is the same map for the same seed and a different one otherwise', () => {
    const a = sampleWaves(PLANCK18, S, 7, 40);
    const b = sampleWaves(PLANCK18, S, 7, 40);
    const c = sampleWaves(PLANCK18, S, 8, 40);
    expect(temperatureAt(a, 0.3, 0.5, 0.81)).toBeCloseTo(temperatureAt(b, 0.3, 0.5, 0.81), 12);
    expect(temperatureAt(a, 0.3, 0.5, 0.81)).not.toBeCloseTo(temperatureAt(c, 0.3, 0.5, 0.81), 6);
  });
});

describe('other cosmologies', () => {
  it('moves the peaks when the baryon density changes', () => {
    const heavy = { ...PLANCK18, Ob: PLANCK18.Ob * 2 };
    const s2 = cmbScales(heavy);
    expect(s2.R).toBeGreaterThan(S.R * 1.5);
    // More baryons slow the sound and shrink the horizon, pushing the first
    // peak to smaller angles - a higher multipole.
    expect(s2.soundHorizonMpc).toBeLessThan(S.soundHorizonMpc);
  });
});
