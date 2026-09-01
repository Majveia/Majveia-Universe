/**
 * Majveia — a simulated universe.
 *
 * Entry point: builds the renderer, generates a realisation of the universe in
 * a worker, and hands control to the player.
 */

import * as THREE from 'three';
import './ui/styles.css';

import { Engine } from './render/engine';
import { Controls } from './camera/controls';
import { CosmicWebRenderer } from './render/cosmicweb';
import { Timeline } from './ui/timeline';
import { Rows, el, sig, commas, formatDistance } from './ui/hud';
import {
  PLANCK18, PRESET_COSMOLOGIES, Cosmology, growthFactor, growthRate, ageAt, HofaKmsMpc,
  Tcmb_a, zFromA, particleHorizon, decelerationParameter, Om_a,
} from './cosmology/lcdm';
import type { CosmicWebField } from './cosmology/zeldovich';
import { peculiarVelocityFactor } from './cosmology/zeldovich';
import { hashString } from './core/rng';
import { GYR, MPC } from './core/constants';
import CosmicWebWorker from './cosmology/web.worker?worker&inline';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const params = new URLSearchParams(location.search);
const SEED_TEXT = params.get('seed') ?? randomSeedText();
const SEED = hashString(SEED_TEXT);

function randomSeedText(): string {
  const syl = ['ka', 'thu', 'ma', 'vei', 'or', 'lyn', 'dra', 'sel', 'ith', 'no', 'zar', 'ea', 'vos', 'ri'];
  let s = '';
  const n = 3 + Math.floor(Math.random() * 2);
  for (let i = 0; i < n; i++) s += syl[Math.floor(Math.random() * syl.length)];
  return s.toUpperCase();
}

function pickGridSize(): number {
  const req = params.get('n');
  if (req) {
    const v = parseInt(req, 10);
    if ([32, 64, 128, 256].includes(v)) return v;
  }
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (mem >= 8 && cores >= 8) return 128;
  if (mem >= 4 && cores >= 4) return 128;
  return 64;
}

const GRID = pickGridSize();

/** Look parameters, overridable from the query string while tuning. */
const LOOK = {
  brightness: Number(params.get('bri') ?? 0.55),
  sizeCells: Number(params.get('sz') ?? 0.18),
  bloom: Number(params.get('bloom') ?? 0.72),
  exposure: Number(params.get('exp') ?? 1.0),
};
const BOX_MPC = Number(params.get('box') ?? 620);

// ---------------------------------------------------------------------------
// Boot screen
// ---------------------------------------------------------------------------

const uiRoot = document.getElementById('ui') as HTMLDivElement;
const boot = el('div', 'boot');
const bootBar = el('i');
const bootLabel = el('div', 'label', 'allocating spacetime');
boot.append(el('div', 'title', 'Majveia'), (() => {
  const b = el('div', 'bar'); b.append(bootBar); return b;
})(), bootLabel);
document.body.append(boot);

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const engine = new Engine({ canvas });
const controls = new Controls(engine.camera, canvas);
const scene = engine.scene;

engine.exposure = LOOK.exposure;
engine.bloomStrength = LOOK.bloom;
engine.bloomThreshold = 0.85;
engine.bloomRadius = 1.25;
engine.vignette = 0.55;
engine.saturation = 1.16;

let cosmology: Cosmology = PLANCK18;
let web: CosmicWebRenderer | null = null;
let field: CosmicWebField | null = null;

// The camera lives in comoving Mpc at this scale.
controls.snapTo(new THREE.Vector3(BOX_MPC / 2, BOX_MPC / 2, BOX_MPC / 2), BOX_MPC * 0.42, 0.7, 1.15);
controls.minDistance = 0.4;
controls.maxDistance = BOX_MPC * 6;
engine.camera.near = 0.05;
engine.camera.far = BOX_MPC * 12;
engine.camera.updateProjectionMatrix();

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, params.has('dpr') ? Number(params.get('dpr')) : 2);
  engine.setSize(window.innerWidth, window.innerHeight, dpr);
}
window.addEventListener('resize', () => { resize(); web?.setViewport(engine.size[1], engine.camera.fov); });
resize();

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

const masthead = el('div', 'layer dimmable masthead');
const h1 = el('h1', undefined, 'Majveia');
const sub = el('div', 'sub', 'A universe assembled from the Friedmann equations, a Gaussian random field, and gravity.');
const seedEl = el('div', 'seed', `SEED ${SEED_TEXT}`);
masthead.append(h1, sub, seedEl);

