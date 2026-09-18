import {
  clipScale,
  clipShiftY,
  multiply,
  perspective,
  rotationX,
  rotationY,
  transformVec4,
  translation,
  type Mat4,
} from "./mat4";

/**
 * The camera that looks at the map.
 *
 * The map is a slab lying in the XY plane, pitched away from the viewer and drifting slowly.
 * Two things make that safe to do to a panel people have to *aim* with:
 *
 * 1. **The fit.** After the tilt and drift are applied, the slab's four corners are projected
 *    and the whole frame is scaled so the outermost one lands exactly on the edge. A site can
 *    therefore never be pushed off-screen by the camera, however the tilt is later tuned —
 *    it is a property of the construction rather than of the numbers chosen below.
 * 2. **Flat is the zero case.** At `tilt: 0, drift: 0` this reproduces `flatMapMatrix` exactly,
 *    so reduced-motion and any future "steady map" option are a parameter, not a code path.
 */

/** Vertical field of view. Narrow enough that the perspective reads as depth, not fisheye. */
const FOV_Y_RADIANS = 0.55;

/**
 * How far the top of the map is pitched away at full tilt, ~9.7 degrees. Tuned against what it
 * costs: the fit below has to shrink the map to keep the pitched slab inside the panel, so
 * every extra degree of tilt is map the player reads less easily.
 */
const TILT_RADIANS = 0.17;

/** Drift is deliberately tiny and slow: this is a map being looked at, not a camera flying. */
const DRIFT_YAW_RADIANS = 0.045;
const DRIFT_TILT_RADIANS = 0.022;
const DRIFT_YAW_PERIOD_SECONDS = 41;
const DRIFT_TILT_PERIOD_SECONDS = 29;

/**
 * How far each floating layer sits above the land, in slab half-heights.
 *
 * The entire sense of volume comes from these two numbers: they are the only thing giving the
 * layers a parallax to disagree about as the camera drifts. Two heights rather than one because
 * a single floating layer gives the eye one disagreement to read and a constant offset is easy
 * to dismiss as a second flat picture; three planes at different heights sliding past each
 * other at different rates is the thing that actually reads as depth.
 *
 * The atmosphere sits far enough above the lattice to be obviously a separate stratum. It is
 * also, being nearer the camera, drawn larger than the land — so its own edges fall outside the
 * panel and the only part on screen is its middle, which is exactly what a haze wants.
 */
const GRID_LAYER_HEIGHT = 0.055;
const ATMOSPHERE_LAYER_HEIGHT = 0.13;

/**
 * How far the camera turns toward a staged target, at full focus. ~2.6 and ~1.7 degrees.
 *
 * Turning, deliberately, and never zooming. A push-in would be the obvious way to emphasise a
 * target and it is the one thing this camera must not do: the fit below keeps every site inside
 * the panel by scaling the whole slab to contain it, and zooming past that is exactly the act of
 * pushing other sites out of frame. On a panel the player aims with, an unclickable pin is a
 * worse outcome than an unemphatic one. A turn changes the projection and the fit still holds.
 */
const FOCUS_YAW_RADIANS = 0.046;
const FOCUS_PITCH_RADIANS = 0.03;

/**
 * How far the map leans toward the pointer, at full strength. ~1.4 and ~0.9 degrees.
 *
 * Smaller than the target lean on purpose. Staging a target is a decision and the map is
 * allowed to acknowledge it; the pointer is just where someone's hand happens to be, and a map
 * that answers it as loudly would be the only thing on screen anyone could look at.
 *
 * These are the two numbers to turn if the effect wants to be stronger or weaker. At the values
 * above, sweeping the pointer from one edge of the panel to the other moves the furthest site
 * about 14px across a 1071px plot — roughly 1.3%. The response is not uniform across the map,
 * and cannot be: yawing a plane in perspective magnifies the edge swinging toward the viewer
 * and foreshortens the far one, so sites on one side travel several times as far as those on
 * the other. That is what makes it read as a turn rather than as a slide.
 */
const POINTER_YAW_RADIANS = 0.024;
const POINTER_PITCH_RADIANS = 0.015;

/**
 * How much of the empty band above the map to close up, as a fraction of it.
 *
 * The fit below is uniform and lands on whichever corner projects furthest out, which at this
 * tilt is a *bottom* one: pitching the slab away shrinks the far edge, so the bottom corners hit
 * the left and right edges of the panel while the top edge stops short of the top. That leaves
 * about 5% of the panel's height empty along the top and only 0.7% along the bottom — the map
 * sitting low in its frame with a dead band over it, on every aspect ratio, because the slab's
 * half-width is `aspect` and the projection divides by `aspect`, so the two cancel and the
 * framing is the same shape at every window size.
 *
 * This slides the fitted result back up. It cannot be done by fitting harder: the binding
 * constraint is horizontal, so scaling up to reach the top would push the bottom corners out
 * through the sides — and the fit exists precisely so that no site can be pushed off the panel.
 * A shift moves every site by the same amount and pushes none of them anywhere.
 *
 * `1` puts the far edge flush against the top of the panel. The slack it takes comes out at the
 * bottom, where the drawer cabinet's tabs already sit over the map, which is why this is worth
 * spending there rather than leaving it split. Clamped against what the fit actually left, so
 * this can never lift the map's far edge off the top of its own panel.
 */
