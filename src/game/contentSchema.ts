import { z } from "zod";
import type {
  AgentTemplate,
  Asset,
  ContentCatalog,
  LairTemplate,
  LocationTemplate,
  MapTemplate,
  MinionTemplate,
  MissionEffect,
  MissionTemplate,
  OmegaPlanStage,
  OmegaPlanTemplate,
  Trait,
} from "./types";

const traitTypeSchema = z.enum(["status", "primary", "secondary"]);

const traitSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: traitTypeSchema,
});

const traitsArraySchema = z
  .array(traitSchema)
  .superRefine((arr, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < arr.length; i += 1) {
      const id = arr[i].id;
      if (seen.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate trait id: ${id}`,
          path: [i, "id"],
        });
      }
      seen.add(id);
    }
  });

const minionTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  hireCommandPoints: z.number().int().min(0),
  startingTraitIds: z.array(z.string().min(1)).optional(),
  levelUpTraitOrder: z.array(z.string().min(1)),
  startingLevel: z.coerce.number().int().min(1).max(99).optional(),
});

type MinionLikeKind = "minion" | "agent";

function parseMinionLikeTemplatesWithTraitRefs(
  raw: unknown,
  traitIds: Set<string>,
  kind: MinionLikeKind,
): MinionTemplate[] {
  const parsed = z.array(minionTemplateSchema).safeParse(raw);
  if (!parsed.success) {
    throw parsed.error;
  }
  const arr = parsed.data;
  const seenIds = new Set<string>();
  for (let i = 0; i < arr.length; i += 1) {
    const m = arr[i];
    if (seenIds.has(m.id)) {
      throw new Error(`Duplicate ${kind} id: ${m.id} (index ${i})`);
    }
    seenIds.add(m.id);
    const refs = [...(m.startingTraitIds ?? []), ...m.levelUpTraitOrder];
    for (const tid of refs) {
      if (!traitIds.has(tid)) {
        throw new Error(
          `Unknown trait id "${tid}" referenced by ${kind} "${m.id}"`,
        );
      }
    }
  }
  return arr.map((m) => {
    const base: MinionTemplate = {
      id: m.id,
      name: m.name,
      description: m.description,
      hireCommandPoints: m.hireCommandPoints,
      levelUpTraitOrder: [...m.levelUpTraitOrder],
      startingLevel: m.startingLevel ?? 1,
    };
    if (m.startingTraitIds !== undefined && m.startingTraitIds.length > 0) {
      base.startingTraitIds = [...m.startingTraitIds];
    }
    return base;
  });
}

function parseMinionsWithTraitRefs(
  minionsRaw: unknown,
  traitIds: Set<string>,
): MinionTemplate[] {
  return parseMinionLikeTemplatesWithTraitRefs(minionsRaw, traitIds, "minion");
}

function parseAgentsWithTraitRefs(
  agentsRaw: unknown,
  traitIds: Set<string>,
  minionTemplateIds: Set<string>,
): AgentTemplate[] {
  const agents = parseMinionLikeTemplatesWithTraitRefs(agentsRaw, traitIds, "agent");
  for (const a of agents) {
    if (minionTemplateIds.has(a.id)) {
      throw new Error(
        `Agent id "${a.id}" conflicts with a minion template id (minion and agent ids must be disjoint)`,
      );
    }
  }
  return agents;
}

const missionTargetTypeSchema = z.enum([
  "location",
  "asset_hidden",
  "asset_revealed",
  "minion",
  "none",
]);

const deltaSchema = z.number().int().min(-50).max(50);

const missionEffectSchema: z.ZodType<MissionEffect> = z.discriminatedUnion("kind", [
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
]);

const missionTemplateSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
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

function parseMissionsWithRefs(
  missionsRaw: unknown,
  traitIds: Set<string>,
  assetIds: Set<string>,
): MissionTemplate[] {
  const parsed = z.array(missionTemplateSchema).safeParse(missionsRaw);
  if (!parsed.success) {
    throw parsed.error;
  }
  const arr = parsed.data;
  const catalogMissionIdSet = new Set(arr.map((x) => x.id));
  const seenMissionIds = new Set<string>();
  for (let i = 0; i < arr.length; i += 1) {
    const m = arr[i];
    if (seenMissionIds.has(m.id)) {
      throw new Error(`Duplicate mission id: ${m.id} (index ${i})`);
    }
    seenMissionIds.add(m.id);
    const seenRequiredTraits = new Set<string>();
    for (const tid of m.requiredTraitIds) {
      if (seenRequiredTraits.has(tid)) {
        throw new Error(
          `Duplicate required trait id "${tid}" in mission "${m.id}"`,
        );
      }
      seenRequiredTraits.add(tid);
      if (!traitIds.has(tid)) {
        throw new Error(
          `Unknown trait id "${tid}" referenced by mission "${m.id}"`,
        );
      }
    }
    for (const aid of m.requiredAssetIds) {
      if (!assetIds.has(aid)) {
        throw new Error(
          `Unknown asset id "${aid}" referenced by mission "${m.id}"`,
        );
      }
    }
    const assetOnlyKinds = new Set<MissionEffect["kind"]>(["reveal_target_asset", "steal_target_asset"]);
    const revealAllAtLocationKinds = new Set<MissionEffect["kind"]>([
      "reveal_all_hidden_assets_at_location",
      "steal_all_assets_at_location",
      "steal_all_revealed_assets_at_location",
      "security_level_delta",
    ]);
    const minionOnlyKinds = new Set<MissionEffect["kind"]>(["add_target_minion_traits"]);
    const targetIsNotAssetSlot =
      m.targetType !== "asset_hidden" && m.targetType !== "asset_revealed";
    const targetHasMissionLocation =
      m.targetType === "location" ||
      m.targetType === "asset_hidden" ||
      m.targetType === "asset_revealed";
    const allEffects = [...(m.onSuccessEffects ?? []), ...(m.onFailureEffects ?? [])];
    for (const eff of allEffects) {
      if (eff.kind === "unlock_lair_mission" && !catalogMissionIdSet.has(eff.missionId)) {
        throw new Error(
          `Unknown mission id "${eff.missionId}" in unlock_lair_mission for mission "${m.id}"`,
        );
      }
      if (targetIsNotAssetSlot && assetOnlyKinds.has(eff.kind)) {
        throw new Error(
          `Mission "${m.id}" uses effect "${eff.kind}" but targetType is "${m.targetType}" (requires asset_hidden or asset_revealed)`,
        );
      }
      if (!targetHasMissionLocation && revealAllAtLocationKinds.has(eff.kind)) {
        throw new Error(
          `Mission "${m.id}" uses effect "${eff.kind}" but targetType is "${m.targetType}" (requires location, asset_hidden, or asset_revealed)`,
        );
      }
      if (m.targetType !== "minion" && minionOnlyKinds.has(eff.kind)) {
        throw new Error(
          `Mission "${m.id}" uses effect "${eff.kind}" but targetType is "${m.targetType}" (requires minion)`,
        );
      }
      if (eff.kind === "add_target_minion_traits") {
        const seenTrait = new Set<string>();
        for (const tid of eff.traitIds) {
          if (seenTrait.has(tid)) {
            throw new Error(
              `Duplicate trait id "${tid}" in add_target_minion_traits for mission "${m.id}"`,
            );
          }
          seenTrait.add(tid);
          if (!traitIds.has(tid)) {
            throw new Error(
              `Unknown trait id "${tid}" in add_target_minion_traits for mission "${m.id}"`,
            );
          }
        }
      }
      if (eff.kind === "gain_assets") {
        for (const aid of eff.assetIds) {
          if (!assetIds.has(aid)) {
            throw new Error(
              `Unknown asset id "${aid}" in gain_assets for mission "${m.id}"`,
            );
          }
        }
      }
      if (eff.kind === "exchange_assets") {
        if (eff.removeAssetIds.length === 0 && eff.gainAssetIds.length === 0) {
          throw new Error(
            `Mission "${m.id}" exchange_assets must list at least one removeAssetIds or gainAssetIds entry`,
          );
        }
        for (const aid of eff.removeAssetIds) {
          if (!assetIds.has(aid)) {
            throw new Error(
              `Unknown asset id "${aid}" in exchange_assets.removeAssetIds for mission "${m.id}"`,
            );
          }
        }
        for (const aid of eff.gainAssetIds) {
          if (!assetIds.has(aid)) {
            throw new Error(
              `Unknown asset id "${aid}" in exchange_assets.gainAssetIds for mission "${m.id}"`,
            );
          }
        }
      }
    }
    for (const eff of m.onFailureEffects ?? []) {
      if (eff.kind === "unlock_lair_mission") {
        throw new Error(
          `Mission "${m.id}" must not use unlock_lair_mission in onFailureEffects (success only)`,
        );
      }
    }
  }
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
    if (m.onSuccessEffects !== undefined && m.onSuccessEffects.length > 0) {
      base.onSuccessEffects = [...m.onSuccessEffects];
    }
    if (m.onFailureEffects !== undefined && m.onFailureEffects.length > 0) {
      base.onFailureEffects = [...m.onFailureEffects];
    }
    return base;
  });
}

const locationTypeSchema = z.enum(["political", "military", "economic"]);

const locationTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  locationType: locationTypeSchema,
  locationLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

function parseLocations(locationsRaw: unknown): LocationTemplate[] {
  const parsed = z.array(locationTemplateSchema).safeParse(locationsRaw);
  if (!parsed.success) {
    throw parsed.error;
  }
  const arr = parsed.data;
  const seenLocationIds = new Set<string>();
  for (let i = 0; i < arr.length; i += 1) {
    const loc = arr[i];
    if (seenLocationIds.has(loc.id)) {
      throw new Error(`Duplicate location id: ${loc.id} (index ${i})`);
    }
    seenLocationIds.add(loc.id);
  }
  return arr;
}

const mapTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  locationIds: z.array(z.string().min(1)),
});

function parseMapsWithLocationRefs(
  mapsRaw: unknown,
  locationIds: Set<string>,
): MapTemplate[] {
  const parsed = z.array(mapTemplateSchema).safeParse(mapsRaw);
  if (!parsed.success) {
    throw parsed.error;
  }
  const arr = parsed.data;
  const seenMapIds = new Set<string>();
  for (let i = 0; i < arr.length; i += 1) {
    const map = arr[i];
    if (seenMapIds.has(map.id)) {
      throw new Error(`Duplicate map id: ${map.id} (index ${i})`);
    }
    seenMapIds.add(map.id);
    const seenLoc = new Set<string>();
    for (const lid of map.locationIds) {
      if (seenLoc.has(lid)) {
        throw new Error(
          `Duplicate location id "${lid}" in locationIds for map "${map.id}"`,
        );
      }
      seenLoc.add(lid);
      if (!locationIds.has(lid)) {
        throw new Error(`Unknown location id "${lid}" referenced by map "${map.id}"`);
      }
    }
  }
  return arr;
}

const omegaPlanStageSchema = z.object({
  missionIds: z.array(z.string().min(1)).length(3),
});

const omegaPlanTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  mapId: z.string().min(1),
  stages: z.array(omegaPlanStageSchema).length(3),
});

function assertOmegaPlanStages(
  stages: z.infer<typeof omegaPlanStageSchema>[],
): [OmegaPlanStage, OmegaPlanStage, OmegaPlanStage] {
  const tuple = (i: number): OmegaPlanStage => {
    const s = stages[i];
    return {
      missionIds: [s.missionIds[0], s.missionIds[1], s.missionIds[2]],
    };
  };
  return [tuple(0), tuple(1), tuple(2)];
}

function parseOmegaPlansWithMissionAndMapRefs(
  omegaPlansRaw: unknown,
  missionIds: Set<string>,
  mapIds: Set<string>,
): OmegaPlanTemplate[] {
  const parsed = z.array(omegaPlanTemplateSchema).safeParse(omegaPlansRaw);
  if (!parsed.success) {
    throw parsed.error;
  }
  const arr = parsed.data;
  const seenPlanIds = new Set<string>();
  for (let i = 0; i < arr.length; i += 1) {
    const plan = arr[i];
    if (seenPlanIds.has(plan.id)) {
      throw new Error(`Duplicate omega plan id: ${plan.id} (index ${i})`);
    }
    seenPlanIds.add(plan.id);
    if (!mapIds.has(plan.mapId)) {
      throw new Error(
        `Unknown map id "${plan.mapId}" referenced by omega plan "${plan.id}"`,
      );
    }
    for (let si = 0; si < plan.stages.length; si += 1) {
      for (const mid of plan.stages[si].missionIds) {
        if (!missionIds.has(mid)) {
          throw new Error(
            `Unknown mission id "${mid}" referenced by omega plan "${plan.id}" (stage ${si})`,
          );
        }
      }
    }
  }
  return arr.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    mapId: p.mapId,
    stages: assertOmegaPlanStages(p.stages),
  }));
}

const assetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
});

const assetsArraySchema = z
  .array(assetSchema)
  .superRefine((arr, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < arr.length; i += 1) {
      const id = arr[i].id;
      if (seen.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate asset id: ${id}`,
          path: [i, "id"],
        });
      }
      seen.add(id);
    }
  });

