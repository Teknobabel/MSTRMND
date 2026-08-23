import { describe, expect, it } from "vitest";
import type { ActiveMission, GameState } from "./gameState";
import {
  assignMission,
  cancelMission,
  createInitialGameState,
  executePlan,
} from "./gameState";
import { parseCatalog } from "./contentSchema";
import type { ContentCatalog } from "./types";
import {
  fixtureCatalog,
  makeMinionInstance,
  rawFixtureSlices,
  seededRng,
  sequentialIds,
} from "./testFixtures";

const catalog = fixtureCatalog();

function activeMission(overrides: Partial<ActiveMission>): ActiveMission {
  return {
    id: "am-1",
    missionTemplateId: "ms-basic",
    target: { kind: "location", locationId: "loc-a" },
    missionSource: "lair",
    omegaStageIndex: null,
    omegaSlotIndex: null,
    participantInstanceIds: [],
    plannedAssetIds: [],
    turnsRemaining: 1,
    startedOnTurn: 1,
    ...overrides,
  };
}

/** Fresh initial state with deterministic site rolls neutralized for exact success %s. */
function baseState(seed: number): GameState {
  const state = createInitialGameState(catalog, seededRng(seed));
  return {
    ...state,
    locationRequiredTraits: { "loc-a": [], "loc-b": [] },
    locationSecurityTraits: { "loc-a": ["t-sec"], "loc-b": [] },
  };
}

function completedEvents(state: GameState) {
  return state.activityLog
    .flatMap((e) => e.events)
    .filter((e) => e.kind === "mission_completed");
}

