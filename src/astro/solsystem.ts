/**
 * The Solar System, as measured.
 *
 * Everywhere else in this simulation a system is generated: a disc is given a
 * mass, cores accrete, a snow line decides what they are made of, and what
 * comes out is a plausible planetary system that has never existed. This file
 * is the opposite. Every number here is observed - masses from the IAU and
 * JPL, radii from the IAU 2015 nominal values, orbital elements from the J2000
 * mean ephemerides, surface temperatures and pressures and albedos from the
 * NASA planetary fact sheets - and it is here so the generator can be checked
 * against the one system anybody can look up.
 *
 * It is also, obviously, worth being able to visit.
 *
 * The bodies are assembled into exactly the same structures the generator
 * produces, so every renderer, inspector and readout works on it unchanged.
 * Where a derived quantity would normally be computed - the equilibrium
 * temperature, say - the measured value is used instead, and the difference
 * between the two is itself informative: Venus sits 500 K above its
 * equilibrium temperature, which is the greenhouse effect stated as a number.
 */

import {
  AU, DAY, G, M_EARTH, M_SUN, R_EARTH, R_SUN, YEAR,
} from '../core/constants';
import { makeStar, type Star } from './stellar';
import type { Moon, Planet, PlanetarySystem, PlanetClass, Ring } from './planets';
import { scaleHeight, type Atmosphere } from './radiation';
import { circulation } from './circulation';
import { makeComet } from './comet';
import { RNG } from '../core/rng';

const DEG = Math.PI / 180;

interface RealPlanet {
  name: string;
  cls: PlanetClass;
  /** Mass in Earth masses. */
  mass: number;
  /** Equatorial radius, km. */
  radiusKm: number;
  /** Semi-major axis, AU. */
  au: number;
  e: number;
  /** Inclination to the ecliptic, degrees. */
  inc: number;
  /** Longitude of the ascending node, degrees. */
  node: number;
  /** Longitude of perihelion, degrees. */
  peri: number;
  /** Mean longitude at J2000, degrees. */
  meanLong: number;
  /** Sidereal rotation, hours. Negative is retrograde. */
  dayHours: number;
  /** Axial tilt, degrees. */
  obliquity: number;
  /** Bond albedo. */
  albedo: number;
  /** Black-body temperature, K. */
  teq: number;
  /** Mean surface (or 1-bar) temperature, K. */
  surface: number;
  /** Surface pressure, bar. */
  pressure: number;
  atmosphere: string;
  ocean: number;
  cloud: number;
  /** Fraction of the surface under permanent ice. */
  ice?: number;
  biosphere: number;
  color: [number, number, number];
  color2: [number, number, number];
  moons: RealMoon[];
  rings?: Ring[];
}

interface RealMoon {
  name: string;
  /** Radius, km. */
  radiusKm: number;
  /** Mass, kg. */
  massKg: number;
  /** Semi-major axis, km. */
  aKm: number;
  e: number;
  /** Inclination to the planet's equator, degrees. */
  inc: number;
  albedo: number;
  icy: boolean;
  tidallyHeated: boolean;
  color: [number, number, number];
}

/**
 * The eight planets. Orbital elements are the J2000 mean elements; the
 * temperatures and pressures are the measured ones, not the derived ones.
 */
