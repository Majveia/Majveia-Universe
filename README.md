# Majveia

An interactive simulation of the universe, built from physics rather than from
art direction. It runs in a browser, generates everything from one seed, and
lets you fly from the cosmic web down to the surface weather of a planet
without a loading screen in between.

```
npm install
npm run dev          # http://localhost:5173
npm test             # 326 tests, mostly checking physics against measurement
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

### The microwave background

Press **B** at the cosmic scale and the sky behind the filaments becomes the
surface of last scattering. It is the same construction as the web - one
Gaussian random field, one primordial power spectrum - evaluated 13.8 billion
years earlier, which is the point of showing them in the same frame.

Before recombination the photons and baryons are one fluid, driven into
standing sound waves in the potential wells the dark matter has already made.
Every mode has been oscillating for the same conformal time, so its phase at
last scattering is `k·r_s`, and the modes caught at maximum compression or
rarefaction leave the acoustic peaks. The sound horizon and Silk scale come
from Eisenstein & Hu, the redshift of last scattering from Hu & Sugiyama
(1092, against the measured 1090), and the `π/4` phase shift from radiation
driving is what puts the first peak at ℓ = 216 rather than at the `πD/r_s ≈ 300`
the naive count gives. The model lands the first three peaks at 216, 504 and
792 against the observed 220, 537 and 810. Baryon loading offsets the
oscillation's zero point, so odd peaks beat even ones - the ratio of the first
two is how the baryon density was first measured, and taking the baryons out of
this model takes the asymmetry out with them.

The map is a few hundred plane waves drawn from that spectrum, each restricted
to the sphere of last scattering, where a plane wave becomes a set of bands at
one multipole `ℓ = kD`. Their sum is a Gaussian random field with the right
angular power spectrum, synthesised once on the GPU.

**B** cycles three ways, because the first thing to know about the microwave
sky is that almost none of what you see is primordial. As observed, it is a
3.4 mK dipole from our own motion and nothing else; take the dipole out and the
110 µK of sound waves from before there were atoms appear underneath it.

### Relativistic flight

**J** puts the observer in motion, and the sky stops being a backdrop. Three
effects, one Lorentz transformation, none of them available without the others:

- **Aberration.** `cos θ' = (cos θ + β)/(1 + β cos θ)`, run backwards from the
  pixel to the source. At β = 0.9 the entire sky behind you has been squeezed
  into a patch ahead 26° across.
- **Doppler.** Every frequency shifts by `D = 1/[γ(1 − β cos θ')]`. A blackbody
  stays a blackbody, so the stars slide along the Planckian locus - and light
  arriving exactly sideways is still redshifted by `1/γ`, which is time
  dilation and has no classical counterpart.
- **Beaming.** `Iν/ν³` is invariant, so surface brightness goes as `D⁴`: the sky
  ahead blazes and the sky behind goes out.

And then the background. The CMB is a 2.7 K blackbody until `D` reaches a few
hundred, and the fraction of a Planck curve landing in the visible is the Wien
tail `exp(−hc/λkT)` - so the switch-on is violent. Nothing at all at γ = 100, a
dull red glow at γ = 224, a wall of light at γ = 700. The presets climb by about
a factor of ten in γ each step, because 0.99 and 0.9999995 look alike written
down and differ by a factor of 140 in everything that matters.

### Gravitational waves

**G** at the galactic scale replaces the galaxy with two black holes eleven
seconds from merging. It is a jump of sixteen orders of magnitude out of the
scale that stage normally works at, and the clock changes with it: a galaxy
runs at twelve million years a second, and the whole of this takes eleven.

Almost everything about a chirp is fixed by one combination of the masses,
`Mc = (m1 m2)^(3/5)/(m1+m2)^(1/5)`, which is why that is the first thing anyone
measures from a detection and why they can measure it without knowing the
distance, the inclination or the individual masses. The quadrupole formula
gives the orbital decay, which integrates to a time to merger going as `a⁴` —
the reason binaries spend essentially all their lives wide and quiet and then
merge in an eyeblink.

The picture is the leading-order quadrupole field at retarded time: a two-armed
spiral that tightens as the frequency rises. Two arms because the radiation is
quadrupolar and a binary looks the same after half a turn; winding because the
wave takes `r/c` to get there; tightening because of the chirp. After
coalescence the source stops, and the region inside `r = ct` — which has
nothing left to emit — shows only the remnant's ringdown, while everything
outside is still carrying the inspiral outward. The boundary between them
expands at exactly the speed of light.

