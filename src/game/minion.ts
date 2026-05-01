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
