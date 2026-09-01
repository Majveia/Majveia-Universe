import { describe, it, expect } from 'vitest';
import {
  PLANCK18, ageToday, growthFactor, growthRate, E, comovingDistance,
  scaleFactorAtTime, ageAt, decelerationParameter, matterRadiationEqualityRedshift,
} from '../src/cosmology/lcdm';
import { PowerSpectrum } from '../src/cosmology/powerspectrum';
import { FFT1D, FFT3D } from '../src/cosmology/fft';
import { generateCosmicWeb, symmetricEigenvalues3 } from '../src/cosmology/zeldovich';
import { MPC, GYR } from '../src/core/constants';

describe('LambdaCDM background', () => {
  it('reproduces the Planck 2018 age of the universe', () => {
    // Planck 2018 quotes 13.787 +/- 0.020 Gyr
    expect(ageToday(PLANCK18)).toBeCloseTo(13.79, 1);
  });

  it('has E(1) = 1 by construction', () => {
    expect(E(PLANCK18, 1)).toBeCloseTo(1, 6);
  });

  it('normalises the growth factor to unity today', () => {
    expect(growthFactor(PLANCK18, 1)).toBeCloseTo(1, 4);
  });

  it('grows like D ~ a deep in matter domination', () => {
    // At a = 0.02 (z = 49) LambdaCDM is matter dominated, so D/a is nearly constant.
    const r1 = growthFactor(PLANCK18, 0.02) / 0.02;
    const r2 = growthFactor(PLANCK18, 0.05) / 0.05;
    expect(Math.abs(r1 / r2 - 1)).toBeLessThan(0.02);
  });

  it('matches the Om^0.55 growth-rate approximation today', () => {
    const f = growthRate(PLANCK18, 1);
    expect(f).toBeCloseTo(Math.pow(PLANCK18.Om, 0.55), 2);
  });

  it('inverts t(a) consistently', () => {
    const t = ageAt(PLANCK18, 0.37);
    expect(scaleFactorAtTime(PLANCK18, t)).toBeCloseTo(0.37, 3);
  });

  it('gives an accelerating universe today and a decelerating one at z = 2', () => {
    expect(decelerationParameter(PLANCK18, 1)).toBeLessThan(0);
    expect(decelerationParameter(PLANCK18, 1 / 3)).toBeGreaterThan(0);
  });

  it('puts matter-radiation equality near z ~ 3400', () => {
    expect(matterRadiationEqualityRedshift(PLANCK18)).toBeGreaterThan(3000);
    expect(matterRadiationEqualityRedshift(PLANCK18)).toBeLessThan(3800);
  });

  it('gives a sensible comoving distance to z = 1', () => {
    const d = comovingDistance(PLANCK18, 1) / MPC;
    expect(d).toBeGreaterThan(3300);
    expect(d).toBeLessThan(3400);
  });

  it('has a Hubble time longer than the age of the universe', () => {
    expect(1 / ((PLANCK18.H0 * 1e3) / MPC) / GYR).toBeGreaterThan(ageToday(PLANCK18));
  });
});

describe('matter power spectrum', () => {
  const ps = new PowerSpectrum(PLANCK18);

  it('recovers sigma_8 after normalisation', () => {
    expect(ps.sigmaR(8 / 0.6766)).toBeCloseTo(PLANCK18.sigma8, 3);
  });

  it('puts the BAO sound horizon near 147 Mpc', () => {
    // Planck 2018: r_drag = 147.09 +/- 0.26 Mpc
    expect(ps.baoScaleMpc).toBeGreaterThan(140);
    expect(ps.baoScaleMpc).toBeLessThan(155);
  });

  it('peaks near the horizon scale at matter-radiation equality', () => {
    let best = 0, bestK = 0;
    for (let i = 0; i < 400; i++) {
      const k = Math.exp(Math.log(1e-4) + (i / 399) * (Math.log(1) - Math.log(1e-4)));
      const p = ps.P(k);
      if (p > best) { best = p; bestK = k; }
    }
    // k_eq ~ 0.010-0.020 Mpc^-1
    expect(bestK).toBeGreaterThan(0.005);
    expect(bestK).toBeLessThan(0.03);
  });

  it('falls off as roughly k^{n_s - 4} on small scales', () => {
    const slope = Math.log(ps.P(5) / ps.P(1)) / Math.log(5);
    expect(slope).toBeLessThan(-2.4);
    expect(slope).toBeGreaterThan(-3.4);
  });

  it('shows baryon acoustic wiggles', () => {
    // The transfer function should oscillate around the smooth trend near k ~ 0.05-0.3
    const ks: number[] = [], ps_: number[] = [];
    for (let i = 0; i < 200; i++) {
      const k = 0.02 + (i / 199) * 0.28;
      ks.push(k); ps_.push(Math.log(ps.P(k)));
    }
    // second difference should change sign several times if wiggles exist
    let signChanges = 0;
    let prev = 0;
    for (let i = 1; i < ps_.length - 1; i++) {
      const d2 = ps_[i + 1] - 2 * ps_[i] + ps_[i - 1];
      if (prev !== 0 && Math.sign(d2) !== Math.sign(prev)) signChanges++;
      prev = d2;
    }
    expect(signChanges).toBeGreaterThan(2);
  });
});

