import { z } from "zod";
import type {
  Asset,
  ContentCatalog,
  LocationTemplate,
  MapTemplate,
  MinionTemplate,
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
  startingTraitIds: z.array(z.string().min(1)).optional(),
  levelUpTraitOrder: z.array(z.string().min(1)),
});

function parseMinionsWithTraitRefs(
  minionsRaw: unknown,
  traitIds: Set<string>,
): MinionTemplate[] {
  const parsed = z.array(minionTemplateSchema).safeParse(minionsRaw);
  if (!parsed.success) {
    throw parsed.error;
  }
  const arr = parsed.data;
  const seenMinionIds = new Set<string>();
  for (let i = 0; i < arr.length; i += 1) {
    const m = arr[i];
    if (seenMinionIds.has(m.id)) {
      throw new Error(`Duplicate minion id: ${m.id} (index ${i})`);
    }
    seenMinionIds.add(m.id);
    const refs = [...(m.startingTraitIds ?? []), ...m.levelUpTraitOrder];
    for (const tid of refs) {
      if (!traitIds.has(tid)) {
        throw new Error(
          `Unknown trait id "${tid}" referenced by minion "${m.id}"`,
        );
      }
    }
  }
  return arr;
}

const missionTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  requiredTraitIds: z.array(z.string().min(1)).min(1),
  durationTurns: z.coerce.number().int().min(1),
});

function parseMissionsWithTraitRefs(
  missionsRaw: unknown,
  traitIds: Set<string>,
): MissionTemplate[] {
  const parsed = z.array(missionTemplateSchema).safeParse(missionsRaw);
  if (!parsed.success) {
    throw parsed.error;
  }
  const arr = parsed.data;
  const seenMissionIds = new Set<string>();
  for (let i = 0; i < arr.length; i += 1) {
    const m = arr[i];
    if (seenMissionIds.has(m.id)) {
      throw new Error(`Duplicate mission id: ${m.id} (index ${i})`);
    }
    seenMissionIds.add(m.id);
    const seenRequired = new Set<string>();
    for (const tid of m.requiredTraitIds) {
      if (seenRequired.has(tid)) {
        throw new Error(
          `Duplicate required trait id "${tid}" in mission "${m.id}"`,
        );
      }
      seenRequired.add(tid);
      if (!traitIds.has(tid)) {
        throw new Error(
          `Unknown trait id "${tid}" referenced by mission "${m.id}"`,
        );
      }
    }
  }
  return arr;
}

const locationAssetSlotSchema = z.object({
  assetId: z.string().min(1).optional(),
  initialState: z.enum(["hidden", "revealed"]),
});

const locationTypeSchema = z.enum(["political", "military", "economic"]);

const locationTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  locationType: locationTypeSchema,
  locationLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  availableMissionIds: z.array(z.string().min(1)),
  assetSlots: z.array(locationAssetSlotSchema).default([]),
});

function parseLocationsWithRefs(
  locationsRaw: unknown,
  missionIds: Set<string>,
  assetIds: Set<string>,
): LocationTemplate[] {
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
    const seenMission = new Set<string>();
    for (const mid of loc.availableMissionIds) {
      if (seenMission.has(mid)) {
        throw new Error(
          `Duplicate mission id "${mid}" in availableMissionIds for location "${loc.id}"`,
        );
      }
      seenMission.add(mid);
      if (!missionIds.has(mid)) {
        throw new Error(
          `Unknown mission id "${mid}" referenced by location "${loc.id}"`,
        );
      }
    }
    for (let si = 0; si < loc.assetSlots.length; si += 1) {
      const slot = loc.assetSlots[si];
      if (slot.assetId !== undefined && !assetIds.has(slot.assetId)) {
        throw new Error(
          `Unknown asset id "${slot.assetId}" in assetSlots[${si}] for location "${loc.id}"`,
        );
      }
    }
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

function parseOmegaPlansWithMissionRefs(
  omegaPlansRaw: unknown,
  missionIds: Set<string>,
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

export function parseCatalog(
  traitsRaw: unknown,
  minionsRaw: unknown,
  missionsRaw: unknown,
  locationsRaw: unknown,
  mapsRaw: unknown,
  assetsRaw: unknown,
  omegaPlansRaw: unknown,
): ContentCatalog {
  const traitsResult = traitsArraySchema.safeParse(traitsRaw);
  if (!traitsResult.success) {
    throw traitsResult.error;
  }
  const traits: Trait[] = traitsResult.data;
  const traitIds = new Set(traits.map((t) => t.id));
  const minions = parseMinionsWithTraitRefs(minionsRaw, traitIds);
  const missions = parseMissionsWithTraitRefs(missionsRaw, traitIds);
  const missionIds = new Set(missions.map((m) => m.id));
  const omegaPlans = parseOmegaPlansWithMissionRefs(omegaPlansRaw, missionIds);
  const assetsResult = assetsArraySchema.safeParse(assetsRaw);
  if (!assetsResult.success) {
    throw assetsResult.error;
  }
  const assets: Asset[] = assetsResult.data;
  const assetIds = new Set(assets.map((a) => a.id));
  const locations = parseLocationsWithRefs(locationsRaw, missionIds, assetIds);
  const locationIds = new Set(locations.map((l) => l.id));
  const maps = parseMapsWithLocationRefs(mapsRaw, locationIds);
  return { traits, minions, missions, locations, maps, assets, omegaPlans };
}
