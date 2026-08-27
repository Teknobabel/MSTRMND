import { describe, expect, it } from "vitest";
import type { ActiveMission, GameState } from "./gameState";

import { buildTurnReport, type TurnSummarySection } from "./turnReport";
import {
  executeTurn,
  fixtureCatalog,
  makeMinionInstance,
  rawFixtureSlices,
  seededRng,
  sequentialIds,
} from "./testFixtures";
import { parseCatalog } from "./contentSchema";
import { createInitialGameState } from "./gameState";
import { createAgentFromTemplate, getAgentTemplateById } from "./agent";
import type { IntelLevel } from "./types";

const catalog = fixtureCatalog();

function activeMission(overrides: Partial<ActiveMission>): ActiveMission {
  return {
    id: "am-1",
    missionTemplateId: "ms-basic",
    target: { kind: "location", locationId: "loc-a" },
    missionSource: "lair",
    omegaStageIndex: null,
    omegaSlotIndex: null,
    participantInstanceIds: [],
    plannedAssetIds: [],
    turnsRemaining: 1,
    startedOnTurn: 1,
    ...overrides,
  };
}

/** Same neutralized site rolls the gameState suite uses, for exact success percentages. */
function baseState(seed: number): GameState {
  const state = createInitialGameState(catalog, seededRng(seed));
  return {
    ...state,
    locationRequiredTraits: { "loc-a": [], "loc-b": [] },
    locationSecurityTraits: { "loc-a": ["t-sec"], "loc-b": [] },
  };
}

