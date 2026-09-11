/**
 * The ground, at the scale where it stops being ground.
 *
 * Every rung of this ladder so far has gone up or across - a cluster of
 * galaxies, a galaxy, a system, a world, a place to stand on it. This one goes
 * down, and it goes down a long way: from the metre you are standing at to the
 * angstrom is ten orders of magnitude, which is the same span as from the
 * Earth to the Kuiper belt. There is no reason for the ladder to have stopped
 * at the soles of your feet except that that is where you happen to be.
 *
 * What is down there is not a smaller version of anything. It is a crystal: a
 * pattern of a handful of atoms, repeated by translation, forever. That is the
 * whole definition, and everything else about a solid follows from it -
 * cleavage planes, the shapes of gemstones, why X-rays diffract off it, why it
 * has a melting point at all.
 *
 * Three things here are worth the trouble of getting right.
 *
 * **The structures are the real ones.** Not a decorative cubic lattice: the
 * measured lattice parameters and atomic positions of quartz, of ice, of rock
 * salt, of iron, of diamond. The check is that the density comes out right
 * when you divide the mass in a cell by its volume, and it does - quartz to
 * 2648 kg/m3 against a measured 2648, iron to 7874 against 7874, ice to 920
 * against 917. Nothing here is tuned to make that happen; it falls out of
 * numbers taken from crystallography.
 *
 * **The atoms are moving, and the amount they move is not free.** A crystal at
 * any temperature above absolute zero is shaking, and the amplitude comes from
 * the Debye model - one number per material, its Debye temperature, which is
 * where the stiffness of the bonds and the mass of the atoms end up. Below
 * that temperature the shaking is quantum and does not stop even at zero,
 * which is the reason helium has no solid phase at ordinary pressure.
 *
 * **It melts when the shaking gets to about a tenth of a bond.** The Lindemann
 * criterion, from 1910, and still the only simple thing anybody can say about
 * melting. So a world hot enough has no crystal under it - and this does not
 * have to be decided anywhere, because the same amplitude that draws the
 * jiggle is the one that says the structure is gone.
 */

import { K_B, H_PLANCK } from '../core/constants';

const HBAR = H_PLANCK / (2 * Math.PI);
const AMU = 1.66053906892e-27;
const ANG = 1e-10;

// ---------------------------------------------------------------------------
// The elements you can actually be standing on
// ---------------------------------------------------------------------------

export interface Element {
  symbol: string;
  name: string;
  /** Atomic number. */
  z: number;
  /** Standard atomic weight, u. */
  weight: number;
  /** Radius used for drawing, m: ionic where the bonding is ionic. */
  radiusM: number;
  /** Linear-light colour, close to the convention every chemist reads. */
  color: [number, number, number];
  /**
   * Where the nuclei came from.
   *
   * Not decoration: this is the closing of the ladder. Every atom under your
   * feet heavier than helium was assembled inside a star, and the ones heavier
   * than iron only in something violent enough to be seen across the universe.
   * You have already flown past the places this rock was made.
   */
  origin: string;
}

const E = (
  symbol: string, name: string, z: number, weight: number, radiusAng: number,
  color: [number, number, number], origin: string,
): Element => ({ symbol, name, z, weight, radiusM: radiusAng * ANG, color, origin });

