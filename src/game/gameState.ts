import type {
  AgentInstance,
  ContentCatalog,
  DynamicTraitActivityChange,
  EventTemplate,
  LairTemplate,
  LocationAssetPlacement,
  LocationAssetSlot,
  LocationAgentPresence,
  LocationIntelState,
  LocationSecurityState,
  LocationTemplate,
  MinionInstance,
  MinionPairAffinity,
  MinionRelationshipChange,
  MinionTemplatePairAffinity,
  MissionSource,
  MissionTarget,
  MissionTargetType,
  MissionTemplate,
} from "./types";
import { DEFAULT_BALANCE, isOccupiedAssetSlot } from "./types";
import {
  awardMissionResolutionExperience,
  createMinionFromTemplate,
  maxHireableStartingLevel,
  templateStartingLevel,
} from "./minion";
import {
  countOpposingAgentsAtLocationFromData,
  revealAllOpposingAgentsAtLocation,
  spawnOpposingAgentsAfterWantedEscalation,
} from "./agent";
import {
  clampIntelLevel,
  effectiveAssetSlotVisibility,
  intelLevelForLocation,
} from "./intel";
import {
  activeLocationIds,
  initialLocationAgentPresenceForLocations,
  initialLocationSecurityStatesForLocations,
  locationTemplatesForOmegaPlan,
  maxSecurityLevelForLocation,
  rollInitialLocationIntelStates,
  rollLocationRequiredTraits,
  rollLocationSecurityTraits,
} from "./locationCatalog";
import {
  dynamicTraitSuccessModifierFromFullRoster,
  rollLocationDynamicTraitsAfterMission,
} from "./dynamicTrait";
import {
  affinityDeltaForResolve,
  applyMissionAffinity,
  applyTemplatePairSeeds,
  rollStartingTemplateAffinities,
  seedStartingAffinities,
  syncMinionPairDynamicTraits,
} from "./affinity";
import {
  canAssignParticipants,
  successChancePercent,
  type MissionSuccessOptions,
} from "./mission";
import {
  applyCriticalFailureInjuryRolls,
  applyMissionEffects,
  describeMissionTemplateEffects,
  orderedMissionEffects,
} from "./missionEffects";
import {
  getOmegaPlanById,
  isOmegaStageComplete,
  OMEGA_STAGE_COUNT,
  omegaSlotMissionId,
  resolveRunOmegaPlanId,
} from "./omegaPlan";
import {
  availableLairUpgradeMissionIds,
  getLairById,
  isLairUpgradeMission,
  lairUpgradeLevelIndexOfMission,
  resolveRunLairId,
} from "./lair";
import { nextMonotonicWantedTierIndex } from "./wantedLevel";

export type TurnPhase = "main" | "resolve" | "summary";

/**
 * Lifecycle of the Lair Raid, the special event the **top** wanted tier spawns:
 *
 * - `none`     — the top tier is not standing (never reached, or the last raid was survived and
 *                the tier was stood down). Reaching the top tier again moves this to `pending`.
 * - `pending`  — the raid is owed. The next `executePlan` that finds the global event slot free
 *                puts it on the table, **ignoring** `eventCooldownTurnsRemaining`.
 * - `offered`  — the raid is the current offer. Letting its lifetime run out ends the run.
 * - `engaged`  — the player started the raid mission. Failing it ends the run; completing it
 *                applies the template's success effects and stands the top tier down.
 */
export type LairRaidStatus = "none" | "pending" | "offered" | "engaged";

/** Why a run ended in **defeat**. Both come from the Lair Raid — the only loss condition today. */
export type GameOverReason = "lair_raid_expired" | "lair_raid_failed";

/**
 * How a finished run ended. One field rather than a pair of nullable flags, so "won" and
 * "lost" can never both be set.
 *
 * - `victory` — the active Omega Plan's **final** phase cleared (`omegaPlanId` is the plan
 *   that was completed; `null` only if the run somehow had none).
 * - `defeat`  — the Lair Raid was lost. See {@link GameOverReason}.
 *
 * When a resolve produces both at once — the last Omega mission lands on the same tick the
 * raid falls — **victory wins**: finishing the plan is the point of the game, and the lair
 * burning down behind the player does not undo it.
 */
export type RunEnding =
  | { kind: "victory"; omegaPlanId: string | null }
  | { kind: "defeat"; reason: GameOverReason };

export type PlayerState = {
  commandPoints: number;
  maxCommandPoints: number;
  /** 0–100; the reputation the player builds (raised by mission success). */
  infamy: number;
  /** 0–100; law-enforcement attention (raised by mission failure). Drives the wanted level. */
  heat: number;
  minions: MinionInstance[];
  /** Asset catalog id → quantity owned */
  assets: Record<string, number>;
  /** Max minions owned at once (hire blocked at cap). */
  maxRosterSize: number;
  /** How many minion templates are offered after each resolve (random pick). */
  maxHireOffers: number;
  /** Max active missions at once (assign blocked at cap; can rise during a run). */
  maxConcurrentMissions: number;
  /** Max minions assignable to a single mission (default 3). */
  maxParticipantsPerMission: number;
  /**
   * One-shot bonus CP added on top of `maxCommandPoints` at the next `advanceToNextTurn` refill,
   * then cleared.
   */
  pendingBonusCommandPoints: number;
};

export type ActiveMission = {
  id: string;
  missionTemplateId: string;
  /** What this mission is aimed at (location, asset slot, minion, or none). */
  target: MissionTarget;
  missionSource: MissionSource;
  /** Set when `missionSource === "omega"` (grid cell). */
  omegaStageIndex: number | null;
  omegaSlotIndex: number | null;
  participantInstanceIds: string[];
  /**
   * Per-slot committed inventory assets (aligned with mission template `requiredAssetIds`);
   * `null` = that slot was left empty at assign. Deducted from `player.assets` when the mission starts.
   */
  plannedAssetIds: (string | null)[];
  turnsRemaining: number;
  /** `GameState.turnNumber` when this mission was assigned (Main Phase). */
  startedOnTurn: number;
};

export type ActivityEventMissionCompleted = {
  kind: "mission_completed";
  activeMissionId: string;
  missionTemplateId: string;
  missionName: string;
  target: MissionTarget;
  success: boolean;
  /** Roll in [0, 100) compared to success chance */
  roll: number;
  successChancePercent: number;
  infamyDelta: number;
  /** Baseline infamy from success/failure before template effects. */
  baselineInfamyDelta: number;
  heatDelta: number;
  /** Baseline heat from success/failure before template effects. */
  baselineHeatDelta: number;
  /** Template effect lines in resolution order (reveal/steal first, then the rest). */
  templateEffectDescriptions: string[];
  /**
   * True when the mission failed at a location-backed target with at least one opposing agent
   * (critical injury rolls run after template failure effects).
   */
  criticalFailure: boolean;
  /** Set when `criticalFailure` is true: count of opposing agents at the mission location. */
  criticalOpposingAgentCount?: number;
  /** Set when `criticalFailure` is true: per-participant injury chance percent (min(100, 20 × agent count)). */
  criticalInjuryChancePercent?: number;
  /** Participants who gained `injured` from the critical-failure roll pass only (may be empty). */
  criticalInjuryInstanceIds?: string[];
  /** Hero / Wanted adds and replacements after this resolve (before XP). */
  dynamicTraitChanges?: DynamicTraitActivityChange[];
  /**
   * Participant pairs that crossed an affinity threshold on this resolve. The score behind them
   * is never surfaced — only the band the pair moved into.
   */
  relationshipChanges?: MinionRelationshipChange[];
};

/** @deprecated Use {@link ActivityEventMissionCompleted} */
export type ResolveEventMissionCompleted = ActivityEventMissionCompleted;

export type ActivityEvent =
  | ActivityEventMissionCompleted
  | { kind: "minion_hired"; templateId: string }
  | { kind: "minion_rehired"; templateId: string }
  | { kind: "minion_fired"; templateId: string }
  | {
      kind: "mission_started";
      missionTemplateId: string;
      target: MissionTarget;
      missionSource: MissionSource;
      omegaStageIndex: number | null;
      omegaSlotIndex: number | null;
      participantInstanceIds: string[];
    }
  | { kind: "mission_cancelled"; missionTemplateId: string; target: MissionTarget }
  | {
      /**
       * A resolving mission could not run (template no longer in the catalog, or a participant
       * missing / roster invalid at resolve time). Committed assets are refunded. Should be
       * unreachable today; logged so future systems (minion death, content changes) fail loudly.
       */
      kind: "mission_aborted";
      activeMissionId: string;
      missionTemplateId: string;
      target: MissionTarget;
      reason: "missing_template" | "invalid_participants";
    }
  | {
      /** A new global event offer went on the table with `lifetimeTurns` turns to act. */
      kind: "event_rotated_in";
      eventTemplateId: string;
      lifetimeTurns: number;
    }
  | {
      kind: "event_expired";
      eventTemplateId: string;
      effectDescriptions: string[];
    }
  | {
      /** The run ended, won or lost. Terminal — no further rows are ever appended after this one. */
      kind: "run_ended";
      ending: RunEnding;
    }
  | {
      kind: "asset_gained";
      assetId: string;
      quantity: number;
      /** Set when this row came out of one mission's resolve (see {@link ActivityEvent}). */
      activeMissionId?: string;
    }
  | {
      kind: "asset_lost";
      assetId: string;
      quantity: number;
      /** Set when this row came out of one mission's resolve (see {@link ActivityEvent}). */
      activeMissionId?: string;
    }
  | {
      kind: "minion_leveled_up";
      instanceId: string;
      templateId: string;
      newLevel: number;
      /** Present when a trait from `levelUpTraitOrder` was unlocked. */
      traitId?: string;
      /** Set when this row came out of one mission's resolve (see {@link ActivityEvent}). */
      activeMissionId?: string;
    };

/** @deprecated Use {@link ActivityEvent} */
export type ResolveEvent = ActivityEventMissionCompleted;

/** Activity for one turn (player actions + resolve outcomes); newest turn first in {@link GameState.activityLog}. */
export type TurnActivityEntry = {
  turnNumber: number;
  events: ActivityEvent[];
};

/** Fired roster minion waiting out cooldown before appearing in the hire column again. */
export type MinionRehireQueueEntry = {
  minion: MinionInstance;
  /** First `turnNumber` (inclusive) when they may be re-hired from the pool. */
  availableFromTurn: number;
};

/** Per-slot success flags for one Omega phase row (three mission slots). */
export type OmegaSlotFlags = [boolean, boolean, boolean];

