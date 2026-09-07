import { describe, it, expect } from 'vitest';
import {
  G_MPC_MYR, KMS_TO_MPC_MYR, ClusterOrbits, jeansDispersion, nfwEnclosedMass,
  nfwDensity, nfwMu, circularSpeed, escapeSpeed, haloAcceleration, icmDensity,
  bindingPressure, ramPressure, retainedFraction, ICM_GAS_FRACTION,
  type Halo, type OrbitSeed,
} from '../src/physics/clusterorbits';
import { G, M_SUN, MPC, MYR } from '../src/core/constants';
import { RNG } from '../src/core/rng';

/** Something like Coma: 1e15 solar masses inside a couple of megaparsecs. */
const COMA: Halo = { massMsun: 1e15, radiusMpc: 2.2, concentration: 5 };

function seedCluster(h: Halo, n: number, seed = 7): ClusterOrbits {
  const rng = new RNG(seed);
  const c = new ClusterOrbits(h, n);
  for (let i = 0; i < n; i++) {
    // Sample the NFW profile by inverting its enclosed mass numerically.
    const target = rng.next() * nfwEnclosedMass(h, h.radiusMpc);
    let lo = 1e-5, hi = h.radiusMpc;
    for (let k = 0; k < 60; k++) {
      const mid = 0.5 * (lo + hi);
      if (nfwEnclosedMass(h, mid) < target) lo = mid; else hi = mid;
    }
    const r = 0.5 * (lo + hi);
    const cz = 1 - 2 * rng.next();
    const phi = 2 * Math.PI * rng.next();
    const sr = Math.sqrt(1 - cz * cz);
    const s: OrbitSeed = {
      x: r * sr * Math.cos(phi), y: r * sr * Math.sin(phi), z: r * cz,
      haloMassMsun: 0, stellarMsun: 5e10, radiusMpc: 0.0026, gasFraction: 0.12,
    };
    c.place(s, () => rng.next());
  }
  c.settle();
  return c;
}

describe('units a cluster is comfortable in', () => {
  it('puts Newtons constant at about four and a half times ten to the minus twenty-one', () => {
    expect(G_MPC_MYR / 4.4985e-21).toBeCloseTo(1, 3);
  });

  it('agrees with the value astronomers quote in Mpc, km/s and solar masses', () => {
    // G = 4.3009e-9 Mpc (km/s)^2 / Msun is the form every cluster paper uses.
    const inKms2 = G_MPC_MYR / (KMS_TO_MPC_MYR * KMS_TO_MPC_MYR);
    expect(inKms2 / 4.3009e-9).toBeCloseTo(1, 3);
  });

  it('converts a kilometre a second into about a millionth of a megaparsec per megayear', () => {
    expect(KMS_TO_MPC_MYR / 1.0227e-6).toBeCloseTo(1, 3);
    // A galaxy at 1000 km/s crosses a megaparsec in a gigayear, near enough.
    expect((1000 * KMS_TO_MPC_MYR) * 1000).toBeCloseTo(1.02, 2);
  });

  it('is the same constant as the SI one, only wearing different clothes', () => {
    expect(G_MPC_MYR / ((G * M_SUN * MYR * MYR) / (MPC * MPC * MPC))).toBeCloseTo(1, 12);
  });
});

