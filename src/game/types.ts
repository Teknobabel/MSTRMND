export type TraitType = "status_positive" | "status_negative" | "primary" | "secondary";

export type Trait = {
  id: string;
  name: string;
  type: TraitType;
};

/** Runtime-only relationship traits (not catalog `Trait` ids). */
export type DynamicTraitKind =
  | "friend"
  | "ally"
  | "rival"
  | "hatred"
  | "hero"
  | "wanted";

/**
 * Every kind here is a **projection** of an affinity table: the four minion-to-minion kinds come
 * from {@link MinionPairAffinity}, `hero` / `wanted` from {@link MinionLocationAffinity}. Those
 * scores are the source of truth and `syncMinionDynamicTraits` (see `affinity.ts`) rebuilds this
 * whole array from them after every resolve. Never edit them directly.
 */
export type DynamicTrait =
  | {
      kind: "friend" | "ally" | "rival" | "hatred";
      targetMinionInstanceId: string;
      /** Present until resolved against a roster instance of this template. */
      pendingTargetTemplateId?: string;
    }
  | { kind: "hero" | "wanted"; locationId: string };

/**
 * Where an unordered minion pair sits on the affinity track. `neutral` is the starting state and
 * carries no success modifier.
 */
export type MinionRelationship = "hated" | "rival" | "neutral" | "friend" | "ally";

/**
 * One unordered pair's shared affinity. Instance ids are stored **sorted** (`aInstanceId` <
 * `bInstanceId`) so a pair has exactly one row regardless of which minion is looked up first.
 *
 * `score` is deliberately never surfaced in the game UI — the player only ever sees the derived
 * {@link relationship}. `relationship` is stored rather than recomputed because the thresholds are
 * hysteretic: which band a score sits in depends on which band it was in last turn.
 */
export type MinionPairAffinity = {
  aInstanceId: string;
  bInstanceId: string;
  score: number;
  relationship: MinionRelationship;
};

/**
 * A run's opening affinity between two minion **templates**, rolled once at run start and fixed
 * for the run. It lands on the real instance pair the moment both minions are on the roster —
 * the roster is empty at turn 1, so there is nothing to seed until then.
 */
export type MinionTemplatePairAffinity = {
  aTemplateId: string;
  bTemplateId: string;
  score: number;
};

/** One pair crossing a threshold during a resolve; drives the result card and turn summary. */
export type MinionRelationshipChange = {
  aInstanceId: string;
  bInstanceId: string;
  from: MinionRelationship;
  to: MinionRelationship;
};

/**
 * Where a minion stands at one location. `neutral` is the starting state and carries no success
 * modifier; the two ends are the `hero` / `wanted` dynamic traits.
 */
export type MinionLocationStanding = "wanted" | "neutral" | "hero";

/**
 * One minion's standing at one location, driven by the same machinery as
 * {@link MinionPairAffinity}: a hidden `score` the player never sees, and the band it lands in.
 * `standing` is stored rather than recomputed because the thresholds are hysteretic.
 */
export type MinionLocationAffinity = {
  minionInstanceId: string;
  locationId: string;
  score: number;
  standing: MinionLocationStanding;
};

/** One minion crossing a location threshold during a resolve; drives the report lines. */
export type MinionLocationStandingChange = {
  minionInstanceId: string;
  locationId: string;
  from: MinionLocationStanding;
  to: MinionLocationStanding;
};

/**
 * A run's opening standing between a minion **template** and a location, rolled once at run
 * start. It lands on the real minion the moment that template is hired — the roster is empty at
 * turn 1, but the run's locations already exist.
 */
export type MinionTemplateLocationAffinity = {
  minionTemplateId: string;
  locationId: string;
  score: number;
};

export type StartingDynamicTrait =
  | {
      kind: "friend" | "ally" | "rival" | "hatred";
      targetMinionTemplateId: string;
    }
  | { kind: "hero" | "wanted"; locationId: string };

export type MinionTemplate = {
  id: string;
  name: string;
  description: string;
  /** Optional card portrait URL (site root path under `public/`, e.g. `/assets/cards/custom/x.png`). */
  cardArt?: string;
  /** CP cost to hire during the Main Phase. */
  hireCommandPoints: number;
  startingTraitIds?: string[];
  levelUpTraitOrder: string[];
  /**
   * Level at hire (`currentLevel`). Defaults to **1** when omitted in JSON.
   * Traits from `levelUpTraitOrder` are granted by applying level-ups until this level is reached.
   */
  startingLevel?: number;
  /** Designer-authored dynamic traits at hire (minion-targeted use template id until resolved on roster). */
  startingDynamicTraits?: StartingDynamicTrait[];
};

