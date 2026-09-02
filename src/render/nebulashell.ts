/**
 * The planetary nebula, rendered as what it is: a hollow, expanding, ionised
 * shell lit from inside by a naked stellar core.
 *
 * Nothing here draws a ring. The shader marches a ray through a spherical
 * density field and integrates n² along it, and the ring falls out of the
 * geometry, because a sightline that grazes the shell's inner cavity runs
 * through several times as much gas as one aimed at the middle. Change the
 * shell's thickness and the ring sharpens or blurs on its own; that is the
 * whole of `shellChord` in `astro/planetarynebula`, done numerically so the
 * structure can be inhomogeneous.
 *
 * What is added on top of the plain shell is the structure real ones have, and
 * every piece of it has a cause:
 *
 *  - **A waist.** Most planetary nebulae are not round. The AGB wind leaves a
 *    dense equatorial torus - shaped by a binary companion, or by rotation -
 *    and when the fast wind from the exposed core switches on it cannot get
 *    through the waist, so it breaks out at the poles instead. The result is
 *    the bipolar and elliptical shapes that dominate the catalogues; a genuinely
 *    round one, like Abell 39, is the rarity.
 *  - **Knots.** The ionisation front is unstable: dense clumps shadow the gas
 *    behind them and survive while the smooth gas around them is swept away, so
 *    the shell breaks into thousands of cometary globules with tails pointing
 *    away from the star. The Helix has about forty thousand of them and each
 *    one is roughly the size of the Solar System.
 *  - **A halo.** Outside the bright shell is a much fainter round one: the slow
 *    wind the star blew for a hundred thousand years before the end, ionised
 *    but never swept up. It is the star's earlier life, still visible.
 *
 * The colour is a measurement. Teal is [O III] at 496 and 501 nm, which needs
 * 35 eV photons to make the ion and so only exists where the ultraviolet field
 * is still hard; red is Hα at 656 nm, which needs 13.6 eV and survives to the
 * rim. The boundary between them sits where the hard photons run out, and its
 * depth into the shell is set by the core's temperature - so a hot core gives
 * the teal-cored, red-rimmed nebula of the photographs, and a cool one gives an
 * orange nebula with no teal at all.
 */

import * as THREE from 'three';
import { NOISE_GLSL } from './shaders/noise';
import { ionisationEdge } from '../astro/planetarynebula';

const SHELL_VERT = /* glsl */ `
out vec3 vObj;
void main() {
  vObj = position;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

const SHELL_FRAG = /* glsl */ `
precision highp float;
${NOISE_GLSL}

in vec3 vObj;
out vec4 fragColor;

uniform vec3 uCamLocal;    // camera in the nebula's frame, outer-halo radii
uniform float uRin;        // inner surface of the bright shell
uniform float uRout;       // outer surface of the bright shell
uniform float uHalo;       // strength of the old AGB wind outside it
uniform float uGain;       // surface brightness of the line emission
uniform float uScatter;    // surface brightness of the reflected starlight
uniform float uOiiiEdge;   // depth through the shell where [O III] gives out
uniform float uWaist;      // 0 round, 1 strongly pinched at the equator
uniform vec3 uAxis;        // the torus axis, unit
uniform float uKnots;      // clumpiness of the ionisation front
uniform float uArcs;       // concentric shells from the pulsing AGB wind
uniform float uIon;        // how much of the gas is ionised yet, 0 to 1
uniform float uSeed;

const int STEPS = 22;

// Line emission, in linear light. These are the two colours a photograph of an
// ionised nebula can be: the forbidden [O III] doublet at 496/501 nm, which the
// eye reads as a green-cyan, and the Balmer alpha line at 656 nm. Nitrogen adds
// [N II] at 658 nm, so close to Hα that it only deepens the red.
const vec3 OIII = vec3(0.16, 1.00, 0.72);
const vec3 HA   = vec3(1.00, 0.19, 0.20);
// Before the core is hot enough to ionise anything, the envelope is cold dust
// lit by reflected starlight, and the star it is reflecting is still a cool
// post-AGB supergiant. So a proto-planetary nebula is pale gold - which is what
// the Egg and the Boomerang are, and why they look nothing like the rest.
const vec3 DUST = vec3(1.00, 0.86, 0.66);

