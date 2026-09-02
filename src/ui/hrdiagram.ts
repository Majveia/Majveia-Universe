/**
 * The Hertzsprung-Russell diagram of this galaxy's own stars.
 *
 * Temperature runs backwards along the bottom, because Hertzsprung and Russell
 * plotted spectral type and nobody has been willing to break a hundred and
 * twenty years of habit; luminosity runs up the side over ten decades. What
 * makes the diagram the most important plot in astronomy is that stars do not
 * fill it. They lie on a line - the main sequence - and where a star sits on
 * that line is set by one number, its mass.
 *
 * The other features are the same fact seen later. A star leaves the main
 * sequence when its core hydrogen runs out, so the *turnoff* - the point where
 * the sequence stops - is a clock: it reads the age of the population, because
 * everything more massive than the turnoff has already gone. Above and right of
 * it lie the giants, cool and enormous; below and left, the white dwarfs their
 * cores left behind, hot and the size of the Earth.
 *
 * Nothing here is drawn. Every point is a star built from this galaxy's own
 * star formation history and metallicity, aged on its own main-sequence
 * lifetime, and placed by the luminosity and temperature the model gives it.
 * The sequence appears because the physics puts it there.
 *
 * The sampling deserves a word. A true volume-limited draw from an initial mass
 * function is three-quarters M dwarfs and contains one O star in a hundred
 * thousand, so at any plottable number of points the upper main sequence would
 * simply be empty - which is true, and useless. These are sampled evenly in log
 * mass instead, so every part of the sequence is populated, and the *opacity*
 * of each point carries how common that kind of star actually is. The bright
 * end of the diagram is faint for the same reason the sky has few blue giants
 * in it.
 */

import type { Star } from '../astro/stellar';

export interface HRPoint {
  teff: number;
  lum: number;
  color: [number, number, number];
  kind: string;
  /** How common this kind of star is, 0 to 1 on a log scale. */
  weight?: number;
}

export interface HRDiagramOptions {
  width?: number;
  height?: number;
  title?: string;
}

const T_HI = 42000, T_LO = 2200;
const L_HI = 1e6, L_LO = 1e-5;

export class HRDiagram {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D | null;
  private w: number;
  private h: number;
  private points: HRPoint[] = [];
  private marked: HRPoint | null = null;
  private caption: HTMLDivElement;
  private title: string;
  private dirty = true;

  constructor(opts: HRDiagramOptions = {}) {
    this.w = opts.width ?? 268;
    this.h = opts.height ?? 190;
    this.title = opts.title ?? '';

    this.el = document.createElement('div');
    this.el.className = 'layer dimmable';
    this.el.style.cssText =
      'left:50%;top:var(--edge);transform:translateX(-50%);pointer-events:none;text-align:center';

    this.canvas = document.createElement('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.cssText = `width:${this.w}px;height:${this.h}px;display:block`;
    this.g = this.canvas.getContext('2d');
    this.g?.scale(dpr, dpr);

    this.caption = document.createElement('div');
    this.caption.style.cssText =
      'margin-top:4px;font-size:9px;letter-spacing:.18em;text-transform:uppercase;'
      + 'color:rgba(255,255,255,.4)';
    this.el.append(this.canvas, this.caption);
  }

  setPopulation(stars: Star[], weights?: number[]): void {
    this.points = stars.map((s, i) => ({
      teff: s.teff, lum: s.luminosityLsun, color: s.color, kind: s.kind,
      weight: weights?.[i],
    }));
    this.dirty = true;
  }

  /** Put a ring around one star - the one being inspected. */
  mark(s: Star | null): void {
    this.marked = s
      ? { teff: s.teff, lum: s.luminosityLsun, color: s.color, kind: s.kind }
      : null;
    this.dirty = true;
  }

  private x(teff: number): number {
    const t = (Math.log10(T_HI) - Math.log10(Math.max(teff, T_LO)))
      / (Math.log10(T_HI) - Math.log10(T_LO));
    return 6 + t * (this.w - 12);
  }

  private y(lum: number): number {
    const u = (Math.log10(Math.max(lum, L_LO)) - Math.log10(L_LO))
      / (Math.log10(L_HI) - Math.log10(L_LO));
    return this.h - 14 - u * (this.h - 26);
  }

  draw(): void {
    const g = this.g;
    if (!g || !this.dirty) return;
    this.dirty = false;
    const w = this.w, h = this.h;
    g.clearRect(0, 0, w, h);

    // Frame and decade grid.
    g.strokeStyle = 'rgba(255,255,255,.09)';
    g.lineWidth = 1;
    for (let e = -4; e <= 6; e += 2) {
      const y = Math.round(this.y(10 ** e)) + 0.5;
      g.beginPath(); g.moveTo(6, y); g.lineTo(w - 6, y); g.stroke();
    }
    g.font = '8px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.fillStyle = 'rgba(255,255,255,.30)';
    g.textAlign = 'left';
    for (const [t, label] of [[30000, 'O'], [10000, 'A'], [5800, 'G'], [3200, 'M']] as [number, string][]) {
      const x = this.x(t);
      g.fillText(label, x - 2, h - 4);
      g.strokeStyle = 'rgba(255,255,255,.06)';
      g.beginPath(); g.moveTo(x, 6); g.lineTo(x, h - 14); g.stroke();
    }

    for (const p of this.points) {
      const x = this.x(p.teff), y = this.y(p.lum);
      if (x < 0 || x > w || y < 0 || y > h) continue;
      const [r, gr, b] = p.color;
      // Giants get a slightly larger mark: they are rare, and a single pixel
      // in the top right is the whole red-giant branch.
      const size = p.kind === 'main-sequence' ? 1.1 : 1.7;
      const a = 0.16 + 0.62 * (p.weight ?? 1);
      g.fillStyle = `rgba(${Math.round(Math.min(1, r) * 255)},`
        + `${Math.round(Math.min(1, gr) * 255)},${Math.round(Math.min(1, b) * 255)},${a.toFixed(3)})`;
      g.beginPath();
      g.arc(x, y, size, 0, Math.PI * 2);
      g.fill();
    }

    if (this.marked) {
      const x = this.x(this.marked.teff), y = this.y(this.marked.lum);
      g.strokeStyle = 'rgba(232,184,122,.95)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(x, y, 4.5, 0, Math.PI * 2);
      g.stroke();
    }

    g.strokeStyle = 'rgba(255,255,255,.14)';
    g.lineWidth = 1;
    g.strokeRect(5.5, 5.5, w - 11, h - 19);

    const giants = this.points.filter((p) => p.kind === 'giant' || p.kind === 'supergiant').length;
    const wd = this.points.filter((p) => p.kind === 'white-dwarf').length;
    this.caption.textContent =
      `${this.title} · ${giants} giants · ${wd} white dwarfs`;
  }
}
