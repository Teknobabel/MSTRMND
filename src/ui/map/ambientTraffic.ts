/**
 * The traffic the map runs on its own.
 *
 * Flights arcing between cities and satellites crossing overhead, so the world has something
 * happening on it that is not the player. This is the counterpart to `siteSignals` and its exact
 * opposite in intent: that module is the seam through which play reaches the picture, and this
 * one is deliberately sealed off from play. Nothing here reads game state, and the endpoints
 * below are pointedly **not** the authored site markers — an arc between two sites would be the
 * map asserting a relationship the rules know nothing about, and a player is right to read a
 * line drawn between two things as meaning something.
 *
 * Pure, and a function of nothing but the clock. There is no spawn bookkeeping to drift out of
 * step and nothing to reset when the panel is rebuilt: ask what is in the air at time `t` and
 * the same answer comes back every time, which is what makes the schedule testable at all.
 */

/**
 * Cities the ambient flights run between, in map space.
 *
 * Derived from the shipped art rather than placed by hand, and the difference mattered: the
 * first version of this table was written from the same geographic reasoning the site markers
 * were, and landed most of its anchors within a couple of percent of a site — the exact thing
 * the table exists to avoid — with several more out in open water where a flight would appear
 * to take off from the sea. These are the brightest clusters on the art, filtered to keep every
 * one of them clear of every authored marker and spread apart from each other.
 *
 * Which means they are tied to `world-map.png` specifically. A new world map wants this table
 * regenerated against it, not adjusted by eye; the two failure modes above are both invisible
 * in the source and obvious on screen.
 */
const ANCHORS: readonly (readonly [number, number])[] = [
  [0.132, 0.244], // Western Canadian coast
  [0.156, 0.394], // American southwest
  [0.252, 0.142], // Northern Canada
  [0.27, 0.544], // Northern South America
  [0.324, 0.268], // Atlantic Canada
  [0.408, 0.1], // North Atlantic islands
  [0.462, 0.382], // Northwest Africa
  [0.516, 0.202], // Scandinavia and the Baltic
  [0.534, 0.334], // Eastern Mediterranean
  [0.588, 0.424], // Arabian peninsula
  [0.588, 0.532], // East Africa
  [0.624, 0.34], // Caspian basin
  [0.672, 0.442], // Northern India
  [0.744, 0.61], // Java and Sumatra
  [0.81, 0.556], // Borneo and the southern Philippines
  [0.846, 0.37], // Japan and Korea
  [0.852, 0.256], // Northeast Asia
  [0.864, 0.664], // New Guinea
];

/** How many flights and how many satellites can be up at once. */
const ARC_SLOTS = 4;
const ORBIT_SLOTS = 2;

/**
 * How long a slot takes to fly and then rest, and how much that varies between slots.
 *
 * The rest is the important half. Four slots that were always in the air would read as four
 * permanent lines drawn on the map — decoration the eye files away and stops seeing. Flights
 * that appear, cross and go leave the map quiet a good part of the time, which is what makes
 * the next one register as something happening.
 */
const ARC_CYCLE_SECONDS = 19;
const ARC_CYCLE_SPREAD = 11;
const ORBIT_CYCLE_SECONDS = 34;
const ORBIT_CYCLE_SPREAD = 13;

/**
 * The share of its cycle a slot spends in the air; the remainder is the rest above.
 *
 * Tuned down from the first pass, where four arc slots at 0.62 and two orbits at 0.8 meant
 * something was always crossing the map: with that much duty the traffic stops being events and
 * becomes a texture, and the eye files it away within a minute. At these shares the map carries
 * two or three moving things most of the time and occasionally none at all, which is what makes
 * the next departure register.
 */
const ARC_TRAVEL_SHARE = 0.45;
const ORBIT_TRAVEL_SHARE = 0.55;

/** How much of the route the trail behind the head covers. */
const ARC_TAIL = 0.34;
const ORBIT_TAIL = 0.18;

/**
 * How high an arc bows above the land, in slab half-heights, as a base plus a share of the
 * route's length so a long haul climbs higher than a hop.
 *
 * Bounded on purpose to stay inside the stack `camera.ts` lays out: at the longest route this
 * peaks near 0.10, which is above the lattice at 0.055 and below the weather at 0.13. Flights
 * therefore pass over the grid and under the cloud, and the three-layer parallax reads as a
 * volume they are moving through rather than as a line drawn over a picture.
 */
const ARC_BOW_BASE = 0.04;
const ARC_BOW_PER_UNIT = 0.075;

/** Routes shorter than this are a dot rather than a journey, and get their far end moved on. */
const MIN_ROUTE_LENGTH = 0.22;

/** Where a satellite pass enters and leaves — outside the map, so it is never seen to start. */
const ORBIT_MARGIN = 0.08;
/** How far a pass slides in v as it crosses, so it reads as an inclined orbit and not a rule. */
const ORBIT_DRIFT = 0.34;