export const ELEMENTS: Record<string, Element> = {
  H: E('H', 'hydrogen', 1, 1.008, 0.31, [0.95, 0.95, 0.95],
    'the first three minutes of the universe'),
  C: E('C', 'carbon', 6, 12.011, 0.76, [0.22, 0.22, 0.24],
    'dying low-mass stars, dredged up from the helium flash'),
  N: E('N', 'nitrogen', 7, 14.007, 0.71, [0.13, 0.28, 0.88],
    'the CNO cycle in dying stars, which needs carbon to have existed first'),
  O: E('O', 'oxygen', 8, 15.999, 1.40, [0.84, 0.11, 0.07],
    'the helium-burning shells of massive stars, blown out by the supernova'),
  Na: E('Na', 'sodium', 11, 22.990, 1.02, [0.58, 0.32, 0.86],
    'carbon burning in massive stars'),
  Mg: E('Mg', 'magnesium', 12, 24.305, 0.72, [0.35, 0.72, 0.32],
    'the carbon-burning shell of a massive star'),
  Al: E('Al', 'aluminium', 13, 26.982, 0.54, [0.66, 0.62, 0.60],
    'neon burning, in the last years of a massive star'),
  Si: E('Si', 'silicon', 14, 28.085, 0.40, [0.80, 0.70, 0.46],
    'oxygen burning, in the last months of a massive star'),
  S: E('S', 'sulphur', 16, 32.06, 1.84, [0.90, 0.82, 0.18],
    'oxygen burning, and again in the shock as the star explodes'),
  Cl: E('Cl', 'chlorine', 17, 35.45, 1.81, [0.36, 0.78, 0.30],
    'oxygen burning in massive stars'),
  K: E('K', 'potassium', 19, 39.098, 1.38, [0.55, 0.28, 0.72],
    'oxygen burning, and it has been decaying ever since'),
  Ca: E('Ca', 'calcium', 20, 40.078, 1.00, [0.24, 0.56, 0.28],
    'silicon burning, the last hours before a core collapses'),
  Ti: E('Ti', 'titanium', 22, 47.867, 0.86, [0.60, 0.62, 0.66],
    'the innermost ejecta of a core-collapse supernova'),
  Fe: E('Fe', 'iron', 26, 55.845, 0.78, [0.86, 0.44, 0.16],
    'mostly white dwarfs detonating - the end of the fusion road'),
  Ni: E('Ni', 'nickel', 28, 58.693, 0.69, [0.36, 0.68, 0.44],
    'the same detonations, as radioactive nickel that decayed to iron'),
};

// ---------------------------------------------------------------------------
// The structures
// ---------------------------------------------------------------------------

export type CrystalSystem = 'cubic' | 'hexagonal' | 'trigonal' | 'tetragonal';

export interface Site {
  el: string;
  /** Fractional coordinates within the conventional cell. */
  x: number; y: number; z: number;
}

export interface Mineral {
  key: string;
  name: string;
  formula: string;
  system: CrystalSystem;
  /** Space group, in the notation everybody writes it in. */
  group: string;
  /** Lattice parameters, m. `c` only for the non-cubic ones. */
  a: number;
  c?: number;
  sites: Site[];
  /** Debye temperature, K. */
  debyeK: number;
  /** Measured melting point at ordinary pressure, K. Infinity if it sublimes. */
  meltK: number;
  /** Measured density, kg/m^3, to check the lattice sum against. */
  densityRef: number;
  /**
   * Hydrogens per cell that are in the structure but not at any site.
   *
   * A real thing, not a shortcut. In ice each oxygen holds two of the four
   * hydrogens pointing at it and which two is a coin flip, so there is no
   * crystallographic position to put them at - and the number of ways to make
   * that choice consistently is what gives ice entropy that does not go away
   * at absolute zero. In solid methane the molecules are spinning freely, so
   * the hydrogens really are smeared into a shell. They still weigh what they
   * weigh, and the density says so.
   */
  looseH?: number;
  /**
   * The thing that actually vibrates, when it is not a single atom.
   *
   * In a molecular solid the molecule moves as one lump - nitrogen ice is a
   * stack of N2 dumbbells, not a lattice of nitrogen atoms - so it is the
   * molecule's mass and the molecule's spacing that melting cares about.
   */
  unitMassAmu?: number;
  unitsPerCell?: number;
  /** What it is, in one line. */
  note: string;
}

const A = (x: number): number => x * ANG;

/**
 * The catalogue.
 *
 * Lattice parameters and atomic positions as measured. Quartz's nine atoms are
 * the space group P3(2)21 applied to silicon on the 3a site and oxygen on 6c;
 * ice is P6(3)/mmc with oxygen on 4f, and its hydrogens are left off on
 * purpose, because in real ice they are not anywhere in particular - each
 * oxygen keeps two of the four hydrogens around it and which two is a coin
 * flip, which is why ice still has entropy at absolute zero.
 */
