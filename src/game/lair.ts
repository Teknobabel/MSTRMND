import type { ContentCatalog, LairTemplate } from "./types";

/** Upgrade missions not yet completed successfully this run (for UI / assignment). */
export function pendingLairUpgradeMissionIds(
  activeLairId: string | null,
  completedLairUpgradeMissionIds: readonly string[],
  catalog: ContentCatalog,
): string[] {
  if (activeLairId === null) {
    return [];
  }
  const lair = getLairById(catalog, activeLairId);
  if (!lair) {
    return [];
  }
  return lair.upgradeMissionIds.filter(
    (id) => !completedLairUpgradeMissionIds.includes(id),
  );
}

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
