import { describe, it, expect } from 'vitest';
import {
  surfaceGravity, tidalHeatFlux, moonTemperature, retainsAtmosphere, moonAsWorld,
  parentAngularRadius, parentAltitude, parentHorizonAngle, librationAmplitude,
  illuminatedFraction, umbraLength, umbraRadiusAt, inEclipse, eclipsedFraction,
  synodicPeriod, bestMoon,
} from '../src/astro/companion';
import * as COMP from '../src/astro/companion';
import type { Moon, Planet } from '../src/astro/planets';
import { R_SUN, AU, DAY, DEG, M_EARTH, R_EARTH } from '../src/core/constants';

/** The four Galileans, and Titan, at their real numbers. */
const JUPITER = {
  massKg: 1.89813e27, radiusM: 6.9911e7, au: 5.2038, moons: [], rings: [],
} as unknown as Planet;
const SATURN = {
  massKg: 5.6834e26, radiusM: 5.8232e7, au: 9.5826, moons: [], rings: [],
} as unknown as Planet;
const EARTH = {
  massKg: 5.97217e24, radiusM: R_EARTH, au: 1, moons: [], rings: [],
} as unknown as Planet;

const moon = (o: Partial<Moon>): Moon => ({
  name: 'x', massKg: 1e22, radiusM: 1e6, a: 1e9, e: 0.001, i: 0, phase: 0,
  albedo: 0.3, icy: false, tidallyHeated: false, color: [0.5, 0.5, 0.5], ...o,
});

const IO = moon({ name: 'Io', massKg: 8.9319e22, radiusM: 1.8216e6, a: 4.217e8, e: 0.0041, albedo: 0.63 });
const EUROPA = moon({ name: 'Europa', massKg: 4.7998e22, radiusM: 1.5608e6, a: 6.711e8, e: 0.009, albedo: 0.67, icy: true });
const GANYMEDE = moon({ name: 'Ganymede', massKg: 1.4819e23, radiusM: 2.6341e6, a: 1.0704e9, e: 0.0013, albedo: 0.43, icy: true });
const CALLISTO = moon({ name: 'Callisto', massKg: 1.0759e23, radiusM: 2.4103e6, a: 1.8827e9, e: 0.0074, albedo: 0.22, icy: true });
const TITAN = moon({ name: 'Titan', massKg: 1.3452e23, radiusM: 2.5747e6, a: 1.22187e9, e: 0.0288, albedo: 0.22, icy: true });
const LUNA = moon({ name: 'Moon', massKg: 7.342e22, radiusM: 1.7374e6, a: 3.844e8, e: 0.0549, albedo: 0.12 });

describe('a moon as somewhere to stand', () => {
  it('gets the surface gravity of the ones that have been landed on', () => {
    // The Moon is a sixth of a g; Titan and Europa are a seventh.
    expect(surfaceGravity(LUNA.massKg, LUNA.radiusM)).toBeCloseTo(1.62, 1);
    expect(surfaceGravity(TITAN.massKg, TITAN.radiusM)).toBeCloseTo(1.35, 1);
    expect(surfaceGravity(EUROPA.massKg, EUROPA.radiusM)).toBeCloseTo(1.31, 1);
    expect(surfaceGravity(GANYMEDE.massKg, GANYMEDE.radiusM)).toBeCloseTo(1.43, 1);
  });

  it('returns nothing for a body with no size', () => {
    expect(surfaceGravity(1e20, 0)).toBe(0);
  });
});

