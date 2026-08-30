import { z } from "zod";
import type {
  AgentTemplate,
  Asset,
  BalanceConfig,
  ContentCatalog,
  EventTemplate,
  LairTemplate,
  IntelLevel,
  LairUpgradeLevel,
  LocationLevel,
  LocationTemplate,
  LocationType,
  MapMarker,
  MapTemplate,
  MinionTemplate,
  MissionEffect,
  MissionTemplate,
  MissionTargetType,
  OmegaPlanStage,
  OmegaPlanTemplate,
  SecurityLevel,
  PlayerProfile,
  StartingDynamicTrait,
  SupportAssetAbility,
  Trait,
  WantedLevelTier,
} from "./types";
import { AGENT_ABILITY_IDS, AGENT_MOVEMENT_BEHAVIORS, DEFAULT_BALANCE } from "./types";
import { OMEGA_MISSIONS_PER_STAGE } from "./omegaPlan";
import { missionTargetTypeTargetsLocation } from "./mission";

/* ------------------------------------------------------------------------------------------------
 * Content manifest — the single source of truth for which slices exist and where they live.
 * `loadContent`, `scripts/validate-content.ts`, and content tooling all consume this.
 * ---------------------------------------------------------------------------------------------- */

export const CONTENT_SLICE_KEYS = [
  "traits",
  "minions",
  "agents",
  "missions",
  "locations",
  "maps",
  "assets",
  "omegaPlans",
  "lairs",
  "events",
  "organizationNames",
  "playerProfiles",
  "wantedLevels",
  "balance",
] as const;

export type ContentSliceKey = (typeof CONTENT_SLICE_KEYS)[number];

export type ContentManifestEntry = {
  key: ContentSliceKey;
  /** Path relative to the repo root. */
  fileName: string;
};

export const CONTENT_MANIFEST: readonly ContentManifestEntry[] = CONTENT_SLICE_KEYS.map(
  (key) => ({ key, fileName: `content/${key}.json` }),
);

/** Raw (unparsed) JSON per slice, keyed by {@link ContentSliceKey}. */
export type RawContentSlices = Record<ContentSliceKey, unknown>;

/* ------------------------------------------------------------------------------------------------
 * Issues — every shape or cross-reference problem is reported as one of these.
 * ---------------------------------------------------------------------------------------------- */

export type ContentIssue = {
  slice: ContentSliceKey;
  /** Offending entity's `id` where determinable, else null (e.g. top-level shape errors). */
  entityId: string | null;
  /** Path within the slice/entity, e.g. `[3].requiredTraitIds[1]` or `upgradeMissionIds[0]`. */
  path: string;
  message: string;
};

/** Thrown by {@link parseCatalog} with every collected issue (not just the first). */
export class ContentValidationError extends Error {
  readonly issues: readonly ContentIssue[];

  constructor(issues: readonly ContentIssue[]) {
    const lines = issues.map(
      (i) => `- [${i.slice}] ${i.entityId ?? "(slice)"}${i.path ? ` ${i.path}` : ""}: ${i.message}`,
    );
    super(`Content validation failed with ${issues.length} issue(s):\n${lines.join("\n")}`);
    this.name = "ContentValidationError";
    this.issues = issues;
  }
}

function formatZodPath(path: readonly (string | number)[]): string {
  let out = "";
  for (const seg of path) {
    out += typeof seg === "number" ? `[${seg}]` : out === "" ? seg : `.${seg}`;
  }
  return out;
}

function entityIdAtIndex(raw: unknown, index: number): string | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const row: unknown = raw[index];
  if (row !== null && typeof row === "object" && "id" in row) {
    const id = (row as { id: unknown }).id;
    if (typeof id === "string" && id.length > 0) {
      return id;
    }
  }
  return null;
}

function zodErrorToIssues(
  slice: ContentSliceKey,
  raw: unknown,
  error: z.ZodError,
): ContentIssue[] {
  return error.issues.map((zi) => {
    const head = zi.path[0];
    const entityId = typeof head === "number" ? entityIdAtIndex(raw, head) : null;
    return {
      slice,
      entityId,
      path: formatZodPath(zi.path),
      message: zi.message,
    };
  });
}

/* ------------------------------------------------------------------------------------------------
 * Entity schemas (exported for tooling: validate one entity as it is edited).
 * Array-level rules (duplicate ids, ordering) and cross-slice references are NOT here;
 * they live in {@link collectContentIssues}.
 * ---------------------------------------------------------------------------------------------- */

const traitTypeSchema = z.enum(["status_positive", "status_negative", "primary", "secondary"]);

export const traitSchema: z.ZodType<Trait> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: traitTypeSchema,
});

export const startingDynamicTraitSchema: z.ZodType<StartingDynamicTrait> = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("friend"),
      targetMinionTemplateId: z.string().min(1),
    }),
    z.object({
      kind: z.literal("ally"),
      targetMinionTemplateId: z.string().min(1),
    }),
    z.object({
      kind: z.literal("rival"),
      targetMinionTemplateId: z.string().min(1),
    }),
    z.object({
      kind: z.literal("hatred"),
      targetMinionTemplateId: z.string().min(1),
    }),
    z.object({
      kind: z.literal("hero"),
      locationId: z.string().min(1),
    }),
    z.object({
      kind: z.literal("wanted"),
      locationId: z.string().min(1),
    }),
  ],
);

export const minionTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  cardArt: z.string().min(1).optional(),
  hireCommandPoints: z.number().int().min(0),
  startingTraitIds: z.array(z.string().min(1)).optional(),
  levelUpTraitOrder: z.array(z.string().min(1)),
  startingLevel: z.coerce.number().int().min(1).max(99).optional(),
  startingDynamicTraits: z.array(startingDynamicTraitSchema).optional(),
});

/** Agents extend the minion template JSON shape with challenge traits + movement behavior. */
export const agentTemplateSchema = minionTemplateSchema.extend({
  challengeTraitIds: z.array(z.string().min(1)).default([]),
  /* Optional here, required by `collectContentIssues`: a half-authored agent should raise one
   * issue, not sink the whole slice while the designer is still typing. */
  movementBehavior: z.enum(AGENT_MOVEMENT_BEHAVIORS).optional(),
  /* Zero or more; array order is the agent's active-ability priority. */
  abilityIds: z.array(z.enum(AGENT_ABILITY_IDS)).default([]),
});

const missionTargetTypeSchema = z.enum([
  "location",
  "asset_hidden",
  "asset_revealed",
  "minion",
  "none",
]);

const deltaSchema = z.number().int().min(-50).max(50);

const locationLevelSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

/** The 0–3 range shared by per-run intel and security levels. */
const zeroToThreeLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

const locationTypeSchema = z.enum(["political", "military", "economic"]);

