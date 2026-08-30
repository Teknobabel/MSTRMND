/**
 * End-of-turn report: the data behind the Mission Results modals and the Turn Summary modal
 * shown after Execute Plan (see `main.ts`).
 *
 * Pure and UI-free — it takes the state snapshot from **before** `executePlan` and the state it
 * returned (phase `summary`, before `advanceToNextTurn`) and derives:
 *
 * - one {@link MissionResultReport} per mission that finished this resolve, carrying that
 *   mission's own fallout (grouped by `activeMissionId` on the resolve activity rows), and
 * - {@link TurnSummarySection}s covering everything else that changed, diffed from the two
 *   snapshots so nothing depends on an effect remembering to log itself.
 *
 * Ids stay structural (targets, participants, template ids) so `main.ts` can render cards and
 * portraits with its own lookups; everything else is already display text.
 */
import type { ActivityEvent, GameOverReason, GameState, RunEnding } from "./gameState";
import type {
  AgentMovementBehavior,
  ContentCatalog,
  LocationAssetSlot,
  MissionSource,
  MissionTarget,
} from "./types";
import {
  intelLevelForLocation,
  isOpposingAgentMoveVisibleToPlayer,
  isOpposingAgentVisibleToPlayer,
} from "./intel";
import { isOccupiedAssetSlot } from "./types";
import {
  formatRelationshipChange,
  formatStandingChange,
  relationshipChangeIsPositive,
  standingChangeIsPositive,
} from "./affinity";
import {
  getOmegaPlanById,
  omegaPlanRequiredMissionTotal,
  omegaSlotMissionId,
  omegaStageRequiredMissions,
} from "./omegaPlan";
import {
  currentLairUpgradeLevel,
  getLairById,
  isLairUpgradeLevelUnlocked,
  lairUpgradeLevelIndexOfMission,
  lairUpgradeLevelMinInfamy,
  lairUpgradeLevels,
} from "./lair";

/** `good` = went the player's way, `bad` = cost them something, `neutral` = just news. */
export type TurnReportTone = "good" | "bad" | "neutral";

export type TurnReportLine = {
  text: string;
  tone: TurnReportTone;
};

/** A titled block of lines inside one mission result card. */
export type MissionOutcomeGroup = {
  title: string;
  lines: TurnReportLine[];
};

export type MissionOutcome = "success" | "failure" | "aborted";

export type MissionResultReport = {
  activeMissionId: string;
  missionTemplateId: string;
  missionName: string;
  target: MissionTarget;
  /** `null` when the finished mission is no longer resolvable from the pre-resolve snapshot. */
  missionSource: MissionSource | null;
  omegaStageIndex: number | null;
  omegaSlotIndex: number | null;
  participantInstanceIds: string[];
  plannedAssetIds: (string | null)[];
  /** Support assets the player spent on this mission (see `ActiveMission.supportAssetIds`). */
  supportAssetIds: string[];
  outcome: MissionOutcome;
  /** `null` for aborted missions (no roll happened). */
  roll: number | null;
  successChancePercent: number | null;
  /** Turn the mission was assigned on, for the "ran N turns" line. */
  startedOnTurn: number | null;
  /** What the outcome did, grouped for display; empty groups are dropped. */
  outcomeGroups: MissionOutcomeGroup[];
};

export type TurnSummarySection = {
  id: string;
  title: string;
  lines: TurnReportLine[];
};

export type TurnReport = {
  /** Turn that just resolved (the report is shown before the turn number advances). */
  turnNumber: number;
  missions: MissionResultReport[];
  summary: TurnSummarySection[];
};

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

function missionOrEventName(catalog: ContentCatalog, id: string): string {
  return (
    catalog.missions.find((m) => m.id === id)?.name ??
    catalog.events.find((e) => e.id === id)?.name ??
    id
  );
}

function assetName(catalog: ContentCatalog, id: string): string {
  return catalog.assets.find((a) => a.id === id)?.name ?? id;
}

function traitName(catalog: ContentCatalog, id: string): string {
  return catalog.traits.find((t) => t.id === id)?.name ?? id;
}

function locationName(catalog: ContentCatalog, id: string): string {
  return catalog.locations.find((l) => l.id === id)?.name ?? id;
}

function minionName(catalog: ContentCatalog, state: GameState, instanceId: string): string {
  const inst = state.player.minions.find((m) => m.instanceId === instanceId);
  if (inst === undefined) {
    return "Unknown minion";
  }
  return catalog.minions.find((t) => t.id === inst.templateId)?.name ?? inst.templateId;
}

function agentName(catalog: ContentCatalog, state: GameState, instanceId: string): string {
  const inst = state.opposingAgentInstances.find((a) => a.instanceId === instanceId);
  if (inst === undefined) {
    return "Unknown agent";
  }
  return catalog.agents.find((t) => t.id === inst.templateId)?.name ?? inst.templateId;
}

/** Catalog trait tone: a status trait reads good or bad, everything else is just a capability. */
function traitTone(catalog: ContentCatalog, traitId: string): TurnReportTone {
  const type = catalog.traits.find((t) => t.id === traitId)?.type;
  if (type === "status_positive") {
    return "good";
  }
  if (type === "status_negative") {
    return "bad";
  }
  return "neutral";
}

function group(title: string, lines: TurnReportLine[]): MissionOutcomeGroup | null {
  return lines.length > 0 ? { title, lines } : null;
}

function section(id: string, title: string, lines: TurnReportLine[]): TurnSummarySection | null {
  return lines.length > 0 ? { id, title, lines } : null;
}