const organizationNamesArraySchema = z.array(z.string().min(1)).min(1);

const lairTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  availableMissionIds: z.array(z.string().min(1)),
  upgradeMissionIds: z.array(z.string().min(1)).default([]),
  startingAssets: z.record(z.string().min(1), z.number().int().min(1)).optional(),
});

function parseLairsWithRefs(
  lairsRaw: unknown,
  missionIds: Set<string>,
  assetIds: Set<string>,
): LairTemplate[] {
  const parsed = z.array(lairTemplateSchema).safeParse(lairsRaw);
  if (!parsed.success) {
    throw parsed.error;
  }
  const arr = parsed.data;
  const seenLairIds = new Set<string>();
  for (let i = 0; i < arr.length; i += 1) {
    const lair = arr[i];
    if (seenLairIds.has(lair.id)) {
      throw new Error(`Duplicate lair id: ${lair.id} (index ${i})`);
    }
    seenLairIds.add(lair.id);
    const seenMission = new Set<string>();
    for (const mid of lair.availableMissionIds) {
      if (seenMission.has(mid)) {
        throw new Error(
          `Duplicate mission id "${mid}" in availableMissionIds for lair "${lair.id}"`,
        );
      }
      seenMission.add(mid);
      if (!missionIds.has(mid)) {
        throw new Error(
          `Unknown mission id "${mid}" referenced by lair "${lair.id}"`,
        );
      }
    }
    const seenUpgrade = new Set<string>();
    for (const mid of lair.upgradeMissionIds) {
      if (seenUpgrade.has(mid)) {
        throw new Error(
          `Duplicate mission id "${mid}" in upgradeMissionIds for lair "${lair.id}"`,
        );
      }
      seenUpgrade.add(mid);
      if (!missionIds.has(mid)) {
        throw new Error(
          `Unknown mission id "${mid}" in upgradeMissionIds for lair "${lair.id}"`,
        );
      }
      if (seenMission.has(mid)) {
        throw new Error(
          `Mission id "${mid}" cannot appear in both availableMissionIds and upgradeMissionIds for lair "${lair.id}"`,
        );
      }
    }
    if (lair.startingAssets) {
      for (const aid of Object.keys(lair.startingAssets)) {
        if (!assetIds.has(aid)) {
          throw new Error(`Unknown asset id "${aid}" in startingAssets for lair "${lair.id}"`);
        }
      }
    }
  }
  return arr.map((l) => ({
    id: l.id,
    name: l.name,
    ...(l.description !== undefined ? { description: l.description } : {}),
    availableMissionIds: [...l.availableMissionIds],
    upgradeMissionIds: [...l.upgradeMissionIds],
    ...(l.startingAssets !== undefined
      ? { startingAssets: { ...l.startingAssets } }
      : {}),
  }));
}

