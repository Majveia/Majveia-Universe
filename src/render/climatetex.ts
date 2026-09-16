/**
 * The climate, as something a shader can read.
 *
 * The solver produces a grid of temperatures - one row per season, one column
 * per latitude band - and the surface shader needs to ask it questions at
 * arbitrary points: what is the temperature *here*, at this moment in the
 * planet's year? So the grid goes into a texture, and the hardware's bilinear
 * filter does the interpolation in both axes for nothing.
 *
 * The mapping is chosen so no trigonometry is needed in the shader. A latitude
 * band's coordinate is `sin(latitude)`, which for a unit sphere in the body
 * frame is simply the y component of the surface point - the shader already has
 * it. The season wraps, so the texture repeats vertically and a year comes back
 * round to itself with no seam.
 *
 * Four channels, and each one is a thing the surface does:
 *
 *   R  temperature, normalised over the world's own range
 *   G  whether liquid water is possible here and now
 *   B  precipitation, which is where the deserts are not
 *   A  insolation, which is what drives the whole thing
 */

import * as THREE from 'three';
import type { Climate } from '../astro/climate';
import { liquidWaterPossible } from '../astro/radiation';

export interface ClimateTexture {
  texture: THREE.DataTexture;
  /** Temperature range the R channel is normalised over, K. */
  range: [number, number];
  dispose: () => void;
}

/**
 * Pack a solved climate into an RGBA texture of `bands` by `seasons` texels.
 *
 * Eight bits of temperature over a world's own range is about a fifth of a
 * kelvin for an Earth-like planet, which is finer than the model's own
 * resolution and far finer than anything the eye can read off a coastline.
 */
export function climateTexture(cl: Climate, pressureBar: number): ClimateTexture {
  const nb = cl.bandCount, ns = cl.seasons;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < cl.field.length; i++) {
    if (cl.field[i] < lo) lo = cl.field[i];
    if (cl.field[i] > hi) hi = cl.field[i];
  }
  // A degenerate range - an isothermal world like Venus - would divide by zero.
  if (!(hi > lo + 1)) { hi = lo + 1; }

  const data = new Uint8Array(nb * ns * 4);
  for (let s = 0; s < ns; s++) {
    for (let i = 0; i < nb; i++) {
      const k = (s * nb + i) * 4;
      const t = cl.field[s * nb + i];
      data[k] = Math.round(255 * Math.min(1, Math.max(0, (t - lo) / (hi - lo))));
      data[k + 1] = liquidWaterPossible(t, pressureBar) ? 255 : 0;
      data[k + 2] = Math.round(255 * Math.min(1, cl.precipField[s * nb + i] / 3));
      data[k + 3] = Math.round(255 * Math.min(1, cl.bands[i].insolation / 600));
    }
  }

  const tex = new THREE.DataTexture(data, nb, ns, THREE.RGBAFormat, THREE.UnsignedByteType);
  // Latitude clamps at the poles; the year wraps, so December runs into
  // January without a seam.
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;

  return { texture: tex, range: [lo, hi], dispose: () => tex.dispose() };
}
