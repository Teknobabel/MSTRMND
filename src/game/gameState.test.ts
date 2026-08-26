import { describe, expect, it } from "vitest";
import type { ActiveMission, GameState } from "./gameState";
import {
  advanceToNextTurn,
  assignMission,
  cancelMission,
  createInitialGameState,
  eligibleEventTemplates,
  executePlan,
  hireMinion,
} from "./gameState";
import { parseCatalog } from "./contentSchema";
import {
  availableLairUpgradeMissionIds,
  currentLairUpgradeLevel,
} from "./lair";
import type { ContentCatalog } from "./types";
import { dynamicTraitSuccessModifierFromFullRoster } from "./dynamicTrait";
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

  /** Two plans and two lairs so a chosen id is distinguishable from a lucky roll. */
  function multiChoiceCatalog(): ContentCatalog {
    const raw = rawFixtureSlices();
    const plan = raw.omegaPlans[0] as Record<string, unknown>;
    raw.omegaPlans = [plan, { ...plan, id: "op-2", name: "Operation Second" }];
    const lair = raw.lairs[0] as Record<string, unknown>;
    raw.lairs = [
      lair,
      { ...lair, id: "lair-2", name: "Orbital Station", startingAssets: { "as-cash": 2 } },
    ];
    return parseCatalog(raw);
  }

  it("uses the chosen omega plan and lair", () => {
    const cat = multiChoiceCatalog();
    for (const seed of [1, 2, 3, 4]) {
      const state = createInitialGameState(cat, seededRng(seed), {
        omegaPlanId: "op-2",
        lairId: "lair-2",
      });
      expect(state.activeOmegaPlanId).toBe("op-2");
      expect(state.activeLairId).toBe("lair-2");
      /* The chosen lair's starting assets are applied, not the other one's. */
      expect(state.player.assets["as-cash"]).toBe(2);
    }
  });

  it("rolls the fields left random, and either pick may be random on its own", () => {
    const cat = multiChoiceCatalog();
    const planOnly = createInitialGameState(cat, seededRng(7), { omegaPlanId: "op-2" });
    expect(planOnly.activeOmegaPlanId).toBe("op-2");
    expect(["lair-1", "lair-2"]).toContain(planOnly.activeLairId);

    const lairOnly = createInitialGameState(cat, seededRng(7), { lairId: "lair-1" });
    expect(lairOnly.activeLairId).toBe("lair-1");
    expect(["op-1", "op-2"]).toContain(lairOnly.activeOmegaPlanId);
  });

  it("opens core missions in every lair's pool, without duplicating a lair's own list", () => {
    const raw = rawFixtureSlices();
    const missions = raw.missions as Record<string, unknown>[];
    /* `ms-core` is core-only (no lair lists it); `ms-basic` is core AND on lair-1's list. */
    missions.push({ ...missions[0], id: "ms-core", name: "Core Job", coreMission: true });
    missions[0] = { ...missions[0], coreMission: true };
    const lair = raw.lairs[0] as Record<string, unknown>;
    raw.lairs = [lair, { ...lair, id: "lair-2", name: "Orbital Station", availableMissionIds: [] }];
    const cat = parseCatalog(raw);

    const inLair1 = createInitialGameState(cat, seededRng(1), { lairId: "lair-1" });
    expect(inLair1.lairMissionIds).toEqual(["ms-basic", "ms-asset", "ms-core"]);

    const inLair2 = createInitialGameState(cat, seededRng(1), { lairId: "lair-2" });
    expect(inLair2.lairMissionIds).toEqual(["ms-basic", "ms-core"]);
  });

  it("leaves the pool to the lair when no mission is flagged core", () => {
    const state = createInitialGameState(catalog, seededRng(1), { lairId: "lair-1" });
    expect(state.lairMissionIds).toEqual(["ms-basic", "ms-asset"]);
  });

  it("falls back to a random pick when an id is not in the catalog", () => {
    const cat = multiChoiceCatalog();
    const state = createInitialGameState(cat, seededRng(9), {
      omegaPlanId: "op-missing",
      lairId: "lair-missing",
    });
    expect(["op-1", "op-2"]).toContain(state.activeOmegaPlanId);
    expect(["lair-1", "lair-2"]).toContain(state.activeLairId);
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

describe("Lair Raid (game over)", () => {
  /** Fixture catalog plus the special raid event the top wanted tier spawns. */
  function raidCatalog(): ContentCatalog {
    const slices = rawFixtureSlices();
    slices.events = [
      ...slices.events,
      {
        id: "ev-raid",
        name: "Lair raid",
        description: "They found the lair.",
        targetType: "none",
        startCommandPoints: 0,
        durationTurns: 1,
        lifetimeTurns: 2,
        requiredTraitIds: ["t-req"],
        special: "lair_raid",
        onSuccessEffects: [{ kind: "heat_delta", amount: -25 }],
      },
    ];
    return parseCatalog(slices);
  }

  const raidCat = raidCatalog();
  /** Fixture wanted levels: index 1 ("Noticed", minHeat 5) is the top tier. */
  const TOP_TIER = raidCat.wantedLevels.length - 1;

  function raidBaseState(seed: number): GameState {
    const state = createInitialGameState(raidCat, seededRng(seed));
    return {
      ...state,
      locationRequiredTraits: { "loc-a": [], "loc-b": [] },
      locationSecurityTraits: { "loc-a": ["t-sec"], "loc-b": [] },
    };
  }

  /** State sitting at the top wanted tier with the raid owed and the event slot free. */
  function pendingRaidState(seed: number): GameState {
    return {
      ...raidBaseState(seed),
      player: { ...raidBaseState(seed).player, heat: 100 },
      wantedLevelTierIndex: TOP_TIER,
      lairRaidStatus: "pending",
      currentEventTemplateId: null,
      currentEventTurnsRemaining: 0,
      /* Deliberately long: the raid must ignore it. */
      eventCooldownTurnsRemaining: 3,
    };
  }

  it("keeps the raid out of the ordinary draw pool", () => {
    const player = raidBaseState(1).player;
    const pool = eligibleEventTemplates(raidCat, { ...player, infamy: 100, heat: 100 });
    expect(pool.map((e) => e.id)).toEqual(["ev-1"]);
  });

  it("owes a raid once heat pushes the player to the top wanted tier", () => {
    const state: GameState = {
      ...raidBaseState(2),
      player: { ...raidBaseState(2).player, heat: 100 },
      /* Slot busy with an ordinary offer, so the raid can only be queued this resolve. */
      currentEventTemplateId: "ev-1",
      currentEventTurnsRemaining: 3,
    };
    const result = executePlan(state, raidCat, () => 0, sequentialIds("ag"));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.wantedLevelTierIndex).toBe(TOP_TIER);
    expect(result.value.lairRaidStatus).toBe("pending");
    /* Waits its turn: the offer already on the table is not displaced. */
    expect(result.value.currentEventTemplateId).toBe("ev-1");
    expect(result.value.runEnding).toBeNull();
  });

  it("puts the owed raid on the table at the next free slot, ignoring the cooldown", () => {
    const result = executePlan(pendingRaidState(3), raidCat, () => 0.99, sequentialIds("ag"));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const next = result.value;
    expect(next.currentEventTemplateId).toBe("ev-raid");
    expect(next.currentEventTurnsRemaining).toBe(2);
    expect(next.eventCooldownTurnsRemaining).toBe(0);
    expect(next.lairRaidStatus).toBe("offered");
    const rotated = next.activityLog
      .flatMap((e) => e.events)
      .filter((e) => e.kind === "event_rotated_in");
    expect(rotated).toHaveLength(1);
    expect(rotated[0]!.kind === "event_rotated_in" && rotated[0]!.eventTemplateId).toBe("ev-raid");
  });

  it("ends the run when the raid offer expires unanswered", () => {
    const offered: GameState = {
      ...pendingRaidState(4),
      lairRaidStatus: "offered",
      currentEventTemplateId: "ev-raid",
      currentEventTurnsRemaining: 1,
    };
    const result = executePlan(offered, raidCat, () => 0, sequentialIds("ag"));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const dead = result.value;
    expect(dead.runEnding).toEqual({ kind: "defeat", reason: "lair_raid_expired" });
    /* No replacement offer is drawn over the corpse of the run. */
    expect(dead.currentEventTemplateId).toBeNull();
    const kinds = dead.activityLog.flatMap((e) => e.events).map((e) => e.kind);
    expect(kinds).toContain("run_ended");

    /* Terminal: the run cannot be resolved or advanced any further. */
    const again = executePlan({ ...dead, phase: "main" }, raidCat, () => 0, sequentialIds("ag"));
    expect(again.ok).toBe(false);
    expect(again.ok === false && again.error.code).toBe("run_ended");
    const advanced = advanceToNextTurn(dead);
    expect(advanced.ok).toBe(false);
    expect(advanced.ok === false && advanced.error.code).toBe("run_ended");
  });

  it("ends the run when the raid mission fails", () => {
    const engaged: GameState = {
      ...pendingRaidState(5),
      lairRaidStatus: "offered",
      currentEventTemplateId: "ev-raid",
      currentEventTurnsRemaining: 2,
      player: {
        ...pendingRaidState(5).player,
        /* No `t-req`, so the raid's required trait is unmet and the roll cannot land. */
        minions: [makeMinionInstance("mi-1", "m-buddy", [])],
      },
      activeMissions: [
        activeMission({
          id: "am-raid",
          missionTemplateId: "ev-raid",
          missionSource: "event",
          target: { kind: "none" },
          turnsRemaining: 1,
          participantInstanceIds: ["mi-1"],
        }),
      ],
    };
    const result = executePlan(engaged, raidCat, () => 0.99, sequentialIds("ag"));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.runEnding).toEqual({ kind: "defeat", reason: "lair_raid_failed" });
  });

  it("stands the top tier down when the raid is survived, and re-arms it when heat returns", () => {
    const engaged: GameState = {
      ...pendingRaidState(6),
      lairRaidStatus: "offered",
      currentEventTemplateId: "ev-raid",
      currentEventTurnsRemaining: 2,
      player: {
        ...pendingRaidState(6).player,
        minions: [makeMinionInstance("mi-1", "m-hero", ["t-req"])],
      },
      activeMissions: [
        activeMission({
          id: "am-raid",
          missionTemplateId: "ev-raid",
          missionSource: "event",
          target: { kind: "none" },
          turnsRemaining: 1,
          participantInstanceIds: ["mi-1"],
        }),
      ],
    };
    /* rng 0 ⇒ the roll always lands under the success chance. */
    const result = executePlan(engaged, raidCat, () => 0, sequentialIds("ag"));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const survived = result.value;
    expect(survived.runEnding).toBeNull();
    expect(survived.player.heat).toBe(75); /* 100 − 25 from the template's success effect */
    expect(survived.wantedLevelTierIndex).toBe(TOP_TIER - 1);
    expect(survived.lairRaidStatus).toBe("none");
    /* The stand-down is not undone by the same resolve's own re-check. */
    expect(survived.currentEventTemplateId).not.toBe("ev-raid");

    const hotAgain: GameState = {
      ...survived,
      phase: "main",
      player: { ...survived.player, heat: 100 },
    };
    const rearmed = executePlan(hotAgain, raidCat, () => 0, sequentialIds("ag"));
    expect(rearmed.ok).toBe(true);
    if (!rearmed.ok) {
      return;
    }
    expect(rearmed.value.wantedLevelTierIndex).toBe(TOP_TIER);
    expect(rearmed.value.lairRaidStatus).not.toBe("none");
  });
});

