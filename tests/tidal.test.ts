import { describe, it, expect } from 'vitest';
import {
  ETA, horizonRadius, tidalRadius, hillsMassKg, ejectaSpeed,
  fallbackTime, fallbackRate, eddingtonLuminosity, flareLuminosity,
  flareTemperature, emittingRadius, disruption, debrisOrbit,
  RATE_PER_GALAXY_PER_YEAR,
} from '../src/astro/tidal';
import { M_SUN, R_SUN, AU, DAY, YEAR, C } from '../src/core/constants';

const sun = { m: M_SUN, r: R_SUN };
/** Sagittarius A*, which is the one we live nearest to. */
const SGR_A = 4.3e6 * M_SUN;

describe('where a star comes apart', () => {
  it('puts the tidal radius inside Venus for a million-solar-mass hole', () => {
    const rt = tidalRadius(1e6 * M_SUN, sun.m, sun.r) / AU;
    expect(rt).toBeGreaterThan(0.4);
    expect(rt).toBeLessThan(1.0);
  });

  it('grows only as the cube root of the hole, which is the whole story', () => {
    const a = tidalRadius(1e6 * M_SUN, sun.m, sun.r);
    const b = tidalRadius(1e9 * M_SUN, sun.m, sun.r);
    expect(b / a).toBeCloseTo(10, 6);
  });

  it('reaches further for a puffed-up star than a dense one', () => {
    // A red giant is torn apart a long way out; a white dwarf has to get
    // close enough that only a small hole could manage it at all.
    const giant = tidalRadius(1e6 * M_SUN, M_SUN, 100 * R_SUN);
    const dwarf = tidalRadius(1e6 * M_SUN, 0.6 * M_SUN, 0.014 * R_SUN);
    expect(giant / dwarf).toBeGreaterThan(1000);
  });
});

describe('the heaviest hole that can do it', () => {
  it('is about a hundred million solar masses for a Sun-like star', () => {
    const m = hillsMassKg(sun.m, sun.r) / M_SUN;
    expect(m).toBeGreaterThan(5e7);
    expect(m).toBeLessThan(3e8);
  });

  it('lets Sagittarius A* tear a star apart', () => {
    expect(disruption(4.3e6, 1, 1).visible).toBe(true);
  });

  it('does not let M87 do it: the star goes in whole and nothing is seen', () => {
    // Six and a half billion solar masses. The tidal radius is inside the
    // horizon, so the star crosses it intact and there is no flare at all.
    expect(disruption(6.5e9, 1, 1).visible).toBe(false);
    expect(tidalRadius(6.5e9 * M_SUN, sun.m, sun.r))
      .toBeLessThan(horizonRadius(6.5e9 * M_SUN));
  });

  it('is exactly where the tidal radius meets the horizon', () => {
    const m = hillsMassKg(sun.m, sun.r);
    expect(tidalRadius(m, sun.m, sun.r) / horizonRadius(m)).toBeCloseTo(1, 6);
  });

  it('is higher for a giant, which even a big hole can still tear up', () => {
    expect(hillsMassKg(M_SUN, 50 * R_SUN)).toBeGreaterThan(hillsMassKg(M_SUN, R_SUN));
  });
});

