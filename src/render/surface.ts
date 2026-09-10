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
uniform float uFeature;   // how far apart the big landforms are, m
uniform float uFlat;      // radius of the level patch you are standing on, m
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
  // Landform spacing scales with how far you can see. A fixed wavelength in
  // metres puts three mountain ranges in an Earth view and less than one in
  // the view from a small moon, where the horizon is two kilometres off.
  float k = 1.0 / max(uFeature, 1.0);
  float base = fbm(p * k) * 2.0 - 1.0;
  float ridge = 1.0 - abs(fbm(p * k * 3.4) * 2.0 - 1.0);
  // Plus something at the scale of the ground you are standing on. The two
  // terms above have nothing finer than about forty metres in them, which is
  // correct for a mountain range and leaves the nearest fifty metres of the
  // view - most of the lower half of the frame - perfectly smooth.
  //
  // Capped in metres rather than scaled with the relief: on a rugged little
  // moon a fixed fraction of a kilometre of relief puts twenty-metre boulders
  // at your feet, and from eye level a twenty-metre boulder twenty metres away
  // fills half the sky.
  float near = fbm(p * 0.07) * 2.0 - 1.0;
  return uRelief * (base * 0.75 + ridge * ridge * 0.55 - 0.35)
    + min(uRelief * 0.02, 2.5) * near;
}

/**
 * Terrain height, metres, measured from the observer's feet.
 *
 * Anchored at the origin, because the observer is standing there and the whole
 * scene is built around that: without it the noise puts the ground wherever it
 * likes and the camera ends up buried in it, or - the first time this ran -
 * forty metres under the sea.
 *
 * And levelled for the first hundred metres or so. Anchoring the *origin* is
 * not enough: the camera orbits a few tens of metres out, and on a small world
 * with steep relief the ground there can easily be higher than the camera is,
 * which puts the eye inside a hill and fills the screen with the underside of
 * the landscape. A level patch to stand on fixes it, and every landing site
 * ever chosen was chosen for being one.
 */
