/**
 * The rendering pipeline.
 *
 * Everything is rendered into a half-float HDR buffer in linear light, because
 * a universe has a dynamic range that 8 bits cannot hold: the surface of an O
 * star and the faint outskirts of a void differ by twenty orders of magnitude.
 * The chain is
 *
 *   scene (linear HDR)
 *     -> bright pass + progressive downsample (Karis-averaged 13-tap)
 *     -> tent-filtered upsample, accumulating a physically soft bloom
 *     -> AgX tone mapping
 *     -> triangular-PDF dither, then sRGB encode
 *
 * The dither matters more than it sounds. On an OLED panel with true blacks,
 * an undithered dark gradient shows visible contour rings; a sub-LSB triangular
 * noise removes them completely and costs one texture-free instruction.
 */

import * as THREE from 'three';

const FS_VERT = /* glsl */ `
precision highp float;
out vec2 vUv;
void main() {
  // One oversized triangle - no seam down the middle, one fewer vertex.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const COMMON = /* glsl */ `
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 fragColor;
`;

/** 13-tap downsample with Karis luminance weighting: kills fireflies before they bloom. */
const DOWN_FRAG = COMMON + /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
uniform int uFirst;

vec3 tap(vec2 uv) { return texture(uSrc, uv).rgb; }
float karis(vec3 c) { return 1.0 / (1.0 + max(max(c.r, c.g), c.b)); }

void main() {
  vec2 t = uTexel;
  vec3 a = tap(vUv + t * vec2(-2.0, 2.0));
  vec3 b = tap(vUv + t * vec2( 0.0, 2.0));
  vec3 c = tap(vUv + t * vec2( 2.0, 2.0));
  vec3 d = tap(vUv + t * vec2(-2.0, 0.0));
  vec3 e = tap(vUv);
  vec3 f = tap(vUv + t * vec2( 2.0, 0.0));
  vec3 g = tap(vUv + t * vec2(-2.0,-2.0));
  vec3 h = tap(vUv + t * vec2( 0.0,-2.0));
  vec3 i = tap(vUv + t * vec2( 2.0,-2.0));
  vec3 j = tap(vUv + t * vec2(-1.0, 1.0));
  vec3 k = tap(vUv + t * vec2( 1.0, 1.0));
  vec3 l = tap(vUv + t * vec2(-1.0,-1.0));
  vec3 m = tap(vUv + t * vec2( 1.0,-1.0));

  vec3 sum;
  if (uFirst == 1) {
    // Weighted by inverse luminance to suppress single-pixel fireflies
    vec3 g0 = (j + k + l + m) * 0.25; float w0 = karis(g0);
    vec3 g1 = (a + b + d + e) * 0.25; float w1 = karis(g1);
    vec3 g2 = (b + c + e + f) * 0.25; float w2 = karis(g2);
    vec3 g3 = (d + e + g + h) * 0.25; float w3 = karis(g3);
    vec3 g4 = (e + f + h + i) * 0.25; float w4 = karis(g4);
    float wt = w0 * 0.5 + (w1 + w2 + w3 + w4) * 0.125;
    sum = (g0 * w0 * 0.5 + g1 * w1 * 0.125 + g2 * w2 * 0.125 + g3 * w3 * 0.125 + g4 * w4 * 0.125) / max(wt, 1e-5);
    // Soft-knee bright pass
    float br = max(max(sum.r, sum.g), sum.b);
    float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / (4.0 * uKnee + 1e-5);
    sum *= max(soft, br - uThreshold) / max(br, 1e-5);
  } else {
    sum = e * 0.125;
    sum += (a + c + g + i) * 0.03125;
    sum += (b + d + f + h) * 0.0625;
    sum += (j + k + l + m) * 0.125;
  }
  fragColor = vec4(max(sum, vec3(0.0)), 1.0);
}
`;

const UP_FRAG = COMMON + /* glsl */ `
uniform sampler2D uSrc;
uniform sampler2D uPrev;
uniform vec2 uTexel;
uniform float uRadius;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 s =
      texture(uSrc, vUv + vec2(-t.x,  t.y)).rgb * 1.0
    + texture(uSrc, vUv + vec2( 0.0,  t.y)).rgb * 2.0
    + texture(uSrc, vUv + vec2( t.x,  t.y)).rgb * 1.0
    + texture(uSrc, vUv + vec2(-t.x,  0.0)).rgb * 2.0
    + texture(uSrc, vUv                    ).rgb * 4.0
    + texture(uSrc, vUv + vec2( t.x,  0.0)).rgb * 2.0
    + texture(uSrc, vUv + vec2(-t.x, -t.y)).rgb * 1.0
    + texture(uSrc, vUv + vec2( 0.0, -t.y)).rgb * 2.0
    + texture(uSrc, vUv + vec2( t.x, -t.y)).rgb * 1.0;
  fragColor = vec4(s * (1.0 / 16.0) + texture(uPrev, vUv).rgb, 1.0);
}
`;

