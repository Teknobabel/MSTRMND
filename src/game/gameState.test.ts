import { describe, expect, it } from "vitest";
import type { ActiveMission, GameState } from "./gameState";
import {
  advanceToNextTurn,
  assignMission,
  cancelMission,
  createInitialGameState,
  eligibleEventTemplates,
  executePlan,
} from "./gameState";
import type { ContentCatalog } from "./types";
import { fixtureCatalog, makeMinionInstance, seededRng, sequentialIds } from "./testFixtures";

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
  it("opens the event slot quiet until `firstEventTurn`", () => {
    const state = createInitialGameState(catalog, seededRng(3));
    expect(state.currentEventTemplateId).toBeNull();
    /* Default firstEventTurn is 3 ⇒ two quiet turns before the first offer. */
    expect(state.eventCooldownTurnsRemaining).toBe(2);

    let cur = state;
    const offersByTurn: { turn: number; offer: string | null }[] = [];
    for (let i = 0; i < 3; i += 1) {
      const r = executePlan(cur, catalog, seededRng(3 + i), sequentialIds("ag"));
      expect(r.ok).toBe(true);
      if (!r.ok) {
        return;
      }
      const a = advanceToNextTurn(r.value);
      expect(a.ok).toBe(true);
      if (!a.ok) {
        return;
      }
      cur = a.value;
      offersByTurn.push({ turn: cur.turnNumber, offer: cur.currentEventTemplateId });
    }
    expect(offersByTurn).toEqual([
      { turn: 2, offer: null },
      { turn: 3, offer: "ev-1" },
      { turn: 4, offer: "ev-1" },
    ]);
  });

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

  it("counts the offer's lifetime down and keeps the same offer on the table", () => {
    const state: GameState = {
      ...baseState(6),
      currentEventTemplateId: "ev-1",
      currentEventTurnsRemaining: 2,
      eventCooldownTurnsRemaining: 0,
    };
    const result = executePlan(state, catalog, () => 0, sequentialIds("ag"));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const next = result.value;
    expect(next.currentEventTemplateId).toBe("ev-1");
    expect(next.currentEventTurnsRemaining).toBe(1);
    expect(next.player.pendingBonusCommandPoints).toBe(0); /* nothing expired yet */
    const kinds = next.activityLog.flatMap((e) => e.events).map((e) => e.kind);
    expect(kinds).not.toContain("event_expired");
    expect(kinds).not.toContain("event_rotated_in");
  });

  it("fires expire effects when the lifetime runs out unstarted, then decays modifiers", () => {
    const state: GameState = {
      ...baseState(6),
      currentEventTemplateId: "ev-1",
      currentEventTurnsRemaining: 1,
      eventCooldownTurnsRemaining: 0,
      activeSuccessModifiers: [
        { delta: 10, turnsRemaining: 1 },
        { delta: 5, turnsRemaining: 2 },
      ],
    };
    /* rng 0 ⇒ cooldown rolls the minimum (0), so the next offer lands the same resolve. */
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
    expect(next.currentEventTemplateId).toBe("ev-1"); /* only one event in the fixture catalog */
    expect(next.currentEventTurnsRemaining).toBe(2); /* fresh lifetime from the template */
    expect(next.eventCooldownTurnsRemaining).toBe(0);
  });

  it("holds the slot empty for the rolled cooldown, then draws the next offer", () => {
    const state: GameState = {
      ...baseState(6),
      currentEventTemplateId: "ev-1",
      currentEventTurnsRemaining: 1,
      eventCooldownTurnsRemaining: 0,
    };
    /* rng 0.99 ⇒ cooldown rolls the maximum (3). */
    const rngHigh = () => 0.99;
    const first = executePlan(state, catalog, rngHigh, sequentialIds("ag"));
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.value.currentEventTemplateId).toBeNull();
    expect(first.value.eventCooldownTurnsRemaining).toBe(3);

    let cur: GameState = { ...first.value, phase: "main" };
    const offersSeen: (string | null)[] = [];
    for (let i = 0; i < 3; i += 1) {
      const r = executePlan(cur, catalog, rngHigh, sequentialIds("ag"));
      expect(r.ok).toBe(true);
      if (!r.ok) {
        return;
      }
      cur = { ...r.value, phase: "main" };
      offersSeen.push(cur.currentEventTemplateId);
    }
    expect(offersSeen).toEqual([null, null, "ev-1"]);
    expect(cur.currentEventTurnsRemaining).toBe(2);
  });

  it("suspends the lifetime while the event mission runs, and cools down once it resolves", () => {
    const started: GameState = {
      ...baseState(7),
      currentEventTemplateId: "ev-1",
      currentEventTurnsRemaining: 1,
      eventCooldownTurnsRemaining: 0,
      player: {
        ...baseState(7).player,
        minions: [makeMinionInstance("mi-1", "m-hero", ["t-req"])],
      },
      activeMissions: [
        activeMission({
          id: "am-e",
          missionTemplateId: "ev-1",
          missionSource: "event",
          target: { kind: "none" },
          turnsRemaining: 2,
          participantInstanceIds: ["mi-1"],
        }),
      ],
    };
    const inFlight = executePlan(started, catalog, () => 0, sequentialIds("ag"));
    expect(inFlight.ok).toBe(true);
    if (!inFlight.ok) {
      return;
    }
    /* Offer left the table when it was started; nothing expires and nothing new is drawn. */
    expect(inFlight.value.currentEventTemplateId).toBeNull();
    expect(inFlight.value.activeMissions).toHaveLength(1);
    expect(inFlight.value.player.pendingBonusCommandPoints).toBe(0);
    const midKinds = inFlight.value.activityLog.flatMap((e) => e.events).map((e) => e.kind);
    expect(midKinds).not.toContain("event_expired");
    expect(midKinds).not.toContain("event_rotated_in");

    const resolved = executePlan(
      { ...inFlight.value, phase: "main" },
      catalog,
      () => 0,
      sequentialIds("ag"),
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    expect(resolved.value.activeMissions).toHaveLength(0);
    /* rng 0 ⇒ zero-turn cooldown, so the next offer appears at this same resolve. */
    expect(resolved.value.currentEventTemplateId).toBe("ev-1");
    expect(resolved.value.currentEventTurnsRemaining).toBe(2);
    const kinds = resolved.value.activityLog.flatMap((e) => e.events).map((e) => e.kind);
    expect(kinds).toContain("event_rotated_in");
    expect(kinds).not.toContain("event_expired");
  });
});

