import type { ContentCatalog, LairTemplate } from "./types";

/** Synthetic `ActiveMission.locationId` when the mission was started from the lair (not a map location). */
export const LAIR_LOCATION_ID = "__lair";

export function getLairById(
  catalog: ContentCatalog,
  id: string,
): LairTemplate | undefined {
  return catalog.lairs.find((l) => l.id === id);
}

/**
 * Picks a random lair id for a new run, or null if the catalog has none.
 */
export function pickRandomLairId(catalog: ContentCatalog, rng: () => number): string | null {
  const { lairs } = catalog;
  if (lairs.length === 0) {
    return null;
  }
  const i = Math.floor(rng() * lairs.length);
  return lairs[i]!.id;
}
