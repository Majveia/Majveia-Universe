/**
 * Majveia — the application.
 *
 * Owns the renderer, the camera, the procedural universe and the scale ladder,
 * and wires them to an interface that is meant to disappear: everything fades
 * out when you stop touching it, because the subject of the screen is the
 * universe and not the chrome around it.
 */

import * as THREE from 'three';
import './ui/styles.css';

import { Engine } from './render/engine';
import { Controls } from './camera/controls';
import { Universe } from './sim/universe';
import {
  Stage, ScaleId, StageCtx, Target, StageEnv, makeStage, SCALE_ORDER, CosmosStage,
} from './sim/stages';
import { Timeline } from './ui/timeline';
import { Rows, el, sig, commas } from './ui/hud';
import { saveBlob } from './ui/save';
import { PLANCK18, PRESET_COSMOLOGIES, Cosmology, growthFactor } from './cosmology/lcdm';
import type { CosmicWebField } from './cosmology/zeldovich';
import { hashString } from './core/rng';
import CosmicWebWorker from './cosmology/web.worker?worker&inline';

const SCALE_LABELS: Record<ScaleId, string> = {
  cosmos: 'Cosmos',
  cluster: 'Cluster',
  galaxy: 'Galaxy',
  system: 'System',
  world: 'World',
};

const SYLLABLES = ['ka', 'thu', 'ma', 'vei', 'or', 'lyn', 'dra', 'sel', 'ith', 'no', 'zar', 'ea', 'vos', 'ri'];

export function randomSeedText(): string {
  let s = '';
  const n = 3 + Math.floor(Math.random() * 2);
  for (let i = 0; i < n; i++) s += SYLLABLES[Math.floor(Math.random() * SYLLABLES.length)];
  return s.toUpperCase();
}

interface TimeWarp { label: string; scale: number }

/** Time-warp presets, per scale. The value multiplies each stage's base rate. */
const WARPS: TimeWarp[] = [
  { label: '⏸', scale: 0 },
  { label: '×1', scale: 1 },
  { label: '×10', scale: 10 },
  { label: '×100', scale: 100 },
  { label: '×1000', scale: 1000 },
  { label: '×10⁴', scale: 1e4 },
];

/**
 * Speeds to fly at. They climb by about a factor of ten in the Lorentz factor
 * each step, which is the only way to make the trailing decimals of beta mean
 * something: 0.99 and 0.9999995 look alike written down and differ by a factor
 * of 140 in everything that matters.
 */
const BOOSTS = [0, 0.5, 0.9, 0.99, 0.9999, 0.99999, 0.999999, 0.99999999];

const lorentz = (b: number): number => 1 / Math.sqrt(Math.max(1 - b * b, 1e-18));

export class App {
  readonly engine: Engine;
  readonly controls: Controls;
  readonly canvas: HTMLCanvasElement;
  universe!: Universe;
  cosmology: Cosmology = PLANCK18;

  private uiRoot: HTMLDivElement;
  stage: Stage | null = null;
  private stack: { id: ScaleId; ctx: StageCtx; label: string }[] = [];
  private readout: Rows;
  private timeline: Timeline;
  private inspector: HTMLDivElement;
  private inspectorBody: HTMLDivElement;
  private ladder: HTMLDivElement;
  private crumbEl: HTMLDivElement;
  private titleEl: HTMLHeadingElement;
  private subEl: HTMLDivElement;
  private flashEl: HTMLDivElement;
  private warpEl: HTMLDivElement;
  private helpEl: HTMLDivElement;
  private boot: HTMLDivElement;
  private bootBar: HTMLElement;
  private bootLabel: HTMLElement;