const PLANETS: RealPlanet[] = [
  {
    name: 'Mercury', cls: 'rocky', mass: 0.05527, radiusKm: 2439.7,
    au: 0.38709927, e: 0.20563593, inc: 7.00497902, node: 48.33076593,
    peri: 77.45779628, meanLong: 252.25032350,
    dayHours: 1407.6, obliquity: 0.034, albedo: 0.088, teq: 440, surface: 440,
    pressure: 0, atmosphere: 'none', ocean: 0, cloud: 0, biosphere: 0,
    color: [0.42, 0.38, 0.35], color2: [0.28, 0.25, 0.23], moons: [],
  },
  {
    name: 'Venus', cls: 'rocky', mass: 0.81500, radiusKm: 6051.8,
    au: 0.72333566, e: 0.00677672, inc: 3.39467605, node: 76.67984255,
    peri: 131.60246718, meanLong: 181.97909950,
    dayHours: -5832.5, obliquity: 177.36, albedo: 0.76, teq: 232, surface: 737,
    pressure: 92, atmosphere: 'CO₂ / N₂', ocean: 0, cloud: 1, biosphere: 0,
    color: [0.86, 0.74, 0.50], color2: [0.72, 0.60, 0.40], moons: [],
  },
  {
    name: 'Earth', cls: 'terrestrial', mass: 1, radiusKm: 6371.0,
    au: 1.00000261, e: 0.01671123, inc: -0.00001531, node: 0,
    peri: 102.93768193, meanLong: 100.46457166,
    dayHours: 23.9345, obliquity: 23.44, albedo: 0.306, teq: 254, surface: 288,
    pressure: 1.014, atmosphere: 'N₂ / O₂', ocean: 0.708, cloud: 0.67, ice: 0.10,
    biosphere: 1,
    color: [0.34, 0.42, 0.24], color2: [0.05, 0.16, 0.34],
    moons: [{
      name: 'Moon', radiusKm: 1737.4, massKg: 7.342e22, aKm: 384399,
      e: 0.0549, inc: 5.145, albedo: 0.136, icy: false, tidallyHeated: false,
      color: [0.55, 0.53, 0.50],
    }],
  },
  {
    name: 'Mars', cls: 'rocky', mass: 0.10745, radiusKm: 3389.5,
    au: 1.52371034, e: 0.09339410, inc: 1.84969142, node: 49.55953891,
    peri: -23.94362959, meanLong: -4.55343205,
    dayHours: 24.6229, obliquity: 25.19, albedo: 0.25, teq: 210, surface: 210,
    pressure: 0.00636, atmosphere: 'CO₂', ocean: 0, ice: 0.02, cloud: 0.05, biosphere: 0,
    color: [0.63, 0.36, 0.21], color2: [0.42, 0.24, 0.15],
    moons: [
      {
        name: 'Phobos', radiusKm: 11.1, massKg: 1.0659e16, aKm: 9376, e: 0.0151,
        inc: 1.093, albedo: 0.071, icy: false, tidallyHeated: false,
        color: [0.36, 0.33, 0.30],
      },
      {
        name: 'Deimos', radiusKm: 6.2, massKg: 1.4762e15, aKm: 23463, e: 0.00033,
        inc: 0.93, albedo: 0.068, icy: false, tidallyHeated: false,
        color: [0.38, 0.35, 0.32],
      },
    ],
  },
  {
    name: 'Jupiter', cls: 'gas-giant', mass: 317.83, radiusKm: 71492,
    au: 5.20288700, e: 0.04838624, inc: 1.30439695, node: 100.47390909,
    peri: 14.72847983, meanLong: 34.39644051,
    dayHours: 9.9250, obliquity: 3.13, albedo: 0.503, teq: 110, surface: 165,
    pressure: 1000, atmosphere: 'H₂ / He', ocean: 0, cloud: 1, biosphere: 0,
    color: [0.80, 0.70, 0.55], color2: [0.62, 0.42, 0.28],
    moons: [
      {
        name: 'Io', radiusKm: 1821.6, massKg: 8.932e22, aKm: 421700, e: 0.0041,
        inc: 0.05, albedo: 0.63, icy: false, tidallyHeated: true,
        color: [0.85, 0.76, 0.42],
      },
      {
        name: 'Europa', radiusKm: 1560.8, massKg: 4.8e22, aKm: 671034, e: 0.009,
        inc: 0.47, albedo: 0.67, icy: true, tidallyHeated: true,
        color: [0.82, 0.76, 0.68],
      },
      {
        name: 'Ganymede', radiusKm: 2634.1, massKg: 1.4819e23, aKm: 1070412,
        e: 0.0013, inc: 0.20, albedo: 0.43, icy: true, tidallyHeated: false,
        color: [0.60, 0.56, 0.50],
      },
      {
        name: 'Callisto', radiusKm: 2410.3, massKg: 1.0759e23, aKm: 1882709,
        e: 0.0074, inc: 0.192, albedo: 0.22, icy: true, tidallyHeated: false,
        color: [0.42, 0.39, 0.36],
      },
    ],
  },
  {
    name: 'Saturn', cls: 'gas-giant', mass: 95.16, radiusKm: 60268,
    au: 9.53667594, e: 0.05386179, inc: 2.48599187, node: 113.66242448,
    peri: 92.59887831, meanLong: 49.95424423,
    dayHours: 10.656, obliquity: 26.73, albedo: 0.342, teq: 81, surface: 134,
    pressure: 1000, atmosphere: 'H₂ / He', ocean: 0, cloud: 1, biosphere: 0,
    color: [0.86, 0.78, 0.60], color2: [0.72, 0.63, 0.44],
    // The rings, from the inner edge of the C ring to the outer edge of the A.
    rings: [{ innerM: 74_500e3, outerM: 136_780e3, opacity: 0.62, iceFraction: 0.95 }],
    moons: [
      {
        name: 'Titan', radiusKm: 2574.7, massKg: 1.3452e23, aKm: 1221870,
        e: 0.0288, inc: 0.35, albedo: 0.22, icy: true, tidallyHeated: false,
        color: [0.72, 0.55, 0.28],
      },
      {
        name: 'Enceladus', radiusKm: 252.1, massKg: 1.08e20, aKm: 237948,
        e: 0.0047, inc: 0.009, albedo: 0.81, icy: true, tidallyHeated: true,
        color: [0.92, 0.94, 0.96],
      },
      {
        name: 'Rhea', radiusKm: 763.8, massKg: 2.307e21, aKm: 527108, e: 0.0013,
        inc: 0.345, albedo: 0.49, icy: true, tidallyHeated: false,
        color: [0.74, 0.73, 0.71],
      },
    ],
  },
  {
    name: 'Uranus', cls: 'ice-giant', mass: 14.536, radiusKm: 25559,
    au: 19.18916464, e: 0.04725744, inc: 0.77263783, node: 74.01692503,
    peri: 170.95427630, meanLong: 313.23810451,
    dayHours: -17.24, obliquity: 97.77, albedo: 0.300, teq: 58, surface: 76,
    pressure: 1000, atmosphere: 'H₂ / He / CH₄', ocean: 0, cloud: 1,
    biosphere: 0,
    color: [0.60, 0.82, 0.85], color2: [0.48, 0.72, 0.78],
    rings: [{ innerM: 41_837e3, outerM: 51_149e3, opacity: 0.06, iceFraction: 0.2 }],
    moons: [
      {
        name: 'Titania', radiusKm: 788.4, massKg: 3.4e21, aKm: 435910, e: 0.0011,
        inc: 0.34, albedo: 0.35, icy: true, tidallyHeated: false,
        color: [0.60, 0.57, 0.55],
      },
      {
        name: 'Miranda', radiusKm: 235.8, massKg: 6.59e19, aKm: 129390,
        e: 0.0013, inc: 4.23, albedo: 0.32, icy: true, tidallyHeated: false,
        color: [0.66, 0.65, 0.64],
      },
    ],
  },
  {
    name: 'Neptune', cls: 'ice-giant', mass: 17.147, radiusKm: 24764,
    au: 30.06992276, e: 0.00859048, inc: 1.77004347, node: 131.78422574,
    peri: 44.96476227, meanLong: -55.12002969,
    dayHours: 16.11, obliquity: 28.32, albedo: 0.290, teq: 47, surface: 72,
    pressure: 1000, atmosphere: 'H₂ / He / CH₄', ocean: 0, cloud: 1,
    biosphere: 0,
    color: [0.28, 0.42, 0.82], color2: [0.20, 0.32, 0.70],
    moons: [{
      name: 'Triton', radiusKm: 1353.4, massKg: 2.14e22, aKm: 354759, e: 0.000016,
      inc: 156.885, albedo: 0.76, icy: true, tidallyHeated: false,
      color: [0.86, 0.84, 0.80],
    }],
  },
];

