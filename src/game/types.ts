export type TraitType = "status" | "primary" | "secondary";

export type Trait = {
  id: string;
  name: string;
  type: TraitType;
};

export type MinionTemplate = {
  id: string;
  name: string;
  description: string;
  /** CP cost to hire during the Main Phase. */
  hireCommandPoints: number;
  startingTraitIds?: string[];
  levelUpTraitOrder: string[];
  /**
   * Level at hire (`currentLevel`). Defaults to **1** when omitted in JSON.
   * Traits from `levelUpTraitOrder` are granted by applying level-ups until this level is reached.
   */
  startingLevel?: number;
};

export type MinionInstance = {
  /** Stable id for this hire for mission assignment and catalogs. */
  instanceId: string;
  templateId: string;
  currentLevel: number;
  currentExperience: number;
  traitIds: string[];
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
  /**
   * Grants the listed trait ids to the minion identified by the active mission's `target`
   * (which must be `kind: "minion"`). Existing traits on that minion are not duplicated.
   * Requires mission `targetType: "minion"`.
   */
  | { kind: "add_target_minion_traits"; traitIds: string[] }
  | { kind: "infamy_delta"; amount: number }
  | { kind: "max_concurrent_missions_delta"; delta: number }
  | { kind: "max_roster_size_delta"; delta: number }
  | { kind: "max_hire_offers_delta"; delta: number }
  | { kind: "max_participants_per_mission_delta"; delta: number }
  | { kind: "max_command_points_per_turn_delta"; delta: number };

export type MissionTemplate = {
  id: string;
  name: string;
  description: string;
  /** CP spent when starting this mission (Main Phase). */
  startCommandPoints: number;
  requiredTraitIds: string[];
  /**
   * Catalog asset ids required for full success; duplicates mean multiple units needed.
   * At least one of `requiredTraitIds` or `requiredAssetIds` must be non-empty.
   */
  requiredAssetIds: string[];
  durationTurns: number;
  /** What the player must pick in the target planning slot (if any). */
  targetType: MissionTargetType;
  /** Applied in order when the mission resolves successfully (after baseline infamy). */
  onSuccessEffects?: MissionEffect[];
  /** Applied in order when the mission resolves as a failure (after baseline infamy). */
  onFailureEffects?: MissionEffect[];
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

/** Designer-authored category for a location. */
export type LocationType = "political" | "military" | "economic";

export type LocationTemplate = {
  id: string;
  name: string;
  description: string;
  /** Political, Military, or Economic (designer). */
  locationType: LocationType;
  /** Designer difficulty or importance tier, 1–3. */
  locationLevel: 1 | 2 | 3;
};

/** Where an active mission was started from (lair pool vs current Omega row). */
export type MissionSource = "lair" | "omega";

/**
 * Per-run security at a location (not in catalog JSON). Updated by gameplay systems.
 */
export type LocationSecurityState = {
  locationId: string;
  /** Rises after missions resolve at this site; new runs start at 0, capped at 3. */
  securityLevel: 0 | 1 | 2 | 3;
};

export type MapTemplate = {
  id: string;
  name: string;
  description: string;
  locationIds: string[];
};

export type Asset = {
  id: string;
  name: string;
  description?: string;
};

export type OmegaPlanStage = {
  missionIds: [string, string, string];
};

export type OmegaPlanTemplate = {
  id: string;
  name: string;
  description: string;
  /** Map (`MapTemplate.id`) whose locations are playable for this plan. */
  mapId: string;
  stages: [OmegaPlanStage, OmegaPlanStage, OmegaPlanStage];
};

/** Designer-authored home base; one chosen per run. */
export type LairTemplate = {
  id: string;
  name: string;
  description?: string;
  /** Mission templates the player may assign while at the lair (runtime pool starts as a copy). */
  availableMissionIds: string[];
  /**
   * One-time upgrade missions (disjoint from `availableMissionIds`). Shown in Lair Upgrades tab
   * until completed successfully once this run.
   */
  upgradeMissionIds: string[];
  /** Optional starting `Asset.id` quantities merged into `player.assets` at run start. */
  startingAssets?: Record<string, number>;
};

export type ContentCatalog = {
  traits: Trait[];
  minions: MinionTemplate[];
  missions: MissionTemplate[];
  locations: LocationTemplate[];
  maps: MapTemplate[];
  assets: Asset[];
  omegaPlans: OmegaPlanTemplate[];
  lairs: LairTemplate[];
  /** Display names for the player's evil organization; one chosen per run. */
  organizationNames: string[];
};
