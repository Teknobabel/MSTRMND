import type { MapMarker } from "../../game/types";

/**
 * What the map has to say about a site, reduced to the few numbers a shader can act on.
 *
 * This is the seam between the game and the picture. Everything the map animates in response to
 * play comes through here, which keeps the rendering ignorant of `GameState` and keeps the
 * rules that decide *when* the map lights up in one testable place.
 *
 * A site with nothing to say is dropped rather than emitted at zero: a fresh run therefore
 * draws no glows at all and the map lights up only as the player makes something happen, which
 * is both the honest reading and one draw call per lit site instead of per plotted one.
 */
export interface MapSiteSignal {
  readonly locationId: string;
  /** Map space — 0..1 with `v` running downward, the coordinates the camera consumes. */
  readonly u: number;
  readonly v: number;
  /** 0..1: how hardened the site has become, as a fraction of its own ceiling. */
  readonly security: number;
  /** 1 while one of the player's operations is running here. */
  readonly operation: number;
  /** 1 for the site currently staged as a mission target. */
  readonly targeted: number;
}

export interface MapSiteSignalInput {
  /** Plotted sites, in authoring order. */
  readonly markers: readonly MapMarker[];
  /** Sites in play this run; a marker for anything else is not drawn. */
  readonly playableLocationIds: ReadonlySet<string>;
  /** Current security level per site. */
  readonly securityLevelByLocation: ReadonlyMap<string, number>;
  /**
   * Each site's own ceiling — `locationLevel`, 1 to 3. Security is reported as a fraction of it
   * so a level-1 site at its maximum reads as hot as a level-3 site at its maximum, rather than
   * a third as hot. What the glow means is "as locked down as this place gets".
   */
  readonly maxSecurityByLocation: ReadonlyMap<string, number>;
  /** Sites with one of the player's operations running against them. */
  readonly operationLocationIds: ReadonlySet<string>;
  /** The site staged in the assign panel, if any. */
  readonly targetedLocationId: string | null;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function mapSiteSignals(input: MapSiteSignalInput): MapSiteSignal[] {
  const out: MapSiteSignal[] = [];
  for (const marker of input.markers) {
    const id = marker.locationId;
    if (!input.playableLocationIds.has(id)) {
      continue;
    }
    const max = input.maxSecurityByLocation.get(id) ?? 0;
    const level = input.securityLevelByLocation.get(id) ?? 0;
    const security = max > 0 ? clamp01(level / max) : 0;
    const operation = input.operationLocationIds.has(id) ? 1 : 0;
    const targeted = input.targetedLocationId === id ? 1 : 0;
    if (security === 0 && operation === 0 && targeted === 0) {
      continue;
    }
    out.push({
      locationId: id,
      u: marker.x / 100,
      v: marker.y / 100,
      security,
      operation,
      targeted,
    });
  }
  return out;
}
