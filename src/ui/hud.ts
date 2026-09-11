/**
 * The heads-up display.
 *
 * Hand-built DOM, no framework: this interface has perhaps forty live values
 * and they all change every frame, so the fastest correct thing is to hold
 * references to text nodes and write to them directly.
 */

export interface RowSpec { key: string; label: string; accent?: boolean }

export class Rows {
  readonly el: HTMLDivElement;
  private vals = new Map<string, HTMLSpanElement>();

  constructor(specs: RowSpec[], className = 'readout') {
    this.el = document.createElement('div');
    this.el.className = `layer dimmable ${className}`;
    for (const s of specs) this.add(s);
  }

  add(s: RowSpec): void {
    const row = document.createElement('div');
    row.className = `row${s.accent ? ' accent' : ''}`;
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = s.label;
    const v = document.createElement('span');
    v.className = 'v';
    row.append(k, v);
    this.el.append(row);
    this.vals.set(s.key, v);
  }

  set(key: string, value: string, unit?: string): void {
    const v = this.vals.get(key);
    if (!v) return;
    if (unit) {
      if (v.childNodes.length !== 2) {
        v.textContent = '';
        v.append(document.createTextNode(''), document.createElement('em'));
      }
      (v.childNodes[0] as Text).data = value;
      (v.childNodes[1] as HTMLElement).textContent = unit;
    } else if (v.firstChild && v.childNodes.length === 1 && v.firstChild.nodeType === 3) {
      (v.firstChild as Text).data = value;
    } else {
      v.textContent = value;
    }
  }

  setHTML(key: string, html: string): void {
    const v = this.vals.get(key);
    if (v) v.innerHTML = html;
  }

  has(key: string): boolean { return this.vals.has(key); }

  /** Drop every row. Used when the scale changes and the readout is rebuilt. */
  clear(): void {
    this.el.innerHTML = '';
    this.vals.clear();
  }
}

/** Number formatting that stays readable across forty orders of magnitude. */
export function sig(x: number, digits = 3): string {
  if (!Number.isFinite(x)) return '—';
  const a = Math.abs(x);
  if (a === 0) return '0';
  if (a >= 1e5 || a < 1e-3) {
    const e = Math.floor(Math.log10(a));
    const m = x / Math.pow(10, e);
    return `${m.toFixed(Math.max(0, digits - 1))}×10${sup(e)}`;
  }
  const d = Math.max(0, digits - 1 - Math.floor(Math.log10(a)));
  return x.toFixed(Math.min(6, d));
}

const SUPS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
export function sup(n: number): string {
  const s = Math.abs(n).toString().split('').map((c) => SUPS[+c]).join('');
  return (n < 0 ? '⁻' : '') + s;
}

export function commas(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** Distance rendered in whichever astronomical unit keeps the number small. */
/**
 * One ruler for forty-three decades.
 *
 * The ladder runs from a nucleus to the observable universe, and every rung of
 * it used to format its own number in its own unit - six copies of the same
 * two lines and three hand-rolled variants for the small end, which is how a
 * readout ends up disagreeing with itself across a transition. This is the
 * whole span in one function, in the unit somebody working at that size would
 * actually use: femtometres for a nucleus, angstroms for a lattice,
 * astronomical units for a system, megaparsecs for the web.
 */
export function formatDistance(metres: number): [string, string] {
  const a = Math.abs(metres);
  if (a === 0) return ['0', 'm'];
  if (a < 1e-15) return [sig(metres * 1e18, 3), 'am'];
  if (a < 1e-12) return [sig(metres * 1e15, 3), 'fm'];
  if (a < 1e-10) return [sig(metres * 1e12, 3), 'pm'];
  if (a < 1e-9) return [sig(metres * 1e10, 3), 'Å'];
  if (a < 1e-6) return [sig(metres * 1e9, 3), 'nm'];
  if (a < 1e-3) return [sig(metres * 1e6, 3), 'µm'];
  if (a < 1) return [sig(metres * 1e3, 3), 'mm'];
  if (a < 1e4) return [sig(metres, 3), 'm'];
  if (a < 1.5e9) return [sig(metres / 1e3, 3), 'km'];
  if (a < 1e15) return [sig(metres / 1.495978707e11, 3), 'AU'];
  if (a < 3e19) return [sig(metres / 9.4607304725808e15, 3), 'ly'];
  if (a < 3e22) return [sig(metres / 3.0856775814913673e16 / 1e3, 3), 'kpc'];
  if (a < 3e25) return [sig(metres / 3.0856775814913673e16 / 1e6, 3), 'Mpc'];
  return [sig(metres / 3.0856775814913673e16 / 1e9, 3), 'Gpc'];
}

export function formatTime(seconds: number): [string, string] {
  const a = Math.abs(seconds);
  if (a < 120) return [sig(seconds, 3), 's'];
  if (a < 7200) return [sig(seconds / 60, 3), 'min'];
  if (a < 3 * 86400) return [sig(seconds / 3600, 3), 'h'];
  if (a < 3 * 3.15576e7) return [sig(seconds / 86400, 3), 'd'];
  if (a < 3e9 * 3.15576e7 / 1e6) return [sig(seconds / 3.15576e7, 3), 'yr'];
  if (a < 3.15576e7 * 1e9) return [sig(seconds / 3.15576e7 / 1e6, 3), 'Myr'];
  return [sig(seconds / 3.15576e7 / 1e9, 3), 'Gyr'];
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
