import { effectKindTargetTypeRequirement } from "../../game/contentSchema";
import { orderedMissionEffects } from "../../game/missionEffects";
import type { MissionEffect, MissionTargetType } from "../../game/types";
import type { FormCtx } from "./context";
import {
  el,
  fieldset,
  idOptions,
  numberInput,
  selectInput,
  listEditor,
  str,
  strArray,
  num,
  type Row,
} from "../widgets";

type EffectKind = MissionEffect["kind"];

type FieldDef =
  | { key: string; input: "int"; min: number; max: number; def: number }
  | { key: string; input: "traitId" }
  | { key: string; input: "traitIds" }
  | { key: string; input: "assetIds" }
  | { key: string; input: "missionId" }
  | { key: string; input: "locationType" }
  | { key: string; input: "locationLevel" };

const DELTA: FieldDef = { key: "delta", input: "int", min: -50, max: 50, def: 1 };
const COUNT: FieldDef = { key: "count", input: "int", min: 0, max: 99, def: 1 };

/** Field layout per effect kind (mirrors `missionEffectSchema`). */
const EFFECT_FIELD_DEFS: Record<EffectKind, FieldDef[]> = {
  reveal_target_asset: [],
  reveal_all_hidden_assets_at_location: [],
  steal_target_asset: [],
  steal_all_assets_at_location: [],
  steal_all_revealed_assets_at_location: [],
  unlock_lair_mission: [{ key: "missionId", input: "missionId" }],
  gain_assets: [{ key: "assetIds", input: "assetIds" }],
  exchange_assets: [
    { key: "removeAssetIds", input: "assetIds" },
    { key: "gainAssetIds", input: "assetIds" },
  ],
  security_level_delta: [DELTA],
  add_target_minion_traits: [{ key: "traitIds", input: "traitIds" }],
  add_random_participant_traits: [{ key: "traitIds", input: "traitIds" }],
  add_all_participant_traits: [{ key: "traitIds", input: "traitIds" }],
  infamy_delta: [{ key: "amount", input: "int", min: -100, max: 100, def: 5 }],
  max_concurrent_missions_delta: [DELTA],
  max_roster_size_delta: [DELTA],
  max_hire_offers_delta: [DELTA],
  max_participants_per_mission_delta: [DELTA],
  max_command_points_per_turn_delta: [DELTA],
  security_level_delta_global: [DELTA],
  security_level_delta_by_location_type: [DELTA, { key: "locationType", input: "locationType" }],
  security_level_delta_by_location_level: [DELTA, { key: "locationLevel", input: "locationLevel" }],
  remove_trait_from_all_minions: [{ key: "traitId", input: "traitId" }],
  add_trait_to_random_minions: [
    { key: "traitId", input: "traitId" },
    { key: "count", input: "int", min: 1, max: 99, def: 1 },
  ],
  reveal_hidden_assets_global: [COUNT],
  reveal_hidden_assets_by_location_type: [COUNT, { key: "locationType", input: "locationType" }],
  reveal_hidden_assets_by_location_level: [COUNT, { key: "locationLevel", input: "locationLevel" }],
  grant_command_points_next_turn: [{ key: "amount", input: "int", min: 1, max: 99, def: 1 }],
  add_success_chance_modifier: [
    { key: "delta", input: "int", min: -100, max: 100, def: 10 },
    { key: "turns", input: "int", min: 1, max: 99, def: 1 },
  ],
};

const ALL_EFFECT_KINDS = Object.keys(EFFECT_FIELD_DEFS) as EffectKind[];

function defaultEffectForKind(kind: EffectKind, ctx: FormCtx): Row {
  const eff: Row = { kind };
  for (const def of EFFECT_FIELD_DEFS[kind]) {
    switch (def.input) {
      case "int":
        eff[def.key] = def.def;
        break;
      case "traitId":
        eff[def.key] = ctx.ids("traits")[0] ?? "";
        break;
      case "traitIds":
        eff[def.key] = [];
        break;
      case "assetIds":
        eff[def.key] = [];
        break;
      case "missionId":
        eff[def.key] = ctx.ids("missions")[0] ?? "";
        break;
      case "locationType":
        eff[def.key] = "economic";
        break;
      case "locationLevel":
        eff[def.key] = 1;
        break;
    }
  }
  return eff;
}