describe("Omega Plan completion (game win)", () => {
  /** Fixture plan stages all point at `ms-basic`; one success per slot clears a phase. */
  function omegaMission(slot: number, turnsRemaining = 1): ActiveMission {
    return activeMission({
      id: `am-omega-${slot}`,
      missionTemplateId: "ms-basic",
      missionSource: "omega",
      omegaStageIndex: 2,
      omegaSlotIndex: slot,
      target: { kind: "location", locationId: "loc-a" },
      turnsRemaining,
      participantInstanceIds: [`mi-${slot}`],
    });
  }

  /** Sitting on the final phase with two of its three slots already banked. */
  function finalPhaseState(seed: number): GameState {
    const base = baseState(seed);
    return {
      ...base,
      player: {
        ...base.player,
        minions: [
          makeMinionInstance("mi-0", "m-hero", ["t-req"]),
          makeMinionInstance("mi-1", "m-hero", ["t-req"]),
          makeMinionInstance("mi-2", "m-hero", ["t-req"]),
        ],
      },
      activeOmegaStageIndex: 2,
      omegaStageProgress: [
        [true, true, true],
        [true, true, true],
        [true, true, false],
      ],
    };
  }

  it("ends the run in victory when the last phase clears", () => {
    const state: GameState = {
      ...finalPhaseState(20),
      activeMissions: [omegaMission(2)],
    };
    /* rng 0 ⇒ the roll always lands under the success chance. */
    const result = executePlan(state, catalog, () => 0, sequentialIds("ag"));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const won = result.value;
    expect(won.omegaStageProgress[2]).toEqual([true, true, true]);
    expect(won.runEnding).toEqual({
      kind: "victory",
      omegaPlanId: state.activeOmegaPlanId,
    });
    const kinds = won.activityLog.flatMap((e) => e.events).map((e) => e.kind);
    expect(kinds).toContain("run_ended");

    /* Terminal, exactly like a defeat. */
    const again = executePlan({ ...won, phase: "main" }, catalog, () => 0, sequentialIds("ag"));
    expect(again.ok).toBe(false);
    expect(again.ok === false && again.error.code).toBe("run_ended");
    const advanced = advanceToNextTurn(won);
    expect(advanced.ok).toBe(false);
    expect(advanced.ok === false && advanced.error.code).toBe("run_ended");
  });

  it("leaves the run alive when an earlier phase clears", () => {
    const base = baseState(21);
    const state: GameState = {
      ...base,
      player: { ...base.player, minions: [makeMinionInstance("mi-2", "m-hero", ["t-req"])] },
      activeOmegaStageIndex: 0,
      omegaStageProgress: [
        [true, true, false],
        [false, false, false],
        [false, false, false],
      ],
      activeMissions: [
        activeMission({
          id: "am-omega-2",
          missionTemplateId: "ms-basic",
          missionSource: "omega",
          omegaStageIndex: 0,
          omegaSlotIndex: 2,
          target: { kind: "location", locationId: "loc-a" },
          turnsRemaining: 1,
          participantInstanceIds: ["mi-2"],
        }),
      ],
    };
    const result = executePlan(state, catalog, () => 0, sequentialIds("ag"));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.activeOmegaStageIndex).toBe(1);
    expect(result.value.runEnding).toBeNull();
  });

  it("does not fire on a final-phase mission that fails", () => {
    const base = finalPhaseState(22);
    const state: GameState = {
      ...base,
      /* No `t-req`, so the mission's required trait is unmet and the roll cannot land. */
      player: { ...base.player, minions: [makeMinionInstance("mi-2", "m-buddy", [])] },
      activeMissions: [omegaMission(2)],
    };
    const result = executePlan(state, catalog, () => 0.99, sequentialIds("ag"));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.runEnding).toBeNull();
    expect(result.value.omegaStageProgress[2]).toEqual([true, true, false]);
  });

  it("prefers victory over a lost Lair Raid resolving on the same turn", () => {
    const raidCat = (() => {
      const slices = rawFixtureSlices();
      slices.events = [
        ...slices.events,
        {
          id: "ev-raid",
          name: "Lair raid",
          description: "They found the lair.",
          targetType: "none",
          startCommandPoints: 0,
          durationTurns: 1,
          lifetimeTurns: 1,
          requiredTraitIds: ["t-req"],
          special: "lair_raid",
        },
      ];
      return parseCatalog(slices);
    })();
    const base = finalPhaseState(23);
    const state: GameState = {
      ...base,
      player: {
        ...base.player,
        heat: 100,
        minions: [makeMinionInstance("mi-2", "m-hero", ["t-req"])],
      },
      wantedLevelTierIndex: raidCat.wantedLevels.length - 1,
      lairRaidStatus: "offered",
      currentEventTemplateId: "ev-raid",
      /* Expires on this very resolve — the raid is lost the same tick the plan lands. */
      currentEventTurnsRemaining: 1,
      activeMissions: [omegaMission(2)],
    };
    const result = executePlan(state, raidCat, () => 0, sequentialIds("ag"));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.runEnding).toEqual({
      kind: "victory",
      omegaPlanId: state.activeOmegaPlanId,
    });
  });
});

