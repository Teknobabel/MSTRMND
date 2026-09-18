/**
 * Map parallax: the world map slides away from the pointer.
 *
 * Move the mouse right and the map drifts left, by a fraction of how far off centre the pointer
 * is. It is the trick Destiny's menus use, and it is not decoration — it is **reach**. A site pin
 * near the right edge of the plot is a long way from a pointer resting in the middle; with the
 * map sliding the other way, the pin comes to meet the cursor and the hand travels
 * {@link MAP_PARALLAX_REACH} of the panel less to get there, at each edge, on each axis. The
 * depth read is the side effect, not the point.
 *
 * **Only the map moves.** Not the shell, not the status bar, not the planner, not the drawer
 * cabinet — the console's furniture is what everything else on the dashboard is docked against,
 * and a frame that breathed with the pointer would unmoor the whole layout. That is the same
 * rule `.map-panel--receded` already plays by: *it is the plot that moves, never the panel.*
 * This goes one level out from that — `#map-panel`, the content area inside the framed
 * `.game-panel--map` — so the frame, its corner brackets and its border stay nailed down.
 *
 * **The mapping is from pointer *position*, never from movement.** A shift accumulated from
 * deltas would drift: the same pointer position would mean a different offset depending on how it
 * was arrived at, and the map would wander over a long session. Position in, offset out — hold
 * the pointer still and the map is still. That also rules out the feedback loop this effect is
 * most exposed to, because what the pointer is measured against is the panel's box **at rest**
 * ({@link mapPanelRestBox}) rather than where the panel has been slid to. Measuring against the
 * moved box would put the neutral point inside a quantity that depends on the neutral point.
 *
 * **Why it can slide at all.** A rectangle that exactly fills its panel cannot move without
 * showing what is behind it, so the content is drawn {@link mapParallaxOverscan} larger than the
 * panel and slides within that margin; `#map-panel` already clips (`overflow: hidden`), so the
 * overhang is simply never seen. Everything that filled the panel still fills it — the dimming
 * veil included — and the cost is that the map is zoomed by that much, which is about five
 * percent. The pins ride the same transform as the canvas, so nothing comes unglued from the
 * land, and the map's authored markers sit between 11% and 83% of the plot, nowhere near close
 * enough to the edge for the crop to reach them.
 *
 * **When it holds still.** A coarse pointer has no cursor to answer and a portrait phone rotates
 * the whole stage, so touch is out. `prefers-reduced-motion` is out. So is a drag — a drop target
 * that slides while it is being aimed at is a drop target that gets missed, and this UI is built
 * on dragging cards onto the map. So is the boot sequence, which is choreography that has already
 * decided where the map is. In each case the target falls to centre and the map *eases* back
 * rather than snapping, because a snap is the one motion this effect must never make.
 */

/** An offset, as a fraction of the map panel's own width and height. */
export interface MapParallaxOffset {
  readonly x: number;
  readonly y: number;
}

export const MAP_PARALLAX_REST: MapParallaxOffset = { x: 0, y: 0 };

/**
 * How far the map slides at each edge, as a fraction of the panel.
 *
 * A fraction rather than pixels because everything downstream wants it that way: the CSS
 * translate is a percentage of the element's own box, the overscan that pays for it is derived
 * from this one number, and the stage scale then cancels out of both. On the shipped layout the
 * plot is around 1071 stage px wide, so this is roughly 27px of reach horizontally and 21
 * vertically — and it stays that proportion at every window size.
 */
export const MAP_PARALLAX_REACH = 0.015;

/**
 * A sliver of overhang beyond what the arithmetic strictly demands.
 *
 * Solved exactly, the margin and the slide are *equal* at full tilt — the map lands flush with
 * the frame and there is nothing left over. Measured in a browser it does land flush, but with
 * zero tolerance: the panel's box is fractional, the translate is written as a rounded
 * percentage, and a scaled layer is rasterised on whole device pixels, so any of the three
 * rounding the wrong way puts a hairline of empty panel along one edge. Five percent of the
 * reach is a couple of pixels of slack for a couple of thousandths more zoom.
 */
const OVERSCAN_SAFETY = 1.05;