bool hitSphere(vec3 o, vec3 d, float r, out float t0, out float t1) {
  float b = dot(o, d);
  float c = dot(o, o) - r * r;
  float disc = b * b - c;
  if (disc < 0.0) return false;
  float s = sqrt(disc);
  t0 = -b - s;
  t1 = -b + s;
  return true;
}

float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

// Gas density at a point, in units where the shell's peak is 1.
float density(vec3 p, out float depth, out float belt) {
  float r = length(p);
  depth = 0.0;
  belt = 0.0;
  if (r < 1e-4) return 0.0;
  vec3 dir = p / r;

  float ct = dot(dir, uAxis);
  float pol = ct * ct;              // 1 along the axis, 0 in the equator
  float eq = max(1.0 - pol, 1e-4);

  // The lobes run further than the waist. The fast wind from the exposed core
  // is held back by the dense equatorial gas and escapes along the axis
  // instead, so the shell is stretched at the poles and pinched at the middle.
  float stretch = (1.0 - 0.38 * uWaist * eq) * (1.0 + 0.75 * uWaist * pol);
  float rIn = uRin * stretch;
  float rOut = uRout * stretch;

  float u = (r - rIn) / max(rOut - rIn, 1e-4);
  depth = clamp(u, 0.0, 1.0);

  // A wind-blown bubble is a thin dense shell of swept-up gas resting against a
  // contact discontinuity: a wall on the inside, where the hot shocked wind
  // that cleared the cavity stops, and a fade on the outside into the older,
  // slower wind it is ploughing into. The inner face being sharp is the whole
  // reason the limb brightening reads as an edge rather than a haze.
  float shell = 0.0;
  if (u > -0.05 && u < 1.2) {
    shell = smoothstep(-0.03, 0.07, u) * exp(-u * 0.9) * smoothstep(1.18, 0.80, u);
  }

  // The torus. This is the shape of the nebula, not a decoration on it: almost
  // every planetary nebula is one, because the AGB wind leaves a dense
  // equatorial belt - shaped by a companion star, or by rotation - and the fast
  // wind can only break out through the poles. Seen down the axis it is a ring;
  // seen from the side, a bar with two faint lobes. Both are in the catalogues,
  // and they are the same object.
  belt = 0.26 + 0.74 * pow(eq, 6.0 * uWaist);
  shell *= belt;

  // Concentric arcs. The wind did not blow steadily: an AGB star pulses, and
  // every few hundred years it puts out a denser shell. They are frozen into
  // the envelope as it coasts outward, so the spacing on the sky is a direct
  // readout of the pulse period - which is how the interval between thermal
  // pulses was first measured in an object rather than in a model.
  // Warped, because the wind did not leave in a perfectly spherical shell and
  // the arcs in the photographs are not perfect circles either.
  float arcPhase = r / max(uRout, 1e-4) + 0.045 * fbm(dir * 3.0 + vec3(uSeed), 2, 2.0, 0.5);
  shell *= 1.0 + 0.22 * sin(arcPhase * uArcs * 6.2831853);

  // Knots. The angular term is coherent along a radius, so a clump stretches
  // into the cometary globule the ionisation front actually makes; the second
  // term is a genuinely three-dimensional field that gives it a finite length,
  // without which every clump becomes an infinite spoke out of the centre.
  float rad = fbm(p * (13.0 / max(uRout, 1e-3)) + vec3(uSeed * 1.7), 2, 2.3, 0.5);
  // The angular field is warped by the three-dimensional one before it is
  // sampled. Without that it is a pure function of direction, every clump
  // becomes an infinitely long spoke, and the nebula turns into a starburst
  // centred exactly on the pixel the star is in.
  float ang = fbm(dir * 9.0 + vec3(uSeed) + rad * 0.8, 3, 2.1, 0.52);
  shell *= max(1.0 + uKnots * (0.9 * ang + 1.1 * rad), 0.0);

  // The halo: the slow wind of the star's last hundred thousand years, ionised
  // but never swept up. It lies outside the bright shell - round even when the
  // shell inside it is not - and is a hundred times fainter. None of it is in
  // the cavity, which the fast wind cleared out long ago.
  float halo = uHalo * smoothstep(uRout * 0.98, uRout * 1.3, r) * smoothstep(1.02, 0.80, r)
             / max(r * r, 1e-3);

  return shell + halo;
}

