import { artFieldRow } from "../artField";
import { AGENT_ABILITY_DEFS } from "../../game/agentAbility";
import type { FormCtx } from "./context";
import {
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

const BOND_KINDS = ["friend", "ally", "rival", "hatred"] as const;

/** Label + one-line brief for each agent movement behavior, in schema order. */
const MOVEMENT_BEHAVIOR_OPTIONS: { value: string; label: string; brief: string }[] = [
  {
    value: "defender",
    label: "Defender",
    brief: "Guards sites holding an asset the current Omega phase's missions call for.",
  },
  {
    value: "investigator",
    label: "Investigator",
    brief: "Heads for the site of the player's most recent failed mission.",
  },
  {
    value: "hunter",
    label: "Hunter",
    brief:
      "Locks onto one minion and follows it to whatever job it is working; holds position between jobs.",
  },
  {
    value: "analyst",
    label: "Analyst",
    brief: "Heads for the site the player has the most intel on; sits still while every site is dark.",
  },
  {
    value: "asset_protector",
    label: "Asset Protector",
    brief: "Heads for sites with at least one revealed asset slot.",
  },
  {
    value: "opportunist",
    label: "Opportunist",
    brief: "Heads for the softest sites — lowest security on the map.",
  },
];
const LOCATION_KINDS = ["hero", "wanted"] as const;

function isBondKind(kind: string): boolean {
  return (BOND_KINDS as readonly string[]).includes(kind);
}

function dynamicTraitRowEditor(
  dt: Row,
  replace: (v: Row) => void,
  ctx: FormCtx,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.gap = "4px";
  wrap.style.flex = "1";

  const kind = str(dt, "kind");
  const kindSelect = selectInput(
    [...BOND_KINDS, ...LOCATION_KINDS].map((k) => ({ value: k, label: k })),
    kind,
    (nextKind) => {
      if (isBondKind(nextKind)) {
        replace({
          kind: nextKind,
          targetMinionTemplateId: str(dt, "targetMinionTemplateId") || (firstOtherMinionId() ?? ""),
        });
      } else {
        replace({ kind: nextKind, locationId: str(dt, "locationId") || (ctx.ids("locations")[0] ?? "") });
      }
    },
  );
  wrap.appendChild(kindSelect);

  function firstOtherMinionId(): string | undefined {
    return ctx.ids("minions").find((id) => !(ctx.slice === "minions" && id === str(ctx.row, "id")));
  }

  if (isBondKind(kind)) {
    const minionIds = ctx.ids("minions").filter(
      (id) => !(ctx.slice === "minions" && id === str(ctx.row, "id")),
    );
    wrap.appendChild(
      selectInput(idOptions(minionIds, ctx.names("minions")), str(dt, "targetMinionTemplateId"), (v) => {
        replace({ kind, targetMinionTemplateId: v });
      }),
    );
  } else {
    wrap.appendChild(
      selectInput(idOptions(ctx.ids("locations"), ctx.names("locations")), str(dt, "locationId"), (v) => {
        replace({ kind, locationId: v });
      }),
    );
  }
  return wrap;
}

/** Shared form for minions and agents (identical JSON shape). */
export function renderMinionForm(container: HTMLElement, ctx: FormCtx): void {
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
      suggestedName: `${ctx.slice === "agents" ? "agent" : "minion"}-${str(ctx.row, "id")}`,
    }),
  );
  container.appendChild(
    formRow(
      "hireCommandPoints",
      numberInput(
        typeof ctx.row.hireCommandPoints === "number" ? ctx.row.hireCommandPoints : 0,
        (v) =>
          ctx.update((row) => {
            row.hireCommandPoints = v;
          }),
        { min: 0 },
      ),
    ),
  );

  const startingLevelInput = textInput(
    typeof ctx.row.startingLevel === "number" ? String(ctx.row.startingLevel) : "",
    (v) =>
      ctx.update((row) => {
        const n = Number(v);
        setOrDelete(row, "startingLevel", v === "" || !Number.isFinite(n) ? "" : n, true);
      }),
    "empty = 1",
  );
  container.appendChild(formRow("startingLevel", startingLevelInput));

  const traitIds = ctx.ids("traits");
  const traitNames = ctx.names("traits");

  container.appendChild(
    fieldset(
      "startingTraitIds",
      listEditor(
        strArray(ctx.row, "startingTraitIds"),
        (next) =>
          ctx.update((row) => {
            setOrDelete(row, "startingTraitIds", next, true);
          }),
        (item, replace) => selectInput(idOptions(traitIds, traitNames), item, replace),
        () => traitIds[0] ?? null,
      ),
    ),
  );

  if (ctx.slice === "agents") {
    const behavior = str(ctx.row, "movementBehavior");
    const behaviorSelect = selectInput(
      [
        { value: "", label: "— pick one —" },
        ...MOVEMENT_BEHAVIOR_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
      ],
      behavior,
      (v) =>
        ctx.update((row) => {
          setOrDelete(row, "movementBehavior", v, true);
        }),
    );
    const behaviorRow = formRow("movementBehavior", behaviorSelect);
    behaviorRow.appendChild(
      hint(
        MOVEMENT_BEHAVIOR_OPTIONS.find((o) => o.value === behavior)?.brief ??
          "Every agent moves once at the end of each turn, after missions resolve. Pick what it chases.",
      ),
    );
    container.appendChild(behaviorRow);

    container.appendChild(
      fieldset(
        "abilityIds (priority order — the first usable active fires)",
        listEditor(
          strArray(ctx.row, "abilityIds"),
          (next) =>
            ctx.update((row) => {
              setOrDelete(row, "abilityIds", next, true);
            }),
          (item, replace) =>
            selectInput(
              AGENT_ABILITY_DEFS.map((d) => ({
                value: d.id,
                label: `${d.name} (${d.kind})`,
              })),
              item,
              replace,
            ),
          () => AGENT_ABILITY_DEFS[0]?.id ?? null,
        ),
        hint(
          AGENT_ABILITY_DEFS.map((d) => `${d.name} — ${d.description}`).join(" "),
        ),
      ),
    );

    container.appendChild(
      fieldset(
        "challengeTraitIds (added to every mission at this agent's site)",
        listEditor(
          strArray(ctx.row, "challengeTraitIds"),
          (next) =>
            ctx.update((row) => {
              row.challengeTraitIds = next;
            }),
          (item, replace) => selectInput(idOptions(traitIds, traitNames), item, replace),
          () => traitIds[0] ?? null,
        ),
        hint(
          "Each DISTINCT challenge trait at the site costs a flat penalty (balance: Challenge trait penalty %) unless someone on the crew has the matching trait. These sit outside the required-trait ratio, so matching one never raises the base chance — it only avoids the hit. Agents need at least one.",
        ),
      ),
    );
  }

  container.appendChild(
    fieldset(
      "levelUpTraitOrder (granted in order on level-up)",
      listEditor(
        strArray(ctx.row, "levelUpTraitOrder"),
        (next) =>
          ctx.update((row) => {
            row.levelUpTraitOrder = next;
          }),
        (item, replace) => selectInput(idOptions(traitIds, traitNames), item, replace),
        () => traitIds[0] ?? null,
      ),
    ),
  );

  const dynFs = fieldset(
    "startingDynamicTraits (relationships / hero / wanted)",
    listEditor(
      rowArray(ctx.row, "startingDynamicTraits"),
      (next) =>
        ctx.update((row) => {
          setOrDelete(row, "startingDynamicTraits", next, true);
        }),
      (item, replace) => dynamicTraitRowEditor(item, replace, ctx),
      () => {
        const target = ctx
          .ids("minions")
          .find((id) => !(ctx.slice === "minions" && id === str(ctx.row, "id")));
        return target !== undefined ? { kind: "friend", targetMinionTemplateId: target } : null;
      },
    ),
    hint(
      "Bonds seed the pair's hidden affinity score at that relationship's threshold once both minions are on the roster — the pair takes it from there. Friend / Ally / Rival / Hatred apply once per pair when both share a mission; Hero / Wanted apply per minion at the linked location.",
    ),
  );
  container.appendChild(dynFs);
}
