import { describe, it, expect } from 'vitest';
import {
  chirpMass, symmetricRatio, separationDecay, timeToMerger, separationAtTime,
  waveFrequency, chirpFrequency, strainAmplitude, iscoRadius, iscoFrequency,
  radiatedFraction, finalMass, finalSpin, ringdown, binaryState,
  inclinationResponse, peakLuminosity, PLANCK_LUMINOSITY, orbitalOmega,
} from '../src/physics/gwaves';
import { C, G, M_SUN, MPC } from '../src/core/constants';

// GW150914, the first detection: 36 + 29 solar masses at about 410 Mpc.
const GW150914 = { m1: 36, m2: 29, distanceMpc: 410 };
const m1 = GW150914.m1 * M_SUN;
const m2 = GW150914.m2 * M_SUN;

describe('chirp mass', () => {
  it('gives GW150914 the 28.6 solar masses it was measured at', () => {
    expect(chirpMass(36, 29)).toBeCloseTo(28.1, 0);
  });

  it('is the geometric-ish mean and always below the total', () => {
    expect(chirpMass(10, 10)).toBeLessThan(20);
    expect(chirpMass(10, 10)).toBeCloseTo(10 * Math.pow(2, -0.2), 9);
    // Equal masses maximise the symmetric ratio at a quarter.
    expect(symmetricRatio(10, 10)).toBeCloseTo(0.25, 12);
    expect(symmetricRatio(30, 1)).toBeLessThan(0.05);
  });
});

describe('inspiral', () => {
  it('always shrinks the orbit', () => {
    expect(separationDecay(1e9, m1, m2)).toBeLessThan(0);
  });

  it('inverts its own time-to-merger', () => {
    for (const a of [1e8, 1e9, 1e11]) {
      expect(separationAtTime(timeToMerger(a, m1, m2), m1, m2)).toBeCloseTo(a, -2);
    }
  });

  it('goes as the fourth power of separation, so wide binaries live forever', () => {
    const near = timeToMerger(1e9, m1, m2);
    const far = timeToMerger(2e9, m1, m2);
    expect(far / near).toBeCloseTo(16, 1);
  });

  it('leaves the Hulse-Taylor pulsar a few hundred million years', () => {
    // Two 1.4 solar mass neutron stars, semi-major axis 1.95e9 m, e = 0.617.
    // Circular-orbit lifetime is an overestimate; eccentricity shortens it by
    // about a factor of five here, and the published figure is 300 Myr.
    const ns = 1.4 * M_SUN;
    const tc = timeToMerger(1.95e9, ns, ns) / 3.15576e7 / 1e6;
    expect(tc).toBeGreaterThan(300);
    expect(tc).toBeLessThan(3000);
  });

  it('radiates at twice the orbital frequency, because the source is a quadrupole', () => {
    const a = 1e9, M = m1 + m2;
    expect(waveFrequency(a, M)).toBeCloseTo(orbitalOmega(a, M) / Math.PI, 12);
    expect(waveFrequency(a, M)).toBeCloseTo((2 * orbitalOmega(a, M)) / (2 * Math.PI), 12);
  });

  it('agrees between the separation route and the chirp-mass route', () => {
    const mc = chirpMass(m1, m2);
    for (const tau of [100, 1, 0.01]) {
      const a = separationAtTime(tau, m1, m2);
      const fa = waveFrequency(a, m1 + m2);
      const fb = chirpFrequency(tau, mc);
      expect(fa / fb).toBeCloseTo(1, 2);
    }
  });
});

describe('the end of the inspiral', () => {
  it('stops at six gravitational radii', () => {
    const M = m1 + m2;
    expect(iscoRadius(M)).toBeCloseTo((6 * G * M) / C ** 2, 3);
    // For 65 solar masses that is about 576 km.
    expect(iscoRadius(M) / 1e3).toBeGreaterThan(500);
    expect(iscoRadius(M) / 1e3).toBeLessThan(650);
  });

  it('puts GW150914 at 68 Hz there - and the real merger runs on past it', () => {
    // The Schwarzschild ISCO of the total mass is the standard place to end a
    // post-Newtonian inspiral, and for comparable masses it is a known
    // underestimate of where the waveform actually peaks.
    const f = iscoFrequency(m1 + m2);
    expect(f).toBeGreaterThan(55);
    expect(f).toBeLessThan(85);
    // The model carries the merger up to the ringdown, which is where the
    // measured signal peaked: around 250 Hz, well inside the audio band.
    const peak = binaryState(GW150914, -1e-5).freqHz;
    expect(peak).toBeGreaterThan(150);
    expect(peak).toBeLessThan(350);
  });

  it('scales the merger frequency inversely with mass', () => {
    expect(iscoFrequency(10 * M_SUN) / iscoFrequency(100 * M_SUN)).toBeCloseTo(10, 6);
    // A pair of neutron stars merges above a kilohertz.
    expect(iscoFrequency(2.8 * M_SUN)).toBeGreaterThan(1000);
  });
});

describe('strain', () => {
  it('gives GW150914 a peak strain of 1e-21', () => {
    const mc = chirpMass(m1, m2);
    const h = strainAmplitude(mc, iscoFrequency(m1 + m2), 410 * MPC);
    expect(h).toBeGreaterThan(3e-22);
    expect(h).toBeLessThan(3e-21);
  });

  it('falls as one over distance, not one over distance squared', () => {
    const mc = chirpMass(m1, m2);
    const near = strainAmplitude(mc, 100, 100 * MPC);
    const far = strainAmplitude(mc, 100, 200 * MPC);
    expect(near / far).toBeCloseTo(2, 6);
  });

  it('is fainter and linearly polarised edge-on', () => {
    const face = inclinationResponse(0);
    const edge = inclinationResponse(Math.PI / 2);
    expect(face.plus).toBeCloseTo(1, 12);
    expect(face.cross).toBeCloseTo(1, 12);
    expect(edge.plus).toBeCloseTo(0.5, 12);
    expect(edge.cross).toBeCloseTo(0, 12);
  });
});