export interface AmbientTrack {
  /** Route endpoints in map space — 0..1 with `v` running downward, as the camera consumes. */
  readonly fromU: number;
  readonly fromV: number;
  readonly toU: number;
  readonly toV: number;
  /**
   * An arc runs city to city over the land; an orbit crosses the whole frame in the weather
   * layer. The renderer reads this to pick which plane to draw the track on, so the distinction
   * is about height and not only about colour.
   */
  readonly kind: "arc" | "orbit";
  /** Peak height above that plane, in slab half-heights. Zero for an orbit, which lies in it. */
  readonly bow: number;
  /** Where the bright head has got to. Runs past 1 so the trail clears the far end. */
  readonly head: number;
  /** How far the trail reaches back from the head, in the same units. */
  readonly tail: number;
  /** 0..1, easing the track in as it sets off and out as it arrives. */
  readonly fade: number;
}

/**
 * A deterministic number in [0, 1) from two integers.
 *
 * Not cryptographic and not trying to be. All it has to do is separate neighbouring
 * (slot, flight) pairs, so that a slot's next flight does not inherit the last one's endpoints —
 * which a plainer hash does visibly, sending the same route twice in a row.
 */
function hash(a: number, b: number): number {
  let h = Math.imul(a, 374761393) + Math.imul(b, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) {
    return x < edge0 ? 0 : 1;
  }
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * How far through its cycle a slot is, and which flight this is.
 *
 * The offset is what staggers the slots against each other. Without it every slot starts its
 * first flight at t = 0 and the map opens with the whole set leaving at once, then goes quiet
 * together — a pulse rather than traffic.
 */
function slotPhase(
  slot: number,
  timeSeconds: number,
  base: number,
  spread: number,
): { readonly flight: number; readonly phase: number } {
  const cycle = base + hash(slot, 1) * spread;
  const elapsed = timeSeconds + hash(slot, 2) * cycle;
  const flight = Math.floor(elapsed / cycle);
  return { flight, phase: elapsed / cycle - flight };
}

/** Eased in over the first tenth of the crossing and out over the last fifth. */
function travelFade(travel: number): number {
  return smoothstep(0, 0.1, travel) * smoothstep(0, 0.2, 1 - travel);
}

/**
 * The far end of a route, guaranteed to be somewhere worth flying to.
 *
 * Walks the table from wherever the hash landed and takes the first anchor far enough from the
 * near end. Bounded by the table's length so it always terminates, and deterministic in a way
 * a re-roll would not be.
 */
function farEnd(from: number, start: number): number {
  const [fu, fv] = ANCHORS[from]!;
  for (let step = 0; step < ANCHORS.length; step += 1) {
    const candidate = (start + step) % ANCHORS.length;
    const [cu, cv] = ANCHORS[candidate]!;
    if (Math.hypot(cu - fu, cv - fv) >= MIN_ROUTE_LENGTH) {
      return candidate;
    }
  }
  return start;
}

/**
 * Everything in the air at this moment. Empty is a perfectly ordinary answer — every slot can be
 * resting at once, and the map is meant to fall quiet sometimes.
 *
 * @param timeSeconds Seconds since the map opened, the same clock the shaders run on.
 */
export function ambientTracks(timeSeconds: number): AmbientTrack[] {
  const out: AmbientTrack[] = [];

  for (let slot = 0; slot < ARC_SLOTS; slot += 1) {
    const { flight, phase } = slotPhase(slot, timeSeconds, ARC_CYCLE_SECONDS, ARC_CYCLE_SPREAD);
    const travel = phase / ARC_TRAVEL_SHARE;
    if (travel > 1) {
      continue;
    }
    const from = Math.floor(hash(slot, flight * 2 + 11) * ANCHORS.length) % ANCHORS.length;
    const to = farEnd(from, Math.floor(hash(slot, flight * 2 + 12) * ANCHORS.length) % ANCHORS.length);
    const [fromU, fromV] = ANCHORS[from]!;
    const [toU, toV] = ANCHORS[to]!;
    out.push({
      fromU,
      fromV,
      toU,
      toV,
      kind: "arc",
      bow: ARC_BOW_BASE + ARC_BOW_PER_UNIT * Math.hypot(toU - fromU, toV - fromV),
      head: travel * (1 + ARC_TAIL),
      tail: ARC_TAIL,
      fade: travelFade(travel),
    });
  }

  for (let slot = 0; slot < ORBIT_SLOTS; slot += 1) {
    const { flight, phase } = slotPhase(
      slot,
      timeSeconds,
      ORBIT_CYCLE_SECONDS,
      ORBIT_CYCLE_SPREAD,
    );
    const travel = phase / ORBIT_TRAVEL_SHARE;
    if (travel > 1) {
      continue;
    }
    const entryV = 0.16 + hash(slot, flight * 3 + 21) * 0.62;
    const drift = (hash(slot, flight * 3 + 22) - 0.5) * ORBIT_DRIFT;
    const exitV = Math.min(Math.max(entryV + drift, 0.08), 0.92);
    /* Half of them run the other way. A set of passes that all tracked east would read as a
     * scrolling texture rather than as separate objects. */
    const westward = hash(slot, flight * 3 + 23) < 0.5;
    const near = -ORBIT_MARGIN;
    const far = 1 + ORBIT_MARGIN;
    out.push({
      fromU: westward ? far : near,
      fromV: westward ? exitV : entryV,
      toU: westward ? near : far,
      toV: westward ? entryV : exitV,
      kind: "orbit",
      bow: 0,
      head: travel * (1 + ORBIT_TAIL),
      tail: ORBIT_TAIL,
      fade: travelFade(travel),
    });
  }

  return out;
}
