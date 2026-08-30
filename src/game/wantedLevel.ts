import type { ContentCatalog, WantedLevelTier } from "./types";

/**
 * Highest tier index such that `heat >= tiers[i].minHeat`.
 * Assumes `tiers` is non-empty and sorted by ascending `minHeat`.
 */
export function tierIndexForHeat(heat: number, tiers: readonly WantedLevelTier[]): number {
  let best = 0;
  for (let i = 0; i < tiers.length; i += 1) {
    if (heat >= tiers[i]!.minHeat) {
      best = i;
    }
  }
  return best;
}

/** Monotonic wanted tier: never lower than `prevIndex`. */
export function nextMonotonicWantedTierIndex(
  prevIndex: number,
  heat: number,
  tiers: readonly WantedLevelTier[],
): number {
  if (tiers.length === 0) {
    return 0;
  }
  const fromHeat = tierIndexForHeat(heat, tiers);
  const cappedPrev = Math.max(0, Math.min(prevIndex, tiers.length - 1));
  return Math.max(cappedPrev, fromHeat);
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

export function heatGainForWantedIndex(
  catalog: ContentCatalog,
  index: number,
): number {
  const tier = wantedTierAtIndex(catalog, index);
  return tier?.heatGainPerTurn ?? 0;
}
