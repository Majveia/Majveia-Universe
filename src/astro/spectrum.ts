/**
 * Stellar spectra.
 *
 * A star's spectrum is the single most informative thing about it, and almost
 * everything else in this simulation is downstream of it. The continuum is a
 * Planck curve, so its shape gives the temperature and its peak obeys Wien's
 * law. Cut into it are absorption lines from the atoms and molecules in the
 * photosphere, and their strengths are the reason the spectral sequence exists
 * at all.
 *
 * The crucial and non-obvious point - the one Cecilia Payne worked out in 1925,
 * against her examiners' advice - is that line strength measures **excitation
 * and ionisation, not abundance**. Hydrogen is the most abundant element in
 * every star on this list, and yet the hydrogen lines are strongest in A stars
 * and weak in both O stars and M stars. In an O star hydrogen is ionised and
 * has no electron left to make a Balmer line with; in an M star it is neutral
 * but sitting in the ground state, and the Balmer series starts from the first
 * excited state, which at 3500 K is almost empty. Only around 9500 K is the
 * balance right. Every curve in this file is a version of that argument:
 *
 *  - He II needs 54 eV to ionise and only appears above about 30000 K.
 *  - He I peaks near 20000 K and is gone by A0.
 *  - The Balmer series peaks at A0, 9500 K.
 *  - The metals - Ca, Fe, Mg, Na - strengthen all the way down through F, G
 *    and K as more of them stay neutral and unexcited.
 *  - Ca II H and K, from a species that ionises easily and excites hard, are
 *    the strongest features in the solar spectrum.
 *  - Below about 4000 K, molecules survive: TiO bands take over the optical
 *    entirely and are what make an M dwarf's spectrum look like a comb.
 *
 * The line depths here are a smooth parameterisation of those curves, not a
 * radiative transfer calculation. The shapes and the orderings are right; the
 * absolute equivalent widths are indicative.
 */

/** Planck's law in wavelength form, W m^-3 sr^-1. */
export function planck(lambdaM: number, tempK: number): number {
  const h = 6.62607015e-34, c = 2.99792458e8, k = 1.380649e-23;
  const l = Math.max(lambdaM, 1e-12);
  const x = (h * c) / (l * k * Math.max(tempK, 1));
  // expm1 keeps the Rayleigh-Jeans end from cancelling to zero.
  return (2 * h * c * c) / (Math.pow(l, 5) * Math.expm1(x));
}

/** Wien's displacement law: the wavelength of peak emission, nanometres. */
export function wienPeakNm(tempK: number): number {
  return 2.897771955e6 / Math.max(tempK, 1);
}

export interface SpectralLine {
  /** Rest wavelength, nanometres. */
  nm: number;
  /** What produces it. */
  species: string;
  /** Line width, nanometres - pressure and rotation broadened. */
  widthNm: number;
  /** Temperature of maximum strength, K. */
  peakK: number;
  /** Width of the strength curve in log10 T. */
  spreadDex: number;
  /** Depth at maximum, as a fraction of the continuum. */
  depth: number;
  /** Short label, for the ones worth naming on a plot. */
  label?: string;
}

/**
 * The optical lines that actually define the spectral sequence, with the
 * temperature at which each is strongest.
 */