/** The activity rows `executePlan` appended to this turn's bucket (main-phase rows excluded). */
function resolveActivityEvents(before: GameState, after: GameState): ActivityEvent[] {
  const turnNumber = before.turnNumber;
  const priorCount =
    before.activityLog.find((e) => e.turnNumber === turnNumber)?.events.length ?? 0;
  const events = after.activityLog.find((e) => e.turnNumber === turnNumber)?.events ?? [];
  return events.slice(priorCount);
}

function assetTallies(assets: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(assets));
}

function occupiedSlotKey(slot: LocationAssetSlot): string {
  return isOccupiedAssetSlot(slot) ? `${slot.assetId}:${slot.visibility}` : "empty";
}

/* ---------------------------------------------------------------------------------------
 * Mission result cards
 * ------------------------------------------------------------------------------------- */

function missionOutcomeGroups(
  catalog: ContentCatalog,
  after: GameState,
  ev: Extract<ActivityEvent, { kind: "mission_completed" }>,
  ownEvents: ActivityEvent[],
): MissionOutcomeGroup[] {
  const groups: (MissionOutcomeGroup | null)[] = [];
  const effectTone: TurnReportTone = ev.success ? "good" : "bad";

  /* Totals after the clamp, so this reads as the change the player's bars actually made —
   * the per-effect lines below say where each piece came from. */
  const standing: TurnReportLine[] = [];
  if (ev.infamyDelta !== 0) {
    standing.push({
      text: `Infamy ${signed(ev.infamyDelta)}`,
      tone: ev.infamyDelta >= 0 ? "good" : "bad",
    });
  }
  if (ev.heatDelta !== 0) {
    standing.push({
      text: `Heat ${signed(ev.heatDelta)}`,
      tone: ev.heatDelta > 0 ? "bad" : "good",
    });
  }
  groups.push(group("Standing", standing));

  groups.push(
    group(
      ev.success ? "Success effects" : "Failure effects",
      ev.templateEffectDescriptions.map((text) => ({ text, tone: effectTone })),
    ),
  );

  const spoils: TurnReportLine[] = [];
  for (const own of ownEvents) {
    if (own.kind === "asset_gained") {
      spoils.push({
        text: `Gained ${assetName(catalog, own.assetId)} ×${own.quantity}`,
        tone: "good",
      });
    } else if (own.kind === "asset_lost") {
      spoils.push({
        text: `Lost ${assetName(catalog, own.assetId)} ×${own.quantity}`,
        tone: "bad",
      });
    }
  }
  groups.push(group("Assets", spoils));

  const crew: TurnReportLine[] = [];
  for (const own of ownEvents) {
    if (own.kind !== "minion_leveled_up") {
      continue;
    }
    const who = catalog.minions.find((t) => t.id === own.templateId)?.name ?? own.templateId;
    crew.push({
      text:
        own.traitId !== undefined
          ? `${who} reached level ${own.newLevel} and unlocked ${traitName(catalog, own.traitId)}.`
          : `${who} reached level ${own.newLevel}.`,
      tone: "good",
    });
  }
  groups.push(group("Minions", crew));
  /* Relationship and standing moves earn their own group: they are the fallout players most
   * want to spot, and burying them under level-ups makes them easy to miss. */
  groups.push(
    group("Relationships", [
      ...(ev.relationshipChanges ?? []).map((change) => ({
        text: formatRelationshipChange(catalog, after.player.minions, change),
        tone: relationshipChangeIsPositive(change) ? ("good" as const) : ("bad" as const),
      })),
      ...(ev.standingChanges ?? []).map((change) => ({
        text: formatStandingChange(catalog, after.player.minions, change),
        tone: standingChangeIsPositive(change) ? ("good" as const) : ("bad" as const),
      })),
    ]),
  );

  /* The site's agents are named here by the challenge they posed, not by identity — an
   * unrevealed agent still gets to bite, and the crew felt it either way. */
  const fallout: TurnReportLine[] = [];
  /* Passive abilities that fired on this mission (Brawler, Investigator, a Guard refusing a
   * reduction) ride in tagged with this mission's id. */
  for (const own of ownEvents) {
    if (own.kind === "agent_ability_used") {
      fallout.push({ text: describeAgentAbilityUse(catalog, after, own), tone: "bad" });
    }
  }
  const challenges = ev.challengeTraitIds ?? [];
  const unmatched = new Set(ev.unmatchedChallengeTraitIds ?? []);
  for (const tid of challenges) {
    fallout.push(
      unmatched.has(tid)
        ? {
            text: `Opposition challenge ${traitName(catalog, tid)}: nobody on the crew could answer it.`,
            tone: "bad",
          }
        : {
            text: `Opposition challenge ${traitName(catalog, tid)}: the crew covered it.`,
            tone: "good",
          },
    );
  }
  groups.push(group("Fallout", fallout));

  return groups.filter((g): g is MissionOutcomeGroup => g !== null);
}

