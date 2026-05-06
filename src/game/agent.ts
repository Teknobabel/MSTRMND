import type { AgentInstance, AgentTemplate, ContentCatalog } from "./types";
import type { GameState } from "./gameState";
import { createMinionFromTemplate, type CreateMinionOverrides } from "./minion";

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
