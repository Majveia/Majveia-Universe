/**
 * Planet rendering.
 *
 * A planet is three nested shells:
 *
 *  1. The body, shaded with an analytic procedural surface. Terrestrial worlds
 *     get continents from fractal Brownian motion, mountain ranges from ridged
 *     multifractal noise, ice caps placed by latitude *and* temperature, and
 *     oceans wherever the elevation falls below the sea level implied by their
 *     water inventory. Gas giants get latitudinal bands sheared by a
 *     differential-rotation profile and stirred by domain warping, which is how
 *     Jupiter's belts and its vortices actually arise.
 *
 *  2. The cloud deck, an independent noise layer advected by zonal winds.
 *
 *  3. The atmosphere, an outward-facing shell with single-scattering Rayleigh
 *     extinction. Because the scattering coefficient goes as lambda^-4, the
 *     limb goes blue on an Earth-like world and the terminator reddens - not
 *     because a gradient was painted there, but because the path length through
 *     the air is longest at grazing angles.
 */

import * as THREE from 'three';
import { NOISE_GLSL } from './shaders/noise';
import { ECLIPSE_GLSL } from './shaders/eclipse';
import type { Planet } from '../astro/planets';
import { condensationTemperature, type Climate } from '../astro/climate';
import { climateTexture, type ClimateTexture } from './climatetex';
import { moistLapseRate } from '../astro/radiation';
import { R_EARTH } from '../core/constants';

const SURFACE_VERT = /* glsl */ `
out vec3 vObj;
out vec3 vNormal;
out vec3 vWorld;
void main() {
  vObj = position;
  // World-space normal. three's normalMatrix is the inverse transpose of the
  // *modelView* matrix, so using it here would give a view-space normal, and
  // the terminator would follow the camera instead of the star.
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const SURFACE_FRAG = /* glsl */ `
precision highp float;
${NOISE_GLSL}
${ECLIPSE_GLSL}

in vec3 vObj;
in vec3 vNormal;
in vec3 vWorld;
out vec4 fragColor;

uniform vec3 uSunDir;        // world-space direction to the star
uniform vec3 uSunColor;      // linear RGB times irradiance
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uSeed;
uniform float uTime;
uniform float uOcean;        // sea-level fraction 0..1
uniform float uIce;          // ice-cap extent 0..1
uniform float uCloud;        // cloud cover 0..1
uniform float uIceThreshold; // K below which there is ice here
uniform float uFrostK;       // K at which the air itself frosts onto the ground
uniform float uType;         // 0 rocky, 1 gas giant, 2 ice, 3 lava, 4 living
uniform float uRoughness;
uniform float uAtmoDensity;
uniform float uAtmoBar;
uniform vec3 uAtmoColor;
uniform float uNightLights;
uniform float uLife;
uniform float uRadius;
uniform float uObliquity;
uniform vec3 uRingNormal;
uniform float uRingInner;
uniform float uRingOuter;
uniform float uRingOpacity;
uniform float uLavaGlow;
uniform float uReliefStrength;

// --- Climate. A grid of the solved energy balance: latitude across, season
// down. Sampling it is how the surface finds out what the weather is where it
// is standing, rather than being told where to put its ice.
uniform sampler2D uClimate;
uniform float uHasClimate;
uniform vec2 uClimRange;     // K at texel value 0 and 1
uniform float uSeason;       // fraction of the orbit, 0 to 1
uniform float uLapseRate;    // K per unit of terrain elevation
uniform float uJetFreq;      // zonal jets, as a spatial frequency in sin(lat)
uniform float uLocked;       // 1 if the coordinate is angle from the substellar point
uniform vec3 uSubstellar;    // body-frame direction of the star, for a locked world

/** Temperature at a point on the surface, before the terrain is accounted for. */
vec4 climateAt(vec3 pn) {
  float u = uLocked > 0.5 ? (1.0 - dot(pn, uSubstellar)) * 0.5 : pn.y * 0.5 + 0.5;
  return texture(uClimate, vec2(clamp(u, 0.002, 0.998), uSeason));
}

const float PI = 3.14159265359;