float terrain(vec2 p) {
  float h = rawTerrain(p) - rawTerrain(vec2(0.0));
  return h * smoothstep(uFlat, uFlat * 3.0, length(p));
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


/**
 * Moons.
 *
 * A disc at the angular size its distance gives it, lit from wherever the star
 * actually is. The phase is not a texture or a mask: each fragment of the disc
 * is a point on a sphere, its normal is reconstructed from where it sits on
 * that disc, and it is lit or not according to whether that normal faces the
 * star. So the terminator is a real ellipse that opens and closes over the
 * month, the horns point away from the star the way they do, and a moon near
 * the star in the sky is a thin crescent because it genuinely is one.
 */
const MOON_VERT = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uDist;
in vec3 position;      // quad corner in [-1,1]
in vec3 aDir;          // unit vector to the body, local frame
in float aAng;         // angular radius, radians
in vec3 aLight;        // star direction in the disc's own frame
in vec3 aColor;        // colour, already dimmed by the air it is seen through
in vec4 aStyle;        // banded?, quad padding, seed, ring opacity
in vec3 aRing;         // inner and outer radius in body radii, sin of the opening
out vec2 vUv;
out vec3 vLight;
out vec3 vColor;
out vec4 vStyle;
out vec3 vRing;
void main() {
  // The quad is padded out past the body itself when there are rings to fit
  // into it - Saturn's reach two and a third times its own radius.
  vUv = position.xy * aStyle.y;
  vLight = aLight;
  vColor = aColor;
  vStyle = aStyle;
  vRing = aRing;
  vec3 f = normalize(aDir);
  vec3 r = normalize(cross(abs(f.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0), f));
  vec3 u = cross(f, r);
  float half_ = uDist * tan(max(aAng, 1e-6)) * aStyle.y;
  vec3 p = f * uDist + r * (position.x * half_) + u * (position.y * half_);
  mat4 mv = modelViewMatrix;
  mv[3].xyz = vec3(0.0);
  gl_Position = projectionMatrix * mv * vec4(p, 1.0);
}
`;

const MOON_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
in vec3 vLight;
in vec3 vColor;
in vec4 vStyle;
in vec3 vRing;
out vec4 fragColor;

float hash1(float n) { return fract(sin(n) * 43758.5453); }

void main() {
  float r2 = dot(vUv, vUv);
  float r = sqrt(r2);
  vec3 L = normalize(vLight);
  vec3 col = vec3(0.0);
  float any = 0.0;

  // ---- the rings
  //
  // A moon orbits in its planet's equatorial plane, which is the plane the
  // rings are in, so from down there they are almost exactly edge-on: not the
  // poster view, a razor line drawn through the middle of the planet and out
  // both sides. The opening angle is how far the moon's own orbit is tilted
  // out of that plane, and it is usually a fraction of a degree.
  if (vRing.y > vRing.x && vStyle.w > 0.0) {
    float sn = max(vRing.z, 0.004);
    float rr = length(vec2(vUv.x, vUv.y / sn));
    if (rr > vRing.x && rr < vRing.y) {
      // Gaps: a ring system is not a disc, it is thousands of ringlets.
      float band = 0.55 + 0.45 * sin(rr * 34.0 + hash1(vStyle.z) * 20.0);
      band *= 0.7 + 0.3 * sin(rr * 91.0);
      // The near half passes in front of the planet; the far half goes behind
      // it, and the planet's own shadow falls across it there.
      bool infront = vUv.y < 0.0;
      float shade = (!infront && r2 < 1.0) ? 0.0 : 1.0;
      // Backlit ice is brilliant: forward scattering through the particles is
      // why the rings blaze when the Sun is behind them.
      float fwd = 0.55 + 1.9 * pow(max(0.0, -L.z), 3.0);
      float a = vStyle.w * band * shade * fwd;
      if (infront || r2 > 1.0) {
        col += vec3(0.95, 0.92, 0.86) * a * 0.5;
        any = max(any, a);
      }
    }
  }

  // ---- the body
  if (r2 <= 1.0) {
    // The point of the sphere this pixel is looking at, and whether the star
    // can see it too.
    vec3 n = vec3(vUv, sqrt(max(0.0, 1.0 - r2)));
    float lit = max(0.0, dot(n, L));
    // Regolith backscatters: a full moon is far brighter than twice a half
    // one, which Lambert does not predict. This is the cheap version of that.
    lit = pow(lit, 0.62);
    vec3 tint = vColor;
    if (vStyle.x > 0.5) {
      // A giant is banded, because it has no surface to stop the zonal winds
      // and the Coriolis force tears the flow into stripes. The bands run
      // along its latitudes, and the moon looking at it sits in its equatorial
      // plane, so they run across the disc.
      float lat = asin(clamp(n.y, -1.0, 1.0));
      float sd = hash1(vStyle.z) * 40.0;
      float b = sin(lat * 7.0 + sd) * 0.5 + 0.5 * sin(lat * 17.0 + sd * 1.7);
      b += 0.25 * sin(lat * 31.0 + sd * 0.3);
      tint *= 0.78 + 0.42 * smoothstep(-0.6, 0.6, b);
      // Polar hoods, and a limb that darkens the way a deep atmosphere does.
      tint *= 1.0 - 0.22 * smoothstep(0.55, 1.0, abs(n.y));
      lit *= 0.55 + 0.45 * n.z;
    }
    float edge = smoothstep(1.0, 0.985, r);
    col += tint * lit * edge;
    any = max(any, lit * edge);
  }

  if (any < 1e-5) discard;
  fragColor = vec4(col, 1.0);
}
`;

/** One moon, as the sky sees it. */
export interface MoonDisc {
  /** Unit vector toward it in the local frame, y up. */
  dir: [number, number, number];
  /** Angular radius, radians. */
  angRad: number;
  /** Star direction in the disc's frame: x right, y up, z toward the viewer. */
  light: [number, number, number];
  /** Colour and brightness, already attenuated by the air in the way. */
  color: [number, number, number];
  /** True for a banded giant rather than a rock. */
  banded?: boolean;
  /** A seed, so two giants in one sky do not have identical stripes. */
  seed?: number;
  /** Rings: inner and outer radius in body radii, and how open they are. */
  ring?: { inner: number; outer: number; sinOpening: number; opacity: number };
}

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
  /** How many moons the sky may need to hold. */
  moons?: number;
}

