/**
 * Gravitational N-body dynamics.
 *
 * Everything elsewhere in this simulation is analytic: Kepler orbits that never
 * drift, Zel'dovich displacements that are exact until shell crossing, spiral
 * arms that are a standing wave by construction. This file is the opposite. It
 * integrates the actual equations of motion, and things that could not happen
 * analytically - tidal tails, mergers, ejections, a cluster finding its own
 * virial equilibrium - happen here because nobody told them not to.
 *
 * Forces come from a Barnes-Hut octree: the tree is rebuilt every step, and a
 * node is used as a single point mass when its angular size s/d is below the
 * opening angle theta. That turns an O(N^2) sum into O(N log N) and is what
 * makes tens of thousands of interacting bodies possible in a browser tab.
 *
 * Integration is kick-drift-kick leapfrog, which is symplectic: it does not
 * conserve energy exactly, but its error oscillates instead of accumulating, so
 * an orbit integrated for a million steps is still an orbit rather than a
 * spiral into or out of the centre. Yoshida's fourth-order composition is
 * available for when accuracy matters more than speed.
 */

/** Gravitational constant in simulation units: kpc, Myr, 10^9 solar masses. */
export const G_GAL = 4.498502e-3;
/** Gravitational constant in AU, years, solar masses. */
export const G_AU = 39.4769264;

export interface NBodyOptions {
  /** Maximum number of bodies the buffers are sized for. */
  capacity: number;
  /** Gravitational constant in whatever unit system the caller is using. */
  G?: number;
  /** Plummer softening length: below this, gravity stops diverging. */
  softening?: number;
  /** Barnes-Hut opening angle. 0 is exact and slow; 0.5-0.7 is standard. */
  theta?: number;
}

/**
 * A flat-array octree.
 *
 * Nodes are stored in parallel typed arrays rather than as objects, because
 * building a tree of a hundred thousand objects every frame would spend more
 * time in the allocator than in physics.
 */
class Octree {
  private cap: number;
  /** Index of the first child of node i; children are contiguous. -1 for leaves. */
  child: Int32Array;
  /** Body index for a leaf holding exactly one body, else -1. */
  body: Int32Array;
  mass: Float64Array;
  comX: Float64Array;
  comY: Float64Array;
  comZ: Float64Array;
  cx: Float64Array;
  cy: Float64Array;
  cz: Float64Array;
  half: Float64Array;
  count = 0;

  constructor(cap: number) {
    this.cap = cap;
    this.child = new Int32Array(cap);
    this.body = new Int32Array(cap);
    this.mass = new Float64Array(cap);
    this.comX = new Float64Array(cap);
    this.comY = new Float64Array(cap);
    this.comZ = new Float64Array(cap);
    this.cx = new Float64Array(cap);
    this.cy = new Float64Array(cap);
    this.cz = new Float64Array(cap);
    this.half = new Float64Array(cap);
  }

  private grow(): void {
    const cap = this.cap * 2;
    const copy = <T extends Int32Array | Float64Array>(a: T, C: new (n: number) => T): T => {
      const b = new C(cap);
      b.set(a as never);
      return b;
    };
    this.child = copy(this.child, Int32Array);
    this.body = copy(this.body, Int32Array);
    this.mass = copy(this.mass, Float64Array);
    this.comX = copy(this.comX, Float64Array);
    this.comY = copy(this.comY, Float64Array);
    this.comZ = copy(this.comZ, Float64Array);
    this.cx = copy(this.cx, Float64Array);
    this.cy = copy(this.cy, Float64Array);
    this.cz = copy(this.cz, Float64Array);
    this.half = copy(this.half, Float64Array);
    this.cap = cap;
  }

  private alloc(cx: number, cy: number, cz: number, half: number): number {
    if (this.count + 8 >= this.cap) this.grow();
    const i = this.count++;
    this.child[i] = -1;
    this.body[i] = -1;
    this.mass[i] = 0;
    this.comX[i] = 0; this.comY[i] = 0; this.comZ[i] = 0;
    this.cx[i] = cx; this.cy[i] = cy; this.cz[i] = cz;
    this.half[i] = half;
    return i;
  }

