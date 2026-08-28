import { describe, expect, it } from "vitest";
import type { MissionEffect } from "./types";
import type { ActiveMission, GameState } from "./gameState";
import { createInitialGameState } from "./gameState";
import { createAgentFromTemplate, getAgentTemplateById } from "./agent";
import {
  applyMissionEffects,
  describeMissionTemplateEffects,
  orderedMissionEffects,
} from "./missionEffects";
import { fixtureCatalog, seededRng } from "./testFixtures";

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

describe("orderedMissionEffects", () => {
  it("runs reveals first, then steals, then the rest, preserving relative order", () => {
    const effects: MissionEffect[] = [
      { kind: "infamy_delta", amount: 2 },
      { kind: "steal_all_assets_at_location" },
      { kind: "reveal_all_hidden_assets_at_location" },
      { kind: "gain_assets", assetIds: ["as-cash"] },
      { kind: "reveal_hidden_assets_global", count: 1 },
    ];
    expect(orderedMissionEffects(effects).map((e) => e.kind)).toEqual([
      "reveal_all_hidden_assets_at_location",
      "reveal_hidden_assets_global",
      "steal_all_assets_at_location",
      "infamy_delta",
      "gain_assets",
    ]);
  });
});

describe("applyMissionEffects", () => {
  const catalog = fixtureCatalog();

  it("clamps infamy to [0, 100] after all effects", () => {
    const state = createInitialGameState(catalog, seededRng(1));
    const applied = applyMissionEffects(
      { ...state, player: { ...state.player, infamy: 98 } },
      [{ kind: "infamy_delta", amount: 50 }],
      stubMission(),
      catalog,
      seededRng(2),
    );
    expect(applied.player.infamy).toBe(100);

    const appliedDown = applyMissionEffects(
      { ...state, player: { ...state.player, infamy: 1 } },
      [{ kind: "infamy_delta", amount: -50 }],
      stubMission(),
      catalog,
      seededRng(2),
    );
    expect(appliedDown.player.infamy).toBe(0);
  });

  it("clamps heat to [0, 100] after all effects", () => {
    const state = createInitialGameState(catalog, seededRng(1));
    const applied = applyMissionEffects(
      { ...state, player: { ...state.player, heat: 98 } },
      [{ kind: "heat_delta", amount: 50 }],
      stubMission(),
      catalog,
      seededRng(2),
    );
    expect(applied.player.heat).toBe(100);

    const appliedDown = applyMissionEffects(
      { ...state, player: { ...state.player, heat: 1 } },
      [{ kind: "heat_delta", amount: -50 }],
      stubMission(),
      catalog,
      seededRng(2),
    );
    expect(appliedDown.player.heat).toBe(0);
  });

  it("caps exchange_assets removals at current holdings and applies gains", () => {
    const state = createInitialGameState(catalog, seededRng(1));
    const applied = applyMissionEffects(
      { ...state, player: { ...state.player, assets: { "as-car": 1 } } },
      [
        {
          kind: "exchange_assets",
          removeAssetIds: ["as-car", "as-car", "as-gun"],
          gainAssetIds: ["as-cash", "as-cash"],
        },
      ],
      stubMission(),
      catalog,
      seededRng(2),
    );
    expect(applied.player.assets).toEqual({ "as-cash": 2 });
    expect(applied.events).toContainEqual({ kind: "asset_lost", assetId: "as-car", quantity: 1 });
    expect(applied.events).toContainEqual({ kind: "asset_gained", assetId: "as-cash", quantity: 2 });
  });

  it("floors player stat caps at 1 and adjusts current CP with the max-CP delta", () => {
    const state = createInitialGameState(catalog, seededRng(1));
    const applied = applyMissionEffects(
      state,
      [
        { kind: "max_concurrent_missions_delta", delta: -50 },
        { kind: "max_command_points_per_turn_delta", delta: -2 },
      ],
      stubMission(),
      catalog,
      seededRng(2),
    );
    expect(applied.player.maxConcurrentMissions).toBe(1);
    expect(applied.player.maxCommandPoints).toBe(3);
    expect(applied.player.commandPoints).toBe(3);
  });

  it("pushes add_success_chance_modifier entries onto activeSuccessModifiers", () => {
    const state = createInitialGameState(catalog, seededRng(1));
    const applied = applyMissionEffects(
      state,
      [{ kind: "add_success_chance_modifier", delta: 15, turns: 2 }],
      stubMission(),
      catalog,
      seededRng(2),
    );
    expect(applied.activeSuccessModifiers).toEqual([{ delta: 15, turnsRemaining: 2 }]);
  });

  it("clamps security_level_delta to [0, locationLevel] at the target site", () => {
    const state = createInitialGameState(catalog, seededRng(1));
    const applied = applyMissionEffects(
      state,
      [{ kind: "security_level_delta", delta: 10 }],
      stubMission({ target: { kind: "location", locationId: "loc-a" } }),
      catalog,
      seededRng(2),
    );
    const locA = applied.locationSecurityStates.find((s) => s.locationId === "loc-a");
    expect(locA?.securityLevel).toBe(2); /* loc-a is locationLevel 2 */
  });
});

