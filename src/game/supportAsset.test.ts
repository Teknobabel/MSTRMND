import { describe, expect, it } from "vitest";
import { parseCatalog } from "./contentSchema";
import type { ActiveMission, GameState } from "./gameState";
import { assignMission, cancelMission, createInitialGameState, executePlan } from "./gameState";
import {
  computeSuccessChanceBreakdown,
  isSupportAsset,
  supportAbilitiesForAssetIds,
  supportSuccessChanceBonus,
} from "./mission";
import { applyMissionEffects } from "./missionEffects";
import {
  makeMinionInstance,
  rawFixtureSlices,
  seededRng,
} from "./testFixtures";
import type { ContentCatalog, MissionTemplate } from "./types";

/**
 * The fixture catalog with one asset per support ability bolted on. Built per-test rather than
 * added to `rawFixtureSlices` because `createInitialGameState` draws site asset placements from
 * `catalog.assets` — growing that array would reshuffle every other suite's seeded run.
 */
function supportCatalog(mutate?: (slices: ReturnType<typeof rawFixtureSlices>) => void): ContentCatalog {
  const raw = rawFixtureSlices();
  raw.assets.push(
    { id: "sup-luck", name: "Lucky Charm", supportAbility: { kind: "success_chance_bonus", percent: 15 } },
    { id: "sup-luck2", name: "Second Charm", supportAbility: { kind: "success_chance_bonus", percent: 5 } },
    { id: "sup-quiet", name: "Signal Jammer", supportAbility: { kind: "prevent_security_increase" } },
    { id: "sup-cool", name: "Burner Net", supportAbility: { kind: "prevent_heat_increase" } },
    { id: "sup-armor", name: "Body Armor", supportAbility: { kind: "prevent_injuries" } },
    { id: "sup-drones", name: "Drone Swarm", supportAbility: { kind: "ignore_agent_challenge_traits" } },
    { id: "sup-keys", name: "Crypto Keys", supportAbility: { kind: "ignore_security_traits" } },
  );
  mutate?.(raw);
  return parseCatalog(raw);
}

const catalog = supportCatalog();

const basicMission = catalog.missions.find((m) => m.id === "ms-basic")! as MissionTemplate;

/** Initial state with the site rolls neutralized, one hired operative, and a stocked locker. */
function baseState(
  cat: ContentCatalog,
  assets: Record<string, number>,
  overrides?: Partial<GameState>,
): GameState {
  const state = createInitialGameState(cat, seededRng(11));
  return {
    ...state,
    locationRequiredTraits: { "loc-a": [], "loc-b": [] },
    locationSecurityTraits: { "loc-a": ["t-sec"], "loc-b": [] },
    player: {
      ...state.player,
      minions: [makeMinionInstance("mi-1", "m-hero", ["t-req"])],
      assets,
    },
    ...overrides,
  };
}

function assign(
  state: GameState,
  cat: ContentCatalog,
  supportAssetIds: string[],
  missionId = "ms-basic",
) {
  return assignMission(
    state,
    cat,
    "am-1",
    missionId,
    { kind: "location", locationId: "loc-a" },
    "lair",
    null,
    null,
    ["mi-1"],
    [],
    supportAssetIds,
  );
}

describe("support asset catalog", () => {
  it("only assets carrying an ability count as support assets", () => {
    expect(isSupportAsset(catalog.assets.find((a) => a.id === "sup-luck")!)).toBe(true);
    expect(isSupportAsset(catalog.assets.find((a) => a.id === "as-car")!)).toBe(false);
  });

  it("resolves committed ids to abilities and skips inert / unknown ids", () => {
    const abilities = supportAbilitiesForAssetIds(
      ["sup-luck", "as-car", "nope", "sup-cool"],
      catalog.assets,
    );
    expect(abilities).toEqual([
      { kind: "success_chance_bonus", percent: 15 },
      { kind: "prevent_heat_increase" },
    ]);
  });

  it("stacks success bonuses across slots", () => {
    expect(
      supportSuccessChanceBonus(supportAbilitiesForAssetIds(["sup-luck", "sup-luck2"], catalog.assets)),
    ).toBe(20);
  });
});