  /** Build the tree over the first `n` bodies, including centres of mass. */
  build(n: number, pos: Float64Array, mass: Float64Array, active: Uint8Array | null): number {
    this.count = 0;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      if (active && !active[i]) continue;
      if (mass[i] === 0) continue;
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      if (!Number.isFinite(x + y + z)) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    if (!Number.isFinite(minX)) return -1;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    const half = Math.max(maxX - minX, maxY - minY, maxZ - minZ) * 0.5 + 1e-9;
    const root = this.alloc(cx, cy, cz, half);

    for (let i = 0; i < n; i++) {
      if (active && !active[i]) continue;
      if (mass[i] === 0) continue;
      if (!Number.isFinite(pos[i * 3] + pos[i * 3 + 1] + pos[i * 3 + 2])) continue;
      this.insert(root, i, pos);
    }
    this.seedLeaves(pos, mass);
    this.accumulate();
    return root;
  }

  private octant(node: number, x: number, y: number, z: number): number {
    return (x > this.cx[node] ? 1 : 0) | (y > this.cy[node] ? 2 : 0) | (z > this.cz[node] ? 4 : 0);
  }

  private subdivide(node: number): void {
    const h = this.half[node] * 0.5;
    const base = this.count;
    for (let o = 0; o < 8; o++) {
      this.alloc(
        this.cx[node] + (o & 1 ? h : -h),
        this.cy[node] + (o & 2 ? h : -h),
        this.cz[node] + (o & 4 ? h : -h),
        h);
    }
    this.child[node] = base;
  }

  /**
   * Standard octree insertion. An occupied leaf subdivides and pushes its
   * occupant down; if the newcomer lands in the same octant the loop simply
   * repeats one level deeper. The depth guard exists because two bodies at
   * numerically identical positions would otherwise subdivide forever.
   */
  private insert(root: number, b: number, pos: Float64Array): void {
    const x = pos[b * 3], y = pos[b * 3 + 1], z = pos[b * 3 + 2];
    let node = root;
    for (let depth = 0; depth < 64; depth++) {
      if (this.child[node] === -1) {
        if (this.body[node] === -1) { this.body[node] = b; return; }
        const other = this.body[node];
        this.body[node] = -1;
        this.subdivide(node);
        this.body[this.child[node] + this.octant(node, pos[other * 3], pos[other * 3 + 1], pos[other * 3 + 2])] = other;
      }
      node = this.child[node] + this.octant(node, x, y, z);
    }
    // Coincident points: give up subdividing and let the leaf hold one of them.
    this.body[node] = b;
  }

  /** Copy each single-body leaf's mass and position into the node. */
  private seedLeaves(pos: Float64Array, mass: Float64Array): void {
    for (let i = 0; i < this.count; i++) {
      const b = this.body[i];
      if (b < 0) continue;
      this.mass[i] = mass[b];
      this.comX[i] = pos[b * 3];
      this.comY[i] = pos[b * 3 + 1];
      this.comZ[i] = pos[b * 3 + 2];
    }
  }

  /**
   * Roll masses and centres of mass up the tree. A child is always allocated
   * after its parent, so walking the node array backwards is a valid
   * post-order traversal - and needs no recursion and no stack.
   */
  private accumulate(): void {
    for (let i = this.count - 1; i >= 0; i--) {
      if (this.child[i] === -1) continue;
      let m = 0, x = 0, y = 0, z = 0;
      for (let o = 0; o < 8; o++) {
        const c = this.child[i] + o;
        const cm = this.mass[c];
        if (cm === 0) continue;
        m += cm; x += this.comX[c] * cm; y += this.comY[c] * cm; z += this.comZ[c] * cm;
      }
      this.mass[i] = m;
      if (m > 0) { this.comX[i] = x / m; this.comY[i] = y / m; this.comZ[i] = z / m; }
    }
  }
}

