/**
 * A cluster of galaxies, in motion.
 *
 * A cluster is not a photograph. Its galaxies are falling through a common
 * dark-matter halo at a couple of thousand kilometres a second, and the whole
 * thing crosses itself in about a gigayear - which is short enough that the
 * cluster you see has already rearranged itself many times since it formed.
 * Standing still is the one thing a cluster never does.
 *
 * Three pieces of physics, and each of them is visible:
 *
 *  - **The halo, not the galaxies, does the holding.** Add up every galaxy in
 *    Coma and you get a fiftieth of the mass needed to keep them from flying
 *    apart at the speeds they are measured to have. Zwicky noticed that in
 *    1933 and nobody believed him for forty years. So the galaxies here are
 *    test particles in a fixed NFW potential: they feel the halo, and the
 *    halo barely notices them.
 *
 *  - **They start in equilibrium, not at rest.** Sprinkling galaxies on an NFW
 *    profile and giving them all the same speed produces a cluster that
 *    visibly collapses in the first hundred megayears, which is wrong and
 *    looks wrong. The velocity dispersion that keeps an NFW tracer stationary
 *    is the solution of the isotropic Jeans equation, and it is not a
 *    constant: it rises from zero at the centre, peaks near a fifth of the
 *    virial radius, and falls again. Solve it once, sample from it, and the
 *    radial profile holds for gigayears.
 *
 *  - **The core strips them.** A galaxy plunging through the intracluster
 *    medium at two thousand kilometres a second meets a wind. When the ram
 *    pressure of that wind exceeds the gravity holding the galaxy's own gas
 *    to its disc, the gas leaves - in a visible tail, and permanently. That
 *    is the Gunn & Gott criterion, and it is why the centres of clusters are
 *    full of red galaxies that stopped forming stars and the outskirts are
 *    not. Here it is not painted on: a galaxy reddens when, and because, its
 *    orbit takes it through the core.
 */

import { G, M_SUN, MPC, MYR } from '../core/constants';
import { dynamicalFriction } from './nbody';

/**
 * Newton's constant in the units a cluster is comfortable in:
 * Mpc^3 / (solar mass · Myr^2). About 4.5e-21.
 */
export const G_MPC_MYR = (G * M_SUN * MYR * MYR) / (MPC * MPC * MPC);

/** One kilometre per second, in Mpc per Myr. About 1.02e-6. */
export const KMS_TO_MPC_MYR = (1e3 * MYR) / MPC;

export interface Halo {
  /** Virial mass, solar masses. */
  massMsun: number;
  /** Virial radius, Mpc. */
  radiusMpc: number;
  /** NFW concentration, r_vir / r_s. */
  concentration: number;
}

/**
 * The NFW mass integral, ln(1+u) - u/(1+u). Every formula below is built on it.
 *
 * Written out as a series for small u, because the closed form does not
 * survive being evaluated there. Both terms tend to u while their difference
 * tends to u^2/2, so below about u = 1e-4 double precision has cancelled away
 * every significant digit and what comes back is rounding noise - which, fed
 * into an acceleration divided by r^2, is noise multiplied by 1e18. The series
 * is u^2/2 - 2u^3/3 + 3u^4/4 - ..., with coefficient (-1)^n (n-1)/n.
 */
export function nfwMu(c: number): number {
  if (c < 1e-3) return c * c * (0.5 - (2 * c) / 3 + (3 * c * c) / 4);
  return Math.log1p(c) - c / (1 + c);
}

/** Mass inside a radius, solar masses. */
export function nfwEnclosedMass(h: Halo, rMpc: number): number {
  const rs = h.radiusMpc / h.concentration;
  const u = Math.max(rMpc, 0) / rs;
  return (h.massMsun * nfwMu(u)) / nfwMu(h.concentration);
}

/** Halo density at a radius, solar masses per cubic megaparsec. */
export function nfwDensity(h: Halo, rMpc: number): number {
  const rs = h.radiusMpc / h.concentration;
  const rhoS = h.massMsun / (4 * Math.PI * rs * rs * rs * nfwMu(h.concentration));
  const u = Math.max(rMpc / rs, 1e-6);
  return rhoS / (u * (1 + u) * (1 + u));
}

