import {
  CONTENT_SLICE_KEYS,
  type ContentIssue,
  type ContentSliceKey,
  type RawContentSlices,
} from "../game/contentSchema";
import { RENAMABLE_SLICES, applyIdRenameRaw } from "../game/contentRename";
import { collectContentReferences, referencesTo, unreferencedIds } from "../game/contentRefs";
import { fetchSlices, saveSlices } from "./api";
import { clearPersistedDraft, createStore, loadPersistedDraft, type EditorStore } from "./store";
import { el, str, type Row } from "./widgets";
import type { FormCtx } from "./forms/context";
import {
  renderAssetForm,
  renderLocationForm,
  renderMapForm,
  renderOrganizationNameForm,
  renderPlayerProfileForm,
  renderTraitForm,
  renderWantedLevelForm,
} from "./forms/simpleForms";
import { renderMinionForm } from "./forms/minionForm";
import { renderMissionForm } from "./forms/missionForm";
import { renderLairForm, renderOmegaPlanForm } from "./forms/lairOmegaForms";

const SLICE_ORDER: ContentSliceKey[] = [
  "traits",
  "assets",
  "minions",
  "agents",
  "missions",
  "events",
  "locations",
  "maps",
  "omegaPlans",
  "lairs",
  "wantedLevels",
  "organizationNames",
  "playerProfiles",
];

const SLICE_LABELS: Record<ContentSliceKey, string> = {
  traits: "Traits",
  assets: "Assets",
  minions: "Minions",
  agents: "Agents",
  missions: "Missions",
  events: "Events",
  locations: "Locations",
  maps: "Maps",
  omegaPlans: "Omega Plans",
  lairs: "Lairs",
  wantedLevels: "Wanted Levels",
  organizationNames: "Org Names",
  playerProfiles: "Player Profiles",
};

type FormRenderer = (container: HTMLElement, ctx: FormCtx) => void;

const FORM_RENDERERS: Record<ContentSliceKey, FormRenderer> = {
  traits: renderTraitForm,
  assets: renderAssetForm,
  minions: renderMinionForm,
  agents: renderMinionForm,
  missions: renderMissionForm,
  events: renderMissionForm,
  locations: renderLocationForm,
  maps: renderMapForm,
  omegaPlans: renderOmegaPlanForm,
  lairs: renderLairForm,
  wantedLevels: renderWantedLevelForm,
  organizationNames: renderOrganizationNameForm,
  playerProfiles: renderPlayerProfileForm,
};

function sliceArray(draft: RawContentSlices, slice: ContentSliceKey): unknown[] {
  const v = draft[slice];
  return Array.isArray(v) ? v : [];
}

function entityId(row: unknown): string | null {
  if (typeof row === "string") {
    return null;
  }
  const id = (row as Row).id;
  return typeof id === "string" ? id : null;
}

function entityLabel(slice: ContentSliceKey, row: unknown, index: number): string {
  if (typeof row === "string") {
    return row;
  }
  const r = row as Row;
  if (slice === "wantedLevels") {
    return `${String(r.minInfamy ?? "?")}+ · ${str(r, "name") || `#${index}`}`;
  }
  return str(r, "name") || str(r, "id") || `#${index}`;
}

function defaultRowForSlice(
  slice: ContentSliceKey,
  id: string,
  draft: RawContentSlices,
): unknown {
  const firstId = (s: ContentSliceKey): string => {
    const rows = sliceArray(draft, s);
    for (const r of rows) {
      const rid = entityId(r);
      if (rid !== null) {
        return rid;
      }
    }
    return "";
  };
  switch (slice) {
    case "traits":
      return { id, name: "New Trait", type: "primary" };
    case "assets":
      return { id, name: "New Asset" };
    case "minions":
    case "agents":
      return { id, name: "New Template", description: "", hireCommandPoints: 0, levelUpTraitOrder: [] };
    case "missions":
    case "events":
      return {
        id,
        name: "New Mission",
        description: "",
        targetType: "none",
        startCommandPoints: 0,
        requiredTraitIds: [],
        requiredAssetIds: [],
        durationTurns: 1,
      };
    case "locations":
      return { id, name: "New Location", description: "", locationType: "economic", locationLevel: 1 };
    case "maps":
      return { id, name: "New Map", description: "", locationIds: [] };
    case "omegaPlans": {
      const m = firstId("missions");
      return {
        id,
        name: "New Omega Plan",
        description: "",
        mapId: firstId("maps"),
        stages: [
          { missionIds: [m, m, m] },
          { missionIds: [m, m, m] },
          { missionIds: [m, m, m] },
        ],
      };
    }
    case "lairs":
      return { id, name: "New Lair", availableMissionIds: [] };
    case "wantedLevels":
      return { minInfamy: 0, name: "New Tier", maxAgents: 0 };
    case "organizationNames":
      return "New Organization";
    case "playerProfiles":
      return { name: "New Profile", profilePic: "/assets/profile.png" };
  }
}

