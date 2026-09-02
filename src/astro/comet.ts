/**
 * Comets, and why they have two tails pointing in different directions.
 *
 * A comet is a few kilometres of ice and dust on a long eccentric orbit. Beyond
 * about three astronomical units it is inert. Inside that, water ice starts to
 * sublimate, and the escaping gas drags dust off the surface - and the dust and
 * the gas then part company, because the Sun acts on them completely
 * differently.
 *
 * **Dust** feels radiation pressure. For a grain, the ratio of radiation
 * pressure to solar gravity is
 *
 *     beta = 5.7e-4 * Q_pr / (rho * a)      (a in metres, rho in kg/m^3)
 *
 * and both forces fall as 1/r^2, so beta is a constant of the grain. A grain is
 * therefore still on a Keplerian orbit - just around a Sun of mass (1 - beta) M.
 * Grains released at the same moment with different sizes fan out along a
 * curve called a syndyne; grains of the same size released at different times
 * lie along a synchrone. The broad, curved, yellowish dust tail is the sum of
 * all of them, and it lags behind the comet because the dust keeps the orbital
 * motion it was born with.
 *
 * **Ions** do not. Molecules photoionised in the coma are picked up by the
 * solar wind's magnetic field and swept away at hundreds of kilometres a
 * second, which is fast enough that the comet's own orbital velocity barely
 * matters. The ion tail is therefore straight, points almost exactly away from
 * the Sun, and is blue - the colour of the 420 nm CO+ band, not of reflected
 * sunlight.
 *
 * The angle between the two tails in a photograph is the aberration from the
 * comet's transverse motion, and it is the reason a comet with two tails looks
 * like it is being blown by two different winds. It is.
 */

import { AU, DAY, G, M_SUN, YEAR } from '../core/constants';
import { RNG } from '../core/rng';
import { elementsFromState, stateAt, type OrbitalElements, type StateVector } from '../physics/kepler';

export interface Comet {
  name: string;
  elements: OrbitalElements;
  /** Nucleus radius, metres. */
  radiusM: number;
  /** Albedo of the nucleus - comets are among the darkest objects known. */
  albedo: number;
  /** Fraction of the surface that is actively sublimating. */
  activeFraction: number;
  /** Heliocentric distance inside which the comet turns on, AU. */
  activityAu: number;
  seed: number;
}

/**
 * Radiation-pressure to gravity ratio for a dust grain.
 * @param radiusM grain radius
 * @param densityKgM3 grain density, ~2000 for silicates, ~1000 for fluffy organics
 * @param Qpr radiation-pressure efficiency, of order unity for grains bigger
 *            than the wavelength of light
 */
export const betaOfGrain = (radiusM: number, densityKgM3 = 2000, Qpr = 1): number =>
  (5.7e-4 * Qpr) / (densityKgM3 * radiusM);

/** Grain radius that gives a particular beta. */
export const grainOfBeta = (beta: number, densityKgM3 = 2000, Qpr = 1): number =>
  (5.7e-4 * Qpr) / (densityKgM3 * beta);

/**
 * Water-ice sublimation rate per square metre, very roughly, as a fraction of
 * its peak. It climbs steeply inside the snow line and collapses beyond it,
 * which is why comets are inert for most of their orbits and spectacular for
 * a few months.
 */
export function activity(au: number, activityAu = 3): number {
  if (au <= 0) return 1;
  const x = activityAu / au;
  return Math.min(1, Math.pow(Math.max(x, 0), 2.6) * 0.06);
}

/** Coma radius, metres. Gas expands freely until solar radiation dissociates it. */
export function comaRadius(au: number, activityAu = 3): number {
  return 1e8 * Math.pow(Math.max(activity(au, activityAu), 1e-4), 0.25);
}

/**
 * Total visual magnitude, using the standard photometric law comet observers
 * use: m = H + 5 log10(delta) + 2.5 n log10(r), with n around 4 for a typical
 * comet rather than the 2 a bare reflecting body would give - because the
 * comet gets intrinsically brighter as it approaches, not just better lit.
 */
export function apparentMagnitude(H: number, rAu: number, deltaAu: number, n = 4): number {
  return H + 5 * Math.log10(Math.max(deltaAu, 1e-4)) + 2.5 * n * Math.log10(Math.max(rAu, 1e-4));
}

/**
 * A dust grain, once released, is on its own Keplerian orbit about a Sun whose
 * gravity is reduced by radiation pressure. This turns a release event into the
 * grain's orbital elements, after which its position at any later time is
 * analytic - no integration, no drift.
 */
