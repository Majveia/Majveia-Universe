/**
 * Development harness.
 *
 * Renders one subsystem at a time against a black background so its look can be
 * tuned in isolation, with every parameter reachable from the console. Not part
 * of the shipped experience; it is how the shipped experience got tuned.
 */

import * as THREE from 'three';
import './ui/styles.css';
import { Engine } from './render/engine';
import { Controls } from './camera/controls';
import { galaxyFromHalo, buildGalaxy, rotationCurve } from './galaxy/generator';
import { GalaxyView } from './render/galaxyview';
import { hashString } from './core/rng';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const engine = new Engine({ canvas });
const controls = new Controls(engine.camera, canvas);

engine.exposure = Number(params.get('exp') ?? 1);
engine.bloomStrength = Number(params.get('bloom') ?? 0.8);
engine.bloomThreshold = Number(params.get('thr') ?? 0.8);
engine.vignette = 0.45;
engine.saturation = 1.12;

function resize() {
  engine.setSize(window.innerWidth, window.innerHeight, Math.min(devicePixelRatio || 1, 2));
}
window.addEventListener('resize', resize);
resize();

const seed = hashString(params.get('seed') ?? 'ANDROMEDA');
const halo = Number(params.get('halo') ?? 1.4e12);
const gp = galaxyFromHalo(seed, halo, Number(params.get('env') ?? 0));
if (params.get('type')) (gp as { type: string }).type = params.get('type') as string;
const buf = buildGalaxy(gp, { count: Number(params.get('stars') ?? 500000) });
const view = new GalaxyView(buf);
engine.scene.add(view.group);

view.setFlux(Number(params.get('flux') ?? 1));
view.setStarSize(Number(params.get('size') ?? 1.5));
if (params.has('dust')) view.setDust(Number(params.get('dust')));

const R = gp.radiusKpc;
controls.snapTo(new THREE.Vector3(), R * Number(params.get('d') ?? 2.6),
  Number(params.get('theta') ?? 0.4), Number(params.get('phi') ?? 0.75));
controls.minDistance = 0.02;
controls.maxDistance = R * 40;
engine.camera.near = 0.01;
engine.camera.far = R * 200;
engine.camera.updateProjectionMatrix();

let last = performance.now();
let spin = params.get('spin') !== '0';
function tick(now: number) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  controls.update(dt);
  view.update(engine.camera.position, spin ? dt * Number(params.get('rate') ?? 40) : 0);
  engine.render(dt);
}
requestAnimationFrame(tick);

// eslint-disable-next-line no-console
console.info('[lab]', gp.name, gp.type,
  `M*=${gp.stellarMassMsun.toExponential(2)}`,
  `Rd=${gp.discScaleKpc.toFixed(2)}kpc`, `R25=${R.toFixed(1)}kpc`,
  `vmax=${gp.vMaxKms.toFixed(0)}km/s`, `arms=${gp.arms}`,
  `pitch=${(gp.pitch * 180 / Math.PI).toFixed(1)}deg`,
  `Trot=${buf.stats.rotationPeriodMyr.toFixed(0)}Myr`,
  `fDM=${buf.stats.darkMatterFraction.toFixed(2)}`,
  `vc(8kpc)=${rotationCurve(gp, 8).toFixed(0)}km/s`);

Object.assign(window as unknown as Record<string, unknown>, {
  lab: {
    engine, controls, view, gp, buf, ready: true,
    setFlux: (v: number) => view.setFlux(v),
    setSize: (v: number) => view.setStarSize(v),
    setDust: (v: number) => view.setDust(v),
    setSpin: (v: boolean) => { spin = v; },
    engineSet: (o: Record<string, number>) => Object.assign(engine, o),
  },
});