export type MinionInstance = {
  /** Stable id for this hire for mission assignment and catalogs. */
  instanceId: string;
  templateId: string;
  currentLevel: number;
  currentExperience: number;
  traitIds: string[];
  /** Relationship / location-linked modifiers; not catalog trait ids. */
  dynamicTraits: DynamicTrait[];
};

/**
 * What an agent can do beyond occupying a site. **Passive** abilities are always in effect and
 * fire inside mission resolution; **active** ones are spent in the Agent Phase and cost the
 * agent its move that turn. See `agentAbility.ts` for the registry and what each one does.
 */
export type AgentAbilityId =
  | "brawler"
  | "investigator"
  | "guard"
  | "security_chief"
  | "counterintelligence"
  | "asset_protection";

/** Every {@link AgentAbilityId}, in designer-facing order (editor dropdown + schema). */
export const AGENT_ABILITY_IDS = [
  "brawler",
  "investigator",
  "guard",
  "security_chief",
  "counterintelligence",
  "asset_protection",
] as const satisfies readonly AgentAbilityId[];

/**
 * How an agent picks where to go at the end of each turn. Every behavior names an *attractor* —
 * the set of sites it wants to be at — and the agent relocates to one of them (see
 * `agentMovement.ts`). Behaviors never look at what the player is allowed to see: a hidden
 * agent hunts exactly as well as a revealed one.
 */
export type AgentMovementBehavior =
  /** Sites holding an asset the current Omega phase's missions call for. */
  | "defender"
  /** The site of the player's most recent failed mission. */
  | "investigator"
  /** Wherever the minion it locked onto is currently working. */
  | "hunter"
  /** The site the player knows most about (highest intel). */
  | "analyst"
  /** Sites with at least one revealed asset slot. */
  | "asset_protector"
  /** Sites with the lowest security. */
  | "opportunist";

/** Every {@link AgentMovementBehavior}, in designer-facing order (editor dropdown + schema). */
export const AGENT_MOVEMENT_BEHAVIORS = [
  "defender",
  "investigator",
  "hunter",
  "analyst",
  "asset_protector",
  "opportunist",
] as const satisfies readonly AgentMovementBehavior[];

/**
 * Designer-authored opposing operative. Extends the {@link MinionTemplate} JSON shape with the
 * challenge traits the agent brings to missions run at its location.
 */
export type AgentTemplate = MinionTemplate & {
  /**
   * Trait ids this agent adds as a *challenge* to every mission at its site. Each distinct
   * challenge trait across the site's agents costs a flat
   * `BalanceConfig.agentChallengeTraitPenalty` unless some participant holds the matching trait.
   * Unlike required traits, these never enter the matched/total base-success ratio.
   *
   * Optional: an agent with none poses no trait challenge and is felt only through its
   * abilities, its movement, or simply standing there.
   */
  challengeTraitIds: string[];
  /**
   * Agent Phase movement rule. Optional — an agent without one holds whatever site it is on
   * for the whole run, which is a legitimate way to author a fixture guarding one place.
   */
  movementBehavior?: AgentMovementBehavior;
  /**
   * Abilities this agent carries, in **priority order**: when several active abilities could
   * fire in the same Agent Phase, the earliest usable one wins. Zero or more; defaults to none.
   */
  abilityIds?: AgentAbilityId[];
};

export type AgentCatalogVisibility = "hidden" | "revealed";

/** Runtime opposing operative instance; extends {@link MinionInstance} with catalog visibility. */
export type AgentInstance = MinionInstance & {
  /** Player-facing visibility on location UI; spawned agents default to hidden. */
  catalogVisibility: AgentCatalogVisibility;
  /** Snapshot of {@link AgentTemplate.challengeTraitIds} at spawn. */
  challengeTraitIds: string[];
  /** Snapshot of {@link AgentTemplate.movementBehavior} at spawn; `null` = stays put. */
  movementBehavior: AgentMovementBehavior | null;
  /** Snapshot of {@link AgentTemplate.abilityIds} at spawn, priority order preserved. */
  abilityIds: AgentAbilityId[];
  /**
   * Turn this agent arrived on the map. It sits out the Agent Phase of that turn — an agent
   * deployed by a wanted escalation acts from the following turn, not the one it landed on.
   */
  deployedOnTurn: number;
  /**
   * `hunter` only: the minion instance this agent locked onto. Set the first time the agent
   * moves with a roster to choose from, and cleared when that minion leaves the roster.
   */
  huntedMinionInstanceId: string | null;
};

/** Designer-authored mission target; drives planning UI and validation. */
export type MissionTargetType =
  | "location"
  | "asset_hidden"
  | "asset_revealed"
  | "minion"
  | "none";

/**
 * Runtime target for an active mission (assign + resolve).
 * - `asset`: `visibilityAtAssign` must match the slot’s visibility when assigned.
 */