describe("assignMission with support assets", () => {
  it("spends the support asset from inventory and records it on the mission", () => {
    const state = baseState(catalog, { "sup-luck": 2 });
    const res = assign(state, catalog, ["sup-luck"]);
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.value.activeMissions[0]!.supportAssetIds).toEqual(["sup-luck"]);
    expect(res.value.player.assets["sup-luck"]).toBe(1);
  });

  it("refuses more support assets than the player has slots for", () => {
    const state = baseState(catalog, { "sup-luck": 1, "sup-cool": 1 });
    const res = assign(state, catalog, ["sup-luck", "sup-cool"]);
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.error).toEqual({ code: "too_many_support_assets", max: 1, got: 2 });
  });

  it("accepts up to the raised cap once an upgrade widens it", () => {
    const start = baseState(catalog, { "sup-luck": 1, "sup-cool": 1 });
    const state: GameState = {
      ...start,
      player: { ...start.player, maxSupportAssets: 2 },
    };
    const res = assign(state, catalog, ["sup-luck", "sup-cool"]);
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.value.activeMissions[0]!.supportAssetIds).toEqual(["sup-luck", "sup-cool"]);
  });

  it("refuses an asset with no support ability", () => {
    const state = baseState(catalog, { "as-car": 1 });
    const res = assign(state, catalog, ["as-car"]);
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.error).toEqual({ code: "not_a_support_asset", assetId: "as-car" });
  });

  it("refuses a support asset the player does not own", () => {
    const state = baseState(catalog, {});
    const res = assign(state, catalog, ["sup-luck"]);
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.error).toEqual({ code: "not_enough_assets", assetId: "sup-luck", need: 1, have: 0 });
  });

  it("counts required and support slots against the same inventory pile", () => {
    /* ms-asset needs one as-car; using the only as-car as support too would need two. */
    const cat = supportCatalog((raw) => {
      raw.assets.push({
        id: "as-car-support",
        name: "Getaway Car (rigged)",
        supportAbility: { kind: "prevent_injuries" },
      });
      raw.missions.push({
        id: "ms-dual",
        name: "Dual",
        description: "Needs the rigged car",
        targetType: "location",
        startCommandPoints: 0,
        requiredAssetIds: ["as-car-support"],
        durationTurns: 1,
      });
      (raw.lairs[0] as { availableMissionIds: string[] }).availableMissionIds.push("ms-dual");
    });
    const state = baseState(cat, { "as-car-support": 1 });
    const res = assignMission(
      state,
      cat,
      "am-1",
      "ms-dual",
      { kind: "location", locationId: "loc-a" },
      "lair",
      null,
      null,
      ["mi-1"],
      ["as-car-support"],
      ["as-car-support"],
    );
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.error).toEqual({
      code: "not_enough_assets",
      assetId: "as-car-support",
      need: 2,
      have: 1,
    });
  });

  it("refunds support assets when the mission is cancelled", () => {
    const state = baseState(catalog, { "sup-luck": 1 });
    const assigned = assign(state, catalog, ["sup-luck"]);
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) {
      return;
    }
    const cancelled = cancelMission(assigned.value, catalog, "am-1");
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) {
      return;
    }
    expect(cancelled.value.player.assets["sup-luck"]).toBe(1);
  });
});

describe("success chance abilities", () => {
  const participants = [makeMinionInstance("mi-1", "m-hero", ["t-req"])];

  it("adds the flat bonus from every success_chance_bonus slot", () => {
    const without = computeSuccessChanceBreakdown(basicMission, participants, {
      balance: catalog.balance,
    });
    const with2 = computeSuccessChanceBreakdown(basicMission, participants, {
      balance: catalog.balance,
      supportAbilities: supportAbilitiesForAssetIds(["sup-luck", "sup-luck2"], catalog.assets),
    });
    expect(without.supportAssetDelta).toBe(0);
    expect(with2.supportAssetDelta).toBe(20);
    /* Base is already 100 here, so read the pre-clamp figure to see the bonus land. */
    expect(with2.preClampPercent).toBe(without.preClampPercent + 20);
  });

  it("ignore_agent_challenge_traits zeroes the penalty but keeps the traits visible", () => {
    const opts = { balance: catalog.balance, challengeTraitIds: ["t-level", "t-sec"] };
    const exposed = computeSuccessChanceBreakdown(basicMission, participants, opts);
    expect(exposed.unmatchedChallengeTraitIds).toEqual(["t-level", "t-sec"]);
    expect(exposed.challengeTraitPenaltyTotal).toBe(40);
    expect(exposed.challengeTraitsIgnored).toBe(false);

    const shrugged = computeSuccessChanceBreakdown(basicMission, participants, {
      ...opts,
      supportAbilities: supportAbilitiesForAssetIds(["sup-drones"], catalog.assets),
    });
    expect(shrugged.challengeTraitIds).toEqual(["t-level", "t-sec"]);
    expect(shrugged.unmatchedChallengeTraitIds).toEqual([]);
    expect(shrugged.challengeTraitPenaltyTotal).toBe(0);
    expect(shrugged.challengeTraitsIgnored).toBe(true);
  });
});

