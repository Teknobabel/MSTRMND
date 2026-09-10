import { STAGE_HEIGHT, STAGE_WIDTH, currentStageLayout, layoutViewportSize } from "./stageScale";

/**
 * Pinch-to-zoom for the scaled stage.
 *
 * The shell is authored at 1920x1080 and scaled down to fit (see stageScale.ts). On a phone
 * that lands near 0.36, so a 12px label arrives about four points tall and the natural thing
 * to reach for is pinch-to-zoom — which is the one gesture this stage cannot hand to the
 * browser. Page zoom re-rasterizes the whole fixed-size composited layer at zoom x
 * devicePixelRatio with no ceiling, and on a phone that ends with the tab dropped and the run
 * lost. So the gesture is intercepted and spent on a transform this module owns instead.
 *
 * Owning it is only worth anything if it stays cheaper than the thing it replaced, and the
 * naive version is not: it is easy to write a pinch that costs more per frame than page zoom
 * ever did. Four rules keep it affordable, and none of them is optional.
 *
 * 1. **The transform goes on the shell, never on `:root`.** Custom properties inherit, so a
 *    `--stage-zoom` written to the document element invalidates style for every node in the
 *    tree — measured at ~4.6ms per recalc on a 1920x1080 shell, once per touch sample. The
 *    write here lands on one element and dirties one element.
 * 2. **Nothing reads style back during a gesture.** A `getComputedStyle` in the frame loop
 *    forces a synchronous recalc of whatever the last write invalidated, which turns rule 1's
 *    saving straight back into a stall. The fit scale is therefore cached here as a number and
 *    handed out by `stageBufferScale()`.
 * 3. **One update per frame.** Touch sampling runs ahead of the display — 120Hz on current
 *    phones — and every sample past the first in a frame is a write nobody ever sees.
 * 4. **The zoom buys no extra render resolution.** Feeding it into the map's backing store
 *    looked free and was not: it took that buffer from 9MB to 32MB and reallocated it mid
 *    gesture. The map is background art and the things worth zooming into — pins, labels,
 *    numbers — are DOM, which stays sharp because it is vector. So renderers size off the fit
 *    alone, exactly as they did before any of this existed.
 * 5. **The shell stops taking pointers for the duration.** Fingers mid-pinch also arrive as
 *    pointer events, and the UI answers them — leaning the map toward the "pointer", raising
 *    tooltips under the fingers. That is wrong on its own terms rather than expensive (it
 *    measured at a handful of forced layout reads per gesture), and one class carrying it
 *    also carries rule 6.
 *
 * 6. **The raster is held still while the fingers are down.** A transform that changes every
 *    frame re-rasterizes the layer every frame, each one a fresh allocation climbing toward
 *    the ceiling below; `will-change: transform` on the same pinching class trades a little
 *    sharpness mid-gesture for one re-raster at the end.
 *
 * On top of that the zoom is capped twice over: at the shell's authored 1:1 size, past which
 * zooming adds no information, and at a raster density no greater than a retina desktop
 * already pays, which is what keeps the layer itself from becoming the thing that kills the
 * tab. Panning is two-fingered, so one finger stays with the UI and buttons, card drags and
 * panel scrolling behave exactly as they do at fit.
 */

/** Fit. The stage is never zoomed out past the size stageScale chose for it. */
export const MIN_ZOOM = 1;

/**
 * A hard ceiling over the two rules below, for the case where the fit scale is very small.
 * Past 4x the shell covers so little of the screen that finding the rest of it costs more
 * than the size gained.
 */
export const MAX_ZOOM = 4;

/**
 * The most device pixels the stage may be rasterized at per authored pixel.
 *
 * This is the number that decides whether a pinch survives on a phone. A DPR-3 device fitting
 * the shell at 0.36 already rasterizes it at 1.08, or about 10MB; the same 1920x1080 layer
 * costs ~33MB at 2.0, ~52MB at 2.5, and ~75MB at the 3.0 the 1:1 rule alone would ask for —
 * before any of its sublayers. A phone handed the largest of those mid-gesture drops the tab.
 *
 * 2.0 is the density a retina desktop (DPR 2 at fit 1.0) pays today and is therefore known to
 * be survivable. The effect is per-device rather than universal: DPR-2 phones are bounded by
 * the 1:1 rule and reach authored size, DPR-3 phones stop a little short of it.
 */
const MAX_RASTER_DENSITY = 2;

/** Zoom within this of fit is treated as fit, so a sloppy pinch-out lands exactly home. */
const FIT_EPSILON = 0.02;

/** Below this a two-finger span is noise (or a fingertip resting on the glass). */
const MIN_PINCH_SPAN_PX = 1;

