import { describe, expect, it } from "vitest";
import type { ActiveMission, GameState } from "./gameState";
import { assignMission, createInitialGameState, setLocationIntelLevel } from "./gameState";
import { applyMissionEffects } from "./missionEffects";
import {
  assetSlotKnowledge,
  countPlayerVisibleOpposingAgentsAtLocation,
  effectiveAssetSlotVisibility,
  intelLevelAtLocation,
  isOpposingAgentVisibleToPlayer,
  playerVisibleOpposingAgentsAtLocation,
  totalPlayerVisibleOpposingAgents,
} from "./intel";
import { createAgentFromTemplate, getAgentTemplateById } from "./agent";
import type { AgentInstance, LocationAssetSlot } from "./types";
import { fixtureCatalog, makeMinionInstance, seededRng } from "./testFixtures";

const catalog = fixtureCatalog();

const hiddenSlot: LocationAssetSlot = {
  kind: "occupied",
  assetId: "as-car",
  visibility: "hidden",
};
const revealedSlot: LocationAssetSlot = {
  kind: "occupied",
  assetId: "as-gun",
  visibility: "revealed",
};

function stubMission(overrides?: Partial<ActiveMission>): ActiveMission {
  return {
    id: "am-1",
    missionTemplateId: "ms-basic",
    target: { kind: "location", locationId: "loc-a" },
    missionSource: "lair",
    omegaStageIndex: null,
    omegaSlotIndex: null,
    participantInstanceIds: [],
    plannedAssetIds: [],
    supportAssetIds: [],
    turnsRemaining: 0,
    startedOnTurn: 1,
    ...overrides,
  };
}

/**
 * A run with every site dark. Runs normally open with a few seeded intel sites
 * (`rollInitialLocationIntelStates`), which would otherwise make these assertions depend on
 * the seed; the seeding itself is covered in `balance.test.ts`.
 */
function darkState(seed = 1): GameState {
  const state = createInitialGameState(catalog, seededRng(seed));
  return {
    ...state,
    locationIntelStates: state.locationIntelStates.map((s) => ({ ...s, intelLevel: 0 })),
  };
}

/** Run with one known asset layout at loc-a so slot indices are stable. */
function stateWithSlotsAtLocA(slots: LocationAssetSlot[]): GameState {
  const state = darkState();
  return {
    ...state,
    locationAssetSlots: state.locationAssetSlots.map((p) =>
      p.locationId === "loc-a" ? { ...p, slots } : p,
    ),
  };
}

function withAgentAtLocA(state: GameState, instanceId: string): GameState {
  const template = getAgentTemplateById(catalog, "a-spy")!;
  const agent: AgentInstance = createAgentFromTemplate(template, instanceId);
  return {
    ...state,
    opposingAgentInstances: [...state.opposingAgentInstances, agent],
    locationAgentPresence: state.locationAgentPresence.map((row) =>
      row.locationId === "loc-a"
        ? { ...row, agentInstanceIds: [...row.agentInstanceIds, instanceId] }
        : row,
    ),
  };
}

describe("initial intel", () => {
  it("gives one row per playable site, none above intel 2", () => {
    const state = createInitialGameState(catalog, seededRng(3));
    expect(state.locationIntelStates.map((s) => s.locationId).sort()).toEqual([
      "loc-a",
      "loc-b",
    ]);
    expect(state.locationIntelStates.every((s) => s.intelLevel <= 2)).toBe(true);
  });

  it("leaves every asset slot hidden — opening visibility comes from intel alone", () => {
    const state = createInitialGameState(catalog, seededRng(3));
    const slots = state.locationAssetSlots.flatMap((p) => p.slots);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s.kind === "occupied" && s.visibility === "hidden")).toBe(true);
  });
});

describe("assetSlotKnowledge", () => {
  it("hides an unrevealed slot entirely at intel 0", () => {
    expect(assetSlotKnowledge(hiddenSlot, 0)).toBe("unknown");
  });

  it("shows existence but not contents at intel 1", () => {
    expect(assetSlotKnowledge(hiddenSlot, 1)).toBe("existence");
  });

  it("identifies contents at intel 2", () => {
    expect(assetSlotKnowledge(hiddenSlot, 2)).toBe("identified");
  });

  it("keeps slots revealed through other means visible at intel 0", () => {
    expect(assetSlotKnowledge(revealedSlot, 0)).toBe("identified");
  });

  it("always shows emptied slots", () => {
    expect(assetSlotKnowledge({ kind: "empty" }, 0)).toBe("empty");
  });
});

