/**
 * Two black holes, and the spacetime they are shaking.
 *
 * The holes are drawn where the post-Newtonian inspiral puts them, in units of
 * the total mass's gravitational radius `GM/c²` - 96 km for two thirty-solar-
 * mass holes. The field around them is the leading-order quadrupole waveform
 * evaluated at retarded time:
 *
 *     r·h ∝ τ_ret^(−1/4) · cos(2(φ − Ψ(τ_ret)))     τ_ret = r/c − t
 *
 * which is a two-armed spiral that tightens as the frequency rises, because the
 * arms are the level sets of the orbital phase carried outward at the speed of
 * light. Nothing about the picture is drawn: the number of visible arms comes
 * from the radiation being quadrupolar, the winding comes from the wave taking
 * `r/c` to get there, and the tightening is the chirp.
 *
 * The 1/r falloff is kept, softened only slightly - the field is drawn as
 * `h·(r_ref/r)^0.75` rather than `h·(r_ref/r)` - so the outgoing train does not
 * vanish entirely at the edge of the frame. What is normalised out instead is
 * the overall growth in amplitude through the inspiral, because over a run that
 * climbs by a factor of ten while the wavelength falls by a factor of a
 * hundred, and the second is the thing worth watching. A chirp is a frequency
 * sweep; it stays legible when the strain does not.
 *
 * After coalescence the source stops. The region inside `r = ct` has nothing
 * left to emit and shows only the remnant's ringdown; everything outside it is
 * still carrying the inspiral outward, and the boundary between them expands at
 * exactly the speed of light. Watching that boundary sweep out is watching a
 * retarded solution do what a retarded solution does.
 */

import * as THREE from 'three';
import { C, G, M_SUN } from '../core/constants';
import { PointCloud } from './pointcloud';
import {
  binaryState, chirpMass, finalMass, finalSpin, ringdown, type Binary, type BinaryState,
} from '../physics/gwaves';

