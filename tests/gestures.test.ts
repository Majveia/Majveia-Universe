import { describe, it, expect, vi } from 'vitest';
import {
  GestureRecogniser, rubberBand, pinchAnchor, type GestureSink,
} from '../src/camera/gestures';

/** A sink that records everything, so a gesture can be asserted on as a whole. */
function spy() {
  const log: [string, ...number[]][] = [];
  const sink: GestureSink = {
    orbitBy: (dx, dy) => log.push(['orbit', dx, dy]),
    panBy: (dx, dy) => log.push(['pan', dx, dy]),
    pinchBy: (r, cx, cy) => log.push(['pinch', r, cx, cy]),
    twistBy: (r) => log.push(['twist', r]),
    fling: (vx, vy) => log.push(['fling', vx, vy]),
    tap: (x, y) => log.push(['tap', x, y]),
    doubleTap: (x, y) => log.push(['double', x, y]),
    twoFingerTap: () => log.push(['back']),
    longPress: (x, y) => log.push(['long', x, y]),
    touched: () => {},
  };
  const kinds = () => log.map((e) => e[0]);
  return { log, sink, kinds };
}

describe('taps', () => {
  it('is a tap when the finger barely moves and lets go quickly', () => {
    const s = spy();
    const g = new GestureRecogniser(s.sink);
    g.down(1, 100, 100, 0);
    g.move(1, 102, 101, 40);
    g.up(1, 102, 101, 90);
    expect(s.kinds()).toEqual(['tap']);
  });

  it('is not a tap once the finger has travelled past the slop', () => {
    const s = spy();
    const g = new GestureRecogniser(s.sink);
    g.down(1, 100, 100, 0);
    g.move(1, 140, 100, 40);
    g.up(1, 140, 100, 90);
    expect(s.kinds()).toContain('orbit');
    expect(s.kinds()).not.toContain('tap');
  });

  it('holds still inside the slop before it starts orbiting', () => {
    const s = spy();
    const g = new GestureRecogniser(s.sink, { slop: 10 });
    g.down(1, 100, 100, 0);
    g.move(1, 104, 100, 16);   // inside the slop: nothing yet
    expect(s.kinds()).toEqual([]);
    g.move(1, 118, 100, 32);   // past it: orbiting from here on
    expect(s.kinds()).toEqual(['orbit']);
  });

  it('does not tap after a long press has already fired', async () => {
    vi.useFakeTimers();
    const s = spy();
    const g = new GestureRecogniser(s.sink, { longPressMs: 100 });
    g.down(1, 50, 50, 0);
    vi.advanceTimersByTime(140);
    expect(s.kinds()).toEqual(['long']);
    g.up(1, 50, 50, 200);
    expect(s.kinds()).toEqual(['long']);
    vi.useRealTimers();
  });

  it('cancels the long press as soon as the finger moves', () => {
    vi.useFakeTimers();
    const s = spy();
    const g = new GestureRecogniser(s.sink, { longPressMs: 100, slop: 5 });
    g.down(1, 50, 50, 0);
    g.move(1, 90, 50, 30);
    vi.advanceTimersByTime(200);
    expect(s.kinds()).not.toContain('long');
    vi.useRealTimers();
  });
});

describe('double tap', () => {
  it('fires on the second of two quick taps in the same place', () => {
    const s = spy();
    const g = new GestureRecogniser(s.sink);
    g.down(1, 200, 200, 0); g.up(1, 200, 200, 60);
    g.down(2, 203, 198, 160); g.up(2, 203, 198, 210);
    expect(s.kinds()).toEqual(['tap', 'double']);
  });

  it('does not fire when the taps are far apart', () => {
    const s = spy();
    const g = new GestureRecogniser(s.sink, { doubleTapSlop: 20 });
    g.down(1, 200, 200, 0); g.up(1, 200, 200, 60);
    g.down(2, 300, 200, 160); g.up(2, 300, 200, 210);
    expect(s.kinds()).toEqual(['tap', 'tap']);
  });

  it('does not fire when the second tap is too late', () => {
    const s = spy();
    const g = new GestureRecogniser(s.sink, { doubleTapMs: 200 });
    g.down(1, 200, 200, 0); g.up(1, 200, 200, 60);
    g.down(2, 200, 200, 900); g.up(2, 200, 200, 950);
    expect(s.kinds()).toEqual(['tap', 'tap']);
  });

  it('does not turn three taps into two doubles', () => {
    const s = spy();
    const g = new GestureRecogniser(s.sink);
    g.down(1, 10, 10, 0); g.up(1, 10, 10, 40);
    g.down(2, 10, 10, 120); g.up(2, 10, 10, 160);
    g.down(3, 10, 10, 240); g.up(3, 10, 10, 280);
    expect(s.kinds()).toEqual(['tap', 'double', 'tap']);
  });
});

