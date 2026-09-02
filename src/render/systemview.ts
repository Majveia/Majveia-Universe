/**
 * A planetary system, rendered as an orrery you can fly through.
 *
 * Orbits are the real thing: classical elements propagated by solving Kepler's
 * equation, so the planets sweep equal areas in equal times, move fastest at
 * perihelion, and return to exactly the same place after exactly one period.
 * General-relativistic apsidal precession is applied too, so a close-in orbit
 * visibly rotates over long enough timescales.
 *
 * Body radii are drawn magnified by default, because at true scale the Earth is
 * one part in twenty-three thousand of its own orbit and the solar system is
 * empty black. The magnification is always stated, and true scale is one key
 * away.
 */

import * as THREE from 'three';
import { AU, G, M_SUN, R_SUN, DAY, YEAR } from '../core/constants';
import { stateAt, relativisticPrecessionPerOrbit, period } from '../physics/kepler';
import type { PlanetarySystem, Planet } from '../astro/planets';
import { PlanetView } from './planet';
import { StarView } from './star';
import { RNG } from '../core/rng';
import { habitableZone } from '../astro/stellar';
import { CometView } from './cometview';

const ORBIT_VERT = /* glsl */ `
in float aT;
out float vT;
void main() {
  vT = aT;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const ORBIT_FRAG = /* glsl */ `
precision highp float;
in float vT;
out vec4 fragColor;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uHead;      // where the body currently is, 0..1 along the path
void main() {
  // The trail is brightest just behind the body and fades around the orbit,
  // which reads as direction of travel without drawing an arrow.
  float d = fract(uHead - vT);
  float a = uOpacity * (0.16 + 0.84 * pow(1.0 - d, 6.0));
  fragColor = vec4(uColor * a, a);
}
`;

const BELT_VERT = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
in vec3 position;
in vec3 aOrbit;      // a, e, inclination
in vec3 aAngles;     // Omega, omega, M0
in float aSize;
uniform float uTime;
uniform float uGM;
uniform float uPointScale;
out float vShade;
void main() {
  float a = aOrbit.x;
  float n = sqrt(uGM / (a * a * a));
  float M = aAngles.z + n * uTime;
  float e = aOrbit.y;
  // Two Newton steps are plenty for the low eccentricities of a stable belt.
  float E = M + e * sin(M);
  E = E - (E - e * sin(E) - M) / (1.0 - e * cos(E));
  E = E - (E - e * sin(E) - M) / (1.0 - e * cos(E));
  float x = a * (cos(E) - e);
  float y = a * sqrt(1.0 - e * e) * sin(E);
  float co = cos(aAngles.y), so = sin(aAngles.y);
  float cO = cos(aAngles.x), sO = sin(aAngles.x);
  float ci = cos(aOrbit.z), si = sin(aOrbit.z);
  vec3 p = vec3(
    (cO * co - sO * so * ci) * x + (-cO * so - sO * co * ci) * y,
    (so * si) * x + (co * si) * y,
    (sO * co + cO * so * ci) * x + (-sO * so + cO * co * ci) * y);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uPointScale * aSize / max(-mv.z, 1e-4), 0.5, 5.0);
  vShade = aSize;
}
`;
const BELT_FRAG = /* glsl */ `
precision highp float;
in float vShade;
out vec4 fragColor;
uniform vec3 uColor;
uniform float uOpacity;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  if (dot(d, d) > 1.0) discard;
  fragColor = vec4(uColor * uOpacity * (0.4 + vShade), 1.0);
}
`;