const COMPOSITE_FRAG = COMMON + /* glsl */ `
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomStrength;
uniform float uExposure;
uniform float uVignette;
uniform float uTime;
uniform vec2 uResolution;
uniform float uSaturation;
uniform float uAberration;
uniform float uBlackPoint;

// ---- AgX tone mapping (Blender/Filament formulation).
// Highlights desaturate toward white along a perceptual path instead of
// hue-shifting the way Reinhard and naive ACES fits do, which keeps a
// blown-out star core white rather than magenta.
const mat3 AGX_IN = mat3(
  0.8425640, 0.0423241, 0.0423816,
  0.0784372, 0.8788109, 0.0784684,
  0.0791008, 0.0791687, 0.8791538);
const mat3 AGX_OUT = mat3(
   1.1968790, -0.0528968, -0.0529716,
  -0.0980810,  1.1519107, -0.0980434,
  -0.0990297, -0.0989611,  1.1510456);

vec3 agxDefaultContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return + 15.5 * x4 * x2
         - 40.14 * x4 * x
         + 31.96 * x4
         - 6.868 * x2 * x
         + 0.4298 * x2
         + 0.1191 * x
         - 0.00232;
}

vec3 agx(vec3 col) {
  const float minEv = -12.47393;
  const float maxEv = 4.026069;
  col = AGX_IN * max(col, vec3(0.0));
  col = clamp(log2(col + 1e-10), minEv, maxEv);
  col = (col - minEv) / (maxEv - minEv);
  col = agxDefaultContrast(col);
  col = AGX_OUT * col;
  return max(col, vec3(0.0));
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Interleaved gradient noise: cheap, temporally stable, no texture fetch.
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec2 uv = vUv;
  vec2 d = uv - 0.5;
  float r2 = dot(d, d);

  vec3 scene;
  if (uAberration > 0.0) {
    // Lateral chromatic aberration grows toward the edge, like a real lens.
    vec2 off = d * r2 * uAberration;
    scene.r = texture(uScene, uv + off).r;
    scene.g = texture(uScene, uv).g;
    scene.b = texture(uScene, uv - off).b;
  } else {
    scene = texture(uScene, uv).rgb;
  }

  vec3 bloom = texture(uBloom, uv).rgb;
  vec3 col = scene + bloom * uBloomStrength;
  col *= uExposure;

  col = agx(col);

  // AgX has a long toe by design, which lifts the darkest values into a
  // visible grey. On a panel with true blacks that reads as a grey wash across
  // what should be empty space, so a black point is subtracted and the range
  // renormalised - the display equivalent of setting the pedestal.
  col = max(col - uBlackPoint, vec3(0.0)) / max(1.0 - uBlackPoint, 1e-4);

  float l = luma(col);
  col = mix(vec3(l), col, uSaturation);

  // Gentle vignette; never crushes to a hard ring
  col *= mix(1.0, smoothstep(0.95, 0.15, r2), uVignette);

  // sRGB encode
  col = mix(col * 12.92, 1.055 * pow(max(col, vec3(1e-6)), vec3(1.0 / 2.4)) - 0.055,
            step(vec3(0.0031308), col));

  // Triangular-PDF dither at sub-LSB amplitude: removes OLED banding in the
  // near-black gradients that make up most of this image.
  float n1 = ign(gl_FragCoord.xy + uTime * 11.0);
  float n2 = ign(gl_FragCoord.xy + 71.3 + uTime * 13.0);
  col += ((n1 + n2) - 1.0) / 255.0;

  fragColor = vec4(col, 1.0);
}
`;

