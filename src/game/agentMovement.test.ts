import { describe, expect, it } from "vitest";
import {
  attractorLocationIds,
  moveOpposingAgents,
  omegaPlanAssetIds,
  type AgentMovementWorld,
} from "./agentMovement";
import { createAgentFromTemplate, getAgentTemplateById } from "./agent";
import type {
  AgentInstance,
  AgentMovementBehavior,
  ContentCatalog,
  LocationAgentPresence,
} from "./types";
import { fixtureCatalog, seededRng } from "./testFixtures";

const catalog = fixtureCatalog();

function agentWith(
  behavior: AgentMovementBehavior | null,
  overrides?: Partial<AgentInstance>,
): AgentInstance {
  const template = getAgentTemplateById(catalog, "a-spy")!;
  return {
    ...createAgentFromTemplate(template, "ag-1"),
    movementBehavior: behavior,
    ...overrides,
  };
}

function world(overrides?: Partial<AgentMovementWorld>): AgentMovementWorld {
  return {
    catalog,
    playableLocationIds: ["loc-a", "loc-b"],
    locationAssetSlots: [
      { locationId: "loc-a", slots: [] },
      { locationId: "loc-b", slots: [] },
    ],
    locationSecurityStates: [
      { locationId: "loc-a", securityLevel: 0 },
      { locationId: "loc-b", securityLevel: 0 },
    ],
    locationIntelStates: [
      { locationId: "loc-a", intelLevel: 0 },
      { locationId: "loc-b", intelLevel: 0 },
    ],
    activeOmegaPlanId: "op-1",
    activeOmegaStageIndex: 0,
    lastFailedMissionLocationId: null,
    minionMissionLocationIds: new Map(),
    rosterMinionInstanceIds: [],
    ...overrides,
  };
}

/** `op-1`'s stages all run `ms-basic`, which needs no gear; swap in the asset mission. */
function catalogWithAssetOmegaPlan(): ContentCatalog {
  const plan = catalog.omegaPlans.find((p) => p.id === "op-1")!;
  return {
    ...catalog,
    omegaPlans: [
      {
        ...plan,
        stages: [
          { missionIds: ["ms-asset", "ms-basic", "ms-basic"], requiredMissions: 3 },
          { missionIds: ["ms-basic", "ms-basic", "ms-basic"], requiredMissions: 3 },
          { missionIds: ["ms-basic", "ms-basic", "ms-basic"], requiredMissions: 3 },
        ],
      },
    ],
  };
}

describe("omegaPlanAssetIds", () => {
  it("reads the active phase's missions, and widens to the plan when that phase needs no gear", () => {
    const assetCatalog = catalogWithAssetOmegaPlan();
    expect([...omegaPlanAssetIds(assetCatalog, "op-1", 0)].sort()).toEqual(["as-car", "as-gun"]);
    /* Phase 2 runs `ms-basic` only, so the Defender falls back to the whole plan. */
    expect([...omegaPlanAssetIds(assetCatalog, "op-1", 1)].sort()).toEqual(["as-car", "as-gun"]);
  });

  it("is empty when no plan is active", () => {
    expect(omegaPlanAssetIds(catalog, null, 0).size).toBe(0);
  });
});

describe("attractorLocationIds", () => {
  it("defender: sites holding an asset the plan calls for", () => {
    const w = world({
      catalog: catalogWithAssetOmegaPlan(),
      locationAssetSlots: [
        { locationId: "loc-a", slots: [{ kind: "occupied", assetId: "as-cash", visibility: "hidden" }] },
        { locationId: "loc-b", slots: [{ kind: "occupied", assetId: "as-gun", visibility: "hidden" }] },
      ],
    });
    expect(attractorLocationIds(agentWith("defender"), w)).toEqual(["loc-b"]);
  });

  it("defender: nothing to guard when the plan needs no assets", () => {
    expect(attractorLocationIds(agentWith("defender"), world())).toEqual([]);
  });

  it("investigator: the site of the most recent failure, and nowhere without one", () => {
    expect(
      attractorLocationIds(agentWith("investigator"), world({ lastFailedMissionLocationId: "loc-b" })),
    ).toEqual(["loc-b"]);
    expect(attractorLocationIds(agentWith("investigator"), world())).toEqual([]);
  });

  it("hunter: the site of its quarry's active mission, and holds while the quarry is idle", () => {
    const hunting = agentWith("hunter", { huntedMinionInstanceId: "mi-1" });
    expect(
      attractorLocationIds(
        hunting,
        world({ minionMissionLocationIds: new Map([["mi-1", "loc-b"]]) }),
      ),
    ).toEqual(["loc-b"]);
    /* Quarry between jobs — nothing to follow. */
    expect(attractorLocationIds(hunting, world())).toEqual([]);
    /* No quarry locked on yet. */
    expect(
      attractorLocationIds(
        agentWith("hunter"),
        world({ minionMissionLocationIds: new Map([["mi-1", "loc-b"]]) }),
      ),
    ).toEqual([]);
  });

  it("analyst: the best-lit site, and nowhere while the map is dark", () => {
    expect(
      attractorLocationIds(
        agentWith("analyst"),
        world({
          locationIntelStates: [
            { locationId: "loc-a", intelLevel: 1 },
            { locationId: "loc-b", intelLevel: 3 },
          ],
        }),
      ),
    ).toEqual(["loc-b"]);
    expect(attractorLocationIds(agentWith("analyst"), world())).toEqual([]);
  });

  it("asset protector: sites with a revealed slot, ignoring hidden ones", () => {
    const w = world({
      locationAssetSlots: [
        { locationId: "loc-a", slots: [{ kind: "occupied", assetId: "as-car", visibility: "hidden" }] },
        {
          locationId: "loc-b",
          slots: [
            { kind: "empty" },
            { kind: "occupied", assetId: "as-gun", visibility: "revealed" },
          ],
        },
      ],
    });
    expect(attractorLocationIds(agentWith("asset_protector"), w)).toEqual(["loc-b"]);
  });

  it("opportunist: the softest sites, tying when security is level across the map", () => {
    expect(
      attractorLocationIds(
        agentWith("opportunist"),
        world({
          locationSecurityStates: [
            { locationId: "loc-a", securityLevel: 2 },
            { locationId: "loc-b", securityLevel: 1 },
          ],
        }),
      ),
    ).toEqual(["loc-b"]);
    /* All equal ⇒ every site is a candidate, so an agent already parked stays put. */
    expect(attractorLocationIds(agentWith("opportunist"), world())).toEqual(["loc-a", "loc-b"]);
  });

  it("an agent with no authored behavior chases nothing", () => {
    expect(attractorLocationIds(agentWith(null), world())).toEqual([]);
  });
});