export type MissionTarget =
  | { kind: "location"; locationId: string }
  | {
      kind: "asset";
      locationId: string;
      slotIndex: number;
      visibilityAtAssign: LocationAssetVisibility;
    }
  | { kind: "minion"; instanceId: string }
  | { kind: "none" };

/** Single designer-authored outcome when a mission finishes. */
export type MissionEffect =
  | { kind: "reveal_target_asset" }
  | { kind: "reveal_all_hidden_assets_at_location" }
  | { kind: "steal_target_asset" }
  /** Reveals every hidden asset at the mission location, then moves all location assets into inventory. */
  | { kind: "steal_all_assets_at_location" }
  /** Moves every revealed (not hidden) asset at the mission location into inventory. */
  | { kind: "steal_all_revealed_assets_at_location" }
  | { kind: "unlock_lair_mission"; missionId: string }
  /**
   * Grants catalog assets to inventory (not taken from locations). Duplicate ids grant multiple units.
   */
  | { kind: "gain_assets"; assetIds: string[] }
  /**
   * Removes up to the listed quantities from the player's inventory (shortfall skipped), then adds the gained ids.
   * Both fields are multisets; at least one list must be non-empty.
   */
  | { kind: "exchange_assets"; removeAssetIds: string[]; gainAssetIds: string[] }
  /** Adds delta to security at the mission location (negative reduces); clamped to [0, locationLevel]. */
  | { kind: "security_level_delta"; delta: number }
  /** Adds delta to intel at the mission location (negative reduces); clamped to [0, 3]. */
  | { kind: "intel_level_delta"; delta: number }
  /**
   * Grants the listed trait ids to the minion identified by the active mission's `target`
   * (which must be `kind: "minion"`). Existing traits on that minion are not duplicated.
   * Requires mission `targetType: "minion"`.
   */
  | { kind: "add_target_minion_traits"; traitIds: string[] }
  /**
   * Grants traits to one randomly chosen mission participant (from `participantInstanceIds`).
   * Requires at least one participant when the mission resolves (otherwise no-op).
   */
  | { kind: "add_random_participant_traits"; traitIds: string[] }
  /**
   * Grants traits to every mission participant listed in `participantInstanceIds`.
   * No-op if that list is empty.
   */
  | { kind: "add_all_participant_traits"; traitIds: string[] }
  | { kind: "infamy_delta"; amount: number }
  | { kind: "heat_delta"; amount: number }
  | { kind: "max_concurrent_missions_delta"; delta: number }
  | { kind: "max_roster_size_delta"; delta: number }
  | { kind: "max_hire_offers_delta"; delta: number }
  | { kind: "max_participants_per_mission_delta"; delta: number }
  /** Adds delta to how many support assets may ride along on one mission; floor 0. */
  | { kind: "max_support_assets_delta"; delta: number }
  | { kind: "max_command_points_per_turn_delta"; delta: number }
  /** Adds delta to security at every playable location; clamped per-site to [0, locationLevel]. */
  | { kind: "security_level_delta_global"; delta: number }
  | { kind: "security_level_delta_by_location_type"; delta: number; locationType: LocationType }
  | { kind: "security_level_delta_by_location_level"; delta: number; locationLevel: 1 | 2 | 3 }
  /** Adds delta to intel at every playable location; clamped per-site to [0, 3]. */
  | { kind: "intel_level_delta_global"; delta: number }
  | { kind: "intel_level_delta_by_location_type"; delta: number; locationType: LocationType }
  | { kind: "intel_level_delta_by_location_level"; delta: number; locationLevel: 1 | 2 | 3 }
  /** Removes trait id from every hired roster minion (no-op if none have it). */
  | { kind: "remove_trait_from_all_minions"; traitId: string }
  /**
   * Grants trait to up to `count` distinct hired minions chosen uniformly at random (including busy).
   */
  | { kind: "add_trait_to_random_minions"; traitId: string; count: number }
  /** Reveals up to `count` random hidden occupied asset slots across playable locations. */
  | { kind: "reveal_hidden_assets_global"; count: number }
  | { kind: "reveal_hidden_assets_by_location_type"; count: number; locationType: LocationType }
  | { kind: "reveal_hidden_assets_by_location_level"; count: number; locationLevel: 1 | 2 | 3 }
  /** Adds to one-time bonus CP applied on the next turn's CP refill, then cleared. */
  | { kind: "grant_command_points_next_turn"; amount: number }
  /**
   * Adds a flat success % modifier for `turns` resolve cycles (each `executePlan` counts as one).
   */
  | { kind: "add_success_chance_modifier"; delta: number; turns: number };

