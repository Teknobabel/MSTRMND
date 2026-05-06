import type {
  ContentCatalog,
  LocationAssetPlacement,
  LocationAssetSlot,
  LocationSecurityState,
  LocationTemplate,
  MinionInstance,
  MissionSource,
  MissionTarget,
  MissionTargetType,
  MissionTemplate,
} from "./types";
import { isOccupiedAssetSlot } from "./types";
import { awardMissionResolutionExperience, createMinionFromTemplate } from "./minion";
import {
  activeLocationIds,
  initialLocationSecurityStatesForLocations,
  locationTemplatesForOmegaPlan,
  maxSecurityLevelForLocation,
  rollLocationRequiredTraits,
  rollLocationSecurityTraits,
} from "./locationCatalog";
import {
  canAssignParticipants,
  successChancePercent,
  type MissionSuccessOptions,
} from "./mission";
import {
  applyMissionEffects,
  describeMissionTemplateEffects,
  orderedMissionEffects,
} from "./missionEffects";
import { getOmegaPlanById, omegaSlotMissionId, pickRandomOmegaPlanId } from "./omegaPlan";
import { getLairById, pendingLairUpgradeMissionIds, pickRandomLairId } from "./lair";

export type TurnPhase = "main" | "resolve" | "summary";

export type PlayerState = {
  commandPoints: number;
  maxCommandPoints: number;
  /** 0–100 */
  infamy: number;
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
  /** Template effect lines in resolution order (reveal/steal first, then the rest). */
  templateEffectDescriptions: string[];
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
  | { code: "unknown_target_minion"; instanceId: string };

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

const INFAMY_SUCCESS_DELTA = -3;
const INFAMY_FAILURE_DELTA = 5;

const DEFAULT_MAX_ROSTER_SIZE = 5;
const DEFAULT_MAX_HIRE_OFFERS = 3;
const DEFAULT_MAX_CONCURRENT_MISSIONS = 2;
const DEFAULT_MAX_PARTICIPANTS_PER_MISSION = 3;
/** CP spent to reroll the hire offer pool during Main Phase */
export const REROLL_HIRE_OFFERS_CP = 1;

/** Turns (`GameState.turnNumber`) before a fired minion appears in the hire pool again. */
export const MINION_FIRE_REHIRE_COOLDOWN_TURNS = 3;

export function clampInfamy(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/** After a mission finishes at `locationId`, raise that location's security by 1 (cap = location level). */
function raiseSecurityAfterMissionAtLocation(
  states: LocationSecurityState[],
  catalog: ContentCatalog,
  locationId: string,
): LocationSecurityState[] {
  const cap = maxSecurityLevelForLocation(catalog, locationId);
  return states.map((s) => {
    if (s.locationId !== locationId) {
      return s;
    }
    const next = Math.min(cap, s.securityLevel + 1);
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
 * For each location: 1–3 random distinct catalog assets (none if `catalog.assets` is empty),
 * all hidden. Then `min(3, total slots)` slots chosen uniformly at random are revealed.
 */
function initializeLocationAssetPlacements(
  catalog: ContentCatalog,
  rng: Rng,
  runLocations: LocationTemplate[],
): LocationAssetPlacement[] {
  const placements: LocationAssetPlacement[] = [];
  for (const loc of runLocations) {
    let slots: LocationAssetSlot[] = [];
    if (catalog.assets.length > 0) {
      const targetCount = 1 + Math.floor(rng() * 3);
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

  const flat: { pi: number; si: number }[] = [];
  for (let pi = 0; pi < placements.length; pi += 1) {
    const { slots } = placements[pi]!;
    for (let si = 0; si < slots.length; si += 1) {
      flat.push({ pi, si });
    }
  }
  const k = Math.min(3, flat.length);
  if (k > 0) {
    shuffleInPlace(flat, rng);
    for (let i = 0; i < k; i += 1) {
      const ref = flat[i]!;
      const cell = placements[ref.pi]!.slots[ref.si]!;
      if (isOccupiedAssetSlot(cell)) {
        placements[ref.pi]!.slots[ref.si] = { ...cell, visibility: "revealed" };
      }
    }
  }
  return placements;
}

/**
 * Random distinct minion template ids (without replacement), up to `count`.
 * Optionally excludes ids (e.g. templates already on the roster).
 */
export function pickRandomMinionTemplateIds(
  catalog: ContentCatalog,
  count: number,
  rng: Rng,
  excludeTemplateIds?: ReadonlySet<string>,
): string[] {
  let ids = catalog.minions.map((m) => m.id);
  if (excludeTemplateIds && excludeTemplateIds.size > 0) {
    ids = ids.filter((id) => !excludeTemplateIds.has(id));
  }
  if (ids.length === 0 || count <= 0) {
    return [];
  }
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

export function createInitialGameState(catalog: ContentCatalog): GameState {
  const rng: Rng = () => Math.random();
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
    commandPoints: 5,
    maxCommandPoints: 5,
    infamy: 0,
    minions: [],
    assets: assetsFromLair,
    maxRosterSize: DEFAULT_MAX_ROSTER_SIZE,
    maxHireOffers: DEFAULT_MAX_HIRE_OFFERS,
    maxConcurrentMissions: DEFAULT_MAX_CONCURRENT_MISSIONS,
    maxParticipantsPerMission: DEFAULT_MAX_PARTICIPANTS_PER_MISSION,
  };
  const runLocations = locationTemplatesForOmegaPlan(catalog, activeOmegaPlanId);
  const locationRequiredTraits = rollLocationRequiredTraits(catalog, runLocations, rng);
  const locationSecurityTraits = rollLocationSecurityTraits(catalog, runLocations, rng);
  const lairMissionIds = lairTemplate ? [...lairTemplate.availableMissionIds] : [];
  const base: GameState = {
    phase: "main",
    turnNumber: 1,
    organizationName: pickRandomOrganizationName(catalog, rng),
    player,
    activeMissions: [],
    availableMinionTemplateIds: pickRandomMinionTemplateIds(
      catalog,
      Math.min(player.maxHireOffers, catalog.minions.length),
      rng,
      ownedMinionTemplateIds(player),
    ),
    minionRehireQueue: [],
    activityLog: [],
    activeOmegaPlanId,
    locationSecurityStates: initialLocationSecurityStatesForLocations(runLocations),
    locationAssetSlots: initializeLocationAssetPlacements(catalog, rng, runLocations),
    locationRequiredTraits,
    locationSecurityTraits,
    activeLairId,
    lairMissionIds,
    completedLairUpgradeMissionIds: [],
    activeOmegaStageIndex: 0,
    omegaRowProgress: [false, false, false],
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
        availableFromTurn: state.turnNumber + MINION_FIRE_REHIRE_COOLDOWN_TURNS,
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
  const cost = REROLL_HIRE_OFFERS_CP;
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
  const ownedIds = ownedMinionTemplateIds(state.player);
  const availableMinionTemplateIds = pickRandomMinionTemplateIds(
    catalog,
    state.player.maxHireOffers,
    rng,
    ownedIds,
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
  } else {
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
    if (slot.visibility !== target.visibilityAtAssign) {
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

  if (!canAssignParticipants(participants, state.player.maxParticipantsPerMission)) {
    return {
      ok: false,
      error: {
        code: "invalid_participants",
        reason: `Assign 1–${state.player.maxParticipantsPerMission} minions`,
      },
    };
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

  const activeMission: ActiveMission = {
    id: activeMissionId,
    missionTemplateId,
    target,
    missionSource,
    omegaStageIndex: missionSource === "omega" ? omegaStageIndex : null,
    omegaSlotIndex: missionSource === "omega" ? omegaSlotIndex : null,
    participantInstanceIds: [...participantInstanceIds],
    turnsRemaining: missionTemplate.durationTurns,
    startedOnTurn: state.turnNumber,
  };

  const next: GameState = {
    ...state,
    activeMissions: [...state.activeMissions, activeMission],
    player: {
      ...state.player,
      commandPoints: state.player.commandPoints - cost,
    },
  };
  return {
    ok: true,
    value: appendActivityEvent(next, {
      kind: "mission_started",
      missionTemplateId,
      target,
      missionSource,
      omegaStageIndex: missionSource === "omega" ? omegaStageIndex : null,
      omegaSlotIndex: missionSource === "omega" ? omegaSlotIndex : null,
      participantInstanceIds: [...participantInstanceIds],
    }),
  };
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
  const next: GameState = {
    ...state,
    activeMissions: nextMissions,
    player: {
      ...state.player,
      commandPoints: state.player.commandPoints + refundCp,
    },
  };
  return {
    ok: true,
    value: appendActivityEvent(next, {
      kind: "mission_cancelled",
      missionTemplateId: am.missionTemplateId,
      target: am.target,
    }),
  };
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
  if (!missionTemplateById(catalog, missionTemplateId)) {
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
 */
export function executePlan(
  state: GameState,
  catalog: ContentCatalog,
  rng: Rng,
): Result<GameState, GameError> {
  if (state.phase !== "main") {
    return { ok: false, error: { code: "wrong_phase", expected: "main", actual: state.phase } };
  }

  let player = state.player;
  const resolveEvents: ActivityEvent[] = [];
  const remaining: ActiveMission[] = [];
  let locationSecurityStates = state.locationSecurityStates;
  let locationAssetSlots = state.locationAssetSlots;
  let lairMissionIds = [...state.lairMissionIds];
  let completedLairUpgradeMissionIds = [...state.completedLairUpgradeMissionIds];

  const instanceById = new Map(state.player.minions.map((m) => [m.instanceId, m]));

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
    if (!template) {
      continue;
    }

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
    if (missing || !canAssignParticipants(participants, player.maxParticipantsPerMission)) {
      continue;
    }

    const pct = successChancePercent(
      template,
      participants,
      {
        ...missionSuccessOptionsForTarget(state, am.target),
        playerAssets: player.assets,
      },
    );
    const roll = Math.floor(rng() * 100);
    const success = roll < pct;
    const infamyBefore = player.infamy;
    const baselineInfamy = success ? INFAMY_SUCCESS_DELTA : INFAMY_FAILURE_DELTA;
    player = {
      ...player,
      infamy: player.infamy + baselineInfamy,
    };

    const effectList = success
      ? (template.onSuccessEffects ?? [])
      : (template.onFailureEffects ?? []);
    const effectState: GameState = {
      ...state,
      player,
      locationAssetSlots,
      locationSecurityStates,
    };
    const applied = applyMissionEffects(effectState, effectList, am, catalog);
    player = applied.player;
    locationAssetSlots = applied.locationAssetSlots;
    locationSecurityStates = applied.locationSecurityStates;
    /* Sync the lookup with any minion mutations from applyMissionEffects
     * (e.g. add_target_minion_traits) so the XP pass and final merge below see them. */
    for (const m of player.minions) {
      instanceById.set(m.instanceId, m);
    }

    const infamyDeltaTotal = player.infamy - infamyBefore;

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
      templateEffectDescriptions,
    });
    resolveEvents.push(...applied.events);

    if (success) {
      for (const eff of orderedMissionEffects(template.onSuccessEffects ?? [])) {
        if (eff.kind !== "unlock_lair_mission") {
          continue;
        }
        if (
          missionTemplateById(catalog, eff.missionId) &&
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
        awardMissionResolutionExperience(inst, minionTpl);
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

  const ownedIds = ownedMinionTemplateIds(player);
  const availableMinionTemplateIds = pickRandomMinionTemplateIds(
    catalog,
    player.maxHireOffers,
    rng,
    ownedIds,
  );

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
      locationAssetSlots,
      lairMissionIds,
      completedLairUpgradeMissionIds,
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
        commandPoints: state.player.maxCommandPoints,
      },
    },
  };
}