describe('the halo', () => {
  it('contains exactly its virial mass inside its virial radius', () => {
    expect(nfwEnclosedMass(COMA, COMA.radiusMpc) / COMA.massMsun).toBeCloseTo(1, 9);
  });

  it('contains nothing at the centre', () => {
    expect(nfwEnclosedMass(COMA, 0)).toBe(0);
  });

  it('keeps rising outside the virial radius, because an NFW halo has no edge', () => {
    expect(nfwEnclosedMass(COMA, 10 * COMA.radiusMpc)).toBeGreaterThan(COMA.massMsun);
    // But only logarithmically: ten times the radius is not ten times the mass.
    expect(nfwEnclosedMass(COMA, 10 * COMA.radiusMpc)).toBeLessThan(4 * COMA.massMsun);
  });

  it('integrates its own density back to its own mass', () => {
    // 4 pi integral r^2 rho dr, on a log grid, out to the virial radius.
    let m = 0;
    const n = 4000, lo = Math.log(1e-6), hi = Math.log(COMA.radiusMpc);
    const dl = (hi - lo) / n;
    for (let i = 0; i < n; i++) {
      const r = Math.exp(lo + (i + 0.5) * dl);
      m += 4 * Math.PI * r * r * r * nfwDensity(COMA, r) * dl;
    }
    expect(m / COMA.massMsun).toBeCloseTo(1, 2);
  });

  it('gives a cluster a circular speed of a couple of thousand kilometres a second', () => {
    const v = circularSpeed(COMA, COMA.radiusMpc) / KMS_TO_MPC_MYR;
    expect(v).toBeGreaterThan(1000);
    expect(v).toBeLessThan(2500);
  });

  it('has a flat-ish rotation curve inside the scale radius, which is the point of NFW', () => {
    const rs = COMA.radiusMpc / COMA.concentration;
    const a = circularSpeed(COMA, rs * 0.5);
    const b = circularSpeed(COMA, rs * 2);
    expect(Math.max(a, b) / Math.min(a, b)).toBeLessThan(1.25);
  });

  it('asks for more than the circular speed to leave, but not infinitely more', () => {
    const r = COMA.radiusMpc * 0.4;
    const ratio = escapeSpeed(COMA, r) / circularSpeed(COMA, r);
    expect(ratio).toBeGreaterThan(1.4);
    expect(ratio).toBeLessThan(3);
  });

  it('accelerates straight at the centre, at GM(r)/r^2', () => {
    const a = haloAcceleration(COMA);
    const out = new Float64Array(3);
    const r = 0.7;
    a(r, 0, 0, out);
    expect(out[1]).toBeCloseTo(0, 30);
    expect(out[2]).toBeCloseTo(0, 30);
    expect(out[0]).toBeLessThan(0);
    const want = (G_MPC_MYR * nfwEnclosedMass(COMA, r)) / (r * r);
    expect(Math.abs(out[0]) / want).toBeCloseTo(1, 9);
  });

  it('approaches a finite pull at the centre, which is what a cusp means', () => {
    // rho ~ 1/r near the middle, so M ~ r^2 and GM/r^2 tends to a constant
    // rather than to zero. The limit is norm / 2 rs^2, and an NFW halo really
    // does pull on something sitting exactly at its centre.
    const a = haloAcceleration(COMA);
    const out = new Float64Array(3);
    const rs = COMA.radiusMpc / COMA.concentration;
    const limit = (G_MPC_MYR * COMA.massMsun) / (nfwMu(COMA.concentration) * 2 * rs * rs);
    a(1e-7, 0, 0, out);
    expect(Math.abs(out[0]) / limit).toBeCloseTo(1, 3);
  });

  it('stays a number when a galaxy sits exactly on the centre', () => {
    const a = haloAcceleration(COMA);
    const out = new Float64Array(3);
    a(0, 0, 0, out);
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
  });

  it('normalises through mu(c), which grows slowly with concentration', () => {
    expect(nfwMu(5)).toBeCloseTo(Math.log(6) - 5 / 6, 12);
    expect(nfwMu(10)).toBeGreaterThan(nfwMu(5));
    expect(nfwMu(10) / nfwMu(5)).toBeLessThan(2.5);
  });
});

