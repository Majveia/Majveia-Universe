import { describe, it, expect } from 'vitest';
import {
  dailyInsolation, annualMeanInsolation, globalMeanInsolation, sunsetHourAngle,
  declination, polarCrossoverObliquity, longitudeAt, timeAtLongitude, irradiance,
  SOLAR_CONSTANT,
} from '../src/astro/insolation';
import {
  saturationVapourPressure, outgoingLongwave, radiativeDamping,
  equilibriumSurfaceTemperature, greenhouseWarming, liquidWaterPossible,
  moistLapseRate, dryLapseRate, scaleHeight, planetaryAlbedo, rayleighAlbedo,
  EARTH_AIR, RUNAWAY_GREENHOUSE_LIMIT, T_FREEZE, type Atmosphere,
} from '../src/astro/radiation';
import {
  solveClimate, globalBalance, transportCoefficient, bandCapacity, carbonCycle,
  thermostatSetpoint, outgassingRate, sampleClimate, seasonalIceEdge,
  condensationTemperature,
} from '../src/astro/climate';
import {
  circulation, hadleyEdge, zonalWind, precipitation, angularVelocity,
} from '../src/astro/circulation';
import { solarSystem } from '../src/astro/solsystem';
import { buildSystem } from '../src/astro/planets';
import { makeStar } from '../src/astro/stellar';
import { DEG, DAY, YEAR, M_EARTH, R_EARTH } from '../src/core/constants';

// Earth's orbit, so the checks below are against a world we have measured.
const EARTH_ORBIT = { obliquity: 23.44 * DEG, e: 0.016708, precession: 282.9 * DEG };

const earthInputs = {
  irradiance: SOLAR_CONSTANT, periodS: YEAR, dayS: DAY,
  obliquity: EARTH_ORBIT.obliquity, eccentricity: EARTH_ORBIT.e,
  precession: EARTH_ORBIT.precession, atmosphere: EARTH_AIR,
  gravity: 9.80665, radiusM: R_EARTH, oceanFraction: 0.708,
  // The ice-free Bond albedo: Earth's measured 0.306 already counts its caps.
  albedo: 0.29, tidallyLocked: false, starTeff: 5772,
};

describe('insolation', () => {
  it('gives the global annual mean as S/4', () => {
    expect(globalMeanInsolation(SOLAR_CONSTANT, 0)).toBeCloseTo(340.25, 1);
  });

  it('is very slightly raised by eccentricity, as 1/sqrt(1-e^2)', () => {
    const circular = globalMeanInsolation(SOLAR_CONSTANT, 0);
    const eccentric = globalMeanInsolation(SOLAR_CONSTANT, 0.5);
    expect(eccentric / circular).toBeCloseTo(1 / Math.sqrt(1 - 0.25), 6);
  });

  it('makes the summer pole the sunniest place on Earth', () => {
    // 24 hours of slanted sun beats 12 hours of overhead sun. The north pole
    // gets about 520 W/m^2 in daily mean at the June solstice; the equator
    // never exceeds 440.
    const pole = dailyInsolation(SOLAR_CONSTANT, 90 * DEG, 90 * DEG, EARTH_ORBIT);
    expect(pole).toBeGreaterThan(500);
    expect(pole).toBeLessThan(545);
    let equatorMax = 0;
    for (let l = 0; l < 360; l += 2) {
      equatorMax = Math.max(equatorMax, dailyInsolation(SOLAR_CONSTANT, 0, l * DEG, EARTH_ORBIT));
    }
    expect(equatorMax).toBeLessThan(pole);
  });

  it('puts the whole winter pole in the dark', () => {
    expect(dailyInsolation(SOLAR_CONSTANT, 80 * DEG, 270 * DEG, EARTH_ORBIT)).toBe(0);
    expect(sunsetHourAngle(80 * DEG, declination(270 * DEG, 23.44 * DEG))).toBe(0);
  });

  it('gives the equator four times the annual mean the pole gets', () => {
    const eq = annualMeanInsolation(SOLAR_CONSTANT, 0, EARTH_ORBIT);
    const pole = annualMeanInsolation(SOLAR_CONSTANT, 89.9 * DEG, EARTH_ORBIT);
    expect(eq).toBeCloseTo(416, -1);
    expect(pole).toBeCloseTo(173, -1);
  });

  it('inverts the gradient above 54 degrees of tilt', () => {
    // The famous crossover: past it, the poles get more sunlight over a year
    // than the equator does, and a world's ice - if it has any - is tropical.
    expect(polarCrossoverObliquity(0) / DEG).toBeCloseTo(54, 0);
    const tilted = { obliquity: 75 * DEG, e: 0, precession: 0 };
    expect(annualMeanInsolation(1, 89.9 * DEG, tilted))
      .toBeGreaterThan(annualMeanInsolation(1, 0, tilted));
  });

  it('round-trips time against orbital longitude', () => {
    for (const lambda of [0.3, 1.9, 4.4, 6.0]) {
      const t = timeAtLongitude(lambda, YEAR, EARTH_ORBIT);
      const back = longitudeAt(t, YEAR, EARTH_ORBIT);
      expect(Math.cos(back - lambda)).toBeCloseTo(1, 6);
    }
  });

  it('gives Earth 1361 W/m^2 at 1 AU', () => {
    expect(irradiance(1, 1)).toBeCloseTo(1361, -1);
  });
});

