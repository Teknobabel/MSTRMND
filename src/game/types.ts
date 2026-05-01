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
};

export type MinionInstance = {
  /** Stable id for this hire for mission assignment and catalogs. */
  instanceId: string;
  templateId: string;
  currentLevel: number;
  currentExperience: number;
  traitIds: string[];
};

export type MissionTemplate = {
  id: string;
  name: string;
  description: string;
  /** CP spent when starting this mission (Main Phase). */
  startCommandPoints: number;
  requiredTraitIds: string[];
  durationTurns: number;
};

/** Visibility of an asset at a location for the player (kind known only when revealed). */
export type LocationAssetVisibility = "hidden" | "revealed";

/**
 * One asset slot at a location at runtime (not authored in `locations.json`).
 * Assigned when a run starts; `assetId` references the asset catalog.
 */
export type LocationAssetSlot = {
  assetId: string;
  visibility: LocationAssetVisibility;
};

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
  availableMissionIds: string[];
};

/**
 * Per-run security at a location (not in catalog JSON). Updated by gameplay systems.
 */
export type LocationSecurityState = {
  locationId: string;
  securityLevel: 1 | 2 | 3;
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
