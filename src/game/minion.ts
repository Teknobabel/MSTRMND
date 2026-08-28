import type { BalanceConfig, MinionInstance, MinionTemplate } from "./types";
import { DEFAULT_BALANCE } from "./types";

export type CreateMinionOverrides = Partial<
  Pick<MinionInstance, "currentLevel" | "currentExperience" | "traitIds" | "dynamicTraits">
>;

/** Level a template's hires start at (`startingLevel`, floored at 1). */
export function templateStartingLevel(template: MinionTemplate): number {
  return Math.max(1, template.startingLevel ?? 1);
}

/**
 * Highest `startingLevel` the hire pool will offer at `infamy`. Level 1 is always available;
 * each threshold the player has reached unlocks one more level, so with `[15, 35, 60, 85]`
 * an infamy of 40 offers templates up to level 3.
 */
export function maxHireableStartingLevel(
  infamy: number,
  thresholds: readonly number[],
): number {
  let level = 1;
  for (const t of thresholds) {
    if (infamy >= t) {
      level += 1;
    }
  }
  return level;
}

/** Infamy needed for the next `startingLevel` to unlock, or null when all levels are unlocked. */
export function nextHireLevelInfamyThreshold(
  infamy: number,
  thresholds: readonly number[],
): number | null {
  let best: number | null = null;
  for (const t of thresholds) {
    if (infamy < t && (best === null || t < best)) {
      best = t;
    }
  }
  return best;
}

export function createMinionFromTemplate(
  template: MinionTemplate,
  instanceId: string,
  overrides?: CreateMinionOverrides,
): MinionInstance {
  const starting = template.startingTraitIds ?? [];
  const traitIds =
    overrides?.traitIds !== undefined ? [...overrides.traitIds] : [...starting];
  /* Nothing from `startingDynamicTraits` lands here: both tracks seed the affinity tables in
   * `affinity.ts`, which then project every pill back onto the instance. */
  const dynamicTraits = overrides?.dynamicTraits !== undefined ? [...overrides.dynamicTraits] : [];
  let instance: MinionInstance = {
    instanceId,
    templateId: template.id,
    currentLevel: 1,
    currentExperience: overrides?.currentExperience ?? 0,
    traitIds,
    dynamicTraits,
  };
  const targetLevel = Math.max(
    1,
    overrides?.currentLevel ?? template.startingLevel ?? 1,
  );
  while (instance.currentLevel < targetLevel) {
    instance = applyLevelUp(instance, template);
  }
  return instance;
}

/**
 * Grants the first trait in `template.levelUpTraitOrder` that the instance does not already have.
 */
export function nextLevelUpTraitId(
  instance: MinionInstance,
  template: MinionTemplate,
): string | undefined {
  return template.levelUpTraitOrder.find((id) => !instance.traitIds.includes(id));
}

/** @deprecated Read `catalog.balance.minionXpPerMission` / `.minionXpToLevel`; legacy defaults. */
export const MINION_XP_PER_MISSION = DEFAULT_BALANCE.minionXpPerMission;
export const MINION_XP_TO_LEVEL = DEFAULT_BALANCE.minionXpToLevel;

/**
 * When a mission finishes (resolve), grant `xp.minionXpPerMission` XP to the minion.
 * At `xp.minionXpToLevel` XP, level increases, XP resets to 0, and the next trait from
 * `template.levelUpTraitOrder` is applied if any remain. Defaults preserve legacy values.
 */
export function awardMissionResolutionExperience(
  instance: MinionInstance,
  template: MinionTemplate,
  xp: Pick<BalanceConfig, "minionXpPerMission" | "minionXpToLevel"> = DEFAULT_BALANCE,
): { instance: MinionInstance; leveledUp: boolean; traitUnlockedId?: string } {
  const nextXp = instance.currentExperience + xp.minionXpPerMission;
  if (nextXp < xp.minionXpToLevel) {
    return {
      instance: { ...instance, currentExperience: nextXp },
      leveledUp: false,
    };
  }
  const beforeTraits = new Set(instance.traitIds);
  const leveled = applyLevelUp(instance, template);
  const traitUnlockedId = leveled.traitIds.find((id) => !beforeTraits.has(id));
  return {
    instance: { ...leveled, currentExperience: 0 },
    leveledUp: true,
    traitUnlockedId,
  };
}

export function applyLevelUp(instance: MinionInstance, template: MinionTemplate): MinionInstance {
  const nextLevel = instance.currentLevel + 1;
  const traitId = nextLevelUpTraitId(instance, template);
  const traitIds =
    traitId !== undefined ? [...instance.traitIds, traitId] : [...instance.traitIds];
  return {
    ...instance,
    currentLevel: nextLevel,
    traitIds,
  };
}

export function addTrait(instance: MinionInstance, traitId: string): MinionInstance {
  if (instance.traitIds.includes(traitId)) {
    return instance;
  }
  return { ...instance, traitIds: [...instance.traitIds, traitId] };
}

export function removeTrait(instance: MinionInstance, traitId: string): MinionInstance {
  return {
    ...instance,
    traitIds: instance.traitIds.filter((id) => id !== traitId),
  };
}
