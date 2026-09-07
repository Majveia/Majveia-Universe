import { describe, it, expect } from 'vitest';
import {
  fieldFromSpin, pdotFromField, characteristicAgeYears, spinDownPower, rotationalEnergy,
  lightCylinderCm, polarCapAngle, beamAngle, beamingFraction, isAlive, DEATH_LINE,
  periodAfter, dispersionDelay, dispersionMeasure, surfaceGravity, meanDensity,
  surfaceBeta, breakUpPeriodS, classify, pulsar, population, MEASURED, BRAKING,
} from '../src/astro/pulsar';

const byName = (n: string) => MEASURED.find((m) => m.name.startsWith(n))!;
const crab = byName('Crab');
const vela = byName('Vela');
const first = byName('PSR B1919');
const ms = byName('PSR B1937');

describe('the field nobody has ever measured', () => {
  it('gives the Crab four trillion gauss, which is the catalogue value', () => {
    const b = fieldFromSpin(crab.periodS, crab.pdot);
    expect(b).toBeGreaterThan(3.0e12);
    expect(b).toBeLessThan(4.5e12);
  });

  it('is the standard 3.2e19 root-P-Pdot relation, to three figures', () => {
    // The whole of neutron-star magnetism, as one coefficient.
    const coeff = fieldFromSpin(1, 1);
    expect(coeff / 3.2e19).toBeCloseTo(1, 2);
    expect(1 / Math.sqrt(BRAKING)).toBeCloseTo(coeff, 6);
  });

  it('gives the first pulsar ever found a normal field', () => {
    const b = fieldFromSpin(first.periodS, first.pdot);
    expect(b).toBeGreaterThan(1e12);
    expect(b).toBeLessThan(3e12);
  });

  it('gives a millisecond pulsar a field ten thousand times weaker', () => {
    const normal = fieldFromSpin(first.periodS, first.pdot);
    const recycled = fieldFromSpin(ms.periodS, ms.pdot);
    expect(recycled).toBeGreaterThan(1e8);
    expect(recycled).toBeLessThan(1e9);
    expect(normal / recycled).toBeGreaterThan(3e3);
  });

  it('inverts: a field implies the slowing it causes', () => {
    for (const m of MEASURED) {
      const b = fieldFromSpin(m.periodS, m.pdot);
      // A ratio, not a difference: these span ten orders of magnitude, and
      // toBeCloseTo compares absolutely.
      expect(pdotFromField(m.periodS, b) / m.pdot).toBeCloseTo(1, 6);
    }
  });
});

describe('ages', () => {
  it('overestimates the Crab by about a third, in the direction it should', () => {
    // The supernova was seen in 1054, so the true age is known to the year -
    // and the characteristic age assumes the star was born spinning infinitely
    // fast, which it was not, so it must come out too old.
    const p = pulsar(crab.periodS, fieldFromSpin(crab.periodS, crab.pdot));
    const tau = characteristicAgeYears(p);
    const truth = 2026 - 1054;
    expect(tau).toBeGreaterThan(truth);
    expect(tau / truth).toBeGreaterThan(1.2);
    expect(tau / truth).toBeLessThan(1.5);
  });

  it('makes Vela about eleven thousand years old', () => {
    const p = pulsar(vela.periodS, fieldFromSpin(vela.periodS, vela.pdot));
    expect(characteristicAgeYears(p)).toBeGreaterThan(8e3);
    expect(characteristicAgeYears(p)).toBeLessThan(2e4);
  });

  it('makes a recycled pulsar older than most of the Galaxy', () => {
    const p = pulsar(ms.periodS, fieldFromSpin(ms.periodS, ms.pdot));
    expect(characteristicAgeYears(p)).toBeGreaterThan(1e8);
  });

  it('is infinite for something that is not slowing at all', () => {
    expect(characteristicAgeYears({ ...pulsar(1, 1e12), pdot: 0 })).toBe(Infinity);
  });
});

describe('the energy in a spin', () => {
  it('gives the Crab the 4.5e38 erg per second that lights its nebula', () => {
    const p = pulsar(crab.periodS, fieldFromSpin(crab.periodS, crab.pdot));
    const e = spinDownPower(p);
    expect(e).toBeGreaterThan(3e38);
    expect(e).toBeLessThan(6e38);
    // A hundred thousand suns, from a corpse
    expect(e / 3.828e33).toBeGreaterThan(5e4);
  });

  it('holds more rotational energy than a supernova releases in light', () => {
    // 2e49 erg for the Crab, against about 1e49 radiated by a type II
    expect(rotationalEnergy(crab.periodS)).toBeGreaterThan(1e49);
    expect(rotationalEnergy(1.0)).toBeLessThan(rotationalEnergy(0.01));
  });
});