/** The Sun, from measurement rather than from the main-sequence relations. */
export function theSun(): Star {
  const s = makeStar(1, 4.6, 0);
  return {
    ...s,
    massMsun: 1,
    currentMassMsun: 1,
    luminosityLsun: 1,
    radiusRsun: 1,
    teff: 5772,
    ageGyr: 4.603,
    lifetimeGyr: 10.0,
    metallicity: 0,
    spectralClass: 'G',
    subClass: 2,
    luminosityClass: 'V',
    habitableZoneAu: [0.95, 1.67],
  };
}

function buildMoon(m: RealMoon, planetRadiusM: number, index: number): Moon {
  void planetRadiusM;
  return {
    name: m.name,
    radiusM: m.radiusKm * 1e3,
    massKg: m.massKg,
    a: m.aKm * 1e3,
    e: m.e,
    i: m.inc * DEG,
    phase: (index * 2.399963) % (Math.PI * 2),
    albedo: m.albedo,
    icy: m.icy,
    tidallyHeated: m.tidallyHeated,
    color: m.color,
  };
}

function buildPlanet(p: RealPlanet, index: number): Planet {
  const massKg = p.mass * M_EARTH;
  const radiusM = p.radiusKm * 1e3;
  const volume = (4 / 3) * Math.PI * radiusM ** 3;
  const gravity = (G * massKg) / (radiusM * radiusM);
  // Mean longitude and longitude of perihelion are what the ephemerides
  // tabulate; the elements this simulation integrates want the argument of
  // perihelion and the mean anomaly, which differ by the node and the
  // perihelion longitude respectively.
  const omega = (p.peri - p.node) * DEG;
  const M0 = (p.meanLong - p.peri) * DEG;
  const a = p.au * AU;
  return {
    index,
    name: p.name,
    cls: p.cls,
    massKg,
    radiusM,
    density: massKg / volume,
    gravity,
    escapeVelocity: Math.sqrt((2 * G * massKg) / radiusM),
    elements: {
      a, e: p.e, i: p.inc * DEG, Omega: p.node * DEG, omega, M0, epoch: 0,
    },
    ...measuredAtmosphere(p),
    au: p.au,
    periodS: 2 * Math.PI * Math.sqrt(a ** 3 / (G * M_SUN)),
    dayS: p.dayHours * 3600,
    obliquity: p.obliquity * DEG,
    albedo: p.albedo,
    teqK: p.teq,
    surfaceK: p.surface,
    pressureBar: p.pressure,
    atmosphere: p.atmosphere,
    oceanFraction: p.ocean,
    cloudCover: p.cloud,
    tidallyLocked: false,
    habitable: p.name === 'Earth',
    biosphere: p.biosphere,
    moons: p.moons.map((m, i) => buildMoon(m, radiusM, i)),
    rings: p.rings ?? [],
    color: p.color,
    color2: p.color2,
    surfaceSeed: 1000 + index * 7919,
    magnetism: SOLAR_MAGNETISM[p.name] ?? 0,
    jets: circulation({
      dayS: Math.abs(p.dayHours) * 3600, radiusM, gravity,
      pressureBar: Math.max(p.pressure, p.atmosphere.includes('H₂') ? 1 : 0),
      gradientK: Math.max(2, Math.abs(p.surface - p.teq) || p.teq * 0.25),
      meanK: p.surface,
      scaleHeightM: scaleHeight(p.surface, gravity, p.atmosphere.includes('H₂') ? 2.3 : 30),
    }).jets,
  };
}

