import { describe, expect, it } from "vitest";
import {
  affinityDeltaForResolve,
  applyLocationAffinity,
  applyMissionAffinity,
  applyTemplateLocationSeeds,
  applyTemplatePairSeeds,
  findLocationAffinity,
  findPairAffinity,
  formatRelationshipChange,
  formatStandingChange,
  nextRelationship,
  nextStanding,
  orderPair,
  pairKey,
  relationshipBetween,
  rollStartingTemplateAffinities,
  rollStartingTemplateLocationAffinities,
  setLocationAffinityScore,
  standingAt,
  seedStartingAffinities,
  seedStartingLocationAffinities,
  setPairAffinityScore,
  syncMinionDynamicTraits,
} from "./affinity";
import { DEFAULT_BALANCE } from "./types";
import type {
  LocationAffinityConfig,
  MinionAffinityConfig,
  MinionLocationAffinity,
  MinionLocationStanding,
  MinionPairAffinity,
} from "./types";
import { fixtureCatalog, makeMinionInstance, seededRng } from "./testFixtures";

const cfg: MinionAffinityConfig = DEFAULT_BALANCE.minionAffinity;

describe("nextRelationship thresholds", () => {
  it("climbs neutral → friend → ally at the entry thresholds", () => {
    expect(nextRelationship(2, "neutral", cfg)).toBe("neutral");
    expect(nextRelationship(3, "neutral", cfg)).toBe("friend");
    expect(nextRelationship(6, "friend", cfg)).toBe("friend");
    expect(nextRelationship(7, "friend", cfg)).toBe("ally");
  });

  it("descends neutral → rival → hated at the mirrored thresholds", () => {
    expect(nextRelationship(-2, "neutral", cfg)).toBe("neutral");
    expect(nextRelationship(-3, "neutral", cfg)).toBe("rival");
    expect(nextRelationship(-6, "rival", cfg)).toBe("rival");
    expect(nextRelationship(-7, "rival", cfg)).toBe("hated");
  });

  it("skips a band when a single swing clears both thresholds", () => {
    expect(nextRelationship(9, "neutral", cfg)).toBe("ally");
    expect(nextRelationship(-9, "neutral", cfg)).toBe("hated");
  });
});

describe("nextRelationship hysteresis", () => {
  /* Friends are earned at +3 and only lapse below +1 (3 − hysteresis 2). */
  it("holds a band until the score falls a full hysteresis past its threshold", () => {
    expect(nextRelationship(2, "friend", cfg)).toBe("friend");
    expect(nextRelationship(1, "friend", cfg)).toBe("friend");
    expect(nextRelationship(0, "friend", cfg)).toBe("neutral");
  });

  it("holds the deeper band the same way", () => {
    expect(nextRelationship(5, "ally", cfg)).toBe("ally");
    expect(nextRelationship(4, "ally", cfg)).toBe("friend");
    expect(nextRelationship(-5, "hated", cfg)).toBe("hated");
    expect(nextRelationship(-4, "hated", cfg)).toBe("rival");
  });

  it("does not flip-flop when the score oscillates across a threshold", () => {
    /* +1 / −1 either side of the Friends threshold: once earned, the band sticks. */
    let rel = nextRelationship(3, "neutral", cfg);
    expect(rel).toBe("friend");
    for (const score of [2, 3, 2, 3, 2]) {
      rel = nextRelationship(score, rel, cfg);
      expect(rel).toBe("friend");
    }
  });

  it("with hysteresis 0 the band follows the score exactly", () => {
    const sharp = { ...cfg, hysteresis: 0 };
    expect(nextRelationship(3, "neutral", sharp)).toBe("friend");
    expect(nextRelationship(2, "friend", sharp)).toBe("neutral");
  });
});

