import { describe, expect, it } from 'vitest';
import * as X from '../src/physics/crystal';

describe('the structures are the real ones', () => {
  it('reproduces every measured density from the cell alone', () => {
    // The test that says these are not decorative numbers. Mass in a box over
    // the volume of the box, nothing fitted, nothing tuned.
    for (const m of X.MINERALS) {
      const rho = X.latticeDensity(m);
      const err = Math.abs(rho / m.densityRef - 1);
      // Bridgmanite is the one that misses, by four percent, and it misses for
      // a reason: the real mineral is an orthorhombically distorted perovskite
      // and this is the undistorted cube, which is roomier.
      expect(err, `${m.key} ${rho.toFixed(0)} vs ${m.densityRef}`)
        .toBeLessThan(m.key === 'bridgmanite' ? 0.05 : 0.01);
    }
  });

  it('counts the hydrogens it cannot place', () => {
    // Ice and methane keep hydrogens that are not at any crystallographic
    // site - disordered in one, spinning in the other - and leaving their
    // mass out shows up immediately as a density ten and twenty-five percent
    // light.
    const ice = X.mineral('ice');
    expect(ice.looseH).toBe(8);
    const withoutH = X.cellMass(ice) - 8 * X.ELEMENTS.H.weight * 1.66053906892e-27;
    expect(withoutH / X.cellVolume(ice)).toBeLessThan(0.92 * ice.densityRef);
  });

  it('gets the bond lengths right', () => {
    const nn = (k: string): number => X.nearestNeighbour(X.mineral(k)) * 1e10;
    expect(nn('quartz')).toBeCloseTo(1.61, 1);      // silicon to oxygen
    expect(nn('diamond')).toBeCloseTo(1.545, 2);    // carbon to carbon
    expect(nn('halite')).toBeCloseTo(2.82, 2);      // sodium to chlorine
    expect(nn('periclase')).toBeCloseTo(2.106, 2);  // magnesium to oxygen
    expect(nn('iron')).toBeCloseTo(2.482, 2);       // along the body diagonal
    expect(nn('ice')).toBeCloseTo(2.75, 1);         // oxygen to oxygen
    expect(nn('nitrogen')).toBeCloseTo(1.098, 2);   // inside the molecule
  });

  it('gets the coordination numbers right', () => {
    // These are the numbers the structures are named for.
    expect(X.coordination(X.mineral('halite'), 0)).toBe(6);
    expect(X.coordination(X.mineral('periclase'), 0)).toBe(6);
    expect(X.coordination(X.mineral('diamond'), 0)).toBe(4);
    expect(X.coordination(X.mineral('iron'), 0)).toBe(8);
    expect(X.coordination(X.mineral('ice'), 0)).toBe(4);
    // Every silicon in quartz sits at the centre of a tetrahedron of oxygens.
    expect(X.coordination(X.mineral('quartz'), 0)).toBe(4);
    expect(X.coordination(X.mineral('quartz'), 1)).toBe(4);
    expect(X.coordination(X.mineral('quartz'), 2)).toBe(4);
    // Perovskite: the big cation sits in a cage of twelve.
    expect(X.coordination(X.mineral('bridgmanite'), 0)).toBe(12);
    // And a nitrogen molecule has exactly one nearest neighbour - its partner.
    expect(X.coordination(X.mineral('nitrogen'), 0)).toBe(1);
  });

  it('builds a block by repeating the cell, and nothing else', () => {
    const m = X.mineral('halite');
    const block = X.buildBlock(m, 3, 3, 3);
    expect(block).toHaveLength(27 * m.sites.length);
    // Everything inside the box it was asked for.
    for (const at of block) {
      for (const c of at.pos) expect(c).toBeGreaterThanOrEqual(-1e-18);
      expect(Math.max(...at.pos)).toBeLessThan(3 * m.a);
    }
  });

  it('has cell vectors that give the right volume for both systems', () => {
    const cube = X.mineral('halite');
    expect(X.cellVolume(cube)).toBeCloseTo(cube.a ** 3, 40);
    const hex = X.mineral('ice');
    const want = (Math.sqrt(3) / 2) * hex.a ** 2 * (hex.c ?? 0);
    expect(X.cellVolume(hex)).toBeCloseTo(want, 40);
  });
});