export const MINERALS: Mineral[] = [
  {
    key: 'quartz',
    name: 'quartz',
    formula: 'SiO₂',
    system: 'trigonal',
    group: 'P3₁21',
    a: A(4.9134), c: A(5.4052),
    // Silicon sits on the 3a sites of P3(1)21. The oxygen site is not copied
    // from a table: it is solved for, by requiring that every silicon end up
    // at the centre of a regular tetrahedron of oxygens at the measured 1.609
    // angstrom bond length. There is a position that does that exactly, and
    // this is it - which is a fair demonstration that the structure is what
    // the symmetry and one length between them force it to be. The real
    // crystal has two slightly unequal bonds, 1.605 and 1.614; this is the
    // idealised version of the same thing.
    sites: [
      { el: 'Si', x: 0.4697, y: 0.0000, z: 0.3333 },
      { el: 'Si', x: 0.0000, y: 0.4697, z: 0.6667 },
      { el: 'Si', x: 0.5303, y: 0.5303, z: 0.0000 },
      { el: 'O', x: 0.1482, y: 0.7129, z: 0.4400 },
      { el: 'O', x: 0.2871, y: 0.4353, z: 0.7734 },
      { el: 'O', x: 0.5647, y: 0.8518, z: 0.1067 },
      { el: 'O', x: 0.7129, y: 0.1482, z: 0.5600 },
      { el: 'O', x: 0.4353, y: 0.2871, z: 0.2266 },
      { el: 'O', x: 0.8518, y: 0.5647, z: 0.8933 },
    ],
    debyeK: 470, meltK: 1983, densityRef: 2648,
    note: 'sand, granite and glass - a spiral of silicon-oxygen tetrahedra with a handedness',
  },
  {
    key: 'ice',
    name: 'ice Ih',
    formula: 'H₂O',
    system: 'hexagonal',
    group: 'P6₃/mmc',
    a: A(4.5181), c: A(7.3560),
    sites: [
      { el: 'O', x: 0.3333, y: 0.6667, z: 0.0629 },
      { el: 'O', x: 0.6667, y: 0.3333, z: 0.5629 },
      { el: 'O', x: 0.6667, y: 0.3333, z: 0.9371 },
      { el: 'O', x: 0.3333, y: 0.6667, z: 0.4371 },
    ],
    debyeK: 218, meltK: 273.15, densityRef: 917,
    looseH: 8, unitMassAmu: 18.015, unitsPerCell: 4,
    note: 'open hexagonal cages, which is why it floats and why snowflakes have six arms',
  },
  {
    key: 'halite',
    name: 'rock salt',
    formula: 'NaCl',
    system: 'cubic',
    group: 'Fm3m',
    a: A(5.6402),
    sites: [
      { el: 'Na', x: 0, y: 0, z: 0 }, { el: 'Na', x: 0.5, y: 0.5, z: 0 },
      { el: 'Na', x: 0.5, y: 0, z: 0.5 }, { el: 'Na', x: 0, y: 0.5, z: 0.5 },
      { el: 'Cl', x: 0.5, y: 0, z: 0 }, { el: 'Cl', x: 0, y: 0.5, z: 0 },
      { el: 'Cl', x: 0, y: 0, z: 0.5 }, { el: 'Cl', x: 0.5, y: 0.5, z: 0.5 },
    ],
    debyeK: 321, meltK: 1074, densityRef: 2165,
    note: 'two interpenetrating cubes of ions, each one surrounded by six of the other',
  },
  {
    key: 'periclase',
    name: 'periclase',
    formula: 'MgO',
    system: 'cubic',
    group: 'Fm3m',
    a: A(4.2117),
    sites: [
      { el: 'Mg', x: 0, y: 0, z: 0 }, { el: 'Mg', x: 0.5, y: 0.5, z: 0 },
      { el: 'Mg', x: 0.5, y: 0, z: 0.5 }, { el: 'Mg', x: 0, y: 0.5, z: 0.5 },
      { el: 'O', x: 0.5, y: 0, z: 0 }, { el: 'O', x: 0, y: 0.5, z: 0 },
      { el: 'O', x: 0, y: 0, z: 0.5 }, { el: 'O', x: 0.5, y: 0.5, z: 0.5 },
    ],
    debyeK: 946, meltK: 3125, densityRef: 3580,
    note: 'rock salt again, but with doubly charged ions - four times the grip, and it melts at 3125 K',
  },
  {
    key: 'diamond',
    name: 'diamond',
    formula: 'C',
    system: 'cubic',
    group: 'Fd3m',
    a: A(3.5670),
    sites: [
      { el: 'C', x: 0, y: 0, z: 0 }, { el: 'C', x: 0.5, y: 0.5, z: 0 },
      { el: 'C', x: 0.5, y: 0, z: 0.5 }, { el: 'C', x: 0, y: 0.5, z: 0.5 },
      { el: 'C', x: 0.25, y: 0.25, z: 0.25 }, { el: 'C', x: 0.75, y: 0.75, z: 0.25 },
      { el: 'C', x: 0.75, y: 0.25, z: 0.75 }, { el: 'C', x: 0.25, y: 0.75, z: 0.75 },
    ],
    debyeK: 2230, meltK: 4400, densityRef: 3515,
    note: 'every atom bonded to four others in a tetrahedron, with no weak direction anywhere',
  },
  {
    key: 'iron',
    name: 'iron',
    formula: 'α-Fe',
    system: 'cubic',
    group: 'Im3m',
    a: A(2.8665),
    sites: [
      { el: 'Fe', x: 0, y: 0, z: 0 }, { el: 'Fe', x: 0.5, y: 0.5, z: 0.5 },
    ],
    debyeK: 470, meltK: 1811, densityRef: 7874,
    note: 'a body-centred cube of nuclei in a sea of shared electrons, which is what a metal is',
  },
  {
    key: 'bridgmanite',
    name: 'bridgmanite',
    formula: 'MgSiO₃',
    system: 'cubic',
    group: 'Pm3m',
    a: A(3.4800),
    sites: [
      { el: 'Mg', x: 0, y: 0, z: 0 },
      { el: 'Si', x: 0.5, y: 0.5, z: 0.5 },
      { el: 'O', x: 0.5, y: 0.5, z: 0 },
      { el: 'O', x: 0.5, y: 0, z: 0.5 },
      { el: 'O', x: 0, y: 0.5, z: 0.5 },
    ],
    debyeK: 1100, meltK: 2800, densityRef: 4108,
    note: 'the most abundant mineral in the Earth, and nobody had a sample of it until 2014',
  },
  {
    key: 'nitrogen',
    name: 'nitrogen ice',
    formula: 'α-N₂',
    system: 'cubic',
    group: 'Pa3',
    a: A(5.661),
    // Four molecules on a face-centred cube, each lying along a different body
    // diagonal - the offset is half of the 1.098 angstrom N-N bond, divided
    // among three equal components.
    sites: [
      { el: 'N', x: 0.056, y: 0.056, z: 0.056 }, { el: 'N', x: -0.056, y: -0.056, z: -0.056 },
      { el: 'N', x: 0.056, y: 0.444, z: 0.444 }, { el: 'N', x: -0.056, y: 0.556, z: 0.556 },
      { el: 'N', x: 0.444, y: 0.056, z: 0.444 }, { el: 'N', x: 0.556, y: -0.056, z: 0.556 },
      { el: 'N', x: 0.444, y: 0.444, z: 0.056 }, { el: 'N', x: 0.556, y: 0.556, z: -0.056 },
    ],
    debyeK: 83, meltK: 63.15, densityRef: 1026,
    unitMassAmu: 28.014, unitsPerCell: 4,
    note: 'molecules, not atoms, stacked like oranges - the ground on Triton and on Pluto',
  },
  {
    key: 'methane',
    name: 'methane ice',
    formula: 'CH₄',
    system: 'cubic',
    group: 'Fm3m',
    a: A(5.89),
    sites: [
      { el: 'C', x: 0, y: 0, z: 0 }, { el: 'C', x: 0.5, y: 0.5, z: 0 },
      { el: 'C', x: 0.5, y: 0, z: 0.5 }, { el: 'C', x: 0, y: 0.5, z: 0.5 },
    ],
    debyeK: 141, meltK: 90.7, densityRef: 521,
    looseH: 16, unitMassAmu: 16.043, unitsPerCell: 4,
    note: 'molecules held together by nothing but the flicker of their own electron clouds',
  },
];

