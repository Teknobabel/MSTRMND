import { resizeCanvasToDisplaySize, setupCanvas } from "./canvas/setup";
import {
  advanceToNextTurn,
  assignMission,
  busyInstanceIds,
  cancelMission,
  createInitialGameState,
  executePlan,
  fireMinion,
  getMissionTargetLocationId,
  hireMinion,
  missionSuccessOptionsForTarget,
  missionTargetMatchesTemplate,
  rehireMinion,
  rerollHireOffers,
  type ActiveMission,
  type ActivityEvent,
  type GameError,
  type GameState,
  type Result,
} from "./game/gameState";
import type {
  DynamicTrait,
  LocationAssetSlot,
  LocationType,
  MinionInstance,
  MissionSource,
  MissionTarget,
  MissionTargetType,
  MissionTemplate,
  Trait,
} from "./game/types";
import { isOccupiedAssetSlot } from "./game/types";
import {
  canAssignParticipants,
  computeSuccessChanceBreakdown,
  mergedRequiredTraitIdsSorted,
  type SuccessChanceBreakdown,
} from "./game/mission";
import {
  dynamicTraitDisplayLabel,
  dynamicTraitSuccessModifierBreakdownFromFullRoster,
  dynamicTraitSuccessModifierFromFullRoster,
  formatDynamicTraitActivityChange,
  formatStartingDynamicTraitsPreview,
  isPositiveDynamicTraitKind,
  type DynamicTraitSuccessBreakdownEntry,
} from "./game/dynamicTrait";
import { describeMissionTemplateEffects } from "./game/missionEffects";
import {
  buildRunEndReport,
  buildTurnReport,
  type RunEndReport,
  type MissionResultReport,
  type TurnReport,
  type TurnReportLine,
} from "./game/turnReport";
import { loadContent } from "./game/loadContent";
import {
  locationTemplatesForOmegaPlan,
} from "./game/locationCatalog";
import { getAgentTemplateById } from "./game/agent";
import {
  assetSlotKnowledge,
  countPlayerVisibleOpposingAgentsAtLocation,
  effectiveVisibilityOfSlot,
  intelLevelAtLocation,
  playerVisibleOpposingAgentsAtLocation,
  totalPlayerVisibleOpposingAgents,
  MAX_INTEL_LEVEL,
} from "./game/intel";
import {
  currentLairUpgradeLevel,
  getLairById,
  lairUpgradeLevels,
} from "./game/lair";
import {
  getOmegaPlanById,
  OMEGA_MISSIONS_PER_STAGE,
  OMEGA_STAGE_COUNT,
  omegaPlanRequiredMissionTotal,
  omegaStageRequiredMissions,
} from "./game/omegaPlan";
import { wantedTierAtIndex } from "./game/wantedLevel";
import { maxHireableStartingLevel, nextHireLevelInfamyThreshold } from "./game/minion";
import { initNavigation, type NavigationApi } from "./navigation";
import { initStageScale } from "./ui/stageScale";
import { initRunSetup, type RunSetupApi } from "./ui/runSetup";
import {
  appendCardArtShell,
  createCardArtImg,
  resolveAgentCardArt,
  resolveAssetCardArt,
  resolveLairCardArt,
  resolveLocationCardArt,
  resolveMissionCardArt,
  resolveMinionCardArt,
} from "./ui/cardArt";

/** What each intel step unlocks at a site (hover text on the location card's Intel row). */
const INTEL_LEVEL_TOOLTIP_LINES: readonly string[] = [
  "0 — assets and agents here stay secret unless uncovered another way",
  "1 — every asset slot is listed (contents still unknown)",
  "2 — asset contents are identified and count as revealed for missions",
  "3 — opposing agents here are visible, including any that arrive later",
];

/** Tabs left-to-right; locations filtered and sorted by name within each. */
const LOCATION_CATEGORY_TAB_ORDER: readonly LocationType[] = [
  "economic",
  "political",
  "military",
] as const;

const LOCATION_CATEGORY_LABEL: Record<LocationType, string> = {
  economic: "Economic",
  political: "Political",
  military: "Military",
};

const GAME_MENU_VALUES = [
  "dashboard",
  "omega",
  "missions",
  "minions",
  "locations",
  "lair",
  "assets",
  "events",
] as const;

type GameMenu = (typeof GAME_MENU_VALUES)[number];

function isGameMenu(value: string | undefined): value is GameMenu {
  return value !== undefined && (GAME_MENU_VALUES as readonly string[]).includes(value);
}

/* Inline SVG icons for the OMEGA OS status bar (stroked via CSS). */
const ICON_BOLT =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4.5 13.5H10L9 22l8.5-11.5H12L13 2Z"/></svg>';
const ICON_EYE =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_PERSON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7.5" r="4"/><path d="M4.5 21v-1.5a6 6 0 0 1 6-6h3a6 6 0 0 1 6 6V21"/></svg>';
const ICON_FLAME =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5s5.5 4.4 5.5 9.4a5.5 5.5 0 0 1-11 0c0-2 1-3.6 2-4.8.3 1.4 1.1 2.3 2 2.3 1.3 0 1.8-1.3 1.8-3 0-1.4-.3-2.7-.3-3.9Z"/></svg>';
const ICON_CROSSHAIR =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></svg>';
const ICON_SKULL_FILLED =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M12 2C7.1 2 3.5 5.6 3.5 10.2c0 2.9 1.5 5 3.5 6.3V20a1 1 0 0 0 1 1h1.6v-2.2h1.5V21h1.8v-2.2h1.5V21H16a1 1 0 0 0 1-1v-3.5c2-1.3 3.5-3.4 3.5-6.3C20.5 5.6 16.9 2 12 2Zm-3.2 10.8a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm6.4 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z"/></svg>';

function statBlockHtml(
  iconHtml: string,
  label: string,
  valueHtml: string,
  extraClass = "",
): string {
  const cls = extraClass === "" ? "stat-block" : `stat-block ${extraClass}`;
  return `
    <div class="${cls}">
      <span class="stat-block__icon">${iconHtml}</span>
      <div class="stat-block__main">
        <span class="stat-block__label">${label}</span>
        <span class="stat-block__value">${valueHtml}</span>
      </div>
    </div>`;
}

const catalog = loadContent();
console.info(
  "[Mastermind] content:",
  catalog.traits.length,
  "traits,",
  catalog.minions.length,
  "minion templates,",
  catalog.agents.length,
  "agent templates,",
  catalog.missions.length,
  "missions,",
  catalog.locations.length,
  "locations,",
  catalog.maps.length,
  "maps,",
  catalog.assets.length,
  "assets,",
  catalog.omegaPlans.length,
  "omega plans,",
  catalog.events.length,
  "events,",
  catalog.organizationNames.length,
  "organization names,",
  catalog.playerProfiles.length,
  "player profiles,",
  catalog.wantedLevels.length,
  "wanted levels",
);

const canvasLookup = document.getElementById("game-canvas");
if (!(canvasLookup instanceof HTMLCanvasElement)) {
  throw new Error("Expected #game-canvas to be an HTMLCanvasElement");
}
const canvas = canvasLookup;

const ctx = setupCanvas(canvas);

/** Cached hex-grid layer for the OMEGA OS map background; rebuilt on resize. */
let bgHexGrid: HTMLCanvasElement | null = null;
let bgHexGridW = 0;
let bgHexGridH = 0;

function buildHexGridLayer(width: number, height: number): HTMLCanvasElement {
  const layer = document.createElement("canvas");
  layer.width = width;
  layer.height = height;
  const g = layer.getContext("2d");
  if (!g) {
    return layer;
  }
  const r = Math.max(22, Math.min(width, height) / 28);
  const hexH = Math.sqrt(3) * r;
  g.strokeStyle = "rgba(232, 17, 45, 0.09)";
  g.lineWidth = 1;
  for (let col = 0; col * r * 1.5 < width + r * 2; col += 1) {
    const cx = col * r * 1.5;
    const yOffset = col % 2 === 1 ? hexH / 2 : 0;
    for (let row = 0; row * hexH < height + hexH * 2; row += 1) {
      const cy = row * hexH + yOffset;
      g.beginPath();
      for (let i = 0; i < 6; i += 1) {
        const a = (Math.PI / 3) * i;
        const x = cx + r * Math.cos(a);
        const y = cy + r * Math.sin(a);
        if (i === 0) {
          g.moveTo(x, y);
        } else {
          g.lineTo(x, y);
        }
      }
      g.closePath();
      g.stroke();
    }
  }
  return layer;
}

/** Relative positions of ambient "operations" glow hotspots on the map grid. */
const BG_GLOW_SPOTS: ReadonlyArray<readonly [number, number]> = [
  [0.16, 0.28],
  [0.46, 0.55],
  [0.74, 0.3],
  [0.3, 0.78],
  [0.88, 0.72],
  [0.6, 0.18],
];

function drawGameFrame(timeMs: number): void {
  resizeCanvasToDisplaySize(canvas);
  const { width, height } = canvas;
  const t = timeMs / 1000;

  ctx.fillStyle = "#070304";
  ctx.fillRect(0, 0, width, height);

  if (bgHexGrid === null || bgHexGridW !== width || bgHexGridH !== height) {
    bgHexGrid = buildHexGridLayer(width, height);
    bgHexGridW = width;
    bgHexGridH = height;
  }
  ctx.globalAlpha = 0.6 + 0.25 * Math.sin(t * 0.6);
  ctx.drawImage(bgHexGrid, 0, 0);
  ctx.globalAlpha = 1;

  for (let i = 0; i < BG_GLOW_SPOTS.length; i += 1) {
    const [fx, fy] = BG_GLOW_SPOTS[i]!;
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.8 + i * 1.9);
    const radius = Math.min(width, height) * (0.14 + 0.06 * pulse);
    const cx = fx * width;
    const cy = fy * height;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, `rgba(190, 16, 36, ${(0.08 + 0.07 * pulse).toFixed(3)})`);
    grad.addColorStop(1, "rgba(190, 16, 36, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }
}

let rafId: number | null = null;

function tick(timeMs: number): void {
  drawGameFrame(timeMs);
  rafId = requestAnimationFrame(tick);
}

function startGameLoop(): void {
  if (rafId !== null) {
    return;
  }
  rafId = requestAnimationFrame(tick);
}

function stopGameLoop(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function req<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing #${id}`);
  }
  return el as T;
}

function traitStatusModifierClass(trait: Trait | undefined): string {
  if (trait === undefined) {
    return "";
  }
  if (trait.type === "status_negative") {
    return "assign-minion-chip-trait--status-negative";
  }
  if (trait.type === "status_positive") {
    return "assign-minion-chip-trait--status-positive";
  }
  return "";
}

function minionsDynamicPillModifierClass(dt: DynamicTrait): string {
  return isPositiveDynamicTraitKind(dt.kind)
    ? "minions-trait-pill--dynamic-positive"
    : "minions-trait-pill--dynamic-negative";
}

function assignChipDynamicPillModifierClass(dt: DynamicTrait): string {
  return isPositiveDynamicTraitKind(dt.kind)
    ? "assign-minion-chip-trait--dynamic-positive"
    : "assign-minion-chip-trait--dynamic-negative";
}

function previewDynamicPillModifierClass(label: string): string {
  if (
    label.startsWith("Friend ") ||
    label.startsWith("Lover ") ||
    label.startsWith("Hero ")
  ) {
    return "minions-trait-pill--dynamic-positive";
  }
  return "minions-trait-pill--dynamic-negative";
}

function appendMinionTraitsRow(
  dl: HTMLElement,
  catalog: ReturnType<typeof loadContent>,
  traitIds: string[],
  dynamic?:
    | { roster: MinionInstance[]; traits: readonly DynamicTrait[] }
    | { previewLabels: readonly string[] },
): void {
  const dt = document.createElement("dt");
  dt.textContent = "Traits";
  const dd = document.createElement("dd");
  dd.className = "minions-card-traits-dd";
  const previewLabels =
    dynamic !== undefined && "previewLabels" in dynamic ? dynamic.previewLabels : [];
  const rosterTraits =
    dynamic !== undefined && "roster" in dynamic ? dynamic.traits : [];
  const roster =
    dynamic !== undefined && "roster" in dynamic ? dynamic.roster : [];
  const hasStatic = traitIds.length > 0;
  const hasDynamic = rosterTraits.length > 0;
  const hasPreview = previewLabels.length > 0;
  if (!hasStatic && !hasDynamic && !hasPreview) {
    dd.textContent = "—";
    dl.appendChild(dt);
    dl.appendChild(dd);
    return;
  }
  const wrap = document.createElement("span");
  wrap.className = "minions-card-traits-wrap";
  const appendCommaSep = (): void => {
    const sep = document.createElement("span");
    sep.className = "minions-card-traits-sep";
    sep.textContent = ", ";
    wrap.appendChild(sep);
  };
  for (let i = 0; i < traitIds.length; i += 1) {
    if (i > 0) {
      appendCommaSep();
    }
    const tid = traitIds[i]!;
    const trait = catalog.traits.find((t) => t.id === tid);
    const span = document.createElement("span");
    span.className = "minions-trait-pill";
    span.textContent = trait?.name ?? tid;
    if (trait?.type === "status_negative") {
      span.classList.add("minions-trait-pill--status-negative");
    } else if (trait?.type === "status_positive") {
      span.classList.add("minions-trait-pill--status-positive");
    }
    wrap.appendChild(span);
  }
  for (let j = 0; j < rosterTraits.length; j += 1) {
    if (wrap.childNodes.length > 0) {
      appendCommaSep();
    }
    const dtrait = rosterTraits[j]!;
    const span = document.createElement("span");
    span.className = `minions-trait-pill ${minionsDynamicPillModifierClass(dtrait)}`;
    span.textContent = dynamicTraitDisplayLabel(catalog, roster, dtrait);
    wrap.appendChild(span);
  }
  for (let k = 0; k < previewLabels.length; k += 1) {
    if (wrap.childNodes.length > 0) {
      appendCommaSep();
    }
    const span = document.createElement("span");
    span.className = `minions-trait-pill ${previewDynamicPillModifierClass(previewLabels[k]!)}`;
    span.textContent = previewLabels[k]!;
    wrap.appendChild(span);
  }
  dd.appendChild(wrap);
  dl.appendChild(dt);
  dl.appendChild(dd);
}

function styleAssignChipTraitSpan(
  span: HTMLElement,
  catalog: ReturnType<typeof loadContent>,
  traitId: string,
  requiredTraitSet: Set<string>,
): void {
  span.className = "assign-minion-chip-trait";
  if (requiredTraitSet.has(traitId)) {
    span.classList.add("assign-minion-chip-trait--match");
  }
  const trait = catalog.traits.find((t) => t.id === traitId);
  const mod = traitStatusModifierClass(trait);
  if (mod !== "") {
    span.classList.add(mod);
  }
  span.textContent = trait?.name ?? traitId;
}

function traitDisplayNames(
  catalog: ReturnType<typeof loadContent>,
  traitIds: string[],
): string {
  if (traitIds.length === 0) {
    return "—";
  }
  return traitIds
    .map((id) => catalog.traits.find((t) => t.id === id)?.name ?? id)
    .join(", ");
}

function assetDisplayNames(
  catalog: ReturnType<typeof loadContent>,
  assetIds: string[],
): string {
  if (assetIds.length === 0) {
    return "—";
  }
  return assetIds
    .map((id) => catalog.assets.find((a) => a.id === id)?.name ?? id)
    .join(", ");
}

/** Per required-asset slot: filled name or "—" for empty. */
function plannedAssetSlotsDisplay(
  catalog: ReturnType<typeof loadContent>,
  requiredAssetIds: string[],
  plannedAssetIds: (string | null)[],
): string {
  if (requiredAssetIds.length === 0) {
    return "—";
  }
  return requiredAssetIds
    .map((_, i) => {
      const p = plannedAssetIds[i] ?? null;
      if (p === null) {
        return "—";
      }
      return catalog.assets.find((a) => a.id === p)?.name ?? p;
    })
    .join(", ");
}

function minionNameByInstanceId(
  catalog: ReturnType<typeof loadContent>,
  roster: readonly MinionInstance[],
  instanceId: string,
): string {
  const inst = roster.find((m) => m.instanceId === instanceId);
  return inst !== undefined
    ? catalog.minions.find((t) => t.id === inst.templateId)?.name ?? inst.templateId
    : instanceId;
}

/** Revealed vs hidden security stack for UI (order preserved for revealed slice). */
function formatLocationSecurityTraitsDisplay(
  catalog: ReturnType<typeof loadContent>,
  securityTraitIds: string[],
  securityLevel: number | undefined,
): string {
  const k = securityLevel ?? 0;
  const list = securityTraitIds;
  if (list.length === 0) {
    return "None";
  }
  const revealed = list.slice(0, Math.min(k, list.length));
  const hiddenCount = list.length - revealed.length;
  const revealedLabel =
    revealed.length === 0 ? "" : traitDisplayNames(catalog, revealed);
  if (hiddenCount === 0) {
    return revealedLabel;
  }
  if (revealed.length === 0) {
    return `Hidden (${hiddenCount})`;
  }
  return `${revealedLabel} · Hidden (${hiddenCount})`;
}

function formatLocationTypeLabel(locationType: string): string {
  return locationType.charAt(0).toUpperCase() + locationType.slice(1);
}

function formatMissionTargetTypeLabel(tt: MissionTargetType): string {
  const map: Record<MissionTargetType, string> = {
    location: "Location",
    asset_hidden: "Hidden asset",
    asset_revealed: "Revealed asset",
    minion: "Minion",
    none: "None",
  };
  return map[tt];
}

function formatAssignMissionError(err: GameError): string {
  switch (err.code) {
    case "wrong_phase":
      return `Wrong phase (need Main, got ${err.actual}).`;
    case "max_concurrent_missions":
      return `Mission limit reached (${err.have}/${err.max}).`;
    case "unknown_mission":
      return `Unknown mission: ${err.missionId}.`;
    case "wrong_target_kind":
      return `Target type does not match mission (expected ${err.expected}).`;
    case "no_active_lair":
      return "No active lair.";
    case "mission_not_on_lair":
      return "That mission is not available from your lair.";
    case "no_active_omega_plan":
      return "No active Omega plan.";
    case "invalid_omega_stage":
      return `Omega phase mismatch (need phase ${err.expectedStage + 1}).`;
    case "omega_slot_mismatch":
      return "That mission is not in the active Omega row slot.";
    case "invalid_mission_source_binding":
      return `Mission source: ${err.reason}`;
    case "unknown_location":
      return `Unknown location: ${err.locationId}.`;
    case "location_not_on_active_map":
      return "Target location is not on the active map.";
    case "unknown_asset_slot":
    case "empty_asset_slot":
    case "asset_visibility_mismatch":
      return "Target asset slot is invalid or empty.";
    case "unknown_target_minion":
    case "minion_on_mission":
    case "minion_target_in_participants":
      return "Target minion cannot be used.";
    case "unknown_instance":
    case "invalid_participants":
      return err.code === "invalid_participants" ? err.reason : `Unknown minion: ${err.instanceId}.`;
    case "not_enough_cp":
      return `Need ${err.need} CP (${err.have} available).`;
    case "asset_slot_length_mismatch":
      return `Required asset slots out of sync (need ${err.expected}, have ${err.got}). Try re-selecting the mission.`;
    case "asset_slot_id_mismatch":
      return `Wrong asset in slot ${err.slotIndex + 1} (expected ${err.expectedAssetId}).`;
    case "not_enough_assets":
      return `Not enough ${err.assetId} (need ${err.need}, have ${err.have}).`;
    case "no_current_event_offer":
      return "No rotating event is available right now.";
    case "event_mission_mismatch":
      return `That event is not the current offer (current: ${err.currentOffer ?? "none"}).`;
    default:
      return `Cannot assign (${(err as { code: string }).code}).`;
  }
}

type GameControllerApi = {
  /** Throw away the current run and roll a fresh one from the title screen's picks. */
  startRun: () => void;
};

