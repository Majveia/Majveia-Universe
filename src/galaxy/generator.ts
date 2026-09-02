/**
 * Procedural galaxies.
 *
 * The spiral arms here are *kinematic density waves*, not painted textures and
 * not rigidly rotating spokes. Each star is placed on a closed elliptical orbit
 * about the galactic centre, and the orientation of that ellipse increases
 * logarithmically with the orbit's size:
 *
 *     phi(a) = phi0 + ln(a / a0) / tan(pitch)
 *
 * Nested, progressively-rotated ellipses crowd together along a logarithmic
 * spiral. That crowding *is* the arm. Stars stream through it at their own
 * orbital rate - fast on the inside, slow on the outside - while the pattern
 * itself turns at a single slow pattern speed, so the arms never wind up.
 * This is Lindblad's explanation of spiral structure, and it is the reason a
 * galaxy in this simulation can rotate for ten billion years without smearing.
 *
 * Everything else follows from measured scaling relations: exponential discs,
 * sech^2 vertical structure, a Sersic bulge, a flat rotation curve produced by
 * a dark-matter halo, a Kroupa IMF for the stellar population, and dust that
 * sits on the inner edge of the arms where the gas shocks.
 */

import { RNG, derive } from '../core/rng';
import { blackbodyRGB } from '../astro/blackbody';
import { makeStar, sampleKroupaIMF, msLifetimeGyr } from '../astro/stellar';

export type HubbleType = 'Sa' | 'Sb' | 'Sc' | 'SBa' | 'SBb' | 'SBc' | 'S0' | 'E' | 'Irr';

export interface GalaxyParams {
  seed: number;
  type: HubbleType;
  /** Total stellar mass, solar masses. */
  stellarMassMsun: number;
  /** Disc exponential scale length, kpc. */
  discScaleKpc: number;
  /** Optical radius (R25), kpc. */
  radiusKpc: number;
  /** Thin-disc scale height, kpc. */
  thicknessKpc: number;
  /** Bulge effective radius, kpc. */
  bulgeRadiusKpc: number;
  /** Bulge fraction of the stellar mass. */
  bulgeFraction: number;
  /** Number of spiral arms. */
  arms: number;
  /** Arm pitch angle, radians (10-30 degrees for real spirals). */
  pitch: number;
  /** Peak circular velocity, km/s. */
  vMaxKms: number;
  /** Radius at which the rotation curve flattens, kpc. */
  vTurnKpc: number;
  /** Pattern speed of the density wave, km/s/kpc. */
  patternSpeed: number;
  /** Age of the stellar population, Gyr. */
  ageGyr: number;
  /** Mean metallicity [Fe/H]. */
  metallicity: number;
  /** Dust optical depth normalisation. */
  dust: number;
  /** Mass of the central supermassive black hole, solar masses. */
  blackHoleMsun: number;
  /** Star-formation rate, solar masses per year - drives the blue population. */
  sfrMsunYr: number;
  name: string;
}

export interface GalaxyBuffers {
  count: number;
  /** (a, b, theta0, omega) - orbit semi-axes in kpc, phase, angular rate rad/Myr. */
  orbit: Float32Array;
  /**
   * (tilt0, z, luminosity, kind). Kinds:
   *   0 disc (resolved)   1 bulge (resolved)  2 halo / globulars
   *   3 H II region       4 young / OB        5 disc (unresolved)
   *   6 bulge (unresolved) 7 supernova remnant
   */
  star: Float32Array;
  /** Linear-light RGB. */
  color: Float32Array;
  /** Shell radius of each supernova remnant, parsecs, in emission order. */
  snrRadiusPc: Float32Array;
  params: GalaxyParams;
  /** Handy summary numbers for the inspector. */
  stats: {
    starCount: number;
    hiiCount: number;
    snrCount: number;
    /** True number of remnants the galaxy holds, before the sprite cap. */
    snrTrueCount: number;
    /** Supernovae per century, both channels. */
    supernovaePerCentury: number;
    totalSampledLuminosity: number;
    rotationPeriodMyr: number;
    escapeVelocityKms: number;
    darkMatterFraction: number;
  };
}