describe("effectiveAssetSlotVisibility", () => {
  it("reads hidden below intel 2 and revealed at or above it", () => {
    expect(effectiveAssetSlotVisibility(hiddenSlot, 1)).toBe("hidden");
    expect(effectiveAssetSlotVisibility(hiddenSlot, 2)).toBe("revealed");
  });

  it("never downgrades a slot revealed through other means", () => {
    expect(effectiveAssetSlotVisibility(revealedSlot, 0)).toBe("revealed");
  });

  it("re-hides intel-granted knowledge when intel falls back", () => {
    expect(effectiveAssetSlotVisibility(hiddenSlot, 2)).toBe("revealed");
    expect(effectiveAssetSlotVisibility(hiddenSlot, 0)).toBe("hidden");
  });
});

describe("opposing agent visibility", () => {
  it("shows hidden agents only at intel 3", () => {
    const agent = createAgentFromTemplate(getAgentTemplateById(catalog, "a-spy")!, "ag-1");
    expect(isOpposingAgentVisibleToPlayer(agent, 2)).toBe(false);
    expect(isOpposingAgentVisibleToPlayer(agent, 3)).toBe(true);
  });

  it("shows agents revealed by play at any intel", () => {
    const agent = createAgentFromTemplate(getAgentTemplateById(catalog, "a-spy")!, "ag-1", {
      catalogVisibility: "revealed",
    });
    expect(isOpposingAgentVisibleToPlayer(agent, 0)).toBe(true);
  });

  it("auto-shows an agent that arrives after intel is already 3", () => {
    let state = setLocationIntelLevel(createInitialGameState(catalog, seededRng(1)), "loc-a", 3);
    expect(countPlayerVisibleOpposingAgentsAtLocation(state, "loc-a")).toBe(0);
    state = withAgentAtLocA(state, "ag-late");
    expect(playerVisibleOpposingAgentsAtLocation(state, "loc-a").map((a) => a.instanceId)).toEqual([
      "ag-late",
    ]);
  });

  it("keeps hidden agents out of the map-wide total", () => {
    let state = withAgentAtLocA(darkState(), "ag-1");
    expect(totalPlayerVisibleOpposingAgents(state)).toBe(0);
    state = setLocationIntelLevel(state, "loc-a", 3);
    expect(totalPlayerVisibleOpposingAgents(state)).toBe(1);
  });
});