describe('the dispersion that holds a cluster up', () => {
  const sigma = jeansDispersion(COMA);

  it('lands where a clusters measured dispersion lands: a thousand km/s or so', () => {
    const s = sigma(COMA.radiusMpc * 0.3) / KMS_TO_MPC_MYR;
    expect(s).toBeGreaterThan(600);
    expect(s).toBeLessThan(1400);
  });

  it('goes to zero at the centre, which is what an NFW cusp requires', () => {
    expect(sigma(1e-5)).toBeLessThan(sigma(0.1));
    expect(sigma(1e-6) / sigma(COMA.radiusMpc * 0.2)).toBeLessThan(0.2);
  });

  it('peaks somewhere between a tenth and half the virial radius', () => {
    let best = 0, bestR = 0;
    for (let i = 1; i <= 400; i++) {
      const r = (i / 400) * COMA.radiusMpc * 2;
      const s = sigma(r);
      if (s > best) { best = s; bestR = r; }
    }
    expect(bestR / COMA.radiusMpc).toBeGreaterThan(0.08);
    expect(bestR / COMA.radiusMpc).toBeLessThan(0.55);
  });

  it('falls again outside, because there is less and less holding anything in', () => {
    expect(sigma(COMA.radiusMpc * 4)).toBeLessThan(sigma(COMA.radiusMpc * 0.5));
  });

  it('sits below the escape speed everywhere, or nothing would stay', () => {
    for (let i = 1; i <= 40; i++) {
      const r = (i / 40) * COMA.radiusMpc * 2;
      expect(sigma(r) * Math.sqrt(3)).toBeLessThan(escapeSpeed(COMA, r));
    }
  });

  it('actually solves the Jeans equation it claims to', () => {
    // d(rho sigma^2)/dr = -rho GM/r^2, checked by finite difference.
    const rho = (r: number) => nfwDensity(COMA, r);
    for (const r of [0.05, 0.2, 0.6, 1.5, 3]) {
      const h = r * 0.02;
      const lhs = (rho(r + h) * sigma(r + h) ** 2 - rho(r - h) * sigma(r - h) ** 2) / (2 * h);
      const rhs = (-rho(r) * G_MPC_MYR * nfwEnclosedMass(COMA, r)) / (r * r);
      expect(lhs / rhs).toBeCloseTo(1, 2);
    }
  });

  it('scales as the square root of the halo mass, at fixed shape', () => {
    const light = jeansDispersion({ ...COMA, massMsun: 1e14 });
    const heavy = jeansDispersion({ ...COMA, massMsun: 1e16 });
    const r = COMA.radiusMpc * 0.3;
    expect(heavy(r) / light(r)).toBeCloseTo(10, 1);
  });
});

describe('a cluster left to itself', () => {
  it('starts with the dispersion the Jeans equation asked for', () => {
    const c = seedCluster(COMA, 3000);
    const s = c.dispersionKms();
    expect(s).toBeGreaterThan(600);
    expect(s).toBeLessThan(1400);
  });

  it('is isotropic: every axis gives the same dispersion', () => {
    const c = seedCluster(COMA, 4000);
    const [x, y, z] = [c.dispersionKms(0), c.dispersionKms(1), c.dispersionKms(2)];
    expect(Math.max(x, y, z) / Math.min(x, y, z)).toBeLessThan(1.12);
  });

  it('holds its radial profile for a gigayear instead of collapsing', () => {
    const c = seedCluster(COMA, 2000);
    c.friction = false;
    c.stripping = false;
    const before = [c.quantileRadius(0.25), c.quantileRadius(0.5), c.quantileRadius(0.75)];
    for (let i = 0; i < 400; i++) c.step(2.5); // 1 Gyr
    const after = [c.quantileRadius(0.25), c.quantileRadius(0.5), c.quantileRadius(0.75)];
    for (let i = 0; i < 3; i++) {
      expect(after[i] / before[i]).toBeGreaterThan(0.8);
      expect(after[i] / before[i]).toBeLessThan(1.25);
    }
  });

  it('holds its dispersion too, which is the same statement about the velocities', () => {
    const c = seedCluster(COMA, 2000);
    c.friction = false;
    c.stripping = false;
    const before = c.dispersionKms();
    for (let i = 0; i < 400; i++) c.step(2.5);
    expect(c.dispersionKms() / before).toBeGreaterThan(0.85);
    expect(c.dispersionKms() / before).toBeLessThan(1.2);
  });

  it('conserves each galaxys energy, because leapfrog is symplectic', () => {
    const c = seedCluster(COMA, 200);
    c.friction = false;
    c.stripping = false;
    c.step(0); // no-op
    const e0: number[] = [];
    for (let i = 0; i < 200; i++) e0.push(c.specificEnergy(i));
    for (let i = 0; i < 2000; i++) c.step(1);
    let worst = 0;
    for (let i = 0; i < 200; i++) {
      worst = Math.max(worst, Math.abs((c.specificEnergy(i) - e0[i]) / e0[i]));
    }
    expect(worst).toBeLessThan(0.05);
  });

  it('moves at all, which is the entire point', () => {
    const c = seedCluster(COMA, 50);
    const x0 = c.pos[3 * 7];
    for (let i = 0; i < 100; i++) c.step(2);
    expect(Math.abs(c.pos[3 * 7] - x0)).toBeGreaterThan(1e-4);
    expect(c.timeMyr).toBeCloseTo(200, 9);
  });

  it('never lets a galaxy leave the grid, or run to a NaN', () => {
    const c = seedCluster(COMA, 500);
    for (let i = 0; i < 2000; i++) c.step(2.5);
    for (let i = 0; i < c.length; i++) {
      expect(Number.isFinite(c.radius(i))).toBe(true);
      expect(c.radius(i)).toBeLessThan(COMA.radiusMpc * 60);
    }
  });

  it('keeps the anchored central galaxy in the centre', () => {
    const c = seedCluster(COMA, 100);
    c.anchor(0);
    for (let i = 0; i < 200; i++) c.step(2);
    expect(c.radius(0)).toBeLessThan(1e-6);
  });
});

