import type { MinionInstance, MissionTemplate } from "./types";

export type MissionSuccessOptions = {
  /** Extra required trait ids from situational modifiers; merged with template (deduped). */
  additionalRequiredTraitIds?: string[];
};

/**
 * Union of all trait ids held by any participating minion.
 */
export function unionParticipantTraitIds(participants: MinionInstance[]): Set<string> {
  const out = new Set<string>();
  for (const p of participants) {
    for (const id of p.traitIds) {
      out.add(id);
    }
  }
  return out;
}

/**
 * True when the player can start a mission with this roster (1–3 minions).
 */
export function canAssignParticipants(participants: MinionInstance[]): boolean {
  return participants.length >= 1 && participants.length <= 3;
}

function mergedRequiredTraitIds(
  template: MissionTemplate,
  options?: MissionSuccessOptions,
): string[] {
  const merged = new Set<string>(template.requiredTraitIds);
  for (const id of options?.additionalRequiredTraitIds ?? []) {
    if (id.length > 0) {
      merged.add(id);
    }
  }
  return [...merged];
}

/**
 * Linear success chance: matched required ids (union of template + optional extras) that
 * appear in the participants' trait union, divided by total required count.
 * Integer percent in [0, 100] using Math.round (full match => 100%).
 */
export function successChancePercent(
  template: MissionTemplate,
  participants: MinionInstance[],
  options?: MissionSuccessOptions,
): number {
  const required = mergedRequiredTraitIds(template, options);
  if (required.length === 0) {
    return 100;
  }
  const union = unionParticipantTraitIds(participants);
  let matched = 0;
  for (const id of required) {
    if (union.has(id)) {
      matched += 1;
    }
  }
  return Math.round((100 * matched) / required.length);
}
