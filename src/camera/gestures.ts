/**
 * Touch gesture recognition.
 *
 * Deliberately free of the DOM: this takes numbered pointers going down, moving
 * and coming up, and emits intentions. That separation is not tidiness for its
 * own sake - a gesture recogniser is a state machine with a dozen edges and
 * almost all of the bugs live in the edges, so it wants to be tested by driving
 * it directly rather than by pretending to be a finger in a browser.
 *
 * What it recognises, and why each one is here:
 *
 *  - **One finger: orbit**, with a slop radius first, so that a tap that
 *    wobbles by three pixels is still a tap and does not spin the sky.
 *  - **A flick**, handed on as a velocity. Nothing in a physical world stops
 *    dead when you let go of it, and a camera that does feels broken in a way
 *    people notice without being able to say why.
 *  - **Two fingers: pinch, pan and twist, at once.** They are not modes. Real
 *    hands do all three in one motion and choosing one of them for the user is
 *    the single most common way touch interaction is got wrong. The pinch is
 *    reported as an incremental ratio and a centroid, so the camera can hold
 *    the point *between the fingers* still - which is what makes zooming feel
 *    like moving a thing rather than operating a slider.
 *  - **Double tap**, to go in. **Two-finger tap**, to come back out; that
 *    pairing is borrowed from every map application there has ever been.
 *  - **Long press**, to inspect - a deliberate act, distinct from a tap.
 *
 * The awkward edge, and the reason this is a state machine at all: when one of
 * two fingers lifts, the remaining one must not be treated as having jumped
 * from the centroid to where it actually is. Its position is rebased instead,
 * so a two-finger pinch that relaxes into a one-finger drag does not snap.
 */

export interface GestureSink {
  /** A one-finger drag, in pixels since the last event. */
  orbitBy(dx: number, dy: number): void;
  /** A two-finger drag of the centroid, in pixels. */
  panBy(dx: number, dy: number): void;
  /**
   * A pinch, as the ratio by which the finger separation changed, and where
   * the fingers are. A ratio below one means they are spreading apart.
   */
  pinchBy(ratio: number, cx: number, cy: number): void;
  /** A two-finger twist, radians, positive counter-clockwise on screen. */
  twistBy(radians: number): void;
  /** A flick, in pixels per second, at the moment of release. */
  fling(vx: number, vy: number): void;
  tap(x: number, y: number): void;
  doubleTap(x: number, y: number): void;
  twoFingerTap(): void;
  longPress(x: number, y: number): void;
  /** Any contact at all: used to wake the interface and kill inertia. */
  touched(): void;
}

export interface GestureOptions {
  /** How far a finger may wander and still be a tap, pixels. */
  slop?: number;
  /** How long a press must be still to be a long press, ms. */
  longPressMs?: number;
  /** The window in which a second tap counts as a double, ms. */
  doubleTapMs?: number;
  /** How far apart two taps may be and still be a double, pixels. */
  doubleTapSlop?: number;
  /** A tap must be released within this, ms. */
  tapMs?: number;
  /** Below this speed a release is a stop, not a flick, px/s. */
  flingMin?: number;
  /** Wall clock, for the hold timer. Injectable so it can be tested. */
  now?: () => number;
}

interface Contact {
  x: number; y: number;
  x0: number; y0: number;
  t0: number;
  /** Velocity estimate, px/s, exponentially smoothed. */
  vx: number; vy: number;
  tv: number;
  moved: boolean;
  /** Whether the hold notification has already gone out for this contact. */
  longFired: boolean;
}

type Phase = 'idle' | 'press' | 'orbit' | 'multi';

const DEFAULTS: Required<GestureOptions> = {
  slop: 9,
  longPressMs: 480,
  doubleTapMs: 320,
  doubleTapSlop: 36,
  tapMs: 420,
  flingMin: 90,
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
};

