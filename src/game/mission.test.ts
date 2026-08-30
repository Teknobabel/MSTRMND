import { describe, expect, it } from "vitest";
import type { MissionTemplate, Trait } from "./types";
import {
  computeSuccessChanceBreakdown,
  missionOutcomeChances,
  missionResultForRoll,
  missionResultHasFallout,
  missionResultIsCompletion,
  successChancePercent,
} from "./mission";
import { makeMinionInstance } from "./testFixtures";

function template(overrides: Partial<MissionTemplate>): MissionTemplate {
  return {
    id: "ms-x",
    name: "Test Mission",
    description: "",
    targetType: "location",
    startCommandPoints: 1,
    requiredTraitIds: [],
    requiredAssetIds: [],
    durationTurns: 1,
    ...overrides,
  };
}

const traitsCatalog: Trait[] = [
  { id: "t-a", name: "A", type: "primary" },
  { id: "t-b", name: "B", type: "secondary" },
  { id: "t-pos", name: "Pos", type: "status_positive" },
  { id: "t-neg", name: "Neg", type: "status_negative" },
];

describe("successChancePercent", () => {
  it("computes the linear base % from matched traits over the participant union", () => {
    const t = template({ requiredTraitIds: ["t-a", "t-b"] });
    const p1 = makeMinionInstance("i1", "m1", ["t-a"]);
    const p2 = makeMinionInstance("i2", "m2", ["t-b"]);
    expect(successChancePercent(t, [p1])).toBe(50);
    expect(successChancePercent(t, [p1, p2])).toBe(100);
  });

  it("returns 100 when there are no requirements at all (events may be requirement-free)", () => {
    expect(successChancePercent(template({}), [makeMinionInstance("i1", "m1", [])])).toBe(100);
  });

  it("merges additionalRequiredTraitIds into the denominator, deduped against the template", () => {
    const t = template({ requiredTraitIds: ["t-a"] });
    const p = makeMinionInstance("i1", "m1", ["t-a"]);
    expect(
      successChancePercent(t, [p], { additionalRequiredTraitIds: ["t-b", "t-a"] }),
    ).toBe(50);
  });

  it("counts asset slots from assignedAssetIds when lengths match, else from playerAssets", () => {
    const t = template({ requiredAssetIds: ["as-1", "as-1", "as-2"] });
    const p = makeMinionInstance("i1", "m1", []);
    expect(
      successChancePercent(t, [p], { assignedAssetIds: ["as-1", null, "as-2"] }),
    ).toBe(67);
    /* Length mismatch falls back to inventory matching. */
    expect(
      successChancePercent(t, [p], {
        assignedAssetIds: ["as-1"],
        playerAssets: { "as-1": 1, "as-2": 5 },
      }),
    ).toBe(67);
  });

  it("applies +10 per status_positive and −20 per status_negative occurrence", () => {
    const t = template({ requiredTraitIds: ["t-a"] });
    const p = makeMinionInstance("i1", "m1", ["t-a", "t-pos", "t-neg"]);
    expect(successChancePercent(t, [p], { traitsCatalog })).toBe(90);
  });

  it("applies dynamic, event, and challenge-trait modifiers then clamps to [0, 100]", () => {
    const t = template({ requiredTraitIds: ["t-a"] });
    const p = makeMinionInstance("i1", "m1", ["t-a"]);
    expect(
      successChancePercent(t, [p], {
        dynamicTraitDelta: 10,
        eventSuccessModifierDelta: 15,
        challengeTraitIds: ["t-x"],
      }),
    ).toBe(100); /* 100 + 10 + 15 − 20 = 105 → clamp 100 */
    expect(
      successChancePercent(t, [p], {
        challengeTraitIds: ["t-x", "t-y", "t-z", "t-w", "t-v", "t-u"],
      }),
    ).toBe(0); /* 100 − 120 → clamp 0 */
  });

  it("charges each challenge trait once and never for one a participant holds", () => {
    const t = template({ requiredTraitIds: ["t-a"] });
    const p = makeMinionInstance("i1", "m1", ["t-a", "t-x"]);
    /* Duplicates collapse: two agents bringing the same challenge cost one penalty. */
    expect(
      successChancePercent(t, [p], { challengeTraitIds: ["t-y", "t-y"] }),
    ).toBe(80);
    /* Held by a participant → no penalty, and no base-chance credit either. */
    expect(successChancePercent(t, [p], { challengeTraitIds: ["t-x"] })).toBe(100);
  });

  it("keeps challenge traits out of the required-trait ratio", () => {
    const t = template({ requiredTraitIds: ["t-a", "t-b"] });
    const p = makeMinionInstance("i1", "m1", ["t-a", "t-x"]);
    const b = computeSuccessChanceBreakdown(t, [p], { challengeTraitIds: ["t-x"] });
    expect(b.requiredTraitCount).toBe(2);
    expect(b.matchedTraits).toBe(1);
    expect(b.basePercent).toBe(50);
    expect(b.challengeTraitPenaltyTotal).toBe(0);
  });

  it("exposes the same numbers in the breakdown used by the UI tooltip", () => {
    const t = template({ requiredTraitIds: ["t-a", "t-b"] });
    const p = makeMinionInstance("i1", "m1", ["t-a", "t-neg"]);
    const b = computeSuccessChanceBreakdown(t, [p], {
      traitsCatalog,
      challengeTraitIds: ["t-chal"],
    });
    expect(b.basePercent).toBe(50);
    expect(b.matchedTraits).toBe(1);
    expect(b.missingTraitIds).toEqual(["t-b"]);
    expect(b.statusDelta).toBe(-20);
    expect(b.challengeTraitIds).toEqual(["t-chal"]);
    expect(b.unmatchedChallengeTraitIds).toEqual(["t-chal"]);
    expect(b.challengeTraitPenaltyTotal).toBe(20);
    expect(b.preClampPercent).toBe(10);
    expect(b.finalPercent).toBe(10);
  });
});