export function parseCatalog(
  traitsRaw: unknown,
  minionsRaw: unknown,
  agentsRaw: unknown,
  missionsRaw: unknown,
  locationsRaw: unknown,
  mapsRaw: unknown,
  assetsRaw: unknown,
  omegaPlansRaw: unknown,
  lairsRaw: unknown,
  organizationNamesRaw: unknown,
): ContentCatalog {
  const traitsResult = traitsArraySchema.safeParse(traitsRaw);
  if (!traitsResult.success) {
    throw traitsResult.error;
  }
  const traits: Trait[] = traitsResult.data;
  const traitIds = new Set(traits.map((t) => t.id));
  const minions = parseMinionsWithTraitRefs(minionsRaw, traitIds);
  const minionTemplateIds = new Set(minions.map((m) => m.id));
  const agents = parseAgentsWithTraitRefs(agentsRaw, traitIds, minionTemplateIds);
  const assetsResult = assetsArraySchema.safeParse(assetsRaw);
  if (!assetsResult.success) {
    throw assetsResult.error;
  }
  const assets: Asset[] = assetsResult.data;
  const assetIds = new Set(assets.map((a) => a.id));
  const missions = parseMissionsWithRefs(missionsRaw, traitIds, assetIds);
  const missionIds = new Set(missions.map((m) => m.id));
  const locations = parseLocations(locationsRaw);
  const locationIds = new Set(locations.map((l) => l.id));
  const maps = parseMapsWithLocationRefs(mapsRaw, locationIds);
  const mapIds = new Set(maps.map((m) => m.id));
  const omegaPlans = parseOmegaPlansWithMissionAndMapRefs(
    omegaPlansRaw,
    missionIds,
    mapIds,
  );
  const lairs = parseLairsWithRefs(lairsRaw, missionIds, assetIds);
  const organizationNamesResult =
    organizationNamesArraySchema.safeParse(organizationNamesRaw);
  if (!organizationNamesResult.success) {
    throw organizationNamesResult.error;
  }
  const organizationNames = organizationNamesResult.data;
  return {
    traits,
    minions,
    agents,
    missions,
    locations,
    maps,
    assets,
    omegaPlans,
    lairs,
    organizationNames,
  };
}