export class GestureRecogniser {
  private opts: Required<GestureOptions>;
  private pts = new Map<number, Contact>();
  private phase: Phase = 'idle';
  private longTimer: ReturnType<typeof setTimeout> | null = null;
  /** Last two-finger geometry, for incremental deltas. */
  private lastDist = 0;
  private lastAngle = 0;
  private lastCx = 0;
  private lastCy = 0;
  /** When the second finger went down, and whether the pair has moved. */
  private multiT0 = 0;
  private multiMoved = false;
  /**
   * When the first of two still fingers lifted. Fingers never leave the glass
   * together, so a two-finger tap arrives as two separate releases a few
   * milliseconds apart and has to be held open across the gap.
   */
  private twoUpAt = -1e9;
  /**
   * The previous tap, for double-tap detection. Initialised far in the past,
   * because a page's first tap arrives a few hundred milliseconds after its
   * clock starts and zero would be inside the double-tap window of it.
   */
  private tapT = -1e9;
  private tapX = 0;
  private tapY = 0;
  /**
   * A tap that has happened but has not been reported yet, because it might
   * still turn out to be the first half of a double.
   */
  private pendingTap: { x: number; y: number } | null = null;
  private tapTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private out: GestureSink, opts: GestureOptions = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  get count(): number { return this.pts.size; }
  get active(): boolean { return this.pts.size > 0; }

  down(id: number, x: number, y: number, t: number): void {
    this.out.touched();
    // A pointer id that is already down means its release was never delivered.
    // Take the new contact as the truth rather than carrying a phantom finger,
    // which would otherwise poison every gesture from here on.
    if (this.pts.has(id)) this.pts.delete(id);
    this.pts.set(id, {
      x, y, x0: x, y0: y, t0: t, vx: 0, vy: 0, tv: t, moved: false, longFired: false,
    });
    this.twoUpAt = -1e9;
    this.clearLongPress();
    if (this.pts.size === 1) {
      this.phase = 'press';
      // The timer is a notification, not a decision.
      //
      // It runs on wall time, and wall time lies. If the main thread is busy
      // for half a second - which it is, on a phone, whenever a new scale is
      // being built - a fifty-millisecond tap has its release sitting in the
      // queue when this fires, and the gesture would be misread as a hold.
      // Every actual decision below is taken from the timestamps the events
      // themselves carry, which are truthful about when the finger moved; this
      // only exists so that a genuine hold feels immediate instead of waiting
      // for the finger to lift.
      const due = this.opts.now() + this.opts.longPressMs;
      this.longTimer = setTimeout(() => {
        this.longTimer = null;
        const c = this.pts.get(id);
        if (!c || c.moved || this.pts.size !== 1) return;
        // A timer that fires late is itself the evidence that the thread was
        // blocked, and a blocked thread means the release may already be in
        // the queue behind it. When that has happened the notification is
        // withheld and the decision is left to `up`, where the event
        // timestamps can settle it properly. Being a little slow to show a
        // hold is nothing; announcing one that never happened is a panel
        // opening under a finger that was only tapping.
        if (this.opts.now() - due > this.opts.longPressMs * 0.5) return;
        c.longFired = true;
        this.out.longPress(c.x, c.y);
      }, this.opts.longPressMs);
    } else if (this.pts.size >= 2) {
      this.phase = 'multi';
      this.multiT0 = t;
      this.multiMoved = false;
      this.rebaseMulti();
    }
  }