const TYPES: HubbleType[] = ['Sa', 'Sb', 'Sc', 'SBa', 'SBb', 'SBc', 'S0', 'E', 'Irr'];

/**
 * Draw a galaxy's macroscopic properties from its halo mass, using the
 * abundance-matching stellar-to-halo mass relation and the observed
 * size-mass and Tully-Fisher scalings.
 */
export function galaxyFromHalo(seed: number, haloMassMsun: number, environmentDensity = 0): GalaxyParams {
  const rng = new RNG(seed);

  // Stellar-to-halo mass: peaks near 2-3% at Mh ~ 1e12 and falls either side.
  const m12 = haloMassMsun / 1e12;
  const efficiency = 0.032 / (Math.pow(m12, -0.9) + Math.pow(m12, 0.6));
  const stellarMass = Math.max(1e6, haloMassMsun * efficiency * rng.logNormal(1, 0.22));

  // Morphology-density relation: ellipticals dominate in cluster cores.
  const eProb = Math.min(0.85, 0.06 + 0.75 * environmentDensity + 0.35 * Math.min(1, stellarMass / 3e11));
  let type: HubbleType;
  if (rng.chance(eProb)) type = rng.chance(0.25) ? 'S0' : 'E';
  else if (stellarMass < 2e8) type = 'Irr';
  else {
    const barred = rng.chance(0.55); // roughly two thirds of spirals are barred
    const late = rng.next();
    const fam = late < 0.3 ? 'a' : late < 0.68 ? 'b' : 'c';
    type = ((barred ? 'SB' : 'S') + fam) as HubbleType;
  }

  // Size-mass relation for discs: R_d ~ 3 kpc (M*/5e10)^0.3
  const discScale = 3.0 * Math.pow(stellarMass / 5e10, 0.3) * rng.logNormal(1, 0.2);
  const radius = discScale * rng.range(3.6, 5.2);

  // Tully-Fisher: M* ~ V^4
  const vMax = 200 * Math.pow(stellarMass / 5e10, 0.25) * rng.logNormal(1, 0.1);

  const spiral = type.startsWith('S') && type !== 'S0';
  const late = type.endsWith('c');
  const arms = spiral ? (rng.chance(0.62) ? 2 : rng.chance(0.6) ? 4 : 3) : 0;
  const pitch = (late ? rng.range(18, 30) : type.endsWith('b') ? rng.range(12, 20) : rng.range(6, 13))
    * Math.PI / 180;

  const bulgeFraction = type === 'E' ? 1 : type === 'S0' ? 0.6
    : type.endsWith('a') ? 0.35 : type.endsWith('b') ? 0.18 : 0.06;

  // M-sigma relation: M_BH ~ 0.002 M_bulge
  const blackHole = Math.max(1e5, 0.002 * stellarMass * Math.max(bulgeFraction, 0.02) * rng.logNormal(1, 0.4));

  const ageGyr = type === 'E' || type === 'S0' ? rng.range(9, 12.5) : rng.range(6, 11.5);
  const sfr = type === 'E' ? rng.range(0, 0.05)
    : type === 'S0' ? rng.range(0.05, 0.4)
    : (stellarMass / 5e10) * rng.range(0.8, 6);

  return {
    seed,
    type,
    name: galaxyName(rng),
    stellarMassMsun: stellarMass,
    discScaleKpc: discScale,
    radiusKpc: radius,
    thicknessKpc: discScale * (late ? 0.10 : 0.14) * rng.logNormal(1, 0.15),
    bulgeRadiusKpc: Math.max(0.2, discScale * (type === 'E' ? 1.2 : 0.35)),
    bulgeFraction,
    arms,
    pitch,
    vMaxKms: vMax,
    vTurnKpc: discScale * 0.6,
    // Pattern speed is set so corotation sits near 2.2 disc scale lengths,
    // which is where real bars and spirals put it.
    patternSpeed: vMax / (2.2 * discScale) * rng.range(0.85, 1.15),
    ageGyr,
    metallicity: Math.min(0.5, -0.6 + 0.35 * Math.log10(stellarMass / 1e9)) + rng.normal(0, 0.12),
    dust: spiral ? rng.range(0.5, 1.5) * (late ? 1.2 : 0.8) : rng.range(0.02, 0.2),
    blackHoleMsun: blackHole,
    sfrMsunYr: sfr,
  };
}

