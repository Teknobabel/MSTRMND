import type { AmbientTrack } from "./ambientTraffic";
import type { MapDepthRange } from "./camera";
import type { Mat4 } from "./mat4";
import type { PlotSize } from "./projection";
import type { MapSiteSignal } from "./siteSignals";

/**
 * The map, drawn on the GPU as a stack of planes a camera looks at.
 *
 * Every layer shares one unit-square quad and one camera, separated only by how far each floats
 * above the land (see `camera.ts`):
 *
 * - **land** — the authored art, drawn opaque, and hazed toward the far edge so the tilt
 *   reads as distance rather than as a quad that simply stops.
 * - **twinkle** — city lights coming on and going off, lying on the land at the same height.
 * - **glow** — what each lit site is saying, also on the land.
 * - **grid** — procedural meridians and a slow sweep, a little above it.
 * - **track** — flights arcing between the two, and satellites in the haze layer.
 * - **atmosphere** — a scrolling field of red dots, higher again.
 *
 * The parallax between them as the camera drifts is the whole illusion; no layer on its own
 * reads as anything but a picture. Two floating heights rather than one because a single
 * floating layer offers the eye one disagreement to read, and a lone constant offset is easy to
 * dismiss as a second flat picture pasted on top. The pins are DOM, projected through the same
 * `land` matrix, so they stay glued to their sites through all of it.
 *
 * Everything here degrades rather than fails. Some devices have no WebGL2, contexts are lost
 * when a phone backgrounds a tab or a GPU driver resets, and art can 404; each of those calls
 * `onFallback` and the panel goes back to the plain image layer it always had.
 */

const LAND_VERTEX_SRC = `#version 300 es
in vec2 a_uv;
uniform mat4 u_mvp;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = u_mvp * vec4(a_uv, 0.0, 1.0);
}
`;

/**
 * The art, cooled toward the horizon.
 *
 * Without this the pitched slab holds full brightness right up to its far edge and then stops
 * dead, which is the loudest single tell that the map is a rectangle rather than ground. The
 * fade is not a gradient painted down the texture: it is keyed to real distance from the
 * camera, so it swings with the drift and the lean the way a haze over ground would.
 */
const LAND_FRAGMENT_SRC = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_art;
uniform highp vec2 u_depth;
out vec4 fragColor;

/* Deliberately not black. A world lit from inside should cool toward an ember at its far edge,
 * not toward the dead panel behind it. */
const vec3 HAZE = vec3(0.055, 0.006, 0.018);
const float HAZE_STRENGTH = 0.46;

