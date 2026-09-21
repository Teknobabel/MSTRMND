import { describe, expect, it } from "vitest";
import { directivesAssetNeeds, directivesSkillNeeds, directivesTaskDone } from "./tutorialDirectives";

describe("directivesAssetNeeds", () => {
  it("lights a row the player's stock covers and leaves the rest dark", () => {
    expect(directivesAssetNeeds(["forged_papers", "breach_kit"], { forged_papers: 1 })).toEqual([
      { assetId: "forged_papers", unit: 1, met: true },
      { assetId: "breach_kit", unit: 1, met: false },
    ]);
  });

  it("counts duplicate ids off as separate units rather than deduplicating them", () => {
    /* Two crates wanted, one held: the first row is covered and the second is not. */
    expect(directivesAssetNeeds(["breach_kit", "breach_kit"], { breach_kit: 1 })).toEqual([
      { assetId: "breach_kit", unit: 1, met: true },
      { assetId: "breach_kit", unit: 2, met: false },
    ]);
    expect(
      directivesAssetNeeds(["breach_kit", "breach_kit"], { breach_kit: 2 }).every((n) => n.met),
    ).toBe(true);
  });

  it("reads an asset the player has never held as missing rather than throwing", () => {
    expect(directivesAssetNeeds(["ghost_protocol_kit"], {})).toEqual([
      { assetId: "ghost_protocol_kit", unit: 1, met: false },
    ]);
  });

  it("has nothing to say about a mission that needs no assets", () => {
    expect(directivesAssetNeeds([], { breach_kit: 4 })).toEqual([]);
  });
});

describe("directivesSkillNeeds", () => {
  it("counts a trait as covered once anyone on the roster holds it", () => {
    expect(directivesSkillNeeds(["infiltration", "demolitions"], new Set(["infiltration"]))).toEqual([
      { traitId: "infiltration", met: true },
      { traitId: "demolitions", met: false },
    ]);
  });

  it("asks only whether the trait is on the roster, so a second holder changes nothing", () => {
    const held = new Set(["infiltration"]);
    expect(directivesSkillNeeds(["infiltration", "infiltration"], held)).toEqual([
      { traitId: "infiltration", met: true },
      { traitId: "infiltration", met: true },
    ]);
  });
});

describe("directivesTaskDone", () => {
  const section = (done: boolean): { done: boolean } => ({ done });

  it("is done only when every mission under it is covered", () => {
    expect(directivesTaskDone([section(true), section(true), section(true)])).toBe(true);
  });

  it("is not done while any one mission is still short", () => {
    // The tick reads the line the player is looking at, not the phase's own pass mark: a phase
    // that only needs one of its three missions still shows two unticked sub-sections here.
    expect(directivesTaskDone([section(true), section(false), section(false)])).toBe(false);
    expect(directivesTaskDone([section(true), section(true), section(false)])).toBe(false);
  });

  it("is not done when nothing is listed under it", () => {
    // Nothing is being asked for, but nothing has been covered either.
    expect(directivesTaskDone([])).toBe(false);
  });

  it("is not done when no mission is covered", () => {
    expect(directivesTaskDone([section(false), section(false)])).toBe(false);
  });
});
