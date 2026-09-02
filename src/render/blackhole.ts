/**
 * A black hole, ray-traced along null geodesics.
 *
 * Light does not travel in straight lines here. For each pixel the shader
 * integrates the Schwarzschild photon orbit equation
 *
 *     d^2u/dphi^2 + u = 3 M u^2 ,      u = 1/r
 *
 * with fourth-order Runge-Kutta, in the plane containing the camera and the ray.
 * The first two terms alone give a straight line in polar coordinates; the
 * 3 M u^2 term on the right is general relativity, and everything you see comes
 * out of it:
 *
 *  - the shadow, whose apparent radius is sqrt(27) M ~ 2.6 times the horizon,
 *    larger than the horizon itself because the trajectories bend inward
 *  - the photon ring at 3 M, where light can orbit, and the infinite stack of
 *    higher-order images piled just outside it
 *  - the accretion disc seen simultaneously from above *and* from beneath,
 *    because light from the far underside is bent up and over the hole
 *  - Einstein rings when a background star passes behind the centre
 *
 * The disc itself is a Shakura-Sunyaev thin disc: T ~ r^-3/4, radiating as a
 * blackbody, orbiting at the Keplerian rate. Its appearance is then modified by
 * relativistic Doppler beaming - the side rotating toward you is boosted by
 * delta^4 and blue-shifted, the receding side dimmed and reddened - and by
 * gravitational redshift, which cools the inner edge as seen from far away.
 * This asymmetry is the reason one side of the ring is dramatically brighter,
 * and it is a prediction, not a lighting choice.
 */

import * as THREE from 'three';

const VERT = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 modelMatrix;
in vec3 position;
out vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
in vec3 vWorld;
out vec4 fragColor;

uniform vec3 uCamera;
uniform vec3 uCentre;
uniform float uM;            // gravitational radius GM/c^2, in world units
uniform float uDiskInner;    // in units of M
uniform float uDiskOuter;
uniform vec3 uDiskNormal;
uniform float uSpinSign;
uniform float uTime;
uniform float uSteps;
uniform float uDiskBrightness;
uniform float uSkyBrightness;
uniform float uTempScale;    // peak disc temperature, K
uniform float uExposure;
uniform vec3 uAmbient;

const float PI = 3.14159265359;

// ---- Blackbody colour along the Planckian locus, in linear light.
// Bartlett's fit to the CIE-derived sRGB values, then de-gamma'd. A 3000 K
// emitter comes out orange and a 25000 K one comes out blue-white because
// that is where those temperatures actually sit on the locus.
vec3 blackbody(float T) {
  T = clamp(T, 1000.0, 40000.0);
  float t = T / 100.0;
  float r, g, b;
  if (t <= 66.0) {
    r = 1.0;
    g = clamp((99.4708025861 * log(t) - 161.1195681661) / 255.0, 0.0, 1.0);
    b = t <= 19.0 ? 0.0 : clamp((138.5177312231 * log(t - 10.0) - 305.0447927307) / 255.0, 0.0, 1.0);
  } else {
    r = clamp(329.698727446 * pow(t - 60.0, -0.1332047592) / 255.0, 0.0, 1.0);
    g = clamp(288.1221695283 * pow(t - 60.0, -0.0755148492) / 255.0, 0.0, 1.0);
    b = 1.0;
  }
  vec3 srgb = vec3(r, g, b);
  return pow(srgb, vec3(2.2));
}