const FIELD_VERT = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
in vec3 position;
out vec2 vXZ;
void main() {
  // A RingGeometry is built in the XY plane and rotated into place afterwards,
  // so the plane coordinates are xy here, not xz.
  vXZ = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FIELD_FRAG = /* glsl */ `
precision highp float;
in vec2 vXZ;
out vec4 fragColor;

uniform float uT;          // time relative to coalescence, seconds
uniform float uTauScale;   // 5 G Mc / c^3, seconds
uniform float uSecPerUnit; // light-travel time across one scene unit, seconds
uniform float uRingF;      // ringdown frequency, Hz
uniform float uRingTau;    // ringdown damping time, seconds
uniform float uGain;
uniform float uNorm;      // amplitude at the inner edge now, for auto-exposure
uniform float uRef;        // radius at which the display gain is unity
uniform float uInner;      // hide the field inside this radius, scene units
uniform float uOuter;

/**
 * The wave is a sinusoid, and a sinusoid drawn as colour is a flat poster.
 * Cubing it keeps the zeros, the sign and the peak amplitude exactly where they
 * were and narrows the bands into crests, which is what a wave looks like.
 */
float crest(float c) { return c * abs(c); }

void main() {
  float r = length(vXZ);
  if (r < uInner || r > uOuter) discard;
  float azim = atan(vXZ.y, vXZ.x);

  // Retarded time: what the source was doing when the wave now at r left it.
  float tauRet = r * uSecPerUnit - uT;

  float v;
  if (tauRet > 0.0) {
    // Still inspiralling when this wavefront left. Phase from the closed-form
    // chirp, amplitude from r*h ~ f^(2/3) ~ tau^(-1/4).
    // One log and two exps instead of two pows: this shader covers most of the
    // screen, and pow is the expensive instruction in it.
    float lt = log(tauRet / uTauScale);
    float phi = -2.0 * exp(0.625 * lt);
    v = exp(-0.25 * lt) * crest(cos(2.0 * (azim - phi)));
  } else {
    // Past the merger here: only the remnant's ringing is left, damping away.
    float s = -tauRet;
    v = 2.4 * exp(-s / uRingTau) * crest(cos(6.2831853 * uRingF * s - 2.0 * azim));
  }
  // Auto-exposure. Over the run the amplitude climbs by a factor of ten and
  // the wavelength falls by a hundred; dividing out most of the first leaves
  // the second to carry the drama, which is the right way round - the chirp is
  // a frequency sweep, and it is legible even when the strain is not.
  float q = uRef / max(r, 1.0);
  v *= (uGain / uNorm) * sqrt(q) * sqrt(sqrt(q));   // q^0.75, near enough to 0.8

  // Compression in one direction is stretch in the other, so the sign of the
  // strain is a real distinction and gets its own colour.
  float m = clamp(abs(v), 0.0, 1.0);
  vec3 cold = vec3(0.16, 0.36, 0.92);
  vec3 hot = vec3(1.00, 0.50, 0.20);
  // A steep response, because the tone mapper's toe lifts everything and a
  // linear ramp turns a hundredfold range of amplitude into flat poster paint.
  vec3 col = (v < 0.0 ? cold : hot) * (m * m * m) * 1.7;

  // Fade at both edges so the disc has no rim.
  float edge = smoothstep(uOuter, uOuter * 0.72, r) * smoothstep(uInner, uInner * 2.2, r);
  fragColor = vec4(col * edge, 1.0);
}
`;

const HOLE_VERT = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 modelMatrix;
in vec3 position;
in vec3 normal;
out vec3 vN;
out vec3 vW;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const HOLE_FRAG = /* glsl */ `
precision highp float;
in vec3 vN;
in vec3 vW;
out vec4 fragColor;
uniform vec3 uCam;
uniform float uGlow;

void main() {
  // A horizon is black. What is visible is the ring of light bent around it,
  // and at this scale that reads as a bright rim and nothing else.
  vec3 v = normalize(uCam - vW);
  float f = pow(1.0 - clamp(dot(normalize(vN), v), 0.0, 1.0), 4.0);
  vec3 col = vec3(0.85, 0.72, 1.0) * f * uGlow;
  fragColor = vec4(col, 1.0);
}
`;

export interface MergerOptions {
  /** Component masses, solar. */
  m1: number;
  m2: number;
  /** Separation the inspiral starts from, in units of GM/c². */
  startSeparation?: number;
  /** Radius of the field disc, in units of GM/c². */
  fieldRadius?: number;
}

export class MergerView {
  readonly group = new THREE.Group();
  readonly binary: Binary;
  /** Total mass's gravitational radius, metres. One scene unit. */
  readonly rgM: number;
  /** Seconds from the start of the run to coalescence. */
  readonly inspiralS: number;
  private fieldMat: THREE.RawShaderMaterial;
  private holeMats: THREE.RawShaderMaterial[] = [];
  private holes: THREE.Mesh[] = [];
  private remnant: THREE.Mesh;
  private field: THREE.Mesh;
  private glow!: PointCloud;
  private ring: { freqHz: number; tauS: number };
  private tauScale: number;
  /** State of the binary as of the last update. */
  state!: BinaryState;

  constructor(opts: MergerOptions) {
    const m1 = opts.m1, m2 = opts.m2;
    const M = (m1 + m2) * M_SUN;
    this.rgM = (G * M) / C ** 2;
    this.binary = { m1, m2, distanceMpc: 410 };
    const a0 = (opts.startSeparation ?? 26) * this.rgM;
    const mc = chirpMass(m1 * M_SUN, m2 * M_SUN);
    this.tauScale = 5 * ((G * mc) / C ** 3);
    this.inspiralS = (5 * C ** 5 * a0 ** 4)
      / (256 * G ** 3 * m1 * M_SUN * m2 * M_SUN * M);
    this.ring = ringdown(finalMass(m1, m2) * M_SUN, finalSpin(m1, m2));

    const radius = opts.fieldRadius ?? 300;
    this.fieldMat = new THREE.RawShaderMaterial({
      vertexShader: FIELD_VERT,
      fragmentShader: FIELD_FRAG,
      glslVersion: THREE.GLSL3,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      uniforms: {
        uT: { value: -this.inspiralS },
        uTauScale: { value: this.tauScale },
        uSecPerUnit: { value: this.rgM / C },
        uRingF: { value: this.ring.freqHz },
        uRingTau: { value: this.ring.tauS },
        uGain: { value: 1.0 },
        uNorm: { value: 1 },
        uRef: { value: 40 },
        uInner: { value: 10 },
        uOuter: { value: radius },
      },
    });
    // A ring rather than a disc: nothing inside the ISCO is meaningful, and a
    // fine radial tessellation keeps the innermost fringes from aliasing.
    this.field = new THREE.Mesh(new THREE.RingGeometry(9, radius, 128, 96), this.fieldMat);
    this.field.rotation.x = -Math.PI / 2;
    this.field.frustumCulled = false;
    this.group.add(this.field);

    // The holes. Their horizons are 2Gm/c² each, in units where the *total*
    // mass's GM/c² is one - so the pair fills a good fraction of its own orbit
    // by the time it merges, which is exactly why the inspiral has to end.
    for (const m of [m1, m2]) {
      const r = (2 * m) / (m1 + m2);
      const mat = new THREE.RawShaderMaterial({
        vertexShader: HOLE_VERT,
        fragmentShader: HOLE_FRAG,
        glslVersion: THREE.GLSL3,
        uniforms: {
          uCam: { value: new THREE.Vector3() },
          uGlow: { value: 2.2 },
        },
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 32), mat);
      this.holeMats.push(mat);
      this.holes.push(mesh);
      this.group.add(mesh);
    }

    // A glow on each hole. Two horizons a hundred kilometres across, seen from
    // far enough away to fit several wavelengths in frame, are a couple of
    // pixels; without something to mark them the source of all this is invisible.
    const gcol = new Float32Array([0.80, 0.72, 1.0, 0.80, 0.72, 1.0, 0.86, 0.78, 1.0]);
    const gsty = new Float32Array([1, 0, 1, 0, 1, 0]);
    this.glow = new PointCloud(3, gcol, gsty);
    this.glow.setSize(9);
    this.glow.setCount(2);
    this.group.add(this.glow.points);

    const rf = (2 * finalMass(m1, m2)) / (m1 + m2);
    const rmat = new THREE.RawShaderMaterial({
      vertexShader: HOLE_VERT,
      fragmentShader: HOLE_FRAG,
      glslVersion: THREE.GLSL3,
      uniforms: { uCam: { value: new THREE.Vector3() }, uGlow: { value: 2.6 } },
    });
    this.holeMats.push(rmat);
    this.remnant = new THREE.Mesh(new THREE.SphereGeometry(rf, 48, 32), rmat);
    this.remnant.visible = false;
    this.group.add(this.remnant);
  }

  /**
   * @param t time relative to coalescence, seconds. Negative before the merger.
   */
  update(t: number, camera: THREE.Camera): void {
    const s = binaryState(this.binary, t);
    this.state = s;
    this.fieldMat.uniforms.uT.value = t;

    const cam = camera.getWorldPosition(new THREE.Vector3());
    for (const m of this.holeMats) (m.uniforms.uCam.value as THREE.Vector3).copy(cam);

    const g = this.glow.positions, gs = this.glow.style;
    if (s.separationM > 0) {
      const a = s.separationM / this.rgM;
      const f1 = this.binary.m2 / (this.binary.m1 + this.binary.m2);
      const f2 = this.binary.m1 / (this.binary.m1 + this.binary.m2);
      const c = Math.cos(s.phase), sn = Math.sin(s.phase);
      this.holes[0].position.set(a * f1 * c, 0, a * f1 * sn);
      this.holes[1].position.set(-a * f2 * c, 0, -a * f2 * sn);
      this.holes[0].visible = true;
      this.holes[1].visible = true;
      this.remnant.visible = false;
      for (let i = 0; i < 2; i++) {
        const h = this.holes[i];
        g[i * 3] = h.position.x; g[i * 3 + 1] = 0; g[i * 3 + 2] = h.position.z;
        // Brighter as they close in, because they are moving faster and the
        // near field around them is stronger.
        gs[i * 2] = 0.9 + 1.1 * Math.min(1, 12 / Math.max(a, 1));
        gs[i * 2 + 1] = 0.10 + 0.55 * Math.min(1, 12 / Math.max(a, 1));
      }
      this.glow.setPositions(2);
    } else {
      this.holes[0].visible = false;
      this.holes[1].visible = false;
      this.remnant.visible = true;
      g[0] = 0; g[1] = 0; g[2] = 0;
      gs[0] = 3.0;
      gs[1] = 0.9 * Math.exp(-Math.max(t, 0) / (this.ring.tauS * 3));
      this.glow.setPositions(1);
    }
    this.glow.touchAppearance();

    // Auto-exposure reference: what the amplitude is at the inner edge of the
    // field right now. Raised to less than one so some of the real growth in
    // strain survives the normalisation.
    const inner = this.fieldMat.uniforms.uInner.value as number;
    const tauInner = Math.max(inner * (this.rgM / C) - t, 1e-6);
    const a = Math.pow(tauInner / this.tauScale, -0.25);
    this.fieldMat.uniforms.uNorm.value = Math.pow(Math.max(a, 1e-6), 0.85);
  }

  /** Ringdown frequency and damping time of the remnant. */
  get ringdownMode(): { freqHz: number; tauS: number } { return this.ring; }

  dispose(): void {
    this.glow.dispose();
    this.field.geometry.dispose();
    this.fieldMat.dispose();
    for (const h of [...this.holes, this.remnant]) h.geometry.dispose();
    for (const m of this.holeMats) m.dispose();
  }
}
