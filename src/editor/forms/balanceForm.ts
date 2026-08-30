import { DEFAULT_BALANCE } from "../../game/types";
import type {
  DynamicTraitModifiers,
  LocationAffinityConfig,
  MinionAffinityConfig,
} from "../../game/types";
import type { FormCtx } from "./context";
import {
  el,
  fieldset,
  formRow,
  hint,
  listEditor,
  numberInput,
  num,
  type Row,
} from "../widgets";

type ScalarKey = Exclude<
  keyof typeof DEFAULT_BALANCE,
  | "dynamicTraitModifiers"
  | "hireLevelInfamyThresholds"
  | "minionAffinity"
  | "locationAffinity"
>;

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
        key: "agentChallengeTraitPenalty",
        label: "Challenge trait penalty %",
        tooltip:
          "Each DISTINCT challenge trait brought by enemy agents at the mission's target location subtracts this % from success chance unless someone on the crew has the matching trait — including challenge traits from HIDDEN agents the player can't see yet. Two agents with the same challenge trait still cost only once.",
        min: 0,
        max: 100,
      },
      {
        key: "compromisedBandPercent",
        label: "Compromised band %",
        tooltip:
          "How near a miss still counts as COMPROMISED. A roll that lands within this many points above the success chance applies the mission's success AND failure effects, and still counts as a completion for Omega phases. Set to 0 to remove the outcome entirely.",
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
        key: "startingMaxSupportAssets",
        label: "Starting support asset slots",
        tooltip:
          "How many optional support assets may ride along on one mission at the start of a run. Support assets are spent like required assets but bend a rule of the resolve instead of counting toward success. Lair upgrades raise this; 0 turns the system off for the run.",
        min: 0,
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
        key: "eventCooldownTurnsMin",
        label: "Event cooldown min (turns)",
        tooltip:
          "Fewest quiet turns after a global event leaves the slot (expired, resolved, or cancelled) before the next offer appears. 0 means a new event can arrive the same turn the last one ended.",
        min: 0,
        max: 99,
      },
      {
        key: "eventCooldownTurnsMax",
        label: "Event cooldown max (turns)",
        tooltip:
          "Most quiet turns between global events; the actual gap is rolled uniformly between the min and this. Must be ≥ the min.",
        min: 0,
        max: 99,
      },
      {
        key: "firstEventTurn",
        label: "First event turn",
        tooltip:
          "Turn number the first global event of a run shows up on. The run opens with that many turns minus one of quiet, so the player settles in before events start. 1 puts an offer on the table at turn 1.",
        min: 1,
        max: 99,
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
        key: "initialIntelSitesAtOne",
        label: "Starting intel-1 sites",
        tooltip:
          "How many map locations start at intel 1, where the player can see how many assets the site holds but not what they are. Every asset on the map starts hidden, so these picks plus the intel-2 sites below are the player's only opening leads.",
        min: 0,
        max: 99,
      },
      {
        key: "initialIntelSitesAtTwo",
        label: "Starting intel-2 sites",
        tooltip:
          "How many further map locations start at intel 2, where asset contents are identified and count as revealed for mission targeting. Drawn from the locations not already picked above, so no site starts higher than 2.",
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

const HIRE_THRESHOLDS_HINT =
  "Infamy the player must reach before the hire pool starts offering minions of each level. " +
  "Level 1 recruits are always on offer; the first row unlocks level 2, the second level 3, and " +
  "so on. Values must ascend. A minion whose Starting level sits above the last row can never be " +
  "offered — add another row for it.";

/** Ascending infamy gates for hire-pool `startingLevel`; row i unlocks level i + 2. */
function hireThresholdRows(ctx: FormCtx): HTMLElement {
  const raw = ctx.row.hireLevelInfamyThresholds;
  const values = Array.isArray(raw)
    ? raw.filter((v): v is number => typeof v === "number")
    : [...DEFAULT_BALANCE.hireLevelInfamyThresholds];

  /* listEditor builds rows in order, so a counter labels them even when values repeat. */
  let rowIndex = 0;
  const editor = listEditor(
    values,
    (next) =>
      ctx.update((row) => {
        row.hireLevelInfamyThresholds = next;
      }),
    (item, replace) => {
      const level = rowIndex + 2;
      rowIndex += 1;
      const wrap = el("span", "ed-inline-field");
      wrap.appendChild(el("span", "", `Level ${level} at infamy`));
      wrap.appendChild(numberInput(item, replace, { min: 1, max: 100 }));
      return wrap;
    },
    () => {
      const last = values.length > 0 ? values[values.length - 1]! : 0;
      return Math.min(100, last + 20);
    },
    "+ Add level",
  );

  const cap = values.length + 1;
  const summary = el(
    "div",
    "ed-preview-result",
    values.length === 0
      ? "no thresholds → only level 1 minions are ever offered"
      : `infamy 0 → level 1 · ${values
          .map((v, i) => `infamy ${v} → level ${i + 2}`)
          .join(" · ")}   (cap: level ${cap})`,
  );

  return fieldset("Hire pool level gates (infamy)", editor, summary, hint(HIRE_THRESHOLDS_HINT));
}

const DYNAMIC_MODIFIER_TOOLTIPS: Record<keyof DynamicTraitModifiers, string> = {
  friend: "Success bonus for each pair of Friends on the mission. Counted ONCE per pair, not per minion.",
  ally: "Success bonus for each pair of Allies on the mission (the deeper end of Friends). Counted ONCE per pair.",
  rival: "Success penalty for each pair of Rivals on the mission. Counted ONCE per pair, not per minion.",
  hatred: "Success penalty for each pair who hate each other on the mission (the deeper end of Rivals). Counted ONCE per pair.",
  hero: "Success bonus when the minion has Allies in the mission's target location. Per minion.",
  wanted: "Success penalty when the minion is Wanted at the mission's target location. Per minion.",
};

function scalar(row: Row, key: ScalarKey): number {
  return num(row, key, DEFAULT_BALANCE[key]);
}

function formulaStrip(row: Row): HTMLElement {
  const pos = scalar(row, "statusPositiveBonus");
  const neg = scalar(row, "statusNegativePenalty");
  const challenge = scalar(row, "agentChallengeTraitPenalty");
  const band = scalar(row, "compromisedBandPercent");
  const strip = el("div", "ed-preview-result");
  strip.textContent =
    `success % = base (matched requirements ÷ total)\n` +
    `          + ${pos}% × positive status traits  − ${neg}% × negative status traits\n` +
    `          + relationship bonds + event modifiers\n` +
    `          − ${challenge}% × unmatched agent challenge traits at the site\n` +
    `          → clamped to 0–100
` +
    `roll < success % → Success   ·   next ${band} points → Compromised   ·   rest → Failure`;
  return strip;
}


/* ---------- Minion pair affinity (nested object) ---------- */

type AffinityKey = keyof MinionAffinityConfig;

type AffinityFieldDef = {
  key: AffinityKey;
  label: string;
  tooltip: string;
  min: number;
  max: number;
};

const AFFINITY_THRESHOLD_FIELDS: AffinityFieldDef[] = [
  {
    key: "friendThreshold",
    label: "Friends at",
    tooltip:
      "Affinity score at which a pair becomes Friends. With +1 per shared mission success, 3 means three clean jobs together.",
    min: 1,
    max: 100,
  },
  {
    key: "allyThreshold",
    label: "Allies at",
    tooltip:
      "Affinity score at which Friends become Allies — the strongest positive bond. Keep it comfortably above the Friends threshold.",
    min: 1,
    max: 100,
  },
  {
    key: "rivalThreshold",
    label: "Rivals at",
    tooltip:
      "Affinity score (negative) at which a pair becomes Rivals. −3 means three shared failures.",
    min: -100,
    max: -1,
  },
  {
    key: "hatedThreshold",
    label: "Hated at",
    tooltip:
      "Affinity score (negative) at which Rivals come to hate each other — the strongest negative bond.",
    min: -100,
    max: -1,
  },
  {
    key: "hysteresis",
    label: "Hysteresis",
    tooltip:
      "How far back past a threshold the score must fall before the pair gives the band up. 0 lets a pair sitting on a threshold flip every turn; 2 means Friends earned at +3 only lapse at +0.",
    min: 0,
    max: 100,
  },
];

const AFFINITY_DELTA_FIELDS: AffinityFieldDef[] = [
  {
    key: "missionSuccess",
    label: "Lair mission success",
    tooltip: "Affinity each pair of participants gains when a normal mission succeeds.",
    min: -100,
    max: 100,
  },
  {
    key: "missionFailure",
    label: "Lair mission failure",
    tooltip: "Affinity each pair of participants loses when a normal mission fails (negative).",
    min: -100,
    max: 100,
  },
  {
    key: "eventSuccess",
    label: "Global event success",
    tooltip: "Affinity per pair when a global event mission succeeds. Bigger stakes, bigger bond.",
    min: -100,
    max: 100,
  },
  {
    key: "eventFailure",
    label: "Global event failure",
    tooltip: "Affinity per pair when a global event mission fails (negative).",
    min: -100,
    max: 100,
  },
  {
    key: "omegaSuccess",
    label: "Omega plan success",
    tooltip: "Affinity per pair when an Omega plan mission succeeds.",
    min: -100,
    max: 100,
  },
  {
    key: "omegaFailure",
    label: "Omega plan failure",
    tooltip: "Affinity per pair when an Omega plan mission fails (negative).",
    min: -100,
    max: 100,
  },
  {
    key: "lairRaidSuccess",
    label: "Lair raid repelled",
    tooltip: "Affinity per pair for surviving the lair raid together — the strongest single swing.",
    min: -100,
    max: 100,
  },
  {
    key: "lairRaidFailure",
    label: "Lair raid lost",
    tooltip:
      "Affinity per pair when the lair raid is lost. The run ends there today, so this only matters if that ever changes.",
    min: -100,
    max: 100,
  },
];

function affinityRow(ctx: FormCtx): Row {
  const cur = ctx.row.minionAffinity;
  return cur !== null && typeof cur === "object" && !Array.isArray(cur) ? (cur as Row) : {};
}

function affinityValue(ctx: FormCtx, key: AffinityKey): number {
  return num(affinityRow(ctx), key, DEFAULT_BALANCE.minionAffinity[key]);
}

function affinityFieldRows(ctx: FormCtx, defs: AffinityFieldDef[], rerender: () => void): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (const def of defs) {
    const input = numberInput(
      affinityValue(ctx, def.key),
      (v) => {
        ctx.update((row) => {
          const cur = row.minionAffinity;
          const next: Row =
            cur !== null && typeof cur === "object" && !Array.isArray(cur)
              ? { ...(cur as Row) }
              : { ...DEFAULT_BALANCE.minionAffinity };
          next[def.key] = v;
          row.minionAffinity = next;
        });
        rerender();
      },
      { min: def.min, max: def.max },
    );
    input.title = def.tooltip;
    const frow = formRow(def.label, input, hint(def.tooltip));
    frow.title = def.tooltip;
    rows.push(frow);
  }
  return rows;
}

