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
import { StrainTrace } from '../ui/strain';
import { HRDiagram } from '../ui/hrdiagram';
import { ChirpAudio } from '../ui/chirpaudio';
import {
  chirpMass, finalMass, finalSpin, radiatedFraction, peakLuminosity,
  PLANCK_LUMINOSITY,
} from '../physics/gwaves';
import { peakMultipoles } from '../cosmology/cmb';
import { GalaxySprites, type GalaxySpriteData } from '../render/galaxysprites';
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
import { AU, GYR, MPC, M_EARTH, M_JUPITER, MYR, R_EARTH, R_SUN, YEAR, DAY, G, M_SUN, LY } from '../core/constants';
import { sig, commas, formatDistance, formatTime } from '../ui/hud';

export type ScaleId = 'cosmos' | 'cluster' | 'galaxy' | 'system' | 'world';

export const SCALE_ORDER: ScaleId[] = ['cosmos', 'cluster', 'galaxy', 'system', 'world'];

export interface StageCtx {
  cluster?: number;
  member?: number;
  star?: number;
  planet?: number;
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
  private cmb?: CmbView;
  /** 0 off, 1 as observed with the dipole, 2 with the dipole removed. */
  private cmbMode: 0 | 1 | 2 = 0;

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
    const c = this.env.controls;
    c.snapTo(new THREE.Vector3(box / 2, box / 2, box / 2), box * 0.42, 0.7, 1.15);
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
    if (this.cmbMode > 0 && this.cmb) {
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
      brightness: this.brightness * (cell / depth) * (this.cmbMode > 0 ? 0.75 : 1),
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

  build(): void {
    const u = this.env.universe;
    const ci = this.ctx.cluster ?? 0;
    const cl = u.cluster(ci);
    this.title = cl.name;
    this.subtitle =
      `${commas(cl.richness)} galaxies · σ ${Math.round(cl.sigmaKms)} km/s · ` +
      `${sig(cl.massMsun, 2)} M☉ of which ~85% is dark matter`;

    // The sky behind a cluster is not a starfield - it is the distant
    // universe, and the cluster bends its light.
    this.sky = new LensedField({ seed: cl.seed, brightness: 0.55, density: 1 });
    this.sky.mesh.scale.setScalar(cl.radiusMpc * 400);
    this.sky.setShape(0.62 + (cl.seed % 100) / 400, ((cl.seed % 628) / 100));
    this.root.add(this.sky.mesh);

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
    }
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

    const c = this.env.controls;
    c.snapTo(new THREE.Vector3(), cl.radiusMpc * 2.1, 0.5, 1.05);
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

  override dispose(): void { this.sky.dispose(); this.sprites.dispose(); super.dispose(); }

  update(dt: number): void {
    this.simTime += dt * this.timeScale;
    const cam = this.env.engine.camera.position;
    this.sky.mesh.position.copy(cam);
    const cl = this.env.universe.cluster(this.ctx.cluster ?? 0);
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
    return [
      { k: 'cluster mass', v: sig(cl.massMsun, 3), u: 'M☉', accent: true },
      { k: 'virial radius', v: cl.radiusMpc.toFixed(2), u: 'Mpc' },
      { k: 'dispersion', v: Math.round(cl.sigmaKms).toString(), u: 'km/s' },
      { k: 'ICM temp', v: cl.icmKeV.toFixed(2), u: 'keV' },
      { k: 'galaxies', v: commas(cl.richness) },
      // R / sigma, with 1 Mpc/(km/s) = 978 Gyr
      { k: 'crossing time', v: ((cl.radiusMpc / cl.sigmaKms) * 977.8).toFixed(2), u: 'Gyr' },
      { k: 'field of view', v: dv, u: du },
    ];
  }

  scaleLabel(): string {
    const [v, u] = formatDistance(this.env.controls.distance * MPC);
    return `${v} ${u}`;
  }

  override inspect(ndc: THREE.Vector2): Inspection | null {
    const i = this.pickNearest(ndc, this.positions.map((pos, index) => ({
      pos, radius: this.radii[index], index,
    })), 0.02);
    if (i === null) return null;
    const ci = this.ctx.cluster ?? 0;
    const g = this.env.universe.galaxy(ci, i);
    const m = this.env.universe.cluster(ci).members[i];
    return {
      title: g.name,
      kind: `${g.type} galaxy`,
      rows: [
        { k: 'stellar mass', v: sig(g.stellarMassMsun, 3), u: 'M☉' },
        { k: 'halo mass', v: sig(m.haloMassMsun, 3), u: 'M☉' },
        { k: 'radius', v: g.radiusKpc.toFixed(1), u: 'kpc' },
        { k: 'v(max)', v: Math.round(g.vMaxKms).toString(), u: 'km/s' },
        { k: 'star formation', v: g.sfrMsunYr.toFixed(2), u: 'M☉/yr' },
        { k: 'central BH', v: sig(g.blackHoleMsun, 2), u: 'M☉' },
        { k: 'metallicity', v: `${g.metallicity >= 0 ? '+' : ''}${g.metallicity.toFixed(2)}`, u: 'dex' },
        { k: 'peculiar v', v: `${m.vlos >= 0 ? '+' : ''}${Math.round(m.vlos)}`, u: 'km/s' },
      ],
      note: g.type === 'E'
        ? 'Red and dead: its gas was stripped by the cluster, and it has not formed a star in gigayears.'
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
      uniforms: { uOpacity: { value: 0.5 } },
      vertexShader: `precision highp float;
        uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix;
        in vec3 position; in vec3 aColor; out vec3 vC;
        void main() {
          vC = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(90.0 / max(-mv.z, 0.02), 1.5, 7.0);
        }`,
      fragmentShader: `precision highp float;
        in vec3 vC; out vec4 fragColor; uniform float uOpacity;
        void main() {
          vec2 d = gl_PointCoord * 2.0 - 1.0;
          float r = length(d);
          if (r > 1.0) discard;
          float ring = smoothstep(0.5, 0.75, r) * smoothstep(1.0, 0.8, r);
          fragColor = vec4(vC * ring * uOpacity, 1.0);
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

  private showGalaxy(on: boolean): void {
    this.view.group.visible = on;
    this.catalogPoints.visible = on;
    for (const n of this.nebulae) n.mesh.visible = on;
    if (this.bh) this.bh.mesh.visible = on;
    if (this.snCloud) this.snCloud.points.visible = on;
  }

  override overlay(): HTMLElement | null {
    if (this.strain) return this.strain.el;
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
    if (!this.chirp) return 'unavailable';
    if (this.chirp.on) { this.chirp.stop(); return 'off'; }
    return this.chirp.start() ? 'on' : 'unavailable';
  }

  /** Ring the star being inspected on the diagram, if it is open. */
  markOnHR(s: Star | null): void { this.hr?.mark(s); }

  update(dt: number): void {
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
    if (this.merger) {
      return `${(this.env.controls.distance * this.merger.rgM / 1e3).toFixed(0)} km`;
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
        const s = (p.habitable ? 10 : 0) + (p.rings.length ? 3 : 0) + p.moons.length * 0.2
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
  private planetRadius = 1;
  private aurora?: AuroraView;
  /** Magnetopause standoff in planetary radii, and auroral power vs Earth. */
  private standoff = 1;
  private auroraPower = 0;
  /** Fraction of the star's light reaching the sub-solar point, 0 to 1. */
  private eclipseDepth = 1;

  build(): void {
    const u = this.env.universe;
    const g = u.galaxy(this.ctx.cluster ?? 0, this.ctx.member ?? 0);
    const { system, seed } = this.ctx.real
      ? { system: solarSystem(), seed: 0x50143 }
      : u.system(g, this.ctx.star ?? 0);
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
    const u = this.env.universe;
    const g = u.galaxy(this.ctx.cluster ?? 0, this.ctx.member ?? 0);
    const sys = this.ctx.real ? solarSystem() : u.system(g, this.ctx.star ?? 0).system;
    return describePlanet(this.planet, this.title, sys.star);
  }

  child(): Target | null { return null; }

  override dispose(): void {
    this.view.dispose(); this.starView.dispose(); this.sky.dispose(); super.dispose();
  }
}

// ---------------------------------------------------------------------------

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
  }
}

export { Engine, Controls, Universe, DAY, MYR, M_SUN };