export type GameState = {
  phase: TurnPhase;
  turnNumber: number;
  /** Evil organization display name for this run (from `ContentCatalog.organizationNames`). */
  organizationName: string;
  /** Player mastermind display name for this run (from `ContentCatalog.playerProfiles`). */
  playerName: string;
  /** Player portrait URL for this run (from chosen profile’s `profilePic`). */
  playerProfilePic: string;
  player: PlayerState;
  activeMissions: ActiveMission[];
  /** Minion template ids offered for hire until the next resolve rerolls them */
  availableMinionTemplateIds: string[];
  /** Fired minions (same instance stats) pending cooldown before re-offer. */
  minionRehireQueue: MinionRehireQueueEntry[];
  /** Activity log (player actions + resolve outcomes); newest turn first. */
  activityLog: TurnActivityEntry[];
  /** Win-path plan for this run; chosen once at game start. */
  activeOmegaPlanId: string | null;
  /** Per-location security (runtime); initialized from `initialLocationSecurityStates`. */
  locationSecurityStates: LocationSecurityState[];
  /**
   * Per-location intel (runtime); every playable site starts at 0. Gates what the player may
   * see at a site — see `intel.ts` for the visibility rules.
   */
  locationIntelStates: LocationIntelState[];
  /** Random catalog assets per location; 1–3 slots each, exactly three slots revealed globally when possible. */
  locationAssetSlots: LocationAssetPlacement[];
  /**
   * Per-run rolled required traits per location id (primary + secondary only; count by
   * `locationLevel`). Merged into mission requirements when that location is the mission target.
   */
  locationRequiredTraits: Record<string, string[]>;
  /**
   * Per-run security trait stack (length = location `level`). Reveal order = array order;
   * first `securityLevel` entries merge into missions at that location.
   */
  locationSecurityTraits: Record<string, string[]>;
  /**
   * Opposing agent instances in play (catalog templates from `ContentCatalog.agents`).
   * Which site each agent occupies is in {@link locationAgentPresence} (populated by future gameplay).
   */
  opposingAgentInstances: AgentInstance[];
  /**
   * One row per playable location: instance ids of agents at that site (subset of
   * {@link opposingAgentInstances}). Empty at run start.
   */
  locationAgentPresence: LocationAgentPresence[];
  /** Chosen lair template id for this run, or null if `catalog.lairs` is empty. */
  activeLairId: string | null;
  /** Mission template ids available from the lair (starts as copy of template; gameplay may append). */
  lairMissionIds: string[];
  /**
   * Upgrade missions installed this run (resolved successfully), in completion order — at most
   * one per level of the active lair's `upgradeLevels`. A completed entry closes its whole
   * level: the siblings it was chosen over are locked out, and the Upgrades tab advances to
   * the next level (see `lair.ts`).
   */
  completedLairUpgradeMissionIds: string[];
  /** Current Omega plan phase row (0–2) used for which missions may be assigned from the plan. */
  activeOmegaStageIndex: number;
  /**
   * Per-slot success flags for every Omega phase (`[stage][slot]`). Kept for the whole run so
   * a phase cleared with fewer than three successes still shows which slots were actually done.
   */
  omegaStageProgress: [OmegaSlotFlags, OmegaSlotFlags, OmegaSlotFlags];
  /**
   * Index into `ContentCatalog.wantedLevels`; only increases (monotonic with heat exposure).
   * Recomputed at end of each `executePlan` from final `player.heat`.
   */
  wantedLevelTierIndex: number;
  /**
   * Global event offer on the table (`EventTemplate.id`), or null when there is none: the
   * catalog has no events, the offer was started and its mission is still running, or the
   * slot is cooling down (see {@link eventCooldownTurnsRemaining}).
   */
  currentEventTemplateId: string | null;
  /**
   * Turns of offer lifetime left for {@link currentEventTemplateId}; decremented once per
   * `executePlan`, and at 0 the offer expires (its `expireEffects` fire). 0 when no offer.
   */
  currentEventTurnsRemaining: number;
  /**
   * Turns of quiet left before the next offer may be drawn, rolled from
   * `balance.eventCooldownTurns{Min,Max}` when an event leaves the slot. 0 means the next
   * `executePlan` draws a new offer (no event mission being in progress).
   */
  eventCooldownTurnsRemaining: number;
  /** Flat success % modifiers from event effects; each entry decays once per `executePlan`. */
  activeSuccessModifiers: { delta: number; turnsRemaining: number }[];
  /**
   * Shared affinity score per **unordered** minion pair, and the relationship band it currently
   * sits in (see `affinity.ts`). One row per pair that has ever had a non-zero score; a pair with
   * no row is Neutral at 0. The score is internal — the UI only ever renders the band.
   *
   * `MinionInstance.dynamicTraits` mirrors these bands for display and for the success modifier;
   * this table is the source of truth and always wins.
   */
  minionAffinities: MinionPairAffinity[];
  /**
   * This run's opening affinities, rolled once over the catalog's minion **templates** at
   * `createInitialGameState` and fixed thereafter. The roster is empty at turn 1, so each entry
   * waits and lands on the real instance pair the first time both of those minions are hired
   * (see `applyTemplatePairSeeds`). A designer-authored bond and any score the run has already
   * moved both outrank it.
   */
  minionAffinitySeeds: MinionTemplatePairAffinity[];
  /**
   * Where the Lair Raid — the run-ending event the **top** wanted tier spawns — currently sits.
   * See {@link LairRaidStatus}.
   */
  lairRaidStatus: LairRaidStatus;
  /**
   * `null` while the run is alive. Once set, the run is over: `executePlan` and
   * `advanceToNextTurn` refuse to run, and the UI shows the run-end modals instead of the
   * turn report.
   */
  runEnding: RunEnding | null;
};

export type GameError =
  | { code: "wrong_phase"; expected: TurnPhase; actual: TurnPhase }
  | { code: "unknown_minion_template"; templateId: string }
  | { code: "not_on_offer"; templateId: string }
  | { code: "roster_full"; max: number; have: number }
  | { code: "not_enough_cp"; need: number; have: number }
  | { code: "unknown_location"; locationId: string }
  | { code: "unknown_mission"; missionId: string }
  | { code: "mission_not_at_location"; missionId: string; locationId: string }
  | { code: "no_active_omega_plan" }
  | { code: "omega_slot_mismatch"; missionId: string; slotMissionId: string }
  | { code: "invalid_omega_stage"; expectedStage: number; got: number }
  | { code: "invalid_mission_source_binding"; reason: string }
  | { code: "invalid_participants"; reason: string }
  | { code: "unknown_instance"; instanceId: string }
  | { code: "location_not_on_active_map"; locationId: string }
  | { code: "minion_on_mission"; instanceId: string }
  | { code: "not_on_rehire_offer"; instanceId: string }
  | {
      code: "rehire_on_cooldown";
      instanceId: string;
      availableFromTurn: number;
    }
  | { code: "unknown_active_mission"; activeMissionId: string }
  | { code: "max_concurrent_missions"; max: number; have: number }
  | { code: "no_active_lair" }
  | { code: "mission_not_on_lair"; missionId: string }
  /** A sibling choice from the same (mutually exclusive) upgrade level is already running. */
  | { code: "lair_upgrade_level_busy"; missionId: string; runningMissionId: string }
  | { code: "lair_mission_already_in_pool"; missionId: string }
  | { code: "wrong_target_kind"; expected: MissionTargetType; actual: string }
  | { code: "unknown_asset_slot"; locationId: string; slotIndex: number }
  | { code: "empty_asset_slot"; locationId: string; slotIndex: number }
  | { code: "asset_visibility_mismatch"; locationId: string; slotIndex: number }
  | { code: "minion_target_in_participants"; instanceId: string }
  | { code: "unknown_target_minion"; instanceId: string }
  | { code: "asset_slot_length_mismatch"; expected: number; got: number }
  | {
      code: "asset_slot_id_mismatch";
      slotIndex: number;
      expectedAssetId: string;
      actual: string;
    }
  | { code: "not_enough_assets"; assetId: string; need: number; have: number }
  | { code: "no_current_event_offer" }
  | { code: "run_ended"; ending: RunEnding }
  | {
      code: "event_mission_mismatch";
      currentOffer: string | null;
      requested: string;
    };
export type Ok<T> = { ok: true; value: T };
export type Err<E> = { ok: false; error: E };
export type Result<T, E> = Ok<T> | Err<E>;

/** Whether `target` matches the mission template’s `targetType`. */
export function missionTargetMatchesTemplate(
  templateType: MissionTargetType,
  target: MissionTarget,
): boolean {
  switch (templateType) {
    case "none":
      return target.kind === "none";
    case "location":
      return target.kind === "location";
    case "asset_hidden":
      return target.kind === "asset" && target.visibilityAtAssign === "hidden";
    case "asset_revealed":
      return target.kind === "asset" && target.visibilityAtAssign === "revealed";
    case "minion":
      return target.kind === "minion";
    default:
      return false;
  }
}

/** Location whose security may rise when a mission resolves (location- or asset-targeted). */
export function getMissionTargetLocationId(target: MissionTarget): string | null {
  if (target.kind === "location") {
    return target.locationId;
  }
  if (target.kind === "asset") {
    return target.locationId;
  }
  return null;
}

/** Trait ids from the security stack that are currently revealed for `locationId`. */
export function revealedSecurityTraitIds(
  state: GameState,
  locationId: string,
): string[] {
  const sec = state.locationSecurityStates.find((s) => s.locationId === locationId);
  const k = sec?.securityLevel ?? 0;
  const list = state.locationSecurityTraits[locationId] ?? [];
  return list.slice(0, Math.min(k, list.length));
}

/** Extra required traits from the target location’s site roll + revealed security stack. */
export function missionSuccessOptionsForTarget(
  state: GameState,
  target: MissionTarget,
): MissionSuccessOptions {
  const lid = getMissionTargetLocationId(target);
  if (lid === null) {
    return {};
  }
  const merged = new Set<string>();
  for (const id of state.locationRequiredTraits[lid] ?? []) {
    if (id.length > 0) {
      merged.add(id);
    }
  }
  for (const id of revealedSecurityTraitIds(state, lid)) {
    if (id.length > 0) {
      merged.add(id);
    }
  }
  if (merged.size === 0) {
    return {};
  }
  return { additionalRequiredTraitIds: [...merged] };
}

/** @deprecated Read `catalog.balance.eventMaxParticipants`; kept as the legacy default. */
export const EVENT_MAX_PARTICIPANTS_PER_MISSION = DEFAULT_BALANCE.eventMaxParticipants;
/** @deprecated Read `catalog.balance.rerollHireOffersCp`; kept as the legacy default. */
export const REROLL_HIRE_OFFERS_CP = DEFAULT_BALANCE.rerollHireOffersCp;
/** @deprecated Read `catalog.balance.fireRehireCooldownTurns`; kept as the legacy default. */
export const MINION_FIRE_REHIRE_COOLDOWN_TURNS = DEFAULT_BALANCE.fireRehireCooldownTurns;

