import { artFieldRow } from "../artField";
import { SUPPORT_ASSET_ABILITY_KINDS } from "../../game/types";
import type { SupportAssetAbilityKind } from "../../game/types";
import type { FormCtx } from "./context";
import { setTooltip } from "../../ui/tooltip";
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

/** Shared scalar rows: read-only id + name. */
function idAndName(container: HTMLElement, ctx: FormCtx): void {
  const idInput = textInput(str(ctx.row, "id"), () => undefined);
  idInput.readOnly = true;
  setTooltip(idInput, "id", "Read-only. Use the Rename button to change an id — it updates every reference to it.");
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
}

function descriptionRow(container: HTMLElement, ctx: FormCtx, optional: boolean): void {
  container.appendChild(
    formRow(
      "description",
      textArea(str(ctx.row, "description"), (v) =>
        ctx.update((row) => {
          setOrDelete(row, "description", v, optional);
        }),
      ),
    ),
  );
}

function cardArtRow(container: HTMLElement, ctx: FormCtx): void {
  container.appendChild(
    artFieldRow(ctx, "cardArt", {
      optional: true,
      suggestedName: `${ctx.slice}-${str(ctx.row, "id")}`,
    }),
  );
}

/**
 * The whole form for a `dynamic` trait row. These rows are not authored content — there is one
 * per runtime `DynamicTraitKind` and the game finds it by that kind — so id, name, and type are
 * all fixed and the icon is the only thing to edit.
 */
function renderDynamicTraitForm(container: HTMLElement, ctx: FormCtx): void {
  const idInput = textInput(str(ctx.row, "id"), () => undefined);
  idInput.readOnly = true;
  setTooltip(idInput, "id", "Fixed — this id is the runtime relationship kind this row draws.");
  container.appendChild(formRow("id", idInput));
  const nameInput = textInput(str(ctx.row, "name"), () => undefined);
  nameInput.readOnly = true;
  setTooltip(nameInput, "name", "Fixed — the pill wording comes from the relationship, not from this row.");
  container.appendChild(formRow("name", nameInput));
  container.appendChild(
    artFieldRow(ctx, "icon", {
      optional: true,
      suggestedName: `trait-${str(ctx.row, "id")}`,
    }),
  );
  container.appendChild(
    hint(
      `icon — the glyph on every pill showing this relationship (e.g. "${DYNAMIC_TRAIT_PILL_EXAMPLE[str(ctx.row, "id")] ?? "Ally of Vex"}"). Drawn at ~13px, same as any trait icon. Leave it empty and the pill keeps the generic tag glyph.`,
    ),
  );
  container.appendChild(
    hint(
      "Dynamic traits are projected from affinity scores, not authored: nobody can be given one, no mission can require one, and they are never rolled as site requirements or security. This row exists only to carry the art. Tune what each one is worth under Game Balance.",
    ),
  );
}

/** Sample pill text per kind, so the icon hint shows what the glyph will sit next to. */
const DYNAMIC_TRAIT_PILL_EXAMPLE: Record<string, string> = {
  friend: "Friend of Vex",
  ally: "Ally of Vex",
  rival: "Rival of Vex",
  hatred: "Hatred for Vex",
  hero: "Allies in Geneva",
  wanted: "Wanted in Geneva",
};

export function renderTraitForm(container: HTMLElement, ctx: FormCtx): void {
  if (str(ctx.row, "type") === "dynamic") {
    renderDynamicTraitForm(container, ctx);
    return;
  }
  idAndName(container, ctx);
  container.appendChild(
    formRow(
      "type",
      selectInput(
        [
          { value: "primary", label: "primary" },
          { value: "secondary", label: "secondary" },
          { value: "status_positive", label: "status_positive (+10% on missions)" },
          { value: "status_negative", label: "status_negative (−20% on missions)" },
        ],
        str(ctx.row, "type"),
        (v) =>
          ctx.update((row) => {
            row.type = v;
          }),
      ),
    ),
  );
  container.appendChild(
    hint("primary/secondary traits are eligible for site requirement & security rolls; status traits only modify mission success."),
  );
  container.appendChild(
    artFieldRow(ctx, "icon", {
      optional: true,
      suggestedName: `trait-${str(ctx.row, "id")}`,
    }),
  );
  container.appendChild(
    hint(
      "icon — the glyph on every pill naming this trait. Drawn at ~13px, so a simple silhouette on a transparent background reads best. Leave it empty and the trait keeps the generic tag glyph.",
    ),
  );
}

/** Player-facing gist of each support ability, for the editor picker. */
const SUPPORT_ABILITY_LABELS: Record<SupportAssetAbilityKind, string> = {
  success_chance_bonus: "success_chance_bonus — flat +% to mission success",
  prevent_security_increase: "prevent_security_increase — target site's security cannot rise",
  prevent_heat_increase: "prevent_heat_increase — the mission cannot raise heat",
  prevent_injuries: "prevent_injuries — no participant comes home injured",
  ignore_agent_challenge_traits:
    "ignore_agent_challenge_traits — opposing agents' challenge traits cost nothing",
  ignore_security_traits: "ignore_security_traits — revealed security traits are not required",
};

