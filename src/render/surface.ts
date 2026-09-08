/**
 * The view from the ground.
 *
 * Two things are drawn and they are drawn the same way: the air, marched as a
 * volume, and the ground, which is a piece of the planet's own sphere with the
 * same air in front of it. There is no skybox and no fog constant anywhere in
 * here - the colour of the sky, the colour of the star, the haze on the
 * horizon and the light falling on the terrain are all the single-scattering
 * integral through the atmosphere the planet actually has, evaluated in
 * different directions.
 *
 * The one thing worth pointing at is the Chapman function, which appears in
 * both shaders. Getting from a sample in the air to the star means asking how
 * much gas is in the way, and the schoolbook answer - the vertical column
 * times the secant of the zenith angle - is infinite at the horizon. Every
 * sunset happens at the horizon. So the shaders carry the spherical-shell
 * answer instead, which needs the scaled complementary error function, and
 * that is why there is an eight-term Chebyshev polynomial in a sky shader.
 */

import * as THREE from 'three';
import type { Atmosphere } from '../astro/sky';

/**
 * Shared between both shaders: the air, and how far light has come through it.
 */
const ATMO_GLSL = /* glsl */ `
uniform vec3 uBetaR;      // Rayleigh scattering, per metre, per channel
uniform float uBetaM;     // aerosol extinction, per metre, grey
uniform vec3 uAlbedoM;    // what fraction of that it scatters rather than eats
uniform float uHr;        // gas scale height, m
uniform float uHm;        // aerosol scale height, m
uniform float uRadius;    // planet radius, m
uniform float uTop;       // top of the atmosphere, m above the centre
uniform vec3 uSunDir;     // unit vector toward the star, y up
uniform vec3 uSunColor;   // irradiance above the atmosphere, linear
uniform float uG;         // aerosol asymmetry
uniform vec3 uEye;        // observer, planet-centred, m

const float PI = 3.14159265359;

/** Far intersection of a ray with a sphere about the origin, or -1. */
float raySphereFar(vec3 p, vec3 d, float r) {
  float b = dot(p, d);
  float c = dot(p, p) - r * r;
  float disc = b * b - c;
  if (disc < 0.0) return -1.0;
  return -b + sqrt(disc);
}

/** Near intersection, or -1 if there is none in front of you. */
float raySphereNear(vec3 p, vec3 d, float r) {
  float b = dot(p, d);
  float c = dot(p, p) - r * r;
  float disc = b * b - c;
  if (disc < 0.0) return -1.0;
  float t = -b - sqrt(disc);
  return t;
}

/** exp(x^2) erfc(x): Numerical Recipes' fit with the exponential left out. */
float erfcx(float x) {
  float t = 1.0 / (1.0 + 0.5 * abs(x));
  float poly = -1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418
    + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587
    + t * (-0.82215223 + t * 0.17087277))))))));
  float v = t * exp(poly);
  return x >= 0.0 ? v : 2.0 * exp(min(60.0, x * x)) - v;
}

/**
 * Relative air mass through a spherical shell, at cos of the zenith angle.
 * One overhead, sqrt(pi X / 2) at the horizon, and larger below it.
 */
float chapman(float X, float cz) {
  float root = sqrt(PI * X * 0.5);
  float h = sqrt(X * 0.5);
  if (cz >= 0.0) return root * erfcx(h * cz);
  float s = sqrt(max(0.0, 1.0 - cz * cz));
  float g = 2.0 * sqrt(PI * X * s * 0.5) * exp(min(60.0, X * (1.0 - s)));
  return max(root, g - root * erfcx(-h * cz));
}

/** What survives the trip from the star to a point in the air. */
vec3 sunTransmittance(vec3 q) {
  if (raySphereNear(q, uSunDir, uRadius) > 0.0) return vec3(0.0);
  float rq = length(q);
  float hgt = rq - uRadius;
  float cz = dot(q / rq, uSunDir);
  float cr = exp(-hgt / uHr) * uHr * chapman(rq / uHr, cz);
  float cm = exp(-hgt / uHm) * uHm * chapman(rq / uHm, cz);
  return exp(-min(vec3(40.0), uBetaR * cr + uBetaM * cm));
}

/**
 * March a view ray, returning what the air adds and what it takes away.
 *
 * The first output is the light the air sends you; the second is what is left
 * of whatever was behind it. The ground uses both, the sky only the first.
 */
void marchAir(vec3 origin, vec3 dir, float maxDist,
              out vec3 inscatter, out vec3 transmit) {
  float t = raySphereFar(origin, dir, uTop);
  if (t <= 0.0) { inscatter = vec3(0.0); transmit = vec3(1.0); return; }
  float tg = raySphereNear(origin, dir, uRadius);
  if (tg > 0.0) t = min(t, tg);
  t = min(t, maxDist);

  float cosT = dot(dir, uSunDir);
  float pr = 0.0596831 * (1.0 + cosT * cosT);
  float gg = uG * uG;
  float pm = (1.0 - gg) / (12.5663706 * pow(max(1.0 + gg - 2.0 * uG * cosT, 1e-4), 1.5));

  vec3 sum = vec3(0.0);
  vec3 tau = vec3(0.0);
  const int N = 20;
  float ds = t / float(N);
  for (int i = 0; i < N; i++) {
    vec3 q = origin + dir * (float(i) + 0.5) * ds;
    float hgt = max(0.0, length(q) - uRadius);
    float dr = exp(-hgt / uHr);
    float dm = exp(-hgt / uHm);
    vec3 scatter = uBetaR * dr * pr + uBetaM * uAlbedoM * dm * pm;
    sum += scatter * sunTransmittance(q) * exp(-tau) * ds;
    tau += (uBetaR * dr + uBetaM * dm) * ds;
  }
  inscatter = sum * uSunColor;
  transmit = exp(-tau);
}
`;

