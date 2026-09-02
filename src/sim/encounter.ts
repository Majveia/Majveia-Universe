/**
 * A galaxy collision, integrated rather than animated.
 *
 * This is the Toomre & Toomre (1972) experiment, the paper that settled what
 * the "peculiar galaxies" in Arp's atlas actually are. Their insight was that
 * the spectacular bridges and tails of an interacting pair need no
 * hydrodynamics, no magnetic fields, nothing exotic: they are what gravity does
 * to a cold rotating disc when another galaxy passes close by. Stars on the
 * near side are pulled toward the intruder and form a bridge; stars on the far
 * side are left behind by the accelerating centre and stream out as a tail.
 * Prograde encounters, where the disc turns the same way the orbit does,
 * produce the longest tails, because those stars stay in resonance with the
 * perturbation instead of sweeping through it.
 *
 * The model is the *restricted* problem, which is what Toomre solved and what
 * is still the right tool here:
 *
 *  - Each galaxy is a rigid Hernquist halo, whose enclosed mass has a closed
 *    form and therefore so does its acceleration: g = -G M / (r + a)^2.
 *  - The two centres orbit under each other's potential, plus Chandrasekhar
 *    dynamical friction, which is what actually makes a merger finish rather
 *    than orbit forever.
 *  - The discs are massless tracers that feel both potentials and contribute
 *    nothing back.
 *
 * Representing the haloes as clouds of massive particles instead would look
 * more principled and be worse: a few hundred particles of a billion solar
 * masses each scatter the disc by two-body relaxation and puff a cold disc into
 * a fuzzy blob within a few hundred megayears, hiding the very structure the
 * simulation exists to show. Rigid potentials have no shot noise, so the
 * only thing that heats these discs is the encounter itself.
 *
 * Units: kiloparsecs, megayears, solar masses. G = 4.4985e-3 kpc^3/(1e9 Msun Myr^2).
 */

import { G_GAL, dynamicalFriction } from '../physics/nbody';
import { RNG } from '../core/rng';
import { blackbodyRGB } from '../astro/blackbody';
import type { GalaxyParams } from '../galaxy/generator';
import { rotationCurve } from '../galaxy/generator';

/** G in kpc (km/s)^2 per 10^9 Msun. 220 km/s at 8 kpc gives 9.0e10 Msun. */
const G_KMS = 4302.0;
/** How much shallower than the true disc the tracers are sampled. */
const SAMPLE_STRETCH = 1.9;
const KMS_TO_KPC_PER_MYR = 1.02271e-3;

export interface Halo {
  /** Mass, 10^9 Msun. */
  M: number;
  /** Hernquist scale radius, kpc. */
  a: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
}

export interface EncounterOptions {
  seed: number;
  /** Tracer stars per disc. */
  tracers: number;
  /** Mass ratio of intruder to primary. */
  massRatio?: number;
  /** Pericentre of the initial orbit, in disc radii. */
  pericentre?: number;
  /** Initial separation, in disc radii. */
  separation?: number;
  /** Disc spin aligned with the orbit. Prograde makes the longest tails. */
  prograde?: boolean;
  /** Inclination of the primary disc to the orbital plane, radians. */
  inclination?: number;
  /** Include dynamical friction on the centres. */
  friction?: boolean;
}

export class Encounter {
  readonly haloes: [Halo, Halo];
  /** Tracer positions, interleaved xyz. */
  readonly pos: Float64Array;
  readonly vel: Float64Array;
  readonly count: number;
  readonly colors: Float32Array;
  readonly style: Float32Array;
  /** Which galaxy each tracer belongs to. */
  readonly owner: Uint8Array;
  time = 0;
  dt: number;
  scaleKpc: number;
  label: string;
  friction: boolean;
  /** Closest approach reached so far, kpc. */
  minSeparation = Infinity;
  /** Time of pericentre, Myr; NaN until it happens. */
  pericentreTime = NaN;

  private acc: Float64Array;
  private tmp = new Float64Array(3);