/** Circular speed at a radius, Mpc/Myr. */
export function circularSpeed(h: Halo, rMpc: number): number {
  if (rMpc <= 0) return 0;
  return Math.sqrt((G_MPC_MYR * nfwEnclosedMass(h, rMpc)) / rMpc);
}

/**
 * Escape speed from a radius, Mpc/Myr.
 *
 * The NFW potential is Phi(r) = -(G M / mu) ln(1 + r/rs) / r, which converges
 * even though the mass does not: a formally infinite halo still lets a galaxy
 * escape.
 */
export function escapeSpeed(h: Halo, rMpc: number): number {
  const rs = h.radiusMpc / h.concentration;
  const r = Math.max(rMpc, rs * 1e-6);
  const phi = (G_MPC_MYR * h.massMsun * Math.log1p(r / rs)) / (nfwMu(h.concentration) * r);
  return Math.sqrt(2 * phi);
}

/**
 * Acceleration toward the centre of an NFW halo, in Mpc/Myr^2.
 *
 * The same law as `nfwAcceleration` in the N-body module, written directly in
 * cluster units so nothing has to be converted every step.
 */
export function haloAcceleration(
  h: Halo,
): (x: number, y: number, z: number, out: Float64Array) => void {
  const rs = h.radiusMpc / h.concentration;
  const norm = (G_MPC_MYR * h.massMsun) / nfwMu(h.concentration);
  return (x, y, z, out) => {
    // Softened, and softened in r rather than r^2: a galaxy sitting exactly on
    // the centre has r2 = 0, and Infinity * 0 is NaN, which then spreads.
    const r = Math.sqrt(x * x + y * y + z * z) + 1e-12;
    const u = r / rs;
    const a = (-norm * nfwMu(u)) / (r * r * r);
    out[0] = a * x; out[1] = a * y; out[2] = a * z;
  };
}

// ---------------------------------------------------------------------------
// The Jeans equation
// ---------------------------------------------------------------------------

const JEANS_N = 4096;
const JEANS_LO = 1e-5;
const JEANS_HI = 1e3;

/**
 * The radial velocity dispersion that leaves an NFW tracer stationary in an
 * NFW potential, as a function of radius.
 *
 * The isotropic Jeans equation in a spherical system is
 *
 *     d(rho sigma_r^2)/dr = -rho GM(r)/r^2
 *
 * which integrates outward from infinity to
 *
 *     sigma_r^2(r) = (1/rho(r)) * integral_r^inf rho(s) GM(s)/s^2 ds
 *
 * There is a closed form involving the dilogarithm; a cumulative trapezoid on
 * a logarithmic grid is shorter, and accurate to a part in ten thousand across
 * five decades of radius. The result is tabulated once per cluster and
 * interpolated, because it is called for every galaxy at build time and it
 * costs nothing after that.
 *
 * Sampling velocities from this dispersion is not exactly sampling the NFW
 * distribution function - a Maxwellian is not the true one - but the second
 * moment is right, and the second moment is what holds the profile up. The
 * tests check that the profile really does hold, over a gigayear.
 *
 * @returns a function of radius in Mpc giving sigma_r in Mpc/Myr
 */