export interface Diagnostics {
  kinetic: number;
  potential: number;
  total: number;
  /** 2T/|U|; unity for a system in virial equilibrium. */
  virial: number;
  angularMomentum: [number, number, number];
  centreOfMass: [number, number, number];
}

export class NBody {
  readonly pos: Float64Array;
  readonly vel: Float64Array;
  readonly acc: Float64Array;
  readonly mass: Float64Array;
  /** Zero marks a body as removed (merged or ejected). */
  readonly active: Uint8Array;
  n = 0;
  time = 0;
  G: number;
  softening: number;
  theta: number;
  /** Optional external acceleration, e.g. a static dark-matter halo. */
  external?: (x: number, y: number, z: number, out: Float64Array) => void;

  private tree: Octree;
  private root = -1;
  private ext = new Float64Array(3);
  /** Node walk stack, preallocated. */
  private stack: Int32Array;

  constructor(opts: NBodyOptions) {
    const cap = opts.capacity;
    this.pos = new Float64Array(cap * 3);
    this.vel = new Float64Array(cap * 3);
    this.acc = new Float64Array(cap * 3);
    this.mass = new Float64Array(cap);
    this.active = new Uint8Array(cap);
    this.G = opts.G ?? 1;
    this.softening = opts.softening ?? 1e-3;
    this.theta = opts.theta ?? 0.6;
    this.tree = new Octree(Math.max(64, cap * 4));
    this.stack = new Int32Array(4096);
  }

  add(x: number, y: number, z: number, vx: number, vy: number, vz: number, m: number): number {
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.mass[i] = m;
    this.active[i] = 1;
    return i;
  }

  remove(i: number): void { this.active[i] = 0; this.mass[i] = 0; }

  /** Rebuild the tree and recompute every acceleration. */
  computeAccelerations(): void {
    this.root = this.tree.build(this.n, this.pos, this.mass, this.active);
    const eps2 = this.softening * this.softening;
    const theta2 = this.theta * this.theta;
    for (let i = 0; i < this.n; i++) {
      if (!this.active[i]) { this.acc[i * 3] = this.acc[i * 3 + 1] = this.acc[i * 3 + 2] = 0; continue; }
      let ax = 0, ay = 0, az = 0;
      const px = this.pos[i * 3], py = this.pos[i * 3 + 1], pz = this.pos[i * 3 + 2];
      if (this.root >= 0) {
        let sp = 0;
        this.stack[0] = this.root;
        while (sp >= 0) {
          const node = this.stack[sp--];
          const m = this.tree.mass[node];
          if (m === 0) continue;
          const dx = this.tree.comX[node] - px;
          const dy = this.tree.comY[node] - py;
          const dz = this.tree.comZ[node] - pz;
          const d2 = dx * dx + dy * dy + dz * dz;
          const s = this.tree.half[node] * 2;
          if (this.tree.child[node] === -1 || s * s < theta2 * d2) {
            // Self-interaction contributes nothing and would divide by zero.
            if (d2 < 1e-24) continue;
            const inv = 1 / Math.sqrt(d2 + eps2);
            const f = this.G * m * inv * inv * inv;
            ax += f * dx; ay += f * dy; az += f * dz;
          } else {
            if (sp + 8 >= this.stack.length) {
              const bigger = new Int32Array(this.stack.length * 2);
              bigger.set(this.stack);
              this.stack = bigger;
            }
            for (let o = 0; o < 8; o++) this.stack[++sp] = this.tree.child[node] + o;
          }
        }
      }
      if (this.external) {
        this.external(px, py, pz, this.ext);
        ax += this.ext[0]; ay += this.ext[1]; az += this.ext[2];
      }
      this.acc[i * 3] = ax; this.acc[i * 3 + 1] = ay; this.acc[i * 3 + 2] = az;
    }
  }