describe('half the star leaves', () => {
  it('throws the unbound half out at thousands of kilometres a second', () => {
    const v = ejectaSpeed(1e6 * M_SUN, sun.m, sun.r) / 1e3;
    expect(v).toBeGreaterThan(3000);
    expect(v).toBeLessThan(15000);
    // Which is far above any galaxy's escape speed: it is gone for good.
    expect(v).toBeGreaterThan(600);
  });

  it('spreads energy about zero, so exactly half is bound', () => {
    const d = disruption(1e6, 1, 1);
    let bound = 0, unbound = 0;
    for (let i = -50; i <= 50; i++) {
      if (i === 0) continue;
      const o = debrisOrbit(d, i / 50);
      if (Number.isFinite(o.boundS)) bound++; else unbound++;
    }
    expect(bound).toBe(unbound);
  });

  it('gives the most bound piece the shortest orbit', () => {
    const d = disruption(1e6, 1, 1);
    const deep = debrisOrbit(d, -1);
    const shallow = debrisOrbit(d, -0.2);
    expect(deep.boundS).toBeLessThan(shallow.boundS);
    expect(deep.a).toBeGreaterThan(0);
    expect(deep.a).toBeLessThan(shallow.a);
  });

  it('leaves the unbound half on hyperbolic orbits', () => {
    const d = disruption(1e6, 1, 1);
    for (const f of [0.2, 0.6, 1]) {
      const o = debrisOrbit(d, f);
      expect(o.a).toBeLessThan(0);
      expect(o.e).toBeGreaterThan(1);
      expect(o.boundS).toBe(Infinity);
    }
  });

  it('puts every piece on an orbit that grazes the pericentre it left from', () => {
    const d = disruption(1e6, 1, 1, 1.4);
    for (const f of [-1, -0.5, 0.5, 1]) {
      const o = debrisOrbit(d, f);
      // r_p = a(1 - e) for an ellipse, |a|(e - 1) for a hyperbola
      const rp = o.a > 0 ? o.a * (1 - o.e) : Math.abs(o.a) * (o.e - 1);
      const want = tidalRadius(d.holeKg, d.starKg, d.starR) / 1.4;
      expect(rp / want).toBeCloseTo(1, 3);
    }
  });
});

describe('when it comes back', () => {
  it('takes about forty days, for a Sun and a million solar masses', () => {
    // The canonical number, and the reason these are found by surveys that
    // revisit the same sky every few nights.
    const t = fallbackTime(1e6 * M_SUN, sun.m, sun.r) / DAY;
    expect(t).toBeGreaterThan(35);
    expect(t).toBeLessThan(48);
  });

  it('takes longer around a heavier hole, as the square root', () => {
    const a = fallbackTime(1e6 * M_SUN, sun.m, sun.r);
    const b = fallbackTime(1e8 * M_SUN, sun.m, sun.r);
    expect(b / a).toBeCloseTo(10, 3);
  });

  it('agrees with the first debris orbit, which is the same statement twice', () => {
    const d = disruption(1e6, 1, 1);
    const first = debrisOrbit(d, -1).boundS;
    expect(first / fallbackTime(d.holeKg, d.starKg, d.starR)).toBeCloseTo(1, 6);
  });

  it('returns nothing at all before the first piece is due', () => {
    const d = disruption(1e6, 1, 1);
    const tm = fallbackTime(d.holeKg, d.starKg, d.starR);
    expect(fallbackRate(d, tm * 0.5)).toBe(0);
    expect(fallbackRate(d, tm * 1.01)).toBeGreaterThan(0);
  });
});