vec3 marchSegment(vec3 o, vec3 d, float ta, float tb, float jitter) {
  vec3 acc = vec3(0.0);
  if (tb <= ta) return acc;
  float ds = (tb - ta) / float(STEPS);
  for (int i = 0; i < STEPS; i++) {
    vec3 p = o + d * (ta + (float(i) + jitter) * ds);
    float depth, belt;
    float n = density(p, depth, belt);
    if (n <= 0.0) continue;
    // Recombination lines go as the emission measure, n squared, not as n.
    // This is the reason the bright rim is *much* brighter than the middle and
    // not merely a little: the geometry gives a factor of two or three in path
    // length and the square gives it back again in contrast.
    float em = n * n;
    // Where the 35 eV photons have run out there is no doubly-ionised oxygen,
    // so the same gas emits a different colour.
    float u = clamp(depth / max(uOiiiEdge, 1e-3), 0.0, 1.0);
    // Two ways for gas to be visible, and which one applies is a fact about the
    // star, not a choice. Recombination lines go as the emission measure, n
    // squared; scattered starlight goes as the column, n. So the dusty phase is
    // smooth and the ionised phase is knotty, for a reason.
    // Before the gas is ionised the same torus that will later be the bright
    // bar is instead a wall of dust: it is optically thick, so it absorbs the
    // starlight rather than scattering it, and the star's light escapes through
    // the thin poles. So the reflection nebula is two lobes with a dark lane
    // between them - the Egg, the Boomerang - and the shape inverts completely
    // at the moment the ultraviolet comes on. Nothing about the geometry
    // changes; only which physics is doing the shining.
    float lit = exp(-8.0 * belt * uWaist);
    // And an optically thick shell is seen only at its skin. Light scattered
    // deep inside never gets out, so the dusty phase is a thin luminous
    // surface with the planetary system still visible through it - which is
    // the only reason it is possible to watch the envelope cross an orbit.
    float skin = smoothstep(0.28, 0.95, depth);
    acc += (em * mix(HA, OIII, 1.0 - pow(u, 3.5)) * uIon * uGain
          + n * DUST * lit * skin * uScatter) * ds;
  }
  return acc;
}

