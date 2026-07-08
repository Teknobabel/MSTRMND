import { z } from "zod";
import type {
  AgentTemplate,
  Asset,
  ContentCatalog,
  EventTemplate,
  LairTemplate,
  LocationTemplate,
  MapTemplate,
  MinionTemplate,
  MissionEffect,
  MissionTemplate,
  MissionTargetType,
  OmegaPlanStage,
  OmegaPlanTemplate,
  PlayerProfile,
  StartingDynamicTrait,
  Trait,
  WantedLevelTier,
} from "./types";

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
      kind: z.literal("lover"),
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

/** Agents share the minion template JSON shape. */
export const agentTemplateSchema = minionTemplateSchema;

const missionTargetTypeSchema = z.enum([
  "location",
  "asset_hidden",
  "asset_revealed",
  "minion",
  "none",
]);

const deltaSchema = z.number().int().min(-50).max(50);

const locationLevelEffectSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

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
    locationLevel: locationLevelEffectSchema,
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
    locationLevel: locationLevelEffectSchema,
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
    startCommandPoints: z.coerce.number().int().min(0),
    requiredTraitIds: z.array(z.string().min(1)).default([]),
    requiredAssetIds: z.array(z.string().min(1)).default([]),
    durationTurns: z.coerce.number().int().min(1),
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

/** Events: mission shape + optional expire effects; requirements MAY both be empty. */
export const eventTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  cardArt: z.string().min(1).optional(),
  targetType: missionTargetTypeSchema,
  startCommandPoints: z.coerce.number().int().min(0),
  requiredTraitIds: z.array(z.string().min(1)).default([]),
  requiredAssetIds: z.array(z.string().min(1)).default([]),
  durationTurns: z.coerce.number().int().min(1),
  onSuccessEffects: z.array(missionEffectSchema).optional(),
  onFailureEffects: z.array(missionEffectSchema).optional(),
  expireEffects: z.array(missionEffectSchema).optional(),
});

export const locationTemplateSchema: z.ZodType<LocationTemplate> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  cardArt: z.string().min(1).optional(),
  locationType: locationTypeSchema,
  locationLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

export const mapTemplateSchema: z.ZodType<MapTemplate> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  locationIds: z.array(z.string().min(1)),
});

const omegaPlanStageSchema = z.object({
  missionIds: z.array(z.string().min(1)).length(3),
});

export const omegaPlanTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  mapId: z.string().min(1),
  stages: z.array(omegaPlanStageSchema).length(3),
});

export const assetSchema: z.ZodType<Asset> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  cardArt: z.string().min(1).optional(),
});

export const playerProfileSchema: z.ZodType<PlayerProfile> = z.object({
  name: z.string().min(1),
  profilePic: z.string().min(1),
});

export const wantedLevelTierSchema: z.ZodType<WantedLevelTier> = z.object({
  minInfamy: z.number().int().min(0).max(100),
  name: z.string().min(1),
  maxAgents: z.number().int().min(0),
});

export const lairTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  cardArt: z.string().min(1).optional(),
  availableMissionIds: z.array(z.string().min(1)),
  upgradeMissionIds: z.array(z.string().min(1)).default([]),
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
    };
    if (m.cardArt !== undefined) {
      base.cardArt = m.cardArt;
    }
    if (m.onSuccessEffects !== undefined && m.onSuccessEffects.length > 0) {
      base.onSuccessEffects = [...m.onSuccessEffects];
    }
    if (m.onFailureEffects !== undefined && m.onFailureEffects.length > 0) {
      base.onFailureEffects = [...m.onFailureEffects];
    }
    if (m.expireEffects !== undefined && m.expireEffects.length > 0) {
      base.expireEffects = [...m.expireEffects];
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
    mapId: p.mapId,
    stages: assertOmegaPlanStages(p.stages),
  }));
}

function normalizeLairs(arr: z.infer<typeof lairTemplateSchema>[]): LairTemplate[] {
  return arr.map((l) => ({
    id: l.id,
    name: l.name,
    ...(l.description !== undefined ? { description: l.description } : {}),
    ...(l.cardArt !== undefined ? { cardArt: l.cardArt } : {}),
    availableMissionIds: [...l.availableMissionIds],
    upgradeMissionIds: [...l.upgradeMissionIds],
    ...(l.startingAssets !== undefined ? { startingAssets: { ...l.startingAssets } } : {}),
  }));
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
    agents: shape("agents", (d) => normalizeMinionLikeTemplates(d) as AgentTemplate[]),
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
        if (dt.kind === "friend" || dt.kind === "lover") {
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
              message: `Multiple positive bonds toward "${t}" (at most one friend or lover per target)`,
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
function checkMissionEffects(
  slice: "missions" | "events",
  templateId: string,
  targetType: MissionTargetType,
  effects: readonly MissionEffect[],
  pathPrefix: string,
  catalogMissionIdSet: ReadonlySet<string>,
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
          traitIds,
          assetIds,
          issues,
        );
      }
      checkUnlockForbidden("missions", m.id, m.onFailureEffects, "onFailureEffects", issues);
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
      const seenUpgrade = new Set<string>();
      lair.upgradeMissionIds.forEach((mid, i) => {
        if (seenUpgrade.has(mid)) {
          issues.push({
            slice: "lairs",
            entityId: lair.id,
            path: `upgradeMissionIds[${i}]`,
            message: `Duplicate mission id "${mid}" in upgradeMissionIds`,
          });
        }
        seenUpgrade.add(mid);
        if (missionIds !== null && !missionIds.has(mid)) {
          issues.push({
            slice: "lairs",
            entityId: lair.id,
            path: `upgradeMissionIds[${i}]`,
            message: `Unknown mission id "${mid}" in upgradeMissionIds`,
          });
        }
        if (seenMission.has(mid)) {
          issues.push({
            slice: "lairs",
            entityId: lair.id,
            path: `upgradeMissionIds[${i}]`,
            message: `Mission id "${mid}" cannot appear in both availableMissionIds and upgradeMissionIds`,
          });
        }
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
          traitIds,
          assetIds,
          issues,
        );
        checkMissionEffects(
          "events",
          ev.id,
          ev.targetType,
          ev.expireEffects ?? [],
          "expireEffects",
          missionIds,
          traitIds,
          assetIds,
          issues,
        );
      }
      checkUnlockForbidden("events", ev.id, ev.onFailureEffects, "onFailureEffects", issues);
      checkUnlockForbidden("events", ev.id, ev.expireEffects, "expireEffects", issues);
    }
  }

  if (s.wantedLevels !== null && s.wantedLevels.length > 0) {
    const arr = s.wantedLevels;
    if (arr[0]!.minInfamy !== 0) {
      issues.push({
        slice: "wantedLevels",
        entityId: null,
        path: "[0].minInfamy",
        message: `First tier must have minInfamy 0 (got ${arr[0]!.minInfamy})`,
      });
    }
    for (let i = 1; i < arr.length; i += 1) {
      if (arr[i]!.minInfamy <= arr[i - 1]!.minInfamy) {
        issues.push({
          slice: "wantedLevels",
          entityId: null,
          path: `[${i}].minInfamy`,
          message: `minInfamy must be strictly ascending (${arr[i]!.minInfamy} vs prior ${arr[i - 1]!.minInfamy})`,
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