The strain trace along the bottom is the picture that was on every front page
in February 2016, drawn from the same waveform as the field. Its window is
measured in cycles rather than seconds, because a fixed window in time shows a
lazy sine early on and a block of ink at the end.

Checked against GW150914 throughout: chirp mass 28 M☉, ISCO at 576 km, peak
strain 1e-21 at 410 Mpc, three solar masses radiated, final mass 62, final spin
0.68, ringdown near 250 Hz, and a peak power of a thousandth of `c⁵/G` — which
for a fifth of a second outshone every star in the observable universe by a
factor of a hundred, in a form of radiation that passed through all of them
unnoticed.

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

Click one and you get its spectrum: a Planck continuum painted in the colours
of its own wavelengths, with the absorption lines that survive at that
temperature cut into it. The panel exists to show the thing Cecilia Payne
worked out in 1925 against her examiners' advice - **line strength measures
excitation and ionisation, not abundance**. Hydrogen is the commonest element
in every star here, and the Balmer lines are strongest in A stars and weak in
both O stars and M dwarfs: in an O star hydrogen is ionised and has no electron
left to make a line with; in an M dwarf it is neutral but in the ground state,
and the Balmer series starts from the first excited one, which at 3000 K is
empty. Only near 9500 K is the balance right. Below about 4000 K molecules
survive and TiO takes over the optical entirely, which is why an M dwarf's
spectrum is a comb.

### The Hertzsprung-Russell diagram

**D** plots the galaxy you are in. Stars do not fill the diagram — they lie on a
line, and where a star sits on it is set by one number, its mass. The turnoff is
a clock that reads the age of the population, because everything more massive
than it has already gone. Clicking a star rings it on the plot.

The sampling needed care. A volume-limited draw from an initial mass function is
three-quarters M dwarfs and holds one O star in a hundred thousand, so at any
plottable number of points the upper main sequence comes out empty; and drawing
ages uniformly over eleven billion years finds a massive star still alive about
one time in a thousand, which empties it again. So the draw is flat in log mass,
two thirds of it restricted to stars alive now, and both the mass function and
the survival probability go back into the *opacity* of each point. The bright
end of the diagram is faint for the same reason the sky has few blue giants in
it.

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
go blue and terminators redden because the path length says they should. Water
is a smooth dielectric, so sunlight glints off an ocean in a narrow GGX lobe
with a Fresnel weight - dark looking straight down, a mirror at grazing angles.

### How any of it would be found

Everything else in the inspector is what a planet *is*. Click one and the last
panel is the entirety of what could be *measured* about it from another star.

**Transits** take a bite out of the light that is `(Rp/R*)²` deep — an area
ratio, not a mass ratio: 1% for a hot Jupiter and 84 parts per million for the
Earth. The curve is the overlapping area of two discs weighted by the
limb-darkened intensity of the patch being covered, which is where the rounded
bottom of a real light curve comes from, and it reuses the same two-circle
overlap as the eclipse code. The catch is in the word *if*: the geometric
probability is only `R*/a`, half a per cent for an Earth at 1 AU.

**Radial velocity** measures the star's own orbit about the barycentre:
12.5 m/s for Jupiter and 9 cm/s for the Earth, read off a star four light years
away by watching its absorption lines shift a ten-millionth of their width.

The two are complementary and that is the whole reason both exist. Transits give
the radius, radial velocity gives the mass, and only a planet with both has a
density and therefore a composition.

### Aurorae and eclipses

Neither is drawn. An aurora is the footprint of a magnetic field: the
magnetopause sits where `B²/2μ₀` balances the stellar wind's ram pressure, and
the last closed field line - the one crossing the equator at `L` planetary
radii - lands at a colatitude `θ` with `sin²θ = 1/L`. That ring is the auroral
oval, and for an Earth in the solar wind the model puts it 19° from the
magnetic pole, where it is. A stronger field pushes the oval poleward; a storm
that compresses the magnetosphere drags it toward the equator. Same expression,
evaluated twice.

The colours are line emission stacked by altitude, the way the real ones are:
N₂⁺ at 427.8 nm in the violet fringe at the bottom, the forbidden [O I] line at
557.7 nm for the green through the middle, and [O I] at 630.0 nm above - also
forbidden, with a 110-second lifetime, so it can only radiate where collisions
are rare enough to leave the atom alone that long. Which is why the red is
always on top. Whether a world gets one at all is decided by the dynamo: Venus
turns once in 243 days and gets nothing, a small world that cooled early gets
nothing, and a magnetised airless rock gets nothing because there is no air for
the particles to hit.

