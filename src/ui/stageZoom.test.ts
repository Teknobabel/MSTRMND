import { describe, expect, it } from "vitest";
import { STAGE_HEIGHT, STAGE_WIDTH, computeStageLayout } from "./stageScale";
import {
  FIT_VIEW,
  MAX_ZOOM,
  MIN_ZOOM,
  type StageFrame,
  type StageView,
  clampView,
  isFit,
  maxZoomFor,
  panLimits,
  snapToFit,
  zoomAbout,
} from "./stageZoom";

/** A phone held in landscape: the fit stageScale would choose, centred on screen. */
const PHONE_WIDTH = 844;
const PHONE_HEIGHT = 390;
const phoneFit = computeStageLayout(PHONE_WIDTH, PHONE_HEIGHT, true);

function frame(overrides: Partial<StageFrame> = {}): StageFrame {
  return {
    scale: phoneFit.scale,
    rotated: false,
    originX: PHONE_WIDTH / 2,
    originY: PHONE_HEIGHT / 2,
    ...overrides,
  };
}

/** Where a screen point ends up after `view` is applied, given the stage's fixed centre. */
function project(view: StageView, f: StageFrame, point: { x: number; y: number }) {
  return {
    x: f.originX + view.panX + view.zoom * (point.x - f.originX),
    y: f.originY + view.panY + view.zoom * (point.y - f.originY),
  };
}

describe("maxZoomFor", () => {
  it("stops at the zoom that puts the shell at its authored 1:1 size", () => {
    expect(maxZoomFor(0.5)).toBeCloseTo(2, 5);
    // A phone fits the 1920x1080 shell at about a third, so 1:1 is about 3x.
    expect(maxZoomFor(phoneFit.scale)).toBeCloseTo(1 / phoneFit.scale, 5);
  });

  it("never lets the stage zoom out past the fit", () => {
    // A display large enough to scale the shell *up* is already past 1:1.
    expect(maxZoomFor(2)).toBe(MIN_ZOOM);
  });

  it("caps a very small fit at the hard ceiling", () => {
    expect(maxZoomFor(0.01)).toBe(MAX_ZOOM);
  });

  it("falls back to fit for a nonsense scale", () => {
    expect(maxZoomFor(0)).toBe(MIN_ZOOM);
    expect(maxZoomFor(Number.NaN)).toBe(MIN_ZOOM);
  });
});

describe("panLimits", () => {
  it("pins the stage exactly where the fit put it at zoom 1", () => {
    const limits = panLimits(frame(), MIN_ZOOM);
    expect(limits.x).toBe(0);
    expect(limits.y).toBe(0);
  });

  it("lets the pan reach either edge of the stage and no further", () => {
    const f = frame();
    const zoom = 2;
    // Half the width the zoom added: pan this far and the stage's own left edge lands where
    // the fitted left edge was, so the far side of the shell is reachable but no more
    // letterbox opens than the fit already showed.
    expect(panLimits(f, zoom).x).toBeCloseTo((STAGE_WIDTH * f.scale * (zoom - 1)) / 2, 5);
    expect(panLimits(f, zoom).y).toBeCloseTo((STAGE_HEIGHT * f.scale * (zoom - 1)) / 2, 5);
  });

  it("swaps the axes when the stage is rotated for a portrait phone", () => {
    const f = frame({ rotated: true });
    const limits = panLimits(f, 2);
    expect(limits.x).toBeCloseTo((STAGE_HEIGHT * f.scale) / 2, 5);
    expect(limits.y).toBeCloseTo((STAGE_WIDTH * f.scale) / 2, 5);
  });

  it("does not open a pan range for a zoom below fit", () => {
    expect(panLimits(frame(), 0.5).x).toBe(0);
  });
});

describe("clampView", () => {
  it("holds the zoom inside the range the fit allows", () => {
    const f = frame();
    expect(clampView({ zoom: 99, panX: 0, panY: 0 }, f).zoom).toBeCloseTo(maxZoomFor(f.scale), 5);
    expect(clampView({ zoom: 0.2, panX: 0, panY: 0 }, f).zoom).toBe(MIN_ZOOM);
  });

  it("drags a runaway pan back to the edge of the stage", () => {
    const f = frame();
    const clamped = clampView({ zoom: 2, panX: 10_000, panY: -10_000 }, f);
    expect(clamped.panX).toBeCloseTo(panLimits(f, 2).x, 5);
    expect(clamped.panY).toBeCloseTo(-panLimits(f, 2).y, 5);
  });

  it("re-centres a pan that survived a zoom back out to fit", () => {
    expect(clampView({ zoom: 1, panX: 120, panY: -40 }, frame())).toEqual(FIT_VIEW);
  });

  it("leaves the stage put on a device that cannot zoom at all", () => {
    // A fine-pointer window big enough to scale the shell up has maxZoom === MIN_ZOOM.
    const desktop = frame({ scale: computeStageLayout(3840, 2160, false).scale });
    expect(clampView({ zoom: 3, panX: 200, panY: 200 }, desktop)).toEqual(FIT_VIEW);
  });
});