const readout = new Rows([
  { key: 'z', label: 'redshift', accent: true },
  { key: 't', label: 'cosmic time' },
  { key: 'a', label: 'scale factor' },
  { key: 'D', label: 'growth D(a)' },
  { key: 'H', label: 'H(z)' },
  { key: 'Tcmb', label: 'CMB' },
  { key: 'horizon', label: 'horizon' },
  { key: 'scale', label: 'field of view' },
  { key: 'draw', label: 'particles' },
  { key: 'fps', label: 'frame' },
]);

const timeline = new Timeline(120, 8);

const hint = el('div', 'layer dimmable hint');
hint.innerHTML =
  '<b>drag</b> orbit &nbsp; <b>scroll</b> zoom &nbsp; <b>wasd</b> fly<br>' +
  '<b>space</b> run time &nbsp; <b>[ ]</b> step epoch<br>' +
  '<b>h</b> controls &nbsp; <b>f</b> fullscreen';

const rail = el('div', 'layer dimmable rail');
function railButton(label: string, fn: (b: HTMLButtonElement) => void, on = false): HTMLButtonElement {
  const b = el('button', on ? 'on' : undefined, label);
  b.addEventListener('click', () => fn(b));
  rail.append(b);
  return b;
}

const help = el('div', 'help');
const helpPanel = el('div', 'panel');
helpPanel.innerHTML = `
  <div>
    <h3>Navigate</h3>
    <dl>
      <dt>drag</dt><dd>orbit the focus</dd>
      <dt>shift + drag</dt><dd>pan</dd>
      <dt>scroll</dt><dd>zoom, exponentially</dd>
      <dt>W A S D</dt><dd>fly; Q / E for down and up</dd>
      <dt>shift</dt><dd>×6 speed</dd>
    </dl>
  </div>
  <div>
    <h3>Time</h3>
    <dl>
      <dt>space</dt><dd>run or pause cosmic time</dd>
      <dt>[ &nbsp; ]</dt><dd>step through epochs</dd>
      <dt>drag timeline</dt><dd>scrub 13.8 billion years</dd>
      <dt>R</dt><dd>rewind to the dark ages</dd>
    </dl>
  </div>
  <div>
    <h3>Look</h3>
    <dl>
      <dt>V</dt><dd>tint by peculiar velocity</dd>
      <dt>+ &nbsp; −</dt><dd>particle density</dd>
      <dt>C</dt><dd>change the cosmology</dd>
      <dt>U</dt><dd>hide the interface</dd>
      <dt>P</dt><dd>save a frame</dd>
    </dl>
  </div>
  <div class="close">press H or escape to return</div>
`;
help.append(helpPanel);

uiRoot.append(masthead, readout.el, timeline.el, hint, rail, help);

// ---------------------------------------------------------------------------
// Idle fade — the interface gets out of the way
// ---------------------------------------------------------------------------

let idleTimer = 0;
function wake(): void {
  idleTimer = 0;
  uiRoot.classList.remove('idle');
}
for (const ev of ['pointermove', 'pointerdown', 'wheel', 'keydown'] as const) {
  window.addEventListener(ev, wake, { passive: true });
}
controls.onInteract = wake;

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

let scaleFactor = 1;
let playing = false;
/** e-foldings of expansion per second of wall clock while running. */
let timeRate = 0.16;
let scrubbing = false;

timeline.onChange = (a) => { scaleFactor = a; };
timeline.onScrubStart = () => { scrubbing = true; playing = false; playBtn.classList.remove('on'); };
timeline.onScrubEnd = () => { scrubbing = false; };
timeline.setA(1);

const playBtn = railButton('▸ run time', (b) => {
  playing = !playing;
  b.classList.toggle('on', playing);
  b.textContent = playing ? '❚❚ pause time' : '▸ run time';
});

let velocityTint = false;
const velBtn = railButton('peculiar velocity', (b) => {
  velocityTint = !velocityTint;
  b.classList.toggle('on', velocityTint);
});

let detail = 1.0;
railButton('cosmology', () => cycleCosmology());
rail.append(el('div', 'divider'));
railButton('new universe', () => {
  const s = randomSeedText();
  location.search = `?seed=${s}${params.has('n') ? `&n=${params.get('n')}` : ''}`;
});
railButton('controls', () => help.classList.toggle('show'));