describe('the atoms are moving', () => {
  it('has an amplitude that grows with temperature', () => {
    const m = X.mineral('quartz');
    let prev = 0;
    for (const T of [0, 100, 300, 800, 1500]) {
      const u = X.thermalAmplitude(15.999, m.debyeK, T);
      expect(u).toBeGreaterThan(prev);
      prev = u;
    }
  });

  it('does not stop at absolute zero', () => {
    // Zero-point motion. Not a rounding artefact and not a small correction:
    // the atom cannot be at rest at an exact place, so it never is.
    const u = X.thermalAmplitude(15.999, 470, 0);
    expect(u).toBeGreaterThan(1e-12);
    // And at low temperature the amplitude is nearly all of it.
    expect(X.thermalAmplitude(15.999, 470, 40)).toBeCloseTo(u, 12);
  });

  it('moves light atoms further than heavy ones', () => {
    // Which is why the hydrogen in ice is smeared over more room than the
    // oxygen it is attached to.
    const light = X.thermalAmplitude(1.008, 400, 300);
    const heavy = X.thermalAmplitude(55.845, 400, 300);
    expect(light / heavy).toBeCloseTo(Math.sqrt(55.845 / 1.008), 1);
  });

  it('approaches the classical amplitude well above the Debye temperature', () => {
    // Above Theta_D the quantum part stops mattering and <u^2> goes linear in
    // temperature, which is the equipartition answer.
    const t1 = X.thermalAmplitude(20, 200, 2000), t2 = X.thermalAmplitude(20, 200, 8000);
    expect(t2 / t1).toBeCloseTo(2, 1);
  });

  it('has a Debye integral that is right where it can be checked', () => {
    // Small X: the integrand tends to one, so the integral tends to X.
    expect(X.debyeIntegral(0.001)).toBeCloseTo(0.001, 6);
    // Large X: it converges on pi^2/6.
    expect(X.debyeIntegral(60)).toBeCloseTo(Math.PI ** 2 / 6, 4);
    expect(X.debyeIntegral(0)).toBe(0);
    expect(X.debyeIntegral(-3)).toBe(0);
  });
});

describe('and it melts when the shaking gets to about a tenth of a bond', () => {
  it('agrees on the constant across materials with nothing else in common', () => {
    // A metal, two ionic crystals, a covalent network, a hydrogen-bonded
    // framework and two stacks of molecules. They melt at 63 K and at 4400 K.
    // At their own melting points they are all shaking through between six and
    // thirteen percent of their spacing, and that agreement is the whole of
    // what Lindemann's rule says.
    const cs: number[] = [];
    for (const m of X.MINERALS) {
      const c = X.lindemannAtMelt(m);
      expect(c, m.key).toBeGreaterThan(0.05);
      expect(c, m.key).toBeLessThan(0.14);
      cs.push(c);
    }
    // Melting points spanning a factor of seventy, constants spanning two.
    expect(Math.max(...cs) / Math.min(...cs)).toBeLessThan(2.5);
  });

  it('is below the criterion for every world that has a solid surface', () => {
    for (const [T, key] of [[288, 'quartz'], [210, 'quartz'], [102, 'ice'],
      [38, 'nitrogen'], [300, 'iron'], [700, 'diamond']] as [number, string][]) {
      expect(X.lindemannRatio(X.mineral(key), T), `${key} at ${T}`).toBeLessThan(0.1);
    }
  });

  it('rises as the square root of temperature once it is warm', () => {
    const m = X.mineral('periclase');
    expect(X.lindemannRatio(m, 4000) / X.lindemannRatio(m, 1000)).toBeCloseTo(2, 1);
  });

  it('lets the molecule be the thing that vibrates, when it is one', () => {
    // Nitrogen ice is a stack of dumbbells, not a lattice of nitrogen atoms.
    // Comparing the shaking to the bond inside the molecule rather than to the
    // gap between molecules would say Triton's surface is liquid, and it is
    // not - it is what Voyager photographed.
    const n2 = X.mineral('nitrogen');
    expect(X.unitMass(n2)).toBeCloseTo(28.014, 3);
    expect(X.unitSpacing(n2)).toBeGreaterThan(3e-10);
    expect(X.lindemannRatio(n2, 38)).toBeLessThan(0.08);
  });
});

