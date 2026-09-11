# Majveia

An interactive simulation of the universe, built from physics rather than from
art direction. It runs in a browser, generates everything from one seed, and
lets you fly from the cosmic web down to the nucleus of one atom in the ground
under your feet — nine scales and thirty-eight orders of magnitude — without a
loading screen in between.

```
npm install
npm run dev          # http://localhost:5173
npm test             # 866 tests, mostly checking physics against measurement
npm run bundle:single # one self-contained HTML file, no network dependencies
```

---

## The ladder

Nine scales, each one a place you can stand, and each one entered by aiming at
something in the scale above and descending into it. Nothing is a menu: what
you get is what you were pointing at.

| | | |
|---|---|---|
| **Cosmos** | 10²⁵ m | the web, from a Gaussian random field and the Zel'dovich approximation |
| **Cluster** | 10²³ m | galaxies on NFW orbits, losing their gas to ram pressure |
| **Galaxy** | 10²¹ m | density waves, population synthesis, the stars resolved |
| **System** | 10¹² m | a planetary system built by accretion, propagated by Kepler |
| **World** | 10⁷ m | one planet, with its weather, its aurora and its moons |
| **Surface** | 10⁰ m | standing on it, under its own sky, with the real ephemeris overhead |
| **Matter** | 10⁻¹⁰ m | the crystal the ground is, shaking with its own phonons |
| **Atom** | 10⁻¹¹ m | one atom of it, as the probability distribution it is |
| **Nucleus** | 10⁻¹⁵ m | the part with the mass in it, and the curve that explains the rest |

The bottom of the ladder explains the top of it. The binding energy curve
peaks at iron, so a star can get energy by fusing anything lighter and none by
fusing iron — which is why a star that has made iron stops holding itself up
and collapses, and that collapse is the supernova four rungs above, which is
how the oxygen in the ground you were standing on got out of the star it was
made in. Click an atom at the Matter scale and it tells you which.

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

**N** turns it into sound. Nothing is transposed: a stellar-mass binary sweeps
from tens of hertz to a few hundred in its last fraction of a second, which —
by a coincidence with no deeper meaning than the mass of a dead star and the
range of a human ear — is exactly the audio band.

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

### A star's whole life

**Y** at the system scale ages the star. A star's structure is a function of its
mass and its age and almost nothing else, so this is the same model re-evaluated
at a later time, and everything downstream follows without being told to: the
luminosity climbing by a third across the main sequence (which it has — the
faint young Sun is a real problem in palaeoclimate), the swell onto the giant
branch, the surface cooling from yellow to red because the radius runs away
faster than the luminosity, the habitable zone sweeping outward past one world
after another, and the inner planets going inside the photosphere.

Time runs in age over main-sequence lifetime rather than in years, so the same
run works for an O star that lives three million years and an M dwarf that
lives six trillion — five hundred times the present age of the universe — and
the readout says which. The HR diagram draws the track as it goes.

The red giant branch is exponential rather than linear in the overshoot,
because the luminosity there goes as a high power of the inert helium core's
mass. Interpolating in log to the tip the models predict — 2600 L☉ and 170 R☉ —
puts the Sun's surface at `5772·(L/R²)^¼ = 3160 K`, which is the observed tip
temperature, and its photosphere at 0.79 AU: past Mercury and Venus.

### What the Sun leaves behind

The run does not stop at the giant branch. At the tip, a star between about one
and eight solar masses loses its envelope, and everything that follows is
downstream of one number — the mass of the core the initial-final mass relation
leaves. For the Sun that is 0.53 M☉: half the star goes back to the galaxy.

The core mass sets its temperature, from the post-AGB tracks (100 kK at 0.57
M☉, climbing steeply because a heavier white dwarf is a smaller one); its
luminosity, from Paczyński's core-mass-luminosity relation, which holds because
a shell-burning star's output is fixed by the gravity at the burning shell and
the envelope above it has no say — which is exactly why it can lose the
envelope and not dim. It sets how long the core takes to contract far enough to
ionise anything, which is a few hundred years for a heavy core and ten thousand
for a light one, and is the reason the nebulae around the lightest cores are
the faint ones. It sets the interval between the star's thermal pulses, frozen
into the departing gas as concentric arcs — the only measurement of that
interval that exists outside a stellar evolution code. And it sets how deep the
doubly-ionised zone reaches, which is a thermometer: NGC 6543 at 80 kK is teal,
IC 418 at 39 kK is orange all the way in, and the boundary between them is not
a palette.

