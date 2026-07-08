import type { ContentSliceKey } from "./contentSchema";
import type { ContentCatalog, MissionEffect } from "./types";

/**
 * One id-reference between catalog entities, e.g. mission "heist" → asset "getaway-car"
 * at `requiredAssetIds[1]`. Content tooling uses the graph for delete-impact warnings
 * ("this trait is used in 6 places") and id renames (update every referent).
 */
export type ContentReference = {
  fromSlice: ContentSliceKey;
  fromId: string;
  /** Path within the source entity, e.g. `stages[1].missionIds[2]`. */
  path: string;
  toSlice: ContentSliceKey;
  toId: string;
};

function effectReferences(
  fromSlice: ContentSliceKey,
  fromId: string,
  effects: readonly MissionEffect[] | undefined,
  pathPrefix: string,
  out: ContentReference[],
): void {
  (effects ?? []).forEach((eff, ei) => {
    const path = `${pathPrefix}[${ei}]`;
    switch (eff.kind) {
      case "unlock_lair_mission":
        out.push({ fromSlice, fromId, path: `${path}.missionId`, toSlice: "missions", toId: eff.missionId });
        break;
      case "gain_assets":
        eff.assetIds.forEach((aid, i) => {
          out.push({ fromSlice, fromId, path: `${path}.assetIds[${i}]`, toSlice: "assets", toId: aid });
        });
        break;
      case "exchange_assets":
        eff.removeAssetIds.forEach((aid, i) => {
          out.push({ fromSlice, fromId, path: `${path}.removeAssetIds[${i}]`, toSlice: "assets", toId: aid });
        });
        eff.gainAssetIds.forEach((aid, i) => {
          out.push({ fromSlice, fromId, path: `${path}.gainAssetIds[${i}]`, toSlice: "assets", toId: aid });
        });
        break;
      case "add_target_minion_traits":
      case "add_random_participant_traits":
      case "add_all_participant_traits":
        eff.traitIds.forEach((tid, i) => {
          out.push({ fromSlice, fromId, path: `${path}.traitIds[${i}]`, toSlice: "traits", toId: tid });
        });
        break;
      case "remove_trait_from_all_minions":
      case "add_trait_to_random_minions":
        out.push({ fromSlice, fromId, path: `${path}.traitId`, toSlice: "traits", toId: eff.traitId });
        break;
      default:
        break;
    }
  });
}

function minionLikeReferences(
  slice: "minions" | "agents",
  templates: ContentCatalog["minions"],
  out: ContentReference[],
): void {
  for (const m of templates) {
    (m.startingTraitIds ?? []).forEach((tid, i) => {
      out.push({ fromSlice: slice, fromId: m.id, path: `startingTraitIds[${i}]`, toSlice: "traits", toId: tid });
    });
    m.levelUpTraitOrder.forEach((tid, i) => {
      out.push({ fromSlice: slice, fromId: m.id, path: `levelUpTraitOrder[${i}]`, toSlice: "traits", toId: tid });
    });
    (m.startingDynamicTraits ?? []).forEach((dt, i) => {
      if ("targetMinionTemplateId" in dt) {
        out.push({
          fromSlice: slice,
          fromId: m.id,
          path: `startingDynamicTraits[${i}].targetMinionTemplateId`,
          toSlice: "minions",
          toId: dt.targetMinionTemplateId,
        });
      } else {
        out.push({
          fromSlice: slice,
          fromId: m.id,
          path: `startingDynamicTraits[${i}].locationId`,
          toSlice: "locations",
          toId: dt.locationId,
        });
      }
    });
  }
}

/** Every id-reference in the catalog, in stable slice order. */
export function collectContentReferences(catalog: ContentCatalog): ContentReference[] {
  const out: ContentReference[] = [];

  minionLikeReferences("minions", catalog.minions, out);
  minionLikeReferences("agents", catalog.agents, out);

  for (const m of catalog.missions) {
    m.requiredTraitIds.forEach((tid, i) => {
      out.push({ fromSlice: "missions", fromId: m.id, path: `requiredTraitIds[${i}]`, toSlice: "traits", toId: tid });
    });
    m.requiredAssetIds.forEach((aid, i) => {
      out.push({ fromSlice: "missions", fromId: m.id, path: `requiredAssetIds[${i}]`, toSlice: "assets", toId: aid });
    });
    effectReferences("missions", m.id, m.onSuccessEffects, "onSuccessEffects", out);
    effectReferences("missions", m.id, m.onFailureEffects, "onFailureEffects", out);
  }

  for (const ev of catalog.events) {
    ev.requiredTraitIds.forEach((tid, i) => {
      out.push({ fromSlice: "events", fromId: ev.id, path: `requiredTraitIds[${i}]`, toSlice: "traits", toId: tid });
    });
    ev.requiredAssetIds.forEach((aid, i) => {
      out.push({ fromSlice: "events", fromId: ev.id, path: `requiredAssetIds[${i}]`, toSlice: "assets", toId: aid });
    });
    effectReferences("events", ev.id, ev.onSuccessEffects, "onSuccessEffects", out);
    effectReferences("events", ev.id, ev.onFailureEffects, "onFailureEffects", out);
    effectReferences("events", ev.id, ev.expireEffects, "expireEffects", out);
  }

  for (const map of catalog.maps) {
    map.locationIds.forEach((lid, i) => {
      out.push({ fromSlice: "maps", fromId: map.id, path: `locationIds[${i}]`, toSlice: "locations", toId: lid });
    });
  }

  for (const plan of catalog.omegaPlans) {
    out.push({ fromSlice: "omegaPlans", fromId: plan.id, path: "mapId", toSlice: "maps", toId: plan.mapId });
    plan.stages.forEach((stage, si) => {
      stage.missionIds.forEach((mid, mi) => {
        out.push({
          fromSlice: "omegaPlans",
          fromId: plan.id,
          path: `stages[${si}].missionIds[${mi}]`,
          toSlice: "missions",
          toId: mid,
        });
      });
    });
  }

  for (const lair of catalog.lairs) {
    lair.availableMissionIds.forEach((mid, i) => {
      out.push({ fromSlice: "lairs", fromId: lair.id, path: `availableMissionIds[${i}]`, toSlice: "missions", toId: mid });
    });
    lair.upgradeMissionIds.forEach((mid, i) => {
      out.push({ fromSlice: "lairs", fromId: lair.id, path: `upgradeMissionIds[${i}]`, toSlice: "missions", toId: mid });
    });
    for (const aid of Object.keys(lair.startingAssets ?? {})) {
      out.push({ fromSlice: "lairs", fromId: lair.id, path: `startingAssets.${aid}`, toSlice: "assets", toId: aid });
    }
  }

  return out;
}

/** References pointing AT `slice`/`id` (who uses this entity?). */
export function referencesTo(
  references: readonly ContentReference[],
  slice: ContentSliceKey,
  id: string,
): ContentReference[] {
  return references.filter((r) => r.toSlice === slice && r.toId === id);
}

/** Entity ids in `slice` that nothing references (candidates for dead content). */
export function unreferencedIds(
  catalog: ContentCatalog,
  references: readonly ContentReference[],
  slice: "traits" | "assets" | "missions" | "locations" | "maps",
): string[] {
  const referenced = new Set(
    references.filter((r) => r.toSlice === slice).map((r) => r.toId),
  );
  return catalog[slice].map((e) => e.id).filter((id) => !referenced.has(id));
}
