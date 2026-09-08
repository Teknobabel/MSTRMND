/**
 * Where a map marker lands on screen.
 *
 * Sites are authored in `content/maps.json` as percentages of the map art (see `MapMarker`),
 * but they are rendered as real DOM buttons layered over that art, because the pins are an
 * interaction surface and not decoration: they carry the mission-target drag payload, take
 * focus, own their tooltips, and anchor the active-operation callouts. A projector is the one
 * seam between those two facts. It turns an authored marker into a position in the plot's own
 * CSS pixels, and the marker layer writes that out as a transform.
 *
 * Putting that behind an interface is what lets the art underneath stop being a stretched
 * image — a tilted plane, eventually a globe — without touching a line of the interaction
 * code. An animated projector runs the same markers through its camera every frame and reports
 * a pin as not visible when the geometry turns it away from the viewer. {@link projectFlat} is
 * the identity case, and reproduces the `left: x%` / `top: y%` layout the panel shipped with.
 */

import { transformVec4, type Mat4 } from "./mat4";

export { transformVec4, type Mat4 };

/**
 * The plot box in its own, unscaled CSS pixels.
 *
 * Read this from a `ResizeObserver` entry's `contentBoxSize`, never from
 * `getBoundingClientRect()`: the game shell sits inside a `scale(var(--ui-scale))` transform
 * (and a `rotate(90deg)` on a portrait phone), so a rect is in post-scale visual pixels with
 * the axes possibly swapped, while a transform written onto a child of that shell is read in
 * pre-scale layout pixels. Observer box sizes are already in that layout space, and unlike
 * `offsetWidth` they are fractional — whole-pixel rounding here is enough to shift a pin at
 * the edge of the map off the land it was authored on.
 */
export interface PlotSize {
  readonly width: number;
  readonly height: number;
}

/** An authored marker position: percentages of the art box, left/top origin. */
export interface MarkerPoint {
  readonly x: number;
  readonly y: number;
}

export interface ProjectedMarker {
  /** Plot-space CSS px, measured from the plot's top-left corner. */
  readonly x: number;
  readonly y: number;
  /** False when the geometry hides this pin — the far side of a globe, or off-frame. */
  readonly visible: boolean;
}

export interface MapProjector {
  project(marker: MarkerPoint, plot: PlotSize): ProjectedMarker;
}

/**
 * The flat map: art stretched to fill the panel (`object-fit: fill`), so a marker's
 * percentages are a straight linear read of the plot box and no pin is ever hidden.
 */
export function projectFlat(marker: MarkerPoint, plot: PlotSize): ProjectedMarker {
  return {
    x: (marker.x / 100) * plot.width,
    y: (marker.y / 100) * plot.height,
    visible: true,
  };
}

export function createFlatProjector(): MapProjector {
  return { project: projectFlat };
}


/**
 * Map space is the unit square: `u` runs 0..1 left to right, `v` runs 0..1 **top to bottom**
 * (matching how markers are authored, and how the art's rows are read once the texture is
 * uploaded flipped). A marker's authored percentages are simply `x/100`, `y/100`.
 */
export function markerToMapSpace(marker: MarkerPoint): { u: number; v: number } {
  return { u: marker.x / 100, v: marker.y / 100 };
}

/**
 * The camera that reproduces `object-fit: fill` — the unit square stretched corner to corner
 * over the plot, no perspective. Step 2's renderer draws with exactly this, which is what
 * makes the GPU path pixel-identical to the stretched `<img>` it replaced; giving the plane a
 * tilt later means replacing this one matrix, and both the art and the pins follow it.
 *
 *   u = 0 -> clip x = -1 (left edge)      v = 0 -> clip y =  1 (top edge)
 *   u = 1 -> clip x =  1 (right edge)     v = 1 -> clip y = -1 (bottom edge)
 */
export function flatMapMatrix(): Mat4 {
  // prettier-ignore
  return new Float32Array([
    2, 0, 0, 0,
    0, -2, 0, 0,
    0, 0, 1, 0,
    -1, 1, 0, 1,
  ]);
}

/**
 * Run a marker through the same matrix the plane is drawn with, and land it in plot pixels.
 *
 * This is the projector that makes a moving map possible: the pin is placed by the camera
 * rather than by the art, so however the plane is tilted, spun or pushed in, the DOM marker
 * on top of it stays on the site it was authored on. A vertex behind the camera (`w <= 0`)
 * or outside the clip volume is reported as not visible rather than mirrored to a nonsense
 * position, which is what would otherwise happen to a site on the far side of a globe.
 */
export function projectMatrix(marker: MarkerPoint, plot: PlotSize, mvp: Mat4): ProjectedMarker {
  const { u, v } = markerToMapSpace(marker);
  const [cx, cy, cz, cw] = transformVec4(mvp, u, v, 0, 1);
  if (cw <= 0) {
    return { x: 0, y: 0, visible: false };
  }
  const ndcX = cx / cw;
  const ndcY = cy / cw;
  const ndcZ = cz / cw;
  return {
    x: (ndcX * 0.5 + 0.5) * plot.width,
    y: (0.5 - ndcY * 0.5) * plot.height,
    /* Depth outside [-1, 1] is behind the near plane or past the far plane; a small slack on
     * x/y keeps a pin that is only just off-frame alive so it can slide back in smoothly. */
    visible: ndcZ >= -1 && ndcZ <= 1 && Math.abs(ndcX) <= 1.5 && Math.abs(ndcY) <= 1.5,
  };
}

/**
 * A projector driven by a live camera. The matrix is pulled per call rather than captured, so
 * an animated camera needs no re-registration of the markers — the next sync just reads the
 * new one.
 */
export function createMatrixProjector(getMvp: () => Mat4): MapProjector {
  return {
    project: (marker, plot) => projectMatrix(marker, plot, getMvp()),
  };
}
