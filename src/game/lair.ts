import type { ContentCatalog, LairTemplate, LairUpgradeLevel } from "./types";

/** Upgrade ladder of the active lair, or `[]` when there is no lair / no upgrades authored. */
export function lairUpgradeLevels(
  activeLairId: string | null,
  catalog: ContentCatalog,
): LairUpgradeLevel[] {
  if (activeLairId === null) {
    return [];
  }
  return getLairById(catalog, activeLairId)?.upgradeLevels ?? [];
}

/** A level is done once **any** of its mutually exclusive missions has completed successfully. */
function isLevelComplete(
  level: LairUpgradeLevel,
  completedLairUpgradeMissionIds: readonly string[],
): boolean {
  return level.missionIds.some((id) => completedLairUpgradeMissionIds.includes(id));
}

/**
 * Index of the level the player is currently working on: the first one with nothing installed.
 * Equals the ladder length when every level is done (nothing left to show).
 */
export function currentLairUpgradeLevelIndex(
  activeLairId: string | null,
  completedLairUpgradeMissionIds: readonly string[],
  catalog: ContentCatalog,
): number {
  const levels = lairUpgradeLevels(activeLairId, catalog);
  const i = levels.findIndex((level) => !isLevelComplete(level, completedLairUpgradeMissionIds));
  return i === -1 ? levels.length : i;
}

/** The current level, or `null` when the ladder is finished / absent. */
export function currentLairUpgradeLevel(
  activeLairId: string | null,
  completedLairUpgradeMissionIds: readonly string[],
  catalog: ContentCatalog,
): { level: LairUpgradeLevel; index: number; total: number } | null {
  const levels = lairUpgradeLevels(activeLairId, catalog);
  const index = currentLairUpgradeLevelIndex(
    activeLairId,
    completedLairUpgradeMissionIds,
    catalog,
  );
  const level = levels[index];
  if (level === undefined) {
    return null;
  }
  return { level, index, total: levels.length };
}

/**
 * Upgrade missions the player may start right now: the mutually exclusive choices on the
 * current level only. Earlier levels are settled and later ones are not visible yet.
 */
export function availableLairUpgradeMissionIds(
  activeLairId: string | null,
  completedLairUpgradeMissionIds: readonly string[],
  catalog: ContentCatalog,
): string[] {
  const current = currentLairUpgradeLevel(
    activeLairId,
    completedLairUpgradeMissionIds,
    catalog,
  );
  return current === null ? [] : [...current.level.missionIds];
}

/** Infamy a level demands before its missions may be started (0 ⇒ ungated). */
export function lairUpgradeLevelMinInfamy(level: LairUpgradeLevel): number {
  return Math.max(0, level.minInfamy ?? 0);
}

/**
 * Whether the player has the standing to start this level's missions. Only the *ability* to
 * unlock is gated — the level is still shown, so a locked tier reads as a goal, not a secret.
 */
export function isLairUpgradeLevelUnlocked(level: LairUpgradeLevel, infamy: number): boolean {
  return infamy >= lairUpgradeLevelMinInfamy(level);
}

/** Index of the upgrade level `missionId` belongs to on this lair, or `-1` if it is not one. */
export function lairUpgradeLevelIndexOfMission(
  activeLairId: string | null,
  missionId: string,
  catalog: ContentCatalog,
): number {
  return lairUpgradeLevels(activeLairId, catalog).findIndex((level) =>
    level.missionIds.includes(missionId),
  );
}

/** Whether `missionId` is an upgrade mission anywhere on the active lair's ladder. */
export function isLairUpgradeMission(
  activeLairId: string | null,
  missionId: string,
  catalog: ContentCatalog,
): boolean {
  return lairUpgradeLevelIndexOfMission(activeLairId, missionId, catalog) !== -1;
}

export function getLairById(
  catalog: ContentCatalog,
  id: string,
): LairTemplate | undefined {
  return catalog.lairs.find((l) => l.id === id);
}

/**
 * Picks a random lair id for a new run, or null if the catalog has none.
 */
export function pickRandomLairId(catalog: ContentCatalog, rng: () => number): string | null {
  const { lairs } = catalog;
  if (lairs.length === 0) {
    return null;
  }
  const i = Math.floor(rng() * lairs.length);
  return lairs[i]!.id;
}

/**
 * Lair id for a new run: the `requestedId` when it names a catalog lair, otherwise a random
 * pick. Only the random path draws from `rng`, so a chosen lair costs no draw.
 */
export function resolveRunLairId(
  catalog: ContentCatalog,
  requestedId: string | null,
  rng: () => number,
): string | null {
  if (requestedId !== null && getLairById(catalog, requestedId) !== undefined) {
    return requestedId;
  }
  return pickRandomLairId(catalog, rng);
}