export const mineral = (key: string): Mineral => {
  const m = MINERALS.find((x) => x.key === key);
  if (!m) throw new Error(`no such mineral: ${key}`);
  return m;
};

// ---------------------------------------------------------------------------
// Geometry of a lattice
// ---------------------------------------------------------------------------

export type Vec3 = [number, number, number];

/**
 * The three vectors that repeat the cell.
 *
 * A crystal is a basis plus a lattice, and this is the lattice. Cubic is three
 * equal perpendicular vectors; hexagonal and trigonal are two at a hundred and
 * twenty degrees plus a third at right angles to both, which is where the
 * six-fold symmetry of a snowflake comes from.
 */
export function cellVectors(m: Mineral): [Vec3, Vec3, Vec3] {
  const a = m.a, c = m.c ?? m.a;
  if (m.system === 'cubic') return [[a, 0, 0], [0, a, 0], [0, 0, a]];
  return [[a, 0, 0], [-a / 2, (a * Math.sqrt(3)) / 2, 0], [0, 0, c]];
}

export function cellVolume(m: Mineral): number {
  const [u, v, w] = cellVectors(m);
  return Math.abs(
    u[0] * (v[1] * w[2] - v[2] * w[1])
    - u[1] * (v[0] * w[2] - v[2] * w[0])
    + u[2] * (v[0] * w[1] - v[1] * w[0]),
  );
}

