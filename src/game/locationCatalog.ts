import type {
  ContentCatalog,
  LocationSecurityState,
  LocationTemplate,
  MapTemplate,
} from "./types";
import { getOmegaPlanById } from "./omegaPlan";

export function getLocationById(
  catalog: ContentCatalog,
  id: string,
): LocationTemplate | undefined {
  return catalog.locations.find((l) => l.id === id);
}

/**
 * Locations playable this run: full catalog when no omega plan; otherwise the chosen plan's map order.
 */
export function locationTemplatesForOmegaPlan(
  catalog: ContentCatalog,
  activeOmegaPlanId: string | null,
): LocationTemplate[] {
  if (activeOmegaPlanId === null) {
    return catalog.locations;
  }
  const plan = getOmegaPlanById(catalog, activeOmegaPlanId);
  if (!plan) {
    return catalog.locations;
  }
  const map = getMapById(catalog, plan.mapId);
  if (!map) {
    return [];
  }
  const out: LocationTemplate[] = [];
  for (const lid of map.locationIds) {
    const loc = getLocationById(catalog, lid);
    if (loc !== undefined) {
      out.push(loc);
    }
  }
  return out;
}

export function activeLocationIds(
  catalog: ContentCatalog,
  activeOmegaPlanId: string | null,
): Set<string> {
  return new Set(
    locationTemplatesForOmegaPlan(catalog, activeOmegaPlanId).map((l) => l.id),
  );
}

/**
 * Default per-location security when starting a run (gameplay may change these).
 */
export function initialLocationSecurityStatesForLocations(
  locations: LocationTemplate[],
): LocationSecurityState[] {
  return locations.map((l) => ({
    locationId: l.id,
    securityLevel: 0,
  }));
}

/**
 * One security row per catalog location (legacy helper).
 */
export function initialLocationSecurityStates(
  catalog: ContentCatalog,
): LocationSecurityState[] {
  return initialLocationSecurityStatesForLocations(catalog.locations);
}

export function getMapById(catalog: ContentCatalog, id: string): MapTemplate | undefined {
  return catalog.maps.find((m) => m.id === id);
}

/**
 * Pick up to `count` distinct trait ids from `pool` (without replacement). If the pool is
 * smaller than `count`, returns as many distinct ids as exist.
 */
function pickDistinctTraitIds(
  pool: string[],
  count: number,
  rng: () => number,
): string[] {
  if (count <= 0 || pool.length === 0) {
    return [];
  }
  const copy = [...pool];
  const take = Math.min(count, copy.length);
  const out: string[] = [];
  for (let i = 0; i < take; i += 1) {
    const j = Math.floor(rng() * copy.length);
    out.push(copy[j]!);
    copy.splice(j, 1);
  }
  return out;
}

/**
 * Per-run required traits for each map location (not in JSON).
 * Level 1 → 0 traits; level 2 → 1; level 3 → 2 distinct picks from primary + secondary only.
 */
export function rollLocationRequiredTraits(
  catalog: ContentCatalog,
  runLocations: LocationTemplate[],
  rng: () => number,
): Record<string, string[]> {
  const eligible = catalog.traits
    .filter((t) => t.type !== "status")
    .map((t) => t.id);
  const out: Record<string, string[]> = {};
  for (const loc of runLocations) {
    const n = loc.locationLevel === 1 ? 0 : loc.locationLevel === 2 ? 1 : 2;
    out[loc.id] = pickDistinctTraitIds(eligible, n, rng);
  }
  return out;
}
