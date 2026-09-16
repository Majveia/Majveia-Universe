import { describe, expect, it } from 'vitest';
import { LightCone, lightCone } from '../src/cosmology/lightcone';
import {
  PLANCK18, PRESET_COSMOLOGIES, ageAt, comovingDistance, growthFactor, particleHorizon,
} from '../src/cosmology/lcdm';
import { GYR, LY, MPC } from '../src/core/constants';
import { CONE_N } from '../src/render/cosmicweb';

const k = lightCone(PLANCK18);

describe('the cone', () => {
  it('starts at today, where nothing has had time to be old', () => {
    expect(k.growthAt(1, 0)).toBeCloseTo(1, 3);
    expect(k.redshiftAt(1, 0)).toBeCloseTo(0, 3);
    expect(k.lookbackGyr(1, 0)).toBeCloseTo(0, 3);
  });

  it('reaches 46 billion light years, which is how big the observable universe is', () => {
    // The comoving distance light has covered since the Big Bang. It is three
    // times the age of the universe in light years, because the space it was
    // crossing grew while it was in it.
    const horizon = k.horizonMpc(1);
    expect((horizon * MPC) / LY / 1e9).toBeCloseTo(46, 0);
    expect(horizon).toBeGreaterThan(13500);
    expect(horizon).toBeLessThan(14500);
    expect(horizon).toBeCloseTo(particleHorizon(PLANCK18, 1) / MPC, 0);
  });

  it('inverts conformal time to the same answer the distance integral gives', () => {
    // The real check. `comovingDistance` integrates 1/E over redshift;
    // the cone integrates 1/(a^2 E) over the scale factor and then inverts it.
    // They are different integrals of different variables and they have to
    // agree, or one of them is wrong.
    for (const z of [0.1, 0.5, 1, 2, 5, 10]) {
      const r = comovingDistance(PLANCK18, z) / MPC;
      expect(k.redshiftAt(1, r), `z = ${z}`).toBeCloseTo(z, 1);
    }
  });

  it('gets the look-back times everybody quotes', () => {
    // z = 1 is 7.9 Gyr ago and z = 2 is 10.5, which is the pair that makes
    // most of cosmology's "half the age of the universe" statements true.
    const at = (z: number) => k.lookbackGyr(1, comovingDistance(PLANCK18, z) / MPC);
    expect(at(1)).toBeCloseTo(7.9, 0);
    expect(at(2)).toBeCloseTo(10.5, 0);
    expect(at(6)).toBeCloseTo(12.9, 0);
  });

  it('thins structure with distance, monotonically and never backwards', () => {
    let prev = Infinity;
    for (let r = 0; r < 14000; r += 200) {
      const D = k.growthAt(1, r);
      expect(D, `${r} Mpc`).toBeLessThanOrEqual(prev + 1e-9);
      expect(D).toBeGreaterThanOrEqual(0);
      prev = D;
    }
  });

  it('agrees with the growth factor at the epoch it says it is showing', () => {
    // The two answers are looked up from different columns of the same table,
    // so this catches an off-by-one in either.
    for (const r of [100, 800, 2500, 6000]) {
      const a = k.emissionA(1, r);
      expect(k.growthAt(1, r), `${r} Mpc`).toBeCloseTo(growthFactor(PLANCK18, a), 2);
    }
  });

  it('stops at the horizon rather than going through it', () => {
    const h = k.horizonMpc(1);
    expect(k.growthAt(1, h * 1.01)).toBe(0);
    expect(k.growthAt(1, h * 40)).toBe(0);
    expect(k.redshiftAt(1, h * 1.01)).toBe(Infinity);
    // Which is the right answer and not a failure: the field out there is the
    // unperturbed Gaussian it started as, because nothing has reached us from
    // it to say otherwise.
    expect(k.emissionA(1, h * 1.01)).toBe(0);
  });

  it('gives an earlier observer a shorter horizon and a younger sky', () => {
    expect(k.horizonMpc(0.25)).toBeLessThan(k.horizonMpc(1));
    expect(k.horizonMpc(0.25)).toBeCloseTo(particleHorizon(PLANCK18, 0.25) / MPC, 0);
    // And structure right next to them is exactly as grown as that epoch is.
    expect(k.growthAt(0.25, 0)).toBeCloseTo(growthFactor(PLANCK18, 0.25), 2);
  });

  it('measures redshift from the observer, not from us', () => {
    // 1 + z = a_obs / a_e. An observer at z = 3 looking at a = 0.125 sees a
    // redshift of one, not of seven - which matters the moment the timeline is
    // dragged, because then the observer is not us.
    const aObs = 0.25;
    const r = k.horizonMpc(aObs) - k.horizonMpc(0.125);
    expect(k.redshiftAt(aObs, r)).toBeCloseTo(1, 1);
    expect(k.lookbackGyr(aObs, r)).toBeCloseTo(
      (ageAt(PLANCK18, aObs) - ageAt(PLANCK18, 0.125)) / GYR, 1);
  });

  it('works in every cosmology on offer, and gives each a different horizon', () => {
    const horizons = PRESET_COSMOLOGIES.map((c) => new LightCone(c, 128).horizonMpc(1));
    for (const h of horizons) {
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBeGreaterThan(1000);
    }
    // Einstein-de Sitter has no dark energy, so light has covered less ground.
    expect(horizons[1]).toBeLessThan(horizons[0]);
    // And an almost empty universe has covered more.
    expect(horizons[2]).toBeGreaterThan(horizons[0]);
  });
});

describe('the table the shader reads', () => {
  it('is the right length and starts at the observer', () => {
    const t = k.table(1, 1550, CONE_N);
    expect(t.length).toBe(CONE_N);
    expect(t[0]).toBeCloseTo(1, 3);
    expect(t[CONE_N - 1]).toBeCloseTo(k.growthAt(1, 1550), 4);
  });

  it('never rises along its length, so the shader cannot un-collapse anything', () => {
    for (const a of [1, 0.5, 0.2]) {
      const t = k.table(a, 4000, CONE_N);
      for (let i = 1; i < t.length; i++) expect(t[i]).toBeLessThanOrEqual(t[i - 1] + 1e-7);
    }
  });

  it('is smooth enough at 64 entries that interpolating it is honest', () => {
    // The shader reads this with a linear blend between neighbours, so the
    // error that matters is how far the straight line falls from the curve.
    const max = 1550, n = CONE_N;
    const t = k.table(1, max, n);
    let worst = 0;
    for (let i = 0; i < n - 1; i++) {
      const mid = ((i + 0.5) * max) / (n - 1);
      worst = Math.max(worst, Math.abs((t[i] + t[i + 1]) / 2 - k.growthAt(1, mid)));
    }
    expect(worst).toBeLessThan(2e-4);
  });

  it('spans a real range across a box, which is why the picture changes', () => {
    // 620 Mpc of box, tiled three deep, reaches a corner 1.5 Gpc out - and
    // that corner is seen at z = 0.4, where structure had got four fifths of
    // the way to where it is now.
    expect(k.growthAt(1, 620)).toBeCloseTo(0.926, 2);
    expect(k.growthAt(1, 1550)).toBeCloseTo(0.816, 2);
    expect(k.redshiftAt(1, 1550)).toBeCloseTo(0.39, 1);
  });
});