  move(id: number, x: number, y: number, t: number): void {
    const c = this.pts.get(id);
    if (!c) return;
    const dx = x - c.x;
    const dy = y - c.y;
    // Velocity is smoothed rather than differenced: one slow frame at the end
    // of a flick would otherwise report a stationary finger and eat the flick.
    const dt = Math.max(t - c.tv, 1) / 1000;
    const inst = { x: dx / dt, y: dy / dt };
    const a = 0.42;
    c.vx = c.vx * (1 - a) + inst.x * a;
    c.vy = c.vy * (1 - a) + inst.y * a;
    c.tv = t;
    c.x = x; c.y = y;
    if (!c.moved && Math.hypot(x - c.x0, y - c.y0) > this.opts.slop) {
      c.moved = true;
      this.clearLongPress();
      if (this.phase === 'press') this.phase = 'orbit';
    }

    if (this.phase === 'multi' && this.pts.size >= 2) {
      const g = this.geometry();
      if (!g) return;
      if (this.lastDist > 0) {
        const ratio = this.lastDist / g.dist;
        if (Math.abs(Math.log(ratio)) > 1e-6) this.out.pinchBy(ratio, g.cx, g.cy);
        // Wrap the angle: two fingers crossing the branch cut would otherwise
        // whip the camera a full turn.
        let da = g.angle - this.lastAngle;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        if (Math.abs(da) > 1e-5) this.out.twistBy(da);
        const pdx = g.cx - this.lastCx;
        const pdy = g.cy - this.lastCy;
        if (pdx !== 0 || pdy !== 0) this.out.panBy(pdx, pdy);
        if (Math.abs(pdx) + Math.abs(pdy) > 2 || Math.abs(Math.log(ratio)) > 0.005) {
          this.multiMoved = true;
        }
      }
      this.lastDist = g.dist;
      this.lastAngle = g.angle;
      this.lastCx = g.cx;
      this.lastCy = g.cy;
      return;
    }

    if (this.phase === 'orbit' && (dx !== 0 || dy !== 0)) {
      this.twoUpAt = -1e9;
      this.out.orbitBy(dx, dy);
    }
  }

  up(id: number, x: number, y: number, t: number): void {
    const c = this.pts.get(id);
    if (!c) return;
    c.x = x; c.y = y;
    this.pts.delete(id);
    this.clearLongPress();

    if (this.phase === 'multi') {
      // Both fingers up together, quickly, having gone nowhere: that is the
      // two-finger tap, and it means back.
      const still = !this.multiMoved && t - this.multiT0 < this.opts.tapMs;
      if (this.pts.size === 0) {
        if (still) this.out.twoFingerTap();
        this.phase = 'idle';
        return;
      }
      if (still) this.twoUpAt = t;
      // One finger left. Rebase it where it is so the drag continues from
      // there instead of leaping from the centroid.
      const rest = [...this.pts.values()][0];
      rest.x0 = rest.x; rest.y0 = rest.y;
      rest.vx = 0; rest.vy = 0; rest.tv = t;
      rest.moved = true;
      this.phase = 'orbit';
      this.lastDist = 0;
      return;
    }

    if (this.pts.size > 0) return;

    // The second half of a two-finger tap: the pair was still, one finger has
    // already gone, and this one follows within a few frames.
    if (t - this.twoUpAt < 180) {
      this.twoUpAt = -1e9;
      this.phase = 'idle';
      this.out.twoFingerTap();
      return;
    }

    const held = t - c.t0;
    const still = Math.hypot(x - c.x0, y - c.y0) <= this.opts.slop;
    if (this.phase === 'orbit') {
      const sp = Math.hypot(c.vx, c.vy);
      if (sp > this.opts.flingMin) this.out.fling(c.vx, c.vy);
    } else if (still && !c.moved && held >= this.opts.longPressMs) {
      // It really was held. If the timer never got a turn, say so now.
      if (!c.longFired) this.out.longPress(x, y);
    } else if (still && held < this.opts.tapMs && !c.moved) {
      if (t - this.tapT < this.opts.doubleTapMs
        && Math.hypot(x - this.tapX, y - this.tapY) < this.opts.doubleTapSlop) {
        // Far in the past, not at zero: a third tap a quarter of a second
        // later must be a tap again, and zero is within the double-tap window
        // of every timestamp a page produces in its first few seconds.
        this.tapT = -1e9;
        this.cancelPendingTap();
        this.out.doubleTap(x, y);
      } else {
        // A tap and a double tap are the same gesture until the window closes,
        // so the single one waits.
        //
        // Reporting it immediately and then reporting the double as well is
        // the cause of an entire family of bugs, and of one here in
        // particular: the single tap opened a panel, the panel appeared under
        // the finger, and the second tap of the pair landed on the panel and
        // never reached the scene. Descending - the one verb on a phone with
        // no keyboard behind it - simply stopped working at some scales and
        // not others, depending on where the panel happened to be.
        // A tap somewhere else, while one is still waiting out its window, is
        // two taps and not one: report the first before taking the second.
        this.flushPendingTap();
        this.tapT = t; this.tapX = x; this.tapY = y;
        this.pendingTap = { x, y };
        this.tapTimer = setTimeout(() => {
          this.tapTimer = null;
          const p = this.pendingTap;
          this.pendingTap = null;
          if (p) this.out.tap(p.x, p.y);
        }, this.opts.doubleTapMs + 30);
      }
    }
    this.phase = 'idle';
  }

