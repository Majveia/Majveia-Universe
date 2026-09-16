/**
 * Where you are, on the only axis all nine scales share.
 *
 * The ladder runs from a nucleus to the observable universe. Each rung tells
 * you its own standoff in its own units - femtometres here, megaparsecs there -
 * and those numbers are correct and completely incomparable: nothing in the
 * interface ever said that the step from a crystal to an atom is one decade
 * and the step from a planet to a star system is five.
 *
 * This is that axis, drawn once and never leaving. Forty-three decades of it,
 * logarithmic because there is no other way to hold that range, with the
 * position marked and a handful of real lengths notched along it for anchors.
 *
 * The anchors are almost all things the simulation already contains: the
 * proton whose radius sets the nuclear scale, the hydrogen atom whose Bohr
 * radius falls out of the wavefunctions, the quartz cell measured at 4.91
 * angstroms, the eye height the surface scale stands you at, the Earth, the
 * Sun, the astronomical unit, the cluster, the baryon acoustic scale frozen
 * into the web at recombination.
 *
 * One of them is not a size but a limit. Green light is 550 nanometres from
 * crest to crest, and nothing smaller than about half of that can be seen with
 * light at all - so the mark sits between the surface and the lattice, and
 * everything to the left of it is a place no eye or microscope will ever look
 * into, however good. Two of the nine rungs are on the wrong side of that
 * line, which is worth knowing while standing on them.
 *
 * ---
 *
 * And then the same axis, read in seconds.
 *
 * Every length here is also a duration - the time light takes to cross it -
 * and because c is one number, turning the ruler from metres into seconds is
 * not a stretch or a shift of anything the eye can see. It is a relabelling.
 * The notches do not move. "A light year" becomes "a year" without going
 * anywhere, which is what a light year is; "an AU" becomes the eight and a
 * third minutes that sunlight is old when it arrives; "green light" becomes
 * one wave of itself.
 *
 * Over the top of that goes the thing the length axis could never show: how
 * long the place you are standing in actually takes to do anything. Every
 * object has two clocks - light across it, and itself across itself - and
 * their ratio is c divided by whatever moves there, so on a logarithmic axis
 * the two marks sit `log10(c/v)` apart and the gap between them is drawn as a
 * bar. It is six decades long standing on a planet and it closes to nothing at
 * the cosmic scale, where what moves is the expansion and it moves at c.
 */

import { formatDistance, formatTime, sig } from './hud';
import { C } from '../core/constants';
import {
  type Clock, DURATIONS, clockGap, lightTime, ownTime,
} from '../physics/clock';

/** The span the strip covers: a tenth of a femtometre to a hundred Gpc. */
export const LO = 1e-16;
export const HI = 1e27;

export interface Landmark {
  /** Size in metres. */
  m: number;
  label: string;
  /** Drawn with a longer notch and always labelled. */
  major?: boolean;
  /**
   * What to call this notch when the axis is read in seconds, where the
   * crossing time has a name better than its own number. Everything without
   * one is simply formatted: 42.5 ms for the Earth, 4.64 s for the Sun.
   */
  crossing?: string;
}

/**
 * Real lengths, for anchors.
 *
 * Sizes are diameters or characteristic extents, not radii, because that is
 * what anybody comparing two things in their head is comparing.
 */
export const LANDMARKS: Landmark[] = [
  { m: 1.68e-15, label: 'proton', major: true },
  { m: 1.06e-10, label: 'hydrogen atom', major: true },
  { m: 4.91e-10, label: 'quartz cell' },
  { m: 5.5e-7, label: 'green light', major: true, crossing: 'one wave' },
  { m: 1.7, label: 'a person', major: true },
  { m: 8.85e3, label: 'Everest' },
  { m: 1.2742e7, label: 'Earth', major: true },
  { m: 1.392e9, label: 'the Sun', major: true },
  { m: 1.496e11, label: 'an AU' },
  { m: 9.461e15, label: 'a light year', major: true, crossing: 'a year' },
  { m: 4.01e16, label: 'nearest star' },
  { m: 9.5e20, label: 'the galaxy', major: true, crossing: '100,000 yr' },
  { m: 3.1e22, label: 'local group' },
  { m: 6.2e22, label: 'a cluster' },
  { m: 4.54e24, label: 'the sound horizon' },
  { m: 8.8e26, label: 'the observable universe', major: true },
];

