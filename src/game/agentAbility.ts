/**
 * Agent abilities — what an opposing agent *does* beyond standing in the way.
 *
 * Two kinds, and the split decides when they run:
 *
 * - **Passive** abilities are always in effect. They read as properties of the *site* the agent
 *   is standing on, and they fire inside mission resolution (`gameState.ts`, `missionEffects.ts`)
 *   the moment the condition they watch for happens.
 * - **Active** abilities are spent. Each agent gets one action in the **Agent Phase**
 *   (`agentPhase.ts`), and using an active ability is that action — an agent that acts does not
 *   also move that turn.
 *
 * Hidden agents use both kinds exactly as revealed ones do; only the *reporting* is redacted
 * (see `describeAgentAbilityUse` in `turnReport.ts`).
 */
import type {
  AgentAbilityId,
  AgentInstance,
  LocationAgentPresence,
} from "./types";

export type AgentAbilityKind = "passive" | "active";

export type AgentAbilityDef = {
  id: AgentAbilityId;
  kind: AgentAbilityKind;
  /** Designer-facing name (editor dropdown, docs). */
  name: string;
  /** One line describing what it does, shown in the editor. */
  description: string;
};

/** Every ability, in designer-facing order. Passives first, then actives. */
export const AGENT_ABILITY_DEFS: readonly AgentAbilityDef[] = [
  {
    id: "brawler",
    kind: "passive",
    name: "Brawler",
    description: "Minions failing a mission at this location come away Injured.",
  },
  {
    id: "investigator",
    kind: "passive",
    name: "Investigator",
    description: "Mission failures at this site generate extra heat.",
  },
  {
    id: "guard",
    kind: "passive",
    name: "Guard",
    description: "Security cannot be reduced at this site while this agent is present.",
  },
  {
    id: "security_chief",
    kind: "active",
    name: "Security Chief",
    description: "Raises this location's security level by 1.",
  },
  {
    id: "counterintelligence",
    kind: "active",
    name: "Counterintelligence",
    description: "Reduces this location's intel level by 1.",
  },
  {
    id: "asset_protection",
    kind: "active",
    name: "Asset Protection",
    description: "Hides one revealed asset at this location.",
  },
];

const DEF_BY_ID = new Map(AGENT_ABILITY_DEFS.map((d) => [d.id, d] as const));

export function agentAbilityDef(id: AgentAbilityId): AgentAbilityDef | undefined {
  return DEF_BY_ID.get(id);
}

export function agentAbilityName(id: AgentAbilityId): string {
  return DEF_BY_ID.get(id)?.name ?? id;
}

export function isActiveAgentAbility(id: AgentAbilityId): boolean {
  return DEF_BY_ID.get(id)?.kind === "active";
}

/** The trait a Brawler leaves behind. Matches the `injured` id in `content/traits.json`. */
export const INJURED_TRAIT_ID = "injured";

/** Agents standing at `locationId`, hidden ones included — passives do not care who is watching. */
function agentsAtLocation(
  instances: readonly AgentInstance[],
  presence: readonly LocationAgentPresence[],
  locationId: string,
): AgentInstance[] {
  const row = presence.find((p) => p.locationId === locationId);
  if (row === undefined || row.agentInstanceIds.length === 0) {
    return [];
  }
  const byId = new Map(instances.map((a) => [a.instanceId, a] as const));
  const out: AgentInstance[] = [];
  for (const id of row.agentInstanceIds) {
    const inst = byId.get(id);
    if (inst !== undefined) {
      out.push(inst);
    }
  }
  return out;
}

/**
 * The first agent at `locationId` carrying `abilityId`, or `undefined`. Site-wide passives are
 * reported against **one** agent even when several carry the same ability, so the site effect
 * lands once rather than stacking per agent.
 */
export function agentWithAbilityAtLocation(
  instances: readonly AgentInstance[],
  presence: readonly LocationAgentPresence[],
  locationId: string,
  abilityId: AgentAbilityId,
): AgentInstance | undefined {
  return agentsAtLocation(instances, presence, locationId).find((a) =>
    a.abilityIds.includes(abilityId),
  );
}

/**
 * Site → the `guard` standing on it. Security reductions are refused at every site in this map,
 * and the agent is carried along so a refusal can be reported rather than silently swallowed.
 * One guard per site is enough: a second changes nothing.
 */
export function guardAgentByLocationId(
  instances: readonly AgentInstance[],
  presence: readonly LocationAgentPresence[],
): Map<string, AgentInstance> {
  const out = new Map<string, AgentInstance>();
  const guards = new Map(
    instances
      .filter((a) => a.abilityIds.includes("guard"))
      .map((a) => [a.instanceId, a] as const),
  );
  if (guards.size === 0) {
    return out;
  }
  for (const row of presence) {
    for (const id of row.agentInstanceIds) {
      const guard = guards.get(id);
      if (guard !== undefined) {
        out.set(row.locationId, guard);
        break;
      }
    }
  }
  return out;
}

/**
 * Security after `delta`, clamped to `[0, cap]` — except a **guarded** site, which refuses any
 * reduction outright. A Guard never blocks security *rising*.
 */
export function nextSecurityLevel(
  current: number,
  delta: number,
  cap: number,
  guarded: boolean,
): 0 | 1 | 2 | 3 {
  if (guarded && delta < 0) {
    return current as 0 | 1 | 2 | 3;
  }
  return Math.max(0, Math.min(cap, current + delta)) as 0 | 1 | 2 | 3;
}
