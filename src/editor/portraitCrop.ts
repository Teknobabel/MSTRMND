/**
 * Geometry for the editor's compact-portrait crop. Pure and DOM-free so the rules that decide
 * where the box may sit are testable without a canvas.
 *
 * Two coordinate systems meet here. The crop is **stored** as percentages of the source image
 * (`PortraitCrop`), so it survives the portrait behind it being re-exported at another size. It
 * is **dragged** in source pixels, because the box has to stay square in pixels — the compact
 * boxes in game are all squares — and a square in pixels is not a square in percentages unless
 * the source happens to be square, which a 9:16 portrait is not.
 */
import type { PortraitCrop } from "../game/types";

/**
 * Side of the baked square, in pixels. The largest compact box in game is the map callout's
 * 40px (`.map-callout__portrait`), so 256 covers it at any stage scale and device pixel ratio
 * with room over — and still weighs a fraction of the full portrait it was cut from, which is
 * most of the point of baking a separate file at all.
 */
export const COMPACT_ART_SIZE = 256;

/** WebP quality for the bake. High enough that the re-encode is invisible at 40px. */
export const COMPACT_ART_QUALITY = 0.9;

/** A square region of the source, in source pixels. What the drag interaction works in. */
export type CropSquare = {
  x: number;
  y: number;
  /** Side length; square by construction, unlike the stored percentage rect. */
  side: number;
};

/**
 * Where the box starts on a portrait nobody has cropped yet: head-and-shoulders out of the top
 * of the figure. A guess, and meant to be — it exists so the first drag is an adjustment rather
 * than a hunt. Sized off the *height* so it does not swallow over half of an upright portrait,
 * and capped at the width so it still fits a source that is wider than it is tall.
 */
export function defaultCropSquare(sourceW: number, sourceH: number): CropSquare {
  const side = Math.min(sourceW, sourceH * 0.35);
  return clampCropSquare(
    { x: (sourceW - side) / 2, y: sourceH * 0.03, side },
    sourceW,
    sourceH,
  );
}

/**
 * Pulls a square back inside the source, shrinking it first if it cannot fit at all. Order
 * matters: the side is capped before the origin is clamped, so a box dragged larger than the
 * image ends up filling it rather than hanging off one corner.
 */
export function clampCropSquare(sq: CropSquare, sourceW: number, sourceH: number): CropSquare {
  const side = Math.max(1, Math.min(sq.side, sourceW, sourceH));
  return {
    side,
    x: Math.max(0, Math.min(sq.x, sourceW - side)),
    y: Math.max(0, Math.min(sq.y, sourceH - side)),
  };
}

/** Pixel square ⇒ the percentage rect stored on the template. */
export function toPortraitCrop(
  sq: CropSquare,
  sourceW: number,
  sourceH: number,
): PortraitCrop {
  const pct = (v: number, total: number): number =>
    total <= 0 ? 0 : Math.round((v / total) * 10000) / 100;
  return {
    x: pct(sq.x, sourceW),
    y: pct(sq.y, sourceH),
    w: pct(sq.side, sourceW),
    h: pct(sq.side, sourceH),
  };
}

/**
 * Stored rect ⇒ the pixel square to reopen the box at. `w` and `h` describe the same side in
 * two different percentages, and rounding on the way out means they rarely agree to the pixel
 * when read back, so the smaller wins: a box a hair inside where it was beats one a hair over
 * an edge, which `clampCropSquare` would then shift rather than shrink.
 */
export function fromPortraitCrop(
  crop: PortraitCrop,
  sourceW: number,
  sourceH: number,
): CropSquare {
  const side = Math.min((crop.w / 100) * sourceW, (crop.h / 100) * sourceH);
  return clampCropSquare(
    { x: (crop.x / 100) * sourceW, y: (crop.y / 100) * sourceH, side },
    sourceW,
    sourceH,
  );
}

/**
 * True when a stored crop is a usable rect — four finite numbers describing a box with area.
 * Draft rows are unvalidated JSON, so the crop the editor reopens may be anything at all; a
 * crop that fails this is simply replaced by {@link defaultCropSquare}.
 */
export function isUsablePortraitCrop(value: unknown): value is PortraitCrop {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const r = value as Record<string, unknown>;
  const ok = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v) && v >= 0;
  return ok(r.x) && ok(r.y) && ok(r.w) && ok(r.h) && (r.w as number) > 0 && (r.h as number) > 0;
}
