import { describe, expect, it } from "vitest";
import { collectContentReferences, referencesTo, unreferencedIds } from "./contentRefs";
import { loadContent } from "./loadContent";
import { fixtureCatalog } from "./testFixtures";

describe("collectContentReferences", () => {
  const catalog = fixtureCatalog();
  const refs = collectContentReferences(catalog);

  it("captures references from every slice that holds ids", () => {
    expect(refs).toContainEqual({
      fromSlice: "minions",
      fromId: "m-hero",
      path: "startingTraitIds[0]",
      toSlice: "traits",
      toId: "t-req",
    });
    expect(refs).toContainEqual({
      fromSlice: "missions",
      fromId: "ms-asset",
      path: "requiredAssetIds[1]",
      toSlice: "assets",
      toId: "as-gun",
    });
    expect(refs).toContainEqual({
      fromSlice: "omegaPlans",
      fromId: "op-1",
      path: "mapId",
      toSlice: "maps",
      toId: "map-1",
    });
    expect(refs).toContainEqual({
      fromSlice: "lairs",
      fromId: "lair-1",
      path: "availableMissionIds[1]",
      toSlice: "missions",
      toId: "ms-asset",
    });
    expect(refs).toContainEqual({
      fromSlice: "maps",
      fromId: "map-1",
      path: "locationIds[1]",
      toSlice: "locations",
      toId: "loc-b",
    });
  });

  it("answers 'who uses this entity?' for delete-impact checks", () => {
    const users = referencesTo(refs, "traits", "t-req");
    const fromIds = users.map((r) => `${r.fromSlice}:${r.fromId}`);
    expect(fromIds).toContain("minions:m-hero");
    expect(fromIds).toContain("missions:ms-basic");
  });

  it("finds unreferenced (dead) content candidates", () => {
    expect(unreferencedIds(catalog, refs, "assets")).toEqual(["as-cash"]);
    /* t-sec is only rolled at runtime (site security), so no catalog entity references it. */
    expect(unreferencedIds(catalog, refs, "traits")).toEqual(["t-sec", "t-pos", "t-neg"]);
  });

  it("resolves every reference in the real content catalog", () => {
    const real = loadContent();
    const realRefs = collectContentReferences(real);
    const idsBySlice = {
      traits: new Set(real.traits.map((t) => t.id)),
      minions: new Set(real.minions.map((m) => m.id)),
      agents: new Set(real.agents.map((a) => a.id)),
      missions: new Set(real.missions.map((m) => m.id)),
      locations: new Set(real.locations.map((l) => l.id)),
      maps: new Set(real.maps.map((m) => m.id)),
      assets: new Set(real.assets.map((a) => a.id)),
      omegaPlans: new Set(real.omegaPlans.map((p) => p.id)),
      lairs: new Set(real.lairs.map((l) => l.id)),
      events: new Set(real.events.map((e) => e.id)),
      organizationNames: new Set<string>(),
      playerProfiles: new Set<string>(),
      wantedLevels: new Set<string>(),
    };
    for (const ref of realRefs) {
      expect(
        idsBySlice[ref.toSlice].has(ref.toId),
        `${ref.fromSlice}:${ref.fromId} ${ref.path} → ${ref.toSlice}:${ref.toId}`,
      ).toBe(true);
    }
    expect(realRefs.length).toBeGreaterThan(0);
  });
});
