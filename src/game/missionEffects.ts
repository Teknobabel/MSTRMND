import type { ActiveMission, ActivityEvent, GameState, PlayerState } from "./gameState";
import { maxSecurityLevelForLocation } from "./locationCatalog";
import type {
  ContentCatalog,
  LocationAssetPlacement,
  LocationAssetSlot,
  LocationSecurityState,
  MissionEffect,
  MissionTarget,
} from "./types";
import { isOccupiedAssetSlot } from "./types";

function signedInt(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

function describeMissionEffect(effect: MissionEffect): string {
  switch (effect.kind) {
    case "reveal_target_asset":
      return "Revealed the targeted asset";
    case "reveal_all_hidden_assets_at_location":
      return "Revealed all hidden assets at the target location";
    case "steal_target_asset":
      return "Stole the targeted asset into inventory";
    case "steal_all_assets_at_location":
      return "Revealed hidden assets at the target location, then stole all assets there into inventory";
    case "steal_all_revealed_assets_at_location":
      return "Stole all revealed assets at the target location into inventory";
    case "unlock_lair_mission":
      return `Unlocked lair mission: ${effect.missionId}`;
    case "gain_assets":
      return `Gained ${effect.assetIds.length} asset unit(s) into inventory`;
    case "exchange_assets":
      return `Removed up to ${effect.removeAssetIds.length} asset unit(s) from inventory (capped by holdings), then gained ${effect.gainAssetIds.length} unit(s)`;
    case "security_level_delta":
      return `Security level at target location ${signedInt(effect.delta)}`;
    case "add_target_minion_traits":
      return `Granted ${effect.traitIds.length} trait(s) to the target minion`;
    case "infamy_delta":
      return `Infamy ${signedInt(effect.amount)} (mission effect)`;
    case "max_concurrent_missions_delta":
      return `Max concurrent missions ${signedInt(effect.delta)}`;
    case "max_roster_size_delta":
      return `Max roster size ${signedInt(effect.delta)}`;
    case "max_hire_offers_delta":
      return `Max hire offers ${signedInt(effect.delta)}`;
    case "max_participants_per_mission_delta":
      return `Max participants per mission ${signedInt(effect.delta)}`;
    case "max_command_points_per_turn_delta":
      return `Max command points per turn ${signedInt(effect.delta)}`;
    default: {
      const _exhaustive: never = effect;
      return String(_exhaustive);
    }
  }
}

function clampInfamy(value: number): number {
  return Math.max(0, Math.min(100, value));
}

const MIN_STAT_CAP = 1;

/**
 * Run all reveal effects (`reveal_target_asset`, `reveal_all_hidden_assets_at_location`)
 * before steal effects (`steal_target_asset`, `steal_all_assets_at_location`,
 * `steal_all_revealed_assets_at_location`), then other kinds in their original relative order
 * (designers may still order non-asset effects freely).
 */
export function orderedMissionEffects(effects: readonly MissionEffect[]): MissionEffect[] {
  const reveals = effects.filter(
    (e) =>
      e.kind === "reveal_target_asset" ||
      e.kind === "reveal_all_hidden_assets_at_location",
  );
  const steals = effects.filter(
    (e) =>
      e.kind === "steal_target_asset" ||
      e.kind === "steal_all_assets_at_location" ||
      e.kind === "steal_all_revealed_assets_at_location",
  );
  const rest = effects.filter(
    (e) =>
      e.kind !== "reveal_target_asset" &&
      e.kind !== "reveal_all_hidden_assets_at_location" &&
      e.kind !== "steal_target_asset" &&
      e.kind !== "steal_all_assets_at_location" &&
      e.kind !== "steal_all_revealed_assets_at_location",
  );
  return [...reveals, ...steals, ...rest];
}

/** Human-readable lines for template mission effects, in {@link orderedMissionEffects} order. */
export function describeMissionTemplateEffects(effects: readonly MissionEffect[]): string[] {
  return orderedMissionEffects([...effects]).map(describeMissionEffect);
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

/** Same location resolution as `getMissionTargetLocationId` in `gameState` (avoid import cycle). */
function missionTargetLocationId(target: MissionTarget): string | null {
  if (target.kind === "location") {
    return target.locationId;
  }
  if (target.kind === "asset") {
    return target.locationId;
  }
  return null;
}

function applySecurityLevelDelta(
  catalog: ContentCatalog,
  states: LocationSecurityState[],
  target: MissionTarget,
  delta: number,
): LocationSecurityState[] {
  const locationId = missionTargetLocationId(target);
  if (locationId === null) {
    return states;
  }
  const cap = maxSecurityLevelForLocation(catalog, locationId);
  return states.map((s) => {
    if (s.locationId !== locationId) {
      return s;
    }
    const next = Math.max(0, Math.min(cap, s.securityLevel + delta));
    return { ...s, securityLevel: next as 0 | 1 | 2 | 3 };
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

function applyRevealAllHiddenAtLocation(
  placements: LocationAssetPlacement[],
  target: MissionTarget,
): LocationAssetPlacement[] {
  const locationId = missionTargetLocationId(target);
  if (locationId === null) {
    return placements;
  }
  return placements.map((p) => {
    if (p.locationId !== locationId) {
      return p;
    }
    return {
      ...p,
      slots: p.slots.map((slot) => {
        if (!isOccupiedAssetSlot(slot)) {
          return slot;
        }
        if (slot.visibility === "revealed") {
          return slot;
        }
        return { kind: "occupied", assetId: slot.assetId, visibility: "revealed" };
      }),
    };
  });
}

function applyStealAllAssetsAtLocation(
  placements: LocationAssetPlacement[],
  target: MissionTarget,
  player: PlayerState,
): { placements: LocationAssetPlacement[]; player: PlayerState; events: ActivityEvent[] } {
  const events: ActivityEvent[] = [];
  const locationId = missionTargetLocationId(target);
  if (locationId === null) {
    return { placements, player, events };
  }
  let nextPlacements = applyRevealAllHiddenAtLocation(placements, target);
  const pIdx = nextPlacements.findIndex((p) => p.locationId === locationId);
  if (pIdx === -1) {
    return { placements: nextPlacements, player, events };
  }
  const placement = nextPlacements[pIdx];
  const gained = new Map<string, number>();
  const nextSlots = placement.slots.map((slot) => {
    if (!isOccupiedAssetSlot(slot)) {
      return slot;
    }
    gained.set(slot.assetId, (gained.get(slot.assetId) ?? 0) + 1);
    return { kind: "empty" as const };
  });
  if (gained.size === 0) {
    return { placements: nextPlacements, player, events };
  }
  const nextAssets = { ...player.assets };
  for (const [assetId, qty] of gained) {
    nextAssets[assetId] = (nextAssets[assetId] ?? 0) + qty;
    events.push({ kind: "asset_gained", assetId, quantity: qty });
  }
  nextPlacements = nextPlacements.map((p, i) =>
    i === pIdx ? { ...p, slots: nextSlots } : p,
  );
  return {
    placements: nextPlacements,
    player: { ...player, assets: nextAssets },
    events,
  };
}

function applyStealAllRevealedAssetsAtLocation(
  placements: LocationAssetPlacement[],
  target: MissionTarget,
  player: PlayerState,
): { placements: LocationAssetPlacement[]; player: PlayerState; events: ActivityEvent[] } {
  const events: ActivityEvent[] = [];
  const locationId = missionTargetLocationId(target);
  if (locationId === null) {
    return { placements, player, events };
  }
  const pIdx = placements.findIndex((p) => p.locationId === locationId);
  if (pIdx === -1) {
    return { placements, player, events };
  }
  const placement = placements[pIdx];
  const gained = new Map<string, number>();
  const nextSlots = placement.slots.map((slot) => {
    if (!isOccupiedAssetSlot(slot) || slot.visibility !== "revealed") {
      return slot;
    }
    gained.set(slot.assetId, (gained.get(slot.assetId) ?? 0) + 1);
    return { kind: "empty" as const };
  });
  if (gained.size === 0) {
    return { placements, player, events };
  }
  const nextAssets = { ...player.assets };
  for (const [assetId, qty] of gained) {
    nextAssets[assetId] = (nextAssets[assetId] ?? 0) + qty;
    events.push({ kind: "asset_gained", assetId, quantity: qty });
  }
  const nextPlacements = placements.map((p, i) =>
    i === pIdx ? { ...p, slots: nextSlots } : p,
  );
  return {
    placements: nextPlacements,
    player: { ...player, assets: nextAssets },
    events,
  };
}

function applyGainAssets(
  player: PlayerState,
  effect: Extract<MissionEffect, { kind: "gain_assets" }>,
): { player: PlayerState; events: ActivityEvent[] } {
  const events: ActivityEvent[] = [];
  const counts = new Map<string, number>();
  for (const id of effect.assetIds) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const nextAssets = { ...player.assets };
  for (const [assetId, qty] of counts) {
    nextAssets[assetId] = (nextAssets[assetId] ?? 0) + qty;
    events.push({ kind: "asset_gained", assetId, quantity: qty });
  }
  return { player: { ...player, assets: nextAssets }, events };
}

function applyExchangeAssets(
  player: PlayerState,
  effect: Extract<MissionEffect, { kind: "exchange_assets" }>,
): { player: PlayerState; events: ActivityEvent[] } {
  const events: ActivityEvent[] = [];
  let nextAssets = { ...player.assets };

  const removeCounts = new Map<string, number>();
  for (const id of effect.removeAssetIds) {
    removeCounts.set(id, (removeCounts.get(id) ?? 0) + 1);
  }
  for (const [assetId, qty] of removeCounts) {
    const have = nextAssets[assetId] ?? 0;
    const remove = Math.min(qty, have);
    if (remove <= 0) {
      continue;
    }
    const left = have - remove;
    if (left <= 0) {
      delete nextAssets[assetId];
    } else {
      nextAssets[assetId] = left;
    }
    events.push({ kind: "asset_lost", assetId, quantity: remove });
  }

  const gainCounts = new Map<string, number>();
  for (const id of effect.gainAssetIds) {
    gainCounts.set(id, (gainCounts.get(id) ?? 0) + 1);
  }
  for (const [assetId, qty] of gainCounts) {
    nextAssets[assetId] = (nextAssets[assetId] ?? 0) + qty;
    events.push({ kind: "asset_gained", assetId, quantity: qty });
  }

  return { player: { ...player, assets: nextAssets }, events };
}

function applyAddTargetMinionTraits(
  player: PlayerState,
  target: MissionTarget,
  effect: Extract<MissionEffect, { kind: "add_target_minion_traits" }>,
): PlayerState {
  if (target.kind !== "minion") {
    return player;
  }
  const { instanceId } = target;
  let mutated = false;
  const minions = player.minions.map((m) => {
    if (m.instanceId !== instanceId) {
      return m;
    }
    const existing = new Set(m.traitIds);
    const next = [...m.traitIds];
    for (const tid of effect.traitIds) {
      if (!existing.has(tid)) {
        existing.add(tid);
        next.push(tid);
      }
    }
    if (next.length === m.traitIds.length) {
      return m;
    }
    mutated = true;
    return { ...m, traitIds: next };
  });
  if (!mutated) {
    return player;
  }
  return { ...player, minions };
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
 * the end. Returns updated player, placements, security states, and activity rows (e.g. `asset_gained`).
 */
export function applyMissionEffects(
  state: GameState,
  effects: readonly MissionEffect[],
  activeMission: ActiveMission,
  catalog: ContentCatalog,
): {
  player: PlayerState;
  locationAssetSlots: LocationAssetPlacement[];
  locationSecurityStates: LocationSecurityState[];
  events: ActivityEvent[];
} {
  const target = activeMission.target;
  const ordered = orderedMissionEffects(effects);
  let player = { ...state.player };
  let locationAssetSlots = state.locationAssetSlots.map((p) => ({
    ...p,
    slots: [...p.slots],
  }));
  let locationSecurityStates = state.locationSecurityStates.map((s) => ({ ...s }));
  const events: ActivityEvent[] = [];

  for (const effect of ordered) {
    if (effect.kind === "reveal_target_asset") {
      locationAssetSlots = applyRevealTargetAsset(locationAssetSlots, target);
    } else if (effect.kind === "reveal_all_hidden_assets_at_location") {
      locationAssetSlots = applyRevealAllHiddenAtLocation(locationAssetSlots, target);
    } else if (effect.kind === "steal_target_asset") {
      const r = applyStealTargetAsset(locationAssetSlots, target, player);
      locationAssetSlots = r.placements;
      player = r.player;
      events.push(...r.events);
    } else if (effect.kind === "steal_all_assets_at_location") {
      const r = applyStealAllAssetsAtLocation(locationAssetSlots, target, player);
      locationAssetSlots = r.placements;
      player = r.player;
      events.push(...r.events);
    } else if (effect.kind === "steal_all_revealed_assets_at_location") {
      const r = applyStealAllRevealedAssetsAtLocation(locationAssetSlots, target, player);
      locationAssetSlots = r.placements;
      player = r.player;
      events.push(...r.events);
    } else if (effect.kind === "gain_assets") {
      const r = applyGainAssets(player, effect);
      player = r.player;
      events.push(...r.events);
    } else if (effect.kind === "exchange_assets") {
      const r = applyExchangeAssets(player, effect);
      player = r.player;
      events.push(...r.events);
    } else if (effect.kind === "security_level_delta") {
      locationSecurityStates = applySecurityLevelDelta(
        catalog,
        locationSecurityStates,
        target,
        effect.delta,
      );
    } else if (effect.kind === "add_target_minion_traits") {
      player = applyAddTargetMinionTraits(player, target, effect);
    } else if (effect.kind === "unlock_lair_mission") {
      /* Lair pool update runs in executePlan after this pass. */
    } else {
      player = applyPlayerStatDeltas(player, effect);
    }
  }

  player = { ...player, infamy: clampInfamy(player.infamy) };
  return { player, locationAssetSlots, locationSecurityStates, events };
}
