import { describe, expect, it } from "vitest";
import { CLEAN, MAX_SHARDS, glitchFrame } from "./glitch";

/**
 * Ten minutes at 60fps.
 *
 * Long and dense deliberately, and for two different reasons. Long, because the slots run on
 * cycles of fifteen to thirty-six seconds offset against each other, so a short window measures
 * the arrangement it happened to open on rather than the schedule. Dense, because a burst lasts
 * a tenth of a second — sampling at anything coarser than a frame steps straight over most of
 * them, and a test that never sees a burst passes every assertion below for the wrong reason.
 */
const STEP = 1 / 60;
const SAMPLES = Array.from({ length: 36000 }, (_, i) => i * STEP);

/** Snapped to a 1/n grid, within the slop of dividing and multiplying by n. */
function onGrid(value: number, n: number): boolean {
  return Math.abs(value * n - Math.round(value * n)) < 1e-9;
}

describe("glitchFrame", () => {
  it("is a pure function of the clock, so nothing has to be reset when the panel rebuilds", () => {
    // The whole reason there is no burst bookkeeping. Asking twice, out of order, has to give
    // the same answer both times, or navigating away and back would restart the corruption.
    for (const t of [0, 3.7, 41.2, 999.5]) {
      expect(glitchFrame(t)).toEqual(glitchFrame(t));
    }
    const late = glitchFrame(88.25);
    glitchFrame(1);
    expect(glitchFrame(88.25)).toEqual(late);
  });

  it("leaves the screen clean the overwhelming majority of the time", () => {
    // The constant this whole effect lives or dies on. A few percent is an intermittent fault;
    // twenty percent is a filter over the map, and the player would stop seeing it inside a
    // minute — which is the failure mode that matters, since an effect nobody notices is
    // costing frames for nothing.
    const corrupt = SAMPLES.filter((t) => glitchFrame(t).shards.length > 0).length;
    const duty = corrupt / SAMPLES.length;
    expect(duty).toBeGreaterThan(0.001);
    expect(duty).toBeLessThan(0.05);
  });

  it("goes quiet for long stretches rather than ticking along at a steady rate", () => {
    // Low duty on its own would also be satisfied by a burst every two seconds like clockwork,
    // which is the pacing two slots exist to avoid. What is actually wanted is silence long
    // enough that the next burst is a surprise.
    let longestGap = 0;
    let gap = 0;
    for (const t of SAMPLES) {
      if (glitchFrame(t).shards.length === 0) {
        gap += STEP;
        longestGap = Math.max(longestGap, gap);
      } else {
        gap = 0;
      }
    }
    expect(longestGap).toBeGreaterThan(8);
  });

  it("never corrupts for long enough to be read as a broken renderer", () => {
    // A burst the player has time to focus on is a burst they have time to evaluate, and they
    // will evaluate it as a bug. Two slots can overlap, so the bound here is looser than one
    // burst — but nothing may ever sit on screen approaching a second.
    let longestRun = 0;
    let run = 0;
    for (const t of SAMPLES) {
      if (glitchFrame(t).shards.length > 0) {
        run += STEP;
        longestRun = Math.max(longestRun, run);
      } else {
        run = 0;
      }
    }
    expect(longestRun).toBeGreaterThan(0.05);
    expect(longestRun).toBeLessThan(0.7);
  });

  it("keeps every shard inside the layer and within the renderer's pool", () => {
    // The pool is preallocated and never grows, so an overrun would silently drop shards at
    // best; and a shard reaching past the layer would be clipped into a shape the schedule
    // never chose. Both are bugs the eye cannot reliably catch at a tenth of a second.
    for (const t of SAMPLES) {
      const { shards, chroma } = glitchFrame(t);
      expect(shards.length).toBeLessThanOrEqual(MAX_SHARDS);
      expect(chroma).toBeGreaterThanOrEqual(0);
      expect(chroma).toBeLessThanOrEqual(1);
      for (const s of shards) {
        expect(s.u).toBeGreaterThanOrEqual(0);
        expect(s.v).toBeGreaterThanOrEqual(0);
        expect(s.w).toBeGreaterThan(0);
        expect(s.h).toBeGreaterThan(0);
        expect(s.u + s.w).toBeLessThanOrEqual(1 + 1e-9);
        expect(s.v + s.h).toBeLessThanOrEqual(1 + 1e-9);
        expect(s.alpha).toBeGreaterThan(0);
        expect(s.alpha).toBeLessThanOrEqual(1);
      }
    }
  });

  it("snaps macroblocks to the grid that makes them read as a codec failing", () => {
    // The one property separating digital corruption from smoke. A block off the grid reads as
    // damage or haze; on the grid it reads as data, because a person has only ever seen
    // axis-aligned squares of wrong pixels in one place. Full-width rows are the tear and
    // dropout kinds and are exempt — they follow a scanline, not a block boundary.
    let blocksSeen = 0;
    let rowsSeen = 0;
    for (const t of SAMPLES) {
      for (const s of glitchFrame(t).shards) {
        if (s.w === 1) {
          // A tear or a dropout: pinned to the finer scanline grid, and — the bug this caught —
          // only ever to a row the shard actually fits on, so `overflow: hidden` never gets to
          // decide its height for it.
          rowsSeen += 1;
          expect(s.u).toBe(0);
          expect(onGrid(s.v, 64)).toBe(true);
          continue;
        }
        blocksSeen += 1;
        expect(onGrid(s.u, 16)).toBe(true);
        expect(onGrid(s.w, 16)).toBe(true);
        expect(onGrid(s.v, 16)).toBe(true);
        expect(onGrid(s.h, 16)).toBe(true);
      }
    }
    expect(blocksSeen).toBeGreaterThan(0);
    expect(rowsSeen).toBeGreaterThan(0);
  });

  it("holds each shard perfectly still within a step, then re-rolls it from scratch", () => {
    // The quantization, which is the whole digital-versus-analog decision. Inside one step the
    // frame must be bit-identical — a shard that crept a fraction of a percent per frame would
    // be the smooth analog slide this is defined against — and between steps it must not
    // resemble its previous state at all.
    const start = SAMPLES.find((t) => glitchFrame(t).shards.length > 0);
    expect(start).toBeDefined();

    const states = new Map<number, string>();
    const order: number[] = [];
    for (let t = start!; glitchFrame(t).shards.length > 0; t += STEP / 4) {
      const frame = glitchFrame(t);
      const shape = JSON.stringify(frame.shards);
      const seen = states.get(frame.step);
      if (seen === undefined) {
        states.set(frame.step, shape);
        order.push(frame.step);
      } else {
        // Same step id, so the renderer will skip the write — the frame had better be identical.
        expect(shape).toBe(seen);
      }
    }

    // A burst is a handful of discrete states, not a continuum. The bound is the schedule's own
    // MIN_STEPS..MAX_STEPS, widened at the top because the sampled burst may have been clipped
    // at either end by a neighbouring slot's overlap.
    expect(order.length).toBeGreaterThanOrEqual(3);
    expect(order.length).toBeLessThanOrEqual(12);
    expect(new Set(order).size).toBe(order.length);
    // Consecutive steps are unrelated, not adjacent.
    for (let i = 1; i < order.length; i += 1) {
      expect(states.get(order[i]!)).not.toBe(states.get(order[i - 1]!));
    }
  });

  it("gives every distinct frame a distinct id, because the renderer skips writes on a match", () => {
    // `step` is a cache key: equal ids mean the director does not touch the DOM. So two frames
    // that look different must never share one, or a burst gets held on screen stale. An
    // earlier arithmetic fold collided in a structured way here — slot 0 at state 2n against
    // slot 1 at state n — which this pins shut.
    const byId = new Map<number, string>();
    for (const t of SAMPLES) {
      const frame = glitchFrame(t);
      if (frame.shards.length === 0) {
        continue;
      }
      expect(frame.step).toBeGreaterThanOrEqual(0);
      const shape = JSON.stringify(frame.shards);
      const seen = byId.get(frame.step);
      if (seen === undefined) {
        byId.set(frame.step, shape);
      } else {
        expect(shape).toBe(seen);
      }
    }
    // And the converse: distinct shapes must not have been folded onto one id.
    expect(new Set(byId.values()).size).toBe(byId.size);
    expect(byId.size).toBeGreaterThan(20);
  });

  it("reports a clean screen as the one state the renderer is allowed to skip", () => {
    // `step: -1` is the contract with the director: it seeds its "last applied" to exactly this,
    // so a run that opens quiet does no DOM work at all before the first burst.
    const quiet = SAMPLES.find((t) => glitchFrame(t).shards.length === 0);
    expect(quiet).toBeDefined();
    expect(glitchFrame(quiet!)).toBe(CLEAN);
    expect(CLEAN.step).toBe(-1);
    expect(CLEAN.chroma).toBe(0);
  });

  it("opens a run clean, so the screen does not greet the player by falling apart", () => {
    // What the per-slot phase offset buys. Without it every slot fires at t = 0 together.
    for (let t = 0; t < 1; t += STEP) {
      expect(glitchFrame(t).shards).toHaveLength(0);
    }
  });
});