describe("Guard passive vs security reductions", () => {
  const catalog = fixtureCatalog();

  /** A run with loc-a at security 2 (its cap) and, optionally, a guard standing on it. */
  function stateWithSecurity(guardAt: string | null): GameState {
    const base = createInitialGameState(catalog, seededRng(1));
    const state: GameState = {
      ...base,
      locationSecurityStates: [
        { locationId: "loc-a", securityLevel: 2 },
        { locationId: "loc-b", securityLevel: 1 },
      ],
    };
    if (guardAt === null) {
      return state;
    }
    const template = getAgentTemplateById(catalog, "a-spy")!;
    return {
      ...state,
      opposingAgentInstances: [
        {
          ...createAgentFromTemplate(template, "opp-1", { catalogVisibility: "revealed" }),
          abilityIds: ["guard"],
        },
      ],
      locationAgentPresence: state.locationAgentPresence.map((row) =>
        row.locationId === guardAt ? { ...row, agentInstanceIds: ["opp-1"] } : row,
      ),
    };
  }

  function securityAfter(
    state: GameState,
    effects: MissionEffect[],
  ): { levels: Record<string, number>; guardEvents: number } {
    const applied = applyMissionEffects(state, effects, stubMission(), catalog, seededRng(2));
    const levels: Record<string, number> = {};
    for (const s of applied.locationSecurityStates) {
      levels[s.locationId] = s.securityLevel;
    }
    return {
      levels,
      guardEvents: applied.events.filter(
        (e) => e.kind === "agent_ability_used" && e.abilityId === "guard",
      ).length,
    };
  }

  it("refuses a targeted reduction at the guarded site and reports the refusal", () => {
    const effects: MissionEffect[] = [{ kind: "security_level_delta", delta: -2 }];
    expect(securityAfter(stateWithSecurity(null), effects).levels["loc-a"]).toBe(0);

    const guarded = securityAfter(stateWithSecurity("loc-a"), effects);
    expect(guarded.levels["loc-a"]).toBe(2);
    expect(guarded.guardEvents).toBe(1);
  });

  it("never blocks security rising", () => {
    /* loc-b is `locationLevel` 1, so it is already capped; loc-a has room to climb. */
    const raised = securityAfter(stateWithSecurity("loc-a"), [
      { kind: "security_level_delta_global", delta: 1 },
    ]);
    expect(raised.levels["loc-a"]).toBe(2); /* already at its cap of 2 */
    expect(raised.guardEvents).toBe(0);
  });

  it("shields only its own site from a global sweep", () => {
    const swept = securityAfter(stateWithSecurity("loc-a"), [
      { kind: "security_level_delta_global", delta: -1 },
    ]);
    expect(swept.levels["loc-a"]).toBe(2);
    expect(swept.levels["loc-b"]).toBe(0);
    expect(swept.guardEvents).toBe(1);
  });

  it("covers scoped sweeps too", () => {
    /* loc-a is the economic site in the fixture map. */
    const scoped = securityAfter(stateWithSecurity("loc-a"), [
      { kind: "security_level_delta_by_location_type", delta: -1, locationType: "economic" },
    ]);
    expect(scoped.levels["loc-a"]).toBe(2);
    expect(scoped.guardEvents).toBe(1);
  });
});

describe("describeMissionTemplateEffects", () => {
  const catalog = fixtureCatalog();

  it("describes individual gained assets with catalog names", () => {
    const effects: MissionEffect[] = [
      { kind: "gain_assets", assetIds: ["as-cash", "as-car"] },
    ];
    expect(describeMissionTemplateEffects(effects, catalog)).toEqual([
      "Gain asset: Cash Reserves",
      "Gain asset: Getaway Car",
    ]);
  });

  it("falls back to asset ID if catalog is omitted or asset is not found", () => {
    const effects: MissionEffect[] = [
      { kind: "gain_assets", assetIds: ["dirty_money", "unknown_asset"] },
    ];
    expect(describeMissionTemplateEffects(effects)).toEqual([
      "Gain asset: dirty_money",
      "Gain asset: unknown_asset",
    ]);
  });

  it("describes other mission effects with names when available", () => {
    const effects: MissionEffect[] = [
      { kind: "unlock_lair_mission", missionId: "ms-basic" },
      { kind: "remove_trait_from_all_minions", traitId: "t-req" },
      { kind: "add_trait_to_random_minions", traitId: "t-pos", count: 2 },
      { kind: "infamy_delta", amount: 5 },
    ];
    expect(describeMissionTemplateEffects(effects, catalog)).toEqual([
      "Unlocked lair mission: Case the Bank",
      "Removed trait Infiltration from all hired minions",
      "Granted trait Inspired to up to 2 random minion(s)",
      "Infamy +5 (mission effect)",
    ]);
  });
});

