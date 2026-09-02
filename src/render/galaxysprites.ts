/**
 * Galaxies at a distance.
 *
 * A cluster holds hundreds of galaxies. Building each one from half a million
 * star sprites is out of the question, so at cluster scale every galaxy is a
 * single instanced quad whose fragment shader draws it analytically: an
 * exponential disc with logarithmic-spiral arms and a Sersic bulge for a
 * spiral, a de Vaucouleurs profile for an elliptical, each with its own
 * inclination, position angle, colour and dust. Hundreds of distinct galaxies
 * for a handful of draw calls, and every one of them corresponds to a real
 * entry in the universe's object graph that you can fly into.
 */

import * as THREE from 'three';

const VERT = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uPixPerRad;

in vec3 position;         // quad corner in [-1,1]
in vec3 aPos;             // galaxy centre, world units
in vec4 aShape;           // radius, inclination, position angle, arm pitch
in vec4 aStyle;           // type (0 spiral 1 elliptical 2 irregular), arms, dust, bulge
in vec4 aColor;           // rgb + brightness

out vec2 vUv;
out vec4 vShape;
out vec4 vStyle;
out vec4 vColor;
out float vSize;

void main() {
  vUv = position.xy;
  vShape = aShape;
  vStyle = aStyle;
  vColor = aColor;

  vec4 centre = modelViewMatrix * vec4(aPos, 1.0);
  float dist = max(-centre.z, 1e-6);
  // Draw the quad a little larger than the galaxy so the halo has room
  float world = aShape.x * 2.6;
  centre.xy += position.xy * world;
  gl_Position = projectionMatrix * centre;
  vSize = world * uPixPerRad / dist;
}
`;

const FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
in vec4 vShape;
in vec4 vStyle;
in vec4 vColor;
in float vSize;
out vec4 fragColor;

const float PI = 3.14159265359;

float sersic(float r, float re, float n) {
  // b_n from Ciotti & Bertin's asymptotic expansion
  float bn = 2.0 * n - 0.327 + 4.0 / (405.0 * n);
  return exp(-bn * (pow(max(r / re, 1e-5), 1.0 / n) - 1.0));
}

void main() {
  // Undo the quad padding: the galaxy's own radius is 1 in this space
  vec2 p = vUv * 2.6;

  float incl = vShape.y;
  float pa = vShape.z;
  float tanPitch = max(vShape.w, 0.02);
  float type = vStyle.x;
  float arms = vStyle.y;
  float dust = vStyle.z;
  float bulgeFrac = vStyle.w;

  // Rotate into the galaxy's frame, then stretch by cos(inclination) to turn
  // the circular disc into the ellipse a tilted disc projects to.
  float cs = cos(pa), sn = sin(pa);
  vec2 q = vec2(p.x * cs + p.y * sn, -p.x * sn + p.y * cs);
  float ci = max(cos(incl), 0.06);
  vec2 d = vec2(q.x, q.y / ci);
  float r = length(d);
  if (r > 3.0) discard;

  float I = 0.0;
  vec3 tint = vColor.rgb;

  if (type < 0.5) {
    // ---- spiral: exponential disc + arms + bulge
    float disc = exp(-r / 0.42);
    float ang = atan(d.y, d.x);
    float phase = ang - log(max(r, 0.02) / 0.14) / tanPitch;
    float arm = 0.5 + 0.5 * cos(phase * arms);
    float armAmp = smoothstep(0.02, 0.16, r) * smoothstep(1.5, 0.5, r);
    disc *= 1.0 + 1.5 * pow(arm, 2.2) * armAmp;
    // Dust lane just inside the stellar arm
    float lane = pow(0.5 + 0.5 * cos(phase * arms - 0.6), 6.0) * armAmp;
    disc *= 1.0 - dust * 0.45 * lane;
    // Arms are blue; the disc between them and the bulge are not
    tint = mix(vColor.rgb, vec3(0.55, 0.68, 1.0), pow(arm, 3.0) * armAmp * 0.55);

    float bulge = sersic(r, 0.10, 2.5) * bulgeFrac * 2.2;
    tint = mix(tint, vec3(1.0, 0.84, 0.62), clamp(bulge * 1.4, 0.0, 0.8));
    I = disc + bulge;
    // Thin discs seen edge-on are brighter per unit area and show a dust line
    I *= mix(1.0, 1.0 / max(ci, 0.12) * 0.42, smoothstep(0.6, 1.45, incl));
    float edgeLane = exp(-pow(q.y / (0.045 + 0.02 * ci), 2.0)) * smoothstep(0.9, 1.45, incl);
    I *= 1.0 - dust * 0.7 * edgeLane;
  } else if (type < 1.5) {
    // ---- elliptical: de Vaucouleurs, smooth and red
    I = sersic(r, 0.30, 4.0) * 1.15;
    tint = mix(vColor.rgb, vec3(1.0, 0.80, 0.58), 0.55);
  } else {
    // ---- irregular: clumpy and blue
    float base = exp(-r / 0.5);
    float lumps = 0.0;
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      vec2 c = vec2(sin(fi * 12.9898 + vColor.a * 7.0), cos(fi * 78.233 + vColor.a * 3.0)) * 0.42;
      lumps += exp(-dot(d - c, d - c) * 26.0);
    }
    I = base * (0.5 + lumps);
    tint = mix(vColor.rgb, vec3(0.6, 0.75, 1.0), 0.4);
  }

  // Sub-pixel galaxies must dim rather than alias into sparkle.
  float resolved = clamp(vSize / 3.0, 0.0, 1.0);
  I *= mix(resolved * resolved, 1.0, step(3.0, vSize));

  float a = I * vColor.a;
  if (a < 0.0005) discard;
  fragColor = vec4(tint * a, 1.0);
}
`;

