import { describe, expect, it } from 'vitest';
import * as E from '../src/astro/ephemeris';
import { AU, GM_SUN, R_SUN } from '../src/core/constants';
import { solarSystem } from '../src/astro/solsystem';
import { stateAt } from '../src/physics/kepler';
import { altAz } from '../src/astro/sky';

const DEG = Math.PI / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

describe('vector arithmetic', () => {
  it('normalises, and does not divide by zero', () => {
    expect(E.length(E.normalize([3, 4, 0]))).toBeCloseTo(1, 12);
    expect(E.length(E.normalize([0, 0, 0]))).toBeCloseTo(1, 12);
  });

  it('measures angles accurately near zero and pi, where acos cannot', () => {
    // A thousandth of an arcsecond apart. acos of the dot product loses every
    // significant figure here; atan2 of the cross keeps them all.
    const tiny = 1e-9;
    expect(E.angleBetween([1, 0, 0], [1, tiny, 0])).toBeCloseTo(tiny, 15);
    expect(E.angleBetween([1, 0, 0], [-1, tiny, 0])).toBeCloseTo(Math.PI - tiny, 12);
    expect(E.angleBetween([1, 0, 0], [0, 1, 0])).toBeCloseTo(Math.PI / 2, 12);
  });
});

describe('rotation axes', () => {
  const circular = (aM: number): E.Vec3[] => {
    const el = { a: aM, e: 0, i: 0, Omega: 0, omega: 0, M0: 0, epoch: 0 };
    const s = stateAt(el, GM_SUN, 0);
    return [E.orbitNormal(s), [s.x, s.y, s.z]];
  };

  it('takes the orbit normal from the angular momentum', () => {
    const [n] = circular(AU);
    // A prograde orbit in the reference plane has its normal on +z.
    expect(n[2]).toBeCloseTo(1, 10);
  });

  it('tips the spin axis by exactly the obliquity', () => {
    const el = { a: AU, e: 0, i: 0, Omega: 0, omega: 0, M0: 0, epoch: 0 };
    const s = stateAt(el, GM_SUN, 0);
    const n = E.orbitNormal(s);
    for (const eps of [0, 10 * DEG, 23.44 * DEG, 97 * DEG, Math.PI]) {
      const p = E.spinAxis(s, eps);
      expect(E.angleBetween(n, p)).toBeCloseTo(eps, 10);
      expect(E.length(p)).toBeCloseTo(1, 12);
    }
  });

  it('holds the axis fixed in space as the world goes round', () => {
    // The mechanism behind seasons: the axis does not lean toward the star and
    // away again over the year, it never moves at all.
    const el = { a: AU, e: 0.0167, i: 0, Omega: 0, omega: 1.2, M0: 0, epoch: 0 };
    const year = 3.156e7;
    const first = E.spinAxis(stateAt(el, GM_SUN, 0), 23.44 * DEG);
    for (const f of [0.25, 0.5, 0.75]) {
      const later = E.spinAxis(stateAt(el, GM_SUN, year * f), 23.44 * DEG);
      expect(E.angleBetween(first, later)).toBeLessThan(1e-6);
    }
  });

  it('gives an obliquity that makes the star swing north and south by it', () => {
    const el = { a: AU, e: 0, i: 0, Omega: 0, omega: 0, M0: 0, epoch: 0 };
    const year = 2 * Math.PI * Math.sqrt(AU ** 3 / GM_SUN);
    const eps = 23.44 * DEG;
    const axis = E.spinAxis(stateAt(el, GM_SUN, 0), eps);
    let lo = 9, hi = -9;
    for (let k = 0; k < 400; k++) {
      const r = E.positionOf(el, GM_SUN, (k / 400) * year);
      const dec = Math.asin(E.dot(E.normalize(E.scale(r, -1)), axis));
      lo = Math.min(lo, dec); hi = Math.max(hi, dec);
    }
    expect(hi).toBeCloseTo(eps, 3);
    expect(lo).toBeCloseTo(-eps, 3);
  });
});

