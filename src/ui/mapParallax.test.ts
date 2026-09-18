import { describe, expect, it } from "vitest";
import {
  MAP_PARALLAX_FOLLOW_MS,
  MAP_PARALLAX_REACH,
  MAP_PARALLAX_REST,
  mapPanelRestBox,
  mapParallaxOverscan,
  mapParallaxSettled,
  mapParallaxStep,
  mapParallaxTarget,
  type MapPanelBox,
} from "./mapParallax";

/** Roughly the shipped plot: the map panel is about this size in stage pixels. */
const PANEL: MapPanelBox = { centerX: 1000, centerY: 500, width: 1070, height: 830 };

describe("mapParallaxOverscan", () => {
  it("covers exactly the slide it is paying for", () => {
    // Scaling by `s` about the centre leaves `(s - 1) / 2` of overhang per side; a slide of
    // `reach` in the element's own units lands `reach * s` across on screen. The margin must not
    // be the smaller of the two, or the panel shows through at full tilt.
    for (const reach of [0.005, 0.025, 0.05, 0.1, 0.25]) {
      const s = mapParallaxOverscan(reach);
      expect((s - 1) / 2).toBeGreaterThanOrEqual(reach * s - 1e-12);
    }
  });

  it("keeps a sliver in hand, because landing exactly flush leaves none", () => {
    // Solved exactly the margin and the slide are equal, and a fractional panel box, a rounded
    // translate and whole-device-pixel rasterisation can each eat that. But only a sliver: every
    // bit of margin is map cropped for nothing.
    for (const reach of [0.005, 0.025, 0.05, 0.1]) {
      const s = mapParallaxOverscan(reach);
      const margin = (s - 1) / 2 - reach * s;
      expect(margin).toBeGreaterThan(0);
      expect(margin).toBeLessThan(reach * 0.1);
    }
  });

  it("does not zoom a map that never moves", () => {
    expect(mapParallaxOverscan(0)).toBe(1);
    expect(mapParallaxOverscan(-1)).toBe(1);
  });

  it("stays finite for a reach nobody should ask for", () => {
    // At half the panel per side the margin would need infinite zoom; clamped rather than NaN.
    expect(Number.isFinite(mapParallaxOverscan(0.5))).toBe(true);
    expect(Number.isFinite(mapParallaxOverscan(4))).toBe(true);
  });

  it("costs more zoom the more reach it is asked for, and little at the shipped one", () => {
    // Derived from MAP_PARALLAX_REACH rather than pinned to a number, because the reach is a
    // tuning knob: an assertion on today's value would fail the moment anyone turned it.
    expect(mapParallaxOverscan(0.05)).toBeGreaterThan(mapParallaxOverscan(MAP_PARALLAX_REACH));
    expect(mapParallaxOverscan(MAP_PARALLAX_REACH)).toBeGreaterThan(1);
    // The crop is the price of the travel, and at any sane reach it stays invisible.
    expect(mapParallaxOverscan(MAP_PARALLAX_REACH)).toBeLessThan(1.1);
  });
});

