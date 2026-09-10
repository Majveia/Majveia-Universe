import { describe, expect, it } from 'vitest';
import * as A from '../src/physics/atom';

describe('which orbitals are occupied', () => {
  it('fills in the Madelung order, which is why the fourth row is shaped as it is', () => {
    const order = A.fillingOrder(4).map((x) => `${x.n}${'spdf'[x.l]}`);
    expect(order.slice(0, 8)).toEqual(['1s', '2s', '2p', '3s', '3p', '4s', '3d', '4p']);
    // 4s before 3d - lower n + l wins even though the shell is higher. That
    // single inversion is the whole reason the transition metals exist as a
    // block in the middle of the table.
    expect(order.indexOf('4s')).toBeLessThan(order.indexOf('3d'));
  });

  it('writes out the configurations everybody memorises', () => {
    expect(A.configurationText(1)).toBe('1s¹');
    expect(A.configurationText(6)).toBe('1s² 2s² 2p²');
    expect(A.configurationText(10)).toBe('1s² 2s² 2p⁶');
    expect(A.configurationText(17)).toBe('1s² 2s² 2p⁶ 3s² 3p⁵');
    expect(A.configurationText(26)).toBe('1s² 2s² 2p⁶ 3s² 3p⁶ 4s² 3d⁶');
  });

  it('knows the two exceptions everybody meets', () => {
    // Chromium and copper both rob their 4s to finish a d shell, because a
    // half-full or full d shell is worth more than the s electron it costs.
    expect(A.configurationText(24)).toBe('1s² 2s² 2p⁶ 3s² 3p⁶ 4s¹ 3d⁵');
    expect(A.configurationText(29)).toBe('1s² 2s² 2p⁶ 3s² 3p⁶ 4s¹ 3d¹⁰');
  });

  it('accounts for every electron', () => {
    for (let z = 1; z <= 30; z++) {
      const total = A.configuration(z).reduce((s, x) => s + x.count, 0);
      expect(total, `Z=${z}`).toBe(z);
      for (const s of A.configuration(z)) expect(s.count).toBeLessThanOrEqual(2 * (2 * s.l + 1));
    }
  });

  it('picks the outermost subshell as the one that does the chemistry', () => {
    expect(A.valenceOf(11)).toMatchObject({ n: 3, l: 0, count: 1 });
    expect(A.valenceOf(17)).toMatchObject({ n: 3, l: 1, count: 5 });
    expect(A.valenceOf(26)).toMatchObject({ n: 4, l: 0, count: 2 });
  });
});

describe('how much of the nucleus an electron feels', () => {
  it('reproduces the published Slater values exactly', () => {
    // Iron, the three that get quoted. If these are right the rules are
    // implemented right, because every part of the arithmetic is exercised.
    expect(A.slaterZeff(26, 4, 0)).toBeCloseTo(3.75, 10);
    expect(A.slaterZeff(26, 3, 2)).toBeCloseTo(6.25, 10);
    expect(A.slaterZeff(26, 1, 0)).toBeCloseTo(25.70, 10);
  });

  it('gives hydrogen its bare nucleus, since there is nothing to hide behind', () => {
    expect(A.slaterZeff(1, 1, 0)).toBe(1);
  });

  it('rises by exactly 0.65 for every step across a period', () => {
    // Lithium to neon: 1.30, 1.95, 2.60 ... 5.85. The valence electron feels
    // more nucleus at every step, so the atoms get *smaller* left to right even
    // as they get heavier, which is not what anyone guesses.
    const want = [1.30, 1.95, 2.60, 3.25, 3.90, 4.55, 5.20, 5.85];
    for (let i = 0; i < want.length; i++) {
      expect(A.valenceZeff(3 + i), `Z=${3 + i}`).toBeCloseTo(want[i], 10);
    }
    // Sodium to argon does the same thing one shell out.
    const row3 = [2.20, 2.85, 3.50, 4.15, 4.80, 5.45, 6.10, 6.75];
    for (let i = 0; i < row3.length; i++) {
      expect(A.valenceZeff(11 + i), `Z=${11 + i}`).toBeCloseTo(row3[i], 10);
    }
  });

  it('collapses at the start of a new row, which is where the alkali metals are', () => {
    // The sawtooth. Neon's valence electron feels 5.85; sodium's feels 2.20,
    // despite sodium having one more proton. That drop is why sodium hands its
    // electron over to anything that asks.
    expect(A.valenceZeff(11)).toBeLessThan(A.valenceZeff(10) / 2);
    expect(A.valenceZeff(19)).toBeLessThan(A.valenceZeff(18) / 2);
  });

  it('shields a d electron completely with everything inside it', () => {
    // A 3d distribution barely overlaps the 3s and 3p, so it gets no 0.85
    // discount from them - they screen it as if they were a full shell in.
    expect(A.slaterZeff(21, 3, 2)).toBeCloseTo(21 - 18, 10);
  });
});

