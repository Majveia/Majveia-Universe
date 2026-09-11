/**
 * A crystal, drawn.
 *
 * Two things here are not decoration.
 *
 * **The atoms are spheres, not polygons.** Each one is a single flat quad with
 * a ray-sphere intersection done in the fragment shader, writing its own depth
 * - so it is exactly round at any magnification, it costs two triangles
 * instead of three hundred, and it intersects the bonds correctly because the
 * depth it writes is the depth of the sphere's surface. A thousand atoms at
 * twelve hundred triangles.
 *
 * **The motion is phonons, not jitter.** A crystal at temperature is not a set
 * of atoms independently vibrating - it is a set of standing and travelling
 * waves, and each atom is doing whatever the sum of the waves passing through
 * it says. So the displacement here is a superposition of plane waves with the
 * dispersion of a real acoustic branch, omega = omega_max sin(ka/2), which
 * flattens off at the zone boundary because a wave shorter than two atoms has
 * nothing left to wave.
 *
 * That is worth the trouble because of what it makes visible: those waves are
 * sound. A knock travelling through the rock and the heat sitting in it are
 * the same object, one organised and one not, and you can watch the
 * disorganised version go past.
 */

import * as THREE from 'three';

export interface LatticeAtom {
  /** Position in angstroms, already centred on the origin. */
  pos: [number, number, number];
  /** The size it really is, angstroms. */
  radius: number;
  /**
   * The size to draw it at in the diagram, angstroms.
   *
   * Not the same thing, and not a compromise. Ball-and-stick is a diagram of a
   * structure and the sizes in it are chosen so the structure is legible: at
   * true ionic radii the oxygen in quartz is three and a half times the
   * silicon, and the silicon vanishes into the gaps where you cannot see that
   * it is at the centre of a tetrahedron. Compressing the range keeps the
   * ordering - the big ion is still the big one - and lets the arrangement
   * show. Swelling to full size then reveals what was being hidden.
   */
  drawRadius: number;
  color: [number, number, number];
  /** Atomic mass, u - a light atom moves further for the same energy. */
  mass: number;
}

export interface LatticeOptions {
  atoms: LatticeAtom[];
  /** Index pairs to draw a stick between. */
  bonds: [number, number][];
  /** RMS thermal displacement, angstroms, for an atom of `refMass`. */
  amplitude: number;
  refMass: number;
  /** The lattice spacing in angstroms - the phonon zone boundary. */
  spacing: number;
  /** Highest angular frequency the lattice can carry, rad/s. */
  omegaMax: number;
  /** How far the fog reaches, angstroms. */
  fogRange: number;
  seed?: number;
}

const ATOM_VERT = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uFill;
in vec3 position;    // quad corner in [-1,1]
in vec3 aPos;
in vec2 aRad;    // the drawing radius, and the real one
in vec3 aColor;
out vec2 vUv;
out vec3 vColor;
out vec3 vCentre;
out float vRad;
void main() {
  vUv = position.xy;
  vColor = aColor;
  float r = mix(aRad.x, aRad.y, uFill);
  vRad = r;
  vec4 cv = modelViewMatrix * vec4(aPos, 1.0);
  vCentre = cv.xyz;
  // The quad has to cover the sphere's silhouette, which for a sphere seen in
  // perspective is very slightly larger than its radius. A few percent of slack
  // is cheaper than getting the exact cone right.
  cv.xy += position.xy * r * 1.08;
  gl_Position = projectionMatrix * cv;
}
`;

const ATOM_FRAG = /* glsl */ `
precision highp float;
uniform mat4 projectionMatrix;
uniform float uFog;
in vec2 vUv;
in vec3 vColor;
in vec3 vCentre;
in float vRad;
out vec4 fragColor;
void main() {
  // Where this pixel's ray meets the sphere, in the sphere's own units.
  vec2 p = vUv * 1.08;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  vec3 n = vec3(p, sqrt(1.0 - r2));
  vec3 view = vCentre + n * vRad;

  // Its own depth, so it intersects the sticks properly instead of sorting
  // against them as a flat card.
  vec4 clip = projectionMatrix * vec4(view, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);

  // A studio light, because there is no such thing as illumination down here -
  // this is a model of a structure, and it should read as one.
  vec3 L = normalize(vec3(0.42, 0.66, 0.62));
  vec3 V = normalize(-view);
  float diff = max(0.0, dot(n, L));
  float spec = pow(max(0.0, dot(reflect(-L, n), V)), 42.0);
  float rim = pow(1.0 - max(0.0, n.z), 3.0);
  vec3 col = vColor * (0.06 + 0.95 * diff) + vec3(0.85, 0.88, 0.95) * spec * 0.22
    + vColor * rim * 0.14;

  // Depth fog, so a lattice that repeats forever reads as having a far side.
  float f = exp(-max(0.0, -view.z) * uFog);
  fragColor = vec4(col * f, 1.0);
}
`;

const BOND_VERT = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
in vec3 position;    // unit cylinder along +y, from 0 to 1
in vec3 normal;
in vec3 aFrom;
in vec3 aTo;
in float aRad;
in vec3 aColor;
out vec3 vColor;
out vec3 vNormal;
out vec3 vView;
void main() {
  vec3 axis = aTo - aFrom;
  float len = length(axis);
  vec3 y = len > 1e-6 ? axis / len : vec3(0.0, 1.0, 0.0);
  vec3 ref = abs(y.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 x = normalize(cross(ref, y));
  vec3 z = cross(x, y);
  mat3 basis = mat3(x, y, z);
  vec3 local = vec3(position.x * aRad, position.y * len, position.z * aRad);
  vec4 cv = modelViewMatrix * vec4(aFrom + basis * local, 1.0);
  vColor = aColor;
  vNormal = normalize(mat3(modelViewMatrix) * (basis * normal));
  vView = cv.xyz;
  gl_Position = projectionMatrix * cv;
}
`;

