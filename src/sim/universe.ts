/**
 * The universe as a pure function.
 *
 * Nothing is stored. Every object - a cluster, a galaxy, a star, a planet, a
 * continent - is derived on demand from one seed plus the object's index in the
 * hierarchy. Ask for the same thing twice and you get the same thing back;
 * close a tab and reopen it a year later and the same world is still there.
 * This is what makes an unbounded universe fit in a few hundred kilobytes.
 *
 *   seed
 *    +- cosmic web (a Gaussian random field, grown by gravity)
 *        +- collapsed haloes, ranked by peak height
 *            +- clusters and groups, populated by a halo occupation model
 *                +- galaxies, from abundance matching and Tully-Fisher
 *                    +- stars, from a Kroupa IMF over the galaxy's history
 *                        +- planets, from disc accretion
 */

import { RNG, hash3, hashString } from '../core/rng';
import type { CosmicWebField, Knot } from '../cosmology/zeldovich';
import { galaxyFromHalo, massAtLifetime, type GalaxyParams } from '../galaxy/generator';
import { makeStar, sampleKroupaIMF, type Star } from '../astro/stellar';
import { buildSystem, type PlanetarySystem } from '../astro/planets';
import { sampleCompanion } from '../astro/binary';
import { angularRate, rotationCurve } from '../galaxy/generator';

export interface ClusterMember {
  /** Index within the cluster. */
  index: number;
  /** Comoving position relative to the cluster centre, Mpc. */
  x: number; y: number; z: number;
  /** Line-of-sight peculiar velocity, km/s. */
  vlos: number;
  haloMassMsun: number;
  /** Local environment density, 0 field to 1 cluster core. */
  environment: number;
  seed: number;
}

export interface Cluster {
  knot: Knot;
  index: number;
  seed: number;
  name: string;
  /** Virial mass, solar masses. */
  massMsun: number;
  /** Virial radius, Mpc. */
  radiusMpc: number;
  /** Velocity dispersion, km/s. */
  sigmaKms: number;
  /** Temperature of the intracluster medium, keV. */
  icmKeV: number;
  members: ClusterMember[];
  richness: number;
}

const CLUSTER_NAMES = ['Abell', 'Coma', 'Virgo', 'Perseus', 'Hydra', 'Norma', 'Shapley', 'Corona',
  'Fornax', 'Centaurus', 'Ophiuchus', 'Leo', 'Pavo', 'Hercules', 'Sculptor'];
const STAR_SYLL = ['ar', 'bel', 'cor', 'dre', 'el', 'far', 'gil', 'hal', 'ith', 'jor', 'kae',
  'lyr', 'mar', 'nor', 'oph', 'per', 'quel', 'rid', 'sar', 'tal', 'ur', 'vel', 'wyn', 'xen',
  'yal', 'zor', 'an', 'thu', 'vei', 'mor'];
const GREEK = ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ', 'ν', 'ξ'];

export class Universe {
  readonly seed: number;
  readonly seedText: string;
  private clusterCache = new Map<number, Cluster>();
  private galaxyCache = new Map<string, GalaxyParams>();
  private systemCache = new Map<string, PlanetarySystem>();
  private starCache = new Map<string, { star: Star; name: string; radiusKpc: number; seed: number }>();

  constructor(seedText: string, readonly field: CosmicWebField) {
    this.seedText = seedText;
    this.seed = hashString(seedText);
  }

  /** Collapsed haloes, most massive first. */
  get knots(): Knot[] { return this.field.knots; }

  /**
   * Populate a halo with galaxies.
   *
   * The number of galaxies follows a halo occupation distribution: one central
   * plus a Poisson number of satellites scaling as (M/M1)^alpha with alpha ~ 1.
   * Satellites are placed on an NFW profile - the density law that emerges from
   * dissipationless collapse in every cosmological simulation ever run - and
   * given velocities from the virial theorem.
   */
  cluster(index: number): Cluster {
    const hit = this.clusterCache.get(index);
    if (hit) return hit;
    const knot = this.field.knots[index];
    const seed = hash3(index, 0x51ce, 0x1234, this.seed);
    const rng = new RNG(seed);

    const M = knot.massMsun;
    // Virial radius from the spherical-collapse overdensity, 200 rho_crit
    const radiusMpc = Math.cbrt((3 * M) / (4 * Math.PI * 200 * 2.775e11 * 0.6766 ** 2)) ;
    // sigma^2 ~ GM/R, expressed in km/s with M in Msun and R in Mpc
    const sigmaKms = Math.sqrt((4.3009e-9 * M) / Math.max(radiusMpc, 1e-4)) * 0.65;
    // The intracluster medium is shock-heated to the virial temperature
    const icmKeV = (sigmaKms / 1000) ** 2 * 6.0;

    const Ncen = M > 3e11 ? 1 : 0;
    const meanSat = Math.pow(M / (10 ** 12.7), 1.02);
    const nSat = Math.max(0, Math.round(meanSat * rng.logNormal(1, 0.35)));
    const total = Math.min(2200, Ncen + nSat);

    const members: ClusterMember[] = [];
    // NFW concentration falls with mass: big haloes assembled late
    const conc = 9 * Math.pow(M / 1e12, -0.1) * rng.logNormal(1, 0.15);
    for (let i = 0; i < total; i++) {
      const central = i === 0 && Ncen === 1;
      const r = central ? 0 : radiusMpc * sampleNFW(rng, conc);
      const dir = rng.onSphere();
      const env = Math.max(0, 1 - r / Math.max(radiusMpc, 1e-6));
      // Subhalo mass function: dN/dm ~ m^-1.9
      const mh = central
        ? M * rng.range(0.06, 0.22)
        : Math.min(M * 0.05, Math.max(1e10, M * rng.powerLaw(-1.9, 1e-5, 0.03)));
      members.push({
        index: i,
        x: r * dir[0], y: r * dir[1], z: r * dir[2],
        vlos: rng.normal(0, sigmaKms),
        haloMassMsun: mh,
        environment: central ? 1 : Math.pow(env, 0.7),
        seed: hash3(index, i, 0x9a1, this.seed),
      });
    }

    const c: Cluster = {
      knot, index, seed,
      name: `${CLUSTER_NAMES[index % CLUSTER_NAMES.length]} ${1000 + (Math.abs(seed) % 8000)}`,
      massMsun: M, radiusMpc, sigmaKms, icmKeV,
      members, richness: total,
    };
    this.clusterCache.set(index, c);
    return c;
  }

