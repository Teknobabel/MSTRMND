/**
 * Dynamic traits — the runtime modifiers that hang off a minion instead of the catalog.
 *
 * Two families live here and they work differently:
 *
 * - **Location** bonds (`hero` / `wanted`) are per-minion and still rolled after each resolve.
 * - **Minion-to-minion** bonds (`friend` / `ally` / `rival` / `hatred`) are a read-only
 *   projection of the pair affinity table in `affinity.ts`. They are never rolled and never
 *   edited here; the only thing this module does with them is render them and total their
 *   success modifier — **once per unordered pair**, not once per minion.
 */
import type {
  ContentCatalog,
  DynamicTrait,
  DynamicTraitActivityChange,
  DynamicTraitKind,
  DynamicTraitModifiers,
  MinionInstance,
  MissionTarget,
  StartingDynamicTrait,
} from "./types";
import { DEFAULT_BALANCE } from "./types";
import { pairKey } from "./affinity";

/** @deprecated Read `catalog.balance.dynamicTraitRollPercent`; kept as the legacy default. */
export const DYNAMIC_TRAIT_ROLL_PERCENT = DEFAULT_BALANCE.dynamicTraitRollPercent;

const DEFAULT_BONUS_BY_KIND: Record<DynamicTraitKind, number> =
  DEFAULT_BALANCE.dynamicTraitModifiers;

export function isPositiveDynamicTraitKind(kind: DynamicTraitKind): boolean {
  return kind === "friend" || kind === "ally" || kind === "hero";
}

export function isMinionTargetedDynamicTrait(
  d: DynamicTrait,
): d is Extract<DynamicTrait, { kind: "friend" | "ally" | "rival" | "hatred" }> {
  return (
    d.kind === "friend" ||
    d.kind === "ally" ||
    d.kind === "rival" ||
    d.kind === "hatred"
  );
}

function minionTemplateName(catalog: ContentCatalog, templateId: string): string {
  return catalog.minions.find((m) => m.id === templateId)?.name ?? templateId;
}

function minionInstanceName(
  catalog: ContentCatalog,
  instanceId: string,
  roster: readonly MinionInstance[],
): string {
  const m = roster.find((x) => x.instanceId === instanceId);
  return m !== undefined ? minionTemplateName(catalog, m.templateId) : instanceId;
}

/**
 * Resolves `pendingTargetTemplateId` to the first other roster minion with that template.
 *
 * Only reachable for legacy/hand-built instances now that bonds are projected from the affinity
 * table (which stores instance ids outright), but kept so such data still renders.
 */
export function materializePendingDynamicTraits(minions: MinionInstance[]): MinionInstance[] {
  return minions.map((owner) => ({
    ...owner,
    dynamicTraits: owner.dynamicTraits.map((dt) => {
      if (!isMinionTargetedDynamicTrait(dt) || dt.pendingTargetTemplateId === undefined) {
        return dt;
      }
      const tpl = dt.pendingTargetTemplateId;
      const match = minions.find(
        (x) => x.templateId === tpl && x.instanceId !== owner.instanceId,
      );
      if (match === undefined) {
        return dt;
      }
      return { kind: dt.kind, targetMinionInstanceId: match.instanceId };
    }),
  }));
}

/**
 * Flat success % delta from all participants' dynamic traits vs this mission's
 * participant set and optional target location id.
 */
export type DynamicTraitSuccessBreakdownEntry = {
  ownerInstanceId: string;
  delta: number;
  traitLabel: string;
};

