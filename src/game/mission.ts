import type {
  Asset,
  BalanceConfig,
  IntelLevel,
  LocationLevel,
  LocationTemplate,
  LocationType,
  MinionInstance,
  MissionTargetType,
  MissionTemplate,
  SecurityLevel,
  SupportAssetAbility,
  SupportAssetAbilityKind,
  Trait,
} from "./types";
import { DEFAULT_BALANCE } from "./types";

/**
 * The site filters a designer may put on a mission. Both are optional and independent: an
 * absent (or empty) list means that dimension is unrestricted.
 */
export type MissionTargetLocationFilters = Pick<
  MissionTemplate,
  | "targetLocationTypes"
  | "targetLocationLevels"
  | "targetLocationIntelLevels"
  | "targetLocationSecurityLevels"
>;

/**
 * Everything the site filters judge a candidate site on: its catalog row plus the two
 * per-run levels, which live in `GameState` rather than the location template.
 */
export type MissionTargetSite = {
  location: LocationTemplate;
  intelLevel: IntelLevel;
  securityLevel: SecurityLevel;
};

/**
 * Target types whose runtime target resolves to a map location — the only ones the site
 * filters can mean anything for (`minion` / `none` targets have no site).
 */
export function missionTargetTypeTargetsLocation(targetType: MissionTargetType): boolean {
  return (
    targetType === "location" || targetType === "asset_hidden" || targetType === "asset_revealed"
  );
}

/** Whether `targetLocationTypes` admits `locationType` (absent / empty ⇒ every type). */
export function missionAllowsTargetLocationType(
  filters: MissionTargetLocationFilters,
  locationType: LocationType,
): boolean {
  const allowed = filters.targetLocationTypes;
  return allowed === undefined || allowed.length === 0 || allowed.includes(locationType);
}

/** Whether `targetLocationLevels` admits `locationLevel` (absent / empty ⇒ every level). */
export function missionAllowsTargetLocationLevel(
  filters: MissionTargetLocationFilters,
  locationLevel: LocationLevel,
): boolean {
  const allowed = filters.targetLocationLevels;
  return allowed === undefined || allowed.length === 0 || allowed.includes(locationLevel);
}

/**
 * Whether `targetLocationIntelLevels` admits `intelLevel` (absent / empty ⇒ every level).
 * Takes the level rather than the site because intel is **per-run state**, not catalog data.
 */
export function missionAllowsTargetLocationIntel(
  filters: MissionTargetLocationFilters,
  intelLevel: IntelLevel,
): boolean {
  const allowed = filters.targetLocationIntelLevels;
  return allowed === undefined || allowed.length === 0 || allowed.includes(intelLevel);
}

/**
 * Whether `targetLocationSecurityLevels` admits `securityLevel` (absent / empty ⇒ every
 * level). Per-run state, like {@link missionAllowsTargetLocationIntel}.
 */
export function missionAllowsTargetLocationSecurity(
  filters: MissionTargetLocationFilters,
  securityLevel: SecurityLevel,
): boolean {
  const allowed = filters.targetLocationSecurityLevels;
  return allowed === undefined || allowed.length === 0 || allowed.includes(securityLevel);
}

/** Every site filter at once — what the planning UI asks before it accepts a drop. */
export function missionAllowsTargetLocation(
  filters: MissionTargetLocationFilters,
  site: MissionTargetSite,
): boolean {
  return (
    missionAllowsTargetLocationType(filters, site.location.locationType) &&
    missionAllowsTargetLocationLevel(filters, site.location.locationLevel) &&
    missionAllowsTargetLocationIntel(filters, site.intelLevel) &&
    missionAllowsTargetLocationSecurity(filters, site.securityLevel)
  );
}

/* ---------------------------------------------------------------------------------------
 * Support assets
 *
 * A support asset is any catalog `Asset` carrying a `supportAbility`. The player drops them
 * into a mission's support slots (`PlayerState.maxSupportAssets` of them), they are spent on
 * assign like required assets, and each one bends one rule of the resolve. Two of the six
 * abilities move the success chance and are read here; the other four are read at resolve
 * time in `gameState.ts` (see `SupportAssetAbility`).
 * ------------------------------------------------------------------------------------- */

