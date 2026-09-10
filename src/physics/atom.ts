/**
 * One atom, and the fact that it is almost entirely nothing.
 *
 * The rung above this one is a lattice: a pattern of spheres at fixed
 * distances, which is how a solid behaves and how every chemist draws it. The
 * spheres are a lie of a very specific kind. There is no surface there. What
 * sets the size of an atom is the region an electron is likely to be found in,
 * and "likely" is the whole of it - the electron does not have a position that
 * it is at, it has a distribution that it is described by, and the edge of the
 * atom is wherever you decide the distribution has got small enough.
 *
 * So this scale draws the distribution and nothing else. Every point is a
 * place the electron might be, sampled from the square of its wavefunction,
 * and the cloud is re-sampled continually because it is not an object sitting
 * there being looked at.
 *
 * Three things are worth getting right.
 *
 * **The wavefunctions are the real ones.** Hydrogenic radial functions with
 * associated Laguerre polynomials, and the real spherical harmonics that
 * chemists actually draw - the dumbbells and the cloverleaves. They are
 * checked by integration: each one normalises to one, has exactly n - l - 1
 * radial nodes, and has a mean radius matching the closed form
 * (3n^2 - l(l+1))a0/2Z.
 *
 * **The screening is Slater's rules,** which is a set of arithmetic so crude
 * it looks like a joke and which nonetheless produces the periodic table. The
 * effective charge a valence electron feels rises by 0.65 for every step
 * across a period and collapses at the start of the next one, and that
 * sawtooth is why atoms get smaller left to right, why the noble gases sit
 * where they do, and why sodium gives its electron away while chlorine takes
 * one.
 *
 * **The nucleus is drawn at true size,** which is to say it is not visible.
 * If the electron cloud of an iron atom were a stadium the nucleus would be a
 * grain of sand on the centre spot, and everything else would be empty. Almost
 * all of the mass is in that grain. This is the single most surprising true
 * thing about matter and it is worth crossing a scale to see.
 */

import { C } from '../core/constants';

export const BOHR = 5.29177210903e-11;
export const RYDBERG_EV = 13.605693122994;
export const FINE_STRUCTURE = 7.2973525693e-3;
/** The constant in R = r0 A^(1/3), m. Every nucleus has the same density.
 *  The half-density radius of the real diffuse profile, which is what the
 *  rung below draws; see the nucleus module for why it is not 1.2. */
export const NUCLEON_R0 = 1.12e-15;

// ---------------------------------------------------------------------------
// Which orbitals are occupied
// ---------------------------------------------------------------------------

export interface Subshell {
  n: number;
  /** Angular momentum: 0 = s, 1 = p, 2 = d, 3 = f. */
  l: number;
  /** How many electrons are in it. */
  count: number;
}

export const SUBSHELL_LETTER = 'spdfghi';

/**
 * The order the subshells fill, by the Madelung rule.
 *
 * Lowest n + l first, and lowest n breaks the tie. It is the reason potassium
 * puts its next electron in 4s rather than 3d despite 3d being the lower shell,
 * and therefore the reason the fourth row of the periodic table is shaped the
 * way it is, with the transition metals inserted into the middle of it.
 */
export function fillingOrder(max = 7): { n: number; l: number }[] {
  const all: { n: number; l: number }[] = [];
  for (let n = 1; n <= max; n++) for (let l = 0; l < n; l++) all.push({ n, l });
  return all.sort((a, b) => (a.n + a.l) - (b.n + b.l) || a.n - b.n);
}

/**
 * The exceptions, where a half or wholly filled d shell is worth more than the
 * s electron it costs. Chromium and copper are the two everybody meets, and
 * palladium is the odd one that empties its outer s shell entirely.
 */
const ANOMALY_COUNTS: Record<number, Record<string, number>> = {
  24: { '3,2': 5, '4,0': 1 },
  29: { '3,2': 10, '4,0': 1 },
  41: { '4,2': 4, '5,0': 1 },
  42: { '4,2': 5, '5,0': 1 },
  44: { '4,2': 7, '5,0': 1 },
  45: { '4,2': 8, '5,0': 1 },
  46: { '4,2': 10, '5,0': 0 },
  47: { '4,2': 10, '5,0': 1 },
  78: { '5,2': 9, '6,0': 1 },
  79: { '5,2': 10, '6,0': 1 },
};