export function dynamicTraitSuccessModifierBreakdownForMission(
  catalog: ContentCatalog,
  roster: readonly MinionInstance[],
  participants: readonly MinionInstance[],
  missionLocationId: string | null,
  modifiers: DynamicTraitModifiers = DEFAULT_BONUS_BY_KIND,
): { total: number; entries: DynamicTraitSuccessBreakdownEntry[] } {
  if (participants.length === 0) {
    return { total: 0, entries: [] };
  }
  const ids = new Set(participants.map((p) => p.instanceId));
  /* A relationship belongs to the pair, so both halves of it are on the roster — count the
   * first one seen and skip its mirror. */
  const countedPairs = new Set<string>();
  const entries: DynamicTraitSuccessBreakdownEntry[] = [];
  let total = 0;
  for (const p of participants) {
    for (const dt of p.dynamicTraits) {
      if (isMinionTargetedDynamicTrait(dt)) {
        if (dt.targetMinionInstanceId.length === 0 || !ids.has(dt.targetMinionInstanceId)) {
          continue;
        }
        const key = pairKey(p.instanceId, dt.targetMinionInstanceId);
        if (countedPairs.has(key)) {
          continue;
        }
        countedPairs.add(key);
        const delta = modifiers[dt.kind];
        total += delta;
        entries.push({
          ownerInstanceId: p.instanceId,
          delta,
          traitLabel: dynamicTraitDisplayLabel(catalog, roster, dt),
        });
      } else if (missionLocationId !== null && dt.locationId === missionLocationId) {
        const delta = modifiers[dt.kind];
        total += delta;
        entries.push({
          ownerInstanceId: p.instanceId,
          delta,
          traitLabel: dynamicTraitDisplayLabel(catalog, roster, dt),
        });
      }
    }
  }
  return { total, entries };
}

export function dynamicTraitSuccessModifierForMission(
  participants: readonly MinionInstance[],
  missionLocationId: string | null,
  modifiers: DynamicTraitModifiers = DEFAULT_BONUS_BY_KIND,
): number {
  if (participants.length === 0) {
    return 0;
  }
  const ids = new Set(participants.map((p) => p.instanceId));
  const countedPairs = new Set<string>();
  let delta = 0;
  for (const p of participants) {
    for (const dt of p.dynamicTraits) {
      if (isMinionTargetedDynamicTrait(dt)) {
        if (dt.targetMinionInstanceId.length === 0 || !ids.has(dt.targetMinionInstanceId)) {
          continue;
        }
        const key = pairKey(p.instanceId, dt.targetMinionInstanceId);
        if (countedPairs.has(key)) {
          continue;
        }
        countedPairs.add(key);
        delta += modifiers[dt.kind];
      } else if (missionLocationId !== null && dt.locationId === missionLocationId) {
        delta += modifiers[dt.kind];
      }
    }
  }
  return delta;
}

/** Materializes pending bonds against `fullRoster`, then sums modifiers for `participantInstanceIds`. */
export function dynamicTraitSuccessModifierFromFullRoster(
  fullRoster: readonly MinionInstance[],
  participantInstanceIds: readonly string[],
  missionLocationId: string | null,
  modifiers: DynamicTraitModifiers = DEFAULT_BONUS_BY_KIND,
): number {
  const materialized = materializePendingDynamicTraits(
    fullRoster.map((m) => ({ ...m, dynamicTraits: [...m.dynamicTraits] })),
  );
  const byId = new Map(materialized.map((m) => [m.instanceId, m] as const));
  const participants: MinionInstance[] = [];
  for (const id of participantInstanceIds) {
    const p = byId.get(id);
    if (p !== undefined) {
      participants.push(p);
    }
  }
  return dynamicTraitSuccessModifierForMission(participants, missionLocationId, modifiers);
}

/** Like {@link dynamicTraitSuccessModifierFromFullRoster}, but lists each contributing trait. */
export function dynamicTraitSuccessModifierBreakdownFromFullRoster(
  catalog: ContentCatalog,
  fullRoster: readonly MinionInstance[],
  participantInstanceIds: readonly string[],
  missionLocationId: string | null,
): { total: number; entries: DynamicTraitSuccessBreakdownEntry[] } {
  const materialized = materializePendingDynamicTraits(
    fullRoster.map((m) => ({ ...m, dynamicTraits: [...m.dynamicTraits] })),
  );
  const byId = new Map(materialized.map((m) => [m.instanceId, m] as const));
  const participants: MinionInstance[] = [];
  for (const id of participantInstanceIds) {
    const p = byId.get(id);
    if (p !== undefined) {
      participants.push(p);
    }
  }
  return dynamicTraitSuccessModifierBreakdownForMission(
    catalog,
    materialized,
    participants,
    missionLocationId,
    catalog.balance.dynamicTraitModifiers,
  );
}