float hash11(float p) { return fract(sin(p * 127.1) * 43758.5453123); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash11(i.x + i.y * 57.0);
  float b = hash11(i.x + 1.0 + i.y * 57.0);
  float c = hash11(i.x + (i.y + 1.0) * 57.0);
  float d = hash11(i.x + 1.0 + (i.y + 1.0) * 57.0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// ---- Procedural starfield, sampled by direction so that lensing genuinely
// smears and duplicates individual stars.
vec3 hash3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}

vec3 sky(vec3 dir) {
  vec3 col = vec3(0.0);
  // Three octaves of a cell grid give a plausible magnitude distribution.
  for (int oct = 0; oct < 3; oct++) {
    float scale = 60.0 * pow(2.4, float(oct));
    vec3 p = dir * scale;
    vec3 cell = floor(p);
    vec3 f = fract(p);
    for (int k = -1; k <= 1; k++)
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec3 g = vec3(float(i), float(j), float(k));
      vec3 h = hash3(cell + g);
      if (h.z > 0.965 - float(oct) * 0.012) {
        vec3 pos = g + h - f;
        float d2 = dot(pos, pos);
        float mag = pow(fract(h.x * 91.7), 5.0);
        float T = mix(2600.0, 22000.0, pow(fract(h.y * 47.3), 2.2));
        col += blackbody(T) * mag * exp(-d2 * 220.0) * (1.0 / pow(2.4, float(oct)));
      }
    }
  }
  // A faint galactic band, so the lensing has large-scale structure to distort.
  // Kept very dim: on an OLED the background of this shot has to be black.
  float band = exp(-pow(dir.y * 3.4, 2.0));
  col += vec3(0.35, 0.32, 0.30) * band * 0.0016;
  return col * uSkyBrightness;
}

// ---- Shakura-Sunyaev thin disc.
// T(r) = T0 (r/rin)^-3/4 [1 - sqrt(rin/r)]^1/4 : the bracket is the zero-torque
// inner boundary condition, and it is why the disc peaks slightly outside its
// inner edge instead of at it.
float discTemperature(float r) {
  float x = r / uDiskInner;
  float f = max(1.0 - sqrt(1.0 / max(x, 1.0)), 0.0);
  return uTempScale * pow(x, -0.75) * pow(f, 0.25);
}

float discDensity(float r, float phi) {
  float edge = smoothstep(uDiskInner, uDiskInner * 1.25, r)
             * smoothstep(uDiskOuter, uDiskOuter * 0.68, r);
  // Turbulence, wound into trailing spirals by the differential rotation: the
  // inner disc laps the outer disc, so any feature is sheared into an arc.
  float omega = pow(max(r, 1.0), -1.5) * 42.0;
  float ang = phi + omega * uTime;
  float lr = log(max(r, 1.0));
  // Built from integer harmonics of the azimuth so the pattern is exactly
  // periodic - sampling a noise field against atan() leaves a seam at pi.
  // The radial phase term is what shears each feature into a trailing spiral.
  float turb = 0.0;
  float amp = 0.55;
  for (int i = 0; i < 4; i++) {
    float m = float(2 << i);
    turb += amp * sin(m * ang + lr * (7.0 + 4.0 * float(i)) + float(i) * 2.3
                      + 3.0 * vnoise(vec2(float(i) * 13.0, lr * 2.0)));
    amp *= 0.58;
  }
  float grain = 0.85 + 0.3 * vnoise(vec2(lr * 24.0, sin(ang * 6.0) * 3.0));
  return edge * (0.30 + 0.95 * (0.5 + 0.5 * turb)) * grain;
}