// --- Optional subsystem: a planetary system, for tuning planet shaders.
if (params.get('mode') === 'system') {
  const { makeStar } = await import('./astro/stellar');
  const { buildSystem } = await import('./astro/planets');
  const { SystemView } = await import('./render/systemview');
  engine.scene.remove(view.group);
  const st = makeStar(Number(params.get('mass') ?? 1), Number(params.get('age') ?? 4.6), 0);
  const sys = buildSystem(st, seed, params.get('star') ?? 'Kestrel');
  const sv = new SystemView(sys, seed, {
    bodyScale: Number(params.get('bodyscale') ?? 700),
    starScale: Number(params.get('starscale') ?? 14),
  });
  engine.scene.add(sv.group);
  const span = sys.planets.length ? sys.planets[sys.planets.length - 1].au : 5;
  controls.snapTo(new THREE.Vector3(), span * Number(params.get('d') ?? 1.6),
    Number(params.get('theta') ?? 0.5), Number(params.get('phi') ?? 0.62));
  controls.minDistance = 1e-5;
  controls.maxDistance = span * 40;
  engine.camera.near = 1e-4;
  engine.camera.far = span * 400;
  engine.camera.updateProjectionMatrix();
  let t = Number(params.get('t0') ?? 0);
  const rate = Number(params.get('rate') ?? 3e6);
  const step = () => {
    requestAnimationFrame(step);
    t += rate / 60;
    sv.update(t, engine.camera);
  };
  requestAnimationFrame(step);
  // eslint-disable-next-line no-console
  console.info('[lab:system]', st.spectralClass + st.subClass, 'planets:',
    sys.planets.map((p) => `${p.name} ${p.cls} ${p.au.toFixed(2)}AU ` +
      `${(p.massKg / 5.972e24).toFixed(2)}Me ${p.surfaceK.toFixed(0)}K` +
      `${p.habitable ? ' HABITABLE' : ''}${p.rings.length ? ' rings' : ''}` +
      `${p.moons.length ? ` ${p.moons.length}moons` : ''}`).join(' | '));
  (window as unknown as Record<string, unknown>).labSystem = sv;
}

// --- Optional subsystem: one planet, close up.
if (params.get('mode') === 'planet') {
  const { makeStar } = await import('./astro/stellar');
  const { buildSystem } = await import('./astro/planets');
  const { PlanetView } = await import('./render/planet');
  engine.scene.remove(view.group);
  const st = makeStar(Number(params.get('mass') ?? 1), Number(params.get('age') ?? 4.6), 0);
  const which = params.get('planet') ?? 'habitable';
  const match = (pl: { habitable: boolean; massKg: number; rings: unknown[]; cls: string }) =>
    which === 'habitable' ? pl.habitable
    : which === 'giant' ? pl.massKg > 60 * 5.97e24
    : which === 'ring' ? pl.rings.length > 0
    : pl.cls === which;
  // Scan seeds until the requested kind of world turns up, so any planet class
  // can be inspected without hunting for a seed by hand.
  let sys = buildSystem(st, seed, 'Test');
  let target = sys.planets.find(match);
  for (let k = 1; !target && k < 400; k++) {
    sys = buildSystem(st, seed + k * 7919, 'Test');
    target = sys.planets.find(match);
  }
  if (!target) target = sys.planets[0];
  const pv = new PlanetView(target, { radius: 1, segments: 160 });
  engine.scene.add(pv.group);
  controls.snapTo(new THREE.Vector3(), Number(params.get('d') ?? 2.9),
    Number(params.get('theta') ?? 0.6), Number(params.get('phi') ?? 1.2));
  controls.minDistance = 1.02;
  controls.maxDistance = 60;
  engine.camera.near = 0.005;
  engine.camera.far = 500;
  engine.camera.updateProjectionMatrix();
  const sunAngle = Number(params.get('sun') ?? 0.9);
  const sunDir = new THREE.Vector3(Math.cos(sunAngle), 0.25, Math.sin(sunAngle)).normalize();
  const sunCol = new THREE.Color(st.color[0], st.color[1], st.color[2])
    .multiplyScalar(Number(params.get('irr') ?? 1.0));
  let t = 0;
  const step = () => {
    requestAnimationFrame(step);
    t += Number(params.get('rate') ?? 60);
    pv.update(sunDir, sunCol, t, pv.group.position);
  };
  requestAnimationFrame(step);
  // eslint-disable-next-line no-console
  console.info('[lab:planet]', target.name, target.cls,
    `${(target.massKg / 5.972e24).toFixed(2)} Me`,
    `${(target.radiusM / 6.371e6).toFixed(2)} Re`,
    `${target.surfaceK.toFixed(0)} K`, `${target.pressureBar.toFixed(3)} bar`,
    `ocean ${(target.oceanFraction * 100).toFixed(0)}%`,
    `cloud ${(target.cloudCover * 100).toFixed(0)}%`,
    `atm ${target.atmosphere}`, `moons ${target.moons.length}`,
    `rings ${target.rings.length}`, `bio ${target.biosphere.toFixed(2)}`);
  (window as unknown as Record<string, unknown>).labPlanet = pv;
}
