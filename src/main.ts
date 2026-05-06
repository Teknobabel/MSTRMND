import { resizeCanvasToDisplaySize, setupCanvas } from "./canvas/setup";
import {
  advanceToNextTurn,
  assignMission,
  busyInstanceIds,
  cancelMission,
  createInitialGameState,
  executePlan,
  fireMinion,
  hireMinion,
  missionSuccessOptionsForTarget,
  missionTargetMatchesTemplate,
  rehireMinion,
  rerollHireOffers,
  REROLL_HIRE_OFFERS_CP,
  type GameState,
} from "./game/gameState";
import type {
  LocationAssetSlot,
  LocationType,
  MissionSource,
  MissionTarget,
  MissionTargetType,
  Trait,
} from "./game/types";
import { isOccupiedAssetSlot } from "./game/types";
import {
  canAssignParticipants,
  mergedRequiredTraitIdsSorted,
  successChancePercent,
} from "./game/mission";
import { loadContent } from "./game/loadContent";
import {
  locationTemplatesForOmegaPlan,
} from "./game/locationCatalog";
import { getLairById, pendingLairUpgradeMissionIds } from "./game/lair";
import { getOmegaPlanById } from "./game/omegaPlan";
import { wantedTierAtIndex } from "./game/wantedLevel";
import { initNavigation } from "./navigation";

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
  catalog.organizationNames.length,
  "organization names,",
  catalog.wantedLevels.length,
  "wanted levels",
);

const canvas = document.getElementById("game-canvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Expected #game-canvas to be an HTMLCanvasElement");
}

const ctx = setupCanvas(canvas);

function drawGameFrame(): void {
  resizeCanvasToDisplaySize(canvas);
  const { width, height } = canvas;
  ctx.fillStyle = "#2a2a32";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#a1a1aa";
  ctx.font = `${Math.max(14, Math.min(width, height) * 0.06)}px system-ui`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Game", width / 2, height / 2);
}

let rafId: number | null = null;

