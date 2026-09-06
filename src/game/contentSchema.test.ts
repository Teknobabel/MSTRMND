import { describe, expect, it } from "vitest";
import {
  CONTENT_MANIFEST,
  CONTENT_SLICE_KEYS,
  ContentValidationError,
  parseCatalog,
  parseContentCatalog,
} from "./contentSchema";
import { rawFixtureSlices } from "./testFixtures";

describe("content manifest", () => {
  it("covers every slice key exactly once", () => {
    expect(CONTENT_MANIFEST.map((e) => e.key)).toEqual([...CONTENT_SLICE_KEYS]);
    expect(new Set(CONTENT_MANIFEST.map((e) => e.fileName)).size).toBe(CONTENT_MANIFEST.length);
  });
});

describe("parseContentCatalog", () => {
  it("parses a valid fixture with zero issues", () => {
    const { catalog, issues } = parseContentCatalog(rawFixtureSlices());
    expect(issues).toEqual([]);
    expect(catalog).not.toBeNull();
    expect(catalog?.minions.map((m) => m.id)).toEqual(["m-hero", "m-buddy"]);
    /* Normalization: startingLevel defaults to 1. */
    expect(catalog?.minions[0]?.startingLevel).toBe(1);
  });

  it("collects multiple issues across slices in one pass", () => {
    const raw = rawFixtureSlices();
    raw.minions[0]!.startingTraitIds = ["no-such-trait"];
    raw.missions[1]!.requiredAssetIds = ["no-such-asset", "as-gun"];
    const { catalog, issues } = parseContentCatalog(raw);
    expect(catalog).toBeNull();
    expect(issues).toHaveLength(2);
    expect(issues).toContainEqual({
      slice: "minions",
      entityId: "m-hero",
      path: "startingTraitIds[0]",
      message: 'Unknown trait id "no-such-trait"',
    });
    expect(issues).toContainEqual({
      slice: "missions",
      entityId: "ms-asset",
      path: "requiredAssetIds[0]",
      message: 'Unknown asset id "no-such-asset"',
    });
  });

  it("reports duplicate ids with the offending entity", () => {
    const raw = rawFixtureSlices();
    raw.traits.push({ id: "t-req", name: "Copy", type: "primary" });
    const { issues } = parseContentCatalog(raw);
    expect(issues).toContainEqual(
      expect.objectContaining({ slice: "traits", entityId: "t-req" }),
    );
  });

  it("rejects agent ids that collide with minion template ids", () => {
    const raw = rawFixtureSlices();
    raw.agents[0]!.id = "m-hero";
    const { issues } = parseContentCatalog(raw);
    expect(
      issues.some((i) => i.slice === "agents" && i.entityId === "m-hero" && i.path === "id"),
    ).toBe(true);
  });

  it("rejects event ids that collide with mission template ids", () => {
    const raw = rawFixtureSlices();
    raw.events[0]!.id = "ms-basic";
    const { issues } = parseContentCatalog(raw);
    expect(
      issues.some((i) => i.slice === "events" && i.entityId === "ms-basic" && i.path === "id"),
    ).toBe(true);
  });

  it("forbids unlock_lair_mission outside onSuccessEffects", () => {
    const raw = rawFixtureSlices();
    raw.missions[0]!.onFailureEffects = [
      { kind: "unlock_lair_mission", missionId: "ms-basic" },
    ];
    const { issues } = parseContentCatalog(raw);
    expect(
      issues.some(
        (i) =>
          i.slice === "missions" &&
          i.entityId === "ms-basic" &&
          i.path === "onFailureEffects[0]",
      ),
    ).toBe(true);
  });

  it("enforces wanted level ordering rules", () => {
    const raw = rawFixtureSlices();
    raw.wantedLevels[1]! = { minHeat: 0, name: "Broken", maxAgents: 2, heatGainPerTurn: 1 };
    const { issues } = parseContentCatalog(raw);
    expect(
      issues.some((i) => i.slice === "wantedLevels" && i.path === "[1].minHeat"),
    ).toBe(true);
  });

  it("enforces wanted level heatGainPerTurn non-decreasing rule", () => {
    const raw = rawFixtureSlices();
    raw.wantedLevels = [
      { minHeat: 0, name: "Shadow", maxAgents: 0, heatGainPerTurn: 2 },
      { minHeat: 5, name: "Noticed", maxAgents: 2, heatGainPerTurn: 1 },
    ];
    const { issues } = parseContentCatalog(raw);
    expect(
      issues.some((i) => i.slice === "wantedLevels" && i.path === "[1].heatGainPerTurn"),
    ).toBe(true);
  });

  it("keeps checking other slices when one slice fails shape validation", () => {
    const raw = rawFixtureSlices();
    raw.traits = "not-an-array" as unknown as typeof raw.traits;
    raw.locations.push({ ...raw.locations[0]! }); /* duplicate loc-a */
    const { catalog, issues } = parseContentCatalog(raw);
    expect(catalog).toBeNull();
    expect(issues.some((i) => i.slice === "traits")).toBe(true);
    expect(issues.some((i) => i.slice === "locations" && i.entityId === "loc-a")).toBe(true);
  });

  it("attributes shape errors to the entity id where determinable", () => {
    const raw = rawFixtureSlices();
    raw.minions[1]!.hireCommandPoints = -1;
    const { issues } = parseContentCatalog(raw);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      slice: "minions",
      entityId: "m-buddy",
      path: "[1].hireCommandPoints",
    });
  });

  it("defaults omega phase requiredMissions to all three and rejects out-of-range counts", () => {
    const { catalog } = parseContentCatalog(rawFixtureSlices());
    expect(catalog?.omegaPlans[0]?.stages.map((s) => s.requiredMissions)).toEqual([3, 3, 3]);

    const withTwo = rawFixtureSlices();
    (withTwo.omegaPlans[0]!.stages as Record<string, unknown>[])[0]!.requiredMissions = 2;
    expect(parseCatalog(withTwo).omegaPlans[0]?.stages[0]?.requiredMissions).toBe(2);

    const tooMany = rawFixtureSlices();
    (tooMany.omegaPlans[0]!.stages as Record<string, unknown>[])[0]!.requiredMissions = 4;
    const { issues } = parseContentCatalog(tooMany);
    expect(issues.some((i) => i.slice === "omegaPlans")).toBe(true);

    const zero = rawFixtureSlices();
    (zero.omegaPlans[0]!.stages as Record<string, unknown>[])[0]!.requiredMissions = 0;
    expect(parseContentCatalog(zero).issues.some((i) => i.slice === "omegaPlans")).toBe(true);
  });

  it("requires missions (but not events) to have at least one requirement", () => {
    const raw = rawFixtureSlices();
    raw.missions[0]!.requiredTraitIds = [];
    const { issues } = parseContentCatalog(raw);
    expect(issues.some((i) => i.slice === "missions")).toBe(true);
    /* Events with no requirements are valid — the fixture's ev-1 already has none. */
    const clean = parseContentCatalog(rawFixtureSlices());
    expect(clean.issues).toEqual([]);
  });

  it("rejects a Core Mission listed as a lair upgrade mission", () => {
    const raw = rawFixtureSlices();
    raw.missions[1]!.coreMission = true;
    raw.lairs[0]!.availableMissionIds = ["ms-basic"];
    raw.lairs[0]!.upgradeLevels = [{ missionIds: ["ms-asset"] }];
    const { issues } = parseContentCatalog(raw);
    expect(
      issues.some((i) => i.slice === "lairs" && i.message.includes("Core Mission")),
    ).toBe(true);
  });

  it("rejects an upgrade mission repeated across levels or shared with the lair pool", () => {
    const repeated = rawFixtureSlices();
    repeated.lairs[0]!.availableMissionIds = [];
    repeated.lairs[0]!.upgradeLevels = [
      { missionIds: ["ms-basic"] },
      { missionIds: ["ms-asset", "ms-basic"] },
    ];
    expect(
      parseContentCatalog(repeated).issues.some(
        (i) => i.slice === "lairs" && i.path === "upgradeLevels[1].missionIds[1]",
      ),
    ).toBe(true);

    const shared = rawFixtureSlices();
    shared.lairs[0]!.availableMissionIds = ["ms-basic"];
    shared.lairs[0]!.upgradeLevels = [{ missionIds: ["ms-basic"] }];
    expect(
      parseContentCatalog(shared).issues.some(
        (i) => i.slice === "lairs" && i.message.includes("both availableMissionIds"),
      ),
    ).toBe(true);
  });

  it("forbids unlock_lair_mission from targeting a lair upgrade mission", () => {
    const raw = rawFixtureSlices();
    raw.lairs[0]!.availableMissionIds = ["ms-basic"];
    raw.lairs[0]!.upgradeLevels = [{ missionIds: ["ms-asset"] }];
    raw.missions[0]!.onSuccessEffects = [
      { kind: "unlock_lair_mission", missionId: "ms-asset" },
    ];
    const { issues } = parseContentCatalog(raw);
    expect(
      issues.some((i) => i.slice === "missions" && i.message.includes("lair upgrade")),
    ).toBe(true);
  });

  it("migrates a legacy flat upgradeMissionIds list to one level per mission", () => {
    const raw = rawFixtureSlices();
    raw.lairs[0]!.availableMissionIds = [];
    raw.lairs[0]!.upgradeMissionIds = ["ms-basic", "ms-asset"];
    const catalog = parseCatalog(raw);
    expect(catalog.lairs[0]?.upgradeLevels).toEqual([
      { missionIds: ["ms-basic"] },
      { missionIds: ["ms-asset"] },
    ]);
  });
});