/**
 * How much bigger than its panel the map has to be drawn so the slide never exposes the panel
 * behind it.
 *
 * Scaling by `s` about the centre leaves `(s - 1) / 2` of overhang on each side, and a slide of
 * `reach` in the element's own units lands `reach * s` across on screen. Covering one with the
 * other is `s >= 1 / (1 - 2 * reach)` — which is where the number comes from rather than being
 * chosen, so raising the reach can never quietly outrun the margin paying for it.
 */
export function mapParallaxOverscan(reach: number = MAP_PARALLAX_REACH): number {
  const r = Math.max(0, reach) * OVERSCAN_SAFETY;
  return r >= 0.5 ? 1 : 1 / (1 - 2 * r);
}

/**
 * The follow time constant: how long the map takes to cover ~63% of the distance to where the
 * pointer says it should be.
 *
 * Short enough that the map is under the cursor rather than chasing it, long enough that a flick
 * of the wrist does not snap it. It also sets how long the glide outlasts the hand, which is what
 * keeps this clear of the tooltips: those wait a full second of stillness before showing and are
 * positioned from a live rect, so the map has finished moving many times over by then.
 */
export const MAP_PARALLAX_FOLLOW_MS = 200;

/**
 * Below this — a fraction of the panel, so about a fifth of a pixel on the shipped layout — the
 * map is at its target and the frame loop can stop.
 */
export const MAP_PARALLAX_SETTLE = 0.0002;

function clampUnit(n: number): number {
  return Math.min(1, Math.max(-1, n));
}

/**
 * `-0` back to `0`. Negating a centred pointer's zero mints one, and while `-0%` and `0%` paint
 * identically, an offset that compares equal to rest but does not *read* as rest is a thing to
 * trip over in every later comparison.
 */
function zeroed(n: number): number {
  return n === 0 ? 0 : n;
}