describe('outgoing radiation', () => {
  it('reproduces the saturation vapour pressure of water', () => {
    // The Magnus form is good to a tenth of a per cent between -40 and +50 C,
    // which is where a habitable planet's weather lives, and drifts to a few
    // per cent by boiling. Both are checked at the accuracy it claims.
    expect(saturationVapourPressure(T_FREEZE)).toBeCloseTo(611, -1);   // triple point
    expect(saturationVapourPressure(293.15)).toBeCloseTo(2339, -2);    // room temperature
    expect(saturationVapourPressure(373.15) / 101325).toBeCloseTo(1, 1);  // boiling
    // Ice has the lower vapour pressure, which is why snow grows at the
    // expense of supercooled cloud droplets and most of Earth's rain starts
    // as snow.
    expect(saturationVapourPressure(T_FREEZE - 10))
      .toBeLessThan(611.2 * Math.exp((17.62 * -10) / (T_FREEZE - 10 - 30.03)));
  });

  it('balances Earth at 288 K against 239 W/m^2', () => {
    expect(outgoingLongwave(288, EARTH_AIR)).toBeCloseTo(239, -1);
    expect(equilibriumSurfaceTemperature(239, EARTH_AIR)).toBeCloseTo(288, 0);
  });

  it('gives Earth its 33 K greenhouse', () => {
    expect(greenhouseWarming(239, EARTH_AIR)).toBeGreaterThan(30);
    expect(greenhouseWarming(239, EARTH_AIR)).toBeLessThan(36);
  });

  it('has water vapour eat most of the planet\'s ability to cool itself', () => {
    // A transparent atmosphere would give 4 sigma T^3 = 5.4 W/m^2/K. The
    // observed value is near 2, and the difference is the water vapour that
    // Clausius-Clapeyron adds as the surface warms.
    const damping = radiativeDamping(288, EARTH_AIR);
    expect(damping).toBeGreaterThan(1.4);
    expect(damping).toBeLessThan(2.6);
    const dry: Atmosphere = { ...EARTH_AIR, water: false };
    expect(radiativeDamping(288, dry)).toBeGreaterThan(damping * 1.5);
  });

  it('cannot radiate past the Simpson-Nakajima limit with an ocean present', () => {
    let peak = 0;
    for (let t = 200; t < 900; t += 1) peak = Math.max(peak, outgoingLongwave(t, EARTH_AIR));
    expect(peak).toBeLessThanOrEqual(RUNAWAY_GREENHOUSE_LIMIT + 0.5);
    expect(peak).toBeGreaterThan(RUNAWAY_GREENHOUSE_LIMIT - 5);
    // Absorb more than that and there is no equilibrium at any temperature.
    expect(equilibriumSurfaceTemperature(RUNAWAY_GREENHOUSE_LIMIT + 20, EARTH_AIR)).toBeNull();
    // Take the water away and the ceiling goes with it: Venus is stable at
    // 737 K precisely because it has nothing left to boil.
    expect(equilibriumSurfaceTemperature(400, { ...EARTH_AIR, water: false })).not.toBeNull();
  });

  it('predicts Mars and Titan from two parameters fitted to Earth and Venus', () => {
    const venus: Atmosphere = {
      pressureBar: 92, greenhouseFraction: 0.965, molarMass: 43.45, cp: 850,
      water: false, humidity: 0,
    };
    // Fitted: Venus's 505 K greenhouse and Earth's 33 K.
    expect(equilibriumSurfaceTemperature(2601.3 * (1 - 0.76) / 4, venus)).toBeCloseTo(737, -1);

    // Predicted: Mars's is small, and its surface is within a few K of the
    // temperature it radiates at.
    const mars: Atmosphere = {
      pressureBar: 0.00636, greenhouseFraction: 0.953, molarMass: 43.34, cp: 736,
      water: false, humidity: 0,
    };
    expect(greenhouseWarming(586.2 * (1 - 0.25) / 4, mars)).toBeLessThan(8);
    expect(greenhouseWarming(586.2 * (1 - 0.25) / 4, mars)).toBeGreaterThan(1);

    // Predicted: Titan's is about 20 K. The measured surface is 9 K cooler
    // still, because its haze absorbs sunlight far above the ground - an
    // anti-greenhouse this model does not carry.
    const titan: Atmosphere = {
      pressureBar: 1.47, greenhouseFraction: 0.05, molarMass: 28, cp: 1040,
      water: false, humidity: 0,
    };
    const ts = equilibriumSurfaceTemperature(14.82 * (1 - 0.265) / 4, titan)!;
    expect(ts).toBeGreaterThan(94);
    expect(ts).toBeLessThan(112);
  });

  it('knows where liquid water can and cannot exist', () => {
    expect(liquidWaterPossible(300, 1)).toBe(true);
    expect(liquidWaterPossible(260, 1)).toBe(false);          // frozen
    expect(liquidWaterPossible(300, 0.005)).toBe(false);      // Mars: it sublimates
    expect(liquidWaterPossible(700, 100)).toBe(false);        // past the critical point
  });

  it('makes a thick sky bright, over any ground', () => {
    expect(rayleighAlbedo(1)).toBeLessThan(0.1);
    expect(rayleighAlbedo(20)).toBeGreaterThan(rayleighAlbedo(5));
    // A scattering layer over dark ground is brighter than the ground alone,
    // but never brighter than the two combined can be.
    expect(planetaryAlbedo(0.1, 10)).toBeGreaterThan(0.1);
    expect(planetaryAlbedo(0.3, 0.001)).toBeCloseTo(0.3, 2);
    expect(planetaryAlbedo(0.3, 30)).toBeLessThan(0.95);
  });
});

