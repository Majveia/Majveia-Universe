import { describe, it, expect } from 'vitest';
import {
  GASES, LOSCHMIDT, RGB_LAMBDA, gasFor, kingFactor, scaleHeight, numberDensity,
  rayleighBeta, erfcx, chapman, airMass, opticalDepth, transmittance,
  rayleighPhase, miePhase, skyRadiance, sunColourAtSurface, solarDeclination, blocked,
  hourAngle, altAz, daylightFraction, angularRadius, horizonDistance, horizonDip,
  atmosphereOf, type Atmosphere,
} from '../src/astro/sky';
import { R_EARTH, R_SUN, AU, DEG } from '../src/core/constants';

/**
 * The three skies anybody has stood under and measured. Everything below is
 * checked against them rather than against itself.
 */
function make(
  pressureBar: number, surfaceK: number, gravity: number, radiusM: number,
  atmosphere: string, oceanFraction = 0, cloudCover = 0,
): Atmosphere {
  return atmosphereOf({
    pressureBar, surfaceK, gravity, radiusM, atmosphere, oceanFraction, cloudCover,
  } as never);
}
const EARTH = make(1.0, 288, 9.81, R_EARTH, 'N₂/O₂', 0.71, 0.67);
const MARS = make(0.006, 210, 3.71, 3.3895e6, 'CO₂', 0, 0.05);
const VENUS = make(92, 737, 8.87, 6.0518e6, 'CO₂', 0, 1);

describe('the gases', () => {
  it('knows what the air is made of by the label the generator uses', () => {
    expect(gasFor('N₂/O₂').molarMassAmu).toBeCloseTo(28.96, 2);
    expect(gasFor('CO₂').molarMassAmu).toBeCloseTo(44.01, 2);
    expect(gasFor('H₂').molarMassAmu).toBeCloseTo(2.016, 3);
  });

  it('falls back to air rather than to nothing', () => {
    // A sky made of something unlisted is still a sky.
    expect(gasFor('unobtanium').name).toBe('air');
    expect(gasFor('').molarMassAmu).toBeGreaterThan(0);
  });

  it('finds a gas inside a mixture name', () => {
    expect(gasFor('mostly CO₂ with traces').molarMassAmu).toBeCloseTo(44.01, 2);
  });

  it('corrects for molecules that are not spheres', () => {
    // Air is a five per cent effect; CO2 is fifteen.
    expect(kingFactor(0.0279)).toBeCloseTo(1.048, 3);
    expect(kingFactor(0.0805)).toBeCloseTo(1.148, 3);
    expect(kingFactor(0)).toBe(1);
  });

  it('puts Loschmidt where it belongs', () => {
    expect(LOSCHMIDT / 2.6867811e25).toBeCloseTo(1, 6);
  });
});

describe('how much air there is', () => {
  it('gives Earth a scale height of eight and a half kilometres', () => {
    const h = scaleHeight(288, 28.96, 9.81);
    expect(h).toBeGreaterThan(8200);
    expect(h).toBeLessThan(8700);
  });

  it('gives Mars a taller one, because gravity beats temperature', () => {
    // Mars is eighty degrees colder and its air is heavier, and its atmosphere
    // is still the thicker of the two - a third of the gravity does that.
    const mars = scaleHeight(210, 43.34, 3.71);
    expect(mars).toBeGreaterThan(scaleHeight(288, 28.96, 9.81));
    expect(mars).toBeGreaterThan(10000);
    expect(mars).toBeLessThan(12000);
  });

  it('counts the molecules at sea level correctly', () => {
    expect(numberDensity(101325, 288) / 2.548e25).toBeCloseTo(1, 2);
    expect(numberDensity(0, 288)).toBe(0);
  });

  it('returns nothing for a world with no gravity or no gas', () => {
    expect(scaleHeight(288, 28.96, 0)).toBe(0);
    expect(numberDensity(101325, 0)).toBe(0);
  });
});