/** Fraction of the way along the axis a length sits. Clamped at both ends. */
export function positionOf(metres: number): number {
  if (!(metres > 0)) return 0;
  const u = (Math.log10(metres) - Math.log10(LO)) / (Math.log10(HI) - Math.log10(LO));
  return Math.max(0, Math.min(1, u));
}

/**
 * Where a duration sits on that same axis.
 *
 * Not a second ruler: the same one, with the argument multiplied by c. A
 * function rather than a constant offset so that there is exactly one place
 * where the two readings of the axis are tied together, and no way for them to
 * drift apart.
 */
export const positionOfTime = (seconds: number): number => positionOf(seconds * C);

/** The two readings of the axis. */
export type StripMode = 'length' | 'time';

/** How long the labels take to change over, ms. */
const TURN_MS = 420;

/**
 * How visible a name is, partway through the turn.
 *
 * One at both ends and nothing in the middle, so the old word is gone before
 * the new one arrives and the two are never on top of each other.
 */
const duringTurn = (turn: number): number =>
  turn <= 0 || turn >= 1 ? 1 : Math.abs(turn * 2 - 1);

/**
 * Where the clock bar lives, measured down from the top of the strip.
 *
 * Its own lane. The bar is the one thing here that is not on the ruler - it
 * spans two points on it - and putting it through the landmark labels made
 * both unreadable.
 */
const CLOCK_Y = 18.5;

export interface ScaleStripOptions {
  width?: number;
  height?: number;
}

export class ScaleStrip {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D | null;
  private w: number;
  private h: number;
  private at = 1;
  private rung = '';
  private mode: StripMode = 'length';
  /** The clock of whatever rung is running, when it has one. */
  private clock: Clock | null = null;
  /** 0 while showing lengths, 1 while showing times; anything between is the turn. */
  private turn = 0;
  private turning = 0;
  /** Where the turn started, so pressing the key twice quickly does not jump. */
  private turnFrom = 0;
  /** The narrowest and widest this session has actually seen. */
  private lo = Infinity;
  private hi = 0;
  private dirty = true;
  private lastDrawn = -1;

