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
    securityLevel: 1,
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
