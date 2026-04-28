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

export type LocationTemplate = {
  id: string;
  name: string;
  description: string;
  availableMissionIds: string[];
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
