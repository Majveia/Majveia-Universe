/**
 * The bottom of the ladder, and the reason the rest of it has the contents it
 * has.
 *
 * Every rung above this one is made of atoms, and every atom heavier than
 * lithium was assembled inside a star. Which star, and by what process, and
 * why it stopped where it stopped, are all answered by one curve: the binding
 * energy per nucleon against mass number. It rises steeply from hydrogen,
 * flattens, peaks at iron and nickel, and falls slowly away for ever after.
 *
 * Fusing anything below the peak releases energy, which is what a star is.
 * Fusing anything above it costs energy, which is why a star that has made
 * iron has nothing left to burn and falls in on itself in about a second - and
 * that collapse is the supernova four rungs up, which is where the oxygen
 * under your feet came from. Splitting anything above the peak releases energy,
 * which is a reactor and a bomb.
 *
 * The curve comes out of five terms written down in 1935, which treat the
 * nucleus as a drop of incompressible charged liquid:
 *
 *  - **volume**, proportional to A, because the strong force saturates and each
 *    nucleon binds only to the ones touching it;
 *  - **surface**, minus A^(2/3), because the ones on the outside have fewer
 *    neighbours - the same term that gives a raindrop its shape;
 *  - **Coulomb**, minus Z(Z-1)/A^(1/3), because every proton pushes every
 *    other one, and this is the term that eventually wins;
 *  - **asymmetry**, minus (A-2Z)^2/A, because protons and neutrons fill
 *    separate ladders of levels and it is cheaper to keep them level;
 *  - **pairing**, because nucleons like to be in pairs.
 *
 * Five terms and no free structure, and it gives iron-56 at 8.85 MeV per
 * nucleon against a measured 8.79, uranium-238 at 7.63 against 7.57, the
 * alpha-decay energy of uranium to 4.4 MeV against a measured 4.27, and about
 * 185 MeV for splitting one - which is the number the twentieth century turned
 * on. It fails badly for anything light, and helium is the clearest case: the
 * formula says 22.8 MeV and the truth is 28.3, because at four nucleons the
 * shell structure it ignores is the whole story.
 */

import { C, K_B, H_PLANCK, M_PROTON } from '../core/constants';

export const HBAR = H_PLANCK / (2 * Math.PI);
export const MEV_J = 1.602176634e-13;
export const M_NUCLEON = 1.67492749804e-27;

/** Bethe-Weizsacker coefficients, MeV. */
export const SEMF = {
  volume: 15.75,
  surface: 17.80,
  coulomb: 0.711,
  asymmetry: 23.70,
  pairing: 11.18,
} as const;

/**
 * Radius constant, m. R = r0 A^(1/3).
 *
 * Which says the volume goes as the nucleon count, so every nucleus has the
 * same density - because a nucleon binds only to the ones it touches, and
 * packing more in makes the ball bigger rather than tighter. That is how a bag
 * of marbles behaves and not at all how gravity behaves.
 *
 * 1.12 rather than the 1.2 that gets quoted, and the difference is not a
 * quibble: 1.2 is the radius of the equivalent *sharp* sphere, and this is the
 * radius at which the real, diffuse profile has fallen to half. Using the
 * sharp-sphere number with a diffuse edge counts the surface twice and puts
 * the central density a quarter low. With this one it comes out at 0.146
 * nucleons per cubic femtometre against a measured 0.16, and the nucleons move
 * at 0.27 of light speed, which is the number in the textbooks.
 */
export const R0 = 1.12e-15;
/** Surface diffuseness, m: how far the edge is smeared. Measured by scattering
 *  electrons off nuclei and looking at the diffraction. */
export const SURFACE_A = 0.55e-15;
/** The measured binding of helium-4, which the formula cannot produce. */
export const HE4_BINDING_MEV = 28.296;

export const nuclearRadius = (a: number): number => R0 * Math.cbrt(Math.max(1, a));

// ---------------------------------------------------------------------------
// The curve
// ---------------------------------------------------------------------------

export interface BindingTerms {
  volume: number;
  surface: number;
  coulomb: number;
  asymmetry: number;
  pairing: number;
  total: number;
  perNucleon: number;
}

/**
 * Every term of the mass formula, in MeV, so the tug of war is visible.
 *
 * Zero for a single nucleon, because there is nothing there to hold together:
 * the formula describes a drop, and one particle is not one. Left to run, the
 * asymmetry term alone would report a lone proton as unbound by twenty-four
 * MeV, which is not a small error - it is a category error.
 */
