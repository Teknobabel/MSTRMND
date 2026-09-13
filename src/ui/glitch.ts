/**
 * The corruption the viewscreen suffers on its own.
 *
 * Occasional short bursts of digital rot across the map — torn scanlines, macroblocks that
 * decode wrong, rows of dropped data. Vibes only. This module is the sibling of
 * `map/ambientTraffic` and shares its one hard rule: nothing here reads game state, ever.
 *
 * That rule is not tidiness, it is the whole design. Glitch frequency is exactly the kind of
 * thing a player will read as a signal — if the screen tore more often when the heat was on,
 * that would be a threat readout, and a rather good one. It would also be a readout nobody
 * authored, driven by a hash of the clock, telling the player something the rules never agreed
 * to say. So the schedule is a function of `timeSeconds` and of nothing else, and a run that is
 * going badly corrupts at precisely the same rate as a run that is going well.
 *
 * Pure, for the same reasons as the traffic: ask what is corrupting at time `t` and the same
 * answer comes back every time. There is no burst bookkeeping to drift, nothing to reset when
 * the panel is rebuilt, and the schedule is testable without a DOM.
 */

/**
 * How many bursts can be in flight at once, and how far apart they run.
 *
 * Two slots rather than one, and the reason is the gaps and not the density. A single slot on a
 * fixed-ish cycle paces itself: the eye picks up the rhythm within a minute and starts
 * expecting the next one, which is the opposite of what an intermittent fault should feel like.
 * Two slots offset against each other sometimes land bursts a second apart and sometimes leave
 * the screen clean for the better part of a minute, and neither is a special case in the code.
 *
 * Both slots are quiet the overwhelming majority of the time — see `BURST_MAX_SECONDS`. The
 * duty cycle here is well under one percent, which is the point: this is a fault, not a filter.
 */
const BURST_SLOTS = 2;
const SLOT_CYCLE_SECONDS = 15;
const SLOT_CYCLE_SPREAD = 21;

/**
 * How long one burst lasts.
 *
 * Short, and shorter than feels right when you are reading the number rather than watching the
 * screen. The first pass ran 0.4–0.9s and read as a rendering bug every single time, because
 * corruption you have time to focus on is corruption you have time to evaluate. Under a quarter
 * of a second it registers in peripheral vision and is gone before the eye can settle on it,
 * which is what makes it atmosphere instead of a defect report.
 */
const BURST_MIN_SECONDS = 0.09;
const BURST_MAX_SECONDS = 0.26;

/**
 * How many discrete states a burst steps through before it ends.
 *
 * The single most important constant in the file, and the one that decides whether this reads
 * as digital or analog. Interpolating a shard's position across the burst gives a smooth slide,
 * and a smooth slide is a CRT problem — vertical hold, tube geometry, something physical and
 * continuous. Data does not do that. A corrupt frame is wrong, the next frame is wrong
 * *differently*, and nothing travels between the two.
 *
 * So progress is quantized into a handful of steps and every shard is re-rolled from scratch on
 * each one, with nothing carried across. Costs nothing — it also means the renderer touches the
 * DOM a few times per burst instead of once per frame — and it is the difference between a
 * corrupted signal and a wobbly picture.
 */
const MIN_STEPS = 3;
const MAX_STEPS = 6;

/**
 * The grid macroblocks snap to.
 *
 * Free-floating rectangles read as smoke, haze, damage — anything but data. The same rectangles
 * snapped to a coarse grid read immediately as a codec dropping blocks, because that is the one
 * place a person has ever seen axis-aligned squares of wrong pixels. Sixteen cells across is
 * coarse enough to be legible as a grid at a glance without being coarse enough to look like a
 * deliberate pattern.
 */
const GRID = 16;

/**
 * The rows a full-width shard can sit on.
 *
 * Finer than the macroblock grid, and separate from it on purpose. A tear follows a scanline,
 * and scanlines are thin — pinning tears to sixteenths would land them on the same few rows as
 * the blocks and make the two kinds look like one effect with a width setting.
 */
const ROWS = 64;

/** The pool the renderer preallocates, so a frame can never ask it to build DOM. */
export const MAX_SHARDS = 10;

/**
 * What a shard does to the pixels under it.
 *
 * The first three read the real picture behind them and corrupt it, which is why they land as
 * corruption at all: an opaque rectangle painted over the map is a rectangle, but the same
 * rectangle showing the map's own coastlines with the channels swapped is the map going wrong.
 *
 * - `invert` — the backdrop inverted. The hardest, most obviously-wrong of the three.
 * - `hue`    — the backdrop's channels rotated. Wrong colour, intact detail; the codec look.
 * - `static` — the backdrop crushed to high contrast under noise. Data that decoded to garbage.
 * - `flat`   — no backdrop at all, just a dead bar. A row the signal never delivered.
 */
export type ShardMode = "invert" | "hue" | "static" | "flat";

/** What kind of fault a burst is. One character per burst, so a burst reads as one event. */
export type BurstKind = "tear" | "blocks" | "dropout";