void main() {
  vec3 o = uCamLocal;
  vec3 d = normalize(vObj - uCamLocal);

  float t0, t1;
  if (!hitSphere(o, d, 1.0, t0, t1)) discard;
  float tn = max(t0, 0.0);
  if (t1 <= tn) discard;

  float jitter = ign(gl_FragCoord.xy);

  // The nebula is hollow and the cavity is most of it, so marching the whole
  // chord would spend three-quarters of every ray's samples on vacuum and leave
  // the shell itself aliased. Split the chord around the cavity instead.
  float rc = uRin * (1.0 - 0.42 * uWaist);
  float i0, i1;
  bool hollow = hitSphere(o, d, rc, i0, i1) && i1 > tn;

  vec3 acc;
  if (hollow) {
    acc  = marchSegment(o, d, tn, max(i0, tn), jitter);
    acc += marchSegment(o, d, max(i1, tn), t1, jitter);
  } else {
    acc = marchSegment(o, d, tn, t1, jitter);
  }

  // A nebula is a faint extended thing and is never a highlight. The bloom in
  // this engine has a very wide radius, so a compact source above its threshold
  // hazes the whole frame; a soft shoulder keeps the shell below that, and
  // because it is a shoulder rather than a clip the gradients survive.
  vec3 col = acc / (1.0 + acc * (1.0 / 1.15));
  if (max(col.r, max(col.g, col.b)) < 1e-6) discard;
  // Additive blending multiplies by the source alpha, so the alpha stays at 1
  // and the brightness lives entirely in the colour.
  fragColor = vec4(col, 1.0);
}
`;

export interface NebulaShellOptions {
  /** Outer radius of the bright shell, scene units. */
  radius: number;
  /** Shell thickness as a fraction of that radius. */
  thickness: number;
  /** Effective temperature of the exposed core, K - this sets the colour. */
  centralTempK: number;
  /** Surface brightness, relative. */
  brightness?: number;
  /** 0 for a round nebula, 1 for a strongly pinched bipolar one. */
  waist?: number;
  seed?: number;
}

/** The halo runs to this multiple of the bright shell's outer radius. */
export const HALO_EXTENT = 1.42;

export class NebulaShellView {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private inv = new THREE.Matrix4();
  private radius: number;

  constructor(opts: NebulaShellOptions) {
    this.radius = Math.max(opts.radius, 1e-9);
    const seed = opts.seed ?? 1;
    // The [O III] boundary, as a depth through the shell - the same function
    // the physics module uses, so the picture and the numbers cannot disagree.
    const oiiiEdge = ionisationEdge(opts.centralTempK);

    this.mat = new THREE.ShaderMaterial({
      vertexShader: SHELL_VERT,
      fragmentShader: SHELL_FRAG,
      glslVersion: THREE.GLSL3,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.BackSide,
      uniforms: {
        uCamLocal: { value: new THREE.Vector3(0, 0, 4) },
        uRin: { value: 0 },
        uRout: { value: 0 },
        uHalo: { value: 0.10 },
        uGain: { value: 0 },
        uOiiiEdge: { value: oiiiEdge },
        uWaist: { value: opts.waist ?? 0.55 },
        uAxis: { value: new THREE.Vector3(0, 1, 0) },
        uKnots: { value: 0.70 },
        uArcs: { value: 0 },
        uIon: { value: 1 },
        uScatter: { value: 0 },
        uSeed: { value: (seed % 997) * 0.131 },
      },
    });
    // The mesh is a unit sphere out to the halo; the shader works in those
    // units and the scale carries the physical size, so growing the nebula is
    // one number and never a rebuilt geometry.
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.setGeometry(this.radius, opts.thickness);
    this.setBrightness(opts.brightness ?? 1);
  }

  /**
   * Resize the shell. Called every frame while the nebula expands, which it
   * does at 25 km/s for as long as anyone is watching.
   */
  setGeometry(radius: number, thickness: number): void {
    this.radius = Math.max(radius, 1e-9);
    this.mesh.scale.setScalar(this.radius * HALO_EXTENT);
    const rOut = 1 / HALO_EXTENT;
    const t = Math.min(0.85, Math.max(0.03, thickness));
    this.mat.uniforms.uRout.value = rOut;
    this.mat.uniforms.uRin.value = rOut * (1 - t);
  }

  /**
   * Surface brightness of the line emission. The shader integrates n² ds in
   * units where the shell peaks at 1 and the path is a fraction of the radius,
   * so the raw integral is of order one; the constant here is what turns that
   * into something the tone mapper's toe does not swallow.
   */
  setBrightness(v: number): void {
    this.mat.uniforms.uGain.value = Math.max(0, v) * 0.42;
  }

  /** Orientation of the equatorial torus. */
  setAxis(axis: THREE.Vector3): void {
    (this.mat.uniforms.uAxis.value as THREE.Vector3).copy(axis).normalize();
  }

  /**
   * How many concentric arcs are frozen into the envelope: the shell's age
   * divided by the interval between the star's thermal pulses.
   */
  setArcs(n: number): void {
    this.mat.uniforms.uArcs.value = Math.min(40, Math.max(0, n));
  }

  setWaist(v: number): void { this.mat.uniforms.uWaist.value = Math.min(1, Math.max(0, v)); }

  /**
   * Which of the two things this is right now: an ionised nebula shining in
   * [O III] and Ha, or a cold dust shell shining in reflected starlight. Early
   * on it is entirely the second, and the change between them is the moment the
   * core finishes contracting and the ultraviolet switches on.
   */
  setPhase(ionised: number, reflected: number): void {
    this.mat.uniforms.uIon.value = Math.min(1, Math.max(0, ionised));
    // The two have separate gains, and they have to. Scattered starlight goes
    // as the column and line emission as its square, and the two phases are
    // separated by four orders of magnitude in surface brightness and by
    // thousands of years - which is why no photograph has ever shown both. Each
    // is exposed against its own peak. The compression is a cube root, and it
    // is the only place in this shader where something is done for the eye
    // rather than for the physics.
    this.mat.uniforms.uScatter.value = reflected > 1e-4
      ? Math.pow(reflected, 1 / 3) * 0.25 : 0;
  }

  /** Where the doubly-ionised zone gives out, as a depth through the shell. */
  setCentralTemperature(kelvin: number): void {
    this.mat.uniforms.uOiiiEdge.value = ionisationEdge(kelvin);
  }

  update(camera: THREE.Camera): void {
    this.mesh.updateWorldMatrix(true, false);
    this.inv.copy(this.mesh.matrixWorld).invert();
    const cam = this.mat.uniforms.uCamLocal.value as THREE.Vector3;
    camera.getWorldPosition(cam).applyMatrix4(this.inv);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