// --- Shadow of the ring system cast onto the planet. A ring is a thin annulus
// in the equatorial plane, so the test is: follow the ray to the star, find
// where it crosses that plane, and check whether the crossing radius lies
// between the ring's edges.
float ringShadow(vec3 p, vec3 toSun) {
  if (uRingOpacity <= 0.001) return 1.0;
  float dn = dot(uRingNormal, toSun);
  if (abs(dn) < 1e-4) return 1.0;
  float t = -dot(uRingNormal, p) / dn;
  if (t < 0.0) return 1.0;
  vec3 hit = p + toSun * t;
  float r = length(hit);
  if (r < uRingInner || r > uRingOuter) return 1.0;
  float band = 0.55 + 0.45 * sin(r * 90.0 / uRingOuter);
  return 1.0 - uRingOpacity * 0.82 * band;
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 p = normalize(vObj);
  vec3 sp = p * 2.2 + vec3(uSeed);

  float lat = p.y;                       // -1 pole to +1 pole in body frame
  vec3 albedo;
  float spec = 0.0;
  vec3 emissive = vec3(0.0);

  if (uType > 0.5 && uType < 1.5) {
    // ------------------------------------------------------------------ gas giant
    // Zonal bands. Differential rotation shears any disturbance into a
    // latitude-parallel stripe, so the base pattern is a function of latitude
    // alone; domain warping in longitude then produces the ragged edges and
    // the vortices that sit between opposing jets.
    float zonal = lat;
    vec3 q = sp;
    q.y *= 3.0;
    q = warp(q, 0.55, 1.6);
    q = warp(q, 0.22, 3.4);
    // The number of belts is not a choice. Turbulence on a rotating sphere
    // cannot make eddies bigger than the Rhines scale, so the energy goes into
    // zonal jets instead, and how many fit across the planet is set by its
    // rotation and its size. Jupiter gets about two dozen; a slow rotator gets
    // one cell per hemisphere and no stripes at all.
    float bands = sin(zonal * uJetFreq + fbm(q * 1.3, 5, 2.0, 0.55) * 5.5);
    float fine = fbm(q * 4.0 + vec3(uTime * 0.02, 0.0, 0.0), 5, 2.1, 0.5);
    float t = clamp(bands * 0.5 + 0.5 + fine * 0.22, 0.0, 1.0);
    albedo = mix(uColorA, uColorB, t);

    // Great storms: long-lived anticyclones between the jets.
    vec2 cell = worley(vec3(q.x * 1.1, lat * 5.0, q.z * 1.1));
    float storm = smoothstep(0.42, 0.06, cell.x) * smoothstep(0.15, 0.5, abs(lat));
    albedo = mix(albedo, uColorB * 1.5 + vec3(0.12, 0.05, 0.0), storm * 0.75);

    // Polar hexagon-ish darkening and haze
    albedo *= 1.0 - 0.28 * smoothstep(0.72, 0.98, abs(lat));
    spec = 0.02;
  } else if (uType > 2.5 && uType < 3.5) {
    // ------------------------------------------------------------------ lava world
    vec3 q = warp(sp * 1.6, 0.4, 2.0);
    float crust = fbm(q * 2.4, 6, 2.1, 0.52);
    vec2 cells = worley(q * 2.2);
    float cracks = smoothstep(0.16, 0.0, cells.y - cells.x);
    float heat = clamp(cracks * 1.4 + smoothstep(0.35, -0.2, crust) * 0.5, 0.0, 1.0);
    albedo = mix(uColorA * 0.5, vec3(0.09, 0.05, 0.04), smoothstep(-0.2, 0.5, crust));
    emissive = uColorB * pow(heat, 2.2) * uLavaGlow * (0.75 + 0.25 * sin(uTime * 0.6 + crust * 12.0));
    spec = 0.05;
  } else {
    // ------------------------------------------------------------- rock, ice, life
    vec3 q = warp(sp, 0.22, 0.9);
    float continents = fbm(q * 1.15, 7, 2.05, 0.52);
    float mountains = ridged(q * 3.1 + vec3(17.0), 6, 2.2, 0.5);
    float elev = continents + mountains * 0.35 * smoothstep(-0.05, 0.35, continents);

    // Relief. Sampling the elevation field at two nearby points gives its
    // surface gradient, which tilts the shading normal - so mountain ranges
    // catch the light on one flank and shadow the other, and coastlines read
    // as edges rather than as colour changes.
    vec3 tang = normalize(cross(p, vec3(0.0, 1.0, 0.0)) + vec3(1e-4));
    vec3 bitan = cross(p, tang);
    const float eps = 0.004;
    vec3 qa = warp((p + tang * eps) * 2.2 + vec3(uSeed), 0.22, 0.9);
    vec3 qb = warp((p + bitan * eps) * 2.2 + vec3(uSeed), 0.22, 0.9);
    float ea = fbm(qa * 1.15, 6, 2.05, 0.52)
      + ridged(qa * 3.1 + vec3(17.0), 5, 2.2, 0.5) * 0.35 * smoothstep(-0.05, 0.35, continents);
    float eb = fbm(qb * 1.15, 6, 2.05, 0.52)
      + ridged(qb * 3.1 + vec3(17.0), 5, 2.2, 0.5) * 0.35 * smoothstep(-0.05, 0.35, continents);
    float relief = uReliefStrength;
    n = normalize(n - (tang * (ea - elev) + bitan * (eb - elev)) * relief / eps * 0.0016);

    // Sea level chosen so that the requested fraction of the surface floods.
    // The sign matters and was the wrong way round: a high sea level drowns
    // more land, so an ocean fraction of one has to raise it, not lower it.
    float sea = mix(-0.62, 0.62, clamp(uOcean, 0.0, 1.0));
    float land = smoothstep(sea - 0.015, sea + 0.015, elev);

    // Deep water is nearly black: it absorbs red first, then green, and what
    // comes back up is the little blue that scattered before being absorbed.
    vec3 deep = uColorB * 0.22;
    vec3 shallow = uColorB * 0.95 + vec3(0.0, 0.06, 0.10);
    float depth = smoothstep(sea - 0.35, sea, elev);
    vec3 water = mix(deep, shallow, depth);

    vec4 clim = climateAt(p);
    // Height above sea level, in metres, and the temperature that costs. A
    // saturated air parcel cools 6.5 K for every kilometre it rises, so a
    // three-kilometre range is twenty degrees colder than the plain it stands
    // on - which is why there is snow on mountains at the equator.
    float altitude = max(elev - sea, 0.0);
    float bandK = mix(uClimRange.x, uClimRange.y, clim.r);
    float surfK = uHasClimate > 0.5 ? bandK - altitude * uLapseRate : 300.0 - abs(lat) * 60.0;
    float rain = uHasClimate > 0.5 ? clim.b * 3.0 : 1.0;

    vec3 lowland = uColorA;
    vec3 highland = mix(uColorA, vec3(0.30, 0.27, 0.24), smoothstep(sea + 0.05, sea + 0.45, elev));
    vec3 rock = mix(lowland, highland, 0.55);
    // Deserts are where the Hadley cell's descending branch lands, and the
    // model puts that branch where the planet's rotation puts it - not at a
    // latitude written down here. On Earth it comes out at thirty degrees,
    // which is the Sahara, the Kalahari, the Atacama and the Australian
    // interior, in one band.
    float arid = smoothstep(0.85, 0.25, rain);
    rock = mix(rock, vec3(0.50, 0.36, 0.20), arid * 0.55 * (1.0 - uOcean * 0.5));

    // Where it is warm enough and wet enough, and something is alive to take
    // advantage of it.
    if (uLife > 0.001) {
      float warm = smoothstep(273.0, 283.0, surfK) * smoothstep(325.0, 305.0, surfK);
      float green = warm * smoothstep(0.5, 1.3, rain) * uLife;
      rock = mix(rock, vec3(0.055, 0.135, 0.045), green * 0.85);
    }

    albedo = mix(water, rock, land);
    spec = mix(0.55, 0.03, land);

    // Craters, where there is no atmosphere to burn up impactors and no
    // weather to erode the scars.
    if (uAtmoDensity < 0.08) {
      vec2 c1 = worley(q * 5.0);
      float crater = smoothstep(0.28, 0.30, c1.x) * smoothstep(0.36, 0.31, c1.x);
      albedo *= 1.0 - crater * 0.35;
      albedo += crater * 0.06;
    }

    // Ice, where the energy budget says the water is frozen - and nowhere
    // else. No latitude is written down: the cap edge is wherever this world's
    // own solved temperature crosses 273 K at this point in its year, and it
    // advances and retreats as that point moves. The noise only roughens the
    // boundary, so it reads as a coastline rather than a drawn circle.
    float capNoise = fbm(q * 3.0 + vec3(51.0), 4, 2.0, 0.5) * 3.5;
    float icy;
    if (uHasClimate > 0.5) {
      // Cold is not enough. There has to be water here to freeze, and a world
      // with only a trace of it can only whiten its very coldest ground - so
      // the threshold is the temperature below which this planet's own water
      // inventory runs out, not the freezing point. Mars is below freezing
      // everywhere and is not a white planet.
      icy = smoothstep(uIceThreshold + 2.0, uIceThreshold - 2.0, surfK + capNoise);
      // Below the frost point the atmosphere itself snows onto the ground,
      // water or no water. That is what the bright winter cap on Mars is:
      // carbon dioxide, out of the air, a metre thick, gone again by spring.
      icy = max(icy, smoothstep(uFrostK + 1.5, uFrostK - 1.5, surfK + capNoise * 0.5));
    } else {
      float cn = capNoise * 0.045;
      icy = smoothstep(1.0 - uIce - 0.12, 1.0 - uIce + 0.06, abs(lat) + cn)
          + smoothstep(sea + 0.42, sea + 0.62, elev) * 0.8 * step(0.02, uIce);
    }
    icy = clamp(icy, 0.0, 1.0);
    albedo = mix(albedo, vec3(0.70, 0.75, 0.82), icy);
    spec = mix(spec, 0.25, icy);
  }

  // --- Illumination
  vec3 sun = normalize(uSunDir);
  float ndl = dot(n, sun);
  // A soft terminator: a star is not a point source, and the atmosphere
  // scatters light around the limb.
  // Terminator width. An airless world has a knife edge; a thick atmosphere
  // scatters light past the geometric terminator and softens it over degrees.
  float soft = 0.045 + 0.22 * clamp(log(1.0 + uAtmoBar) / 2.4, 0.0, 1.0);
  float diffuse = smoothstep(-soft, soft * 1.6, ndl);
  float shadow = ringShadow(vObj, sun);

  // A moon in the way does not switch the light off; it covers a fraction of
  // the star's disc, and that fraction is what dims the ground.
  float sunlight = eclipseLight(vWorld, sun);

  // Sun glint. Water is a smooth dielectric, so its reflection is a narrow GGX
  // lobe with a Fresnel weight - which is why the sea is dark looking straight
  // down and a mirror at grazing angles, and why the reflected star smears into
  // a streak instead of staying a point.
  vec3 viewDir = normalize(cameraPosition - vWorld);
  vec3 h = normalize(sun + viewDir);
  float nh = max(dot(n, h), 0.0);
  float cosV = clamp(dot(n, viewDir), 0.0, 1.0);
  float fres = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
  // Wind roughens the sea; a mirror-flat ocean would give a point, not a glint.
  float rough = mix(0.30, 0.055, spec);
  float a2 = max(rough * rough, 1e-4);
  float den = nh * nh * (a2 - 1.0) + 1.0;
  float ggx = a2 / (PI * den * den);
  float gloss = min(ggx * fres * spec, 22.0) * diffuse;

  vec3 col = albedo * uSunColor * diffuse * shadow * sunlight;
  col += uSunColor * gloss * shadow * sunlight * 0.85;
  col += emissive;

  // --- Cloud deck
  if (uCloud > 0.01 && uType < 0.5) {
    vec3 cq = warp(p * 2.6 + vec3(uSeed * 0.37) + vec3(uTime * 0.012, 0.0, 0.0), 0.5, 1.4);
    float c = fbm(cq * 1.8, 6, 2.1, 0.55) * 0.5 + 0.5;
    // Cloud bands follow the general circulation: two mid-latitude storm
    // tracks, a wet equator and dry subtropics. Latitude moves the *threshold*
    // rather than the field, so the requested cover is roughly what comes out -
    // scaling the field instead put Earth's 67% under total overcast.
    // Cloud follows the circulation, and the circulation is solved: the
    // rising branch is overcast, the descending branch is clear, and the belt
    // moves through the year because the rain belt does.
    vec4 cc = climateAt(p);
    float belt = uHasClimate > 0.5 ? clamp(cc.b * 2.6, 0.15, 1.6)
                                   : 0.55 + 0.45 * cos(lat * 9.0);
    float thresh = 0.86 - 0.44 * uCloud * belt;
    float cover = smoothstep(thresh - 0.06, thresh + 0.06, c);
    // Cloud tops are lit by the star and by nothing else worth speaking of: the
    // ambient term has to be no brighter than the ground's, or the night side
    // fills with grey cloud that is brighter than the dark surface under it.
    vec3 cloudCol = vec3(1.0) * uSunColor * (diffuse * sunlight * 0.95 + 0.006);
    col = mix(col, cloudCol, cover * 0.92);
  }

  // --- Night side
  float night = 1.0 - diffuse;
  if (uNightLights > 0.001 && uType < 0.5) {
    // Lit settlement is hierarchical: a few inhabited regions, conurbations
    // inside them, and individual towns inside those. One octave of noise gives
    // continent-sized blobs of light, which is why this is three scales.
    float region = smoothstep(0.44, 0.70, fbm(p * 2.6 + vec3(uSeed * 1.7), 4, 2.1, 0.55) * 0.5 + 0.5);
    float belt = smoothstep(0.38, 0.66, fbm(p * 11.0 + vec3(uSeed * 0.9), 4, 2.2, 0.5) * 0.5 + 0.5);
    float town = smoothstep(0.52, 0.84, fbm(p * 41.0 + vec3(uSeed * 2.3), 3, 2.4, 0.5) * 0.5 + 0.5);
    float cities = region * belt * town * (1.0 - smoothstep(0.55, 0.92, abs(lat)));
    // Settlements cluster on coasts, and there are none at sea.
    float shore = fbm(warp(p * 1.15 + vec3(uSeed), 0.35, 1.1) * 1.15, 7, 2.05, 0.52)
                - mix(-0.62, 0.62, clamp(uOcean, 0.0, 1.0));
    cities *= step(0.0, shore) * clamp(1.0 - shore * 2.6, 0.0, 1.0);
    // And they are under the weather like everything else.
    cities *= 1.0 - uCloud * 0.45;
    col += vec3(1.0, 0.74, 0.38) * cities * night * uNightLights * 1.6;
  }

  // Ambient starlight, so the night side is not perfectly black
  col += albedo * 0.006;

  fragColor = vec4(col, 1.0);
}
`;

const ATMO_VERT = /* glsl */ `
out vec3 vWorld;
out vec3 vNormalW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const ATMO_FRAG = /* glsl */ `
precision highp float;
in vec3 vWorld;
in vec3 vNormalW;
out vec4 fragColor;

uniform vec3 uCenter;
uniform float uPlanetRadius;
uniform float uAtmoRadius;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uBeta;       // Rayleigh scattering coefficients, per unit optical depth
uniform float uDensity;
uniform float uMie;

// Analytic chord length through a shell of radius R along a ray, used instead of
// marching: the atmosphere is thin and optically thin enough that a single
// scattering event with an exact path length is indistinguishable from a march.
float chord(vec3 ro, vec3 rd, float R, out float t0, out float t1) {
  vec3 oc = ro - uCenter;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - R * R;
  float d = b * b - c;
  if (d < 0.0) { t0 = 0.0; t1 = 0.0; return 0.0; }
  float s = sqrt(d);
  t0 = -b - s;
  t1 = -b + s;
  return t1 - t0;
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorld - cameraPosition);

  float a0, a1, p0, p1;
  float outer = chord(ro, rd, uAtmoRadius, a0, a1);
  if (outer <= 0.0) discard;
  float inner = chord(ro, rd, uPlanetRadius, p0, p1);

  float start = max(a0, 0.0);
  float end = a1;
  if (inner > 0.0 && p0 > start) end = min(end, p0);   // occluded by the surface
  float path = max(end - start, 0.0);
  if (path <= 0.0) discard;

  // Mean altitude along the segment sets the density: the air thins
  // exponentially with height, so a grazing ray samples far more of it.
  vec3 mid = ro + rd * (start + path * 0.5);
  float h = clamp((length(mid - uCenter) - uPlanetRadius) / max(uAtmoRadius - uPlanetRadius, 1e-6), 0.0, 1.0);
  float density = exp(-h * 4.0);

  float shellThickness = max(uAtmoRadius - uPlanetRadius, 1e-6);
  // Optical depth along the segment. A grazing ray can cross tens of scale
  // heights, so this is capped: past a few units the shell is opaque anyway
  // and letting it run away only feeds the bloom.
  float od = min((path / shellThickness) * density * uDensity, 4.0);

  vec3 sun = normalize(uSunDir);
  float mu = dot(rd, sun);
  // Rayleigh phase function
  float phaseR = 0.75 * (1.0 + mu * mu);
  // Henyey-Greenstein for the forward-scattering aerosol haze
  float g = 0.76;
  float phaseM = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) * 0.25;

  // How lit is this piece of atmosphere?
  vec3 toCenter = normalize(mid - uCenter);
  float lit = smoothstep(-0.35, 0.28, dot(toCenter, sun));

  vec3 scatter = uBeta * phaseR * od + vec3(1.0) * uMie * phaseM * od * 0.35;
  vec3 col = uSunColor * scatter * lit * 0.30;

  // Sunset reddening: the blue is scattered out of a long grazing path first.
  vec3 transmittance = exp(-uBeta * od * 1.6);
  col *= mix(vec3(1.0), transmittance, 0.55);

  float alpha = clamp(1.0 - exp(-length(scatter) * 0.7), 0.0, 1.0);
  fragColor = vec4(col, alpha);
}
`;

