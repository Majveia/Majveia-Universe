/**
 * Renders the cosmic web.
 *
 * Every particle carries its Lagrangian position q, its Zel'dovich displacement
 * Psi and the three eigenvalues of its deformation tensor. The vertex shader
 * does the rest:
 *
 *   x   = q + D(a) * Psi                       - where it is, at this epoch
 *   1+d = 1 / prod(1 - D(a) * lambda_i)        - how dense it is, exactly
 *   web = #{ i : D(a) * lambda_i > 0 }         - void / sheet / filament / knot
 *
 * So dragging the time slider does not replay a baked animation. It re-evaluates
 * the analytic solution of gravitational collapse for two million particles,
 * every frame, and the structure you watch assemble is the structure the
 * equations predict.
 *
 * The box is periodic, so it tiles seamlessly: neighbouring copies are drawn as
 * instances at reduced particle counts, which is what makes the volume feel
 * unbounded without a seam anywhere.
 */

import * as THREE from 'three';
import type { CosmicWebField } from '../cosmology/zeldovich';

const VERT = /* glsl */ `
precision highp float;

in vec3 position;      // Lagrangian coordinate q, Mpc
in vec3 aPsi;          // displacement at D = 1, Mpc
in vec3 aLambda;       // deformation eigenvalues l1 >= l2 >= l3
in vec3 aTile;         // periodic-image offset, in box units (instanced)

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uD;            // linear growth factor at the current epoch
uniform float uBox;          // box side, Mpc
uniform float uSizeCells;    // point diameter in units of the mean particle spacing
uniform float uCellMpc;      // mean particle spacing, Mpc
uniform float uPixPerRad;    // viewport height / (2 tan(fov/2))
uniform float uMinSize;
uniform float uMaxSize;
uniform float uDensityGain;
uniform float uBrightness;
uniform float uFilamentBoost;
uniform vec3 uCamera;
uniform float uFadeStart;
uniform float uFadeEnd;
uniform float uNearFade;
uniform float uVelocityTint;
uniform float uVelocityFactor;
uniform float uSlice;        // 0 = full volume, >0 = thickness of a slab in Mpc
uniform vec3 uSliceNormal;

out vec3 vColor;
out float vAlpha;

// A five-stop ramp from void to virialised knot. The stops are placed by the
// physics - the transitions sit at the density contrasts where a region stops
// expanding, turns around, and collapses - and the colours are chosen so that
// the highlights land above 1.0 in linear light and therefore bloom.
vec3 webRamp(float t) {
  const vec3 c0 = vec3(0.012, 0.030, 0.135);  // void: cold, almost nothing
  const vec3 c1 = vec3(0.048, 0.125, 0.430);  // sheet: dim indigo
  const vec3 c2 = vec3(0.230, 0.330, 0.860);  // wall: periwinkle
  const vec3 c3 = vec3(1.020, 0.560, 0.185);  // filament: shock-heated gold
  const vec3 c4 = vec3(1.900, 1.420, 1.020);  // knot: virialised, white hot
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.50) return mix(c1, c2, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c2, c3, (t - 0.50) / 0.25);
  return mix(c3, c4, (t - 0.75) / 0.25);
}

void main() {
  vec3 q = position;
  vec3 pos = q + uD * aPsi + aTile * uBox;

  // Zel'dovich density: the Jacobian of the Lagrangian-to-Eulerian map.
  vec3 f = vec3(1.0) - uD * aLambda;
  float jac = f.x * f.y * f.z;
  float dens = 1.0 / max(abs(jac), 0.02);

  // How many principal axes have collapsed at this epoch: 0 void .. 3 knot
  vec3 coll = step(vec3(0.0), uD * aLambda);
  float webType = coll.x + coll.y + coll.z;

  // Colour carries two independent facts at once: *how* a region collapsed
  // (the T-web class, from the signs of the eigenvalues) and *how far* it got
  // (the density). A wall and a filament at the same density are different
  // objects, and here they look different.
  float densT = clamp((log2(max(dens, 0.06)) + 2.0) / 9.0, 0.0, 1.0);
  float classT = webType / 3.0;
  float t = clamp((0.42 * classT * uFilamentBoost + 0.72 * densT) * uDensityGain, 0.0, 1.0);
  vec3 col = webRamp(t);

  // Optional tint by peculiar velocity: matter falling toward you is blue-shifted
  if (uVelocityTint > 0.0) {
    vec3 vel = aPsi * uVelocityFactor;
    vec3 toCam = normalize(uCamera - pos);
    float vr = dot(vel, toCam) * 0.0016;
    col *= vec3(1.0 - vr * 0.9, 1.0 - abs(vr) * 0.25, 1.0 + vr * 0.9);
  }

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float dist = -mv.z;
  gl_Position = projectionMatrix * mv;

  // Point size is expressed in units of the mean particle spacing, so changing
  // the grid resolution or the window size changes the sampling density without
  // changing the appearance of the field. This is the same reasoning a smoothed
  // particle hydrodynamics kernel uses.
  float size = uSizeCells * uCellMpc * uPixPerRad *
               (0.30 + 0.80 * log2(1.0 + dens)) / max(dist, 1e-3);
  gl_PointSize = clamp(size, uMinSize, uMaxSize);

  // The eye has to be able to tell a void from a filament, and in linear light
  // the contrast between them is enormous - so the opacity curve is steep. Void
  // particles are almost invisible individually and only register as the faint
  // haze that fills the space between the sheets, which is exactly how they
  // look in a real survey.
  // Flux conservation. A particle stands for a fixed lump of matter, so its
  // *total* emitted light is fixed and its surface brightness is that light
  // divided by the area it is smeared over. Dividing by uSizeCells^2 means the
  // softness knob changes how the field looks, never how bright it is - and
  // because both the disc area and the received flux fall as 1/d^2, the surface
  // brightness of a filament is correctly independent of how far away it is.
  // Opacity is driven by density alone, and steeply. A line of sight through
  // this box crosses of order a hundred particles, so a void particle has to be
  // very nearly transparent or the voids fill in and the web disappears into
  // fog. The exponent sets how hard the transition from void to filament is.
  float ld = log2(max(dens, 0.06));
  float aBase = pow(smoothstep(-0.6, 3.2, ld), 3.0);
  // Above delta ~ 10 a region has turned around and is collapsing, and its
  // brightness is allowed to run away without a ceiling. That is what makes
  // cluster cores blow out into the bloom while filaments stay readable.
  float hot = max(0.0, ld - 3.2) * 0.55;
  float a = uBrightness * (0.0006 + aBase + hot) / (uSizeCells * uSizeCells);
  a *= 1.0 - smoothstep(uFadeStart, uFadeEnd, dist);
  // Particles almost on top of the camera project to huge discs and read as
  // out-of-focus blobs rather than as matter. Fade them in over a few mean
  // separations - the same trick a volume renderer uses at its near plane.
  a *= smoothstep(uNearFade * 0.12, uNearFade, dist);

  if (uSlice > 0.0) {
    float d = abs(dot(pos - uCamera, uSliceNormal));
    a *= 1.0 - smoothstep(uSlice * 0.6, uSlice, d);
  }

  // Points smaller than a pixel must dim rather than alias into sparkle.
  float sub = clamp(size / max(uMinSize, 0.5), 0.0, 1.0);
  a *= mix(sub * sub, 1.0, step(uMinSize, size));

  vColor = col;
  vAlpha = a;
}
`;