export function jeansDispersion(h: Halo): (rMpc: number) => number {
  const c = h.concentration;
  const rs = h.radiusMpc / c;
  const mu = nfwMu(c);
  const rhoHat = (x: number): number => 1 / (x * (1 + x) * (1 + x));
  const mHat = nfwMu;
  // The integrand of I(x) = integral_x^inf rhoHat(s) mHat(s) / s^2 ds
  const f = (x: number): number => (rhoHat(x) * mHat(x)) / (x * x);

  const l0 = Math.log(JEANS_LO);
  const dl = (Math.log(JEANS_HI) - l0) / (JEANS_N - 1);
  const xs = new Float64Array(JEANS_N);
  const integ = new Float64Array(JEANS_N);
  for (let i = 0; i < JEANS_N; i++) xs[i] = Math.exp(l0 + i * dl);
  // Beyond the grid the integrand falls as ln(s)/s^5, so the remaining tail is
  // f(x_max) * x_max / 4 to leading order. It is negligible either way.
  integ[JEANS_N - 1] = (f(xs[JEANS_N - 1]) * xs[JEANS_N - 1]) / 4;
  for (let i = JEANS_N - 2; i >= 0; i--) {
    // ds = s dl, so the trapezoid is taken on f(s) s
    integ[i] = integ[i + 1] + 0.5 * (f(xs[i]) * xs[i] + f(xs[i + 1]) * xs[i + 1]) * dl;
  }

  const norm = (G_MPC_MYR * h.massMsun) / (mu * rs);
  return (rMpc: number): number => {
    const x = Math.min(JEANS_HI, Math.max(JEANS_LO, rMpc / rs));
    const t = (Math.log(x) - l0) / dl;
    const i = Math.min(JEANS_N - 2, Math.max(0, Math.floor(t)));
    const w = t - i;
    const I = integ[i] * (1 - w) + integ[i + 1] * w;
    const s2 = (norm * I) / rhoHat(x);
    return s2 > 0 ? Math.sqrt(s2) : 0;
  };
}

// ---------------------------------------------------------------------------
// The intracluster medium
// ---------------------------------------------------------------------------

/** Core radius of the intracluster gas, as a fraction of the virial radius. */
export const ICM_CORE = 0.08;
/** Fraction of a cluster's mass that is hot gas, from X-ray observations. */
export const ICM_GAS_FRACTION = 0.12;

/**
 * Density of the intracluster medium, solar masses per cubic megaparsec.
 *
 * The beta model, which is what X-ray surface brightness profiles are actually
 * fitted with: a flat core out to r_c and a r^-2 fall-off beyond it, for
 * beta = 2/3. Normalised so the gas inside the virial radius is the observed
 * twelve per cent of the cluster's mass - which is more baryons than all its
 * galaxies put together, and was a surprise when it was measured.
 */
export function icmDensity(h: Halo, rMpc: number, gasFraction = ICM_GAS_FRACTION): number {
  const rc = h.radiusMpc * ICM_CORE;
  const Y = h.radiusMpc / rc;
  // integral of 4 pi r^2 (1 + (r/rc)^2)^-1 dr from 0 to R  =  4 pi rc^3 (Y - atan Y)
  const rho0 = (gasFraction * h.massMsun) / (4 * Math.PI * rc * rc * rc * (Y - Math.atan(Y)));
  const y = rMpc / rc;
  return rho0 / (1 + y * y);
}

/**
 * The restoring pressure at the very centre of a galaxy's disc.
 *
 * Gunn & Gott's criterion is that gas is stripped wherever the ram pressure
 * exceeds the self-gravity of the disc acting on its own gas layer,
 * 2 pi G Sigma_star(R) Sigma_gas(R). Both surface densities are exponential,
 * with central values M / (2 pi Rd^2), so the restoring pressure falls as
 * exp(-2R/Rd) and this is its value at R = 0 - the hardest the disc can hold
 * on anywhere.
 */
export function bindingPressure(
  stellarMsun: number, scaleLengthMpc: number, gasFraction: number,
): number {
  if (scaleLengthMpc <= 0) return Infinity;
  const s0 = stellarMsun / (2 * Math.PI * scaleLengthMpc * scaleLengthMpc);
  return 2 * Math.PI * G_MPC_MYR * s0 * (gasFraction * s0);
}

/** Ram pressure of a wind of a given density met at a given speed. */
export function ramPressure(rhoIcm: number, speedMpcMyr: number): number {
  return rhoIcm * speedMpcMyr * speedMpcMyr;
}

