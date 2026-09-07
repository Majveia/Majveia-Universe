import { describe, it, expect } from 'vitest';
import { makeStar, msLifetimeGyr, habitableZone } from '../src/astro/stellar';
import {
  buildSystem, radiusFromMass, equilibriumTemperature, jeansParameter, snowLine,
} from '../src/astro/planets';
import {
  galaxyFromHalo, buildGalaxy, rotationCurve, angularRate, epicyclicFrequency, massAtLifetime,
} from '../src/galaxy/generator';
import { Universe } from '../src/sim/universe';
import { generateCosmicWeb } from '../src/cosmology/zeldovich';
import { PLANCK18 } from '../src/cosmology/lcdm';
import { M_EARTH, R_EARTH, AU, M_SUN } from '../src/core/constants';

describe('mass-radius relation', () => {
  it('puts Earth at one Earth radius', () => {
    expect(radiusFromMass(1)).toBeCloseTo(1.0, 1);
  });
  it('puts Jupiter on the degenerate plateau', () => {
    // Jupiter is 11.2 Re. Forecaster is fit to a population that includes
    // inflated hot Jupiters, so it runs high for a cold one; ~1.2 R_J is
    // within the relation's own scatter.
    const r = radiusFromMass(317.8);
    expect(r).toBeGreaterThan(9);
    expect(r).toBeLessThan(15);
  });
  it('is monotonic below the degeneracy plateau', () => {
    for (let m = 0.1; m < 100; m *= 1.5) {
      expect(radiusFromMass(m * 1.2)).toBeGreaterThan(radiusFromMass(m));
    }
  });
  it('flattens for giants, because electron degeneracy resists compression', () => {
    const a = radiusFromMass(300);
    const b = radiusFromMass(3000);
    expect(Math.abs(b / a - 1)).toBeLessThan(0.15);
  });
});

describe('planetary temperatures', () => {
  it('gives Earth its 255 K equilibrium temperature', () => {
    expect(equilibriumTemperature(1, 1, 0.306)).toBeCloseTo(254, -1);
  });
  it('gives Mars a colder one', () => {
    expect(equilibriumTemperature(1, 1.524, 0.25)).toBeLessThan(220);
  });
  it('scales as the inverse square root of distance', () => {
    const a = equilibriumTemperature(1, 1, 0.3);
    const b = equilibriumTemperature(1, 4, 0.3);
    expect(a / b).toBeCloseTo(2, 1);
  });
  it('puts the snow line beyond Mars for a solar-luminosity star', () => {
    expect(snowLine(1)).toBeGreaterThan(2);
    expect(snowLine(1)).toBeLessThan(3.2);
  });
});

describe('atmospheric retention', () => {
  it('lets Earth hold nitrogen but lose hydrogen', () => {
    const lamN2 = jeansParameter(M_EARTH, R_EARTH, 255, 28);
    const lamH2 = jeansParameter(M_EARTH, R_EARTH, 255, 2);
    expect(lamN2).toBeGreaterThan(100);
    expect(lamH2).toBeLessThan(lamN2 / 10);
  });
  it('leaves the Moon below the retention threshold for nitrogen', () => {
    // lambda < ~30 means thermal escape strips the species over geological
    // time. The Moon (7.35e22 kg, 1738 km, ~390 K subsolar) fails it.
    expect(jeansParameter(7.35e22, 1.738e6, 390, 28)).toBeLessThan(30);
  });

  it('puts Mercury above the *thermal* threshold, as it really is', () => {
    // Mercury's lambda for N2 is ~44: it did not lose its atmosphere to Jeans
    // escape but to solar wind stripping and impact erosion, which this model
    // does not attempt. Worth pinning so the number is not mistaken for one.
    const lam = jeansParameter(3.3e23, 2.44e6, 700, 28);
    expect(lam).toBeGreaterThan(35);
    expect(lam).toBeLessThan(55);
  });
});

