/**
 * Site intel: how much of a location the player is allowed to see.
 *
 * Intel is a **view** layered on top of stored state, never a rewrite of it. A slot's
 * `visibility` and an agent's `catalogVisibility` record what was uncovered *through other
 * means* (mission effects, resolving a mission at the site) and are permanent; intel raises
 * what the player sees on top of that and takes it back when intel drops. That is what lets
 * events lower intel and actually cost the player information.
 */
import type {
  AgentInstance,
  ContentCatalog,
  IntelLevel,
  LocationAgentPresence,
  LocationAssetSlot,
  LocationAssetVisibility,
  LocationIntelState,
  LocationType,
} from "./types";
import { isOccupiedAssetSlot } from "./types";
import type { GameState } from "./gameState";

/**
 * Highest intel a site can reach. Structural, not a balance knob: each level unlocks one
 * specific kind of knowledge, so the ceiling cannot move without changing what intel means.
 */
export const MAX_INTEL_LEVEL = 3;

/** Intel needed to see that an asset slot exists (contents still unknown). */
export const INTEL_ASSET_EXISTENCE = 1;
/** Intel needed to identify what every asset slot holds. */
export const INTEL_ASSET_CONTENTS = 2;
/** Intel needed to see opposing agents at the site (including ones that arrive later). */
export const INTEL_AGENTS = 3;

export function clampIntelLevel(value: number): IntelLevel {
  return Math.max(0, Math.min(MAX_INTEL_LEVEL, Math.floor(value))) as IntelLevel;
}

/** Intel at `locationId`; a site with no row (not playable this run) reads as 0. */
export function intelLevelForLocation(
  states: readonly LocationIntelState[],
  locationId: string,
): IntelLevel {
  return states.find((s) => s.locationId === locationId)?.intelLevel ?? 0;
}

/** @see {@link intelLevelForLocation} */
export function intelLevelAtLocation(state: GameState, locationId: string): IntelLevel {
  return intelLevelForLocation(state.locationIntelStates, locationId);
}

/**
 * What the player knows about one asset slot.
 * - `unknown` — occupied, hidden, intel 0: the slot is not shown at all (even its existence is secret).
 * - `empty` — nothing there; always shown (a slot only empties when the player steals from it).
 * - `existence` — the player knows something is stored here but not what.
 * - `identified` — the catalog asset can be named.
 */
export type AssetSlotKnowledge = "unknown" | "empty" | "existence" | "identified";

export function assetSlotKnowledge(
  slot: LocationAssetSlot,
  intelLevel: number,
): AssetSlotKnowledge {
  if (!isOccupiedAssetSlot(slot)) {
    return "empty";
  }
  if (slot.visibility === "revealed" || intelLevel >= INTEL_ASSET_CONTENTS) {
    return "identified";
  }
  if (intelLevel >= INTEL_ASSET_EXISTENCE) {
    return "existence";
  }
  return "unknown";
}

/** Whether the slot appears on the location card at all. */
export function isAssetSlotKnownToPlayer(slot: LocationAssetSlot, intelLevel: number): boolean {
  return assetSlotKnowledge(slot, intelLevel) !== "unknown";
}

/**
 * Visibility an occupied slot has **for the player**: its stored `visibility`, raised to
 * `revealed` while site intel is at least {@link INTEL_ASSET_CONTENTS}. This is the visibility
 * mission targeting uses, so intel 2 makes a site's assets valid `asset_revealed` targets and
 * losing intel makes them hidden again.
 */
export function effectiveAssetSlotVisibility(
  slot: Extract<LocationAssetSlot, { kind: "occupied" }>,
  intelLevel: number,
): LocationAssetVisibility {
  return slot.visibility === "revealed" || intelLevel >= INTEL_ASSET_CONTENTS
    ? "revealed"
    : "hidden";
}

/** Same as {@link effectiveAssetSlotVisibility} but tolerant of empty slots (returns null). */
export function effectiveVisibilityOfSlot(
  slot: LocationAssetSlot | undefined,
  intelLevel: number,
): LocationAssetVisibility | null {
  if (slot === undefined || !isOccupiedAssetSlot(slot)) {
    return null;
  }
  return effectiveAssetSlotVisibility(slot, intelLevel);
}

/**
 * Agents are shown once they have been revealed by play, or while site intel is at
 * {@link INTEL_AGENTS} — which covers agents that arrive at the site later, since this is
 * evaluated at render time rather than stamped on the instance.
 */
export function isOpposingAgentVisibleToPlayer(
  agent: AgentInstance,
  intelLevel: number,
): boolean {
  return agent.catalogVisibility === "revealed" || intelLevel >= INTEL_AGENTS;
}