/** Which subshells an element of this atomic number has electrons in. */
export function configuration(z: number): Subshell[] {
  const out: Subshell[] = [];
  let left = Math.max(0, Math.round(z));
  for (const { n, l } of fillingOrder()) {
    if (left <= 0) break;
    const cap = 2 * (2 * l + 1);
    const take = Math.min(cap, left);
    out.push({ n, l, count: take });
    left -= take;
  }
  const fix = ANOMALY_COUNTS[z];
  if (fix) {
    for (const [key, count] of Object.entries(fix)) {
      const [n, l] = key.split(',').map(Number);
      const s = out.find((x) => x.n === n && x.l === l);
      if (s) s.count = count; else out.push({ n, l, count });
    }
  }
  return out.filter((s) => s.count > 0).sort((a, b) => a.n - b.n || a.l - b.l);
}

/** "1s² 2s² 2p⁶ 3s² 3p⁶ 3d⁶ 4s²" */
export function configurationText(z: number): string {
  const sup = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  return configuration(z)
    .sort((a, b) => (a.n + a.l) - (b.n + b.l) || a.n - b.n)
    .map((s) => `${s.n}${SUBSHELL_LETTER[s.l]}${
      String(s.count).split('').map((d) => sup[+d]).join('')}`)
    .join(' ');
}

/** The outermost occupied subshell - the one that does the chemistry. */
export function valenceOf(z: number): Subshell {
  const c = configuration(z);
  let best = c[0];
  for (const s of c) {
    if (s.n > best.n || (s.n === best.n && s.l > best.l)) best = s;
  }
  return best;
}

// ---------------------------------------------------------------------------
// How much of the nucleus an electron actually feels
// ---------------------------------------------------------------------------

/**
 * Slater's screening groups: 1s | 2s2p | 3s3p | 3d | 4s4p | 4d | 4f | ...
 *
 * s and p of the same shell are lumped together and d and f are not, which
 * looks arbitrary and is not: a d electron's distribution barely overlaps the
 * s and p of its own shell, so it is screened by them almost completely.
 */
const groupOf = (n: number, l: number): number => (l <= 1 ? n * 10 : n * 10 + l);

/**
 * The effective nuclear charge on one electron, by Slater's rules.
 *
 * A set of arithmetic from 1930 with four numbers in it, and it reproduces the
 * shape of the periodic table. Electrons in the same group take 0.35 off each
 * (0.30 in the innermost shell, which has nothing inside it to hide behind),
 * electrons one shell in take 0.85, anything further in takes the full 1.00
 * because it is between you and the nucleus the whole time. A d or an f
 * electron gets no discount at all from the shells inside it.
 */
export function slaterZeff(z: number, n: number, l: number): number {
  const config = configuration(z);
  const mine = groupOf(n, l);
  let s = 0;
  // The electron being asked about is subtracted from its group once, not once
  // per subshell in it - and since s and p share a group, doing it per subshell
  // quietly credits a p electron with 0.35 of screening it does not get, which
  // is a third of the whole sawtooth across a period.
  let sameGroup = -1;
  for (const sub of config) if (groupOf(sub.n, sub.l) === mine) sameGroup += sub.count;
  if (sameGroup > 0) s += sameGroup * (n === 1 && l === 0 ? 0.30 : 0.35);
  for (const sub of config) {
    const g = groupOf(sub.n, sub.l);
    if (g === mine) continue;
    const count = sub.count;
    if (count <= 0) continue;
    if (l >= 2) {
      // Nothing shields a d or an f but its own kind: everything with a lower
      // energy sits inside it and screens completely.
      if (g < mine) s += count * 1.00;
    } else if (sub.n === n - 1) {
      s += count * 0.85;
    } else if (sub.n < n - 1) {
      s += count * 1.00;
    }
  }
  return z - s;
}

/** The effective charge the outermost electron feels. */
export function valenceZeff(z: number): number {
  const v = valenceOf(z);
  return slaterZeff(z, v.n, v.l);
}

/**
 * How fast the innermost electron goes, as a fraction of light speed.
 *
 * Z times the fine-structure constant, which for iron is a fifth of the speed
 * of light and for gold is more than half. That is not a curiosity: it is why
 * gold is yellow rather than silver-coloured, because at that speed the
 * innermost orbitals contract enough to pull an absorption band out of the
 * ultraviolet and into the blue.
 */
export const innerElectronBeta = (z: number): number => z * FINE_STRUCTURE;

// ---------------------------------------------------------------------------
// The wavefunctions themselves
// ---------------------------------------------------------------------------

/**
 * Associated Laguerre polynomial L^alpha_k(x), by the three-term recurrence.
 *
 * Written out rather than looked up because the closed forms get unwieldy past
 * 3d and the recurrence is exact and three lines long.
 */