/**
 * The measured column, in the form the radiation and climate models want.
 *
 * The temperatures here stay measured - the greenhouse warming of a real
 * planet is an observation, not a prediction, and the point of this file is to
 * be the thing the generator is checked against. What is derived is only the
 * *composition*, so the same climate solver that runs on invented worlds can be
 * pointed at these and asked where their ice lines are.
 */
function measuredAtmosphere(p: RealPlanet): {
  effectiveK: number; greenhouseK: number; co2Bar: number; air: Atmosphere;
  waterInventory: number; iceFraction: number; runaway: boolean;
} {
  const hydrogen = p.atmosphere.includes('H₂');
  const carbon = p.atmosphere.startsWith('CO₂');
  const fraction = p.pressure <= 0 ? 0 : hydrogen ? 1e-3 : carbon ? 0.95 : 4.2e-4;
  return {
    effectiveK: p.teq,
    // Measured, not modelled: Venus's 505 K and Earth's 33 K are what the
    // thermometers say, and the model has to answer to them rather than the
    // other way round.
    greenhouseK: p.surface - p.teq,
    co2Bar: p.pressure * fraction,
    air: {
      pressureBar: p.pressure,
      greenhouseFraction: fraction,
      molarMass: hydrogen ? 2.3 : carbon ? 43.4 : 28.97,
      cp: hydrogen ? 12000 : carbon ? 850 : 1004,
      water: p.ocean > 0.01 || (p.ice ?? 0) > 0.005,
      humidity: hydrogen ? 0 : 0.7,
    },
    waterInventory: Math.max(p.ocean, p.ice ?? 0),
    iceFraction: p.ice ?? (p.surface < 273 ? p.ocean : 0),
    // Venus did this, and the evidence is the hundred-fold deuterium excess in
    // what water it has left: an ocean's worth of hydrogen went to space.
    runaway: p.name === 'Venus',
  };
}

