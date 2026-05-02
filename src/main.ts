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
  rehireMinion,
  rerollHireOffers,
  REROLL_HIRE_OFFERS_CP,
  type GameState,
} from "./game/gameState";
import type { MissionSource, MissionTarget, MissionTargetKind } from "./game/types";
import {
  canAssignParticipants,
  successChancePercent,
} from "./game/mission";
import { loadContent } from "./game/loadContent";
import {
  locationTemplatesForOmegaPlan,
} from "./game/locationCatalog";
import { getLairById } from "./game/lair";
import { getOmegaPlanById } from "./game/omegaPlan";
import { initNavigation } from "./navigation";

const catalog = loadContent();
console.info(
  "[Mastermind] content:",
  catalog.traits.length,
  "traits,",
  catalog.minions.length,
  "minion templates,",
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
  "organization names",
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

function formatLocationTypeLabel(locationType: string): string {
  return locationType.charAt(0).toUpperCase() + locationType.slice(1);
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
  const minionsList = req<HTMLElement>("assign-minions-list");
  const btnAssign = req<HTMLButtonElement>("btn-assign-mission");
  const btnExec = req<HTMLButtonElement>("btn-execute-plan");
  const btnNext = req<HTMLButtonElement>("btn-next-turn");
  const btnRerollHire = req<HTMLButtonElement>("btn-reroll-hire");
  const hudShort = req<HTMLElement>("game-hud-short");
  const omegaPlanPanelEl = req<HTMLElement>("omega-plan-panel");
  const locationsPanelEl = req<HTMLElement>("locations-panel");
  const assetsPanelEl = req<HTMLElement>("assets-panel");
  const activeMissionsPanelEl = req<HTMLElement>("active-missions-panel");
  const lairPanelEl = req<HTMLElement>("lair-panel");

  const rng = (): number => Math.random();

  const assignSlotInstanceIds: (string | null)[] = [null, null, null];
  let assignMissionTemplateId: string | null = null;
  let assignMissionSource: MissionSource | null = null;
  let assignOmegaStageIndex: number | null = null;
  let assignOmegaSlotIndex: number | null = null;
  let assignMissionTarget: MissionTarget | null = null;
  let dndDragSource:
    | { kind: "roster" }
    | { kind: "slot"; slotIndex: number }
    | { kind: "mission-slot" }
    | { kind: "target-slot" }
    | null = null;

  function getAssignParticipantIds(): string[] {
    return assignSlotInstanceIds.filter((id): id is string => id !== null);
  }

  function reconcileAssignSlots(): void {
    const busy = busyInstanceIds(state.activeMissions);
    const valid = new Set(state.player.minions.map((m) => m.instanceId));
    for (let i = 0; i < 3; i += 1) {
      const id = assignSlotInstanceIds[i];
      if (id === null) {
        continue;
      }
      if (!valid.has(id) || busy.has(id)) {
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
    assignMissionTarget = null;
  }

  function clearAssignMissionTarget(): void {
    clearAssignMissionSlotOnly();
  }

  function clearAllAssignSlots(): void {
    assignSlotInstanceIds[0] = null;
    assignSlotInstanceIds[1] = null;
    assignSlotInstanceIds[2] = null;
    clearAssignMissionTarget();
  }

  function placeInstanceInSlot(instanceId: string, slotIndex: number): void {
    for (let i = 0; i < 3; i += 1) {
      if (assignSlotInstanceIds[i] === instanceId) {
        assignSlotInstanceIds[i] = null;
      }
    }
    assignSlotInstanceIds[slotIndex] = instanceId;
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
    kind: "mastermind-location-asset";
    locationId: string;
    assetSlotIndex: number;
  };

  function parseDragPayload(
    raw: string,
  ): MissionDragPayload | LocationDragPayload | AssetDragPayload | null {
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
        assetSlotIndex?: number;
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
      if (o.kind === "mastermind-location-asset" && typeof o.locationId === "string" && typeof o.assetSlotIndex === "number") {
        return {
          kind: "mastermind-location-asset",
          locationId: o.locationId,
          assetSlotIndex: o.assetSlotIndex,
        };
      }
      if (o.kind === "mastermind-location" && typeof o.locationId === "string") {
        return { kind: "mastermind-location", locationId: o.locationId };
      }
    } catch {
      return null;
    }
    return null;
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

  function assetDragJson(locationId: string, assetSlotIndex: number): string {
    return JSON.stringify({
      kind: "mastermind-location-asset",
      locationId,
      assetSlotIndex,
    });
  }

  function selectedAssignMissionTemplate(): (typeof content.missions)[number] | undefined {
    if (!assignMissionTemplateId) {
      return undefined;
    }
    return content.missions.find((m) => m.id === assignMissionTemplateId);
  }

  function applyMissionDragFromPayload(payload: MissionDragPayload): void {
    assignMissionTarget = null;
    assignMissionTemplateId = payload.missionTemplateId;
    assignMissionSource = payload.source;
    if (payload.source === "omega") {
      assignOmegaStageIndex = payload.stageIndex;
      assignOmegaSlotIndex = payload.slotIndex;
    } else {
      assignOmegaStageIndex = null;
      assignOmegaSlotIndex = null;
    }
    renderAssignPickSlots();
    renderAssignMinionSlots();
    onAssignSlotsChanged();
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
      if (kind === "mission") {
        if (!payload || payload.kind !== "mastermind-mission") {
          return;
        }
        applyMissionDragFromPayload(payload);
        return;
      }
      if (kind !== "target") {
        return;
      }
      if (payload?.kind === "mastermind-mission") {
        applyMissionDragFromPayload(payload);
        return;
      }
      const tpl = selectedAssignMissionTemplate();
      const targetKind: MissionTargetKind = tpl?.targetKind ?? "location";
      if (targetKind === "none") {
        return;
      }
      const playable = new Set(runLocations().map((l) => l.id));
      if (targetKind === "location") {
        if (!payload || payload.kind !== "mastermind-location") {
          return;
        }
        if (!playable.has(payload.locationId)) {
          return;
        }
        assignMissionTarget = { kind: "location", locationId: payload.locationId };
        renderAssignPickSlots();
        renderAssignMinionSlots();
        onAssignSlotsChanged();
        return;
      }
      if (targetKind === "location_asset") {
        if (!payload || payload.kind !== "mastermind-location-asset") {
          return;
        }
        if (!playable.has(payload.locationId)) {
          return;
        }
        assignMissionTarget = {
          kind: "location_asset",
          locationId: payload.locationId,
          slotIndex: payload.assetSlotIndex,
        };
        renderAssignPickSlots();
        renderAssignMinionSlots();
        onAssignSlotsChanged();
        return;
      }
      if (targetKind === "minion") {
        if (payload?.kind === "mastermind-location" || payload?.kind === "mastermind-location-asset") {
          return;
        }
        const id = raw.trim();
        const inst = state.player.minions.find((m) => m.instanceId === id);
        const busy = busyInstanceIds(state.activeMissions);
        if (inst && !busy.has(id)) {
          assignMissionTarget = { kind: "minion", instanceId: id };
          renderAssignPickSlots();
          renderAssignMinionSlots();
          onAssignSlotsChanged();
        }
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
    if (canAssignParticipants(participants)) {
      return `${successChancePercent(m, participants)}%`;
    }
    if (slotIds.length === 0) {
      return "—";
    }
    return "Pick 1–3 minions";
  }

  function renderAssignPickSlots(): void {
    assignMissionSlotEl.innerHTML = "";
    assignTargetSlotEl.innerHTML = "";
    const mainOnly = state.phase === "main";

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

      const article = buildMissionCatalogArticle(
        assignMissionTemplateId,
        assignMissionSuccessChanceLabel(),
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

    const tpl = selectedAssignMissionTemplate();
    const targetKind: MissionTargetKind = tpl?.targetKind ?? "location";
    assignTargetFieldEl.hidden = false;
    if (targetKind === "none") {
      assignTargetFieldEl.classList.add("assign-target-field--disabled");
      assignTargetFieldEl.title = "This mission does not use a map target.";
    } else {
      assignTargetFieldEl.classList.remove("assign-target-field--disabled");
      assignTargetFieldEl.removeAttribute("title");
    }

    const targetSlot = document.createElement("div");
    targetSlot.className = "assign-pick-slot-inner";
    if (targetKind === "none") {
      assignTargetSlotEl.setAttribute("aria-disabled", "true");
      assignTargetSlotEl.setAttribute(
        "aria-label",
        "Target not used; drag missions onto the Mission slot or here.",
      );
      const ph = document.createElement("span");
      ph.className = "assign-minion-slot-placeholder";
      ph.textContent = "No target for this mission";
      targetSlot.appendChild(ph);
    } else {
      assignTargetSlotEl.setAttribute("aria-disabled", "false");
      assignTargetSlotEl.setAttribute(
        "aria-label",
        "Mission target: drag a location, asset row, or minion here when required.",
      );
      if (assignMissionTarget === null) {
        const ph = document.createElement("span");
        ph.className = "assign-minion-slot-placeholder";
        if (targetKind === "location") {
          ph.textContent = "Drag a location from Locations";
        } else if (targetKind === "location_asset") {
          ph.textContent = "Drag an asset row from a location card";
        } else {
          ph.textContent = "Drag a minion from your roster";
        }
        targetSlot.appendChild(ph);
      } else if (assignMissionTarget.kind === "location") {
      const mtLoc = assignMissionTarget;
      const loc = content.locations.find((l) => l.id === mtLoc.locationId);
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
        const article = buildLocationCardArticle(loc, securityByLocationId.get(loc.id), slots, assetNameById, {
          location: false,
          asset: false,
        });
        article.classList.add("assign-pick-embedded-card");
        article.draggable = mainOnly;
        article.addEventListener("dragstart", (e) => {
          if (!mainOnly) {
            e.preventDefault();
            return;
          }
          dndDragSource = { kind: "target-slot" };
          e.dataTransfer?.setData("text/plain", locationDragJson(mtLoc.locationId));
          e.dataTransfer!.effectAllowed = "move";
        });
        wrap.appendChild(article);
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "assign-pick-slot-clear";
        removeBtn.setAttribute("aria-label", "Clear target");
        removeBtn.textContent = "×";
        removeBtn.disabled = !mainOnly;
        removeBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          assignMissionTarget = null;
          renderAssignPickSlots();
          renderAssignMinionSlots();
          onAssignSlotsChanged();
        });
        removeBtn.addEventListener("mousedown", (ev) => {
          ev.stopPropagation();
        });
        wrap.appendChild(removeBtn);
        targetSlot.appendChild(wrap);
      }
    } else if (assignMissionTarget.kind === "location_asset") {
      const mtAsset = assignMissionTarget;
      const loc = content.locations.find((l) => l.id === mtAsset.locationId);
      const placement = state.locationAssetSlots.find((p) => p.locationId === mtAsset.locationId);
      const slot = placement?.slots[mtAsset.slotIndex];
      const assetName = slot
        ? content.assets.find((a) => a.id === slot.assetId)?.name ?? slot.assetId
        : "—";
      const wrap = document.createElement("div");
      wrap.className = "assign-pick-slot-card-wrap";
      const article = document.createElement("article");
      article.className = "asset-card assign-pick-embedded-card";
      const title = document.createElement("h4");
      title.className = "asset-card-title";
      title.textContent = assetName;
      article.appendChild(title);
      const p = document.createElement("p");
      p.className = "asset-card-description";
      p.textContent = loc ? `At ${loc.name}` : mtAsset.locationId;
      article.appendChild(p);
      article.draggable = mainOnly;
      article.addEventListener("dragstart", (e) => {
        if (!mainOnly) {
          e.preventDefault();
          return;
        }
        dndDragSource = { kind: "target-slot" };
        e.dataTransfer?.setData(
          "text/plain",
          assetDragJson(mtAsset.locationId, mtAsset.slotIndex),
        );
        e.dataTransfer!.effectAllowed = "move";
      });
      wrap.appendChild(article);
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "assign-pick-slot-clear";
      removeBtn.setAttribute("aria-label", "Clear target");
      removeBtn.textContent = "×";
      removeBtn.disabled = !mainOnly;
      removeBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        assignMissionTarget = null;
        renderAssignPickSlots();
        renderAssignMinionSlots();
        onAssignSlotsChanged();
      });
      removeBtn.addEventListener("mousedown", (ev) => {
        ev.stopPropagation();
      });
      wrap.appendChild(removeBtn);
      targetSlot.appendChild(wrap);
    } else if (assignMissionTarget.kind === "minion") {
      const mtMin = assignMissionTarget;
      const inst = state.player.minions.find((m) => m.instanceId === mtMin.instanceId);
      const minTpl = inst
        ? content.minions.find((t) => t.id === inst.templateId)
        : undefined;
      const wrap = document.createElement("div");
      wrap.className = "assign-pick-slot-card-wrap";
      const article = document.createElement("article");
      article.className = "minions-card assign-pick-embedded-card";
      const title = document.createElement("h4");
      title.className = "minions-card-title";
      title.textContent = minTpl?.name ?? mtMin.instanceId;
      article.appendChild(title);
      article.draggable = mainOnly;
      article.addEventListener("dragstart", (e) => {
        if (!mainOnly) {
          e.preventDefault();
          return;
        }
        dndDragSource = { kind: "target-slot" };
        e.dataTransfer?.setData("text/plain", mtMin.instanceId);
        e.dataTransfer!.effectAllowed = "move";
      });
      wrap.appendChild(article);
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "assign-pick-slot-clear";
      removeBtn.setAttribute("aria-label", "Clear target");
      removeBtn.textContent = "×";
      removeBtn.disabled = !mainOnly;
      removeBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        assignMissionTarget = null;
        renderAssignPickSlots();
        renderAssignMinionSlots();
        onAssignSlotsChanged();
      });
      removeBtn.addEventListener("mousedown", (ev) => {
        ev.stopPropagation();
      });
      wrap.appendChild(removeBtn);
      targetSlot.appendChild(wrap);
    }
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
    const tk = missionTemplate.targetKind;
    const targetOk =
      tk === "none" ||
      (assignMissionTarget !== null && assignMissionTarget.kind === tk);
    if (!targetOk) {
      btnAssign.disabled = true;
      btnAssign.title = "Choose a mission target";
      return;
    }
    const atMissionCap =
      state.activeMissions.length >= state.player.maxConcurrentMissions;
    if (atMissionCap) {
      btnAssign.disabled = true;
      btnAssign.title = `At concurrent mission limit (${state.activeMissions.length}/${state.player.maxConcurrentMissions})`;
      return;
    }
    const parts = getAssignParticipantIds();
    if (parts.length < 1 || parts.length > 3) {
      btnAssign.disabled = true;
      btnAssign.title = "Assign 1–3 minions";
      return;
    }
    const instanceById = new Map(
      state.player.minions.map((m) => [m.instanceId, m] as const),
    );
    const participants = parts
      .map((id) => instanceById.get(id))
      .filter((x): x is NonNullable<typeof x> => x !== undefined);
    if (!canAssignParticipants(participants)) {
      btnAssign.disabled = true;
      btnAssign.title = "Assign 1–3 minions";
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

    for (let slotIndex = 0; slotIndex < 3; slotIndex += 1) {
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
        const inst = state.player.minions.find((m) => m.instanceId === raw);
        if (!inst || busy.has(raw)) {
          return;
        }
        placeInstanceInSlot(raw, slotIndex);
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
        const requiredTraitSet = new Set(mission?.requiredTraitIds ?? []);

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
            span.className = "assign-minion-chip-trait";
            if (requiredTraitSet.has(tid)) {
              span.classList.add("assign-minion-chip-trait--match");
            }
            span.textContent = content.traits.find((t) => t.id === tid)?.name ?? tid;
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
      rows.push(
        { label: "Start cost", value: `${mission.startCommandPoints} CP` },
        {
          label: "Duration",
          value: `${mission.durationTurns} turn${mission.durationTurns === 1 ? "" : "s"}`,
        },
        {
          label: "Required traits",
          value: traitDisplayNames(content, mission.requiredTraitIds),
        },
        { label: "Target type", value: mission.targetKind },
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
    assetSlots: { assetId: string; visibility: string }[],
    assetNameById: Map<string, string>,
    assignDrag: { location: boolean; asset: boolean },
  ): HTMLElement {
    const article = document.createElement("article");
    article.className = "location-card";
    if (assignDrag.location) {
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
    ];
    appendMinionStatRows(dl, baseRows);

    for (let slotIndex = 0; slotIndex < assetSlots.length; slotIndex += 1) {
      const slot = assetSlots[slotIndex]!;
      const displayValue =
        slot.visibility === "revealed"
          ? (assetNameById.get(slot.assetId) ?? slot.assetId)
          : "Asset";
      const dt = document.createElement("dt");
      dt.textContent = "Asset";
      const dd = document.createElement("dd");
      if (assignDrag.asset && slot.assetId) {
        dd.draggable = true;
        dd.classList.add("assign-draggable-location-asset");
        dd.textContent = displayValue;
        dd.title = "Drag to mission Target";
        dd.addEventListener("dragstart", (e) => {
          e.stopPropagation();
          e.dataTransfer?.setData("text/plain", assetDragJson(loc.id, slotIndex));
          e.dataTransfer!.effectAllowed = "copy";
        });
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
          { label: "Traits", value: traitDisplayNames(content, inst.traitIds) },
        ]);
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
        { label: "Level", value: "—" },
        { label: "XP", value: "—" },
        {
          label: "Traits",
          value: traitDisplayNames(content, startingIds),
        },
      ]);
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
        { label: "Traits", value: traitDisplayNames(content, rehireInst.traitIds) },
      ]);
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

  function missionTargetSummary(mt: MissionTarget): string {
    switch (mt.kind) {
      case "none":
        return "None";
      case "location": {
        return content.locations.find((l) => l.id === mt.locationId)?.name ?? mt.locationId;
      }
      case "location_asset": {
        const loc = content.locations.find((l) => l.id === mt.locationId);
        const placement = state.locationAssetSlots.find((p) => p.locationId === mt.locationId);
        const slot = placement?.slots[mt.slotIndex];
        const assetLabel = slot
          ? content.assets.find((a) => a.id === slot.assetId)?.name ?? slot.assetId
          : "—";
        return `${assetLabel} @ ${loc?.name ?? mt.locationId}`;
      }
      case "minion": {
        const inst = state.player.minions.find((m) => m.instanceId === mt.instanceId);
        return inst
          ? content.minions.find((t) => t.id === inst.templateId)?.name ?? mt.instanceId
          : mt.instanceId;
      }
      default: {
        const _x: never = mt;
        return String(_x);
      }
    }
  }

  function primaryLocationForMissionTarget(mt: MissionTarget): (typeof content.locations)[number] | undefined {
    if (mt.kind === "location") {
      return content.locations.find((l) => l.id === mt.locationId);
    }
    if (mt.kind === "location_asset") {
      return content.locations.find((l) => l.id === mt.locationId);
    }
    return undefined;
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
      const targetLoc = primaryLocationForMissionTarget(am.missionTarget);
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
        { label: "Target", value: missionTargetSummary(am.missionTarget) },
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
            value: traitDisplayNames(content, mission.requiredTraitIds),
          },
        );
        let successValue: string;
        if (canAssignParticipants(participants)) {
          successValue = `${successChancePercent(mission, participants)}%`;
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

    const mainOnly = state.phase === "main";
    const selTpl = assignMissionTemplateId
      ? content.missions.find((m) => m.id === assignMissionTemplateId)
      : undefined;
    const enableLocationDrag = mainOnly && selTpl?.targetKind === "location";
    const enableAssetDrag = mainOnly && selTpl?.targetKind === "location_asset";

    for (const loc of runLocations()) {
      const sec = securityByLocationId.get(loc.id);
      const slots = assetSlotsByLocationId.get(loc.id) ?? [];
      const article = buildLocationCardArticle(loc, sec, slots, assetNameById, {
        location: enableLocationDrag,
        asset: enableAssetDrag,
      });
      locationsPanelEl.appendChild(article);
    }
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
    const list = document.createElement("div");
    list.className = "lair-panel-missions";
    if (state.lairMissionIds.length === 0) {
      const empty = document.createElement("p");
      empty.className = "assets-panel-empty";
      empty.textContent = "No missions at this lair.";
      list.appendChild(empty);
    } else {
      for (const mid of state.lairMissionIds) {
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
          const targetLabel = missionTargetSummary(ev.missionTarget);
          return `${ev.missionName} (${targetLabel}): ${
            ev.success ? "Success" : "Failure"
          } (roll ${ev.roll} vs ${ev.successChancePercent}%). Infamy ${inf}.`;
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
          const targetLabel = missionTargetSummary(ev.missionTarget);
          const who = participantNames(ev.participantInstanceIds);
          return `${m} started — target: ${targetLabel} (${who}).`;
        }
        case "mission_cancelled": {
          const m = missionName(ev.missionTemplateId);
          const targetLabel = missionTargetSummary(ev.missionTarget);
          return `${m} cancelled — target: ${targetLabel}.`;
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
    `;
    hudShort.textContent = `T${state.turnNumber} · ${state.phase}`;

    const mainOnly = state.phase === "main";
    btnExec.hidden = !mainOnly;
    btnExec.disabled = !mainOnly;
    btnNext.hidden = mainOnly;
    btnNext.disabled = state.phase !== "summary";

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
    if (
      !assignMissionTemplateId ||
      assignMissionSource === null
    ) {
      return;
    }
    const missionTemplate = content.missions.find((x) => x.id === assignMissionTemplateId);
    if (!missionTemplate) {
      return;
    }
    let missionTarget: MissionTarget;
    if (missionTemplate.targetKind === "none") {
      missionTarget = { kind: "none" };
    } else {
      if (!assignMissionTarget || assignMissionTarget.kind !== missionTemplate.targetKind) {
        return;
      }
      missionTarget = assignMissionTarget;
    }
    const checked = getAssignParticipantIds();
    const result = assignMission(
      state,
      content,
      crypto.randomUUID(),
      assignMissionTemplateId,
      missionTarget,
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
    }
    refresh();
  });

  btnNext.addEventListener("click", () => {
    const result = advanceToNextTurn(state);
    if (result.ok) {
      state = result.value;
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
    e.dataTransfer?.setData("text/plain", id);
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
    if (src?.kind === "target-slot") {
      if (e.dataTransfer?.dropEffect === "none") {
        assignMissionTarget = null;
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
