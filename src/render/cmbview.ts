/**
 * The microwave sky.
 *
 * The map is synthesised once, on the GPU, into an equirectangular texture: a
 * few hundred plane waves drawn from the temperature power spectrum, each
 * restricted to the sphere of last scattering, where it becomes a set of bands
 * at a single multipole. Their sum is a Gaussian random field with the right
 * angular power spectrum, and it is the same construction - the same statistics
 * - that seeded the cosmic web this universe grew.
 *
 * The colour scale is a choice; the pattern is not. Blue-to-red across a few
 * hundred microkelvin is the convention every experiment has used since COBE,
 * and it is used here so the picture is comparable to the real one.
 */

import * as THREE from 'three';
import type { Cosmology } from '../cosmology/lcdm';
import { cmbScales, sampleWaves, type CmbScales } from '../cosmology/cmb';

const SYNTH_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uWaves;    // (dir.xyz, phase) per texel, ell in a second row
uniform sampler2D uEll;
uniform float uCount;
uniform float uTexel;

void main() {
  // Equirectangular: u is longitude, v is latitude.
  float lon = (vUv.x * 2.0 - 1.0) * 3.14159265359;
  float lat = (vUv.y - 0.5) * 3.14159265359;
  vec3 n = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));

  float sum = 0.0;
  int count = int(uCount);
  for (int i = 0; i < 1024; i++) {
    if (i >= count) break;
    float t = (float(i) + 0.5) * uTexel;
    vec4 w = texture(uWaves, vec2(t, 0.5));
    float ell = texture(uEll, vec2(t, 0.5)).r;
    sum += cos(ell * dot(w.xyz, n) + w.w);
  }
  sum *= sqrt(2.0 / max(uCount, 1.0));
  fragColor = vec4(sum, 0.0, 0.0, 1.0);
}
`;

const SKY_VERT = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
in vec3 position;
out vec3 vDir;
void main() {
  vDir = normalize(position);
  mat4 mv = modelViewMatrix;
  mv[3].xyz = vec3(0.0);
  vec4 p = projectionMatrix * mv * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const SKY_FRAG = /* glsl */ `
precision highp float;
in vec3 vDir;
out vec4 fragColor;

uniform sampler2D uMap;
uniform float uScale;      // microkelvin per unit of the field
uniform float uRange;      // microkelvin at full colour
uniform float uBrightness;
uniform float uDipole;     // amplitude of the observer's own motion, microkelvin
uniform vec3 uDipoleDir;

// A cluster in the way. uSz is (central signal in microkelvin, core angle,
// outer angle, kinetic signal in microkelvin); uSzDir is where it is.
uniform vec4 uSz;
uniform vec3 uSzDir;

// Cold in blue, hot in red - the convention since COBE - but with the mean
// taken down to near black instead of to the usual pale grey, because this is
// meant to be looked at on a panel with real blacks and with the cosmic web
// drawn in front of it. The palette is a choice; the pattern is not.
vec3 ramp(float t) {
  float x = clamp(t, -1.0, 1.0);
  vec3 cold = vec3(0.045, 0.125, 0.46);
  vec3 mid  = vec3(0.012, 0.014, 0.028);
  vec3 hot  = vec3(0.50, 0.185, 0.055);
  return mix(mid, x < 0.0 ? cold : hot, min(abs(x) * 1.15, 1.0));
}