describe('Rayleigh scattering, from first principles', () => {
  it('reproduces the measured coefficient for air at sea level', () => {
    // 1.15e-5 per metre at 550 nm. This is the number the whole file rests on
    // and nothing in it is fitted to make it come out.
    const b = rayleighBeta(2.548e25, 2.78e-4, kingFactor(0.0279), 550e-9);
    expect(b).toBeGreaterThan(1.10e-5);
    expect(b).toBeLessThan(1.22e-5);
  });

  it('goes as the inverse fourth power of wavelength, which is the sky', () => {
    const N = 2.548e25, r = 2.78e-4, k = kingFactor(0.0279);
    const blue = rayleighBeta(N, r, k, 440e-9);
    const red = rayleighBeta(N, r, k, 680e-9);
    expect(blue / red).toBeCloseTo((680 / 440) ** 4, 1);
    expect(blue / red).toBeGreaterThan(5);
  });

  it('scatters more from carbon dioxide than from air, per molecule', () => {
    const N = 2.548e25;
    const co2 = rayleighBeta(N, GASES.CO2.refractivity, kingFactor(GASES.CO2.depolarisation), 550e-9);
    const air = rayleighBeta(N, GASES.air.refractivity, kingFactor(GASES.air.depolarisation), 550e-9);
    expect(co2 / air).toBeGreaterThan(2.2);
    expect(co2 / air).toBeLessThan(3.2);
  });

  it('barely scatters from hydrogen, which is why a gas giant is not blue for this reason', () => {
    const N = 2.548e25;
    const h2 = rayleighBeta(N, GASES.H2.refractivity, kingFactor(GASES.H2.depolarisation), 550e-9);
    const air = rayleighBeta(N, GASES.air.refractivity, 1.048, 550e-9);
    expect(h2 / air).toBeLessThan(0.35);
  });

  it('is proportional to how much gas is there', () => {
    const a = rayleighBeta(1e25, 2.78e-4, 1.048, 550e-9);
    const b = rayleighBeta(2e25, 2.78e-4, 1.048, 550e-9);
    expect(b / a).toBeCloseTo(2, 9);
    expect(rayleighBeta(0, 2.78e-4, 1.048, 550e-9)).toBe(0);
  });
});

describe('the three skies', () => {
  it('gives Earth a zenith optical depth near a tenth, and a blue sky', () => {
    const t = opticalDepth(EARTH, 0);
    // The measured Rayleigh depth at 550 nm is 0.0973; haze adds a little.
    expect(t[1]).toBeGreaterThan(0.09);
    expect(t[1]).toBeLessThan(0.22);
    // The gas alone scatters blue nearly six times harder than red, which is
    // the entire reason the sky has a colour. Haze is grey and dilutes that,
    // which is also why a hazy day is a paler blue than a clear one.
    expect(EARTH.betaR[2] / EARTH.betaR[0]).toBeGreaterThan(5);
    expect(t[2] / t[0]).toBeGreaterThan(2);
  });

  it('gives Mars almost no Rayleigh sky at all', () => {
    const rayleighOnly = MARS.betaR[1] * MARS.scaleHeightM;
    expect(rayleighOnly).toBeGreaterThan(1e-3);
    expect(rayleighOnly).toBeLessThan(1e-2);
    // Thirty times thinner than Earth's, so at noon the Martian sky would be
    // nearly black if there were nothing in it but gas.
    expect(rayleighOnly).toBeLessThan(EARTH.betaR[1] * EARTH.scaleHeightM * 0.1);
  });

  it('but gives Mars a sky anyway, because of the dust', () => {
    // Dust is what people actually see from the surface of Mars, at an optical
    // depth of about a half.
    const t = opticalDepth(MARS, 0);
    expect(t[1]).toBeGreaterThan(0.1);
    expect(t[1]).toBeLessThan(2);
    // And a dust grain is far larger than a wavelength, so it takes light out
    // of the beam without much caring what colour it is: the Martian sky is
    // near-grey in *extinction*. Its colour is in what it does with the light
    // afterwards, not in how much it removes.
    expect(t[2] / t[0]).toBeGreaterThan(0.9);
    expect(t[2] / t[0]).toBeLessThan(1.15);
  });

  it('makes the surface of Venus a place the Sun has never been seen from', () => {
    const t = opticalDepth(VENUS, 0);
    expect(t[1]).toBeGreaterThan(8);
    // Straight up, on the best day it ever has, at high noon.
    expect(transmittance(VENUS, 0)[1]).toBeLessThan(1e-3);
  });

  it('leaves an airless world with no sky and no dimming', () => {
    const rock = make(0, 200, 1.6, 1.7374e6, 'none');
    expect(opticalDepth(rock, 0)[1]).toBe(0);
    expect(transmittance(rock, 0)[1]).toBe(1);
    expect(skyRadiance(rock, 0.5, 0.5, 0.8)).toEqual([0, 0, 0]);
  });
});

