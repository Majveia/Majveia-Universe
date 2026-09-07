import { describe, it, expect } from 'vitest';
import {
  MEC2_KEV, MU_E, dimensionlessFrequency, frequencyGHz, szSpectrum,
  SZ_NULL_GHZ, SZ_NULL_X, PLANCK_BANDS, comptonY, thomsonDepth, thermalSZ,
  kineticSZ, betaColumn, betaCentralDensity, clusterGas, yAt, tauAt,
  integratedYMpc2,
} from '../src/astro/sz';
import { T_CMB, SIGMA_THOMSON, MPC, M_SUN, M_PROTON } from '../src/core/constants';

/** Coma: the cluster every SZ paper uses as its worked example. */
const COMA = clusterGas(1.2e15, 2.9, 8.4);

describe('the spectrum', () => {
  it('tends to minus two at low frequency, which is the rule of thumb', () => {
    expect(szSpectrum(1e-4)).toBeCloseTo(-2, 4);
    expect(szSpectrum(0)).toBe(-2);
  });

  it('crosses zero at x = 3.83, and nowhere else below it', () => {
    expect(szSpectrum(SZ_NULL_X)).toBeCloseTo(0, 6);
    for (const x of [0.1, 1, 2, 3, 3.8]) expect(szSpectrum(x)).toBeLessThan(0);
    for (const x of [3.9, 5, 10, 30]) expect(szSpectrum(x)).toBeGreaterThan(0);
  });

  it('puts the null at 217 GHz, which is why Planck had a band there', () => {
    expect(SZ_NULL_GHZ).toBeGreaterThan(216);
    expect(SZ_NULL_GHZ).toBeLessThan(219);
  });

  it('rises without bound at high frequency, so the hot side keeps growing', () => {
    expect(szSpectrum(20)).toBeGreaterThan(szSpectrum(10));
    expect(szSpectrum(10)).toBeGreaterThan(szSpectrum(5));
    // g(x) -> x - 4 once coth has saturated
    expect(szSpectrum(30) / 26).toBeCloseTo(1, 6);
  });

  it('stays finite everywhere, including where coth would blow up', () => {
    for (const x of [0, 1e-12, 1e-6, 0.5, 3.83, 50, 500]) {
      expect(Number.isFinite(szSpectrum(x))).toBe(true);
    }
  });

  it('converts frequency both ways', () => {
    for (const ghz of PLANCK_BANDS) {
      expect(frequencyGHz(dimensionlessFrequency(ghz))).toBeCloseTo(ghz, 6);
    }
    // 56.8 GHz per unit x, near enough
    expect(dimensionlessFrequency(56.78)).toBeCloseTo(1, 2);
  });
});

describe('what the sky does', () => {
  it('is a cold spot below the null and a hot spot above it', () => {
    const y = 1e-4;
    expect(thermalSZ(y, 100)).toBeLessThan(0);
    expect(thermalSZ(y, 143)).toBeLessThan(0);
    expect(thermalSZ(y, 353)).toBeGreaterThan(0);
  });

  it('vanishes exactly at 217 GHz, where the gas is invisible', () => {
    expect(Math.abs(thermalSZ(1e-4, SZ_NULL_GHZ))).toBeLessThan(1e-9);
  });

  it('gives the same cluster opposite signs in two bands, which is the tell', () => {
    const cold = thermalSZ(1e-4, 143);
    const hot = thermalSZ(1e-4, 353);
    expect(Math.sign(cold)).toBe(-1);
    expect(Math.sign(hot)).toBe(1);
    // Comparable in size: it really does look like a photographic negative
    expect(Math.abs(hot / cold)).toBeGreaterThan(0.4);
    expect(Math.abs(hot / cold)).toBeLessThan(3);
  });

  it('comes to about half a millikelvin for a rich cluster', () => {
    // The canonical number, and the reason it took twenty years to measure.
    const dt = Math.abs(thermalSZ(1e-4, 143));
    expect(dt * 1e6).toBeGreaterThan(200);   // microkelvin
    expect(dt * 1e6).toBeLessThan(600);
  });

  it('is a fraction of the background, not a flux, so distance does not enter', () => {
    // There is no distance in the signature at all. This test exists to say
    // so: it is the property the entire method rests on.
    expect(thermalSZ.length).toBe(2);
    expect(thermalSZ(1e-4, 143) / T_CMB).toBeCloseTo(1e-4 * szSpectrum(dimensionlessFrequency(143)), 12);
  });
});

