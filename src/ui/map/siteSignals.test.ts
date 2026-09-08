import { describe, expect, it } from "vitest";
import { mapSiteSignals, type MapSiteSignalInput } from "./siteSignals";

const MARKERS = [
  { locationId: "harbor_armory", x: 16, y: 29.2 },
  { locationId: "the_citadel", x: 19.6, y: 33.4 },
  { locationId: "meridian_bank", x: 47.8, y: 29.8 },
  { locationId: "not_this_run", x: 80, y: 80 },
];

function input(over: Partial<MapSiteSignalInput> = {}): MapSiteSignalInput {
  return {
    markers: MARKERS,
    playableLocationIds: new Set(["harbor_armory", "the_citadel", "meridian_bank"]),
    securityLevelByLocation: new Map(),
    maxSecurityByLocation: new Map([
      ["harbor_armory", 1],
      ["the_citadel", 3],
      ["meridian_bank", 2],
    ]),
    operationLocationIds: new Set(),
    targetedLocationId: null,
    ...over,
  };
}

describe("mapSiteSignals", () => {
  it("says nothing about a run where nothing has happened yet", () => {
    // The map should open dark and light up as the player makes something of it.
    expect(mapSiteSignals(input())).toEqual([]);
  });

  it("reports security as a fraction of the site's own ceiling", () => {
    // A level-1 site maxed out is as locked down as it gets, and should read as hot as a
    // level-3 site maxed out — not a third as hot.
    const signals = mapSiteSignals(
      input({
        securityLevelByLocation: new Map([
          ["harbor_armory", 1],
          ["the_citadel", 3],
          ["meridian_bank", 1],
        ]),
      }),
    );
    const by = new Map(signals.map((s) => [s.locationId, s]));
    expect(by.get("harbor_armory")?.security).toBe(1);
    expect(by.get("the_citadel")?.security).toBe(1);
    expect(by.get("meridian_bank")?.security).toBe(0.5);
  });

  it("converts authored percentages into map space", () => {
    const [signal] = mapSiteSignals(
      input({ securityLevelByLocation: new Map([["meridian_bank", 2]]) }),
    );
    expect(signal?.u).toBeCloseTo(0.478, 6);
    expect(signal?.v).toBeCloseTo(0.298, 6);
  });

  it("flags a running operation and the staged target independently", () => {
    const signals = mapSiteSignals(
      input({
        operationLocationIds: new Set(["harbor_armory"]),
        targetedLocationId: "the_citadel",
      }),
    );
    const by = new Map(signals.map((s) => [s.locationId, s]));
    expect(by.get("harbor_armory")).toMatchObject({ operation: 1, targeted: 0, security: 0 });
    expect(by.get("the_citadel")).toMatchObject({ operation: 0, targeted: 1, security: 0 });
    expect(by.size).toBe(2);
  });

  it("carries all three signals at once when a site is doing all three", () => {
    const [signal] = mapSiteSignals(
      input({
        securityLevelByLocation: new Map([["the_citadel", 3]]),
        operationLocationIds: new Set(["the_citadel"]),
        targetedLocationId: "the_citadel",
      }),
    );
    expect(signal).toMatchObject({ security: 1, operation: 1, targeted: 1 });
  });

  it("ignores a marker for a site that is not in this run", () => {
    const signals = mapSiteSignals(
      input({
        securityLevelByLocation: new Map([["not_this_run", 3]]),
        targetedLocationId: "not_this_run",
      }),
    );
    expect(signals).toEqual([]);
  });

  it("treats a site with no ceiling as unhardened rather than dividing by zero", () => {
    const signals = mapSiteSignals(
      input({
        maxSecurityByLocation: new Map(),
        securityLevelByLocation: new Map([["harbor_armory", 2]]),
      }),
    );
    expect(signals).toEqual([]);
  });

  it("clamps a security level that somehow exceeds its ceiling", () => {
    const [signal] = mapSiteSignals(
      input({ securityLevelByLocation: new Map([["harbor_armory", 9]]) }),
    );
    expect(signal?.security).toBe(1);
  });

  it("keeps authoring order, so the draw order is stable frame to frame", () => {
    const signals = mapSiteSignals(
      input({
        securityLevelByLocation: new Map([
          ["meridian_bank", 2],
          ["harbor_armory", 1],
        ]),
      }),
    );
    expect(signals.map((s) => s.locationId)).toEqual(["harbor_armory", "meridian_bank"]);
  });
});