export function clampInfamy(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function clampHeat(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * After a mission finishes at `locationId`, raise that location's security by
 * `catalog.balance.securityGainPerResolvedMission` (cap = location level).
 */
function raiseSecurityAfterMissionAtLocation(
  states: LocationSecurityState[],
  catalog: ContentCatalog,
  locationId: string,
): LocationSecurityState[] {
  const cap = maxSecurityLevelForLocation(catalog, locationId);
  const gain = catalog.balance.securityGainPerResolvedMission;
  return states.map((s) => {
    if (s.locationId !== locationId) {
      return s;
    }
    const next = Math.max(0, Math.min(cap, s.securityLevel + gain));
    return { ...s, securityLevel: next as 0 | 1 | 2 | 3 };
  });
}

/**
 * Set a location's security level (e.g. future events that lower heat). Clamped to
 * `[0, locationLevel]`. Re-hides security traits above the new level automatically via
 * {@link revealedSecurityTraitIds}.
 */
export function setLocationSecurityLevel(
  state: GameState,
  catalog: ContentCatalog,
  locationId: string,
  level: number,
): GameState {
  const cap = maxSecurityLevelForLocation(catalog, locationId);
  const clamped = Math.max(0, Math.min(cap, Math.floor(level))) as 0 | 1 | 2 | 3;
  return {
    ...state,
    locationSecurityStates: state.locationSecurityStates.map((s) =>
      s.locationId === locationId ? { ...s, securityLevel: clamped } : s,
    ),
  };
}

/**
 * Set a site's intel outright (clamped to `[0, MAX_INTEL_LEVEL]`). Missions and events normally
 * move intel through `intel_level_delta*` effects; this is the direct seam for other systems.
 */
export function setLocationIntelLevel(
  state: GameState,
  locationId: string,
  level: number,
): GameState {
  const clamped = clampIntelLevel(level);
  return {
    ...state,
    locationIntelStates: state.locationIntelStates.map((s) =>
      s.locationId === locationId ? { ...s, intelLevel: clamped } : s,
    ),
  };
}

export type Rng = () => number;

function shuffleInPlace<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j]!;
    arr[j] = t!;
  }
}

function pickDistinctRandomAssetIds(
  catalog: ContentCatalog,
  count: number,
  rng: Rng,
): string[] {
  const ids = catalog.assets.map((a) => a.id);
  if (ids.length === 0 || count <= 0) {
    return [];
  }
  shuffleInPlace(ids, rng);
  return ids.slice(0, Math.min(count, ids.length));
}

/**
 * For each location: `balance.assetsPerLocationMin`–`Max` random distinct catalog assets
 * (none if `catalog.assets` is empty), **all hidden**. Nothing is revealed up front — what the
 * player can see at run start comes from `rollInitialLocationIntelStates` instead.
 */
function initializeLocationAssetPlacements(
  catalog: ContentCatalog,
  rng: Rng,
  runLocations: LocationTemplate[],
): LocationAssetPlacement[] {
  const { assetsPerLocationMin, assetsPerLocationMax } = catalog.balance;
  const spread = Math.max(0, assetsPerLocationMax - assetsPerLocationMin);
  const placements: LocationAssetPlacement[] = [];
  for (const loc of runLocations) {
    let slots: LocationAssetSlot[] = [];
    if (catalog.assets.length > 0) {
      const targetCount = assetsPerLocationMin + Math.floor(rng() * (spread + 1));
      const ids = pickDistinctRandomAssetIds(
        catalog,
        Math.min(targetCount, catalog.assets.length),
        rng,
      );
      slots = ids.map((assetId) => ({
        kind: "occupied" as const,
        assetId,
        visibility: "hidden" as const,
      }));
    }
    placements.push({ locationId: loc.id, slots });
  }
  return placements;
}

/**
 * Hire offers for the Main Phase: distinct templates the player does not already have, gated to
 * `maxHireableStartingLevel(player.infamy, ...)`, shuffled and cut to `count`. Infamy is the
 * player's rising reputation, so better recruits come looking as it climbs.
 *
 * The gate never starves the pool: if nothing sits at or under the cap (every low-level template
 * is already hired), the draw falls back to the lowest `startingLevel` still unhired so the
 * player can always recruit someone.
 */
export function pickHireOfferTemplateIds(
  catalog: ContentCatalog,
  count: number,
  rng: Rng,
  player: PlayerState,
): string[] {
  const owned = ownedMinionTemplateIds(player);
  const candidates = catalog.minions.filter((m) => !owned.has(m.id));
  if (candidates.length === 0 || count <= 0) {
    return [];
  }
  const cap = maxHireableStartingLevel(
    player.infamy,
    catalog.balance.hireLevelInfamyThresholds,
  );
  let eligible = candidates.filter((m) => templateStartingLevel(m) <= cap);
  if (eligible.length === 0) {
    const lowest = Math.min(...candidates.map(templateStartingLevel));
    eligible = candidates.filter((m) => templateStartingLevel(m) === lowest);
  }
  const ids = eligible.map((m) => m.id);
  shuffleInPlace(ids, rng);
  return ids.slice(0, Math.min(count, ids.length));
}

function ownedMinionTemplateIds(player: PlayerState): Set<string> {
  return new Set(player.minions.map((m) => m.templateId));
}

function pickRandomOrganizationName(catalog: ContentCatalog, rng: Rng): string {
  const names = catalog.organizationNames;
  const i = Math.floor(rng() * names.length);
  return names[i]!;
}

function pickRandomPlayerProfile(
  catalog: ContentCatalog,
  rng: Rng,
): { name: string; profilePic: string } {
  const profiles = catalog.playerProfiles;
  const i = Math.floor(rng() * profiles.length);
  const p = profiles[i]!;
  return { name: p.name, profilePic: p.profilePic };
}

/**
 * Events currently in the draw pool: those whose optional **`minInfamy`** / **`minHeat`** gates
 * the player has reached. Ungated events are always in the pool, so gating a template holds it
 * back until the run escalates rather than removing it.
 *
 * **`special`** events (the Lair Raid) are never drawn: the rule that owns them puts them on
 * the table directly. See {@link lairRaidEventTemplate}.
 */
export function eligibleEventTemplates(
  catalog: ContentCatalog,
  player: PlayerState,
): EventTemplate[] {
  return catalog.events.filter(
    (e) =>
      e.special === undefined &&
      player.infamy >= (e.minInfamy ?? 0) &&
      player.heat >= (e.minHeat ?? 0),
  );
}

/** The catalog's Lair Raid template, or undefined when the content ships none (no loss condition). */
export function lairRaidEventTemplate(catalog: ContentCatalog): EventTemplate | undefined {
  return catalog.events.find((e) => e.special === "lair_raid");
}

/**
 * Index of the **top** wanted tier — the one that spawns the Lair Raid — or `null` when the
 * catalog has fewer than two tiers (a single tier is the run's opening state, not an escalation).
 */
export function topWantedTierIndex(catalog: ContentCatalog): number | null {
  return catalog.wantedLevels.length > 1 ? catalog.wantedLevels.length - 1 : null;
}

/** Uniform random event template id from the pool the player has unlocked, or null if empty. */
export function pickRandomEventTemplateId(
  catalog: ContentCatalog,
  rng: Rng,
  player: PlayerState,
): string | null {
  const list = eligibleEventTemplates(catalog, player);
  if (list.length === 0) {
    return null;
  }
  const i = Math.floor(rng() * list.length);
  return list[i]!.id;
}

/** A freshly drawn global event offer: which event, and how many turns the player has to start it. */
export type EventOfferDraw = { eventTemplateId: string; lifetimeTurns: number };

/**
 * Draw the next global event offer (uniform over the eligible pool, with replacement), carrying
 * the template's designer-set `lifetimeTurns`. Null when no event is currently eligible — the
 * slot then stays empty and the draw is retried at the next resolve.
 */
export function drawEventOffer(
  catalog: ContentCatalog,
  rng: Rng,
  player: PlayerState,
): EventOfferDraw | null {
  const id = pickRandomEventTemplateId(catalog, rng, player);
  if (id === null) {
    return null;
  }
  const template = catalog.events.find((e) => e.id === id);
  return { eventTemplateId: id, lifetimeTurns: Math.max(1, template?.lifetimeTurns ?? 1) };
}

/**
 * Turns of quiet after an event leaves the slot, uniform in
 * `[balance.eventCooldownTurnsMin, balance.eventCooldownTurnsMax]` (0 ⇒ the next offer appears
 * at that same resolve).
 */
export function rollEventCooldownTurns(catalog: ContentCatalog, rng: Rng): number {
  const min = Math.max(0, catalog.balance.eventCooldownTurnsMin);
  const max = Math.max(min, catalog.balance.eventCooldownTurnsMax);
  return Math.min(max, min + Math.floor(rng() * (max - min + 1)));
}

/**
 * Player-chosen run options from the title screen. A field left out, `null`, or naming an id
 * the catalog does not have is rolled at random instead.
 */
export type RunSetup = {
  /** `OmegaPlanTemplate.id` to run, or `null` to roll one. */
  omegaPlanId?: string | null;
  /** `LairTemplate.id` to start in, or `null` to roll one. */
  lairId?: string | null;
};

/**
 * Starting Lair Missions pool: the picked lair's `availableMissionIds` plus every mission
 * template flagged `coreMission` — core missions are open from turn 1 in every run regardless
 * of lair, and a lair that also lists one does not get it twice.
 */
function initialLairMissionIds(
  catalog: ContentCatalog,
  lairTemplate: LairTemplate | undefined,
): string[] {
  const out = lairTemplate ? [...lairTemplate.availableMissionIds] : [];
  for (const m of catalog.missions) {
    if (m.coreMission === true && !out.includes(m.id)) {
      out.push(m.id);
    }
  }
  return out;
}

/**
 * Create a fresh run. Pass a seeded `rng` for deterministic runs (tests, replays);
 * defaults to `Math.random` for normal play. `setup` carries the title screen's omega plan
 * and lair picks; anything it leaves unset is rolled from the catalog as before.
 */