function issuesForEntity(
  issues: readonly ContentIssue[],
  slice: ContentSliceKey,
  id: string | null,
  index: number,
): ContentIssue[] {
  return issues.filter((i) => {
    if (i.slice !== slice) {
      return false;
    }
    if (id !== null) {
      return i.entityId === id;
    }
    return i.entityId === null && (i.path.startsWith(`[${index}]`) || i.path === "");
  });
}

function showModal(
  title: string,
  content: HTMLElement,
  actions: { label: string; primary?: boolean; onClick?: () => void }[],
): void {
  const backdrop = el("div", "ed-modal-backdrop");
  const modal = el("div", "ed-modal");
  modal.appendChild(el("h3", "", title));
  modal.appendChild(content);
  const bar = el("div", "ed-modal-actions");
  for (const a of actions) {
    const btn = el("button", a.primary === true ? "ed-btn-primary" : "", a.label);
    btn.addEventListener("click", () => {
      document.body.removeChild(backdrop);
      a.onClick?.();
    });
    bar.appendChild(btn);
  }
  modal.appendChild(bar);
  backdrop.appendChild(modal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      document.body.removeChild(backdrop);
    }
  });
  document.body.appendChild(backdrop);
}

function uniqueCopyId(existing: Set<string>, base: string): string {
  let candidate = `${base}-copy`;
  let n = 2;
  while (existing.has(candidate)) {
    candidate = `${base}-copy${n}`;
    n += 1;
  }
  return candidate;
}

