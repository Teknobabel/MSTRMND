import { DEFAULT_BALANCE } from "../../game/types";
import type { DynamicTraitModifiers } from "../../game/types";
import type { FormCtx } from "./context";
import { el, fieldset, formRow, hint, numberInput, num, type Row } from "../widgets";

type ScalarKey = Exclude<keyof typeof DEFAULT_BALANCE, "dynamicTraitModifiers">;

type BalanceFieldDef = {
  key: ScalarKey;
  label: string;
  /** Plain-language explanation of how the knob shifts gameplay. */
  tooltip: string;
  min: number;
  max: number;
};

type BalanceGroup = { legend: string; fields: BalanceFieldDef[] };

const GROUPS: BalanceGroup[] = [
  {
    legend: "Mission success formula",
    fields: [
      {
        key: "statusPositiveBonus",
        label: "Positive status bonus %",
        tooltip:
          "Every positive status trait (e.g. Inspired) on the mission crew ADDS this % to success chance. Raise it to make buff traits matter more.",
        min: 0,
        max: 100,
      },
      {
        key: "statusNegativePenalty",
        label: "Negative status penalty %",
        tooltip:
          "Every negative status trait (e.g. Injured, Shaken) on the crew SUBTRACTS this % from success chance. Raise it to make injuries more punishing and healing more valuable.",
        min: 0,
        max: 100,
      },
      {
        key: "opposingAgentPenalty",
        label: "Per-agent penalty %",
        tooltip:
          "Each enemy agent at the mission's target location subtracts this % from success chance — including HIDDEN agents the player can't see yet. Raise it to make agent-occupied sites genuinely scary.",
        min: 0,
        max: 100,
      },
      {
        key: "dynamicTraitRollPercent",
        label: "Relationship roll %",
        tooltip:
          "After every resolved mission, each participant has this % chance to form or deepen a relationship: Friend/Rival with a teammate, Hero/Wanted at the mission's location. Raise it for a more dramatic, soap-opera roster.",
        min: 0,
        max: 100,
      },
    ],
  },
  {
    legend: "Infamy & risk",
    fields: [
      {
        key: "infamySuccessDelta",
        label: "Infamy on success",
        tooltip:
          "Infamy change when a mission SUCCEEDS. Keep it negative so clean operations lower the heat; set it to 0 (or positive) to make every action raise the organization's profile.",
        min: -100,
        max: 100,
      },
      {
        key: "infamyFailureDelta",
        label: "Infamy on failure",
        tooltip:
          "Infamy gained when a mission FAILS. Higher values escalate the wanted level faster, which spawns opposing agents sooner. The wanted level never goes back down.",
        min: -100,
        max: 100,
      },
      {
        key: "injuryChancePerAgentPercent",
        label: "Injury chance per agent %",
        tooltip:
          "When a mission fails at a location with enemy agents, every participant rolls this % PER AGENT to gain the Injured trait (which then applies the negative status penalty). Higher = failed missions cripple the roster.",
        min: 0,
        max: 100,
      },
    ],
  },
  {
    legend: "Turn economy",
    fields: [
      {
        key: "startingMaxCommandPoints",
        label: "Command points per turn",
        tooltip:
          "The action budget refilled at the start of every turn — hiring, launching missions, and rerolls all spend CP. Raise it to let the player do more each turn; lower it to force hard choices.",
        min: 1,
        max: 99,
      },
      {
        key: "rerollHireOffersCp",
        label: "Hire reroll cost (CP)",
        tooltip:
          "CP cost to redraw the hire offers during the Main Phase. Set to 0 to make fishing for the perfect recruit free.",
        min: 0,
        max: 99,
      },
    ],
  },
  {
    legend: "Roster & missions",
    fields: [
      {
        key: "startingMaxRosterSize",
        label: "Starting roster cap",
        tooltip:
          "How many minions the player can employ at once at the start of a run. Mission effects can raise it during play.",
        min: 1,
        max: 99,
      },
      {
        key: "startingMaxHireOffers",
        label: "Hire offers per turn",
        tooltip: "How many recruitment candidates are offered after each resolve.",
        min: 1,
        max: 99,
      },
      {
        key: "startingMaxConcurrentMissions",
        label: "Starting concurrent missions",
        tooltip:
          "How many missions may be in flight at once at the start of a run. The main throttle on how fast the player can progress the Omega Plan.",
        min: 1,
        max: 99,
      },
      {
        key: "startingMaxParticipantsPerMission",
        label: "Starting crew size cap",
        tooltip:
          "How many minions can be sent on one lair/omega mission at the start of a run. Bigger crews match more required traits but risk more people on a failure.",
        min: 1,
        max: 12,
      },
      {
        key: "eventMaxParticipants",
        label: "Event crew size cap",
        tooltip:
          "Fixed participant cap for event missions — events ignore the player's normal crew cap entirely.",
        min: 1,
        max: 12,
      },
      {
        key: "fireRehireCooldownTurns",
        label: "Rehire cooldown (turns)",
        tooltip:
          "Turns a fired minion sits out before reappearing in the hire pool (keeping their level, XP, and traits). 0 lets the player churn the roster freely.",
        min: 0,
        max: 99,
      },
    ],
  },
  {
    legend: "Minion progression",
    fields: [
      {
        key: "minionXpPerMission",
        label: "XP per mission",
        tooltip:
          "XP each participant earns when their mission resolves — success or failure. 0 turns leveling off entirely.",
        min: 0,
        max: 99,
      },
      {
        key: "minionXpToLevel",
        label: "XP to level up",
        tooltip:
          "Total XP needed to gain a level (XP then resets to 0). Each level grants the next trait in the minion's level-up order. Lower = faster power growth.",
        min: 1,
        max: 99,
      },
    ],
  },
  {
    legend: "World generation & security",
    fields: [
      {
        key: "assetsPerLocationMin",
        label: "Assets per location (min)",
        tooltip:
          "Fewest hidden assets rolled onto each map location at the start of a run. Must be ≤ the max below.",
        min: 0,
        max: 10,
      },
      {
        key: "assetsPerLocationMax",
        label: "Assets per location (max)",
        tooltip: "Most hidden assets rolled onto each map location at the start of a run.",
        min: 0,
        max: 10,
      },
      {
        key: "initialRevealedAssetSlots",
        label: "Starting revealed assets",
        tooltip:
          "How many asset slots across the WHOLE map start revealed instead of hidden, giving the player their opening targets.",
        min: 0,
        max: 99,
      },
      {
        key: "securityGainPerResolvedMission",
        label: "Security gain per mission",
        tooltip:
          "Security added to a location each time a mission resolves there (capped by the location's level). Rising security reveals security traits that add extra requirements to later missions at that site. 0 disables heat buildup entirely.",
        min: 0,
        max: 3,
      },
    ],
  },
];