Nothing draws a ring. The shader marches through a spherical density field and
integrates `n²`, and the ring is what comes out, because a sightline grazing the
shell's inner cavity runs through several times as much gas as one aimed at the
middle. The shape is a torus with polar lobes because the fast wind cannot get
through the waist — a genuinely round planetary nebula is the rarity — and the
two phases invert: while the core is still contracting, the same torus is
opaque dust and the object is two pale gold lobes with a dark lane across them,
which is what the Egg and the Boomerang are. It becomes teal-cored and
red-rimmed at the moment the ultraviolet switches on.

The clock has to stretch, and says so. The envelope crosses Neptune's orbit in
five years and nine months; the nebula takes twenty-two thousand years to
brighten and fade. Those are four orders of magnitude apart and no single rate
shows both, so the sequence runs in three labelled beats — the sweep past the
planets, the dark drift while the core contracts, the nebula — with the readout
naming the current rate in years per second and the camera pulling back from
the orrery to four light-years without a cut. The HR track finishes the story:
up the giant branch, then hard left across the top of the diagram, which is the
fastest thing a star ever does on it.

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

### Pulsars

**Z** at the galactic scale looks at what a star above eight solar masses
leaves. Its core collapses in about a second from the size of the Earth to the
size of a city, and two things are conserved through that collapse, absurdly
well. Angular momentum: a core turning once a month arrives turning a hundred
times a second. Magnetic flux: a hundred gauss squeezed by ten thousand in
radius arrives at a trillion. What is left is a magnet the size of a city
spinning at propeller speeds, and a rotating magnet radiates.

Almost everything follows from that. The star is braked by its own radiation,
so it slows; the rate at which it slows measures the field, through

    B = 3.2×10¹⁹ √(P Ṗ) gauss

which is the vacuum dipole formula rearranged and is how every neutron-star
field in the literature is actually known — nobody has measured one directly.
Put the Crab's 33 milliseconds and its 4.2×10⁻¹³ s/s into it and 3.8 trillion
gauss comes out, which is the catalogue value; its spin-down power comes out at
4.5×10³⁸ erg/s, a hundred thousand suns, which is what lights the whole nebula
around it. That nebula has no star heating it. It shines on the rotational
energy of the corpse at its centre.

The readout says which two numbers were measured and which eleven were derived
from them, because a table of derived quantities that does not say so is not a
measurement but a claim. The Crab's characteristic age comes out at 1257 years
against a true age of 972 — the supernova was seen from China in 1054 — and it
is *wrong in the direction the assumptions predict*, which is the only real
check on a characteristic age that exists.

The period–period-derivative diagram is the neutron star's HR diagram, and has
the same two properties: the objects do not fill it, and where one sits says
what it is. Constant field runs at slope −1, constant age at +1, and the death
line at +3 — below it the field above the polar cap can no longer make
electron-positron pairs, the cascade stops, and the star goes dark forever.
Every pulsar drifts down and to the right all its life and every one of them
crosses it. The population comes out in two clumps with a gulf between; the
gulf is not something the surveys failed to look into, it is a fossil of there
being two ways to make a pulsar and nothing in between.

**N** plays it. Nothing is transposed: a pulsar turning once every one and a
third seconds is a slow knock, the Crab at thirty a second is a buzz at the
bottom of hearing, and a recycled millisecond pulsar at 642 turns a second is a
musical note — because at that rate the pulses stop being events and become a
pitch. The crossing happens at exactly the rate the ear stops counting and
starts hearing.

The beam is rendered as a volume rather than a cone, because a cone drawn as a
surface has no geometry along its own axis — precisely where a beam is
brightest. Integrating through the emitting region gets the axial brightening
for nothing and the flash for nothing too: looking down the beam is a long path
through dense material and looking across it is a short one, and that ratio
*is* the pulse. The emitting region scales with the light cylinder, which is a
hundred and sixty stellar radii for the Crab and seven for a millisecond
pulsar, so the two look nothing like each other and do so for a reason.

### A star torn apart

**I** at the galactic scale feeds a star to the black hole at the centre. It is
the third way a star can end, and unlike the other two it has nothing to do with
the star's mass — only with where it happened to wander.

Gravity alone would not tear a star apart; it would move it. What tears it apart
is the *difference* in gravity across it, which grows as the inverse cube of the
distance while the star's own self-gravity stays where it is. Set those equal:

    r_t = R* (M_bh / M*)^(1/3)