describe("affinityDeltaForResolve", () => {
  it("maps each mission source and outcome to its tuned delta", () => {
    expect(affinityDeltaForResolve("lair", false, "success", cfg)).toBe(1);
    expect(affinityDeltaForResolve("lair", false, "failure", cfg)).toBe(-1);
    expect(affinityDeltaForResolve("event", false, "success", cfg)).toBe(2);
    expect(affinityDeltaForResolve("event", false, "failure", cfg)).toBe(-2);
    expect(affinityDeltaForResolve("omega", false, "success", cfg)).toBe(2);
    expect(affinityDeltaForResolve("omega", false, "failure", cfg)).toBe(-2);
  });

  it("gives a compromise both deltas, the way it takes both effect lists", () => {
    expect(affinityDeltaForResolve("lair", false, "compromised", cfg)).toBe(1 + -1);
    expect(affinityDeltaForResolve("event", false, "compromised", cfg)).toBe(2 + -2);
    expect(affinityDeltaForResolve("omega", false, "compromised", cfg)).toBe(2 + -2);
    /* Raid failure is tuned to 0, so a compromised raid keeps the whole success bond. */
    expect(affinityDeltaForResolve("event", true, "compromised", cfg)).toBe(3 + 0);
  });

  it("lets the lair raid outrank the event slot it arrives through", () => {
    expect(affinityDeltaForResolve("event", true, "success", cfg)).toBe(3);
  });
});

describe("applyMissionAffinity", () => {
  it("moves one score per unordered pair, not one per minion", () => {
    const r = applyMissionAffinity([], ["a", "b", "c"], 1, cfg);
    expect(r.next).toHaveLength(3);
    expect(r.next.every((p) => p.score === 1)).toBe(true);
    /* Rows are stored sorted, so a pair is never duplicated by lookup order. */
    expect(r.next.map((p) => [p.aInstanceId, p.bInstanceId])).toEqual([
      ["a", "b"],
      ["a", "c"],
      ["b", "c"],
    ]);
  });

  it("stores the pair identically whichever order the participants arrive in", () => {
    const forward = applyMissionAffinity([], ["b", "a"], 1, cfg).next;
    expect(orderPair("b", "a")).toEqual(["a", "b"]);
    expect(forward[0]!.aInstanceId).toBe("a");
    expect(findPairAffinity(forward, "b", "a")?.score).toBe(1);
  });

  it("does nothing for a solo mission", () => {
    expect(applyMissionAffinity([], ["a"], 1, cfg)).toEqual({ next: [], changes: [] });
  });

  it("accumulates across missions and reports only the resolve that crosses a threshold", () => {
    let affinities: MinionPairAffinity[] = [];
    const seen: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const r = applyMissionAffinity(affinities, ["a", "b"], 1, cfg);
      affinities = r.next;
      seen.push(...r.changes.map((c) => `${c.from}->${c.to}`));
    }
    expect(findPairAffinity(affinities, "a", "b")?.score).toBe(3);
    expect(seen).toEqual(["neutral->friend"]);
  });

  it("carries a pair from friends to rivals through a run of failures", () => {
    let affinities = applyMissionAffinity([], ["a", "b"], 3, cfg).next;
    expect(relationshipBetween(affinities, "a", "b")).toBe("friend");
    const changes: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const r = applyMissionAffinity(affinities, ["a", "b"], -1, cfg);
      affinities = r.next;
      changes.push(...r.changes.map((c) => c.to));
    }
    expect(findPairAffinity(affinities, "a", "b")?.score).toBe(-3);
    expect(changes).toEqual(["neutral", "rival"]);
  });
});

describe("syncMinionDynamicTraits", () => {
  it("projects both tracks onto the minions, standings first", () => {
    const roster = [
      makeMinionInstance("mi-1", "m-hero", []),
      makeMinionInstance("mi-2", "m-buddy", []),
    ];
    const affinities = setPairAffinityScore([], "mi-1", "mi-2", 7, cfg);
    const standings = setLocationAffinityScore([], "mi-1", "loc-a", 3);
    const synced = syncMinionDynamicTraits(roster, affinities, standings);
    expect(synced[0]!.dynamicTraits).toEqual([
      { kind: "hero", locationId: "loc-a" },
      { kind: "ally", targetMinionInstanceId: "mi-2" },
    ]);
    expect(synced[1]!.dynamicTraits).toEqual([
      { kind: "ally", targetMinionInstanceId: "mi-1" },
    ]);
  });

  it("emits nothing for a neutral pair and drops bonds to minions off the roster", () => {
    const roster = [makeMinionInstance("mi-1", "m-hero", [])];
    const affinities = setPairAffinityScore([], "mi-1", "mi-gone", 7, cfg);
    expect(syncMinionDynamicTraits(roster, affinities)[0]!.dynamicTraits).toEqual([]);
    const neutral = setPairAffinityScore([], "mi-1", "mi-2", 1, cfg);
    expect(syncMinionDynamicTraits(roster, neutral)[0]!.dynamicTraits).toEqual([]);
  });

  it("replaces a stale projection rather than stacking onto it", () => {
    const roster = [
      makeMinionInstance("mi-1", "m-hero", []),
      makeMinionInstance("mi-2", "m-buddy", []),
    ];
    const friends = setPairAffinityScore([], "mi-1", "mi-2", 3, cfg);
    const once = syncMinionDynamicTraits(roster, friends);
    const allies = setPairAffinityScore(friends, "mi-1", "mi-2", 7, cfg);
    const twice = syncMinionDynamicTraits(once, allies);
    expect(twice[0]!.dynamicTraits).toEqual([{ kind: "ally", targetMinionInstanceId: "mi-2" }]);
  });
});

