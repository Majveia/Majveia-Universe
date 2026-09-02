import { describe, it, expect } from 'vitest';
import {
  einsteinAngle, einsteinMass, deflection, lensEquation, jacobianDet, magnification,
  imagesOnAxis, tangentialCriticalRadius, isSupercritical, type LensModel,
} from '../src/physics/lensing';

const ARCSEC = 206264.806;

const circular = (thetaE: number, core: number): LensModel =>
  ({ thetaE, thetaCore: core, q: 1, pa: 0 });

describe('Einstein angle', () => {
  it('gives about 40 arcseconds for a rich cluster', () => {
    const t = einsteinAngle(1200) * ARCSEC;
    expect(t).toBeGreaterThan(25);
    expect(t).toBeLessThan(60);
  });

  it('scales as the square of the velocity dispersion', () => {
    expect(einsteinAngle(2000) / einsteinAngle(1000)).toBeCloseTo(4, 6);
  });

  it('is far smaller for a galaxy than for a cluster', () => {
    // A massive elliptical has sigma ~ 250 km/s: about 1.4 arcsec, which is
    // exactly the scale of the galaxy-galaxy lenses SDSS found.
    const t = einsteinAngle(250) * ARCSEC;
    expect(t).toBeGreaterThan(0.7);
    expect(t).toBeLessThan(3);
  });

  it('vanishes when the source is in front of the lens', () => {
    expect(einsteinAngle(1200, 0)).toBe(0);
  });
});

describe('deflection field', () => {
  const m = circular(1e-4, 1e-6);

  it('points inward and saturates at the Einstein angle', () => {
    // An isothermal sphere deflects by a constant angle outside its core.
    const [ax] = deflection(m, 5e-4, 0);
    expect(ax).toBeCloseTo(m.thetaE, 8);
    const [bx] = deflection(m, -5e-4, 0);
    expect(bx).toBeCloseTo(-m.thetaE, 8);
  });

  it('goes to zero at the centre, as a cored profile must', () => {
    const [ax, ay] = deflection(m, 0, 0);
    expect(Math.hypot(ax, ay)).toBeLessThan(1e-12);
  });

  it('is rotationally symmetric when q = 1', () => {
    const r = 3e-4;
    for (const th of [0, 0.7, 1.9, 4.4]) {
      const [ax, ay] = deflection(m, r * Math.cos(th), r * Math.sin(th));
      expect(Math.hypot(ax, ay)).toBeCloseTo(m.thetaE, 8);
    }
  });

  it('is not symmetric when the mass distribution is elliptical', () => {
    const e: LensModel = { thetaE: 1e-4, thetaCore: 1e-6, q: 0.5, pa: 0 };
    const along = Math.hypot(...deflection(e, 3e-4, 0));
    const across = Math.hypot(...deflection(e, 0, 3e-4));
    expect(Math.abs(along / across - 1)).toBeGreaterThan(0.2);
  });
});

describe('critical curves and multiple images', () => {
  it('puts the tangential critical curve at the Einstein radius', () => {
    const m = circular(1e-4, 1e-7);
    expect(tangentialCriticalRadius(m)).toBeCloseTo(m.thetaE, 7);
  });

  it('is supercritical only when the core is small compared to theta_E', () => {
    expect(isSupercritical(circular(1e-4, 1e-6))).toBe(true);
    // A core as large as the Einstein radius smooths the lens out entirely:
    // the map stays one-to-one, and there are no arcs at all.
    expect(isSupercritical(circular(1e-4, 2e-4))).toBe(false);
  });

  it('produces a ring for a source exactly behind the centre', () => {
    const m = circular(1e-4, 1e-7);
    const imgs = imagesOnAxis(m, 0);
    // Two images on the axis, at +/- theta_E: the section through a ring.
    const outer = imgs.filter((t) => Math.abs(Math.abs(t) - m.thetaE) < m.thetaE * 0.02);
    expect(outer.length).toBe(2);
  });

  it('produces two images for a source inside the caustic', () => {
    const m = circular(1e-4, 1e-7);
    const imgs = imagesOnAxis(m, 0.4e-4).filter((t) => Math.abs(t) > m.thetaE * 0.05);
    expect(imgs.length).toBe(2);
    // One on each side of the lens centre
    expect(Math.sign(imgs[0]) * Math.sign(imgs[imgs.length - 1])).toBe(-1);
  });

  it('leaves a single image for a source well outside the caustic', () => {
    const m = circular(1e-4, 1e-7);
    const imgs = imagesOnAxis(m, 5e-4, 12).filter((t) => Math.abs(t) > m.thetaE * 0.05);
    expect(imgs.length).toBe(1);
  });

  it('magnifies the outer image more than the inner one', () => {
    const m = circular(1e-4, 1e-7);
    const imgs = imagesOnAxis(m, 0.4e-4).filter((t) => Math.abs(t) > m.thetaE * 0.05);
    const [a, b] = imgs.map((t) => ({ t, mu: magnification(m, t, 0) }));
    const outer = Math.abs(a.t) > Math.abs(b.t) ? a : b;
    const inner = outer === a ? b : a;
    expect(outer.mu).toBeGreaterThan(inner.mu);
  });

  it('drives the magnification up near the critical curve', () => {
    const m = circular(1e-4, 1e-7);
    const near = magnification(m, m.thetaE * 1.02, 0);
    const far = magnification(m, m.thetaE * 3, 0);
    expect(near).toBeGreaterThan(far * 5);
  });

  it('changes the sign of det A across the critical curve', () => {
    const m = circular(1e-4, 1e-7);
    expect(jacobianDet(m, m.thetaE * 0.5, 0)).toBeLessThan(0);
    expect(jacobianDet(m, m.thetaE * 2, 0)).toBeGreaterThan(0);
  });

  it('conserves the source position through the lens equation', () => {
    const m = circular(1e-4, 1e-7);
    const imgs = imagesOnAxis(m, 0.3e-4);
    for (const t of imgs) {
      expect(lensEquation(m, t, 0)[0]).toBeCloseTo(0.3e-4, 12);
    }
  });
});

describe('lensing masses', () => {
  it('weighs a cluster to within a factor of a few of its virial mass', () => {
    // The mass inside the Einstein radius is a fraction of the total, so it
    // should land well below the virial mass but well above a galaxy's.
    const m = einsteinMass(1200, 1000);
    expect(m).toBeGreaterThan(1e13);
    expect(m).toBeLessThan(5e15);
  });

  it('scales with distance to the lens', () => {
    expect(einsteinMass(1200, 2000) / einsteinMass(1200, 1000)).toBeCloseTo(2, 6);
  });
});
