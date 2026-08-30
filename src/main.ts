import { resizeCanvasToDisplaySize, setupCanvas } from "./canvas/setup";
import {
  advanceToNextTurn,
  assignMission,
  busyInstanceIds,
  cancelMission,
  createInitialGameState,
  executeAgentPhase,
  executePlan,
  fireMinion,
  getMissionTargetLocationId,
  hireMinion,
  missionSuccessOptionsForTarget,
  missionTargetMatchesTemplate,
  previewHireDynamicTraits,
  previewRehireDynamicTraits,
  rehireMinion,
  rerollHireOffers,
  type ActiveMission,
  type ActivityEvent,
  type GameError,
  type GameState,
  type Result,
} from "./game/gameState";
import type {
  Asset,
  DynamicTrait,
  LocationAssetSlot,
  LocationType,
  MinionInstance,
  MissionEffect,
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
  describeSupportAssetAbility,
  isSupportAsset,
  mergedRequiredTraitIdsSorted,
  missionAllowsTargetLocation,
  unionParticipantTraitIds,
  missionTargetTypeTargetsLocation,
  supportAbilitiesForAssetIds,
  type MissionTargetLocationFilters,
  type SuccessChanceBreakdown,
} from "./game/mission";
import {
  dynamicTraitDisplayLabel,
  dynamicTraitSuccessModifierBreakdownFromFullRoster,
  dynamicTraitSuccessModifierFromFullRoster,
  type DynamicTraitSuccessBreakdownEntry,
} from "./game/dynamicTrait";
import { formatRelationshipChange, formatStandingChange } from "./game/affinity";
import {
  describeMissionEffect,
  orderedMissionEffects,
} from "./game/missionEffects";
import {
  buildRunEndReport,
  buildTurnReport,
  describeAgentAbilityUse,
  type RunEndReport,
  type MissionResultReport,
  type TurnReport,
  type TurnReportLine,
} from "./game/turnReport";
import { loadContent } from "./game/loadContent";
import {
  getLocationById,
  getMapById,
  locationTemplatesForOmegaPlan,
  maxSecurityLevelForLocation,
  securityLevelForLocation,
} from "./game/locationCatalog";
import { challengeTraitIdsForAgents, getAgentTemplateById } from "./game/agent";
import { agentAbilityDef, agentAbilityName } from "./game/agentAbility";
import {
  assetSlotKnowledge,
  effectiveVisibilityOfSlot,
  intelLevelAtLocation,
  isOpposingAgentMoveVisibleToPlayer,
  playerVisibleOpposingAgentsAtLocation,
  totalPlayerVisibleOpposingAgents,
} from "./game/intel";
import {
  currentLairUpgradeLevel,
  getLairById,
  lairUpgradeLevelMinInfamy,
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
import { initNavigation, type NavigationApi } from "./navigation";
import { initStageScale } from "./ui/stageScale";
import { initRunSetup, type RunSetupApi } from "./ui/runSetup";
import { initGlobalTooltips } from "./ui/tooltip";
import {
  appendCardArtShell,
  createCardArtImg,
  resolveAgentCardArt,
  resolveAssetCardArt,
  resolveLairCardArt,
  resolveLocationCardArt,
  resolveMissionCardArt,
  resolveMinionCardArt,
  resolveOmegaPlanCardArt,
} from "./ui/cardArt";

/** What each intel step unlocks at a site (hover text on the location card's Intel Level label). */
const INTEL_LEVEL_TOOLTIP_LINES: readonly string[] = [
  "0 — assets and agents here stay secret unless uncovered another way",
  "1 — every asset slot is listed (contents still unknown)",
  "2 — asset contents are identified and count as revealed for missions",
  "3 — opposing agents here are visible, including any that arrive later",
];

/** Hover text for the location card's Security Level label. */
const SECURITY_LEVEL_TOOLTIP_LINES: readonly string[] = [
  "Defensive alert level at this site (0 up to the location level).",
  "Each point reveals 1 security trait, adding it to the required traits for missions here.",
  "Increases by +1 when a mission targeting this site completes.",
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
] as const;

type GameMenu = (typeof GAME_MENU_VALUES)[number];

function isGameMenu(value: string | undefined): value is GameMenu {
  return value !== undefined && (GAME_MENU_VALUES as readonly string[]).includes(value);
}

type LairPanelTab = "missions" | "active" | "assets";

/**
 * Lair sections, shown as tabs on the dashboard and as columns in the fullscreen Lair menu.
 * Lair upgrades deliberately have no tab: they are offered under Missions → Available, which is
 * also where the omega, lair and event offers live, so the Lair panel stays about the base.
 */
const LAIR_PANEL_TABS: readonly { id: LairPanelTab; label: string }[] = [
  { id: "missions", label: "Missions" },
  { id: "active", label: "Active Missions" },
  { id: "assets", label: "Assets" },
];

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

/* Pill SVG icon paths */
const TRAIT_ICON_SVG_PATHS =
  '<path d="M12 2H2v10l9.29 9.29a2.4 2.4 0 0 0 3.42 0l6.58-6.58a2.4 2.4 0 0 0 0-3.42L12 2Z"/><circle cx="7" cy="7" r="1.5"/>';
const ASSET_ICON_SVG_PATHS =
  '<path d="M6.5 3.5h11l4 5.5L12 21 2.5 9l4-5.5Z"/><path d="M2.5 9h19"/>';
const UNKNOWN_ICON_SVG_PATHS =
  '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>';
const SECURITY_ICON_SVG_PATHS =
  '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>';

/* Minion, Mission & Location card stat icons */
const MINION_STAT_ICON_CP =
  '<svg viewBox="0 0 24 24" class="minions-card-badge__icon" aria-hidden="true" focusable="false"><path d="M13 2 4.5 13.5H10L9 22l8.5-11.5H12L13 2Z" fill="currentColor"/></svg>';
const MINION_STAT_ICON_LEVEL =
  '<svg viewBox="0 0 24 24" class="minions-card-badge__icon" aria-hidden="true" focusable="false"><polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/></svg>';
const MINION_STAT_ICON_XP =
  '<svg viewBox="0 0 24 24" class="minions-card-badge__icon" aria-hidden="true" focusable="false"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor"/></svg>';
const MISSION_STAT_ICON_TARGET =
  '<svg viewBox="0 0 24 24" class="minions-card-badge__icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="7"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>';
const MISSION_STAT_ICON_DURATION =
  '<svg viewBox="0 0 24 24" class="minions-card-badge__icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg>';
const LOCATION_STAT_ICON_TYPE =
  '<svg viewBox="0 0 24 24" class="minions-card-badge__icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>';
const LOCATION_STAT_ICON_SECURITY =
  '<svg viewBox="0 0 24 24" class="minions-card-badge__icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>';
const LOCATION_STAT_ICON_INTEL =
  '<svg viewBox="0 0 24 24" class="minions-card-badge__icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';

function createSvgPillIcon(pathsHtml: string): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "minions-trait-pill__icon");
  svg.innerHTML = pathsHtml;
  return svg;
}

function createTraitIconEl(): SVGElement {
  return createSvgPillIcon(TRAIT_ICON_SVG_PATHS);
}

function createSecurityIconEl(): SVGElement {
  return createSvgPillIcon(SECURITY_ICON_SVG_PATHS);
}

function createAssetIconEl(): SVGElement {
  return createSvgPillIcon(ASSET_ICON_SVG_PATHS);
}

function createUnknownIntelIconEl(): SVGElement {
  return createSvgPillIcon(UNKNOWN_ICON_SVG_PATHS);
}

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

function formatStaticTraitTooltip(trait: Trait | undefined, traitId: string): string {
  if (!trait) {
    return traitId;
  }
  if (trait.type === "status_positive") {
    return `${trait.name} (Status)\n+10% mission success chance`;
  }
  if (trait.type === "status_negative") {
    return `${trait.name} (Status)\n−20% mission success chance`;
  }
  if (trait.type === "primary") {
    return `${trait.name} (Primary Trait)\nFulfills mission operational requirements`;
  }
  if (trait.type === "secondary") {
    return `${trait.name} (Secondary Trait)\nFulfills mission tactical requirements`;
  }
  return trait.name;
}

function formatDynamicTraitTooltip(
  catalog: ReturnType<typeof loadContent>,
  roster: readonly MinionInstance[],
  dt: DynamicTrait,
): string {
  const label = dynamicTraitDisplayLabel(catalog, roster, dt);
  switch (dt.kind) {
    case "friend":
      return `${label}\nRelationship: +5% mission success when paired`;
    case "ally":
      return `${label}\nRelationship: +10% mission success when paired`;
    case "rival":
      return `${label}\nRelationship: −5% mission success when paired`;
    case "hatred":
      return `${label}\nRelationship: −10% mission success when paired`;
    case "hero":
      return `${label}\nStanding: +5% mission success at this location`;
    case "wanted":
      return `${label}\nStanding: −5% mission success at this location`;
  }
}

function createTraitPillEl(
  catalog: ReturnType<typeof loadContent>,
  traitId: string,
  rosterTraitIds?: ReadonlySet<string>,
  iconKind: "trait" | "security" = "trait",
): HTMLElement {
  const trait = catalog.traits.find((t) => t.id === traitId);
  const span = document.createElement("span");
  span.className = "minions-trait-pill minions-trait-pill--trait";
  if (iconKind === "security") {
    span.classList.add("minions-trait-pill--security");
  }
  if (trait?.type === "status_negative") {
    span.classList.add("minions-trait-pill--status-negative");
  } else if (trait?.type === "status_positive") {
    span.classList.add("minions-trait-pill--status-positive");
  }
  if (rosterTraitIds !== undefined) {
    span.classList.add(
      rosterTraitIds.has(traitId)
        ? "minions-trait-pill--req-have"
        : "minions-trait-pill--req-missing",
    );
  }
  span.tabIndex = 0;
  span.title = formatStaticTraitTooltip(trait, traitId);
  span.appendChild(iconKind === "security" ? createSecurityIconEl() : createTraitIconEl());
  const text = document.createElement("span");
  text.className = "minions-trait-pill__label";
  text.textContent = trait?.name ?? traitId;
  span.appendChild(text);
  return span;
}