const NO_SUPPORT_ABILITY = "";

export function renderAssetForm(container: HTMLElement, ctx: FormCtx): void {
  idAndName(container, ctx);
  descriptionRow(container, ctx, true);
  cardArtRow(container, ctx);

  const ability = ctx.row.supportAbility as { kind?: string; percent?: number } | undefined;
  const currentKind = typeof ability?.kind === "string" ? ability.kind : NO_SUPPORT_ABILITY;
  container.appendChild(
    formRow(
      "supportAbility",
      selectInput(
        [
          { value: NO_SUPPORT_ABILITY, label: "(none — not a support asset)" },
          ...SUPPORT_ASSET_ABILITY_KINDS.map((k) => ({ value: k, label: SUPPORT_ABILITY_LABELS[k] })),
        ],
        currentKind,
        (v) =>
          ctx.update((row) => {
            if (v === NO_SUPPORT_ABILITY) {
              delete row.supportAbility;
            } else if (v === "success_chance_bonus") {
              row.supportAbility = { kind: v, percent: ability?.percent ?? 10 };
            } else {
              row.supportAbility = { kind: v };
            }
          }),
      ),
    ),
  );
  if (currentKind === "success_chance_bonus") {
    container.appendChild(
      formRow(
        "supportAbility.percent",
        numberInput(
          ability?.percent ?? 10,
          (v) =>
            ctx.update((row) => {
              row.supportAbility = { kind: "success_chance_bonus", percent: v };
            }),
          { min: -100, max: 100 },
        ),
      ),
    );
  }
  container.appendChild(
    hint(
      "An asset with a support ability can ride along in a mission's support slots (spent on assign, like a required asset). Assets without one are inert cargo — still stealable, still usable as requiredAssetIds.",
    ),
  );
}

export function renderLocationForm(container: HTMLElement, ctx: FormCtx): void {
  idAndName(container, ctx);
  descriptionRow(container, ctx, false);
  cardArtRow(container, ctx);
  container.appendChild(
    formRow(
      "locationType",
      selectInput(
        [
          { value: "economic", label: "economic" },
          { value: "political", label: "political" },
          { value: "military", label: "military" },
        ],
        str(ctx.row, "locationType"),
        (v) =>
          ctx.update((row) => {
            row.locationType = v;
          }),
      ),
    ),
  );
  container.appendChild(
    formRow(
      "locationLevel",
      selectInput(
        [
          { value: "1", label: "1 — no site traits, security cap 1" },
          { value: "2", label: "2 — 1 site trait, security cap 2" },
          { value: "3", label: "3 — 2 site traits, security cap 3" },
        ],
        String(num(ctx.row, "locationLevel", 1)),
        (v) =>
          ctx.update((row) => {
            row.locationLevel = Number(v);
          }),
      ),
    ),
  );
}

export function renderMapForm(container: HTMLElement, ctx: FormCtx): void {
  idAndName(container, ctx);
  descriptionRow(container, ctx, false);
  const locationIds = ctx.ids("locations");
  const names = ctx.names("locations");
  container.appendChild(
    fieldset(
      "locationIds (playable sites, in order)",
      listEditor(
        strArray(ctx.row, "locationIds"),
        (next) =>
          ctx.update((row) => {
            row.locationIds = next;
          }),
        (item, replace) => selectInput(idOptions(locationIds, names), item, replace),
        () => locationIds[0] ?? null,
      ),
    ),
  );
}

export function renderOrganizationNameForm(container: HTMLElement, ctx: FormCtx): void {
  /* organizationNames rows are plain strings; main.ts wraps the string as { value }. */
  container.appendChild(
    formRow(
      "name",
      textInput(str(ctx.row, "value"), (v) =>
        ctx.update((row) => {
          row.value = v;
        }),
      ),
    ),
  );
}

export function renderPlayerProfileForm(container: HTMLElement, ctx: FormCtx): void {
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
    artFieldRow(ctx, "profilePic", {
      optional: false,
      suggestedName: `profile-${str(ctx.row, "name")}`,
    }),
  );
}

export function renderWantedLevelForm(container: HTMLElement, ctx: FormCtx): void {
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
      "minHeat",
      numberInput(
        num(ctx.row, "minHeat"),
        (v) =>
          ctx.update((row) => {
            row.minHeat = v;
          }),
        { min: 0, max: 100 },
      ),
    ),
  );
  container.appendChild(
    formRow(
      "maxAgents",
      numberInput(
        num(ctx.row, "maxAgents"),
        (v) =>
          ctx.update((row) => {
            row.maxAgents = v;
          }),
        { min: 0 },
      ),
    ),
  );
  container.appendChild(
    formRow(
      "heatGainPerTurn",
      numberInput(
        num(ctx.row, "heatGainPerTurn"),
        (v) =>
          ctx.update((row) => {
            row.heatGainPerTurn = v;
          }),
        { min: 0 },
      ),
    ),
  );
  container.appendChild(
    hint(
      "Tiers are ordered: minHeat must be strictly ascending (first tier 0), maxAgents non-decreasing, and heatGainPerTurn non-decreasing.",
    ),
  );
  container.appendChild(el("div"));
}
