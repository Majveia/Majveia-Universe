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
 */

import { formatDistance } from './hud';

/** The span the strip covers: a tenth of a femtometre to a hundred Gpc. */
export const LO = 1e-16;
export const HI = 1e27;

export interface Landmark {
  /** Size in metres. */
  m: number;
  label: string;
  /** Drawn with a longer notch and always labelled. */
  major?: boolean;
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
  { m: 5.5e-7, label: 'green light', major: true },
  { m: 1.7, label: 'a person', major: true },
  { m: 8.85e3, label: 'Everest' },
  { m: 1.2742e7, label: 'Earth', major: true },
  { m: 1.392e9, label: 'the Sun', major: true },
  { m: 1.496e11, label: 'an AU' },
  { m: 9.461e15, label: 'a light year', major: true },
  { m: 4.01e16, label: 'nearest star' },
  { m: 9.5e20, label: 'the galaxy', major: true },
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
  /** The narrowest and widest this session has actually seen. */
  private lo = Infinity;
  private hi = 0;
  private dirty = true;
  private lastDrawn = -1;

  constructor(opts: ScaleStripOptions = {}) {
    this.w = opts.width ?? 520;
    this.h = opts.height ?? 34;
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

  draw(): void {
    const g = this.g;
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

    // The axis, and a tick every decade.
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
    const placed = LANDMARKS.map((l) => ({ l, x: positionOf(l.m) * w }));
    const ranked = [
      ...placed.filter((p) => p.l.major),
      ...placed.filter((p) => !p.l.major)
        .sort((a, b) => Math.abs(a.x - here) - Math.abs(b.x - here)),
    ];
    const taken: [number, number][] = [];
    g.beginPath();
    for (const { l, x } of ranked) {
      g.moveTo(Math.round(x) + 0.5, axisY - (l.major ? 5 : 3));
      g.lineTo(Math.round(x) + 0.5, axisY);
    }
    g.strokeStyle = 'rgba(255,255,255,.22)';
    g.stroke();
    for (const { l, x } of ranked) {
      const tw = g.measureText(l.label).width;
      const tx = Math.max(3, Math.min(w - tw - 3, x - tw / 2));
      const box: [number, number] = [tx - 5, tx + tw + 5];
      if (taken.some((t) => box[0] < t[1] && t[0] < box[1])) continue;
      taken.push(box);
      const near = Math.abs(x - here) < w * 0.045;
      g.fillStyle = near ? 'rgba(255,236,214,.80)' : 'rgba(255,255,255,.30)';
      g.fillText(l.label, tx, axisY - 7);
    }

    // Where you are.
    const [v, u] = formatDistance(this.at);
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

    const text = `${v} ${u}${this.rung ? ` · ${this.rung}` : ''}`;
    g.shadowBlur = 4;
    g.font = '9.5px ui-monospace, SFMono-Regular, Menlo, monospace';
    const tw = g.measureText(text).width;
    const tx = Math.max(3, Math.min(w - tw - 3, here - tw / 2));
    g.fillStyle = 'rgba(255,255,255,.92)';
    g.fillText(text, tx, 9.5);
    g.shadowBlur = 0;
  }
}