describe('what the flexing does', () => {
  it('makes Io the most volcanic thing in the solar system', () => {
    // Io's measured heat flow is 2.5 W/m^2 - half the sunlight it gets out
    // there, and twenty times the heat coming out of the Earth. Nothing else
    // in the solar system is remotely close.
    const io = tidalHeatFlux(IO.radiusM, IO.a, IO.e, JUPITER.massKg);
    expect(io).toBeGreaterThan(1.2);
    expect(io).toBeLessThan(5);
  });

  it('falls off a cliff with distance, which is why Callisto is dead', () => {
    const io = tidalHeatFlux(IO.radiusM, IO.a, IO.e, JUPITER.massKg);
    const eu = tidalHeatFlux(EUROPA.radiusM, EUROPA.a, EUROPA.e, JUPITER.massKg);
    const ca = tidalHeatFlux(CALLISTO.radiusM, CALLISTO.a, CALLISTO.e, JUPITER.massKg);
    expect(eu).toBeLessThan(io);
    expect(ca).toBeLessThan(eu);
    // Four times further out is thousands of times less heat.
    expect(io / Math.max(ca, 1e-30)).toBeGreaterThan(500);
  });

  it('needs an eccentric orbit: a circular one is not flexed at all', () => {
    expect(tidalHeatFlux(IO.radiusM, IO.a, 0, JUPITER.massKg)).toBe(0);
  });

  it('is nothing at all for our own Moon, which is why it is cold', () => {
    // Same eccentricity as Io and more, but the Earth is three hundred times
    // lighter and the Moon is twice as far out.
    const luna = tidalHeatFlux(LUNA.radiusM, LUNA.a, LUNA.e, EARTH.massKg);
    const io = tidalHeatFlux(IO.radiusM, IO.a, IO.e, JUPITER.massKg);
    expect(luna).toBeLessThan(io * 0.01);
  });

  it('never returns a NaN or a negative', () => {
    for (const a of [0, 1e5, 1e9, 1e13]) {
      const v = tidalHeatFlux(1e6, a, 0.01, 1e27);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('how cold a moon is', () => {
  it('puts the Galileans near a hundred kelvin', () => {
    for (const m of [EUROPA, GANYMEDE, CALLISTO]) {
      const t = moonTemperature(1, JUPITER.au, m.albedo,
        tidalHeatFlux(m.radiusM, m.a, m.e, JUPITER.massKg));
      expect(t).toBeGreaterThan(75);
      expect(t).toBeLessThan(140);
    }
  });

  it('puts Titan near ninety, which is where it is', () => {
    const t = moonTemperature(1, SATURN.au, TITAN.albedo,
      tidalHeatFlux(TITAN.radiusM, TITAN.a, TITAN.e, SATURN.massKg));
    expect(t).toBeGreaterThan(70);
    expect(t).toBeLessThan(110);
  });

  it('warms Io above where sunlight alone would leave it', () => {
    const flux = tidalHeatFlux(IO.radiusM, IO.a, IO.e, JUPITER.massKg);
    const withTide = moonTemperature(1, JUPITER.au, IO.albedo, flux);
    const without = moonTemperature(1, JUPITER.au, IO.albedo, 0);
    expect(withTide).toBeGreaterThan(without);
  });

  it('gets colder the further out the parent orbits', () => {
    const near = moonTemperature(1, 1, 0.3, 0);
    const far = moonTemperature(1, 30, 0.3, 0);
    expect(far).toBeLessThan(near);
    // Falls as the inverse square root of distance.
    expect(near / far).toBeCloseTo(Math.sqrt(30), 1);
  });
});

describe('whether it keeps its air', () => {
  const beltsOf = (m: Moon, p: Planet) => m.a / p.radiusM;

  it('lets Titan keep a nitrogen atmosphere', () => {
    const t = moonTemperature(1, SATURN.au, TITAN.albedo, 0);
    expect(retainsAtmosphere(TITAN.massKg, TITAN.radiusM, t, true,
      beltsOf(TITAN, SATURN))).toBe(true);
  });

  it('denies one to every Galilean, which is the hard part', () => {
    // Ganymede and Callisto both clear the escape threshold comfortably and
    // are both bare rock. Only Titan has one, and only Titan should get one.
    for (const m of [IO, EUROPA, GANYMEDE, CALLISTO]) {
      const t = moonTemperature(1, JUPITER.au, m.albedo,
        tidalHeatFlux(m.radiusM, m.a, m.e, JUPITER.massKg));
      expect(retainsAtmosphere(m.massKg, m.radiusM, t, m.icy,
        beltsOf(m, JUPITER))).toBe(false);
    }
  });

  it('does not give one to the Moon, which is warm and light', () => {
    const t = moonTemperature(1, 1, LUNA.albedo, 0);
    expect(retainsAtmosphere(LUNA.massKg, LUNA.radiusM, t, false, 60)).toBe(false);
    // Not even if it were icy: at almost three hundred kelvin nothing stays.
    expect(retainsAtmosphere(LUNA.massKg, LUNA.radiusM, t, true, 60)).toBe(false);
  });

  it('does not give one to a rock, however cold and however far out', () => {
    expect(retainsAtmosphere(1e20, 2e5, 40, true, 90)).toBe(false);
  });

  it('does not give one to a moon inside the radiation belts, however massive', () => {
    const t = moonTemperature(1, SATURN.au, TITAN.albedo, 0);
    expect(retainsAtmosphere(TITAN.massKg, TITAN.radiusM, t, true, 6)).toBe(false);
  });
});

describe('a moon turned into a world', () => {
  const titan = moonAsWorld(TITAN, SATURN, 1, 0);
  const europa = moonAsWorld(EUROPA, JUPITER, 1, 0);
  const io = moonAsWorld(IO, JUPITER, 1, 0);

  it('gives Titan an atmosphere and Europa none', () => {
    expect(titan.pressureBar).toBeGreaterThan(0.2);
    expect(titan.atmosphere).toBe('N₂');
    expect(europa.pressureBar).toBe(0);
    expect(europa.atmosphere).toBe('none');
  });

  it('locks every one of them, so their day is their month', () => {
    for (const w of [titan, europa, io]) {
      expect(w.tidallyLocked).toBe(true);
      expect(w.dayS).toBeCloseTo(w.periodS, 6);
      expect(w.obliquity).toBe(0);
    }
  });

  it('gets the orbital periods right', () => {
    // Io 1.77 days, Europa 3.55, Titan 15.95.
    expect(io.periodS / DAY).toBeCloseTo(1.77, 1);
    expect(europa.periodS / DAY).toBeCloseTo(3.55, 1);
    expect(titan.periodS / DAY).toBeCloseTo(15.95, 0);
  });

  it('calls Io a lava world and Europa an ice one', () => {
    expect(io.cls).toBe('lava');
    expect(europa.cls).toBe('ice');
  });

  it('gives them the density they have', () => {
    // Io is rock, at 3.5 g/cc; Europa and Titan are half ice, near 1.9.
    expect(io.density / 1000).toBeCloseTo(3.53, 0);
    expect(europa.density / 1000).toBeCloseTo(3.01, 0);
    expect(titan.density / 1000).toBeCloseTo(1.88, 0);
  });

  it('leaves them without oceans you could stand beside', () => {
    // Europa's ocean is real and is under ten kilometres of ice.
    expect(europa.oceanFraction).toBe(0);
  });

  it('never produces a NaN, whatever the moon', () => {
    for (const m of [IO, EUROPA, GANYMEDE, CALLISTO, TITAN, LUNA,
      moon({ radiusM: 4e4, massKg: 1e17, a: 1e8 })]) {
      const w = moonAsWorld(m, JUPITER, 1, 0);
      for (const v of [w.gravity, w.surfaceK, w.periodS, w.density,
        w.escapeVelocity, w.pressureBar]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('the planet overhead', () => {
  it('makes Jupiter twelve degrees wide in Europa’s sky', () => {
    const d = (2 * parentAngularRadius(JUPITER.radiusM, EUROPA.a) * 180) / Math.PI;
    expect(d).toBeGreaterThan(11.5);
    expect(d).toBeLessThan(12.5);
  });

  it('makes it nineteen degrees from Io and four from Callisto', () => {
    const io = (2 * parentAngularRadius(JUPITER.radiusM, IO.a) * 180) / Math.PI;
    const ca = (2 * parentAngularRadius(JUPITER.radiusM, CALLISTO.a) * 180) / Math.PI;
    expect(io).toBeGreaterThan(18);
    expect(io).toBeLessThan(20);
    expect(ca).toBeGreaterThan(4);
    expect(ca).toBeLessThan(5);
  });

  it('makes Saturn five and a half degrees wide from Titan', () => {
    const d = (2 * parentAngularRadius(SATURN.radiusM, TITAN.a) * 180) / Math.PI;
    expect(d).toBeGreaterThan(5);
    expect(d).toBeLessThan(6.2);
  });

  it('makes Earth two degrees wide from the Moon, four times our Moon', () => {
    const earth = (2 * parentAngularRadius(EARTH.radiusM, LUNA.a) * 180) / Math.PI;
    expect(earth).toBeCloseTo(1.9, 1);
    // And our Moon is half a degree from here, so it is nearly four times as
    // wide and thirteen times the area.
    expect(earth / 0.52).toBeGreaterThan(3.4);
  });

  it('is thousands of times the area of a full moon, from Europa', () => {
    const jup = parentAngularRadius(JUPITER.radiusM, EUROPA.a);
    const luna = parentAngularRadius(LUNA.radiusM, LUNA.a);
    expect((jup / luna) ** 2).toBeGreaterThan(500);
  });
});

describe('where it hangs', () => {
  it('is straight overhead at the sub-planet point', () => {
    expect(parentAltitude(EUROPA.a, EUROPA.radiusM, 0) / DEG).toBeCloseTo(90, 6);
  });

  it('is just below the horizon a quarter of the way round', () => {
    // Not exactly on it: the moon has a radius and you are on the outside.
    const alt = parentAltitude(EUROPA.a, EUROPA.radiusM, Math.PI / 2) / DEG;
    expect(alt).toBeLessThan(0);
    expect(alt).toBeGreaterThan(-1);
  });

  it('is never visible from the far side, at all', () => {
    expect(parentAltitude(EUROPA.a, EUROPA.radiusM, Math.PI) / DEG).toBeLessThan(-80);
  });

  it('falls all the way from the zenith without ever rising again', () => {
    let prev = Infinity;
    for (let i = 0; i <= 60; i++) {
      const a = parentAltitude(EUROPA.a, EUROPA.radiusM, (i / 60) * Math.PI);
      expect(a).toBeLessThan(prev);
      prev = a;
    }
  });

  it('sets a little short of ninety degrees round', () => {
    const h = parentHorizonAngle(EUROPA.a, EUROPA.radiusM) / DEG;
    expect(h).toBeLessThan(90);
    expect(h).toBeGreaterThan(89);
    // On a big moon close in, the sliver taken is much larger.
    expect(parentHorizonAngle(1.2e8, 2.4e6) / DEG).toBeLessThan(89);
  });

  it('wanders about its spot by twice the eccentricity', () => {
    expect(librationAmplitude(0.0549) / DEG).toBeCloseTo(6.29, 1);
    expect(librationAmplitude(0)).toBe(0);
  });
});

describe('its phases', () => {
  it('is full at opposition and new at conjunction', () => {
    expect(illuminatedFraction(0)).toBeCloseTo(1, 9);
    expect(illuminatedFraction(Math.PI)).toBeCloseTo(0, 9);
    expect(illuminatedFraction(Math.PI / 2)).toBeCloseTo(0.5, 9);
  });

  it('runs monotonically between them', () => {
    let prev = 1.001;
    for (let i = 0; i <= 20; i++) {
      const f = illuminatedFraction((i / 20) * Math.PI);
      expect(f).toBeLessThan(prev);
      prev = f;
    }
  });
});

describe('eclipses', () => {
  it('gives Jupiter a shadow ninety million kilometres long', () => {
    const L = umbraLength(JUPITER.radiusM, R_SUN, JUPITER.au * AU) / 1e9;
    expect(L).toBeGreaterThan(70);
    expect(L).toBeLessThan(110);
  });

  it('puts every Galilean deep inside it, not near its tip', () => {
    const L = umbraLength(JUPITER.radiusM, R_SUN, JUPITER.au * AU);
    for (const m of [IO, EUROPA, GANYMEDE, CALLISTO]) {
      expect(m.a / L).toBeLessThan(0.03);
      // So the shadow there is still essentially the whole planet.
      const r = umbraRadiusAt(JUPITER.radiusM, R_SUN, JUPITER.au * AU, m.a);
      expect(r / JUPITER.radiusM).toBeGreaterThan(0.97);
    }
  });

  it('eclipses Europa on essentially every orbit', () => {
    const f = eclipsedFraction(EUROPA, JUPITER.radiusM, R_SUN, JUPITER.au * AU, 0.5 * DEG);
    expect(f).toBeGreaterThan(0.02);
    expect(f).toBeLessThan(0.25);
  });

  it('spares a moon whose orbit is tilted clear of the shadow', () => {
    // Tip the orbit far enough and it misses every time, which is why our own
    // Moon is eclipsed twice a year rather than once a month.
    const f = eclipsedFraction(EUROPA, JUPITER.radiusM, R_SUN, JUPITER.au * AU, 12 * DEG);
    expect(f).toBe(0);
  });

  it('never eclipses anything on the sunward side of the orbit', () => {
    for (const p of [0, 0.4, 1.2]) {
      expect(inEclipse(EUROPA, JUPITER.radiusM, R_SUN, JUPITER.au * AU, p, 0)).toBe(false);
    }
    expect(inEclipse(EUROPA, JUPITER.radiusM, R_SUN, JUPITER.au * AU, Math.PI, 0)).toBe(true);
  });

  it('lets a small body cast no umbra at all past its tip', () => {
    // An asteroid's shadow closes within a few of its own radii.
    const L = umbraLength(5e5, R_SUN, AU);
    expect(umbraRadiusAt(5e5, R_SUN, AU, L * 2)).toBe(0);
    expect(umbraRadiusAt(5e5, R_SUN, AU, 0)).toBeCloseTo(5e5, 6);
  });

  it('gives a body larger than its star an endless shadow', () => {
    expect(umbraLength(1e9, 1e8, AU)).toBe(Infinity);
    expect(umbraRadiusAt(1e9, 1e8, AU, 1e12)).toBe(1e9);
  });
});

describe('lining up', () => {
  it('gives the Moon a synodic month longer than its orbit', () => {
    // 27.32 days round the Earth, 29.53 between one full moon and the next.
    expect(synodicPeriod(27.32, 365.25)).toBeCloseTo(29.53, 1);
  });

  it('is infinite for two things with the same period', () => {
    expect(synodicPeriod(10, 10)).toBe(Infinity);
  });
});

describe('choosing where to land', () => {
  it('picks something round rather than a rubble pile', () => {
    const p = {
      ...JUPITER,
      moons: [moon({ radiusM: 8e3, a: 1.3e8 }), EUROPA, moon({ radiusM: 2e4, a: 2e9 })],
    } as unknown as Planet;
    expect(bestMoon(p)).toBe(1);
  });

  it('says there is nowhere when there are no moons', () => {
    expect(bestMoon(JUPITER)).toBe(-1);
  });

  it('prefers the one with the bigger planet in its sky, other things equal', () => {
    const near = moon({ name: 'near', radiusM: 1.6e6, a: 4e8, icy: true });
    const far = moon({ name: 'far', radiusM: 1.6e6, a: 3e9, icy: true });
    const p = { ...JUPITER, moons: [far, near] } as unknown as Planet;
    expect(p.moons[bestMoon(p)].name).toBe('near');
  });

  it('always returns something it can stand on when there is anything at all', () => {
    const p = { ...JUPITER, moons: [moon({ radiusM: 6e4, a: 5e8 })] } as unknown as Planet;
    const i = bestMoon(p);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(p.moons[i]).toBeTruthy();
  });
});

describe('the whole thing holds together for made-up systems', () => {
  it('turns any moon of any giant into a standable world', () => {
    for (const r of [4e5, 1e6, 2.6e6]) {
      for (const a of [2e8, 8e8, 4e9]) {
        const m = moon({ radiusM: r, massKg: 3300 * (4 / 3) * Math.PI * r ** 3, a, e: 0.004, icy: true });
        const w = moonAsWorld(m, JUPITER, 1, 0);
        expect(w.gravity).toBeGreaterThan(0);
        expect(w.gravity).toBeLessThan(30);
        expect(w.surfaceK).toBeGreaterThan(10);
        expect(w.surfaceK).toBeLessThan(2000);
        expect(parentAltitude(a, r, 0) / DEG).toBeCloseTo(90, 3);
      }
    }
  });

  it('keeps a small moon of a small planet sane', () => {
    const tiny = { massKg: 6.4e23, radiusM: 3.39e6, au: 1.52, moons: [], rings: [] } as unknown as Planet;
    const phobos = moon({ radiusM: 1.1e4, massKg: 1.06e16, a: 9.376e6, e: 0.0151 });
    const w = moonAsWorld(phobos, tiny, 1, 0);
    expect(w.gravity).toBeGreaterThan(0);
    expect(w.gravity).toBeLessThan(0.01);
    // Mars from Phobos is enormous: forty degrees across.
    const d = (2 * parentAngularRadius(tiny.radiusM, phobos.a) * 180) / Math.PI;
    expect(d).toBeGreaterThan(35);
    expect(d).toBeLessThan(48);
    expect(w.periodS / DAY).toBeCloseTo(0.319, 1);
  });

  it('measures mass in earths without complaint', () => {
    expect(moonAsWorld(GANYMEDE, JUPITER, 1, 0).massKg / M_EARTH).toBeCloseTo(0.0248, 3);
  });
});

describe('which plane a moon orbits in', () => {
  const R_E = 6.371e6, M_E = 5.97217e24;
  const R_J = 7.1492e7, M_J = 1.898125e27;
  const M_SUN_KG = 1.98847e30;
  const AU_M = 1.495978707e11;
  const DEG_ = Math.PI / 180;

  it('gets the oblateness of a spinning world roughly right', () => {
    // Measured: Earth 1.08e-3, Jupiter 1.475e-2, Saturn 1.63e-2. This is high
    // by a factor of a few, which is the price of not knowing how centrally
    // condensed the world is - and it enters the Laplace radius as a fifth
    // root, so a factor of three there is a quarter here.
    const e = COMP.oblatenessJ2(M_E, R_E, 86164);
    expect(e).toBeGreaterThan(5e-4);
    expect(e).toBeLessThan(5e-3);
    const j = COMP.oblatenessJ2(M_J, R_J, 9.925 * 3600);
    expect(j).toBeGreaterThan(1e-2);
    expect(j).toBeLessThan(1e-1);
    // A faster spin bulges more.
    expect(COMP.oblatenessJ2(M_E, R_E, 43200)).toBeGreaterThan(e);
  });

  it('does not report a shape for something that is not spinning', () => {
    expect(COMP.oblatenessJ2(M_E, R_E, 0)).toBe(0);
    expect(COMP.oblatenessJ2(0, R_E, 86164)).toBe(0);
    // And caps at break-up rather than running away.
    expect(COMP.oblatenessJ2(M_E, R_E, 1)).toBeLessThanOrEqual(0.25);
  });

  it('puts the Laplace radius where the two torques actually balance', () => {
    // Published: about ten Earth radii, and about thirty for Jupiter.
    const re = COMP.laplaceRadius(1.08e-3, R_E, AU_M, M_E, M_SUN_KG) / R_E;
    expect(re).toBeGreaterThan(7);
    expect(re).toBeLessThan(13);
    const rj = COMP.laplaceRadius(1.475e-2, R_J, 5.204 * AU_M, M_J, M_SUN_KG) / R_J;
    expect(rj).toBeGreaterThan(25);
    expect(rj).toBeLessThan(40);
  });

  it('has no Laplace radius for a world with no bulge or no star', () => {
    expect(COMP.laplaceRadius(0, R_E, AU_M, M_E, M_SUN_KG)).toBe(Infinity);
    expect(COMP.laplaceRadius(1e-3, R_E, AU_M, M_E, 0)).toBe(Infinity);
  });

  it('holds a close moon in the equator and lets a far one follow the orbit', () => {
    const rL = COMP.laplaceRadius(1.08e-3, R_E, AU_M, M_E, M_SUN_KG);
    const eps = 23.44 * DEG_;
    // Deep inside: the planet's bulge wins and the plane is the equator.
    expect(COMP.laplaceTilt(eps, rL / 20, rL)).toBeLessThan(0.02 * DEG_);
    // Far outside: the star's tide wins and the plane is the orbit.
    expect(COMP.laplaceTilt(eps, rL * 20, rL)).toBeCloseTo(eps, 4);
    // And it only ever moves one way as you go out.
    let prev = -1;
    for (let k = 1; k <= 60; k++) {
      const t = COMP.laplaceTilt(eps, (rL * k) / 10, rL);
      expect(t).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = t;
    }
  });

  it('puts our own Moon on the ecliptic and the Galileans on Jupiter equator', () => {
    // The fact that decides how often eclipses happen. The Moon is six times
    // outside Earth's Laplace radius, so it follows the ecliptic to within its
    // own five degrees - and eclipses come in seasons twice a year. Every
    // Galilean is well inside Jupiter's, so they sit in its equator to a
    // fraction of a degree and are eclipsed on almost every orbit.
    const rE = COMP.laplaceRadius(1.08e-3, R_E, AU_M, M_E, M_SUN_KG);
    const moon = COMP.laplaceTilt(23.44 * DEG_, 3.844e8, rE);
    expect(moon / DEG_).toBeGreaterThan(23);
    expect(moon / DEG_).toBeLessThan(23.45);

    const rJ = COMP.laplaceRadius(1.475e-2, R_J, 5.204 * AU_M, M_J, M_SUN_KG);
    const eps = 3.13 * DEG_;
    for (const a of [4.217e8, 6.709e8, 1.070e9]) {
      expect(COMP.laplaceTilt(eps, a, rJ) / DEG_).toBeLessThan(0.1);
    }
    // Callisto is the one far enough out to be visibly tipped, and it is - by
    // a few tenths of a degree, which is what is measured.
    const callisto = COMP.laplaceTilt(eps, 1.883e9, rJ) / DEG_;
    expect(callisto).toBeGreaterThan(0.1);
    expect(callisto).toBeLessThan(1.0);
  });

  it('has no plane to argue about when the world is upright', () => {
    const rL = COMP.laplaceRadius(1.08e-3, R_E, AU_M, M_E, M_SUN_KG);
    for (const a of [rL / 10, rL, rL * 10]) {
      expect(COMP.laplaceTilt(0, a, rL)).toBeCloseTo(0, 12);
    }
  });
});
