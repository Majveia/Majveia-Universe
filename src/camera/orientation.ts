/**
 * The phone as a viewfinder.
 *
 * A handheld device knows which way it is pointing, to a fraction of a degree,
 * from three orthogonal accelerometers and three gyroscopes it uses to keep its
 * own screen the right way up. That is a piece of information a desktop simply
 * does not have, and it turns a window into a direction: hold the thing up,
 * turn, and walk around a galaxy.
 *
 * The angles the browser reports are intrinsic Tait-Bryan rotations in the
 * order Z-X'-Y'' - alpha about the screen normal, then beta about the new
 * horizontal axis, then gamma about the axis after that - which is an unusual
 * convention and the reason nobody gets this right by guessing. Two further
 * rotations are needed after it:
 *
 *  - a quarter turn about x, because the device frame has z out of the screen
 *    and a camera looks along -z, so the two are ninety degrees apart. What
 *    comes out is the direction the *back* of the phone points, which is the
 *    correct one: a viewfinder is a thing you look through, so a phone lying
 *    flat on a table with its screen upward is looking at the table.
 *  - a roll by the screen orientation, because rotating a phone into landscape
 *    does not change any of alpha, beta or gamma - the sensors are bolted to
 *    the case - but does change which way is up on the display.
 *
 * The mapping onto the camera is deliberately absolute rather than relative.
 * Where the phone points is where the camera looks from, with no offset
 * accumulated at the moment the mode was switched on, so there is nothing to
 * drift and turning all the way round brings you back exactly where you began.
 */

import * as THREE from 'three';

/** The device frame's z is out of the screen; a camera looks along -z. */
const SCREEN_TO_CAMERA = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
const Z = new THREE.Vector3(0, 0, 1);

const DEG = Math.PI / 180;

export interface DeviceAngles {
  /** Compass heading, degrees, counter-clockwise from the device's reference. */
  alpha: number;
  /** Front-to-back tilt, degrees. */
  beta: number;
  /** Left-to-right tilt, degrees. */
  gamma: number;
  /** How far the display is rotated from its natural orientation, degrees. */
  screen: number;
}

/**
 * The device's attitude as a rotation, from the three angles a browser reports
 * and the current screen orientation. Angles in degrees, as they arrive.
 */
export function deviceQuaternion(a: DeviceAngles, into?: THREE.Quaternion): THREE.Quaternion {
  const q = into ?? new THREE.Quaternion();
  // Intrinsic Z-X'-Y'', which three.js spells 'YXZ' because it composes
  // extrinsically in the opposite order.
  q.setFromEuler(new THREE.Euler(a.beta * DEG, a.alpha * DEG, -a.gamma * DEG, 'YXZ'));
  q.multiply(SCREEN_TO_CAMERA);
  q.multiply(new THREE.Quaternion().setFromAxisAngle(Z, -a.screen * DEG));
  return q;
}

/** Where the back of the phone is pointing, as a unit vector. */
export function lookDirection(a: DeviceAngles, into?: THREE.Vector3): THREE.Vector3 {
  const v = into ?? new THREE.Vector3();
  return v.set(0, 0, -1).applyQuaternion(deviceQuaternion(a)).normalize();
}

/**
 * The orbit angles that make the camera look along a given direction.
 *
 * An orbit camera is described by where it sits relative to what it is looking
 * at, and that is the opposite of where it is looking - so the whole conversion
 * is one negation and two inverse trigonometric functions. Turning the phone
 * ninety degrees walks the camera a quarter of the way round the object, which
 * is the right metaphor for a thing that is always in the middle of the frame.
 */
export function orbitFromLook(dir: THREE.Vector3): { theta: number; phi: number } {
  const x = -dir.x, y = -dir.y, z = -dir.z;
  const r = Math.hypot(x, y, z) || 1;
  return {
    theta: Math.atan2(x / r, z / r),
    phi: Math.acos(Math.min(1, Math.max(-1, y / r))),
  };
}