describe('the horizon frame', () => {
  it('round-trips a direction through altitude and azimuth', () => {
    for (const [alt, az] of [[0, 0], [0.4, 1.9], [-0.8, -2.6], [1.2, 3.0]]) {
      const r = E.altAzOf(E.dirFromAltAz(alt, az));
      expect(r.altitude).toBeCloseTo(alt, 12);
      expect(Math.cos(r.azimuth - az)).toBeCloseTo(1, 12);
    }
  });

  it('puts north at -z and up at +y, the way the scene does', () => {
    expect(E.dirFromAltAz(0, 0)[2]).toBeCloseTo(-1, 12);
    expect(E.dirFromAltAz(Math.PI / 2, 0)[1]).toBeCloseTo(1, 12);
    // Azimuth ninety degrees is east, and east is +x.
    expect(E.dirFromAltAz(0, Math.PI / 2)[0]).toBeCloseTo(1, 12);
  });

  it('carries the two anchor directions exactly onto their targets', () => {
    // The whole point: the star has to land where the sundial already says it
    // is, or the ephemeris and the ground disagree about what time it is.
    //
    // Both land exactly only because the pairs are consistent - the angle
    // between the axis and the star is the same measured out in space as it is
    // measured on the sky. That is not luck. It is ninety degrees minus the
    // declination in both cases, and the sundial gets its declination from
    // this same axis.
    const axis = E.normalize([0.2, -0.4, 0.89]);
    const star = E.normalize([0.7, 0.6, -0.1]);
    const dec = Math.asin(E.dot(star, axis));
    for (const lat of [0.6, -1.1, 0]) {
      for (const h of [0, 1.3, -2.7]) {
        const p = altAz(lat, dec, h);
        const pole = E.dirFromAltAz(lat, 0);
        const starLocal = E.dirFromAltAz(p.altitude, p.azimuth);
        const m = E.frameMap(axis, star, pole, starLocal);
        expect(E.angleBetween(m(axis), pole)).toBeLessThan(1e-9);
        expect(E.angleBetween(m(star), starLocal)).toBeLessThan(1e-9);
      }
    }
  });

  it('always places the first direction exactly, consistent pair or not', () => {
    // The second is only carried into the right plane when the separations
    // agree; the first is nailed down whatever happens.
    const m = E.frameMap(
      E.normalize([0.2, -0.4, 0.89]), E.normalize([0.7, 0.6, -0.1]),
      E.dirFromAltAz(0.6, 0), E.dirFromAltAz(0.31, 2.2),
    );
    expect(E.angleBetween(m(E.normalize([0.2, -0.4, 0.89])), E.dirFromAltAz(0.6, 0)))
      .toBeLessThan(1e-12);
  });

  it('is a rotation: it preserves every angle it carries', () => {
    const m = E.frameMap(
      E.normalize([0, 0, 1]), E.normalize([1, 0.2, 0.1]),
      E.dirFromAltAz(0.9, 0), E.dirFromAltAz(0.2, 1.1),
    );
    const a = E.normalize([0.3, -0.9, 0.2]), b = E.normalize([-0.5, 0.1, 0.85]);
    expect(E.angleBetween(m(a), m(b))).toBeCloseTo(E.angleBetween(a, b), 10);
    expect(E.length(m(a))).toBeCloseTo(1, 12);
  });

  it('survives a star standing directly over the pole', () => {
    // Real case: a world tipped ninety degrees has the star at its zenith pole
    // at the solstice. The roll about the axis is then undetermined, but the
    // map still has to be a rotation and still has to place the pole.
    const m = E.frameMap([0, 0, 1], [0, 0, 1], E.dirFromAltAz(0.5, 0), E.dirFromAltAz(0.5, 0));
    const v = m([1, 0, 0]);
    expect(Number.isFinite(v[0] + v[1] + v[2])).toBe(true);
    expect(E.length(v)).toBeCloseTo(1, 10);
  });
});