describe("mission target site filters", () => {
  /** `missions[0]` is `ms-basic` (targetType "location"); `missions[1]` is `ms-asset` ("none"). */
  function withFilters(index: number, extra: Record<string, unknown>) {
    const raw = rawFixtureSlices();
    raw.missions[index] = { ...raw.missions[index], ...extra };
    return parseContentCatalog(raw);
  }

  it("accepts filters on a location-resolving targetType and normalizes them onto the template", () => {
    const { catalog, issues } = withFilters(0, {
      targetLocationIds: ["loc-a", "loc-b"],
      targetLocationTypes: ["military", "economic"],
      targetLocationLevels: [3],
      targetLocationIntelLevels: [2, 3],
      targetLocationSecurityLevels: [0],
    });
    expect(issues).toEqual([]);
    const mission = catalog?.missions.find((m) => m.id === "ms-basic");
    expect(mission?.targetLocationIds).toEqual(["loc-a", "loc-b"]);
    expect(mission?.targetLocationTypes).toEqual(["military", "economic"]);
    expect(mission?.targetLocationLevels).toEqual([3]);
    expect(mission?.targetLocationIntelLevels).toEqual([2, 3]);
    expect(mission?.targetLocationSecurityLevels).toEqual([0]);
  });

  it("drops empty filter lists so an unrestricted mission carries no key", () => {
    const { catalog, issues } = withFilters(0, {
      targetLocationIds: [],
      targetLocationTypes: [],
      targetLocationLevels: [],
      targetLocationIntelLevels: [],
      targetLocationSecurityLevels: [],
    });
    expect(issues).toEqual([]);
    const mission = catalog?.missions.find((m) => m.id === "ms-basic");
    expect(mission?.targetLocationIds).toBeUndefined();
    expect(mission?.targetLocationTypes).toBeUndefined();
    expect(mission?.targetLocationLevels).toBeUndefined();
    expect(mission?.targetLocationIntelLevels).toBeUndefined();
    expect(mission?.targetLocationSecurityLevels).toBeUndefined();
  });

  it("keeps 0 as a meaningful filter value for the per-run levels", () => {
    /* 0 is a real level ("unscouted", "unhardened"), not an absent filter. */
    const { catalog, issues } = withFilters(0, {
      targetLocationIntelLevels: [0],
      targetLocationSecurityLevels: [0],
    });
    expect(issues).toEqual([]);
    const mission = catalog?.missions.find((m) => m.id === "ms-basic");
    expect(mission?.targetLocationIntelLevels).toEqual([0]);
    expect(mission?.targetLocationSecurityLevels).toEqual([0]);
  });

  it("flags filters on a targetType that resolves to no location", () => {
    const { issues } = withFilters(1, { targetLocationTypes: ["military"] });
    expect(issues).toEqual([
      {
        slice: "missions",
        entityId: "ms-asset",
        path: "targetLocationTypes",
        message: 'targetLocationTypes needs a location-resolving targetType (got "none")',
      },
    ]);
  });

  it("flags a targetLocationIds entry that names no known location", () => {
    const { issues } = withFilters(0, { targetLocationIds: ["loc-a", "loc-nowhere"] });
    expect(issues).toEqual([
      {
        slice: "missions",
        entityId: "ms-basic",
        path: "targetLocationIds[1]",
        message: 'Unknown location id "loc-nowhere"',
      },
    ]);
  });

  it("flags targetLocationIds on a targetType that resolves to no location", () => {
    expect(withFilters(1, { targetLocationIds: ["loc-a"] }).issues).toEqual([
      {
        slice: "missions",
        entityId: "ms-asset",
        path: "targetLocationIds",
        message: 'targetLocationIds needs a location-resolving targetType (got "none")',
      },
    ]);
  });

  it("flags duplicate entries within a filter list", () => {
    const { issues } = withFilters(0, { targetLocationLevels: [2, 2] });
    expect(issues).toEqual([
      {
        slice: "missions",
        entityId: "ms-basic",
        path: "targetLocationLevels[1]",
        message: 'Duplicate targetLocationLevels entry "2"',
      },
    ]);
  });

  it("flags the per-run filters on a targetType that resolves to no location", () => {
    expect(withFilters(1, { targetLocationIntelLevels: [1] }).issues).toEqual([
      {
        slice: "missions",
        entityId: "ms-asset",
        path: "targetLocationIntelLevels",
        message: 'targetLocationIntelLevels needs a location-resolving targetType (got "none")',
      },
    ]);
    expect(withFilters(1, { targetLocationSecurityLevels: [1] }).issues).toEqual([
      {
        slice: "missions",
        entityId: "ms-asset",
        path: "targetLocationSecurityLevels",
        message: 'targetLocationSecurityLevels needs a location-resolving targetType (got "none")',
      },
    ]);
  });

  it("rejects values outside the location type / level vocabularies", () => {
    expect(withFilters(0, { targetLocationTypes: ["nautical"] }).catalog).toBeNull();
    expect(withFilters(0, { targetLocationLevels: [4] }).catalog).toBeNull();
    /* Per-run levels run 0–3; location levels start at 1. */
    expect(withFilters(0, { targetLocationIntelLevels: [4] }).catalog).toBeNull();
    expect(withFilters(0, { targetLocationSecurityLevels: [-1] }).catalog).toBeNull();
    expect(withFilters(0, { targetLocationLevels: [0] }).catalog).toBeNull();
  });
});