const BOND_FRAG = /* glsl */ `
precision highp float;
uniform float uFog;
in vec3 vColor;
in vec3 vNormal;
in vec3 vView;
out vec4 fragColor;
void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 L = normalize(vec3(0.42, 0.66, 0.62));
  float diff = max(0.0, dot(n, L));
  vec3 col = vColor * (0.22 + 0.78 * diff);
  float f = exp(-max(0.0, -vView.z) * uFog);
  fragColor = vec4(col * f, 1.0);
}
`;

/** How many plane waves are superposed. Enough to look like weather, few
 *  enough that each one is still legible as a wave. */
const MODES = 7;

interface Mode {
  k: [number, number, number];
  pol: [number, number, number];
  omega: number;
  phase: number;
}

export class LatticeView {
  readonly group = new THREE.Group();
  private atomMat: THREE.RawShaderMaterial;
  private bondMat?: THREE.RawShaderMaterial;
  private atomGeo: THREE.InstancedBufferGeometry;
  private bondGeo?: THREE.InstancedBufferGeometry;
  private base: Float32Array;
  private live: Float32Array;
  private massScale: Float32Array;
  private bondFrom?: Float32Array;
  private bondTo?: Float32Array;
  private bonds: [number, number][];
  private modes: Mode[] = [];
  private amp: number;
  private o: LatticeOptions;

  constructor(o: LatticeOptions) {
    this.o = o;
    this.amp = o.amplitude;
    this.bonds = o.bonds;
    const n = o.atoms.length;
    this.base = new Float32Array(n * 3);
    this.live = new Float32Array(n * 3);
    this.massScale = new Float32Array(n);
    const rad = new Float32Array(n * 2);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = o.atoms[i];
      this.base.set(a.pos, i * 3);
      this.live.set(a.pos, i * 3);
      rad[i * 2] = a.drawRadius;
      rad[i * 2 + 1] = a.radius;
      col.set(a.color, i * 3);
      // For a given amount of energy in a mode, displacement goes as one over
      // the square root of the mass. The oxygen in quartz swings noticeably
      // further than the silicon it is bonded to, and it should look like it.
      this.massScale[i] = Math.sqrt(o.refMass / Math.max(0.1, a.mass));
    }

    this.buildModes(o.seed ?? 1);