describe('two fingers', () => {
  it('reports spreading as a ratio below one', () => {
    const s = spy();
    const g = new GestureRecogniser(s.sink);
    g.down(1, 100, 300, 0);
    g.down(2, 200, 300, 10);          // 100 px apart
    g.move(2, 300, 300, 30);          // now 200 px apart
    const pinch = s.log.find((e) => e[0] === 'pinch');
    expect(pinch).toBeDefined();
    expect(pinch![1]).toBeCloseTo(0.5, 6);
  });

  it('reports the centroid between the fingers, not the screen centre', () => {
    const s = spy();
    const g = new GestureRecogniser(s.sink);
    g.down(1, 100, 400, 0);
    g.down(2, 200, 400, 10);
    g.move(2, 300, 400, 30);
    const pinch = s.log.find((e) => e[0] === 'pinch')!;
    expect(pinch[2]).toBeCloseTo(200, 6);   // (100 + 300) / 2
    expect(pinch[3]).toBeCloseTo(400, 6);
  });

  it('separates a two-finger drag from a pinch in the same motion', () => {
    const s = spy();
    const g = new GestureRecogniser(s.sink);
    g.down(1, 100, 100, 0);
    g.down(2, 200, 100, 10);
    // Both fingers move right by 50: the separation is unchanged, so this is
    // pure pan and the pinch must not fire.
    g.move(1, 150, 100, 30);
    g.move(2, 250, 100, 32);
    const pans = s.log.filter((e) => e[0] === 'pan');
    const pinches = s.log.filter((e) => e[0] === 'pinch');
    expect(pans.length).toBeGreaterThan(0);
    expect(pans.reduce((a, e) => a + e[1], 0)).toBeCloseTo(50, 6);
    // Fingers report one at a time, so the separation wobbles between the two
    // reports; what must hold is that the whole gesture nets out to no zoom.
    expect(pinches.reduce((a, e) => a * e[1], 1)).toBeCloseTo(1, 9);
  });

  it('reports a twist when the pair rotates', () => {
    const s = spy();
    const g = new GestureRecogniser(s.sink);
    g.down(1, 0, 0, 0);
    g.down(2, 100, 0, 10);            // along +x
    g.move(2, 0, 100, 30);            // rotated a quarter turn on screen
    const tw = s.log.filter((e) => e[0] === 'twist').reduce((a, e) => a + e[1], 0);
    expect(Math.abs(tw)).toBeGreaterThan(0.4);
  });

  it('never twists more than half a turn in one step', () => {
    const s = spy();
    const g = new GestureRecogniser(s.sink);
    g.down(1, 0, 0, 0);
    g.down(2, 100, 1, 10);            // just above the branch cut
    g.move(2, 100, -1, 30);           // just below it
    const tw = s.log.filter((e) => e[0] === 'twist');
    expect(tw.every((e) => Math.abs(e[1]) <= Math.PI)).toBe(true);
  });

  it('is the way back out when both fingers tap and go', () => {
    const s = spy();
    const g = new GestureRecogniser(s.sink);
    g.down(1, 100, 100, 0);
    g.down(2, 160, 100, 12);
    g.up(1, 100, 100, 120);
    g.up(2, 160, 100, 130);
    expect(s.kinds()).toContain('back');
  });

  it('is not the way back out if the fingers moved', () => {
    const s = spy();
    const g = new GestureRecogniser(s.sink);
    g.down(1, 100, 100, 0);
    g.down(2, 200, 100, 12);
    g.move(2, 320, 100, 40);
    g.up(1, 100, 100, 120);
    g.up(2, 320, 100, 130);
    expect(s.kinds()).not.toContain('back');
  });

  it('does not jump when one of two fingers lifts', () => {
    const s = spy();
    const g = new GestureRecogniser(s.sink);
    g.down(1, 100, 100, 0);
    g.down(2, 400, 100, 12);
    g.move(1, 120, 100, 40);
    const before = s.log.filter((e) => e[0] === 'orbit').length;
    g.up(2, 400, 100, 60);            // the far finger goes
    g.move(1, 130, 100, 80);          // the near one continues
    const orbits = s.log.filter((e) => e[0] === 'orbit');
    expect(orbits.length).toBe(before + 1);
    // Ten pixels of finger, ten pixels of orbit - not two hundred and eighty.
    expect(orbits[orbits.length - 1][1]).toBeCloseTo(10, 6);
  });
});

