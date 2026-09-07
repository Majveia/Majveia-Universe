/**
 * A star being taken apart.
 *
 * Nothing about the shape of this is drawn. Every one of the ten thousand
 * points is a piece of the star on its own Keplerian orbit, and the only thing
 * that distinguishes one from another is where in the star it came from: the
 * near side got a little extra energy from being deeper in the hole's
 * potential, the far side lost a little, and once the star's own gravity has
 * let go that difference is the entire remaining history of the object.
 *
 * What comes out of that one difference:
 *
 *  - **A stream.** Pieces with nearly the same energy have nearly the same
 *    period, so the debris shears out along its orbit into a long thin ribbon
 *    rather than staying a cloud. This is why a disrupted star looks like a
 *    line and not like an explosion.
 *  - **Half of it leaves.** The energies straddle zero, so half the points are
 *    on ellipses and half on hyperbolas, and the hyperbolic half runs off the
 *    screen at thousands of kilometres a second and never comes back.
 *  - **The rest returns, most-bound first.** The tightest orbit has the
 *    shortest period, so the debris comes back in order of how tightly it was
 *    held - and because a flat spread of energies becomes a power law in period
 *    through Kepler's third law, it returns as t^(-5/3). The light curve is not
 *    imposed on this picture; it is what the picture is doing.
 *
 * Before the disruption the star is drawn on its actual incoming orbit, which
 * is very nearly a parabola - it fell in from far away - and solved exactly
 * with Barker's equation rather than approximated.
 *
 * Scene units are astronomical units, because the tidal radius of a Sun around
 * a million-solar-mass hole is two-thirds of one, and the returning stream
 * reaches a few hundred.
 */

import * as THREE from 'three';
import { PointCloud } from './pointcloud';
import { stateAt, parabolicState, type OrbitalElements } from '../physics/kepler';
import {
  debrisOrbit, tidalRadius, fallbackTime, flareLuminosity, flareTemperature,
  eddingtonLuminosity, energySpread, type Disruption,
} from '../astro/tidal';
import { blackbodyRGB } from '../astro/blackbody';
import { G, AU, DAY } from '../core/constants';

interface Piece {
  el: OrbitalElements;
  /** Where in the star it came from, -1 near side to +1 far. */
  frac: number;
  /** When it first returns to pericentre, seconds; Infinity if never. */
  returnS: number;
}

export interface TDEViewOptions {
  disruption: Disruption;
  /** How many pieces to follow. */
  count?: number;
  seed?: number;
}

const GLOW_VERT = /* glsl */ `
out vec3 vObj;
void main() {
  vObj = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * The flare, as a volume.
 *
 * It has to be. The thing that radiates a tidal disruption is tens of
 * astronomical units across - larger than the returning stream and thousands of
 * times the horizon - so any camera close enough to see the stream is *inside*
 * it, and a surface drawn at that radius would be behind the viewer. Marching
 * through it instead is correct from everywhere, and gets the limb darkening of
 * a centrally concentrated cloud for nothing.
 */
const GLOW_FRAG = /* glsl */ `
precision highp float;
in vec3 vObj;
out vec4 fragColor;

uniform vec3 uCamLocal;
uniform float uGain;
uniform vec3 uColor;
uniform float uRadius;
uniform float uOuter;

const int STEPS = 24;

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

