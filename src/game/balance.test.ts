import { describe, expect, it } from "vitest";
import type { ActiveMission } from "./gameState";
import { createInitialGameState, executePlan } from "./gameState";
import { successChancePercent } from "./mission";
import { parseCatalog, parseContentCatalog } from "./contentSchema";
import { DEFAULT_BALANCE } from "./types";
import type { ContentCatalog, MissionTemplate } from "./types";
import { makeMinionInstance, rawFixtureSlices, seededRng, sequentialIds } from "./testFixtures";

function catalogWithBalance(balance: Record<string, unknown>): ContentCatalog {
  const raw = rawFixtureSlices();
  raw.balance = balance;
  return parseCatalog(raw);
}

describe("balance slice parsing", () => {
  it("fills every knob from DEFAULT_BALANCE when the file is empty", () => {
    const { catalog, issues } = parseContentCatalog(rawFixtureSlices());
    expect(issues).toEqual([]);
    expect(catalog?.balance).toEqual(DEFAULT_BALANCE);
  });

  it("keeps explicit values and defaults the rest", () => {
    const catalog = catalogWithBalance({ infamyFailureDelta: 25 });
    expect(catalog.balance.infamyFailureDelta).toBe(25);
    expect(catalog.balance.statusPositiveBonus).toBe(DEFAULT_BALANCE.statusPositiveBonus);
    expect(catalog.balance.dynamicTraitModifiers).toEqual(
      DEFAULT_BALANCE.dynamicTraitModifiers,
    );
  });

  it("rejects assetsPerLocationMin greater than assetsPerLocationMax", () => {
    const raw = rawFixtureSlices();
    raw.balance = { assetsPerLocationMin: 3, assetsPerLocationMax: 1 };
    const { catalog, issues } = parseContentCatalog(raw);
    expect(catalog).toBeNull();
    expect(
      issues.some((i) => i.slice === "balance" && i.path === "assetsPerLocationMin"),
    ).toBe(true);
  });

  it("rejects out-of-range values with the offending field path", () => {
    const raw = rawFixtureSlices();
    raw.balance = { minionXpToLevel: 0 };
    const { issues } = parseContentCatalog(raw);
    expect(issues.some((i) => i.slice === "balance" && i.path === "minionXpToLevel")).toBe(true);
  });
});

describe("balance knobs steer the success formula", () => {
  const template: MissionTemplate = {
    id: "ms-x",
    name: "X",
    description: "",
    targetType: "location",
    startCommandPoints: 1,
    requiredTraitIds: ["t-a"],
    requiredAssetIds: [],
    durationTurns: 1,
  };
  const traitsCatalog = [
    { id: "t-a", name: "A", type: "primary" as const },
    { id: "t-pos", name: "Pos", type: "status_positive" as const },
    { id: "t-neg", name: "Neg", type: "status_negative" as const },
  ];

  it("uses modified status bonuses/penalties and per-agent penalty", () => {
    const p = makeMinionInstance("i1", "m1", ["t-a", "t-pos", "t-neg"]);
    const balance = {
      ...DEFAULT_BALANCE,
      statusPositiveBonus: 30,
      statusNegativePenalty: 5,
      opposingAgentPenalty: 50,
    };
    /* base 100 + 30 − 5 − 50 = 75 (legacy values would give 100 + 10 − 20 − 20 = 70). */
    expect(
      successChancePercent(template, [p], {
        traitsCatalog,
        opposingAgentPenaltyCount: 1,
        balance,
      }),
    ).toBe(75);
  });
});

describe("balance knobs steer executePlan and run setup", () => {
  it("applies modified infamy deltas and XP pacing", () => {
    const catalog = catalogWithBalance({ infamyFailureDelta: 25, minionXpToLevel: 1 });
    let state = createInitialGameState(catalog, seededRng(1));
    const am: ActiveMission = {
      id: "am-1",
      missionTemplateId: "ms-basic",
      target: { kind: "location", locationId: "loc-a" },
      missionSource: "lair",
      omegaStageIndex: null,
      omegaSlotIndex: null,
      participantInstanceIds: ["mi-1"],
      plannedAssetIds: [],
      turnsRemaining: 1,
      startedOnTurn: 1,
    };
    state = {
      ...state,
      player: {
        ...state.player,
        /* No matching traits → 0% chance → guaranteed failure. */
        minions: [makeMinionInstance("mi-1", "m-buddy", [])],
      },
      activeMissions: [am],
      locationRequiredTraits: { "loc-a": [], "loc-b": [] },
      locationSecurityTraits: { "loc-a": [], "loc-b": [] },
    };
    const result = executePlan(state, catalog, () => 0.99, sequentialIds("ag"));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.player.infamy).toBe(25);
    /* minionXpToLevel 1 ⇒ a single mission levels the participant up. */
    const mi1 = result.value.player.minions.find((m) => m.instanceId === "mi-1");
    expect(mi1?.currentLevel).toBe(2);
    expect(mi1?.currentExperience).toBe(0);
  });

  it("uses modified starting economy and roster caps", () => {
    const catalog = catalogWithBalance({
      startingMaxCommandPoints: 9,
      startingMaxRosterSize: 2,
      startingMaxConcurrentMissions: 7,
    });
    const state = createInitialGameState(catalog, seededRng(2));
    expect(state.player.commandPoints).toBe(9);
    expect(state.player.maxCommandPoints).toBe(9);
    expect(state.player.maxRosterSize).toBe(2);
    expect(state.player.maxConcurrentMissions).toBe(7);
  });

  it("uses modified world-generation numbers", () => {
    const catalog = catalogWithBalance({
      assetsPerLocationMin: 2,
      assetsPerLocationMax: 2,
      initialRevealedAssetSlots: 0,
    });
    const state = createInitialGameState(catalog, seededRng(3));
    for (const placement of state.locationAssetSlots) {
      expect(placement.slots).toHaveLength(2);
      for (const slot of placement.slots) {
        expect(slot.kind === "occupied" && slot.visibility).toBe("hidden");
      }
    }
  });
});