describe('how bright a wanderer is', () => {
  // Published absolute magnitudes, and the Bond albedos this code is given
  // instead of geometric ones. Half a magnitude is the price of that swap.
  const REAL: [string, number, number, number][] = [
    ['Mercury', 2439.7e3, 0.088, -0.61],
    ['Venus', 6051.8e3, 0.77, -4.38],
    ['Earth', 6371.0e3, 0.306, -3.99],
    ['Mars', 3389.5e3, 0.25, -1.60],
    ['Jupiter', 69911e3, 0.503, -9.40],
    ['Saturn', 58232e3, 0.342, -8.91],
    ['Uranus', 25362e3, 0.300, -7.11],
    ['Neptune', 24622e3, 0.290, -6.94],
  ];

  it('reproduces every published absolute magnitude to half a magnitude', () => {
    for (const [name, r, a, want] of REAL) {
      const got = E.absoluteMagnitude(r, a);
      expect(Math.abs(got - want), name).toBeLessThan(0.55);
    }
  });

  it('inverts the size-brightness relation it came from', () => {
    // D = 1329/sqrt(p) * 10^(-H/5) is how asteroid diameters are estimated.
    for (const [r, p] of [[1e6, 0.1], [7e7, 0.5], [1e4, 0.04]]) {
      const h = E.absoluteMagnitude(r, p);
      const dKm = (E.MAG_SIZE_CONST_KM / Math.sqrt(p)) * Math.pow(10, -h / 5);
      expect(dKm * 500).toBeCloseTo(r, 4);
    }
  });

  it('is brighter for a bigger or a whiter body', () => {
    expect(E.absoluteMagnitude(2e6, 0.1)).toBeLessThan(E.absoluteMagnitude(1e6, 0.1));
    expect(E.absoluteMagnitude(1e6, 0.4)).toBeLessThan(E.absoluteMagnitude(1e6, 0.1));
  });

  it('has a Lambert phase function that is one at full and zero at new', () => {
    expect(E.lambertPhase(0)).toBeCloseTo(1, 12);
    expect(E.lambertPhase(Math.PI)).toBeCloseTo(0, 12);
    // At quadrature it is 1/pi, not a half: the visible crescent is not only
    // half the disc, it is also lit at a slant.
    expect(E.lambertPhase(Math.PI / 2)).toBeCloseTo(1 / Math.PI, 12);
    for (let a = 0; a < Math.PI; a += 0.1) {
      expect(E.lambertPhase(a + 0.1)).toBeLessThan(E.lambertPhase(a));
    }
  });

  it('puts the real planets at the magnitudes they are seen at', () => {
    const H = (r: number, a: number): number => E.absoluteMagnitude(r, a);
    // Venus at superior conjunction, full and far: about -3.9 in the almanac.
    expect(E.apparentMagnitude(H(6051.8e3, 0.77), 0.723, 1.723, 0)).toBeCloseTo(-4.0, 0);
    // Mars at opposition: between -1.9 and -2.9 depending on where in its
    // eccentric orbit the opposition falls.
    expect(E.apparentMagnitude(H(3389.5e3, 0.25), 1.52, 0.52, 0)).toBeGreaterThan(-3);
    expect(E.apparentMagnitude(H(3389.5e3, 0.25), 1.52, 0.52, 0)).toBeLessThan(-1.5);
    // Jupiter at opposition: -2.7.
    expect(E.apparentMagnitude(H(69911e3, 0.503), 5.2, 4.2, 0)).toBeCloseTo(-2.7, 0);
    // Uranus at opposition: 5.7, right at the naked-eye limit, which is why
    // nobody recognised it as a planet for two thousand years.
    expect(E.apparentMagnitude(H(25362e3, 0.30), 19.2, 18.2, 0)).toBeGreaterThan(5);
    expect(E.apparentMagnitude(H(25362e3, 0.30), 19.2, 18.2, 0)).toBeLessThan(7);
  });

  it('makes Venus brightest as a crescent rather than as a full disc', () => {
    // The fact that decided the shape of the phase function. Venus full is
    // 1.7 AU away; Venus as a fat crescent is a third of that, and the
    // inverse square beats the phase law until the crescent gets thin.
    const H = E.absoluteMagnitude(6051.8e3, 0.77);
    const full = E.apparentMagnitude(H, 0.723, 1.723, 0);
    const crescent = E.apparentMagnitude(H, 0.723, 0.50, 2.0);
    expect(crescent).toBeLessThan(full);
  });

  it('loses about a magnitude to one optical depth of air', () => {
    expect(E.extinctionMag(1)).toBeCloseTo(1.0857, 4);
    expect(E.extinctionMag(0)).toBe(0);
    expect(E.extinctionMag(Infinity)).toBe(Infinity);
  });

  it('converts magnitudes to fluxes on the two-and-a-half-log scale', () => {
    expect(E.fluxOfMagnitude(0)).toBeCloseTo(1, 12);
    expect(E.fluxOfMagnitude(5)).toBeCloseTo(0.01, 12);
    expect(E.fluxOfMagnitude(-5)).toBeCloseTo(100, 10);
  });
});