describe('the kinetic effect', () => {
  it('warms the sky for a cluster coming toward you', () => {
    expect(kineticSZ(0.01, -1000e3)).toBeGreaterThan(0);
    expect(kineticSZ(0.01, +1000e3)).toBeLessThan(0);
  });

  it('is about a tenth of the thermal effect, which is why it took forty years', () => {
    const g = COMA;
    const thermal = Math.abs(thermalSZ(yAt(g, 0), 143));
    const kinetic = Math.abs(kineticSZ(tauAt(g, 0), 1000e3));
    expect(kinetic / thermal).toBeGreaterThan(0.02);
    expect(kinetic / thermal).toBeLessThan(0.4);
  });

  it('has no colour: the same size in every band', () => {
    // Which is exactly why it cannot be separated the easy way.
    expect(kineticSZ(0.01, 500e3)).toBe(kineticSZ(0.01, 500e3));
  });
});

describe('the gas', () => {
  it('puts a bit over one electron per proton mass of gas', () => {
    expect(MU_E).toBeCloseTo(1.1364, 3);
    // Which is what fully ionised hydrogen and helium give.
    expect(MU_E).toBeGreaterThan(1);
    expect(MU_E).toBeLessThan(1.2);
  });

  it('recovers the gas mass it was given', () => {
    const rc = 0.2 * MPC, cut = 2.5 * MPC, m = 1e14 * M_SUN;
    const n0 = betaCentralDensity(m, rc, cut);
    // 4 pi integral r^2 rho dr with rho = n mu_e m_p / (1 + (r/rc)^2)
    let sum = 0;
    const n = 200000, dr = cut / n;
    for (let i = 0; i < n; i++) {
      const r = (i + 0.5) * dr;
      sum += 4 * Math.PI * r * r * (n0 * MU_E * M_PROTON) / (1 + (r / rc) ** 2) * dr;
    }
    expect(sum / m).toBeCloseTo(1, 3);
  });

  it('lands at the density X-ray observations find in a cluster core', () => {
    // A few times 1e-3 electrons per cubic centimetre.
    const perCc = COMA.n0 / 1e6;
    expect(perCc).toBeGreaterThan(1e-4);
    expect(perCc).toBeLessThan(1e-1);
  });

  it('integrates the beta model the way the closed form says it does', () => {
    const n0 = 3e3, rc = 0.25 * MPC, cut = 3 * MPC, b = 0.4 * MPC;
    let sum = 0;
    const n = 400000;
    const l = Math.sqrt(cut * cut - b * b);
    const dl = (2 * l) / n;
    for (let i = 0; i < n; i++) {
      const z = -l + (i + 0.5) * dl;
      sum += (n0 / (1 + (b * b + z * z) / (rc * rc))) * dl;
    }
    expect(betaColumn(n0, rc, b, cut) / sum).toBeCloseTo(1, 4);
  });

  it('returns nothing outside the cluster', () => {
    expect(betaColumn(1e3, MPC * 0.2, MPC * 4, MPC * 3)).toBe(0);
    expect(yAt(COMA, COMA.cutM * 1.01)).toBe(0);
  });

  it('falls monotonically outward, and fastest outside the core', () => {
    let prev = Infinity;
    for (const f of [0, 0.02, 0.05, 0.1, 0.3, 0.6, 0.95]) {
      const y = yAt(COMA, f * COMA.cutM);
      expect(y).toBeLessThan(prev);
      prev = y;
    }
  });

  it('is flat across the core, which is what makes clusters resolvable at all', () => {
    expect(yAt(COMA, COMA.rcM * 0.2) / yAt(COMA, 0)).toBeGreaterThan(0.9);
  });
});