For the Sun and a million-solar-mass hole that is 0.47 AU — inside the orbit of
Venus, from something four million times heavier than the Sun and no bigger.

Three things follow, and the simulation gets all three for free from one number.
The debris comes away with a spread of orbital energies straddling zero, because
the near side of the star sat deeper in the potential than the far side. So
**exactly half escapes**, at six thousand kilometres a second. The bound half
returns most-tightly-bound-first, and because a flat spread in energy becomes a
power law in period through Kepler's third law, it returns as **t^(−5/3)** — one
of the cleanest predictions in astrophysics, seen in dozens of objects over
decades. The first debris is back in **41 days** for a Sun and a million solar
masses, which is why these are found by surveys that revisit the same sky every
few nights, and were not found at all until such surveys existed.

And there is a **heaviest black hole that can do it**. The tidal radius grows as
the cube root of the mass and the horizon grows linearly, so above about 10⁸ M☉
the tidal radius is *inside* the horizon: the star crosses it whole and nothing
is seen. That is the Hills mass. Whether a given galaxy's hole can make a flare
at all is therefore a fact about that galaxy, and the readout says which — a big
elliptical's 6×10⁸ M☉ hole swallows a dwarf whole and can only ever be caught
disrupting a *giant*, whose limit is two hundred times higher because it goes as
R^(3/2).

Nothing about the shape of the stream is drawn. Every one of sixteen thousand
points is a piece of the star on its own Keplerian orbit, differing only in
where in the star it came from; the stream, the escaping arm, the returning arm
and the light curve are all that one difference, propagated. The star's approach
is on a genuine parabola, solved exactly with Barker's equation — the boundary
case both other Kepler solvers fall over on, and the one that matters, because
anything falling in from a great distance arrives on very nearly a parabola.

The event has two lengths — the pericentre and the most-bound apocentre, four
orders of magnitude apart — and two timescales, the day it takes to cross the
tidal radius and the thousand years before the debris returns. The camera frames
the geometric mean and the clock runs in two beats, and the readout says which.

One number is drawn differently from how it is reported, on purpose. A blackbody
fit to a real flare gives an emitting radius of tens of astronomical units —
thousands of times the horizon, larger than the returning stream, and far too
cool for gas that close to a black hole. Something out there is reprocessing what
the disc emits, which is why these flares are ultraviolet and not X-ray, and it
is not settled. So the picture shows where the energy is released and the readout
says how big the thing that radiates it appears to be.

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
| Atmosphere | Jeans escape parameter per species |
| Temperature | An energy budget — see below |
| Habitability | Liquid water on a surface, at a pressure, on a world that kept it |
| Moons | Inside the Hill sphere, outside the Roche limit |
| Rings | Inside the Roche limit |
| Rotation | Tidal despinning timescale against the star's age |
| Zonal jets | The Rhines scale |

Surfaces are analytic: continents from fBm, ranges from ridged multifractal
noise, relief shading from the elevation gradient, and craters only where there
is no atmosphere to burn up impactors and no weather to erode the scars. Where
the ice and the deserts go is decided by the climate, below.

Atmospheres use single-scattering Rayleigh extinction with `β ~ λ⁻⁴`, so limbs
go blue and terminators redden because the path length says they should. Water
is a smooth dielectric, so sunlight glints off an ocean in a narrow GGX lobe
with a Fresnel weight - dark looking straight down, a mirror at grazing angles.

### Climate

A planet used to have one temperature. That is the one number about a world
that a single number cannot carry. The Earth averages 288 K and that average
is true of nowhere: it is 300 K on the equator and 255 K at the poles, it
swings forty degrees between January and July over Siberia and four over the
open Pacific, and the difference between those two facts is why one of them
has trees.

So every world now gets the actual equation solved on it — a seasonal diffusive
energy balance model, Budyko and Sellers in 1969, put on a proper footing by
North in 1975:

```
C(x) ∂T/∂t = S(x,t)[1 − a(T)]  −  OLR(T)  +  ∂/∂x[ D (1−x²) ∂T/∂x ]
             ─────────────────     ──────     ────────────────────
              what arrives          what       what the winds and
                                    leaves     the currents carry off
```

on a grid of latitude bands, equal-area in `x = sin φ`, stepped through the
orbit with the radiation linearised about each step so every step is one
tridiagonal solve.

