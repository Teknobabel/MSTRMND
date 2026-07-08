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

/** @deprecated Read `catalog.balance.dynamicTraitRollPercent`; kept as the legacy default. */
export const DYNAMIC_TRAIT_ROLL_PERCENT = DEFAULT_BALANCE.dynamicTraitRollPercent;

const DEFAULT_BONUS_BY_KIND: Record<DynamicTraitKind, number> =
  DEFAULT_BALANCE.dynamicTraitModifiers;

export function isPositiveDynamicTraitKind(kind: DynamicTraitKind): boolean {
  return kind === "friend" || kind === "lover" || kind === "hero";
}

export function isMinionTargetedDynamicTrait(
  d: DynamicTrait,
): d is Extract<DynamicTrait, { kind: "friend" | "lover" | "rival" | "hatred" }> {
  return (
    d.kind === "friend" ||
    d.kind === "lover" ||
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
  const entries: DynamicTraitSuccessBreakdownEntry[] = [];
  let total = 0;
  for (const p of participants) {
    for (const dt of p.dynamicTraits) {
      if (isMinionTargetedDynamicTrait(dt)) {
        if (
          dt.targetMinionInstanceId.length > 0 &&
          ids.has(dt.targetMinionInstanceId)
        ) {
          const delta = modifiers[dt.kind];
          total += delta;
          entries.push({
            ownerInstanceId: p.instanceId,
            delta,
            traitLabel: dynamicTraitDisplayLabel(catalog, roster, dt),
          });
        }
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
  let delta = 0;
  for (const p of participants) {
    for (const dt of p.dynamicTraits) {
      if (isMinionTargetedDynamicTrait(dt)) {
        if (
          dt.targetMinionInstanceId.length > 0 &&
          ids.has(dt.targetMinionInstanceId)
        ) {
          delta += modifiers[dt.kind];
        }
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
      case "lover":
        return `Lover of ${name}`;
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

function pickRandomOtherParticipant(
  participantInstanceIds: readonly string[],
  ownerId: string,
  rng: () => number,
): string | null {
  const others = participantInstanceIds.filter((id) => id !== ownerId);
  if (others.length === 0) {
    return null;
  }
  return others[Math.floor(rng() * others.length)]!;
}

function findIndexMinionBond(
  traits: readonly DynamicTrait[],
  targetId: string,
  kinds: readonly DynamicTraitKind[],
): number {
  return traits.findIndex(
    (t) =>
      isMinionTargetedDynamicTrait(t) &&
      kinds.includes(t.kind) &&
      t.targetMinionInstanceId === targetId,
  );
}

function applyPositiveMinionBond(
  traits: DynamicTrait[],
  targetInstanceId: string,
  ownerTemplateId: string,
  ownerInstanceId: string,
): { next: DynamicTrait[]; change: DynamicTraitActivityChange | null } {
  const negKinds: DynamicTraitKind[] = ["rival", "hatred"];

  const loverIdx = findIndexMinionBond(traits, targetInstanceId, ["lover"]);
  if (loverIdx !== -1) {
    return { next: traits, change: null };
  }

  const friendIdx = findIndexMinionBond(traits, targetInstanceId, ["friend"]);
  if (friendIdx !== -1) {
    const next = traits.map((t, i) =>
      i === friendIdx ? ({ kind: "lover", targetMinionInstanceId: targetInstanceId } as const) : t,
    );
    return {
      next,
      change: {
        ownerInstanceId,
        ownerTemplateId,
        changeType: "upgraded",
        kind: "lover",
        targetMinionInstanceId: targetInstanceId,
        removedKind: "friend",
      },
    };
  }

  let removedKind: DynamicTraitKind | undefined;
  let working = [...traits];
  for (const nk of negKinds) {
    const idx = findIndexMinionBond(working, targetInstanceId, [nk]);
    if (idx !== -1) {
      removedKind = working[idx]!.kind as DynamicTraitKind;
      working = working.filter((_, i) => i !== idx);
      break;
    }
  }

  working.push({ kind: "friend", targetMinionInstanceId: targetInstanceId });
  return {
    next: working,
    change:
      removedKind !== undefined
        ? {
            ownerInstanceId,
            ownerTemplateId,
            changeType: "replaced",
            kind: "friend",
            targetMinionInstanceId: targetInstanceId,
            removedKind,
          }
        : {
            ownerInstanceId,
            ownerTemplateId,
            changeType: "added",
            kind: "friend",
            targetMinionInstanceId: targetInstanceId,
          },
  };
}

function applyNegativeMinionBond(
  traits: DynamicTrait[],
  targetInstanceId: string,
  ownerTemplateId: string,
  ownerInstanceId: string,
): { next: DynamicTrait[]; change: DynamicTraitActivityChange | null } {
  const posKinds: DynamicTraitKind[] = ["friend", "lover"];

  const hatredIdx = findIndexMinionBond(traits, targetInstanceId, ["hatred"]);
  if (hatredIdx !== -1) {
    return { next: traits, change: null };
  }

  const rivalIdx = findIndexMinionBond(traits, targetInstanceId, ["rival"]);
  if (rivalIdx !== -1) {
    const next = traits.map((t, i) =>
      i === rivalIdx ? ({ kind: "hatred", targetMinionInstanceId: targetInstanceId } as const) : t,
    );
    return {
      next,
      change: {
        ownerInstanceId,
        ownerTemplateId,
        changeType: "upgraded",
        kind: "hatred",
        targetMinionInstanceId: targetInstanceId,
        removedKind: "rival",
      },
    };
  }

  let removedKind: DynamicTraitKind | undefined;
  let working = [...traits];
  for (const pk of posKinds) {
    const idx = findIndexMinionBond(working, targetInstanceId, [pk]);
    if (idx !== -1) {
      removedKind = working[idx]!.kind as DynamicTraitKind;
      working = working.filter((_, i) => i !== idx);
      break;
    }
  }

  working.push({ kind: "rival", targetMinionInstanceId: targetInstanceId });
  return {
    next: working,
    change:
      removedKind !== undefined
        ? {
            ownerInstanceId,
            ownerTemplateId,
            changeType: "replaced",
            kind: "rival",
            targetMinionInstanceId: targetInstanceId,
            removedKind,
          }
        : {
            ownerInstanceId,
            ownerTemplateId,
            changeType: "added",
            kind: "rival",
            targetMinionInstanceId: targetInstanceId,
          },
  };
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

  let removedKind: DynamicTraitKind | undefined;
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

  let removedKind: DynamicTraitKind | undefined;
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
        case "lover":
          return `Lover of ${n}`;
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
 * After mission effects, roll per-participant dynamic traits and return the next roster
 * plus structured changes for `mission_completed.dynamicTraitChanges`.
 */
export function rollDynamicTraitsAfterMission(
  minions: readonly MinionInstance[],
  participantInstanceIds: readonly string[],
  success: boolean,
  missionTarget: MissionTarget,
  rng: () => number,
  rollPercent: number = DEFAULT_BALANCE.dynamicTraitRollPercent,
): { nextMinions: MinionInstance[]; changes: DynamicTraitActivityChange[] } {
  let working = materializePendingDynamicTraits([...minions.map((m) => ({ ...m, dynamicTraits: [...m.dynamicTraits] }))]);
  const changes: DynamicTraitActivityChange[] = [];
  const locationId = missionTargetLocationId(missionTarget);
  const multi = participantInstanceIds.length > 1;

  const byId = new Map(working.map((m) => [m.instanceId, m] as const));

  for (const ownerId of participantInstanceIds) {
    if (success && multi) {
      if (rollHits(rng, rollPercent)) {
        const otherId = pickRandomOtherParticipant(participantInstanceIds, ownerId, rng);
        if (otherId !== null) {
          const cur = byId.get(ownerId);
          if (cur === undefined) {
            continue;
          }
          const r = applyPositiveMinionBond(
            cur.dynamicTraits,
            otherId,
            cur.templateId,
            cur.instanceId,
          );
          if (r.change !== null) {
            byId.set(ownerId, { ...cur, dynamicTraits: r.next });
            changes.push(r.change);
          }
        }
      }
    }

    if (!success && multi) {
      if (rollHits(rng, rollPercent)) {
        const otherId = pickRandomOtherParticipant(participantInstanceIds, ownerId, rng);
        if (otherId !== null) {
          const cur = byId.get(ownerId);
          if (cur === undefined) {
            continue;
          }
          const r = applyNegativeMinionBond(
            cur.dynamicTraits,
            otherId,
            cur.templateId,
            cur.instanceId,
          );
          if (r.change !== null) {
            byId.set(ownerId, { ...cur, dynamicTraits: r.next });
            changes.push(r.change);
          }
        }
      }
    }

    if (success && locationId !== null) {
      if (rollHits(rng, rollPercent)) {
        const cur = byId.get(ownerId);
        if (cur === undefined) {
          continue;
        }
        const r = applyHero(cur.dynamicTraits, locationId, cur.templateId, cur.instanceId);
        if (r.change !== null) {
          byId.set(ownerId, { ...cur, dynamicTraits: r.next });
          changes.push(r.change);
        }
      }
    }

    if (!success && locationId !== null) {
      if (rollHits(rng, rollPercent)) {
        const cur = byId.get(ownerId);
        if (cur === undefined) {
          continue;
        }
        const r = applyWanted(cur.dynamicTraits, locationId, cur.templateId, cur.instanceId);
        if (r.change !== null) {
          byId.set(ownerId, { ...cur, dynamicTraits: r.next });
          changes.push(r.change);
        }
      }
    }
  }

  working = working.map((m) => byId.get(m.instanceId) ?? m);
  return { nextMinions: working, changes };
}
