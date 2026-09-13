/**
 * What the status bar does when a number changes under it.
 *
 * The counterpart to `map/siteSignals`: that module is the seam through which play reaches the
 * map, and this is the seam through which play reaches the readouts. Same reason for existing —
 * the rules that decide *when* a readout animates belong in one testable place, and the DOM
 * side should know nothing about `GameState`.
 *
 * Note the deliberate difference from `glitch` and `map/ambientTraffic`, which are forbidden
 * from reading game state at all. The rule there is that an unauthored signal — corruption that
 * tracked the heat — would tell the player something the rules never agreed to say. Nothing
 * here invents a signal: every number that rolls is a number already printed on screen, and the
 * motion restates the change rather than reporting anything new. That is what makes reading
 * state legitimate in this module and illegitimate in those.
 *
 * Pure, and a function of its arguments only. No clock, no elements, no bookkeeping — the
 * caller owns the frame loop and hands progress in.
 */

/** Which way a readout moved. Gains and losses are styled differently, not just timed. */
export type StatDirection = "up" | "down";

export interface StatChange {
  /** The readout's stable id — `command`, `heat`, and so on. */
  readonly key: string;
  readonly from: number;
  readonly to: number;
  readonly direction: StatDirection;
}

/**
 * How long a roll runs, in seconds.
 *
 * Scaled by distance, because a roll is only legible if the eye can follow it: 6 → 5 flicking
 * through one step wants to be over almost immediately, while 0 → 40 needs long enough to read
 * as counting rather than as a glitch. Both ends are clamped, and the ceiling is the important
 * one — the status bar sits above a turn report the player is trying to read, and a readout
 * still counting when they have moved on is the readout interrupting them.
 */
const ROLL_MIN_SECONDS = 0.18;
const ROLL_MAX_SECONDS = 0.62;
const ROLL_SECONDS_PER_UNIT = 0.035;

export function rollDurationSeconds(from: number, to: number): number {
  const distance = Math.abs(to - from);
  if (distance === 0) {
    return 0;
  }
  return Math.min(ROLL_MAX_SECONDS, ROLL_MIN_SECONDS + distance * ROLL_SECONDS_PER_UNIT);
}

/**
 * The integer to print partway through a roll.
 *
 * Eased out rather than linear: a linear count reads as a mechanical odometer, and the thing
 * being reported is a consequence landing, which should arrive fast and settle. The ease also
 * means most of the distance is covered in the first third, so a player who glances away and
 * back sees roughly the right number rather than one still climbing from the old one.
 *
 * Rounded *toward* the destination, which is what keeps the count honest at both ends. Rounding
 * to nearest lets a rising roll print `to` several frames early and then sit there, so the last
 * third of the animation shows a number that is already final — the motion continues after the
 * information has stopped, which is the exact thing that reads as decorative. Flooring a rise
 * and ceiling a fall means every frame shows a value the roll has genuinely reached.
 */
export function rolledValue(from: number, to: number, progress: number): number {
  if (!Number.isFinite(progress) || progress <= 0) {
    return from;
  }
  if (progress >= 1) {
    return to;
  }
  const eased = 1 - (1 - progress) ** 3;
  const raw = from + (to - from) * eased;
  return to > from ? Math.floor(raw) : Math.ceil(raw);
}

/**
 * Which readouts moved between two renders.
 *
 * A key absent from `prev` is not a change and is not reported. That is the first render of a
 * run, where every number would otherwise roll up from nothing at once — six readouts counting
 * simultaneously the moment the map appears, which reads as a loading screen rather than as
 * anything happening. A run opens with its numbers simply true.
 */
export function diffReadouts(
  prev: ReadonlyMap<string, number>,
  next: ReadonlyMap<string, number>,
): StatChange[] {
  const out: StatChange[] = [];
  for (const [key, to] of next) {
    const from = prev.get(key);
    if (from === undefined || from === to || !Number.isFinite(from) || !Number.isFinite(to)) {
      continue;
    }
    out.push({ key, from, to, direction: to > from ? "up" : "down" });
  }
  return out;
}

/**
 * Heat as a 0..1 pressure, for the readout that breathes rather than flashes.
 *
 * Heat is authored on a 0–100 scale (`WantedLevelTier.minHeat` spans it), so this is that scale
 * and not a normalization against whatever the run has happened to reach — a pressure that
 * rescaled itself as the run got worse would show the same intensity at heat 20 on turn 2 as at
 * heat 80 on turn 20, which is precisely backwards.
 */
export const HEAT_SCALE_MAX = 100;

export function heatPressure(heat: number): number {
  if (!Number.isFinite(heat) || heat <= 0) {
    return 0;
  }
  return heat >= HEAT_SCALE_MAX ? 1 : heat / HEAT_SCALE_MAX;
}