describe("createInitialGameState", () => {
  it("is deterministic for a given seed", () => {
    const a = createInitialGameState(catalog, seededRng(5));
    const b = createInitialGameState(catalog, seededRng(5));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("executePlan", () => {
  it("rejects when not in the main phase", () => {
    const state = { ...baseState(1), phase: "summary" as const };
    const result = executePlan(state, catalog, seededRng(1));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("wrong_phase");
    }
  });

  it("resolves a fully-matched mission: success, XP, +1 security, +infamy, no heat", () => {
    let state = baseState(1);
    state = {
      ...state,
      player: {
        ...state.player,
        minions: [makeMinionInstance("mi-1", "m-hero", ["t-req"])],
      },
      activeMissions: [activeMission({ participantInstanceIds: ["mi-1"] })],
    };
    const result = executePlan(state, catalog, () => 0, sequentialIds("ag"));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const next = result.value;
    const done = completedEvents(next);
    expect(done).toHaveLength(1);
    expect(done[0]!.success).toBe(true);
    expect(done[0]!.successChancePercent).toBe(100);
    expect(done[0]!.baselineInfamyDelta).toBe(5);
    expect(done[0]!.baselineHeatDelta).toBe(0);
    expect(next.player.infamy).toBe(5);
    expect(next.player.heat).toBe(0); /* success is clean: no heat */
    expect(next.wantedLevelTierIndex).toBe(0); /* wanted level tracks heat, not infamy */
    expect(next.activeMissions).toHaveLength(0);
    const mi1 = next.player.minions.find((m) => m.instanceId === "mi-1");
    expect(mi1?.currentExperience).toBe(1);
    const locA = next.locationSecurityStates.find((s) => s.locationId === "loc-a");
    expect(locA?.securityLevel).toBe(1);
    expect(next.phase).toBe("summary");
  });

  it("on failure adds heat and a tier increase spawns hidden opposing agents", () => {
    let state = baseState(2);
    state = {
      ...state,
      player: {
        ...state.player,
        minions: [makeMinionInstance("mi-1", "m-buddy", [])],
      },
      activeMissions: [activeMission({ participantInstanceIds: ["mi-1"] })],
    };
    /* No matching traits → 0%; rng 0.99 rolls 99 → failure. */
    const result = executePlan(state, catalog, () => 0.99, sequentialIds("ag"));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const next = result.value;
    expect(completedEvents(next)[0]!.success).toBe(false);
    expect(next.player.heat).toBe(5);
    expect(next.player.infamy).toBe(0); /* failure grants no infamy */
    /* Tier 1 starts at minHeat 5, maxAgents 2 → two hidden spawns, one per template. */
    expect(next.wantedLevelTierIndex).toBe(1);
    expect(next.opposingAgentInstances).toHaveLength(2);
    expect(next.opposingAgentInstances.every((a) => a.catalogVisibility === "hidden")).toBe(true);
    const placed = next.locationAgentPresence.flatMap((r) => r.agentInstanceIds);
    expect(placed).toHaveLength(2);
    expect(new Set(next.opposingAgentInstances.map((a) => a.templateId)).size).toBe(2);
  });

  it("resolves simultaneously: later missions use the start-of-turn security snapshot", () => {
    let state = baseState(3);
    state = {
      ...state,
      player: {
        ...state.player,
        minions: [
          makeMinionInstance("mi-1", "m-hero", ["t-req"]),
          makeMinionInstance("mi-2", "m-hero", ["t-req"]),
        ],
      },
      activeMissions: [
        activeMission({ id: "am-1", participantInstanceIds: ["mi-1"] }),
        activeMission({ id: "am-2", participantInstanceIds: ["mi-2"] }),
      ],
    };
    const result = executePlan(state, catalog, () => 0, sequentialIds("ag"));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const done = completedEvents(result.value);
    expect(done).toHaveLength(2);
    /* Both resolve at security 0: the first mission's +1 security (which would reveal the
     * "t-sec" security trait and drop the chance to 50%) must not affect the second. */
    expect(done.map((e) => e.successChancePercent)).toEqual([100, 100]);
    const locA = result.value.locationSecurityStates.find((s) => s.locationId === "loc-a");
    expect(locA?.securityLevel).toBe(2);
  });

  it("aborts (not silently drops) a mission whose participants are gone, refunding assets", () => {
    let state = baseState(4);
    state = {
      ...state,
      player: { ...state.player, minions: [], assets: {} },
      activeMissions: [
        activeMission({
          missionTemplateId: "ms-asset",
          target: { kind: "none" },
          participantInstanceIds: ["ghost"],
          plannedAssetIds: ["as-car", "as-gun"],
        }),
      ],
    };
    const result = executePlan(state, catalog, () => 0.5, sequentialIds("ag"));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const next = result.value;
    expect(next.activeMissions).toHaveLength(0);
    expect(next.player.assets).toEqual({ "as-car": 1, "as-gun": 1 });
    const events = next.activityLog.flatMap((e) => e.events);
    const aborted = events.find((e) => e.kind === "mission_aborted");
    expect(aborted).toBeDefined();
    if (aborted?.kind === "mission_aborted") {
      expect(aborted.reason).toBe("invalid_participants");
    }
    expect(events.filter((e) => e.kind === "asset_gained")).toHaveLength(2);
  });

  it("aborts with missing_template when the template id is not in the catalog", () => {
    let state = baseState(5);
    state = {
      ...state,
      player: {
        ...state.player,
        minions: [makeMinionInstance("mi-1", "m-hero", ["t-req"])],
      },
      activeMissions: [
        activeMission({ missionTemplateId: "ms-gone", participantInstanceIds: ["mi-1"] }),
      ],
    };
    const result = executePlan(state, catalog, () => 0.5, sequentialIds("ag"));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const aborted = result.value.activityLog
      .flatMap((e) => e.events)
      .find((e) => e.kind === "mission_aborted");
    expect(aborted?.kind === "mission_aborted" && aborted.reason).toBe("missing_template");
  });

  it("fires expire effects for an unengaged event offer, then decays modifiers, then rotates", () => {
    let state = baseState(6);
    state = {
      ...state,
      currentEventTemplateId: "ev-1",
      eventOfferEngagedThisTurn: false,
      activeSuccessModifiers: [
        { delta: 10, turnsRemaining: 1 },
        { delta: 5, turnsRemaining: 2 },
      ],
    };
    const result = executePlan(state, catalog, () => 0, sequentialIds("ag"));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const next = result.value;
    expect(next.player.pendingBonusCommandPoints).toBe(2); /* ev-1 grants +2 CP on expire */
    expect(next.activeSuccessModifiers).toEqual([{ delta: 5, turnsRemaining: 1 }]);
    const kinds = next.activityLog.flatMap((e) => e.events).map((e) => e.kind);
    expect(kinds).toContain("event_expired");
    expect(kinds).toContain("event_rotated_in");
    expect(next.eventOfferEngagedThisTurn).toBe(false);
  });

  it("skips expire effects when the offer was engaged this turn", () => {
    let state = baseState(7);
    state = {
      ...state,
      currentEventTemplateId: "ev-1",
      eventOfferEngagedThisTurn: true,
    };
    const result = executePlan(state, catalog, () => 0, sequentialIds("ag"));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.player.pendingBonusCommandPoints).toBe(0);
    const kinds = result.value.activityLog.flatMap((e) => e.events).map((e) => e.kind);
    expect(kinds).not.toContain("event_expired");
  });
});

describe("assignMission / cancelMission", () => {
  function stateWithRoster(): GameState {
    const state = baseState(8);
    return {
      ...state,
      player: {
        ...state.player,
        minions: [makeMinionInstance("mi-1", "m-hero", ["t-req"])],
        assets: { "as-car": 2 },
      },
    };
  }

  it("commits CP and per-slot assets on assign, and refunds both on same-turn cancel", () => {
    const state = stateWithRoster();
    const assigned = assignMission(
      state,
      catalog,
      "am-x",
      "ms-asset",
      { kind: "none" },
      "lair",
      null,
      null,
      ["mi-1"],
      ["as-car", null],
    );
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) {
      return;
    }
    expect(assigned.value.player.commandPoints).toBe(4);
    expect(assigned.value.player.assets).toEqual({ "as-car": 1 });
    expect(assigned.value.activeMissions).toHaveLength(1);
    expect(assigned.value.activeMissions[0]!.plannedAssetIds).toEqual(["as-car", null]);
    const kinds = assigned.value.activityLog.flatMap((e) => e.events).map((e) => e.kind);
    expect(kinds).toContain("mission_started");
    expect(kinds).toContain("asset_lost");

    const cancelled = cancelMission(assigned.value, catalog, "am-x");
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) {
      return;
    }
    expect(cancelled.value.player.commandPoints).toBe(5);
    expect(cancelled.value.player.assets).toEqual({ "as-car": 2 });
    expect(cancelled.value.activeMissions).toHaveLength(0);
  });

  it("rejects a target kind that does not match the template targetType", () => {
    const result = assignMission(
      stateWithRoster(),
      catalog,
      "am-x",
      "ms-basic",
      { kind: "none" },
      "lair",
      null,
      null,
      ["mi-1"],
      [],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("wrong_target_kind");
    }
  });

  it("rejects when planned assets exceed inventory", () => {
    const result = assignMission(
      stateWithRoster(),
      catalog,
      "am-x",
      "ms-asset",
      { kind: "none" },
      "lair",
      null,
      null,
      ["mi-1"],
      ["as-car", "as-gun"],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_enough_assets");
    }
  });

  it("rejects past the concurrent mission cap", () => {
    const state = stateWithRoster();
    const capped = {
      ...state,
      player: { ...state.player, maxConcurrentMissions: 0 },
    };
    const result = assignMission(
      capped,
      catalog,
      "am-x",
      "ms-asset",
      { kind: "none" },
      "lair",
      null,
      null,
      ["mi-1"],
      ["as-car", null],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("max_concurrent_missions");
    }
  });

  it("marks the event offer engaged when assigning the current event", () => {
    const state = { ...stateWithRoster(), currentEventTemplateId: "ev-1" };
    const result = assignMission(
      state,
      catalog,
      "am-e",
      "ev-1",
      { kind: "none" },
      "event",
      null,
      null,
      ["mi-1"],
      [],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.eventOfferEngagedThisTurn).toBe(true);
    }
  });
});

