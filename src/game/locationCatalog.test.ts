import { describe, expect, it } from "vitest";
import { rollLocationRequiredTraits, rollLocationSecurityTraits } from "./locationCatalog";
import { parseCatalog } from "./contentSchema";
import { rawFixtureSlices } from "./testFixtures";
import type { ContentCatalog, LocationTemplate } from "./types";

/** Every location at level 3, so each roll asks the pool for as many picks as it can give. */
function level3Locations(catalog: ContentCatalog): LocationTemplate[] {
  return catalog.locations.map((l) => ({ ...l, locationLevel: 3 as const }));
}

function catalogWithDynamicTraits(): ContentCatalog {
  const raw = rawFixtureSlices();
  raw.traits.push(
    { id: "ally", name: "Ally", type: "dynamic" },
    { id: "wanted", name: "Wanted", type: "dynamic" },
  );
  return parseCatalog(raw);
}

describe("location trait rolls", () => {
  it("never rolls a status or art-only dynamic trait as a site requirement", () => {
    const catalog = catalogWithDynamicTraits();
    const locations = level3Locations(catalog);
    const rolled = Object.values(rollLocationRequiredTraits(catalog, locations, Math.random)).flat();
    expect(rolled.length).toBeGreaterThan(0);
    for (const id of rolled) {
      expect(["t-req", "t-sec", "t-level"]).toContain(id);
    }
  });

  it("never rolls a status or art-only dynamic trait as site security", () => {
    const catalog = catalogWithDynamicTraits();
    const locations = level3Locations(catalog);
    const rolled = Object.values(rollLocationSecurityTraits(catalog, locations, Math.random)).flat();
    expect(rolled.length).toBeGreaterThan(0);
    for (const id of rolled) {
      expect(["t-req", "t-sec", "t-level"]).toContain(id);
    }
  });
});
