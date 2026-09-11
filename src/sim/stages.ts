/**
 * The scale ladder.
 *
 * Five stages, each one about a thousand times smaller than the one above it:
 *
 *   COSMOS   ~ 600 Mpc     the cosmic web, growing under gravity
 *   CLUSTER  ~ 3 Mpc       a bound halo full of galaxies
 *   GALAXY   ~ 40 kpc      one galaxy, its arms turning
 *   SYSTEM   ~ 30 AU       one star and its planets
 *   WORLD    ~ 10^4 km     one planet, its moons, its weather
 *
 * A single scene graph cannot span forty orders of magnitude in float32, so
 * each stage owns its own units, its own camera clipping range and its own
 * clock. Descending picks an object, throws away the stage above, and builds
 * the one below from the same seed - so the galaxy you fly into is the galaxy
 * that was there, and it is still there when you come back.
 */

import * as THREE from 'three';
import { Engine } from '../render/engine';
import { Controls } from '../camera/controls';
import { Universe } from './universe';
import {
  Cosmology, growthFactor, growthRate, zFromA, ageAt, HofaKmsMpc, Tcmb_a,
} from '../cosmology/lcdm';
import { peculiarVelocityFactor } from '../cosmology/zeldovich';
import { CosmicWebRenderer } from '../render/cosmicweb';
import { CmbView } from '../render/cmbview';
import { MergerView } from '../render/mergerview';
import { PulsarView } from '../render/pulsarview';
import { TDEView } from '../render/tdeview';
import * as TDE from '../astro/tidal';
import { PPDotDiagram } from '../ui/ppdot';
import { PulseAudio } from '../ui/pulseaudio';
import * as PSR from '../astro/pulsar';
import { StrainTrace } from '../ui/strain';
import { HRDiagram } from '../ui/hrdiagram';
import { ChirpAudio } from '../ui/chirpaudio';
import {
  chirpMass, finalMass, finalSpin, radiatedFraction, peakLuminosity,
  PLANCK_LUMINOSITY,
} from '../physics/gwaves';
import { peakMultipoles } from '../cosmology/cmb';
import { GalaxySprites, type GalaxySpriteData } from '../render/galaxysprites';
import { SurfaceView, type MoonDisc, type SkyPoint } from '../render/surface';
import { LatticeView, type LatticeAtom } from '../render/lattice';
import { OrbitalCloud, hundOccupancy, type OrbitalSpec } from '../render/orbital';
import { NucleonView, type NucleonSeed } from '../render/nucleons';
import { BindingCurve } from '../ui/bindingcurve';
import * as NUC from '../physics/nucleus';
import * as XTL from '../physics/crystal';
import * as ATOM from '../physics/atom';
import * as EPH from '../astro/ephemeris';
import * as COMP from '../astro/companion';
import * as SKY from '../astro/sky';
import { ClusterOrbits, bindingPressure, type Halo } from '../physics/clusterorbits';
import * as SZ from '../astro/sz';
import { GalaxyView } from '../render/galaxyview';
import { SystemView } from '../render/systemview';
import { PlanetView } from '../render/planet';
import { MoonView } from '../render/moon';
import { AuroraView } from '../render/aurora';
import {
  planetaryNebula, shellRadius, shellThickness, shellBrightness,
  coreLuminosityLsun, coreRadiusRsun, ionisedFraction, reflectedBrightness,
  transitionTimeS, pulseIntervalYears, type PlanetaryNebula,
} from '../astro/planetarynebula';
import {
  windPressure, standoffRadii, ovalColatitude, auroralPower, dipoleTilt,
} from '../physics/magnetosphere';
import {
  discOverlapFraction, angularRadius, canBeTotal, eclipseLabel,
} from '../physics/eclipse';
import { StarView } from '../render/star';
import { SkyDome } from '../render/skydome';
import { LensedField, einsteinMass } from '../render/lensedfield';
import { NebulaView } from '../render/nebula';
import { BlackHoleView } from '../render/blackhole';
import { buildGalaxy, angularRate, rotationCurve, type GalaxyParams } from '../galaxy/generator';
import { Encounter } from './encounter';
import { PointCloud } from '../render/pointcloud';
import {
  lightCurve, magnitudeToLuminosity, supernovaColor, coreCollapseRate, typeIaRate,
  type SupernovaType,
} from '../astro/supernova';
import {
  starLabel, makeStar, msLifetimeGyr, habitableZone, type Star,
} from '../astro/stellar';
import { CLASS_LABEL, type Planet, type PlanetarySystem } from '../astro/planets';
import { solarSystem } from '../astro/solsystem';
import { detectability } from '../astro/detection';
import type { DetectionPlotOptions } from '../ui/detection';
import { blackbodyRGB } from '../astro/blackbody';
import { RNG, hash3 } from '../core/rng';
import { stateAt } from '../physics/kepler';
import { AU, GYR, MPC, M_EARTH, M_JUPITER, MYR, R_EARTH, R_SUN, YEAR, DAY, G, M_SUN, LY } from '../core/constants';
import { sig, commas, formatDistance, formatTime } from '../ui/hud';

export type ScaleId =
  'cosmos' | 'cluster' | 'galaxy' | 'system' | 'world' | 'surface' | 'matter'
  | 'atom' | 'nucleus';

export const SCALE_ORDER: ScaleId[] = [
  'cosmos', 'cluster', 'galaxy', 'system', 'world', 'surface', 'matter',
  'atom', 'nucleus',
];

export interface StageCtx {
  cluster?: number;
  member?: number;
  star?: number;
  planet?: number;
  /** Where on the world you are standing, degrees. */
  lat?: number;
  lon?: number;
  /** Which moon of that planet, when the planet itself has no surface. */
  moon?: number;
  /** Which element to go into, at the bottom of the ladder. */
  z?: number;
  /**
   * 1 for the real Solar System rather than a generated one. It travels down
   * the ladder with everything else, so descending from it lands on the real
   * Earth and climbing back returns to the real Sun.
   */
  real?: number;
}

export interface Target {
  id: ScaleId;
  ctx: StageCtx;
  label: string;
}

export interface StageEnv {
  engine: Engine;
  controls: Controls;
  universe: Universe;
  cosmology: Cosmology;
  /** Current epoch as a scale factor; only the cosmos stage really uses it. */
  epoch: () => number;
  viewport: () => [number, number];
  quality: () => number;
}

export interface Row { k: string; v: string; u?: string; accent?: boolean }

export interface Inspection {
  title: string;
  kind: string;
  rows: Row[];
  note?: string;
  swatch?: string;
  /** Draw this star's spectrum under the rows. */
  spectrum?: { tempK: number; metallicity?: number; vsini?: number };
  /** Draw the transit and radial-velocity curves this planet would produce. */
  detection?: DetectionPlotOptions;
}

/**
 * The planetary system a context points at, and the seed its sky was made from.
 *
 * Four stages needed the same five lines to answer this and one of them had
 * quietly dropped the seed, so its starfield was a different starfield from the
 * one directly above it.
 */
function systemOf(
  env: StageEnv, ctx: StageCtx,
): { system: PlanetarySystem; seed: number } {
  const g = env.universe.galaxy(ctx.cluster ?? 0, ctx.member ?? 0);
  return ctx.real
    ? { system: solarSystem(), seed: 0x50143 }
    : env.universe.system(g, ctx.star ?? 0);
}

/**
 * The world a context is standing on, which may not be a planet.
 *
 * Below thirty bars of hydrogen a giant has no bottom, so the ladder hands you
 * one of its moons instead - and from that point down a moon is a world like
 * any other. The only thing that differs is what is in its sky, and that is
 * the caller's business rather than this function's.
 */
function standingOn(system: PlanetarySystem, ctx: StageCtx): {
  world: Planet;
  host: Planet;
  /** The moon, when the world is one; null when you are on the planet. */
  moon: Planet['moons'][number] | null;
  moonIndex: number;
} {
  const host = system.planets[ctx.planet ?? 0];
  const mi = ctx.moon;
  const onMoon = mi !== undefined && mi >= 0 && mi < host.moons.length;
  return {
    host,
    moon: onMoon ? host.moons[mi] : null,
    moonIndex: onMoon ? mi : -1,
    world: onMoon
      ? COMP.moonAsWorld(host.moons[mi], host, system.star.luminosityLsun, mi)
      : host,
  };
}

export abstract class Stage {
  readonly root = new THREE.Group();
  abstract readonly id: ScaleId;
  abstract readonly title: string;
  abstract readonly subtitle: string;
  /** Seconds of simulated time per second of wall clock. */
  timeScale = 1;
  simTime = 0;
  /** Vertical field of view this stage wants, degrees. */
  baseFov = 60;

  constructor(protected env: StageEnv, readonly ctx: StageCtx) {}

  abstract build(): void;
  abstract update(dt: number): void;
  abstract rows(): Row[];
  /** Where "descend" goes, optionally guided by a click. */
  abstract child(ndc?: THREE.Vector2): Target | null;
  /** What the object under the cursor is, if anything. */
  inspect(_ndc: THREE.Vector2): Inspection | null { return null; }
  /** Human label for the current scale bar. */
  abstract scaleLabel(): string;
  /**
   * Put the observer in motion at a fraction of the speed of light, along a
   * world-space direction. Stages that draw a sky transform it; the others
   * ignore it, because there is nothing at infinity for them to aberrate.
   */
  setBoost(_beta: number, _dir: THREE.Vector3): void {}
  /**
   * An element the stage wants mounted over the scene while it is running -
   * an instrument trace, rather than a row of numbers. Null for most stages.
   */
  overlay(): HTMLElement | null { return null; }
  onResize(): void {}
  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }

  protected ray(ndc: THREE.Vector2): THREE.Ray {
    const cam = this.env.engine.camera;
    const r = new THREE.Ray();
    r.origin.setFromMatrixPosition(cam.matrixWorld);
    r.direction.set(ndc.x, ndc.y, 0.5).unproject(cam).sub(r.origin).normalize();
    return r;
  }

  /** Closest candidate to the ray, weighted so nearer objects win ties. */
  protected pickNearest(
    ndc: THREE.Vector2, points: { pos: THREE.Vector3; radius: number; index: number }[],
    tolerance = 0.03,
  ): number | null {
    const ray = this.ray(ndc);
    let best: number | null = null;
    let bestScore = Infinity;
    const v = new THREE.Vector3();
    for (const p of points) {
      v.copy(p.pos).sub(ray.origin);
      const t = v.dot(ray.direction);
      if (t <= 0) continue;
      const perp = Math.sqrt(Math.max(v.lengthSq() - t * t, 0));
      const angular = perp / t;
      const own = p.radius / t;
      if (angular > Math.max(tolerance, own * 1.6)) continue;
      const score = angular / Math.max(own, 1e-9) + t * 1e-9;
      if (score < bestScore) { bestScore = score; best = p.index; }
    }
    return best;
  }
}

// ---------------------------------------------------------------------------
// COSMOS
// ---------------------------------------------------------------------------

/** Brightness the microwave sky is drawn at when it is fully shown. */
const CMB_BRIGHT = 0.075;

export class CosmosStage extends Stage {
  readonly id = 'cosmos' as const;
  readonly title = 'Cosmic web';
  readonly subtitle = 'Structure grown from a Gaussian random field by gravity alone';
  private web!: CosmicWebRenderer;
  private markers!: THREE.Points;
  private markerPos: THREE.Vector3[] = [];
  private nodeCount = 0;
  velocityTint = false;
  brightness = 0.55;
  /**
   * Extra exposure, for the opening run.
   *
   * Structure at cosmic dawn really is faint: the density contrast at z = 20
   * is a few per cent, and shown at the same stretch as the present day it is
   * an empty screen. Every visualisation of structure formation ever made
   * opens the aperture early and closes it as the contrast arrives, and this
   * is that - a change of exposure, not of physics, and it is over by the time
   * anything is being measured.
   */
  exposure = 1;
  private cmb?: CmbView;
  /** 0 off, 1 as observed with the dipole, 2 with the dipole removed. */
  private cmbMode: 0 | 1 | 2 = 0;
  /** The distance the view settles at once the opening run is over. */
  restDistance = 1;
  /** Strength of the last-scattering sky while the opening run dissolves it. */
  private cmbFade = 0;

  build(): void {
    const field = this.env.universe.field;
    const q = this.env.quality();
    this.web = new CosmicWebRenderer(field, {
      tiles: 3,
      detail: q,
      neighbourDetail: q * (field.n >= 128 ? 0.03 : 0.09),
    });
    this.web.setLook({ sizeCells: 0.18, minSize: 0.62, maxSize: 9, densityGain: 1, filamentBoost: 1 });
    this.root.add(this.web.group);

    // Markers on the most massive haloes: these are the doors down a level.
    const knots = field.knots.slice(0, 220);
    this.nodeCount = knots.length;
    const pos = new Float32Array(knots.length * 3);
    const col = new Float32Array(knots.length * 3);
    const size = new Float32Array(knots.length);
    for (let i = 0; i < knots.length; i++) {
      const k = knots[i];
      pos[i * 3] = k.x; pos[i * 3 + 1] = k.y; pos[i * 3 + 2] = k.z;
      const hot = Math.min(1, Math.max(0, Math.log10(k.massMsun / 1e13) * 0.5 + 0.5));
      col[i * 3] = 0.55 + hot * 0.35;
      col[i * 3 + 1] = 0.70 + hot * 0.22;
      col[i * 3 + 2] = 0.95;
      size[i] = 1.6 + hot * 2.6;
      this.markerPos.push(new THREE.Vector3(k.x, k.y, k.z));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(field.boxMpc / 2, field.boxMpc / 2, field.boxMpc / 2), field.boxMpc);
    this.markers = new THREE.Points(g, new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
      uniforms: { uOpacity: { value: 0.55 } },
      vertexShader: `precision highp float;
        uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix;
        in vec3 position; in vec3 aColor; in float aSize;
        out vec3 vC;
        void main() {
          vC = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aSize * 260.0 / max(-mv.z, 1.0), 1.0, 12.0);
        }`,
      fragmentShader: `precision highp float;
        in vec3 vC; out vec4 fragColor; uniform float uOpacity;
        void main() {
          vec2 d = gl_PointCoord * 2.0 - 1.0;
          float r = length(d);
          if (r > 1.0) discard;
          // A ring rather than a dot: it reads as a marker, not as matter.
          float ring = smoothstep(0.55, 0.78, r) * smoothstep(1.0, 0.82, r);
          fragColor = vec4(vC * ring * uOpacity, 1.0);
        }`,
    }));
    this.markers.frustumCulled = false;
    this.root.add(this.markers);

    const box = field.boxMpc;
    this.restDistance = box * 0.42;
    const c = this.env.controls;
    c.snapTo(new THREE.Vector3(box / 2, box / 2, box / 2), this.restDistance, 0.7, 1.15);
    c.drift = 0.008;
    c.minDistance = 0.4;
    c.maxDistance = box * 6;
    const cam = this.env.engine.camera;
    cam.near = 0.05; cam.far = box * 12;
    cam.updateProjectionMatrix();
    this.onResize();
  }

  override onResize(): void {
    this.web.setViewport(this.env.viewport()[1], this.env.engine.camera.fov);
  }

  /**
   * Show the microwave background around the web.
   *
   * They are the same field. The temperature pattern on the last-scattering
   * surface and the filaments in front of it are one Gaussian random field
   * with one power spectrum, separated by 13.8 billion years of gravity - so
   * seeing them in the same frame is the point, and the web is dimmed rather
   * than hidden.
   */
  cycleCmb(): 0 | 1 | 2 {
    if (!this.cmb) {
      this.cmb = new CmbView({
        cosmology: this.env.cosmology,
        seed: this.env.universe.seed,
        waves: this.env.quality() > 0.6 ? 640 : 400,
        resolution: this.env.quality() > 0.6 ? 2560 : 1280,
      });
      this.cmb.mesh.scale.setScalar(this.env.universe.field.boxMpc * 40);
    }
    this.cmbMode = ((this.cmbMode + 1) % 3) as 0 | 1 | 2;
    if (this.cmbMode === 0) {
      this.root.remove(this.cmb.mesh);
    } else {
      this.root.add(this.cmb.mesh);
      // As observed, our own motion through the background is 3.36 mK and the
      // primordial pattern is 110 microkelvin: a factor of thirty. Every map
      // ever published has the dipole taken out, and this is why.
      this.cmb.setDipole(this.cmbMode === 1 ? 3360 : 0);
      this.cmb.setRange(this.cmbMode === 1 ? 3600 : 340);
    }
    return this.cmbMode;
  }

  /**
   * Show the last-scattering surface at a given strength, for the opening run.
   *
   * The same sky `cycleCmb` shows, but faded rather than switched, so it can
   * dissolve into the structure that grew out of it. Zero takes it away again
   * and leaves the key-driven mode exactly as it was.
   */
  fadeCmb(strength: number): void {
    if (strength <= 0) {
      if (this.cmbFade > 0 && this.cmb) {
        this.root.remove(this.cmb.mesh);
        this.cmb.setBrightness(CMB_BRIGHT);
        this.cmbMode = 0;
      }
      this.cmbFade = 0;
      return;
    }
    if (!this.cmb) {
      this.cmb = new CmbView({
        cosmology: this.env.cosmology,
        seed: this.env.universe.seed,
        waves: this.env.quality() > 0.6 ? 640 : 400,
        resolution: this.env.quality() > 0.6 ? 2560 : 1280,
      });
      this.cmb.mesh.scale.setScalar(this.env.universe.field.boxMpc * 40);
    }
    if (this.cmbFade <= 0) {
      this.root.add(this.cmb.mesh);
      // The pattern, not our own motion through it: the dipole is thirty times
      // larger and it is not what the structure grew from.
      this.cmb.setDipole(0);
      this.cmb.setRange(340);
      this.cmbMode = 2;
    }
    this.cmbFade = strength;
    this.cmb.setBrightness(CMB_BRIGHT * strength);
  }

  /** Scales of the last-scattering surface, for the readout. */
  get cmbScales(): CmbView['scales'] | null {
    return this.cmbMode > 0 && this.cmb ? this.cmb.scales : null;
  }

  update(dt: number): void {
    void dt;
    const a = this.env.epoch();
    const D = growthFactor(this.env.cosmology, a);
    const field = this.env.universe.field;
    this.web.setGrowth(D);
    this.web.setCamera(this.env.engine.camera.position);
    if ((this.cmbMode > 0 || this.cmbFade > 0) && this.cmb) {
      this.cmb.render(this.env.engine.renderer);
      this.cmb.mesh.position.copy(this.env.engine.camera.position);
    }

    // Bounded sightline with exposure scaled by cell/depth: constant column
    // density per pixel from inside a void to outside the box.
    const cell = field.boxMpc / field.n;
    const depth = Math.max(cell * 8, Math.min(field.boxMpc * 1.6, this.env.controls.distance * 1.45));
    this.web.setLook({
      nearFade: depth * 0.16,
      fadeStart: depth * 0.30,
      fadeEnd: depth,
      brightness: this.brightness * this.exposure * (cell / depth) * (this.cmbFade > 0 ? 0.75 : 1),
      velocityTint: this.velocityTint ? 1 : 0,
      velocityFactor: this.velocityTint ? peculiarVelocityFactor(this.env.cosmology, a) : 0,
    });

    // Haloes only exist once they have collapsed, so markers fade in with time.
    // Markers are navigation aids, not matter: dim, and only once the haloes
    // they mark have actually collapsed.
    (this.markers.material as THREE.RawShaderMaterial).uniforms.uOpacity.value =
      0.30 * Math.min(1, Math.max(0, (D - 0.25) / 0.5));
    const p = (this.markers.geometry.getAttribute('position') as THREE.BufferAttribute);
    const knots = field.knots;
    for (let i = 0; i < this.nodeCount; i++) {
      const k = knots[i];
      const x = k.qx + D * k.px, y = k.qy + D * k.py, z = k.qz + D * k.pz;
      p.setXYZ(i, x, y, z);
      this.markerPos[i].set(x, y, z);
    }
    p.needsUpdate = true;
  }

  setDetail(q: number): void {
    const n = this.env.universe.field.n;
    this.web.setDetail(q, q * (n >= 128 ? 0.03 : 0.09));
  }

  get drawn(): number { return this.web.drawnParticles; }

  rows(): Row[] {
    const c = this.env.cosmology;
    const a = this.env.epoch();
    const z = zFromA(a);
    const D = growthFactor(c, a);
    const [dv, du] = formatDistance(this.env.controls.distance * MPC);
    return [
      { k: 'redshift', v: z >= 0 ? sig(z, 4) : sig(z, 3), u: z < 0 ? 'future' : '', accent: true },
      { k: 'cosmic time', v: (ageAt(c, a) / GYR).toFixed(3), u: 'Gyr' },
      { k: 'scale factor', v: a.toFixed(4) },
      { k: 'growth D(a)', v: D.toFixed(4) },
      { k: 'H(z)', v: Math.round(HofaKmsMpc(c, a)).toString(), u: 'km/s/Mpc' },
      { k: 'CMB', v: Tcmb_a(c, a).toFixed(2), u: 'K' },
      { k: 'growth rate f', v: growthRate(c, a).toFixed(3) },
      ...this.cmbRows(),
      { k: 'field of view', v: dv, u: du },
      { k: 'particles', v: commas(this.web.drawnParticles) },
    ];
  }

  /** What the last-scattering surface is doing, while it is being shown. */
  private cmbRows(): Row[] {
    const s = this.cmbScales;
    if (!s) return [];
    const peaks = peakMultipoles(s, 3);
    return [
      { k: 'last scattering', v: `z = ${s.zStar.toFixed(0)}`, accent: true },
      { k: 'sound horizon', v: s.soundHorizonMpc.toFixed(0), u: 'Mpc' },
      { k: 'subtends', v: s.acousticAngleDeg.toFixed(2), u: '°' },
      { k: 'acoustic peaks', v: `ℓ = ${peaks.map((p) => p.toFixed(0)).join(', ')}` },
      { k: 'showing', v: this.cmbMode === 1 ? 'as observed · ±3.4 mK' : 'dipole removed · ±340 µK' },
    ];
  }

  scaleLabel(): string {
    const [v, u] = formatDistance(this.env.controls.distance * MPC);
    return `${v} ${u}`;
  }

  override inspect(ndc: THREE.Vector2): Inspection | null {
    const i = this.pickNearest(ndc, this.markerPos.map((pos, index) => ({
      pos, radius: this.env.universe.field.boxMpc * 0.004, index,
    })), 0.02);
    if (i === null) return null;
    const k = this.env.universe.field.knots[i];
    const c = this.env.universe.cluster(i);
    return {
      title: c.name,
      kind: k.massMsun > 1e14 ? 'galaxy cluster' : k.massMsun > 1e13 ? 'galaxy group' : 'halo',
      rows: [
        { k: 'mass', v: sig(k.massMsun, 3), u: 'M☉' },
        { k: 'peak height', v: `${k.nu.toFixed(2)}σ` },
        { k: 'collapsed at', v: Number.isFinite(k.zCollapse) ? `z = ${k.zCollapse.toFixed(2)}` : 'never' },
        { k: 'virial radius', v: c.radiusMpc.toFixed(2), u: 'Mpc' },
        { k: 'dispersion', v: Math.round(c.sigmaKms).toString(), u: 'km/s' },
        { k: 'ICM', v: c.icmKeV.toFixed(2), u: 'keV' },
        { k: 'galaxies', v: commas(c.richness) },
      ],
      note: Number.isFinite(k.zCollapse)
        ? 'A peak in the primordial density field that has turned around and collapsed.'
        : 'Too shallow a peak to ever collapse: dark energy froze its growth first.',
    };
  }

  child(ndc?: THREE.Vector2): Target | null {
    let idx = 0;
    if (ndc) {
      const hit = this.pickNearest(ndc, this.markerPos.map((pos, index) => ({
        pos, radius: this.env.universe.field.boxMpc * 0.004, index,
      })), 0.03);
      if (hit === null) return null;
      idx = hit;
    } else {
      // No pointer: fall into the most massive halo near the centre of view.
      const cam = this.env.engine.camera.position;
      let best = 0, bestScore = -Infinity;
      for (let i = 0; i < this.markerPos.length; i++) {
        const d = this.markerPos[i].distanceTo(cam);
        const s = Math.log10(this.env.universe.field.knots[i].massMsun) - Math.log10(d + 1) * 1.2;
        if (s > bestScore) { bestScore = s; best = i; }
      }
      idx = best;
    }
    const c = this.env.universe.cluster(idx);
    return { id: 'cluster', ctx: { cluster: idx }, label: c.name };
  }
}

// ---------------------------------------------------------------------------
// CLUSTER
// ---------------------------------------------------------------------------

export class ClusterStage extends Stage {
  readonly id = 'cluster' as const;
  title = 'Galaxy cluster';
  subtitle = '';
  private sprites!: GalaxySprites;
  private positions: THREE.Vector3[] = [];
  private radii: number[] = [];
  private icm?: THREE.Mesh;
  private sky!: LensedField;
  private deep = false;
  private savedView: { d: number; theta: number; phi: number } | null = null;
  /** The cluster's own dynamics: every galaxy on its own orbit in the halo. */
  private orbits!: ClusterOrbits;
  private halo!: Halo;
  /** Which galaxies can show gas at all - ellipticals are already dead. */
  private gasBearing: Uint8Array = new Uint8Array(0);
  /** How hard each is being stripped right now, smoothed so tails do not blink. */
  private stripNow: Float32Array = new Float32Array(0);
  private bindOf: Float64Array = new Float64Array(0);
  private stripped = 0;
  /** The microwave view: -1 off, otherwise an index into SZ.PLANCK_BANDS. */
  private band = -1;
  private gas!: SZ.ClusterGas;
  private szSky?: CmbView;
  private szSaved: { d: number; theta: number; phi: number; fov: number } | null = null;