/** Dipole moments relative to Earth's 7.7e22 A m². */
const SOLAR_MAGNETISM: Record<string, number> = {
  Mercury: 0.0007, Venus: 0, Earth: 1, Mars: 0,
  Jupiter: 20000, Saturn: 580, Uranus: 50, Neptune: 27,
};

/** The Solar System, assembled into the same structures the generator makes. */
export function solarSystem(): PlanetarySystem {
  const star = theSun();
  const planets = PLANETS.map(buildPlanet);
  // Comets are the one part that is not a catalogue: there are billions, and
  // the handful currently inbound is a matter of when you look. They are drawn
  // from the same distribution as everywhere else, seeded so they do not move
  // between visits.
  const rng = new RNG(0x50143);
  return {
    star,
    companion: null,
    host: 'single',
    effectiveLuminosity: 1,
    planets,
    // The measured snow line in the solar nebula, from where the chondrites
    // change composition - close to, but not the same as, the 2.7 AU the
    // simple luminosity scaling gives for the Sun today.
    snowLineAu: 2.7,
    sublimationAu: 0.034,
    discSolidsMe: 50,
    // The main belt, and the Kuiper belt beyond Neptune.
    asteroidBelts: [{ innerAu: 2.06, outerAu: 3.28, count: 6200 }],
    outerBeltAu: [30, 50],
    cometCount: 1200,
    comets: Array.from({ length: 3 }, (_, i) => makeComet(rng, i, 'Sol', 30, 2.7)),
  };
}

/** Index of a named planet, for travelling straight to it. */
export function planetIndex(name: string): number {
  return PLANETS.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
}

export { PLANETS as REAL_PLANETS, AU, DAY, YEAR, R_EARTH, R_SUN, M_EARTH };
