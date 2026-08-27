/**
 * End-of-turn opposing agent movement.
 *
 * Every agent template names an `AgentMovementBehavior`; after mission resolution each agent on
 * the map gets one move. A behavior does not compute a path — the run's map is an unordered set
 * of sites with no adjacency (`MapTemplate.locationIds`), so there is no "one step closer" to
 * take. Instead a behavior names its **attractors**: the sites it wants to be at. The agent
 * stays put when it is already at one (or when the behavior has nothing to chase this turn) and
 * otherwise relocates to one of them, picked with `rng` when several tie.
 *
 * Behaviors read the *true* world state, never the player-visible view: a hidden Analyst still
 * knows which site the player has the best intel on. Whether a move is **reported** is a
 * separate question, answered in `turnReport.ts` / `main.ts`.
 */
import type {
  AgentInstance,
  AgentMovementBehavior,
  ContentCatalog,
  LocationAgentPresence,
  LocationAssetPlacement,
  LocationAssetSlot,
  LocationIntelState,
  LocationSecurityState,
} from "./types";
import { isOccupiedAssetSlot } from "./types";
import { getOmegaPlanById } from "./omegaPlan";

/** One agent relocating this resolve. Emitted for every move, visible to the player or not. */
export type AgentMove = {
  agentInstanceId: string;
  behavior: AgentMovementBehavior;
  fromLocationId: string;
  toLocationId: string;
};

/** Everything the behaviors read, gathered by `executePlan` after the mission loop. */
export type AgentMovementWorld = {
  catalog: ContentCatalog;
  /** Sites in play this run, in map order; movement never leaves this set. */
  playableLocationIds: readonly string[];
  locationAssetSlots: readonly LocationAssetPlacement[];
  locationSecurityStates: readonly LocationSecurityState[];
  locationIntelStates: readonly LocationIntelState[];
  activeOmegaPlanId: string | null;
  activeOmegaStageIndex: number;
  /** Site of the player's most recent failed mission, or `null` if they have not lost one yet. */
  lastFailedMissionLocationId: string | null;
  /** Minion instance id → the site of the mission it is still working after this resolve. */
  minionMissionLocationIds: ReadonlyMap<string, string>;
  /** Current roster, for a hunter with nobody to follow yet. */
  rosterMinionInstanceIds: readonly string[];
};

/** Asset ids the active Omega phase's missions call for; falls back to the whole plan. */
export function omegaPlanAssetIds(
  catalog: ContentCatalog,
  activeOmegaPlanId: string | null,
  activeOmegaStageIndex: number,
): Set<string> {
  const plan =
    activeOmegaPlanId === null ? undefined : getOmegaPlanById(catalog, activeOmegaPlanId);
  if (plan === undefined) {
    return new Set();
  }
  const collect = (missionIds: readonly string[]): Set<string> => {
    const out = new Set<string>();
    for (const mid of missionIds) {
      const mission = catalog.missions.find((m) => m.id === mid);
      for (const aid of mission?.requiredAssetIds ?? []) {
        out.add(aid);
      }
    }
    return out;
  };
  const stage = plan.stages[activeOmegaStageIndex];
  const current = stage !== undefined ? collect(stage.missionIds) : new Set<string>();
  if (current.size > 0) {
    return current;
  }
  /* A phase that needs no gear would leave the Defender nothing to guard; widen to the whole
   * plan rather than parking it for the rest of the phase. */
  return collect(plan.stages.flatMap((st) => st.missionIds));
}

function slotsAt(
  placements: readonly LocationAssetPlacement[],
  locationId: string,
): readonly LocationAssetSlot[] {
  return placements.find((p) => p.locationId === locationId)?.slots ?? [];
}

function securityAt(states: readonly LocationSecurityState[], locationId: string): number {
  return states.find((s) => s.locationId === locationId)?.securityLevel ?? 0;
}

function intelAt(states: readonly LocationIntelState[], locationId: string): number {
  return states.find((s) => s.locationId === locationId)?.intelLevel ?? 0;
}

/** Sites scoring highest on `score`, or `[]` when nothing scores above `floor`. */
function bestBy(
  locationIds: readonly string[],
  score: (locationId: string) => number,
  floor: number,
): string[] {
  let best = floor;
  let out: string[] = [];
  for (const id of locationIds) {
    const value = score(id);
    if (value > best) {
      best = value;
      out = [id];
    } else if (value === best && out.length > 0) {
      out.push(id);
    }
  }
  return out;
}

/**
 * The sites this agent wants to be at this turn. Empty means "nothing to chase" — the caller
 * leaves the agent where it is rather than wandering it somewhere arbitrary.
 */
