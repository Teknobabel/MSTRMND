import { describe, expect, it } from "vitest";
import {
  BOOT_HAND_OVER_MS,
  BOOT_PIN_SPAN_MS,
  BOOT_SETTLE_MS,
  BOOT_STAGES,
  PLANNER_STAGES,
  bootPinDelayMs,
  bootSequenceDurationMs,
  bootTimingVars,
  plannerArrivalDurationMs,
  plannerTimingVars,
  type BootElementCounts,
} from "./bootSequence";

/** What the shipped shell actually puts on screen: six readouts and six menu tabs. */
const SHELL: BootElementCounts = { pins: 15, stats: 6, tabs: 6 };

/** The planner's own staggered stage, which belongs to the second act rather than the boot. */
const PLAN_SECTIONS = 3;

/**
 * When each stage starts and when the last thing in it stops moving, for the shipped shell.
 *
 * Mirrors `bootSequenceDurationMs`'s own arithmetic rather than calling it, because the point of
 * the tests below is the shape of the timeline — where the stages sit relative to each other —
 * and only the single longest of those ends is visible in the number that function returns.
 */
function stageSpans(): readonly { readonly id: string; readonly start: number; readonly end: number }[] {
  const counts: Record<string, number> = {
    stats: SHELL.stats,
    tabs: SHELL.tabs,
  };
  return Object.entries(BOOT_STAGES).map(([id, stage]) => ({
    id,
    start: stage.atMs,
    /* The pins are spread across the sweep rather than by a per-element step, so the last of
     * them starts a full span in however many there are. */
    end:
      id === "pins"
        ? stage.atMs + BOOT_PIN_SPAN_MS + stage.durationMs
        : stage.atMs + Math.max(0, (counts[id] ?? 1) - 1) * stage.stepMs + stage.durationMs,
  }));
}

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
      BOOT_STAGES.chrome,
    ].map((s) => s.atMs);
    expect(order).toStrictEqual([...order].sort((a, b) => a - b));
  });

  it("leaves no dead air between one stage and the next", () => {
    // Deliberately not pairwise against the preceding stage. The stages overlap several deep —
    // the pins are still landing while the readouts light, and the map is still opening under
    // both — so which stage happens to cover which gap is a detail that has changed at every
    // retiming. What has to hold however they are dealt is that *something* is always moving: a
    // console that goes still part-way through reads as one that has finished, or hung. This is
    // what the chrome stage was moved up for when the planner stopped being a boot stage.
    const spans = [...stageSpans()].sort((a, b) => a.start - b.start);
    let covered = spans[0].start;
    for (const span of spans) {
      expect(span.start, `nothing is moving when ${span.id} starts`).toBeLessThanOrEqual(covered);
      covered = Math.max(covered, span.end);
    }
  });

  it("keeps the planner out of the boot, so the briefing has something left to hand over", () => {
    // The planner's arrival is the second act (`startPlannerArrival`) and is timed from the
    // dismissal of the run briefing. A stage for it back in this table would put the panel on
    // screen behind that page — the thing the move away from it was for.
    expect(Object.keys(BOOT_STAGES)).not.toContain("plan");
    expect(Object.keys(BOOT_STAGES)).not.toContain("planSections");
  });

  it("leaves the finished console to itself before handing over to the briefing", () => {
    // The gap between nothing moving any more and the briefing landing on top of it. Asserted
    // against the arithmetic rather than the constant alone, because the beat only does its job
    // if it is *after* the last stage — folded in anywhere else it would be swallowed by the
    // slack between the stages and the player would see no pause at all.
    const settled = Math.max(...stageSpans().map((span) => span.end));
    expect(bootSequenceDurationMs(SHELL) - settled).toBe(BOOT_SETTLE_MS + BOOT_HAND_OVER_MS);
    expect(BOOT_HAND_OVER_MS).toBeGreaterThan(0);
  });

  it("stays inside a sane budget", () => {
    // The sequence opened at two seconds and has since been retimed well past that, which is
    // affordable because a player is never held by it: any pointer or key ends it on the spot
    // (see `skippable` in the module). So this is a runaway guard rather than a design target —
    // a mistyped duration that held the console dark for half a minute would sail through every
    // other assertion in this file.
    expect(bootSequenceDurationMs(SHELL)).toBeLessThanOrEqual(9000);
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
    // A shell that grows readouts must hold the boot class long enough to finish lighting them.
    // The count has to be absurd to show it: on the current clock the stats stage finishes a
    // couple of seconds before the stage that actually ends last, so a handful more would be
    // swallowed by that slack and prove nothing about whether the stagger is counted at all.
    const crowded = bootSequenceDurationMs({ ...SHELL, stats: SHELL.stats + 60 });
    expect(crowded).toBeGreaterThan(bootSequenceDurationMs(SHELL));
  });

  it("does not wait on pins for a map that put none up", () => {
    // No map art for the run: the pin stage has nothing in it, so nothing should be held for it.
    // Only `toBeLessThanOrEqual`, because as the stages stand the chrome stage outlasts the pins
    // either way — what must never happen is a bare map sitting dark longer than a full one.
    const bare = bootSequenceDurationMs({ pins: 0, stats: 1, tabs: 1 });
    expect(bare).toBeLessThanOrEqual(bootSequenceDurationMs(SHELL));
  });

  it("never finishes before the stage that starts last", () => {
    const latest = Math.max(...Object.values(BOOT_STAGES).map((s) => s.atMs));
    expect(bootSequenceDurationMs({ pins: 0, stats: 0, tabs: 0 })).toBeGreaterThan(latest);
  });
});

