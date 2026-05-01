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
  startingTraitIds?: string[];
  levelUpTraitOrder: string[];
};

export type MinionInstance = {
  templateId: string;
  currentLevel: number;
  currentExperience: number;
  traitIds: string[];
};

export type MissionTemplate = {
  id: string;
  name: string;
  description: string;
  requiredTraitIds: string[];
  durationTurns: number;
};

/** Visibility of an asset at a location for the player (kind known only when revealed). */
export type LocationAssetVisibility = "hidden" | "revealed";

/**
 * One asset position at a location. `assetId` may be omitted for slots filled at game start
 * (e.g. pseudo-random allocation); when set, it must reference the asset catalog.
 */
export type LocationAssetSlot = {
  assetId?: string;
  initialState: LocationAssetVisibility;
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
  assetSlots: LocationAssetSlot[];
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
  stages: [OmegaPlanStage, OmegaPlanStage, OmegaPlanStage];
};

export type ContentCatalog = {
  traits: Trait[];
  minions: MinionTemplate[];
  missions: MissionTemplate[];
  locations: LocationTemplate[];
  maps: MapTemplate[];
  assets: Asset[];
  omegaPlans: OmegaPlanTemplate[];
};