describe('planetary systems', () => {
  const sun = makeStar(1, 4.6, 0);
  const systems = Array.from({ length: 40 }, (_, i) => buildSystem(sun, 1000 + i * 13, 'Test'));

  it('always produces planets around a sunlike star', () => {
    for (const s of systems) expect(s.planets.length).toBeGreaterThan(0);
  });

  it('orders planets outward and keeps them dynamically separated', () => {
    for (const s of systems) {
      for (let i = 1; i < s.planets.length; i++) {
        expect(s.planets[i].au).toBeGreaterThan(s.planets[i - 1].au);
        // Mutual Hill separation should keep adjacent orbits well apart
        expect(s.planets[i].au / s.planets[i - 1].au).toBeGreaterThan(1.03);
      }
    }
  });

  it('gives every planet self-consistent bulk properties', () => {
    for (const s of systems) {
      for (const p of s.planets) {
        const rho = p.massKg / ((4 / 3) * Math.PI * p.radiusM ** 3);
        expect(p.density).toBeCloseTo(rho, 5);
        expect(p.gravity).toBeGreaterThan(0);
        expect(p.escapeVelocity).toBeGreaterThan(0);
        // An atmosphere can only ever warm the ground it sits under, so the
        // greenhouse is never negative. The surface temperature itself is
        // *not* bounded below by the equilibrium temperature: on a world with
        // no air to move heat around, the area-weighted mean sits below it,
        // because emission goes as the fourth power and the hot side does all
        // the radiating.
        expect(p.greenhouseK).toBeGreaterThanOrEqual(-1e-6);
        expect(p.surfaceK).toBeGreaterThan(0);
        expect(Number.isFinite(p.periodS)).toBe(true);
      }
    }
  });

  it('reproduces Kepler\'s third law for the generated orbits', () => {
    for (const s of systems.slice(0, 5)) {
      for (const p of s.planets) {
        const yrs = p.periodS / 3.15576e7;
        // T^2 = a^3 for a solar-mass primary, in years and AU
        expect(yrs * yrs).toBeCloseTo(Math.pow(p.au, 3), 1);
      }
    }
  });

  it('puts giants beyond the snow line unless they migrated', () => {
    let outside = 0, total = 0;
    for (const s of systems) {
      for (const p of s.planets) {
        if (p.massKg > 60 * M_EARTH) { total++; if (p.au > s.snowLineAu * 0.9) outside++; }
      }
    }
    if (total > 0) expect(outside / total).toBeGreaterThan(0.5);
  });

  it('only calls a world habitable if it really could hold liquid water', () => {
    for (const s of systems) {
      for (const p of s.planets) {
        if (!p.habitable) continue;
        expect(p.surfaceK).toBeGreaterThan(255);
        expect(p.surfaceK).toBeLessThan(340);
        expect(p.oceanFraction).toBeGreaterThan(0);
        expect(p.pressureBar).toBeGreaterThan(0.05);
        expect(p.massKg / M_EARTH).toBeLessThan(12);
      }
    }
  });

  it('keeps moons inside the Hill sphere and outside the Roche limit', () => {
    for (const s of systems) {
      for (const p of s.planets) {
        const hill = p.au * AU * Math.cbrt(p.massKg / (3 * M_SUN));
        for (const m of p.moons) {
          expect(m.a).toBeLessThan(hill);
          expect(m.a).toBeGreaterThan(p.radiusM);
        }
      }
    }
  });

  it('is deterministic', () => {
    const a = buildSystem(sun, 4242, 'X');
    const b = buildSystem(sun, 4242, 'X');
    expect(a.planets.map((p) => p.au)).toEqual(b.planets.map((p) => p.au));
    expect(a.planets.map((p) => p.cls)).toEqual(b.planets.map((p) => p.cls));
  });

  it('gives a red dwarf a compact habitable zone', () => {
    const m = makeStar(0.2, 5, 0);
    expect(m.habitableZoneAu[1]).toBeLessThan(0.35);
    const sys = buildSystem(m, 7, 'M');
    expect(sys.snowLineAu).toBeLessThan(0.8);
  });
});