describe("event draw-pool gates", () => {
  /** Fixture catalog with the one event held behind an infamy gate. */
  function gatedCatalog(gate: { minInfamy?: number; minHeat?: number }): ContentCatalog {
    return { ...catalog, events: [{ ...catalog.events[0]!, ...gate }] };
  }

  it("keeps gated events out of the pool until the player's stats reach them", () => {
    const player = baseState(11).player;
    const infamyGated = gatedCatalog({ minInfamy: 20 });
    expect(eligibleEventTemplates(infamyGated, { ...player, infamy: 19 })).toHaveLength(0);
    expect(eligibleEventTemplates(infamyGated, { ...player, infamy: 20 })).toHaveLength(1);

    const heatGated = gatedCatalog({ minHeat: 40 });
    expect(eligibleEventTemplates(heatGated, { ...player, heat: 39 })).toHaveLength(0);
    expect(eligibleEventTemplates(heatGated, { ...player, heat: 40 })).toHaveLength(1);

    /* Both gates must be met, and an ungated event is always in the pool. */
    const bothGated = gatedCatalog({ minInfamy: 20, minHeat: 40 });
    expect(eligibleEventTemplates(bothGated, { ...player, infamy: 20, heat: 39 })).toHaveLength(0);
    expect(eligibleEventTemplates(bothGated, { ...player, infamy: 20, heat: 40 })).toHaveLength(1);
    expect(eligibleEventTemplates(catalog, { ...player, infamy: 0, heat: 0 })).toHaveLength(1);
  });

  it("leaves the slot empty while nothing is eligible, then draws once a gate opens", () => {
    const gated = gatedCatalog({ minInfamy: 20 });
    const quiet: GameState = {
      ...baseState(12),
      currentEventTemplateId: null,
      currentEventTurnsRemaining: 0,
      eventCooldownTurnsRemaining: 0,
    };
    const locked = executePlan(quiet, gated, () => 0, sequentialIds("ag"));
    expect(locked.ok).toBe(true);
    if (!locked.ok) {
      return;
    }
    expect(locked.value.currentEventTemplateId).toBeNull();
    const lockedKinds = locked.value.activityLog.flatMap((e) => e.events).map((e) => e.kind);
    expect(lockedKinds).not.toContain("event_rotated_in");

    /* The draw is retried every resolve, so crossing the gate opens the event up. */
    const escalated: GameState = {
      ...locked.value,
      phase: "main",
      player: { ...locked.value.player, infamy: 20 },
    };
    const unlocked = executePlan(escalated, gated, () => 0, sequentialIds("ag"));
    expect(unlocked.ok).toBe(true);
    if (!unlocked.ok) {
      return;
    }
    expect(unlocked.value.currentEventTemplateId).toBe("ev-1");
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

  it("allows only one event mission at a time from the current offer", () => {
    const state = {
      ...stateWithRoster(),
      currentEventTemplateId: "ev-1",
      currentEventTurnsRemaining: 2,
    };
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
    if (!result.ok) {
      return;
    }
    /* The offer stays addressable until Execute Plan, so cancelling gives the turn back. */
    expect(result.value.currentEventTemplateId).toBe("ev-1");
    const second = assignMission(
      result.value,
      catalog,
      "am-e2",
      "ev-1",
      { kind: "none" },
      "event",
      null,
      null,
      ["mi-1"],
      [],
    );
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe("invalid_mission_source_binding");
    }
  });
});
