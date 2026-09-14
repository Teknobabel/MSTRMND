import { describe, expect, it } from "vitest";
import {
  BOOT_PIN_SPAN_MS,
  BOOT_SETTLE_MS,
  BOOT_STAGES,
  bootPinDelayMs,
  bootSequenceDurationMs,
  bootTimingVars,
  type BootElementCounts,
} from "./bootSequence";

/** What the shipped shell actually puts on screen: six readouts, five tabs, three plan sections. */
const SHELL: BootElementCounts = { pins: 15, stats: 6, tabs: 5, planSections: 3 };

describe("boot stage clock", () => {
  it("runs the stages in the order the player is told they happen", () => {
    // The doc comment on BOOT_STAGES describes a sequence; a stage reordered by a careless edit
    // would still animate, just not in an order anything else in the module agrees with.
    const order = [
      BOOT_STAGES.power,
      BOOT_STAGES.map,
      BOOT_STAGES.pins,
      BOOT_STAGES.stats,
      BOOT_STAGES.tabs,
      BOOT_STAGES.plan,
    ].map((s) => s.atMs);
    expect(order).toStrictEqual([...order].sort((a, b) => a - b));
  });

  it("overlaps every stage with the one before it", () => {
    // Two seconds of console coming online, not eight stages queueing politely: each stage has to
    // start before its predecessor has finished or the sequence reads as a checklist.
    expect(BOOT_STAGES.map.atMs).toBeLessThan(BOOT_STAGES.power.durationMs);
    expect(BOOT_STAGES.pins.atMs).toBeLessThan(BOOT_STAGES.map.atMs + BOOT_STAGES.map.durationMs);
    expect(BOOT_STAGES.stats.atMs).toBeLessThan(BOOT_STAGES.pins.atMs + BOOT_PIN_SPAN_MS);
    expect(BOOT_STAGES.tabs.atMs).toBeLessThan(BOOT_STAGES.stats.atMs + BOOT_STAGES.stats.durationMs);
    expect(BOOT_STAGES.plan.atMs).toBeLessThan(BOOT_STAGES.tabs.atMs + BOOT_STAGES.tabs.durationMs);
  });

  it("does not leave the planner sections moving before the panel they are in has landed", () => {
    expect(BOOT_STAGES.planSections.atMs).toBeGreaterThan(BOOT_STAGES.plan.atMs);
  });

  it("stays short enough to sit through", () => {
    // The brief was "not too long". Two and a half seconds is the outer edge of that, and this is
    // the assertion that notices when a retimed stage quietly pushes past it.
    expect(bootSequenceDurationMs(SHELL)).toBeLessThanOrEqual(2500);
  });
});

describe("bootSequenceDurationMs", () => {
  it("outlasts the last element of every staggered stage", () => {
    const total = bootSequenceDurationMs(SHELL);
    const lastStat =
      BOOT_STAGES.stats.atMs +
      (SHELL.stats - 1) * BOOT_STAGES.stats.stepMs +
      BOOT_STAGES.stats.durationMs;
    const lastTab =
      BOOT_STAGES.tabs.atMs +
      (SHELL.tabs - 1) * BOOT_STAGES.tabs.stepMs +
      BOOT_STAGES.tabs.durationMs;
    const lastPin = BOOT_STAGES.pins.atMs + BOOT_PIN_SPAN_MS + BOOT_STAGES.pins.durationMs;
    expect(total).toBeGreaterThanOrEqual(lastStat + BOOT_SETTLE_MS);
    expect(total).toBeGreaterThanOrEqual(lastTab + BOOT_SETTLE_MS);
    expect(total).toBeGreaterThanOrEqual(lastPin + BOOT_SETTLE_MS);
  });

  it("grows with the number of staggered elements", () => {
    // A shell that grows a stat block must hold the boot class long enough to finish lighting it.
    const more = bootSequenceDurationMs({ ...SHELL, stats: SHELL.stats + 8 });
    expect(more).toBeGreaterThan(bootSequenceDurationMs(SHELL));
  });

  it("does not wait on pins for a map that put none up", () => {
    // No map art for the run: the pin stage has nothing in it, so nothing should be held for it.
    // Only `toBeLessThanOrEqual`, because as the stages stand the chrome stage outlasts the pins
    // either way — what must never happen is a bare map sitting dark longer than a full one.
    const bare = bootSequenceDurationMs({ pins: 0, stats: 1, tabs: 1, planSections: 1 });
    expect(bare).toBeLessThanOrEqual(bootSequenceDurationMs(SHELL));
  });

  it("never finishes before the stage that starts last", () => {
    const latest = Math.max(...Object.values(BOOT_STAGES).map((s) => s.atMs));
    expect(bootSequenceDurationMs({ pins: 0, stats: 0, tabs: 0, planSections: 0 })).toBeGreaterThan(
      latest,
    );
  });
});

