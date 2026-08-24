import type { ContentCatalog, OmegaPlanTemplate } from "./types";

/** Mission slots per omega phase — the grid is always 3 wide. */
export const OMEGA_MISSIONS_PER_STAGE = 3;

/** Omega phases per plan — the grid is always 3 tall. */
export const OMEGA_STAGE_COUNT = 3;

export function getOmegaPlanById(
  catalog: ContentCatalog,
  id: string,
): OmegaPlanTemplate | undefined {
  return catalog.omegaPlans.find((p) => p.id === id);
}

/**
 * Picks a random omega plan id for a new run, or null if the catalog has none.
 */
export function pickRandomOmegaPlanId(
  catalog: ContentCatalog,
  rng: () => number,
): string | null {
  const { omegaPlans } = catalog;
  if (omegaPlans.length === 0) {
    return null;
  }
  const i = Math.floor(rng() * omegaPlans.length);
  return omegaPlans[i]!.id;
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

/** Mission template id for one cell on the Omega grid (stage 0–2, slot 0–2). */
export function omegaSlotMissionId(
  plan: OmegaPlanTemplate,
  stageIndex: number,
  slotIndex: number,
): string | undefined {
  return missionIdAt(plan, stageIndex, slotIndex);
}

/**
 * How many of a phase's missions must succeed for it to complete (designer-authored
 * `requiredMissions`, clamped to 1–3). Out-of-range stage indices fall back to all three.
 */
export function omegaStageRequiredMissions(
  plan: OmegaPlanTemplate,
  stageIndex: number,
): number {
  const stage = plan.stages[stageIndex];
  if (stage === undefined) {
    return OMEGA_MISSIONS_PER_STAGE;
  }
  return Math.min(OMEGA_MISSIONS_PER_STAGE, Math.max(1, stage.requiredMissions));
}

/** Total mission successes needed to finish every phase of a plan. */
export function omegaPlanRequiredMissionTotal(plan: OmegaPlanTemplate): number {
  let total = 0;
  for (let i = 0; i < OMEGA_STAGE_COUNT; i += 1) {
    total += omegaStageRequiredMissions(plan, i);
  }
  return total;
}

/** True once enough slots in `stageIndex` have succeeded to advance the plan. */
export function isOmegaStageComplete(
  plan: OmegaPlanTemplate,
  stageIndex: number,
  rowProgress: readonly boolean[],
): boolean {
  return (
    rowProgress.filter(Boolean).length >= omegaStageRequiredMissions(plan, stageIndex)
  );
}