function initEditor(store: EditorStore): void {
  const root = document.getElementById("editor-root");
  if (root === null) {
    throw new Error("Missing #editor-root");
  }

  let selectedSlice: ContentSliceKey = "missions";
  let selectedIndex = 0;
  let statusOverride: string | null = null;

  function select(slice: ContentSliceKey, index: number): void {
    selectedSlice = slice;
    selectedIndex = index;
    render();
  }

  function ids(slice: ContentSliceKey): string[] {
    const out: string[] = [];
    for (const row of sliceArray(store.draft, slice)) {
      const id = entityId(row);
      if (id !== null) {
        out.push(id);
      }
    }
    return out;
  }

  function names(slice: ContentSliceKey): Map<string, string> {
    const out = new Map<string, string>();
    for (const row of sliceArray(store.draft, slice)) {
      const id = entityId(row);
      if (id !== null && typeof row === "object" && row !== null) {
        const name = (row as Row).name;
        if (typeof name === "string") {
          out.set(id, name);
        }
      }
    }
    return out;
  }

  /* ---------- Header ---------- */

  function renderHeader(): HTMLElement {
    const header = el("header", "ed-header");
    const h1 = el("h1");
    h1.append("Mastermind ", Object.assign(el("span"), { textContent: "Content Editor" }));
    header.appendChild(h1);

    const saveBtn = el("button", "ed-btn-primary", "Save to content/");
    const blocked = store.issues.length > 0;
    saveBtn.disabled = blocked || !store.dirty;
    saveBtn.title = blocked
      ? `Fix ${store.issues.length} issue(s) before saving`
      : store.dirty
        ? "Write changed slices to content/*.json"
        : "No unsaved changes";
    saveBtn.addEventListener("click", () => {
      void (async () => {
        const result = await saveSlices(store.draft);
        if (result.ok) {
          store.markSaved();
          statusOverride = `Saved ✓ (${result.written.length} file${result.written.length === 1 ? "" : "s"} written)`;
        } else {
          statusOverride = `Save rejected: ${result.error ?? `${result.issues.length} issue(s)`}`;
        }
        render();
      })();
    });
    header.appendChild(saveBtn);

    const undoBtn = el("button", "", "Undo");
    undoBtn.disabled = !store.canUndo;
    undoBtn.addEventListener("click", () => {
      statusOverride = null;
      store.undo();
    });
    header.appendChild(undoBtn);

    const reportBtn = el("button", "", "Unreferenced…");
    reportBtn.addEventListener("click", showUnreferencedReport);
    header.appendChild(reportBtn);

    const gameLink = el("button", "", "Open game ↗");
    gameLink.addEventListener("click", () => {
      window.open("/", "_blank");
    });
    header.appendChild(gameLink);

    let statusText: string;
    let statusClass = "ed-status";
    if (store.issues.length > 0) {
      statusText = `${store.issues.length} issue(s) — saving blocked`;
      statusClass += " ed-status--issues";
    } else if (store.dirty) {
      statusText = "Unsaved changes";
      statusClass += " ed-status--dirty";
    } else {
      statusText = statusOverride ?? "In sync with content/";
      statusClass += " ed-status--saved";
    }
    header.appendChild(el("span", statusClass, statusText));
    return header;
  }

  /* ---------- Sidebar ---------- */

  function renderSidebar(): HTMLElement {
    const side = el("nav", "ed-sidebar");
    for (const slice of SLICE_ORDER) {
      const btn = el(
        "button",
        `ed-slice-btn${slice === selectedSlice ? " ed-slice-btn--active" : ""}`,
      );
      btn.appendChild(el("span", "", SLICE_LABELS[slice]));
      const issueCount = store.issues.filter((i) => i.slice === slice).length;
      if (issueCount > 0) {
        btn.appendChild(el("span", "ed-badge", String(issueCount)));
      } else {
        btn.appendChild(
          el("span", "ed-badge ed-badge--count", String(sliceArray(store.draft, slice).length)),
        );
      }
      btn.addEventListener("click", () => {
        select(slice, 0);
      });
      side.appendChild(btn);
    }
    return side;
  }

  /* ---------- Entity list ---------- */

  function renderEntityList(): HTMLElement {
    const panel = el("section", "ed-entity-list");
    const head = el("div", "ed-entity-list-head");
    const newBtn = el("button", "ed-btn-small", "+ New");
    newBtn.addEventListener("click", createEntity);
    head.appendChild(newBtn);
    panel.appendChild(head);

    const rows = sliceArray(store.draft, selectedSlice);
    rows.forEach((row, i) => {
      const id = entityId(row);
      const bad = issuesForEntity(store.issues, selectedSlice, id, i).length > 0;
      const btn = el(
        "button",
        `ed-entity-row${i === selectedIndex ? " ed-entity-row--active" : ""}${bad ? " ed-entity-row--bad" : ""}`,
      );
      btn.appendChild(document.createTextNode(entityLabel(selectedSlice, row, i)));
      if (id !== null) {
        btn.appendChild(el("span", "ed-entity-id", id));
      }
      btn.addEventListener("click", () => {
        select(selectedSlice, i);
      });
      panel.appendChild(btn);
    });
    if (rows.length === 0) {
      panel.appendChild(el("p", "ed-hint", "No entries."));
    }
    return panel;
  }

  /* ---------- Detail form ---------- */

  function renderDetail(): HTMLElement {
    const panel = el("section", "ed-detail");
    const rows = sliceArray(store.draft, selectedSlice);
    const row = rows[selectedIndex];
    if (row === undefined) {
      panel.appendChild(el("p", "ed-hint", "Select or create an entry."));
      return panel;
    }
    const id = entityId(row);

    panel.appendChild(el("h2", "", entityLabel(selectedSlice, row, selectedIndex)));

    const toolbar = el("div", "ed-detail-toolbar");
    if (id !== null && RENAMABLE_SLICES.has(selectedSlice)) {
      const renameBtn = el("button", "ed-btn-small", "Rename id…");
      renameBtn.addEventListener("click", () => {
        renameEntity(id);
      });
      toolbar.appendChild(renameBtn);
    }
    const dupBtn = el("button", "ed-btn-small", "Duplicate");
    dupBtn.addEventListener("click", duplicateEntity);
    toolbar.appendChild(dupBtn);
    const delBtn = el("button", "ed-btn-small ed-btn-danger", "Delete…");
    delBtn.addEventListener("click", deleteEntity);
    toolbar.appendChild(delBtn);
    panel.appendChild(toolbar);

    const entityIssues = issuesForEntity(store.issues, selectedSlice, id, selectedIndex);
    if (entityIssues.length > 0) {
      const box = el("div", "ed-entity-issues");
      const ul = el("ul");
      for (const issue of entityIssues) {
        ul.appendChild(el("li", "", `${issue.path}: ${issue.message}`));
      }
      box.appendChild(ul);
      panel.appendChild(box);
    }

    /* organizationNames rows are plain strings — wrap them so forms always see a Row. */
    const isStringSlice = selectedSlice === "organizationNames";
    const formRowObj: Row = isStringSlice ? { value: row as string } : (row as Row);
    const index = selectedIndex;
    const slice = selectedSlice;
    const ctx: FormCtx = {
      slice,
      index,
      row: formRowObj,
      draft: store.draft,
      ids,
      names,
      update(mutate) {
        statusOverride = null;
        store.update((draft) => {
          const arr = sliceArray(draft, slice);
          if (isStringSlice) {
            const wrapped: Row = { value: arr[index] as string };
            mutate(wrapped);
            arr[index] = typeof wrapped.value === "string" ? wrapped.value : "";
          } else {
            mutate(arr[index] as Row);
          }
        });
      },
    };
    FORM_RENDERERS[selectedSlice](panel, ctx);
    return panel;
  }

  /* ---------- Issues panel ---------- */

  function renderIssues(): HTMLElement {
    const panel = el("section", "ed-issues");
    panel.appendChild(el("h3", "", `Issues (${store.issues.length})`));
    if (store.issues.length === 0) {
      panel.appendChild(el("span", "ed-issues-ok", "Draft is valid — safe to save."));
      return panel;
    }
    for (const issue of store.issues) {
      const btn = el("button", "ed-issue-row");
      const where = el(
        "span",
        "ed-issue-where",
        `[${issue.slice}] ${issue.entityId ?? "(slice)"} ${issue.path} — `,
      );
      btn.append(where, document.createTextNode(issue.message));
      btn.addEventListener("click", () => {
        const rows = sliceArray(store.draft, issue.slice);
        let index = rows.findIndex((r) => entityId(r) === issue.entityId);
        if (index === -1) {
          const m = /^\[(\d+)\]/.exec(issue.path);
          index = m !== null ? Number(m[1]) : 0;
        }
        select(issue.slice, Math.max(0, index));
      });
      panel.appendChild(btn);
    }
    return panel;
  }

  /* ---------- Entity operations ---------- */

  function createEntity(): void {
    let id = "";
    if (RENAMABLE_SLICES.has(selectedSlice)) {
      const suggestion = `new-${selectedSlice.replace(/s$/, "")}`;
      const answer = window.prompt(`New ${SLICE_LABELS[selectedSlice]} id (lowercase slug):`, suggestion);
      if (answer === null || answer.trim() === "") {
        return;
      }
      id = answer.trim();
    }
    statusOverride = null;
    store.update((draft) => {
      sliceArray(draft, selectedSlice).push(defaultRowForSlice(selectedSlice, id, draft));
    });
    select(selectedSlice, sliceArray(store.draft, selectedSlice).length - 1);
  }

  function duplicateEntity(): void {
    const rows = sliceArray(store.draft, selectedSlice);
    const row = rows[selectedIndex];
    if (row === undefined) {
      return;
    }
    statusOverride = null;
    store.update((draft) => {
      const arr = sliceArray(draft, selectedSlice);
      const clone = structuredClone(arr[selectedIndex]);
      const id = entityId(clone);
      if (id !== null) {
        (clone as Row).id = uniqueCopyId(new Set(ids(selectedSlice)), id);
      }
      arr.push(clone);
    });
    select(selectedSlice, sliceArray(store.draft, selectedSlice).length - 1);
  }

  function deleteEntity(): void {
    const rows = sliceArray(store.draft, selectedSlice);
    const row = rows[selectedIndex];
    if (row === undefined) {
      return;
    }
    const id = entityId(row);
    const label = entityLabel(selectedSlice, row, selectedIndex);

    const doDelete = (): void => {
      statusOverride = null;
      store.update((draft) => {
        sliceArray(draft, selectedSlice).splice(selectedIndex, 1);
      });
      select(selectedSlice, Math.max(0, selectedIndex - 1));
    };

    if (id !== null && store.catalog !== null) {
      const refs = referencesTo(collectContentReferences(store.catalog), selectedSlice, id);
      if (refs.length > 0) {
        const content = el("div");
        content.appendChild(
          el("p", "", `"${label}" is referenced in ${refs.length} place(s). Deleting will create dangling references (shown as issues).`),
        );
        const ul = el("ul");
        for (const r of refs) {
          ul.appendChild(el("li", "", `${r.fromSlice}:${r.fromId} — ${r.path}`));
        }
        content.appendChild(ul);
        showModal(`Delete ${label}?`, content, [
          { label: "Cancel" },
          { label: "Delete anyway", primary: true, onClick: doDelete },
        ]);
        return;
      }
    }
    const note =
      store.catalog === null
        ? " (draft has issues; usage could not be checked)"
        : " (nothing references it)";
    showModal(`Delete ${label}?`, el("p", "", `Delete this entry${note}?`), [
      { label: "Cancel" },
      { label: "Delete", primary: true, onClick: doDelete },
    ]);
  }

  function renameEntity(oldId: string): void {
    const answer = window.prompt(`Rename "${oldId}" to:`, oldId);
    if (answer === null) {
      return;
    }
    const newId = answer.trim();
    if (newId === "" || newId === oldId) {
      return;
    }
    if (ids(selectedSlice).includes(newId)) {
      window.alert(`"${newId}" already exists in ${SLICE_LABELS[selectedSlice]}.`);
      return;
    }
    statusOverride = null;
    store.replaceDraft(applyIdRenameRaw(store.draft, selectedSlice, oldId, newId));
  }

  function showUnreferencedReport(): void {
    if (store.catalog === null) {
      showModal("Unreferenced content", el("p", "", "Fix validation issues first — the reference graph needs a valid draft."), [
        { label: "Close", primary: true },
      ]);
      return;
    }
    const refs = collectContentReferences(store.catalog);
    const content = el("div");
    let any = false;
    for (const slice of ["traits", "assets", "missions", "locations", "maps"] as const) {
      const unused = unreferencedIds(store.catalog, refs, slice);
      if (unused.length === 0) {
        continue;
      }
      any = true;
      content.appendChild(el("p", "", `${SLICE_LABELS[slice]} (${unused.length}):`));
      const ul = el("ul");
      for (const id of unused) {
        ul.appendChild(el("li", "", id));
      }
      content.appendChild(ul);
    }
    if (!any) {
      content.appendChild(el("p", "", "Every trait, asset, mission, location, and map is referenced."));
    } else {
      content.appendChild(
        el("p", "ed-hint", "Unreferenced ≠ unused: some traits/missions are only rolled or offered at runtime (site security, hire pools, events)."),
      );
    }
    showModal("Unreferenced content", content, [{ label: "Close", primary: true }]);
  }

  /* ---------- Root render ---------- */

  function render(): void {
    root!.replaceChildren();
    root!.appendChild(renderHeader());
    const main = el("div", "ed-main");
    main.appendChild(renderSidebar());
    main.appendChild(renderEntityList());
    main.appendChild(renderDetail());
    root!.appendChild(main);
    root!.appendChild(renderIssues());
  }

  store.subscribe(render);
  render();
}

async function boot(): Promise<void> {
  const disk = await fetchSlices();
  let initial: RawContentSlices = disk;
  let startDirty = false;
  const persisted = loadPersistedDraft();
  if (persisted !== null && JSON.stringify(persisted) !== JSON.stringify(disk)) {
    if (window.confirm("An unsaved editor draft from a previous session was found. Restore it?")) {
      initial = persisted;
      startDirty = true;
    } else {
      clearPersistedDraft();
    }
  }
  initEditor(createStore(initial, { startDirty }));
}

void boot().catch((e: unknown) => {
  const root = document.getElementById("editor-root");
  if (root !== null) {
    root.textContent = `Failed to start editor: ${String(e)}. Is this the Vite dev server?`;
  }
});

/* Sanity: every slice key has a renderer and a label (compile-time via Records; runtime no-op). */
void CONTENT_SLICE_KEYS;
