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
  missionTargetTypeTargetsLocation,
  supportAbilitiesForAssetIds,
  type MissionTargetLocationFilters,
  type SuccessChanceBreakdown,
} from "./game/mission";
import {
  dynamicTraitDisplayLabel,
  dynamicTraitStyle,
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
  INTEL_SITE_IDENTITY,
  intelLevelAtLocation,
  isLocationIdentifiedByPlayer,
  isOpposingAgentMoveVisibleToPlayer,
  MAX_INTEL_LEVEL,
  playerFacingLocationName,
  playerVisibleOpposingAgentsAtLocation,
  totalPlayerVisibleOpposingAgents,
  UNKNOWN_LOCATION_NAME,
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
import { createNoveltyLedger } from "./ui/novelty";
import { observeWorldNovelty, siteNoveltySubject } from "./ui/worldNovelty";
import { startBootSequence, type BootSequenceHandle } from "./ui/bootSequence";
import { initSettingsMenu } from "./ui/playerSettings";
import { initStageScale, STAGE_WIDTH } from "./ui/stageScale";
import {
  INBOUND_CALLOUT_CLASS,
  playDispatchSequence,
  revealInboundCallout,
  type DispatchRow,
} from "./ui/dispatchSequence";
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
  diffReadouts,
  heatPressure,
  rollDurationSeconds,
  rolledValue,
  type StatChange,
} from "./ui/statDelta";
import {
  MAP_LAYER_GROUPS,
  MAP_LAYER_PLOT_CLASSES,
  MAP_OVERLAY_SCALE_MAX,
  MAP_OVERLAY_SCALE_MIN,
  MAP_OVERLAY_SCALE_STEP,
  clampMapOverlayScale,
  loadMapLayers,
  loadMapOverlayScale,
  mapLayerPlotClasses,
  saveMapLayers,
  saveMapOverlayScale,
  type MapLayerKey,
  type MapLayerState,
} from "./ui/map/mapLayers";
import { omegaPhaseTargetsByLocation } from "./ui/map/omegaTargets";
import { createGlitchDirector } from "./ui/glitchDirector";
import { initDragFocus } from "./ui/dragFocus";
import { initDragTether } from "./ui/dragTether";
import { initDragToken, setDragTokenFaces, type DragTokenFace } from "./ui/dragToken";
import {
  beginCardDrag,
  initDropHints,
  playLanding,
  playRefusal,
  setCardDragPayload,
  wireDropSlot,
} from "./ui/dropHint";
import { initRunSetup, type RunSetupApi } from "./ui/runSetup";
import { freshRow, stableRow, type RowSlots } from "./ui/stableRow";
import {
  buildLocationBrief,
  locationDesignation,
  type LocationBriefAssetRow,
} from "./ui/locationBrief";
import { buildMissionBrief, missionAssetCell, type MissionBriefAssetRow } from "./ui/missionBrief";
import { briefPanel } from "./ui/cardBrief";
import { buildMinionBrief } from "./ui/minionBrief";
import { initGlobalTooltips, setTooltip, tooltipText } from "./ui/tooltip";
import {
  appendCardArtShell,
  appendCardHeroOverlay,
  appendCardHeroShell,
  createCardArtImg,
  loadCardArt,
  unloadCardArt,
  withDeferredCardArt,
  resolveAgentCardArt,
  resolveAssetCardArt,
  resolveLairCardArt,
  resolveMissionCardArt,
  resolvePlayerLocationCardArt,
  resolveMinionCardArt,
  resolveOmegaPlanCardArt,
  resolveUnknownCardArt,
  resolveUnknownCardArtThumb,
} from "./ui/cardArt";

/*
 * The description half of the stat tooltips — one line each, because every tooltip in the app
 * is a name and one short line under it (see `ui/tooltip.ts`). These were four-line rule dumps
 * before; what survives the cut is what a player who does not know the stat needs, which is the
 * range it moves in and what moving it buys them. The exact per-level unlock tables live in
 * `design/SYSTEM_REFERENCE.md`, which is where a designer looks anyway.
 */

/** What intel is, on the location card's Intel Level label and the Intel effect badges. */
const INTEL_LEVEL_TOOLTIP_DESC =
  "What you know about a site, 0 to 3: each step uncovers more — its asset slots, then what is in them, then the agents standing there.";

/** What security is, on the location card's Security Level label and the Security effect badges. */
const SECURITY_LEVEL_TOOLTIP_DESC =
  "The site's defensive alert level, 0 up to its location level. Each point reveals one more security trait that missions here have to cover.";

/** What infamy is, on the status bar stat block and the Infamy effect badges. */
const INFAMY_TOOLTIP_DESC =
  "Your organization's notoriety, 0 to 100. Higher infamy unlocks lair upgrade levels, better recruits in the hire pool, and events gated behind it.";

/** What heat is, on the status bar stat block and the Heat effect badges. */
const HEAT_TOOLTIP_DESC =
  "Law-enforcement attention, 0 to 100. It sets the Threat Level tier — which never drops once reached — raising the opposing-agent cap and your heat gain each turn.";

/** What the planner's odds ring and the active-mission Success chance row are reading. */
const SUCCESS_CHANCE_TOOLTIP_DESC =
  "The odds this plan succeeds: the share of its required traits and assets the crew covers, adjusted by statuses, relationships, support assets, timed events and agent challenge traits.";

/** Locations drawer columns left-to-right; locations filtered and sorted within each. */
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

/** The menus filed as drawers along the bottom of the map, keyed by `data-drawer` in the markup. */
const DRAWER_IDS = ["omega", "missions", "minions", "assets", "locations", "lair"] as const;

type DrawerId = (typeof DRAWER_IDS)[number];

function isDrawerId(value: string | undefined): value is DrawerId {
  return value !== undefined && (DRAWER_IDS as readonly string[]).includes(value);
}

type LairInspectorTab = "missions" | "active" | "upgrades";

/**
 * Lair sections shown as tabs on the lair's map inspector card, which is a quarter of the map
 * wide — too narrow for the drawer's columns.
 */
