/**
 * Planet formation.
 *
 * Given a star, this builds a plausible system the way nature does: a
 * protoplanetary disc whose mass scales with the star, a snow line where water
 * can freeze, cores that grow faster outside it, runaway gas accretion for the
 * cores that get big enough before the disc disperses, and orbits spaced by
 * mutual Hill radii so the result is dynamically stable.
 *
 * Every derived quantity then follows from real relations: mass-radius from
 * Chen & Kipping (2017), equilibrium temperature from the stellar flux and
 * albedo, atmospheric retention from the Jeans escape parameter, moons and
 * rings from the Roche limit and the Hill sphere, and tidal locking from the
 * despinning timescale.
 */

import {
  AU, DEG, G, K_B, M_EARTH, M_JUPITER, M_PROTON, M_SUN, R_EARTH, R_JUPITER, R_SUN,
  YEAR, rocheLimit,
} from '../core/constants';
import { RNG, derive } from '../core/rng';
import type { Star } from './stellar';
import { hillRadius, period, tidalLockingTimeYears, type OrbitalElements } from '../physics/kepler';
import { planetRegion, combinedLuminosity, type Companion, type PlanetHost } from './binary';
import { makeComet, type Comet } from './comet';

export type PlanetClass =
  | 'iron' | 'rocky' | 'desert' | 'ocean' | 'terrestrial' | 'lava' | 'carbon'
  | 'tundra' | 'ice' | 'super-earth' | 'mini-neptune' | 'ice-giant'
  | 'gas-giant' | 'hot-jupiter' | 'puffy';

export interface Moon {
  name: string;
  massKg: number;
  radiusM: number;
  /** Semi-major axis about the planet, m. */
  a: number;
  e: number;
  i: number;
  phase: number;
  albedo: number;
  icy: boolean;
  tidallyHeated: boolean;
  color: [number, number, number];
}

export interface Ring {
  innerM: number;
  outerM: number;
  opacity: number;
  /** Fraction of water ice, which sets how bright and blue-white the ring is. */
  iceFraction: number;
}

export interface Planet {
  index: number;
  name: string;
  cls: PlanetClass;
  massKg: number;
  radiusM: number;
  /** Bulk density, kg/m^3. */
  density: number;
  /** Surface gravity, m/s^2. */
  gravity: number;
  /** Escape velocity, m/s. */
  escapeVelocity: number;
  elements: OrbitalElements;
  /** Semi-major axis in AU, for convenience. */
  au: number;
  /** Orbital period, seconds. */
  periodS: number;
  /** Sidereal rotation period, seconds. Negative means retrograde. */
  dayS: number;
  /** Axial tilt, radians. */
  obliquity: number;
  /** Bond albedo. */
  albedo: number;
  /** Equilibrium temperature with no atmosphere, K. */
  teqK: number;
  /** Surface temperature including greenhouse forcing, K. */
  surfaceK: number;
  /** Surface pressure, bar. 0 means airless. */
  pressureBar: number;
  /** Dominant atmospheric species. */
  atmosphere: string;
  /** Fraction of the surface covered by liquid. */
  oceanFraction: number;
  /** Fractional cloud cover. */
  cloudCover: number;
  /** Whether the planet keeps one face to its star. */
  tidallyLocked: boolean;
  /** Whether it sits inside the conservative habitable zone with liquid water. */
  habitable: boolean;
  /** 0..1 crude biosphere index; only ever nonzero for habitable worlds. */
  biosphere: number;
  moons: Moon[];
  rings: Ring[];
  /** Base surface colour in linear light, before shading. */
  color: [number, number, number];
  /** Secondary colour used by the terrain shader. */
  color2: [number, number, number];
  /** Seed for the procedural surface. */
  surfaceSeed: number;
  /** Magnetic field strength relative to Earth's. */
  magnetism: number;
}