/** Whether this catalog asset may be placed in a support slot at all. */
export function isSupportAsset(asset: Asset): boolean {
  return asset.supportAbility !== undefined;
}

/**
 * The abilities a list of committed support asset ids brings, in the order the ids were
 * committed. Ids that are not in the catalog, or name an asset with no ability, are skipped —
 * a support slot never fails a resolve, it just contributes nothing.
 */
export function supportAbilitiesForAssetIds(
  assetIds: readonly string[],
  assets: readonly Asset[],
): SupportAssetAbility[] {
  const byId = new Map(assets.map((a) => [a.id, a] as const));
  const out: SupportAssetAbility[] = [];
  for (const id of assetIds) {
    const ability = byId.get(id)?.supportAbility;
    if (ability !== undefined) {
      out.push(ability);
    }
  }
  return out;
}

/** One-line player-facing gist of a support ability, for cards and tooltips. */
export function describeSupportAssetAbility(ability: SupportAssetAbility): string {
  switch (ability.kind) {
    case "success_chance_bonus":
      return `${ability.percent >= 0 ? "+" : ""}${ability.percent}% mission success chance`;
    case "prevent_security_increase":
      return "Target site's security does not rise from this mission";
    case "prevent_heat_increase":
      return "This mission cannot raise your heat";
    case "prevent_injuries":
      return "No participant comes home injured";
    case "ignore_agent_challenge_traits":
      return "Opposing agents' challenge traits cost nothing";
    case "ignore_security_traits":
      return "Revealed security traits are not required";
    default: {
      const _exhaustive: never = ability;
      return String(_exhaustive);
    }
  }
}

/** Whether any committed support asset carries `kind`. Duplicate flags do not stack. */
export function hasSupportAbility(
  abilities: readonly SupportAssetAbility[] | undefined,
  kind: SupportAssetAbilityKind,
): boolean {
  return (abilities ?? []).some((a) => a.kind === kind);
}

/** Total flat success % from `success_chance_bonus` support assets (these *do* stack). */
export function supportSuccessChanceBonus(
  abilities: readonly SupportAssetAbility[] | undefined,
): number {
  let total = 0;
  for (const a of abilities ?? []) {
    if (a.kind === "success_chance_bonus") {
      total += a.percent;
    }
  }
  return total;
}