describe("bootPinDelayMs", () => {
  it("lights a pin as the scanner reaches it", () => {
    // The sweep crosses the plot linearly over BOOT_PIN_SPAN_MS; top, middle and bottom of the
    // frame are the three moments the stylesheet's keyframes are pinned to.
    expect(bootPinDelayMs(0, 400)).toBe(BOOT_STAGES.pins.atMs);
    expect(bootPinDelayMs(200, 400)).toBe(BOOT_STAGES.pins.atMs + BOOT_PIN_SPAN_MS / 2);
    expect(bootPinDelayMs(400, 400)).toBe(BOOT_STAGES.pins.atMs + BOOT_PIN_SPAN_MS);
  });

  it("orders two pins by how far down the map they sit", () => {
    expect(bootPinDelayMs(90, 400)).toBeLessThan(bootPinDelayMs(310, 400));
  });

  it("clamps a pin the projection pushed outside the frame", () => {
    // A marker the camera has turned past the edge reports a position off the plot; it should
    // still light at one end of the sweep rather than seconds before or after it.
    expect(bootPinDelayMs(-120, 400)).toBe(BOOT_STAGES.pins.atMs);
    expect(bootPinDelayMs(999, 400)).toBe(BOOT_STAGES.pins.atMs + BOOT_PIN_SPAN_MS);
  });

  it("falls back to the head of the stage when the plot has not been measured", () => {
    expect(bootPinDelayMs(50, 0)).toBe(BOOT_STAGES.pins.atMs);
    expect(bootPinDelayMs(Number.NaN, 400)).toBe(BOOT_STAGES.pins.atMs);
    expect(bootPinDelayMs(50, Number.NaN)).toBe(BOOT_STAGES.pins.atMs);
  });
});

describe("bootTimingVars", () => {
  it("publishes a start and a duration for every stage", () => {
    const vars = bootTimingVars();
    for (const stage of Object.values(BOOT_STAGES)) {
      expect(vars.get(`--boot-t-${stage.cssStem}`)).toBe(`${stage.atMs}ms`);
      expect(vars.get(`--boot-d-${stage.cssStem}`)).toBe(`${stage.durationMs}ms`);
    }
  });

  it("publishes a step only for the stages that stagger", () => {
    const vars = bootTimingVars();
    expect(vars.get("--boot-step-stats")).toBe(`${BOOT_STAGES.stats.stepMs}ms`);
    expect(vars.get("--boot-step-tabs")).toBe(`${BOOT_STAGES.tabs.stepMs}ms`);
    // The map opens as one thing; a step for it would be a value the sheet never reads.
    expect(vars.has("--boot-step-map")).toBe(false);
    expect(vars.has("--boot-step-plan")).toBe(false);
  });

  it("hands the sweep the same span the pins are spread over", () => {
    // The welding point between the scanner band and bootPinDelayMs. If these ever disagree,
    // sites light near the beam instead of under it.
    expect(bootTimingVars().get("--boot-span-pins")).toBe(`${BOOT_PIN_SPAN_MS}ms`);
  });

  it("writes every value as a CSS time, since the sheet does arithmetic on them", () => {
    for (const value of bootTimingVars().values()) {
      expect(value).toMatch(/^\d+ms$/);
    }
  });
});