function buildMissionReports(
  catalog: ContentCatalog,
  before: GameState,
  after: GameState,
  events: ActivityEvent[],
): MissionResultReport[] {
  const reports: MissionResultReport[] = [];
  for (const ev of events) {
    if (ev.kind !== "mission_completed" && ev.kind !== "mission_aborted") {
      continue;
    }
    const am = before.activeMissions.find((m) => m.id === ev.activeMissionId);
    const ownEvents = events.filter(
      (e) =>
        (e.kind === "asset_gained" ||
          e.kind === "asset_lost" ||
          e.kind === "minion_leveled_up" ||
          e.kind === "agent_ability_used") &&
        e.activeMissionId === ev.activeMissionId,
    );
    const base = {
      activeMissionId: ev.activeMissionId,
      missionTemplateId: ev.missionTemplateId,
      target: ev.target,
      missionSource: am?.missionSource ?? null,
      omegaStageIndex: am?.omegaStageIndex ?? null,
      omegaSlotIndex: am?.omegaSlotIndex ?? null,
      participantInstanceIds: am?.participantInstanceIds ?? [],
      plannedAssetIds: am?.plannedAssetIds ?? [],
      supportAssetIds: am?.supportAssetIds ?? [],
      startedOnTurn: am?.startedOnTurn ?? null,
    };
    if (ev.kind === "mission_aborted") {
      const why =
        ev.reason === "missing_template"
          ? "its mission template is no longer in the catalog"
          : "its roster was invalid when the turn resolved";
      const refunds: TurnReportLine[] = ownEvents
        .filter((e) => e.kind === "asset_gained")
        .map((e) => ({
          text: `Refunded ${assetName(catalog, e.assetId)} ×${e.quantity}`,
          tone: "neutral" as const,
        }));
      reports.push({
        ...base,
        missionName: missionOrEventName(catalog, ev.missionTemplateId),
        outcome: "aborted",
        roll: null,
        successChancePercent: null,
        outcomeGroups: [
          { title: "Aborted", lines: [{ text: `Could not run — ${why}.`, tone: "bad" }] },
          ...(refunds.length > 0 ? [{ title: "Assets", lines: refunds }] : []),
        ],
      });
      continue;
    }
    reports.push({
      ...base,
      missionName: ev.missionName,
      outcome: ev.success ? "success" : "failure",
      roll: ev.roll,
      successChancePercent: ev.successChancePercent,
      outcomeGroups: missionOutcomeGroups(catalog, after, ev, ownEvents),
    });
  }
  return reports;
}

/* ---------------------------------------------------------------------------------------
 * Turn summary sections
 * ------------------------------------------------------------------------------------- */

function missionsSection(
  catalog: ContentCatalog,
  after: GameState,
  missions: MissionResultReport[],
): TurnSummarySection | null {
  const lines: TurnReportLine[] = [];
  const wins = missions.filter((m) => m.outcome === "success").length;
  const losses = missions.filter((m) => m.outcome === "failure").length;
  if (missions.length === 0) {
    lines.push({ text: "No missions finished this turn.", tone: "neutral" });
  } else {
    lines.push({
      text: `${missions.length} mission${missions.length === 1 ? "" : "s"} resolved — ${wins} succeeded, ${losses} failed.`,
      tone: losses > wins ? "bad" : "good",
    });
    for (const m of missions) {
      lines.push({
        text: `${m.missionName}: ${
          m.outcome === "success" ? "Success" : m.outcome === "failure" ? "Failure" : "Aborted"
        }`,
        tone: m.outcome === "success" ? "good" : "bad",
      });
    }
  }
  for (const am of after.activeMissions) {
    lines.push({
      text: `${missionOrEventName(catalog, am.missionTemplateId)} still running — ${
        am.turnsRemaining
      } turn${am.turnsRemaining === 1 ? "" : "s"} left.`,
      tone: "neutral",
    });
  }
  return section("missions", "Operations", lines);
}

function standingSection(
  catalog: ContentCatalog,
  before: GameState,
  after: GameState,
): TurnSummarySection | null {
  const lines: TurnReportLine[] = [];
  const b = before.player;
  const a = after.player;
  if (a.infamy !== b.infamy) {
    lines.push({
      text: `Infamy ${b.infamy} → ${a.infamy} (${signed(a.infamy - b.infamy)})`,
      tone: a.infamy > b.infamy ? "good" : "bad",
    });
  }
  if (a.heat !== b.heat) {
    lines.push({
      text: `Heat ${b.heat} → ${a.heat} (${signed(a.heat - b.heat)})`,
      tone: a.heat > b.heat ? "bad" : "good",
    });
  }
  if (after.wantedLevelTierIndex !== before.wantedLevelTierIndex) {
    const tier = catalog.wantedLevels[after.wantedLevelTierIndex];
    lines.push({
      text: `Threat level escalated to ${tier?.name ?? `tier ${after.wantedLevelTierIndex + 1}`}.`,
      tone: "bad",
    });
  }
  const nextCp = a.maxCommandPoints + a.pendingBonusCommandPoints;
  lines.push({
    text:
      a.pendingBonusCommandPoints > 0
        ? `Command points refill to ${nextCp} next turn (${a.maxCommandPoints} + ${a.pendingBonusCommandPoints} bonus).`
        : `Command points refill to ${nextCp} next turn.`,
    tone: a.pendingBonusCommandPoints > 0 ? "good" : "neutral",
  });
  const caps: Array<[string, number, number, "up-good" | "up-bad"]> = [
    ["Max command points", b.maxCommandPoints, a.maxCommandPoints, "up-good"],
    ["Roster cap", b.maxRosterSize, a.maxRosterSize, "up-good"],
    ["Concurrent missions", b.maxConcurrentMissions, a.maxConcurrentMissions, "up-good"],
    ["Minions per mission", b.maxParticipantsPerMission, a.maxParticipantsPerMission, "up-good"],
    ["Hire offers", b.maxHireOffers, a.maxHireOffers, "up-good"],
  ];
  for (const [label, from, to] of caps) {
    if (from !== to) {
      lines.push({ text: `${label} ${from} → ${to}`, tone: to > from ? "good" : "bad" });
    }
  }
  return section("standing", "Standing", lines);
}