export function bindingTerms(z: number, a: number): BindingTerms {
  if (a < 2) {
    return {
      volume: 0, surface: 0, coulomb: 0, asymmetry: 0, pairing: 0,
      total: 0, perNucleon: 0,
    };
  }
  const A = Math.max(1, a), Z = Math.max(0, z), N = A - Z;
  const volume = SEMF.volume * A;
  const surface = -SEMF.surface * Math.pow(A, 2 / 3);
  const coulomb = -(SEMF.coulomb * Z * (Z - 1)) / Math.cbrt(A);
  const asymmetry = -(SEMF.asymmetry * (A - 2 * Z) ** 2) / A;
  const evenZ = Z % 2 === 0, evenN = N % 2 === 0;
  const pairing = evenZ === evenN
    ? (evenZ ? 1 : -1) * (SEMF.pairing / Math.sqrt(A))
    : 0;
  const total = volume + surface + coulomb + asymmetry + pairing;
  return { volume, surface, coulomb, asymmetry, pairing, total, perNucleon: total / A };
}

/** Total binding energy, MeV. */
export const binding = (z: number, a: number): number => bindingTerms(z, a).total;
/** Binding per nucleon, MeV - the quantity the curve is drawn in. */
export const bindingPerNucleon = (z: number, a: number): number =>
  bindingTerms(z, a).perNucleon;

/**
 * Which Z a nucleus of this A wants to be: the floor of the valley of
 * stability.
 *
 * Set the derivative of the binding with respect to Z to zero and solve. Two
 * terms are arguing: asymmetry wants equal numbers of protons and neutrons,
 * Coulomb wants fewer protons, and Coulomb grows as A^(2/3) - so light nuclei
 * sit at Z = A/2 and heavy ones drift neutron-rich. It puts A = 16 at oxygen,
 * A = 56 at iron and A = 238 at uranium, which is where they are.
 */
export function stableZ(a: number): number {
  const A = Math.max(1, a), c = Math.pow(A, 2 / 3);
  return (4 * SEMF.asymmetry * A + SEMF.coulomb * c)
    / (2 * SEMF.coulomb * c + 8 * SEMF.asymmetry);
}

/** The most tightly bound nucleus the formula knows about. */
export function bindingPeak(): { a: number; z: number; perNucleon: number } {
  let best = { a: 1, z: 1, perNucleon: -Infinity };
  for (let a = 4; a <= 300; a++) {
    const z = Math.round(stableZ(a));
    const b = bindingPerNucleon(z, a);
    if (b > best.perNucleon) best = { a, z, perNucleon: b };
  }
  return best;
}

/**
 * Energy released by spitting out an alpha particle, MeV.
 *
 * Positive means it is allowed, and the formula says that happens somewhere
 * around A = 150 and never stops - which is why the periodic table runs out.
 * Helium's own binding has to be the measured value here, because the formula
 * that gets uranium to three percent is out by twenty on helium.
 */
export const alphaQ = (z: number, a: number): number =>
  binding(z - 2, a - 4) + HE4_BINDING_MEV - binding(z, a);

/**
 * Energy released by splitting into two equal halves, MeV.
 *
 * About 185 MeV for uranium, which is the number the twentieth century turned
 * on. It becomes positive well before anything actually fissions, because
 * being allowed is not the same as getting over the barrier.
 */
export function fissionQ(z: number, a: number): number {
  const zh = z / 2, ah = a / 2;
  return 2 * binding(zh, ah) - binding(z, a);
}

/**
 * Energy released by fusing this with itself, MeV per nucleon of product.
 *
 * The sign of this is the whole of stellar nucleosynthesis: positive below the
 * iron peak, negative above it, and a star only ever runs downhill.
 */
export const fusionGain = (z: number, a: number): number =>
  bindingPerNucleon(2 * z, 2 * a) - bindingPerNucleon(z, a);

/** What this nucleus would do about being the wrong shape. */
export function decayMode(z: number, a: number): string {
  const want = stableZ(a);
  if (a > 4 && alphaQ(z, a) > 0 && a >= 150) return 'alpha decay';
  // The floor of the valley is a continuous curve and nuclei come in integers,
  // so anything within one of it is sitting as low as it can get.
  if (z > want + 1) return 'positron emission or electron capture';
  if (z < want - 1) return 'beta decay';
  return 'stable, or near enough';
}

// ---------------------------------------------------------------------------
// The shape and the churn
// ---------------------------------------------------------------------------

/**
 * The Woods-Saxon profile: how nuclear matter is actually distributed.
 *
 * Flat in the middle and falling off over about half a femtometre at the edge.
 * Not assumed - it is read straight off the diffraction pattern you get by
 * firing electrons at a nucleus and watching where they go, which is the same
 * measurement in principle as working out the shape of a slit from the fringes.
 */