  constructor(p: GalaxyParams, opts: EncounterOptions) {
    const rng = new RNG(opts.seed ^ 0x3c0111);
    const ratio = opts.massRatio ?? rng.range(0.3, 1.0);
    const Rd = Math.max(p.discScaleKpc, 0.5);
    const Rdisc = Math.max(p.radiusKpc, 2);
    const prograde = opts.prograde ?? true;
    const incl = opts.inclination ?? rng.range(0.15, 0.7);
    this.friction = opts.friction ?? true;

    const M1 = (p.vMaxKms * p.vMaxKms * Rdisc * 2.2) / G_KMS;
    const M2 = M1 * ratio;
    const a1 = Rdisc * 0.55;
    const a2 = a1 * Math.cbrt(ratio);

    // --- Parabolic passage: the case Toomre used, because a bound circular
    //     pair never has a dramatic first encounter.
    const rPeri = (opts.pericentre ?? rng.range(0.6, 1.4)) * Rdisc;
    const sep = (opts.separation ?? 4.5) * Rdisc;
    const Mtot = M1 + M2;
    const vRel = Math.sqrt((2 * G_GAL * Mtot) / sep);
    const L = Math.sqrt(2 * G_GAL * Mtot * rPeri);
    const vt = Math.min(L / sep, vRel);
    const vr = -Math.sqrt(Math.max(vRel * vRel - vt * vt, 0));
    const f1 = M2 / Mtot, f2 = M1 / Mtot;

    this.haloes = [
      { M: M1, a: a1, x: -sep * f1, y: 0, z: 0, vx: -vr * f1, vy: 0, vz: -vt * f1 },
      { M: M2, a: a2, x: sep * f2, y: 0, z: 0, vx: vr * f2, vy: 0, vz: vt * f2 },
    ];

    // --- Tracers
    const n = opts.tracers * 2;
    this.count = n;
    this.pos = new Float64Array(n * 3);
    this.vel = new Float64Array(n * 3);
    this.acc = new Float64Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.style = new Float32Array(n * 2);
    this.owner = new Uint8Array(n);

    let w = 0;
    const emit = (
      x: number, y: number, z: number, vx: number, vy: number, vz: number,
      r: number, g: number, b: number, size: number, bright: number, who: number,
    ) => {
      this.pos[w * 3] = x; this.pos[w * 3 + 1] = y; this.pos[w * 3 + 2] = z;
      this.vel[w * 3] = vx; this.vel[w * 3 + 1] = vy; this.vel[w * 3 + 2] = vz;
      this.colors[w * 3] = r; this.colors[w * 3 + 1] = g; this.colors[w * 3 + 2] = b;
      this.style[w * 2] = size; this.style[w * 2 + 1] = bright;
      this.owner[w] = who;
      w++;
    };

    const buildDisc = (
      halo: Halo, scaleLen: number, Rmax: number, spin: number, tilt: number,
      tint: [number, number, number], who: number, count: number,
    ) => {
      const ct = Math.cos(tilt), st = Math.sin(tilt);
      const bulgeN = Math.floor(count * 0.10);
      for (let i = 0; i < count; i++) {
        if (i < bulgeN) {
          // A luminous bulge. It is pressure supported, so it comes through the
          // encounter almost untouched while the cold disc around it is torn
          // apart - the contrast that makes a real interacting pair legible.
          const u = rng.next();
          const sq = Math.sqrt(u);
          const ab = scaleLen * 0.32;
          const r = Math.min(ab * 7, (ab * sq) / Math.max(1e-3, 1 - sq));
          const d = rng.onSphere();
          const vc = Math.sqrt((G_GAL * halo.M * r) / ((r + halo.a) * (r + halo.a)));
          const sig = vc * 0.6;
          const c = blackbodyRGB(4300);
          emit(
            halo.x + r * d[0], halo.y + r * d[1], halo.z + r * d[2],
            halo.vx + rng.normal(0, sig), halo.vy + rng.normal(0, sig), halo.vz + rng.normal(0, sig),
            c[0] * tint[0], c[1] * tint[1] * 0.95, c[2] * tint[2] * 0.8, 1.0, 0.24, who);
          continue;
        }
        // Importance sampling. A disc's surface density is exponential, so
        // sampling it directly puts almost every tracer inside two scale
        // lengths - and the tails, which come from the outer disc, end up drawn
        // by a handful of particles. Instead sample from a shallower
        // exponential and carry the ratio in each particle's brightness: the
        // rendered surface brightness is still exponential, but the outskirts
        // are populated well enough to show what happens to them.
        const sampleLen = scaleLen * SAMPLE_STRETCH;
        let r = 0;
        for (let k = 0; k < 30; k++) {
          r = -sampleLen * Math.log(1 - rng.next() * 0.995);
          if (r < Rmax) break;
        }
        r = Math.max(Math.min(r, Rmax), scaleLen * 0.05);
        const weight = Math.exp(-r * (1 / scaleLen - 1 / sampleLen));
        const th = rng.range(0, Math.PI * 2);
        // Circular speed in this halo, so the disc starts in equilibrium.
        const vc = Math.sqrt((G_GAL * halo.M * r) / ((r + halo.a) * (r + halo.a)));
        const x0 = r * Math.cos(th), z0 = r * Math.sin(th);
        const vx0 = -vc * Math.sin(th) * spin, vz0 = vc * Math.cos(th) * spin;
        // A little vertical thickness and a little velocity dispersion, so the
        // disc is cold but not unphysically razor thin.
        const h = rng.normal(0, scaleLen * 0.05);
        const y = z0 * st + h * ct;
        const z = z0 * ct - h * st;
        const vy = vz0 * st, vz = vz0 * ct;
        const t = Math.min(1, r / Rmax);
        const c = blackbodyRGB(4300 + t * 4800);
        emit(
          halo.x + x0, halo.y + y, halo.z + z,
          halo.vx + vx0 + rng.normal(0, vc * 0.05),
          halo.vy + vy + rng.normal(0, vc * 0.05),
          halo.vz + vz + rng.normal(0, vc * 0.05),
          c[0] * tint[0], c[1] * tint[1], c[2] * tint[2],
          1.0, weight * 1.25, who);
        void rotationCurve;
      }
    };

    buildDisc(this.haloes[0], Rd, Rdisc, prograde ? 1 : -1, incl, [1, 1, 1], 0, opts.tracers);
    buildDisc(this.haloes[1], Rd * Math.cbrt(ratio), Rdisc * Math.cbrt(ratio),
      prograde ? 1 : -1, incl * 0.5 + 0.6, [0.82, 0.9, 1.2], 1, opts.tracers);

    const vChar = Math.max(rotationCurve(p, Rd), 40) * KMS_TO_KPC_PER_MYR;
    this.dt = Math.max(0.4, Math.min(8, (Rd * 0.08) / vChar));
    this.scaleKpc = sep * 0.8;
    this.label = `${prograde ? 'prograde' : 'retrograde'} · ${ratio.toFixed(2)}:1 · ` +
      `pericentre ${rPeri.toFixed(0)} kpc`;

    this.computeAccelerations();
  }