void main() {
  vec3 o = uCamLocal;
  vec3 d = normalize(vObj - uCamLocal);
  float t0, t1;
  if (!hitSphere(o, d, uOuter, t0, t1)) discard;
  float tn = max(t0, 0.0);
  if (t1 <= tn) discard;
  float ds = (t1 - tn) / float(STEPS);
  float j = ign(gl_FragCoord.xy);
  float acc = 0.0;
  for (int i = 0; i < STEPS; i++) {
    float r = length(o + d * (tn + (float(i) + j) * ds)) / max(uRadius, 1e-6);
    acc += exp(-r * r * 1.6);
  }
  acc *= (ds / uRadius) * uGain;
  if (acc < 1e-5) discard;
  vec3 col = uColor * (acc / (1.0 + acc * 0.7));
  fragColor = vec4(col, 1.0);
}
`;

export class TDEView {
  readonly group = new THREE.Group();
  private cloud: PointCloud;
  private pieces: Piece[] = [];
  private star: THREE.Mesh;
  private glow: THREE.Mesh;
  private glowMat: THREE.ShaderMaterial;
  private d: Disruption;
  private mu: number;
  private q: number;
  private tmin: number;
  private starAu = 1;
  private rtAu: number;
  private state = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  /** Luminosity this frame, watts, and the fraction of the star returned. */
  luminosity = 0;
  returnedFraction = 0;
  /** How far the drawn debris reaches, AU - for framing. */
  reachAu = 1;

  constructor(opts: TDEViewOptions) {
    this.d = opts.disruption;
    const n = opts.count ?? 9000;
    this.mu = G * this.d.holeKg;
    const rt = tidalRadius(this.d.holeKg, this.d.starKg, this.d.starR);
    this.rtAu = rt / AU;
    this.q = rt / Math.max(this.d.beta, 0.05);
    this.tmin = fallbackTime(this.d.holeKg, this.d.starKg, this.d.starR);

    const colors = new Float32Array(n * 3);
    const style = new Float32Array(n * 2);
    this.cloud = new PointCloud(n, colors, style);

    // The star is a sphere, so the pieces are not spread evenly in energy from
    // end to end: there is more of it near the middle. Sampling the chord
    // through a sphere gets the density right, and the density is what the
    // light curve is made of.
    // A star is a ball, not a rod. Its extent *across* the orbit is the same
    // stellar radius as its extent along it, so the debris also comes away with
    // a spread in angular momentum - a slightly different orbital plane and a
    // slightly different pericentre direction, both of order the angle the star
    // subtends at closest approach. That is what gives the stream a thickness,
    // and without it the debris is a mathematical line.
    const spread = Math.min(0.3, this.d.starR / this.q);
    let h = (opts.seed ?? 1) >>> 0;
    const rnd = () => {
      h = (h * 1664525 + 1013904223) >>> 0;
      return h / 4294967296 - 0.5;
    };
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const frac = 2 * u - 1;
      const o = debrisOrbit(this.d, frac);
      this.pieces.push({
        el: {
          a: o.a, e: o.e,
          i: rnd() * spread, Omega: rnd() * spread * 2, omega: rnd() * spread,
          // Every piece leaves from the same place at the same moment, so they
          // all share a pericentre passage at t = 0.
          M0: 0, epoch: 0,
        },
        frac,
        returnS: o.boundS,
      });
      // aStyle is (size, brightness); both are rewritten each frame from
      // where the piece is and what is happening to it.
      style[i * 2] = 1;
      style[i * 2 + 1] = 1;
    }
    this.cloud.touchAppearance();
    this.cloud.setSize(1.5);
    this.cloud.setBrightness(0.5);
    this.group.add(this.cloud.points);

    // How far the picture has to reach is not the pericentre but the apocentre
    // of the most tightly bound debris, which is where the returning arm turns
    // around: mu over the energy spread. For a Sun and a million solar masses
    // that is about forty-five astronomical units, seventy times the tidal
    // radius, and framing on the tidal radius shows only the escaping half.
    this.reachAu = this.mu / energySpread(this.d.holeKg, this.d.starKg, this.d.starR) / AU;

    // The star, before it stops being one.
    this.star = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.93, 0.72) }),
    );
    // Drawn at least a hundredth of the frame across, because at true scale a
    // star two light-minutes wide against a returning arm two light-years long
    // is a fraction of a pixel, and something has to be visible for the moment
    // it comes apart to be a moment at all.
    this.starAu = Math.max(this.d.starR / AU, this.frameAu * 0.014);
    this.star.scale.setScalar(this.starAu);
    this.group.add(this.star);

    // The flare. Drawn at the size a blackbody fit to a real one gives, which
    // is thousands of times the horizon and nobody is sure why.
    this.glowMat = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      glslVersion: THREE.GLSL3,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.BackSide,
      uniforms: {
        uCamLocal: { value: new THREE.Vector3(0, 0, 1) },
        uGain: { value: 0 },
        uColor: { value: new THREE.Vector3(0.6, 0.75, 1.0) },
        uRadius: { value: 1 },
        uOuter: { value: 1 },
      },
    });
    // Drawn at the circularisation radius - twice the pericentre - which is
    // where the returning stream runs into itself and the energy is actually
    // released.
    //
    // That is deliberately *not* the radius a blackbody fit to a real flare
    // gives, which is tens of astronomical units: larger than the returning
    // stream, thousands of times the horizon, and big enough that any camera
    // close enough to see the stream would be inside it and see nothing but
    // fog. Both numbers are real and they disagree, which is the unsolved part
    // of the subject - so the picture shows where the energy comes out and the
    // readout says how big the thing that radiates it appears to be.
    const glowAu = (2 * this.q) / AU;
    this.glow = new THREE.Mesh(new THREE.SphereGeometry(glowAu * 4, 32, 20), this.glowMat);
    this.glowMat.uniforms.uRadius.value = glowAu;
    this.glowMat.uniforms.uOuter.value = glowAu * 4;
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 4;
    this.group.add(this.glow);

  }

  /** Seconds from the disruption at which the first debris comes back. */
  get firstReturnS(): number { return this.tmin; }

  /**
   * Where to put the camera, AU.
   *
   * The event has two lengths and they are not close together: the pericentre,
   * where everything happens, and the apocentre of the most bound debris, which
   * for a giant disrupted by a large hole is two light years. Framing on either
   * one loses the other, so this is the geometric mean of them - the only
   * choice that treats a factor of ten thousand symmetrically.
   */
  get frameAu(): number {
    const inner = (10 * this.q) / AU;
    return Math.sqrt(Math.max(inner, 1e-9) * this.reachAu);
  }

  /**
   * The two clocks.
   *
   * A star crosses its own tidal radius in about a day and the first debris
   * comes back a thousand years later, so one rate cannot show both. Negative
   * progress runs on the time it takes to fall past the hole; positive
   * progress runs on the time it takes the debris to return. The readout says
   * which, in days, throughout.
   *
   * @param u  -1 at the start of the approach, 0 at closest approach
   */
  timeFor(u: number): number {
    if (u >= 0) return u * this.tmin;
    const approach = 9 * Math.sqrt((this.q * this.q * this.q) / this.mu);
    return Math.max(u, -1) * approach;
  }

  /**
   * Advance to a time relative to the disruption, in seconds. Negative is the
   * approach.
   */
  update(tS: number, camera?: THREE.Camera): void {
    if (camera) {
      camera.getWorldPosition(this.glowMat.uniforms.uCamLocal.value as THREE.Vector3)
        .sub(this.group.position);
    }
    const pos = this.cloud.positions;
    const col = this.cloud.colors;
    const sty = this.cloud.style;

    if (tS < 0) {
      // Still a star, on the parabola it fell in on.
      const p = parabolicState(this.q, this.mu, tS);
      this.star.visible = true;
      this.star.position.set(p.x / AU, 0, p.y / AU);
      // Inside the tidal radius the star is already losing. The difference in
      // the hole's pull across it stretches it along the line to the hole and
      // squeezes it across, and by the time it reaches closest approach it is
      // not a star any more but a ribbon.
      const rAu = Math.max(p.r / AU, 1e-9);
      const pull = Math.min(6, Math.max(1, Math.pow(this.rtAu / rAu, 1.6)));
      this.star.scale.set(
        this.starAu * pull, this.starAu / Math.sqrt(pull), this.starAu / Math.sqrt(pull),
      );
      // A rotation about y puts the long axis along the line to the hole.
      this.star.rotation.set(0, -Math.atan2(p.y, p.x), 0);
      this.cloud.setCount(0);
      this.glowMat.uniforms.uGain.value = 0;
      this.luminosity = 0;
      this.returnedFraction = 0;
      return;
    }
    this.star.visible = false;

    let far = 0;
    let n = 0;
    let back = 0;
    for (let i = 0; i < this.pieces.length; i++) {
      const p = this.pieces[i];
      // A piece that has been back round once is counted as having returned -
      // that is what feeds the flare - but it is still drawn, because it is
      // still there. Circularising a stream into a disc takes several orbits,
      // not one, and deleting the debris at first pericentre would remove the
      // returning arm exactly as it swings into view, which is the whole thing
      // worth watching.
      const returned = tS > p.returnS;
      if (returned) back++;
      stateAt(p.el, this.mu, tS, this.state);
      const x = this.state.x / AU, y = this.state.z / AU, z = this.state.y / AU;
      const r = Math.hypot(x, y, z);
      if (!Number.isFinite(r) || r > this.reachAu * 12) continue;
      pos[n * 3] = x; pos[n * 3 + 1] = y; pos[n * 3 + 2] = z;
      // Colour by fate, not by taste: what is coming back is being compressed
      // and shocked and glows hot; what is leaving is cooling as it expands.
      const bound = p.frac < 0;
      const near = Math.min(1, ((this.q / AU) * 6) / Math.max(r, 1e-6));
      const heat = bound ? 0.35 + 0.65 * near : 0.2 * near;
      col[n * 3] = 0.55 + 0.45 * heat;
      col[n * 3 + 1] = 0.42 + 0.42 * heat;
      col[n * 3 + 2] = 0.38 + 0.55 * (bound ? heat * 0.6 : 0.8);
      sty[n * 2] = 0.8 + 1.6 * heat;
      sty[n * 2 + 1] = (0.35 + 0.65 * heat) * (returned ? 0.4 : 1);
      if (r > far) far = r;
      n++;
    }
    this.cloud.setPositions(n);
    this.cloud.touchAppearance();

    this.luminosity = flareLuminosity(this.d, tS);
    this.returnedFraction = back / this.pieces.length;
    // Exposed against the Eddington limit rather than against a peak, so that
    // a bigger hole's flare is visibly the brighter one.
    const rel = this.luminosity / eddingtonLuminosity(this.d.holeKg);
    this.glowMat.uniforms.uGain.value = Math.min(1.1, Math.max(0, rel * 0.20));
    const t = flareTemperature(this.d, tS);
    if (t > 0) {
      const c = blackbodyRGB(t);
      (this.glowMat.uniforms.uColor.value as THREE.Vector3).set(c[0], c[1], c[2]);
    }
  }

  /** How much of the drawn debris is still on its way out, for the readout. */
  get pieceCount(): number { return this.pieces.length; }

  dispose(): void {
    this.cloud.points.geometry.dispose();
    (this.cloud.points.material as THREE.Material).dispose();
    this.star.geometry.dispose();
    (this.star.material as THREE.Material).dispose();
    this.glow.geometry.dispose();
    this.glowMat.dispose();
  }
}

export { DAY };