describe('the magnetosphere', () => {
  it('puts the Crab light cylinder sixteen hundred kilometres out', () => {
    expect(lightCylinderCm(crab.periodS) / 1e5).toBeGreaterThan(1200);
    expect(lightCylinderCm(crab.periodS) / 1e5).toBeLessThan(2000);
  });

  it('puts a millisecond pulsar light cylinder barely off the surface', () => {
    // Seventy kilometres, for a star twenty kilometres across
    const r = lightCylinderCm(ms.periodS) / 1e5;
    expect(r).toBeGreaterThan(40);
    expect(r).toBeLessThan(120);
  });

  it('gives the Crab a polar cap a few degrees across', () => {
    const deg = (polarCapAngle(crab.periodS) * 180) / Math.PI;
    expect(deg).toBeGreaterThan(2);
    expect(deg).toBeLessThan(8);
  });

  it('opens the polar cap wider the faster the star spins', () => {
    expect(polarCapAngle(0.002)).toBeGreaterThan(polarCapAngle(0.03));
    expect(polarCapAngle(0.03)).toBeGreaterThan(polarCapAngle(1.5));
    expect(polarCapAngle(1e6)).toBeGreaterThan(0);
  });

  it('gives a fast pulsar a wider beam than a slow one', () => {
    expect(beamAngle(0.0016)).toBeGreaterThan(beamAngle(1.3));
    // A one-second pulsar has a beam about five degrees wide
    expect((beamAngle(1) * 180) / Math.PI).toBeCloseTo(5.4, 5);
  });

  it('has most pulsars pointing at somebody else', () => {
    const p = pulsar(1.0, 2e12, { obliquity: Math.PI / 3 });
    const f = beamingFraction(p);
    expect(f).toBeGreaterThan(0.05);
    expect(f).toBeLessThan(0.45);
  });
});

describe('the death line', () => {
  it('keeps the young and the recycled alive', () => {
    for (const m of [crab, vela, first, ms]) {
      expect(isAlive(m.periodS, fieldFromSpin(m.periodS, m.pdot))).toBe(true);
    }
  });

  it('kills a slow star with an ordinary field', () => {
    // Eight seconds and a trillion gauss: over the line and dark
    expect(isAlive(8, 1e12)).toBe(false);
  });

  it('is a line in the field against the square of the period', () => {
    const p = 3;
    const onIt = DEATH_LINE * p * p;
    expect(isAlive(p, onIt * 1.01)).toBe(true);
    expect(isAlive(p, onIt * 0.99)).toBe(false);
  });
});

describe('slowing down', () => {
  it('grows the period as the square root of time', () => {
    // P^2 = P0^2 + 2 K B^2 t, so quadrupling the time doubles the period
    const b = 2e12;
    const a = periodAfter(0, b, 1e10);
    const c = periodAfter(0, b, 4e10);
    expect(c / a).toBeCloseTo(2, 6);
  });

  it('reproduces the period a star of a known field reaches', () => {
    // A pulsar born at 20 ms with the Crab's field, a thousand years on
    const b = fieldFromSpin(crab.periodS, crab.pdot);
    const p = periodAfter(0.02, b, 1000 * 3.15576e7);
    expect(p).toBeGreaterThan(0.025);
    expect(p).toBeLessThan(0.05);
  });

  it('never runs backwards, and never leaves the period behind', () => {
    expect(periodAfter(0.5, 1e12, -100)).toBeCloseTo(0.5, 9);
    expect(periodAfter(0.5, 1e12, 0)).toBeCloseTo(0.5, 9);
    expect(periodAfter(0.5, 1e12, 1e17)).toBeGreaterThan(0.5);
  });

  it('drives a normal pulsar over the death line in a few tens of millions of years', () => {
    const b = 2e12;
    let dead = 0;
    for (let logT = 4; logT < 11; logT += 0.25) {
      const t = 10 ** logT * 3.15576e7;
      if (!isAlive(periodAfter(0.02, b, t), b)) { dead = 10 ** logT; break; }
    }
    expect(dead).toBeGreaterThan(1e6);
    expect(dead).toBeLessThan(1e9);
  });
});

describe('dispersion, which is how the distance is known', () => {
  it('spreads a pulse by seconds across a radio band', () => {
    // A pulsar a kiloparsec away, seen between 400 and 800 MHz
    const dm = dispersionMeasure(1000);
    const dt = dispersionDelay(dm, 400, 800);
    expect(dt).toBeGreaterThan(0.5);
    expect(dt).toBeLessThan(2);
  });

  it('goes as the inverse square of the frequency', () => {
    // Halving the frequency quadruples the delay
    const a = dispersionDelay(100, 400, 1e9);
    const b = dispersionDelay(100, 200, 1e9);
    expect(b / a).toBeCloseTo(4, 3);
  });

  it('is proportional to how far the pulse has come', () => {
    expect(dispersionDelay(dispersionMeasure(2000), 400, 800)
      / dispersionDelay(dispersionMeasure(1000), 400, 800)).toBeCloseTo(2, 9);
  });

  it('vanishes when both frequencies are the same', () => {
    expect(dispersionDelay(300, 600, 600)).toBeCloseTo(0, 12);
  });
});

