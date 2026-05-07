import type {
  AgentCatalogVisibility,
  AgentInstance,
  AgentTemplate,
  ContentCatalog,
  LocationAgentPresence,
} from "./types";
import type { GameState } from "./gameState";
import { createMinionFromTemplate, type CreateMinionOverrides } from "./minion";
import { maxOpposingAgentsForWantedIndex } from "./wantedLevel";

export type CreateAgentOverrides = CreateMinionOverrides & {
  catalogVisibility?: AgentCatalogVisibility;
};

/** Instantiate an agent from a catalog template (same mechanics as {@link createMinionFromTemplate}). */
export function createAgentFromTemplate(
  template: AgentTemplate,
  instanceId: string,
  overrides?: CreateAgentOverrides,
): AgentInstance {
  const { catalogVisibility, ...minionOverrides } = overrides ?? {};
  const base = createMinionFromTemplate(template, instanceId, minionOverrides);
  return {
    ...base,
    catalogVisibility: catalogVisibility ?? "hidden",
  };
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

/** Opposing agents at this location with {@link AgentInstance.catalogVisibility} `revealed` (for location UI). */
export function getRevealedOpposingAgentsAtLocation(
  state: GameState,
  locationId: string,
): AgentInstance[] {
  return getOpposingAgentsAtLocation(state, locationId).filter((a) => a.catalogVisibility === "revealed");
}

/**
 * Count opposing agents at `locationId` using current instance rows and presence lists.
 * `all` counts every agent listed for the site; `revealed` counts only `catalogVisibility === "revealed"`.
 */
export function countOpposingAgentsAtLocationFromData(
  instances: readonly AgentInstance[],
  presence: readonly LocationAgentPresence[],
  locationId: string,
  mode: "all" | "revealed",
): number {
  const row = presence.find((p) => p.locationId === locationId);
  if (row === undefined || row.agentInstanceIds.length === 0) {
    return 0;
  }
  const byId = new Map(instances.map((a) => [a.instanceId, a] as const));
  let n = 0;
  for (const id of row.agentInstanceIds) {
    const inst = byId.get(id);
    if (inst === undefined) {
      continue;
    }
    if (mode === "all" || inst.catalogVisibility === "revealed") {
      n += 1;
    }
  }
  return n;
}

/** @see {@link countOpposingAgentsAtLocationFromData} */
export function countOpposingAgentsAtLocation(
  state: GameState,
  locationId: string,
  mode: "all" | "revealed",
): number {
  return countOpposingAgentsAtLocationFromData(
    state.opposingAgentInstances,
    state.locationAgentPresence,
    locationId,
    mode,
  );
}

/** Set `catalogVisibility` to `revealed` for every opposing agent listed at `locationId`. */
export function revealAllOpposingAgentsAtLocation(
  instances: readonly AgentInstance[],
  locationId: string,
  presence: readonly LocationAgentPresence[],
): AgentInstance[] {
  const row = presence.find((p) => p.locationId === locationId);
  const atSite = new Set(row?.agentInstanceIds ?? []);
  return instances.map((a) =>
    atSite.has(a.instanceId) ? { ...a, catalogVisibility: "revealed" as const } : a,
  );
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
