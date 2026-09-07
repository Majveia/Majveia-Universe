/**
 * The touch interface.
 *
 * Not a cut-down version of the desktop one. The desktop build reaches about
 * twenty commands through single keys, and a phone has no keys, so the naive
 * port is a phone that can orbit and do nothing else - which is how almost
 * every three-dimensional thing on the web behaves on a phone, and why almost
 * nobody uses one there.
 *
 * The way out is that a phone knows something the keyboard does not: *where you
 * are*. A keyboard has to offer every command at once because it cannot tell
 * which are meaningful. A dock built at the moment of use can ask the current
 * scale what it is capable of and show only that - four chips in a galaxy, four
 * different ones in a planetary system - so the surface is smaller than the
 * keyboard's and reaches exactly as far. That is the whole design.
 *
 * Three pieces, and nothing else:
 *
 *  - **A shelf** along the bottom: the commands that apply here, in a row under
 *    the thumb, with the readout folded underneath it. Pull it up for the
 *    numbers, leave it down for the view. It is one object with one grabber,
 *    because two stacked things that both slide is one thing too many.
 *  - **A ladder** up the right edge: the five scales, as five marks, with the
 *    current one named. It is the spine of the whole application and on a phone
 *    it was simply missing.
 *  - **Nothing over the middle.** The subject of the screen is the universe.
 *
 * Every target is at least forty-four points, everything sits inside the safe
 * area, and the whole surface fades out with the rest of the interface when
 * nothing has been touched for a few seconds.
 */

import { el } from './hud';

/** What the shelf needs to know about where it is, to decide what to offer. */
export interface StageProbe {
  id: string;
  /** Whether the current stage implements a named capability. */
  can: (method: string) => boolean;
  /** Whether a command's toggle is currently switched on. */
  isOn: (key: string) => boolean;
  /** How deep the scale stack is: 1 means there is nowhere to go back to. */
  depth: number;
  /** Whether there is something under the camera to descend into. */
  hasChild: boolean;
  /** Whether the device has orientation sensors at all. */
  sensors: boolean;
}

export interface ScaleEntry {
  id: string;
  label: string;
  reachable: boolean;
  here: boolean;
}

export interface MobileHost {
  run: (key: string) => void;
  probe: () => StageProbe;
  scales: () => ScaleEntry[];
  goScale: (id: string) => void;
  /** A short haptic acknowledgement, where the device has one. */
  tick: () => void;
}

interface Command {
  key: string;
  label: string;
  /** Whether this command means anything here. */
  live: (p: StageProbe) => boolean;
  /** Shown in gold when true. */
  on?: (p: StageProbe) => boolean;
  /** Ordering weight: the verbs of navigation come first. */
  rank: number;
}

const has = (m: string) => (p: StageProbe) => p.can(m);
const at = (...ids: string[]) => (p: StageProbe) => ids.includes(p.id);
const always = (): boolean => true;
const lit = (key: string) => (p: StageProbe) => p.isOn(key);

/**
 * The commands, in the order they should appear when they all apply at once.
 *
 * Ranks rather than array positions, because what is shown depends on where the
 * camera is, and a fixed order would put the one command that matters at this
 * scale behind three that do not.
 */
const COMMANDS: Command[] = [
  { key: 'Space', label: 'time', rank: 0, live: always, on: lit('Space') },

  { key: 'KeyV', label: 'velocity', rank: 10, live: at('cosmos'), on: lit('KeyV') },
  { key: 'KeyB', label: 'microwave sky', rank: 11, live: at('cosmos'), on: lit('KeyB') },
  { key: 'KeyR', label: 'dark ages', rank: 12, live: at('cosmos') },
  { key: 'KeyC', label: 'cosmology', rank: 13, live: at('cosmos') },

  { key: 'KeyL', label: 'deep field', rank: 20, live: has('observeDeepField'), on: lit('KeyL') },
  {
    key: 'KeyK', label: 'critical curves', rank: 21,
    live: has('toggleCriticalCurves'), on: lit('KeyK'),
  },

  { key: 'KeyM', label: 'collide', rank: 30, live: has('toggleEncounter'), on: lit('KeyM') },
  { key: 'KeyG', label: 'black holes', rank: 31, live: has('toggleMerger'), on: lit('KeyG') },
  { key: 'KeyZ', label: 'a pulsar', rank: 32, live: has('togglePulsar'), on: lit('KeyZ') },
  { key: 'KeyI', label: 'torn apart', rank: 33, live: has('toggleTDE'), on: lit('KeyI') },
  { key: 'KeyD', label: 'H-R diagram', rank: 34, live: has('toggleHR'), on: lit('KeyD') },
  { key: 'KeyN', label: 'listen', rank: 35, live: has('toggleChirpAudio'), on: lit('KeyN') },

  { key: 'KeyY', label: 'a whole life', rank: 40, live: has('toggleEvolution'), on: lit('KeyY') },
  { key: 'KeyT', label: 'true scale', rank: 41, live: has('toggleTrueScale'), on: lit('KeyT') },

  {
    key: 'KeyX', label: 'look around', rank: 3,
    live: (p) => p.sensors, on: lit('KeyX'),
  },

  { key: 'BracketLeft', label: 'slower', rank: 50, live: always },
  { key: 'BracketRight', label: 'faster', rank: 51, live: always },

  { key: 'KeyJ', label: 'near light speed', rank: 60, live: always, on: lit('KeyJ') },
  { key: 'KeyO', label: 'the Solar System', rank: 61, live: always },
  { key: 'KeyP', label: 'save frame', rank: 70, live: always },
  { key: 'KeyU', label: 'hide', rank: 71, live: always },
  { key: 'KeyH', label: 'guide', rank: 72, live: always },
];