function omegaSection(
  catalog: ContentCatalog,
  before: GameState,
  after: GameState,
): TurnSummarySection | null {
  const lines: TurnReportLine[] = [];
  const plan =
    after.activeOmegaPlanId !== null
      ? getOmegaPlanById(catalog, after.activeOmegaPlanId)
      : undefined;
  for (let stage = 0; stage < after.omegaStageProgress.length; stage += 1) {
    for (let slot = 0; slot < after.omegaStageProgress[stage]!.length; slot += 1) {
      if (after.omegaStageProgress[stage]![slot] === before.omegaStageProgress[stage]![slot]) {
        continue;
      }
      const missionId = plan !== undefined ? omegaSlotMissionId(plan, stage, slot) : undefined;
      const name =
        missionId !== undefined ? missionOrEventName(catalog, missionId) : `slot ${slot + 1}`;
      lines.push({
        text: `Phase ${stage + 1} · slot ${slot + 1} complete — ${name}.`,
        tone: "good",
      });
    }
  }
  if (after.activeOmegaStageIndex !== before.activeOmegaStageIndex) {
    lines.push({
      text: `Phase ${before.activeOmegaStageIndex + 1} cleared — phase ${
        after.activeOmegaStageIndex + 1
      } is now active.`,
      tone: "good",
    });
  }
  return section("omega", "Omega Plan", lines);
}

function rosterSection(
  catalog: ContentCatalog,
  before: GameState,
  after: GameState,
  events: ActivityEvent[],
): TurnSummarySection | null {
  const lines: TurnReportLine[] = [];
  const unlockedByLevelUp = new Set<string>();
  for (const ev of events) {
    if (ev.kind !== "minion_leveled_up") {
      continue;
    }
    const who = catalog.minions.find((t) => t.id === ev.templateId)?.name ?? ev.templateId;
    if (ev.traitId !== undefined) {
      unlockedByLevelUp.add(`${ev.instanceId}:${ev.traitId}`);
      lines.push({
        text: `${who} reached level ${ev.newLevel} and unlocked ${traitName(catalog, ev.traitId)}.`,
        tone: "good",
      });
    } else {
      lines.push({ text: `${who} reached level ${ev.newLevel}.`, tone: "good" });
    }
  }
  /* Trait diff catches everything that moved traits — effects and critical-failure injuries
   * alike — without each of them having to log a row of its own. */
  for (const inst of after.player.minions) {
    const prior = before.player.minions.find((m) => m.instanceId === inst.instanceId);
    if (prior === undefined) {
      continue;
    }
    const who = minionName(catalog, after, inst.instanceId);
    for (const traitId of inst.traitIds) {
      if (prior.traitIds.includes(traitId) || unlockedByLevelUp.has(`${inst.instanceId}:${traitId}`)) {
        continue;
      }
      lines.push({
        text: `${who} gained ${traitName(catalog, traitId)}.`,
        tone: traitTone(catalog, traitId),
      });
    }
    for (const traitId of prior.traitIds) {
      if (inst.traitIds.includes(traitId)) {
        continue;
      }
      lines.push({
        text: `${who} lost ${traitName(catalog, traitId)}.`,
        /* Losing a negative status is a win; losing a real trait is not. */
        tone: traitTone(catalog, traitId) === "bad" ? "good" : "bad",
      });
    }
  }
  for (const ev of events) {
    if (ev.kind !== "mission_completed") {
      continue;
    }
    for (const change of ev.relationshipChanges ?? []) {
      lines.push({
        text: formatRelationshipChange(catalog, after.player.minions, change),
        tone: relationshipChangeIsPositive(change) ? "good" : "bad",
      });
    }
    for (const change of ev.standingChanges ?? []) {
      lines.push({
        text: formatStandingChange(catalog, after.player.minions, change),
        tone: standingChangeIsPositive(change) ? "good" : "bad",
      });
    }
  }
  return section("roster", "Minions", lines);
}

function assetsSection(
  catalog: ContentCatalog,
  before: GameState,
  after: GameState,
): TurnSummarySection | null {
  const lines: TurnReportLine[] = [];
  const b = assetTallies(before.player.assets);
  const a = assetTallies(after.player.assets);
  const ids = new Set<string>([...b.keys(), ...a.keys()]);
  for (const id of [...ids].sort()) {
    const delta = (a.get(id) ?? 0) - (b.get(id) ?? 0);
    if (delta === 0) {
      continue;
    }
    lines.push({
      text: `${assetName(catalog, id)} ${signed(delta)} (now ${a.get(id) ?? 0})`,
      tone: delta > 0 ? "good" : "bad",
    });
  }
  return section("assets", "Assets", lines);
}

/** Why an agent went where it went, in the report's voice rather than the enum's. */
const MOVEMENT_REASONS: Record<AgentMovementBehavior, string> = {
  defender: "closing on the gear your Omega phase needs",
  investigator: "working the scene of your last failure",
  hunter: "shadowing one of your minions on the job",
  analyst: "drawn to the site you know best",
  asset_protector: "covering assets left in the open",
  opportunist: "picking the softest site on the map",
};

/**
 * How an agent is named in a report line. An agent the player cannot see stays anonymous — the
 * *effect* is visible (their security jumped, their intel dropped), but the name behind it is
 * not, so the line reads "An unknown agent …".
 */
export function agentReportName(
  catalog: ContentCatalog,
  state: GameState,
  agentInstanceId: string,
  locationId: string,
): string {
  const agent = state.opposingAgentInstances.find((a) => a.instanceId === agentInstanceId);
  if (
    agent === undefined ||
    !isOpposingAgentVisibleToPlayer(agent, intelLevelForLocation(state.locationIntelStates, locationId))
  ) {
    return "An unknown agent";
  }
  return agentName(catalog, state, agentInstanceId);
}