const DYNAMIC_MODIFIER_TOOLTIPS: Record<keyof DynamicTraitModifiers, string> = {
  friend: "Success bonus when a minion's Friend is on the same mission.",
  lover: "Success bonus when a minion's Lover is on the same mission (upgraded from Friend).",
  rival: "Success penalty when a minion's Rival is on the same mission.",
  hatred: "Success penalty when a minion's Hated rival is on the same mission (upgraded from Rival).",
  hero: "Success bonus when the minion is a Hero of the mission's target location.",
  wanted: "Success penalty when the minion is Wanted at the mission's target location.",
};

function scalar(row: Row, key: ScalarKey): number {
  return num(row, key, DEFAULT_BALANCE[key]);
}

function formulaStrip(row: Row): HTMLElement {
  const pos = scalar(row, "statusPositiveBonus");
  const neg = scalar(row, "statusNegativePenalty");
  const agent = scalar(row, "opposingAgentPenalty");
  const strip = el("div", "ed-preview-result");
  strip.textContent =
    `success % = base (matched requirements ÷ total)\n` +
    `          + ${pos}% × positive status traits  − ${neg}% × negative status traits\n` +
    `          + relationship bonds + event modifiers\n` +
    `          − ${agent}% × opposing agents at the target site\n` +
    `          → clamped to 0–100`;
  return strip;
}

/** Single-object form for `content/balance.json` (no entity list, no id). */
export function renderBalanceForm(container: HTMLElement, ctx: FormCtx): void {
  container.appendChild(
    hint(
      "Every knob applies at run start or at resolve time. Hover any label for what it does. Empty file = the defaults shown.",
    ),
  );
  container.appendChild(formulaStrip(ctx.row));

  for (const group of GROUPS) {
    const rows: HTMLElement[] = [];
    for (const def of group.fields) {
      const input = numberInput(
        scalar(ctx.row, def.key),
        (v) =>
          ctx.update((row) => {
            row[def.key] = v;
          }),
        { min: def.min, max: def.max },
      );
      input.title = def.tooltip;
      const frow = formRow(def.label, input, hint(def.tooltip));
      frow.title = def.tooltip;
      rows.push(frow);
    }
    container.appendChild(fieldset(group.legend, ...rows));
  }

  /* Relationship modifiers (nested object). */
  const modifiers = ctx.row.dynamicTraitModifiers;
  const modRow: Row =
    modifiers !== null && typeof modifiers === "object" && !Array.isArray(modifiers)
      ? (modifiers as Row)
      : {};
  const modRows: HTMLElement[] = [];
  for (const kind of ["friend", "lover", "rival", "hatred", "hero", "wanted"] as const) {
    const input = numberInput(
      num(modRow, kind, DEFAULT_BALANCE.dynamicTraitModifiers[kind]),
      (v) =>
        ctx.update((row) => {
          const cur = row.dynamicTraitModifiers;
          const next: Row =
            cur !== null && typeof cur === "object" && !Array.isArray(cur)
              ? { ...(cur as Row) }
              : { ...DEFAULT_BALANCE.dynamicTraitModifiers };
          next[kind] = v;
          row.dynamicTraitModifiers = next;
        }),
      { min: -100, max: 100 },
    );
    input.title = DYNAMIC_MODIFIER_TOOLTIPS[kind];
    const frow = formRow(`${kind} modifier %`, input, hint(DYNAMIC_MODIFIER_TOOLTIPS[kind]));
    frow.title = DYNAMIC_MODIFIER_TOOLTIPS[kind];
    modRows.push(frow);
  }
  container.appendChild(
    fieldset(
      "Relationship modifiers (flat % on success chance when the bond applies)",
      ...modRows,
    ),
  );
}
