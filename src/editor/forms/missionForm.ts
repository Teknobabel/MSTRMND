import {
  eventTemplateSchema,
  minionTemplateSchema,
  missionTemplateSchema,
} from "../../game/contentSchema";
import { computeSuccessChanceBreakdown } from "../../game/mission";
import { createMinionFromTemplate } from "../../game/minion";
import type { MinionInstance, MinionTemplate, MissionTemplate, Trait } from "../../game/types";
import { artFieldRow } from "../artField";
import type { FormCtx } from "./context";
import { effectsListFieldset } from "./effectsEditor";
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
  num,
  textArea,
  textInput,
} from "../widgets";

const TARGET_TYPES = ["location", "asset_hidden", "asset_revealed", "minion", "none"] as const;

/** Preview participant picks; module-level so they survive re-renders. */
const previewTemplateIds: (string | null)[] = [null, null, null];
let previewAssumeAssets = true;

function tryParseTraits(ctx: FormCtx): Trait[] | null {
  const parsed = ctx.draft.traits;
  if (!Array.isArray(parsed)) {
    return null;
  }
  const out: Trait[] = [];
  for (const t of parsed) {
    const r = t as Record<string, unknown>;
    if (typeof r?.id === "string" && typeof r.name === "string" && typeof r.type === "string") {
      out.push(r as unknown as Trait);
    }
  }
  return out;
}

function renderPreview(ctx: FormCtx): HTMLElement {
  const schema = ctx.slice === "events" ? eventTemplateSchema : missionTemplateSchema;
  const parsedMission = schema.safeParse(ctx.row);
  const body = el("div");

  const minionIds = ctx.ids("minions");
  const minionNames = ctx.names("minions");
  const pickerRow = el("div", "ed-list-row");
  for (let i = 0; i < 3; i += 1) {
    pickerRow.appendChild(
      selectInput(
        [{ value: "", label: `(participant ${i + 1})` }, ...idOptions(minionIds, minionNames)],
        previewTemplateIds[i] ?? "",
        (v) => {
          previewTemplateIds[i] = v === "" ? null : v;
          ctx.update(() => {
            /* no data change; trigger re-render so the preview recomputes */
          });
        },
      ),
    );
  }
  body.appendChild(pickerRow);

  const assumeLabel = el("label");
  const assume = el("input");
  assume.type = "checkbox";
  assume.checked = previewAssumeAssets;
  assume.addEventListener("change", () => {
    previewAssumeAssets = assume.checked;
    ctx.update(() => {
      /* re-render only */
    });
  });
  assumeLabel.append(assume, document.createTextNode(" assume required assets are in inventory"));
  body.appendChild(assumeLabel);

  const out = el("div", "ed-preview-result");
  if (!parsedMission.success) {
    out.textContent = "Fix this template's shape issues to preview success chance.";
    body.appendChild(out);
    return body;
  }

  const participants: MinionInstance[] = [];
  for (const tid of previewTemplateIds) {
    if (tid === null) {
      continue;
    }
    const raw = (Array.isArray(ctx.draft.minions) ? ctx.draft.minions : []).find(
      (m) => (m as Record<string, unknown>).id === tid,
    );
    const parsedMinion = minionTemplateSchema.safeParse(raw);
    if (parsedMinion.success) {
      participants.push(
        createMinionFromTemplate(
          parsedMinion.data as MinionTemplate,
          `preview-${participants.length}`,
        ),
      );
    }
  }

  const template = parsedMission.data as MissionTemplate;
  const playerAssets: Record<string, number> = {};
  if (previewAssumeAssets) {
    for (const aid of template.requiredAssetIds) {
      playerAssets[aid] = (playerAssets[aid] ?? 0) + 1;
    }
  }
  const traitsCatalog = tryParseTraits(ctx) ?? undefined;
  const b = computeSuccessChanceBreakdown(template, participants, {
    playerAssets,
    ...(traitsCatalog !== undefined ? { traitsCatalog } : {}),
  });
  const lines = [
    `participants: ${participants.length === 0 ? "(none)" : participants.map((p) => p.templateId).join(", ")}`,
    `base: ${b.basePercent}%  (traits ${b.matchedTraits}/${b.requiredTraitCount}, asset slots ${b.matchedAssets}/${b.requiredAssetSlotCount})`,
    `status modifier: ${b.statusDelta >= 0 ? "+" : ""}${b.statusDelta}%`,
    b.missingTraitIds.length > 0 ? `missing traits: ${b.missingTraitIds.join(", ")}` : "",
    `final: ${b.finalPercent}%  (site traits, dynamic bonds, events, and opposing agents apply in-game)`,
  ].filter((l) => l !== "");
  out.textContent = lines.join("\n");
  body.appendChild(out);
  return body;
}

/** Shared form for missions and events (events add expireEffects; requirements may be empty). */
export function renderMissionForm(container: HTMLElement, ctx: FormCtx): void {
  const isEvent = ctx.slice === "events";

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
      suggestedName: `${ctx.slice === "events" ? "event" : "mission"}-${str(ctx.row, "id")}`,
    }),
  );
  container.appendChild(
    formRow(
      "targetType",
      selectInput(
        TARGET_TYPES.map((t) => ({ value: t, label: t })),
        str(ctx.row, "targetType"),
        (v) =>
          ctx.update((row) => {
            row.targetType = v;
          }),
      ),
    ),
  );
  container.appendChild(
    formRow(
      "startCommandPoints",
      numberInput(num(ctx.row, "startCommandPoints"), (v) =>
        ctx.update((row) => {
          row.startCommandPoints = v;
        }),
        { min: 0 },
      ),
    ),
  );
  container.appendChild(
    formRow(
      "durationTurns",
      numberInput(num(ctx.row, "durationTurns", 1), (v) =>
        ctx.update((row) => {
          row.durationTurns = v;
        }),
        { min: 1 },
      ),
    ),
  );

  const traitIds = ctx.ids("traits");
  const traitNames = ctx.names("traits");
  container.appendChild(
    fieldset(
      "requiredTraitIds (unique)",
      listEditor(
        strArray(ctx.row, "requiredTraitIds"),
        (next) =>
          ctx.update((row) => {
            setOrDelete(row, "requiredTraitIds", next, isEvent);
          }),
        (item, replace) => selectInput(idOptions(traitIds, traitNames), item, replace),
        () => traitIds[0] ?? null,
      ),
    ),
  );
  const assetIds = ctx.ids("assets");
  container.appendChild(
    fieldset(
      "requiredAssetIds (duplicates = extra slots)",
      listEditor(
        strArray(ctx.row, "requiredAssetIds"),
        (next) =>
          ctx.update((row) => {
            setOrDelete(row, "requiredAssetIds", next, true);
          }),
        (item, replace) => selectInput(idOptions(assetIds, ctx.names("assets")), item, replace),
        () => assetIds[0] ?? null,
      ),
    ),
  );
  if (!isEvent) {
    container.appendChild(
      hint("A mission needs at least one required trait or required asset (events may have none)."),
    );
  }

  container.appendChild(effectsListFieldset("onSuccessEffects", "onSuccessEffects", ctx));
  container.appendChild(effectsListFieldset("onFailureEffects", "onFailureEffects", ctx));
  if (isEvent) {
    container.appendChild(
      effectsListFieldset("expireEffects (fires if the offer is ignored)", "expireEffects", ctx),
    );
  }

  container.appendChild(fieldset("Success chance preview", renderPreview(ctx)));
}