  cancel(id: number): void {
    this.pts.delete(id);
    this.clearLongPress();
    if (this.pts.size === 0) this.phase = 'idle';
    else if (this.pts.size === 1) { this.phase = 'orbit'; this.lastDist = 0; }
  }

  /** Drop everything: used when the window loses the pointer entirely. */
  reset(): void {
    this.pts.clear();
    this.clearLongPress();
    this.cancelPendingTap();
    this.phase = 'idle';
    this.lastDist = 0;
    this.twoUpAt = -1e9;
    this.tapT = -1e9;
  }

  private cancelTapTimer(): void {
    if (this.tapTimer !== null) { clearTimeout(this.tapTimer); this.tapTimer = null; }
  }

  private cancelPendingTap(): void {
    this.cancelTapTimer();
    this.pendingTap = null;
  }

  /** Report a waiting tap now, rather than losing it. */
  private flushPendingTap(): void {
    this.cancelTapTimer();
    const p = this.pendingTap;
    this.pendingTap = null;
    if (p) this.out.tap(p.x, p.y);
  }

  private geometry(): { dist: number; angle: number; cx: number; cy: number } | null {
    const [a, b] = [...this.pts.values()];
    if (!a || !b) return null;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return {
      dist: Math.max(Math.hypot(dx, dy), 1),
      // Negated because screen y runs downward and the camera's azimuth does not.
      angle: -Math.atan2(dy, dx),
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
    };
  }

  private rebaseMulti(): void {
    const g = this.geometry();
    if (!g) return;
    this.lastDist = g.dist;
    this.lastAngle = g.angle;
    this.lastCx = g.cx;
    this.lastCy = g.cy;
  }

  private clearLongPress(): void {
    if (this.longTimer !== null) { clearTimeout(this.longTimer); this.longTimer = null; }
  }
}

/**
 * Resistance past a limit, the way a scroll view behaves when it runs out of
 * content: the further past the edge you are, the less each pixel of finger
 * moves the thing. Without it a limit is a wall; with it the limit is felt
 * before it is hit, and nothing ever appears to be stuck.
 */
export function rubberBand(over: number, stiffness = 14): number {
  return 1 / (1 + Math.max(over, 0) * stiffness);
}

/**
 * Where the orbit target must move so that the world point under the fingers
 * stays under the fingers while the camera distance is scaled.
 *
 * On the plane through the focus this is exact, and off it the error is
 * proportional to how far the point is from that plane - which is what every
 * map and every 3D viewer does, because the alternative needs a depth buffer
 * read on every touch move.
 *
 * @param ox     pinch centre, pixels right of the viewport centre
 * @param oy     pinch centre, pixels below the viewport centre
 * @param ratio  the factor the orbit radius is being multiplied by
 * @param worldPerPixel  the scale at the focus plane before the change
 * @returns how far to move the focus along the camera's right and up axes
 */
export function pinchAnchor(
  ox: number, oy: number, ratio: number, worldPerPixel: number,
): { right: number; up: number } {
  const s = worldPerPixel * (1 - ratio);
  return { right: ox * s, up: -oy * s };
}
