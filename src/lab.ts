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
// Reachable from the console for every mode, not just the galaxy one.
(window as unknown as Record<string, unknown>).labEngine = engine;

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
view.setViewport(window.innerHeight, engine.camera.fov);
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
  const { sampleCompanion } = await import('./astro/binary');
  const { RNG } = await import('./core/rng');
  const st = makeStar(Number(params.get('mass') ?? 1), Number(params.get('age') ?? 4.6), 0);
  let companion = null;
  if (params.get('binary') === '1') {
    const brng = new RNG(seed ^ 0x9911);
    for (let k = 0; k < 200 && !companion; k++) companion = sampleCompanion(brng, st, 4.6, 0);
  }
  const sys = buildSystem(st, seed, params.get('star') ?? 'Kestrel', companion);
  const sv = new SystemView(sys, seed, {
    minAngularRadius: Number(params.get('minang') ?? 0.0045),
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
  const followComet = params.get('comet') === '1';
  // Freezing the clock at a chosen epoch makes a still frame reproducible: a
  // comet's whole apparition lasts months, which is a fraction of a second at
  // orrery speed.
  const tstop = params.has('tstop') ? Number(params.get('tstop')) : Infinity;
  let cometIdx = -1;
  const step = () => {
    requestAnimationFrame(step);
    if (t < tstop) t = Math.min(tstop, t + rate / 60);
    sv.update(t, engine.camera);
    if (followComet && sv.comets.length) {
      // Lock onto one comet for the whole run - switching between them mid-shot
      // just teleports the camera. Default to whichever is brightest on the
      // first frame, which is the one worth watching.
      if (cometIdx < 0) {
        cometIdx = params.has('ci') ? Number(params.get('ci')) % sv.comets.length
          : sv.comets.reduce((bi, c, i, arr) => (c.activityNow > arr[bi].activityNow ? i : bi), 0);
      }
      const best = sv.comets[cometIdx];
      const [x, y, z] = best.position;
      controls.snapTo(new THREE.Vector3(x, y, z),
        Number(params.get('cd') ?? 0.55), controls.theta, controls.phi);
    }
  };
  requestAnimationFrame(step);
  // eslint-disable-next-line no-console
  console.info('[lab:system]', st.spectralClass + st.subClass,
    sys.companion ? `binary sep=${(sys.companion.aM / 1.496e11).toFixed(2)}AU e=${sys.companion.e.toFixed(2)} host=${sys.host}` : 'single',
    'planets:',
    sys.planets.map((p) => `${p.name} ${p.cls} ${p.au.toFixed(2)}AU ` +
      `${(p.massKg / 5.972e24).toFixed(2)}Me ${p.surfaceK.toFixed(0)}K` +
      `${p.habitable ? ' HABITABLE' : ''}${p.rings.length ? ' rings' : ''}` +
      `${p.moons.length ? ` ${p.moons.length}moons` : ''}`).join(' | '));
  (window as unknown as Record<string, unknown>).labSystem = sv;
}

// --- Optional subsystem: a planetary nebula, on its own.
//
// The ring is the thing to check here: it must come out of the path length
// through the shell and nothing else, so the way to test it is to vary the
// thickness and watch the ring sharpen. ?t is the age in years, which is also
// the size, since the shell only ever does 25 km/s.
if (params.get('mode') === 'pn') {
  const { NebulaShellView } = await import('./render/nebulashell');
  const pnMod = await import('./astro/planetarynebula');
  const { SkyDome } = await import('./render/skydome');
  engine.scene.remove(view.group);
  engine.scene.add(new SkyDome({
    brightness: 0.5, bandStrength: 0.006, seed, nebula: 0.004,
  }).mesh);

  const mass = Number(params.get('mass') ?? 1);
  const pn = pnMod.planetaryNebula(mass);
  const yr0 = Number(params.get('t') ?? 6000);
  const AU_M = 1.495978707e11;
  const mk = (yr: number) => {
    const tS = yr * 365.25 * 86400;
    return {
      au: pnMod.shellRadius(pn, tS) / AU_M,
      thick: pnMod.shellThickness(pn, tS),
      ion: pnMod.ionisedFraction(pn, tS),
      refl: pnMod.reflectedBrightness(pn, tS),
      bright: pnMod.shellBrightness(pn, tS),
    };
  };
  const st0 = mk(yr0);
  const shell = new NebulaShellView({
    radius: st0.au,
    thickness: params.has('thick') ? Number(params.get('thick')) : st0.thick,
    centralTempK: Number(params.get('tempK') ?? pn.centralTempK),
    brightness: params.has('bright') ? Number(params.get('bright'))
      : Math.max(st0.ion * st0.bright, 0.05) * 1.3,
    waist: Number(params.get('waist') ?? 0.55),
    seed,
  });
  shell.setAxis(new THREE.Vector3(0.18, 1, 0.1));
  shell.setPhase(st0.ion, st0.refl);
  shell.setArcs(yr0 / pnMod.pulseIntervalYears(pn));
  engine.scene.add(shell.mesh);

  controls.snapTo(new THREE.Vector3(), st0.au * Number(params.get('d') ?? 3.4),
    Number(params.get('theta') ?? 0.5), Number(params.get('phi') ?? 0.35));
  controls.minDistance = st0.au * 1e-3;
  controls.maxDistance = st0.au * 60;
  engine.camera.near = st0.au * 1e-3;
  engine.camera.far = st0.au * 400;
  engine.camera.updateProjectionMatrix();

  let yr = yr0;
  const rate = Number(params.get('rate') ?? 0);
  const step = () => {
    requestAnimationFrame(step);
    if (rate) {
      yr += rate / 60;
      const c = mk(yr);
      shell.setGeometry(c.au, c.thick);
      shell.setPhase(c.ion, c.refl);
      shell.setArcs(yr / pnMod.pulseIntervalYears(pn));
      shell.setBrightness(Math.max(c.ion * c.bright, 0.05) * 1.3);
    }
    shell.update(engine.camera);
  };
  requestAnimationFrame(step);
  // eslint-disable-next-line no-console
  console.info('[lab:pn]', `${mass} Msun ->`,
    `core ${pn.remnantMsun.toFixed(3)} Msun at ${(pn.centralTempK / 1000).toFixed(0)} kK,`,
    `${pnMod.coreLuminosityLsun(pn).toFixed(0)} Lsun,`,
    `ejected ${pn.ejectedMsun.toFixed(3)} Msun;`,
    `at ${yr0} yr: r=${st0.au.toFixed(0)} AU thick=${st0.thick.toFixed(3)}`,
    `bright=${st0.bright.toFixed(4)} ion=${st0.ion.toFixed(3)} refl=${st0.refl.toFixed(3)};`,
    `lights up at ${(pnMod.transitionTimeS(pn) / 3.156e7).toFixed(0)} yr;`,
    `visible ${(pn.lifetimeS / 3.156e7 / 1000).toFixed(1)} kyr`);
  (window as unknown as Record<string, unknown>).labPN = shell;
  (window as unknown as Record<string, unknown>).lab = { ready: true, engine, controls };
}

// --- Optional subsystem: a galaxy collision, integrated live.
if (params.get('mode') === 'encounter') {
  const { Encounter } = await import('./sim/encounter');
  const { PointCloud } = await import('./render/pointcloud');
  const { SkyDome } = await import('./render/skydome');
  engine.scene.remove(view.group);
  engine.scene.add(new SkyDome({ brightness: 0.3, bandStrength: 0.002, seed, nebula: 0 }).mesh);
  const model = new Encounter(gp, {
    seed,
    tracers: Number(params.get('tracers') ?? 30000),
    massRatio: params.has('ratio') ? Number(params.get('ratio')) : undefined,
    pericentre: params.has('peri') ? Number(params.get('peri')) : undefined,
    prograde: params.get('retro') !== '1',
  });
  const cloud = new PointCloud(model.count, model.colors, model.style);
  cloud.setSize(Number(params.get('psize') ?? 1.7));
  cloud.setBrightness(Number(params.get('pbri') ?? 0.30));
  engine.scene.add(cloud.points);
  controls.snapTo(new THREE.Vector3(), model.scaleKpc * Number(params.get('d') ?? 2.2),
    Number(params.get('theta') ?? 0.3), Number(params.get('phi') ?? 0.85));
  controls.minDistance = 0.5;
  controls.maxDistance = model.scaleKpc * 40;
  engine.camera.near = 0.05;
  engine.camera.far = model.scaleKpc * 400;
  engine.camera.updateProjectionMatrix();
  const perFrame = Number(params.get('sub') ?? 2);
  const step = () => {
    requestAnimationFrame(step);
    for (let i = 0; i < perFrame; i++) model.step(model.dt);
    cloud.updateFrom(model.pos, model.count);
  };
  requestAnimationFrame(step);
  // eslint-disable-next-line no-console
  console.info('[lab:encounter]', model.label, 'tracers', model.count,
    'dt', model.dt.toFixed(2), 'Myr', 'scale', model.scaleKpc.toFixed(0), 'kpc');
  Object.assign((window as unknown as Record<string, Record<string, unknown>>).lab, {
    model, cloud,
    advance: (myr: number) => {
      const n = Math.round(myr / model.dt);
      for (let i = 0; i < n; i++) model.step(model.dt);
      cloud.updateFrom(model.pos, model.count);
    },
    time: () => model.time,
    sep: () => model.separation,
  });
}

// --- Optional subsystem: a black hole.
if (params.get('mode') === 'blackhole') {
  const { BlackHoleView } = await import('./render/blackhole');
  engine.scene.remove(view.group);
  const M = 1;
  const bh = new BlackHoleView({
    massMsun: Number(params.get('mass') ?? 4.3e6),
    gravitationalRadius: M,
    diskInner: Number(params.get('rin') ?? 6),
    diskOuter: Number(params.get('rout') ?? 24),
    temperature: Number(params.get('temp') ?? 11000),
    steps: Number(params.get('steps') ?? 240),
    diskBrightness: Number(params.get('disk') ?? 0.42),
    skyBrightness: Number(params.get('skyb') ?? 1.0),
  });
  engine.scene.add(bh.mesh);
  bh.setDiskNormal(new THREE.Vector3(0, 1, 0));
  // Near-edge-on: the view that shows the disc bent up over the top of the hole.
  controls.snapTo(new THREE.Vector3(), Number(params.get('d') ?? 42),
    Number(params.get('theta') ?? 0.0), Number(params.get('phi') ?? 1.40));
  controls.minDistance = 4;
  controls.maxDistance = 400;
  engine.camera.near = 0.5;
  engine.camera.far = 1e5;
  engine.camera.updateProjectionMatrix();
  let t = 0;
  const step = () => {
    requestAnimationFrame(step);
    t += 0.016 * Number(params.get('rate') ?? 1);
    bh.update(engine.camera.position, t);
  };
  requestAnimationFrame(step);
  Object.assign((window as unknown as Record<string, Record<string, unknown>>).lab, {
    bh,
    setDisk: (v: number) => bh.setDiskBrightness(v),
    setTemp: (v: number) => bh.setTemperature(v),
    setSky: (v: number) => bh.setSkyBrightness(v),
    setSteps: (v: number) => bh.setSteps(v),
  });
}

// --- Optional subsystem: a nebula.
if (params.get('mode') === 'nebula') {
  const { NebulaView } = await import('./render/nebula');
  const { SkyDome } = await import('./render/skydome');
  engine.scene.remove(view.group);
  const dome = new SkyDome({ brightness: 0.9, bandStrength: 0.012, seed, nebula: 0.006 });
  dome.mesh.scale.setScalar(1e5);
  engine.scene.add(dome.mesh);
  const neb = new NebulaView({
    radius: 10,
    seed,
    shape: Number(params.get('shape') ?? 1) as 0 | 1 | 2 | 3,
    density: Number(params.get('dens') ?? 1.4),
    dust: Number(params.get('dust') ?? 0.4),
    emission: Number(params.get('emis') ?? 1.6),
    steps: Number(params.get('steps') ?? 72),
    sources: [
      { x: 0.1, y: 0.55, z: 0.05, strength: 0.12, color: [0.75, 0.85, 1.0] },
      { x: -0.35, y: 0.4, z: -0.2, strength: 0.05, color: [0.85, 0.9, 1.0] },
    ],
  });
  engine.scene.add(neb.mesh);
  controls.snapTo(new THREE.Vector3(), Number(params.get('d') ?? 26),
    Number(params.get('theta') ?? 0.4), Number(params.get('phi') ?? 1.3));
  controls.minDistance = 0.5;
  controls.maxDistance = 200;
  engine.camera.near = 0.05;
  engine.camera.far = 1e6;
  engine.camera.updateProjectionMatrix();
  let t = 0;
  const step = () => {
    requestAnimationFrame(step);
    t += 0.016;
    neb.update(engine.camera.position, t);
  };
  requestAnimationFrame(step);
  Object.assign((window as unknown as Record<string, Record<string, unknown>>).lab, {
    neb, setEmis: (v: number) => neb.setEmission(v), setDens: (v: number) => neb.setDensity(v),
  });
}

// --- Optional subsystem: two black holes and the waves they make.
if (params.get('mode') === 'merger') {
  const { MergerView } = await import('./render/mergerview');
  engine.scene.remove(view.group);
  const mv = new MergerView({
    m1: Number(params.get('m1') ?? 36),
    m2: Number(params.get('m2') ?? 29),
    startSeparation: Number(params.get('a0') ?? 26),
    fieldRadius: Number(params.get('fr') ?? 300),
  });
  engine.scene.add(mv.group);
  controls.snapTo(new THREE.Vector3(), Number(params.get('d') ?? 430),
    Number(params.get('theta') ?? 0.4), Number(params.get('phi') ?? 0.42));
  controls.minDistance = 8;
  controls.maxDistance = 4000;
  engine.camera.near = 0.5;
  engine.camera.far = 20000;
  engine.camera.updateProjectionMatrix();
  // eslint-disable-next-line no-console
  console.info('[lab:merger]', `rg=${(mv.rgM / 1e3).toFixed(1)}km`,
    `inspiral=${mv.inspiralS.toFixed(3)}s`,
    `ringdown=${mv.ringdownMode.freqHz.toFixed(0)}Hz`);
  let t = params.has('t') ? Number(params.get('t')) : -mv.inspiralS;
  const rate = Number(params.get('rate') ?? 1);
  const frozen = params.has('t');
  const step = () => {
    requestAnimationFrame(step);
    if (!frozen) {
      t += 0.016 * rate;
      if (t > 0.6) t = -mv.inspiralS;
    }
    mv.update(t, engine.camera);
  };
  requestAnimationFrame(step);
  (window as unknown as Record<string, unknown>).labMerger = mv;
}

// --- Optional subsystem: one planet, close up.
if (params.get('mode') === 'planet') {
  const { makeStar } = await import('./astro/stellar');
  const { buildSystem } = await import('./astro/planets');
  const { PlanetView } = await import('./render/planet');
  engine.scene.remove(view.group);
  const st = makeStar(Number(params.get('mass') ?? 1), Number(params.get('age') ?? 4.6), 0);
  const which = params.get('planet') ?? 'habitable';
  const match = (pl: {
    habitable: boolean; massKg: number; rings: unknown[]; moons: unknown[]; cls: string;
  }) =>
    which === 'habitable' ? pl.habitable
    : which === 'giant' ? pl.massKg > 60 * 5.97e24
    : which === 'ring' ? pl.rings.length > 0
    : which === 'moons' ? pl.moons.length > 0
    : which === 'wet' ? pl.habitable && pl.moons.length > 0
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
  // Angular radius of the star from here: what sets terminator width and the
  // size of an umbra. Default to the Sun seen from 1 AU.
  const starAng = Number(params.get('starang') ?? 0.00465);
  pv.setSunAngularRadius(starAng);
  let auroraView: import('./render/aurora').AuroraView | undefined;

  // Aurora, from this world's own magnetosphere.
  {
    const { AuroraView } = await import('./render/aurora');
    const mg = await import('./physics/magnetosphere');
    const mag = {
      massKg: target.massKg, radiusM: target.radiusM, dayS: target.dayS,
      ageGyr: st.ageGyr, surfaceK: target.surfaceK,
    };
    const wind = mg.windPressure(target.au, st.luminosityLsun)
      * Number(params.get('storm') ?? 1);
    const L = mg.standoffRadii(mag, wind);
    const pw = mg.auroralPower(mag, wind);
    // eslint-disable-next-line no-console
    console.info('[lab:aurora]', `B=${(mg.surfaceField(mag) / 3.05e-5).toFixed(3)} B_E`,
      `L=${L.toFixed(2)} R`, `oval=${(mg.ovalColatitude(L) * 57.2958).toFixed(1)} deg`,
      `power=${pw.toExponential(2)} x Earth`);
    if (params.get('aurora') !== '0' && L > 1.4) {
      const av = new AuroraView({
        radius: 1,
        height: Math.min(0.16, Math.max(0.022, 400e3 / target.radiusM)),
        ovalColatitude: mg.ovalColatitude(L),
        power: Number(params.get('apow')
          ?? Math.min(3.2, 0.55 * Math.pow(Math.max(pw, 1e-6), 0.32))),
        tilt: mg.dipoleTilt(target.surfaceSeed),
        tiltAzimuth: ((target.surfaceSeed % 997) / 997) * Math.PI * 2,
      });
      pv.group.add(av.mesh);
      auroraView = av;
      (window as unknown as Record<string, unknown>).labAurora = av;
    }
  }

  // Moons, so eclipses and phases can be looked at directly.
  const { MoonView } = await import('./render/moon');
  const scaleM = 1 / target.radiusM;
  const moonViews = target.moons.map((m, i) => {
    const r = Math.max(m.radiusM * scaleM, 0.02);
    const mv = new MoonView(r, { color: m.color, seed: target.surfaceSeed + i * 7919 }, 64);
    mv.setSunAngularRadius(starAng);
    engine.scene.add(mv.mesh);
    return { mv, r, a: Math.max(m.a * scaleM, 3), phase: m.phase, inc: m.i };
  });
  // Park a moon exactly between the world and its star, which is the one
  // configuration worth being able to ask for on purpose.
  const eclipse = Number(params.get('eclipse') ?? 0);
  const moonSpin = Number(params.get('mspin') ?? 0);
  void auroraView;

  let t = 0;
  const step = () => {
    requestAnimationFrame(step);
    t += Number(params.get('rate') ?? 60);
    pv.update(sunDir, sunCol, t, pv.group.position);
    auroraView?.update(engine.camera, sunDir, t, pv.surface.rotation.y);
    moonViews.forEach((m, i) => {
      if (eclipse > 0 && i === 0) {
        // Drift it across the line so the penumbra sweeps past.
        const off = new THREE.Vector3(-sunDir.z, 0, sunDir.x)
          .multiplyScalar((eclipse - 1) * m.r * 1.6);
        m.mv.mesh.position.copy(sunDir).multiplyScalar(m.a).add(off);
      } else {
        const th = m.phase + moonSpin * t * 1e-4 + i * 1.7;
        m.mv.mesh.position.set(
          m.a * Math.cos(th), m.a * Math.sin(th) * Math.sin(m.inc),
          m.a * Math.sin(th) * Math.cos(m.inc));
      }
      m.mv.update(sunDir, sunCol);
    });
    const occ = moonViews.map((m) => ({ pos: m.mv.mesh.position, radius: m.r }));
    pv.setOccluders(occ);
    moonViews.forEach((m, i) => m.mv.setOccluders([
      { pos: pv.group.position, radius: 1 },
      ...occ.filter((_, j) => j !== i),
    ]));
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
