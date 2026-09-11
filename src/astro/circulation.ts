/**
 * The winds.
 *
 * A planet's surface is not a smooth gradient from a hot equator to cold poles.
 * It has *bands* - a wet equator, dry subtropics, stormy midlatitudes - and the
 * bands exist because the atmosphere is a fluid on a rotating sphere, so the
 * width of an overturning cell is set by how much angular momentum a parcel can
 * carry before the Coriolis force turns it.
 *
 * Two numbers come out of that, and between them they explain the appearance of
 * every atmosphere in the Solar System:
 *
 *  - **The Hadley cell edge.** Air rises at the hottest latitude, moves
 *    poleward conserving angular momentum, and by the time it has gone far
 *    enough its zonal wind is so large that the flow becomes unstable and it
 *    has to come down. Held and Hou (1980) put the turning point at
 *
 *        phi_H ~ sqrt( 5 g H Delta_H / (3 Omega^2 a^2) )
 *
 *    which is 30-35 degrees for Earth - and there, on cue, are the Sahara, the
 *    Kalahari, the Atacama, the Australian interior and the Arabian desert, all
 *    in one band in each hemisphere. Slow the rotation down and the cell
 *    reaches the pole: Venus has exactly one per hemisphere, and no deserts,
 *    because there is nowhere that is not the descending branch.
 *
 *  - **The Rhines scale.** On a rapidly rotating planet turbulence cannot form
 *    eddies larger than the scale at which the beta effect - the change of
 *    Coriolis parameter with latitude - turns them into waves instead. Energy
 *    that would have gone into big vortices goes into zonal jets, spaced by
 *
 *        L_beta = pi sqrt(2 U / beta),   beta = 2 Omega cos(phi) / a
 *
 *    Earth, rotating once a day and 6400 km across, fits about three jets per
 *    hemisphere. Jupiter, rotating in ten hours and eleven times wider, fits
 *    around a dozen - which is precisely the number of belts and zones you can
 *    count in a small telescope. Nothing about Jupiter's stripes is decorative.
 *    They are the Rhines scale made visible.
 */

import { R_DRY_AIR } from './radiation';

export interface CirculationInputs {
  /** Sidereal rotation period, s. Sign is ignored. */
  dayS: number;
  radiusM: number;
  gravity: number;
  /** Surface pressure, bar. */
  pressureBar: number;
  /** Equator-to-pole temperature difference, K. */
  gradientK: number;
  /** Mean surface temperature, K. */
  meanK: number;
  /** Scale height of the air column, m. */
  scaleHeightM: number;
}

export interface Circulation {
  /** Angular velocity, rad/s. */
  omega: number;
  /** Latitude where the Hadley cell's descending branch lands, rad. */
  hadleyEdge: number;
  /** Latitude of the midlatitude storm track, rad; equal to the pole if there is none. */
  stormTrack: number;
  /** Rossby deformation radius, m. */
  deformationRadius: number;
  /** Rhines scale - the jet spacing, m. */
  rhinesScale: number;
  /** Number of zonal jets from pole to pole. */
  jets: number;
  /** Characteristic zonal wind speed, m/s. */
  windSpeed: number;
  /** Thermal Rossby number: above ~1 the planet has one cell, below it, many. */
  thermalRossby: number;
  /** 'rapid' like Earth or Jupiter, 'slow' like Venus or Titan. */
  regime: 'rapid' | 'slow';
}

/** Angular velocity from a rotation period. */
export const angularVelocity = (dayS: number): number =>
  (2 * Math.PI) / Math.max(Math.abs(dayS), 1);

/**
 * Held-Hou latitude of the poleward edge of the Hadley cell.
 *
 * `Delta_H` here is the *radiative-equilibrium* fractional temperature contrast
 * the circulation is working against, which is larger than the contrast that
 * survives once the circulation has done its work - the cell exists to reduce
 * it. A factor of about two-thirds between them is the usual estimate.
 */
export function hadleyEdge(c: CirculationInputs): number {
  const omega = angularVelocity(c.dayS);
  const deltaH = Math.min(0.9, (c.gradientK * 1.6) / Math.max(c.meanK, 1));
  const H = Math.max(c.scaleHeightM * 1.8, 1e3);
  const denom = 3 * omega * omega * c.radiusM * c.radiusM;
  if (denom <= 0) return Math.PI / 2;
  const phi2 = (5 * c.gravity * H * deltaH) / denom;
  return Math.min(Math.PI / 2, Math.sqrt(Math.max(phi2, 0)));
}

/** Coriolis parameter at a latitude, 1/s. */
export const coriolis = (omega: number, lat: number): number => 2 * omega * Math.sin(lat);

/** Beta, the meridional gradient of the Coriolis parameter, 1/(m s). */
export const betaAt = (omega: number, radiusM: number, lat: number): number =>
  (2 * omega * Math.cos(lat)) / Math.max(radiusM, 1);