export type MissionTemplate = {
  id: string;
  name: string;
  description: string;
  /** Optional card art URL (site root path under `public/`). */
  cardArt?: string;
  /** CP spent when starting this mission (Main Phase). */
  startCommandPoints: number;
  requiredTraitIds: string[];
  /**
   * Catalog asset ids required for full success; duplicates mean multiple units needed.
   * At least one of `requiredTraitIds` or `requiredAssetIds` must be non-empty.
   */
  requiredAssetIds: string[];
  durationTurns: number;
  /**
   * Designer-only marker (never shown to the player): a **core** mission is in the Lair
   * Missions pool from turn 1 in every run, whatever lair was picked, on top of that lair's
   * `availableMissionIds`. Absent ⇒ `false`. Only meaningful on `content/missions.json`
   * templates — events are drawn from their own pool and ignore it.
   */
  coreMission?: boolean;
  /** What the player must pick in the target planning slot (if any). */
  targetType: MissionTargetType;
  /**
   * Restricts which sites this mission may be aimed at, by the target location's
   * `locationType`. Absent or empty ⇒ any type. Only meaningful for a `targetType` that
   * resolves to a location (`location`, `asset_hidden`, `asset_revealed`).
   */
  targetLocationTypes?: LocationType[];
  /**
   * Restricts which sites this mission may be aimed at, by the target location's
   * `locationLevel`. Absent or empty ⇒ any level. Same `targetType` rule as
   * {@link MissionTemplate.targetLocationTypes}.
   */
  targetLocationLevels?: LocationLevel[];
  /**
   * Restricts which sites this mission may be aimed at, by the player's **current** intel at
   * the target location. Absent or empty ⇒ any intel. Same `targetType` rule as
   * {@link MissionTemplate.targetLocationTypes}.
   *
   * Unlike the other two filters this reads **per-run state**, not the location catalog, so
   * the same mission opens and closes sites as surveillance raises intel and events lower it.
   * It is checked when the mission is **started**; intel moving afterwards does not call a
   * mission in flight back.
   */
  targetLocationIntelLevels?: IntelLevel[];
  /**
   * Restricts which sites this mission may be aimed at, by the target location's **current**
   * security. Absent or empty ⇒ any security. Same `targetType` rule as
   * {@link MissionTemplate.targetLocationTypes}, and the same start-time-only check as
   * {@link MissionTemplate.targetLocationIntelLevels}.
   *
   * Security is capped per site at that location's `locationLevel`, so a filter naming only
   * high values implicitly excludes the low-level sites that can never reach them.
   */
  targetLocationSecurityLevels?: SecurityLevel[];
  /** Applied in order when the mission resolves successfully (after baseline infamy). */
  onSuccessEffects?: MissionEffect[];
  /** Applied in order when the mission resolves as a failure (after baseline infamy). */
  onFailureEffects?: MissionEffect[];
};

/**
 * Event mission template (a {@link MissionTemplate} with a shelf life). Stored in
 * `content/events.json`.
 */
export type EventTemplate = MissionTemplate & {
  /**
   * Turns this event stays on the table as the current offer — the window the player has to
   * start it. Counts down once per `executePlan`; hitting 0 without the event having been
   * started fires `onFailureEffects` and clears the offer. Starting it stops the countdown:
   * the mission then decides the outcome via `onSuccessEffects` / `onFailureEffects`.
   *
   * Ignoring an event and botching it are the **same outcome**: there is no separate expiry
   * effect list, so `onFailureEffects` is the single place a designer writes what going wrong
   * costs, however it went wrong.
   */
  lifetimeTurns: number;
  /**
   * Player **infamy** needed for this event to enter the draw pool. Absent (or 0) ⇒ no gate.
   * Gates are checked against the player's stats at the moment the next offer is drawn, so a
   * gated event simply stays out of the rotation until the run reaches it.
   */
  minInfamy?: number;
  /** Player **heat** needed for this event to enter the draw pool. Absent (or 0) ⇒ no gate. */
  minHeat?: number;
  /**
   * Marks a **system-spawned** event. Special events are never in the random draw pool
   * (`eligibleEventTemplates` filters them out); the rule that owns them puts them on the
   * table directly, overriding the event cooldown.
   *
   * `"lair_raid"` — the run-ending raid the **top wanted tier** spawns. Letting its offer
   * expire, or failing its mission, ends the run (`GameState.runEnding`) — the same outcome
   * either way, which is the rule for every event. Completing it
   * stands the top tier down until heat climbs back to its `minHeat`. At most one event in the
   * catalog may carry it (checked in `collectContentIssues`).
   */
  special?: "lair_raid";
};

/** Visibility of an asset at a location for the player (kind known only when revealed). */
export type LocationAssetVisibility = "hidden" | "revealed";

/**
 * One asset slot at a location at runtime (not authored in `locations.json`).
 * `occupied` holds a catalog asset; `empty` is left after a steal (same index kept).
 */
