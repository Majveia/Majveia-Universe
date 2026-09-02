/**
 * Eclipse geometry.
 *
 * An eclipse is not a special case of anything. It is two circles on the sky
 * overlapping, and every part of the phenomenon follows from how much of the
 * star's disc the other circle covers:
 *
 *  - **Totality** needs the occulting disc to be the larger of the two. The
 *    Moon manages it over the Earth only because it is 400 times smaller than
 *    the Sun and 400 times closer, and it will stop managing it: the Moon is
 *    receding, and in a few hundred million years every solar eclipse on Earth
 *    will be annular.
 *  - **Annularity** is what happens when it is not - a ring of star left
 *    around a black disc, and daylight that dims but never goes.
 *  - **The penumbra** is the region where the overlap is partial, and its
 *    width on the ground is set by the star's angular size. A point source
 *    would give a knife edge.
 *
 * This module is the CPU copy of the same expression the shaders evaluate per
 * fragment, so the readout and the picture cannot disagree.
 */

/** Angular radius of a sphere of radius r seen from distance d, radians. */
export function angularRadius(r: number, d: number): number {
  if (!(d > 0)) return Math.PI / 2;
  return Math.asin(Math.min(1, r / d));
}

/**
 * Fraction of a disc of angular radius `rs` covered by a disc of angular radius
 * `ro` whose centre is `sep` radians away.
 *
 * @returns 0 when they do not touch, 1 at totality, and `(ro/rs)^2` when the
 *          occulting disc sits wholly inside the star's - the annular case.
 */
export function discOverlapFraction(rs: number, ro: number, sep: number): number {
  if (!(rs > 0)) return 0;
  if (ro <= 0) return 0;
  const d = Math.abs(sep);
  if (d >= rs + ro) return 0;
  if (d <= ro - rs) return 1;
  if (d <= rs - ro) return (ro * ro) / (rs * rs);
  const d2 = d * d, rs2 = rs * rs, ro2 = ro * ro;
  const a1 = Math.min(1, Math.max(-1, (d2 + rs2 - ro2) / (2 * d * rs)));
  const a2 = Math.min(1, Math.max(-1, (d2 + ro2 - rs2) / (2 * d * ro)));
  const tri = Math.max(0, (-d + rs + ro) * (d + rs - ro) * (d - rs + ro) * (d + rs + ro));
  const area = rs2 * Math.acos(a1) + ro2 * Math.acos(a2) - 0.5 * Math.sqrt(tri);
  return Math.min(1, Math.max(0, area / (Math.PI * rs2)));
}

/**
 * Whether an occulter can ever cover the star completely from where it is -
 * the difference between a total eclipse and an annular one, decided entirely
 * by which disc is bigger on the sky.
 */
export function canBeTotal(starAngRad: number, occAngRad: number): boolean {
  return occAngRad >= starAngRad;
}

/**
 * Eclipse magnitude as observers report it: the fraction of the star's
 * *diameter* covered, not of its area. Magnitude 1 is the onset of totality.
 */
export function eclipseMagnitude(rs: number, ro: number, sep: number): number {
  if (!(rs > 0)) return 0;
  return Math.min(Math.max((rs + ro - sep) / (2 * rs), 0), (rs + ro) / (2 * rs));
}

/** A short human label for what the sky is doing, given the light left. */
export function eclipseLabel(lit: number, total: boolean): string {
  if (lit > 0.999) return '';
  if (lit < 1e-4) return 'total';
  if (!total && lit < 0.06) return 'annular';
  return `${((1 - lit) * 100).toFixed(0)}% obscured`;
}