void main() {
  vec3 ro = uCamera - uCentre;
  vec3 rd = normalize(vWorld - uCamera);

  // Work in units of M.
  float M = max(uM, 1e-12);
  vec3 p = ro / M;
  float r0 = length(p);
  if (r0 < 1.001) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  // Orbital plane of this photon.
  vec3 nrm = cross(p, rd);
  float nl = length(nrm);
  if (nl < 1e-7) {
    // Radial ray: straight in, straight to the horizon.
    fragColor = vec4(vec3(0.0), 1.0);
    return;
  }
  nrm /= nl;
  vec3 e1 = normalize(p);
  vec3 e2 = normalize(cross(nrm, e1));

  float u = 1.0 / r0;
  float vr = dot(rd, e1);
  float vt = dot(rd, e2);
  float du = -vr * u / max(vt, 1e-7);

  float phi = 0.0;
  vec3 accum = vec3(0.0);
  float transmit = 1.0;

  float prevSide = dot(p, uDiskNormal);
  vec3 prevPos = p;

  int steps = int(uSteps);
  bool captured = false;
  bool escaped = false;
  vec3 escapeDir = rd;

  // The whole trajectory of an escaping photon spans a bounded range in phi -
  // a straight line is u = sin(phi)/b, so phi runs from 0 to pi. Rays that
  // graze the photon sphere wind further, which is what produces the
  // higher-order images stacked just outside the ring, so the budget allows
  // about two and a half turns.
  float hBase = (2.6 * PI) / float(steps);

  for (int i = 0; i < 700; i++) {
    if (i >= steps) break;

    // Refine the step where spacetime is curved and the trajectory turns fast.
    float h = hBase * (0.30 + 0.70 * exp(-9.0 * u));

    // RK4 on  u'' = -u + 3 u^2   (M = 1)
    float k1u = du,             k1d = -u + 3.0 * u * u;
    float u2 = u + 0.5 * h * k1u, d2 = du + 0.5 * h * k1d;
    float k2u = d2,             k2d = -u2 + 3.0 * u2 * u2;
    float u3 = u + 0.5 * h * k2u, d3 = du + 0.5 * h * k2d;
    float k3u = d3,             k3d = -u3 + 3.0 * u3 * u3;
    float u4 = u + h * k3u,     d4 = du + h * k3d;
    float k4u = d4,             k4d = -u4 + 3.0 * u4 * u4;

    u  += (h / 6.0) * (k1u + 2.0 * k2u + 2.0 * k3u + k4u);
    du += (h / 6.0) * (k1d + 2.0 * k2d + 2.0 * k3d + k4d);
    phi += h;

    if (u <= 1.0 / 400.0) escaped = true;
    float rn = 1.0 / max(u, 1e-8);
    vec3 radial = e1 * cos(phi) + e2 * sin(phi);
    vec3 pos = radial * rn;

    // --- Disc crossing
    float side = dot(pos, uDiskNormal);
    if (side * prevSide < 0.0) {
      float t = prevSide / (prevSide - side);
      vec3 hit = mix(prevPos, pos, t);
      float rh = length(hit);
      if (rh > uDiskInner && rh < uDiskOuter && transmit > 0.004) {
        // Azimuth in the disc plane
        vec3 a1 = normalize(cross(uDiskNormal, abs(uDiskNormal.y) < 0.9 ? vec3(0,1,0) : vec3(1,0,0)));
        vec3 a2 = cross(uDiskNormal, a1);
        float az = atan(dot(hit, a2), dot(hit, a1));

        float dens = discDensity(rh, az);
        if (dens > 0.001) {
          float T = discTemperature(rh);

          // Keplerian orbital velocity as a fraction of c: v = sqrt(M/r)
          float beta = min(0.62, sqrt(1.0 / max(rh, 1.5)));
          vec3 vdir = normalize(cross(uDiskNormal, hit)) * uSpinSign;
          // Ray direction at the crossing, approximated by the local tangent
          vec3 tang = normalize(pos - prevPos);
          float mu = dot(vdir, -tang);
          float gamma = 1.0 / sqrt(max(1.0 - beta * beta, 1e-4));
          // Relativistic Doppler factor
          float delta = 1.0 / max(gamma * (1.0 - beta * mu), 1e-3);

          // Gravitational redshift for a circular orbit in Schwarzschild:
          // the combined factor is sqrt(1 - 3M/r) for a Keplerian emitter.
          float grav = sqrt(max(1.0 - 3.0 / max(rh, 3.05), 1e-3));
          float shift = delta * grav;

          // Observed temperature is shifted; observed bolometric intensity
          // scales as the fourth power of the shift (three from solid-angle
          // and time dilation, one from the photon energy).
          float Tobs = T * shift;
          vec3 col = blackbody(Tobs) * pow(shift, 4.0);

          float amount = dens * uDiskBrightness;
          accum += transmit * col * amount;
          transmit *= exp(-amount * 0.55);
        }
      }
    }
    prevSide = side;
    prevPos = pos;

    if (rn <= 2.02 || u > 0.495) { captured = true; break; }
    if (escaped) {
      // Exact tangent to the trajectory:
      //   d/dphi [ (e1 cos phi + e2 sin phi) / u ]
      vec3 tangential = -e1 * sin(phi) + e2 * cos(phi);
      escapeDir = normalize(tangential - radial * (du / max(u, 1e-9)));
      break;
    }
  }

  vec3 col = accum;
  if (!captured) {
    if (!escaped) {
      vec3 radial = e1 * cos(phi) + e2 * sin(phi);
      vec3 tangential = -e1 * sin(phi) + e2 * cos(phi);
      escapeDir = normalize(tangential - radial * (du / max(u, 1e-9)));
    }
    col += transmit * sky(escapeDir);
  }
  col += uAmbient * transmit;
  fragColor = vec4(col * uExposure, 1.0);
}
`;

export interface BlackHoleOptions {
  /** Mass in solar masses (used only for the readout and for disc temperature). */
  massMsun: number;
  /** Gravitational radius GM/c^2 expressed in scene units. */
  gravitationalRadius: number;
  /** Inner disc edge in units of M. 6 is the ISCO of a non-spinning hole. */
  diskInner?: number;
  diskOuter?: number;
  /** Peak disc temperature, K. */
  temperature?: number;
  steps?: number;
  skyBrightness?: number;
  diskBrightness?: number;
}

export class BlackHoleView {
  readonly mesh: THREE.Mesh;
  private mat: THREE.RawShaderMaterial;
  readonly options: Required<BlackHoleOptions>;

  constructor(opts: BlackHoleOptions) {
    const o: Required<BlackHoleOptions> = {
      diskInner: 6,
      diskOuter: 30,
      temperature: 11000,
      steps: 260,
      skyBrightness: 1,
      diskBrightness: 0.42,
      ...opts,
    };
    this.options = o;

    this.mat = new THREE.RawShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      glslVersion: THREE.GLSL3,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uCamera: { value: new THREE.Vector3() },
        uCentre: { value: new THREE.Vector3() },
        uM: { value: o.gravitationalRadius },
        uDiskInner: { value: o.diskInner },
        uDiskOuter: { value: o.diskOuter },
        uDiskNormal: { value: new THREE.Vector3(0, 1, 0) },
        uSpinSign: { value: 1 },
        uTime: { value: 0 },
        uSteps: { value: o.steps },
        uDiskBrightness: { value: o.diskBrightness },
        uSkyBrightness: { value: o.skyBrightness },
        uTempScale: { value: o.temperature },
        uExposure: { value: 1 },
        uAmbient: { value: new THREE.Vector3(0, 0, 0) },
      },
    });

    // A sphere large enough that everything interesting happens inside it.
    const R = o.gravitationalRadius * Math.max(o.diskOuter * 2.5, 90);
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(R, 16, 8), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  update(camera: THREE.Vector3, timeS: number, centre = new THREE.Vector3()): void {
    this.mat.uniforms.uCamera.value.copy(camera);
    this.mat.uniforms.uCentre.value.copy(centre);
    this.mat.uniforms.uTime.value = timeS;
    this.mesh.position.copy(centre);
  }

  setSteps(n: number): void { this.mat.uniforms.uSteps.value = Math.max(40, Math.min(700, n)); }
  setDiskNormal(n: THREE.Vector3): void { this.mat.uniforms.uDiskNormal.value.copy(n).normalize(); }
  setExposure(v: number): void { this.mat.uniforms.uExposure.value = v; }
  setSkyBrightness(v: number): void { this.mat.uniforms.uSkyBrightness.value = v; }
  setDiskBrightness(v: number): void { this.mat.uniforms.uDiskBrightness.value = v; }
  setTemperature(v: number): void { this.mat.uniforms.uTempScale.value = v; }

  dispose(): void { this.mesh.geometry.dispose(); this.mat.dispose(); }
}

/** Apparent radius of the shadow, sqrt(27) M for a non-rotating hole. */
export const shadowRadius = (M: number): number => Math.sqrt(27) * M;
/** Photon sphere radius, 3 M. */
export const photonSphereRadius = (M: number): number => 3 * M;
/** Innermost stable circular orbit, 6 M for Schwarzschild. */
export const iscoRadius = (M: number): number => 6 * M;
