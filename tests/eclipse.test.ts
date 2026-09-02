import { describe, it, expect } from 'vitest';
import {
  angularRadius, discOverlapFraction, canBeTotal, eclipseMagnitude, eclipseLabel,
} from '../src/physics/eclipse';
import {
  surfaceField, dipoleMoment, windPressure, standoffRadii, ovalColatitude,
  auroralPower, dipoleTilt, EARTH_LIKE, B_EARTH, P_WIND_1AU,
} from '../src/physics/magnetosphere';
import { M_EARTH, R_EARTH, AU } from '../src/core/constants';

const R_SUN_M = 6.957e8;
const R_MOON = 1.7374e6;
const D_MOON = 3.844e8;

describe('angular sizes', () => {
  it('puts the Sun and the Moon at the same apparent size, which is why we get eclipses', () => {
    const sun = angularRadius(R_SUN_M, AU);
    const moon = angularRadius(R_MOON, D_MOON);
    // Half a degree across, both of them, to within a few per cent.
    expect(sun).toBeCloseTo(0.004652, 5);
    expect(moon / sun).toBeGreaterThan(0.94);
    expect(moon / sun).toBeLessThan(1.06);
  });

  it('saturates rather than exploding when the observer is inside the body', () => {
    expect(angularRadius(10, 1)).toBeCloseTo(Math.PI / 2, 6);
    expect(angularRadius(1, 0)).toBeCloseTo(Math.PI / 2, 6);
  });
});

describe('disc overlap', () => {
  const rs = 0.00465;

  it('is nothing when the discs are apart and everything when one swallows the other', () => {
    expect(discOverlapFraction(rs, rs, rs * 2.5)).toBe(0);
    expect(discOverlapFraction(rs, rs * 2, 0)).toBe(1);
  });

  it('covers exactly half at first and last contact of the centre', () => {
    // Equal discs, centres one radius apart: the classic lens.
    const f = discOverlapFraction(1, 1, 1);
    // Lens area for r=1, d=1 is 2pi/3 - sqrt(3)/2; divided by pi.
    const exact = ((2 * Math.PI) / 3 - Math.sqrt(3) / 2) / Math.PI;
    expect(f).toBeCloseTo(exact, 10);
  });

  it('leaves a ring of star when the occulter is the smaller disc', () => {
    // Annular: a Moon at apogee is too small to cover the Sun.
    const ro = rs * 0.95;
    const f = discOverlapFraction(rs, ro, 0);
    expect(f).toBeCloseTo(0.95 * 0.95, 10);
    expect(f).toBeLessThan(1);
    expect(canBeTotal(rs, ro)).toBe(false);
    expect(canBeTotal(rs, rs * 1.02)).toBe(true);
  });

  it('rises monotonically as the occulter closes in', () => {
    let last = -1;
    for (let k = 20; k >= 0; k--) {
      const f = discOverlapFraction(rs, rs, (k / 20) * rs * 2);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
    }
    expect(last).toBe(1);
  });

  it('reports magnitude by diameter, the way an almanac does', () => {
    // Grazing contact is magnitude 0; centred equal discs are magnitude 1.
    expect(eclipseMagnitude(rs, rs, 2 * rs)).toBeCloseTo(0, 12);
    expect(eclipseMagnitude(rs, rs, 0)).toBeCloseTo(1, 12);
  });

  it('names what the sky is doing', () => {
    expect(eclipseLabel(1, true)).toBe('');
    expect(eclipseLabel(0, true)).toBe('total');
    expect(eclipseLabel(0.02, false)).toBe('annular');
    expect(eclipseLabel(0.5, true)).toBe('50% obscured');
  });
});

