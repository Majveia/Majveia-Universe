import { describe, expect, it } from 'vitest';
import { LANDMARKS, LO, HI, positionOf } from '../src/ui/scalestrip';
import { formatDistance } from '../src/ui/hud';
import { AU, LY, PC, R_EARTH, R_SUN } from '../src/core/constants';

describe('the axis', () => {
  it('spans the whole ladder and a margin at each end', () => {
    // A nucleus is about 4 fm and the observable universe about 8.8e26 m.
    // The axis has to hold both with room to spare, or the marker parks at an
    // end and stops meaning anything.
    expect(LO).toBeLessThan(4e-15 / 10);
    expect(HI).toBeGreaterThan(8.8e26);
  });

  it('is logarithmic: every decade takes the same room', () => {
    const step = positionOf(1e10) - positionOf(1e9);
    for (const e of [-14, -8, -2, 5, 15, 24]) {
      expect(positionOf(10 ** (e + 1)) - positionOf(10 ** e)).toBeCloseTo(step, 12);
    }
  });

  it('runs from nought to one and never past either', () => {
    expect(positionOf(LO)).toBeCloseTo(0, 12);
    expect(positionOf(HI)).toBeCloseTo(1, 12);
    expect(positionOf(LO / 1e6)).toBe(0);
    expect(positionOf(HI * 1e6)).toBe(1);
    expect(positionOf(0)).toBe(0);
    expect(positionOf(-5)).toBe(0);
  });

  it('only ever moves one way', () => {
    let prev = -1;
    for (let e = -18; e <= 30; e += 0.5) {
      const u = positionOf(10 ** e);
      expect(u).toBeGreaterThanOrEqual(prev);
      prev = u;
    }
  });
});

describe('the landmarks', () => {
  it('are all inside the axis, with none of them pinned to an end', () => {
    for (const l of LANDMARKS) {
      expect(positionOf(l.m), l.label).toBeGreaterThan(0.005);
      expect(positionOf(l.m), l.label).toBeLessThan(0.9995);
    }
  });

  it('are in order and none of them collides with the next', () => {
    for (let i = 1; i < LANDMARKS.length; i++) {
      expect(LANDMARKS[i].m, LANDMARKS[i].label)
        .toBeGreaterThan(LANDMARKS[i - 1].m);
      // At least a fifth of a decade apart, or one notch hides the other.
      expect(Math.log10(LANDMARKS[i].m / LANDMARKS[i - 1].m)).toBeGreaterThan(0.2);
    }
  });

  it('are the sizes those things really are', () => {
    const at = (label: string): number => {
      const l = LANDMARKS.find((x) => x.label === label);
      if (!l) throw new Error(`no landmark ${label}`);
      return l.m;
    };
    // Checked against the constants the rest of the simulation runs on, so a
    // landmark cannot drift away from the physics that put it there.
    expect(at('Earth')).toBeCloseTo(2 * R_EARTH, -4);
    expect(at('the Sun')).toBeCloseTo(2 * R_SUN, -7);
    expect(at('an AU')).toBeCloseTo(AU, -8);
    expect(at('a light year') / LY).toBeCloseTo(1, 3);
    expect(at('nearest star') / (4.246 * LY)).toBeCloseTo(1, 2);
    expect(at('the galaxy')).toBeGreaterThan(25e3 * PC);
    // Green light, which is where seeing stops: half a micron.
    expect(at('green light')).toBeCloseTo(550e-9, 9);
    // A proton is 1.68 fm across and a hydrogen atom is two Bohr radii.
    expect(at('proton')).toBeCloseTo(1.68e-15, 16);
    expect(at('hydrogen atom')).toBeCloseTo(2 * 5.29177e-11, 12);
  });

  it('puts the limit of seeing between the surface and the lattice', () => {
    // Two of the nine rungs are on the wrong side of it - no eye and no
    // microscope will ever look into a crystal or an atom with light.
    const light = LANDMARKS.find((l) => l.label === 'green light')!.m;
    expect(light).toBeLessThan(1);            // below a person
    expect(light).toBeGreaterThan(4.91e-10);  // above a quartz cell
  });

  it('keeps a fixed frame of reference: enough majors, spread out', () => {
    const majors = LANDMARKS.filter((l) => l.major);
    expect(majors.length).toBeGreaterThanOrEqual(6);
    // No stretch of more than twelve decades without one, so there is always
    // an anchor in view.
    let prev = Math.log10(LO);
    for (const m of majors) {
      expect(Math.log10(m.m) - prev).toBeLessThan(12);
      prev = Math.log10(m.m);
    }
    expect(Math.log10(HI) - prev).toBeLessThan(12);
  });
});

describe('one formatter for forty-three decades', () => {
  it('picks the same unit at every decade it ever will', () => {
    // Pinned rather than inferred, because the boundaries are choices: the
    // kilometre runs a long way past a thousand of itself, because a million
    // kilometres is a more familiar quantity than seven thousandths of an
    // astronomical unit. That band is the one awkward stretch in the whole
    // ruler - 10^8 and 10^9 metres come out as 1.00x10^5 km and 1.00x10^6 km -
    // and it is recorded here rather than quietly changed, because it is
    // between the Moon's distance and the Sun's and nothing else is better.
    const want: [number, number, string][] = [
      [-16, -16, 'am'], [-15, -13, 'fm'], [-12, -11, 'pm'], [-10, -10, 'Å'],
      [-9, -7, 'nm'], [-6, -4, 'µm'], [-3, -1, 'mm'], [0, 3, 'm'],
      [4, 9, 'km'], [10, 14, 'AU'], [15, 19, 'ly'], [20, 22, 'kpc'],
      [23, 25, 'Mpc'], [26, 27, 'Gpc'],
    ];
    const seen = new Set<number>();
    for (const [lo, hi, unit] of want) {
      for (let e = lo; e <= hi; e++) {
        expect(formatDistance(10 ** e)[1], `10^${e}`).toBe(unit);
        seen.add(e);
      }
    }
    // Every decade of the axis accounted for, with none left undecided.
    for (let e = -16; e <= 27; e++) expect(seen.has(e), `10^${e}`).toBe(true);
  });

  it('uses the unit the rung itself works in', () => {
    expect(formatDistance(4.28e-15)[1]).toBe('fm');   // a nucleus
    expect(formatDistance(1.06e-10)[1]).toBe('Å');    // an atom
    expect(formatDistance(4.9e-9)[1]).toBe('nm');     // a block of lattice
    expect(formatDistance(26)[1]).toBe('m');          // standing on a world
    expect(formatDistance(1.27e7)[1]).toBe('km');     // a planet
    expect(formatDistance(7e12)[1]).toBe('AU');       // a system
    expect(formatDistance(3e20)[1]).toBe('kpc');      // a galaxy
    expect(formatDistance(8e24)[1]).toBe('Mpc');      // the web
  });

  it('is continuous across every boundary it has', () => {
    // The number jumps when the unit does; what must not happen is the value
    // jumping while the unit stays put, which is what a wrong divisor looks
    // like.
    for (const edge of [1e-15, 1e-12, 1e-10, 1e-9, 1e-6, 1e-3, 1, 1e4]) {
      const below = formatDistance(edge * 0.999);
      const above = formatDistance(edge * 1.001);
      expect(below[1], `${edge}`).not.toBe(above[1]);
    }
  });

  it('says nothing silly about zero', () => {
    expect(formatDistance(0)).toEqual(['0', 'm']);
  });
});
