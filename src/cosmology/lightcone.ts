/**
 * The past light cone.
 *
 * Every visualisation of cosmic structure ever made, including the one this
 * file sits next to, draws a *snapshot*: every particle in the box shown at
 * the same cosmic time, which is a thing no instrument has ever seen or could
 * see. What a telescope collects is the past light cone - the surface in
 * spacetime made of everything whose light is arriving now - and on it,
 * distance and age are the same coordinate. A galaxy a billion light years
 * away is a billion years young, and it is young in the only sense that
 * matters here: the structure around it has had a billion years less to
 * collapse.
 *
 * The construction is exact and it needs one function the cosmology module
 * already has. Conformal time
 *
 *     eta(a) = Int_0^a c da' / (a'^2 H(a'))
 *
 * is comoving distance travelled by light, so a photon leaving at a_e and
 * arriving at a_obs has crossed a comoving distance
 *
 *     r = eta(a_obs) - eta(a_e)
 *
 * and inverting that gives the emission epoch at every distance. `eta` is the
 * comoving particle horizon, which is already in `lcdm.ts` under that name;
 * this file samples it once per cosmology, and everything else is a lookup in
 * a monotone table.
 *
 * Two things fall out of it that a snapshot cannot show.
 *
 * The first is that structure *thins with distance*. Near the observer the
 * filaments are as collapsed as they are today; further out the same filaments
 * are caught earlier and are fainter, smoother, less finished, and at a
 * sufficient distance they have not formed at all. This is not a rendering
 * effect. It is what every deep survey sees, and it is the reason the distant
 * universe looks different from the nearby one.
 *
 * The second is that the cone ends. Beyond eta(a_obs) there is nothing to see,
 * because no light has had time to arrive - so the table saturates at a growth
 * factor of zero, the field goes back to the unperturbed Gaussian it started
 * as, and what is behind that is the surface of last scattering, which this
 * simulation can also draw. The horizon is not a wall put there for the
 * picture. It is where the integral runs out.
 */

import {
  type Cosmology, growthFactor, particleHorizon, ageAt,
} from './lcdm';
import { GYR, MPC } from '../core/constants';

/** How finely the a-axis is sampled. Log-spaced, so the early universe is not lost. */
const SAMPLES = 512;
/** The earliest scale factor tabulated: well before any structure. */
const A_MIN = 1e-4;

/**
 * One cosmology's conformal-time table.
 *
 * Built once and then only read. The three arrays are parallel and all three
 * are monotone in the index, which is what makes every lookup below a
 * bisection rather than an integral.
 */
export class LightCone {
  readonly cosmology: Cosmology;
  /** Scale factors, ascending. */
  readonly a: Float64Array;
  /** Comoving particle horizon at each, Mpc. Ascending with a. */
  readonly eta: Float64Array;
  /** Linear growth factor at each, normalised to 1 today. Ascending with a. */
  readonly D: Float64Array;

  constructor(cosmology: Cosmology, samples = SAMPLES) {
    this.cosmology = cosmology;
    const n = Math.max(32, samples);
    this.a = new Float64Array(n);
    this.eta = new Float64Array(n);
    this.D = new Float64Array(n);
    // Log-spaced in a, because everything interesting about the early universe
    // happens in the first per cent of it and a linear grid would put two
    // samples there.
    const lo = Math.log(A_MIN);
    const hi = Math.log(1.0);
    for (let i = 0; i < n; i++) {
      const a = Math.exp(lo + ((hi - lo) * i) / (n - 1));
      this.a[i] = a;
      this.eta[i] = particleHorizon(cosmology, a) / MPC;
      this.D[i] = growthFactor(cosmology, a);
    }
  }

  /** Comoving distance light has travelled since the Big Bang, Mpc. */
  horizonMpc(aObs: number): number { return this.interp(this.eta, aObs); }

  /**
   * The scale factor at which light now arriving from `rMpc` away set out.
   *
   * Zero when the distance is past the observer's horizon - which is not an
   * error condition but the answer: there is no epoch at which that light
   * could have left and still be here.
   */
  emissionA(aObs: number, rMpc: number): number {
    const target = this.horizonMpc(aObs) - rMpc;
    if (!(target > this.eta[0])) return 0;
    return this.invert(this.eta, this.a, target);
  }

  /**
   * How far structure had got, at the epoch seen from `rMpc` away.
   *
   * This is the number the renderer wants: one growth factor per particle
   * instead of one for the whole box, and the only thing that has to change in
   * the shader for a snapshot to become an observation.
   */
  growthAt(aObs: number, rMpc: number): number {
    const target = this.horizonMpc(aObs) - rMpc;
    if (!(target > this.eta[0])) return 0;
    return this.invert(this.eta, this.D, target);
  }

  /**
   * Redshift of what is seen at that distance, as *this* observer measures it.
   *
   * 1 + z = a_obs / a_e, not 1/a_e: an observer watching from z = 3 sees a
   * galaxy at a = 0.125 at a redshift of one, not of seven. Infinite past the
   * horizon, where there is no emission epoch at all.
   */
  redshiftAt(aObs: number, rMpc: number): number {
    const ae = this.emissionA(aObs, rMpc);
    return ae > 0 ? aObs / ae - 1 : Infinity;
  }

  /** How long ago the light left, Gyr. */
  lookbackGyr(aObs: number, rMpc: number): number {
    const ae = this.emissionA(aObs, rMpc);
    if (!(ae > 0)) return ageAt(this.cosmology, aObs) / GYR;
    return (ageAt(this.cosmology, aObs) - ageAt(this.cosmology, ae)) / GYR;
  }

  /**
   * The growth factor at every distance out to `maxMpc`, for the shader.
   *
   * A small uniform array rather than a texture: it is sixty-four floats, it
   * is rebuilt only when the observer's own epoch moves, and a table avoids
   * every question about float texture filtering on hardware that may not have
   * it.
   */
  table(aObs: number, maxMpc: number, n = 64): Float32Array {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = this.growthAt(aObs, (maxMpc * i) / (n - 1));
    }
    return out;
  }

  /** Linear interpolation of a parallel array at a given scale factor. */
  private interp(y: Float64Array, aAt: number): number {
    const a = this.a;
    if (aAt <= a[0]) return y[0];
    if (aAt >= a[a.length - 1]) return y[y.length - 1];
    let lo = 0, hi = a.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (a[mid] <= aAt) lo = mid; else hi = mid;
    }
    const t = (aAt - a[lo]) / (a[hi] - a[lo]);
    return y[lo] + (y[hi] - y[lo]) * t;
  }

  /** Given a value on the monotone `x` array, the matching value on `y`. */
  private invert(x: Float64Array, y: Float64Array, xAt: number): number {
    if (xAt <= x[0]) return y[0];
    if (xAt >= x[x.length - 1]) return y[y.length - 1];
    let lo = 0, hi = x.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (x[mid] <= xAt) lo = mid; else hi = mid;
    }
    const t = (xAt - x[lo]) / (x[hi] - x[lo]);
    return y[lo] + (y[hi] - y[lo]) * t;
  }
}

/** Cache one per cosmology: the table is 512 integrals and never changes. */
const cones = new WeakMap<Cosmology, LightCone>();

export function lightCone(c: Cosmology): LightCone {
  let k = cones.get(c);
  if (!k) { k = new LightCone(c); cones.set(c, k); }
  return k;
}
