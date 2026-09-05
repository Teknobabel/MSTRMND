import { describe, expect, it } from "vitest";
import { computeStageLayout, STAGE_HEIGHT, STAGE_WIDTH } from "./stageScale";

describe("computeStageLayout", () => {
  it("fits the stage inside a landscape desktop window", () => {
    const { scale, rotated } = computeStageLayout(1280, 720, false);
    expect(rotated).toBe(false);
    expect(scale).toBeCloseTo(1280 / STAGE_WIDTH, 5);
  });

  it("letterboxes on the tighter axis", () => {
    // Very wide window: height is the constraint.
    const { scale } = computeStageLayout(3000, 900, false);
    expect(scale).toBeCloseTo(900 / STAGE_HEIGHT, 5);
  });

  it("rotates the stage on a portrait touch device and swaps the fit axes", () => {
    const { scale, rotated } = computeStageLayout(390, 844, true);
    expect(rotated).toBe(true);
    expect(scale).toBeCloseTo(Math.min(844 / STAGE_WIDTH, 390 / STAGE_HEIGHT), 5);
  });

  it("does not rotate a portrait window on a fine pointer", () => {
    expect(computeStageLayout(800, 1200, false).rotated).toBe(false);
  });

  it("scales off the layout viewport, so a pinch-zoom cannot rescale the stage", () => {
    const layout = computeStageLayout(844, 390, true);
    // documentElement.clientWidth/Height stay at 844x390 while the page is
    // zoomed 3x, so the stage keeps this scale. Feeding it the *visual*
    // viewport instead (what window.innerWidth reports on iOS while zoomed)
    // shrank the UI by exactly the zoom factor - the "it resets when I pinch"
    // symptom this guards against.
    expect(computeStageLayout(844 / 3, 390 / 3, true).scale).toBeCloseTo(
      layout.scale / 3,
      5,
    );
  });

  it("falls back to a sane scale for a zero-sized viewport", () => {
    expect(computeStageLayout(0, 0, false).scale).toBe(1);
  });
});