export class SurfaceView {
  readonly group = new THREE.Group();
  readonly sky: THREE.Mesh;
  readonly ground: THREE.Mesh;
  readonly moons?: THREE.Mesh;
  private skyMat: THREE.RawShaderMaterial;
  private groundMat: THREE.RawShaderMaterial;
  private moonMat?: THREE.RawShaderMaterial;
  private moonGeo?: THREE.InstancedBufferGeometry;
  private moonDir?: Float32Array;
  private moonAng?: Float32Array;
  private moonLight?: Float32Array;
  private moonColor?: Float32Array;
  private moonStyle?: Float32Array;
  private moonRing?: Float32Array;
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
        uFeature: { value: Math.max(200, o.reach * 0.30) },
        uFlat: { value: Math.max(60, o.reach * 0.012) },
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

    const nm = o.moons ?? 0;
    if (nm > 0) {
      this.moonDir = new Float32Array(nm * 3);
      this.moonAng = new Float32Array(nm);
      this.moonLight = new Float32Array(nm * 3);
      this.moonColor = new Float32Array(nm * 3);
      this.moonStyle = new Float32Array(nm * 4);
      this.moonRing = new Float32Array(nm * 3);
      const mg = new THREE.InstancedBufferGeometry();
      mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0,
      ]), 3));
      const dyn = (arr: Float32Array, n: number) => {
        const a2 = new THREE.InstancedBufferAttribute(arr, n);
        a2.setUsage(THREE.DynamicDrawUsage);
        return a2;
      };
      mg.setAttribute('aDir', dyn(this.moonDir, 3));
      mg.setAttribute('aAng', dyn(this.moonAng, 1));
      mg.setAttribute('aLight', dyn(this.moonLight, 3));
      mg.setAttribute('aColor', dyn(this.moonColor, 3));
      mg.setAttribute('aStyle', dyn(this.moonStyle, 4));
      mg.setAttribute('aRing', dyn(this.moonRing, 3));
      mg.instanceCount = nm;
      this.moonGeo = mg;
      this.moonMat = new THREE.RawShaderMaterial({
        vertexShader: MOON_VERT,
        fragmentShader: MOON_FRAG,
        glslVersion: THREE.GLSL3,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        // The disc's basis is built from the direction *away* from the eye, so
        // its triangles wind the wrong way round when seen from the eye. Same
        // trap as the ground; same answer.
        side: THREE.DoubleSide,
        uniforms: { uDist: { value: 3e5 } },
      });
      const mesh = new THREE.Mesh(mg, this.moonMat);
      mesh.frustumCulled = false;
      // After the sky, before the ground: the air is behind them and the
      // landscape in front.
      mesh.renderOrder = -70;
      (this as { moons?: THREE.Mesh }).moons = mesh;
      this.group.add(mesh);
    }
  }

  /** Put this frame's moons in the sky. */
  setMoons(list: MoonDisc[]): void {
    if (!this.moonGeo || !this.moonDir || !this.moonAng || !this.moonLight
      || !this.moonColor || !this.moonStyle || !this.moonRing) return;
    const n = Math.min(list.length, this.moonAng.length);
    for (let i = 0; i < n; i++) {
      const m = list[i];
      this.moonDir.set(m.dir, i * 3);
      this.moonAng[i] = m.angRad;
      this.moonLight.set(m.light, i * 3);
      this.moonColor.set(m.color, i * 3);
      // The quad has to reach past the body far enough to hold its rings.
      const pad = m.ring ? Math.max(1.06, m.ring.outer * 1.06) : 1.06;
      this.moonStyle.set(
        [m.banded ? 1 : 0, pad, m.seed ?? 0, m.ring?.opacity ?? 0], i * 4,
      );
      this.moonRing.set(
        m.ring ? [m.ring.inner, m.ring.outer, m.ring.sinOpening] : [0, 0, 1], i * 3,
      );
    }
    this.moonGeo.instanceCount = n;
    for (const k of ['aDir', 'aAng', 'aLight', 'aColor', 'aStyle', 'aRing']) {
      (this.moonGeo.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true;
    }
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
    this.moonGeo?.dispose();
    this.moonMat?.dispose();
  }
}
