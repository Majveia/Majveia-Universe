/**
 * A nucleus, as a churning drop.
 *
 * Nucleons are drawn as spheres because at this scale that is nearly fair -
 * a proton has a measured charge radius of 0.84 femtometres and the drop is a
 * few of those across, so unlike the atom above it, this really is a packing
 * problem. They are drawn as impostors: one quad each, with the sphere solved
 * for in the fragment shader and its own depth written, so they intersect one
 * another correctly and stay round at any magnification.
 *
 * They move, and the reason they move is the best fact in nuclear physics.
 * Nucleons are fermions, so no two can occupy the same state, so they cannot
 * all settle into the lowest one - they are forced up a ladder of momenta
 * whether there is any heat about or not. The top rung comes to about
 * thirty-five million electronvolts, which is a quarter of the speed of light.
 * A nucleus at absolute zero is boiling, and nothing is stirring it.
 *
 * Each one is put on a circular orbit in the mean field at a radius drawn from
 * the Woods-Saxon profile, with a random plane and phase. That is exactly
 * stationary - the distribution the ensemble samples is the same at every
 * instant, which is what a stationary state means - and it is the shell
 * model's own picture: a nucleon orbiting in the average field of all the
 * others rather than colliding with them, which it does not, because every
 * state it could scatter into is already occupied.
 */

import * as THREE from 'three';

export interface NucleonSeed {
  /** Orbit radius, femtometres. */
  radius: number;
  proton: boolean;
}

export interface NucleonViewOptions {
  nucleons: NucleonSeed[];
  /** Drawing radius of one nucleon, femtometres. */
  size: number;
  /** Orbital angular frequency in the mean field, rad/s. */
  omega: number;
  /** Half-density radius, femtometres - for the fog and the surface glow. */
  dropRadius: number;
  seed?: number;
}

const VERT = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
in vec3 position;
in vec3 aPos;
in float aRad;
in vec3 aColor;
out vec2 vUv;
out vec3 vColor;
out vec3 vCentre;
out float vRad;
void main() {
  vUv = position.xy;
  vColor = aColor;
  vRad = aRad;
  vec4 cv = modelViewMatrix * vec4(aPos, 1.0);
  vCentre = cv.xyz;
  cv.xy += position.xy * aRad * 1.06;
  gl_Position = projectionMatrix * cv;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform mat4 projectionMatrix;
uniform float uFog;
in vec2 vUv;
in vec3 vColor;
in vec3 vCentre;
in float vRad;
out vec4 fragColor;
void main() {
  vec2 p = vUv * 1.06;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  vec3 n = vec3(p, sqrt(1.0 - r2));
  vec3 view = vCentre + n * vRad;
  vec4 clip = projectionMatrix * vec4(view, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);

  vec3 L = normalize(vec3(0.38, 0.64, 0.66));
  vec3 V = normalize(-view);
  float diff = max(0.0, dot(n, L));
  float spec = pow(max(0.0, dot(reflect(-L, n), V)), 30.0);
  float rim = pow(1.0 - max(0.0, n.z), 3.0);
  vec3 col = vColor * (0.10 + 0.92 * diff) + vec3(0.9, 0.93, 1.0) * spec * 0.30
    + vColor * rim * 0.30;
  float f = exp(-max(0.0, -view.z) * uFog);
  fragColor = vec4(col * f, 1.0);
}
`;

const PROTON: [number, number, number] = [0.92, 0.34, 0.22];
const NEUTRON: [number, number, number] = [0.52, 0.60, 0.70];

export class NucleonView {
  readonly group = new THREE.Group();
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.RawShaderMaterial;
  private live: Float32Array;
  /** Two orthogonal vectors per nucleon: the plane its orbit lies in. */
  private ua: Float32Array;
  private ub: Float32Array;
  private omega: Float32Array;
  private phase: Float32Array;
  private n: number;

  constructor(o: NucleonViewOptions) {
    this.n = o.nucleons.length;
    const n = this.n;
    this.live = new Float32Array(n * 3);
    this.ua = new Float32Array(n * 3);
    this.ub = new Float32Array(n * 3);
    this.omega = new Float32Array(n);
    this.phase = new Float32Array(n);
    const rad = new Float32Array(n);
    const col = new Float32Array(n * 3);

    let s = (o.seed ?? 1) >>> 0 || 1;
    const rnd = (): number => {
      s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };

    for (let i = 0; i < n; i++) {
      const seed = o.nucleons[i];
      // A random orbital plane: one direction on the sphere, and a second at
      // right angles to it. Both scaled to the orbit's radius, so the motion
      // is a circle and the radius never changes - which is what makes the
      // ensemble stationary rather than sloshing.
      const u = 2 * rnd() - 1, ph = rnd() * 2 * Math.PI;
      const sn = Math.sqrt(Math.max(0, 1 - u * u));
      const a: [number, number, number] = [sn * Math.cos(ph), sn * Math.sin(ph), u];
      let bx = rnd() - 0.5, by = rnd() - 0.5, bz = rnd() - 0.5;
      const d = bx * a[0] + by * a[1] + bz * a[2];
      bx -= d * a[0]; by -= d * a[1]; bz -= d * a[2];
      const bl = Math.hypot(bx, by, bz) || 1;
      const r = seed.radius;
      this.ua.set([a[0] * r, a[1] * r, a[2] * r], i * 3);
      this.ub.set([(bx / bl) * r, (by / bl) * r, (bz / bl) * r], i * 3);
      // The well is flatter in the middle than a harmonic one, so the wide
      // orbits go round more slowly than the tight ones.
      this.omega[i] = o.omega * (1 - 0.35 * (r / Math.max(1e-6, o.dropRadius)));
      this.phase[i] = rnd() * 2 * Math.PI;
      rad[i] = o.size;
      col.set(seed.proton ? PROTON : NEUTRON, i * 3);
    }

    const quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0,
    ]), 3));
    const pos = new THREE.InstancedBufferAttribute(this.live, 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    quad.setAttribute('aPos', pos);
    quad.setAttribute('aRad', new THREE.InstancedBufferAttribute(rad, 1));
    quad.setAttribute('aColor', new THREE.InstancedBufferAttribute(col, 3));
    quad.instanceCount = n;
    this.geo = quad;
    this.mat = new THREE.RawShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      glslVersion: THREE.GLSL3,
      side: THREE.DoubleSide,
      uniforms: { uFog: { value: 1 / Math.max(1, o.dropRadius * 6) } },
    });
    const mesh = new THREE.Mesh(quad, this.mat);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.setTime(0);
  }

  setTime(t: number): void {
    for (let i = 0; i < this.n; i++) {
      const a = Math.cos(this.omega[i] * t + this.phase[i]);
      const b = Math.sin(this.omega[i] * t + this.phase[i]);
      for (let k = 0; k < 3; k++) {
        this.live[i * 3 + k] = this.ua[i * 3 + k] * a + this.ub[i * 3 + k] * b;
      }
    }
    (this.geo.getAttribute('aPos') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void { this.geo.dispose(); this.mat.dispose(); }
}
