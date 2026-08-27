/**
 * The Agent Phase — the opposition's turn, run once after mission resolution finishes.
 *
 * Every agent on the map gets exactly **one** action: use an active ability, or move. Trying an
 * ability comes first, and only an ability that would actually change something counts as
 * spending the action — an agent whose Security Chief has nothing left to raise falls through
 * and moves instead, rather than standing around wasting the turn. When an agent carries
 * several usable actives, authored order in `abilityIds` decides which fires.
 *
 * Agents deployed by this same turn's wanted escalation sit the phase out (`deployedOnTurn`):
 * they act from the following turn, so a spawn's random placement means something.
 *
 * Hidden agents act exactly like revealed ones. Only the *report* is redacted, in
 * `turnReport.ts` / `main.ts`.
 */
import type {
  AgentAbilityId,
  AgentInstance,
  ContentCatalog,
  LocationAgentPresence,
  LocationAssetPlacement,
  LocationIntelState,
  LocationSecurityState,
} from "./types";
import { isOccupiedAssetSlot } from "./types";
import { isActiveAgentAbility } from "./agentAbility";
import { moveOpposingAgents, type AgentMove, type AgentMovementWorld } from "./agentMovement";
import { maxSecurityLevelForLocation } from "./locationCatalog";
import { clampIntelLevel } from "./intel";

/** One active ability firing this phase. */
export type AgentAbilityUse = {
  agentInstanceId: string;
  agentTemplateId: string;
  abilityId: AgentAbilityId;
  locationId: string;
  /** `asset_protection` only: the asset it pulled back into the dark. */
  assetId?: string;
};

export type AgentPhaseResult = {
  opposingAgentInstances: AgentInstance[];
  locationAgentPresence: LocationAgentPresence[];
  locationSecurityStates: LocationSecurityState[];
  locationIntelStates: LocationIntelState[];
  locationAssetSlots: LocationAssetPlacement[];
  uses: AgentAbilityUse[];
  moves: AgentMove[];
};

/** Mutable working copies the active abilities write through. */
type AbilityTargets = {
  catalog: ContentCatalog;
  locationSecurityStates: LocationSecurityState[];
  locationIntelStates: LocationIntelState[];
  locationAssetSlots: LocationAssetPlacement[];
};

/** Raise security by 1, unless this site is already at its `locationLevel` cap. */
function useSecurityChief(targets: AbilityTargets, locationId: string): boolean {
  const cap = maxSecurityLevelForLocation(targets.catalog, locationId);
  const i = targets.locationSecurityStates.findIndex((s) => s.locationId === locationId);
  if (i < 0) {
    return false;
  }
  const current = targets.locationSecurityStates[i]!;
  if (current.securityLevel >= cap) {
    return false;
  }
  targets.locationSecurityStates[i] = {
    ...current,
    securityLevel: (current.securityLevel + 1) as 0 | 1 | 2 | 3,
  };
  return true;
}

/** Drop intel by 1, unless the site is already dark. */
function useCounterintelligence(targets: AbilityTargets, locationId: string): boolean {
  const i = targets.locationIntelStates.findIndex((s) => s.locationId === locationId);
  if (i < 0) {
    return false;
  }
  const current = targets.locationIntelStates[i]!;
  if (current.intelLevel <= 0) {
    return false;
  }
  targets.locationIntelStates[i] = {
    ...current,
    intelLevel: clampIntelLevel(current.intelLevel - 1),
  };
  return true;
}

