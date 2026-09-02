/**
 * The strain trace: h(t) as a detector would record it.
 *
 * This is the picture that was on every front page in February 2016 - a
 * quarter-second of wiggle rising in frequency and amplitude and then stopping.
 * Drawn here from the same waveform the field visualisation uses, so the trace
 * and the ripples cannot disagree.
 *
 * The window slides with the source and is measured in cycles rather than in
 * seconds, because a fixed window in time shows a lazy sine early on and a
 * solid block of ink at the end. Keeping a fixed number of cycles on screen is
 * what makes the chirp legible: the wave looks the same throughout and it is
 * the *time axis* that compresses.
 */

import { binaryState, type Binary } from '../physics/gwaves';

export interface StrainTraceOptions {
  binary: Binary;
  width?: number;
  height?: number;
  /** How many wave cycles to keep on screen. */
  cycles?: number;
}

export class StrainTrace {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D | null;
  private w: number;
  private h: number;
  private binary: Binary;
  private cycles: number;
  private label: HTMLDivElement;

  constructor(opts: StrainTraceOptions) {
    this.binary = opts.binary;
    this.w = opts.width ?? 300;
    this.h = opts.height ?? 74;
    this.cycles = opts.cycles ?? 14;

    this.el = document.createElement('div');
    this.el.className = 'layer dimmable';
    this.el.style.cssText =
      'left:50%;bottom:calc(var(--edge) + 26px);transform:translateX(-50%);'
      + 'pointer-events:none;text-align:center';

    this.canvas = document.createElement('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.cssText = `width:${this.w}px;height:${this.h}px;display:block`;
    this.g = this.canvas.getContext('2d');
    this.g?.scale(dpr, dpr);

    this.label = document.createElement('div');
    this.label.style.cssText =
      'margin-top:4px;font-size:9px;letter-spacing:.2em;text-transform:uppercase;'
      + 'color:rgba(255,255,255,.42)';
    this.el.append(this.canvas, this.label);
  }

  /** @param t time relative to coalescence, seconds */
  update(t: number): void {
    const g = this.g;
    if (!g) return;
    const w = this.w, h = this.h, mid = h * 0.52;
    g.clearRect(0, 0, w, h);

    const now = binaryState(this.binary, t);
    const f = Math.max(now.freqHz, 1);
    const span = Math.min(Math.max(this.cycles / f, 0.02), 6);
    const t0 = t - span;

    // Amplitude scale from the loudest sample in the window, so the trace fills
    // the box at every stage instead of being a flat line for the first ten
    // seconds and clipping in the last tenth.
    const n = Math.max(120, Math.round(w * 1.6));
    const hs = new Float64Array(n);
    let peak = 1e-30;
    for (let i = 0; i < n; i++) {
      const tt = t0 + (span * i) / (n - 1);
      const s = binaryState(this.binary, tt);
      hs[i] = s.hPlus;
      const a = Math.abs(s.hPlus);
      if (a > peak) peak = a;
    }

    g.strokeStyle = 'rgba(255,255,255,.10)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, mid + 0.5);
    g.lineTo(w, mid + 0.5);
    g.stroke();

    // Mark the moment of coalescence if it is inside the window.
    if (t0 < 0 && t > 0) {
      const x = ((0 - t0) / span) * w;
      g.strokeStyle = 'rgba(232,184,122,.45)';
      g.setLineDash([2, 3]);
      g.beginPath();
      g.moveTo(x, 4);
      g.lineTo(x, h - 4);
      g.stroke();
      g.setLineDash([]);
    }

    g.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * w;
      const y = mid - (hs[i] / peak) * (h * 0.40);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.strokeStyle = now.stage === 'ringdown' ? 'rgba(232,184,122,.92)'
      : now.stage === 'merger' ? 'rgba(255,236,214,.95)' : 'rgba(180,206,246,.86)';
    g.lineWidth = 1.2;
    g.stroke();

    const ms = (span * 1e3).toFixed(span < 0.2 ? 1 : 0);
    this.label.textContent =
      `strain · ${now.freqHz.toFixed(0)} Hz · h ${now.strain.toExponential(1)} · ${ms} ms shown`;
  }
}