/** Live picture of the track the current thresholds carve out, including the hysteresis bands. */
function affinityTrackStrip(ctx: FormCtx): HTMLElement {
  const friend = affinityValue(ctx, "friendThreshold");
  const ally = affinityValue(ctx, "allyThreshold");
  const rival = affinityValue(ctx, "rivalThreshold");
  const hated = affinityValue(ctx, "hatedThreshold");
  const h = affinityValue(ctx, "hysteresis");
  const strip = el("div", "ed-preview-result");
  strip.textContent =
    `every pair starts at 0 · Neutral
` +
    `  ${ally}  → Allies      (lapses back to Friends below ${ally - h})
` +
    `  ${friend}  → Friends     (lapses back to Neutral below ${friend - h})
` +
    ` ${rival}  → Rivals      (lapses back to Neutral above ${rival + h})
` +
    ` ${hated}  → Hated       (lapses back to Rivals above ${hated + h})`;
  return strip;
}

function minionAffinityBlock(ctx: FormCtx): HTMLElement {
  const wrap = el("div");
  const render = (): void => {
    wrap.innerHTML = "";
    wrap.appendChild(
      fieldset(
        "Minion affinity thresholds (hidden score → relationship)",
        hint(
          "Every unordered pair of minions shares one affinity score, starting at 0. The score is never shown to the player — only the relationship it lands in. Modifiers apply once per pair.",
        ),
        ...affinityFieldRows(ctx, AFFINITY_THRESHOLD_FIELDS, render),
        affinityTrackStrip(ctx),
      ),
    );
    wrap.appendChild(
      fieldset(
        "Minion affinity per resolve (applied to every pair on the mission)",
        ...affinityFieldRows(ctx, AFFINITY_DELTA_FIELDS, render),
      ),
    );
  };
  render();
  return wrap;
}