describe("moveOpposingAgents", () => {
  function presenceWithAgentAt(locationId: string): LocationAgentPresence[] {
    return [
      { locationId: "loc-a", agentInstanceIds: locationId === "loc-a" ? ["ag-1"] : [] },
      { locationId: "loc-b", agentInstanceIds: locationId === "loc-b" ? ["ag-1"] : [] },
    ];
  }

  it("relocates an agent to its attractor and reports the move", () => {
    const agent = agentWith("investigator");
    const result = moveOpposingAgents(
      [agent],
      presenceWithAgentAt("loc-a"),
      world({ lastFailedMissionLocationId: "loc-b" }),
      seededRng(1),
    );
    expect(result.moves).toEqual([
      {
        agentInstanceId: "ag-1",
        behavior: "investigator",
        fromLocationId: "loc-a",
        toLocationId: "loc-b",
      },
    ]);
    expect(result.locationAgentPresence).toEqual([
      { locationId: "loc-a", agentInstanceIds: [] },
      { locationId: "loc-b", agentInstanceIds: ["ag-1"] },
    ]);
  });

  it("stays put when it is already standing on an attractor", () => {
    const result = moveOpposingAgents(
      [agentWith("investigator")],
      presenceWithAgentAt("loc-b"),
      world({ lastFailedMissionLocationId: "loc-b" }),
      seededRng(1),
    );
    expect(result.moves).toEqual([]);
    expect(result.locationAgentPresence).toEqual(presenceWithAgentAt("loc-b"));
  });

  it("stays put when the behavior has nothing to chase", () => {
    const result = moveOpposingAgents(
      [agentWith("investigator")],
      presenceWithAgentAt("loc-a"),
      world(),
      seededRng(1),
    );
    expect(result.moves).toEqual([]);
  });

  it("locks a hunter onto a minion and keeps that quarry on later passes", () => {
    const first = moveOpposingAgents(
      [agentWith("hunter")],
      presenceWithAgentAt("loc-a"),
      world({
        rosterMinionInstanceIds: ["mi-1"],
        minionMissionLocationIds: new Map([["mi-1", "loc-b"]]),
      }),
      seededRng(1),
    );
    expect(first.opposingAgentInstances[0]!.huntedMinionInstanceId).toBe("mi-1");
    expect(first.moves.map((m) => m.toLocationId)).toEqual(["loc-b"]);

    /* A second minion joins; the hunter is already committed and does not switch. */
    const second = moveOpposingAgents(
      first.opposingAgentInstances,
      first.locationAgentPresence,
      world({
        rosterMinionInstanceIds: ["mi-1", "mi-2"],
        minionMissionLocationIds: new Map([["mi-1", "loc-a"]]),
      }),
      seededRng(9),
    );
    expect(second.opposingAgentInstances[0]!.huntedMinionInstanceId).toBe("mi-1");
    expect(second.moves.map((m) => m.toLocationId)).toEqual(["loc-a"]);
  });

  it("drops a quarry that left the roster and locks onto someone still on it", () => {
    const result = moveOpposingAgents(
      [agentWith("hunter", { huntedMinionInstanceId: "mi-gone" })],
      presenceWithAgentAt("loc-a"),
      world({
        rosterMinionInstanceIds: ["mi-2"],
        minionMissionLocationIds: new Map([["mi-2", "loc-b"]]),
      }),
      seededRng(1),
    );
    expect(result.opposingAgentInstances[0]!.huntedMinionInstanceId).toBe("mi-2");
    expect(result.moves.map((m) => m.toLocationId)).toEqual(["loc-b"]);
  });

  it("clears the quarry when the roster is empty", () => {
    const result = moveOpposingAgents(
      [agentWith("hunter", { huntedMinionInstanceId: "mi-gone" })],
      presenceWithAgentAt("loc-a"),
      world(),
      seededRng(1),
    );
    expect(result.opposingAgentInstances[0]!.huntedMinionInstanceId).toBeNull();
    expect(result.moves).toEqual([]);
  });

  it("leaves the caller's rows untouched", () => {
    const presence = presenceWithAgentAt("loc-a");
    const agents = [agentWith("investigator")];
    moveOpposingAgents(agents, presence, world({ lastFailedMissionLocationId: "loc-b" }), seededRng(1));
    expect(presence).toEqual(presenceWithAgentAt("loc-a"));
    expect(agents[0]!.huntedMinionInstanceId).toBeNull();
  });
});