describe('dynamical friction', () => {
  it('sinks a massive galaxy and leaves a light one alone', () => {
    const h: Halo = COMA;
    const heavy = new ClusterOrbits(h, 1);
    const light = new ClusterOrbits(h, 1);
    const start = { x: 0.5, y: 0, z: 0, stellarMsun: 1e11, radiusMpc: 0.004, gasFraction: 0 };
    // Put both on the same circular orbit; only the mass differs.
    const v = circularSpeed(h, 0.5);
    for (const [c, m] of [[heavy, 5e13], [light, 1e9]] as const) {
      c.place({ ...start, haloMassMsun: m }, () => 0.5);
      c.vel[0] = 0; c.vel[1] = v; c.vel[2] = 0;
      c.stripping = false;
    }
    for (let i = 0; i < 2000; i++) { heavy.step(2.5); light.step(2.5); }
    expect(heavy.radius(0)).toBeLessThan(light.radius(0) * 0.9);
  });

  it('does nothing at all when it is switched off', () => {
    const a = seedCluster(COMA, 1);
    const b = seedCluster(COMA, 1);
    a.mass[0] = b.mass[0] = 1e13;
    b.friction = false;
    a.stripping = b.stripping = false;
    for (let i = 0; i < 400; i++) { a.step(2.5); b.step(2.5); }
    expect(b.radius(0)).toBeGreaterThan(a.radius(0));
  });
});