/** Where the shelf can rest. */
type Detent = 'peek' | 'open';

export class MobileUI {
  readonly root: HTMLDivElement;
  private shelf: HTMLDivElement;
  private grip: HTMLDivElement;
  private dock: HTMLDivElement;
  private rail: HTMLDivElement;
  private tray: HTMLDivElement;
  private ladder: HTMLDivElement;
  private chips = new Map<string, HTMLButtonElement>();
  private detent: Detent = 'peek';
  private dragFrom = 0;
  private dragAt = 0;
  private dragT = 0;
  private dragV = 0;
  private dragging = false;
  /** How far the shelf is pulled up from its resting place, pixels. */
  private lift = 0;
  private signature = '';
  private watcher: ResizeObserver | null = null;

  constructor(private host: MobileHost) {
    this.root = el('div', 'm-root');

    // --- The ladder of scales, up the right edge where a thumb reaches.
    //
    // `data-chrome` marks the things a touch belongs to rather than to the
    // universe underneath. Everything else that floats over the picture only
    // reports on it, and must let a finger through.
    this.ladder = el('div', 'm-ladder');
    this.ladder.dataset.chrome = '';
    this.root.append(this.ladder);

    // --- The shelf.
    this.shelf = el('div', 'm-shelf');
    this.shelf.dataset.chrome = '';
    this.grip = el('div', 'm-grip');
    this.grip.append(el('i'));
    this.rail = el('div', 'm-rail');
    this.dock = el('div', 'm-dock');
    this.tray = el('div', 'm-tray');
    this.shelf.append(this.grip, this.rail, this.dock, this.tray);
    this.root.append(this.shelf);

    this.bindShelf();
    this.setDetent('peek', false);

    // How much of the shelf shows when it is down is published as a custom
    // property, because several things have to clear it - the inspector, the
    // time readout, the flash. It is *observed* rather than computed at the
    // moments it might change, because the list of such moments is long (a
    // scale change, a rotation, a timeline appearing, a longer label wrapping
    // the dock to two lines) and a list like that is never complete.
    if (typeof ResizeObserver === 'function') {
      this.watcher = new ResizeObserver(() => this.publishPeek());
      for (const n of [this.grip, this.rail, this.dock, this.tray]) this.watcher.observe(n);
    }
    this.publishPeek();
  }

  private publishPeek(): void {
    const peek = this.grip.offsetHeight + this.rail.offsetHeight + this.dock.offsetHeight;
    document.documentElement.style.setProperty('--shelf-peek', `${Math.round(peek)}px`);
    if (!this.dragging) this.setDetent(this.detent, false);
  }

  /** Fold the readout into the shelf, below the commands. */
  adopt(...nodes: HTMLElement[]): void {
    this.tray.append(...nodes);
  }

  /** Put something above the commands, where it is visible with the shelf down. */
  adoptAbove(...nodes: HTMLElement[]): void {
    this.rail.append(...nodes);
  }

  /**
   * Rebuild the dock, but only when the set of applicable commands has actually
   * changed. This is called every frame; recreating twenty buttons sixty times
   * a second would cost the frame rate on exactly the machines that can least
   * afford it, and would cancel any scroll the user was in the middle of.
   */
  refresh(): void {
    const p = this.host.probe();
    const live = COMMANDS.filter((c) => c.live(p)).sort((a, b) => a.rank - b.rank);
    const nav = [
      { key: 'back', label: 'back', enabled: p.depth > 1 },
      { key: 'enter', label: 'enter', enabled: p.hasChild },
    ];
    const sig = `${p.id}|${nav.map((n) => `${n.key}${n.enabled}`).join()}|`
      + live.map((c) => c.key).join();
    if (sig !== this.signature) {
      this.signature = sig;
      this.dock.replaceChildren();
      this.chips.clear();
      for (const n of nav) {
        const b = this.chip(n.key, n.label);
        b.classList.add('nav');
        b.disabled = !n.enabled;
      }
      this.dock.append(el('span', 'm-gap'));
      for (const c of live) this.chip(c.key, c.label);
    }
    // The lit state changes constantly and is cheap: one class per chip.
    for (const c of live) {
      const b = this.chips.get(c.key);
      if (b) b.classList.toggle('on', !!c.on?.(p));
    }
    this.drawLadder();
  }