describe('the path through it', () => {
  it('is one air mass straight up', () => {
    expect(chapman(R_EARTH / 8400, 0)).toBeCloseTo(1, 2);
    expect(airMass(EARTH, 0)).toBeCloseTo(1, 2);
  });

  it('is about thirty-five at the horizon, not infinity', () => {
    // sec(z) says infinity, and a sky built on sec(z) has a black wall at
    // sunset. The spherical answer is sqrt(pi X / 2).
    const X = R_EARTH / 8400;
    const m = chapman(X, Math.PI / 2);
    expect(m).toBeCloseTo(Math.sqrt((Math.PI * X) / 2), 1);
    expect(m).toBeGreaterThan(30);
    expect(m).toBeLessThan(40);
  });

  it('tracks the secant where the secant is any good', () => {
    const X = R_EARTH / 8400;
    for (const zdeg of [0, 20, 40, 60, 70]) {
      const z = zdeg * DEG;
      expect(chapman(X, z) / (1 / Math.cos(z))).toBeCloseTo(1, 1);
    }
  });

  it('rises without a jump all the way to the horizon', () => {
    const X = R_EARTH / 8400;
    let prev = 0;
    for (let i = 0; i <= 90; i++) {
      const m = chapman(X, i * DEG);
      expect(m).toBeGreaterThan(prev);
      prev = m;
    }
  });

  it('keeps going past the horizon, which is what twilight is', () => {
    const X = R_EARTH / 8400;
    const horizon = chapman(X, Math.PI / 2);
    // Continuous across the horizon, then climbing steeply.
    expect(chapman(X, Math.PI / 2 + 1e-6) / horizon).toBeCloseTo(1, 4);
    expect(chapman(X, 95 * DEG)).toBeGreaterThan(horizon);
    // Six degrees down is civil twilight, and the air mass by then is enormous
    // - which is why the sun's direct light is gone and only the sky is lit.
    expect(chapman(X, 96 * DEG)).toBeGreaterThan(horizon * 5);
  });

  it('is a shorter walk on a small world with a deep atmosphere', () => {
    // Titan: a tenth of Mars's radius-to-scale-height ratio, so a much gentler
    // horizon and a much less dramatic sunset.
    expect(chapman(80, Math.PI / 2)).toBeLessThan(chapman(R_EARTH / 8400, Math.PI / 2));
    expect(chapman(80, Math.PI / 2)).toBeCloseTo(Math.sqrt((Math.PI * 80) / 2), 5);
  });

  it('is finite and positive everywhere a planet with a surface can look', () => {
    for (const X of [1, 10, 758, 1e4]) {
      for (let d = 0; d <= 91; d += 1) {
        const v = chapman(X, d * DEG);
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThan(0);
      }
    }
  });

  it('diverges for a ray aimed through the middle, which is the right answer', () => {
    // An exponential atmosphere with no floor under it really does have
    // infinite gas along that line. Planets have floors; `blocked` has that.
    expect(chapman(1e4, 150 * DEG)).toBe(Infinity);
    expect(blocked({ radiusM: 6.371e6 } as never, 150 * DEG)).toBe(true);
    expect(blocked({ radiusM: 6.371e6 } as never, 80 * DEG)).toBe(false);
  });
});

describe('the scaled error function it is built on', () => {
  it('is one at zero', () => {
    expect(erfcx(0)).toBeCloseTo(1, 6);
  });

  it('behaves at the arguments the Chapman function actually uses', () => {
    // erfc(19.5) is 1e-167. Scaled, it is 0.0289, and that is the point.
    expect(erfcx(19.5)).toBeCloseTo(1 / (19.5 * Math.sqrt(Math.PI)) * (1 - 1 / (2 * 19.5 ** 2)), 4);
    expect(Number.isFinite(erfcx(200))).toBe(true);
    expect(erfcx(200)).toBeGreaterThan(0);
  });

  it('matches exp(x^2) erfc(x) where erfc is still representable', () => {
    // erf from a series, for an independent check at small argument.
    const erf = (x: number): number => {
      let sum = 0, term = x;
      for (let n = 0; n < 60; n++) {
        sum += term / (2 * n + 1);
        term *= (-x * x) / (n + 1);
      }
      return (2 / Math.sqrt(Math.PI)) * sum;
    };
    for (const x of [0.25, 0.75, 1.5, 2.5]) {
      expect(erfcx(x) / (Math.exp(x * x) * (1 - erf(x)))).toBeCloseTo(1, 4);
    }
  });

  it('falls monotonically and tends to 1/(x sqrt pi)', () => {
    let prev = Infinity;
    for (const x of [0, 0.5, 1, 2, 5, 20, 100]) {
      const v = erfcx(x);
      expect(v).toBeLessThan(prev);
      prev = v;
    }
    expect(erfcx(1000) * 1000 * Math.sqrt(Math.PI)).toBeCloseTo(1, 3);
  });
});

