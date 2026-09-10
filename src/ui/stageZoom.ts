import {
  STAGE_HEIGHT,
  STAGE_WIDTH,
  currentStageLayout,
  layoutViewportSize,
} from "./stageScale";

/**
 * Pinch-to-zoom for the scaled stage.
 *
 * The shell is authored at 1920x1080 and scaled down to fit (see stageScale.ts). On a phone
 * that lands near 0.36, so a 12px label arrives about four points tall and the natural thing
 * to reach for is the browser's own pinch-zoom — which is the one gesture this stage cannot
 * afford. Page zoom re-rasterizes the whole fixed-size composited layer at zoom x
 * devicePixelRatio with no ceiling, and on a phone that reliably ends with the tab dropped and
 * the run lost.
 *
 * So the gesture is intercepted rather than allowed, and spent on a transform this module owns.
 * That buys three things the browser's version does not:
 *
 * - **A ceiling.** Zoom stops where the shell reaches its authored 1:1 size, which is both the
 *   most legible it can ever be and a raster cost every desktop already pays.
 * - **A clamp.** The stage can never be dragged off its own letterbox, so there is no state
 *   where the player is stranded looking at blank space.
 * - **Composition.** The zoom multiplies the same `--ui-scale` the rest of the app already
 *   reads, so the WebGL map re-renders at the zoomed resolution instead of going soft, and
 *   every rect-based hit test keeps working because the zoom is in the same transform.
 *
 * Panning is deliberately two-fingered: one finger stays with the UI, so buttons, card drags
 * and panel scrolling behave exactly as they do at fit.
 */

/** Fit. The stage is never zoomed out past the size stageScale chose for it. */
export const MIN_ZOOM = 1;

/**
 * A hard ceiling over the 1:1 rule below, for the case where the fit scale is very small.
 * Past 4x the shell covers so little of the screen that finding the rest of it costs more
 * than the size gained.
 */
export const MAX_ZOOM = 4;

/** Zoom within this of fit is treated as fit, so a sloppy pinch-out lands exactly home. */
const FIT_EPSILON = 0.02;

/** Below this a two-finger span is noise (or a fingertip resting on the glass). */
const MIN_PINCH_SPAN_PX = 1;

export interface StageView {
  /** Multiplier on top of `--ui-scale`. */
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
 * The zoom at which the shell reaches the size it was authored at, capped.
 *
 * 1:1 rather than some round number because that is the point past which zooming stops adding
 * information: the layout was designed to be read at that size, and every step beyond it is
 * pure raster cost on the device least able to pay it.
 */
export function maxZoomFor(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) {
    return MIN_ZOOM;
  }
  return clamp(1 / scale, MIN_ZOOM, MAX_ZOOM);
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
  const zoom = clamp(view.zoom, MIN_ZOOM, maxZoomFor(frame.scale));
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
  const zoom = clamp(nextZoom, MIN_ZOOM, maxZoomFor(frame.scale));
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

/* ------------------------------------------------------------------ *
 * DOM wiring
 * ------------------------------------------------------------------ */

let view: StageView = FIT_VIEW;

/**
 * The zoom the stage is currently held at.
 *
 * Read by anything that renders into the stage at device resolution: the shell's on-screen
 * size is `--ui-scale * zoom`, and a renderer sizing its backing store off the fit scale alone
 * goes soft the moment someone pinches in.
 */
export function stageZoomFactor(): number {
  return view.zoom;
}

let shellEl: HTMLElement | null = null;

function stage(): HTMLElement | null {
  if (shellEl === null || !shellEl.isConnected) {
    shellEl = document.querySelector<HTMLElement>(".omega-shell");
  }
  return shellEl;
}

/**
 * Measure the current fit.
 *
 * The layout is recomputed here rather than read back out of `--ui-scale` so this cannot race
 * the frame stageScale writes that property on.
 */
function measureFrame(): StageFrame {
  const { scale, rotated } = currentStageLayout();
  const { width, height } = layoutViewportSize();
  const rect = stage()?.getBoundingClientRect();
  /* The rect is post-transform, so its centre is the origin plus whatever pan is applied;
     subtracting the pan back off recovers the fixed centre. A hidden shell measures zero,
     and then the viewport's own middle is the best guess available. */
  const centred = rect === undefined || rect.width === 0 || rect.height === 0;
  return {
    scale,
    rotated,
    originX: centred ? width / 2 : rect.left + rect.width / 2 - view.panX,
    originY: centred ? height / 2 : rect.top + rect.height / 2 - view.panY,
  };
}

/**
 * A pan as CSS. Rounded first and then nudged off negative zero, which the focal maths leaves
 * behind as a residue too small to see and `toFixed` would otherwise write out as `-0.00px`.
 */
function px(value: number): string {
  return `${(Math.round(value * 100) / 100 + 0).toFixed(2)}px`;
}

function apply(next: StageView): void {
  if (next.zoom === view.zoom && next.panX === view.panX && next.panY === view.panY) {
    return;
  }
  view = next;
  const style = document.documentElement.style;
  style.setProperty("--stage-zoom", view.zoom.toFixed(4));
  style.setProperty("--stage-pan-x", px(view.panX));
  style.setProperty("--stage-pan-y", px(view.panY));
}

/** The reference a live gesture is measured against: where the fingers were when it opened. */
interface Pinch {
  readonly startView: StageView;
  readonly frame: StageFrame;
  readonly startSpan: number;
  readonly from: Point;
}

let pinch: Pinch | null = null;

function midpoint(a: Touch, b: Touch): Point {
  return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
}

function span(a: Touch, b: Touch): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/**
 * Anchor a gesture on the two fingers currently down: the span and midpoint everything after
 * this is measured against, plus the fit those measurements only mean anything relative to.
 */
function anchor(a: Touch, b: Touch): void {
  const startSpan = span(a, b);
  if (startSpan < MIN_PINCH_SPAN_PX) {
    return;
  }
  const frame = measureFrame();
  const startView = clampView(view, frame);
  apply(startView);
  pinch = { startView, frame, startSpan, from: midpoint(a, b) };
}

/**
 * Re-anchor whenever the set of fingers on the glass changes, because the reference held from
 * before was measured off fingers that are no longer the two being tracked. Anchoring here
 * rather than on the first move means a pinch loses no travel to its own setup; the lazy
 * re-anchor in `onTouchMove` is what covers the case with no touchstart to hang it on, a
 * third finger *lifting* and leaving two still down.
 */
function onTouchStart(event: TouchEvent): void {
  pinch = null;
  if (event.touches.length >= 2) {
    anchor(event.touches[0], event.touches[1]);
  }
}

function onTouchMove(event: TouchEvent): void {
  if (event.touches.length < 2) {
    return;
  }
  /* Unconditional, and ahead of everything else: whatever this module goes on to do with the
     gesture, the browser's own page zoom must never get to start. */
  event.preventDefault();
  const a = event.touches[0];
  const b = event.touches[1];
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

function onTouchEnd(): void {
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
function refit(previousRotated: boolean): boolean {
  const frame = measureFrame();
  apply(frame.rotated === previousRotated ? clampView(view, frame) : FIT_VIEW);
  return frame.rotated;
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

  let rotated = currentStageLayout().rotated;
  let frame: number | null = null;
  /* Coalesced into one measure per frame: resize fires in bursts (URL bar, rotation, keyboard)
     and every one of these reads layout. */
  const schedule = (): void => {
    if (frame !== null) {
      return;
    }
    frame = requestAnimationFrame(() => {
      frame = null;
      rotated = refit(rotated);
    });
  };
  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", schedule);
}
