import { describe, expect, it } from "vitest";
import type { MissionEffect } from "./types";
import type { ActiveMission } from "./gameState";
import { createInitialGameState } from "./gameState";
import {
  applyCriticalFailureInjuryRolls,
  applyMissionEffects,
  orderedMissionEffects,
} from "./missionEffects";
import { fixtureCatalog, makeMinionInstance, seededRng } from "./testFixtures";

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

describe("applyCriticalFailureInjuryRolls", () => {
  const catalog = fixtureCatalog();

  it("injures every participant at 100% chance without duplicating the trait", () => {
    const state = createInitialGameState(catalog, seededRng(1));
    const player = {
      ...state.player,
      minions: [
        makeMinionInstance("i1", "m-hero", ["t-req"]),
        makeMinionInstance("i2", "m-buddy", ["injured"]),
      ],
    };
    const result = applyCriticalFailureInjuryRolls(
      player,
      ["i1", "i2"],
      100,
      "injured",
      seededRng(3),
    );
    expect(result.newlyInjuredInstanceIds).toEqual(["i1"]);
    const i1 = result.player.minions.find((m) => m.instanceId === "i1");
    const i2 = result.player.minions.find((m) => m.instanceId === "i2");
    expect(i1?.traitIds).toContain("injured");
    expect(i2?.traitIds.filter((t) => t === "injured")).toHaveLength(1);
  });

  it("is a no-op at 0% chance", () => {
    const state = createInitialGameState(catalog, seededRng(1));
    const player = {
      ...state.player,
      minions: [makeMinionInstance("i1", "m-hero", [])],
    };
    const result = applyCriticalFailureInjuryRolls(player, ["i1"], 0, "injured", seededRng(3));
    expect(result.newlyInjuredInstanceIds).toEqual([]);
    expect(result.player).toBe(player);
  });
});