describe("mapParallaxTarget", () => {
  it("leaves the map alone when the pointer is dead centre", () => {
    expect(mapParallaxTarget({ x: PANEL.centerX, y: PANEL.centerY }, PANEL)).toStrictEqual(
      MAP_PARALLAX_REST,
    );
  });

  it("slides the map the opposite way from the pointer", () => {
    // The whole point: the far side comes to meet the hand rather than the hand going to it.
    const right = mapParallaxTarget({ x: PANEL.centerX + PANEL.width / 2, y: PANEL.centerY }, PANEL);
    const left = mapParallaxTarget({ x: PANEL.centerX - PANEL.width / 2, y: PANEL.centerY }, PANEL);
    expect(right.x).toBe(-MAP_PARALLAX_REACH);
    expect(left.x).toBe(MAP_PARALLAX_REACH);

    const low = mapParallaxTarget({ x: PANEL.centerX, y: PANEL.centerY + PANEL.height / 2 }, PANEL);
    const high = mapParallaxTarget({ x: PANEL.centerX, y: PANEL.centerY - PANEL.height / 2 }, PANEL);
    expect(low.y).toBe(-MAP_PARALLAX_REACH);
    expect(high.y).toBe(MAP_PARALLAX_REACH);
  });

  it("buys back the reach it promises", () => {
    // A pin on the panel's right edge, and the pointer going for it: the pin has come this much
    // closer than where it was drawn, which is travel the hand was spared.
    const slid = mapParallaxTarget({ x: PANEL.centerX + PANEL.width / 2, y: PANEL.centerY }, PANEL);
    expect(-slid.x * PANEL.width).toBeCloseTo(MAP_PARALLAX_REACH * PANEL.width, 9);
    // Worth having at all: the saving has to be a real number of pixels, not a rounding error.
    expect(-slid.x * PANEL.width).toBeGreaterThan(8);
  });

  it("is a function of where the pointer is, not of how it got there", () => {
    // Position in, offset out. An offset accumulated from movement deltas would depend on the
    // path taken and the map would wander over a session; this is what rules that out.
    const spot = { x: 1400, y: 300 };
    expect(mapParallaxTarget(spot, PANEL)).toStrictEqual(mapParallaxTarget(spot, PANEL));
  });

  it("runs straight through the middle, so the drift is even across the panel", () => {
    const quarter = mapParallaxTarget({ x: PANEL.centerX - PANEL.width / 4, y: PANEL.centerY }, PANEL);
    expect(quarter.x).toBeCloseTo(MAP_PARALLAX_REACH / 2, 9);
  });

  it("does not push further for a pointer off the map entirely", () => {
    // Over the planner, the drawer cabinet, the status bar: clamped to what the panel's own edge
    // would ask for rather than running away with it.
    const edge = mapParallaxTarget({ x: PANEL.centerX - PANEL.width / 2, y: PANEL.centerY }, PANEL);
    const miles = mapParallaxTarget({ x: -5000, y: PANEL.centerY }, PANEL);
    expect(miles).toStrictEqual(edge);
  });

  it("stays at rest for a panel that has not been measured", () => {
    const unmeasured = { centerX: 0, centerY: 0, width: 0, height: 0 };
    expect(mapParallaxTarget({ x: 100, y: 100 }, unmeasured)).toStrictEqual(MAP_PARALLAX_REST);
  });

  it("never mints a negative zero for a centred pointer", () => {
    // `-0%` paints the same as `0%` but does not read as rest in any later comparison.
    const at = mapParallaxTarget({ x: PANEL.centerX, y: PANEL.centerY }, PANEL);
    expect(Object.is(at.x, 0)).toBe(true);
    expect(Object.is(at.y, 0)).toBe(true);
  });
});

describe("mapPanelRestBox", () => {
  const OVERSCAN = mapParallaxOverscan(MAP_PARALLAX_REACH);
  /** What the browser reports for a panel resting at 1000x800 and drawn `OVERSCAN` larger. */
  const measuredAtRest = {
    x: 500 - (1000 * OVERSCAN) / 2,
    y: 400 - (800 * OVERSCAN) / 2,
    width: 1000 * OVERSCAN,
    height: 800 * OVERSCAN,
  };

  it("takes the overscan back out of the size", () => {
    const box = mapPanelRestBox(measuredAtRest, MAP_PARALLAX_REST, OVERSCAN);
    expect(box.width).toBeCloseTo(1000, 9);
    expect(box.height).toBeCloseTo(800, 9);
    expect(box.centerX).toBeCloseTo(500, 9);
    expect(box.centerY).toBeCloseTo(400, 9);
  });

  it("reports the same resting box however far the panel has slid", () => {
    // This is what keeps the effect off its own tail: the neutral point the pointer is measured
    // against must not itself be a function of the offset, or the two chase each other.
    const base = mapPanelRestBox(measuredAtRest, MAP_PARALLAX_REST, OVERSCAN);
    for (const offset of [
      { x: MAP_PARALLAX_REACH, y: 0 },
      { x: -MAP_PARALLAX_REACH, y: MAP_PARALLAX_REACH },
      { x: 0.01, y: -0.02 },
    ]) {
      const slid = {
        ...measuredAtRest,
        x: measuredAtRest.x + offset.x * measuredAtRest.width,
        y: measuredAtRest.y + offset.y * measuredAtRest.height,
      };
      const box = mapPanelRestBox(slid, offset, OVERSCAN);
      expect(box.centerX).toBeCloseTo(base.centerX, 9);
      expect(box.centerY).toBeCloseTo(base.centerY, 9);
      expect(box.width).toBeCloseTo(base.width, 9);
    }
  });

  it("survives an overscan of nothing", () => {
    const box = mapPanelRestBox({ x: 0, y: 0, width: 100, height: 50 }, MAP_PARALLAX_REST, 0);
    expect(box.width).toBe(100);
    expect(box.height).toBe(50);
  });
});

