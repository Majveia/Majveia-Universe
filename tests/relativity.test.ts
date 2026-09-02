import { describe, it, expect } from 'vitest';
import {
  gamma, aberrate, unaberrate, dopplerFactor, beamingFactor, shiftedTemperature,
  cmbTemperature, visibleFraction, headlightHalfAngle, properTime, T_CMB,
} from '../src/physics/relativity';

const DEG = Math.PI / 180;

describe('Lorentz factor', () => {
  it('is one at rest and diverges at c', () => {
    expect(gamma(0)).toBe(1);
    expect(gamma(0.6)).toBeCloseTo(1.25, 12);
    expect(gamma(0.8)).toBeCloseTo(5 / 3, 12);
    expect(gamma(0.99)).toBeCloseTo(7.0888, 3);
    expect(gamma(0.9999995)).toBeGreaterThan(900);
  });

  it('does not care about the sign of the velocity', () => {
    expect(gamma(-0.7)).toBeCloseTo(gamma(0.7), 12);
  });
});

describe('aberration', () => {
  it('does nothing at rest', () => {
    for (const t of [0, 0.4, 1.2, Math.PI / 2, 3.0]) {
      expect(aberrate(t, 0)).toBeCloseTo(t, 12);
      expect(unaberrate(t, 0)).toBeCloseTo(t, 12);
    }
  });

  it('leaves the poles alone: dead ahead is still dead ahead', () => {
    expect(aberrate(0, 0.9)).toBeCloseTo(0, 12);
    expect(aberrate(Math.PI, 0.9)).toBeCloseTo(Math.PI, 12);
  });

  it('sweeps everything forward', () => {
    for (const t of [0.5, 1.0, Math.PI / 2, 2.0, 2.8]) {
      expect(aberrate(t, 0.8)).toBeLessThan(t);
    }
  });

  it('inverts exactly', () => {
    for (const b of [0.2, 0.75, 0.99, 0.99999]) {
      for (const t of [0.1, 0.9, Math.PI / 2, 2.4, 3.0]) {
        expect(unaberrate(aberrate(t, b), b)).toBeCloseTo(t, 6);
      }
    }
  });

  it('squeezes the whole forward hemisphere into a narrow cone', () => {
    // sin(half angle) = 1/gamma for the beta -> 1 limit of the 90 degree ray.
    expect(headlightHalfAngle(0) / DEG).toBeCloseTo(90, 9);
    expect(headlightHalfAngle(0.9) / DEG).toBeCloseTo(25.84, 1);
    expect(headlightHalfAngle(0.99) / DEG).toBeLessThan(9);
    expect(Math.sin(headlightHalfAngle(0.99))).toBeCloseTo(1 / gamma(0.99), 6);
  });
});

describe('Doppler and beaming', () => {
  it('gives the longitudinal factors ahead and behind', () => {
    const b = 0.6;
    expect(dopplerFactor(0, b)).toBeCloseTo(Math.sqrt((1 + b) / (1 - b)), 12);
    expect(dopplerFactor(Math.PI, b)).toBeCloseTo(Math.sqrt((1 - b) / (1 + b)), 12);
  });

  it('redshifts light arriving exactly sideways, which has no classical analogue', () => {
    const b = 0.8;
    const d = dopplerFactor(Math.PI / 2, b);
    expect(d).toBeCloseTo(1 / gamma(b), 12);
    expect(d).toBeLessThan(1);
  });

  it('brightens as the fourth power of the Doppler factor', () => {
    const b = 0.9;
    const d = dopplerFactor(0.3, b);
    expect(beamingFactor(0.3, b)).toBeCloseTo(d ** 4, 9);
    // Ahead at beta = 0.9, D is about 4.36, so the sky is 360 times brighter.
    expect(beamingFactor(0, b)).toBeGreaterThan(300);
    // And behind, it is that much darker.
    expect(beamingFactor(Math.PI, b)).toBeLessThan(0.004);
  });

  it('keeps a blackbody a blackbody at a shifted temperature', () => {
    expect(shiftedTemperature(5772, 2)).toBeCloseTo(11544, 9);
    expect(shiftedTemperature(5772, 0.5)).toBeCloseTo(2886, 9);
  });
});

describe('the microwave background from a moving frame', () => {
  it('reproduces the solar dipole', () => {
    // The Sun's 370 km/s through the CMB frame.
    const beta = 370 / 299792.458;
    const hot = cmbTemperature(0, beta);
    const cold = cmbTemperature(Math.PI, beta);
    // 3.36 mK, and it is a dipole: the amplitude is beta * T to first order.
    expect(((hot - cold) / 2) * 1e3).toBeCloseTo(3.36, 1);
    expect((hot + cold) / 2).toBeCloseTo(T_CMB, 4);
  });

  it('brings the background up into the visible only at extreme speed', () => {
    // Invisible at any sane speed.
    expect(visibleFraction(cmbTemperature(0, 0.99))).toBeLessThan(1e-100);
    // Still nothing at gamma of a hundred.
    expect(cmbTemperature(0, 0.99995)).toBeLessThan(600);
    // But by gamma ~ 1000 the forward sky is a glowing wall.
    const t = cmbTemperature(0, 0.9999995);
    expect(t).toBeGreaterThan(2000);
    expect(visibleFraction(t)).toBeGreaterThan(1e-6);
  });
});

describe('time dilation', () => {
  it('turns a thousand years outside into one on board', () => {
    const yearS = 3.15576e7;
    const beta = 0.9999995;
    expect(properTime(1000 * yearS, beta) / yearS).toBeGreaterThan(0.9);
    expect(properTime(1000 * yearS, beta) / yearS).toBeLessThan(1.2);
  });
});