  private chip(key: string, label: string): HTMLButtonElement {
    const b = el('button', 'm-chip', label);
    b.type = 'button';
    b.addEventListener('click', () => {
      this.host.tick();
      if (key === 'back') this.host.run('Backspace');
      else if (key === 'enter') this.host.run('Enter');
      else this.host.run(key);
    });
    this.dock.append(b);
    this.chips.set(key, b);
    return b;
  }

  private drawLadder(): void {
    const scales = this.host.scales();
    const sig = scales.map((s) => `${s.id}${s.here ? '*' : ''}${s.reachable ? '+' : ''}`).join();
    if (this.ladder.dataset.sig === sig) return;
    this.ladder.dataset.sig = sig;
    this.ladder.replaceChildren();
    for (const s of scales) {
      const b = el('button', `m-rung${s.here ? ' here' : ''}${s.reachable ? '' : ' far'}`);
      b.type = 'button';
      b.append(el('span', 'lab', s.label), el('span', 'mark'));
      b.addEventListener('click', () => { this.host.tick(); this.host.goScale(s.id); });
      this.ladder.append(b);
    }
  }

  // --- The shelf's own drag -------------------------------------------------
  //
  // Detents rather than free positioning: a sheet that can rest anywhere always
  // ends up resting somewhere useless. Which detent it lands in is decided by
  // the release velocity first and the position second, because a fast flick
  // means a direction and a slow drag means a distance.

  private bindShelf(): void {
    const start = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.dragging = true;
      this.dragFrom = e.clientY;
      this.dragAt = e.clientY;
      this.dragT = e.timeStamp;
      this.dragV = 0;
      this.shelf.classList.add('dragging');
      this.grip.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!this.dragging) return;
      const dy = e.clientY - this.dragAt;
      const dt = Math.max(e.timeStamp - this.dragT, 1);
      this.dragV = this.dragV * 0.6 + (dy / dt) * 1000 * 0.4;
      this.dragAt = e.clientY;
      this.dragT = e.timeStamp;
      const span = this.travel();
      const base = this.detent === 'open' ? span : 0;
      let lift = base + (this.dragFrom - e.clientY);
      // Give past either end, so the limits are felt rather than hit.
      if (lift < 0) lift /= 1 + -lift / 46;
      if (lift > span) lift = span + (lift - span) / (1 + (lift - span) / 46);
      this.lift = lift;
      this.shelf.style.transform = `translate3d(0, ${-lift}px, 0)`;
    };
    const end = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      this.shelf.classList.remove('dragging');
      try { this.grip.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
      const span = this.travel();
      const moved = Math.abs(this.dragFrom - this.dragAt);
      if (moved < 6) { this.toggle(); return; }
      // Downward velocity is positive, and closes.
      const flick = Math.abs(this.dragV) > 420;
      const want: Detent = flick
        ? (this.dragV < 0 ? 'open' : 'peek')
        : (this.lift > span * 0.45 ? 'open' : 'peek');
      this.setDetent(want, true);
    };
    this.grip.addEventListener('pointerdown', start);
    this.grip.addEventListener('pointermove', move);
    this.grip.addEventListener('pointerup', end);
    this.grip.addEventListener('pointercancel', end);
  }

  /** How far the shelf travels between its two resting places, pixels. */
  private travel(): number {
    return Math.max(0, this.tray.scrollHeight);
  }

  toggle(): void {
    this.host.tick();
    this.setDetent(this.detent === 'open' ? 'peek' : 'open', true);
  }

  get open(): boolean { return this.detent === 'open'; }

  private setDetent(d: Detent, animate: boolean): void {
    this.detent = d;
    this.lift = d === 'open' ? this.travel() : 0;
    this.shelf.classList.toggle('open', d === 'open');
    this.root.classList.toggle('sheet-open', d === 'open');
    if (!animate) this.shelf.style.transition = 'none';
    this.shelf.style.transform = `translate3d(0, ${-this.lift}px, 0)`;
    if (!animate) {
      // Force the style through before the transition comes back, or the first
      // open animates from wherever the layout happened to start.
      void this.shelf.offsetHeight;
      this.shelf.style.transition = '';
    }
  }

  /** Re-seat the shelf after a rotation. */
  onResize(): void {
    this.publishPeek();
  }

  dispose(): void {
    this.watcher?.disconnect();
    this.watcher = null;
  }
}

/**
 * Whether this is a device driven by a finger.
 *
 * `pointer: coarse` is the right question, because it asks about the *primary*
 * input: a laptop with a touchscreen and a trackpad answers no, which is
 * correct, and a tablet with a keyboard attached answers yes, which is also
 * correct. Screen width is the wrong question and always has been.
 */
export function isTouchDevice(params?: URLSearchParams): boolean {
  const forced = params?.get('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return 'ontouchstart' in window;
  }
}