describe("seedStartingAffinities", () => {
  const starting = (templateId: string) =>
    templateId === "m-buddy"
      ? ([{ kind: "hatred", targetMinionTemplateId: "m-hero" }] as const)
      : undefined;

  it("seeds a designer bond at that relationship's own threshold once both are hired", () => {
    const roster = [
      makeMinionInstance("mi-1", "m-hero", []),
      makeMinionInstance("mi-2", "m-buddy", []),
    ];
    const seeded = seedStartingAffinities([], roster, starting, cfg);
    expect(findPairAffinity(seeded, "mi-1", "mi-2")).toMatchObject({
      score: cfg.hatedThreshold,
      relationship: "hated",
    });
  });

  it("waits for the other half of the pair to join the roster", () => {
    const solo = [makeMinionInstance("mi-2", "m-buddy", [])];
    expect(seedStartingAffinities([], solo, starting, cfg)).toEqual([]);
  });

  it("never overwrites a score the run has already moved", () => {
    const roster = [
      makeMinionInstance("mi-1", "m-hero", []),
      makeMinionInstance("mi-2", "m-buddy", []),
    ];
    const earned = setPairAffinityScore([], "mi-1", "mi-2", 4, cfg);
    const seeded = seedStartingAffinities(earned, roster, starting, cfg);
    expect(findPairAffinity(seeded, "mi-1", "mi-2")?.score).toBe(4);
  });
});

describe("formatRelationshipChange", () => {
  const catalog = fixtureCatalog();
  const roster = [
    makeMinionInstance("mi-1", "m-hero", []),
    makeMinionInstance("mi-2", "m-buddy", []),
  ];
  const line = (from: "neutral" | "friend" | "rival", to: "neutral" | "friend" | "ally" | "rival" | "hated") =>
    formatRelationshipChange(catalog, roster, {
      aInstanceId: "mi-1",
      bInstanceId: "mi-2",
      from,
      to,
    });

  it("names both minions and the band they landed in", () => {
    expect(line("neutral", "friend")).toBe("Operative and Sidekick became Friends.");
    expect(line("friend", "ally")).toBe("Operative and Sidekick became Allies.");
    expect(line("neutral", "rival")).toBe("Operative and Sidekick became Rivals.");
    expect(line("rival", "hated")).toBe("Operative and Sidekick now hate each other.");
  });

  it("says what was lost when a pair falls back to neutral", () => {
    expect(line("friend", "neutral")).toBe("Operative and Sidekick are no longer Friends.");
  });
});

