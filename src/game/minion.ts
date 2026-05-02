import type { MinionInstance, MinionTemplate } from "./types";

export type CreateMinionOverrides = Partial<
  Pick<MinionInstance, "currentLevel" | "currentExperience" | "traitIds">
>;

export function createMinionFromTemplate(
  template: MinionTemplate,
  instanceId: string,
  overrides?: CreateMinionOverrides,
): MinionInstance {
  const starting = template.startingTraitIds ?? [];
  const traitIds =
    overrides?.traitIds !== undefined ? [...overrides.traitIds] : [...starting];
  return {
    instanceId,
    templateId: template.id,
    currentLevel: overrides?.currentLevel ?? 1,
    currentExperience: overrides?.currentExperience ?? 0,
    traitIds,
  };
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

/** XP gained per mission finished; at this total XP triggers a level-up (then XP resets to 0). */
export const MINION_XP_PER_MISSION = 1;
export const MINION_XP_TO_LEVEL = 3;

/**
 * When a mission finishes (resolve), grant {@link MINION_XP_PER_MISSION} XP to the minion.
 * At {@link MINION_XP_TO_LEVEL} XP, level increases, XP resets to 0, and the next trait from
 * `template.levelUpTraitOrder` is applied if any remain.
 */
export function awardMissionResolutionExperience(
  instance: MinionInstance,
  template: MinionTemplate,
): { instance: MinionInstance; leveledUp: boolean; traitUnlockedId?: string } {
  const nextXp = instance.currentExperience + MINION_XP_PER_MISSION;
  if (nextXp < MINION_XP_TO_LEVEL) {
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