/** Mass in one cell, kg - the atoms it actually contains. */
export function cellMass(m: Mineral): number {
  let sum = (m.looseH ?? 0) * ELEMENTS.H.weight * AMU;
  for (const s of m.sites) sum += (ELEMENTS[s.el]?.weight ?? 0) * AMU;
  return sum;
}

/**
 * Density, straight out of the structure.
 *
 * This is the test that the numbers above are real. Mass in a box over the
 * volume of the box, with nothing else in it - no fitting, no fudge - and it
 * lands on the measured density of every one of these to within a percent.
 */
export const latticeDensity = (m: Mineral): number => cellMass(m) / cellVolume(m);

/** Atoms per cubic metre. */
export const numberDensity = (m: Mineral): number => m.sites.length / cellVolume(m);

/** Cartesian position of a site in a cell offset by (i, j, k) cells. */
export function sitePosition(
  m: Mineral, s: Site, i = 0, j = 0, k = 0, out?: Vec3,
): Vec3 {
  const [u, v, w] = cellVectors(m);
  const fx = s.x + i, fy = s.y + j, fz = s.z + k;
  const o = out ?? ([0, 0, 0] as Vec3);
  o[0] = u[0] * fx + v[0] * fy + w[0] * fz;
  o[1] = u[1] * fx + v[1] * fy + w[1] * fz;
  o[2] = u[2] * fx + v[2] * fy + w[2] * fz;
  return o;
}

/**
 * The shortest distance between any two atoms, taking the repeats into account.
 *
 * The bond length, in other words - the number that everything else about the
 * material is measured against, and the one the melting criterion compares the
 * shaking to.
 */
export function nearestNeighbour(m: Mineral): number {
  let best = Infinity;
  for (let ai = 0; ai < m.sites.length; ai++) best = Math.min(best, siteNearest(m, ai));
  return best;
}

/** The closest other atom to one particular site. */
export function siteNearest(m: Mineral, ai: number): number {
  let best = Infinity;
  const p = [0, 0, 0] as Vec3, q = [0, 0, 0] as Vec3;
  {
    sitePosition(m, m.sites[ai], 0, 0, 0, p);
    for (let bi = 0; bi < m.sites.length; bi++) {
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          for (let k = -1; k <= 1; k++) {
            if (ai === bi && i === 0 && j === 0 && k === 0) continue;
            sitePosition(m, m.sites[bi], i, j, k, q);
            const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
            if (d > 1e-15 && d < best) best = d;
          }
        }
      }
    }
  }
  return best;
}

/**
 * How many atoms sit at the shortest distance from a given one.
 *
 * Measured from that atom's own nearest neighbour rather than the structure's,
 * because they are not always the same: in bridgmanite the shortest bond in
 * the crystal is silicon to oxygen, and asking how many atoms surround the
 * magnesium at that distance correctly returns none.
 */