An eclipse is two circles overlapping. A star is a disc, not a point, so a body
in front of it covers a *fraction* of that disc, and umbra, penumbra and the
grey edge between them all come out of the one expression - as does the fact
that a small or distant moon can only ever manage an annular eclipse, because
its disc never covers the star's however well aligned. The same arithmetic runs
with the roles swapped to put a planet's shadow on its moons.

### The Solar System

**O** goes to the one system in here that is not generated. Every number in it
is measured — masses from the IAU and JPL, radii from the IAU 2015 nominal
values, orbital elements from the J2000 mean ephemerides, temperatures and
pressures and albedos from the NASA fact sheets — assembled into exactly the
same structures the generator produces, so every renderer and inspector works
on it unchanged. It is there to be visited, and it is there as the check on
everything else: Earth comes out at 1.000 M⊕, 1.00 g, 288 K, a 365-day year, a
23.9-hour day, a magnetopause at 9.4 Earth radii and an aurora of exactly ×1.00,
because Earth is what the aurora model is normalised to.

Using measured values rather than derived ones also states some things as
numbers. Venus sits 500 K above its equilibrium temperature and Mars sits at
it: that difference is the greenhouse effect, and the tests assert it.

### Comets

Dust grains are not animated along a painted curve. Each is released from the
nucleus with an ejection velocity from gas drag, given a radiation-pressure to
gravity ratio `β = 5.7e-4 Q/(ρa)` drawn from the grain size distribution, and
then put on its own Kepler orbit around a star whose gravity is reduced to
`(1 − β)GM`. After that its position is analytic. The broad curved dust tail is
what a few thousand such grains look like drawn at once: a family of syndynes,
with nobody drawing a syndyne.

Ions get their own treatment, because they behave differently. Picked up by the
stellar wind at hundreds of kilometres a second, they leave in an almost
straight ray away from the star, swept back only by the aberration from the
comet's own transverse motion. So the two tails point in different directions,
and the angle between them is a measurement rather than a styling choice.

Everything is measured against the star rather than against the Sun: water ice
sublimates where the equilibrium temperature reaches about 170 K, which is 3 AU
for the Sun and under a tenth of that for an M dwarf, so perihelia, tail
lengths and grain lifetimes all scale with the ice line.

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
| B | show the microwave background |
| J | fly at a fraction of light speed |
| G | merge two black holes |
| D | Hertzsprung-Russell diagram |
| O | go to the Solar System |
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
  physics/      Kepler solvers, orbital elements, relativity, N-body,
                lensing, eclipses, magnetospheres
  astro/        blackbody colour, stellar evolution, planet formation,
                spectra, supernovae, binaries, comets
  galaxy/       kinematic density waves, population synthesis
  render/       the HDR engine and every shader
  sim/          the universe object graph and the scale ladder
  ui/           the interface
tests/          326 tests against published measurements
```

## Accuracy

The tests check the simulation against real numbers rather than against
itself - the age of the universe (13.79 Gyr), σ₈ recovery, the BAO sound
horizon (147 Mpc), Earth's orbital speed (29.8 km/s), Mercury's
43″/century relativistic precession, the Sun's habitable zone, Earth's
equilibrium temperature (255 K), the ISCO of a solar-mass black hole (8.9 km),
κ = √2 Ω for a flat rotation curve, GW150914's chirp mass and final spin,
Jupiter moving the Sun at 12.5 m/s and the Earth at 9 cm/s, the Sun and Moon
coming out the same apparent size (which is why eclipses happen at all),
Earth's magnetopause at
ten radii and its auroral oval 19° from the pole, the solar CMB dipole at
3.36 mK, the acoustic peaks at ℓ = 216, 504, 792, and Ca II K coming out as the
deepest line in a solar spectrum.

Where the model is an approximation, it is one with a name and a range of
validity. Zel'dovich is first-order Lagrangian perturbation theory: exact until
shell crossing, qualitatively right after. Kinematic density waves reproduce
the geometry and the differential streaming, but not the wave's own dynamics.
The halo finder is peak identification with exclusion, not a friends-of-friends
group finder. None of it is a substitute for a real N-body code - but none of
it is made up either.