describe('the intracluster medium takes the gas', () => {
  it('holds twelve per cent of the cluster as hot gas inside the virial radius', () => {
    let m = 0;
    const n = 6000, dr = COMA.radiusMpc / n;
    for (let i = 0; i < n; i++) {
      const r = (i + 0.5) * dr;
      m += 4 * Math.PI * r * r * icmDensity(COMA, r) * dr;
    }
    expect(m / COMA.massMsun).toBeCloseTo(ICM_GAS_FRACTION, 2);
  });

  it('is densest in the core and thin outside, as a beta model should be', () => {
    expect(icmDensity(COMA, 0)).toBeGreaterThan(icmDensity(COMA, COMA.radiusMpc) * 100);
  });

  it('sits at the density X-ray observations find: a thousandth of a particle per cc', () => {
    // Convert Msun/Mpc^3 to protons per cubic centimetre.
    const perCc = (icmDensity(COMA, 0.1) * M_SUN) / (MPC * 100) ** 3 / 1.673e-27;
    expect(perCc).toBeGreaterThan(1e-4);
    expect(perCc).toBeLessThan(1e-1);
  });

  it('strips a galaxy that goes through the core and spares one that stays out', () => {
    const h = COMA;
    const c = new ClusterOrbits(h, 2);
    const seed: OrbitSeed = {
      x: 1.6, y: 0, z: 0, haloMassMsun: 0,
      stellarMsun: 4e10, radiusMpc: 0.0026, gasFraction: 0.12,
    };
    // Radial plunge straight through the middle.
    c.place(seed, () => 0.5);
    c.vel[0] = -escapeSpeed(h, 1.6) * 0.5; c.vel[1] = 0; c.vel[2] = 0;
    // Circular orbit far out, which never meets a dense wind.
    c.place({ ...seed, x: 2.6 }, () => 0.5);
    c.vel[3] = 0; c.vel[4] = circularSpeed(h, 2.6); c.vel[5] = 0;
    c.friction = false;
    for (let i = 0; i < 1200; i++) c.step(2.5); // 3 Gyr
    expect(c.gas[0]).toBeLessThan(0.5);
    expect(c.gas[1]).toBeGreaterThan(0.85);
  });

  it('never gives gas back once it has gone', () => {
    const c = seedCluster(COMA, 300);
    c.friction = false;
    let prev = new Float64Array(c.gas);
    for (let k = 0; k < 40; k++) {
      for (let i = 0; i < 20; i++) c.step(2.5);
      for (let i = 0; i < c.length; i++) expect(c.gas[i]).toBeLessThanOrEqual(prev[i] + 1e-12);
      prev = new Float64Array(c.gas);
    }
  });

  it('leaves the cluster core redder than its outskirts, which is the observed law', () => {
    const c = seedCluster(COMA, 1500);
    c.friction = false;
    for (let i = 0; i < 1600; i++) c.step(2.5); // 4 Gyr
    let inner = 0, innerN = 0, outer = 0, outerN = 0;
    for (let i = 0; i < c.length; i++) {
      const r = c.radius(i);
      if (r < COMA.radiusMpc * 0.35) { inner += c.gas[i]; innerN++; }
      else if (r > COMA.radiusMpc * 1.0) { outer += c.gas[i]; outerN++; }
    }
    expect(innerN).toBeGreaterThan(20);
    expect(outerN).toBeGreaterThan(20);
    expect(inner / innerN).toBeLessThan(outer / outerN);
  });

  it('truncates a Milky Way that crosses the core, without emptying it', () => {
    // The Virgo picture: hydrogen discs visibly smaller than the stellar ones,
    // not spirals with no gas at all.
    const hold = bindingPressure(5e10, 0.0026, 0.12);
    const ram = ramPressure(icmDensity(COMA, 0.1), 1500 * KMS_TO_MPC_MYR);
    const kept = retainedFraction(ram, hold);
    expect(kept).toBeGreaterThan(0.15);
    expect(kept).toBeLessThan(0.7);
  });

  it('trims only the very edge of a galaxy out in the outskirts', () => {
    // Not nothing - hydrogen deficiency is measurable well outside the core,
    // and it is the outermost, least bound gas that goes first - but a couple
    // of per cent, not a quenching.
    const hold = bindingPressure(5e10, 0.0026, 0.12);
    const gentle = ramPressure(icmDensity(COMA, 3), 300 * KMS_TO_MPC_MYR);
    const kept = retainedFraction(gentle, hold);
    expect(kept).toBeGreaterThan(0.95);
    expect(kept).toBeLessThan(1);
  });

  it('takes everything from a dwarf that goes where the Milky Way survives', () => {
    const dwarf = bindingPressure(1e8, 0.001, 0.3);
    const ram = ramPressure(icmDensity(COMA, 0.1), 1500 * KMS_TO_MPC_MYR);
    expect(retainedFraction(ram, dwarf)).toBe(0);
  });

  it('keeps everything when there is no wind, and nothing when the wind wins', () => {
    expect(retainedFraction(0, 1)).toBe(1);
    expect(retainedFraction(2, 1)).toBe(0);
    expect(retainedFraction(1, 1)).toBe(0);
  });

  it('falls monotonically as the wind rises', () => {
    let prev = 1.0001;
    for (const p of [1e-6, 1e-4, 1e-3, 1e-2, 0.1, 0.5, 0.9]) {
      const k = retainedFraction(p, 1);
      expect(k).toBeLessThan(prev);
      prev = k;
    }
  });

  it('holds a big galaxy harder than a small one, at the same gas fraction', () => {
    expect(bindingPressure(1e11, 0.003, 0.1)).toBeGreaterThan(bindingPressure(1e9, 0.003, 0.1));
  });
});

describe('the numbers survive odd clusters', () => {
  it('works for a small group as well as a rich cluster', () => {
    const group: Halo = { massMsun: 3e13, radiusMpc: 0.7, concentration: 8 };
    const c = seedCluster(group, 200, 3);
    for (let i = 0; i < 400; i++) c.step(2);
    expect(c.dispersionKms()).toBeGreaterThan(50);
    expect(c.dispersionKms()).toBeLessThan(600);
    for (let i = 0; i < c.length; i++) expect(Number.isFinite(c.radius(i))).toBe(true);
  });

  it('does not divide by zero on an empty cluster', () => {
    const c = new ClusterOrbits(COMA, 4);
    c.step(1);
    expect(c.dispersionKms()).toBe(0);
    expect(c.quantileRadius(0.5)).toBe(0);
  });
});