describe('the air column', () => {
  it('gives Earth a 9.8 K/km dry adiabat and a 6.5 K/km moist one', () => {
    expect(dryLapseRate(9.80665, 1004) * 1000).toBeCloseTo(9.8, 1);
    expect(moistLapseRate(9.80665, 288, 1) * 1000).toBeGreaterThan(4.5);
    expect(moistLapseRate(9.80665, 288, 1) * 1000).toBeLessThan(7.5);
  });

  it('gives Earth an 8.4 km scale height', () => {
    expect(scaleHeight(288, 9.80665, 28.97) / 1000).toBeCloseTo(8.4, 0);
  });
});

describe('meridional transport', () => {
  it('recovers Earth\'s 0.58 W/m^2/K', () => {
    expect(transportCoefficient(EARTH_AIR, DAY)).toBeCloseTo(0.58, 1);
  });

  it('makes a slow rotator nearly isothermal', () => {
    // Transport goes as 1/Omega^2, so Venus - one turn in 243 days - moves
    // heat about sixty thousand times as efficiently as Earth for its mass of
    // air, and has no temperature gradient worth the name.
    const venusAir: Atmosphere = {
      pressureBar: 92, greenhouseFraction: 0.965, molarMass: 43.45, cp: 850,
      water: false, humidity: 0,
    };
    expect(transportCoefficient(venusAir, 243 * DAY))
      .toBeGreaterThan(transportCoefficient(EARTH_AIR, DAY) * 100);
  });

  it('gives the sea twenty times the thermal inertia of the land', () => {
    const sea = bandCapacity(EARTH_AIR, 9.81, 1, false);
    const land = bandCapacity(EARTH_AIR, 9.81, 0, false);
    expect(sea / land).toBeGreaterThan(10);
    // Freeze it over and most of that inertia is cut off by the ice.
    expect(bandCapacity(EARTH_AIR, 9.81, 1, true)).toBeLessThan(sea / 5);
  });
});