  private epochA = 1;
  private playing = false;
  private scrubbing = false;
  private warpIndex = 1;
  private boostIndex = 0;
  /** Beta actually applied, eased toward the selected preset. */
  private boost = 0;
  private boostDir = new THREE.Vector3(0, 0, -1);
  private idle = 0;
  private lastFrame = performance.now();
  private fps = 60;
  private frame = 0;
  /** Wall-clock start of the current scale transition, or 0 when idle. */
  private transitionT0 = 0;
  private transitionTarget: Target | null = null;
  private transitionDone = false;
  private pointer = new THREE.Vector2(0, 0);
  private pointerActive = false;
  private quality = 1;

  readonly seedText: string;

  constructor(readonly params: URLSearchParams) {
    this.seedText = params.get('seed') ?? randomSeedText();
    this.canvas = document.getElementById('stage') as HTMLCanvasElement;
    this.engine = new Engine({ canvas: this.canvas });
    this.controls = new Controls(this.engine.camera, this.canvas);
    this.uiRoot = document.getElementById('ui') as HTMLDivElement;

    this.engine.exposure = 1;
    this.engine.bloomStrength = 0.72;
    this.engine.bloomThreshold = 0.85;
    this.engine.bloomRadius = 1.25;
    this.engine.vignette = 0.5;
    this.engine.saturation = 1.14;
    this.engine.blackPoint = 0.010;

    // --- Boot overlay
    this.boot = el('div', 'boot');
    this.bootBar = el('i');
    this.bootLabel = el('div', 'label', 'allocating spacetime');
    const bar = el('div', 'bar');
    bar.append(this.bootBar);
    this.boot.append(el('div', 'title', 'Majveia'), bar, this.bootLabel);
    document.body.append(this.boot);

    // --- Masthead
    const masthead = el('div', 'layer dimmable masthead');
    this.titleEl = el('h1', undefined, 'Majveia');
    this.subEl = el('div', 'sub', 'A universe assembled from the Friedmann equations, a Gaussian random field, and gravity.');
    this.crumbEl = el('div', 'seed', `SEED ${this.seedText}`);
    masthead.append(this.titleEl, this.subEl, this.crumbEl);

    // --- Readout
    this.readout = new Rows([]);

    // --- Timeline
    this.timeline = new Timeline(120, 8);
    this.timeline.onChange = (a) => { this.epochA = a; };
    this.timeline.onScrubStart = () => { this.scrubbing = true; this.playing = false; };
    this.timeline.onScrubEnd = () => { this.scrubbing = false; };
    this.timeline.setA(1);

    // --- Time warp readout (non-cosmos scales)
    this.warpEl = el('div', 'layer dimmable warp');
    this.warpEl.style.cssText =
      'left:50%;bottom:var(--edge);transform:translateX(-50%);text-align:center;' +
      'font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:rgba(255,255,255,.4)';

    // --- Ladder
    this.ladder = el('div', 'layer dimmable ladder');
    for (const id of SCALE_ORDER) {
      const b = el('button', 'step');
      b.append(el('span', 'dot'), el('span', undefined, SCALE_LABELS[id]));
      b.addEventListener('click', () => this.jumpToScale(id));
      this.ladder.append(b);
    }

    // --- Inspector
    this.inspector = el('div', 'layer inspector');
    this.inspectorBody = el('div');
    this.inspector.append(this.inspectorBody);

    // --- Hint
    const hint = el('div', 'layer dimmable hint');
    hint.innerHTML =
      '<b>drag</b> orbit · <b>scroll</b> zoom · <b>wasd</b> fly<br>' +
      '<b>click</b> inspect · <b>enter</b> descend · <b>backspace</b> ascend<br>' +
      '<b>space</b> time · <b>h</b> controls';

    // --- Rail
    const rail = el('div', 'layer dimmable rail');
    const railBtn = (label: string, fn: (b: HTMLButtonElement) => void) => {
      const b = el('button', undefined, label);
      b.addEventListener('click', () => fn(b));
      rail.append(b);
      return b;
    };
    this.playBtn = railBtn('▸ run time', () => this.togglePlay());
    this.velBtn = railBtn('peculiar velocity', (b) => {
      if (this.stage instanceof CosmosStage) {
        this.stage.velocityTint = !this.stage.velocityTint;
        b.classList.toggle('on', this.stage.velocityTint);
      }
    });
    railBtn('cosmology', () => this.cycleCosmology());
    rail.append(el('div', 'divider'));
    railBtn('new universe', () => {
      const s = randomSeedText();
      const keep = params.has('n') ? `&n=${params.get('n')}` : '';
      location.search = `?seed=${s}${keep}`;
    });
    railBtn('controls', () => this.helpEl.classList.toggle('show'));

    // --- Help
    this.helpEl = el('div', 'help');
    const panel = el('div', 'panel');
    panel.innerHTML = HELP_HTML;
    this.helpEl.append(panel);

    // --- Flash
    this.flashEl = el('div', 'layer flash');
    this.flashEl.style.cssText =
      'left:50%;bottom:calc(var(--edge) + 62px);transform:translateX(-50%);font-size:10px;' +
      'letter-spacing:.22em;text-transform:uppercase;color:rgba(232,184,122,.92);opacity:0;' +
      'transition:opacity 300ms;pointer-events:none;text-align:center';

    this.uiRoot.append(masthead, this.readout.el, this.timeline.el, this.warpEl,
      this.ladder, this.inspector, hint, rail, this.flashEl);
    document.body.append(this.helpEl);

    this.bindEvents();
    this.resize();
  }