const FRAMING_LIFT = 1;

const NEAR = 0.1;
const FAR = 20;

/** Where the camera is leaning, in map space, and how hard. */
export interface MapCameraFocus {
  readonly u: number;
  readonly v: number;
  /** 0 for no lean, 1 for the full turn. Eased by {@link easeMapLean}. */
  readonly amount: number;
}

/**
 * Move a lean toward where it is being asked to point.
 *
 * Exponential rather than linear, and driven by the real frame delta, so the easing looks the
 * same on a 60Hz display as on a 144Hz one. A `null` goal lets the lean fall away while leaving
 * its point alone: easing the point back to the centre at the same time would drag the map
 * through an arc on the way out instead of simply relaxing.
 *
 * @param deltaSeconds Time since the last frame. Clamp this at the call site — a tab that was
 *   asleep for a minute must not resume with one enormous step.
 * @param timeConstant Seconds to close most of the distance.
 */
export function easeMapLean(
  current: MapCameraFocus,
  goal: { readonly u: number; readonly v: number } | null,
  deltaSeconds: number,
  timeConstant: number,
): MapCameraFocus {
  if (deltaSeconds <= 0 || timeConstant <= 0) {
    return current;
  }
  const k = 1 - Math.exp(-deltaSeconds / timeConstant);
  if (goal === null) {
    return { ...current, amount: current.amount + (0 - current.amount) * k };
  }
  /* Nothing is leaning yet, so start from the new point rather than sweeping across the map
   * from wherever the last one happened to be. */
  const from = current.amount < 0.02 ? goal : current;
  return {
    u: from.u + (goal.u - from.u) * k,
    v: from.v + (goal.v - from.v) * k,
    amount: current.amount + (1 - current.amount) * k,
  };
}

export interface MapCameraOptions {
  /** Panel aspect, width / height. */
  readonly aspect: number;
  /** Seconds since the map view opened; drives the drift. */
  readonly timeSeconds: number;
  /** 0 lays the map flat, 1 is the authored tilt. */
  readonly tilt: number;
  /** 0 holds the camera still, 1 is the authored drift. */
  readonly drift: number;
  /** A staged target the camera should turn toward, if any. */
  readonly focus?: MapCameraFocus;
  /** Where the pointer is over the map, if it is. Composes with `focus` rather than replacing
   *  it: a staged target and a hovering hand are both true at once. */
  readonly pointer?: MapCameraFocus;
}

/**
 * How far the nearest and furthest corners of the land sit from the camera, in view units.
 *
 * The depth haze is the one thing that makes the tilt read as a table rather than as a quad,
 * and it needs to know what range of distances the map actually spans. Reporting the measured
 * corners rather than a hardcoded pair means the haze covers exactly the visible depth however
 * the tilt is later tuned — and collapses to nothing on a flat map, where `near === far`, with
 * no special case anywhere.
 */
export interface MapDepthRange {
  readonly near: number;
  readonly far: number;
}

export interface MapCameraFrame {
  /** The land plane — and the matrix the markers must be projected through. */
  readonly land: Mat4;
  /** The grid plane floating above it. */
  readonly grid: Mat4;
  /** The haze plane floating above that. */
  readonly atmosphere: Mat4;
  /** The depth the land spans, for the haze. */
  readonly depth: MapDepthRange;
}

/**
 * Map space (the unit square, `v` running downward) to slab space: a rectangle of half-height 1
 * and half-width `aspect`, centred on the origin, `layerZ` above the plane.
 *
 * The layer offset is applied here, before any rotation, so a floating layer stays parallel to
 * the land as the slab pitches rather than sliding across it.
 */
function mapToSlab(aspect: number, layerZ: number): Mat4 {
  // prettier-ignore
  return new Float32Array([
    2 * aspect, 0, 0, 0,
    0, -2, 0, 0,
    0, 0, 1, 0,
    -aspect, 1, layerZ, 1,
  ]);
}

/**
 * Distance at which a slab of half-height 1 exactly fills the frame vertically. Solving for it
 * rather than picking one is what makes the flat case land on `flatMapMatrix` to the bit.
 */
function cameraDistance(): number {
  return 1 / Math.tan(FOV_Y_RADIANS / 2);
}

function unfittedCamera(
  aspect: number,
  tiltRadians: number,
  yawRadians: number,
  layerZ: number,
): Mat4 {
  const projection = perspective(FOV_Y_RADIANS, aspect, NEAR, FAR);
  const view = translation(0, 0, -cameraDistance());
  /* Negated on purpose: a positive rotation about X swings the top of the slab *toward* the
   * viewer, which reads as the map falling over forwards. Pitching it the other way is the
   * tactical-table look — standing over a map laid out in front of you. */
  const orientation = multiply(rotationY(yawRadians), rotationX(-tiltRadians));
  return multiply(
    projection,
    multiply(view, multiply(orientation, mapToSlab(aspect, layerZ))),
  );
}

