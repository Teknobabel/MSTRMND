import type {
  AgentInstance,
  ContentCatalog,
  DynamicTraitActivityChange,
  EventTemplate,
  LocationAssetPlacement,
  LocationAssetSlot,
  LocationAgentPresence,
  LocationIntelState,
  LocationSecurityState,
  LocationTemplate,
  MinionInstance,
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
  rollDynamicTraitsAfterMission,
} from "./dynamicTrait";
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
import { getOmegaPlanById, omegaSlotMissionId, pickRandomOmegaPlanId } from "./omegaPlan";
import { getLairById, pendingLairUpgradeMissionIds, pickRandomLairId } from "./lair";
import { nextMonotonicWantedTierIndex } from "./wantedLevel";

export type TurnPhase = "main" | "resolve" | "summary";

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
  /** Dynamic trait adds/upgrades/replacements after this resolve (before XP). */
  dynamicTraitChanges?: DynamicTraitActivityChange[];
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
  | { kind: "asset_gained"; assetId: string; quantity: number }
  | { kind: "asset_lost"; assetId: string; quantity: number }
  | {
      kind: "minion_leveled_up";
      instanceId: string;
      templateId: string;
      newLevel: number;
      /** Present when a trait from `levelUpTraitOrder` was unlocked. */
      traitId?: string;
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
   * Upgrade missions from the active lair template that have completed successfully this run
   * (removed from the Upgrades tab).
   */
  completedLairUpgradeMissionIds: string[];
  /** Current Omega plan phase row (0–2) used for which missions may be assigned from the plan. */
  activeOmegaStageIndex: number;
  /** Per-slot success flags for the current row (reset when the row completes and the stage advances). */
  omegaRowProgress: [boolean, boolean, boolean];
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
 */
export function eligibleEventTemplates(
  catalog: ContentCatalog,
  player: PlayerState,
): EventTemplate[] {
  return catalog.events.filter(
    (e) => player.infamy >= (e.minInfamy ?? 0) && player.heat >= (e.minHeat ?? 0),
  );
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
 * Create a fresh run. Pass a seeded `rng` for deterministic runs (tests, replays);
 * defaults to `Math.random` for normal play.
 */
export function createInitialGameState(
  catalog: ContentCatalog,
  rng: Rng = () => Math.random(),
): GameState {
  const activeOmegaPlanId = pickRandomOmegaPlanId(catalog, rng);
  const activeLairId = pickRandomLairId(catalog, rng);
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
  const lairMissionIds = lairTemplate ? [...lairTemplate.availableMissionIds] : [];
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
    omegaRowProgress: [false, false, false],
    wantedLevelTierIndex: 0,
    currentEventTemplateId: openingEventOffer?.eventTemplateId ?? null,
    currentEventTurnsRemaining: openingEventOffer?.lifetimeTurns ?? 0,
    eventCooldownTurnsRemaining: firstEventTurn - 1,
    activeSuccessModifiers: [],
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
    value: appendActivityEvent(next, { kind: "minion_hired", templateId }),
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
    value: appendActivityEvent(next, { kind: "minion_fired", templateId: minion.templateId }),
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
    value: appendActivityEvent(next, {
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
    const fromUpgrade = pendingLairUpgradeMissionIds(
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
export function executePlan(
  state: GameState,
  catalog: ContentCatalog,
  rng: Rng,
  newInstanceId: () => string = () => globalThis.crypto.randomUUID(),
): Result<GameState, GameError> {
  if (state.phase !== "main") {
    return { ok: false, error: { code: "wrong_phase", expected: "main", actual: state.phase } };
  }

  let player = state.player;
  const resolveEvents: ActivityEvent[] = [];
  const remaining: ActiveMission[] = [];
  let locationSecurityStates = state.locationSecurityStates;
  let locationIntelStates = state.locationIntelStates;
  let locationAssetSlots = state.locationAssetSlots;
  let lairMissionIds = [...state.lairMissionIds];
  let completedLairUpgradeMissionIds = [...state.completedLairUpgradeMissionIds];
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
  let omegaRowProgress: [boolean, boolean, boolean] = [
    state.omegaRowProgress[0],
    state.omegaRowProgress[1],
    state.omegaRowProgress[2],
  ];

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
      resolveEvents.push({
        kind: "mission_aborted",
        activeMissionId: am.id,
        missionTemplateId: am.missionTemplateId,
        target: am.target,
        reason: !template ? "missing_template" : "invalid_participants",
      });
      for (const [assetId, quantity] of refund) {
        resolveEvents.push({ kind: "asset_gained", assetId, quantity });
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
    const dynamicRoll = rollDynamicTraitsAfterMission(
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
    player = {
      ...player,
      minions: player.minions.map((mm) => instanceById.get(mm.instanceId) ?? mm),
    };
    const dynamicTraitChanges =
      dynamicRoll.changes.length > 0 ? dynamicRoll.changes : undefined;

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
      ...(isCriticalFailure
        ? {
            criticalOpposingAgentCount,
            criticalInjuryChancePercent,
            criticalInjuryInstanceIds,
          }
        : {}),
    });
    resolveEvents.push(...applied.events);

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
      if (state.activeLairId !== null) {
        const lair = getLairById(catalog, state.activeLairId);
        if (
          lair?.upgradeMissionIds.includes(template.id) &&
          !completedLairUpgradeMissionIds.includes(template.id)
        ) {
          completedLairUpgradeMissionIds = [...completedLairUpgradeMissionIds, template.id];
        }
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
        });
      }
    }

    if (
      success &&
      am.missionSource === "omega" &&
      am.omegaStageIndex === stageAtExecute &&
      am.omegaSlotIndex !== null &&
      am.omegaSlotIndex >= 0 &&
      am.omegaSlotIndex <= 2
    ) {
      omegaRowProgress[am.omegaSlotIndex] = true;
    }
  }

  let activeOmegaStageIndex = state.activeOmegaStageIndex;
  if (omegaRowProgress[0] && omegaRowProgress[1] && omegaRowProgress[2]) {
    activeOmegaStageIndex = Math.min(2, stageAtExecute + 1);
    omegaRowProgress = [false, false, false];
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

  const wantedLevelTierIndex = nextMonotonicWantedTierIndex(
    state.wantedLevelTierIndex,
    player.heat,
    catalog.wantedLevels,
  );

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
        nextCurrentEventTemplateId = null;
        nextCurrentEventTurnsRemaining = 0;
        eventSlotFreedThisTurn = true;
      }
    }
  }

  activeSuccessModifiers = activeSuccessModifiers
    .map((m) => ({ ...m, turnsRemaining: m.turnsRemaining - 1 }))
    .filter((m) => m.turnsRemaining > 0);

  /* Nothing is drawn while an event mission is still running. */
  if (nextCurrentEventTemplateId === null && !eventMissionStillActive) {
    if (eventSlotFreedThisTurn) {
      nextEventCooldownTurnsRemaining = rollEventCooldownTurns(catalog, rng);
    } else if (nextEventCooldownTurnsRemaining > 0) {
      nextEventCooldownTurnsRemaining -= 1;
    }
    if (nextEventCooldownTurnsRemaining === 0) {
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
      omegaRowProgress,
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
    },
  };
}

export function advanceToNextTurn(state: GameState): Result<GameState, GameError> {
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