describe('the wavefunctions', () => {
  const integrate = (f: (r: number) => number, far: number, n = 60000): number => {
    const h = far / n;
    let s = 0;
    for (let i = 1; i <= n; i++) s += f(i * h) * h;
    return s;
  };

  it('normalises to one', () => {
    for (const [n, l] of [[1, 0], [2, 0], [2, 1], [3, 0], [3, 1], [3, 2], [4, 0], [4, 3]] as [number, number][]) {
      const norm = integrate((r) => A.radial(n, l, 1, r) ** 2 * r * r, 80 * A.BOHR);
      expect(norm, `${n}${'spdf'[l]}`).toBeCloseTo(1, 3);
    }
  });

  it('has exactly n - l - 1 radial nodes', () => {
    // The count that tells you which orbital you are looking at. 3s has two
    // shells inside it and 3d has none, which is why 3d hugs the nucleus and
    // 3s reaches past it.
    for (const [n, l] of [[1, 0], [2, 0], [2, 1], [3, 0], [3, 1], [3, 2], [4, 0], [4, 1]] as [number, number][]) {
      let nodes = 0, prev = A.radial(n, l, 1, 1e-14);
      for (let i = 1; i <= 40000; i++) {
        const v = A.radial(n, l, 1, (i / 40000) * 70 * A.BOHR);
        if (prev * v < 0) nodes++;
        prev = v;
      }
      expect(nodes, `${n}${'spdf'[l]}`).toBe(n - l - 1);
    }
  });

  it('has the mean radius the closed form says it does', () => {
    // <r> = (3n^2 - l(l+1)) a0 / 2Z. Integrating the wavefunction and landing
    // on that is the check that the Laguerre polynomials are the right ones.
    for (const [n, l] of [[1, 0], [2, 0], [2, 1], [3, 1], [3, 2], [4, 0]] as [number, number][]) {
      const got = integrate((r) => A.radial(n, l, 1, r) ** 2 * r * r * r, 90 * A.BOHR);
      expect(got / A.BOHR, `${n}${'spdf'[l]}`).toBeCloseTo((3 * n * n - l * (l + 1)) / 2, 2);
    }
  });

  it('peaks at the Bohr radius for the ground state, and nowhere else', () => {
    // The single number the old quantum theory got right, recovered from the
    // full solution: the most likely place to find hydrogen's electron.
    expect(A.peakRadius(1, 0, 1) / A.BOHR).toBeCloseTo(1, 2);
    // And scales as 1/Z, so a helium ion holds its electron twice as close.
    expect(A.peakRadius(1, 0, 2) / A.BOHR).toBeCloseTo(0.5, 2);
  });

  it('has a Laguerre recurrence that agrees with the closed forms', () => {
    for (const x of [0.3, 1.7, 5.2]) {
      expect(A.laguerre(0, 1, x)).toBeCloseTo(1, 12);
      expect(A.laguerre(1, 1, x)).toBeCloseTo(2 - x, 12);
      expect(A.laguerre(2, 1, x)).toBeCloseTo(3 - 3 * x + x * x / 2, 12);
      expect(A.laguerre(2, 3, x)).toBeCloseTo(10 - 5 * x + x * x / 2, 12);
    }
  });
});

describe('the shapes', () => {
  // A Fibonacci lattice: genuinely even over the sphere, so a sum over it is a
  // quadrature rather than a Monte Carlo estimate with 6% noise in it.
  const dirs: [number, number, number][] = [];
  const N = 2000, GOLDEN = Math.PI * (3 - Math.sqrt(5));
  for (let k = 0; k < N; k++) {
    const z = 1 - (2 * (k + 0.5)) / N;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const ph = k * GOLDEN;
    dirs.push([r * Math.cos(ph), r * Math.sin(ph), z]);
  }

  it('makes a filled subshell perfectly spherical', () => {
    // Unsold's theorem. It is the reason a noble gas is a ball and the reason
    // an argon atom has no preferred direction to bond in.
    for (const l of [0, 1, 2, 3]) {
      for (const [x, y, z] of dirs) {
        let sum = 0;
        for (let m = -l; m <= l; m++) sum += A.realHarmonic(l, m, x, y, z) ** 2;
        expect(sum).toBeCloseTo((2 * l + 1) / (4 * Math.PI), 12);
      }
    }
  });

  it('normalises each harmonic over the sphere', () => {
    for (const l of [0, 1, 2]) {
      for (let m = -l; m <= l; m++) {
        let s = 0;
        for (const [x, y, z] of dirs) s += A.realHarmonic(l, m, x, y, z) ** 2;
        expect((s / dirs.length) * 4 * Math.PI, `l=${l} m=${m}`).toBeCloseTo(1, 2);
      }
    }
  });

  it('points the p orbitals along the axes', () => {
    const k = Math.sqrt(3 / (4 * Math.PI));
    expect(A.realHarmonic(1, 1, 1, 0, 0)).toBeCloseTo(k, 12);   // px along x
    expect(A.realHarmonic(1, 1, 0, 1, 0)).toBeCloseTo(0, 12);
    expect(A.realHarmonic(1, 0, 0, 0, 1)).toBeCloseTo(k, 12);   // pz along z
    expect(A.realHarmonic(1, -1, 0, 1, 0)).toBeCloseTo(k, 12);  // py along y
  });

  it('gives every p and d orbital a node through the nucleus', () => {
    for (const l of [1, 2]) {
      for (let m = -l; m <= l; m++) {
        let neg = false, pos = false;
        for (const [x, y, z] of dirs) {
          const v = A.realHarmonic(l, m, x, y, z);
          if (v > 1e-9) pos = true;
          if (v < -1e-9) neg = true;
        }
        expect(pos && neg, `l=${l} m=${m}`).toBe(true);
      }
    }
  });

  it('makes d_z2 the odd one, positive up the axis and negative round the waist', () => {
    expect(A.realHarmonic(2, 0, 0, 0, 1)).toBeGreaterThan(0);
    expect(A.realHarmonic(2, 0, 1, 0, 0)).toBeLessThan(0);
  });
});

