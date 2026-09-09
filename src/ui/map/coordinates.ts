/**
 * Map space read back as latitude and longitude, for the hover readout.
 *
 * Decoration, and honest about it. The shipped art is stylised and does not hold to a strict
 * equirectangular grid — its markers were placed against the coastlines by eye rather than
 * projected from real coordinates (see `scripts/map-calibrate.mjs`) — so what comes back here is
 * where a site sits *on the picture*, expressed the way a console would express it. It is not a
 * claim about where anywhere is on Earth.
 *
 * That still leaves it internally consistent, which is the part that matters for something the
 * player reads: one site always gives the same coordinates, a site west of another always reads
 * further west, and a site nearer the top always reads further north. A readout that wandered
 * between hovers would be noticed immediately; one that is merely approximate will not be.
 */

export interface Geographic {
  /** Degrees, positive north. */
  readonly latitude: number;
  /** Degrees, positive east. */
  readonly longitude: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * @param u 0..1 across the map.
 * @param v 0..1 down the map, the same downward axis the camera and markers use.
 */
export function mapPointToGeographic(u: number, v: number): Geographic {
  return {
    longitude: clamp01(u) * 360 - 180,
    /* v runs downward and latitude runs upward, hence the subtraction rather than a scale. */
    latitude: 90 - clamp01(v) * 180,
  };
}

/**
 * One axis as a fixed-width field: sign folded into a hemisphere letter, and the degrees padded
 * so the readout keeps its shape.
 *
 * The padding is not decoration. The readout sits in a reticle that tracks the pointer from pin
 * to pin, and a field that changed width between `9.4°N` and `41.2°N` would make the whole thing
 * twitch as the hand moved across the map.
 */
function formatAxis(degrees: number, positive: string, negative: string, width: number): string {
  const hemisphere = degrees < 0 ? negative : positive;
  const magnitude = Math.abs(degrees).toFixed(1);
  const [whole = "0", fraction = "0"] = magnitude.split(".");
  return `${whole.padStart(width, "0")}.${fraction}°${hemisphere}`;
}

/** The pair as one string, latitude first, the way a chart would give it. */
export function formatMapCoordinates(u: number, v: number): string {
  const { latitude, longitude } = mapPointToGeographic(u, v);
  return `${formatAxis(latitude, "N", "S", 2)} ${formatAxis(longitude, "E", "W", 3)}`;
}
