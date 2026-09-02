# Majveia

An interactive simulation of the universe, built from physics rather than from
art direction. It runs in a browser, generates everything from one seed, and
lets you fly from the cosmic web down to the surface weather of a planet
without a loading screen in between.

```
npm install
npm run dev          # http://localhost:5173
npm test             # 88 tests, mostly checking physics against measurement
npm run bundle:single # one self-contained HTML file, no network dependencies
```

---

## What it actually simulates

### Structure formation

The cosmic web is not a texture. It is generated the way a real cosmological
simulation generates its initial conditions:

1. A Gaussian random field is drawn directly in Fourier space, where the modes
   are independent, with the **Eisenstein & Hu (1998)** transfer function -
   including the baryon acoustic oscillations, so the sound horizon frozen in
   at recombination is present as a real ~147 Mpc feature.
2. Poisson's equation is solved in Fourier space for the displacement field
   `Ψ(k) = i k/k² δ(k)`, and three inverse FFTs bring it to real space.
3. Every particle moves along its displacement by the **Zel'dovich
   approximation**, `x(q,a) = q + D(a) Ψ(q)`.

Because the entire time dependence is one scalar - the linear growth factor
`D(a)` from the Friedmann equations - the whole history of cosmic structure
formation is a single uniform in the vertex shader. Dragging the timeline does
not replay a baked animation; it re-solves gravitational collapse for two
million particles, every frame.

The Jacobian of that map gives the density *exactly*:

```
1 + δ = 1 / [(1 − D λ₁)(1 − D λ₂)(1 − D λ₃)]
```

so each particle stores the three eigenvalues of its deformation tensor, and
the renderer knows both how dense a region is and how it collapsed - the
**T-web classification**: three axes collapsed is a cluster, two a filament,
one a wall, none a void. That is what the colour ramp encodes.

### Cosmology

Switchable. Planck 2018 by default; Einstein-de Sitter, a nearly empty
universe, a clumpy one and a phantom-energy one (`w = −1.35`) are one keypress
away, and every one of them is integrated rather than approximated: `a(t)`,
`D(a)`, `f = dlnD/dlna`, comoving and luminosity distances, particle and event
horizons, the deceleration parameter.

Some consequences fall out on their own. In ΛCDM the growth factor **saturates**
once dark energy takes over, so low-amplitude peaks in the density field never
collapse at all - structure formation in this universe is already nearly
finished, and the simulation says so.

### Galaxies

Spiral arms are **Lindblad kinematic density waves**. Every star sits on a
closed elliptical orbit whose orientation advances logarithmically with radius:

```
φ(a) = φ₀ + ln(a/a₀) / tan(pitch)
```

Nested, progressively rotated ellipses crowd along a logarithmic spiral, and
that crowding *is* the arm. Stars stream through it at their own orbital rate -
fast inside, slow outside - while the pattern turns at a single slow pattern
speed. So the arms never wind up, and a galaxy here can rotate for ten billion
years without smearing.

A **bar** is the same picture with one change: the inner region where the
ellipses stop precessing and all line up. Which is also why real bars end where
their spirals begin.

Everything else comes from measured relations: abundance-matched stellar-to-halo
mass, the size–mass relation, Tully–Fisher, M–σ for the central black hole, and
the morphology–density relation, so cluster cores fill with ellipticals.
Each sprite's colour is a real star drawn from a **Kroupa IMF** and evolved -
including the ~2% red giants that carry half of an old population's light and
are the reason a bulge is orange rather than grey.

Dust sits on the inner edge of the arms where the gas shocks, and extinguishes
with `A(λ) ~ λ⁻¹`, so the far side of a tilted disc is both dimmer *and* redder
than the near side - which is how you tell which way a galaxy is tipped.

### Stars

Sampled from a Kroupa IMF; luminosity, radius, temperature, lifetime and fate
all follow from the mass through main-sequence relations. Colour is computed,
not chosen: Planck's law integrated against the CIE 1931 colour-matching
functions and transformed into sRGB. An M dwarf comes out orange and a
Wolf–Rayet star comes out blue-white because that is where those temperatures
sit on the Planckian locus.