describe('phase and elongation', () => {
  it('calls it full at opposition and new at inferior conjunction', () => {
    const obs: E.Vec3 = [AU, 0, 0];
    expect(E.phaseAngle(obs, [2 * AU, 0, 0])).toBeCloseTo(0, 9);       // beyond, full
    expect(E.phaseAngle(obs, [0.5 * AU, 0, 0])).toBeCloseTo(Math.PI, 9); // between, new
  });

  it('measures elongation from the star, not from the observer', () => {
    const obs: E.Vec3 = [AU, 0, 0];
    expect(deg(E.elongation(obs, [2 * AU, 0, 0]))).toBeCloseTo(180, 6);
    expect(deg(E.elongation(obs, [0, AU, 0]))).toBeCloseTo(45, 6);
  });

  it('caps how far an inner planet can get from its star', () => {
    // Venus never more than 46 degrees from the Sun, Mercury never more than
    // about 23 on a circle. This is why they are only ever morning or evening
    // stars, and it is a hard geometric ceiling, not a tendency.
    expect(deg(E.maxElongation(0.723, 1))).toBeCloseTo(46.3, 1);
    expect(deg(E.maxElongation(0.387, 1))).toBeCloseTo(22.8, 1);
    expect(E.maxElongation(1.52, 1)).toBeCloseTo(Math.PI, 12);
  });
});

describe('morning stars and evening stars', () => {
  it('calls east of the star evening and west of it morning', () => {
    // Looking north from the equator with the star due east and rising, an
    // evening star is further east still - which from here is below it, and
    // still to rise.
    const pole = E.dirFromAltAz(0, 0);
    const star = E.dirFromAltAz(0, Math.PI / 2);
    expect(E.isEastOf(pole, star, E.dirFromAltAz(-0.3, Math.PI / 2))).toBe(true);
    expect(E.isEastOf(pole, star, E.dirFromAltAz(0.3, Math.PI / 2))).toBe(false);
  });

  it('gives the same answer at every hour of the night', () => {
    // The test that matters: a planet is a morning star for months, not for an
    // evening. The label must not depend on what time it is asked.
    const dec = 0.2, lat = 0.6;
    const pole = E.dirFromAltAz(lat, 0);
    let east = 0, west = 0;
    for (let h = -3; h <= 3; h += 0.2) {
      const s = altAz(lat, dec, h);
      const star = E.dirFromAltAz(s.altitude, s.azimuth);
      // A body a fixed thirty degrees of hour angle east of the star.
      const p = altAz(lat, dec, h - 0.5236);
      const body = E.dirFromAltAz(p.altitude, p.azimuth);
      if (E.isEastOf(pole, star, body)) east++; else west++;
    }
    expect(west).toBe(0);
    expect(east).toBeGreaterThan(20);
  });

  it('swaps sides when the body crosses the star', () => {
    const pole = E.dirFromAltAz(0.6, 0);
    const s = altAz(0.6, 0.2, 0.4);
    const star = E.dirFromAltAz(s.altitude, s.azimuth);
    const at = (dh: number): boolean => {
      const p = altAz(0.6, 0.2, 0.4 + dh);
      return E.isEastOf(pole, star, E.dirFromAltAz(p.altitude, p.azimuth));
    };
    expect(at(-0.3)).toBe(true);
    expect(at(0.3)).toBe(false);
  });
});

