import { CLEAN, MAX_SHARDS, glitchFrame, type GlitchFrame } from "./glitch";

/**
 * Puts `glitch`'s schedule on the screen.
 *
 * The whole DOM side of the effect, and deliberately the dumb half: every decision about what
 * corrupts and when lives in `glitch.ts`, which knows nothing about elements. This knows
 * nothing about time beyond the number it is handed.
 *
 * Two rules shape the implementation, both of them about staying out of the player's way:
 *
 * 1. **The pool is built once and never grows.** `MAX_SHARDS` elements are created at mount and
 *    reused forever. A burst lasts a tenth of a second; appending and dropping ten elements at
 *    that rate would put style recalculation and layout into the middle of whatever the player
 *    is doing, which is the one cost this effect cannot justify.
 *
 * 2. **A frame that looks identical writes nothing.** The schedule quantizes a burst into a few
 *    discrete steps and stamps each with an id, so the common case — a clean screen, or a step
 *    already applied — is one integer comparison and an early return. Between bursts this costs
 *    literally nothing per frame, which is what earns it a place in the shared render loop.
 */
export interface GlitchDirector {
  /** Apply the schedule for this moment. Cheap; safe to call every frame. */
  frame(timeSeconds: number): void;
  /**
   * Take the corruption off the screen now.
   *
   * For the callers that stop driving the layer — a hidden panel, a run with no map art. A
   * burst that was live at the moment the frames stopped would otherwise stay on screen as a
   * permanent inverted bar, which is the one way this effect can look like a bug rather than
   * like weather. Idempotent, so calling it on every frame of an early return costs an integer
   * comparison.
   */
  clear(): void;
  /** Clear the screen and let go of the pool. */
  dispose(): void;
}

/**
 * Mount the glitch layer into `host`.
 *
 * `host` wants to be a positioned box that the corruption should cover, and one that nothing
 * else tears down — the layer is built once and the caller keeps the handle. In this shell that
 * is the floating body rather than `#map-panel`, for the reason the Map Layers markup already
 * records: everything inside the map panel is rebuilt by `renderMapPanel` on every state
 * change, and a pool that got discarded mid-burst would strand shards on screen.
 */
export function createGlitchDirector(host: HTMLElement): GlitchDirector {
  const layer = document.createElement("div");
  layer.className = "glitch-layer";
  layer.setAttribute("aria-hidden", "true");

  const pool: HTMLElement[] = [];
  for (let i = 0; i < MAX_SHARDS; i += 1) {
    const shard = document.createElement("div");
    shard.className = "glitch-shard";
    shard.hidden = true;
    layer.appendChild(shard);
    pool.push(shard);
  }
  host.appendChild(layer);

  /**
   * The step id last written, so an unchanged frame can return before touching anything.
   *
   * Seeded to the clean id rather than to something impossible: at mount the pool really is
   * hidden and the screen really is clean, so the first quiet frame has nothing to do and
   * should be allowed to say so.
   */
  let applied = -1;
  /** How many shards are currently visible, so the hide loop only walks the ones that are. */
  let shown = 0;

  function apply(next: GlitchFrame): void {
    if (next.step === applied) {
      return;
    }
    applied = next.step;

    const { shards, chroma } = next;
    for (let i = 0; i < shards.length; i += 1) {
      const shard = shards[i]!;
      const el = pool[i]!;
      /* Percentages rather than pixels throughout: the host is inside the scaled stage, so a
       * pixel here is not a device pixel and the layer must not care how large it has been
       * drawn. Fixed precision keeps these strings stable, which matters only because an
       * identical string assignment is the cheapest thing the style system can be asked to do. */
      el.style.setProperty("--gs-u", `${(shard.u * 100).toFixed(3)}%`);
      el.style.setProperty("--gs-v", `${(shard.v * 100).toFixed(3)}%`);
      el.style.setProperty("--gs-w", `${(shard.w * 100).toFixed(3)}%`);
      el.style.setProperty("--gs-h", `${(shard.h * 100).toFixed(3)}%`);
      el.style.setProperty("--gs-shift", `${(shard.shiftU * 100).toFixed(3)}%`);
      el.style.setProperty("--gs-alpha", shard.alpha.toFixed(3));
      /* Drives the chroma fringe width in the stylesheet. Scaled by the shard's own shift so a
       * tear that was dragged hard fringes hard, and a block that barely moved barely does. */
      el.style.setProperty(
        "--gs-chroma",
        `${(chroma * (1.2 + Math.abs(shard.shiftU) * 18)).toFixed(2)}px`,
      );
      el.dataset.mode = shard.mode;
      el.hidden = false;
    }
    for (let i = shards.length; i < shown; i += 1) {
      pool[i]!.hidden = true;
    }
    shown = shards.length;
  }

  function frame(timeSeconds: number): void {
    apply(glitchFrame(timeSeconds));
  }

  function clear(): void {
    apply(CLEAN);
  }

  function dispose(): void {
    layer.remove();
    pool.length = 0;
    shown = 0;
    applied = -1;
  }

  return { frame, clear, dispose };
}