export type LocationAssetSlot =
  | { kind: "empty" }
  | { kind: "occupied"; assetId: string; visibility: LocationAssetVisibility };

export function isOccupiedAssetSlot(
  slot: LocationAssetSlot,
): slot is Extract<LocationAssetSlot, { kind: "occupied" }> {
  return slot.kind === "occupied";
}

/** Per-location asset slots for the current run (from `createInitialGameState`). */
export type LocationAssetPlacement = {
  locationId: string;
  slots: LocationAssetSlot[];
};

/**
 * Runtime only: which opposing agent instances are present at a playable location.
 * Population is gameplay-driven (not authored in `locations.json`).
 */
export type LocationAgentPresence = {
  locationId: string;
  /** {@link AgentInstance.instanceId} values; order preserved for display / rules. */
  agentInstanceIds: string[];
};

/** Designer-authored category for a location. */
export type LocationType = "political" | "military" | "economic";

/** Designer difficulty / importance tier for a location. */
export type LocationLevel = 1 | 2 | 3;

export type LocationTemplate = {
  id: string;
  name: string;
  description: string;
  /** Optional card art URL (site root path under `public/`). */
  cardArt?: string;
  /** Political, Military, or Economic (designer). */
  locationType: LocationType;
  /** Designer difficulty or importance tier, 1–3. */
  locationLevel: LocationLevel;
};

/** Where an active mission was started from (lair pool vs current Omega row vs rotating event). */
export type MissionSource = "lair" | "omega" | "event";

/**
 * How hard a site is to work: raised by resolving missions there, capped per site at that
 * location's authored `locationLevel`.
 */
export type SecurityLevel = 0 | 1 | 2 | 3;

/**
 * Per-run security at a location (not in catalog JSON). Updated by gameplay systems.
 */
export type LocationSecurityState = {
  locationId: string;
  /** Rises after missions resolve at this site; new runs start at 0, capped at 3. */
  securityLevel: SecurityLevel;
};

/** How much the player knows about a site; each step unlocks a fixed kind of knowledge. */
export type IntelLevel = 0 | 1 | 2 | 3;

/**
 * Per-run intel at a location (not in catalog JSON). Gates what the player may see at the site:
 * 1 lists every asset slot, 2 identifies their contents, 3 shows opposing agents. Raised by
 * surveillance missions; events may raise or lower it. New runs start at 0.
 */
export type LocationIntelState = {
  locationId: string;
  intelLevel: IntelLevel;
};

/**
 * Where one site sits on its map's art. `x`/`y` are percentages of the art box (0–100,
 * left/top origin) rather than pixels, so the plot survives any panel size.
 */
export type MapMarker = {
  locationId: string;
  x: number;
  y: number;
};

export type MapTemplate = {
  id: string;
  name: string;
  description: string;
  locationIds: string[];
  /** Background art for the map view (site root path under `public/`). */
  mapArt?: string;
  /** Plotted sites; any location without a marker still plays, it just is not on the art. */
  markers?: MapMarker[];
};

/**
 * What a **support asset** does when the player brings it along on a mission. Support assets
 * are optional extras dropped into the mission's support slots (see
 * `PlayerState.maxSupportAssets`); they are consumed on assign exactly like required assets,
 * but they never enter the required-trait / required-asset success ratio — each one bends one
 * rule of the resolve instead.
 *
 * - `success_chance_bonus` — flat `+percent` on the mission's success chance (stacks across
 *   slots, like every other flat modifier).
 * - `prevent_security_increase` — the mission cannot leave security at its target site higher
 *   than it found it: the automatic post-resolve bump is skipped, and any net rise this
 *   mission's own effects caused there is given back. A reduction still stands.
 * - `prevent_heat_increase` — the mission cannot end with the player's heat higher than it
 *   started (baseline failure heat, an Investigator's bonus heat, and `heat_delta` effects all
 *   included). Reductions still land.
 * - `prevent_injuries` — no participant comes home with the `injured` trait they did not
 *   already have (blocks the Brawler and any effect that would have applied it).
 * - `ignore_agent_challenge_traits` — the site's opposing agents contribute no challenge
 *   traits, so their flat penalty is zero however many are in play.
 * - `ignore_security_traits` — the target site's **revealed security** traits drop out of the
 *   required-trait set. The site's own `locationRequiredTraits` are untouched.
 */
export type SupportAssetAbility =
  | { kind: "success_chance_bonus"; percent: number }
  | { kind: "prevent_security_increase" }
  | { kind: "prevent_heat_increase" }
  | { kind: "prevent_injuries" }
  | { kind: "ignore_agent_challenge_traits" }
  | { kind: "ignore_security_traits" };