const SKY_VERT = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
in vec3 position;
out vec3 vDir;
void main() {
  vDir = position;
  // Pinned to the far plane and centred on the eye: this is a direction, not
  // a place.
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
uniform float uExposure;
uniform float uStarAngRad;
uniform vec3 uStarDisc;
uniform float uMulti;
${ATMO_GLSL}

void main() {
  vec3 d = normalize(vDir);
  vec3 inscatter, transmit;
  marchAir(uEye, d, 1e9, inscatter, transmit);

  // The star itself, when you are looking at it: a disc of the right angular
  // size, dimmed and reddened by everything between you and it.
  float ang = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
  if (ang < uStarAngRad * 1.9 && raySphereNear(uEye, d, uRadius) <= 0.0) {
    // Limb darkening, and a soft edge so it does not alias into a polygon.
    float u = clamp(ang / uStarAngRad, 0.0, 2.0);
    float disc = smoothstep(1.06, 0.94, u);
    float limb = 0.42 + 0.58 * sqrt(max(0.0, 1.0 - u * u * 0.96));
    inscatter += uStarDisc * disc * limb * transmit;
  }

  fragColor = vec4(inscatter * uMulti * uExposure, 1.0);
}
`;

const GROUND_VERT = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uPlanetR;
uniform float uRelief;
uniform float uSeed;
uniform float uSeaLevel;
in vec3 position;
out vec3 vWorld;
out vec3 vNormal;
out float vHeight;
out float vSlope;

// Value noise, and enough octaves of it to look like ground.
float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7) + uSeed);
  p += dot(p, p + 34.5);
  return fract(p.x * p.y * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 7; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
float rawTerrain(vec2 p) {
  float base = fbm(p * 0.00035) * 2.0 - 1.0;
  float ridge = 1.0 - abs(fbm(p * 0.0012) * 2.0 - 1.0);
  // Plus something at the scale of the ground you are standing on. The two
  // terms above have nothing finer than about forty metres in them, which is
  // correct for a mountain range and leaves the nearest fifty metres of the
  // view - most of the lower half of the frame - perfectly smooth.
  float near = fbm(p * 0.045) * 2.0 - 1.0;
  return uRelief * (base * 0.75 + ridge * ridge * 0.55 - 0.35) + uRelief * 0.02 * near;
}

/**
 * Terrain height, metres, measured from the observer's feet.
 *
 * Anchored at the origin, because the observer is standing there and the
 * whole scene is built around that: without it the noise puts the ground
 * wherever it likes and the camera ends up buried in it, or - the first time
 * this ran - forty metres under the sea.
 */
float terrain(vec2 p) {
  return rawTerrain(p) - rawTerrain(vec2(0.0));
}

void main() {
  vec2 xz = position.xz;
  float d2 = dot(xz, xz);
  // The planet is round, and over the few kilometres you can see that is a
  // couple of metres of drop - which is the whole reason there is a horizon.
  float curve = -d2 / (2.0 * uPlanetR);
  float h = terrain(xz);
  // Anything under sea level is filled in flat.
  float land = max(h, uSeaLevel);
  vec3 w = vec3(xz.x, curve + land, xz.y);
  vHeight = h;
  // The real surface normal, by central difference. Without it every fragment
  // gets the same light and the whole landscape is one flat wash - which is
  // exactly what it was before this was here.
  float e = max(6.0, uRelief * 0.05);
  vec2 grad = vec2(terrain(xz + vec2(e, 0.0)) - terrain(xz - vec2(e, 0.0)),
                   terrain(xz + vec2(0.0, e)) - terrain(xz - vec2(0.0, e))) / (2.0 * e);
  vSlope = clamp(length(grad) * 3.0, 0.0, 1.0);
  // Water is flat, whatever the rock under it is doing.
  vNormal = h < uSeaLevel ? vec3(0.0, 1.0, 0.0)
    : normalize(vec3(-grad.x, 1.0, -grad.y));
  vWorld = w;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(w, 1.0);
}
`;

const GROUND_FRAG = /* glsl */ `
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in float vHeight;
in float vSlope;
out vec4 fragColor;
uniform vec3 uLow;
uniform vec3 uHigh;
uniform vec3 uWater;
uniform float uSeaLevel;
uniform float uIce;
uniform float uRelief;
uniform float uExposure;
uniform float uEyeH;
uniform float uMulti;
${ATMO_GLSL}

void main() {
  bool wet = vHeight < uSeaLevel;
  // Two frames meet here and they must not be confused. vWorld is metres from
  // the observer's feet with y up; uEye is the same point measured from the
  // centre of the planet, which is six thousand kilometres away. Marching the
  // air between the eye and the ground along the *planet-centred* difference
  // sends the ray through the whole world and paints every rock the colour of
  // the sky.
  vec3 groundP = uEye + vWorld - vec3(0.0, uEyeH, 0.0);
  vec3 toEye = vec3(0.0, uEyeH, 0.0) - vWorld;
  float dist = max(length(toEye), 1e-3);

  vec3 up = normalize(uEye);
  vec3 n = normalize(vNormal);
  // A stronger ramp than the height range alone suggests: over the couple of
  // kilometres you can see, real ground changes colour with what grows on it
  // and what is exposed, not with altitude in metres.
  float band = clamp(vHeight / max(uRelief * 0.55, 1.0) * 0.5 + 0.45, 0.0, 1.0);
  vec3 albedo = wet ? uWater : mix(uLow, uHigh, band);
  if (!wet) albedo = mix(albedo, albedo * 0.62, vSlope);
  // Ice caps and snow, where it is cold enough and high enough.
  float snow = uIce * smoothstep(0.25, 0.62, vHeight / max(uRelief, 1.0));
  albedo = mix(albedo, vec3(0.86, 0.89, 0.95), snow);

  // Light on the ground: the star, through the air, plus the sky itself,
  // which on a hazy world is most of it.
  vec3 sun = sunTransmittance(groundP) * uSunColor * max(0.0, dot(n, uSunDir));
  // The sky as an ambient term: a single upward sample, which is crude and
  // is the difference between a shadowed slope reading as dark grey and
  // reading as black.
  vec3 skyIn, skyT;
  marchAir(groundP, up, 1e9, skyIn, skyT);
  vec3 lit = albedo * (sun + skyIn * 1.9 * uMulti * (0.45 + 0.55 * dot(n, up)));

  if (wet) {
    // A specular track on the water, which is what tells you it is water.
    vec3 h = normalize(toEye / dist + uSunDir);
    float spec = pow(max(dot(n, h), 0.0), 220.0);
    lit += sunTransmittance(groundP) * uSunColor * spec * 1.6;
  }

  // Aerial perspective: the same air, between here and the eye. Distant hills
  // go the colour of the sky because they are behind more of it.
  vec3 inscatter, transmit;
  marchAir(groundP, toEye / dist, dist, inscatter, transmit);
  fragColor = vec4((lit * transmit + inscatter * uMulti) * uExposure, 1.0);
}
`;

export interface SurfaceOptions {
  atmosphere: Atmosphere;
  /** Star irradiance above the atmosphere, linear RGB, 1 = Earth's sunlight. */
  sunColor: [number, number, number];
  /** Angular radius of the star, radians. */
  starAngRad: number;
  /** Eye height above the ground, metres. */
  eyeHeight: number;
  /** Vertical relief of the terrain, metres. */
  relief: number;
  /** How far the terrain is drawn, metres. */
  reach: number;
  seed: number;
  /** Ground colours, linear. */
  low: [number, number, number];
  high: [number, number, number];
  water: [number, number, number];
  /** Fraction of the surface under water, 0 to 1. */
  oceanFraction: number;
  /** How much snow and ice, 0 to 1. */
  ice: number;
  /** Triangles across the terrain disc. */
  detail?: number;
}

export class SurfaceView {
  readonly group = new THREE.Group();
  readonly sky: THREE.Mesh;
  readonly ground: THREE.Mesh;
  private skyMat: THREE.RawShaderMaterial;
  private groundMat: THREE.RawShaderMaterial;
  private a: Atmosphere;

  constructor(o: SurfaceOptions) {
    this.a = o.atmosphere;
    const a = o.atmosphere;
    const top = a.radiusM + Math.max(a.scaleHeightM * 9, a.aerosolScaleHeightM * 14, 1);

    const shared = (): Record<string, THREE.IUniform> => ({
      uBetaR: { value: new THREE.Vector3(...a.betaR) },
      uBetaM: { value: a.betaM },
      uAlbedoM: { value: new THREE.Vector3(...a.aerosolAlbedo) },
      uHr: { value: Math.max(a.scaleHeightM, 1) },
      uHm: { value: Math.max(a.aerosolScaleHeightM, 1) },
      uRadius: { value: a.radiusM },
      uTop: { value: top },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Vector3(...o.sunColor) },
      uG: { value: a.aerosolG },
      uEye: { value: new THREE.Vector3(0, a.radiusM + o.eyeHeight, 0) },
      uExposure: { value: 1 },
      // Single scattering under-reports a bright sky, because the light that
      // has bounced twice is missing and in a thick atmosphere that is most of
      // it. A constant is the usual way to buy it back, and it is a constant
      // rather than a calculation.
      uMulti: { value: 2.6 },
    });

    this.skyMat = new THREE.RawShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      glslVersion: THREE.GLSL3,
      depthWrite: false,
      depthTest: false,
      // Additive, because the air adds its own light to whatever is behind it
      // rather than standing in front of it. Behind it is the starfield, and
      // an opaque sky paints the stars out at midnight.
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      uniforms: {
        ...shared(),
        uStarAngRad: { value: Math.max(o.starAngRad, 1e-5) },
        uStarDisc: { value: new THREE.Vector3(...o.sunColor).multiplyScalar(90) },
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -80;
    this.group.add(this.sky);

    // Where the water is, measured from the observer's feet - so, below them.
    //
    // Choosing an absolute sea level and then dropping the observer at a
    // random place puts them underwater most of the time on an ocean world,
    // which is correct on average and useless to look at. Instead the observer
    // is always on land, and how far the water is below them depends on how
    // much of it there is: an ocean world is seen from its coast, a dry one
    // from a long way above its few remaining seas.
    const seaLevel = o.oceanFraction <= 0.02 ? -1e9
      : o.oceanFraction >= 0.995 ? -o.relief * 0.06
        : -o.relief * (0.10 + 0.34 * (1 - o.oceanFraction));

    const detail = o.detail ?? 320;
    this.groundMat = new THREE.RawShaderMaterial({
      vertexShader: GROUND_VERT,
      fragmentShader: GROUND_FRAG,
      glslVersion: THREE.GLSL3,
      // A ring is built in the XY plane and this one is laid flat into XZ,
      // which reverses its winding: seen from above, every triangle of it is
      // a back face. Rather than reindex thirty-five thousand vertices, draw
      // both sides - the ground is opaque and you only ever see one of them.
      side: THREE.DoubleSide,
      uniforms: {
        ...shared(),
        uPlanetR: { value: a.radiusM },
        uRelief: { value: o.relief },
        uSeed: { value: (o.seed % 1000) / 7.3 },
        uSeaLevel: { value: seaLevel },
        uLow: { value: new THREE.Vector3(...o.low) },
        uHigh: { value: new THREE.Vector3(...o.high) },
        uWater: { value: new THREE.Vector3(...o.water) },
        uIce: { value: o.ice },
        uEyeH: { value: o.eyeHeight },
      },
    });
    // A disc, denser toward the middle: everything past a kilometre is a few
    // pixels tall and everything within ten metres is underfoot.
    const g = new THREE.RingGeometry(0.6, o.reach, 96, detail, 0, Math.PI * 2);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      // RingGeometry lays its rings out linearly in radius; push them out to a
      // power law so the near ground is where the triangles are. Gently: at
      // any real exponent the innermost ring lands within a millimetre of the
      // camera, and a steep one puts every vertex there.
      const x = pos.getX(i), y = pos.getY(i);
      const r = Math.hypot(x, y);
      const k = Math.pow(r / o.reach, 1.6) * o.reach;
      const s = r > 0 ? k / r : 0;
      pos.setXYZ(i, x * s, 0, y * s);
    }
    pos.needsUpdate = true;
    g.computeBoundingSphere();
    this.ground = new THREE.Mesh(g, this.groundMat);
    this.ground.frustumCulled = false;
    this.group.add(this.ground);
  }

  /** Point the star, in the local frame where +y is up. */
  setSun(dir: THREE.Vector3, color: [number, number, number]): void {
    for (const m of [this.skyMat, this.groundMat]) {
      (m.uniforms.uSunDir.value as THREE.Vector3).copy(dir).normalize();
      (m.uniforms.uSunColor.value as THREE.Vector3).set(...color);
    }
    (this.skyMat.uniforms.uStarDisc.value as THREE.Vector3)
      .set(...color).multiplyScalar(90);
  }

  setExposure(v: number): void {
    this.skyMat.uniforms.uExposure.value = v;
    this.groundMat.uniforms.uExposure.value = v;
  }

  /** How much of the missing multiply-scattered light to put back. */
  setMultiScatter(v: number): void {
    this.skyMat.uniforms.uMulti.value = v;
    this.groundMat.uniforms.uMulti.value = v;
  }

  /** Where the eye is, so the sky knows how much air is over it. */
  setEyeHeight(h: number): void {
    for (const m of [this.skyMat, this.groundMat]) {
      (m.uniforms.uEye.value as THREE.Vector3).set(0, this.a.radiusM + h, 0);
    }
    this.groundMat.uniforms.uEyeH.value = h;
  }

  dispose(): void {
    this.sky.geometry.dispose();
    this.ground.geometry.dispose();
    this.skyMat.dispose();
    this.groundMat.dispose();
  }
}