export function laguerre(k: number, alpha: number, x: number): number {
  if (k < 0) return 0;
  let prev = 1;                       // L^a_0
  if (k === 0) return prev;
  let cur = 1 + alpha - x;            // L^a_1
  for (let i = 1; i < k; i++) {
    const next = ((2 * i + 1 + alpha - x) * cur - (i + alpha) * prev) / (i + 1);
    prev = cur; cur = next;
  }
  return cur;
}

const factorial = (n: number): number => {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
};

/**
 * The radial wavefunction R_nl(r), in m^(-3/2).
 *
 * Hydrogenic, with the effective charge in place of the bare one - which is
 * the standard way of making a one-electron solution say something about a
 * many-electron atom, and is the reason Slater's rules exist at all.
 */
export function radial(n: number, l: number, zeff: number, rM: number): number {
  if (n <= l || rM < 0) return 0;
  const a = BOHR / Math.max(1e-6, zeff);
  const rho = (2 * rM) / (n * a);
  const norm = Math.sqrt(
    (2 / (n * a)) ** 3 * (factorial(n - l - 1) / (2 * n * factorial(n + l))),
  );
  return norm * Math.exp(-rho / 2) * rho ** l * laguerre(n - l - 1, 2 * l + 1, rho);
}

/**
 * The radial distribution, 4 pi r^2 |R|^2: the probability of finding the
 * electron in a thin shell at this radius.
 *
 * The thing that actually has the shape people picture. |R|^2 for 1s is
 * largest at the nucleus; the distribution peaks at the Bohr radius, because
 * there is more room out there.
 */
export const radialDistribution = (n: number, l: number, zeff: number, rM: number): number =>
  rM * rM * radial(n, l, zeff, rM) ** 2;

/** Mean radius of an orbital, in closed form. */
export const meanRadius = (n: number, l: number, zeff: number): number =>
  ((3 * n * n - l * (l + 1)) * BOHR) / (2 * Math.max(1e-6, zeff));

/** Where the radial distribution peaks. Exactly a0/Z for the ground state. */
export function peakRadius(n: number, l: number, zeff: number): number {
  const far = 6 * meanRadius(n, l, zeff);
  let best = 0, bestP = -1;
  const N = 4000;
  for (let i = 1; i <= N; i++) {
    const r = (i / N) * far;
    const p = radialDistribution(n, l, zeff, r);
    if (p > bestP) { bestP = p; best = r; }
  }
  return best;
}

/**
 * The real spherical harmonics, which are what an orbital diagram is.
 *
 * The solutions with a definite z-component of angular momentum are complex
 * and rotationally featureless; add and subtract them in pairs and you get real
 * functions pointing along axes - the three p dumbbells, the four d
 * cloverleaves and the one d that looks like a doughnut wearing a hat. Those
 * are what bonds are made of, and they are the same functions.
 *
 * `m` here indexes the real set from -l to +l, not the magnetic quantum number.
 */
export function realHarmonic(
  l: number, m: number, x: number, y: number, z: number,
): number {
  const r = Math.hypot(x, y, z);
  if (r <= 0) return l === 0 ? 0.5 / Math.sqrt(Math.PI) : 0;
  const X = x / r, Y = y / r, Z = z / r;
  const PI = Math.PI;
  if (l === 0) return 0.5 / Math.sqrt(PI);
  if (l === 1) {
    const k = Math.sqrt(3 / (4 * PI));
    return k * (m === -1 ? Y : m === 0 ? Z : X);
  }
  if (l === 2) {
    switch (m) {
      case -2: return Math.sqrt(15 / (4 * PI)) * X * Y;
      case -1: return Math.sqrt(15 / (4 * PI)) * Y * Z;
      case 0: return Math.sqrt(5 / (16 * PI)) * (3 * Z * Z - 1);
      case 1: return Math.sqrt(15 / (4 * PI)) * X * Z;
      default: return Math.sqrt(15 / (16 * PI)) * (X * X - Y * Y);
    }
  }
  // f, in the cubic set. Only wanted for the lanthanides and actinides.
  switch (m) {
    case -3: return Math.sqrt(35 / (32 * PI)) * Y * (3 * X * X - Y * Y);
    case -2: return Math.sqrt(105 / (4 * PI)) * X * Y * Z;
    case -1: return Math.sqrt(21 / (32 * PI)) * Y * (5 * Z * Z - 1);
    case 0: return Math.sqrt(7 / (16 * PI)) * Z * (5 * Z * Z - 3);
    case 1: return Math.sqrt(21 / (32 * PI)) * X * (5 * Z * Z - 1);
    case 2: return Math.sqrt(105 / (16 * PI)) * Z * (X * X - Y * Y);
    default: return Math.sqrt(35 / (32 * PI)) * X * (X * X - 3 * Y * Y);
  }
}

