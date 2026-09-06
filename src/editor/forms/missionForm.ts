import {
  eventTemplateSchema,
  minionTemplateSchema,
  missionTemplateSchema,
} from "../../game/contentSchema";
import {
  computeSuccessChanceBreakdown,
  missionTargetTypeTargetsLocation,
} from "../../game/mission";
import { createMinionFromTemplate } from "../../game/minion";
import type {
  IntelLevel,
  LocationLevel,
  LocationType,
  MinionInstance,
  MinionTemplate,
  MissionTargetType,
  MissionTemplate,
  SecurityLevel,
  Trait,
} from "../../game/types";
import { artFieldRow } from "../artField";
import type { FormCtx } from "./context";
import { effectsListFieldset } from "./effectsEditor";
import {
  bool,
  checkboxGroup,
  checkboxInput,
  el,
  fieldset,
  formRow,
  hint,
  idOptions,
  listEditor,
  numArray,
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

const LOCATION_TYPE_OPTIONS: readonly { value: LocationType; label: string }[] = [
  { value: "political", label: "Political" },
  { value: "military", label: "Military" },
  { value: "economic", label: "Economic" },
];

const LOCATION_LEVEL_OPTIONS: readonly { value: LocationLevel; label: string }[] = [
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
];

/** Per-run levels (intel, security) both run 0–3, so one option table serves both. */
const ZERO_TO_THREE_OPTIONS: readonly { value: IntelLevel & SecurityLevel; label: string }[] = [
  { value: 0, label: "0" },
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
];

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

/** Shared form for missions and events (events add a lifetime + gates; requirements may be empty). */
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
  const targetType = (str(ctx.row, "targetType") || "none") as MissionTargetType;
  const siteIds = ctx.ids("locations");
  const siteNames = ctx.names("locations");
  container.appendChild(
    fieldset(
      "targetLocationIds (pin to named sites)",
      listEditor(
        strArray(ctx.row, "targetLocationIds"),
        (next) =>
          ctx.update((row) => {
            setOrDelete(row, "targetLocationIds", next, true);
          }),
        (item, replace) => selectInput(idOptions(siteIds, siteNames), item, replace),
        () => siteIds[0] ?? null,
      ),
    ),
  );
  container.appendChild(
    formRow(
      "targetLocationTypes",
      checkboxGroup(
        LOCATION_TYPE_OPTIONS,
        strArray(ctx.row, "targetLocationTypes") as LocationType[],
        (v) =>
          ctx.update((row) => {
            setOrDelete(row, "targetLocationTypes", v, true);
          }),
      ),
    ),
  );
  container.appendChild(
    formRow(
      "targetLocationLevels",
      checkboxGroup(
        LOCATION_LEVEL_OPTIONS,
        numArray(ctx.row, "targetLocationLevels") as LocationLevel[],
        (v) =>
          ctx.update((row) => {
            setOrDelete(row, "targetLocationLevels", v, true);
          }),
      ),
    ),
  );
  container.appendChild(
    formRow(
      "targetLocationIntelLevels",
      checkboxGroup(
        ZERO_TO_THREE_OPTIONS,
        numArray(ctx.row, "targetLocationIntelLevels") as IntelLevel[],
        (v) =>
          ctx.update((row) => {
            setOrDelete(row, "targetLocationIntelLevels", v, true);
          }),
      ),
    ),
  );
  container.appendChild(
    formRow(
      "targetLocationSecurityLevels",
      checkboxGroup(
        ZERO_TO_THREE_OPTIONS,
        numArray(ctx.row, "targetLocationSecurityLevels") as SecurityLevel[],
        (v) =>
          ctx.update((row) => {
            setOrDelete(row, "targetLocationSecurityLevels", v, true);
          }),
      ),
    ),
  );
  container.appendChild(
    hint(
      missionTargetTypeTargetsLocation(targetType)
        ? "Restricts which sites this mission may be aimed at; all five rows must pass. An empty row is unrestricted. Listing sites in targetLocationIds pins the mission to exactly those places — leave it empty to let the other rows pick the site by category. Intel and security are per-run state, checked when the mission is started — a site can drift in and out of range during a run."
        : `Ignored while targetType is "${targetType}" — site filters only apply to location, asset_hidden, and asset_revealed targets.`,
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

  if (!isEvent) {
    container.appendChild(
      formRow(
        "Core Mission",
        checkboxInput(bool(ctx.row, "coreMission"), (v) =>
          ctx.update((row) => {
            setOrDelete(row, "coreMission", v ? true : undefined, true);
          }),
        ),
      ),
    );
    container.appendChild(
      hint(
        "Designer-only flag (never shown in game). Core missions start in the Lair Missions pool of every run, whatever lair the player picked.",
      ),
    );
  }

  if (isEvent) {
    container.appendChild(
      formRow(
        "lifetimeTurns",
        numberInput(num(ctx.row, "lifetimeTurns", 3), (v) =>
          ctx.update((row) => {
            row.lifetimeTurns = v;
          }),
          { min: 1 },
        ),
      ),
    );
    container.appendChild(
      hint(
        "Turns the offer stays on the table. Not started in time ⇒ onFailureEffects fire — ignoring an event costs the same as botching it.",
      ),
    );
    container.appendChild(
      formRow(
        "minInfamy (0 = no gate)",
        numberInput(num(ctx.row, "minInfamy"), (v) =>
          ctx.update((row) => {
            setOrDelete(row, "minInfamy", v > 0 ? v : undefined, true);
          }),
          { min: 0, max: 100 },
        ),
      ),
    );
    container.appendChild(
      formRow(
        "minHeat (0 = no gate)",
        numberInput(num(ctx.row, "minHeat"), (v) =>
          ctx.update((row) => {
            setOrDelete(row, "minHeat", v > 0 ? v : undefined, true);
          }),
          { min: 0, max: 100 },
        ),
      ),
    );
    container.appendChild(
      hint(
        "Draw-pool gates: the event is only offered once the player's infamy / heat reach these. Leave at 0 for events that can show up from turn one.",
      ),
    );
    container.appendChild(
      formRow(
        "special",
        selectInput(
          [
            { value: "", label: "(none — ordinary rotation)" },
            { value: "lair_raid", label: "lair_raid" },
          ],
          str(ctx.row, "special"),
          (v) =>
            ctx.update((row) => {
              setOrDelete(row, "special", v, true);
            }),
        ),
      ),
    );
    container.appendChild(
      hint(
        "lair_raid: the run-ending raid the top wanted tier spawns. Never drawn at random — it takes the first free event slot regardless of cooldown, and letting it expire or losing its mission ends the run. Only one event may claim it; the draw-pool gates above are ignored.",
      ),
    );
  }

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
  container.appendChild(
    effectsListFieldset(
      isEvent
        ? "onFailureEffects (mission failed — or the offer expired unstarted)"
        : "onFailureEffects",
      "onFailureEffects",
      ctx,
    ),
  );

  container.appendChild(fieldset("Success chance preview", renderPreview(ctx)));
}