export interface GlitchShard {
  /** Left edge and top edge, 0..1 of the layer. `v` runs downward, as CSS consumes it. */
  readonly u: number;
  readonly v: number;
  /** Width and height in the same units. */
  readonly w: number;
  readonly h: number;
  readonly mode: ShardMode;
  /**
   * How far the shard's corruption is pushed sideways, in layer widths and small — a couple of
   * percent. Not a displacement of the picture (nothing here can move real pixels); it offsets
   * the shard's own noise and drives the width of its chroma fringe, so a tear looks like it
   * was pulled rather than merely recoloured.
   */
  readonly shiftU: number;
  /** 0..1. Varied per shard so a burst is not a uniform stamp. */
  readonly alpha: number;
}

export interface GlitchFrame {
  readonly shards: readonly GlitchShard[];
  /** 0..1 global channel separation, strongest on the kinds that are meant to look lossy. */
  readonly chroma: number;
  /**
   * A monotonic id for the quantized state this frame belongs to, or `-1` when the screen is
   * clean. The renderer keys off this: equal ids mean an identical frame, so it can skip the
   * write entirely. That is what keeps a burst to a few DOM touches and the quiet to none.
   */
  readonly step: number;
}

/** A clean screen. Exported so the renderer has a name for "nothing to draw" rather than a literal. */
export const CLEAN: GlitchFrame = { shards: [], chroma: 0, step: -1 };

/**
 * A deterministic number in [0, 1) from two integers.
 *
 * Lifted from `map/ambientTraffic`, and not cryptographic. All it owes us is that neighbouring
 * inputs land far apart, which matters more here than it does for the traffic: consecutive
 * steps of one burst differ only in the step index, and a hash that smeared those together
 * would re-roll every shard to almost where it already was — reintroducing by accident exactly
 * the smooth travel that `MIN_STEPS` exists to prevent.
 */