  /** Galaxy parameters for one cluster member. */
  galaxy(clusterIndex: number, memberIndex: number): GalaxyParams {
    const key = `${clusterIndex}:${memberIndex}`;
    const hit = this.galaxyCache.get(key);
    if (hit) return hit;
    const c = this.cluster(clusterIndex);
    const m = c.members[memberIndex];
    const g = galaxyFromHalo(m.seed, m.haloMassMsun, m.environment);
    this.galaxyCache.set(key, g);
    return g;
  }

  /**
   * A specific star in a galaxy.
   *
   * The index is all the state there is: the same index always yields the same
   * star, so a system can be linked to and returned to without storing it. Age
   * is drawn from the galaxy's star-formation history and mass from a Kroupa
   * IMF truncated at the turn-off, so the population is self-consistent.
   */
  star(galaxy: GalaxyParams, index: number): { star: Star; name: string; radiusKpc: number; seed: number } {
    const key = `${galaxy.seed}:${index}`;
    const cached = this.starCache.get(key);
    if (cached) return cached;
    const seed = hash3(index, galaxy.seed, 0x57a2, this.seed);
    const rng = new RNG(seed);
    // Exponential disc for spirals, de Vaucouleurs-ish for ellipticals
    const rKpc = galaxy.type === 'E' || galaxy.type === 'S0'
      ? galaxy.bulgeRadiusKpc * Math.pow(rng.next(), 0.4) * rng.range(0.4, 3)
      : -galaxy.discScaleKpc * Math.log(1 - rng.next() * 0.985);
    const ageGyr = Math.min(galaxy.ageGyr, rng.range(0.1, galaxy.ageGyr));
    const turnoff = massAtLifetime(ageGyr);
    let m = sampleKroupaIMF(rng, 0.08, 60);
    if (m > turnoff && rng.chance(0.9)) m = sampleKroupaIMF(rng, 0.08, Math.max(0.3, turnoff));
    const metal = galaxy.metallicity - 0.35 * (rKpc / Math.max(galaxy.radiusKpc, 1e-3)) + rng.normal(0, 0.12);
    const st = makeStar(m, ageGyr, metal);
    const greek = GREEK[index % GREEK.length];
    const name = `${greek} ${syllables(rng)}`;
    const out = { star: st, name, radiusKpc: rKpc, seed };
    this.starCache.set(key, out);
    return out;
  }

  /** The planetary system of a star. */
  system(galaxy: GalaxyParams, index: number): { system: PlanetarySystem; name: string; seed: number } {
    const key = `${galaxy.seed}:${index}`;
    const hit = this.systemCache.get(key);
    const s = this.star(galaxy, index);
    if (hit) return { system: hit, name: s.name, seed: s.seed };
    // Roughly half of all stars have a companion, and that companion decides
    // where planets can exist at all - so it is drawn before the planets are.
    const crng = new RNG(hash3(index, galaxy.seed, 0xb1a2, this.seed));
    const companion = sampleCompanion(crng, s.star, s.star.ageGyr, s.star.metallicity);
    const sys = buildSystem(s.star, s.seed, s.name, companion);
    this.systemCache.set(key, sys);
    return { system: sys, name: s.name, seed: s.seed };
  }

  /** Orbital speed of a star at a given radius in a galaxy, km/s. */
  orbitalSpeed(galaxy: GalaxyParams, rKpc: number): number { return rotationCurve(galaxy, rKpc); }
  /** Orbital period of a star at a given radius, Myr. */
  orbitalPeriodMyr(galaxy: GalaxyParams, rKpc: number): number {
    return (2 * Math.PI) / Math.max(angularRate(galaxy, rKpc), 1e-12);
  }
}

/**
 * Sample a radius from an NFW profile in units of the virial radius.
 * The enclosed-mass function m(x) = ln(1+cx) - cx/(1+cx) is inverted numerically.
 */
function sampleNFW(rng: RNG, c: number): number {
  const mTot = Math.log(1 + c) - c / (1 + c);
  const u = rng.next() * mTot;
  let lo = 1e-6, hi = 1;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    const m = Math.log(1 + c * mid) - (c * mid) / (1 + c * mid);
    if (m < u) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function syllables(rng: RNG): string {
  const n = rng.int(2, 3);
  let s = '';
  for (let i = 0; i < n; i++) s += rng.pick(STAR_SYLL);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