export function createInitialGameState(
  catalog: ContentCatalog,
  rng: Rng = () => Math.random(),
  setup: RunSetup = {},
): GameState {
  const activeOmegaPlanId = resolveRunOmegaPlanId(catalog, setup.omegaPlanId ?? null, rng);
  const activeLairId = resolveRunLairId(catalog, setup.lairId ?? null, rng);
  const lairTemplate = activeLairId !== null ? getLairById(catalog, activeLairId) : undefined;
  const assetsFromLair: Record<string, number> = {};
  if (lairTemplate?.startingAssets) {
    for (const [k, v] of Object.entries(lairTemplate.startingAssets)) {
      assetsFromLair[k] = (assetsFromLair[k] ?? 0) + v;
    }
  }
  const player: PlayerState = {
    commandPoints: catalog.balance.startingMaxCommandPoints,
    maxCommandPoints: catalog.balance.startingMaxCommandPoints,
    infamy: 0,
    heat: 0,
    minions: [],
    assets: assetsFromLair,
    maxRosterSize: catalog.balance.startingMaxRosterSize,
    maxHireOffers: catalog.balance.startingMaxHireOffers,
    maxConcurrentMissions: catalog.balance.startingMaxConcurrentMissions,
    maxParticipantsPerMission: catalog.balance.startingMaxParticipantsPerMission,
    pendingBonusCommandPoints: 0,
  };
  const runLocations = locationTemplatesForOmegaPlan(catalog, activeOmegaPlanId);
  const locationRequiredTraits = rollLocationRequiredTraits(catalog, runLocations, rng);
  const locationSecurityTraits = rollLocationSecurityTraits(catalog, runLocations, rng);
  const locationIntelStates = rollInitialLocationIntelStates(catalog, runLocations, rng);
  const lairMissionIds = initialLairMissionIds(catalog, lairTemplate);
  const playerProfile = pickRandomPlayerProfile(catalog, rng);
  /* Draw order is fixed so seeded runs stay reproducible: org name → hire offers → asset
   * placements → opening event offer. */
  const organizationName = pickRandomOrganizationName(catalog, rng);
  const availableMinionTemplateIds = pickHireOfferTemplateIds(
    catalog,
    player.maxHireOffers,
    rng,
    player,
  );
  const locationAssetSlots = initializeLocationAssetPlacements(catalog, rng, runLocations);
  /* The event slot opens quiet: `firstEventTurn - 1` turns of cooldown, so the first offer is
   * drawn at the resolve that ends turn `firstEventTurn - 1` and is on the table for turn
   * `firstEventTurn`. Only a `firstEventTurn` of 1 puts an offer up at run start. */
  const firstEventTurn = Math.max(1, catalog.balance.firstEventTurn);
  const openingEventOffer = firstEventTurn <= 1 ? drawEventOffer(catalog, rng, player) : null;
  const base: GameState = {
    phase: "main",
    turnNumber: 1,
    organizationName,
    playerName: playerProfile.name,
    playerProfilePic: playerProfile.profilePic,
    player,
    activeMissions: [],
    availableMinionTemplateIds,
    minionRehireQueue: [],
    activityLog: [],
    activeOmegaPlanId,
    locationSecurityStates: initialLocationSecurityStatesForLocations(runLocations),
    locationIntelStates,
    locationAssetSlots,
    locationRequiredTraits,
    locationSecurityTraits,
    opposingAgentInstances: [],
    locationAgentPresence: initialLocationAgentPresenceForLocations(runLocations),
    activeLairId,
    lairMissionIds,
    completedLairUpgradeMissionIds: [],
    activeOmegaStageIndex: 0,
    omegaStageProgress: [
      [false, false, false],
      [false, false, false],
      [false, false, false],
    ],
    wantedLevelTierIndex: 0,
    currentEventTemplateId: openingEventOffer?.eventTemplateId ?? null,
    currentEventTurnsRemaining: openingEventOffer?.lifetimeTurns ?? 0,
    eventCooldownTurnsRemaining: firstEventTurn - 1,
    activeSuccessModifiers: [],
    minionAffinities: [],
    minionAffinitySeeds: rollStartingTemplateAffinities(
      catalog.minions.map((m) => m.id),
      rng,
      catalog.balance.minionAffinity,
    ),
    lairRaidStatus: "none",
    runEnding: null,
  };

  const assetEvents: ActivityEvent[] = [];
  for (const [assetId, qty] of Object.entries(assetsFromLair)) {
    if (qty > 0) {
      assetEvents.push({ kind: "asset_gained", assetId, quantity: qty });
    }
  }
  if (assetEvents.length === 0) {
    return base;
  }
  return {
    ...base,
    activityLog: [{ turnNumber: 1, events: assetEvents }, ...base.activityLog],
  };
}

function missionTemplateById(
  catalog: ContentCatalog,
  id: string,
): MissionTemplate | undefined {
  return catalog.missions.find((m) => m.id === id) ?? catalog.events.find((e) => e.id === id);
}

function eventTemplateById(catalog: ContentCatalog, id: string): EventTemplate | undefined {
  return catalog.events.find((e) => e.id === id);
}

function catalogMissionOnlyById(catalog: ContentCatalog, id: string): MissionTemplate | undefined {
  return catalog.missions.find((m) => m.id === id);
}

function locationById(catalog: ContentCatalog, id: string) {
  return catalog.locations.find((l) => l.id === id);
}

function minionTemplateById(catalog: ContentCatalog, id: string) {
  return catalog.minions.find((m) => m.id === id);
}

function appendActivityEvent(state: GameState, event: ActivityEvent): GameState {
  const { turnNumber, activityLog } = state;
  const idx = activityLog.findIndex((e) => e.turnNumber === turnNumber);
  if (idx === -1) {
    return {
      ...state,
      activityLog: [{ turnNumber, events: [event] }, ...activityLog],
    };
  }
  const entry = activityLog[idx]!;
  const nextEntry: TurnActivityEntry = {
    ...entry,
    events: [...entry.events, event],
  };
  return {
    ...state,
    activityLog: [...activityLog.slice(0, idx), nextEntry, ...activityLog.slice(idx + 1)],
  };
}

function mergeResolveActivityEventsIntoActivityLog(
  activityLog: TurnActivityEntry[],
  turnNumber: number,
  resolveEvents: ActivityEvent[],
): TurnActivityEntry[] {
  const copied = resolveEvents.map((e) => ({ ...e }) as ActivityEvent);
  const idx = activityLog.findIndex((e) => e.turnNumber === turnNumber);
  if (idx === -1) {
    return [{ turnNumber, events: copied }, ...activityLog];
  }
  const entry = activityLog[idx]!;
  const nextEntry: TurnActivityEntry = {
    ...entry,
    events: [...entry.events, ...copied],
  };
  return [...activityLog.slice(0, idx), nextEntry, ...activityLog.slice(idx + 1)];
}

export function busyInstanceIds(activeMissions: ActiveMission[]): Set<string> {
  const s = new Set<string>();
  for (const am of activeMissions) {
    for (const id of am.participantInstanceIds) {
      s.add(id);
    }
  }
  return s;
}

/**
 * Re-seeds designer-authored starting bonds against the current roster and re-projects every
 * minion's relationship pills from the affinity table. Run after any roster change: a starting
 * bond only lands once both minions are hired, and a departure has to clear the other half's pill.
 */
function withRefreshedAffinities(state: GameState, catalog: ContentCatalog): GameState {
  /* Designer bonds first, then this run's roll — whichever lands first owns the pair, and a
   * pair the run has already moved is never re-seeded by either. */
  const minionAffinities = applyTemplatePairSeeds(
    seedStartingAffinities(
      state.minionAffinities,
      state.player.minions,
      (templateId) => minionTemplateById(catalog, templateId)?.startingDynamicTraits,
      catalog.balance.minionAffinity,
    ),
    state.player.minions,
    state.minionAffinitySeeds,
    catalog.balance.minionAffinity,
  );
  return {
    ...state,
    minionAffinities,
    player: {
      ...state.player,
      minions: syncMinionPairDynamicTraits(state.player.minions, minionAffinities),
    },
  };
}

export function hireMinion(
  state: GameState,
  catalog: ContentCatalog,
  templateId: string,
  newInstanceId: string,
): Result<GameState, GameError> {
  if (state.phase !== "main") {
    return { ok: false, error: { code: "wrong_phase", expected: "main", actual: state.phase } };
  }
  const template = minionTemplateById(catalog, templateId);
  if (!template) {
    return { ok: false, error: { code: "unknown_minion_template", templateId } };
  }
  if (!state.availableMinionTemplateIds.includes(templateId)) {
    return { ok: false, error: { code: "not_on_offer", templateId } };
  }
  const have = state.player.minions.length;
  if (have >= state.player.maxRosterSize) {
    return {
      ok: false,
      error: { code: "roster_full", max: state.player.maxRosterSize, have },
    };
  }
  const cost = template.hireCommandPoints;
  if (state.player.commandPoints < cost) {
    return {
      ok: false,
      error: { code: "not_enough_cp", need: cost, have: state.player.commandPoints },
    };
  }
  const instance = createMinionFromTemplate(template, newInstanceId);
  const remainingOffers = state.availableMinionTemplateIds.filter((id) => id !== templateId);
  const next: GameState = {
    ...state,
    availableMinionTemplateIds: remainingOffers,
    player: {
      ...state.player,
      commandPoints: state.player.commandPoints - cost,
      minions: [...state.player.minions, instance],
    },
  };
  return {
    ok: true,
    value: appendActivityEvent(withRefreshedAffinities(next, catalog), {
      kind: "minion_hired",
      templateId,
    }),
  };
}

export function fireMinion(
  state: GameState,
  catalog: ContentCatalog,
  instanceId: string,
): Result<GameState, GameError> {
  if (state.phase !== "main") {
    return { ok: false, error: { code: "wrong_phase", expected: "main", actual: state.phase } };
  }
  const idx = state.player.minions.findIndex((m) => m.instanceId === instanceId);
  if (idx === -1) {
    return { ok: false, error: { code: "unknown_instance", instanceId } };
  }
  const busy = busyInstanceIds(state.activeMissions);
  if (busy.has(instanceId)) {
    return { ok: false, error: { code: "minion_on_mission", instanceId } };
  }
  const minion = state.player.minions[idx]!;
  const newMinions = state.player.minions.filter((_, i) => i !== idx);
  const next: GameState = {
    ...state,
    player: { ...state.player, minions: newMinions },
    minionRehireQueue: [
      ...state.minionRehireQueue,
      {
        minion: { ...minion },
        availableFromTurn: state.turnNumber + catalog.balance.fireRehireCooldownTurns,
      },
    ],
  };
  return {
    ok: true,
    value: appendActivityEvent(withRefreshedAffinities(next, catalog), {
      kind: "minion_fired",
      templateId: minion.templateId,
    }),
  };
}

