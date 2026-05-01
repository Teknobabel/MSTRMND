import type {
  ContentCatalog,
  LocationSecurityState,
  LocationTemplate,
  MapTemplate,
  MissionTemplate,
} from "./types";

export function getLocationById(
  catalog: ContentCatalog,
  id: string,
): LocationTemplate | undefined {
  return catalog.locations.find((l) => l.id === id);
}

/**
 * Default per-location security when starting a run (gameplay may change these).
 */
export function initialLocationSecurityStates(
  catalog: ContentCatalog,
): LocationSecurityState[] {
  return catalog.locations.map((l) => ({
    locationId: l.id,
    securityLevel: 1,
  }));
}

export function getMapById(catalog: ContentCatalog, id: string): MapTemplate | undefined {
  return catalog.maps.find((m) => m.id === id);
}

/**
 * Resolves `location.availableMissionIds` to mission templates in list order.
 * Unknown ids are skipped (should not occur after catalog parse).
 */
export function missionTemplatesForLocation(
  catalog: ContentCatalog,
  location: LocationTemplate,
): MissionTemplate[] {
  const byId = new Map(catalog.missions.map((m) => [m.id, m] as const));
  const out: MissionTemplate[] = [];
  for (const mid of location.availableMissionIds) {
    const mission = byId.get(mid);
    if (mission !== undefined) {
      out.push(mission);
    }
  }
  return out;
}