describe("rollStartingTemplateAffinities", () => {
  const templateIds = ["t1", "t2", "t3", "t4", "t5", "t6"]; /* 15 pairs */

  function roll(seed = 1) {
    return rollStartingTemplateAffinities(templateIds, seededRng(seed), cfg);
  }

  it("opens one pair as Friends, without reaching the second threshold", () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const strongPositive = roll(seed).filter((p) => p.score >= cfg.friendThreshold);
      expect(strongPositive).toHaveLength(1);
      expect(strongPositive[0]!.score).toBeLessThan(cfg.allyThreshold);
      expect(nextRelationship(strongPositive[0]!.score, "neutral", cfg)).toBe("friend");
    }
  });

  it("opens one other pair as Rivals, without reaching Hated", () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const strongNegative = roll(seed).filter((p) => p.score <= cfg.rivalThreshold);
      expect(strongNegative).toHaveLength(1);
      expect(strongNegative[0]!.score).toBeGreaterThan(cfg.hatedThreshold);
      expect(nextRelationship(strongNegative[0]!.score, "neutral", cfg)).toBe("rival");
    }
  });

  it("leans half the remaining pairs without crossing any threshold", () => {
    const seeded = roll();
    const lean = seeded.filter(
      (p) => p.score > cfg.rivalThreshold && p.score < cfg.friendThreshold,
    );
    /* 15 pairs − the two strong ones = 13 remaining, half rounded down. */
    expect(lean).toHaveLength(6);
    expect(seeded).toHaveLength(8);
    for (const p of lean) {
      expect(p.score).not.toBe(0);
      expect(nextRelationship(p.score, "neutral", cfg)).toBe("neutral");
    }
  });

  it("never seeds the same pair twice and stores ids sorted", () => {
    const seeded = roll();
    const keys = seeded.map((p) => pairKey(p.aTemplateId, p.bTemplateId));
    expect(new Set(keys).size).toBe(keys.length);
    expect(seeded.every((p) => p.aTemplateId < p.bTemplateId)).toBe(true);
  });

  it("is deterministic for a given seeded rng", () => {
    expect(roll(9)).toEqual(roll(9));
    expect(roll(9)).not.toEqual(roll(10));
  });

  it("degrades quietly when the catalog is too small to fill every role", () => {
    expect(rollStartingTemplateAffinities([], seededRng(1), cfg)).toEqual([]);
    expect(rollStartingTemplateAffinities(["only"], seededRng(1), cfg)).toEqual([]);
    /* One pair available: it takes the positive role and there is nothing left for the rest. */
    const single = rollStartingTemplateAffinities(["a", "b"], seededRng(1), cfg);
    expect(single).toHaveLength(1);
    expect(single[0]!.score).toBeGreaterThanOrEqual(cfg.friendThreshold);
  });
});

describe("applyTemplatePairSeeds", () => {
  const seeds = [{ aTemplateId: "m-hero", bTemplateId: "m-buddy", score: 4 }];

  it("waits for both minions and then lands the seed on the instance pair", () => {
    const solo = [makeMinionInstance("mi-1", "m-hero", [])];
    expect(applyTemplatePairSeeds([], solo, seeds, cfg)).toEqual([]);

    const both = [...solo, makeMinionInstance("mi-2", "m-buddy", [])];
    expect(applyTemplatePairSeeds([], both, seeds, cfg)).toEqual([
      { aInstanceId: "mi-1", bInstanceId: "mi-2", score: 4, relationship: "friend" },
    ]);
  });

  it("leaves a pair the run has already moved alone", () => {
    const both = [
      makeMinionInstance("mi-1", "m-hero", []),
      makeMinionInstance("mi-2", "m-buddy", []),
    ];
    const earned = setPairAffinityScore([], "mi-1", "mi-2", -1, cfg);
    expect(applyTemplatePairSeeds(earned, both, seeds, cfg)).toEqual(earned);
  });

  it("ignores pairs the roll left flat", () => {
    const both = [
      makeMinionInstance("mi-1", "m-hero", []),
      makeMinionInstance("mi-2", "m-buddy", []),
    ];
    expect(applyTemplatePairSeeds([], both, [], cfg)).toEqual([]);
  });
});

const locCfg: LocationAffinityConfig = DEFAULT_BALANCE.locationAffinity;