export function dynamicTraitDisplayLabel(
  catalog: ContentCatalog,
  roster: readonly MinionInstance[],
  dt: DynamicTrait,
): string {
  if (isMinionTargetedDynamicTrait(dt)) {
    let name: string;
    if (dt.targetMinionInstanceId.length > 0) {
      name = minionInstanceName(catalog, dt.targetMinionInstanceId, roster);
    } else if (dt.pendingTargetTemplateId !== undefined) {
      name = minionTemplateName(catalog, dt.pendingTargetTemplateId);
    } else {
      name = "?";
    }
    switch (dt.kind) {
      case "friend":
        return `Friend of ${name}`;
      case "ally":
        return `Ally of ${name}`;
      case "rival":
        return `Rival of ${name}`;
      case "hatred":
        return `Hatred for ${name}`;
    }
  }
  const locName =
    catalog.locations.find((l) => l.id === dt.locationId)?.name ?? dt.locationId;
  return dt.kind === "hero" ? `Hero of ${locName}` : `Wanted in ${locName}`;
}

function rollHits(rng: () => number, rollPercent: number): boolean {
  return Math.floor(rng() * 100) < rollPercent;
}

function findLocationDynamic(
  traits: readonly DynamicTrait[],
  locationId: string,
  kinds: readonly DynamicTraitKind[],
): number {
  return traits.findIndex(
    (t) => !isMinionTargetedDynamicTrait(t) && kinds.includes(t.kind) && t.locationId === locationId,
  );
}

function applyHero(
  traits: DynamicTrait[],
  locationId: string,
  ownerTemplateId: string,
  ownerInstanceId: string,
): { next: DynamicTrait[]; change: DynamicTraitActivityChange | null } {
  const heroIdx = findLocationDynamic(traits, locationId, ["hero"]);
  if (heroIdx !== -1) {
    return { next: traits, change: null };
  }

  let removedKind: "hero" | "wanted" | undefined;
  let working = [...traits];
  const wantedIdx = findLocationDynamic(working, locationId, ["wanted"]);
  if (wantedIdx !== -1) {
    removedKind = "wanted";
    working = working.filter((_, i) => i !== wantedIdx);
  }
  working.push({ kind: "hero", locationId });
  return {
    next: working,
    change:
      removedKind !== undefined
        ? {
            ownerInstanceId,
            ownerTemplateId,
            changeType: "replaced",
            kind: "hero",
            locationId,
            removedKind,
          }
        : {
            ownerInstanceId,
            ownerTemplateId,
            changeType: "added",
            kind: "hero",
            locationId,
          },
  };
}

function applyWanted(
  traits: DynamicTrait[],
  locationId: string,
  ownerTemplateId: string,
  ownerInstanceId: string,
): { next: DynamicTrait[]; change: DynamicTraitActivityChange | null } {
  const wantedIdx = findLocationDynamic(traits, locationId, ["wanted"]);
  if (wantedIdx !== -1) {
    return { next: traits, change: null };
  }

  let removedKind: "hero" | "wanted" | undefined;
  let working = [...traits];
  const heroIdx = findLocationDynamic(working, locationId, ["hero"]);
  if (heroIdx !== -1) {
    removedKind = "hero";
    working = working.filter((_, i) => i !== heroIdx);
  }
  working.push({ kind: "wanted", locationId });
  return {
    next: working,
    change:
      removedKind !== undefined
        ? {
            ownerInstanceId,
            ownerTemplateId,
            changeType: "replaced",
            kind: "wanted",
            locationId,
            removedKind,
          }
        : {
            ownerInstanceId,
            ownerTemplateId,
            changeType: "added",
            kind: "wanted",
            locationId,
          },
  };
}

function missionTargetLocationId(target: MissionTarget): string | null {
  if (target.kind === "location") {
    return target.locationId;
  }
  if (target.kind === "asset") {
    return target.locationId;
  }
  return null;
}

