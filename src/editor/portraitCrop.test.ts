import { describe, expect, it } from "vitest";
import {
  clampCropSquare,
  defaultCropSquare,
  fromPortraitCrop,
  isUsablePortraitCrop,
  toPortraitCrop,
} from "./portraitCrop";

/** The shipped minion portraits are all authored at this size; see `content/minions.json`. */
const SRC_W = 720;
const SRC_H = 1280;

describe("defaultCropSquare", () => {
  it("opens head-high on an upright portrait rather than mid-figure", () => {
    const sq = defaultCropSquare(SRC_W, SRC_H);
    expect(sq.x + sq.side / 2).toBeCloseTo(SRC_W / 2);
    /* The whole box sits in the top half — the point of the default is that a face is near it. */
    expect(sq.y + sq.side).toBeLessThan(SRC_H / 2);
  });

  it("fits inside a source narrower than the height-derived side", () => {
    const sq = defaultCropSquare(200, 4000);
    expect(sq.side).toBeLessThanOrEqual(200);
    expect(sq.x).toBeGreaterThanOrEqual(0);
    expect(sq.y + sq.side).toBeLessThanOrEqual(4000);
  });

  it("fits inside a landscape source", () => {
    const sq = defaultCropSquare(1920, 400);
    expect(sq.side).toBeLessThanOrEqual(400);
    expect(sq.x + sq.side).toBeLessThanOrEqual(1920);
    expect(sq.y + sq.side).toBeLessThanOrEqual(400);
  });
});

describe("clampCropSquare", () => {
  it("slides a box dragged off an edge back inside without resizing it", () => {
    const sq = clampCropSquare({ x: -80, y: -40, side: 300 }, SRC_W, SRC_H);
    expect(sq).toEqual({ x: 0, y: 0, side: 300 });
  });

  it("slides a box dragged past the far edge back inside", () => {
    const sq = clampCropSquare({ x: 700, y: 1270, side: 300 }, SRC_W, SRC_H);
    expect(sq).toEqual({ x: SRC_W - 300, y: SRC_H - 300, side: 300 });
  });

  it("shrinks a box larger than the source to fit, then re-seats it", () => {
    const sq = clampCropSquare({ x: 500, y: 900, side: 5000 }, SRC_W, SRC_H);
    /* Capped at the narrow axis, so it spans the full width and has nowhere left to go
     * horizontally — but it keeps as much of the y it was dragged to as still fits. */
    expect(sq).toEqual({ x: 0, y: SRC_H - SRC_W, side: SRC_W });
  });

  it("never collapses to zero when dragged inside out", () => {
    expect(clampCropSquare({ x: 10, y: 10, side: -50 }, SRC_W, SRC_H).side).toBe(1);
  });
});

describe("crop round-trip", () => {
  it("returns a stored crop to within a pixel of where it was left", () => {
    const original = { x: 136, y: 38, side: 448 };
    const reopened = fromPortraitCrop(toPortraitCrop(original, SRC_W, SRC_H), SRC_W, SRC_H);
    expect(reopened.x).toBeCloseTo(original.x, 0);
    expect(reopened.y).toBeCloseTo(original.y, 0);
    expect(reopened.side).toBeCloseTo(original.side, 0);
  });

  it("keeps the box square in pixels even though the percentages differ", () => {
    const crop = toPortraitCrop({ x: 0, y: 0, side: 360 }, SRC_W, SRC_H);
    /* Half the width, but only just over a quarter of the height — the two percentages are
     * *supposed* to disagree, which is why both are stored. */
    expect(crop.w).toBeCloseTo(50);
    expect(crop.h).toBeCloseTo(28.13, 1);
    expect(fromPortraitCrop(crop, SRC_W, SRC_H).side).toBeCloseTo(360, 0);
  });

  it("re-seats a crop read back against a portrait re-exported at another size", () => {
    const crop = toPortraitCrop({ x: 180, y: 64, side: 360 }, SRC_W, SRC_H);
    /* Same framing, half the pixels: the box must scale with the source, not stay put. */
    const sq = fromPortraitCrop(crop, SRC_W / 2, SRC_H / 2);
    expect(sq.x).toBeCloseTo(90, 0);
    expect(sq.y).toBeCloseTo(32, 0);
    expect(sq.side).toBeCloseTo(180, 0);
  });

  it("clamps a hand-edited crop that runs off the source", () => {
    const sq = fromPortraitCrop({ x: 90, y: 95, w: 50, h: 50 }, SRC_W, SRC_H);
    expect(sq.x + sq.side).toBeLessThanOrEqual(SRC_W);
    expect(sq.y + sq.side).toBeLessThanOrEqual(SRC_H);
  });
});

describe("isUsablePortraitCrop", () => {
  it("accepts a well-formed rect", () => {
    expect(isUsablePortraitCrop({ x: 0, y: 0, w: 50, h: 28 })).toBe(true);
  });

  it("rejects the shapes an unvalidated draft row can hand it", () => {
    for (const bad of [
      undefined,
      null,
      "nope",
      {},
      { x: 0, y: 0, w: 0, h: 10 },
      { x: 0, y: 0, w: 10 },
      { x: -1, y: 0, w: 10, h: 10 },
      { x: Number.NaN, y: 0, w: 10, h: 10 },
    ]) {
      expect(isUsablePortraitCrop(bad)).toBe(false);
    }
  });
});