describe("mapParallaxStep", () => {
  const TARGET = { x: -MAP_PARALLAX_REACH, y: -MAP_PARALLAX_REACH };

  it("moves toward the target without overshooting it", () => {
    let at = MAP_PARALLAX_REST;
    for (let i = 0; i < 200; i += 1) {
      const next = mapParallaxStep(at, TARGET, 16, MAP_PARALLAX_FOLLOW_MS);
      expect(next.x).toBeGreaterThanOrEqual(TARGET.x);
      expect(next.x).toBeLessThanOrEqual(at.x);
      at = next;
    }
    expect(mapParallaxSettled(at, TARGET)).toBe(true);
  });

  it("settles at the same rate whatever the frame rate", () => {
    // Framed on elapsed time, not on a per-frame fraction. Exponential decay composes exactly
    // over a split interval, so equal wall clock means these agree to floating-point noise.
    const after = (dt: number, frames: number): number => {
      let at = MAP_PARALLAX_REST;
      for (let i = 0; i < frames; i += 1) {
        at = mapParallaxStep(at, TARGET, dt, MAP_PARALLAX_FOLLOW_MS);
      }
      return at.x;
    };
    expect(after(6, 16)).toBeCloseTo(after(16, 6), 12);
  });

  it("covers about 63% of the gap in one time constant, which is what tau means", () => {
    const at = mapParallaxStep(MAP_PARALLAX_REST, TARGET, MAP_PARALLAX_FOLLOW_MS, MAP_PARALLAX_FOLLOW_MS);
    expect(at.x / TARGET.x).toBeCloseTo(1 - Math.exp(-1), 6);
  });

  it("resumes rather than teleports after a backgrounded tab", () => {
    // A tab hidden for a minute hands back an enormous `dt`. Catch-up is capped, so the map comes
    // back moving instead of snapping to wherever the pointer ended up.
    const at = mapParallaxStep(MAP_PARALLAX_REST, TARGET, 60_000, MAP_PARALLAX_FOLLOW_MS);
    expect(at.x).toBeGreaterThan(TARGET.x);
  });

  it("does not move on a frame with no time in it", () => {
    expect(mapParallaxStep(MAP_PARALLAX_REST, TARGET, 0)).toStrictEqual(MAP_PARALLAX_REST);
    expect(mapParallaxStep(MAP_PARALLAX_REST, TARGET, -8)).toStrictEqual(MAP_PARALLAX_REST);
    expect(mapParallaxStep(MAP_PARALLAX_REST, TARGET, Number.NaN)).toStrictEqual(MAP_PARALLAX_REST);
  });

  it("goes straight there when asked for no easing at all", () => {
    expect(mapParallaxStep(MAP_PARALLAX_REST, TARGET, 16, 0)).toStrictEqual(TARGET);
  });
});

describe("mapParallaxSettled", () => {
  it("calls it arrived only once the gap is well under a pixel", () => {
    expect(mapParallaxSettled({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(true);
    expect(mapParallaxSettled({ x: 0.0001, y: -0.0001 }, { x: 0, y: 0 })).toBe(true);
    expect(mapParallaxSettled({ x: 0.01, y: 0 }, { x: 0, y: 0 })).toBe(false);
    expect(mapParallaxSettled({ x: 0, y: 0.01 }, { x: 0, y: 0 })).toBe(false);
  });
});