Up close a star is limb-darkened, granulated by convection, and spotted - and
its spots are *redder* than the surface around them, because they are cooler.

### Planets

Formation runs the physical sequence: a protoplanetary disc whose mass scales
with the star and its metallicity, a snow line, faster core growth beyond it,
runaway gas accretion for cores that pass ~10 M⊕ before the gas disperses,
occasional Type II migration into hot Jupiters, and orbits spaced by mutual
Hill radii so the result is dynamically stable.

Everything downstream is derived:

| Quantity | From |
|---|---|
| Radius | Chen & Kipping (2017), four regimes |
| Temperature | Stellar flux and albedo, iterated (albedo depends on what condenses) |
| Atmosphere | Jeans escape parameter per species |
| Habitability | Kopparapu et al. (2013) limits, plus liquid water and pressure |
| Moons | Inside the Hill sphere, outside the Roche limit |
| Rings | Inside the Roche limit |
| Rotation | Tidal despinning timescale against the star's age |

Surfaces are analytic: continents from fBm, ranges from ridged multifractal
noise, relief shading from the elevation gradient, ice caps placed by latitude
*and* temperature, deserts in the subtropics where the Hadley cells bring
descending air, and craters only where there is no atmosphere to burn up
impactors and no weather to erode the scars.

Atmospheres use single-scattering Rayleigh extinction with `β ~ λ⁻⁴`, so limbs
go blue and terminators redden because the path length says they should.

### Black holes

Each pixel integrates the Schwarzschild photon orbit equation

```
d²u/dφ² + u = 3 M u²        u = 1/r
```

with RK4, in the plane containing the camera and the ray. Drop the `3 M u²`
term and you get a straight line in polar coordinates. Keep it, and you get:

- a shadow of apparent radius `√27 M`, larger than the horizon at `2 M`
- the photon ring at `3 M`, with higher-order images stacked just outside it
- the accretion disc seen from above **and** from underneath at once, because
  light from the far underside is bent up and over the hole

The disc is Shakura–Sunyaev (`T ~ r^-3/4` with the zero-torque inner boundary
condition, which is why it peaks outside its own inner edge), then modified by
relativistic Doppler beaming - approaching side boosted by `δ⁴` and blue-shifted,
receding side dimmed and reddened - and by the `√(1 − 3M/r)` redshift of a
Keplerian emitter. The brightness asymmetry is a prediction, not a light rig.

### Nebulae

Ray-marched volumes solving `dI/ds = j − κI`. The colours are the real lines:
Hα at 656 nm for the red, [O III] at 496/501 nm for the teal - and because it
takes a harder photon to doubly ionise oxygen than to ionise hydrogen, the teal
only appears close to the hot stars while the red fills the volume around them.
Which is exactly the structure real emission nebulae have.

---

## Rendering

Everything is rendered in linear light into a half-float HDR buffer, because a
universe spans a dynamic range that eight bits cannot hold. The chain is:

```
scene (linear HDR)
  → bright pass + progressive downsample, Karis-weighted to kill fireflies
  → tent-filtered upsample, accumulating a physically soft bloom
  → AgX tone mapping + look grade
  → black-point subtraction
  → triangular-PDF dither
  → sRGB encode
```

Two of those steps exist specifically for OLED:

- **The black point.** AgX has a long toe by design, which lifts the darkest
  values into a visible grey. On a panel with true blacks that reads as a wash
  across what should be empty space.
- **The dither.** Sub-LSB triangular noise. Without it the near-black gradients
  that make up most of this image show visible contour rings.

A few other things that turned out to matter more than expected, all found by
looking at the output:

- **Stratified sampling.** Sampling the displacement field on its own grid
  leaves the initial cubic lattice visible wherever matter has not moved far -
  the voids come out looking like graph paper. Particles are instead placed
  uniformly at random within their own cell, with the displacement *and* the
  tidal tensor trilinearly interpolated to that position.