const ZONE_FRAG = /* glsl */ `
precision highp float;
in vec3 vObj;
out vec4 fragColor;
uniform float uInner;
uniform float uOuter;
uniform vec3 uColor;
uniform float uOpacity;
void main() {
  float r = length(vObj.xz);
  if (r < uInner || r > uOuter) discard;
  float u = (r - uInner) / max(uOuter - uInner, 1e-6);
  // Brightest at the edges: those are the limits that mean something
  float edge = pow(1.0 - 4.0 * u * (1.0 - u), 7.0);
  fragColor = vec4(uColor * uOpacity * (0.12 + 0.88 * edge), 1.0);
}
`;
const ZONE_VERT = /* glsl */ `
out vec3 vObj;
void main() {
  vObj = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export interface SystemViewOptions {
  /**
   * Minimum apparent radius, in radians, that a body is drawn at. Below this
   * it would be sub-pixel and invisible; above it, the body is drawn at true
   * scale. 0 gives strict true scale everywhere.
   */
  minAngularRadius?: number;
  /** Whether to build full planet meshes (expensive) or markers only. */
  detailed?: boolean;
}

interface PlanetSlot {
  planet: Planet;
  view?: PlanetView;
  marker: THREE.Points;
  orbit: THREE.Line;
  orbitMat: THREE.ShaderMaterial;
  worldPos: THREE.Vector3;
  precessRate: number;
}

export class SystemView {
  readonly group = new THREE.Group();
  readonly starView: StarView;
  /** The second star, when this is a binary. */
  readonly companionView?: StarView;
  /** Where each star sits this frame, scene units. */
  readonly companionPos = new THREE.Vector3();
  readonly primaryPos = new THREE.Vector3();
  readonly slots: PlanetSlot[] = [];
  private beltMats: THREE.RawShaderMaterial[] = [];
  readonly comets: CometView[] = [];
  private lastTime = 0;
  private zoneMat?: THREE.ShaderMaterial;
  minAngularRadius: number;
  /** Largest magnification currently applied to any body, for the readout. */
  magnification = 1;
  /** Simulation time, seconds. */
  timeS = 0;
  private sunColor = new THREE.Color();
  private tmp = new THREE.Vector3();

  constructor(readonly system: PlanetarySystem, seed: number, opts: SystemViewOptions = {}) {
    this.minAngularRadius = opts.minAngularRadius ?? 0.0045;
    const st = system.star;
    const c = st.color;
    this.sunColor.setRGB(c[0], c[1], c[2]);

    const starR = Math.max((st.radiusRsun * R_SUN) / AU, 1e-9);
    this.starView = new StarView(st, starR, seed, 1.6);
    this.group.add(this.starView.group);

    if (system.companion) {
      const c = system.companion.star;
      const cr = Math.max((c.radiusRsun * R_SUN) / AU, 1e-9);
      this.companionView = new StarView(c, cr, seed ^ 0x51ce, 1.6);
      this.group.add(this.companionView.group);
    }

    // --- Habitable zone. For a circumbinary system it is set by the combined
    //     light of both stars, so it sits further out than either alone.
    const [hzIn, hzOut] = system.host === 'circumbinary'
      ? habitableZone(system.effectiveLuminosity, st.teff)
      : st.habitableZoneAu;
    if (Number.isFinite(hzIn) && hzOut > hzIn && hzOut < 400) {
      this.zoneMat = new THREE.ShaderMaterial({
        vertexShader: ZONE_VERT,
        fragmentShader: ZONE_FRAG,
        glslVersion: THREE.GLSL3,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uInner: { value: hzIn }, uOuter: { value: hzOut },
          uColor: { value: new THREE.Vector3(0.22, 0.85, 0.62) },
          uOpacity: { value: 0.0055 },
        },
      });
      const g = new THREE.RingGeometry(hzIn, hzOut, 192, 1);
      g.rotateX(-Math.PI / 2);
      this.group.add(new THREE.Mesh(g, this.zoneMat));
    }

    // --- Planets
    const muStar = G * st.currentMassMsun * M_SUN;
    for (const p of system.planets) {
      const slot = this.makeSlot(p, muStar, opts.detailed ?? true);
      this.slots.push(slot);
    }

    // --- Comets
    for (const c of system.comets) {
      const cv = new CometView(c, muStar, { dust: 9000, ions: 520 });
      this.comets.push(cv);
      this.group.add(cv.group);
    }

    // --- Asteroid belts
    const rng = new RNG(seed ^ 0x5eed);
    for (const belt of system.asteroidBelts) this.addBelt(belt, muStar, rng, 0.22);
    this.addBelt({
      innerAu: system.outerBeltAu[0], outerAu: system.outerBeltAu[1],
      count: Math.min(9000, system.cometCount * 3),
    }, muStar, rng, 0.12, [0.55, 0.68, 0.85]);
  }

  private makeSlot(p: Planet, muStar: number, detailed: boolean): PlanetSlot {
    // --- Orbit path
    const N = 320;
    const pos = new Float32Array(N * 3);
    const ts = new Float32Array(N);
    const T = period(p.elements.a, muStar);
    for (let i = 0; i < N; i++) {
      const s = stateAt(p.elements, muStar, (i / N) * T);
      pos[i * 3] = s.x / AU;
      pos[i * 3 + 1] = s.z / AU;
      pos[i * 3 + 2] = s.y / AU;
      ts[i] = i / N;
    }
    const og = new THREE.BufferGeometry();
    og.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    og.setAttribute('aT', new THREE.BufferAttribute(ts, 1));
    const giant = p.massKg > 12 * 5.97e24;
    const orbitMat = new THREE.ShaderMaterial({
      vertexShader: ORBIT_VERT,
      fragmentShader: ORBIT_FRAG,
      glslVersion: THREE.GLSL3,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Vector3(...(p.habitable ? [0.42, 1.0, 0.7] : giant ? [0.85, 0.72, 0.5] : [0.6, 0.7, 0.9])) },
        uOpacity: { value: p.habitable ? 0.30 : 0.15 },
        uHead: { value: 0 },
      },
    });
    const orbit = new THREE.LineLoop(og, orbitMat);
    orbit.frustumCulled = false;
    this.group.add(orbit);

    // --- Marker: how the planet reads when it is smaller than a pixel, which
    // is most of the time. A real telescope sees a point too.
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    const marker = new THREE.Points(mg, new THREE.PointsMaterial({
      size: 5, sizeAttenuation: false, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: new THREE.Color(p.color[0] + 0.35, p.color[1] + 0.35, p.color[2] + 0.35),
    }));
    marker.frustumCulled = false;
    this.group.add(marker);

    let view: PlanetView | undefined;
    if (detailed) {
      view = new PlanetView(p, { radius: p.radiusM / AU, segments: 72 });
      this.group.add(view.group);
    }

    return {
      planet: p, view, marker, orbit, orbitMat,
      worldPos: new THREE.Vector3(),
      precessRate: relativisticPrecessionPerOrbit(p.elements.a, p.elements.e, muStar) / T,
    };
  }

  private addBelt(
    belt: { innerAu: number; outerAu: number; count: number },
    muStar: number, rng: RNG, opacity = 0.35, color: [number, number, number] = [0.75, 0.68, 0.58],
  ): void {
    if (!(belt.outerAu > belt.innerAu) || belt.count < 10) return;
    const n = belt.count;
    const orbit = new Float32Array(n * 3);
    const angles = new Float32Array(n * 3);
    const size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      orbit[i * 3] = rng.range(belt.innerAu, belt.outerAu);
      orbit[i * 3 + 1] = Math.min(0.4, Math.abs(rng.normal(0, 0.09)));
      orbit[i * 3 + 2] = Math.abs(rng.normal(0, 0.14));
      angles[i * 3] = rng.range(0, Math.PI * 2);
      angles[i * 3 + 1] = rng.range(0, Math.PI * 2);
      angles[i * 3 + 2] = rng.range(0, Math.PI * 2);
      // Collisional cascade: many small bodies, few large. dN/dD ~ D^-3.5
      size[i] = rng.powerLaw(-3.5, 0.25, 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aOrbit', new THREE.BufferAttribute(orbit, 3));
    g.setAttribute('aAngles', new THREE.BufferAttribute(angles, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), belt.outerAu * 1.2);
    const mat = new THREE.RawShaderMaterial({
      vertexShader: BELT_VERT,
      fragmentShader: BELT_FRAG,
      glslVersion: THREE.GLSL3,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uTime: { value: 0 },
        uGM: { value: muStar / (AU * AU * AU) },
        // The splat scale has to be tied to the belt's own radius, not fixed:
        // gl_PointSize divides by the view distance in AU, so a fixed value
        // turns a belt around an M dwarf - where everything sits inside a tenth
        // of an AU - into a wall of maximum-size dots.
        uPointScale: { value: Math.max(belt.outerAu, 1e-4) * 3.0 },
        uColor: { value: new THREE.Vector3(...color) },
        uOpacity: { value: opacity },
      },
    });
    this.beltMats.push(mat);
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    this.group.add(pts);
  }

  /** Advance to a simulation time and reposition everything. */
  update(timeS: number, camera: THREE.Camera): void {
    const dtS = Math.max(0, timeS - this.lastTime);
    this.lastTime = timeS;
    this.timeS = timeS;
    const st = this.system.star;
    const muStar = G * st.currentMassMsun * M_SUN;
    this.starView.update(timeS, this.primaryPos);

    for (const m of this.beltMats) m.uniforms.uTime.value = timeS;
    for (const c of this.comets) c.update(timeS, dtS);

    const camPos = camera.getWorldPosition(this.tmp.set(0, 0, 0)).clone();
    this.magnification = 1;

    // --- Both stars orbit their common barycentre.
    const comp = this.system.companion;
    if (comp && this.companionView) {
      const muPair = G * (st.currentMassMsun + comp.star.currentMassMsun) * M_SUN;
      const rel = stateAt(comp.elements, muPair, timeS);
      // Split about the barycentre by mass ratio.
      const f = comp.mu;
      this.primaryPos.set(-rel.x / AU * f, -rel.z / AU * f, -rel.y / AU * f);
      this.companionPos.set(rel.x / AU * (1 - f), rel.z / AU * (1 - f), rel.y / AU * (1 - f));
      this.starView.group.position.copy(this.primaryPos);
      this.companionView.group.position.copy(this.companionPos);
      const dc = Math.max(camPos.distanceTo(this.companionPos), 1e-12);
      const trueRc = (comp.star.radiusRsun * R_SUN) / AU;
      this.companionView.setWorldRadius(Math.max(trueRc, this.minAngularRadius * 2.2 * dc));
      this.companionView.update(timeS, this.companionPos);
    } else {
      this.primaryPos.set(0, 0, 0);
    }

    // The star gets the same treatment as the planets.
    {
      const d = Math.max(camPos.distanceTo(this.primaryPos), 1e-12);
      const trueR = (st.radiusRsun * R_SUN) / AU;
      this.starView.setWorldRadius(Math.max(trueR, this.minAngularRadius * 2.2 * d));
    }

    for (const slot of this.slots) {
      const el = slot.planet.elements;
      // General relativity rotates the orbit's line of apsides. For a hot
      // Jupiter this is fast enough to watch.
      const el2 = { ...el, omega: el.omega + slot.precessRate * timeS };
      const s = stateAt(el2, muStar, timeS);
      slot.worldPos.set(s.x / AU, s.z / AU, s.y / AU);
      slot.marker.position.copy(slot.worldPos);

      const T = period(el.a, muStar);
      slot.orbitMat.uniforms.uHead.value = ((timeS % T) / T + 1) % 1;

      if (slot.view) {
        slot.view.group.position.copy(slot.worldPos);
        // Apparent-size floor: draw at true scale once the disc is resolvable,
        // and no smaller than a few pixels before that.
        const camDist = Math.max(camPos.distanceTo(slot.worldPos), 1e-12);
        const trueR = slot.planet.radiusM / AU;
        const shown = Math.max(trueR, this.minAngularRadius * camDist);
        slot.view.setWorldRadius(shown);
        this.magnification = Math.max(this.magnification, shown / trueR);
        // Light comes from wherever the star actually is, which for a binary
        // is not the origin - so a circumbinary planet's terminator swings
        // over the binary period and its two shadows never quite align.
        const sunDir = this.primaryPos.clone().sub(slot.worldPos).normalize();
        const d2 = Math.max(slot.worldPos.distanceToSquared(this.primaryPos), 1e-8);
        // Illumination really does fall as 1/d^2, and a planet at 0.1 AU is
        // genuinely a hundred times more brightly lit than one at 1 AU. The
        // clamp keeps the inner system from swamping the tone mapper while
        // leaving the ordering and most of the range intact.
        let irrRaw = st.luminosityLsun / d2;
        if (comp && this.companionView) {
          const d2c = Math.max(slot.worldPos.distanceToSquared(this.companionPos), 1e-8);
          irrRaw += comp.star.luminosityLsun / d2c;
        }
        const irr = Math.max(0.015, Math.min(1.8, irrRaw));
        const col = this.sunColor.clone().multiplyScalar(irr);
        slot.view.update(sunDir, col, timeS, slot.view.group.position);

        slot.view.group.visible = true;
        slot.marker.visible = false;
      }
    }
  }

  /** 0 for strict true scale; a few milliradians for a legible orrery. */
  setMinAngularRadius(v: number): void { this.minAngularRadius = Math.max(0, v); }

  dispose(): void {
    this.starView.dispose();
    this.companionView?.dispose();
    for (const c of this.comets) c.dispose();
    for (const s of this.slots) { s.view?.dispose(); s.orbit.geometry.dispose(); s.orbitMat.dispose(); }
  }
}

export { DAY, YEAR };