  private playBtn: HTMLButtonElement;
  private velBtn: HTMLButtonElement;

  // -------------------------------------------------------------------------

  private env(): StageEnv {
    return {
      engine: this.engine,
      controls: this.controls,
      universe: this.universe,
      cosmology: this.cosmology,
      epoch: () => this.epochA,
      viewport: () => this.engine.size,
      quality: () => this.quality,
    };
  }

  async start(): Promise<void> {
    const grid = this.pickGrid();
    const box = Number(this.params.get('box') ?? 620);
    this.quality = Number(this.params.get('q') ?? (grid >= 128 ? 1 : 1));
    const field = await this.generateField(grid, box);
    this.universe = new Universe(this.seedText, field);
    this.enter({ id: 'cosmos', ctx: {}, label: 'Cosmic web' }, true);
    this.boot.classList.add('done');
    setTimeout(() => this.boot.remove(), 1400);
    this.flash(`${commas(field.count)} particles · ${field.knots.length} haloes`);
    requestAnimationFrame((t) => this.tick(t));
  }

  private pickGrid(): number {
    const req = this.params.get('n');
    if (req) {
      const v = parseInt(req, 10);
      if ([32, 64, 128, 256].includes(v)) return v;
    }
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    const cores = navigator.hardwareConcurrency ?? 4;
    return mem >= 4 && cores >= 4 ? 128 : 64;
  }

