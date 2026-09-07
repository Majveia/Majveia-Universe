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
import { GestureRecogniser, rubberBand, pinchAnchor, type GestureSink } from './gestures';
import { orbitFromLook, shortestTurn } from './orientation';

export type CameraMode = 'orbit' | 'fly';

/** How close to a pole the camera may get before the axis degenerates. */
const PHI_MIN = 0.0005;
const PHI_MAX = Math.PI - 0.0005;
/** How far past a pole a finger may push before it stops giving, radians. */
const PHI_OVER = 0.30;

/**
 * A short haptic tick, where the device has one. Silent everywhere else, and
 * never used for anything that happens more than a few times a second - a
 * buzzing phone is worse than no feedback at all.
 */
export function tick(ms = 8): void {
  try { navigator.vibrate?.(ms); } catch { /* not permitted here */ }
}

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
  /** True while at least one finger is on the glass. */
  touching = false;
  /** True while the device's own orientation is aiming the camera. */
  viewfinder = false;

  /** Touch verbs the application answers: these have no camera meaning. */
  onTap?: (x: number, y: number) => void;
  onDoubleTap?: (x: number, y: number) => void;
  onTwoFingerTap?: () => void;
  onLongPress?: (x: number, y: number) => void;

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
  /** Orbit momentum left over from a flick, in pixels per second. */
  private spinX = 0;
  private spinY = 0;
  private touch: GestureRecogniser;
  private axisR = new THREE.Vector3();
  private axisU = new THREE.Vector3();

  onInteract?: () => void;

  constructor(readonly camera: THREE.PerspectiveCamera, el: HTMLElement) {
    this.el = el;
    this.tTarget.copy(this.target);

    const down = (e: PointerEvent) => {
      if (!this.enabled || e.pointerType === 'touch') return;
      this.dragging = e.button === 2 || e.shiftKey ? 2 : 1;
      this.lastX = e.clientX; this.lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
      this.onInteract?.();
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
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
      if (e.pointerType === 'touch') return;
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

    // --- Touch.
    //
    // A separate path, not a widening of the mouse one. A mouse has a cursor,
    // one button at a time and a wheel; a hand has several contacts, no cursor
    // and no wheel, and pretending the two are the same is how touch support
    // ends up as a drag that cannot zoom.
    const sink: GestureSink = {
      orbitBy: (dx, dy) => this.orbitBy(dx, dy),
      panBy: (dx, dy) => { if (!this.locked) this.pan(dx, dy); },
      pinchBy: (r, cx, cy) => this.pinchBy(r, cx, cy),
      twistBy: (r) => { if (!this.locked) this.thetaTarget += r; },
      fling: (vx, vy) => { this.spinX = vx; this.spinY = vy; },
      tap: (x, y) => this.onTap?.(x, y),
      doubleTap: (x, y) => this.onDoubleTap?.(x, y),
      twoFingerTap: () => this.onTwoFingerTap?.(),
      longPress: (x, y) => this.onLongPress?.(x, y),
      touched: () => {
        // Any new contact kills the inertia: catching a spinning thing stops
        // it, which is the one behaviour everybody expects without being told.
        this.spinX = 0; this.spinY = 0;
        this.onInteract?.();
      },
    };
    this.touch = new GestureRecogniser(sink);

    // Touches are taken from the window, not from the canvas.
    //
    // A gesture belongs to the scene unless it lands on something that is
    // genuinely a control - the shelf, the ladder, the guide - and those are
    // marked. Everything else that floats over the picture is a *report* on
    // it: a readout, an inspector, a diagram. Listening on the canvas alone
    // meant any of those, once open, silently ate the second half of a double
    // tap, so descending worked or did not depending on where a panel happened
    // to be. A panel that reports on the scene must not stand between a finger
    // and the scene.
    const onChrome = (e: Event): boolean => {
      const t = e.target;
      return t instanceof Element && !!t.closest('[data-chrome]');
    };
    /** Pointers being followed, so a move is not taken from a stray finger. */
    const mine = new Set<number>();
    const tdown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !this.enabled) return;
      if (onChrome(e)) return;
      mine.add(e.pointerId);
      this.touching = true;
      this.touch.down(e.pointerId, e.clientX, e.clientY, e.timeStamp);
    };
    const tmove = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !this.enabled || !mine.has(e.pointerId)) return;
      this.touch.move(e.pointerId, e.clientX, e.clientY, e.timeStamp);
    };
    const tup = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !mine.has(e.pointerId)) return;
      mine.delete(e.pointerId);
      this.touch.up(e.pointerId, e.clientX, e.clientY, e.timeStamp);
      this.touching = this.touch.active;
    };
    const tcancel = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      mine.delete(e.pointerId);
      this.touch.cancel(e.pointerId);
      this.touching = this.touch.active;
    };
    // A contact that is never released leaves the recogniser waiting for a
    // finger that has gone, and every gesture after it is misread. Capture is
    // supposed to make that impossible, and mostly does - but a system gesture
    // taking over, a finger leaving by the edge of the screen, or the page
    // being backgrounded mid-drag all end a touch without the element hearing
    // about it. So the window is watched as well, and losing focus is a reset.
    const dropAll = () => { this.touch.reset(); mine.clear(); this.touching = false; };
    // Safari on iOS fires its own pinch gestures over the page even when the
    // element says touch-action: none, and they zoom the document.
    const noGesture = (e: Event) => e.preventDefault();

    window.addEventListener('pointerdown', tdown, true);
    window.addEventListener('pointermove', tmove, true);
    window.addEventListener('pointerup', tup, true);
    window.addEventListener('pointercancel', tcancel, true);
    el.addEventListener('gesturestart', noGesture);
    el.addEventListener('gesturechange', noGesture);
    window.addEventListener('blur', dropAll);
    document.addEventListener('visibilitychange', dropAll);
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
      window.removeEventListener('pointerdown', tdown, true);
      window.removeEventListener('pointermove', tmove, true);
      window.removeEventListener('pointerup', tup, true);
      window.removeEventListener('pointercancel', tcancel, true);
      el.removeEventListener('gesturestart', noGesture);
      el.removeEventListener('gesturechange', noGesture);
      window.removeEventListener('blur', dropAll);
      document.removeEventListener('visibilitychange', dropAll);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('contextmenu', ctx);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
      this.touch.reset();
    });
  }

  /**
   * Orbit by a drag in pixels, with give at the poles.
   *
   * Past the pole the axis degenerates and there is nothing sensible to show,
   * so the motion has to stop - but a hard stop reads as a broken control. It
   * gives progressively less instead, and springs back when the finger lifts,
   * which communicates the limit rather than merely enforcing it.
   */
  orbitBy(dx: number, dy: number): void {
    // While the phone is aiming the camera, dragging it as well would fight
    // the sensor and lose: the next reading would put it straight back.
    if (this.locked || this.viewfinder) return;
    this.thetaTarget -= dx * this.rotateSpeed;
    const p = this.phiTarget;
    const over = p < PHI_MIN ? PHI_MIN - p : p > PHI_MAX ? p - PHI_MAX : 0;
    const next = p - dy * this.rotateSpeed * rubberBand(over);
    this.phiTarget = Math.max(PHI_MIN - PHI_OVER, Math.min(PHI_MAX + PHI_OVER, next));
  }

  /**
   * Aim along a direction, as a viewfinder does.
   *
   * The azimuth accumulates without bound while a heading arrives wrapped into
   * one turn, so it is moved to the nearest equivalent rather than assigned;
   * otherwise the camera spins the long way round every time the phone passes
   * north. The damping in `update` does the rest, which is also what keeps a
   * hand's tremor out of the picture.
   */
  lookAlong(dir: THREE.Vector3): void {
    if (this.locked) return;
    const { theta, phi } = orbitFromLook(dir);
    this.thetaTarget = shortestTurn(this.thetaTarget, theta);
    this.phiTarget = Math.max(PHI_MIN, Math.min(PHI_MAX, phi));
    this.spinX = 0;
    this.spinY = 0;
  }

  /**
   * Zoom by a pinch, holding the world point between the fingers still.
   *
   * This is the difference between a zoom that feels like grabbing the sky and
   * one that feels like operating a slider: the thing you have your fingers on
   * has to stay under them. On the plane through the focus it is exact.
   */
  pinchBy(ratio: number, cx: number, cy: number): void {
    if (this.locked || !this.enabled) return;
    if (this.mode === 'fly') {
      this.flySpeed = Math.max(1e-9, this.flySpeed * ratio);
      return;
    }
    const before = this.dTarget;
    const after = Math.max(this.minDistance, Math.min(this.maxDistance, before * ratio));
    this.dTarget = after;
    // The clamps at either end of forty orders of magnitude mean the applied
    // ratio is not always the requested one, and anchoring to the requested
    // one would drift the focus at the limits.
    const applied = after / before;
    if (Math.abs(applied - 1) < 1e-12) return;
    const r = this.el.getBoundingClientRect();
    if (r.height < 1) return;
    const wpp = (2 * this.distance * Math.tan((this.camera.fov * Math.PI) / 360)) / r.height;
    const shift = pinchAnchor(
      cx - r.left - r.width / 2, cy - r.top - r.height / 2, applied, wpp,
    );
    this.axisR.setFromMatrixColumn(this.camera.matrix, 0);
    this.axisU.setFromMatrixColumn(this.camera.matrix, 1);
    this.tTarget.addScaledVector(this.axisR, shift.right);
    this.tTarget.addScaledVector(this.axisU, shift.up);
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
    this.spinX = 0; this.spinY = 0;
    this.tTarget.copy(p); this.target.copy(p);
    this.dTarget = distance; this.distance = distance;
    if (theta !== undefined) { this.thetaTarget = theta; this.theta = theta; }
    if (phi !== undefined) { this.phiTarget = phi; this.phi = phi; }
    this.vel.set(0, 0, 0);
  }

  get isMoving(): boolean {
    return this.dragging !== 0 || this.keys.size > 0 || this.touching ||
      this.spinX !== 0 || this.spinY !== 0 ||
      Math.abs(this.distance / this.dTarget - 1) > 1e-4 ||
      this.tTarget.distanceToSquared(this.target) > 1e-12;
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-this.damping * dt);

    // --- Inertia from a flick. Decayed in the exponent so a slow frame does
    //     not carry the camera further than a fast one.
    if (this.spinX !== 0 || this.spinY !== 0) {
      this.orbitBy(this.spinX * dt, this.spinY * dt);
      const decay = Math.exp(-2.7 * dt);
      this.spinX *= decay;
      this.spinY *= decay;
      if (Math.hypot(this.spinX, this.spinY) < 8) { this.spinX = 0; this.spinY = 0; }
    }

    // --- Spring back from past a pole, once nothing is holding it there.
    if (!this.touching) {
      const p = this.phiTarget;
      if (p < PHI_MIN || p > PHI_MAX) {
        const to = Math.max(PHI_MIN, Math.min(PHI_MAX, p));
        this.phiTarget = p + (to - p) * (1 - Math.exp(-11 * dt));
        this.spinY = 0;
      }
    }

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
