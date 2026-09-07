/**
 * A pulsar, close up.
 *
 * Everything here is in units of the star's own radius, because ten kilometres
 * is the only length in the problem: the light cylinder is a hundred and sixty
 * radii out for the Crab and seven for a millisecond pulsar, and putting those
 * on the same picture is only possible if the star is the ruler.
 *
 * Three things are drawn and each one is a consequence rather than a decoration:
 *
 *  - **The dipole field**, as the field lines themselves - r = r0 sin^2(theta),
 *    which is the shape a dipole has had since Gauss. The lines that would
 *    reach past the light cylinder cannot close, because nothing out there can
 *    keep up with the rotation, so they are cut where they cross it. What is
 *    left open is the polar cap, and the entire beam comes out of that.
 *  - **The beams**, along the magnetic axis, which is tilted from the spin
 *    axis. If it were not tilted there would be no pulse: a lighthouse whose
 *    lamp is on its axis of rotation does not flash. That obliquity is also
 *    what makes the star radiate at all, so a pulsar that ever aligned itself
 *    would go quiet.
 *  - **The light cylinder**, as a ring, drawn where a co-rotating point would
 *    be moving at the speed of light.
 *
 * The rotation on screen is slowed, and the readout says by how much. A
 * millisecond pulsar turns six hundred times a second; at sixty frames a second
 * it would be an alias, not an image, and the honest thing is to slow it and
 * admit it rather than to draw something that turns at a rate nothing does.
 * The sound is not slowed.
 */

import * as THREE from 'three';
import { NOISE_GLSL } from './shaders/noise';

const SURFACE_VERT = /* glsl */ `
out vec3 vN;
out vec3 vObj;
void main() {
  vObj = position;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SURFACE_FRAG = /* glsl */ `
precision highp float;
${NOISE_GLSL}
in vec3 vN;
in vec3 vObj;
out vec4 fragColor;

uniform vec3 uMagAxis;   // magnetic axis in the star's own frame, unit
uniform float uCapAngle; // half-angle of the polar cap, radians
uniform float uTime;
uniform float uHeat;     // 0 old and cold, 1 newborn