export function releaseGrain(
  cometState: StateVector, muStar: number, beta: number, ejectVelocity: number,
  releaseTime: number, rng: RNG,
): OrbitalElements {
  // Dust leaves the sunlit hemisphere, so the ejection is biased sunward.
  const r = Math.hypot(cometState.x, cometState.y, cometState.z) || 1;
  const sunward = [-cometState.x / r, -cometState.y / r, -cometState.z / r];
  const [rx, ry, rz] = rng.onSphere();
  const mix = 0.55;
  const vx = ejectVelocity * (sunward[0] * mix + rx * (1 - mix));
  const vy = ejectVelocity * (sunward[1] * mix + ry * (1 - mix));
  const vz = ejectVelocity * (sunward[2] * mix + rz * (1 - mix));
  const s: StateVector = {
    x: cometState.x, y: cometState.y, z: cometState.z,
    vx: cometState.vx + vx, vy: cometState.vy + vy, vz: cometState.vz + vz,
  };
  return elementsFromState(s, muStar * (1 - beta), releaseTime);
}

/** Sample a beta from the dust size distribution dn/da ~ a^-3.5. */
export function sampleBeta(rng: RNG, betaMin = 5e-4, betaMax = 0.9): number {
  // beta ~ 1/a, so dn/dbeta ~ beta^1.5 over the mapped range.
  return rng.powerLaw(1.5, betaMin, betaMax);
}

/**
 * Aberration of the ion tail: the angle by which it is swept back from the
 * exact anti-solar direction by the comet's own transverse motion against the
 * solar wind.
 */
export function ionTailAberration(
  state: StateVector, solarWindKms = 450,
): number {
  const r = Math.hypot(state.x, state.y, state.z) || 1;
  const rh = [state.x / r, state.y / r, state.z / r];
  const vr = state.vx * rh[0] + state.vy * rh[1] + state.vz * rh[2];
  const tx = state.vx - vr * rh[0];
  const ty = state.vy - vr * rh[1];
  const tz = state.vz - vr * rh[2];
  const vt = Math.hypot(tx, ty, tz);
  return Math.atan2(vt, solarWindKms * 1000);
}

/**
 * Build a comet on a long, steeply inclined orbit, as most of them are.
 *
 * Every distance here is measured against the star's own ice line rather than
 * in absolute AU. Water ice sublimates where the equilibrium temperature
 * reaches about 170 K, and that distance scales as sqrt(L) - roughly 3 AU for
 * the Sun, but under a tenth of that for an M dwarf. A comet whose perihelion
 * were drawn in absolute AU would spend its entire orbit frozen and unlit
 * outside such a system, which is both wrong and invisible.
 *
 * @param iceLineAu distance at which water ice becomes unstable, AU
 */
export function makeComet(
  rng: RNG, index: number, starName: string, outerAu: number, iceLineAu = 3,
): Comet {
  const ice = Math.max(iceLineAu, 1e-3);
  // Long-period comets arrive from the Oort cloud with almost parabolic orbits
  // and no preferred inclination; short-period ones are flatter and rounder.
  const longPeriod = rng.chance(0.55);
  const q = ice * rng.range(0.05, 1.05);                  // perihelion, AU
  let e = longPeriod ? rng.range(0.96, 0.9995) : rng.range(0.4, 0.92);
  let a = q / (1 - e);
  // A near-parabolic orbit has a semi-major axis of tens of thousands of AU,
  // which is both useless to integrate and impossible to draw. Bounding it has
  // to be done by lowering the eccentricity, not by truncating a: q = a(1 - e),
  // so clamping a alone would quietly turn a perfectly ordinary comet into a
  // sungrazer that dives through the star.
  const aMax = Math.max(outerAu * 40, ice * 30, q * 2);
  if (a > aMax) { a = aMax; e = 1 - q / aMax; }
  return {
    name: `${starName} ${longPeriod ? 'C' : 'P'}/${index + 1}`,
    radiusM: rng.logNormal(3000, 0.8),
    albedo: rng.range(0.02, 0.06),
    activeFraction: rng.range(0.02, 0.3),
    // Where it turns on: a little outside the ice line, since a comet starts
    // outgassing its more volatile ices before the water goes.
    activityAu: ice * rng.range(0.85, 1.5),
    seed: rng.nextUint(),
    elements: {
      a: a * AU,
      e,
      i: longPeriod ? Math.acos(rng.range(-1, 1)) : Math.abs(rng.normal(0, 0.35)),
      Omega: rng.range(0, Math.PI * 2),
      omega: rng.range(0, Math.PI * 2),
      M0: rng.range(0, Math.PI * 2),
      epoch: 0,
    },
  };
}

export { stateAt, AU, DAY, YEAR, G, M_SUN };
