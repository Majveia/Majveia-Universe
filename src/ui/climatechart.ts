/**
 * The climate of one world, as an instrument.
 *
 * Latitude up the side, one whole year across the bottom, and the colour of
 * every point is the temperature the energy balance model settled on there.
 * It is the one plot that shows what a single mean temperature cannot: that a
 * planet's climate is a *field*, and that the field moves.
 *
 * Three things are drawn on top of it, and each is a number that matters:
 *
 *  - **The freezing line.** Where the field crosses 273 K, traced through the
 *    year. On Earth it runs from about 50 degrees in winter to past 70 in
 *    summer, in each hemisphere in turn and half a year apart, and watching
 *    those two curves breathe against each other is watching the seasons.
 *    On a snowball it is gone: the whole panel is below the line.
 *  - **The tropics.** The latitude the Hadley cell reaches, from the planet's
 *    own rotation. The deserts are under it.
 *  - **Now.** Where the planet is in its own orbit, moving as time runs.
 *
 * A tidally locked world has no seasons and no latitudes worth the name, so it
 * gets a different plot: one profile from the point under the star to the point
 * that has never seen it.
 *
 * ---------------------------------------------------------------------------
 * On the colours
 *
 * Temperature here is a *diverging* quantity, not a magnitude, because it has a
 * meaningful zero: the freezing point of water decides everything else on the
 * panel. So the ramp is two hues about a neutral midpoint - cold blue below,
 * warm orange above - and lightness peaks at the middle rather than at one end,
 * which makes the freezing line the brightest thing in the plot without a
 * single pixel being drawn for it.
 *
 * It is deliberately not a rainbow. A rainbow ramp invents boundaries where the
 * data has none, and reads as noise to the eighth of men who cannot separate
 * red from green. Blue against orange survives every common form of colour
 * blindness with room to spare.
 */

import type { Climate } from '../astro/climate';
import { T_FREEZE } from '../astro/radiation';

/** The diverging ramp: cold pole, cold mid, neutral, warm mid, hot pole. */
const RAMP: [number, number, number][] = [
  [0x1d, 0x3f, 0x6e],
  [0x4d, 0x84, 0xbd],
  [0xb9, 0xb4, 0xa8],
  [0xd1, 0x86, 0x3f],
  [0xa3, 0x34, 0x18],
];

/**
 * Colour for a temperature, on a scale that is anchored at freezing rather than
 * stretched over the world's own range. A world that never thaws is entirely
 * blue, and one that never freezes is entirely warm - which is the fact worth
 * seeing, and a per-world normalisation would hide it.
 */