  /** Acceleration of a Hernquist sphere at an offset. Exact, no softening needed. */
  private haloAcc(h: Halo, x: number, y: number, z: number, out: Float64Array, add: boolean): void {
    const dx = x - h.x, dy = y - h.y, dz = z - h.z;
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6;
    const g = (-G_GAL * h.M) / ((r + h.a) * (r + h.a) * r);
    if (add) { out[0] += g * dx; out[1] += g * dy; out[2] += g * dz; }
    else { out[0] = g * dx; out[1] = g * dy; out[2] = g * dz; }
  }

  /** Hernquist density at radius r, 10^9 Msun / kpc^3. */
  private haloDensity(h: Halo, r: number): number {
    const rr = Math.max(r, 1e-4);
    return (h.M * h.a) / (2 * Math.PI * rr * Math.pow(rr + h.a, 3));
  }

  private computeAccelerations(): void {
    const [h0, h1] = this.haloes;
    const a = this.acc;
    for (let i = 0; i < this.count; i++) {
      const x = this.pos[i * 3], y = this.pos[i * 3 + 1], z = this.pos[i * 3 + 2];
      this.haloAcc(h0, x, y, z, this.tmp, false);
      a[i * 3] = this.tmp[0]; a[i * 3 + 1] = this.tmp[1]; a[i * 3 + 2] = this.tmp[2];
      this.haloAcc(h1, x, y, z, this.tmp, false);
      a[i * 3] += this.tmp[0]; a[i * 3 + 1] += this.tmp[1]; a[i * 3 + 2] += this.tmp[2];
    }
  }

