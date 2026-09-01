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
