import type { MinionInstance, MissionTemplate, Trait } from "./types";

export type MissionSuccessOptions = {
  /** Extra required trait ids from situational modifiers; merged with template (deduped). */
  additionalRequiredTraitIds?: string[];
  /** Current player inventory (`Asset.id` → quantity) for required-asset checks. */
  playerAssets?: Record<string, number>;
  /** When set, status_positive / status_negative traits on participants adjust success %. */
  traitsCatalog?: readonly Trait[];
  /** Opposing agents at the mission site: each applies a flat −20% to success chance (default 0). */
  opposingAgentPenaltyCount?: number;
  /** Flat % delta from participants' dynamic traits (relationships / hero / wanted). */
  dynamicTraitDelta?: number;
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
 * True when the player can start a mission with this roster (1–max participants).
 */
export function canAssignParticipants(
  participants: MinionInstance[],
  maxParticipantsPerMission: number,
): boolean {
  const cap = Math.max(1, maxParticipantsPerMission);
  return participants.length >= 1 && participants.length <= cap;
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

const STATUS_POSITIVE_BONUS = 10;
const STATUS_NEGATIVE_PENALTY = 20;
/** Flat success % reduction per opposing agent at the mission's target site. */
export const OPPOSING_AGENT_SUCCESS_PENALTY = 20;

export type StatusTraitSuccessEntry = {
  instanceId: string;
  templateId: string;
  traitId: string;
  /** +10 for status_positive, −20 for status_negative. */
  delta: number;
};

function participantStatusModifierEntries(
  participants: MinionInstance[],
  traitsCatalog: readonly Trait[] | undefined,
): StatusTraitSuccessEntry[] {
  if (traitsCatalog === undefined || traitsCatalog.length === 0) {
    return [];
  }
  const byId = new Map(traitsCatalog.map((t) => [t.id, t] as const));
  const out: StatusTraitSuccessEntry[] = [];
  for (const p of participants) {
    for (const tid of p.traitIds) {
      const t = byId.get(tid);
      if (t === undefined) {
        continue;
      }
      if (t.type === "status_positive") {
        out.push({
          instanceId: p.instanceId,
          templateId: p.templateId,
          traitId: tid,
          delta: STATUS_POSITIVE_BONUS,
        });
      } else if (t.type === "status_negative") {
        out.push({
          instanceId: p.instanceId,
          templateId: p.templateId,
          traitId: tid,
          delta: -STATUS_NEGATIVE_PENALTY,
        });
      }
    }
  }
  return out;
}

/** Intermediate values for {@link successChancePercent} (same formula). */
export type SuccessChanceBreakdown = {
  finalPercent: number;
  /** Before clamping to [0, 100]. */
  preClampPercent: number;
  basePercent: number;
  requiredTraitCount: number;
  requiredAssetSlotCount: number;
  matchedTraits: number;
  matchedAssets: number;
  missingTraitIds: string[];
  statusDelta: number;
  statusEntries: StatusTraitSuccessEntry[];
  dynamicTraitDelta: number;
  opposingAgentCount: number;
  opposingAgentPenaltyTotal: number;
};

export function computeSuccessChanceBreakdown(
  template: MissionTemplate,
  participants: MinionInstance[],
  options?: MissionSuccessOptions,
): SuccessChanceBreakdown {
  const traitRequired = [...mergeRequiredTraitSet(template, options)];
  const assetRequired = template.requiredAssetIds;
  const totalTraits = traitRequired.length;
  const totalAssets = assetRequired.length;
  const total = totalTraits + totalAssets;
  const union = unionParticipantTraitIds(participants);
  let matchedTraits = 0;
  const missingTraitIds: string[] = [];
  for (const id of traitRequired) {
    if (union.has(id)) {
      matchedTraits += 1;
    } else {
      missingTraitIds.push(id);
    }
  }
  const matchedAssets = matchedAssetUnits(assetRequired, options?.playerAssets);
  const base =
    total === 0 ? 100 : Math.round((100 * (matchedTraits + matchedAssets)) / total);
  const statusEntries = participantStatusModifierEntries(participants, options?.traitsCatalog);
  const statusDelta = statusEntries.reduce((s, e) => s + e.delta, 0);
  const dyn = options?.dynamicTraitDelta ?? 0;
  const opposingAgentCount = Math.max(0, options?.opposingAgentPenaltyCount ?? 0);
  const opposingAgentPenaltyTotal = OPPOSING_AGENT_SUCCESS_PENALTY * opposingAgentCount;
  const preClampPercent = base + statusDelta + dyn - opposingAgentPenaltyTotal;
  const finalPercent = Math.min(100, Math.max(0, preClampPercent));
  return {
    finalPercent,
    preClampPercent,
    basePercent: base,
    requiredTraitCount: totalTraits,
    requiredAssetSlotCount: totalAssets,
    matchedTraits,
    matchedAssets,
    missingTraitIds,
    statusDelta,
    statusEntries,
    dynamicTraitDelta: dyn,
    opposingAgentCount,
    opposingAgentPenaltyTotal,
  };
}

/**
 * Linear success: (matched distinct traits + matched asset units) /
 * (required trait count + required asset occurrence count). Uses current `playerAssets`
 * when provided; missing inventory counts as no assets. Then applies flat +10% per
 * participating `status_positive` trait occurrence and −20% per `status_negative`,
 * then `dynamicTraitDelta`, then −20% per `opposingAgentPenaltyCount`, clamped to [0, 100].
 */
export function successChancePercent(
  template: MissionTemplate,
  participants: MinionInstance[],
  options?: MissionSuccessOptions,
): number {
  return computeSuccessChanceBreakdown(template, participants, options).finalPercent;
}