describe('the energy balance model', () => {
  const earth = solveClimate(earthInputs);

  it('gives Earth Earth\'s climate', () => {
    expect(earth.meanK).toBeGreaterThan(281);
    expect(earth.meanK).toBeLessThan(292);
    // Equator to pole: the observed annual-mean difference is about 45 K.
    expect(earth.gradientK).toBeGreaterThan(33);
    expect(earth.gradientK).toBeLessThan(55);
    expect(earth.state).toBe('temperate');
    expect(earth.effectiveK).toBeGreaterThan(245);
    expect(earth.effectiveK).toBeLessThan(262);
  });

  it('puts the equator near 300 K and the poles near 260', () => {
    const equator = earth.bands[Math.floor(earth.bandCount / 2)];
    expect(equator.meanK).toBeGreaterThan(292);
    expect(equator.meanK).toBeLessThan(306);
    expect(earth.bands[0].meanK).toBeLessThan(272);
  });

  it('gives a continent three times the seasonal swing of an ocean', () => {
    // The difference between Winnipeg and Vancouver, and it comes entirely
    // from fifty metres of water against a column of air.
    const continental = solveClimate({ ...earthInputs, oceanFraction: 0.05 });
    const waterworld = solveClimate({ ...earthInputs, oceanFraction: 1 });
    expect(continental.seasonalK).toBeGreaterThan(waterworld.seasonalK * 3);
  });

  it('has two stable climates for one planet - and Earth is a planet', () => {
    // Budyko and Sellers, 1969. Nothing in the model is told to do this; it
    // falls out of an albedo that depends on the temperature it helps set.
    const fromWarm = solveClimate(earthInputs);
    const fromFrozen = solveClimate({ ...earthInputs, initialK: 220 });
    expect(fromWarm.state).toBe('temperate');
    expect(fromFrozen.iceFraction).toBeGreaterThan(0.9);
    expect(fromWarm.meanK - fromFrozen.meanK).toBeGreaterThan(40);

    // And the zero-dimensional version counts the equilibria directly.
    const model = { warm: 0.29, ice: 0.62, width: 8 };
    expect(globalBalance(SOLAR_CONSTANT, 0.0167, model, EARTH_AIR).equilibria)
      .toBeGreaterThanOrEqual(2);
  });

  it('collapses to a snowball below a threshold, and stays there above it', () => {
    const at = (f: number, start?: number) =>
      solveClimate({ ...earthInputs, irradiance: SOLAR_CONSTANT * f, initialK: start });
    // Dimming past the bifurcation destroys the temperate branch entirely.
    expect(at(1.0).state).toBe('temperate');
    expect(at(0.9).iceFraction).toBeGreaterThan(0.9);
    // Coming back up, the frozen branch survives where the warm one lives.
    expect(at(1.0, 220).iceFraction).toBeGreaterThan(0.9);
  });

  it('boils Earth\'s oceans if it is moved inwards', () => {
    const at = (au: number) =>
      solveClimate({ ...earthInputs, irradiance: SOLAR_CONSTANT / (au * au) });
    expect(at(1.0).state).toBe('temperate');
    expect(at(0.95).state).toBe('temperate');
    expect(at(0.85).state).toBe('runaway');
  });

  it('makes an airless world hot on one side and cold on the other', () => {
    const rock = solveClimate({
      ...earthInputs, oceanFraction: 0, albedo: 0.12,
      atmosphere: { pressureBar: 0, greenhouseFraction: 0, molarMass: 28, cp: 1004, water: false, humidity: 0 },
    });
    expect(rock.state).toBe('airless');
    expect(rock.gradientK).toBeGreaterThan(60);
    expect(rock.iceFraction).toBe(0);       // cold is not the same as icy
    expect(rock.circulation.windSpeed).toBe(0);
  });

  it('warms the poles above the equator on a strongly tilted world', () => {
    const tilted = solveClimate({ ...earthInputs, obliquity: 75 * DEG });
    expect(tilted.gradientK).toBeLessThan(0);
  });

  it('needs a tenth of a bar to keep a locked world\'s air off the ground', () => {
    const locked = (p: number) => solveClimate({
      ...earthInputs, tidallyLocked: true, dayS: 11 * DAY, periodS: 11 * DAY,
      obliquity: 0, eccentricity: 0, atmosphere: { ...EARTH_AIR, pressureBar: p },
      albedo: 0.25, starTeff: 3200,
    });
    // A thick atmosphere carries enough heat to the night side to even it out;
    // a thin one leaves an eyeball world with a frozen far hemisphere.
    expect(locked(1).gradientK).toBeLessThan(30);
    expect(locked(0.05).gradientK).toBeGreaterThan(60);
  });

  it('pins a winter pole at the frost point of its own air', () => {
    // Mars does this every year: carbon dioxide snows onto the winter pole and
    // the latent heat holds the temperature there until it has all fallen out.
    const marsAir: Atmosphere = {
      pressureBar: 0.00636, greenhouseFraction: 0.953, molarMass: 43.34, cp: 736,
      water: true, humidity: 0.2,
    };
    const frost = condensationTemperature(marsAir);
    expect(frost).toBeGreaterThan(120);
    expect(frost).toBeLessThan(160);
    const mars = solveClimate({
      ...earthInputs, irradiance: SOLAR_CONSTANT / 1.524 ** 2, periodS: 1.881 * YEAR,
      dayS: 88775, obliquity: 25.19 * DEG, eccentricity: 0.0934, atmosphere: marsAir,
      gravity: 3.721, radiusM: 3.3895e6, oceanFraction: 0.02, albedo: 0.25,
    });
    // Nothing anywhere on the planet gets below the frost point.
    expect(Math.min(...mars.bands.map((b) => b.minK))).toBeGreaterThanOrEqual(frost - 0.5);
    // And the global mean lands on the measured 210 K.
    expect(mars.meanK).toBeGreaterThan(195);
    expect(mars.meanK).toBeLessThan(225);
  });

  it('samples the field continuously in latitude and season', () => {
    const a = sampleClimate(earth, 0, 0.25);
    const b = sampleClimate(earth, 0, 0.26);
    expect(Math.abs(a - b)).toBeLessThan(5);
    expect(sampleClimate(earth, 0, 0.3)).toBeGreaterThan(sampleClimate(earth, 80 * DEG, 0.3));
    // The ice edge moves through the year and never leaves the sphere.
    for (const phase of [0, 0.25, 0.5, 0.75]) {
      const edge = seasonalIceEdge(earth, phase, true);
      expect(edge).toBeGreaterThanOrEqual(0);
      expect(edge).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
    }
  });
});

