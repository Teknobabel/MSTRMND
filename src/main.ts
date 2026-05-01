import { resizeCanvasToDisplaySize, setupCanvas } from "./canvas/setup";
import {
  advanceToNextTurn,
  assignMission,
  busyInstanceIds,
  createInitialGameState,
  executePlan,
  hireMinion,
  rerollHireOffers,
  REROLL_HIRE_OFFERS_CP,
  type GameState,
} from "./game/gameState";
import {
  canAssignParticipants,
  successChancePercent,
} from "./game/mission";
import { loadContent } from "./game/loadContent";
import {
  locationTemplatesForOmegaPlan,
} from "./game/locationCatalog";
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
  const selLoc = req<HTMLSelectElement>("assign-location");
  const selMission = req<HTMLSelectElement>("assign-mission");
  const minionsList = req<HTMLElement>("assign-minions-list");
  const btnAssign = req<HTMLButtonElement>("btn-assign-mission");
  const btnExec = req<HTMLButtonElement>("btn-execute-plan");
  const btnNext = req<HTMLButtonElement>("btn-next-turn");
  const btnRerollHire = req<HTMLButtonElement>("btn-reroll-hire");
  const hudShort = req<HTMLElement>("game-hud-short");
  const omegaPlanPanelEl = req<HTMLElement>("omega-plan-panel");
  const locationsPanelEl = req<HTMLElement>("locations-panel");
  const assetsPanelEl = req<HTMLElement>("assets-panel");
  const missionDetailsEl = req<HTMLElement>("mission-details");

  const rng = (): number => Math.random();

  function runLocations(): (typeof content.locations)[number][] {
    return locationTemplatesForOmegaPlan(content, state.activeOmegaPlanId);
  }

  function populateLocationSelect(): void {
    selLoc.innerHTML = "";
    for (const loc of runLocations()) {
      const opt = document.createElement("option");
      opt.value = loc.id;
      opt.textContent = loc.name;
      selLoc.appendChild(opt);
    }
  }

  function updateMissionDetailsPanel(): void {
    missionDetailsEl.innerHTML = "";
    const mid = selMission.value;
    const m = content.missions.find((x) => x.id === mid);
    if (!m) {
      missionDetailsEl.hidden = true;
      return;
    }
    missionDetailsEl.hidden = false;

    const desc = document.createElement("p");
    desc.className = "mission-details-description";
    desc.textContent = m.description;

    const dl = document.createElement("dl");
    dl.className = "mission-details-stats";
    const checkedIds = [
      ...minionsList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'),
    ].map((c) => c.value);
    const participants = state.player.minions.filter((inst) =>
      checkedIds.includes(inst.instanceId),
    );
    let successValue: string;
    if (canAssignParticipants(participants)) {
      successValue = `${successChancePercent(m, participants)}%`;
    } else if (checkedIds.length === 0) {
      successValue = "—";
    } else {
      successValue = "Pick 1–3 minions";
    }

    const rows: Array<{ label: string; value: string }> = [
      { label: "Cost", value: `${m.startCommandPoints} CP` },
      { label: "Duration", value: `${m.durationTurns} turn${m.durationTurns === 1 ? "" : "s"}` },
      {
        label: "Required traits",
        value: traitDisplayNames(content, m.requiredTraitIds),
      },
      { label: "Success chance", value: successValue },
    ];
    for (const { label, value } of rows) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      dl.appendChild(dt);
      dl.appendChild(dd);
    }

    missionDetailsEl.appendChild(desc);
    missionDetailsEl.appendChild(dl);
  }

  function syncMissionSelect(): void {
    const locId = selLoc.value;
    const loc = runLocations().find((l) => l.id === locId);
    selMission.innerHTML = "";
    if (!loc) {
      updateMissionDetailsPanel();
      syncAssignButtonState();
      return;
    }
    for (const mid of loc.availableMissionIds) {
      const m = content.missions.find((x) => x.id === mid);
      const opt = document.createElement("option");
      opt.value = mid;
      const cost = m?.startCommandPoints ?? 0;
      opt.textContent = `${m?.name ?? mid} (${cost} CP)`;
      selMission.appendChild(opt);
    }
    updateMissionDetailsPanel();
    syncAssignButtonState();
  }

  function syncAssignButtonState(): void {
    const mainOnly = state.phase === "main";
    if (!mainOnly) {
      btnAssign.disabled = true;
      btnAssign.title = "Only during Main Phase";
      return;
    }
    const missionTemplate = content.missions.find((x) => x.id === selMission.value);
    if (!missionTemplate) {
      btnAssign.disabled = true;
      btnAssign.title = "Choose a mission";
      return;
    }
    const cost = missionTemplate.startCommandPoints;
    const canAfford = state.player.commandPoints >= cost;
    btnAssign.disabled = !canAfford;
    btnAssign.title = canAfford
      ? `Spend ${cost} CP to assign`
      : `Need ${cost} CP (${state.player.commandPoints} available)`;
  }

  function renderMinionCheckboxes(): void {
    minionsList.innerHTML = "";
    const busy = busyInstanceIds(state.activeMissions);
    for (const inst of state.player.minions) {
      const wrap = document.createElement("label");
      wrap.className = "game-checkbox";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = inst.instanceId;
      cb.disabled = busy.has(inst.instanceId);
      const tpl = content.minions.find((t) => t.id === inst.templateId);
      wrap.appendChild(cb);
      wrap.appendChild(document.createTextNode(` ${tpl?.name ?? inst.templateId}`));
      minionsList.appendChild(wrap);
    }
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
    minionsRosterHeading.textContent = `Your roster (${p.minions.length}/${p.maxRosterSize})`;
    minionsAvailableHeading.textContent = `Available to hire (${state.availableMinionTemplateIds.length}/${p.maxHireOffers})`;

    minionsRosterEl.innerHTML = "";
    if (state.player.minions.length === 0) {
      const empty = document.createElement("p");
      empty.className = "minions-panel-empty";
      empty.textContent = "None hired yet.";
      minionsRosterEl.appendChild(empty);
    } else {
      for (const inst of state.player.minions) {
        const tpl = content.minions.find((m) => m.id === inst.templateId);
        const card = document.createElement("article");
        card.className = "minions-card";
        const title = document.createElement("h4");
        title.className = "minions-card-title";
        title.textContent = tpl?.name ?? inst.templateId;
        card.appendChild(title);
        const dl = document.createElement("dl");
        dl.className = "minions-card-stats";
        appendMinionStatRows(dl, [
          { label: "CP cost", value: String(tpl?.hireCommandPoints ?? "—") },
          { label: "Level", value: String(inst.currentLevel) },
          { label: "XP", value: String(inst.currentExperience) },
          { label: "Traits", value: traitDisplayNames(content, inst.traitIds) },
        ]);
        card.appendChild(dl);
        minionsRosterEl.appendChild(card);
      }
    }

    minionsAvailableEl.innerHTML = "";
    if (state.availableMinionTemplateIds.length === 0) {
      const empty = document.createElement("p");
      empty.className = "minions-panel-empty";
      empty.textContent = "No minion templates in catalog.";
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

    for (let stageIndex = 0; stageIndex < 3; stageIndex += 1) {
      const stage = plan.stages[stageIndex]!;
      const section = document.createElement("section");
      section.className = "omega-plan-phase";
      section.setAttribute("aria-label", `Phase ${stageIndex + 1}`);

      const heading = document.createElement("h3");
      heading.className = "game-controls-heading omega-plan-phase-title";
      heading.textContent = `Phase ${stageIndex + 1}`;

      const ol = document.createElement("ol");
      ol.className = "omega-plan-mission-list";
      for (let mi = 0; mi < 3; mi += 1) {
        const missionId = stage.missionIds[mi]!;
        const missionTemplate = content.missions.find((m) => m.id === missionId);
        const li = document.createElement("li");
        li.textContent = missionTemplate?.name ?? missionId;
        ol.appendChild(li);
      }

      section.appendChild(heading);
      section.appendChild(ol);
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

  function renderLocationsPanel(): void {
    locationsPanelEl.innerHTML = "";
    const securityByLocationId = new Map(
      state.locationSecurityStates.map((s) => [s.locationId, s.securityLevel]),
    );
    const assetSlotsByLocationId = new Map(
      state.locationAssetSlots.map((p) => [p.locationId, p.slots]),
    );
    const assetNameById = new Map(content.assets.map((a) => [a.id, a.name]));

    for (const loc of runLocations()) {
      const article = document.createElement("article");
      article.className = "location-card";
      const title = document.createElement("h4");
      title.className = "location-card-title";
      title.textContent = loc.name;

      const dl = document.createElement("dl");
      dl.className = "location-card-stats";
      const sec = securityByLocationId.get(loc.id);
      const baseRows: Array<{ label: string; value: string }> = [
        { label: "Location type", value: formatLocationTypeLabel(loc.locationType) },
        { label: "Location level", value: String(loc.locationLevel) },
        {
          label: "Security level",
          value: sec !== undefined ? String(sec) : "—",
        },
      ];
      appendMinionStatRows(dl, baseRows);

      const slots = assetSlotsByLocationId.get(loc.id) ?? [];
      for (const slot of slots) {
        const displayValue =
          slot.visibility === "revealed"
            ? (assetNameById.get(slot.assetId) ?? slot.assetId)
            : "Asset";
        appendMinionStatRows(dl, [{ label: "Asset", value: displayValue }]);
      }

      article.appendChild(title);
      article.appendChild(dl);
      locationsPanelEl.appendChild(article);
    }
  }

  function renderActivityPanel(): void {
    activityPanelEl.innerHTML = "";
    const log = state.activityLog;
    if (log.length === 0) {
      const empty = document.createElement("p");
      empty.className = "activity-panel-empty";
      empty.textContent = "No resolve activity yet.";
      activityPanelEl.appendChild(empty);
      return;
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
          if (ev.kind === "mission_completed") {
            const li = document.createElement("li");
            li.className = "activity-event";
            const inf =
              ev.infamyDelta >= 0 ? `+${ev.infamyDelta}` : String(ev.infamyDelta);
            li.textContent = `${ev.missionName} @ ${ev.locationId}: ${
              ev.success ? "Success" : "Failure"
            } (roll ${ev.roll} vs ${ev.successChancePercent}%). Infamy ${inf}.`;
            ul.appendChild(li);
          }
        }
      }
      section.appendChild(ul);
      activityPanelEl.appendChild(section);
    }
  }

  function refresh(): void {
    const p = state.player;
    organizationNameEl.textContent = state.organizationName;
    statsEl.innerHTML = `
      <div><strong>CP:</strong> ${p.commandPoints} / ${p.maxCommandPoints}</div>
      <div><strong>Infamy:</strong> ${p.infamy}</div>
      <div><strong>Active missions:</strong> ${state.activeMissions.length}</div>
    `;
    hudShort.textContent = `T${state.turnNumber} · ${state.phase}`;

    const mainOnly = state.phase === "main";
    btnExec.hidden = !mainOnly;
    btnExec.disabled = !mainOnly;
    btnNext.hidden = mainOnly;
    btnNext.disabled = state.phase !== "summary";
    selLoc.disabled = !mainOnly;
    selMission.disabled = !mainOnly;

    renderMinionCheckboxes();
    syncMissionSelect();
    syncAssignButtonState();
    renderMinionsPanel();
    renderOmegaPlanPanel();
    renderLocationsPanel();
    renderAssetsPanel();
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

  selLoc.addEventListener("change", () => {
    syncMissionSelect();
  });

  selMission.addEventListener("change", () => {
    updateMissionDetailsPanel();
    syncAssignButtonState();
  });

  minionsList.addEventListener("change", () => {
    updateMissionDetailsPanel();
  });

  btnAssign.addEventListener("click", () => {
    if (state.phase !== "main") {
      return;
    }
    const locId = selLoc.value;
    const missionId = selMission.value;
    const checked = [
      ...minionsList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'),
    ].map((c) => c.value);
    const result = assignMission(
      state,
      content,
      crypto.randomUUID(),
      locId,
      missionId,
      checked,
    );
    if (result.ok) {
      state = result.value;
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

  populateLocationSelect();
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
