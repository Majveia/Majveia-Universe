/**
 * The two curves that would be all anyone ever saw of this planet.
 *
 * A transit light curve on top, a radial-velocity curve underneath, drawn from
 * the same masses and radii the rest of the simulation uses. The panel exists
 * to make the gap plain: everything else in the inspector is what the planet
 * *is*, and this is the entirety of what could be *known* about it from four
 * light years away.
 *
 * The light curve is drawn for an edge-on view - the case where a transit
 * happens at all - and the geometric probability of getting that view is
 * reported alongside, because for most planets it is under a per cent and the
 * curve is one nobody will ever record.
 */

import { transitFlux, transitDuration, radialVelocity } from '../astro/detection';

export interface DetectionPlotOptions {
  planetRadiusM: number;
  planetMassKg: number;
  starRadiusM: number;
  starMassKg: number;
  aM: number;
  periodS: number;
  e?: number;
  /** Radial-velocity semi-amplitude, m/s. */
  rvAmplitude: number;
  depthPpm: number;
  probability: number;
  width?: number;
  height?: number;
}

const AXIS = 'rgba(255,255,255,.14)';

export function detectionCanvas(o: DetectionPlotOptions): HTMLCanvasElement {
  const w = o.width ?? 236;
  const h = o.height ?? 108;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  cv.style.cssText = `width:${w}px;height:${h}px;display:block;margin:10px 0 2px`;
  const g = cv.getContext('2d');
  if (!g) return cv;
  g.scale(dpr, dpr);
  g.font = '8px ui-monospace, SFMono-Regular, Menlo, monospace';

  const pad = 2;
  const topH = h * 0.52 - pad;
  const botY = h * 0.52 + pad;
  const botH = h - botY - 10;

  // --- Transit, over three durations centred on mid-transit.
  const dur = transitDuration({
    planetRadiusM: o.planetRadiusM, starRadiusM: o.starRadiusM,
    aM: o.aM, periodS: o.periodS,
  });
  const span = Math.max(dur * 1.9, 1);
  const n = Math.max(120, Math.round(w * 1.5));
  const flux = new Float64Array(n);
  let lo = 1;
  for (let i = 0; i < n; i++) {
    const t = -span / 2 + (span * i) / (n - 1);
    flux[i] = transitFlux({
      planetRadiusM: o.planetRadiusM, starRadiusM: o.starRadiusM,
      aM: o.aM, periodS: o.periodS,
    }, t);
    if (flux[i] < lo) lo = flux[i];
  }
  const depth = Math.max(1 - lo, 1e-9);
  g.strokeStyle = AXIS;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(0, 4.5);
  g.lineTo(w, 4.5);
  g.stroke();
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * w;
    // The baseline sits near the top and the floor of the dip near the bottom,
    // so a 84 ppm transit and a 1% one are both readable.
    const y = 4.5 + ((1 - flux[i]) / depth) * (topH - 9);
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.strokeStyle = 'rgba(180,206,246,.92)';
  g.lineWidth = 1.2;
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,.45)';
  g.textAlign = 'left';
  g.fillText(`${o.depthPpm < 1e4 ? `${o.depthPpm.toFixed(0)} ppm` : `${(o.depthPpm / 1e4).toFixed(2)}%`}`
    + ` · ${(dur / 3600).toFixed(1)} h`, 1, topH - 1);
  g.textAlign = 'right';
  g.fillText(`p = ${(o.probability * 100).toFixed(o.probability < 0.01 ? 2 : 1)}%`, w - 1, topH - 1);

  // --- Radial velocity, over one full orbit.
  const e = o.e ?? 0;
  const mid = botY + botH / 2;
  g.strokeStyle = AXIS;
  g.beginPath();
  g.moveTo(0, mid + 0.5);
  g.lineTo(w, mid + 0.5);
  g.stroke();
  let peak = 1e-30;
  const vs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // True anomaly from the mean anomaly, two Newton steps - plenty for the
    // eccentricities a stable planetary system allows.
    const M = (2 * Math.PI * i) / (n - 1);
    let E = M + e * Math.sin(M);
    for (let k = 0; k < 3; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
    vs[i] = radialVelocity(o.rvAmplitude, nu, e);
    peak = Math.max(peak, Math.abs(vs[i]));
  }
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * w;
    const y = mid - (vs[i] / peak) * (botH * 0.42);
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.strokeStyle = 'rgba(232,184,122,.9)';
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,.45)';
  g.textAlign = 'left';
  const k = o.rvAmplitude;
  g.fillText(`K = ${k >= 1 ? `${k.toFixed(1)} m/s` : `${(k * 100).toFixed(1)} cm/s`}`, 1, h - 1);
  g.textAlign = 'right';
  // 0.3 m/s is about what the best stabilised spectrographs reach.
  g.fillText(k > 0.3 ? 'measurable' : 'below the noise', w - 1, h - 1);
  return cv;
}