/**
 * The scale that brings the whole land slab inside the frame, and the depth it spans.
 *
 * Only the four corners are tested because the slab is a flat convex quad: nothing between them
 * can project further out, or lie further from the camera, than the furthest of them. Both
 * answers come out of the one loop because both are questions about the same four points, and
 * because `clipScale` leaves w alone — so the depths measured here are still the depths after
 * the fit is applied.
 */
function landExtent(landCamera: Mat4): {
  readonly scale: number;
  readonly depth: MapDepthRange;
  /** The highest corner in NDC *before* the fit, for {@link FRAMING_LIFT} to measure against. */
  readonly topNdc: number;
} {
  let extent = 0;
  let near = Infinity;
  let far = 0;
  let topNdc = -Infinity;
  for (const [u, v] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const) {
    const [x, y, , w] = transformVec4(landCamera, u, v, 0, 1);
    if (!(w > 0)) {
      /* A corner behind the camera means the tilt has been pushed somewhere this fit cannot
       * describe. Leave the framing alone rather than invent a scale from a divide by zero,
       * and report a depth range the haze reads as flat. */
      return { scale: 1, depth: { near: 1, far: 1 }, topNdc: 1 };
    }
    extent = Math.max(extent, Math.abs(x / w), Math.abs(y / w));
    topNdc = Math.max(topNdc, y / w);
    near = Math.min(near, w);
    far = Math.max(far, w);
  }
  return { scale: extent > 0 ? 1 / extent : 1, depth: { near, far }, topNdc };
}

/**
 * How far the fitted slab can be slid up before its far edge leaves the top of the panel.
 *
 * Split out and exported for the tests, because it is the one number that says whether the
 * framing is honest: a lift larger than this would be the map hanging off the top of its own
 * frame, which is the failure the fit exists to prevent.
 */
export function framingLift(topNdc: number, scale: number, lift: number): number {
  /* A fit that came back degenerate has not measured anything, and `1 - topNdc * 0` is a full
   * half-panel of "slack" that is really an absence of information. Reframing on that would
   * throw the map off the top of its own frame — so an unmeasured fit reframes by nothing. */
  if (!Number.isFinite(topNdc) || !Number.isFinite(scale) || scale <= 0) {
    return 0;
  }
  const slack = 1 - topNdc * scale;
  if (!Number.isFinite(slack) || slack <= 0) {
    return 0;
  }
  return Math.min(Math.max(lift, 0), 1) * slack;
}

/**
 * Both layers for one frame, sharing a single fit so they cannot drift apart in scale.
 */
export function mapCameraFrame(options: MapCameraOptions): MapCameraFrame {
  const { aspect, timeSeconds, tilt, drift, focus, pointer } = options;
  const tau = Math.PI * 2;
  const driftYaw =
    drift * DRIFT_YAW_RADIANS * Math.sin((timeSeconds / DRIFT_YAW_PERIOD_SECONDS) * tau);
  const driftPitch =
    drift * DRIFT_TILT_RADIANS * Math.sin((timeSeconds / DRIFT_TILT_PERIOD_SECONDS) * tau);

  /* Map space is measured from the top-left, so a site's offset from the centre is doubled into
   * -1..1 before it becomes an angle. */
  const lean = focus?.amount ?? 0;
  const focusYaw = lean * FOCUS_YAW_RADIANS * ((focus?.u ?? 0.5) - 0.5) * 2;
  const focusPitch = lean * FOCUS_PITCH_RADIANS * ((focus?.v ?? 0.5) - 0.5) * 2;

  const hover = pointer?.amount ?? 0;
  const pointerYaw = hover * POINTER_YAW_RADIANS * ((pointer?.u ?? 0.5) - 0.5) * 2;
  const pointerPitch = hover * POINTER_PITCH_RADIANS * ((pointer?.v ?? 0.5) - 0.5) * 2;

  /* Every lean is just another angle added before the fit, so they compose without any of them
   * needing to know about the others — and the fit still contains whatever they add up to. */
  const yaw = driftYaw + focusYaw + pointerYaw;
  const pitch = tilt * TILT_RADIANS + driftPitch + focusPitch + pointerPitch;

  const land = unfittedCamera(aspect, pitch, yaw, 0);
  const { scale: fit, depth, topNdc } = landExtent(land);
  /* Fit first, then reframe: the lift is measured against what the fit left over, so the two
   * cannot disagree about where the top of the panel is. One matrix for both, so every plane
   * below is reframed identically and the markers — projected through `land` — come with it. */
  const scale = multiply(clipShiftY(framingLift(topNdc, fit, FRAMING_LIFT)), clipScale(fit));
  /* Both floating layers are scaled by the land's tilt, so `tilt: 0` collapses the whole stack
   * onto one plane and the flat case stays the zero case for all three. */
  return {
    land: multiply(scale, land),
    grid: multiply(scale, unfittedCamera(aspect, pitch, yaw, tilt * GRID_LAYER_HEIGHT)),
    atmosphere: multiply(
      scale,
      unfittedCamera(aspect, pitch, yaw, tilt * ATMOSPHERE_LAYER_HEIGHT),
    ),
    depth,
  };
}