let cosmoIndex = 0;
function cycleCosmology(): void {
  cosmoIndex = (cosmoIndex + 1) % PRESET_COSMOLOGIES.length;
  cosmology = PRESET_COSMOLOGIES[cosmoIndex];
  sub.textContent = `${cosmology.name} · Ωm ${cosmology.Om.toFixed(3)} · ΩΛ ${cosmology.OL.toFixed(3)} · σ₈ ${cosmology.sigma8.toFixed(3)}`;
  flash(`cosmology → ${cosmology.name}`);
}

// A short-lived status line, bottom centre above the timeline.
const flashEl = el('div', 'layer');
flashEl.style.cssText =
  'left:50%;bottom:calc(var(--edge) + 62px);transform:translateX(-50%);font-size:10px;' +
  'letter-spacing:.2em;text-transform:uppercase;color:rgba(232,184,122,.9);opacity:0;' +
  'transition:opacity 300ms;pointer-events:none;text-align:center';
uiRoot.append(flashEl);
let flashTimer: number | undefined;
function flash(msg: string): void {
  flashEl.textContent = msg;
  flashEl.style.opacity = '1';
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => { flashEl.style.opacity = '0'; }, 1700);
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  switch (e.code) {
    case 'Space':
      e.preventDefault();
      playBtn.click();
      break;
    case 'KeyH':
    case 'Slash':
      help.classList.toggle('show');
      break;
    case 'Escape':
      help.classList.remove('show');
      break;
    case 'KeyU':
      uiRoot.classList.toggle('hidden');
      break;
    case 'KeyV':
      velBtn.click();
      break;
    case 'KeyC':
      cycleCosmology();
      break;
    case 'KeyR':
      timeline.setA(1 / 101);
      scaleFactor = timeline.a;
      flash('rewound to the dark ages');
      break;
    case 'KeyF':
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
      break;
    case 'KeyP':
      captureFrame();
      break;
    case 'BracketLeft':
      timeline.setU(Math.max(0, timeline.u - 0.035));
      scaleFactor = timeline.a;
      break;
    case 'BracketRight':
      timeline.setU(Math.min(1, timeline.u + 0.035));
      scaleFactor = timeline.a;
      break;
    case 'Equal':
    case 'NumpadAdd':
      detail = Math.min(1, detail * 1.35);
      applyDetail();
      break;
    case 'Minus':
    case 'NumpadSubtract':
      detail = Math.max(0.01, detail / 1.35);
      applyDetail();
      break;
    default:
      break;
  }
});

/**
 * Adaptive exposure.
 *
 * Additive rendering integrates every particle along the line of sight, so the
 * apparent brightness of the field depends on how deep you can see. We bound
 * that depth to a few times the camera's distance from its focus - which is
 * also what keeps the structure legible instead of piling a thousand
 * megaparsecs of filament into one pixel - and then scale the per-particle
 * brightness by cell/depth so the *column density* seen per pixel stays fixed.
 * The result is that the web reads the same whether you are outside the box or
 * standing inside a void, with no auto-exposure lag and no flicker.
 */
function updateExposure(): void {
  if (!web || !field) return;
  const cell = field.boxMpc / field.n;
  const depth = Math.max(cell * 8, Math.min(field.boxMpc * 1.6, controls.distance * 1.45));
  web.setLook({
    nearFade: depth * 0.16,
    fadeStart: depth * 0.30,
    fadeEnd: depth,
    brightness: LOOK.brightness * (cell / depth),
  });
}

function applyDetail(): void {
  web?.setDetail(detail, detail * 0.045);
  flash(`${commas((web?.drawnParticles ?? 0))} particles`);
}