describe('FFT', () => {
  it('round-trips a 1-D signal', () => {
    const n = 64;
    const f = new FFT1D(n);
    const re = new Float64Array(n), im = new Float64Array(n);
    const orig: number[] = [];
    for (let i = 0; i < n; i++) { re[i] = Math.sin(i * 0.3) + 0.5 * Math.cos(i * 1.1); orig.push(re[i]); }
    f.transform(re, im, 0, 1, -1);
    f.transform(re, im, 0, 1, +1);
    for (let i = 0; i < n; i++) expect(re[i] / n).toBeCloseTo(orig[i], 9);
  });

  it('turns a delta function into a flat spectrum', () => {
    const n = 32;
    const f = new FFT1D(n);
    const re = new Float64Array(n), im = new Float64Array(n);
    re[0] = 1;
    f.transform(re, im, 0, 1, -1);
    for (let i = 0; i < n; i++) expect(Math.hypot(re[i], im[i])).toBeCloseTo(1, 9);
  });

  it('round-trips a 3-D cube', () => {
    const n = 16;
    const f = new FFT3D(n);
    const n3 = n ** 3;
    const re = new Float64Array(n3), im = new Float64Array(n3);
    const orig = new Float64Array(n3);
    for (let i = 0; i < n3; i++) { re[i] = Math.sin(i * 0.017) * Math.cos(i * 0.0031); orig[i] = re[i]; }
    f.transform(re, im, -1);
    f.transform(re, im, +1);
    for (let i = 0; i < n3; i += 97) expect(re[i] / n3).toBeCloseTo(orig[i], 8);
  });
});

describe('symmetric eigenvalues', () => {
  it('matches a known diagonal case', () => {
    const [a, b, c] = symmetricEigenvalues3(3, 0, 0, 1, 0, 2);
    expect([a, b, c]).toEqual([3, 2, 1]);
  });
  it('reproduces trace and determinant', () => {
    const m = { a: 2, b: -1, c: 0.5, d: 3, e: 0.25, f: -1.5 };
    const [l1, l2, l3] = symmetricEigenvalues3(m.a, m.b, m.c, m.d, m.e, m.f);
    expect(l1 + l2 + l3).toBeCloseTo(m.a + m.d + m.f, 8);
    const det =
      m.a * (m.d * m.f - m.e * m.e) - m.b * (m.b * m.f - m.e * m.c) + m.c * (m.b * m.e - m.d * m.c);
    expect(l1 * l2 * l3).toBeCloseTo(det, 8);
    expect(l1).toBeGreaterThanOrEqual(l2);
    expect(l2).toBeGreaterThanOrEqual(l3);
  });
});

describe('cosmic web generation', () => {
  const field = generateCosmicWeb({ n: 32, boxMpc: 300, seed: 1234, cosmology: PLANCK18, smoothCells: 1.0 });

  it('produces one displacement per grid point', () => {
    expect(field.count).toBe(32 ** 3);
    expect(field.psi.length).toBe(32 ** 3 * 3);
  });

  it('has a zero-mean displacement field', () => {
    let sx = 0;
    for (let i = 0; i < field.count; i++) sx += field.psi[i * 3];
    expect(Math.abs(sx / field.count)).toBeLessThan(0.05 * field.rmsDisplacement);
  });

  it('gives displacements of a physically plausible size', () => {
    // Linear-theory rms displacement today is a few Mpc; smoothing reduces it.
    expect(field.rmsDisplacement).toBeGreaterThan(1);
    expect(field.rmsDisplacement).toBeLessThan(40);
  });

  it('has eigenvalues summing to the divergence of the displacement', () => {
    // sum(lambda) = -div(Psi) = delta_linear, so its mean must be ~0
    let s = 0;
    for (let i = 0; i < field.count; i++) {
      s += field.lambda[i * 3] + field.lambda[i * 3 + 1] + field.lambda[i * 3 + 2];
    }
    expect(Math.abs(s / field.count)).toBeLessThan(1e-3);
  });

  it('produces all four cosmic-web environments', () => {
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < field.count; i++) {
      let k = 0;
      if (field.lambda[i * 3] > 0) k++;
      if (field.lambda[i * 3 + 1] > 0) k++;
      if (field.lambda[i * 3 + 2] > 0) k++;
      counts[k]++;
    }
    // voids, sheets, filaments and knots should all be populated
    for (const c of counts) expect(c).toBeGreaterThan(0);
    // and voids should occupy far more volume than knots
    expect(counts[0]).toBeGreaterThan(counts[3]);
  });

  it('is deterministic for a fixed seed', () => {
    const b = generateCosmicWeb({ n: 16, boxMpc: 300, seed: 7, cosmology: PLANCK18 });
    const c = generateCosmicWeb({ n: 16, boxMpc: 300, seed: 7, cosmology: PLANCK18 });
    expect(Array.from(b.psi.slice(0, 60))).toEqual(Array.from(c.psi.slice(0, 60)));
  });
});
