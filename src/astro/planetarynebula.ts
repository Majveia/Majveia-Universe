/**
 * Planetary nebulae: what a star like the Sun leaves behind, and why they look
 * like rings when they are shells.
 *
 * At the end of the giant branch a star of one to eight solar masses is a
 * degenerate carbon-oxygen core wrapped in an envelope it can barely hold. A
 * slow wind - twenty or thirty kilometres a second - carries most of the mass
 * off over a few tens of thousands of years, and what is uncovered is the core:
 * a naked stellar remnant at a hundred thousand kelvin, radiating almost
 * entirely in the ultraviolet. That radiation ionises the departed envelope
 * from the inside, and the envelope glows.
 *
 * The three things worth knowing about the result:
 *
 *  - **They are shells, and they look like rings.** A line of sight through the
 *    edge of a thin shell passes through far more material than one through the
 *    middle, so the limb is bright and the centre is not. Nothing about the
 *    geometry is a ring. This is the same reason a soap bubble has a bright rim,
 *    and `shellChord` below is the entire explanation: it is the length of the
 *    sightline's intersection with the shell, and it has a maximum exactly where
 *    the sightline grazes the inner surface.
 *  - **They are short-lived.** The shell expands at 25 km/s and thins as it
 *    goes, and the central star fades; the whole display lasts twenty or thirty
 *    thousand years, which against a ten-billion-year life is the last
 *    two-millionths of it. There are perhaps three thousand in the Galaxy at any
 *    moment, out of a hundred billion stars.
 *  - **The colour is a thermometer for the core.** The forbidden [O III] lines
 *    at 496 and 501 nm need photons of 35 eV to make the ion in the first place,
 *    and those come only from the far-ultraviolet tail; Ha at 656 nm needs 13.6.
 *    So the doubly-ionised zone is an inner zone, and how far out it reaches
 *    measures how hot the exposed core is. The photographs are teal in the
 *    middle and red at the edge because of that ordering, not because of a
 *    palette.
 *
 * Core mass sets everything else. The initial-final mass relation gives it from
 * the progenitor, the post-AGB tracks (Vassiliadis & Wood 1994; Blocker 1995)
 * give the temperature the core reaches from the core mass, and the temperature
 * gives the ionisation. One number in, a nebula out.
 */

import { M_SUN, YEAR } from '../core/constants';
import { remnantMass } from './stellar';

/** Expansion speed of the ejected envelope, m/s. */
export const EJECTION_SPEED = 25e3;

export interface PlanetaryNebula {
  /** Mass thrown off, solar. */
  ejectedMsun: number;
  /** Mass left behind - the exposed core, solar. */
  remnantMsun: number;
  /** Expansion speed, m/s. */
  speed: number;
  /** How long it stays visible, seconds. */
  lifetimeS: number;
  /** Effective temperature the exposed core reaches, K. */
  centralTempK: number;
  /** Whether this star makes one at all. */
  occurs: boolean;
}

/**
 * What the star leaves. Below about 0.85 solar masses nothing has had time to
 * happen in the age of the universe; above about eight the core collapses
 * instead and the envelope leaves as a supernova, not as a wind.
 */
export function planetaryNebula(massMsun: number): PlanetaryNebula {
  const rem = remnantMass(massMsun);
  const occurs = massMsun >= 0.85 && massMsun < 8;
  // No single star leaves a carbon-oxygen core lighter than about half a solar
  // mass: below that the helium core never ignites in the first place. The
  // initial-final mass relation is a fit to cluster white dwarfs and runs a
  // little light at the bottom of its range, where it has the fewest of them.
  const coreMsun = Math.max(0.53, rem.mass);
  // Post-AGB tracks: the temperature the core reaches climbs very steeply with
  // its mass, because a more massive white dwarf is smaller and denser. A 0.57
  // solar-mass core tops out near 100 kK, a 0.7 near 150 kK. Capped at 220 kK,
  // where the crossing gets so fast the nebula never catches up with it.
  const centralTempK = Math.min(220_000, 100_000 * Math.pow(coreMsun / 0.57, 2));
  return {
    ejectedMsun: Math.max(0, massMsun - coreMsun),
    remnantMsun: coreMsun,
    speed: EJECTION_SPEED,
    // A hot core ionises the shell at once and holds it; a barely-hot one takes
    // so long to get there that the gas has already thinned. Either way the
    // visible phase is a few tens of thousands of years, and then it is gone.
    lifetimeS: (14_000 + 16_000 * Math.min(1, centralTempK / 150_000)) * YEAR,
    centralTempK,
    occurs,
  };
}