function captureFrame(): void {
  engine.render(0);
  canvas.toBlob((b) => {
    if (!b) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = `majveia-${SEED_TEXT}-z${(1 / scaleFactor - 1).toFixed(2)}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, 'image/png');
  flash('frame saved');
}

// ---------------------------------------------------------------------------
// Generate the universe
// ---------------------------------------------------------------------------

const worker = new CosmicWebWorker();
worker.onmessage = (ev: MessageEvent) => {
  const m = ev.data;
  if (m.type === 'progress') {
    bootBar.style.width = `${(m.fraction * 100).toFixed(1)}%`;
    bootLabel.textContent = m.label;
  } else if (m.type === 'done') {
    field = m.field as CosmicWebField;
    onFieldReady(m.ms as number);
  } else if (m.type === 'error') {
    bootLabel.textContent = `generation failed: ${m.message}`;
  }
};
worker.postMessage({
  n: GRID, boxMpc: BOX_MPC, seed: SEED, cosmology: PLANCK18, smoothCells: 1.1,
});

function onFieldReady(ms: number): void {
  if (!field) return;
  web = new CosmicWebRenderer(field, {
    tiles: GRID >= 128 ? 3 : 3,
    detail: 1,
    neighbourDetail: GRID >= 128 ? 0.03 : 0.09,
  });
  web.setViewport(engine.size[1], engine.camera.fov);
  web.setLook({
    sizeCells: LOOK.sizeCells,
    minSize: 0.62,
    maxSize: 9.0,
    densityGain: 1.0,
    filamentBoost: 1.0,
  });
  updateExposure();
  scene.add(web.group);
  boot.classList.add('done');
  setTimeout(() => boot.remove(), 1400);
  // eslint-disable-next-line no-console
  console.info(
    `[majveia] ${commas(field.count)} particles · ${GRID}³ grid · ${BOX_MPC} Mpc box · ` +
    `generated in ${(ms / 1000).toFixed(1)}s · BAO scale ${field.baoScaleMpc.toFixed(1)} Mpc · ` +
    `${field.knots.length} collapsed haloes`);
  flash(`${commas(field.count)} particles · ${field.knots.length} haloes`);
}

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------

let last = performance.now();
let fpsAvg = 60;
let frame = 0;

function tick(now: number): void {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  frame++;

  if (playing && !scrubbing) {
    timeline.setU(timeline.u + timeRate * dt * 0.12);
    scaleFactor = timeline.a;
    if (timeline.u >= 1) { playing = false; playBtn.classList.remove('on'); playBtn.textContent = '▸ run time'; }
  }

  idleTimer += dt;
  if (idleTimer > 3.2) uiRoot.classList.add('idle');

  controls.update(dt);
  updateExposure();

  const D = growthFactor(cosmology, scaleFactor);
  if (web) {
    web.setGrowth(D);
    web.setCamera(engine.camera.position);
    if (velocityTint) {
      web.setLook({
        velocityTint: 1,
        velocityFactor: peculiarVelocityFactor(cosmology, scaleFactor),
      });
    } else {
      web.setLook({ velocityTint: 0 });
    }
  }

  engine.render(dt);

  if (frame % 6 === 0) updateReadout(dt, D);
}

function updateReadout(dt: number, D: number): void {
  fpsAvg += (1 / Math.max(dt, 1e-4) - fpsAvg) * 0.15;
  const z = zFromA(scaleFactor);
  readout.set('z', z >= 0 ? sig(z, 4) : `${sig(z, 3)}`, z < 0 ? 'future' : '');
  const t = ageAt(cosmology, scaleFactor) / GYR;
  readout.set('t', t.toFixed(t < 1 ? 4 : 3), 'Gyr');
  readout.set('a', scaleFactor.toFixed(4), '');
  readout.set('D', D.toFixed(4), '');
  readout.set('H', Math.round(HofaKmsMpc(cosmology, scaleFactor)).toString(), 'km/s/Mpc');
  readout.set('Tcmb', Tcmb_a(cosmology, scaleFactor).toFixed(2), 'K');
  const horiz = particleHorizon(cosmology, scaleFactor) / MPC;
  readout.set('horizon', sig(horiz, 4), 'Mpc');
  const [dv, du] = formatDistance(controls.distance * MPC);
  readout.set('scale', dv, du);
  readout.set('draw', commas(web?.drawnParticles ?? 0), '');
  readout.set('fps', fpsAvg.toFixed(0), 'fps');
  void growthRate; void decelerationParameter; void Om_a;
}

requestAnimationFrame(tick);

// Expose a small handle for debugging and for the screenshot harness.
Object.assign(window as unknown as Record<string, unknown>, {
  majveia: {
    engine, controls, get field() { return field; }, get web() { return web; },
    setEpoch(a: number) { timeline.setA(a); scaleFactor = a; },
    look(o: Record<string, number>) { web?.setLook(o as never); },
    setBrightness(b: number) { LOOK.brightness = b; updateExposure(); },
    setSize(v: number) { LOOK.sizeCells = v; web?.setLook({ sizeCells: v }); updateExposure(); },
    engineSet(o: Record<string, number>) { Object.assign(engine, o); },
    get ready() { return !!web; },
  },
});
