import type { ActiveMission, ActivityEvent, GameState, PlayerState } from "./gameState";
import type {
  LocationAssetPlacement,
  LocationAssetSlot,
  MissionEffect,
  MissionTarget,
} from "./types";
import { isOccupiedAssetSlot } from "./types";

function clampInfamy(value: number): number {
  return Math.max(0, Math.min(100, value));
}

const MIN_STAT_CAP = 1;

/**
 * Run all `reveal_target_asset` effects before `steal_target_asset`, then other kinds in
 * their original relative order (designers may still order non-asset effects freely).
 */
export function orderedMissionEffects(effects: readonly MissionEffect[]): MissionEffect[] {
  const reveals = effects.filter((e) => e.kind === "reveal_target_asset");
  const steals = effects.filter((e) => e.kind === "steal_target_asset");
  const rest = effects.filter(
    (e) => e.kind !== "reveal_target_asset" && e.kind !== "steal_target_asset",
  );
  return [...reveals, ...steals, ...rest];
}

function mapSlotAt(
  placements: LocationAssetPlacement[],
  locationId: string,
  slotIndex: number,
  mapSlot: (slot: LocationAssetSlot) => LocationAssetSlot,
): LocationAssetPlacement[] {
  return placements.map((p) => {
    if (p.locationId !== locationId) {
      return p;
    }
    return {
      ...p,
      slots: p.slots.map((slot, i) => (i === slotIndex ? mapSlot(slot) : slot)),
    };
  });
}

function applyRevealTargetAsset(
  placements: LocationAssetPlacement[],
  target: MissionTarget,
): LocationAssetPlacement[] {
  if (target.kind !== "asset") {
    return placements;
  }
  return mapSlotAt(placements, target.locationId, target.slotIndex, (slot) => {
    if (!isOccupiedAssetSlot(slot)) {
      return slot;
    }
    if (slot.visibility === "revealed") {
      return slot;
    }
    return { kind: "occupied", assetId: slot.assetId, visibility: "revealed" };
  });
}

function applyStealTargetAsset(
  placements: LocationAssetPlacement[],
  target: MissionTarget,
  player: PlayerState,
): { placements: LocationAssetPlacement[]; player: PlayerState; events: ActivityEvent[] } {
  const events: ActivityEvent[] = [];
  if (target.kind !== "asset") {
    return { placements, player, events };
  }
  const { locationId, slotIndex } = target;
  const placement = placements.find((p) => p.locationId === locationId);
  const slot = placement?.slots[slotIndex];
  if (!slot || !isOccupiedAssetSlot(slot)) {
    return { placements, player, events };
  }
  const assetId = slot.assetId;
  const nextPlacements = mapSlotAt(placements, locationId, slotIndex, () => ({ kind: "empty" as const }));
  const nextAssets = { ...player.assets, [assetId]: (player.assets[assetId] ?? 0) + 1 };
  events.push({ kind: "asset_gained", assetId, quantity: 1 });
  return {
    placements: nextPlacements,
    player: { ...player, assets: nextAssets },
    events,
  };
}

function applyPlayerStatDeltas(player: PlayerState, effect: MissionEffect): PlayerState {
  switch (effect.kind) {
    case "infamy_delta":
      return { ...player, infamy: player.infamy + effect.amount };
    case "max_concurrent_missions_delta": {
      const next = Math.max(MIN_STAT_CAP, player.maxConcurrentMissions + effect.delta);
      return { ...player, maxConcurrentMissions: next };
    }
    case "max_roster_size_delta": {
      const next = Math.max(MIN_STAT_CAP, player.maxRosterSize + effect.delta);
      return { ...player, maxRosterSize: next };
    }
    case "max_hire_offers_delta": {
      const next = Math.max(MIN_STAT_CAP, player.maxHireOffers + effect.delta);
      return { ...player, maxHireOffers: next };
    }
    case "max_participants_per_mission_delta": {
      const next = Math.max(MIN_STAT_CAP, player.maxParticipantsPerMission + effect.delta);
      return { ...player, maxParticipantsPerMission: next };
    }
    case "max_command_points_per_turn_delta": {
      const prevMax = player.maxCommandPoints;
      const nextMax = Math.max(MIN_STAT_CAP, prevMax + effect.delta);
      let commandPoints = player.commandPoints;
      if (effect.delta > 0) {
        commandPoints = Math.min(commandPoints + effect.delta, nextMax);
      } else {
        commandPoints = Math.min(commandPoints, nextMax);
      }
      return {
        ...player,
        maxCommandPoints: nextMax,
        commandPoints,
      };
    }
    default:
      return player;
  }
}

/**
 * Applies completion effects after baseline infamy has been added to `state.player.infamy`
 * (uncapped). Mutates infamy further for `infamy_delta` entries, then clamps infamy once at
 * the end. Returns updated player, placements, and activity rows (e.g. `asset_gained`).
 */
export function applyMissionEffects(
  state: GameState,
  effects: readonly MissionEffect[],
  activeMission: ActiveMission,
): { player: PlayerState; locationAssetSlots: LocationAssetPlacement[]; events: ActivityEvent[] } {
  const target = activeMission.target;
  const ordered = orderedMissionEffects(effects);
  let player = { ...state.player };
  let locationAssetSlots = state.locationAssetSlots.map((p) => ({
    ...p,
    slots: [...p.slots],
  }));
  const events: ActivityEvent[] = [];

  for (const effect of ordered) {
    if (effect.kind === "reveal_target_asset") {
      locationAssetSlots = applyRevealTargetAsset(locationAssetSlots, target);
    } else if (effect.kind === "steal_target_asset") {
      const r = applyStealTargetAsset(locationAssetSlots, target, player);
      locationAssetSlots = r.placements;
      player = r.player;
      events.push(...r.events);
    } else {
      player = applyPlayerStatDeltas(player, effect);
    }
  }

  player = { ...player, infamy: clampInfamy(player.infamy) };
  return { player, locationAssetSlots, events };
}