describe("the planner's arrival", () => {
  it("opens on the panel and not on what is inside it", () => {
    // Its own act now, so its clock starts at zero rather than five seconds in — but the shape
    // is the one the two stages carried as boot stages: the sections start while the panel is
    // still travelling, so the planner arrives furnished instead of arriving and then filling.
    expect(PLANNER_STAGES.plan.atMs).toBeLessThan(PLANNER_STAGES.planSections.atMs);
    expect(PLANNER_STAGES.planSections.atMs).toBeLessThan(
      PLANNER_STAGES.plan.atMs + PLANNER_STAGES.plan.durationMs,
    );
  });

  it("starts promptly, because the player has just asked for it", () => {
    // Unlike a boot stage, nothing runs before this: the delay is dead air on a click.
    for (const stage of Object.values(PLANNER_STAGES)) {
      expect(stage.atMs).toBeLessThan(1000);
    }
  });

  it("hands over at once, with no beat of its own", () => {
    // The boot's hand-over beat keeps the briefing off a console nobody has had a moment to
    // look at. This act is the thing being looked at and hands over to nothing but the live
    // game, so a second of stillness at the end of it would just be a second of nothing.
    const lastStage = Math.max(
      ...Object.values(PLANNER_STAGES).map(
        (stage) =>
          stage.atMs + Math.max(0, PLAN_SECTIONS - 1) * stage.stepMs + stage.durationMs,
      ),
    );
    expect(plannerArrivalDurationMs(PLAN_SECTIONS) - lastStage).toBe(BOOT_SETTLE_MS);
  });

  it("outlasts the last section to fill in", () => {
    const total = plannerArrivalDurationMs(PLAN_SECTIONS);
    const lastSection =
      PLANNER_STAGES.planSections.atMs +
      (PLAN_SECTIONS - 1) * PLANNER_STAGES.planSections.stepMs +
      PLANNER_STAGES.planSections.durationMs;
    expect(total).toBeGreaterThanOrEqual(lastSection + BOOT_SETTLE_MS);
  });

  it("holds the panel on screen even for a planner with no sections at all", () => {
    expect(plannerArrivalDurationMs(0)).toBeGreaterThanOrEqual(
      PLANNER_STAGES.plan.atMs + PLANNER_STAGES.plan.durationMs + BOOT_SETTLE_MS,
    );
  });

  it("grows with the number of sections", () => {
    expect(plannerArrivalDurationMs(PLAN_SECTIONS + 40)).toBeGreaterThan(
      plannerArrivalDurationMs(PLAN_SECTIONS),
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

describe("the timing vars each act publishes", () => {
  it("publishes a start and a duration for every stage", () => {
    for (const [stages, vars] of [
      [BOOT_STAGES, bootTimingVars()],
      [PLANNER_STAGES, plannerTimingVars()],
    ] as const) {
      for (const stage of Object.values(stages)) {
        expect(vars.get(`--boot-t-${stage.cssStem}`)).toBe(`${stage.atMs}ms`);
        expect(vars.get(`--boot-d-${stage.cssStem}`)).toBe(`${stage.durationMs}ms`);
      }
    }
  });

  it("publishes a step only for the stages that stagger", () => {
    const vars = bootTimingVars();
    expect(vars.get("--boot-step-stats")).toBe(`${BOOT_STAGES.stats.stepMs}ms`);
    expect(vars.get("--boot-step-tabs")).toBe(`${BOOT_STAGES.tabs.stepMs}ms`);
    // The map opens as one thing; a step for it would be a value the sheet never reads.
    expect(vars.has("--boot-step-map")).toBe(false);
    expect(plannerTimingVars().get("--boot-step-plan-sections")).toBe(
      `${PLANNER_STAGES.planSections.stepMs}ms`,
    );
    expect(plannerTimingVars().has("--boot-step-plan")).toBe(false);
  });

  it("keeps the two acts' names apart, since both are written onto the one shell", () => {
    // The acts run at different times on the same element and each removes only its own vars
    // when it rests. An overlapping name would have the boot's clock survive into the planner's
    // arrival, or be wiped from under a boot still playing.
    const boot = new Set(bootTimingVars().keys());
    for (const name of plannerTimingVars().keys()) {
      expect(boot.has(name), `${name} is published by both acts`).toBe(false);
    }
  });

  it("hands the sweep the same span the pins are spread over", () => {
    // The welding point between the scanner band and bootPinDelayMs. If these ever disagree,
    // sites light near the beam instead of under it.
    expect(bootTimingVars().get("--boot-span-pins")).toBe(`${BOOT_PIN_SPAN_MS}ms`);
  });

  it("writes every value as a CSS time, since the sheet does arithmetic on them", () => {
    for (const vars of [bootTimingVars(), plannerTimingVars()]) {
      for (const value of vars.values()) {
        expect(value).toMatch(/^\d+ms$/);
      }
    }
  });
});