describe('the speed of sound comes out of the same number', () => {
  it('lands on the measured values', () => {
    // A sound wave and a thermal phonon are the same object, so the Debye
    // temperature that sets the shaking also sets how fast a knock travels.
    expect(X.soundSpeed(X.mineral('periclase'))).toBeGreaterThan(5500);
    expect(X.soundSpeed(X.mineral('periclase'))).toBeLessThan(7500);
    expect(X.soundSpeed(X.mineral('diamond'))).toBeGreaterThan(11000);
    expect(X.soundSpeed(X.mineral('ice'))).toBeGreaterThan(1500);
    expect(X.soundSpeed(X.mineral('ice'))).toBeLessThan(3500);
    // Softer and heavier is slower, every time.
    expect(X.soundSpeed(X.mineral('nitrogen')))
      .toBeLessThan(X.soundSpeed(X.mineral('iron')));
  });

  it('has a cut-off, because a wave shorter than two atoms has nothing to wave', () => {
    for (const m of X.MINERALS) {
      const f = X.debyeFrequency(m);
      expect(f).toBeGreaterThan(1e12);
      expect(f).toBeLessThan(1e14);
    }
  });
});

describe('what is under a particular world', () => {
  const g = (cls: string, surfaceK: number, density = 4000, oceanFraction = 0) =>
    X.groundOf({ cls, surfaceK, density, oceanFraction });

  it('follows the temperature down through what can be solid at it', () => {
    expect(g('terrestrial', 288, 5514, 0.71).mineral.key).toBe('quartz');
    expect(g('ice', 102, 3010).mineral.key).toBe('ice');
    expect(g('ice', 38, 2060).mineral.key).toBe('nitrogen');
    expect(g('ice', 25, 2060).mineral.key).toBe('methane');
    expect(g('iron', 500, 8000).mineral.key).toBe('iron');
    expect(g('carbon', 700).mineral.key).toBe('diamond');
    // Above where silica gives up, what is left standing is the oxide.
    expect(g('rocky', 2400).mineral.key).toBe('periclase');
  });

  it('says so when nothing is solid', () => {
    expect(g('rocky', 288).molten).toBe(false);
    expect(g('lava', 3400).molten).toBe(true);
    expect(g('ice', 300, 2060).molten).toBe(false);
  });

  it('gives Earth quartz shaking through about five percent of its spacing', () => {
    const earth = g('terrestrial', 288, 5514, 0.71);
    expect(earth.mineral.key).toBe('quartz');
    expect(earth.shake).toBeGreaterThan(0.03);
    expect(earth.shake).toBeLessThan(0.07);
    expect(earth.molten).toBe(false);
  });
});

describe('where the nuclei came from', () => {
  it('has an origin for every element it can put underfoot', () => {
    const used = new Set(X.MINERALS.flatMap((m) => m.sites.map((s) => s.el)));
    used.add('H');
    for (const el of used) {
      expect(X.ELEMENTS[el], el).toBeDefined();
      expect(X.ELEMENTS[el].origin.length, el).toBeGreaterThan(10);
    }
  });

  it('puts hydrogen in the Big Bang and everything else in a star', () => {
    expect(X.ELEMENTS.H.origin).toMatch(/first three minutes/);
    for (const el of ['C', 'O', 'Si', 'Mg', 'Fe']) {
      expect(X.ELEMENTS[el].origin).toMatch(/star|dwarf|supernova/);
    }
  });
});