const PREFIX = ['NGC', 'IC', 'UGC', 'PGC', 'ESO', 'Arp', 'Maffei', 'Hoag'];
function galaxyName(rng: RNG): string {
  return `${rng.pick(PREFIX)} ${rng.int(104, 9899)}`;
}

/** Circular velocity from a flat-ish rotation curve, km/s. */
export const rotationCurve = (p: GalaxyParams, rKpc: number): number =>
  p.vMaxKms * Math.tanh(rKpc / Math.max(p.vTurnKpc, 1e-3));

/** Angular rate in radians per megayear. 1 km/s = 1.0227 kpc/Gyr. */
export function angularRate(p: GalaxyParams, rKpc: number): number {
  if (rKpc < 1e-4) return 0;
  return (rotationCurve(p, rKpc) * 1.02271e-3) / rKpc;
}

/**
 * Epicyclic frequency kappa = sqrt(4 Omega^2 (1 + (R/2Omega) dOmega/dR)).
 * For a flat rotation curve kappa = sqrt(2) Omega, which is exactly the
 * condition that makes Omega - kappa/2 nearly constant with radius - the
 * reason a two-armed spiral can be a long-lived standing wave.
 */
export function epicyclicFrequency(p: GalaxyParams, rKpc: number): number {
  const h = Math.max(rKpc * 1e-3, 1e-4);
  const O = angularRate(p, rKpc);
  const dO = (angularRate(p, rKpc + h) - angularRate(p, rKpc - h)) / (2 * h);
  return Math.sqrt(Math.max(0, 4 * O * O * (1 + (rKpc / (2 * Math.max(O, 1e-12))) * dO)));
}

/** Sample a radius from an exponential disc by inverting its cumulative profile. */
function sampleExponentialDisc(rng: RNG, scale: number, rMax: number): number {
  const uMax = 1 - Math.exp(-rMax / scale) * (1 + rMax / scale);
  for (let i = 0; i < 40; i++) {
    const u = rng.next() * uMax;
    // Invert 1 - e^{-x}(1+x) = u by bisection on x = r/scale
    let lo = 0, hi = rMax / scale;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (1 - Math.exp(-mid) * (1 + mid) < u) lo = mid; else hi = mid;
    }
    const r = ((lo + hi) / 2) * scale;
    if (r <= rMax) return r;
  }
  return rng.next() * rMax;
}

/** sech^2 vertical profile: the isothermal self-gravitating sheet. */
function sampleSech2(rng: RNG, z0: number): number {
  const u = rng.range(-0.9999, 0.9999);
  return z0 * Math.atanh(u);
}

export interface BuildOptions {
  /** How many point sprites to emit. Visual sampling, not physical star count. */
  count?: number;
  /** Fraction of sprites given to HII regions. */
  hiiFraction?: number;
}

