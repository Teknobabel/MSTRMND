/**
 * Pure helpers for uploaded card art. Browser-safe (no Node imports) so both the
 * editor page and the dev-server plugin (`vite.config.ts`) share one implementation
 * of the filename and WebP rules.
 */

/** Directory (under `public/`) that uploads are written to. */
export const ART_UPLOAD_DIR = "public/assets/cards/custom";
/** Site-root URL prefix for uploaded art (what `cardArt` fields store). */
export const ART_URL_PREFIX = "/assets/cards/custom/";
/** Upload size cap. */
export const MAX_ART_BYTES = 8 * 1024 * 1024;

/**
 * Reduce an arbitrary file name to a safe slug (lowercase `a-z0-9-`), dropping any
 * `.webp` extension. Returns null when nothing usable remains — callers must treat
 * that as a rejected upload, never fall back to the raw name.
 */
export function sanitizeArtFileName(name: string): string | null {
  const slug = name
    .replace(/\.webp$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? null : slug;
}

function tagAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

/** True when the bytes start with a real WebP header (`RIFF....WEBP`). */
export function isWebpBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && tagAt(bytes, 0) === "RIFF" && tagAt(bytes, 8) === "WEBP";
}

/**
 * True when the WebP contains an `ANIM` chunk (animated WebP). Walks the RIFF
 * chunk list; malformed files simply return false.
 */
export function webpHasAnimation(bytes: Uint8Array): boolean {
  if (!isWebpBytes(bytes)) {
    return false;
  }
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const tag = tagAt(bytes, offset);
    if (tag === "ANIM") {
      return true;
    }
    const size =
      (bytes[offset + 4] ?? 0) |
      ((bytes[offset + 5] ?? 0) << 8) |
      ((bytes[offset + 6] ?? 0) << 16) |
      ((bytes[offset + 7] ?? 0) << 24);
    if (size < 0) {
      return false;
    }
    /* Chunk payloads are padded to even length. */
    offset += 8 + size + (size % 2);
  }
  return false;
}