    const quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0,
    ]), 3));
    const dyn = (arr: Float32Array, size: number): THREE.InstancedBufferAttribute => {
      const a = new THREE.InstancedBufferAttribute(arr, size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    quad.setAttribute('aPos', dyn(this.live, 3));
    quad.setAttribute('aRad', new THREE.InstancedBufferAttribute(rad, 2));
    quad.setAttribute('aColor', new THREE.InstancedBufferAttribute(col, 3));
    quad.instanceCount = n;
    this.atomGeo = quad;
    this.atomMat = new THREE.RawShaderMaterial({
      vertexShader: ATOM_VERT,
      fragmentShader: ATOM_FRAG,
      glslVersion: THREE.GLSL3,
      uniforms: {
        uFill: { value: 0 },
        uFog: { value: 1 / Math.max(1, o.fogRange) },
      },
    });
    const mesh = new THREE.Mesh(quad, this.atomMat);
    mesh.frustumCulled = false;
    this.group.add(mesh);

    if (o.bonds.length) {
      this.bondFrom = new Float32Array(o.bonds.length * 3);
      this.bondTo = new Float32Array(o.bonds.length * 3);
      const bcol = new Float32Array(o.bonds.length * 3);
      const brad = new Float32Array(o.bonds.length);
      for (let i = 0; i < o.bonds.length; i++) {
        const [a, b] = o.bonds[i];
        // Halfway between the two colours, which is honest enough about a bond
        // being shared and reads better than picking a side.
        for (let c = 0; c < 3; c++) {
          bcol[i * 3 + c] = (o.atoms[a].color[c] + o.atoms[b].color[c]) * 0.5;
        }
        brad[i] = Math.min(o.atoms[a].drawRadius, o.atoms[b].drawRadius) * 0.34;
      }
      const cyl = new THREE.CylinderGeometry(1, 1, 1, 9, 1, true);
      cyl.translate(0, 0.5, 0);
      const bg = new THREE.InstancedBufferGeometry();
      bg.setIndex(cyl.getIndex());
      bg.setAttribute('position', cyl.getAttribute('position'));
      bg.setAttribute('normal', cyl.getAttribute('normal'));
      bg.setAttribute('aFrom', dyn(this.bondFrom, 3));
      bg.setAttribute('aTo', dyn(this.bondTo, 3));
      bg.setAttribute('aRad', new THREE.InstancedBufferAttribute(brad, 1));
      bg.setAttribute('aColor', new THREE.InstancedBufferAttribute(bcol, 3));
      bg.instanceCount = o.bonds.length;
      this.bondGeo = bg;
      this.bondMat = new THREE.RawShaderMaterial({
        vertexShader: BOND_VERT,
        fragmentShader: BOND_FRAG,
        glslVersion: THREE.GLSL3,
        side: THREE.DoubleSide,
        uniforms: { uFog: { value: 1 / Math.max(1, o.fogRange) } },
      });
      const bmesh = new THREE.Mesh(bg, this.bondMat);
      bmesh.frustumCulled = false;
      this.group.add(bmesh);
    }
    this.setTime(0);
  }

  /**
   * Pick the waves.
   *
   * Wavevectors spread over the Brillouin zone, from a long wave that moves
   * whole regions together down to one at the zone boundary where neighbouring
   * atoms move in opposite directions. Amplitudes are equal, so the total
   * mean-square displacement comes to the Debye value: each cosine averages a
   * half, and there are as many of them as there are modes.
   */
  private buildModes(seed: number): void {
    let s = seed >>> 0 || 1;
    const rnd = (): number => {
      s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
    const kMax = Math.PI / this.o.spacing;
    this.modes = [];
    for (let i = 0; i < MODES; i++) {
      // Spread through the zone rather than clustered: the long waves carry the
      // look of the thing and the short ones carry the shimmer.
      const q = 0.14 + 0.86 * ((i + rnd() * 0.7) / MODES);
      const th = Math.acos(2 * rnd() - 1), ph = rnd() * 2 * Math.PI;
      const dir: [number, number, number] = [
        Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th),
      ];
      const th2 = Math.acos(2 * rnd() - 1), ph2 = rnd() * 2 * Math.PI;
      this.modes.push({
        k: [dir[0] * q * kMax, dir[1] * q * kMax, dir[2] * q * kMax],
        pol: [
          Math.sin(th2) * Math.cos(ph2), Math.sin(th2) * Math.sin(ph2), Math.cos(th2),
        ],
        // The acoustic branch. Linear at long wavelength - that is the speed of
        // sound - and flat at the zone boundary, where it runs out of lattice.
        omega: this.o.omegaMax * Math.sin((q * Math.PI) / 2),
        phase: rnd() * 2 * Math.PI,
      });
    }
  }

  /** Move everything to where the waves say it is at this instant, seconds. */
  setTime(t: number): void {
    const n = this.o.atoms.length;
    const a = this.amp * Math.sqrt(2 / MODES);
    for (let i = 0; i < n; i++) {
      const bx = this.base[i * 3], by = this.base[i * 3 + 1], bz = this.base[i * 3 + 2];
      let dx = 0, dy = 0, dz = 0;
      for (const m of this.modes) {
        const c = Math.cos(m.k[0] * bx + m.k[1] * by + m.k[2] * bz - m.omega * t + m.phase);
        dx += m.pol[0] * c; dy += m.pol[1] * c; dz += m.pol[2] * c;
      }
      const s = a * this.massScale[i];
      this.live[i * 3] = bx + dx * s;
      this.live[i * 3 + 1] = by + dy * s;
      this.live[i * 3 + 2] = bz + dz * s;
    }
    (this.atomGeo.getAttribute('aPos') as THREE.BufferAttribute).needsUpdate = true;

    if (this.bondFrom && this.bondTo && this.bondGeo) {
      for (let i = 0; i < this.bonds.length; i++) {
        const [p, q] = this.bonds[i];
        for (let c = 0; c < 3; c++) {
          this.bondFrom[i * 3 + c] = this.live[p * 3 + c];
          this.bondTo[i * 3 + c] = this.live[q * 3 + c];
        }
      }
      (this.bondGeo.getAttribute('aFrom') as THREE.BufferAttribute).needsUpdate = true;
      (this.bondGeo.getAttribute('aTo') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  /** 0 for ball and stick, 1 for the atoms at the size they really are. */
  setFill(f: number): void {
    this.atomMat.uniforms.uFill.value = Math.max(0, Math.min(1, f));
    if (this.bondMat) this.bondMat.visible = f < 0.75;
  }

  setAmplitude(angstroms: number): void { this.amp = angstroms; }

  dispose(): void {
    this.atomGeo.dispose();
    this.atomMat.dispose();
    this.bondGeo?.dispose();
    this.bondMat?.dispose();
  }
}