class Pass {
  readonly mesh: THREE.Mesh;
  readonly scene = new THREE.Scene();
  readonly material: THREE.RawShaderMaterial;
  static camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(frag: string, uniforms: Record<string, THREE.IUniform>) {
    this.material = new THREE.RawShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: frag,
      uniforms,
      depthTest: false,
      depthWrite: false,
      glslVersion: THREE.GLSL3,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    geo.setDrawRange(0, 3);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }
}

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  bloomLevels?: number;
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;

  exposure = 1.0;
  bloomStrength = 0.9;
  bloomThreshold = 0.65;
  bloomRadius = 1.15;
  vignette = 0.5;
  saturation = 1.06;
  aberration = 0.0018;
  /** Pedestal subtracted after tone mapping so empty space is truly black. */
  blackPoint = 0.014;

  private hdr!: THREE.WebGLRenderTarget;
  private mips: THREE.WebGLRenderTarget[] = [];
  private upMips: THREE.WebGLRenderTarget[] = [];
  private downPass: Pass;
  private upPass: Pass;
  private compositePass: Pass;
  private levels: number;
  private width = 1;
  private height = 1;
  private clock = 0;
  /** True when the context supports float-linear filtering (needed for smooth bloom). */
  readonly hdrCapable: boolean;

  constructor(opts: EngineOptions) {
    this.renderer = new THREE.WebGLRenderer({
      canvas: opts.canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;

    const gl = this.renderer.getContext();
    this.hdrCapable = !!(gl as WebGL2RenderingContext).getExtension('OES_texture_float_linear') ||
      !!(gl as WebGL2RenderingContext).getExtension('EXT_color_buffer_half_float');

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.01, 1e9);
    this.scene = new THREE.Scene();
    this.levels = opts.bloomLevels ?? 6;

    this.downPass = new Pass(DOWN_FRAG, {
      uSrc: { value: null }, uTexel: { value: new THREE.Vector2() },
      uThreshold: { value: 1 }, uKnee: { value: 0.5 }, uFirst: { value: 0 },
    });
    this.upPass = new Pass(UP_FRAG, {
      uSrc: { value: null }, uPrev: { value: null },
      uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 },
    });
    this.compositePass = new Pass(COMPOSITE_FRAG, {
      uScene: { value: null }, uBloom: { value: null },
      uBloomStrength: { value: 1 }, uExposure: { value: 1 },
      uVignette: { value: 0.5 }, uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2() },
      uSaturation: { value: 1 }, uAberration: { value: 0 },
      uBlackPoint: { value: 0.014 },
    });
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    const W = Math.max(2, Math.floor(w * pixelRatio));
    const H = Math.max(2, Math.floor(h * pixelRatio));
    if (W === this.width && H === this.height) return;
    this.width = W; this.height = H;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(W, H, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();

    this.hdr?.dispose();
    const rtOpts: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.LinearSRGBColorSpace,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      generateMipmaps: false,
    };
    this.hdr = new THREE.WebGLRenderTarget(W, H, rtOpts);

    for (const m of this.mips) m.dispose();
    for (const m of this.upMips) m.dispose();
    this.mips = []; this.upMips = [];
    let mw = W, mh = H;
    for (let i = 0; i < this.levels; i++) {
      mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1);
      this.mips.push(new THREE.WebGLRenderTarget(mw, mh, { ...rtOpts, depthBuffer: false }));
      this.upMips.push(new THREE.WebGLRenderTarget(mw, mh, { ...rtOpts, depthBuffer: false }));
      if (mw <= 2 || mh <= 2) { this.levels = i + 1; break; }
    }
  }

  get size(): [number, number] { return [this.width, this.height]; }

  render(dt: number): void {
    this.clock += dt;
    const r = this.renderer;

    // --- Scene into HDR
    r.setRenderTarget(this.hdr);
    r.clear(true, true, true);
    r.render(this.scene, this.camera);

    // --- Bloom downsample chain
    const du = this.downPass.material.uniforms;
    for (let i = 0; i < this.levels; i++) {
      const src = i === 0 ? this.hdr : this.mips[i - 1];
      du.uSrc.value = src.texture;
      (du.uTexel.value as THREE.Vector2).set(1 / src.width, 1 / src.height);
      du.uFirst.value = i === 0 ? 1 : 0;
      du.uThreshold.value = this.bloomThreshold;
      du.uKnee.value = Math.max(1e-4, this.bloomThreshold * 0.6);
      r.setRenderTarget(this.mips[i]);
      r.clear(true, false, false);
      r.render(this.downPass.scene, Pass.camera);
    }

    // --- Upsample chain, accumulating
    const uu = this.upPass.material.uniforms;
    for (let i = this.levels - 1; i >= 0; i--) {
      const src = i === this.levels - 1 ? this.mips[i] : this.upMips[i + 1];
      uu.uSrc.value = src.texture;
      uu.uPrev.value = this.mips[i].texture;
      (uu.uTexel.value as THREE.Vector2).set(1 / src.width, 1 / src.height);
      uu.uRadius.value = this.bloomRadius;
      r.setRenderTarget(this.upMips[i]);
      r.clear(true, false, false);
      r.render(this.upPass.scene, Pass.camera);
    }

    // --- Composite to screen
    const cu = this.compositePass.material.uniforms;
    cu.uScene.value = this.hdr.texture;
    cu.uBloom.value = this.upMips[0].texture;
    cu.uBloomStrength.value = this.bloomStrength / this.levels;
    cu.uExposure.value = this.exposure;
    cu.uVignette.value = this.vignette;
    cu.uSaturation.value = this.saturation;
    cu.uAberration.value = this.aberration;
    cu.uBlackPoint.value = this.blackPoint;
    cu.uTime.value = this.clock;
    (cu.uResolution.value as THREE.Vector2).set(this.width, this.height);
    r.setRenderTarget(null);
    r.clear(true, true, true);
    r.render(this.compositePass.scene, Pass.camera);
  }

  dispose(): void {
    this.hdr?.dispose();
    for (const m of this.mips) m.dispose();
    for (const m of this.upMips) m.dispose();
    this.renderer.dispose();
  }
}