/**
 * Characteristic zonal wind, from thermal-wind balance.
 *
 * A horizontal temperature gradient tilts the pressure surfaces, and geostrophy
 * turns that tilt into a vertical wind shear: `du/dz = -(g / f T) dT/dy`.
 * Integrate it from the ground to the tropopause, three scale heights up, over
 * the quarter-circumference from equator to pole, and what comes out is the
 * jet.
 *
 * The same three lines give 38 m/s for Earth's jet stream, 16 m/s for
 * Jupiter's, and less than a metre a second at Venus's surface - three
 * atmospheres that share almost nothing else.
 */
export function zonalWind(c: CirculationInputs): number {
  // No air, no wind. An airless world's day-night contrast is enormous and
  // entirely radiative; nothing blows across it.
  if (c.pressureBar < 1e-5) return 0;
  const omega = angularVelocity(c.dayS);
  const f = Math.max(2 * omega * Math.SQRT1_2, 1e-12);
  const depth = 3 * Math.max(c.scaleHeightM, 1e3);
  const L = (Math.PI * c.radiusM) / 2;
  const u = (c.gravity * depth * Math.max(c.gradientK, 0.2)) / (f * Math.max(c.meanK, 1) * L);
  return Math.max(0.5, Math.min(u, 600));
}

/** Full circulation state for a world. */
export function circulation(c: CirculationInputs): Circulation {
  const omega = angularVelocity(c.dayS);
  const U = zonalWind(c);
  const beta = betaAt(omega, c.radiusM, Math.PI / 6);
  const rhines = U > 0
    ? Math.PI * Math.sqrt((2 * U) / Math.max(beta, 1e-18))
    : Infinity;
  // Jets fit across the pole-to-pole arc, pi a. Fewer than one means the
  // planet has a single overturning cell and no banding at all - and a planet
  // with no air has no jets to count.
  const jets = Number.isFinite(rhines)
    ? Math.max(1, Math.min(200, (Math.PI * c.radiusM) / Math.max(rhines, 1)))
    : 1;

  const edge = hadleyEdge(c);
  // The storm track sits on the poleward flank of the Hadley cell, where the
  // baroclinic zone is: the subtropical jet feeds it.
  const storm = Math.min(Math.PI / 2, edge * 1.75 + 0.12);

  const N2 = (c.gravity * c.gravity) / (1004 * Math.max(c.meanK, 1)); // Brunt-Vaisala squared
  const Ld = (Math.sqrt(Math.max(N2, 1e-12)) * Math.max(c.scaleHeightM, 1e3))
    / Math.max(2 * omega * Math.SQRT1_2, 1e-9);

  // Thermal Rossby number: the ratio of the pressure-gradient forcing to the
  // Coriolis force. Earth's is 0.05, Venus's is of order 100.
  const Ro = (R_DRY_AIR * Math.max(c.gradientK, 0.5))
    / (omega * omega * c.radiusM * c.radiusM);

  return {
    omega,
    hadleyEdge: edge,
    stormTrack: storm,
    deformationRadius: Ld,
    rhinesScale: rhines,
    jets,
    windSpeed: U,
    thermalRossby: Ro,
    regime: Ro > 1 ? 'slow' : 'rapid',
  };
}

/**
 * Latitude of the intertropical convergence zone - the rising branch, where the
 * trade winds of the two hemispheres meet and where most of a planet's rain
 * falls.
 *
 * It follows the subsolar latitude, but lags it, because the surface that
 * drives it takes time to warm. Earth's ITCZ reaches about 10 degrees north in
 * August, six weeks after the June solstice.
 */
export function itczLatitude(subsolarLat: number, hadley: number, lagFraction = 0.7): number {
  return Math.max(-hadley, Math.min(hadley, subsolarLat * lagFraction));
}

/**
 * Relative precipitation at a latitude, normalised so the global mean is one.
 *
 * Three features, and all three are the circulation seen from underneath: a
 * maximum at the rising branch, a minimum where the dried-out air comes back
 * down, and a second maximum where midlatitude storms carry moisture poleward.
 * Draw this curve for Earth and it is the pattern of the world's rainforests,
 * deserts and temperate belts, in that order, from the equator outwards.
 */
export function precipitation(lat: number, c: Circulation, itcz = 0): number {
  const d = Math.abs(lat - itcz);
  const rise = Math.exp(-((d / Math.max(c.hadleyEdge * 0.42, 0.05)) ** 2));
  const dry = Math.exp(-(((Math.abs(lat) - c.hadleyEdge) / Math.max(c.hadleyEdge * 0.5, 0.05)) ** 2));
  const storms = c.stormTrack < Math.PI / 2 - 0.05
    ? Math.exp(-(((Math.abs(lat) - c.stormTrack) / Math.max(c.hadleyEdge * 0.7, 0.08)) ** 2))
    : 0;
  // Cold air holds little water, so the poles are deserts too - the driest
  // place on Earth by precipitation is not the Sahara, it is Antarctica.
  const cold = Math.exp(-(((Math.abs(lat) - Math.PI / 2) / 0.6) ** 2));
  return Math.max(0.02, 0.28 + 1.5 * rise + 0.75 * storms - 0.55 * dry - 0.22 * cold);
}