The sunlight comes from Kepler and spherical trigonometry, the outgoing
radiation from a grey atmosphere carrying a Clausius–Clapeyron water column, the
heat capacity from the depth of an ocean's mixed layer against the mass of an
air column, and the transport coefficient from the published scaling in rotation
rate, pressure and molecular weight. Two constants in the greenhouse are fitted
— to Earth's 33 K and Venus's 505 K — and one more to the *slope* at which
Earth's outgoing radiation rises with temperature. Nothing else is. Given
Earth's numbers the model returns Earth's climate, and given the others it
returns theirs:

| | model | measured |
|---|---|---|
| Earth, global mean | 286 K | 288 K |
| Earth, equator → pole | 300 → 255 K | 299 → 250 K |
| Earth's jet stream | 36 m/s, 3 jets | ~30 m/s, ~3 |
| Earth's Hadley edge | 30° | ~30° |
| Mars | 212 K, 50 K gradient | 210 K, ~60 K |
| Venus | 741 K, isothermal to 0.1 K | 737 K, isothermal |
| Titan | 103 K | 94 K (+ a −9 K anti-greenhouse) |
| Jupiter's belts | 25 jets | ~20–30 |

Three things come out of it that were never put in.

**A planet can have two climates.** The albedo depends on the temperature and
the temperature depends on the albedo, so the balance is nonlinear and can cross
zero three times — two stable climates with a tipping point between them. The
present-day Earth settles at 286 K from a warm start and 233 K from a cold one.
Dim the Sun by a tenth and the warm branch stops existing, in one step, and does
not come back when you turn the Sun up again. The Earth has done this at least
twice.

**Water sets a ceiling on what a planet can radiate.** Warm a wet world and
Clausius–Clapeyron puts more vapour in the air, which warms it further; on Earth
that feedback eats three-fifths of the planet's ability to cool itself — outgoing
radiation climbs at 1.8 W/m²/K where a dry column would give 4.7. Push it
far enough and it wins outright: the level a planet radiates from ends up inside
the saturated part of its own column, and its emission stops depending on the
ground's temperature at about 282 W/m². Simpson noticed the problem in 1927;
Nakajima made it precise in 1992. A world absorbing more than that has *no
equilibrium* with an ocean on it. Move the Earth to 0.85 AU and it does not get
warmer — it stops having an answer.

**And then the carbon has nowhere to go.** Carbon dioxide dissolves in rain, the
rain weathers silicate rock, the sea buries the result as carbonate, and
volcanoes put it back. Weathering roughly doubles for every ten degrees, so the
loop is a thermostat with a gain of a few hundred: warm the planet and it scrubs
its own air faster. Given nothing but Earth's sunlight it asks for a few hundred
parts per million of CO₂, which is where Earth's has sat for as long as anyone
has been able to check. Take the oceans away and there is no rain, so no
weathering, so nothing to bury carbon — and every gram the planet ever outgassed
stays in the sky.

That chain is not written down anywhere. It is what the equations do, and what
comes out the other end of it is Venus.

The thermostat also sets its own setpoint, which is not 288 K either: 288 K is
where *Earth's* volcanoes and *Earth's* rain happen to balance. A world
outgassing harder settles hotter, and a world with no land has almost nothing
for the rain to dissolve — so a waterworld is not a safer Earth, it is a hotter
one with a broken regulator.

**What you can see of it.** The whole solved field — latitude across, season
down — goes to the surface shader as a texture, so:

- Ice is drawn where the temperature crosses freezing, and the caps advance and
  retreat as time runs. But being cold is not enough: there has to be water
  there to freeze, which is why Mars is a red planet rather than a white one
  despite being below freezing everywhere. What it does have is a bright winter
  cap of *carbon dioxide*, frozen out of its own air at 148 K.
- Mountains are white because of the lapse rate — a saturated parcel cools
  6.5 K/km, so a three-kilometre range is twenty degrees colder than the plain
  it stands on, and a thin-aired world's peaks are colder still.
- Deserts sit under the descending branch of the Hadley cell, at the latitude
  the planet's own rotation puts it. On Earth that is thirty degrees, and there
  in one band are the Sahara, the Kalahari, the Atacama, the Arabian and the
  Australian interior.
- A giant's belts are counted by the Rhines scale. Turbulence on a rotating
  sphere cannot make eddies larger than the scale at which the β effect turns
  them into waves, so the energy goes into zonal jets instead. Jupiter fits two
  dozen because it turns in ten hours and is eleven times wider than Earth,
  which is how many you can count in a small telescope. Nothing about Jupiter's
  stripes is decorative.

