import { describe, expect, it } from "vitest";
import {
  createFlatProjector,
  createMatrixProjector,
  flatMapMatrix,
  projectFlat,
  projectMatrix,
  transformVec4,
  type Mat4,
} from "./projection";

/** The map tile at stage scale 1: two of three dashboard columns, one of two rows. */
const TILE = { width: 1240, height: 470 } as const;

describe("projectFlat", () => {
  it("reads an authored percentage as a linear position in the plot box", () => {
    const p = projectFlat({ x: 11.2, y: 17.8 }, TILE);
    expect(p.x).toBeCloseTo(0.112 * TILE.width, 5);
    expect(p.y).toBeCloseTo(0.178 * TILE.height, 5);
  });

  it("pins the corners of the art to the corners of the plot", () => {
    expect(projectFlat({ x: 0, y: 0 }, TILE)).toMatchObject({ x: 0, y: 0 });
    const br = projectFlat({ x: 100, y: 100 }, TILE);
    expect(br.x).toBeCloseTo(TILE.width, 5);
    expect(br.y).toBeCloseTo(TILE.height, 5);
  });

  it("rescales with the plot instead of holding a pixel offset", () => {
    // The same site, tile view vs the fullscreen single-panel view: the art is stretched to
    // whatever box it is given, so the marker stays on the same painted land in both.
    const marker = { x: 47.8, y: 29.8 };
    const full = { width: 1880, height: 950 };
    expect(projectFlat(marker, full).x / full.width).toBeCloseTo(
      projectFlat(marker, TILE).x / TILE.width,
      10,
    );
  });

  it("never hides a pin: the flat map has no geometry to turn one away", () => {
    for (const m of [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 100 }]) {
      expect(projectFlat(m, TILE).visible).toBe(true);
    }
  });

  it("collapses to the origin for an unlaid-out plot rather than producing NaN", () => {
    // Guarded at the call site, but a zero box must still project to finite numbers: a NaN
    // here would reach the DOM as an invalid transform and strand every pin at 0,0.
    const p = projectFlat({ x: 47.8, y: 29.8 }, { width: 0, height: 0 });
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
  });

  it("exposes the same behaviour through the projector interface", () => {
    const marker = { x: 27, y: 30.2 };
    expect(createFlatProjector().project(marker, TILE)).toEqual(projectFlat(marker, TILE));
  });
});

/** Every site the shipped map plots, so the equivalence check runs on real authored data. */
const AUTHORED = [
  { x: 11.2, y: 17.8 },
  { x: 16, y: 29.2 },
  { x: 19.6, y: 33.4 },
  { x: 27, y: 30.2 },
  { x: 26.2, y: 40.4 },
  { x: 32.4, y: 67.2 },
  { x: 45.4, y: 25.8 },
  { x: 47.8, y: 29.8 },
  { x: 53.4, y: 41 },
  { x: 0, y: 0 },
  { x: 100, y: 100 },
];

describe("flatMapMatrix", () => {
  it("maps the corners of the unit square to the corners of the clip volume", () => {
    const m = flatMapMatrix();
    expect(transformVec4(m, 0, 0, 0, 1).slice(0, 2)).toEqual([-1, 1]); // top-left
    expect(transformVec4(m, 1, 0, 0, 1).slice(0, 2)).toEqual([1, 1]); // top-right
    expect(transformVec4(m, 0, 1, 0, 1).slice(0, 2)).toEqual([-1, -1]); // bottom-left
    expect(transformVec4(m, 1, 1, 0, 1).slice(0, 2)).toEqual([1, -1]); // bottom-right
  });

  it("keeps w at 1, so the flat camera has no perspective divide", () => {
    expect(transformVec4(flatMapMatrix(), 0.37, 0.62, 0, 1)[3]).toBe(1);
  });
});

describe("projectMatrix through the flat camera", () => {
  // The load-bearing claim of the WebGL swap: the GPU path places every pin exactly where the
  // stretched <img> did. If this drifts, the art moved out from under the markers.
  it("agrees with projectFlat on every authored site, to within a thousandth of a pixel", () => {
    const m = flatMapMatrix();
    for (const plot of [TILE, { width: 1070.531, height: 434.016 }, { width: 1880, height: 950 }]) {
      for (const marker of AUTHORED) {
        const flat = projectFlat(marker, plot);
        const viaMatrix = projectMatrix(marker, plot, m);
        expect(viaMatrix.x).toBeCloseTo(flat.x, 3);
        expect(viaMatrix.y).toBeCloseTo(flat.y, 3);
        expect(viaMatrix.visible).toBe(true);
      }
    }
  });
});

describe("projectMatrix visibility", () => {
  /** A crude perspective camera: everything with z behind the eye gets w <= 0. */
  const behindCamera: Mat4 = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, -1,
    0, 0, 0, 0,
  ]);

  it("hides a vertex that lands behind the camera instead of mirroring it", () => {
    const p = projectMatrix({ x: 50, y: 50 }, TILE, behindCamera);
    expect(p.visible).toBe(false);
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  });

  it("hides a vertex pushed past the far plane", () => {
    // Same flat placement, but depth forced well outside [-1, 1].
    const deep = flatMapMatrix();
    deep[14] = 5; // translate z
    expect(projectMatrix({ x: 50, y: 50 }, TILE, deep).visible).toBe(false);
  });

  it("keeps a pin that is only just off-frame alive so it can slide back in", () => {
    const shifted = flatMapMatrix();
    shifted[12] = -1.3; // the left edge of the map now sits 0.3 past the left of the frame
    const p = projectMatrix({ x: 0, y: 50 }, TILE, shifted);
    expect(p.visible).toBe(true);
    expect(p.x).toBeLessThan(0);
  });

  it("drops a pin that has left the frame entirely", () => {
    const shifted = flatMapMatrix();
    shifted[12] = -4;
    expect(projectMatrix({ x: 0, y: 50 }, TILE, shifted).visible).toBe(false);
  });
});

describe("createMatrixProjector", () => {
  it("re-reads the camera on every call, so an animated one needs no re-registration", () => {
    let m = flatMapMatrix();
    const projector = createMatrixProjector(() => m);
    const before = projector.project({ x: 50, y: 50 }, TILE);
    const moved = flatMapMatrix();
    moved[12] = -1 + 0.5;
    m = moved;
    const after = projector.project({ x: 50, y: 50 }, TILE);
    expect(after.x).toBeCloseTo(before.x + 0.25 * TILE.width, 6);
  });
});