void main() {
  vec4 art = texture(u_art, v_uv);

  /* gl_FragCoord.w is 1/w_clip, and w_clip is the distance in front of the camera, so this is
   * the true per-pixel depth — perspective-correct, and with no varying needed to carry it.
   * Kept highp: the depth the map spans is about a tenth of the distance to it, and at mediump
   * the difference this whole effect lives in sits close to the noise floor.
   *
   * The span is floored rather than branched on. A flat map reports near == far, every pixel
   * lands on 0, and the haze vanishes — so a tilt of zero stays the zero case here too. */
  highp float depth = 1.0 / gl_FragCoord.w;
  highp float span = max(u_depth.y - u_depth.x, 1e-4);
  float t = clamp(float((depth - u_depth.x) / span), 0.0, 1.0);

  /* Squared, so the haze gathers at the horizon instead of greying the whole map evenly. */
  fragColor = vec4(mix(art.rgb, HAZE, HAZE_STRENGTH * t * t), art.a);
}
`;

/**
 * The one shared hash. The city phases and the cloud noise want the same thing: a stable
 * pseudo-random number from a point, cheap enough to call a dozen times a pixel.
 *
 * highp is not optional here. The twinkle grid runs to hundreds of cells and the multiplies
 * below push well past what a mediump float can hold, at which point neighbouring cells collide
 * and the effect degenerates into visible banding — on exactly the mobile GPUs where mediump
 * is really 16 bits rather than silently promoted.
 */
const HASH_GLSL = `
float hash21(vec2 p) {
  vec3 q = fract(vec3(p.x, p.y, p.x) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
`;

/**
 * City lights, coming on and going off.
 *
 * This adds no art of its own. The shipped map is already a dot matrix of lit cities, so the
 * pass samples the land texture and uses the art's own brightness as its mask: a light can only
 * ever appear where there is a city for it to belong to.
 */
const TWINKLE_FRAGMENT_SRC = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_art;
uniform float u_time;
uniform vec2 u_cells;
out vec4 fragColor;

/* Warmer than the art under it, so a peak reads as a light coming on rather than as the red
 * merely getting redder — which, on art that is red everywhere, is not a readable event. */
const vec3 SPARK = vec3(1.0, 0.66, 0.42);
${HASH_GLSL}
void main() {
  /* Sampled through the same mipmap chain the land is drawn with, so the mask always matches
   * the brightness actually on screen rather than that of the full-size art. */
  vec3 art = texture(u_art, v_uv).rgb;
  float lum = max(max(art.r, art.g), art.b);
  /* Under the knee is ocean and empty ground; over it is somewhere people live. */
  float mask = smoothstep(0.16, 0.55, lum);
  if (mask < 0.004) {
    discard;
  }

  vec2 grid = v_uv * u_cells;
  vec2 cell = floor(grid);

  /* One light per cell, placed where that cell's hash puts it rather than at its centre, and
   * fading to nothing well before it reaches the cell wall.
   *
   * Both of those are load-bearing, and the reason is worth keeping. Lighting the cell evenly
   * works only where the art is sparse dots: over somewhere like the Ganges plain or the Pearl
   * River delta the mask is a continuous bright field, so neighbouring cells sit at different
   * brightnesses with nothing between them, and the grid that exists only to carry phases
   * surfaces on screen as a lattice of hard squares. A light that has already fallen to zero at
   * the boundary cannot draw one, whatever its neighbour is doing — and offsetting the centres
   * stops the surviving points from lining up into a lattice of their own. */
  vec2 centre = vec2(0.24 + 0.52 * hash21(cell + 5.73), 0.24 + 0.52 * hash21(cell + 91.17));
  float falloff = 1.0 - smoothstep(0.0, 0.33, length(fract(grid) - centre));
  if (falloff <= 0.0) {
    discard;
  }

  float phase = hash21(cell);
  /* A spread of rates as well as of phases. Scattered phases on one shared rate still beat into
   * a single pulse crossing the map, which reads as an effect rather than as cities. */
  float rate = 0.05 + 0.15 * hash21(cell + 37.19);
  float wave = 0.5 + 0.5 * sin((u_time * rate + phase) * 6.2831853);
  /* The high power is what makes this a blink rather than a breath: a light sits dark for most
   * of its cycle and flares briefly. Lower it and the whole map pulses as one soft mass. */
  float spark = pow(wave, 4.0);

  /* One very slow, very large swell drifting across everything, so the shimmer has weather
   * instead of being uniformly busy edge to edge. */
  float region = 0.62 + 0.38 * sin((v_uv.x * 2.4 + v_uv.y * 1.1) - u_time * 0.06);

  /* Squared falloff, for the same reason the site glows use one: it reads as a light rather
   * than as a disc with a soft edge. */
  float alpha = mask * falloff * falloff * spark * region * 0.8;
  fragColor = vec4(SPARK * alpha, alpha);
}
`;

/**
 * A thin sheet of weather, well above the lattice, printed as a dot matrix.
 *
 * Its job is parallax first and picture second: it is faint enough to be hard to point at in a
 * still frame, and it is the layer that stops the stack reading as two planes. Being nearer the
 * camera than the land it is drawn larger, so its own boundary falls outside the panel and only
 * its middle is ever on screen.
 *
 * The cloud field itself is still fbm, but nothing samples it per pixel any more: it is read
 * once per cell of a regular grid and drawn as a dot whose size follows the density under it.
 * The grid is deliberately unjittered — the twinkle scatters its cells to hide them, and this
 * one wants its raster seen, because a regular matrix reads as something being *displayed* on
 * the console rather than as real cloud drifting over real ground.
 */
const ATMOSPHERE_FRAGMENT_SRC = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform float u_time;
uniform vec2 u_dots;
out vec4 fragColor;

/* The console's own red. An earlier version of this layer was near-neutral, on the reasoning
 * that a coloured wash reads as a filter laid over the map where a colourless one reads as air
 * — which held while it was a wash. Broken into discrete dots it is plainly a separate thing
 * sitting above the ground rather than a tint applied to it, so the palette can be honest. */
const vec3 MOTE = vec3(1.0, 0.15, 0.22);
${HASH_GLSL}
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  /* Smoothstep the interpolant, not the samples: interpolating linearly between lattice points
   * leaves a visible crease along every cell boundary. */
  vec2 w = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

/* Three octaves. Two leave the cloud shapes obviously elliptical; a fourth costs another four
 * hashes a pixel across the full quad to add detail finer than this layer's alpha can show. */
float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i += 1) {
    sum += amp * valueNoise(p);
    /* Not exactly 2.0: an integer lacunarity lines every octave's lattice up with the last and
     * the sum starts showing the grid they were all built on. */
    p *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

void main() {
  vec2 grid = v_uv * u_dots;
  vec2 cell = floor(grid);

  /* The density under this cell, read once at its centre rather than per pixel. Sampling the
   * field per pixel would vary the radius across the dot's own face and smear the edge the
   * antialiasing below is trying to draw cleanly. */
  vec2 centre = (cell + 0.5) / u_dots;

  /* Elongated along x, but only about two to one once the map's own 2.5:1 shape is accounted
   * for. Weather on a planet runs in bands and drifts sideways, so some stretch is right — but
   * the frequencies have to be read in screen terms, not in the unit square. Pushed further
   * (the first pass used 3.2 by 8.5, nearly seven to one on screen) the systems stop reading as
   * cloud at all and become a soft horizontal smear across the panel, more lens than sky. */
  vec2 p = centre * vec2(7.0, 5.6);
  p.x -= u_time * 0.03;
  /* A little vertical drift as well. A purely sideways slide reads as a texture being scrolled;
   * two rates that do not divide into each other read as weather. */
  p.y += u_time * 0.004;
  float veil = smoothstep(0.42, 0.86, fbm(p));

  /* How many pixels a cell covers here. The map is pitched away, so cells near the far edge
   * compress toward nothing, and a regular grid finer than a pixel or two is where a dot matrix
   * turns into moire. Fading the layer out as the raster stops resolving is the cheap fix, and
   * it costs nothing where it matters: the far edge is already the most hazed part of the map. */
  vec2 cellPixels = 1.0 / max(fwidth(grid), vec2(1e-5));
  float resolved = smoothstep(1.8, 4.0, min(cellPixels.x, cellPixels.y));
  if (veil * resolved < 0.002) {
    discard;
  }

  /* Dots grow with the cloud under them: a thick patch prints nearly solid, a thin one as
   * scattered specks. The edge is antialiased against its own screen-space derivative, which is
   * what keeps the far half of the field from crawling as the camera drifts. */
  float d = length(fract(grid) - 0.5);
  float radius = 0.66 * veil;
  float edge = max(fwidth(d), 1e-4);
  float mote = 1.0 - smoothstep(radius - edge, radius + edge, d);

  /* The same edge fade the lattice uses, and needed for the same reason: above the map's
   * receding far edge this layer overhangs bare panel, and a field that stopped in a straight
   * line there would draw the eye to exactly the seam the tilt is trying to sell. */
  vec2 fade = smoothstep(vec2(0.0), vec2(0.09), v_uv)
            * smoothstep(vec2(0.0), vec2(0.09), 1.0 - v_uv);

  /* Higher than the wash this replaced, and it has to be: dots cover roughly two thirds of a
   * cell at full density and nothing at all between them, so the same number here would put
   * less total light on the panel than the smooth version did. */
  float alpha = fade.x * fade.y * mote * resolved * (0.4 + 0.6 * veil) * 0.2;
  fragColor = vec4(MOTE * alpha, alpha);
}
`;

/**
 * Meridians and parallels rather than an abstract grid: the art underneath is a world map, and
 * a lat/long lattice reinforces that reading instead of fighting it. Output is premultiplied so
 * the layer can be blended with a plain additive `ONE, ONE` onto the premultiplied canvas.
 *
 * The lattice, the ticks at its crossings and the two named axes are all one pass: they share a
 * cell space and a brightness budget, and separating them would mean three draws of the same
 * quad to compose values that add up anyway.
 */
const GRID_FRAGMENT_SRC = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform float u_time;
uniform vec2 u_cells;
out vec4 fragColor;

const vec3 ACCENT = vec3(0.91, 0.07, 0.18);

/* Screen-space derivative keeps a line one pixel wide however far the plane is tilted away —
 * without it the far edge of the map turns into a moire of aliased lines. */
float lattice(vec2 uv, vec2 cells) {
  vec2 scaled = uv * cells;
  vec2 distance = abs(fract(scaled - 0.5) - 0.5) / max(fwidth(scaled), vec2(1e-5));
  return 1.0 - min(min(distance.x, distance.y), 1.0);
}

/* A cross at every crossing, the way a chart marks its graticule. Drawn in the same
 * derivative-scaled space as the lattice so the arms stay a pixel wide under the tilt, and cut
 * off past the arm length so this is a tick and not simply a brighter intersection. */
float ticks(vec2 uv, vec2 cells) {
  vec2 scaled = uv * cells;
  vec2 fromLine = abs(fract(scaled - 0.5) - 0.5);
  vec2 px = fromLine / max(fwidth(scaled), vec2(1e-5));
  /* Along each axis: near the line, and near enough to the crossing to be on the arm. */
  float arm = 2.6;
  float horizontal = (1.0 - min(px.y, 1.0)) * (1.0 - smoothstep(0.0, arm, px.x));
  float vertical = (1.0 - min(px.x, 1.0)) * (1.0 - smoothstep(0.0, arm, px.y));
  return max(horizontal, vertical);
}

void main() {
  float lines = lattice(v_uv, u_cells);

  /* The equator and the prime meridian, picked out of the lattice they are already part of.
   * A graticule where every line carries equal weight has no landmarks in it; two that read
   * heavier give the eye something to place the rest against. Both fall exactly on lattice
   * lines at the authored cell counts, so this brightens rather than adds. */
  vec2 axisPx = abs(v_uv - 0.5) / max(fwidth(v_uv), vec2(1e-5));
  float axes = max(1.0 - min(axisPx.x, 1.0), 1.0 - min(axisPx.y, 1.0));

  /* Two sweeps, crossing. One alone loops visibly — the eye learns its period within a couple
   * of passes and the layer goes back to reading as a decal. Periods deliberately not in ratio,
   * so where they meet keeps moving. */
  float head = fract(u_time * 0.055) * 1.25 - 0.125;
  float sweep = exp(-pow((v_uv.x - head) / 0.11, 2.0));
  float descent = fract(u_time * 0.037 + 0.4) * 1.3 - 0.15;
  float fall = exp(-pow((v_uv.y - descent) / 0.13, 2.0));
  float passing = max(sweep, fall);

  /* Fade out at the slab's edges; a lattice that stops dead gives away that it is a quad. */
  vec2 fade = smoothstep(vec2(0.0), vec2(0.07), v_uv)
            * smoothstep(vec2(0.0), vec2(0.07), 1.0 - v_uv);
  float edge = fade.x * fade.y;

  /* Kept deliberately faint. The lattice is here to give the camera something to have a
   * parallax against, not to be looked at; at the brightness it takes to read as a feature in
   * its own right it simply erases the map underneath as a sweep goes past. Everything added
   * above is held to that same budget: the ticks and the axes are detail for the eye that goes
   * looking, not another layer of brightness over the art. */
  float detail = lines * (0.05 + 0.16 * passing)
               + ticks(v_uv, u_cells) * (0.03 + 0.10 * passing)
               + axes * (0.035 + 0.09 * passing);
  float alpha = edge * (detail + passing * 0.014);
  fragColor = vec4(ACCENT * alpha, alpha);
}
`;

/**
 * Rings going out from the player's lair.
 *
 * The one mark on the map that is the player's rather than a target of theirs, so it gets the
 * one piece of animation nothing else has. Sharing the glow's vertex shader means it is a quad
 * centred on the lair with the slab's stretch already undone, and being drawn with the land
 * matrix means the rings lie *on* the ground: a ring near the top of the map foreshortens into
 * an ellipse exactly as a circle painted on the world would. That is the whole reason this is
 * here and not a CSS circle on the marker, which would stay stubbornly round.
 *
 * Says nothing. Security, operations and targets all have their own colours in the glow shader
 * and the lair is none of them — this is a heartbeat, and carries no information to misread.
 */
const RING_FRAGMENT_SRC = `#version 300 es
precision mediump float;
in vec2 v_local;
uniform float u_time;
out vec4 fragColor;

/* Saturated rather than pale. Additive light over a map that is red everywhere drifts toward
 * grey as soon as the other two channels carry much, and a grey shockwave is the one colour on
 * this panel that belongs to nothing. */
const vec3 RING = vec3(1.0, 0.17, 0.23);
/* Seconds for one ring to travel from the centre to the edge of the quad. */
const float PERIOD = 4.4;
/* How many are in flight at once, evenly spread through that period. */
const int COUNT = 3;

void main() {
  float d = length(v_local);
  if (d > 1.0) {
    discard;
  }

  float alpha = 0.0;
  for (int i = 0; i < COUNT; i += 1) {
    float phase = fract(u_time / PERIOD + float(i) / float(COUNT));
    /* Thinner as it goes, like a wavefront spreading over a growing circumference.
     *
     * Narrow, and that is the whole difference between rings and a smudge. The first version
     * was twice this wide, which at three in flight at once meant each ring's falloff reached
     * its neighbours and the three summed into one soft disc sitting over the lair — brighter
     * than the site glows around it and saying nothing. */
    float width = 0.05 - 0.025 * phase;
    float ring = exp(-pow((d - phase) / width, 2.0));
    /* Fading as it expands, and gone before it reaches the quad's edge — a ring clipped by the
     * boundary of its own quad is the one way this construction shows itself. */
    alpha += ring * (1.0 - phase) * (1.0 - phase);
  }

  fragColor = vec4(RING * alpha * 0.34, alpha * 0.34);
}
`;

/**
 * A moving track — a flight between two cities, or a satellite crossing overhead.
 *
 * Drawn as a ribbon rather than a `LINE_STRIP`, because a GL line is one device pixel wide and
 * no more: on a 2x backing store that is half a CSS pixel of an already faint additive trail,
 * which is close enough to invisible to not be worth drawing. The ribbon is built in the vertex
 * shader from a fixed strip of samples, so a track costs one small draw and no per-frame
 * geometry upload.
 *
 * The offset that gives the ribbon its width is taken in screen space, after the divide. Doing
 * it in map space instead would make a track thin out as it bows away from the camera — correct
 * for a road painted on the ground, wrong for something the eye reads as a lit trail.
 */
const TRACK_VERTEX_SRC = `#version 300 es
/* x: how far along the route this sample is, 0..1. y: which side of the ribbon, -1 or +1. */
in vec2 a_ribbon;
uniform mat4 u_mvp;
/* Route ends in map space, packed as (fromU, fromV, toU, toV). */
uniform vec4 u_ends;
uniform float u_bow;
/* Backing store size and the ribbon half-width, both in device pixels. */
uniform vec2 u_viewport;
uniform float u_halfWidth;
out float v_t;
out float v_side;

vec4 routePoint(float t) {
  vec2 uv = mix(u_ends.xy, u_ends.zw, t);
  /* A half sine: on the ground at both ends, highest in the middle. */
  float z = u_bow * sin(t * 3.14159265);
  return u_mvp * vec4(uv, z, 1.0);
}

void main() {
  float t = a_ribbon.x;
  v_t = t;
  v_side = a_ribbon.y;

  vec4 here = routePoint(t);
  /* Neighbours either side for the tangent, clamped so the end samples look inward rather than
   * off the end of the route. */
  vec4 ahead = routePoint(min(t + 0.004, 1.0));
  vec4 behind = routePoint(max(t - 0.004, 0.0));

  /* Perspective divide done by hand: the offset below has to be applied after it, and the
   * varyings on a ribbon this thin have nothing worth interpolating perspective-correctly.
   * Depth testing is off for the whole map, so flattening w to 1 costs nothing. */
  vec2 atPx = (here.xy / here.w) * u_viewport;
  vec2 aheadPx = (ahead.xy / ahead.w) * u_viewport;
  vec2 behindPx = (behind.xy / behind.w) * u_viewport;

  vec2 along = aheadPx - behindPx;
  /* A zero-length route would send normalize to NaN and take the whole strip with it. */
  vec2 dir = length(along) > 1e-5 ? normalize(along) : vec2(1.0, 0.0);
  vec2 offsetPx = vec2(-dir.y, dir.x) * u_halfWidth * a_ribbon.y;

  gl_Position = vec4((atPx + offsetPx) / u_viewport, 0.0, 1.0);
}
`;

/**
 * The lit part of a track: a bright head with a trail decaying behind it.
 *
 * Nothing ahead of the head is drawn at all, so the route is never visible as a line waiting to
 * be travelled — which is the difference between traffic and a diagram.
 */
const TRACK_FRAGMENT_SRC = `#version 300 es
precision mediump float;
in float v_t;
in float v_side;
uniform float u_head;
uniform float u_tail;
uniform float u_fade;
uniform vec3 u_tint;
out vec4 fragColor;

void main() {
  float behind = u_head - v_t;
  if (behind < 0.0 || behind > u_tail) {
    discard;
  }

  /* Across the ribbon the side varying runs -1 to 1, so this is a triangular profile; squaring
   * it turns the wedge into something that reads as a core with light falling off it. */
  float across = 1.0 - abs(v_side);
  float body = across * across;

  /* Along it, brightest at the head and decaying back. */
  float trail = 1.0 - behind / u_tail;
  float head = exp(-pow(behind / (u_tail * 0.18), 2.0));

  /* And out at the route's own ends, so a flight rises from its city and settles into the far
   * one instead of switching on and off in mid-air. */
  float ends = smoothstep(0.0, 0.05, v_t) * smoothstep(0.0, 0.05, 1.0 - v_t);

  /* These two weights have to sum to well under 1. The first version used 0.45 and 0.95, and
   * everything from the head back to about a fifth of the tail came out over 1 and clipped —
   * so the gradient this shader exists to draw was flattened into a uniform white bar with hard
   * ends, which reads as a scratch on the panel rather than as something moving along a route.
   * Additive blending has no headroom to spare: what clips is simply lost. */
  float alpha = u_fade * ends * body * (pow(trail, 1.5) * 0.3 + head * 0.4);
  fragColor = vec4(u_tint * alpha, alpha);
}
`;

/**
 * A glow sitting on the land at one site.
 *
 * The quad is built around the site in the vertex shader rather than covering the whole map,
 * so the cost is a handful of small draws over the lit sites instead of a loop over every site
 * for every pixel of the panel. `u_aspect` undoes the slab's stretch, so a circle in slab space
 * stays a circle rather than becoming an ellipse the width of the map.
 */
const GLOW_VERTEX_SRC = `#version 300 es
in vec2 a_uv;
uniform mat4 u_mvp;
uniform vec2 u_center;
uniform float u_radius;
uniform float u_aspect;
out vec2 v_local;
void main() {
  v_local = a_uv * 2.0 - 1.0;
  vec2 mapPos = u_center + v_local * vec2(u_radius / u_aspect, u_radius);
  gl_Position = u_mvp * vec4(mapPos, 0.0, 1.0);
}
`;

/**
 * Three things a site can be saying, in three colours the player can tell apart at a glance:
 * hardened (amber, steady), an operation running (accent, pulsing), staged as the target
 * (near-white, brightest). Premultiplied additive, like the lattice.
 */
const GLOW_FRAGMENT_SRC = `#version 300 es
precision mediump float;
in vec2 v_local;
uniform vec3 u_levels;
uniform float u_time;
out vec4 fragColor;

/* Warm and steady for a fact about the site; cool and breathing for something the player has in
 * motion. On art that is red from edge to edge, hue is the only thing that separates an
 * operation from the map underneath it — a red glow on a red map stays invisible however bright
 * it gets, which is exactly how the first version of this shader failed. */
const vec3 SECURITY = vec3(1.0, 0.5, 0.12);
const vec3 OPERATION = vec3(0.25, 0.85, 1.0);
const vec3 TARGETED = vec3(0.9, 0.94, 1.0);

void main() {
  float d = length(v_local);
  if (d > 1.0) {
    discard;
  }
  /* Squared falloff reads as light rather than as a disc with a soft edge. */
  float falloff = pow(1.0 - d, 2.0);

  /* Security is a fact about the site and holds still. An operation is in progress, so it
   * breathes. The staged target gets a faster pulse so the eye goes to it first. */
  float operationPulse = 0.62 + 0.38 * sin(u_time * 2.1);
  float targetPulse = 0.70 + 0.30 * sin(u_time * 3.4);

  /* Security arrives as a fraction of a ceiling only one, two or three steps tall, so its
   * lowest useful step can be a third. Left linear, that first step of hardening is invisible;
   * the curve lifts it into view without lifting zero off the floor. */
  float security = pow(u_levels.x, 0.6) * 0.34;
  /* Both of these are things the player did this turn and needs to find quickly, so they carry
   * more weight than the ambient hardening underneath them. */
  float operation = u_levels.y * 0.52 * operationPulse;
  float targeted = u_levels.z * 0.34 * targetPulse;

  vec3 colour = SECURITY * security + OPERATION * operation + TARGETED * targeted;
  float alpha = min(security + operation + targeted, 1.0);
  fragColor = vec4(colour * falloff, alpha * falloff);
}
`;

/**
 * Backing-store cap. The stage is already one large composited layer (see `ui/stageScale`), and
 * a phone does not need a 3x map to read fifteen dots.
 */
const MAX_PIXEL_RATIO = 2;

/**
 * How finely the weather layer is rastered — one dot per cell.
 *
 * Coarser than the twinkle grid (170 x 69) on purpose. This layer sits above the land and has to
 * read as its own raster rather than as more of the art's city dots underneath it, and the two
 * grids being obviously different pitches is what separates them. The aspect matches the shipped
 * art's so the dots stay square on the dashboard tile.
 */
const ATMOSPHERE_DOTS: readonly [number, number] = [240, 95];

/** Meridians and parallels. Roughly 15 degrees of longitude per column on the shipped art. */
const GRID_CELLS: readonly [number, number] = [24, 12];

/** Glow radius in slab half-heights. Wide enough to read as a bloom, tight enough that two
 *  neighbouring sites do not merge into one smear. */
const GLOW_RADIUS = 0.19;

/**
 * How finely the twinkle grid divides the map — one light per cell.
 *
 * This is a size, not a density dial: the cell has to be several screen pixels across, because
 * the light inside it is drawn with a radial falloff and a point smaller than a pixel or two
 * cannot be seen to fade. Too coarse and the lights read as a sparse scatter of lamps rather
 * than as cities. The aspect matches the shipped art's (2523x1019) so cells stay square on the
 * dashboard tile and the shimmer has no grain direction.
 */
const TWINKLE_CELLS: readonly [number, number] = [170, 69];

/**
 * How far the lair's rings travel, in slab half-heights. Wider than a site glow — this is the
 * one thing on the map allowed to take up room — but well short of the distance at which it
 * would wash over the sites around it.
 */
const RING_RADIUS = 0.26;

/**
 * Samples along a track's route. The ribbon is rebuilt from these in the vertex shader every
 * frame, so this is the only thing deciding how smoothly an arc bends — 48 is comfortably past
 * the point where the longest route stops showing its segments.
 */
const TRACK_SAMPLES = 48;

/** Ribbon half-width in CSS pixels, scaled to the backing store at draw time. */
const TRACK_HALF_WIDTH = 1.15;

/** Warm for aircraft; cold and paler for something in orbit. */
const ARC_TINT: readonly [number, number, number] = [1.0, 0.58, 0.3];
const ORBIT_TINT: readonly [number, number, number] = [0.62, 0.86, 1.0];

export interface MapFrame {
  /** Camera for the land plane — the same matrix the markers are projected through. */
  readonly land: Mat4;
  /** Camera for the grid plane floating above it. */
  readonly grid: Mat4;
  /** Camera for the haze plane floating above that. */
  readonly atmosphere: Mat4;
  /** How far the land's nearest and furthest corners are, for the depth haze. */
  readonly depth: MapDepthRange;
  /** Seconds since the map opened, for the sweep, the pulses and the twinkle. */
  readonly timeSeconds: number;
  /** Panel aspect, so a glow stays round on the stretched slab. */
  readonly aspect: number;
  /** What each lit site is saying. Empty on a run where nothing has happened yet. */
  readonly signals: readonly MapSiteSignal[];
  /** Flights and satellite passes in the air right now. Routinely empty; see `ambientTraffic`. */
  readonly tracks: readonly AmbientTrack[];
  /** The player's lair in map space, when this run has one plotted. */
  readonly lair: { readonly u: number; readonly v: number } | null;
}

export interface MapPlaneRenderer {
  /** The layer to put in the plot, in place of `.map-plot__art`. */
  readonly canvas: HTMLCanvasElement;
  /** True once the art has decoded, so a draw will show something. */
  ready(): boolean;
  /** Size the backing store; a no-op when nothing changed. */
  resize(plot: PlotSize, pixelRatio: number): void;
  draw(frame: MapFrame): void;
  dispose(): void;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) {
    return null;
  }
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    console.warn("[map] shader failed to compile:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function link(
  gl: WebGL2RenderingContext,
  vertexSrc: string,
  fragmentSrc: string,
): WebGLProgram | null {
  const vert = compile(gl, gl.VERTEX_SHADER, vertexSrc);
  const frag = compile(gl, gl.FRAGMENT_SHADER, fragmentSrc);
  if (vert === null || frag === null) {
    return null;
  }
  const program = gl.createProgram();
  if (program === null) {
    return null;
  }
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  /* Flagged for deletion now; the driver frees them when the program itself goes. */
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    console.warn("[map] program failed to link:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

/**
 * @param artUrl Site-root path of the map art, as authored on `MapTemplate.mapArt`.
 * @param onChange Called when a redraw is worth doing — the art decoded.
 * @param onFallback Called when this renderer can no longer carry the map and the caller should
 *   go back to the image layer. Never called synchronously: a renderer that cannot start at all
 *   returns `null` instead, so the caller never has to handle a half-built one.
 * @returns `null` when WebGL2 is unavailable or the pipeline will not build.
 */
export function createMapPlaneRenderer(
  artUrl: string,
  onChange: () => void,
  onFallback: () => void,
): MapPlaneRenderer | null {
  const canvas = document.createElement("canvas");
  canvas.className = "map-plot__gl";

  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: true,
    depth: false,
    stencil: false,
    /* The map is a backdrop, not the reason anyone bought a discrete GPU. */
    powerPreference: "low-power",
    preserveDrawingBuffer: false,
  });
  if (gl === null) {
    return null;
  }

  /* Four of the five programs are the same vertex shader over the same quad, differing only in
   * what they paint on it and which matrix they are handed. */
  const landProgram = link(gl, LAND_VERTEX_SRC, LAND_FRAGMENT_SRC);
  const twinkleProgram = link(gl, LAND_VERTEX_SRC, TWINKLE_FRAGMENT_SRC);
  const gridProgram = link(gl, LAND_VERTEX_SRC, GRID_FRAGMENT_SRC);
  const atmosphereProgram = link(gl, LAND_VERTEX_SRC, ATMOSPHERE_FRAGMENT_SRC);
  const glowProgram = link(gl, GLOW_VERTEX_SRC, GLOW_FRAGMENT_SRC);
  const ringProgram = link(gl, GLOW_VERTEX_SRC, RING_FRAGMENT_SRC);
  /* The one program with geometry of its own rather than the shared quad. */
  const trackProgram = link(gl, TRACK_VERTEX_SRC, TRACK_FRAGMENT_SRC);
  if (
    landProgram === null ||
    twinkleProgram === null ||
    gridProgram === null ||
    atmosphereProgram === null ||
    glowProgram === null ||
    ringProgram === null ||
    trackProgram === null
  ) {
    return null;
  }

  const landMvp = gl.getUniformLocation(landProgram, "u_mvp");
  const landArt = gl.getUniformLocation(landProgram, "u_art");
  const landDepth = gl.getUniformLocation(landProgram, "u_depth");
  const twinkleMvp = gl.getUniformLocation(twinkleProgram, "u_mvp");
  const twinkleArt = gl.getUniformLocation(twinkleProgram, "u_art");
  const twinkleTime = gl.getUniformLocation(twinkleProgram, "u_time");
  const twinkleCells = gl.getUniformLocation(twinkleProgram, "u_cells");
  const atmosphereMvp = gl.getUniformLocation(atmosphereProgram, "u_mvp");
  const atmosphereTime = gl.getUniformLocation(atmosphereProgram, "u_time");
  const atmosphereDots = gl.getUniformLocation(atmosphereProgram, "u_dots");
  const gridMvp = gl.getUniformLocation(gridProgram, "u_mvp");
  const gridTime = gl.getUniformLocation(gridProgram, "u_time");
  const gridCells = gl.getUniformLocation(gridProgram, "u_cells");
  const glowMvp = gl.getUniformLocation(glowProgram, "u_mvp");
  const glowCenter = gl.getUniformLocation(glowProgram, "u_center");
  const glowRadius = gl.getUniformLocation(glowProgram, "u_radius");
  const glowAspect = gl.getUniformLocation(glowProgram, "u_aspect");
  const glowLevels = gl.getUniformLocation(glowProgram, "u_levels");
  const glowTime = gl.getUniformLocation(glowProgram, "u_time");
  const ringMvp = gl.getUniformLocation(ringProgram, "u_mvp");
  const ringCenter = gl.getUniformLocation(ringProgram, "u_center");
  const ringRadius = gl.getUniformLocation(ringProgram, "u_radius");
  const ringAspect = gl.getUniformLocation(ringProgram, "u_aspect");
  const ringTime = gl.getUniformLocation(ringProgram, "u_time");
  const trackMvp = gl.getUniformLocation(trackProgram, "u_mvp");
  const trackEnds = gl.getUniformLocation(trackProgram, "u_ends");
  const trackBow = gl.getUniformLocation(trackProgram, "u_bow");
  const trackViewport = gl.getUniformLocation(trackProgram, "u_viewport");
  const trackHalfWidth = gl.getUniformLocation(trackProgram, "u_halfWidth");
  const trackHead = gl.getUniformLocation(trackProgram, "u_head");
  const trackTail = gl.getUniformLocation(trackProgram, "u_tail");
  const trackFade = gl.getUniformLocation(trackProgram, "u_fade");
  const trackTint = gl.getUniformLocation(trackProgram, "u_tint");

  /* One unit-square strip, shared by both layers. The vertex shader uses each UV as the
   * position too, because map space and texture space are the same square. */
  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  /* Every program declares `a_uv` first and only, so one attribute layout serves all of them. */
  gl.enableVertexAttribArray(gl.getAttribLocation(landProgram, "a_uv"));
  gl.vertexAttribPointer(gl.getAttribLocation(landProgram, "a_uv"), 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  /* The ribbon: one strip of samples, both sides of each. Static — the route it is bent along
   * arrives as uniforms, so this is uploaded once and reused by every track. */
  const ribbon = new Float32Array((TRACK_SAMPLES + 1) * 4);
  for (let i = 0; i <= TRACK_SAMPLES; i += 1) {
    const t = i / TRACK_SAMPLES;
    ribbon[i * 4] = t;
    ribbon[i * 4 + 1] = -1;
    ribbon[i * 4 + 2] = t;
    ribbon[i * 4 + 3] = 1;
  }
  const trackVao = gl.createVertexArray();
  const trackBuffer = gl.createBuffer();
  gl.bindVertexArray(trackVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, trackBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, ribbon, gl.STATIC_DRAW);
  const ribbonAttrib = gl.getAttribLocation(trackProgram, "a_ribbon");
  gl.enableVertexAttribArray(ribbonAttrib);
  gl.vertexAttribPointer(ribbonAttrib, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  /* A single transparent texel, so a draw before the art decodes shows the panel's own black
   * rather than undefined memory. */
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 0]),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  let artReady = false;
  let disposed = false;
  let contextLost = false;
  let bufferWidth = 0;
  let bufferHeight = 0;
  /* What the backing store was last sized at, so a ribbon measured in CSS pixels comes out the
   * same width on a phone as on a desktop. */
  let bufferRatio = 1;

  const image = new Image();
  image.decoding = "async";

  image.addEventListener("load", () => {
    if (disposed || contextLost || image.naturalWidth === 0) {
      return;
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    /* No UNPACK_FLIP_Y_WEBGL here, deliberately. That flip exists for the usual GL convention
     * where a quad's t runs bottom-up; map space instead has v running top-down, the same
     * direction as the image's own rows, so t = 0 already lands on the art's top row. Turning
     * the flip on renders the world upside down under correctly-placed pins. */
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    /* The art is far wider than the panel (2523px into roughly 1070) and is now tilted away
     * from the camera as well, so without mipmaps the minified far edge shimmers. */
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    artReady = true;
    onChange();
  });

  image.addEventListener("error", () => {
    console.warn(`[map] could not load art ${artUrl}; falling back to the image layer`);
    onFallback();
  });

  image.src = artUrl;

  canvas.addEventListener("webglcontextlost", (event) => {
    /* Preventing the default is what would make a restore possible, but the texture and program
     * are gone regardless, so hand the panel back to the image layer rather than sit black. */
    event.preventDefault();
    contextLost = true;
    artReady = false;
    onFallback();
  });

  return {
    canvas,

    ready(): boolean {
      return artReady && !contextLost && !disposed;
    },

    resize(plot: PlotSize, pixelRatio: number): void {
      const ratio = Math.min(Math.max(pixelRatio, 1), MAX_PIXEL_RATIO);
      const width = Math.max(1, Math.round(plot.width * ratio));
      const height = Math.max(1, Math.round(plot.height * ratio));
      /* Recorded before the early-out: the backing store can land on the same size from a
       * different ratio, and the ribbon width is measured against this rather than the size. */
      bufferRatio = ratio;
      if (width === bufferWidth && height === bufferHeight) {
        return;
      }
      canvas.width = width;
      canvas.height = height;
      bufferWidth = width;
      bufferHeight = height;
    },

    draw(frame: MapFrame): void {
      if (disposed || contextLost || bufferWidth === 0) {
        return;
      }
      gl.viewport(0, 0, bufferWidth, bufferHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!artReady) {
        return;
      }
      gl.bindVertexArray(vao);

      /* Land: opaque, so no blend. Where the tilt leaves the quad short of the canvas edge the
       * cleared pixels stay transparent and the panel's own black shows through. */
      gl.disable(gl.BLEND);
      gl.useProgram(landProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(landArt, 0);
      gl.uniform2f(landDepth, frame.depth.near, frame.depth.far);
      gl.uniformMatrix4fv(landMvp, false, frame.land);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      /* Everything above the land is premultiplied additive, so it only ever brightens what is
       * under it and never has to be sorted back to front. The order below is therefore about
       * what each layer *is* rather than about compositing: it cannot change the result. */
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);

      /* City lights, on the land plane and reading the land's own texture — still bound to unit
       * 0 from the pass above, so this costs no rebind. */
      gl.useProgram(twinkleProgram);
      gl.uniform1i(twinkleArt, 0);
      gl.uniformMatrix4fv(twinkleMvp, false, frame.land);
      gl.uniform1f(twinkleTime, frame.timeSeconds);
      gl.uniform2f(twinkleCells, TWINKLE_CELLS[0], TWINKLE_CELLS[1]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      /* Site glows sit on the land, under the lattice: what the map is *saying* belongs to the
       * ground, and the lattice reads as the instrument looking at it. */
      if (frame.signals.length > 0) {
        gl.useProgram(glowProgram);
        gl.uniformMatrix4fv(glowMvp, false, frame.land);
        gl.uniform1f(glowRadius, GLOW_RADIUS);
        gl.uniform1f(glowAspect, frame.aspect);
        gl.uniform1f(glowTime, frame.timeSeconds);
        for (const signal of frame.signals) {
          gl.uniform2f(glowCenter, signal.u, signal.v);
          gl.uniform3f(glowLevels, signal.security, signal.operation, signal.targeted);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
      }

      /* The lair's heartbeat, on the land with the site glows and for the same reason: what is
       * happening on the map belongs to the ground. */
      if (frame.lair !== null) {
        gl.useProgram(ringProgram);
        gl.uniformMatrix4fv(ringMvp, false, frame.land);
        gl.uniform2f(ringCenter, frame.lair.u, frame.lair.v);
        gl.uniform1f(ringRadius, RING_RADIUS);
        gl.uniform1f(ringAspect, frame.aspect);
        gl.uniform1f(ringTime, frame.timeSeconds);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }

      gl.useProgram(gridProgram);
      gl.uniformMatrix4fv(gridMvp, false, frame.grid);
      gl.uniform1f(gridTime, frame.timeSeconds);
      gl.uniform2f(gridCells, GRID_CELLS[0], GRID_CELLS[1]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      /* Traffic. Arcs bow up from the land and orbits lie in the weather layer, so each kind is
       * drawn with the matrix for the plane it belongs to and the bow does the rest. The strip
       * carries its own geometry, so this is the one place the shared quad is put down. */
      if (frame.tracks.length > 0) {
        gl.bindVertexArray(trackVao);
        gl.useProgram(trackProgram);
        gl.uniform2f(trackViewport, bufferWidth, bufferHeight);
        gl.uniform1f(trackHalfWidth, TRACK_HALF_WIDTH * bufferRatio);
        for (const track of frame.tracks) {
          const orbit = track.kind === "orbit";
          const tint = orbit ? ORBIT_TINT : ARC_TINT;
          gl.uniformMatrix4fv(trackMvp, false, orbit ? frame.atmosphere : frame.land);
          gl.uniform4f(trackEnds, track.fromU, track.fromV, track.toU, track.toV);
          gl.uniform1f(trackBow, track.bow);
          gl.uniform1f(trackHead, track.head);
          gl.uniform1f(trackTail, track.tail);
          gl.uniform1f(trackFade, track.fade);
          gl.uniform3f(trackTint, tint[0], tint[1], tint[2]);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, (TRACK_SAMPLES + 1) * 2);
        }
        gl.bindVertexArray(vao);
      }

      /* Weather, on the highest plane of the stack. */
      gl.useProgram(atmosphereProgram);
      gl.uniformMatrix4fv(atmosphereMvp, false, frame.atmosphere);
      gl.uniform1f(atmosphereTime, frame.timeSeconds);
      gl.uniform2f(atmosphereDots, ATMOSPHERE_DOTS[0], ATMOSPHERE_DOTS[1]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.disable(gl.BLEND);

      gl.bindVertexArray(null);
    },

    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      image.src = "";
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteBuffer(trackBuffer);
      gl.deleteVertexArray(vao);
      gl.deleteVertexArray(trackVao);
      gl.deleteProgram(landProgram);
      gl.deleteProgram(twinkleProgram);
      gl.deleteProgram(gridProgram);
      gl.deleteProgram(atmosphereProgram);
      gl.deleteProgram(glowProgram);
      gl.deleteProgram(ringProgram);
      gl.deleteProgram(trackProgram);
      /* Without this the context lingers until GC and keeps counting against the browser's hard
       * cap on live WebGL contexts — which a run that changes maps would walk straight into. */
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    },
  };
}