Press `C` on a world and the whole field is drawn: the 273 K contour traced
through the year, two curves half a year out of phase, breathing against each
other. That is what a season looks like when you plot it.

**Where the model ends.** It is one-dimensional and zonally symmetric, so it has
no continents — Earth's real seasonal swing is larger than it reports because
Earth's land is nearly all in one hemisphere. The greenhouse is grey, with two
parameters fitted to Earth's 33 K and Venus's 505 K; Mars's and Titan's then come
out as predictions, and the model has no business being trusted for a
composition unlike any of them. Most of all it has no maximum-greenhouse outer
edge, because that turnover needs CO₂ condensation and cloud physics a grey model
cannot carry: the outer edge here is set instead by how much carbon a planet has
and whether its interior is still hot enough to outgas it, which is a real limit
and a different one.

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

### Standing on it

Below the planet is its surface, and the physics of being on one is mostly the
physics of looking up. The sky is not a gradient: Rayleigh scattering
coefficients come from the gas's own refractive index and depolarisation
through the King factor, the slant path through a curved atmosphere is the
Chapman function rather than a secant — which matters at sunrise, where the
secant diverges and the real air mass is 38 — and the multiple scattering that
keeps a real sky from going black at the zenith is put back with one constant.
Earth comes out at τ = 0.195 with an 8.6 km scale height and a 4.65 km horizon,
Mars at τ = 0.552 and butterscotch, Mercury black at noon.

Every other planet of the system is up there too, where it really is. Their
positions are the actual orbits subtracted; their brightnesses are the standard
photometric system — absolute magnitude from size and albedo, two inverse
squares for the light's two legs, a Lambert phase function, then extinction by
the same air that reddens the star. From Earth, Venus at −4.4; from Mars,
**Earth is a morning star at −2.0**; from Europa, Earth at +1.4 and never more
than eleven degrees from the sun. Nothing labels those. Inner planets cannot
leave the sun because the angle to a smaller circle is capped at `asin(a/a₀)`,
outer planets go backwards twice a synodic period, and Venus is brightest as a
crescent — all of it out of one vector difference.

The join between the ephemeris and the ground is a rotation built from two
directions known on both sides: the world's axis, which stands at an altitude
equal to the latitude, and the star, whose place the sundial already knows. So
the star lands exactly where the sundial says, and everything else is carried
rigidly with it.

Eclipses happen because things line up, not because anything schedules them.
Every disc in the sky is tested against the star; the sky shader is told what
is in front of it and cuts the disc rather than dimming it, so the sun goes to
a crescent and the crescent thins from the limb inward. Which plane a moon
orbits in is decided by the Laplace radius, where the planet's equatorial bulge
and the star's tide balance: 10.6 Earth radii for Earth against a measured ~10,
40 Jupiter radii against ~32. Our Moon is six times outside that and follows
the ecliptic, so eclipses come in seasons twice a year; every Galilean is well
inside it and sits in Jupiter's equator, so they are eclipsed nearly every
orbit. Hunting twenty-five years of Earth's sky from one fixed point, the
closest the Moon comes to the sun is 0.070° against radii of 0.2664 and 0.2623
— 81% covered, a crescent sun and a steel-grey afternoon. Deep partials from
one place and totality almost never, which is how it goes.

At totality from a moon there is a ring of copper light round the planet's
limb: light that grazed through its atmosphere, lost its blue to Rayleigh, and
bent far enough to reach you. Its colour is computed from that planet's own
gas.

### The ground

The spheres a chemist draws at fixed distances are a lie of a specific kind,
and one rung down is what is really there: a pattern of a handful of atoms,
repeated by translation, without end.

The structures are the measured ones, and the check is density — mass in a cell
over the volume of the cell, nothing fitted. Quartz comes out at 2649 kg/m³
against a measured 2648, iron at 7874 against 7874, rock salt at 2163 against
2165, ice at 920 against 917. Coordination numbers land on the ones the
structures are named for: six for rock salt, four for diamond, eight for
body-centred iron, twelve for the big cation in a perovskite, one for a
nitrogen molecule whose nearest neighbour is its own other half. Quartz's
oxygen position is not copied from a table but solved for, by requiring every
silicon to sit at the centre of a regular tetrahedron at the measured 1.609 Å
bond — there is a position that does it exactly.

