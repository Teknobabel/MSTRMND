import type { ContentCatalog, WantedLevelTier } from "./types";

/**
 * Highest tier index such that `infamy >= tiers[i].minInfamy`.
 * Assumes `tiers` is non-empty and sorted by ascending `minInfamy`.
 */
export function tierIndexForInfamy(infamy: number, tiers: readonly WantedLevelTier[]): number {
  let best = 0;
  for (let i = 0; i < tiers.length; i += 1) {
    if (infamy >= tiers[i]!.minInfamy) {
      best = i;
    }
  }
  return best;
}

/** Monotonic wanted tier: never lower than `prevIndex`. */
export function nextMonotonicWantedTierIndex(
  prevIndex: number,
  infamy: number,
  tiers: readonly WantedLevelTier[],
): number {
  if (tiers.length === 0) {
    return 0;
  }
  const fromInfamy = tierIndexForInfamy(infamy, tiers);
  const cappedPrev = Math.max(0, Math.min(prevIndex, tiers.length - 1));
  return Math.max(cappedPrev, fromInfamy);
}

export function wantedTierAtIndex(
  catalog: ContentCatalog,
  index: number,
): WantedLevelTier | undefined {
  const tiers = catalog.wantedLevels;
  if (index < 0 || index >= tiers.length) {
    return undefined;
  }
  return tiers[index];
}

export function maxOpposingAgentsForWantedIndex(
  catalog: ContentCatalog,
  index: number,
): number {
  const tier = wantedTierAtIndex(catalog, index);
  return tier?.maxAgents ?? 0;
}