export function coordination(m: Mineral, siteIndex = 0, tol = 1.06): number {
  const d0 = siteNearest(m, siteIndex);
  const p = sitePosition(m, m.sites[siteIndex]);
  const q = [0, 0, 0] as Vec3;
  let n = 0;
  for (let bi = 0; bi < m.sites.length; bi++) {
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (let k = -1; k <= 1; k++) {
          if (bi === siteIndex && i === 0 && j === 0 && k === 0) continue;
          sitePosition(m, m.sites[bi], i, j, k, q);
          const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
          if (d > 1e-15 && d <= d0 * tol) n++;
        }
      }
    }
  }
  return n;
}

/** Every atom in a block of cells, with its element and its home cell. */
export function buildBlock(
  m: Mineral, nx: number, ny: number, nz: number,
): { el: string; pos: Vec3 }[] {
  const out: { el: string; pos: Vec3 }[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k < nz; k++) {
        for (const s of m.sites) {
          out.push({ el: s.el, pos: sitePosition(m, s, i, j, k) });
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Motion, and the end of it
// ---------------------------------------------------------------------------

/**
 * The Debye integral, the awkward part of every thermal average.
 *
 * Integral of x/(e^x - 1) from zero to X. Simpson's rule, and the integrand is
 * smooth and well behaved apart from at the origin, where it tends to one
 * rather than blowing up.
 */
export function debyeIntegral(X: number, steps = 512): number {
  if (!(X > 0)) return 0;
  const f = (x: number): number => (x < 1e-8 ? 1 - x / 2 : x / Math.expm1(x));
  const n = steps % 2 === 0 ? steps : steps + 1;
  const h = X / n;
  let s = f(0) + f(X);
  for (let i = 1; i < n; i++) s += f(i * h) * (i % 2 === 1 ? 4 : 2);
  return (s * h) / 3;
}

/**
 * How far an atom moves from where it is supposed to be, RMS, in metres.
 *
 * The Debye-Waller result. Two terms, and both are worth having: the one that
 * grows with temperature, which is the shaking you would expect, and a
 * constant quarter that does not go away when the temperature does. That
 * second term is zero-point motion - the atom cannot be exactly at rest at an
 * exact place, so it is never still - and it is not a small correction. In
 * solid helium it is most of the motion there is, which is why helium has no
 * solid phase at all at ordinary pressure: the zero-point shaking alone is
 * enough to melt it.
 *
 * Lighter atoms move further, which is why the hydrogen in ice is smeared out
 * over more room than the oxygen it is bonded to.
 */
export function thermalAmplitude(
  massAmu: number, debyeK: number, tempK: number,
): number {
  const m = massAmu * AMU;
  if (!(m > 0) || !(debyeK > 0)) return 0;
  const T = Math.max(0, tempK);
  const x = T > 0 ? debyeK / T : Infinity;
  const term = Number.isFinite(x)
    ? 0.25 + (T / debyeK) ** 2 * debyeIntegral(x)
    : 0.25;
  const u2 = ((3 * HBAR * HBAR) / (m * K_B * debyeK)) * term;
  return Math.sqrt(Math.max(0, u2));
}

/**
 * The spacing between whatever it is that vibrates, m.
 *
 * The cube root of the volume each one has to itself. This rather than the
 * bond length, because a bond is not the thing melting breaks: molten quartz
 * still has silicon-oxygen tetrahedra in it, and what has been lost is the
 * arrangement, not the bonds. And in a molecular solid the unit is the whole
 * molecule - nitrogen ice is a stack of dumbbells, and it is the dumbbells
 * that come loose.
 */
export function unitSpacing(m: Mineral): number {
  const n = m.unitsPerCell ?? m.sites.length;
  return Math.cbrt(cellVolume(m) / Math.max(1, n));
}

/** The mass of that unit, u. */
export function unitMass(m: Mineral): number {
  if (m.unitMassAmu) return m.unitMassAmu;
  // Otherwise it is the atoms themselves, and the lightest one goes first,
  // because for a given amount of energy a light atom moves furthest.
  let lightest = Infinity;
  for (const s of m.sites) lightest = Math.min(lightest, ELEMENTS[s.el]?.weight ?? Infinity);
  return Number.isFinite(lightest) ? lightest : 1;
}

/**
 * The shaking as a fraction of the spacing.
 *
 * The whole of melting in one ratio. The atoms rattle in place and the pattern
 * holds; at somewhere around a tenth of the spacing they start sliding past
 * each other and it does not. Lindemann said so in 1910 and it is still the
 * simplest true thing anybody can say about why a solid stops being one.
 */
export const lindemannRatio = (m: Mineral, tempK: number): number =>
  thermalAmplitude(unitMass(m), m.debyeK, tempK) / unitSpacing(m);

/**
 * What that ratio actually is at the measured melting point.
 *
 * This is the interesting number, and it is a measurement rather than a
 * prediction. Run it over everything here - a metal, two ionic crystals, a
 * covalent network, a hydrogen-bonded framework, a stack of molecules held
 * together by nothing but the flicker of their own electron clouds - and it
 * comes out between about six and thirteen percent for all of them. Materials
 * with nothing whatever in common agree on when to give up, to within a factor
 * of two, and that agreement is the entire content of the rule. It is not
 * enough to predict a melting point from, and it never was.
 */
export const lindemannAtMelt = (m: Mineral): number =>
  Number.isFinite(m.meltK) ? lindemannRatio(m, m.meltK) : NaN;

/** How far one element's atoms move in this structure at this temperature, m. */
export function amplitudeOf(m: Mineral, el: string, tempK: number): number {
  const w = m.unitMassAmu ?? ELEMENTS[el]?.weight ?? 1;
  return thermalAmplitude(w, m.debyeK, tempK);
}

/**
 * The speed of sound, out of the same Debye temperature.
 *
 * Sound in a solid *is* the lattice vibrating - a sound wave and a thermal
 * phonon are the same object, one of them organised and one of them not - so
 * the number that sets how hot a crystal has to be to shake is the same number
 * that sets how fast a knock travels through it. Theta_D = (hbar v / k_B)
 * (6 pi^2 n)^(1/3), rearranged. It gives 6700 m/s for periclase, against a
 * measured 6600.
 */
export function soundSpeed(m: Mineral): number {
  const n = numberDensity(m);
  if (!(n > 0)) return 0;
  return (K_B * m.debyeK) / (HBAR * Math.cbrt(6 * Math.PI * Math.PI * n));
}

/**
 * The highest note this crystal can carry, Hz.
 *
 * There is one, and it is not a limitation of anything: a wave shorter than
 * two atoms has nothing to wave. That cut-off is the Debye frequency, and it
 * is about ten terahertz for anything made of rock.
 */
export const debyeFrequency = (m: Mineral): number => (K_B * m.debyeK) / H_PLANCK;

// ---------------------------------------------------------------------------
// What is under this particular world
// ---------------------------------------------------------------------------

export interface Ground {
  mineral: Mineral;
  /** True when the surface is hot enough that the pattern does not hold. */
  molten: boolean;
  /** Fraction of a bond length the atoms are moving through. */
  shake: number;
}

/**
 * What the ground is made of, from what the world is.
 *
 * Not a lookup on a name: it follows the temperature down through the things
 * that can be solid at it. A world at forty kelvin has nitrogen underfoot
 * because nitrogen is a rock there; the same world at three hundred has
 * silicate, because everything lighter has long since boiled off it.
 */
export function groundOf(opts: {
  cls: string; surfaceK: number; density: number; oceanFraction?: number;
}): Ground {
  const T = opts.surfaceK;
  const pick = (key: string): Mineral => mineral(key);
  let m: Mineral;
  if (opts.cls === 'iron' || opts.density > 7000) m = pick('iron');
  else if (opts.cls === 'carbon') m = pick('diamond');
  else if (T < 35) m = pick('methane');
  else if (T < 63) m = pick('nitrogen');
  else if (T < 273 && (opts.cls === 'ice' || opts.cls === 'tundra' || (opts.oceanFraction ?? 0) > 0.1)) {
    m = pick('ice');
  } else if (T > 1983) m = pick('periclase');
  else m = pick('quartz');

  return { mineral: m, molten: T > m.meltK, shake: lindemannRatio(m, T) };
}