  /**
   * Build the universe, off the main thread when that is allowed.
   *
   * Some embeddings block blob-URL workers outright, and a blocked worker fails
   * silently: it constructs, it accepts a message, and nothing ever comes back.
   * So the worker gets a few seconds to say something, and if it does not, the
   * job moves to the main thread at a resolution that will not freeze the tab.
   */
  private generateField(n: number, boxMpc: number): Promise<CosmicWebField> {
    const seed = hashString(this.seedText);
    const opts = { boxMpc, seed, cosmology: PLANCK18, smoothCells: 1.1 };

    const onMainThread = (size: number): Promise<CosmicWebField> =>
      import('./cosmology/zeldovich').then(({ generateCosmicWeb }) => {
        this.bootLabel.textContent = 'building on the main thread';
        return generateCosmicWeb({ ...opts, n: size });
      });

    return new Promise((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new CosmicWebWorker();
      } catch {
        onMainThread(Math.min(n, 64)).then(resolve, reject);
        return;
      }
      let alive = false;
      let settled = false;
      const giveUp = window.setTimeout(() => {
        if (alive || settled) return;
        settled = true;
        try { worker.terminate(); } catch { /* already gone */ }
        onMainThread(Math.min(n, 64)).then(resolve, reject);
      }, 4000);

      worker.onerror = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(giveUp);
        try { worker.terminate(); } catch { /* already gone */ }
        onMainThread(Math.min(n, 64)).then(resolve, reject);
      };
      worker.onmessage = (ev: MessageEvent) => {
        const m = ev.data;
        if (m.type === 'progress') {
          alive = true;
          this.bootBar.style.width = `${(m.fraction * 100).toFixed(1)}%`;
          this.bootLabel.textContent = m.label;
        } else if (m.type === 'done') {
          settled = true;
          window.clearTimeout(giveUp);
          worker.terminate();
          resolve(m.field as CosmicWebField);
        } else if (m.type === 'error') {
          settled = true;
          window.clearTimeout(giveUp);
          this.bootLabel.textContent = `generation failed: ${m.message}`;
          reject(new Error(m.message));
        }
      };
      worker.postMessage({ ...opts, n });
    });
  }

  // -------------------------------------------------------------------------
  // Stage management
  // -------------------------------------------------------------------------

  private enter(target: Target, replaceStack = false): void {
    this.stage?.dispose();
    if (this.stage) this.engine.scene.remove(this.stage.root);

    const stage = makeStage(target.id, this.env(), target.ctx);
    stage.build();
    this.engine.scene.add(stage.root);
    this.stage = stage;

    if (replaceStack) this.stack = [{ id: target.id, ctx: target.ctx, label: target.label }];
    else {
      const depth = SCALE_ORDER.indexOf(target.id);
      this.stack = this.stack.slice(0, depth);
      this.stack.push({ id: target.id, ctx: target.ctx, label: target.label });
    }

    this.titleEl.textContent = stage.title;
    this.subEl.textContent = stage.subtitle;
    this.updateCrumb();
    this.rebuildReadout();
    this.updateLadder();
    this.timeline.el.style.display = stage.id === 'cosmos' ? '' : 'none';
    this.warpEl.style.display = stage.id === 'cosmos' ? 'none' : '';
    this.velBtn.style.display = stage.id === 'cosmos' ? '' : 'none';
    this.inspector.classList.remove('show');
  }

  /** Travel to a target with a short dive: exposure falls, scene swaps, light returns. */
  travel(target: Target | null): void {
    if (!target || this.transitionT0 !== 0) return;
    this.transitionTarget = target;
    this.transitionT0 = performance.now();
    this.transitionDone = false;
    this.controls.locked = true;
    this.flash(`→ ${target.label}`);
  }

  /** True while a scale change is in flight. */
  get travelling(): boolean { return this.transitionT0 !== 0; }

  descend(usePointer: boolean): void {
    if (!this.stage) return;
    const t = this.stage.child(usePointer && this.pointerActive ? this.pointer : undefined);
    if (!t) { this.flash('nothing to descend into'); return; }
    this.travel(t);
  }

  ascend(): void {
    if (this.stack.length < 2) return;
    const prev = this.stack[this.stack.length - 2];
    this.travel({ id: prev.id, ctx: prev.ctx, label: prev.label });
  }

  private jumpToScale(id: ScaleId): void {
    if (!this.stage) return;
    const here = SCALE_ORDER.indexOf(this.stage.id);
    const want = SCALE_ORDER.indexOf(id);
    if (want === here) return;
    if (want < here) {
      const entry = this.stack[want];
      if (entry) this.travel({ id: entry.id, ctx: entry.ctx, label: entry.label });
      else this.travel({ id: 'cosmos', ctx: {}, label: 'Cosmic web' });
    } else {
      // Descend one level at a time so each stage chooses its own best child.
      this.descend(false);
    }
  }

  private updateCrumb(): void {
    const parts = this.stack.map((s) => s.label);
    this.crumbEl.textContent = `${this.seedText}  ·  ${parts.join('  ›  ')}`;
  }

  private updateLadder(): void {
    const here = this.stage ? SCALE_ORDER.indexOf(this.stage.id) : 0;
    const steps = Array.from(this.ladder.children) as HTMLElement[];
    steps.forEach((s, i) => {
      s.classList.toggle('on', i === here);
      s.style.opacity = i <= this.stack.length ? '1' : '0.35';
    });
  }

  private rebuildReadout(): void {
    this.readout.clear();
    if (!this.stage) return;
    for (const r of this.stage.rows()) {
      this.readout.add({ key: r.k, label: r.k, accent: r.accent });
    }
    this.readout.add({ key: '__fps', label: 'frame' });
  }

  // -------------------------------------------------------------------------
  // Interface plumbing
  // -------------------------------------------------------------------------

  private flashTimer?: number;
  flash(msg: string): void {
    this.flashEl.textContent = msg;
    this.flashEl.style.opacity = '1';
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => { this.flashEl.style.opacity = '0'; }, 1900);
  }

  private togglePlay(): void {
    this.playing = !this.playing;
    this.playBtn.classList.toggle('on', this.playing);
    this.playBtn.textContent = this.playing ? '❚❚ pause time' : '▸ run time';
  }

  private cycleCosmology(): void {
    const i = (PRESET_COSMOLOGIES.indexOf(this.cosmology) + 1) % PRESET_COSMOLOGIES.length;
    this.cosmology = PRESET_COSMOLOGIES[i];
    this.flash(`cosmology → ${this.cosmology.name}`);
    if (this.stage?.id === 'cosmos') {
      this.subEl.textContent =
        `${this.cosmology.name} · Ωm ${this.cosmology.Om.toFixed(3)} · ` +
        `ΩΛ ${this.cosmology.OL.toFixed(3)} · σ₈ ${this.cosmology.sigma8.toFixed(3)}` +
        (this.cosmology.w !== -1 ? ` · w ${this.cosmology.w}` : '');
    }
  }

  private bindEvents(): void {
    window.addEventListener('resize', () => this.resize());
    this.controls.onInteract = () => this.wake();

    for (const ev of ['pointermove', 'pointerdown', 'wheel', 'keydown'] as const) {
      window.addEventListener(ev, () => this.wake(), { passive: true });
    }

    this.canvas.addEventListener('pointermove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1);
      this.pointerActive = true;
    });
    this.canvas.addEventListener('pointerleave', () => { this.pointerActive = false; });

    let downAt = 0;
    let downPos = { x: 0, y: 0 };
    this.canvas.addEventListener('pointerdown', (e) => {
      downAt = performance.now();
      downPos = { x: e.clientX, y: e.clientY };
    });
    this.canvas.addEventListener('pointerup', (e) => {
      const dt = performance.now() - downAt;
      const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      if (dt < 350 && moved < 5) this.onClick(e);
    });
    this.canvas.addEventListener('dblclick', () => this.descend(true));

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      switch (e.code) {
        case 'Space': e.preventDefault(); this.togglePlay(); break;
        case 'Enter': this.descend(true); break;
        case 'Backspace': e.preventDefault(); this.ascend(); break;
        case 'KeyH': case 'Slash': this.helpEl.classList.toggle('show'); break;
        case 'Escape': this.helpEl.classList.remove('show'); this.inspector.classList.remove('show'); break;
        case 'KeyU': this.uiRoot.classList.toggle('hidden'); break;
        case 'KeyV': this.velBtn.click(); break;
        case 'KeyC': this.cycleCosmology(); break;
        case 'KeyF':
          // Fullscreen is often denied inside an embed; failing is fine.
          if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
          else document.documentElement.requestFullscreen?.().catch(() => {});
          break;
        case 'KeyP': this.capture(); break;
        case 'KeyL': {
          const c = this.stage as unknown as { observeDeepField?: () => boolean };
          if (c.observeDeepField) {
            const on = c.observeDeepField();
            this.rebuildReadout();
            this.flash(on
              ? 'deep field · 1 Gpc · the cluster is lensing what is behind it'
              : 'back to the cluster');
          } else this.flash('deep fields are observed from a cluster');
          break;
        }
        case 'KeyK': {
          const c = this.stage as unknown as { toggleCriticalCurves?: () => boolean };
          if (c.toggleCriticalCurves) {
            this.flash(c.toggleCriticalCurves()
              ? 'critical curves — where magnification diverges'
              : 'critical curves hidden');
          }
          break;
        }
        case 'KeyM': {
          const g = this.stage as unknown as { toggleEncounter?: () => boolean };
          if (g.toggleEncounter) {
            const on = g.toggleEncounter();
            this.rebuildReadout();
            this.flash(on ? 'gravitational encounter — running' : 'encounter ended');
            if (on && !this.playing) this.togglePlay();
          } else {
            this.flash('encounters need a galaxy');
          }
          break;
        }
        case 'KeyJ': {
          // Relativistic flight. The presets climb by roughly a factor of ten
          // in gamma each step, because that is the only way to make the last
          // few decimal places of beta mean anything.
          this.boostIndex = (this.boostIndex + 1) % BOOSTS.length;
          const b = BOOSTS[this.boostIndex];
          this.flash(b === 0 ? 'back to rest'
            : `boost · beta ${b} · gamma ${lorentz(b).toFixed(b < 0.99 ? 2 : 0)}`);
          break;
        }
        case 'KeyT': {
          const st = this.stage as unknown as { toggleTrueScale?: () => boolean };
          if (st.toggleTrueScale) {
            this.flash(st.toggleTrueScale() ? 'true scale' : 'apparent-size floor restored');
          }
          break;
        }
        case 'KeyR':
          if (this.stage?.id === 'cosmos') {
            this.timeline.setA(1 / 101); this.epochA = this.timeline.a; this.flash('rewound to the dark ages');
          }
          break;
        case 'BracketLeft':
          if (this.stage?.id === 'cosmos') {
            this.timeline.setU(Math.max(0, this.timeline.u - 0.035)); this.epochA = this.timeline.a;
          } else { this.warpIndex = Math.max(0, this.warpIndex - 1); }
          break;
        case 'BracketRight':
          if (this.stage?.id === 'cosmos') {
            this.timeline.setU(Math.min(1, this.timeline.u + 0.035)); this.epochA = this.timeline.a;
          } else { this.warpIndex = Math.min(WARPS.length - 1, this.warpIndex + 1); }
          break;
        case 'Equal': case 'NumpadAdd':
          this.quality = Math.min(1, this.quality * 1.35); this.applyQuality(); break;
        case 'Minus': case 'NumpadSubtract':
          this.quality = Math.max(0.02, this.quality / 1.35); this.applyQuality(); break;
        default: break;
      }
    });
  }

  private applyQuality(): void {
    if (this.stage instanceof CosmosStage) {
      this.stage.setDetail(this.quality);
      this.flash(`${commas(this.stage.drawn)} particles`);
    } else {
      this.flash(`quality ${(this.quality * 100).toFixed(0)}%`);
    }
  }

  private onClick(e: PointerEvent): void {
    if (!this.stage) return;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1);
    const info = this.stage.inspect(ndc);
    if (!info) { this.inspector.classList.remove('show'); return; }
    this.inspectorBody.innerHTML = '';
    const h = el('h2', undefined, info.title);
    const kind = el('div', 'kind');
    if (info.swatch) {
      const sw = el('span', 'swatch');
      sw.style.background = info.swatch;
      kind.append(sw);
    }
    kind.append(document.createTextNode(info.kind));
    this.inspectorBody.append(h, kind);
    for (const row of info.rows) {
      const d = el('div', 'row');
      d.append(el('span', 'k', row.k), el('span', 'v', row.u ? `${row.v} ${row.u}` : row.v));
      this.inspectorBody.append(d);
    }
    if (info.note) this.inspectorBody.append(el('div', 'note', info.note));
    const go = this.stage.child(ndc);
    if (go) {
      const b = el('button', 'descend', `enter ${go.label} →`);
      b.style.cssText =
        'margin-top:16px;background:none;border:0;padding:0;font:inherit;font-size:10px;' +
        'letter-spacing:.18em;text-transform:uppercase;color:rgb(232,184,122);cursor:pointer;' +
        'pointer-events:auto';
      b.addEventListener('click', () => this.travel(go));
      this.inspectorBody.append(b);
    }
    this.inspector.classList.add('show');
  }

  private capture(): void {
    this.engine.render(0);
    this.flash('capturing frame…');
    this.canvas.toBlob((b) => {
      if (!b) { this.flash('could not capture the frame'); return; }
      const name = `majveia-${this.seedText}-${this.stage?.id ?? 'view'}.png`;
      saveBlob(b, name).then((outcome) => {
        this.flash(outcome === 'saved' ? 'frame saved'
          : outcome === 'declined' ? 'save cancelled'
          : 'saving is unavailable here');
      });
    }, 'image/png');
  }

  private wake(): void {
    this.idle = 0;
    this.uiRoot.classList.remove('idle');
  }

  private resize(): void {
    const dprCap = this.params.has('dpr') ? Number(this.params.get('dpr')) : 2;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    this.engine.setSize(window.innerWidth, window.innerHeight, dpr);
    this.stage?.onResize();
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  private tick(now: number): void {
    requestAnimationFrame((t) => this.tick(t));
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.frame++;
    this.idle += dt;
    if (this.idle > 3.4) this.uiRoot.classList.add('idle');

    // --- Scale transition.
    //
    // Timed against the wall clock rather than against frames, so a machine
    // rendering at eight frames a second takes the same 1.9 seconds to fall
    // through a scale as one rendering at two hundred.
    if (this.transitionT0 !== 0) {
      const t = (now - this.transitionT0) / 1000;
      const FALL = 0.55;
      const RISE = 0.85;
      if (t < FALL) {
        // Falling in: the light drains away and the field of view narrows.
        const k = t / FALL;
        this.engine.exposure = Math.max(0, 1 - k * k);
        this.engine.camera.fov = this.baseFov() * (1 - 0.23 * k * k);
        this.engine.camera.updateProjectionMatrix();
      } else {
        if (!this.transitionDone && this.transitionTarget) {
          this.enter(this.transitionTarget);
          this.transitionTarget = null;
          this.transitionDone = true;
        }
        const k = Math.min(1, (t - FALL) / RISE);
        this.engine.exposure = k * k * (3 - 2 * k);
        this.engine.camera.fov = this.baseFov() * (0.77 + 0.23 * k);
        this.engine.camera.updateProjectionMatrix();
        if (k >= 1) {
          this.transitionT0 = 0;
          this.engine.exposure = 1;
          this.engine.camera.fov = this.baseFov();
          this.engine.camera.updateProjectionMatrix();
          this.controls.locked = false;
          this.stage?.onResize();
        }
      }
    }

    // --- Time
    if (this.stage) {
      if (this.stage.id === 'cosmos') {
        if (this.playing && !this.scrubbing) {
          this.timeline.setU(this.timeline.u + dt * 0.02);
          this.epochA = this.timeline.a;
          if (this.timeline.u >= 1) this.togglePlay();
        }
        this.stage.timeScale = 0;
        this.stage.update(dt);
      } else {
        const warp = WARPS[this.warpIndex];
        const base = this.stage.timeScale;
        this.stage.timeScale = this.playing ? base * warp.scale : 0;
        this.stage.update(dt);
        this.stage.timeScale = base;
        const rel = this.boost > 1e-4
          ? ` · β ${this.boost >= 0.9999 ? this.boost.toFixed(8) : this.boost.toFixed(3)}` +
            ` · γ ${lorentz(this.boost) < 100 ? lorentz(this.boost).toFixed(2)
              : lorentz(this.boost).toExponential(1)}`
          : '';
        this.warpEl.textContent = (this.playing
          ? `${warp.label} · ${this.stage.scaleLabel()}`
          : `paused · ${this.stage.scaleLabel()}`) + rel;
      }
      this.controls.update(dt);

      // --- Relativistic flight. Beta is eased rather than jumped: the
      //     interesting part of aberration is watching the sky slide forward,
      //     and that only reads if it takes a moment. The easing runs in the
      //     rapidity, not in beta, because beta crowds against 1 and rapidity
      //     does not - it is the quantity that actually adds.
      const targetBeta = BOOSTS[this.boostIndex];
      const rap = (b: number) => Math.atanh(Math.min(b, 0.999999999));
      const k = 1 - Math.exp(-dt * 1.6);
      const nowRap = rap(this.boost) + (rap(targetBeta) - rap(this.boost)) * k;
      this.boost = Math.tanh(nowRap);
      if (this.boost < 1e-4) this.boost = 0;
      // Forward is where the camera is pointing.
      this.engine.camera.getWorldDirection(this.boostDir);
      this.stage.setBoost(this.boost, this.boostDir);
    }

    this.engine.render(dt);

    if (this.frame % 6 === 0 && this.stage) {
      this.fps += (1 / Math.max(dt, 1e-4) - this.fps) * 0.15;
      for (const r of this.stage.rows()) this.readout.set(r.k, r.v, r.u);
      this.readout.set('__fps', this.fps.toFixed(0), 'fps');
    }
  }

  private baseFov(): number { return this.stage?.baseFov ?? 60; }

  /** Growth factor at the current epoch, for external readouts. */
  get growth(): number { return growthFactor(this.cosmology, this.epochA); }
}