Ice and methane keep hydrogens that are not at any crystallographic site — in
ice each oxygen holds two of the four pointing at it and which two is a coin
flip, which is why ice has entropy left at absolute zero. They still weigh what
they weigh, and leaving them out shows as a density ten and twenty-five percent
light.

It moves, and the motion is phonons rather than jitter: a superposition of
plane waves on a real acoustic branch, `ω = ω_max sin(ka/2)`, flattening at the
zone boundary because a wave shorter than two atoms has nothing left to wave.
Those waves are sound. The heat in a rock and a knock travelling through it are
the same object. The amplitude is Debye with the zero-point term kept, because
that term is why helium has no solid phase at ordinary pressure, and light
atoms swing further — the oxygen in quartz visibly outmoves the silicon it is
bonded to. The speed of sound falls out of the same Debye temperature: 6691 m/s
for periclase against a measured 6600.

Melting is reported as Lindemann's ratio rather than as a predicted
temperature. Over a metal, two ionic crystals, a covalent network, a
hydrogen-bonded framework and two stacks of molecules — things melting at 63 K
and at 4400 K — the shaking at each one's own melting point comes out between
six and thirteen percent of its spacing. Materials with nothing else in common
agree on when to give up, within a factor of two, and that agreement is the
whole content of the rule.

Press **E** and the atoms swell from the third-scale balls of a diagram to the
size they really are. The structure disappears into a solid block, which is
what a solid is.

### One atom

There is no surface here either. What sets the size of an atom is the region an
electron is likely to be found in, so this draws the distribution and nothing
else: every point a place the electron might be, sampled from |ψ|², a fifth of
the cloud retired and re-drawn every second. Nothing moves while that happens.
An electron has no trajectory, and animating one would be the only lie in the
picture.

The wavefunctions are hydrogenic with associated Laguerre polynomials and the
real spherical harmonics, and they verify: each normalises to 1.000 by
integration, has exactly `n − l − 1` radial nodes, and matches the closed form
`⟨r⟩ = (3n² − l(l+1))a₀/2Z` to five figures. The ground state peaks at the Bohr
radius. Summed over a filled subshell the harmonics come to exactly
`(2l+1)/4π` in every direction — Unsöld's theorem, and why a noble gas is a
ball and bonds to nothing.

Screening is Slater's rules, four numbers and some arithmetic from 1930, and it
reproduces the published values exactly: iron's 4s electron feels 3.75 protons
of the twenty-six, its 3d feels 6.25, its 1s feels 25.70. Across lithium to
neon the valence electron gains exactly 0.65 of a proton per step and then
collapses from 5.85 to 2.20 at sodium. That sawtooth is why atoms shrink left
to right while getting heavier, and why sodium hands its electron to anything
that asks. Occupancy follows Hund's rule, which is visible from here: carbon's
two 2p electrons go into two different orbitals, so its cloud has lobes
pointing somewhere rather than being a sphere — and that is where its bonds go.

Where the model fails is reported. Hydrogen is exact, because hydrogen is what
the model is. The second row is within three percent. A 4s orbital is out by a
factor of two and a half, always too big, because a real 4s penetrates deep
inside the closed shells and a hydrogenic function cannot. The cloud is drawn
with that one factor divided out, so the picture is the size the atom is.

The nucleus is drawn at true size, which is to say drawn and not visible. An
iron atom a kilometre across would have a thirty-one millimetre nucleus holding
all but a three-thousandth of the mass. It is really there, and the near plane
follows the camera down nine orders of magnitude so it can be flown to.

**Q** takes the cloud apart one orbital at a time. Isolating 2p is how you see
that it is two lobes with a plane of nothing between them, which is invisible
in the total density because the other two p orbitals fill that plane in.

### The nucleus

A drop of the densest material outside a black hole: a teaspoon of it weighs a
trillion tonnes, and it is exactly what a neutron star is made of. It churns,
because nucleons are fermions and cannot all settle to the bottom — they are
forced up a ladder of momenta with no heat about at all, and the topmost is
moving at 27% of light speed. Each is put on a circular orbit in the mean field
at a radius drawn from the Woods-Saxon profile electron scattering measures,
which makes the ensemble exactly stationary: the rms radius holds at 3.840 fm
across every sample while all fifty-six nucleons move, some by seven
femtometres.