/** Opposing agents at `locationId` the player is allowed to see, in presence order. */
export function playerVisibleOpposingAgentsAtLocationFromData(
  instances: readonly AgentInstance[],
  presence: readonly LocationAgentPresence[],
  intelStates: readonly LocationIntelState[],
  locationId: string,
): AgentInstance[] {
  const row = presence.find((p) => p.locationId === locationId);
  if (row === undefined || row.agentInstanceIds.length === 0) {
    return [];
  }
  const intelLevel = intelLevelForLocation(intelStates, locationId);
  const byId = new Map(instances.map((a) => [a.instanceId, a] as const));
  const out: AgentInstance[] = [];
  for (const id of row.agentInstanceIds) {
    const inst = byId.get(id);
    if (inst !== undefined && isOpposingAgentVisibleToPlayer(inst, intelLevel)) {
      out.push(inst);
    }
  }
  return out;
}

/** @see {@link playerVisibleOpposingAgentsAtLocationFromData} */
export function playerVisibleOpposingAgentsAtLocation(
  state: GameState,
  locationId: string,
): AgentInstance[] {
  return playerVisibleOpposingAgentsAtLocationFromData(
    state.opposingAgentInstances,
    state.locationAgentPresence,
    state.locationIntelStates,
    locationId,
  );
}

/**
 * Whether the player gets to watch one agent relocate. Revealed agents are always followable;
 * an unrevealed one is only visible while it is standing at a site the player has intel 3 on,
 * so a move counts when **either** end of it is that well lit. Everything else stays off the
 * report — an agent the player has never uncovered must not announce itself by moving.
 */
export function isOpposingAgentMoveVisibleToPlayer(
  state: GameState,
  agentInstanceId: string,
  fromLocationId: string,
  toLocationId: string,
): boolean {
  const agent = state.opposingAgentInstances.find((a) => a.instanceId === agentInstanceId);
  if (agent === undefined) {
    return false;
  }
  return (
    isOpposingAgentVisibleToPlayer(agent, intelLevelForLocation(state.locationIntelStates, fromLocationId)) ||
    isOpposingAgentVisibleToPlayer(agent, intelLevelForLocation(state.locationIntelStates, toLocationId))
  );
}

/** Count for UI success previews — hidden opposition must not move the displayed chance. */
export function countPlayerVisibleOpposingAgentsAtLocation(
  state: GameState,
  locationId: string,
): number {
  return playerVisibleOpposingAgentsAtLocation(state, locationId).length;
}

/** Opposing agents the player can see anywhere on the map (HUD total). */
export function totalPlayerVisibleOpposingAgents(state: GameState): number {
  let n = 0;
  for (const row of state.locationAgentPresence) {
    n += playerVisibleOpposingAgentsAtLocation(state, row.locationId).length;
  }
  return n;
}

function mapIntelLevels(
  states: readonly LocationIntelState[],
  delta: number,
  applies: (locationId: string) => boolean,
): LocationIntelState[] {
  return states.map((s) =>
    applies(s.locationId) ? { ...s, intelLevel: clampIntelLevel(s.intelLevel + delta) } : s,
  );
}

/** Add `delta` to one site's intel (clamped to `[0, MAX_INTEL_LEVEL]`). */
export function applyIntelLevelDelta(
  states: readonly LocationIntelState[],
  locationId: string | null,
  delta: number,
): LocationIntelState[] {
  if (locationId === null) {
    return [...states];
  }
  return mapIntelLevels(states, delta, (id) => id === locationId);
}

/** Add `delta` to every playable site's intel. */
export function applyIntelLevelDeltaGlobal(
  states: readonly LocationIntelState[],
  delta: number,
): LocationIntelState[] {
  return mapIntelLevels(states, delta, () => true);
}

export function applyIntelLevelDeltaByLocationType(
  catalog: ContentCatalog,
  states: readonly LocationIntelState[],
  delta: number,
  locationType: LocationType,
): LocationIntelState[] {
  const typeById = new Map(catalog.locations.map((l) => [l.id, l.locationType] as const));
  return mapIntelLevels(states, delta, (id) => typeById.get(id) === locationType);
}

export function applyIntelLevelDeltaByLocationLevel(
  catalog: ContentCatalog,
  states: readonly LocationIntelState[],
  delta: number,
  locationLevel: 1 | 2 | 3,
): LocationIntelState[] {
  const levelById = new Map(catalog.locations.map((l) => [l.id, l.locationLevel] as const));
  return mapIntelLevels(states, delta, (id) => levelById.get(id) === locationLevel);
}