const HELP_HTML = `
  <div>
    <h3>Navigate</h3>
    <dl>
      <dt>drag</dt><dd>orbit the focus</dd>
      <dt>shift + drag</dt><dd>pan</dd>
      <dt>scroll</dt><dd>zoom, exponentially</dd>
      <dt>W A S D</dt><dd>fly; Q and E for down and up</dd>
      <dt>shift</dt><dd>×6 speed</dd>
    </dl>
  </div>
  <div>
    <h3>Explore</h3>
    <dl>
      <dt>click</dt><dd>inspect what is under the cursor</dd>
      <dt>enter</dt><dd>descend a scale</dd>
      <dt>backspace</dt><dd>climb back up</dd>
      <dt>double click</dt><dd>dive into an object</dd>
      <dt>+ &nbsp; −</dt><dd>detail</dd>
    </dl>
  </div>
  <div>
    <h3>Time</h3>
    <dl>
      <dt>space</dt><dd>run or pause</dd>
      <dt>[ &nbsp; ]</dt><dd>epoch, or time warp</dd>
      <dt>drag timeline</dt><dd>scrub 13.8 billion years</dd>
      <dt>R</dt><dd>rewind to the dark ages</dd>
    </dl>
  </div>
  <div>
    <h3>Look</h3>
    <dl>
      <dt>V</dt><dd>tint by peculiar velocity</dd>
      <dt>L</dt><dd>observe a cluster as a deep field</dd>
      <dt>K</dt><dd>show lensing critical curves</dd>
      <dt>M</dt><dd>collide this galaxy with another</dd>
      <dt>C</dt><dd>change the cosmology</dd>
      <dt>U</dt><dd>hide the interface</dd>
      <dt>F</dt><dd>fullscreen</dd>
      <dt>T</dt><dd>true scale in a system</dd>
      <dt>J</dt><dd>fly at a fraction of light speed</dd>
      <dt>P</dt><dd>save a frame</dd>
    </dl>
  </div>
  <div class="close">press H or escape to return</div>
`;

export { sig, Universe, Stage };