The physics is the Bethe-Weizsäcker mass formula — five terms treating the
nucleus as a drop of incompressible charged liquid, written down in 1935. It
puts every nucleus from carbon to uranium within three percent of its measured
binding energy and most within one: iron-56 at 8.85 MeV per nucleon against
8.79, lead-208 at 7.86 against 7.87, uranium-238 at 7.63 against 7.57. Setting
its derivative to zero gives the floor of the valley of stability, which puts
A = 16 at oxygen, A = 208 at lead and A = 238 at uranium. The alpha energy of
uranium comes out at 4.3 MeV against 4.27, alpha decay first becomes allowed at
A = 157 against a real onset near 145, and splitting a uranium gives 184 MeV
against the ~200 everyone quotes.

Its two failures are the same failure: helium-4 at 5.7 MeV per nucleon against
7.07, and doubly magic lead-208 given five times too much alpha energy. A
liquid drop has no shells, and at four nucleons or at 82-and-126 the shells are
the whole answer. A lone proton is special-cased to zero — left to run, the
asymmetry term alone reports it as unbound by 24 MeV, which is a category error
rather than a small one.

Above the readout is the binding energy curve, and standing on hydrogen it says
the one thing that matters: two protons do not stick. Helium-2 is unbound, so
the first step of the proton-proton chain needs one of them to turn into a
neutron by the weak force in the moment they are touching. That almost never
comes off, and it is why the sun takes ten billion years over something it has
the fuel to do in minutes.

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
| C | change the cosmology, or read a world’s climate |
| V | tint the web by peculiar velocity |
| B | show the microwave background |
| J | fly at a fraction of light speed |
| G | merge two black holes |
| Z | a pulsar, and the diagram it lives on |
| I | a star torn apart by a black hole |
| D | Hertzsprung-Russell diagram |
| N | hear the merger |
| Y | run the star's whole life, to the nebula |
| O | go to the Solar System |
| T | true scale in a system |
| `,` `.` | walk south or north, on a surface |
| `;` | the microwave sky, from inside a cluster |
| E | atoms at the size they really are |
| Q | one orbital at a time |
| X | aim with the device's own orientation |
| U | hide the interface |
| P | save a frame |
| H | all of the above |

### On a phone

Not the same interface with things removed. A keyboard has to offer every
command at once because it cannot tell which are meaningful; the shelf along
the bottom is built at the moment of use, asks the current scale what it is
capable of, and shows only that — so it is smaller than the keyboard and
reaches exactly as far. One table backs both, so they cannot drift apart.

| | |
|---|---|
| drag | orbit |
| pinch | zoom, about the point between your fingers |
| two fingers | slide to pan, twist to turn |
| flick | let go while moving and it carries on |
| tap | inspect |
| double tap | go in a scale |
| two-finger tap | climb back out |
| pull up the shelf | the numbers for wherever you are |
| the marks, right edge | the five scales |

Pinch zooms about the point between the fingers rather than the middle of the
screen, which is the difference between grabbing the sky and operating a
slider; on the plane through the focus it is exact. The poles give rather than
stop. Resolution is found by measurement, not guessed from the device's pixel
ratio — the same page runs on a phone with a three-times display and a GPU that
will not sustain it, and the cost changes by two orders of magnitude between
the cosmic web and a planet's surface anyway.

Double tap always goes in. It aims when a finger has something under it, but is
never refused for want of a hit: on a phone the target is a few pixels of galaxy
in a field of a hundred thousand, and a gesture that works only when it lands on
one is a gesture that does not work.

Touches are taken from the window rather than the canvas, and a gesture belongs
to the scene unless it lands on something marked as a control — the shelf, the
ladder, the scrub bar, the guide. Everything else that floats over the picture
only *reports* on it, and must let a finger through; listening on the canvas
alone meant any open panel silently ate the second half of a double tap, so
descending worked or didn't depending on where a panel happened to be.

The gestures are a state machine with no DOM in it, tested by being driven
directly, which is how six bugs were found before any of it reached a phone —
including the one that mattered: the hold timer runs on wall time, and wall
time lies. When the main thread is busy building a new scale, a fifty
millisecond tap has its release still in the queue when the timer fires, so
taps became holds and double-tap-to-descend stopped working on exactly the slow
devices that need it. Every decision now comes from the timestamps the events
carry.

**X** on a phone hands the camera to the orientation sensors. The angles a
browser reports are intrinsic Z-X'-Y'' Tait-Bryan rotations; after them come a
quarter turn about x, because the device frame has z out of the screen and a
camera looks along −z, and a roll by the screen orientation, because turning a
phone into landscape changes which way is up on the display and nothing at all
about the sensors, which are bolted to the case. The mapping is absolute, so
there is nothing to drift and turning the whole way round brings you back
exactly where you began.

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
tuning: `?mode=system|planet|nebula|pn|pulsar|tde|blackhole|merger|encounter`, plus every look parameter as a
query argument. It is not part of the experience; it is how the experience got
tuned.