describe("nextStanding", () => {
  it("crosses into Hero and Wanted at the thresholds", () => {
    expect(nextStanding(2, "neutral", locCfg)).toBe("neutral");
    expect(nextStanding(3, "neutral", locCfg)).toBe("hero");
    expect(nextStanding(-2, "neutral", locCfg)).toBe("neutral");
    expect(nextStanding(-3, "neutral", locCfg)).toBe("wanted");
  });

  it("holds a standing until the score falls a full hysteresis back", () => {
    expect(nextStanding(1, "hero", locCfg)).toBe("hero");
    expect(nextStanding(0, "hero", locCfg)).toBe("neutral");
    expect(nextStanding(-1, "wanted", locCfg)).toBe("wanted");
    expect(nextStanding(0, "wanted", locCfg)).toBe("neutral");
  });

  it("does not flip-flop when the score oscillates across a threshold", () => {
    let st = nextStanding(3, "neutral", locCfg);
    expect(st).toBe("hero");
    for (const score of [2, 3, 2, 3, 2]) {
      st = nextStanding(score, st, locCfg);
      expect(st).toBe("hero");
    }
  });

  it("flips straight from Hero to Wanted when a score swings far enough", () => {
    expect(nextStanding(-3, "hero", locCfg)).toBe("wanted");
  });
});

describe("applyLocationAffinity", () => {
  it("moves every participant's own score at the mission's site", () => {
    const r = applyLocationAffinity([], ["a", "b"], "loc-a", 1, locCfg);
    expect(r.next).toEqual([
      { minionInstanceId: "a", locationId: "loc-a", score: 1, standing: "neutral" },
      { minionInstanceId: "b", locationId: "loc-a", score: 1, standing: "neutral" },
    ]);
    expect(r.changes).toEqual([]);
  });

  it("changes nothing for a mission with no site", () => {
    expect(applyLocationAffinity([], ["a"], null, 1, locCfg)).toEqual({ next: [], changes: [] });
  });

  it("keeps each location's score separate for the same minion", () => {
    let affinities = applyLocationAffinity([], ["a"], "loc-a", 1, locCfg).next;
    affinities = applyLocationAffinity(affinities, ["a"], "loc-b", -1, locCfg).next;
    expect(findLocationAffinity(affinities, "a", "loc-a")?.score).toBe(1);
    expect(findLocationAffinity(affinities, "a", "loc-b")?.score).toBe(-1);
  });

  it("reports the crossing only on the resolve that reaches it", () => {
    let affinities: MinionLocationAffinity[] = [];
    const seen: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const r = applyLocationAffinity(affinities, ["a"], "loc-a", 1, locCfg);
      affinities = r.next;
      seen.push(...r.changes.map((c) => `${c.from}->${c.to}`));
    }
    expect(standingAt(affinities, "a", "loc-a")).toBe("hero");
    expect(seen).toEqual(["neutral->hero"]);
  });

  it("carries a minion from Hero to Wanted through a run of failures at that site", () => {
    let affinities = applyLocationAffinity([], ["a"], "loc-a", 3, locCfg).next;
    expect(standingAt(affinities, "a", "loc-a")).toBe("hero");
    const seen: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const r = applyLocationAffinity(affinities, ["a"], "loc-a", -1, locCfg);
      affinities = r.next;
      seen.push(...r.changes.map((c) => c.to));
    }
    expect(findLocationAffinity(affinities, "a", "loc-a")?.score).toBe(-3);
    expect(seen).toEqual(["neutral", "wanted"]);
  });
});