  /**
   * One kick-drift-kick leapfrog step.
   * Symplectic: the energy error oscillates with the orbital phase instead of
   * accumulating, which is why an orbit integrated for a million steps is still
   * an orbit and not a slow spiral.
   */
  step(dt: number): void {
    const h = dt * 0.5;
    for (let i = 0; i < this.n; i++) {
      if (!this.active[i]) continue;
      this.vel[i * 3] += this.acc[i * 3] * h;
      this.vel[i * 3 + 1] += this.acc[i * 3 + 1] * h;
      this.vel[i * 3 + 2] += this.acc[i * 3 + 2] * h;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.computeAccelerations();
    for (let i = 0; i < this.n; i++) {
      if (!this.active[i]) continue;
      this.vel[i * 3] += this.acc[i * 3] * h;
      this.vel[i * 3 + 1] += this.acc[i * 3 + 1] * h;
      this.vel[i * 3 + 2] += this.acc[i * 3 + 2] * h;
    }
    this.time += dt;
  }

  /**
   * Yoshida's fourth-order symplectic composition: three leapfrog steps with
   * one long backward step in the middle. Four times the cost of leapfrog for
   * roughly two orders of magnitude less error.
   */
  step4(dt: number): void {
    const c = Math.cbrt(2);
    const w1 = 1 / (2 - c);
    const w0 = -c * w1;
    this.step(w1 * dt);
    this.step(w0 * dt);
    this.step(w1 * dt);
  }

  /** Exact O(N^2) accelerations, for verifying the tree. */
  computeAccelerationsDirect(): void {
    const eps2 = this.softening * this.softening;
    for (let i = 0; i < this.n; i++) {
      let ax = 0, ay = 0, az = 0;
      if (this.active[i]) {
        for (let j = 0; j < this.n; j++) {
          if (i === j || !this.active[j] || this.mass[j] === 0) continue;
          const dx = this.pos[j * 3] - this.pos[i * 3];
          const dy = this.pos[j * 3 + 1] - this.pos[i * 3 + 1];
          const dz = this.pos[j * 3 + 2] - this.pos[i * 3 + 2];
          const inv = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz + eps2);
          const f = this.G * this.mass[j] * inv * inv * inv;
          ax += f * dx; ay += f * dy; az += f * dz;
        }
        if (this.external) {
          this.external(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2], this.ext);
          ax += this.ext[0]; ay += this.ext[1]; az += this.ext[2];
        }
      }
      this.acc[i * 3] = ax; this.acc[i * 3 + 1] = ay; this.acc[i * 3 + 2] = az;
    }
  }

  diagnostics(): Diagnostics {
    let T = 0, U = 0, mTot = 0;
    let lx = 0, ly = 0, lz = 0, cx = 0, cy = 0, cz = 0;
    const eps2 = this.softening * this.softening;
    for (let i = 0; i < this.n; i++) {
      if (!this.active[i]) continue;
      const m = this.mass[i];
      const vx = this.vel[i * 3], vy = this.vel[i * 3 + 1], vz = this.vel[i * 3 + 2];
      const x = this.pos[i * 3], y = this.pos[i * 3 + 1], z = this.pos[i * 3 + 2];
      T += 0.5 * m * (vx * vx + vy * vy + vz * vz);
      lx += m * (y * vz - z * vy);
      ly += m * (z * vx - x * vz);
      lz += m * (x * vy - y * vx);
      cx += m * x; cy += m * y; cz += m * z; mTot += m;
      for (let j = i + 1; j < this.n; j++) {
        if (!this.active[j]) continue;
        const dx = this.pos[j * 3] - x;
        const dy = this.pos[j * 3 + 1] - y;
        const dz = this.pos[j * 3 + 2] - z;
        U -= (this.G * m * this.mass[j]) / Math.sqrt(dx * dx + dy * dy + dz * dz + eps2);
      }
    }
    return {
      kinetic: T,
      potential: U,
      total: T + U,
      virial: U !== 0 ? (2 * T) / Math.abs(U) : NaN,
      angularMomentum: [lx, ly, lz],
      centreOfMass: mTot > 0 ? [cx / mTot, cy / mTot, cz / mTot] : [0, 0, 0],
    };
  }
}