void main() {
  vec3 d = normalize(vDir);
  float lon = atan(d.z, d.x);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  vec2 uv = vec2(lon / 6.28318530718 + 0.5, lat / 3.14159265359 + 0.5);
  float t = texture(uMap, uv).r * uScale;
  // Our own motion through the background: a pure dipole, and by far the
  // largest anisotropy in the real sky.
  t += uDipole * dot(d, normalize(uDipoleDir));

  // And a cluster in the line of sight, scattering some of it away.
  //
  // The same truncated beta model the gas is drawn with, evaluated in angle
  // rather than in megaparsecs: at beta = 2/3 the column through it has a
  // closed form, N(b) ~ atan(L/s)/s with s = sqrt(rc^2+b^2), so the profile
  // on the sky is that shape normalised to one at the centre. Every cluster
  // makes the same dent whatever its distance - what changes with distance is
  // only how large the dent is on the sky.
  if (uSz.x != 0.0 || uSz.w != 0.0) {
    float th = acos(clamp(dot(d, normalize(uSzDir)), -1.0, 1.0));
    float thC = max(uSz.y, 1e-9);
    float thMax = max(uSz.z, thC * 1.001);
    if (th < thMax) {
      float sc = sqrt(thC * thC + th * th);
      float l = sqrt(max(0.0, thMax * thMax - th * th));
      float prof = (thC / sc) * atan(l / sc) / atan(thMax / thC);
      t += (uSz.x + uSz.w) * prof;
    }
  }
  fragColor = vec4(ramp(t / uRange) * uBrightness, 1.0);
}
`;

export interface CmbViewOptions {
  cosmology: Cosmology;
  seed: number;
  /** Number of plane waves. More is a better realisation and costs more once. */
  waves?: number;
  /** Equirectangular map width; height is half. */
  resolution?: number;
  /** Lowest and highest multipole to synthesise. */
  ellRange?: [number, number];
  /** RMS of the temperature field, microkelvin. */
  rmsMicroK?: number;
  /** Observer's dipole amplitude, microkelvin. 3360 is ours. */
  dipoleMicroK?: number;
}

export class CmbView {
  readonly mesh: THREE.Mesh;
  readonly scales: CmbScales;
  private target: THREE.WebGLRenderTarget;
  private skyMat: THREE.RawShaderMaterial;
  private synthMat: THREE.RawShaderMaterial;
  private synthScene = new THREE.Scene();
  private synthCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private waveTex: THREE.DataTexture;
  private ellTex: THREE.DataTexture;
  private rendered = false;

  constructor(opts: CmbViewOptions) {
    const n = Math.min(1024, opts.waves ?? 420);
    const res = opts.resolution ?? 1536;
    this.scales = cmbScales(opts.cosmology);
    // The lowest multipoles are left out on purpose: a handful of very
    // large-scale modes would dominate the picture with a couple of enormous
    // patches, they are the ones cosmic variance makes least meaningful, and
    // they are exactly the ones a finite set of plane waves realises worst.
    const [lo, hi] = opts.ellRange ?? [26, 1700];
    const waves = sampleWaves(opts.cosmology, this.scales, opts.seed, n, lo, hi);

    // Two textures rather than one, because the multipole needs more precision
    // than a wave direction and both want to be plain float.
    const wd = new Float32Array(n * 4);
    const ed = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      wd[i * 4] = waves[i].dir[0];
      wd[i * 4 + 1] = waves[i].dir[1];
      wd[i * 4 + 2] = waves[i].dir[2];
      wd[i * 4 + 3] = waves[i].phase;
      ed[i * 4] = waves[i].ell;
    }
    this.waveTex = new THREE.DataTexture(wd, n, 1, THREE.RGBAFormat, THREE.FloatType);
    this.ellTex = new THREE.DataTexture(ed, n, 1, THREE.RGBAFormat, THREE.FloatType);
    for (const t of [this.waveTex, this.ellTex]) {
      t.minFilter = THREE.NearestFilter;
      t.magFilter = THREE.NearestFilter;
      t.needsUpdate = true;
    }

    this.target = new THREE.WebGLRenderTarget(res, res >> 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
    });

    this.synthMat = new THREE.RawShaderMaterial({
      vertexShader: `
        precision highp float;
        in vec3 position;
        in vec2 uv;
        out vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: SYNTH_FRAG,
      glslVersion: THREE.GLSL3,
      uniforms: {
        uWaves: { value: this.waveTex },
        uEll: { value: this.ellTex },
        uCount: { value: n },
        uTexel: { value: 1 / n },
      },
    });
    this.synthScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.synthMat));

    this.skyMat = new THREE.RawShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      glslVersion: THREE.GLSL3,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uMap: { value: this.target.texture },
        uScale: { value: opts.rmsMicroK ?? 110 },
        uRange: { value: 340 },
        // The tone mapper lifts the darkest values a long way - that is what it is
        // for - so the map has to be laid down far below the level it should
        // appear at, or a 110 microkelvin fluctuation comes out as a wall of
        // saturated colour.
        uBrightness: { value: 0.075 },
        uDipole: { value: opts.dipoleMicroK ?? 0 },
        uDipoleDir: { value: new THREE.Vector3(-0.07, 0.66, 0.75).normalize() },
        uSz: { value: new THREE.Vector4(0, 0, 0, 0) },
        uSzDir: { value: new THREE.Vector3(0, 0, 1) },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), this.skyMat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -90;
  }

  /** Synthesise the map. Costs one pass, once. */
  render(renderer: THREE.WebGLRenderer): void {
    if (this.rendered) return;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(this.synthScene, this.synthCam);
    renderer.setRenderTarget(prev);
    this.rendered = true;
  }

  setBrightness(v: number): void { this.skyMat.uniforms.uBrightness.value = v; }
  /** Full-colour temperature range, microkelvin. */
  setRange(v: number): void { this.skyMat.uniforms.uRange.value = v; }
  setDipole(microK: number): void { this.skyMat.uniforms.uDipole.value = microK; }

  /**
   * Put a cluster in the way.
   *
   * @param dir        unit vector from the observer to the cluster's centre
   * @param thermalUK  thermal signal through the centre, microkelvin, signed
   * @param kineticUK  the cluster's own motion, microkelvin, signed
   * @param coreRad    angular core radius
   * @param outerRad   angular radius the gas is truncated at
   */
  setCluster(
    dir: THREE.Vector3, thermalUK: number, kineticUK: number,
    coreRad: number, outerRad: number,
  ): void {
    (this.skyMat.uniforms.uSzDir.value as THREE.Vector3).copy(dir).normalize();
    (this.skyMat.uniforms.uSz.value as THREE.Vector4)
      .set(thermalUK, coreRad, outerRad, kineticUK);
  }

  /** Take it away again. */
  clearCluster(): void {
    (this.skyMat.uniforms.uSz.value as THREE.Vector4).set(0, 0, 0, 0);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.skyMat.dispose();
    this.synthMat.dispose();
    this.target.dispose();
    this.waveTex.dispose();
    this.ellTex.dispose();
  }
}