export const missionEffectSchema: z.ZodType<MissionEffect> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("reveal_target_asset") }),
  z.object({ kind: z.literal("reveal_all_hidden_assets_at_location") }),
  z.object({ kind: z.literal("steal_target_asset") }),
  z.object({ kind: z.literal("steal_all_assets_at_location") }),
  z.object({ kind: z.literal("steal_all_revealed_assets_at_location") }),
  z.object({
    kind: z.literal("unlock_lair_mission"),
    missionId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("gain_assets"),
    assetIds: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    kind: z.literal("exchange_assets"),
    removeAssetIds: z.array(z.string().min(1)),
    gainAssetIds: z.array(z.string().min(1)),
  }),
  z.object({
    kind: z.literal("security_level_delta"),
    delta: deltaSchema,
  }),
  z.object({
    kind: z.literal("intel_level_delta"),
    delta: deltaSchema,
  }),
  z.object({
    kind: z.literal("add_target_minion_traits"),
    traitIds: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    kind: z.literal("add_random_participant_traits"),
    traitIds: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    kind: z.literal("add_all_participant_traits"),
    traitIds: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    kind: z.literal("infamy_delta"),
    amount: z.number().int().min(-100).max(100),
  }),
  z.object({
    kind: z.literal("heat_delta"),
    amount: z.number().int().min(-100).max(100),
  }),
  z.object({
    kind: z.literal("max_concurrent_missions_delta"),
    delta: deltaSchema,
  }),
  z.object({
    kind: z.literal("max_roster_size_delta"),
    delta: deltaSchema,
  }),
  z.object({
    kind: z.literal("max_hire_offers_delta"),
    delta: deltaSchema,
  }),
  z.object({
    kind: z.literal("max_support_assets_delta"),
    delta: z.number().int().min(-50).max(50),
  }),
  z.object({
    kind: z.literal("max_participants_per_mission_delta"),
    delta: deltaSchema,
  }),
  z.object({
    kind: z.literal("max_command_points_per_turn_delta"),
    delta: deltaSchema,
  }),
  z.object({
    kind: z.literal("security_level_delta_global"),
    delta: deltaSchema,
  }),
  z.object({
    kind: z.literal("security_level_delta_by_location_type"),
    delta: deltaSchema,
    locationType: locationTypeSchema,
  }),
  z.object({
    kind: z.literal("security_level_delta_by_location_level"),
    delta: deltaSchema,
    locationLevel: locationLevelSchema,
  }),
  z.object({
    kind: z.literal("intel_level_delta_global"),
    delta: deltaSchema,
  }),
  z.object({
    kind: z.literal("intel_level_delta_by_location_type"),
    delta: deltaSchema,
    locationType: locationTypeSchema,
  }),
  z.object({
    kind: z.literal("intel_level_delta_by_location_level"),
    delta: deltaSchema,
    locationLevel: locationLevelSchema,
  }),
  z.object({
    kind: z.literal("remove_trait_from_all_minions"),
    traitId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("add_trait_to_random_minions"),
    traitId: z.string().min(1),
    count: z.number().int().min(1).max(99),
  }),
  z.object({
    kind: z.literal("reveal_hidden_assets_global"),
    count: z.number().int().min(0).max(99),
  }),
  z.object({
    kind: z.literal("reveal_hidden_assets_by_location_type"),
    count: z.number().int().min(0).max(99),
    locationType: locationTypeSchema,
  }),
  z.object({
    kind: z.literal("reveal_hidden_assets_by_location_level"),
    count: z.number().int().min(0).max(99),
    locationLevel: locationLevelSchema,
  }),
  z.object({
    kind: z.literal("grant_command_points_next_turn"),
    amount: z.number().int().min(1).max(99),
  }),
  z.object({
    kind: z.literal("add_success_chance_modifier"),
    delta: z.number().int().min(-100).max(100),
    turns: z.number().int().min(1).max(99),
  }),
]);

