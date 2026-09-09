import { describe, expect, it } from "vitest";
import mapsJson from "../../../content/maps.json";
import { easeMapLean, mapCameraFrame } from "./camera";
import { transformVec4 } from "./mat4";
import { flatMapMatrix, projectMatrix, type Mat4 } from "./projection";

/** The map tile at stage scale 1, and the aspect it gives the camera. */
const PLOT = { width: 1070.53, height: 434.02 };
const ASPECT = PLOT.width / PLOT.height;

/** Every marker actually shipped in `content/maps.json`, so this guards real content. */
const AUTHORED_MARKERS = mapsJson.flatMap((m) => m.markers ?? []);

function ndc(m: Mat4, u: number, v: number): { x: number; y: number; w: number } {
  const [x, y, , w] = transformVec4(m, u, v, 0, 1);
  return { x: x / w, y: y / w, w };
}

describe("mapCameraFrame with no tilt or drift", () => {
  const frame = mapCameraFrame({ aspect: ASPECT, timeSeconds: 0, tilt: 0, drift: 0 });

  it("reproduces the flat camera exactly, so 'steady map' is a parameter and not a code path", () => {
    const flat = flatMapMatrix();
    for (const marker of AUTHORED_MARKERS) {
      const viaCamera = projectMatrix(marker, PLOT, frame.land);
      const viaFlat = projectMatrix(marker, PLOT, flat);
      expect(viaCamera.x).toBeCloseTo(viaFlat.x, 3);
      expect(viaCamera.y).toBeCloseTo(viaFlat.y, 3);
    }
  });

  it("collapses every floating layer onto the land, so a flat map has no parallax to give away", () => {
    for (const marker of AUTHORED_MARKERS.slice(0, 4)) {
      const land = ndc(frame.land, marker.x / 100, marker.y / 100);
      for (const above of [frame.grid, frame.atmosphere]) {
        const floating = ndc(above, marker.x / 100, marker.y / 100);
        expect(floating.x).toBeCloseTo(land.x, 6);
        expect(floating.y).toBeCloseTo(land.y, 6);
      }
    }
  });

  it("reports no depth to span, so the haze switches itself off on a flat map", () => {
    // The land shader has no branch for this: it divides by the span and relies on near == far
    // producing zero haze everywhere. If the two ever drift apart here, a map with the tilt
    // dialled out quietly acquires a gradient nobody asked for.
    expect(frame.depth.far).toBeCloseTo(frame.depth.near, 10);
  });

  it("puts the corners of the map exactly on the edges of the frame", () => {
    expect(ndc(frame.land, 0, 0).x).toBeCloseTo(-1, 5);
    expect(ndc(frame.land, 1, 1).x).toBeCloseTo(1, 5);
    expect(ndc(frame.land, 0, 0).y).toBeCloseTo(1, 5);
    expect(ndc(frame.land, 1, 1).y).toBeCloseTo(-1, 5);
  });
});

