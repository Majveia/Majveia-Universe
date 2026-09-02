/**
 * A comet, its coma, and its two tails.
 *
 * Dust grains are not animated along a painted curve: each one is released from
 * the nucleus with a small ejection velocity and then put on its own Keplerian
 * orbit about a Sun whose gravity radiation pressure has reduced by a factor
 * (1 - beta). After that its position at any time is analytic. The curved,
 * yellowish, lagging dust tail is simply what a few thousand such grains look
 * like when they are drawn all at once - a family of syndynes, without anyone
 * having to draw a syndyne.
 *
 * Ions are treated separately because they behave differently: picked up by the
 * solar wind at hundreds of kilometres a second, they leave in an almost
 * straight ray away from the Sun, swept back only by the aberration from the
 * comet's own transverse motion. So the two tails point in different
 * directions, and the angle between them is a real measurement.
 */

import * as THREE from 'three';
import { AU } from '../core/constants';
import { RNG } from '../core/rng';
import { PointCloud } from './pointcloud';
import { stateAt, type OrbitalElements, type StateVector } from '../physics/kepler';
import {
  activity, releaseGrain, sampleBeta, ionTailAberration, type Comet,
} from '../astro/comet';

interface Grain {
  el: OrbitalElements;
  beta: number;
  t0: number;
  alive: boolean;
}

export interface CometViewOptions {
  /** Dust grains to track. */
  dust?: number;
  /** Ion tail samples. */
  ions?: number;
  /** Length of the ion tail at full activity, AU. */
  ionLengthAu?: number;
}

