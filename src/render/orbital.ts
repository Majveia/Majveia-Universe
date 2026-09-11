/**
 * An atom, drawn as what it is: a probability distribution being sampled.
 *
 * There is no surface here and no ball. Every point is a place the electron
 * might be found, drawn from the square of its wavefunction, and the density
 * of points *is* the density of the electron. That is not a stylistic choice -
 * it is the only honest picture, and it is the one physicists have drawn since
 * the 1930s for exactly that reason.
 *
 * The cloud is re-sampled continuously, a slice of it every frame, so it
 * shimmers. That is also not decoration. An orbital is not an object sitting
 * still being looked at; asking where the electron is gets a different answer
 * each time, and the shimmer is what that looks like.
 *
 * Occupancy follows Hund's rule, which matters for how the thing appears.
 * Carbon's two 2p electrons go into two *different* p orbitals rather than
 * pairing up in one, so carbon's electron cloud is not a sphere - it has lobes
 * pointing in particular directions, and that is where its bonds go. Fill the
 * subshell and the lobes sum to a sphere exactly, by Unsold's theorem, which
 * is why a noble gas is a ball and bonds to nothing.
 */

import * as THREE from 'three';
import { meanRadius, radialDistribution, realHarmonic } from '../physics/atom';

export interface OrbitalSpec {
  n: number;
  l: number;
  /** Which of the 2l+1 real orbitals, from -l to +l. */
  m: number;
  /** Electrons in this one: 1 or 2. */
  occupancy: number;
  zeff: number;
  color: [number, number, number];
  label: string;
}

export interface OrbitalCloudOptions {
  orbitals: OrbitalSpec[];
  /** Total points to draw. */
  points: number;
  /** Scene units per metre. */
  scale: number;
  /**
   * Applied to every radius, so the drawn atom is the size the atom is.
   *
   * The hydrogenic model with Slater screening gets the second row within a
   * few percent and overestimates a 4s orbital by a factor of two and a half.
   * Scaling by one number keeps every relative feature - node positions, shell
   * spacings, the shapes of the lobes - and puts the outside where it belongs.
   */
  calibration: number;
  seed?: number;
}