function initGameController(
  content: ReturnType<typeof loadContent>,
  nav: NavigationApi,
  runSetup: RunSetupApi,
): GameControllerApi {
  let state: GameState = createInitialGameState(content, undefined, runSetup.read());
  let missionFxTooltipSerial = 0;

  const organizationNameEl = req<HTMLElement>("organization-name");
  const playerNameEl = req<HTMLElement>("player-name");
  const playerProfilePicEl = req<HTMLImageElement>("player-profile-pic");
  const statsEl = req<HTMLElement>("game-stats");
  const activityPanelEl = req<HTMLElement>("activity-panel");
  const minionsRosterEl = req<HTMLElement>("minions-roster-list");
  const minionsAvailableEl = req<HTMLElement>("minions-available-list");
  const minionsRosterHeading = req<HTMLElement>("minions-roster-heading");
  const minionsAvailableHeading = req<HTMLElement>("minions-available-heading");
  const minionsHireGateEl = req<HTMLElement>("minions-hire-gate");
  const assignMissionSlotEl = req<HTMLElement>("assign-mission-slot");
  const assignTargetSlotEl = req<HTMLElement>("assign-target-slot");
  const assignTargetFieldEl = req<HTMLElement>("assign-target-field");
  const assignTargetLabelEl = req<HTMLElement>("assign-target-label");
  const minionsList = req<HTMLElement>("assign-minions-list");
  const assignAssetSlotsFieldset = req<HTMLFieldSetElement>("assign-asset-slots-fieldset");
  const assignAssetSlotsList = req<HTMLElement>("assign-asset-slots-list");
  const btnAssign = req<HTMLButtonElement>("btn-assign-mission");
  const btnExec = req<HTMLButtonElement>("btn-execute-plan");
  const btnRerollHire = req<HTMLButtonElement>("btn-reroll-hire");
  const turnReportOverlay = req<HTMLElement>("overlay-turn-report");
  const turnReportKicker = req<HTMLElement>("turn-report-kicker");
  const turnReportTitle = req<HTMLElement>("turn-report-title");
  const turnReportVerdict = req<HTMLElement>("turn-report-verdict");
  const turnReportStepsEl = req<HTMLElement>("turn-report-steps");
  const turnReportBody = req<HTMLElement>("turn-report-body");
  const btnTurnReportContinue = req<HTMLButtonElement>("btn-turn-report-continue");
  const btnTurnReportSkip = req<HTMLButtonElement>("btn-turn-report-skip");
  const runEndOverlay = req<HTMLElement>("overlay-run-end");
  const runEndKicker = req<HTMLElement>("run-end-kicker");
  const runEndTitle = req<HTMLElement>("run-end-title");
  const runEndVerdict = req<HTMLElement>("run-end-verdict");
  const runEndStepsEl = req<HTMLElement>("run-end-steps");
  const runEndBody = req<HTMLElement>("run-end-body");
  const btnRunEndContinue = req<HTMLButtonElement>("btn-run-end-continue");
  const hudShort = req<HTMLElement>("game-hud-short");
  const threatLevelEl = req<HTMLElement>("threat-level");
  const globalTickerEl = req<HTMLElement>("global-events-ticker");
  const omegaPlanPanelEl = req<HTMLElement>("omega-plan-panel");
  const locationsPanelEl = req<HTMLElement>("locations-panel");
  const assetsPanelEl = req<HTMLElement>("assets-panel");
  const missionsPanelRootEl = req<HTMLElement>("missions-panel-root");
  const missionsPanelTitleEl = req<HTMLElement>("missions-panel-title");
  const eventsPanelEl = req<HTMLElement>("events-panel");
  const lairPanelEl = req<HTMLElement>("lair-panel");
  const planColumnTabPlan = req<HTMLButtonElement>("plan-column-tab-plan");
  const planColumnTabActivity = req<HTMLButtonElement>("plan-column-tab-activity");
  const planColumnPanelPlan = req<HTMLElement>("plan-column-panel-plan");
  const planColumnPanelActivity = req<HTMLElement>("plan-column-panel-activity");
  const rightColumnsRowElLookup = document.querySelector<HTMLElement>(".game-ui-columns-row");
  if (rightColumnsRowElLookup === null) {
    throw new Error("Missing .game-ui-columns-row");
  }
  const rightColumnsRowEl = rightColumnsRowElLookup;
  if (!rightColumnsRowEl) {
    throw new Error("Missing .game-ui-columns-row");
  }
  const menuButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-game-menu]"),
  );
  const menuPanels = Array.from(
    document.querySelectorAll<HTMLElement>("[data-menu-panel]"),
  );

  const rng = (): number => Math.random();

  /** Upper bound for participant assign UI; must be >= any runtime `maxParticipantsPerMission` or event cap (3). */
  const ASSIGN_PARTICIPANT_SLOT_CAPACITY = 12;
  const assignSlotInstanceIds: (string | null)[] = Array.from(
    { length: ASSIGN_PARTICIPANT_SLOT_CAPACITY },
    (): string | null => null,
  );
  /** Parallel to planned mission's `requiredAssetIds` (rebuilt when mission pick changes). */
  const assignAssetSlotAssetIds: (string | null)[] = [];
  let assignMissionTemplateId: string | null = null;
  let assignMissionSource: MissionSource | null = null;
  let assignOmegaStageIndex: number | null = null;
  let assignOmegaSlotIndex: number | null = null;
  let assignTarget: MissionTarget | null = null;
  let dndDragSource:
    | { kind: "roster" }
    | { kind: "slot"; slotIndex: number }
    | { kind: "mission-slot" }
    | { kind: "assign-target" }
    | null = null;

  let locationsCategoryTab: LocationType = "economic";
  let lairPanelTab: "missions" | "upgrades" = "missions";
  let currentMenu: GameMenu = "dashboard";

  function findMissionOrEventTemplate(id: string): MissionTemplate | undefined {
    return content.missions.find((m) => m.id === id) ?? content.events.find((e) => e.id === id);
  }

  /** Native tooltip text for mission card titles (success / failure template effects). */
  function missionOutcomeEffectsTitle(mission: MissionTemplate | undefined): string | undefined {
    if (mission === undefined) {
      return undefined;
    }
    const successLines = describeMissionTemplateEffects(mission.onSuccessEffects ?? []);
    const failureLines = describeMissionTemplateEffects(mission.onFailureEffects ?? []);
    if (successLines.length === 0 && failureLines.length === 0) {
      return undefined;
    }
    const blocks: string[] = [];
    if (successLines.length > 0) {
      blocks.push(["On success:", ...successLines.map((line) => `• ${line}`)].join("\n"));
    }
    if (failureLines.length > 0) {
      blocks.push(["On failure:", ...failureLines.map((line) => `• ${line}`)].join("\n"));
    }
    return blocks.join("\n\n");
  }

  /** Native `title` is flaky on `draggable` cards in Chromium; use a hover panel instead. */
  function appendMissionTitleWithFxTooltip(
    body: HTMLElement,
    mission: MissionTemplate | undefined,
    displayName: string,
  ): void {
    const title = document.createElement("h4");
    title.className = "asset-card-title";
    title.textContent = displayName;
    const tip = missionOutcomeEffectsTitle(mission);
    if (tip === undefined) {
      body.appendChild(title);
      return;
    }
    missionFxTooltipSerial += 1;
    const tipId = `mission-fx-tip-${missionFxTooltipSerial}`;
    const wrap = document.createElement("div");
    wrap.className = "mission-outcome-tooltip-anchor";
    wrap.tabIndex = 0;
    const panel = document.createElement("div");
    panel.className = "mission-outcome-tooltip-panel";
    panel.id = tipId;
    panel.setAttribute("role", "tooltip");
    panel.textContent = tip;
    title.setAttribute("aria-describedby", tipId);
    wrap.appendChild(title);
    wrap.appendChild(panel);
    body.appendChild(wrap);
  }

  function totalEventSuccessModifierDelta(): number {
    return state.activeSuccessModifiers.reduce((s, m) => s + m.delta, 0);
  }

  function stagedParticipantCeiling(): number {
    if (assignMissionSource === "event") {
      return content.balance.eventMaxParticipants;
    }
    return state.player.maxParticipantsPerMission;
  }

  function stagedParticipantSlotCount(): number {
    if (!assignMissionTemplateId) {
      return state.player.maxParticipantsPerMission;
    }
    return Math.max(state.player.maxParticipantsPerMission, stagedParticipantCeiling());
  }

  function participantCapForActiveMission(am: ActiveMission): number {
    return am.missionSource === "event"
      ? content.balance.eventMaxParticipants
      : state.player.maxParticipantsPerMission;
  }

  function getAssignParticipantIds(): string[] {
    const max =
      assignMissionTemplateId && assignMissionSource !== null
        ? stagedParticipantCeiling()
        : state.player.maxParticipantsPerMission;
    return assignSlotInstanceIds
      .slice(0, max)
      .filter((id): id is string => id !== null);
  }

  function reconcileAssignSlots(): void {
    const busy = busyInstanceIds(state.activeMissions);
    const valid = new Set(state.player.minions.map((m) => m.instanceId));
    const max =
      assignMissionTemplateId && assignMissionSource !== null
        ? stagedParticipantCeiling()
        : state.player.maxParticipantsPerMission;
    for (let i = 0; i < assignSlotInstanceIds.length; i += 1) {
      const id = assignSlotInstanceIds[i];
      if (id === null) {
        continue;
      }
      if (i >= max || !valid.has(id) || busy.has(id)) {
        assignSlotInstanceIds[i] = null;
      }
    }
  }

  function clearAssignSlot(slotIndex: number): void {
    assignSlotInstanceIds[slotIndex] = null;
  }

  function clearAssignMissionSlotOnly(): void {
    assignMissionTemplateId = null;
    assignMissionSource = null;
    assignOmegaStageIndex = null;
    assignOmegaSlotIndex = null;
    rebuildAssignAssetSlots();
    updateAssignTargetFieldVisibility();
    updateAssignTargetLabelText();
  }

  function clearAssignMissionTarget(): void {
    clearAssignMissionSlotOnly();
    assignTarget = null;
  }

  function clearAllAssignSlots(): void {
    for (let i = 0; i < assignSlotInstanceIds.length; i += 1) {
      assignSlotInstanceIds[i] = null;
    }
    clearAssignMissionTarget();
  }

  /** An offer that expired or was started clears `currentEventTemplateId`; drop stale staged plans. */
  function reconcileStagedEventMissionWithState(): void {
    if (assignMissionSource !== "event" || assignMissionTemplateId === null) {
      return;
    }
    if (state.currentEventTemplateId !== assignMissionTemplateId) {
      clearAllAssignSlots();
    }
  }

  function placeInstanceInSlot(instanceId: string, slotIndex: number): void {
    for (let i = 0; i < assignSlotInstanceIds.length; i += 1) {
      if (assignSlotInstanceIds[i] === instanceId) {
        assignSlotInstanceIds[i] = null;
      }
    }
    assignSlotInstanceIds[slotIndex] = instanceId;
    if (assignTarget?.kind === "minion" && assignTarget.instanceId === instanceId) {
      assignTarget = null;
    }
  }

  function removeInstanceFromAllAssignSlots(instanceId: string): void {
    for (let i = 0; i < assignSlotInstanceIds.length; i += 1) {
      if (assignSlotInstanceIds[i] === instanceId) {
        assignSlotInstanceIds[i] = null;
      }
    }
  }

  function selectedMissionTemplate(): MissionTemplate | undefined {
    if (!assignMissionTemplateId) {
      return undefined;
    }
    return findMissionOrEventTemplate(assignMissionTemplateId);
  }

  function rebuildAssignAssetSlots(): void {
    assignAssetSlotAssetIds.length = 0;
    const m = selectedMissionTemplate();
    if (!m || assignMissionTemplateId === null) {
      return;
    }
    for (let i = 0; i < m.requiredAssetIds.length; i += 1) {
      assignAssetSlotAssetIds.push(null);
    }
  }

  /** Keep slot array aligned with the selected mission (e.g. after refresh). Preserves filled indices. */
  function syncAssignAssetSlotArrayWithMission(): void {
    const m = selectedMissionTemplate();
    if (!m || assignMissionTemplateId === null) {
      assignAssetSlotAssetIds.length = 0;
      return;
    }
    const n = m.requiredAssetIds.length;
    while (assignAssetSlotAssetIds.length < n) {
      assignAssetSlotAssetIds.push(null);
    }
    if (assignAssetSlotAssetIds.length > n) {
      assignAssetSlotAssetIds.length = n;
    }
  }

  function reconcileTargetWithMission(): void {
    const m = selectedMissionTemplate();
    if (!m) {
      return;
    }
    if (m.targetType === "none") {
      assignTarget = null;
      return;
    }
    if (!assignTarget) {
      return;
    }
    if (!missionTargetMatchesTemplate(m.targetType, assignTarget)) {
      assignTarget = null;
    }
  }

  function updateAssignTargetFieldVisibility(): void {
    const m = selectedMissionTemplate();
    const hide = m?.targetType === "none";
    assignTargetFieldEl.classList.toggle("assign-target-field--hidden", hide);
    assignTargetFieldEl.toggleAttribute("hidden", hide);
  }

  function updateAssignTargetLabelText(): void {
    const m = selectedMissionTemplate();
    if (!m || m.targetType === "none") {
      assignTargetLabelEl.textContent = "Target";
      return;
    }
    const labels: Record<MissionTargetType, string> = {
      location: "Target Location",
      asset_hidden: "Target Hidden Asset",
      asset_revealed: "Target Revealed Asset",
      minion: "Target Minion",
      none: "Target",
    };
    assignTargetLabelEl.textContent = labels[m.targetType];
  }

  function onAssignSlotsChanged(): void {
    syncAssignButtonState();
  }

  type MissionDragPayload =
    | { kind: "mastermind-mission"; source: "lair"; missionTemplateId: string }
    | { kind: "mastermind-mission"; source: "event"; missionTemplateId: string }
    | {
        kind: "mastermind-mission";
        source: "omega";
        missionTemplateId: string;
        stageIndex: number;
        slotIndex: number;
      };

  type LocationDragPayload = { kind: "mastermind-location"; locationId: string };

  type AssetDragPayload = {
    kind: "mastermind-asset";
    locationId: string;
    slotIndex: number;
    visibility: "hidden" | "revealed";
  };

  type MinionDragPayload = { kind: "mastermind-minion"; instanceId: string };

  type AssetCardDragPayload = { kind: "mastermind-asset-card"; assetId: string };

  type AnyDragPayload =
    | MissionDragPayload
    | LocationDragPayload
    | AssetDragPayload
    | MinionDragPayload
    | AssetCardDragPayload;

  function parseDragPayload(raw: string): AnyDragPayload | null {
    const t = raw.trim();
    if (!t.startsWith("{")) {
      return null;
    }
    try {
      const o = JSON.parse(t) as {
        kind?: string;
        source?: string;
        missionTemplateId?: string;
        stageIndex?: number;
        slotIndex?: number;
        locationId?: string;
        visibility?: string;
        instanceId?: string;
        assetId?: string;
      };
      if (o.kind === "mastermind-mission" && o.source === "lair" && typeof o.missionTemplateId === "string") {
        return { kind: "mastermind-mission", source: "lair", missionTemplateId: o.missionTemplateId };
      }
      if (o.kind === "mastermind-mission" && o.source === "event" && typeof o.missionTemplateId === "string") {
        return { kind: "mastermind-mission", source: "event", missionTemplateId: o.missionTemplateId };
      }
      if (
        o.kind === "mastermind-mission" &&
        o.source === "omega" &&
        typeof o.missionTemplateId === "string" &&
        typeof o.stageIndex === "number" &&
        typeof o.slotIndex === "number"
      ) {
        return {
          kind: "mastermind-mission",
          source: "omega",
          missionTemplateId: o.missionTemplateId,
          stageIndex: o.stageIndex,
          slotIndex: o.slotIndex,
        };
      }
      if (o.kind === "mastermind-location" && typeof o.locationId === "string") {
        return { kind: "mastermind-location", locationId: o.locationId };
      }
      if (
        o.kind === "mastermind-asset" &&
        typeof o.locationId === "string" &&
        typeof o.slotIndex === "number" &&
        (o.visibility === "hidden" || o.visibility === "revealed")
      ) {
        return {
          kind: "mastermind-asset",
          locationId: o.locationId,
          slotIndex: o.slotIndex,
          visibility: o.visibility,
        };
      }
      if (o.kind === "mastermind-minion" && typeof o.instanceId === "string") {
        return { kind: "mastermind-minion", instanceId: o.instanceId };
      }
      if (o.kind === "mastermind-asset-card" && typeof o.assetId === "string") {
        return { kind: "mastermind-asset-card", assetId: o.assetId };
      }
    } catch {
      return null;
    }
    return null;
  }

  function payloadToMissionTarget(payload: Exclude<AnyDragPayload, MissionDragPayload>): MissionTarget | null {
    if (payload.kind === "mastermind-location") {
      return { kind: "location", locationId: payload.locationId };
    }
    if (payload.kind === "mastermind-asset") {
      return {
        kind: "asset",
        locationId: payload.locationId,
        slotIndex: payload.slotIndex,
        visibilityAtAssign: payload.visibility,
      };
    }
    if (payload.kind === "mastermind-minion") {
      return { kind: "minion", instanceId: payload.instanceId };
    }
    return null;
  }

  function targetPayloadMatchesPlannedMission(
    payload: Exclude<AnyDragPayload, MissionDragPayload>,
  ): boolean {
    const m = selectedMissionTemplate();
    if (!m) {
      return true;
    }
    if (m.targetType === "none") {
      return false;
    }
    if (m.targetType === "location") {
      return payload.kind === "mastermind-location";
    }
    if (m.targetType === "asset_hidden") {
      return payload.kind === "mastermind-asset" && payload.visibility === "hidden";
    }
    if (m.targetType === "asset_revealed") {
      return payload.kind === "mastermind-asset" && payload.visibility === "revealed";
    }
    if (m.targetType === "minion") {
      return payload.kind === "mastermind-minion";
    }
    return false;
  }

  function missionDragJson(
    source: "lair" | "omega" | "event",
    missionTemplateId: string,
    stageIndex?: number,
    slotIndex?: number,
  ): string {
    if (source === "lair") {
      return JSON.stringify({ kind: "mastermind-mission", source: "lair", missionTemplateId });
    }
    if (source === "event") {
      return JSON.stringify({ kind: "mastermind-mission", source: "event", missionTemplateId });
    }
    return JSON.stringify({
      kind: "mastermind-mission",
      source: "omega",
      missionTemplateId,
      stageIndex: stageIndex ?? 0,
      slotIndex: slotIndex ?? 0,
    });
  }

  function locationDragJson(locationId: string): string {
    return JSON.stringify({ kind: "mastermind-location", locationId });
  }

  function assetDragJson(
    locationId: string,
    slotIndex: number,
    visibility: "hidden" | "revealed",
  ): string {
    return JSON.stringify({
      kind: "mastermind-asset",
      locationId,
      slotIndex,
      visibility,
    });
  }

  function minionDragJson(instanceId: string): string {
    return JSON.stringify({ kind: "mastermind-minion", instanceId });
  }

  function assetCardDragJson(assetId: string): string {
    return JSON.stringify({ kind: "mastermind-asset-card", assetId });
  }

  function wireAssignPickSlot(
    el: HTMLElement,
    kind: "mission" | "target",
  ): void {
    el.addEventListener("dragenter", (e) => {
      e.preventDefault();
      el.classList.add("assign-minion-slot--dragover");
    });
    el.addEventListener("dragleave", () => {
      el.classList.remove("assign-minion-slot--dragover");
    });
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      const dt = e.dataTransfer;
      if (dt) {
        dt.dropEffect = "copy";
      }
    });
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("assign-minion-slot--dragover");
      const raw = e.dataTransfer?.getData("text/plain")?.trim();
      if (!raw) {
        return;
      }
      const payload = parseDragPayload(raw);
      if (!payload) {
        return;
      }
      if (kind === "mission" && payload.kind === "mastermind-mission") {
        if (payload.source === "event") {
          if (state.phase !== "main") {
            return;
          }
          if (
            state.currentEventTemplateId === null ||
            payload.missionTemplateId !== state.currentEventTemplateId
          ) {
            return;
          }
        }
        assignMissionTemplateId = payload.missionTemplateId;
        assignMissionSource = payload.source;
        if (payload.source === "omega") {
          assignOmegaStageIndex = payload.stageIndex;
          assignOmegaSlotIndex = payload.slotIndex;
        } else {
          assignOmegaStageIndex = null;
          assignOmegaSlotIndex = null;
        }
        reconcileTargetWithMission();
        rebuildAssignAssetSlots();
        updateAssignTargetFieldVisibility();
        updateAssignTargetLabelText();
        renderAssignPickSlots();
        renderAssignMinionSlots();
        onAssignSlotsChanged();
        return;
      }
      if (kind === "target") {
        if (payload.kind === "mastermind-mission") {
          return;
        }
        const m = selectedMissionTemplate();
        if (m?.targetType === "none") {
          return;
        }
        if (!targetPayloadMatchesPlannedMission(payload)) {
          return;
        }
        const mt = payloadToMissionTarget(payload);
        if (!mt) {
          return;
        }
        if (mt.kind === "location" || mt.kind === "asset") {
          const playable = new Set(runLocations().map((l) => l.id));
          if (!playable.has(mt.locationId)) {
            return;
          }
        }
        if (mt.kind === "asset") {
          const placement = state.locationAssetSlots.find((p) => p.locationId === mt.locationId);
          const slot = placement?.slots[mt.slotIndex];
          const intel = intelLevelAtLocation(state, mt.locationId);
          if (effectiveVisibilityOfSlot(slot, intel) !== mt.visibilityAtAssign) {
            return;
          }
        }
        if (mt.kind === "minion") {
          const busy = busyInstanceIds(state.activeMissions);
          const inst = state.player.minions.find((x) => x.instanceId === mt.instanceId);
          if (!inst || busy.has(mt.instanceId)) {
            return;
          }
          if (getAssignParticipantIds().includes(mt.instanceId)) {
            return;
          }
          removeInstanceFromAllAssignSlots(mt.instanceId);
        }
        assignTarget = mt;
        renderAssignPickSlots();
        renderAssignMinionSlots();
        onAssignSlotsChanged();
      }
    });
  }

  function formatSignedPercent(delta: number): string {
    if (delta > 0) {
      return `+${delta}%`;
    }
    return `${delta}%`;
  }

  function formatMissionSuccessChanceTooltipLines(
    breakdown: SuccessChanceBreakdown,
    dynamicEntries: readonly DynamicTraitSuccessBreakdownEntry[],
    roster: readonly MinionInstance[],
  ): string[] {
    const lines: string[] = [];
    const denom = breakdown.requiredTraitCount + breakdown.requiredAssetSlotCount;
    if (denom === 0) {
      lines.push("Base 100% (no required traits or assets).");
    } else {
      lines.push(
        `Base ${breakdown.basePercent}% = round(100 * (${breakdown.matchedTraits} + ${breakdown.matchedAssets}) / ${denom}).`,
      );
      if (breakdown.requiredTraitCount > 0) {
        lines.push(
          `Traits: ${breakdown.matchedTraits}/${breakdown.requiredTraitCount} required ids covered by the participant union.`,
        );
      }
      if (breakdown.requiredAssetSlotCount > 0) {
        lines.push(
          `Assets: ${breakdown.matchedAssets}/${breakdown.requiredAssetSlotCount} required asset slots satisfied.`,
        );
      }
    }
    if (breakdown.missingTraitIds.length > 0) {
      lines.push(`Missing required traits: ${traitDisplayNames(content, breakdown.missingTraitIds)}.`);
    }
    if (breakdown.statusEntries.length > 0) {
      for (const e of breakdown.statusEntries) {
        const who = minionNameByInstanceId(content, roster, e.instanceId);
        const tn = content.traits.find((t) => t.id === e.traitId)?.name ?? e.traitId;
        lines.push(`  ${who} — ${tn}: ${formatSignedPercent(e.delta)}`);
      }
    }
    if (dynamicEntries.length > 0) {
      for (const e of dynamicEntries) {
        const who = minionNameByInstanceId(content, roster, e.ownerInstanceId);
        lines.push(`  ${who} — ${e.traitLabel}: ${formatSignedPercent(e.delta)}`);
      }
    }
    if (breakdown.eventSuccessModifierDelta !== 0) {
      lines.push(
        `Timed event modifier: ${formatSignedPercent(breakdown.eventSuccessModifierDelta)}.`,
      );
    }
    if (breakdown.opposingAgentCount > 0) {
      lines.push(
        `Revealed opposing agents at target: ${breakdown.opposingAgentCount} * -${content.balance.opposingAgentPenalty}% = -${breakdown.opposingAgentPenaltyTotal}%.`,
      );
    }
    if (breakdown.preClampPercent !== breakdown.finalPercent) {
      lines.push(`Clamped to [0, 100]: shown success chance is ${breakdown.finalPercent}%.`);
    } else {
      lines.push(`Shown success chance: ${breakdown.finalPercent}%.`);
    }
    return lines;
  }

  function renderAssignAssetSlots(): void {
    assignAssetSlotsList.innerHTML = "";
    const m = selectedMissionTemplate();
    const req = m?.requiredAssetIds ?? [];
    if (!assignMissionTemplateId || req.length === 0) {
      assignAssetSlotsFieldset.hidden = true;
      renderAssetsPanel();
      return;
    }
    assignAssetSlotsFieldset.hidden = false;
    const mainOnly = state.phase === "main";
    const wrap = document.createElement("div");
    wrap.className = "assign-minion-slots assign-asset-slots";

    for (let slotIndex = 0; slotIndex < req.length; slotIndex += 1) {
      const requiredId = req[slotIndex]!;
      const slot = document.createElement("div");
      slot.className = "assign-minion-slot assign-asset-slot";
      slot.dataset.assetSlotIndex = String(slotIndex);
      slot.dataset.requiredAssetId = requiredId;

      slot.addEventListener("dragenter", (e) => {
        e.preventDefault();
        slot.classList.add("assign-minion-slot--dragover");
      });
      slot.addEventListener("dragleave", () => {
        slot.classList.remove("assign-minion-slot--dragover");
      });
      slot.addEventListener("dragover", (e) => {
        e.preventDefault();
        const dt = e.dataTransfer;
        if (dt) {
          dt.dropEffect = "copy";
        }
      });
      slot.addEventListener("drop", (e) => {
        e.preventDefault();
        slot.classList.remove("assign-minion-slot--dragover");
        const raw = e.dataTransfer?.getData("text/plain")?.trim();
        if (!raw) {
          return;
        }
        const parsed = parseDragPayload(raw);
        if (parsed?.kind !== "mastermind-asset-card") {
          return;
        }
        if (parsed.assetId !== requiredId) {
          return;
        }
        const owned = state.player.assets[parsed.assetId] ?? 0;
        let usedElsewhere = 0;
        for (let j = 0; j < assignAssetSlotAssetIds.length; j += 1) {
          if (j !== slotIndex && assignAssetSlotAssetIds[j] === parsed.assetId) {
            usedElsewhere += 1;
          }
        }
        if (owned - usedElsewhere < 1) {
          return;
        }
        assignAssetSlotAssetIds[slotIndex] = parsed.assetId;
        renderAssignMinionSlots();
        onAssignSlotsChanged();
      });

      const placed = assignAssetSlotAssetIds[slotIndex] ?? null;
      if (placed === null) {
        const ph = document.createElement("span");
        ph.className = "assign-minion-slot-placeholder";
        const name = content.assets.find((a) => a.id === requiredId)?.name ?? requiredId;
        ph.textContent = `Slot ${slotIndex + 1} · ${name}`;
        slot.appendChild(ph);
      } else {
        const tpl = content.assets.find((a) => a.id === placed);
        const chip = document.createElement("div");
        chip.className = "assign-minion-chip assign-asset-chip";
        chip.appendChild(createCardArtImg(resolveAssetCardArt(tpl), "card-art--chip"));
        const chipMain = document.createElement("div");
        chipMain.className = "assign-minion-chip-main";
        const chipLabel = document.createElement("span");
        chipLabel.className = "assign-minion-chip-label";
        chipLabel.textContent = tpl?.name ?? placed;
        chipMain.appendChild(chipLabel);
        chip.appendChild(chipMain);

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "assign-minion-chip-remove";
        removeBtn.setAttribute("aria-label", `Remove ${tpl?.name ?? "asset"} from slot`);
        removeBtn.textContent = "×";
        removeBtn.disabled = !mainOnly;
        removeBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          assignAssetSlotAssetIds[slotIndex] = null;
          renderAssignMinionSlots();
          onAssignSlotsChanged();
        });
        removeBtn.addEventListener("mousedown", (ev) => {
          ev.stopPropagation();
        });
        chip.appendChild(removeBtn);
        slot.appendChild(chip);
      }

      wrap.appendChild(slot);
    }

    assignAssetSlotsList.appendChild(wrap);
    renderAssetsPanel();
  }

  function renderAssignPickSlots(): void {
    assignMissionSlotEl.innerHTML = "";
    assignTargetSlotEl.innerHTML = "";
    updateAssignTargetFieldVisibility();
    updateAssignTargetLabelText();
    const mainOnly = state.phase === "main";
    const mTpl = selectedMissionTemplate();
    const hideTargetField = mTpl?.targetType === "none";

    const missionSlot = document.createElement("div");
    missionSlot.className = "assign-pick-slot-inner";
    if (assignMissionTemplateId === null) {
      const ph = document.createElement("span");
      ph.className = "assign-minion-slot-placeholder";
      ph.textContent = "Drag a mission from Omega Plan, Lair, or Events tab";
      missionSlot.appendChild(ph);
    } else {
      const wrap = document.createElement("div");
      wrap.className = "assign-pick-slot-card-wrap";

      const missionTpl = findMissionOrEventTemplate(assignMissionTemplateId);
      const mergedForAssign =
        missionTpl !== undefined
          ? mergedRequiredTraitIdsSorted(
              missionTpl,
              assignTarget !== null
                ? missionSuccessOptionsForTarget(state, assignTarget)
                : {},
            )
          : undefined;

      const article = buildMissionCatalogArticle(assignMissionTemplateId, mergedForAssign);
      article.classList.add("assign-pick-embedded-card");
      article.draggable = mainOnly;
      article.addEventListener("dragstart", (e) => {
        if (!mainOnly) {
          e.preventDefault();
          return;
        }
        dndDragSource = { kind: "mission-slot" };
        const json =
          assignMissionSource === "lair" && assignMissionTemplateId
            ? missionDragJson("lair", assignMissionTemplateId)
            : assignMissionSource === "event" && assignMissionTemplateId
              ? missionDragJson("event", assignMissionTemplateId)
              : missionDragJson(
                  "omega",
                  assignMissionTemplateId!,
                  assignOmegaStageIndex ?? 0,
                  assignOmegaSlotIndex ?? 0,
                );
        e.dataTransfer?.setData("text/plain", json);
        e.dataTransfer!.effectAllowed = "move";
      });
      wrap.appendChild(article);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "assign-pick-slot-clear";
      removeBtn.setAttribute("aria-label", "Clear mission");
      removeBtn.textContent = "×";
      removeBtn.disabled = !mainOnly;
      removeBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        clearAssignMissionSlotOnly();
        renderAssignPickSlots();
        renderAssignMinionSlots();
        onAssignSlotsChanged();
      });
      removeBtn.addEventListener("mousedown", (ev) => {
        ev.stopPropagation();
      });
      wrap.appendChild(removeBtn);
      missionSlot.appendChild(wrap);
    }
    assignMissionSlotEl.appendChild(missionSlot);

    if (hideTargetField) {
      renderAssignAssetSlots();
      return;
    }

    const targetSlot = document.createElement("div");
    targetSlot.className = "assign-pick-slot-inner";

    function setDragDataForTarget(e: DragEvent): void {
      const t = assignTarget;
      if (!mainOnly || !t) {
        e.preventDefault();
        return;
      }
      dndDragSource = { kind: "assign-target" };
      if (t.kind === "location") {
        e.dataTransfer?.setData("text/plain", locationDragJson(t.locationId));
      } else if (t.kind === "asset") {
        e.dataTransfer?.setData(
          "text/plain",
          assetDragJson(t.locationId, t.slotIndex, t.visibilityAtAssign),
        );
      } else if (t.kind === "minion") {
        e.dataTransfer?.setData("text/plain", minionDragJson(t.instanceId));
      }
      e.dataTransfer!.effectAllowed = "move";
    }

    function appendClearTarget(wrap: HTMLElement): void {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "assign-pick-slot-clear";
      removeBtn.setAttribute("aria-label", "Clear target");
      removeBtn.textContent = "×";
      removeBtn.disabled = !mainOnly;
      removeBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        assignTarget = null;
        renderAssignPickSlots();
        renderAssignMinionSlots();
        onAssignSlotsChanged();
      });
      removeBtn.addEventListener("mousedown", (ev) => {
        ev.stopPropagation();
      });
      wrap.appendChild(removeBtn);
    }

    const targetPick = assignTarget;
    if (targetPick === null) {
      const ph = document.createElement("span");
      ph.className = "assign-minion-slot-placeholder";
      ph.textContent = "Drag location, asset slot, or minion";
      targetSlot.appendChild(ph);
    } else if (targetPick.kind === "location") {
      const loc = content.locations.find((l) => l.id === targetPick.locationId);
      if (!loc) {
        const ph = document.createElement("span");
        ph.className = "assign-minion-slot-placeholder";
        ph.textContent = "Unknown location";
        targetSlot.appendChild(ph);
      } else {
        const securityByLocationId = new Map(
          state.locationSecurityStates.map((s) => [s.locationId, s.securityLevel]),
        );
        const assetSlotsByLocationId = new Map(
          state.locationAssetSlots.map((p) => [p.locationId, p.slots]),
        );
        const assetNameById = new Map(content.assets.map((a) => [a.id, a.name]));
        const slots = assetSlotsByLocationId.get(loc.id) ?? [];

        const wrap = document.createElement("div");
        wrap.className = "assign-pick-slot-card-wrap";
        const article = buildLocationCardArticle(
          loc,
          securityByLocationId.get(loc.id),
          intelLevelAtLocation(state, loc.id),
          slots,
          assetNameById,
          false,
          state.locationRequiredTraits[loc.id] ?? [],
          state.locationSecurityTraits[loc.id] ?? [],
        );
        article.classList.add("assign-pick-embedded-card");
        article.draggable = mainOnly;
        article.addEventListener("dragstart", setDragDataForTarget);
        wrap.appendChild(article);
        appendClearTarget(wrap);
        targetSlot.appendChild(wrap);
      }
    } else if (targetPick.kind === "asset") {
      const loc = content.locations.find((l) => l.id === targetPick.locationId);
      const placement = state.locationAssetSlots.find((p) => p.locationId === targetPick.locationId);
      const slot = placement?.slots[targetPick.slotIndex];
      const wrap = document.createElement("div");
      wrap.className = "assign-pick-slot-card-wrap";
      const article = document.createElement("article");
      article.className = "assign-pick-embedded-card location-card assign-target-asset-card";
      article.draggable = mainOnly;
      article.addEventListener("dragstart", setDragDataForTarget);
      const body = appendCardArtShell(article, resolveLocationCardArt(loc));
      const title = document.createElement("h4");
      title.className = "location-card-title";
      title.textContent = loc?.name ?? targetPick.locationId;
      body.appendChild(title);
      const dl = document.createElement("dl");
      dl.className = "location-card-stats";
      const visLabel = targetPick.visibilityAtAssign === "hidden" ? "Hidden" : "Revealed";
      const targetIntel = intelLevelAtLocation(state, targetPick.locationId);
      let assetLabel = "Asset";
      if (slot?.kind === "empty") {
        assetLabel = "—";
      } else if (
        slot &&
        isOccupiedAssetSlot(slot) &&
        effectiveVisibilityOfSlot(slot, targetIntel) === "revealed"
      ) {
        assetLabel =
          content.assets.find((a) => a.id === slot.assetId)?.name ?? slot.assetId;
      }
      const siteIds = state.locationRequiredTraits[targetPick.locationId] ?? [];
      const siteTraitsLabel =
        siteIds.length === 0
          ? "None"
          : traitDisplayNames(content, [...siteIds].sort((a, b) => a.localeCompare(b)));
      const secLevel = state.locationSecurityStates.find(
        (s) => s.locationId === targetPick.locationId,
      )?.securityLevel;
      const securityTraitIds = state.locationSecurityTraits[targetPick.locationId] ?? [];
      const securityTraitsLabel = formatLocationSecurityTraitsDisplay(
        content,
        securityTraitIds,
        secLevel,
      );
      appendMinionStatRows(dl, [
        { label: "Asset", value: `${visLabel} (${assetLabel})` },
        { label: "Slot", value: String(targetPick.slotIndex + 1) },
        {
          label: "Intel level",
          value: `${targetIntel} / ${MAX_INTEL_LEVEL}`,
          tooltipLines: INTEL_LEVEL_TOOLTIP_LINES,
        },
        { label: "Site traits", value: siteTraitsLabel },
        { label: "Security traits", value: securityTraitsLabel },
      ]);
      body.appendChild(dl);
      wrap.appendChild(article);
      appendClearTarget(wrap);
      targetSlot.appendChild(wrap);
    } else if (targetPick.kind === "minion") {
      const inst = state.player.minions.find((x) => x.instanceId === targetPick.instanceId);
      const tpl = inst
        ? content.minions.find((t) => t.id === inst.templateId)
        : undefined;
      const wrap = document.createElement("div");
      wrap.className = "assign-pick-slot-card-wrap";
      const chip = document.createElement("div");
      chip.className = "assign-minion-chip assign-target-minion-chip";
      chip.draggable = mainOnly;
      chip.addEventListener("dragstart", setDragDataForTarget);
      chip.appendChild(createCardArtImg(resolveMinionCardArt(tpl), "card-art--chip"));
      const chipMain = document.createElement("div");
      chipMain.className = "assign-minion-chip-main";
      const chipLabel = document.createElement("span");
      chipLabel.className = "assign-minion-chip-label";
      chipLabel.textContent = tpl?.name ?? targetPick.instanceId;
      chipMain.appendChild(chipLabel);
      if (
        inst &&
        (inst.traitIds.length > 0 || inst.dynamicTraits.length > 0)
      ) {
        const traitsEl = document.createElement("div");
        traitsEl.className = "assign-minion-chip-traits";
        for (const tid of inst.traitIds) {
          const span = document.createElement("span");
          styleAssignChipTraitSpan(span, content, tid, new Set<string>());
          traitsEl.appendChild(span);
        }
        for (const dtrait of inst.dynamicTraits) {
          const span = document.createElement("span");
          span.className = `assign-minion-chip-trait ${assignChipDynamicPillModifierClass(dtrait)}`;
          span.textContent = dynamicTraitDisplayLabel(content, state.player.minions, dtrait);
          traitsEl.appendChild(span);
        }
        chipMain.appendChild(traitsEl);
      }
      chip.appendChild(chipMain);
      wrap.appendChild(chip);
      appendClearTarget(wrap);
      targetSlot.appendChild(wrap);
    }

    assignTargetSlotEl.appendChild(targetSlot);
    renderAssignAssetSlots();
  }

  let assignPickSlotsWired = false;
  function ensureAssignPickSlotsWired(): void {
    if (assignPickSlotsWired) {
      return;
    }
    assignPickSlotsWired = true;
    wireAssignPickSlot(assignMissionSlotEl, "mission");
    wireAssignPickSlot(assignTargetSlotEl, "target");
  }

  function runLocations(): (typeof content.locations)[number][] {
    return locationTemplatesForOmegaPlan(content, state.activeOmegaPlanId);
  }

  function syncAssignButtonState(): void {
    const mainOnly = state.phase === "main";
    if (!mainOnly) {
      btnAssign.disabled = true;
      btnAssign.title = "Only during Main Phase";
      return;
    }
    if (!assignMissionTemplateId || assignMissionSource === null) {
      btnAssign.disabled = true;
      btnAssign.title = "Choose a mission";
      return;
    }
    const missionTemplate = findMissionOrEventTemplate(assignMissionTemplateId);
    if (!missionTemplate) {
      btnAssign.disabled = true;
      btnAssign.title = "Choose a mission";
      return;
    }
    if (missionTemplate.targetType !== "none") {
      if (!assignTarget) {
        btnAssign.disabled = true;
        btnAssign.title = "Choose a mission target";
        return;
      }
      if (!missionTargetMatchesTemplate(missionTemplate.targetType, assignTarget)) {
        btnAssign.disabled = true;
        btnAssign.title = "Target does not match mission type";
        return;
      }
    }
    const atMissionCap =
      state.activeMissions.length >= state.player.maxConcurrentMissions;
    if (atMissionCap) {
      btnAssign.disabled = true;
      btnAssign.title = `At concurrent mission limit (${state.activeMissions.length}/${state.player.maxConcurrentMissions})`;
      return;
    }
    const parts = getAssignParticipantIds();
    const maxP = stagedParticipantCeiling();
    if (parts.length < 1 || parts.length > maxP) {
      btnAssign.disabled = true;
      btnAssign.title = `Assign 1–${maxP} minions`;
      return;
    }
    const instanceById = new Map(
      state.player.minions.map((m) => [m.instanceId, m] as const),
    );
    const participants = parts
      .map((id) => instanceById.get(id))
      .filter((x): x is NonNullable<typeof x> => x !== undefined);
    if (!canAssignParticipants(participants, maxP)) {
      btnAssign.disabled = true;
      btnAssign.title = `Assign 1–${maxP} minions`;
      return;
    }
    const cost = missionTemplate.startCommandPoints;
    const canAfford = state.player.commandPoints >= cost;
    btnAssign.disabled = !canAfford;
    btnAssign.title = canAfford
      ? `Spend ${cost} CP to assign`
      : `Need ${cost} CP (${state.player.commandPoints} available)`;
  }

  function renderAssignMinionSlots(): void {
    minionsList.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "assign-minion-slots";

    const busy = busyInstanceIds(state.activeMissions);
    const mainOnly = state.phase === "main";

    for (let slotIndex = 0; slotIndex < stagedParticipantSlotCount(); slotIndex += 1) {
      const slot = document.createElement("div");
      slot.className = "assign-minion-slot";
      slot.dataset.slotIndex = String(slotIndex);

      slot.addEventListener("dragenter", (e) => {
        e.preventDefault();
        slot.classList.add("assign-minion-slot--dragover");
      });
      slot.addEventListener("dragleave", () => {
        slot.classList.remove("assign-minion-slot--dragover");
      });
      slot.addEventListener("dragover", (e) => {
        e.preventDefault();
        const dt = e.dataTransfer;
        if (dt) {
          dt.dropEffect = dndDragSource?.kind === "slot" ? "move" : "copy";
        }
      });
      slot.addEventListener("drop", (e) => {
        e.preventDefault();
        slot.classList.remove("assign-minion-slot--dragover");
        const raw = e.dataTransfer?.getData("text/plain")?.trim();
        if (!raw) {
          return;
        }
        let resolvedId: string | null = null;
        const parsed = parseDragPayload(raw);
        if (parsed?.kind === "mastermind-minion") {
          resolvedId = parsed.instanceId;
        } else if (state.player.minions.some((m) => m.instanceId === raw)) {
          resolvedId = raw;
        }
        if (!resolvedId) {
          return;
        }
        const inst = state.player.minions.find((m) => m.instanceId === resolvedId);
        if (!inst || busy.has(resolvedId)) {
          return;
        }
        placeInstanceInSlot(resolvedId, slotIndex);
        renderAssignMinionSlots();
        onAssignSlotsChanged();
      });

      const instanceId = assignSlotInstanceIds[slotIndex];
      if (instanceId === null) {
        const ph = document.createElement("span");
        ph.className = "assign-minion-slot-placeholder";
        ph.textContent = `Slot ${slotIndex + 1}`;
        slot.appendChild(ph);
      } else {
        const inst = state.player.minions.find((m) => m.instanceId === instanceId);
        const tpl = inst
          ? content.minions.find((t) => t.id === inst.templateId)
          : undefined;
        const mission = assignMissionTemplateId
          ? findMissionOrEventTemplate(assignMissionTemplateId)
          : undefined;
        const assignOpts =
          assignTarget !== null ? missionSuccessOptionsForTarget(state, assignTarget) : {};
        const requiredTraitSet = new Set(
          mission !== undefined ? mergedRequiredTraitIdsSorted(mission, assignOpts) : [],
        );

        const chip = document.createElement("div");
        chip.className = "assign-minion-chip";
        chip.draggable = mainOnly && !busy.has(instanceId);
        chip.dataset.instanceId = instanceId;

        chip.appendChild(createCardArtImg(resolveMinionCardArt(tpl), "card-art--chip"));

        const chipMain = document.createElement("div");
        chipMain.className = "assign-minion-chip-main";

        const chipLabel = document.createElement("span");
        chipLabel.className = "assign-minion-chip-label";
        chipLabel.textContent = tpl?.name ?? instanceId;
        chipMain.appendChild(chipLabel);

        if (
          inst &&
          (inst.traitIds.length > 0 || inst.dynamicTraits.length > 0)
        ) {
          const traitsEl = document.createElement("div");
          traitsEl.className = "assign-minion-chip-traits";
          for (const tid of inst.traitIds) {
            const span = document.createElement("span");
            styleAssignChipTraitSpan(span, content, tid, requiredTraitSet);
            traitsEl.appendChild(span);
          }
          for (const dtrait of inst.dynamicTraits) {
            const span = document.createElement("span");
            span.className = `assign-minion-chip-trait ${assignChipDynamicPillModifierClass(dtrait)}`;
            span.textContent = dynamicTraitDisplayLabel(content, state.player.minions, dtrait);
            traitsEl.appendChild(span);
          }
          chipMain.appendChild(traitsEl);
        }

        chip.appendChild(chipMain);

        chip.addEventListener("dragstart", (e) => {
          if (!chip.draggable) {
            e.preventDefault();
            return;
          }
          dndDragSource = { kind: "slot", slotIndex };
          e.dataTransfer?.setData("text/plain", instanceId);
          e.dataTransfer!.effectAllowed = "move";
        });

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "assign-minion-chip-remove";
        removeBtn.setAttribute("aria-label", `Remove ${tpl?.name ?? "minion"} from slot`);
        removeBtn.textContent = "×";
        removeBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          clearAssignSlot(slotIndex);
          renderAssignMinionSlots();
          onAssignSlotsChanged();
        });
        removeBtn.addEventListener("mousedown", (ev) => {
          ev.stopPropagation();
        });
        chip.appendChild(removeBtn);
        slot.appendChild(chip);
      }

      wrap.appendChild(slot);
    }

    minionsList.appendChild(wrap);
    renderAssignPickSlots();
    syncAssignButtonState();
  }

  function buildMissionCatalogArticle(
    missionId: string,
    mergedRequiredTraitIdsForDisplay?: string[],
  ): HTMLElement {
    const mission = findMissionOrEventTemplate(missionId);
    const article = document.createElement("article");
    article.className = "asset-card omega-plan-mission-card";

    const body = appendCardArtShell(article, resolveMissionCardArt(mission));

    appendMissionTitleWithFxTooltip(body, mission, mission?.name ?? missionId);

    if (mission?.description) {
      const desc = document.createElement("p");
      desc.className = "asset-card-description";
      desc.textContent = mission.description;
      body.appendChild(desc);
    }

    const dl = document.createElement("dl");
    dl.className = "asset-card-stats";
    const rows: Array<{ label: string; value: string }> = [];
    if (mission) {
      const traitIdsForDisplay =
        mergedRequiredTraitIdsForDisplay !== undefined
          ? mergedRequiredTraitIdsForDisplay
          : mission.requiredTraitIds;
      rows.push(
        { label: "Mission target type", value: formatMissionTargetTypeLabel(mission.targetType) },
        { label: "Start cost", value: `${mission.startCommandPoints} CP` },
        {
          label: "Duration",
          value: `${mission.durationTurns} turn${mission.durationTurns === 1 ? "" : "s"}`,
        },
        {
          label: "Required traits",
          value: traitDisplayNames(content, traitIdsForDisplay),
        },
      );
      if (mission.requiredAssetIds.length > 0) {
        rows.push({
          label: "Required assets",
          value: assetDisplayNames(content, mission.requiredAssetIds),
        });
      }
    } else {
      rows.push({ label: "Mission id", value: missionId });
    }
    appendMinionStatRows(dl, rows);
    body.appendChild(dl);
    return article;
  }

  function buildLocationCardArticle(
    loc: (typeof content.locations)[number],
    securityLevel: number | undefined,
    intelLevel: number,
    assetSlots: LocationAssetSlot[],
    assetNameById: Map<string, string>,
    enableAssignDrag: boolean,
    siteRequiredTraitIds: string[],
    locationSecurityTraitIds: string[],
  ): HTMLElement {
    const article = document.createElement("article");
    article.className = "location-card";
    if (enableAssignDrag) {
      article.draggable = true;
      article.classList.add("assign-draggable-location");
      article.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        e.dataTransfer?.setData("text/plain", locationDragJson(loc.id));
        e.dataTransfer!.effectAllowed = "copy";
      });
    }

    const body = appendCardArtShell(article, resolveLocationCardArt(loc));

    const title = document.createElement("h4");
    title.className = "location-card-title";
    title.textContent = loc.name;

    const dl = document.createElement("dl");
    dl.className = "location-card-stats";
    const baseRows: Array<{
      label: string;
      value: string;
      tooltipLines?: readonly string[];
    }> = [
      { label: "Location type", value: formatLocationTypeLabel(loc.locationType) },
      { label: "Location level", value: String(loc.locationLevel) },
      {
        label: "Security level",
        value: securityLevel !== undefined ? String(securityLevel) : "—",
      },
      {
        label: "Intel level",
        value: `${intelLevel} / ${MAX_INTEL_LEVEL}`,
        tooltipLines: INTEL_LEVEL_TOOLTIP_LINES,
      },
      {
        label: "Site traits",
        value:
          siteRequiredTraitIds.length === 0
            ? "None"
            : traitDisplayNames(
                content,
                [...siteRequiredTraitIds].sort((a, b) => a.localeCompare(b)),
              ),
      },
      {
        label: "Security traits",
        value: formatLocationSecurityTraitsDisplay(
          content,
          locationSecurityTraitIds,
          securityLevel,
        ),
      },
    ];
    appendMinionStatRows(dl, baseRows);
    /* Agents the player has not uncovered (by play or by intel 3) are omitted entirely —
     * listing them at all would leak that the site is occupied. */
    const visibleAgents = playerVisibleOpposingAgentsAtLocation(state, loc.id);
    if (visibleAgents.length > 0) {
      const dt = document.createElement("dt");
      dt.textContent = "Agents";
      const dd = document.createElement("dd");
      for (const a of visibleAgents) {
        const template = getAgentTemplateById(content, a.templateId);
        const name = template?.name ?? a.templateId;
        const chip = document.createElement("span");
        chip.className = "location-agent-chip";
        chip.appendChild(createCardArtImg(resolveAgentCardArt(template), "card-art--chip"));
        chip.appendChild(document.createTextNode(name));
        dd.appendChild(chip);
      }
      dl.appendChild(dt);
      dl.appendChild(dd);
    }

    for (let si = 0; si < assetSlots.length; si += 1) {
      const slot = assetSlots[si]!;
      const knowledge = assetSlotKnowledge(slot, intelLevel);
      if (knowledge === "unknown") {
        /* Intel 0: the player cannot even count the assets stored here. */
        continue;
      }
      const dt = document.createElement("dt");
      dt.textContent = "Asset";
      const dd = document.createElement("dd");
      if (slot.kind === "empty") {
        if (enableAssignDrag) {
          const chip = document.createElement("span");
          chip.className = "location-asset-drag-chip location-asset-drag-chip--empty";
          chip.draggable = false;
          chip.textContent = "—";
          chip.title = "Empty slot";
          dd.appendChild(chip);
        } else {
          dd.textContent = "—";
        }
        dl.appendChild(dt);
        dl.appendChild(dd);
        continue;
      }
      const displayValue =
        knowledge === "identified"
          ? (assetNameById.get(slot.assetId) ?? slot.assetId)
          : "Asset";
      if (enableAssignDrag) {
        const targetVisibility = knowledge === "identified" ? "revealed" : "hidden";
        const chip = document.createElement("span");
        chip.className = "location-asset-drag-chip";
        chip.draggable = true;
        chip.textContent = displayValue;
        chip.title = `Drag to Plan mission target (slot ${si + 1})`;
        chip.addEventListener("dragstart", (e) => {
          e.stopPropagation();
          e.dataTransfer?.setData(
            "text/plain",
            assetDragJson(loc.id, si, targetVisibility),
          );
          e.dataTransfer!.effectAllowed = "copy";
        });
        dd.appendChild(chip);
      } else {
        dd.textContent = displayValue;
      }
      dl.appendChild(dt);
      dl.appendChild(dd);
    }

    body.appendChild(title);
    body.appendChild(dl);
    return article;
  }

  function appendMinionStatRows(
    dl: HTMLElement,
    rows: Array<{ label: string; value: string; tooltipLines?: readonly string[] }>,
  ): void {
    for (const { label, value, tooltipLines } of rows) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      if (tooltipLines !== undefined && tooltipLines.length > 0) {
        const span = document.createElement("span");
        span.className = "mission-success-chance-value";
        span.textContent = value;
        span.title = tooltipLines.join("\n");
        dd.appendChild(span);
      } else {
        dd.textContent = value;
      }
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
  }

  function renderMinionsPanel(): void {
    const p = state.player;
    const eligibleRehires = state.minionRehireQueue.filter(
      (e) => state.turnNumber >= e.availableFromTurn,
    );
    const hireOfferCount = state.availableMinionTemplateIds.length + eligibleRehires.length;
    minionsRosterHeading.textContent = `Your roster (${p.minions.length}/${p.maxRosterSize})`;
    minionsAvailableHeading.textContent = `Available to hire (${hireOfferCount})`;

    /* Infamy gates which startingLevel templates the pool will offer (see pickHireOfferTemplateIds). */
    const thresholds = content.balance.hireLevelInfamyThresholds;
    const levelCap = maxHireableStartingLevel(p.infamy, thresholds);
    const nextGate = nextHireLevelInfamyThreshold(p.infamy, thresholds);
    minionsHireGateEl.textContent =
      nextGate === null
        ? `Recruiting up to level ${levelCap} — every tier unlocked.`
        : `Recruiting up to level ${levelCap}. Level ${levelCap + 1} recruits appear at ${nextGate} infamy (now ${p.infamy}).`;

    minionsRosterEl.innerHTML = "";
    if (state.player.minions.length === 0) {
      const empty = document.createElement("p");
      empty.className = "minions-panel-empty";
      empty.textContent = "None hired yet.";
      minionsRosterEl.appendChild(empty);
    } else {
      const busy = busyInstanceIds(state.activeMissions);
      const mainOnly = state.phase === "main";
      for (const inst of state.player.minions) {
        const tpl = content.minions.find((m) => m.id === inst.templateId);
        const card = document.createElement("article");
        card.className = "minions-card minions-card--roster";
        card.dataset.assignInstanceId = inst.instanceId;
        const isBusy = busy.has(inst.instanceId);
        const canDrag = mainOnly && !isBusy;
        card.draggable = canDrag;
        if (canDrag) {
          card.classList.add("assign-draggable-minion");
        }
        if (isBusy) {
          card.classList.add("minions-card--busy");
        }
        const body = appendCardArtShell(card, resolveMinionCardArt(tpl));
        const title = document.createElement("h4");
        title.className = "minions-card-title";
        title.textContent = tpl?.name ?? inst.templateId;
        body.appendChild(title);
        const activeForMinion = state.activeMissions.find((am) =>
          am.participantInstanceIds.includes(inst.instanceId),
        );
        const statusValue = activeForMinion
          ? content.missions.find((m) => m.id === activeForMinion.missionTemplateId)
              ?.name ?? activeForMinion.missionTemplateId
          : "Waiting";
        const dl = document.createElement("dl");
        dl.className = "minions-card-stats";
        appendMinionStatRows(dl, [
          { label: "Status", value: statusValue },
          { label: "CP cost", value: String(tpl?.hireCommandPoints ?? "—") },
          { label: "Level", value: String(inst.currentLevel) },
          { label: "XP", value: String(inst.currentExperience) },
        ]);
        appendMinionTraitsRow(dl, content, inst.traitIds, {
          roster: state.player.minions,
          traits: inst.dynamicTraits,
        });
        body.appendChild(dl);

        const fireBtn = document.createElement("button");
        fireBtn.type = "button";
        fireBtn.className = "minions-card-fire";
        fireBtn.setAttribute(
          "aria-label",
          `Fire ${tpl?.name ?? "minion"} from roster`,
        );
        fireBtn.innerHTML =
          '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
        const canFire = mainOnly && !isBusy;
        fireBtn.disabled = !canFire;
        if (!mainOnly) {
          fireBtn.title = "Only during Main Phase";
        } else if (isBusy) {
          fireBtn.title = "Cannot fire while on a mission";
        } else {
          fireBtn.title = "Remove from roster (returns to hire pool after cooldown)";
        }
        fireBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (state.phase !== "main" || busy.has(inst.instanceId)) {
            return;
          }
          dispatch((s) => fireMinion(s, content, inst.instanceId));
        });
        fireBtn.addEventListener("mousedown", (ev) => {
          ev.stopPropagation();
        });
        card.appendChild(fireBtn);

        minionsRosterEl.appendChild(card);
      }
    }

    minionsAvailableEl.innerHTML = "";
    if (
      state.availableMinionTemplateIds.length === 0 &&
      eligibleRehires.length === 0
    ) {
      const empty = document.createElement("p");
      empty.className = "minions-panel-empty";
      empty.textContent =
        content.minions.length === 0
          ? "No minion templates in catalog."
          : "No hire offers right now.";
      minionsAvailableEl.appendChild(empty);
    }
    for (const templateId of state.availableMinionTemplateIds) {
      const tpl = content.minions.find((m) => m.id === templateId);
      if (!tpl) {
        continue;
      }
      const card = document.createElement("article");
      card.className = "minions-card minions-card--available";
      const body = appendCardArtShell(card, resolveMinionCardArt(tpl));
      const title = document.createElement("h4");
      title.className = "minions-card-title";
      title.textContent = tpl.name;
      body.appendChild(title);
      const dl = document.createElement("dl");
      dl.className = "minions-card-stats";
      const startingIds = tpl.startingTraitIds ?? [];
      appendMinionStatRows(dl, [
        { label: "CP cost", value: String(tpl.hireCommandPoints) },
        { label: "Level", value: String(tpl.startingLevel ?? 1) },
        { label: "XP", value: "0" },
      ]);
      appendMinionTraitsRow(dl, content, startingIds, {
        previewLabels: formatStartingDynamicTraitsPreview(content, tpl.startingDynamicTraits),
      });
      body.appendChild(dl);

      const actions = document.createElement("div");
      actions.className = "minions-card-actions";
      const hireBtn = document.createElement("button");
      hireBtn.type = "button";
      hireBtn.className = "btn btn-primary minions-card-hire";
      hireBtn.textContent = "Hire";

      const mainOnly = state.phase === "main";
      const canAfford = state.player.commandPoints >= tpl.hireCommandPoints;
      const rosterFull = state.player.minions.length >= state.player.maxRosterSize;
      hireBtn.disabled = !mainOnly || !canAfford || rosterFull;
      if (!mainOnly) {
        hireBtn.title = "Only during Main Phase";
      } else if (rosterFull) {
        hireBtn.title = `Roster full (${state.player.minions.length}/${state.player.maxRosterSize})`;
      } else if (!canAfford) {
        hireBtn.title = `Need ${tpl.hireCommandPoints} CP (${state.player.commandPoints} available)`;
      } else {
        hireBtn.title = `Spend ${tpl.hireCommandPoints} CP`;
      }

      hireBtn.addEventListener("click", () => {
        if (state.phase !== "main") {
          return;
        }
        dispatch((s) => hireMinion(s, content, tpl.id, crypto.randomUUID()));
      });

      actions.appendChild(hireBtn);
      body.appendChild(actions);

      minionsAvailableEl.appendChild(card);
    }

    for (const { minion: rehireInst } of eligibleRehires) {
      const tpl = content.minions.find((m) => m.id === rehireInst.templateId);
      const card = document.createElement("article");
      card.className = "minions-card minions-card--available minions-card--rehire";
      const body = appendCardArtShell(card, resolveMinionCardArt(tpl));
      const title = document.createElement("h4");
      title.className = "minions-card-title";
      title.textContent = tpl?.name ?? rehireInst.templateId;
      body.appendChild(title);
      const dl = document.createElement("dl");
      dl.className = "minions-card-stats";
      appendMinionStatRows(dl, [
        { label: "CP cost", value: String(tpl?.hireCommandPoints ?? "—") },
        { label: "Level", value: String(rehireInst.currentLevel) },
        { label: "XP", value: String(rehireInst.currentExperience) },
      ]);
      appendMinionTraitsRow(dl, content, rehireInst.traitIds, {
        roster: state.player.minions,
        traits: rehireInst.dynamicTraits,
      });
      body.appendChild(dl);

      const actions = document.createElement("div");
      actions.className = "minions-card-actions";
      const hireBtn = document.createElement("button");
      hireBtn.type = "button";
      hireBtn.className = "btn btn-primary minions-card-hire";
      hireBtn.textContent = "Re-hire";

      const mainOnly = state.phase === "main";
      const cost = tpl?.hireCommandPoints ?? 0;
      const canAfford = state.player.commandPoints >= cost;
      const rosterFull = state.player.minions.length >= state.player.maxRosterSize;
      hireBtn.disabled = !mainOnly || !canAfford || rosterFull || !tpl;
      if (!tpl) {
        hireBtn.title = "Unknown minion template";
      } else if (!mainOnly) {
        hireBtn.title = "Only during Main Phase";
      } else if (rosterFull) {
        hireBtn.title = `Roster full (${state.player.minions.length}/${state.player.maxRosterSize})`;
      } else if (!canAfford) {
        hireBtn.title = `Need ${cost} CP (${state.player.commandPoints} available)`;
      } else {
        hireBtn.title = `Spend ${cost} CP to restore this minion`;
      }

      hireBtn.addEventListener("click", () => {
        if (state.phase !== "main") {
          return;
        }
        dispatch((s) => rehireMinion(s, content, rehireInst.instanceId));
      });

      actions.appendChild(hireBtn);
      body.appendChild(actions);
      minionsAvailableEl.appendChild(card);
    }
  }

  type MissionCardDragMeta =
    | { draggable: true; source: "lair"; missionTemplateId: string }
    | { draggable: true; source: "event"; missionTemplateId: string }
    | {
        draggable: true;
        source: "omega";
        missionTemplateId: string;
        stageIndex: number;
        slotIndex: number;
      };

  function omegaPlanMissionCard(
    missionId: string,
    dragMeta?: MissionCardDragMeta,
  ): HTMLElement {
    const article = buildMissionCatalogArticle(missionId);

    if (dragMeta?.draggable === true) {
      const meta = dragMeta;
      article.draggable = true;
      article.classList.add("assign-draggable-mission");
      article.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        const json =
          meta.source === "lair"
            ? missionDragJson("lair", meta.missionTemplateId)
            : meta.source === "event"
              ? missionDragJson("event", meta.missionTemplateId)
              : missionDragJson(
                  "omega",
                  meta.missionTemplateId,
                  meta.stageIndex,
                  meta.slotIndex,
                );
        e.dataTransfer?.setData("text/plain", json);
        e.dataTransfer!.effectAllowed = "copy";
      });
    } else {
      article.draggable = false;
    }

    return article;
  }

  function renderOmegaPlanPanel(): void {
    omegaPlanPanelEl.innerHTML = "";
    const activeId = state.activeOmegaPlanId;
    if (activeId === null) {
      const empty = document.createElement("p");
      empty.className = "omega-plan-empty";
      empty.textContent = "No Omega Plans in content.";
      omegaPlanPanelEl.appendChild(empty);
      return;
    }
    const plan = getOmegaPlanById(content, activeId);
    if (!plan) {
      const empty = document.createElement("p");
      empty.className = "omega-plan-empty";
      empty.textContent = "Omega plan not found.";
      omegaPlanPanelEl.appendChild(empty);
      return;
    }

    const header = document.createElement("div");
    header.className = "omega-plan-header";
    /* Art only when authored — omega plans have no default placeholder. */
    const headerBody =
      plan.cardArt !== undefined ? appendCardArtShell(header, plan.cardArt) : header;

    const nameEl = document.createElement("p");
    nameEl.className = "omega-plan-name";
    nameEl.textContent = plan.name;
    headerBody.appendChild(nameEl);

    const descEl = document.createElement("p");
    descEl.className = "omega-plan-description";
    descEl.textContent = plan.description;
    headerBody.appendChild(descEl);

    const stageHint = document.createElement("p");
    stageHint.className = "omega-plan-stage-hint";
    const activeStageRequired = omegaStageRequiredMissions(plan, state.activeOmegaStageIndex);
    const activeStageDone = Math.min(
      activeStageRequired,
      state.omegaStageProgress[state.activeOmegaStageIndex]!.filter(Boolean).length,
    );
    stageHint.textContent = `Active phase: ${state.activeOmegaStageIndex + 1} · Missions complete: ${activeStageDone} of ${activeStageRequired}`;
    headerBody.appendChild(stageHint);

    omegaPlanPanelEl.appendChild(header);

    const PHASE_ROMAN = ["I", "II", "III"] as const;
    const PHASE_NAMES = [
      "Shadow Seeding",
      "Global Destabilization",
      "Final Subjugation",
    ] as const;

    const phasesWrap = document.createElement("div");
    phasesWrap.className = "omega-plan-phases";

    const mainOnly = state.phase === "main";
    for (let stageIndex = 0; stageIndex < 3; stageIndex += 1) {
      const stage = plan.stages[stageIndex]!;
      const section = document.createElement("section");
      section.className = "omega-plan-phase";
      section.setAttribute("aria-label", `Phase ${stageIndex + 1}`);
      const isCurrent = stageIndex === state.activeOmegaStageIndex;
      const isComplete = stageIndex < state.activeOmegaStageIndex;
      if (isCurrent) {
        section.classList.add("omega-plan-phase--current");
      } else if (isComplete) {
        section.classList.add("omega-plan-phase--complete");
      } else {
        section.classList.add("omega-plan-phase--locked");
      }

      const stageRequired = omegaStageRequiredMissions(plan, stageIndex);

      const phaseHeader = document.createElement("div");
      phaseHeader.className = "omega-phase-header";
      const headerText = document.createElement("div");
      const kicker = document.createElement("p");
      kicker.className = "omega-phase-kicker";
      kicker.style.margin = "0";
      kicker.textContent = `Phase ${PHASE_ROMAN[stageIndex]}`;
      const heading = document.createElement("h3");
      heading.className = "omega-plan-phase-title";
      heading.textContent = PHASE_NAMES[stageIndex]!;
      const requirement = document.createElement("p");
      requirement.className = "omega-phase-requirement";
      requirement.textContent = `Complete ${stageRequired} of ${stage.missionIds.length}`;
      requirement.title =
        stageRequired < stage.missionIds.length
          ? `Any ${stageRequired} of this phase's ${stage.missionIds.length} missions must succeed to advance.`
          : "Every mission in this phase must succeed to advance.";
      headerText.appendChild(kicker);
      headerText.appendChild(heading);
      headerText.appendChild(requirement);
      phaseHeader.appendChild(headerText);

      const phaseBadge = document.createElement("span");
      if (isComplete) {
        phaseBadge.className = "status-badge status-badge--complete";
        phaseBadge.textContent = "Complete";
      } else if (isCurrent) {
        phaseBadge.className = "status-badge status-badge--inprogress";
        phaseBadge.textContent = "In Progress";
      } else {
        phaseBadge.className = "status-badge status-badge--locked";
        phaseBadge.textContent = "Locked";
      }
      phaseHeader.appendChild(phaseBadge);
      section.appendChild(phaseHeader);

      const stageProgress = state.omegaStageProgress[stageIndex]!;
      const phaseSuccesses = Math.min(stageRequired, stageProgress.filter(Boolean).length);
      const progress = document.createElement("div");
      progress.className = "omega-phase-progress";
      const fill = document.createElement("div");
      fill.className = "omega-phase-progress__fill";
      if (isComplete) {
        fill.classList.add("omega-phase-progress__fill--complete");
      }
      fill.style.width = `${Math.round((phaseSuccesses / stageRequired) * 100)}%`;
      progress.appendChild(fill);
      section.appendChild(progress);

      const missionWrap = document.createElement("div");
      missionWrap.className = "omega-plan-phase-missions";
      for (let mi = 0; mi < 3; mi += 1) {
        const missionId = stage.missionIds[mi]!;
        const card = omegaPlanMissionCard(
          missionId,
          mainOnly && isCurrent
            ? {
                draggable: true,
                source: "omega",
                missionTemplateId: missionId,
                stageIndex,
                slotIndex: mi,
              }
            : undefined,
        );

        const slotDone = stageProgress[mi] === true;
        const slotRunning =
          isCurrent &&
          !slotDone &&
          state.activeMissions.some(
            (am) =>
              am.missionSource === "omega" &&
              am.omegaStageIndex === stageIndex &&
              am.omegaSlotIndex === mi,
          );
        const badge = document.createElement("span");
        badge.classList.add("status-badge", "omega-card-badge");
        if (slotDone) {
          badge.classList.add("status-badge--complete");
          badge.textContent = "Complete";
        } else if (slotRunning) {
          badge.classList.add("status-badge--inprogress");
          badge.textContent = "In Progress";
        } else if (isCurrent) {
          badge.classList.add("status-badge--pending");
          badge.textContent = "Pending";
        } else if (isComplete) {
          /* Phase cleared without this slot — it was never required. */
          badge.classList.add("status-badge--locked");
          badge.textContent = "Skipped";
        } else {
          badge.classList.add("status-badge--locked");
          badge.textContent = "Locked";
        }
        card.appendChild(badge);
        missionWrap.appendChild(card);
      }

      section.appendChild(missionWrap);
      phasesWrap.appendChild(section);
    }

    omegaPlanPanelEl.appendChild(phasesWrap);
  }

  function renderAssetsPanel(): void {
    assetsPanelEl.innerHTML = "";
    const assetById = new Map(content.assets.map((a) => [a.id, a]));
    const rows = Object.entries(state.player.assets)
      .filter(([, qty]) => qty > 0)
      .map(([assetId, quantity]) => {
        const template = assetById.get(assetId);
        const sortKey = (template?.name ?? assetId).toLowerCase();
        return { assetId, quantity, template, sortKey };
      })
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    if (rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "assets-panel-empty";
      empty.textContent = "None owned yet.";
      assetsPanelEl.appendChild(empty);
      return;
    }

    const gridMode = currentMenu === "assets";
    let mount: HTMLElement = assetsPanelEl;
    if (gridMode) {
      const grid = document.createElement("div");
      grid.className = "assets-panel-grid";
      assetsPanelEl.appendChild(grid);
      mount = grid;
    }

    for (const { assetId, quantity, template } of rows) {
      let usedInPlan = 0;
      for (let j = 0; j < assignAssetSlotAssetIds.length; j += 1) {
        if (assignAssetSlotAssetIds[j] === assetId) {
          usedInPlan += 1;
        }
      }
      const available = Math.max(0, quantity - usedInPlan);
      const mainOnly = state.phase === "main";

      const article = document.createElement("article");
      article.className = "asset-card";
      if (gridMode) {
        article.classList.add("asset-card--grid-tile");
      }
      if (available <= 0) {
        article.classList.add("asset-card--unavailable");
      }
      article.draggable = mainOnly && available > 0;
      article.addEventListener("dragstart", (e) => {
        if (!article.draggable) {
          e.preventDefault();
          return;
        }
        e.dataTransfer?.setData("text/plain", assetCardDragJson(assetId));
        e.dataTransfer!.effectAllowed = "copy";
      });

      const body = appendCardArtShell(article, resolveAssetCardArt(template));
      const title = document.createElement("h4");
      title.className = "asset-card-title";
      title.textContent = template?.name ?? assetId;
      body.appendChild(title);

      const dl = document.createElement("dl");
      dl.className = "asset-card-stats";
      appendMinionStatRows(dl, [
        { label: "Available", value: String(available) },
        { label: "Owned", value: String(quantity) },
      ]);
      body.appendChild(dl);

      const descText = template?.description?.trim();
      if (descText) {
        const desc = document.createElement("p");
        desc.className = "asset-card-description";
        desc.textContent = descText;
        body.appendChild(desc);
      }

      mount.appendChild(article);
    }
  }

  function formatMissionTargetSummary(target: MissionTarget): string {
    switch (target.kind) {
      case "none":
        return "—";
      case "location": {
        const loc = content.locations.find((l) => l.id === target.locationId);
        return loc?.name ?? target.locationId;
      }
      case "asset": {
        const loc = content.locations.find((l) => l.id === target.locationId);
        const locName = loc?.name ?? target.locationId;
        const placement = state.locationAssetSlots.find((p) => p.locationId === target.locationId);
        const slot = placement?.slots[target.slotIndex];
        const vis = target.visibilityAtAssign === "hidden" ? "Hidden" : "Revealed";
        let an = "Asset";
        if (slot?.kind === "empty") {
          an = "—";
        } else if (
          slot &&
          isOccupiedAssetSlot(slot) &&
          effectiveVisibilityOfSlot(slot, intelLevelAtLocation(state, target.locationId)) ===
            "revealed"
        ) {
          an = content.assets.find((a) => a.id === slot.assetId)?.name ?? slot.assetId;
        }
        return `${vis} (${an}) @ ${locName}`;
      }
      case "minion": {
        const inst = state.player.minions.find((m) => m.instanceId === target.instanceId);
        const tpl = inst
          ? content.minions.find((t) => t.id === inst.templateId)
          : undefined;
        return tpl?.name ?? target.instanceId;
      }
    }
  }

  function appendActiveMissionCard(parent: HTMLElement, am: ActiveMission): void {
    const mission = findMissionOrEventTemplate(am.missionTemplateId);
    const targetLocId =
      am.target.kind === "location" || am.target.kind === "asset"
        ? am.target.locationId
        : null;
    const targetLoc = targetLocId
      ? content.locations.find((l) => l.id === targetLocId)
      : undefined;
    const sourceLabel =
      am.missionSource === "lair"
        ? "Lair"
        : am.missionSource === "event"
          ? "Event"
          : `Omega (phase ${(am.omegaStageIndex ?? 0) + 1} · slot ${(am.omegaSlotIndex ?? 0) + 1})`;

    const article = document.createElement("article");
    article.className = "asset-card active-mission-card";

    const body = appendCardArtShell(article, resolveMissionCardArt(mission));

    appendMissionTitleWithFxTooltip(body, mission, mission?.name ?? am.missionTemplateId);

    if (mission?.description) {
      const desc = document.createElement("p");
      desc.className = "asset-card-description";
      desc.textContent = mission.description;
      body.appendChild(desc);
    }

    const dl = document.createElement("dl");
    dl.className = "asset-card-stats";
    const participants = state.player.minions.filter((inst) =>
      am.participantInstanceIds.includes(inst.instanceId),
    );
    const participantNames = participants
      .map((inst) => {
        const tpl = content.minions.find((t) => t.id === inst.templateId);
        return tpl?.name ?? inst.templateId;
      })
      .join(", ");

    const rows: Array<{ label: string; value: string; tooltipLines?: readonly string[] }> = [
      { label: "Source", value: sourceLabel },
      { label: "Target", value: formatMissionTargetSummary(am.target) },
    ];
    if (targetLoc) {
      rows.push(
        { label: "Location type", value: formatLocationTypeLabel(targetLoc.locationType) },
        { label: "Location level", value: String(targetLoc.locationLevel) },
      );
    }
    rows.push({
      label: "Participants",
      value: participantNames.length > 0 ? participantNames : "—",
    });

    if (mission) {
      const lid = getMissionTargetLocationId(am.target);
      const opposingAgentPenaltyCount =
        lid === null ? 0 : countPlayerVisibleOpposingAgentsAtLocation(state, lid);
      const dynamicTraitDelta = dynamicTraitSuccessModifierFromFullRoster(
        state.player.minions,
        am.participantInstanceIds,
        lid,
        content.balance.dynamicTraitModifiers,
      );
      const successOpts = {
        ...missionSuccessOptionsForTarget(state, am.target),
        traitsCatalog: content.traits,
        balance: content.balance,
        opposingAgentPenaltyCount,
        dynamicTraitDelta,
        eventSuccessModifierDelta: totalEventSuccessModifierDelta(),
        ...(mission.requiredAssetIds.length > 0
          ? { assignedAssetIds: am.plannedAssetIds }
          : { playerAssets: state.player.assets }),
      };
      const mergedDisplay = mergedRequiredTraitIdsSorted(mission, successOpts);
      rows.push(
        { label: "Start cost", value: `${mission.startCommandPoints} CP (paid)` },
        {
          label: "Progress",
          value: `${am.turnsRemaining} / ${mission.durationTurns} turn${
            mission.durationTurns === 1 ? "" : "s"
          } remaining`,
        },
        {
          label: "Required traits",
          value: traitDisplayNames(content, mergedDisplay),
        },
      );
      if (mission.requiredAssetIds.length > 0) {
        rows.push(
          {
            label: "Required assets",
            value: assetDisplayNames(content, mission.requiredAssetIds),
          },
          {
            label: "Planned assets",
            value: plannedAssetSlotsDisplay(
              content,
              mission.requiredAssetIds,
              am.plannedAssetIds,
            ),
          },
        );
      }
      let successValue: string;
      let successTooltip: readonly string[] | undefined;
      const partCap = participantCapForActiveMission(am);
      if (canAssignParticipants(participants, partCap)) {
        const breakdown = computeSuccessChanceBreakdown(mission, participants, successOpts);
        successValue = `${breakdown.finalPercent}%`;
        const dynEntries = dynamicTraitSuccessModifierBreakdownFromFullRoster(
          content,
          state.player.minions,
          am.participantInstanceIds,
          lid,
        );
        successTooltip = formatMissionSuccessChanceTooltipLines(
          breakdown,
          dynEntries.entries,
          state.player.minions,
        );
      } else {
        successValue = "—";
      }
      rows.push(
        successTooltip !== undefined && successTooltip.length > 0
          ? { label: "Success chance", value: successValue, tooltipLines: successTooltip }
          : { label: "Success chance", value: successValue },
      );
    } else {
      rows.push(
        { label: "Turns remaining", value: String(am.turnsRemaining) },
        { label: "Mission template", value: am.missionTemplateId },
      );
    }

    appendMinionStatRows(dl, rows);
    body.appendChild(dl);

    if (mission && mission.durationTurns > 0) {
      const pct = Math.max(
        0,
        Math.min(
          100,
          Math.round(
            ((mission.durationTurns - am.turnsRemaining) / mission.durationTurns) * 100,
          ),
        ),
      );
      const progressWrap = document.createElement("div");
      progressWrap.className = "mission-progress";
      const head = document.createElement("div");
      head.className = "mission-progress__head";
      const label = document.createElement("span");
      label.className = "mission-progress__label";
      label.textContent = "Operation Progress";
      const value = document.createElement("span");
      value.className = "mission-progress__value";
      value.textContent = `${pct}%`;
      head.appendChild(label);
      head.appendChild(value);
      const bar = document.createElement("div");
      bar.className = "mission-progress__bar";
      const fill = document.createElement("div");
      fill.className = "mission-progress__fill";
      fill.style.width = `${pct}%`;
      bar.appendChild(fill);
      progressWrap.appendChild(head);
      progressWrap.appendChild(bar);
      body.appendChild(progressWrap);
    }

    const mainOnly = state.phase === "main";
    const actions = document.createElement("div");
    actions.className = "active-mission-card-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn active-mission-card-cancel";
    cancelBtn.textContent = "Cancel mission";
    cancelBtn.disabled = !mainOnly;
    cancelBtn.title = mainOnly ? "Remove mission; minions free immediately" : "Only during Main Phase";
    cancelBtn.addEventListener("click", () => {
      if (state.phase !== "main") {
        return;
      }
      dispatch((s) => cancelMission(s, content, am.id));
    });
    actions.appendChild(cancelBtn);
    body.appendChild(actions);

    parent.appendChild(article);
  }

  function renderActiveMissionsInto(panel: HTMLElement): void {
    panel.innerHTML = "";
    const summary = document.createElement("p");
    summary.className = "active-missions-summary";
    summary.textContent = `${state.activeMissions.length} / ${state.player.maxConcurrentMissions} missions`;
    panel.appendChild(summary);

    if (state.activeMissions.length === 0) {
      const empty = document.createElement("p");
      empty.className = "assets-panel-empty";
      empty.textContent = "No active missions.";
      panel.appendChild(empty);
      return;
    }

    const listWrap = document.createElement("div");
    listWrap.className = "missions-active-list";
    for (const am of state.activeMissions) {
      appendActiveMissionCard(listWrap, am);
    }
    panel.appendChild(listWrap);
  }

  function renderEventsPanelInto(panel: HTMLElement): void {
    panel.innerHTML = "";
    const mainOnly = state.phase === "main";

    const offerHeading = document.createElement("h3");
    offerHeading.className = "events-tab-section-title";
    offerHeading.textContent = "Current offer";
    panel.appendChild(offerHeading);

    const curId = state.currentEventTemplateId;
    const activeEventMission = state.activeMissions.find((am) => am.missionSource === "event");
    if (curId === null || content.events.length === 0) {
      const empty = document.createElement("p");
      empty.className = "assets-panel-empty";
      if (content.events.length === 0) {
        empty.textContent = "No events in this catalog.";
      } else if (activeEventMission) {
        const n =
          content.events.find((e) => e.id === activeEventMission.missionTemplateId)?.name ??
          activeEventMission.missionTemplateId;
        empty.textContent = `"${n}" is under way — its effects land when the mission resolves.`;
      } else if (state.eventCooldownTurnsRemaining > 0) {
        const t = state.eventCooldownTurnsRemaining;
        empty.textContent = `No event on the table. Next opportunity in ${t} ${t === 1 ? "turn" : "turns"}.`;
      } else {
        empty.textContent = "No event on the table. A new opportunity is due next turn.";
      }
      panel.appendChild(empty);
    } else {
      const et = content.events.find((e) => e.id === curId);
      const article = buildMissionCatalogArticle(curId);
      /* One event mission at a time — once started, the offer is no longer draggable. */
      if (mainOnly && et && !activeEventMission) {
        article.draggable = true;
        article.classList.add("assign-draggable-mission");
        article.addEventListener("dragstart", (e) => {
          e.stopPropagation();
          e.dataTransfer?.setData("text/plain", missionDragJson("event", curId));
          e.dataTransfer!.effectAllowed = "copy";
        });
      } else {
        article.draggable = false;
      }
      panel.appendChild(article);
      const note = document.createElement("p");
      note.className = "assets-panel-empty";
      note.style.marginTop = "0.25rem";
      const left = state.currentEventTurnsRemaining;
      if (et?.special === "lair_raid") {
        /* The one offer that cannot be shrugged off: ignoring or losing it ends the run. */
        note.textContent = activeEventMission
          ? "The raid is under way. Lose it and the run ends."
          : `Answer this or the run ends — ${left} ${left === 1 ? "turn" : "turns"} left.`;
      } else if (activeEventMission) {
        note.textContent = "Started this turn — Execute Plan takes the offer off the table.";
      } else if (left <= 1) {
        note.textContent =
          "Last turn to act: drag the offer to Plan mission, or it expires when you Execute Plan.";
      } else {
        note.textContent = `Drag the offer to Plan mission to start it. ${left} turns left before it expires.`;
      }
      panel.appendChild(note);
    }
  }

  /** One runnable mission offer plus how it may be dragged into the plan slot. */
  type AvailableMissionEntry = {
    missionTemplateId: string;
    dragMeta?: MissionCardDragMeta;
    status?: { label: string; kind: "inprogress" | "pending" | "locked" };
  };

  /** Runnable offers from one source (omega phase / lair / lair upgrades / event). */
  type AvailableMissionGroup = {
    label: string;
    /** Shown in place of the card list when the source has nothing on offer. */
    emptyText: string;
    /** Optional rule line under the heading (how the group's offers relate to each other). */
    note?: string;
    entries: AvailableMissionEntry[];
  };

  function missionDisplayName(missionTemplateId: string): string {
    return findMissionOrEventTemplate(missionTemplateId)?.name ?? missionTemplateId;
  }

  function compareMissionIdsByName(a: string, b: string): number {
    return missionDisplayName(a).localeCompare(missionDisplayName(b), undefined, {
      sensitivity: "base",
    });
  }

  /**
   * The single upgrade level the player may act on right now, rendered the same way in the Lair
   * panel and the Missions menu. Its missions are mutually exclusive — starting one closes the
   * level while it runs, completing one locks the rest out for the run — so the offer carries
   * the rule line and the per-card badges that say so. Levels below are settled; levels above
   * stay hidden until their turn.
   */
  function lairUpgradeOffer(): {
    label: string;
    note: string | null;
    emptyText: string;
    entries: AvailableMissionEntry[];
  } {
    const total = lairUpgradeLevels(state.activeLairId, content).length;
    const current = currentLairUpgradeLevel(
      state.activeLairId,
      state.completedLairUpgradeMissionIds,
      content,
    );
    if (current === null) {
      return {
        label: "Lair Upgrades",
        note: null,
        emptyText:
          total === 0 ? "This lair has no upgrades." : "Every upgrade level is installed.",
        entries: [],
      };
    }
    const { level, index } = current;
    const levelLabel = `Level ${index + 1} of ${total}`;
    const label =
      level.name !== undefined
        ? `Lair Upgrades — ${levelLabel}: ${level.name}`
        : `Lair Upgrades — ${levelLabel}`;
    const running = state.activeMissions.find(
      (am) => am.missionSource === "lair" && level.missionIds.includes(am.missionTemplateId),
    );
    const entries: AvailableMissionEntry[] = [...level.missionIds]
      .sort(compareMissionIdsByName)
      .map((mid) => {
        if (running !== undefined) {
          return {
            missionTemplateId: mid,
            status:
              running.missionTemplateId === mid
                ? ({ label: "In Progress", kind: "inprogress" } as const)
                : ({ label: "Locked", kind: "locked" } as const),
          };
        }
        return {
          missionTemplateId: mid,
          dragMeta:
            state.phase === "main"
              ? ({ draggable: true, source: "lair", missionTemplateId: mid } as const)
              : undefined,
          ...(level.missionIds.length > 1
            ? { status: { label: "Choose One", kind: "pending" } as const }
            : {}),
        };
      });
    const note =
      running !== undefined
        ? `${missionDisplayName(running.missionTemplateId)} is underway — the other choices stay closed until it resolves.`
        : level.missionIds.length > 1
          ? "Pick one. Completing it installs that upgrade, locks the others out for this run, and opens the next level."
          : "Completing it installs this upgrade and opens the next level.";
    return { label, note, emptyText: "No pending upgrades.", entries };
  }

  /** Corner status chip on a mission card (In Progress / Locked / Pending). */
  function appendMissionCardBadge(
    card: HTMLElement,
    status: NonNullable<AvailableMissionEntry["status"]>,
  ): void {
    const badge = document.createElement("span");
    badge.classList.add("status-badge", "omega-card-badge", `status-badge--${status.kind}`);
    badge.textContent = status.label;
    card.appendChild(badge);
  }

  /**
   * Every mission the run has unlocked and could still be started from, grouped by source.
   * Mirrors what `assignMission` accepts: the active omega phase's unfinished slots, the lair
   * pool, pending lair upgrades, and the global event offer.
   */
  function collectAvailableMissionGroups(): AvailableMissionGroup[] {
    const mainOnly = state.phase === "main";
    const groups: AvailableMissionGroup[] = [];

    const planId = state.activeOmegaPlanId;
    const plan = planId !== null ? getOmegaPlanById(content, planId) : undefined;
    if (plan) {
      const stageIndex = state.activeOmegaStageIndex;
      const stage = plan.stages[stageIndex];
      const stageProgress = state.omegaStageProgress[stageIndex];
      const entries: AvailableMissionEntry[] = [];
      if (stage && stageProgress) {
        for (let slotIndex = 0; slotIndex < OMEGA_MISSIONS_PER_STAGE; slotIndex += 1) {
          const missionTemplateId = stage.missionIds[slotIndex];
          if (missionTemplateId === undefined || stageProgress[slotIndex] === true) {
            continue;
          }
          const running = state.activeMissions.some(
            (am) =>
              am.missionSource === "omega" &&
              am.omegaStageIndex === stageIndex &&
              am.omegaSlotIndex === slotIndex,
          );
          entries.push({
            missionTemplateId,
            dragMeta:
              mainOnly && !running
                ? {
                    draggable: true,
                    source: "omega",
                    missionTemplateId,
                    stageIndex,
                    slotIndex,
                  }
                : undefined,
            status: running
              ? { label: "In Progress", kind: "inprogress" }
              : { label: "Pending", kind: "pending" },
          });
        }
      }
      groups.push({
        label: `Omega Plan — Phase ${stageIndex + 1}`,
        emptyText: "Every mission this phase needs is done.",
        entries,
      });
    }

    if (state.activeLairId !== null) {
      groups.push({
        label: "Lair",
        emptyText: "No missions at this lair.",
        entries: [...state.lairMissionIds].sort(compareMissionIdsByName).map((mid) => ({
          missionTemplateId: mid,
          dragMeta: mainOnly
            ? { draggable: true, source: "lair", missionTemplateId: mid }
            : undefined,
        })),
      });

      const upgrades = lairUpgradeOffer();
      groups.push({
        label: upgrades.label,
        emptyText: upgrades.emptyText,
        ...(upgrades.note !== null ? { note: upgrades.note } : {}),
        entries: upgrades.entries,
      });
    }

    const eventOfferId = state.currentEventTemplateId;
    const eventMissionRunning = state.activeMissions.some((am) => am.missionSource === "event");
    const eventEntries: AvailableMissionEntry[] = [];
    if (eventOfferId !== null) {
      eventEntries.push({
        missionTemplateId: eventOfferId,
        dragMeta:
          mainOnly && !eventMissionRunning
            ? { draggable: true, source: "event", missionTemplateId: eventOfferId }
            : undefined,
        status: eventMissionRunning
          ? { label: "In Progress", kind: "inprogress" }
          : {
              label: `${state.currentEventTurnsRemaining} ${
                state.currentEventTurnsRemaining === 1 ? "Turn" : "Turns"
              } Left`,
              kind: "pending",
            },
      });
    }
    groups.push({
      label: "Event Offer",
      emptyText: eventMissionRunning
        ? "The event you took is under way."
        : "No event on the table.",
      entries: eventEntries,
    });

    return groups;
  }

  function fillAvailableMissionsInto(container: HTMLElement): void {
    const groups = collectAvailableMissionGroups();
    const total = groups.reduce((sum, group) => sum + group.entries.length, 0);

    const summary = document.createElement("p");
    summary.className = "active-missions-summary";
    summary.textContent = `${total} mission${total === 1 ? "" : "s"} unlocked`;
    container.appendChild(summary);

    const hint = document.createElement("p");
    hint.className = "assets-panel-empty";
    hint.textContent =
      state.phase === "main"
        ? "Drag a mission onto the Plan Mission slot to start it."
        : "Missions can only be started during the Main Phase.";
    container.appendChild(hint);

    for (const group of groups) {
      const heading = document.createElement("h3");
      heading.className = "events-tab-section-title";
      heading.textContent = group.label;
      container.appendChild(heading);

      if (group.note !== undefined) {
        const note = document.createElement("p");
        note.className = "assets-panel-empty";
        note.textContent = group.note;
        container.appendChild(note);
      }

      if (group.entries.length === 0) {
        const empty = document.createElement("p");
        empty.className = "assets-panel-empty";
        empty.textContent = group.emptyText;
        container.appendChild(empty);
        continue;
      }

      const list = document.createElement("div");
      list.className = "missions-available-list";
      for (const entry of group.entries) {
        const card = omegaPlanMissionCard(entry.missionTemplateId, entry.dragMeta);
        if (entry.status) {
          appendMissionCardBadge(card, entry.status);
        }
        list.appendChild(card);
      }
      container.appendChild(list);
    }
  }

  /** One resolved / cancelled / aborted mission, as it reads in the history column. */
  type MissionHistoryRow = {
    missionTemplateId: string;
    targetLabel: string;
    outcomeLabel: string;
    outcomeKind: "complete" | "failed" | "locked";
    detailLines: string[];
  };

  function missionHistoryRowsForTurn(
    events: readonly ActivityEvent[],
  ): MissionHistoryRow[] {
    function signed(value: number): string {
      return value >= 0 ? `+${value}` : String(value);
    }

    const rows: MissionHistoryRow[] = [];
    for (const ev of events) {
      if (ev.kind === "mission_completed") {
        const detailLines = [
          `Roll ${ev.roll} vs ${ev.successChancePercent}% success chance`,
          `Infamy ${signed(ev.infamyDelta)} · Heat ${signed(ev.heatDelta)}`,
        ];
        if (ev.templateEffectDescriptions.length > 0) {
          detailLines.push(ev.templateEffectDescriptions.join("; "));
        }
        if (ev.criticalFailure) {
          const n = ev.criticalOpposingAgentCount ?? 0;
          detailLines.push(
            `Critical failure — ${n} opposing agent${n === 1 ? "" : "s"} on site.`,
          );
        }
        rows.push({
          missionTemplateId: ev.missionTemplateId,
          targetLabel: formatMissionTargetSummary(ev.target),
          outcomeLabel: ev.success ? "Success" : "Failure",
          outcomeKind: ev.success ? "complete" : "failed",
          detailLines,
        });
      } else if (ev.kind === "mission_cancelled") {
        rows.push({
          missionTemplateId: ev.missionTemplateId,
          targetLabel: formatMissionTargetSummary(ev.target),
          outcomeLabel: "Cancelled",
          outcomeKind: "locked",
          detailLines: ["Called off before it resolved; minions freed."],
        });
      } else if (ev.kind === "mission_aborted") {
        rows.push({
          missionTemplateId: ev.missionTemplateId,
          targetLabel: formatMissionTargetSummary(ev.target),
          outcomeLabel: "Aborted",
          outcomeKind: "locked",
          detailLines: [
            ev.reason === "missing_template"
              ? "Mission template is no longer in the catalog; assets refunded."
              : "Roster was invalid at resolve time; assets refunded.",
          ],
        });
      }
    }
    return rows;
  }

  function fillMissionHistoryInto(container: HTMLElement): void {
    /* `activityLog` is newest turn first; keep that order and read chronologically inside a turn. */
    const turns = state.activityLog
      .map((entry) => ({ turnNumber: entry.turnNumber, rows: missionHistoryRowsForTurn(entry.events) }))
      .filter((entry) => entry.rows.length > 0);

    const total = turns.reduce((sum, entry) => sum + entry.rows.length, 0);
    const summary = document.createElement("p");
    summary.className = "active-missions-summary";
    summary.textContent = `${total} mission${total === 1 ? "" : "s"} on record`;
    container.appendChild(summary);

    if (turns.length === 0) {
      const empty = document.createElement("p");
      empty.className = "assets-panel-empty";
      empty.textContent = "No missions have resolved yet.";
      container.appendChild(empty);
      return;
    }

    for (const turn of turns) {
      const section = document.createElement("section");
      section.className = "mission-history-turn";
      section.setAttribute("aria-label", `Turn ${turn.turnNumber}`);

      const heading = document.createElement("h3");
      heading.className = "events-tab-section-title";
      heading.textContent = `Turn ${turn.turnNumber}`;
      section.appendChild(heading);

      const list = document.createElement("ul");
      list.className = "mission-history-list";
      for (const row of turn.rows) {
        const li = document.createElement("li");
        li.className = "mission-history-row";

        const head = document.createElement("div");
        head.className = "mission-history-row__head";
        const name = document.createElement("span");
        name.className = "mission-history-row__name";
        name.textContent = missionDisplayName(row.missionTemplateId);
        const badge = document.createElement("span");
        badge.classList.add("status-badge", `status-badge--${row.outcomeKind}`);
        badge.textContent = row.outcomeLabel;
        head.appendChild(name);
        head.appendChild(badge);
        li.appendChild(head);

        const where = document.createElement("p");
        where.className = "mission-history-row__meta";
        where.textContent = `Target: ${row.targetLabel}`;
        li.appendChild(where);

        for (const line of row.detailLines) {
          const detail = document.createElement("p");
          detail.className = "mission-history-row__meta";
          detail.textContent = line;
          li.appendChild(detail);
        }

        list.appendChild(li);
      }
      section.appendChild(list);
      container.appendChild(section);
    }
  }

  function appendMissionsMenuColumn(
    parent: HTMLElement,
    label: string,
    fill: (container: HTMLElement) => void,
  ): void {
    const column = document.createElement("section");
    column.className = "missions-menu-column";
    column.setAttribute("aria-label", label);

    const heading = document.createElement("h3");
    heading.className = "game-controls-heading missions-menu-column-title";
    heading.textContent = label;
    column.appendChild(heading);

    const body = document.createElement("div");
    body.className = "missions-menu-column-body";
    fill(body);
    column.appendChild(body);

    parent.appendChild(column);
  }

  function renderMissionsPanel(): void {
    missionsPanelRootEl.innerHTML = "";

    if (currentMenu !== "missions") {
      /* Dashboard keeps the compact panel: what is running right now. */
      missionsPanelTitleEl.textContent = "Active Missions";
      renderActiveMissionsInto(missionsPanelRootEl);
      return;
    }

    missionsPanelTitleEl.textContent = "Missions";
    const columns = document.createElement("div");
    columns.className = "missions-menu-columns";
    appendMissionsMenuColumn(columns, "Available", fillAvailableMissionsInto);
    appendMissionsMenuColumn(columns, "Active", (body) => {
      renderActiveMissionsInto(body);
    });
    appendMissionsMenuColumn(columns, "History", fillMissionHistoryInto);
    missionsPanelRootEl.appendChild(columns);
  }

  function renderEventsPanel(): void {
    renderEventsPanelInto(eventsPanelEl);
  }

  function renderLocationsPanel(): void {
    locationsPanelEl.innerHTML = "";
    const securityByLocationId = new Map(
      state.locationSecurityStates.map((s) => [s.locationId, s.securityLevel]),
    );
    const intelByLocationId = new Map(
      state.locationIntelStates.map((s) => [s.locationId, s.intelLevel]),
    );
    const assetSlotsByLocationId = new Map(
      state.locationAssetSlots.map((p) => [p.locationId, p.slots]),
    );
    const assetNameById = new Map(content.assets.map((a) => [a.id, a.name]));
    const mainOnly = state.phase === "main";

    function sortedLocationsForCategory(tabType: LocationType) {
      return runLocations()
        .filter((loc) => loc.locationType === tabType)
        .sort((a, b) => {
          if (a.locationLevel !== b.locationLevel) {
            return a.locationLevel - b.locationLevel;
          }
          return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        });
    }

    function fillLocationList(listEl: HTMLElement, tabType: LocationType): void {
      const sortedForTab = sortedLocationsForCategory(tabType);
      if (sortedForTab.length === 0) {
        const empty = document.createElement("p");
        empty.className = "locations-panel-empty";
        empty.textContent = `No ${LOCATION_CATEGORY_LABEL[tabType].toLowerCase()} locations on this map.`;
        listEl.appendChild(empty);
        return;
      }
      for (const loc of sortedForTab) {
        const sec = securityByLocationId.get(loc.id);
        const slots = assetSlotsByLocationId.get(loc.id) ?? [];
        const article = buildLocationCardArticle(
          loc,
          sec,
          intelByLocationId.get(loc.id) ?? 0,
          slots,
          assetNameById,
          mainOnly,
          state.locationRequiredTraits[loc.id] ?? [],
          state.locationSecurityTraits[loc.id] ?? [],
        );
        listEl.appendChild(article);
      }
    }

    if (currentMenu === "locations") {
      const columnsWrap = document.createElement("div");
      columnsWrap.className = "locations-panel-columns";
      for (const tabType of LOCATION_CATEGORY_TAB_ORDER) {
        const column = document.createElement("section");
        column.className = "locations-panel-column";
        column.setAttribute("aria-label", `${LOCATION_CATEGORY_LABEL[tabType]} locations`);

        const heading = document.createElement("h3");
        heading.className = "game-controls-heading locations-panel-column-title";
        heading.textContent = LOCATION_CATEGORY_LABEL[tabType];

        const listEl = document.createElement("div");
        listEl.className = "locations-panel-list";
        fillLocationList(listEl, tabType);

        column.appendChild(heading);
        column.appendChild(listEl);
        columnsWrap.appendChild(column);
      }
      locationsPanelEl.appendChild(columnsWrap);
      return;
    }

    const tablist = document.createElement("div");
    tablist.className = "locations-category-tabs";
    tablist.setAttribute("role", "tablist");
    tablist.setAttribute("aria-label", "Location category");

    for (const tabType of LOCATION_CATEGORY_TAB_ORDER) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "locations-category-tab";
      if (tabType === locationsCategoryTab) {
        tab.classList.add("locations-category-tab--active");
      }
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", tabType === locationsCategoryTab ? "true" : "false");
      tab.id = `locations-tab-${tabType}`;
      tab.textContent = LOCATION_CATEGORY_LABEL[tabType];
      tab.addEventListener("click", () => {
        if (locationsCategoryTab === tabType) {
          return;
        }
        locationsCategoryTab = tabType;
        renderLocationsPanel();
      });
      tablist.appendChild(tab);
    }
    locationsPanelEl.appendChild(tablist);

    const listEl = document.createElement("div");
    listEl.className = "locations-panel-list";
    listEl.id = "locations-panel-list";
    listEl.setAttribute("role", "tabpanel");
    listEl.setAttribute("aria-labelledby", `locations-tab-${locationsCategoryTab}`);
    fillLocationList(listEl, locationsCategoryTab);
    locationsPanelEl.appendChild(listEl);
  }

  function renderLairPanel(): void {
    lairPanelEl.innerHTML = "";
    if (state.activeLairId === null) {
      const empty = document.createElement("p");
      empty.className = "assets-panel-empty";
      empty.textContent = "No lair in this run.";
      lairPanelEl.appendChild(empty);
      return;
    }
    const lair = getLairById(content, state.activeLairId);
    if (!lair) {
      const empty = document.createElement("p");
      empty.className = "assets-panel-empty";
      empty.textContent = "Lair not found in catalog.";
      lairPanelEl.appendChild(empty);
      return;
    }
    const header = document.createElement("div");
    header.className = "lair-panel-header";
    const headerBody = appendCardArtShell(header, resolveLairCardArt(lair));
    const nameEl = document.createElement("p");
    nameEl.className = "lair-panel-name";
    nameEl.textContent = lair.name;
    headerBody.appendChild(nameEl);
    if (lair.description) {
      const desc = document.createElement("p");
      desc.className = "lair-panel-description";
      desc.textContent = lair.description;
      headerBody.appendChild(desc);
    }
    lairPanelEl.appendChild(header);

    function missionNameForSort(mid: string): string {
      return content.missions.find((m) => m.id === mid)?.name ?? mid;
    }
    function sortMissionIds(ids: readonly string[]): string[] {
      return [...ids].sort((a, b) =>
        missionNameForSort(a).localeCompare(missionNameForSort(b), undefined, {
          sensitivity: "base",
        }),
      );
    }

    function fillLairMissionsInto(container: HTMLElement): void {
      if (state.lairMissionIds.length === 0) {
        const empty = document.createElement("p");
        empty.className = "assets-panel-empty";
        empty.textContent = "No missions at this lair.";
        container.appendChild(empty);
        return;
      }
      for (const mid of sortMissionIds(state.lairMissionIds)) {
        container.appendChild(
          omegaPlanMissionCard(
            mid,
            state.phase === "main"
              ? { draggable: true, source: "lair", missionTemplateId: mid }
              : undefined,
          ),
        );
      }
    }

    /** Only the next open upgrade level — earlier ones are settled, later ones stay unseen. */
    function fillLairUpgradesInto(container: HTMLElement): void {
      const offer = lairUpgradeOffer();
      if (offer.entries.length === 0) {
        const empty = document.createElement("p");
        empty.className = "assets-panel-empty";
        empty.textContent = offer.emptyText;
        container.appendChild(empty);
        return;
      }
      const levelLine = document.createElement("p");
      levelLine.className = "lair-upgrade-level-title";
      /* The column/tab is already titled "Upgrades"; keep just the level part here. */
      levelLine.textContent = offer.label.replace("Lair Upgrades — ", "");
      container.appendChild(levelLine);
      if (offer.note !== null) {
        const note = document.createElement("p");
        note.className = "assets-panel-empty";
        note.textContent = offer.note;
        container.appendChild(note);
      }
      for (const entry of offer.entries) {
        const card = omegaPlanMissionCard(entry.missionTemplateId, entry.dragMeta);
        if (entry.status) {
          appendMissionCardBadge(card, entry.status);
        }
        container.appendChild(card);
      }
    }

    if (currentMenu === "lair") {
      const columnsWrap = document.createElement("div");
      columnsWrap.className = "lair-panel-columns";

      const missionsCol = document.createElement("section");
      missionsCol.className = "lair-panel-column";
      missionsCol.setAttribute("aria-label", "Lair missions");
      const missionsHeading = document.createElement("h3");
      missionsHeading.className = "game-controls-heading lair-panel-column-title";
      missionsHeading.textContent = "Missions";
      const missionsList = document.createElement("div");
      missionsList.className = "lair-panel-missions";
      fillLairMissionsInto(missionsList);
      missionsCol.appendChild(missionsHeading);
      missionsCol.appendChild(missionsList);

      const upgradesCol = document.createElement("section");
      upgradesCol.className = "lair-panel-column";
      upgradesCol.setAttribute("aria-label", "Lair upgrades");
      const upgradesHeading = document.createElement("h3");
      upgradesHeading.className = "game-controls-heading lair-panel-column-title";
      upgradesHeading.textContent = "Upgrades";
      const upgradesList = document.createElement("div");
      upgradesList.className = "lair-panel-missions";
      fillLairUpgradesInto(upgradesList);
      upgradesCol.appendChild(upgradesHeading);
      upgradesCol.appendChild(upgradesList);

      columnsWrap.appendChild(missionsCol);
      columnsWrap.appendChild(upgradesCol);
      lairPanelEl.appendChild(columnsWrap);
      return;
    }

    const tablist = document.createElement("div");
    tablist.className = "lair-panel-tabs";
    tablist.setAttribute("role", "tablist");
    tablist.setAttribute("aria-label", "Lair sections");

    const tabDefs: { id: "missions" | "upgrades"; label: string }[] = [
      { id: "missions", label: "Missions" },
      { id: "upgrades", label: "Upgrades" },
    ];
    for (const def of tabDefs) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "lair-panel-tab";
      if (def.id === lairPanelTab) {
        tab.classList.add("lair-panel-tab--active");
      }
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", def.id === lairPanelTab ? "true" : "false");
      tab.id = `lair-panel-tab-${def.id}`;
      tab.textContent = def.label;
      tab.addEventListener("click", () => {
        if (lairPanelTab === def.id) {
          return;
        }
        lairPanelTab = def.id;
        renderLairPanel();
      });
      tablist.appendChild(tab);
    }
    lairPanelEl.appendChild(tablist);

    const list = document.createElement("div");
    list.className = "lair-panel-missions";
    list.setAttribute("role", "tabpanel");
    list.setAttribute("aria-labelledby", `lair-panel-tab-${lairPanelTab}`);

    if (lairPanelTab === "missions") {
      fillLairMissionsInto(list);
    } else {
      fillLairUpgradesInto(list);
    }
    lairPanelEl.appendChild(list);
  }

  function renderActivityPanel(): void {
    activityPanelEl.innerHTML = "";
    const log = state.activityLog;
    if (log.length === 0) {
      const empty = document.createElement("p");
      empty.className = "activity-panel-empty";
      empty.textContent = "No activity yet.";
      activityPanelEl.appendChild(empty);
      return;
    }

    function minionTemplateName(templateId: string): string {
      return content.minions.find((m) => m.id === templateId)?.name ?? templateId;
    }

    function missionName(missionTemplateId: string): string {
      return (
        content.missions.find((m) => m.id === missionTemplateId)?.name ??
        content.events.find((e) => e.id === missionTemplateId)?.name ??
        missionTemplateId
      );
    }

    function assetDisplayName(assetId: string): string {
      return content.assets.find((a) => a.id === assetId)?.name ?? assetId;
    }

    function traitDisplayName(traitId: string): string {
      return content.traits.find((t) => t.id === traitId)?.name ?? traitId;
    }

    function participantNames(instanceIds: string[]): string {
      const names = instanceIds.map((iid) => {
        const inst = state.player.minions.find((m) => m.instanceId === iid);
        if (inst) {
          return minionTemplateName(inst.templateId);
        }
        return "Unknown minion";
      });
      return names.join(", ");
    }

    function signedDelta(value: number): string {
      return value >= 0 ? `+${value}` : String(value);
    }

    function formatActivityEvent(ev: (typeof log)[number]["events"][number]): string {
      switch (ev.kind) {
        case "mission_completed": {
          const inf = signedDelta(ev.infamyDelta);
          const whereLabel = formatMissionTargetSummary(ev.target);
          const baseline = signedDelta(ev.baselineInfamyDelta);
          const heat = signedDelta(ev.heatDelta);
          const baselineHeat = signedDelta(ev.baselineHeatDelta);
          const templateFx =
            ev.templateEffectDescriptions.length > 0
              ? ev.templateEffectDescriptions.join("; ")
              : "none";
          const outcomeLabel = ev.success ? "Success" : "Failure";
          let line = `${ev.missionName} @ ${whereLabel}: ${outcomeLabel} (roll ${ev.roll} vs ${ev.successChancePercent}%). Total infamy change ${inf}, total heat change ${heat}. Outcome: baseline infamy ${baseline}, baseline heat ${baselineHeat}. Mission effects: ${templateFx}.`;
          if (ev.dynamicTraitChanges !== undefined && ev.dynamicTraitChanges.length > 0) {
            const dynParts = ev.dynamicTraitChanges.map((c) =>
              formatDynamicTraitActivityChange(content, state.player.minions, c),
            );
            line += ` ${dynParts.join(" ")}`;
          }
          if (ev.criticalFailure && ev.criticalInjuryChancePercent !== undefined) {
            const n = ev.criticalOpposingAgentCount ?? 0;
            const injuredWho =
              ev.criticalInjuryInstanceIds !== undefined &&
              ev.criticalInjuryInstanceIds.length > 0
                ? participantNames(ev.criticalInjuryInstanceIds)
                : "none";
            line += ` Critical failure (${n} opposing agent${n === 1 ? "" : "s"}): ${ev.criticalInjuryChancePercent}% injury chance per participant; injured from critical roll: ${injuredWho}.`;
          }
          return line;
        }
        case "minion_hired":
        case "minion_rehired": {
          const n = minionTemplateName(ev.templateId);
          return `${n} joined ${state.organizationName}.`;
        }
        case "minion_fired": {
          const n = minionTemplateName(ev.templateId);
          return `${n} left ${state.organizationName}.`;
        }
        case "mission_started": {
          const m = missionName(ev.missionTemplateId);
          const place = formatMissionTargetSummary(ev.target);
          const who = participantNames(ev.participantInstanceIds);
          return `${m} started at ${place} (${who}).`;
        }
        case "mission_cancelled": {
          const m = missionName(ev.missionTemplateId);
          const place = formatMissionTargetSummary(ev.target);
          return `${m} cancelled at ${place}.`;
        }
        case "mission_aborted": {
          const m = missionName(ev.missionTemplateId);
          const place = formatMissionTargetSummary(ev.target);
          const why =
            ev.reason === "missing_template"
              ? "its mission template is no longer in the catalog"
              : "its roster was invalid at resolve time";
          return `${m} at ${place} could not resolve (${why}); committed assets refunded.`;
        }
        case "asset_gained": {
          const a = assetDisplayName(ev.assetId);
          return `${state.organizationName} gained ${a} ×${ev.quantity}.`;
        }
        case "asset_lost": {
          const a = assetDisplayName(ev.assetId);
          return `${state.organizationName} lost ${a} ×${ev.quantity}.`;
        }
        case "minion_leveled_up": {
          const n = minionTemplateName(ev.templateId);
          if (ev.traitId) {
            const t = traitDisplayName(ev.traitId);
            return `${n} reached level ${ev.newLevel} (unlocked ${t}).`;
          }
          return `${n} reached level ${ev.newLevel}.`;
        }
        case "event_rotated_in": {
          const n = missionName(ev.eventTemplateId);
          const t = ev.lifetimeTurns;
          return `Event "${n}" — ${t} ${t === 1 ? "turn" : "turns"} to act.`;
        }
        case "event_expired": {
          const n = missionName(ev.eventTemplateId);
          if (ev.effectDescriptions.length === 0) {
            return `Event "${n}" expired unclaimed.`;
          }
          return `Event "${n}" expired — ${ev.effectDescriptions.join("; ")}.`;
        }
        case "run_ended": {
          const ending = ev.ending;
          if (ending.kind === "victory") {
            const planName =
              content.omegaPlans.find((pl) => pl.id === ending.omegaPlanId)?.name ??
              "The Omega Plan";
            return `${planName} is complete. ${state.organizationName} has won.`;
          }
          const raidName =
            content.events.find((e) => e.special === "lair_raid")?.name ?? "the raid";
          const why =
            ending.reason === "lair_raid_expired"
              ? `"${raidName}" was never answered`
              : `"${raidName}" was lost`;
          return `${state.organizationName} has fallen — ${why}.`;
        }
        default: {
          const _exhaustive: never = ev;
          return String(_exhaustive);
        }
      }
    }

    for (let i = 0; i < log.length; i += 1) {
      const entry = log[i]!;
      const section = document.createElement("section");
      section.className = "activity-turn";
      const headingId = `activity-turn-h-${i}`;
      section.setAttribute("aria-labelledby", headingId);

      const heading = document.createElement("h3");
      heading.id = headingId;
      heading.className = "activity-turn-heading";
      heading.textContent = `Turn ${entry.turnNumber}`;
      section.appendChild(heading);

      const ul = document.createElement("ul");
      ul.className = "activity-event-list";
      const { events } = entry;
      if (events.length === 0) {
        const li = document.createElement("li");
        li.className = "activity-event";
        li.textContent = "No missions completed this resolve.";
        ul.appendChild(li);
      } else {
        for (const ev of events) {
          const li = document.createElement("li");
          li.className = "activity-event";
          li.textContent = formatActivityEvent(ev);
          ul.appendChild(li);
        }
      }
      section.appendChild(ul);
      activityPanelEl.appendChild(section);
    }
  }

  function setPlanColumnTab(which: "plan" | "activity"): void {
    const isPlan = which === "plan";
    planColumnTabPlan.classList.toggle("missions-panel-tab--active", isPlan);
    planColumnTabActivity.classList.toggle("missions-panel-tab--active", !isPlan);
    planColumnTabPlan.setAttribute("aria-selected", String(isPlan));
    planColumnTabActivity.setAttribute("aria-selected", String(!isPlan));
    planColumnPanelPlan.hidden = !isPlan;
    planColumnPanelActivity.hidden = isPlan;
  }

  function applyGameMenuVisibility(): void {
    const showDashboard = currentMenu === "dashboard";

    for (const panel of menuPanels) {
      panel.hidden = !showDashboard && panel.dataset.menuPanel !== currentMenu;
    }

    for (const column of Array.from(rightColumnsRowEl.children)) {
      if (!(column instanceof HTMLElement)) {
        continue;
      }
      const hasVisiblePanel = Array.from(column.querySelectorAll<HTMLElement>("[data-menu-panel]"))
        .some((panel) => !panel.hidden);
      column.hidden = !hasVisiblePanel;
    }

    rightColumnsRowEl.classList.toggle("game-ui-columns-row--single", !showDashboard);

    for (const button of menuButtons) {
      const menu = button.dataset.gameMenu;
      const isActive = menu === currentMenu;
      button.classList.toggle("game-panel-menu__button--active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    }
  }

  function setGameMenu(menu: GameMenu): void {
    if (currentMenu === menu) {
      return;
    }
    currentMenu = menu;
    applyGameMenuVisibility();
    renderLocationsPanel();
    renderAssetsPanel();
    renderMissionsPanel();
    renderLairPanel();
  }

  for (const button of menuButtons) {
    const menu = button.dataset.gameMenu;
    if (!isGameMenu(menu)) {
      continue;
    }
    button.addEventListener("click", () => {
      setGameMenu(menu);
    });
  }

  planColumnTabPlan.addEventListener("click", () => {
    setPlanColumnTab("plan");
  });
  planColumnTabActivity.addEventListener("click", () => {
    setPlanColumnTab("activity");
  });

  function renderStatusBar(): void {
    const p = state.player;
    /* Segment count tracks the plan's required missions, which may be fewer than the 3x3 grid. */
    const statusPlan =
      state.activeOmegaPlanId !== null
        ? getOmegaPlanById(content, state.activeOmegaPlanId)
        : undefined;
    const omegaTotal =
      statusPlan !== undefined
        ? omegaPlanRequiredMissionTotal(statusPlan)
        : OMEGA_STAGE_COUNT * OMEGA_MISSIONS_PER_STAGE;
    let omegaFilled = 0;
    for (let si = 0; si < state.activeOmegaStageIndex; si += 1) {
      omegaFilled +=
        statusPlan !== undefined
          ? omegaStageRequiredMissions(statusPlan, si)
          : OMEGA_MISSIONS_PER_STAGE;
    }
    const activeStageRequired =
      statusPlan !== undefined
        ? omegaStageRequiredMissions(statusPlan, state.activeOmegaStageIndex)
        : OMEGA_MISSIONS_PER_STAGE;
    omegaFilled = Math.min(
      omegaTotal,
      omegaFilled +
        Math.min(
          activeStageRequired,
          state.omegaStageProgress[state.activeOmegaStageIndex]!.filter(Boolean).length,
        ),
    );
    const omegaPct = omegaTotal > 0 ? Math.round((omegaFilled / omegaTotal) * 100) : 0;
    let segs = "";
    for (let i = 0; i < omegaTotal; i += 1) {
      const mod =
        i < omegaFilled
          ? " omega-progress__seg--filled"
          : i === omegaFilled
            ? " omega-progress__seg--current"
            : "";
      segs += `<span class="omega-progress__seg${mod}"></span>`;
    }
    const omegaBlock = `
      <div class="stat-block stat-block--progress">
        <span class="stat-block__icon stat-block__icon--text">&Omega;</span>
        <div class="stat-block__main">
          <span class="stat-block__label">Omega Plan</span>
          <span class="stat-block__value">${omegaPct}%</span>
          <div class="omega-progress">${segs}</div>
        </div>
      </div>`;
    statsEl.innerHTML =
      omegaBlock +
      statBlockHtml(
        ICON_BOLT,
        "Command",
        `${p.commandPoints} <small>/ ${p.maxCommandPoints}</small>`,
      ) +
      statBlockHtml(ICON_EYE, "Infamy", String(p.infamy)) +
      statBlockHtml(ICON_FLAME, "Heat", String(p.heat), "stat-block--heat") +
      statBlockHtml(
        ICON_PERSON,
        "Minions",
        `${p.minions.length} <small>/ ${p.maxRosterSize}</small>`,
      ) +
      statBlockHtml(
        ICON_CROSSHAIR,
        "Agents",
        String(totalPlayerVisibleOpposingAgents(state)),
      );
  }

  function renderThreatMeter(): void {
    threatLevelEl.innerHTML = "";
    const tiers = catalog.wantedLevels;
    const tierName = wantedTierAtIndex(catalog, state.wantedLevelTierIndex)?.name ?? "—";
    const activeCount = Math.min(tiers.length, state.wantedLevelTierIndex + 1);

    const text = document.createElement("div");
    text.className = "threat-meter__text";
    const label = document.createElement("span");
    label.className = "threat-meter__label";
    label.textContent = "Threat Level";
    const tier = document.createElement("span");
    tier.className = "threat-meter__tier";
    tier.textContent = tierName;
    text.appendChild(label);
    text.appendChild(tier);
    threatLevelEl.appendChild(text);

    const skulls = document.createElement("div");
    skulls.className = "threat-meter__skulls";
    for (let i = 0; i < tiers.length; i += 1) {
      const skull = document.createElement("span");
      skull.className = "threat-skull";
      if (i < activeCount) {
        skull.classList.add("threat-skull--active");
      }
      if (i === activeCount - 1) {
        skull.classList.add("threat-skull--latest");
      }
      skull.innerHTML = ICON_SKULL_FILLED;
      skulls.appendChild(skull);
    }
    threatLevelEl.appendChild(skulls);
  }

  function tickerItemForEvent(
    ev: GameState["activityLog"][number]["events"][number],
  ): { title: string; detail: string } | null {
    const missionNameOf = (id: string): string =>
      content.missions.find((m) => m.id === id)?.name ??
      content.events.find((e) => e.id === id)?.name ??
      id;
    const minionNameOf = (id: string): string =>
      content.minions.find((m) => m.id === id)?.name ?? id;
    const assetNameOf = (id: string): string =>
      content.assets.find((a) => a.id === id)?.name ?? id;
    switch (ev.kind) {
      case "mission_completed":
        return {
          title: ev.success ? "Mission success" : "Mission failed",
          detail: ev.missionName,
        };
      case "mission_started":
        return { title: "Operation launched", detail: missionNameOf(ev.missionTemplateId) };
      case "mission_cancelled":
        return { title: "Operation aborted", detail: missionNameOf(ev.missionTemplateId) };
      case "minion_hired":
      case "minion_rehired":
        return {
          title: "Recruitment",
          detail: `${minionNameOf(ev.templateId)} joined ${state.organizationName}`,
        };
      case "minion_fired":
        return { title: "Termination", detail: `${minionNameOf(ev.templateId)} removed` };
      case "asset_gained":
        return { title: "Asset acquired", detail: `${assetNameOf(ev.assetId)} ×${ev.quantity}` };
      case "asset_lost":
        return { title: "Asset lost", detail: `${assetNameOf(ev.assetId)} ×${ev.quantity}` };
      case "minion_leveled_up":
        return {
          title: "Power rising",
          detail: `${minionNameOf(ev.templateId)} reached level ${ev.newLevel}`,
        };
      case "event_rotated_in":
        return { title: "Global event", detail: missionNameOf(ev.eventTemplateId) };
      case "event_expired":
        return { title: "Event expired", detail: missionNameOf(ev.eventTemplateId) };
      default:
        return null;
    }
  }

  function renderGlobalTicker(): void {
    globalTickerEl.innerHTML = "";
    const items: { title: string; detail: string }[] = [];
    if (state.currentEventTemplateId !== null) {
      const et = content.events.find((e) => e.id === state.currentEventTemplateId);
      if (et) {
        const left = state.currentEventTurnsRemaining;
        items.push({
          title: et.special === "lair_raid" ? "LAIR UNDER SIEGE" : "Incoming event",
          detail:
            et.special === "lair_raid"
              ? `${et.name} — answer in ${left} ${left === 1 ? "turn" : "turns"} or the run ends`
              : `${et.name} — ${left} ${left === 1 ? "turn" : "turns"} to act`,
        });
      }
    }
    for (const entry of state.activityLog.slice(-2)) {
      for (const ev of entry.events.slice(-8)) {
        const item = tickerItemForEvent(ev);
        if (item) {
          items.push(item);
        }
      }
    }
    if (items.length === 0) {
      items.push(
        { title: "Surveillance active", detail: "No global events detected" },
        { title: "Omega directive", detail: "Advance the plan. All will kneel." },
      );
    }
    /* Track scrolls -50%; duplicate items so the loop is seamless. */
    for (const it of [...items, ...items]) {
      const wrap = document.createElement("span");
      wrap.className = "ticker-item";
      const marker = document.createElement("span");
      marker.className = "ticker-item__marker";
      marker.textContent = "◢";
      const title = document.createElement("span");
      title.className = "ticker-item__title";
      title.textContent = it.title;
      const detail = document.createElement("span");
      detail.className = "ticker-item__detail";
      detail.textContent = it.detail;
      wrap.append(marker, title, detail);
      globalTickerEl.appendChild(wrap);
    }
  }

  /* ---------------------------------------------------------------------------------------
   * End-of-turn report: one Mission Results modal per mission that finished, then the Turn
   * Summary. The turn only advances (`advanceToNextTurn`) when the summary is dismissed, so
   * the player reads the resolve in the `summary` phase rather than seeing it flash past.
   * ------------------------------------------------------------------------------------- */

  /** Open report, or null when no report is showing. */
  let turnReport: TurnReport | null = null;
  /** Step cursor: `0..missions.length - 1` are mission cards, `missions.length` is the summary. */
  let turnReportStepIndex = 0;

  function turnReportLineList(lines: readonly TurnReportLine[]): HTMLUListElement {
    const ul = document.createElement("ul");
    ul.className = "turn-report-lines";
    for (const line of lines) {
      const li = document.createElement("li");
      li.className = `turn-report-line turn-report-line--${line.tone}`;
      li.textContent = line.text;
      ul.appendChild(li);
    }
    return ul;
  }

  function turnReportBlock(title: string, lines: readonly TurnReportLine[]): HTMLElement {
    const block = document.createElement("section");
    block.className = "turn-report-block";
    const heading = document.createElement("h3");
    heading.className = "turn-report-block__title";
    heading.textContent = title;
    block.appendChild(heading);
    block.appendChild(turnReportLineList(lines));
    return block;
  }

  function missionResultSourceLabel(m: MissionResultReport): string {
    if (m.missionSource === "lair") {
      return "Lair";
    }
    if (m.missionSource === "event") {
      return "Event";
    }
    if (m.missionSource === "omega") {
      return `Omega (phase ${(m.omegaStageIndex ?? 0) + 1} · slot ${(m.omegaSlotIndex ?? 0) + 1})`;
    }
    return "—";
  }

  function appendMissionResultParticipants(host: HTMLElement, instanceIds: string[]): void {
    const wrap = document.createElement("div");
    wrap.className = "turn-report-crew";
    if (instanceIds.length === 0) {
      const none = document.createElement("p");
      none.className = "turn-report-crew__empty";
      none.textContent = "No minions were assigned.";
      wrap.appendChild(none);
      host.appendChild(wrap);
      return;
    }
    for (const iid of instanceIds) {
      const inst = state.player.minions.find((m) => m.instanceId === iid);
      const tpl = inst ? content.minions.find((t) => t.id === inst.templateId) : undefined;
      const chip = document.createElement("div");
      chip.className = "turn-report-crew__chip";
      chip.appendChild(createCardArtImg(resolveMinionCardArt(tpl), "turn-report-crew__art"));
      const text = document.createElement("div");
      text.className = "turn-report-crew__text";
      const name = document.createElement("span");
      name.className = "turn-report-crew__name";
      name.textContent = tpl?.name ?? inst?.templateId ?? "Missing minion";
      const meta = document.createElement("span");
      meta.className = "turn-report-crew__meta";
      meta.textContent = inst !== undefined ? `Level ${inst.currentLevel}` : "No longer on roster";
      text.append(name, meta);
      chip.appendChild(text);
      wrap.appendChild(chip);
    }
    host.appendChild(wrap);
  }

  function renderMissionResultStep(m: MissionResultReport, total: number): void {
    const mission = findMissionOrEventTemplate(m.missionTemplateId);

    turnReportKicker.textContent = `Mission Result ${turnReportStepIndex + 1} of ${total}`;
    turnReportTitle.textContent = m.missionName;
    turnReportVerdict.className = `turn-report-verdict turn-report-verdict--${m.outcome}`;
    turnReportVerdict.textContent =
      m.outcome === "success" ? "Success" : m.outcome === "failure" ? "Failure" : "Aborted";

    const hero = document.createElement("div");
    hero.className = "turn-report-hero";
    hero.appendChild(createCardArtImg(resolveMissionCardArt(mission), "turn-report-hero__art"));
    const heroText = document.createElement("div");
    heroText.className = "turn-report-hero__text";
    if (mission?.description) {
      const desc = document.createElement("p");
      desc.className = "turn-report-description";
      desc.textContent = mission.description;
      heroText.appendChild(desc);
    }
    const dl = document.createElement("dl");
    dl.className = "asset-card-stats turn-report-stats";
    const rows: Array<{ label: string; value: string }> = [
      { label: "Source", value: missionResultSourceLabel(m) },
      { label: "Target", value: formatMissionTargetSummary(m.target) },
    ];
    if (m.roll !== null && m.successChancePercent !== null) {
      rows.push({ label: "Roll", value: `${m.roll} vs ${m.successChancePercent}% chance` });
    }
    if (mission !== undefined) {
      rows.push({
        label: "Duration",
        value: `${mission.durationTurns} turn${mission.durationTurns === 1 ? "" : "s"}`,
      });
      if (mission.requiredAssetIds.length > 0) {
        rows.push({
          label: "Committed assets",
          value: plannedAssetSlotsDisplay(content, mission.requiredAssetIds, m.plannedAssetIds),
        });
      }
    }
    appendMinionStatRows(dl, rows);
    heroText.appendChild(dl);
    hero.appendChild(heroText);
    turnReportBody.appendChild(hero);

    const crewBlock = document.createElement("section");
    crewBlock.className = "turn-report-block";
    const crewHeading = document.createElement("h3");
    crewHeading.className = "turn-report-block__title";
    crewHeading.textContent = "Participating minions";
    crewBlock.appendChild(crewHeading);
    appendMissionResultParticipants(crewBlock, m.participantInstanceIds);
    turnReportBody.appendChild(crewBlock);

    if (m.outcomeGroups.length === 0) {
      turnReportBody.appendChild(
        turnReportBlock(m.outcome === "success" ? "Success effects" : "Failure effects", [
          { text: "Nothing else changed.", tone: "neutral" },
        ]),
      );
      return;
    }
    for (const grp of m.outcomeGroups) {
      turnReportBody.appendChild(turnReportBlock(grp.title, grp.lines));
    }
  }

  function renderTurnSummaryStep(report: TurnReport): void {
    const wins = report.missions.filter((m) => m.outcome === "success").length;
    const losses = report.missions.length - wins;

    turnReportKicker.textContent = "End of turn";
    turnReportTitle.textContent = `Turn ${report.turnNumber} Summary`;
    turnReportVerdict.className = "turn-report-verdict turn-report-verdict--tally";
    turnReportVerdict.textContent =
      report.missions.length === 0 ? "No missions resolved" : `${wins} won · ${losses} lost`;

    for (const sec of report.summary) {
      turnReportBody.appendChild(turnReportBlock(sec.title, sec.lines));
    }
  }

  function renderTurnReportSteps(report: TurnReport): void {
    turnReportStepsEl.innerHTML = "";
    const total = report.missions.length + 1;
    if (total < 2) {
      return;
    }
    for (let i = 0; i < total; i += 1) {
      const dot = document.createElement("span");
      dot.className = "turn-report-step";
      if (i < turnReportStepIndex) {
        dot.classList.add("turn-report-step--done");
      } else if (i === turnReportStepIndex) {
        dot.classList.add("turn-report-step--current");
      }
      turnReportStepsEl.appendChild(dot);
    }
  }

  function renderTurnReport(): void {
    const report = turnReport;
    if (report === null) {
      return;
    }
    turnReportBody.innerHTML = "";
    turnReportBody.scrollTop = 0;
    const mission = report.missions[turnReportStepIndex];
    if (mission !== undefined) {
      renderMissionResultStep(mission, report.missions.length);
    } else {
      renderTurnSummaryStep(report);
    }
    renderTurnReportSteps(report);

    /* "Skip all" belongs to the mission sequence; the summary is the last step either way. */
    btnTurnReportSkip.hidden = mission === undefined;
    btnTurnReportContinue.textContent =
      mission !== undefined ? "Continue" : `Begin turn ${report.turnNumber + 1}`;
    btnTurnReportContinue.focus();
  }

  function openTurnReport(report: TurnReport): void {
    turnReport = report;
    turnReportStepIndex = 0;
    turnReportOverlay.hidden = false;
    turnReportOverlay.setAttribute("aria-hidden", "false");
    renderTurnReport();
  }

  /** Dismisses the report and advances the turn — the only way out of the `summary` phase. */
  function closeTurnReport(): void {
    turnReport = null;
    turnReportStepIndex = 0;
    turnReportOverlay.hidden = true;
    turnReportOverlay.setAttribute("aria-hidden", "true");
    turnReportBody.innerHTML = "";
    dispatch((s) => advanceToNextTurn(s));
    btnExec.focus();
  }

  function advanceTurnReport(): void {
    const report = turnReport;
    if (report === null) {
      return;
    }
    if (turnReportStepIndex >= report.missions.length) {
      closeTurnReport();
      return;
    }
    turnReportStepIndex += 1;
    renderTurnReport();
  }

  function skipTurnReportMissions(): void {
    const report = turnReport;
    if (report === null) {
      return;
    }
    turnReportStepIndex = report.missions.length;
    renderTurnReport();
  }

  /* ---------------------------------------------------------------------------------------
   * Run end: two modals — the outcome (Victory or Game Over), then the Run Summary — that
   * stand in for the whole end-of-turn report once the run finishes, won or lost. The mission
   * recap and Turn Summary are skipped entirely; there is no next turn to brief for.
   * ------------------------------------------------------------------------------------- */

  /** Open report, or null when no run-end report is showing. */
  let runEndReport: RunEndReport | null = null;
  /** Step cursor: 0 = the outcome, 1 = the run summary. */
  let runEndStepIndex = 0;

  function renderRunEndSteps(): void {
    runEndStepsEl.innerHTML = "";
    for (let i = 0; i < 2; i += 1) {
      const dot = document.createElement("span");
      dot.className = "turn-report-step";
      if (i < runEndStepIndex) {
        dot.classList.add("turn-report-step--done");
      } else if (i === runEndStepIndex) {
        dot.classList.add("turn-report-step--current");
      }
      runEndStepsEl.appendChild(dot);
    }
  }

  function renderRunEnd(): void {
    const report = runEndReport;
    if (report === null) {
      return;
    }
    const won = report.ending.kind === "victory";
    runEndBody.innerHTML = "";
    runEndBody.scrollTop = 0;
    runEndVerdict.className = `turn-report-verdict turn-report-verdict--${won ? "success" : "failure"}`;
    runEndVerdict.textContent = report.verdict;

    if (runEndStepIndex === 0) {
      runEndKicker.textContent = won
        ? `Turn ${report.turnNumber} · Omega Plan complete`
        : `Turn ${report.turnNumber} · run ended`;
      runEndTitle.textContent = report.title;
      for (const para of report.narrative) {
        const p = document.createElement("p");
        p.className = "run-end-narrative";
        p.textContent = para;
        runEndBody.appendChild(p);
      }
      btnRunEndContinue.textContent = "View run summary";
    } else {
      runEndKicker.textContent = report.organizationName;
      runEndTitle.textContent = "Run Summary";
      for (const sec of report.summary) {
        runEndBody.appendChild(turnReportBlock(sec.title, sec.lines));
      }
      btnRunEndContinue.textContent = "Return to main menu";
    }
    renderRunEndSteps();
    btnRunEndContinue.focus();
  }

  function openRunEnd(report: RunEndReport): void {
    runEndReport = report;
    runEndStepIndex = 0;
    runEndOverlay.classList.toggle("run-end-overlay--victory", report.ending.kind === "victory");
    runEndOverlay.hidden = false;
    runEndOverlay.setAttribute("aria-hidden", "false");
    renderRunEnd();
  }

  /**
   * Rolls a fresh run from the title screen's omega plan / lair picks (each `null` there is
   * rolled at random) and drops any plan staged by the run that just ended.
   */
  function startRun(): void {
    clearAllAssignSlots();
    state = createInitialGameState(content, undefined, runSetup.read());
    refresh();
  }

  /**
   * Last step dismissed: the finished run is thrown away and a fresh one is rolled, so the
   * title screen's Play starts over rather than dropping the player back into a dead state.
   */
  function closeRunEnd(): void {
    runEndReport = null;
    runEndStepIndex = 0;
    runEndOverlay.hidden = true;
    runEndOverlay.setAttribute("aria-hidden", "true");
    runEndBody.innerHTML = "";
    startRun();
    nav.returnToMainMenu();
  }

  function advanceRunEnd(): void {
    if (runEndReport === null) {
      return;
    }
    if (runEndStepIndex >= 1) {
      closeRunEnd();
      return;
    }
    runEndStepIndex += 1;
    renderRunEnd();
  }

  function refresh(): void {
    reconcileStagedEventMissionWithState();
    const p = state.player;
    reconcileAssignSlots();
    syncAssignAssetSlotArrayWithMission();

    organizationNameEl.textContent = state.organizationName;
    playerNameEl.textContent = state.playerName;
    playerProfilePicEl.src = state.playerProfilePic;
    playerProfilePicEl.alt = `${state.playerName} profile`;
    renderStatusBar();
    renderThreatMeter();
    renderGlobalTicker();
    hudShort.textContent = `Turn ${state.turnNumber} · ${state.phase} phase`;

    const mainOnly = state.phase === "main";
    btnExec.hidden = !mainOnly;
    btnExec.disabled = !mainOnly;

    ensureAssignPickSlotsWired();
    renderMinionsPanel();
    renderAssignPickSlots();
    renderAssignMinionSlots();
    renderOmegaPlanPanel();
    renderLocationsPanel();
    renderAssetsPanel();
    renderMissionsPanel();
    renderEventsPanel();
    renderLairPanel();
    renderActivityPanel();
    applyGameMenuVisibility();

    const rerollCost = content.balance.rerollHireOffersCp;
    const canRerollOffers = mainOnly && p.commandPoints >= rerollCost;
    btnRerollHire.disabled = !canRerollOffers;
    if (!mainOnly) {
      btnRerollHire.title = "Only during Main Phase";
    } else if (p.commandPoints < rerollCost) {
      btnRerollHire.title = `Need ${rerollCost} CP (${p.commandPoints} available)`;
    } else {
      btnRerollHire.title = `Spend ${rerollCost} CP to draw a new hire pool`;
    }
  }

  /**
   * Run a state transition and, on success, swap in the new state and re-render.
   * Failures are logged and surfaced via `onError` (e.g. a button tooltip). This is the
   * single seam every UI action goes through, so panels never own the state swap.
   */
  function dispatch(
    action: (s: GameState) => Result<GameState, GameError>,
    opts?: { onError?: (err: GameError) => void; onApplied?: () => void },
  ): boolean {
    const result = action(state);
    if (!result.ok) {
      console.warn("[Mastermind] action failed:", result.error);
      opts?.onError?.(result.error);
      return false;
    }
    state = result.value;
    opts?.onApplied?.();
    refresh();
    return true;
  }

  btnAssign.addEventListener("click", () => {
    if (state.phase !== "main") {
      return;
    }
    if (!assignMissionTemplateId || assignMissionSource === null) {
      return;
    }
    const mt = findMissionOrEventTemplate(assignMissionTemplateId);
    if (!mt) {
      btnAssign.title = "Unknown mission — pick another from Omega, Lair, or Events.";
      return;
    }
    let targetPayload: MissionTarget;
    if (mt.targetType === "none") {
      targetPayload = { kind: "none" };
    } else {
      if (!assignTarget) {
        return;
      }
      targetPayload = assignTarget;
    }
    syncAssignAssetSlotArrayWithMission();
    const checked = getAssignParticipantIds();
    const plannedAssetIds = Array.from(
      { length: mt.requiredAssetIds.length },
      (_, i) => assignAssetSlotAssetIds[i] ?? null,
    );
    const missionTemplateId = assignMissionTemplateId;
    const missionSource = assignMissionSource;
    dispatch(
      (s) =>
        assignMission(
          s,
          content,
          crypto.randomUUID(),
          missionTemplateId,
          targetPayload,
          missionSource,
          missionSource === "omega" ? assignOmegaStageIndex : null,
          missionSource === "omega" ? assignOmegaSlotIndex : null,
          checked,
          plannedAssetIds,
        ),
      {
        onApplied: clearAllAssignSlots,
        onError: (err) => {
          btnAssign.title = formatAssignMissionError(err);
        },
      },
    );
  });

  btnExec.addEventListener("click", () => {
    if (state.phase !== "main") {
      return;
    }
    /* The resolve stops in the "summary" phase: the end-of-turn report is shown from here,
     * and dismissing its Turn Summary is what calls `advanceToNextTurn` (closeTurnReport). */
    const before = state;
    if (!dispatch((s) => executePlan(s, content, rng))) {
      return;
    }
    const ending = state.runEnding;
    if (ending !== null) {
      /* The run is over, won or lost: no mission recap, no Turn Summary — straight to the
       * outcome modal. */
      openRunEnd(buildRunEndReport(state, content, ending));
      return;
    }
    openTurnReport(buildTurnReport(before, state, content));
  });

  btnTurnReportContinue.addEventListener("click", () => {
    advanceTurnReport();
  });

  btnRunEndContinue.addEventListener("click", () => {
    advanceRunEnd();
  });

  btnTurnReportSkip.addEventListener("click", () => {
    skipTurnReportMissions();
  });

  btnRerollHire.addEventListener("click", () => {
    dispatch((s) => rerollHireOffers(s, content, rng));
  });

  minionsRosterEl.addEventListener("dragstart", (e) => {
    const t = e.target as HTMLElement | null;
    const card = t?.closest("[data-assign-instance-id]") as HTMLElement | null;
    if (!card?.dataset.assignInstanceId) {
      return;
    }
    if (!card.draggable) {
      e.preventDefault();
      return;
    }
    const id = card.dataset.assignInstanceId;
    e.dataTransfer?.setData("text/plain", minionDragJson(id));
    e.dataTransfer!.effectAllowed = "copy";
    dndDragSource = { kind: "roster" };
  });

  minionsRosterEl.addEventListener("dragend", () => {
    if (dndDragSource?.kind === "roster") {
      dndDragSource = null;
    }
  });

  document.addEventListener("dragend", (e: DragEvent) => {
    const src = dndDragSource;
    dndDragSource = null;
    if (src?.kind === "slot") {
      if (e.dataTransfer?.dropEffect === "none") {
        clearAssignSlot(src.slotIndex);
        renderAssignMinionSlots();
        onAssignSlotsChanged();
      }
      return;
    }
    if (src?.kind === "mission-slot") {
      if (e.dataTransfer?.dropEffect === "none") {
        clearAssignMissionSlotOnly();
        renderAssignPickSlots();
        renderAssignMinionSlots();
        onAssignSlotsChanged();
      }
      return;
    }
    if (src?.kind === "assign-target") {
      if (e.dataTransfer?.dropEffect === "none") {
        assignTarget = null;
        renderAssignPickSlots();
        renderAssignMinionSlots();
        onAssignSlotsChanged();
      }
    }
  });

  ensureAssignPickSlotsWired();
  renderAssignPickSlots();
  refresh();

  return { startRun };
}

const runSetup = initRunSetup(catalog);
/* The controller needs `nav` and `nav` needs the controller's `startRun`, so Play routes
 * through this ref, filled in as soon as the controller exists. */
let startRunFromMenu: () => void = () => {};
const navigation = initNavigation({
  setGameLoopRunning(running: boolean): void {
    if (running) {
      startGameLoop();
    } else {
      stopGameLoop();
    }
  },
  startRun(): void {
    startRunFromMenu();
  },
});

startRunFromMenu = initGameController(catalog, navigation, runSetup).startRun;

initStageScale();
