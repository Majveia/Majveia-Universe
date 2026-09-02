/**
 * A point cloud whose positions change every frame.
 *
 * Used wherever particles are being integrated rather than evaluated - a galaxy
 * collision, a supernova remnant, a debris stream. Positions live in a dynamic
 * buffer that is re-uploaded each step; colour, size and brightness are static
 * per particle and uploaded once.
 */

import * as THREE from 'three';

const VERT = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uSize;
uniform float uBrightness;
uniform float uFadeNear;
uniform float uFadeFar;

in vec3 position;
in vec3 aColor;
in vec2 aStyle;   // x: relative size, y: relative brightness

out vec3 vColor;
out float vAlpha;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(-mv.z, 1e-6);
  gl_Position = projectionMatrix * mv;

  float size = uSize * aStyle.x;
  gl_PointSize = clamp(size, 0.7, 26.0);

  float a = uBrightness * aStyle.y;
  // Flux conservation below a pixel, so a receding cloud dims rather than
  // dissolving into sparkle.
  float sub = clamp(size / 1.4, 0.0, 1.0);
  a *= mix(sub * sub, 1.0, step(1.4, size));
  if (uFadeFar > 0.0) a *= 1.0 - smoothstep(uFadeNear, uFadeFar, dist);

  vColor = aColor;
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
  fragColor = vec4(vColor * (exp(-r2 * 3.4) * vAlpha), 1.0);
}
`;

export class PointCloud {
  readonly points: THREE.Points;
  readonly positions: Float32Array;
  private geo: THREE.BufferGeometry;
  private mat: THREE.RawShaderMaterial;
  private posAttr: THREE.BufferAttribute;
  private colorAttr: THREE.BufferAttribute;
  private styleAttr: THREE.BufferAttribute;
  readonly colors: Float32Array;
  readonly style: Float32Array;

  constructor(capacity: number, colors: Float32Array, style: Float32Array) {
    this.positions = new Float32Array(capacity * 3);
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.colors = colors;
    this.style = style;
    this.colorAttr = new THREE.BufferAttribute(colors, 3);
    this.styleAttr = new THREE.BufferAttribute(style, 2);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.styleAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aColor', this.colorAttr);
    this.geo.setAttribute('aStyle', this.styleAttr);
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.mat = new THREE.RawShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      glslVersion: THREE.GLSL3,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uSize: { value: 1.8 },
        uBrightness: { value: 1 },
        uFadeNear: { value: 0 },
        uFadeFar: { value: 0 },
      },
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
  }

  /** Copy from a Float64Array of xyz triples, optionally scaling. */
  updateFrom(src: Float64Array, count: number, scale = 1): void {
    const p = this.positions;
    for (let i = 0; i < count * 3; i++) p[i] = src[i] * scale;
    this.posAttr.needsUpdate = true;
    this.geo.setDrawRange(0, count);
  }

  /** Re-upload colour and style after writing into the exposed arrays. */
  touchAppearance(): void {
    this.colorAttr.needsUpdate = true;
    this.styleAttr.needsUpdate = true;
  }

  /** Write positions directly from a Float32Array of xyz triples. */
  setPositions(count: number): void {
    this.posAttr.needsUpdate = true;
    this.geo.setDrawRange(0, count);
  }

  setCount(n: number): void { this.geo.setDrawRange(0, n); }
  setSize(v: number): void { this.mat.uniforms.uSize.value = v; }
  setBrightness(v: number): void { this.mat.uniforms.uBrightness.value = v; }
  setFade(near: number, far: number): void {
    this.mat.uniforms.uFadeNear.value = near;
    this.mat.uniforms.uFadeFar.value = far;
  }

  dispose(): void { this.geo.dispose(); this.mat.dispose(); }
}