/* ---------- Minion-location affinity (nested object) ---------- */

type LocationAffinityKey = keyof LocationAffinityConfig;

const LOCATION_AFFINITY_FIELDS: { key: LocationAffinityKey; label: string; tooltip: string; min: number; max: number }[] = [
  {
    key: "heroThreshold",
    label: "Hero at",
    tooltip:
      "Standing at which a minion gains Allies in that location (worth the Hero success bonus there). With +1 per success, 3 means three clean jobs at the same site.",
    min: 1,
    max: 100,
  },
  {
    key: "wantedThreshold",
    label: "Wanted at",
    tooltip:
      "Standing (negative) at which a minion becomes Wanted at that location, taking the Wanted penalty on every future job there.",
    min: -100,
    max: -1,
  },
  {
    key: "hysteresis",
    label: "Hysteresis",
    tooltip:
      "How far back past a threshold the standing must fall before the minion gives it up. 0 lets a minion parked on a threshold flip every turn; 2 means a Hero earned at +3 only lapses at +0.",
    min: 0,
    max: 100,
  },
  {
    key: "missionSuccess",
    label: "Mission success",
    tooltip:
      "Standing each participant gains at the mission's location when it succeeds. Missions with no site (minion / none targets) change nothing.",
    min: -100,
    max: 100,
  },
  {
    key: "missionFailure",
    label: "Mission failure",
    tooltip:
      "Standing each participant loses at the mission's location when it fails (negative). This is the road to Wanted.",
    min: -100,
    max: 100,
  },
];