export type SupportAssetAbilityKind = SupportAssetAbility["kind"];

/** Every support ability kind, in the order the editor's picker lists them. */
export const SUPPORT_ASSET_ABILITY_KINDS: readonly SupportAssetAbilityKind[] = [
  "success_chance_bonus",
  "prevent_security_increase",
  "prevent_heat_increase",
  "prevent_injuries",
  "ignore_agent_challenge_traits",
  "ignore_security_traits",
];

export type Asset = {
  id: string;
  name: string;
  description?: string;
  /** Optional card art URL (site root path under `public/`). */
  cardArt?: string;
  /**
   * Marks this asset as a **support asset** and says what it does on a mission. Absent ⇒ the
   * asset is inert cargo: it can still be a mission's `requiredAssetIds` entry, a steal target
   * or a `gain_assets` payout, but it cannot be dropped into a support slot.
   */
  supportAbility?: SupportAssetAbility;
};

export type OmegaPlanStage = {
  missionIds: [string, string, string];
  /**
   * How many of this phase's three missions must succeed before the phase completes
   * (designer-authored, 1–3). Absent in JSON means all three (legacy behavior).
   */
  requiredMissions: number;
};

export type OmegaPlanTemplate = {
  id: string;
  name: string;
  description: string;
  /** Optional card art URL (site root path under `public/`). */
  cardArt?: string;
  /** Map (`MapTemplate.id`) whose locations are playable for this plan. */
  mapId: string;
  stages: [OmegaPlanStage, OmegaPlanStage, OmegaPlanStage];
  /**
   * Headline on the **victory** modal when this plan's final phase clears — the payoff line
   * for *this* plan, not a generic "You win". Falls back to `"Omega Complete"` when absent.
   */
  victoryTitle?: string;
  /**
   * Designer-authored victory prose, one paragraph per entry, shown under {@link victoryTitle}.
   * This is the only place the ending of a run is written, so a plan without it gets a bland
   * generic paragraph — author it alongside the stages.
   */
  victoryNarrative?: string[];
};

/** Heat tier for wanted level (designer-authored); monotonic escalation at runtime. */
export type WantedLevelTier = {
  /** Inclusive minimum heat for this tier (0–100). */
  minHeat: number;
  name: string;
  /** Max opposing agents allowed in play when this tier applies (spawn logic uses this later). */
  maxAgents: number;
};

/**
 * One tier of lair upgrades. `missionIds` are **mutually exclusive**: the first of them to
 * resolve successfully is the upgrade the player gets, and the others become unreachable for
 * the run. Levels are consumed in `LairTemplate.upgradeLevels` order.
 */
export type LairUpgradeLevel = {
  /** Optional designer label for the tier; UI falls back to `Level N`. */
  name?: string;
  /**
   * Player **infamy** needed to *start* any of this level's missions. Absent (or 0) ⇒ no gate.
   * This gates **capability only, never visibility**: the level is shown as soon as it is the
   * next open one, with the requirement stated, so the player can see what they are working
   * toward. Checked against `player.infamy` at `assignMission`.
   */
  minInfamy?: number;
  /** Mutually exclusive upgrade mission template ids (at least one). */
  missionIds: string[];
};

/** Designer-authored home base; one chosen per run. */
export type LairTemplate = {
  id: string;
  name: string;
  description?: string;
  /** Optional header/card art URL (site root path under `public/`). */
  cardArt?: string;
  /**
   * Mission templates unlocked and assignable from the lair from turn 1 (runtime pool starts
   * as a copy). Unrelated to upgrades — these never lock out and never gate each other.
   */
  availableMissionIds: string[];
  /**
   * Ordered upgrade tiers, played front to back. Each level offers a set of **mutually
   * exclusive** upgrade missions: completing one installs it, locks its siblings out for the
   * rest of the run, and opens the next level. The player only ever sees the next open level.
   * Every mission id here is disjoint from `availableMissionIds` and from the other levels.
   */
  upgradeLevels: LairUpgradeLevel[];
  /** Optional starting `Asset.id` quantities merged into `player.assets` at run start. */
  startingAssets?: Record<string, number>;
};

/** Catalog entry for the player mastermind identity; one row chosen per run. */
export type PlayerProfile = {
  name: string;
  /** Site root path under `public/` (e.g. `/assets/cards/minion.png`). */
  profilePic: string;
};

/**
 * Flat success % modifier per dynamic trait kind. Minion-to-minion kinds apply **once per
 * unordered pair** on the mission (not once per minion); `hero` / `wanted` apply per minion
 * against the mission's target location.
 */
export type DynamicTraitModifiers = {
  friend: number;
  ally: number;
  rival: number;
  hatred: number;
  hero: number;
  wanted: number;
};