function fieldEditor(def: FieldDef, eff: Row, replace: (next: Row) => void, ctx: FormCtx): HTMLElement {
  const label = el("label", "", `${def.key}:`);
  const set = (value: unknown): void => {
    replace({ ...eff, [def.key]: value });
  };
  switch (def.input) {
    case "int":
      label.appendChild(numberInput(num(eff, def.key, def.def), set, { min: def.min, max: def.max }));
      break;
    case "traitId":
      label.appendChild(
        selectInput(idOptions(ctx.ids("traits"), ctx.names("traits")), str(eff, def.key), set),
      );
      break;
    case "traitIds": {
      const holder = el("div");
      holder.style.minWidth = "220px";
      holder.appendChild(
        listEditor(
          strArray(eff, def.key),
          (next) => set(next),
          (item, replaceItem) =>
            selectInput(idOptions(ctx.ids("traits"), ctx.names("traits")), item, replaceItem),
          () => ctx.ids("traits")[0] ?? null,
        ),
      );
      label.appendChild(holder);
      break;
    }
    case "assetIds": {
      const holder = el("div");
      holder.style.minWidth = "220px";
      holder.appendChild(
        listEditor(
          strArray(eff, def.key),
          (next) => set(next),
          (item, replaceItem) =>
            selectInput(idOptions(ctx.ids("assets"), ctx.names("assets")), item, replaceItem),
          () => ctx.ids("assets")[0] ?? null,
        ),
      );
      label.appendChild(holder);
      break;
    }
    case "missionId":
      label.appendChild(
        selectInput(idOptions(ctx.ids("missions"), ctx.names("missions")), str(eff, def.key), set),
      );
      break;
    case "locationType":
      label.appendChild(
        selectInput(
          ["economic", "political", "military"].map((v) => ({ value: v, label: v })),
          str(eff, def.key),
          set,
        ),
      );
      break;
    case "locationLevel":
      label.appendChild(
        selectInput(
          ["1", "2", "3"].map((v) => ({ value: v, label: v })),
          String(num(eff, def.key, 1)),
          (v) => set(Number(v)),
        ),
      );
      break;
  }
  return label;
}

function effectRowEditor(
  eff: Row,
  replace: (next: Row) => void,
  ctx: FormCtx,
  targetType: MissionTargetType,
): HTMLElement {
  const box = el("div", "ed-effect");
  box.style.flex = "1";
  const head = el("div", "ed-effect-head");
  const kind = str(eff, "kind") as EffectKind;

  const kindOptions = ALL_EFFECT_KINDS.map((k) => {
    const requirement = effectKindTargetTypeRequirement(k, targetType);
    return {
      value: k,
      label: requirement === null ? k : `${k} — needs targetType ${requirement}`,
      disabled: requirement !== null,
    };
  });
  head.appendChild(
    selectInput(kindOptions, kind, (nextKind) => {
      replace(defaultEffectForKind(nextKind as EffectKind, ctx));
    }),
  );
  box.appendChild(head);

  const defs = EFFECT_FIELD_DEFS[kind] ?? [];
  if (defs.length > 0) {
    const fields = el("div", "ed-effect-fields");
    for (const def of defs) {
      fields.appendChild(fieldEditor(def, eff, replace, ctx));
    }
    box.appendChild(fields);
  }
  return box;
}

/** One effects list (onSuccessEffects / onFailureEffects / expireEffects). */
export function effectsListFieldset(
  legend: string,
  key: "onSuccessEffects" | "onFailureEffects" | "expireEffects",
  ctx: FormCtx,
): HTMLElement {
  const targetType = (str(ctx.row, "targetType") || "none") as MissionTargetType;
  const effects = ctx.row[key];
  const rows: Row[] = Array.isArray(effects)
    ? effects.filter((e): e is Row => e !== null && typeof e === "object")
    : [];

  const editor = listEditor(
    rows,
    (next) =>
      ctx.update((row) => {
        if (next.length === 0) {
          delete row[key];
        } else {
          row[key] = next;
        }
      }),
    (item, replace) => effectRowEditor(item, replace, ctx, targetType),
    () => defaultEffectForKind("infamy_delta", ctx),
    "+ Add effect",
  );

  const fs = fieldset(legend, editor);
  if (rows.length > 1) {
    const ordered = orderedMissionEffects(rows as unknown as MissionEffect[]);
    fs.appendChild(
      el(
        "div",
        "ed-order-note",
        `resolution order: ${ordered.map((e) => e.kind).join(" → ")}`,
      ),
    );
  }
  return fs;
}
