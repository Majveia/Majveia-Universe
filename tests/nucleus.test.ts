import { describe, expect, it } from 'vitest';
import * as N from '../src/physics/nucleus';

describe('the curve', () => {
  // Measured binding energies per nucleon, MeV. The mass formula has five
  // terms and no structure in it at all, and it lands on these.
  const REAL: [string, number, number, number][] = [
    ['C-12', 6, 12, 7.680], ['O-16', 8, 16, 7.976], ['Si-28', 14, 28, 8.448],
    ['Ca-40', 20, 40, 8.551], ['Fe-56', 26, 56, 8.790], ['Ni-62', 28, 62, 8.795],
    ['Kr-84', 36, 84, 8.717], ['Sn-120', 50, 120, 8.505], ['Pb-208', 82, 208, 7.867],
    ['U-235', 92, 235, 7.591], ['U-238', 92, 238, 7.570],
  ];

  it('gets every nucleus above carbon to within three percent', () => {
    for (const [name, z, a, want] of REAL) {
      const got = N.bindingPerNucleon(z, a);
      expect(Math.abs(got / want - 1), `${name} ${got.toFixed(3)} vs ${want}`)
        .toBeLessThan(0.03);
    }
  });

  it('gets most of them to under one percent', () => {
    const close = REAL.filter(([, z, a, want]) =>
      Math.abs(N.bindingPerNucleon(z, a) / want - 1) < 0.01);
    expect(close.length).toBeGreaterThanOrEqual(REAL.length - 2);
  });

  it('cannot do helium, and that failure is the interesting one', () => {
    // 5.7 MeV per nucleon against a measured 7.07. At four nucleons there is
    // no bulk and no surface to speak of - it is all shell structure, which is
    // exactly what a liquid drop model leaves out.
    expect(N.bindingPerNucleon(2, 4)).toBeLessThan(6.5);
    expect(N.bindingPerNucleon(2, 4)).toBeGreaterThan(4.5);
  });

  it('peaks at iron, which is why stars stop there', () => {
    const p = N.bindingPeak();
    // The real maximum is nickel-62 at 8.7945, with iron-58 and iron-56 just
    // behind it. Landing anywhere in that group is landing on the answer.
    expect(p.a).toBeGreaterThanOrEqual(54);
    expect(p.a).toBeLessThanOrEqual(64);
    expect(p.z).toBeGreaterThanOrEqual(25);
    expect(p.z).toBeLessThanOrEqual(29);
    expect(p.perNucleon).toBeGreaterThan(8.5);
    expect(p.perNucleon).toBeLessThan(9.2);
  });

  it('rises to the peak and falls away after it, without being told to', () => {
    const at = (a: number): number => N.bindingPerNucleon(Math.round(N.stableZ(a)), a);
    for (const a of [20, 30, 40, 50]) expect(at(a + 4)).toBeGreaterThan(at(a));
    for (const a of [80, 120, 160, 200]) expect(at(a + 20)).toBeLessThan(at(a));
  });

  it('has every term pulling the way it should', () => {
    const t = N.bindingTerms(26, 56);
    expect(t.volume).toBeGreaterThan(0);      // holding it together
    expect(t.surface).toBeLessThan(0);        // the outside has fewer neighbours
    expect(t.coulomb).toBeLessThan(0);        // protons pushing
    expect(t.asymmetry).toBeLessThanOrEqual(0);
    // Iron-56 has 26 protons and 30 neutrons - both even, so pairing helps.
    expect(t.pairing).toBeGreaterThan(0);
    expect(t.total).toBeCloseTo(
      t.volume + t.surface + t.coulomb + t.asymmetry + t.pairing, 9,
    );
  });

  it('makes the Coulomb term take over as nuclei get big', () => {
    // The reason the periodic table ends. Volume grows as A and Coulomb as
    // Z^2/A^(1/3), so past a point adding protons stops paying.
    const share = (z: number, a: number): number =>
      Math.abs(N.bindingTerms(z, a).coulomb) / N.bindingTerms(z, a).volume;
    expect(share(8, 16)).toBeLessThan(0.1);
    expect(share(26, 56)).toBeGreaterThan(share(8, 16));
    expect(share(92, 238)).toBeGreaterThan(0.25);
  });

  it('prefers even numbers of each, which is why they are more common', () => {
    // Pairing: an even-even nucleus is bound harder than its odd neighbours.
    expect(N.bindingTerms(26, 56).pairing).toBeGreaterThan(0);   // even-even
    expect(N.bindingTerms(26, 55).pairing).toBe(0);              // odd A
    expect(N.bindingTerms(25, 56).pairing).toBeLessThan(0);      // odd-odd
  });
});

