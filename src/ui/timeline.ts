/**
 * The cosmic timeline.
 *
 * The slider is linear in log(a), which is the natural coordinate for cosmic
 * history: it gives equal screen space to each e-folding of expansion, so the
 * dark ages, the epoch of galaxy assembly and the accelerating future all get
 * room instead of being crushed against z = 0.
 */

import { el } from './hud';

export interface Epoch { z: number; label: string }

/** Milestones, at the redshifts they actually happened. */
export const EPOCHS: Epoch[] = [
  { z: 1089.8, label: 'recombination · the first light' },
  { z: 100, label: 'the dark ages' },
  { z: 30, label: 'the dark ages' },
  { z: 20, label: 'cosmic dawn · first stars ignite' },
  { z: 11, label: 'first galaxies assemble' },
  { z: 6, label: 'reionisation completes' },
  { z: 3, label: 'the cosmic web hardens' },
  { z: 2, label: 'cosmic noon · peak star formation' },
  { z: 1, label: 'clusters virialise' },
  { z: 0.5, label: 'dark energy takes over' },
  { z: 0.1, label: 'the local group settles' },
  { z: 0, label: 'now' },
  { z: -0.3, label: 'the future · expansion accelerates' },
  { z: -0.6, label: 'the far future · the web freezes' },
  { z: -0.85, label: 'the long night · galaxies leave the horizon' },
];

export function epochLabel(z: number): string {
  let best = EPOCHS[0];
  for (const e of EPOCHS) if (z <= e.z + 1e-9) best = e;
  return best.label;
}

export class Timeline {
  readonly el: HTMLDivElement;
  private fill: HTMLElement;
  private head: HTMLElement;
  private epochEl: HTMLElement;
  private track: HTMLElement;
  private aMin: number;
  private aMax: number;
  private lMin: number;
  private lRange: number;
  private _u = 1;

  onChange?: (a: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;

  constructor(zMax = 120, aMaxFuture = 8) {
    this.aMin = 1 / (1 + zMax);
    this.aMax = aMaxFuture;
    this.lMin = Math.log(this.aMin);
    this.lRange = Math.log(this.aMax) - this.lMin;

    this.el = el('div', 'layer dimmable timeline');
    this.epochEl = el('div', 'epoch', '');
    this.track = el('div', 'track');
    const line = el('div', 'line');
    this.fill = el('div', 'fill');
    this.head = el('div', 'head');
    const ticks = el('div', 'ticks');

    for (const z of [100, 20, 6, 2, 1, 0, -0.75]) {
      const t = el('div', 'tick');
      t.style.left = `${this.uFromA(1 / (1 + z)) * 100}%`;
      const s = el('span');
      s.textContent = z > 0 ? `z=${z}` : z === 0 ? 'now' : 'future';
      t.append(s);
      ticks.append(t);
    }

    this.track.append(line, this.fill, this.head, ticks);
    this.el.append(this.epochEl, this.track);

    let dragging = false;
    const setFrom = (clientX: number) => {
      const r = this.track.getBoundingClientRect();
      const u = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      this.setU(u);
      this.onChange?.(this.a);
    };
    this.track.addEventListener('pointerdown', (e) => {
      dragging = true;
      this.track.setPointerCapture(e.pointerId);
      this.onScrubStart?.();
      setFrom(e.clientX);
    });
    this.track.addEventListener('pointermove', (e) => { if (dragging) setFrom(e.clientX); });
    const end = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      try { this.track.releasePointerCapture(e.pointerId); } catch { /* released already */ }
      this.onScrubEnd?.();
    };
    this.track.addEventListener('pointerup', end);
    this.track.addEventListener('pointercancel', end);
  }

  uFromA(a: number): number {
    return Math.max(0, Math.min(1, (Math.log(a) - this.lMin) / this.lRange));
  }
  aFromU(u: number): number { return Math.exp(this.lMin + u * this.lRange); }

  get a(): number { return this.aFromU(this._u); }
  get u(): number { return this._u; }

  setU(u: number): void {
    this._u = Math.max(0, Math.min(1, u));
    const pct = this._u * 100;
    this.fill.style.width = `${pct}%`;
    this.head.style.left = `${pct}%`;
    const z = 1 / this.a - 1;
    this.epochEl.textContent = epochLabel(z);
  }

  setA(a: number): void { this.setU(this.uFromA(a)); }
}