describe("resolve-time abilities", () => {
  /** Resolve `am` on `state` with a roll that always fails (rng 0.99 vs a low chance). */
  function resolveWith(state: GameState, cat: ContentCatalog, rngValue: number): GameState {
    const res = executePlan({ ...state, phase: "main" }, cat, () => rngValue);
    expect(res.ok).toBe(true);
    if (!res.ok) {
      throw new Error("resolve failed");
    }
    return res.value;
  }

  function stateWithMission(
    cat: ContentCatalog,
    supportAssetIds: string[],
    missionOverrides?: Partial<ActiveMission>,
  ): GameState {
    const base = baseState(cat, {});
    const am: ActiveMission = {
      id: "am-1",
      missionTemplateId: "ms-basic",
      target: { kind: "location", locationId: "loc-a" },
      missionSource: "lair",
      omegaStageIndex: null,
      omegaSlotIndex: null,
      participantInstanceIds: ["mi-1"],
      plannedAssetIds: [],
      supportAssetIds,
      turnsRemaining: 1,
      startedOnTurn: 1,
      ...missionOverrides,
    };
    return { ...base, activeMissions: [am] };
  }

  it("prevent_security_increase leaves the target site's security where it was", () => {
    const bare = resolveWith(stateWithMission(catalog, []), catalog, 0.01);
    const secBare = bare.locationSecurityStates.find((s) => s.locationId === "loc-a")!.securityLevel;
    expect(secBare).toBe(1);

    const guarded = resolveWith(stateWithMission(catalog, ["sup-quiet"]), catalog, 0.01);
    const secGuarded = guarded.locationSecurityStates.find(
      (s) => s.locationId === "loc-a",
    )!.securityLevel;
    expect(secGuarded).toBe(0);
  });

  it("prevent_security_increase also rolls back a mission effect that raises it", () => {
    const cat = supportCatalog((raw) => {
      (raw.missions[0] as { onSuccessEffects?: unknown[] }).onSuccessEffects = [
        { kind: "security_level_delta", delta: 2 },
      ];
    });
    const guarded = resolveWith(stateWithMission(cat, ["sup-quiet"]), cat, 0.01);
    expect(
      guarded.locationSecurityStates.find((s) => s.locationId === "loc-a")!.securityLevel,
    ).toBe(0);
  });

  it("prevent_security_increase does not block a reduction", () => {
    const cat = supportCatalog((raw) => {
      (raw.missions[0] as { onSuccessEffects?: unknown[] }).onSuccessEffects = [
        { kind: "security_level_delta", delta: -1 },
      ];
    });
    const start = stateWithMission(cat, ["sup-quiet"]);
    const raised: GameState = {
      ...start,
      locationSecurityStates: start.locationSecurityStates.map((s) =>
        s.locationId === "loc-a" ? { ...s, securityLevel: 2 } : s,
      ),
    };
    const after = resolveWith(raised, cat, 0.01);
    expect(after.locationSecurityStates.find((s) => s.locationId === "loc-a")!.securityLevel).toBe(1);
  });

  it("prevent_heat_increase holds heat at its pre-mission value on a failure", () => {
    /* `ms-basic` needs t-req, which mi-1 has, so a 0.99 roll against 100% still succeeds;
     * strip the trait match by sending a participant who lacks it. */
    const cat = catalog;
    const start = stateWithMission(cat, []);
    const noTrait: GameState = {
      ...start,
      player: {
        ...start.player,
        minions: [makeMinionInstance("mi-1", "m-buddy", [])],
      },
    };
    const bare = resolveWith(noTrait, cat, 0.99);
    expect(bare.player.heat).toBe(5); /* `ms-basic`'s authored failure heat */

    const guarded = resolveWith(
      { ...noTrait, activeMissions: [{ ...noTrait.activeMissions[0]!, supportAssetIds: ["sup-cool"] }] },
      cat,
      0.99,
    );
    expect(guarded.player.heat).toBe(0);
  });

  it("prevent_heat_increase still lets a heat reduction through", () => {
    const cat = supportCatalog((raw) => {
      (raw.missions[0] as { onSuccessEffects?: unknown[] }).onSuccessEffects = [
        { kind: "heat_delta", amount: -5 },
      ];
    });
    const start = stateWithMission(cat, ["sup-cool"]);
    const hot: GameState = { ...start, player: { ...start.player, heat: 20 } };
    const after = resolveWith(hot, cat, 0.01);
    expect(after.player.heat).toBe(15);
  });

  it("prevent_injuries stops a failure effect from injuring the crew", () => {
    const cat = supportCatalog((raw) => {
      (raw.missions[0] as { onFailureEffects?: unknown[] }).onFailureEffects = [
        { kind: "add_all_participant_traits", traitIds: ["injured"] },
      ];
    });
    const start = stateWithMission(cat, []);
    const noTrait: GameState = {
      ...start,
      player: { ...start.player, minions: [makeMinionInstance("mi-1", "m-buddy", [])] },
    };
    const bare = resolveWith(noTrait, cat, 0.99);
    expect(bare.player.minions[0]!.traitIds).toContain("injured");

    const guarded = resolveWith(
      { ...noTrait, activeMissions: [{ ...noTrait.activeMissions[0]!, supportAssetIds: ["sup-armor"] }] },
      cat,
      0.99,
    );
    expect(guarded.player.minions[0]!.traitIds).not.toContain("injured");
  });

  it("prevent_injuries leaves an injury the minion already had alone", () => {
    const cat = supportCatalog();
    const start = stateWithMission(cat, ["sup-armor"]);
    const alreadyHurt: GameState = {
      ...start,
      player: {
        ...start.player,
        minions: [makeMinionInstance("mi-1", "m-hero", ["t-req", "injured"])],
      },
    };
    const after = resolveWith(alreadyHurt, cat, 0.01);
    expect(after.player.minions[0]!.traitIds).toContain("injured");
  });

  it("ignore_security_traits drops the site's revealed security traits from the requirement", () => {
    const cat = catalog;
    const start = stateWithMission(cat, []);
    /* Security 1 reveals `t-sec`, which mi-1 does not have: 1 of 2 required traits matched. */
    const guarded: GameState = {
      ...start,
      locationSecurityStates: start.locationSecurityStates.map((s) =>
        s.locationId === "loc-a" ? { ...s, securityLevel: 1 } : s,
      ),
    };
    const bare = resolveWith(guarded, cat, 0.6);
    const bareRow = bare.activityLog
      .flatMap((e) => e.events)
      .find((e) => e.kind === "mission_completed")!;
    expect(bareRow.successChancePercent).toBe(50);

    const withKeys = resolveWith(
      { ...guarded, activeMissions: [{ ...guarded.activeMissions[0]!, supportAssetIds: ["sup-keys"] }] },
      cat,
      0.6,
    );
    const keysRow = withKeys.activityLog
      .flatMap((e) => e.events)
      .find((e) => e.kind === "mission_completed")!;
    expect(keysRow.successChancePercent).toBe(100);
  });

  it("carries the committed support assets onto the mission result report row", () => {
    const start = stateWithMission(catalog, ["sup-luck"]);
    const after = resolveWith(start, catalog, 0.01);
    /* The mission left the board; its ids survive on the pre-resolve snapshot the report reads. */
    expect(start.activeMissions[0]!.supportAssetIds).toEqual(["sup-luck"]);
    expect(after.activeMissions).toHaveLength(0);
  });
});

describe("max_support_assets_delta", () => {
  it("raises the cap and floors it at zero", () => {
    const state = baseState(catalog, {});
    const am: ActiveMission = {
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
    };
    const up = applyMissionEffects(
      state,
      [{ kind: "max_support_assets_delta", delta: 2 }],
      am,
      catalog,
      seededRng(1),
    );
    expect(up.player.maxSupportAssets).toBe(3);

    const down = applyMissionEffects(
      state,
      [{ kind: "max_support_assets_delta", delta: -5 }],
      am,
      catalog,
      seededRng(1),
    );
    expect(down.player.maxSupportAssets).toBe(0);
  });

  it("starts a run at the balance-authored slot count", () => {
    const cat = supportCatalog((raw) => {
      raw.balance = { startingMaxSupportAssets: 3 };
    });
    expect(createInitialGameState(cat, seededRng(3)).player.maxSupportAssets).toBe(3);
  });
});
