import { describe, expect, it } from "vitest";
import { runAgentPhase } from "./agentPhase";
import type { AgentMovementWorld } from "./agentMovement";
import { createAgentFromTemplate, getAgentTemplateById } from "./agent";
import { guardAgentByLocationId, nextSecurityLevel } from "./agentAbility";
import type {
  AgentAbilityId,
  AgentInstance,
  AgentMovementBehavior,
  LocationAgentPresence,
  LocationAssetPlacement,
  LocationIntelState,
  LocationSecurityState,
} from "./types";
import { fixtureCatalog, seededRng } from "./testFixtures";

const catalog = fixtureCatalog();

/** loc-a is `locationLevel` 2 (security cap 2), loc-b is level 1 (cap 1). */
function agent(
  abilityIds: AgentAbilityId[],
  overrides?: Partial<AgentInstance>,
): AgentInstance {
  const template = getAgentTemplateById(catalog, "a-spy")!;
  return {
    ...createAgentFromTemplate(template, "opp-1"),
    movementBehavior: null as AgentMovementBehavior | null,
    abilityIds,
    ...overrides,
  };
}

function presenceAt(locationId: string, ids = ["opp-1"]): LocationAgentPresence[] {
  return [
    { locationId: "loc-a", agentInstanceIds: locationId === "loc-a" ? ids : [] },
    { locationId: "loc-b", agentInstanceIds: locationId === "loc-b" ? ids : [] },
  ];
}

const security: LocationSecurityState[] = [
  { locationId: "loc-a", securityLevel: 0 },
  { locationId: "loc-b", securityLevel: 0 },
];
const intel: LocationIntelState[] = [
  { locationId: "loc-a", intelLevel: 2 },
  { locationId: "loc-b", intelLevel: 0 },
];
const assets: LocationAssetPlacement[] = [
  {
    locationId: "loc-a",
    slots: [
      { kind: "occupied", assetId: "as-car", visibility: "hidden" },
      { kind: "occupied", assetId: "as-gun", visibility: "revealed" },
    ],
  },
  { locationId: "loc-b", slots: [] },
];

function world(overrides?: Partial<AgentMovementWorld>): AgentMovementWorld {
  return {
    catalog,
    playableLocationIds: ["loc-a", "loc-b"],
    locationAssetSlots: assets,
    locationSecurityStates: security,
    locationIntelStates: intel,
    activeOmegaPlanId: "op-1",
    activeOmegaStageIndex: 0,
    lastFailedMissionLocationId: null,
    minionMissionLocationIds: new Map(),
    rosterMinionInstanceIds: [],
    ...overrides,
  };
}

function run(
  a: AgentInstance,
  locationId = "loc-a",
  overrides?: Partial<AgentMovementWorld>,
  turnNumber = 5,
) {
  return runAgentPhase(
    [a],
    presenceAt(locationId),
    security,
    intel,
    assets,
    world(overrides),
    turnNumber,
    seededRng(1),
  );
}

function levelAt(states: readonly LocationSecurityState[], id: string): number {
  return states.find((s) => s.locationId === id)!.securityLevel;
}