/**
 * What fraction of an exponential gas disc survives a given ram pressure.
 *
 * The restoring pressure falls as exp(-2R/Rd), so the wind wins everywhere
 * outside a stripping radius
 *
 *     R_strip / Rd = (1/2) ln(P_0 / P_ram)
 *
 * and the gas inside that radius stays. For an exponential disc the mass
 * inside x scale lengths is 1 - (1+x)e^-x, and that is the answer. Note what
 * it does at the extremes: a galaxy in a thin outer wind keeps essentially
 * everything, a galaxy through a rich cluster's core at two thousand
 * kilometres a second keeps nothing, and in between it keeps a truncated
 * disc - which is exactly what is seen in Virgo, where the spirals have
 * hydrogen discs visibly smaller than their stellar ones.
 */
export function retainedFraction(ramP: number, bindP: number): number {
  if (!(ramP > 0)) return 1;
  if (ramP >= bindP) return 0;
  const x = 0.5 * Math.log(bindP / ramP);
  return 1 - (1 + x) * Math.exp(-x);
}

/** How long stripping takes once it starts: roughly a disc crossing, in Myr. */
export const STRIP_TIME_MYR = 180;

// ---------------------------------------------------------------------------
// The cluster
// ---------------------------------------------------------------------------

export interface OrbitSeed {
  /** Position relative to the cluster centre, Mpc. */
  x: number; y: number; z: number;
  /** Subhalo mass, solar masses - only dynamical friction cares. */
  haloMassMsun: number;
  /** Stellar mass, solar masses, and the disc radius in Mpc: for stripping. */
  stellarMsun: number;
  radiusMpc: number;
  /** Gas fraction it starts with, relative to its stars. */
  gasFraction: number;
}

/**
 * Galaxies orbiting in a fixed halo, with their gas being taken off them.
 *
 * Test particles, integrated with kick-drift-kick leapfrog: symplectic, so the
 * energy error oscillates with the orbital phase rather than accumulating, and
 * an orbit integrated for ten thousand steps is still the same orbit. There is
 * no tree and no pairwise force, because there is no point in one: the halo
 * outweighs every galaxy in the cluster put together by a factor of fifty, and
 * galaxy-galaxy encounters in a cluster are rare and glancing. The one
 * exception is dynamical friction, which is a two-body effect against the halo
 * itself and is the reason the biggest galaxy in a cluster is always sitting
 * exactly in the middle.
 */
export class ClusterOrbits {
  readonly n: number;
  /** Positions, Mpc, laid out xyz. */
  readonly pos: Float64Array;
  /** Velocities, Mpc/Myr, laid out xyz. */
  readonly vel: Float64Array;
  readonly acc: Float64Array;
  /** Subhalo masses, solar. */
  readonly mass: Float64Array;
  /** Remaining gas, as a fraction of what the galaxy started with: 1 to 0. */
  readonly gas: Float64Array;
  /**
   * How hard each galaxy is losing gas at this moment, 0 to 1.
   *
   * Not the same as having lost it. A galaxy settles to whatever the wind
   * where it is allows, and then stops; only one that has just fallen into a
   * denser wind than it is used to is actively streaming, and only those grow
   * a tail. It is the difference that is visible, and it lasts a few hundred
   * megayears out of a ten-gigayear life, which is why jellyfish galaxies are
   * rare and always near a cluster centre.
   */
  readonly strip: Float64Array;
  /** The pressure each galaxy's own gravity can resist, precomputed. */
  private bind: Float64Array;
  private count = 0;
  private ext = new Float64Array(3);
  private drag = new Float64Array(3);
  private primed = false;

  /** Elapsed time, Myr. */
  timeMyr = 0;
  /** Whether massive galaxies sink. Off makes the cluster exactly stationary. */
  friction = true;
  /** Whether the intracluster wind strips gas. */
  stripping = true;

  readonly sigmaOf: (rMpc: number) => number;
  private accel: (x: number, y: number, z: number, out: Float64Array) => void;

