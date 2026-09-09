import { describe, expect, it } from "vitest";
import { omegaPhaseTargetsByLocation } from "./omegaTargets";
import type { MissionTargetSite } from "../../game/mission";
import type { LocationTemplate, MissionTemplate, MissionTargetType } from "../../game/types";

function site(
  id: string,
  over: Partial<LocationTemplate> & { intelLevel?: 0 | 1 | 2 | 3; securityLevel?: 0 | 1 | 2 | 3 } = {},
): MissionTargetSite {
  const { intelLevel = 0, securityLevel = 0, ...location } = over;
  return {
    location: {
      id,
      name: id,
      description: "",
      locationType: "economic",
      locationLevel: 2,
      ...location,
    },
    intelLevel,
    securityLevel,
  };
}

function mission(
  id: string,
  over: Partial<MissionTemplate> & { targetType?: MissionTargetType } = {},
): MissionTemplate {
  return {
    id,
    name: id,
    description: "",
    startCommandPoints: 1,
    requiredTraitIds: ["stealth"],
    requiredAssetIds: [],
    durationTurns: 1,
    targetType: "location",
    ...over,
  };
}

const SITES = [
  site("bank", { locationType: "economic", locationLevel: 2 }),
  site("citadel", { locationType: "military", locationLevel: 3, securityLevel: 2 }),
  site("senate", { locationType: "political", locationLevel: 1, intelLevel: 2 }),
];

describe("omegaPhaseTargetsByLocation", () => {
  it("flags every site an unfiltered mission could be aimed at", () => {
    const targets = omegaPhaseTargetsByLocation({ missions: [mission("m1")], sites: SITES });
    expect([...targets.keys()].sort()).toEqual(["bank", "citadel", "senate"]);
    expect(targets.get("bank")).toEqual(["m1"]);
  });

  it("honours the category filter", () => {
    const targets = omegaPhaseTargetsByLocation({
      missions: [mission("m1", { targetLocationTypes: ["military"] })],
      sites: SITES,
    });
    expect([...targets.keys()]).toEqual(["citadel"]);
  });

  it("honours a site pinned by id", () => {
    const targets = omegaPhaseTargetsByLocation({
      missions: [mission("m1", { targetLocationIds: ["senate"] })],
      sites: SITES,
    });
    expect([...targets.keys()]).toEqual(["senate"]);
  });

  it("reads intel and security from run state, not the catalog", () => {
    // The same phase flags different pins as surveillance and heat move during a run.
    const needsIntel = omegaPhaseTargetsByLocation({
      missions: [mission("m1", { targetLocationIntelLevels: [2] })],
      sites: SITES,
    });
    expect([...needsIntel.keys()]).toEqual(["senate"]);

    const needsSecurity = omegaPhaseTargetsByLocation({
      missions: [mission("m1", { targetLocationSecurityLevels: [2] })],
      sites: SITES,
    });
    expect([...needsSecurity.keys()]).toEqual(["citadel"]);
  });

  it("ANDs the filters together", () => {
    const targets = omegaPhaseTargetsByLocation({
      missions: [
        mission("m1", { targetLocationTypes: ["military"], targetLocationLevels: [1] }),
      ],
      sites: SITES,
    });
    expect(targets.size).toBe(0);
  });

  it("skips missions whose target never resolves to a site", () => {
    // Site filters are inert on these; reading them would flag the whole map.
    const targets = omegaPhaseTargetsByLocation({
      missions: [mission("m1", { targetType: "minion" }), mission("m2", { targetType: "none" })],
      sites: SITES,
    });
    expect(targets.size).toBe(0);
  });

  it("counts asset-targeted missions as site targets", () => {
    const targets = omegaPhaseTargetsByLocation({
      missions: [mission("m1", { targetType: "asset_hidden", targetLocationIds: ["bank"] })],
      sites: SITES,
    });
    expect([...targets.keys()]).toEqual(["bank"]);
  });

  it("lists every mission that wants a site, once each, in phase order", () => {
    const targets = omegaPhaseTargetsByLocation({
      missions: [
        mission("m1", { targetLocationTypes: ["economic"] }),
        mission("m2", { targetLocationIds: ["bank", "citadel"] }),
        mission("m2", { targetLocationIds: ["bank"] }),
      ],
      sites: SITES,
    });
    expect(targets.get("bank")).toEqual(["m1", "m2"]);
    expect(targets.get("citadel")).toEqual(["m2"]);
  });

  it("says nothing about a phase with no missions left", () => {
    expect(omegaPhaseTargetsByLocation({ missions: [], sites: SITES }).size).toBe(0);
  });
});