/** Where the panel sits and how big it is, with the slide taken back out. */
export interface MapPanelBox {
  readonly centerX: number;
  readonly centerY: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Recover the panel's box **at rest** from a rect measured while it was slid.
 *
 * This is what keeps the effect off its own tail. The pointer has to be measured against a fixed
 * neutral point; measure it against the panel where the slide has put it and the neutral point
 * becomes a function of the offset, which is a function of the neutral point. So the transform is
 * inverted instead, which it can be exactly: it is a scale about the centre and a translate in
 * the element's own units, so the measured rect is `overscan` times the resting size, and the
 * measured centre is the resting centre plus `offset * measured size` — the overscan cancelling
 * out of the shift entirely.
 */
export function mapPanelRestBox(
  rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  offset: MapParallaxOffset,
  overscan: number,
): MapPanelBox {
  const s = overscan > 0 ? overscan : 1;
  return {
    centerX: rect.x + rect.width / 2 - offset.x * rect.width,
    centerY: rect.y + rect.height / 2 - offset.y * rect.height,
    width: rect.width / s,
    height: rect.height / s,
  };
}

/**
 * Where the map should sit for a pointer at `pointer`, as a fraction of the panel.
 *
 * Clamped, so a pointer out over the planner or the drawer cabinet does not push the map further
 * than its own edge would. Negated, because the map goes the other way from the hand: that is the
 * reach.
 */
export function mapParallaxTarget(
  pointer: { readonly x: number; readonly y: number },
  box: MapPanelBox,
  reach: number = MAP_PARALLAX_REACH,
): MapParallaxOffset {
  if (!(box.width > 0) || !(box.height > 0)) {
    return MAP_PARALLAX_REST;
  }
  const nx = clampUnit((pointer.x - box.centerX) / (box.width / 2));
  const ny = clampUnit((pointer.y - box.centerY) / (box.height / 2));
  return { x: zeroed(-nx * reach), y: zeroed(-ny * reach) };
}

/**
 * One frame of easing toward `target`.
 *
 * Exponential, and framed on elapsed time rather than on a per-frame fraction, so the map settles
 * at the same rate on a 144Hz monitor as on a 60Hz one and a dropped frame does not leave it
 * behind. A `dt` at or below zero — two callbacks in one millisecond, a clock that went backwards
 * — is a frame with nothing to integrate, not a reason to jump.
 */
export function mapParallaxStep(
  current: MapParallaxOffset,
  target: MapParallaxOffset,
  dtMs: number,
  tauMs: number = MAP_PARALLAX_FOLLOW_MS,
): MapParallaxOffset {
  if (!(dtMs > 0) || !Number.isFinite(dtMs)) {
    return current;
  }
  if (!(tauMs > 0)) {
    return target;
  }
  /* Capped at a quarter second of catch-up: a tab that was backgrounded hands back a `dt` of
   * minutes, and the map should resume from where it was rather than teleport. */
  const k = 1 - Math.exp(-Math.min(dtMs, 250) / tauMs);
  return {
    x: current.x + (target.x - current.x) * k,
    y: current.y + (target.y - current.y) * k,
  };
}

/** Whether the map has arrived, to well under the nearest pixel. */
export function mapParallaxSettled(
  current: MapParallaxOffset,
  target: MapParallaxOffset,
  epsilon: number = MAP_PARALLAX_SETTLE,
): boolean {
  return Math.abs(current.x - target.x) <= epsilon && Math.abs(current.y - target.y) <= epsilon;
}

export interface MapParallaxApi {
  /**
   * Where the map is sitting right now, as a fraction of the panel.
   *
   * For the one calculation in the app that reads a cached `getBoundingClientRect` of something
   * inside the panel (`mapPlotRect` in `main.ts`, for the map's own lean toward the pointer) and
   * so has to be told the map has moved since. Everything else is hit-tested by the browser
   * against live geometry and needs nothing.
   */
  offset(): MapParallaxOffset;
  /** Re-measure the panel — the game screen has just been revealed, or the window changed. */
  remeasure(): void;
  /** Send the map back to centre and stop tracking. */
  stop(): void;
}

export interface MapParallaxOptions {
  /** `#map-panel`: the content area inside the framed map panel, which already clips. */
  readonly panel: HTMLElement;
  /**
   * Whether the player wants the effect, read per frame rather than captured — the same "read at
   * the point of use" the rest of `ui/playerSettings` is consumed by, so the toggle takes effect
   * on the next frame rather than the next run.
   */
  readonly enabled: () => boolean;
  /** Suppress while this is true — a drag, the boot sequence, anything else the caller knows. */
  readonly suppressed?: () => boolean;
  readonly reach?: number;
  readonly followMs?: number;
}

/**
 * Wire the effect up.
 *
 * The frame loop runs **only while the map is moving**: a pointer that stops moving settles it
 * within a few frames and the loop cancels itself, so a player reading a card is not holding a
 * `requestAnimationFrame` open. It is started again by the next pointer move, or by whatever
 * gated the effect off letting go.
 */
export function initMapParallax(options: MapParallaxOptions): MapParallaxApi {
  const {
    panel,
    enabled,
    suppressed: suppressedByCaller = () => false,
    reach = MAP_PARALLAX_REACH,
    followMs = MAP_PARALLAX_FOLLOW_MS,
  } = options;
  const doc = panel.ownerDocument;
  if (doc.defaultView === null) {
    return { offset: () => MAP_PARALLAX_REST, remeasure: () => {}, stop: () => {} };
  }
  /* Re-bound past the null check because the frame loop and the listeners below are reached from
   * hoisted function declarations, which narrowing does not follow into. */
  const view: Window = doc.defaultView;
  const overscan = mapParallaxOverscan(reach);

  const finePointer = view.matchMedia("(pointer: fine)");
  const reducedMotion = view.matchMedia("(prefers-reduced-motion: reduce)");

  let pointer: { x: number; y: number } | null = null;
  let current: MapParallaxOffset = MAP_PARALLAX_REST;
  let box: MapPanelBox | null = null;
  let dragging = false;
  let frame: number | null = null;
  let lastFrameAt = 0;

  /**
   * Measure the panel and take the slide back out of the answer.
   *
   * Once per resize rather than per pointer move: the map's own frame loop writes a transform
   * onto every pin, and a rect read in a move handler would force a synchronous layout against
   * all of them — the same reason `main.ts` caches `mapPlotRect`.
   */
  function remeasure(): void {
    const rect = panel.getBoundingClientRect();
    box = rect.width > 0 && rect.height > 0 ? mapPanelRestBox(rect, current, overscan) : null;
  }

  function suppressed(): boolean {
    return (
      pointer === null ||
      dragging ||
      !enabled() ||
      !finePointer.matches ||
      reducedMotion.matches ||
      suppressedByCaller()
    );
  }

  function targetNow(): MapParallaxOffset {
    if (suppressed() || pointer === null) {
      return MAP_PARALLAX_REST;
    }
    if (box === null) {
      /* Nothing measured yet — the game screen was hidden when this last looked. Try again now
       * that there is a pointer over it; a screen still hidden simply measures zero again. */
      remeasure();
      if (box === null) {
        return MAP_PARALLAX_REST;
      }
    }
    return mapParallaxTarget(pointer, box, reach);
  }

  function write(offset: MapParallaxOffset): void {
    current = offset;
    /* Rounded to a thousandth of the panel — a hair over a pixel's tenth — because handing the
     * compositor a new sub-pixel transform on every frame of a slow drift buys nothing an eye
     * can see. */
    const round = (n: number): string => `${Math.round(n * 100000) / 1000}%`;
    panel.style.setProperty("--map-parallax-x", round(offset.x));
    panel.style.setProperty("--map-parallax-y", round(offset.y));
  }

  /**
   * The overscan is carried only while the effect is switched on, so a player who turns it off
   * gets their un-zoomed map back rather than a permanently cropped one.
   */
  function syncOverscan(): void {
    const wanted = enabled() && finePointer.matches && !reducedMotion.matches;
    panel.style.setProperty("--map-parallax-scale", wanted ? String(overscan) : "1");
  }

  function tick(now: number): void {
    frame = null;
    const dt = lastFrameAt === 0 ? followMs : now - lastFrameAt;
    lastFrameAt = now;
    syncOverscan();
    const target = targetNow();
    write(mapParallaxStep(current, target, dt, followMs));
    if (mapParallaxSettled(current, target)) {
      /* Land exactly on it, so a map meant to be at rest is at rest rather than a thousandth of
       * a panel off it for the rest of the session. */
      if (current.x !== target.x || current.y !== target.y) {
        write(target);
      }
      lastFrameAt = 0;
      return;
    }
    frame = view.requestAnimationFrame(tick);
  }

  function run(): void {
    if (frame === null) {
      lastFrameAt = 0;
      frame = view.requestAnimationFrame(tick);
    }
  }

  function onPointerMove(event: PointerEvent): void {
    /* `pointerType` rather than the media query alone: a hybrid laptop reports a fine pointer and
     * still gets touch events, and a finger should not leave the map leaning where it last
     * tapped. */
    if (event.pointerType === "touch") {
      return;
    }
    pointer = { x: event.clientX, y: event.clientY };
    run();
  }

  function onPointerGone(): void {
    pointer = null;
    run();
  }

  view.addEventListener("pointermove", onPointerMove, { passive: true });
  /* The pointer leaving the window entirely: `relatedTarget` is null only when it has actually
   * gone, rather than moved between two elements. */
  doc.addEventListener("pointerout", (event: PointerEvent) => {
    if (event.relatedTarget === null) {
      onPointerGone();
    }
  });
  view.addEventListener("blur", onPointerGone);
  view.addEventListener("resize", remeasure);

  /*
   * Capture, for the reason `ui/dragFocus` gives: several cards stop `dragstart` from bubbling to
   * keep the drag off the panel behind them, and a listener on the document would never hear
   * those. `drop` as well as `dragend`, because a drag that ends outside the window can deliver
   * one without the other, and a map stuck off-centre would be the visible result.
   */
  doc.addEventListener(
    "dragstart",
    () => {
      dragging = true;
      run();
    },
    { capture: true },
  );
  for (const type of ["dragend", "drop"]) {
    doc.addEventListener(
      type,
      () => {
        dragging = false;
        run();
      },
      { capture: true },
    );
  }

  syncOverscan();
  remeasure();

  return {
    offset: () => current,
    remeasure,
    stop(): void {
      view.removeEventListener("pointermove", onPointerMove);
      view.removeEventListener("blur", onPointerGone);
      view.removeEventListener("resize", remeasure);
      if (frame !== null) {
        view.cancelAnimationFrame(frame);
        frame = null;
      }
      pointer = null;
      write(MAP_PARALLAX_REST);
      panel.style.setProperty("--map-parallax-scale", "1");
    },
  };
}
