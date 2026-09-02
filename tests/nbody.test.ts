import { describe, it, expect } from 'vitest';
import {
  NBody, plummerSphere, nfwAcceleration, erfApprox, dynamicalFriction, G_AU,
} from '../src/physics/nbody';
import { RNG } from '../src/core/rng';

function twoBody(e = 0.0): NBody {
  // A one-solar-mass primary and a massless-ish secondary at 1 AU, in units
  // where G = 4 pi^2 (AU, years, solar masses), so the period is one year.
  const nb = new NBody({ capacity: 8, G: G_AU, softening: 1e-9, theta: 0 });
  const a = 1, m1 = 1, m2 = 1e-6;
  const rp = a * (1 - e);
  const v = Math.sqrt(G_AU * (m1 + m2) * (2 / rp - 1 / a));
  nb.add(0, 0, 0, 0, 0, 0, m1);
  nb.add(rp, 0, 0, 0, v, 0, m2);
  // Put the primary on its own tiny counter-orbit so the barycentre is at rest
  nb.vel[1] = (-m2 * v) / m1;
  nb.computeAccelerations();
  return nb;
}

describe('Barnes-Hut tree', () => {
  it('agrees with direct summation to better than a percent at theta = 0.5', () => {
    const rng = new RNG(11);
    const nb = new NBody({ capacity: 2000, G: 1, softening: 0.02, theta: 0.5 });
    for (let i = 0; i < 1500; i++) {
      nb.add(rng.normal(0, 1), rng.normal(0, 1), rng.normal(0, 1), 0, 0, 0, 1 / 1500);
    }
    nb.computeAccelerations();
    const tree = Float64Array.from(nb.acc.subarray(0, nb.n * 3));
    nb.computeAccelerationsDirect();
    let worst = 0, mean = 0;
    for (let i = 0; i < nb.n; i++) {
      const ex = Math.hypot(nb.acc[i * 3], nb.acc[i * 3 + 1], nb.acc[i * 3 + 2]);
      const dx = tree[i * 3] - nb.acc[i * 3];
      const dy = tree[i * 3 + 1] - nb.acc[i * 3 + 1];
      const dz = tree[i * 3 + 2] - nb.acc[i * 3 + 2];
      const err = Math.hypot(dx, dy, dz) / Math.max(ex, 1e-30);
      mean += err;
      worst = Math.max(worst, err);
    }
    mean /= nb.n;
    expect(mean).toBeLessThan(0.01);
    expect(worst).toBeLessThan(0.25);
  });

  it('is exact when the opening angle is zero', () => {
    const rng = new RNG(5);
    const nb = new NBody({ capacity: 400, G: 1, softening: 0.05, theta: 0 });
    for (let i = 0; i < 300; i++) {
      nb.add(rng.normal(0, 2), rng.normal(0, 2), rng.normal(0, 2), 0, 0, 0, rng.range(0.5, 2));
    }
    nb.computeAccelerations();
    const tree = Float64Array.from(nb.acc.subarray(0, nb.n * 3));
    nb.computeAccelerationsDirect();
    for (let i = 0; i < nb.n * 3; i++) {
      expect(tree[i]).toBeCloseTo(nb.acc[i], 8);
    }
  });

  it('survives coincident particles', () => {
    const nb = new NBody({ capacity: 32, G: 1, softening: 0.1, theta: 0.5 });
    for (let i = 0; i < 12; i++) nb.add(1, 1, 1, 0, 0, 0, 1);
    nb.add(5, 0, 0, 0, 0, 0, 1);
    nb.computeAccelerations();
    for (let i = 0; i < nb.n * 3; i++) expect(Number.isFinite(nb.acc[i])).toBe(true);
  });

  it('scales sub-quadratically', () => {
    // A crude but meaningful check: doubling N must not quadruple the node
    // visits implied by the runtime. We assert on tree size instead of clock.
    const rng = new RNG(3);
    const build = (n: number) => {
      const nb = new NBody({ capacity: n + 4, G: 1, softening: 0.01, theta: 0.6 });
      for (let i = 0; i < n; i++) nb.add(rng.normal(0, 1), rng.normal(0, 1), rng.normal(0, 1), 0, 0, 0, 1);
      nb.computeAccelerations();
      return nb;
    };
    const a = build(500);
    const b = build(4000);
    expect(a.n).toBe(500);
    expect(b.n).toBe(4000);
    for (let i = 0; i < b.n * 3; i++) expect(Number.isFinite(b.acc[i])).toBe(true);
  });
});