describe("zoomAbout", () => {
  it("keeps the point between the fingers under the fingers", () => {
    const f = frame();
    // Pinching open around a point off to one side: that point must not slide out from under
    // the gesture, which is the whole feel of a pinch.
    const finger = { x: 200, y: 120 };
    const next = zoomAbout(FIT_VIEW, f, 2, finger, finger);
    expect(next.zoom).toBeCloseTo(2, 5);
    const landed = project(next, f, finger);
    expect(landed.x).toBeCloseTo(finger.x, 3);
    expect(landed.y).toBeCloseTo(finger.y, 3);
  });

  it("pans by the distance two fingers slide without changing the zoom", () => {
    const f = frame();
    const zoomed = zoomAbout(FIT_VIEW, f, 3, { x: 422, y: 195 }, { x: 422, y: 195 });
    const dragged = zoomAbout(zoomed, f, zoomed.zoom, { x: 400, y: 200 }, { x: 340, y: 170 });
    expect(dragged.zoom).toBe(zoomed.zoom);
    expect(dragged.panX).toBeCloseTo(zoomed.panX - 60, 3);
    expect(dragged.panY).toBeCloseTo(zoomed.panY - 30, 3);
  });

  it("carries a zoom and a drag in the same gesture", () => {
    const f = frame();
    const from = { x: 300, y: 150 };
    const to = { x: 500, y: 250 };
    const next = zoomAbout(FIT_VIEW, f, 2, from, to);
    // Whatever was under the fingers when they went down is under them now.
    const landed = project(next, f, from);
    expect(landed.x).toBeCloseTo(to.x, 3);
    expect(landed.y).toBeCloseTo(to.y, 3);
  });

  it("cannot be aimed past the edge of the stage", () => {
    const f = frame();
    // Pinching hard in the very corner: the focal maths alone would fling the stage well past
    // its own edge, and the clamp is what stops the player ending up in blank letterbox.
    const next = zoomAbout(FIT_VIEW, f, MAX_ZOOM, { x: 0, y: 0 }, { x: 0, y: 0 });
    const limits = panLimits(f, next.zoom);
    expect(Math.abs(next.panX)).toBeLessThanOrEqual(limits.x + 1e-6);
    expect(Math.abs(next.panY)).toBeLessThanOrEqual(limits.y + 1e-6);
  });

  it("returns to exactly fit when the gesture closes back down", () => {
    const f = frame();
    const zoomed = zoomAbout(FIT_VIEW, f, 2.5, { x: 300, y: 150 }, { x: 300, y: 150 });
    expect(isFit(zoomed)).toBe(false);
    const closed = zoomAbout(zoomed, f, 0.4, { x: 300, y: 150 }, { x: 310, y: 160 });
    expect(closed).toEqual(FIT_VIEW);
  });

  it("aims the same way whether or not the stage is rotated", () => {
    // The pan is applied ahead of the rotation, so the focal maths is in unrotated screen
    // pixels and a portrait phone needs no special case. A small gesture, so neither result
    // is touched by the clamp - which does differ between the two; see below.
    const from = { x: 400, y: 190 };
    const to = { x: 420, y: 200 };
    const upright = zoomAbout(FIT_VIEW, frame(), 2, from, to);
    const rotated = zoomAbout(FIT_VIEW, frame({ rotated: true }), 2, from, to);
    expect(rotated.panX).toBeCloseTo(upright.panX, 5);
    expect(rotated.panY).toBeCloseTo(upright.panY, 5);
  });

  it("gives the rotated stage less room sideways, because it is 1080 wide on screen", () => {
    const from = { x: 200, y: 100 };
    const to = { x: 260, y: 130 };
    const upright = zoomAbout(FIT_VIEW, frame(), 2, from, to);
    const rotated = zoomAbout(FIT_VIEW, frame({ rotated: true }), 2, from, to);
    expect(rotated.panX).toBeLessThan(upright.panX);
    expect(rotated.panX).toBeCloseTo(panLimits(frame({ rotated: true }), 2).x, 5);
  });
});

describe("snapToFit", () => {
  it("collapses a sloppy pinch-out to exactly fit", () => {
    expect(snapToFit({ zoom: 1.005, panX: 3, panY: -2 })).toEqual(FIT_VIEW);
  });

  it("leaves a deliberate zoom alone", () => {
    const view = { zoom: 1.6, panX: 40, panY: 0 };
    expect(snapToFit(view)).toBe(view);
  });
});