export interface PlanetarySystem {
  star: Star;
  /** The second star, if this is a binary. */
  companion: Companion | null;
  /** Where the planets sit relative to the pair. */
  host: PlanetHost;
  /** Luminosity that actually falls on the planets, solar units. */
  effectiveLuminosity: number;
  planets: Planet[];
  /** Snow line, AU. */
  snowLineAu: number;
  /** Inner edge where dust sublimates, AU. */
  sublimationAu: number;
  /** Total disc solid mass available, Earth masses. */
  discSolidsMe: number;
  asteroidBelts: { innerAu: number; outerAu: number; count: number }[];
  /** Kuiper-analogue outer debris belt. */
  outerBeltAu: [number, number];
  cometCount: number;
  /** Comets on eccentric orbits, active near perihelion. */
  comets: Comet[];
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV'];

/** Chen & Kipping (2017) broken power-law mass-radius relation. Earth units in and out. */
export function radiusFromMass(mEarth: number): number {
  if (mEarth < 2.04) return 1.008 * Math.pow(mEarth, 0.2790);
  if (mEarth < 131.6) return 0.808 * Math.pow(mEarth, 0.5890);
  if (mEarth < 26600) return 17.74 * Math.pow(mEarth, -0.0440);
  return 0.00143 * Math.pow(mEarth, 0.881);
}

/** Equilibrium temperature from stellar luminosity, distance and albedo. */
export function equilibriumTemperature(Lsun: number, au: number, albedo: number): number {
  // T = 278.3 K * (L/Lsun)^(1/4) * (1-A)^(1/4) / sqrt(a/AU)
  return 278.3 * Math.pow(Lsun, 0.25) * Math.pow(Math.max(0, 1 - albedo), 0.25) / Math.sqrt(au);
}

/**
 * Jeans escape parameter lambda = GMm / (k T R). A species is retained over
 * geological time when lambda is greater than about 30; below ~6 the atmosphere
 * boils off hydrodynamically. This is why Mars lost its air and Titan kept its.
 */
export function jeansParameter(massKg: number, radiusM: number, tempK: number, molarMassAmu: number): number {
  const m = molarMassAmu * M_PROTON;
  return (G * massKg * m) / (K_B * Math.max(tempK, 1) * radiusM);
}

/** Snow line: where the disc is cold enough for water ice, ~170 K. */
export const snowLine = (Lsun: number): number => 2.7 * Math.sqrt(Math.max(Lsun, 1e-6));

/** Dust sublimation radius, ~1500 K. */
export const sublimationRadius = (Lsun: number): number => 0.034 * Math.sqrt(Math.max(Lsun, 1e-6));

function classify(
  mEarth: number, teq: number, water: number, insideSnow: boolean,
  pressureBar = 0, hydrogenEnvelope = false,
): PlanetClass {
  // A world of any mass that held on to a thick hydrogen envelope is a
  // mini-Neptune, not a rocky planet with weather: there is no surface to stand
  // on under a hundred bars of H2.
  if (hydrogenEnvelope && pressureBar > 8) {
    return mEarth > 60 ? (teq > 1000 ? 'hot-jupiter' : 'gas-giant')
      : teq < 150 ? 'ice-giant' : 'mini-neptune';
  }
  if (mEarth > 60) {
    if (teq > 1000) return 'hot-jupiter';
    if (mEarth > 400) return 'gas-giant';
    return teq < 120 ? 'ice-giant' : 'gas-giant';
  }
  if (mEarth > 12) return teq < 150 ? 'ice-giant' : 'mini-neptune';
  if (mEarth > 2.2) {
    if (teq > 800) return 'lava';
    if (!insideSnow || water > 0.6) return 'ocean';
    return 'super-earth';
  }
  if (teq > 900) return 'lava';
  if (teq > 500) return 'iron';
  if (teq < 150) return water > 0.3 ? 'ice' : 'rocky';
  if (water > 0.75) return 'ocean';
  if (water > 0.18) return teq < 250 ? 'tundra' : 'terrestrial';
  if (water > 0.02) return 'desert';
  return 'rocky';
}

const PALETTE: Record<PlanetClass, [[number, number, number], [number, number, number]]> = {
  iron:          [[0.19, 0.16, 0.14], [0.10, 0.085, 0.075]],
  rocky:         [[0.22, 0.19, 0.165], [0.125, 0.105, 0.09]],
  desert:        [[0.44, 0.29, 0.165], [0.26, 0.15, 0.085]],
  ocean:         [[0.028, 0.085, 0.185], [0.045, 0.15, 0.235]],
  terrestrial:   [[0.075, 0.17, 0.085], [0.022, 0.075, 0.185]],
  lava:          [[0.14, 0.045, 0.025], [1.70, 0.42, 0.06]],
  carbon:        [[0.055, 0.05, 0.055], [0.135, 0.115, 0.10]],
  tundra:        [[0.24, 0.245, 0.215], [0.50, 0.56, 0.62]],
  ice:           [[0.62, 0.70, 0.80], [0.36, 0.46, 0.60]],
  'super-earth': [[0.20, 0.165, 0.14], [0.10, 0.155, 0.22]],
  'mini-neptune':[[0.24, 0.36, 0.42], [0.15, 0.26, 0.36]],
  'ice-giant':   [[0.13, 0.28, 0.45], [0.24, 0.44, 0.58]],
  'gas-giant':   [[0.46, 0.37, 0.27], [0.27, 0.19, 0.14]],
  'hot-jupiter': [[0.22, 0.075, 0.055], [0.72, 0.26, 0.10]],
  puffy:         [[0.38, 0.28, 0.31], [0.24, 0.17, 0.20]],
};

const MOON_NAMES = [
  'Aegis', 'Bruma', 'Calyx', 'Dain', 'Ember', 'Fen', 'Glim', 'Halcyon', 'Iris',
  'Juno', 'Kestrel', 'Lark', 'Mote', 'Nyx', 'Orn', 'Pell', 'Quill', 'Rune',
  'Solace', 'Thistle', 'Umbra', 'Vesper', 'Wren', 'Xanth', 'Yarrow', 'Zephyr',
];

export function buildSystem(
  star: Star, seed: number, starName: string, companion: Companion | null = null,
): PlanetarySystem {
  const rng = derive(seed, 'system');
  const region = planetRegion(star, companion);
  // A circumbinary planet is lit by both stars; an S-type planet orbiting one
  // of them is lit by that one, with the other a bright point in its sky.
  const L = Math.max(
    region.host === 'circumbinary' ? combinedLuminosity(star, companion) : star.luminosityLsun,
    1e-8);
  const snow = snowLine(L);
  const subl = Math.max(sublimationRadius(L), (star.radiusRsun * R_SUN * 4) / AU);

  // Disc solid mass scales roughly linearly with stellar mass, with large scatter,
  // and higher metallicity means more solids - which is why metal-rich stars
  // host more giant planets.
  const metalFactor = Math.pow(10, star.metallicity * 0.7);
  const discSolids = 30 * star.massMsun * metalFactor * rng.logNormal(1, 0.55);

  const planets: Planet[] = [];
  if (star.kind === 'black-hole' || star.kind === 'neutron-star') {
    return {
      star, companion, host: region.host, effectiveLuminosity: L,
      planets, snowLineAu: snow, sublimationAu: subl, discSolidsMe: 0,
      asteroidBelts: [], outerBeltAu: [0, 0], cometCount: 0, comets: [],
    };
  }

  // --- Lay down orbits by mutual Hill spacing, the criterion for long-term
  //     stability. Real systems cluster around 15-25 mutual Hill radii.
  // A companion clears everything between the two stable regions, so the disc
  // is truncated at whichever edge the pair leaves.
  const outerEdge = Math.min(
    600, 40 * Math.pow(star.massMsun, 0.9) * rng.range(0.55, 1.8), region.outerAu);
  let a = subl * rng.range(1.4, 4.5);
  // Only a companion imposes an inner floor, and only then does it consume a
  // random draw - so a single star's system is bit-identical to what it was
  // before binaries existed.
  if (region.innerAu > 0) a = Math.max(a, region.innerAu * rng.range(1.0, 1.6));
  let idx = 0;
  let solidsLeft = discSolids;
  const maxPlanets = rng.int(3, 11);

  while (a < outerEdge && planets.length < maxPlanets) {
    const insideSnow = a < snow;
    // Isolation mass grows with distance, and jumps by a factor of a few
    // across the snow line where ice becomes available as a solid.
    const sigma = 8 * Math.pow(a, -1.5) * (insideSnow ? 1 : 3.2) * metalFactor;
    const feeding = 0.28 * a;
    const isolation = Math.max(0.02, 2 * Math.PI * a * feeding * sigma * 0.4);
    let mEarth = Math.min(solidsLeft * 0.6, isolation * rng.logNormal(1, 0.75));

    // Runaway gas accretion: a core above ~10 Me outside the snow line, formed
    // before the gas disc disperses, becomes a giant.
    const canAccrete = !insideSnow && mEarth > 8 && rng.chance(0.55);
    if (canAccrete) {
      mEarth *= rng.logNormal(28, 0.85);
      mEarth = Math.min(mEarth, 6000);
    }
    mEarth = Math.max(0.008, mEarth);
    solidsLeft -= Math.min(solidsLeft, mEarth * (canAccrete ? 0.12 : 1));

    // Type II migration: some giants spiral inward and become hot Jupiters.
    let semi = a;
    if (canAccrete && rng.chance(0.10)) semi = Math.max(subl * 1.6, a * rng.range(0.008, 0.09));

    if (semi < region.innerAu || semi > region.outerAu) break;
    planets.push(makePlanet(rng, star, starName, idx++, semi, mEarth, snow, L));

    // Next orbit, spaced by mutual Hill radii
    const mu = (mEarth * M_EARTH) / (star.massMsun * M_SUN);
    const rH = Math.cbrt(mu / 3);
    const spacing = rng.range(14, 26) * rH;
    a *= (1 + spacing / 2) / (1 - spacing / 2);
    if (!Number.isFinite(a) || a <= 0) break;
    if (rng.chance(0.12)) a *= rng.range(1.3, 2.4); // a gap where nothing formed
  }

  planets.sort((p, q) => p.au - q.au);
  planets.forEach((p, i) => {
    p.index = i;
    p.name = `${starName} ${ROMAN[i] ?? i + 1}`;
  });

  // --- Debris. An asteroid belt lives where a giant's resonances stirred the
  //     planetesimals too much for them to accrete.
  const belts: { innerAu: number; outerAu: number; count: number }[] = [];
  for (let i = 0; i < planets.length - 1; i++) {
    const gap = planets[i + 1].au / planets[i].au;
    const massive = planets[i + 1].massKg > 30 * M_EARTH;
    if (gap > 2.4 && massive && rng.chance(0.7)) {
      belts.push({
        innerAu: planets[i].au * 1.35,
        outerAu: planets[i + 1].au * 0.72,
        count: rng.int(1200, 5200),
      });
    }
  }
  const outer = planets.length ? planets[planets.length - 1].au : 30;

  return {
    star,
    companion,
    host: region.host,
    effectiveLuminosity: L,
    planets,
    snowLineAu: snow,
    sublimationAu: subl,
    discSolidsMe: discSolids,
    asteroidBelts: belts,
    outerBeltAu: [outer * 1.3, outer * 3.2],
    cometCount: rng.int(400, 1800),
    // A handful of comets currently on their way in. There are billions more
    // out in the cloud; these are the ones close enough to have turned on.
    comets: Array.from({ length: rng.int(2, 5) },
      (_, i) => makeComet(rng, i, starName, outer, snow)),
  };
}

function makePlanet(
  rng: RNG, star: Star, starName: string, index: number,
  au: number, mEarth: number, snowAu: number, L: number,
): Planet {
  const insideSnow = au < snowAu;
  const massKg = mEarth * M_EARTH;
  let rEarth = radiusFromMass(mEarth);

  // Composition modifies the radius: iron-rich worlds are denser and smaller,
  // water worlds are puffier.
  const ironRich = insideSnow && rng.chance(0.2);
  const waterRich = !insideSnow && mEarth < 12 && rng.chance(0.6);
  if (mEarth < 12) {
    if (ironRich) rEarth *= rng.range(0.78, 0.9);
    else if (waterRich) rEarth *= rng.range(1.1, 1.35);
  }
  const radiusM = rEarth * R_EARTH;

  // First pass at temperature with a provisional albedo, then refine, because
  // albedo depends on what condenses and what condenses depends on temperature.
  let albedo = 0.3;
  let teq = equilibriumTemperature(L, au, albedo);
  const isGiant = mEarth > 12;
  if (isGiant) albedo = teq > 900 ? rng.range(0.03, 0.12) : rng.range(0.3, 0.55);
  else if (teq < 180) albedo = rng.range(0.45, 0.7);       // ice
  else if (teq > 700) albedo = rng.range(0.05, 0.15);      // molten rock
  else albedo = rng.range(0.15, 0.42);
  teq = equilibriumTemperature(L, au, albedo);

  const gravity = (G * massKg) / (radiusM * radiusM);
  const vEsc = Math.sqrt((2 * G * massKg) / radiusM);

  // --- Atmosphere. Retention is decided by the Jeans parameter for the
  //     lightest species the planet could plausibly hold.
  let pressureBar = 0;
  let atmosphere = 'none';
  let greenhouse = 0;
  const lamH2 = jeansParameter(massKg, radiusM, teq, 2);
  const lamN2 = jeansParameter(massKg, radiusM, teq, 28);
  const lamCO2 = jeansParameter(massKg, radiusM, teq, 44);
  if (isGiant || lamH2 > 40) {
    pressureBar = isGiant ? 1e5 : rng.range(1, 200);
    atmosphere = 'H₂ / He';
    greenhouse = 0;
  } else if (lamCO2 > 25) {
    const runaway = teq > 300 && rng.chance(0.45);
    pressureBar = runaway ? rng.range(20, 95) : rng.logNormal(0.9, 1.5);
    atmosphere = runaway ? 'CO₂ (runaway)' : lamN2 > 30 ? 'N₂ / CO₂' : 'CO₂';
    // Greenhouse forcing rises steeply with column mass
    greenhouse = Math.min(520, 33 * Math.pow(Math.max(pressureBar, 1e-3), 0.55) * (runaway ? 3.4 : 1));
  } else if (lamCO2 > 12) {
    pressureBar = rng.range(0.001, 0.02);
    atmosphere = 'trace CO₂';
    greenhouse = 2;
  }

  const surfaceK = teq + greenhouse;

  // --- Water. Liquid needs the right temperature and enough pressure that it
  //     does not simply sublimate.
  let ocean = 0;
  const hydro = atmosphere.includes('H₂') && pressureBar > 8;
  if (!isGiant && !hydro && surfaceK > 245 && surfaceK < 380 && pressureBar > 0.006) {
    ocean = Math.min(1, (waterRich ? rng.range(0.6, 1) : rng.range(0, 0.9)));
  } else if (!isGiant && !hydro && surfaceK <= 245) {
    ocean = waterRich ? rng.range(0.3, 1) : rng.range(0, 0.4); // frozen
  }

  const cls = classify(mEarth, teq, ocean, insideSnow, pressureBar, atmosphere.includes('H₂'));
  const [c1, c2] = PALETTE[cls];

  // --- Rotation and tides.
  const periodS = period(au * AU, G * (star.currentMassMsun * M_SUN + massKg));
  const lockYears = tidalLockingTimeYears(au * AU, massKg, radiusM, star.currentMassMsun * M_SUN);
  const locked = lockYears < star.ageGyr * 1e9;
  let dayS = locked ? periodS : rng.logNormal(isGiant ? 3.6e4 : 9e4, 0.8);
  if (!locked && rng.chance(0.06)) dayS = -dayS;  // retrograde, as Venus is
  const obliquity = rng.chance(0.05) ? rng.range(60, 120) * DEG : Math.abs(rng.normal(0, 22)) * DEG;

  // Dynamo: needs a molten conducting core and fast rotation.
  const magnetism = isGiant ? rng.range(2, 20)
    : (locked ? 0.02 : 1) * Math.max(0, (mEarth > 0.3 ? 1 : 0.1)) * rng.range(0, 1.6);

  // --- Moons.
  const moons: Moon[] = [];
  const rH = hillRadius(au * AU, 0.02, massKg, star.currentMassMsun * M_SUN);
  const nMoons = isGiant ? rng.int(2, 14) : mEarth > 0.4 ? rng.int(0, 2) : 0;
  const roche = rocheLimit(radiusM, massKg / ((4 / 3) * Math.PI * radiusM ** 3), 1400);
  for (let i = 0; i < nMoons; i++) {
    const aM = rng.range(Math.max(roche * 1.15, radiusM * 2.2), rH * 0.42);
    const mM = massKg * rng.logNormal(isGiant ? 2e-5 : 5e-3, 1.4);
    const rM = radiusFromMass(mM / M_EARTH) * R_EARTH * rng.range(0.85, 1.05);
    const icy = au > snowAu || rng.chance(0.4);
    // Tidal heating: close-in moons in resonance get flexed, like Io and Europa
    const heated = aM < roche * 6 && isGiant && rng.chance(0.45);
    moons.push({
      name: `${starName} ${ROMAN[index] ?? index} ${MOON_NAMES[i % MOON_NAMES.length]}`,
      massKg: mM, radiusM: Math.max(rM, 4e4), a: aM,
      e: Math.abs(rng.normal(0, 0.012)), i: Math.abs(rng.normal(0, 4)) * DEG,
      phase: rng.range(0, Math.PI * 2),
      albedo: icy ? rng.range(0.4, 0.9) : rng.range(0.06, 0.25),
      icy, tidallyHeated: heated,
      color: heated ? [0.85, 0.62, 0.22] : icy ? [0.78, 0.82, 0.88] : [0.34, 0.31, 0.28],
    });
  }
  moons.sort((x, y) => x.a - y.a);

  // --- Rings: debris that never accreted because it sits inside the Roche limit.
  const rings: Ring[] = [];
  if (isGiant && rng.chance(0.45)) {
    const inner = radiusM * rng.range(1.2, 1.6);
    const outer = Math.min(roche * rng.range(0.9, 1.05), inner * rng.range(1.5, 2.6));
    if (outer > inner * 1.15) {
      rings.push({ innerM: inner, outerM: outer, opacity: rng.range(0.25, 0.95), iceFraction: rng.range(0.3, 0.99) });
    }
  }

  const habitable = !isGiant && cls !== 'mini-neptune' && cls !== 'ice-giant'
    && surfaceK > 260 && surfaceK < 330 && ocean > 0.05
    && pressureBar > 0.08 && pressureBar < 12;
  const biosphere = habitable
    ? Math.max(0, Math.min(1, rng.normal(0.5, 0.32))) * (star.ageGyr > 1 ? 1 : 0.2)
    : 0;

  const cloudCover = isGiant ? 1
    : pressureBar < 0.01 ? 0
    : Math.min(0.95, ocean * rng.range(0.4, 0.9) + rng.range(0, 0.25));

  return {
    index,
    name: `${starName} ${ROMAN[index] ?? index + 1}`,
    cls,
    massKg,
    radiusM,
    density: massKg / ((4 / 3) * Math.PI * radiusM ** 3),
    gravity,
    escapeVelocity: vEsc,
    au,
    periodS,
    dayS,
    obliquity,
    albedo,
    teqK: teq,
    surfaceK,
    pressureBar,
    atmosphere,
    oceanFraction: ocean,
    cloudCover,
    tidallyLocked: locked,
    habitable,
    biosphere,
    moons,
    rings,
    color: biosphere > 0.25 ? [0.065, 0.155, 0.08] : c1,
    color2: c2,
    surfaceSeed: rng.nextUint(),
    magnetism,
    elements: {
      a: au * AU,
      e: Math.min(0.6, Math.abs(rng.normal(0, isGiant ? 0.04 : 0.07))),
      i: Math.abs(rng.normal(0, 1.8)) * DEG,
      Omega: rng.range(0, Math.PI * 2),
      omega: rng.range(0, Math.PI * 2),
      M0: rng.range(0, Math.PI * 2),
      epoch: 0,
    },
  };
}

/** Human description of a planet class. */
export const CLASS_LABEL: Record<PlanetClass, string> = {
  iron: 'Iron world',
  rocky: 'Rocky world',
  desert: 'Desert world',
  ocean: 'Ocean world',
  terrestrial: 'Terrestrial world',
  lava: 'Lava world',
  carbon: 'Carbon world',
  tundra: 'Tundra world',
  ice: 'Ice world',
  'super-earth': 'Super-Earth',
  'mini-neptune': 'Mini-Neptune',
  'ice-giant': 'Ice giant',
  'gas-giant': 'Gas giant',
  'hot-jupiter': 'Hot Jupiter',
  puffy: 'Inflated giant',
};

export { M_JUPITER, R_JUPITER, YEAR };