/**
 * One report line for an `agent_ability_used` row, with the agent redacted when the player
 * cannot see who did it. Shared with the Activity panel in `main.ts` so both read alike.
 */
export function describeAgentAbilityUse(
  catalog: ContentCatalog,
  state: GameState,
  ev: Extract<ActivityEvent, { kind: "agent_ability_used" }>,
): string {
  const who = agentReportName(catalog, state, ev.agentInstanceId, ev.locationId);
  const where = locationName(catalog, ev.locationId);
  switch (ev.abilityId) {
    case "brawler":
      return `${who} put the crew in the hospital at ${where}.`;
    case "investigator":
      return `${who} worked the failure at ${where} into extra heat.`;
    case "guard":
      return `${who} held the security line at ${where} — it could not be reduced.`;
    case "security_chief":
      return `${who} raised the security level at ${where}.`;
    case "counterintelligence":
      return `${who} burned your intel at ${where}.`;
    case "asset_protection":
      return ev.assetId !== undefined
        ? `${who} moved ${assetName(catalog, ev.assetId)} back out of sight at ${where}.`
        : `${who} moved an asset back out of sight at ${where}.`;
    default:
      return `${who} acted at ${where}.`;
  }
}

/**
 * The Agent Phase, from the player's side of the glass. Ability uses come first (they are the
 * turn's actions), then the moves the player could actually watch — a hidden agent crossing the
 * map in the dark stays out of it entirely, while one whose *effect* landed is reported
 * anonymously rather than dropped.
 */
function agentsSection(
  catalog: ContentCatalog,
  after: GameState,
  events: readonly ActivityEvent[],
): TurnSummarySection | null {
  const lines: TurnReportLine[] = [];
  for (const ev of events) {
    if (ev.kind === "agent_ability_used") {
      lines.push({ text: describeAgentAbilityUse(catalog, after, ev), tone: "bad" });
    }
  }
  for (const ev of events) {
    if (ev.kind !== "agent_moved") {
      continue;
    }
    if (
      !isOpposingAgentMoveVisibleToPlayer(
        after,
        ev.agentInstanceId,
        ev.fromLocationId,
        ev.toLocationId,
      )
    ) {
      continue;
    }
    lines.push({
      text: `${agentName(catalog, after, ev.agentInstanceId)} moved from ${locationName(
        catalog,
        ev.fromLocationId,
      )} to ${locationName(catalog, ev.toLocationId)} — ${MOVEMENT_REASONS[ev.behavior]}.`,
      tone: "bad",
    });
  }
  return section("agents", "Agents", lines);
}

function sitesSection(
  catalog: ContentCatalog,
  before: GameState,
  after: GameState,
): TurnSummarySection | null {
  const lines: TurnReportLine[] = [];
  for (const st of after.locationSecurityStates) {
    const prior = before.locationSecurityStates.find((s) => s.locationId === st.locationId);
    if (prior === undefined || prior.securityLevel === st.securityLevel) {
      continue;
    }
    lines.push({
      text: `Security at ${locationName(catalog, st.locationId)} ${prior.securityLevel} → ${st.securityLevel}`,
      tone: st.securityLevel > prior.securityLevel ? "bad" : "good",
    });
  }
  for (const st of after.locationIntelStates) {
    const prior = before.locationIntelStates.find((s) => s.locationId === st.locationId);
    if (prior === undefined || prior.intelLevel === st.intelLevel) {
      continue;
    }
    lines.push({
      text: `Intel at ${locationName(catalog, st.locationId)} ${prior.intelLevel} → ${st.intelLevel}`,
      tone: st.intelLevel > prior.intelLevel ? "good" : "bad",
    });
  }
  for (const placement of after.locationAssetSlots) {
    const prior = before.locationAssetSlots.find((p) => p.locationId === placement.locationId);
    if (prior === undefined) {
      continue;
    }
    let revealed = 0;
    let emptied = 0;
    for (let i = 0; i < placement.slots.length; i += 1) {
      const now = placement.slots[i];
      const was = prior.slots[i];
      if (now === undefined || was === undefined || occupiedSlotKey(now) === occupiedSlotKey(was)) {
        continue;
      }
      if (isOccupiedAssetSlot(was) && !isOccupiedAssetSlot(now)) {
        emptied += 1;
      } else if (
        isOccupiedAssetSlot(now) &&
        isOccupiedAssetSlot(was) &&
        was.visibility === "hidden" &&
        now.visibility === "revealed"
      ) {
        revealed += 1;
      }
    }
    const where = locationName(catalog, placement.locationId);
    if (revealed > 0) {
      lines.push({
        text: `${revealed} asset slot${revealed === 1 ? "" : "s"} uncovered at ${where}.`,
        tone: "good",
      });
    }
    if (emptied > 0) {
      lines.push({
        text: `${emptied} asset${emptied === 1 ? "" : "s"} taken from ${where}.`,
        tone: "good",
      });
    }
  }
  const priorAgentIds = new Set(before.opposingAgentInstances.map((a) => a.instanceId));
  const locationOfAgent = (state: GameState, instanceId: string): string | null =>
    state.locationAgentPresence.find((r) => r.agentInstanceIds.includes(instanceId))?.locationId ??
    null;
  for (const agent of after.opposingAgentInstances) {
    const where = locationOfAgent(after, agent.instanceId);
    const whereLabel = where !== null ? locationName(catalog, where) : "an unknown site";
    if (!priorAgentIds.has(agent.instanceId)) {
      lines.push({
        text: `${agentName(catalog, after, agent.instanceId)} deployed to ${whereLabel}.`,
        tone: "bad",
      });
      continue;
    }
    const prior = before.opposingAgentInstances.find((a) => a.instanceId === agent.instanceId);
    if (
      prior !== undefined &&
      prior.catalogVisibility === "hidden" &&
      agent.catalogVisibility === "revealed"
    ) {
      lines.push({
        text: `${agentName(catalog, after, agent.instanceId)} identified at ${whereLabel}.`,
        tone: "neutral",
      });
    }
  }
  return section("sites", "Sites", lines);
}