export interface GalaxySpriteData {
  x: number; y: number; z: number;
  /** Visual radius in world units. */
  radius: number;
  /** 0 spiral, 1 elliptical, 2 irregular. */
  type: number;
  arms: number;
  pitch: number;
  dust: number;
  bulge: number;
  inclination: number;
  positionAngle: number;
  color: [number, number, number];
  brightness: number;
}

export class GalaxySprites {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.RawShaderMaterial;

  constructor(data: GalaxySpriteData[]) {
    const n = data.length;
    const pos = new Float32Array(n * 3);
    const shape = new Float32Array(n * 4);
    const style = new Float32Array(n * 4);
    const color = new Float32Array(n * 4);
    let maxR = 1;
    for (let i = 0; i < n; i++) {
      const d = data[i];
      pos[i * 3] = d.x; pos[i * 3 + 1] = d.y; pos[i * 3 + 2] = d.z;
      shape[i * 4] = d.radius;
      shape[i * 4 + 1] = d.inclination;
      shape[i * 4 + 2] = d.positionAngle;
      shape[i * 4 + 3] = Math.tan(d.pitch);
      style[i * 4] = d.type;
      style[i * 4 + 1] = d.arms;
      style[i * 4 + 2] = d.dust;
      style[i * 4 + 3] = d.bulge;
      color[i * 4] = d.color[0]; color[i * 4 + 1] = d.color[1];
      color[i * 4 + 2] = d.color[2]; color[i * 4 + 3] = d.brightness;
      maxR = Math.max(maxR, Math.hypot(d.x, d.y, d.z) + d.radius * 3);
    }

    this.geo = new THREE.InstancedBufferGeometry();
    const quad = new Float32Array([
      -1, -1, 0, 1, -1, 0, 1, 1, 0,
      -1, -1, 0, 1, 1, 0, -1, 1, 0,
    ]);
    this.geo.setAttribute('position', new THREE.BufferAttribute(quad, 3));
    this.geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 3));
    this.geo.setAttribute('aShape', new THREE.InstancedBufferAttribute(shape, 4));
    this.geo.setAttribute('aStyle', new THREE.InstancedBufferAttribute(style, 4));
    this.geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(color, 4));
    this.geo.instanceCount = n;
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), maxR);

    this.mat = new THREE.RawShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      glslVersion: THREE.GLSL3,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      uniforms: { uPixPerRad: { value: 800 } },
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
  }

  setViewport(heightPx: number, fovDeg: number): void {
    this.mat.uniforms.uPixPerRad.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  dispose(): void { this.geo.dispose(); this.mat.dispose(); }
}
