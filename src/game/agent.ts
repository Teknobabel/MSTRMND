import type {
  AgentInstance,
  AgentTemplate,
  ContentCatalog,
  LocationAgentPresence,
} from "./types";
import type { GameState } from "./gameState";
import { createMinionFromTemplate, type CreateMinionOverrides } from "./minion";
import { maxOpposingAgentsForWantedIndex } from "./wantedLevel";

/** Instantiate an agent from a catalog template (same mechanics as {@link createMinionFromTemplate}). */
export function createAgentFromTemplate(
  template: AgentTemplate,
  instanceId: string,
  overrides?: CreateMinionOverrides,
): AgentInstance {
  return createMinionFromTemplate(template, instanceId, overrides);
}

export function getAgentTemplateById(
  catalog: ContentCatalog,
  id: string,
): AgentTemplate | undefined {
  return catalog.agents.find((a) => a.id === id);
}

/** Lookup by {@link AgentInstance.instanceId} from {@link GameState.opposingAgentInstances}. */
export function getOpposingAgentByInstanceId(
  state: GameState,
  instanceId: string,
): AgentInstance | undefined {
  return state.opposingAgentInstances.find((a) => a.instanceId === instanceId);
}

/** Count of opposing agents placed on any playable location (sum of `locationAgentPresence` lists). */
export function totalOpposingAgentsAcrossLocations(state: GameState): number {
  let n = 0;
  for (const row of state.locationAgentPresence) {
    n += row.agentInstanceIds.length;
  }
  return n;
}

/** Agents whose ids are listed under this playable location in {@link GameState.locationAgentPresence}. */
export function getOpposingAgentsAtLocation(
  state: GameState,
  locationId: string,
): AgentInstance[] {
  const row = state.locationAgentPresence.find((p) => p.locationId === locationId);
  if (row === undefined) {
    return [];
  }
  const byId = new Map(
    state.opposingAgentInstances.map((a) => [a.instanceId, a] as const),
  );
  const out: AgentInstance[] = [];
  for (const id of row.agentInstanceIds) {
    const inst = byId.get(id);
    if (inst !== undefined) {
      out.push(inst);
    }
  }
  return out;
}

function countAgentsOnPresence(presence: readonly LocationAgentPresence[]): number {
  let n = 0;
  for (const row of presence) {
    n += row.agentInstanceIds.length;
  }
  return n;
}

/**
 * When the wanted tier index increases at end of resolve, fill opposing agents up to the new
 * tier's {@link maxOpposingAgentsForWantedIndex}. Each spawn uses a random unused agent template
 * and a random playable location. At most one instance per template id at a time.
 */
export function spawnOpposingAgentsAfterWantedEscalation(
  opposingAgentInstances: readonly AgentInstance[],
  locationAgentPresence: readonly LocationAgentPresence[],
  catalog: ContentCatalog,
  playableLocationIds: readonly string[],
  prevTierIndex: number,
  newTierIndex: number,
  rng: () => number,
): { opposingAgentInstances: AgentInstance[]; locationAgentPresence: LocationAgentPresence[] } {
  const instances = [...opposingAgentInstances];
  const presence = locationAgentPresence.map((r) => ({
    locationId: r.locationId,
    agentInstanceIds: [...r.agentInstanceIds],
  }));

  if (newTierIndex <= prevTierIndex || playableLocationIds.length === 0) {
    return { opposingAgentInstances: instances, locationAgentPresence: presence };
  }

  const targetMax = maxOpposingAgentsForWantedIndex(catalog, newTierIndex);
  const usedTemplates = new Set(instances.map((a) => a.templateId));

  while (countAgentsOnPresence(presence) < targetMax) {
    const eligible = catalog.agents.filter((t) => !usedTemplates.has(t.id));
    if (eligible.length === 0) {
      break;
    }
    const tpl = eligible[Math.floor(rng() * eligible.length)]!;
    const locId = playableLocationIds[Math.floor(rng() * playableLocationIds.length)]!;
    const instanceId = globalThis.crypto.randomUUID();
    instances.push(createAgentFromTemplate(tpl, instanceId));
    usedTemplates.add(tpl.id);
    const row = presence.find((p) => p.locationId === locId);
    if (row !== undefined) {
      row.agentInstanceIds.push(instanceId);
    }
  }

  return { opposingAgentInstances: instances, locationAgentPresence: presence };
}