describe('circulation', () => {
  const earth = solveClimate(earthInputs).circulation;

  it('puts Earth\'s Hadley cell edge on its deserts', () => {
    // The Sahara, the Kalahari, the Atacama, the Arabian and the Australian
    // interior are all in one band, and Held and Hou say where it is.
    expect(earth.hadleyEdge / DEG).toBeGreaterThan(24);
    expect(earth.hadleyEdge / DEG).toBeLessThan(38);
  });

  it('gives Venus one cell reaching the pole', () => {
    const venus = hadleyEdge({
      dayS: 243 * DAY, radiusM: 6.0518e6, gravity: 8.87, pressureBar: 92,
      gradientK: 2, meanK: 737, scaleHeightM: 15900,
    });
    expect(venus / DEG).toBeCloseTo(90, 0);
  });

  it('gives Earth a 30 m/s jet stream and Jupiter a dozen jets', () => {
    expect(earth.windSpeed).toBeGreaterThan(15);
    expect(earth.windSpeed).toBeLessThan(70);
    expect(earth.jets).toBeGreaterThan(1.5);
    expect(earth.jets).toBeLessThan(8);

    // Jupiter turns in ten hours and is eleven times wider, so the Rhines
    // scale fits far more jets across it - which is the number of belts and
    // zones you can count in a small telescope.
    const jupiter = circulation({
      dayS: 9.925 * 3600, radiusM: 6.9911e7, gravity: 24.79, pressureBar: 1,
      gradientK: 30, meanK: 124, scaleHeightM: 24900,
    });
    expect(jupiter.jets).toBeGreaterThan(10);
    expect(jupiter.jets).toBeLessThan(40);
    expect(jupiter.jets).toBeGreaterThan(earth.jets * 2);
  });

  it('classifies Earth as a rapid rotator and Venus as a slow one', () => {
    expect(earth.regime).toBe('rapid');
    expect(circulation({
      dayS: 243 * DAY, radiusM: 6.0518e6, gravity: 8.87, pressureBar: 92,
      gradientK: 2, meanK: 737, scaleHeightM: 15900,
    }).regime).toBe('slow');
  });

  it('rains at the equator, not in the subtropics', () => {
    const wet = precipitation(0, earth);
    const dry = precipitation(earth.hadleyEdge, earth);
    const storms = precipitation(earth.stormTrack, earth);
    expect(wet).toBeGreaterThan(dry * 3);
    expect(storms).toBeGreaterThan(dry);
    // The driest place on Earth by rainfall is Antarctica, not the Sahara.
    expect(precipitation(88 * DEG, earth)).toBeLessThan(wet);
  });

  it('turns a rotation period into an angular velocity', () => {
    expect(angularVelocity(DAY)).toBeCloseTo(7.272e-5, 8);
    expect(angularVelocity(-DAY)).toBeCloseTo(angularVelocity(DAY), 12);
  });

  it('gives a still atmosphere no wind', () => {
    expect(zonalWind({
      dayS: DAY, radiusM: R_EARTH, gravity: 9.81, pressureBar: 0,
      gradientK: 90, meanK: 250, scaleHeightM: 8000,
    })).toBe(0);
  });
});