describe("mission outcomes", () => {
  describe("missionResultForRoll", () => {
    it("reads the roll as success below the chance and compromised in the band above it", () => {
      /* 60% chance, 10-point band → 0-59 success, 60-69 compromised, 70-99 failure. */
      expect(missionResultForRoll(0, 60, 10)).toBe("success");
      expect(missionResultForRoll(59, 60, 10)).toBe("success");
      expect(missionResultForRoll(60, 60, 10)).toBe("compromised");
      expect(missionResultForRoll(69, 60, 10)).toBe("compromised");
      expect(missionResultForRoll(70, 60, 10)).toBe("failure");
      expect(missionResultForRoll(99, 60, 10)).toBe("failure");
    });

    it("keeps the band at the extremes: a hopeless plan can still come back compromised", () => {
      expect(missionResultForRoll(0, 0, 10)).toBe("compromised");
      expect(missionResultForRoll(9, 0, 10)).toBe("compromised");
      expect(missionResultForRoll(10, 0, 10)).toBe("failure");
      /* At 100% nothing is left to miss. */
      expect(missionResultForRoll(99, 100, 10)).toBe("success");
    });

    it("collapses to a plain success / failure split at a band of 0", () => {
      expect(missionResultForRoll(60, 60, 0)).toBe("failure");
      expect(missionResultForRoll(59, 60, 0)).toBe("success");
    });
  });

  describe("missionOutcomeChances", () => {
    it("splits a chance into three odds that sum to 100", () => {
      expect(missionOutcomeChances(60, 10)).toEqual({
        successPercent: 60,
        compromisedPercent: 10,
        failurePercent: 30,
      });
      expect(missionOutcomeChances(0, 10)).toEqual({
        successPercent: 0,
        compromisedPercent: 10,
        failurePercent: 90,
      });
    });

    it("clips the band at the 100% ceiling rather than going negative", () => {
      expect(missionOutcomeChances(95, 10)).toEqual({
        successPercent: 95,
        compromisedPercent: 5,
        failurePercent: 0,
      });
      expect(missionOutcomeChances(100, 10)).toEqual({
        successPercent: 100,
        compromisedPercent: 0,
        failurePercent: 0,
      });
    });

    it("matches missionResultForRoll over every roll", () => {
      for (const chance of [0, 1, 37, 60, 95, 100]) {
        const odds = missionOutcomeChances(chance, 10);
        const tally = { success: 0, compromised: 0, failure: 0 };
        for (let roll = 0; roll < 100; roll += 1) {
          tally[missionResultForRoll(roll, chance, 10)] += 1;
        }
        expect(tally.success, `chance ${chance}`).toBe(odds.successPercent);
        expect(tally.compromised, `chance ${chance}`).toBe(odds.compromisedPercent);
        expect(tally.failure, `chance ${chance}`).toBe(odds.failurePercent);
      }
    });
  });

  it("counts a compromise as both a completion and a source of fallout", () => {
    expect(missionResultIsCompletion("compromised")).toBe(true);
    expect(missionResultHasFallout("compromised")).toBe(true);
    expect(missionResultIsCompletion("failure")).toBe(false);
    expect(missionResultHasFallout("success")).toBe(false);
  });
});