  constructor(readonly halo: Halo, capacity: number) {
    this.n = capacity;
    this.pos = new Float64Array(capacity * 3);
    this.vel = new Float64Array(capacity * 3);
    this.acc = new Float64Array(capacity * 3);
    this.mass = new Float64Array(capacity);
    this.gas = new Float64Array(capacity);
    this.strip = new Float64Array(capacity);
    this.bind = new Float64Array(capacity);
    this.sigmaOf = jeansDispersion(halo);
    this.accel = haloAcceleration(halo);
  }

  /** How many galaxies have been placed. */
  get length(): number { return this.count; }

  /**
   * Place one galaxy and give it a velocity drawn from the local dispersion.
   *
   * Isotropic: three independent Gaussians at sigma_r, which is the isotropic
   * case of the Jeans solution. Anything faster than the escape speed is
   * redrawn, because a cluster that evaporates on the first frame is not a
   * cluster.
   */
  place(s: OrbitSeed, rand: () => number): number {
    const i = this.count++;
    this.pos[i * 3] = s.x; this.pos[i * 3 + 1] = s.y; this.pos[i * 3 + 2] = s.z;
    this.mass[i] = s.haloMassMsun;
    this.gas[i] = 1;
    this.bind[i] = bindingPressure(s.stellarMsun, s.radiusMpc, Math.max(s.gasFraction, 1e-3));

    const r = Math.hypot(s.x, s.y, s.z);
    const sigma = this.sigmaOf(r);
    const vesc = escapeSpeed(this.halo, r);
    let vx = 0, vy = 0, vz = 0;
    for (let k = 0; k < 24; k++) {
      vx = gauss(rand) * sigma; vy = gauss(rand) * sigma; vz = gauss(rand) * sigma;
      if (Math.hypot(vx, vy, vz) < 0.95 * vesc) break;
    }
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    return i;
  }

  /** Pin a galaxy at the centre and at rest: the brightest cluster galaxy. */
  anchor(i: number): void {
    this.pos[i * 3] = this.pos[i * 3 + 1] = this.pos[i * 3 + 2] = 0;
    this.vel[i * 3] = this.vel[i * 3 + 1] = this.vel[i * 3 + 2] = 0;
  }

  private computeAccelerations(): void {
    const lnLambda = 3.0;
    for (let i = 0; i < this.count; i++) {
      const x = this.pos[i * 3], y = this.pos[i * 3 + 1], z = this.pos[i * 3 + 2];
      this.accel(x, y, z, this.ext);
      let ax = this.ext[0], ay = this.ext[1], az = this.ext[2];
      if (this.friction && this.mass[i] > 0) {
        const r = Math.hypot(x, y, z);
        dynamicalFriction(
          G_MPC_MYR, this.mass[i], nfwDensity(this.halo, r), Math.max(this.sigmaOf(r), 1e-9),
          lnLambda, this.vel[i * 3], this.vel[i * 3 + 1], this.vel[i * 3 + 2], this.drag,
        );
        ax += this.drag[0]; ay += this.drag[1]; az += this.drag[2];
      }
      this.acc[i * 3] = ax; this.acc[i * 3 + 1] = ay; this.acc[i * 3 + 2] = az;
    }
  }

  /** One leapfrog step, dt in Myr. */
  step(dtMyr: number): void {
    if (this.count === 0 || dtMyr === 0) return;
    if (!this.primed) { this.computeAccelerations(); this.primed = true; }
    const h = dtMyr * 0.5;
    for (let i = 0; i < this.count * 3; i++) {
      this.vel[i] += this.acc[i] * h;
      this.pos[i] += this.vel[i] * dtMyr;
    }
    this.computeAccelerations();
    for (let i = 0; i < this.count * 3; i++) this.vel[i] += this.acc[i] * h;
    this.timeMyr += dtMyr;
    if (this.stripping) this.stripGas(dtMyr);
  }

