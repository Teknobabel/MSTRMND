import { describe, expect, it } from "vitest";
import type { MissionTemplate, Trait } from "./types";
import { computeSuccessChanceBreakdown, successChancePercent } from "./mission";
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