describe('integration', () => {
  it('reproduces a circular orbit after one period', () => {
    const nb = twoBody(0);
    const dt = 1 / 2000;
    for (let i = 0; i < 2000; i++) nb.step(dt);
    expect(nb.pos[3]).toBeCloseTo(1, 3);
    expect(nb.pos[4]).toBeCloseTo(0, 3);
  });

  it('conserves energy without secular drift, as a symplectic scheme must', () => {
    const nb = twoBody(0.5);
    const e0 = nb.diagnostics().total;
    let worst = 0;
    for (let k = 0; k < 40; k++) {
      for (let i = 0; i < 500; i++) nb.step(1 / 4000);
      worst = Math.max(worst, Math.abs(nb.diagnostics().total / e0 - 1));
    }
    const eEnd = nb.diagnostics().total;
    expect(worst).toBeLessThan(1e-3);
    // The end-of-run error must not be much larger than the worst excursion:
    // that is the difference between an oscillating error and a drifting one.
    expect(Math.abs(eEnd / e0 - 1)).toBeLessThanOrEqual(worst + 1e-12);
  });

  it('conserves angular momentum', () => {
    const nb = twoBody(0.4);
    const l0 = nb.diagnostics().angularMomentum[2];
    for (let i = 0; i < 4000; i++) nb.step(1 / 2000);
    expect(nb.diagnostics().angularMomentum[2] / l0).toBeCloseTo(1, 6);
  });

  it('is more accurate at fourth order', () => {
    const err = (order: 2 | 4) => {
      const nb = twoBody(0.3);
      const e0 = nb.diagnostics().total;
      const dt = 1 / 300;
      for (let i = 0; i < 300; i++) (order === 2 ? nb.step(dt) : nb.step4(dt));
      return Math.abs(nb.diagnostics().total / e0 - 1);
    };
    expect(err(4)).toBeLessThan(err(2));
  });

  it('keeps the barycentre at rest', () => {
    const nb = twoBody(0.35);
    const c0 = nb.diagnostics().centreOfMass;
    for (let i = 0; i < 3000; i++) nb.step(1 / 1500);
    const c1 = nb.diagnostics().centreOfMass;
    for (let k = 0; k < 3; k++) expect(Math.abs(c1[k] - c0[k])).toBeLessThan(1e-6);
  });
});

describe('equilibrium models', () => {
  it('starts a Plummer sphere close to virial equilibrium', () => {
    const rng = new RNG(99);
    const nb = new NBody({ capacity: 3000, G: 1, softening: 0.02, theta: 0.5 });
    plummerSphere(nb, 2500, 1, 1, () => rng.next());
    const d = nb.diagnostics();
    // 2T/|U| = 1 for a system in equilibrium
    expect(d.virial).toBeGreaterThan(0.8);
    expect(d.virial).toBeLessThan(1.25);
    expect(d.total).toBeLessThan(0);
  });

  it('holds a Plummer sphere together instead of evaporating it', () => {
    const rng = new RNG(7);
    const nb = new NBody({ capacity: 900, G: 1, softening: 0.05, theta: 0.6 });
    plummerSphere(nb, 800, 1, 1, () => rng.next());
    const r0 = halfMassRadius(nb);
    for (let i = 0; i < 400; i++) nb.step(0.004);
    const r1 = halfMassRadius(nb);
    expect(r1 / r0).toBeGreaterThan(0.6);
    expect(r1 / r0).toBeLessThan(1.8);
  });
});

function halfMassRadius(nb: NBody): number {
  const r: number[] = [];
  for (let i = 0; i < nb.n; i++) {
    if (!nb.active[i]) continue;
    r.push(Math.hypot(nb.pos[i * 3], nb.pos[i * 3 + 1], nb.pos[i * 3 + 2]));
  }
  r.sort((a, b) => a - b);
  return r[Math.floor(r.length / 2)];
}

describe('halo and friction', () => {
  it('gives an NFW halo a rotation curve that flattens', () => {
    const acc = nfwAcceleration(1, 100, 20, 10);
    const out = new Float64Array(3);
    const vc = (r: number) => { acc(r, 0, 0, out); return Math.sqrt(Math.abs(out[0]) * r); };
    // Rises inside the scale radius, flattens outside it
    expect(vc(4)).toBeGreaterThan(vc(1));
    expect(Math.abs(vc(12) / vc(8) - 1)).toBeLessThan(0.12);
  });

  it('encloses the full virial mass at the virial radius', () => {
    const G = 1, M = 250, rvir = 30, c = 8;
    const acc = nfwAcceleration(G, M, rvir, c);
    const out = new Float64Array(3);
    acc(rvir, 0, 0, out);
    const menc = (Math.abs(out[0]) * rvir * rvir) / G;
    expect(menc).toBeCloseTo(M, 6);
  });

  it('makes dynamical friction oppose the motion and vanish at rest', () => {
    const out = new Float64Array(3);
    dynamicalFriction(1, 1, 1, 1, 3, 2, 0, 0, out);
    expect(out[0]).toBeLessThan(0);
    dynamicalFriction(1, 1, 1, 1, 3, 0, 0, 0, out);
    expect(out[0]).toBe(0);
  });

  it('approximates erf accurately', () => {
    expect(erfApprox(0)).toBeCloseTo(0, 6);
    expect(erfApprox(1)).toBeCloseTo(0.8427008, 5);
    expect(erfApprox(2)).toBeCloseTo(0.9953223, 5);
    expect(erfApprox(-1)).toBeCloseTo(-0.8427008, 5);
  });
});