/**
 * Designer-tunable minion pair affinity: how much a shared mission moves a pair's score, and
 * where the score turns into a relationship.
 *
 * Thresholds are **entry** points. Leaving a band needs the score to fall `hysteresis` further
 * back than the point it entered on, which is what keeps a pair sitting on a threshold from
 * flip-flopping every turn (e.g. with `friendThreshold: 3` and `hysteresis: 2`, a pair becomes
 * Friends at +3 and only drops back to Neutral at +0).
 */
export type MinionAffinityConfig = {
  /* Thresholds — positive pair ascending, negative pair descending. */
  /** Score at which a pair becomes Friends. */
  friendThreshold: number;
  /** Score at which Friends become Allies. */
  allyThreshold: number;
  /** Score (negative) at which a pair becomes Rivals. */
  rivalThreshold: number;
  /** Score (negative) at which Rivals become Hated. */
  hatedThreshold: number;
  /** How far back past a threshold a score must fall before the band is given up (≥ 0). */
  hysteresis: number;
  /* Per-resolve score deltas, applied to every unordered pair of participants. */
  /** Lair / standard mission succeeded. */
  missionSuccess: number;
  /** Lair / standard mission failed. */
  missionFailure: number;
  /** Global event mission succeeded. */
  eventSuccess: number;
  /** Global event mission failed. */
  eventFailure: number;
  /** Omega plan mission succeeded. */
  omegaSuccess: number;
  /** Omega plan mission failed. */
  omegaFailure: number;
  /** Lair raid repelled — surviving it together is the strongest bond in the game. */
  lairRaidSuccess: number;
  /** Lair raid lost. The run ends here, so this only matters if that ever stops being true. */
  lairRaidFailure: number;
};

/**
 * Designer-tunable minion-to-**location** affinity: how much a mission at a site moves the
 * minion's standing there, and where that standing turns into the `hero` / `wanted` trait.
 *
 * Same shape and same hysteresis rule as {@link MinionAffinityConfig}, with one threshold each
 * way instead of two — Hero and Wanted have no deeper tier. A minion becomes a Hero at
 * `heroThreshold` and only gives it up once the score falls `hysteresis` further back.
 */
export type LocationAffinityConfig = {
  /** Score at which a minion gains Allies in the location. */
  heroThreshold: number;
  /** Score (negative) at which a minion becomes Wanted at the location. */
  wantedThreshold: number;
  /** How far back past a threshold a score must fall before the standing is given up (≥ 0). */
  hysteresis: number;
  /** Applied to every participant when a mission at that location succeeds. */
  missionSuccess: number;
  /** Applied to every participant when a mission at that location fails. */
  missionFailure: number;
};

/**
 * Designer-tunable balance knobs (`content/balance.json`). Every field has a schema default
 * equal to the pre-balance-slice constant (see {@link DEFAULT_BALANCE}), so a sparse or
 * empty file changes nothing.
 */
export type BalanceConfig = {
  /* Mission success formula */
  /** Flat +% per status_positive trait occurrence on participants. */
  statusPositiveBonus: number;
  /** Flat −% per status_negative trait occurrence on participants (stored positive). */
  statusNegativePenalty: number;
  /**
   * Flat −% per *distinct* challenge trait contributed by opposing agents at the mission's
   * target site that no participant matches (stored positive).
   */
  agentChallengeTraitPenalty: number;
  dynamicTraitModifiers: DynamicTraitModifiers;
  minionAffinity: MinionAffinityConfig;
  locationAffinity: LocationAffinityConfig;
  /* Infamy, heat & risk */
  /** Infamy change on mission success (typically positive — the reputation the player builds). */
  infamySuccessDelta: number;
  /** Infamy change on mission failure (typically 0). */
  infamyFailureDelta: number;
  /** Heat change on mission success (typically 0 — clean jobs draw no attention). */
  heatSuccessDelta: number;
  /** Heat change on mission failure (typically positive; drives the wanted level). */
  heatFailureDelta: number;
  /**
   * Extra heat when a mission fails at a site held by an agent with the **Investigator**
   * ability. Applied once per failed mission, however many Investigators are standing there.
   */
  agentInvestigatorFailureHeat: number;
  /* Turn economy */
  startingMaxCommandPoints: number;
  rerollHireOffersCp: number;
  /* Roster & missions */
  startingMaxRosterSize: number;
  startingMaxHireOffers: number;
  startingMaxConcurrentMissions: number;
  startingMaxParticipantsPerMission: number;
  /**
   * Support asset slots a mission opens with at the start of a run. Lair upgrades raise it via
   * `max_support_assets_delta`. `0` turns the whole support-asset system off for a run.
   */
  startingMaxSupportAssets: number;
  /** Fixed participant cap for event missions (ignores the player's normal cap). */
  eventMaxParticipants: number;
  /**
   * Turns with no event offer after one leaves the slot (expired, resolved, or cancelled),
   * rolled uniformly in `[eventCooldownTurnsMin, eventCooldownTurnsMax]`. `0` means the next
   * offer appears immediately at that same resolve.
   */
  eventCooldownTurnsMin: number;
  eventCooldownTurnsMax: number;
  /**
   * Turn number the **first** global event offer of a run appears on (≥ 1). The run opens with
   * `firstEventTurn - 1` quiet turns on the event slot; `1` puts an offer on the table at turn 1.
   */
  firstEventTurn: number;
  /** Turns before a fired minion reappears in the hire pool. */
  fireRehireCooldownTurns: number;
  /* Progression */
  minionXpPerMission: number;
  minionXpToLevel: number;
  /**
   * Infamy needed for the hire pool to start offering each `startingLevel` above 1, ascending.
   * `[15, 35, 60, 85]` means level 2 unlocks at 15 infamy, level 3 at 35, and so on; level 1 is
   * always on offer. A template whose `startingLevel` exceeds `1 + length` can never be drawn.
   */
  hireLevelInfamyThresholds: number[];
  /* World generation & security */
  assetsPerLocationMin: number;
  assetsPerLocationMax: number;
  /** Playable sites that start at intel 1 (asset slots listed, contents unknown). */
  initialIntelSitesAtOne: number;
  /** Further playable sites that start at intel 2 (asset contents identified); distinct from the above. */
  initialIntelSitesAtTwo: number;
  /** Security added at the target location when a mission resolves there. */
  securityGainPerResolvedMission: number;
};