  build(): void {
    const u = this.env.universe;
    const ci = this.ctx.cluster ?? 0;
    const cl = u.cluster(ci);
    this.title = cl.name;
    // The numbers are all in the readout below; what belongs up here is what
    // they mean.
    this.subtitle = `${commas(cl.richness)} galaxies falling through a halo ` +
      'fifty times their combined mass';

    // The sky behind a cluster is not a starfield - it is the distant
    // universe, and the cluster bends its light.
    this.sky = new LensedField({ seed: cl.seed, brightness: 0.55, density: 1 });
    this.sky.mesh.scale.setScalar(cl.radiusMpc * 400);
    this.sky.setShape(0.62 + (cl.seed % 100) / 400, ((cl.seed % 628) / 100));
    this.root.add(this.sky.mesh);

    // The halo, and the galaxies falling through it. Concentration falls with
    // mass for the same reason it does in the universe's own generator: the
    // big ones assembled late, when the universe was already thin.
    this.halo = {
      massMsun: cl.massMsun,
      radiusMpc: cl.radiusMpc,
      concentration: 9 * Math.pow(cl.massMsun / 1e12, -0.1),
    };
    this.orbits = new ClusterOrbits(this.halo, cl.members.length);
    this.gasBearing = new Uint8Array(cl.members.length);
    this.stripNow = new Float32Array(cl.members.length);
    this.bindOf = new Float64Array(cl.members.length);
    const vrng = new RNG(cl.seed ^ 0x5eed);

    const data: GalaxySpriteData[] = [];
    const rng = new RNG(cl.seed ^ 0x77);
    for (const m of cl.members) {
      const g = u.galaxy(ci, m.index);
      const rMpc = (g.radiusKpc * 1.6) / 1000;
      const type = g.type === 'E' || g.type === 'S0' ? 1 : g.type === 'Irr' ? 2 : 0;
      // Colour from the integrated stellar population: red and dead in the
      // core, blue and star-forming in the outskirts.
      const red = g.type === 'E' || g.type === 'S0';
      const col: [number, number, number] = red
        ? [1.0, 0.74, 0.5]
        : [0.82, 0.86, 1.0];
      data.push({
        x: m.x, y: m.y, z: m.z,
        radius: rMpc,
        type, arms: g.arms || 2, pitch: g.pitch,
        dust: g.dust, bulge: g.bulgeFraction,
        inclination: Math.acos(rng.range(0, 1)),
        positionAngle: rng.range(0, Math.PI * 2),
        color: col,
        // Surface brightness from the stellar mass and the sprite's area
        brightness: Math.min(9, (g.stellarMassMsun / 5e10) * 0.115 / Math.max(rMpc * rMpc * 90, 1e-6)),
      });
      this.positions.push(new THREE.Vector3(m.x, m.y, m.z));
      this.radii.push(rMpc);

      // Ellipticals have already lost whatever they had, long before the
      // cluster got hold of them. Spirals arrive with a gas disc worth a tenth
      // of their stars, and it is that disc the cluster takes.
      const gasFrac = red ? 0.006 : g.type === 'Irr' ? 0.30 : 0.12;
      this.gasBearing[m.index] = red ? 0 : 1;
      // The disc's exponential scale length, which is what sets how hard it
      // holds its gas - not its optical radius, which is three times larger
      // and would make every galaxy in the cluster far too easy to strip.
      const scaleMpc = Math.max(g.discScaleKpc, 0.2) / 1000;
      this.bindOf[m.index] = bindingPressure(g.stellarMassMsun, scaleMpc, gasFrac);
      this.orbits.place({
        x: m.x, y: m.y, z: m.z,
        haloMassMsun: m.haloMassMsun,
        stellarMsun: g.stellarMassMsun,
        radiusMpc: scaleMpc,
        gasFraction: gasFrac,
      }, () => vrng.next());
    }
    // The brightest cluster galaxy sits in the middle and stays there - it is
    // the one thing in a cluster that is not going anywhere.
    if (cl.members.length > 0 && cl.members[0].environment >= 1) this.orbits.anchor(0);
    // These galaxies have been here for gigayears already, not since the last
    // frame: give each one the gas its orbit would have left it by now.
    this.orbits.settle();

    this.sprites = new GalaxySprites(data);
    this.root.add(this.sprites.mesh);

    // The intracluster medium: 10^7-10^8 K plasma holding most of the baryons.
    const icmMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.BackSide,
      uniforms: {
        uCentre: { value: new THREE.Vector3() },
        uRadius: { value: cl.radiusMpc },
        uColor: { value: new THREE.Vector3(0.32, 0.52, 1.0) },
        uStrength: { value: Math.min(0.012, 0.0012 * Math.pow(cl.icmKeV, 0.8)) },
      },
      vertexShader: `out vec3 vW;
        void main() { vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `precision highp float;
        in vec3 vW; out vec4 fragColor;
        uniform vec3 uCentre; uniform float uRadius; uniform vec3 uColor; uniform float uStrength;
        void main() {
          vec3 rd = normalize(vW - cameraPosition);
          vec3 oc = cameraPosition - uCentre;
          float b = dot(oc, rd);
          float perp2 = max(dot(oc,oc) - b*b, 0.0);
          float x = sqrt(perp2) / uRadius;
          // Beta model: the density profile X-ray observations actually fit,
          // integrated along the line of sight.
          float col = pow(1.0 + x*x/0.09, -1.0);
          fragColor = vec4(uColor * col * uStrength, 1.0);
        }`,
    });
    this.icm = new THREE.Mesh(new THREE.SphereGeometry(cl.radiusMpc * 2.2, 24, 16), icmMat);
    this.icm.frustumCulled = false;
    this.root.add(this.icm);

    // A cluster crosses itself in a couple of gigayears. At this rate that is
    // half a minute, which is slow enough to watch an orbit and fast enough
    // to see one finish.
    this.timeScale = 90; // Myr per second

    const c = this.env.controls;
    c.snapTo(new THREE.Vector3(), cl.radiusMpc * 2.1, 0.5, 1.05);
    c.drift = 0.014;
    c.minDistance = 0.001;
    c.maxDistance = cl.radiusMpc * 30;
    const cam = this.env.engine.camera;
    cam.near = 1e-4; cam.far = cl.radiusMpc * 900;
    cam.updateProjectionMatrix();
    this.onResize();
  }

  override onResize(): void {
    this.sprites.setViewport(this.env.viewport()[1], this.env.engine.camera.fov);
  }

  override dispose(): void {
    this.sky.dispose(); this.sprites.dispose(); this.szSky?.dispose(); super.dispose();
  }

  update(dt: number): void {
    this.simTime += dt * this.timeScale;
    const cl = this.env.universe.cluster(this.ctx.cluster ?? 0);
    this.advance(dt * this.timeScale);
    const cam = this.env.engine.camera.position;
    this.sky.mesh.position.copy(cam);
    // Aim the lens: the deflection is a fixed angular scale set by the
    // cluster's velocity dispersion, so it shrinks against the cluster's own
    // apparent size as you approach and only resolves from far away.
    // The core radius matters enormously. A non-singular isothermal sphere
    // whose core is comparable to its own Einstein radius is sub-critical: the
    // lens equation stays one-to-one, and there are no multiple images and no
    // arcs at all. Real cluster lenses have cores of tens of kiloparsecs
    // against Einstein radii of a couple of hundred, and that ratio is what
    // makes them produce the arcs they are famous for.
    const coreKpc = cl.radiusMpc * 1000 * 0.008;
    this.sky.aim(cam, this.root.position, cl.sigmaKms, coreKpc,
      this.env.controls.distance * 1000);
    this.sky.setFieldOfView((this.env.engine.camera.fov * Math.PI) / 180);
  }

  /**
   * Move the cluster on by some megayears, and repaint what it has become.
   *
   * The integration is substepped so a dropped frame cannot turn into a bad
   * orbit: leapfrog is stable but it is not magic, and a two-hundred-megayear
   * jump through the core is a different trajectory from eighty small ones.
   */
  private advance(myr: number): void {
    if (!this.orbits) return;
    const cl = this.env.universe.cluster(this.ctx.cluster ?? 0);
    if (myr > 0) {
      const steps = Math.min(12, Math.max(1, Math.ceil(myr / 2.5)));
      const h = myr / steps;
      for (let k = 0; k < steps; k++) this.orbits.step(h);
    }

    const o = this.orbits;
    this.stripped = 0;
    for (let i = 0; i < o.length; i++) {
      const x = o.pos[i * 3], y = o.pos[i * 3 + 1], z = o.pos[i * 3 + 2];
      const vx = o.vel[i * 3], vy = o.vel[i * 3 + 1], vz = o.vel[i * 3 + 2];
      this.positions[i].set(x, y, z);

      // Only a galaxy that has just fallen into a stronger wind than it is
      // used to is actually streaming gas, and only those grow a tail.
      const want = this.gasBearing[i] ? o.strip[i] : 0;
      // Eased, so a tail grows and fades rather than appearing between frames.
      this.stripNow[i] += (want - this.stripNow[i]) * 0.06;
      if (this.stripNow[i] > 0.12) this.stripped++;
      const gas = this.gasBearing[i] ? o.gas[i] : 0;
      this.sprites.setState(i, x, y, z, vx, vy, vz, gas, this.stripNow[i]);
    }
    this.sprites.commit();

    this.aimSZ();

    // The intracluster gas sloshes. A cluster that has swallowed a group is
    // left with its atmosphere ringing for gigayears afterwards, and the cold
    // fronts that ringing produces are visible in every deep X-ray image.
    if (this.icm) {
      const mat = this.icm.material as THREE.ShaderMaterial;
      const t = this.simTime / 1000; // Gyr
      const a = cl.radiusMpc * 0.06;
      (mat.uniforms.uCentre.value as THREE.Vector3).set(
        a * Math.sin(t * 1.7), a * 0.6 * Math.sin(t * 1.1 + 2.1), a * Math.cos(t * 1.3 + 0.7),
      );
      mat.uniforms.uStrength.value = Math.min(0.012, 0.0012 * Math.pow(cl.icmKeV, 0.8))
        * (1 + 0.12 * Math.sin(t * 2.3));
    }
  }

  /** How many galaxies are visibly losing their gas at this moment. */
  get strippingCount(): number { return this.stripped; }

  /**
   * Observe the cluster in the microwave, where it is a hole in the beginning
   * of time.
   *
   * Each press moves to the next Planck band and the fourth turns it off, so
   * you go 100 - 143 - 217 - 353 GHz and watch the shadow deepen, vanish, and
   * come back inverted. That inversion is the whole signature: nothing else in
   * the sky is a cold spot on one side of 217 gigahertz and a hot spot on the
   * other, and it is why these four bands exist.
   *
   * The vantage has to be a long way off, because the effect is a distortion
   * of a background that is behind everything - from inside the cluster there
   * is no "behind" to look at. So this backs off to a few hundred megaparsecs
   * and narrows the field until the cluster subtends a few arcminutes, which
   * is what a millimetre telescope actually sees.
   */
  cycleMicrowave(): number {
    const cl = this.env.universe.cluster(this.ctx.cluster ?? 0);
    const c = this.env.controls;
    const cam = this.env.engine.camera;
    const was = this.band;
    this.band = was + 1 >= SZ.PLANCK_BANDS.length ? -1 : was + 1;

    if (was < 0 && this.band >= 0) {
      this.szSaved = { d: c.distance, theta: c.theta, phi: c.phi, fov: this.baseFov };
      this.gas = SZ.clusterGas(cl.massMsun, cl.radiusMpc, cl.icmKeV);
      // Frame it the way a survey does: a few arcminutes across.
      this.baseFov = 1.6;
      const want = (this.baseFov * Math.PI) / 180;
      const D = cl.radiusMpc / (0.34 * want);
      c.maxDistance = D * 3;
      c.minDistance = D * 0.05;
      c.snapTo(new THREE.Vector3(), D, c.theta, c.phi);
      cam.near = D * 0.3; cam.far = D * 4;
      if (!this.szSky) {
        this.szSky = new CmbView({
          cosmology: this.env.cosmology,
          seed: this.env.universe.seed,
          waves: this.env.quality() > 0.6 ? 640 : 400,
          resolution: this.env.quality() > 0.6 ? 2560 : 1280,
          ellRange: [90, 1400],
          // A survey filters the large-scale primordial pattern out before it
          // looks for clusters - it is a foreground to this measurement,
          // however much it is the subject of every other one - so what is
          // left of it here is a residual wash rather than the full 110
          // microkelvin.
          rmsMicroK: 45,
        });
        this.szSky.mesh.scale.setScalar(D * 40);
        this.szSky.setDipole(0);
        // The stretch is set by the cluster, not by the background: half a
        // millikelvin runs the whole colour range, so the decrement saturates
        // and the residual sky does not.
        this.szSky.setRange(700);
        this.szSky.setBrightness(0.075);
      }
      this.root.add(this.szSky.mesh);
      this.sky.mesh.visible = false;
      this.sprites.mesh.visible = false;
      if (this.icm) this.icm.visible = false;
    } else if (this.band < 0) {
      if (this.szSky) this.root.remove(this.szSky.mesh);
      this.sky.mesh.visible = true;
      this.sprites.mesh.visible = true;
      if (this.icm) this.icm.visible = true;
      const v = this.szSaved ?? { d: cl.radiusMpc * 2.1, theta: 0.5, phi: 1.05, fov: 60 };
      this.baseFov = v.fov;
      c.maxDistance = cl.radiusMpc * 30;
      c.minDistance = 0.001;
      c.snapTo(new THREE.Vector3(), v.d, v.theta, v.phi);
      cam.near = 1e-4; cam.far = cl.radiusMpc * 900;
    }
    cam.fov = this.baseFov;
    cam.updateProjectionMatrix();
    this.onResize();
    return this.band;
  }

  /** The band being observed in, GHz, or 0 when the microwave view is off. */
  get microwaveGHz(): number {
    return this.band < 0 ? 0 : SZ.PLANCK_BANDS[this.band];
  }

  /** Point the shadow at the cluster and set its depth for this band. */
  private aimSZ(): void {
    if (this.band < 0 || !this.szSky) return;
    this.szSky.render(this.env.engine.renderer);
    const cam = this.env.engine.camera;
    const dir = this.root.position.clone().sub(cam.position);
    const D = Math.max(dir.length(), 1e-6);
    this.szSky.mesh.position.copy(cam.position);

    const ghz = SZ.PLANCK_BANDS[this.band];
    const y0 = SZ.yAt(this.gas, 0);
    const tau = SZ.tauAt(this.gas, 0);
    // The cluster's own motion along the line of sight, from the halo it sits
    // in: the same peculiar velocity that shifts every galaxy's redshift.
    const vLos = this.env.universe.cluster(this.ctx.cluster ?? 0).members[0]?.vlos ?? 0;
    this.szSky.setCluster(
      dir,
      SZ.thermalSZ(y0, ghz) * 1e6,
      SZ.kineticSZ(tau, vLos * 1e3) * 1e6,
      (this.gas.rcM / MPC) / D,
      (this.gas.cutM / MPC) / D,
    );
  }

  /** What the microwave view is showing, for the readout. */
  private szRows(): Row[] {
    const ghz = SZ.PLANCK_BANDS[this.band];
    const y0 = SZ.yAt(this.gas, 0);
    const tau = SZ.tauAt(this.gas, 0);
    const dtUK = SZ.thermalSZ(y0, ghz) * 1e6;
    const cl = this.env.universe.cluster(this.ctx.cluster ?? 0);
    const vLos = cl.members[0]?.vlos ?? 0;
    const kUK = SZ.kineticSZ(tau, vLos * 1e3) * 1e6;
    const arcmin = ((this.gas.cutM / MPC) / this.env.controls.distance) * (180 / Math.PI) * 60;
    return [
      { k: 'observing', v: `${ghz} GHz`, accent: true },
      {
        k: 'thermal SZ',
        v: `${dtUK >= 0 ? '+' : ''}${Math.abs(dtUK) < 1 ? dtUK.toFixed(2) : Math.round(dtUK)}`,
        u: 'µK',
        accent: true,
      },
      {
        k: 'shows as',
        // The band centre is half a gigahertz off the true null, which is why
        // 217 GHz leaves a few microkelvin behind rather than exactly nothing.
        v: Math.abs(dtUK) < 25 ? 'very nearly nothing'
          : dtUK < 0 ? 'a cold spot' : 'a hot spot',
      },
      { k: 'Compton y', v: sig(y0, 3) },
      { k: 'optical depth', v: `${(tau * 100).toFixed(2)}%` },
      { k: 'kinetic SZ', v: `${kUK >= 0 ? '+' : ''}${kUK.toFixed(1)}`, u: 'µK' },
      { k: 'gas temp', v: `${cl.icmKeV.toFixed(1)} keV`, u: `${sig((cl.icmKeV * 1.16045e7), 2)} K` },
      { k: 'Y', v: sig(SZ.integratedYMpc2(this.gas), 3), u: 'Mpc²' },
      { k: 'subtends', v: arcmin.toFixed(1), u: 'arcmin' },
      { k: 'null at', v: SZ.SZ_NULL_GHZ.toFixed(1), u: 'GHz' },
      { k: 'distance', v: 'does not enter' },
    ];
  }

  /**
   * Back off to a cosmological distance and narrow the field of view, which is
   * the only vantage from which cluster lensing is visible: the Einstein angle
   * is about 40 arcseconds for a rich cluster, so from inside its own virial
   * radius the arcs are buried in the core, and from a gigaparsec away with a
   * few arcminutes of field they are the most obvious thing in the frame.
   */
  observeDeepField(): boolean {
    const c = this.env.controls;
    const cam = this.env.engine.camera;
    this.deep = !this.deep;
    if (this.deep) {
      this.savedView = { d: c.distance, theta: c.theta, phi: c.phi };
      const D = 1000; // Mpc
      c.maxDistance = D * 4;
      c.minDistance = D * 0.02;
      c.snapTo(new THREE.Vector3(), D, c.theta, c.phi);
      this.baseFov = 0.10;
      cam.near = D * 0.4;
      cam.far = D * 3;
    } else {
      const v = this.savedView ?? { d: 5, theta: 0.5, phi: 1.05 };
      const cl = this.env.universe.cluster(this.ctx.cluster ?? 0);
      c.maxDistance = cl.radiusMpc * 30;
      c.minDistance = 0.001;
      c.snapTo(new THREE.Vector3(), v.d, v.theta, v.phi);
      this.baseFov = 60;
      cam.near = 1e-4;
      cam.far = cl.radiusMpc * 900;
    }
    cam.fov = this.baseFov;
    cam.updateProjectionMatrix();
    this.onResize();
    return this.deep;
  }

  /** Overlay the critical curves, where the magnification formally diverges. */
  toggleCriticalCurves(): boolean {
    const on = this.sky.critical <= 0;
    this.sky.setCritical(on ? 1 : 0);
    return on;
  }

  get deepField(): boolean { return this.deep; }

  rows(): Row[] {
    const cl = this.env.universe.cluster(this.ctx.cluster ?? 0);
    const [dv, du] = formatDistance(this.env.controls.distance * MPC);
    if (this.band >= 0) return this.szRows();
    if (this.deep) {
      const D = this.env.controls.distance;
      const fieldArcmin = this.baseFov * 60;
      return [
        { k: 'observing', v: 'deep field', accent: true },
        { k: 'distance', v: sig(D, 3), u: 'Mpc' },
        { k: 'field', v: fieldArcmin.toFixed(1), u: 'arcmin' },
        { k: 'Einstein θ', v: this.sky.einsteinAngleArcsec.toFixed(1), u: 'arcsec' },
        { k: 'lensed mass', v: sig(einsteinMass(cl.sigmaKms, D), 3), u: 'M☉' },
        { k: 'dispersion', v: Math.round(cl.sigmaKms).toString(), u: 'km/s' },
        { k: 'galaxies', v: commas(cl.richness) },
      ];
    }
    // The dispersion the galaxies actually have, measured the way a
    // spectroscopic survey measures it: the spread of one velocity component.
    const measured = this.orbits ? this.orbits.dispersionKms() : cl.sigmaKms;
    let quenched = 0;
    if (this.orbits) {
      for (let i = 0; i < this.orbits.length; i++) {
        if (!this.gasBearing[i] || this.orbits.gas[i] < 0.35) quenched++;
      }
    }
    return [
      { k: 'cluster mass', v: sig(cl.massMsun, 3), u: 'M☉', accent: true },
      { k: 'virial radius', v: cl.radiusMpc.toFixed(2), u: 'Mpc' },
      { k: 'dispersion', v: Math.round(measured).toString(), u: 'km/s' },
      { k: 'ICM temp', v: cl.icmKeV.toFixed(2), u: 'keV' },
      { k: 'galaxies', v: commas(cl.richness) },
      { k: 'red & dead', v: `${Math.round((100 * quenched) / Math.max(1, cl.richness))}%` },
      { k: 'being stripped', v: commas(this.stripped), accent: this.stripped > 0 },
      // R / sigma, with 1 Mpc/(km/s) = 978 Gyr
      { k: 'crossing time', v: ((cl.radiusMpc / cl.sigmaKms) * 977.8).toFixed(2), u: 'Gyr' },
      { k: 'elapsed', v: (this.simTime / 1000).toFixed(2), u: 'Gyr' },
      { k: 'field of view', v: dv, u: du },
    ];
  }

  scaleLabel(): string {
    const [v, u] = formatDistance(this.env.controls.distance * MPC);
    if (this.band >= 0) return `${SZ.PLANCK_BANDS[this.band]} GHz · ${v} ${u}`;
    return `${v} ${u}`;
  }

  override inspect(ndc: THREE.Vector2): Inspection | null {
    const i = this.pickNearest(ndc, this.positions.map((pos, index) => ({
      pos, radius: this.radii[index], index,
    })), 0.02);
    if (i === null) return null;
    const ci = this.ctx.cluster ?? 0;
    const g = this.env.universe.galaxy(ci, i);
    const los = this.orbits.losKms(i);
    const gas = this.gasBearing[i] ? this.orbits.gas[i] : 0;
    const stripping = this.stripNow[i] > 0.08;
    return {
      title: g.name,
      kind: `${g.type} galaxy`,
      rows: [
        { k: 'stellar mass', v: sig(g.stellarMassMsun, 3), u: 'M☉' },
        { k: 'halo mass', v: sig(this.orbits.mass[i], 3), u: 'M☉' },
        { k: 'radius', v: g.radiusKpc.toFixed(1), u: 'kpc' },
        { k: 'v(max)', v: Math.round(g.vMaxKms).toString(), u: 'km/s' },
        { k: 'star formation', v: g.sfrMsunYr.toFixed(2), u: 'M☉/yr' },
        { k: 'central BH', v: sig(g.blackHoleMsun, 2), u: 'M☉' },
        { k: 'metallicity', v: `${g.metallicity >= 0 ? '+' : ''}${g.metallicity.toFixed(2)}`, u: 'dex' },
        { k: 'speed', v: Math.round(this.orbits.speedKms(i)).toString(), u: 'km/s' },
        { k: 'redshift v', v: `${los >= 0 ? '+' : ''}${Math.round(los)}`, u: 'km/s' },
        { k: 'cluster-centric r', v: this.orbits.radius(i).toFixed(2), u: 'Mpc' },
        { k: 'gas left', v: `${Math.round(gas * 100)}%`, accent: stripping },
      ],
      note: stripping
        ? 'Being stripped, now: the intracluster wind is stronger than its own '
          + 'grip on its gas, and the gas is going out behind it in a tail.'
        : gas < 0.05
          ? 'Red and dead. Its gas was taken by the cluster on an earlier pass, '
            + 'and it has not formed a star since.'
          : g.type === 'E'
            ? 'It arrived without gas. Ellipticals in clusters were quenched '
              + 'long before they fell in, in whatever group brought them.'
            : undefined,
    };
  }

  child(ndc?: THREE.Vector2): Target | null {
    const ci = this.ctx.cluster ?? 0;
    let idx: number | null = 0;
    if (ndc) {
      idx = this.pickNearest(ndc, this.positions.map((pos, index) => ({
        pos, radius: this.radii[index], index,
      })), 0.03);
      if (idx === null) return null;
    } else {
      // Without a pointer, fall toward something worth arriving at. The most
      // massive galaxy in a cluster is almost always a red, gasless elliptical
      // - correct, and the least interesting place to be dropped - so star
      // formation and spiral structure count for as much as mass here. Click
      // any galaxy directly to override this.
      const cam = this.env.engine.camera.position;
      let best = 0, bestScore = -Infinity;
      for (let i = 0; i < this.positions.length; i++) {
        const g = this.env.universe.galaxy(ci, i);
        const d = this.positions[i].distanceTo(cam);
        const spiral = g.arms > 0 ? 1.4 : 0;
        const s = Math.log10(g.stellarMassMsun) + spiral + Math.log10(1 + g.sfrMsunYr)
          - Math.log10(d + 0.01) * 1.4;
        if (s > bestScore) { bestScore = s; best = i; }
      }
      idx = best;
    }
    const g = this.env.universe.galaxy(ci, idx);
    return { id: 'galaxy', ctx: { cluster: ci, member: idx }, label: g.name };
  }
}

// ---------------------------------------------------------------------------
// GALAXY
// ---------------------------------------------------------------------------

interface CatalogStar {
  index: number;
  a: number; b: number; theta0: number; omega: number; tilt: number; z: number;
  pos: THREE.Vector3;
  radiusKpc: number;
}

export class GalaxyStage extends Stage {
  readonly id = 'galaxy' as const;
  title = 'Galaxy';
  subtitle = '';
  private view!: GalaxyView;
  private params!: GalaxyParams;
  private catalog: CatalogStar[] = [];
  private catalogPoints!: THREE.Points;
  private nebulae: NebulaView[] = [];
  private bh?: BlackHoleView;
  private sky!: SkyDome;
  private patternRate = 0;
  private encounter?: Encounter;
  private encounterCloud?: PointCloud;
  private encounterSteps = 0;
  private merger?: MergerView;
  private tde?: TDEView;
  private tdeDis?: TDE.Disruption;
  /** Time since the disruption, in units of the first debris return. */
  private tdeU = 0;
  /** Whether this galaxy's hole is small enough to make a flare at all. */
  get tdeVisible(): boolean { return this.tdeDis?.visible ?? false; }
  private pulsarView?: PulsarView;
  private pulsar?: PSR.Pulsar;
  private ppdot?: PPDotDiagram;
  private pulseAudio?: PulseAudio;
  /** Which of the measured pulsars is on show; -1 for one of this galaxy's own. */
  private psrIndex = 0;
  /** Rotation phase actually drawn, radians, and the slowdown it is drawn at. */
  private psrPhase = 0;
  private psrSlow = 1;
  private strain?: StrainTrace;
  private chirp?: ChirpAudio;
  private hr?: HRDiagram;
  /** Time relative to coalescence while the merger runs, seconds. */
  private mergerT = 0;
  private baseTimeScale = 1;

  // --- Live supernovae.
  //
  // A galaxy like this one has a supernova every few decades, and each is
  // bright for about a year. Those two timescales differ by a factor of fifty,
  // so at any honest playback speed you either never see one or see nothing but
  // a strobe. The events therefore run on their own clock - the light curve at
  // a tenth of a year per second, the arrival rate capped at about one every
  // couple of seconds - and the readout states the galaxy's true rate alongside
  // what is being shown. Everything about each event except its cadence is real:
  // the type, where it goes off, its peak magnitude, and how it fades.
  private snCloud?: PointCloud;
  private snEvents: {
    type: SupernovaType; x: number; y: number; z: number; days: number; alive: boolean;
  }[] = [];
  private snSpawnAccum = 0;
  private snCount = 0;
  private static SN_YEARS_PER_SECOND = 0.11;
  private static SN_MAX_PER_SECOND = 0.7;

  build(): void {
    const u = this.env.universe;
    const ci = this.ctx.cluster ?? 0;
    const mi = this.ctx.member ?? 0;
    const g = u.galaxy(ci, mi);
    this.params = g;
    this.title = g.name;
    this.subtitle = `${g.type} · ${sig(g.stellarMassMsun, 2)} M☉ of stars · ` +
      `${g.arms ? `${g.arms} arms at ${(g.pitch * 180 / Math.PI).toFixed(0)}° pitch · ` : ''}` +
      `v(max) ${Math.round(g.vMaxKms)} km/s`;
    this.timeScale = 12; // Myr per second
    this.baseTimeScale = 12;

    const q = this.env.quality();
    const buffers = buildGalaxy(g, { count: Math.round(520000 * q) });
    this.view = new GalaxyView(buffers);
    this.root.add(this.view.group);
    this.patternRate = g.patternSpeed * 1.02271e-3;

    this.sky = new SkyDome({ brightness: 0.22, bandStrength: 0.002, seed: g.seed, nebula: 0 });
    this.sky.mesh.scale.setScalar(g.radiusKpc * 300);
    this.root.add(this.sky.mesh);

    // --- A catalogue of stars you can actually visit. They ride the same
    //     orbits as everything else, so they move with the arms.
    const rng = new RNG(g.seed ^ 0x5721);
    const nCat = 2600;
    const a0 = Math.max(0.35, g.discScaleKpc * 0.55);
    const tanPitch = Math.tan(g.pitch);
    const pos = new Float32Array(nCat * 3);
    const col = new Float32Array(nCat * 3);
    for (let i = 0; i < nCat; i++) {
      const s = u.star(g, i);
      const a = Math.max(0.08, s.radiusKpc);
      const cs: CatalogStar = {
        index: i, a, b: a * 0.88, theta0: rng.range(0, Math.PI * 2),
        omega: angularRate(g, a),
        tilt: Math.log(Math.max(a, 0.02) / a0) / tanPitch,
        z: rng.normal(0, g.thicknessKpc),
        pos: new THREE.Vector3(), radiusKpc: a,
      };
      this.catalog.push(cs);
      const c = s.star.color;
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    cg.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    cg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), g.radiusKpc * 4);
    this.catalogPoints = new THREE.Points(cg, new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
      // These are stars, not pins. Drawing them as rings said "you may enter
      // here" clearly enough, but there are several hundred of them and a
      // galaxy full of hollow circles stops looking like a galaxy - the
      // markers were the brightest thing in the frame and the disc was behind
      // them. So: a point of starlight with a halo, and the halo carries the
      // hint. What tells you which ones you can go into is that they are the
      // only ones that hold still and brighten when you point at them.
      uniforms: { uOpacity: { value: 0.34 } },
      vertexShader: `precision highp float;
        uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix;
        in vec3 position; in vec3 aColor; out vec3 vC;
        void main() {
          vC = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(74.0 / max(-mv.z, 0.02), 1.5, 6.0);
        }`,
      fragmentShader: `precision highp float;
        in vec3 vC; out vec4 fragColor; uniform float uOpacity;
        void main() {
          vec2 d = gl_PointCoord * 2.0 - 1.0;
          float r = length(d);
          if (r > 1.0) discard;
          // Monotone from the centre out. A bright core with a separate ring
          // around it still reads as a ring, however faint the ring is - the
          // eye finds the annulus - so there is no annulus: just a star.
          float I = exp(-r * r * 3.4) * (1.0 - smoothstep(0.72, 1.0, r));
          fragColor = vec4(vC * I * uOpacity, 1.0);
        }`,
    }));
    this.catalogPoints.frustumCulled = false;
    this.root.add(this.catalogPoints);

    // --- Star-forming regions large enough to be worth flying into.
    if (g.sfrMsunYr > 0.2 && g.arms > 0) {
      const n = Math.min(3, 1 + Math.floor(g.sfrMsunYr / 2));
      for (let i = 0; i < n; i++) {
        const r = rng.range(g.discScaleKpc * 0.5, g.radiusKpc * 0.8);
        const th = Math.log(Math.max(r, 0.02) / a0) / tanPitch + rng.normal(0, 0.12)
          + (rng.int(0, Math.max(0, g.arms - 1)) * 2 * Math.PI) / Math.max(g.arms, 1);
        const neb = new NebulaView({
          radius: rng.range(0.05, 0.16) * g.discScaleKpc,
          seed: hash3(i, g.seed, 0x4e, 0),
          shape: 1,
          density: 1.5,
          dust: 0.5,
          emission: 1.4,
          steps: Math.round(40 * q + 20),
          sources: [{ x: rng.range(-0.2, 0.2), y: rng.range(0.2, 0.5), z: 0, strength: 0.10, color: [0.75, 0.85, 1] }],
        });
        neb.mesh.position.set(r * Math.cos(th), rng.normal(0, g.thicknessKpc * 0.6), r * Math.sin(th));
        this.nebulae.push(neb);
        this.root.add(neb.mesh);
      }
    }

    // --- The supermassive black hole at the centre. Its gravitational radius
    //     is around a hundred-millionth of the galaxy's, so it is a point here;
    //     the lensing only becomes visible when you go and look.
    const rgKpc = (2.95e3 * g.blackHoleMsun / 2) / 3.0857e19;
    // Live supernovae: a small pool of slots, reused as events come and go.
    const SLOTS = 28;
    this.snCloud = new PointCloud(SLOTS, new Float32Array(SLOTS * 3), new Float32Array(SLOTS * 2));
    this.snCloud.setSize(2.8);
    this.snCloud.setBrightness(1);
    this.snCloud.setCount(0);
    this.root.add(this.snCloud.points);
    for (let i = 0; i < SLOTS; i++) {
      this.snEvents.push({ type: 'II-P', x: 0, y: 0, z: 0, days: 0, alive: false });
    }

    this.bh = new BlackHoleView({
      massMsun: g.blackHoleMsun,
      gravitationalRadius: Math.max(rgKpc, g.discScaleKpc * 1e-6),
      diskInner: 6, diskOuter: 26,
      temperature: 12000,
      steps: Math.round(120 * q + 60),
      diskBrightness: 0.4,
      skyBrightness: 0,
    });
    this.root.add(this.bh.mesh);

    this.view.setViewport(this.env.viewport()[1], this.env.engine.camera.fov);
    const c = this.env.controls;
    c.snapTo(new THREE.Vector3(), g.radiusKpc * 2.4, 0.45, 0.78);
    // The disc turns on its own, so the view only needs a whisper of its own.
    c.drift = 0.006;
    c.minDistance = 1e-7;
    c.maxDistance = g.radiusKpc * 40;
    const cam = this.env.engine.camera;
    cam.near = 1e-5; cam.far = g.radiusKpc * 400;
    cam.updateProjectionMatrix();
  }

  /**
   * Replace the galaxy with a live gravitational encounter: this galaxy, an
   * intruder derived from the same seed, and both discs integrated forward.
   * The analytic model is switched off while it runs - a standing density wave
   * and a violently perturbed disc are different physics and cannot both be
   * true at once.
   */
  toggleEncounter(): boolean {
    if (this.encounter) {
      this.encounterCloud?.dispose();
      if (this.encounterCloud) this.root.remove(this.encounterCloud.points);
      this.encounter = undefined;
      this.encounterCloud = undefined;
      this.view.group.visible = true;
      this.catalogPoints.visible = true;
      for (const n of this.nebulae) n.mesh.visible = true;
      if (this.bh) this.bh.mesh.visible = true;
      const c = this.env.controls;
      c.snapTo(new THREE.Vector3(), this.params.radiusKpc * 2.4, 0.45, 0.78);
      return false;
    }
    const q = this.env.quality();
    this.encounter = new Encounter(this.params, {
      seed: this.params.seed,
      tracers: Math.max(6000, Math.round(26000 * q)),
    });
    this.encounterCloud = new PointCloud(
      this.encounter.count, this.encounter.colors, this.encounter.style);
    this.encounterCloud.setSize(1.7);
    this.encounterCloud.setBrightness(0.30);
    this.encounterCloud.updateFrom(this.encounter.pos, this.encounter.count);
    this.root.add(this.encounterCloud.points);
    this.view.group.visible = false;
    this.catalogPoints.visible = false;
    for (const n of this.nebulae) n.mesh.visible = false;
    if (this.bh) this.bh.mesh.visible = false;
    const c = this.env.controls;
    c.snapTo(new THREE.Vector3(), this.encounter.scaleKpc * 1.6, 0.35, 0.55);
    c.maxDistance = this.encounter.scaleKpc * 30;
    return true;
  }

  get encounterActive(): boolean { return !!this.encounter; }

  override onResize(): void {
    this.view.setViewport(this.env.viewport()[1], this.env.engine.camera.fov);
  }

  /**
   * Replace the galaxy with a binary black hole merging.
   *
   * It is a forty-order-of-magnitude jump out of the scale this stage normally
   * works at - a galaxy is 10^21 m across and these two horizons are 10^5 - but
   * it is the same stage's business: this is where the galaxy's black holes
   * came from and where its next one will come from. The clock changes too. A
   * galaxy runs at twelve million years a second; the whole of this takes
   * eleven.
   */
  toggleMerger(): boolean {
    if (this.merger) {
      this.root.remove(this.merger.group);
      this.merger.dispose();
      this.merger = undefined;
      this.strain = undefined;
      this.chirp?.stop();
      this.chirp = undefined;
      this.showGalaxy(true);
      this.timeScale = this.baseTimeScale;
      const c = this.env.controls;
      c.snapTo(new THREE.Vector3(), this.params.radiusKpc * 2.4, 0.45, 0.78);
      c.minDistance = 1e-7;
      c.maxDistance = this.params.radiusKpc * 40;
      const cam = this.env.engine.camera;
      cam.near = 1e-5; cam.far = this.params.radiusKpc * 400;
      cam.updateProjectionMatrix();
      return false;
    }
    // Masses drawn from the seed, in the range LIGO actually sees.
    const rng = new RNG(this.params.seed ^ 0x9a7e);
    const m1 = rng.range(14, 42);
    const m2 = m1 * rng.range(0.55, 1);
    this.merger = new MergerView({ m1, m2, startSeparation: 26, fieldRadius: 300 });
    this.mergerT = -this.merger.inspiralS;
    this.strain = new StrainTrace({ binary: this.merger.binary });
    this.chirp = new ChirpAudio(this.merger.binary);
    // The reference the envelope divides by: the strain a moment before the
    // holes touch.
    this.chirp.calibrate(-0.001);
    this.root.add(this.merger.group);
    this.showGalaxy(false);
    this.timeScale = 1;   // one second per second: the chirp in real time
    const c = this.env.controls;
    c.snapTo(new THREE.Vector3(), 520, 0.4, 0.40);
    c.minDistance = 8;
    c.maxDistance = 4000;
    const cam = this.env.engine.camera;
    cam.near = 0.5; cam.far = 20000;
    cam.updateProjectionMatrix();
    return true;
  }

  /**
   * Look at a pulsar.
   *
   * What a star above eight solar masses leaves, once the envelope has gone as
   * a supernova: a sphere twelve kilometres across holding one and a half suns,
   * turning tens of times a second, with a magnetic field of a trillion gauss
   * carried in from a core the size of the Earth. It is the most extreme object
   * that can still be called a star, and it can be timed to a microsecond over
   * decades.
   *
   * Pressing it again moves to the next one, and the last of the four is one
   * this galaxy made rather than one the Earth has measured.
   */
  togglePulsar(): boolean {
    if (this.pulsarView) {
      this.psrIndex++;
      if (this.psrIndex <= PSR.MEASURED.length) { this.mountPulsar(); return true; }
      this.clearPulsar();
      return false;
    }
    this.psrIndex = 0;
    this.mountPulsar();
    return true;
  }

  private clearPulsar(): void {
    if (!this.pulsarView) return;
    this.root.remove(this.pulsarView.group);
    this.pulsarView.dispose();
    this.pulsarView = undefined;
    this.pulsar = undefined;
    this.ppdot = undefined;
    this.pulseAudio?.stop();
    this.pulseAudio = undefined;
    this.showGalaxy(true);
    this.timeScale = this.baseTimeScale;
    const c = this.env.controls;
    c.snapTo(new THREE.Vector3(), this.params.radiusKpc * 2.4, 0.45, 0.78);
    c.minDistance = 1e-7;
    c.maxDistance = this.params.radiusKpc * 40;
    const cam = this.env.engine.camera;
    cam.near = 1e-5; cam.far = this.params.radiusKpc * 400;
    cam.updateProjectionMatrix();
  }

  private mountPulsar(): void {
    if (this.pulsarView) {
      this.root.remove(this.pulsarView.group);
      this.pulsarView.dispose();
      this.pulsarView = undefined;
    }
    const rng = new RNG(this.params.seed ^ 0x50153);
    const m = PSR.MEASURED[this.psrIndex];
    if (m) {
      this.pulsar = PSR.pulsar(m.periodS, PSR.fieldFromSpin(m.periodS, m.pdot), {
        obliquity: 0.55 + 0.7 * ((this.psrIndex * 0.37) % 1),
        name: m.name,
        distancePc: 2000,
      });
    } else {
      // One of this galaxy's own, drawn from the same population the diagram
      // is plotted from.
      const pop = PSR.population(400, () => rng.next()).filter((p) => p.alive);
      this.pulsar = pop[Math.floor(rng.next() * pop.length)] ?? PSR.pulsar(0.7, 2e12);
      this.pulsar.name = `PSR ${this.params.name ?? 'J'}-${(rng.next() * 9999).toFixed(0)}`;
    }
    const p = this.pulsar;
    this.pulsarView = new PulsarView({
      obliquity: p.obliquity,
      beamHalfAngle: PSR.beamAngle(p.periodS),
      lightCylinderR: PSR.lightCylinderCm(p.periodS) / PSR.NS_RADIUS_CM,
      capAngle: PSR.polarCapAngle(p.periodS),
      heat: Math.max(0.15, Math.min(1, 1 - Math.log10(Math.max(p.ageYears, 10)) / 7)),
      seed: this.params.seed,
    });
    this.root.add(this.pulsarView.group);

    // The whole population behind it, so one object can be seen as a member of
    // a family rather than as a curiosity.
    this.ppdot = new PPDotDiagram({ title: 'period against slowing' });
    this.ppdot.setPopulation(PSR.population(1400, () => rng.next()));
    this.ppdot.mark(p);
    this.ppdot.setTrack(PPDotDiagram.history(p));

    // Drawn slowly enough to be an image rather than an alias. The sound is
    // not slowed.
    this.psrSlow = Math.max(1, p.periodS > 0 ? 0.9 / p.periodS : 1);
    this.psrPhase = 0;

    if (this.pulseAudio?.on) this.pulseAudio.start(p.periodS, PSR.beamingFraction(p));

    this.showGalaxy(false);
    this.timeScale = 1;
    // Framed on the magnetosphere, which is the only length in the problem:
    // the Crab's light cylinder is a hundred and sixty stellar radii out and a
    // millisecond pulsar's is seven, so one framing cannot serve both.
    const rlc = PSR.lightCylinderCm(p.periodS) / PSR.NS_RADIUS_CM;
    const c = this.env.controls;
    c.snapTo(new THREE.Vector3(), Math.min(72, Math.max(22, rlc * 2.6)), 0.62, 1.12);
    c.minDistance = 2.5;
    c.maxDistance = 900;
    const cam = this.env.engine.camera;
    cam.near = 0.15; cam.far = 8000;
    cam.updateProjectionMatrix();
  }

  /**
   * Feed a star to the black hole at the centre.
   *
   * The third way a star can end, and the only one that has nothing to do with
   * the star: a matter of where it happened to wander. Whether there is
   * anything to see at all depends on this particular galaxy's hole - above
   * about a hundred million solar masses the tidal radius is inside the
   * horizon and the star goes in whole, with no flare, which is why the
   * biggest black holes have never been caught doing this.
   */
  toggleTDE(): boolean {
    if (this.tde) {
      this.root.remove(this.tde.group);
      this.tde.dispose();
      this.tde = undefined;
      this.tdeDis = undefined;
      this.showGalaxy(true);
      this.timeScale = this.baseTimeScale;
      const c = this.env.controls;
      c.snapTo(new THREE.Vector3(), this.params.radiusKpc * 2.4, 0.45, 0.78);
      c.minDistance = 1e-7;
      c.maxDistance = this.params.radiusKpc * 40;
      const cam = this.env.engine.camera;
      cam.near = 1e-5; cam.far = this.params.radiusKpc * 400;
      cam.updateProjectionMatrix();
      return false;
    }
    const rng = new RNG(this.params.seed ^ 0x7d13);
    const beta = 0.9 + 1.4 * rng.next();
    // Whatever wandered in. Most stars are small, so most of these are.
    const ms = 0.3 + 1.4 * Math.pow(rng.next(), 2.2);
    let d = TDE.disruption(this.params.blackHoleMsun, ms, Math.pow(ms, 0.85), beta);
    if (!d.visible) {
      // Too big a hole for a main-sequence star - but the limit goes as the
      // three-halves power of the star's radius, so a giant is torn apart by a
      // hole a couple of hundred times heavier than one that swallows a dwarf
      // whole. Around the largest black holes, the only disruptions there can
      // ever be are of giants, and that is a real selection and not a
      // convenience: it is why the flares found around the heaviest holes are
      // the long slow ones.
      const giant = TDE.disruption(
        this.params.blackHoleMsun, 1.1, 18 + 55 * rng.next(), beta,
      );
      if (giant.visible) d = giant;
    }
    this.tdeDis = d;
    this.tde = new TDEView({
      disruption: this.tdeDis,
      count: this.env.quality() > 0.6 ? 14000 : 6000,
      seed: this.params.seed,
    });
    this.tdeU = -1;
    this.root.add(this.tde.group);
    this.showGalaxy(false);
    this.timeScale = 1;
    const c = this.env.controls;
    // Framed on the apocentre of the most bound debris, which is the only
    // length in the picture that is not either the horizon or infinity.
    const frame = this.tde.frameAu;
    c.snapTo(new THREE.Vector3(), frame, 0.62, 0.95);
    c.minDistance = frame * 1e-3;
    c.maxDistance = this.tde.reachAu * 60;
    const cam = this.env.engine.camera;
    cam.near = frame * 1e-4;
    cam.far = this.tde.reachAu * 600;
    cam.updateProjectionMatrix();
    return true;
  }

  private showGalaxy(on: boolean): void {
    this.view.group.visible = on;
    this.catalogPoints.visible = on;
    for (const n of this.nebulae) n.mesh.visible = on;
    if (this.bh) this.bh.mesh.visible = on;
    if (this.snCloud) this.snCloud.points.visible = on;
  }

  override overlay(): HTMLElement | null {
    if (this.strain) return this.strain.el;
    if (this.ppdot) { this.ppdot.draw(); return this.ppdot.el; }
    if (this.hr) { this.hr.draw(); return this.hr.el; }
    return null;
  }

  /**
   * Plot this galaxy's own stars on a Hertzsprung-Russell diagram.
   *
   * The sample is drawn from the same generator the catalogue uses - the
   * galaxy's initial mass function, its age, its metallicity gradient - so the
   * main sequence, the turnoff, the giant branch and the white dwarfs are not
   * drawn on: they appear because the population puts them there. A young
   * spiral and an old elliptical give visibly different diagrams, and the
   * turnoff is where the age is written.
   */
  toggleHR(): boolean {
    if (this.hr) { this.hr = undefined; return false; }
    const g = this.params;
    const n = this.env.quality() > 0.6 ? 2600 : 1500;
    const rng = new RNG(g.seed ^ 0x48522);
    const stars: Star[] = [];
    const weights: number[] = [];
    // Kroupa's slopes, used here as the weight rather than as the sampler: the
    // draw is flat in log mass so the whole sequence is populated, and how
    // common each kind is comes through as opacity instead.
    const kroupa = (m: number): number => (m < 0.5
      ? Math.pow(m / 0.08, -1.3)
      : Math.pow(0.5 / 0.08, -1.3) * Math.pow(m / 0.5, -2.3));
    const wHi = Math.log10(kroupa(0.08)), wLo = Math.log10(kroupa(60));
    for (let i = 0; i < n; i++) {
      const m = 0.08 * Math.pow(60 / 0.08, rng.next());
      // Two thirds of the draws are of stars that are still alive now, and one
      // third from the whole history - a mixture, because a uniform age draw
      // finds an O star alive one time in a thousand and the upper main
      // sequence comes out empty, while drawing only living stars loses every
      // white dwarf. The survival probability goes back into the weight, so
      // what the mixture buys is coverage and not a false abundance.
      const alive = rng.chance(0.66);
      const window = alive
        ? Math.min(g.ageGyr, 1.12 * msLifetimeGyr(m))
        : g.ageGyr;
      const ageGyr = rng.range(0.001, Math.max(window, 0.002));
      const rKpc = -g.discScaleKpc * Math.log(1 - rng.next() * 0.985);
      const metal = g.metallicity - 0.35 * (rKpc / Math.max(g.radiusKpc, 1e-3))
        + rng.normal(0, 0.12);
      stars.push(makeStar(m, ageGyr, metal));
      const survival = alive ? Math.min(1, window / Math.max(g.ageGyr, 1e-6)) : 1;
      const wlog = Math.log10(Math.max(kroupa(m) * survival, 1e-12));
      weights.push(Math.min(1, Math.max(0, (wlog - wLo) / Math.max(wHi - wLo, 1e-6))));
    }
    this.hr = new HRDiagram({
      title: `${g.type} · ${g.ageGyr.toFixed(1)} Gyr · `
        + `[Fe/H] ${g.metallicity >= 0 ? '+' : ''}${g.metallicity.toFixed(2)}`,
    });
    this.hr.setPopulation(stars, weights);
    return true;
  }

  /**
   * Turn the chirp into sound. Nothing is transposed: a stellar-mass merger
   * sweeps from tens of hertz to a few hundred, which is the audio band, so the
   * oscillator runs at the frequency the waveform actually has.
   */
  toggleChirpAudio(): 'on' | 'off' | 'unavailable' {
    if (this.pulsar) {
      if (this.pulseAudio?.on) { this.pulseAudio.stop(); this.pulseAudio = undefined; return 'off'; }
      this.pulseAudio = new PulseAudio();
      return this.pulseAudio.start(this.pulsar.periodS, PSR.beamingFraction(this.pulsar))
        ? 'on' : 'unavailable';
    }
    if (!this.chirp) return 'unavailable';
    if (this.chirp.on) { this.chirp.stop(); return 'off'; }
    return this.chirp.start() ? 'on' : 'unavailable';
  }

  /** Ring the star being inspected on the diagram, if it is open. */
  markOnHR(s: Star | null): void { this.hr?.mark(s); }

  update(dt: number): void {
    if (this.tde && this.tdeDis) {
      // Time runs in units of the first debris return, so the same pacing
      // works for a hole of any mass - which matters, because that return time
      // is forty days for a small one and years for a large.
      // The approach runs faster than the fallback, because it is: crossing
      // the tidal radius takes a day and the first debris comes back a
      // thousand years later.
      this.tdeU += dt * this.timeScale * (this.tdeU < 0 ? 0.28 : 0.14);
      if (this.tdeU > 7) this.tdeU = -1;
      this.tde.update(this.tde.timeFor(this.tdeU), this.env.engine.camera);
      this.sky.mesh.position.copy(this.env.engine.camera.position);
      return;
    }
    if (this.pulsarView && this.pulsar) {
      this.psrPhase += (dt * this.timeScale * 2 * Math.PI) / (this.pulsar.periodS * this.psrSlow);
      this.pulsarView.update(this.psrPhase, this.simTime, this.env.engine.camera);
      this.sky.mesh.position.copy(this.env.engine.camera.position);
      return;
    }
    if (this.merger) {
      // timeScale is set to zero by the app while paused and multiplied by the
      // time warp, so reading it back is how the merger inherits both.
      this.mergerT += dt * this.timeScale;
      // Hold on the remnant for a moment, then run it again.
      if (this.mergerT > 0.45) this.mergerT = -this.merger.inspiralS;
      this.merger.update(this.mergerT, this.env.engine.camera);
      this.strain?.update(this.mergerT);
      this.chirp?.update(this.mergerT);
      this.sky.mesh.position.copy(this.env.engine.camera.position);
      return;
    }
    if (this.encounter && this.encounterCloud) {
      this.simTime += dt * this.timeScale;
      // Advance in whole steps, capped so a large time warp costs frame rate
      // rather than dropping the integration into instability.
      const want = (dt * this.timeScale) / this.encounter.dt;
      const steps = Math.min(48, Math.max(0, Math.round(want)));
      for (let i = 0; i < steps; i++) this.encounter.step(this.encounter.dt);
      this.encounterSteps += steps;
      this.encounterCloud.updateFrom(this.encounter.pos, this.encounter.count);
      const com = this.encounter.centreOfMass();
      this.env.controls.target.set(com[0], com[1], com[2]);
      this.sky.mesh.position.copy(this.env.engine.camera.position);
      return;
    }
    this.simTime += dt * this.timeScale;
    const cam = this.env.engine.camera.position;
    this.view.update(cam, dt * this.timeScale);
    this.sky.mesh.position.copy(cam);
    for (const n of this.nebulae) n.update(cam, this.simTime * 0.02);
    this.bh?.update(cam, this.simTime * 0.02);

    // Move the catalogue stars along their orbits, on the CPU, so they can be
    // picked and so their positions are exactly what the shader draws.
    const t = this.view.timeMyr;
    const attr = this.catalogPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.catalog.length; i++) {
      const s = this.catalog[i];
      const th = s.theta0 + s.omega * t;
      const phi = s.tilt + this.patternRate * t;
      const lx = s.a * Math.cos(th), ly = s.b * Math.sin(th);
      const cs = Math.cos(phi), sn = Math.sin(phi);
      s.pos.set(lx * cs - ly * sn, s.z, lx * sn + ly * cs);
      attr.setXYZ(i, s.pos.x, s.pos.y, s.pos.z);
    }
    attr.needsUpdate = true;

    this.updateSupernovae(dt);

    // The catalogue markers only help when you are close enough to aim at one.
    const d = this.env.controls.distance;
    (this.catalogPoints.material as THREE.RawShaderMaterial).uniforms.uOpacity.value =
      0.55 * Math.min(1, Math.max(0, (this.params.radiusKpc * 6 - d) / (this.params.radiusKpc * 4)));
  }

  /** Advance the supernova display; see the note on its clock above. */
  private updateSupernovae(dt: number): void {
    const cloud = this.snCloud;
    if (!cloud) return;
    const g = this.params;
    const running = this.timeScale > 0;
    if (running) {
      this.snSpawnAccum += dt * GalaxyStage.SN_MAX_PER_SECOND;
      while (this.snSpawnAccum >= 1) {
        this.snSpawnAccum -= 1;
        this.spawnSupernova();
      }
    }

    const dDays = running ? dt * GalaxyStage.SN_YEARS_PER_SECOND * 365.25 : 0;
    let n = 0;
    const pos = cloud.positions;
    const col = cloud.colors;
    const sty = cloud.style;
    for (const e of this.snEvents) {
      if (!e.alive) continue;
      e.days += dDays;
      const mag = lightCurve(e.type, e.days);
      if (mag > 2) { e.alive = false; continue; }  // faded below anything visible
      const L = magnitudeToLuminosity(mag);
      const c = supernovaColor(e.type, e.days);
      pos[n * 3] = e.x; pos[n * 3 + 1] = e.y; pos[n * 3 + 2] = e.z;
      col[n * 3] = c[0]; col[n * 3 + 1] = c[1]; col[n * 3 + 2] = c[2];
      // A supernova at peak briefly outshines a billion suns; the sprite is
      // scaled against the galaxy's own exposure so it reads as that.
      sty[n * 2] = 1 + 0.5 * Math.log10(Math.max(L / 1e8, 1));
      sty[n * 2 + 1] = Math.min(6, L / 6e8);
      n++;
    }
    this.snCount = n;
    cloud.setPositions(n);
    cloud.touchAppearance();
    void g;
  }

  private spawnSupernova(): void {
    const slot = this.snEvents.find((e) => !e.alive);
    if (!slot) return;
    const g = this.params;
    const rng = new RNG(hash3(this.encounterSteps, Math.floor(this.simTime * 977), 7, g.seed));
    const cc = coreCollapseRate(g.sfrMsunYr);
    const ia = typeIaRate(g.stellarMassMsun, g.sfrMsunYr);
    const coreCollapse = rng.chance(cc / Math.max(cc + ia, 1e-30));
    slot.type = coreCollapse ? (rng.chance(0.75) ? 'II-P' : 'Ib/c') : 'Ia';
    // Core collapse happens where its short-lived progenitors formed - in the
    // arms. Type Ia progenitors are old white dwarfs, so they go off anywhere.
    const a = Math.max(0.1, -g.discScaleKpc * Math.log(1 - rng.next() * 0.99));
    const a0 = Math.max(0.35, g.discScaleKpc * 0.55);
    const tan = Math.tan(g.pitch);
    const th = coreCollapse && g.arms > 0
      ? Math.log(Math.max(a, 0.02) / a0) / tan + rng.normal(0, 0.13)
        + (rng.int(0, Math.max(0, g.arms - 1)) * 2 * Math.PI) / g.arms
        + this.patternRate * this.view.timeMyr
      : rng.range(0, Math.PI * 2);
    slot.x = a * Math.cos(th);
    slot.z = a * Math.sin(th);
    slot.y = rng.normal(0, g.thicknessKpc * (coreCollapse ? 0.5 : 1));
    slot.days = 0;
    slot.alive = true;
  }

  rows(): Row[] {
    const g = this.params;
    const rSun = 2.2 * g.discScaleKpc;
    const [dv, du] = formatDistance(this.env.controls.distance * 3.0857e19);
    if (this.tde && this.tdeDis) return this.tdeRows(this.tdeDis);
    if (this.pulsar) return this.pulsarRows(this.pulsar);
    if (this.merger) return this.mergerRows(this.merger);
    if (this.encounter) {
      const e = this.encounter;
      const since = Number.isFinite(e.pericentreTime) ? e.time - e.pericentreTime : NaN;
      return [
        { k: 'encounter', v: e.label, accent: true },
        { k: 'elapsed', v: e.time.toFixed(0), u: 'Myr' },
        { k: 'separation', v: e.separation.toFixed(1), u: 'kpc' },
        { k: 'closest', v: e.minSeparation.toFixed(1), u: 'kpc' },
        { k: 'since peri', v: Number.isFinite(since) && since > 0 ? `${since.toFixed(0)} Myr` : '—' },
        { k: 'tidal debris', v: `${(e.tidalFraction(g.radiusKpc) * 100).toFixed(1)}`, u: '%' },
        { k: 'tracers', v: commas(e.count) },
        { k: 'steps', v: commas(this.encounterSteps) },
        { k: 'field of view', v: dv, u: du },
      ];
    }
    return [
      { k: 'type', v: g.type, accent: true },
      { k: 'stellar mass', v: sig(g.stellarMassMsun, 3), u: 'M☉' },
      { k: 'disc scale', v: g.discScaleKpc.toFixed(2), u: 'kpc' },
      { k: 'v(circular)', v: Math.round(rotationCurve(g, rSun)).toString(), u: 'km/s' },
      { k: 'rotation', v: Math.round(this.env.universe.orbitalPeriodMyr(g, rSun)).toString(), u: 'Myr' },
      { k: 'star formation', v: g.sfrMsunYr.toFixed(2), u: 'M☉/yr' },
      { k: 'central BH', v: sig(g.blackHoleMsun, 2), u: 'M☉' },
      { k: 'supernovae', v: this.view.buffers.stats.supernovaePerCentury.toFixed(2), u: '/century' },
      { k: 'remnants', v: commas(this.view.buffers.stats.snrTrueCount) },
      { k: 'now shining', v: this.snCount.toString() },
      { k: 'elapsed', v: (this.simTime).toFixed(0), u: 'Myr' },
      { k: 'field of view', v: dv, u: du },
    ];
  }

  override setBoost(beta: number, dir: THREE.Vector3): void {
    this.sky.setBoost(beta, dir);
  }

  /**
   * What is known about a neutron star, and how.
   *
   * Only two of these are measured: the period and how fast it is lengthening.
   * Everything else - the field, the age, the power, the size of the
   * magnetosphere - is those two put through the vacuum dipole formula. The
   * readout says so, because a plot of derived quantities that does not say
   * which of them were observed is not a measurement, it is a claim.
   */
  /** What is happening to the star, and what could be measured about it. */
  private tdeRows(d: TDE.Disruption): Row[] {
    const v = this.tde;
    const tmin = TDE.fallbackTime(d.holeKg, d.starKg, d.starR);
    const days = (v ? v.timeFor(this.tdeU) : 0) / DAY;
    const rt = TDE.tidalRadius(d.holeKg, d.starKg, d.starR) / AU;
    const rs = TDE.horizonRadius(d.holeKg) / AU;
    const hills = TDE.hillsMassKg(d.starKg, d.starR) / M_SUN;
    const lum = v?.luminosity ?? 0;
    const rows: Row[] = [
      { k: 'event', v: this.tdeU < 0 ? 'a star, falling in'
        : d.visible ? 'tidal disruption' : 'swallowed whole', accent: true },
      { k: 'the star', v: `${sig(d.starKg / M_SUN, 2)} M☉ · ${sig(d.starR / R_SUN, 2)} R☉`
        + (d.starR / R_SUN > 8 ? ' · a giant' : '') },
      { k: 'the hole', v: `${sig(d.holeKg / M_SUN, 3)} M☉` },
      { k: 'tidal radius', v: `${sig(rt, 3)} AU · ${sig(rt / rs, 2)} horizons` },
      { k: 'heaviest that could', v: `${sig(hills, 2)} M☉ · `
        + (d.visible ? 'this one can' : 'this one cannot') },
      { k: 'closest approach', v: `${sig(rt / d.beta, 3)}`, u: 'AU' },
      { k: 'first debris back', v: `${sig(tmin / DAY, 3)}`, u: 'days' },
      { k: 'ejecta', v: `${sig(TDE.ejectaSpeed(d.holeKg, d.starKg, d.starR) / 1e3, 3)}`, u: 'km/s' },
      { k: 'since disruption', v: this.tdeU < 0
        ? `${sig(-days, 2)} days to go`
        : Math.abs(days) > 400 ? `${sig(days / 365.25, 3)} yr` : `${sig(days, 3)} days` },
    ];
    if (this.tdeU > 0) {
      rows.push(
        { k: 'returned', v: `${((v?.returnedFraction ?? 0) * 100).toFixed(1)}% of the star` },
        { k: 'luminosity', v: `${sig(lum * 1e7, 3)}`, u: 'erg/s' },
        { k: 'against Eddington', v: `×${sig(lum / TDE.eddingtonLuminosity(d.holeKg), 2)}` },
        { k: 'colour', v: `${sig(TDE.flareTemperature(d, this.tdeU * tmin), 3)} K · ultraviolet` },
        { k: 'apparent size', v: `${sig(TDE.emittingRadius(d.holeKg) / AU, 2)} AU · `
          + `${sig(TDE.emittingRadius(d.holeKg) / TDE.horizonRadius(d.holeKg), 2)} horizons` },
      );
    }
    return rows;
  }

  private pulsarRows(p: PSR.Pulsar): Row[] {
    const turns = 1 / p.periodS;
    const age = PSR.characteristicAgeYears(p);
    const cls = PSR.classify(p);
    const rlc = PSR.lightCylinderCm(p.periodS) / 1e5;
    const dm = PSR.dispersionMeasure(p.distancePc);
    return [
      { k: 'pulsar', v: p.name ?? cls.label, accent: true },
      { k: 'kind', v: cls.label },
      { k: 'period', v: p.periodS < 0.1
        ? `${(p.periodS * 1e3).toFixed(3)} ms` : `${sig(p.periodS, 4)} s` },
      { k: 'turns', v: turns > 1 ? `${sig(turns, 3)} a second` : `once every ${sig(p.periodS, 2)} s` },
      { k: 'lengthening', v: `${p.pdot.toExponential(2)}`, u: 's/s' },
      { k: 'field', v: `${p.fieldG.toExponential(2)} G · inferred` },
      { k: 'age', v: age < 1e6
        ? `${sig(age, 3)} yr` : `${sig(age / 1e6, 3)} Myr`, },
      { k: 'spin-down', v: `${PSR.spinDownPower(p).toExponential(2)}`, u: 'erg/s' },
      { k: 'light cylinder', v: `${sig(rlc, 3)} km · ${sig(rlc / 10, 2)} radii` },
      { k: 'equator at', v: `${(PSR.surfaceBeta(p.periodS) * 100).toFixed(2)}% of c` },
      { k: 'beam', v: `${((PSR.beamAngle(p.periodS) * 180) / Math.PI).toFixed(0)}° · `
        + `${(PSR.beamingFraction(p) * 100).toFixed(0)}% of the sky` },
      { k: 'dispersion', v: `${sig(dm, 3)} pc/cm³ · `
        + `${sig(PSR.dispersionDelay(dm, 400, 800), 2)} s across a band` },
      { k: 'shown at', v: this.psrSlow > 1.05
        ? `1/${sig(this.psrSlow, 3)} speed · heard at its own` : 'its own rate' },
    ];
  }

  private mergerRows(m: MergerView): Row[] {
    const b = m.binary;
    const st = m.state;
    const mf = finalMass(b.m1, b.m2);
    const spin = finalSpin(b.m1, b.m2);
    const rad = radiatedFraction(b.m1, b.m2) * (b.m1 + b.m2);
    const before = st.stage === 'inspiral';
    return [
      { k: 'binary', v: `${b.m1.toFixed(1)} + ${b.m2.toFixed(1)} M☉`, accent: true },
      { k: 'chirp mass', v: chirpMass(b.m1, b.m2).toFixed(1), u: 'M☉' },
      { k: 'separation', v: before
        ? `${(st.separationM / 1e3).toFixed(0)} km · ${(st.separationM / m.rgM).toFixed(1)} GM/c²`
        : 'merged' },
      { k: 'wave frequency', v: st.freqHz.toFixed(st.freqHz < 100 ? 1 : 0), u: 'Hz' },
      { k: 'strain at 410 Mpc', v: st.strain.toExponential(2) },
      { k: 'to coalescence', v: before ? `${(-st.t).toFixed(3)} s` : st.stage },
      { k: 'remnant', v: `${mf.toFixed(1)} M☉ · a = ${spin.toFixed(3)}` },
      { k: 'radiated', v: `${rad.toFixed(2)} M☉ as gravity` },
      { k: 'ringdown', v: `${m.ringdownMode.freqHz.toFixed(0)} Hz · ${(m.ringdownMode.tauS * 1e3).toFixed(1)} ms` },
      { k: 'peak power', v: `${(peakLuminosity(b.m1, b.m2) / PLANCK_LUMINOSITY * 100).toFixed(2)}% of c⁵/G` },
      { k: 'field of view', v: `${(this.env.controls.distance * m.rgM / 1e3).toFixed(0)} km` },
    ];
  }

  scaleLabel(): string {
    // Every one of the things that can be mounted at this scale brings its own
    // ruler with it, because each has exactly one natural length: a black hole
    // has its gravitational radius, a neutron star has its ten kilometres, a
    // disrupted star has the astronomical unit, and the galaxy itself has the
    // kiloparsec. Reporting one of those in another's units is how a readout
    // starts saying a debris stream is twelve megaparsecs across.
    if (this.merger) {
      return `${(this.env.controls.distance * this.merger.rgM / 1e3).toFixed(0)} km`;
    }
    if (this.tde) {
      const [v, u] = formatDistance(this.env.controls.distance * AU);
      return `${v} ${u}`;
    }
    if (this.pulsarView) {
      // Scene units are stellar radii, and a neutron star's is ten kilometres.
      const [v, u] = formatDistance(this.env.controls.distance * (PSR.NS_RADIUS_CM / 100));
      return `${v} ${u}`;
    }
    const [v, u] = formatDistance(this.env.controls.distance * 3.0857e19);
    return `${v} ${u}`;
  }

  override inspect(ndc: THREE.Vector2): Inspection | null {
    const i = this.pickNearest(ndc, this.catalog.map((s) => ({
      pos: s.pos, radius: this.params.discScaleKpc * 0.012, index: s.index,
    })), 0.018);
    if (i === null) return null;
    const u = this.env.universe;
    const s = u.star(this.params, i);
    const st = s.star;
    const sys = u.system(this.params, i);
    const habitables = sys.system.planets.filter((p) => p.habitable).length;
    this.markOnHR(st);
    return {
      title: s.name,
      kind: starLabel(st),
      swatch: `rgb(${st.color.map((c) => Math.round(Math.min(1, c) * 255)).join(',')})`,
      rows: [
        { k: 'mass', v: st.massMsun.toFixed(2), u: 'M☉' },
        { k: 'luminosity', v: sig(st.luminosityLsun, 3), u: 'L☉' },
        { k: 'temperature', v: Math.round(st.teff).toString(), u: 'K' },
        { k: 'radius', v: st.radiusRsun.toFixed(3), u: 'R☉' },
        { k: 'age', v: st.ageGyr.toFixed(2), u: 'Gyr' },
        { k: 'planets', v: sys.system.planets.length.toString() },
        { k: 'habitable', v: habitables.toString() },
        { k: 'galactic r', v: s.radiusKpc.toFixed(2), u: 'kpc' },
      ],
      note: habitables > 0 ? 'At least one world here has liquid water on its surface.' : undefined,
      spectrum: { tempK: st.teff, metallicity: st.metallicity },
    };
  }

  child(ndc?: THREE.Vector2): Target | null {
    let idx: number | null = 0;
    if (ndc) {
      idx = this.pickNearest(ndc, this.catalog.map((s) => ({
        pos: s.pos, radius: this.params.discScaleKpc * 0.02, index: s.index,
      })), 0.04);
      if (idx === null) return null;
    } else {
      // Prefer a star with a habitable world, near the middle of the view.
      const cam = this.env.engine.camera.position;
      let best = 0, bestScore = -Infinity;
      for (let i = 0; i < Math.min(this.catalog.length, 400); i++) {
        const s = this.catalog[i];
        const sys = this.env.universe.system(this.params, s.index);
        const hab = sys.system.planets.some((p) => p.habitable) ? 3 : 0;
        const score = hab - Math.log10(s.pos.distanceTo(cam) + 0.01);
        if (score > bestScore) { bestScore = score; best = i; }
      }
      idx = this.catalog[best].index;
    }
    const s = this.env.universe.star(this.params, idx);
    return {
      id: 'system',
      ctx: { cluster: this.ctx.cluster, member: this.ctx.member, star: idx },
      label: s.name,
    };
  }

  override dispose(): void {
    this.view.dispose();
    this.snCloud?.dispose();
    this.encounterCloud?.dispose();
    for (const n of this.nebulae) n.dispose();
    this.bh?.dispose();
    this.sky.dispose();
    super.dispose();
  }
}

// ---------------------------------------------------------------------------
// SYSTEM
// ---------------------------------------------------------------------------

export class SystemStage extends Stage {
  readonly id = 'system' as const;
  title = 'System';
  subtitle = '';
  private view!: SystemView;
  private sky!: SkyDome;
  private starName = '';
  private builtSystem!: PlanetarySystem;
  /** Minimum apparent radius for bodies; 0 is strict true scale. */
  minAngular = 0.0045;

  // --- Stellar evolution.
  private evolving = false;
  /** Age the star is being shown at, Gyr. */
  private evoAge = 0;
  private evoStar?: Star;
  private evoHR?: HRDiagram;
  private evoTrack: { teff: number; lum: number }[] = [];
  /** Star radius in AU at the current age, and the AU of the star's own scale. */
  private evoRadiusAu = 0;
  private evoEngulfed = 0;
  /** The envelope, once the star has thrown it off. */
  private evoNebula?: PlanetaryNebula;
  /** Real seconds since the ejection, which is not the same clock as the age. */
  private evoNebulaT = 0;
  /** Years since the ejection, on the nebula's own stretched clock. */
  private evoNebulaYr = 0;
  private evoShellAu = 0;
  /** Camera framing to put back when the run restarts. */
  private evoFraming?: { maxDistance: number; far: number };

  build(): void {
    const u = this.env.universe;
    const g = u.galaxy(this.ctx.cluster ?? 0, this.ctx.member ?? 0);
    const si = this.ctx.star ?? 0;
    const { system, name, seed } = this.ctx.real
      ? { system: solarSystem(), name: 'Sol', seed: 0x50143 }
      : u.system(g, si);
    this.builtSystem = system;
    this.starName = name;
    this.title = name;
    const st = system.star;
    const comp = system.companion;
    this.subtitle = comp
      ? `${starLabel(st)} + ${starLabel(comp.star)} · ${system.planets.length} ` +
        `${system.host === 'circumbinary' ? 'circumbinary ' : ''}planets · ` +
        `separation ${sig(comp.aM / AU, 2)} AU`
      : `${starLabel(st)} · ${system.planets.length} planets · ` +
        `${st.massMsun.toFixed(2)} M☉ · ${sig(st.luminosityLsun, 2)} L☉`;
    // Pace the clock by the system's own outermost orbit rather than by a
    // fixed year per second. Around an M dwarf every planet is inside a tenth
    // of an AU and orbits in weeks, so a year a second is nine laps a second -
    // a blur, with a comet's entire apparition gone between two frames.
    const outerAuForClock = system.planets.length
      ? system.planets[system.planets.length - 1].au : 5;
    const outerPeriod = 2 * Math.PI * Math.sqrt(
      Math.pow(outerAuForClock * AU, 3) / (G * st.currentMassMsun * M_SUN));
    this.timeScale = Math.min(YEAR * 40, Math.max(YEAR * 0.02, outerPeriod / 8));

    this.sky = new SkyDome({ brightness: 0.6, bandStrength: 0.009, seed, nebula: 0.005 });
    this.sky.mesh.scale.setScalar(1e6);
    this.root.add(this.sky.mesh);

    this.view = new SystemView(system, seed, {
      minAngularRadius: this.minAngular, detailed: true,
    });
    this.root.add(this.view.group);

    // Frame everything worth seeing: the outermost planet, the habitable zone
    // and the snow line, whichever reaches furthest.
    const outer = system.planets.length ? system.planets[system.planets.length - 1].au : 5;
    const span = Math.max(outer, st.habitableZoneAu[1] * 1.1, system.snowLineAu * 0.9);
    const c = this.env.controls;
    c.snapTo(new THREE.Vector3(), span * 1.55, 0.5, 0.62);
    c.drift = 0.010;
    c.minDistance = 1e-6;
    c.maxDistance = span * 40;
    const cam = this.env.engine.camera;
    cam.near = 1e-5; cam.far = span * 900;
    cam.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.simTime += dt * this.timeScale;
    if (this.evolving && this.timeScale > 0) this.stepEvolution(dt);
    this.view.update(this.simTime, this.env.engine.camera);
    this.sky.mesh.position.copy(this.env.engine.camera.position);
  }

  get system(): PlanetarySystem {
    if (this.ctx.real) return this.builtSystem;
    const g = this.env.universe.galaxy(this.ctx.cluster ?? 0, this.ctx.member ?? 0);
    return this.env.universe.system(g, this.ctx.star ?? 0).system;
  }

  rows(): Row[] {
    const sys = this.system;
    const st = sys.star;
    const [dv, du] = formatDistance(this.env.controls.distance * AU);
    const [tv, tu] = formatTime(this.simTime);
    const comp = sys.companion;
    if (comp) {
      return [
        { k: 'primary', v: starLabel(st), accent: true },
        { k: 'companion', v: starLabel(comp.star) },
        { k: 'separation', v: sig(comp.aM / AU, 3), u: 'AU' },
        { k: 'binary period', v: formatTime(comp.periodS).join(' ') },
        { k: 'eccentricity', v: comp.e.toFixed(3) },
        { k: 'planets', v: `${sys.planets.length} · ${sys.host}` },
        { k: 'stable beyond', v: sys.host === 'circumbinary'
          ? `${sig(comp.pTypeLimit / AU, 2)} AU` : `inside ${sig(comp.sTypeLimit / AU, 2)} AU` },
        { k: 'habitable zone', v: `${st.habitableZoneAu[0].toFixed(2)}–${st.habitableZoneAu[1].toFixed(2)}`, u: 'AU' },
        { k: 'elapsed', v: tv, u: tu },
        { k: 'field of view', v: dv, u: du },
      ];
    }
    return [
      { k: 'star', v: starLabel(st), accent: true },
      { k: 'mass', v: st.massMsun.toFixed(3), u: 'M☉' },
      { k: 'luminosity', v: sig(st.luminosityLsun, 3), u: 'L☉' },
      { k: 'temperature', v: Math.round(st.teff).toString(), u: 'K' },
      { k: 'habitable zone', v: `${st.habitableZoneAu[0].toFixed(2)}–${st.habitableZoneAu[1].toFixed(2)}`, u: 'AU' },
      { k: 'snow line', v: sys.snowLineAu.toFixed(2), u: 'AU' },
      { k: 'planets', v: sys.planets.length.toString() },
      { k: 'body scale', v: this.minAngular === 0 ? 'true' : `×${sig(this.view.magnification, 2)}` },
      ...this.evolutionRows(),
      ...this.cometRows(),
      { k: 'elapsed', v: tv, u: tu },
      { k: 'field of view', v: dv, u: du },
    ];
  }

  /** Where the star is in its life, while it is being aged. */
  private evolutionRows(): Row[] {
    const s = this.evoStar;
    if (!this.evolving || !s) return [];
    const st0 = this.system.star;
    const life = msLifetimeGyr(st0.massMsun);
    if (this.evoNebula) return this.nebulaRows(this.evoNebula, life);
    const phase = s.kind === 'main-sequence'
      ? `main sequence · ${((this.evoAge / life) * 100).toFixed(0)}% through`
      : s.kind;
    return [
      { k: 'age', v: this.evoAge < 1
        ? `${(this.evoAge * 1000).toFixed(0)} Myr` : `${sig(this.evoAge, 3)} Gyr`, accent: true },
      { k: 'phase', v: phase },
      { k: 'radius now', v: `${sig(s.radiusRsun, 3)} R☉ · ${sig(this.evoRadiusAu, 2)} AU` },
      { k: 'luminosity now', v: sig(s.luminosityLsun, 3), u: 'L☉' },
      { k: 'surface now', v: Math.round(s.teff).toString(), u: 'K' },
      { k: 'swallowed', v: this.evoEngulfed
        ? `${this.evoEngulfed} of ${this.system.planets.length} planets`
        : 'nothing yet' },
      { k: 'lifetime', v: life < 1
        ? `${(life * 1000).toFixed(0)} Myr` : `${sig(life, 3)} Gyr` },
    ];
  }

  /**
   * The nebula, while it is expanding.
   *
   * The numbers here are the ones worth carrying away. Half the star has left,
   * and it is going at twenty-five kilometres a second whatever else is true.
   * The shell passes Neptune within a decade and reaches a light-year in twelve
   * thousand years, and none of it will still be visible in fifty thousand -
   * the gas thins into the interstellar medium and becomes the raw material of
   * the next generation of stars, which is where most of the carbon in a human
   * body came from. The clock row says how badly time is being stretched to
   * show all of that at once, because it is being stretched a long way.
   */
  private nebulaRows(pn: PlanetaryNebula, life: number): Row[] {
    const yr = this.evoNebulaYr;
    const au = this.evoShellAu;
    const size = au > 20_000
      ? `${sig((au * AU) / LY, 3)} ly` : `${sig(au, 3)} AU`;
    const survivors = this.system.planets.length - this.evoEngulfed;
    const passed = this.system.planets.filter(
      (pl, i) => i >= this.evoEngulfed && pl.au < au).length;
    // How fast the clock is running right now, in years of shell per second.
    // Differenced rather than derived, so it cannot drift out of step with the
    // schedule above however that schedule is later changed.
    const t = this.evoNebulaT;
    const rate = Math.max(0,
      (this.nebulaYears(t + 0.05, pn) - this.nebulaYears(Math.max(t - 0.05, 0), pn))
      / Math.min(0.1, t + 0.05));
    const ion = ionisedFraction(pn, yr * YEAR);
    const done = yr > pn.lifetimeS / YEAR;
    const phase = ion < 0.02
      ? (t <= SystemStage.SWEEP_S
        ? 'proto-planetary nebula · dust in starlight'
        : 'drifting · the core is still contracting')
      : ion < 0.98 ? 'lighting up'
      : done ? 'nebula fading' : 'planetary nebula';
    return [
      { k: 'phase', v: phase, accent: true },
      { k: 'since ejection', v: yr < 1000
        ? `${sig(yr, 3)} yr` : `${sig(yr / 1000, 3)} kyr` },
      { k: 'shell radius', v: size },
      { k: 'expanding at', v: `${(pn.speed / 1e3).toFixed(0)}`, u: 'km/s' },
      { k: 'swept past', v: survivors
        ? `${passed} of ${survivors} surviving planets` : 'nothing left to pass' },
      { k: 'ejected', v: `${sig(pn.ejectedMsun, 3)} M☉ back to the galaxy` },
      { k: 'core now', v: ion < 0.98
        ? `${sig(pn.remnantMsun, 3)} M☉ · still contracting`
        : `${sig(pn.remnantMsun, 3)} M☉ · ${Math.round(pn.centralTempK / 1000)} kK` },
      { k: 'lights up at', v: `${sig(transitionTimeS(pn) / YEAR / 1000, 2)} kyr` },
      { k: 'visible for', v: `${sig(pn.lifetimeS / YEAR / 1000, 2)} kyr` },
      { k: 'clock', v: `${sig(rate, 2)} yr/s of a ${sig(life, 2)} Gyr life` },
    ];
  }

  /**
   * The brightest comet currently switched on, if any. A comet is inert for
   * almost all of its orbit, so this row appears only while one is inside its
   * own ice line - which is exactly when there is something to look at.
   */
  private cometRows(): Row[] {
    let best: (typeof this.view.comets)[number] | null = null;
    for (const c of this.view.comets) {
      if (c.activityNow > 0.004 && (!best || c.activityNow > best.activityNow)) best = c;
    }
    if (!best) return [];
    return [
      { k: 'comet', v: best.comet.name, accent: true },
      { k: 'distance', v: sig(best.heliocentricAu, 2), u: 'AU' },
      { k: 'tails', v: `${sig(best.dustTailAu, 2)} AU dust · ${sig(best.ionTailAu, 2)} AU ion` },
    ];
  }

  override setBoost(beta: number, dir: THREE.Vector3): void {
    this.sky.setBoost(beta, dir);
  }

  /**
   * Run the star's whole life.
   *
   * A star's structure is a function of its mass and its age and almost nothing
   * else, so aging it is just re-evaluating the same model at a later time and
   * watching what falls out: the luminosity climbing by a third across the main
   * sequence, the swell onto the giant branch, the surface cooling from yellow
   * to red as the radius runs away, the habitable zone sweeping outward past
   * one world after another, and the inner planets going inside the
   * photosphere. The Sun will do all of this, and Mercury and Venus are inside
   * the radius it reaches.
   *
   * Time is parameterised by age over main-sequence lifetime rather than in
   * years, because the same run then works for an O star that lives three
   * million years and an M dwarf that lives six trillion - and the readout
   * says which.
   */
  toggleEvolution(): boolean {
    if (this.evolving) {
      this.evolving = false;
      this.evoHR = undefined;
      this.evoTrack = [];
      if (this.evoNebula) this.endNebula(msLifetimeGyr(this.system.star.massMsun));
      this.view.setStarRadiusRsun(null);
      this.view.starView.setTemperature(this.system.star.teff);
      const st = this.system.star;
      this.view.setHabitableZone(st.habitableZoneAu[0], st.habitableZoneAu[1]);
      for (let i = 0; i < this.view.slots.length; i++) this.view.setPlanetEngulfed(i, false);
      this.evoEngulfed = 0;
      return false;
    }
    this.evolving = true;
    const st = this.system.star;
    this.evoAge = msLifetimeGyr(st.massMsun) * 0.02;
    this.evoTrack = [];
    this.evoHR = new HRDiagram({ title: `${starLabel(st)} · its whole life` });
    this.evoHR.setPopulation([]);
    return true;
  }

  override overlay(): HTMLElement | null {
    if (!this.evoHR) return null;
    this.evoHR.draw();
    return this.evoHR.el;
  }

  /** Advance the star's age and re-evaluate everything downstream of it. */
  private stepEvolution(dt: number): void {
    const st0 = this.system.star;
    const life = msLifetimeGyr(st0.massMsun);
    // Once the envelope is off, the age clock stops and the nebula's own runs.
    if (this.evoNebula) { this.stepNebula(dt, life); return; }
    // Fifty seconds from the zero-age main sequence to well past the end.
    const over = this.evoAge / life;
    const next = Math.min(1.34, over + (dt * 1.32) / 50);
    // The tip of the giant branch. For a star between about one and eight solar
    // masses this is where the envelope goes, and the run stops to watch it.
    const pn = planetaryNebula(st0.massMsun);
    if (pn.occurs && over < 1.12 && next >= 1.12) { this.beginNebula(pn, life); return; }
    this.evoAge = next * life;
    const s = makeStar(st0.massMsun, this.evoAge, st0.metallicity);
    this.evoStar = s;
    this.evoRadiusAu = (s.radiusRsun * R_SUN) / AU;

    this.view.setStarRadiusRsun(s.radiusRsun);
    this.view.starView.setTemperature(s.teff);
    const [hzIn, hzOut] = habitableZone(s.luminosityLsun, s.teff);
    this.view.setHabitableZone(hzIn, hzOut);

    let engulfed = 0;
    for (let i = 0; i < this.view.slots.length; i++) {
      const inside = this.view.slots[i].planet.au < this.evoRadiusAu;
      this.view.setPlanetEngulfed(i, inside);
      if (inside) engulfed++;
    }
    this.evoEngulfed = engulfed;

    if (this.evoHR) {
      const last = this.evoTrack[this.evoTrack.length - 1];
      if (!last || Math.abs(Math.log10(s.luminosityLsun / last.lum)) > 0.006
        || Math.abs(Math.log10(s.teff / last.teff)) > 0.002) {
        this.evoTrack.push({ teff: s.teff, lum: s.luminosityLsun });
        if (this.evoTrack.length > 900) this.evoTrack.shift();
        this.evoHR.setTrack(this.evoTrack);
      }
      this.evoHR.mark(s);
    }
    if (next >= 1.34) this.evoAge = life * 0.02;
  }

  // --- The nebula phase.
  //
  // The envelope leaves at 25 km/s and two entirely different things happen at
  // that one speed. It crosses the planetary system in a few years, sweeping
  // over each surviving world in turn; and then it goes on for twenty thousand
  // more, thinning and fading, until it is a light-year of gas too tenuous to
  // see. Those two are three orders of magnitude apart in time and four in
  // size, so a single linear clock can show one or the other and never both.
  //
  // So the clock is explicitly in two pieces - five seconds of real time at a
  // couple of years each for the sweep, then sixteen seconds of exponential time
  // for the nebula - and the readout says at every moment how fast it is
  // running. A time axis that lies quietly is worse than one that stretches
  // and admits it.

  /** Real seconds spent on the sweep through the planetary system. */
  private static readonly SWEEP_S = 6;
  /**
   * Years of expansion covered in that time. Neptune is thirty astronomical
   * units out and the envelope is doing twenty-five kilometres a second, so it
   * crosses that orbit in five years and nine months. Fourteen years takes the
   * front well past it while leaving the crossing itself watchable.
   */
  private static readonly SWEEP_YR = 14;
  /**
   * Real seconds spent drifting in the dark. Between the envelope leaving the
   * planetary system and the core getting hot enough to light it up, a thousand
   * to ten thousand years pass in which the only thing to see is a fading dust
   * shell. That is a real interval and skipping it would be a lie, so it is run
   * through rather than cut - just quickly, and labelled.
   */
  private static readonly DRIFT_S = 4;
  /** Real seconds spent on the nebula proper, once it is lit. */
  private static readonly NEBULA_S = 14;
  /** Total length of the whole sequence, real seconds. */
  private static readonly EJECTION_S =
    SystemStage.SWEEP_S + SystemStage.DRIFT_S + SystemStage.NEBULA_S;

  /**
   * Where the shell is, in years since the ejection, at a given moment of the
   * run. Three segments, because there are three things to watch and they are
   * separated by four orders of magnitude in time: the front crossing the
   * planets, the long dark drift while the core contracts, and the nebula.
   *
   * The switch-on is placed deliberately: the drift ends just short of the
   * core's transition time, so the lights come up at the start of the last
   * segment rather than at the end of it.
   */
  private nebulaYears(t: number, pn: PlanetaryNebula): number {
    const S = SystemStage.SWEEP_S, Y = SystemStage.SWEEP_YR;
    if (t <= S) return (Y / S) * Math.max(t, 0);
    const dark = Math.max(Y * 1.5, 0.55 * (transitionTimeS(pn) / YEAR));
    if (t <= S + SystemStage.DRIFT_S) {
      return Y * Math.pow(dark / Y, (t - S) / SystemStage.DRIFT_S);
    }
    const end = (2.2 * pn.lifetimeS) / YEAR;
    const q = Math.min(1, (t - S - SystemStage.DRIFT_S) / SystemStage.NEBULA_S);
    return dark * Math.pow(Math.max(end / dark, 1.01), q);
  }

  /**
   * Throw the envelope off.
   *
   * What is uncovered is not the white dwarf of the textbooks. That comes
   * later. On the day the envelope leaves, the core is a hundred thousand kelvin
   * and a few hundred to ten thousand solar luminosities, radiating almost
   * entirely in the ultraviolet - and it has to be, because otherwise there
   * would be nothing to ionise the gas and no nebula to see.
   */
  private beginNebula(pn: PlanetaryNebula, life: number): void {
    this.evoNebula = pn;
    this.evoNebulaT = 0;
    this.evoNebulaYr = 0;
    this.evoShellAu = 0;
    this.evoAge = life * 1.12;

    const teff = pn.centralTempK;
    const rSun = coreRadiusRsun(pn);
    const lSun = coreLuminosityLsun(pn);
    this.evoStar = makeStar(this.system.star.massMsun, this.evoAge, this.system.star.metallicity);
    this.evoRadiusAu = (rSun * R_SUN) / AU;
    this.view.setStarRadiusRsun(rSun);
    this.view.starView.setTemperature(4600);
    const [hzIn, hzOut] = habitableZone(lSun, teff);
    this.view.setHabitableZone(hzIn, hzOut);

    // A round nebula is the rare one. The waist comes from the dense equatorial
    // torus the AGB wind left, and how pinched it is depends on whether there
    // was a companion to shape it - so a binary gets a strongly bipolar one.
    const waist = this.system.companion ? 0.9 : 0.42 + 0.36 * ((this.ctx.star ?? 0) % 7) / 6;
    const shell = this.view.ejectEnvelope({
      radius: 1e-6,
      thickness: 0.6,
      centralTempK: teff,
      brightness: 0,
      waist,
      seed: (this.ctx.star ?? 0) * 7 + 3,
    });
    // Tip the torus off the ecliptic: the disc that shaped the planets and the
    // one that shapes the wind are the same disc, so it is only slightly off.
    shell.setAxis(new THREE.Vector3(0.18, 1, 0.1));

    // The diagram earns its keep here. The track has spent the last few seconds
    // climbing up and to the right along the giant branch; losing the envelope
    // uncovers the core, and the star jumps most of the way across the top of
    // the diagram to the left in a few thousand years - the fastest thing any
    // star ever does on it - before dropping down the white dwarf cooling
    // sequence. Two points draw the whole post-AGB crossing.
    if (this.evoHR) {
      this.evoTrack.push({ teff, lum: lSun });
      this.evoHR.setTrack(this.evoTrack);
      this.evoHR.mark({ ...this.evoStar, teff, luminosityLsun: lSun, kind: 'white-dwarf' });
    }

    const c = this.env.controls;
    const cam = this.env.engine.camera;
    this.evoFraming = { maxDistance: c.maxDistance, far: cam.far };
  }

  private stepNebula(dt: number, life: number): void {
    const pn = this.evoNebula;
    if (!pn) return;
    this.evoNebulaT += dt;
    const yr = this.nebulaYears(this.evoNebulaT, pn);
    this.evoNebulaYr = yr;
    const tS = yr * YEAR;

    const rM = shellRadius(pn, tS);
    this.evoShellAu = rM / AU;
    const shell = this.view.nebula;
    const ion = ionisedFraction(pn, tS);
    if (shell) {
      shell.setGeometry(this.evoShellAu, shellThickness(pn, tS));
      shell.setArcs(yr / pulseIntervalYears(pn));
      // Neither brightness is free to choose. The emission goes as the square of
      // a density that falls as the cube of the radius, so once the gas is lit
      // the display is over almost as soon as it has begun; and before it is
      // lit there is no emission at all, only starlight off dust.
      shell.setPhase(ion, reflectedBrightness(pn, tS));
      shell.setBrightness(Math.max(ion * shellBrightness(pn, tS), 0.05) * 1.3);
    }
    // The star is a cool post-AGB supergiant until the core finishes
    // contracting, and only then the blue-white ionising source.
    this.view.starView.setTemperature(4600 + (pn.centralTempK - 4600) * ion);

    // Keep the thing in frame. The shell outgrows the orrery within seconds and
    // then outgrows the star system entirely; the camera only ever pulls back,
    // so a user who has zoomed in to watch it pass a planet keeps their view.
    const want = this.evoShellAu * 3.6;
    const c = this.env.controls;
    if (want > c.distance) {
      c.maxDistance = Math.max(c.maxDistance, want * 1.4);
      c.focusOn(c.target, want);
      // Eased motion cannot follow an exponential clock: the shell doubles
      // faster than the camera closes the gap, and the one framing that shows
      // nothing at all is the one from inside the shell. So there is also a
      // hard floor. It grows as smoothly as the shell does, so it is not a cut.
      c.distance = Math.max(c.distance, this.evoShellAu * 2.1);
      const cam = this.env.engine.camera;
      const far = want * 60;
      if (far > cam.far) { cam.far = far; cam.updateProjectionMatrix(); }
    }

    if (this.evoNebulaT > SystemStage.EJECTION_S) this.endNebula(life);
  }

  private endNebula(life: number): void {
    this.view.clearNebula();
    this.evoNebula = undefined;
    this.evoNebulaT = 0;
    this.evoNebulaYr = 0;
    this.evoShellAu = 0;
    this.evoAge = life * 0.02;
    const c = this.env.controls;
    const cam = this.env.engine.camera;
    if (this.evoFraming) {
      c.maxDistance = this.evoFraming.maxDistance;
      cam.far = this.evoFraming.far;
      cam.updateProjectionMatrix();
      c.focusOn(c.target, Math.min(c.distance, c.maxDistance * 0.1));
      this.evoFraming = undefined;
    }
    for (let i = 0; i < this.view.slots.length; i++) this.view.setPlanetEngulfed(i, false);
    this.evoEngulfed = 0;
  }

  scaleLabel(): string {
    const [v, u] = formatDistance(this.env.controls.distance * AU);
    return `${v} ${u}`;
  }

  private planetPoints(): { pos: THREE.Vector3; radius: number; index: number }[] {
    return this.view.slots.map((s, i) => ({
      pos: s.worldPos,
      radius: Math.max(s.view?.worldRadius ?? 0, s.planet.au * 0.012),
      index: i,
    }));
  }

  /** Toggle between the legible orrery and strict true scale. */
  toggleTrueScale(): boolean {
    this.minAngular = this.minAngular > 0 ? 0 : 0.0045;
    this.view.setMinAngularRadius(this.minAngular);
    return this.minAngular === 0;
  }

  override inspect(ndc: THREE.Vector2): Inspection | null {
    // Stars and planets are picked together, so whichever is actually nearest
    // the cursor wins - a hot Jupiter can sit closer to its star than the
    // star's own drawn radius, and picking the star first would make it
    // unclickable.
    const sys = this.system;
    const starR = Math.max(this.view.starView.worldRadius, this.env.controls.distance * 0.012);
    const targets: { pos: THREE.Vector3; radius: number; index: number }[] = [
      { pos: this.view.primaryPos, radius: starR, index: -1 },
    ];
    if (sys.companion) {
      targets.push({ pos: this.view.companionPos, radius: starR, index: -2 });
    }
    targets.push(...this.planetPoints());
    const i = this.pickNearest(ndc, targets, 0.03);
    if (i === null) return null;
    if (i === -1) return this.describeStar(sys.star, this.starName);
    if (i === -2 && sys.companion) {
      return this.describeStar(sys.companion.star, `${this.starName} B`);
    }
    return describePlanet(this.view.slots[i].planet, this.starName, sys.star);
  }

  private describeStar(st: Star, name: string): Inspection {
    const peak = 2.897771955e6 / st.teff;
    return {
      title: name,
      kind: starLabel(st),
      swatch: `rgb(${st.color.map((c) => Math.round(Math.min(1, c) * 255)).join(',')})`,
      rows: [
        { k: 'mass', v: st.massMsun.toFixed(3), u: 'M☉' },
        { k: 'radius', v: st.radiusRsun.toFixed(3), u: 'R☉' },
        { k: 'luminosity', v: sig(st.luminosityLsun, 3), u: 'L☉' },
        { k: 'temperature', v: Math.round(st.teff).toString(), u: 'K' },
        { k: 'peak at', v: peak.toFixed(0), u: 'nm' },
        { k: 'metallicity', v: `${st.metallicity >= 0 ? '+' : ''}${st.metallicity.toFixed(2)}`, u: 'dex' },
        { k: 'age', v: st.ageGyr.toFixed(2), u: 'Gyr' },
        { k: 'remaining', v: Math.max(0, st.lifetimeGyr - st.ageGyr).toFixed(2), u: 'Gyr' },
      ],
      spectrum: { tempK: st.teff, metallicity: st.metallicity },
    };
  }

  child(ndc?: THREE.Vector2): Target | null {
    let idx: number | null = 0;
    if (ndc) {
      idx = this.pickNearest(ndc, this.planetPoints(), 0.04);
      if (idx === null) return null;
    } else {
      const sys = this.system;
      if (!sys.planets.length) return null;
      let best = 0, bestScore = -Infinity;
      for (let i = 0; i < sys.planets.length; i++) {
        const p = sys.planets[i];
        // Somewhere you could stand counts for a lot now that standing on it
        // is the next rung down: a ringed gas giant is a fine thing to look at
        // and a dead end to arrive at.
        const s = (p.habitable ? 10 : 0) + (p.pressureBar <= 30 ? 6 : 0)
          + (p.rings.length ? 3 : 0) + p.moons.length * 0.2
          + (p.oceanFraction > 0.2 ? 2 : 0);
        if (s > bestScore) { bestScore = s; best = i; }
      }
      idx = best;
    }
    const p = this.system.planets[idx];
    return {
      id: 'world',
      ctx: { ...this.ctx, planet: idx },
      label: p.name,
    };
  }

  override dispose(): void { this.view.dispose(); this.sky.dispose(); super.dispose(); }
}

// ---------------------------------------------------------------------------
// WORLD
// ---------------------------------------------------------------------------

export class WorldStage extends Stage {
  readonly id = 'world' as const;
  title = 'World';
  subtitle = '';
  private planet!: Planet;
  private view!: PlanetView;
  private sky!: SkyDome;
  private starView!: StarView;
  private moons: {
    view: MoonView; a: number; omega: number; phase: number; inc: number; radius: number;
  }[] = [];
  private sunDir = new THREE.Vector3(1, 0, 0);
  private sunColor = new THREE.Color(1, 1, 1);
  private starDist = 1;
  private starAngRad = 0.00465;
  private starLsun = 1;
  private planetRadius = 1;
  private aurora?: AuroraView;
  /** Magnetopause standoff in planetary radii, and auroral power vs Earth. */
  private standoff = 1;
  private auroraPower = 0;
  /** Fraction of the star's light reaching the sub-solar point, 0 to 1. */
  private eclipseDepth = 1;

  build(): void {
    const { system, seed } = systemOf(this.env, this.ctx);
    const p = system.planets[this.ctx.planet ?? 0];
    this.planet = p;
    this.title = p.name;
    this.subtitle = `${CLASS_LABEL[p.cls]} · ${(p.massKg / M_EARTH).toFixed(2)} M⊕ · ` +
      `${p.surfaceK.toFixed(0)} K · ${p.pressureBar < 0.001 ? 'airless' : `${sig(p.pressureBar, 2)} bar`}`;
    // An hour per second, so weather and rotation are visible.
    this.timeScale = 3600;

    this.sky = new SkyDome({ brightness: 0.55, bandStrength: 0.006, seed, nebula: 0.004 });
    this.sky.mesh.scale.setScalar(1e5);
    this.root.add(this.sky.mesh);

    // The planet is drawn at unit radius; everything else is scaled to match.
    this.view = new PlanetView(p, { radius: 1, segments: this.env.quality() > 0.6 ? 160 : 96 });
    this.root.add(this.view.group);

    // Its star, at the correct angular size: the Sun is half a degree across
    // from Earth, and a red dwarf's habitable zone is close enough that its
    // star looks three times wider.
    const scale = 1 / p.radiusM;
    const st = system.star;
    this.starDist = p.au * AU * scale;
    const starR = st.radiusRsun * R_SUN * scale;
    this.starView = new StarView(st, starR, seed, 2.2);
    this.root.add(this.starView.group);
    this.sunColor.setRGB(...blackbodyRGB(st.teff));
    this.starLsun = st.luminosityLsun;
    const irr = Math.max(0.03, Math.min(1.9, st.luminosityLsun / (p.au * p.au)));
    this.sunColor.multiplyScalar(irr);

    // The star is a disc, not a point, and its angular radius is what sets the
    // width of every terminator and the size of every umbra here.
    this.starAngRad = Math.atan2(starR, Math.max(this.starDist, 1e-9));
    this.view.setSunAngularRadius(this.starAngRad);

    // Moons
    let mi = 0;
    for (const m of p.moons) {
      const r = Math.max(m.radiusM * scale, 0.004);
      const view = new MoonView(r, {
        color: m.color, seed: p.surfaceSeed + mi * 7919,
        icy: p.surfaceK < 200 ? 1 : 0,
      }, this.env.quality() > 0.6 ? 48 : 28);
      view.setSunAngularRadius(this.starAngRad);
      const mu = G * (p.massKg + m.massKg);
      this.moons.push({
        view,
        a: m.a * scale,
        omega: Math.sqrt(mu / (m.a ** 3)),
        phase: m.phase,
        inc: m.i,
        radius: r,
      });
      this.root.add(view.mesh);
      mi++;
    }
    this.planetRadius = 1;

    // --- Aurora, if this world has a magnetosphere for one to land in.
    const mag = {
      massKg: p.massKg, radiusM: p.radiusM, dayS: p.dayS, ageGyr: st.ageGyr,
      surfaceK: p.surfaceK,
      gasGiant: p.cls === 'gas-giant' || p.cls === 'hot-jupiter'
        || p.cls === 'ice-giant' || p.cls === 'mini-neptune' || p.cls === 'puffy',
    };
    const wind = windPressure(p.au, system.effectiveLuminosity);
    this.standoff = standoffRadii(mag, wind);
    this.auroraPower = auroralPower(mag, wind);
    // It takes both a field to steer the particles and an atmosphere for them
    // to hit. A magnetised airless rock precipitates into bare regolith and
    // nothing lights up.
    if (this.auroraPower > 0.02 && p.pressureBar > 0.004 && this.standoff > 1.4) {
      this.aurora = new AuroraView({
        radius: 1,
        height: Math.min(0.16, Math.max(0.022, 400e3 / p.radiusM)),
        ovalColatitude: ovalColatitude(this.standoff),
        // Earth's aurora is faint in absolute terms and the range across worlds
        // spans four orders of magnitude, so what is drawn is a compressed
        // version of the real ratio rather than the ratio itself.
        power: Math.min(3.2, 0.55 * Math.pow(this.auroraPower, 0.32)),
        tilt: dipoleTilt(p.surfaceSeed),
        tiltAzimuth: (p.surfaceSeed % 997) / 997 * Math.PI * 2,
      });
      this.view.group.add(this.aurora.mesh);
    }

    // Frame the planet at a crescent-to-gibbous phase: a fully lit disc hides
    // the terminator, and the terminator is where the surface reads.
    const ang0 = p.elements.M0;
    const c = this.env.controls;
    c.snapTo(new THREE.Vector3(), 3.0, Math.PI / 2 - ang0 + 1.15, 1.28);
    // The world turns beneath the view; the view itself barely moves.
    c.drift = 0.004;
    c.minDistance = 1.02;
    c.maxDistance = Math.max(60, this.starDist * 0.02);
    const cam = this.env.engine.camera;
    cam.near = 0.002; cam.far = this.starDist * 4;
    cam.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.simTime += dt * this.timeScale;
    const p = this.planet;
    // Orbital phase around the star; the star is placed at the true distance
    // so its disc has the right angular size and its light the right intensity.
    const ang = (this.simTime / Math.max(p.periodS, 1)) * Math.PI * 2 + p.elements.M0;
    this.sunDir.set(Math.cos(ang), 0, Math.sin(ang));
    const starPos = this.sunDir.clone().multiplyScalar(this.starDist);
    this.starView.group.position.copy(starPos);
    this.starView.update(this.simTime, starPos);
    this.view.update(this.sunDir, this.sunColor, this.simTime, this.view.group.position);
    this.sky.mesh.position.copy(this.env.engine.camera.position);

    for (const m of this.moons) {
      const th = m.phase + m.omega * this.simTime;
      m.view.mesh.position.set(
        m.a * Math.cos(th),
        m.a * Math.sin(th) * Math.sin(m.inc),
        m.a * Math.sin(th) * Math.cos(m.inc));
      m.view.update(this.sunDir, this.sunColor);
    }

    // Who can get between what and the star. The moons can shadow the planet;
    // the planet - much the larger disc - can shadow the moons, which is the
    // same eclipse seen from the other side.
    const moonOccluders = this.moons.map((m) => ({
      pos: m.view.mesh.position, radius: m.radius,
    }));
    this.view.setOccluders(moonOccluders);
    const planetOccluder = { pos: this.view.group.position, radius: this.planetRadius };
    for (let i = 0; i < this.moons.length; i++) {
      const others = moonOccluders.filter((_, j) => j !== i);
      this.moons[i].view.setOccluders([planetOccluder, ...others]);
    }

    // Depth of any eclipse now in progress, sampled at the sub-solar point.
    this.eclipseDepth = this.lightAtSubsolar(moonOccluders);

    this.aurora?.update(this.env.engine.camera, this.sunDir, this.simTime,
      this.view.surface.rotation.y);
  }

  /**
   * Fraction of the star's light reaching the point on the surface directly
   * under it - the same disc-overlap arithmetic the shader runs, evaluated once
   * on the CPU so the readout can say whether an eclipse is happening.
   */
  private lightAtSubsolar(occ: { pos: THREE.Vector3; radius: number }[]): number {
    const p = this.sunDir.clone().multiplyScalar(this.planetRadius);
    let lit = 1;
    for (const o of occ) {
      const v = o.pos.clone().sub(p);
      const d = v.length();
      if (d < 1e-9) continue;
      v.divideScalar(d);
      const cosSep = v.dot(this.sunDir);
      if (cosSep <= 0) continue;
      const ro = Math.asin(Math.min(1, o.radius / d));
      lit *= 1 - discOverlapFraction(this.starAngRad, ro, Math.acos(Math.min(1, cosSep)));
    }
    return lit;
  }

  rows(): Row[] {
    const p = this.planet;
    const [dv, du] = formatDistance((this.env.controls.distance - 1) * p.radiusM);
    const [tv, tu] = formatTime(this.simTime);
    return [
      { k: 'class', v: CLASS_LABEL[p.cls], accent: true },
      { k: 'mass', v: p.massKg > 30 * M_EARTH
        ? `${(p.massKg / M_JUPITER).toFixed(2)} M♃` : `${(p.massKg / M_EARTH).toFixed(3)} M⊕` },
      { k: 'radius', v: (p.radiusM / R_EARTH).toFixed(2), u: 'R⊕' },
      { k: 'gravity', v: (p.gravity / 9.80665).toFixed(2), u: 'g' },
      { k: 'surface', v: `${p.surfaceK.toFixed(0)} K`, u: `${(p.surfaceK - 273.15).toFixed(0)} °C` },
      { k: 'atmosphere', v: p.pressureBar < 1e-3 ? 'none' : `${sig(p.pressureBar, 2)} bar` },
      { k: 'day', v: p.tidallyLocked ? 'locked' : formatTime(Math.abs(p.dayS)).join(' ') },
      { k: 'year', v: formatTime(p.periodS).join(' ') },
      { k: 'moons', v: p.moons.length ? `${p.moons.length}${this.eclipseNote()}` : 'none' },
      { k: 'magnetosphere', v: this.standoff > 1.4
        ? `${this.standoff.toFixed(1)} R · aurora ×${sig(this.auroraPower, 2)}`
        : 'none — stripped' },
      { k: 'elapsed', v: tv, u: tu },
      { k: 'altitude', v: dv, u: du },
    ];
  }

  /** " · total eclipse" and the like, when one is under way. */
  private eclipseNote(): string {
    if (this.eclipseDepth > 0.999) return '';
    let total = false;
    for (const m of this.moons) {
      const d = m.view.mesh.position.distanceTo(
        this.sunDir.clone().multiplyScalar(this.planetRadius));
      if (canBeTotal(this.starAngRad, angularRadius(m.radius, d))) total = true;
    }
    const label = eclipseLabel(this.eclipseDepth, total);
    return label ? ` · ${label}` : '';
  }

  override setBoost(beta: number, dir: THREE.Vector3): void {
    this.sky.setBoost(beta, dir);
  }

  scaleLabel(): string {
    const [v, u] = formatDistance((this.env.controls.distance - 1) * this.planet.radiusM);
    return `${v} ${u}`;
  }

  override inspect(): Inspection | null {
    return describePlanet(this.planet, this.title, systemOf(this.env, this.ctx).system.star);
  }

  child(): Target | null {
    // Some worlds have no bottom. Below thirty bars of hydrogen the pressure
    // and temperature climb without ever passing through a surface: the gas
    // just gets denser until it is a liquid and then a metal, and there is
    // nowhere to put your feet at any depth.
    //
    // But a giant is not one world, it is a dozen. Go and stand on one of
    // them, and look back up at the thing you could not land on.
    if (this.planet.pressureBar > 30) {
      const i = COMP.bestMoon(this.planet, this.starLsun);
      if (i < 0) return null;
      return {
        id: 'surface',
        ctx: { ...this.ctx, moon: i, lat: 26, lon: 0 },
        label: this.planet.moons[i].name,
      };
    }
    // Land where it is worth standing: in the tropics on a cold world, in the
    // temperate latitudes on a warm one, and near the terminator of a tidally
    // locked one, which is the only strip of it that is neither burning nor
    // frozen.
    const lat = this.planet.tidallyLocked ? 78
      : this.planet.surfaceK < 260 ? 12
        : this.planet.surfaceK > 330 ? 62 : 34;
    return {
      id: 'surface',
      ctx: { ...this.ctx, lat, lon: 0 },
      label: `the surface of ${this.planet.name}`,
    };
  }

  override dispose(): void {
    this.view.dispose(); this.starView.dispose(); this.sky.dispose(); super.dispose();
  }
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// SURFACE
// ---------------------------------------------------------------------------

/**
 * Standing on it.
 *
 * The bottom of the ladder, and the only view in the simulation that looks
 * outward instead of in. Everything overhead is the thing you have just come
 * down through: the star at the angular size its distance gives it, the sky
 * the colour its air makes it, the moons where their orbits put them, and,
 * once the star is down, the galaxy you started from.
 */
/**
 * How big a point of light is drawn, radians of angular radius.
 *
 * Nothing to do with the body. Venus is an arcminute across at its closest and
 * every other planet is smaller than that, so what sets the size of the dot
 * you see is the blur that any optical system - a telescope, a camera, an eye -
 * turns a point source into. It is the same for all of them, and the
 * brightness carries all the information there is.
 */
const POINT_ANG = 0.0035;
/** Display gain: a magnitude-zero point comes out just under white. */
const POINT_GAIN = 0.8;
/** Magnitude 6.5 in flux - the naked-eye limit, and one display step. */
const POINT_FLOOR = 0.0025;
/**
 * The optical depth of the path that light takes when it bends round a limb.
 *
 * Deeper than this and nothing gets through; shallower and it does not bend
 * far enough to reach you. About one is the compromise the atmosphere strikes,
 * and it is what sets how red the ring is: the other channels are this times
 * the gas's own ratio of Rayleigh coefficients, which goes as lambda^-4.
 */
const HALO_TAU = 1.1;
/** How bright to draw that ring against everything else in the scene. */
const HALO_GAIN = 0.07;

export class SurfaceStage extends Stage {
  readonly id = 'surface' as const;
  title = 'Surface';
  subtitle = '';
  private planet!: Planet;
  private air!: SKY.Atmosphere;
  private view!: SurfaceView;
  private sky!: SkyDome;
  private lat = 0;
  private starRGB: [number, number, number] = [1, 1, 1];
  private starAngRad = 0.00465;
  private starRadiusM = R_SUN;
  /** Seconds into the planet's solar day, and into its year. */
  private dayS = 86400;
  private yearS = 3.15e7;
  private tilt = 0;
  private locked = false;
  /** The planet this is a moon of, when it is one. */
  private parent: Planet | null = null;
  private parentMoon: Planet['moons'][number] | null = null;
  private parentDir = new THREE.Vector3(0, 1, 0);
  /**
   * What fraction of each orbit this moon spends in its planet's shadow.
   *
   * Worked out once: it is a two-thousand-step search round the orbit and the
   * answer does not change, and the readout asks for it ten times a second.
   */
  private eclipseFraction = 0;
  private sunDir = new THREE.Vector3(0, 1, 0);
  private altitude = 0;
  private azimuth = 0;
  private eyeH = 1.7;
  /** The display gain everything in this scene is drawn at. */
  private exposure = 1;

  // The ephemeris: everything in the system that is not the ground you are
  // standing on. Held as bodies rather than planets so a moon is one too.
  private host!: Planet;
  private hostIndex = 0;
  private muStar = G * M_SUN;
  private bodies: EPH.Body[] = [];
  /** The world's rotation axis, fixed in space for the whole visit. */
  private axis: EPH.Vec3 = [0, 0, 1];
  /** Where the observer is, heliocentric, this instant. */
  private obsPos: EPH.Vec3 = [0, 0, 0];
  /** The rotation from out there to overhead, rebuilt every frame. */
  private toLocal: (v: EPH.Vec3) => EPH.Vec3 = (v) => v;
  /** Straight up from where the observer is standing, out in the star's frame. */
  private upSpace: EPH.Vec3 = [0, 1, 0];
  /** The plane each of the world's own moons goes round in, and its normal. */
  private moonPlanes: { x: EPH.Vec3; y: EPH.Vec3; n: EPH.Vec3 }[] = [];
  private wanderers: EPH.Wanderer[] = [];
  private declination = 0;
  /** The parent's other moons, which from here are the brightest things up. */
  private siblings: { moon: Planet['moons'][number]; dPhase: number; period: number }[] = [];
  /** How much of the star's light is getting through, and what is taking it. */
  /** What the sibling moons are doing, for the readout. */
  private siblingSky: { name: string; wideDeg: number; lit: number; alt: number }[] = [];
  private eclipse = 1;
  private eclipseCover = 0;
  private eclipseBy = '';
  /** Where the thing in front of the star is, and how wide. */
  private occDir: [number, number, number] | null = null;
  private occAng = 0;
  private parentAlt = 0;
  /**
   * The colour of light bent round an occulting body's limb, and whether
   * anything in this sky has the air to bend it.
   */
  private haloRGB: [number, number, number] = [0, 0, 0];
  private hasHalo = new Set<string>();

  build(): void {
    const { system, seed } = systemOf(this.env, this.ctx);
    const { world: p, host, moon, moonIndex: mi } = standingOn(system, this.ctx);
    const onMoon = moon !== null;
    this.parent = onMoon ? host : null;
    this.parentMoon = moon;
    this.planet = p;
    this.air = SKY.atmosphereOf(p);
    // Latitude, with one sign to be careful about. On a moon it is measured
    // from the point directly under the planet, and the planet is due north of
    // you - which puts you on the far side of the moon's equator from its own
    // rotation pole, so the celestial latitude is the negative of it. Get that
    // backwards and the star transits due south while the planet hangs due
    // north, they are never in the same place, and there is never an eclipse.
    this.lat = ((onMoon ? -Math.abs(this.ctx.lat ?? 26) : (this.ctx.lat ?? 34)) * Math.PI) / 180;
    this.tilt = p.obliquity;
    // A planet locked to its star has the star nailed in place. A moon locked
    // to its planet is the other way round: the *planet* never moves, and the
    // star still rises and sets - once per orbit, so a day on Europa is three
    // and a half of ours.
    this.locked = p.tidallyLocked && !onMoon;
    this.dayS = Math.abs(p.dayS) || p.periodS;
    this.yearS = onMoon ? host.periodS : p.periodS;

    const st = system.star;
    const irr = Math.max(0.02, st.luminosityLsun / (p.au * p.au));
    const rgb = blackbodyRGB(st.teff);
    this.starRGB = [rgb[0] * irr, rgb[1] * irr, rgb[2] * irr];
    this.starRadiusM = st.radiusRsun * R_SUN;
    this.starAngRad = SKY.angularRadius(this.starRadiusM, p.au * AU);

    // The rest of the system, as things to be found in the sky rather than as
    // places to go. The observer's own world is in the list and skipped by
    // index, because on a moon it is not the observer's world - it is the
    // enormous thing overhead, and that is drawn separately.
    this.host = host;
    this.hostIndex = this.ctx.planet ?? 0;
    this.muStar = G * st.currentMassMsun * M_SUN;
    this.bodies = system.planets.map((pl) => ({
      name: pl.name, radiusM: pl.radiusM, albedo: pl.albedo,
      elements: pl.elements, color: pl.color,
    }));
    // The rotation axis, worked out once because it does not move. That is the
    // whole mechanism behind seasons: the axis does not lean toward the star
    // and away again over the year, it stays pointed at the same distant place
    // and the world carries it round a circle.
    const hostState = stateAt(host.elements, this.muStar, 0);
    this.axis = onMoon
      // A close moon orbits in its planet's equatorial plane and keeps one
      // face to it, so it turns once per orbit about that same normal.
      ? EPH.orbitNormal(hostState)
      : EPH.spinAxis(hostState, host.obliquity);

    // The plane each of the world's own moons goes round in.
    //
    // Not simply the equator, and not simply the orbit: two torques are
    // fighting over it. The planet's equatorial bulge pulls a close moon into
    // the equator; the star's tide pulls a distant one into the planet's own
    // orbital plane. They balance at the Laplace radius, and where a moon sits
    // relative to that decides which it follows.
    //
    // Which is not a detail - it is why eclipses are common on some worlds and
    // rare on others. The Galileans are all well inside Jupiter's Laplace
    // radius, so they lie in its equator to a fraction of a degree and are
    // eclipsed nearly every orbit. Our Moon is six times outside Earth's, so
    // it follows the ecliptic instead, and eclipses come in seasons twice a
    // year when the line of nodes happens to point at the sun.
    this.moonPlanes = [];
    if (!onMoon && p.moons.length) {
      const orbitN = EPH.orbitNormal(hostState);
      const j2 = COMP.oblatenessJ2(p.massKg, p.radiusM, p.dayS);
      const rL = COMP.laplaceRadius(
        j2, p.radiusM, p.au * AU, p.massKg, st.currentMassMsun * M_SUN,
      );
      for (const m of p.moons) {
        // Tip the equator toward the orbit by however much this moon's
        // distance says, in the plane the two normals share.
        const tilt = COMP.laplaceTilt(p.obliquity, m.a, rL);
        let n = this.axis;
        const perp = EPH.cross(EPH.cross(this.axis, orbitN), this.axis);
        if (EPH.length(perp) > 1e-9) {
          const u = EPH.normalize(perp), c = Math.cos(tilt), sn2 = Math.sin(tilt);
          n = EPH.normalize([
            this.axis[0] * c + u[0] * sn2,
            this.axis[1] * c + u[1] * sn2,
            this.axis[2] * c + u[2] * sn2,
          ]);
        }
        let x = EPH.cross([0, 0, 1], n);
        if (EPH.length(x) < 1e-9) x = [1, 0, 0];
        x = EPH.normalize(x);
        this.moonPlanes.push({ x, y: EPH.cross(n, x), n });
      }
    }

    // Its brothers and sisters. From Europa, Io is bigger than the Moon is
    // from Earth and Ganymede is nearly as big, and they move fast enough to
    // watch - a couple of degrees an hour - because they are close and quick.
    if (onMoon && mi !== undefined) {
      const own = host.moons[mi];
      const ownPeriod = 2 * Math.PI * Math.sqrt(own.a ** 3 / (G * host.massKg));
      this.siblings = host.moons.map((m, k) => ({ moon: m, k }))
        .filter(({ k }) => k !== mi)
        .map(({ moon }) => ({
          moon,
          // Phases relative to the observer's, because the observer's own
          // clock has already been zeroed on its own orbit.
          dPhase: moon.phase - own.phase,
          period: 2 * Math.PI * Math.sqrt(moon.a ** 3 / (G * host.massKg)),
        }));
      void ownPeriod;
      this.parentAlt = COMP.parentAltitude(own.a, p.radiusM, Math.abs(this.lat));
      this.parentDir.set(0, Math.sin(this.parentAlt), -Math.cos(this.parentAlt)).normalize();
    }

    this.title = p.name;
    const where = this.locked ? 'the day side'
      : this.parent ? `${Math.abs(this.ctx.lat ?? 26).toFixed(0)}° from under it`
        : `${Math.abs(this.ctx.lat ?? 34).toFixed(0)}° ${(this.ctx.lat ?? 34) >= 0 ? 'north' : 'south'}`;
    const air = p.pressureBar < 1e-3
      ? 'no air, and a black sky at noon'
      : `${sig(p.pressureBar, 2)} bar of ${p.atmosphere}`;
    this.subtitle = this.parent
      ? `A moon of ${this.parent.name}, which never moves in its sky · ${air}`
      : `On the surface at ${where} · ${air}`;

    if (this.parent && this.parentMoon) {
      this.eclipseFraction = COMP.eclipsedFraction(
        this.parentMoon, this.parent.radiusM, this.starRadiusM,
        this.parent.au * AU, this.parentMoon.i,
      );
    }

    // Which of the bodies in this sky have an atmosphere to bend light round,
    // and what colour that light comes out. The parent is the usual one; a
    // moon with air of its own - Titan among Saturn's - counts too.
    const airy: Planet[] = [];
    if (this.parent) airy.push(this.parent);
    for (const [k, m] of (this.parent ? host.moons : p.moons).entries()) {
      if (this.parent && k === mi) continue;
      const w = COMP.moonAsWorld(m, this.parent ?? p, st.luminosityLsun, k);
      if (w.pressureBar > 0.01) airy.push(w);
    }
    this.hasHalo = new Set(airy.map((b) => b.name));
    if (airy.length) {
      // Grazing light crosses the whole depth of that air twice, and Rayleigh
      // scattering takes the blue out of it: the same fact as a red sunset,
      // and the reason a totally eclipsed moon is copper rather than black.
      // Fixing the reddest channel at about one optical depth - the path that
      // just gets through - the others follow from the gas's own lambda^-4.
      const b0 = SKY.atmosphereOf(airy[0]).betaR;
      const red = Math.max(b0[0], 1e-30);
      const tint = b0.map((x) => Math.exp(-(x / red - 1) * HALO_TAU));
      this.haloRGB = [
        this.starRGB[0] * tint[0], this.starRGB[1] * tint[1], this.starRGB[2] * tint[2],
      ];
    }

    // A day in a couple of minutes, so the star visibly crosses the sky, and
    // arrive in the middle of the morning rather than at midnight.
    this.timeScale = this.dayS / 150;
    this.simTime = this.dayS * 0.32;

    // The stars behind the air. Dim, because they only win once the sky loses.
    this.sky = new SkyDome({ brightness: 0.5, bandStrength: 0.012, seed, nebula: 0.006 });
    this.sky.mesh.scale.setScalar(4e5);
    // Behind everything else in the sky, so the planets and moons drawn after
    // it can cover the stars they are actually in front of.
    this.sky.mesh.renderOrder = -90;
    this.root.add(this.sky.mesh);

    // How much relief a world can hold up.
    //
    // A mountain stands until the rock at its base yields under its own
    // weight, so the tallest one a world can have goes as the crushing
    // strength over the density times the gravity - which is why Olympus Mons
    // is two and a half times Everest on a planet half Earth's size. Ice gives
    // way at a tenth of rock's stress, and weather takes the rest down.
    const horizon = SKY.horizonDistance(p.radiusM, this.eyeH);
    const strength = p.cls === 'ice' ? 1.4e7 : 1.0e8;
    let relief = strength / (Math.max(p.density, 500) * Math.max(p.gravity, 0.02));
    if (p.pressureBar > 0.05) relief *= 0.5;
    // And no more than the horizon can hold. On a small moon the horizon is
    // two kilometres off, and a kilometre-high hill inside that is not a
    // landscape, it is a wall across the sky.
    relief = Math.max(20, Math.min(relief, horizon * 0.10));
    // Far enough past the horizon that its edge is over it and hidden.
    const reach = Math.max(1200, horizon * 2.6 + relief * 8);

    const cold = p.surfaceK < 273;
    this.view = new SurfaceView({
      atmosphere: this.air,
      sunColor: this.starRGB,
      starAngRad: this.starAngRad,
      eyeHeight: this.eyeH,
      relief, reach,
      seed: p.surfaceSeed,
      // The generator's two colours are the land and the sea - on Earth a
      // green and a blue - so high ground is not the second colour but the
      // first one with the life scraped off it.
      low: p.color,
      high: [
        p.color[0] * 0.42 + 0.20, p.color[1] * 0.42 + 0.17, p.color[2] * 0.42 + 0.14,
      ],
      water: p.color2,
      oceanFraction: p.oceanFraction,
      // Snow on the tops, not halfway down them: at Earth's temperature the
      // snowline is high, and only a frozen world is white all over.
      ice: cold ? 0.8 : p.surfaceK < 295 ? 0.12 : 0,
      detail: this.env.quality() > 0.6 ? 360 : 200,
      // Its own moons, plus one slot for the planet it goes round, plus one
      // for each of that planet's other moons.
      moons: p.moons.length + (this.parent ? 1 + this.siblings.length : 0),
      // And one for every other planet in the system.
      points: Math.max(0, system.planets.length - 1),
    });
    this.root.add(this.view.group);
    // Expose for the sunlit ground, which is the brightest thing that is
    // reliably in frame: the sky can be anything from a black vacuum to ninety
    // bars of opaque carbon dioxide, and exposing for it would make half the
    // worlds in the simulation unviewable. The ground estimate is a mid-height
    // star seen through this world's own air.
    const flux = (this.starRGB[0] + this.starRGB[1] + this.starRGB[2]) / 3;
    const albedo = (p.color[0] + p.color[1] + p.color[2]) / 3;
    const through = SKY.transmittance(this.air, Math.PI / 4)[1];
    const ground = Math.max(1e-4, albedo * flux * 0.62 * through);
    this.exposure = Math.min(90, 0.24 / ground);
    this.view.setExposure(this.exposure);

    this.aim();
    this.placeMoons();
    this.placeWanderers();
    this.applyLight();
    const c = this.env.controls;
    if (this.parent && this.parentMoon) {
      // Face the planet. It is the reason for coming, it never moves, and it
      // stands sixty degrees up - which is well outside the frame if you
      // arrive looking near the horizon the way you do everywhere else. Due
      // north by construction: the sub-planet point is what you walked from.
      const alt = COMP.parentAltitude(
        this.parentMoon.a, p.radiusM, Math.abs(this.lat),
      ) * 0.82;
      c.snapTo(new THREE.Vector3(0, 26 * Math.sin(alt) + 8, 0), 26, 0, Math.PI / 2 + alt);
    } else {
      // A quarter turn from the star. Looking straight at a low sun gives you a
      // silhouette and a washed-out sky; looking directly away from it gives
      // you flat front lighting. Across it is where the shadows are, and where
      // the sky is deepest - the blue of a clear sky peaks ninety degrees from
      // the sun, which is the same fact a polarising filter is sold on. Aimed
      // a little above the horizontal, because the sky is what is worth
      // looking at from down here. Orbiting still swings all the way round.
      c.snapTo(new THREE.Vector3(0, 13, 0), 26, -this.azimuth + 1.9, 1.87);
    }
    c.drift = 0.012;
    c.minDistance = 2.5;
    c.maxDistance = Math.max(400, reach * 0.5);
    const cam = this.env.engine.camera;
    cam.near = 0.5; cam.far = 8e5;
    cam.updateProjectionMatrix();
  }

  /**
   * Put the star where the world's rotation and orbit say it is, and hang the
   * rest of the sky off it.
   *
   * The second half is the part that matters. A planet's direction is a vector
   * in the star's frame and no use at all until it is an altitude and an
   * azimuth, and the bridge between the two is a rotation - which needs two
   * directions known on both sides. There are exactly two to hand: the world's
   * rotation axis, which by definition points at its own celestial pole and
   * therefore stands an altitude equal to the latitude due north; and the star
   * itself, whose place in the sky is already known because it is what makes
   * the day.
   *
   * Building the map from that pair rather than from angles chosen by hand
   * means the star lands precisely where the sundial says it does - the
   * agreement is imposed rather than hoped for - and every other body is then
   * carried rigidly along with it and lands where it really is.
   */
  private aim(): void {
    const t = this.simTime;
    // Where the world is this instant, off the real orbit.
    this.obsPos = EPH.positionOf(this.host.elements, this.muStar, t);
    const starOut = EPH.normalize(EPH.scale(this.obsPos, -1));
    // The star's declination: the true one, rather than the sinusoid that
    // assumes a circular orbit and an epoch sitting on an equinox.
    const dec = Math.asin(Math.max(-1, Math.min(1, EPH.dot(starOut, this.axis))));
    this.declination = dec;

    let alt: number, az: number;
    if (this.locked) {
      // One face to the star forever: it hangs at a fixed place in the sky,
      // set by how far round from the substellar point you are standing.
      alt = Math.PI / 2 - Math.abs(this.lat) * 1.15;
      az = Math.PI;
    } else {
      const h = SKY.hourAngle((t / this.dayS) % 1);
      const p = SKY.altAz(this.lat, dec, h);
      alt = p.altitude; az = p.azimuth;
    }
    this.altitude = alt;
    this.azimuth = az;
    // Azimuth is measured from north, turning east; the scene has y up and
    // takes north as -z.
    this.sunDir.set(
      Math.cos(alt) * Math.sin(az), Math.sin(alt), -Math.cos(alt) * Math.cos(az),
    ).normalize();

    const starLocal: EPH.Vec3 = [this.sunDir.x, this.sunDir.y, this.sunDir.z];
    const pole = this.locked ? this.lockedPole(alt, dec) : EPH.dirFromAltAz(this.lat, 0);
    this.toLocal = EPH.frameMap(this.axis, starOut, pole, starLocal);
    const toSpace = EPH.frameMap(pole, starLocal, this.axis, starOut);
    this.upSpace = toSpace([0, 1, 0]);

    // Standing on a moon, the observer is a million kilometres off the planet
    // the ephemeris is tracking. That is a fifth of a degree of parallax on
    // Mars at its closest - too small to see and free to include, since it is
    // one more subtraction in a chain of them.
    if (this.parentMoon) {
      const off = toSpace([
        -this.parentDir.x * this.parentMoon.a,
        -this.parentDir.y * this.parentMoon.a,
        -this.parentDir.z * this.parentMoon.a,
      ]);
      this.obsPos = [
        this.obsPos[0] + off[0], this.obsPos[1] + off[1], this.obsPos[2] + off[2],
      ];
    }
  }

  /**
   * Where the celestial pole is on a world that keeps one face to its star.
   *
   * There is no sundial here to read it off - the star never moves - so it is
   * placed by the one thing that still has to hold: the pole is ninety degrees
   * minus the declination away from the star. Put it that far along the
   * meridian, on the far side from the star, and the frame is pinned.
   */
  private lockedPole(starAlt: number, dec: number): EPH.Vec3 {
    // Along the meridian, measuring from the northern horizon through the
    // zenith to the southern one. The star sits due south here.
    const beta = Math.PI / 2 - starAlt + dec;
    return [0, Math.sin(beta), -Math.cos(beta)];
  }

  update(dt: number): void {
    this.simTime += dt * this.timeScale;
    this.sky.mesh.position.copy(this.env.engine.camera.position);
    this.aim();
    this.placeMoons();
    this.placeWanderers();
    this.applyLight();
  }

  /**
   * Hand the shaders the light there actually is, which is not always all of
   * it.
   *
   * The eclipse factor comes out of the disc geometry a few lines up, and it
   * is a plain multiplier on the star's colour - so the sky dims with it, the
   * ground dims with it, and nothing has to know an eclipse is happening. The
   * exposure is deliberately not touched. A camera that opened up to
   * compensate would hide the whole event.
   */
  private applyLight(): void {
    const e = this.eclipse;
    // The sky and the ground get the light that is actually arriving. The
    // star's own disc gets its full brightness and a hole cut in it, because
    // the shape of what is left is the whole thing worth looking at.
    this.view?.setSun(this.sunDir, [
      this.starRGB[0] * e, this.starRGB[1] * e, this.starRGB[2] * e,
    ]);
    this.view?.setStarDisc(this.starRGB);
    this.view?.setOcculter(this.occDir, this.occAng);
    // Not scaled by the eclipse factor: the ring is the light that is getting
    // through, and it is at its brightest exactly when none of the rest is.
    const g = HALO_GAIN * this.exposure;
    this.view?.setHalo([this.haloRGB[0] * g, this.haloRGB[1] * g, this.haloRGB[2] * g]);
    // The starfield is only worth anything once the sky stops drowning it -
    // which happens at night, on a world with no air to drown it with, and
    // for two minutes in the middle of the day when something gets in the way.
    const dark = 1 - Math.min(1, Math.max(0, (this.altitude + 0.14) / 0.30));
    const thin = Math.exp(-this.air.betaR[1] * this.air.scaleHeightM * 6);
    this.sky?.setBrightness(0.5 * Math.max(dark, thin, 1 - e));
  }

  /**
   * Put the moons where they are, at the size they look, in the phase they are
   * in.
   *
   * Their sky positions come out of the same spherical triangle the star's
   * does. A moon's hour angle is the star's plus how far round its own orbit
   * it has gone, which is why a moon rises later every night - fifty minutes a
   * night for ours - and its declination swings with the tilt of its orbit.
   * The phase is not chosen: it is the angle between the star and the moon as
   * seen from here, and it comes out full at opposition and new at conjunction
   * because that is what those words mean.
   */
  private placeMoons(): void {
    // Not an early return on having no moons of its own: a moon has none, and
    // the whole point of standing on one is the thing it goes round.
    if (!this.planet.moons.length && !this.parent) return;
    const out: MoonDisc[] = [];
    const dir = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    const worldUp = new THREE.Vector3(0, 1, 0);
    const alt = new THREE.Vector3(1, 0, 0);
    // Where the observer is standing, out in the star's frame: not the centre
    // of the world but a point on its surface. That difference is a degree of
    // parallax for a moon as close as ours, and it is the whole reason a total
    // eclipse is a narrow track across a continent rather than a hemisphere.
    const [ex, ey, ez] = EPH.scale(this.upSpace, this.planet.radiusM + this.eyeH);
    for (let k = 0; k < this.planet.moons.length; k++) {
      const m = this.planet.moons[k];
      const pl = this.moonPlanes[k];
      if (!pl) continue;
      const period = 2 * Math.PI * Math.sqrt(m.a ** 3 / (G * this.planet.massKg));
      const th = (2 * Math.PI * this.simTime) / period + m.phase;
      // On its orbit, in its own Laplace plane, tilted out of that by its
      // inclination. Real geometry rather than a declination that swung on a
      // schedule of its own: the old version let the moon and the star line up
      // only by coincidence, so eclipses effectively never happened.
      const c = Math.cos(th), sn = Math.sin(th) * Math.cos(m.i), sz = Math.sin(th) * Math.sin(m.i);
      const rx = m.a * (pl.x[0] * c + pl.y[0] * sn + pl.n[0] * sz) - ex;
      const ry = m.a * (pl.x[1] * c + pl.y[1] * sn + pl.n[1] * sz) - ey;
      const rz = m.a * (pl.x[2] * c + pl.y[2] * sn + pl.n[2] * sz) - ez;
      const dist = Math.hypot(rx, ry, rz);
      if (dist <= 0) continue;
      const l = this.toLocal([rx / dist, ry / dist, rz / dist]);
      dir.set(l[0], l[1], l[2]);
      const altitude = Math.asin(Math.max(-1, Math.min(1, dir.y)));
      // Below the horizon is below the horizon.
      if (altitude < -Math.atan2(m.radiusM, dist)) continue;

      // The disc's own frame, with +z pointing back at the observer.
      right.copy(Math.abs(dir.y) > 0.95 ? alt : worldUp).cross(dir).normalize();
      up.copy(dir).cross(right).normalize();
      const light: [number, number, number] = [
        this.sunDir.dot(right), this.sunDir.dot(up), -this.sunDir.dot(dir),
      ];

      // The star's light reaching it, and what is left of that on the way to
      // the ground: a moon on the horizon is as dimmed and reddened as the
      // star would be there.
      const t = SKY.transmittance(this.air, Math.PI / 2 - altitude);
      // A Lambertian disc reflecting a given irradiance has radiance
      // albedo/pi times it - and then the same display gain as everything
      // else in the scene, or the moon is drawn at raw radiance next to a sky
      // that has been exposed, and vanishes.
      const g = (m.albedo / Math.PI) * this.exposure;
      out.push({
        name: m.name,
        dir: [dir.x, dir.y, dir.z],
        angRad: Math.atan2(m.radiusM, dist),
        light,
        color: [
          m.color[0] * g * this.starRGB[0] * t[0],
          m.color[1] * g * this.starRGB[1] * t[1],
          m.color[2] * g * this.starRGB[2] * t[2],
        ],
      });
    }
    this.placeParent(out);
    this.placeSiblings(out);
    this.measureEclipse(out);
    this.view.setMoons(out);
  }

  /**
   * The other moons of the planet you are standing on one of.
   *
   * These are the best things in the sky after the planet itself, and the
   * arithmetic says so. Io passes within two hundred and fifty thousand
   * kilometres of Europa - closer than our Moon ever comes to us - and it is
   * as big, so it goes past nearly a degree wide. Ganymede is bigger still.
   * And they move: a couple of degrees an hour, fast enough to watch against
   * the stars, because they are close and they are quick.
   *
   * Their places are two points on two circles, subtracted. The observer's own
   * angle round its orbit is fixed by the clock - a locked moon turns once per
   * orbit, so its noon *is* its superior conjunction - and everyone else keeps
   * the phase offset the system was generated with.
   */
  private placeSiblings(out: MoonDisc[]): void {
    const par = this.parent, own = this.parentMoon;
    if (!par || !own || !this.siblings.length) return;
    const ownPeriod = 2 * Math.PI * Math.sqrt(own.a ** 3 / (G * par.massKg));
    // The orbital plane in local terms. One axis is the planet; the other is
    // the moon's own rotation pole, which is the orbit normal, because a
    // locked moon turns once per orbit about exactly that.
    const u1 = this.parentDir.clone().normalize();
    const n = new THREE.Vector3(...EPH.dirFromAltAz(this.lat, 0));
    const u2 = n.clone().cross(u1).normalize();
    const th0 = (2 * Math.PI * this.simTime) / ownPeriod;
    const zOwn = own.a * Math.sin(own.i) * Math.sin(th0);
    this.siblingSky.length = 0;

    const dir = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    const worldUp = new THREE.Vector3(0, 1, 0);
    const alt = new THREE.Vector3(1, 0, 0);
    for (const sib of this.siblings) {
      const m = sib.moon;
      const th = (2 * Math.PI * this.simTime) / sib.period + sib.dPhase;
      const d = th - th0;
      dir.set(0, 0, 0)
        .addScaledVector(u1, own.a - m.a * Math.cos(d))
        .addScaledVector(u2, -m.a * Math.sin(d))
        .addScaledVector(n, m.a * Math.sin(m.i) * Math.sin(th) - zOwn);
      const dist = dir.length();
      if (dist <= 0) continue;
      dir.multiplyScalar(1 / dist);
      const altitude = Math.asin(Math.max(-1, Math.min(1, dir.y)));
      if (altitude < -Math.atan2(m.radiusM, dist)) continue;
      // Behind the planet, which happens twice an orbit and takes hours.
      if (dist > own.a && dir.angleTo(this.parentDir)
        < COMP.parentAngularRadius(par.radiusM, own.a)) continue;

      right.copy(Math.abs(dir.y) > 0.95 ? alt : worldUp).cross(dir).normalize();
      up.copy(dir).cross(right).normalize();
      const t = SKY.transmittance(this.air, Math.PI / 2 - altitude);
      const g = (m.albedo / Math.PI) * this.exposure;
      const ang = Math.atan2(m.radiusM, dist);
      this.siblingSky.push({
        name: m.name,
        wideDeg: (2 * ang * 180) / Math.PI,
        lit: COMP.illuminatedFraction(
          Math.PI - Math.acos(Math.max(-1, Math.min(1, this.sunDir.dot(dir))))),
        alt: (altitude * 180) / Math.PI,
      });
      out.push({
        name: m.name,
        dir: [dir.x, dir.y, dir.z],
        angRad: Math.atan2(m.radiusM, dist),
        light: [this.sunDir.dot(right), this.sunDir.dot(up), -this.sunDir.dot(dir)],
        color: [
          m.color[0] * g * this.starRGB[0] * t[0],
          m.color[1] * g * this.starRGB[1] * t[1],
          m.color[2] * g * this.starRGB[2] * t[2],
        ],
      });
    }
  }

  /**
   * How much of the star is behind something, and how much light that costs.
   *
   * Nothing schedules this. Every disc that has been put in the sky is tested
   * against the star, and if one of them is in the way the light goes down.
   * Standing at the sub-planet point of a close moon it happens every single
   * orbit, because a locked moon's noon is its superior conjunction and the
   * planet is at the zenith at noon - which is why Io is eclipsed every
   * forty-two hours and Europa every three and a half days.
   *
   * Planets are not tested. A transit of Venus is a real occultation of the
   * Sun and it takes one part in a thousand of the light, which is a thousand
   * times too little to see and was still enough to measure the astronomical
   * unit with in 1769.
   */
  private measureEclipse(out: MoonDisc[]): void {
    const s: EPH.Vec3 = [this.sunDir.x, this.sunDir.y, this.sunDir.z];
    let light = 1, cover = 0, by = '';
    this.occDir = null; this.occAng = 0;
    for (const d of out) {
      const sep = EPH.angleBetween(d.dir, s);
      const f = EPH.coveredFraction(sep, this.starAngRad, d.angRad);
      // A bare rock in front of a star leaves a black hole and nothing else.
      d.halo = this.hasHalo.has(d.name ?? '') ? f : 0;
      if (f <= 0) continue;
      if (f > cover) {
        cover = f; by = d.name ?? '';
        this.occDir = d.dir; this.occAng = d.angRad;
      }
      light = Math.min(light, EPH.eclipseLight(sep, this.starAngRad, d.angRad));
    }
    this.eclipse = light; this.eclipseCover = cover; this.eclipseBy = by;
  }

  /**
   * The wanderers: every other planet of this system, where it really is.
   *
   * Drawn as points because that is what they are to the eye, dimmed and
   * reddened by exactly the same air that dims and reddens the star, and
   * dropped below the naked-eye limit - so a world with a thick atmosphere
   * loses them near the horizon first and Titan loses them entirely.
   */
  private placeWanderers(): void {
    if (!this.bodies.length) return;
    this.wanderers = EPH.skyBodies(
      this.bodies, this.obsPos, this.muStar, this.simTime, this.toLocal, this.hostIndex,
    );
    const pts: SkyPoint[] = [];
    for (const b of this.wanderers) {
      if (b.altitude < 0) continue;
      const tau = SKY.opticalDepth(this.air, Math.PI / 2 - b.altitude);
      let peak = 0;
      const f: [number, number, number] = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        f[k] = EPH.fluxOfMagnitude(b.mag + EPH.extinctionMag(tau[k]));
        peak = Math.max(peak, f[k]);
      }
      if (peak < POINT_FLOOR) continue;
      // Its own colour kept, but pulled toward white: a point bright enough to
      // see saturates the eye, and a saturated eye reports white.
      const lum = Math.max(1e-6, (b.color[0] + b.color[1] + b.color[2]) / 3);
      pts.push({
        dir: b.dir,
        color: [
          f[0] * POINT_GAIN * ((b.color[0] / lum) * 0.55 + 0.45),
          f[1] * POINT_GAIN * ((b.color[1] / lum) * 0.55 + 0.45),
          f[2] * POINT_GAIN * ((b.color[2] / lum) * 0.55 + 0.45),
        ],
        angRad: POINT_ANG,
      });
    }
    this.view.setPoints(pts);
  }

  /**
   * The planet this moon goes round, hanging in one place in its sky.
   *
   * It does not rise or set. A close moon is locked, so the same face is
   * always turned toward the planet and the planet is always over the same
   * patch of ground - high overhead at the sub-planet point, on the horizon a
   * quarter of the way round, and never seen at all from the far side. What
   * changes is only its phase, running through a full cycle every orbit and
   * opposite to the one the planet sees of the moon.
   */
  private placeParent(out: MoonDisc[]): void {
    const par = this.parent, m = this.parentMoon;
    if (!par || !m) return;
    const alt = COMP.parentAltitude(m.a, this.planet.radiusM, Math.abs(this.lat));
    if (alt < -COMP.parentAngularRadius(par.radiusM, m.a)) return;

    // Due north of the standing point, by construction: the sub-planet point
    // is where you walked from.
    this.parentDir.set(0, Math.sin(alt), -Math.cos(alt)).normalize();
    const dir = this.parentDir;
    const worldUp = new THREE.Vector3(0, 1, 0);
    const alt2 = new THREE.Vector3(1, 0, 0);
    const right = new THREE.Vector3()
      .copy(Math.abs(dir.y) > 0.95 ? alt2 : worldUp).cross(dir).normalize();
    const up = new THREE.Vector3().copy(dir).cross(right).normalize();

    const t = SKY.transmittance(this.air, Math.PI / 2 - alt);
    const g = (par.albedo / Math.PI) * this.exposure;
    const giant = par.pressureBar > 30 || par.radiusM > 2.2e7;
    const ring = par.rings[0];
    out.push({
      name: par.name,
      dir: [dir.x, dir.y, dir.z],
      angRad: COMP.parentAngularRadius(par.radiusM, m.a),
      light: [this.sunDir.dot(right), this.sunDir.dot(up), -this.sunDir.dot(dir)],
      color: [
        par.color[0] * g * this.starRGB[0] * t[0],
        par.color[1] * g * this.starRGB[1] * t[1],
        par.color[2] * g * this.starRGB[2] * t[2],
      ],
      banded: giant,
      seed: (par.surfaceSeed % 997) / 13.7,
      ring: ring ? {
        inner: ring.innerM / par.radiusM,
        outer: ring.outerM / par.radiusM,
        // A moon orbits in the ring plane, so they are edge-on to within its
        // own orbital tilt - a line drawn through the planet, not a hoop.
        sinOpening: Math.max(0.008, Math.abs(Math.sin(m.i))),
        opacity: ring.opacity,
      } : undefined,
    });
  }

  override onResize(): void {}

  rows(): Row[] {
    const p = this.planet;
    const t = SKY.transmittance(this.air, Math.PI / 2 - this.altitude);
    const zen = SKY.opticalDepth(this.air, 0);
    const deg = (this.altitude * 180) / Math.PI;
    const dec = this.locked ? 0 : this.declination;
    const day = this.locked ? 1 : SKY.daylightFraction(this.lat, dec);
    return [
      ...this.eclipseRows(),
      { k: 'star altitude', v: `${deg >= 0 ? '+' : ''}${deg.toFixed(1)}`, u: '°', accent: true },
      {
        k: 'it is',
        v: this.eclipseCover > 0.98 ? 'totality'
          : deg > 6 ? 'day' : deg > -0.5 ? 'sunrise or sunset'
            : deg > -6 ? 'civil twilight' : deg > -18 ? 'astronomical twilight' : 'night',
        accent: true,
      },
      { k: 'star width', v: ((2 * this.starAngRad * 180) / Math.PI).toFixed(2), u: '°' },
      { k: 'air mass', v: this.air.pressurePa > 0 && deg > -1
        ? SKY.airMass(this.air, Math.PI / 2 - this.altitude).toFixed(2) : '—' },
      { k: 'air lets through', v: `${(t[1] * 100).toFixed(deg > 5 ? 0 : 1)}%` },
      {
        k: 'zenith τ',
        // With the scale height beside it, because the two together are the
        // whole of what an atmosphere does to a sky: how much there is, and
        // how far up it goes.
        v: `${zen[1] < 0.01 ? sig(zen[1], 2) : zen[1].toFixed(3)}${
          this.air.pressurePa > 0
            ? ` · ${(this.air.scaleHeightM / 1000).toFixed(1)} km up` : ''}`,
      },
      { k: 'horizon', v: (SKY.horizonDistance(p.radiusM, this.eyeH) / 1000).toFixed(2), u: 'km' },
      { k: 'gravity', v: (p.gravity / 9.80665).toFixed(2), u: 'g' },
      { k: 'day length', v: formatTime(this.dayS).join(' ') },
      {
        k: 'year',
        // The tilt is the whole reason there is anything to say about the
        // year at all: an upright world has no seasons, only a distance.
        v: `${formatTime(this.yearS).join(' ')}${this.tilt > 0.02
          ? ` · ${((this.tilt * 180) / Math.PI).toFixed(0)}° tilt`
          : ' · upright, no seasons'}`,
      },
      {
        k: 'daylight',
        // In this world's day, not in Earth's. Mercury's day is fifty-nine of
        // ours and half of it is daylight, which is twenty-nine days of it.
        v: this.locked ? 'always' : day <= 0 ? 'never'
          : formatTime(day * this.dayS).join(' '),
      },
      { k: 'local time', v: this.locked ? 'no days here' : this.clock() },
      ...this.parentRows(),
      ...this.siblingRows(),
      ...this.wandererRows(),
    ];
  }

  /**
   * The planet's other moons, when any of them are up.
   *
   * Worth a line each because of how big they get. From Europa, Io comes
   * within two hundred and fifty thousand kilometres - closer than the Moon
   * ever comes to Earth - and it is very nearly the same size, so it goes past
   * three quarters of a degree wide and takes a few hours to do it.
   */
  private siblingRows(): Row[] {
    const up = this.siblingSky.filter((m) => m.alt > 0)
      .sort((a, b) => b.wideDeg - a.wideDeg);
    if (!up.length) return [];
    return up.slice(0, 3).map((m) => ({
      k: m.name,
      v: `${m.wideDeg.toFixed(2)}° wide · ${(m.lit * 100).toFixed(0)}% lit · ${
        m.alt.toFixed(0)}° up`,
      accent: m.wideDeg > 0.52,
    }));
  }

  /** What is in front of the star, when something is. */
  private eclipseRows(): Row[] {
    if (this.eclipseCover <= 1e-4) return [];
    const total = this.eclipseCover >= 0.999;
    return [
      {
        k: total ? 'total eclipse' : 'eclipse',
        v: `${(this.eclipseCover * 100).toFixed(total ? 0 : 1)}% of the star`,
        accent: true,
      },
      { k: 'behind', v: this.eclipseBy || 'something', accent: true },
      {
        k: 'sunlight',
        // Not one minus the covered fraction: a star is limb darkened, so the
        // first bite out of the dim rim is cheap and the last sliver is not.
        v: this.eclipse > 0.01 ? `${(this.eclipse * 100).toFixed(1)}%`
          : `${(this.eclipse * 1e4).toFixed(0)} parts in a million`,
      },
    ];
  }

  /**
   * The other planets, in the order the eye would find them.
   *
   * The elongation row is the one worth reading. A planet inside your own
   * orbit cannot get far from the star and so is only ever seen just before
   * dawn or just after dusk, and the row says which; a planet outside it
   * reaches opposition, rises as the star sets, and is up all night.
   */
  private wandererRows(): Row[] {
    const up = this.wanderers.filter((w) => w.altitude > 0 && w.mag < 6.5);
    if (!up.length) return [];
    const rows: Row[] = [{
      k: 'planets up', v: `${up.length} of ${this.wanderers.length}`, accent: true,
    }];
    for (const w of up.slice(0, 3)) {
      const el = (w.elongationRad * 180) / Math.PI;
      // East of the star rises after it and sets after it, so it is an
      // evening star; west of it rises first and is a morning star. Nothing
      // about the hour comes into it - the same planet is one or the other for
      // months at a time, and it swaps at conjunction.
      const evening = EPH.isEastOf(
        EPH.dirFromAltAz(this.lat, 0),
        [this.sunDir.x, this.sunDir.y, this.sunDir.z], w.dir,
      );
      rows.push({
        k: w.name,
        v: `${w.mag >= 0 ? '+' : ''}${w.mag.toFixed(1)} · ${
          el > 170 ? 'at opposition, up all night'
            : el < 8 ? 'lost in the glare'
              : w.inner ? `${evening ? 'an evening' : 'a morning'} star, ${el.toFixed(0)}° out`
                : `${el.toFixed(0)}° from the star, ${(w.litFraction * 100).toFixed(0)}% lit`}`,
        accent: w.mag < 0,
      });
    }
    return rows;
  }

  /** What the planet overhead is doing, when there is one. */
  private parentRows(): Row[] {
    const par = this.parent, m = this.parentMoon;
    if (!par || !m) return [];
    const alt = COMP.parentAltitude(m.a, this.planet.radiusM, Math.abs(this.lat));
    const wide = (2 * COMP.parentAngularRadius(par.radiusM, m.a) * 180) / Math.PI;
    // Its phase is the angle between it and the star, as seen from here.
    const phase = Math.acos(Math.max(-1, Math.min(1, this.sunDir.dot(this.parentDir))));
    const litFrac = COMP.illuminatedFraction(Math.PI - phase);
    const ecl = this.eclipseFraction;
    return [
      { k: par.name, v: `${wide.toFixed(1)}° wide`, accent: true },
      { k: 'it is', v: `${(litFrac * 100).toFixed(0)}% lit`, accent: true },
      { k: 'and it is', v: alt > 0 ? `${(alt * 180 / Math.PI).toFixed(0)}° up, always` : 'below the horizon, always' },
      { k: 'vs our moon', v: `${(wide / 0.52).toFixed(0)}× as wide as a full one` },
      { k: 'month', v: formatTime(this.dayS).join(' ') },
      { k: 'eclipsed', v: ecl > 0 ? `${(ecl * 100).toFixed(0)}% of every orbit` : 'never' },
      { k: 'libration', v: `±${(COMP.librationAmplitude(m.e) * 180 / Math.PI).toFixed(1)}°` },
    ];
  }

  /** The time of day, on a clock with this planet's hours in it. */
  private clock(): string {
    const f = ((this.simTime / this.dayS) % 1 + 1) % 1;
    const h = Math.floor(f * 24);
    const m = Math.floor((f * 24 - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  scaleLabel(): string {
    const [v, u] = formatDistance(this.env.controls.distance);
    return `${v} ${u}`;
  }

  /**
   * Walk to a different latitude.
   *
   * The only navigation there is down here, and it is the one that changes
   * what you see: from the tropics the star goes overhead, from the poles it
   * scrapes the horizon and in winter it never comes up at all.
   */
  step(deltaDeg: number): number {
    const next = Math.max(-88, Math.min(88, ((this.ctx.lat ?? 34) + deltaDeg)));
    this.ctx.lat = next;
    this.lat = (next * Math.PI) / 180;
    return next;
  }

  /**
   * Down again, into the ground you are standing on.
   *
   * There was never a reason for the ladder to stop at the soles of your feet
   * except that that is where you happen to be. The angstrom is as far below a
   * metre as the Kuiper belt is above it.
   */
  child(): Target | null {
    const g = XTL.groundOf(this.planet);
    return { id: 'matter', ctx: { ...this.ctx }, label: g.mineral.name };
  }

  override dispose(): void {
    this.view.dispose(); this.sky.dispose(); super.dispose();
  }
}

/**
 * The ground, at the scale where it stops being ground.
 *
 * Ten orders of magnitude below the last rung, which is the same span as from
 * a person to the Kuiper belt, and the only reason the ladder used to stop
 * where it did is that that is where the observer happens to be standing.
 *
 * What is down here is not a smaller version of the landscape. It is a
 * pattern - a handful of atoms, repeated by translation, without end. That is
 * the entire definition of a crystal, and everything else about a solid comes
 * out of it: why it cleaves along flat planes, why gemstones have the shapes
 * they do, why it has a melting point at all rather than just getting softer.
 *
 * And it is moving, which is the point of coming down. The waves running
 * through it are phonons, and a phonon is a sound wave; the heat in a rock and
 * a knock travelling through it are the same object, one disorganised and one
 * not. Standing on the surface you could feel the second one. Here you can
 * watch the first.
 */
export class MatterStage extends Stage {
  readonly id = 'matter' as const;
  title = 'Matter';
  subtitle = '';
  private ground!: XTL.Ground;
  private view!: LatticeView;
  private atoms: LatticeAtom[] = [];
  private elements: string[] = [];
  private worldName = '';
  private worldRadiusM = R_EARTH;

  private bondCount = 0;
  private tempK = 288;
  /** The readout's constants, worked out once: none of them can change here. */
  private facts!: {
    rho: number; bondPm: number; coord: number; n: number; vs: number;
    thz: number; spanCells: number;
  };
  /** 0 for ball and stick, 1 for atoms at the size they really are. */
  private fill = 0;
  private fillWant = 0;

  build(): void {
    const { system } = systemOf(this.env, this.ctx);
    const { world } = standingOn(system, this.ctx);
    this.worldName = world.name;
    this.worldRadiusM = world.radiusM;
    this.tempK = world.surfaceK;
    this.ground = XTL.groundOf(world);
    const m = this.ground.mineral;

    this.title = m.name;
    this.subtitle = `${m.formula} under ${world.name} · ${m.note}`;

    // A block big enough to read as a pattern and small enough to draw. Cells
    // rather than atoms, because the cell is the thing that repeats.
    const n = Math.max(3, Math.round(Math.cbrt(2300 / m.sites.length)));
    const block = XTL.buildBlock(m, n, n, n);
    const [v1, v2, v3] = XTL.cellVectors(m);
    const mid: [number, number, number] = [
      ((v1[0] + v2[0] + v3[0]) * n) / 2,
      ((v1[1] + v2[1] + v3[1]) * n) / 2,
      ((v1[2] + v2[2] + v3[2]) * n) / 2,
    ];
    // One scene unit is one angstrom, all the way down: no float trouble, and
    // the numbers on the scale bar are the numbers a crystallographer uses.
    const ANG = 1e10;
    // Carved to a ball rather than left as the box it was tiled in. A specimen
    // with space around it reads as one; a cube that runs off all four edges
    // reads as wallpaper, and it buries the instruments in the corner.
    const ball = (Math.min(n * m.a, n * (m.c ?? m.a)) * ANG) / 2;
    this.atoms = [];
    for (const at of block) {
      const x = (at.pos[0] - mid[0]) * ANG;
      const y = (at.pos[1] - mid[1]) * ANG;
      const z = (at.pos[2] - mid[2]) * ANG;
      if (x * x + y * y + z * z > ball * ball) continue;
      const el = XTL.ELEMENTS[at.el];
      const r = el.radiusM * ANG;
      this.atoms.push({
        pos: [x, y, z],
        radius: r,
        // Square-rooted, which keeps the ordering and compresses the range.
        drawRadius: 0.52 * Math.sqrt(r),
        color: el.color,
        mass: el.weight,
      });
    }
    this.elements = [...new Set(m.sites.map((x) => x.el))];

    // A stick between atoms that are actually bonded. Nothing chemical reaches
    // past three and a bit angstroms, so a molecular solid - where the nearest
    // other molecule is four away - correctly gets none, and the molecules
    // float in their packing the way they really do.
    const d0 = XTL.nearestNeighbour(m) * ANG;
    const cut = Math.min(d0 * 1.16, 3.2);
    const bonds: [number, number][] = [];
    if (cut >= d0) {
      for (let i = 0; i < this.atoms.length; i++) {
        for (let j = i + 1; j < this.atoms.length; j++) {
          const a = this.atoms[i].pos, b = this.atoms[j].pos;
          const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
          if (dx * dx + dy * dy + dz * dz <= cut * cut) bonds.push([i, j]);
        }
      }
    }
    this.bondCount = bonds.length;

    this.facts = {
      rho: XTL.latticeDensity(m),
      bondPm: XTL.nearestNeighbour(m) * 1e10,
      coord: XTL.coordination(m, 0),
      n: XTL.numberDensity(m),
      vs: XTL.soundSpeed(m),
      thz: XTL.debyeFrequency(m) / 1e12,
      spanCells: (2 * this.worldRadiusM) / m.a,
    };

    const spacing = XTL.unitSpacing(m) * ANG;
    const refMass = XTL.unitMass(m);
    const amplitude = XTL.thermalAmplitude(refMass, m.debyeK, this.tempK) * ANG;
    const extent = 2 * ball;
    this.view = new LatticeView({
      atoms: this.atoms, bonds,
      amplitude, refMass, spacing,
      omegaMax: 2 * Math.PI * XTL.debyeFrequency(m),
      fogRange: extent * 0.85,
      seed: (world.surfaceSeed % 65521) + 1,
    });
    this.root.add(this.view.group);

    // Slow enough to watch. The fastest wave a crystal can carry goes round in
    // about a tenth of a picosecond, so a second of wall clock is set to a bit
    // less than one turn of it - and the long waves, which run slower because
    // the dispersion bends over, swell underneath at a few seconds a cycle.
    this.timeScale = (0.7 * 2 * Math.PI) / (2 * Math.PI * XTL.debyeFrequency(m));

    const c = this.env.controls;
    c.snapTo(new THREE.Vector3(0, 0, 0), extent * 1.45, 0.9, 1.15);
    c.drift = 0.018;
    c.minDistance = 3;
    c.maxDistance = extent * 6;
    const cam = this.env.engine.camera;
    cam.near = 0.05; cam.far = extent * 40;
    cam.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.simTime += dt * this.timeScale;
    this.view.setTime(this.simTime);
    if (this.fill !== this.fillWant) {
      const k = 1 - Math.exp(-dt * 6);
      this.fill += (this.fillWant - this.fill) * k;
      if (Math.abs(this.fillWant - this.fill) < 1e-3) this.fill = this.fillWant;
      this.view.setFill(this.fill);
    }
  }

  /**
   * Swell the atoms to the size they really are.
   *
   * Everything about a crystal is normally drawn as balls and sticks at a
   * third of scale, because otherwise there is nothing to see - and what there
   * is nothing to see of is the point. At full size the spheres touch and
   * overlap and the structure disappears into a solid block, which is what a
   * solid is. In quartz it is the oxygen that fills the space; the silicon is
   * a small thing hiding in the gaps between them.
   */
  swell(): number {
    this.fillWant = this.fillWant > 0.5 ? 0 : 1;
    return this.fillWant;
  }

  rows(): Row[] {
    const m = this.ground.mineral, f = this.facts;
    const melt = m.meltK;
    const shake = this.ground.shake;
    const rows: Row[] = [
      { k: 'mineral', v: `${m.name} · ${m.formula}`, accent: true },
      { k: 'system', v: `${m.system} · ${m.group}` },
      {
        k: 'cell',
        v: m.c
          ? `a ${(m.a * 1e10).toFixed(3)} · c ${(m.c * 1e10).toFixed(3)} Å`
          : `a ${(m.a * 1e10).toFixed(4)} Å`,
      },
      { k: 'nearest atom', v: f.bondPm.toFixed(3), u: 'Å' },
      { k: 'each surrounded by', v: `${f.coord} of them` },
      {
        k: 'density',
        // Mass in a cell over the volume of the cell, and nothing else. That it
        // lands on the measured value is the check that the structure is real.
        v: `${f.rho.toFixed(0)} kg/m³ · measured ${m.densityRef}`,
      },
      { k: 'atoms per m³', v: sig(f.n, 3) },
      { k: 'temperature', v: `${this.tempK.toFixed(0)} K`, accent: true },
      {
        k: 'shaking through',
        v: `${(shake * 100).toFixed(1)}% of the spacing`,
        accent: true,
      },
      {
        k: 'it gives way at',
        // Not a prediction - the measured melting point. What is predicted is
        // the ratio, and it comes out near a tenth for everything.
        v: this.ground.molten
          ? `${melt.toFixed(0)} K, and it is past it`
          : `${melt.toFixed(0)} K, ${(melt - this.tempK).toFixed(0)} K away`,
      },
      { k: 'speed of sound', v: f.vs.toFixed(0), u: 'm/s' },
      { k: 'Debye temperature', v: m.debyeK.toFixed(0), u: 'K' },
      {
        k: 'highest note',
        // There is a shortest wave a lattice can carry, and it is two atoms
        // long, because anything shorter has nothing left to wave.
        v: `${f.thz.toFixed(1)} THz`,
      },
      {
        k: 'in view',
        v: `${commas(this.atoms.length)} atoms${
          this.bondCount ? ` · ${commas(this.bondCount)} bonds` : ''}`,
      },
      {
        k: 'stacked end to end',
        // The number that says how far down this is. It is the same arithmetic
        // as counting metre sticks out to the Kuiper belt, and it comes to
        // about the same answer.
        v: `${sig(f.spanCells, 3)} cells would span ${this.worldName}`,
      },
    ];
    for (const el of this.elements) {
      const e = XTL.ELEMENTS[el];
      rows.push({ k: e.name, v: e.origin });
    }
    return rows;
  }

  /** Click an atom and find out where its nuclei were assembled. */
  override inspect(ndc: THREE.Vector2): Inspection | null {
    const pts = this.atoms.map((a, index) => ({
      pos: new THREE.Vector3(...a.pos), radius: a.radius * 1.6, index,
    }));
    const i = this.pickNearest(ndc, pts, 0.05);
    if (i === null) return null;
    const m = this.ground.mineral;
    const key = m.sites[i % m.sites.length].el;
    const e = XTL.ELEMENTS[key];
    const amp = XTL.amplitudeOf(m, key, this.tempK);
    return {
      title: e.name,
      kind: `${e.symbol} · element ${e.z}`,
      swatch: `rgb(${e.color.map((c) => Math.round(255 * Math.sqrt(c))).join(',')})`,
      rows: [
        { k: 'mass', v: e.weight.toFixed(3), u: 'u' },
        { k: 'protons', v: `${e.z}` },
        { k: 'radius', v: (e.radiusM * 1e12).toFixed(0), u: 'pm' },
        { k: 'moving through', v: `±${(amp * 1e12).toFixed(1)} pm` },
        {
          k: 'which is',
          v: `${((amp / XTL.nearestNeighbour(m)) * 100).toFixed(1)}% of a bond`,
        },
      ],
      note: `Made in ${e.origin}. Every one of these nuclei is older than the `
        + `world it is now part of, and you have already flown past the kind of `
        + `place it was made in.`,
    };
  }

  scaleLabel(): string {
    const d = this.env.controls.distance;
    return d < 100 ? `${d.toFixed(1)} Å` : `${(d / 10).toFixed(1)} nm`;
  }

  /**
   * Down again, into one of them.
   *
   * Aim at an atom and you go into that one - the only place on the ladder
   * where what you are pointing at picks the substance rather than the object,
   * and it matters, because the two elements in a grain of quartz look nothing
   * like each other from the inside.
   */
  child(ndc?: THREE.Vector2): Target | null {
    const m = this.ground.mineral;
    let el = m.sites[0].el;
    if (ndc) {
      const pts = this.atoms.map((a, index) => ({
        pos: new THREE.Vector3(...a.pos), radius: a.radius * 1.6, index,
      }));
      const i = this.pickNearest(ndc, pts, 0.05);
      if (i !== null) el = m.sites[i % m.sites.length].el;
    }
    const e = XTL.ELEMENTS[el];
    return { id: 'atom', ctx: { ...this.ctx, z: e.z }, label: `one ${e.name} atom` };
  }

  override dispose(): void { this.view.dispose(); super.dispose(); }
}

/**
 * One atom, and the fact that it is almost entirely nothing.
 *
 * The rung above is a lattice of spheres at fixed distances, which is exactly
 * how a solid behaves and exactly how every chemist draws it. The spheres are
 * a lie of a very particular kind: there is no surface there. What sets the
 * size of an atom is the region an electron is likely to be found in, and
 * "likely" is the whole of it - the electron does not have a position that it
 * is at, it has a distribution that it is described by, and the edge of the
 * atom is wherever you decide the distribution has got small enough.
 *
 * So this draws the distribution and nothing else, and re-samples it
 * continually, because an orbital is not an object sitting still being looked
 * at. And it draws the nucleus at true size, which means it draws nothing you
 * can see: if the cloud were a stadium, the nucleus would be a grain of sand
 * on the centre spot, carrying all but a two-thousandth of the mass. That is
 * the single most surprising true thing about matter, and it is worth crossing
 * a scale to be shown rather than told.
 */
export class AtomStage extends Stage {
  readonly id = 'atom' as const;
  title = 'Atom';
  subtitle = '';
  private element!: XTL.Element;
  private cloud!: OrbitalCloud;
  private specs: OrbitalSpec[] = [];
  private only = -1;
  private radiusM = 1e-10;
  private massNumber = 1;
  /**
   * Everything in the readout that cannot change while you are standing here.
   *
   * It is all a function of one integer. Recomputing it on every readout tick
   * cost most of a millisecond, nearly all of it in two scans for the peak of
   * a radial distribution that had already been scanned for at build time.
   */
  private facts!: {
    config: string; valenceZeff: number; error: number; innerPeakPm: number;
    nucleusFm: number; oneIn: number; kmNucleus: number; massPercent: number;
    beta: number;
  };
  /** Scene units per metre. One unit is a picometre. */
  private readonly unit = 1e12;
  private nucleus?: THREE.Mesh;

  build(): void {
    const key = Object.keys(XTL.ELEMENTS).find(
      (k) => XTL.ELEMENTS[k].z === (this.ctx.z ?? 14),
    ) ?? 'Si';
    const e = XTL.ELEMENTS[key];
    this.element = e;
    this.massNumber = Math.round(e.weight);
    this.radiusM = ATOM.atomRadius(e.z);

    this.title = e.name;
    this.subtitle = `${ATOM.configurationText(e.z)} · ${e.z} electron${
      e.z === 1 ? '' : 's'} round a nucleus ${
      (this.radiusM / ATOM.nuclearRadius(this.massNumber) / 1000).toFixed(0)
    } thousand times smaller than the cloud`;

    // One entry per real orbital that has an electron in it, with Hund's rule
    // deciding which of them that is: one electron into each before any of
    // them takes a second. It is why carbon's cloud has lobes and neon's is a
    // ball, and it is visible from here.
    const v0 = ATOM.valenceOf(e.z);
    this.specs = [];
    for (const sub of ATOM.configuration(e.z)) {
      const occ = hundOccupancy(sub.l, sub.count);
      const zeff = ATOM.slaterZeff(e.z, sub.n, sub.l);
      for (let i = 0; i < occ.length; i++) {
        if (occ[i] <= 0) continue;
        const m = i - sub.l;
        this.specs.push({
          n: sub.n, l: sub.l, m, occupancy: occ[i], zeff,
          color: shellColour(sub.n, sub.l),
          label: ATOM.orbitalLabel(sub.n, sub.l, m),
        });
      }
    }

    const err = ATOM.hydrogenicError(e.z);
    const rn = ATOM.nuclearRadius(this.massNumber);
    this.facts = {
      config: ATOM.configurationText(e.z),
      valenceZeff: ATOM.slaterZeff(e.z, v0.n, v0.l),
      error: err,
      innerPeakPm: ATOM.peakRadius(1, 0, ATOM.slaterZeff(e.z, 1, 0)) * 1e12,
      nucleusFm: rn * 1e15,
      oneIn: 1 / ATOM.emptiness(this.radiusM, this.massNumber),
      // How big the nucleus would be if the atom were a kilometre across.
      kmNucleus: 1000 * (rn / this.radiusM),
      // An electron is one part in 1836 of a proton, so even hydrogen keeps
      // all but a two-thousandth of itself in the part you cannot see.
      massPercent: 100 * (1 - (e.z * 5.4858e-4) / e.weight),
      beta: ATOM.innerElectronBeta(e.z),
    };

    const cal = 1 / err;
    this.cloud = new OrbitalCloud({
      orbitals: this.specs,
      points: this.env.quality() > 0.6 ? 46000 : 22000,
      scale: this.unit,
      calibration: cal,
      seed: e.z * 7919 + 13,
    });
    this.root.add(this.cloud.group);

    // The nucleus, at true scale. It is there, it is in the right place, and
    // it is far too small to see - which is the point. Fly at it for long
    // enough and you do arrive.
    const rNuc = ATOM.nuclearRadius(this.massNumber) * this.unit;
    const nucGeo = new THREE.SphereGeometry(rNuc, 24, 16);
    this.nucleus = new THREE.Mesh(nucGeo, new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.0, 0.86, 0.62),
    }));
    this.root.add(this.nucleus);

    const extent = this.radiusM * this.unit;
    const c = this.env.controls;
    c.snapTo(new THREE.Vector3(0, 0, 0), extent * 4.4, 0.7, 1.2);
    c.drift = 0.02;
    // All the way down to the nucleus, if you have the patience. The scale bar
    // runs from picometres to femtometres on the way.
    c.minDistance = rNuc * 2.5;
    c.maxDistance = extent * 24;
    this.timeScale = 1;
    this.reframe();
  }

  /**
   * Keep the depth buffer usable across nine orders of magnitude.
   *
   * The camera can stand at a hundred picometres or at four femtometres, and a
   * fixed near plane cannot serve both: set it small enough to reach the
   * nucleus and every depth value out at the cloud collapses into the last
   * few bits, which shows up as the middle of the atom quietly disappearing.
   * So the near plane follows the camera down instead.
   */
  private reframe(): void {
    const d = this.env.controls.distance;
    const cam = this.env.engine.camera;
    cam.near = Math.max(1e-9, d * 1e-3);
    cam.far = Math.max(d * 40, this.radiusM * this.unit * 60);
    cam.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.simTime += dt;
    this.reframe();
    this.cloud.update(dt);
    // Points are drawn at a constant size on screen, so as you fly in the
    // cloud thins out and the sampling has to be brightened to compensate -
    // otherwise the atom simply fades away as you approach it.
    const d = this.env.controls.distance;
    const near = Math.max(0.2, Math.min(1, d / (this.radiusM * this.unit * 2)));
    this.cloud.setBrightness(0.6 / near);
  }

  /** Step through the occupied orbitals one at a time, then back to all. */
  cycleOrbital(): string {
    this.only = this.only + 1 >= this.specs.length ? -1 : this.only + 1;
    this.cloud.setOnly(this.only);
    return this.only < 0 ? 'all of them' : this.specs[this.only].label;
  }

  rows(): Row[] {
    const e = this.element, f = this.facts;
    const km = f.kmNucleus;
    return [
      { k: 'element', v: `${e.name} · ${e.symbol} · ${e.z} protons`, accent: true },
      { k: 'configuration', v: f.config },
      { k: 'showing', v: this.only < 0 ? 'every orbital at once' : this.specs[this.only].label,
        accent: this.only >= 0 },
      { k: 'radius', v: (this.radiusM * 1e12).toFixed(0), u: 'pm' },
      {
        k: 'outer electron feels',
        // Slater's rules: the charge that is left after the inner electrons
        // have got in the way. It is what makes atoms shrink across a period.
        v: `${f.valenceZeff.toFixed(2)} protons, not ${e.z}`,
        accent: true,
      },
      {
        k: 'hydrogenic model',
        v: `${f.error > 1.08 ? 'too big by' : 'within'} ×${f.error.toFixed(2)}`,
      },
      { k: 'innermost shell', v: f.innerPeakPm.toFixed(2), u: 'pm' },
      { k: 'nucleus', v: f.nucleusFm.toFixed(2), u: 'fm', accent: true },
      {
        k: 'which is',
        v: `1 part in ${sig(f.oneIn, 2)} of the volume`,
        accent: true,
      },
      {
        k: 'to scale',
        v: km < 0.1
          ? `an atom a kilometre wide would have a ${(km * 1000).toFixed(0)} mm nucleus`
          : `an atom a kilometre wide would have a ${(km * 100).toFixed(0)} cm nucleus`,
      },
      {
        k: 'and yet',
        v: `${f.massPercent.toFixed(2)}% of the mass is in it`,
      },
      {
        k: 'innermost electron',
        v: `${(f.beta * 100).toFixed(1)}% of light speed`,
      },
      { k: 'made in', v: e.origin },
    ];
  }

  override inspect(): Inspection | null { return null; }

  scaleLabel(): string {
    const d = this.env.controls.distance;
    if (d >= 1) return `${d.toFixed(d < 10 ? 2 : 0)} pm`;
    if (d >= 1e-3) return `${(d * 1000).toFixed(1)} fm`;
    return `${(d * 1e6).toFixed(1)} am`;
  }

  /** All the way in, to the part that has the mass in it. */
  child(): Target | null {
    return {
      id: 'nucleus',
      ctx: { ...this.ctx, z: this.element.z },
      label: `the ${this.element.name} nucleus`,
    };
  }

  override dispose(): void { this.cloud.dispose(); super.dispose(); }
}

/**
 * A colour per shell, so the structure of the thing is legible.
 *
 * By principal quantum number, because that is what separates the shells in
 * space; a slight shift by angular momentum inside each one, so an s and a p
 * of the same shell can be told apart.
 */
function shellColour(n: number, l: number): [number, number, number] {
  const base: [number, number, number][] = [
    [1.00, 0.95, 0.86],   // 1: white hot, and practically at the nucleus
    [1.00, 0.52, 0.16],   // 2: orange
    [0.20, 0.82, 0.58],   // 3: green
    [0.86, 0.30, 0.86],   // 4: magenta
    [0.30, 0.62, 1.00],   // 5: blue
  ];
  const c = base[Math.min(base.length - 1, n - 1)];
  // A shift with angular momentum, so an s and a p of the same shell are
  // distinguishable without breaking the shell's identity.
  const k = 1 - l * 0.10;
  return [c[0] * k, c[1] * (1 + l * 0.10), c[2] * (1 + l * 0.16)];
}

/**
 * The bottom, and the reason everything above it is what it is.
 *
 * Nine rungs down from the cosmic web, and what is here is a drop of the
 * densest stuff that exists outside a black hole - a hundred million million
 * times the density of water, the same material a neutron star is made of, and
 * the place essentially all of the mass has been hiding the whole way down.
 *
 * It churns, and the reason it churns is the best fact in nuclear physics.
 * Nucleons are fermions, so no two can be in the same state, so they cannot
 * all settle to the bottom - they are forced up a ladder of momenta whether
 * there is any heat about or not. The topmost is moving at a quarter of the
 * speed of light. Nothing is stirring them, and nothing can stop them.
 *
 * And on the way in, the ladder closes. Above the readout is the binding
 * energy curve: how much it took to assemble a nucleus, per nucleon, against
 * how many nucleons it has. It rises out of hydrogen, peaks at iron, and falls
 * away. Everything to the left of the peak gives energy when it is joined up,
 * which is what a star is; nothing at the peak gives anything at all, which is
 * why a star that has made iron stops holding itself up and falls in; and that
 * collapse is the supernova, which is how the oxygen four rungs up got out of
 * the star and into the ground you were standing on.
 *
 * The whole ladder is a consequence of the shape of that line.
 */
export class NucleusStage extends Stage {
  readonly id = 'nucleus' as const;
  title = 'Nucleus';
  subtitle = '';
  private element!: XTL.Element;
  private view!: NucleonView;
  private curve = new BindingCurve();
  private z = 14;
  private a = 28;
  /** The readout's constants. A nucleus does not change its mind. */
  private facts!: {
    terms: NUC.BindingTerms; radiusFm: number; rho: number;
    peak: { a: number; z: number; perNucleon: number };
    gain: number; fission: number; decay: string; defect: number;
    betaPercent: number; fermiMeV: number; chem: number; spoon: number;
  };
  /** Scene units per metre. One unit is a femtometre. */
  private readonly unit = 1e15;

  build(): void {
    const key = Object.keys(XTL.ELEMENTS).find(
      (k) => XTL.ELEMENTS[k].z === (this.ctx.z ?? 14),
    ) ?? 'Si';
    const e = XTL.ELEMENTS[key];
    this.element = e;
    this.z = e.z;
    this.a = Math.round(e.weight);
    const R = NUC.nuclearRadius(this.a) * this.unit;

    this.title = `${e.name}-${this.a}`;
    const below = this.a < NUC.bindingPeak().a;
    this.subtitle = `${this.z} proton${this.z === 1 ? '' : 's'} and ${
      this.a - this.z} neutron${this.a - this.z === 1 ? '' : 's'} in ${
      R.toFixed(2)} femtometres · ${
      below
        ? 'below the iron peak, so a star can still get energy out of it'
        : 'at or past the iron peak, where fusing it costs energy rather than giving it'}`;

    // Radii drawn from the Woods-Saxon profile, so the drop has the density
    // profile electron scattering actually measures - flat inside, and an edge
    // half a femtometre thick.
    let s = (this.z * 7919 + this.a * 104729) >>> 0 || 1;
    const rnd = (): number => {
      s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
    const seeds: NucleonSeed[] = [];
    for (let i = 0; i < this.a; i++) {
      const p = NUC.sampleNucleon(this.a, rnd);
      seeds.push({
        radius: Math.hypot(...p) * this.unit,
        proton: i < this.z,
      });
    }
    // The shell model's own frequency: hbar omega about 41 A^(-1/3) MeV, which
    // is the spacing of the levels a nucleon can sit in.
    const hbarOmegaMeV = 41 / Math.cbrt(this.a);
    const omega = (hbarOmegaMeV * NUC.MEV_J) / NUC.HBAR;

    this.view = new NucleonView({
      nucleons: seeds,
      // The proton's measured charge radius. At this scale a sphere is nearly
      // fair: this really is a packing problem, unlike the atom above it.
      size: 0.84,
      omega,
      dropRadius: R,
      seed: this.z * 31 + 7,
    });
    this.root.add(this.view.group);
    this.curve.setNucleus(this.a, this.z, `${e.symbol}-${this.a}`);

    const rho = NUC.matterDensity(this.a);
    this.facts = {
      terms: NUC.bindingTerms(this.z, this.a),
      radiusFm: NUC.nuclearRadius(this.a) * 1e15,
      rho,
      peak: NUC.bindingPeak(),
      gain: NUC.fusionGain(this.z, this.a),
      fission: NUC.fissionQ(this.z, this.a),
      decay: NUC.decayMode(this.z, this.a),
      defect: NUC.massDefect(this.z, this.a),
      betaPercent: (NUC.fermiSpeed(this.a) / 2.99792458e8) * 100,
      fermiMeV: NUC.fermiEnergyMeV(this.a),
      chem: NUC.nuclearOverChemical(this.z, this.a),
      // A teaspoon is five millilitres.
      spoon: (rho * 5e-6) / 1e9,
    };

    // A nucleon goes round in about half a zeptosecond, so a second of wall
    // clock is set to a couple of turns of it.
    this.timeScale = (2 * Math.PI) / omega * 1.6;

    const c = this.env.controls;
    c.snapTo(new THREE.Vector3(0, 0, 0), R * 4.2, 0.8, 1.15);
    c.drift = 0.02;
    c.minDistance = R * 1.05;
    c.maxDistance = R * 40;
    const cam = this.env.engine.camera;
    cam.near = R * 0.02; cam.far = R * 400;
    cam.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.simTime += dt * this.timeScale;
    this.view.setTime(this.simTime);
    this.curve.draw();
  }

  override overlay(): HTMLElement | null { return this.curve.el; }

  rows(): Row[] {
    const f = this.facts;
    const t = f.terms, rho = f.rho, peak = f.peak, gain = f.gain, fis = f.fission;
    const spoon = f.spoon;
    return [
      {
        k: 'nucleus',
        v: `${this.element.symbol}-${this.a} · ${this.z}p ${this.a - this.z}n`,
        accent: true,
      },
      { k: 'radius', v: f.radiusFm.toFixed(2), u: 'fm' },
      {
        k: 'density',
        v: `${sig(rho, 3)} kg/m³ · ${sig(rho / 1000, 2)}× water`,
        accent: true,
      },
      {
        k: 'a teaspoon',
        v: spoon > 1000
          ? `weighs ${sig(spoon / 1000, 2)} trillion tonnes`
          : `weighs ${sig(spoon, 2)} billion tonnes`,
      },
      { k: 'and it is', v: 'exactly what a neutron star is made of' },
      {
        k: 'binding',
        v: `${t.perNucleon.toFixed(2)} MeV per nucleon`,
        accent: true,
      },
      {
        k: 'holding it',
        // The tug of war, in one line. Volume against surface and Coulomb.
        v: `+${t.volume.toFixed(0)} strong, ${t.surface.toFixed(0)} surface, ${
          t.coulomb.toFixed(0)} charge`,
      },
      { k: 'asymmetry', v: `${t.asymmetry.toFixed(1)} MeV, and pairing ${
        t.pairing >= 0 ? '+' : ''}${t.pairing.toFixed(1)}` },
      { k: 'mass defect', v: `${(f.defect * 100).toFixed(2)}% lighter than its parts` },
      {
        k: 'the iron peak',
        v: `${peak.perNucleon.toFixed(2)} MeV at A = ${peak.a}`,
        accent: true,
      },
      {
        k: 'fusing this',
        v: this.z === 1 && this.a === 1
          // The most consequential negative number in the sky. Two protons do
          // not stick: helium-2 is unbound, so the first step of the chain
          // needs one of them to turn into a neutron by the weak force while
          // they are briefly touching. That almost never happens, which is why
          // the sun takes ten billion years over what it could do in minutes.
          ? 'two protons do not stick — one has to become a neutron first'
          : gain > 0
            ? `gives ${(gain * 1000).toFixed(0)} keV per nucleon`
            : `costs ${(-gain * 1000).toFixed(0)} keV per nucleon`,
        accent: true,
      },
      ...(this.a > 1 ? [{
        k: 'splitting it',
        v: fis > 0 ? `gives ${fis.toFixed(0)} MeV` : `costs ${(-fis).toFixed(0)} MeV`,
      }] : []),
      { k: 'it would', v: f.decay },
      {
        k: 'nucleons move at',
        v: `${f.betaPercent.toFixed(0)}% of light speed`,
      },
      {
        k: 'with no heat',
        v: `${f.fermiMeV.toFixed(0)} MeV of it, at absolute zero`,
      },
      ...(t.total > 0 ? [{
        k: 'against chemistry',
        v: `${sig(f.chem, 2)}× a chemical bond`,
      }] : []),
      { k: 'made in', v: this.element.origin },
      ...(NUC.tooSmallForTheFormula(this.a) ? [{
        k: 'though',
        // Honest about where the model stops. A drop needs an inside, and
        // below a dozen nucleons there is not one.
        v: this.a < 2
          ? 'one nucleon is not a drop: there is nothing here to hold together'
          : 'too small for a liquid drop - this is all surface, and shell '
            + 'structure the formula ignores is most of the answer',
        accent: true,
      }] : []),
    ];
  }

  scaleLabel(): string {
    const d = this.env.controls.distance;
    return `${d.toFixed(d < 10 ? 2 : 1)} fm`;
  }

  child(): Target | null { return null; }

  override dispose(): void { this.view.dispose(); super.dispose(); }
}

export function describePlanet(p: Planet, _system: string, star?: Star): Inspection {
  const rows: Row[] = [
    { k: 'orbit', v: p.au.toFixed(3), u: 'AU' },
    { k: 'period', v: formatTime(p.periodS).join(' ') },
    { k: 'mass', v: p.massKg > 30 * M_EARTH
      ? `${(p.massKg / M_JUPITER).toFixed(2)} M♃` : `${(p.massKg / M_EARTH).toFixed(3)} M⊕` },
    { k: 'radius', v: (p.radiusM / R_EARTH).toFixed(2), u: 'R⊕' },
    { k: 'density', v: (p.density / 1000).toFixed(2), u: 'g/cm³' },
    { k: 'gravity', v: (p.gravity / 9.80665).toFixed(2), u: 'g' },
    { k: 'surface', v: `${p.surfaceK.toFixed(0)}`, u: 'K' },
    { k: 'atmosphere', v: p.pressureBar < 1e-3 ? 'none' : `${sig(p.pressureBar, 2)} bar ${p.atmosphere}` },
  ];
  if (p.oceanFraction > 0.01) rows.push({ k: 'liquid', v: `${(p.oceanFraction * 100).toFixed(0)}`, u: '% cover' });
  if (p.moons.length) rows.push({ k: 'moons', v: p.moons.length.toString() });
  if (p.rings.length) rows.push({ k: 'rings', v: `${(p.rings[0].iceFraction * 100).toFixed(0)}% ice` });
  if (p.elements.e > 0.05) rows.push({ k: 'eccentricity', v: p.elements.e.toFixed(3) });

  let note: string | undefined;
  if (p.habitable) {
    note = p.biosphere > 0.5
      ? 'Liquid water, a breathable pressure, and a biosphere old enough to have changed the atmosphere.'
      : 'Liquid water on the surface, inside the conservative habitable zone.';
  } else if (p.cls === 'lava') {
    note = 'Close enough that the surface never solidifies. The glow is the rock itself.';
  } else if (p.tidallyLocked) {
    note = 'Tidally locked: one hemisphere in permanent day, the other in permanent night.';
  } else if (p.pressureBar > 30) {
    note = 'A hydrogen envelope thick enough that there is no surface to stand on.';
  }

  // What could actually be measured about it, from four light years away.
  let detection: DetectionPlotOptions | undefined;
  if (star) {
    const rs = star.radiusRsun * R_SUN;
    const ms = star.currentMassMsun * M_SUN;
    const d = detectability(p.radiusM, p.massKg, p.elements.a, rs, ms);
    rows.push({ k: 'found by', v: d.method });
    detection = {
      planetRadiusM: p.radiusM, planetMassKg: p.massKg,
      starRadiusM: rs, starMassKg: ms,
      aM: p.elements.a, periodS: p.periodS, e: p.elements.e,
      rvAmplitude: d.rvAmplitude, depthPpm: d.depthPpm, probability: d.probability,
    };
  }

  return {
    title: p.name,
    kind: CLASS_LABEL[p.cls],
    swatch: `rgb(${p.color.map((c) => Math.round(Math.min(1, c) * 255)).join(',')})`,
    rows,
    note,
    detection,
  };
}

export function makeStage(id: ScaleId, env: StageEnv, ctx: StageCtx): Stage {
  switch (id) {
    case 'cosmos': return new CosmosStage(env, ctx);
    case 'cluster': return new ClusterStage(env, ctx);
    case 'galaxy': return new GalaxyStage(env, ctx);
    case 'system': return new SystemStage(env, ctx);
    case 'world': return new WorldStage(env, ctx);
    case 'surface': return new SurfaceStage(env, ctx);
    case 'matter': return new MatterStage(env, ctx);
    case 'atom': return new AtomStage(env, ctx);
    case 'nucleus': return new NucleusStage(env, ctx);
  }
}

export { Engine, Controls, Universe, DAY, MYR, M_SUN };
