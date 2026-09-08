import {
  clipScale,
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
 * How far the grid layer floats above the land, in slab half-heights. The entire sense of
 * volume comes from this number: it is the only thing that gives the two layers a parallax to
 * disagree about as the camera drifts.
 */
const GRID_LAYER_HEIGHT = 0.055;

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

export interface MapCameraFrame {
  /** The land plane — and the matrix the markers must be projected through. */
  readonly land: Mat4;
  /** The grid plane floating above it. */
  readonly grid: Mat4;
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
 * The scale that brings the whole land slab inside the frame. Only the four corners are tested
 * because the slab is a flat convex quad: nothing between them can project further out than
 * the furthest of them.
 */
function fitScale(landCamera: Mat4): number {
  let extent = 0;
  for (const [u, v] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const) {
    const [x, y, , w] = transformVec4(landCamera, u, v, 0, 1);
    if (!(w > 0)) {
      /* A corner behind the camera means the tilt has been pushed somewhere this fit cannot
       * describe. Leave the framing alone rather than invent a scale from a divide by zero. */
      return 1;
    }
    extent = Math.max(extent, Math.abs(x / w), Math.abs(y / w));
  }
  return extent > 0 ? 1 / extent : 1;
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
  const scale = clipScale(fitScale(land));
  return {
    land: multiply(scale, land),
    grid: multiply(scale, unfittedCamera(aspect, pitch, yaw, tilt * GRID_LAYER_HEIGHT)),
  };
}