describe('the valley of stability', () => {
  it('puts light nuclei at equal protons and neutrons', () => {
    expect(N.stableZ(16) / 16).toBeCloseTo(0.48, 1);
    expect(N.stableZ(40) / 40).toBeCloseTo(0.46, 1);
  });

  it('drives heavy ones neutron-rich, because Coulomb grows faster', () => {
    expect(N.stableZ(238) / 238).toBeLessThan(0.42);
    expect(N.stableZ(16) / 16).toBeGreaterThan(N.stableZ(238) / 238);
  });

  it('lands on the nuclei that actually are stable', () => {
    for (const [a, z] of [[16, 8], [56, 26], [120, 50], [208, 82], [238, 92]] as [number, number][]) {
      expect(Math.round(N.stableZ(a)), `A=${a}`).toBeGreaterThanOrEqual(z - 1);
      expect(Math.round(N.stableZ(a)), `A=${a}`).toBeLessThanOrEqual(z + 1);
    }
    // A = 40 is one of the handful of mass numbers with two stable nuclides -
    // argon-40 and calcium-40 - and the formula lands between them, at 18.4.
    expect(N.stableZ(40)).toBeGreaterThan(18);
    expect(N.stableZ(40)).toBeLessThan(20);
  });

  it('says which way a wrong nucleus would fall', () => {
    expect(N.decayMode(26, 56)).toMatch(/stable/);
    expect(N.decayMode(20, 56)).toMatch(/beta/);          // too few protons
    expect(N.decayMode(30, 56)).toMatch(/positron|capture/);
    expect(N.decayMode(92, 238)).toMatch(/alpha/);
  });
});

describe('what comes out', () => {
  it('gets the alpha energy of uranium right', () => {
    // 4.3 MeV against a measured 4.27, from a difference of two numbers near
    // 1800 - which is why the formula's one-percent accuracy is impressive
    // here and only fair for other nuclides.
    expect(N.alphaQ(92, 238)).toBeGreaterThan(3.5);
    expect(N.alphaQ(92, 238)).toBeLessThan(5.0);
  });

  it('forbids alpha decay for iron and allows it for everything heavy', () => {
    expect(N.alphaQ(26, 56)).toBeLessThan(0);
    expect(N.alphaQ(92, 238)).toBeGreaterThan(0);
    let first = 0;
    for (let a = 100; a <= 260; a++) {
      if (N.alphaQ(Math.round(N.stableZ(a)), a) > 0) { first = a; break; }
    }
    // Real alpha emitters begin in the neodymium-samarium region, A about 145.
    expect(first).toBeGreaterThan(130);
    expect(first).toBeLessThan(180);
  });

  it('overshoots at the magic numbers, because a liquid drop has no shells', () => {
    // Lead-208 is doubly magic - 82 protons and 126 neutrons both close a
    // shell - so it is bound far harder than a smooth formula can know, and
    // the formula gives it 2.7 MeV of alpha energy against a measured 0.5. It
    // is the same blindness that ruins helium, showing up at the other end.
    expect(N.alphaQ(82, 208)).toBeGreaterThan(1.5);
    expect(N.alphaQ(82, 208)).toBeLessThan(4);
  });

  it('gets the energy of a fission to the number everyone quotes', () => {
    const q = N.fissionQ(92, 238);
    expect(q).toBeGreaterThan(150);
    expect(q).toBeLessThan(220);
  });

  it('will not let iron fission or fuse', () => {
    // The end of the road, in two assertions. Nothing a star can do to iron
    // gives any energy back, so a star that has made iron has nothing left to
    // hold itself up with, and it falls in.
    expect(N.fissionQ(26, 56)).toBeLessThan(0);
    expect(N.fusionGain(26, 56)).toBeLessThan(0);
  });

  it('lets everything below iron fuse and give energy', () => {
    for (const [z, a] of [[2, 4], [6, 12], [8, 16], [10, 20], [14, 28]] as [number, number][]) {
      expect(N.fusionGain(z, a), `Z=${z}`).toBeGreaterThan(0);
    }
  });

  it('will not let two protons stick, which is why the sun burns slowly', () => {
    // The exception at the very bottom of the curve, and the most
    // consequential negative number in the sky. Helium-2 - two protons and no
    // neutron - is unbound, so the first step of the proton-proton chain
    // cannot simply happen: one of the two has to turn into a neutron by the
    // weak force during the moment they are touching. That almost never comes
    // off, and it is why the sun takes ten billion years over something it has
    // the fuel to do in minutes.
    expect(N.fusionGain(1, 1)).toBeLessThan(0);
    expect(N.bindingPerNucleon(2, 2)).toBeLessThan(0);
    // Give one of them a neutron and it works immediately: deuterium binds.
    expect(N.fusionGain(1, 2)).toBeGreaterThan(0);
  });

  it('is a million times a chemical bond', () => {
    const ratio = N.nuclearOverChemical(26, 56);
    expect(ratio).toBeGreaterThan(1e6);
    expect(ratio).toBeLessThan(1e7);
  });

  it('weighs less than its parts, by about one percent', () => {
    // E = mc^2 read backwards. The missing mass is the energy that came out.
    expect(N.massDefect(26, 56)).toBeGreaterThan(0.008);
    expect(N.massDefect(26, 56)).toBeLessThan(0.011);
    expect(N.nucleusMass(26, 56)).toBeLessThan(26 * 1.67262192369e-27 + 30 * N.M_NUCLEON);
  });
});

