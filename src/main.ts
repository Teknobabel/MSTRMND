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
  revealedSecurityTraitIds,
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
  TraitType,
} from "./game/types";
import { isOccupiedAssetSlot } from "./game/types";
import {
  canAssignParticipants,
  computeSuccessChanceBreakdown,
  describeSupportAssetAbility,
  hasSupportAbility,
  isSupportAsset,
  mergedRequiredTraitIdsSorted,
  missionAllowsTargetLocation,
  unionParticipantTraitIds,
  missionOutcomeChances,
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
  missionEffectsGroupTitle,
  missionOutcomeLabel,
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
  MAX_INTEL_LEVEL,
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
import { initStageScale, STAGE_WIDTH } from "./ui/stageScale";
import {
  createFlatProjector,
  createMatrixProjector,
  flatMapMatrix,
  type MapProjector,
  type MarkerPoint,
  type PlotSize,
} from "./ui/map/projection";
import { createMapPlaneRenderer, type MapPlaneRenderer } from "./ui/map/planeRenderer";
import {
  easeMapLean,
  mapCameraFrame,
  type MapCameraFocus,
  type MapCameraFrame,
} from "./ui/map/camera";
import { ambientTracks } from "./ui/map/ambientTraffic";
import { formatMapCoordinates } from "./ui/map/coordinates";
import { mapSiteSignals, type MapSiteSignal } from "./ui/map/siteSignals";
import {
  MAP_LAYER_GROUPS,
  MAP_LAYER_PLOT_CLASSES,
  loadMapLayers,
  mapLayerPlotClasses,
  saveMapLayers,
  type MapLayerKey,
  type MapLayerState,
} from "./ui/map/mapLayers";
import { omegaPhaseTargetsByLocation } from "./ui/map/omegaTargets";
import { initRunSetup, type RunSetupApi } from "./ui/runSetup";
import { initGlobalTooltips } from "./ui/tooltip";
import {
  appendCardArtShell,
  appendCardHeroShell,
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
  "Moves only when a mission or event authors a security effect — nothing raises it by default.",
];

/** Hover text for the Infamy icon (status bar stat block, mission effect lines). */
const INFAMY_TOOLTIP_LINES: readonly string[] = [
  "Your organization's notoriety (0 to 100).",
  "Higher infamy unlocks lair upgrade levels and higher-level minions in the hire pool.",
  "Some events only show up once infamy clears their threshold.",
];

/** Hover text for the Heat icon (status bar stat block, mission effect lines). */
const HEAT_TOOLTIP_LINES: readonly string[] = [
  "Law-enforcement attention on your organization (0 to 100).",
  "Heat sets the Threat Level tier, which raises the opposing-agent cap and the heat gained each turn.",
  "The tier never drops once reached, even when heat falls again.",
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

/**
 * Tabs on the dashboard Resources tile: everything a mission gets stocked from —
 * the hired roster, who else is buyable, and the assets on the shelf.
 */
type ResourcesPanelTab = "roster" | "hire" | "assets";

const DASHBOARD_RESOURCES_TABS: readonly { id: ResourcesPanelTab; label: string }[] = [
  { id: "roster", label: "Minions" },
  { id: "hire", label: "For Hire" },
  { id: "assets", label: "Assets" },
];

type DashboardLairTab = "missions" | "active" | "upgrades";
type LairPanelSection = DashboardLairTab | "assets";

/**
 * Lair sections shown as tabs on the dashboard lair tile.
 * Owned assets are not among them — they belong to the dashboard Resources tile,
 * alongside the minions they get committed with.
 */
const DASHBOARD_LAIR_TABS: readonly { id: DashboardLairTab; label: string }[] = [
  { id: "missions", label: "Missions" },
  { id: "active", label: "Active Missions" },
  { id: "upgrades", label: "Upgrades" },
];

/**
 * Lair sections shown as columns in the main fullscreen Lair menu.
 */
const LAIR_MENU_COLUMNS: readonly { id: LairPanelSection; label: string }[] = [
  { id: "missions", label: "Missions" },
  { id: "upgrades", label: "Upgrades" },
  { id: "active", label: "Active Missions" },
  { id: "assets", label: "Assets" },
];

/* Stat glyph paths, shared by the status bar and the mission effect lines. */
const INFAMY_ICON_SVG_PATHS =
  '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>';
const HEAT_ICON_SVG_PATHS =
  '<path d="M12 2.5s5.5 4.4 5.5 9.4a5.5 5.5 0 0 1-11 0c0-2 1-3.6 2-4.8.3 1.4 1.1 2.3 2 2.3 1.3 0 1.8-1.3 1.8-3 0-1.4-.3-2.7-.3-3.9Z"/>';
const INTEL_ICON_SVG_PATHS =
  '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>';

/* Inline SVG icons for the OMEGA OS status bar (stroked via CSS). */
const ICON_BOLT =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4.5 13.5H10L9 22l8.5-11.5H12L13 2Z"/></svg>';
const ICON_STAR = `<svg viewBox="0 0 24 24" aria-hidden="true">${INFAMY_ICON_SVG_PATHS}</svg>`;
const ICON_PERSON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7.5" r="4"/><path d="M4.5 21v-1.5a6 6 0 0 1 6-6h3a6 6 0 0 1 6 6V21"/></svg>';
const ICON_FLAME = `<svg viewBox="0 0 24 24" aria-hidden="true">${HEAT_ICON_SVG_PATHS}</svg>`;
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

function createSvgPillIcon(
  pathsHtml: string,
  className = "minions-trait-pill__icon",
): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", className);
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

/**
 * Cached hex-grid layer for the OMEGA OS map background; rebuilt on resize.
 * The backing canvas is reused rather than reallocated: a resize burst
 * (rotation, URL bar, an in-progress zoom) would otherwise strand a
 * full-screen canvas per frame, which is how a phone tab runs out of memory.
 */
let bgHexGrid: HTMLCanvasElement | null = null;
let bgHexGridW = 0;
let bgHexGridH = 0;

function buildHexGridLayer(width: number, height: number): HTMLCanvasElement {
  const layer = bgHexGrid ?? document.createElement("canvas");
  // Assigning either dimension also clears the canvas, so this is a full rebuild.
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

/**
 * Set by the game controller so the map animates off the one loop the shell already runs.
 * A second `requestAnimationFrame` would double the wake-ups on a phone for no reason, and
 * would keep running after `stopGameLoop` had put the rest of the shell to sleep.
 */
let mapFrameHook: ((timeMs: number) => void) | null = null;

function tick(timeMs: number): void {
  drawGameFrame(timeMs);
  mapFrameHook?.(timeMs);
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

/**
 * Display order for catalog traits: what a minion is comes before what they happen to be good
 * at, and a temporary status comes after both. Dynamic traits are appended by callers after any
 * of these lists, so they always land last.
 */
const TRAIT_TYPE_DISPLAY_ORDER: Record<TraitType, number> = {
  primary: 0,
  secondary: 1,
  status_positive: 2,
  status_negative: 3,
};

/**
 * Sorts trait ids into {@link TRAIT_TYPE_DISPLAY_ORDER}. The sort is stable, so within a type the
 * caller's own order survives — alphabetical for merged requirement lists, authored order for a
 * minion's own traits — and a card's pills never shuffle between renders.
 */
function sortedTraitIdsForDisplay(
  catalog: ReturnType<typeof loadContent>,
  traitIds: readonly string[],
): string[] {
  const rank = (id: string): number => {
    const trait = catalog.traits.find((t) => t.id === id);
    /* An id with no catalog entry is a content bug; park it at the end rather than guessing. */
    return trait === undefined ? 99 : TRAIT_TYPE_DISPLAY_ORDER[trait.type];
  };
  return traitIds
    .map((id, index) => ({ id, index, rank: rank(id) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.id);
}

/**
 * Where a card's trait / requirement pills go: their own full-width line under the stat badges,
 * rather than trailing them on the same row. Grouping them this way is what makes a card's
 * traits scannable at a glance.
 *
 * `container` is a `.minions-card-stats-row`, which wraps, so a `flex: 1 0 100%` child starts a
 * new line. Callers that already built a standalone pill wrapper get that back untouched instead
 * of a second nested one.
 */
function cardTraitRow(container: HTMLElement): HTMLElement {
  if (
    container.classList.contains("mission-req-pills") ||
    container.classList.contains("card-trait-row")
  ) {
    return container;
  }
  const existing = container.querySelector<HTMLElement>(":scope > .card-trait-row");
  if (existing !== null) {
    return existing;
  }
  const row = document.createElement("div");
  row.className = "card-trait-row";
  container.appendChild(row);
  return row;
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
  const row = cardTraitRow(container);

  for (const tid of sortedTraitIdsForDisplay(catalog, traitIds)) {
    row.appendChild(createTraitPillEl(catalog, tid));
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
    row.appendChild(span);
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

function traitDisplayNames(
  catalog: ReturnType<typeof loadContent>,
  traitIds: string[],
): string {
  if (traitIds.length === 0) {
    return "—";
  }
  return sortedTraitIdsForDisplay(catalog, traitIds)
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

/** Stats a mission effect line names by word, shown as their icon instead. */
type MissionEffectStat = "infamy" | "heat" | "intel" | "security";

/**
 * Icon, hover text, and the wording {@link describeMissionEffect} opens the line with, per
 * stat. `label` is what the icon replaces, so it has to match that opening exactly — a line
 * that starts some other way keeps its text untouched.
 */
const MISSION_EFFECT_STAT_META: Record<
  MissionEffectStat,
  { label: string; iconPaths: string; tooltipLines: readonly string[] }
> = {
  infamy: {
    label: "Infamy",
    iconPaths: INFAMY_ICON_SVG_PATHS,
    tooltipLines: INFAMY_TOOLTIP_LINES,
  },
  heat: {
    label: "Heat",
    iconPaths: HEAT_ICON_SVG_PATHS,
    tooltipLines: HEAT_TOOLTIP_LINES,
  },
  intel: {
    label: "Intel level",
    iconPaths: INTEL_ICON_SVG_PATHS,
    tooltipLines: INTEL_LEVEL_TOOLTIP_LINES,
  },
  security: {
    label: "Security level",
    iconPaths: SECURITY_ICON_SVG_PATHS,
    tooltipLines: SECURITY_LEVEL_TOOLTIP_LINES,
  },
};

/** The stat each effect kind reports; kinds absent here name no stat and stay plain text. */
const MISSION_EFFECT_STAT_BY_KIND: Partial<Record<MissionEffect["kind"], MissionEffectStat>> = {
  infamy_delta: "infamy",
  heat_delta: "heat",
  intel_level_delta: "intel",
  intel_level_delta_global: "intel",
  intel_level_delta_by_location_type: "intel",
  intel_level_delta_by_location_level: "intel",
  security_level_delta: "security",
  security_level_delta_global: "security",
  security_level_delta_by_location_type: "security",
  security_level_delta_by_location_level: "security",
};

/**
 * One stat effect as a stat badge, built like the location-card and mission-cost badges: the
 * stat's icon stands in for its name, which moves into the hover tooltip and the accessible
 * label, leaving the badge to read as icon + delta.
 */
function createMissionEffectStatBadgeEl(stat: MissionEffectStat, value: string): HTMLElement {
  const meta = MISSION_EFFECT_STAT_META[stat];
  const badge = document.createElement("span");
  badge.className = `mission-card-effects__stat-chip mission-card-effects__stat-chip--${stat}`;
  badge.tabIndex = 0;
  badge.setAttribute("aria-label", `${meta.label} ${value}`);
  badge.title = `${meta.label} ${value}\n${meta.tooltipLines.join("\n")}`;
  badge.appendChild(createSvgPillIcon(meta.iconPaths, "mission-card-effects__stat-icon"));
  const valueEl = document.createElement("span");
  valueEl.className = "mission-card-effects__stat-value";
  valueEl.textContent = value;
  badge.appendChild(valueEl);
  return badge;
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
  if (traitIds.length === 0 && assetIds.length === 0) {
    return;
  }
  const row = cardTraitRow(container);
  for (const tid of sortedTraitIdsForDisplay(catalog, traitIds)) {
    row.appendChild(createTraitPillEl(catalog, tid, rosterTraitIds));
  }

  const remaining = new Map<string, number>();
  for (const aid of assetIds) {
    const left = remaining.get(aid) ?? ownedAssets[aid] ?? 0;
    remaining.set(aid, left - 1);
    row.appendChild(createAssetPillEl(catalog, aid, left > 0));
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
  if (siteTraitIds.length === 0 && revealedSecurityTraitIds.length === 0) {
    return;
  }
  const row = cardTraitRow(container);
  for (const tid of sortedTraitIdsForDisplay(catalog, siteTraitIds)) {
    row.appendChild(createTraitPillEl(catalog, tid, rosterTraitIds, "trait"));
  }
  for (const tid of sortedTraitIdsForDisplay(catalog, revealedSecurityTraitIds)) {
    row.appendChild(createTraitPillEl(catalog, tid, rosterTraitIds, "security"));
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
 * Returns null when the mission takes any site (no filters authored). `locationName` turns a
 * pinned `targetLocationIds` entry into the site's catalog name; ids fall through unresolved.
 */
function formatTargetLocationFilters(
  filters: MissionTargetLocationFilters,
  locationName?: (locationId: string) => string,
): string | null {
  const parts: string[] = [];
  const siteIds = filters.targetLocationIds;
  if (siteIds !== undefined && siteIds.length > 0) {
    parts.push(siteIds.map((id) => locationName?.(id) ?? id).join(" or "));
  }
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
    case "target_location_id_not_allowed":
      return err.allowed.length === 1
        ? "This mission can only be aimed at one specific site."
        : "This mission can only be aimed at specific sites.";
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
  const overlayActivityLog = req<HTMLElement>("overlay-activity-log");
  const activityLogBackdrop = req<HTMLElement>("activity-log-backdrop");
  const activityLogVerdict = req<HTMLElement>("activity-log-verdict");
  const activityLogBody = req<HTMLElement>("activity-log-body");
  const btnActivityLogClose = req<HTMLButtonElement>("btn-activity-log-close");
  const minionsPanelEl = req<HTMLElement>("minions-panel");
  const assignMissionSlotEl = req<HTMLElement>("assign-mission-slot");
  const assignTargetSlotEl = req<HTMLElement>("assign-target-slot");
  const assignTargetFieldEl = req<HTMLElement>("assign-target-field");
  const minionsList = req<HTMLElement>("assign-minions-list");
  const assignAssetSlotsFieldset = req<HTMLElement>("assign-asset-slots-fieldset");
  const assignAssetSlotsList = req<HTMLElement>("assign-asset-slots-list");
  const assignSupportAssetsFieldset = req<HTMLElement>("assign-support-assets-fieldset");
  const assignSupportAssetsLabel = req<HTMLElement>("assign-support-assets-label");
  const assignSupportAssetsList = req<HTMLElement>("assign-support-assets-list");
  const btnAssign = req<HTMLButtonElement>("btn-assign-mission");
  const assignRequirementsEl = req<HTMLElement>("assign-requirements");
  const assignRequirementsListEl = req<HTMLElement>("assign-requirements-list");
  const assignRequirementsTallyEl = req<HTMLElement>("assign-requirements-tally");
  const assignChanceEl = req<HTMLElement>("assign-chance");
  const assignChanceValueEl = req<HTMLElement>("assign-chance-value");
  const assignChanceNoteEl = req<HTMLElement>("assign-chance-note");
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
  const minionsPanelTitleEl = req<HTMLElement>("minions-panel-title");
  const lairPanelEl = req<HTMLElement>("lair-panel");
  const mapPanelEl = req<HTMLElement>("map-panel");
  const mapLayersPanelEl = req<HTMLElement>("map-layers-panel");
  /**
   * The map inspector's panes, in pane order (not slot order — a pane's slot moves). Each is a
   * whole panel; `renderSiteInspector` decides which subject each one holds and where it sits.
   */
  interface InspectorPane {
    readonly el: HTMLElement;
    readonly titleEl: HTMLElement;
    readonly bodyEl: HTMLElement;
    readonly closeEl: HTMLButtonElement;
    /** What this pane is currently showing, so a re-render can keep it where it already is. */
    subject: MapSubject | null;
  }
  const inspectorPanes: InspectorPane[] = Array.from(
    document.querySelectorAll<HTMLElement>("[data-inspector-pane]"),
  ).map((el) => {
    const titleEl = el.querySelector<HTMLElement>(".game-panel-title");
    const bodyEl = el.querySelector<HTMLElement>(".site-inspector-body");
    const closeEl = el.querySelector<HTMLButtonElement>("[data-inspector-close]");
    if (titleEl === null || bodyEl === null || closeEl === null) {
      throw new Error(`Malformed inspector pane: ${el.id}`);
    }
    return { el, titleEl, bodyEl, closeEl, subject: null };
  });
  if (inspectorPanes.length === 0) {
    throw new Error("No inspector panes in the markup");
  }
  /** How many cards fit along the top of the map — the markup's pane count is the cap. */
  const MAX_INSPECTOR_CARDS = inspectorPanes.length;
  const rightColumnsRowElLookup = document.querySelector<HTMLElement>(".game-ui-columns-row");
  if (rightColumnsRowElLookup === null) {
    throw new Error("Missing .game-ui-columns-row");
  }
  const rightColumnsRowEl = rightColumnsRowElLookup;
  if (!rightColumnsRowEl) {
    throw new Error("Missing .game-ui-columns-row");
  }
  const omegaBodyElLookup = document.querySelector<HTMLElement>(".omega-body");
  if (omegaBodyElLookup === null) {
    throw new Error("Missing .omega-body");
  }
  const omegaBodyEl: HTMLElement = omegaBodyElLookup;
  const menuButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-game-menu]"),
  );
  const menuPanels = Array.from(
    document.querySelectorAll<HTMLElement>("[data-menu-panel]"),
  );
  const panelMinimizeButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-panel-minimize]"),
  );
  /**
   * Which floating dashboard panels are minimized to their header, keyed by
   * `data-panel-minimize`. Kept across menu switches on purpose: a fullscreen menu ignores the
   * state (the CSS is scoped to the floating dashboard), and coming back to the dashboard
   * should find the panels the way they were left.
   *
   * The run opens with the whole tile band folded to its headers so the first thing on screen
   * is the map. The planner keeps its column — it is the only panel with a job to do before
   * anything has been looked at.
   */
  const collapsedPanels = new Set<string>(["omega", "minions", "locations", "lair"]);

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

  /**
   * What a map marker stands for. Every marker but one is a site; the odd one out is the
   * player's own lair, which has no location id to be known by and shows the Lair tile's
   * contents rather than a location card.
   */
  type MapSubject = { readonly kind: "site"; readonly locationId: string } | { readonly kind: "lair" };

  /** A subject flattened to something comparable, and the key its marker is cached under. */
  function mapSubjectKey(subject: MapSubject | null): string | null {
    if (subject === null) {
      return null;
    }
    return subject.kind === "lair" ? "lair" : `site:${subject.locationId}`;
  }

  /**
   * The map's site inspector. `hovered` is whichever marker the pointer (or keyboard focus) is
   * on right now; `pinned` is one a click parked there. Hover wins while it lasts so the map
   * stays browsable with a card pinned, and the pinned card is what it falls back to — only
   * closing the panel clears it.
   */
  let hoveredMapSubject: MapSubject | null = null;
  /**
   * The selected subjects, oldest first. The index into this list *is* the slot the card sits
   * in, counting leftward from the map's right corner — so a new selection goes on the end and
   * lands on the left, and dropping one from the middle shuffles everything after it one slot
   * to the right with no bookkeeping of its own.
   */
  let pinnedMapSubjects: MapSubject[] = [];

  function isPinnedMapSubject(subject: MapSubject | null): boolean {
    const key = mapSubjectKey(subject);
    return key !== null && pinnedMapSubjects.some((s) => mapSubjectKey(s) === key);
  }

  let locationsCategoryTab: LocationType = "economic";
  let lairPanelTab: DashboardLairTab = "missions";
  let resourcesPanelTab: ResourcesPanelTab = "roster";
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
      // The asset speaks for itself: no "Gain asset:" lead-in, just the same pill assets wear
      // everywhere else, with the line's tone marker saying it is gained.
      return effect.assetIds.map((id: string) => {
        const item = document.createElement("li");
        item.className = `mission-card-effects__item ${toneClass} mission-card-effects__item--assets`;
        item.appendChild(createAssetPillEl(catalog, id));
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
          item.appendChild(createAssetPillEl(catalog, id));
        });
        item.append(" from inventory, then gained ");
        effect.gainAssetIds.forEach((id: string, idx: number) => {
          if (idx > 0) item.append(", ");
          item.appendChild(createAssetPillEl(catalog, id));
        });
      } else if (hasRemove) {
        item.append("Removed up to ");
        effect.removeAssetIds.forEach((id: string, idx: number) => {
          if (idx > 0) item.append(", ");
          item.appendChild(createAssetPillEl(catalog, id));
        });
        item.append(" from inventory");
      } else if (hasGain) {
        item.append("Gained ");
        effect.gainAssetIds.forEach((id: string, idx: number) => {
          if (idx > 0) item.append(", ");
          item.appendChild(createAssetPillEl(catalog, id));
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

  /**
   * One stat effect as an icon + delta badge, or null when the effect names no stat — or when
   * its line no longer opens with that stat's label, in which case it stays an ordinary line.
   */
  function missionEffectStatChipEl(
    effect: MissionEffect,
    catalog: ReturnType<typeof loadContent>,
  ): HTMLElement | null {
    const stat = MISSION_EFFECT_STAT_BY_KIND[effect.kind];
    if (stat === undefined) {
      return null;
    }
    const prefix = `${MISSION_EFFECT_STAT_META[stat].label} `;
    const lines = describeMissionEffect(effect, catalog);
    const line = lines.length === 1 ? lines[0] : undefined;
    if (line === undefined || !line.startsWith(prefix)) {
      return null;
    }
    return createMissionEffectStatBadgeEl(stat, line.slice(prefix.length));
  }

  /**
   * List items for one outcome list. Every stat effect collapses into a single line of stat
   * badges, sitting where the first of them fell in {@link orderedMissionEffects} order; the
   * rest keep one line each.
   */
  function missionEffectListItemEls(
    effects: readonly MissionEffect[],
    catalog: ReturnType<typeof loadContent>,
    tone: "good" | "bad",
  ): HTMLElement[] {
    const toneClass =
      tone === "good" ? "mission-card-effects__item--good" : "mission-card-effects__item--bad";
    const items: HTMLElement[] = [];
    let statItem: HTMLElement | null = null;

    for (const effect of effects) {
      const chip = missionEffectStatChipEl(effect, catalog);
      if (chip === null) {
        items.push(...renderMissionEffectItemEls(effect, catalog, tone));
        continue;
      }
      if (statItem === null) {
        statItem = document.createElement("li");
        statItem.className = `mission-card-effects__item ${toneClass} mission-card-effects__item--stats`;
        items.push(statItem);
      }
      statItem.appendChild(chip);
    }

    return items;
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
      for (const item of missionEffectListItemEls(successEffects, catalog, "good")) {
        list.appendChild(item);
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
      for (const item of missionEffectListItemEls(failureEffects, catalog, "bad")) {
        list.appendChild(item);
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

  /**
   * The site a mission stages itself at, when it only accepts one and so has no choice to offer.
   *
   * Only `location` targets qualify. For an asset or minion mission `targetLocationIds` narrows
   * which site the target may be found at, which is not the same as naming the target itself —
   * the player still has to pick the slot or the minion.
   */
  function autoTargetForMission(mission: MissionTemplate): MissionTarget | null {
    if (mission.targetType !== "location") {
      return null;
    }
    const ids = mission.targetLocationIds ?? [];
    if (ids.length !== 1) {
      return null;
    }
    const locationId = ids[0]!;
    /* The active omega plan decides which sites are in play, and a mission can name one this run
     * does not include; staging a target that is not on the map would strand the plan. */
    if (!runLocations().some((loc) => loc.id === locationId)) {
      return null;
    }
    const target: MissionTarget = { kind: "location", locationId };
    return targetPassesMissionLocationFilters(mission, target) ? target : null;
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
    if (assignTarget !== null) {
      if (
        !missionTargetMatchesTemplate(m.targetType, assignTarget) ||
        !targetPassesMissionLocationFilters(m, assignTarget)
      ) {
        assignTarget = null;
      }
    }
    if (assignTarget === null) {
      assignTarget = autoTargetForMission(m);
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

  /**
   * Prompt for an empty target slot. Everything the mission asks of its target is said here —
   * the sites it accepts, or failing that the kind of thing it wants — so the field label above
   * can stay the plain "Target" it is in the markup.
   */
  function assignTargetPlaceholderText(): string {
    const generic = "Drag location, asset slot, or minion";
    const m = selectedMissionTemplate();
    if (!m || m.targetType === "none") {
      return generic;
    }
    const siteFilters = missionTargetTypeTargetsLocation(m.targetType)
      ? formatTargetLocationFilters(m, targetLocationDisplayName)
      : null;
    if (siteFilters !== null) {
      return `Drag ${siteFilters}`;
    }
    const byType: Record<MissionTargetType, string> = {
      location: "Drag a location",
      asset_hidden: "Drag a hidden asset slot",
      asset_revealed: "Drag a revealed asset slot",
      minion: "Drag a minion",
      none: generic,
    };
    return byType[m.targetType];
  }

  function onAssignSlotsChanged(): void {
    syncAssignButtonState();
    /* The map reads the staged plan too — the targeted pin, the glow under it, and the lean of
     * the camera all come from `assignTarget`. Before this, staging a target left the map
     * showing the previous one until something else forced a render, which is why the
     * `map-marker--targeted` styling never appeared on a plain pin click. */
    renderMapPanel();
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

  /** Catalog name for a site pinned by `targetLocationIds`; unknown ids show as the raw id. */
  function targetLocationDisplayName(locationId: string): string {
    return getLocationById(content, locationId)?.name ?? locationId;
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
    /* Odds first — that is the question the number on the button is answering. The derivation
     * below it explains where the success chance came from. */
    const lines: string[] = [...missionOutcomeOddsTooltipLines(breakdown.finalPercent), ""];
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
   * The three-way odds behind one success chance — what the player is really buying when they
   * move the number. The compromised band sits directly above the success chance
   * (`balance.compromisedBandPercent` points wide, clipped by the 100% ceiling), and a mission
   * that lands in it takes the success effects *and* the failure effects.
   */
  function missionOutcomeOddsTooltipLines(chancePercent: number): string[] {
    const odds = missionOutcomeChances(chancePercent, content.balance.compromisedBandPercent);
    const lines = [
      "Outcome odds",
      `  Success: ${odds.successPercent}%`,
      `  Compromised: ${odds.compromisedPercent}%`,
      `  Failure: ${odds.failurePercent}%`,
    ];
    if (odds.compromisedPercent > 0) {
      lines.push(
        "Compromised = a near miss (within " +
          `${content.balance.compromisedBandPercent} points of success): the mission applies ` +
          "both its success and its failure effects, and still counts as a completed Omega " +
          "Plan mission.",
      );
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
        ph.textContent = `Drag a ${name}`;
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
   * The optional support-asset slots, one per `player.maxSupportAssets`. Unlike required slots
   * these are not tied to the planned mission — any owned asset with a `supportAbility` fits any
   * slot — so the row stands on its own and does not wait for a mission to be staged. The only
   * thing that hides it is a cap of zero, where there would be no slots to draw.
   */
  function renderAssignSupportAssets(): void {
    assignSupportAssetsList.innerHTML = "";
    syncAssignSupportSlotArray();
    const cap = assignSupportAssetIds.length;
    if (cap === 0) {
      assignSupportAssetsFieldset.hidden = true;
      renderLairPanel();
      return;
    }
    assignSupportAssetsFieldset.hidden = false;
    assignSupportAssetsLabel.textContent = "Support";
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
        ph.textContent = "Drag a support asset";
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
        /* The effect used to wrap onto a second line, which made a filled support slot taller
         * than the empty one it replaced. It moves to the hover text instead, like every other
         * collapsed chip in this column. */
        if (tpl?.supportAbility !== undefined) {
          chip.title = describeSupportAssetAbility(tpl.supportAbility);
        }

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

  /**
   * Floating full-card preview for a collapsed pick slot.
   *
   * A staged mission or target only shows a thumbnail and a name in the plan column, which keeps
   * the column short enough that Target, Minions and the success gauge all stay on screen. The
   * card the player actually dropped is parked off-slot and floated beside the chip on hover.
   *
   * The layer lives on `document.body`, not inside the slot: every panel between here and the
   * stage clips its overflow, and a card that is six times the height of its chip would be cut
   * off. The cost is that it sits outside the scaled stage and has to re-apply `--ui-scale`
   * itself.
   */
  let assignPickPreviewEl: HTMLElement | null = null;

  function assignPickPreviewLayer(): HTMLElement {
    if (assignPickPreviewEl === null) {
      const el = document.createElement("div");
      el.className = "assign-pick-preview";
      el.hidden = true;
      document.body.appendChild(el);
      assignPickPreviewEl = el;
      /* The preview is anchored to a rect measured once, so anything that can move the chip out
       * from under it drops it rather than leaving it floating in the wrong place. */
      document.addEventListener("pointerdown", hideAssignPickPreview, { passive: true });
      window.addEventListener("scroll", hideAssignPickPreview, { capture: true, passive: true });
    }
    return assignPickPreviewEl;
  }

  function hideAssignPickPreview(): void {
    if (assignPickPreviewEl === null) {
      return;
    }
    assignPickPreviewEl.hidden = true;
    assignPickPreviewEl.replaceChildren();
  }

  function showAssignPickPreview(anchor: HTMLElement, card: HTMLElement): void {
    const layer = assignPickPreviewLayer();
    layer.replaceChildren(card);
    layer.hidden = false;
    const shell = document.querySelector(".omega-shell");
    const scale = shell === null ? 1 : shell.getBoundingClientRect().width / STAGE_WIDTH;
    layer.style.transform = `scale(${scale})`;
    /* Measured after the transform, so these are on-screen pixels either way. */
    const rect = anchor.getBoundingClientRect();
    const box = layer.getBoundingClientRect();
    const margin = 8;
    let left = rect.right + margin;
    if (left + box.width > window.innerWidth - margin) {
      /* No room to the right of the plan column: flip to the other side of the chip. */
      left = Math.max(margin, rect.left - margin - box.width);
    }
    const top = Math.max(margin, Math.min(rect.top, window.innerHeight - box.height - margin));
    layer.style.left = `${Math.round(left)}px`;
    layer.style.top = `${Math.round(top)}px`;
  }

  /** Makes `chip` float `card` beside itself on hover or keyboard focus. */
  function attachAssignPickPreview(chip: HTMLElement, card: HTMLElement): void {
    chip.addEventListener("mouseenter", () => {
      showAssignPickPreview(chip, card);
    });
    chip.addEventListener("mouseleave", hideAssignPickPreview);
    chip.addEventListener("focus", () => {
      showAssignPickPreview(chip, card);
    });
    chip.addEventListener("blur", hideAssignPickPreview);
    chip.addEventListener("dragstart", hideAssignPickPreview);
  }

  /**
   * The collapsed form of a staged mission or target. It takes over the drag affordance the
   * embedded card used to carry, and reveals `card` on hover or keyboard focus.
   */
  function buildAssignPickChip(
    artSrc: string,
    label: string,
    card: HTMLElement,
    canDrag: boolean,
    onDragStart: (e: DragEvent) => void,
  ): HTMLElement {
    const chip = document.createElement("div");
    chip.className = "assign-pick-chip";
    chip.tabIndex = 0;
    chip.draggable = canDrag;
    chip.addEventListener("dragstart", onDragStart);
    chip.appendChild(createCardArtImg(artSrc, "card-art--chip"));
    const name = document.createElement("span");
    name.className = "assign-pick-chip-label";
    name.textContent = label;
    chip.appendChild(name);
    attachAssignPickPreview(chip, card);
    return chip;
  }

  function renderAssignPickSlots(): void {
    hideAssignPickPreview();
    assignMissionSlotEl.innerHTML = "";
    assignTargetSlotEl.innerHTML = "";
    updateAssignTargetFieldVisibility();
    const mainOnly = state.phase === "main";
    const mTpl = selectedMissionTemplate();
    const hideTargetField = mTpl?.targetType === "none";

    const missionSlot = document.createElement("div");
    missionSlot.className = "assign-pick-slot-inner";
    if (assignMissionTemplateId === null) {
      const ph = document.createElement("span");
      ph.className = "assign-minion-slot-placeholder";
      ph.textContent = "Drag a mission";
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
      article.classList.add("assign-pick-preview-card");
      wrap.appendChild(
        buildAssignPickChip(
          resolveMissionCardArt(missionTpl),
          missionTpl?.name ?? assignMissionTemplateId,
          article,
          mainOnly,
          (e) => {
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
          },
        ),
      );

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
      ph.textContent = assignTargetPlaceholderText();
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
        article.classList.add("assign-pick-preview-card");
        wrap.appendChild(
          buildAssignPickChip(
            resolveLocationCardArt(loc),
            loc.name,
            article,
            mainOnly,
            setDragDataForTarget,
          ),
        );
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
      article.className = "assign-pick-preview-card location-card assign-target-asset-card";
      const { meta, body } = appendCardHeroShell(article, resolveLocationCardArt(loc));
      const title = document.createElement("h4");
      title.className = "location-card-title";
      title.textContent = loc?.name ?? targetPick.locationId;
      meta.appendChild(title);
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
      wrap.appendChild(
        buildAssignPickChip(
          resolveLocationCardArt(loc),
          `${loc?.name ?? targetPick.locationId} - Slot ${targetPick.slotIndex + 1}`,
          article,
          mainOnly,
          setDragDataForTarget,
        ),
      );
      appendClearTarget(wrap);
      targetSlot.appendChild(wrap);
    } else if (targetPick.kind === "minion") {
      const inst = state.player.minions.find((x) => x.instanceId === targetPick.instanceId);
      const tpl = inst
        ? content.minions.find((t) => t.id === inst.templateId)
        : undefined;
      const wrap = document.createElement("div");
      wrap.className = "assign-pick-slot-card-wrap";
      wrap.appendChild(
        buildAssignPickChip(
          resolveMinionCardArt(tpl),
          tpl?.name ?? targetPick.instanceId,
          buildMinionPreviewArticle(inst, targetPick.instanceId),
          mainOnly,
          setDragDataForTarget,
        ),
      );
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

  /**
   * Everything the staged plan is being scored against, gathered from the four places the
   * success formula pulls from: the mission template, the target site, that site's revealed
   * security, and the challenge traits of agents standing on it.
   *
   * `counts` marks the requirements that feed the base ratio (matched / total). Challenge traits
   * are left out of it because they are a flat penalty rather than a term in the ratio, and the
   * tally over the gauge would otherwise disagree with the arithmetic it is explaining.
   */
  type PlanRequirement = {
    id: string;
    kind: "trait" | "security" | "asset";
    met: boolean;
    counts: boolean;
    /** Leaving this unmet costs success outright, rather than merely failing to add any. */
    penalty: boolean;
    /** Neutralised by a committed support asset, so it is scored as if it were not there. */
    ignored: boolean;
  };

  type PlanRequirementGroup = {
    label: string;
    hint: string;
    items: PlanRequirement[];
  };

  function stagedRequirementGroups(): PlanRequirementGroup[] | null {
    const mission =
      assignMissionTemplateId === null
        ? undefined
        : findMissionOrEventTemplate(assignMissionTemplateId);
    if (mission === undefined) {
      return null;
    }
    const instanceById = new Map(state.player.minions.map((m) => [m.instanceId, m] as const));
    const participants = getAssignParticipantIds()
      .map((id) => instanceById.get(id))
      .filter((x): x is MinionInstance => x !== undefined);
    const held = unionParticipantTraitIds(participants);

    const supportAbilities = supportAbilitiesForAssetIds(stagedSupportAssetIds(), content.assets);
    const ignoreSecurity = hasSupportAbility(supportAbilities, "ignore_security_traits");
    const ignoreChallenge = hasSupportAbility(supportAbilities, "ignore_agent_challenge_traits");

    /* Site-derived groups only apply once the target is one the mission would actually accept,
     * which is the same gate stagedSuccessChance() uses before it will quote a number. */
    const targetOk =
      mission.targetType === "none"
        ? false
        : assignTarget !== null &&
          missionTargetMatchesTemplate(mission.targetType, assignTarget) &&
          targetPassesMissionLocationFilters(mission, assignTarget);
    const lid = targetOk && assignTarget !== null ? getMissionTargetLocationId(assignTarget) : null;

    const traitItem = (
      id: string,
      kind: "trait" | "security",
      ignored: boolean,
    ): PlanRequirement => ({
      id,
      kind,
      met: ignored || held.has(id),
      counts: !ignored,
      penalty: false,
      ignored,
    });

    const groups: PlanRequirementGroup[] = [];

    if (mission.requiredTraitIds.length > 0) {
      groups.push({
        label: "",
        hint: "Traits the mission itself asks for. Any one participant holding it covers it.",
        items: sortedTraitIdsForDisplay(content, mission.requiredTraitIds).map((id) =>
          traitItem(id, "trait", false),
        ),
      });
    }

    if (lid !== null) {
      const siteIds = state.locationRequiredTraits[lid] ?? [];
      if (siteIds.length > 0) {
        groups.push({
          label: "Site",
          hint: "Traits this location demands of anyone working it.",
          items: sortedTraitIdsForDisplay(content, siteIds).map((id) => traitItem(id, "trait", false)),
        });
      }
      const securityIds = revealedSecurityTraitIds(state, lid);
      if (securityIds.length > 0) {
        groups.push({
          label: "Security",
          hint: ignoreSecurity
            ? "Security traits uncovered here, neutralised by a committed support asset."
            : "Security traits uncovered here. Each counts as a requirement like any other.",
          items: sortedTraitIdsForDisplay(content, securityIds).map((id) =>
            traitItem(id, "security", ignoreSecurity),
          ),
        });
      }
      const challengeIds = challengeTraitIdsForAgents(
        playerVisibleOpposingAgentsAtLocation(state, lid),
      );
      if (challengeIds.length > 0) {
        groups.push({
          label: "Agents",
          hint: ignoreChallenge
            ? "Challenge traits of the agents here, shrugged off by a committed support asset."
            : "Challenge traits of the agents here. Each one no participant matches costs -"
              + String(content.balance.agentChallengeTraitPenalty)
              + "% success.",
          items: sortedTraitIdsForDisplay(content, challengeIds).map((id) => ({
            id,
            kind: "trait" as const,
            met: ignoreChallenge || held.has(id),
            counts: false,
            penalty: true,
            ignored: ignoreChallenge,
          })),
        });
      }
    }

    if (mission.requiredAssetIds.length > 0) {
      syncAssignAssetSlotArrayWithMission();
      groups.push({
        label: "",
        hint: "One slot per required asset. A slot counts only once it holds that exact asset.",
        items: mission.requiredAssetIds.map((id, i) => ({
          id,
          kind: "asset" as const,
          met: assignAssetSlotAssetIds[i] === id,
          counts: true,
          penalty: false,
          ignored: false,
        })),
      });
    }

    return groups;
  }

  /**
   * The requirements checklist above the gauge. It exists to make the number legible: every pill
   * here is a term in the success arithmetic, lit once the staged minions and assets cover it.
   */
  function renderAssignRequirements(): void {
    assignRequirementsListEl.replaceChildren();
    const groups = state.phase === "main" ? stagedRequirementGroups() : null;
    /* Nothing to explain means nothing to show: an empty checklist is just a box between the
     * plan and the gauge it is supposed to be annotating. */
    if (groups === null || groups.length === 0) {
      assignRequirementsEl.hidden = true;
      assignRequirementsTallyEl.textContent = "";
      assignRequirementsTallyEl.classList.remove("plan-reqs__tally--all");
      return;
    }
    assignRequirementsEl.hidden = false;

    /* The label column is only worth reserving when something is actually named in it —
     * otherwise a mission with no site groups reads as indented for no reason. */
    assignRequirementsListEl.classList.toggle(
      "plan-reqs__list--unlabelled",
      !groups.some((g) => g.label !== ""),
    );

    const scored = groups.flatMap((g) => g.items).filter((i) => i.counts);
    const met = scored.filter((i) => i.met).length;
    assignRequirementsTallyEl.textContent =
      scored.length === 0 ? "" : String(met) + "/" + String(scored.length) + " met";
    assignRequirementsTallyEl.classList.toggle(
      "plan-reqs__tally--all",
      scored.length > 0 && met === scored.length,
    );

    for (const group of groups) {
      const row = document.createElement("div");
      row.className = "plan-reqs__group";

      const label = document.createElement("span");
      label.className = "plan-reqs__group-label";
      if (group.label !== "") {
        label.textContent = group.label;
        label.title = group.hint;
      }
      row.appendChild(label);

      const pills = document.createElement("div");
      pills.className = "plan-reqs__pills";
      for (const item of group.items) {
        /* createTraitPillEl takes the set of trait ids the roster holds; passing the item's own
         * id is how a single pill is told it is covered. */
        const pill =
          item.kind === "asset"
            ? createAssetPillEl(content, item.id, item.met)
            : createTraitPillEl(
                content,
                item.id,
                item.met ? new Set([item.id]) : new Set<string>(),
                item.kind === "security" ? "security" : "trait",
              );
        if (item.ignored) {
          pill.classList.add("plan-reqs__pill--ignored");
        } else if (item.penalty && !item.met) {
          pill.classList.add("plan-reqs__pill--penalty");
        }
        pills.appendChild(pill);
      }
      row.appendChild(pills);
      assignRequirementsListEl.appendChild(row);
    }
  }

  /** One-word read on the odds, so the gauge says something even at a glance. */
  function successChanceNote(pct: number): string {
    if (pct <= 0) return "Hopeless";
    if (pct < 40) return "Long shot";
    if (pct < 70) return "Even money";
    if (pct < 90) return "Favoured";
    return "All but certain";
  }

  /**
   * The success-chance gauge above Submit. Unlike the old in-button badge it never hides: with no
   * staged plan it holds a grey, empty ring so the player knows where the number will appear. A
   * real 0% reads the same grey — there is nothing to sell either way.
   */
  function syncAssignChanceGauge(): void {
    const staged = state.phase === "main" ? stagedSuccessChance() : null;
    const pct = staged === null ? 0 : staged.breakdown.finalPercent;
    assignChanceEl.style.setProperty("--chance", String(pct));
    assignChanceEl.classList.toggle("plan-chance--live", staged !== null);
    assignChanceEl.classList.toggle("plan-chance--warn", pct > 0 && pct < 40);
    assignChanceEl.classList.toggle("plan-chance--mid", pct >= 40 && pct < 70);
    assignChanceEl.classList.toggle("plan-chance--good", pct >= 70);
    if (staged === null) {
      assignChanceValueEl.textContent = "--";
      assignChanceNoteEl.textContent = "No plan staged";
      assignChanceEl.title = "Stage a mission, target and minions to see the odds.";
      return;
    }
    /* The digits carry the reading, so they get the size; the sign rides along small enough
     * that a three-digit 100% still clears the ring. */
    const digits = document.createElement("span");
    digits.className = "plan-chance__value-num";
    digits.textContent = String(pct);
    const sign = document.createElement("span");
    sign.className = "plan-chance__value-pct";
    sign.textContent = "%";
    assignChanceValueEl.replaceChildren(digits, sign);
    assignChanceNoteEl.textContent = successChanceNote(pct);
    assignChanceEl.title = formatMissionSuccessChanceTooltipLines(
      staged.breakdown,
      staged.dynamicEntries,
      state.player.minions,
    ).join("\n");
  }

  function syncAssignButtonState(): void {
    renderAssignRequirements();
    syncAssignChanceGauge();
    applyAssignButtonEnabled();
    /* A startable plan is the one click that matters on this panel, so Submit borrows Execute's
     * treatment — same primary fill, same pulse — and drops back to a plain button the moment
     * anything about the plan stops it from starting. */
    const ready = !btnAssign.disabled;
    btnAssign.classList.toggle("btn-primary", ready);
    btnAssign.classList.toggle("btn-submit-mission--ready", ready);
  }

  /** The gate itself: sets `disabled` and the reason, one early return per blocking condition. */
  function applyAssignButtonEnabled(): void {
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
        btnAssign.title = `Target site does not meet: ${formatTargetLocationFilters(missionTemplate, targetLocationDisplayName) ?? "this mission's requirements"}`;
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

  /**
   * The roster card for a staged minion, minus the fire button — the preview a collapsed
   * participant chip floats on hover. Traits live here now rather than on the chip itself, which
   * is what keeps the Minions field to one line per slot.
   */
  function buildMinionPreviewArticle(inst: MinionInstance | undefined, instanceId: string): HTMLElement {
    const tpl = inst ? content.minions.find((t) => t.id === inst.templateId) : undefined;
    const card = document.createElement("article");
    card.className = "minions-card assign-pick-preview-card";
    const body = appendCardArtShell(card, resolveMinionCardArt(tpl));
    const title = document.createElement("h4");
    title.className = "minions-card-title";
    title.textContent = tpl?.name ?? instanceId;
    body.appendChild(title);
    const statsRow = createMinionsCardStatsRow({
      cpCost: tpl?.hireCommandPoints ?? "-",
      level: inst?.currentLevel ?? 0,
      xp: inst?.currentExperience ?? 0,
    });
    if (inst !== undefined) {
      appendMinionTraits(statsRow, content, inst.traitIds, {
        roster: state.player.minions,
        traits: inst.dynamicTraits,
      });
    }
    body.appendChild(statsRow);
    return card;
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
        ph.textContent = "Drag a minion";
        slot.appendChild(ph);
      } else {
        const inst = state.player.minions.find((m) => m.instanceId === instanceId);
        const tpl = inst
          ? content.minions.find((t) => t.id === inst.templateId)
          : undefined;
        const chip = document.createElement("div");
        chip.className = "assign-minion-chip";
        chip.draggable = mainOnly && !busy.has(instanceId);
        chip.dataset.instanceId = instanceId;
        chip.tabIndex = 0;

        chip.appendChild(createCardArtImg(resolveMinionCardArt(tpl), "card-art--chip"));

        const chipMain = document.createElement("div");
        chipMain.className = "assign-minion-chip-main";

        const chipLabel = document.createElement("span");
        chipLabel.className = "assign-minion-chip-label";
        chipLabel.textContent = tpl?.name ?? instanceId;
        chipMain.appendChild(chipLabel);

        chip.appendChild(chipMain);
        attachAssignPickPreview(chip, buildMinionPreviewArticle(inst, instanceId));

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

    const { meta, body } = appendCardHeroShell(article, resolveMissionCardArt(mission));

    const title = document.createElement("h4");
    title.className = "asset-card-title";
    title.textContent = mission?.name ?? missionId;
    meta.appendChild(title);

    if (mission?.description) {
      const desc = document.createElement("p");
      desc.className = "asset-card-description";
      desc.textContent = mission.description;
      body.appendChild(desc);
    }

    if (mission) {
      const siteFilters = missionTargetTypeTargetsLocation(mission.targetType)
        ? formatTargetLocationFilters(mission, targetLocationDisplayName)
        : null;
      const targetTypeLabel = formatMissionTargetTypeLabel(mission.targetType);
      // A mission pinned to specific sites already names them, so the generic "Location"
      // prefix adds nothing — show the site filters on their own.
      const dropTargetTypeLabel =
        mission.targetType === "location" && (mission.targetLocationIds?.length ?? 0) > 0;
      const targetValue =
        siteFilters === null
          ? targetTypeLabel
          : dropTargetTypeLabel
            ? siteFilters
            : `${targetTypeLabel} - ${siteFilters}`;

      const statsRow = createMissionCardStatsRow({
        target: targetValue,
        cpCost: mission.startCommandPoints,
        duration: mission.durationTurns,
      });

      meta.appendChild(statsRow);

      /* Requirement pills stay under the art: they wrap to any number of lines, which would
       * push the name off the top of a fixed-height banner. */
      const traitIdsForDisplay =
        mergedRequiredTraitIdsForDisplay !== undefined
          ? mergedRequiredTraitIdsForDisplay
          : mission.requiredTraitIds;
      const rosterTraitIds = unionParticipantTraitIds(state.player.minions);
      appendRequiredMissionRequirementPills(
        body,
        content,
        traitIdsForDisplay,
        rosterTraitIds,
        mission.requiredAssetIds,
        state.player.assets,
      );

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

    const { meta, body } = appendCardHeroShell(article, resolveLocationCardArt(loc));

    const title = document.createElement("h4");
    title.className = "location-card-title";
    title.textContent = loc.name;
    meta.appendChild(title);

    const statsRow = createLocationCardStatsRow({
      type: formatLocationTypeLabel(loc.locationType),
      level: loc.locationLevel,
      securityLevel: securityLevel !== undefined ? String(securityLevel) : "—",
      intelLevel: intelLevel,
    });
    meta.appendChild(statsRow);

    /* The trait pills stay under the art: they wrap to any number of lines, which would push
     * the name off the top of a fixed-height banner. */
    const revealedSecIds = locationSecurityTraitIds.slice(
      0,
      Math.min(securityLevel ?? 0, locationSecurityTraitIds.length),
    );
    const rosterTraitIds = unionParticipantTraitIds(state.player.minions);
    appendLocationRequirementPills(
      body,
      content,
      siteRequiredTraitIds,
      revealedSecIds,
      rosterTraitIds,
    );

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
        chip.className =
          knowledge === "identified"
            ? "location-asset-drag-chip location-asset-drag-chip--revealed"
            : "location-asset-drag-chip location-asset-drag-chip--hidden";
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
        wrap.className =
          knowledge === "identified"
            ? "location-asset-static location-asset-static--revealed"
            : "location-asset-static location-asset-static--hidden";
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
          ? "location-asset-drag-chip location-asset-drag-chip--unknown"
          : "location-asset-static location-asset-static--unknown";
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
    /* The dashboard tile gathers assets alongside the roster, so it is titled for all of them;
     * the fullscreen menu behind the nav button is still just the minions. */
    minionsPanelTitleEl.textContent = currentMenu === "minions" ? "Minions" : "Resources";
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

    function buildAssetsSection(): HTMLElement {
      const section = document.createElement("section");
      section.className = "minions-panel-section";
      section.setAttribute("aria-label", "Owned assets");

      const ownedKinds = Object.values(state.player.assets).filter((qty) => qty > 0).length;
      const heading = document.createElement("h3");
      heading.id = "minions-assets-heading";
      heading.className = "game-controls-heading";
      heading.textContent = `Owned assets (${ownedKinds})`;
      section.appendChild(heading);

      const list = document.createElement("div");
      list.id = "minions-assets-list";
      list.className = "minions-panel-list";
      fillAssetsInto(list);
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
    tablist.setAttribute("aria-label", "Resources sections");

    for (const def of DASHBOARD_RESOURCES_TABS) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "minions-panel-tab";
      if (def.id === resourcesPanelTab) {
        tab.classList.add("minions-panel-tab--active");
      }
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", def.id === resourcesPanelTab ? "true" : "false");
      tab.id = `minions-panel-tab-${def.id}`;
      tab.textContent = def.label;
      tab.addEventListener("click", () => {
        if (resourcesPanelTab === def.id) {
          return;
        }
        resourcesPanelTab = def.id;
        renderMinionsPanel();
      });
      tablist.appendChild(tab);
    }
    minionsPanelEl.appendChild(tablist);

    const activePage =
      resourcesPanelTab === "roster"
        ? buildRosterSection(false)
        : resourcesPanelTab === "hire"
          ? buildHireSection(false)
          : buildAssetsSection();
    activePage.setAttribute("role", "tabpanel");
    activePage.setAttribute("aria-labelledby", `minions-panel-tab-${resourcesPanelTab}`);
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
          : null;
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
    outcomeKind: "complete" | "compromised" | "failed" | "locked";
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
          outcomeLabel: missionOutcomeLabel(ev.result),
          outcomeKind:
            ev.result === "success"
              ? "complete"
              : ev.result === "compromised"
                ? "compromised"
                : "failed",
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
   * Hover text for a map callout: which operation is running at this site, how far along it is,
   * and who is on it. The same facts the Missions menu card carries, minus the planning detail.
   */
  function missionCalloutTooltipLines(am: ActiveMission): string[] {
    const mission = findMissionOrEventTemplate(am.missionTemplateId);
    const crewNames = missionCalloutParticipants(am).map(
      (inst) => content.minions.find((t) => t.id === inst.templateId)?.name ?? inst.templateId,
    );
    const lines = [
      mission?.name ?? am.missionTemplateId,
      `Target: ${formatMissionTargetSummary(am.target)}`,
    ];
    if (mission !== undefined) {
      lines.push(
        `${am.turnsRemaining} / ${mission.durationTurns} turn${
          mission.durationTurns === 1 ? "" : "s"
        } remaining`,
      );
    }
    lines.push(`Crew: ${crewNames.length > 0 ? crewNames.join(", ") : "—"}`);
    return lines;
  }

  /** Roster order, not assign order, so the same crew always reads the same way. */
  function missionCalloutParticipants(am: ActiveMission): MinionInstance[] {
    return state.player.minions.filter((inst) =>
      am.participantInstanceIds.includes(inst.instanceId),
    );
  }

  /**
   * A running operation pinned to its target site: portraits of the crew on it, with the mission
   * itself on hover. One per active mission, so a site running two operations stacks two.
   */
  function createMissionCalloutEl(am: ActiveMission): HTMLElement {
    const callout = document.createElement("div");
    callout.className = "map-callout";
    callout.dataset.activeMissionId = am.id;
    callout.tabIndex = 0;
    callout.setAttribute("role", "img");
    const tipLines = missionCalloutTooltipLines(am);
    callout.title = tipLines.join("\n");
    callout.setAttribute("aria-label", tipLines.join(". "));

    const crew = missionCalloutParticipants(am);
    if (crew.length === 0) {
      /* Unmanned operations still deserve a pin: show the marker, not an empty box. */
      const solo = document.createElement("span");
      solo.className = "map-callout__nocrew";
      solo.textContent = "—";
      callout.appendChild(solo);
    } else {
      for (const inst of crew) {
        const tpl = content.minions.find((t) => t.id === inst.templateId);
        callout.appendChild(
          createCardArtImg(resolveMinionCardArt(tpl), "map-callout__portrait"),
        );
      }
    }
    return callout;
  }

  /**
   * Everything that has to stay glued to a spot on the art, paired with the point it was
   * plotted from. The projector owns the placement now (see `ui/map/projection`), so nothing
   * here is positioned by CSS percentages; `renderMapPanel` rebuilds this list and
   * `syncMapProjection` replays it whenever the plot changes size — and, once the art
   * underneath is animated, once per frame.
   *
   * A bare point rather than a `MapMarker`: the player's lair rides this list too, and it is
   * plotted from its own template rather than from a site marker.
   */
  interface ProjectedMapEl {
    readonly el: HTMLElement;
    readonly marker: MarkerPoint;
  }
  let mapProjectedEls: ProjectedMapEl[] = [];
  let mapPlotEl: HTMLElement | null = null;
  /**
   * The leader line tying the inspected site to the Site Detail panel, and the lookup that
   * finds the marker to draw it from. The line is redrawn with the pins rather than with the
   * card: the site under it drifts with the camera every frame, the panel does not.
   */
  let mapLeaderLineEls: SVGLineElement[] = [];
  let mapMarkersBySubject = new Map<string, MarkerPoint>();
  /**
   * Where the line lands on the panel, in the plot's own pre-scale pixels. Cached because it
   * only moves when something is laid out — see `refreshMapLeaderAnchor` for why it is read
   * from offsets rather than from a client rect.
   */
  let mapLeaderAnchors: ({ x: number; y: number } | null)[] = [];
  /* Survives a re-render on purpose: this is the panel's size, not the plot element's
   * identity, and reusing it spares the first sync the rounded `offsetWidth` fallback. */
  let mapPlotSize: PlotSize | null = null;

  /**
   * The GPU map. Created once per art URL and deliberately **not** rebuilt by `renderMapPanel`
   * — that function runs on every state change and starts by emptying the panel, so building a
   * context there would burn through the browser's cap on live WebGL contexts within a few
   * turns. Only its canvas is re-parented into each new plot.
   */
  let mapRenderer: MapPlaneRenderer | null = null;
  let mapRendererArt: string | null = null;
  /** Set once this run has given up on WebGL, so a fallback is never retried into a loop. */
  let mapRendererDisabled = false;
  /**
   * The camera the plane is drawn with and the pins are placed by, in that order of authority.
   * Rebuilt every frame while the map is animating; the pins read `mapCamera.land` through
   * `createMatrixProjector`, which is what keeps them on their sites through the drift.
   */
  /* The resting frame, used only until the first `updateMapCamera`: every plane flat and no
   * depth for the haze to work with, which is the same nothing a `tilt: 0` camera reports. */
  let mapCamera: MapCameraFrame = {
    land: flatMapMatrix(),
    grid: flatMapMatrix(),
    atmosphere: flatMapMatrix(),
    depth: { near: 1, far: 1 },
  };
  let mapProjector: MapProjector = createFlatProjector();
  /** When the map view opened, so the drift starts from rest rather than mid-swing. */
  let mapEpochMs: number | null = null;
  let mapTimeSeconds = 0;
  let mapLastFrameMs: number | null = null;

  /** What each lit site is saying, rebuilt from game state on every render. */
  let mapSignals: readonly MapSiteSignal[] = [];

  /**
   * What the plot is allowed to draw, from the Map Layers panel.
   *
   * A player preference rather than run state, so it is parked in `localStorage` and outlives
   * the run — and deliberately kept out of `GameState`, which is the rules' data and gets
   * rebuilt every time a run starts.
   */
  let mapLayers: MapLayerState = loadMapLayers(
    typeof localStorage === "undefined" ? null : localStorage,
  );
  /** The panel's own checkboxes, so a state change can push itself back onto them. */
  const mapLayerInputs = new Map<MapLayerKey, HTMLInputElement>();
  /**
   * The reticle that snaps to whatever the pointer is over, and the marker it is currently on.
   *
   * Held apart from `mapProjectedEls` because everything in that list is pinned to one marker
   * for the life of the plot, and this is the one element whose subject changes without the
   * panel being rebuilt. It is projected alongside them rather than by them.
   */
  let mapReticleEl: HTMLElement | null = null;
  let mapReticleReadoutEl: HTMLElement | null = null;
  /* A bare point, like `mapProjectedEls` and for the same reason: the lair can be hovered
   * too, and it is plotted from its own template rather than from a site marker. */
  let mapReticleMarker: MarkerPoint | null = null;
  /** The console clock, written only when its displayed second changes. */
  let mapClockEl: HTMLElement | null = null;
  let mapClockShown = "";

  /* Where the lair sits, for the rings the renderer puts around it. Held here rather than read
   * from content at draw time because a run need not have a lair, or the lair need not be
   * plotted, and the draw loop should not have to know either. */
  let mapLairPoint: { readonly u: number; readonly v: number } | null = null;

  /**
   * Where the camera is leaning, and where it is being asked to lean.
   *
   * Kept apart so the lean can be eased rather than snapped: staging a target should draw the
   * eye, and a map that jumps to a new angle the instant a card is dropped reads as a glitch.
   * The eased pair also handles the target *changing* mid-lean, which a single value could not.
   */
  let mapFocusGoal: { u: number; v: number } | null = null;
  let mapFocus: MapCameraFocus = { u: 0.5, v: 0.5, amount: 0 };

  /**
   * The same idea for the pointer: where it is over the map, and how far the map has leaned
   * toward it so far. `null` goal means the pointer is not over the map and the lean is
   * relaxing back out.
   */
  let mapPointerGoal: { u: number; v: number } | null = null;
  let mapPointer: MapCameraFocus = { u: 0.5, v: 0.5, amount: 0 };
  /**
   * The plot's on-screen rect, cached.
   *
   * A pointer move cannot read it directly: the frame loop writes a transform onto every pin,
   * so a `getBoundingClientRect` in the move handler would force a synchronous layout on each
   * one. Refreshed instead when the pointer enters, when the plot resizes, and when the window
   * does — the last because the stage scale is a transform, which changes the on-screen rect
   * without changing the layout box the observer watches.
   */
  let mapPlotRect: DOMRect | null = null;

  /** The uniform scale `ui/stageScale` puts on the shell, as a number. */
  function stageScaleFactor(): number {
    const raw = Number(
      getComputedStyle(document.documentElement).getPropertyValue("--ui-scale"),
    );
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
  }

  /**
   * Give up on the GPU map for the rest of the session and redraw the panel with the plain
   * image layer. Reached when there is no WebGL2, when the art will not load, or when the
   * context is lost — a backgrounded phone tab is the common one, and the map coming back as a
   * black rectangle would be worse than it coming back flat.
   */
  function fallBackToImageMap(): void {
    if (mapRendererDisabled) {
      return;
    }
    mapRendererDisabled = true;
    mapRenderer?.dispose();
    mapRenderer = null;
    mapRendererArt = null;
    mapProjector = createFlatProjector();
    renderMapPanel();
  }

  /**
   * Someone who has asked their system for less motion still gets the tilt — a still, angled
   * map is a layout, not an animation — but the drift and the sweep are held at rest.
   */
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /**
   * Rebuild the camera for `mapTimeSeconds`. Split out from the frame hook because a re-render
   * or a resize also has to reproject the pins, and doing that against a stale camera would
   * snap every marker back to wherever the map was a frame ago.
   */
  /**
   * The plot's box, or `null` when there is nothing to draw into.
   *
   * `offsetWidth` serves only as a bootstrap for the first sync of a run: it rounds to whole
   * pixels (1071 for a plot that is really 1070.53 wide), which is enough to walk a pin at the
   * right-hand edge half a pixel off the land it was authored on. The observer's box sizes are
   * fractional and, unlike a client rect, are read in the same pre-scale layout space the
   * transforms are written in — so `scale(var(--ui-scale))` and the portrait `rotate(90deg)`
   * cannot skew them. A zero box means another dashboard menu has the space; the observer runs
   * everything again when the panel comes back.
   */
  /** Cache the plot's on-screen rect for the pointer maths; see `mapPlotRect`. */
  function refreshMapPlotRect(): void {
    mapPlotRect = mapPlotEl?.getBoundingClientRect() ?? null;
  }

  /**
   * An element's position in the shell's pre-scale layout space, summed up the offsetParent
   * chain. Two elements read this way can be subtracted to get the offset between them.
   *
   * Not `getBoundingClientRect()`, for the reason `ui/map/projection` gives: the shell sits
   * inside `scale(var(--ui-scale))` and, on a portrait phone, a `rotate(90deg)`, so a rect is
   * in post-scale visual pixels with the axes possibly swapped — while everything the plot
   * places is written in layout pixels. Offsets are already in that space. They round to whole
   * pixels, which would be too coarse to plant a pin but is far below notice on a leader line.
   */
  function layoutOrigin(el: HTMLElement): { x: number; y: number } {
    let x = 0;
    let y = 0;
    let node: HTMLElement | null = el;
    while (node !== null) {
      x += node.offsetLeft;
      y += node.offsetTop;
      node = node.offsetParent instanceof HTMLElement ? node.offsetParent : null;
    }
    return { x, y };
  }

  /**
   * Where the leader line meets the panel: the middle of its left edge, in plot coordinates.
   * Only recomputed on a layout change (the plot resizing, the card swapping for a taller one)
   * rather than per frame, so the animation loop never forces a reflow to draw the line.
   */
  function refreshMapLeaderAnchor(): void {
    const plotEl = mapPlotEl;
    if (plotEl === null) {
      mapLeaderAnchors = [];
      return;
    }
    const plotAt = layoutOrigin(plotEl);
    mapLeaderAnchors = inspectorPanes.map((pane) => {
      if (pane.el.hidden) {
        return null;
      }
      const panelAt = layoutOrigin(pane.el);
      return {
        x: panelAt.x - plotAt.x,
        y: panelAt.y - plotAt.y + pane.el.offsetHeight / 2,
      };
    });
  }

  /**
   * Redraws the leader from the inspected site to the panel. Hidden along with the panel, and
   * hidden too when the camera has turned its site away from the viewer — a line running to a
   * pin that is not on screen points at nothing.
   */
  function syncMapLeaderLine(plot: PlotSize): void {
    inspectorPanes.forEach((pane, i) => {
      const line = mapLeaderLineEls[i];
      if (line === undefined) {
        return;
      }
      const key = pane.el.hidden ? null : mapSubjectKey(pane.subject);
      const marker = key === null ? undefined : mapMarkersBySubject.get(key);
      const anchor = mapLeaderAnchors[i] ?? null;
      if (marker === undefined || anchor === null) {
        line.style.display = "none";
        return;
      }
      const from = mapProjector.project(marker, plot);
      if (!from.visible) {
        line.style.display = "none";
        return;
      }
      line.style.display = "";
      line.setAttribute("x1", from.x.toFixed(2));
      line.setAttribute("y1", from.y.toFixed(2));
      line.setAttribute("x2", anchor.x.toFixed(2));
      line.setAttribute("y2", anchor.y.toFixed(2));
    });
  }

  function currentPlotSize(): PlotSize | null {
    if (mapPlotEl === null) {
      return null;
    }
    const size = mapPlotSize ?? {
      width: mapPlotEl.offsetWidth,
      height: mapPlotEl.offsetHeight,
    };
    return size.width > 0 && size.height > 0 ? size : null;
  }

  function updateMapCamera(): void {
    const plot = currentPlotSize();
    if (mapRenderer === null || plot === null) {
      return;
    }
    mapCamera = mapCameraFrame({
      aspect: plot.width / plot.height,
      timeSeconds: mapTimeSeconds,
      tilt: 1,
      drift: reducedMotion.matches ? 0 : 1,
      focus: mapFocus,
      pointer: mapPointer,
    });
  }

  /**
   * One frame of the map. Cheap by construction: the camera is sixteen numbers, the draw is two
   * quads, and the marker pass writes two custom properties per pin without reading layout. The
   * early return is what keeps it free while another dashboard menu owns the panel — the
   * observer reports a hidden panel as a zero box, and there is nothing to animate.
   */
  function drawMapFrame(timeMs: number): void {
    if (mapRenderer === null || currentPlotSize() === null) {
      return;
    }
    if (reducedMotion.matches) {
      /* Still needs the one draw that a resize or a re-render asks for, but no clock. */
      return;
    }
    mapEpochMs ??= timeMs;
    const deltaSeconds =
      mapLastFrameMs === null ? 0 : Math.min((timeMs - mapLastFrameMs) / 1000, 0.1);
    mapLastFrameMs = timeMs;
    mapTimeSeconds = (timeMs - mapEpochMs) / 1000;
    mapFocus = easeMapLean(mapFocus, mapFocusGoal, deltaSeconds, MAP_FOCUS_EASE_SECONDS);
    mapPointer = easeMapLean(
      mapPointer,
      mapPointerGoal,
      deltaSeconds,
      MAP_POINTER_EASE_SECONDS,
    );
    updateMapCamera();
    syncMapProjection();

    /* One text write a second rather than one a frame. The clock is the only per-frame DOM work
     * on the panel that is not a transform, and a `textContent` assignment that changes nothing
     * still costs more than the comparison that skips it. */
    if (mapClockEl !== null) {
      const shown = formatConsoleClock(mapTimeSeconds);
      if (shown !== mapClockShown) {
        mapClockShown = shown;
        mapClockEl.textContent = shown;
      }
    }
  }

  /** Seconds for the lean to close most of the distance to a newly staged target. */
  const MAP_FOCUS_EASE_SECONDS = 0.22;
  /** The pointer lean is quicker: it is answering a hand, and lag reads as the map being
   *  stuck rather than as the map being calm. */
  const MAP_POINTER_EASE_SECONDS = 0.13;

  /**
   * Push the projector's answer for every registered element into the custom properties the
   * stylesheet composes into a transform. Deliberately cheap enough to run per frame: one
   * projection and two property writes per pin, and no layout read inside the loop.
   */
  function syncMapProjection(): void {
    const plot = currentPlotSize();
    if (plot === null || mapProjectedEls.length === 0) {
      return;
    }
    if (mapRenderer !== null) {
      /* The stage scale is a transform, so a plot that is 1070 layout px wide covers
       * 1070 * uiScale real pixels; without that factor the map goes soft on a monitor large
       * enough to scale the shell up. Clamped inside the renderer. */
      mapRenderer.resize(plot, window.devicePixelRatio * stageScaleFactor());
      mapRenderer.draw({
        ...mapCamera,
        timeSeconds: mapTimeSeconds,
        aspect: plot.width / plot.height,
        signals: mapSignals,
        /* Derived here rather than kept as state: the schedule is a pure function of the clock,
         * so there is nothing to advance, nothing to reset when the panel is rebuilt, and
         * nothing that can drift out of step with the shaders reading the same clock. */
        tracks: ambientTracks(mapTimeSeconds),
        lair: mapLairPoint,
      });
    }
    for (const { el, marker } of mapProjectedEls) {
      const projected = mapProjector.project(marker, plot);
      el.style.setProperty("--map-px", `${projected.x.toFixed(2)}px`);
      el.style.setProperty("--map-py", `${projected.y.toFixed(2)}px`);
      el.hidden = !projected.visible;
    }
    /* The reticle rides the same projection as the pins, so it stays welded to the one it has
     * closed on through the drift rather than sliding off it. */
    if (mapReticleEl !== null && mapReticleMarker !== null) {
      const projected = mapProjector.project(mapReticleMarker, plot);
      mapReticleEl.style.setProperty("--map-px", `${projected.x.toFixed(2)}px`);
      mapReticleEl.style.setProperty("--map-py", `${projected.y.toFixed(2)}px`);
      /* A reticle drawn around a pin the camera has turned out of frame points at nothing. */
      mapReticleEl.hidden = !projected.visible;
    }
    syncMapLeaderLine(plot);
  }

  /* The plot resizes when the dashboard swaps between the map tile and the fullscreen
   * single-panel view, and when it is revealed again after another menu had the space.
   * Observing also fires once immediately, which is what upgrades the bootstrap size above to
   * the real fractional one. */
  /* The drawing buffer is not preserved (keeping it would cost a full-size copy every frame on
   * exactly the phones this shell is tight for), so the compositor's copy is the only thing
   * holding the last frame. A tab that gets backgrounded and restored can come back with that
   * copy gone and nothing to repaint from — a black map. Redrawing on the way back in costs one
   * frame and removes the whole class of it. The animation loop in a later step subsumes this. */
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      syncMapProjection();
    }
  });

  /* The shell's own loop drives the map; see `mapFrameHook`. */
  mapFrameHook = drawMapFrame;

  /**
   * Pointer parallax: the map leans a little toward where the hand is.
   *
   * Only for a fine pointer. On touch there is no hover to answer, and a portrait phone rotates
   * the whole stage 90 degrees, which would put a client rect's axes at odds with the map's —
   * gating here means that case never has to be reasoned about. Bound to the panel rather than
   * the plot because `renderMapPanel` replaces the plot on every state change and would drop a
   * listener attached to it; events from the pins inside bubble up here anyway.
   */
  const finePointer = window.matchMedia("(pointer: fine)");

  function updateMapPointerGoal(event: PointerEvent): void {
    if (!finePointer.matches || reducedMotion.matches || mapPlotRect === null) {
      return;
    }
    const { left, top, width, height } = mapPlotRect;
    if (width === 0 || height === 0) {
      return;
    }
    /* A ratio of the on-screen rect, so the stage scale cancels out and this needs no knowledge
     * of `--ui-scale`. Clamped because a pin near the edge can overhang the plot slightly. */
    const u = Math.min(Math.max((event.clientX - left) / width, 0), 1);
    const v = Math.min(Math.max((event.clientY - top) / height, 0), 1);
    mapPointerGoal = { u, v };
  }

  mapPanelEl.addEventListener("pointerenter", (event: PointerEvent) => {
    refreshMapPlotRect();
    updateMapPointerGoal(event);
  });
  mapPanelEl.addEventListener("pointermove", updateMapPointerGoal);
  mapPanelEl.addEventListener("pointerleave", () => {
    mapPointerGoal = null;
  });
  /* A pointer that is picked up rather than moved out — a drag ending, the window losing focus,
   * a pen leaving range — never sends `pointerleave`, and the map would stay leaning. */
  mapPanelEl.addEventListener("pointercancel", () => {
    mapPointerGoal = null;
  });
  window.addEventListener("blur", () => {
    mapPointerGoal = null;
  });
  /* The stage scale is a transform, so the plot's on-screen rect moves on a window resize
   * without its layout box changing — which means the ResizeObserver never hears about it. */
  window.addEventListener("resize", refreshMapPlotRect);

  reducedMotion.addEventListener("change", () => {
    /* Turning the preference on mid-session must settle the map where it stands rather than
     * leave it frozen mid-drift on the next frame that never comes. */
    updateMapCamera();
    syncMapProjection();
  });

  const mapPlotResizeObserver = new ResizeObserver((entries) => {
    /* Horizontal writing mode throughout, so inline/block are width/height. */
    const box = entries[entries.length - 1]?.contentBoxSize?.[0];
    if (box !== undefined) {
      mapPlotSize = { width: box.inlineSize, height: box.blockSize };
    }
    /* The camera is built around the panel's aspect, so a resize invalidates it before the
     * pins can be reprojected. */
    updateMapCamera();
    refreshMapPlotRect();
    syncMapProjection();
  });

  /**
   * Sites the **active** Omega phase can still be aimed at, and which of its missions want
   * each one.
   *
   * Only the phase's unfinished slots count: a mission already completed is not something the
   * plan still needs a place for, and flagging its targets would point the player at work they
   * have done. Intel and security are read from current run state, so a site can join or leave
   * the set as surveillance and heat move — which is exactly what the flag is for.
   */
  function activeOmegaPhaseTargetsByLocation(): Map<string, string[]> {
    const planId = state.activeOmegaPlanId;
    const plan = planId !== null ? getOmegaPlanById(content, planId) : undefined;
    const stageIndex = state.activeOmegaStageIndex;
    const stage = plan?.stages[stageIndex];
    const progress = state.omegaStageProgress[stageIndex];
    if (stage === undefined || progress === undefined) {
      return new Map();
    }
    const missions: MissionTemplate[] = [];
    for (let slotIndex = 0; slotIndex < OMEGA_MISSIONS_PER_STAGE; slotIndex += 1) {
      const missionTemplateId = stage.missionIds[slotIndex];
      if (missionTemplateId === undefined || progress[slotIndex] === true) {
        continue;
      }
      const template = findMissionOrEventTemplate(missionTemplateId);
      if (template !== undefined) {
        missions.push(template);
      }
    }
    return omegaPhaseTargetsByLocation({
      missions,
      sites: runLocations().map((location) => ({
        location,
        intelLevel: intelLevelAtLocation(state, location.id),
        securityLevel: securityLevelForLocation(state.locationSecurityStates, location.id),
      })),
    });
  }

  /**
   * One chip on a pin's tag rail.
   *
   * Every chip a site could show is built on every render and hidden by the stylesheet, so the
   * panel's switches never cost a rebuild. Purely visual: the rail is inert to the pointer (it
   * would otherwise sit between neighbouring pins and take their clicks) and hidden from
   * assistive tech, which reads the same facts off the pin's own label.
   */
  function createMapMarkerTag(
    modifier: string,
    icon: SVGElement | null,
    text: string,
  ): HTMLElement {
    const tag = document.createElement("span");
    tag.className = `map-marker__tag map-marker__tag--${modifier}`;
    if (icon !== null) {
      tag.appendChild(icon);
    }
    const value = document.createElement("span");
    value.className = "map-marker__tag-value";
    value.textContent = text;
    tag.appendChild(value);
    return tag;
  }

  /**
   * Push `mapLayers` onto the plot.
   *
   * Every layer is a class and nothing else, which is what lets a toggle be instant: the pins
   * are built once per render carrying every decoration they could ever show, and the switches
   * only decide which of them the stylesheet reveals. Flipping one costs no rebuild, so the
   * checkbox the player is holding never disappears out from under the click.
   */
  function applyMapLayerClasses(): void {
    if (mapPlotEl === null) {
      return;
    }
    mapPlotEl.classList.remove(...MAP_LAYER_PLOT_CLASSES);
    mapPlotEl.classList.add(...mapLayerPlotClasses(mapLayers));
  }

  function setMapLayer(key: MapLayerKey, on: boolean): void {
    if (mapLayers[key] === on) {
      return;
    }
    mapLayers = { ...mapLayers, [key]: on };
    saveMapLayers(typeof localStorage === "undefined" ? null : localStorage, mapLayers);
    const input = mapLayerInputs.get(key);
    if (input !== undefined && input.checked !== on) {
      input.checked = on;
    }
    applyMapLayerClasses();
  }

  /**
   * The Map Layers panel, built once at startup from {@link MAP_LAYER_GROUPS}.
   *
   * Built once rather than per render because it holds no run state: what it shows is the
   * player's preference, and a control that rebuilt itself mid-turn would drop focus every
   * time a mission ticked.
   */
  function buildMapLayersPanel(): void {
    mapLayersPanelEl.innerHTML = "";
    mapLayerInputs.clear();
    for (const group of MAP_LAYER_GROUPS) {
      const fieldset = document.createElement("fieldset");
      fieldset.className = "map-layers-group";
      const legend = document.createElement("legend");
      legend.className = "map-layers-group__label";
      legend.textContent = group.label;
      fieldset.appendChild(legend);

      for (const option of group.options) {
        const row = document.createElement("label");
        row.className = "map-layers-row";
        row.title = option.hint;

        const input = document.createElement("input");
        input.type = "checkbox";
        input.className = "map-layers-row__input";
        input.checked = mapLayers[option.key];
        input.setAttribute("aria-label", `${option.label}. ${option.hint}`);
        input.addEventListener("change", () => {
          setMapLayer(option.key, input.checked);
        });
        mapLayerInputs.set(option.key, input);
        row.appendChild(input);

        if (option.swatch !== undefined) {
          /* The pin's own dot colour, so the row reads at a glance as "these pins". */
          const swatch = document.createElement("span");
          swatch.className = `map-layers-row__swatch map-layers-row__swatch--${option.swatch}`;
          swatch.setAttribute("aria-hidden", "true");
          row.appendChild(swatch);
        }

        const label = document.createElement("span");
        label.className = "map-layers-row__label";
        label.textContent = option.label;
        row.appendChild(label);

        fieldset.appendChild(row);
      }
      mapLayersPanelEl.appendChild(fieldset);
    }
  }

  /**
   * The player's own base, plotted on the world like any site.
   *
   * Deliberately not a `.map-marker` button: the lair is not a mission target and carries no
   * drag payload, so it is inert markup that only reads as a place. It also stays out of
   * `mapSignals` — those are security / operation glows, and the lair has neither.
   *
   * Drawn last so it sits over any site pin it happens to land near.
   */
  function plotLairMarker(plot: HTMLElement): void {
    const lair = state.activeLairId !== null ? getLairById(content, state.activeLairId) : undefined;
    const at = lair?.mapPosition;
    if (lair === undefined || at === undefined) {
      return;
    }

    const home = document.createElement("button");
    home.type = "button";
    home.className = "map-marker map-marker--lair";
    /* A button, unlike the site pins, with nothing draggable about it: the lair is not a
     * mission target and carries no payload. All a click does is park it in the inspector. */
    home.dataset.mapLair = "true";
    home.title = `${lair.name}
Your lair`;
    home.setAttribute("aria-label", `${lair.name}, your lair`);
    home.addEventListener("click", () => {
      toggleMapPin({ kind: "lair" });
    });
    mapProjectedEls.push({ el: home, marker: at });
    mapMarkersBySubject.set("lair", at);
    mapLairPoint = { u: at.x / 100, v: at.y / 100 };

    const ring = document.createElement("span");
    ring.className = "map-marker__ring";
    home.appendChild(ring);
    /* The same omega the HUD flies over the plan — this is the one place on the map that is
     * the player's rather than a target of theirs. */
    const mark = document.createElement("span");
    mark.className = "map-marker__omega";
    mark.textContent = "Ω";
    home.appendChild(mark);
    const label = document.createElement("span");
    label.className = "map-marker__label";
    label.textContent = lair.name;
    home.appendChild(label);

    plot.appendChild(home);
  }

  /**
   * The reticle: brackets that close on whatever the pointer is over, and its coordinates.
   *
   * Inert markup — `aria-hidden`, and no pointer events. Everything it says about a site the pin
   * underneath already says in its `aria-label` and its tooltip, so to a screen reader this is
   * duplicate noise, and to the pointer it is an obstacle sitting exactly where the thing you
   * are trying to click is.
   */
  function buildMapReticle(plot: HTMLElement): void {
    const reticle = document.createElement("div");
    reticle.className = "map-reticle";
    reticle.setAttribute("aria-hidden", "true");
    reticle.hidden = true;

    const sweep = document.createElement("span");
    sweep.className = "map-reticle__sweep";
    reticle.appendChild(sweep);
    for (const corner of ["tl", "tr", "bl", "br"]) {
      const bracket = document.createElement("span");
      bracket.className = `map-reticle__corner map-reticle__corner--${corner}`;
      reticle.appendChild(bracket);
    }
    const readout = document.createElement("span");
    readout.className = "map-reticle__readout";
    reticle.appendChild(readout);

    plot.appendChild(reticle);
    mapReticleEl = reticle;
    mapReticleReadoutEl = readout;
    /* A pin can survive the rebuild that just dropped this element, so re-point it now rather
     * than wait for a pointer move that may never come. */
    syncMapReticle();
  }

  /**
   * The console furniture in the plot's corners.
   *
   * Says nothing about the run on purpose. Everything here is either constant or a clock, so
   * there is no chance of a player reading a state out of it that the rules do not back — and
   * the corners it sits in are the two the authored markers leave empty.
   */
  function buildMapTelemetry(plot: HTMLElement): void {
    const head = document.createElement("div");
    head.className = "map-telemetry map-telemetry--head";
    head.setAttribute("aria-hidden", "true");
    const dot = document.createElement("span");
    dot.className = "map-telemetry__dot";
    head.appendChild(dot);
    const label = document.createElement("span");
    label.textContent = "ORBITAL UPLINK · NOMINAL";
    head.appendChild(label);
    plot.appendChild(head);

    const foot = document.createElement("div");
    foot.className = "map-telemetry map-telemetry--foot";
    foot.setAttribute("aria-hidden", "true");
    const clock = document.createElement("span");
    clock.className = "map-telemetry__clock";
    clock.textContent = "T+00:00:00";
    foot.appendChild(clock);
    const bar = document.createElement("span");
    bar.className = "map-telemetry__bar";
    foot.appendChild(bar);
    plot.appendChild(foot);

    mapClockEl = clock;
    mapClockShown = "";
  }

  /** `T+HH:MM:SS` since the console came up. */
  function formatConsoleClock(totalSeconds: number): string {
    const whole = Math.max(0, Math.floor(totalSeconds));
    const pad = (n: number): string => String(n).padStart(2, "0");
    return `T+${pad(Math.floor(whole / 3600))}:${pad(Math.floor(whole / 60) % 60)}:${pad(whole % 60)}`;
  }

  /**
   * Point the reticle at whatever is hovered, or put it away.
   *
   * The coordinates are written here rather than per frame: they are a property of which site is
   * under the pointer, not of where the camera has drifted to, so the only thing the animation
   * loop has to do for this element is move it.
   */
  function syncMapReticle(): void {
    const key = mapSubjectKey(hoveredMapSubject);
    const marker = key === null ? undefined : mapMarkersBySubject.get(key);
    mapReticleMarker = marker ?? null;
    if (mapReticleEl === null) {
      return;
    }
    if (marker === undefined) {
      mapReticleEl.hidden = true;
      return;
    }
    if (mapReticleReadoutEl !== null) {
      mapReticleReadoutEl.textContent = formatMapCoordinates(marker.x / 100, marker.y / 100);
    }
    mapReticleEl.hidden = false;
  }

  /**
   * The run's map with its sites plotted on it. Markers carry the same drag payload as location
   * cards, so the map is a second way to pick a mission target rather than a picture of one.
   */
  function renderMapPanel(): void {
    /* The pins about to be discarded will never fire `pointerout`, so the hover they left
     * behind is dropped with them. A pinned site outlives the rebuild. */
    hoveredMapSubject = null;
    mapPanelEl.innerHTML = "";
    mapPlotResizeObserver.disconnect();
    mapProjectedEls = [];
    mapLairPoint = null;
    mapReticleEl = null;
    mapReticleReadoutEl = null;
    mapReticleMarker = null;
    mapClockEl = null;
    mapClockShown = "";
    mapPlotEl = null;
    mapLeaderLineEls = [];
    mapMarkersBySubject = new Map();

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

    const artDescription = `${map.name}. ${map.description}`;
    if (!mapRendererDisabled && mapRendererArt !== map.mapArt) {
      mapRenderer?.dispose();
      mapRendererArt = map.mapArt;
      mapRenderer = createMapPlaneRenderer(
        map.mapArt,
        () => {
          syncMapProjection();
        },
        fallBackToImageMap,
      );
      /* No WebGL2 on this device: settle on the image layer now rather than checking again on
       * every render for the rest of the run. */
      if (mapRenderer === null) {
        mapRendererDisabled = true;
        mapRendererArt = null;
      }
      /* The pins ride the land plane, not the grid floating above it. */
      mapProjector =
        mapRenderer !== null
          ? createMatrixProjector(() => mapCamera.land)
          : createFlatProjector();
    }

    if (mapRenderer !== null) {
      /* The art is the panel's only content, so the canvas carries its description. */
      mapRenderer.canvas.setAttribute("role", "img");
      mapRenderer.canvas.setAttribute("aria-label", artDescription);
      plot.appendChild(mapRenderer.canvas);
    } else {
      const art = document.createElement("img");
      art.className = "map-plot__art";
      art.src = map.mapArt;
      art.alt = artDescription;
      art.decoding = "async";
      plot.appendChild(art);
    }

    /* Between the art and the pins: the line reaches the panel from under the marker it
     * starts at, and never sits on top of one it happens to cross. */
    const leader = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    leader.setAttribute("class", "map-leader");
    leader.setAttribute("aria-hidden", "true");
    mapLeaderLineEls = inspectorPanes.map(() => {
      const leaderLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
      leaderLine.setAttribute("class", "map-leader__line");
      leaderLine.style.display = "none";
      leader.appendChild(leaderLine);
      return leaderLine;
    });
    plot.appendChild(leader);

    buildMapReticle(plot);
    buildMapTelemetry(plot);

    const playable = new Set(runLocations().map((l) => l.id));
    const mainOnly = state.phase === "main";
    const targetedLocationId =
      assignTarget?.kind === "location" || assignTarget?.kind === "asset"
        ? assignTarget.locationId
        : null;

    /* Missions aimed at a site, or at an asset sitting in one, both hang off that site's pin. */
    const missionsByLocation = new Map<string, ActiveMission[]>();
    for (const am of state.activeMissions) {
      const lid = getMissionTargetLocationId(am.target);
      if (lid === null) {
        continue;
      }
      const running = missionsByLocation.get(lid);
      if (running === undefined) {
        missionsByLocation.set(lid, [am]);
      } else {
        running.push(am);
      }
    }

    /* What the map is allowed to say about play, recomputed from the same facts the pins are
     * styled from so the glow under a marker can never contradict the marker itself. */
    const markers = map.markers ?? [];
    mapSignals = mapSiteSignals({
      markers,
      playableLocationIds: playable,
      securityLevelByLocation: new Map(
        state.locationSecurityStates.map((row) => [row.locationId, row.securityLevel]),
      ),
      maxSecurityByLocation: new Map(
        markers.map((m) => [m.locationId, maxSecurityLevelForLocation(content, m.locationId)]),
      ),
      operationLocationIds: new Set(missionsByLocation.keys()),
      targetedLocationId,
    });

    /* What the plan wants next and what is worth taking, worked out once for the whole map
     * rather than per pin. Both feed the tag rail the Map Layers panel switches on and off. */
    const omegaTargets = activeOmegaPhaseTargetsByLocation();
    const omegaPhaseNumber = state.activeOmegaStageIndex + 1;
    const assetNameById = new Map(content.assets.map((a) => [a.id, a.name]));

    /* The camera leans at whatever is staged, and settles back when nothing is. */
    const focusMarker =
      targetedLocationId === null
        ? undefined
        : markers.find((m) => m.locationId === targetedLocationId);
    mapFocusGoal =
      focusMarker === undefined ? null : { u: focusMarker.x / 100, v: focusMarker.y / 100 };

    for (const marker of markers) {
      const loc = getLocationById(content, marker.locationId);
      if (loc === undefined || !playable.has(loc.id)) {
        continue;
      }

      const intel = intelLevelAtLocation(state, loc.id);
      const security = securityLevelForLocation(state.locationSecurityStates, loc.id);
      const agents = playerVisibleOpposingAgentsAtLocation(state, loc.id);

      mapMarkersBySubject.set(`site:${loc.id}`, marker);

      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = `map-marker map-marker--${loc.locationType}`;
      pin.dataset.locationId = loc.id;
      /* Where this pin sits in its idle animation, so fifteen of them do not breathe in unison —
       * which reads as the panel pulsing rather than as fifteen separate places. Stepped by the
       * golden ratio because consecutive markers are usually neighbours on the map, and any
       * smaller step would leave visible bands of pins in phase with each other. */
      pin.style.setProperty("--map-pin-phase", `${(mapProjectedEls.length * 0.618) % 1}`);
      mapProjectedEls.push({ el: pin, marker });
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
        `Security ${security}/${maxSecurityLevelForLocation(content, loc.id)} · Intel ${intel}/${MAX_INTEL_LEVEL}`,
      ];
      if (agents.length > 0) {
        const names = agents.map(
          (a) => getAgentTemplateById(content, a.templateId)?.name ?? a.templateId,
        );
        tipLines.push(`Agents: ${names.join(", ")}`);
      }

      /* Sites the active Omega phase could still be aimed at, and the gear the player has
       * actually identified at this one. Both are worked out whatever the Map Layers panel is
       * set to: the tooltip is the accessible reading of the tag rail, and a chip the player
       * has switched off is still a fact about the site. */
      const omegaMissionIds = omegaTargets.get(loc.id) ?? [];
      if (omegaMissionIds.length > 0) {
        const names = omegaMissionIds.map(
          (id) => findMissionOrEventTemplate(id)?.name ?? id,
        );
        tipLines.push(`Omega Phase ${omegaPhaseNumber} target: ${names.join(", ")}`);
      }
      const revealedAssetNames: string[] = [];
      for (const slot of state.locationAssetSlots.find((p) => p.locationId === loc.id)?.slots ??
        []) {
        /* The same bar the location card names a slot by: stored as revealed, or intel deep
         * enough to read the site's inventory. Anything short of that is not the player's to
         * see, whatever the layer is set to. */
        if (!isOccupiedAssetSlot(slot) || assetSlotKnowledge(slot, intel) !== "identified") {
          continue;
        }
        revealedAssetNames.push(assetNameById.get(slot.assetId) ?? slot.assetId);
      }
      if (revealedAssetNames.length > 0) {
        tipLines.push(`Assets: ${revealedAssetNames.join(", ")}`);
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
        /* Only a click that selects stages the site; deselecting has just dropped the target. */
        if (toggleMapPin({ kind: "site", locationId: loc.id })) {
          trySetMapTarget(loc.id);
        }
      });

      const ring = document.createElement("span");
      ring.className = "map-marker__ring";
      pin.appendChild(ring);
      const dot = document.createElement("span");
      dot.className = "map-marker__dot";
      pin.appendChild(dot);
      /* Name and tag rail hang off one column under the pin, so a name showing and a readout
       * showing can never land on top of each other — which they would if each were pinned to
       * the marker at its own offset. */
      const info = document.createElement("span");
      info.className = "map-marker__info";
      const label = document.createElement("span");
      label.className = "map-marker__label";
      label.textContent = loc.name;
      info.appendChild(label);

      const tags = document.createElement("span");
      tags.className = "map-marker__tags";
      tags.setAttribute("aria-hidden", "true");
      if (omegaMissionIds.length > 0) {
        tags.appendChild(createMapMarkerTag("omega", null, "\u03A9"));
      }
      /* Intel and security ride the rail as a pair — one says how much of the site the player
       * can see, the other how hard it is to walk into, and reading either alone is misleading.
       * Both are `x / max` in the pin's tooltip; the chip is the numerator, which is the part
       * that moves. */
      tags.appendChild(
        createMapMarkerTag(
          "intel",
          createSvgPillIcon(UNKNOWN_ICON_SVG_PATHS, "map-marker__tag-icon"),
          `${intel}`,
        ),
      );
      tags.appendChild(
        createMapMarkerTag(
          "security",
          createSvgPillIcon(SECURITY_ICON_SVG_PATHS, "map-marker__tag-icon"),
          `${security}`,
        ),
      );
      if (revealedAssetNames.length > 0) {
        tags.appendChild(
          createMapMarkerTag(
            "assets",
            createSvgPillIcon(ASSET_ICON_SVG_PATHS, "map-marker__tag-icon"),
            `${revealedAssetNames.length}`,
          ),
        );
      }
      info.appendChild(tags);
      pin.appendChild(info);

      plot.appendChild(pin);

      const running = missionsByLocation.get(loc.id) ?? [];
      if (running.length > 0) {
        const stack = document.createElement("div");
        stack.className = "map-callout-stack";
        mapProjectedEls.push({ el: stack, marker });
        /* Sit above the pin unless that would run off the top of the plot, and pull the stack
         * back inside the frame when the pin hugs a side. */
        if (marker.y < 22) {
          stack.classList.add("map-callout-stack--below");
        }
        if (marker.x < 15) {
          stack.classList.add("map-callout-stack--right");
        } else if (marker.x > 85) {
          stack.classList.add("map-callout-stack--left");
        }
        for (const am of running) {
          stack.appendChild(createMissionCalloutEl(am));
        }
        plot.appendChild(stack);
      }
    }

    plotLairMarker(plot);

    mapPanelEl.appendChild(plot);
    mapPlotEl = plot;
    /* The pins carry every decoration they could show; this is what decides which of them the
     * player is looking at. Applied before the first paint, like the camera below it. */
    applyMapLayerClasses();
    /* Build the camera and place the pins before this frame paints, then let the observer keep
     * them honest; observing alone would flash the map flat with every marker stacked at the
     * plot's top-left corner for a frame. */
    updateMapCamera();
    syncMapProjection();
    mapPlotResizeObserver.observe(plot);
  }

  /**
   * The card the inspector is showing, or null when it should be down. A pinned site that has
   * dropped off the run's map (a plan swap between renders) is forgotten rather than shown.
   */
  /** Whether a subject still exists to be shown: sites leave with a plan swap, lairs get given up. */
  function mapSubjectAlive(subject: MapSubject | null): boolean {
    if (subject === null) {
      return false;
    }
    return subject.kind === "lair"
      ? state.activeLairId !== null
      : runLocations().some((l) => l.id === subject.locationId);
  }

  /**
   * Which subject each slot holds, nearest the map's right corner first.
   *
   * The selections fill from slot 0 leftward in the order they were made. A hover goes in the
   * next slot along — to the left of the whole stack, so every selected card and its leader
   * line stay exactly where they are while the map is browsed around them — and only if the
   * stack has left room for it. Hovering something already selected adds nothing: its card is
   * on screen already.
   */
  function inspectorSlotSubjects(): (MapSubject | null)[] {
    const slots: (MapSubject | null)[] = Array.from(
      { length: MAX_INSPECTOR_CARDS },
      () => null,
    );
    if (currentMenu !== "dashboard") {
      return slots;
    }
    pinnedMapSubjects = pinnedMapSubjects.filter((s) => mapSubjectAlive(s));
    pinnedMapSubjects.forEach((subject, i) => {
      slots[i] = subject;
    });
    const hovered = mapSubjectAlive(hoveredMapSubject) ? hoveredMapSubject : null;
    if (
      hovered !== null &&
      !isPinnedMapSubject(hovered) &&
      pinnedMapSubjects.length < MAX_INSPECTOR_CARDS
    ) {
      slots[pinnedMapSubjects.length] = hovered;
    }
    return slots;
  }

  /**
   * Draws the inspector: which pane shows what, and where each pane sits.
   *
   * A pane already showing a subject keeps it, whatever slot that subject has moved to. That
   * is the whole trick behind the slide — releasing a selection while previewing another site
   * does not rebuild a card in a new place, it leaves the preview pane exactly as it is and
   * changes only the slot it is parked in, which the CSS transitions across.
   */
  function renderSiteInspector(): void {
    const slots = inspectorSlotSubjects();

    /* Panes already holding one of the wanted subjects claim it first; the rest get handed out
     * to whatever is left over, so at most one pane ever rebuilds its contents in a turn. */
    const claimed = new Set<InspectorPane>();
    const paneForSlot: (InspectorPane | null)[] = slots.map((subject) => {
      if (subject === null) {
        return null;
      }
      const held = inspectorPanes.find(
        (p) => !claimed.has(p) && mapSubjectKey(p.subject) === mapSubjectKey(subject),
      );
      if (held !== undefined) {
        claimed.add(held);
        return held;
      }
      return null;
    });
    slots.forEach((subject, slot) => {
      if (subject === null || paneForSlot[slot] !== null) {
        return;
      }
      const free = inspectorPanes.find((p) => !claimed.has(p));
      if (free !== undefined) {
        claimed.add(free);
        paneForSlot[slot] = free;
      }
    });

    for (const pane of inspectorPanes) {
      const slot = paneForSlot.indexOf(pane);
      if (slot === -1) {
        pane.subject = null;
        pane.el.hidden = true;
        pane.bodyEl.innerHTML = "";
        pane.el.classList.remove("game-panel--site-inspector--pinned");
        continue;
      }
      renderInspectorPane(pane, slots[slot] as MapSubject, slot);
    }

    refreshMapLeader();
  }

  /** One pane: what it shows, whether it is the selected one, and which slot it is parked in. */
  function renderInspectorPane(pane: InspectorPane, subject: MapSubject, slot: number): void {
    const wasVisible = !pane.el.hidden;
    pane.subject = subject;
    pane.el.hidden = false;
    /* Slot 0 sits at the right edge; each slot after it steps one tile-width to the left.
     * `--dock-w` is a percentage of the containing block, which is what `right` resolves it
     * against too — so this cannot go through a transform, where a percentage would resolve
     * against the panel's own width instead. */
    const right = slot === 0 ? "0px" : `calc((var(--dock-w) + var(--dock-gap)) * ${slot})`;
    if (pane.el.style.right !== right) {
      pane.el.style.right = right;
      /* A pane appearing is not a pane moving: only something already on screen slides. */
      if (wasVisible) {
        trackInspectorSlide();
      }
    }

    /* Only the selected pane takes the pointer: see the click-through note in the CSS. Its X
     * is the only one that could do anything, so the preview's is not offered. */
    const isPinned = isPinnedMapSubject(subject);
    pane.el.classList.toggle("game-panel--site-inspector--pinned", isPinned);
    pane.closeEl.hidden = !isPinned;

    pane.titleEl.textContent = subject.kind === "lair" ? "Lair" : "Site Detail";
    pane.el.classList.toggle(
      "game-panel--site-inspector--lair",
      subject.kind === "lair",
    );

    pane.bodyEl.innerHTML = "";
    if (subject.kind === "lair") {
      /* The tile's own contents, under a per-pane id prefix — several tablists can be up at
       * once, and shared tab ids would leave every `aria-labelledby` ambiguous. */
      renderLairPanelInto(pane.bodyEl, `${pane.el.id}-lair`);
      return;
    }
    const loc = getLocationById(content, subject.locationId);
    if (loc === undefined) {
      return;
    }
    pane.bodyEl.appendChild(
      buildLocationCardArticle(
        loc,
        securityLevelForLocation(state.locationSecurityStates, loc.id),
        intelLevelAtLocation(state, loc.id),
        state.locationAssetSlots.find((p) => p.locationId === loc.id)?.slots ?? [],
        new Map(content.assets.map((a) => [a.id, a.name])),
        state.phase === "main",
        state.locationRequiredTraits[loc.id] ?? [],
        state.locationSecurityTraits[loc.id] ?? [],
      ),
    );
  }

  /** Re-measure where the lines meet the panes, then redraw them. */
  function refreshMapLeader(): void {
    refreshMapLeaderAnchor();
    const plot = currentPlotSize();
    if (plot !== null) {
      syncMapLeaderLine(plot);
    }
  }

  /**
   * A pane's height follows whichever card is in it, and its line meets it halfway down, so
   * every card swap moves an anchor. Observing is what catches the art loading in a beat after
   * the card is built and growing a pane under a line already drawn.
   */
  const siteInspectorResizeObserver = new ResizeObserver(() => {
    refreshMapLeader();
  });
  for (const pane of inspectorPanes) {
    siteInspectorResizeObserver.observe(pane.el);
  }

  /**
   * A pane sliding between slots moves its leader's landing point the whole way there, and the
   * anchors are cached rather than measured per frame. So the slide is tracked for exactly as
   * long as it runs: a handful of frames, only while one is actually happening.
   */
  const INSPECTOR_SLIDE_MS = 220;
  let inspectorSlideUntil = 0;
  let inspectorSlideRaf: number | null = null;

  function trackInspectorSlide(): void {
    inspectorSlideUntil = performance.now() + INSPECTOR_SLIDE_MS;
    if (inspectorSlideRaf !== null) {
      return;
    }
    const step = (): void => {
      refreshMapLeader();
      if (performance.now() >= inspectorSlideUntil) {
        inspectorSlideRaf = null;
        return;
      }
      inspectorSlideRaf = requestAnimationFrame(step);
    };
    inspectorSlideRaf = requestAnimationFrame(step);
  }

  /* The rAF window is timed off the CSS duration, so its last frame can land a beat before the
   * transition's own — which would leave a line pointing just short of where its pane stopped.
   * The end event is the one moment the final position is certainly readable. */
  for (const pane of inspectorPanes) {
    pane.el.addEventListener("transitionend", (e) => {
      if (e.propertyName === "right") {
        refreshMapLeader();
      }
    });
  }

  function setHoveredMapSubject(subject: MapSubject | null): void {
    if (mapSubjectKey(hoveredMapSubject) === mapSubjectKey(subject)) {
      return;
    }
    hoveredMapSubject = subject;
    syncMapReticle();
    renderSiteInspector();
  }

  /**
   * Takes a subject out of the selection. Selecting a site staged it in two places — the
   * inspector and the mission target slot — so letting it go has to undo both, or the map keeps
   * a pin lit for a card that is gone. A target staged from somewhere else is left alone: only
   * the one this subject put there.
   */
  function dropPinnedMapSubject(subject: MapSubject): void {
    const key = mapSubjectKey(subject);
    const before = pinnedMapSubjects.length;
    pinnedMapSubjects = pinnedMapSubjects.filter((s) => mapSubjectKey(s) !== key);
    if (pinnedMapSubjects.length === before) {
      return;
    }
    renderSiteInspector();
    if (
      subject.kind === "site" &&
      assignTarget?.kind === "location" &&
      assignTarget.locationId === subject.locationId
    ) {
      assignTarget = null;
      renderAssignPickSlots();
      renderAssignMinionSlots();
      onAssignSlotsChanged();
    }
  }

  /**
   * Adds a subject to the selection, on the left of the stack. Past the cap the oldest card —
   * the one at the right corner — falls off, so a click on the map always shows you what you
   * just clicked rather than quietly doing nothing once the row is full.
   */
  function pushPinnedMapSubject(subject: MapSubject): void {
    if (isPinnedMapSubject(subject)) {
      return;
    }
    while (pinnedMapSubjects.length >= MAX_INSPECTOR_CARDS) {
      const evicted = pinnedMapSubjects[0];
      if (evicted === undefined) {
        break;
      }
      dropPinnedMapSubject(evicted);
    }
    pinnedMapSubjects = [...pinnedMapSubjects, subject];
    renderSiteInspector();
  }

  /**
   * Markers are rebuilt on every map render, so the hover is read off the map panel rather than
   * bound to each pin. Sites are known by the location id they already carry for the drag
   * payload; the lair has none to carry and is flagged instead.
   */
  function mapMarkerSubject(target: EventTarget | null): MapSubject | null {
    const el =
      target instanceof Element ? target.closest<HTMLElement>(".map-marker") : null;
    if (el === null) {
      return null;
    }
    if (el.dataset.mapLair === "true") {
      return { kind: "lair" };
    }
    const locationId = el.dataset.locationId;
    return locationId === undefined ? null : { kind: "site", locationId };
  }

  mapPanelEl.addEventListener("pointerover", (e) => {
    const subject = mapMarkerSubject(e.target);
    if (subject !== null) {
      setHoveredMapSubject(subject);
    }
  });
  mapPanelEl.addEventListener("pointerout", (e) => {
    const key = mapSubjectKey(mapMarkerSubject(e.target));
    if (key === null || key !== mapSubjectKey(hoveredMapSubject)) {
      return;
    }
    /* Moving between a pin's own children is not leaving it. */
    const to = e.relatedTarget instanceof Node ? e.relatedTarget : null;
    if (to !== null && mapSubjectKey(mapMarkerSubject(to)) === key) {
      return;
    }
    setHoveredMapSubject(null);
  });
  /* Pins are buttons, so tabbing the map inspects them the same way hovering does. */
  mapPanelEl.addEventListener("focusin", (e) => {
    setHoveredMapSubject(mapMarkerSubject(e.target));
  });
  mapPanelEl.addEventListener("focusout", (e) => {
    if (mapSubjectKey(mapMarkerSubject(e.target)) === mapSubjectKey(hoveredMapSubject)) {
      setHoveredMapSubject(null);
    }
  });

  /**
   * A marker click is a toggle: a second one on an already-selected marker lets that card go,
   * and the cards left of it shuffle right into the gap. Returns whether the click selected
   * rather than deselected — the caller decides what else selecting means.
   */
  function toggleMapPin(subject: MapSubject): boolean {
    if (isPinnedMapSubject(subject)) {
      dropPinnedMapSubject(subject);
      return false;
    }
    pushPinnedMapSubject(subject);
    return true;
  }

  /* A pane's X drops whatever that pane is showing, not whatever was selected last. */
  for (const pane of inspectorPanes) {
    pane.closeEl.addEventListener("click", () => {
      if (pane.subject !== null) {
        dropPinnedMapSubject(pane.subject);
      }
    });
  }

  /** The dashboard Lair tile, and the inspector when the lair marker is the one being shown. */
  function renderLairPanel(): void {
    renderLairPanelInto(lairPanelEl, "lair-panel");
  }

  /**
   * Both surfaces that draw the lair, rendered from one place so a tab picked on either is the
   * tab both are on. `idPrefix` namespaces the tablist: the tile and the inspector can be up
   * together, and two tablists sharing tab ids would leave every `aria-labelledby` ambiguous.
   */
  function renderLairPanelInto(container: HTMLElement, idPrefix: string): void {
    container.innerHTML = "";
    if (state.activeLairId === null) {
      const empty = document.createElement("p");
      empty.className = "assets-panel-empty";
      empty.textContent = "No lair in this run.";
      container.appendChild(empty);
      return;
    }
    const lair = getLairById(content, state.activeLairId);
    if (!lair) {
      const empty = document.createElement("p");
      empty.className = "assets-panel-empty";
      empty.textContent = "Lair not found in catalog.";
      container.appendChild(empty);
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
    container.appendChild(header);

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
      /* The column or tab already says "Upgrades"; keep just the level part here. */
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

    function fillLairSectionInto(section: LairPanelSection, container: HTMLElement): void {
      if (section === "missions") {
        fillLairMissionsInto(container);
      } else if (section === "upgrades") {
        fillLairUpgradesInto(container);
      } else if (section === "active") {
        renderActiveMissionsInto(container);
      } else {
        fillAssetsInto(container);
      }
    }

    if (currentMenu === "lair") {
      const columnsWrap = document.createElement("div");
      columnsWrap.className = "lair-panel-columns";
      for (const def of LAIR_MENU_COLUMNS) {
        const column = document.createElement("section");
        column.className = "lair-panel-column";
        column.setAttribute("aria-label", def.label);

        const heading = document.createElement("h3");
        heading.className = "game-controls-heading lair-panel-column-title";
        heading.textContent = def.label;

        const list = document.createElement("div");
        list.className = "lair-panel-missions";
        fillLairSectionInto(def.id, list);

        column.appendChild(heading);
        column.appendChild(list);
        columnsWrap.appendChild(column);
      }
      container.appendChild(columnsWrap);
      return;
    }

    const tablist = document.createElement("div");
    tablist.className = "lair-panel-tabs";
    tablist.setAttribute("role", "tablist");
    tablist.setAttribute("aria-label", "Lair sections");

    for (const def of DASHBOARD_LAIR_TABS) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "lair-panel-tab";
      if (def.id === lairPanelTab) {
        tab.classList.add("lair-panel-tab--active");
      }
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", def.id === lairPanelTab ? "true" : "false");
      tab.id = `${idPrefix}-tab-${def.id}`;
      tab.textContent = def.label;
      tab.addEventListener("click", () => {
        if (lairPanelTab === def.id) {
          return;
        }
        lairPanelTab = def.id;
        renderLairPanel();
        renderSiteInspector();
      });
      tablist.appendChild(tab);
    }
    container.appendChild(tablist);

    const list = document.createElement("div");
    list.className = "lair-panel-missions";
    list.setAttribute("role", "tabpanel");
    list.setAttribute("aria-labelledby", `${idPrefix}-tab-${lairPanelTab}`);
    fillLairSectionInto(lairPanelTab, list);
    container.appendChild(list);
  }

  function activityEventTone(ev: ActivityEvent): "neutral" | "good" | "bad" {
    switch (ev.kind) {
      case "mission_completed":
        return ev.result === "success" ? "good" : ev.result === "compromised" ? "neutral" : "bad";
      case "minion_hired":
      case "minion_rehired":
      case "minion_leveled_up":
      case "asset_gained":
        return "good";
      case "mission_aborted":
      case "asset_lost":
      case "agent_ability_used":
        return "bad";
      case "run_ended":
        return ev.ending.kind === "victory" ? "good" : "bad";
      default:
        return "neutral";
    }
  }

  function renderActivityLogModal(): void {
    activityLogVerdict.textContent = `Turn ${state.turnNumber}`;
    activityLogBody.innerHTML = "";
    const log = state.activityLog;
    if (log.length === 0) {
      const empty = document.createElement("p");
      empty.className = "turn-report-description";
      empty.textContent = "No activity yet.";
      activityLogBody.appendChild(empty);
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
          const heat = signedDelta(ev.heatDelta);
          const templateFx =
            ev.templateEffectDescriptions.length > 0
              ? ev.templateEffectDescriptions.join("; ")
              : "none";
          const outcomeLabel = missionOutcomeLabel(ev.result);
          let line = `${ev.missionName} @ ${whereLabel}: ${outcomeLabel} (roll ${ev.roll} vs ${ev.successChancePercent}%). Total infamy change ${inf}, total heat change ${heat}. Mission effects: ${templateFx}.`;
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
      section.className = "turn-report-block";
      const headingId = `activity-turn-h-${i}`;
      section.setAttribute("aria-labelledby", headingId);

      const heading = document.createElement("h3");
      heading.id = headingId;
      heading.className = "turn-report-block__title";
      heading.textContent = `Turn ${entry.turnNumber}`;
      section.appendChild(heading);

      const ul = document.createElement("ul");
      ul.className = "turn-report-lines";
      const { events } = entry;
      const visibleEvents = events.filter(
        (ev) =>
          ev.kind !== "agent_moved" ||
          isOpposingAgentMoveVisibleToPlayer(
            state,
            ev.agentInstanceId,
            ev.fromLocationId,
            ev.toLocationId,
          ),
      );

      if (visibleEvents.length === 0) {
        const li = document.createElement("li");
        li.className = "turn-report-line";
        li.textContent = "No missions completed this resolve.";
        ul.appendChild(li);
      } else {
        for (const ev of visibleEvents) {
          const li = document.createElement("li");
          const tone = activityEventTone(ev);
          li.className =
            tone === "neutral" ? "turn-report-line" : `turn-report-line turn-report-line--${tone}`;
          li.textContent = formatActivityEvent(ev);
          ul.appendChild(li);
        }
      }
      section.appendChild(ul);
      activityLogBody.appendChild(section);
    }
  }

  function openActivityLogModal(): void {
    renderActivityLogModal();
    activityLogBody.scrollTop = 0;
    overlayActivityLog.hidden = false;
    overlayActivityLog.setAttribute("aria-hidden", "false");
    btnActivityLogClose.focus();
  }

  function closeActivityLogModal(): void {
    overlayActivityLog.hidden = true;
    overlayActivityLog.setAttribute("aria-hidden", "true");
    hudShort.focus();
  }

  /**
   * Push `collapsedPanels` onto the DOM. The button's label flips with the state because the
   * icon alone (a minus that becomes a plus) says nothing to a screen reader.
   */
  function applyPanelCollapse(): void {
    for (const button of panelMinimizeButtons) {
      const key = button.dataset.panelMinimize;
      const panel = button.closest<HTMLElement>(".game-panel");
      if (key === undefined || panel === null) {
        continue;
      }
      const collapsed = collapsedPanels.has(key);
      panel.classList.toggle("game-panel--collapsed", collapsed);
      button.setAttribute("aria-expanded", String(!collapsed));
      const name = panel.querySelector(".game-panel-title")?.textContent?.trim() ?? "panel";
      button.setAttribute("aria-label", `${collapsed ? "Expand" : "Minimize"} ${name} panel`);
    }
  }

  for (const button of panelMinimizeButtons) {
    button.addEventListener("click", () => {
      const key = button.dataset.panelMinimize;
      if (key === undefined) {
        return;
      }
      if (collapsedPanels.has(key)) {
        collapsedPanels.delete(key);
      } else {
        collapsedPanels.add(key);
      }
      applyPanelCollapse();
    });
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
    /* Dashboard floats the panels over a full-bleed map; every other menu is one panel wide. */
    omegaBodyEl.classList.toggle("omega-body--floating", showDashboard);
    applyPanelCollapse();

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
    renderSiteInspector();
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

  hudShort.addEventListener("click", () => {
    openActivityLogModal();
  });

  btnActivityLogClose.addEventListener("click", () => {
    closeActivityLogModal();
  });

  activityLogBackdrop.addEventListener("click", () => {
    closeActivityLogModal();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlayActivityLog.hidden) {
      e.stopPropagation();
      closeActivityLogModal();
    }
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
      statBlockHtml(ICON_STAR, "Infamy", String(p.infamy)) +
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
          title:
            ev.result === "success"
              ? "Mission success"
              : ev.result === "compromised"
                ? "Mission compromised"
                : "Mission failed",
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
    turnReportVerdict.textContent = missionOutcomeLabel(m.outcome);

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
        turnReportBlock(m.outcome === "aborted" ? "Aborted" : missionEffectsGroupTitle(m.outcome), [
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
    const compromised = report.missions.filter((m) => m.outcome === "compromised").length;
    const losses = report.missions.length - wins - compromised;

    turnReportKicker.textContent = "End of turn";
    turnReportTitle.textContent = `Turn ${report.turnNumber} Summary`;
    turnReportVerdict.className = "turn-report-verdict turn-report-verdict--tally";
    turnReportVerdict.textContent =
      report.missions.length === 0
        ? "No missions resolved"
        : compromised > 0
          ? `${wins} won · ${compromised} compromised · ${losses} lost`
          : `${wins} won · ${losses} lost`;

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
    hudShort.textContent = `Turn ${state.turnNumber}`;

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
    renderSiteInspector();
    if (!overlayActivityLog.hidden) {
      renderActivityLogModal();
    }
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
  buildMapLayersPanel();
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
