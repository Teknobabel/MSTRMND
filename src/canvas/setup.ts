/**
 * 2D context with alpha; swap for "bitmaprenderer" later if you pipeline to ImageBitmap.
 */
export function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) {
    throw new Error("Could not get 2d context");
  }
  return ctx;
}

/**
 * Sizes the canvas backing store to CSS pixels (devicePixelRatio-aware).
 */
export function resizeCanvasToDisplaySize(canvas: HTMLCanvasElement): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}