export interface StageView {
  /** Multiplier on top of the fit scale. */
  readonly zoom: number;
  /** Screen-space offset of the stage from where the fit put it, in CSS pixels. */
  readonly panX: number;
  readonly panY: number;
}

export const FIT_VIEW: StageView = { zoom: MIN_ZOOM, panX: 0, panY: 0 };

/** Everything about the current fit that the maths below has to agree with. */
export interface StageFrame {
  /** The uniform fit scale, i.e. what `--ui-scale` holds. */
  readonly scale: number;
  /** True while the stage is rotated 90deg to fake landscape, which swaps its on-screen axes. */
  readonly rotated: boolean;
  /** `devicePixelRatio`, which decides how much raster a given zoom actually costs. */
  readonly pixelRatio: number;
  /**
   * Where the shell's centre sits on screen with no pan applied.
   *
   * Measured rather than assumed to be the middle of the viewport: `.app-root` is inset by the
   * safe area, so on a notched phone the stage is centred a few pixels off it, and a pinch
   * aimed at the wrong centre drifts away from the fingers holding it.
   */
  readonly originX: number;
  readonly originY: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * How far this device is allowed to zoom: to the shell's authored size, but no denser than
 * `MAX_RASTER_DENSITY`, and never below fit even on a screen where that budget is already spent.
 */
export function maxZoomFor(scale: number, pixelRatio: number): number {
  if (!Number.isFinite(scale) || scale <= 0) {
    return MIN_ZOOM;
  }
  const density = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const authoredSize = 1 / scale;
  const rasterBudget = MAX_RASTER_DENSITY / (scale * density);
  return clamp(Math.min(authoredSize, rasterBudget), MIN_ZOOM, MAX_ZOOM);
}

/**
 * How far the stage may slide from where the fit put it, on each screen axis.
 *
 * The limit is half the *growth* the zoom added, which is the bound that makes both of the
 * things a player expects true at once: pan far enough to reach either edge of the stage, and
 * never far enough to show more letterbox than fit already showed. It falls out of the same
 * expression that at fit nothing may move at all — including on a notched phone, where the
 * stage is legitimately centred off the middle of the screen and a clamp written against the
 * viewport instead would shove it back over the notch.
 */
export function panLimits(
  frame: StageFrame,
  zoom: number,
): { readonly x: number; readonly y: number } {
  const growth = (Math.max(zoom, MIN_ZOOM) - MIN_ZOOM) * frame.scale * 0.5;
  return {
    x: (frame.rotated ? STAGE_HEIGHT : STAGE_WIDTH) * growth,
    y: (frame.rotated ? STAGE_WIDTH : STAGE_HEIGHT) * growth,
  };
}

/**
 * The nearest view to `view` that is inside both the zoom range and the pan limits.
 *
 * The `+ 0` normalises the negative zero `clamp` hands back when a leftward pan meets a zero
 * limit, which would otherwise reach the stylesheet as `-0.00px`.
 */
export function clampView(view: StageView, frame: StageFrame): StageView {
  const zoom = clamp(view.zoom, MIN_ZOOM, maxZoomFor(frame.scale, frame.pixelRatio));
  const limits = panLimits(frame, zoom);
  return {
    zoom,
    panX: clamp(view.panX, -limits.x, limits.x) + 0,
    panY: clamp(view.panY, -limits.y, limits.y) + 0,
  };
}

/**
 * The view that keeps whatever sat under `from` sitting under `to`.
 *
 * `from` is the pinch midpoint when the fingers went down and `to` is where they are now, so
 * one call carries the whole gesture: spreading the fingers zooms about them, sliding them
 * pans. Written as a screen-space displacement rather than in stage coordinates, which is why
 * it needs no special case for the rotated stage — the pan is applied ahead of the rotation.
 */
export function zoomAbout(
  start: StageView,
  frame: StageFrame,
  nextZoom: number,
  from: Point,
  to: Point,
): StageView {
  const zoom = clamp(nextZoom, MIN_ZOOM, maxZoomFor(frame.scale, frame.pixelRatio));
  const ratio = zoom / start.zoom;
  return clampView(
    {
      zoom,
      panX: to.x - frame.originX - ratio * (from.x - frame.originX - start.panX),
      panY: to.y - frame.originY - ratio * (from.y - frame.originY - start.panY),
    },
    frame,
  );
}

/** Collapse a nearly-fit view to exactly fit, so pinching out always lands home. */
export function snapToFit(view: StageView): StageView {
  return view.zoom <= MIN_ZOOM + FIT_EPSILON ? FIT_VIEW : view;
}

export function isFit(view: StageView): boolean {
  return view.zoom === MIN_ZOOM && view.panX === 0 && view.panY === 0;
}

/** The CSS transform for a view, as the stylesheet would have written it. */
export function stageTransform(view: StageView, rotated: boolean): string {
  const pan = `translate(${px(view.panX)}, ${px(view.panY)})`;
  const spin = rotated ? " rotate(90deg)" : "";
  /* Composed against `--ui-scale` rather than a number so the zoomed stage keeps agreeing with
     the fit stageScale is maintaining, to the digit. */
  return `translate(-50%, -50%) ${pan}${spin} scale(calc(var(--ui-scale) * ${view.zoom.toFixed(4)}))`;
}

/**
 * A pan as CSS. Rounded first and then nudged off negative zero, which the focal maths leaves
 * behind as a residue too small to see and `toFixed` would otherwise write out as `-0.00px`.
 */
function px(value: number): string {
  return `${(Math.round(value * 100) / 100 + 0).toFixed(2)}px`;
}

/* ------------------------------------------------------------------ *
 * DOM wiring
 * ------------------------------------------------------------------ */

let view: StageView = FIT_VIEW;

/**
 * The fit scale, cached.
 *
 * Kept as a number precisely so `stageBufferScale()` never has to read style back during a
 * gesture: a `getComputedStyle` there forces a synchronous recalc of everything the frame's
 * own write just invalidated, which was half the cost of the first version of this module.
 */
let fitScale = 1;
let rotated = false;

/**
 * The fit scale, for anything that allocates a buffer to match how big the stage is drawn.
 *
 * Deliberately not multiplied by the zoom. A renderer that follows the zoom reallocates a
 * large buffer repeatedly during a gesture, which is memory pressure applied at the exact
 * moment the compositor is asking for the most — the pinch's share of a phone's budget is
 * better spent on the shell's own layer than on re-rendering background art the player is not
 * zooming in to read.
 */
export function stageFitScale(): number {
  return fitScale;
}

let shellEl: HTMLElement | null = null;

function stage(): HTMLElement | null {
  if (shellEl === null || !shellEl.isConnected) {
    shellEl = document.querySelector<HTMLElement>(".omega-shell");
  }
  return shellEl;
}

/**
 * Measure the current fit. Reads layout, so it runs once when a gesture opens and on resize,
 * never inside the gesture's own frame loop.
 */
function measureFrame(): StageFrame {
  const layout = currentStageLayout();
  fitScale = layout.scale;
  rotated = layout.rotated;
  const rect = stage()?.getBoundingClientRect();
  /* The rect is post-transform, so its centre is the origin plus whatever pan is applied;
     subtracting the pan back off recovers the fixed centre. A hidden shell measures zero,
     and then the viewport's own middle is the best guess available. */
  const centred = rect === undefined || rect.width === 0 || rect.height === 0;
  const viewport = centred ? layoutViewportSize() : { width: 0, height: 0 };
  return {
    scale: layout.scale,
    rotated: layout.rotated,
    pixelRatio: window.devicePixelRatio,
    originX: centred ? viewport.width / 2 : rect.left + rect.width / 2 - view.panX,
    originY: centred ? viewport.height / 2 : rect.top + rect.height / 2 - view.panY,
  };
}

/**
 * Write the view to the shell.
 *
 * One element, one property — never a custom property on `:root`, which would inherit its way
 * into a style recalc of the entire document on every frame of the pinch. At fit the inline
 * transform is removed outright so the stylesheet's own rule takes the stage back, which also
 * means nothing is left overriding it if the stage rotates later.
 */
function apply(next: StageView): void {
  if (next.zoom === view.zoom && next.panX === view.panX && next.panY === view.panY) {
    return;
  }
  view = next;
  const el = stage();
  if (el === null) {
    return;
  }
  el.style.transform = isFit(view) ? "" : stageTransform(view, rotated);
}

/**
 * Take the shell out of hit-testing, or put it back.
 *
 * Guarded by its own flag rather than written every time a gesture re-anchors: `pointer-events`
 * inherits, so each real change costs a recalc of the shell's subtree, and the whole point is
 * to spend two of those instead of hundreds.
 */
let inert = false;

function setInert(on: boolean): void {
  if (on === inert) {
    return;
  }
  inert = on;
  stage()?.classList.toggle("omega-shell--pinching", on);
}

/** The reference a live gesture is measured against: where the fingers were when it opened. */
interface Pinch {
  readonly startView: StageView;
  readonly frame: StageFrame;
  readonly startSpan: number;
  readonly from: Point;
}

let pinch: Pinch | null = null;

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function span(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function fingers(event: TouchEvent): readonly [Point, Point] {
  const a = event.touches[0];
  const b = event.touches[1];
  return [
    { x: a.clientX, y: a.clientY },
    { x: b.clientX, y: b.clientY },
  ];
}

/**
 * Anchor a gesture on the two fingers currently down: the span and midpoint everything after
 * this is measured against, plus the fit those measurements only mean anything relative to.
 */
function anchor(a: Point, b: Point): void {
  const startSpan = span(a, b);
  if (startSpan < MIN_PINCH_SPAN_PX) {
    return;
  }
  const frame = measureFrame();
  const startView = clampView(view, frame);
  setInert(true);
  apply(startView);
  pinch = { startView, frame, startSpan, from: midpoint(a, b) };
}

/**
 * The latest finger positions, waiting for a frame to be spent on.
 *
 * Touch sampling outruns the display, so without this the handler writes a transform several
 * times per frame and only the last one is ever shown.
 */
let pending: readonly [Point, Point] | null = null;
let gestureFrame: number | null = null;

function runGestureFrame(): void {
  gestureFrame = null;
  const touches = pending;
  pending = null;
  if (touches === null) {
    return;
  }
  const [a, b] = touches;
  const current = span(a, b);
  if (current < MIN_PINCH_SPAN_PX) {
    return;
  }
  if (pinch === null) {
    anchor(a, b);
    return;
  }
  const zoom = pinch.startView.zoom * (current / pinch.startSpan);
  apply(zoomAbout(pinch.startView, pinch.frame, zoom, pinch.from, midpoint(a, b)));
}

/**
 * Re-anchor whenever the set of fingers on the glass changes, because the reference held from
 * before was measured off fingers that are no longer the two being tracked. Anchoring here
 * rather than on the first move means a pinch loses no travel to its own setup; the lazy
 * re-anchor in `runGestureFrame` covers the case with no touchstart to hang it on, a third
 * finger *lifting* and leaving two still down.
 */
function onTouchStart(event: TouchEvent): void {
  pinch = null;
  pending = null;
  if (event.touches.length >= 2) {
    const [a, b] = fingers(event);
    anchor(a, b);
  }
}

function onTouchMove(event: TouchEvent): void {
  if (event.touches.length < 2) {
    return;
  }
  /* Unconditional, and ahead of everything else: whatever this module goes on to do with the
     gesture, the browser's own page zoom must never get to start. */
  event.preventDefault();
  pending = fingers(event);
  if (gestureFrame === null) {
    gestureFrame = requestAnimationFrame(runGestureFrame);
  }
}

function onTouchEnd(): void {
  pending = null;
  if (gestureFrame !== null) {
    cancelAnimationFrame(gestureFrame);
    gestureFrame = null;
  }
  setInert(false);
  if (pinch === null) {
    return;
  }
  const { frame } = pinch;
  pinch = null;
  apply(clampView(snapToFit(view), frame));
}

/**
 * Re-fit after the window changes shape.
 *
 * A rotation or a fold changes which axis the stage is letterboxed on and, in the portrait
 * case, swaps them outright — a pan chosen against the old framing means nothing in the new
 * one, so that case goes home rather than being clamped into a corner. A plain resize (the
 * URL bar sliding away) only needs the pan pulled back inside the new bounds.
 */
function refit(previousRotated: boolean): void {
  const frame = measureFrame();
  if (frame.rotated !== previousRotated) {
    apply(FIT_VIEW);
    return;
  }
  /* The new fit scale needs no rewrite of its own: the transform composes `var(--ui-scale)`
     rather than a baked number, so stageScale's own resize write carries it. */
  apply(clampView(view, frame));
}

/**
 * Start listening for the pinch.
 *
 * `gesturestart`/`gesturechange`/`gestureend` are WebKit's own pinch events and are cancelled
 * outright: iOS Safari ignores `user-scalable=no` in the viewport meta and does not honour
 * `touch-action` for page zoom either, so this is the only thing that stops Safari zooming the
 * page out from under the transform above. The zoom itself is driven from the touch events,
 * which every mobile browser sends.
 */
export function initStageZoom(): void {
  const cancel = (event: Event): void => {
    event.preventDefault();
  };
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(type, cancel, { passive: false });
  }
  document.addEventListener("touchstart", onTouchStart, { passive: true });
  document.addEventListener("touchmove", onTouchMove, { passive: false });
  document.addEventListener("touchend", onTouchEnd, { passive: true });
  document.addEventListener("touchcancel", onTouchEnd, { passive: true });

  const initial = currentStageLayout();
  fitScale = initial.scale;
  rotated = initial.rotated;
  let resizeFrame: number | null = null;
  /* Coalesced into one measure per frame: resize fires in bursts (URL bar, rotation, keyboard)
     and every one of these reads layout. */
  const schedule = (): void => {
    if (resizeFrame !== null) {
      return;
    }
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      refit(rotated);
    });
  };
  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", schedule);
}