## Layout

```
src/
  core/         constants, deterministic RNG
  cosmology/    LambdaCDM, the power spectrum, FFT, Zel'dovich, the worker
  physics/      Kepler solvers, orbital elements, relativity, N-body,
                lensing, eclipses, magnetospheres, crystal structures,
                atomic orbitals, the nuclear mass formula
  camera/       the orbit and flight rigs, touch gestures, device orientation
  astro/        blackbody colour, stellar evolution, planet formation,
                insolation, radiative transfer, climate, circulation,
                spectra, supernovae, planetary nebulae, pulsars,
                tidal disruption, binaries, comets, atmospheres and skies,
                moons as places to stand, the planetary ephemeris
  galaxy/       kinematic density waves, population synthesis
  render/       the HDR engine and every shader
  sim/          the universe object graph and the scale ladder
  ui/           the interface
tests/          866 tests against published measurements and against
                every edge of the gesture recogniser
scripts/        browser probes: every scale in motion, the whole ladder on
                touch, and a health check for the interface at real window
                sizes
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
3.36 mK, the acoustic peaks at ℓ = 216, 504, 792, Ca II K coming out as the
deepest line in a solar spectrum, a planetary nebula reaching a light-year and
a half across in ten thousand years — which is what the Helix measures — and
the Crab pulsar's 3.8 trillion gauss, its 4.5×10³⁸ erg/s, a characteristic age
that misses the true one by exactly as much as it should, and a tidally
disrupted star whose first debris returns after 41 days and whose light curve
falls as t^(−5/3).

The climate adds its own: Earth's June pole taking 524 W/m² — more than its
equator ever gets — the 54° obliquity above which the poles beat the equator
over a whole year, Earth's 33 K greenhouse and Venus's 505 K and Mars's 3 K and
Titan's 20 K, the 282 W/m² ceiling on what a wet atmosphere can radiate, the
1.8 W/m²/K with which Earth's outgoing radiation rises against the 4.7 a dry
column would give, a 0.58 W/m²/K transport coefficient, a modelled Earth at
286 K and Mars at 212 K and Venus at 741 K, a Hadley cell reaching 30° on Earth
and the pole on Venus, three jets on Earth and two dozen on Jupiter, a
continent swinging three times as far through the year as an ocean, a winter
pole pinned at the frost point of its own air, and a present-day Earth with two
stable climates fifty degrees apart.

Down the bottom of the ladder the same rule applies. Earth's sky comes out at
τ = 0.195 with an 8.6 km scale height; quartz at 2649 kg/m³ against a measured
2648 and iron at 7874 against 7874; every silicon in quartz with exactly four
oxygens at 1.609 Å; the speed of sound in periclase at 6691 m/s against 6600;
the Lindemann ratio at melting between 0.06 and 0.13 for seven materials that
melt between 63 K and 4400 K; hydrogen's 1s peaking at the Bohr radius and
every orbital normalising to 1.000 with exactly `n − l − 1` nodes; Slater's
screening reproducing iron's 3.75, 6.25 and 25.70 exactly; nuclear matter at
0.146 nucleons per cubic femtometre with its nucleons at 0.27 c; iron-56 bound
at 8.85 MeV per nucleon against 8.79 and uranium-238 at 7.63 against 7.57.

Several tests exist because they caught something. `altAz` had the sign of its
north component backwards, so the sun transited due north from London and the
whole celestial sphere was a mirror image — invisible in an empty sky, and
fatal the moment an ephemeris had to be laid on it. Two of the symmetry
operations I had written down for quartz were wrong, which showed up as silicon
with three oxygens instead of four. And a test asserting that every light
nucleus fuses profitably failed on hydrogen: the model was right and the test
was wrong, because two protons genuinely do not stick.

Where the model is an approximation, it is one with a name and a range of
validity. Zel'dovich is first-order Lagrangian perturbation theory: exact until
shell crossing, qualitatively right after. Kinematic density waves reproduce
the geometry and the differential streaming, but not the wave's own dynamics.
The halo finder is peak identification with exclusion, not a friends-of-friends
group finder. None of it is a substitute for a real N-body code - but none of
it is made up either.