export function rehireMinion(
  state: GameState,
  catalog: ContentCatalog,
  instanceId: string,
): Result<GameState, GameError> {
  if (state.phase !== "main") {
    return { ok: false, error: { code: "wrong_phase", expected: "main", actual: state.phase } };
  }
  const qIdx = state.minionRehireQueue.findIndex((e) => e.minion.instanceId === instanceId);
  if (qIdx === -1) {
    return { ok: false, error: { code: "not_on_rehire_offer", instanceId } };
  }
  const entry = state.minionRehireQueue[qIdx]!;
  if (state.turnNumber < entry.availableFromTurn) {
    return {
      ok: false,
      error: {
        code: "rehire_on_cooldown",
        instanceId,
        availableFromTurn: entry.availableFromTurn,
      },
    };
  }
  if (state.player.minions.some((m) => m.instanceId === instanceId)) {
    return { ok: false, error: { code: "not_on_rehire_offer", instanceId } };
  }
  const template = minionTemplateById(catalog, entry.minion.templateId);
  if (!template) {
    return {
      ok: false,
      error: { code: "unknown_minion_template", templateId: entry.minion.templateId },
    };
  }
  const have = state.player.minions.length;
  if (have >= state.player.maxRosterSize) {
    return {
      ok: false,
      error: { code: "roster_full", max: state.player.maxRosterSize, have },
    };
  }
  const cost = template.hireCommandPoints;
  if (state.player.commandPoints < cost) {
    return {
      ok: false,
      error: { code: "not_enough_cp", need: cost, have: state.player.commandPoints },
    };
  }
  const restQueue = state.minionRehireQueue.filter((_, i) => i !== qIdx);
  const next: GameState = {
    ...state,
    minionRehireQueue: restQueue,
    player: {
      ...state.player,
      commandPoints: state.player.commandPoints - cost,
      minions: [...state.player.minions, { ...entry.minion }],
    },
  };
  return {
    ok: true,
    value: appendActivityEvent(withRefreshedAffinities(next, catalog), {
      kind: "minion_rehired",
      templateId: entry.minion.templateId,
    }),
  };
}

export function rerollHireOffers(
  state: GameState,
  catalog: ContentCatalog,
  rng: Rng,
): Result<GameState, GameError> {
  if (state.phase !== "main") {
    return { ok: false, error: { code: "wrong_phase", expected: "main", actual: state.phase } };
  }
  const cost = catalog.balance.rerollHireOffersCp;
  if (state.player.commandPoints < cost) {
    return {
      ok: false,
      error: {
        code: "not_enough_cp",
        need: cost,
        have: state.player.commandPoints,
      },
    };
  }
  const availableMinionTemplateIds = pickHireOfferTemplateIds(
    catalog,
    state.player.maxHireOffers,
    rng,
    state.player,
  );
  return {
    ok: true,
    value: {
      ...state,
      availableMinionTemplateIds,
      player: {
        ...state.player,
        commandPoints: state.player.commandPoints - cost,
      },
    },
  };
}

export function assignMission(
  state: GameState,
  catalog: ContentCatalog,
  activeMissionId: string,
  missionTemplateId: string,
  target: MissionTarget,
  missionSource: MissionSource,
  omegaStageIndex: number | null,
  omegaSlotIndex: number | null,
  participantInstanceIds: string[],
  plannedAssetIds: (string | null)[],
): Result<GameState, GameError> {
  if (state.phase !== "main") {
    return { ok: false, error: { code: "wrong_phase", expected: "main", actual: state.phase } };
  }
  const activeCount = state.activeMissions.length;
  if (activeCount >= state.player.maxConcurrentMissions) {
    return {
      ok: false,
      error: {
        code: "max_concurrent_missions",
        max: state.player.maxConcurrentMissions,
        have: activeCount,
      },
    };
  }
  const missionTemplate = missionTemplateById(catalog, missionTemplateId);
  if (!missionTemplate) {
    return { ok: false, error: { code: "unknown_mission", missionId: missionTemplateId } };
  }

  if (!missionTargetMatchesTemplate(missionTemplate.targetType, target)) {
    return {
      ok: false,
      error: {
        code: "wrong_target_kind",
        expected: missionTemplate.targetType,
        actual: target.kind,
      },
    };
  }

  if (missionSource === "lair") {
    if (omegaStageIndex !== null || omegaSlotIndex !== null) {
      return {
        ok: false,
        error: { code: "invalid_mission_source_binding", reason: "Lair missions do not use omega slots" },
      };
    }
    if (state.activeLairId === null) {
      return { ok: false, error: { code: "no_active_lair" } };
    }
    const fromPool = state.lairMissionIds.includes(missionTemplateId);
    const fromUpgrade = availableLairUpgradeMissionIds(
      state.activeLairId,
      state.completedLairUpgradeMissionIds,
      catalog,
    ).includes(missionTemplateId);
    if (!fromPool && !fromUpgrade) {
      return {
        ok: false,
        error: { code: "mission_not_on_lair", missionId: missionTemplateId },
      };
    }
    if (fromUpgrade) {
      /* One choice per level: while a level's mission is in flight its siblings stay closed,
       * otherwise two mutually exclusive upgrades could resolve on the same tick. */
      const levelIndex = lairUpgradeLevelIndexOfMission(
        state.activeLairId,
        missionTemplateId,
        catalog,
      );
      const running = state.activeMissions.find(
        (am) =>
          am.missionSource === "lair" &&
          lairUpgradeLevelIndexOfMission(state.activeLairId, am.missionTemplateId, catalog) ===
            levelIndex,
      );
      if (running !== undefined) {
        return {
          ok: false,
          error: {
            code: "lair_upgrade_level_busy",
            missionId: missionTemplateId,
            runningMissionId: running.missionTemplateId,
          },
        };
      }
    }
  } else if (missionSource === "omega") {
    if (state.activeOmegaPlanId === null) {
      return { ok: false, error: { code: "no_active_omega_plan" } };
    }
    const plan = getOmegaPlanById(catalog, state.activeOmegaPlanId);
    if (!plan) {
      return { ok: false, error: { code: "no_active_omega_plan" } };
    }
    if (omegaStageIndex === null || omegaSlotIndex === null) {
      return {
        ok: false,
        error: { code: "invalid_mission_source_binding", reason: "Omega missions require stage and slot" },
      };
    }
    if (omegaStageIndex !== state.activeOmegaStageIndex) {
      return {
        ok: false,
        error: {
          code: "invalid_omega_stage",
          expectedStage: state.activeOmegaStageIndex,
          got: omegaStageIndex,
        },
      };
    }
    if (omegaSlotIndex < 0 || omegaSlotIndex > 2) {
      return {
        ok: false,
        error: { code: "invalid_mission_source_binding", reason: "omegaSlotIndex must be 0–2" },
      };
    }
    const slotMissionId = omegaSlotMissionId(plan, omegaStageIndex, omegaSlotIndex);
    if (slotMissionId !== missionTemplateId) {
      return {
        ok: false,
        error: {
          code: "omega_slot_mismatch",
          missionId: missionTemplateId,
          slotMissionId: slotMissionId ?? "",
        },
      };
    }
  } else if (missionSource === "event") {
    if (omegaStageIndex !== null || omegaSlotIndex !== null) {
      return {
        ok: false,
        error: { code: "invalid_mission_source_binding", reason: "Event missions do not use omega slots" },
      };
    }
    if (state.currentEventTemplateId === null) {
      return { ok: false, error: { code: "no_current_event_offer" } };
    }
    if (missionTemplateId !== state.currentEventTemplateId) {
      return {
        ok: false,
        error: {
          code: "event_mission_mismatch",
          currentOffer: state.currentEventTemplateId,
          requested: missionTemplateId,
        },
      };
    }
    /* One global event occupies the slot at a time — the offer is off the table until the
     * mission it started resolves. */
    if (state.activeMissions.some((am) => am.missionSource === "event")) {
      return {
        ok: false,
        error: {
          code: "invalid_mission_source_binding",
          reason: "An event mission is already in progress",
        },
      };
    }
  } else {
    return {
      ok: false,
      error: { code: "invalid_mission_source_binding", reason: "Unknown mission source" },
    };
  }

  const busy = busyInstanceIds(state.activeMissions);

  if (target.kind === "location" || target.kind === "asset") {
    const lid = target.locationId;
    if (!locationById(catalog, lid)) {
      return { ok: false, error: { code: "unknown_location", locationId: lid } };
    }
    if (!activeLocationIds(catalog, state.activeOmegaPlanId).has(lid)) {
      return {
        ok: false,
        error: { code: "location_not_on_active_map", locationId: lid },
      };
    }
  }

  if (target.kind === "asset") {
    const placement = state.locationAssetSlots.find((p) => p.locationId === target.locationId);
    const slot = placement?.slots[target.slotIndex];
    if (!slot) {
      return {
        ok: false,
        error: {
          code: "unknown_asset_slot",
          locationId: target.locationId,
          slotIndex: target.slotIndex,
        },
      };
    }
    if (!isOccupiedAssetSlot(slot)) {
      return {
        ok: false,
        error: {
          code: "empty_asset_slot",
          locationId: target.locationId,
          slotIndex: target.slotIndex,
        },
      };
    }
    /* Intel-aware: at intel ≥ 2 the site's assets read as revealed for targeting, so an
     * `asset_revealed` mission may be aimed at a slot whose stored visibility is still hidden. */
    const intelLevel = intelLevelForLocation(state.locationIntelStates, target.locationId);
    if (effectiveAssetSlotVisibility(slot, intelLevel) !== target.visibilityAtAssign) {
      return {
        ok: false,
        error: {
          code: "asset_visibility_mismatch",
          locationId: target.locationId,
          slotIndex: target.slotIndex,
        },
      };
    }
  }

  if (target.kind === "minion") {
    const tm = state.player.minions.find((x) => x.instanceId === target.instanceId);
    if (!tm) {
      return { ok: false, error: { code: "unknown_target_minion", instanceId: target.instanceId } };
    }
    if (busy.has(target.instanceId)) {
      return { ok: false, error: { code: "minion_on_mission", instanceId: target.instanceId } };
    }
    if (participantInstanceIds.includes(target.instanceId)) {
      return {
        ok: false,
        error: { code: "minion_target_in_participants", instanceId: target.instanceId },
      };
    }
  }

  const participants: MinionInstance[] = [];
  for (const iid of participantInstanceIds) {
    const m = state.player.minions.find((x) => x.instanceId === iid);
    if (!m) {
      return { ok: false, error: { code: "unknown_instance", instanceId: iid } };
    }
    if (busy.has(iid)) {
      return {
        ok: false,
        error: {
          code: "invalid_participants",
          reason: `Minion ${iid} is already on a mission`,
        },
      };
    }
    participants.push(m);
  }

  if (!canAssignParticipants(
    participants,
    missionSource === "event"
      ? catalog.balance.eventMaxParticipants
      : state.player.maxParticipantsPerMission,
  )) {
    const cap =
      missionSource === "event"
        ? catalog.balance.eventMaxParticipants
        : state.player.maxParticipantsPerMission;
    return {
      ok: false,
      error: {
        code: "invalid_participants",
        reason: `Assign 1–${cap} minions`,
      },
    };
  }

  const requiredAssetIds = missionTemplate.requiredAssetIds;
  if (plannedAssetIds.length !== requiredAssetIds.length) {
    return {
      ok: false,
      error: {
        code: "asset_slot_length_mismatch",
        expected: requiredAssetIds.length,
        got: plannedAssetIds.length,
      },
    };
  }
  for (let i = 0; i < requiredAssetIds.length; i += 1) {
    const slotVal = plannedAssetIds[i];
    if (slotVal === null) {
      continue;
    }
    const need = requiredAssetIds[i]!;
    if (slotVal !== need) {
      return {
        ok: false,
        error: {
          code: "asset_slot_id_mismatch",
          slotIndex: i,
          expectedAssetId: need,
          actual: slotVal,
        },
      };
    }
  }
  const assetDeductionTally = new Map<string, number>();
  for (let i = 0; i < requiredAssetIds.length; i += 1) {
    if (plannedAssetIds[i] !== null) {
      const id = requiredAssetIds[i]!;
      assetDeductionTally.set(id, (assetDeductionTally.get(id) ?? 0) + 1);
    }
  }
  for (const [assetId, needQty] of assetDeductionTally) {
    const haveQty = state.player.assets[assetId] ?? 0;
    if (haveQty < needQty) {
      return {
        ok: false,
        error: { code: "not_enough_assets", assetId, need: needQty, have: haveQty },
      };
    }
  }

  const cost = missionTemplate.startCommandPoints;
  if (state.player.commandPoints < cost) {
    return {
      ok: false,
      error: {
        code: "not_enough_cp",
        need: cost,
        have: state.player.commandPoints,
      },
    };
  }

  const nextAssets: Record<string, number> = { ...state.player.assets };
  for (const [assetId, qty] of assetDeductionTally) {
    const v = (nextAssets[assetId] ?? 0) - qty;
    if (v <= 0) {
      delete nextAssets[assetId];
    } else {
      nextAssets[assetId] = v;
    }
  }

  const activeMission: ActiveMission = {
    id: activeMissionId,
    missionTemplateId,
    target,
    missionSource,
    omegaStageIndex: missionSource === "omega" ? omegaStageIndex : null,
    omegaSlotIndex: missionSource === "omega" ? omegaSlotIndex : null,
    participantInstanceIds: [...participantInstanceIds],
    plannedAssetIds: [...plannedAssetIds],
    turnsRemaining: missionTemplate.durationTurns,
    startedOnTurn: state.turnNumber,
  };

  const next: GameState = {
    ...state,
    activeMissions: [...state.activeMissions, activeMission],
    player: {
      ...state.player,
      commandPoints: state.player.commandPoints - cost,
      assets: nextAssets,
    },
  };
  let withEvents = appendActivityEvent(next, {
    kind: "mission_started",
    missionTemplateId,
    target,
    missionSource,
    omegaStageIndex: missionSource === "omega" ? omegaStageIndex : null,
    omegaSlotIndex: missionSource === "omega" ? omegaSlotIndex : null,
    participantInstanceIds: [...participantInstanceIds],
  });
  for (const [assetId, quantity] of assetDeductionTally) {
    withEvents = appendActivityEvent(withEvents, { kind: "asset_lost", assetId, quantity });
  }
  return { ok: true, value: withEvents };
}