describe('the sky from a real planet', () => {
  const sys = solarSystem();
  const bodies = sys.planets.map((p) => ({
    name: p.name, radiusM: p.radiusM, albedo: p.albedo,
    elements: p.elements, color: p.color,
  }));
  const earth = sys.planets[2];
  const year = 3.156e7;

  const at = (t: number): E.Wanderer[] => E.skyBodies(
    bodies, E.positionOf(earth.elements, GM_SUN, t), GM_SUN, t, (v) => v, 2,
  );

  it('leaves the observer out and keeps everybody else', () => {
    const w = at(0);
    expect(w).toHaveLength(sys.planets.length - 1);
    expect(w.map((x) => x.name)).not.toContain('Earth');
  });

  it('hands them back brightest first, with Venus in front', () => {
    for (let t = 0; t < year * 3; t += year / 7) {
      const w = at(t);
      for (let i = 1; i < w.length; i++) expect(w[i].mag).toBeGreaterThanOrEqual(w[i - 1].mag);
      expect(w[0].name).toBe('Venus');
    }
  });

  it('never lets Mercury or Venus stray far from the sun', () => {
    let maxV = 0, maxM = 0;
    for (let t = 0; t < year * 4; t += year / 400) {
      for (const w of at(t)) {
        if (w.name === 'Venus') maxV = Math.max(maxV, w.elongationRad);
        if (w.name === 'Mercury') maxM = Math.max(maxM, w.elongationRad);
      }
    }
    // Real greatest elongations: Venus 47, Mercury 28 at aphelion.
    expect(deg(maxV)).toBeGreaterThan(44);
    expect(deg(maxV)).toBeLessThan(49);
    expect(deg(maxM)).toBeGreaterThan(20);
    expect(deg(maxM)).toBeLessThan(30);
  });

  it('lets the outer planets reach opposition, and Venus never', () => {
    let maxJ = 0, maxVenus = 0;
    for (let t = 0; t < year * 13; t += year / 60) {
      for (const w of at(t)) {
        if (w.name === 'Jupiter') maxJ = Math.max(maxJ, w.elongationRad);
        if (w.name === 'Venus') maxVenus = Math.max(maxVenus, w.elongationRad);
      }
    }
    expect(deg(maxJ)).toBeGreaterThan(175);
    expect(deg(maxVenus)).toBeLessThan(90);
  });

  it('makes Mars go backwards, without being told to', () => {
    // Retrograde motion: the thing epicycles were invented for. Earth
    // overtakes Mars on the inside every twenty-six months, and for about ten
    // weeks Mars appears to reverse. Nothing here schedules that - it is a
    // vector difference and a faster inner orbit.
    let reversals = 0, wasBack = false;
    let prev = -99;
    for (let t = 0; t < year * 8; t += year / 900) {
      const obs = E.positionOf(earth.elements, GM_SUN, t);
      const mars = E.positionOf(sys.planets[3].elements, GM_SUN, t);
      const rel = E.sub(mars, obs);
      // Ecliptic longitude as seen from Earth.
      const lon = Math.atan2(rel[1], rel[0]);
      if (prev > -9) {
        let d = lon - prev;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        const back = d < 0;
        if (back && !wasBack) reversals++;
        wasBack = back;
      }
      prev = lon;
    }
    // Once per synodic period of 2.14 years: four in eight years.
    expect(reversals).toBeGreaterThanOrEqual(3);
    expect(reversals).toBeLessThanOrEqual(5);
  });

  it('makes an outer planet brightest at opposition and faintest at conjunction', () => {
    let bestEl = 0, worstEl = 0, best = 99, worst = -99;
    for (let t = 0; t < year * 13; t += year / 120) {
      for (const w of at(t)) {
        if (w.name !== 'Jupiter') continue;
        if (w.mag < best) { best = w.mag; bestEl = w.elongationRad; }
        if (w.mag > worst) { worst = w.mag; worstEl = w.elongationRad; }
      }
    }
    expect(deg(bestEl)).toBeGreaterThan(150);
    expect(deg(worstEl)).toBeLessThan(30);
    // Jupiter varies by about a magnitude over its synodic cycle.
    expect(worst - best).toBeGreaterThan(0.5);
    expect(worst - best).toBeLessThan(1.5);
  });

  it('knows which planets are on smaller circles than the observer', () => {
    const w = at(year * 0.4);
    const inner = w.filter((x) => x.inner).map((x) => x.name).sort();
    expect(inner).toEqual(['Mercury', 'Venus']);
    // And it is exactly those two that can never reach quadrature.
    for (const x of w) {
      if (x.inner) expect(deg(x.elongationRad)).toBeLessThan(88);
    }
  });

  it('shows every planet as a disc too small to resolve', () => {
    for (const w of at(0)) {
      // An arcminute is 2.9e-4 rad; nothing here reaches it, which is why they
      // are drawn as points and why nobody knew Venus had phases until 1610.
      expect(w.angRad * 2).toBeLessThan(3.4e-4);
      expect(w.angRad).toBeGreaterThan(0);
    }
  });

  it('has the lit fraction and the phase angle agree', () => {
    for (const w of at(year * 0.37)) {
      expect(w.litFraction).toBeCloseTo((1 + Math.cos(w.phaseRad)) / 2, 12);
      expect(w.litFraction).toBeGreaterThanOrEqual(0);
      expect(w.litFraction).toBeLessThanOrEqual(1);
    }
  });

  it('sees an outer planet nearly full always, and an inner one through phases', () => {
    let jMin = 9, vMin = 9, vMax = -9;
    for (let t = 0; t < year * 13; t += year / 120) {
      for (const w of at(t)) {
        if (w.name === 'Jupiter') jMin = Math.min(jMin, w.litFraction);
        if (w.name === 'Venus') { vMin = Math.min(vMin, w.litFraction); vMax = Math.max(vMax, w.litFraction); }
      }
    }
    // Jupiter's phase angle never exceeds 12 degrees from Earth.
    expect(jMin).toBeGreaterThan(0.97);
    expect(vMin).toBeLessThan(0.05);
    expect(vMax).toBeGreaterThan(0.97);
  });
});

