import type { ContentSliceKey, RawContentSlices } from "./contentSchema";

/**
 * Rename an entity id across raw content slices: the entity's own `id` plus every
 * referent (mirrors the reference walkers in `contentRefs.ts`). Works on RAW slices so
 * tooling can rename inside an unsaved draft; returns a new deep copy, never mutates.
 * Tolerant of missing/odd fields — validation reports anything it can't reach.
 */

type Row = Record<string, unknown>;

/** Slices whose rows carry a string `id` that can be renamed. */
export const RENAMABLE_SLICES: ReadonlySet<ContentSliceKey> = new Set([
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
]);

function rowsOf(slice: unknown): Row[] {
  if (!Array.isArray(slice)) {
    return [];
  }
  return slice.filter((r): r is Row => r !== null && typeof r === "object");
}

function renameOwnId(slice: unknown, oldId: string, newId: string): void {
  for (const row of rowsOf(slice)) {
    if (row.id === oldId) {
      row.id = newId;
    }
  }
}

function renameInStringArray(row: Row, key: string, oldId: string, newId: string): void {
  const arr = row[key];
  if (Array.isArray(arr)) {
    row[key] = arr.map((x) => (x === oldId ? newId : x));
  }
}

function renameRecordKey(row: Row, key: string, oldId: string, newId: string): void {
  const rec = row[key];
  if (rec === null || typeof rec !== "object" || Array.isArray(rec)) {
    return;
  }
  const r = rec as Row;
  if (oldId in r && !(newId in r)) {
    r[newId] = r[oldId];
    delete r[oldId];
  }
}

const EFFECT_LIST_KEYS = ["onSuccessEffects", "onFailureEffects", "expireEffects"] as const;

function forEachEffect(row: Row, fn: (eff: Row) => void): void {
  for (const key of EFFECT_LIST_KEYS) {
    const list = row[key];
    if (!Array.isArray(list)) {
      continue;
    }
    for (const eff of list) {
      if (eff !== null && typeof eff === "object") {
        fn(eff as Row);
      }
    }
  }
}

function forEachStartingDynamicTrait(row: Row, fn: (dt: Row) => void): void {
  const list = row.startingDynamicTraits;
  if (!Array.isArray(list)) {
    return;
  }
  for (const dt of list) {
    if (dt !== null && typeof dt === "object") {
      fn(dt as Row);
    }
  }
}

function renameTraitRefs(draft: RawContentSlices, oldId: string, newId: string): void {
  for (const sliceKey of ["minions", "agents"] as const) {
    for (const row of rowsOf(draft[sliceKey])) {
      renameInStringArray(row, "startingTraitIds", oldId, newId);
      renameInStringArray(row, "levelUpTraitOrder", oldId, newId);
    }
  }
  for (const sliceKey of ["missions", "events"] as const) {
    for (const row of rowsOf(draft[sliceKey])) {
      renameInStringArray(row, "requiredTraitIds", oldId, newId);
      forEachEffect(row, (eff) => {
        if (eff.traitId === oldId) {
          eff.traitId = newId;
        }
        renameInStringArray(eff, "traitIds", oldId, newId);
      });
    }
  }
}

function renameAssetRefs(draft: RawContentSlices, oldId: string, newId: string): void {
  for (const sliceKey of ["missions", "events"] as const) {
    for (const row of rowsOf(draft[sliceKey])) {
      renameInStringArray(row, "requiredAssetIds", oldId, newId);
      forEachEffect(row, (eff) => {
        renameInStringArray(eff, "assetIds", oldId, newId);
        renameInStringArray(eff, "removeAssetIds", oldId, newId);
        renameInStringArray(eff, "gainAssetIds", oldId, newId);
      });
    }
  }
  for (const row of rowsOf(draft.lairs)) {
    renameRecordKey(row, "startingAssets", oldId, newId);
  }
}

function renameMissionRefs(draft: RawContentSlices, oldId: string, newId: string): void {
  for (const row of rowsOf(draft.omegaPlans)) {
    const stages = row.stages;
    if (Array.isArray(stages)) {
      for (const stage of stages) {
        if (stage !== null && typeof stage === "object") {
          renameInStringArray(stage as Row, "missionIds", oldId, newId);
        }
      }
    }
  }
  for (const row of rowsOf(draft.lairs)) {
    renameInStringArray(row, "availableMissionIds", oldId, newId);
    renameInStringArray(row, "upgradeMissionIds", oldId, newId);
  }
  for (const sliceKey of ["missions", "events"] as const) {
    for (const row of rowsOf(draft[sliceKey])) {
      forEachEffect(row, (eff) => {
        if (eff.kind === "unlock_lair_mission" && eff.missionId === oldId) {
          eff.missionId = newId;
        }
      });
    }
  }
}

function renameLocationRefs(draft: RawContentSlices, oldId: string, newId: string): void {
  for (const row of rowsOf(draft.maps)) {
    renameInStringArray(row, "locationIds", oldId, newId);
  }
  for (const sliceKey of ["minions", "agents"] as const) {
    for (const row of rowsOf(draft[sliceKey])) {
      forEachStartingDynamicTrait(row, (dt) => {
        if (dt.locationId === oldId) {
          dt.locationId = newId;
        }
      });
    }
  }
}

function renameMapRefs(draft: RawContentSlices, oldId: string, newId: string): void {
  for (const row of rowsOf(draft.omegaPlans)) {
    if (row.mapId === oldId) {
      row.mapId = newId;
    }
  }
}

function renameMinionTemplateRefs(draft: RawContentSlices, oldId: string, newId: string): void {
  for (const sliceKey of ["minions", "agents"] as const) {
    for (const row of rowsOf(draft[sliceKey])) {
      forEachStartingDynamicTrait(row, (dt) => {
        if (dt.targetMinionTemplateId === oldId) {
          dt.targetMinionTemplateId = newId;
        }
      });
    }
  }
}

/**
 * Rename `slice`/`oldId` to `newId` everywhere. Callers should ensure `newId` is not
 * already taken in `slice` (and, for minions/agents, in the disjoint counterpart) —
 * validation will flag it either way.
 */
export function applyIdRenameRaw(
  raw: RawContentSlices,
  slice: ContentSliceKey,
  oldId: string,
  newId: string,
): RawContentSlices {
  const draft = structuredClone(raw) as RawContentSlices;
  if (!RENAMABLE_SLICES.has(slice) || oldId === newId || newId.length === 0) {
    return draft;
  }
  renameOwnId(draft[slice], oldId, newId);
  switch (slice) {
    case "traits":
      renameTraitRefs(draft, oldId, newId);
      break;
    case "assets":
      renameAssetRefs(draft, oldId, newId);
      break;
    case "missions":
      renameMissionRefs(draft, oldId, newId);
      break;
    case "locations":
      renameLocationRefs(draft, oldId, newId);
      break;
    case "maps":
      renameMapRefs(draft, oldId, newId);
      break;
    case "minions":
      renameMinionTemplateRefs(draft, oldId, newId);
      break;
    default:
      /* agents, missionsless slices: only their own id row needed renaming. */
      break;
  }
  return draft;
}
