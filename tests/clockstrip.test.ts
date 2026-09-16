import { describe, expect, it } from 'vitest';
import {
  HI, LANDMARKS, LO, positionOf, positionOfTime,
} from '../src/ui/scalestrip';
import { DURATIONS, lightTime, ownTime } from '../src/physics/clock';
import { formatTime } from '../src/ui/hud';
import { C, YEAR } from '../src/core/constants';

describe('the same ruler, read in seconds', () => {
  it('does not move a single notch', () => {
    // The whole point. Turning the axis from metres into seconds divides every
    // number on it by one constant, which on a logarithmic ruler is a shift -
    // and because the ruler itself is defined by that same division, it is not
    // even that. Every landmark stays exactly where it was.
    for (const l of LANDMARKS) {
      expect(positionOfTime(l.m / C), l.label).toBeCloseTo(positionOf(l.m), 12);
    }
  });

  it('is the length ruler and not a copy of it', () => {
    for (const e of [-24, -18, -9, 0, 6, 12, 18]) {
      expect(positionOfTime(10 ** e)).toBeCloseTo(positionOf(10 ** e * C), 12);
    }
    expect(positionOfTime(LO / C)).toBeCloseTo(0, 12);
    expect(positionOfTime(HI / C)).toBeCloseTo(1, 12);
  });

  it('lands a light year on a year, which is what a light year is', () => {
    const ly = LANDMARKS.find((l) => l.label === 'a light year')!;
    expect(ly.crossing).toBe('a year');
    expect(ly.m / C / YEAR).toBeCloseTo(1, 3);
    // And the notch for the duration falls in the same place, to a hair.
    const year = DURATIONS.find((d) => d.label === 'a year')!;
    expect(positionOfTime(year.s)).toBeCloseTo(positionOf(ly.m), 4);
  });

  it('lands green light on its own period', () => {
    const g = LANDMARKS.find((l) => l.label === 'green light')!;
    expect(g.crossing).toBe('one wave');
    // 550 nm crest to crest is 1.83 femtoseconds from crest to crest.
    expect((g.m / C) * 1e15).toBeCloseTo(1.83, 2);
  });

  it('turns an AU into the age of sunlight', () => {
    const au = LANDMARKS.find((l) => l.label === 'an AU')!;
    expect(formatTime(au.m / C)).toEqual(['8.32', 'min']);
  });

  it('turns the Earth into forty-two milliseconds and the Sun into four seconds', () => {
    const at = (s: string) => LANDMARKS.find((l) => l.label === s)!.m / C;
    expect(formatTime(at('Earth'))).toEqual(['42.5', 'ms']);
    expect(formatTime(at('the Sun'))).toEqual(['4.64', 's']);
    expect(formatTime(at('a person'))).toEqual(['5.67', 'ns']);
    expect(formatTime(at('proton'))).toEqual(['5.60', 'ys']);
  });

  it('puts the observable universe further away than its own age, which is the point', () => {
    // Light has had 13.8 Gyr and the thing is 93 Gyr across, because the space
    // in between grew while the light was in it.
    const horizon = LANDMARKS.find((l) => l.label === 'the observable universe')!.m / C;
    const age = DURATIONS.find((d) => d.label === 'the universe')!.s;
    expect(horizon / age).toBeGreaterThan(5);
    expect(horizon / YEAR / 1e9).toBeCloseTo(93, -1);
    // And it sits to the right of the age on the axis, visibly.
    expect(positionOfTime(horizon)).toBeGreaterThan(positionOfTime(age) + 0.01);
  });

  it('gives every duration a place on the ruler that is not an end', () => {
    for (const d of DURATIONS) {
      expect(positionOfTime(d.s), d.label).toBeGreaterThan(0.005);
      expect(positionOfTime(d.s), d.label).toBeLessThan(0.9995);
    }
  });
});

describe('the bar between the two clocks', () => {
  it('is as long as the gap and no longer', () => {
    // Its length in fractions of the axis must be log10(c/v) decades, because
    // that is the only thing it is trying to say.
    const decades = Math.log10(HI / LO);
    for (const [size, speed] of [[6.371e6, 7905], [1e-10, 4800], [5.3e-11, 2.19e6]]) {
      const k = { size, speed, what: 'x' };
      const bar = positionOfTime(ownTime(k)) - positionOfTime(lightTime(k));
      expect(bar * decades).toBeCloseTo(Math.log10(C / speed), 6);
    }
  });

  it('closes to nothing when whatever moves there moves at c', () => {
    const k = { size: 1.3e26, speed: C, what: 'expansion' };
    expect(positionOfTime(ownTime(k))).toBeCloseTo(positionOfTime(lightTime(k)), 12);
  });

  it('starts where the object would sit on the length ruler', () => {
    // The open end of the bar is the object's own light-crossing time, so it
    // has to land on the object's own size read as a length. Anything else
    // would mean the two readings disagreed about where the thing is.
    const k = { size: 6.371e6, speed: 7905, what: 'a low orbit' };
    expect(positionOfTime(lightTime(k))).toBeCloseTo(positionOf(k.size), 12);
  });
});