describe('one disc in front of another', () => {
  const S = 0.00465;  // the Sun's angular radius from Earth

  it('is nothing when they do not touch and everything when they coincide', () => {
    expect(E.coveredFraction(0.02, S, S)).toBe(0);
    expect(E.coveredFraction(S + S, S, S)).toBe(0);
    expect(E.coveredFraction(0, S, S * 1.05)).toBe(1);
  });

  it('takes a fixed bite for a small disc wholly inside a large one', () => {
    // An annular eclipse: the Moon at apogee is smaller than the Sun and
    // cannot cover it however well aligned. What is left is a ring.
    const m = S * 0.95;
    expect(E.coveredFraction(0, S, m)).toBeCloseTo(0.95 ** 2, 12);
    expect(E.coveredFraction(S - m, S, m)).toBeCloseTo(0.95 ** 2, 12);
  });

  it('is continuous and monotone through every transition', () => {
    const m = S * 1.03;
    let prev = 0;
    for (let d = S + m; d >= 0; d -= (S + m) / 400) {
      const f = E.coveredFraction(d, S, m);
      expect(f).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(f - prev).toBeLessThan(0.02);   // no jumps
      prev = f;
    }
    expect(prev).toBeCloseTo(1, 12);
  });

  it('matches the two-circle lens area at half cover', () => {
    // Equal discs half overlapping: the separation where the lens is half the
    // disc solves d = 0.8079 R, a number that comes out of the same integral.
    let lo = 0, hi = 2 * S;
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2;
      if (E.coveredFraction(mid, S, S) > 0.5) lo = mid; else hi = mid;
    }
    expect(lo / S).toBeCloseTo(0.8079, 3);
  });
});

