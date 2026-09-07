/**
 * The period-period-derivative diagram.
 *
 * This is the neutron star's Hertzsprung-Russell diagram, and it has the same
 * two properties that made that one worth inventing: the objects do not fill
 * it, and where one sits on it says what it is and how it got there.
 *
 * Along the bottom, how long the star takes to turn once, from a millisecond to
 * ten seconds. Up the side, how much longer each turn is than the one before -
 * fourteen orders of magnitude of it. Because both axes are logarithmic and the
 * physics is a power law, everything worth knowing is a straight line:
 *
 *  - **Constant magnetic field** runs down and to the right at slope minus one,
 *    because P times Pdot is proportional to B squared. Reading a pulsar's
 *    field off this plot is the only way anybody knows one.
 *  - **Constant age** runs up and to the right at slope plus one, because the
 *    characteristic age is P over twice Pdot.
 *  - **The death line** runs at slope plus three. Below it the field above the
 *    polar cap can no longer make electron-positron pairs, the cascade stops,
 *    and the star goes dark. Pulsars drift down and to the right all their
 *    lives, and every one of them ends up crossing it.
 *
 * The population arrives in two clumps with a gulf between. That gulf is not
 * something the surveys have failed to look into. It is a fossil of there being
 * two ways to make a pulsar: collapse, which gives the clump at the top right,
 * and collapse followed by a hundred million years of having material dumped on
 * you by a companion, which spins the star back up to milliseconds and buries
 * its field, and gives the clump at the bottom left. Nothing is in between
 * because nothing spends any time there.
 */

import {
  BRAKING, DEATH_LINE, characteristicAgeYears, classify, type Pulsar,
} from '../astro/pulsar';

const P_LO = 8e-4, P_HI = 30;
const D_LO = 1e-22, D_HI = 1e-9;

export interface PPDotOptions {
  width?: number;
  height?: number;
  title?: string;
}

const COLOURS: Record<string, string> = {
  young: 'rgba(255,236,214,',
  normal: 'rgba(150,186,236,',
  millisecond: 'rgba(122,232,196,',
  magnetar: 'rgba(255,138,110,',
  dead: 'rgba(255,255,255,',
};

export class PPDotDiagram {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D | null;
  private w: number;
  private h: number;
  private pop: Pulsar[] = [];
  private marked: Pulsar | null = null;
  private track: { p: number; pdot: number }[] = [];
  private caption: HTMLDivElement;
  private title: string;
  private dirty = true;

