import type { MinionInstance, MissionTemplate } from "./types";

export type MissionSuccessOptions = {
  /** Extra required trait ids from situational modifiers; merged with template (deduped). */
  additionalRequiredTraitIds?: string[];
  /** Current player inventory (`Asset.id` → quantity) for required-asset checks. */
  playerAssets?: Record<string, number>;
};

/**
 * Union of all trait ids held by any participating minion.
 */
export function unionParticipantTraitIds(participants: MinionInstance[]): Set<string> {
  const out = new Set<string>();
  for (const p of participants) {
    for (const id of p.traitIds) {
      out.add(id);
    }
  }
  return out;
}

/**
 * True when the player can start a mission with this roster (1–3 minions).
 */
export function canAssignParticipants(participants: MinionInstance[]): boolean {
  return participants.length >= 1 && participants.length <= 3;
}

function mergeRequiredTraitSet(
  template: MissionTemplate,
  options?: MissionSuccessOptions,
): Set<string> {
  const merged = new Set<string>(template.requiredTraitIds);
  for (const id of options?.additionalRequiredTraitIds ?? []) {
    if (id.length > 0) {
      merged.add(id);
    }
  }
  return merged;
}

/** All required trait ids (mission + extras), stable alphabetical order for UI. */
export function mergedRequiredTraitIdsSorted(
  template: MissionTemplate,
  options?: MissionSuccessOptions,
): string[] {
  return [...mergeRequiredTraitSet(template, options)].sort((a, b) => a.localeCompare(b));
}

/** Count occurrences per id (multiset). */
export function countMultiset(ids: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const id of ids) {
    m.set(id, (m.get(id) ?? 0) + 1);
  }
  return m;
}

/**
 * How many required asset *slots* are satisfied by inventory (each distinct id needs
 * min(requiredCount, playerQty) toward the sum, capped by total required occurrences).
 */
export function matchedAssetUnits(
  requiredAssetIds: string[],
  playerAssets: Record<string, number> | undefined,
): number {
  if (requiredAssetIds.length === 0) {
    return 0;
  }
  const need = countMultiset(requiredAssetIds);
  const inv = playerAssets ?? {};
  let matched = 0;
  for (const [id, count] of need) {
    matched += Math.min(count, inv[id] ?? 0);
  }
  return matched;
}

/**
 * Linear success: (matched distinct traits + matched asset units) /
 * (required trait count + required asset occurrence count). Uses current `playerAssets`
 * when provided; missing inventory counts as no assets.
 */
export function successChancePercent(
  template: MissionTemplate,
  participants: MinionInstance[],
  options?: MissionSuccessOptions,
): number {
  const traitRequired = [...mergeRequiredTraitSet(template, options)];
  const assetRequired = template.requiredAssetIds;
  const totalTraits = traitRequired.length;
  const totalAssets = assetRequired.length;
  const total = totalTraits + totalAssets;
  if (total === 0) {
    return 100;
  }
  const union = unionParticipantTraitIds(participants);
  let matchedTraits = 0;
  for (const id of traitRequired) {
    if (union.has(id)) {
      matchedTraits += 1;
    }
  }
  const matchedAssets = matchedAssetUnits(assetRequired, options?.playerAssets);
  return Math.round((100 * (matchedTraits + matchedAssets)) / total);
}