describe('the carbonate-silicate thermostat', () => {
  const N2: Atmosphere = {
    pressureBar: 0.78, greenhouseFraction: 0, molarMass: 28, cp: 1040,
    water: true, humidity: 0.7,
  };

  it('puts Earth\'s carbon dioxide where Earth\'s carbon dioxide is', () => {
    // Given only the sunlight and a 288 K setpoint, the cycle asks for a few
    // hundred parts per million. Earth ran at 280 ppm before we started
    // burning things and is at 420 now.
    const c = carbonCycle(SOLAR_CONSTANT, 0.0167, N2, 0.29, 0.708, 70, 5772, 288);
    expect(c.limit).toBe('regulated');
    expect(c.co2Bar).toBeGreaterThan(1e-4);
    expect(c.co2Bar).toBeLessThan(3e-3);
  });

  it('asks for more carbon dioxide the further out the planet is', () => {
    const at = (au: number) =>
      carbonCycle(SOLAR_CONSTANT / (au * au), 0, N2, 0.29, 0.7, 70, 5772, 288).co2Bar;
    expect(at(1.5)).toBeGreaterThan(at(1.1));
    expect(at(2.0)).toBeGreaterThan(at(1.5));
    // Mars would need something between a tenth of a bar and a few bars,
    // which is roughly what it is thought to have started with.
    expect(at(1.52)).toBeGreaterThan(0.05);
    expect(at(1.52)).toBeLessThan(5);
  });

  it('loses control at the inner edge, and that is Venus', () => {
    // Scrubbed as clean as weathering can manage, a world this close still
    // absorbs more than a wet atmosphere can radiate.
    const inner = carbonCycle(SOLAR_CONSTANT / 0.85 ** 2, 0, N2, 0.29, 0.7, 70, 5772, 288);
    expect(inner.limit).toBe('runaway');
    expect(carbonCycle(SOLAR_CONSTANT, 0, N2, 0.29, 0.7, 70, 5772, 288).limit).toBe('regulated');
  });

  it('stops regulating at all without an ocean to rain from', () => {
    // No rain, no weathering, no burial: every gram of carbon stays in the sky.
    const dry = carbonCycle(SOLAR_CONSTANT / 0.72 ** 2, 0,
      { ...N2, water: false }, 0.7, 0, 90, 5772, 288);
    expect(dry.limit).toBe('no-cycle');
    expect(dry.co2Bar).toBeCloseTo(90, 5);
    expect(dry.tempK).toBeGreaterThan(600);
  });

  it('sets the thermostat where volcanoes and rain balance, not at 288 K', () => {
    // Weathering doubles roughly every ten degrees, so a world outgassing
    // twice as hard has to run about ten degrees warmer to keep up.
    expect(thermostatSetpoint(1, 0.29)).toBeCloseTo(288, 0);
    expect(thermostatSetpoint(4, 0.29)).toBeGreaterThan(thermostatSetpoint(1, 0.29) + 15);
    expect(thermostatSetpoint(0.25, 0.29)).toBeLessThan(thermostatSetpoint(1, 0.29) - 15);
    // A world with no land has almost nothing for the rain to dissolve, so its
    // regulator is a weak one set high.
    expect(thermostatSetpoint(1, 0.02)).toBeGreaterThan(thermostatSetpoint(1, 0.29));
  });

  it('shuts the volcanoes down on a small or old world', () => {
    expect(outgassingRate(1, 4.5)).toBeCloseTo(1, 1);
    expect(outgassingRate(1, 10)).toBeLessThan(outgassingRate(1, 1));
    expect(outgassingRate(5, 4.5)).toBeGreaterThan(outgassingRate(1, 4.5));
    // Below about a tenth of an Earth mass a rocky planet freezes through.
    expect(outgassingRate(0.05, 4.5)).toBeLessThan(0.1);
  });
});