  constructor(opts: ScaleStripOptions = {}) {
    this.w = opts.width ?? 520;
    this.h = opts.height ?? 44;
    this.el = document.createElement('div');
    this.el.className = 'layer dimmable strip';
    this.canvas = document.createElement('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.cssText = `width:${this.w}px;height:${this.h}px;display:block`;
    this.g = this.canvas.getContext('2d');
    this.g?.scale(dpr, dpr);
    this.el.append(this.canvas);
  }

  /** Where the camera is standing, in metres, and which rung it is on. */
  set(metres: number, rung: string): void {
    if (!(metres > 0)) return;
    this.at = metres;
    this.rung = rung;
    if (metres < this.lo) { this.lo = metres; this.dirty = true; }
    if (metres > this.hi) { this.hi = metres; this.dirty = true; }
    // Redraw when the marker would actually move: a fifth of a pixel.
    const x = positionOf(metres) * this.w;
    if (Math.abs(x - this.lastDrawn) > 0.2) { this.dirty = true; this.lastDrawn = x; }
  }

  /**
   * The two clocks of the rung that is running, or null where it has none.
   *
   * Only ever a few numbers, and the stages recompute them freely, so this
   * compares by value: a clock that has not changed must not redraw the strip
   * sixty times a second.
   */
  setClock(k: Clock | null): void {
    const a = this.clock;
    if (a === k) return;
    if (a && k && a.size === k.size && a.speed === k.speed && a.what === k.what) return;
    this.clock = k;
    if (this.mode === 'time') this.dirty = true;
  }

  /** Swap which of the two readings is showing. Returns the new one. */
  cycleMode(): StripMode {
    this.mode = this.mode === 'length' ? 'time' : 'length';
    this.turnFrom = this.turn;
    this.turning = performance.now();
    this.dirty = true;
    return this.mode;
  }

  get reading(): StripMode { return this.mode; }

  /**
   * Whether the strip has any use for a clock this frame.
   *
   * Asking a rung for its clock is cheap but not free - a cluster counts
   * the dispersion of every galaxy in it to answer - and in the reading the
   * strip opens in, the answer is never drawn. True through the turn as
   * well as after it, or the bar would blank halfway out.
   */
  get wantsClock(): boolean { return this.mode === 'time' || this.turn > 0; }

  /** What the current rung's clock says, for the flash line and the readout. */
  clockLine(): string {
    const k = this.clock;
    if (!k) return 'nothing here keeps time';
    const own = formatTime(ownTime(k)).join(' ');
    const gap = clockGap(k);
    if (gap < 1.05) return `${own} · ${k.what}, which moves at c — the two clocks are one`;
    return `${formatTime(lightTime(k)).join(' ')} for light, ${own} for ${k.what}`
      + ` — ${sig(gap, 3)} times longer`;
  }

  resize(width: number): void {
    const w = Math.max(200, Math.round(width));
    if (w === this.w) return;
    this.w = w;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = `${w}px`;
    this.g = this.canvas.getContext('2d');
    this.g?.scale(dpr, dpr);
    this.dirty = true;
  }

  /**
   * The notches, in whichever reading is showing.
   *
   * Length landmarks first and in their own order, because they are the ones
   * that prove the point - they do not move between the two readings, they are
   * only called something else. Durations come after, and the collision
   * suppression downstream drops any that land on a crossing that already says
   * the same thing: a year and a light year are the same notch.
   */
  private notches(): {
    x: number; length: string; time: string; major: boolean; duration: boolean;
  }[] {
    const out = LANDMARKS.map((l) => ({
      x: positionOf(l.m) * this.w,
      length: l.label,
      time: l.crossing ?? formatTime(l.m / C).join(' '),
      major: !!l.major,
      duration: false,
    }));
    if (this.turn > 0) {
      for (const d of DURATIONS) {
        out.push({
          x: positionOfTime(d.s) * this.w,
          length: d.label, time: d.label,
          major: !!d.major, duration: true,
        });
      }
    }
    return out;
  }

  draw(): void {
    const g = this.g;
    // The turn is the one thing that animates, so it is the one thing allowed
    // to keep the strip dirty without anything else having changed.
    if (this.turning) {
      const t = Math.min(1, (performance.now() - this.turning) / TURN_MS);
      const to = this.mode === 'time' ? 1 : 0;
      this.turn = this.turnFrom + (to - this.turnFrom) * t;
      if (t >= 1) { this.turning = 0; this.turn = to; }
      this.dirty = true;
    }
    if (!g || !this.dirty) return;
    this.dirty = false;
    const w = this.w, h = this.h;
    const axisY = h - 8.5;
    g.clearRect(0, 0, w, h);
    g.font = '8px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.textBaseline = 'alphabetic';

    // Its own ground. Everything else in this interface carries a text shadow
    // instead of sitting on a panel, but a one-pixel rule and eight-point type
    // cannot be read over a cosmic web - and this strip is on screen at every
    // scale, including the two brightest. Faded to nothing at both ends so it
    // reads as a shadow rather than as a box.
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.08, 'rgba(0,0,0,.5)');
    grad.addColorStop(0.92, 'rgba(0,0,0,.5)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    // Faded off at the top as well as at the ends, so a band tall enough to
    // hold three lanes still reads as a shadow under the type rather than as a
    // panel the picture stops at.
    const up = g.createLinearGradient(0, 0, 0, h * 0.42);
    up.addColorStop(0, 'rgba(0,0,0,1)');
    up.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = up;
    g.fillRect(0, 0, w, h * 0.42);
    g.globalCompositeOperation = 'source-over';

    // And a shadow under the type as well, for the middle of a bright frame.
    g.shadowColor = 'rgba(0,0,0,.9)';
    g.shadowBlur = 3;

    // The part of the axis this session has actually been to, so the span you
    // have crossed is visible as well as the point you are at.
    if (this.hi > this.lo) {
      const a = positionOf(this.lo) * w, b = positionOf(this.hi) * w;
      g.fillStyle = 'rgba(232,184,122,.16)';
      g.fillRect(a, axisY - 2.5, Math.max(1, b - a), 5);
    }

    // The axis, and a tick every decade. Identical in both readings, on
    // purpose: the ruler does not change when the units do.
    g.strokeStyle = 'rgba(255,255,255,.13)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, axisY + 0.5); g.lineTo(w, axisY + 0.5);
    g.stroke();
    g.beginPath();
    for (let e = Math.ceil(Math.log10(LO)); e <= Math.log10(HI); e++) {
      const x = Math.round(positionOf(10 ** e) * w) + 0.5;
      const tall = e % 5 === 0;
      g.moveTo(x, axisY); g.lineTo(x, axisY + (tall ? 4 : 2));
    }
    g.stroke();

    const here = positionOf(this.at) * w;

    // Landmarks. Every one is notched; the labels have to compete for room, and
    // the majors get first refusal so the frame of reference stays put as you
    // move along it - it would be useless if "Earth" came and went. What is
    // left over goes to whatever is nearest the marker, so the strip says more
    // about wherever you happen to be standing.
    const placed = this.notches();
    const ranked = [
      ...placed.filter((p) => p.major),
      ...placed.filter((p) => !p.major)
        .sort((a, b) => Math.abs(a.x - here) - Math.abs(b.x - here)),
    ];
    const taken: [number, number][] = [];
    g.beginPath();
    for (const { x, major, duration } of ranked) {
      if (duration) continue;
      g.moveTo(Math.round(x) + 0.5, axisY - (major ? 5 : 3));
      g.lineTo(Math.round(x) + 0.5, axisY);
    }
    g.strokeStyle = 'rgba(255,255,255,.22)';
    g.stroke();
    // Durations are a different kind of fact - something that takes this long,
    // rather than something light crosses in this long - so they get their own
    // notch, below the axis and out of the crossings' way.
    if (this.turn > 0) {
      g.beginPath();
      for (const { x, duration } of ranked) {
        if (!duration) continue;
        g.moveTo(Math.round(x) + 0.5, axisY + 1);
        g.lineTo(Math.round(x) + 0.5, axisY + 5);
      }
      g.strokeStyle = `rgba(150,214,255,${0.34 * this.turn})`;
      g.stroke();
    }
    // The words change and the notches do not, which is the whole claim the
    // second reading makes - so the changeover is a dissolve through nothing
    // rather than a crossfade through both at once. Halfway through the turn
    // the ruler is standing there with its ticks and no names on it.
    const swapped = this.turn > 0.5;
    const nameFade = duringTurn(this.turn);
    for (const n of ranked) {
      const { x, duration } = n;
      if (duration && this.turn <= 0.01) continue;
      const label = swapped ? n.time : n.length;
      const tw = g.measureText(label).width;
      const tx = Math.max(3, Math.min(w - tw - 3, x - tw / 2));
      const box: [number, number] = [tx - 5, tx + tw + 5];
      if (taken.some((t) => box[0] < t[1] && t[0] < box[1])) continue;
      taken.push(box);
      const near = Math.abs(x - here) < w * 0.045;
      const fade = nameFade * (duration ? this.turn : 1);
      g.fillStyle = duration
        ? `rgba(150,214,255,${(near ? 0.78 : 0.42) * fade})`
        : near
          ? `rgba(255,236,214,${0.80 * fade})`
          : `rgba(255,255,255,${0.30 * fade})`;
      g.fillText(label, tx, axisY - 7);
    }

    if (this.turn > 0.01) this.drawClock(g);

    // Where you are.
    g.strokeStyle = 'rgba(255,236,214,.95)';
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(Math.round(here) + 0.5, axisY - 9);
    g.lineTo(Math.round(here) + 0.5, axisY + 5);
    g.stroke();
    g.fillStyle = 'rgba(255,236,214,.98)';
    g.beginPath();
    g.arc(Math.round(here) + 0.5, axisY, 2.8, 0, Math.PI * 2);
    g.fill();

    const text = this.turn > 0.5 ? this.timeText() : this.lengthText();
    g.shadowBlur = 4;
    g.font = '9.5px ui-monospace, SFMono-Regular, Menlo, monospace';
    const tw = g.measureText(text).width;
    const tx = Math.max(3, Math.min(w - tw - 3, here - tw / 2));
    g.fillStyle = 'rgba(255,255,255,.92)';
    g.fillText(text, tx, 9.5);
    g.shadowBlur = 0;
  }

  private lengthText(): string {
    const [v, u] = formatDistance(this.at);
    return `${v} ${u}${this.rung ? ` · ${this.rung}` : ''}`;
  }

  /**
   * The same standoff, read as the time light takes to cross it - and then, if
   * the rung keeps time, what its own clock says and by how much it is slower.
   */
  private timeText(): string {
    const [v, u] = formatTime(this.at / C);
    const k = this.clock;
    if (!k) return `${v} ${u} of light${this.rung ? ` · ${this.rung}` : ''}`;
    const gap = clockGap(k);
    const own = formatTime(ownTime(k));
    if (gap < 1.05) {
      return `${v} ${u} of light · ${own.join(' ')} · ${k.what}, at c`;
    }
    return `${v} ${u} of light · ${own.join(' ')} · ${k.what} · ×${sig(gap, 3)}`;
  }

  /**
   * The rung's two clocks, as a bar between them.
   *
   * The bar's length is the only thing it is trying to say. It is
   * `log10(c/v)` decades long and nothing else went into it, so a cluster and
   * a crystal with the same bar really are equally far from the speed of
   * light - and the bar shortening to nothing at the cosmic scale is the
   * expansion reaching c, not a rendering convenience.
   */
  private drawClock(g: CanvasRenderingContext2D): void {
    const k = this.clock;
    if (!k) return;
    const a = positionOfTime(lightTime(k)) * this.w;
    const b = positionOfTime(ownTime(k)) * this.w;
    const y = CLOCK_Y;
    const alpha = this.turn;
    g.save();
    g.lineWidth = 1;
    g.strokeStyle = `rgba(150,214,255,${0.62 * alpha})`;
    g.beginPath();
    g.moveTo(Math.round(a) + 0.5, y); g.lineTo(Math.round(b) + 0.5, y);
    g.stroke();
    // Open at the light end, filled at the object's own: one of these is a
    // floor the thing can never reach and the other is what it actually does.
    // The ring is the larger of the two so that when they coincide - which
    // happens at the cosmic scale, where the expansion moves at c and the two
    // clocks really are one - the pair reads as two marks that have met rather
    // than as a single dot.
    g.beginPath();
    g.arc(Math.round(a) + 0.5, y, 2.8, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = `rgba(174,226,255,${0.92 * alpha})`;
    g.beginPath();
    g.arc(Math.round(b) + 0.5, y, 1.7, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
}