/** A whole turn: mission resolution, then the Agent Phase — the state the report is built from. */
function resolve(before: GameState, roll: number, cat = catalog): GameState {
  const result = executeTurn(before, cat, () => roll, sequentialIds("ag"));
  if (!result.ok) {
    throw new Error(`resolve failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function sectionById(sections: TurnSummarySection[], id: string): TurnSummarySection | undefined {
  return sections.find((s) => s.id === id);
}

function lineTexts(sections: TurnSummarySection[], id: string): string[] {
  return sectionById(sections, id)?.lines.map((l) => l.text) ?? [];
}

describe("buildTurnReport — mission results", () => {
  it("reports one card per resolved mission with its roll and outcome", () => {
    const before: GameState = {
      ...baseState(1),
      player: {
        ...baseState(1).player,
        minions: [
          makeMinionInstance("mi-1", "m-hero", ["t-req"]),
          makeMinionInstance("mi-2", "m-buddy", []),
        ],
      },
      activeMissions: [
        activeMission({ id: "am-1", participantInstanceIds: ["mi-1"] }),
        activeMission({
          id: "am-2",
          target: { kind: "location", locationId: "loc-b" },
          participantInstanceIds: ["mi-2"],
        }),
      ],
    };
    const after = resolve(before, 0);
    const report = buildTurnReport(before, after, catalog);

    expect(report.turnNumber).toBe(before.turnNumber);
    expect(report.missions).toHaveLength(2);
    expect(report.missions.map((m) => m.activeMissionId)).toEqual(["am-1", "am-2"]);
    expect(report.missions[0]!.outcome).toBe("success");
    expect(report.missions[0]!.roll).toBe(0);
    expect(report.missions[0]!.successChancePercent).toBe(100);
    expect(report.missions[0]!.participantInstanceIds).toEqual(["mi-1"]);
    expect(report.missions[0]!.target).toEqual({ kind: "location", locationId: "loc-a" });
    expect(report.missions[0]!.missionSource).toBe("lair");
  });

  it("puts the baseline infamy/heat swing on the success card", () => {
    const seeded = baseState(1);
    const before: GameState = {
      ...seeded,
      player: { ...seeded.player, minions: [makeMinionInstance("mi-1", "m-hero", ["t-req"])] },
      activeMissions: [activeMission({ participantInstanceIds: ["mi-1"] })],
    };
    const report = buildTurnReport(before, resolve(before, 0), catalog);
    const standing = report.missions[0]!.outcomeGroups.find((g) => g.title === "Standing");
    expect(standing?.lines.map((l) => l.text)).toEqual(["Infamy +5"]);
    expect(standing?.lines[0]!.tone).toBe("good");
  });

  it("marks a failure card and its heat line as bad news", () => {
    const seeded = baseState(2);
    const before: GameState = {
      ...seeded,
      player: { ...seeded.player, minions: [makeMinionInstance("mi-1", "m-buddy", [])] },
      activeMissions: [activeMission({ participantInstanceIds: ["mi-1"] })],
    };
    const report = buildTurnReport(before, resolve(before, 0.99), catalog);
    expect(report.missions[0]!.outcome).toBe("failure");
    const standing = report.missions[0]!.outcomeGroups.find((g) => g.title === "Standing");
    expect(standing?.lines.map((l) => l.text)).toEqual(["Heat +5"]);
    expect(standing?.lines[0]!.tone).toBe("bad");
  });

  it("keeps each mission's stolen assets on its own card", () => {
    const slices = rawFixtureSlices();
    slices.missions = [
      ...slices.missions,
      {
        id: "ms-steal",
        name: "Smash and Grab",
        description: "Steals the targeted asset",
        targetType: "asset_revealed",
        startCommandPoints: 1,
        requiredTraitIds: ["t-req"],
        durationTurns: 1,
        onSuccessEffects: [{ kind: "steal_target_asset" }],
      },
    ];
    const stealCatalog = parseCatalog(slices);
    const seeded = createInitialGameState(stealCatalog, seededRng(4));
    const before: GameState = {
      ...seeded,
      locationRequiredTraits: { "loc-a": [], "loc-b": [] },
      locationSecurityTraits: { "loc-a": [], "loc-b": [] },
      player: {
        ...seeded.player,
        minions: [
          makeMinionInstance("mi-1", "m-hero", ["t-req"]),
          makeMinionInstance("mi-2", "m-hero", ["t-req"]),
        ],
      },
      locationAssetSlots: [
        {
          locationId: "loc-a",
          slots: [{ kind: "occupied", assetId: "as-cash", visibility: "revealed" }],
        },
        { locationId: "loc-b", slots: [] },
      ],
      activeMissions: [
        activeMission({
          id: "am-steal",
          missionTemplateId: "ms-steal",
          target: {
            kind: "asset",
            locationId: "loc-a",
            slotIndex: 0,
            visibilityAtAssign: "revealed",
          },
          participantInstanceIds: ["mi-1"],
        }),
        activeMission({
          id: "am-plain",
          target: { kind: "location", locationId: "loc-b" },
          participantInstanceIds: ["mi-2"],
        }),
      ],
    };
    const report = buildTurnReport(before, resolve(before, 0, stealCatalog), stealCatalog);

    const stealCard = report.missions.find((m) => m.activeMissionId === "am-steal");
    const plainCard = report.missions.find((m) => m.activeMissionId === "am-plain");
    expect(
      stealCard?.outcomeGroups.find((g) => g.title === "Assets")?.lines.map((l) => l.text),
    ).toEqual(["Gained Cash Reserves ×1"]);
    expect(plainCard?.outcomeGroups.find((g) => g.title === "Assets")).toBeUndefined();
  });

  it("reports an aborted mission instead of dropping it", () => {
    const seeded = baseState(1);
    const before: GameState = {
      ...seeded,
      player: { ...seeded.player, minions: [] },
      activeMissions: [activeMission({ participantInstanceIds: ["mi-gone"] })],
    };
    const report = buildTurnReport(before, resolve(before, 0), catalog);
    expect(report.missions).toHaveLength(1);
    expect(report.missions[0]!.outcome).toBe("aborted");
    expect(report.missions[0]!.roll).toBeNull();
    expect(report.missions[0]!.outcomeGroups[0]!.lines[0]!.tone).toBe("bad");
  });
});

describe("buildTurnReport — turn summary", () => {
  it("summarizes standing, sites, and operations after a success", () => {
    const seeded = baseState(1);
    const before: GameState = {
      ...seeded,
      player: { ...seeded.player, minions: [makeMinionInstance("mi-1", "m-hero", ["t-req"])] },
      activeMissions: [activeMission({ participantInstanceIds: ["mi-1"] })],
    };
    const report = buildTurnReport(before, resolve(before, 0), catalog);

    expect(lineTexts(report.summary, "missions")[0]).toBe(
      "1 mission resolved — 1 succeeded, 0 failed.",
    );
    expect(lineTexts(report.summary, "standing")).toContain("Infamy 0 → 5 (+5)");
    expect(lineTexts(report.summary, "standing")).toContain(
      "Command points refill to 5 next turn.",
    );
    expect(lineTexts(report.summary, "sites")).toContain("Security at First Bank 0 → 1");
  });

  it("reports the threat escalation and the agents it deployed", () => {
    const seeded = baseState(2);
    const before: GameState = {
      ...seeded,
      player: { ...seeded.player, minions: [makeMinionInstance("mi-1", "m-buddy", [])] },
      activeMissions: [activeMission({ participantInstanceIds: ["mi-1"] })],
    };
    const report = buildTurnReport(before, resolve(before, 0.99), catalog);

    expect(lineTexts(report.summary, "standing")).toContain("Heat 0 → 5 (+5)");
    expect(lineTexts(report.summary, "standing")).toContain("Threat level escalated to Noticed.");
    const sites = lineTexts(report.summary, "sites");
    expect(sites.filter((t) => t.includes("deployed to"))).toHaveLength(2);
  });

  it("reports agent movement the player can watch, and hides the rest", () => {
    /* `a-cop` is an investigator: a failure at loc-a pulls it over from loc-b. */
    function stateWithCopAtLocB(
      catalogVisibility: "hidden" | "revealed",
      intelAtLocA: IntelLevel = 0,
    ): GameState {
      const seeded = baseState(4);
      return {
        ...seeded,
        player: { ...seeded.player, minions: [makeMinionInstance("mi-1", "m-hero", [])] },
        activeMissions: [activeMission({ participantInstanceIds: ["mi-1"] })],
        opposingAgentInstances: [
          createAgentFromTemplate(getAgentTemplateById(catalog, "a-cop")!, "opp-1", {
            catalogVisibility,
          }),
        ],
        locationAgentPresence: [
          { locationId: "loc-a", agentInstanceIds: [] },
          { locationId: "loc-b", agentInstanceIds: ["opp-1"] },
        ],
        locationIntelStates: [
          { locationId: "loc-a", intelLevel: intelAtLocA },
          { locationId: "loc-b", intelLevel: 0 },
        ],
      };
    }

    const revealed = stateWithCopAtLocB("revealed");
    expect(lineTexts(buildTurnReport(revealed, resolve(revealed, 0.99), catalog).summary, "agents")).toContain(
      "Detective moved from Armory to First Bank — working the scene of your last failure.",
    );

    /* Same move, an agent the player has never uncovered, both sites dark: no line at all. */
    const hidden = stateWithCopAtLocB("hidden");
    const hiddenSites = lineTexts(buildTurnReport(hidden, resolve(hidden, 0.99), catalog).summary, "agents");
    expect(hiddenSites.filter((t) => t.includes("moved from"))).toEqual([]);

    /* Intel 3 at the destination lights the arrival up even for an unrevealed agent. */
    const watched = stateWithCopAtLocB("hidden", 3);
    expect(
      lineTexts(buildTurnReport(watched, resolve(watched, 0.99), catalog).summary, "agents").filter((t) =>
        t.includes("moved from"),
      ),
    ).toHaveLength(1);
  });


  it("names an agent the player can see and redacts one they cannot", () => {
    /** A Security Chief standing at loc-a, at the given visibility and site intel. */
    function stateWithChief(
      catalogVisibility: "hidden" | "revealed",
      intelAtLocA: IntelLevel = 0,
    ): GameState {
      const seeded = baseState(5);
      const template = getAgentTemplateById(catalog, "a-spy")!;
      return {
        ...seeded,
        opposingAgentInstances: [
          {
            ...createAgentFromTemplate(template, "opp-1", { catalogVisibility }),
            abilityIds: ["security_chief"],
          },
        ],
        locationAgentPresence: [
          { locationId: "loc-a", agentInstanceIds: ["opp-1"] },
          { locationId: "loc-b", agentInstanceIds: [] },
        ],
        locationIntelStates: [
          { locationId: "loc-a", intelLevel: intelAtLocA },
          { locationId: "loc-b", intelLevel: 0 },
        ],
      };
    }

    const seen = stateWithChief("revealed");
    expect(lineTexts(buildTurnReport(seen, resolve(seen, 0), catalog).summary, "agents")).toContain(
      "Spy raised the security level at First Bank.",
    );

    /* The effect is plain to see; who caused it is not. */
    const unseen = stateWithChief("hidden");
    expect(
      lineTexts(buildTurnReport(unseen, resolve(unseen, 0), catalog).summary, "agents"),
    ).toContain("An unknown agent raised the security level at First Bank.");

    /* Intel 3 on the site puts a name to it again. */
    const watched = stateWithChief("hidden", 3);
    expect(
      lineTexts(buildTurnReport(watched, resolve(watched, 0), catalog).summary, "agents"),
    ).toContain("Spy raised the security level at First Bank.");
  });

  it("lists still-running missions and stays quiet about resolved ones when none finished", () => {
    const seeded = baseState(3);
    const before: GameState = {
      ...seeded,
      player: { ...seeded.player, minions: [makeMinionInstance("mi-1", "m-hero", ["t-req"])] },
      activeMissions: [
        activeMission({ turnsRemaining: 3, participantInstanceIds: ["mi-1"] }),
      ],
    };
    const report = buildTurnReport(before, resolve(before, 0), catalog);

    expect(report.missions).toHaveLength(0);
    expect(lineTexts(report.summary, "missions")).toEqual([
      "No missions finished this turn.",
      "Case the Bank still running — 2 turns left.",
    ]);
  });

  it("credits an omega slot and the phase it cleared", () => {
    const slices = rawFixtureSlices();
    slices.omegaPlans = [
      {
        id: "op-1",
        name: "Operation Test",
        description: "Test plan",
        mapId: "map-1",
        stages: [
          { missionIds: ["ms-basic", "ms-basic", "ms-basic"], requiredMissions: 1 },
          { missionIds: ["ms-basic", "ms-basic", "ms-basic"], requiredMissions: 1 },
          { missionIds: ["ms-basic", "ms-basic", "ms-basic"], requiredMissions: 1 },
        ],
      },
    ];
    const planCatalog = parseCatalog(slices);
    const seeded = createInitialGameState(planCatalog, seededRng(1));
    const before: GameState = {
      ...seeded,
      locationRequiredTraits: { "loc-a": [], "loc-b": [] },
      locationSecurityTraits: { "loc-a": [], "loc-b": [] },
      player: { ...seeded.player, minions: [makeMinionInstance("mi-1", "m-hero", ["t-req"])] },
      activeMissions: [
        activeMission({
          missionSource: "omega",
          omegaStageIndex: 0,
          omegaSlotIndex: 1,
          participantInstanceIds: ["mi-1"],
        }),
      ],
    };
    const report = buildTurnReport(before, resolve(before, 0, planCatalog), planCatalog);
    expect(lineTexts(report.summary, "omega")).toEqual([
      "Phase 1 · slot 2 complete — Case the Bank.",
      "Phase 1 cleared — phase 2 is now active.",
    ]);
  });

  it("reports an unclaimed event expiring and its consequences", () => {
    const seeded = createInitialGameState(catalog, seededRng(3));
    const before: GameState = {
      ...seeded,
      currentEventTemplateId: "ev-1",
      currentEventTurnsRemaining: 1,
      eventCooldownTurnsRemaining: 0,
    };
    const report = buildTurnReport(before, resolve(before, 0.5), catalog);
    const events = lineTexts(report.summary, "events");
    expect(events.some((t) => t.startsWith('"Global Summit" expired unclaimed'))).toBe(true);
  });

  it("calls out an infamy-gated upgrade level the turn it comes within reach", () => {
    const raw = rawFixtureSlices();
    (raw.missions as Record<string, unknown>[]).push({
      id: "ms-up-gated",
      name: "Gated Upgrade",
      description: "Lair upgrade behind a standing gate",
      targetType: "none",
      startCommandPoints: 0,
      requiredTraitIds: ["t-req"],
      durationTurns: 1,
    });
    raw.lairs[0] = {
      ...raw.lairs[0],
      upgradeLevels: [{ minInfamy: 5, missionIds: ["ms-up-gated"] }],
    };
    const cat = parseCatalog(raw);
    const seeded = createInitialGameState(cat, seededRng(1));
    const before: GameState = {
      ...seeded,
      locationRequiredTraits: { "loc-a": [], "loc-b": [] },
      locationSecurityTraits: { "loc-a": ["t-sec"], "loc-b": [] },
      player: {
        ...seeded.player,
        infamy: 0,
        minions: [makeMinionInstance("mi-1", "m-hero", ["t-req"])],
      },
      activeMissions: [activeMission({ participantInstanceIds: ["mi-1"] })],
    };
    /* The successful mission pays +5 infamy, exactly the level's bar. */
    const lair = lineTexts(buildTurnReport(before, resolve(before, 0, cat), cat).summary, "lair");
    expect(lair.some((t) => t.includes("Upgrade level 1 is now within reach"))).toBe(true);

    /* Already over the bar beforehand ⇒ nothing to announce. */
    const alreadyOpen: GameState = { ...before, player: { ...before.player, infamy: 10 } };
    expect(
      lineTexts(buildTurnReport(alreadyOpen, resolve(alreadyOpen, 0, cat), cat).summary, "lair"),
    ).toEqual([]);
  });

  it("drops sections that have nothing to report", () => {
    const before = baseState(7);
    const report = buildTurnReport(before, resolve(before, 0.5), catalog);
    expect(sectionById(report.summary, "omega")).toBeUndefined();
    expect(sectionById(report.summary, "assets")).toBeUndefined();
    expect(sectionById(report.summary, "lair")).toBeUndefined();
    /* Operations and Standing always carry at least one line. */
    expect(sectionById(report.summary, "missions")).toBeDefined();
    expect(sectionById(report.summary, "standing")).toBeDefined();
  });
});

describe("buildTurnReport — relationships", () => {
  /** Two matched operatives, one turn short of the Friends threshold. */
  function onTheCusp(): GameState {
    const state = baseState(1);
    const minions = [
      makeMinionInstance("mi-1", "m-hero", ["t-req"]),
      makeMinionInstance("mi-2", "m-hero", ["t-req"]),
    ];
    return {
      ...state,
      player: { ...state.player, minions },
      minionAffinities: [
        {
          aInstanceId: "mi-1",
          bInstanceId: "mi-2",
          score: catalog.balance.minionAffinity.friendThreshold - 1,
          relationship: "neutral",
        },
      ],
      activeMissions: [activeMission({ participantInstanceIds: ["mi-1", "mi-2"] })],
    };
  }

  it("shows the crossing on the mission result card and the turn summary", () => {
    const before = onTheCusp();
    const after = resolve(before, 0);
    const report = buildTurnReport(before, after, catalog);
    const card = report.missions[0]!;
    const relationships = card.outcomeGroups.find((g) => g.title === "Relationships");
    expect(relationships?.lines.map((l) => l.text)).toEqual([
      "Operative and Operative became Friends.",
    ]);
    expect(relationships?.lines[0]!.tone).toBe("good");
    expect(lineTexts(report.summary, "roster")).toContain(
      "Operative and Operative became Friends.",
    );
  });

  it("drops the Relationships group entirely when nothing crossed", () => {
    const before = baseState(1);
    const staged: GameState = {
      ...before,
      player: {
        ...before.player,
        minions: [
          makeMinionInstance("mi-1", "m-hero", ["t-req"]),
          makeMinionInstance("mi-2", "m-hero", ["t-req"]),
        ],
      },
      activeMissions: [activeMission({ participantInstanceIds: ["mi-1", "mi-2"] })],
    };
    const report = buildTurnReport(staged, resolve(staged, 0), catalog);
    expect(report.missions[0]!.outcomeGroups.some((g) => g.title === "Relationships")).toBe(false);
  });
});