function appendMinionTraits(
  container: HTMLElement,
  catalog: ReturnType<typeof loadContent>,
  traitIds: string[],
  dynamic?: { roster: MinionInstance[]; traits: readonly DynamicTrait[] },
): void {
  const rosterTraits = dynamic?.traits ?? [];
  const roster = dynamic?.roster ?? [];
  if (traitIds.length === 0 && rosterTraits.length === 0) {
    return;
  }

  for (let i = 0; i < traitIds.length; i += 1) {
    const tid = traitIds[i]!;
    container.appendChild(createTraitPillEl(catalog, tid));
  }
  for (let j = 0; j < rosterTraits.length; j += 1) {
    const dtrait = rosterTraits[j]!;
    const span = document.createElement("span");
    span.className = "minions-trait-pill minions-trait-pill--trait";
    span.tabIndex = 0;
    span.title = formatDynamicTraitTooltip(catalog, roster, dtrait);
    span.appendChild(createTraitIconEl());
    const text = document.createElement("span");
    text.className = "minions-trait-pill__label";
    text.textContent = dynamicTraitDisplayLabel(catalog, roster, dtrait);
    span.appendChild(text);
    container.appendChild(span);
  }
}

function createMinionsCardStatsRow(stats: {
  cpCost: string | number;
  level: string | number;
  xp: string | number;
}): HTMLElement {
  const row = document.createElement("div");
  row.className = "minions-card-stats-row";

  const cpBadge = document.createElement("div");
  cpBadge.className = "minions-card-badge minions-card-badge--cp";
  cpBadge.title = `CP Cost: ${stats.cpCost}`;
  cpBadge.tabIndex = 0;
  cpBadge.setAttribute("aria-label", `CP Cost: ${stats.cpCost}`);
  cpBadge.innerHTML = `${MINION_STAT_ICON_CP}<span class="minions-card-badge__value">${stats.cpCost}</span>`;

  const levelBadge = document.createElement("div");
  levelBadge.className = "minions-card-badge minions-card-badge--level";
  levelBadge.title = `Level: ${stats.level}`;
  levelBadge.tabIndex = 0;
  levelBadge.setAttribute("aria-label", `Level: ${stats.level}`);
  levelBadge.innerHTML = `${MINION_STAT_ICON_LEVEL}<span class="minions-card-badge__value">${stats.level}</span>`;

  const xpBadge = document.createElement("div");
  xpBadge.className = "minions-card-badge minions-card-badge--xp";
  xpBadge.title = `XP: ${stats.xp}`;
  xpBadge.tabIndex = 0;
  xpBadge.setAttribute("aria-label", `XP: ${stats.xp}`);
  xpBadge.innerHTML = `${MINION_STAT_ICON_XP}<span class="minions-card-badge__value">${stats.xp}</span>`;

  row.appendChild(cpBadge);
  row.appendChild(levelBadge);
  row.appendChild(xpBadge);
  return row;
}

function createMissionCardStatsRow(stats: {
  target: string;
  cpCost: string | number;
  duration: string | number;
}): HTMLElement {
  const row = document.createElement("div");
  row.className = "minions-card-stats-row";

  const targetBadge = document.createElement("div");
  targetBadge.className = "minions-card-badge minions-card-badge--target";
  targetBadge.title = `Target: ${stats.target}`;
  targetBadge.tabIndex = 0;
  targetBadge.setAttribute("aria-label", `Target: ${stats.target}`);
  targetBadge.innerHTML = `${MISSION_STAT_ICON_TARGET}<span class="minions-card-badge__value">${stats.target}</span>`;

  const cpBadge = document.createElement("div");
  cpBadge.className = "minions-card-badge minions-card-badge--cp";
  cpBadge.title = `Cost: ${stats.cpCost}`;
  cpBadge.tabIndex = 0;
  cpBadge.setAttribute("aria-label", `Cost: ${stats.cpCost}`);
  cpBadge.innerHTML = `${MINION_STAT_ICON_CP}<span class="minions-card-badge__value">${stats.cpCost}</span>`;

  const durationBadge = document.createElement("div");
  durationBadge.className = "minions-card-badge minions-card-badge--duration";
  durationBadge.title = `Duration: ${stats.duration} turn${stats.duration === 1 || stats.duration === "1" ? "" : "s"}`;
  durationBadge.tabIndex = 0;
  durationBadge.setAttribute("aria-label", `Duration: ${stats.duration}`);
  durationBadge.innerHTML = `${MISSION_STAT_ICON_DURATION}<span class="minions-card-badge__value">${stats.duration}</span>`;

  row.appendChild(targetBadge);
  row.appendChild(cpBadge);
  row.appendChild(durationBadge);
  return row;
}