export const missionTemplateSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    cardArt: z.string().min(1).optional(),
    targetType: missionTargetTypeSchema,
    /** Optional site filters; only meaningful for a location-resolving `targetType`. */
    targetLocationTypes: z.array(locationTypeSchema).optional(),
    targetLocationLevels: z.array(locationLevelSchema).optional(),
    targetLocationIntelLevels: z.array(zeroToThreeLevelSchema).optional(),
    targetLocationSecurityLevels: z.array(zeroToThreeLevelSchema).optional(),
    startCommandPoints: z.coerce.number().int().min(0),
    requiredTraitIds: z.array(z.string().min(1)).default([]),
    requiredAssetIds: z.array(z.string().min(1)).default([]),
    durationTurns: z.coerce.number().int().min(1),
    /** Designer-only: in every run's lair mission pool from turn 1 (see `MissionTemplate.coreMission`). */
    coreMission: z.boolean().optional(),
    onSuccessEffects: z.array(missionEffectSchema).optional(),
    onFailureEffects: z.array(missionEffectSchema).optional(),
  })
  .superRefine((m, ctx) => {
    if (m.requiredTraitIds.length + m.requiredAssetIds.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Mission "${m.id}" must have at least one required trait or required asset`,
        path: ["requiredTraitIds"],
      });
    }
  });

/**
 * Events: mission shape + required `lifetimeTurns` + optional expire effects; requirements MAY
 * both be empty.
 */
export const eventTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  cardArt: z.string().min(1).optional(),
  targetType: missionTargetTypeSchema,
  /** Optional site filters; only meaningful for a location-resolving `targetType`. */
  targetLocationTypes: z.array(locationTypeSchema).optional(),
  targetLocationLevels: z.array(locationLevelSchema).optional(),
  targetLocationIntelLevels: z.array(zeroToThreeLevelSchema).optional(),
  targetLocationSecurityLevels: z.array(zeroToThreeLevelSchema).optional(),
  startCommandPoints: z.coerce.number().int().min(0),
  requiredTraitIds: z.array(z.string().min(1)).default([]),
  requiredAssetIds: z.array(z.string().min(1)).default([]),
  durationTurns: z.coerce.number().int().min(1),
  /** Turns the offer stays on the table before `onFailureEffects` fire (designer-set, ≥ 1). */
  lifetimeTurns: z.coerce.number().int().min(1).max(99),
  /** Optional draw-pool gates: the event is only offered once the player reaches these. */
  minInfamy: z.coerce.number().int().min(0).max(100).optional(),
  minHeat: z.coerce.number().int().min(0).max(100).optional(),
  onSuccessEffects: z.array(missionEffectSchema).optional(),
  onFailureEffects: z.array(missionEffectSchema).optional(),
  /** System-spawned event marker; kept out of the random draw pool (see `EventTemplate.special`). */
  special: z.literal("lair_raid").optional(),
});

export const locationTemplateSchema: z.ZodType<LocationTemplate> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  cardArt: z.string().min(1).optional(),
  locationType: locationTypeSchema,
  locationLevel: locationLevelSchema,
});

const mapMarkerSchema: z.ZodType<MapMarker> = z.object({
  locationId: z.string().min(1),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
});

export const mapTemplateSchema: z.ZodType<MapTemplate> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  locationIds: z.array(z.string().min(1)),
  mapArt: z.string().min(1).optional(),
  markers: z.array(mapMarkerSchema).optional(),
});

const omegaPlanStageSchema = z.object({
  missionIds: z.array(z.string().min(1)).length(3),
  /** Omitted means all three missions are required (pre-`requiredMissions` content). */
  requiredMissions: z.number().int().min(1).max(3).optional(),
});

export const omegaPlanTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  cardArt: z.string().min(1).optional(),
  mapId: z.string().min(1),
  stages: z.array(omegaPlanStageSchema).length(3),
  /** Victory copy shown when this plan's final phase clears; absent ⇒ generic fallback. */
  victoryTitle: z.string().min(1).optional(),
  victoryNarrative: z.array(z.string().min(1)).optional(),
});

/** What a support asset does on a mission (see {@link SupportAssetAbility}). */
export const supportAssetAbilitySchema: z.ZodType<SupportAssetAbility> = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("success_chance_bonus"),
      percent: z.number().int().min(-100).max(100),
    }),
    z.object({ kind: z.literal("prevent_security_increase") }),
    z.object({ kind: z.literal("prevent_heat_increase") }),
    z.object({ kind: z.literal("prevent_injuries") }),
    z.object({ kind: z.literal("ignore_agent_challenge_traits") }),
    z.object({ kind: z.literal("ignore_security_traits") }),
  ],
);

export const assetSchema: z.ZodType<Asset> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  cardArt: z.string().min(1).optional(),
  supportAbility: supportAssetAbilitySchema.optional(),
});

export const playerProfileSchema: z.ZodType<PlayerProfile> = z.object({
  name: z.string().min(1),
  profilePic: z.string().min(1),
});

export const wantedLevelTierSchema: z.ZodType<WantedLevelTier> = z.object({
  minHeat: z.number().int().min(0).max(100),
  name: z.string().min(1),
  maxAgents: z.number().int().min(0),
});

function balanceInt(min: number, max: number, def: number): z.ZodDefault<z.ZodNumber> {
  return z.number().int().min(min).max(max).default(def);
}

/**
 * `content/balance.json` — a single object, not an array. Every field defaults to the
 * legacy constant in {@link DEFAULT_BALANCE}, so `{}` is a valid file that changes nothing.
 */
export const balanceConfigSchema = z.object({
  statusPositiveBonus: balanceInt(0, 100, DEFAULT_BALANCE.statusPositiveBonus),
  statusNegativePenalty: balanceInt(0, 100, DEFAULT_BALANCE.statusNegativePenalty),
  agentChallengeTraitPenalty: balanceInt(0, 100, DEFAULT_BALANCE.agentChallengeTraitPenalty),
  compromisedBandPercent: balanceInt(0, 100, DEFAULT_BALANCE.compromisedBandPercent),
  dynamicTraitModifiers: z
    .object({
      friend: balanceInt(-100, 100, DEFAULT_BALANCE.dynamicTraitModifiers.friend),
      ally: balanceInt(-100, 100, DEFAULT_BALANCE.dynamicTraitModifiers.ally),
      rival: balanceInt(-100, 100, DEFAULT_BALANCE.dynamicTraitModifiers.rival),
      hatred: balanceInt(-100, 100, DEFAULT_BALANCE.dynamicTraitModifiers.hatred),
      hero: balanceInt(-100, 100, DEFAULT_BALANCE.dynamicTraitModifiers.hero),
      wanted: balanceInt(-100, 100, DEFAULT_BALANCE.dynamicTraitModifiers.wanted),
    })
    .default({ ...DEFAULT_BALANCE.dynamicTraitModifiers }),
  minionAffinity: z
    .object({
      friendThreshold: balanceInt(1, 100, DEFAULT_BALANCE.minionAffinity.friendThreshold),
      allyThreshold: balanceInt(1, 100, DEFAULT_BALANCE.minionAffinity.allyThreshold),
      rivalThreshold: balanceInt(-100, -1, DEFAULT_BALANCE.minionAffinity.rivalThreshold),
      hatedThreshold: balanceInt(-100, -1, DEFAULT_BALANCE.minionAffinity.hatedThreshold),
      hysteresis: balanceInt(0, 100, DEFAULT_BALANCE.minionAffinity.hysteresis),
      missionSuccess: balanceInt(-100, 100, DEFAULT_BALANCE.minionAffinity.missionSuccess),
      missionFailure: balanceInt(-100, 100, DEFAULT_BALANCE.minionAffinity.missionFailure),
      eventSuccess: balanceInt(-100, 100, DEFAULT_BALANCE.minionAffinity.eventSuccess),
      eventFailure: balanceInt(-100, 100, DEFAULT_BALANCE.minionAffinity.eventFailure),
      omegaSuccess: balanceInt(-100, 100, DEFAULT_BALANCE.minionAffinity.omegaSuccess),
      omegaFailure: balanceInt(-100, 100, DEFAULT_BALANCE.minionAffinity.omegaFailure),
      lairRaidSuccess: balanceInt(-100, 100, DEFAULT_BALANCE.minionAffinity.lairRaidSuccess),
      lairRaidFailure: balanceInt(-100, 100, DEFAULT_BALANCE.minionAffinity.lairRaidFailure),
    })
    .default({ ...DEFAULT_BALANCE.minionAffinity }),
  locationAffinity: z
    .object({
      heroThreshold: balanceInt(1, 100, DEFAULT_BALANCE.locationAffinity.heroThreshold),
      wantedThreshold: balanceInt(-100, -1, DEFAULT_BALANCE.locationAffinity.wantedThreshold),
      hysteresis: balanceInt(0, 100, DEFAULT_BALANCE.locationAffinity.hysteresis),
      missionSuccess: balanceInt(-100, 100, DEFAULT_BALANCE.locationAffinity.missionSuccess),
      missionFailure: balanceInt(-100, 100, DEFAULT_BALANCE.locationAffinity.missionFailure),
    })
    .default({ ...DEFAULT_BALANCE.locationAffinity }),
  agentInvestigatorFailureHeat: balanceInt(0, 100, DEFAULT_BALANCE.agentInvestigatorFailureHeat),
  startingMaxCommandPoints: balanceInt(1, 99, DEFAULT_BALANCE.startingMaxCommandPoints),
  rerollHireOffersCp: balanceInt(0, 99, DEFAULT_BALANCE.rerollHireOffersCp),
  startingMaxRosterSize: balanceInt(1, 99, DEFAULT_BALANCE.startingMaxRosterSize),
  startingMaxHireOffers: balanceInt(1, 99, DEFAULT_BALANCE.startingMaxHireOffers),
  startingMaxConcurrentMissions: balanceInt(1, 99, DEFAULT_BALANCE.startingMaxConcurrentMissions),
  startingMaxParticipantsPerMission: balanceInt(
    1,
    12,
    DEFAULT_BALANCE.startingMaxParticipantsPerMission,
  ),
  startingMaxSupportAssets: balanceInt(0, 12, DEFAULT_BALANCE.startingMaxSupportAssets),
  eventMaxParticipants: balanceInt(1, 12, DEFAULT_BALANCE.eventMaxParticipants),
  eventCooldownTurnsMin: balanceInt(0, 99, DEFAULT_BALANCE.eventCooldownTurnsMin),
  eventCooldownTurnsMax: balanceInt(0, 99, DEFAULT_BALANCE.eventCooldownTurnsMax),
  firstEventTurn: balanceInt(1, 99, DEFAULT_BALANCE.firstEventTurn),
  fireRehireCooldownTurns: balanceInt(0, 99, DEFAULT_BALANCE.fireRehireCooldownTurns),
  hireLevelInfamyThresholds: z
    .array(z.number().int().min(1).max(100))
    .max(20)
    .default([...DEFAULT_BALANCE.hireLevelInfamyThresholds]),
  minionXpPerMission: balanceInt(0, 99, DEFAULT_BALANCE.minionXpPerMission),
  minionXpToLevel: balanceInt(1, 99, DEFAULT_BALANCE.minionXpToLevel),
  assetsPerLocationMin: balanceInt(0, 10, DEFAULT_BALANCE.assetsPerLocationMin),
  assetsPerLocationMax: balanceInt(0, 10, DEFAULT_BALANCE.assetsPerLocationMax),
  initialIntelSitesAtOne: balanceInt(0, 99, DEFAULT_BALANCE.initialIntelSitesAtOne),
  initialIntelSitesAtTwo: balanceInt(0, 99, DEFAULT_BALANCE.initialIntelSitesAtTwo),
  securityGainPerResolvedMission: balanceInt(
    0,
    3,
    DEFAULT_BALANCE.securityGainPerResolvedMission,
  ),
});

/** One mutually exclusive upgrade tier on a lair. */
export const lairUpgradeLevelSchema = z.object({
  name: z.string().min(1).optional(),
  /** Infamy needed to start this level's missions (gates unlocking, not visibility). */
  minInfamy: z.coerce.number().int().min(0).max(100).optional(),
  missionIds: z.array(z.string().min(1)).min(1),
});

export const lairTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  cardArt: z.string().min(1).optional(),
  availableMissionIds: z.array(z.string().min(1)),
  upgradeLevels: z.array(lairUpgradeLevelSchema).default([]),
  /**
   * Legacy flat upgrade list (pre-upgrade-levels). Read only when `upgradeLevels` is absent /
   * empty, and migrated to one single-choice level per entry so no authored mission is lost;
   * the editor writes `upgradeLevels` from then on.
   */
  upgradeMissionIds: z.array(z.string().min(1)).optional(),
  startingAssets: z.record(z.string().min(1), z.number().int().min(1)).optional(),
});

/** Whole-file (array) schema per slice; shape only — semantic rules are in {@link collectContentIssues}. */
export const contentSliceSchemas = {
  traits: z.array(traitSchema),
  minions: z.array(minionTemplateSchema),
  agents: z.array(agentTemplateSchema),
  missions: z.array(missionTemplateSchema),
  locations: z.array(locationTemplateSchema),
  maps: z.array(mapTemplateSchema),
  assets: z.array(assetSchema),
  omegaPlans: z.array(omegaPlanTemplateSchema),
  lairs: z.array(lairTemplateSchema),
  events: z.array(eventTemplateSchema),
  organizationNames: z.array(z.string().min(1)).min(1),
  playerProfiles: z.array(playerProfileSchema).min(1),
  wantedLevels: z.array(wantedLevelTierSchema).min(1),
  balance: balanceConfigSchema,
} as const;

/* ------------------------------------------------------------------------------------------------
 * Shape phase: parse + normalize each slice independently.
 * ---------------------------------------------------------------------------------------------- */

function normalizeMinionLikeTemplates(
  arr: z.infer<typeof minionTemplateSchema>[],
): MinionTemplate[] {
  return arr.map((m) => {
    const base: MinionTemplate = {
      id: m.id,
      name: m.name,
      description: m.description,
      hireCommandPoints: m.hireCommandPoints,
      levelUpTraitOrder: [...m.levelUpTraitOrder],
      startingLevel: m.startingLevel ?? 1,
    };
    if (m.cardArt !== undefined) {
      base.cardArt = m.cardArt;
    }
    if (m.startingTraitIds !== undefined && m.startingTraitIds.length > 0) {
      base.startingTraitIds = [...m.startingTraitIds];
    }
    if (m.startingDynamicTraits !== undefined && m.startingDynamicTraits.length > 0) {
      base.startingDynamicTraits = [...m.startingDynamicTraits];
    }
    return base;
  });
}

function normalizeAgentTemplates(
  arr: z.infer<typeof agentTemplateSchema>[],
): AgentTemplate[] {
  const base = normalizeMinionLikeTemplates(arr);
  return base.map((m, i) => {
    const row = arr[i]!;
    const out: AgentTemplate = {
      ...m,
      challengeTraitIds: [...(row.challengeTraitIds ?? [])],
    };
    if (row.movementBehavior !== undefined) {
      out.movementBehavior = row.movementBehavior;
    }
    if (row.abilityIds !== undefined && row.abilityIds.length > 0) {
      out.abilityIds = [...row.abilityIds];
    }
    return out;
  });
}

/**
 * Copies the optional site filters onto a normalized template, dropping empty lists so an
 * unrestricted mission has no key at all (matches how the content files are authored).
 */
function applyTargetLocationFilters(
  base: MissionTemplate,
  row: {
    targetLocationTypes?: LocationType[];
    targetLocationLevels?: LocationLevel[];
    targetLocationIntelLevels?: IntelLevel[];
    targetLocationSecurityLevels?: SecurityLevel[];
  },
): void {
  if (row.targetLocationTypes !== undefined && row.targetLocationTypes.length > 0) {
    base.targetLocationTypes = [...row.targetLocationTypes];
  }
  if (row.targetLocationLevels !== undefined && row.targetLocationLevels.length > 0) {
    base.targetLocationLevels = [...row.targetLocationLevels];
  }
  if (row.targetLocationIntelLevels !== undefined && row.targetLocationIntelLevels.length > 0) {
    base.targetLocationIntelLevels = [...row.targetLocationIntelLevels];
  }
  if (
    row.targetLocationSecurityLevels !== undefined &&
    row.targetLocationSecurityLevels.length > 0
  ) {
    base.targetLocationSecurityLevels = [...row.targetLocationSecurityLevels];
  }
}

function normalizeMissionTemplates(
  arr: z.infer<typeof missionTemplateSchema>[],
): MissionTemplate[] {
  return arr.map((m) => {
    const base: MissionTemplate = {
      id: m.id,
      name: m.name,
      description: m.description,
      targetType: m.targetType,
      startCommandPoints: m.startCommandPoints,
      requiredTraitIds: [...m.requiredTraitIds],
      requiredAssetIds: [...m.requiredAssetIds],
      durationTurns: m.durationTurns,
    };
    if (m.coreMission === true) {
      base.coreMission = true;
    }
    applyTargetLocationFilters(base, m);
    if (m.cardArt !== undefined) {
      base.cardArt = m.cardArt;
    }
    if (m.onSuccessEffects !== undefined && m.onSuccessEffects.length > 0) {
      base.onSuccessEffects = [...m.onSuccessEffects];
    }
    if (m.onFailureEffects !== undefined && m.onFailureEffects.length > 0) {
      base.onFailureEffects = [...m.onFailureEffects];
    }
    return base;
  });
}

function normalizeEventTemplates(arr: z.infer<typeof eventTemplateSchema>[]): EventTemplate[] {
  return arr.map((m) => {
    const base: EventTemplate = {
      id: m.id,
      name: m.name,
      description: m.description,
      targetType: m.targetType,
      startCommandPoints: m.startCommandPoints,
      requiredTraitIds: [...m.requiredTraitIds],
      requiredAssetIds: [...m.requiredAssetIds],
      durationTurns: m.durationTurns,
      lifetimeTurns: m.lifetimeTurns,
    };
    applyTargetLocationFilters(base, m);
    if (m.minInfamy !== undefined && m.minInfamy > 0) {
      base.minInfamy = m.minInfamy;
    }
    if (m.minHeat !== undefined && m.minHeat > 0) {
      base.minHeat = m.minHeat;
    }
    if (m.cardArt !== undefined) {
      base.cardArt = m.cardArt;
    }
    if (m.onSuccessEffects !== undefined && m.onSuccessEffects.length > 0) {
      base.onSuccessEffects = [...m.onSuccessEffects];
    }
    if (m.onFailureEffects !== undefined && m.onFailureEffects.length > 0) {
      base.onFailureEffects = [...m.onFailureEffects];
    }
    if (m.special !== undefined) {
      base.special = m.special;
    }
    return base;
  });
}

function assertOmegaPlanStages(
  stages: z.infer<typeof omegaPlanStageSchema>[],
): [OmegaPlanStage, OmegaPlanStage, OmegaPlanStage] {
  const tuple = (i: number): OmegaPlanStage => {
    const s = stages[i]!;
    return {
      missionIds: [s.missionIds[0]!, s.missionIds[1]!, s.missionIds[2]!],
      requiredMissions: s.requiredMissions ?? OMEGA_MISSIONS_PER_STAGE,
    };
  };
  return [tuple(0), tuple(1), tuple(2)];
}

function normalizeOmegaPlans(
  arr: z.infer<typeof omegaPlanTemplateSchema>[],
): OmegaPlanTemplate[] {
  return arr.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    ...(p.cardArt !== undefined ? { cardArt: p.cardArt } : {}),
    mapId: p.mapId,
    stages: assertOmegaPlanStages(p.stages),
    ...(p.victoryTitle !== undefined ? { victoryTitle: p.victoryTitle } : {}),
    ...(p.victoryNarrative !== undefined && p.victoryNarrative.length > 0
      ? { victoryNarrative: [...p.victoryNarrative] }
      : {}),
  }));
}

function normalizeLairs(arr: z.infer<typeof lairTemplateSchema>[]): LairTemplate[] {
  return arr.map((l) => ({
    id: l.id,
    name: l.name,
    ...(l.description !== undefined ? { description: l.description } : {}),
    ...(l.cardArt !== undefined ? { cardArt: l.cardArt } : {}),
    availableMissionIds: [...l.availableMissionIds],
    upgradeLevels: normalizeLairUpgradeLevels(l),
    ...(l.startingAssets !== undefined ? { startingAssets: { ...l.startingAssets } } : {}),
  }));
}

/** `upgradeLevels` when authored, else one single-choice level per legacy `upgradeMissionIds` entry. */
function normalizeLairUpgradeLevels(
  l: z.infer<typeof lairTemplateSchema>,
): LairUpgradeLevel[] {
  if (l.upgradeLevels.length > 0) {
    return l.upgradeLevels.map((lvl) => ({
      ...(lvl.name !== undefined ? { name: lvl.name } : {}),
      ...(lvl.minInfamy !== undefined && lvl.minInfamy > 0 ? { minInfamy: lvl.minInfamy } : {}),
      missionIds: [...lvl.missionIds],
    }));
  }
  return (l.upgradeMissionIds ?? []).map((mid) => ({ missionIds: [mid] }));
}

/** Every slice parsed, or null where its shape failed (issues carry the details). */
export type ParsedContentSlices = {
  [K in ContentSliceKey]: ContentCatalog[K] | null;
};

/**
 * Shape-parse and normalize every slice independently. Never throws; a slice that fails
 * shape validation is null in the result and its problems are in `issues`.
 */
export function parseContentSlices(raw: RawContentSlices): {
  slices: ParsedContentSlices;
  issues: ContentIssue[];
} {
  const issues: ContentIssue[] = [];

  function shape<K extends ContentSliceKey, T>(
    key: K,
    normalize: (data: z.infer<(typeof contentSliceSchemas)[K]>) => T,
  ): T | null {
    const parsed = contentSliceSchemas[key].safeParse(raw[key]);
    if (!parsed.success) {
      issues.push(...zodErrorToIssues(key, raw[key], parsed.error));
      return null;
    }
    return normalize(parsed.data as z.infer<(typeof contentSliceSchemas)[K]>);
  }

  const slices: ParsedContentSlices = {
    traits: shape("traits", (d) => d as Trait[]),
    minions: shape("minions", normalizeMinionLikeTemplates),
    agents: shape("agents", normalizeAgentTemplates),
    missions: shape("missions", normalizeMissionTemplates),
    locations: shape("locations", (d) => d as LocationTemplate[]),
    maps: shape("maps", (d) => d as MapTemplate[]),
    assets: shape("assets", (d) => d as Asset[]),
    omegaPlans: shape("omegaPlans", normalizeOmegaPlans),
    lairs: shape("lairs", normalizeLairs),
    events: shape("events", normalizeEventTemplates),
    organizationNames: shape("organizationNames", (d) => d as string[]),
    playerProfiles: shape("playerProfiles", (d) => d as PlayerProfile[]),
    wantedLevels: shape("wantedLevels", (d) => d as WantedLevelTier[]),
    balance: shape("balance", (d) => d as BalanceConfig),
  };

  return { slices, issues };
}

/* ------------------------------------------------------------------------------------------------
 * Semantic phase: array-level rules and cross-slice references.
 * Checks that depend on a slice that failed shape parsing (null) are skipped — the shape
 * issues already explain why.
 * ---------------------------------------------------------------------------------------------- */

function pushDuplicateIdIssues(
  slice: ContentSliceKey,
  rows: readonly { id: string }[],
  issues: ContentIssue[],
): void {
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i += 1) {
    const { id } = rows[i]!;
    if (seen.has(id)) {
      issues.push({
        slice,
        entityId: id,
        path: `[${i}].id`,
        message: `Duplicate ${slice} id: ${id}`,
      });
    }
    seen.add(id);
  }
}

function checkMinionLikeTraitRefs(
  slice: "minions" | "agents",
  templates: readonly MinionTemplate[],
  traitIds: ReadonlySet<string>,
  issues: ContentIssue[],
): void {
  for (const m of templates) {
    (m.startingTraitIds ?? []).forEach((tid, i) => {
      if (!traitIds.has(tid)) {
        issues.push({
          slice,
          entityId: m.id,
          path: `startingTraitIds[${i}]`,
          message: `Unknown trait id "${tid}"`,
        });
      }
    });
    m.levelUpTraitOrder.forEach((tid, i) => {
      if (!traitIds.has(tid)) {
        issues.push({
          slice,
          entityId: m.id,
          path: `levelUpTraitOrder[${i}]`,
          message: `Unknown trait id "${tid}"`,
        });
      }
    });
  }
}

/**
 * Challenge traits are optional — an agent may carry none, and simply poses no trait challenge.
 * What it lists must be real trait ids, each named once.
 */
function checkAgentChallengeTraits(
  templates: readonly AgentTemplate[],
  traitIds: ReadonlySet<string>,
  issues: ContentIssue[],
): void {
  for (const a of templates) {
    const list = a.challengeTraitIds ?? [];
    const seen = new Set<string>();
    list.forEach((tid, i) => {
      if (!traitIds.has(tid)) {
        issues.push({
          slice: "agents",
          entityId: a.id,
          path: `challengeTraitIds[${i}]`,
          message: `Unknown trait id "${tid}"`,
        });
      }
      if (seen.has(tid)) {
        issues.push({
          slice: "agents",
          entityId: a.id,
          path: `challengeTraitIds[${i}]`,
          message: `Duplicate challenge trait "${tid}"`,
        });
      }
      seen.add(tid);
    });
  }
}

function checkStartingDynamicTraits(
  slice: "minions" | "agents",
  templates: readonly MinionTemplate[],
  minionTemplateIds: ReadonlySet<string>,
  locationIds: ReadonlySet<string>,
  issues: ContentIssue[],
): void {
  for (const m of templates) {
    const list = m.startingDynamicTraits;
    if (list === undefined || list.length === 0) {
      continue;
    }
    const seenKeys = new Set<string>();
    const positiveMinionTargets = new Set<string>();
    const negativeMinionTargets = new Set<string>();
    const heroLocations = new Set<string>();
    const wantedLocations = new Set<string>();

    for (let i = 0; i < list.length; i += 1) {
      const dt = list[i]!;
      const path = `startingDynamicTraits[${i}]`;
      if ("targetMinionTemplateId" in dt) {
        if (!minionTemplateIds.has(dt.targetMinionTemplateId)) {
          issues.push({
            slice,
            entityId: m.id,
            path,
            message: `Unknown minion template id "${dt.targetMinionTemplateId}"`,
          });
        }
        if (dt.targetMinionTemplateId === m.id) {
          issues.push({
            slice,
            entityId: m.id,
            path,
            message: "startingDynamicTraits cannot target self",
          });
        }
        const key = `${dt.kind}:${dt.targetMinionTemplateId}`;
        if (seenKeys.has(key)) {
          issues.push({
            slice,
            entityId: m.id,
            path,
            message: `Duplicate startingDynamicTraits entry "${key}"`,
          });
        }
        seenKeys.add(key);
        const t = dt.targetMinionTemplateId;
        if (dt.kind === "friend" || dt.kind === "ally") {
          if (negativeMinionTargets.has(t)) {
            issues.push({
              slice,
              entityId: m.id,
              path,
              message: `Conflict: positive and negative bond toward the same minion template "${t}"`,
            });
          }
          if (positiveMinionTargets.has(t)) {
            issues.push({
              slice,
              entityId: m.id,
              path,
              message: `Multiple positive bonds toward "${t}" (at most one friend or ally per target)`,
            });
          }
          positiveMinionTargets.add(t);
        } else {
          if (positiveMinionTargets.has(t)) {
            issues.push({
              slice,
              entityId: m.id,
              path,
              message: `Conflict: positive and negative bond toward the same minion template "${t}"`,
            });
          }
          if (negativeMinionTargets.has(t)) {
            issues.push({
              slice,
              entityId: m.id,
              path,
              message: `Multiple negative bonds toward "${t}" (at most one rival or hatred per target)`,
            });
          }
          negativeMinionTargets.add(t);
        }
      } else {
        if (!locationIds.has(dt.locationId)) {
          issues.push({
            slice,
            entityId: m.id,
            path,
            message: `Unknown location id "${dt.locationId}"`,
          });
        }
        const key = `${dt.kind}:${dt.locationId}`;
        if (seenKeys.has(key)) {
          issues.push({
            slice,
            entityId: m.id,
            path,
            message: `Duplicate startingDynamicTraits entry "${key}"`,
          });
        }
        seenKeys.add(key);
        if (dt.kind === "hero") {
          if (wantedLocations.has(dt.locationId)) {
            issues.push({
              slice,
              entityId: m.id,
              path,
              message: `Conflict: both hero and wanted for location "${dt.locationId}"`,
            });
          }
          heroLocations.add(dt.locationId);
        } else {
          if (heroLocations.has(dt.locationId)) {
            issues.push({
              slice,
              entityId: m.id,
              path,
              message: `Conflict: both hero and wanted for location "${dt.locationId}"`,
            });
          }
          wantedLocations.add(dt.locationId);
        }
      }
    }
  }
}

/** Effect kinds that require an asset-slot mission target. */
const ASSET_TARGET_ONLY_EFFECT_KINDS: ReadonlySet<MissionEffect["kind"]> = new Set([
  "reveal_target_asset",
  "steal_target_asset",
]);
/** Effect kinds that require a location-backed mission target (location or asset slot). */
const LOCATION_BACKED_EFFECT_KINDS: ReadonlySet<MissionEffect["kind"]> = new Set([
  "reveal_all_hidden_assets_at_location",
  "steal_all_assets_at_location",
  "steal_all_revealed_assets_at_location",
  "security_level_delta",
  "intel_level_delta",
]);
/** Effect kinds that require a minion mission target. */
const MINION_TARGET_ONLY_EFFECT_KINDS: ReadonlySet<MissionEffect["kind"]> = new Set([
  "add_target_minion_traits",
]);

/**
 * Placement rule for one effect kind against a template's `targetType`. Single source of
 * truth for {@link collectContentIssues} and for tooling (e.g. greying out incompatible
 * kinds in a content editor). Returns the requirement description when disallowed.
 */
export function effectKindTargetTypeRequirement(
  kind: MissionEffect["kind"],
  targetType: MissionTargetType,
): string | null {
  if (ASSET_TARGET_ONLY_EFFECT_KINDS.has(kind)) {
    return targetType === "asset_hidden" || targetType === "asset_revealed"
      ? null
      : "asset_hidden or asset_revealed";
  }
  if (LOCATION_BACKED_EFFECT_KINDS.has(kind)) {
    return targetType === "location" ||
      targetType === "asset_hidden" ||
      targetType === "asset_revealed"
      ? null
      : "location, asset_hidden, or asset_revealed";
  }
  if (MINION_TARGET_ONLY_EFFECT_KINDS.has(kind)) {
    return targetType === "minion" ? null : "minion";
  }
  return null;
}

/** Effect placement rules + effect-level refs. Shared by missions and events. */
/**
 * Site filters (`targetLocationTypes` / `targetLocationLevels`) only bite on a target that
 * resolves to a location, so a filter on a `minion` / `none` mission is dead authoring.
 * Duplicates are flagged too — harmless at runtime, but always a mistake in the file.
 */
function checkTargetLocationFilters(
  slice: ContentSliceKey,
  entityId: string,
  template: {
    targetType: MissionTargetType;
    targetLocationTypes?: LocationType[];
    targetLocationLevels?: LocationLevel[];
    targetLocationIntelLevels?: IntelLevel[];
    targetLocationSecurityLevels?: SecurityLevel[];
  },
  issues: ContentIssue[],
): void {
  const targetsLocation = missionTargetTypeTargetsLocation(template.targetType);
  type FilterValue = LocationType | LocationLevel | IntelLevel | SecurityLevel;
  const fields: Array<{ path: string; values: FilterValue[] | undefined }> = [
    { path: "targetLocationTypes", values: template.targetLocationTypes },
    { path: "targetLocationLevels", values: template.targetLocationLevels },
    { path: "targetLocationIntelLevels", values: template.targetLocationIntelLevels },
    { path: "targetLocationSecurityLevels", values: template.targetLocationSecurityLevels },
  ];
  for (const { path, values } of fields) {
    if (values === undefined || values.length === 0) {
      continue;
    }
    if (!targetsLocation) {
      issues.push({
        slice,
        entityId,
        path,
        message: `${path} needs a location-resolving targetType (got "${template.targetType}")`,
      });
    }
    const seen = new Set<FilterValue>();
    values.forEach((v, i) => {
      if (seen.has(v)) {
        issues.push({
          slice,
          entityId,
          path: `${path}[${i}]`,
          message: `Duplicate ${path} entry "${v}"`,
        });
      }
      seen.add(v);
    });
  }
}

function checkMissionEffects(
  slice: "missions" | "events",
  templateId: string,
  targetType: MissionTargetType,
  effects: readonly MissionEffect[],
  pathPrefix: string,
  catalogMissionIdSet: ReadonlySet<string>,
  /** Missions owned by a lair upgrade ladder; `null` when the lairs slice failed to parse. */
  upgradeLadderMissionIds: ReadonlySet<string> | null,
  traitIds: ReadonlySet<string>,
  assetIds: ReadonlySet<string>,
  issues: ContentIssue[],
): void {
  for (let ei = 0; ei < effects.length; ei += 1) {
    const eff = effects[ei]!;
    const path = `${pathPrefix}[${ei}]`;
    if (eff.kind === "unlock_lair_mission" && !catalogMissionIdSet.has(eff.missionId)) {
      issues.push({
        slice,
        entityId: templateId,
        path,
        message: `Unknown mission id "${eff.missionId}" in unlock_lair_mission`,
      });
    }
    if (
      eff.kind === "unlock_lair_mission" &&
      upgradeLadderMissionIds !== null &&
      upgradeLadderMissionIds.has(eff.missionId)
    ) {
      issues.push({
        slice,
        entityId: templateId,
        path,
        message: `Mission id "${eff.missionId}" is a lair upgrade — it is earned through that lair's upgrade levels, not by unlock_lair_mission`,
      });
    }
    const requirement = effectKindTargetTypeRequirement(eff.kind, targetType);
    if (requirement !== null) {
      issues.push({
        slice,
        entityId: templateId,
        path,
        message: `Effect "${eff.kind}" requires targetType ${requirement} (got "${targetType}")`,
      });
    }
    if (
      eff.kind === "add_target_minion_traits" ||
      eff.kind === "add_random_participant_traits" ||
      eff.kind === "add_all_participant_traits"
    ) {
      const seenTrait = new Set<string>();
      for (const tid of eff.traitIds) {
        if (seenTrait.has(tid)) {
          issues.push({
            slice,
            entityId: templateId,
            path,
            message: `Duplicate trait id "${tid}" in ${eff.kind}`,
          });
        }
        seenTrait.add(tid);
        if (!traitIds.has(tid)) {
          issues.push({
            slice,
            entityId: templateId,
            path,
            message: `Unknown trait id "${tid}" in ${eff.kind}`,
          });
        }
      }
    }
    if (
      (eff.kind === "remove_trait_from_all_minions" ||
        eff.kind === "add_trait_to_random_minions") &&
      !traitIds.has(eff.traitId)
    ) {
      issues.push({
        slice,
        entityId: templateId,
        path,
        message: `Unknown trait id "${eff.traitId}" in ${eff.kind}`,
      });
    }
    if (eff.kind === "gain_assets") {
      for (const aid of eff.assetIds) {
        if (!assetIds.has(aid)) {
          issues.push({
            slice,
            entityId: templateId,
            path,
            message: `Unknown asset id "${aid}" in gain_assets`,
          });
        }
      }
    }
    if (eff.kind === "exchange_assets") {
      if (eff.removeAssetIds.length === 0 && eff.gainAssetIds.length === 0) {
        issues.push({
          slice,
          entityId: templateId,
          path,
          message: "exchange_assets must list at least one removeAssetIds or gainAssetIds entry",
        });
      }
      for (const aid of [...eff.removeAssetIds, ...eff.gainAssetIds]) {
        if (!assetIds.has(aid)) {
          issues.push({
            slice,
            entityId: templateId,
            path,
            message: `Unknown asset id "${aid}" in exchange_assets`,
          });
        }
      }
    }
  }
}