/**
 * The shortest way round from one angle to another.
 *
 * The orbit azimuth accumulates without limit - drag round three times and it
 * is at six pi - while a heading arrives wrapped into a single turn. Assigning
 * one to the other directly would send the camera the long way round every
 * time the phone crossed north, which is both wrong and unmistakably so.
 */
export function shortestTurn(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + d;
}

/** How the screen is rotated from its natural orientation, in degrees. */
export function screenAngle(): number {
  const so = window.screen?.orientation;
  if (so && typeof so.angle === 'number') return so.angle;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === 'number' ? legacy : 0;
}

export type OrientationState = 'off' | 'on' | 'denied' | 'unavailable';

/**
 * The sensor, with its permissions and its quirks.
 *
 * Since iOS 13 the orientation sensors are gated behind a permission that can
 * only be asked for from inside a user gesture, and asking outside one fails
 * silently forever - so this is only ever started from a tap. Where the
 * absolute variant of the event exists it is preferred, because it is
 * referenced to true north instead of to wherever the device happened to be
 * when the page loaded, and an absolute reference is the difference between a
 * viewfinder and a slowly drifting one.
 */
export class DeviceOrientation {
  private listeners: [string, (e: Event) => void][] = [];
  private angles: DeviceAngles = { alpha: 0, beta: 0, gamma: 0, screen: 0 };
  /** Whether a reading has arrived, and whether it was referenced to north. */
  private seen = false;
  private seenAbsolute = false;
  state: OrientationState = 'off';

  /** True once the sensor has actually reported something. */
  get live(): boolean { return this.state === 'on' && this.seen; }

  /** Whether the readings are referenced to true north rather than to nothing. */
  get absolute(): boolean { return this.seenAbsolute; }

  static get supported(): boolean {
    return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  }

  /** Must be called from a user gesture, or iOS will refuse without saying so. */
  async start(): Promise<OrientationState> {
    if (this.state === 'on') return this.state;
    if (!DeviceOrientation.supported) { this.state = 'unavailable'; return this.state; }
    const ctor = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    if (typeof ctor.requestPermission === 'function') {
      try {
        if (await ctor.requestPermission() !== 'granted') {
          this.state = 'denied';
          return this.state;
        }
      } catch {
        this.state = 'denied';
        return this.state;
      }
    }

    // Both events, not one.
    //
    // The absolute variant is the one worth having, because it is referenced to
    // true north rather than to wherever the device happened to be lying when
    // the page loaded. But a browser can expose it and never fire it - there
    // may be no magnetometer, or it may be uncalibrated - and choosing it on
    // the strength of the property alone leaves the viewfinder switched on and
    // permanently still, which is the worst of the possible outcomes. So both
    // are subscribed, an absolute reading wins where one exists, and the
    // relative one carries the mode until then.
    const take = (absolute: boolean) => (ev: Event) => {
      const e = ev as DeviceOrientationEvent;
      if (e.alpha === null && e.beta === null && e.gamma === null) return;
      if (!absolute && this.seenAbsolute) return;
      if (absolute) this.seenAbsolute = true;
      this.seen = true;
      this.angles = {
        alpha: e.alpha ?? 0,
        beta: e.beta ?? 0,
        gamma: e.gamma ?? 0,
        screen: screenAngle(),
      };
    };
    for (const [name, absolute] of [
      ['deviceorientationabsolute', true], ['deviceorientation', false],
    ] as [string, boolean][]) {
      const fn = take(absolute);
      window.addEventListener(name, fn);
      this.listeners.push([name, fn]);
    }
    this.state = 'on';
    this.seen = false;
    this.seenAbsolute = false;
    return this.state;
  }

  stop(): void {
    for (const [name, fn] of this.listeners) window.removeEventListener(name, fn);
    this.listeners = [];
    this.seen = false;
    this.seenAbsolute = false;
    if (this.state === 'on') this.state = 'off';
  }

  /** The direction the phone is pointing, or null before the first reading. */
  direction(into?: THREE.Vector3): THREE.Vector3 | null {
    if (!this.live) return null;
    return lookDirection(this.angles, into);
  }

  /** The last angles reported, for the readout. */
  get reading(): DeviceAngles { return this.angles; }
}