describe('how big an atom is, and how well the model knows', () => {
  it('gets hydrogen exactly right, because hydrogen is what the model is', () => {
    expect(A.hydrogenicError(1)).toBeCloseTo(1, 2);
  });

  it('gets the second row right to a few percent', () => {
    for (const z of [6, 7, 8, 9]) {
      expect(A.hydrogenicError(z), `Z=${z}`).toBeGreaterThan(0.85);
      expect(A.hydrogenicError(z), `Z=${z}`).toBeLessThan(1.15);
    }
  });

  it('overestimates further out, always the same way, and worse each row', () => {
    // Penetration: a real 3s or 4s spends part of its time inside the closed
    // shells feeling a nearly bare nucleus, and a hydrogenic function has no
    // way to do that. The error is a factor of 1.3 in the third row and 2.4 in
    // the fourth, and it is never in the other direction.
    const second = A.hydrogenicError(8);
    const third = A.hydrogenicError(17);
    const fourth = A.hydrogenicError(19);
    expect(third).toBeGreaterThan(second);
    expect(fourth).toBeGreaterThan(third);
    expect(fourth).toBeGreaterThan(2);
    expect(fourth).toBeLessThan(3);
  });

  it('shrinks across a period and jumps at the start of the next', () => {
    // The periodic table, in one assertion.
    for (let z = 4; z <= 9; z++) {
      expect(A.atomRadius(z), `Z=${z}`).toBeLessThan(A.atomRadius(z - 1));
    }
    expect(A.atomRadius(11)).toBeGreaterThan(A.atomRadius(10) * 3);
  });
});

describe('the part that is nothing', () => {
  it('gives every nucleus the same density', () => {
    // R = r0 A^(1/3) says volume goes as nucleon count, so density is flat
    // across the whole table - because the strong force saturates and a
    // nucleon only binds to the ones touching it.
    const rho = (a: number): number => a * 1.66053906892e-27
      / ((4 / 3) * Math.PI * A.nuclearRadius(a) ** 3);
    for (const a of [1, 12, 56, 208, 238]) {
      expect(rho(a) / 2.0e17).toBeGreaterThan(0.8);
      expect(rho(a) / 2.0e17).toBeLessThan(1.4);
    }
  });

  it('has a hydrogen nucleus a hundred thousand times smaller than its atom', () => {
    expect(A.atomRadius(1) / A.nuclearRadius(1)).toBeGreaterThan(3e4);
    expect(A.atomRadius(1) / A.nuclearRadius(1)).toBeLessThan(5e4);
  });

  it('makes an atom about one part in ten thousand million million of nothing', () => {
    for (const [z, a] of [[1, 1], [8, 16], [14, 28], [26, 56]] as [number, number][]) {
      const f = A.emptiness(A.atomRadius(z), a);
      expect(f).toBeGreaterThan(1e-15);
      expect(f).toBeLessThan(1e-11);
    }
  });

  it('puts the nucleus below a pixel however big the atom is drawn', () => {
    // Drawn at true scale with the atom filling a thousand-pixel window, an
    // iron nucleus is three hundredths of a pixel across.
    expect(A.nucleusAtScale(A.atomRadius(26), 56, 500)).toBeLessThan(0.05);
  });

  it('has the innermost electron of iron moving at a fifth of light speed', () => {
    expect(A.innerElectronBeta(26)).toBeCloseTo(0.19, 2);
    // And gold's at more than half, which is why gold is yellow.
    expect(A.innerElectronBeta(79)).toBeGreaterThan(0.55);
    expect(A.innerElectronSpeed(1) / 2.99792458e8).toBeCloseTo(1 / 137.036, 4);
  });
});
