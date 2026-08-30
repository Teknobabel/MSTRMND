import { describe, expect, it } from "vitest";
import { fixtureCatalog } from "./testFixtures";
import {
  heatGainForWantedIndex,
  maxOpposingAgentsForWantedIndex,
  nextMonotonicWantedTierIndex,
  tierIndexForHeat,
  wantedTierAtIndex,
} from "./wantedLevel";
import type { WantedLevelTier } from "./types";

describe("wantedLevel", () => {
  const tiers: WantedLevelTier[] = [
    { minHeat: 0, name: "Unnoticed", maxAgents: 0, heatGainPerTurn: 0 },
    { minHeat: 15, name: "Whispers", maxAgents: 1, heatGainPerTurn: 1 },
    { minHeat: 30, name: "Person of Interest", maxAgents: 2, heatGainPerTurn: 1 },
    { minHeat: 50, name: "Public Enemy", maxAgents: 3, heatGainPerTurn: 2 },
    { minHeat: 70, name: "Global Manhunt", maxAgents: 4, heatGainPerTurn: 2 },
    { minHeat: 100, name: "Doomsday Alert", maxAgents: 5, heatGainPerTurn: 3 },
  ];

  it("calculates correct tier index for heat", () => {
    expect(tierIndexForHeat(0, tiers)).toBe(0);
    expect(tierIndexForHeat(14, tiers)).toBe(0);
    expect(tierIndexForHeat(15, tiers)).toBe(1);
    expect(tierIndexForHeat(29, tiers)).toBe(1);
    expect(tierIndexForHeat(30, tiers)).toBe(2);
    expect(tierIndexForHeat(50, tiers)).toBe(3);
    expect(tierIndexForHeat(70, tiers)).toBe(4);
    expect(tierIndexForHeat(100, tiers)).toBe(5);
  });

  it("maintains monotonicity for wanted tier index", () => {
    expect(nextMonotonicWantedTierIndex(2, 10, tiers)).toBe(2);
    expect(nextMonotonicWantedTierIndex(2, 55, tiers)).toBe(3);
    expect(nextMonotonicWantedTierIndex(0, 0, [])).toBe(0);
  });

  it("looks up tier and heat gain at index", () => {
    const catalog = { ...fixtureCatalog(), wantedLevels: tiers };
    expect(wantedTierAtIndex(catalog, 0)?.name).toBe("Unnoticed");
    expect(wantedTierAtIndex(catalog, -1)).toBeUndefined();
    expect(wantedTierAtIndex(catalog, 10)).toBeUndefined();

    expect(maxOpposingAgentsForWantedIndex(catalog, 0)).toBe(0);
    expect(maxOpposingAgentsForWantedIndex(catalog, 3)).toBe(3);
    expect(maxOpposingAgentsForWantedIndex(catalog, 99)).toBe(0);

    expect(heatGainForWantedIndex(catalog, 0)).toBe(0);
    expect(heatGainForWantedIndex(catalog, 1)).toBe(1);
    expect(heatGainForWantedIndex(catalog, 2)).toBe(1);
    expect(heatGainForWantedIndex(catalog, 3)).toBe(2);
    expect(heatGainForWantedIndex(catalog, 4)).toBe(2);
    expect(heatGainForWantedIndex(catalog, 5)).toBe(3);
    expect(heatGainForWantedIndex(catalog, 99)).toBe(0);
  });
});