describe("optional agent features", () => {
  /** Everything past the minion-template shape is optional on an agent. */
  function withAgent(extra: Record<string, unknown>) {
    const raw = rawFixtureSlices();
    raw.agents = [
      ...raw.agents,
      {
        id: "a-bare",
        name: "Bystander",
        description: "Carries none of the optional agent features",
        hireCommandPoints: 0,
        levelUpTraitOrder: [],
        ...extra,
      },
    ];
    return parseContentCatalog(raw);
  }

  it("accepts an agent with no challenge traits, no abilities, and no movement behavior", () => {
    const { catalog, issues } = withAgent({});
    expect(issues).toEqual([]);
    expect(catalog).not.toBeNull();
    const bare = catalog?.agents.find((a) => a.id === "a-bare");
    expect(bare?.challengeTraitIds).toEqual([]);
    expect(bare?.abilityIds).toBeUndefined();
    expect(bare?.movementBehavior).toBeUndefined();
  });

  it("accepts an agent carrying only one of the three", () => {
    expect(withAgent({ abilityIds: ["guard"] }).issues).toEqual([]);
    expect(withAgent({ movementBehavior: "analyst" }).issues).toEqual([]);
    expect(withAgent({ challengeTraitIds: ["t-req"] }).issues).toEqual([]);
  });

  it("still rejects what an agent does list being wrong", () => {
    expect(withAgent({ challengeTraitIds: ["nope"] }).issues).toEqual([
      {
        slice: "agents",
        entityId: "a-bare",
        path: "challengeTraitIds[0]",
        message: 'Unknown trait id "nope"',
      },
    ]);
    expect(withAgent({ challengeTraitIds: ["t-req", "t-req"] }).issues).toEqual([
      {
        slice: "agents",
        entityId: "a-bare",
        path: "challengeTraitIds[1]",
        message: 'Duplicate challenge trait "t-req"',
      },
    ]);
    expect(withAgent({ abilityIds: ["guard", "guard"] }).issues).toEqual([
      {
        slice: "agents",
        entityId: "a-bare",
        path: "abilityIds[1]",
        message: 'Duplicate ability "guard"',
      },
    ]);
  });
});

describe("parseCatalog (throwing wrapper)", () => {
  it("throws a ContentValidationError carrying every issue", () => {
    const raw = rawFixtureSlices();
    raw.minions[0]!.startingTraitIds = ["nope-1"];
    raw.minions[1]!.levelUpTraitOrder = ["nope-2"];
    let caught: unknown;
    try {
      parseCatalog(raw);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ContentValidationError);
    if (caught instanceof ContentValidationError) {
      expect(caught.issues).toHaveLength(2);
      expect(caught.message).toContain("nope-1");
      expect(caught.message).toContain("nope-2");
    }
  });
});