/**
 * NFW halo acceleration, the density profile that dissipationless collapse
 * produces in every cosmological simulation ever run:
 *
 *   rho(r) = rho_s / [ (r/rs) (1 + r/rs)^2 ]
 *
 * The enclosed mass has a closed form, so the acceleration does too. This is
 * what holds a galaxy's rotation curve flat and what keeps a cluster's
 * galaxies bound when their own mass could not.
 */
export function nfwAcceleration(
  G: number, Mvir: number, rvir: number, concentration: number,
): (x: number, y: number, z: number, out: Float64Array) => void {
  const rs = rvir / concentration;
  const mu = Math.log(1 + concentration) - concentration / (1 + concentration);
  const rhoNorm = Mvir / mu;
  return (x, y, z, out) => {
    const r = Math.sqrt(x * x + y * y + z * z) + 1e-9;
    const u = r / rs;
    const menc = rhoNorm * (Math.log(1 + u) - u / (1 + u));
    const a = (-G * menc) / (r * r * r);
    out[0] = a * x; out[1] = a * y; out[2] = a * z;
  };
}

/**
 * Chandrasekhar dynamical friction: a massive body ploughing through a sea of
 * lighter ones leaves an overdense wake behind it, and the wake pulls back.
 * It is what sinks satellite galaxies into cluster centres and what makes
 * mergers finish instead of orbiting forever.
 */
export function dynamicalFriction(
  G: number, mSat: number, rho: number, sigma: number, coulombLog: number,
  vx: number, vy: number, vz: number, out: Float64Array,
): void {
  const v = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (v < 1e-12 || rho <= 0) { out[0] = out[1] = out[2] = 0; return; }
  const X = v / (Math.SQRT2 * sigma);
  // erf(X) - 2X exp(-X^2)/sqrt(pi): the fraction of the field moving slower
  // than the satellite, which is the only part that can drag on it.
  const erf = erfApprox(X);
  const bracket = erf - (2 * X * Math.exp(-X * X)) / Math.sqrt(Math.PI);
  const a = (-4 * Math.PI * coulombLog * G * G * mSat * rho * bracket) / (v * v * v);
  out[0] = a * vx; out[1] = a * vy; out[2] = a * vz;
}

/** Abramowitz & Stegun 7.1.26, |error| < 1.5e-7. */
export function erfApprox(x: number): number {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t
    + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

/**
 * A Plummer sphere: the simplest self-consistent equilibrium star cluster.
 * Positions from the analytic inverse of its enclosed-mass profile, speeds
 * rejection-sampled from its distribution function, so the model starts in
 * virial equilibrium rather than settling into one.
 */
export function plummerSphere(
  nb: NBody, count: number, totalMass: number, scaleRadius: number,
  rand: () => number,
): void {
  const m = totalMass / count;
  for (let i = 0; i < count; i++) {
    const u = rand();
    const r = scaleRadius / Math.sqrt(Math.pow(u, -2 / 3) - 1);
    const cz = 1 - 2 * rand();
    const phi = 2 * Math.PI * rand();
    const sr = Math.sqrt(1 - cz * cz);
    const x = r * sr * Math.cos(phi), y = r * sr * Math.sin(phi), z = r * cz;

    // von Neumann rejection on g(q) = q^2 (1-q^2)^{7/2}, the Plummer speed
    // distribution; its maximum is at q = 1/3.
    let q = 0;
    for (let k = 0; k < 200; k++) {
      const q1 = rand();
      const g = q1 * q1 * Math.pow(1 - q1 * q1, 3.5);
      if (0.1 * rand() < g) { q = q1; break; }
    }
    const ve = Math.sqrt(2) * Math.pow(1 + (r * r) / (scaleRadius * scaleRadius), -0.25)
      * Math.sqrt((nb.G * totalMass) / scaleRadius);
    const v = q * ve;
    const vcz = 1 - 2 * rand();
    const vphi = 2 * Math.PI * rand();
    const vsr = Math.sqrt(1 - vcz * vcz);
    nb.add(x, y, z, v * vsr * Math.cos(vphi), v * vsr * Math.sin(vphi), v * vcz, m);
  }
}
