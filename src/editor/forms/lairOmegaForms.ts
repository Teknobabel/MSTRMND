import { artFieldRow } from "../artField";
import type { FormCtx } from "./context";
import {
  el,
  fieldset,
  formRow,
  hint,
  idOptions,
  listEditor,
  numberInput,
  selectInput,
  setOrDelete,
  str,
  strArray,
  rowArray,
  textArea,
  textInput,
  type Row,
} from "../widgets";

export function renderLairForm(container: HTMLElement, ctx: FormCtx): void {
  const idInput = textInput(str(ctx.row, "id"), () => undefined);
  idInput.readOnly = true;
  idInput.title = "Use the Rename button to change ids (updates all references)";
  container.appendChild(formRow("id", idInput));
  container.appendChild(
    formRow(
      "name",
      textInput(str(ctx.row, "name"), (v) =>
        ctx.update((row) => {
          row.name = v;
        }),
      ),
    ),
  );
  container.appendChild(
    formRow(
      "description",
      textArea(str(ctx.row, "description"), (v) =>
        ctx.update((row) => {
          setOrDelete(row, "description", v, true);
        }),
      ),
    ),
  );
  container.appendChild(
    artFieldRow(ctx, "cardArt", {
      optional: true,
      suggestedName: `lair-${str(ctx.row, "id")}`,
    }),
  );

  const missionIds = ctx.ids("missions");
  const missionNames = ctx.names("missions");
  container.appendChild(
    fieldset(
      "availableMissionIds (Lair → Missions tab)",
      listEditor(
        strArray(ctx.row, "availableMissionIds"),
        (next) =>
          ctx.update((row) => {
            row.availableMissionIds = next;
          }),
        (item, replace) => selectInput(idOptions(missionIds, missionNames), item, replace),
        () => missionIds[0] ?? null,
      ),
    ),
  );
  container.appendChild(
    fieldset(
      "upgradeMissionIds (one-time upgrades; disjoint from available)",
      listEditor(
        strArray(ctx.row, "upgradeMissionIds"),
        (next) =>
          ctx.update((row) => {
            setOrDelete(row, "upgradeMissionIds", next, true);
          }),
        (item, replace) => selectInput(idOptions(missionIds, missionNames), item, replace),
        () => missionIds[0] ?? null,
      ),
    ),
  );

  /* startingAssets: Record<assetId, qty> edited as rows. */
  const startingAssets = ctx.row.startingAssets;
  const entries: [string, number][] =
    startingAssets !== null && typeof startingAssets === "object" && !Array.isArray(startingAssets)
      ? Object.entries(startingAssets as Record<string, unknown>).map(([k, v]) => [
          k,
          typeof v === "number" ? v : 1,
        ])
      : [];
  const assetIds = ctx.ids("assets");
  container.appendChild(
    fieldset(
      "startingAssets (granted at run start)",
      listEditor<[string, number]>(
        entries,
        (next) =>
          ctx.update((row) => {
            const record: Record<string, number> = {};
            for (const [aid, qty] of next) {
              record[aid] = (record[aid] ?? 0) + qty;
            }
            setOrDelete(row, "startingAssets", record, true);
          }),
        (item, replace) => {
          const wrap = el("div");
          wrap.style.display = "flex";
          wrap.style.gap = "4px";
          wrap.style.flex = "1";
          wrap.appendChild(
            selectInput(idOptions(assetIds, ctx.names("assets")), item[0], (v) => {
              replace([v, item[1]]);
            }),
          );
          wrap.appendChild(
            numberInput(item[1], (v) => replace([item[0], Math.max(1, Math.floor(v))]), { min: 1 }),
          );
          return wrap;
        },
        () => (assetIds[0] !== undefined ? [assetIds[0], 1] : null),
      ),
      hint("Duplicate asset rows merge their quantities on commit."),
    ),
  );
}

export function renderOmegaPlanForm(container: HTMLElement, ctx: FormCtx): void {
  const idInput = textInput(str(ctx.row, "id"), () => undefined);
  idInput.readOnly = true;
  idInput.title = "Use the Rename button to change ids (updates all references)";
  container.appendChild(formRow("id", idInput));
  container.appendChild(
    formRow(
      "name",
      textInput(str(ctx.row, "name"), (v) =>
        ctx.update((row) => {
          row.name = v;
        }),
      ),
    ),
  );
  container.appendChild(
    formRow(
      "description",
      textArea(str(ctx.row, "description"), (v) =>
        ctx.update((row) => {
          row.description = v;
        }),
      ),
    ),
  );
  container.appendChild(
    artFieldRow(ctx, "cardArt", {
      optional: true,
      suggestedName: `omega-${str(ctx.row, "id")}`,
    }),
  );
  container.appendChild(
    formRow(
      "mapId",
      selectInput(idOptions(ctx.ids("maps"), ctx.names("maps")), str(ctx.row, "mapId"), (v) =>
        ctx.update((row) => {
          row.mapId = v;
        }),
      ),
    ),
  );

  const stages = rowArray(ctx.row, "stages");
  const missionIds = ctx.ids("missions");
  const missionNames = ctx.names("missions");
  const grid = el("div", "ed-omega-grid");
  for (let si = 0; si < stages.length; si += 1) {
    grid.appendChild(el("div", "ed-omega-stage-label", `Stage ${si + 1}`));
    const ids = strArray(stages[si]!, "missionIds");
    for (let mi = 0; mi < Math.max(3, ids.length); mi += 1) {
      grid.appendChild(
        selectInput(idOptions(missionIds, missionNames), ids[mi] ?? "", (v) =>
          ctx.update((row) => {
            const rowStages = rowArray(row, "stages");
            const stage = rowStages[si];
            if (stage === undefined) {
              return;
            }
            const next = [...strArray(stage, "missionIds")];
            while (next.length < 3) {
              next.push(v);
            }
            next[mi] = v;
            (stage as Row).missionIds = next;
            row.stages = rowStages;
          }),
        ),
      );
    }
  }
  container.appendChild(fieldset("Stages (3 × 3 mission grid; same mission may repeat)", grid));
  if (stages.length !== 3) {
    container.appendChild(
      hint("An omega plan must have exactly 3 stages of 3 missions — fix via issues panel if malformed."),
    );
  }
}