function eventsSection(
  catalog: ContentCatalog,
  before: GameState,
  after: GameState,
  events: ActivityEvent[],
): TurnSummarySection | null {
  const lines: TurnReportLine[] = [];
  for (const ev of events) {
    if (ev.kind === "event_expired") {
      const name = missionOrEventName(catalog, ev.eventTemplateId);
      lines.push({
        text:
          ev.effectDescriptions.length === 0
            ? `"${name}" expired unclaimed.`
            : `"${name}" expired unclaimed — ${ev.effectDescriptions.join("; ")}.`,
        tone: "bad",
      });
    } else if (ev.kind === "event_rotated_in") {
      lines.push({
        text: `New event on the table: "${missionOrEventName(catalog, ev.eventTemplateId)}" — ${
          ev.lifetimeTurns
        } turn${ev.lifetimeTurns === 1 ? "" : "s"} to act.`,
        tone: "neutral",
      });
    }
  }
  const beforeModifier = before.activeSuccessModifiers.reduce((s, m) => s + m.delta, 0);
  const afterModifier = after.activeSuccessModifiers.reduce((s, m) => s + m.delta, 0);
  if (afterModifier !== beforeModifier) {
    lines.push({
      text:
        afterModifier === 0
          ? "Temporary success-chance modifiers have run out."
          : `Success chance modifier now ${signed(afterModifier)}%.`,
      tone: afterModifier > beforeModifier ? "good" : "bad",
    });
  }
  return section("events", "Global Events", lines);
}

function recruitmentSection(
  catalog: ContentCatalog,
  before: GameState,
  after: GameState,
): TurnSummarySection | null {
  const lines: TurnReportLine[] = [];
  const same =
    before.availableMinionTemplateIds.length === after.availableMinionTemplateIds.length &&
    before.availableMinionTemplateIds.every(
      (id, i) => after.availableMinionTemplateIds[i] === id,
    );
  if (!same) {
    const names = after.availableMinionTemplateIds.map(
      (id) => catalog.minions.find((m) => m.id === id)?.name ?? id,
    );
    lines.push({
      text:
        names.length === 0
          ? "No recruits available next turn."
          : `Hire pool refreshed: ${names.join(", ")}.`,
      tone: names.length === 0 ? "bad" : "neutral",
    });
  }
  return section("recruitment", "Recruitment", lines);
}

function lairSection(
  catalog: ContentCatalog,
  before: GameState,
  after: GameState,
): TurnSummarySection | null {
  const lines: TurnReportLine[] = [];
  for (const id of after.lairMissionIds) {
    if (!before.lairMissionIds.includes(id)) {
      lines.push({
        text: `New lair mission unlocked: ${missionOrEventName(catalog, id)}.`,
        tone: "good",
      });
    }
  }
  for (const id of after.completedLairUpgradeMissionIds) {
    if (before.completedLairUpgradeMissionIds.includes(id)) {
      continue;
    }
    const levelIndex = lairUpgradeLevelIndexOfMission(after.activeLairId, id, catalog);
    const levels = lairUpgradeLevels(after.activeLairId, catalog);
    const label =
      levelIndex === -1
        ? "Lair upgrade installed"
        : `Lair upgrade level ${levelIndex + 1} installed`;
    lines.push({
      text: `${label}: ${missionOrEventName(catalog, id)}.`,
      tone: "good",
    });
    /* The choice is one-way — name what it cost so the player sees the trade, once. */
    const lockedOut = (levels[levelIndex]?.missionIds ?? []).filter((mid) => mid !== id);
    if (lockedOut.length > 0) {
      lines.push({
        text: `Locked out for this run: ${lockedOut
          .map((mid) => missionOrEventName(catalog, mid))
          .join(", ")}.`,
        tone: "neutral",
      });
    }
    const remaining = levels.length - (levelIndex + 1);
    lines.push({
      text:
        remaining > 0
          ? `Upgrade level ${levelIndex + 2} of ${levels.length} is now open.`
          : "Every lair upgrade level is installed.",
      tone: "neutral",
    });
  }
  /* An infamy-gated level is visible the whole time; the turn it becomes runnable is the
   * news, so report the crossing rather than leaving the player to re-read the card. */
  const currentAfter = currentLairUpgradeLevel(
    after.activeLairId,
    after.completedLairUpgradeMissionIds,
    catalog,
  );
  if (currentAfter !== null && lairUpgradeLevelMinInfamy(currentAfter.level) > 0) {
    const wasOpen =
      isLairUpgradeLevelUnlocked(currentAfter.level, before.player.infamy) &&
      currentLairUpgradeLevelIndexOf(before, catalog) === currentAfter.index;
    if (!wasOpen && isLairUpgradeLevelUnlocked(currentAfter.level, after.player.infamy)) {
      lines.push({
        text: `Upgrade level ${currentAfter.index + 1} is now within reach — ${lairUpgradeLevelMinInfamy(
          currentAfter.level,
        )} infamy met.`,
        tone: "good",
      });
    }
  }
  return section("lair", "Lair", lines);
}