describe('planets, with a climate', () => {
  it('leaves the Solar System\'s measured numbers alone', () => {
    const sys = solarSystem();
    const at = (n: string) => sys.planets.find((p) => p.name === n)!;
    expect(at('Earth').surfaceK).toBe(288);
    expect(at('Earth').greenhouseK).toBeCloseTo(34, 0);
    expect(at('Venus').greenhouseK).toBeCloseTo(505, 0);
    expect(at('Venus').runaway).toBe(true);
    expect(at('Earth').runaway).toBe(false);
    expect(sys.planets.filter((p) => p.habitable).map((p) => p.name)).toEqual(['Earth']);
  });

  it('derives a usable column for every Solar System planet', () => {
    for (const p of solarSystem().planets) {
      expect(p.air.pressureBar).toBeCloseTo(p.pressureBar, 6);
      expect(p.air.molarMass).toBeGreaterThan(1);
      expect(p.air.cp).toBeGreaterThan(100);
      expect(p.co2Bar).toBeGreaterThanOrEqual(0);
      expect(p.greenhouseK).toBeGreaterThanOrEqual(0);
    }
  });

  it('never lets an atmosphere cool the ground under it', () => {
    for (let s = 0; s < 40; s++) {
      const sys = buildSystem(makeStar(0.2 + (s % 20) * 0.09, 4.5, 0), 7000 + s, `T${s}`);
      for (const p of sys.planets) {
        expect(p.greenhouseK).toBeGreaterThanOrEqual(-1e-6);
        expect(Number.isFinite(p.surfaceK)).toBe(true);
        expect(p.surfaceK).toBeGreaterThan(0);
        expect(p.effectiveK).toBeGreaterThan(0);
        expect(p.waterInventory).toBeGreaterThanOrEqual(0);
        expect(p.oceanFraction).toBeLessThanOrEqual(1);
        expect(p.iceFraction).toBeLessThanOrEqual(1);
      }
    }
  });

  it('only calls a world habitable if liquid water could actually sit on it', () => {
    for (let s = 0; s < 60; s++) {
      const sys = buildSystem(makeStar(0.3 + (s % 15) * 0.12, 5, 0), 4200 + s, `H${s}`);
      for (const p of sys.planets) {
        if (!p.habitable) continue;
        expect(liquidWaterPossible(p.surfaceK, p.pressureBar)).toBe(true);
        expect(p.oceanFraction).toBeGreaterThan(0);
        expect(p.runaway).toBe(false);
        expect(p.massKg).toBeLessThan(12 * M_EARTH);
      }
    }
  });

  it('makes a world that lost its oceans keep every gram of its carbon', () => {
    let found = 0;
    for (let s = 0; s < 60 && found < 3; s++) {
      const sys = buildSystem(makeStar(1, 4.5, 0), 800 + s, `V${s}`);
      for (const p of sys.planets) {
        if (!p.runaway || p.massKg > 12 * M_EARTH || p.pressureBar < 1) continue;
        found++;
        // No rain, no weathering, nothing to bury the carbon.
        expect(p.oceanFraction).toBe(0);
        expect(p.co2Bar).toBeGreaterThan(0);
        expect(p.greenhouseK).toBeGreaterThan(50);
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});
