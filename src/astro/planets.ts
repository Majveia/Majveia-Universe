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
  SIGMA_SB, YEAR, rocheLimit,
} from '../core/constants';
import { RNG, derive } from '../core/rng';
import type { Star } from './stellar';
import { hillRadius, period, tidalLockingTimeYears, type OrbitalElements } from '../physics/kepler';
import { planetRegion, combinedLuminosity, type Companion, type PlanetHost } from './binary';
import { makeComet, type Comet } from './comet';
import {
  carbonCycle, outgassingRate, solveClimate, thermostatSetpoint, type Climate,
} from './climate';
import { irradiance } from './insolation';
import {
  liquidWaterPossible, T_FREEZE, type Atmosphere,
} from './radiation';

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
  /**
   * Global mean surface temperature, K, from an energy balance rather than an
   * offset: absorbed sunlight against what the atmosphere can radiate.
   */
  surfaceK: number;
  /** Temperature the planet radiates at, K - what an infrared telescope sees. */
  effectiveK: number;
  /** Greenhouse warming, K. Earth's is 33; Venus's is 505. */
  greenhouseK: number;
  /** Surface pressure, bar. 0 means airless. */
  pressureBar: number;
  /** Partial pressure of CO2, bar, as the carbonate-silicate cycle left it. */
  co2Bar: number;
  /** The column, in the form the radiation and climate models need. */
  air: Atmosphere;
  /** Dominant atmospheric species. */
  atmosphere: string;
  /**
   * Water accreted at formation, as the fraction of the surface it would cover
   * if it were all liquid. What state it is in now is the climate's business.
   */
  waterInventory: number;
  /** Fraction of the surface covered by liquid. */
  oceanFraction: number;
  /** Fraction of the surface covered by ice. */
  iceFraction: number;
  /** Whether this world lost its oceans to a runaway greenhouse. */
  runaway: boolean;
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
  // This albedo is the *surface* one - rock, ice, ocean, cloud - with the sky's
  // own scattering added afterwards, once the atmosphere is known.
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
  const irr = irradiance(L, au);
  const ecc = Math.min(0.6, Math.abs(rng.normal(0, isGiant ? 0.04 : 0.07)));

  // --- Water delivered at formation.
  //
  // The snow line decides this and almost nothing else does. A core assembled
  // beyond it is a quarter ice by mass; one assembled inside it is dry rock,
  // and whatever water it has arrived afterwards on things that fell in from
  // further out. The Earth's oceans are two parts in ten thousand of its mass
  // and none of that water formed where it now sits.
  const waterInventory = isGiant ? 1
    : waterRich ? rng.range(0.6, 1)
    : insideSnow ? Math.max(0, rng.normal(0.22, 0.32))
    : rng.range(0.35, 0.95);

  // --- What the planet can hold on to, by the Jeans parameter per species.
  const lamH2 = jeansParameter(massKg, radiusM, teq, 2);
  const lamN2 = jeansParameter(massKg, radiusM, teq, 28);
  const lamCO2 = jeansParameter(massKg, radiusM, teq, 44);

  // The non-condensing background: hydrogen if the planet was big enough and
  // cold enough to keep the disc's own gas, otherwise outgassed nitrogen in
  // proportion to the mantle available to degas it.
  let backgroundBar = 0;
  let atmosphere = 'none';
  let molarMass = 28.0;
  let cp = 1040;
  /** Mole fraction of whatever in the column absorbs in the infrared. */
  let greenhouseGas = 0;
  const hydrogenEnvelope = isGiant || lamH2 > 40;
  if (hydrogenEnvelope) {
    backgroundBar = isGiant ? 1e5 : rng.range(1, 200);
    atmosphere = 'H₂ / He';
    // Hydrogen has no infrared bands of its own, but two hydrogen molecules
    // colliding do: the pair has a fleeting dipole for as long as the collision
    // lasts, and collision-induced absorption goes as the square of the
    // density. It is the dominant opacity in every giant atmosphere there is.
    molarMass = 2.3; cp = 12000; greenhouseGas = 0.08;
  } else if (lamN2 > 30) {
    backgroundBar = Math.min(40, 0.9 * mEarth * rng.logNormal(1, 0.9));
    atmosphere = 'N₂';
  } else if (lamCO2 > 22) {
    backgroundBar = Math.min(6, 0.12 * mEarth * rng.logNormal(1, 1.1));
    atmosphere = 'CO₂';
    molarMass = 44.01; cp = 846; greenhouseGas = 0.9;
  } else if (lamCO2 > 12) {
    backgroundBar = rng.range(0.0008, 0.02);
    atmosphere = 'trace CO₂';
    molarMass = 44.01; cp = 846; greenhouseGas = 0.9;
  }

  // How hard the interior is still working. Everything about the carbon cycle
  // follows from this: what there is to outgas, how fast it comes out, and
  // therefore where the thermostat sits.
  const outgassing = outgassingRate(mEarth, star.ageGyr) * rng.logNormal(1, 0.5);

  // Carbon inventory, as the surface pressure it would make if every gram of
  // it were in the air at once. The Earth's carbonate rock holds about sixty
  // bars of carbon dioxide; Venus's sky holds ninety. A planet whose interior
  // has gone cold cannot get at its own carbon, however much of it there is.
  const carbonBar = backgroundBar > 0 && !hydrogenEnvelope
    ? 60 * Math.pow(mEarth, 0.9) * Math.min(1, outgassing) * rng.logNormal(1, 0.4) : 0;

  // --- Rotation and tides, needed before the climate: a locked world has a
  //     different climate problem from a spinning one.
  const periodS = period(au * AU, G * (star.currentMassMsun * M_SUN + massKg));
  const lockYears = tidalLockingTimeYears(au * AU, massKg, radiusM, star.currentMassMsun * M_SUN);
  const locked = lockYears < star.ageGyr * 1e9;
  let dayS = locked ? periodS : rng.logNormal(isGiant ? 3.6e4 : 9e4, 0.8);
  if (!locked && rng.chance(0.06)) dayS = -dayS;  // retrograde, as Venus is
  const obliquity = rng.chance(0.05) ? rng.range(60, 120) * DEG : Math.abs(rng.normal(0, 22)) * DEG;

  // --- Temperature, from an energy budget rather than an offset.
  let pressureBar = backgroundBar;
  let surfaceK: number;
  let effectiveK: number;
  let greenhouseK = 0;
  let ocean = 0;
  let iceFraction = 0;
  let co2Bar = 0;
  let runaway = false;
  let air: Atmosphere = {
    pressureBar, greenhouseFraction: 0, molarMass, cp,
    water: false, humidity: 0.7,
  };

  // Somewhere under a hundred bars of hydrogen the idea of a surface stops
  // meaning anything: there is no line where the air ends and the ground
  // begins, only gas getting steadily denser until it is a fluid. For those
  // worlds the number worth quoting is the temperature at one bar.
  const noSurface = isGiant || (hydrogenEnvelope && backgroundBar > 8);

  if (noSurface) {
    // There is no surface, so there is no surface temperature - only the
    // temperature at one bar, and it is not set by sunlight alone. A giant is
    // still shrinking, and the gravitational energy it releases doing so comes
    // out as heat: Jupiter radiates two-thirds again as much as it absorbs, so
    // it is 15 K warmer than the Sun could make it.
    const tInt = 100 * Math.pow(Math.max(mEarth / 317.8, 0.02), 0.45)
      * Math.pow(Math.max(star.ageGyr, 0.05) / 4.5, -0.3);
    effectiveK = Math.pow(teq ** 4 + tInt ** 4, 0.25);
    // The one-bar level sits under about a bar of hydrogen, and that bar has a
    // greenhouse of its own. Jupiter radiates at 124 K and is 165 K where the
    // pressure reads one atmosphere; the gap is collision-induced absorption.
    const tau1bar = 4.229 * Math.pow(0.08, 0.390);
    surfaceK = effectiveK * Math.pow(1 + 0.75 * tau1bar, 0.25);
    greenhouseK = surfaceK - effectiveK;
    pressureBar = backgroundBar;
    air = {
      pressureBar: backgroundBar, greenhouseFraction: 0.08,
      molarMass: 2.3, cp: 12000, water: false, humidity: 0,
    };
  } else if (backgroundBar <= 0) {
    // Airless: every point sits in its own radiative equilibrium, and the
    // global mean of T is well below the temperature of the mean flux, because
    // emission goes as the fourth power and the hot side does the radiating.
    surfaceK = teq * 0.82;
    effectiveK = teq;
    air = { ...air, pressureBar: 0 };
  } else {
    const surfaceAlbedo = albedo;
    const base: Atmosphere = {
      pressureBar: backgroundBar, greenhouseFraction: greenhouseGas, molarMass, cp,
      water: waterInventory > 0.01, humidity: hydrogenEnvelope ? 0 : 0.7,
    };
    // Where the thermostat sits is not a constant. It is where this planet's
    // volcanoes and this planet's rain come into balance.
    const setpoint = thermostatSetpoint(outgassing, 1 - Math.min(waterInventory, 0.98));
    let cycle = carbonCycle(
      irr, ecc, base, surfaceAlbedo, waterInventory, carbonBar, star.teff, setpoint);

    if (cycle.limit === 'runaway') {
      // The inner edge, reached. The ocean boils; with no rain there is no
      // weathering; with no weathering nothing buries carbon, so every gram
      // the planet ever outgassed ends up in the sky and stays there. This is
      // the whole of Venus, and it is three lines because the physics that
      // does it is three lines.
      runaway = true;
      cycle = carbonCycle(
        irr, ecc, { ...base, water: false, humidity: 0 },
        Math.min(surfaceAlbedo + 0.35, 0.78), 0, carbonBar, star.teff, setpoint);
      atmosphere = 'CO₂ (runaway)';
    }
    co2Bar = cycle.co2Bar;
    pressureBar = cycle.pressureBar;
    air = {
      pressureBar,
      greenhouseFraction: Math.max(cycle.fraction, greenhouseGas * backgroundBar / Math.max(pressureBar, 1e-9)),
      molarMass: (molarMass * backgroundBar + 44.01 * co2Bar) / Math.max(pressureBar, 1e-9),
      cp: (cp * backgroundBar + 846 * co2Bar) / Math.max(pressureBar, 1e-9),
      water: !runaway && waterInventory > 0.01,
      humidity: hydrogenEnvelope ? 0 : 0.7,
    };
    if (!hydrogenEnvelope && co2Bar > backgroundBar * 0.5 && !runaway) {
      atmosphere = co2Bar > backgroundBar * 8 ? 'CO₂' : 'N₂ / CO₂';
    }
    // The albedo the cycle actually settled on - ground, sky and ice together -
    // is the one the emission temperature has to be worked out from, or a
    // frozen world comes back claiming a negative greenhouse.
    albedo = cycle.albedo;
    surfaceK = cycle.tempK;
    effectiveK = Math.pow(Math.max(irr * (1 - albedo) / 4, 1e-9) / SIGMA_SB, 0.25);
    greenhouseK = surfaceK - effectiveK;
  }

  // --- Water, now that the temperature is known. The inventory decides how
  //     much there is; the climate decides how much of it is liquid.
  if (!noSurface && !hydrogenEnvelope && waterInventory > 0.005) {
    if (liquidWaterPossible(surfaceK, pressureBar)) {
      ocean = Math.min(1, waterInventory);
    } else if (surfaceK <= T_FREEZE && surfaceK > 30) {
      iceFraction = Math.min(1, waterInventory);
    }
  }
  const teqForClass = noSurface ? teq : surfaceK;
  const cls = classify(mEarth, teqForClass, Math.max(ocean, iceFraction * 0.6), insideSnow,
    pressureBar, hydrogenEnvelope);
  const [c1, c2] = PALETTE[cls];

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

  // Habitable means what it says: liquid water sitting on a surface, under a
  // pressure a body could stand in, on a world that has not lost its oceans.
  const habitable = !noSurface && !hydrogenEnvelope && !runaway
    && cls !== 'mini-neptune' && cls !== 'ice-giant'
    && liquidWaterPossible(surfaceK, pressureBar) && ocean > 0.05
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
    effectiveK,
    greenhouseK,
    pressureBar,
    co2Bar,
    air,
    atmosphere,
    waterInventory,
    oceanFraction: ocean,
    iceFraction,
    runaway,
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
      e: ecc,
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