function dynamicTraitLocationName(catalog: ContentCatalog, locationId: string): string {
  return catalog.locations.find((l) => l.id === locationId)?.name ?? locationId;
}

/** One-sentence activity/report line for a Hero / Wanted bond gained or replaced after a mission. */
export function formatDynamicTraitActivityChange(
  catalog: ContentCatalog,
  _roster: readonly MinionInstance[],
  ch: DynamicTraitActivityChange,
): string {
  const owner =
    catalog.minions.find((t) => t.id === ch.ownerTemplateId)?.name ?? ch.ownerTemplateId;
  const loc = dynamicTraitLocationName(catalog, ch.locationId);
  if (ch.changeType === "added") {
    return ch.kind === "hero"
      ? `${owner} gained Hero of ${loc}.`
      : `${owner} gained Wanted in ${loc}.`;
  }
  if (ch.changeType === "replaced" && ch.removedKind !== undefined) {
    const was = ch.removedKind === "hero" ? `Hero of ${loc}` : `Wanted in ${loc}`;
    const now = ch.kind === "hero" ? `Hero of ${loc}` : `Wanted in ${loc}`;
    return `${owner} replaced ${was} with ${now}.`;
  }
  return `${owner}: ${ch.kind} at ${loc}.`;
}

/** Hire-card preview lines for `MinionTemplate.startingDynamicTraits`. */
export function formatStartingDynamicTraitsPreview(
  catalog: ContentCatalog,
  traits: readonly StartingDynamicTrait[] | undefined,
): string[] {
  if (traits === undefined || traits.length === 0) {
    return [];
  }
  return traits.map((s) => {
    if ("targetMinionTemplateId" in s) {
      const n =
        catalog.minions.find((m) => m.id === s.targetMinionTemplateId)?.name ??
        s.targetMinionTemplateId;
      switch (s.kind) {
        case "friend":
          return `Friend of ${n}`;
        case "ally":
          return `Ally of ${n}`;
        case "rival":
          return `Rival of ${n}`;
        case "hatred":
          return `Hatred for ${n}`;
      }
    }
    const locName =
      catalog.locations.find((l) => l.id === s.locationId)?.name ?? s.locationId;
    return s.kind === "hero" ? `Hero of ${locName}` : `Wanted in ${locName}`;
  });
}

/**
 * After mission effects, roll each participant's **location** dynamic traits (Hero on success,
 * Wanted on failure) and return the next roster plus structured changes for
 * `mission_completed.dynamicTraitChanges`.
 *
 * Minion-to-minion relationships are deliberately absent: those move deterministically through
 * the pair affinity table (`affinity.ts`), not through this roll.
 */
export function rollLocationDynamicTraitsAfterMission(
  minions: readonly MinionInstance[],
  participantInstanceIds: readonly string[],
  success: boolean,
  missionTarget: MissionTarget,
  rng: () => number,
  rollPercent: number = DEFAULT_BALANCE.dynamicTraitRollPercent,
): { nextMinions: MinionInstance[]; changes: DynamicTraitActivityChange[] } {
  let working = materializePendingDynamicTraits([
    ...minions.map((m) => ({ ...m, dynamicTraits: [...m.dynamicTraits] })),
  ]);
  const changes: DynamicTraitActivityChange[] = [];
  const locationId = missionTargetLocationId(missionTarget);
  if (locationId === null) {
    return { nextMinions: working, changes };
  }

  const byId = new Map(working.map((m) => [m.instanceId, m] as const));

  for (const ownerId of participantInstanceIds) {
    if (!rollHits(rng, rollPercent)) {
      continue;
    }
    const cur = byId.get(ownerId);
    if (cur === undefined) {
      continue;
    }
    const r = success
      ? applyHero(cur.dynamicTraits, locationId, cur.templateId, cur.instanceId)
      : applyWanted(cur.dynamicTraits, locationId, cur.templateId, cur.instanceId);
    if (r.change !== null) {
      byId.set(ownerId, { ...cur, dynamicTraits: r.next });
      changes.push(r.change);
    }
  }

  working = working.map((m) => byId.get(m.instanceId) ?? m);
  return { nextMinions: working, changes };
}
