/**
 * Camera control: an orbit rig and a free-flight rig sharing one state, with
 * critically-damped smoothing on every axis.
 *
 * Distances in this simulation span from metres to gigaparsecs, so nothing is
 * linear: zoom is exponential, flight speed is proportional to how far you are
 * from what you are looking at, and the damping is frame-rate independent
 * (exp(-k dt) rather than a fixed lerp) so the feel does not change between a
 * 60 Hz laptop and a 240 Hz desktop.
 */

import * as THREE from 'three';

export type CameraMode = 'orbit' | 'fly';

export class Controls {
  mode: CameraMode = 'orbit';
  target = new THREE.Vector3();
  /** Orbit radius. */
  distance = 10;
  minDistance = 1e-6;
  maxDistance = 1e12;
  /** Azimuth and polar angles, radians. */
  theta = 0.6;
  phi = 1.15;

  rotateSpeed = 0.0042;
  zoomSpeed = 0.0016;
  damping = 12;
  flySpeed = 1;
  boost = 1;

  enabled = true;
  /** Set by the app while a cinematic transition owns the camera. */
  locked = false;

  private tTarget = new THREE.Vector3();
  private dTarget = 10;
  private thetaTarget = 0.6;
  private phiTarget = 1.15;
  private keys = new Set<string>();
  private dragging = 0;
  private lastX = 0;
  private lastY = 0;
  private el: HTMLElement;
  private disposers: (() => void)[] = [];
  /** Momentum applied by flight keys, in world units per second. */
  private vel = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  onInteract?: () => void;

  constructor(readonly camera: THREE.PerspectiveCamera, el: HTMLElement) {
    this.el = el;
    this.tTarget.copy(this.target);

    const down = (e: PointerEvent) => {
      if (!this.enabled) return;
      this.dragging = e.button === 2 || e.shiftKey ? 2 : 1;
      this.lastX = e.clientX; this.lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
      this.onInteract?.();
    };
    const move = (e: PointerEvent) => {
      if (!this.dragging || !this.enabled || this.locked) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX; this.lastY = e.clientY;
      if (this.dragging === 1) {
        this.thetaTarget -= dx * this.rotateSpeed;
        this.phiTarget = Math.max(0.0005, Math.min(Math.PI - 0.0005,
          this.phiTarget - dy * this.rotateSpeed));
      } else {
        this.pan(dx, dy);
      }
    };
    const up = (e: PointerEvent) => {
      this.dragging = 0;
      try { el.releasePointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    };
    const wheel = (e: WheelEvent) => {
      if (!this.enabled || this.locked) return;
      e.preventDefault();
      const k = Math.exp(e.deltaY * this.zoomSpeed);
      if (this.mode === 'orbit') {
        this.dTarget = Math.max(this.minDistance, Math.min(this.maxDistance, this.dTarget * k));
      } else {
        this.flySpeed = Math.max(1e-9, this.flySpeed / k);
      }
      this.onInteract?.();
    };
    const ctx = (e: Event) => e.preventDefault();
    const kd = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.code);
    };
    const ku = (e: KeyboardEvent) => this.keys.delete(e.code);
    const blur = () => this.keys.clear();

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('contextmenu', ctx);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);

    this.disposers.push(() => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('contextmenu', ctx);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
    });
  }

  private pan(dx: number, dy: number): void {
    const s = (this.distance * Math.tan((this.camera.fov * Math.PI) / 360) * 2) /
      this.el.clientHeight;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const upv = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    this.tTarget.addScaledVector(right, -dx * s);
    this.tTarget.addScaledVector(upv, dy * s);
  }

  /** Point the camera at a new focus over `seconds`, keeping the framing sane. */
  focusOn(p: THREE.Vector3, distance?: number): void {
    this.tTarget.copy(p);
    if (distance !== undefined) {
      this.dTarget = Math.max(this.minDistance, Math.min(this.maxDistance, distance));
    }
  }

  /** Snap immediately, with no easing (used when changing scale). */
  snapTo(p: THREE.Vector3, distance: number, theta?: number, phi?: number): void {
    this.tTarget.copy(p); this.target.copy(p);
    this.dTarget = distance; this.distance = distance;
    if (theta !== undefined) { this.thetaTarget = theta; this.theta = theta; }
    if (phi !== undefined) { this.phiTarget = phi; this.phi = phi; }
    this.vel.set(0, 0, 0);
  }

  get isMoving(): boolean {
    return this.dragging !== 0 || this.keys.size > 0 ||
      Math.abs(this.distance / this.dTarget - 1) > 1e-4 ||
      this.tTarget.distanceToSquared(this.target) > 1e-12;
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-this.damping * dt);

    // Flight keys move the focus point; in orbit mode that is a dolly-and-track.
    const speedBoost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 6 : 1;
    const slow = this.keys.has('AltLeft') || this.keys.has('ControlLeft') ? 0.12 : 1;
    const base = (this.mode === 'fly' ? this.flySpeed : this.distance * 1.2) *
      speedBoost * slow * this.boost;

    if (!this.locked) {
      const fwd = new THREE.Vector3();
      this.camera.getWorldDirection(fwd);
      const right = new THREE.Vector3().crossVectors(fwd, this.up).normalize();
      const move = new THREE.Vector3();
      if (this.keys.has('KeyW')) move.add(fwd);
      if (this.keys.has('KeyS')) move.sub(fwd);
      if (this.keys.has('KeyD')) move.add(right);
      if (this.keys.has('KeyA')) move.sub(right);
      if (this.keys.has('KeyE') || this.keys.has('Space')) move.add(this.up);
      if (this.keys.has('KeyQ')) move.sub(this.up);
      if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(base);
        this.vel.lerp(move, 1 - Math.exp(-9 * dt));
        this.onInteract?.();
      } else {
        this.vel.multiplyScalar(Math.exp(-7 * dt));
      }
      if (this.vel.lengthSq() > 0) this.tTarget.addScaledVector(this.vel, dt);
    }

    this.theta += (this.thetaTarget - this.theta) * k;
    this.phi += (this.phiTarget - this.phi) * k;
    this.distance *= Math.pow(this.dTarget / this.distance, k);
    this.target.lerp(this.tTarget, k);

    const sp = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.distance * sp * Math.sin(this.theta),
      this.target.y + this.distance * Math.cos(this.phi),
      this.target.z + this.distance * sp * Math.cos(this.theta),
    );
    this.camera.up.copy(this.up);
    this.camera.lookAt(this.target);
  }

  dispose(): void { for (const d of this.disposers) d(); }
}