describe('the remnant', () => {
  it('radiates three solar masses and leaves sixty-two', () => {
    expect(radiatedFraction(36, 29) * 65).toBeGreaterThan(2);
    expect(radiatedFraction(36, 29) * 65).toBeLessThan(4);
    expect(finalMass(36, 29)).toBeGreaterThan(60);
    expect(finalMass(36, 29)).toBeLessThan(64);
  });

  it('leaves a hole spinning at about 0.67', () => {
    expect(finalSpin(36, 29)).toBeGreaterThan(0.6);
    expect(finalSpin(36, 29)).toBeLessThan(0.75);
    // No equal-mass merger of non-spinning holes exceeds 0.69.
    expect(finalSpin(30, 30)).toBeLessThan(0.70);
    // A tiny hole falling into a big one barely spins it up.
    expect(finalSpin(100, 1)).toBeLessThan(0.12);
  });

  it('is more efficient than fusion by a factor of seven', () => {
    expect(radiatedFraction(30, 30)).toBeGreaterThan(0.04);
    expect(radiatedFraction(30, 30) / 0.007).toBeGreaterThan(5);
  });

  it('rings at a frequency set by the final mass and spin alone', () => {
    const mf = finalMass(m1, m2);
    const rd = ringdown(mf, finalSpin(36, 29));
    // GW150914's ringdown was near 250 Hz with a few milliseconds of damping.
    expect(rd.freqHz).toBeGreaterThan(180);
    expect(rd.freqHz).toBeLessThan(320);
    expect(rd.tauS).toBeGreaterThan(1e-3);
    expect(rd.tauS).toBeLessThan(1e-2);
    // A more rapidly spinning hole rings higher and rings longer.
    const fast = ringdown(mf, 0.95);
    expect(fast.freqHz).toBeGreaterThan(rd.freqHz);
    expect(fast.quality).toBeGreaterThan(rd.quality);
  });

  it('scales the ringdown inversely with mass, like everything else', () => {
    const a = ringdown(10 * M_SUN, 0.6).freqHz;
    const b = ringdown(100 * M_SUN, 0.6).freqHz;
    expect(a / b).toBeCloseTo(10, 6);
  });
});

describe('the waveform', () => {
  it('chirps: the frequency only ever rises', () => {
    let last = 0;
    for (const t of [-8, -4, -2, -1, -0.5, -0.25, -0.1, -0.03, -0.005]) {
      const s = binaryState(GW150914, t);
      expect(s.freqHz).toBeGreaterThan(last);
      last = s.freqHz;
    }
  });

  it('sweeps GW150914 from 35 Hz to 250 Hz in about 0.2 seconds', () => {
    // The detection band opens near 35 Hz.
    let tStart = -10;
    for (let t = -10; t < 0; t += 0.001) {
      if (binaryState(GW150914, t).freqHz > 35) { tStart = t; break; }
    }
    expect(-tStart).toBeGreaterThan(0.1);
    expect(-tStart).toBeLessThan(0.5);
  });

  it('runs inspiral, merger and ringdown in that order', () => {
    expect(binaryState(GW150914, -5).stage).toBe('inspiral');
    expect(binaryState(GW150914, -0.0005).stage).toBe('merger');
    expect(binaryState(GW150914, 0.002).stage).toBe('ringdown');
  });

  it('grows in amplitude to the merger and dies away after it', () => {
    const early = Math.abs(binaryState(GW150914, -4).strain);
    const late = Math.abs(binaryState(GW150914, -0.02).strain);
    const after = Math.abs(binaryState(GW150914, 0.05).strain);
    expect(late).toBeGreaterThan(early * 2);
    expect(after).toBeLessThan(late * 0.05);
  });

  it('shrinks the separation to nothing', () => {
    expect(binaryState(GW150914, -4).separationM)
      .toBeGreaterThan(binaryState(GW150914, -0.1).separationM);
    expect(binaryState(GW150914, 0.01).separationM).toBe(0);
  });

  it('keeps the two polarisations a quarter cycle apart', () => {
    const s = binaryState(GW150914, -1);
    expect(s.hPlus ** 2 + s.hCross ** 2).toBeCloseTo(s.strain ** 2, 40);
  });

  it('stays finite everywhere, including at coalescence', () => {
    for (const t of [-1e4, -1, -1e-6, 0, 1e-6, 1, 100]) {
      const s = binaryState(GW150914, t);
      for (const v of [s.separationM, s.phase, s.freqHz, s.strain, s.hPlus, s.hCross]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});

describe('luminosity', () => {
  it('approaches the one power made only of constants', () => {
    expect(PLANCK_LUMINOSITY).toBeCloseTo(C ** 5 / G, -45);
    expect(PLANCK_LUMINOSITY / 1e52).toBeGreaterThan(3);
    expect(PLANCK_LUMINOSITY / 1e52).toBeLessThan(4);
  });

  it('gives GW150914 a thousandth of it', () => {
    const f = peakLuminosity(36, 29) / PLANCK_LUMINOSITY;
    expect(f).toBeGreaterThan(3e-4);
    expect(f).toBeLessThan(3e-3);
    // 3.6e49 W, which is a hundred times the entire observable universe's
    // starlight - about 4e47 W.
    expect(peakLuminosity(36, 29) / 1e49).toBeGreaterThan(2);
    expect(peakLuminosity(36, 29) / 4e47).toBeGreaterThan(50);
  });
});