function createLocationCardStatsRow(stats: {
  type: string;
  level: string | number;
  securityLevel: string | number;
  intelLevel: string | number;
}): HTMLElement {
  const row = document.createElement("div");
  row.className = "minions-card-stats-row";

  const typeBadge = document.createElement("div");
  typeBadge.className = "minions-card-badge minions-card-badge--type";
  typeBadge.title = `Location Type: ${stats.type}`;
  typeBadge.tabIndex = 0;
  typeBadge.setAttribute("aria-label", `Location Type: ${stats.type}`);
  typeBadge.innerHTML = `${LOCATION_STAT_ICON_TYPE}<span class="minions-card-badge__value">${stats.type}</span>`;

  const levelBadge = document.createElement("div");
  levelBadge.className = "minions-card-badge minions-card-badge--level";
  levelBadge.title = `Location Level: ${stats.level}`;
  levelBadge.tabIndex = 0;
  levelBadge.setAttribute("aria-label", `Location Level: ${stats.level}`);
  levelBadge.innerHTML = `${MINION_STAT_ICON_LEVEL}<span class="minions-card-badge__value">${stats.level}</span>`;

  const securityBadge = document.createElement("div");
  securityBadge.className = "minions-card-badge minions-card-badge--security";
  securityBadge.title = `Security Level: ${stats.securityLevel}\n${SECURITY_LEVEL_TOOLTIP_LINES.join("\n")}`;
  securityBadge.tabIndex = 0;
  securityBadge.setAttribute("aria-label", `Security Level: ${stats.securityLevel}`);
  securityBadge.innerHTML = `${LOCATION_STAT_ICON_SECURITY}<span class="minions-card-badge__value">${stats.securityLevel}</span>`;

  const intelBadge = document.createElement("div");
  intelBadge.className = "minions-card-badge minions-card-badge--intel";
  intelBadge.title = `Intel Level: ${stats.intelLevel}\n${INTEL_LEVEL_TOOLTIP_LINES.join("\n")}`;
  intelBadge.tabIndex = 0;
  intelBadge.setAttribute("aria-label", `Intel Level: ${stats.intelLevel}`);
  intelBadge.innerHTML = `${LOCATION_STAT_ICON_INTEL}<span class="minions-card-badge__value">${stats.intelLevel}</span>`;

  row.appendChild(typeBadge);
  row.appendChild(levelBadge);
  row.appendChild(securityBadge);
  row.appendChild(intelBadge);
  return row;
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
  span.tabIndex = 0;
  span.title = formatStaticTraitTooltip(trait, traitId);
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

function requirementsDisplayNames(
  catalog: ReturnType<typeof loadContent>,
  traitIds: string[],
  assetIds: string[],
): string {
  const parts: string[] = [];
  if (traitIds.length > 0) {
    parts.push(traitDisplayNames(catalog, traitIds));
  }
  if (assetIds.length > 0) {
    parts.push(assetDisplayNames(catalog, assetIds));
  }
  return parts.length > 0 ? parts.join(", ") : "—";
}

function formatStaticAssetTooltip(asset: Asset | undefined, assetId: string): string {
  if (!asset) {
    return assetId;
  }
  const header =
    asset.supportAbility !== undefined ? `${asset.name} (Support Asset)` : `${asset.name} (Asset)`;
  const lines: string[] = [header];
  if (asset.supportAbility !== undefined) {
    lines.push(describeSupportAssetAbility(asset.supportAbility));
  }
  if (asset.description) {
    lines.push(asset.description);
  }
  return lines.join("\n");
}

function createInlineAssetSpan(
  catalog: ReturnType<typeof loadContent>,
  assetId: string,
): HTMLElement {
  const asset = catalog.assets.find((a) => a.id === assetId);
  const span = document.createElement("span");
  span.className = "mission-card-effects__asset";
  span.tabIndex = 0;
  span.title = formatStaticAssetTooltip(asset, assetId);
  span.textContent = asset?.name ?? assetId;
  return span;
}

function createAssetPillEl(
  catalog: ReturnType<typeof loadContent>,
  assetId: string,
  hasAsset?: boolean,
): HTMLElement {
  const asset = catalog.assets.find((a) => a.id === assetId);
  const span = document.createElement("span");
  span.className = "minions-trait-pill minions-trait-pill--asset";
  if (hasAsset !== undefined) {
    span.classList.add(
      hasAsset ? "minions-trait-pill--req-have" : "minions-trait-pill--req-missing",
    );
  }
  span.tabIndex = 0;
  span.title = formatStaticAssetTooltip(asset, assetId);
  span.appendChild(createAssetIconEl());
  const text = document.createElement("span");
  text.className = "minions-trait-pill__label";
  text.textContent = asset?.name ?? assetId;
  span.appendChild(text);
  return span;
}

/**
 * Appends requirement pills (traits first, followed by asset requirements) directly to a container element.
 */
function appendRequiredMissionRequirementPills(
  container: HTMLElement,
  catalog: ReturnType<typeof loadContent>,
  traitIds: string[],
  rosterTraitIds: ReadonlySet<string>,
  assetIds: string[],
  ownedAssets: Readonly<Record<string, number>>,
): void {
  for (const tid of traitIds) {
    container.appendChild(createTraitPillEl(catalog, tid, rosterTraitIds));
  }

  const remaining = new Map<string, number>();
  for (const aid of assetIds) {
    const left = remaining.get(aid) ?? ownedAssets[aid] ?? 0;
    remaining.set(aid, left - 1);
    container.appendChild(createAssetPillEl(catalog, aid, left > 0));
  }
}

/**
 * Combined mission-card requirement pills: traits first, followed by asset requirements,
 * all on the same line with icons.
 */
function requiredMissionRequirementPillsEl(
  catalog: ReturnType<typeof loadContent>,
  traitIds: string[],
  rosterTraitIds: ReadonlySet<string>,
  assetIds: string[],
  ownedAssets: Readonly<Record<string, number>>,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "mission-req-pills";
  appendRequiredMissionRequirementPills(
    wrap,
    catalog,
    traitIds,
    rosterTraitIds,
    assetIds,
    ownedAssets,
  );
  return wrap;
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

/** `Name — what it does` per committed support asset, for a stat-row tooltip. */
function supportAssetTooltipLines(
  catalog: ReturnType<typeof loadContent>,
  supportAssetIds: readonly string[],
): string[] {
  return supportAssetIds.map((id) => {
    const a = catalog.assets.find((x) => x.id === id);
    if (a?.supportAbility === undefined) {
      return `${a?.name ?? id} — no effect`;
    }
    return `${a.name} — ${describeSupportAssetAbility(a.supportAbility)}`;
  });
}

/** Comma-joined names of the support assets a mission is carrying. */
function supportAssetsDisplay(
  catalog: ReturnType<typeof loadContent>,
  supportAssetIds: readonly string[],
): string {
  if (supportAssetIds.length === 0) {
    return "—";
  }
  return supportAssetIds
    .map((id) => catalog.assets.find((a) => a.id === id)?.name ?? id)
    .join(", ");
}

/**
 * Appends location requirement pills: site traits first (with trait icon), followed by
 * revealed security traits (with security icon), into a container element.
 */
function appendLocationRequirementPills(
  container: HTMLElement,
  catalog: ReturnType<typeof loadContent>,
  siteTraitIds: readonly string[],
  revealedSecurityTraitIds: readonly string[],
  rosterTraitIds: ReadonlySet<string>,
): void {
  for (const tid of siteTraitIds) {
    container.appendChild(createTraitPillEl(catalog, tid, rosterTraitIds, "trait"));
  }
  for (const tid of revealedSecurityTraitIds) {
    container.appendChild(createTraitPillEl(catalog, tid, rosterTraitIds, "security"));
  }
}

/**
 * Combined location-card requirement pills: site traits first (with trait icon), followed by
 * revealed security traits (with security icon), all on the same line with mission-style state styling.
 */
function createLocationRequirementPillsEl(
  catalog: ReturnType<typeof loadContent>,
  siteTraitIds: readonly string[],
  revealedSecurityTraitIds: readonly string[],
  rosterTraitIds: ReadonlySet<string>,
): HTMLElement | null {
  if (siteTraitIds.length === 0 && revealedSecurityTraitIds.length === 0) {
    return null;
  }
  const wrap = document.createElement("div");
  wrap.className = "mission-req-pills";
  appendLocationRequirementPills(
    wrap,
    catalog,
    siteTraitIds,
    revealedSecurityTraitIds,
    rosterTraitIds,
  );
  return wrap;
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

/**
 * Human-readable summary of a mission's site filters, e.g. "Military or Economic · Level 3".
 * Returns null when the mission takes any site (no filters authored).
 */
function formatTargetLocationFilters(filters: MissionTargetLocationFilters): string | null {
  const parts: string[] = [];
  const types = filters.targetLocationTypes;
  if (types !== undefined && types.length > 0) {
    parts.push(types.map((t) => LOCATION_CATEGORY_LABEL[t]).join(" or "));
  }
  const levels = filters.targetLocationLevels;
  if (levels !== undefined && levels.length > 0) {
    parts.push(`Level ${levels.join(" or ")}`);
  }
  const intel = filters.targetLocationIntelLevels;
  if (intel !== undefined && intel.length > 0) {
    parts.push(`Intel ${intel.join(" or ")}`);
  }
  const security = filters.targetLocationSecurityLevels;
  if (security !== undefined && security.length > 0) {
    parts.push(`Security ${security.join(" or ")}`);
  }
  return parts.length === 0 ? null : parts.join(" - ");
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
    case "target_location_type_not_allowed":
      return `This mission only targets ${err.allowed.map((t) => LOCATION_CATEGORY_LABEL[t]).join(" or ")} locations.`;
    case "target_location_level_not_allowed":
      return `This mission only targets level ${err.allowed.join(" or ")} locations.`;
    case "target_location_intel_not_allowed":
      return `This mission needs intel ${err.allowed.join(" or ")} at the target (currently ${err.intelLevel}).`;
    case "target_location_security_not_allowed":
      return `This mission needs security ${err.allowed.join(" or ")} at the target (currently ${err.securityLevel}).`;
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
    case "too_many_support_assets":
      return `Too many support assets (${err.got}; you have ${err.max} slot${
        err.max === 1 ? "" : "s"
      }).`;
    case "not_a_support_asset":
      return `${err.assetId} has no support ability and cannot ride along.`;
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

  const organizationNameEl = req<HTMLElement>("organization-name");
  const playerNameEl = req<HTMLElement>("player-name");
  const playerProfilePicEl = req<HTMLImageElement>("player-profile-pic");
  const statsEl = req<HTMLElement>("game-stats");
  const activityPanelEl = req<HTMLElement>("activity-panel");
  const minionsPanelEl = req<HTMLElement>("minions-panel");
  const assignMissionSlotEl = req<HTMLElement>("assign-mission-slot");
  const assignTargetSlotEl = req<HTMLElement>("assign-target-slot");
  const assignTargetFieldEl = req<HTMLElement>("assign-target-field");
  const assignTargetLabelEl = req<HTMLElement>("assign-target-label");
  const minionsList = req<HTMLElement>("assign-minions-list");
  const assignAssetSlotsFieldset = req<HTMLFieldSetElement>("assign-asset-slots-fieldset");
  const assignAssetSlotsList = req<HTMLElement>("assign-asset-slots-list");
  const assignSupportAssetsFieldset = req<HTMLFieldSetElement>("assign-support-assets-fieldset");
  const assignSupportAssetsLabel = req<HTMLElement>("assign-support-assets-label");
  const assignSupportAssetsList = req<HTMLElement>("assign-support-assets-list");
  const btnAssign = req<HTMLButtonElement>("btn-assign-mission");
  const assignSubmitChanceEl = req<HTMLElement>("assign-submit-chance");
  const btnExec = req<HTMLButtonElement>("btn-execute-plan");
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
  const missionsPanelRootEl = req<HTMLElement>("missions-panel-root");
  const missionsPanelTitleEl = req<HTMLElement>("missions-panel-title");
  const lairPanelEl = req<HTMLElement>("lair-panel");
  const mapPanelEl = req<HTMLElement>("map-panel");
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
  /**
   * Staged **support** assets, one entry per open support slot. Length tracks
   * `player.maxSupportAssets` (which lair upgrades move mid-run), so it is resized on every
   * render rather than pinned to the planned mission.
   */
  const assignSupportAssetIds: (string | null)[] = [];
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
  let lairPanelTab: LairPanelTab = "missions";
  let minionsPanelTab: "roster" | "hire" = "roster";
  let omegaPlanPanelTab: number | null = null;
  let currentMenu: GameMenu = "dashboard";

  function findMissionOrEventTemplate(id: string): MissionTemplate | undefined {
    return content.missions.find((m) => m.id === id) ?? content.events.find((e) => e.id === id);
  }

  function renderMissionEffectItemEls(
    effect: MissionEffect,
    catalog: ReturnType<typeof loadContent>,
    tone: "good" | "bad",
  ): HTMLElement[] {
    const toneClass =
      tone === "good" ? "mission-card-effects__item--good" : "mission-card-effects__item--bad";

    if (effect.kind === "gain_assets") {
      return effect.assetIds.map((id: string) => {
        const item = document.createElement("li");
        item.className = `mission-card-effects__item ${toneClass}`;
        item.append("Gain asset: ", createInlineAssetSpan(catalog, id));
        return item;
      });
    }

    if (effect.kind === "exchange_assets") {
      const item = document.createElement("li");
      item.className = `mission-card-effects__item ${toneClass}`;
      const hasRemove = effect.removeAssetIds.length > 0;
      const hasGain = effect.gainAssetIds.length > 0;
      if (hasRemove && hasGain) {
        item.append("Removed up to ");
        effect.removeAssetIds.forEach((id: string, idx: number) => {
          if (idx > 0) item.append(", ");
          item.appendChild(createInlineAssetSpan(catalog, id));
        });
        item.append(" from inventory, then gained ");
        effect.gainAssetIds.forEach((id: string, idx: number) => {
          if (idx > 0) item.append(", ");
          item.appendChild(createInlineAssetSpan(catalog, id));
        });
      } else if (hasRemove) {
        item.append("Removed up to ");
        effect.removeAssetIds.forEach((id: string, idx: number) => {
          if (idx > 0) item.append(", ");
          item.appendChild(createInlineAssetSpan(catalog, id));
        });
        item.append(" from inventory");
      } else if (hasGain) {
        item.append("Gained ");
        effect.gainAssetIds.forEach((id: string, idx: number) => {
          if (idx > 0) item.append(", ");
          item.appendChild(createInlineAssetSpan(catalog, id));
        });
      }
      return [item];
    }

    const lines = describeMissionEffect(effect, catalog);
    return lines.map((line) => {
      const item = document.createElement("li");
      item.className = `mission-card-effects__item ${toneClass}`;
      item.textContent = line;
      return item;
    });
  }

  function createMissionCardEffectsEl(
    mission: MissionTemplate | undefined,
    catalog: ReturnType<typeof loadContent>,
  ): HTMLElement | null {
    if (mission === undefined) {
      return null;
    }
    const successEffects = orderedMissionEffects(mission.onSuccessEffects ?? []);
    const failureEffects = orderedMissionEffects(mission.onFailureEffects ?? []);
    if (successEffects.length === 0 && failureEffects.length === 0) {
      return null;
    }

    const container = document.createElement("div");
    container.className = "mission-card-effects";

    if (successEffects.length > 0) {
      const group = document.createElement("div");
      group.className = "mission-card-effects__group mission-card-effects__group--success";

      const label = document.createElement("div");
      label.className = "mission-card-effects__label";
      label.textContent = "On Success";
      group.appendChild(label);

      const list = document.createElement("ul");
      list.className = "mission-card-effects__list";
      for (const eff of successEffects) {
        for (const item of renderMissionEffectItemEls(eff, catalog, "good")) {
          list.appendChild(item);
        }
      }
      group.appendChild(list);
      container.appendChild(group);
    }

    if (failureEffects.length > 0) {
      const group = document.createElement("div");
      group.className = "mission-card-effects__group mission-card-effects__group--failure";

      const label = document.createElement("div");
      label.className = "mission-card-effects__label";
      label.textContent = "On Failure";
      group.appendChild(label);

      const list = document.createElement("ul");
      list.className = "mission-card-effects__list";
      for (const eff of failureEffects) {
        for (const item of renderMissionEffectItemEls(eff, catalog, "bad")) {
          list.appendChild(item);
        }
      }
      group.appendChild(list);
      container.appendChild(group);
    }

    return container;
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
    for (let i = 0; i < assignSupportAssetIds.length; i += 1) {
      assignSupportAssetIds[i] = null;
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

  /**
   * Keep the staged support slots aligned with the player's current cap. Growing the cap adds
   * empty slots; shrinking it drops the tail (and whatever was staged there).
   */
  function syncAssignSupportSlotArray(): void {
    const n = Math.max(0, state.player.maxSupportAssets);
    while (assignSupportAssetIds.length < n) {
      assignSupportAssetIds.push(null);
    }
    if (assignSupportAssetIds.length > n) {
      assignSupportAssetIds.length = n;
    }
  }

  /**
   * Drop staged assets the player can no longer cover. Required slots are walked first, then
   * support slots, so if inventory shrinks under a plan (an `exchange_assets` payout, say) the
   * optional extras are the ones given up.
   */
  function reconcileStagedAssetSlots(): void {
    syncAssignSupportSlotArray();
    const budget = new Map<string, number>();
    const take = (assetId: string): boolean => {
      const left = budget.get(assetId) ?? state.player.assets[assetId] ?? 0;
      if (left < 1) {
        return false;
      }
      budget.set(assetId, left - 1);
      return true;
    };
    for (let i = 0; i < assignAssetSlotAssetIds.length; i += 1) {
      const id = assignAssetSlotAssetIds[i];
      if (id !== null && id !== undefined && !take(id)) {
        assignAssetSlotAssetIds[i] = null;
      }
    }
    for (let i = 0; i < assignSupportAssetIds.length; i += 1) {
      const id = assignSupportAssetIds[i];
      if (id === null || id === undefined) {
        continue;
      }
      const tpl = content.assets.find((a) => a.id === id);
      if (tpl === undefined || !isSupportAsset(tpl) || !take(id)) {
        assignSupportAssetIds[i] = null;
      }
    }
  }

  /** Support asset ids actually staged right now, in slot order (empties dropped). */
  function stagedSupportAssetIds(): string[] {
    syncAssignSupportSlotArray();
    return assignSupportAssetIds.filter((id): id is string => id !== null);
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
      return;
    }
    if (!targetPassesMissionLocationFilters(m, assignTarget)) {
      assignTarget = null;
    }
  }

  /**
   * Whether a staged target's site clears the mission's `targetLocationTypes` /
   * `targetLocationLevels`. Targets with no site (`minion` / `none`) always pass.
   */
  function targetPassesMissionLocationFilters(
    filters: MissionTargetLocationFilters,
    target: MissionTarget,
  ): boolean {
    if (target.kind !== "location" && target.kind !== "asset") {
      return true;
    }
    return locationPassesMissionFilters(filters, target.locationId);
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
    const siteFilters = missionTargetTypeTargetsLocation(m.targetType)
      ? formatTargetLocationFilters(m)
      : null;
    assignTargetLabelEl.textContent =
      siteFilters === null ? labels[m.targetType] : `${labels[m.targetType]} — ${siteFilters}`;
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

  /**
   * Site filters against one location. Intel and security come from **current** run state, so
   * which sites a mission accepts shifts as surveillance and heat move during the run.
   */
  function locationPassesMissionFilters(
    filters: MissionTargetLocationFilters,
    locationId: string,
  ): boolean {
    const location = getLocationById(content, locationId);
    if (location === undefined) {
      return true;
    }
    return missionAllowsTargetLocation(filters, {
      location,
      intelLevel: intelLevelAtLocation(state, locationId),
      securityLevel: securityLevelForLocation(state.locationSecurityStates, locationId),
    });
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
      return payload.kind === "mastermind-location" && locationPassesMissionFilters(m, payload.locationId);
    }
    if (m.targetType === "asset_hidden") {
      return (
        payload.kind === "mastermind-asset" &&
        payload.visibility === "hidden" &&
        locationPassesMissionFilters(m, payload.locationId)
      );
    }
    if (m.targetType === "asset_revealed") {
      return (
        payload.kind === "mastermind-asset" &&
        payload.visibility === "revealed" &&
        locationPassesMissionFilters(m, payload.locationId)
      );
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
    if (breakdown.supportAssetDelta !== 0) {
      lines.push(`Support assets: ${formatSignedPercent(breakdown.supportAssetDelta)}.`);
    }
    if (breakdown.challengeTraitIds.length > 0) {
      const unmatched = new Set(breakdown.unmatchedChallengeTraitIds);
      lines.push(
        `Agent challenge traits at target (from agents you can see): ${breakdown.challengeTraitIds
          .map((tid) => {
            const name = traitDisplayNames(content, [tid]);
            if (breakdown.challengeTraitsIgnored) {
              return `${name} (ignored)`;
            }
            return `${name}${unmatched.has(tid) ? " (unmatched)" : " (covered)"}`;
          })
          .join(", ")}.`,
      );
      if (breakdown.challengeTraitsIgnored) {
        lines.push("A support asset ignores agent challenge traits: no penalty.");
      } else if (breakdown.unmatchedChallengeTraitIds.length > 0) {
        lines.push(
          `Unmatched challenge traits: ${breakdown.unmatchedChallengeTraitIds.length} * -${content.balance.agentChallengeTraitPenalty}% = -${breakdown.challengeTraitPenaltyTotal}%.`,
        );
      }
    }
    if (breakdown.preClampPercent !== breakdown.finalPercent) {
      lines.push(`Clamped to [0, 100]: shown success chance is ${breakdown.finalPercent}%.`);
    } else {
      lines.push(`Shown success chance: ${breakdown.finalPercent}%.`);
    }
    return lines;
  }

  /**
   * Inventory units of `assetId` already spoken for by the staged plan — required slots and
   * support slots both reserve from the same pile, so both are counted here.
   */
  function stagedAssetUnits(assetId: string, exclude?: { list: "required" | "support"; index: number }): number {
    let n = 0;
    for (let i = 0; i < assignAssetSlotAssetIds.length; i += 1) {
      if (exclude?.list === "required" && exclude.index === i) {
        continue;
      }
      if (assignAssetSlotAssetIds[i] === assetId) {
        n += 1;
      }
    }
    for (let i = 0; i < assignSupportAssetIds.length; i += 1) {
      if (exclude?.list === "support" && exclude.index === i) {
        continue;
      }
      if (assignSupportAssetIds[i] === assetId) {
        n += 1;
      }
    }
    return n;
  }

  function renderAssignAssetSlots(): void {
    assignAssetSlotsList.innerHTML = "";
    const m = selectedMissionTemplate();
    const req = m?.requiredAssetIds ?? [];
    if (!assignMissionTemplateId || req.length === 0) {
      assignAssetSlotsFieldset.hidden = true;
      renderAssignSupportAssets();
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
        const usedElsewhere = stagedAssetUnits(parsed.assetId, {
          list: "required",
          index: slotIndex,
        });
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
    renderAssignSupportAssets();
  }

  /**
   * The optional support-asset slots. Unlike required slots these are not tied to the planned
   * mission — any owned asset with a `supportAbility` fits any slot — so the row is shown
   * whenever a mission is staged and the player has at least one slot.
   */
  function renderAssignSupportAssets(): void {
    assignSupportAssetsList.innerHTML = "";
    syncAssignSupportSlotArray();
    const cap = assignSupportAssetIds.length;
    if (!assignMissionTemplateId || cap === 0) {
      assignSupportAssetsFieldset.hidden = true;
      renderLairPanel();
      return;
    }
    assignSupportAssetsFieldset.hidden = false;
    assignSupportAssetsLabel.textContent = `Support Assets (optional · ${cap} slot${
      cap === 1 ? "" : "s"
    })`;
    const mainOnly = state.phase === "main";
    const wrap = document.createElement("div");
    wrap.className = "assign-minion-slots assign-asset-slots assign-support-asset-slots";

    for (let slotIndex = 0; slotIndex < cap; slotIndex += 1) {
      const slot = document.createElement("div");
      slot.className = "assign-minion-slot assign-asset-slot assign-support-asset-slot";
      slot.dataset.supportSlotIndex = String(slotIndex);

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
        const tpl = content.assets.find((a) => a.id === parsed.assetId);
        if (tpl === undefined || !isSupportAsset(tpl)) {
          return;
        }
        const owned = state.player.assets[parsed.assetId] ?? 0;
        const usedElsewhere = stagedAssetUnits(parsed.assetId, {
          list: "support",
          index: slotIndex,
        });
        if (owned - usedElsewhere < 1) {
          return;
        }
        assignSupportAssetIds[slotIndex] = parsed.assetId;
        renderAssignMinionSlots();
        onAssignSlotsChanged();
      });

      const placed = assignSupportAssetIds[slotIndex] ?? null;
      if (placed === null) {
        const ph = document.createElement("span");
        ph.className = "assign-minion-slot-placeholder";
        ph.textContent = `Support ${slotIndex + 1} · empty`;
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
        if (tpl?.supportAbility !== undefined) {
          const effect = document.createElement("span");
          effect.className = "assign-minion-chip-trait";
          effect.textContent = describeSupportAssetAbility(tpl.supportAbility);
          chipMain.appendChild(effect);
        }
        chip.appendChild(chipMain);

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "assign-minion-chip-remove";
        removeBtn.setAttribute("aria-label", `Remove ${tpl?.name ?? "asset"} from support slot`);
        removeBtn.textContent = "×";
        removeBtn.disabled = !mainOnly;
        removeBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          assignSupportAssetIds[slotIndex] = null;
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

    assignSupportAssetsList.appendChild(wrap);
    /* Staging a support asset changes what is still available, which the Assets tab shows. */
    renderLairPanel();
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
      const secLevel = state.locationSecurityStates.find(
        (s) => s.locationId === targetPick.locationId,
      )?.securityLevel;
      const securityTraitIds = state.locationSecurityTraits[targetPick.locationId] ?? [];
      const revealedSecIds = securityTraitIds.slice(
        0,
        Math.min(secLevel ?? 0, securityTraitIds.length),
      );
      const assetRowValue = `${visLabel} (${assetLabel})`;
      const assetWrap = document.createElement("span");
      assetWrap.className = "location-asset-static";
      if (slot && isOccupiedAssetSlot(slot)) {
        assetWrap.appendChild(createAssetIconEl());
      }
      assetWrap.appendChild(document.createTextNode(assetRowValue));
      appendMinionStatRows(dl, [
        {
          label: "Assets",
          value: assetRowValue,
          valueEl: assetWrap,
          dtClass: "location-card-stats__assets-dt",
          ddClass: "location-card-stats__assets-dd",
        },
        { label: "Slot", value: String(targetPick.slotIndex + 1) },
        {
          label: "Intel level",
          value: String(targetIntel),
          labelTooltipLines: INTEL_LEVEL_TOOLTIP_LINES,
        },
      ]);
      body.appendChild(dl);
      const rosterTraitIds = unionParticipantTraitIds(state.player.minions);
      const reqPillsEl = createLocationRequirementPillsEl(
        content,
        siteIds,
        revealedSecIds,
        rosterTraitIds,
      );
      if (reqPillsEl !== null) {
        body.appendChild(reqPillsEl);
      }
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
          span.className = "assign-minion-chip-trait";
          span.textContent = dynamicTraitDisplayLabel(content, state.player.minions, dtrait);
          span.tabIndex = 0;
          span.title = formatDynamicTraitTooltip(content, state.player.minions, dtrait);
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

  /**
   * Success chance for the plan as currently staged, or `null` while it is still missing a
   * mission, a valid target, or a legal participant set — everything the Submit button itself
   * requires of the *plan*. CP and the concurrent-mission cap are deliberately not checked: they
   * block the click, not the arithmetic, and the number is what tells the player whether freeing
   * one up is worth it. Empty required-asset slots are a real (lower) chance, not an unknown one.
   *
   * Mirrors the active-mission card: hidden agents' challenge traits stay out, so the preview
   * only ever promises what the player can actually see.
   */
  function stagedSuccessChance(): {
    breakdown: SuccessChanceBreakdown;
    dynamicEntries: readonly DynamicTraitSuccessBreakdownEntry[];
  } | null {
    if (assignMissionTemplateId === null || assignMissionSource === null) {
      return null;
    }
    const mission = findMissionOrEventTemplate(assignMissionTemplateId);
    if (!mission) {
      return null;
    }
    let target: MissionTarget;
    if (mission.targetType === "none") {
      target = { kind: "none" };
    } else {
      if (
        assignTarget === null ||
        !missionTargetMatchesTemplate(mission.targetType, assignTarget) ||
        !targetPassesMissionLocationFilters(mission, assignTarget)
      ) {
        return null;
      }
      target = assignTarget;
    }
    const participantIds = getAssignParticipantIds();
    const instanceById = new Map(state.player.minions.map((m) => [m.instanceId, m] as const));
    const participants = participantIds
      .map((id) => instanceById.get(id))
      .filter((x): x is MinionInstance => x !== undefined);
    if (!canAssignParticipants(participants, stagedParticipantCeiling())) {
      return null;
    }

    const lid = getMissionTargetLocationId(target);
    const supportAbilities = supportAbilitiesForAssetIds(stagedSupportAssetIds(), content.assets);
    syncAssignAssetSlotArrayWithMission();
    const successOpts = {
      ...missionSuccessOptionsForTarget(state, target, supportAbilities),
      traitsCatalog: content.traits,
      balance: content.balance,
      challengeTraitIds:
        lid === null
          ? []
          : challengeTraitIdsForAgents(playerVisibleOpposingAgentsAtLocation(state, lid)),
      dynamicTraitDelta: dynamicTraitSuccessModifierFromFullRoster(
        state.player.minions,
        participantIds,
        lid,
        content.balance.dynamicTraitModifiers,
      ),
      eventSuccessModifierDelta: totalEventSuccessModifierDelta(),
      supportAbilities,
      ...(mission.requiredAssetIds.length > 0
        ? {
            assignedAssetIds: Array.from(
              { length: mission.requiredAssetIds.length },
              (_, i) => assignAssetSlotAssetIds[i] ?? null,
            ),
          }
        : { playerAssets: state.player.assets }),
    };
    return {
      breakdown: computeSuccessChanceBreakdown(mission, participants, successOpts),
      dynamicEntries: dynamicTraitSuccessModifierBreakdownFromFullRoster(
        content,
        state.player.minions,
        participantIds,
        lid,
      ).entries,
    };
  }

  function syncAssignSubmitChance(): void {
    const staged = state.phase === "main" ? stagedSuccessChance() : null;
    if (staged === null) {
      assignSubmitChanceEl.hidden = true;
      assignSubmitChanceEl.textContent = "";
      assignSubmitChanceEl.title = "";
      assignSubmitChanceEl.classList.remove(
        "btn-submit-mission__chance--good",
        "btn-submit-mission__chance--warn",
      );
      return;
    }
    const pct = staged.breakdown.finalPercent;
    assignSubmitChanceEl.hidden = false;
    assignSubmitChanceEl.textContent = `${pct}%`;
    assignSubmitChanceEl.title = formatMissionSuccessChanceTooltipLines(
      staged.breakdown,
      staged.dynamicEntries,
      state.player.minions,
    ).join("\n");
    assignSubmitChanceEl.classList.toggle("btn-submit-mission__chance--good", pct >= 70);
    assignSubmitChanceEl.classList.toggle("btn-submit-mission__chance--warn", pct < 40);
  }

  function syncAssignButtonState(): void {
    syncAssignSubmitChance();
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
      /* Intel and security can move under a target staged on an earlier turn, so re-check the
       * site filters here rather than letting the click fail. */
      if (!targetPassesMissionLocationFilters(missionTemplate, assignTarget)) {
        btnAssign.disabled = true;
        btnAssign.title = `Target site does not meet: ${formatTargetLocationFilters(missionTemplate) ?? "this mission's requirements"}`;
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
            span.className = "assign-minion-chip-trait";
            span.textContent = dynamicTraitDisplayLabel(content, state.player.minions, dtrait);
            span.tabIndex = 0;
            span.title = formatDynamicTraitTooltip(content, state.player.minions, dtrait);
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

    const title = document.createElement("h4");
    title.className = "asset-card-title";
    title.textContent = mission?.name ?? missionId;
    body.appendChild(title);

    if (mission?.description) {
      const desc = document.createElement("p");
      desc.className = "asset-card-description";
      desc.textContent = mission.description;
      body.appendChild(desc);
    }

    if (mission) {
      const siteFilters = missionTargetTypeTargetsLocation(mission.targetType)
        ? formatTargetLocationFilters(mission)
        : null;
      const targetTypeLabel = formatMissionTargetTypeLabel(mission.targetType);
      const targetValue =
        siteFilters !== null ? `${targetTypeLabel} - ${siteFilters}` : targetTypeLabel;

      const statsRow = createMissionCardStatsRow({
        target: targetValue,
        cpCost: mission.startCommandPoints,
        duration: mission.durationTurns,
      });

      const traitIdsForDisplay =
        mergedRequiredTraitIdsForDisplay !== undefined
          ? mergedRequiredTraitIdsForDisplay
          : mission.requiredTraitIds;
      const rosterTraitIds = unionParticipantTraitIds(state.player.minions);
      appendRequiredMissionRequirementPills(
        statsRow,
        content,
        traitIdsForDisplay,
        rosterTraitIds,
        mission.requiredAssetIds,
        state.player.assets,
      );

      body.appendChild(statsRow);

      const effectsEl = createMissionCardEffectsEl(mission, content);
      if (effectsEl !== null) {
        body.appendChild(effectsEl);
      }
    } else {
      const dl = document.createElement("dl");
      dl.className = "asset-card-stats";
      appendMinionStatRows(dl, [{ label: "Mission id", value: missionId }]);
      body.appendChild(dl);
    }

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
    article.dataset.locationId = loc.id;
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
    body.appendChild(title);

    const statsRow = createLocationCardStatsRow({
      type: formatLocationTypeLabel(loc.locationType),
      level: loc.locationLevel,
      securityLevel: securityLevel !== undefined ? String(securityLevel) : "—",
      intelLevel: intelLevel,
    });

    const revealedSecIds = locationSecurityTraitIds.slice(
      0,
      Math.min(securityLevel ?? 0, locationSecurityTraitIds.length),
    );
    const rosterTraitIds = unionParticipantTraitIds(state.player.minions);
    appendLocationRequirementPills(
      statsRow,
      content,
      siteRequiredTraitIds,
      revealedSecIds,
      rosterTraitIds,
    );
    body.appendChild(statsRow);

    const dl = document.createElement("dl");
    dl.className = "location-card-stats";
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
        const chipTitle: string[] = [];
        if (a.challengeTraitIds.length > 0) {
          chipTitle.push(
            `Challenge traits: ${traitDisplayNames(content, a.challengeTraitIds)} — each one no participant matches costs -${content.balance.agentChallengeTraitPenalty}% success here.`,
          );
        }
        for (const abilityId of a.abilityIds) {
          const def = agentAbilityDef(abilityId);
          if (def !== undefined) {
            chipTitle.push(`${def.name} (${def.kind}): ${def.description}`);
          }
        }
        if (chipTitle.length > 0) {
          chip.title = chipTitle.join("\n");
        }
        if (a.abilityIds.length > 0) {
          const abilities = document.createElement("span");
          abilities.className = "location-agent-abilities";
          abilities.textContent = a.abilityIds.map((id) => agentAbilityName(id)).join(" · ");
          chip.appendChild(abilities);
        }
        dd.appendChild(chip);
      }
      const siteChallenges = challengeTraitIdsForAgents(visibleAgents);
      if (siteChallenges.length > 0) {
        const note = document.createElement("span");
        note.className = "location-agent-challenge-note";
        note.textContent = `Challenge: ${traitDisplayNames(content, siteChallenges)}`;
        note.title = `Each distinct challenge trait costs -${content.balance.agentChallengeTraitPenalty}% success on missions here unless a participant has the matching trait.`;
        dd.appendChild(note);
      }
      dl.appendChild(dt);
      dl.appendChild(dd);
    }

    const knownAssetChips: HTMLElement[] = [];
    for (let si = 0; si < assetSlots.length; si += 1) {
      const slot = assetSlots[si]!;
      const knowledge = assetSlotKnowledge(slot, intelLevel);
      if (knowledge === "unknown") {
        /* Intel 0: the player cannot even count the assets stored here. */
        continue;
      }
      if (slot.kind === "empty") {
        if (enableAssignDrag) {
          const chip = document.createElement("span");
          chip.className = "location-asset-drag-chip location-asset-drag-chip--empty";
          chip.draggable = false;
          chip.textContent = "—";
          chip.title = "Empty slot";
          knownAssetChips.push(chip);
        } else {
          const chip = document.createElement("span");
          chip.className = "location-asset-static";
          chip.textContent = "—";
          knownAssetChips.push(chip);
        }
        continue;
      }
      const displayValue =
        knowledge === "identified"
          ? (assetNameById.get(slot.assetId) ?? slot.assetId)
          : "Hidden";
      if (enableAssignDrag) {
        const targetVisibility = knowledge === "identified" ? "revealed" : "hidden";
        const chip = document.createElement("span");
        chip.className = "location-asset-drag-chip";
        chip.draggable = true;
        chip.appendChild(createAssetIconEl());
        chip.appendChild(document.createTextNode(displayValue));
        chip.title = `Drag to Plan mission target (slot ${si + 1})`;
        chip.addEventListener("dragstart", (e) => {
          e.stopPropagation();
          e.dataTransfer?.setData(
            "text/plain",
            assetDragJson(loc.id, si, targetVisibility),
          );
          e.dataTransfer!.effectAllowed = "copy";
        });
        knownAssetChips.push(chip);
      } else {
        const wrap = document.createElement("span");
        wrap.className = "location-asset-static";
        wrap.appendChild(createAssetIconEl());
        wrap.appendChild(document.createTextNode(displayValue));
        knownAssetChips.push(wrap);
      }
    }

    if (knownAssetChips.length === 0) {
      const countUnknown = assetSlots.some(
        (slot) => assetSlotKnowledge(slot, intelLevel) === "unknown",
      );
      if (countUnknown) {
        const chip = document.createElement("span");
        chip.className = enableAssignDrag
          ? "location-asset-drag-chip"
          : "location-asset-static";
        chip.draggable = false;
        chip.appendChild(createUnknownIntelIconEl());
        chip.appendChild(document.createTextNode("No intel available"));
        chip.title = "Raise intel at this site to learn how many assets are stored here.";
        knownAssetChips.push(chip);
      }
    }

    if (knownAssetChips.length > 0) {
      const dt = document.createElement("dt");
      dt.className = "location-card-stats__assets-dt";
      dt.textContent = "Assets";
      const dd = document.createElement("dd");
      dd.className = "location-card-stats__assets-dd";
      const container = document.createElement("span");
      container.className = "location-asset-pills";
      for (const chip of knownAssetChips) {
        container.appendChild(chip);
      }
      dd.appendChild(container);
      dl.appendChild(dt);
      dl.appendChild(dd);
    }

    if (dl.children.length > 0) {
      body.appendChild(dl);
    }
    return article;
  }

  function appendMinionStatRows(
    dl: HTMLElement,
    rows: Array<{
      label: string;
      value: string;
      valueEl?: HTMLElement;
      tooltipLines?: readonly string[];
      labelTooltipLines?: readonly string[];
      dtClass?: string;
      ddClass?: string;
    }>,
  ): void {
    for (const { label, value, valueEl, tooltipLines, labelTooltipLines, dtClass, ddClass } of rows) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      if (dtClass !== undefined) {
        dt.className = dtClass;
      }
      if (labelTooltipLines !== undefined && labelTooltipLines.length > 0) {
        dt.title = labelTooltipLines.join("\n");
      }
      const dd = document.createElement("dd");
      if (ddClass !== undefined) {
        dd.className = ddClass;
      }
      if (valueEl !== undefined) {
        dd.appendChild(valueEl);
      } else if (tooltipLines !== undefined && tooltipLines.length > 0) {
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

  function fillMinionsRosterInto(container: HTMLElement): void {
    if (state.player.minions.length === 0) {
      const empty = document.createElement("p");
      empty.className = "minions-panel-empty";
      empty.textContent = "None hired yet.";
      container.appendChild(empty);
      return;
    }
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
      const statsRow = createMinionsCardStatsRow({
        cpCost: tpl?.hireCommandPoints ?? "—",
        level: inst.currentLevel,
        xp: inst.currentExperience,
      });
      appendMinionTraits(statsRow, content, inst.traitIds, {
        roster: state.player.minions,
        traits: inst.dynamicTraits,
      });
      body.appendChild(statsRow);
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
      ]);
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

      container.appendChild(card);
    }
  }

  function fillMinionsHireInto(container: HTMLElement): void {
    const eligibleRehires = state.minionRehireQueue.filter(
      (e) => state.turnNumber >= e.availableFromTurn,
    );
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
      container.appendChild(empty);
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
      const statsRow = createMinionsCardStatsRow({
        cpCost: tpl.hireCommandPoints,
        level: tpl.startingLevel ?? 1,
        xp: 0,
      });
      const startingIds = tpl.startingTraitIds ?? [];
      appendMinionTraits(statsRow, content, startingIds, {
        roster: state.player.minions,
        traits: previewHireDynamicTraits(state, content, tpl.id),
      });
      body.appendChild(statsRow);

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

      card.appendChild(hireBtn);
      container.appendChild(card);
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
      const statsRow = createMinionsCardStatsRow({
        cpCost: tpl?.hireCommandPoints ?? "—",
        level: rehireInst.currentLevel,
        xp: rehireInst.currentExperience,
      });
      appendMinionTraits(statsRow, content, rehireInst.traitIds, {
        roster: state.player.minions,
        traits: previewRehireDynamicTraits(state, content, rehireInst),
      });
      body.appendChild(statsRow);

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

      card.appendChild(hireBtn);
      container.appendChild(card);
    }
  }

  function renderMinionsPanel(): void {
    minionsPanelEl.innerHTML = "";
    const p = state.player;
    const eligibleRehires = state.minionRehireQueue.filter(
      (e) => state.turnNumber >= e.availableFromTurn,
    );
    const hireOfferCount = state.availableMinionTemplateIds.length + eligibleRehires.length;

    function buildRosterSection(isColumn: boolean): HTMLElement {
      const section = document.createElement("section");
      section.className = isColumn ? "minions-panel-column" : "minions-panel-section";
      section.setAttribute("aria-label", "Hired minions");

      const heading = document.createElement("h3");
      heading.id = "minions-roster-heading";
      heading.className = isColumn
        ? "game-controls-heading minions-panel-column-title"
        : "game-controls-heading";
      heading.textContent = `Your roster (${p.minions.length}/${p.maxRosterSize})`;
      section.appendChild(heading);

      const list = document.createElement("div");
      list.id = "minions-roster-list";
      list.className = "minions-panel-list";
      fillMinionsRosterInto(list);
      section.appendChild(list);
      return section;
    }

    function buildHireSection(isColumn: boolean): HTMLElement {
      const section = document.createElement("section");
      section.className = isColumn ? "minions-panel-column" : "minions-panel-section";
      section.setAttribute("aria-label", "Minions available for hire");

      const headingRow = document.createElement("div");
      headingRow.className = "minions-section-heading-row";

      const heading = document.createElement("h3");
      heading.id = "minions-available-heading";
      heading.className = isColumn
        ? "game-controls-heading minions-panel-column-title"
        : "game-controls-heading";
      heading.textContent = `Available to hire (${hireOfferCount})`;
      headingRow.appendChild(heading);

      const btnReroll = document.createElement("button");
      btnReroll.type = "button";
      btnReroll.className = "btn btn-reroll-hire";
      btnReroll.id = "btn-reroll-hire";
      btnReroll.setAttribute("aria-label", "Reroll hire offers for 1 CP");
      btnReroll.textContent = "Reroll";

      const rerollCost = content.balance.rerollHireOffersCp;
      const mainOnly = state.phase === "main";
      const canRerollOffers = mainOnly && p.commandPoints >= rerollCost;
      btnReroll.disabled = !canRerollOffers;
      if (!mainOnly) {
        btnReroll.title = "Only during Main Phase";
      } else if (p.commandPoints < rerollCost) {
        btnReroll.title = `Need ${rerollCost} CP (${p.commandPoints} available)`;
      } else {
        btnReroll.title = `Spend ${rerollCost} CP to draw a new hire pool`;
      }
      btnReroll.addEventListener("click", () => {
        dispatch((s) => rerollHireOffers(s, content, rng));
      });
      headingRow.appendChild(btnReroll);
      section.appendChild(headingRow);

      const list = document.createElement("div");
      list.id = "minions-available-list";
      list.className = "minions-panel-list";
      fillMinionsHireInto(list);
      section.appendChild(list);
      return section;
    }

    if (currentMenu === "minions") {
      const columnsWrap = document.createElement("div");
      columnsWrap.className = "minions-panel-columns";
      columnsWrap.appendChild(buildRosterSection(true));
      columnsWrap.appendChild(buildHireSection(true));
      minionsPanelEl.appendChild(columnsWrap);
      return;
    }

    const tablist = document.createElement("div");
    tablist.className = "minions-panel-tabs";
    tablist.setAttribute("role", "tablist");
    tablist.setAttribute("aria-label", "Minions sections");

    const tabDefs: { id: "roster" | "hire"; label: string }[] = [
      { id: "roster", label: "Roster" },
      { id: "hire", label: "For Hire" },
    ];
    for (const def of tabDefs) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "minions-panel-tab";
      if (def.id === minionsPanelTab) {
        tab.classList.add("minions-panel-tab--active");
      }
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", def.id === minionsPanelTab ? "true" : "false");
      tab.id = `minions-panel-tab-${def.id}`;
      tab.textContent = def.label;
      tab.addEventListener("click", () => {
        if (minionsPanelTab === def.id) {
          return;
        }
        minionsPanelTab = def.id;
        renderMinionsPanel();
      });
      tablist.appendChild(tab);
    }
    minionsPanelEl.appendChild(tablist);

    const activePage =
      minionsPanelTab === "roster" ? buildRosterSection(false) : buildHireSection(false);
    activePage.setAttribute("role", "tabpanel");
    activePage.setAttribute("aria-labelledby", `minions-panel-tab-${minionsPanelTab}`);
    minionsPanelEl.appendChild(activePage);
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
    const currentPlan = plan;

    const header = document.createElement("div");
    header.className = "omega-plan-header";
    const headerBody = appendCardArtShell(header, resolveOmegaPlanCardArt(currentPlan));

    const nameEl = document.createElement("p");
    nameEl.className = "omega-plan-name";
    nameEl.textContent = currentPlan.name;
    headerBody.appendChild(nameEl);

    if (currentPlan.description) {
      const descEl = document.createElement("p");
      descEl.className = "omega-plan-description";
      descEl.textContent = currentPlan.description;
      headerBody.appendChild(descEl);
    }

    omegaPlanPanelEl.appendChild(header);

    const PHASE_NAMES = [
      "Shadow Seeding",
      "Global Destabilization",
      "Final Subjugation",
    ] as const;

    const mainOnly = state.phase === "main";

    function buildPhaseSection(stageIndex: number): HTMLElement {
      const stage = currentPlan.stages[stageIndex]!;
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

      const stageRequired = omegaStageRequiredMissions(currentPlan, stageIndex);

      const phaseHeader = document.createElement("div");
      phaseHeader.className = "omega-phase-header";
      const headerText = document.createElement("div");
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
      return section;
    }

    if (currentMenu === "omega") {
      const phasesWrap = document.createElement("div");
      phasesWrap.className = "omega-plan-phases";
      for (let stageIndex = 0; stageIndex < 3; stageIndex += 1) {
        phasesWrap.appendChild(buildPhaseSection(stageIndex));
      }
      omegaPlanPanelEl.appendChild(phasesWrap);
      return;
    }

    const tablist = document.createElement("div");
    tablist.className = "omega-plan-tabs";
    tablist.setAttribute("role", "tablist");
    tablist.setAttribute("aria-label", "Omega Plan phases");

    const tabDefs = [
      { id: 0, label: "Phase 1" },
      { id: 1, label: "Phase 2" },
      { id: 2, label: "Phase 3" },
    ];

    const activeStageTab = omegaPlanPanelTab ?? state.activeOmegaStageIndex;

    for (const def of tabDefs) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "omega-plan-tab";
      if (def.id === activeStageTab) {
        tab.classList.add("omega-plan-tab--active");
      }
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", def.id === activeStageTab ? "true" : "false");
      tab.id = `omega-plan-tab-${def.id + 1}`;
      tab.textContent = def.label;
      tab.addEventListener("click", () => {
        if (omegaPlanPanelTab === def.id) {
          return;
        }
        omegaPlanPanelTab = def.id;
        renderOmegaPlanPanel();
      });
      tablist.appendChild(tab);
    }
    omegaPlanPanelEl.appendChild(tablist);

    const activeSection = buildPhaseSection(activeStageTab);
    activeSection.setAttribute("role", "tabpanel");
    activeSection.setAttribute("aria-labelledby", `omega-plan-tab-${activeStageTab + 1}`);
    omegaPlanPanelEl.appendChild(activeSection);
  }

  /** Owned assets, newest inventory state, as draggable cards. */
  function fillAssetsInto(container: HTMLElement): void {
    container.innerHTML = "";
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
      container.appendChild(empty);
      return;
    }

    for (const { assetId, quantity, template } of rows) {
      const available = Math.max(0, quantity - stagedAssetUnits(assetId));
      const mainOnly = state.phase === "main";

      const article = document.createElement("article");
      article.className = "asset-card";
      if (template !== undefined && isSupportAsset(template)) {
        article.classList.add("asset-card--support");
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
      const assetRows: Array<{ label: string; value: string }> = [
        { label: "Available", value: String(available) },
        { label: "Owned", value: String(quantity) },
      ];
      if (template?.supportAbility !== undefined) {
        assetRows.push({
          label: "Support",
          value: describeSupportAssetAbility(template.supportAbility),
        });
      }
      appendMinionStatRows(dl, assetRows);
      body.appendChild(dl);

      const descText = template?.description?.trim();
      if (descText) {
        const desc = document.createElement("p");
        desc.className = "asset-card-description";
        desc.textContent = descText;
        body.appendChild(desc);
      }

      container.appendChild(article);
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

    const title = document.createElement("h4");
    title.className = "asset-card-title";
    title.textContent = mission?.name ?? am.missionTemplateId;
    body.appendChild(title);

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

    const rows: Array<{
      label: string;
      value: string;
      valueEl?: HTMLElement;
      tooltipLines?: readonly string[];
    }> = [
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
      /* Preview only what the player has uncovered: challenge traits from hidden agents stay
       * out of the shown chance, exactly as the old per-agent penalty did. */
      const challengeTraitIds =
        lid === null
          ? []
          : challengeTraitIdsForAgents(playerVisibleOpposingAgentsAtLocation(state, lid));
      const dynamicTraitDelta = dynamicTraitSuccessModifierFromFullRoster(
        state.player.minions,
        am.participantInstanceIds,
        lid,
        content.balance.dynamicTraitModifiers,
      );
      const supportAbilities = supportAbilitiesForAssetIds(am.supportAssetIds, content.assets);
      const successOpts = {
        ...missionSuccessOptionsForTarget(state, am.target, supportAbilities),
        traitsCatalog: content.traits,
        balance: content.balance,
        challengeTraitIds,
        dynamicTraitDelta,
        eventSuccessModifierDelta: totalEventSuccessModifierDelta(),
        supportAbilities,
        ...(mission.requiredAssetIds.length > 0
          ? { assignedAssetIds: am.plannedAssetIds }
          : { playerAssets: state.player.assets }),
      };
      const mergedDisplay = mergedRequiredTraitIdsSorted(mission, successOpts);
      const hasReqs =
        mergedDisplay.length > 0 || mission.requiredAssetIds.length > 0;
      rows.push(
        { label: "Start cost", value: `${mission.startCommandPoints} CP (paid)` },
        {
          label: "Progress",
          value: `${am.turnsRemaining} / ${mission.durationTurns} turn${
            mission.durationTurns === 1 ? "" : "s"
          } remaining`,
        },
        {
          label: "Requirements",
          value: requirementsDisplayNames(
            content,
            mergedDisplay,
            mission.requiredAssetIds,
          ),
          ...(hasReqs
            ? {
                valueEl: requiredMissionRequirementPillsEl(
                  content,
                  mergedDisplay,
                  unionParticipantTraitIds(state.player.minions),
                  mission.requiredAssetIds,
                  state.player.assets,
                ),
              }
            : {}),
        },
      );
      if (mission.requiredAssetIds.length > 0) {
        rows.push({
          label: "Planned assets",
          value: plannedAssetSlotsDisplay(
            content,
            mission.requiredAssetIds,
            am.plannedAssetIds,
          ),
        });
      }
      if (am.supportAssetIds.length > 0) {
        rows.push({
          label: "Support assets",
          value: supportAssetsDisplay(content, am.supportAssetIds),
          tooltipLines: supportAssetTooltipLines(content, am.supportAssetIds),
        });
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

    const effectsEl = createMissionCardEffectsEl(mission, content);
    if (effectsEl !== null) {
      body.appendChild(effectsEl);
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
   * stay hidden until their turn. A level under its `minInfamy` is still shown in full, with
   * the standing it wants spelled out: infamy gates starting the work, never seeing it.
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
    const needInfamy = lairUpgradeLevelMinInfamy(level);
    const infamyLocked = state.player.infamy < needInfamy;
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
        if (infamyLocked) {
          return {
            missionTemplateId: mid,
            status: { label: `${needInfamy} Infamy`, kind: "locked" } as const,
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
        : infamyLocked
          ? `Needs ${needInfamy} infamy to begin (you have ${state.player.infamy}).`
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
        const unmetChallenges = ev.unmatchedChallengeTraitIds ?? [];
        if (unmetChallenges.length > 0) {
          detailLines.push(
            `Unmatched agent challenge traits: ${traitDisplayNames(content, unmetChallenges)}.`,
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

  /**
   * Click-to-target from the map: the same rule the target slot applies to a dropped location
   * card, without the drag. Returns false (and changes nothing) when the planned mission would
   * not accept this site.
   */
  function trySetMapTarget(locationId: string): boolean {
    if (state.phase !== "main") {
      return false;
    }
    if (selectedMissionTemplate()?.targetType === "none") {
      return false;
    }
    if (!targetPayloadMatchesPlannedMission({ kind: "mastermind-location", locationId })) {
      return false;
    }
    if (!runLocations().some((l) => l.id === locationId)) {
      return false;
    }
    assignTarget = { kind: "location", locationId };
    renderAssignPickSlots();
    renderAssignMinionSlots();
    onAssignSlotsChanged();
    return true;
  }

  /**
   * The run's map with its sites plotted on it. Markers carry the same drag payload as location
   * cards, so the map is a second way to pick a mission target rather than a picture of one.
   */
  function renderMapPanel(): void {
    mapPanelEl.innerHTML = "";

    const plan =
      state.activeOmegaPlanId !== null
        ? getOmegaPlanById(content, state.activeOmegaPlanId)
        : undefined;
    const map = plan !== undefined ? getMapById(content, plan.mapId) : undefined;
    const mapSection = mapPanelEl.closest(".game-panel--map");
    if (mapSection instanceof HTMLElement) {
      mapSection.setAttribute("aria-label", map?.name ?? "Global map");
    }

    if (map?.mapArt === undefined) {
      const empty = document.createElement("p");
      empty.className = "map-panel-empty";
      empty.textContent = "No map art for this run.";
      mapPanelEl.appendChild(empty);
      return;
    }

    const plot = document.createElement("div");
    plot.className = "map-plot";

    const art = document.createElement("img");
    art.className = "map-plot__art";
    art.src = map.mapArt;
    art.alt = `${map.name}. ${map.description}`;
    art.decoding = "async";
    plot.appendChild(art);

    const playable = new Set(runLocations().map((l) => l.id));
    const mainOnly = state.phase === "main";
    const targetedLocationId =
      assignTarget?.kind === "location" || assignTarget?.kind === "asset"
        ? assignTarget.locationId
        : null;

    for (const marker of map.markers ?? []) {
      const loc = getLocationById(content, marker.locationId);
      if (loc === undefined || !playable.has(loc.id)) {
        continue;
      }

      const intel = intelLevelAtLocation(state, loc.id);
      const security = securityLevelForLocation(state.locationSecurityStates, loc.id);
      const agents = playerVisibleOpposingAgentsAtLocation(state, loc.id);

      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = `map-marker map-marker--${loc.locationType}`;
      pin.dataset.locationId = loc.id;
      pin.style.left = `${marker.x}%`;
      pin.style.top = `${marker.y}%`;
      if (intel === 0) {
        pin.classList.add("map-marker--dark");
      }
      if (agents.length > 0) {
        pin.classList.add("map-marker--agents");
      }
      if (loc.id === targetedLocationId) {
        pin.classList.add("map-marker--targeted");
      }

      const tipLines = [
        loc.name,
        `${formatLocationTypeLabel(loc.locationType)} · Level ${loc.locationLevel}`,
        `Security ${security}/${maxSecurityLevelForLocation(content, loc.id)} · Intel ${intel}`,
      ];
      if (agents.length > 0) {
        const names = agents.map(
          (a) => getAgentTemplateById(content, a.templateId)?.name ?? a.templateId,
        );
        tipLines.push(`Agents: ${names.join(", ")}`);
      }
      pin.title = tipLines.join("\n");
      pin.setAttribute("aria-label", tipLines.join(". "));

      pin.draggable = mainOnly;
      pin.addEventListener("dragstart", (e) => {
        if (!pin.draggable) {
          e.preventDefault();
          return;
        }
        e.stopPropagation();
        e.dataTransfer?.setData("text/plain", locationDragJson(loc.id));
        e.dataTransfer!.effectAllowed = "copy";
      });
      pin.addEventListener("click", () => {
        trySetMapTarget(loc.id);
      });

      const ring = document.createElement("span");
      ring.className = "map-marker__ring";
      pin.appendChild(ring);
      const dot = document.createElement("span");
      dot.className = "map-marker__dot";
      pin.appendChild(dot);
      const label = document.createElement("span");
      label.className = "map-marker__label";
      label.textContent = loc.name;
      pin.appendChild(label);

      plot.appendChild(pin);
    }

    mapPanelEl.appendChild(plot);
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

    function fillLairTabInto(tab: LairPanelTab, container: HTMLElement): void {
      if (tab === "missions") {
        fillLairMissionsInto(container);
      } else if (tab === "active") {
        renderActiveMissionsInto(container);
      } else {
        fillAssetsInto(container);
      }
    }

    if (currentMenu === "lair") {
      const columnsWrap = document.createElement("div");
      columnsWrap.className = "lair-panel-columns";
      for (const def of LAIR_PANEL_TABS) {
        const column = document.createElement("section");
        column.className = "lair-panel-column";
        column.setAttribute("aria-label", def.label);

        const heading = document.createElement("h3");
        heading.className = "game-controls-heading lair-panel-column-title";
        heading.textContent = def.label;

        const list = document.createElement("div");
        list.className = "lair-panel-missions";
        fillLairTabInto(def.id, list);

        column.appendChild(heading);
        column.appendChild(list);
        columnsWrap.appendChild(column);
      }
      lairPanelEl.appendChild(columnsWrap);
      return;
    }

    const tablist = document.createElement("div");
    tablist.className = "lair-panel-tabs";
    tablist.setAttribute("role", "tablist");
    tablist.setAttribute("aria-label", "Lair sections");

    for (const def of LAIR_PANEL_TABS) {
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
    fillLairTabInto(lairPanelTab, list);
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
          if (ev.relationshipChanges !== undefined && ev.relationshipChanges.length > 0) {
            const relParts = ev.relationshipChanges.map((c) =>
              formatRelationshipChange(content, state.player.minions, c),
            );
            line += ` ${relParts.join(" ")}`;
          }
          if (ev.standingChanges !== undefined && ev.standingChanges.length > 0) {
            const standingParts = ev.standingChanges.map((c) =>
              formatStandingChange(content, state.player.minions, c),
            );
            line += ` ${standingParts.join(" ")}`;
          }
          const challengeIds = ev.challengeTraitIds ?? [];
          if (challengeIds.length > 0) {
            const unmet = ev.unmatchedChallengeTraitIds ?? [];
            line += ` Agent challenge traits on site: ${traitDisplayNames(content, challengeIds)}; unmatched: ${
              unmet.length > 0 ? traitDisplayNames(content, unmet) : "none"
            }.`;
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
        case "agent_ability_used":
          return describeAgentAbilityUse(content, state, ev);
        case "agent_moved": {
          const who = content.agents.find((a) => a.id === ev.agentTemplateId)?.name ?? "An agent";
          const nameOf = (lid: string): string =>
            content.locations.find((l) => l.id === lid)?.name ?? lid;
          const from = nameOf(ev.fromLocationId);
          const to = nameOf(ev.toLocationId);
          return `${who} moved from ${from} to ${to}.`;
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
          /* Agent movement is logged for every agent; only the moves the player could watch
           * belong in the feed (see `isOpposingAgentMoveVisibleToPlayer`). */
          if (
            ev.kind === "agent_moved" &&
            !isOpposingAgentMoveVisibleToPlayer(
              state,
              ev.agentInstanceId,
              ev.fromLocationId,
              ev.toLocationId,
            )
          ) {
            continue;
          }
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

    /* On the dashboard every tile shows except the ones whose content lives inside another tile
     * (Missions, which the Lair panel carries as a tab). Otherwise exactly one panel is up. */
    for (const panel of menuPanels) {
      panel.hidden = showDashboard
        ? panel.dataset.dashboardHidden === "true"
        : panel.dataset.menuPanel !== currentMenu;
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
    renderMissionsPanel();
    renderLairPanel();
    renderOmegaPlanPanel();
    renderMinionsPanel();
    renderMapPanel();
  }

  /**
   * Dashboard-only: hovering a Locations card lights the matching map pin and shows its name.
   * Pointer events bubble from children, so relatedTarget is used to ignore moves inside a card.
   */
  function locationCardFromEvent(target: EventTarget | null): HTMLElement | null {
    return target instanceof Element ? target.closest<HTMLElement>(".location-card") : null;
  }

  function setMapMarkerPreview(locationId: string | null): void {
    for (const pin of mapPanelEl.querySelectorAll(".map-marker--preview")) {
      pin.classList.remove("map-marker--preview");
    }
    if (locationId === null || currentMenu !== "dashboard") {
      return;
    }
    const pin = mapPanelEl.querySelector(
      `.map-marker[data-location-id="${CSS.escape(locationId)}"]`,
    );
    pin?.classList.add("map-marker--preview");
  }

  locationsPanelEl.addEventListener("pointerover", (e) => {
    const card = locationCardFromEvent(e.target);
    if (card === null) {
      return;
    }
    const from = e.relatedTarget instanceof Node ? e.relatedTarget : null;
    if (from !== null && card.contains(from)) {
      return;
    }
    setMapMarkerPreview(card.dataset.locationId ?? null);
  });
  locationsPanelEl.addEventListener("pointerout", (e) => {
    const card = locationCardFromEvent(e.target);
    if (card === null) {
      return;
    }
    const to = e.relatedTarget instanceof Node ? e.relatedTarget : null;
    if (to !== null && card.contains(to)) {
      return;
    }
    setMapMarkerPreview(null);
  });

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
    if (m.supportAssetIds.length > 0) {
      rows.push({
        label: "Support assets",
        value: supportAssetsDisplay(content, m.supportAssetIds),
      });
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
    reconcileAssignSlots();
    syncAssignAssetSlotArrayWithMission();
    reconcileStagedAssetSlots();

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
    renderMissionsPanel();
    renderLairPanel();
    renderMapPanel();
    renderActivityPanel();
    applyGameMenuVisibility();
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
    const supportAssetIds = stagedSupportAssetIds();
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
          supportAssetIds,
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
    /* Two steps, one click: `executePlan` resolves missions and leaves the turn in the
     * "agent" phase, then `executeAgentPhase` runs the opposition and lands in "summary" —
     * where the end-of-turn report is shown, and dismissing its Turn Summary is what calls
     * `advanceToNextTurn` (closeTurnReport). */
    const before = state;
    if (!dispatch((s) => executePlan(s, content, rng))) {
      return;
    }
    /* A run that ended during resolution skips the Agent Phase: there is no next turn to
     * shape, and `executeAgentPhase` refuses a finished run anyway. */
    if (state.runEnding === null && !dispatch((s) => executeAgentPhase(s, content, rng))) {
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

  minionsPanelEl.addEventListener("dragstart", (e) => {
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

  minionsPanelEl.addEventListener("dragend", () => {
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
initGlobalTooltips();