const POINT_VERT = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uSize;
uniform float uFade;
in vec3 position;
in vec3 aColor;
in float aAge;      // 0 just placed, 1 about to be replaced
out vec3 vColor;
out float vAlpha;
void main() {
  vec4 cv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * cv;
  // Constant on screen, because in a dot-density plot it is the number of
  // dots that carries the meaning and not their size.
  gl_PointSize = uSize;
  vColor = aColor;
  // Points fade in and out over their short lives, so the cloud breathes
  // instead of flickering as samples are swapped.
  vAlpha = uFade * sin(aAge * 3.14159265);
}
`;

const POINT_FRAG = /* glsl */ `
precision highp float;
in vec3 vColor;
in float vAlpha;
out vec4 fragColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  fragColor = vec4(vColor * vAlpha * (1.0 - r2) * (1.0 - r2), 1.0);
}
`;

/**
 * Draws radii from r^2|R(r)|^2 by inverting its cumulative distribution.
 *
 * The radial distribution rather than |R|^2 itself: |R|^2 for a 1s orbital is
 * largest at the nucleus, but the electron is most likely to be found at the
 * Bohr radius, because a shell at that radius has more room in it. Every
 * picture of an atom that has a hole in the middle is wrong for that reason.
 */
class RadialSampler {
  private rs: Float64Array;
  private cdf: Float64Array;

  constructor(n: number, l: number, zeff: number, bins = 1024) {
    const far = 5.5 * meanRadius(n, l, zeff);
    this.rs = new Float64Array(bins + 1);
    this.cdf = new Float64Array(bins + 1);
    let acc = 0;
    for (let i = 0; i <= bins; i++) {
      const r = (i / bins) * far;
      this.rs[i] = r;
      if (i > 0) {
        const a = radialDistribution(n, l, zeff, this.rs[i - 1]);
        const b = radialDistribution(n, l, zeff, r);
        acc += ((a + b) / 2) * (r - this.rs[i - 1]);
      }
      this.cdf[i] = acc;
    }
    if (acc > 0) for (let i = 0; i <= bins; i++) this.cdf[i] /= acc;
  }

  sample(u: number): number {
    const c = this.cdf;
    let lo = 0, hi = c.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid] < u) lo = mid; else hi = mid;
    }
    const span = c[hi] - c[lo];
    const t = span > 0 ? (u - c[lo]) / span : 0;
    return this.rs[lo] + t * (this.rs[hi] - this.rs[lo]);
  }
}

interface Prepared {
  spec: OrbitalSpec;
  radial: RadialSampler;
  yMax2: number;
  weight: number;
}

export class OrbitalCloud {
  readonly group = new THREE.Group();
  private geo: THREE.BufferGeometry;
  private mat: THREE.RawShaderMaterial;
  private pos: Float32Array;
  private col: Float32Array;
  private age: Float32Array;
  private prepared: Prepared[];
  private active: Prepared[];
  private cursor = 0;
  private rngState: number;
  private o: OrbitalCloudOptions;

  constructor(o: OrbitalCloudOptions) {
    this.o = o;
    this.rngState = (o.seed ?? 1) >>> 0 || 1;
    this.prepared = o.orbitals.map((spec) => ({
      spec,
      radial: new RadialSampler(spec.n, spec.l, spec.zeff),
      yMax2: maxHarmonic2(spec.l, spec.m),
      // Points in proportion to electrons, because that is what density means.
      weight: spec.occupancy,
    }));
    this.active = this.prepared;

    const n = o.points;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.age = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.place(i);
      this.age[i] = this.rnd();
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('aAge', new THREE.BufferAttribute(this.age, 1));
    for (const k of ['position', 'aColor', 'aAge']) {
      (this.geo.getAttribute(k) as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    }
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mat = new THREE.RawShaderMaterial({
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      glslVersion: THREE.GLSL3,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      uniforms: { uSize: { value: 2.7 }, uFade: { value: 0.5 } },
    });
    const pts = new THREE.Points(this.geo, this.mat);
    pts.frustumCulled = false;
    this.group.add(pts);
  }

  private rnd(): number {
    let s = this.rngState;
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    this.rngState = s;
    return s / 4294967296;
  }

  /** Draw one point from the density and write it into slot i. */
  private place(i: number): void {
    let total = 0;
    for (const p of this.active) total += p.weight;
    let pick = this.rnd() * total;
    let chosen = this.active[0];
    for (const p of this.active) {
      pick -= p.weight;
      if (pick <= 0) { chosen = p; break; }
    }
    const r = chosen.radial.sample(this.rnd()) * this.o.calibration * this.o.scale;
    // Rejection against the angular part: a uniform direction, kept with
    // probability |Y|^2 over its maximum. For an s orbital everything is kept;
    // for a d, about a fifth is, which is cheap enough.
    let x = 0, y = 0, z = 1;
    for (let tries = 0; tries < 64; tries++) {
      const u = 2 * this.rnd() - 1;
      const ph = this.rnd() * 2 * Math.PI;
      const s = Math.sqrt(Math.max(0, 1 - u * u));
      x = s * Math.cos(ph); y = s * Math.sin(ph); z = u;
      const yv = realHarmonic(chosen.spec.l, chosen.spec.m, x, y, z);
      if (this.rnd() * chosen.yMax2 <= yv * yv) break;
    }
    this.pos[i * 3] = x * r;
    this.pos[i * 3 + 1] = y * r;
    this.pos[i * 3 + 2] = z * r;
    this.col.set(chosen.spec.color, i * 3);
  }

  /**
   * Replace a slice of the cloud and age the rest.
   *
   * Nothing moves: points are retired and new ones drawn. An electron does not
   * have a trajectory to animate, and pretending it does would be the one
   * thing about this picture that was a lie.
   */
  update(dt: number, refreshPerSecond = 0.55): void {
    const n = this.age.length;
    const step = dt * refreshPerSecond;
    for (let i = 0; i < n; i++) this.age[i] += step;
    const replace = Math.min(n, Math.max(1, Math.round(n * step)));
    for (let k = 0; k < replace; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % n;
      if (this.age[i] < 1) continue;
      this.place(i);
      this.age[i] = 0;
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aAge') as THREE.BufferAttribute).needsUpdate = true;
  }

  /**
   * Show one orbital on its own, with every point spent on it.
   *
   * Isolating 2p is how you see that it is two lobes with a plane of nothing
   * between them, which is invisible in the total density because the other
   * two p orbitals fill that plane in.
   */
  setOnly(index: number): void {
    this.active = index < 0 || index >= this.prepared.length
      ? this.prepared : [this.prepared[index]];
    for (let i = 0; i < this.age.length; i++) {
      this.place(i);
      this.age[i] = this.rnd();
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aAge') as THREE.BufferAttribute).needsUpdate = true;
  }

  setBrightness(v: number): void { this.mat.uniforms.uFade.value = v; }
  setPointSize(px: number): void { this.mat.uniforms.uSize.value = px; }

  dispose(): void { this.geo.dispose(); this.mat.dispose(); }
}

/** The largest |Y|^2 an orbital reaches, found once over an even sphere. */
function maxHarmonic2(l: number, m: number): number {
  if (l === 0) return 1 / (4 * Math.PI);
  let best = 0;
  const N = 2048, GOLDEN = Math.PI * (3 - Math.sqrt(5));
  for (let k = 0; k < N; k++) {
    const z = 1 - (2 * (k + 0.5)) / N;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const ph = k * GOLDEN;
    const v = realHarmonic(l, m, r * Math.cos(ph), r * Math.sin(ph), z);
    best = Math.max(best, v * v);
  }
  return best * 1.001;
}

/**
 * Which of the 2l+1 orbitals in a subshell the electrons actually sit in.
 *
 * Hund's rule: one electron into each orbital before any of them takes a
 * second, because two electrons in the same orbital have to be near each other
 * and repel. It is why carbon has two half-filled p orbitals pointing in
 * different directions rather than one full one, and therefore why carbon
 * builds structures instead of sitting there.
 */
export function hundOccupancy(l: number, count: number): number[] {
  const slots = 2 * l + 1;
  const out = new Array<number>(slots).fill(0);
  let left = Math.min(count, 2 * slots);
  for (let pass = 0; pass < 2 && left > 0; pass++) {
    for (let i = 0; i < slots && left > 0; i++) { out[i]++; left--; }
  }
  return out;
}