const RING_VERT = /* glsl */ `
out vec3 vObj;
out vec3 vWorld;
void main() {
  vObj = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const RING_FRAG = /* glsl */ `
precision highp float;
${NOISE_GLSL}
in vec3 vObj;
in vec3 vWorld;
out vec4 fragColor;

uniform float uInner;
uniform float uOuter;
uniform float uOpacity;
uniform float uIce;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uCenter;
uniform float uPlanetRadius;
uniform float uSeed;

void main() {
  float r = length(vObj.xz);
  if (r < uInner || r > uOuter) discard;
  float u = (r - uInner) / (uOuter - uInner);

  // Ringlets. The structure is set by resonances with the inner moons, which
  // clear gaps at rational period ratios - hence sharp, repeated divisions
  // rather than a smooth gradient.
  float fine = fbm(vec3(u * 220.0, uSeed, 0.0), 5, 2.3, 0.55) * 0.5 + 0.5;
  float med = fbm(vec3(u * 38.0, uSeed * 0.5, 3.0), 4, 2.0, 0.5) * 0.5 + 0.5;
  float dens = clamp(med * 0.75 + fine * 0.45, 0.0, 1.0);

  // Named divisions: a couple of wide, clean gaps
  dens *= smoothstep(0.012, 0.05, abs(u - 0.62));
  dens *= smoothstep(0.006, 0.03, abs(u - 0.31));
  dens *= smoothstep(0.0, 0.06, u) * smoothstep(0.0, 0.09, 1.0 - u);

  vec3 icy = vec3(0.92, 0.93, 0.95);
  vec3 rocky = vec3(0.52, 0.42, 0.32);
  vec3 albedo = mix(rocky, icy, uIce) * (0.65 + 0.5 * fine);

  // The planet's shadow falls across the rings.
  vec3 sun = normalize(uSunDir);
  vec3 rel = vWorld - uCenter;
  float b = dot(rel, sun);
  float perp2 = dot(rel, rel) - b * b;
  float shadow = (b < 0.0 && perp2 < uPlanetRadius * uPlanetRadius)
    ? smoothstep(0.0, 0.25, sqrt(max(perp2, 0.0)) / uPlanetRadius - 0.75) : 1.0;

  // Forward scattering: ice particles are far brighter seen from behind.
  vec3 view = normalize(vWorld - cameraPosition);
  float forward = pow(max(dot(view, sun), 0.0), 6.0);
  vec3 col = uSunColor * albedo * (0.55 + 0.9 * forward * uIce) * shadow;

  float alpha = clamp(dens * uOpacity, 0.0, 1.0);
  fragColor = vec4(col * alpha, alpha);
}
`;

export interface PlanetVisualOptions {
  /** World radius the planet should be drawn at, in scene units. */
  radius: number;
  segments?: number;
  /**
   * The solved climate, if there is one. With it, the ice goes where the
   * energy budget puts it and moves with the seasons; without it, the surface
   * falls back to placing a cap by latitude, which is what it used to do.
   */
  climate?: Climate;
}

export class PlanetView {
  readonly group = new THREE.Group();
  readonly surface: THREE.Mesh;
  readonly atmosphere?: THREE.Mesh;
  readonly rings?: THREE.Mesh;
  private surfMat: THREE.ShaderMaterial;
  private atmoMat?: THREE.ShaderMaterial;
  private ringMat?: THREE.ShaderMaterial;
  /** Radius the geometry was built at. */
  readonly baseRadius: number;
  /** Radius currently drawn at, after any minimum-angular-size scaling. */
  worldRadius: number;
  private atmoRatio = 1;
  private ringRatio: [number, number] = [0, 0];
  private climateTex?: ClimateTexture;
  private substellar = new THREE.Vector3(1, 0, 0);

  constructor(readonly planet: Planet, opts: PlanetVisualOptions) {
    const R = opts.radius;
    this.baseRadius = R;
    this.worldRadius = R;
    const seg = opts.segments ?? 96;

    const typeCode = planet.cls === 'gas-giant' || planet.cls === 'hot-jupiter'
      || planet.cls === 'ice-giant' || planet.cls === 'mini-neptune' || planet.cls === 'puffy' ? 1
      : planet.cls === 'lava' ? 3 : 0;

    // Ice-cap extent from how much of the surface sits below freezing.
    const iceExtent = planet.surfaceK > 340 ? 0
      : Math.max(0, Math.min(0.95, (285 - planet.surfaceK) / 90 + 0.08));

    this.surfMat = new THREE.ShaderMaterial({
      vertexShader: SURFACE_VERT,
      fragmentShader: SURFACE_FRAG,
      glslVersion: THREE.GLSL3,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uColorA: { value: new THREE.Vector3(...planet.color) },
        uColorB: { value: new THREE.Vector3(...planet.color2) },
        uSeed: { value: (planet.surfaceSeed % 10000) / 97 },
        uTime: { value: 0 },
        uOcean: { value: planet.oceanFraction },
        uIce: { value: iceExtent },
        uCloud: { value: planet.cloudCover },
        uIceThreshold: { value: -1 },
        uFrostK: { value: -1 },
        uType: { value: typeCode },
        uRoughness: { value: 0.8 },
        uAtmoDensity: { value: Math.min(1, planet.pressureBar) },
        uAtmoBar: { value: planet.pressureBar },
        uAtmoColor: { value: new THREE.Vector3(0.3, 0.5, 1) },
        uNightLights: { value: planet.biosphere > 0.62 ? (planet.biosphere - 0.62) * 2.6 : 0 },
        uLife: { value: planet.biosphere },
        uClimate: { value: null as THREE.Texture | null },
        uHasClimate: { value: 0 },
        uClimRange: { value: new THREE.Vector2(200, 320) },
        uSeason: { value: 0 },
        uLapseRate: { value: 0 },
        // Half a period per jet across sin(latitude), which runs -1 to 1.
        uJetFreq: { value: Math.max(4, planet.jets * Math.PI * 0.5) },
        uLocked: { value: planet.tidallyLocked ? 1 : 0 },
        uSubstellar: { value: new THREE.Vector3(1, 0, 0) },
        uRadius: { value: R },
        uObliquity: { value: planet.obliquity },
        uRingNormal: { value: new THREE.Vector3(0, 1, 0) },
        uRingInner: { value: 0 },
        uRingOuter: { value: 0 },
        uRingOpacity: { value: 0 },
        uOccluder: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 0)) },
        uOccluderCount: { value: 0 },
        uSunAngRad: { value: 0.00465 },
        uLavaGlow: { value: planet.cls === 'lava' ? 1.6 : 0 },
        // Airless, geologically dead worlds keep their relief; worlds with
        // thick atmospheres and running water erode theirs away.
        uReliefStrength: { value: 1.0 / (1.0 + planet.pressureBar * 0.35 + planet.oceanFraction) },
      },
    });

    // --- The climate, if one has been solved.
    if (opts.climate) {
      const cl = opts.climate;
      this.climateTex = climateTexture(cl, planet.pressureBar);
      const u = this.surfMat.uniforms;
      u.uClimate.value = this.climateTex.texture;
      u.uHasClimate.value = 1;
      u.uClimRange.value.set(this.climateTex.range[0], this.climateTex.range[1]);
      // How cold it has to be here before there is ice on the ground. Every
      // point of the seasonal field is ranked by temperature and the coldest
      // share of it equal to the planet's water inventory is what freezes; if
      // there is more water than there is cold ground, the threshold is simply
      // the freezing point and every cold place is white.
      u.uIceThreshold.value = iceThreshold(cl, planet.waterInventory);
      // Below the frost point of its own air the atmosphere snows onto the
      // ground, water or no water. That is Mars's bright winter cap.
      u.uFrostK.value = planet.pressureBar > 1e-4
        ? condensationTemperature(planet.air) : -1;
      // Elevation in the terrain field runs about +-1; call one unit six
      // kilometres, which puts a tall range at Himalayan height. The lapse
      // rate is the planet's own - moist where there is water to condense,
      // dry where there is not - so a thin-aired world's mountains are colder
      // than a thick-aired one's by the ratio of their gravities.
      const relief = 6000;
      const lapse = planet.pressureBar > 0.01
        ? moistLapseRate(planet.gravity, cl.meanK, planet.pressureBar, planet.air.cp)
        : 0;
      u.uLapseRate.value = lapse * relief;
    }

    this.surface = new THREE.Mesh(
      new THREE.SphereGeometry(R, Math.max(seg, 160), Math.max(seg, 160) / 2), this.surfMat);
    // Oblateness from rotation: a fast-spinning gas giant is visibly squashed.
    const oblate = Math.min(0.14, (2 * Math.PI * R / Math.max(Math.abs(planet.dayS), 1)) ** 2 * 0);
    this.surface.scale.set(1, 1 - flattening(planet) - oblate, 1);
    this.group.add(this.surface);

    // --- Atmosphere
    if (planet.pressureBar > 0.004) {
      // Scale height H = kT/(mu g) as a fraction of the radius. Earth's is
      // 8.5 km against a 6371 km radius - about 0.13%. Drawn at true scale the
      // atmosphere would be a hairline, so the shell is exaggerated, but it is
      // exaggerated by a factor that still tracks the real column depth.
      const scaleHeight = Math.min(0.16, 0.018 + 0.055 * Math.log10(1 + planet.pressureBar) +
        (typeCode === 1 ? 0.045 : 0));
      const atmoR = R * (1 + scaleHeight);
      const beta = atmosphereBeta(planet);
      this.atmoMat = new THREE.ShaderMaterial({
        vertexShader: ATMO_VERT,
        fragmentShader: ATMO_FRAG,
        glslVersion: THREE.GLSL3,
        transparent: true,
        blending: THREE.NormalBlending,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uCenter: { value: new THREE.Vector3() },
          uPlanetRadius: { value: R },
          uAtmoRadius: { value: atmoR },
          uSunDir: { value: new THREE.Vector3(1, 0, 0) },
          uSunColor: { value: new THREE.Color(1, 1, 1) },
          uBeta: { value: new THREE.Vector3(...beta) },
          uDensity: { value: Math.min(1.05, 0.16 + 0.34 * Math.log10(1 + planet.pressureBar)) },
          uMie: { value: planet.cloudCover * 0.28 + (typeCode === 1 ? 0.3 : 0.07) },
        },
      });
      // The atmosphere shell is drawn outside the surface, so the silhouette
      // you actually see against space is *its* polygon count, not the
      // planet's - and at sixty-four segments a world filling the frame had a
      // visibly faceted limb, twenty pixels to a facet. It is the cheapest
      // geometry in the scene; there is no reason to be careful with it.
      this.atmosphere = new THREE.Mesh(
        new THREE.SphereGeometry(atmoR, Math.max(seg, 192), Math.max(seg, 192) / 2),
        this.atmoMat,
      );
      this.atmoRatio = atmoR / R;
      this.group.add(this.atmosphere);
    }

    // --- Rings
    if (planet.rings.length > 0) {
      const ring = planet.rings[0];
      const scale = R / planet.radiusM;
      const inner = ring.innerM * scale;
      const outer = ring.outerM * scale;
      this.ringMat = new THREE.ShaderMaterial({
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        glslVersion: THREE.GLSL3,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        uniforms: {
          uInner: { value: inner },
          uOuter: { value: outer },
          uOpacity: { value: ring.opacity },
          uIce: { value: ring.iceFraction },
          uSunDir: { value: new THREE.Vector3(1, 0, 0) },
          uSunColor: { value: new THREE.Color(1, 1, 1) },
          uCenter: { value: new THREE.Vector3() },
          uPlanetRadius: { value: R },
          uSeed: { value: (planet.surfaceSeed % 977) / 13 },
        },
      });
      const g = new THREE.RingGeometry(inner, outer, 256, 1);
      // RingGeometry is built in XY; rotate it into the equatorial plane.
      g.rotateX(-Math.PI / 2);
      this.rings = new THREE.Mesh(g, this.ringMat);
      this.group.add(this.rings);
      this.surfMat.uniforms.uRingInner.value = inner;
      this.surfMat.uniforms.uRingOuter.value = outer;
      this.surfMat.uniforms.uRingOpacity.value = ring.opacity;
      this.ringRatio = [inner / R, outer / R];
    }

    // Axial tilt
    this.group.rotation.z = planet.obliquity;
  }

  /**
   * Draw the planet at a different world radius.
   *
   * At true scale a planet is invisible from anywhere useful - the Earth is one
   * part in twenty-three thousand of its own orbit - so bodies are given a
   * floor on their apparent size and drawn at true scale as soon as they exceed
   * it. Scaling the group alone would desynchronise the atmosphere and ring
   * shaders, which do their chord arithmetic in world space, so their radii are
   * scaled with it.
   */
  setWorldRadius(r: number): void {
    if (Math.abs(r - this.worldRadius) < 1e-12) return;
    this.worldRadius = r;
    this.group.scale.setScalar(r / this.baseRadius);
    this.surfMat.uniforms.uRadius.value = r;
    if (this.atmoMat) {
      this.atmoMat.uniforms.uPlanetRadius.value = r;
      this.atmoMat.uniforms.uAtmoRadius.value = r * this.atmoRatio;
    }
    if (this.ringMat) {
      this.ringMat.uniforms.uPlanetRadius.value = r;
      this.ringMat.uniforms.uInner.value = r * this.ringRatio[0];
      this.ringMat.uniforms.uOuter.value = r * this.ringRatio[1];
    }
  }

  /**
   * Register the bodies that can pass between this world and its star, in world
   * space, so their shadows fall where the geometry puts them. At most four are
   * carried; beyond that the nearest matter and the rest are rounding.
   */
  setOccluders(list: { pos: THREE.Vector3; radius: number }[]): void {
    const arr = this.surfMat.uniforms.uOccluder.value as THREE.Vector4[];
    const n = Math.min(arr.length, list.length);
    for (let i = 0; i < n; i++) {
      arr[i].set(list[i].pos.x, list[i].pos.y, list[i].pos.z, list[i].radius);
    }
    this.surfMat.uniforms.uOccluderCount.value = n;
  }

  /** Angular radius of the star as seen from this world, radians. */
  setSunAngularRadius(a: number): void {
    this.surfMat.uniforms.uSunAngRad.value = a;
  }

  /** @param sunDir unit vector from the planet toward its star, in world space. */
  update(sunDir: THREE.Vector3, sunColor: THREE.Color, timeS: number, worldPos: THREE.Vector3): void {
    this.surfMat.uniforms.uSunDir.value.copy(sunDir);
    this.surfMat.uniforms.uSunColor.value.copy(sunColor);
    this.surfMat.uniforms.uTime.value = timeS;
    // Where the planet is in its year. The ice line follows this: run time
    // forward and the caps grow through one hemisphere's winter and melt back
    // through its summer, at the latitude the energy budget puts them.
    if (this.climateTex) {
      this.surfMat.uniforms.uSeason.value =
        (timeS / Math.max(this.planet.periodS, 1)) % 1;
      if (this.planet.tidallyLocked) {
        // The star does not move in this world's sky, so the substellar point
        // is fixed in the body frame: it is the surface's own rotation that
        // has to be undone to find it.
        const spin = this.surface.rotation.y;
        this.substellar.set(
          sunDir.x * Math.cos(spin) + sunDir.z * Math.sin(spin), sunDir.y,
          -sunDir.x * Math.sin(spin) + sunDir.z * Math.cos(spin)).normalize();
        this.surfMat.uniforms.uSubstellar.value.copy(this.substellar);
      }
    }
    // Sidereal rotation
    this.surface.rotation.y = (timeS / Math.max(Math.abs(this.planet.dayS), 1)) *
      Math.PI * 2 * Math.sign(this.planet.dayS || 1);
    if (this.atmoMat) {
      this.atmoMat.uniforms.uSunDir.value.copy(sunDir);
      this.atmoMat.uniforms.uSunColor.value.copy(sunColor);
      this.atmoMat.uniforms.uCenter.value.copy(worldPos);
    }
    if (this.ringMat) {
      this.ringMat.uniforms.uSunDir.value.copy(sunDir);
      this.ringMat.uniforms.uSunColor.value.copy(sunColor);
      this.ringMat.uniforms.uCenter.value.copy(worldPos);
    }
  }

  dispose(): void {
    this.climateTex?.dispose();
    this.surface.geometry.dispose();
    this.surfMat.dispose();
    this.atmosphere?.geometry.dispose();
    this.atmoMat?.dispose();
    this.rings?.geometry.dispose();
    this.ringMat?.dispose();
  }
}

/**
 * Rotational flattening f = (a-c)/a, approximately 5 q / 4 for a fluid body,
 * where q is the ratio of centrifugal to gravitational acceleration at the
 * equator. Saturn is flattened by 10%; you can see it.
 */
export function flattening(p: Planet): number {
  const omega = (2 * Math.PI) / Math.max(Math.abs(p.dayS), 1);
  const q = (omega * omega * p.radiusM) / Math.max(p.gravity, 1e-6);
  const fluid = p.massKg > 12 * 5.97e24;
  return Math.min(0.16, (fluid ? 1.25 : 0.5) * q);
}

/**
 * Rayleigh scattering coefficients. Beta goes as lambda^-4, which is the whole
 * reason the sky is blue; the absolute scale depends on the refractive index
 * and number density of the gas, and so on what the atmosphere is made of.
 */
export function atmosphereBeta(p: Planet): [number, number, number] {
  const lam = [680, 550, 440];
  // Heavier molecules scatter more per particle; CO2 is markedly more efficient
  // than N2, which is why the Martian sky is not the colour of Earth's.
  const strength = p.atmosphere.includes('CO₂') ? 1.9
    : p.atmosphere.includes('H₂') ? 0.55 : 1.0;
  const base = 0.85;
  const out = lam.map((l) => base * strength * Math.pow(550 / l, 4)) as [number, number, number];
  // A dusty, hazy atmosphere is greyer and warmer
  if (p.oceanFraction < 0.05 && p.pressureBar > 0.01) {
    out[0] *= 2.1; out[1] *= 1.35;
  }
  return out;
}

export { R_EARTH };


/**
 * The temperature below which a world actually has ice on the ground.
 *
 * Being below freezing is necessary and nowhere near sufficient: the whole of
 * Mars is below freezing and the whole of Mars is not white, because there is
 * almost no water on it to freeze. So every point of the seasonal field is
 * ranked by temperature, and the coldest share of it equal to the planet's
 * water inventory is what ends up covered. A world with oceans has more water
 * than cold ground and the answer comes back as the freezing point; a world
 * with a trace has only its poles.
 */
export function iceThreshold(cl: Climate, waterInventory: number): number {
  const w = Math.min(1, Math.max(0, waterInventory));
  if (w <= 0.002) return -1;
  const sorted = Float32Array.from(cl.field).sort();
  const k = Math.min(sorted.length - 1, Math.floor(w * sorted.length));
  return Math.min(273.15, sorted[k]);
}