void main() {
  vec3 n = normalize(vObj);
  // A neutron star's surface is a million kelvin: the Wien peak is in soft
  // X-rays and what reaches the eye is the blue-white tail of it.
  vec3 cool = vec3(0.30, 0.42, 0.72);
  vec3 hot  = vec3(0.72, 0.84, 1.00);
  float t = 0.5 + 0.5 * dot(n, normalize(uMagAxis));

  // The polar caps are hotter than the rest: they are being bombarded by the
  // particles that fall back down the open field lines, and on the real objects
  // this is what the X-ray telescopes actually see.
  float capA = smoothstep(cos(uCapAngle * 3.2), cos(uCapAngle * 1.1), abs(dot(n, normalize(uMagAxis))));
  vec3 col = mix(cool, hot, t * 0.35) * (0.5 + 0.5 * uHeat);
  col += vec3(0.9, 0.95, 1.0) * capA * (1.4 + 1.6 * uHeat);

  // A crust of iron nuclei in a lattice, a centimetre thick and stiffer than
  // anything else in the universe. It is not featureless, but it is close.
  float grain = fbm(n * 9.0 + vec3(uTime * 0.02), 3, 2.2, 0.5);
  col *= 0.86 + 0.22 * grain;

  fragColor = vec4(col * 0.55, 1.0);
}
`;

const BEAM_VERT = /* glsl */ `
out vec3 vObj;
void main() {
  vObj = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * The beam is a volume, not a cone.
 *
 * A cone drawn as a surface has no geometry along its own axis, which is
 * precisely where a beam is brightest - so the one direction that matters is
 * the one that cannot be rasterised. Integrating through the emitting region
 * instead gets the axial brightening for nothing, and gets the flash for
 * nothing too: looking down the beam is a long path through dense material and
 * looking across it is a short one. That ratio *is* the pulse.
 */
const BEAM_FRAG = /* glsl */ `
precision highp float;
${NOISE_GLSL}
in vec3 vObj;
out vec4 fragColor;

uniform vec3 uCamLocal;    // camera in the magnetic frame, stellar radii
uniform float uReach;
uniform float uEmitR;      // how far out the emission actually reaches
uniform float uHalfAngle;
uniform float uGain;
uniform float uTime;
uniform vec3 uColor;

const int STEPS = 30;

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

float emission(vec3 p) {
  float r = length(p);
  if (r < 1.0 || r > uReach) return 0.0;
  // Both poles at once: the beam is symmetric about the magnetic axis, which
  // is why some pulsars show an interpulse half a turn after the main one.
  float ang = acos(clamp(abs(p.y) / r, 0.0, 1.0));
  float across = exp(-pow(ang / max(uHalfAngle, 1e-3), 2.0) * 2.6);
  // It thins as the particles spread. The beam does not end; it stops being
  // bright enough to see.
  // The emitting region scales with the light cylinder and nothing else: for
  // the Crab that is a hundred and sixty stellar radii, and for a millisecond
  // pulsar it is seven. Fixing it to the drawn volume instead would give a
  // recycled pulsar a beam reaching twenty times past its own magnetosphere.
  float along = exp(-r / (uEmitR * 0.45)) / max(r * 0.25, 1.0);
  // Patchy, because it is: drifting subpulses have been watched since the
  // sixties and are still not fully explained.
  float lumps = 0.7 + 0.6 * fbm(vec3(p.xz * 0.55, p.y * 0.22 - uTime * 1.1), 2, 2.3, 0.5);
  return across * along * lumps;
}

void main() {
  vec3 o = uCamLocal;
  vec3 d = normalize(vObj - uCamLocal);
  float t0, t1;
  if (!hitSphere(o, d, uReach, t0, t1)) discard;
  float tn = max(t0, 0.0);
  if (t1 <= tn) discard;
  // Everything behind the star's own surface is hidden by it.
  float s0, s1;
  if (hitSphere(o, d, 1.0, s0, s1) && s0 > 0.0) t1 = min(t1, s0);
  if (t1 <= tn) discard;

  float ds = (t1 - tn) / float(STEPS);
  float jitter = ign(gl_FragCoord.xy);
  float acc = 0.0;
  for (int i = 0; i < STEPS; i++) {
    acc += emission(o + d * (tn + (float(i) + jitter) * ds));
  }
  acc *= ds * uGain;
  if (acc < 1e-5) discard;
  // A shoulder, so that looking straight down the beam saturates into a flash
  // instead of into a flat white disc.
  vec3 col = uColor * (acc / (1.0 + acc * 0.55));
  fragColor = vec4(col, 1.0);
}
`;

export interface PulsarViewOptions {
  /** Angle between the magnetic and spin axes, radians. */
  obliquity: number;
  /** Half-width of the beam, radians. */
  beamHalfAngle: number;
  /** Light cylinder radius, in stellar radii. */
  lightCylinderR: number;
  /** Half-angle of the polar cap, radians. */
  capAngle: number;
  /** 0 for an old cold star, 1 for a newborn. */
  heat?: number;
  seed?: number;
}

/** How far from the star anything is drawn, in stellar radii. */
const REACH = 34;

export class PulsarView {
  readonly group = new THREE.Group();
  /** Turns with the star; everything magnetic hangs off it. */
  private spin = new THREE.Group();
  private magnetic = new THREE.Group();
  private surfaceMat: THREE.ShaderMaterial;
  private beamMats: THREE.ShaderMaterial[] = [];
  private beamMesh!: THREE.Mesh;
  private inv = new THREE.Matrix4();
  private lines: THREE.LineSegments;
  private ring: THREE.Line;
  private obliquity: number;
  private beamHalf: number;
  private axis = new THREE.Vector3();
  private toCam = new THREE.Vector3();
  /** How much of the beam is pointing at the camera this frame, 0 to 1. */
  pulse = 0;
  /** Phase of the rotation actually drawn, radians. */
  phase = 0;

  constructor(opts: PulsarViewOptions) {
    this.obliquity = opts.obliquity;
    this.beamHalf = opts.beamHalfAngle;
    const heat = opts.heat ?? 0.5;

    this.group.add(this.spin);
    this.spin.add(this.magnetic);
    this.magnetic.rotation.z = this.obliquity;

    // --- The star.
    this.surfaceMat = new THREE.ShaderMaterial({
      vertexShader: SURFACE_VERT,
      fragmentShader: SURFACE_FRAG,
      glslVersion: THREE.GLSL3,
      uniforms: {
        uMagAxis: { value: new THREE.Vector3(0, 1, 0) },
        uCapAngle: { value: Math.max(opts.capAngle, 0.03) },
        uTime: { value: 0 },
        uHeat: { value: heat },
      },
    });
    this.magnetic.add(new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), this.surfaceMat));

    // --- The beams, as one volume containing both poles.
    const mat = new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      glslVersion: THREE.GLSL3,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.BackSide,
      uniforms: {
        uCamLocal: { value: new THREE.Vector3(0, 0, 60) },
        uReach: { value: REACH },
        uEmitR: { value: Math.min(REACH, Math.max(4, opts.lightCylinderR * 0.9)) },
        uHalfAngle: { value: this.beamHalf },
        uGain: { value: 0.5 },
        uTime: { value: 0 },
        uColor: { value: new THREE.Vector3(0.60, 0.79, 1.0) },
      },
    });
    this.beamMats.push(mat);
    this.beamMesh = new THREE.Mesh(new THREE.SphereGeometry(REACH, 32, 24), mat);
    this.beamMesh.frustumCulled = false;
    this.beamMesh.renderOrder = 3;
    this.magnetic.add(this.beamMesh);

    // --- The field lines.
    this.lines = new THREE.LineSegments(
      this.dipoleGeometry(opts.lightCylinderR),
      new THREE.LineBasicMaterial({
        color: new THREE.Color(0.16, 0.32, 0.62),
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.magnetic.add(this.lines);

    // --- The light cylinder, about the spin axis rather than the magnetic one.
    const rc = Math.min(opts.lightCylinderR, REACH * 0.92);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * rc, 0, Math.sin(a) * rc));
    }
    this.ring = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({
        color: new THREE.Color(0.5, 0.26, 0.10),
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.group.add(this.ring);
  }

  /**
   * Dipole field lines, r = r0 sin^2(theta), cut where they would cross the
   * light cylinder. A line that cannot close is a line that is open, and the
   * open ones are the whole of pulsar astronomy.
   */
  private dipoleGeometry(lightCylinderR: number): THREE.BufferGeometry {
    const verts: number[] = [];
    const SHELLS = 7;
    const MERIDIANS = 8;
    const cut = Math.min(lightCylinderR, REACH * 0.95);
    for (let s = 1; s <= SHELLS; s++) {
      // Equatorial reach of this shell, spread over the drawn volume.
      const r0 = 1.35 * Math.pow(REACH / 1.35, s / SHELLS);
      for (let m = 0; m < MERIDIANS; m++) {
        const lon = (m / MERIDIANS) * Math.PI * 2;
        const cl = Math.cos(lon), sl = Math.sin(lon);
        let prev: THREE.Vector3 | null = null;
        for (let i = 0; i <= 96; i++) {
          const th = (i / 96) * Math.PI;
          const st = Math.sin(th);
          const r = r0 * st * st;
          if (r < 1) { prev = null; continue; }
          if (r > cut) { prev = null; continue; }
          const p = new THREE.Vector3(r * st * cl, r * Math.cos(th), r * st * sl);
          if (prev) verts.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
          prev = p;
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    return g;
  }

  /**
   * Turn the star and work out how much of the beam is coming this way.
   *
   * @param phase  rotation phase, radians
   * @param camera the scene camera
   */
  update(phase: number, timeS: number, camera: THREE.Camera): void {
    this.phase = phase;
    this.spin.rotation.y = phase;
    this.surfaceMat.uniforms.uTime.value = timeS;
    for (const m of this.beamMats) m.uniforms.uTime.value = timeS;

    // Where the magnetic axis points now, in world coordinates, and where the
    // camera is in the star's own turning frame.
    this.magnetic.updateWorldMatrix(true, false);
    this.inv.copy(this.beamMesh.matrixWorld).invert();
    camera.getWorldPosition(this.beamMats[0].uniforms.uCamLocal.value as THREE.Vector3)
      .applyMatrix4(this.inv);
    this.axis.set(0, 1, 0).transformDirection(this.magnetic.matrixWorld).normalize();
    camera.getWorldPosition(this.toCam).sub(this.group.position).normalize();

    // Either pole will do: a pulsar that beams both ways is seen twice a turn,
    // which is why some profiles have an interpulse half a period after the
    // main one.
    const c = Math.abs(this.axis.dot(this.toCam));
    const off = Math.acos(Math.min(1, c));
    this.pulse = Math.exp(-Math.pow(off / Math.max(this.beamHalf, 1e-3), 2) * 2.4);

    // The beam is brighter when it is coming at you: the same emission, seen
    // down its own axis instead of across it.
    // Brighter when it is coming at you: the same emission, seen down its own
    // axis instead of across it.
    // Below the bloom threshold when it is side on, and over it at the moment
    // it sweeps past - so the flash blooms and the rest of the turn does not,
    // which is what a lighthouse looks like.
    for (const m of this.beamMats) m.uniforms.uGain.value = 0.15 + 0.55 * this.pulse;
    (this.lines.material as THREE.LineBasicMaterial).opacity = 0.15 + 0.16 * this.pulse;
  }

  setHeat(v: number): void { this.surfaceMat.uniforms.uHeat.value = Math.min(1, Math.max(0, v)); }

  dispose(): void {
    this.surfaceMat.dispose();
    for (const m of this.beamMats) m.dispose();
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}
