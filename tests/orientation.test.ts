import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  lookDirection, orbitFromLook, deviceQuaternion, shortestTurn,
} from '../src/camera/orientation';

const look = (alpha: number, beta: number, gamma: number, screen = 0) =>
  lookDirection({ alpha, beta, gamma, screen });

describe('which way the phone is pointing', () => {
  it('looks at the table when it is lying on one, screen up', () => {
    // A viewfinder is a thing you look through, so the direction that matters
    // is the one out of the back of the phone - which here is straight down.
    const d = look(0, 0, 0);
    expect(d.y).toBeCloseTo(-1, 6);
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(0, 6);
  });

  it('looks at the ceiling when the phone is face down', () => {
    const d = look(0, 180, 0);
    expect(d.y).toBeCloseTo(1, 6);
  });

  it('looks at the horizon when the phone is held upright', () => {
    const d = look(0, 90, 0);
    expect(Math.abs(d.y)).toBeLessThan(1e-6);
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(1, 6);
  });

  it('swings a quarter turn when the compass heading does', () => {
    const a = look(0, 90, 0);
    const b = look(90, 90, 0);
    const angle = Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
    expect(angle).toBeCloseTo(Math.PI / 2, 4);
  });

  it('turns the whole way round and comes back to where it started', () => {
    const a = look(0, 90, 0);
    const b = look(360, 90, 0);
    expect(a.distanceTo(b)).toBeLessThan(1e-6);
  });

  it('tilts up and down with beta, and monotonically', () => {
    // From flat-on-the-table to upright to face-down: the view sweeps from
    // straight down, through the horizon, to straight up, without turning back.
    let prev = -Infinity;
    for (const beta of [0, 20, 45, 70, 90, 110, 140, 180]) {
      const y = look(0, beta, 0).y;
      expect(y).toBeGreaterThan(prev - 1e-9);
      prev = y;
    }
  });

  it('does not change where it points when the display rotates', () => {
    // The sensors are bolted to the case: turning the phone into landscape
    // changes which way is up on the screen and nothing about the pose. The
    // screen term is a roll about the view axis, so the direction must be
    // untouched by it - if it were not, a viewfinder would jump ninety degrees
    // the moment the device auto-rotated.
    for (const screen of [0, 90, 180, 270]) {
      const d = look(35, 62, -14, screen);
      const base = look(35, 62, -14, 0);
      expect(d.distanceTo(base)).toBeLessThan(1e-6);
    }
  });

  it('rolls the frame by exactly the screen angle', () => {
    // What the screen term must change is the camera's idea of up.
    const up = (screen: number) =>
      new THREE.Vector3(0, 1, 0)
        .applyQuaternion(deviceQuaternion({ alpha: 0, beta: 90, gamma: 0, screen }));
    const a = up(0);
    const b = up(90);
    expect(Math.acos(Math.min(1, Math.max(-1, a.dot(b))))).toBeCloseTo(Math.PI / 2, 4);
  });

  it('always returns a unit vector, whatever it is handed', () => {
    for (const [al, be, ga] of [[0, 0, 0], [270, -45, 88], [123, 17, -63], [359, 179, 89]]) {
      expect(look(al, be, ga).length()).toBeCloseTo(1, 9);
    }
  });
});

describe('turning a direction into an orbit', () => {
  const round = (theta: number, phi: number) =>
    new THREE.Vector3(
      Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta),
    );

  it('puts the camera on the far side of what it is looking at', () => {
    // Looking north means standing to the south of the thing.
    const { theta, phi } = orbitFromLook(new THREE.Vector3(0, 0, -1));
    const pos = round(theta, phi);
    expect(pos.z).toBeCloseTo(1, 6);
    expect(Math.abs(pos.y)).toBeLessThan(1e-6);
  });

  it('inverts the camera placement exactly, for any direction', () => {
    // The round trip is the property that matters: whatever the phone reports,
    // the camera must end up looking along it and not merely near it.
    for (const v of [
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(0.3, 0.8, -0.5),
      new THREE.Vector3(-0.6, -0.2, 0.77), new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(-0.1, 0.05, 0.99),
    ]) {
      const dir = v.clone().normalize();
      const { theta, phi } = orbitFromLook(dir);
      // Where the camera sits, and therefore where it looks: back at the middle.
      const view = round(theta, phi).multiplyScalar(-1);
      expect(view.distanceTo(dir)).toBeLessThan(1e-9);
    }
  });

  it('keeps the polar angle inside its range', () => {
    for (const beta of [-180, -90, 0, 45, 90, 179, 180]) {
      const { phi } = orbitFromLook(look(0, beta, 0));
      expect(phi).toBeGreaterThanOrEqual(0);
      expect(phi).toBeLessThanOrEqual(Math.PI);
      expect(Number.isFinite(phi)).toBe(true);
    }
  });

  it('survives a degenerate direction rather than returning NaN', () => {
    const { theta, phi } = orbitFromLook(new THREE.Vector3(0, 0, 0));
    expect(Number.isFinite(theta)).toBe(true);
    expect(Number.isFinite(phi)).toBe(true);
  });
});

describe('going the short way round', () => {
  it('lands on an angle that means the same thing', () => {
    for (const [from, to] of [[0, 1], [6.0, 0.1], [-3, 3], [100, 0.5], [-0.2, 6.2]]) {
      const r = shortestTurn(from, to);
      const same = Math.abs(((r - to) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2));
      expect(Math.min(same, Math.PI * 2 - same)).toBeLessThan(1e-9);
    }
  });

  it('never turns more than half a circle', () => {
    for (let from = -20; from < 20; from += 0.37) {
      for (let to = -Math.PI; to <= Math.PI; to += 0.31) {
        expect(Math.abs(shortestTurn(from, to) - from)).toBeLessThanOrEqual(Math.PI + 1e-9);
      }
    }
  });

  it('crosses north the near way, not the long way', () => {
    // Pointing just west of north, then just east of it: a hand's width of
    // turn, not three hundred and fifty degrees of camera.
    expect(shortestTurn(-0.05, 0.05) - -0.05).toBeCloseTo(0.1, 9);
    expect(shortestTurn(0.05, -0.05) - 0.05).toBeCloseTo(-0.1, 9);
  });

  it('carries an accumulated azimuth with it rather than unwinding it', () => {
    // Three full turns of dragging leaves the azimuth near six pi. A heading
    // arriving as 0.2 must not send the camera back through all of them.
    const wound = Math.PI * 6 + 0.1;
    const r = shortestTurn(wound, 0.2);
    expect(Math.abs(r - wound)).toBeLessThan(0.2);
    expect(r).toBeGreaterThan(Math.PI * 5);
  });
});