  /**
   * Acceleration of one centre: the other halo's gravity, plus Chandrasekhar
   * dynamical friction.
   *
   * Two things have to be handled or the friction term destroys the run.
   * First, Chandrasekhar's formula is derived for a *point* satellite, and its
   * density term diverges as 1/r at the centre of a Hernquist halo - so at
   * pericentre a naive evaluation produces an acceleration larger than gravity
   * and flings the pair apart. A real satellite is extended and samples the
   * field over its own size, so the density is evaluated no closer in than the
   * satellite's own scale radius. Second, the drag is capped at a fraction of
   * the mutual gravitational acceleration, which keeps it what it physically
   * is - a perturbation that drains orbital energy over many passages - rather
   * than the dominant term in the equation of motion.
   */
  private centreAcc(i: number, out: Float64Array): void {
    const self = this.haloes[i];
    const other = this.haloes[1 - i];
    this.haloAcc(other, self.x, self.y, self.z, out, false);
    if (!this.friction) return;

    const dx = self.x - other.x, dy = self.y - other.y, dz = self.z - other.z;
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const rEff = Math.max(r, self.a);
    const rho = this.haloDensity(other, rEff);
    const sigma = Math.sqrt((G_GAL * other.M) / (6 * (rEff + other.a)));
    const rvx = self.vx - other.vx, rvy = self.vy - other.vy, rvz = self.vz - other.vz;
    const lnL = Math.max(0.5, Math.log(Math.max(rEff / Math.max(self.a, 1e-3), 1.2)));
    // The satellite is the lighter of the pair; the heavier one barely notices.
    const mSat = Math.min(self.M, other.M);
    dynamicalFriction(G_GAL, mSat, rho, Math.max(sigma, 1e-6), lnL, rvx, rvy, rvz, this.tmp);

    const aGrav = Math.hypot(out[0], out[1], out[2]);
    const aFric = Math.hypot(this.tmp[0], this.tmp[1], this.tmp[2]);
    const cap = aGrav * 0.30;
    const scale = aFric > cap && aFric > 0 ? cap / aFric : 1;
    out[0] += this.tmp[0] * scale;
    out[1] += this.tmp[1] * scale;
    out[2] += this.tmp[2] * scale;
  }

  /** One kick-drift-kick leapfrog step over centres and tracers alike. */
  step(dt: number): void {
    const h = dt * 0.5;
    const a0 = new Float64Array(3);
    const a1 = new Float64Array(3);
    this.centreAcc(0, a0);
    this.centreAcc(1, a1);
    const H = this.haloes;
    H[0].vx += a0[0] * h; H[0].vy += a0[1] * h; H[0].vz += a0[2] * h;
    H[1].vx += a1[0] * h; H[1].vy += a1[1] * h; H[1].vz += a1[2] * h;
    for (let i = 0; i < this.count * 3; i++) this.vel[i] += this.acc[i] * h;

    H[0].x += H[0].vx * dt; H[0].y += H[0].vy * dt; H[0].z += H[0].vz * dt;
    H[1].x += H[1].vx * dt; H[1].y += H[1].vy * dt; H[1].z += H[1].vz * dt;
    for (let i = 0; i < this.count * 3; i++) this.pos[i] += this.vel[i] * dt;

    this.computeAccelerations();
    this.centreAcc(0, a0);
    this.centreAcc(1, a1);
    H[0].vx += a0[0] * h; H[0].vy += a0[1] * h; H[0].vz += a0[2] * h;
    H[1].vx += a1[0] * h; H[1].vy += a1[1] * h; H[1].vz += a1[2] * h;
    for (let i = 0; i < this.count * 3; i++) this.vel[i] += this.acc[i] * h;

    this.time += dt;
    const s = this.separation;
    if (s < this.minSeparation) { this.minSeparation = s; this.pericentreTime = this.time; }
  }

  get separation(): number {
    const [a, b] = this.haloes;
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  /**
   * Fraction of tracers now further from both centres than a multiple of the
   * disc radius - a simple stand-in for "material thrown into tails".
   * @param which 0 or 1 to restrict to one galaxy's disc.
   */
  tidalFraction(radiusKpc: number, factor = 1.5, which?: 0 | 1): number {
    let out = 0, total = 0;
    const [a, b] = this.haloes;
    const cut = radiusKpc * factor;
    for (let i = 0; i < this.count; i++) {
      if (which !== undefined && this.owner[i] !== which) continue;
      total++;
      const x = this.pos[i * 3], y = this.pos[i * 3 + 1], z = this.pos[i * 3 + 2];
      const da = Math.hypot(x - a.x, y - a.y, z - a.z);
      const db = Math.hypot(x - b.x, y - b.y, z - b.z);
      if (Math.min(da, db) > cut) out++;
    }
    return total > 0 ? out / total : 0;
  }

  /** Centre of mass of the pair, for keeping the camera on the action. */
  centreOfMass(): [number, number, number] {
    const [a, b] = this.haloes;
    const m = a.M + b.M;
    return [
      (a.M * a.x + b.M * b.x) / m,
      (a.M * a.y + b.M * b.y) / m,
      (a.M * a.z + b.M * b.z) / m,
    ];
  }
}