describe("intel mission effects", () => {
  it("raises intel at the mission's target site and clamps at 3", () => {
    const state = darkState();
    const applied = applyMissionEffects(
      state,
      [{ kind: "intel_level_delta", delta: 10 }],
      stubMission(),
      catalog,
      seededRng(2),
    );
    expect(applied.locationIntelStates.find((s) => s.locationId === "loc-a")?.intelLevel).toBe(3);
    expect(applied.locationIntelStates.find((s) => s.locationId === "loc-b")?.intelLevel).toBe(0);
  });

  it("floors a reduction at 0", () => {
    const state = setLocationIntelLevel(createInitialGameState(catalog, seededRng(1)), "loc-a", 1);
    const applied = applyMissionEffects(
      state,
      [{ kind: "intel_level_delta", delta: -3 }],
      stubMission(),
      catalog,
      seededRng(2),
    );
    expect(applied.locationIntelStates.find((s) => s.locationId === "loc-a")?.intelLevel).toBe(0);
  });

  it("leaves intel alone for a target with no site", () => {
    const state = setLocationIntelLevel(createInitialGameState(catalog, seededRng(1)), "loc-a", 2);
    const applied = applyMissionEffects(
      state,
      [{ kind: "intel_level_delta", delta: 1 }],
      stubMission({ target: { kind: "none" } }),
      catalog,
      seededRng(2),
    );
    expect(applied.locationIntelStates.find((s) => s.locationId === "loc-a")?.intelLevel).toBe(2);
  });

  it("applies the global variant to every playable site", () => {
    const state = darkState();
    const applied = applyMissionEffects(
      state,
      [{ kind: "intel_level_delta_global", delta: 2 }],
      stubMission({ target: { kind: "none" } }),
      catalog,
      seededRng(2),
    );
    expect(applied.locationIntelStates.every((s) => s.intelLevel === 2)).toBe(true);
  });

  it("scopes the by-type variant to matching sites", () => {
    const state = darkState();
    const applied = applyMissionEffects(
      state,
      [{ kind: "intel_level_delta_by_location_type", delta: 1, locationType: "economic" }],
      stubMission({ target: { kind: "none" } }),
      catalog,
      seededRng(2),
    );
    /* loc-a is economic, loc-b is military. */
    expect(applied.locationIntelStates.find((s) => s.locationId === "loc-a")?.intelLevel).toBe(1);
    expect(applied.locationIntelStates.find((s) => s.locationId === "loc-b")?.intelLevel).toBe(0);
  });

  it("lets intel 2 put stored-hidden assets in reach of steal_all_revealed_assets_at_location", () => {
    const base = stateWithSlotsAtLocA([hiddenSlot]);
    const withoutIntel = applyMissionEffects(
      base,
      [{ kind: "steal_all_revealed_assets_at_location" }],
      stubMission(),
      catalog,
      seededRng(2),
    );
    expect(withoutIntel.player.assets["as-car"]).toBeUndefined();

    const withIntel = applyMissionEffects(
      setLocationIntelLevel(base, "loc-a", 2),
      [{ kind: "steal_all_revealed_assets_at_location" }],
      stubMission(),
      catalog,
      seededRng(2),
    );
    expect(withIntel.player.assets["as-car"]).toBe(1);
  });
});

describe("assignMission asset targets under intel", () => {
  function tryAssign(state: GameState, visibilityAtAssign: "hidden" | "revealed") {
    const withMinion: GameState = {
      ...state,
      player: {
        ...state.player,
        minions: [makeMinionInstance("mi-1", "m-hero", ["t-req"])],
      },
      lairMissionIds: ["ms-asset-target"],
    };
    return assignMission(
      withMinion,
      catalogWithAssetTargetMission,
      "am-new",
      "ms-asset-target",
      { kind: "asset", locationId: "loc-a", slotIndex: 0, visibilityAtAssign },
      "lair",
      null,
      null,
      ["mi-1"],
      [],
    );
  }

  /** Same fixtures plus a mission whose target must be a *revealed* asset slot. */
  const catalogWithAssetTargetMission = {
    ...catalog,
    missions: [
      ...catalog.missions,
      {
        id: "ms-asset-target",
        name: "Lift the goods",
        description: "Revealed-asset mission",
        targetType: "asset_revealed" as const,
        startCommandPoints: 0,
        requiredTraitIds: ["t-req"],
        requiredAssetIds: [],
        durationTurns: 1,
      },
    ],
  };

  it("rejects a revealed-asset target on a stored-hidden slot below intel 2", () => {
    const state = setLocationIntelLevel(stateWithSlotsAtLocA([hiddenSlot]), "loc-a", 1);
    const result = tryAssign(state, "revealed");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("asset_visibility_mismatch");
    }
  });

  it("accepts it once intel reaches 2", () => {
    const state = setLocationIntelLevel(stateWithSlotsAtLocA([hiddenSlot]), "loc-a", 2);
    expect(tryAssign(state, "revealed").ok).toBe(true);
  });

  it("stops treating the same slot as a hidden-asset target at intel 2", () => {
    const state = setLocationIntelLevel(stateWithSlotsAtLocA([hiddenSlot]), "loc-a", 2);
    const result = tryAssign(state, "hidden");
    expect(result.ok).toBe(false);
  });
});

describe("setLocationIntelLevel", () => {
  it("clamps to [0, 3]", () => {
    const state = createInitialGameState(catalog, seededRng(1));
    expect(intelLevelAtLocation(setLocationIntelLevel(state, "loc-a", 9), "loc-a")).toBe(3);
    expect(intelLevelAtLocation(setLocationIntelLevel(state, "loc-a", -4), "loc-a")).toBe(0);
  });
});