describe('limb darkening, and why totality falls off a cliff', () => {
  const S = 0.00465;

  it('takes all the light only when the star is wholly hidden', () => {
    expect(E.eclipseLight(0, S, S * 1.05)).toBe(0);
    expect(E.eclipseLight(0.02, S, S)).toBe(1);
  });

  it('leaves a few percent of the light in an annular eclipse', () => {
    // Seven percent of the area still showing, but it is the faint rim, so
    // barely four percent of the light. Deep twilight, and no corona.
    const f = E.coveredFraction(0, S, S * 0.963);
    const l = E.eclipseLight(0, S, S * 0.963);
    expect(f).toBeCloseTo(0.928, 2);
    expect(l).toBeGreaterThan(0.02);
    expect(l).toBeLessThan(0.08);
    expect(l).toBeLessThan(1 - f);   // less light left than area left
  });

  it('costs less than its area at first contact and more near totality', () => {
    const m = S * 1.02;
    // A shallow bite out of the dim limb.
    const shallow = E.coveredFraction(S + m * 0.85, S, m);
    expect(1 - E.eclipseLight(S + m * 0.85, S, m)).toBeLessThan(shallow);
    // A deep one that has reached the bright middle.
    const deep = E.coveredFraction(S * 0.35, S, m);
    expect(1 - E.eclipseLight(S * 0.35, S, m)).toBeGreaterThan(deep);
  });

  it('is monotone and continuous all the way to zero', () => {
    const m = S * 1.02;
    let prev = 1;
    for (let d = S + m; d >= 0; d -= (S + m) / 300) {
      const l = E.eclipseLight(d, S, m);
      expect(l).toBeLessThanOrEqual(prev + 1e-9);
      expect(prev - l).toBeLessThan(0.05);
      prev = l;
    }
    expect(prev).toBe(0);
  });

  it('reduces to no darkening at all when u is zero', () => {
    const m = S * 0.8;
    for (const d of [0, S * 0.3, S * 0.9, S * 1.4]) {
      expect(1 - E.eclipseLight(d, S, m, 0)).toBeCloseTo(E.coveredFraction(d, S, m), 2);
    }
  });

  it('covers a ring entirely, partly, or not at all, and nothing else', () => {
    expect(E.arcCovered(0.2, 0, 0.5)).toBe(1);
    expect(E.arcCovered(0.8, 0, 0.5)).toBe(0);
    expect(E.arcCovered(0.5, 3, 0.5)).toBe(0);
    expect(E.arcCovered(0.9, 0.4, 0.2)).toBe(0);   // occulter inside the ring
    const half = E.arcCovered(1, 1, 1);            // occulter through the centre
    expect(half).toBeCloseTo(1 / 3, 6);
  });
});

describe('a star seen from where you stand', () => {
  it('is a quarter of a degree wide from one AU, and half from half', () => {
    expect(deg(2 * E.starAngularRadius(1, AU))).toBeCloseTo(0.533, 3);
    expect(deg(2 * E.starAngularRadius(1, AU / 2))).toBeCloseTo(1.066, 2);
  });

  it('never divides by zero at the centre of the star', () => {
    expect(Number.isFinite(E.starAngularRadius(1, 0))).toBe(true);
    expect(E.starAngularRadius(1, 0)).toBeCloseTo(Math.PI / 2, 6);
  });

  it('agrees with the small-angle radius over a solar radius', () => {
    expect(E.starAngularRadius(1, 100 * AU)).toBeCloseTo(R_SUN / (100 * AU), 12);
  });
});