const FRAG = /* glsl */ `
precision highp float;
in vec3 vColor;
in float vAlpha;
out vec4 fragColor;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  // Gaussian core with a soft skirt: reads as a glowing particle, not a disc.
  float g = exp(-r2 * 3.2) * (1.0 - r2 * 0.35);
  fragColor = vec4(vColor * (g * vAlpha), 1.0);
}
`;

export interface CosmicWebOptions {
  /** How many periodic images to draw per axis (1, 3 or 5). */
  tiles?: number;
  /** Fraction of particles drawn in the central tile. */
  detail?: number;
  /** Fraction of particles drawn in the surrounding tiles. */
  neighbourDetail?: number;
}

export class CosmicWebRenderer {
  readonly group = new THREE.Group();
  readonly field: CosmicWebField;
  private core: THREE.Points;
  private shell?: THREE.Points;
  private mat: THREE.RawShaderMaterial;
  private shellMat?: THREE.RawShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;
  private shellGeo?: THREE.InstancedBufferGeometry;
  private shellBrightness = 0.55;

  constructor(field: CosmicWebField, opts: CosmicWebOptions = {}) {
    this.field = field;
    const tiles = opts.tiles ?? 3;
    const detail = Math.max(0.01, Math.min(1, opts.detail ?? 1));
    const nDetail = Math.max(0.002, Math.min(1, opts.neighbourDetail ?? 0.05));

    const uniforms = () => ({
      uD: { value: 1 },
      uBox: { value: field.boxMpc },
      uSizeCells: { value: 0.75 },
      uCellMpc: { value: field.boxMpc / field.n },
      uPixPerRad: { value: 800 },
      uMinSize: { value: 1.0 },
      uMaxSize: { value: 26 },
      uDensityGain: { value: 1.0 },
      uBrightness: { value: 1.0 },
      uFilamentBoost: { value: 1.0 },
      uCamera: { value: new THREE.Vector3() },
      uNearFade: { value: field.boxMpc * 0.06 },
      uFadeStart: { value: field.boxMpc * 1.1 },
      uFadeEnd: { value: field.boxMpc * 2.4 },
      uVelocityTint: { value: 0 },
      uVelocityFactor: { value: 0 },
      uSlice: { value: 0 },
      uSliceNormal: { value: new THREE.Vector3(0, 0, 1) },
    });

    const mkGeo = (tileOffsets: Float32Array, count: number) => {
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(field.q, 3));
      g.setAttribute('aPsi', new THREE.BufferAttribute(field.psi, 3));
      g.setAttribute('aLambda', new THREE.BufferAttribute(field.lambda, 3));
      g.setAttribute('aTile', new THREE.InstancedBufferAttribute(tileOffsets, 3));
      g.instanceCount = tileOffsets.length / 3;
      g.setDrawRange(0, count);
      g.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(field.boxMpc / 2, field.boxMpc / 2, field.boxMpc / 2),
        field.boxMpc * tiles);
      return g;
    };

    this.geo = mkGeo(new Float32Array([0, 0, 0]), Math.floor(field.count * detail));
    this.mat = new THREE.RawShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: uniforms(),
      glslVersion: THREE.GLSL3,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.core = new THREE.Points(this.geo, this.mat);
    this.core.frustumCulled = false;
    this.group.add(this.core);

    if (tiles > 1) {
      const r = (tiles - 1) / 2;
      const offs: number[] = [];
      for (let i = -r; i <= r; i++)
        for (let j = -r; j <= r; j++)
          for (let k = -r; k <= r; k++)
            if (i || j || k) offs.push(i, j, k);
      this.shellGeo = mkGeo(new Float32Array(offs), Math.floor(field.count * nDetail));
      this.shellMat = new THREE.RawShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: uniforms(),
        glslVersion: THREE.GLSL3,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      });
      // Neighbour images are dimmer, not brighter: they are further away, they
      // are sampled more sparsely, and the volume needs to fall away into black
      // rather than pile up into a milky fog of overdraw.
      this.shellMat.uniforms.uBrightness.value = 0.55;
      this.shellBrightness = 0.55;
      this.shell = new THREE.Points(this.shellGeo, this.shellMat);
      this.shell.frustumCulled = false;
      this.group.add(this.shell);
    }
  }

  private each(fn: (u: Record<string, THREE.IUniform>) => void): void {
    fn(this.mat.uniforms);
    if (this.shellMat) fn(this.shellMat.uniforms);
  }

  /** Set the linear growth factor - this is the time control. */
  setGrowth(D: number): void { this.each((u) => { u.uD.value = D; }); }

  setCamera(p: THREE.Vector3): void {
    this.each((u) => (u.uCamera.value as THREE.Vector3).copy(p));
  }

  setLook(o: Partial<{
    sizeCells: number; brightness: number; densityGain: number; filamentBoost: number;
    maxSize: number; minSize: number; fadeStart: number; fadeEnd: number; nearFade: number;
    velocityTint: number; velocityFactor: number; slice: number;
  }>): void {
    this.each((u) => {
      if (o.sizeCells !== undefined) u.uSizeCells.value = o.sizeCells;
      if (o.densityGain !== undefined) u.uDensityGain.value = o.densityGain;
      if (o.filamentBoost !== undefined) u.uFilamentBoost.value = o.filamentBoost;
      if (o.maxSize !== undefined) u.uMaxSize.value = o.maxSize;
      if (o.minSize !== undefined) u.uMinSize.value = o.minSize;
      if (o.fadeStart !== undefined) u.uFadeStart.value = o.fadeStart;
      if (o.fadeEnd !== undefined) u.uFadeEnd.value = o.fadeEnd;
      if (o.nearFade !== undefined) u.uNearFade.value = o.nearFade;
      if (o.velocityTint !== undefined) u.uVelocityTint.value = o.velocityTint;
      if (o.velocityFactor !== undefined) u.uVelocityFactor.value = o.velocityFactor;
      if (o.slice !== undefined) u.uSlice.value = o.slice;
    });
    if (o.brightness !== undefined) {
      this.mat.uniforms.uBrightness.value = o.brightness;
      if (this.shellMat) this.shellMat.uniforms.uBrightness.value = o.brightness * this.shellBrightness;
    }
  }

  /** Keep point size in physical units as the window changes. */
  setViewport(heightPx: number, fovDeg: number): void {
    const p = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.each((u) => { u.uPixPerRad.value = p; });
  }

  /**
   * Surface brightness must not depend on how finely we sampled the field.
   * A line of sight crosses ~n cells, so each particle carries 1/n of the
   * light; this keeps a 64^3 preview and a 256^3 render looking identical
   * apart from resolution.
   */
  get sampleNormalisation(): number { return 1 / this.field.n; }

  setSliceNormal(n: THREE.Vector3): void {
    this.each((u) => (u.uSliceNormal.value as THREE.Vector3).copy(n).normalize());
  }

  /** Adjust how many particles are drawn without regenerating anything. */
  setDetail(fraction: number, neighbourFraction: number): void {
    this.geo.setDrawRange(0, Math.floor(this.field.count * Math.max(0.005, Math.min(1, fraction))));
    if (this.shellGeo) {
      this.shellGeo.setDrawRange(
        0, Math.floor(this.field.count * Math.max(0.001, Math.min(1, neighbourFraction))));
    }
  }

  get drawnParticles(): number {
    const a = this.geo.drawRange.count;
    const b = this.shellGeo ? this.shellGeo.drawRange.count * (this.shellGeo.instanceCount || 0) : 0;
    return a + b;
  }

  setVisible(v: boolean): void { this.group.visible = v; }

  dispose(): void {
    this.geo.dispose(); this.mat.dispose();
    this.shellGeo?.dispose(); this.shellMat?.dispose();
  }
}