/** The name a chemist would use: 2p_z, 3d_xy, and so on. */
export function orbitalLabel(n: number, l: number, m: number): string {
  const base = `${n}${SUBSHELL_LETTER[l]}`;
  if (l === 0) return base;
  if (l === 1) return `${base}${['ᵧ', '𝓏', 'ₓ'][m + 1] ?? ''}`;
  if (l === 2) {
    return base + (['ₓᵧ', 'ᵧ𝓏', '𝓏²', 'ₓ𝓏', 'ₓ²₋ᵧ²'][m + 2] ?? '');
  }
  return base;
}

// ---------------------------------------------------------------------------
// The part that is nothing
// ---------------------------------------------------------------------------

/**
 * The radius of a nucleus of mass number A.
 *
 * R = r0 A^(1/3), which says the volume goes as the number of nucleons: every
 * nucleus in the periodic table has the same density, because the strong force
 * saturates. Nucleons only bind to the ones touching them, so packing more in
 * makes the ball bigger rather than tighter - which is exactly how a bag of
 * marbles behaves and not at all how gravity behaves.
 */
export const nuclearRadius = (massNumber: number): number =>
  NUCLEON_R0 * Math.cbrt(Math.max(1, massNumber));

/** Nuclear matter density, kg/m^3. The same for everything, near enough. */
export function nuclearDensity(massNumber: number, massKg: number): number {
  const r = nuclearRadius(massNumber);
  return massKg / ((4 / 3) * Math.PI * r * r * r);
}

/**
 * What fraction of an atom's volume the nucleus takes up.
 *
 * About one part in a thousand million million. If the electron cloud were a
 * stadium, the nucleus would be a grain of sand on the centre spot - and it
 * would be carrying essentially all of the mass.
 */
export function emptiness(atomRadiusM: number, massNumber: number): number {
  const rn = nuclearRadius(massNumber);
  return (rn / Math.max(rn, atomRadiusM)) ** 3;
}

/** How big the nucleus would be if the atom were scaled up to this size. */
export const nucleusAtScale = (
  atomRadiusM: number, massNumber: number, sceneRadius: number,
): number => (nuclearRadius(massNumber) / atomRadiusM) * sceneRadius;

/**
 * Radius of maximum radial charge density, picometres, from Hartree-Fock.
 *
 * Clementi's calculated atomic radii - the honest reference for how big an
 * atom is, because it is the same quantity this module computes rather than
 * half of some bond length.
 */
export const ATOMIC_RADIUS_PM: Record<number, number> = {
  1: 53, 2: 31, 3: 167, 4: 112, 5: 87, 6: 67, 7: 56, 8: 48, 9: 42, 10: 38,
  11: 190, 12: 145, 13: 118, 14: 111, 15: 98, 16: 88, 17: 79, 18: 71,
  19: 243, 20: 194, 21: 184, 22: 176, 23: 171, 24: 166, 25: 161, 26: 156,
  27: 152, 28: 149, 29: 145, 30: 142,
};

/**
 * How far out this atom really reaches, m.
 *
 * Falls back on the hydrogenic prediction for anything not tabulated.
 */
export function atomRadius(z: number): number {
  const tab = ATOMIC_RADIUS_PM[z];
  if (tab) return tab * 1e-12;
  const v = valenceOf(z);
  return peakRadius(v.n, v.l, slaterZeff(z, v.n, v.l));
}

/**
 * How far off the hydrogenic prediction is for this atom, as a ratio.
 *
 * This is the number that says where the approximation stops working, and it
 * is worth showing rather than hiding. For the second row it is within fifteen
 * percent, which for a model containing four constants and no integrals is
 * remarkable. For a 4s valence electron it is out by a factor of two and a
 * half, and always the same way - too big - because a real 4s orbital
 * penetrates deep inside the closed shells and spends part of its time feeling
 * a nearly unscreened nucleus, which a hydrogenic function cannot do.
 *
 * The cloud is drawn with this factor applied, so the picture is the size the
 * atom is. Every relative feature survives it: the node positions, the shell
 * spacings, the shapes of the lobes.
 */
export function hydrogenicError(z: number): number {
  const v = valenceOf(z);
  const predicted = peakRadius(v.n, v.l, slaterZeff(z, v.n, v.l));
  return predicted / atomRadius(z);
}

/** Speed of the innermost electron, m/s. */
export const innerElectronSpeed = (z: number): number => innerElectronBeta(z) * C;