export class CometView {
  readonly group = new THREE.Group();
  private dustCloud: PointCloud;
  private ionCloud: PointCloud;
  private nucleus: PointCloud;
  private grains: Grain[] = [];
  private rng: RNG;
  private next = 0;
  private releaseAccum = 0;
  private ionN: number;
  private ionLengthAu: number;
  private ionJitter!: Float32Array;
  /** How long a grain is tracked, seconds. */
  private maxAge: number;
  /** Heliocentric distance at which this comet is fully active, AU. */
  private brightAu: number;
  /** Heliocentric distance last frame, AU. */
  heliocentricAu = 0;
  /** Current activity, 0 to 1. */
  activityNow = 0;
  /** How far the furthest tracked grain has got from the nucleus, AU. */
  dustTailAu = 0;
  /** Length of the ion tail as drawn, AU. */
  ionTailAu = 0;
  private state: StateVector = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };

  constructor(readonly comet: Comet, readonly muStar: number, opts: CometViewOptions = {}) {
    const nDust = opts.dust ?? 2600;
    this.ionN = opts.ions ?? 420;
    this.rng = new RNG(comet.seed ^ 0x0c0e7);

    // Nothing here may be written in absolute AU or years: the same comet code
    // has to serve a red dwarf whose ice line is at 0.09 AU and a hot star
    // whose ice line is at 12. Every length is set by where the comet turns on,
    // and every time by the orbital period at perihelion - which is the only
    // clock the tail actually has.
    this.brightAu = comet.activityAu / 2.2;
    // The apparition's own clock: the orbital period at the distance where the
    // comet is fully switched on. Tying the grain lifetime to the period at
    // perihelion instead would give a sungrazer a tail lasting days and a
    // distant comet one lasting decades, when what actually sets the length of
    // a tail is how long the grains stay lit.
    const rB = this.brightAu * AU;
    const brightPeriod = 2 * Math.PI * Math.sqrt((rB * rB * rB) / muStar);
    this.maxAge = 0.22 * brightPeriod;
    this.ionLengthAu = opts.ionLengthAu ?? 0.30 * comet.activityAu;

    // Dust: sunlight reflected off silicate grains, so slightly warm white.
    const dcol = new Float32Array(nDust * 3);
    const dsty = new Float32Array(nDust * 2);
    for (let i = 0; i < nDust; i++) {
      dcol[i * 3] = 1.0; dcol[i * 3 + 1] = 0.90; dcol[i * 3 + 2] = 0.72;
      dsty[i * 2] = 1; dsty[i * 2 + 1] = 0;
      this.grains.push({
        el: { a: 1, e: 0, i: 0, Omega: 0, omega: 0, M0: 0, epoch: 0 },
        beta: 0, t0: 0, alive: false,
      });
    }
    this.dustCloud = new PointCloud(nDust, dcol, dsty);
    this.dustCloud.setSize(2.9);
    this.dustCloud.setBrightness(1);
    this.dustCloud.setCount(0);
    this.group.add(this.dustCloud.points);

    // Ions: the 420 nm CO+ band, which is why an ion tail is blue and a dust
    // tail is not.
    const icol = new Float32Array(this.ionN * 3);
    const isty = new Float32Array(this.ionN * 2);
    for (let i = 0; i < this.ionN; i++) {
      icol[i * 3] = 0.30; icol[i * 3 + 1] = 0.58; icol[i * 3 + 2] = 1.0;
      isty[i * 2] = 1; isty[i * 2 + 1] = 0;
    }
    // Fixed jitter per sample. Deriving it from the sample index with an
    // integer hash puts the samples on a lattice, which shows up as moire
    // across a long thin tail; drawing it once from the stream does not.
    this.ionJitter = new Float32Array(this.ionN * 3);
    for (let i = 0; i < this.ionN; i++) {
      this.ionJitter[i * 3] = this.rng.range(-1, 1);
      this.ionJitter[i * 3 + 1] = this.rng.range(-1, 1);
      this.ionJitter[i * 3 + 2] = this.rng.range(0, Math.PI * 2);
    }
    this.ionCloud = new PointCloud(this.ionN, icol, isty);
    this.ionCloud.setSize(2.4);
    this.ionCloud.setBrightness(1);
    this.ionCloud.setCount(0);
    this.group.add(this.ionCloud.points);

    const ncol = new Float32Array([1.0, 0.94, 0.82]);
    const nsty = new Float32Array([3.5, 1]);
    this.nucleus = new PointCloud(1, ncol, nsty);
    this.nucleus.setSize(4.5);
    this.nucleus.setCount(1);
    this.group.add(this.nucleus.points);
  }

  /** Position of the nucleus in scene units (AU), y-up. */
  get position(): [number, number, number] {
    return [this.state.x / AU, this.state.z / AU, this.state.y / AU];
  }

  update(timeS: number, dtS: number): void {
    const c = this.comet;
    this.state = stateAt(c.elements, this.muStar, timeS, this.state);
    const rAu = Math.hypot(this.state.x, this.state.y, this.state.z) / AU;
    this.heliocentricAu = rAu;
    const act = activity(rAu, c.activityAu);
    this.activityNow = act;

    // --- Nucleus and coma
    const [nx, ny, nz] = this.position;
    this.nucleus.positions[0] = nx;
    this.nucleus.positions[1] = ny;
    this.nucleus.positions[2] = nz;
    // The coma is the brightest thing about a comet, but it is a diffuse ball,
    // not a star: let it grow rather than simply burn hotter.
    this.nucleus.style[1] = 0.10 + 2.6 * act;
    this.nucleus.style[0] = 1.8 + 5.5 * Math.pow(act, 0.6);
    this.nucleus.setPositions(1);
    this.nucleus.touchAppearance();

    // --- Release new grains in proportion to activity.
    if (act > 1e-4 && dtS > 0) {
      // Grains are released over the whole active arc, so the release rate is
      // set per unit of simulated time rather than per frame.
      this.releaseAccum += act * this.grains.length * 1.15 * (dtS / this.maxAge);
      // At high time warp a single frame can span a whole apparition. Refilling
      // the entire buffer in one frame would cost more than it shows, so the
      // release is capped and the shortfall dropped rather than carried: what
      // is being drawn then is a sparser sample of the same tail, not a lagging
      // one.
      const budgetCap = Math.max(24, this.grains.length >> 3);
      let budget = Math.min(budgetCap, Math.floor(this.releaseAccum));
      this.releaseAccum = Math.min(this.releaseAccum - budget, budgetCap);
      const rel: StateVector = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
      while (budget-- > 0) {
        const g = this.grains[this.next];
        this.next = (this.next + 1) % this.grains.length;
        g.beta = sampleBeta(this.rng, 8e-4, 0.75);
        // Ejection speed from gas drag: metres per second for big grains,
        // hundreds for the smallest.
        const v = 8 + 340 * Math.sqrt(g.beta) * (0.4 + 0.6 * act);
        // Release at a random instant inside the step rather than all at once
        // at its end. Grains sharing a release time lie on a synchrone, so a
        // once-per-frame release draws the tail as a set of discrete arcs -
        // a sampling artefact of the frame rate, not of the comet. Spread over
        // the step, the same grains fill the sheet between those arcs.
        const tRel = timeS - dtS * this.rng.next();
        stateAt(c.elements, this.muStar, tRel, rel);
        g.el = releaseGrain(rel, this.muStar, g.beta, v, tRel, this.rng);
        g.t0 = tRel;
        g.alive = true;
      }
    }

    // --- Dust positions: one Kepler evaluation per grain, no integration.
    const pos = this.dustCloud.positions;
    const sty = this.dustCloud.style;
    let n = 0;
    const maxAge = this.maxAge;
    let far = 0;
    const tmp: StateVector = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    for (const g of this.grains) {
      if (!g.alive) continue;
      const age = timeS - g.t0;
      if (age < 0 || age > maxAge) { g.alive = false; continue; }
      stateAt(g.el, this.muStar * (1 - g.beta), timeS, tmp);
      const gr = Math.hypot(tmp.x, tmp.y, tmp.z);
      // Unbound grains eventually leave; drop them once they are far enough
      // out that they contribute nothing but arithmetic.
      if (!Number.isFinite(gr) || gr > 40 * this.brightAu * AU) { g.alive = false; continue; }
      pos[n * 3] = tmp.x / AU;
      pos[n * 3 + 1] = tmp.z / AU;
      pos[n * 3 + 2] = tmp.y / AU;
      const sep = Math.hypot(pos[n * 3] - nx, pos[n * 3 + 1] - ny, pos[n * 3 + 2] - nz);
      if (sep > far) far = sep;
      // Scattered sunlight falls as 1/r^2, and the grain fades as the tail
      // disperses; small grains are also individually fainter.
      // Each drawn grain stands for an enormous number of real ones, so it is
      // drawn as a packet rather than a speck: the packet spreads as it ages,
      // and its surface brightness falls as the same light is spread over the
      // larger area. Otherwise a few thousand points read as beads on a string
      // instead of as a tail. Scattered sunlight still falls as 1/r^2.
      const frac = age / maxAge;
      const fade = 1 - frac;
      const spread = 1.7 + 4.2 * frac;
      const u = this.brightAu / Math.max(gr / AU, 1e-6);
      const illum = Math.min(u * u, 9);
      sty[n * 2] = spread * (0.75 + 0.5 * (1 - g.beta));
      sty[n * 2 + 1] = 0.13 * illum * Math.pow(fade, 1.5)
        * (0.35 + 0.65 * (1 - g.beta)) / (spread * spread);
      n++;
    }
    this.dustCloud.setPositions(n);
    this.dustCloud.touchAppearance();
    this.dustTailAu = far;

    // --- Ion tail: a straight ray away from the Sun, swept back by the
    //     comet's transverse motion against the solar wind.
    if (act > 2e-4) {
      const r = Math.hypot(this.state.x, this.state.y, this.state.z) || 1;
      const anti = new THREE.Vector3(this.state.x / r, this.state.z / r, this.state.y / r);
      const vel = new THREE.Vector3(this.state.vx, this.state.vz, this.state.vy);
      const vr = vel.dot(anti);
      const trans = vel.clone().addScaledVector(anti, -vr);
      const ab = ionTailAberration(this.state);
      const dir = anti.clone().multiplyScalar(Math.cos(ab));
      if (trans.lengthSq() > 0) dir.addScaledVector(trans.normalize(), -Math.sin(ab));
      dir.normalize();

      const L = this.ionLengthAu * Math.pow(act, 0.35);
      this.ionTailAu = L;
      const ipos = this.ionCloud.positions;
      const isty = this.ionCloud.style;
      const origin = new THREE.Vector3(nx, ny, nz);
      const side1 = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
      const side2 = new THREE.Vector3().crossVectors(dir, side1);
      for (let i = 0; i < this.ionN; i++) {
        const s = (i + 0.5) / this.ionN;
        // Denser near the head, and flaring gently along the tail
        const t = Math.pow(s, 1.6);
        const spread = L * 0.045 * Math.pow(s, 0.8);
        const a1 = this.ionJitter[i * 3];
        const a2 = this.ionJitter[i * 3 + 1];
        // Knots and streamers: real ion tails are structured by the solar wind
        const knot = 0.55 + 0.45 * Math.sin(s * 27 + timeS * 2e-7 + this.ionJitter[i * 3 + 2]);
        const p = origin.clone()
          .addScaledVector(dir, L * t)
          .addScaledVector(side1, a1 * spread)
          .addScaledVector(side2, a2 * spread);
        ipos[i * 3] = p.x; ipos[i * 3 + 1] = p.y; ipos[i * 3 + 2] = p.z;
        isty[i * 2] = 1.1 + 2.6 * s;
        isty[i * 2 + 1] = 0.42 * act * knot * (1 - 0.85 * s) * (1 - 0.85 * s)
          / (1 + 2.4 * s) / (1 + 2.4 * s);
      }
      this.ionCloud.setPositions(this.ionN);
      this.ionCloud.touchAppearance();
    } else {
      this.ionCloud.setCount(0);
      this.ionTailAu = 0;
    }
  }

  setBrightness(v: number): void {
    this.dustCloud.setBrightness(v);
    this.ionCloud.setBrightness(v);
    this.nucleus.setBrightness(v);
  }

  dispose(): void {
    this.dustCloud.dispose();
    this.ionCloud.dispose();
    this.nucleus.dispose();
  }
}