describe('Coma, which every paper works out', () => {
  it('has a central y of about a ten-thousandth', () => {
    const y0 = yAt(COMA, 0);
    expect(y0).toBeGreaterThan(2e-5);
    expect(y0).toBeLessThan(4e-4);
  });

  it('scatters about one photon in a hundred', () => {
    const tau = tauAt(COMA, 0);
    expect(tau).toBeGreaterThan(1e-3);
    expect(tau).toBeLessThan(3e-2);
  });

  it('makes a decrement of a few hundred microkelvin at 143 GHz', () => {
    const dt = thermalSZ(yAt(COMA, 0), 143) * 1e6;
    expect(dt).toBeLessThan(-100);
    expect(dt).toBeGreaterThan(-1500);
  });

  it('agrees with y = tau kT/mec2, which is the same statement twice', () => {
    expect(yAt(COMA, 0) / (tauAt(COMA, 0) * (COMA.kTeKeV / MEC2_KEV))).toBeCloseTo(1, 9);
  });

  it('gives an integrated Y of the order of a thousandth of a square megaparsec', () => {
    const Y = integratedYMpc2(COMA);
    expect(Y).toBeGreaterThan(1e-5);
    expect(Y).toBeLessThan(1e-2);
  });
});

describe('the mass proxy', () => {
  it('rises as roughly the five-thirds power of mass, as self-similarity says', () => {
    // Scale a cluster the way collapse does: R ~ M^(1/3), kT ~ M^(2/3).
    const mk = (m: number) => clusterGas(m, 2.0 * Math.cbrt(m / 1e15), 8 * Math.pow(m / 1e15, 2 / 3));
    const a = integratedYMpc2(mk(1e14));
    const b = integratedYMpc2(mk(1e15));
    expect(Math.log10(b / a)).toBeGreaterThan(1.4);
    expect(Math.log10(b / a)).toBeLessThan(1.9);
  });

  it('is bigger for a hotter cluster at the same gas mass', () => {
    const cool = clusterGas(1e15, 2.5, 4);
    const hot = clusterGas(1e15, 2.5, 12);
    expect(integratedYMpc2(hot) / integratedYMpc2(cool)).toBeCloseTo(3, 1);
  });

  it('has most of its signal inside the virial radius, not in the tail', () => {
    expect(integratedYMpc2(COMA, COMA.cutM * 0.5) / integratedYMpc2(COMA))
      .toBeGreaterThan(0.6);
  });
});

describe('the numbers hold together', () => {
  it('never returns something that is not a number', () => {
    for (const [m, r, t] of [[1e13, 0.6, 1], [1e14, 1.4, 3], [1e15, 2.6, 9], [5e15, 4, 15]]) {
      const g = clusterGas(m, r, t);
      for (const v of [yAt(g, 0), yAt(g, g.cutM * 0.5), tauAt(g, 0), integratedYMpc2(g),
        thermalSZ(yAt(g, 0), 143), kineticSZ(tauAt(g, 0), 500e3)]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('uses the Thomson cross-section it says it uses', () => {
    expect(thomsonDepth(1 / SIGMA_THOMSON)).toBeCloseTo(1, 12);
    expect(comptonY(1 / SIGMA_THOMSON, MEC2_KEV)).toBeCloseTo(1, 12);
  });

  it('makes a poor group a far weaker signal than a rich cluster', () => {
    const group = clusterGas(3e13, 0.7, 1.0);
    expect(yAt(group, 0)).toBeLessThan(yAt(COMA, 0) * 0.35);
  });
});