/** Hide the first revealed asset at this site; nothing in the open means nothing to do. */
function useAssetProtection(
  targets: AbilityTargets,
  locationId: string,
): { assetId: string } | null {
  const p = targets.locationAssetSlots.findIndex((row) => row.locationId === locationId);
  if (p < 0) {
    return null;
  }
  const placement = targets.locationAssetSlots[p]!;
  const slotIndex = placement.slots.findIndex(
    (slot) => isOccupiedAssetSlot(slot) && slot.visibility === "revealed",
  );
  if (slotIndex < 0) {
    return null;
  }
  const slot = placement.slots[slotIndex]!;
  if (!isOccupiedAssetSlot(slot)) {
    return null;
  }
  const slots = [...placement.slots];
  slots[slotIndex] = { ...slot, visibility: "hidden" };
  targets.locationAssetSlots[p] = { ...placement, slots };
  return { assetId: slot.assetId };
}

/** Fire this agent's first usable active ability, or `null` when none of them would do anything. */
function tryUseActiveAbility(
  agent: AgentInstance,
  locationId: string,
  targets: AbilityTargets,
): AgentAbilityUse | null {
  for (const abilityId of agent.abilityIds) {
    if (!isActiveAgentAbility(abilityId)) {
      continue;
    }
    const base = {
      agentInstanceId: agent.instanceId,
      agentTemplateId: agent.templateId,
      abilityId,
      locationId,
    };
    if (abilityId === "security_chief" && useSecurityChief(targets, locationId)) {
      return base;
    }
    if (abilityId === "counterintelligence" && useCounterintelligence(targets, locationId)) {
      return base;
    }
    if (abilityId === "asset_protection") {
      const hidden = useAssetProtection(targets, locationId);
      if (hidden !== null) {
        return { ...base, assetId: hidden.assetId };
      }
    }
  }
  return null;
}

/**
 * Run the whole phase: abilities first (in presence order), then movement for every agent that
 * did not spend its action on one. Every input is left untouched; the caller merges the result.
 */
export function runAgentPhase(
  opposingAgentInstances: readonly AgentInstance[],
  locationAgentPresence: readonly LocationAgentPresence[],
  locationSecurityStates: readonly LocationSecurityState[],
  locationIntelStates: readonly LocationIntelState[],
  locationAssetSlots: readonly LocationAssetPlacement[],
  world: AgentMovementWorld,
  turnNumber: number,
  rng: () => number,
): AgentPhaseResult {
  const targets: AbilityTargets = {
    catalog: world.catalog,
    locationSecurityStates: locationSecurityStates.map((s) => ({ ...s })),
    locationIntelStates: locationIntelStates.map((s) => ({ ...s })),
    locationAssetSlots: locationAssetSlots.map((p) => ({
      locationId: p.locationId,
      slots: [...p.slots],
    })),
  };

  const byId = new Map(opposingAgentInstances.map((a) => [a.instanceId, a] as const));
  const uses: AgentAbilityUse[] = [];
  /* Agents that spent their action on an ability, plus this turn's arrivals — neither moves. */
  const skipMovement = new Set<string>();

  for (const row of locationAgentPresence) {
    for (const instanceId of row.agentInstanceIds) {
      const agent = byId.get(instanceId);
      if (agent === undefined) {
        continue;
      }
      if (agent.deployedOnTurn === turnNumber) {
        skipMovement.add(instanceId);
        continue;
      }
      const use = tryUseActiveAbility(agent, row.locationId, targets);
      if (use !== null) {
        uses.push(use);
        skipMovement.add(instanceId);
      }
    }
  }

  const moved = moveOpposingAgents(
    opposingAgentInstances,
    locationAgentPresence,
    {
      ...world,
      /* Abilities have already fired, so movement reads the world they left behind. */
      locationSecurityStates: targets.locationSecurityStates,
      locationIntelStates: targets.locationIntelStates,
      locationAssetSlots: targets.locationAssetSlots,
    },
    rng,
    skipMovement,
  );

  return {
    opposingAgentInstances: moved.opposingAgentInstances,
    locationAgentPresence: moved.locationAgentPresence,
    locationSecurityStates: targets.locationSecurityStates,
    locationIntelStates: targets.locationIntelStates,
    locationAssetSlots: targets.locationAssetSlots,
    uses,
    moves: moved.moves,
  };
}
