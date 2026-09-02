/**
 * Draws a star's spectrum into a small canvas: the visible band from 380 to
 * 780 nm, painted in its own colours, with the Planck continuum over it and
 * the absorption lines cut into that.
 *
 * The point of putting it in the inspector is that it is the same numbers the
 * rest of the simulation runs on, shown a different way. The star's colour, its
 * temperature, its luminosity and the shape of this curve are all the same
 * fact, and a G star and an M dwarf differ here far more obviously than they do
 * as two dots on a screen.
 */

import { sampleSpectrum, prominentLines, wavelengthRGB, wienPeakNm } from '../astro/spectrum';

const FROM = 380, TO = 780;

export interface SpectrumPlotOptions {
  tempK: number;
  metallicity?: number;
  vsini?: number;
  width?: number;
  height?: number;
}

/** Build a canvas showing the spectrum of a star at this temperature. */
export function spectrumCanvas(opts: SpectrumPlotOptions): HTMLCanvasElement {
  const w = opts.width ?? 236;
  const h = opts.height ?? 86;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  cv.style.cssText = `width:${w}px;height:${h}px;display:block;margin:10px 0 2px`;
  const g = cv.getContext('2d');
  if (!g) return cv;
  g.scale(dpr, dpr);

  const n = Math.max(120, Math.round(w * 1.4));
  const flux = sampleSpectrum(opts.tempK, n, FROM, TO, {
    metallicity: opts.metallicity, vsini: opts.vsini,
  });
  const plotH = h - 12;
  const x = (i: number) => (i / (n - 1)) * w;
  const y = (f: number) => plotH - f * (plotH - 4);

  // --- The band itself, in its own colours, dimmed where the star is dark.
  for (let i = 0; i < n; i++) {
    const nm = FROM + ((TO - FROM) * i) / (n - 1);
    const [r, gr, b] = wavelengthRGB(nm);
    const f = flux[i];
    // Gamma-encode for display; the sampled flux is linear.
    const s = Math.pow(Math.max(f, 0), 1 / 2.2);
    g.fillStyle = `rgb(${Math.round(r * 255 * s)},${Math.round(gr * 255 * s)},${Math.round(b * 255 * s)})`;
    g.fillRect(x(i), y(f), w / (n - 1) + 1, plotH - y(f));
  }

  // --- The continuum-plus-lines curve on top of it.
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const px = x(i), py = y(flux[i]);
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.strokeStyle = 'rgba(255,255,255,.82)';
  g.lineWidth = 1;
  g.stroke();

  // --- Baseline and Wien peak.
  g.strokeStyle = 'rgba(255,255,255,.16)';
  g.beginPath();
  g.moveTo(0, plotH + 0.5);
  g.lineTo(w, plotH + 0.5);
  g.stroke();

  const peak = wienPeakNm(opts.tempK);
  if (peak > FROM && peak < TO) {
    const px = ((peak - FROM) / (TO - FROM)) * w;
    g.strokeStyle = 'rgba(255,255,255,.30)';
    g.setLineDash([2, 3]);
    g.beginPath();
    g.moveTo(px, 0);
    g.lineTo(px, plotH);
    g.stroke();
    g.setLineDash([]);
  }

  // --- Label the lines deep enough to be worth naming.
  g.font = '8px ui-monospace, SFMono-Regular, Menlo, monospace';
  g.textAlign = 'center';
  g.fillStyle = 'rgba(255,255,255,.55)';
  const used: number[] = [];
  for (const line of prominentLines(opts.tempK)) {
    if (line.nm < FROM || line.nm > TO) continue;
    const px = ((line.nm - FROM) / (TO - FROM)) * w;
    if (used.some((u) => Math.abs(u - px) < 22)) continue;
    used.push(px);
    g.fillText(line.label ?? '', Math.min(w - 10, Math.max(10, px)), h - 2);
  }
  return cv;
}