export const LINES: SpectralLine[] = [
  // --- Hydrogen: the Balmer series, strongest at A0.
  { nm: 656.28, species: 'H I', label: 'Hα', widthNm: 3.4, peakK: 9500, spreadDex: 0.15, depth: 0.62 },
  { nm: 486.13, species: 'H I', label: 'Hβ', widthNm: 3.0, peakK: 9500, spreadDex: 0.15, depth: 0.58 },
  { nm: 434.05, species: 'H I', label: 'Hγ', widthNm: 2.6, peakK: 9500, spreadDex: 0.15, depth: 0.52 },
  { nm: 410.17, species: 'H I', label: 'Hδ', widthNm: 2.4, peakK: 9500, spreadDex: 0.15, depth: 0.46 },
  { nm: 397.01, species: 'H I', widthNm: 2.2, peakK: 9500, spreadDex: 0.15, depth: 0.40 },

  // --- Helium: neutral in B stars, ionised only in O stars.
  { nm: 447.15, species: 'He I', label: 'He I', widthNm: 1.1, peakK: 19000, spreadDex: 0.13, depth: 0.34 },
  { nm: 402.62, species: 'He I', widthNm: 1.0, peakK: 20000, spreadDex: 0.13, depth: 0.24 },
  { nm: 587.56, species: 'He I', widthNm: 1.0, peakK: 18000, spreadDex: 0.13, depth: 0.22 },
  { nm: 468.57, species: 'He II', label: 'He II', widthNm: 1.4, peakK: 40000, spreadDex: 0.16, depth: 0.30 },

  // --- Ionised calcium: the strongest lines in the solar spectrum.
  { nm: 393.37, species: 'Ca II', label: 'K', widthNm: 1.6, peakK: 5300, spreadDex: 0.28, depth: 0.78 },
  { nm: 396.85, species: 'Ca II', label: 'H', widthNm: 1.5, peakK: 5300, spreadDex: 0.28, depth: 0.72 },

  // --- Neutral metals, strengthening all the way down the sequence.
  { nm: 422.67, species: 'Ca I', widthNm: 0.9, peakK: 4400, spreadDex: 0.20, depth: 0.42 },
  { nm: 430.5, species: 'CH', label: 'G band', widthNm: 3.2, peakK: 5000, spreadDex: 0.17, depth: 0.40 },
  { nm: 438.35, species: 'Fe I', widthNm: 0.8, peakK: 5200, spreadDex: 0.22, depth: 0.30 },
  { nm: 495.76, species: 'Fe I', widthNm: 0.7, peakK: 5000, spreadDex: 0.22, depth: 0.24 },
  { nm: 518.36, species: 'Mg I', label: 'Mg b', widthNm: 1.6, peakK: 5200, spreadDex: 0.20, depth: 0.44 },
  { nm: 589.16, species: 'Na I', label: 'Na D', widthNm: 1.3, peakK: 4200, spreadDex: 0.24, depth: 0.52 },
  { nm: 766.49, species: 'K I', widthNm: 1.2, peakK: 3400, spreadDex: 0.20, depth: 0.36 },

  // --- Molecules. Nothing survives above about 4500 K, and below that they
  //     take over the whole optical.
  { nm: 476.0, species: 'TiO', widthNm: 6.0, peakK: 3100, spreadDex: 0.13, depth: 0.30 },
  { nm: 495.4, species: 'TiO', widthNm: 6.0, peakK: 3100, spreadDex: 0.13, depth: 0.34 },
  { nm: 516.5, species: 'TiO', label: 'TiO', widthNm: 7.0, peakK: 3100, spreadDex: 0.13, depth: 0.44 },
  { nm: 543.0, species: 'TiO', widthNm: 7.0, peakK: 3100, spreadDex: 0.13, depth: 0.40 },
  { nm: 567.0, species: 'TiO', widthNm: 8.0, peakK: 3100, spreadDex: 0.13, depth: 0.46 },
  { nm: 616.0, species: 'TiO', widthNm: 9.0, peakK: 3000, spreadDex: 0.13, depth: 0.52 },
  { nm: 665.0, species: 'TiO', widthNm: 10.0, peakK: 3000, spreadDex: 0.13, depth: 0.58 },
  { nm: 705.0, species: 'TiO', widthNm: 11.0, peakK: 2900, spreadDex: 0.13, depth: 0.60 },
  { nm: 767.0, species: 'TiO', widthNm: 12.0, peakK: 2800, spreadDex: 0.13, depth: 0.62 },
];

/**
 * How strong a line is at a given temperature, 0 to 1.
 *
 * A log-normal in temperature: excitation and ionisation both go as
 * exponentials of 1/T, so a species is present over a range that is roughly
 * symmetric in log T and asymmetric in T - which is what the observed curves
 * of growth look like.
 */