describe('inertia', () => {
  it('flings when the finger was moving at release', () => {
    const s = spy();
    const g = new GestureRecogniser(s.sink, { flingMin: 50 });
    g.down(1, 0, 100, 0);
    for (let i = 1; i <= 6; i++) g.move(1, i * 40, 100, i * 16);
    g.up(1, 240, 100, 96);
    const f = s.log.find((e) => e[0] === 'fling');
    expect(f).toBeDefined();
    expect(f![1]).toBeGreaterThan(1000);      // ~2500 px/s
  });

  it('does not fling when the finger stopped before letting go', () => {
    const s = spy();
    const g = new GestureRecogniser(s.sink, { flingMin: 90 });
    g.down(1, 0, 100, 0);
    for (let i = 1; i <= 5; i++) g.move(1, i * 40, 100, i * 16);
    // Held still for a while before release.
    for (let i = 1; i <= 8; i++) g.move(1, 200, 100, 80 + i * 30);
    g.up(1, 200, 100, 340);
    expect(s.kinds()).not.toContain('fling');
  });
});

describe('the mathematics under the gestures', () => {
  it('gives less and less as a limit is passed', () => {
    expect(rubberBand(0)).toBe(1);
    expect(rubberBand(0.05)).toBeLessThan(1);
    expect(rubberBand(0.4)).toBeLessThan(rubberBand(0.05));
    expect(rubberBand(1e6)).toBeGreaterThan(0);
  });

  it('moves the focus toward the fingers when zooming in', () => {
    // Pinching in on a point to the right of centre: the focus follows it.
    const a = pinchAnchor(100, 0, 0.5, 0.01);
    expect(a.right).toBeGreaterThan(0);
    expect(a.up).toBeCloseTo(0, 12);
    // And away from it when zooming out, by the same rule
    const b = pinchAnchor(100, 0, 2, 0.01);
    expect(b.right).toBeLessThan(0);
  });

  it('keeps the point under the fingers still, exactly, on the focus plane', () => {
    // A point 120 px right and 80 px below centre, on the focus plane.
    const wpp = 0.004, ox = 120, oy = -80, ratio = 0.6;
    const a = pinchAnchor(ox, oy, ratio, wpp);
    // Its world offset from the focus before, and after the focus moves:
    const beforeR = ox * wpp, beforeU = -oy * wpp;
    const afterR = beforeR - a.right, afterU = beforeU - a.up;
    // On screen after the zoom, at the new scale:
    expect(afterR / (wpp * ratio)).toBeCloseTo(ox, 9);
    expect(afterU / (wpp * ratio)).toBeCloseTo(-oy, 9);
  });

  it('does nothing at all when the scale does not change', () => {
    const a = pinchAnchor(300, -200, 1, 0.02);
    expect(a.right).toBeCloseTo(0, 12);
    expect(a.up).toBeCloseTo(0, 12);
  });
});

describe('when the main thread is busy', () => {
  it('is still a tap even if the hold timer got there first', () => {
    // The phone spends half a second building a new scale. The finger came and
    // went in fifty milliseconds, but its release was stuck in the queue, so
    // the wall-clock timer fires before the recogniser hears about it.
    vi.useFakeTimers();
    const s = spy();
    const g = new GestureRecogniser(s.sink, { longPressMs: 400 });
    g.down(1, 100, 100, 1000);
    vi.advanceTimersByTime(500);            // the timer fires, unavoidably
    expect(s.kinds()).toEqual(['long']);
    g.up(1, 100, 100, 1050);                // but the event says fifty ms
    expect(s.kinds()).toEqual(['long', 'tap']);
    vi.useRealTimers();
  });

  it('lets a delayed tap pair into a double tap, so descending still works', () => {
    vi.useFakeTimers();
    const s = spy();
    const g = new GestureRecogniser(s.sink, { longPressMs: 400 });
    g.down(1, 200, 200, 1000);
    vi.advanceTimersByTime(600);
    g.up(1, 200, 200, 1040);
    g.down(2, 201, 199, 1150);
    vi.advanceTimersByTime(600);
    g.up(2, 201, 199, 1190);
    expect(s.kinds().filter((k) => k === 'double')).toHaveLength(1);
    vi.useRealTimers();
  });

  it('still reports a real hold exactly once', () => {
    vi.useFakeTimers();
    const s = spy();
    const g = new GestureRecogniser(s.sink, { longPressMs: 200 });
    g.down(1, 50, 50, 0);
    vi.advanceTimersByTime(260);
    g.up(1, 50, 50, 900);                   // held for most of a second
    expect(s.kinds()).toEqual(['long']);
    vi.useRealTimers();
  });

  it('reports a hold that the timer never got round to', () => {
    // No timers advanced at all: the page was frozen and then caught up.
    const s = spy();
    const g = new GestureRecogniser(s.sink, { longPressMs: 200 });
    g.down(1, 50, 50, 0);
    g.up(1, 50, 50, 800);
    expect(s.kinds()).toEqual(['long']);
  });
});
