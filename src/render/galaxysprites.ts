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
in vec2 aLife;            // gas left 0-1, how hard it is being stripped 0-1
in vec3 aVel;             // motion through the cluster, world units

out vec2 vUv;
out vec4 vShape;
out vec4 vStyle;
out vec4 vColor;
out float vSize;
out float vGas;
out float vStrip;
out vec2 vWind;
out float vPad;

void main() {
  vShape = aShape;
  vStyle = aStyle;
  vColor = aColor;
  vGas = aLife.x;
  vStrip = aLife.y;

  vec4 centre = modelViewMatrix * vec4(aPos, 1.0);
  float dist = max(-centre.z, 1e-6);
  // A galaxy losing its gas trails it behind, so it needs a bigger canvas.
  // Only the ones actually being stripped pay for the extra fill.
  vPad = 2.6 + 7.0 * vStrip;
  vUv = position.xy * vPad;
  float world = aShape.x * vPad;
  centre.xy += position.xy * world;
  gl_Position = projectionMatrix * centre;
  vSize = aShape.x * 2.6 * uPixPerRad / dist;

  // Which way the wind blows, in the plane of the screen. The galaxy is not
  // moving through a still medium and being blown on - it is ploughing into a
  // still medium, so the wind it feels is its own motion reversed, and the
  // tail streams out behind it. Projected into the screen plane because the
  // quad is a billboard and that is the only plane it has.
  vec2 vView = (mat3(modelViewMatrix) * aVel).xy;
  float len = length(vView);
  vWind = len > 1e-9 ? -vView / len : vec2(0.0, -1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
in vec4 vShape;
in vec4 vStyle;
in vec4 vColor;
in float vSize;
in float vGas;
in float vStrip;
in vec2 vWind;
in float vPad;
out vec4 fragColor;

const float PI = 3.14159265359;

float sersic(float r, float re, float n) {
  // b_n from Ciotti & Bertin's asymptotic expansion
  float bn = 2.0 * n - 0.327 + 4.0 / (405.0 * n);
  return exp(-bn * (pow(max(r / re, 1e-5), 1.0 / n) - 1.0));
}

void main() {
  // vUv already carries the padding, so the galaxy's own radius is 1 here
  vec2 p = vUv;

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
  float edge = smoothstep(vPad, vPad * 0.76, length(p));

  float I = 0.0;
  vec3 tint = vColor.rgb;

  // ---- the tail
  //
  // A galaxy crossing a cluster core at two thousand kilometres a second
  // leaves its own gas behind it in a streamer that can be longer than the
  // galaxy is wide, lit by the stars that form inside it on the way out.
  // These are the jellyfish galaxies, and they are the moment of stripping
  // caught in the act: they only exist for the few hundred megayears it
  // takes, which is why they are rare and why every one of them is near a
  // cluster centre.
  vec3 tail = vec3(0.0);
  if (vStrip > 0.01) {
    float along = dot(p, vWind);
    vec2 side = p - along * vWind;
    float lat = length(side);
    if (along > 0.0) {
      // Widens downstream as the stripped gas expands into the wind, and
      // wanders: the stream is not a straight line, it is being pushed.
      float w = 0.26 + 0.40 * along;
      float sway = 0.10 * sin(along * 1.7 + vColor.a * 19.0)
                 + 0.05 * sin(along * 3.9 + vColor.a * 5.0);
      float u = (lat + sway * along) / w;
      float lane = exp(-u * u);
      float fade = exp(-along * 0.66) * smoothstep(0.0, 0.30, along);
      // Knots of new stars condensing in the stream. Warped rather than
      // separable, because two multiplied sines make a lattice and a lattice
      // is the one thing gas never does.
      float warp = sin(along * 2.3 + u * 2.7 + vColor.a * 7.0);
      float knot = 0.5 + 0.5 * sin(along * 5.1 + 1.9 * warp + vColor.a * 13.0);
      float amp = lane * fade * vStrip * (0.45 + 0.85 * knot);
      // Hydrogen alpha is what these tails are found in: pink, with the blue
      // of the stars that have just formed in the densest knots.
      tail = mix(vec3(0.95, 0.38, 0.58), vec3(0.58, 0.74, 1.0), knot * 0.6) * amp * 0.45;
    }
  }
  if (r > 3.0) {
    tail *= edge;
    if (dot(tail, tail) < 1e-8) discard;
    fragColor = vec4(tail * vColor.a, 1.0);
    return;
  }

  if (type < 0.5) {
    // ---- spiral: exponential disc + arms + bulge
    float disc = exp(-r / 0.42);
    float ang = atan(d.y, d.x);
    float phase = ang - log(max(r, 0.02) / 0.14) / tanPitch;
    float arm = 0.5 + 0.5 * cos(phase * arms);
    float armAmp = smoothstep(0.02, 0.16, r) * smoothstep(1.5, 0.5, r);
    // The arms are where the gas is. Take the gas away and the spiral
    // structure goes with it, leaving a smooth red disc: an anaemic spiral,
    // which is most of what a cluster core contains.
    float live = vGas;
    disc *= 1.0 + 1.5 * live * pow(arm, 2.2) * armAmp;
    // Dust lane just inside the stellar arm
    float lane = pow(0.5 + 0.5 * cos(phase * arms - 0.6), 6.0) * armAmp;
    dust *= live;
    disc *= 1.0 - dust * 0.45 * lane;
    // Arms are blue; the disc between them and the bulge are not
    tint = mix(vColor.rgb, vec3(0.55, 0.68, 1.0), pow(arm, 3.0) * armAmp * 0.55 * live);
    // And the whole population reddens once it stops making blue stars
    tint = mix(vec3(1.0, 0.72, 0.48), tint, 0.35 + 0.65 * live);

    float bulge = sersic(r, 0.10, 2.5) * bulgeFrac * 2.2;
    tint = mix(tint, vec3(1.0, 0.84, 0.62), clamp(bulge * 1.4, 0.0, 0.8));
    I = disc + bulge;
    // Thin discs seen edge-on are brighter per unit area and show a dust line
    I *= mix(1.0, 1.0 / max(ci, 0.12) * 0.42, smoothstep(0.6, 1.45, incl));
    float edgeLane = exp(-pow(q.y / (0.045 + 0.02 * ci), 2.0)) * smoothstep(0.9, 1.45, incl);
    I *= 1.0 - dust * 0.7 * edgeLane;
    // A disc that has stopped forming stars fades: the blue light was most of
    // what you were seeing, and it is the first thing to go.
    I *= mix(0.62, 1.0, live);
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
    I = base * (0.5 + lumps * vGas);
    tint = mix(mix(vec3(1.0, 0.74, 0.52), vColor.rgb, 0.3 + 0.7 * vGas),
               vec3(0.6, 0.75, 1.0), 0.4 * vGas);
    I *= mix(0.5, 1.0, vGas);
  }

  // Sub-pixel galaxies must dim rather than alias into sparkle.
  float resolved = clamp(vSize / 3.0, 0.0, 1.0);
  I *= mix(resolved * resolved, 1.0, step(3.0, vSize));

  // Fade to nothing on the inscribed circle of the quad. A de Vaucouleurs
  // profile still has measurable light at the quad's edge, and cutting it off
  // there draws a bright rectangle around every large elliptical - the shape
  // of the polygon it is being drawn on, which is the one thing that must
  // never be visible.
  I *= edge;
  tail *= edge;

  float a = I * vColor.a;
  vec3 rgb = tint * a + tail * vColor.a;
  if (a < 0.0005 && dot(tail, tail) < 1e-8) discard;
  fragColor = vec4(rgb, 1.0);
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
  /** Star-forming gas remaining, 1 to 0. Defaults by type. */
  gas?: number;
}

export class GalaxySprites {
  readonly mesh: THREE.Mesh;
  readonly count: number;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.RawShaderMaterial;
  /** Live per-galaxy buffers, written every frame by the cluster's dynamics. */
  private posArr: Float32Array;
  private velArr: Float32Array;
  private lifeArr: Float32Array;
  private posAttr: THREE.InstancedBufferAttribute;
  private velAttr: THREE.InstancedBufferAttribute;
  private lifeAttr: THREE.InstancedBufferAttribute;

  constructor(data: GalaxySpriteData[]) {
    const n = data.length;
    this.count = n;
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    const life = new Float32Array(n * 2);
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
      life[i * 2] = d.gas ?? (d.type < 0.5 || d.type >= 1.5 ? 1 : 0);
      life[i * 2 + 1] = 0;
      maxR = Math.max(maxR, Math.hypot(d.x, d.y, d.z) + d.radius * 3);
    }

    this.geo = new THREE.InstancedBufferGeometry();
    const quad = new Float32Array([
      -1, -1, 0, 1, -1, 0, 1, 1, 0,
      -1, -1, 0, 1, 1, 0, -1, 1, 0,
    ]);
    this.geo.setAttribute('position', new THREE.BufferAttribute(quad, 3));
    this.posArr = pos;
    this.velArr = vel;
    this.lifeArr = life;
    this.posAttr = new THREE.InstancedBufferAttribute(pos, 3);
    this.velAttr = new THREE.InstancedBufferAttribute(vel, 3);
    this.lifeAttr = new THREE.InstancedBufferAttribute(life, 2);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.velAttr.setUsage(THREE.DynamicDrawUsage);
    this.lifeAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aPos', this.posAttr);
    this.geo.setAttribute('aVel', this.velAttr);
    this.geo.setAttribute('aLife', this.lifeAttr);
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

  /**
   * Move one galaxy, and say how it is doing.
   *
   * @param gas    how much of its star-forming gas is left, 1 to 0
   * @param strip  how hard it is being stripped right now, for the tail
   */
  setState(
    i: number, x: number, y: number, z: number,
    vx: number, vy: number, vz: number, gas: number, strip: number,
  ): void {
    this.posArr[i * 3] = x; this.posArr[i * 3 + 1] = y; this.posArr[i * 3 + 2] = z;
    this.velArr[i * 3] = vx; this.velArr[i * 3 + 1] = vy; this.velArr[i * 3 + 2] = vz;
    this.lifeArr[i * 2] = gas;
    this.lifeArr[i * 2 + 1] = strip;
  }

  /** Hand this frame's positions to the GPU. */
  commit(): void {
    this.posAttr.needsUpdate = true;
    this.velAttr.needsUpdate = true;
    this.lifeAttr.needsUpdate = true;
  }

  setViewport(heightPx: number, fovDeg: number): void {
    this.mat.uniforms.uPixPerRad.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  dispose(): void { this.geo.dispose(); this.mat.dispose(); }
}