export type MissionSuccessOptions = {
  /** Extra required trait ids from situational modifiers; merged with template (deduped). */
  additionalRequiredTraitIds?: string[];
  /** Current player inventory (`Asset.id` → quantity) for required-asset checks. */
  playerAssets?: Record<string, number>;
  /**
   * When set and its length matches `template.requiredAssetIds`, each index is one required-asset
   * slot: non-null must equal `requiredAssetIds[i]` to count as matched. Overrides `playerAssets`
   * for the asset portion of the base success %.
   */
  assignedAssetIds?: (string | null)[];
  /** When set, status_positive / status_negative traits on participants adjust success %. */
  traitsCatalog?: readonly Trait[];
  /**
   * Distinct challenge trait ids contributed by opposing agents at the mission site. Each one a
   * participant does **not** hold applies a flat −20% to success chance; they never enter the
   * required-trait ratio (default none).
   */
  challengeTraitIds?: readonly string[];
  /** Flat % delta from participants' dynamic traits (relationships / hero / wanted). */
  dynamicTraitDelta?: number;
  /** Flat % delta from timed event modifiers (see `GameState.activeSuccessModifiers`). */
  eventSuccessModifierDelta?: number;
  /**
   * Abilities of the support assets committed to this mission (resolve them with
   * {@link supportAbilitiesForAssetIds}). Only `success_chance_bonus` and
   * `ignore_agent_challenge_traits` mean anything to the success formula; the rest are read at
   * resolve time. `ignore_security_traits` is applied *before* this call, by whoever builds
   * `additionalRequiredTraitIds`.
   */
  supportAbilities?: readonly SupportAssetAbility[];
  /** Tunable modifier magnitudes (`catalog.balance`); defaults preserve legacy values. */
  balance?: Pick<
    BalanceConfig,
    "statusPositiveBonus" | "statusNegativePenalty" | "agentChallengeTraitPenalty"
  >;
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

/** Count filled required-asset slots where the placed id matches that slot's required id. */
export function countMatchedAssignedSlots(
  requiredAssetIds: string[],
  assignedAssetIds: (string | null)[],
): number {
  if (requiredAssetIds.length !== assignedAssetIds.length) {
    return 0;
  }
  let n = 0;
  for (let i = 0; i < requiredAssetIds.length; i += 1) {
    const need = requiredAssetIds[i]!;
    const got = assignedAssetIds[i];
    if (got !== null && got === need) {
      n += 1;
    }
  }
  return n;
}

/** @deprecated Read `catalog.balance.agentChallengeTraitPenalty`; kept as the legacy default. */
export const AGENT_CHALLENGE_TRAIT_PENALTY = DEFAULT_BALANCE.agentChallengeTraitPenalty;

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
  statusPositiveBonus: number,
  statusNegativePenalty: number,
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
          delta: statusPositiveBonus,
        });
      } else if (t.type === "status_negative") {
        out.push({
          instanceId: p.instanceId,
          templateId: p.templateId,
          traitId: tid,
          delta: -statusNegativePenalty,
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
  /** Distinct challenge trait ids in play at the site, alphabetical. */
  challengeTraitIds: string[];
  /** Subset of {@link challengeTraitIds} no participant holds — the ones that actually cost. */
  unmatchedChallengeTraitIds: string[];
  /** `unmatchedChallengeTraitIds.length × balance.agentChallengeTraitPenalty` (positive). */
  challengeTraitPenaltyTotal: number;
  /**
   * An `ignore_agent_challenge_traits` support asset zeroed the penalty. The traits are still
   * listed in {@link challengeTraitIds} so the UI can show what was shrugged off.
   */
  challengeTraitsIgnored: boolean;
  eventSuccessModifierDelta: number;
  /** Flat % from `success_chance_bonus` support assets. */
  supportAssetDelta: number;
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
  const assigned = options?.assignedAssetIds;
  const matchedAssets =
    assigned !== undefined && assigned.length === assetRequired.length
      ? countMatchedAssignedSlots(assetRequired, assigned)
      : matchedAssetUnits(assetRequired, options?.playerAssets);
  const base =
    total === 0 ? 100 : Math.round((100 * (matchedTraits + matchedAssets)) / total);
  const balance = options?.balance ?? DEFAULT_BALANCE;
  const statusEntries = participantStatusModifierEntries(
    participants,
    options?.traitsCatalog,
    balance.statusPositiveBonus,
    balance.statusNegativePenalty,
  );
  const statusDelta = statusEntries.reduce((s, e) => s + e.delta, 0);
  const dyn = options?.dynamicTraitDelta ?? 0;
  const eventMod = options?.eventSuccessModifierDelta ?? 0;
  const supportAssetDelta = supportSuccessChanceBonus(options?.supportAbilities);
  const challengeTraitIds = [...new Set(options?.challengeTraitIds ?? [])]
    .filter((id) => id.length > 0)
    .sort((a, b) => a.localeCompare(b));
  /* A support asset that ignores challenge traits zeroes the penalty outright — the traits
   * stay on the breakdown so the player can see what the asset bought them. */
  const challengeTraitsIgnored = hasSupportAbility(
    options?.supportAbilities,
    "ignore_agent_challenge_traits",
  );
  const unmatchedChallengeTraitIds = challengeTraitsIgnored
    ? []
    : challengeTraitIds.filter((id) => !union.has(id));
  const challengeTraitPenaltyTotal =
    balance.agentChallengeTraitPenalty * unmatchedChallengeTraitIds.length;
  const preClampPercent =
    base + statusDelta + dyn + eventMod + supportAssetDelta - challengeTraitPenaltyTotal;
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
    challengeTraitIds,
    unmatchedChallengeTraitIds,
    challengeTraitPenaltyTotal,
    challengeTraitsIgnored,
    eventSuccessModifierDelta: eventMod,
    supportAssetDelta,
  };
}

/**
 * Linear success: (matched distinct traits + matched asset units) /
 * (required trait count + required asset occurrence count). Uses `assignedAssetIds`
 * when its length matches `template.requiredAssetIds`; otherwise uses current `playerAssets`
 * with {@link matchedAssetUnits}. Then applies flat +10% per participating `status_positive`
 * trait occurrence and −20% per `status_negative`, then `dynamicTraitDelta`, then the flat
 * bonus from `success_chance_bonus` support assets, then −20% per distinct
 * `challengeTraitIds` entry the participants do not cover (skipped entirely when a support
 * asset ignores them), clamped to [0, 100].
 */
export function successChancePercent(
  template: MissionTemplate,
  participants: MinionInstance[],
  options?: MissionSuccessOptions,
): number {
  return computeSuccessChanceBreakdown(template, participants, options).finalPercent;
}

/* ---------------------------------------------------------------------------------------
 * Outcomes
 *
 * A mission that actually ran lands on one of three results. The roll is an integer in
 * [0, 100) compared against the success chance, and the band directly above that chance —
 * `balance.compromisedBandPercent` points wide — is **Compromised**: the job got done, but
 * it got done loudly. A compromised mission applies its success *and* its failure effects,
 * and counts as a completion wherever a success would (Omega phases, lair unlocks).
 * ------------------------------------------------------------------------------------- */

/** How a mission that ran to its resolve landed. `aborted` is not one of these — it never ran. */
export type MissionResult = "success" | "compromised" | "failure";

/**
 * Which result a roll lands on. `roll` is the integer in [0, 100) drawn at resolve;
 * `chancePercent` is the breakdown's `finalPercent`. A band of `0` collapses this back to a
 * plain success / failure split.
 */
export function missionResultForRoll(
  roll: number,
  chancePercent: number,
  compromisedBandPercent: number = DEFAULT_BALANCE.compromisedBandPercent,
): MissionResult {
  if (roll < chancePercent) {
    return "success";
  }
  if (roll < chancePercent + Math.max(0, compromisedBandPercent)) {
    return "compromised";
  }
  return "failure";
}

/**
 * Whether this result counts as getting the job done — what Omega phase progress, lair
 * mission unlocks, and upgrade installs ask about.
 */
export function missionResultIsCompletion(result: MissionResult): boolean {
  return result === "success" || result === "compromised";
}

/**
 * Whether this result drags the mission's failure fallout along with it — the template's
 * `onFailureEffects` and the passive agent abilities that only fire on a botched job.
 */
export function missionResultHasFallout(result: MissionResult): boolean {
  return result === "failure" || result === "compromised";
}

/** The three outcome odds behind one success chance; always sums to 100. */
export type MissionOutcomeChances = {
  successPercent: number;
  compromisedPercent: number;
  failurePercent: number;
};

/**
 * Splits a success chance into the odds of each result, matching {@link missionResultForRoll}
 * exactly: the compromised band is clipped by the 100% ceiling, so a 95% chance with a
 * 10-point band is 95 / 5 / 0, not 95 / 10 / -5.
 */
export function missionOutcomeChances(
  chancePercent: number,
  compromisedBandPercent: number = DEFAULT_BALANCE.compromisedBandPercent,
): MissionOutcomeChances {
  const successPercent = Math.min(100, Math.max(0, chancePercent));
  const bandTop = Math.min(100, successPercent + Math.max(0, compromisedBandPercent));
  const compromisedPercent = bandTop - successPercent;
  return {
    successPercent,
    compromisedPercent,
    failurePercent: 100 - bandTop,
  };
}