export function buildGalaxy(p: GalaxyParams, opts: BuildOptions = {}): GalaxyBuffers {
  const count = opts.count ?? 320000;
  const rng = derive(p.seed, 'stars');
  const orbit = new Float32Array(count * 4);
  const star = new Float32Array(count * 4);
  const color = new Float32Array(count * 3);

  const elliptical = p.type === 'E' || p.type === 'S0';
  const hiiFrac = elliptical ? 0.0005 : (opts.hiiFraction ?? 0.012) * Math.min(2, 0.4 + p.sfrMsunYr / 3);
  const bulgeN = Math.floor(count * p.bulgeFraction * 0.72);
  const haloN = Math.floor(count * 0.035);
  const hiiN = Math.floor(count * hiiFrac);
  // Unresolved starlight. At any realistic sprite budget the overwhelming
  // majority of a galaxy's stars cannot be drawn individually, and a galaxy
  // rendered as bare points looks like confetti. These sprites carry that
  // light as broad, faint gaussians - the same smooth surface brightness a
  // photographic plate records - and they orbit with everything else, so dust
  // lanes cut across a continuous disc instead of across empty space.
  const diffDiscN = Math.floor(count * 0.17);
  const diffBulgeN = Math.floor(count * 0.06 * (0.3 + p.bulgeFraction));
  // Supernova remnants. The steady-state number is the rate times the lifetime:
  // a galaxy forming a few solar masses a year holds several thousand of them
  // at any moment, each a few tens of parsecs across and a few hundred thousand
  // years old. They are drawn as a population rather than as events, because
  // that is what they are on any timescale you can watch.
  const snrLifetimeYr = 3e5;
  const snrTrue = (p.sfrMsunYr / 100 + 4e-14 * p.stellarMassMsun) * snrLifetimeYr;
  const snrN = Math.min(Math.floor(count * 0.012), Math.max(0, Math.round(snrTrue)));
  const discN = count - bulgeN - haloN - hiiN - diffDiscN - diffBulgeN - snrN;

  const tanPitch = Math.tan(p.pitch);
  const a0 = Math.max(0.35, p.discScaleKpc * 0.55);

  // --- The bar.
  //
  // In this orbital picture a bar is trivial and exact: it is the region where
  // the orbit ellipses stop precessing with radius and all line up at the same
  // angle. Nested aligned ellipses of increasing size are a bar. Outside the
  // bar's corotation the ellipses resume winding and become the spiral arms,
  // which is also why real bars end where their spirals begin.
  const barred = p.type.startsWith('SB');
  const barRadius = barred ? p.discScaleKpc * 1.5 : 0;
  const barAngle = 0;
  const orbitTilt = (a: number): number => {
    const spiral = Math.log(Math.max(a, 0.02) / a0) / tanPitch;
    if (!barred || a >= barRadius) return spiral;
    const w = Math.pow(a / barRadius, 2.2);     // smooth handover at the bar end
    return barAngle * (1 - w) + spiral * w;
  };
  const barEcc = (a: number): number => {
    if (!barred || a >= barRadius) return 0;
    return 0.45 * (1 - Math.pow(a / barRadius, 2.0));
  };

  // Fraction of the disc that is young and blue, from the specific SFR.
  const youngFrac = Math.min(0.16, 0.008 + (p.sfrMsunYr * 1e9) / Math.max(p.stellarMassMsun, 1) * 2.2);

  const snrRadiusPc: number[] = [];
  let i = 0;
  const put = (
    a: number, b: number, theta0: number, omega: number,
    tilt: number, z: number, lum: number, kind: number,
    r: number, g: number, bl: number,
  ) => {
    orbit[i * 4] = a; orbit[i * 4 + 1] = b; orbit[i * 4 + 2] = theta0; orbit[i * 4 + 3] = omega;
    star[i * 4] = tilt; star[i * 4 + 1] = z; star[i * 4 + 2] = lum; star[i * 4 + 3] = kind;
    color[i * 3] = r; color[i * 3 + 1] = g; color[i * 3 + 2] = bl;
    i++;
  };

  // --- Population synthesis.
  //
  // Draw a real star and use its real colour and luminosity. Two details do
  // most of the work in making a galaxy look like a galaxy:
  //
  //  - Red giants. They are about 1% of an old population by number and about
  //    half of its light. Without them a bulge renders as a dim grey smudge
  //    instead of the warm orange it actually is.
  //  - The young population is drawn from a Salpeter slope down to 1.6 Msun,
  //    so it is mostly A and B stars with a rare O star, which is why the arms
  //    come out blue-white with occasional brilliant points rather than a
  //    uniform neon stripe.
  const turnoff = massAtLifetime(p.ageGyr);
  const popColor = (ageGyr: number, metal: number, forceYoung = false): [number, number, number, number] => {
    let m: number;
    let age: number;
    if (forceYoung) {
      m = rng.powerLaw(-2.3, 1.6, 45);
      age = rng.range(0.002, Math.min(0.9, msLifetimeGyr(m) * 0.85));
    } else {
      m = sampleKroupaIMF(rng, 0.15, 40);
      const to = massAtLifetime(ageGyr);
      if (msLifetimeGyr(m) < ageGyr) {
        if (rng.chance(0.022)) {
          // Caught in the giant branch: brief, but it dominates the light
          m = to * rng.range(0.98, 1.03);
          age = msLifetimeGyr(m) * rng.range(1.001, 1.1);
          const s0 = makeStar(m, age, metal);
          return [s0.color[0], s0.color[1], s0.color[2], Math.max(1e-4, s0.luminosityLsun)];
        }
        m = sampleKroupaIMF(rng, 0.15, Math.max(0.3, to));
      }
      age = rng.range(ageGyr * 0.4, ageGyr);
    }
    const s = makeStar(m, age, metal);
    return [s.color[0], s.color[1], s.color[2], Math.max(1e-4, s.luminosityLsun)];
  };
  void turnoff;

  // --- Disc
  for (let k = 0; k < discN; k++) {
    const a = Math.max(0.05, sampleExponentialDisc(rng, p.discScaleKpc, p.radiusKpc * 1.35));
    const young = !elliptical &&
      rng.chance(youngFrac * (0.35 + 1.1 * Math.exp(-a / (p.radiusKpc * 0.75))));
    // Eccentricity of the closed orbit: small, and smaller for the cold young
    // population that has not yet been scattered by giant molecular clouds.
    // Orbit eccentricity sets how hard the nested ellipses crowd, and therefore
    // how much contrast the arms have. Real disc orbits are mildly eccentric;
    // the cold young population, not yet scattered by molecular clouds, is
    // closer to circular and so traces the wave more sharply.
    const ecc = (young ? 0.09 : 0.24) * (1 + 0.5 * Math.exp(-a / p.discScaleKpc)) * rng.logNormal(1, 0.28)
      + barEcc(a);
    const b = a * (1 - Math.min(0.72, ecc));
    const tilt = orbitTilt(a) + rng.normal(0, barred && a < barRadius ? 0.06 : 0.02);
    const omega = angularRate(p, a);
    const z = sampleSech2(rng, p.thicknessKpc * (young ? 0.45 : 1.0));
    const metal = p.metallicity - 0.35 * (a / p.radiusKpc) + rng.normal(0, 0.1);
    const [r, g, bl, L] = popColor(p.ageGyr, metal, young);
    put(a, b, rng.range(0, Math.PI * 2), omega, tilt, z, L, young ? 4 : 0, r, g, bl);
  }

  // --- Unresolved disc light.
  //
  // Part of it is the old, yellow, dynamically hot population spread smoothly
  // through the disc; part of it is the integrated light of young clusters,
  // which is blue and, being kinematically cold, crowds hard onto the arms.
  // Splitting the diffuse component this way is what gives a spiral its
  // characteristic colour gradient: warm between the arms, blue along them.
  const blueDiffuse = Math.min(0.55, 0.12 + youngFrac * 2.6);
  for (let k = 0; k < diffDiscN; k++) {
    const a = Math.max(0.05, sampleExponentialDisc(rng, p.discScaleKpc, p.radiusKpc * 1.5));
    const isBlue = !elliptical &&
      rng.chance(blueDiffuse * (0.3 + 1.15 * Math.exp(-a / (p.radiusKpc * 0.8))));
    const ecc = (isBlue ? 0.085 : 0.22) * (1 + 0.5 * Math.exp(-a / p.discScaleKpc))
      * rng.logNormal(1, 0.25) + barEcc(a);
    const tilt = orbitTilt(a) + rng.normal(0, isBlue ? 0.015 : 0.04);
    const metal = p.metallicity - 0.35 * (a / p.radiusKpc);
    let r: number, g: number, bl: number;
    if (isBlue) {
      // Integrated light of a young cluster: an early-A colour temperature
      const c = blackbodyRGB(rng.range(7600, 12500));
      r = c[0]; g = c[1]; bl = c[2];
    } else {
      const c = popColor(p.ageGyr, metal);
      r = c[0]; g = c[1]; bl = c[2];
    }
    put(a, a * (1 - Math.min(0.7, ecc)), rng.range(0, Math.PI * 2), angularRate(p, a),
      tilt, sampleSech2(rng, p.thicknessKpc * (isBlue ? 0.6 : 1.2)), isBlue ? 1.6 : 1, 5, r, g, bl);
  }

  // --- Unresolved bulge light.
  for (let k = 0; k < diffBulgeN; k++) {
    const u = rng.next();
    const sq = Math.sqrt(u);
    const rr = Math.min(p.bulgeRadiusKpc * 5, (p.bulgeRadiusKpc * sq) / Math.max(1e-3, 1 - sq));
    const dir = rng.onSphere();
    const a = Math.max(0.02, rr * Math.hypot(dir[0], dir[1]));
    const [r, g, bl] = popColor(p.ageGyr + 1.2, p.metallicity + 0.28);
    put(a, a * rng.range(0.8, 1.0), rng.range(0, Math.PI * 2),
      angularRate(p, Math.max(a, 0.05)) * 0.6, rng.range(0, Math.PI * 2),
      rr * dir[2] * (p.type === 'E' ? 0.85 : 0.7), 1, 6, r, g, bl);
  }

  // --- Bulge: pressure supported, near-spherical, old and metal rich.
  for (let k = 0; k < bulgeN; k++) {
    // Hernquist profile r = Re u^{1/2}/(1-u^{1/2}) sampled by inversion
    const u = rng.next();
    const s = Math.sqrt(u);
    const rr = Math.min(p.bulgeRadiusKpc * 6, (p.bulgeRadiusKpc * s) / Math.max(1e-3, 1 - s));
    const dir = rng.onSphere();
    const flat = p.type === 'E' ? rng.range(0.55, 1.0) : 0.7;
    const a = Math.max(0.02, rr * Math.hypot(dir[0], dir[1]));
    const [r, g, bl, L] = popColor(p.ageGyr + 1.2, p.metallicity + 0.28);
    put(a, a * rng.range(0.75, 1.0), rng.range(0, Math.PI * 2),
      angularRate(p, Math.max(a, 0.05)) * (elliptical ? 0.25 : 0.6),
      rng.range(0, Math.PI * 2), rr * dir[2] * flat, L, 1, r, g, bl);
  }

  // --- Stellar halo and globular clusters: old, metal poor, no rotation.
  for (let k = 0; k < haloN; k++) {
    const rr = p.radiusKpc * Math.pow(rng.next(), 0.42) * rng.range(0.4, 2.6);
    const dir = rng.onSphere();
    const a = Math.max(0.05, rr * Math.hypot(dir[0], dir[1]));
    const [r, g, bl, L] = popColor(12.5, p.metallicity - 1.4);
    const globular = rng.chance(0.008);
    put(a, a * rng.range(0.4, 1.0), rng.range(0, Math.PI * 2), angularRate(p, a) * 0.15,
      rng.range(0, Math.PI * 2), rr * dir[2], globular ? L * 900 : L, 2, r, g, bl);
  }

  // --- H II regions.
  //
  // Ionised hydrogen around the O stars that formed minutes ago in cosmic
  // terms, in the shock where gas piles into the density wave. They are locked
  // to the pattern rather than to any star, because star formation happens
  // where the wave is. They also come in *complexes* - a few hundred giant
  // molecular clouds per galaxy, each spawning a knot of H II regions - so they
  // are generated as clustered blobs rather than sprinkled along a line.
  const complexes = Math.max(8, Math.floor(hiiN / 30));
  let hiiPlaced = 0;
  for (let c = 0; c < complexes && hiiPlaced < hiiN; c++) {
    const ac = Math.max(p.discScaleKpc * 0.22,
      sampleExponentialDisc(rng, p.discScaleKpc * 1.2, p.radiusKpc * 1.05));
    const armIndex = rng.int(0, Math.max(0, p.arms - 1));
    const ridgeC = orbitTilt(ac)
      + (p.arms > 0 ? (armIndex * 2 * Math.PI) / p.arms : 0)
      + rng.normal(0, 0.075) + 0.07;
    // Giant molecular cloud complexes are 50-500 pc across; the Tarantula, the
    // largest in the Local Group, is about 200 pc.
    const size = Math.min(0.5, rng.logNormal(0.13, 0.45));
    const perComplex = Math.max(4, Math.round(rng.logNormal(30, 0.5)));
    const strength = rng.logNormal(1, 0.9);
    for (let k = 0; k < perComplex && hiiPlaced < hiiN; k++, hiiPlaced++) {
      const dr = rng.normal(0, size);
      const dt = rng.normal(0, size / Math.max(ac, 0.3));
      const a = Math.max(0.05, ac + dr);
      const z = sampleSech2(rng, p.thicknessKpc * 0.28);
      // Line ratios: Halpha dominates; [O III] adds the teal fringe that shows
      // where the ionising star is hottest.
      const oiii = Math.pow(rng.next(), 1.6) * 0.6;
      put(a, a, ridgeC + dt, 0 /* pattern-locked */, 0, z,
        strength * rng.logNormal(1, 0.8), 3,
        1.0, 0.14 + oiii * 0.55, 0.26 + oiii * 0.5);
    }
  }

  // --- Supernova remnants. Core-collapse ones sit in the arms where their
  //     short-lived progenitors formed; type Ia ones, whose progenitors are old
  //     white dwarfs, are scattered through the whole disc.
  const ccFraction = snrTrue > 0
    ? (p.sfrMsunYr / 100) / (p.sfrMsunYr / 100 + 4e-14 * p.stellarMassMsun) : 0;
  for (let k = 0; k < snrN; k++) {
    const coreCollapse = rng.chance(ccFraction);
    const a = Math.max(0.05, sampleExponentialDisc(rng, p.discScaleKpc * 1.1, p.radiusKpc * 1.15));
    // Age drawn uniformly over the remnant lifetime, since the rate is steady;
    // radius follows from the Sedov-Taylor solution, so the population shows
    // the whole size distribution at once.
    const ageFrac = rng.next();
    const radiusPc = 20 * Math.pow(Math.max(ageFrac, 1e-3), 0.32);
    let tilt: number;
    if (coreCollapse && p.arms > 0) {
      tilt = orbitTilt(a) + rng.normal(0, 0.16)
        + (rng.int(0, Math.max(0, p.arms - 1)) * 2 * Math.PI) / Math.max(p.arms, 1);
    } else {
      tilt = rng.range(0, Math.PI * 2);
    }
    // [O III] and [S II] shells plus synchrotron: teal-white, fading with age.
    const fade = Math.pow(1 - ageFrac, 0.8);
    put(a, a, rng.range(0, Math.PI * 2), angularRate(p, a),
      tilt, sampleSech2(rng, p.thicknessKpc * (coreCollapse ? 0.5 : 1.0)),
      0.4 + 2.5 * fade, 7,
      0.55 + 0.35 * (1 - fade), 0.95, 0.85 + 0.15 * fade);
    // Stash the shell radius in the unused size slot via the style array below.
    snrRadiusPc.push(radiusPc);
  }

  // Any shortfall from rounding becomes disc stars
  while (i < count) {
    const a = Math.max(0.05, sampleExponentialDisc(rng, p.discScaleKpc, p.radiusKpc));
    put(a, a * 0.9, rng.range(0, Math.PI * 2), angularRate(p, a),
      Math.log(Math.max(a, 0.02) / a0) / tanPitch, sampleSech2(rng, p.thicknessKpc), 1, 0,
      1, 0.9, 0.8);
  }

  // --- Luminosity budgets.
  //
  // Sprites are allocated by *number*, but the populations they stand for have
  // wildly different numbers of real stars: a galaxy has ~1e11 old stars and
  // only ~1e5 O stars. Sampling uniformly and using raw luminosities would make
  // the young population 99% of the light, and the galaxy would render as a
  // uniform blue haze with no bulge.
  //
  // So each population is rescaled to the luminosity it actually has:
  //   old      L = M* / (M/L),  with M/L ~ 3 in the V band for a spiral
  //   young    L = 3e9 Lsun per Msun/yr of star formation
  //   H II     L ~ 15% of the young population, reprocessed into emission lines
  // Relative brightnesses *within* each population are untouched, so a rare O
  // star still outshines the A stars around it by three orders of magnitude.
  const massToLight = p.type === 'E' || p.type === 'S0' ? 4.5 : 3.0;
  const Lold = p.stellarMassMsun / massToLight;
  const fb = Math.min(0.92, Math.max(0.02, p.bulgeFraction));
  const Lyoung = 3e9 * Math.max(p.sfrMsunYr, 1e-4);
  const budget = [
    Lold * (1 - fb) * 0.97 * 0.42,  // 0 disc, resolved
    Lold * fb * 0.38,               // 1 bulge, resolved
    Lold * 0.03,                    // 2 halo and globulars
    0.055 * Lyoung,                 // 3 H II
    Lyoung,                         // 4 young / OB
    Lold * (1 - fb) * 0.97 * 0.58,  // 5 disc, unresolved
    Lold * fb * 0.62,               // 6 bulge, unresolved
    0.02 * Lyoung + 4e-14 * p.stellarMassMsun * 3e5 * 3e4, // 7 supernova remnants
  ];
  const sums = new Array(8).fill(0);
  for (let k = 0; k < count; k++) sums[star[k * 4 + 3] | 0] += star[k * 4 + 2];
  const scale = new Array(8).fill(0);
  for (let kind = 0; kind < 8; kind++) {
    scale[kind] = sums[kind] > 0 ? budget[kind] / sums[kind] : 0;
  }
  let totalL = 0;
  for (let k = 0; k < count; k++) {
    const kind = star[k * 4 + 3] | 0;
    star[k * 4 + 2] *= scale[kind];
    totalL += star[k * 4 + 2];
  }

  const rSun = 2.2 * p.discScaleKpc;
  const vc = rotationCurve(p, rSun);
  // Enclosed mass implied by the rotation curve versus the stellar mass inside:
  // the gap is the dark matter, and for a normal disc galaxy it is most of it.
  // M(<r) = v^2 r / G, in SI, expressed in solar masses.
  // v is in km/s and r in kpc, so both need converting before they are used.
  const vSI = vc * 1e3;
  const rSI = rSun * 3.0857e19;
  const dynamicalMass = (vSI * vSI * rSI) / 6.6743e-11 / 1.989e30;
  const stellarInside = p.stellarMassMsun * (1 - Math.exp(-rSun / p.discScaleKpc) * (1 + rSun / p.discScaleKpc));

  return {
    count,
    orbit,
    star,
    color,
    snrRadiusPc: Float32Array.from(snrRadiusPc),
    params: p,
    stats: {
      starCount: Math.round(p.stellarMassMsun / 0.4),
      hiiCount: hiiN,
      snrCount: snrN,
      snrTrueCount: Math.round(snrTrue),
      supernovaePerCentury: (p.sfrMsunYr / 100 + 4e-14 * p.stellarMassMsun) * 100,
      totalSampledLuminosity: totalL,
      rotationPeriodMyr: (2 * Math.PI) / Math.max(angularRate(p, rSun), 1e-9),
      escapeVelocityKms: Math.sqrt(2) * vc,
      darkMatterFraction: Math.max(0, 1 - stellarInside / Math.max(dynamicalMass, 1)),
    },
  };
}

/** Turning-point mass whose main-sequence lifetime equals an age, solar masses. */
export function massAtLifetime(ageGyr: number): number {
  let lo = 0.1, hi = 100;
  for (let i = 0; i < 60; i++) {
    const mid = Math.sqrt(lo * hi);
    if (msLifetimeGyr(mid) > ageGyr) lo = mid; else hi = mid;
  }
  return Math.sqrt(lo * hi);
}

export { TYPES as HUBBLE_TYPES, blackbodyRGB };