export function lineStrength(line: SpectralLine, tempK: number): number {
  const x = (Math.log10(Math.max(tempK, 500)) - Math.log10(line.peakK)) / line.spreadDex;
  return Math.exp(-x * x);
}

/**
 * Metal line blanketing: cool stars have so many overlapping metal lines in the
 * blue that the continuum itself is depressed. It is why a K star looks redder
 * than its temperature alone would make it, and it is a real opacity effect and
 * not a line.
 */
export function blanketing(nm: number, tempK: number, metallicity = 0): number {
  if (tempK > 7000) return 1;
  const cool = Math.min(1, (7000 - tempK) / 3200);
  const blue = Math.max(0, (520 - nm) / 160);
  const z = Math.pow(10, metallicity);
  return 1 - Math.min(0.55, cool * blue * 0.5 * z);
}

export interface SpectrumOptions {
  /** [Fe/H], dex. More metals means deeper metal lines. */
  metallicity?: number;
  /** Projected rotation, km/s - smears every line. */
  vsini?: number;
}

/**
 * Relative flux at a wavelength: the Planck continuum, blanketed, with every
 * line cut into it.
 *
 * @param nm wavelength in nanometres
 * @param tempK effective temperature
 */
export function fluxAt(nm: number, tempK: number, opts: SpectrumOptions = {}): number {
  const z = opts.metallicity ?? 0;
  const smear = 1 + (opts.vsini ?? 0) / 90;
  let f = planck(nm * 1e-9, tempK) * blanketing(nm, tempK, z);
  for (const line of LINES) {
    const w = line.widthNm * smear;
    const dx = (nm - line.nm) / w;
    if (Math.abs(dx) > 4) continue;
    // Metals and molecules scale with metallicity; hydrogen and helium do not.
    const metal = line.species !== 'H I' && line.species !== 'He I' && line.species !== 'He II';
    const abundance = metal ? Math.min(2.2, Math.pow(10, z * 0.7)) : 1;
    const d = line.depth * lineStrength(line, tempK) * abundance / smear;
    f *= 1 - Math.min(0.97, d) * Math.exp(-dx * dx);
  }
  return f;
}

/**
 * Sample the spectrum across the visible band, normalised so the maximum is 1.
 *
 * @param n number of samples between `fromNm` and `toNm`
 */
export function sampleSpectrum(
  tempK: number, n = 320, fromNm = 380, toNm = 780, opts: SpectrumOptions = {},
): Float32Array {
  const out = new Float32Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) {
    const nm = fromNm + ((toNm - fromNm) * i) / (n - 1);
    const f = fluxAt(nm, tempK, opts);
    out[i] = f;
    if (f > max) max = f;
  }
  if (max > 0) for (let i = 0; i < n; i++) out[i] /= max;
  return out;
}

/** The lines worth naming for this star: the ones deep enough to see. */
export function prominentLines(tempK: number, threshold = 0.18): SpectralLine[] {
  return LINES.filter((l) => l.label && l.depth * lineStrength(l, tempK) > threshold);
}

/**
 * The colour of a wavelength, as linear RGB. Used to paint the spectrum strip
 * under the curve; a rough fit to the CIE colour matching functions.
 */
export function wavelengthRGB(nm: number): [number, number, number] {
  let r = 0, g = 0, b = 0;
  if (nm >= 380 && nm < 440) { r = -(nm - 440) / 60; b = 1; }
  else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
  else if (nm < 510) { g = 1; b = -(nm - 510) / 20; }
  else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
  else if (nm < 645) { r = 1; g = -(nm - 645) / 65; }
  else if (nm <= 780) { r = 1; }
  // The eye's response falls off at both ends of the visible band.
  let f = 1;
  if (nm < 420) f = 0.3 + (0.7 * (nm - 380)) / 40;
  else if (nm > 700) f = 0.3 + (0.7 * (780 - nm)) / 80;
  return [r * f, g * f, b * f];
}
