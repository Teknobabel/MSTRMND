import { describe, expect, it } from "vitest";
import {
  diffReadouts,
  heatPressure,
  rollDurationSeconds,
  rolledValue,
} from "./statDelta";

describe("rolledValue", () => {
  it("starts at the old number and ends exactly on the new one", () => {
    // The end is the part that matters: a roll that lands on 39.7 and prints 40 by rounding is
    // a readout that was briefly lying. Progress 1 returns `to` itself, not a computed value.
    expect(rolledValue(6, 3, 0)).toBe(6);
    expect(rolledValue(6, 3, 1)).toBe(3);
    expect(rolledValue(0, 40, 1)).toBe(40);
  });

  it("never prints a value outside the span it is crossing", () => {
    for (let i = 0; i <= 20; i += 1) {
      const p = i / 20;
      const rising = rolledValue(4, 11, p);
      expect(rising).toBeGreaterThanOrEqual(4);
      expect(rising).toBeLessThanOrEqual(11);
      const falling = rolledValue(11, 4, p);
      expect(falling).toBeGreaterThanOrEqual(4);
      expect(falling).toBeLessThanOrEqual(11);
    }
  });

  it("rounds toward the destination so the count never finishes early", () => {
    // Rounding to nearest would let this print 40 well before the animation ended, leaving the
    // motion running after the information had stopped.
    expect(rolledValue(0, 40, 0.99)).toBeLessThan(40);
    expect(rolledValue(40, 0, 0.99)).toBeGreaterThan(0);
  });

  it("covers most of the distance early", () => {
    // Eased out, so a player who glances away and back sees roughly the right number.
    expect(rolledValue(0, 100, 0.34)).toBeGreaterThan(50);
  });

  it("holds still for a roll that goes nowhere", () => {
    for (const p of [0, 0.5, 1]) {
      expect(rolledValue(7, 7, p)).toBe(7);
    }
  });

  it("treats a broken progress as not started rather than as finished", () => {
    expect(rolledValue(6, 3, Number.NaN)).toBe(6);
    expect(rolledValue(6, 3, -1)).toBe(6);
  });
});

describe("rollDurationSeconds", () => {
  it("gives an unchanged readout no duration at all", () => {
    expect(rollDurationSeconds(5, 5)).toBe(0);
  });

  it("spends longer on a bigger change", () => {
    expect(rollDurationSeconds(0, 30)).toBeGreaterThan(rollDurationSeconds(0, 2));
  });

  it("caps, so the status bar is never still counting over a turn report", () => {
    expect(rollDurationSeconds(0, 4000)).toBeLessThanOrEqual(0.62);
  });

  it("measures distance, not direction", () => {
    expect(rollDurationSeconds(3, 12)).toBe(rollDurationSeconds(12, 3));
  });
});

describe("diffReadouts", () => {
  it("reports only what moved", () => {
    const prev = new Map([["command", 6], ["heat", 12]]);
    const next = new Map([["command", 3], ["heat", 12]]);
    expect(diffReadouts(prev, next)).toEqual([
      { key: "command", from: 6, to: 3, direction: "down" },
    ]);
  });

  it("labels the direction, because a gain and a loss are styled differently", () => {
    const prev = new Map([["infamy", 4]]);
    const next = new Map([["infamy", 9]]);
    expect(diffReadouts(prev, next)[0]?.direction).toBe("up");
  });

  it("says nothing on the first render of a run", () => {
    // Every readout appearing at once would have six numbers counting up the moment the map
    // arrives. A run opens with its numbers simply true.
    expect(diffReadouts(new Map(), new Map([["command", 6], ["heat", 0]]))).toEqual([]);
  });

  it("ignores a readout that has gone away", () => {
    expect(diffReadouts(new Map([["gone", 3]]), new Map())).toEqual([]);
  });
});

describe("heatPressure", () => {
  it("runs 0..1 across the authored heat scale", () => {
    expect(heatPressure(0)).toBe(0);
    expect(heatPressure(50)).toBeCloseTo(0.5);
    expect(heatPressure(100)).toBe(1);
  });

  it("clamps rather than letting a runaway heat over-drive the glow", () => {
    expect(heatPressure(400)).toBe(1);
    expect(heatPressure(-20)).toBe(0);
    expect(heatPressure(Number.NaN)).toBe(0);
  });
});