describe("lair upgrade levels", () => {
  /** Lair with a two-rung ladder: a mutually exclusive pair, then a single follow-up. */
  function ladderCatalog(): ContentCatalog {
    const raw = rawFixtureSlices();
    const missions = raw.missions as Record<string, unknown>[];
    for (const id of ["ms-up-a", "ms-up-b", "ms-up-c"]) {
      missions.push({
        id,
        name: `Upgrade ${id.slice(-1).toUpperCase()}`,
        description: "Lair upgrade",
        targetType: "none",
        startCommandPoints: 0,
        requiredTraitIds: ["t-req"],
        durationTurns: 1,
      });
    }
    raw.lairs[0] = {
      ...raw.lairs[0],
      upgradeLevels: [
        { name: "Rig", missionIds: ["ms-up-a", "ms-up-b"] },
        { missionIds: ["ms-up-c"] },
      ],
    };
    return parseCatalog(raw);
  }

  function ladderState(cat: ContentCatalog): GameState {
    const state = createInitialGameState(cat, seededRng(4), { lairId: "lair-1" });
    return {
      ...state,
      player: {
        ...state.player,
        minions: [makeMinionInstance("mi-1", "m-hero", ["t-req"])],
      },
    };
  }

  function startUpgrade(state: GameState, cat: ContentCatalog, missionId: string) {
    return assignMission(
      state,
      cat,
      `am-${missionId}`,
      missionId,
      { kind: "none" },
      "lair",
      null,
      null,
      ["mi-1"],
      [],
    );
  }

  it("offers only the current level's choices", () => {
    const cat = ladderCatalog();
    const state = ladderState(cat);
    expect(
      availableLairUpgradeMissionIds(state.activeLairId, state.completedLairUpgradeMissionIds, cat),
    ).toEqual(["ms-up-a", "ms-up-b"]);
    /* A later level is not assignable before its turn comes. */
    const early = startUpgrade(state, cat, "ms-up-c");
    expect(early.ok).toBe(false);
    if (!early.ok) {
      expect(early.error.code).toBe("mission_not_on_lair");
    }
  });

  it("closes the siblings while one choice is in flight", () => {
    const cat = ladderCatalog();
    const started = startUpgrade(ladderState(cat), cat, "ms-up-a");
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    const withRoster = {
      ...started.value,
      player: {
        ...started.value.player,
        minions: [
          ...started.value.player.minions,
          makeMinionInstance("mi-2", "m-hero", ["t-req"]),
        ],
      },
    };
    const sibling = assignMission(
      withRoster,
      cat,
      "am-sibling",
      "ms-up-b",
      { kind: "none" },
      "lair",
      null,
      null,
      ["mi-2"],
      [],
    );
    expect(sibling.ok).toBe(false);
    if (!sibling.ok) {
      expect(sibling.error.code).toBe("lair_upgrade_level_busy");
    }
  });

  it("installs one upgrade, locks out its siblings, and opens the next level", () => {
    const cat = ladderCatalog();
    const started = startUpgrade(ladderState(cat), cat, "ms-up-a");
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    const resolved = executePlan(started.value, cat, () => 0, sequentialIds("ag"));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    const after = resolved.value;
    expect(after.completedLairUpgradeMissionIds).toEqual(["ms-up-a"]);
    expect(
      availableLairUpgradeMissionIds(after.activeLairId, after.completedLairUpgradeMissionIds, cat),
    ).toEqual(["ms-up-c"]);
    /* The passed-over sibling is gone for the run, not merely deferred. */
    const mainPhase = { ...after, phase: "main" as const };
    const lockedOut = startUpgrade(mainPhase, cat, "ms-up-b");
    expect(lockedOut.ok).toBe(false);
    if (!lockedOut.ok) {
      expect(lockedOut.error.code).toBe("mission_not_on_lair");
    }
  });

  it("leaves nothing on offer once every level is installed", () => {
    const cat = ladderCatalog();
    const state = ladderState(cat);
    const done = {
      ...state,
      completedLairUpgradeMissionIds: ["ms-up-b", "ms-up-c"],
    };
    expect(
      availableLairUpgradeMissionIds(done.activeLairId, done.completedLairUpgradeMissionIds, cat),
    ).toEqual([]);
    expect(
      currentLairUpgradeLevel(done.activeLairId, done.completedLairUpgradeMissionIds, cat),
    ).toBeNull();
  });
});