describe('what the star looks like from the ground', () => {
  it('barely dims it overhead and reddens it at the horizon', () => {
    const white: [number, number, number] = [1, 1, 1];
    const noon = sunColourAtSurface(EARTH, white, 0);
    const set = sunColourAtSurface(EARTH, white, 90 * DEG);
    expect(noon[1]).toBeGreaterThan(0.75);
    // At the horizon the blue is essentially all gone and the red is not.
    expect(set[0] / Math.max(set[2], 1e-12)).toBeGreaterThan(6);
    expect(set[0]).toBeGreaterThan(set[1]);
    expect(set[1]).toBeGreaterThan(set[2]);
  });

  it('dims it monotonically as it goes down', () => {
    let prev = Infinity;
    for (const zdeg of [0, 30, 60, 80, 88, 90]) {
      const v = sunColourAtSurface(EARTH, [1, 1, 1], zdeg * DEG)[1];
      expect(v).toBeLessThan(prev);
      prev = v;
    }
  });

  it('is half a degree wide from Earth', () => {
    expect(angularRadius(R_SUN, AU) / DEG).toBeCloseTo(0.2666, 3);
  });

  it('is wider from a red dwarf, whose habitable zone is close in', () => {
    // 0.15 solar radii at 0.05 AU: nearly three times the Sun's apparent size,
    // and it never moves, because a planet that close is tidally locked.
    expect(angularRadius(0.15 * R_SUN, 0.05 * AU)).toBeGreaterThan(angularRadius(R_SUN, AU) * 2);
  });
});