describe("mapCameraFrame under tilt and drift", () => {
  /* Two full drift cycles at a fine step, so the sampling cannot slip between the extremes of
   * the two oscillators (41s and 29s periods). */
  const SAMPLES = Array.from({ length: 160 }, (_, i) => (i * 82) / 160);

  it("never lets an authored site leave the frame, at any point in the drift", () => {
    for (const timeSeconds of SAMPLES) {
      const { land } = mapCameraFrame({ aspect: ASPECT, timeSeconds, tilt: 1, drift: 1 });
      for (const marker of AUTHORED_MARKERS) {
        const projected = projectMatrix(marker, PLOT, land);
        expect(projected.visible).toBe(true);
        /* Inside the plot proper, not merely inside the projector's off-frame slack: a pin the
         * player cannot click is as good as a missing one. */
        expect(projected.x).toBeGreaterThanOrEqual(0);
        expect(projected.x).toBeLessThanOrEqual(PLOT.width);
        expect(projected.y).toBeGreaterThanOrEqual(0);
        expect(projected.y).toBeLessThanOrEqual(PLOT.height);
      }
    }
  });

  it("keeps the map fitted to the frame rather than letting the tilt shrink it away", () => {
    for (const timeSeconds of SAMPLES) {
      const { land } = mapCameraFrame({ aspect: ASPECT, timeSeconds, tilt: 1, drift: 1 });
      const corners = [
        ndc(land, 0, 0),
        ndc(land, 1, 0),
        ndc(land, 0, 1),
        ndc(land, 1, 1),
      ];
      const extent = Math.max(...corners.map((c) => Math.max(Math.abs(c.x), Math.abs(c.y))));
      // The fit is exact by construction: the outermost corner sits on the edge.
      expect(extent).toBeCloseTo(1, 5);
    }
  });

  it("gives the grid layer a parallax against the land that changes as the camera drifts", () => {
    // Depth is not the offset itself but the fact that it *moves*: a fixed offset would read as
    // a second flat picture pasted on top.
    const separation = (timeSeconds: number): number => {
      const { land, grid } = mapCameraFrame({ aspect: ASPECT, timeSeconds, tilt: 1, drift: 1 });
      const a = ndc(land, 0.15, 0.2);
      const b = ndc(grid, 0.15, 0.2);
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const samples = [0, 7, 14, 21, 28, 35].map(separation);
    for (const s of samples) {
      expect(s).toBeGreaterThan(1e-3);
    }
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(1e-4);
  });

  it("gives the atmosphere a wider parallax than the grid, so the stack reads as three depths", () => {
    // Two layers at the same apparent height would be one layer drawn twice. What makes the
    // stack read as volume is that each floating plane disagrees with the land by a different
    // amount, and the higher one disagrees more.
    for (const timeSeconds of [0, 11, 22, 33]) {
      const frame = mapCameraFrame({ aspect: ASPECT, timeSeconds, tilt: 1, drift: 1 });
      const at = (m: Mat4) => ndc(m, 0.15, 0.2);
      const land = at(frame.land);
      const offset = (m: Mat4): number => {
        const p = at(m);
        return Math.hypot(p.x - land.x, p.y - land.y);
      };
      expect(offset(frame.atmosphere)).toBeGreaterThan(offset(frame.grid));
    }
  });

  it("reports a depth range that brackets every site on the map", () => {
    // The haze normalises against this range, so a site outside it would be clamped flat — the
    // near half of the map fully clear or the far half fully hazed, either way a band that
    // stops moving with the drift.
    for (const timeSeconds of [0, 13, 26, 39]) {
      const { land, depth } = mapCameraFrame({ aspect: ASPECT, timeSeconds, tilt: 1, drift: 1 });
      expect(depth.far).toBeGreaterThan(depth.near);
      for (const marker of AUTHORED_MARKERS) {
        const w = ndc(land, marker.x / 100, marker.y / 100).w;
        expect(w).toBeGreaterThanOrEqual(depth.near);
        expect(w).toBeLessThanOrEqual(depth.far);
      }
    }
  });

  it("puts the top of the map further from the camera than the bottom", () => {
    // The haze is only correct if depth actually increases toward the pitched-away edge; a sign
    // slip here would fog the near edge and leave the horizon glaring.
    const { land } = mapCameraFrame({ aspect: ASPECT, timeSeconds: 0, tilt: 1, drift: 0 });
    expect(ndc(land, 0.5, 0).w).toBeGreaterThan(ndc(land, 0.5, 1).w);
  });

  it("actually moves the camera over time, so the drift is not a no-op", () => {
    const a = ndc(mapCameraFrame({ aspect: ASPECT, timeSeconds: 0, tilt: 1, drift: 1 }).land, 0, 0);
    const b = ndc(
      mapCameraFrame({ aspect: ASPECT, timeSeconds: 10, tilt: 1, drift: 1 }).land,
      0,
      0,
    );
    expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeGreaterThan(1e-4);
  });

  it("pitches the top of the map away, so the tilt reads in the right direction", () => {
    const { land } = mapCameraFrame({ aspect: ASPECT, timeSeconds: 0, tilt: 1, drift: 0 });
    // Perspective narrows whatever is further away: the top edge should be the shorter one.
    const topWidth = ndc(land, 1, 0).x - ndc(land, 0, 0).x;
    const bottomWidth = ndc(land, 1, 1).x - ndc(land, 0, 1).x;
    expect(topWidth).toBeLessThan(bottomWidth);
  });

  it("holds the camera still when drift is dialled out but tilt is kept", () => {
    const at = (t: number) =>
      ndc(mapCameraFrame({ aspect: ASPECT, timeSeconds: t, tilt: 1, drift: 0 }).land, 0.3, 0.7);
    expect(at(0).x).toBeCloseTo(at(99).x, 10);
    expect(at(0).y).toBeCloseTo(at(99).y, 10);
  });
});

describe("mapCameraFrame across panel shapes", () => {
  it("fits every site for the fullscreen panel as well as the dashboard tile", () => {
    for (const plot of [PLOT, { width: 1880, height: 950 }, { width: 640, height: 360 }]) {
      const { land } = mapCameraFrame({
        aspect: plot.width / plot.height,
        timeSeconds: 17,
        tilt: 1,
        drift: 1,
      });
      for (const marker of AUTHORED_MARKERS) {
        expect(projectMatrix(marker, plot, land).visible).toBe(true);
      }
    }
  });
});

describe("mapCameraFrame focus", () => {
  it("still keeps every site in the frame while leaning at any one of them", () => {
    // The containment guarantee is the reason the camera turns instead of pushing in. It has to
    // survive the emphasis, at every target the player can actually stage, mid-drift.
    for (const target of AUTHORED_MARKERS) {
      for (const timeSeconds of [0, 9, 18, 27, 36]) {
        const { land } = mapCameraFrame({
          aspect: ASPECT,
          timeSeconds,
          tilt: 1,
          drift: 1,
          focus: { u: target.x / 100, v: target.y / 100, amount: 1 },
        });
        for (const marker of AUTHORED_MARKERS) {
          const projected = projectMatrix(marker, PLOT, land);
          expect(projected.visible).toBe(true);
          expect(projected.x).toBeGreaterThanOrEqual(0);
          expect(projected.x).toBeLessThanOrEqual(PLOT.width);
          expect(projected.y).toBeGreaterThanOrEqual(0);
          expect(projected.y).toBeLessThanOrEqual(PLOT.height);
        }
      }
    }
  });

  it("turns without zooming, so the map is never scaled past its fit", () => {
    const extent = (focus: { u: number; v: number; amount: number } | undefined): number => {
      const { land } = mapCameraFrame({
        aspect: ASPECT,
        timeSeconds: 0,
        tilt: 1,
        drift: 0,
        focus,
      });
      const corners = [ndc(land, 0, 0), ndc(land, 1, 0), ndc(land, 0, 1), ndc(land, 1, 1)];
      return Math.max(...corners.map((c) => Math.max(Math.abs(c.x), Math.abs(c.y))));
    };
    expect(extent(undefined)).toBeCloseTo(1, 5);
    expect(extent({ u: 0.11, v: 0.18, amount: 1 })).toBeCloseTo(1, 5);
    expect(extent({ u: 0.88, v: 0.72, amount: 1 })).toBeCloseTo(1, 5);
  });

  it("leans toward the target rather than away from it", () => {
    const at = (u: number) =>
      ndc(
        mapCameraFrame({
          aspect: ASPECT,
          timeSeconds: 0,
          tilt: 1,
          drift: 0,
          focus: { u, v: 0.5, amount: 1 },
        }).land,
        u,
        0.5,
      ).x;
    // A site on the left edge should be brought toward the middle of the frame, not pushed out.
    expect(Math.abs(at(0.05))).toBeLessThan(
      Math.abs(ndc(mapCameraFrame({ aspect: ASPECT, timeSeconds: 0, tilt: 1, drift: 0 }).land, 0.05, 0.5).x),
    );
  });

  it("is a no-op at zero amount, so easing in from nothing starts where the drift left off", () => {
    const withFocus = mapCameraFrame({
      aspect: ASPECT,
      timeSeconds: 5,
      tilt: 1,
      drift: 1,
      focus: { u: 0.9, v: 0.1, amount: 0 },
    });
    const without = mapCameraFrame({ aspect: ASPECT, timeSeconds: 5, tilt: 1, drift: 1 });
    expect(Array.from(withFocus.land)).toEqual(Array.from(without.land));
  });
});

describe("mapCameraFrame pointer lean", () => {
  /** The four corners plus the middle: the widest the pointer lean can ever be pushed. */
  const POINTER_EXTREMES = [
    { u: 0, v: 0 },
    { u: 1, v: 0 },
    { u: 0, v: 1 },
    { u: 1, v: 1 },
    { u: 0.5, v: 0.5 },
  ];

  it("keeps every site in the frame with the pointer and a staged target both at full lean", () => {
    // The two leans compose, so the worst case is not either one alone. This is the case that
    // would quietly break containment if a future lean were added without checking.
    for (const pointer of POINTER_EXTREMES) {
      for (const target of AUTHORED_MARKERS) {
        const { land } = mapCameraFrame({
          aspect: ASPECT,
          timeSeconds: 13,
          tilt: 1,
          drift: 1,
          focus: { u: target.x / 100, v: target.y / 100, amount: 1 },
          pointer: { ...pointer, amount: 1 },
        });
        for (const marker of AUTHORED_MARKERS) {
          const projected = projectMatrix(marker, PLOT, land);
          expect(projected.visible).toBe(true);
          expect(projected.x).toBeGreaterThanOrEqual(0);
          expect(projected.x).toBeLessThanOrEqual(PLOT.width);
          expect(projected.y).toBeGreaterThanOrEqual(0);
          expect(projected.y).toBeLessThanOrEqual(PLOT.height);
        }
      }
    }
  });

  it("leans a smaller amount than a staged target does", () => {
    // The pointer is ambient; staging a target is a decision. The map should say so.
    const angleOf = (key: "focus" | "pointer"): number => {
      const { land } = mapCameraFrame({
        aspect: ASPECT,
        timeSeconds: 0,
        tilt: 1,
        drift: 0,
        [key]: { u: 1, v: 0.5, amount: 1 },
      });
      return Math.abs(ndc(land, 0.5, 0.5).x);
    };
    expect(angleOf("pointer")).toBeLessThan(angleOf("focus"));
    expect(angleOf("pointer")).toBeGreaterThan(0);
  });

  it("is a no-op at zero amount, so a pointer that never entered changes nothing", () => {
    const hovering = mapCameraFrame({
      aspect: ASPECT,
      timeSeconds: 3,
      tilt: 1,
      drift: 1,
      pointer: { u: 0.9, v: 0.1, amount: 0 },
    });
    const plain = mapCameraFrame({ aspect: ASPECT, timeSeconds: 3, tilt: 1, drift: 1 });
    expect(Array.from(hovering.land)).toEqual(Array.from(plain.land));
  });
});

describe("easeMapLean", () => {
  const REST = { u: 0.5, v: 0.5, amount: 0 };

  it("closes most of the distance in about one time constant", () => {
    let lean = { u: 0.2, v: 0.2, amount: 1 };
    lean = easeMapLean(lean, { u: 0.8, v: 0.8 }, 0.15, 0.15);
    // 1 - e^-1 is about 0.632 of the way there.
    expect(lean.u).toBeCloseTo(0.2 + 0.6 * 0.632, 3);
  });

  it("jumps straight to a new point when nothing is leaning yet", () => {
    // Otherwise staging a target on the far side of the map would sweep the camera across it.
    const lean = easeMapLean(REST, { u: 0.95, v: 0.05 }, 0.016, 0.15);
    expect(lean.u).toBeCloseTo(0.95, 6);
    expect(lean.v).toBeCloseTo(0.05, 6);
    expect(lean.amount).toBeGreaterThan(0);
  });

  it("relaxes the amount but leaves the point alone when the goal goes away", () => {
    const held = { u: 0.9, v: 0.1, amount: 1 };
    const released = easeMapLean(held, null, 0.1, 0.15);
    expect(released.amount).toBeLessThan(1);
    expect(released.u).toBe(0.9);
    expect(released.v).toBe(0.1);
  });

  it("settles rather than oscillating, however long the frame", () => {
    let lean = { u: 0.1, v: 0.9, amount: 1 };
    for (let i = 0; i < 200; i += 1) {
      lean = easeMapLean(lean, { u: 0.6, v: 0.4 }, 0.1, 0.15);
    }
    expect(lean.u).toBeCloseTo(0.6, 6);
    expect(lean.v).toBeCloseTo(0.4, 6);
    expect(lean.amount).toBeCloseTo(1, 6);
  });

  it("is frame-rate independent: many small steps land where one big one does", () => {
    const goal = { u: 0.9, v: 0.2 };
    let fine = { u: 0.1, v: 0.8, amount: 1 };
    for (let i = 0; i < 12; i += 1) {
      fine = easeMapLean(fine, goal, 0.01, 0.15);
    }
    const coarse = easeMapLean({ u: 0.1, v: 0.8, amount: 1 }, goal, 0.12, 0.15);
    expect(fine.u).toBeCloseTo(coarse.u, 6);
    expect(fine.v).toBeCloseTo(coarse.v, 6);
  });

  it("does nothing on a zero or negative frame delta", () => {
    expect(easeMapLean(REST, { u: 1, v: 1 }, 0, 0.15)).toBe(REST);
    expect(easeMapLean(REST, { u: 1, v: 1 }, -1, 0.15)).toBe(REST);
  });
});