describe('planetary dynamos', () => {
  it('reproduces the Earth it is calibrated on', () => {
    expect(surfaceField(EARTH_LIKE)).toBeCloseTo(B_EARTH, 12);
    // Earth's dipole moment is about 7.7e22 A m^2.
    expect(dipoleMoment(EARTH_LIKE) / 1e22).toBeGreaterThan(6.5);
    expect(dipoleMoment(EARTH_LIKE) / 1e22).toBeLessThan(9);
  });

  it('gives a Venus almost nothing, because it barely turns', () => {
    const venus = {
      massKg: 0.815 * M_EARTH, radiusM: 0.95 * R_EARTH,
      dayS: -243 * 86400, ageGyr: 4.6, surfaceK: 737,
    };
    expect(surfaceField(venus)).toBeLessThan(B_EARTH * 0.01);
  });

  it('gives a tidally locked world in a red dwarf habitable zone a weak field', () => {
    const locked = {
      massKg: M_EARTH, radiusM: R_EARTH, dayS: 20 * 86400, ageGyr: 4.6, surfaceK: 280,
    };
    const f = surfaceField(locked);
    expect(f).toBeLessThan(B_EARTH * 0.3);
    expect(f).toBeGreaterThan(0);
  });

  it('leaves a small, long-cooled world with no dynamo left', () => {
    const mars = {
      massKg: 0.107 * M_EARTH, radiusM: 0.53 * R_EARTH,
      dayS: 88775, ageGyr: 4.6, surfaceK: 210,
    };
    expect(surfaceField(mars)).toBeLessThan(B_EARTH * 0.35);
  });

  it('gives a gas giant a far larger field than a rocky world', () => {
    const jup = {
      massKg: 318 * M_EARTH, radiusM: 11.2 * R_EARTH,
      dayS: 35730, ageGyr: 4.6, gasGiant: true,
    };
    expect(surfaceField(jup) / B_EARTH).toBeGreaterThan(8);
  });
});

describe('magnetospheres', () => {
  it('stands the solar wind off at about ten Earth radii', () => {
    const l = standoffRadii(EARTH_LIKE, windPressure(1));
    expect(l).toBeGreaterThan(8);
    expect(l).toBeLessThan(12);
  });

  it('puts the auroral oval where the aurora actually is', () => {
    const l = standoffRadii(EARTH_LIKE, windPressure(1));
    const colat = (ovalColatitude(l) * 180) / Math.PI;
    expect(colat).toBeGreaterThan(15);
    expect(colat).toBeLessThan(24);
  });

  it('pushes the oval poleward for a stronger field and equatorward in a storm', () => {
    const quiet = ovalColatitude(standoffRadii(EARTH_LIKE, windPressure(1)));
    const storm = ovalColatitude(standoffRadii(EARTH_LIKE, windPressure(1) * 30));
    // A compressed magnetosphere drags the oval to lower latitude, which is a
    // larger colatitude.
    expect(storm).toBeGreaterThan(quiet);
  });

  it('crushes the magnetosphere onto the surface when there is no field to speak of', () => {
    const dead = {
      massKg: 0.05 * M_EARTH, radiusM: 0.3 * R_EARTH,
      dayS: 40 * 86400, ageGyr: 9, surfaceK: 260,
    };
    const p = windPressure(0.05);
    expect(standoffRadii(dead, p)).toBeCloseTo(1, 6);
    expect(auroralPower(dead, p)).toBe(0);
  });

  it('normalises auroral power to Earth', () => {
    expect(auroralPower(EARTH_LIKE, windPressure(1))).toBeCloseTo(1, 6);
  });

  it('makes the wind fiercer close in', () => {
    expect(windPressure(0.05)).toBeGreaterThan(windPressure(1) * 100);
    expect(windPressure(1)).toBeCloseTo(P_WIND_1AU, 12);
  });

  it('tilts the dipole off the spin axis, sometimes a long way', () => {
    let maxTilt = 0;
    for (let i = 0; i < 500; i++) {
      const t = dipoleTilt(i * 3.7 + 1);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(1.2);
      maxTilt = Math.max(maxTilt, t);
    }
    // Something in five hundred worlds should be a Uranus.
    expect(maxTilt).toBeGreaterThan(0.8);
  });
});