/**
 * Luminosity of the exposed core during the nebula phase, solar units.
 *
 * A post-AGB star crosses the top of the HR diagram at very nearly constant
 * luminosity, and that luminosity is a steep, almost linear function of the
 * core's mass alone - Paczynski's core-mass-luminosity relation, which holds
 * because a shell-burning star's output is set by the gravity at the burning
 * shell and nothing else. The envelope above it has no say, which is exactly
 * why the star can lose the envelope and not dim.
 *
 * A floor is imposed because the initial-final mass relation used here gives a
 * slightly light core for a solar-mass progenitor, and a nebula around a star
 * of no luminosity would not be ionised at all.
 */
export function coreLuminosityLsun(pn: PlanetaryNebula): number {
  return Math.max(300, 5.9e4 * (pn.remnantMsun - 0.5));
}

/**
 * Radius of the exposed core during the nebula phase, solar units.
 *
 * Not the white dwarf's final size. On its way across the HR diagram the core
 * still has a thin, hot envelope and is around a tenth of a solar radius - ten
 * times the Earth-sized object it will settle down to once it starts cooling in
 * earnest. The radius follows from the luminosity and the temperature: nothing
 * else is needed, because Stefan and Boltzmann already said it.
 */
export function coreRadiusRsun(pn: PlanetaryNebula): number {
  const T_SUN = 5772;
  const t = pn.centralTempK / T_SUN;
  return Math.sqrt(coreLuminosityLsun(pn) / (t * t * t * t));
}

/**
 * Interval between the star's thermal pulses near the end, years.
 *
 * A shell-burning AGB star is not steady. Helium ignites in a thin shell every
 * few hundred to few thousand years, the star briefly brightens by a factor of
 * a few, and the wind that is carrying its envelope away thickens. Those pulses
 * are frozen into the departing gas as concentric arcs, and their spacing is
 * the only direct measurement anyone has of the interpulse period - which
 * otherwise exists only inside stellar evolution codes. The period falls
 * steeply with core mass, like everything else here.
 */
export function pulseIntervalYears(pn: PlanetaryNebula): number {
  return 800 * Math.pow(0.6 / Math.max(pn.remnantMsun, 0.3), 4);
}

/** Radius of the shell at a time after ejection, metres. */
export function shellRadius(pn: PlanetaryNebula, tS: number): number {
  return pn.speed * Math.max(tS, 0);
}

/**
 * Relative thickness of the shell, as a fraction of its radius.
 *
 * The wind blew for a finite time before it stopped, so the shell has a real
 * width; as it expands the width grows more slowly than the radius, so the
 * shell gets *relatively* thinner and the ring gets sharper - which is why the
 * older ones are the prettier ones.
 */
export function shellThickness(pn: PlanetaryNebula, tS: number): number {
  void pn;
  const t = Math.max(tS, 1);
  // The wind lasted a few thousand years; after that the width is frozen and
  // only the radius keeps growing.
  const windS = 4000 * YEAR;
  return Math.min(0.6, Math.max(0.06, (Math.min(t, windS) / t) * 0.6));
}

/**
 * Surface brightness of the ionised shell relative to its peak, from dilution
 * alone. The emission measure goes as density squared times path length, and
 * the density falls as the cube of the radius, so the brightness collapses very
 * fast: a nebula is at its best early.
 *
 * This is only the dilution. Whether the gas is ionised at all is a separate
 * question with a separate answer - see `ionisedFraction` - and the two have to
 * be multiplied, which is the whole tragedy of a low-mass star's nebula: by the
 * time its core is hot enough to light the gas up, the gas has thinned.
 */
export function shellBrightness(pn: PlanetaryNebula, tS: number): number {
  const u = Math.max(tS, 1) / pn.lifetimeS;
  if (u > 1.6) return 0;
  return Math.pow(1 + u * 5, -1.6);
}

/**
 * How long the exposed core takes to get hot enough to ionise the gas it has
 * just thrown off - the "transition time" of the post-AGB tracks.
 *
 * The core has to contract and heat at constant luminosity from a few thousand
 * kelvin to thirty thousand before a single hydrogen-ionising photon comes out
 * of it, and how fast it does that depends almost entirely on how much envelope
 * is left to burn through - which is to say, on the core's mass, very steeply.
 * A 0.7 solar-mass core does it in a few hundred years. A 0.55 takes ten
 * thousand, by which time the ejected gas has spread over half a light-year and
 * will never be bright.
 *
 * This is why the lowest-mass stars that make planetary nebulae barely make
 * them at all, and it is why the beautiful ones in the photographs are all
 * around cores near 0.6 solar masses and up.
 */
export function transitionTimeS(pn: PlanetaryNebula): number {
  return 1800 * Math.pow(0.6 / Math.max(pn.remnantMsun, 0.3), 6) * YEAR;
}