function checkUnlockForbidden(
  slice: "missions" | "events",
  templateId: string,
  effects: readonly MissionEffect[] | undefined,
  pathPrefix: string,
  issues: ContentIssue[],
): void {
  (effects ?? []).forEach((eff, ei) => {
    if (eff.kind === "unlock_lair_mission") {
      issues.push({
        slice,
        entityId: templateId,
        path: `${pathPrefix}[${ei}]`,
        message: `unlock_lair_mission is not allowed in ${pathPrefix} (success only)`,
      });
    }
  });
}

/**
 * All semantic (array-level + cross-slice) rules. Accepts partially parsed slices: checks
 * whose inputs are null are skipped. Pass a full {@link ContentCatalog} (every slice
 * present) to validate a draft catalog, e.g. from content tooling.
 */
export function collectContentIssues(slices: ParsedContentSlices | ContentCatalog): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const s = slices as ParsedContentSlices;

  const traitIds = s.traits !== null ? new Set(s.traits.map((t) => t.id)) : null;
  const assetIds = s.assets !== null ? new Set(s.assets.map((a) => a.id)) : null;
  const minionTemplateIds = s.minions !== null ? new Set(s.minions.map((m) => m.id)) : null;
  const missionIds = s.missions !== null ? new Set(s.missions.map((m) => m.id)) : null;
  const coreMissionIds =
    s.missions !== null
      ? new Set(s.missions.filter((m) => m.coreMission === true).map((m) => m.id))
      : null;
  /* Every mission that sits on some lair's upgrade ladder: those are reachable only by
   * climbing that ladder, so `unlock_lair_mission` may not drop one into the lair pool. */
  const upgradeLadderMissionIds =
    s.lairs !== null
      ? new Set(s.lairs.flatMap((l) => l.upgradeLevels.flatMap((lvl) => lvl.missionIds)))
      : null;
  const locationIds = s.locations !== null ? new Set(s.locations.map((l) => l.id)) : null;
  const mapIds = s.maps !== null ? new Set(s.maps.map((m) => m.id)) : null;

  if (s.traits !== null) {
    pushDuplicateIdIssues("traits", s.traits, issues);
  }
  if (s.assets !== null) {
    pushDuplicateIdIssues("assets", s.assets, issues);
  }
  if (s.locations !== null) {
    pushDuplicateIdIssues("locations", s.locations, issues);
  }

  if (s.minions !== null) {
    pushDuplicateIdIssues("minions", s.minions, issues);
    if (traitIds !== null) {
      checkMinionLikeTraitRefs("minions", s.minions, traitIds, issues);
    }
    if (minionTemplateIds !== null && locationIds !== null) {
      checkStartingDynamicTraits("minions", s.minions, minionTemplateIds, locationIds, issues);
    }
  }

  if (s.agents !== null) {
    pushDuplicateIdIssues("agents", s.agents, issues);
    if (traitIds !== null) {
      checkMinionLikeTraitRefs("agents", s.agents, traitIds, issues);
      checkAgentChallengeTraits(s.agents, traitIds, issues);
    }
    for (const a of s.agents) {
      const seenAbilities = new Set<string>();
      (a.abilityIds ?? []).forEach((abilityId, i) => {
        if (seenAbilities.has(abilityId)) {
          issues.push({
            slice: "agents",
            entityId: a.id,
            path: `abilityIds[${i}]`,
            message: `Duplicate ability "${abilityId}"`,
          });
        }
        seenAbilities.add(abilityId);
      });
    }
    if (minionTemplateIds !== null) {
      for (const a of s.agents) {
        if (minionTemplateIds.has(a.id)) {
          issues.push({
            slice: "agents",
            entityId: a.id,
            path: "id",
            message: `Agent id "${a.id}" conflicts with a minion template id (must be disjoint)`,
          });
        }
      }
      if (locationIds !== null) {
        checkStartingDynamicTraits("agents", s.agents, minionTemplateIds, locationIds, issues);
      }
    }
  }

  if (s.missions !== null) {
    pushDuplicateIdIssues("missions", s.missions, issues);
    for (const m of s.missions) {
      const seenRequiredTraits = new Set<string>();
      m.requiredTraitIds.forEach((tid, i) => {
        if (seenRequiredTraits.has(tid)) {
          issues.push({
            slice: "missions",
            entityId: m.id,
            path: `requiredTraitIds[${i}]`,
            message: `Duplicate required trait id "${tid}"`,
          });
        }
        seenRequiredTraits.add(tid);
        if (traitIds !== null && !traitIds.has(tid)) {
          issues.push({
            slice: "missions",
            entityId: m.id,
            path: `requiredTraitIds[${i}]`,
            message: `Unknown trait id "${tid}"`,
          });
        }
      });
      if (assetIds !== null) {
        m.requiredAssetIds.forEach((aid, i) => {
          if (!assetIds.has(aid)) {
            issues.push({
              slice: "missions",
              entityId: m.id,
              path: `requiredAssetIds[${i}]`,
              message: `Unknown asset id "${aid}"`,
            });
          }
        });
      }
      if (traitIds !== null && assetIds !== null && missionIds !== null) {
        checkMissionEffects(
          "missions",
          m.id,
          m.targetType,
          m.onSuccessEffects ?? [],
          "onSuccessEffects",
          missionIds,
          upgradeLadderMissionIds,
          traitIds,
          assetIds,
          issues,
        );
        checkMissionEffects(
          "missions",
          m.id,
          m.targetType,
          m.onFailureEffects ?? [],
          "onFailureEffects",
          missionIds,
          upgradeLadderMissionIds,
          traitIds,
          assetIds,
          issues,
        );
      }
      checkUnlockForbidden("missions", m.id, m.onFailureEffects, "onFailureEffects", issues);
      checkTargetLocationFilters("missions", m.id, m, issues);
    }
  }

  if (s.maps !== null) {
    pushDuplicateIdIssues("maps", s.maps, issues);
    for (const map of s.maps) {
      const seenLoc = new Set<string>();
      map.locationIds.forEach((lid, i) => {
        if (seenLoc.has(lid)) {
          issues.push({
            slice: "maps",
            entityId: map.id,
            path: `locationIds[${i}]`,
            message: `Duplicate location id "${lid}" within map`,
          });
        }
        seenLoc.add(lid);
        if (locationIds !== null && !locationIds.has(lid)) {
          issues.push({
            slice: "maps",
            entityId: map.id,
            path: `locationIds[${i}]`,
            message: `Unknown location id "${lid}"`,
          });
        }
      });
      const seenMarker = new Set<string>();
      (map.markers ?? []).forEach((marker, i) => {
        if (seenMarker.has(marker.locationId)) {
          issues.push({
            slice: "maps",
            entityId: map.id,
            path: `markers[${i}]`,
            message: `Duplicate marker for location id "${marker.locationId}"`,
          });
        }
        seenMarker.add(marker.locationId);
        if (!seenLoc.has(marker.locationId)) {
          issues.push({
            slice: "maps",
            entityId: map.id,
            path: `markers[${i}]`,
            message: `Marker location id "${marker.locationId}" is not on this map`,
          });
        }
      });
    }
  }

  if (s.omegaPlans !== null) {
    pushDuplicateIdIssues("omegaPlans", s.omegaPlans, issues);
    for (const plan of s.omegaPlans) {
      if (mapIds !== null && !mapIds.has(plan.mapId)) {
        issues.push({
          slice: "omegaPlans",
          entityId: plan.id,
          path: "mapId",
          message: `Unknown map id "${plan.mapId}"`,
        });
      }
      if (missionIds !== null) {
        plan.stages.forEach((stage, si) => {
          stage.missionIds.forEach((mid, mi) => {
            if (!missionIds.has(mid)) {
              issues.push({
                slice: "omegaPlans",
                entityId: plan.id,
                path: `stages[${si}].missionIds[${mi}]`,
                message: `Unknown mission id "${mid}"`,
              });
            }
          });
        });
      }
    }
  }

  if (s.lairs !== null) {
    pushDuplicateIdIssues("lairs", s.lairs, issues);
    for (const lair of s.lairs) {
      const seenMission = new Set<string>();
      lair.availableMissionIds.forEach((mid, i) => {
        if (seenMission.has(mid)) {
          issues.push({
            slice: "lairs",
            entityId: lair.id,
            path: `availableMissionIds[${i}]`,
            message: `Duplicate mission id "${mid}" in availableMissionIds`,
          });
        }
        seenMission.add(mid);
        if (missionIds !== null && !missionIds.has(mid)) {
          issues.push({
            slice: "lairs",
            entityId: lair.id,
            path: `availableMissionIds[${i}]`,
            message: `Unknown mission id "${mid}"`,
          });
        }
      });
      /* Upgrade levels: ids unique across the whole ladder (a mission may only be the reward
       * for one choice, in one tier), disjoint from the always-available pool, never core. */
      const seenUpgrade = new Set<string>();
      lair.upgradeLevels.forEach((level, li) => {
        if (level.missionIds.length === 0) {
          issues.push({
            slice: "lairs",
            entityId: lair.id,
            path: `upgradeLevels[${li}].missionIds`,
            message: `Upgrade level ${li + 1} must offer at least one mission`,
          });
        }
        level.missionIds.forEach((mid, i) => {
          const path = `upgradeLevels[${li}].missionIds[${i}]`;
          if (seenUpgrade.has(mid)) {
            issues.push({
              slice: "lairs",
              entityId: lair.id,
              path,
              message: `Duplicate upgrade mission id "${mid}" — a mission may appear in only one upgrade level`,
            });
          }
          seenUpgrade.add(mid);
          if (missionIds !== null && !missionIds.has(mid)) {
            issues.push({
              slice: "lairs",
              entityId: lair.id,
              path,
              message: `Unknown mission id "${mid}" in upgradeLevels`,
            });
          }
          if (seenMission.has(mid)) {
            issues.push({
              slice: "lairs",
              entityId: lair.id,
              path,
              message: `Mission id "${mid}" cannot appear in both availableMissionIds and upgradeLevels`,
            });
          }
          if (coreMissionIds !== null && coreMissionIds.has(mid)) {
            issues.push({
              slice: "lairs",
              entityId: lair.id,
              path,
              message: `Mission id "${mid}" is a Core Mission (already unlocked at run start) and cannot be an upgrade mission`,
            });
          }
        });
      });
      if (lair.startingAssets && assetIds !== null) {
        for (const aid of Object.keys(lair.startingAssets)) {
          if (!assetIds.has(aid)) {
            issues.push({
              slice: "lairs",
              entityId: lair.id,
              path: `startingAssets.${aid}`,
              message: `Unknown asset id "${aid}" in startingAssets`,
            });
          }
        }
      }
    }
  }

  if (s.events !== null) {
    pushDuplicateIdIssues("events", s.events, issues);
    for (const ev of s.events) {
      if (missionIds !== null && missionIds.has(ev.id)) {
        issues.push({
          slice: "events",
          entityId: ev.id,
          path: "id",
          message: `Event id "${ev.id}" conflicts with a mission template id (must be disjoint)`,
        });
      }
      const seenRequiredTraits = new Set<string>();
      ev.requiredTraitIds.forEach((tid, i) => {
        if (seenRequiredTraits.has(tid)) {
          issues.push({
            slice: "events",
            entityId: ev.id,
            path: `requiredTraitIds[${i}]`,
            message: `Duplicate required trait id "${tid}"`,
          });
        }
        seenRequiredTraits.add(tid);
        if (traitIds !== null && !traitIds.has(tid)) {
          issues.push({
            slice: "events",
            entityId: ev.id,
            path: `requiredTraitIds[${i}]`,
            message: `Unknown trait id "${tid}"`,
          });
        }
      });
      if (assetIds !== null) {
        ev.requiredAssetIds.forEach((aid, i) => {
          if (!assetIds.has(aid)) {
            issues.push({
              slice: "events",
              entityId: ev.id,
              path: `requiredAssetIds[${i}]`,
              message: `Unknown asset id "${aid}"`,
            });
          }
        });
      }
      if (traitIds !== null && assetIds !== null && missionIds !== null) {
        checkMissionEffects(
          "events",
          ev.id,
          ev.targetType,
          ev.onSuccessEffects ?? [],
          "onSuccessEffects",
          missionIds,
          upgradeLadderMissionIds,
          traitIds,
          assetIds,
          issues,
        );
        checkMissionEffects(
          "events",
          ev.id,
          ev.targetType,
          ev.onFailureEffects ?? [],
          "onFailureEffects",
          missionIds,
          upgradeLadderMissionIds,
          traitIds,
          assetIds,
          issues,
        );
      }
      checkUnlockForbidden("events", ev.id, ev.onFailureEffects, "onFailureEffects", issues);
      checkTargetLocationFilters("events", ev.id, ev, issues);
    }
    /* One raid at most: the top wanted tier spawns a single event by id, so a second one
     * would be authored content that can never reach the table. */
    const raids = s.events.filter((ev) => ev.special === "lair_raid");
    for (let i = 1; i < raids.length; i += 1) {
      issues.push({
        slice: "events",
        entityId: raids[i]!.id,
        path: "special",
        message: `Only one event may be special "lair_raid" (already claimed by "${raids[0]!.id}")`,
      });
    }
  }

  if (s.balance !== null && s.balance.assetsPerLocationMin > s.balance.assetsPerLocationMax) {
    issues.push({
      slice: "balance",
      entityId: null,
      path: "assetsPerLocationMin",
      message: `assetsPerLocationMin (${s.balance.assetsPerLocationMin}) must be ≤ assetsPerLocationMax (${s.balance.assetsPerLocationMax})`,
    });
  }

  if (
    s.balance !== null &&
    s.balance.eventCooldownTurnsMin > s.balance.eventCooldownTurnsMax
  ) {
    issues.push({
      slice: "balance",
      entityId: null,
      path: "eventCooldownTurnsMin",
      message: `eventCooldownTurnsMin (${s.balance.eventCooldownTurnsMin}) must be ≤ eventCooldownTurnsMax (${s.balance.eventCooldownTurnsMax})`,
    });
  }

  if (s.balance !== null) {
    const thresholds = s.balance.hireLevelInfamyThresholds;
    for (let i = 1; i < thresholds.length; i += 1) {
      if (thresholds[i]! <= thresholds[i - 1]!) {
        issues.push({
          slice: "balance",
          entityId: null,
          path: `hireLevelInfamyThresholds[${i}]`,
          message: `hireLevelInfamyThresholds must be strictly ascending (${thresholds[i]} vs prior ${thresholds[i - 1]})`,
        });
      }
    }
    /* A template above the top gated level is unreachable: no infamy ever unlocks it. */
    if (s.minions !== null) {
      const maxGatedLevel = 1 + thresholds.length;
      for (const m of s.minions) {
        const level = m.startingLevel ?? 1;
        if (level > maxGatedLevel) {
          issues.push({
            slice: "minions",
            entityId: m.id,
            path: "startingLevel",
            message: `startingLevel ${level} can never be offered: hireLevelInfamyThresholds only unlocks up to level ${maxGatedLevel} (add ${level - maxGatedLevel} more threshold(s))`,
          });
        }
      }
    }
  }

  if (s.wantedLevels !== null && s.wantedLevels.length > 0) {
    const arr = s.wantedLevels;
    if (arr[0]!.minHeat !== 0) {
      issues.push({
        slice: "wantedLevels",
        entityId: null,
        path: "[0].minHeat",
        message: `First tier must have minHeat 0 (got ${arr[0]!.minHeat})`,
      });
    }
    for (let i = 1; i < arr.length; i += 1) {
      if (arr[i]!.minHeat <= arr[i - 1]!.minHeat) {
        issues.push({
          slice: "wantedLevels",
          entityId: null,
          path: `[${i}].minHeat`,
          message: `minHeat must be strictly ascending (${arr[i]!.minHeat} vs prior ${arr[i - 1]!.minHeat})`,
        });
      }
      if (arr[i]!.maxAgents < arr[i - 1]!.maxAgents) {
        issues.push({
          slice: "wantedLevels",
          entityId: null,
          path: `[${i}].maxAgents`,
          message: `maxAgents must be non-decreasing (${arr[i]!.maxAgents} < ${arr[i - 1]!.maxAgents})`,
        });
      }
    }
  }

  return issues;
}

/* ------------------------------------------------------------------------------------------------
 * Entry points.
 * ---------------------------------------------------------------------------------------------- */

/**
 * Parse raw slices into a catalog, collecting every problem instead of failing on the
 * first. `catalog` is null whenever `issues` is non-empty.
 */
export function parseContentCatalog(raw: RawContentSlices): {
  catalog: ContentCatalog | null;
  issues: ContentIssue[];
} {
  const { slices, issues } = parseContentSlices(raw);
  issues.push(...collectContentIssues(slices));
  if (issues.length > 0) {
    return { catalog: null, issues };
  }
  /* No issues ⇒ every slice parsed (shape failures always add issues). */
  return { catalog: slices as ContentCatalog, issues };
}

/**
 * Throwing entry point for boot and the build gate: returns the catalog or throws a
 * {@link ContentValidationError} listing every collected issue.
 */
export function parseCatalog(raw: RawContentSlices): ContentCatalog {
  const { catalog, issues } = parseContentCatalog(raw);
  if (catalog === null) {
    throw new ContentValidationError(issues);
  }
  return catalog;
}
