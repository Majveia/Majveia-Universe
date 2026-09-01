/**
 * Physical and astronomical constants.
 *
 * SI base units unless a suffix says otherwise. Values follow CODATA 2018 and
 * IAU 2015 Resolution B3 nominal solar/planetary conversion constants, so the
 * simulation's numbers can be checked against published astronomy.
 */

// ---------------------------------------------------------------------------
// Fundamental
// ---------------------------------------------------------------------------

/** Newtonian constant of gravitation, m^3 kg^-1 s^-2 (CODATA 2018). */
export const G = 6.6743e-11;
/** Speed of light in vacuum, m/s (exact by SI definition). */
export const C = 299792458;
/** Planck constant, J s (exact by SI definition). */
export const H_PLANCK = 6.62607015e-34;
/** Boltzmann constant, J/K (exact by SI definition). */
export const K_B = 1.380649e-23;
/** Stefan-Boltzmann constant, W m^-2 K^-4. */
export const SIGMA_SB = 5.670374419e-8;
/** Wien displacement constant, m K. */
export const WIEN_B = 2.897771955e-3;
/** Proton mass, kg. */
export const M_PROTON = 1.67262192369e-27;
/** Electron mass, kg. */
export const M_ELECTRON = 9.1093837015e-31;
/** Thomson cross-section, m^2. */
export const SIGMA_THOMSON = 6.6524587321e-29;

// ---------------------------------------------------------------------------
// Length
// ---------------------------------------------------------------------------

/** Astronomical unit, m (IAU 2012 exact). */
export const AU = 1.495978707e11;
/** Parsec, m. */
export const PC = 3.0856775814913673e16;
export const KPC = 1e3 * PC;
export const MPC = 1e6 * PC;
export const GPC = 1e9 * PC;
/** Julian light-year, m. */
export const LY = 9.4607304725808e15;

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

export const MINUTE = 60;
export const HOUR = 3600;
export const DAY = 86400;
/** Julian year, s. */
export const YEAR = 365.25 * DAY;
export const MYR = 1e6 * YEAR;
export const GYR = 1e9 * YEAR;

// ---------------------------------------------------------------------------
// Solar / planetary (IAU 2015 B3 nominal values)
// ---------------------------------------------------------------------------

/** Solar mass, kg (from nominal GM_sun / G). */
export const M_SUN = 1.98847e30;
/** Nominal solar radius, m. */
export const R_SUN = 6.957e8;
/** Nominal solar luminosity, W. */
export const L_SUN = 3.828e26;
/** Solar effective temperature, K. */
export const T_SUN = 5772;
/** Solar heliocentric gravitational constant GM, m^3 s^-2 (better known than G or M alone). */
export const GM_SUN = 1.32712440018e20;

export const M_EARTH = 5.97217e24;
/** Volumetric mean radius of Earth, m. */
export const R_EARTH = 6.371e6;
export const GM_EARTH = 3.986004418e14;

export const M_JUPITER = 1.898125e27;
/** Equatorial radius of Jupiter, m. */
export const R_JUPITER = 7.1492e7;

export const M_MOON = 7.342e22;
export const R_MOON = 1.7374e6;

// ---------------------------------------------------------------------------
// Cosmology - Planck 2018 TT,TE,EE+lowE+lensing+BAO (Table 2, final column)
// ---------------------------------------------------------------------------

/** Reduced Hubble constant h, where H0 = 100 h km/s/Mpc. */
export const H_LITTLE = 0.6766;
/** Hubble constant, km/s/Mpc. */
export const H0_KMS_MPC = 100 * H_LITTLE;
/** Hubble constant in SI, 1/s. */
export const H0 = (H0_KMS_MPC * 1e3) / MPC;
/** Hubble time 1/H0, s. */
export const HUBBLE_TIME = 1 / H0;
/** Hubble length c/H0, m. */
export const HUBBLE_LENGTH = C / H0;
/** Total matter density parameter today. */
export const OMEGA_M = 0.3111;
/** Baryon density parameter today. */
export const OMEGA_B = 0.04897;
/** Cold dark matter density parameter today. */
export const OMEGA_CDM = OMEGA_M - OMEGA_B;
/** Dark energy density parameter today (flat universe). */
export const OMEGA_LAMBDA = 0.6889;
/** Radiation (photons + massless neutrinos) density parameter today. */
export const OMEGA_R = 9.182e-5;
/** Curvature density parameter today (flat to within measurement). */
export const OMEGA_K = 1 - OMEGA_M - OMEGA_LAMBDA - OMEGA_R;
/** Scalar spectral index of primordial fluctuations. */
export const N_S = 0.9665;
/** RMS linear density fluctuation in 8 Mpc/h spheres today. */
export const SIGMA_8 = 0.8102;
/** CMB monopole temperature, K (COBE/FIRAS). */
export const T_CMB = 2.7255;
/** Age of the universe today, Gyr (Planck 2018). */
export const AGE_UNIVERSE_GYR = 13.787;
/** Redshift of recombination (last scattering). */
export const Z_RECOMBINATION = 1089.8;
/** Critical density today, kg/m^3. */
export const RHO_CRIT = (3 * H0 * H0) / (8 * Math.PI * G);

// ---------------------------------------------------------------------------
// Derived / convenience
// ---------------------------------------------------------------------------

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

/** Schwarzschild radius for a mass in kg, m. */
export const schwarzschildRadius = (massKg: number): number => (2 * G * massKg) / (C * C);

/** Roche limit (rigid body) for a satellite of density rhoS orbiting a body of density rhoM and radius R. */
export const rocheLimit = (primaryRadius: number, rhoPrimary: number, rhoSat: number): number =>
  primaryRadius * Math.cbrt(2 * (rhoPrimary / rhoSat));