export function cancelMission(
  state: GameState,
  catalog: ContentCatalog,
  activeMissionId: string,
): Result<GameState, GameError> {
  if (state.phase !== "main") {
    return { ok: false, error: { code: "wrong_phase", expected: "main", actual: state.phase } };
  }
  const idx = state.activeMissions.findIndex((am) => am.id === activeMissionId);
  if (idx === -1) {
    return { ok: false, error: { code: "unknown_active_mission", activeMissionId } };
  }
  const am = state.activeMissions[idx]!;
  const template = missionTemplateById(catalog, am.missionTemplateId);
  let refundCp = 0;
  if (
    template !== undefined &&
    am.startedOnTurn === state.turnNumber &&
    am.turnsRemaining === template.durationTurns
  ) {
    refundCp = template.startCommandPoints;
  }
  const nextMissions = state.activeMissions.filter((_, i) => i !== idx);
  const refundAssets = new Map<string, number>();
  for (const p of am.plannedAssetIds) {
    if (p !== null) {
      refundAssets.set(p, (refundAssets.get(p) ?? 0) + 1);
    }
  }
  const refundedAssets: Record<string, number> = { ...state.player.assets };
  for (const [assetId, qty] of refundAssets) {
    refundedAssets[assetId] = (refundedAssets[assetId] ?? 0) + qty;
  }
  const next: GameState = {
    ...state,
    activeMissions: nextMissions,
    player: {
      ...state.player,
      commandPoints: state.player.commandPoints + refundCp,
      assets: refundedAssets,
    },
  };
  let withEvents = appendActivityEvent(next, {
    kind: "mission_cancelled",
    missionTemplateId: am.missionTemplateId,
    target: am.target,
  });
  for (const [assetId, quantity] of refundAssets) {
    withEvents = appendActivityEvent(withEvents, { kind: "asset_gained", assetId, quantity });
  }
  return { ok: true, value: withEvents };
}

/**
 * Append a mission template id to the lair pool (e.g. future rewards). No-op duplicate is an error.
 */
export function addLairMissionToPool(
  state: GameState,
  catalog: ContentCatalog,
  missionTemplateId: string,
): Result<GameState, GameError> {
  if (state.activeLairId === null) {
    return { ok: false, error: { code: "no_active_lair" } };
  }
  if (!catalogMissionOnlyById(catalog, missionTemplateId)) {
    return { ok: false, error: { code: "unknown_mission", missionId: missionTemplateId } };
  }
  if (state.lairMissionIds.includes(missionTemplateId)) {
    return {
      ok: false,
      error: { code: "lair_mission_already_in_pool", missionId: missionTemplateId },
    };
  }
  return {
    ok: true,
    value: {
      ...state,
      lairMissionIds: [...state.lairMissionIds, missionTemplateId],
    },
  };
}

/**
 * Raise how many missions may run at once (e.g. rewards or upgrades). Floors at 1.
 */
export function increaseMaxConcurrentMissions(state: GameState, delta: number): GameState {
  const next = Math.max(1, state.player.maxConcurrentMissions + delta);
  return {
    ...state,
    player: {
      ...state.player,
      maxConcurrentMissions: next,
    },
  };
}

/**
 * Main Phase → Resolve Phase work → Summary.
 * Each active mission decrements `turnsRemaining`; at 0, success is rolled vs {@link successChancePercent}.
 * Pass `newInstanceId` alongside a seeded `rng` for fully deterministic resolves (it feeds
 * opposing-agent spawns); defaults to `crypto.randomUUID`.
 */
/**
 * Stamps a resolve-time activity row with the mission whose resolution produced it, so the
 * end-of-turn report can group each mission's fallout under its own result card. Rows that
 * carry no `activeMissionId` field (e.g. `event_expired`) pass through untouched.
 */
function withActiveMissionId(ev: ActivityEvent, activeMissionId: string): ActivityEvent {
  if (ev.kind === "asset_gained" || ev.kind === "asset_lost" || ev.kind === "minion_leveled_up") {
    return { ...ev, activeMissionId };
  }
  return ev;
}