describe('the sky itself', () => {
  it('is deepest blue ninety degrees from the star, where it always is', () => {
    // The canonical geometry: sun sixty degrees up, looking at a right angle
    // to it. Haze throws light hard forward, so it barely reaches here and
    // what is left is nearly pure Rayleigh.
    const L = skyRadiance(EARTH, 30 * DEG, 60 * DEG, 0);
    expect(L[2]).toBeGreaterThan(L[1]);
    expect(L[1]).toBeGreaterThan(L[0]);
    expect(L[2] / L[0]).toBeGreaterThan(2.5);
  });

  it('is paler close to the star, because that is where the haze throws it', () => {
    const wide = skyRadiance(EARTH, 30 * DEG, 60 * DEG, 0);
    const near = skyRadiance(EARTH, 50 * DEG, 60 * DEG, Math.cos(12 * DEG));
    expect(near[2] / near[0]).toBeLessThan(wide[2] / wide[0]);
  });

  it('is brighter near the star than away from it', () => {
    const near = skyRadiance(EARTH, 40 * DEG, 30 * DEG, Math.cos(10 * DEG));
    const away = skyRadiance(EARTH, 40 * DEG, 30 * DEG, Math.cos(120 * DEG));
    expect(near[1]).toBeGreaterThan(away[1]);
  });

  it('goes dim but not black when the star sets', () => {
    const day = skyRadiance(EARTH, 30 * DEG, 20 * DEG, 0.5)[1];
    const dusk = skyRadiance(EARTH, 30 * DEG, 92 * DEG, 0.5)[1];
    expect(dusk).toBeLessThan(day * 0.5);
    expect(dusk).toBeGreaterThan(0);
    // And by deep twilight there is almost nothing left.
    const night = skyRadiance(EARTH, 30 * DEG, 110 * DEG, 0.5)[1];
    expect(night).toBeLessThan(dusk * 0.2);
  });

  it('is redder near the horizon than overhead, with the star low', () => {
    const up = skyRadiance(EARTH, 5 * DEG, 80 * DEG, 0.3);
    const low = skyRadiance(EARTH, 87 * DEG, 80 * DEG, 0.3);
    expect(low[0] / low[2]).toBeGreaterThan(up[0] / up[2]);
  });

  it('scatters about as efficiently on Mars as on Earth, and is dimmer anyway', () => {
    // A surprise worth keeping. Half an optical depth of dust scatters roughly
    // as much light sideways as a tenth of an optical depth of air does, so
    // per unit of sunlight arriving, the two skies are comparable. The Martian
    // sky is dimmer for a quite different reason: Mars is half as close again
    // to the Sun, and gets 587 watts per square metre against Earth's 1361.
    const earth = skyRadiance(EARTH, 30 * DEG, 60 * DEG, 0)[1];
    const mars = skyRadiance(MARS, 30 * DEG, 60 * DEG, 0)[1];
    expect(mars / earth).toBeGreaterThan(0.4);
    expect(mars / earth).toBeLessThan(2.5);
    expect(mars * 587).toBeLessThan(earth * 1361);
  });

  it('is warmer on Mars than on Earth, because it is dust and not gas', () => {
    const mars = skyRadiance(MARS, 25 * DEG, 40 * DEG, 0.7);
    const earth = skyRadiance(EARTH, 25 * DEG, 40 * DEG, 0.7);
    expect(mars[0] / mars[2]).toBeGreaterThan(earth[0] / earth[2]);
    // Butterscotch: more red than blue reaches you, because the rust in the
    // dust absorbed the blue on the way.
    expect(mars[0]).toBeGreaterThan(mars[2]);
    expect(earth[2]).toBeGreaterThan(earth[0]);
  });

  it('never returns a negative or a NaN, on any world at any angle', () => {
    for (const a of [EARTH, MARS, VENUS]) {
      for (let vz = 0; vz <= 90; vz += 15) {
        for (let sz = 0; sz <= 130; sz += 20) {
          const L = skyRadiance(a, vz * DEG, sz * DEG, 0.4, 8);
          for (const c of L) {
            expect(Number.isFinite(c)).toBe(true);
            expect(c).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });
});

describe('the phase functions', () => {
  it('sends Rayleigh light forward and back equally', () => {
    expect(rayleighPhase(1)).toBeCloseTo(rayleighPhase(-1), 12);
    expect(rayleighPhase(1) / rayleighPhase(0)).toBeCloseTo(2, 9);
  });

  it('integrates Rayleigh to one over the sphere', () => {
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const mu = -1 + (2 * (i + 0.5)) / n;
      sum += rayleighPhase(mu) * 2 * Math.PI * (2 / n);
    }
    expect(sum).toBeCloseTo(1, 5);
  });

  it('integrates Henyey-Greenstein to one as well, for any asymmetry', () => {
    for (const g of [0, 0.4, 0.76]) {
      let sum = 0;
      const n = 400000;
      for (let i = 0; i < n; i++) {
        const mu = -1 + (2 * (i + 0.5)) / n;
        sum += miePhase(mu, g) * 2 * Math.PI * (2 / n);
      }
      expect(sum).toBeCloseTo(1, 2);
    }
  });

  it('throws haze light hard forward, which is why the sun has a halo round it', () => {
    expect(miePhase(1, 0.76) / miePhase(-1, 0.76)).toBeGreaterThan(100);
    expect(miePhase(1, 0) / miePhase(-1, 0)).toBeCloseTo(1, 9);
  });
});

describe('where the star is', () => {
  it('gives a world with no tilt no seasons at all', () => {
    for (const f of [0, 0.1, 0.25, 0.5, 0.9]) {
      expect(solarDeclination(0, f)).toBeCloseTo(0, 12);
    }
  });

  it('swings between the tropics over a year, for a world with tilt', () => {
    const tilt = 23.44 * DEG;
    expect(solarDeclination(tilt, 0)).toBeCloseTo(0, 9);           // spring
    expect(solarDeclination(tilt, 0.25) / DEG).toBeCloseTo(23.44, 4); // midsummer
    expect(solarDeclination(tilt, 0.5)).toBeCloseTo(0, 9);         // autumn
    expect(solarDeclination(tilt, 0.75) / DEG).toBeCloseTo(-23.44, 4);
  });

  it('puts the star overhead at the equator at noon at equinox', () => {
    const { altitude } = altAz(0, 0, hourAngle(0.5));
    expect(altitude / DEG).toBeCloseTo(90, 6);
  });

  it('puts it on the horizon at sunrise and sunset there', () => {
    expect(altAz(0, 0, hourAngle(0.25)).altitude).toBeCloseTo(0, 9);
    expect(altAz(0, 0, hourAngle(0.75)).altitude).toBeCloseTo(0, 9);
  });

  it('never lifts it above the tilt at the pole', () => {
    const tilt = 23.44 * DEG;
    const dec = solarDeclination(tilt, 0.25);
    for (let f = 0; f < 1; f += 0.05) {
      const alt = altAz(Math.PI / 2, dec, hourAngle(f)).altitude;
      expect(alt / DEG).toBeLessThan(23.5);
      // But it never sets, either: midsummer at the pole is one long day.
      expect(alt).toBeGreaterThan(0);
    }
  });

  it('runs the hour angle from noon, through midnight, and back', () => {
    expect(hourAngle(0.5)).toBeCloseTo(0, 12);
    expect(Math.abs(hourAngle(0))).toBeCloseTo(Math.PI, 12);
    expect(hourAngle(0.75)).toBeCloseTo(Math.PI / 2, 12);
    for (let f = 0; f <= 1; f += 0.05) {
      expect(Math.abs(hourAngle(f))).toBeLessThanOrEqual(Math.PI + 1e-12);
    }
  });

  it('gives twelve hours everywhere at equinox', () => {
    for (const lat of [-60, -20, 0, 35, 70]) {
      expect(daylightFraction(lat * DEG, 0)).toBeCloseTo(0.5, 9);
    }
  });

  it('gives midnight sun above the arctic circle and none in winter', () => {
    const tilt = 23.44 * DEG;
    const summer = solarDeclination(tilt, 0.25);
    const winter = solarDeclination(tilt, 0.75);
    expect(daylightFraction(70 * DEG, summer)).toBe(1);
    expect(daylightFraction(70 * DEG, winter)).toBe(0);
    // And the circle really is at 90 minus the tilt.
    expect(daylightFraction(66 * DEG, summer)).toBeLessThan(1);
    expect(daylightFraction(67 * DEG, summer)).toBe(1);
  });

  it('lengthens the day toward the summer pole, monotonically', () => {
    const dec = 20 * DEG;
    let prev = 0;
    for (const lat of [-40, -20, 0, 20, 40, 60]) {
      const d = daylightFraction(lat * DEG, dec);
      expect(d).toBeGreaterThan(prev);
      prev = d;
    }
  });
});

describe('the edge of the world', () => {
  it('puts Earth’s horizon five kilometres away from eye level', () => {
    const d = horizonDistance(R_EARTH, 1.7);
    expect(d).toBeGreaterThan(4000);
    expect(d).toBeLessThan(6000);
  });

  it('brings it much closer on a small world', () => {
    // On a Mars-sized world it is under four kilometres; on a big asteroid you
    // can see the ground curve away.
    expect(horizonDistance(3.39e6, 1.7)).toBeLessThan(horizonDistance(R_EARTH, 1.7));
    expect(horizonDistance(5e5, 1.7)).toBeLessThan(1500);
  });

  it('dips the horizon further the higher you stand', () => {
    expect(horizonDip(R_EARTH, 0)).toBe(0);
    const low = horizonDip(R_EARTH, 2);
    const high = horizonDip(R_EARTH, 10000);
    expect(high).toBeGreaterThan(low);
    // From ten kilometres up it is about three degrees, which is why it looks
    // curved from an aeroplane and does not from the beach.
    expect(high / DEG).toBeGreaterThan(2.5);
    expect(high / DEG).toBeLessThan(3.5);
    expect(low / DEG).toBeLessThan(0.1);
  });

  it('grows as the square root of height', () => {
    expect(horizonDistance(R_EARTH, 400) / horizonDistance(R_EARTH, 100)).toBeCloseTo(2, 2);
  });
});

describe('an atmosphere built from a planet', () => {
  it('gives a wet world haze and a dry one dust', () => {
    const wet = make(1, 288, 9.8, R_EARTH, 'N₂/O₂', 0.7, 0.6);
    const dry = make(1, 288, 9.8, R_EARTH, 'N₂/O₂', 0, 0.1);
    // Dust absorbs blue; water droplets absorb nothing worth mentioning.
    expect(dry.aerosolAlbedo[2]).toBeLessThan(wet.aerosolAlbedo[2]);
    expect(wet.aerosolAlbedo[2]).toBeGreaterThan(0.9);
    // And it absorbs blue harder than red, which is the whole of its colour.
    expect(dry.aerosolAlbedo[2]).toBeLessThan(dry.aerosolAlbedo[0]);
  });

  it('keeps the aerosol close to the ground, where it belongs', () => {
    expect(EARTH.aerosolScaleHeightM).toBeLessThan(EARTH.scaleHeightM);
    expect(MARS.aerosolScaleHeightM).toBeLessThan(MARS.scaleHeightM);
  });

  it('gives an airless world nothing at all', () => {
    const rock = make(0, 120, 1.6, 1.7e6, 'none');
    expect(rock.numberDensity).toBe(0);
    expect(rock.betaR[1]).toBe(0);
    expect(rock.betaM).toBe(0);
  });

  it('never produces a NaN, whatever the planet', () => {
    const cases: [number, number, number, number, string, number, number][] = [
      [0, 50, 0.5, 1e6, 'none', 0, 0],
      [1e-6, 90, 1.3, 2.4e6, 'CH₄', 0, 0],
      [1.5, 288, 11.2, 7e6, 'N₂/O₂', 0.9, 0.5],
      [92, 737, 8.9, 6e6, 'CO₂', 0, 1],
      [1000, 1400, 25, 7e7, 'H₂', 0, 1],
    ];
    for (const c of cases) {
      const a = make(...c);
      for (const v of [a.scaleHeightM, a.numberDensity, a.betaM,
        ...a.betaR, ...a.aerosolAlbedo, a.aerosolG, a.aerosolScaleHeightM]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
      for (const z of [0, 45, 89.9, 90]) {
        for (const v of opticalDepth(a, z * DEG)) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
        }
      }
      // Below the horizon a ray from the surface runs into the planet, and
      // infinite optical depth is the correct answer rather than a failure.
      if (a.pressurePa > 0) {
        expect(opticalDepth(a, 120 * DEG)[1]).toBe(Infinity);
        expect(transmittance(a, 120 * DEG)[1]).toBe(0);
      }
    }
  });

  it('uses the three wavelengths it says it does', () => {
    expect(RGB_LAMBDA[0]).toBeGreaterThan(RGB_LAMBDA[1]);
    expect(RGB_LAMBDA[1]).toBeGreaterThan(RGB_LAMBDA[2]);
    expect(EARTH.betaR[2]).toBeGreaterThan(EARTH.betaR[0]);
  });
});

describe('which way round the sky is', () => {
  const DEG2 = Math.PI / 180;
  const az = (lat: number, dec: number, h: number): number =>
    ((altAz(lat, dec, h).azimuth * 180) / Math.PI + 360) % 360;

  it('transits the sun in the south for a northern observer', () => {
    // London at midsummer noon: the sun is 62 degrees up and due south. It has
    // never once been due north from there.
    const p = altAz(51.5 * DEG2, 23.44 * DEG2, 0);
    expect((p.altitude * 180) / Math.PI).toBeCloseTo(61.9, 0);
    expect(az(51.5 * DEG2, 23.44 * DEG2, 0)).toBeCloseTo(180, 3);
  });

  it('transits it in the north for a southern observer', () => {
    // And the other way round below the equator, which is why a sundial bought
    // in Europe reads backwards in Australia.
    expect(az(-33.9 * DEG2, -23.44 * DEG2, 0)).toBeCloseTo(0, 3);
  });

  it('rises in the east and sets in the west', () => {
    const rise = az(45 * DEG2, 0, -Math.PI / 2);
    const set = az(45 * DEG2, 0, Math.PI / 2);
    expect(rise).toBeCloseTo(90, 3);
    expect(set).toBeCloseTo(270, 3);
  });

  it('crosses the southern sky between them, not the northern one', () => {
    // The test that catches a mirrored sky: the arc from sunrise to sunset has
    // to pass through the south, so the azimuth runs 90 -> 180 -> 270 and
    // never anywhere near zero.
    for (let h = -1.4; h <= 1.4; h += 0.2) {
      const a = az(45 * DEG2, 10 * DEG2, h);
      expect(a).toBeGreaterThan(60);
      expect(a).toBeLessThan(300);
    }
  });

  it('puts the sun over the equator at the equinox, whatever the latitude', () => {
    for (const lat of [-60, -20, 0, 35, 70]) {
      expect(az(lat * DEG2, 0, -0.4)).toBeGreaterThan(0);
      expect(az(lat * DEG2, 0, -0.4)).toBeLessThan(180);
    }
  });
});