const LAIR_INSPECTOR_TABS: readonly { id: LairInspectorTab; label: string }[] = [
  { id: "missions", label: "Missions" },
  { id: "active", label: "Active Missions" },
  { id: "upgrades", label: "Upgrades" },
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
const LEVEL_ICON_SVG_PATHS =
  '<polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/>';
/* Site-category sigils. Each names what the player means to do to a place rather than what the
 * place is: an arsenal to arm from, a government to work on strings, a market to crash. Solid
 * silhouettes (filled parts carry their own `fill`, overriding the pin's stroked default) so they
 * survive the pin's 1.1rem glyph box; strings and the crash line stay strokes. */
const MILITARY_ICON_SVG_PATHS =
  '<g fill="currentColor" stroke="none"><path d="M13.8 8.88 17 3.34A10 10 0 0 1 22 12h-6.4a3.6 3.6 0 0 0-1.8-3.12Z"/><path d="M13.8 15.12 17 20.66a10 10 0 0 1-10 0l3.2-5.54a3.6 3.6 0 0 0 3.6 0Z"/><path d="M8.4 12H2a10 10 0 0 1 5-8.66l3.2 5.54A3.6 3.6 0 0 0 8.4 12Z"/><circle cx="12" cy="12" r="2"/></g>';
const POLITICAL_ICON_SVG_PATHS =
  '<path d="M6 2.2h12M4 2.2v8M12 2.2v5M20 2.2v8" stroke-width="1.1"/><path fill="currentColor" stroke="none" d="M2.8 21.5V9.6l4.8 4.2L12 6.6l4.4 7.2 4.8-4.2v11.9Z"/>';
const ECONOMIC_ICON_SVG_PATHS =
  '<path d="M2 5l7 7 4-4 8 8" stroke-width="2.6"/><path fill="currentColor" stroke="none" d="M22.5 19.5v-8l-8 8Z"/>';
/** Map pin glyph per site category — a radiation trefoil, a crown on puppet strings, a plunging
 * market line — so type reads without leaning on colour alone. */
const MAP_MARKER_TYPE_ICON_SVG_PATHS: Record<LocationType, string> = {
  military: MILITARY_ICON_SVG_PATHS,
  political: POLITICAL_ICON_SVG_PATHS,
  economic: ECONOMIC_ICON_SVG_PATHS,
};

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

/**
 * The glyph a pill wears for one catalog trait: the trait's own icon where it has been given
 * one, else the generic mark this pill has always drawn — `kind` picks which generic, since a
 * trait listed as a site's security is marked with the shield rather than the tag.
 *
 * A trait that has an icon uses it in both places. The icon is the trait's identity, and the
 * pill still says which list it is in through its own colour and border.
 */
function createTraitPillIconEl(
  trait: Trait | undefined,
  kind: "trait" | "security",
): Element {
  if (trait?.icon !== undefined) {
    const img = document.createElement("img");
    img.className = "minions-trait-pill__icon minions-trait-pill__icon--art";
    img.src = trait.icon;
    img.alt = "";
    img.decoding = "async";
    return img;
  }
  return kind === "security" ? createSecurityIconEl() : createTraitIconEl();
}

function createSecurityIconEl(): SVGElement {
  return createSvgPillIcon(SECURITY_ICON_SVG_PATHS);
}

function createAssetIconEl(): SVGElement {
  return createSvgPillIcon(ASSET_ICON_SVG_PATHS);
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

/**
 * How many roster minions hold a given skill — the third line of every skill tooltip.
 *
 * A module-level hook rather than an argument threaded down: the count is a fact about the
 * player's roster, identical for every pill on screen and unrelated to the card any one of them
 * is drawn on. Carrying it by parameter would mean a new argument on `createTraitPillEl` and on
 * all five helpers that call it, at every call site, to move one number that never differs
 * between them. Bound once by `bindRosterSkillCounts` when the game boots; until then it reports
 * `null` and the line is simply left off, which is also what the title screen wants.
 */
let rosterSkillCountFor: (traitId: string) => number | null = () => null;

function bindRosterSkillCounts(read: (traitId: string) => number): void {
  rosterSkillCountFor = read;
}

/**
 * The kind mark a skill tooltip opens with, in place of the trait's own name — the pill under
 * the pointer is already showing that, and repeating it costs the line that could say what kind
 * of thing it is instead.
 *
 * A status is not a skill and does not claim to be one: the leading noun is the category, and
 * the word after the dash is the type within it. `dynamic` rows never reach here (they are
 * art-only and excluded from every requirement and level-up pool — see `game/types.ts`), but
 * the catalog type admits them, so they get an honest mark rather than a cast.
 */
const TRAIT_TOOLTIP_KIND_MARK: Record<Trait["type"], string> = {
  primary: "Skill - Primary",
  secondary: "Skill - Secondary",
  status_positive: "Status - Positive",
  status_negative: "Status - Negative",
  dynamic: "Standing",
};

/** The noun the roster-count line uses, so a status is never counted as a skill. */
const TRAIT_TOOLTIP_KIND_NOUN: Record<Trait["type"], string> = {
  primary: "skill",
  secondary: "skill",
  status_positive: "status",
  status_negative: "status",
  dynamic: "standing",
};

const TRAIT_TOOLTIP_DESC: Record<Trait["type"], string> = {
  primary: "A core skill. It covers this requirement on any mission that asks for it.",
  secondary: "A supporting skill. It covers this requirement on any mission that asks for it.",
  status_positive: "A good turn for this minion: +10% mission success chance while it holds.",
  status_negative: "A bad turn for this minion: −20% mission success chance while it holds.",
  dynamic: "A standing projected from this minion's affinity scores, not a skill it can be given.",
};

/** "You have 3 minions with this skill", or nothing at all before the roster exists. */
function rosterSkillCountLine(noun: string, count: number | null): string | undefined {
  if (count === null) {
    return undefined;
  }
  if (count === 0) {
    return `You have no minions with this ${noun}`;
  }
  return `You have ${count} minion${count === 1 ? "" : "s"} with this ${noun}`;
}

function formatStaticTraitTooltip(trait: Trait | undefined, traitId: string): string {
  if (!trait) {
    return traitId;
  }
  return tooltipText(
    TRAIT_TOOLTIP_KIND_MARK[trait.type],
    TRAIT_TOOLTIP_DESC[trait.type],
    rosterSkillCountLine(TRAIT_TOOLTIP_KIND_NOUN[trait.type], rosterSkillCountFor(traitId)),
  );
}

function formatDynamicTraitTooltip(
  catalog: ReturnType<typeof loadContent>,
  roster: readonly MinionInstance[],
  dt: DynamicTrait,
): string {
  const label = dynamicTraitDisplayLabel(catalog, roster, dt);
  switch (dt.kind) {
    case "friend":
      return tooltipText(label, "Relationship: +5% mission success when these two are sent out together.");
    case "ally":
      return tooltipText(label, "Relationship: +10% mission success when these two are sent out together.");
    case "rival":
      return tooltipText(label, "Relationship: −5% mission success when these two are sent out together.");
    case "hatred":
      return tooltipText(label, "Relationship: −10% mission success when these two are sent out together.");
    case "hero":
      return tooltipText(label, "Standing: +5% mission success on any mission aimed at this location.");
    case "wanted":
      return tooltipText(label, "Standing: −5% mission success on any mission aimed at this location.");
  }
}

/**
 * `caption` is the kind mark a mission card's requirement cells wear over the name — "Skill"
 * here, "Asset" on the cells beside them (`ui/missionBrief.ts`). It is what carries the
 * distinction the two column headings used to, now that skills and assets share one grid. Every
 * other context leaves it off: a pill in a stats row or a minion's trait list is already under a
 * heading that says what it is, and a caption there would only repeat it on every chip.
 */
function createTraitPillEl(
  catalog: ReturnType<typeof loadContent>,
  traitId: string,
  rosterTraitIds?: ReadonlySet<string>,
  iconKind: "trait" | "security" = "trait",
  caption?: string,
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
  span.appendChild(createTraitPillIconEl(trait, iconKind));
  const text = document.createElement("span");
  text.className = "minions-trait-pill__label";
  text.textContent = trait?.name ?? traitId;
  span.appendChild(caption === undefined ? text : captionedPillText(caption, text));
  return span;
}

/**
 * Wraps a pill's name in a column with its kind caption above it — the two-line text half of a
 * mission card's requirement cell. The label element is passed in rather than built here so the
 * caller keeps ownership of it, whether it holds a trait's name or an asset's.
 */
function captionedPillText(caption: string, label: HTMLElement): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "minions-trait-pill__text";
  const cap = document.createElement("span");
  cap.className = "minions-trait-pill__caption";
  cap.textContent = caption;
  wrap.appendChild(cap);
  wrap.appendChild(label);
  return wrap;
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
    /* An id with no catalog entry — or one naming an art-only `dynamic` row, which no minion
     * can hold — is a content bug; park it at the end rather than guessing. */
    if (trait === undefined || trait.type === "dynamic") {
      return 99;
    }
    return TRAIT_TYPE_DISPLAY_ORDER[trait.type];
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

/** The pills for a minion's Skills section (`ui/minionBrief.ts`): its catalog traits, then
 * whatever dynamic traits play has hung on this instance. */
function minionSkillPillEls(
  catalog: ReturnType<typeof loadContent>,
  traitIds: string[],
  dynamic?: { roster: MinionInstance[]; traits: readonly DynamicTrait[] },
): HTMLElement[] {
  const rosterTraits = dynamic?.traits ?? [];
  const roster = dynamic?.roster ?? [];
  const pills: HTMLElement[] = [];

  for (const tid of sortedTraitIdsForDisplay(catalog, traitIds)) {
    pills.push(createTraitPillEl(catalog, tid));
  }
  for (const dtrait of rosterTraits) {
    const span = document.createElement("span");
    span.className = "minions-trait-pill minions-trait-pill--trait";
    span.tabIndex = 0;
    span.title = formatDynamicTraitTooltip(catalog, roster, dtrait);
    span.appendChild(createTraitPillIconEl(dynamicTraitStyle(catalog, dtrait.kind), "trait"));
    const text = document.createElement("span");
    text.className = "minions-trait-pill__label";
    text.textContent = dynamicTraitDisplayLabel(catalog, roster, dtrait);
    span.appendChild(text);
    pills.push(span);
  }
  return pills;
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
  setTooltip(cpBadge, "CP Cost", "Command points spent to hire this minion. Your CP pool refills at the start of every turn.");
  cpBadge.tabIndex = 0;
  cpBadge.setAttribute("aria-label", `CP Cost: ${stats.cpCost}`);
  cpBadge.innerHTML = `${MINION_STAT_ICON_CP}<span class="minions-card-badge__value">${stats.cpCost}</span>`;

  const levelBadge = document.createElement("div");
  levelBadge.className = "minions-card-badge minions-card-badge--level";
  setTooltip(levelBadge, "Level", "The minion's rank. It rises with XP, and each level unlocks the next skill on this minion's track.");
  levelBadge.tabIndex = 0;
  levelBadge.setAttribute("aria-label", `Level: ${stats.level}`);
  levelBadge.innerHTML = `${MINION_STAT_ICON_LEVEL}<span class="minions-card-badge__value">${stats.level}</span>`;

  const xpBadge = document.createElement("div");
  xpBadge.className = "minions-card-badge minions-card-badge--xp";
  setTooltip(xpBadge, "XP", "Experience, earned for every mission this minion finishes. Enough of it levels them up and resets to zero.");
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
  setTooltip(targetBadge, "Target", "What this mission can be aimed at — a site, an asset stored in one, a minion, or nothing at all.");
  targetBadge.tabIndex = 0;
  targetBadge.setAttribute("aria-label", `Target: ${stats.target}`);
  targetBadge.innerHTML = `${MISSION_STAT_ICON_TARGET}<span class="minions-card-badge__value">${stats.target}</span>`;

  const cpBadge = document.createElement("div");
  cpBadge.className = "minions-card-badge minions-card-badge--cp";
  setTooltip(cpBadge, "Cost", "Command points spent to launch this mission. Paid when you deploy, and not refunded if it fails.");
  cpBadge.tabIndex = 0;
  cpBadge.setAttribute("aria-label", `Cost: ${stats.cpCost}`);
  cpBadge.innerHTML = `${MINION_STAT_ICON_CP}<span class="minions-card-badge__value">${stats.cpCost}</span>`;

  const durationBadge = document.createElement("div");
  durationBadge.className = "minions-card-badge minions-card-badge--duration";
  setTooltip(durationBadge, "Duration", "Turns the mission runs before it resolves. Its crew is committed for the whole of it.");
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
  setTooltip(typeBadge, "Location Type", "The site's category — political, economic or military. Missions filter on it, so it decides what can be aimed here.");
  typeBadge.tabIndex = 0;
  typeBadge.setAttribute("aria-label", `Location Type: ${stats.type}`);
  typeBadge.innerHTML = `${LOCATION_STAT_ICON_TYPE}<span class="minions-card-badge__value">${stats.type}</span>`;

  const levelBadge = document.createElement("div");
  levelBadge.className = "minions-card-badge minions-card-badge--level";
  setTooltip(levelBadge, "Location Level", "How well defended the site is, 1 to 3. It caps security level and sets how many site traits a mission here must cover.");
  levelBadge.tabIndex = 0;
  levelBadge.setAttribute("aria-label", `Location Level: ${stats.level}`);
  levelBadge.innerHTML = `${MINION_STAT_ICON_LEVEL}<span class="minions-card-badge__value">${stats.level}</span>`;

  const securityBadge = document.createElement("div");
  securityBadge.className = "minions-card-badge minions-card-badge--security";
  setTooltip(securityBadge, "Security Level", SECURITY_LEVEL_TOOLTIP_DESC);
  securityBadge.tabIndex = 0;
  securityBadge.setAttribute("aria-label", `Security Level: ${stats.securityLevel}`);
  securityBadge.innerHTML = `${LOCATION_STAT_ICON_SECURITY}<span class="minions-card-badge__value">${stats.securityLevel}</span>`;

  const intelBadge = document.createElement("div");
  intelBadge.className = "minions-card-badge minions-card-badge--intel";
  setTooltip(intelBadge, "Intel Level", INTEL_LEVEL_TOOLTIP_DESC);
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
  /* A support asset leads with what it does on a mission — that is the reason to carry one —
   * and falls back to its flavour line when it has no ability to report. */
  const desc: string[] = [];
  if (asset.supportAbility !== undefined) {
    desc.push(describeSupportAssetAbility(asset.supportAbility));
  }
  if (asset.description) {
    desc.push(asset.description);
  }
  return tooltipText(header, desc.join(" "));
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
  { label: string; iconPaths: string; tooltipDesc: string }
> = {
  infamy: {
    label: "Infamy",
    iconPaths: INFAMY_ICON_SVG_PATHS,
    tooltipDesc: INFAMY_TOOLTIP_DESC,
  },
  heat: {
    label: "Heat",
    iconPaths: HEAT_ICON_SVG_PATHS,
    tooltipDesc: HEAT_TOOLTIP_DESC,
  },
  intel: {
    label: "Intel level",
    iconPaths: INTEL_ICON_SVG_PATHS,
    tooltipDesc: INTEL_LEVEL_TOOLTIP_DESC,
  },
  security: {
    label: "Security level",
    iconPaths: SECURITY_ICON_SVG_PATHS,
    tooltipDesc: SECURITY_LEVEL_TOOLTIP_DESC,
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

/** The signed number inside a stat effect's value — the reading the badge is built around. */
const MISSION_EFFECT_DELTA_RE = /[+\u2212-]?\d+%?/;

/**
 * Splits a stat value into the delta and whatever qualifies it. Most are the number alone
 * ("+15"), but a scoped one carries words on one or both sides of it — "-1 at all political
 * locations", "globally -1 (all playable locations)" — and those words are a footnote on the
 * reading, not a part of it. Returns the number and the rest rejoined, or a null note when the
 * value is nothing but the number.
 */
function splitMissionEffectStatValue(value: string): { delta: string; note: string | null } {
  const match = MISSION_EFFECT_DELTA_RE.exec(value);
  if (match === null) {
    return { delta: value, note: null };
  }
  const note = `${value.slice(0, match.index)} ${value.slice(match.index + match[0].length)}`
    .replace(/\s+/g, " ")
    .trim();
  return { delta: match[0], note: note === "" ? null : note };
}

/**
 * One stat effect as a stat badge, built like the location-card and mission-cost badges: the
 * stat's icon stands in for its name, which moves into the hover tooltip and the accessible
 * label, leaving the badge to read as icon + delta.
 *
 * The delta is set large enough to be read across the card at a glance, which is the whole point
 * of a badge. A qualifier that comes with it is not, and stays at the size of the outcome lines
 * around it: left at the delta's size, a scoped effect's sentence swelled to three lines of
 * display face and drowned out the plain numbers beside it.
 */
function createMissionEffectStatBadgeEl(stat: MissionEffectStat, value: string): HTMLElement {
  const meta = MISSION_EFFECT_STAT_META[stat];
  const { delta, note } = splitMissionEffectStatValue(value);
  const badge = document.createElement("span");
  badge.className = `mission-card-effects__stat-chip mission-card-effects__stat-chip--${stat}`;
  if (note !== null) {
    /* A qualified badge takes a line of its own — it is a sentence, and sitting it in among the
     * bare numbers would leave them looking like part of it. */
    badge.classList.add("mission-card-effects__stat-chip--noted");
  }
  badge.tabIndex = 0;
  badge.setAttribute("aria-label", `${meta.label} ${value}`);
  /* The delta is already the large text on the badge, so the tooltip names the stat rather than
   * repeating the reading back — the question a bare icon raises is "what is this". */
  setTooltip(badge, meta.label, meta.tooltipDesc);
  badge.appendChild(createSvgPillIcon(meta.iconPaths, "mission-card-effects__stat-icon"));
  const valueEl = document.createElement("span");
  valueEl.className = "mission-card-effects__stat-value";
  valueEl.textContent = delta;
  badge.appendChild(valueEl);
  if (note !== null) {
    const noteEl = document.createElement("span");
    noteEl.className = "mission-card-effects__stat-note";
    noteEl.textContent = note;
    badge.appendChild(noteEl);
  }
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

/**
 * The mission card's own required-asset cells: one cell per distinct required asset, aggregating
 * duplicate ids in a mission's requirement list into a single cell with a quantity — the brief
 * lists what a mission needs, not how many times its authors happened to repeat an id.
 */
function missionRequiredAssetRows(
  assetIds: readonly string[],
  ownedAssets: Readonly<Record<string, number>>,
  catalog: ReturnType<typeof loadContent>,
): MissionBriefAssetRow[] {
  const counts = new Map<string, number>();
  for (const id of assetIds) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const rows: MissionBriefAssetRow[] = [];
  for (const [assetId, quantity] of counts) {
    const template = catalog.assets.find((a) => a.id === assetId);
    rows.push({
      assetId,
      name: template?.name ?? assetId,
      quantity,
      variant: (ownedAssets[assetId] ?? 0) >= quantity ? "have" : "missing",
      caption: "Asset",
      tooltip: formatStaticAssetTooltip(template, assetId),
    });
  }
  return rows;
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

/** `Name — what it does` per committed support asset, as the one description line a stat-row
 * tooltip gets under its label. */
function supportAssetTooltipDesc(
  catalog: ReturnType<typeof loadContent>,
  supportAssetIds: readonly string[],
): string {
  return supportAssetIds
    .map((id) => {
      const a = catalog.assets.find((x) => x.id === id);
      if (a?.supportAbility === undefined) {
        return `${a?.name ?? id} — no effect`;
      }
      return `${a.name} — ${describeSupportAssetAbility(a.supportAbility)}`;
    })
    .join("; ");
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
    /* Deduped: several pinned sites the player cannot identify all render under the one
       Unknown name, and "Unknown or Unknown" says nothing the single word does not. */
    parts.push([...new Set(siteIds.map((id) => locationName?.(id) ?? id))].join(" or "));
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

  /* Read through the live binding rather than captured once: `dispatch` replaces `state`, and a
   * skill tooltip is built fresh on every render, so the count is always this turn's roster. */
  bindRosterSkillCounts(
    (traitId) => state.player.minions.filter((m) => m.traitIds.includes(traitId)).length,
  );

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
  const assignSupportAssetsList = req<HTMLElement>("assign-support-assets-list");
  const planColumnPanelEl = req<HTMLElement>("plan-column-panel-plan");
  const planColumnEl = req<HTMLElement>("plan-column");
  const btnAssign = req<HTMLButtonElement>("btn-assign-mission");
  const assignSubmitWrapEl = req<HTMLElement>("assign-submit-wrap");
  const assignBlockedAlertEl = req<HTMLElement>("assign-blocked-alert");
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
  const lairPanelEl = req<HTMLElement>("lair-panel");
  const assetsPanelEl = req<HTMLElement>("assets-panel");
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
  /** The menu drawers filed along the bottom of the map, in slot order. */
  interface MenuDrawer {
    readonly id: DrawerId;
    readonly el: HTMLElement;
    readonly tabEl: HTMLButtonElement;
    readonly panelEl: HTMLElement;
  }
  const menuDrawers: MenuDrawer[] = Array.from(
    document.querySelectorAll<HTMLElement>("[data-drawer]"),
  ).map((el) => {
    const id = el.dataset.drawer;
    const tabEl = el.querySelector<HTMLButtonElement>(".drawer-tab");
    const panelEl = el.querySelector<HTMLElement>(".drawer__panel");
    if (!isDrawerId(id) || tabEl === null || panelEl === null) {
      throw new Error(`Malformed menu drawer: ${id ?? "(no id)"}`);
    }
    return { id, el, tabEl, panelEl };
  });
  const panelMinimizeButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-panel-minimize]"),
  );
  /**
   * Which floating panels are minimized to their header, keyed by `data-panel-minimize`.
   *
   * The run opens with Map Layers folded to its header so the first thing on screen is the map.
   * The planner keeps its column — it is the only panel with a job to do before anything has
   * been looked at.
   */
  const collapsedPanels = new Set<string>(["map-layers"]);

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
  /**
   * Missions whose dispatch packet is still crossing the screen. Assigning applies immediately,
   * so their callouts would otherwise show the crew standing at the target before the upload
   * carrying them lands; while an id is in here its callout renders held back (see
   * `createMissionCalloutEl`), and the sequence's arrival is what lets it up. Purely cosmetic —
   * nothing reads this to decide anything about the run.
   */
  const missionsInFlight = new Set<string>();
  /** Why Submit is disabled, in short "flash on a click" form — null when it is not. Set by
   * `applyAssignButtonEnabled`, read by the click handler that cannot reach a disabled button
   * any other way (see `.btn-submit-mission-wrap` in styles.css). */
  let assignBlockReason: string | null = null;
  let assignBlockedAlertHideTimer: ReturnType<typeof setTimeout> | null = null;
  let dndDragSource:
    | { kind: "roster" }
    | { kind: "slot"; slotIndex: number }
    | { kind: "mission-slot" }
    | { kind: "assign-target" }
    | null = null;

  /**
   * What an inspector pane stands for. Most stand for a map marker: every marker but one is a
   * site, the odd one out being the player's own lair, which has no location id to be known by
   * and shows the Lair tile's contents rather than a location card. The global event offer is
   * the one subject with no marker behind it at all — the run puts it in the corner pane
   * itself rather than the player pointing at anything — so it draws no leader line.
   */
  type MapSubject =
    | { readonly kind: "site"; readonly locationId: string }
    | { readonly kind: "lair" }
    | { readonly kind: "event" };

  /** A subject flattened to something comparable, and the key its marker is cached under. */
  function mapSubjectKey(subject: MapSubject | null): string | null {
    if (subject === null) {
      return null;
    }
    switch (subject.kind) {
      case "site":
        /* Not spelled out here. The novelty ledger keys its breadcrumbs on the same strings this
         * function returns, which is what lets a hover clear a mark a sampler raised with no
         * lookup table in between — so the site spelling is taken from the module that owns it
         * rather than written twice and hoped about. */
        return siteNoveltySubject(subject.locationId);
      case "lair":
        return "lair";
      case "event":
        return "event";
    }
  }

  /**
   * What has changed in the world that the player has not been shown yet.
   *
   * Fed once per `refresh` and read by whichever surface draws the flag; see `ui/novelty.ts` for
   * the shape and `ui/worldNovelty.ts` for the facets. It sits beside `mapSubjectKey` above on
   * purpose — the subjects it holds are spelled the same way that function spells markers, which
   * is what lets a click on a pin clear the mark a sampler raised without a lookup table.
   *
   * Player-attention state, not run state, so it is held here rather than in `GameState` — the
   * same line the map layers and the settings draw. `startRun` clears it, and the first sample
   * after that is a silent baseline.
   */
  const novelty = createNoveltyLedger();

  /**
   * How long the pointer has to stay on a marker before its breadcrumb counts as read.
   *
   * Hovering is what puts the site's card on screen, so hovering *is* being shown the thing —
   * but only if the hover was a look rather than a pass. Without a dwell, one sweep of the
   * pointer across the map on the way to a drawer wipes every flag it brushes, and the player
   * never sees a single one of the cards those flags were pointing at. Long enough to mean
   * "stopped here", short enough that nobody deliberately reading a card has to wait for it.
   */
  const MAP_NOVELTY_DWELL_MS = 300;

  /** The pending dwell, if the pointer is currently resting on something flagged. */
  let mapNoveltyDwell: number | null = null;

  function cancelMapNoveltyDwell(): void {
    if (mapNoveltyDwell !== null) {
      window.clearTimeout(mapNoveltyDwell);
      mapNoveltyDwell = null;
    }
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

  let lairInspectorTab: LairInspectorTab = "missions";
  /** The drawer pulled up over the map, or `null` when the map is clear. */
  let openDrawer: DrawerId | null = null;

  function findMissionOrEventTemplate(id: string): MissionTemplate | undefined {
    return content.missions.find((m) => m.id === id) ?? content.events.find((e) => e.id === id);
  }

  /**
   * The global event offer on the table, or null when there is none to show: none drawn yet,
   * the offer already taken (its mission is out), or the slot cooling down. An id with no
   * template behind it in the catalog counts as none.
   */
  function currentEventOfferId(): string | null {
    const id = state.currentEventTemplateId;
    return id !== null && content.events.some((e) => e.id === id) ? id : null;
  }

  /** Whether the event the player took is still out; the offer slot stays empty until it lands. */
  function eventMissionRunning(): boolean {
    return state.activeMissions.some((am) => am.missionSource === "event");
  }

  /**
   * One asset an effect hands over or takes away, built by the exact same cell
   * {@link missionAssetCell} draws for a mission's Requirements grid — the generic crate mark,
   * the ruled divider, a caption over the name. There is nothing to hold here, so the accent
   * carries which panel it sits in (`good` for On Success, `bad` for On Failure) rather than a
   * have/missing pair, and the caption names the direction instead of the generic "Asset" a
   * requirement wears. One builder behind both, so the two can never drift on how an asset is
   * shown on a mission card.
   */
  function missionEffectAssetCell(
    catalog: ReturnType<typeof loadContent>,
    assetId: string,
    tone: "good" | "bad",
    direction: "gain" | "lose",
  ): HTMLElement {
    const template = catalog.assets.find((a) => a.id === assetId);
    return missionAssetCell({
      assetId,
      name: template?.name ?? assetId,
      quantity: 1,
      variant: tone,
      caption: direction === "gain" ? "Gain Asset" : "Lose Asset",
      tooltip: formatStaticAssetTooltip(template, assetId),
      preview: (el) => attachAssetRowPreview(el, assetId),
    });
  }

  function renderMissionEffectItemEls(
    effect: MissionEffect,
    catalog: ReturnType<typeof loadContent>,
    tone: "good" | "bad",
  ): HTMLElement[] {
    const toneClass =
      tone === "good" ? "mission-card-effects__item--good" : "mission-card-effects__item--bad";

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

  /**
   * One outcome — a framed `briefPanel` holding a `card-brief__assets` list of rows, plus, when
   * the outcome hands over an asset, a one-column run of the same cells a mission's Requirements
   * section builds (`card-brief__pills--grid`, single column rather than two since there is no
   * skill column to sit beside). The same frame the brief's own two sections come in
   * (`ui/missionBrief.ts`), toned green or red so the two halves of this row are told apart by
   * their edge rather than by reading their headings.
   */
  function missionEffectsPanel(
    heading: string,
    effects: readonly MissionEffect[],
    catalog: ReturnType<typeof loadContent>,
    tone: "good" | "bad",
  ): HTMLElement {
    const { panel, body } = briefPanel(
      heading,
      tone === "good" ? "brief-panel--good" : "brief-panel--bad",
    );

    /* Every asset an outcome hands over or takes away is pulled out of the line-by-line list and
     * drawn as its own cell in a single-column run instead — see `missionEffectAssetCell`. Order
     * follows the effect list, and an exchange still names its removal before its gain. */
    const assetGrants: Array<{ assetId: string; direction: "gain" | "lose" }> = [];
    for (const effect of effects) {
      if (effect.kind === "gain_assets") {
        for (const assetId of effect.assetIds) {
          assetGrants.push({ assetId, direction: "gain" });
        }
      } else if (effect.kind === "exchange_assets") {
        for (const assetId of effect.removeAssetIds) {
          assetGrants.push({ assetId, direction: "lose" });
        }
        for (const assetId of effect.gainAssetIds) {
          assetGrants.push({ assetId, direction: "gain" });
        }
      }
    }
    const otherEffects = effects.filter(
      (e) => e.kind !== "gain_assets" && e.kind !== "exchange_assets",
    );

    const list = document.createElement("ul");
    list.className = "card-brief__assets";
    for (const item of missionEffectListItemEls(otherEffects, catalog, tone)) {
      list.appendChild(item);
    }
    if (list.childElementCount > 0) {
      body.appendChild(list);
    }

    if (assetGrants.length > 0) {
      const grid = document.createElement("div");
      grid.className = "card-brief__pills card-brief__pills--grid card-brief__pills--single";
      for (const { assetId, direction } of assetGrants) {
        grid.appendChild(missionEffectAssetCell(catalog, assetId, tone, direction));
      }
      body.appendChild(grid);
    }

    return panel;
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

    /* Two framed panels side by side, each half the row. Success and failure are the same kind
     * of statement about the same job, so neither gets the wider half — and a mission with only
     * one outcome's worth of effects gets a single panel across the whole row rather than a
     * half-width one with a gap beside it. */
    const container = document.createElement("div");
    container.className = "mission-card-effects";

    if (successEffects.length > 0) {
      container.appendChild(missionEffectsPanel("On Success", successEffects, catalog, "good"));
    }
    if (failureEffects.length > 0) {
      container.appendChild(missionEffectsPanel("On Failure", failureEffects, catalog, "bad"));
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
    const generic = "Drag a target here";
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

  /**
   * What a drag payload looks like in hand (`src/ui/dragToken.ts`): the art and name of the chip
   * it becomes once staged, down to the "site - Slot n" an asset target is labelled with, so the
   * token the player carries is the thing that lands. A staged minion chip hands over its bare
   * instance id rather than JSON.
   */
  function dragTokenFace(raw: string): DragTokenFace | null {
    const minionFace = (instanceId: string): DragTokenFace | null => {
      const inst = state.player.minions.find((m) => m.instanceId === instanceId);
      if (inst === undefined) {
        return null;
      }
      const tpl = content.minions.find((t) => t.id === inst.templateId);
      return { art: resolveMinionCardArt(tpl), label: tpl?.name ?? instanceId };
    };
    const payload = parseDragPayload(raw);
    if (payload === null) {
      return minionFace(raw.trim());
    }
    switch (payload.kind) {
      case "mastermind-mission": {
        const tpl = findMissionOrEventTemplate(payload.missionTemplateId);
        return { art: resolveMissionCardArt(tpl), label: tpl?.name ?? payload.missionTemplateId };
      }
      case "mastermind-location":
        return {
          art: siteCardArt(payload.locationId),
          label: siteDisplayName(payload.locationId),
        };
      case "mastermind-asset": {
        /* Mirrors the staged target preview (see the `targetPick.kind === "asset"` branch
         * below): a hidden asset is not the player's to see yet, so the token they carry stays
         * the same sealed card it dropped in as, rather than flashing the site's own art and
         * name — which would read as the asset revealing itself mid-drag. */
        if (payload.visibility !== "revealed") {
          return { art: resolveUnknownCardArt(), label: "Hidden Asset" };
        }
        const placement = state.locationAssetSlots.find((p) => p.locationId === payload.locationId);
        const slot = placement?.slots[payload.slotIndex];
        const tpl =
          slot !== undefined && isOccupiedAssetSlot(slot)
            ? content.assets.find((a) => a.id === slot.assetId)
            : undefined;
        return {
          art: resolveAssetCardArt(tpl),
          label: tpl?.name ?? `${siteDisplayName(payload.locationId)} - Slot ${payload.slotIndex + 1}`,
        };
      }
      case "mastermind-minion":
        return minionFace(payload.instanceId);
      case "mastermind-asset-card": {
        const tpl = content.assets.find((a) => a.id === payload.assetId);
        return { art: resolveAssetCardArt(tpl), label: tpl?.name ?? payload.assetId };
      }
    }
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

  /** Whether the player can identify the site; below that it shows as "Unknown" everywhere. */
  function isSiteIdentified(locationId: string): boolean {
    return isLocationIdentifiedByPlayer(intelLevelAtLocation(state, locationId));
  }

  /** A site's name as the player knows it — "Unknown" while intel there is 0. */
  function siteDisplayName(locationId: string): string {
    return playerFacingLocationName(content, state.locationIntelStates, locationId);
  }

  /** A site's card art as the player sees it — static while intel there is 0. */
  function siteCardArt(locationId: string): string {
    return resolvePlayerLocationCardArt(
      getLocationById(content, locationId),
      isSiteIdentified(locationId),
    );
  }

  /**
   * `missionSuccessOptionsForTarget` as the player is allowed to see it. An Unknown site's
   * rolled site and security traits are not the player's to know, so previews leave them out —
   * the same rule as hidden agents' challenge traits. The resolve roll still counts them.
   */
  function playerVisibleSuccessOptionsForTarget(
    target: MissionTarget,
    supportAbilities?: Parameters<typeof missionSuccessOptionsForTarget>[2],
  ): ReturnType<typeof missionSuccessOptionsForTarget> {
    const lid = getMissionTargetLocationId(target);
    if (lid !== null && !isSiteIdentified(lid)) {
      return {};
    }
    return missionSuccessOptionsForTarget(state, target, supportAbilities);
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

  /** Stages a mission into the planner's mission slot, replacing whatever was staged before. */
  function applyMissionPayloadToPlanner(payload: MissionDragPayload): boolean {
    if (payload.source === "event") {
      if (state.phase !== "main") {
        return false;
      }
      if (
        state.currentEventTemplateId === null ||
        payload.missionTemplateId !== state.currentEventTemplateId
      ) {
        return false;
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
    return true;
  }

  /**
   * The target a location/asset/minion payload would stage, or `null` when the planner would turn
   * it away. No side effects, so the target slot's drop hint can ask the same question the drop
   * does.
   */
  function stageableTarget(
    payload: Exclude<AnyDragPayload, MissionDragPayload>,
  ): MissionTarget | null {
    const m = selectedMissionTemplate();
    if (m?.targetType === "none") {
      return null;
    }
    if (!targetPayloadMatchesPlannedMission(payload)) {
      return null;
    }
    const mt = payloadToMissionTarget(payload);
    if (!mt) {
      return null;
    }
    if (mt.kind === "location" || mt.kind === "asset") {
      const playable = new Set(runLocations().map((l) => l.id));
      if (!playable.has(mt.locationId)) {
        return null;
      }
    }
    if (mt.kind === "asset") {
      const placement = state.locationAssetSlots.find((p) => p.locationId === mt.locationId);
      const slot = placement?.slots[mt.slotIndex];
      const intel = intelLevelAtLocation(state, mt.locationId);
      if (effectiveVisibilityOfSlot(slot, intel) !== mt.visibilityAtAssign) {
        return null;
      }
    }
    if (mt.kind === "minion") {
      const busy = busyInstanceIds(state.activeMissions);
      const inst = state.player.minions.find((x) => x.instanceId === mt.instanceId);
      if (!inst || busy.has(mt.instanceId)) {
        return null;
      }
      if (getAssignParticipantIds().includes(mt.instanceId)) {
        return null;
      }
    }
    return mt;
  }

  /** Stages a location/asset/minion into the planner's target slot, replacing any prior pick. */
  function applyTargetPayloadToPlanner(
    payload: Exclude<AnyDragPayload, MissionDragPayload>,
  ): boolean {
    const mt = stageableTarget(payload);
    if (!mt) {
      return false;
    }
    if (mt.kind === "minion") {
      removeInstanceFromAllAssignSlots(mt.instanceId);
    }
    assignTarget = mt;
    renderAssignPickSlots();
    renderAssignMinionSlots();
    onAssignSlotsChanged();
    return true;
  }

  /**
   * Where an add-to-planner click sent its card: the drop slot it was meant for (its
   * `wireDropSlot` key) and whether the slot took it. `null` when there was no slot to send it to.
   */
  type PlannerSend = { slot: string; staged: boolean } | null;

  /**
   * Small reticle button pinned to a card's corner that stages it into the planner on click. The
   * card arrives the way a dropped one does — landing in its slot, or shaken off by it — so the
   * button and the drag read as two ways of doing the same thing.
   */
  function appendAddToPlannerButton(
    card: HTMLElement,
    ariaLabel: string,
    onClick: () => PlannerSend,
  ): void {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "card-add-to-planner-btn";
    btn.setAttribute("aria-label", ariaLabel);
    setTooltip(btn, "Add to Plan", `${ariaLabel}, the same way dragging the card there would.`);
    btn.innerHTML = ICON_CROSSHAIR;
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const sent = onClick();
      if (sent === null) {
        return;
      }
      if (sent.staged) {
        playLanding(sent.slot);
      } else {
        playRefusal(sent.slot);
      }
    });
    btn.addEventListener("mousedown", (ev) => {
      ev.stopPropagation();
    });
    card.appendChild(btn);
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
    if (kind === "mission") {
      wireDropSlot(el, {
        key: "mission",
        accepts: ["mastermind-mission"],
        isFilled: () => assignMissionTemplateId !== null,
        onDrop: (raw) => {
          const payload = parseDragPayload(raw);
          return payload?.kind === "mastermind-mission" && applyMissionPayloadToPlanner(payload);
        },
      });
      return;
    }
    /* Every target kind, narrowed per card by the same test the drop makes — which kind the
     * planned mission wants, whether this site passes its filters, whether this minion is free —
     * so a mission after a bank never lights the slot up for a minion or for a different site. */
    const targetPayload = (raw: string): Exclude<AnyDragPayload, MissionDragPayload> | null => {
      const payload = parseDragPayload(raw);
      return payload === null || payload.kind === "mastermind-mission" ? null : payload;
    };
    wireDropSlot(el, {
      key: "target",
      accepts: ["mastermind-location", "mastermind-asset", "mastermind-minion"],
      canTake: (raw) => {
        const payload = targetPayload(raw);
        return payload !== null && stageableTarget(payload) !== null;
      },
      isFilled: () => assignTarget !== null,
      onDrop: (raw) => {
        const payload = targetPayload(raw);
        return payload !== null && applyTargetPayloadToPlanner(payload);
      },
    });
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

  /** Whether required slot `slotIndex` asks for `assetId` and an owned unit of it is still free. */
  function canStageRequiredAssetSlot(slotIndex: number, assetId: string): boolean {
    const req = selectedMissionTemplate()?.requiredAssetIds ?? [];
    if (req[slotIndex] !== assetId) {
      return false;
    }
    const owned = state.player.assets[assetId] ?? 0;
    return owned - stagedAssetUnits(assetId, { list: "required", index: slotIndex }) >= 1;
  }

  /** Puts one owned unit of `assetId` in required slot `slotIndex`, if the slot asks for it. */
  function stageRequiredAssetSlot(slotIndex: number, assetId: string): boolean {
    if (!canStageRequiredAssetSlot(slotIndex, assetId)) {
      return false;
    }
    assignAssetSlotAssetIds[slotIndex] = assetId;
    renderAssignMinionSlots();
    onAssignSlotsChanged();
    return true;
  }

  /** Whether `assetId` is a support asset with an owned unit still free for slot `slotIndex`. */
  function canStageSupportAssetSlot(slotIndex: number, assetId: string): boolean {
    const tpl = content.assets.find((a) => a.id === assetId);
    if (tpl === undefined || !isSupportAsset(tpl)) {
      return false;
    }
    const owned = state.player.assets[assetId] ?? 0;
    return owned - stagedAssetUnits(assetId, { list: "support", index: slotIndex }) >= 1;
  }

  /** Puts one owned unit of `assetId` in support slot `slotIndex`, if it is a support asset. */
  function stageSupportAssetSlot(slotIndex: number, assetId: string): boolean {
    if (!canStageSupportAssetSlot(slotIndex, assetId)) {
      return false;
    }
    assignSupportAssetIds[slotIndex] = assetId;
    renderAssignMinionSlots();
    onAssignSlotsChanged();
    return true;
  }

  /** Drop-slot keys for the asset slots, shared by their wiring and the add-to-planner button. */
  function requiredAssetSlotKey(slotIndex: number): string {
    return `asset-${slotIndex}`;
  }

  function supportAssetSlotKey(slotIndex: number): string {
    return `support-${slotIndex}`;
  }

  /**
   * The asset card's add-to-planner action: fills the first empty required slot that asks for
   * this asset, else the first empty support slot. Never replaces an asset already staged.
   */
  function applyAssetToPlanner(assetId: string): PlannerSend {
    const req = selectedMissionTemplate()?.requiredAssetIds ?? [];
    const reqIndex = req.findIndex(
      (id, i) => id === assetId && (assignAssetSlotAssetIds[i] ?? null) === null,
    );
    if (reqIndex >= 0) {
      return {
        slot: requiredAssetSlotKey(reqIndex),
        staged: stageRequiredAssetSlot(reqIndex, assetId),
      };
    }
    syncAssignSupportSlotArray();
    const supportIndex = assignSupportAssetIds.findIndex((id) => id === null);
    if (supportIndex < 0) {
      return null;
    }
    return {
      slot: supportAssetSlotKey(supportIndex),
      staged: stageSupportAssetSlot(supportIndex, assetId),
    };
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
      wireDropSlot(slot, {
        key: requiredAssetSlotKey(slotIndex),
        accepts: ["mastermind-asset-card"],
        canTake: (raw) => {
          const parsed = parseDragPayload(raw);
          return (
            parsed?.kind === "mastermind-asset-card" &&
            canStageRequiredAssetSlot(slotIndex, parsed.assetId)
          );
        },
        isFilled: () => (assignAssetSlotAssetIds[slotIndex] ?? null) !== null,
        onDrop: (raw) => {
          const parsed = parseDragPayload(raw);
          return (
            parsed?.kind === "mastermind-asset-card" &&
            stageRequiredAssetSlot(slotIndex, parsed.assetId)
          );
        },
      });

      const slotTag = req.length > 1 ? `Required ${String(slotIndex + 1)}` : "Required";
      const placed = assignAssetSlotAssetIds[slotIndex] ?? null;
      if (placed === null) {
        /* No article: asset names are as often plural ("Mercenary Contracts") as singular, and
         * the slot's own tag already says this one is required. */
        const name = content.assets.find((a) => a.id === requiredId)?.name ?? requiredId;
        fillEmptyPlanSlot(slot, slotTag, `Drag ${name} here`, "lair");
      } else {
        const tpl = content.assets.find((a) => a.id === placed);
        const chip = document.createElement("div");
        chip.className = "assign-minion-chip assign-asset-chip";
        chip.appendChild(createCardArtImg(resolveAssetCardArt(tpl), "card-art--chip"));
        const chipMain = document.createElement("div");
        chipMain.className = "plan-slot-main assign-minion-chip-main";
        chipMain.appendChild(createPlanSlotTag(slotTag));
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
      renderAssetsPanel();
      return;
    }
    assignSupportAssetsFieldset.hidden = false;
    const mainOnly = state.phase === "main";
    const wrap = document.createElement("div");
    wrap.className = "assign-minion-slots assign-asset-slots assign-support-asset-slots";

    for (let slotIndex = 0; slotIndex < cap; slotIndex += 1) {
      const slot = document.createElement("div");
      slot.className = "assign-minion-slot assign-asset-slot assign-support-asset-slot";
      slot.dataset.supportSlotIndex = String(slotIndex);
      wireDropSlot(slot, {
        key: supportAssetSlotKey(slotIndex),
        accepts: ["mastermind-asset-card"],
        canTake: (raw) => {
          const parsed = parseDragPayload(raw);
          return (
            parsed?.kind === "mastermind-asset-card" &&
            canStageSupportAssetSlot(slotIndex, parsed.assetId)
          );
        },
        isFilled: () => (assignSupportAssetIds[slotIndex] ?? null) !== null,
        onDrop: (raw) => {
          const parsed = parseDragPayload(raw);
          return (
            parsed?.kind === "mastermind-asset-card" &&
            stageSupportAssetSlot(slotIndex, parsed.assetId)
          );
        },
      });

      const slotTag = cap > 1 ? `Support ${String(slotIndex + 1)}` : "Support";
      const placed = assignSupportAssetIds[slotIndex] ?? null;
      if (placed === null) {
        fillEmptyPlanSlot(slot, slotTag, "Drag a support asset here", "lair");
      } else {
        const tpl = content.assets.find((a) => a.id === placed);
        const chip = document.createElement("div");
        chip.className = "assign-minion-chip assign-asset-chip";
        chip.appendChild(createCardArtImg(resolveAssetCardArt(tpl), "card-art--chip"));
        const chipMain = document.createElement("div");
        chipMain.className = "plan-slot-main assign-minion-chip-main";
        chipMain.appendChild(createPlanSlotTag(slotTag));
        const chipLabel = document.createElement("span");
        chipLabel.className = "assign-minion-chip-label";
        chipLabel.textContent = tpl?.name ?? placed;
        chipMain.appendChild(chipLabel);
        chip.appendChild(chipMain);
        /* The effect used to wrap onto a second line, which made a filled support slot taller
         * than the empty one it replaced. It moves to the hover text instead, like every other
         * collapsed chip in this column. */
        if (tpl?.supportAbility !== undefined) {
          setTooltip(chip, tpl.name, describeSupportAssetAbility(tpl.supportAbility));
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
    /* Staging a support asset changes what is still spare, which the Assets menu shows. */
    renderAssetsPanel();
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
   * `attachAssignPickPreview` for a manifest row, building the card only once it is first
   * hovered.
   *
   * The planner can afford to build its preview eagerly: there are at most a handful of chips
   * staged at once. These rows are on every mission and location card in a list — a full drawer
   * is dozens of cards with a few required assets each, so eager construction would build
   * hundreds of detached card trees per render, nearly all of them never looked at. Built on
   * demand and then kept, so a row the player keeps returning to pays for it once.
   */
  function attachAssetRowPreview(row: HTMLElement, assetId: string): void {
    let card: HTMLElement | null = null;
    row.addEventListener("mouseenter", () => {
      card ??= buildAssetPreviewArticle(assetId);
      showAssignPickPreview(row, card);
    });
    row.addEventListener("mouseleave", hideAssignPickPreview);
    /* A row that is also a drag handle for the planner target must not leave its card floating
     * over the drag it just started. */
    row.addEventListener("dragstart", hideAssignPickPreview);
  }

  /**
   * What a slot is for, printed in the slot's own row above whatever is standing in it.
   *
   * The planner's three sections carry the headings now, so a label stacked over every slot as
   * well would be headings over headings down the whole column. Inside the row it rides with the
   * name instead, and an empty slot keeps it in exactly the place a filled one does — the row
   * does not re-lay itself out the moment a card lands.
   */
  function createPlanSlotTag(text: string): HTMLElement {
    const tag = document.createElement("span");
    tag.className = "plan-slot-tag";
    tag.textContent = text;
    return tag;
  }

  /** A drawer's name, read off the tab in the markup so the two never drift apart. */
  function drawerLabel(id: DrawerId): string {
    const drawer = menuDrawers.find((d) => d.id === id);
    return drawer?.tabEl.querySelector(".drawer-tab__label")?.textContent?.trim() ?? id;
  }

  /**
   * Which menu fills this slot: the one holding the cards it takes. The target slot's answer
   * depends on the staged mission, since what counts as a target is the mission's to say — and
   * with no mission staged yet a site is the overwhelmingly likely answer, so that is the one
   * offered rather than nothing.
   */
  function targetSlotMenu(): DrawerId {
    return selectedMissionTemplate()?.targetType === "minion" ? "minions" : "locations";
  }

  /**
   * An empty slot's contents: the reticle standing where the thumbnail will be, the slot's tag,
   * and what to drag into it. Every slot in the planner draws its empty state through here, so
   * the four kinds stay one row.
   *
   * `menu` makes the row a button that pulls up the drawer holding the cards this slot takes.
   * Dragging is the gesture the planner is built around, but it only works for a player who has
   * already found the menu with the card in it — so the empty slot is also the way *to* that
   * menu, which is the one thing a player stuck at an empty slot is looking for. It stands down
   * outside the main phase, along with the rest of the planner's interactivity.
   */
  function fillEmptyPlanSlot(
    host: HTMLElement,
    tag: string,
    hint: string,
    menu: DrawerId | null,
  ): void {
    const opens = menu !== null && state.phase === "main";
    const row = document.createElement(opens ? "button" : "div");
    row.className = opens ? "plan-slot-empty plan-slot-empty--opens" : "plan-slot-empty";
    if (row instanceof HTMLButtonElement && menu !== null) {
      row.type = "button";
      const label = drawerLabel(menu);
      row.setAttribute("aria-label", `${tag} slot: ${hint}. Opens the ${label} menu.`);
      /* The hint gets one line beside the tag, and an asset's can be longer than that — the line
       * ellipses, so the whole of it plus what the click does is on the hover. */
      setTooltip(row, `${tag} Slot`, `${hint}. Click to open the ${label} menu.`);
      row.addEventListener("click", () => {
        setOpenDrawer(menu);
      });
    } else {
      setTooltip(row, `${tag} Slot`, hint);
    }

    const ghost = document.createElement("span");
    ghost.className = "plan-slot-ghost";
    ghost.setAttribute("aria-hidden", "true");
    ghost.textContent = "+";
    row.appendChild(ghost);

    const main = document.createElement("div");
    main.className = "plan-slot-main";
    main.appendChild(createPlanSlotTag(tag));
    const ph = document.createElement("span");
    ph.className = "assign-minion-slot-placeholder";
    ph.textContent = hint;
    main.appendChild(ph);
    row.appendChild(main);

    host.appendChild(row);
  }

  /**
   * The collapsed form of a staged mission or target. It takes over the drag affordance the
   * embedded card used to carry, and reveals `card` on hover or keyboard focus.
   */
  function buildAssignPickChip(
    artSrc: string,
    tag: string,
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
    const main = document.createElement("div");
    main.className = "plan-slot-main assign-pick-chip-main";
    main.appendChild(createPlanSlotTag(tag));
    const name = document.createElement("span");
    name.className = "assign-pick-chip-label";
    name.textContent = label;
    main.appendChild(name);
    chip.appendChild(main);
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
      fillEmptyPlanSlot(missionSlot, "Mission", "Drag a mission here", "missions");
    } else {
      const wrap = document.createElement("div");
      wrap.className = "assign-pick-slot-card-wrap";

      const missionTpl = findMissionOrEventTemplate(assignMissionTemplateId);
      const mergedForAssign =
        missionTpl !== undefined
          ? mergedRequiredTraitIdsSorted(
              missionTpl,
              assignTarget !== null ? playerVisibleSuccessOptionsForTarget(assignTarget) : {},
            )
          : undefined;

      const article = buildMissionCatalogArticle(assignMissionTemplateId, mergedForAssign);
      article.classList.add("assign-pick-preview-card");
      wrap.appendChild(
        buildAssignPickChip(
          resolveMissionCardArt(missionTpl),
          "Mission",
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
            beginCardDrag(e, json);
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
        beginCardDrag(e, locationDragJson(t.locationId));
      } else if (t.kind === "asset") {
        beginCardDrag(e, assetDragJson(t.locationId, t.slotIndex, t.visibilityAtAssign));
      } else if (t.kind === "minion") {
        beginCardDrag(e, minionDragJson(t.instanceId));
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
      fillEmptyPlanSlot(targetSlot, "Target", assignTargetPlaceholderText(), targetSlotMenu());
    } else if (targetPick.kind === "location") {
      const loc = content.locations.find((l) => l.id === targetPick.locationId);
      if (!loc) {
        fillEmptyPlanSlot(targetSlot, "Target", "Unknown location", targetSlotMenu());
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
            siteCardArt(loc.id),
            "Target",
            siteDisplayName(loc.id),
            article,
            mainOnly,
            setDragDataForTarget,
          ),
        );
        appendClearTarget(wrap);
        targetSlot.appendChild(wrap);
      }
    } else if (targetPick.kind === "asset") {
      const placement = state.locationAssetSlots.find((p) => p.locationId === targetPick.locationId);
      const slot = placement?.slots[targetPick.slotIndex];
      const siteIdentified = isSiteIdentified(targetPick.locationId);
      const siteName = siteDisplayName(targetPick.locationId);
      const targetIntel = intelLevelAtLocation(state, targetPick.locationId);
      /*
       * The staged card is the *asset*, not the site holding it — the site is a stat row on it.
       * A hidden asset has no name or art the player has earned yet, so it wears the Unknown
       * site's static: the same "aiming at something you cannot see" read the map already gives.
       */
      const revealedSlot =
        slot !== undefined &&
        isOccupiedAssetSlot(slot) &&
        effectiveVisibilityOfSlot(slot, targetIntel) === "revealed"
          ? slot
          : null;
      const assetTemplate =
        revealedSlot !== null
          ? content.assets.find((a) => a.id === revealedSlot.assetId)
          : undefined;
      /* An emptied slot is a stage that went stale — the asset was taken out from under the plan
       * between staging and now. Submit already refuses it; the card just says so plainly. */
      const assetGone = slot === undefined || slot.kind === "empty";
      const assetName =
        revealedSlot !== null
          ? (assetTemplate?.name ?? revealedSlot.assetId)
          : assetGone
            ? "Empty Slot"
            : "Hidden Asset";
      const assetArt =
        revealedSlot !== null ? resolveAssetCardArt(assetTemplate) : resolveUnknownCardArt();
      const wrap = document.createElement("div");
      wrap.className = "assign-pick-slot-card-wrap";
      const article = document.createElement("article");
      article.className = "assign-pick-preview-card location-card assign-target-asset-card";
      if (revealedSlot === null) {
        article.classList.add("location-card--unknown");
      }
      const { meta, body } = appendCardHeroShell(article, assetArt);
      const title = document.createElement("h4");
      title.className = "location-card-title";
      title.textContent = assetName;
      meta.appendChild(title);
      const dl = document.createElement("dl");
      dl.className = "location-card-stats";
      const siteIds = state.locationRequiredTraits[targetPick.locationId] ?? [];
      const secLevel = state.locationSecurityStates.find(
        (s) => s.locationId === targetPick.locationId,
      )?.securityLevel;
      const securityTraitIds = state.locationSecurityTraits[targetPick.locationId] ?? [];
      const revealedSecIds = securityTraitIds.slice(
        0,
        Math.min(secLevel ?? 0, securityTraitIds.length),
      );
      const siteRowValue = `${siteName} - Slot ${targetPick.slotIndex + 1}`;
      const siteWrap = document.createElement("span");
      siteWrap.className = "location-asset-static";
      siteWrap.appendChild(createAssetIconEl());
      siteWrap.appendChild(document.createTextNode(siteRowValue));
      appendMinionStatRows(dl, [
        {
          label: "Site",
          value: siteRowValue,
          valueEl: siteWrap,
          dtClass: "location-card-stats__assets-dt",
          ddClass: "location-card-stats__assets-dd",
        },
        {
          label: "Status",
          value: revealedSlot !== null ? "Revealed" : assetGone ? "Gone" : "Hidden",
        },
        {
          label: "Intel level",
          value: String(targetIntel),
          labelTooltipDesc: INTEL_LEVEL_TOOLTIP_DESC,
        },
      ]);
      body.appendChild(dl);
      /* An Unknown site's traits are not the player's to see (see `buildLocationCardArticle`). */
      const reqPillsEl = siteIdentified
        ? createLocationRequirementPillsEl(
            content,
            siteIds,
            revealedSecIds,
            unionParticipantTraitIds(state.player.minions),
          )
        : null;
      if (reqPillsEl !== null) {
        body.appendChild(reqPillsEl);
      }
      wrap.appendChild(
        buildAssignPickChip(assetArt, "Target", assetName, article, mainOnly, setDragDataForTarget),
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
          "Target",
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
   * Mirrors the active-mission card: hidden agents' challenge traits and an Unknown site's
   * traits stay out, so the preview only ever promises what the player can actually see.
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
      ...playerVisibleSuccessOptionsForTarget(target, supportAbilities),
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

  /**
   * Location id the currently staged target resolves to — for a location target that location,
   * for an asset target the site holding it — or null while there is no mission, no target the
   * mission would actually accept, or a mission with no location-resolving target type at all.
   */
  function stagedTargetLocationId(): string | null {
    const mission =
      assignMissionTemplateId === null
        ? undefined
        : findMissionOrEventTemplate(assignMissionTemplateId);
    if (mission === undefined || mission.targetType === "none" || assignTarget === null) {
      return null;
    }
    if (
      !missionTargetMatchesTemplate(mission.targetType, assignTarget) ||
      !targetPassesMissionLocationFilters(mission, assignTarget)
    ) {
      return null;
    }
    return getMissionTargetLocationId(assignTarget);
  }

  /** Whether the staged plan targets a site (directly or via an asset on it) the player has not
   * identified yet — intel below {@link INTEL_SITE_IDENTITY}, so its traits and security are not
   * something the player can see, let alone plan around. */
  function isStagedTargetUnknown(): boolean {
    const lid = stagedTargetLocationId();
    return lid !== null && !isSiteIdentified(lid);
  }

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

    /* Site-derived groups only apply once the target is one the mission would actually accept
     * (the same gate stagedSuccessChance() uses before it will quote a number) *and* is a site
     * the player has identified — an Unknown site's traits and security are not information the
     * player has, so they cannot be requirements the planner shows them. */
    const targetLid = stagedTargetLocationId();
    const lid = targetLid !== null && isSiteIdentified(targetLid) ? targetLid : null;

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
   * The requirements checklist under the gauge. It exists to make the number legible: every pill
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

    /* An Unknown target may be hiding site or security requirements the planner cannot see, so
     * a real tally would understate what is actually being staged against — the tally reads as
     * unknown too rather than quietly promising a count that is not the whole story. */
    const targetUnknown = isStagedTargetUnknown();
    const scored = groups.flatMap((g) => g.items).filter((i) => i.counts);
    const met = scored.filter((i) => i.met).length;
    assignRequirementsTallyEl.textContent = targetUnknown
      ? "?/? met"
      : scored.length === 0
        ? ""
        : String(met) + "/" + String(scored.length) + " met";
    assignRequirementsTallyEl.classList.toggle(
      "plan-reqs__tally--all",
      !targetUnknown && scored.length > 0 && met === scored.length,
    );

    for (const group of groups) {
      const row = document.createElement("div");
      row.className = "plan-reqs__group";

      /* An unnamed group — the mission's own traits, and the asset slots — heads nothing and
       * gets no heading. The label is a line above the rows now rather than a column beside
       * them, so an empty one would open a blank line instead of quietly reserving a gutter. */
      if (group.label !== "") {
        const label = document.createElement("span");
        label.className = "plan-reqs__group-label";
        label.textContent = group.label;
        setTooltip(label, group.label, group.hint);
        row.appendChild(label);
      }

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
   * The success-chance gauge at the head of Assessment. Unlike the old in-button badge it never
   * hides: with no staged plan it holds a grey, empty ring so the player knows where the number
   * will appear. A real 0% reads the same grey — there is nothing to sell either way.
   */
  function syncAssignChanceGauge(): void {
    const staged = state.phase === "main" ? stagedSuccessChance() : null;
    /* An Unknown target may be hiding site or security terms the formula above never saw, so a
     * real percentage would be reporting arithmetic the player cannot actually check — the whole
     * gauge goes to "unknown" instead of quietly narrowing to what little is visible. */
    const targetUnknown = staged !== null && isStagedTargetUnknown();
    const pct = staged === null || targetUnknown ? 0 : staged.breakdown.finalPercent;
    assignChanceEl.style.setProperty("--chance", String(pct));
    assignChanceEl.classList.toggle("plan-chance--live", staged !== null && !targetUnknown);
    assignChanceEl.classList.toggle("plan-chance--warn", pct > 0 && pct < 40);
    assignChanceEl.classList.toggle("plan-chance--mid", pct >= 40 && pct < 70);
    assignChanceEl.classList.toggle("plan-chance--good", pct >= 70);
    if (staged === null) {
      assignChanceValueEl.textContent = "--";
      assignChanceNoteEl.textContent = "No plan staged";
      setTooltip(assignChanceEl, "Success Chance", "Stage a mission, a target and its crew to see the odds.");
      return;
    }
    if (targetUnknown) {
      assignChanceValueEl.textContent = "??%";
      const note = document.createElement("strong");
      note.textContent = "Target defenses unknown";
      assignChanceNoteEl.replaceChildren(note);
      setTooltip(
        assignChanceEl,
        "Success Chance",
        "This site has not been identified yet — its traits, security and true odds stay unknown until you gather intel on it.",
      );
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
    setTooltip(assignChanceEl, "Success Chance", SUCCESS_CHANCE_TOOLTIP_DESC);
  }

  /**
   * The planner is as tall as the plan in it, and travels between sizes rather than snapping.
   *
   * The height has to be written in pixels because `auto` does not interpolate — that is the
   * whole reason this is in JS at all. Everything else is still the stylesheet's: the resting
   * size is whatever the sections come to, the ceiling is `max-height: 100%` (the map's own
   * height), and past that ceiling the page inside goes on scrolling exactly as it did. The
   * number here is free to exceed the ceiling; `max-height` clamps it and the panel simply stops
   * growing, which is what turns the last of the growth into a scroll.
   *
   * Called from `refresh` and from an observer on the sections, because most of what resizes this
   * panel never goes through a render — a card picked up, an asset slot filling, a requirement
   * lighting up.
   */
  let planColumnHeightArmed = false;

  function syncPlanColumnHeight(): void {
    /* Minimized to its header. The collapse rule already says `height: auto`, and an inline
     * height would outrank it and hold the panel open at the size of a plan nobody can see. */
    if (planColumnEl.classList.contains("game-panel--collapsed")) {
      planColumnEl.style.height = "";
      planColumnEl.classList.remove("plan-column--sized");
      planColumnHeightArmed = false;
      return;
    }
    /* The plan's own height, taken from the sections themselves — first section's top to last
     * section's bottom, so the gaps between them come along for free.
     *
     * Not `scrollHeight`, which is the obvious reach and is wrong here: it reports whichever is
     * larger of the content and the box it is in, so once the panel is big enough it just echoes
     * back the height we last gave it. Measured that way the panel can grow and never shrink.
     * The sections are what the panel is meant to fit, so they are what gets measured.
     *
     * And measured through `offsetTop`/`offsetHeight` rather than `getBoundingClientRect`,
     * because the whole shell is a scaled canvas (`ui/stageScale`). A rect is in *visual*
     * pixels, with the stage's scale already multiplied in; `offset*` and the `chrome` below are
     * in *layout* pixels, which is also what the height we are about to write is read as. Mixing
     * the two writes a height that is off by the stage scale — a panel too short on a small
     * window, and one carrying a band of dead space on a large one. All three sections share an
     * offsetParent (the panel, the nearest positioned ancestor), so their offsets are directly
     * comparable. */
    const sections = [...planColumnPanelEl.children].filter(
      (el): el is HTMLElement => el instanceof HTMLElement && !el.hidden,
    );
    const first = sections[0];
    const last = sections[sections.length - 1];
    const content =
      first === undefined || last === undefined
        ? 0
        : last.offsetTop + last.offsetHeight - first.offsetTop;
    /* Not on screen — the menu is up, or the run has not started. Everything measures 0 there,
     * and pinning that would collapse the panel to its chrome. The observer fires again with
     * real numbers the moment it is shown, which is what makes this safe to simply skip. */
    if (content <= 0) {
      return;
    }
    /* The page is the one flex child that absorbs the panel's slack, so whatever the panel has
     * that the page does not is exactly the chrome: header, footer, padding, borders, gaps.
     * Taken as a difference rather than summed from parts, so it needs no updating when the
     * footer changes, and it holds mid-animation.
     *
     * It holds only while the panel's height is definite, though. A flex column sized by its own
     * contents collapses `flex: 1 1 0` children to nothing, and the footer sits inside the stack
     * that collapses — so the difference comes back short by the whole Deploy bar. The
     * stylesheet's fallback is `height: 100%` for that reason; this pins it before the first
     * measurement in case that ever changes, since the symptom is a panel quietly one footer too
     * short rather than anything that looks like a bug in here. */
    if (planColumnEl.style.height === "") {
      planColumnEl.style.height = "100%";
    }
    const chrome = planColumnEl.offsetHeight - planColumnPanelEl.clientHeight;
    planColumnEl.style.height = `${String(Math.ceil(chrome + content))}px`;
    if (!planColumnHeightArmed) {
      planColumnHeightArmed = true;
      /* A frame later, so the first height — the one that just took over from the stylesheet's
       * fallback — lands without animating. There is nothing to show the player yet at that
       * point; the travel is only worth watching once they are the ones causing it. */
      requestAnimationFrame(() => {
        planColumnEl.classList.add("plan-column--sized");
      });
    }
  }

  /* The sections and the footer are the only things in the panel whose height is not fixed, and
   * they outlive every render — their bodies are rebuilt, the frames themselves are not — so
   * they can be observed once here rather than re-wired on each pass. */
  const planColumnResizeObserver = new ResizeObserver(() => {
    syncPlanColumnHeight();
  });
  for (const el of planColumnEl.querySelectorAll<HTMLElement>(
    ".plan-section, .plan-column-footer",
  )) {
    planColumnResizeObserver.observe(el);
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

  /**
   * Disables the button and records both why, for the two audiences that ask: `title` is the
   * full sentence a hover gets — it becomes the description line under the button's name, so
   * write it as one — and `assignBlockReason` is the short label a click on the disabled button
   * flashes (see `flashAssignBlockedAlert`). Each call site is one blocking condition, in
   * priority order — the first one reached is the "highest level" reason and the only one shown.
   */
  function disableAssignButton(title: string, alertReason: string): void {
    btnAssign.disabled = true;
    setTooltip(btnAssign, "Deploy", title);
    assignBlockReason = alertReason;
  }

  /** The gate itself: sets `disabled` and the reason, one early return per blocking condition. */
  function applyAssignButtonEnabled(): void {
    const mainOnly = state.phase === "main";
    if (!mainOnly) {
      disableAssignButton("Available only during the Main Phase.", "Main Phase Only");
      return;
    }
    if (!assignMissionTemplateId || assignMissionSource === null) {
      disableAssignButton("Choose a mission", "No Mission Assigned");
      return;
    }
    const missionTemplate = findMissionOrEventTemplate(assignMissionTemplateId);
    if (!missionTemplate) {
      disableAssignButton("Choose a mission", "No Mission Assigned");
      return;
    }
    if (missionTemplate.targetType !== "none") {
      if (!assignTarget) {
        disableAssignButton("Choose a mission target", "No Target Assigned");
        return;
      }
      if (!missionTargetMatchesTemplate(missionTemplate.targetType, assignTarget)) {
        disableAssignButton("Target does not match mission type", "Wrong Target Type");
        return;
      }
      /* Intel and security can move under a target staged on an earlier turn, so re-check the
       * site filters here rather than letting the click fail. */
      if (!targetPassesMissionLocationFilters(missionTemplate, assignTarget)) {
        disableAssignButton(
          `Target site does not meet: ${formatTargetLocationFilters(missionTemplate, targetLocationDisplayName) ?? "this mission's requirements"}`,
          "Target Requirements Not Met",
        );
        return;
      }
    }
    const atMissionCap =
      state.activeMissions.length >= state.player.maxConcurrentMissions;
    if (atMissionCap) {
      disableAssignButton(
        `At concurrent mission limit (${state.activeMissions.length}/${state.player.maxConcurrentMissions})`,
        "Mission Limit Reached",
      );
      return;
    }
    const parts = getAssignParticipantIds();
    const maxP = stagedParticipantCeiling();
    if (parts.length < 1) {
      disableAssignButton(`Assign 1–${maxP} minions`, "No Minions Assigned");
      return;
    }
    if (parts.length > maxP) {
      disableAssignButton(`Assign 1–${maxP} minions`, "Too Many Minions");
      return;
    }
    const instanceById = new Map(
      state.player.minions.map((m) => [m.instanceId, m] as const),
    );
    const participants = parts
      .map((id) => instanceById.get(id))
      .filter((x): x is NonNullable<typeof x> => x !== undefined);
    if (!canAssignParticipants(participants, maxP)) {
      disableAssignButton(`This mission takes 1–${maxP} minions; the plan does not have that many.`, "Invalid Minion Selection");
      return;
    }
    const cost = missionTemplate.startCommandPoints;
    const canAfford = state.player.commandPoints >= cost;
    if (!canAfford) {
      disableAssignButton(`Costs ${cost} CP and you have ${state.player.commandPoints}.`, "No CP");
      return;
    }
    btnAssign.disabled = false;
    setTooltip(btnAssign, "Deploy", `Spends ${cost} CP to send this plan out.`);
    assignBlockReason = null;
  }

  /**
   * A click landed on Submit while it was disabled. The button itself never sees that click — a
   * disabled control eats it — so `.btn-submit-mission-wrap` (pointer-events pass through the
   * disabled button to it, see CSS) is what actually catches it. Clearing the text before
   * re-setting it, rather than just toggling the visible class, is what makes the `aria-live`
   * region re-announce on a second click — even one with the same reason — not just the first.
   */
  function flashAssignBlockedAlert(reason: string): void {
    if (assignBlockedAlertHideTimer !== null) {
      clearTimeout(assignBlockedAlertHideTimer);
    }
    assignBlockedAlertEl.classList.remove("assign-blocked-alert--visible");
    assignBlockedAlertEl.textContent = "";
    void assignBlockedAlertEl.offsetWidth;
    assignBlockedAlertEl.textContent = reason;
    assignBlockedAlertEl.classList.add("assign-blocked-alert--visible");
    assignBlockedAlertHideTimer = setTimeout(() => {
      assignBlockedAlertEl.classList.remove("assign-blocked-alert--visible");
      assignBlockedAlertHideTimer = null;
    }, 1600);
  }

  /**
   * The art-led minion card every minion surface shares. The portrait runs full-bleed down the
   * top of the card with the name and CP/level/XP badges on its scrim; the Bio brief — flavour
   * line, then a full-width Skills list — follows under it. Returns the body for whatever the
   * surface adds after the brief.
   */
  function fillMinionCard(
    card: HTMLElement,
    tpl: (typeof content.minions)[number] | undefined,
    fallbackName: string,
    stats: { cpCost: string | number; level: number; xp: number },
    traits: { ids: string[]; dynamic: readonly DynamicTrait[] } | null,
  ): HTMLDivElement {
    const { meta, body } = appendCardHeroShell(card, resolveMinionCardArt(tpl));

    const title = document.createElement("h4");
    title.className = "minions-card-title";
    title.textContent = tpl?.name ?? fallbackName;
    meta.appendChild(title);
    meta.appendChild(createMinionsCardStatsRow(stats));

    body.appendChild(
      buildMinionBrief({
        description: tpl?.description?.trim() ?? null,
        skillPills:
          traits === null
            ? null
            : minionSkillPillEls(content, traits.ids, {
                roster: state.player.minions,
                traits: traits.dynamic,
              }),
      }),
    );
    return body;
  }

  /**
   * The roster card for a staged minion, minus its buttons — the preview a collapsed
   * participant chip floats on hover. Traits live here now rather than on the chip itself, which
   * is what keeps the Minions field to one line per slot.
   */
  function buildMinionPreviewArticle(inst: MinionInstance | undefined, instanceId: string): HTMLElement {
    const tpl = inst ? content.minions.find((t) => t.id === inst.templateId) : undefined;
    const card = document.createElement("article");
    card.className = "minions-card assign-pick-preview-card";
    fillMinionCard(
      card,
      tpl,
      instanceId,
      {
        cpCost: tpl?.hireCommandPoints ?? "-",
        level: inst?.currentLevel ?? 0,
        xp: inst?.currentExperience ?? 0,
      },
      inst === undefined ? null : { ids: inst.traitIds, dynamic: inst.dynamicTraits },
    );
    return card;
  }

  function minionSlotKey(slotIndex: number): string {
    return `minion-${slotIndex}`;
  }

  /** Puts hired minion `instanceId` in participant slot `slotIndex`, if it is free to go. */
  function stageMinionSlot(slotIndex: number, instanceId: string): boolean {
    const inst = state.player.minions.find((m) => m.instanceId === instanceId);
    if (!inst || busyInstanceIds(state.activeMissions).has(instanceId)) {
      return false;
    }
    placeInstanceInSlot(instanceId, slotIndex);
    renderAssignMinionSlots();
    onAssignSlotsChanged();
    return true;
  }

  /**
   * The roster card's add-to-planner action: puts the minion in the first empty participant slot
   * the planned mission can use. A minion already staged is shaken off by the slot it is in rather
   * than moved; with every usable slot taken there is nowhere to send it.
   */
  function applyMinionToPlanner(instanceId: string): PlannerSend {
    const usable = assignSlotInstanceIds.slice(0, stagedParticipantCeiling());
    const stagedIndex = usable.indexOf(instanceId);
    if (stagedIndex >= 0) {
      return { slot: minionSlotKey(stagedIndex), staged: false };
    }
    const emptyIndex = usable.indexOf(null);
    if (emptyIndex < 0) {
      return null;
    }
    return { slot: minionSlotKey(emptyIndex), staged: stageMinionSlot(emptyIndex, instanceId) };
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
      wireDropSlot(slot, {
        key: minionSlotKey(slotIndex),
        accepts: ["mastermind-minion"],
        isFilled: () => assignSlotInstanceIds[slotIndex] !== null,
        onDrop: (raw) => {
          const parsed = parseDragPayload(raw);
          const resolvedId =
            parsed?.kind === "mastermind-minion"
              ? parsed.instanceId
              : state.player.minions.some((m) => m.instanceId === raw)
                ? raw
                : null;
          return resolvedId !== null && stageMinionSlot(slotIndex, resolvedId);
        },
      });

      const slotTag = `Minion ${String(slotIndex + 1)}`;
      const instanceId = assignSlotInstanceIds[slotIndex];
      if (instanceId === null) {
        fillEmptyPlanSlot(slot, slotTag, "Drag a minion here", "minions");
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
        chipMain.className = "plan-slot-main assign-minion-chip-main";
        chipMain.appendChild(createPlanSlotTag(slotTag));

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
          beginCardDrag(e, instanceId);
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

    if (mission) {
      /* Named as the player knows the site: a mission pinned to somewhere they have no intel on
       * reads "Unknown" until they scout it, rather than handing them the name for free. */
      const siteFilters = missionTargetTypeTargetsLocation(mission.targetType)
        ? formatTargetLocationFilters(mission, siteDisplayName)
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

      /* The brief — stamp, description, then one Requirements grid of skill and asset cells —
       * stays under the art like a location card's dossier: it wraps to any number of lines,
       * which would push the name off the top of a fixed-height banner. */
      const traitIdsForDisplay =
        mergedRequiredTraitIdsForDisplay !== undefined
          ? mergedRequiredTraitIdsForDisplay
          : mission.requiredTraitIds;
      const rosterTraitIds = unionParticipantTraitIds(state.player.minions);
      const requirementPills = sortedTraitIdsForDisplay(content, traitIdsForDisplay).map((tid) =>
        createTraitPillEl(content, tid, rosterTraitIds, "trait", "Skill"),
      );

      body.appendChild(
        buildMissionBrief({
          description: mission.description ?? null,
          requirementPills,
          /* Every required asset is named the moment the mission is offered, so every row here
           * can show its card — nothing to gate, unlike a location's manifest. */
          assets: missionRequiredAssetRows(
            mission.requiredAssetIds,
            state.player.assets,
            content,
          ).map((row) => ({
            ...row,
            preview: (el: HTMLElement) => attachAssetRowPreview(el, row.assetId),
          })),
        }),
      );

      const effectsEl = createMissionCardEffectsEl(mission, content);
      if (effectsEl !== null) {
        body.appendChild(effectsEl);
      }
    } else {
      /* No template behind the id. The card still comes in the same framed section a real
       * mission's brief does, with the id where the brief would be — a card that dropped the
       * frame here would read as broken rather than as a mission the catalog has lost. */
      const wrap = document.createElement("div");
      wrap.className = "card-brief card-brief--mission";
      const { panel, body: panelBody } = briefPanel("Mission Brief");
      const dl = document.createElement("dl");
      dl.className = "asset-card-stats";
      appendMinionStatRows(dl, [{ label: "Mission id", value: missionId }]);
      panelBody.appendChild(dl);
      wrap.appendChild(panel);
      body.appendChild(wrap);
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
      setCardDragPayload(article, () => locationDragJson(loc.id));
      article.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        beginCardDrag(e, locationDragJson(loc.id));
        e.dataTransfer!.effectAllowed = "copy";
      });
      appendAddToPlannerButton(article, "Add location to planner", () => ({
        slot: "target",
        staged: applyTargetPayloadToPlanner({ kind: "mastermind-location", locationId: loc.id }),
      }));
    }

    /* Intel 0: the player does not know what this place is. Static for art, "Unknown" for a
     * name, and nothing about its category, level, security or traits — only the intel reading
     * itself, which is the one thing they do know. The card still drags into the planner, since
     * running a mission here is how the player finds out. */
    const identified = isLocationIdentifiedByPlayer(intelLevel);
    if (!identified) {
      article.classList.add("location-card--unknown");
    }

    const { meta, body } = appendCardHeroShell(
      article,
      resolvePlayerLocationCardArt(loc, identified),
    );

    /* Intel 1: the site has a name and a picture, but the picture is all the player has managed
     * to pull off it — so it is shown as the degraded surveillance still it is, drained of
     * colour and combed by scanlines. Intel 2 is what buys the clean plate, which makes the
     * grade the visible difference between knowing *what* a place is and being able to see
     * inside it. The comb is its own layer rather than a filter because no filter draws lines;
     * it rides under the name plate so the title stays readable (see `appendCardHeroOverlay`). */
    if (identified && intelLevel === INTEL_SITE_IDENTITY) {
      article.classList.add("location-card--thin-intel");
      appendCardHeroOverlay(meta, "card-hero__scan");
    }

    const title = document.createElement("h4");
    title.className = "location-card-title";
    title.textContent = identified ? loc.name : UNKNOWN_LOCATION_NAME;
    meta.appendChild(title);

    const statsRow = createLocationCardStatsRow(
      identified
        ? {
            type: formatLocationTypeLabel(loc.locationType),
            level: loc.locationLevel,
            securityLevel: securityLevel !== undefined ? String(securityLevel) : "—",
            intelLevel: intelLevel,
          }
        : { type: "?", level: "?", securityLevel: "?", intelLevel: intelLevel },
    );
    meta.appendChild(statsRow);

    /*
     * The intelligence brief. Everything below the art is one block now (`ui/locationBrief.ts`):
     * requirements on the left, the asset manifest on the right, and both drawn as a form that
     * is only as filled in as the player's intel. What this function still owns is the *data* —
     * which traits are revealed, what each slot is worth knowing, and the drag payloads — since
     * all of that is catalog and game state the brief has no business reaching for.
     */
    const rosterTraitIds = unionParticipantTraitIds(state.player.minions);
    const securityTraitIds = locationSecurityTraitIds;
    const revealedSecCount = Math.min(securityLevel ?? 0, securityTraitIds.length);
    const revealedSecIds = securityTraitIds.slice(0, revealedSecCount);

    const requirementPills: HTMLElement[] = [];
    if (identified) {
      for (const tid of sortedTraitIdsForDisplay(content, siteRequiredTraitIds)) {
        requirementPills.push(createTraitPillEl(content, tid, rosterTraitIds, "trait"));
      }
      for (const tid of sortedTraitIdsForDisplay(content, revealedSecIds)) {
        requirementPills.push(createTraitPillEl(content, tid, rosterTraitIds, "security"));
      }
    }

    /* Agents the player has not uncovered (by play or by intel 3) are omitted entirely —
     * listing them at all would leak that the site is occupied. */
    const agentChips: HTMLElement[] = [];
    let agentNote: HTMLElement | null = null;
    const visibleAgents = playerVisibleOpposingAgentsAtLocation(state, loc.id);
    for (const a of visibleAgents) {
      const template = getAgentTemplateById(content, a.templateId);
      const name = template?.name ?? a.templateId;
      const chip = document.createElement("span");
      chip.className = "location-agent-chip";
      chip.appendChild(createCardArtImg(resolveAgentCardArt(template), "card-art--chip"));
      chip.appendChild(document.createTextNode(name));
      /* One agent, one description: what it makes harder here, then what it does. The pieces are
       * joined into a single line rather than stacked, because the second line of a tooltip is
       * the description — all of it (see `ui/tooltip.ts`). */
      const chipDesc: string[] = [];
      if (a.challengeTraitIds.length > 0) {
        chipDesc.push(
          `Challenge traits: ${traitDisplayNames(content, a.challengeTraitIds)} — each one no participant matches costs -${content.balance.agentChallengeTraitPenalty}% success here.`,
        );
      }
      for (const abilityId of a.abilityIds) {
        const def = agentAbilityDef(abilityId);
        if (def !== undefined) {
          chipDesc.push(`${def.name} (${def.kind}): ${def.description}`);
        }
      }
      setTooltip(chip, name, chipDesc.join(" "));
      if (a.abilityIds.length > 0) {
        const abilities = document.createElement("span");
        abilities.className = "location-agent-abilities";
        abilities.textContent = a.abilityIds.map((id) => agentAbilityName(id)).join(" · ");
        chip.appendChild(abilities);
      }
      agentChips.push(chip);
    }
    if (visibleAgents.length > 0) {
      const siteChallenges = challengeTraitIdsForAgents(visibleAgents);
      if (siteChallenges.length > 0) {
        const note = document.createElement("span");
        note.className = "location-agent-challenge-note";
        note.textContent = `Challenge: ${traitDisplayNames(content, siteChallenges)}`;
        setTooltip(
          note,
          "Challenge Traits",
          `Each distinct challenge trait the agents here hold costs -${content.balance.agentChallengeTraitPenalty}% success on missions at this site, unless a participant has the matching trait.`,
        );
        agentNote = note;
      }
    }

    const assetRows: LocationBriefAssetRow[] = [];
    let assetCountUnknown = false;
    for (let si = 0; si < assetSlots.length; si += 1) {
      const slot = assetSlots[si]!;
      const knowledge = assetSlotKnowledge(slot, intelLevel);
      if (knowledge === "unknown") {
        /* Intel 0: the player cannot even count the assets stored here, so the slot does not get
         * a line of its own — only the sealed tail at the foot of the manifest. */
        assetCountUnknown = true;
        continue;
      }
      if (!isOccupiedAssetSlot(slot)) {
        assetRows.push({
          knowledge: "empty",
          name: "",
          art: null,
          tooltip: tooltipText("Empty Slot", "Whatever was stored here is already gone."),
        });
        continue;
      }
      const identifiedSlot = knowledge === "identified";
      const template = identifiedSlot
        ? content.assets.find((a) => a.id === slot.assetId)
        : undefined;
      const name = identifiedSlot ? (assetNameById.get(slot.assetId) ?? slot.assetId) : "";
      const targetVisibility = identifiedSlot ? "revealed" : "hidden";
      /* An identified slot names its asset; one the player can only tell is *there* is named for
       * what it is to them — a slot with something in it — and the description is the step that
       * would open it. Either way the drag hint rides on the description, never the name. */
      const rowName = identifiedSlot ? name : "Sealed Slot";
      const rowDesc: string[] = [];
      if (identifiedSlot) {
        if (template?.description !== undefined && template.description !== "") {
          rowDesc.push(template.description);
        }
      } else {
        rowDesc.push("Something is stored in this slot. Intel 2 at this site identifies what it is.");
      }
      if (enableAssignDrag) {
        rowDesc.push(`Drag it to the plan to aim a mission at slot ${si + 1}.`);
      }
      assetRows.push({
        knowledge: identifiedSlot ? "identified" : "existence",
        name,
        art: identifiedSlot ? resolveAssetCardArt(template) : resolveUnknownCardArtThumb(),
        tooltip: tooltipText(rowName, rowDesc.join(" ")),
        /* Only once the slot is identified. Below that the player has earned the knowledge that
         * something is in there and nothing else, and there is no card to show — floating the
         * real asset's would hand over the intel the slot is still withholding. */
        preview: identifiedSlot ? (el) => attachAssetRowPreview(el, slot.assetId) : undefined,
        wire: enableAssignDrag
          ? (el) => {
              el.draggable = true;
              setCardDragPayload(el, () => assetDragJson(loc.id, si, targetVisibility));
              el.addEventListener("dragstart", (e) => {
                e.stopPropagation();
                beginCardDrag(e, assetDragJson(loc.id, si, targetVisibility));
                e.dataTransfer!.effectAllowed = "copy";
              });
            }
          : undefined,
      });
    }

    body.appendChild(
      buildLocationBrief({
        intelLevel,
        identified,
        designation: locationDesignation(loc.id),
        requirementPills,
        classifiedSecurityCount: identified
          ? securityTraitIds.length - revealedSecCount
          : 0,
        assets: assetRows,
        assetCountUnknown,
        agents: agentChips,
        agentNote,
      }),
    );
    return article;
  }

  /**
   * The lair's own location card — the same hero-art shell and stat-badge treatment a site gets,
   * so the player's base reads as a place on the map rather than a bare name over the tab rail.
   * A lair has no type, security or intel to badge, so its one stat is the upgrade ladder, which
   * is the closest thing it has to a location's level.
   */
  function buildLairCardArticle(lair: (typeof content.lairs)[number]): HTMLElement {
    const article = document.createElement("article");
    article.className = "location-card lair-card";
    const { meta, body } = appendCardHeroShell(article, resolveLairCardArt(lair));

    const title = document.createElement("h4");
    title.className = "location-card-title";
    title.textContent = lair.name;
    meta.appendChild(title);

    const total = lairUpgradeLevels(state.activeLairId, content).length;
    const current = currentLairUpgradeLevel(
      state.activeLairId,
      state.completedLairUpgradeMissionIds,
      content,
    );
    const levelValue =
      current !== null ? `${current.index + 1} / ${total}` : total === 0 ? "—" : "Complete";

    const statsRow = document.createElement("div");
    statsRow.className = "minions-card-stats-row";
    const levelBadge = document.createElement("div");
    levelBadge.className = "minions-card-badge minions-card-badge--level";
    setTooltip(levelBadge, "Upgrade Level", "How far this lair's upgrade track has been built out. Each level offers a set of upgrade missions, and installing one opens the next.");
    levelBadge.tabIndex = 0;
    levelBadge.setAttribute("aria-label", `Upgrade Level: ${levelValue}`);
    levelBadge.innerHTML = `${MINION_STAT_ICON_LEVEL}<span class="minions-card-badge__value">${levelValue}</span>`;
    statsRow.appendChild(levelBadge);
    meta.appendChild(statsRow);

    if (lair.description) {
      const desc = document.createElement("p");
      desc.className = "asset-card-description";
      desc.textContent = lair.description;
      body.appendChild(desc);
    }
    return article;
  }

  function appendMinionStatRows(
    dl: HTMLElement,
    rows: Array<{
      label: string;
      value: string;
      valueEl?: HTMLElement;
      /* Both tooltips take the row's own `label` as their first line — the row is already named,
       * and naming it twice differently is how a tooltip format drifts. The caller supplies only
       * the description under it. */
      tooltipDesc?: string;
      labelTooltipDesc?: string;
      dtClass?: string;
      ddClass?: string;
    }>,
  ): void {
    for (const { label, value, valueEl, tooltipDesc, labelTooltipDesc, dtClass, ddClass } of rows) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      if (dtClass !== undefined) {
        dt.className = dtClass;
      }
      if (labelTooltipDesc !== undefined && labelTooltipDesc !== "") {
        setTooltip(dt, label, labelTooltipDesc);
      }
      const dd = document.createElement("dd");
      if (ddClass !== undefined) {
        dd.className = ddClass;
      }
      if (valueEl !== undefined) {
        dd.appendChild(valueEl);
      } else if (tooltipDesc !== undefined && tooltipDesc !== "") {
        const span = document.createElement("span");
        span.className = "mission-success-chance-value";
        span.textContent = value;
        setTooltip(span, label, tooltipDesc);
        dd.appendChild(span);
      } else {
        dd.textContent = value;
      }
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
  }

  /**
   * A dashed placeholder the size of a minion card, standing in a Minions drawer row for a place
   * nobody fills yet, so the row shows how much room it has rather than only what is in it.
   */
  function createEmptyMinionSlot(hint: string): HTMLElement {
    const slot = document.createElement("div");
    slot.className = "minions-card-empty";
    slot.innerHTML = ICON_PERSON;
    const label = document.createElement("span");
    label.className = "minions-card-empty__label";
    label.textContent = "Empty slot";
    const hintEl = document.createElement("span");
    hintEl.className = "minions-card-empty__hint";
    hintEl.textContent = hint;
    slot.append(label, hintEl);
    return slot;
  }

  /**
   * Draws a Minions drawer row: `cards`, keyed, with `emptyCount` empty slots among them. Laid
   * out fresh when `held` is `null`; otherwise against `held`, the row as last drawn, so nothing
   * that is still there moves (see `ui/stableRow.ts`). Returns the layout it drew.
   */
  function appendMinionRow(
    container: HTMLElement,
    cards: ReadonlyMap<string, HTMLElement>,
    emptyCount: number,
    emptyHint: string,
    held: RowSlots | null,
  ): RowSlots {
    const keys = [...cards.keys()];
    const slots = held === null ? freshRow(keys, emptyCount) : stableRow(held, keys, emptyCount);
    for (const key of slots) {
      container.appendChild(key === null ? createEmptyMinionSlot(emptyHint) : cards.get(key)!);
    }
    return slots;
  }

  function fillMinionsRosterInto(container: HTMLElement, held: RowSlots | null): RowSlots {
    const busy = busyInstanceIds(state.activeMissions);
    const mainOnly = state.phase === "main";
    const cards = new Map<string, HTMLElement>();
    for (const inst of state.player.minions) {
      const tpl = content.minions.find((m) => m.id === inst.templateId);
      const card = document.createElement("article");
      card.className = "minions-card minions-card--roster";
      card.dataset.assignInstanceId = inst.instanceId;
      const isBusy = busy.has(inst.instanceId);
      const canDrag = mainOnly && !isBusy;
      card.draggable = canDrag;
      /* The drag itself is started by the panel's delegated `dragstart`; this is only the hover. */
      setCardDragPayload(card, () => minionDragJson(inst.instanceId));
      if (canDrag) {
        card.classList.add("assign-draggable-minion");
      }
      if (isBusy) {
        card.classList.add("minions-card--busy");
      }
      if (canDrag) {
        appendAddToPlannerButton(card, "Add minion to planner", () =>
          applyMinionToPlanner(inst.instanceId),
        );
      }
      const body = fillMinionCard(
        card,
        tpl,
        inst.templateId,
        {
          cpCost: tpl?.hireCommandPoints ?? "—",
          level: inst.currentLevel,
          xp: inst.currentExperience,
        },
        { ids: inst.traitIds, dynamic: inst.dynamicTraits },
      );
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
        setTooltip(fireBtn, "Fire", "Available only during the Main Phase.");
      } else if (isBusy) {
        setTooltip(fireBtn, "Fire", "This minion is out on a mission and cannot be fired until it returns.");
      } else {
        setTooltip(fireBtn, "Fire", "Removes this minion from the roster. They return to the hire pool, stats intact, after a cooldown.");
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

      cards.set(inst.instanceId, card);
    }

    const slots = appendMinionRow(
      container,
      cards,
      state.player.maxRosterSize - state.player.minions.length,
      "Hire a minion to fill",
      held,
    );
    if (container.childElementCount === 0) {
      const empty = document.createElement("p");
      empty.className = "minions-panel-empty";
      empty.textContent = "None hired yet.";
      container.appendChild(empty);
    }
    return slots;
  }

  function fillMinionsHireInto(container: HTMLElement, held: RowSlots | null): RowSlots {
    const eligibleRehires = state.minionRehireQueue.filter(
      (e) => state.turnNumber >= e.availableFromTurn,
    );
    const cards = new Map<string, HTMLElement>();
    for (const templateId of state.availableMinionTemplateIds) {
      const tpl = content.minions.find((m) => m.id === templateId);
      if (!tpl) {
        continue;
      }
      const card = document.createElement("article");
      card.className = "minions-card minions-card--available";
      fillMinionCard(
        card,
        tpl,
        tpl.id,
        { cpCost: tpl.hireCommandPoints, level: tpl.startingLevel ?? 1, xp: 0 },
        {
          ids: tpl.startingTraitIds ?? [],
          dynamic: previewHireDynamicTraits(state, content, tpl.id),
        },
      );

      const hireBtn = document.createElement("button");
      hireBtn.type = "button";
      hireBtn.className = "btn btn-primary minions-card-hire";
      hireBtn.textContent = "Hire";

      const mainOnly = state.phase === "main";
      const canAfford = state.player.commandPoints >= tpl.hireCommandPoints;
      const rosterFull = state.player.minions.length >= state.player.maxRosterSize;
      hireBtn.disabled = !mainOnly || !canAfford || rosterFull;
      if (!mainOnly) {
        setTooltip(hireBtn, "Hire", "Available only during the Main Phase.");
      } else if (rosterFull) {
        setTooltip(hireBtn, "Hire", `Your roster is full (${state.player.minions.length}/${state.player.maxRosterSize}). Fire someone to make room.`);
      } else if (!canAfford) {
        setTooltip(hireBtn, "Hire", `Costs ${tpl.hireCommandPoints} CP and you have ${state.player.commandPoints}.`);
      } else {
        setTooltip(hireBtn, "Hire", `Spends ${tpl.hireCommandPoints} CP to add this minion to your roster.`);
      }

      hireBtn.addEventListener("click", () => {
        if (state.phase !== "main") {
          return;
        }
        dispatch((s) => hireMinion(s, content, tpl.id, crypto.randomUUID()));
      });

      /* On the card, not in its body: the button is positioned into the hero art's corner (see
       * `.minions-card-hire`), so it belongs to the card box the way Fire does and not to the
       * text flow underneath it. */
      card.appendChild(hireBtn);
      cards.set(`offer:${tpl.id}`, card);
    }

    for (const { minion: rehireInst } of eligibleRehires) {
      const tpl = content.minions.find((m) => m.id === rehireInst.templateId);
      const card = document.createElement("article");
      card.className = "minions-card minions-card--available minions-card--rehire";
      fillMinionCard(
        card,
        tpl,
        rehireInst.templateId,
        {
          cpCost: tpl?.hireCommandPoints ?? "—",
          level: rehireInst.currentLevel,
          xp: rehireInst.currentExperience,
        },
        {
          ids: rehireInst.traitIds,
          dynamic: previewRehireDynamicTraits(state, content, rehireInst),
        },
      );

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
        setTooltip(hireBtn, "Rehire", "This minion's template is missing from the catalog, so they cannot be brought back.");
      } else if (!mainOnly) {
        setTooltip(hireBtn, "Rehire", "Available only during the Main Phase.");
      } else if (rosterFull) {
        setTooltip(hireBtn, "Rehire", `Your roster is full (${state.player.minions.length}/${state.player.maxRosterSize}). Fire someone to make room.`);
      } else if (!canAfford) {
        setTooltip(hireBtn, "Rehire", `Costs ${cost} CP and you have ${state.player.commandPoints}.`);
      } else {
        setTooltip(hireBtn, "Rehire", `Spends ${cost} CP to take this minion back with the level and traits they left on.`);
      }

      hireBtn.addEventListener("click", () => {
        if (state.phase !== "main") {
          return;
        }
        dispatch((s) => rehireMinion(s, content, rehireInst.instanceId));
      });

      /* On the card, not in its body: the button is positioned into the hero art's corner (see
       * `.minions-card-hire`), so it belongs to the card box the way Fire does and not to the
       * text flow underneath it. */
      card.appendChild(hireBtn);
      cards.set(`rehire:${rehireInst.instanceId}`, card);
    }

    /* Re-hires ride on top of the pool rather than taking a spot in it, so only the fresh offers
     * count against `maxHireOffers`. The spots a hire vacates are redrawn at end of turn. */
    const slots = appendMinionRow(
      container,
      cards,
      state.player.maxHireOffers - state.availableMinionTemplateIds.length,
      "Refills at end of turn",
      held,
    );
    if (container.childElementCount === 0) {
      const empty = document.createElement("p");
      empty.className = "minions-panel-empty";
      empty.textContent =
        content.minions.length === 0
          ? "No minion templates in catalog."
          : "No hire offers right now.";
      container.appendChild(empty);
    }
    return slots;
  }

  /**
   * The menus are rendered on every refresh whether or not anyone has them open, so each of
   * these builds its cards with their art parked while its drawer is down — see the deferred-art
   * note in `ui/cardArt.ts`. `applyDrawerState` loads it when the drawer comes up.
   */
  function renderMinionsPanel(): void {
    withDeferredCardArt(openDrawer !== "minions", buildMinionsPanel);
  }

  /**
   * The Minions drawer's rows as last drawn, and the turn they were drawn on. While the drawer is
   * open, each redraw holds its rows to these, so a hire or a fire leaves an empty slot where the
   * card stood instead of sliding its neighbours along. Closed, or on a new turn, the rows are
   * drawn fresh; the drawer is redrawn once it has gone down so it is back in order when reopened.
   */
  let minionRows: { turn: number; roster: RowSlots; hire: RowSlots } | null = null;

  function buildMinionsPanel(): void {
    minionsPanelEl.innerHTML = "";
    const held =
      openDrawer === "minions" && minionRows?.turn === state.turnNumber ? minionRows : null;
    let rosterSlots: RowSlots = [];
    let hireSlots: RowSlots = [];
    const p = state.player;
    const eligibleRehires = state.minionRehireQueue.filter(
      (e) => state.turnNumber >= e.availableFromTurn,
    );
    const hireOfferCount = state.availableMinionTemplateIds.length + eligibleRehires.length;

    function buildRosterSection(): HTMLElement {
      const section = document.createElement("section");
      section.className = "minions-panel-column";
      section.setAttribute("aria-label", "Hired minions");

      const heading = document.createElement("h3");
      heading.id = "minions-roster-heading";
      heading.className = "game-controls-heading minions-panel-column-title";
      heading.textContent = `Your roster (${p.minions.length}/${p.maxRosterSize})`;
      section.appendChild(heading);

      const list = document.createElement("div");
      list.id = "minions-roster-list";
      list.className = "minions-panel-list";
      rosterSlots = fillMinionsRosterInto(list, held?.roster ?? null);
      section.appendChild(list);
      return section;
    }

    function buildHireSection(): HTMLElement {
      const section = document.createElement("section");
      section.className = "minions-panel-column minions-panel-column--hire";
      section.setAttribute("aria-label", "Minions available for hire");

      const headingRow = document.createElement("div");
      headingRow.className = "minions-section-heading-row";

      const heading = document.createElement("h3");
      heading.id = "minions-available-heading";
      heading.className = "game-controls-heading minions-panel-column-title";
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
        setTooltip(btnReroll, "Reroll", "Available only during the Main Phase.");
      } else if (p.commandPoints < rerollCost) {
        setTooltip(btnReroll, "Reroll", `Costs ${rerollCost} CP and you have ${p.commandPoints}.`);
      } else {
        setTooltip(btnReroll, "Reroll", `Spends ${rerollCost} CP to discard the current hire offers and draw a fresh pool.`);
      }
      btnReroll.addEventListener("click", () => {
        dispatch((s) => rerollHireOffers(s, content, rng));
      });
      headingRow.appendChild(btnReroll);
      section.appendChild(headingRow);

      const list = document.createElement("div");
      list.id = "minions-available-list";
      list.className = "minions-panel-list";
      hireSlots = fillMinionsHireInto(list, held?.hire ?? null);
      section.appendChild(list);
      return section;
    }

    const columnsWrap = document.createElement("div");
    columnsWrap.className = "minions-panel-columns";
    columnsWrap.appendChild(buildRosterSection());
    columnsWrap.appendChild(buildHireSection());
    minionsPanelEl.appendChild(columnsWrap);
    minionRows = { turn: state.turnNumber, roster: rosterSlots, hire: hireSlots };
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
      const json = (): string =>
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
      setCardDragPayload(article, json);
      article.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        beginCardDrag(e, json());
        e.dataTransfer!.effectAllowed = "copy";
      });
      appendAddToPlannerButton(article, "Add mission to planner", () => {
        const payload: MissionDragPayload =
          meta.source === "omega"
            ? {
                kind: "mastermind-mission",
                source: "omega",
                missionTemplateId: meta.missionTemplateId,
                stageIndex: meta.stageIndex,
                slotIndex: meta.slotIndex,
              }
            : {
                kind: "mastermind-mission",
                source: meta.source,
                missionTemplateId: meta.missionTemplateId,
              };
        return { slot: "mission", staged: applyMissionPayloadToPlanner(payload) };
      });
    } else {
      article.draggable = false;
    }

    return article;
  }

  /**
   * Which phase's missions the Omega menu is showing, or null to follow the run's own phase.
   * Clicking a phase tile pins that phase; picking the active one hands the view back.
   */
  let omegaPanelStageIndex: number | null = null;

  function renderOmegaPlanPanel(): void {
    withDeferredCardArt(openDrawer !== "omega", buildOmegaPlanPanel);
  }

  /*
   * Phase names and blurbs are fixed copy rather than content: a plan's stages carry only their
   * mission ids and how many of them must land, and every plan runs the same three beats.
   */
  const OMEGA_PHASES = [
    {
      name: "Shadow Seeding",
      blurb: "Infiltrate governments. Deploy propaganda. Establish covert networks.",
    },
    {
      name: "Global Destabilization",
      blurb: "Sabotage infrastructure. Incite unrest. Capture strategic assets.",
    },
    {
      name: "Final Subjugation",
      blurb: "Unleash final offensive. Force surrender. Establish total control.",
    },
  ] as const;

  const OMEGA_PHASE_NUMERALS = ["I", "II", "III"] as const;

  function buildOmegaPlanPanel(): void {
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

    const activeStage = state.activeOmegaStageIndex;
    const selectedStage = Math.min(
      OMEGA_STAGE_COUNT - 1,
      Math.max(0, omegaPanelStageIndex ?? activeStage),
    );
    const mainOnly = state.phase === "main";

    /* ---- Plan banner: the plan's art full-bleed, copy over it ---- */

    const hero = document.createElement("header");
    hero.className = "omega-plan-hero";
    hero.appendChild(
      createCardArtImg(resolveOmegaPlanCardArt(currentPlan), "omega-plan-hero__art"),
    );

    const heroText = document.createElement("div");
    heroText.className = "omega-plan-hero__text";

    const nameEl = document.createElement("h2");
    nameEl.className = "omega-plan-name";
    nameEl.textContent = currentPlan.name;
    heroText.appendChild(nameEl);

    if (currentPlan.description) {
      const descEl = document.createElement("p");
      descEl.className = "omega-plan-description";
      descEl.textContent = currentPlan.description;
      heroText.appendChild(descEl);
    }

    const tagline = document.createElement("p");
    tagline.className = "omega-plan-tagline";
    tagline.textContent = `Three phases. ${omegaPlanRequiredMissionTotal(currentPlan)} operations to a darker tomorrow.`;
    heroText.appendChild(tagline);

    hero.appendChild(heroText);

    omegaPlanPanelEl.appendChild(hero);

    /* ---- Phase strip: three tiles, click one to bring up its operations ---- */

    function buildPhaseTile(stageIndex: number): HTMLElement {
      const copy = OMEGA_PHASES[stageIndex]!;
      const isCurrent = stageIndex === activeStage;
      const isComplete = stageIndex < activeStage;
      const isSelected = stageIndex === selectedStage;
      const stageRequired = omegaStageRequiredMissions(currentPlan, stageIndex);
      const stageProgress = state.omegaStageProgress[stageIndex]!;
      const successes = Math.min(stageRequired, stageProgress.filter(Boolean).length);
      const percent = Math.round((successes / stageRequired) * 100);

      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "omega-phase-tile";
      tile.setAttribute("role", "tab");
      tile.setAttribute("aria-selected", isSelected ? "true" : "false");
      if (isCurrent) {
        tile.classList.add("omega-phase-tile--current");
      } else if (isComplete) {
        tile.classList.add("omega-phase-tile--complete");
      } else {
        tile.classList.add("omega-phase-tile--locked");
      }
      if (isSelected) {
        tile.classList.add("omega-phase-tile--selected");
      }

      const head = document.createElement("span");
      head.className = "omega-phase-tile__head";

      const phaseKicker = document.createElement("span");
      phaseKicker.className = "omega-phase-kicker";
      phaseKicker.textContent = `Phase ${OMEGA_PHASE_NUMERALS[stageIndex]!}`;
      head.appendChild(phaseKicker);

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
      head.appendChild(phaseBadge);
      tile.appendChild(head);

      const title = document.createElement("span");
      title.className = "omega-plan-phase-title";
      title.textContent = copy.name;
      tile.appendChild(title);

      const blurb = document.createElement("span");
      blurb.className = "omega-phase-blurb";
      blurb.textContent = copy.blurb;
      tile.appendChild(blurb);

      const foot = document.createElement("span");
      foot.className = "omega-phase-tile__foot";

      const progress = document.createElement("span");
      progress.className = "omega-phase-progress";
      const fill = document.createElement("span");
      fill.className = "omega-phase-progress__fill";
      if (isComplete) {
        fill.classList.add("omega-phase-progress__fill--complete");
      }
      fill.style.width = `${percent}%`;
      progress.appendChild(fill);
      foot.appendChild(progress);

      const stats = document.createElement("span");
      stats.className = "omega-phase-tile__stats";

      const requirement = document.createElement("span");
      requirement.className = "omega-phase-requirement";
      requirement.textContent = `Complete ${stageRequired} of ${OMEGA_MISSIONS_PER_STAGE}`;
      requirement.title =
        stageRequired < OMEGA_MISSIONS_PER_STAGE
          ? `Any ${stageRequired} of this phase's ${OMEGA_MISSIONS_PER_STAGE} missions must succeed to advance.`
          : "Every mission in this phase must succeed to advance.";
      stats.appendChild(requirement);

      const percentEl = document.createElement("span");
      percentEl.className = "omega-phase-percent";
      percentEl.textContent = `${percent}%`;
      stats.appendChild(percentEl);

      foot.appendChild(stats);
      tile.appendChild(foot);

      tile.addEventListener("click", () => {
        /* Picking the run's own phase un-pins, so the view follows the plan on from here. */
        omegaPanelStageIndex = stageIndex === activeStage ? null : stageIndex;
        renderOmegaPlanPanel();
      });

      return tile;
    }

    const strip = document.createElement("div");
    strip.className = "omega-phase-strip";
    strip.setAttribute("role", "tablist");
    strip.setAttribute("aria-label", "Omega plan phases");
    for (let stageIndex = 0; stageIndex < OMEGA_STAGE_COUNT; stageIndex += 1) {
      strip.appendChild(buildPhaseTile(stageIndex));
    }
    omegaPlanPanelEl.appendChild(strip);

    /* ---- Operations: the selected phase's missions, scrolling under a fixed heading ---- */

    const stage = currentPlan.stages[selectedStage]!;
    const stageProgress = state.omegaStageProgress[selectedStage]!;
    const isCurrentStage = selectedStage === activeStage;
    const isCompleteStage = selectedStage < activeStage;

    const ops = document.createElement("section");
    ops.className = "omega-ops";
    /* No heading of its own — the phase strip above already names the selected phase (kicker +
     * title on its tile), so a second "Phase X Operations / <name>" line here would just repeat
     * it. The accessible name still carries the phase, for anyone not reading the strip's tile. */
    ops.setAttribute("aria-label", `Phase ${OMEGA_PHASE_NUMERALS[selectedStage]!} operations`);

    const missionWrap = document.createElement("div");
    missionWrap.className = "omega-plan-phase-missions";
    for (let mi = 0; mi < OMEGA_MISSIONS_PER_STAGE; mi += 1) {
      const missionId = stage.missionIds[mi]!;
      const card = omegaPlanMissionCard(
        missionId,
        mainOnly && isCurrentStage
          ? {
              draggable: true,
              source: "omega",
              missionTemplateId: missionId,
              stageIndex: selectedStage,
              slotIndex: mi,
            }
          : undefined,
      );

      const slotDone = stageProgress[mi] === true;
      const slotRunning =
        isCurrentStage &&
        !slotDone &&
        state.activeMissions.some(
          (am) =>
            am.missionSource === "omega" &&
            am.omegaStageIndex === selectedStage &&
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
      } else if (isCompleteStage) {
        /* Phase cleared without this slot — it was never required. */
        badge.classList.add("status-badge--locked");
        badge.textContent = "Skipped";
      } else {
        /* Not done, not running, not skipped — named by its own phase's number rather than a
         * bare "Pending" or "Locked": the phase strip above already carries locked/in-progress
         * status for the phase as a whole, so repeating it card by card said nothing new. */
        badge.classList.add("status-badge--pending");
        badge.textContent = `Phase ${selectedStage + 1}`;
      }
      card.appendChild(badge);
      missionWrap.appendChild(card);
    }

    ops.appendChild(missionWrap);
    omegaPlanPanelEl.appendChild(ops);
  }

  /**
   * Owned assets as draggable art-led cards, one card per unit held. Units already reserved
   * by the staged plan are listed after the free ones, dimmed and not draggable.
   */
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
      for (let unit = 0; unit < quantity; unit += 1) {
        container.appendChild(buildAssetCardArticle(assetId, template, unit < available));
      }
    }
  }

  /** The Assets drawer: everything the run owns, one card per unit. */
  function renderAssetsPanel(): void {
    withDeferredCardArt(openDrawer !== "assets", () => {
      fillAssetsInto(assetsPanelEl);
    });
  }

  function buildAssetCardArticle(
    assetId: string,
    template: Asset | undefined,
    available: boolean,
  ): HTMLElement {
    const article = document.createElement("article");
    article.className = "asset-card";
    if (template !== undefined && isSupportAsset(template)) {
      article.classList.add("asset-card--support");
    }
    if (!available) {
      article.classList.add("asset-card--unavailable");
    }
    article.draggable = state.phase === "main" && available;
    setCardDragPayload(article, () => assetCardDragJson(assetId));
    article.addEventListener("dragstart", (e) => {
      if (!article.draggable) {
        e.preventDefault();
        return;
      }
      beginCardDrag(e, assetCardDragJson(assetId));
      e.dataTransfer!.effectAllowed = "copy";
    });
    if (article.draggable) {
      appendAddToPlannerButton(article, "Add asset to planner", () => applyAssetToPlanner(assetId));
    }

    fillAssetCard(article, assetId, template);
    return article;
  }

  /**
   * Everything an asset card says — art, name, description, support line — with none of the
   * behaviour. Split out of `buildAssetCardArticle` so a preview can reuse the card's whole face
   * without inheriting its drag payload or its Add-to-planner button, the same split
   * `fillMinionCard` / `buildMinionPreviewArticle` already runs on.
   */
  function fillAssetCard(
    article: HTMLElement,
    assetId: string,
    template: Asset | undefined,
  ): void {
    const { meta, body } = appendCardHeroShell(article, resolveAssetCardArt(template));

    const title = document.createElement("h4");
    title.className = "asset-card-title";
    title.textContent = template?.name ?? assetId;
    meta.appendChild(title);

    const descText = template?.description?.trim();
    if (descText) {
      const desc = document.createElement("p");
      desc.className = "asset-card-description";
      desc.textContent = descText;
      body.appendChild(desc);
    }

    if (template?.supportAbility !== undefined) {
      const dl = document.createElement("dl");
      dl.className = "asset-card-stats";
      appendMinionStatRows(dl, [
        { label: "Support", value: describeSupportAssetAbility(template.supportAbility) },
      ]);
      body.appendChild(dl);
    }
  }

  /**
   * The full asset card as a hover preview, for the manifest rows on mission and location cards.
   *
   * A manifest row is a 34px thumbnail and a name — enough to find an asset in a list, not
   * enough to decide anything about it. This is the same card the Assets drawer shows, floated
   * beside the row on hover by `attachAssignPickPreview`, so a required asset can be read in
   * full from the card that asks for it. Inert by construction: the preview layer is
   * `pointer-events: none`, and the card is built without a drag payload or a planner button so
   * there is nothing on it that looks clickable but is not.
   */
  function buildAssetPreviewArticle(assetId: string): HTMLElement {
    const template = content.assets.find((a) => a.id === assetId);
    const article = document.createElement("article");
    article.className = "asset-card assign-pick-preview-card";
    if (template !== undefined && isSupportAsset(template)) {
      article.classList.add("asset-card--support");
    }
    fillAssetCard(article, assetId, template);
    return article;
  }

  function formatMissionTargetSummary(target: MissionTarget): string {
    switch (target.kind) {
      case "none":
        return "—";
      case "location":
        return siteDisplayName(target.locationId);
      case "asset": {
        const locName = siteDisplayName(target.locationId);
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
    /* An Unknown target site keeps its category and level to itself, even with a crew on it. */
    const targetLoc =
      targetLocId !== null && isSiteIdentified(targetLocId)
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
      tooltipDesc?: string;
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
        ...playerVisibleSuccessOptionsForTarget(am.target, supportAbilities),
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
          tooltipDesc: supportAssetTooltipDesc(content, am.supportAssetIds),
        });
      }
      let successValue: string;
      let successTooltip: string | undefined;
      const partCap = participantCapForActiveMission(am);
      if (canAssignParticipants(participants, partCap)) {
        const breakdown = computeSuccessChanceBreakdown(mission, participants, successOpts);
        successValue = `${breakdown.finalPercent}%`;
        successTooltip = SUCCESS_CHANCE_TOOLTIP_DESC;
      } else {
        successValue = "—";
      }
      rows.push(
        successTooltip !== undefined
          ? { label: "Success chance", value: successValue, tooltipDesc: successTooltip }
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
    setTooltip(
      cancelBtn,
      "Cancel Mission",
      mainOnly
        ? "Calls the operation off. Its crew and any committed assets are free again immediately; the CP you paid to launch it is not refunded."
        : "Available only during the Main Phase.",
    );
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
   * The global event offer as a mission-list entry: which card, whether it can be dragged into
   * the planner, and the chip in its corner. Both surfaces that show the offer build their card
   * from this — the Missions menu's Event Offer group and the dashboard's Event pane — so the
   * two cannot drift on what the offer currently allows.
   */
  function eventOfferEntry(): AvailableMissionEntry | null {
    const offerId = currentEventOfferId();
    if (offerId === null) {
      return null;
    }
    const running = eventMissionRunning();
    const left = state.currentEventTurnsRemaining;
    return {
      missionTemplateId: offerId,
      dragMeta:
        state.phase === "main" && !running
          ? { draggable: true, source: "event", missionTemplateId: offerId }
          : undefined,
      status: running
        ? { label: "In Progress", kind: "inprogress" }
        : { label: `${left} ${left === 1 ? "Turn" : "Turns"} Left`, kind: "pending" },
    };
  }

  /** One entry as a card: the mission's own article, plus the status chip when it carries one. */
  function buildMissionEntryCard(entry: AvailableMissionEntry): HTMLElement {
    const card = omegaPlanMissionCard(entry.missionTemplateId, entry.dragMeta);
    if (entry.status) {
      appendMissionCardBadge(card, entry.status);
    }
    return card;
  }

  /**
   * Every mission the run has unlocked and could still be started from: the lair's own pool,
   * which is all `assignMission` still accepts from this menu. Lair upgrades are the Lair
   * menu's to show, and the active omega phase's own unfinished slots belong to the Omega Plan
   * panel — see `renderOmegaPlanPanel`.
   *
   * No Event Offer here either. The offer has its own pane on the dashboard, lit and in the
   * corner where the run puts it (`.game-panel--site-inspector--event`), and `eventOfferEntry`
   * still builds that card — so listing it again at the foot of this menu was the same offer
   * twice, with the duplicate being the copy nobody is looking at.
   */
  function fillAvailableMissionsInto(container: HTMLElement): void {
    if (state.activeLairId === null || state.lairMissionIds.length === 0) {
      const empty = document.createElement("p");
      empty.className = "assets-panel-empty";
      empty.textContent =
        state.activeLairId === null ? "No lair in this run." : "No missions at this lair.";
      container.appendChild(empty);
      return;
    }

    const mainOnly = state.phase === "main";
    const list = document.createElement("div");
    list.className = "missions-available-list";
    for (const mid of [...state.lairMissionIds].sort(compareMissionIdsByName)) {
      list.appendChild(
        buildMissionEntryCard({
          missionTemplateId: mid,
          dragMeta: mainOnly
            ? { draggable: true, source: "lair", missionTemplateId: mid }
            : undefined,
        }),
      );
    }
    container.appendChild(list);
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
    opts?: { readonly wide?: true },
  ): void {
    const column = document.createElement("section");
    column.className = "missions-menu-column";
    if (opts?.wide === true) {
      column.classList.add("missions-menu-column--wide");
    }
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
    withDeferredCardArt(openDrawer !== "missions", buildMissionsPanel);
  }

  /**
   * Three card columns wide: the offers take the first two, laid out two cards abreast, since
   * that is the list the player is actually shopping from. The third stacks what is underway
   * over what has resolved, splitting its height evenly so a long history never pushes the
   * running missions out of sight.
   */
  function buildMissionsPanel(): void {
    missionsPanelRootEl.innerHTML = "";
    const columns = document.createElement("div");
    columns.className = "missions-menu-columns";
    appendMissionsMenuColumn(columns, "Available", fillAvailableMissionsInto, { wide: true });

    const stack = document.createElement("div");
    stack.className = "missions-menu-column missions-menu-column--stack";
    appendMissionsMenuColumn(stack, "Active", (body) => {
      renderActiveMissionsInto(body);
    });
    appendMissionsMenuColumn(stack, "History", fillMissionHistoryInto);
    columns.appendChild(stack);

    missionsPanelRootEl.appendChild(columns);
  }

  function renderLocationsPanel(): void {
    withDeferredCardArt(openDrawer !== "locations", buildLocationsPanel);
  }

  function buildLocationsPanel(): void {
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

    /* Sorting an Unknown site into its category's column would say what it is, so they get a
     * column of their own, in map order (their names would give the order away just as well). */
    const identifiedLocations = runLocations().filter((loc) => isSiteIdentified(loc.id));
    const unknownLocations = runLocations().filter((loc) => !isSiteIdentified(loc.id));

    function sortedLocationsForCategory(tabType: LocationType) {
      return identifiedLocations
        .filter((loc) => loc.locationType === tabType)
        .sort((a, b) => {
          if (a.locationLevel !== b.locationLevel) {
            return a.locationLevel - b.locationLevel;
          }
          return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        });
    }

    function fillLocationList(
      listEl: HTMLElement,
      locations: readonly (typeof content.locations)[number][],
      emptyText: string,
    ): void {
      if (locations.length === 0) {
        const empty = document.createElement("p");
        empty.className = "locations-panel-empty";
        empty.textContent = emptyText;
        listEl.appendChild(empty);
        return;
      }
      for (const loc of locations) {
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

    function appendLocationColumn(
      columnsWrap: HTMLElement,
      label: string,
      locations: readonly (typeof content.locations)[number][],
      emptyText: string,
    ): void {
      const column = document.createElement("section");
      column.className = "locations-panel-column";
      column.setAttribute("aria-label", `${label} locations`);

      const heading = document.createElement("h3");
      heading.className = "game-controls-heading locations-panel-column-title";
      heading.textContent = label;

      const listEl = document.createElement("div");
      listEl.className = "locations-panel-list";
      fillLocationList(listEl, locations, emptyText);

      column.appendChild(heading);
      column.appendChild(listEl);
      columnsWrap.appendChild(column);
    }

    const columnsWrap = document.createElement("div");
    columnsWrap.className = "locations-panel-columns";
    for (const tabType of LOCATION_CATEGORY_TAB_ORDER) {
      const label = LOCATION_CATEGORY_LABEL[tabType];
      appendLocationColumn(
        columnsWrap,
        label,
        sortedLocationsForCategory(tabType),
        unknownLocations.length > 0
          ? `No known ${label.toLowerCase()} locations yet.`
          : `No ${label.toLowerCase()} locations on this map.`,
      );
    }
    if (unknownLocations.length > 0) {
      appendLocationColumn(columnsWrap, UNKNOWN_LOCATION_NAME, unknownLocations, "");
    }
    locationsPanelEl.appendChild(columnsWrap);
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
    /* The mission's name is the callout's name; everything else about the operation is the line
     * under it, run together rather than stacked. */
    setTooltip(callout, tipLines[0]!, tipLines.slice(1).join(" · "));
    callout.setAttribute("aria-label", tipLines.join(". "));
    /* Held back until the mission's packet gets here. Re-applied on every render rather than set
     * once, so a redraw mid-flight cannot land the crew ahead of the upload. */
    if (missionsInFlight.has(am.id)) {
      callout.classList.add(INBOUND_CALLOUT_CLASS);
    }

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
   * The idle roster's answer to {@link createMissionCalloutEl}: not attached to a mission, but
   * shown at the lair the same way an operation's crew shows at its target — so a minion sitting
   * out a turn still reads as "there", not simply absent from the map. Always one callout, unlike
   * missions, since idling is one state rather than one per operation.
   */
  function createIdleMinionsCalloutEl(idle: readonly MinionInstance[]): HTMLElement {
    const callout = document.createElement("div");
    callout.className = "map-callout";
    callout.tabIndex = 0;
    callout.setAttribute("role", "img");
    const names = idle.map(
      (inst) => content.minions.find((t) => t.id === inst.templateId)?.name ?? inst.templateId,
    );
    const tipLines = [
      `Idle: ${idle.length} minion${idle.length === 1 ? "" : "s"}`,
      `Crew: ${names.join(", ")}`,
    ];
    setTooltip(
      callout,
      "Idle Minions",
      `${idle.length} minion${idle.length === 1 ? "" : "s"} sitting this turn out at the lair: ${names.join(", ")}.`,
    );
    callout.setAttribute("aria-label", tipLines.join(". "));
    for (const inst of idle) {
      const tpl = content.minions.find((t) => t.id === inst.templateId);
      callout.appendChild(createCardArtImg(resolveMinionCardArt(tpl), "map-callout__portrait"));
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
   * How big the Overlays group's readouts draw once a toggle turns them on — the name label and
   * the omega/level/security/intel/assets tag rail. A player preference alongside `mapLayers`,
   * parked the same way and for the same reason.
   */
  let mapOverlayScale: number = loadMapOverlayScale(
    typeof localStorage === "undefined" ? null : localStorage,
  );
  let mapOverlayScaleInput: HTMLInputElement | null = null;
  let mapOverlayScaleValueEl: HTMLElement | null = null;
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
   * cannot skew them. A zero box means the game screen is not laid out (it is `hidden` until a
   * run starts); the observer runs everything again once it is.
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
   * early return is what keeps it free while the game screen is hidden — the observer reports a
   * hidden panel as a zero box, and there is nothing to animate.
   */
  function drawMapFrame(timeMs: number): void {
    if (mapRenderer === null || currentPlotSize() === null) {
      /* Whatever was corrupting when the frames stopped would otherwise stay on screen until
       * they resume — and for a run with no map art, forever. The schedule is pure, so there is
       * nothing to restore on the way back in: the next frame asks for the state at its own
       * time and gets it. */
      glitchDirector.clear();
      return;
    }
    if (reducedMotion.matches) {
      /* Still needs the one draw that a resize or a re-render asks for, but no clock. */
      glitchDirector.clear();
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

    /* Derived from the clock rather than kept as state, for the same reasons the ambient
     * traffic is: nothing to advance, nothing to reset when the panel is rebuilt. Between
     * bursts this is one integer comparison and no DOM work at all. */
    glitchDirector.frame(mapTimeSeconds);

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

  /* The plot resizes when the game screen is revealed for a run. Observing also fires once
   * immediately, which is what upgrades the bootstrap size above to the real fractional one. */
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

  /**
   * Ambient corruption over the map. Mounted on the floating body rather than inside
   * `#map-panel`, because `renderMapPanel` empties that on every state change and would throw
   * the pool away mid-burst; the body is static markup and outlives every render.
   *
   * Driven from `drawMapFrame` below, which is doing three jobs for it at once: it hands over
   * the same clock the camera and the ambient traffic run on, it is already gated on the panel
   * being visible, and it is already gated on `prefers-reduced-motion`. Nothing here needs to
   * re-derive any of the three.
   */
  const glitchDirector = createGlitchDirector(
    document.querySelector<HTMLElement>(".omega-body--floating") ??
      (() => {
        throw new Error("No floating body in the markup to host the glitch layer");
      })(),
  );

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
   * Push `mapOverlayScale` onto the plot as a CSS variable, the same way `applyMapLayerClasses`
   * pushes the toggles as classes — a style write rather than a rebuild, so dragging the slider
   * costs no more than flipping a checkbox does.
   */
  function applyMapOverlayScale(): void {
    if (mapPlotEl === null) {
      return;
    }
    mapPlotEl.style.setProperty("--map-overlay-scale", String(mapOverlayScale));
  }

  function setMapOverlayScale(value: number): void {
    const clamped = clampMapOverlayScale(value);
    if (clamped === mapOverlayScale) {
      return;
    }
    mapOverlayScale = clamped;
    saveMapOverlayScale(typeof localStorage === "undefined" ? null : localStorage, mapOverlayScale);
    if (mapOverlayScaleInput !== null && Number(mapOverlayScaleInput.value) !== clamped) {
      mapOverlayScaleInput.value = String(clamped);
    }
    if (mapOverlayScaleValueEl !== null) {
      mapOverlayScaleValueEl.textContent = `${clamped.toFixed(1)}x`;
    }
    applyMapOverlayScale();
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
        setTooltip(row, option.label, option.hint);

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

      if (group.label === "Overlays") {
        fieldset.appendChild(buildMapOverlayScaleRow());
      }

      mapLayersPanelEl.appendChild(fieldset);
    }
  }

  /**
   * The Overlays group's own slider: how big the name label and tag rail read once one of the
   * checkboxes above turns them on. Not a `MapLayerKey` itself — it has no on/off state to
   * default or normalize, just a number the plot renders at — so it is built by hand rather than
   * from {@link MAP_LAYER_GROUPS}.
   */
  function buildMapOverlayScaleRow(): HTMLElement {
    const row = document.createElement("div");
    row.className = "map-layers-scale";

    const label = document.createElement("label");
    label.className = "map-layers-scale__label";
    label.textContent = "Icon size";
    label.htmlFor = "map-overlay-scale-input";
    row.appendChild(label);

    const input = document.createElement("input");
    input.id = "map-overlay-scale-input";
    input.type = "range";
    input.className = "map-layers-scale__input";
    input.min = String(MAP_OVERLAY_SCALE_MIN);
    input.max = String(MAP_OVERLAY_SCALE_MAX);
    input.step = String(MAP_OVERLAY_SCALE_STEP);
    input.value = String(mapOverlayScale);
    input.setAttribute(
      "aria-label",
      "Overlay icon size. Scales the name label and the omega, level, security, intel, and assets readouts on every pin.",
    );
    input.addEventListener("input", () => {
      setMapOverlayScale(Number.parseFloat(input.value));
    });
    mapOverlayScaleInput = input;
    row.appendChild(input);

    const value = document.createElement("span");
    value.className = "map-layers-scale__value";
    value.textContent = `${mapOverlayScale.toFixed(1)}x`;
    mapOverlayScaleValueEl = value;
    row.appendChild(value);

    return row;
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
    setTooltip(home, lair.name, "Your lair — the base every operation runs from. Click to open it in the inspector.");
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

    /* A minion nobody has staged this turn is not doing nothing — it is home. Shown the same
     * way an operation's crew is shown at its target, just pinned to the lair instead. */
    const busy = busyInstanceIds(state.activeMissions);
    const idle = state.player.minions.filter((m) => !busy.has(m.instanceId));
    if (idle.length > 0) {
      const stack = document.createElement("div");
      stack.className = "map-callout-stack";
      mapProjectedEls.push({ el: stack, marker: at });
      if (at.y < 22) {
        stack.classList.add("map-callout-stack--below");
      }
      if (at.x < 15) {
        stack.classList.add("map-callout-stack--right");
      } else if (at.x > 85) {
        stack.classList.add("map-callout-stack--left");
      }
      stack.appendChild(createIdleMinionsCalloutEl(idle));
      plot.appendChild(stack);
    }
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
      /* An Unknown site's security is not the player's to read, so it never glows. */
      securityLevelByLocation: new Map(
        state.locationSecurityStates
          .filter((row) => isSiteIdentified(row.locationId))
          .map((row) => [row.locationId, row.securityLevel]),
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
      /* Intel below identity: an Unknown pin. No name, no category (colour, glyph, or the type
       * layers that dim by it), no level, security, Omega-target flag, or revealed assets —
       * only where it is and how much intel there is. */
      const identified = isLocationIdentifiedByPlayer(intel);
      const security = securityLevelForLocation(state.locationSecurityStates, loc.id);
      const agents = playerVisibleOpposingAgentsAtLocation(state, loc.id);

      mapMarkersBySubject.set(`site:${loc.id}`, marker);

      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = identified ? `map-marker map-marker--${loc.locationType}` : "map-marker";
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

      const tipLines = identified
        ? [
            loc.name,
            `${formatLocationTypeLabel(loc.locationType)} · Level ${loc.locationLevel}`,
            `Security ${security}/${maxSecurityLevelForLocation(content, loc.id)} · Intel ${intel}/${MAX_INTEL_LEVEL}`,
          ]
        : [
            UNKNOWN_LOCATION_NAME,
            `Intel ${intel}/${MAX_INTEL_LEVEL} — run a mission here to learn more`,
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
       * has switched off is still a fact about the site. An Unidentified site shows neither —
       * same rule as level and security above: a fact the player has not earned yet. */
      const omegaMissionIds = identified ? omegaTargets.get(loc.id) ?? [] : [];
      if (omegaMissionIds.length > 0) {
        const names = omegaMissionIds.map(
          (id) => findMissionOrEventTemplate(id)?.name ?? id,
        );
        tipLines.push(`Omega Phase ${omegaPhaseNumber} target: ${names.join(", ")}`);
      }
      const revealedAssetNames: string[] = [];
      if (identified) {
        for (const slot of state.locationAssetSlots.find((p) => p.locationId === loc.id)
          ?.slots ?? []) {
          /* The same bar the location card names a slot by: stored as revealed, or intel deep
           * enough to read the site's inventory. Anything short of that is not the player's to
           * see, whatever the layer is set to. */
          if (!isOccupiedAssetSlot(slot) || assetSlotKnowledge(slot, intel) !== "identified") {
            continue;
          }
          revealedAssetNames.push(assetNameById.get(slot.assetId) ?? slot.assetId);
        }
      }
      if (revealedAssetNames.length > 0) {
        tipLines.push(`Assets: ${revealedAssetNames.join(", ")}`);
      }

      pin.setAttribute("aria-label", tipLines.join(". "));

      pin.draggable = mainOnly;
      setCardDragPayload(pin, () => locationDragJson(loc.id));
      pin.addEventListener("dragstart", (e) => {
        if (!pin.draggable) {
          e.preventDefault();
          return;
        }
        e.stopPropagation();
        beginCardDrag(e, locationDragJson(loc.id));
        e.dataTransfer!.effectAllowed = "copy";
      });
      pin.addEventListener("click", () => {
        /* The hover above normally gets here first, but a touch tap does not hover: it fires
         * `pointerover` and then `pointerout` on lift, which cancels the dwell before it lands.
         * So a tap clears the breadcrumb through the click instead. Idempotent either way. */
        acknowledgeMapSubject({ kind: "site", locationId: loc.id });
        toggleMapPin({ kind: "site", locationId: loc.id });
      });

      const ring = document.createElement("span");
      ring.className = "map-marker__ring";
      pin.appendChild(ring);
      const dot = document.createElement("span");
      dot.className = "map-marker__dot";
      if (identified) {
        dot.appendChild(
          createSvgPillIcon(MAP_MARKER_TYPE_ICON_SVG_PATHS[loc.locationType], "map-marker__type-icon"),
        );
      }
      pin.appendChild(dot);

      /* The breadcrumb, if this site is carrying one. Built before the name column below so it
       * reads first — "NEW Chandra Reactor" rather than the other way round — since it is inside
       * the pin's own button and joins its accessible name. */
      if (novelty.has(siteNoveltySubject(loc.id))) {
        pin.classList.add("map-marker--flagged");
        const flag = document.createElement("span");
        flag.className = "map-marker__flag";
        flag.textContent = "NEW";
        pin.appendChild(flag);
      }

      /* Name and tag rail hang off one column under the pin, so a name showing and a readout
       * showing can never land on top of each other — which they would if each were pinned to
       * the marker at its own offset. */
      const info = document.createElement("span");
      info.className = "map-marker__info";
      const label = document.createElement("span");
      label.className = "map-marker__label";
      label.textContent = identified ? loc.name : UNKNOWN_LOCATION_NAME;
      info.appendChild(label);

      const tags = document.createElement("span");
      tags.className = "map-marker__tags";
      tags.setAttribute("aria-hidden", "true");
      if (omegaMissionIds.length > 0) {
        tags.appendChild(createMapMarkerTag("omega", null, "\u03A9"));
      }
      if (identified) {
        tags.appendChild(
          createMapMarkerTag(
            "level",
            createSvgPillIcon(LEVEL_ICON_SVG_PATHS, "map-marker__tag-icon"),
            `${loc.locationLevel}`,
          ),
        );
        tags.appendChild(
          createMapMarkerTag(
            "security",
            createSvgPillIcon(SECURITY_ICON_SVG_PATHS, "map-marker__tag-icon"),
            `${security}`,
          ),
        );
      }
      /* Intel rides after level and security rather than beside them so it sits last of the
       * three. `x / max` in the tooltip; the chip is the numerator, which is the part that
       * moves. Gated by identity like the rest: an Unidentified site's own intel count is still
       * a fact about it the player has not earned yet. */
      if (identified) {
        tags.appendChild(
          createMapMarkerTag(
            "intel",
            createSvgPillIcon(UNKNOWN_ICON_SVG_PATHS, "map-marker__tag-icon"),
            `${intel}`,
          ),
        );
      }
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
    applyMapOverlayScale();
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
  /**
   * Whether a subject still exists to be shown: sites leave with a plan swap, lairs get given
   * up, and the event offer goes the moment it expires or the player takes it.
   */
  function mapSubjectAlive(subject: MapSubject | null): boolean {
    if (subject === null) {
      return false;
    }
    switch (subject.kind) {
      case "lair":
        return state.activeLairId !== null;
      case "event":
        return currentEventOfferId() !== null;
      case "site":
        return runLocations().some((l) => l.id === subject.locationId);
    }
  }

  /**
   * How many panes the player's selections are free to fill. A global event offer owns the
   * corner pane outright — it is not a selection and there is no closing it — so while one is
   * on the table it comes off the top of what the selections can claim.
   */
  function inspectorPinCapacity(): number {
    return MAX_INSPECTOR_CARDS - (currentEventOfferId() !== null ? 1 : 0);
  }

  /**
   * Drops selections past the cap, oldest first — the same end of the row the cap has always
   * taken them from, so an offer arriving on a full row pushes a card off the corner rather
   * than stealing the one the player selected last.
   */
  function trimPinnedMapSubjects(): void {
    const capacity = inspectorPinCapacity();
    if (pinnedMapSubjects.length > capacity) {
      pinnedMapSubjects = pinnedMapSubjects.slice(pinnedMapSubjects.length - capacity);
    }
  }

  /**
   * Which subject each slot holds, nearest the map's right corner first.
   *
   * A global event offer takes the corner slot first and holds it for as long as it is on the
   * table, so it never slides out from under the eye and nothing the player does can cover it.
   * The selections fill from the first free slot leftward in the order they were made. A hover
   * goes in the next slot along — to the left of the whole stack, so every selected card and
   * its leader line stay exactly where they are while the map is browsed around them — and
   * only if the stack has left room for it. Hovering something already selected adds nothing:
   * its card is on screen already.
   */
  function inspectorSlotSubjects(): (MapSubject | null)[] {
    const slots: (MapSubject | null)[] = Array.from(
      { length: MAX_INSPECTOR_CARDS },
      () => null,
    );
    /* An open drawer covers the map the cards point into. The selection is kept, so the cards
     * come back as they were when the drawer goes down. */
    if (openDrawer !== null) {
      return slots;
    }
    const hasEventOffer = currentEventOfferId() !== null;
    if (hasEventOffer) {
      slots[0] = { kind: "event" };
    }
    /* Where the selections start: past the offer's corner when there is one. */
    const first = hasEventOffer ? 1 : 0;
    pinnedMapSubjects = pinnedMapSubjects.filter((s) => mapSubjectAlive(s));
    trimPinnedMapSubjects();
    pinnedMapSubjects.forEach((subject, i) => {
      slots[first + i] = subject;
    });
    const hovered = mapSubjectAlive(hoveredMapSubject) ? hoveredMapSubject : null;
    if (
      hovered !== null &&
      !isPinnedMapSubject(hovered) &&
      pinnedMapSubjects.length < inspectorPinCapacity()
    ) {
      slots[first + pinnedMapSubjects.length] = hovered;
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
     * is the only one that could do anything, so the preview's is not offered. The Event pane
     * takes the pointer too — the offer on it drags into the planner — but never shows an X:
     * the offer is the run's to put up and take away, not the player's to close. */
    const isEvent = subject.kind === "event";
    const isPinned = isPinnedMapSubject(subject);
    pane.el.classList.toggle("game-panel--site-inspector--pinned", isPinned);
    pane.el.classList.toggle("game-panel--site-inspector--event", isEvent);
    pane.closeEl.hidden = isEvent || !isPinned;

    pane.titleEl.textContent =
      subject.kind === "lair" ? "Lair" : subject.kind === "event" ? "Event" : "Site Detail";
    pane.el.classList.toggle(
      "game-panel--site-inspector--lair",
      subject.kind === "lair",
    );

    pane.bodyEl.innerHTML = "";
    if (subject.kind === "lair") {
      /* The drawer's contents folded into tabs, under a per-pane id prefix — several tablists
       * can be up at once, and shared tab ids would leave every `aria-labelledby` ambiguous. */
      renderLairPanelInto(pane.bodyEl, { kind: "tabs", idPrefix: `${pane.el.id}-lair` });
      return;
    }
    if (subject.kind === "event") {
      /* The same card the Missions menu files under Event Offer, chip and drag and all — the
       * offer is only being shown in a second place, not restated in a second form. */
      const entry = eventOfferEntry();
      if (entry !== null) {
        pane.bodyEl.appendChild(buildMissionEntryCard(entry));
      }
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
    /*
     * Settling on a marker is what clears its breadcrumb. The hover is already what puts the
     * site's card on screen, so it is the moment the player is actually shown the thing the flag
     * was pointing at — needing a click on top of that made the flag outlive its own answer.
     *
     * Keyboard focus lands here too (`focusin` on the plot), so tabbing the map reads the same
     * way pointing at it does. The dwell is what separates a look from a pass; see
     * `MAP_NOVELTY_DWELL_MS`.
     */
    cancelMapNoveltyDwell();
    if (subject !== null) {
      const settled = subject;
      mapNoveltyDwell = window.setTimeout(() => {
        mapNoveltyDwell = null;
        acknowledgeMapSubject(settled);
      }, MAP_NOVELTY_DWELL_MS);
    }
    syncMapReticle();
    renderSiteInspector();
  }

  /**
   * Takes a subject out of the selection. Pinning a site is purely about the inspector card —
   * it never touches the mission target slot, so letting it go does not either.
   */
  function dropPinnedMapSubject(subject: MapSubject): void {
    const key = mapSubjectKey(subject);
    const before = pinnedMapSubjects.length;
    pinnedMapSubjects = pinnedMapSubjects.filter((s) => mapSubjectKey(s) !== key);
    if (pinnedMapSubjects.length === before) {
      return;
    }
    renderSiteInspector();
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
    pinnedMapSubjects = [...pinnedMapSubjects, subject];
    trimPinnedMapSubjects();
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

  /** The Lair drawer. */
  function renderLairPanel(): void {
    withDeferredCardArt(openDrawer !== "lair", () => {
      renderLairPanelInto(lairPanelEl, { kind: "columns" });
    });
  }

  /**
   * Both surfaces that draw the lair, rendered from one place: the drawer lays every section
   * out as a column, the map inspector's narrow card folds them into tabs. `idPrefix`
   * namespaces a tablist, since several inspector cards can be up together and tablists sharing
   * tab ids would leave every `aria-labelledby` ambiguous.
   */
  function renderLairPanelInto(
    container: HTMLElement,
    layout: { readonly kind: "columns" } | { readonly kind: "tabs"; readonly idPrefix: string },
  ): void {
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
    /* The drawer keeps its own compact header — a wide column of cards below it has room to
     * spare, and a full hero card there would dwarf the columns beside it. The map inspector's
     * narrow pane is exactly where a site's card lives, so the lair gets the same one there,
     * with the tabbed sections that follow now describing the base rather than introducing it. */
    if (layout.kind === "columns") {
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
    } else {
      container.appendChild(buildLairCardArticle(lair));
    }

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

    function fillLairSectionInto(section: LairInspectorTab, container: HTMLElement): void {
      if (section === "missions") {
        fillLairMissionsInto(container);
      } else if (section === "upgrades") {
        fillLairUpgradesInto(container);
      } else {
        renderActiveMissionsInto(container);
      }
    }

    /*
     * The drawer is down to one section — what this base can still become. Missions, running or
     * on offer, are the Missions menu's to list, and what the run owns has a menu of its own, so
     * the upgrade choices keep their own two-abreast column rather than being stretched across
     * a menu they no longer share, three choices to a row.
     */
    if (layout.kind === "columns") {
      const columnsWrap = document.createElement("div");
      columnsWrap.className = "lair-panel-columns";

      const column = document.createElement("section");
      column.className = "lair-panel-column lair-panel-column--wide";
      column.setAttribute("aria-label", "Upgrades");

      const heading = document.createElement("h3");
      heading.className = "game-controls-heading lair-panel-column-title";
      heading.textContent = "Upgrades";

      const list = document.createElement("div");
      list.className = "lair-panel-missions lair-panel-missions--grid";
      fillLairUpgradesInto(list);

      column.appendChild(heading);
      column.appendChild(list);
      columnsWrap.appendChild(column);
      container.appendChild(columnsWrap);
      return;
    }

    const tablist = document.createElement("div");
    tablist.className = "lair-panel-tabs";
    tablist.setAttribute("role", "tablist");
    tablist.setAttribute("aria-label", "Lair sections");

    for (const def of LAIR_INSPECTOR_TABS) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "lair-panel-tab";
      if (def.id === lairInspectorTab) {
        tab.classList.add("lair-panel-tab--active");
      }
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", def.id === lairInspectorTab ? "true" : "false");
      tab.id = `${layout.idPrefix}-tab-${def.id}`;
      tab.textContent = def.label;
      tab.addEventListener("click", () => {
        if (lairInspectorTab === def.id) {
          return;
        }
        lairInspectorTab = def.id;
        renderSiteInspector();
      });
      tablist.appendChild(tab);
    }
    container.appendChild(tablist);

    const list = document.createElement("div");
    list.className = "lair-panel-missions";
    list.setAttribute("role", "tabpanel");
    list.setAttribute("aria-labelledby", `${layout.idPrefix}-tab-${lairInspectorTab}`);
    fillLairSectionInto(lairInspectorTab, list);
    container.appendChild(list);
  }

  /**
   * One activity event as a ticker line: a short headline and a shorter subject.
   *
   * Deliberately not `formatActivityEvent` — that writes the full sentence the Activity Log
   * reads back, rolls and deltas included, which is far too long to scroll past once. Anything
   * this does not have a headline for returns null and simply never reaches the feed, so a new
   * event kind is quiet here rather than wrong.
   */
  function tickerItemForEvent(ev: ActivityEvent): { title: string; detail: string } | null {
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

  /**
   * The scrolling feed across the top of the shell: the live event offer first, then the last
   * couple of turns of activity. Rebuilt whole on every refresh — the track is a CSS loop with
   * no per-item state to preserve, so patching it would only risk a seam.
   */
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
    /* `activityLog` is newest-turn-first (`appendActivityEvent` prepends a new bucket), so the
     * two most recent turns are at the *front* of it. Within one turn the events are appended in
     * the order they happened, which is how a turn should read, so only the last few of those are
     * trimmed. */
    for (const entry of state.activityLog.slice(0, 2)) {
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
          const from = siteDisplayName(ev.fromLocationId);
          const to = siteDisplayName(ev.toLocationId);
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
    /* In the same breath as the class, not a frame later when the observer gets round to it: the
     * planner's inline height outranks the collapse rule, so a beat between the two would fold
     * the panel to its header and leave it standing a plan tall. */
    syncPlanColumnHeight();
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

  /**
   * Push `openDrawer` onto the drawers. The slide is all CSS — a transform transition keyed off
   * `.drawer--open`. A closed drawer's menu is made inert so the part pushed below the map takes
   * no focus or clicks. One that has just been closed is marked `--closing` until it lands,
   * which drops it behind the tabs still in the row instead of sliding down across them.
   *
   * It is also where a menu's art is loaded. A drawer on its way down keeps it until it lands
   * (below), since blanking the cards out from under a menu still sliding across the map would
   * read as a glitch; the menus nobody is looking at hold parked art and cost nothing.
   */
  function applyDrawerState(): void {
    for (const drawer of menuDrawers) {
      const isOpen = drawer.id === openDrawer;
      const wasOpen = drawer.el.classList.contains("drawer--open");
      const isClosing = !isOpen && (wasOpen || drawer.el.classList.contains("drawer--closing"));
      drawer.el.classList.toggle("drawer--open", isOpen);
      drawer.el.classList.toggle("drawer--closing", isClosing);
      drawer.tabEl.setAttribute("aria-expanded", String(isOpen));
      drawer.panelEl.inert = !isOpen;
      if (isOpen || isClosing) {
        loadCardArt(drawer.panelEl);
      } else {
        unloadCardArt(drawer.panelEl);
      }
    }
    /* The map stands back while a menu is up — the plot scales down behind a veil, on the same
     * curve and duration as the slide, so the two read as one movement. Which drawer is open
     * makes no difference; the class rides `#map-panel`, which survives `renderMapPanel`'s
     * teardown of everything inside it, so a redraw mid-slide cannot drop the effect. */
    mapPanelEl.classList.toggle("map-panel--receded", openDrawer !== null);
  }

  /**
   * Pull a drawer up over the map, or pass `null` to send the open one back down. The drawers
   * are rendered with everything else on each refresh, so switching is only a matter of which
   * one is up — and of the map inspector, which stands down while the map is covered.
   */
  function setOpenDrawer(id: DrawerId | null): void {
    if (openDrawer === id) {
      return;
    }
    openDrawer = id;
    applyDrawerState();
    renderSiteInspector();
  }

  for (const drawer of menuDrawers) {
    drawer.tabEl.addEventListener("click", () => {
      setOpenDrawer(openDrawer === drawer.id ? null : drawer.id);
    });
    drawer.el.addEventListener("transitionend", (e) => {
      if (e.target === drawer.el && e.propertyName === "transform") {
        drawer.el.classList.remove("drawer--closing");
        /* Landed. A menu that has gone back down is off screen, so it lets go of its art here
         * rather than holding the decoded images for a drawer nobody has open. The Minions
         * drawer held its rows still while it was up; now nobody is looking, they go back in
         * order, drawn with their art parked like any closed menu's. */
        if (drawer.id === "minions" && openDrawer !== "minions") {
          renderMinionsPanel();
        }
        if (drawer.id !== openDrawer) {
          unloadCardArt(drawer.panelEl);
        }
      }
    });
  }

  /**
   * Hovering a Locations card lights the matching map pin and shows its name, where the open
   * drawer leaves that pin in view. Pointer events bubble from children, so relatedTarget is
   * used to ignore moves inside a card.
   */
  function locationCardFromEvent(target: EventTarget | null): HTMLElement | null {
    return target instanceof Element ? target.closest<HTMLElement>(".location-card") : null;
  }

  /** The pin a subject is drawn as, or `null` for one that has no marker on the plot. */
  function mapMarkerElFor(subject: MapSubject): HTMLElement | null {
    switch (subject.kind) {
      case "site":
        return mapPanelEl.querySelector<HTMLElement>(
          `.map-marker[data-location-id="${CSS.escape(subject.locationId)}"]`,
        );
      case "lair":
        return mapPanelEl.querySelector<HTMLElement>('.map-marker[data-map-lair="true"]');
      case "event":
        /* The event offer is an inspector card in the corner, not a marker on the map. */
        return null;
    }
  }

  /**
   * Bring one pin's breadcrumb back in line with the ledger, in place.
   *
   * A dismissal is the one map change that must not go through `renderMapPanel`: that function
   * throws every pin away and rebuilds it, which would destroy the button the pointer is resting
   * on and clear `hoveredMapSubject` — so reading a flagged site would close the card the hover
   * had just opened, until the pointer moved again. One class and one element on one pin costs
   * nothing and leaves the rest of the plot alone.
   *
   * Only ever takes a flag *down*: raising one is `renderMapPanel`'s job, because a mark can only
   * appear while `refresh` is already rebuilding the plot around it. It still reads the ledger
   * rather than taking a boolean, so the class it leaves on the pin is the ledger's answer and
   * not the caller's assumption about it.
   */
  function syncMapNoveltyFlag(subject: MapSubject): void {
    const pin = mapMarkerElFor(subject);
    const key = mapSubjectKey(subject);
    if (pin === null || key === null) {
      return;
    }
    const flagged = novelty.has(key);
    pin.classList.toggle("map-marker--flagged", flagged);
    if (!flagged) {
      pin.querySelector(".map-marker__flag")?.remove();
    }
  }

  /**
   * The player has looked at this marker: take every breadcrumb off it.
   *
   * Keyed on {@link mapSubjectKey}, not on the location id, so this covers whatever the map grows
   * a flag for next — the lair included — rather than only sites.
   */
  function acknowledgeMapSubject(subject: MapSubject): void {
    const key = mapSubjectKey(subject);
    if (key === null || !novelty.acknowledge(key)) {
      return;
    }
    syncMapNoveltyFlag(subject);
  }

  function setMapMarkerPreview(locationId: string | null): void {
    for (const pin of mapPanelEl.querySelectorAll(".map-marker--preview")) {
      pin.classList.remove("map-marker--preview");
    }
    if (locationId === null) {
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
    if (e.key !== "Escape") {
      return;
    }
    if (!overlayActivityLog.hidden) {
      e.stopPropagation();
      closeActivityLogModal();
      return;
    }
    /* Escape sends an open drawer back down, unless a dialog is up over it. Focus goes to its
     * tab: wherever it was inside the menu is about to go inert. */
    const dialogOpen =
      document.querySelector(".turn-report-overlay:not([hidden]), .pause-overlay:not([hidden])") !==
      null;
    const drawer = menuDrawers.find((d) => d.id === openDrawer);
    if (drawer !== undefined && !dialogOpen) {
      drawer.tabEl.focus();
      setOpenDrawer(null);
    }
  });

  /* ---------------------------------------------------------------------------------------
   * The status bar's readouts.
   *
   * Built once and then written in place, which is a correctness requirement rather than an
   * optimization. The row used to be reassembled with `innerHTML` on every render, and an
   * element destroyed and recreated between two frames cannot animate between them — no
   * transition fires, no count can be driven, and the readouts were structurally incapable of
   * showing a change as anything except a different number having appeared. `ui/glitchDirector`
   * keeps its shard pool for the same reason.
   *
   * The motion itself is `ui/statDelta`'s to decide; this half knows only how to print.
   * ------------------------------------------------------------------------------------- */

  interface StatRoll {
    readonly from: number;
    readonly to: number;
    readonly startMs: number;
    readonly durationMs: number;
  }

  interface StatCell {
    readonly blockEl: HTMLElement;
    readonly numEl: HTMLElement;
    /** The `/ max` tail, for the readouts that have a ceiling. */
    readonly tailEl: HTMLElement | null;
    /** The count currently running, if any. */
    roll: StatRoll | null;
    /** What is printed right now, so an unchanged frame writes nothing. */
    shown: number | null;
    shownTail: string | null;
  }

  interface StatBlockSpec {
    readonly key: string;
    readonly icon: string;
    readonly label: string;
    /**
     * The description line under the block's name on hover. Every readout in this row is an icon
     * and a bare number, which is the shape a tooltip is most owed: the row says *what* each of
     * the six numbers is at a glance and nothing at all about what any of them does.
     */
    readonly tooltip: string;
    /** The icon is a glyph rather than an SVG — the Omega mark. */
    readonly iconText?: boolean;
    readonly blockClass?: string;
    /** A fixed unit printed at full size after the number, rather than a `/ max` tail. */
    readonly unit?: string;
    /** This readout prints `value / max` and owns a trailing `<small>`. */
    readonly suffix?: boolean;
    /** This readout carries the segmented plan bar beneath it. */
    readonly segments?: boolean;
  }

  const STAT_BLOCKS: readonly StatBlockSpec[] = [
    {
      key: "omega",
      icon: "Ω",
      label: "Omega Plan",
      tooltip:
        "How far along this run's Omega Plan is — the share of the missions its three phases actually require, not all nine slots. Clearing the final phase wins the run.",
      iconText: true,
      blockClass: "stat-block--progress",
      unit: "%",
      segments: true,
    },
    {
      key: "command",
      icon: ICON_BOLT,
      label: "Command",
      tooltip:
        "Command points, and the most you can hold. CP pay for hiring, launching missions and rerolling the hire pool, and the pool refills at the start of every turn.",
      suffix: true,
    },
    { key: "infamy", icon: ICON_STAR, label: "Infamy", tooltip: INFAMY_TOOLTIP_DESC },
    {
      key: "heat",
      icon: ICON_FLAME,
      label: "Heat",
      tooltip: HEAT_TOOLTIP_DESC,
      blockClass: "stat-block--heat",
    },
    {
      key: "minions",
      icon: ICON_PERSON,
      label: "Minions",
      tooltip:
        "Minions on your roster, against the most it can hold. Hire from the pool in the Minions drawer; fire someone to make room when it is full.",
      suffix: true,
    },
    {
      key: "agents",
      icon: ICON_CROSSHAIR,
      label: "Agents",
      tooltip:
        "Opposing agents you can currently see. More spawn as your Threat Level tier rises, and the ones you have not uncovered are not counted here — the number is what you know about, not what is out there.",
    },
  ];

  const statCells = new Map<string, StatCell>();
  const omegaSegEls: HTMLElement[] = [];
  let omegaBarEl: HTMLElement | null = null;
  /** Last render's numbers, so the next one can say what moved. */
  let statReadout: ReadonlyMap<string, number> = new Map();
  let statRollRaf: number | null = null;

  function buildStatRow(): void {
    statsEl.textContent = "";
    for (const spec of STAT_BLOCKS) {
      const block = document.createElement("div");
      block.className =
        spec.blockClass === undefined ? "stat-block" : `stat-block ${spec.blockClass}`;
      /* On the block, not the label or the number: the whole readout is one thing to point at,
       * and the row is built once and written in place, so this is set once and never rewritten
       * by a render. Focusable so the tooltip is reachable without a pointer — the manager
       * listens for `focusin` as well as hover. */
      block.tabIndex = 0;
      setTooltip(block, spec.label, spec.tooltip);

      const icon = document.createElement("span");
      if (spec.iconText === true) {
        icon.className = "stat-block__icon stat-block__icon--text";
        icon.textContent = spec.icon;
      } else {
        icon.className = "stat-block__icon";
        icon.innerHTML = spec.icon;
      }
      block.appendChild(icon);

      const main = document.createElement("div");
      main.className = "stat-block__main";

      const label = document.createElement("span");
      label.className = "stat-block__label";
      label.textContent = spec.label;
      main.appendChild(label);

      const value = document.createElement("span");
      value.className = "stat-block__value";
      const num = document.createElement("span");
      num.className = "stat-block__num";
      value.appendChild(num);
      let tailEl: HTMLElement | null = null;
      if (spec.unit !== undefined) {
        const unit = document.createElement("span");
        unit.className = "stat-block__unit";
        unit.textContent = spec.unit;
        value.appendChild(unit);
      } else if (spec.suffix === true) {
        tailEl = document.createElement("small");
        value.appendChild(tailEl);
      }
      main.appendChild(value);

      if (spec.segments === true) {
        omegaBarEl = document.createElement("div");
        omegaBarEl.className = "omega-progress";
        main.appendChild(omegaBarEl);
      }

      block.appendChild(main);
      statsEl.appendChild(block);
      statCells.set(spec.key, {
        blockEl: block,
        numEl: num,
        tailEl,
        roll: null,
        shown: null,
        shownTail: null,
      });
    }
  }

  function writeStatNumber(cell: StatCell, value: number): void {
    if (cell.shown === value) {
      return;
    }
    cell.shown = value;
    cell.numEl.textContent = String(value);
  }

  function writeStatTail(key: string, tail: string): void {
    const cell = statCells.get(key);
    if (cell === undefined || cell.tailEl === null || cell.shownTail === tail) {
      return;
    }
    cell.shownTail = tail;
    cell.tailEl.textContent = tail;
  }

  /** Put a cell back in its resting state — no count running, no highlight. */
  function settleStatCell(cell: StatCell): void {
    cell.roll = null;
    cell.blockEl.style.removeProperty("--stat-flash");
    delete cell.blockEl.dataset.statMove;
  }

  function stepStatRolls(nowMs: number): void {
    let running = false;
    for (const cell of statCells.values()) {
      const roll = cell.roll;
      if (roll === null) {
        continue;
      }
      const progress = roll.durationMs <= 0 ? 1 : (nowMs - roll.startMs) / roll.durationMs;
      writeStatNumber(cell, rolledValue(roll.from, roll.to, progress));
      if (progress >= 1) {
        settleStatCell(cell);
        continue;
      }
      /* The highlight fades on the count's own clock rather than on a keyframe of its own, so
       * the two always end on the same frame. A readout still burning after its number has
       * settled reads as a second, unrelated event. */
      cell.blockEl.style.setProperty("--stat-flash", (1 - progress).toFixed(3));
      running = true;
    }
    statRollRaf = running ? requestAnimationFrame(stepStatRolls) : null;
  }

  /**
   * Start counting the readouts that moved.
   *
   * Transient, so it gets its own `requestAnimationFrame` rather than a hook on the shell's
   * loop — the same shape as the inspector slide, and for the same reason: it runs for well
   * under a second and then stops, where `mapFrameHook` exists to avoid a *second permanent*
   * loop waking the device for the whole run.
   */
  function startStatRolls(changes: readonly StatChange[]): void {
    if (changes.length === 0) {
      return;
    }
    const nowMs = performance.now();
    for (const change of changes) {
      const cell = statCells.get(change.key);
      if (cell === undefined) {
        continue;
      }
      /* From what is on screen, not from what the last render computed. If a turn resolves
       * while an earlier count is still running, the number has to carry on from where the
       * player can see it rather than snapping back to start the new leg. */
      const from = cell.shown ?? change.from;
      cell.roll = {
        from,
        to: change.to,
        startMs: nowMs,
        durationMs: rollDurationSeconds(from, change.to) * 1000,
      };
      cell.blockEl.dataset.statMove = change.direction;
      cell.blockEl.style.setProperty("--stat-flash", "1");
    }
    statRollRaf ??= requestAnimationFrame(stepStatRolls);
  }

  function renderStatusBar(): void {
    const p = state.player;
    if (statCells.size === 0) {
      buildStatRow();
    }
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

    /* The bar is only rebuilt when the plan changes how many missions it wants; the ordinary
     * case is a class toggle on segments that are already there. */
    if (omegaBarEl !== null) {
      if (omegaSegEls.length !== omegaTotal) {
        omegaBarEl.textContent = "";
        omegaSegEls.length = 0;
        for (let i = 0; i < omegaTotal; i += 1) {
          const seg = document.createElement("span");
          seg.className = "omega-progress__seg";
          omegaBarEl.appendChild(seg);
          omegaSegEls.push(seg);
        }
      }
      for (let i = 0; i < omegaSegEls.length; i += 1) {
        const seg = omegaSegEls[i]!;
        seg.classList.toggle("omega-progress__seg--filled", i < omegaFilled);
        seg.classList.toggle("omega-progress__seg--current", i === omegaFilled);
      }
    }

    writeStatTail("command", `/ ${p.maxCommandPoints}`);
    writeStatTail("minions", `/ ${p.maxRosterSize}`);

    /* Heat is the one readout carrying a standing intensity as well as a change: the glow and
     * its breath come from the value itself, so a run under pressure looks it even on a turn
     * where nothing moved. Reading state is legitimate here in a way it is not in `ui/glitch` —
     * this restates a number already printed two inches to the left rather than inventing a
     * readout the rules never agreed to publish. */
    statsEl.style.setProperty("--heat", heatPressure(p.heat).toFixed(3));

    const next = new Map<string, number>([
      ["omega", omegaPct],
      ["command", p.commandPoints],
      ["infamy", p.infamy],
      ["heat", p.heat],
      ["minions", p.minions.length],
      ["agents", totalPlayerVisibleOpposingAgents(state)],
    ]);

    const changes = reducedMotion.matches ? [] : diffReadouts(statReadout, next);
    statReadout = next;

    /* Everything not being counted is written straight out. That covers the first render of a
     * run, a reduced-motion session, and any readout that simply did not move. */
    const rolling = new Set(changes.map((change) => change.key));
    for (const [key, value] of next) {
      const cell = statCells.get(key);
      if (cell === undefined || rolling.has(key)) {
        continue;
      }
      /* A count already on its way to this value is left alone to finish.
       *
       * This is the case that makes the whole feature work, and it is not obvious: the status
       * bar is redrawn on every state change, so a render lands within a frame or two of the
       * one that started the count — and by then the readout *has* no change to report, since
       * `statReadout` already holds the destination. Settling here would snap the number to its
       * end a few frames in, which is every count in the game. */
      if (cell.roll !== null && cell.roll.to === value) {
        continue;
      }
      settleStatCell(cell);
      writeStatNumber(cell, value);
    }
    startStatRolls(changes);
  }

  /**
   * The threat meter, built once for the catalog's tier count.
   *
   * Kept for the same reason the stat row is: a skull that is recreated on every render can
   * never animate the moment it lights, and that moment is the largest single escalation the
   * game has. The tier count is fixed by content, so there is nothing here to rebuild.
   */
  const threatSkullEls: HTMLElement[] = [];
  let threatTierEl: HTMLElement | null = null;
  /** How many skulls were lit last render; -1 until the first, which never ignites. */
  let threatShownCount = -1;

  function buildThreatMeter(): void {
    threatLevelEl.textContent = "";

    const text = document.createElement("div");
    text.className = "threat-meter__text";
    const label = document.createElement("span");
    label.className = "threat-meter__label";
    label.textContent = "Threat Level";
    threatTierEl = document.createElement("span");
    threatTierEl.className = "threat-meter__tier";
    text.appendChild(label);
    text.appendChild(threatTierEl);
    threatLevelEl.appendChild(text);

    const skulls = document.createElement("div");
    skulls.className = "threat-meter__skulls";
    for (let i = 0; i < catalog.wantedLevels.length; i += 1) {
      const skull = document.createElement("span");
      skull.className = "threat-skull";
      skull.innerHTML = ICON_SKULL_FILLED;
      skulls.appendChild(skull);
      threatSkullEls.push(skull);
    }
    threatLevelEl.appendChild(skulls);
  }

  /**
   * Light a skull with a one-shot ignition.
   *
   * The class is dropped on `animationend` rather than by the next render, because renders can
   * land in quick succession and one arriving mid-burst would cut the ignition off a few frames
   * in. The wanted tier is monotonic, so a given skull ignites at most once in a run and there
   * is no re-fire to arrange.
   */
  function igniteThreatSkull(skull: HTMLElement): void {
    skull.classList.add("threat-skull--igniting");
    skull.addEventListener(
      "animationend",
      () => {
        skull.classList.remove("threat-skull--igniting");
      },
      { once: true },
    );
  }

  function renderThreatMeter(): void {
    if (threatSkullEls.length === 0) {
      buildThreatMeter();
    }
    const tierName = wantedTierAtIndex(catalog, state.wantedLevelTierIndex)?.name ?? "—";
    const activeCount = Math.min(threatSkullEls.length, state.wantedLevelTierIndex + 1);
    if (threatTierEl !== null && threatTierEl.textContent !== tierName) {
      threatTierEl.textContent = tierName;
    }

    /* An escalation, not the opening render and not a re-render at the same tier. */
    const escalated =
      threatShownCount >= 0 && activeCount > threatShownCount && !reducedMotion.matches;

    for (let i = 0; i < threatSkullEls.length; i += 1) {
      const skull = threatSkullEls[i]!;
      skull.classList.toggle("threat-skull--active", i < activeCount);
      skull.classList.toggle("threat-skull--latest", i === activeCount - 1);
      /* Only the skulls that just lit, so a jump of two notches ignites both and the rank
       * already burning stays as it was. Re-lighting the whole row would read as the meter
       * resetting rather than as more of it being taken. */
      if (escalated && i >= threatShownCount && i < activeCount) {
        igniteThreatSkull(skull);
      }
    }
    threatShownCount = activeCount;
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
    /* Whatever menu was up when the last turn ended is not what the new one is about — the
     * player's first look at a fresh turn should be the map, not wherever they left off. */
    setOpenDrawer(null);
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
    /* Before the new state, so the first sample the `refresh` below takes is the baseline for
     * this run rather than a diff against the last one — otherwise every site the previous run
     * had identified would read as having gone dark, and every site this one starts with would
     * read as news. A dwell still counting down belongs to the run being thrown away; letting it
     * land would acknowledge a subject in the new run's ledger on the player's behalf. */
    cancelMapNoveltyDwell();
    novelty.reset();
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

    /* Before anything draws, so every surface below renders against flags that are already up
     * to date rather than one pass behind whatever the last action changed. */
    observeWorldNovelty(novelty, {
      turnNumber: state.turnNumber,
      playableLocationIds: runLocations().map((l) => l.id),
      intelStates: state.locationIntelStates,
    });

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
    renderAssetsPanel();
    renderMapPanel();
    renderSiteInspector();
    if (!overlayActivityLog.hidden) {
      renderActivityLogModal();
    }
    applyPanelCollapse();
    applyDrawerState();
    /* Last, once everything above has settled: the panel can only be measured against the plan
     * that is actually in it. The observer catches the changes that happen between refreshes. */
    syncPlanColumnHeight();
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

  assignSubmitWrapEl.addEventListener("click", () => {
    if (btnAssign.disabled && assignBlockReason !== null) {
      flashAssignBlockedAlert(assignBlockReason);
    }
  });

  /**
   * Where the staged chips are standing, top of the planner down — the rows the dispatch
   * animation compiles into its payload. Measured rather than handed over as elements, because
   * applying the plan clears the planner on the same tick and a chip measured after that is
   * detached and reads as zero. DOM order is the order the slots ignite in, so the collapse
   * runs the same way down the column. Asset chips carry `.assign-minion-chip` too, so the two
   * selectors between them cover every slot that can be filled.
   */
  function stagedPlannerRowRects(): DispatchRow[] {
    return Array.from(
      planColumnPanelEl.querySelectorAll<HTMLElement>(".assign-pick-chip, .assign-minion-chip"),
    ).map((chip) => {
      const r = chip.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width };
    });
  }

  /** The map pin a staged target sits on, or null when nothing on the map represents it. */
  function missionTargetPinEl(target: MissionTarget): HTMLElement | null {
    const locationId = getMissionTargetLocationId(target);
    if (locationId === null || mapPlotEl === null) {
      return null;
    }
    return mapPlotEl.querySelector<HTMLElement>(
      `.map-marker[data-location-id="${CSS.escape(locationId)}"]`,
    );
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
      setTooltip(btnAssign, "Deploy", "This mission is no longer in the catalog — pick another from Omega, Lair or Events.");
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
    /* Held rather than generated inline: the dispatch animation needs to know which mission it
     * is carrying, so it can let that mission's crew up at the target when it arrives. */
    const activeMissionId = crypto.randomUUID();
    /* Where the staged chips are standing, read before `dispatch` applies the plan and clears
     * the planner out from under them. */
    const stagedRows = stagedPlannerRowRects();
    /* Marked in flight before the state change, so the very first render of the new callout
     * already holds the crew back. */
    missionsInFlight.add(activeMissionId);
    const launched = dispatch(
      (s) =>
        assignMission(
          s,
          content,
          activeMissionId,
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
          setTooltip(btnAssign, "Deploy", formatAssignMissionError(err));
        },
      },
    );
    if (!launched) {
      missionsInFlight.delete(activeMissionId);
      return;
    }
    /* Planning is over, so the menu that was being planned from goes back down. Without this the
     * packet flies to a pin behind an open drawer and bursts against the back of it — and the
     * drawer sliding away as the payload climbs out hands the map back at the right moment. Drop
     * this line to leave the drawer where the player left it. */
    setOpenDrawer(null);
    playDispatchSequence({
      rows: stagedRows,
      origin: btnAssign,
      /* A target-less operation has no pin to fly to, so it goes to Execute Plan — which is
       * where it will actually resolve. */
      destination: missionTargetPinEl(targetPayload) ?? btnExec,
      onArrive: () => {
        missionsInFlight.delete(activeMissionId);
        const callout = mapPlotEl?.querySelector<HTMLElement>(
          `.map-callout[data-active-mission-id="${activeMissionId}"]`,
        );
        /* Gone already — cancelled, or the map redrew to a state without it. Nothing to let up. */
        if (callout) {
          revealInboundCallout(callout);
        }
      },
    });
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
    beginCardDrag(e, minionDragJson(id));
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
  setDragTokenFaces(dragTokenFace);
  renderAssignPickSlots();
  buildMapLayersPanel();
  refresh();

  return { startRun };
}

const runSetup = initRunSetup(catalog);
const playerSettings = initSettingsMenu(
  typeof localStorage === "undefined" ? null : localStorage,
);

/* The shell the boot sequence plays on. Static markup, so it is found once rather than per run. */
const omegaShell = document.querySelector<HTMLElement>(".omega-shell");
/** The boot playing right now, if one is — held so leaving the screen can cut it short. */
let bootSequence: BootSequenceHandle | null = null;

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
  gameScreenOpened(): void {
    /* A boot left over from a run that was quit mid-sequence would still be holding the shell
     * dark; end it before arming another. */
    bootSequence?.finish();
    bootSequence = null;
    /* Read at the point of use rather than cached, so the toggle takes effect on the very next
     * run rather than on the next page load. */
    if (omegaShell === null || playerSettings.read().skipBootSequence) {
      return;
    }
    bootSequence = startBootSequence(omegaShell, {
      onDone: () => {
        bootSequence = null;
      },
    });
  },
  gameScreenClosed(): void {
    bootSequence?.finish();
    bootSequence = null;
  },
});

startRunFromMenu = initGameController(catalog, navigation, runSetup).startRun;

initStageScale();
initGlobalTooltips();
initDragFocus();
initDropHints();
initDragTether();
initDragToken();