/** Ladder position of a snapshot, for comparing "same level" across a resolve. */
function currentLairUpgradeLevelIndexOf(state: GameState, catalog: ContentCatalog): number {
  return (
    currentLairUpgradeLevel(
      state.activeLairId,
      state.completedLairUpgradeMissionIds,
      catalog,
    )?.index ?? -1
  );
}

/**
 * Builds the end-of-turn report from the pre-`executePlan` snapshot and the state it returned.
 * `after` must still be in the `summary` phase — the report describes the turn that just
 * resolved, not the one `advanceToNextTurn` opens.
 */
export function buildTurnReport(
  before: GameState,
  after: GameState,
  catalog: ContentCatalog,
): TurnReport {
  const events = resolveActivityEvents(before, after);
  const missions = buildMissionReports(catalog, before, after, events);
  const summary = [
    missionsSection(catalog, after, missions),
    standingSection(catalog, before, after),
    omegaSection(catalog, before, after),
    rosterSection(catalog, before, after, events),
    assetsSection(catalog, before, after),
    sitesSection(catalog, before, after),
    agentsSection(catalog, after, events),
    eventsSection(catalog, before, after, events),
    lairSection(catalog, before, after),
    recruitmentSection(catalog, before, after),
  ].filter((s): s is TurnSummarySection => s !== null);
  return { turnNumber: before.turnNumber, missions, summary };
}


/* -------------------------------------------------------------------------------------------
 * Run-end report: the data behind the two modals that replace the end-of-turn report once
 * `GameState.runEnding` is set — a Victory or Game Over modal, then the Run Summary
 * (see `main.ts`). Unlike the turn report this reads a single snapshot: the run is finished,
 * so there is no "before" to diff against, and career tallies come from the whole `activityLog`.
 *
 * Victory prose is **content**, not code: it comes from the completed plan's `victoryTitle` /
 * `victoryNarrative` so each Omega Plan ends its own way. Defeat prose is generated here —
 * there is no per-plan authoring seam for losing.
 * ----------------------------------------------------------------------------------------- */

export type RunEndReport = {
  ending: RunEnding;
  /** Turn the run ended on. */
  turnNumber: number;
  organizationName: string;
  playerName: string;
  /** Headline for the first modal (the plan's `victoryTitle` on a win). */
  title: string;
  /** Short verdict chip beside the headline. */
  verdict: string;
  /** Prose for the first modal, one paragraph per entry. */
  narrative: string[];
  /** Blocks for the Run Summary modal. */
  summary: TurnSummarySection[];
};

/** Every event row in the log, oldest turn first (the log itself is newest-turn-first). */
function allActivityEvents(state: GameState): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  for (let i = state.activityLog.length - 1; i >= 0; i -= 1) {
    out.push(...state.activityLog[i]!.events);
  }
  return out;
}

function careerSection(catalog: ContentCatalog, state: GameState): TurnSummarySection | null {
  const events = allActivityEvents(state);
  let won = 0;
  let lost = 0;
  let hired = 0;
  let levelUps = 0;
  let eventsAnswered = 0;
  let eventsIgnored = 0;
  const eventIds = new Set(catalog.events.map((e) => e.id));
  for (const ev of events) {
    if (ev.kind === "mission_completed") {
      if (ev.success) {
        won += 1;
      } else {
        lost += 1;
      }
      if (eventIds.has(ev.missionTemplateId)) {
        eventsAnswered += 1;
      }
    } else if (ev.kind === "minion_hired" || ev.kind === "minion_rehired") {
      hired += 1;
    } else if (ev.kind === "minion_leveled_up") {
      levelUps += 1;
    } else if (ev.kind === "event_expired") {
      eventsIgnored += 1;
    }
  }
  const run = won + lost;
  const lines: TurnReportLine[] = [
    {
      text: `${run} mission${run === 1 ? "" : "s"} resolved — ${won} won, ${lost} lost.`,
      tone: won > lost ? "good" : run === 0 ? "neutral" : "bad",
    },
    {
      text: `${hired} recruit${hired === 1 ? "" : "s"} brought in, ${levelUps} promotion${
        levelUps === 1 ? "" : "s"
      } earned.`,
      tone: "neutral",
    },
    {
      text: `${eventsAnswered} global event${
        eventsAnswered === 1 ? "" : "s"
      } answered, ${eventsIgnored} left to expire.`,
      tone: eventsIgnored > eventsAnswered ? "bad" : "neutral",
    },
  ];
  return section("career", "Career", lines);
}

function finalStandingSection(
  catalog: ContentCatalog,
  state: GameState,
  ending: RunEnding,
): TurnSummarySection | null {
  const p = state.player;
  const tier = catalog.wantedLevels[state.wantedLevelTierIndex];
  const turns = state.turnNumber;
  const won = ending.kind === "victory";
  const lines: TurnReportLine[] = [
    {
      text: won
        ? `Plan completed on turn ${turns}.`
        : `Survived ${turns} turn${turns === 1 ? "" : "s"}.`,
      tone: won ? "good" : "neutral",
    },
    { text: `Final infamy ${p.infamy}.`, tone: p.infamy >= 50 ? "good" : "neutral" },
    { text: `Final heat ${p.heat}.`, tone: p.heat >= 50 ? "bad" : "neutral" },
    {
      text: `Threat level ${tier?.name ?? `tier ${state.wantedLevelTierIndex + 1}`}.`,
      tone: won ? "neutral" : "bad",
    },
  ];
  return section("final-standing", "Final standing", lines);
}

