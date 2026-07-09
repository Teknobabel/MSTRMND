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
 */
export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;

function coarsePointer(): boolean {
  return window.matchMedia("(pointer: coarse)").matches;
}

export function initStageScale(): void {
  const update = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const rotated = coarsePointer() && h > w;
    const availW = rotated ? h : w;
    const availH = rotated ? w : h;
    const scale = Math.min(availW / STAGE_WIDTH, availH / STAGE_HEIGHT);
    const root = document.documentElement;
    root.classList.toggle("stage-rotated", rotated);
    root.style.setProperty("--ui-scale", scale.toFixed(4));
  };
  update();
  window.addEventListener("resize", update);
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