  /**
   * Take gas off whatever is moving fast through dense enough gas to lose it.
   *
   * Irreversible, deliberately: a galaxy that has been through the core once
   * does not get its gas back on the way out, and the red galaxies in a cluster
   * centre are the ones that have been there longest.
   */
  private stripGas(dtMyr: number): void {
    for (let i = 0; i < this.count; i++) {
      if (this.gas[i] <= 0) { this.strip[i] = 0; continue; }
      const target = this.retained(i);
      const deficit = this.gas[i] - target;
      if (deficit <= 0) { this.strip[i] = 0; continue; }
      // It takes a disc crossing to actually push the gas out, so the galaxy
      // approaches what the wind allows rather than jumping to it - and the
      // gap between the two is the tail.
      const dg = Math.min(deficit, (dtMyr / STRIP_TIME_MYR) * deficit);
      this.gas[i] = Math.max(0, this.gas[i] - dg);
      // A dead zone below a few per cent: every galaxy in a cluster is losing
      // its outermost hydrogen all the time, and that is not a tail.
      this.strip[i] = Math.min(1, Math.max(0, deficit - 0.04) / 0.16);
    }
  }

  /** The gas fraction the wind where this galaxy is would leave it. */
  retained(i: number): number {
    const r = Math.hypot(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
    const v = Math.hypot(this.vel[i * 3], this.vel[i * 3 + 1], this.vel[i * 3 + 2]);
    return retainedFraction(ramPressure(icmDensity(this.halo, r), v), this.bind[i]);
  }

  /**
   * Start every galaxy with the gas its present orbit would have left it.
   *
   * Without this the whole cluster begins with full discs and strips itself in
   * the first two hundred megayears, which is both wrong - these galaxies have
   * been here for gigayears - and a mess to look at, because every galaxy in
   * the frame grows a tail at once.
   */
  settle(): void {
    for (let i = 0; i < this.count; i++) {
      this.gas[i] = this.retained(i);
      this.strip[i] = 0;
    }
  }

  /** Distance from the cluster centre, Mpc. */
  radius(i: number): number {
    return Math.hypot(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
  }

  /** Speed, km/s - which is how a cluster's motions are always quoted. */
  speedKms(i: number): number {
    return Math.hypot(this.vel[i * 3], this.vel[i * 3 + 1], this.vel[i * 3 + 2]) / KMS_TO_MPC_MYR;
  }

  /** One velocity component, km/s: what a redshift actually measures. */
  losKms(i: number, axis = 2): number {
    return this.vel[i * 3 + axis] / KMS_TO_MPC_MYR;
  }

  /**
   * The line-of-sight velocity dispersion, km/s.
   *
   * The only mass measurement a cluster offered anyone for sixty years, and
   * still the quickest: measure the spread of redshifts, apply the virial
   * theorem, and out comes a mass fifty times what the light accounts for.
   */
  dispersionKms(axis = 2): number {
    if (this.count === 0) return 0;
    let s = 0, s2 = 0;
    for (let i = 0; i < this.count; i++) {
      const v = this.losKms(i, axis);
      s += v; s2 += v * v;
    }
    const mean = s / this.count;
    return Math.sqrt(Math.max(0, s2 / this.count - mean * mean));
  }

  /** Total specific energy of one galaxy, for checking the integration. */
  specificEnergy(i: number): number {
    const r = Math.max(this.radius(i), 1e-9);
    const rs = this.halo.radiusMpc / this.halo.concentration;
    const phi = -(G_MPC_MYR * this.halo.massMsun * Math.log1p(r / rs))
      / (nfwMu(this.halo.concentration) * r);
    const v2 = this.vel[i * 3] ** 2 + this.vel[i * 3 + 1] ** 2 + this.vel[i * 3 + 2] ** 2;
    return 0.5 * v2 + phi;
  }

  /** The radius containing a given fraction of the galaxies, Mpc. */
  quantileRadius(f: number): number {
    if (this.count === 0) return 0;
    const rs: number[] = [];
    for (let i = 0; i < this.count; i++) rs.push(this.radius(i));
    rs.sort((a, b) => a - b);
    return rs[Math.min(rs.length - 1, Math.max(0, Math.round(f * (rs.length - 1))))];
  }
}

/** Box-Muller, one value per call, from a plain uniform generator. */
function gauss(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
