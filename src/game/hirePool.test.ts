import { describe, expect, it } from "vitest";
import { pickHireOfferTemplateIds } from "./gameState";
import type { PlayerState } from "./gameState";
import { maxHireableStartingLevel, nextHireLevelInfamyThreshold } from "./minion";
import { parseCatalog, parseContentCatalog } from "./contentSchema";
import type { ContentCatalog, MinionInstance } from "./types";
import { makeMinionInstance, rawFixtureSlices, seededRng } from "./testFixtures";

const THRESHOLDS = [15, 35, 60, 85];

/** Fixture catalog with one template per starting level 1–5, plus the default gates. */
function tieredCatalog(thresholds: number[] = THRESHOLDS): ContentCatalog {
  const raw = rawFixtureSlices();
  raw.minions = [1, 2, 3, 4, 5].map((level) => ({
    id: `m-l${level}`,
    name: `Level ${level}`,
    description: `Starting level ${level}`,
    hireCommandPoints: 1,
    levelUpTraitOrder: [],
    ...(level > 1 ? { startingLevel: level } : {}),
  }));
  raw.balance = { hireLevelInfamyThresholds: thresholds };
  return parseCatalog(raw);
}

function playerAt(infamy: number, minions: MinionInstance[] = []): PlayerState {
  return {
    commandPoints: 5,
    maxCommandPoints: 5,
    infamy,
    heat: 0,
    minions,
    assets: {},
    maxRosterSize: 5,
    maxHireOffers: 10,
    maxConcurrentMissions: 2,
    maxParticipantsPerMission: 3,
    pendingBonusCommandPoints: 0,
  };
}

function offeredLevels(catalog: ContentCatalog, player: PlayerState): number[] {
  const ids = pickHireOfferTemplateIds(catalog, 10, seededRng(7), player);
  return ids
    .map((id) => catalog.minions.find((m) => m.id === id)?.startingLevel ?? 1)
    .sort((a, b) => a - b);
}

describe("maxHireableStartingLevel", () => {
  it("unlocks one level per threshold reached", () => {
    expect(maxHireableStartingLevel(0, THRESHOLDS)).toBe(1);
    expect(maxHireableStartingLevel(14, THRESHOLDS)).toBe(1);
    expect(maxHireableStartingLevel(15, THRESHOLDS)).toBe(2);
    expect(maxHireableStartingLevel(34, THRESHOLDS)).toBe(2);
    expect(maxHireableStartingLevel(35, THRESHOLDS)).toBe(3);
    expect(maxHireableStartingLevel(60, THRESHOLDS)).toBe(4);
    expect(maxHireableStartingLevel(85, THRESHOLDS)).toBe(5);
    expect(maxHireableStartingLevel(100, THRESHOLDS)).toBe(5);
  });

  it("offers only level 1 when there are no thresholds", () => {
    expect(maxHireableStartingLevel(100, [])).toBe(1);
  });
});

describe("nextHireLevelInfamyThreshold", () => {
  it("reports the next gate, then null once every level is unlocked", () => {
    expect(nextHireLevelInfamyThreshold(0, THRESHOLDS)).toBe(15);
    expect(nextHireLevelInfamyThreshold(15, THRESHOLDS)).toBe(35);
    expect(nextHireLevelInfamyThreshold(84, THRESHOLDS)).toBe(85);
    expect(nextHireLevelInfamyThreshold(85, THRESHOLDS)).toBeNull();
  });
});

describe("pickHireOfferTemplateIds", () => {
  const catalog = tieredCatalog();

  it("offers only level-1 recruits at 0 infamy", () => {
    expect(offeredLevels(catalog, playerAt(0))).toEqual([1]);
  });

  it("widens the pool as infamy crosses each threshold", () => {
    expect(offeredLevels(catalog, playerAt(15))).toEqual([1, 2]);
    expect(offeredLevels(catalog, playerAt(35))).toEqual([1, 2, 3]);
    expect(offeredLevels(catalog, playerAt(60))).toEqual([1, 2, 3, 4]);
    expect(offeredLevels(catalog, playerAt(85))).toEqual([1, 2, 3, 4, 5]);
  });

  it("never offers a template already on the roster", () => {
    const roster = [makeMinionInstance("mi-1", "m-l1", [])];
    const ids = pickHireOfferTemplateIds(catalog, 10, seededRng(7), playerAt(35, roster));
    expect(ids).not.toContain("m-l1");
    expect(ids.sort()).toEqual(["m-l2", "m-l3"]);
  });

  it("caps the draw at `count`", () => {
    expect(pickHireOfferTemplateIds(catalog, 2, seededRng(3), playerAt(85))).toHaveLength(2);
  });

  it("falls back to the lowest unhired level rather than offering nothing", () => {
    /* Every level-1 template is hired and infamy is below the first gate. */
    const roster = [makeMinionInstance("mi-1", "m-l1", [])];
    const ids = pickHireOfferTemplateIds(catalog, 10, seededRng(7), playerAt(0, roster));
    expect(ids).toEqual(["m-l2"]);
  });

  it("returns nothing when the whole catalog is already on the roster", () => {
    const roster = catalog.minions.map((m, i) => makeMinionInstance(`mi-${i}`, m.id, []));
    expect(pickHireOfferTemplateIds(catalog, 10, seededRng(7), playerAt(85, roster))).toEqual([]);
  });
});

describe("hireLevelInfamyThresholds content rules", () => {
  it("rejects thresholds that are not strictly ascending", () => {
    const raw = rawFixtureSlices();
    raw.balance = { hireLevelInfamyThresholds: [15, 35, 35] };
    const { catalog, issues } = parseContentCatalog(raw);
    expect(catalog).toBeNull();
    expect(
      issues.some(
        (i) => i.slice === "balance" && i.path === "hireLevelInfamyThresholds[2]",
      ),
    ).toBe(true);
  });

  it("flags a startingLevel no threshold can ever unlock", () => {
    const raw = rawFixtureSlices();
    raw.minions = [
      {
        id: "m-unreachable",
        name: "Untouchable",
        description: "Above the top gate",
        hireCommandPoints: 1,
        levelUpTraitOrder: [],
        startingLevel: 4,
      },
    ];
    raw.balance = { hireLevelInfamyThresholds: [15, 35] };
    const { catalog, issues } = parseContentCatalog(raw);
    expect(catalog).toBeNull();
    expect(
      issues.some(
        (i) =>
          i.slice === "minions" &&
          i.entityId === "m-unreachable" &&
          i.path === "startingLevel",
      ),
    ).toBe(true);
  });
});