describe("active abilities", () => {
  it("Security Chief raises security by 1 where the agent stands", () => {
    const result = run(agent(["security_chief"]));
    expect(levelAt(result.locationSecurityStates, "loc-a")).toBe(1);
    expect(levelAt(result.locationSecurityStates, "loc-b")).toBe(0);
    expect(result.uses).toEqual([
      {
        agentInstanceId: "opp-1",
        agentTemplateId: "a-spy",
        abilityId: "security_chief",
        locationId: "loc-a",
      },
    ]);
  });

  it("Counterintelligence drops intel by 1", () => {
    const result = run(agent(["counterintelligence"]));
    expect(result.locationIntelStates.find((s) => s.locationId === "loc-a")!.intelLevel).toBe(1);
    expect(result.uses.map((u) => u.abilityId)).toEqual(["counterintelligence"]);
  });

  it("Asset Protection hides a revealed asset and names it, leaving hidden ones alone", () => {
    const result = run(agent(["asset_protection"]));
    const slots = result.locationAssetSlots.find((p) => p.locationId === "loc-a")!.slots;
    expect(slots).toEqual([
      { kind: "occupied", assetId: "as-car", visibility: "hidden" },
      { kind: "occupied", assetId: "as-gun", visibility: "hidden" },
    ]);
    expect(result.uses[0]!.assetId).toBe("as-gun");
  });

  it("falls through to moving when the ability would change nothing", () => {
    /* loc-b is dark already, so Counterintelligence has nothing to burn. The agent moves on
     * its behavior instead of wasting the turn. */
    const mover = agent(["counterintelligence"], { movementBehavior: "analyst" });
    const result = run(mover, "loc-b");
    expect(result.uses).toEqual([]);
    /* loc-a is the best-lit site, so the Analyst heads there. */
    expect(result.moves.map((m) => m.toLocationId)).toEqual(["loc-a"]);
  });

  it("acting costs the agent its move", () => {
    const both = agent(["security_chief"], { movementBehavior: "analyst" });
    /* Standing at loc-b, the Analyst would move to loc-a — but the ability fires first. */
    const result = run(both, "loc-b");
    expect(result.uses.map((u) => u.abilityId)).toEqual(["security_chief"]);
    expect(result.moves).toEqual([]);
    expect(levelAt(result.locationSecurityStates, "loc-b")).toBe(1);
  });

  it("fires the first usable active in authored order", () => {
    /* loc-b is at security cap 1 after nothing and intel 0 — only Asset Protection... which
     * also has nothing. At loc-a both work, so the earlier one wins. */
    const result = run(agent(["counterintelligence", "security_chief"]));
    expect(result.uses.map((u) => u.abilityId)).toEqual(["counterintelligence"]);
    expect(levelAt(result.locationSecurityStates, "loc-a")).toBe(0);
  });

  it("skips an active that is capped out and takes the next one", () => {
    const capped = runAgentPhase(
      [agent(["security_chief", "counterintelligence"])],
      presenceAt("loc-b"),
      [
        { locationId: "loc-a", securityLevel: 0 },
        /* loc-b is `locationLevel` 1, so security 1 is its ceiling. */
        { locationId: "loc-b", securityLevel: 1 },
      ],
      [
        { locationId: "loc-a", intelLevel: 0 },
        { locationId: "loc-b", intelLevel: 3 },
      ],
      assets,
      world(),
      5,
      seededRng(1),
    );
    expect(capped.uses.map((u) => u.abilityId)).toEqual(["counterintelligence"]);
  });

  it("passive abilities never spend the agent's action", () => {
    const guardMover = agent(["guard", "brawler"], { movementBehavior: "analyst" });
    const result = run(guardMover, "loc-b");
    expect(result.uses).toEqual([]);
    expect(result.moves.map((m) => m.toLocationId)).toEqual(["loc-a"]);
  });

  it("an agent that arrived this turn sits the phase out entirely", () => {
    const fresh = agent(["security_chief"], { movementBehavior: "analyst", deployedOnTurn: 5 });
    const result = run(fresh, "loc-b", undefined, 5);
    expect(result.uses).toEqual([]);
    expect(result.moves).toEqual([]);
    expect(levelAt(result.locationSecurityStates, "loc-b")).toBe(0);
  });

  it("leaves the caller's rows untouched", () => {
    const before = JSON.stringify({ security, intel, assets });
    run(agent(["security_chief", "asset_protection"]));
    expect(JSON.stringify({ security, intel, assets })).toBe(before);
  });
});

describe("guard passive", () => {
  it("maps each guarded site to the agent holding it", () => {
    const guards = guardAgentByLocationId([agent(["guard"])], presenceAt("loc-b"));
    expect([...guards.keys()]).toEqual(["loc-b"]);
    expect(guards.get("loc-b")!.instanceId).toBe("opp-1");
    expect(guardAgentByLocationId([agent(["brawler"])], presenceAt("loc-b")).size).toBe(0);
  });

  it("refuses reductions but never blocks security rising", () => {
    expect(nextSecurityLevel(2, -1, 3, true)).toBe(2);
    expect(nextSecurityLevel(2, -1, 3, false)).toBe(1);
    expect(nextSecurityLevel(2, 1, 3, true)).toBe(3);
    /* The clamp still applies on an unguarded site. */
    expect(nextSecurityLevel(0, -5, 3, false)).toBe(0);
    expect(nextSecurityLevel(3, 5, 3, false)).toBe(3);
  });
});