export const woodsSaxon = (rM: number, a: number): number =>
  1 / (1 + Math.exp((rM - nuclearRadius(a)) / SURFACE_A));

/** Nucleons per cubic metre in the middle of a nucleus. */
export function centralDensity(a: number): number {
  // Normalise the profile so it integrates to A nucleons.
  const far = nuclearRadius(a) + 12 * SURFACE_A;
  const N = 2000, h = far / N;
  let sum = 0;
  for (let i = 1; i <= N; i++) {
    const r = i * h;
    sum += 4 * Math.PI * r * r * woodsSaxon(r, a) * h;
  }
  return sum > 0 ? a / sum : 0;
}

/** Mass density of nuclear matter, kg/m^3. About 2x10^17, for everything. */
export const matterDensity = (a: number): number => centralDensity(a) * M_NUCLEON;

/**
 * The Fermi momentum of nuclear matter.
 *
 * Nucleons are fermions, so no two of them can be in the same state, so they
 * cannot all sit still at the bottom - they are forced up a ladder of momenta
 * whether they like it or not. The top rung is this, it comes to about 38 MeV
 * of kinetic energy, and it means the nucleons in a nucleus at absolute zero
 * are moving at a quarter of the speed of light. Nothing is stirring them.
 * They cannot stop.
 */
export function fermiMomentum(a: number): number {
  // Two species, each with two spin states: k_F = (3 pi^2 n / 2)^(1/3).
  const n = centralDensity(a);
  return HBAR * Math.cbrt((3 * Math.PI * Math.PI * n) / 2);
}

export const fermiSpeed = (a: number): number => fermiMomentum(a) / M_NUCLEON;
export const fermiEnergyMeV = (a: number): number =>
  (fermiMomentum(a) ** 2 / (2 * M_NUCLEON)) / MEV_J;

/**
 * A nucleon's position, drawn from the Woods-Saxon profile.
 *
 * Rejection against the flat interior, which accepts most of the time because
 * the profile is nearly a step.
 */
export function sampleNucleon(a: number, rnd: () => number): [number, number, number] {
  // Three diffuseness lengths past the half-density radius, where the profile
  // is down to five percent. Further out it is not zero, but a nucleus of
  // fifty-six has no business putting one of them a whole radius clear of the
  // rest, and drawing it there says something untrue about how bound it is.
  const far = nuclearRadius(a) + 3 * SURFACE_A;
  for (let tries = 0; tries < 200; tries++) {
    const r = far * Math.cbrt(rnd());
    if (rnd() <= woodsSaxon(r, a)) {
      const u = 2 * rnd() - 1, ph = rnd() * 2 * Math.PI;
      const s = Math.sqrt(Math.max(0, 1 - u * u));
      return [r * s * Math.cos(ph), r * s * Math.sin(ph), r * u];
    }
  }
  return [0, 0, 0];
}

// ---------------------------------------------------------------------------
// How much of everything this is
// ---------------------------------------------------------------------------

/** A chemical bond, in MeV, for scale. Nuclear energies are a million times it. */
export const CHEMICAL_BOND_MEV = 4.5e-6;

/** How many times bigger a nuclear rearrangement is than a chemical one. */
export const nuclearOverChemical = (z: number, a: number): number =>
  bindingPerNucleon(z, a) / CHEMICAL_BOND_MEV;

/** Mass of the nucleus, kg, from its nucleons less what binding took away. */
export function nucleusMass(z: number, a: number): number {
  const parts = z * M_PROTON + (a - z) * M_NUCLEON;
  return parts - (binding(z, a) * MEV_J) / (C * C);
}

/** The fraction of the mass that binding energy has removed. E = mc^2, read
 *  backwards: a bound nucleus weighs less than its parts, and the difference
 *  is what came out. */
export const massDefect = (z: number, a: number): number =>
  (binding(z, a) * MEV_J) / (C * C) / (z * M_PROTON + (a - z) * M_NUCLEON);

/**
 * Is this small enough that the liquid-drop picture does not apply?
 *
 * A drop needs an inside and an outside. Below about a dozen nucleons there is
 * no inside worth the name - it is all surface, and what holds it together is
 * shell structure the formula knows nothing about. Helium-4 is the clearest
 * case: five terms give 5.7 MeV per nucleon and the truth is 7.07.
 */
export const tooSmallForTheFormula = (a: number): boolean => a < 12;

export { K_B };