describe("omega phase completion", () => {
  /** Catalog whose omega plan phases each clear at `requiredMissions` successes. */
  function catalogWithRequired(required: number | undefined): ContentCatalog {
    const raw = rawFixtureSlices();
    const plan = raw.omegaPlans[0] as Record<string, unknown>;
    plan.stages = (plan.stages as Record<string, unknown>[]).map((stage) => ({
      ...stage,
      ...(required === undefined ? {} : { requiredMissions: required }),
    }));
    return parseCatalog(raw);
  }

  /** State with `count` omega missions from phase 0 about to resolve successfully. */
  function stateWithOmegaMissions(cat: ContentCatalog, count: number): GameState {
    const state = createInitialGameState(cat, seededRng(1));
    return {
      ...state,
      locationRequiredTraits: { "loc-a": [], "loc-b": [] },
      locationSecurityTraits: { "loc-a": [], "loc-b": [] },
      player: {
        ...state.player,
        maxConcurrentMissions: 3,
        minions: Array.from({ length: count }, (_, i) =>
          makeMinionInstance(`mi-${i}`, "m-hero", ["t-req"]),
        ),
      },
      activeMissions: Array.from({ length: count }, (_, i) =>
        activeMission({
          id: `am-${i}`,
          missionSource: "omega",
          omegaStageIndex: 0,
          omegaSlotIndex: i,
          participantInstanceIds: [`mi-${i}`],
        }),
      ),
    };
  }

  it("defaults to requiring all three missions when content omits requiredMissions", () => {
    const cat = catalogWithRequired(undefined);
    expect(cat.omegaPlans[0]!.stages.map((s) => s.requiredMissions)).toEqual([3, 3, 3]);

    const twoDone = executePlan(stateWithOmegaMissions(cat, 2), cat, () => 0);
    expect(twoDone.ok).toBe(true);
    if (twoDone.ok) {
      expect(twoDone.value.activeOmegaStageIndex).toBe(0);
      expect(twoDone.value.omegaStageProgress[0]).toEqual([true, true, false]);
    }

    const allDone = executePlan(stateWithOmegaMissions(cat, 3), cat, () => 0);
    expect(allDone.ok).toBe(true);
    if (allDone.ok) {
      expect(allDone.value.activeOmegaStageIndex).toBe(1);
    }
  });

  it("advances the phase at requiredMissions successes", () => {
    const cat = catalogWithRequired(2);
    const result = executePlan(stateWithOmegaMissions(cat, 2), cat, () => 0);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.activeOmegaStageIndex).toBe(1);
    /* Per-slot flags persist so the UI can tell a cleared slot from a skipped one. */
    expect(result.value.omegaStageProgress[0]).toEqual([true, true, false]);
    expect(result.value.omegaStageProgress[1]).toEqual([false, false, false]);
  });

  it("does not advance when fewer than requiredMissions succeed", () => {
    const cat = catalogWithRequired(2);
    const result = executePlan(stateWithOmegaMissions(cat, 1), cat, () => 0);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.activeOmegaStageIndex).toBe(0);
    expect(result.value.omegaStageProgress[0]).toEqual([true, false, false]);
  });

  it("credits a late mission to its own phase without re-advancing", () => {
    const cat = catalogWithRequired(2);
    const state = stateWithOmegaMissions(cat, 1);
    const carried: GameState = {
      ...state,
      activeOmegaStageIndex: 1,
      omegaStageProgress: [[true, true, false], [false, false, false], [false, false, false]],
      activeMissions: [
        activeMission({
          id: "am-late",
          missionSource: "omega",
          omegaStageIndex: 0,
          omegaSlotIndex: 2,
          participantInstanceIds: ["mi-0"],
        }),
      ],
    };
    const result = executePlan(carried, cat, () => 0);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.omegaStageProgress[0]).toEqual([true, true, true]);
    expect(result.value.activeOmegaStageIndex).toBe(1);
  });

  it("ignores failed omega missions", () => {
    const cat = catalogWithRequired(1);
    const state = stateWithOmegaMissions(cat, 1);
    const failing: GameState = {
      ...state,
      player: {
        ...state.player,
        minions: [makeMinionInstance("mi-0", "m-buddy", [])],
      },
    };
    const result = executePlan(failing, cat, () => 0.99);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.activeOmegaStageIndex).toBe(0);
    expect(result.value.omegaStageProgress[0]).toEqual([false, false, false]);
  });
});