describe('galaxies', () => {
  const halos = [1e11, 1e12, 3e12, 1e13, 1e14];
  const gals = halos.map((h, i) => galaxyFromHalo(500 + i, h, 0));

  it('follows the stellar-to-halo mass relation with a peak near 1e12', () => {
    const eff = gals.map((g, i) => g.stellarMassMsun / halos[i]);
    const peak = eff.indexOf(Math.max(...eff));
    expect(halos[peak]).toBeGreaterThanOrEqual(1e11);
    expect(halos[peak]).toBeLessThanOrEqual(3e12);
  });

  it('makes more massive galaxies bigger and faster', () => {
    const a = galaxyFromHalo(1, 1e11, 0);
    const b = galaxyFromHalo(1, 1e13, 0);
    expect(b.stellarMassMsun).toBeGreaterThan(a.stellarMassMsun);
    expect(b.vMaxKms).toBeGreaterThan(a.vMaxKms);
    expect(b.discScaleKpc).toBeGreaterThan(a.discScaleKpc);
  });

  it('puts ellipticals in dense environments', () => {
    let field = 0, cluster = 0;
    for (let i = 0; i < 300; i++) {
      if (['E', 'S0'].includes(galaxyFromHalo(i, 3e12, 0).type)) field++;
      if (['E', 'S0'].includes(galaxyFromHalo(i, 3e12, 1).type)) cluster++;
    }
    expect(cluster).toBeGreaterThan(field * 1.5);
  });

  it('has a flat rotation curve, which is the dark matter', () => {
    const g = galaxyFromHalo(9, 1.2e12, 0);
    const v1 = rotationCurve(g, 8);
    const v2 = rotationCurve(g, 20);
    expect(Math.abs(v2 / v1 - 1)).toBeLessThan(0.12);
    const b = buildGalaxy(g, { count: 20000 });
    expect(b.stats.darkMatterFraction).toBeGreaterThan(0.5);
  });

  it('satisfies kappa = sqrt(2) Omega where the curve is flat', () => {
    const g = galaxyFromHalo(11, 1.2e12, 0);
    const r = 4 * g.discScaleKpc;
    const ratio = epicyclicFrequency(g, r) / angularRate(g, r);
    expect(ratio).toBeGreaterThan(1.3);
    expect(ratio).toBeLessThan(1.5);
  });

  it('gives the Milky Way analogue a ~220 Myr rotation at the Sun\'s radius', () => {
    const g = galaxyFromHalo(13, 1.2e12, 0);
    const b = buildGalaxy(g, { count: 20000 });
    expect(b.stats.rotationPeriodMyr).toBeGreaterThan(90);
    expect(b.stats.rotationPeriodMyr).toBeLessThan(420);
  });

  it('emits every population and finite values only', () => {
    const g = galaxyFromHalo(17, 8e11, 0);
    const b = buildGalaxy(g, { count: 60000 });
    const kinds = new Set<number>();
    for (let i = 0; i < b.count; i++) {
      kinds.add(b.star[i * 4 + 3]);
      expect(Number.isFinite(b.orbit[i * 4])).toBe(true);
      expect(Number.isFinite(b.star[i * 4 + 2])).toBe(true);
      expect(b.star[i * 4 + 2]).toBeGreaterThan(0);
    }
    // disc, bulge, halo, HII, young, diffuse disc, diffuse bulge
    expect(kinds.size).toBeGreaterThanOrEqual(5);
  });

  it('turns off main-sequence stars above the turn-off mass', () => {
    expect(massAtLifetime(10)).toBeGreaterThan(0.9);
    expect(massAtLifetime(10)).toBeLessThan(1.2);
    expect(massAtLifetime(1)).toBeGreaterThan(massAtLifetime(10));
  });
});

