/**
 * The binding energy curve.
 *
 * The most consequential graph in physics, and the one this whole ladder
 * resolves into. Along the bottom, how many nucleons a nucleus has. Up the
 * side, how much energy per nucleon it took to assemble it. The line climbs
 * steeply out of hydrogen, flattens, peaks a little past iron, and then falls
 * away slowly for ever.
 *
 * Everything is downhill on this curve, and downhill means outward:
 *
 *  - **To the left of the peak, joining things up releases energy.** That is
 *    what a star is - four hydrogen to one helium is the steepest step on the
 *    whole graph and it has kept the sun going for four and a half billion
 *    years. Every element under your feet was made by walking up this slope
 *    inside something.
 *  - **At the peak, nothing works.** A star that has made iron can get no
 *    further: fusing it costs energy rather than giving it. The core stops
 *    holding itself up and falls in, in about a second, and that is a
 *    supernova - which is how all of this got out of the star and into the
 *    ground you were standing on eight rungs ago.
 *  - **To the right, breaking things up releases energy.** Uranium into two
 *    halves gives back about 185 million electronvolts, which is a hundred
 *    million times what burning an atom of coal gives, and is why the
 *    twentieth century went the way it did.
 */

import { bindingPerNucleon, bindingPeak, stableZ } from '../physics/nucleus';

export interface BindingCurveOptions {
  width?: number;
  height?: number;
}

const A_HI = 250;
const B_HI = 9.6;

export class BindingCurve {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D | null;
  private w: number;
  private h: number;
  private mark: { a: number; z: number; label: string } | null = null;
  private caption: HTMLDivElement;
  private dirty = true;

  constructor(opts: BindingCurveOptions = {}) {
    this.w = opts.width ?? 348;
    this.h = opts.height ?? 196;

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
    this.caption.textContent = 'binding energy per nucleon';
    this.el.append(this.canvas, this.caption);
  }

  setNucleus(a: number, z: number, label: string): void {
    if (this.mark && this.mark.a === a && this.mark.z === z) return;
    this.mark = { a, z, label };
    this.dirty = true;
  }

  private x(a: number): number { return 24 + (a / A_HI) * (this.w - 34); }
  private y(b: number): number { return this.h - 22 - (b / B_HI) * (this.h - 34); }

  draw(): void {
    const g = this.g;
    if (!g || !this.dirty) return;
    this.dirty = false;
    const w = this.w, h = this.h;
    g.clearRect(0, 0, w, h);
    g.font = '8px ui-monospace, SFMono-Regular, Menlo, monospace';

    // Its own ground, because a one-pixel line cannot carry a shadow.
    g.fillStyle = 'rgba(0,0,0,.5)';
    g.fillRect(23.5, 9.5, w - 33, h - 30);

    // Axes.
    g.strokeStyle = 'rgba(255,255,255,.14)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(23.5, 9.5); g.lineTo(23.5, h - 21.5); g.lineTo(w - 9.5, h - 21.5);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,.32)';
    g.textAlign = 'right';
    for (const b of [2, 4, 6, 8]) {
      g.fillText(String(b), 21, this.y(b) + 3);
      g.strokeStyle = 'rgba(255,255,255,.06)';
      g.beginPath(); g.moveTo(23.5, this.y(b)); g.lineTo(w - 10, this.y(b)); g.stroke();
    }
    g.textAlign = 'center';
    for (const a of [50, 100, 150, 200]) g.fillText(String(a), this.x(a), h - 11);
    g.textAlign = 'left';
    g.fillText('MeV', 4, 16);
    g.textAlign = 'right';
    g.fillText('nucleons', w - 10, h - 3);

    const peak = bindingPeak();

    // The curve, along the floor of the valley of stability - the nuclei that
    // actually exist rather than every combination that could be written down.
    g.beginPath();
    for (let a = 2; a <= A_HI; a++) {
      const z = Math.round(stableZ(a));
      const b = bindingPerNucleon(z, a);
      const px = this.x(a), py = this.y(Math.max(0, b));
      if (a === 2) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.strokeStyle = 'rgba(255,236,214,.85)';
    g.lineWidth = 1.3;
    g.stroke();

    // The peak, and what it means on each side of it.
    g.strokeStyle = 'rgba(232,184,122,.45)';
    g.setLineDash([2, 3]);
    g.beginPath();
    g.moveTo(this.x(peak.a), this.y(peak.perNucleon));
    g.lineTo(this.x(peak.a), h - 21.5);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(232,184,122,.75)';
    g.textAlign = 'left';
    g.fillText('iron', this.x(peak.a) + 3, this.y(peak.perNucleon) - 4);

    g.fillStyle = 'rgba(255,255,255,.30)';
    g.textAlign = 'center';
    g.fillText('fusion ⟶', this.x(peak.a) * 0.62, h - 32);
    g.fillText('⟵ fission', (this.x(peak.a) + w) / 2 + 8, h - 32);

    // Where this particular nucleus sits.
    if (this.mark) {
      const b = bindingPerNucleon(this.mark.z, this.mark.a);
      const px = this.x(this.mark.a), py = this.y(b);
      g.strokeStyle = 'rgba(255,255,255,.9)';
      g.lineWidth = 1.2;
      g.beginPath(); g.arc(px, py, 4.5, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(255,255,255,.92)';
      g.textAlign = this.mark.a > A_HI * 0.6 ? 'right' : 'left';
      const dx = this.mark.a > A_HI * 0.6 ? -7 : 7;
      g.fillText(this.mark.label, px + dx, py + 3);
    }
  }
}