describe("minion pair affinity through executePlan", () => {
  /** Two matched operatives so the mission succeeds at 100% with `rng: () => 0`. */
  function pairState(seed: number, overrides?: Partial<ActiveMission>): GameState {
    const state = baseState(seed);
    return {
      ...state,
      player: {
        ...state.player,
        minions: [
          makeMinionInstance("mi-1", "m-hero", ["t-req"]),
          makeMinionInstance("mi-2", "m-hero", ["t-req"]),
        ],
      },
      activeMissions: [
        activeMission({ participantInstanceIds: ["mi-1", "mi-2"], ...overrides }),
      ],
    };
  }

  function runTurns(start: GameState, turns: number, rng: () => number): GameState {
    let cur = start;
    for (let i = 0; i < turns; i += 1) {
      const missions = cur.activeMissions;
      const result = executePlan(cur, catalog, rng, sequentialIds("ag"));
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return cur;
      }
      /* Re-arm the same mission for the next turn; only the affinity carries over. */
      cur = { ...result.value, phase: "main" as const, activeMissions: missions };
    }
    return cur;
  }

  it("moves the pair's score by the tuned lair-mission amount on success", () => {
    const next = runTurns(pairState(1), 1, () => 0);
    expect(next.minionAffinities).toHaveLength(1);
    expect(next.minionAffinities[0]).toMatchObject({
      aInstanceId: "mi-1",
      bInstanceId: "mi-2",
      score: catalog.balance.minionAffinity.missionSuccess,
      relationship: "neutral",
    });
  });

  it("logs the threshold crossing on the resolve that reaches it, and only then", () => {
    const next = runTurns(pairState(1), 3, () => 0);
    expect(next.minionAffinities[0]!.relationship).toBe("friend");
    const crossings = completedEvents(next).flatMap((e) => e.relationshipChanges ?? []);
    expect(crossings).toEqual([
      { aInstanceId: "mi-1", bInstanceId: "mi-2", from: "neutral", to: "friend" },
    ]);
  });

  it("projects the new band onto both minions as a symmetric bond", () => {
    const next = runTurns(pairState(1), 3, () => 0);
    expect(next.player.minions.find((m) => m.instanceId === "mi-1")!.dynamicTraits).toContainEqual({
      kind: "friend",
      targetMinionInstanceId: "mi-2",
    });
    expect(next.player.minions.find((m) => m.instanceId === "mi-2")!.dynamicTraits).toContainEqual({
      kind: "friend",
      targetMinionInstanceId: "mi-1",
    });
  });

  it("counts the resulting bond once per pair in the next mission's success chance", () => {
    const friends = runTurns(pairState(1), 3, () => 0);
    const result = executePlan(
      { ...friends, phase: "main", activeMissions: [activeMission({ participantInstanceIds: ["mi-1", "mi-2"] })] },
      catalog,
      () => 0,
      sequentialIds("ag"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    /* Base is already 100 and the roll clamps, so read the pre-clamp intent from the modifier
     * itself: one Friend bond (+5), not one per minion (+10). */
    const bonds = result.value.player.minions
      .flatMap((m) => m.dynamicTraits)
      .filter((dt) => dt.kind === "friend");
    expect(bonds).toHaveLength(2); /* symmetric pills … */
    expect(
      dynamicTraitSuccessModifierFromFullRoster(
        result.value.player.minions,
        ["mi-1", "mi-2"],
        null,
        catalog.balance.dynamicTraitModifiers,
      ),
    ).toBe(catalog.balance.dynamicTraitModifiers.friend); /* … one modifier */
  });

  it("uses the omega delta for an omega mission", () => {
    const next = runTurns(
      pairState(1, { missionSource: "omega", omegaStageIndex: 0, omegaSlotIndex: 0 }),
      1,
      () => 0,
    );
    expect(next.minionAffinities[0]!.score).toBe(catalog.balance.minionAffinity.omegaSuccess);
  });

  it("leaves a solo mission with no pair rows at all", () => {
    const state = baseState(1);
    const solo = {
      ...state,
      player: {
        ...state.player,
        minions: [makeMinionInstance("mi-1", "m-hero", ["t-req"])],
      },
      activeMissions: [activeMission({ participantInstanceIds: ["mi-1"] })],
    };
    expect(runTurns(solo, 1, () => 0).minionAffinities).toEqual([]);
  });

  it("holds the band when the score oscillates around a threshold", () => {
    const friends = runTurns(pairState(1), 3, () => 0);
    expect(friends.minionAffinities[0]!.relationship).toBe("friend");
    /* Strip the required trait so the same pair now runs at 0% and the roll of 99 fails. One
     * failure drops the score to 2 — below the +3 entry but inside the hysteresis band. */
    const wobbled = runTurns(
      {
        ...friends,
        phase: "main",
        player: {
          ...friends.player,
          minions: friends.player.minions.map((m) => ({ ...m, traitIds: [] })),
        },
        activeMissions: [activeMission({ participantInstanceIds: ["mi-1", "mi-2"] })],
      },
      1,
      () => 0.99,
    );
    expect(wobbled.minionAffinities[0]!.score).toBe(2);
    expect(wobbled.minionAffinities[0]!.relationship).toBe("friend");
    expect(completedEvents(wobbled)[0]!.relationshipChanges).toBeUndefined();
  });
});

describe("run-start affinity seeds", () => {
  it("rolls a fixed template table at run start, before anyone is hired", () => {
    const state = createInitialGameState(catalog, seededRng(4));
    expect(state.minionAffinities).toEqual([]); /* roster is empty at turn 1 */
    /* The fixture catalog has two templates → exactly one pair, which takes the positive role. */
    expect(state.minionAffinitySeeds).toHaveLength(1);
    expect(state.minionAffinitySeeds[0]!.score).toBeGreaterThanOrEqual(
      catalog.balance.minionAffinity.friendThreshold,
    );
  });

  it("lands a seed on the pair only once the second minion is hired", () => {
    const start = createInitialGameState(catalog, seededRng(4));
    const seed = start.minionAffinitySeeds[0]!;
    const staged: GameState = {
      ...start,
      player: { ...start.player, commandPoints: 20 },
      availableMinionTemplateIds: [seed.aTemplateId, seed.bTemplateId],
    };

    const first = hireMinion(staged, catalog, seed.aTemplateId, "mi-1");
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.value.minionAffinities).toEqual([]);

    const second = hireMinion(first.value, catalog, seed.bTemplateId, "mi-2");
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.value.minionAffinities).toEqual([
      {
        aInstanceId: "mi-1",
        bInstanceId: "mi-2",
        score: seed.score,
        relationship: "friend",
      },
    ]);
    /* Seeded bands project onto both roster cards exactly like earned ones. */
    for (const m of second.value.player.minions) {
      expect(m.dynamicTraits.some((dt) => dt.kind === "friend")).toBe(true);
    }
  });

  it("lets a designer-authored bond outrank the roll for the same pair", () => {
    const raw = rawFixtureSlices();
    raw.minions[1] = {
      ...(raw.minions[1] as Record<string, unknown>),
      startingDynamicTraits: [{ kind: "hatred", targetMinionTemplateId: "m-hero" }],
    };
    const cat = parseCatalog(raw);
    const start = createInitialGameState(cat, seededRng(4));
    const staged: GameState = {
      ...start,
      player: { ...start.player, commandPoints: 20 },
      availableMinionTemplateIds: ["m-hero", "m-buddy"],
    };
    const first = hireMinion(staged, cat, "m-hero", "mi-1");
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const second = hireMinion(first.value, cat, "m-buddy", "mi-2");
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.value.minionAffinities[0]).toMatchObject({
      score: cat.balance.minionAffinity.hatedThreshold,
      relationship: "hated",
    });
  });
});