function locationAffinityRow(ctx: FormCtx): Row {
  const cur = ctx.row.locationAffinity;
  return cur !== null && typeof cur === "object" && !Array.isArray(cur) ? (cur as Row) : {};
}

function locationAffinityValue(ctx: FormCtx, key: LocationAffinityKey): number {
  return num(locationAffinityRow(ctx), key, DEFAULT_BALANCE.locationAffinity[key]);
}

/** Live picture of the Hero / Wanted track, including where each standing lapses. */
function locationTrackStrip(ctx: FormCtx): HTMLElement {
  const hero = locationAffinityValue(ctx, "heroThreshold");
  const wanted = locationAffinityValue(ctx, "wantedThreshold");
  const h = locationAffinityValue(ctx, "hysteresis");
  const strip = el("div", "ed-preview-result");
  strip.textContent =
    `every minion starts at 0 at every site · Neutral\n` +
    `  ${hero}  → Hero        (lapses back to Neutral below ${hero - h})\n` +
    ` ${wanted}  → Wanted      (lapses back to Neutral above ${wanted + h})`;
  return strip;
}

function locationAffinityBlock(ctx: FormCtx): HTMLElement {
  const wrap = el("div");
  const render = (): void => {
    wrap.innerHTML = "";
    const rows: HTMLElement[] = [];
    for (const def of LOCATION_AFFINITY_FIELDS) {
      const input = numberInput(
        locationAffinityValue(ctx, def.key),
        (v) => {
          ctx.update((row) => {
            const cur = row.locationAffinity;
            const next: Row =
              cur !== null && typeof cur === "object" && !Array.isArray(cur)
                ? { ...(cur as Row) }
                : { ...DEFAULT_BALANCE.locationAffinity };
            next[def.key] = v;
            row.locationAffinity = next;
          });
          render();
        },
        { min: def.min, max: def.max },
      );
      input.title = def.tooltip;
      const frow = formRow(def.label, input, hint(def.tooltip));
      frow.title = def.tooltip;
      rows.push(frow);
    }
    wrap.appendChild(
      fieldset(
        "Hero / Wanted standing (hidden score → location trait)",
        hint(
          "Every minion carries one hidden score per location, starting at 0 and moved by missions there. The score is never shown to the player — only the Hero or Wanted trait it produces. Nothing is rolled.",
        ),
        ...rows,
        locationTrackStrip(ctx),
      ),
    );
  };
  render();
  return wrap;
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

  container.appendChild(hireThresholdRows(ctx));

  /* Relationship modifiers (nested object). */
  const modifiers = ctx.row.dynamicTraitModifiers;
  const modRow: Row =
    modifiers !== null && typeof modifiers === "object" && !Array.isArray(modifiers)
      ? (modifiers as Row)
      : {};
  const modRows: HTMLElement[] = [];
  for (const kind of ["friend", "ally", "rival", "hatred", "hero", "wanted"] as const) {
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

  container.appendChild(minionAffinityBlock(ctx));
  container.appendChild(locationAffinityBlock(ctx));
}
