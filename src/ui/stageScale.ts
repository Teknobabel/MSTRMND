/**
 * Scaled-canvas layout: the game shell is authored at a fixed reference
 * resolution and scaled uniformly to fit the window, letterboxing the rest.
 * Menus never need per-breakpoint layouts; they only have to work at
 * STAGE_WIDTH x STAGE_HEIGHT.
 *
 * Mobile is landscape-only: touch devices held in portrait get the stage
 * rotated 90deg via the `stage-rotated` root class (CSS fallback), and
 * tryLockLandscape() attempts a native fullscreen + orientation lock where
 * the platform allows it.
 *
 * Pinch-zoom is handled by `ui/stageZoom`, which takes the gesture off the
 * browser and spends it on a capped transform over the scale below. The
 * browser's own page zoom stays disabled either way: it re-rasterizes the
 * fixed-size layer at zoom x devicePixelRatio with no ceiling, which is
 * enough to get a mobile tab killed. The scale below is measured against the
 * *layout* viewport for the same reason - so a page zoom that slips through
 * cannot shrink the UI by the exact factor it was zoomed by.
 */
export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;

export interface StageLayout {
  /** Uniform scale applied to the 1920x1080 shell. */
  readonly scale: number;
  /** True when the stage is rotated 90deg to fake landscape on a portrait phone. */
  readonly rotated: boolean;
}

/** Pure layout math, so the fit rules are testable without a DOM. */
export function computeStageLayout(
  viewportWidth: number,
  viewportHeight: number,
  coarse: boolean,
): StageLayout {
  const w = viewportWidth > 0 ? viewportWidth : STAGE_WIDTH;
  const h = viewportHeight > 0 ? viewportHeight : STAGE_HEIGHT;
  const rotated = coarse && h > w;
  const availW = rotated ? h : w;
  const availH = rotated ? w : h;
  const scale = Math.min(availW / STAGE_WIDTH, availH / STAGE_HEIGHT);
  return { rotated, scale: Number.isFinite(scale) && scale > 0 ? scale : 1 };
}

function coarsePointer(): boolean {
  return window.matchMedia("(pointer: coarse)").matches;
}

/**
 * The *layout* viewport, not the visual one.
 *
 * `window.innerWidth/innerHeight` report the visual viewport on iOS Safari, so
 * they shrink while the page is pinch-zoomed. Scaling the stage off those made
 * a zoom-in shrink the UI by the same factor the user had just zoomed by —
 * the "it resets when I pinch" symptom. `documentElement.clientWidth/Height`
 * is the layout viewport and is unaffected by zoom on every browser.
 */
export function layoutViewportSize(): { width: number; height: number } {
  const doc = document.documentElement;
  return {
    width: doc.clientWidth || window.innerWidth,
    height: doc.clientHeight || window.innerHeight,
  };
}

/**
 * The layout the shell is fitted to right now.
 *
 * Exported because `ui/stageZoom` has to agree with it exactly and reading `--ui-scale` back
 * out of the stylesheet would race the frame this module writes it on.
 */
export function currentStageLayout(): StageLayout {
  const { width, height } = layoutViewportSize();
  return computeStageLayout(width, height, coarsePointer());
}

export function initStageScale(): void {
  const root = document.documentElement;
  let frame: number | null = null;
  let lastScale = -1;
  let lastRotated: boolean | null = null;

  const update = (): void => {
    frame = null;
    const { scale, rotated } = currentStageLayout();
    // Only touch the DOM on a real change: resize fires in bursts (URL bar,
    // rotation, keyboard) and every write here invalidates a 1920x1080 layer.
    if (rotated !== lastRotated) {
      root.classList.toggle("stage-rotated", rotated);
      lastRotated = rotated;
    }
    const rounded = Number(scale.toFixed(4));
    if (rounded !== lastScale) {
      root.style.setProperty("--ui-scale", rounded.toFixed(4));
      lastScale = rounded;
    }
  };

  /** Coalesce resize bursts into at most one layout write per frame. */
  const schedule = (): void => {
    if (frame === null) {
      frame = requestAnimationFrame(update);
    }
  };

  update();
  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", schedule);
}

type OrientationLockable = ScreenOrientation & {
  lock?: (orientation: "landscape") => Promise<void>;
};

/**
 * Best-effort native landscape (Android Chrome needs fullscreen for the
 * orientation lock; iOS Safari supports neither). Failures are fine: the
 * CSS stage rotation covers every platform the lock cannot.
 * Must be called from a user gesture.
 */
export async function tryLockLandscape(): Promise<void> {
  if (!coarsePointer()) {
    return;
  }
  try {
    await document.documentElement.requestFullscreen();
  } catch {
    // Fullscreen denied or unsupported; rotation fallback covers it.
  }
  const orientation = screen.orientation as OrientationLockable;
  if (orientation.lock) {
    try {
      await orientation.lock("landscape");
    } catch {
      // Lock unsupported or rejected; rotation fallback covers it.
    }
  }
}