export function attractorLocationIds(
  agent: AgentInstance,
  world: AgentMovementWorld,
): string[] {
  const ids = world.playableLocationIds;
  switch (agent.movementBehavior) {
    case "defender": {
      const wanted = omegaPlanAssetIds(
        world.catalog,
        world.activeOmegaPlanId,
        world.activeOmegaStageIndex,
      );
      if (wanted.size === 0) {
        return [];
      }
      return ids.filter((id) =>
        slotsAt(world.locationAssetSlots, id).some(
          (slot) => isOccupiedAssetSlot(slot) && wanted.has(slot.assetId),
        ),
      );
    }
    case "investigator": {
      const where = world.lastFailedMissionLocationId;
      return where !== null && ids.includes(where) ? [where] : [];
    }
    case "hunter": {
      const hunted = agent.huntedMinionInstanceId;
      if (hunted === null) {
        return [];
      }
      const where = world.minionMissionLocationIds.get(hunted);
      /* Between jobs the quarry is off the map, so the hunter holds its position. */
      return where !== undefined && ids.includes(where) ? [where] : [];
    }
    case "analyst":
      /* Floor 0: a run where the player knows nothing gives the Analyst no lead to follow. */
      return bestBy(ids, (id) => intelAt(world.locationIntelStates, id), 0);
    case "asset_protector":
      return ids.filter((id) =>
        slotsAt(world.locationAssetSlots, id).some(
          (slot) => isOccupiedAssetSlot(slot) && slot.visibility === "revealed",
        ),
      );
    case "opportunist":
      /* Negated so `bestBy` returns the minimum; the floor keeps every site eligible. */
      return bestBy(
        ids,
        (id) => -securityAt(world.locationSecurityStates, id),
        Number.NEGATIVE_INFINITY,
      );
    default:
      return [];
  }
}

/** The hunter's quarry: keep the current one while it is on the roster, else lock onto another. */
function nextHuntedMinionInstanceId(
  agent: AgentInstance,
  world: AgentMovementWorld,
  rng: () => number,
): string | null {
  if (agent.movementBehavior !== "hunter") {
    return null;
  }
  const roster = world.rosterMinionInstanceIds;
  if (agent.huntedMinionInstanceId !== null && roster.includes(agent.huntedMinionInstanceId)) {
    return agent.huntedMinionInstanceId;
  }
  if (roster.length === 0) {
    return null;
  }
  return roster[Math.floor(rng() * roster.length)] ?? null;
}

/**
 * Move every agent once, in presence order. Returns new instance rows (hunters may have picked
 * a quarry), new presence rows, and one {@link AgentMove} per agent that actually relocated.
 *
 * Moves land on a **working copy** as they happen, so the presence rows stay consistent through
 * the pass — but attractors are computed from the `world` snapshot taken before it, so no
 * behavior chases another agent's move from the same turn.
 *
 * `skipInstanceIds` holds agents that already spent this turn's action — one that used an
 * active ability does not also move (see `agentPhase.ts`). They still lock onto a quarry, so a
 * hunter that acted this turn is ready to follow the moment it is free again.
 */
export function moveOpposingAgents(
  opposingAgentInstances: readonly AgentInstance[],
  locationAgentPresence: readonly LocationAgentPresence[],
  world: AgentMovementWorld,
  rng: () => number,
  skipInstanceIds: ReadonlySet<string> = new Set(),
): {
  opposingAgentInstances: AgentInstance[];
  locationAgentPresence: LocationAgentPresence[];
  moves: AgentMove[];
} {
  const instances = opposingAgentInstances.map((a) => ({ ...a }));
  const presence = locationAgentPresence.map((r) => ({
    locationId: r.locationId,
    agentInstanceIds: [...r.agentInstanceIds],
  }));
  const moves: AgentMove[] = [];

  const byId = new Map(instances.map((a) => [a.instanceId, a] as const));
  /* Snapshot the pass order first: moving agents below rewrites the rows we would iterate. */
  const order: { agentInstanceId: string; fromLocationId: string }[] = [];
  for (const row of presence) {
    for (const id of row.agentInstanceIds) {
      order.push({ agentInstanceId: id, fromLocationId: row.locationId });
    }
  }

  for (const { agentInstanceId, fromLocationId } of order) {
    const agent = byId.get(agentInstanceId);
    if (agent === undefined) {
      continue;
    }
    agent.huntedMinionInstanceId = nextHuntedMinionInstanceId(agent, world, rng);
    const behavior = agent.movementBehavior;
    if (skipInstanceIds.has(agentInstanceId) || behavior === null) {
      continue;
    }
    const attractors = attractorLocationIds(agent, world);
    if (attractors.length === 0 || attractors.includes(fromLocationId)) {
      continue;
    }
    const toLocationId = attractors[Math.floor(rng() * attractors.length)]!;
    const fromRow = presence.find((r) => r.locationId === fromLocationId);
    const toRow = presence.find((r) => r.locationId === toLocationId);
    if (fromRow === undefined || toRow === undefined) {
      /* No presence row for the destination would strand the agent off the map. */
      continue;
    }
    fromRow.agentInstanceIds = fromRow.agentInstanceIds.filter((id) => id !== agentInstanceId);
    toRow.agentInstanceIds.push(agentInstanceId);
    moves.push({ agentInstanceId, behavior, fromLocationId, toLocationId });
  }

  return { opposingAgentInstances: instances, locationAgentPresence: presence, moves };
}