function tick(): void {
  drawGameFrame();
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

function appendMinionTraitsRow(
  dl: HTMLElement,
  catalog: ReturnType<typeof loadContent>,
  traitIds: string[],
): void {
  const dt = document.createElement("dt");
  dt.textContent = "Traits";
  const dd = document.createElement("dd");
  dd.className = "minions-card-traits-dd";
  if (traitIds.length === 0) {
    dd.textContent = "—";
  } else {
    const wrap = document.createElement("span");
    wrap.className = "minions-card-traits-wrap";
    for (let i = 0; i < traitIds.length; i += 1) {
      if (i > 0) {
        const sep = document.createElement("span");
        sep.className = "minions-card-traits-sep";
        sep.textContent = ", ";
        wrap.appendChild(sep);
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
    dd.appendChild(wrap);
  }
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

function initGameController(content: ReturnType<typeof loadContent>): void {
  let state: GameState = createInitialGameState(content);

  const organizationNameEl = req<HTMLElement>("organization-name");
  const statsEl = req<HTMLElement>("game-stats");
  const activityPanelEl = req<HTMLElement>("activity-panel");
  const minionsRosterEl = req<HTMLElement>("minions-roster-list");
  const minionsAvailableEl = req<HTMLElement>("minions-available-list");
  const minionsRosterHeading = req<HTMLElement>("minions-roster-heading");
  const minionsAvailableHeading = req<HTMLElement>("minions-available-heading");
  const assignMissionSlotEl = req<HTMLElement>("assign-mission-slot");
  const assignTargetSlotEl = req<HTMLElement>("assign-target-slot");
  const assignTargetFieldEl = req<HTMLElement>("assign-target-field");
  const assignTargetLabelEl = req<HTMLElement>("assign-target-label");
  const minionsList = req<HTMLElement>("assign-minions-list");
  const btnAssign = req<HTMLButtonElement>("btn-assign-mission");
  const btnExec = req<HTMLButtonElement>("btn-execute-plan");
  const btnRerollHire = req<HTMLButtonElement>("btn-reroll-hire");
  const hudShort = req<HTMLElement>("game-hud-short");
  const omegaPlanPanelEl = req<HTMLElement>("omega-plan-panel");
  const locationsPanelEl = req<HTMLElement>("locations-panel");
  const assetsPanelEl = req<HTMLElement>("assets-panel");
  const activeMissionsPanelEl = req<HTMLElement>("active-missions-panel");
  const lairPanelEl = req<HTMLElement>("lair-panel");

  const rng = (): number => Math.random();

  /** Upper bound for participant assign UI; must be >= any runtime `maxParticipantsPerMission`. */
  const ASSIGN_PARTICIPANT_SLOT_CAPACITY = 12;
  const assignSlotInstanceIds: (string | null)[] = Array.from(
    { length: ASSIGN_PARTICIPANT_SLOT_CAPACITY },
    (): string | null => null,
  );
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

  function getAssignParticipantIds(): string[] {
    const max = state.player.maxParticipantsPerMission;
    return assignSlotInstanceIds
      .slice(0, max)
      .filter((id): id is string => id !== null);
  }

  function reconcileAssignSlots(): void {
    const busy = busyInstanceIds(state.activeMissions);
    const valid = new Set(state.player.minions.map((m) => m.instanceId));
    const max = state.player.maxParticipantsPerMission;
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

  function selectedMissionTemplate():
    | (typeof content.missions)[number]
    | undefined {
    if (!assignMissionTemplateId) {
      return undefined;
    }
    return content.missions.find((m) => m.id === assignMissionTemplateId);
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

  type AnyDragPayload =
    | MissionDragPayload
    | LocationDragPayload
    | AssetDragPayload
    | MinionDragPayload;

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
      };
      if (o.kind === "mastermind-mission" && o.source === "lair" && typeof o.missionTemplateId === "string") {
        return { kind: "mastermind-mission", source: "lair", missionTemplateId: o.missionTemplateId };
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
    source: "lair" | "omega",
    missionTemplateId: string,
    stageIndex?: number,
    slotIndex?: number,
  ): string {
    if (source === "lair") {
      return JSON.stringify({ kind: "mastermind-mission", source: "lair", missionTemplateId });
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
          if (
            !slot ||
            !isOccupiedAssetSlot(slot) ||
            slot.visibility !== mt.visibilityAtAssign
          ) {
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

  function assignMissionSuccessChanceLabel(): string {
    const mid = assignMissionTemplateId;
    if (!mid) {
      return "—";
    }
    const m = content.missions.find((x) => x.id === mid);
    if (!m) {
      return "—";
    }
    const slotIds = getAssignParticipantIds();
    const instanceById = new Map(
      state.player.minions.map((mi) => [mi.instanceId, mi] as const),
    );
    const participants = slotIds
      .map((id) => instanceById.get(id))
      .filter((x): x is NonNullable<typeof x> => x !== undefined);
    if (canAssignParticipants(participants, state.player.maxParticipantsPerMission)) {
      const baseOpts =
        assignTarget !== null ? missionSuccessOptionsForTarget(state, assignTarget) : {};
      const opts = { ...baseOpts, playerAssets: state.player.assets, traitsCatalog: content.traits };
      return `${successChancePercent(m, participants, opts)}%`;
    }
    if (slotIds.length === 0) {
      return "—";
    }
    return "Pick 1–" + String(state.player.maxParticipantsPerMission) + " minions";
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
      ph.textContent = "Drag a mission from Omega Plan or Lair";
      missionSlot.appendChild(ph);
    } else {
      const wrap = document.createElement("div");
      wrap.className = "assign-pick-slot-card-wrap";

      const missionTpl = content.missions.find((x) => x.id === assignMissionTemplateId);
      const mergedForAssign =
        missionTpl !== undefined
          ? mergedRequiredTraitIdsSorted(
              missionTpl,
              assignTarget !== null
                ? missionSuccessOptionsForTarget(state, assignTarget)
                : {},
            )
          : undefined;

      const article = buildMissionCatalogArticle(
        assignMissionTemplateId,
        assignMissionSuccessChanceLabel(),
        mergedForAssign,
      );
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
      const title = document.createElement("h4");
      title.className = "location-card-title";
      title.textContent = loc?.name ?? targetPick.locationId;
      article.appendChild(title);
      const dl = document.createElement("dl");
      dl.className = "location-card-stats";
      const visLabel = targetPick.visibilityAtAssign === "hidden" ? "Hidden" : "Revealed";
      let assetLabel = "Asset";
      if (slot?.kind === "empty") {
        assetLabel = "—";
      } else if (slot && isOccupiedAssetSlot(slot) && slot.visibility === "revealed") {
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
        { label: "Site traits", value: siteTraitsLabel },
        { label: "Security traits", value: securityTraitsLabel },
      ]);
      article.appendChild(dl);
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
      const chipMain = document.createElement("div");
      chipMain.className = "assign-minion-chip-main";
      const chipLabel = document.createElement("span");
      chipLabel.className = "assign-minion-chip-label";
      chipLabel.textContent = tpl?.name ?? targetPick.instanceId;
      chipMain.appendChild(chipLabel);
      if (inst && inst.traitIds.length > 0) {
        const traitsEl = document.createElement("div");
        traitsEl.className = "assign-minion-chip-traits";
        for (const tid of inst.traitIds) {
          const span = document.createElement("span");
          styleAssignChipTraitSpan(span, content, tid, new Set<string>());
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
    const missionTemplate = content.missions.find((x) => x.id === assignMissionTemplateId);
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
    const maxP = state.player.maxParticipantsPerMission;
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
    if (!canAssignParticipants(participants, state.player.maxParticipantsPerMission)) {
      btnAssign.disabled = true;
      btnAssign.title = `Assign 1–${state.player.maxParticipantsPerMission} minions`;
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

    for (let slotIndex = 0; slotIndex < state.player.maxParticipantsPerMission; slotIndex += 1) {
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
          ? content.missions.find((x) => x.id === assignMissionTemplateId)
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

        const chipMain = document.createElement("div");
        chipMain.className = "assign-minion-chip-main";

        const chipLabel = document.createElement("span");
        chipLabel.className = "assign-minion-chip-label";
        chipLabel.textContent = tpl?.name ?? instanceId;
        chipMain.appendChild(chipLabel);

        if (inst && inst.traitIds.length > 0) {
          const traitsEl = document.createElement("div");
          traitsEl.className = "assign-minion-chip-traits";
          for (const tid of inst.traitIds) {
            const span = document.createElement("span");
            styleAssignChipTraitSpan(span, content, tid, requiredTraitSet);
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
    successChanceDisplay = "—",
    mergedRequiredTraitIdsForDisplay?: string[],
  ): HTMLElement {
    const mission = content.missions.find((m) => m.id === missionId);
    const article = document.createElement("article");
    article.className = "asset-card omega-plan-mission-card";

    const title = document.createElement("h4");
    title.className = "asset-card-title";
    title.textContent = mission?.name ?? missionId;
    article.appendChild(title);

    if (mission?.description) {
      const desc = document.createElement("p");
      desc.className = "asset-card-description";
      desc.textContent = mission.description;
      article.appendChild(desc);
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
        {
          label: "Required assets",
          value: assetDisplayNames(content, mission.requiredAssetIds),
        },
        { label: "Success chance", value: successChanceDisplay },
      );
    } else {
      rows.push({ label: "Mission id", value: missionId });
    }
    appendMinionStatRows(dl, rows);
    article.appendChild(dl);
    return article;
  }

  function buildLocationCardArticle(
    loc: (typeof content.locations)[number],
    securityLevel: number | undefined,
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

    const title = document.createElement("h4");
    title.className = "location-card-title";
    title.textContent = loc.name;

    const dl = document.createElement("dl");
    dl.className = "location-card-stats";
    const baseRows: Array<{ label: string; value: string }> = [
      { label: "Location type", value: formatLocationTypeLabel(loc.locationType) },
      { label: "Location level", value: String(loc.locationLevel) },
      {
        label: "Security level",
        value: securityLevel !== undefined ? String(securityLevel) : "—",
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

    for (let si = 0; si < assetSlots.length; si += 1) {
      const slot = assetSlots[si]!;
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
        slot.visibility === "revealed"
          ? (assetNameById.get(slot.assetId) ?? slot.assetId)
          : "Asset";
      if (enableAssignDrag) {
        const chip = document.createElement("span");
        chip.className = "location-asset-drag-chip";
        chip.draggable = true;
        chip.textContent = displayValue;
        chip.title = `Drag to Plan mission target (slot ${si + 1})`;
        chip.addEventListener("dragstart", (e) => {
          e.stopPropagation();
          e.dataTransfer?.setData(
            "text/plain",
            assetDragJson(
              loc.id,
              si,
              slot.visibility === "hidden" ? "hidden" : "revealed",
            ),
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

    article.appendChild(title);
    article.appendChild(dl);
    return article;
  }

  function appendMinionStatRows(
    dl: HTMLElement,
    rows: Array<{ label: string; value: string }>,
  ): void {
    for (const { label, value } of rows) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
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
        const title = document.createElement("h4");
        title.className = "minions-card-title";
        title.textContent = tpl?.name ?? inst.templateId;
        card.appendChild(title);
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
        appendMinionTraitsRow(dl, content, inst.traitIds);
        card.appendChild(dl);

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
          const result = fireMinion(state, inst.instanceId);
          if (result.ok) {
            state = result.value;
            refresh();
          }
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
      const title = document.createElement("h4");
      title.className = "minions-card-title";
      title.textContent = tpl.name;
      card.appendChild(title);
      const dl = document.createElement("dl");
      dl.className = "minions-card-stats";
      const startingIds = tpl.startingTraitIds ?? [];
      appendMinionStatRows(dl, [
        { label: "CP cost", value: String(tpl.hireCommandPoints) },
        { label: "Level", value: String(tpl.startingLevel ?? 1) },
        { label: "XP", value: "0" },
      ]);
      appendMinionTraitsRow(dl, content, startingIds);
      card.appendChild(dl);

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
        const result = hireMinion(state, content, tpl.id, crypto.randomUUID());
        if (result.ok) {
          state = result.value;
          refresh();
        }
      });

      actions.appendChild(hireBtn);
      card.appendChild(actions);

      minionsAvailableEl.appendChild(card);
    }

    for (const { minion: rehireInst } of eligibleRehires) {
      const tpl = content.minions.find((m) => m.id === rehireInst.templateId);
      const card = document.createElement("article");
      card.className = "minions-card minions-card--available minions-card--rehire";
      const title = document.createElement("h4");
      title.className = "minions-card-title";
      title.textContent = tpl?.name ?? rehireInst.templateId;
      card.appendChild(title);
      const dl = document.createElement("dl");
      dl.className = "minions-card-stats";
      appendMinionStatRows(dl, [
        { label: "CP cost", value: String(tpl?.hireCommandPoints ?? "—") },
        { label: "Level", value: String(rehireInst.currentLevel) },
        { label: "XP", value: String(rehireInst.currentExperience) },
      ]);
      appendMinionTraitsRow(dl, content, rehireInst.traitIds);
      card.appendChild(dl);

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
        const result = rehireMinion(state, content, rehireInst.instanceId);
        if (result.ok) {
          state = result.value;
          refresh();
        }
      });

      actions.appendChild(hireBtn);
      card.appendChild(actions);
      minionsAvailableEl.appendChild(card);
    }
  }

  type MissionCardDragMeta =
    | { draggable: true; source: "lair"; missionTemplateId: string }
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

    const nameEl = document.createElement("p");
    nameEl.className = "omega-plan-name";
    nameEl.textContent = plan.name;
    omegaPlanPanelEl.appendChild(nameEl);

    const descEl = document.createElement("p");
    descEl.className = "omega-plan-description";
    descEl.textContent = plan.description;
    omegaPlanPanelEl.appendChild(descEl);

    const stageHint = document.createElement("p");
    stageHint.className = "omega-plan-stage-hint";
    stageHint.textContent = `Active phase: ${state.activeOmegaStageIndex + 1} · Row successes: ${state.omegaRowProgress.filter(Boolean).length}/3`;
    omegaPlanPanelEl.appendChild(stageHint);

    const mainOnly = state.phase === "main";
    for (let stageIndex = 0; stageIndex < 3; stageIndex += 1) {
      const stage = plan.stages[stageIndex]!;
      const section = document.createElement("section");
      section.className = "omega-plan-phase";
      section.setAttribute("aria-label", `Phase ${stageIndex + 1}`);
      const isCurrent = stageIndex === state.activeOmegaStageIndex;
      if (!isCurrent) {
        section.classList.add("omega-plan-phase--locked");
      }

      const heading = document.createElement("h3");
      heading.className = "game-controls-heading omega-plan-phase-title";
      heading.textContent = `Phase ${stageIndex + 1}`;

      const missionWrap = document.createElement("div");
      missionWrap.className = "omega-plan-phase-missions";
      for (let mi = 0; mi < 3; mi += 1) {
        const missionId = stage.missionIds[mi]!;
        missionWrap.appendChild(
          omegaPlanMissionCard(
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
          ),
        );
      }

      section.appendChild(heading);
      section.appendChild(missionWrap);
      omegaPlanPanelEl.appendChild(section);
    }
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

    for (const { assetId, quantity, template } of rows) {
      const article = document.createElement("article");
      article.className = "asset-card";
      const title = document.createElement("h4");
      title.className = "asset-card-title";
      title.textContent = template?.name ?? assetId;
      article.appendChild(title);

      const dl = document.createElement("dl");
      dl.className = "asset-card-stats";
      appendMinionStatRows(dl, [{ label: "Quantity", value: String(quantity) }]);
      article.appendChild(dl);

      const descText = template?.description?.trim();
      if (descText) {
        const desc = document.createElement("p");
        desc.className = "asset-card-description";
        desc.textContent = descText;
        article.appendChild(desc);
      }

      assetsPanelEl.appendChild(article);
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
        } else if (slot && isOccupiedAssetSlot(slot) && slot.visibility === "revealed") {
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

  function renderActiveMissionsPanel(): void {
    activeMissionsPanelEl.innerHTML = "";
    const summary = document.createElement("p");
    summary.className = "active-missions-summary";
    summary.textContent = `${state.activeMissions.length} / ${state.player.maxConcurrentMissions} missions`;
    activeMissionsPanelEl.appendChild(summary);

    if (state.activeMissions.length === 0) {
      const empty = document.createElement("p");
      empty.className = "assets-panel-empty";
      empty.textContent = "No active missions.";
      activeMissionsPanelEl.appendChild(empty);
      return;
    }

    for (const am of state.activeMissions) {
      const mission = content.missions.find((x) => x.id === am.missionTemplateId);
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
          : `Omega (phase ${(am.omegaStageIndex ?? 0) + 1} · slot ${(am.omegaSlotIndex ?? 0) + 1})`;

      const article = document.createElement("article");
      article.className = "asset-card active-mission-card";

      const title = document.createElement("h4");
      title.className = "asset-card-title";
      title.textContent = mission?.name ?? am.missionTemplateId;
      article.appendChild(title);

      if (mission?.description) {
        const desc = document.createElement("p");
        desc.className = "asset-card-description";
        desc.textContent = mission.description;
        article.appendChild(desc);
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

      const rows: Array<{ label: string; value: string }> = [
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
        const successOpts = {
          ...missionSuccessOptionsForTarget(state, am.target),
          playerAssets: state.player.assets,
          traitsCatalog: content.traits,
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
          {
            label: "Required assets",
            value: assetDisplayNames(content, mission.requiredAssetIds),
          },
        );
        let successValue: string;
        if (canAssignParticipants(participants, state.player.maxParticipantsPerMission)) {
          successValue = `${successChancePercent(mission, participants, successOpts)}%`;
        } else {
          successValue = "—";
        }
        rows.push({ label: "Success chance", value: successValue });
      } else {
        rows.push(
          { label: "Turns remaining", value: String(am.turnsRemaining) },
          { label: "Mission template", value: am.missionTemplateId },
        );
      }

      appendMinionStatRows(dl, rows);
      article.appendChild(dl);

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
        const result = cancelMission(state, content, am.id);
        if (result.ok) {
          state = result.value;
          refresh();
        }
      });
      actions.appendChild(cancelBtn);
      article.appendChild(actions);

      activeMissionsPanelEl.appendChild(article);
    }
  }

  function renderLocationsPanel(): void {
    locationsPanelEl.innerHTML = "";
    const securityByLocationId = new Map(
      state.locationSecurityStates.map((s) => [s.locationId, s.securityLevel]),
    );
    const assetSlotsByLocationId = new Map(
      state.locationAssetSlots.map((p) => [p.locationId, p.slots]),
    );
    const assetNameById = new Map(content.assets.map((a) => [a.id, a.name]));

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

    const sortedForTab = runLocations()
      .filter((loc) => loc.locationType === locationsCategoryTab)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    const mainOnly = state.phase === "main";
    if (sortedForTab.length === 0) {
      const empty = document.createElement("p");
      empty.className = "locations-panel-empty";
      empty.textContent = `No ${LOCATION_CATEGORY_LABEL[locationsCategoryTab].toLowerCase()} locations on this map.`;
      listEl.appendChild(empty);
    } else {
      for (const loc of sortedForTab) {
        const sec = securityByLocationId.get(loc.id);
        const slots = assetSlotsByLocationId.get(loc.id) ?? [];
        const article = buildLocationCardArticle(
          loc,
          sec,
          slots,
          assetNameById,
          mainOnly,
          state.locationRequiredTraits[loc.id] ?? [],
          state.locationSecurityTraits[loc.id] ?? [],
        );
        listEl.appendChild(article);
      }
    }
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
    const nameEl = document.createElement("p");
    nameEl.className = "lair-panel-name";
    nameEl.textContent = lair.name;
    lairPanelEl.appendChild(nameEl);
    if (lair.description) {
      const desc = document.createElement("p");
      desc.className = "lair-panel-description";
      desc.textContent = lair.description;
      lairPanelEl.appendChild(desc);
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
      if (state.lairMissionIds.length === 0) {
        const empty = document.createElement("p");
        empty.className = "assets-panel-empty";
        empty.textContent = "No missions at this lair.";
        list.appendChild(empty);
      } else {
        for (const mid of sortMissionIds(state.lairMissionIds)) {
          list.appendChild(
            omegaPlanMissionCard(
              mid,
              state.phase === "main"
                ? { draggable: true, source: "lair", missionTemplateId: mid }
                : undefined,
            ),
          );
        }
      }
    } else {
      const pending = sortMissionIds(
        pendingLairUpgradeMissionIds(
          state.activeLairId,
          state.completedLairUpgradeMissionIds,
          content,
        ),
      );
      if (pending.length === 0) {
        const empty = document.createElement("p");
        empty.className = "assets-panel-empty";
        empty.textContent = "No pending upgrades.";
        list.appendChild(empty);
      } else {
        for (const mid of pending) {
          list.appendChild(
            omegaPlanMissionCard(
              mid,
              state.phase === "main"
                ? { draggable: true, source: "lair", missionTemplateId: mid }
                : undefined,
            ),
          );
        }
      }
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
      return content.missions.find((m) => m.id === missionTemplateId)?.name ?? missionTemplateId;
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

    function formatActivityEvent(ev: (typeof log)[number]["events"][number]): string {
      switch (ev.kind) {
        case "mission_completed": {
          const inf =
            ev.infamyDelta >= 0 ? `+${ev.infamyDelta}` : String(ev.infamyDelta);
          const whereLabel = formatMissionTargetSummary(ev.target);
          const baseline =
            ev.baselineInfamyDelta >= 0
              ? `+${ev.baselineInfamyDelta}`
              : String(ev.baselineInfamyDelta);
          const templateFx =
            ev.templateEffectDescriptions.length > 0
              ? ev.templateEffectDescriptions.join("; ")
              : "none";
          return `${ev.missionName} @ ${whereLabel}: ${
            ev.success ? "Success" : "Failure"
          } (roll ${ev.roll} vs ${ev.successChancePercent}%). Total infamy change ${inf}. Outcome: baseline infamy ${baseline}. Mission effects: ${templateFx}.`;
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

  function refresh(): void {
    const p = state.player;
    reconcileAssignSlots();

    organizationNameEl.textContent = state.organizationName;
    statsEl.innerHTML = `
      <div><strong>CP:</strong> ${p.commandPoints} / ${p.maxCommandPoints}</div>
      <div><strong>Infamy:</strong> ${p.infamy}</div>
      <div><strong>Wanted:</strong> ${wantedTierAtIndex(catalog, state.wantedLevelTierIndex)?.name ?? "—"}</div>
    `;
    hudShort.textContent = `T${state.turnNumber} · ${state.phase}`;

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
    renderActiveMissionsPanel();
    renderLairPanel();
    renderActivityPanel();

    const rerollCost = REROLL_HIRE_OFFERS_CP;
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

  btnAssign.addEventListener("click", () => {
    if (state.phase !== "main") {
      return;
    }
    if (!assignMissionTemplateId || assignMissionSource === null) {
      return;
    }
    const mt = content.missions.find((m) => m.id === assignMissionTemplateId);
    if (!mt) {
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
    const checked = getAssignParticipantIds();
    const result = assignMission(
      state,
      content,
      crypto.randomUUID(),
      assignMissionTemplateId,
      targetPayload,
      assignMissionSource,
      assignMissionSource === "omega" ? assignOmegaStageIndex : null,
      assignMissionSource === "omega" ? assignOmegaSlotIndex : null,
      checked,
    );
    if (result.ok) {
      state = result.value;
      clearAllAssignSlots();
      refresh();
    }
  });

  btnExec.addEventListener("click", () => {
    const result = executePlan(state, content, rng);
    if (result.ok) {
      state = result.value;
      const next = advanceToNextTurn(state);
      if (next.ok) {
        state = next.value;
      }
    }
    refresh();
  });

  btnRerollHire.addEventListener("click", () => {
    const result = rerollHireOffers(state, content, rng);
    if (result.ok) {
      state = result.value;
    }
    refresh();
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
}

initGameController(catalog);

initNavigation({
  setGameLoopRunning(running: boolean): void {
    if (running) {
      startGameLoop();
    } else {
      stopGameLoop();
    }
  },
});