export function executePlan(
  state: GameState,
  catalog: ContentCatalog,
  rng: Rng,
  newInstanceId: () => string = () => globalThis.crypto.randomUUID(),
): Result<GameState, GameError> {
  if (state.runEnding !== null) {
    return { ok: false, error: { code: "run_ended", ending: state.runEnding } };
  }
  if (state.phase !== "main") {
    return { ok: false, error: { code: "wrong_phase", expected: "main", actual: state.phase } };
  }

  const lairRaid = lairRaidEventTemplate(catalog);
  /* Set by the resolve loop when the raid's own mission finishes; drives the loss check, the
   * top-tier stand-down, and (on an abort) putting the raid back in the queue. */
  let lairRaidOutcome: "success" | "failure" | "aborted" | null = null;

  let player = state.player;
  const resolveEvents: ActivityEvent[] = [];
  const remaining: ActiveMission[] = [];
  let locationSecurityStates = state.locationSecurityStates;
  let locationIntelStates = state.locationIntelStates;
  let locationAssetSlots = state.locationAssetSlots;
  let lairMissionIds = [...state.lairMissionIds];
  let completedLairUpgradeMissionIds = [...state.completedLairUpgradeMissionIds];
  let minionAffinities = [...state.minionAffinities];
  let opposingAgentInstances: AgentInstance[] = [...state.opposingAgentInstances];
  let locationAgentPresence: LocationAgentPresence[] = state.locationAgentPresence.map((r) => ({
    locationId: r.locationId,
    agentInstanceIds: [...r.agentInstanceIds],
  }));

  const instanceById = new Map(state.player.minions.map((m) => [m.instanceId, m]));

  let activeSuccessModifiers = state.activeSuccessModifiers.map((m) => ({ ...m }));
  /* The offer is "engaged" once its mission exists — started this Main Phase or still running
   * from an earlier one. Cancelling before Execute Plan leaves the offer on the table. */
  const eventMissionAtStart = state.activeMissions.some((am) => am.missionSource === "event");

  const updated = state.activeMissions.map((am) => ({
    ...am,
    turnsRemaining: am.turnsRemaining - 1,
  }));

  const stageAtExecute = state.activeOmegaStageIndex;
  const omegaStageProgress = state.omegaStageProgress.map(
    (row) => [row[0], row[1], row[2]] as OmegaSlotFlags,
  ) as [OmegaSlotFlags, OmegaSlotFlags, OmegaSlotFlags];

  for (const am of updated) {
    if (am.turnsRemaining > 0) {
      remaining.push(am);
      continue;
    }

    const template = missionTemplateById(catalog, am.missionTemplateId);

    const participants: MinionInstance[] = [];
    let missing = false;
    for (const iid of am.participantInstanceIds) {
      const inst = instanceById.get(iid);
      if (!inst) {
        missing = true;
        break;
      }
      participants.push(inst);
    }
    if (
      !template ||
      missing ||
      !canAssignParticipants(
        participants,
        am.missionSource === "event"
          ? catalog.balance.eventMaxParticipants
          : player.maxParticipantsPerMission,
      )
    ) {
      /* Invariant breach (see `mission_aborted` docs): don't drop the mission silently —
       * refund committed assets and log so the failure is visible in the Activity panel. */
      const refund = new Map<string, number>();
      for (const pa of am.plannedAssetIds) {
        if (pa !== null) {
          refund.set(pa, (refund.get(pa) ?? 0) + 1);
        }
      }
      if (refund.size > 0) {
        const nextAssets = { ...player.assets };
        for (const [assetId, qty] of refund) {
          nextAssets[assetId] = (nextAssets[assetId] ?? 0) + qty;
        }
        player = { ...player, assets: nextAssets };
      }
      if (lairRaid !== undefined && am.missionTemplateId === lairRaid.id) {
        /* An aborted raid is an invariant breach, not a loss — requeue it rather than ending
         * the run on a bug (see `mission_aborted`). */
        lairRaidOutcome = "aborted";
      }
      resolveEvents.push({
        kind: "mission_aborted",
        activeMissionId: am.id,
        missionTemplateId: am.missionTemplateId,
        target: am.target,
        reason: !template ? "missing_template" : "invalid_participants",
      });
      for (const [assetId, quantity] of refund) {
        resolveEvents.push({ kind: "asset_gained", assetId, quantity, activeMissionId: am.id });
      }
      continue;
    }

    const missionLocId = getMissionTargetLocationId(am.target);
    const opposingAgentPenaltyCount =
      missionLocId === null
        ? 0
        : countOpposingAgentsAtLocationFromData(
            opposingAgentInstances,
            locationAgentPresence,
            missionLocId,
            "all",
          );

    const dynamicTraitDelta = dynamicTraitSuccessModifierFromFullRoster(
      Array.from(instanceById.values()),
      am.participantInstanceIds,
      missionLocId,
      catalog.balance.dynamicTraitModifiers,
    );

    const eventSuccessModifierDelta = activeSuccessModifiers.reduce((s, m) => s + m.delta, 0);

    /* Deliberate: site required/security traits come from the START-of-turn snapshot
     * (`state`), not the in-loop locals — resolution is simultaneous, so an earlier
     * mission's security bump this resolve must not change a later mission's requirements.
     * Pinned by tests in gameState.test.ts ("simultaneous resolution snapshot"). */
    const pct = successChancePercent(
      template,
      participants,
      {
        ...missionSuccessOptionsForTarget(state, am.target),
        assignedAssetIds: am.plannedAssetIds,
        traitsCatalog: catalog.traits,
        opposingAgentPenaltyCount,
        dynamicTraitDelta,
        eventSuccessModifierDelta,
        balance: catalog.balance,
      },
    );
    const roll = Math.floor(rng() * 100);
    const success = roll < pct;
    if (lairRaid !== undefined && template.id === lairRaid.id) {
      lairRaidOutcome = success ? "success" : "failure";
    }
    const infamyBefore = player.infamy;
    const heatBefore = player.heat;
    const baselineInfamy = success
      ? catalog.balance.infamySuccessDelta
      : catalog.balance.infamyFailureDelta;
    const baselineHeat = success
      ? catalog.balance.heatSuccessDelta
      : catalog.balance.heatFailureDelta;
    player = {
      ...player,
      infamy: player.infamy + baselineInfamy,
      heat: player.heat + baselineHeat,
    };

    const effectList = success
      ? (template.onSuccessEffects ?? [])
      : (template.onFailureEffects ?? []);
    const effectState: GameState = {
      ...state,
      player,
      locationAssetSlots,
      locationSecurityStates,
      locationIntelStates,
      activeSuccessModifiers,
    };
    const applied = applyMissionEffects(effectState, effectList, am, catalog, rng);
    player = applied.player;
    locationAssetSlots = applied.locationAssetSlots;
    locationSecurityStates = applied.locationSecurityStates;
    locationIntelStates = applied.locationIntelStates;
    activeSuccessModifiers = applied.activeSuccessModifiers;
    /* Sync the lookup with any minion mutations from applyMissionEffects
     * (e.g. add_target_minion_traits, add_random_participant_traits, add_all_participant_traits) so the XP pass and final merge below see them. */
    for (const m of player.minions) {
      instanceById.set(m.instanceId, m);
    }

    const rosterForDynamic = Array.from(instanceById.values());
    const dynamicRoll = rollLocationDynamicTraitsAfterMission(
      rosterForDynamic,
      am.participantInstanceIds,
      success,
      am.target,
      rng,
      catalog.balance.dynamicTraitRollPercent,
    );
    for (const m of dynamicRoll.nextMinions) {
      instanceById.set(m.instanceId, m);
    }
    const dynamicTraitChanges =
      dynamicRoll.changes.length > 0 ? dynamicRoll.changes : undefined;

    /* Running a job together moves the pair's shared affinity by a fixed amount — no roll. The
     * raid takes precedence over its `event` source: it is its own category of shared ordeal. */
    const affinityDelta = affinityDeltaForResolve(
      am.missionSource,
      lairRaid !== undefined && template.id === lairRaid.id,
      success,
      catalog.balance.minionAffinity,
    );
    const affinityResult = applyMissionAffinity(
      minionAffinities,
      am.participantInstanceIds,
      affinityDelta,
      catalog.balance.minionAffinity,
    );
    minionAffinities = affinityResult.next;
    const relationshipChanges =
      affinityResult.changes.length > 0 ? affinityResult.changes : undefined;

    /* Re-project the pills so the roster reflects any band that just moved. */
    for (const m of syncMinionPairDynamicTraits(
      Array.from(instanceById.values()),
      minionAffinities,
    )) {
      instanceById.set(m.instanceId, m);
    }
    player = {
      ...player,
      minions: player.minions.map((mm) => instanceById.get(mm.instanceId) ?? mm),
    };

    const isCriticalFailure =
      !success &&
      missionLocId !== null &&
      opposingAgentPenaltyCount > 0;
    let criticalInjuryInstanceIds: string[] | undefined;
    let criticalOpposingAgentCount: number | undefined;
    let criticalInjuryChancePercent: number | undefined;
    if (isCriticalFailure) {
      const chance = Math.min(
        100,
        catalog.balance.injuryChancePerAgentPercent * opposingAgentPenaltyCount,
      );
      const injury = applyCriticalFailureInjuryRolls(
        player,
        am.participantInstanceIds,
        chance,
        "injured",
        rng,
      );
      player = injury.player;
      for (const m of player.minions) {
        instanceById.set(m.instanceId, m);
      }
      criticalOpposingAgentCount = opposingAgentPenaltyCount;
      criticalInjuryChancePercent = chance;
      criticalInjuryInstanceIds = injury.newlyInjuredInstanceIds;
    }

    const infamyDeltaTotal = player.infamy - infamyBefore;
    const heatDeltaTotal = player.heat - heatBefore;

    const templateEffectDescriptions = describeMissionTemplateEffects(effectList);

    resolveEvents.push({
      kind: "mission_completed",
      activeMissionId: am.id,
      missionTemplateId: template.id,
      missionName: template.name,
      target: am.target,
      success,
      roll,
      successChancePercent: pct,
      infamyDelta: infamyDeltaTotal,
      baselineInfamyDelta: baselineInfamy,
      heatDelta: heatDeltaTotal,
      baselineHeatDelta: baselineHeat,
      templateEffectDescriptions,
      criticalFailure: isCriticalFailure,
      ...(dynamicTraitChanges !== undefined
        ? { dynamicTraitChanges }
        : {}),
      ...(relationshipChanges !== undefined ? { relationshipChanges } : {}),
      ...(isCriticalFailure
        ? {
            criticalOpposingAgentCount,
            criticalInjuryChancePercent,
            criticalInjuryInstanceIds,
          }
        : {}),
    });
    /* Tagged so the end-of-turn mission modal can show exactly this mission's fallout. */
    resolveEvents.push(...applied.events.map((ev) => withActiveMissionId(ev, am.id)));

    if (success) {
      for (const eff of orderedMissionEffects(template.onSuccessEffects ?? [])) {
        if (eff.kind !== "unlock_lair_mission") {
          continue;
        }
        if (
          catalogMissionOnlyById(catalog, eff.missionId) &&
          !lairMissionIds.includes(eff.missionId)
        ) {
          lairMissionIds = [...lairMissionIds, eff.missionId];
        }
      }
      /* Installing an upgrade settles its whole level: the siblings are never offered again
       * (the Upgrades tab moves on to the next level). */
      if (
        isLairUpgradeMission(state.activeLairId, template.id, catalog) &&
        !completedLairUpgradeMissionIds.includes(template.id)
      ) {
        completedLairUpgradeMissionIds = [...completedLairUpgradeMissionIds, template.id];
      }
    }

    const secLoc = getMissionTargetLocationId(am.target);
    if (secLoc !== null) {
      locationSecurityStates = raiseSecurityAfterMissionAtLocation(
        locationSecurityStates,
        catalog,
        secLoc,
      );
      const agentsAtSite = countOpposingAgentsAtLocationFromData(
        opposingAgentInstances,
        locationAgentPresence,
        secLoc,
        "all",
      );
      if (agentsAtSite > 0) {
        opposingAgentInstances = revealAllOpposingAgentsAtLocation(
          opposingAgentInstances,
          secLoc,
          locationAgentPresence,
        );
      }
    }

    for (const iid of am.participantInstanceIds) {
      const inst = instanceById.get(iid);
      if (!inst) {
        continue;
      }
      const minionTpl = minionTemplateById(catalog, inst.templateId);
      if (!minionTpl) {
        continue;
      }
      const { instance: nextInst, leveledUp, traitUnlockedId } =
        awardMissionResolutionExperience(inst, minionTpl, catalog.balance);
      instanceById.set(iid, nextInst);
      if (leveledUp) {
        resolveEvents.push({
          kind: "minion_leveled_up",
          instanceId: iid,
          templateId: inst.templateId,
          newLevel: nextInst.currentLevel,
          traitId: traitUnlockedId,
          activeMissionId: am.id,
        });
      }
    }

    /* Credit the mission's own phase: a phase can clear before its slower slots resolve. */
    if (
      success &&
      am.missionSource === "omega" &&
      am.omegaStageIndex !== null &&
      am.omegaStageIndex >= 0 &&
      am.omegaStageIndex <= 2 &&
      am.omegaSlotIndex !== null &&
      am.omegaSlotIndex >= 0 &&
      am.omegaSlotIndex <= 2
    ) {
      omegaStageProgress[am.omegaStageIndex]![am.omegaSlotIndex] = true;
    }
  }

  /* A phase clears at its designer-authored `requiredMissions`, not always all three. */
  let activeOmegaStageIndex = state.activeOmegaStageIndex;
  const activePlan =
    state.activeOmegaPlanId !== null
      ? getOmegaPlanById(catalog, state.activeOmegaPlanId)
      : undefined;
  /* Clearing the **last** phase finishes the plan — the run's win condition. */
  let omegaPlanCompleted = false;
  if (
    activePlan !== undefined &&
    isOmegaStageComplete(activePlan, stageAtExecute, omegaStageProgress[stageAtExecute]!)
  ) {
    omegaPlanCompleted = stageAtExecute >= OMEGA_STAGE_COUNT - 1;
    activeOmegaStageIndex = Math.min(OMEGA_STAGE_COUNT - 1, stageAtExecute + 1);
  }

  player = {
    ...player,
    minions: state.player.minions.map((m) => instanceById.get(m.instanceId) ?? m),
  };

  /* Uses post-resolve infamy, so a mission that crosses a threshold widens this same draw. */
  const availableMinionTemplateIds = pickHireOfferTemplateIds(
    catalog,
    player.maxHireOffers,
    rng,
    player,
  );

  /* ---------------------------------------------------------------------------------------
   * Lair Raid — the loss condition. It rides the top wanted tier: reaching that tier owes the
   * player a raid, and the raid's own outcome decides whether the run continues.
   * ------------------------------------------------------------------------------------- */
  let lairRaidStatus = state.lairRaidStatus;
  let runEnding: RunEnding | null = null;

  /* The offer left the table because the player started it (the slot bookkeeping below clears
   * `currentEventTemplateId`; this records *why*). */
  if (lairRaidStatus === "offered" && eventMissionAtStart) {
    lairRaidStatus = "engaged";
  }
  if (lairRaidOutcome === "success") {
    /* Survived: the top tier stands down. Heat relief comes from the template's own
     * `onSuccessEffects` (a `heat_delta`), so designers tune it in content. */
    lairRaidStatus = "none";
  } else if (lairRaidOutcome === "failure") {
    runEnding = { kind: "defeat", reason: "lair_raid_failed" };
  } else if (lairRaidOutcome === "aborted") {
    lairRaidStatus = "pending";
  }
  /* Deliberately last, and unconditional: a resolve that both finishes the plan and loses the
   * lair is a **win** (see `RunEnding`). */
  if (omegaPlanCompleted) {
    runEnding = { kind: "victory", omegaPlanId: state.activeOmegaPlanId };
  }

  let wantedLevelTierIndex = nextMonotonicWantedTierIndex(
    state.wantedLevelTierIndex,
    player.heat,
    catalog.wantedLevels,
  );
  const topTierIndex = topWantedTierIndex(catalog);
  if (lairRaidOutcome === "success" && topTierIndex !== null) {
    /* Standing the top tier down is the one break in the wanted ratchet: every lower tier keeps
     * its floor, so the raid only returns once heat climbs back to the top tier's `minHeat`. */
    wantedLevelTierIndex = Math.min(wantedLevelTierIndex, topTierIndex - 1);
  }
  if (
    topTierIndex !== null &&
    lairRaid !== undefined &&
    wantedLevelTierIndex >= topTierIndex &&
    lairRaidStatus === "none"
  ) {
    lairRaidStatus = "pending";
  }

  const tierIncreased = wantedLevelTierIndex > state.wantedLevelTierIndex;
  if (tierIncreased) {
    const playableIds = locationTemplatesForOmegaPlan(catalog, state.activeOmegaPlanId).map(
      (l) => l.id,
    );
    const spawned = spawnOpposingAgentsAfterWantedEscalation(
      opposingAgentInstances,
      locationAgentPresence,
      catalog,
      playableIds,
      state.wantedLevelTierIndex,
      wantedLevelTierIndex,
      rng,
      newInstanceId,
    );
    opposingAgentInstances = spawned.opposingAgentInstances;
    locationAgentPresence = spawned.locationAgentPresence;
  }

  /* ---------------------------------------------------------------------------------------
   * Global event slot. Exactly one event occupies it at a time, in one of three states:
   *   offer      — on the table, `currentEventTurnsRemaining` turns left to start it
   *   in progress— the player started it; the mission decides the outcome, nothing expires
   *   cooldown   — `eventCooldownTurnsRemaining` quiet turns before the next offer is drawn
   * ------------------------------------------------------------------------------------- */
  let nextCurrentEventTemplateId = state.currentEventTemplateId;
  let nextCurrentEventTurnsRemaining = state.currentEventTurnsRemaining;
  let nextEventCooldownTurnsRemaining = state.eventCooldownTurnsRemaining;
  const eventMissionStillActive = remaining.some((am) => am.missionSource === "event");
  /* Resolved, aborted, or cancelled during Main — either way the slot is free again. */
  let eventSlotFreedThisTurn = eventMissionAtStart && !eventMissionStillActive;

  if (nextCurrentEventTemplateId !== null) {
    if (eventMissionAtStart) {
      /* Engaged: the offer leaves the table, its lifetime stops, and no effects fire now —
       * the mission's own success / failure effects apply when it resolves. */
      nextCurrentEventTemplateId = null;
      nextCurrentEventTurnsRemaining = 0;
    } else {
      nextCurrentEventTurnsRemaining -= 1;
      if (nextCurrentEventTurnsRemaining <= 0) {
        /* Lifetime ran out unstarted: the player takes the consequences. */
        const et = eventTemplateById(catalog, nextCurrentEventTemplateId);
        const expireList = et?.expireEffects ?? [];
        if (expireList.length > 0) {
          const stubAm: ActiveMission = {
            id: "__event_expire__",
            missionTemplateId: nextCurrentEventTemplateId,
            target: { kind: "none" },
            missionSource: "event",
            omegaStageIndex: null,
            omegaSlotIndex: null,
            participantInstanceIds: [],
            plannedAssetIds: [],
            turnsRemaining: 0,
            startedOnTurn: state.turnNumber,
          };
          const expireState: GameState = {
            ...state,
            player,
            locationAssetSlots,
            locationSecurityStates,
            locationIntelStates,
            activeSuccessModifiers,
          };
          const expired = applyMissionEffects(expireState, expireList, stubAm, catalog, rng);
          player = expired.player;
          locationAssetSlots = expired.locationAssetSlots;
          locationSecurityStates = expired.locationSecurityStates;
          locationIntelStates = expired.locationIntelStates;
          activeSuccessModifiers = expired.activeSuccessModifiers;
          resolveEvents.push({
            kind: "event_expired",
            eventTemplateId: nextCurrentEventTemplateId,
            effectDescriptions: describeMissionTemplateEffects(expireList),
          });
          resolveEvents.push(...expired.events);
        } else {
          resolveEvents.push({
            kind: "event_expired",
            eventTemplateId: nextCurrentEventTemplateId,
            effectDescriptions: [],
          });
        }
        if (
          lairRaid !== undefined &&
          nextCurrentEventTemplateId === lairRaid.id &&
          runEnding === null
        ) {
          /* Ignoring the raid is the same as losing it — unless the plan just landed. */
          runEnding = { kind: "defeat", reason: "lair_raid_expired" };
        }
        nextCurrentEventTemplateId = null;
        nextCurrentEventTurnsRemaining = 0;
        eventSlotFreedThisTurn = true;
      }
    }
  }

  activeSuccessModifiers = activeSuccessModifiers
    .map((m) => ({ ...m, turnsRemaining: m.turnsRemaining - 1 }))
    .filter((m) => m.turnsRemaining > 0);

  /* Nothing is drawn while an event mission is still running, or once the run has ended. */
  if (nextCurrentEventTemplateId === null && !eventMissionStillActive && runEnding === null) {
    if (lairRaid !== undefined && lairRaidStatus === "pending") {
      /* The raid jumps the queue: an owed raid takes the first free slot regardless of how many
       * quiet turns were rolled, and no ordinary offer is drawn this resolve. */
      nextCurrentEventTemplateId = lairRaid.id;
      nextCurrentEventTurnsRemaining = Math.max(1, lairRaid.lifetimeTurns);
      nextEventCooldownTurnsRemaining = 0;
      lairRaidStatus = "offered";
      resolveEvents.push({
        kind: "event_rotated_in",
        eventTemplateId: lairRaid.id,
        lifetimeTurns: nextCurrentEventTurnsRemaining,
      });
    } else if (eventSlotFreedThisTurn) {
      nextEventCooldownTurnsRemaining = rollEventCooldownTurns(catalog, rng);
    } else if (nextEventCooldownTurnsRemaining > 0) {
      nextEventCooldownTurnsRemaining -= 1;
    }
    /* `null` still, i.e. the raid did not just claim the slot. */
    if (nextCurrentEventTemplateId === null && nextEventCooldownTurnsRemaining === 0) {
      /* Gates read the player's post-resolve stats, so crossing a threshold this turn opens
       * that event up for the draw that follows it. */
      const draw = drawEventOffer(catalog, rng, player);
      if (draw !== null) {
        nextCurrentEventTemplateId = draw.eventTemplateId;
        nextCurrentEventTurnsRemaining = draw.lifetimeTurns;
        resolveEvents.push({
          kind: "event_rotated_in",
          eventTemplateId: draw.eventTemplateId,
          lifetimeTurns: draw.lifetimeTurns,
        });
      }
    }
  }

  if (runEnding !== null) {
    /* Last row of the run — the run-end modals read the ending from state, not the log, but
     * the Activity panel should still show where it ended. */
    resolveEvents.push({ kind: "run_ended", ending: runEnding });
  }

  const activityLog = mergeResolveActivityEventsIntoActivityLog(
    state.activityLog,
    state.turnNumber,
    resolveEvents,
  );

  return {
    ok: true,
    value: {
      ...state,
      phase: "summary",
      player,
      activeMissions: remaining,
      availableMinionTemplateIds,
      activityLog,
      activeOmegaStageIndex,
      omegaStageProgress,
      locationSecurityStates,
      locationIntelStates,
      locationAssetSlots,
      lairMissionIds,
      completedLairUpgradeMissionIds,
      wantedLevelTierIndex,
      opposingAgentInstances,
      locationAgentPresence,
      currentEventTemplateId: nextCurrentEventTemplateId,
      currentEventTurnsRemaining: nextCurrentEventTurnsRemaining,
      eventCooldownTurnsRemaining: nextEventCooldownTurnsRemaining,
      activeSuccessModifiers,
      minionAffinities,
      lairRaidStatus,
      runEnding,
    },
  };
}

export function advanceToNextTurn(state: GameState): Result<GameState, GameError> {
  if (state.runEnding !== null) {
    return { ok: false, error: { code: "run_ended", ending: state.runEnding } };
  }
  if (state.phase !== "summary") {
    return {
      ok: false,
      error: { code: "wrong_phase", expected: "summary", actual: state.phase },
    };
  }
  return {
    ok: true,
    value: {
      ...state,
      phase: "main",
      turnNumber: state.turnNumber + 1,
      player: {
        ...state.player,
        commandPoints:
          state.player.maxCommandPoints + state.player.pendingBonusCommandPoints,
        pendingBonusCommandPoints: 0,
      },
    },
  };
}