- **Adaptive exposure.** Additive rendering integrates every particle along the
  sightline, so apparent brightness depends on how deep you can see. The depth
  is bounded and per-particle brightness scaled by `cell/depth`, holding the
  column density per pixel fixed from inside a void to outside the box.
- **Apparent-size floor.** At true scale the Earth is one part in 23,000 of its
  own orbit, and a solar system is empty black. Bodies are drawn at true scale
  once their disc is resolvable and never smaller than a few pixels before
  that. `T` switches to strict true scale.
- **Per-population luminosity budgets.** Sprites are allocated by number, but
  a galaxy has ~10¹¹ old stars and ~10⁵ O stars. Sampling uniformly and using
  raw luminosities makes the young population 99% of the light and the galaxy
  a uniform blue haze.

---

## Exploring

| | |
|---|---|
| drag / scroll | orbit, zoom exponentially |
| W A S D, Q E | fly; shift for ×6 |
| click | inspect whatever is under the cursor |
| enter / backspace | descend a scale / climb back |
| space | run time |
| `[` `]` | epoch, or time warp |
| C | change the cosmology |
| V | tint the web by peculiar velocity |
| T | true scale in a system |
| U | hide the interface |
| P | save a frame |
| H | all of the above |

Five scales, each about a thousand times smaller than the one above:

```
COSMOS   ~600 Mpc    the cosmic web growing under gravity
CLUSTER  ~3 Mpc      a bound halo full of galaxies
GALAXY   ~40 kpc     one galaxy, its arms turning
SYSTEM   ~30 AU      one star and its planets
WORLD    ~10⁴ km     one planet, its moons, its weather
```

No single float32 scene graph spans forty orders of magnitude, so each scale
owns its own units, camera clipping range and clock. Descending picks an
object, discards the scale above and rebuilds the one below from the same seed -
so the galaxy you fly into is the galaxy that was there, and it is still there
when you come back.

## Seeds

The whole universe is a pure function of one seed. Nothing calls
`Math.random()`. `?seed=ANYTHING` regenerates exactly the same cosmic web, the
same clusters, the same galaxies, the same stars and the same continents on the
same planets - which is why a URL is enough to share a world.

```
?seed=WHIRLPOOL     name the universe
?n=64|128|256       grid resolution (128³ = 2.1M particles, the default)
?box=620            box size in Mpc
?q=0.4              particle fraction, for slower machines
?dpr=1              cap the device pixel ratio
```

`lab.html` renders one subsystem at a time against a black background for
tuning: `?mode=system|planet|nebula|blackhole`, plus every look parameter as a
query argument. It is not part of the experience; it is how the experience got
tuned.

## Layout

```
src/
  core/         constants, deterministic RNG
  cosmology/    LambdaCDM, the power spectrum, FFT, Zel'dovich, the worker
  physics/      Kepler solvers, orbital elements, relativistic corrections
  astro/        blackbody colour, stellar evolution, planet formation
  galaxy/       kinematic density waves, population synthesis
  render/       the HDR engine and every shader
  sim/          the universe object graph and the scale ladder
  ui/           the interface
tests/          88 tests against published measurements
```

## Accuracy

The tests check the simulation against real numbers rather than against
itself - the age of the universe (13.79 Gyr), σ₈ recovery, the BAO sound
horizon (147 Mpc), Earth's orbital speed (29.8 km/s), Mercury's
43″/century relativistic precession, the Sun's habitable zone, Earth's
equilibrium temperature (255 K), the ISCO of a solar-mass black hole (8.9 km),
κ = √2 Ω for a flat rotation curve.

Where the model is an approximation, it is one with a name and a range of
validity. Zel'dovich is first-order Lagrangian perturbation theory: exact until
shell crossing, qualitatively right after. Kinematic density waves reproduce
the geometry and the differential streaming, but not the wave's own dynamics.
The halo finder is peak identification with exclusion, not a friends-of-friends
group finder. None of it is a substitute for a real N-body code - but none of
it is made up either.
