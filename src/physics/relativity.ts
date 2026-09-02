/**
 * What the sky looks like from something moving fast enough for it to matter.
 *
 * Three effects, all from the same Lorentz transformation, all of them
 * appearing together and never one without the others:
 *
 *  **Aberration.** Directions are not invariant. A photon arriving at angle θ
 *  from the direction of travel in the rest frame arrives at θ' in the moving
 *  frame with cos θ' = (cos θ + β)/(1 + β cos θ). The whole sky slides forward.
 *  At β = 0.9 the entire celestial sphere behind you is squeezed into a patch
 *  ahead barely 50° across, and the stars that were beside you are now in
 *  front. This is not the same as the classical aberration of starlight Bradley
 *  found in 1728 - that is the first-order term of this.
 *
 *  **Doppler.** The frequency shifts by the factor D = 1/[γ(1 − β cos θ')],
 *  which is a blueshift ahead and a redshift behind, with a transverse shift
 *  at 90° that has no classical counterpart at all: even light arriving exactly
 *  sideways is redshifted by 1/γ, purely from time dilation.
 *
 *  **Beaming.** Iν/ν³ is a Lorentz invariant, so the bolometric surface
 *  brightness transforms as D⁴. The sky ahead does not merely blueshift, it
 *  gets brighter as the fourth power, and the sky behind goes dark just as
 *  fast. This is the headlight effect, and it is why a relativistic jet pointed
 *  at us outshines the galaxy it comes from.
 *
 * A blackbody stays a blackbody under all of this: only its temperature
 * changes, to T·D. That is what makes the cosmic microwave background the most
 * spectacular thing about relativistic flight. It is at 2.725 K, which is to
 * say invisible, until D reaches a few hundred - and then the forward sky, the
 * whole of it, comes up through infrared into a dull red glow and keeps going.
 */

/** Lorentz factor. */
export function gamma(beta: number): number {
  const b = Math.min(Math.abs(beta), 0.9999999999);
  return 1 / Math.sqrt(1 - b * b);
}

/**
 * Aberration, rest frame to moving frame: where a source at angle `theta` from
 * the direction of travel appears to an observer moving at `beta`.
 *
 * @param theta angle from the direction of travel in the rest frame, radians
 * @returns the angle the same source is seen at while moving, radians
 */
export function aberrate(theta: number, beta: number): number {
  const c = Math.cos(theta);
  return Math.acos(Math.min(1, Math.max(-1, (c + beta) / (1 + beta * c))));
}

/**
 * The inverse: given where something *appears* while moving, the direction it
 * actually lies in. This is the one a renderer needs, because it starts from
 * the pixel and has to find the source.
 */
export function unaberrate(thetaObserved: number, beta: number): number {
  const c = Math.cos(thetaObserved);
  return Math.acos(Math.min(1, Math.max(-1, (c - beta) / (1 - beta * c))));
}

/**
 * Doppler factor D = ν_observed/ν_emitted for light arriving at `thetaObserved`
 * from the direction of travel, as measured in the moving frame.
 *
 * Straight ahead this is √((1+β)/(1−β)); straight behind, its reciprocal; and
 * at 90° it is 1/γ, the transverse redshift, which is time dilation and
 * nothing else.
 */
export function dopplerFactor(thetaObserved: number, beta: number): number {
  return 1 / (gamma(beta) * (1 - beta * Math.cos(thetaObserved)));
}

/**
 * Ratio of observed to emitted bolometric surface brightness. Iν/ν³ is
 * invariant, and integrating over frequency puts the exponent at four.
 */
export function beamingFactor(thetaObserved: number, beta: number): number {
  const d = dopplerFactor(thetaObserved, beta);
  return d * d * d * d;
}

/** A blackbody stays a blackbody; only its temperature is Doppler-shifted. */
export function shiftedTemperature(tempK: number, doppler: number): number {
  return tempK * doppler;
}

/** Temperature of the cosmic microwave background, K. */
export const T_CMB = 2.7255;

/**
 * The CMB temperature seen at a given angle while moving - the dipole.
 *
 * At the Solar System's 370 km/s through the CMB rest frame this is a
 * 3.36 mK peak-to-trough asymmetry, which is the largest anisotropy in the
 * microwave sky by two orders of magnitude and the first thing any CMB
 * experiment has to subtract.
 */
export function cmbTemperature(thetaObserved: number, beta: number): number {
  return T_CMB * dopplerFactor(thetaObserved, beta);
}

/**
 * Roughly the fraction of a blackbody's power that lands in the visible band,
 * from the Wien tail: exp(−hc/λkT) at λ = 550 nm, where hc/λk = 26170 K.
 *
 * It is the steepness of this that makes the CMB switch on so abruptly. The
 * background is invisible at D = 100 and blinding at D = 1000, because the
 * exponential moves faster than anything else in the problem.
 */
export function visibleFraction(tempK: number): number {
  return Math.exp(-26170 / Math.max(tempK, 1));
}

/**
 * Half-angle, in radians, containing the light that came from the entire
 * forward hemisphere at rest - the "headlight cone". At β = 0.99 the whole
 * front half of the sky fits inside 8°.
 */
export function headlightHalfAngle(beta: number): number {
  return aberrate(Math.PI / 2, beta);
}

/**
 * Proper time elapsed on board for a given coordinate time, seconds. One year
 * of ship time at β = 0.9999995 is a thousand years outside.
 */
export function properTime(coordinateTimeS: number, beta: number): number {
  return coordinateTimeS / gamma(beta);
}