function finalOmegaSection(
  catalog: ContentCatalog,
  state: GameState,
  ending: RunEnding,
): TurnSummarySection | null {
  const plan =
    state.activeOmegaPlanId !== null
      ? getOmegaPlanById(catalog, state.activeOmegaPlanId)
      : undefined;
  if (plan === undefined) {
    return null;
  }
  const won = ending.kind === "victory";
  const done = state.omegaStageProgress.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  const needed = omegaPlanRequiredMissionTotal(plan);
  const lines: TurnReportLine[] = [
    {
      text: won
        ? `${plan.name} — all three phases cleared.`
        : `${plan.name} — reached phase ${state.activeOmegaStageIndex + 1} of 3.`,
      tone: won ? "good" : "neutral",
    },
    {
      text: `${done} of ${needed} required objective${needed === 1 ? "" : "s"} completed.`,
      tone: done >= needed ? "good" : "bad",
    },
  ];
  for (let stage = 0; stage < state.omegaStageProgress.length; stage += 1) {
    const row = state.omegaStageProgress[stage]!;
    const cleared = row.filter(Boolean).length;
    const need = omegaStageRequiredMissions(plan, stage);
    lines.push({
      text: `Phase ${stage + 1}: ${cleared}/${need} — ${cleared >= need ? "cleared" : "unfinished"}.`,
      tone: cleared >= need ? "good" : "neutral",
    });
  }
  return section("final-omega", "Omega Plan", lines);
}

function finalOrganizationSection(
  catalog: ContentCatalog,
  state: GameState,
  ending: RunEnding,
): TurnSummarySection | null {
  const p = state.player;
  const lines: TurnReportLine[] = [];
  if (p.minions.length === 0) {
    lines.push({ text: "No minions left on the roster.", tone: "bad" });
  } else {
    const best = [...p.minions].sort((a, b) => b.currentLevel - a.currentLevel);
    lines.push({
      text: `${p.minions.length} minion${p.minions.length === 1 ? "" : "s"} on the roster ${
        ending.kind === "victory" ? "at the finish" : "at the end"
      }.`,
      tone: "neutral",
    });
    for (const m of best.slice(0, 3)) {
      lines.push({
        text: `${minionName(catalog, state, m.instanceId)} — level ${m.currentLevel}.`,
        tone: "neutral",
      });
    }
  }
  const assetTotal = Object.values(p.assets).reduce((sum, q) => sum + Math.max(0, q), 0);
  lines.push({
    text: `${assetTotal} asset${assetTotal === 1 ? "" : "s"} in the vault.`,
    tone: "neutral",
  });
  const lair = state.activeLairId !== null ? getLairById(catalog, state.activeLairId) : undefined;
  if (lair !== undefined) {
    const installed = state.completedLairUpgradeMissionIds.length;
    const total = lair.upgradeLevels.length;
    lines.push({
      text:
        total > 0
          ? `${lair.name} — ${installed} of ${total} upgrade level${total === 1 ? "" : "s"} installed.`
          : `${lair.name} — no upgrades available.`,
      tone: "neutral",
    });
  }
  return section("final-organization", "Organization", lines);
}

/**
 * Victory copy for the plan that was completed. The prose is designer-authored on the plan;
 * a plan that shipped without any gets a plain generated ending rather than an invented one.
 */
function victoryCopy(
  catalog: ContentCatalog,
  state: GameState,
  omegaPlanId: string | null,
): { title: string; narrative: string[] } {
  const plan = omegaPlanId !== null ? getOmegaPlanById(catalog, omegaPlanId) : undefined;
  const title = plan?.victoryTitle ?? "Omega Complete";
  const authored = plan?.victoryNarrative ?? [];
  if (authored.length > 0) {
    return { title, narrative: [...authored] };
  }
  return {
    title,
    narrative: [
      `${plan?.name ?? "The Omega Plan"} is complete — every phase cleared, on turn ${state.turnNumber}.`,
      `${state.organizationName} answers to nobody now, and ${state.playerName} answers to less than that.`,
    ],
  };
}

function defeatCopy(
  catalog: ContentCatalog,
  state: GameState,
  reason: GameOverReason,
): { title: string; verdict: string; narrative: string[] } {
  const raidName = catalog.events.find((e) => e.special === "lair_raid")?.name ?? "the raid";
  const closing = `${state.organizationName} is a case file now, and ${state.playerName} is a name in it.`;
  return {
    title: "Game Over",
    verdict: reason === "lair_raid_expired" ? "Overrun" : "Captured",
    narrative:
      reason === "lair_raid_expired"
        ? [
            `${raidName} was never answered. The doors came down on turn ${state.turnNumber} with nobody standing behind them.`,
            closing,
          ]
        : [
            `${raidName} was met — and lost. What was left of the guard did not hold the lair through turn ${state.turnNumber}.`,
            closing,
          ],
  };
}

/**
 * Build the two-step end-of-run report. `state` is the post-`executePlan` snapshot whose
 * `runEnding` is set; `ending` is passed explicitly so callers cannot build one for a living run.
 */
export function buildRunEndReport(
  state: GameState,
  catalog: ContentCatalog,
  ending: RunEnding,
): RunEndReport {
  const copy =
    ending.kind === "victory"
      ? { ...victoryCopy(catalog, state, ending.omegaPlanId), verdict: "Omega Complete" }
      : defeatCopy(catalog, state, ending.reason);
  const summary = [
    finalStandingSection(catalog, state, ending),
    finalOmegaSection(catalog, state, ending),
    careerSection(catalog, state),
    finalOrganizationSection(catalog, state, ending),
  ].filter((s): s is TurnSummarySection => s !== null);
  return {
    ending,
    turnNumber: state.turnNumber,
    organizationName: state.organizationName,
    playerName: state.playerName,
    title: copy.title,
    verdict: copy.verdict,
    narrative: copy.narrative,
    summary,
  };
}