  constructor(opts: PPDotOptions = {}) {
    this.w = opts.width ?? 280;
    this.h = opts.height ?? 200;
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

  setPopulation(pop: Pulsar[]): void { this.pop = pop; this.dirty = true; }

  /** Ring one of them: the star currently being looked at. */
  mark(p: Pulsar | null): void { this.marked = p; this.dirty = true; }

  /** Where one star has been, as it slows. */
  setTrack(points: { p: number; pdot: number }[]): void {
    this.track = points;
    this.dirty = true;
  }

  private x(period: number): number {
    const u = (Math.log10(Math.max(period, P_LO)) - Math.log10(P_LO))
      / (Math.log10(P_HI) - Math.log10(P_LO));
    return 26 + u * (this.w - 34);
  }

  private y(pdot: number): number {
    const u = (Math.log10(Math.max(pdot, D_LO)) - Math.log10(D_LO))
      / (Math.log10(D_HI) - Math.log10(D_LO));
    return this.h - 20 - u * (this.h - 32);
  }

  draw(): void {
    const g = this.g;
    if (!g || !this.dirty) return;
    this.dirty = false;
    const w = this.w, h = this.h;
    g.clearRect(0, 0, w, h);
    g.font = '8px ui-monospace, SFMono-Regular, Menlo, monospace';

    // A plot has to be read against whatever is behind it, and behind it here
    // may be a beam. Everything else in this interface carries its own shadow
    // instead of sitting on a panel, but a scatter of one-pixel dots cannot.
    g.fillStyle = 'rgba(0,0,0,.46)';
    g.fillRect(25.5, 9.5, w - 33, h - 29);

    const clipped = (fn: () => void) => {
      g.save();
      g.beginPath();
      g.rect(26, 10, w - 34, h - 30);
      g.clip();
      fn();
      g.restore();
    };

    // --- Lines of constant magnetic field: Pdot = K B^2 / P.
    clipped(() => {
      g.strokeStyle = 'rgba(122,168,232,.16)';
      g.lineWidth = 1;
      for (const logB of [9, 10, 11, 12, 13, 14]) {
        const b = 10 ** logB;
        g.beginPath();
        g.moveTo(this.x(P_LO), this.y((BRAKING * b * b) / P_LO));
        g.lineTo(this.x(P_HI), this.y((BRAKING * b * b) / P_HI));
        g.stroke();
      }
    });

    // --- Lines of constant characteristic age: Pdot = P / 2 tau.
    clipped(() => {
      g.strokeStyle = 'rgba(232,184,122,.13)';
      for (const logT of [3, 5, 7, 9]) {
        const tau = 10 ** logT * 3.15576e7;
        g.beginPath();
        g.moveTo(this.x(P_LO), this.y(P_LO / (2 * tau)));
        g.lineTo(this.x(P_HI), this.y(P_HI / (2 * tau)));
        g.stroke();
      }
    });

    // --- The death line: B = DEATH_LINE P^2, so Pdot = K DEATH^2 P^3.
    clipped(() => {
      g.strokeStyle = 'rgba(255,110,90,.5)';
      g.lineWidth = 1.2;
      g.setLineDash([3, 3]);
      const pd = (p: number) => BRAKING * DEATH_LINE * DEATH_LINE * p * p * p;
      g.beginPath();
      g.moveTo(this.x(P_LO), this.y(pd(P_LO)));
      g.lineTo(this.x(P_HI), this.y(pd(P_HI)));
      g.stroke();
      g.setLineDash([]);
    });

    // --- The population.
    clipped(() => {
      for (const p of this.pop) {
        const px = this.x(p.periodS), py = this.y(p.pdot);
        const c = classify(p);
        const a = p.alive ? 0.5 : 0.13;
        g.fillStyle = `${COLOURS[c.kind] ?? COLOURS.normal}${a})`;
        g.beginPath();
        g.arc(px, py, c.kind === 'millisecond' ? 1.3 : 1.1, 0, Math.PI * 2);
        g.fill();
      }
    });

    // --- Where the marked star has been.
    if (this.track.length > 1) {
      clipped(() => {
        g.strokeStyle = 'rgba(232,184,122,.5)';
        g.lineWidth = 1.1;
        g.beginPath();
        this.track.forEach((t, i) => {
          const px = this.x(t.p), py = this.y(t.pdot);
          if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
        });
        g.stroke();
      });
    }

    if (this.marked) {
      const px = this.x(this.marked.periodS), py = this.y(this.marked.pdot);
      g.strokeStyle = 'rgba(232,184,122,.95)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(px, py, 4.5, 0, Math.PI * 2);
      g.stroke();
    }

    // --- Frame and labels.
    g.strokeStyle = 'rgba(255,255,255,.14)';
    g.lineWidth = 1;
    g.strokeRect(25.5, 9.5, w - 33, h - 29);
    g.fillStyle = 'rgba(255,255,255,.3)';
    g.textAlign = 'center';
    for (const [p, label] of [[0.001, '1 ms'], [0.1, '0.1 s'], [10, '10 s']] as [number, string][]) {
      g.fillText(label, this.x(p), h - 8);
    }
    g.textAlign = 'right';
    for (const e of [-20, -16, -12]) {
      g.fillText(`10${sup(e)}`, 23, this.y(10 ** e) + 3);
    }
    g.save();
    g.translate(8, h / 2);
    g.rotate(-Math.PI / 2);
    g.textAlign = 'center';
    g.fillStyle = 'rgba(255,255,255,.24)';
    g.fillText('SLOWING', 0, 0);
    g.restore();

    const alive = this.pop.filter((p) => p.alive).length;
    const ms = this.pop.filter((p) => classify(p).kind === 'millisecond').length;
    this.caption.textContent = this.pop.length
      ? `${this.title} · ${alive} beaming · ${ms} recycled`
      : this.title;
  }

  /** The whole slowing history of one star, for the track. */
  static history(p: Pulsar, steps = 60): { p: number; pdot: number }[] {
    const out: { p: number; pdot: number }[] = [];
    const age = Math.max(characteristicAgeYears(p), 1);
    for (let i = 0; i <= steps; i++) {
      const t = (10 ** (Math.log10(age * 40) * (i / steps))) * 3.15576e7;
      const per = Math.sqrt(Math.max(p.periodS ** 2 - 2 * BRAKING * p.fieldG ** 2
        * (characteristicAgeYears(p) * 3.15576e7 - t), 1e-8));
      out.push({ p: per, pdot: (BRAKING * p.fieldG * p.fieldG) / per });
    }
    return out;
  }
}

const SUPS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
function sup(n: number): string {
  const s = Math.abs(Math.round(n)).toString().split('').map((d) => SUPS[+d]).join('');
  return n < 0 ? `⁻${s}` : s;
}
