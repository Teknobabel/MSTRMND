/**
 * Shared fixtures for the Vitest suites. Not a test file itself.
 *
 * `rawFixtureSlices` returns a fresh, minimal-but-complete raw content set each call
 * (safe to mutate per test); `fixtureCatalog` parses it. `seededRng` (mulberry32) makes
 * every roll in the rules engine deterministic.
 */
import type { MinionInstance } from "./types";
import { parseCatalog, type ContentSliceKey } from "./contentSchema";
import type { ContentCatalog } from "./types";

type JsonRecord = Record<string, unknown>;

export type FixtureSlices = Record<ContentSliceKey, unknown> & {
  traits: JsonRecord[];
  minions: JsonRecord[];
  agents: JsonRecord[];
  missions: JsonRecord[];
  locations: JsonRecord[];
  maps: JsonRecord[];
  assets: JsonRecord[];
  omegaPlans: JsonRecord[];
  lairs: JsonRecord[];
  events: JsonRecord[];
  organizationNames: string[];
  playerProfiles: JsonRecord[];
  wantedLevels: JsonRecord[];
  balance: JsonRecord;
};

export function rawFixtureSlices(): FixtureSlices {
  return {
    traits: [
      { id: "t-req", name: "Infiltration", type: "primary" },
      { id: "t-sec", name: "Countermeasures", type: "secondary" },
      { id: "t-level", name: "Veteran", type: "primary" },
      { id: "t-pos", name: "Inspired", type: "status_positive" },
      { id: "t-neg", name: "Shaken", type: "status_negative" },
    ],
    minions: [
      {
        id: "m-hero",
        name: "Operative",
        description: "Test operative",
        hireCommandPoints: 1,
        startingTraitIds: ["t-req"],
        levelUpTraitOrder: ["t-level"],
      },
      {
        id: "m-buddy",
        name: "Sidekick",
        description: "Test sidekick",
        hireCommandPoints: 1,
        levelUpTraitOrder: [],
      },
    ],
    agents: [
      {
        id: "a-spy",
        name: "Spy",
        description: "Opposing spy",
        hireCommandPoints: 0,
        levelUpTraitOrder: [],
      },
      {
        id: "a-cop",
        name: "Detective",
        description: "Opposing detective",
        hireCommandPoints: 0,
        levelUpTraitOrder: [],
      },
    ],
    missions: [
      {
        id: "ms-basic",
        name: "Case the Bank",
        description: "Basic location mission",
        targetType: "location",
        startCommandPoints: 1,
        requiredTraitIds: ["t-req"],
        durationTurns: 1,
      },
      {
        id: "ms-asset",
        name: "Fence the Goods",
        description: "Asset-requirement mission",
        targetType: "none",
        startCommandPoints: 1,
        requiredAssetIds: ["as-car", "as-gun"],
        durationTurns: 2,
      },
    ],
    locations: [
      {
        id: "loc-a",
        name: "First Bank",
        description: "Economic site",
        locationType: "economic",
        locationLevel: 2,
      },
      {
        id: "loc-b",
        name: "Armory",
        description: "Military site",
        locationType: "military",
        locationLevel: 1,
      },
    ],
    maps: [
      {
        id: "map-1",
        name: "Test City",
        description: "Two-site map",
        locationIds: ["loc-a", "loc-b"],
      },
    ],
    assets: [
      { id: "as-car", name: "Getaway Car" },
      { id: "as-gun", name: "Ray Gun" },
      { id: "as-cash", name: "Cash Reserves" },
    ],
    omegaPlans: [
      {
        id: "op-1",
        name: "Operation Test",
        description: "Test plan",
        mapId: "map-1",
        stages: [
          { missionIds: ["ms-basic", "ms-basic", "ms-basic"] },
          { missionIds: ["ms-basic", "ms-basic", "ms-basic"] },
          { missionIds: ["ms-basic", "ms-basic", "ms-basic"] },
        ],
      },
    ],
    lairs: [
      {
        id: "lair-1",
        name: "Volcano Base",
        availableMissionIds: ["ms-basic", "ms-asset"],
      },
    ],
    events: [
      {
        id: "ev-1",
        name: "Global Summit",
        description: "Test event",
        targetType: "none",
        startCommandPoints: 0,
        durationTurns: 1,
        expireEffects: [{ kind: "grant_command_points_next_turn", amount: 2 }],
      },
    ],
    organizationNames: ["Test Syndicate"],
    playerProfiles: [{ name: "Tester", profilePic: "/assets/test.png" }],
    wantedLevels: [
      { minInfamy: 0, name: "Shadow", maxAgents: 0 },
      { minInfamy: 5, name: "Noticed", maxAgents: 2 },
    ],
    /* Empty ⇒ every knob takes its DEFAULT_BALANCE value (legacy behavior). */
    balance: {},
  };
}

export function fixtureCatalog(): ContentCatalog {
  return parseCatalog(rawFixtureSlices());
}

/** Deterministic RNG (mulberry32). */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sequential instance-id generator for deterministic spawns. */
export function sequentialIds(prefix: string): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}-${n}`;
  };
}

export function makeMinionInstance(
  instanceId: string,
  templateId: string,
  traitIds: string[],
): MinionInstance {
  return {
    instanceId,
    templateId,
    currentLevel: 1,
    currentExperience: 0,
    traitIds,
    dynamicTraits: [],
  };
}
