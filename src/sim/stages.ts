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
import { GalaxySprites, type GalaxySpriteData } from '../render/galaxysprites';
import { GalaxyView } from '../render/galaxyview';
import { SystemView } from '../render/systemview';
import { PlanetView } from '../render/planet';
import { StarView } from '../render/star';
import { SkyDome } from '../render/skydome';
import { NebulaView } from '../render/nebula';
import { BlackHoleView } from '../render/blackhole';
import { buildGalaxy, angularRate, rotationCurve, type GalaxyParams } from '../galaxy/generator';
import { starLabel } from '../astro/stellar';
import { CLASS_LABEL, type Planet } from '../astro/planets';
import { blackbodyRGB } from '../astro/blackbody';
import { RNG, hash3 } from '../core/rng';
import { AU, GYR, MPC, M_EARTH, M_JUPITER, MYR, R_EARTH, R_SUN, YEAR, DAY, G, M_SUN } from '../core/constants';
import { sig, commas, formatDistance, formatTime } from '../ui/hud';

export type ScaleId = 'cosmos' | 'cluster' | 'galaxy' | 'system' | 'world';

export const SCALE_ORDER: ScaleId[] = ['cosmos', 'cluster', 'galaxy', 'system', 'world'];

export interface StageCtx {
  cluster?: number;
  member?: number;
  star?: number;
  planet?: number;
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
}

