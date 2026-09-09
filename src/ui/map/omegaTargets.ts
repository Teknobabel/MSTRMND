/**
 * Which sites the active Omega phase is asking for.
 *
 * The plan names missions, not places: a mission carries site *filters* (a pinned id list, a
 * category, a level, an intel or security band) and any site clearing all of them is a legal
 * target for it. Working out which pins those are is the same question the Plan panel answers
 * when it accepts a drop, asked of every site at once — so it goes through the same
 * `mission.ts` predicates rather than a second reading of the filters.
 *
 * Two of the five filters are per-run state, so this is a snapshot: surveil a site and it can
 * join the set, let security climb and it can leave. The caller re-asks on every render.
 */
import {
  missionAllowsTargetLocation,
  missionTargetTypeTargetsLocation,
  type MissionTargetSite,
} from "../../game/mission";
import type { MissionTemplate } from "../../game/types";

export interface OmegaPhaseTargetInput {
  /**
   * The phase's missions that still need doing. A finished slot is left out by the caller: its
   * targets are no longer anything the plan wants.
   */
  readonly missions: readonly MissionTemplate[];
  /** Every site in play this run, with the two levels the filters judge from run state. */
  readonly sites: readonly MissionTargetSite[];
}

/**
 * Location id → the mission template ids that could be aimed there, in phase order.
 *
 * Missions whose `targetType` does not resolve to a site (`minion`, `none`) are skipped
 * outright — their site filters are inert, and letting them through would flag the whole map.
 */
export function omegaPhaseTargetsByLocation(
  input: OmegaPhaseTargetInput,
): Map<string, string[]> {
  const byLocation = new Map<string, string[]>();
  for (const mission of input.missions) {
    if (!missionTargetTypeTargetsLocation(mission.targetType)) {
      continue;
    }
    for (const site of input.sites) {
      if (!missionAllowsTargetLocation(mission, site)) {
        continue;
      }
      const wanted = byLocation.get(site.location.id);
      if (wanted === undefined) {
        byLocation.set(site.location.id, [mission.id]);
      } else if (!wanted.includes(mission.id)) {
        wanted.push(mission.id);
      }
    }
  }
  return byLocation;
}
