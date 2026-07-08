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

const BOND_KINDS = ["friend", "lover", "rival", "hatred"] as const;
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
    formRow(
      "cardArt",
      textInput(
        str(ctx.row, "cardArt"),
        (v) =>
          ctx.update((row) => {
            setOrDelete(row, "cardArt", v, true);
          }),
        "(optional)",
      ),
    ),
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
      "Friend +5% / Lover +10% / Rival −5% / Hatred −10% when the linked minion shares the mission; Hero +5% / Wanted −5% at the linked location.",
    ),
  );
  container.appendChild(dynFs);
}