/**
 * How much of the shell is ionised at a given time - which is to say, whether
 * there is a nebula yet at all.
 *
 * Before this reaches one the object is a *proto*-planetary nebula: an
 * expanding envelope of cold dust and molecular gas, lit only by the starlight
 * it reflects, which is what the Egg and the Boomerang are. They are pale
 * golden and beautiful and they are not nebulae in the emission sense at all.
 * The switch-on, when the core finally crosses thirty thousand kelvin, is
 * fast - it is the Wien tail again - so this is a threshold, not a ramp.
 */
export function ionisedFraction(pn: PlanetaryNebula, tS: number): number {
  const u = Math.max(tS, 0) / transitionTimeS(pn);
  if (u <= 0) return 0;
  // A smooth step centred on the transition time and about half a decade wide.
  const x = Math.min(1, Math.max(0, (u - 0.45) / 0.85));
  return x * x * (3 - 2 * x);
}

/**
 * Surface brightness in reflected starlight, relative, before the gas lights
 * up. Starlight falls on the dust as the inverse square of the radius and the
 * column through the shell thins as it expands, so a proto-planetary nebula is
 * at its brightest immediately - which is exactly when it is sweeping over the
 * star's own planets, and is the only chance anyone gets to see that happen.
 */
export function reflectedBrightness(pn: PlanetaryNebula, tS: number): number {
  const r = Math.max(shellRadius(pn, tS), 1);
  // While the dust shell is optically thick it intercepts a fixed fraction of
  // the star's light whatever its size, so the flux is constant and the surface
  // brightness falls only as the projected area grows: an inverse square, not
  // the inverse fourth power the thin case would give. Referenced to the scale
  // of a planetary system, because that is where it starts.
  const r0 = pn.speed * 150 * YEAR;
  return (1 - ionisedFraction(pn, tS)) * Math.min(1, Math.pow(r0 / r, 2));
}

/**
 * Fraction of the emission that is doubly ionised at a given depth through the
 * shell - which is what decides whether that part of it glows teal or red.
 *
 * The depth runs 0 at the shell's inner surface to 1 at its outer one. The hard
 * ultraviolet is used up on the way out, so [O III] is an inner zone and Ha an
 * outer one, and a hotter core makes more 35 eV photons and pushes the boundary
 * further out. At 100 kK it reaches about six-tenths of the way through; above
 * about 160 kK the whole shell is doubly ionised and only the outermost rim is
 * red. Below about 60 kK there is essentially no [O III] at all, which is why
 * the nebulae around the coolest central stars - IC 418, say - are orange all
 * the way in rather than teal-cored.
 */
export function doublyIonisedFraction(shellDepth: number, centralTempK = 100_000): number {
  const u = Math.min(1, Math.max(0, shellDepth)) / ionisationEdge(centralTempK);
  if (u >= 1) return 0;
  // A Stromgren boundary is sharp - its width is a photon mean free path, which
  // is nothing next to the radius - so the zone is nearly fully doubly ionised
  // right up to a front and then is not. A gentle gradient would be wrong, and
  // would also look wrong: half teal and half red, blended, is grey.
  return 1 - Math.pow(u, 3.5);
}

/**
 * How deep into the shell the doubly-ionised zone reaches, as a fraction of the
 * shell's thickness. Above 1 it reaches the outer rim and the nebula is teal
 * all the way across.
 *
 * Calibrated against the nebulae whose central stars have been measured. NGC
 * 6543 at 80 kK and NGC 7009 at 82 kK are strongly [O III]; the Ring, at
 * 125 kK, is teal inside with a red rim; IC 418, at 39 kK, has no [O III] worth
 * the name and is orange throughout. The steepness is not arbitrary either -
 * the number of photons past 35 eV comes off the Wien tail, so it climbs far
 * faster than the temperature does.
 */
export function ionisationEdge(centralTempK: number): number {
  return Math.min(1.05, Math.max(0.06, 0.95 * Math.pow(centralTempK / 100_000, 1.1)));
}

/**
 * Length of a sightline's path through a spherical shell, for an impact
 * parameter b, all three in the same units.
 *
 * This one function is why planetary nebulae look like rings. The chord through
 * the outer sphere minus the chord through the inner cavity is short in the
 * middle - only twice the shell's width - and long at the limb, where the
 * sightline grazes the inner surface and runs along the shell for a distance
 * set by the shell's *radius* instead. For a shell ten per cent thick that is a
 * factor of four, and the eye reads a factor of four as a ring.
 */
export function shellChord(b: number, rIn: number, rOut: number): number {
  const x = Math.abs(b);
  if (x >= rOut) return 0;
  const outer = 2 * Math.sqrt(rOut * rOut - x * x);
  const inner = x < rIn ? 2 * Math.sqrt(rIn * rIn - x * x) : 0;
  return outer - inner;
}

export { M_SUN, YEAR };