function hash(a: number, b: number): number {
  let h = Math.imul(a, 374761393) + Math.imul(b, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A stream of draws for one (slot, burst, step), so shards inside a step differ from each other. */
function draw(slot: number, burst: number, step: number, k: number): number {
  return hash(slot * 8191 + k * 131 + 17, burst * 64 + step);
}

/**
 * Fold one active slot's state into a frame id. See `GlitchFrame.step` for what it is for.
 *
 * Sequential and order-dependent, and both matter. The first attempt at this was a plain
 * arithmetic fold, which turned out to collide in a structured way: slot 0 at state `2n` and
 * slot 1 at state `n` produced the same id, because the slots' contributions were scaled by
 * their index and nothing else. An id collision means the renderer skips a write it needed to
 * make and holds a stale burst on screen. That particular collision was unreachable in practice
 * — a clean frame resets the renderer between any two bursts — but "unreachable because of a
 * property two files away" is not a thing to leave in a cache key.
 *
 * Mixing `slot` into the state keeps two slots in the same state distinct, and mixing into the
 * accumulator rather than combining with XOR keeps slots swapping states distinct. What remains
 * is an ordinary 32-bit hash collision, which is both negligible and unstructured.
 */
function mixStep(id: number, slot: number, state: number): number {
  return Math.imul((id ^ (slot * 1000003 + state + 1)) >>> 0, 2654435761) >>> 0;
}

/**
 * A row for a full-width shard of height `h`, snapped to `ROWS` and guaranteed to fit.
 *
 * The fitting is the point. Choosing a row across the whole range and then living with the
 * overhang lets the layer's `overflow: hidden` decide the shape, which quietly does two things
 * the schedule did not authorize: the shard is no longer the height it rolled, and the bottom
 * edge of the map collects a run of half-height bars that the rest of the picture never sees.
 * Picking from the rows that actually fit keeps the snap and removes both.
 */
function rowFor(roll: number, h: number): number {
  const fits = Math.floor((1 - h) * ROWS);
  return Math.floor(roll * (fits + 1)) / ROWS;
}

/**
 * Which burst a slot is on and how far into it we are, or `null` while the slot rests.
 *
 * The offset is what staggers the slots. Without it both open their first burst at t = 0 and the
 * screen greets every new run by falling apart, which is a memorable first impression and the
 * wrong one.
 */
function slotBurst(
  slot: number,
  timeSeconds: number,
): { readonly burst: number; readonly progress: number } | null {
  const cycle = SLOT_CYCLE_SECONDS + hash(slot, 1) * SLOT_CYCLE_SPREAD;
  const elapsed = timeSeconds + hash(slot, 2) * cycle;
  const burst = Math.floor(elapsed / cycle);
  const into = (elapsed / cycle - burst) * cycle;
  const duration =
    BURST_MIN_SECONDS + hash(slot, burst * 4 + 3) * (BURST_MAX_SECONDS - BURST_MIN_SECONDS);
  return into < duration ? { burst, progress: into / duration } : null;
}

/** Full-width torn rows: the picture ripped along a scanline and dragged sideways. */
function tearShards(
  slot: number,
  burst: number,
  step: number,
  intensity: number,
  out: GlitchShard[],
): void {
  const count = 1 + Math.floor(draw(slot, burst, step, 0) * 3);
  for (let i = 0; i < count; i += 1) {
    const h = 0.008 + draw(slot, burst, step, i * 5 + 2) * 0.03;
    out.push({
      u: 0,
      w: 1,
      v: rowFor(draw(slot, burst, step, i * 5 + 1), h),
      h,
      mode: draw(slot, burst, step, i * 5 + 3) < 0.5 ? "invert" : "hue",
      shiftU: (draw(slot, burst, step, i * 5 + 4) - 0.5) * 0.09,
      alpha: 0.5 + intensity * 0.5,
    });
  }
}

/** Macroblocks that decoded wrong. Grid-snapped; see `GRID`. */
function blockShards(
  slot: number,
  burst: number,
  step: number,
  intensity: number,
  out: GlitchShard[],
): void {
  const count = 3 + Math.floor(draw(slot, burst, step, 0) * 4);
  for (let i = 0; i < count; i += 1) {
    const cellsW = 1 + Math.floor(draw(slot, burst, step, i * 6 + 1) * 3);
    const cellsH = 1 + Math.floor(draw(slot, burst, step, i * 6 + 2) * 2);
    const cellX = Math.floor(draw(slot, burst, step, i * 6 + 3) * (GRID - cellsW + 1));
    const cellY = Math.floor(draw(slot, burst, step, i * 6 + 4) * (GRID - cellsH + 1));
    out.push({
      u: cellX / GRID,
      v: cellY / GRID,
      w: cellsW / GRID,
      h: cellsH / GRID,
      mode: draw(slot, burst, step, i * 6 + 5) < 0.6 ? "hue" : "static",
      shiftU: (draw(slot, burst, step, i * 6 + 6) - 0.5) * 0.04,
      alpha: 0.35 + intensity * 0.4,
    });
  }
}

/** Thin dead bars: rows the signal simply never delivered. */
function dropoutShards(
  slot: number,
  burst: number,
  step: number,
  intensity: number,
  out: GlitchShard[],
): void {
  const count = 2 + Math.floor(draw(slot, burst, step, 0) * 4);
  for (let i = 0; i < count; i += 1) {
    const h = 0.004 + draw(slot, burst, step, i * 4 + 2) * 0.012;
    out.push({
      u: 0,
      w: 1,
      v: rowFor(draw(slot, burst, step, i * 4 + 1), h),
      h,
      mode: "flat",
      shiftU: 0,
      alpha: 0.45 + intensity * 0.45,
    });
  }
}

/**
 * Everything corrupting at this moment. A clean screen is the overwhelmingly common answer and
 * is in no way a special case — both slots resting is the resting state of the whole system.
 *
 * @param timeSeconds Seconds since the map opened; the same clock the shaders and the traffic run on.
 */
export function glitchFrame(timeSeconds: number): GlitchFrame {
  const shards: GlitchShard[] = [];
  let chroma = 0;
  /* Folds every active slot's (burst, step) into one id — distinct per state and stable for its
   * duration, which is all the renderer's skip check needs of it. Always non-negative, so it can
   * never be mistaken for `CLEAN`'s -1. */
  let id = 0;

  for (let slot = 0; slot < BURST_SLOTS; slot += 1) {
    const active = slotBurst(slot, timeSeconds);
    if (active === null) {
      continue;
    }
    const { burst, progress } = active;

    /* Kind and intensity are rolled per burst, not per step. Re-rolling the kind on every step
     * would make one fault flicker between three characters and read as generalized noise;
     * holding it means a burst is a tear, or is blocks, and the player can tell them apart. */
    const kindRoll = hash(slot, burst * 4 + 5);
    const kind: BurstKind = kindRoll < 0.4 ? "tear" : kindRoll < 0.78 ? "blocks" : "dropout";
    const intensity = 0.55 + hash(slot, burst * 4 + 6) * 0.45;

    const steps = MIN_STEPS + Math.floor(hash(slot, burst * 4 + 7) * (MAX_STEPS - MIN_STEPS + 1));
    const current = Math.min(Math.floor(progress * steps), steps - 1);

    id = mixStep(id, slot, burst * MAX_STEPS + current);

    if (kind === "tear") {
      tearShards(slot, burst, current, intensity, shards);
      chroma = Math.max(chroma, intensity * 0.6);
    } else if (kind === "blocks") {
      blockShards(slot, burst, current, intensity, shards);
      chroma = Math.max(chroma, intensity * 0.3);
    } else {
      dropoutShards(slot, burst, current, intensity, shards);
      chroma = Math.max(chroma, intensity);
    }
  }

  if (shards.length === 0) {
    return CLEAN;
  }
  /* Both slots bursting at once can overrun the renderer's pool. Truncating is the right
   * failure: a burst is already more shards than the eye resolves in a tenth of a second, and
   * the alternative — growing the pool at frame time — puts DOM construction inside the one
   * code path that must never do any. */
  return { shards: shards.slice(0, MAX_SHARDS), chroma, step: id };
}