function ramp(tempK: number, span: number): [number, number, number] {
  // -1 at freezing minus a span, 0 at freezing, +1 at freezing plus a span.
  const t = Math.max(-1, Math.min(1, (tempK - T_FREEZE) / Math.max(span, 1)));
  const u = (t + 1) * 0.5 * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(u));
  const f = u - i;
  const a = RAMP[i], b = RAMP[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

const css = (c: [number, number, number]): string => `rgb(${c[0]},${c[1]},${c[2]})`;

export interface ClimateChartOptions {
  width?: number;
  height?: number;
}

export class ClimateChart {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D | null;
  private field: HTMLCanvasElement;
  private w: number;
  private h: number;
  private caption: HTMLDivElement;
  private climate: Climate | null = null;
  private title = '';
  private phase = 0;
  private span = 45;
  private dirty = true;

  constructor(opts: ClimateChartOptions = {}) {
    this.w = opts.width ?? 296;
    this.h = opts.height ?? 226;

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

    // The field is drawn once at its own resolution and scaled up, so the
    // hardware does the interpolation and the model's own grid is never
    // pretending to be finer than it is.
    this.field = document.createElement('canvas');

    this.caption = document.createElement('div');
    this.caption.style.cssText =
      'margin-top:4px;font-size:9px;letter-spacing:.18em;text-transform:uppercase;'
      // The panel above has its own backing; this line sits on whatever the
      // scene happens to be putting behind it, so it carries its own.
      + 'color:rgba(255,255,255,.45);text-shadow:0 1px 3px #000,0 0 6px #000';
    this.el.append(this.canvas, this.caption);
  }

  set(climate: Climate | null, title: string): void {
    this.climate = climate;
    this.title = title;
    if (climate) {
      // The scale runs a fixed distance either side of freezing, wide enough to
      // hold this world's own excursions but never narrower than a range in
      // which a few degrees still reads as a few degrees.
      let far = 30;
      for (let i = 0; i < climate.field.length; i++) {
        far = Math.max(far, Math.abs(climate.field[i] - T_FREEZE));
      }
      this.span = Math.min(far, 320);
      this.renderField();
    }
    this.dirty = true;
  }

  /** Where the planet is in its year, 0 to 1. */
  setPhase(p: number): void {
    const next = ((p % 1) + 1) % 1;
    if (Math.abs(next - this.phase) < 1e-4) return;
    this.phase = next;
    this.dirty = true;
  }

  private renderField(): void {
    const cl = this.climate;
    if (!cl) return;
    const nb = cl.bandCount, ns = cl.seasons;
    // Seasons across, latitude up: the field is stored the other way round, so
    // this transposes as it goes.
    this.field.width = ns;
    this.field.height = nb;
    const fg = this.field.getContext('2d');
    if (!fg) return;
    const img = fg.createImageData(ns, nb);
    for (let b = 0; b < nb; b++) {
      for (let s = 0; s < ns; s++) {
        // Latitude increases up the plot, and canvas rows go down.
        const src = s * nb + (nb - 1 - b);
        const c = ramp(cl.field[src], this.span);
        const k = (b * ns + s) * 4;
        img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
      }
    }
    fg.putImageData(img, 0, 0);
  }

  private plot(): { x: number; y: number; w: number; h: number } {
    return { x: 24, y: 10, w: this.w - 32, h: this.h - 64 };
  }

  draw(): void {
    const g = this.g;
    const cl = this.climate;
    if (!g || !this.dirty) return;
    this.dirty = false;
    g.clearRect(0, 0, this.w, this.h);
    if (!cl) return;
    const p = this.plot();

    // A backing panel. The instrument floats over whatever is on screen, and
    // half of what is on screen is a lit planet - without something behind it
    // the axis labels sit on a moving background and cannot be read.
    g.fillStyle = 'rgba(6,7,9,.72)';
    g.beginPath();
    const r = 4;
    g.roundRect(0.5, 0.5, this.w - 1, this.h - 1, r);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,.07)';
    g.lineWidth = 1;
    g.stroke();

    if (cl.locked) this.drawProfile(g, cl, p);
    else this.drawField(g, cl, p);

    this.drawScale(g, cl);

    const state = cl.state === 'temperate' ? '' : ` · ${cl.state}`;
    this.caption.textContent =
      `${this.title} · ${cl.bandCount}×${cl.seasons} energy balance${state}`;
  }

  /** The seasonal field, for a world that turns. */
  private drawField(
    g: CanvasRenderingContext2D, cl: Climate, p: { x: number; y: number; w: number; h: number },
  ): void {
    g.save();
    g.beginPath();
    g.rect(p.x, p.y, p.w, p.h);
    g.clip();
    g.imageSmoothingEnabled = true;
    // Drawn three times side by side so the year wraps: the smoothing at the
    // seam then blends December into January instead of into the border.
    g.drawImage(this.field, p.x - p.w, p.y, p.w, p.h);
    g.drawImage(this.field, p.x, p.y, p.w, p.h);
    g.drawImage(this.field, p.x + p.w, p.y, p.w, p.h);
    g.restore();

    const yOf = (lat: number): number => p.y + (1 - (lat / (Math.PI / 2) + 1) / 2) * p.h;

    // --- The tropics: the reach of the Hadley cell, and so of the deserts.
    const hadley = cl.circulation.hadleyEdge;
    if (hadley < Math.PI / 2 - 0.02) {
      g.strokeStyle = 'rgba(255,255,255,.20)';
      g.setLineDash([2, 3]);
      g.lineWidth = 1;
      for (const s of [1, -1]) {
        const y = Math.round(yOf(hadley * s)) + 0.5;
        g.beginPath(); g.moveTo(p.x, y); g.lineTo(p.x + p.w, y); g.stroke();
      }
      g.setLineDash([]);
    }

    // --- The freezing line, traced through the year in each hemisphere.
    this.drawFreezingLine(g, cl, p, yOf);

    // --- Latitude ticks.
    g.font = '8px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.fillStyle = 'rgba(255,255,255,.42)';
    g.textAlign = 'right';
    for (const lat of [90, 45, 0, -45, -90]) {
      const y = yOf((lat * Math.PI) / 180);
      g.fillText(`${lat > 0 ? '+' : ''}${lat}`, p.x - 3, Math.min(p.y + p.h, Math.max(p.y + 6, y + 3)));
    }

    // --- Now.
    const nx = p.x + this.phase * p.w;
    g.strokeStyle = 'rgba(232,184,122,.9)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(nx, p.y); g.lineTo(nx, p.y + p.h); g.stroke();

    g.strokeStyle = 'rgba(255,255,255,.16)';
    g.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);

    g.fillStyle = 'rgba(255,255,255,.34)';
    g.textAlign = 'center';
    g.fillText('one orbit', p.x + p.w / 2, p.y + p.h + 10);
  }

  /**
   * Where the field crosses freezing, per season, in each hemisphere.
   *
   * Found by walking in from the pole until the temperature comes up through
   * 273 K and interpolating the crossing, so the line lands between bands
   * rather than snapping to one.
   */
  private drawFreezingLine(
    g: CanvasRenderingContext2D, cl: Climate,
    p: { x: number; y: number; w: number; h: number }, yOf: (lat: number) => number,
  ): void {
    const nb = cl.bandCount, ns = cl.seasons;
    g.lineWidth = 1.4;
    g.strokeStyle = 'rgba(255,255,255,.85)';
    for (const north of [true, false]) {
      let started = false;
      g.beginPath();
      for (let s = 0; s <= ns; s++) {
        const col = s % ns;
        let lat: number | null = null;
        for (let k = 0; k < nb - 1; k++) {
          const i = north ? nb - 1 - k : k;
          const j = north ? i - 1 : i + 1;
          const a = cl.field[col * nb + i], b = cl.field[col * nb + j];
          if (a < T_FREEZE && b >= T_FREEZE) {
            const f = (T_FREEZE - a) / (b - a);
            lat = cl.bands[i].lat + (cl.bands[j].lat - cl.bands[i].lat) * f;
            break;
          }
        }
        if (lat === null) { started = false; continue; }
        const x = p.x + (s / ns) * p.w;
        const y = yOf(lat);
        if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
      }
      g.stroke();
    }
  }

  /** One profile, for a world that keeps the same face to its star. */
  private drawProfile(
    g: CanvasRenderingContext2D, cl: Climate, p: { x: number; y: number; w: number; h: number },
  ): void {
    const nb = cl.bandCount;
    let lo = Infinity, hi = -Infinity;
    for (const b of cl.bands) { lo = Math.min(lo, b.meanK); hi = Math.max(hi, b.meanK); }
    const pad = Math.max(4, (hi - lo) * 0.12);
    lo -= pad; hi += pad;
    const yOf = (t: number): number => p.y + (1 - (t - lo) / Math.max(hi - lo, 1)) * p.h;
    const xOf = (i: number): number => p.x + (i / (nb - 1)) * p.w;

    // Fill under the curve, coloured by the temperature it stands for.
    for (let i = 0; i < nb - 1; i++) {
      const t = 0.5 * (cl.bands[i].meanK + cl.bands[i + 1].meanK);
      g.fillStyle = css(ramp(t, this.span));
      g.globalAlpha = 0.55;
      g.fillRect(xOf(i), yOf(cl.bands[i].meanK), xOf(i + 1) - xOf(i) + 1,
        p.y + p.h - yOf(cl.bands[i].meanK));
      g.globalAlpha = 1;
    }

    // The freezing line, if it crosses this world at all.
    if (T_FREEZE > lo && T_FREEZE < hi) {
      const y = Math.round(yOf(T_FREEZE)) + 0.5;
      g.strokeStyle = 'rgba(255,255,255,.55)';
      g.setLineDash([3, 3]);
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(p.x, y); g.lineTo(p.x + p.w, y); g.stroke();
      g.setLineDash([]);
    }

    g.strokeStyle = 'rgba(255,255,255,.9)';
    g.lineWidth = 1.6;
    g.beginPath();
    for (let i = 0; i < nb; i++) {
      const x = xOf(i), y = yOf(cl.bands[i].meanK);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();

    g.font = '8px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.fillStyle = 'rgba(255,255,255,.42)';
    g.textAlign = 'right';
    g.fillText(`${hi.toFixed(0)}`, p.x - 3, p.y + 7);
    g.fillText(`${lo.toFixed(0)} K`, p.x - 3, p.y + p.h);

    g.strokeStyle = 'rgba(255,255,255,.16)';
    g.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);

    g.textAlign = 'left';
    g.fillStyle = 'rgba(255,255,255,.34)';
    g.fillText('substellar', p.x, p.y + p.h + 10);
    g.textAlign = 'right';
    g.fillText('antistellar', p.x + p.w, p.y + p.h + 10);
  }

  /**
   * The scale, with the freezing point named on it. A heat map has no legend
   * to speak of, so this strip is the only thing that says what the colours
   * mean, and the label is the relief for the dark ends of the ramp having low
   * contrast against a black interface.
   */
  private drawScale(g: CanvasRenderingContext2D, cl: Climate): void {
    const p = this.plot();
    const y = p.y + p.h + 16;
    const x0 = p.x, w = p.w, h = 5;
    for (let i = 0; i < w; i++) {
      const t = T_FREEZE + ((i / (w - 1)) * 2 - 1) * this.span;
      g.fillStyle = css(ramp(t, this.span));
      g.fillRect(x0 + i, y, 1, h);
    }
    g.strokeStyle = 'rgba(255,255,255,.16)';
    g.strokeRect(x0 + 0.5, y + 0.5, w - 1, h - 1);

    // Freezing sits exactly in the middle of the strip by construction.
    const mid = x0 + w / 2;
    g.strokeStyle = 'rgba(255,255,255,.85)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(mid, y - 2); g.lineTo(mid, y + h + 2); g.stroke();

    g.font = '8px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.fillStyle = 'rgba(255,255,255,.42)';
    g.textAlign = 'left';
    g.fillText(`${(T_FREEZE - this.span).toFixed(0)} K`, x0, y + h + 11);
    g.textAlign = 'center';
    g.fillText('0 °C', mid, y + h + 11);
    g.textAlign = 'right';
    g.fillText(`${(T_FREEZE + this.span).toFixed(0)} K`, x0 + w, y + h + 11);
    void cl;
  }
}