describe('universe graph', () => {
  const field = generateCosmicWeb({ n: 32, boxMpc: 300, seed: 5, cosmology: PLANCK18 });
  const u = new Universe('TESTSEED', field);

  it('is deterministic across repeated queries', () => {
    const a = u.cluster(0);
    const b = u.cluster(0);
    expect(a.members.length).toBe(b.members.length);
    expect(a.members[0].x).toBe(b.members[0].x);
  });

  it('gives massive haloes more galaxies', () => {
    const sorted = [...field.knots].map((_, i) => u.cluster(i))
      .sort((x, y) => y.massMsun - x.massMsun);
    expect(sorted[0].richness).toBeGreaterThanOrEqual(sorted[sorted.length - 1].richness);
  });

  it('keeps cluster members inside the virial radius', () => {
    const c = u.cluster(0);
    for (const m of c.members) {
      expect(Math.hypot(m.x, m.y, m.z)).toBeLessThanOrEqual(c.radiusMpc * 1.001);
    }
  });

  it('produces a coherent star and system for any index', () => {
    const g = u.galaxy(0, 0);
    for (const i of [0, 1, 7, 99, 1000]) {
      const s = u.star(g, i);
      expect(s.star.massMsun).toBeGreaterThan(0.05);
      expect(Number.isFinite(s.star.teff)).toBe(true);
      expect(s.radiusKpc).toBeGreaterThanOrEqual(0);
      const sys = u.system(g, i);
      expect(sys.system.star.massMsun).toBeCloseTo(s.star.massMsun, 12);
    }
  });

  it('reproduces the same system for the same index', () => {
    const g = u.galaxy(0, 0);
    const a = u.system(g, 42).system;
    const b = u.system(g, 42).system;
    expect(a.planets.map((p) => p.name)).toEqual(b.planets.map((p) => p.name));
  });
});

describe('a star aging off the main sequence', () => {
  it('takes the Sun to the red giant branch tip the models put it at', () => {
    const life = msLifetimeGyr(1);
    // The end of the giant phase in this model.
    const tip = makeStar(1, life * 1.1199, 0);
    expect(tip.kind).toBe('giant');
    expect(tip.luminosityLsun).toBeGreaterThan(1200);
    expect(tip.luminosityLsun).toBeLessThan(4000);
    expect(tip.radiusRsun).toBeGreaterThan(120);
    expect(tip.radiusRsun).toBeLessThan(220);
    // Which is 0.6 to 1 AU: past Mercury and Venus, and close to the Earth.
    expect((tip.radiusRsun * 6.957e8) / 1.495978707e11).toBeGreaterThan(0.55);
    // And the surface temperature that falls out of L and R is the observed one.
    expect(tip.teff).toBeGreaterThan(2800);
    expect(tip.teff).toBeLessThan(3600);
  });

  it('brightens the Sun by a third across its main sequence, as it has', () => {
    const life = msLifetimeGyr(1);
    const zams = makeStar(1, 0.02 * life, 0);
    const now = makeStar(1, 4.6, 0);
    const end = makeStar(1, 0.999 * life, 0);
    expect(now.luminosityLsun / zams.luminosityLsun).toBeGreaterThan(1.1);
    expect(now.luminosityLsun / zams.luminosityLsun).toBeLessThan(1.3);
    expect(end.luminosityLsun / zams.luminosityLsun).toBeGreaterThan(1.5);
  });

  it('leaves a white dwarf that cools, and a black hole from a massive star', () => {
    const wd = makeStar(1, msLifetimeGyr(1) * 1.5, 0);
    expect(wd.kind).toBe('white-dwarf');
    const older = makeStar(1, msLifetimeGyr(1) * 3, 0);
    expect(older.luminosityLsun).toBeLessThan(wd.luminosityLsun);
    expect(makeStar(30, msLifetimeGyr(30) * 2, 0).kind).toBe('black-hole');
  });

  it('moves the habitable zone outward as the star brightens', () => {
    const life = msLifetimeGyr(1);
    const young = habitableZone(makeStar(1, 0.02 * life, 0).luminosityLsun, 5772);
    const giant = makeStar(1, life * 1.08, 0);
    const late = habitableZone(giant.luminosityLsun, giant.teff);
    // By the giant branch the habitable zone is out past Jupiter.
    expect(late[0]).toBeGreaterThan(young[1] * 4);
  });
});