// ---------------------------------------------------------------------------
// The full climate, on demand
// ---------------------------------------------------------------------------

/**
 * Every planet gets a global mean surface temperature at formation, because
 * that is cheap and the classification needs it. Almost none of them ever get
 * looked at closely. So the latitude-by-season model - which costs a hundred
 * times as much and answers questions nobody asks of a planet seen as a dot -
 * is run only when somebody actually goes there, and remembered afterwards.
 */
const CLIMATE_CACHE = new WeakMap<Planet, Climate>();

/** The seasonal, latitude-resolved climate of a world. Solved once, then kept. */
export function planetClimate(p: Planet, star: Star, luminosityLsun: number): Climate {
  const hit = CLIMATE_CACHE.get(p);
  if (hit) return hit;
  const cl = solveClimate({
    irradiance: irradiance(luminosityLsun, p.au),
    periodS: p.periodS,
    dayS: p.dayS,
    obliquity: p.obliquity,
    eccentricity: p.elements.e,
    // The longitude of periapsis relative to the equinox is not tracked as an
    // orbital element here, so it comes from the argument of periapsis - which
    // is the same angle measured from the node instead of the equinox, and for
    // a planet with a small inclination the difference is small.
    precession: p.elements.omega,
    atmosphere: p.air,
    gravity: p.gravity,
    radiusM: p.radiusM,
    oceanFraction: Math.max(p.waterInventory, p.oceanFraction),
    albedo: p.albedo,
    tidallyLocked: p.tidallyLocked,
    starTeff: star.teff,
  });
  CLIMATE_CACHE.set(p, cl);
  return cl;
}

/** Whether the full model has anything to say about this world. */
export const hasClimate = (p: Planet): boolean =>
  p.pressureBar > 1e-4 && p.massKg < 12 * M_EARTH;