describe('the shape and the churn', () => {
  it('is flat in the middle and falls off over half a femtometre', () => {
    const a = 208, R = N.nuclearRadius(a);
    expect(N.woodsSaxon(0, a)).toBeCloseTo(1, 3);
    expect(N.woodsSaxon(R, a)).toBeCloseTo(0.5, 9);
    expect(N.woodsSaxon(R + 3 * N.SURFACE_A, a)).toBeLessThan(0.05);
  });

  it('gives every nucleus the same density, near enough', () => {
    // Saturation. The measured value is 0.16 nucleons per cubic femtometre and
    // the light ones fall short only because they are nearly all surface.
    for (const a of [56, 120, 208, 238]) {
      const n = N.centralDensity(a) * 1e-45;
      expect(n, `A=${a}`).toBeGreaterThan(0.13);
      expect(n, `A=${a}`).toBeLessThan(0.18);
    }
    expect(N.centralDensity(4)).toBeLessThan(N.centralDensity(208));
  });

  it('is two hundred million million million times denser than water', () => {
    expect(N.matterDensity(56) / 1000).toBeGreaterThan(1e14);
    expect(N.matterDensity(56) / 1000).toBeLessThan(1e15);
  });

  it('has nucleons moving at a quarter of light speed with nothing stirring them', () => {
    // Pauli exclusion: they cannot all sit in the lowest state, so they are
    // forced up a ladder of momenta whether they like it or not.
    expect(N.fermiSpeed(56) / 2.99792458e8).toBeGreaterThan(0.2);
    expect(N.fermiSpeed(56) / 2.99792458e8).toBeLessThan(0.33);
    expect(N.fermiEnergyMeV(208)).toBeGreaterThan(25);
    expect(N.fermiEnergyMeV(208)).toBeLessThan(45);
  });

  it('samples nucleons inside the drop and not outside it', () => {
    let s = 12345 >>> 0;
    const rnd = (): number => {
      s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
    const R = N.nuclearRadius(56);
    let inside = 0, far = 0;
    for (let k = 0; k < 4000; k++) {
      const p = N.sampleNucleon(56, rnd);
      const r = Math.hypot(...p);
      if (r < R) inside++;
      if (r > R + 4 * N.SURFACE_A) far++;
    }
    // Most of them inside the half-density radius, and essentially none far out.
    expect(inside / 4000).toBeGreaterThan(0.6);
    expect(far / 4000).toBeLessThan(0.02);
  });
});
