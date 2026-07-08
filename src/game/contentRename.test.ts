import { describe, expect, it } from "vitest";
import { applyIdRenameRaw } from "./contentRename";
import { parseContentCatalog } from "./contentSchema";
import { rawFixtureSlices } from "./testFixtures";

describe("applyIdRenameRaw", () => {
  it("renames a trait id everywhere and the result still validates", () => {
    const raw = rawFixtureSlices();
    const renamed = applyIdRenameRaw(raw, "traits", "t-req", "t-main");
    const { catalog, issues } = parseContentCatalog(renamed);
    expect(issues).toEqual([]);
    expect(catalog?.traits.map((t) => t.id)).toContain("t-main");
    expect(catalog?.minions.find((m) => m.id === "m-hero")?.startingTraitIds).toEqual(["t-main"]);
    expect(catalog?.missions.find((m) => m.id === "ms-basic")?.requiredTraitIds).toEqual([
      "t-main",
    ]);
  });

  it("renames a mission id in omega plans, lairs, and unlock effects", () => {
    const raw = rawFixtureSlices();
    raw.missions[0]!.onSuccessEffects = [
      { kind: "unlock_lair_mission", missionId: "ms-asset" },
    ];
    const renamed = applyIdRenameRaw(raw, "missions", "ms-asset", "ms-fence");
    const { catalog, issues } = parseContentCatalog(renamed);
    expect(issues).toEqual([]);
    expect(catalog?.lairs[0]?.availableMissionIds).toEqual(["ms-basic", "ms-fence"]);
    const unlock = catalog?.missions
      .find((m) => m.id === "ms-basic")
      ?.onSuccessEffects?.find((e) => e.kind === "unlock_lair_mission");
    expect(unlock && "missionId" in unlock ? unlock.missionId : null).toBe("ms-fence");

    const renamedBasic = applyIdRenameRaw(raw, "missions", "ms-basic", "ms-case");
    const parsed = parseContentCatalog(renamedBasic);
    expect(parsed.catalog?.omegaPlans[0]?.stages[0].missionIds).toEqual([
      "ms-case",
      "ms-case",
      "ms-case",
    ]);
  });

  it("renames asset ids in requirements, effects, and lair startingAssets keys", () => {
    const raw = rawFixtureSlices();
    raw.lairs[0]!.startingAssets = { "as-car": 2 };
    raw.missions[0]!.onSuccessEffects = [
      { kind: "gain_assets", assetIds: ["as-car", "as-cash"] },
    ];
    const renamed = applyIdRenameRaw(raw, "assets", "as-car", "as-van");
    const { catalog, issues } = parseContentCatalog(renamed);
    expect(issues).toEqual([]);
    expect(catalog?.missions.find((m) => m.id === "ms-asset")?.requiredAssetIds).toEqual([
      "as-van",
      "as-gun",
    ]);
    expect(catalog?.lairs[0]?.startingAssets).toEqual({ "as-van": 2 });
    const gain = catalog?.missions
      .find((m) => m.id === "ms-basic")
      ?.onSuccessEffects?.find((e) => e.kind === "gain_assets");
    expect(gain && "assetIds" in gain ? gain.assetIds : null).toEqual(["as-van", "as-cash"]);
  });

  it("renames location and minion-template ids inside startingDynamicTraits", () => {
    const raw = rawFixtureSlices();
    raw.minions[0]!.startingDynamicTraits = [
      { kind: "hero", locationId: "loc-a" },
      { kind: "friend", targetMinionTemplateId: "m-buddy" },
    ];
    const afterLoc = applyIdRenameRaw(raw, "locations", "loc-a", "loc-bank");
    const locParsed = parseContentCatalog(afterLoc);
    expect(locParsed.issues).toEqual([]);
    expect(locParsed.catalog?.maps[0]?.locationIds).toEqual(["loc-bank", "loc-b"]);

    const afterMinion = applyIdRenameRaw(raw, "minions", "m-buddy", "m-pal");
    const minParsed = parseContentCatalog(afterMinion);
    expect(minParsed.issues).toEqual([]);
    const hero = minParsed.catalog?.minions.find((m) => m.id === "m-hero");
    expect(
      hero?.startingDynamicTraits?.some(
        (dt) => "targetMinionTemplateId" in dt && dt.targetMinionTemplateId === "m-pal",
      ),
    ).toBe(true);
  });

  it("renames a map id in omega plans", () => {
    const renamed = applyIdRenameRaw(rawFixtureSlices(), "maps", "map-1", "map-city");
    const { catalog, issues } = parseContentCatalog(renamed);
    expect(issues).toEqual([]);
    expect(catalog?.omegaPlans[0]?.mapId).toBe("map-city");
  });

  it("does not mutate the input and no-ops on non-renamable slices", () => {
    const raw = rawFixtureSlices();
    const before = JSON.stringify(raw);
    applyIdRenameRaw(raw, "traits", "t-req", "t-x");
    expect(JSON.stringify(raw)).toBe(before);
    const noop = applyIdRenameRaw(raw, "organizationNames", "a", "b");
    expect(JSON.stringify(noop)).toBe(before);
  });
});