export abstract class Stage {
  readonly root = new THREE.Group();
  abstract readonly id: ScaleId;
  abstract readonly title: string;
  abstract readonly subtitle: string;
  /** Seconds of simulated time per second of wall clock. */
  timeScale = 1;
  simTime = 0;

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
    const knots = field.knots.slice(0, 500);
    this.nodeCount = knots.length;
    const pos = new Float32Array(knots.length * 3);
    const col = new Float32Array(knots.length * 3);
    const size = new Float32Array(knots.length);
    for (let i = 0; i < knots.length; i++) {
      const k = knots[i];
      pos[i * 3] = k.x; pos[i * 3 + 1] = k.y; pos[i * 3 + 2] = k.z;
      const hot = Math.min(1, Math.log10(k.massMsun / 1e13) * 0.5 + 0.5);
      col[i * 3] = 1; col[i * 3 + 1] = 0.86 - hot * 0.1; col[i * 3 + 2] = 0.62 + hot * 0.3;
      size[i] = 2 + hot * 4;
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

  update(dt: number): void {
    void dt;
    const a = this.env.epoch();
    const D = growthFactor(this.env.cosmology, a);
    const field = this.env.universe.field;
    this.web.setGrowth(D);
    this.web.setCamera(this.env.engine.camera.position);

    // Bounded sightline with exposure scaled by cell/depth: constant column
    // density per pixel from inside a void to outside the box.
    const cell = field.boxMpc / field.n;
    const depth = Math.max(cell * 8, Math.min(field.boxMpc * 1.6, this.env.controls.distance * 1.45));
    this.web.setLook({
      nearFade: depth * 0.16,
      fadeStart: depth * 0.30,
      fadeEnd: depth,
      brightness: this.brightness * (cell / depth),
      velocityTint: this.velocityTint ? 1 : 0,
      velocityFactor: this.velocityTint ? peculiarVelocityFactor(this.env.cosmology, a) : 0,
    });

    // Haloes only exist once they have collapsed, so markers fade in with time.
    (this.markers.material as THREE.RawShaderMaterial).uniforms.uOpacity.value =
      0.6 * Math.min(1, Math.max(0, (D - 0.25) / 0.5));
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
      { k: 'field of view', v: dv, u: du },
      { k: 'particles', v: commas(this.web.drawnParticles) },
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
  private sky!: SkyDome;

  build(): void {
    const u = this.env.universe;
    const ci = this.ctx.cluster ?? 0;
    const cl = u.cluster(ci);
    this.title = cl.name;
    this.subtitle =
      `${commas(cl.richness)} galaxies · σ ${Math.round(cl.sigmaKms)} km/s · ` +
      `${sig(cl.massMsun, 2)} M☉ of which ~85% is dark matter`;

    this.sky = new SkyDome({ brightness: 0.35, bandStrength: 0.004, seed: cl.seed, nebula: 0 });
    this.sky.mesh.scale.setScalar(cl.radiusMpc * 400);
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

  update(dt: number): void {
    this.simTime += dt * this.timeScale;
    this.sky.mesh.position.copy(this.env.engine.camera.position);
  }

  rows(): Row[] {
    const cl = this.env.universe.cluster(this.ctx.cluster ?? 0);
    const [dv, du] = formatDistance(this.env.controls.distance * MPC);
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
      const cam = this.env.engine.camera.position;
      let best = 0, bestScore = -Infinity;
      for (let i = 0; i < this.positions.length; i++) {
        const g = this.env.universe.galaxy(ci, i);
        const d = this.positions[i].distanceTo(cam);
        const s = Math.log10(g.stellarMassMsun) - Math.log10(d + 0.01) * 1.5;
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

    const c = this.env.controls;
    c.snapTo(new THREE.Vector3(), g.radiusKpc * 2.4, 0.45, 0.78);
    c.minDistance = 1e-7;
    c.maxDistance = g.radiusKpc * 40;
    const cam = this.env.engine.camera;
    cam.near = 1e-5; cam.far = g.radiusKpc * 400;
    cam.updateProjectionMatrix();
  }

  update(dt: number): void {
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

    // The catalogue markers only help when you are close enough to aim at one.
    const d = this.env.controls.distance;
    (this.catalogPoints.material as THREE.RawShaderMaterial).uniforms.uOpacity.value =
      0.55 * Math.min(1, Math.max(0, (this.params.radiusKpc * 6 - d) / (this.params.radiusKpc * 4)));
  }

  rows(): Row[] {
    const g = this.params;
    const rSun = 2.2 * g.discScaleKpc;
    const [dv, du] = formatDistance(this.env.controls.distance * 3.0857e19);
    return [
      { k: 'type', v: g.type, accent: true },
      { k: 'stellar mass', v: sig(g.stellarMassMsun, 3), u: 'M☉' },
      { k: 'disc scale', v: g.discScaleKpc.toFixed(2), u: 'kpc' },
      { k: 'v(circular)', v: Math.round(rotationCurve(g, rSun)).toString(), u: 'km/s' },
      { k: 'rotation', v: Math.round(this.env.universe.orbitalPeriodMyr(g, rSun)).toString(), u: 'Myr' },
      { k: 'star formation', v: g.sfrMsunYr.toFixed(2), u: 'M☉/yr' },
      { k: 'central BH', v: sig(g.blackHoleMsun, 2), u: 'M☉' },
      { k: 'elapsed', v: (this.simTime).toFixed(0), u: 'Myr' },
      { k: 'field of view', v: dv, u: du },
    ];
  }

  scaleLabel(): string {
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
  /** Minimum apparent radius for bodies; 0 is strict true scale. */
  minAngular = 0.0045;

  build(): void {
    const u = this.env.universe;
    const g = u.galaxy(this.ctx.cluster ?? 0, this.ctx.member ?? 0);
    const si = this.ctx.star ?? 0;
    const { system, name, seed } = u.system(g, si);
    this.starName = name;
    this.title = name;
    const st = system.star;
    this.subtitle = `${starLabel(st)} · ${system.planets.length} planets · ` +
      `${st.massMsun.toFixed(2)} M☉ · ${sig(st.luminosityLsun, 2)} L☉`;
    // A year per second at the default warp.
    this.timeScale = YEAR;

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
    this.view.update(this.simTime, this.env.engine.camera);
    this.sky.mesh.position.copy(this.env.engine.camera.position);
  }

  get system() {
    const g = this.env.universe.galaxy(this.ctx.cluster ?? 0, this.ctx.member ?? 0);
    return this.env.universe.system(g, this.ctx.star ?? 0).system;
  }

  rows(): Row[] {
    const sys = this.system;
    const st = sys.star;
    const [dv, du] = formatDistance(this.env.controls.distance * AU);
    const [tv, tu] = formatTime(this.simTime);
    return [
      { k: 'star', v: starLabel(st), accent: true },
      { k: 'mass', v: st.massMsun.toFixed(3), u: 'M☉' },
      { k: 'luminosity', v: sig(st.luminosityLsun, 3), u: 'L☉' },
      { k: 'temperature', v: Math.round(st.teff).toString(), u: 'K' },
      { k: 'habitable zone', v: `${st.habitableZoneAu[0].toFixed(2)}–${st.habitableZoneAu[1].toFixed(2)}`, u: 'AU' },
      { k: 'snow line', v: sys.snowLineAu.toFixed(2), u: 'AU' },
      { k: 'planets', v: sys.planets.length.toString() },
      { k: 'body scale', v: this.minAngular === 0 ? 'true' : `×${sig(this.view.magnification, 2)}` },
      { k: 'elapsed', v: tv, u: tu },
      { k: 'field of view', v: dv, u: du },
    ];
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
    const i = this.pickNearest(ndc, this.planetPoints(), 0.03);
    if (i === null) return null;
    return describePlanet(this.view.slots[i].planet, this.starName);
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
  private moons: { mesh: THREE.Mesh; a: number; omega: number; phase: number; inc: number }[] = [];
  private sunDir = new THREE.Vector3(1, 0, 0);
  private sunColor = new THREE.Color(1, 1, 1);
  private starDist = 1;

  build(): void {
    const u = this.env.universe;
    const g = u.galaxy(this.ctx.cluster ?? 0, this.ctx.member ?? 0);
    const { system, seed } = u.system(g, this.ctx.star ?? 0);
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

    // Moons
    const rng = new RNG(p.surfaceSeed);
    for (const m of p.moons) {
      const r = Math.max(m.radiusM * scale, 0.004);
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(...m.color) });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12), mat);
      const mu = G * (p.massKg + m.massKg);
      this.moons.push({
        mesh,
        a: m.a * scale,
        omega: Math.sqrt(mu / (m.a ** 3)),
        phase: m.phase,
        inc: m.i,
      });
      this.root.add(mesh);
      void rng;
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
      m.mesh.position.set(
        m.a * Math.cos(th),
        m.a * Math.sin(th) * Math.sin(m.inc),
        m.a * Math.sin(th) * Math.cos(m.inc));
    }
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
      { k: 'elapsed', v: tv, u: tu },
      { k: 'altitude', v: dv, u: du },
    ];
  }

  scaleLabel(): string {
    const [v, u] = formatDistance((this.env.controls.distance - 1) * this.planet.radiusM);
    return `${v} ${u}`;
  }

  override inspect(): Inspection | null {
    return describePlanet(this.planet, this.title);
  }

  child(): Target | null { return null; }

  override dispose(): void {
    this.view.dispose(); this.starView.dispose(); this.sky.dispose(); super.dispose();
  }
}

// ---------------------------------------------------------------------------

export function describePlanet(p: Planet, _system: string): Inspection {
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

  return {
    title: p.name,
    kind: CLASS_LABEL[p.cls],
    swatch: `rgb(${p.color.map((c) => Math.round(Math.min(1, c) * 255)).join(',')})`,
    rows,
    note,
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
