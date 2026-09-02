/**
 * Eclipses, done as the geometry rather than as a darkened patch.
 *
 * A star is a disc, not a point, so a body passing in front of it does not
 * switch the light off - it covers a fraction of the disc, and that fraction is
 * the ratio of the area two circles share on the sky to the area of the star's
 * own circle. Umbra, penumbra and the whole soft grey edge between them fall
 * out of that one expression; so does the fact that a small moon far away can
 * never produce totality, only an annular eclipse, because its disc never
 * covers the star's however well aligned it is.
 *
 * Angles here are small enough - a fraction of a degree - that the two circles
 * can be treated as flat, which is the same approximation every eclipse
 * almanac makes.
 */
export const ECLIPSE_GLSL = /* glsl */ `
#ifndef ECLIPSE_MAX
#define ECLIPSE_MAX 4
#endif

uniform vec4 uOccluder[ECLIPSE_MAX];  // xyz world centre, w radius
uniform int uOccluderCount;
uniform float uSunAngRad;             // angular radius of the star, radians

/**
 * Fraction of a disc of angular radius rs that a disc of angular radius ro
 * covers, their centres separated by an angle d.
 */
float discOverlap(float rs, float ro, float d) {
  if (rs <= 1e-9) return 0.0;
  if (d >= rs + ro) return 0.0;                       // no contact
  if (d <= ro - rs) return 1.0;                       // star wholly hidden: totality
  if (d <= rs - ro) return (ro * ro) / (rs * rs);      // occulter wholly inside: annular
  float d2 = d * d, rs2 = rs * rs, ro2 = ro * ro;
  float a1 = clamp((d2 + rs2 - ro2) / (2.0 * d * rs), -1.0, 1.0);
  float a2 = clamp((d2 + ro2 - rs2) / (2.0 * d * ro), -1.0, 1.0);
  float tri = max((-d + rs + ro) * (d + rs - ro) * (d - rs + ro) * (d + rs + ro), 0.0);
  float area = rs2 * acos(a1) + ro2 * acos(a2) - 0.5 * sqrt(tri);
  return clamp(area / (3.14159265359 * rs2), 0.0, 1.0);
}

/**
 * How much of the star's light survives at a world-space point, given every
 * occluder currently registered. 1.0 is full sun, 0.0 is totality.
 */
float eclipseLight(vec3 worldPos, vec3 toSun) {
  float lit = 1.0;
  for (int i = 0; i < ECLIPSE_MAX; i++) {
    if (i >= uOccluderCount) break;
    vec4 o = uOccluder[i];
    if (o.w <= 0.0) continue;
    vec3 v = o.xyz - worldPos;
    float dist = length(v);
    if (dist < 1e-9) continue;
    vec3 dir = v / dist;
    // Only bodies on the sunward side can be in the way.
    float cosSep = dot(dir, toSun);
    if (cosSep <= 0.0) continue;
    float ro = asin(clamp(o.w / dist, 0.0, 1.0));
    float sep = acos(clamp(cosSep, -1.0, 1.0));
    lit *= 1.0 - discOverlap(uSunAngRad, ro, sep);
  }
  return lit;
}
`;
