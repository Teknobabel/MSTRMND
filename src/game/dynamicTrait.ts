/**
 * Dynamic traits — the runtime modifiers that hang off a minion instead of the catalog.
 *
 * Every kind here is a **read-only projection** of an affinity table in `affinity.ts`:
 * `friend` / `ally` / `rival` / `hatred` come from the minion **pair** track, `hero` / `wanted`
 * from the minion-**location** track. Nothing in this module creates, rolls, or edits them. All
 * it does is render them and total their success modifier — once per unordered **pair** for a
 * relationship, once per **minion** for a location standing.
 */
import type {
  ContentCatalog,
  DynamicTrait,
  DynamicTraitKind,
  DynamicTraitModifiers,
  MinionInstance,
} from "./types";
import { DEFAULT_BALANCE } from "./types";
import { pairKey } from "./affinity";

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