/** Pre-balance-slice values; the single source for schema defaults and code fallbacks. */
export const DEFAULT_BALANCE: BalanceConfig = {
  statusPositiveBonus: 10,
  statusNegativePenalty: 20,
  agentChallengeTraitPenalty: 20,
  dynamicTraitModifiers: {
    friend: 5,
    ally: 10,
    rival: -5,
    hatred: -10,
    hero: 5,
    wanted: -5,
  },
  minionAffinity: {
    friendThreshold: 3,
    allyThreshold: 7,
    rivalThreshold: -3,
    hatedThreshold: -7,
    hysteresis: 2,
    missionSuccess: 1,
    missionFailure: -1,
    eventSuccess: 2,
    eventFailure: -2,
    omegaSuccess: 2,
    omegaFailure: -2,
    lairRaidSuccess: 3,
    lairRaidFailure: 0,
  },
  locationAffinity: {
    heroThreshold: 3,
    wantedThreshold: -3,
    hysteresis: 2,
    missionSuccess: 1,
    missionFailure: -1,
  },
  infamySuccessDelta: 5,
  infamyFailureDelta: 0,
  heatSuccessDelta: 0,
  heatFailureDelta: 5,
  agentInvestigatorFailureHeat: 5,
  startingMaxCommandPoints: 5,
  rerollHireOffersCp: 1,
  startingMaxRosterSize: 5,
  startingMaxHireOffers: 3,
  startingMaxConcurrentMissions: 2,
  startingMaxParticipantsPerMission: 3,
  startingMaxSupportAssets: 1,
  eventMaxParticipants: 3,
  eventCooldownTurnsMin: 0,
  eventCooldownTurnsMax: 3,
  firstEventTurn: 3,
  fireRehireCooldownTurns: 3,
  minionXpPerMission: 1,
  minionXpToLevel: 3,
  hireLevelInfamyThresholds: [15, 35, 60, 85],
  assetsPerLocationMin: 1,
  assetsPerLocationMax: 3,
  initialIntelSitesAtOne: 2,
  initialIntelSitesAtTwo: 1,
  securityGainPerResolvedMission: 1,
};

export type ContentCatalog = {
  traits: Trait[];
  minions: MinionTemplate[];
  /** Opposing operatives (catalog only until opposition gameplay exists). */
  agents: AgentTemplate[];
  missions: MissionTemplate[];
  locations: LocationTemplate[];
  maps: MapTemplate[];
  assets: Asset[];
  omegaPlans: OmegaPlanTemplate[];
  lairs: LairTemplate[];
  /** Rotating global event mission templates (`content/events.json`). */
  events: EventTemplate[];
  /** Display names for the player's evil organization; one chosen per run. */
  organizationNames: string[];
  /** Player mastermind profiles; one chosen per run for name + portrait. */
  playerProfiles: PlayerProfile[];
  /** Ordered wanted tiers (ascending `minHeat`); drives max opposing agents cap. */
  wantedLevels: WantedLevelTier[];
  /** Designer-tunable gameplay knobs (`content/balance.json`); defaults preserve legacy values. */
  balance: BalanceConfig;
};