describe('what the object actually is', () => {
  it('is as dense as an atomic nucleus', () => {
    // 2 to 6 times 10^14 g/cc, which is nuclear density
    expect(meanDensity()).toBeGreaterThan(1e14);
    expect(meanDensity()).toBeLessThan(1e15);
  });

  it('has a surface gravity two hundred billion times the one we stand in', () => {
    expect(surfaceGravity() / 981).toBeGreaterThan(1e11);
    expect(surfaceGravity() / 981).toBeLessThan(1e12);
  });

  it('spins its equator at a seventh of light speed, for the fastest known', () => {
    const beta = surfaceBeta(ms.periodS);
    expect(beta).toBeGreaterThan(0.1);
    expect(beta).toBeLessThan(0.3);
    // And a normal pulsar is nowhere near
    expect(surfaceBeta(1.0)).toBeLessThan(0.001);
  });

  it('cannot spin faster than about half a millisecond without flying apart', () => {
    const p = breakUpPeriodS();
    expect(p).toBeGreaterThan(2e-4);
    expect(p).toBeLessThan(1.2e-3);
    // The fastest pulsar known is comfortably slower than the limit
    expect(ms.periodS).toBeGreaterThan(p);
  });
});

describe('the families', () => {
  const made = (m: typeof crab) =>
    pulsar(m.periodS, fieldFromSpin(m.periodS, m.pdot));

  it('calls the Crab young', () => {
    expect(classify(made(crab)).kind).toBe('young');
  });

  it('calls the first one found an ordinary pulsar', () => {
    expect(classify(made(first)).kind).toBe('normal');
  });

  it('recognises a recycled millisecond pulsar', () => {
    expect(classify(made(ms)).kind).toBe('millisecond');
  });

  it('recognises a magnetar by its field alone', () => {
    // Above the quantum critical field, where an electron's Landau energy
    // equals its rest mass: 4.4e13 gauss
    const p = pulsar(5, 1e14);
    expect(classify(p).kind).toBe('magnetar');
  });

  it('knows when the light has gone out', () => {
    expect(classify(pulsar(9, 5e11)).kind).toBe('dead');
  });
});

describe('a population', () => {
  // A fixed sequence, so the assertions below are about the model and not
  // about which numbers happened to come up.
  const lcg = (seed: number) => {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  };
  const pop = population(4000, lcg(20260907));
  const alive = pop.filter((p) => p.alive);

  it('comes out in two clumps with a gulf between them', () => {
    // The observed distribution of periods is bimodal: milliseconds and
    // seconds, and almost nothing between ten and a hundred milliseconds.
    const ms = alive.filter((p) => p.periodS < 0.03).length;
    const normal = alive.filter((p) => p.periodS > 0.1).length;
    const between = alive.filter((p) => p.periodS >= 0.03 && p.periodS <= 0.1).length;
    expect(ms).toBeGreaterThan(20);
    expect(normal).toBeGreaterThan(200);
    expect(between / alive.length).toBeLessThan(0.15);
  });

  it('gives the two clumps fields four orders of magnitude apart', () => {
    const fast = alive.filter((p) => p.periodS < 0.03);
    const slow = alive.filter((p) => p.periodS > 0.3);
    const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const bFast = median(fast.map((p) => p.fieldG));
    const bSlow = median(slow.map((p) => p.fieldG));
    expect(bSlow / bFast).toBeGreaterThan(1e3);
  });

  it('leaves every living pulsar above the death line, by construction', () => {
    for (const p of alive) expect(isAlive(p.periodS, p.fieldG)).toBe(true);
  });

  it('kills the oldest of them, which is where they all eventually go', () => {
    // Sampled over the radio lifetime, so most are alive - a catalogue is by
    // definition of things that are still shining. The tail that has crossed
    // the line is the visible edge of a population a million times larger.
    const dead = pop.length - alive.length;
    expect(dead / pop.length).toBeGreaterThan(0.08);
    expect(dead / pop.length).toBeLessThan(0.8);
    // Sorting the whole population by age picks out the *recycled* ones, which
    // are the oldest things here and are alive precisely because their fields
    // were buried. Among the ones that were never recycled, the oldest are all
    // dark.
    const strong = pop.filter((p) => p.fieldG > 1e11);
    const oldest = strong.slice().sort((a, b) => b.ageYears - a.ageYears).slice(0, 40);
    expect(oldest.filter((p) => !p.alive).length).toBeGreaterThan(30);
  });

  it('puts the recycled ones at ages the normal ones never reach', () => {
    const fast = alive.filter((p) => p.periodS < 0.01);
    expect(fast.length).toBeGreaterThan(5);
    for (const p of fast) expect(characteristicAgeYears(p)).toBeGreaterThan(1e7);
  });

  it('gives every one of them a real number for everything', () => {
    for (const p of pop) {
      for (const v of [p.periodS, p.pdot, p.fieldG, p.obliquity, p.distancePc]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThan(0);
      }
      // A dead pulsar can be very slow indeed: the longest-period radio pulsar
      // known turns once every seventy-six seconds, and there is no reason for
      // an object that stopped beaming to stop slowing.
      expect(p.periodS).toBeLessThan(2000);
    }
  });

  it('is the same population from the same seed', () => {
    const a = population(50, lcg(7));
    const b = population(50, lcg(7));
    expect(a.map((p) => p.periodS)).toEqual(b.map((p) => p.periodS));
  });
});