describe("rollStartingTemplateLocationAffinities", () => {
  const templateIds = ["t1", "t2", "t3"];
  const locationIds = ["l1", "l2", "l3", "l4"]; /* 12 slots */

  function roll(seed = 1) {
    return rollStartingTemplateLocationAffinities(
      templateIds,
      locationIds,
      seededRng(seed),
      locCfg,
    );
  }

  it("opens exactly one Hero slot and one Wanted slot", () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const seeded = roll(seed);
      const heroes = seeded.filter((x) => x.score >= locCfg.heroThreshold);
      const wanted = seeded.filter((x) => x.score <= locCfg.wantedThreshold);
      expect(heroes).toHaveLength(1);
      expect(wanted).toHaveLength(1);
      expect(nextStanding(heroes[0]!.score, "neutral", locCfg)).toBe("hero");
      expect(nextStanding(wanted[0]!.score, "neutral", locCfg)).toBe("wanted");
    }
  });

  it("leans half the remaining slots without crossing a threshold", () => {
    const seeded = roll();
    const lean = seeded.filter(
      (x) => x.score > locCfg.wantedThreshold && x.score < locCfg.heroThreshold,
    );
    /* 12 slots minus the two strong ones = 10 remaining, half rounded down. */
    expect(lean).toHaveLength(5);
    expect(seeded).toHaveLength(7);
    for (const x of lean) {
      expect(x.score).not.toBe(0);
      expect(nextStanding(x.score, "neutral", locCfg)).toBe("neutral");
    }
  });

  it("never seeds the same slot twice and is deterministic per seed", () => {
    const seeded = roll(6);
    const keys = seeded.map((x) => `${x.minionTemplateId}@${x.locationId}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(roll(6)).toEqual(seeded);
    expect(roll(7)).not.toEqual(seeded);
  });

  it("degrades quietly with nothing to pair up", () => {
    expect(rollStartingTemplateLocationAffinities([], ["l1"], seededRng(1), locCfg)).toEqual([]);
    expect(rollStartingTemplateLocationAffinities(["t1"], [], seededRng(1), locCfg)).toEqual([]);
  });
});

describe("seedStartingLocationAffinities", () => {
  const starting = (templateId: string) =>
    templateId === "m-hero"
      ? ([
          { kind: "wanted", locationId: "loc-a" },
          { kind: "friend", targetMinionTemplateId: "m-buddy" },
        ] as const)
      : undefined;
  const roster = [makeMinionInstance("mi-1", "m-hero", [])];

  it("seeds a designer standing at that band's own threshold, with nobody else needed", () => {
    expect(seedStartingLocationAffinities([], roster, starting, locCfg)).toEqual([
      {
        minionInstanceId: "mi-1",
        locationId: "loc-a",
        score: locCfg.wantedThreshold,
        standing: "wanted",
      },
    ]);
  });

  it("ignores the bond entries, which belong to the pair track", () => {
    const seeded = seedStartingLocationAffinities([], roster, starting, locCfg);
    expect(seeded).toHaveLength(1);
  });

  it("never overwrites a score the run has already moved", () => {
    const earned = setLocationAffinityScore([], "mi-1", "loc-a", 3, locCfg);
    expect(seedStartingLocationAffinities(earned, roster, starting, locCfg)).toEqual(earned);
  });
});

describe("applyTemplateLocationSeeds", () => {
  const seeds = [{ minionTemplateId: "m-hero", locationId: "loc-a", score: 3 }];

  it("lands on the minion as soon as they are hired — no second party needed", () => {
    const roster = [makeMinionInstance("mi-1", "m-hero", [])];
    expect(applyTemplateLocationSeeds([], roster, seeds, locCfg)).toEqual([
      { minionInstanceId: "mi-1", locationId: "loc-a", score: 3, standing: "hero" },
    ]);
  });

  it("leaves a site the minion already has history at alone", () => {
    const roster = [makeMinionInstance("mi-1", "m-hero", [])];
    const earned = setLocationAffinityScore([], "mi-1", "loc-a", -1, locCfg);
    expect(applyTemplateLocationSeeds(earned, roster, seeds, locCfg)).toEqual(earned);
  });

  it("ignores minions of other templates", () => {
    const roster = [makeMinionInstance("mi-2", "m-buddy", [])];
    expect(applyTemplateLocationSeeds([], roster, seeds, locCfg)).toEqual([]);
  });
});

describe("formatStandingChange", () => {
  const standingCatalog = fixtureCatalog();
  const standingRoster = [makeMinionInstance("mi-1", "m-hero", [])];
  const locName =
    standingCatalog.locations.find((l) => l.id === "loc-a")?.name ?? "loc-a";
  const line = (from: MinionLocationStanding, to: MinionLocationStanding) =>
    formatStandingChange(standingCatalog, standingRoster, {
      minionInstanceId: "mi-1",
      locationId: "loc-a",
      from,
      to,
    });

  it("names the minion, the site, and the standing", () => {
    expect(line("neutral", "hero")).toBe(`Operative gained Allies in ${locName}.`);
    expect(line("neutral", "wanted")).toBe(`Operative became Wanted in ${locName}.`);
  });

  it("says which standing was lost when it lapses", () => {
    expect(line("hero", "neutral")).toBe(`Operative no longer has Allies in ${locName}.`);
    expect(line("wanted", "neutral")).toBe(`Operative is no longer Wanted in ${locName}.`);
  });
});