describe('the light curve', () => {
  const d = disruption(1e6, 1, 1);
  const tm = fallbackTime(d.holeKg, d.starKg, d.starR);

  it('falls as the minus five thirds power, which is the signature', () => {
    const a = fallbackRate(d, tm * 10);
    const b = fallbackRate(d, tm * 100);
    expect(Math.log(a / b) / Math.log(10)).toBeCloseTo(5 / 3, 6);
  });

  it('returns exactly half the star, if you wait long enough', () => {
    // Integrated numerically over the first ten thousand fallback times.
    let m = 0;
    const n = 400000;
    const hi = tm * 1e4;
    const dt = (hi - tm) / n;
    for (let i = 0; i < n; i++) m += fallbackRate(d, tm + (i + 0.5) * dt) * dt;
    expect(m / d.starKg).toBeGreaterThan(0.48);
    expect(m / d.starKg).toBeLessThanOrEqual(0.5);
  });

  it('peaks far above the Eddington limit, which is the open question', () => {
    const raw = ETA * fallbackRate(d, tm * 1.001) * C * C;
    expect(raw / eddingtonLuminosity(d.holeKg)).toBeGreaterThan(20);
  });

  it('briefly rivals the starlight of the whole galaxy it happens in', () => {
    // A galaxy like ours is about 2e10 solar luminosities, near 1e37 W, and a
    // flare peaks at a few times 1e44 erg/s. So it does not outshine the
    // largest galaxies - but it outshines everything else in its own nucleus
    // by orders of magnitude, which is how one is found in the first place.
    const peak = flareLuminosity(d, tm * 1.2);
    expect(peak).toBeGreaterThan(8e36);
    expect(peak).toBeLessThan(3e38);
    // In the units the literature uses: a few times 1e44 erg per second.
    expect(peak * 1e7).toBeGreaterThan(1e44);
    expect(peak * 1e7).toBeLessThan(1e45);
  });

  it('fades, monotonically, once it has peaked', () => {
    let prev = Infinity;
    for (const f of [1.2, 2, 5, 20, 100, 1000]) {
      const l = flareLuminosity(d, tm * f);
      expect(l).toBeLessThan(prev);
      prev = l;
    }
  });

  it('is still detectable years later, which is how they are confirmed', () => {
    expect(flareLuminosity(d, 3 * YEAR)).toBeGreaterThan(1e33);
  });

  it('radiates in the ultraviolet, at a few tens of thousands of kelvin', () => {
    const t = flareTemperature(d, tm * 1.4);
    expect(t).toBeGreaterThan(1.5e4);
    expect(t).toBeLessThan(6e4);
  });

  it('comes out at nearly the same temperature whatever the hole weighs', () => {
    // One of the odder observed facts: flares from holes two decades apart in
    // mass all sit around thirty thousand kelvin. Whatever is radiating is not
    // the disc, whose temperature would vary enormously.
    const ts = [1e5, 1e6, 1e7].map((m) => {
      const e = disruption(m, 1, 1);
      const t0 = fallbackTime(e.holeKg, e.starKg, e.starR);
      return flareTemperature(e, t0 * 1.4);
    });
    expect(Math.max(...ts) / Math.min(...ts)).toBeLessThan(1.6);
    for (const t of ts) {
      expect(t).toBeGreaterThan(1.5e4);
      expect(t).toBeLessThan(6e4);
    }
  });

  it('shines from ten thousand gravitational radii, not from the disc', () => {
    // The size that a blackbody fit gives, which nothing predicts.
    expect(emittingRadius(1e6 * M_SUN) / horizonRadius(1e6 * M_SUN)).toBeGreaterThan(1e3);
  });

  it('says nothing is shining before anything has come back', () => {
    expect(flareLuminosity(d, tm * 0.5)).toBe(0);
    expect(flareTemperature(d, tm * 0.5)).toBe(0);
  });
});

describe('how often', () => {
  it('happens to a galaxy about once every thirty thousand years', () => {
    expect(1 / RATE_PER_GALAXY_PER_YEAR).toBeGreaterThan(1e4);
    expect(1 / RATE_PER_GALAXY_PER_YEAR).toBeLessThan(1e5);
  });

  it('turns up a few times a year in a survey of a hundred thousand galaxies', () => {
    expect(RATE_PER_GALAXY_PER_YEAR * 1e5).toBeGreaterThan(1);
    expect(RATE_PER_GALAXY_PER_YEAR * 1e5).toBeLessThan(20);
  });
});

describe('the numbers hold together at other masses', () => {
  it('works for the hole we live nearest to', () => {
    const d = disruption(SGR_A / M_SUN, 1, 1);
    expect(d.visible).toBe(true);
    expect(fallbackTime(d.holeKg, d.starKg, d.starR) / DAY).toBeGreaterThan(50);
    expect(fallbackTime(d.holeKg, d.starKg, d.starR) / DAY).toBeLessThan(120);
  });

  it('never returns a number that is not a number', () => {
    for (const [mh, ms, rs] of [
      [1e5, 0.3, 0.3], [1e6, 1, 1], [1e7, 8, 4], [5e7, 1, 100], [1e9, 1, 1],
    ]) {
      const d = disruption(mh, ms, rs);
      const tm = fallbackTime(d.holeKg, d.starKg, d.starR);
      for (const v of [tm, fallbackRate(d, tm * 2), flareLuminosity(d, tm * 2),
        flareTemperature(d, tm * 2), ejectaSpeed(d.holeKg, d.starKg, d.starR)]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
