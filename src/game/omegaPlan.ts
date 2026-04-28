import type { ContentCatalog, OmegaPlanTemplate } from "./types";

export function getOmegaPlanById(
  catalog: ContentCatalog,
  id: string,
): OmegaPlanTemplate | undefined {
  return catalog.omegaPlans.find((p) => p.id === id);
}

/**
 * Mission id at zero-based stage and mission indices, or undefined if out of bounds.
 */
export function missionIdAt(
  plan: OmegaPlanTemplate,
  stageIndex: number,
  missionIndex: number,
): string | undefined {
  if (stageIndex < 0 || stageIndex > 2 || missionIndex < 0 || missionIndex > 2) {
    return undefined;
  }
  return plan.stages[stageIndex].missionIds[missionIndex];
}
