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
    raw.wantedLevels[1]! = { minInfamy: 0, name: "Broken", maxAgents: 2 };
    const { issues } = parseContentCatalog(raw);
    expect(
      issues.some((i) => i.slice === "wantedLevels" && i.path === "[1].minInfamy"),
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

  it("requires missions (but not events) to have at least one requirement", () => {
    const raw = rawFixtureSlices();
    raw.missions[0]!.requiredTraitIds = [];
    const { issues } = parseContentCatalog(raw);
    expect(issues.some((i) => i.slice === "missions")).toBe(true);
    /* Events with no requirements are valid — the fixture's ev-1 already has none. */
    const clean = parseContentCatalog(rawFixtureSlices());
    expect(clean.issues).toEqual([]);
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