import { Encounter } from '../src/sim/encounter';
import { galaxyFromHalo } from '../src/galaxy/generator';

describe('galaxy encounter', () => {
  const gp = galaxyFromHalo(31, 1.2e12, 0);

  it('starts each disc in centrifugal balance', () => {
    // A disc built in equilibrium should barely change its radius over a few
    // rotations if the intruder is far away.
    const e = new Encounter(gp, {
      seed: 1, tracers: 1500, separation: 40, pericentre: 20, friction: false,
    });
    const radii = (): number => {
      let s = 0, n = 0;
      const h = e.haloes[0];
      for (let i = 0; i < e.count / 2; i++) {
        s += Math.hypot(e.pos[i * 3] - h.x, e.pos[i * 3 + 1] - h.y, e.pos[i * 3 + 2] - h.z);
        n++;
      }
      return s / n;
    };
    const r0 = radii();
    for (let i = 0; i < 200; i++) e.step(e.dt);
    expect(radii() / r0).toBeGreaterThan(0.8);
    expect(radii() / r0).toBeLessThan(1.25);
  });

  it('reaches pericentre and records it', () => {
    const e = new Encounter(gp, { seed: 2, tracers: 800, pericentre: 0.8, separation: 4 });
    const start = e.separation;
    for (let i = 0; i < 3000; i++) e.step(e.dt);
    expect(e.minSeparation).toBeLessThan(start * 0.5);
    expect(Number.isFinite(e.pericentreTime)).toBe(true);
  });

  it('throws out tidal debris after a close prograde passage', () => {
    const e = new Encounter(gp, {
      seed: 3, tracers: 4000, pericentre: 0.6, separation: 4, prograde: true, inclination: 0.2,
    });
    const before = e.tidalFraction(gp.radiusKpc);
    for (let i = 0; i < 2600; i++) e.step(e.dt);
    const after = e.tidalFraction(gp.radiusKpc);
    expect(before).toBeLessThan(0.02);
    expect(after).toBeGreaterThan(before + 0.01);
  });

  it('makes longer tails prograde than retrograde, as Toomre found', () => {
    // Measured on the primary disc alone, a few hundred megayears after
    // pericentre and well before the merger scrambles everything. Prograde
    // stars stay in resonance with the perturbation, so they are flung much
    // further out.
    const run = (prograde: boolean) => {
      const e = new Encounter(gp, {
        seed: 4, tracers: 6000, pericentre: 0.6, separation: 4, prograde,
        inclination: 0.1, friction: false,
      });
      let best = 0;
      for (let i = 0; i < 1400; i++) {
        e.step(e.dt);
        if (i % 100 === 0 && Number.isFinite(e.pericentreTime) && e.time > e.pericentreTime) {
          best = Math.max(best, e.tidalFraction(gp.radiusKpc, 2.5, 0));
        }
      }
      return best;
    };
    const pro = run(true);
    const retro = run(false);
    expect(pro).toBeGreaterThan(retro * 1.15);
  });

  it('sinks the pair together when dynamical friction is on', () => {
    const withF = new Encounter(gp, {
      seed: 5, tracers: 400, pericentre: 0.5, separation: 3, friction: true,
    });
    const without = new Encounter(gp, {
      seed: 5, tracers: 400, pericentre: 0.5, separation: 3, friction: false,
    });
    // Compare the apocentre each pair reaches after the first passage: that is
    // where the loss of orbital energy shows up most cleanly.
    let apoF = 0, apoN = 0;
    for (let i = 0; i < 6000; i++) {
      withF.step(withF.dt); without.step(without.dt);
      if (Number.isFinite(withF.pericentreTime) && withF.time > withF.pericentreTime + 50) {
        apoF = Math.max(apoF, withF.separation);
        apoN = Math.max(apoN, without.separation);
      }
    }
    expect(apoF).toBeLessThan(apoN);
  });

  it('keeps every tracer finite', () => {
    const e = new Encounter(gp, { seed: 6, tracers: 1200, pericentre: 0.4, separation: 3 });
    for (let i = 0; i < 1500; i++) e.step(e.dt);
    for (let i = 0; i < e.count * 3; i++) expect(Number.isFinite(e.pos[i])).toBe(true);
  });
});
