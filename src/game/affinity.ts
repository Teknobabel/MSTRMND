/**
 * Affinity — the single source of truth behind every dynamic trait. Two tracks, one design:
 *
 * - **Minion pair affinity.** Every **unordered** pair of roster minions shares one integer
 *   `score` starting at 0. Missions they run together move it; crossing a threshold walks the
 *   pair along `hated → rival → neutral → friend → ally`.
 * - **Minion-location affinity.** Every minion has one score per location. Missions there move
 *   it; crossing a threshold walks the minion along `wanted → neutral → hero`.
 *
 * Neither score is ever shown to the player — only the band it lands in. Three rules keep both
 * tracks stable and keep the rest of the codebase from having to know about scores:
 *
 * - **Hysteresis.** A band is entered at its threshold but only given up once the score falls
 *   `hysteresis` further back, so a score parked on a threshold does not flip every turn.
 * - **Determinism.** Nothing here rolls. Both tracks moved from per-resolve random rolls to
 *   fixed, designer-tuned deltas.
 * - **Projection.** `MinionInstance.dynamicTraits` no longer *stores* anything; the whole array
 *   is rebuilt from these two tables by {@link syncMinionDynamicTraits}, so the existing
 *   roster/assign/hire UI keeps rendering pills without knowing about scores. Because the pair
 *   (not the minion) owns a relationship, its success modifier applies **once per pair** on a
 *   mission; a location standing belongs to one minion, so it applies per minion.
 */
import type {
  ContentCatalog,
  DynamicTrait,
  LocationAffinityConfig,
  MinionAffinityConfig,
  MinionInstance,
  MinionLocationAffinity,
  MinionLocationStanding,
  MinionLocationStandingChange,
  MinionPairAffinity,
  MinionRelationship,
  MinionRelationshipChange,
  MinionTemplateLocationAffinity,
  MinionTemplatePairAffinity,
  MissionSource,
  StartingDynamicTrait,
} from "./types";
import { DEFAULT_BALANCE } from "./types";

/** Track order; index arithmetic elsewhere relies on this being contiguous and ordered. */
const RELATIONSHIP_RANK: Record<MinionRelationship, number> = {
  hated: -2,
  rival: -1,
  neutral: 0,
  friend: 1,
  ally: 2,
};

const RELATIONSHIP_BY_RANK: Record<number, MinionRelationship> = {
  [-2]: "hated",
  [-1]: "rival",
  0: "neutral",
  1: "friend",
  2: "ally",
};

/** The four minion-to-minion dynamic trait kinds, indexed by relationship. `neutral` has none. */
const BOND_KIND_BY_RELATIONSHIP = {
  hated: "hatred",
  rival: "rival",
  friend: "friend",
  ally: "ally",
} as const;

export function relationshipRank(rel: MinionRelationship): number {
  return RELATIONSHIP_RANK[rel];
}

/** Player-facing name for a band; `neutral` has no pill and is only used in change lines. */
export function relationshipLabel(rel: MinionRelationship): string {
  switch (rel) {
    case "hated":
      return "Hated";
    case "rival":
      return "Rivals";
    case "neutral":
      return "Neutral";
    case "friend":
      return "Friends";
    case "ally":
      return "Allies";
  }
}

/** Inclusive integer in `[min, max]`; returns `min` when the range is inverted or empty. */
function randInt(rng: () => number, min: number, max: number): number {
  if (max <= min) {
    return min;
  }
  return min + Math.floor(rng() * (max - min + 1));
}

function takeRandom<T>(pool: T[], rng: () => number): T | undefined {
  if (pool.length === 0) {
    return undefined;
  }
  return pool.splice(Math.floor(rng() * pool.length), 1)[0];
}

/** Orders a pair so one unordered pair always produces the same key and the same stored row. */
export function orderPair(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

/** Separator that cannot occur inside a content id, so keys never collide by concatenation. */
const KEY_SEP = "\u0000";

export function pairKey(a: string, b: string): string {
  const [x, y] = orderPair(a, b);
  return `${x}${KEY_SEP}${y}`;
}

export function findPairAffinity(
  affinities: readonly MinionPairAffinity[],
  a: string,
  b: string,
): MinionPairAffinity | undefined {
  const [x, y] = orderPair(a, b);
  return affinities.find((p) => p.aInstanceId === x && p.bInstanceId === y);
}

/** The pair's current band, or `neutral` when the pair has never shared a mission. */
export function relationshipBetween(
  affinities: readonly MinionPairAffinity[],
  a: string,
  b: string,
): MinionRelationship {
  return findPairAffinity(affinities, a, b)?.relationship ?? "neutral";
}

/**
 * Score at which a band is entered, by rank. Positive ranks read the ascending thresholds,
 * negative ranks the descending ones.
 */
function entryThreshold(rank: number, cfg: MinionAffinityConfig): number {
  switch (rank) {
    case 2:
      return cfg.allyThreshold;
    case 1:
      return cfg.friendThreshold;
    case -1:
      return cfg.rivalThreshold;
    case -2:
      return cfg.hatedThreshold;
    default:
      return 0;
  }
}

/**
 * Next band for `score` given the band the pair is already in.
 *
 * Moving **outward** (further from neutral) needs the plain threshold. Moving **back toward
 * neutral** needs the score to have retreated `hysteresis` past the threshold it came in on, so
 * a pair oscillating by ±1 around a threshold keeps the band it earned.
 */
export function nextRelationship(
  score: number,
  current: MinionRelationship,
  cfg: MinionAffinityConfig = DEFAULT_BALANCE.minionAffinity,
): MinionRelationship {
  const hysteresis = Math.max(0, cfg.hysteresis);
  const currentRank = RELATIONSHIP_RANK[current];

  /* Positive side: highest band whose entry (or exit, when already at/above it) is met. */
  for (const rank of [2, 1]) {
    const threshold = entryThreshold(rank, cfg);
    const bar = currentRank >= rank ? threshold - hysteresis : threshold;
    if (score >= bar) {
      return RELATIONSHIP_BY_RANK[rank]!;
    }
  }
  /* Negative side, mirrored. */
  for (const rank of [-2, -1]) {
    const threshold = entryThreshold(rank, cfg);
    const bar = currentRank <= rank ? threshold + hysteresis : threshold;
    if (score <= bar) {
      return RELATIONSHIP_BY_RANK[rank]!;
    }
  }
  return "neutral";
}

/**
 * Score change every participant pair takes when a mission finishes. `isLairRaid` wins over
 * `source` — the raid arrives through the event slot but is its own thing.
 */
export function affinityDeltaForResolve(
  source: MissionSource,
  isLairRaid: boolean,
  success: boolean,
  cfg: MinionAffinityConfig = DEFAULT_BALANCE.minionAffinity,
): number {
  if (isLairRaid) {
    return success ? cfg.lairRaidSuccess : cfg.lairRaidFailure;
  }
  switch (source) {
    case "event":
      return success ? cfg.eventSuccess : cfg.eventFailure;
    case "omega":
      return success ? cfg.omegaSuccess : cfg.omegaFailure;
    case "lair":
      return success ? cfg.missionSuccess : cfg.missionFailure;
  }
}

function withPairScore(
  affinities: readonly MinionPairAffinity[],
  a: string,
  b: string,
  score: number,
  cfg: MinionAffinityConfig,
): { next: MinionPairAffinity[]; change: MinionRelationshipChange | null } {
  const [x, y] = orderPair(a, b);
  const idx = affinities.findIndex((p) => p.aInstanceId === x && p.bInstanceId === y);
  const from: MinionRelationship = idx === -1 ? "neutral" : affinities[idx]!.relationship;
  const to = nextRelationship(score, from, cfg);
  const row: MinionPairAffinity = {
    aInstanceId: x,
    bInstanceId: y,
    score,
    relationship: to,
  };
  const next =
    idx === -1 ? [...affinities, row] : affinities.map((p, i) => (i === idx ? row : p));
  return {
    next,
    change: to === from ? null : { aInstanceId: x, bInstanceId: y, from, to },
  };
}

/** Sets a pair's score outright (seeding, tests); re-derives the band with hysteresis. */
export function setPairAffinityScore(
  affinities: readonly MinionPairAffinity[],
  a: string,
  b: string,
  score: number,
  cfg: MinionAffinityConfig = DEFAULT_BALANCE.minionAffinity,
): MinionPairAffinity[] {
  if (a === b) {
    return [...affinities];
  }
  return withPairScore(affinities, a, b, score, cfg).next;
}

/**
 * Applies `delta` to every unordered pair among `participantInstanceIds` — once per pair, so a
 * three-minion mission moves three scores, not six. Returns the pairs that changed band.
 */
export function applyMissionAffinity(
  affinities: readonly MinionPairAffinity[],
  participantInstanceIds: readonly string[],
  delta: number,
  cfg: MinionAffinityConfig = DEFAULT_BALANCE.minionAffinity,
): { next: MinionPairAffinity[]; changes: MinionRelationshipChange[] } {
  /* A solo mission has no pairs, and a zero delta cannot cross anything. */
  if (participantInstanceIds.length < 2 || delta === 0) {
    return { next: [...affinities], changes: [] };
  }
  const ids = [...new Set(participantInstanceIds)];
  let next = [...affinities];
  const changes: MinionRelationshipChange[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = ids[i]!;
      const b = ids[j]!;
      const score = (findPairAffinity(next, a, b)?.score ?? 0) + delta;
      const applied = withPairScore(next, a, b, score, cfg);
      next = applied.next;
      if (applied.change !== null) {
        changes.push(applied.change);
      }
    }
  }
  return { next, changes };
}

/** Score a designer-authored starting bond seeds the pair at: the band's own entry threshold. */
export function seedScoreForRelationship(
  rel: MinionRelationship,
  cfg: MinionAffinityConfig = DEFAULT_BALANCE.minionAffinity,
): number {
  return entryThreshold(RELATIONSHIP_RANK[rel], cfg);
}

function relationshipForBondKind(kind: string): MinionRelationship | null {
  switch (kind) {
    case "friend":
      return "friend";
    case "ally":
      return "ally";
    case "rival":
      return "rival";
    case "hatred":
      return "hated";
    default:
      return null;
  }
}

/**
 * Seeds pair scores from `startingDynamicTraits` on the roster's templates. A bond only lands
 * once both minions are actually hired, so this runs after every roster change; pairs that
 * already have a row are left alone (a run's history outranks the designer's opening state).
 */
export function seedStartingAffinities(
  affinities: readonly MinionPairAffinity[],
  minions: readonly MinionInstance[],
  startingByTemplateId: (templateId: string) => readonly StartingDynamicTrait[] | undefined,
  cfg: MinionAffinityConfig = DEFAULT_BALANCE.minionAffinity,
): MinionPairAffinity[] {
  let next = [...affinities];
  for (const owner of minions) {
    for (const s of startingByTemplateId(owner.templateId) ?? []) {
      if (!("targetMinionTemplateId" in s)) {
        continue;
      }
      const rel = relationshipForBondKind(s.kind);
      if (rel === null) {
        continue;
      }
      const target = minions.find(
        (m) => m.templateId === s.targetMinionTemplateId && m.instanceId !== owner.instanceId,
      );
      if (target === undefined) {
        continue;
      }
      if (findPairAffinity(next, owner.instanceId, target.instanceId) !== undefined) {
        continue;
      }
      next = setPairAffinityScore(
        next,
        owner.instanceId,
        target.instanceId,
        seedScoreForRelationship(rel, cfg),
        cfg,
      );
    }
  }
  return next;
}

/**
 * Rebuilds every minion's `dynamicTraits` from both affinity tables — nothing on the instance
 * survives, because nothing on the instance is authoritative any more.
 *
 * Both halves of a pair get the matching bond, which is what makes a relationship symmetric on
 * the roster cards; a location standing belongs to one minion and appears once.
 */
export function syncMinionDynamicTraits(
  minions: readonly MinionInstance[],
  pairAffinities: readonly MinionPairAffinity[],
  locationAffinities: readonly MinionLocationAffinity[] = [],
): MinionInstance[] {
  const onRoster = new Set(minions.map((m) => m.instanceId));
  const traitsByOwner = new Map<string, DynamicTrait[]>();
  const push = (owner: string, trait: DynamicTrait): void => {
    const list = traitsByOwner.get(owner) ?? [];
    list.push(trait);
    traitsByOwner.set(owner, list);
  };

  for (const st of locationAffinities) {
    if (st.standing === "neutral" || !onRoster.has(st.minionInstanceId)) {
      continue;
    }
    push(st.minionInstanceId, { kind: st.standing, locationId: st.locationId });
  }
  for (const pair of pairAffinities) {
    if (pair.relationship === "neutral") {
      continue;
    }
    if (!onRoster.has(pair.aInstanceId) || !onRoster.has(pair.bInstanceId)) {
      continue;
    }
    const kind = BOND_KIND_BY_RELATIONSHIP[pair.relationship];
    push(pair.aInstanceId, { kind, targetMinionInstanceId: pair.bInstanceId });
    push(pair.bInstanceId, { kind, targetMinionInstanceId: pair.aInstanceId });
  }
  return minions.map((m) => ({ ...m, dynamicTraits: traitsByOwner.get(m.instanceId) ?? [] }));
}

/* ------------------------------------------------------------------------------------------------
 * Minion-location affinity — the Hero / Wanted track
 *
 * Same design as the pair track with one threshold each way instead of two, since Hero and
 * Wanted have no deeper tier. Every participant of a mission at a site moves their own score
 * there; the pair track is untouched by this.
 * ---------------------------------------------------------------------------------------------- */

const STANDING_RANK: Record<MinionLocationStanding, number> = {
  wanted: -1,
  neutral: 0,
  hero: 1,
};

/** Player-facing name for a standing; `neutral` has no pill and only shows in change lines. */
export function standingLabel(standing: MinionLocationStanding): string {
  switch (standing) {
    case "wanted":
      return "Wanted";
    case "neutral":
      return "Neutral";
    case "hero":
      return "Hero";
  }
}

export function locationKey(minionInstanceId: string, locationId: string): string {
  return `${minionInstanceId}${KEY_SEP}${locationId}`;
}

export function findLocationAffinity(
  affinities: readonly MinionLocationAffinity[],
  minionInstanceId: string,
  locationId: string,
): MinionLocationAffinity | undefined {
  return affinities.find(
    (a) => a.minionInstanceId === minionInstanceId && a.locationId === locationId,
  );
}

/** The minion's current standing at that site, or `neutral` when they have no history there. */
export function standingAt(
  affinities: readonly MinionLocationAffinity[],
  minionInstanceId: string,
  locationId: string,
): MinionLocationStanding {
  return findLocationAffinity(affinities, minionInstanceId, locationId)?.standing ?? "neutral";
}

/**
 * Next standing for `score` given the standing already held. Mirrors {@link nextRelationship}:
 * outward moves need the plain threshold, moves back toward neutral need the score to have
 * retreated a full `hysteresis` past it.
 */
export function nextStanding(
  score: number,
  current: MinionLocationStanding,
  cfg: LocationAffinityConfig = DEFAULT_BALANCE.locationAffinity,
): MinionLocationStanding {
  const hysteresis = Math.max(0, cfg.hysteresis);
  const rank = STANDING_RANK[current];
  const heroBar = rank >= 1 ? cfg.heroThreshold - hysteresis : cfg.heroThreshold;
  if (score >= heroBar) {
    return "hero";
  }
  const wantedBar = rank <= -1 ? cfg.wantedThreshold + hysteresis : cfg.wantedThreshold;
  if (score <= wantedBar) {
    return "wanted";
  }
  return "neutral";
}

/** Score change every participant takes at the mission's own location. */
export function locationAffinityDeltaForResolve(
  success: boolean,
  cfg: LocationAffinityConfig = DEFAULT_BALANCE.locationAffinity,
): number {
  return success ? cfg.missionSuccess : cfg.missionFailure;
}

function withLocationScore(
  affinities: readonly MinionLocationAffinity[],
  minionInstanceId: string,
  locationId: string,
  score: number,
  cfg: LocationAffinityConfig,
): { next: MinionLocationAffinity[]; change: MinionLocationStandingChange | null } {
  const idx = affinities.findIndex(
    (a) => a.minionInstanceId === minionInstanceId && a.locationId === locationId,
  );
  const from: MinionLocationStanding = idx === -1 ? "neutral" : affinities[idx]!.standing;
  const to = nextStanding(score, from, cfg);
  const row: MinionLocationAffinity = { minionInstanceId, locationId, score, standing: to };
  const next =
    idx === -1 ? [...affinities, row] : affinities.map((a, i) => (i === idx ? row : a));
  return {
    next,
    change: to === from ? null : { minionInstanceId, locationId, from, to },
  };
}

/** Sets a minion's score at one site outright (seeding, tests); re-derives with hysteresis. */
export function setLocationAffinityScore(
  affinities: readonly MinionLocationAffinity[],
  minionInstanceId: string,
  locationId: string,
  score: number,
  cfg: LocationAffinityConfig = DEFAULT_BALANCE.locationAffinity,
): MinionLocationAffinity[] {
  return withLocationScore(affinities, minionInstanceId, locationId, score, cfg).next;
}

/**
 * Applies `delta` to every participant's score at `locationId`. Missions with no site
 * (`minion` / `none` targets) pass `null` and change nothing.
 */
export function applyLocationAffinity(
  affinities: readonly MinionLocationAffinity[],
  participantInstanceIds: readonly string[],
  locationId: string | null,
  delta: number,
  cfg: LocationAffinityConfig = DEFAULT_BALANCE.locationAffinity,
): { next: MinionLocationAffinity[]; changes: MinionLocationStandingChange[] } {
  if (locationId === null || delta === 0) {
    return { next: [...affinities], changes: [] };
  }
  let next = [...affinities];
  const changes: MinionLocationStandingChange[] = [];
  for (const id of new Set(participantInstanceIds)) {
    const score = (findLocationAffinity(next, id, locationId)?.score ?? 0) + delta;
    const applied = withLocationScore(next, id, locationId, score, cfg);
    next = applied.next;
    if (applied.change !== null) {
      changes.push(applied.change);
    }
  }
  return { next, changes };
}

/** Scores strictly inside the neutral band and never 0 — a lean, not yet a standing. */
function neutralStandingScores(cfg: LocationAffinityConfig): number[] {
  const out: number[] = [];
  for (let v = cfg.wantedThreshold + 1; v <= cfg.heroThreshold - 1; v += 1) {
    if (v !== 0) {
      out.push(v);
    }
  }
  return out;
}

/**
 * Rolls a run's opening standings over every (minion template × run location) slot, the same way
 * {@link rollStartingTemplateAffinities} does for pairs:
 *
 * - **one** random slot opens as a **Hero** — a score in `[heroThreshold, heroThreshold +
 *   hysteresis]`, comfortably inside the band rather than balanced on its edge;
 * - **one other** opens as **Wanted**, mirrored;
 * - **half** the remaining slots (rounded down) get a non-zero score strictly inside the neutral
 *   band, so a minion leans toward or away from a place without the player seeing it;
 * - everyone else starts flat at 0.
 *
 * Locations come from the run, not the whole catalog, so a seed can never point at a site this
 * run never plays.
 */
export function rollStartingTemplateLocationAffinities(
  minionTemplateIds: readonly string[],
  locationIds: readonly string[],
  rng: () => number,
  cfg: LocationAffinityConfig = DEFAULT_BALANCE.locationAffinity,
): MinionTemplateLocationAffinity[] {
  const pool: [string, string][] = [];
  for (const templateId of new Set(minionTemplateIds)) {
    for (const locationId of new Set(locationIds)) {
      pool.push([templateId, locationId]);
    }
  }
  const out: MinionTemplateLocationAffinity[] = [];
  const push = (slot: [string, string] | undefined, score: number): void => {
    if (slot === undefined || score === 0) {
      return;
    }
    out.push({ minionTemplateId: slot[0], locationId: slot[1], score });
  };

  const hysteresis = Math.max(0, cfg.hysteresis);
  push(takeRandom(pool, rng), randInt(rng, cfg.heroThreshold, cfg.heroThreshold + hysteresis));
  push(
    takeRandom(pool, rng),
    randInt(rng, cfg.wantedThreshold - hysteresis, cfg.wantedThreshold),
  );

  const lean = neutralStandingScores(cfg);
  const weakCount = Math.floor(pool.length / 2);
  for (let i = 0; i < weakCount; i += 1) {
    push(takeRandom(pool, rng), lean.length === 0 ? 0 : lean[Math.floor(rng() * lean.length)]!);
  }
  return out;
}

/** Score a designer-authored starting standing seeds the minion at: the band's own threshold. */
export function seedScoreForStanding(
  standing: MinionLocationStanding,
  cfg: LocationAffinityConfig = DEFAULT_BALANCE.locationAffinity,
): number {
  switch (standing) {
    case "hero":
      return cfg.heroThreshold;
    case "wanted":
      return cfg.wantedThreshold;
    case "neutral":
      return 0;
  }
}

function standingForTraitKind(kind: string): MinionLocationStanding | null {
  switch (kind) {
    case "hero":
      return "hero";
    case "wanted":
      return "wanted";
    default:
      return null;
  }
}

/**
 * Seeds location scores from `startingDynamicTraits` on the roster's templates — the Hero/Wanted
 * counterpart to {@link seedStartingAffinities}. Unlike a bond, a standing needs nobody else on
 * the roster, so it lands the moment its minion is hired; slots that already have a row are left
 * alone, since a run's history outranks the designer's opening state.
 */
export function seedStartingLocationAffinities(
  affinities: readonly MinionLocationAffinity[],
  minions: readonly MinionInstance[],
  startingByTemplateId: (templateId: string) => readonly StartingDynamicTrait[] | undefined,
  cfg: LocationAffinityConfig = DEFAULT_BALANCE.locationAffinity,
): MinionLocationAffinity[] {
  let next = [...affinities];
  for (const owner of minions) {
    for (const s of startingByTemplateId(owner.templateId) ?? []) {
      if ("targetMinionTemplateId" in s) {
        continue;
      }
      const standing = standingForTraitKind(s.kind);
      if (standing === null) {
        continue;
      }
      if (findLocationAffinity(next, owner.instanceId, s.locationId) !== undefined) {
        continue;
      }
      next = setLocationAffinityScore(
        next,
        owner.instanceId,
        s.locationId,
        seedScoreForStanding(standing, cfg),
        cfg,
      );
    }
  }
  return next;
}

/**
 * Lands the run-start location table on the roster's real minions. Skips any slot the minion
 * already has a row for — a run's own history outranks the roll.
 */
export function applyTemplateLocationSeeds(
  affinities: readonly MinionLocationAffinity[],
  minions: readonly MinionInstance[],
  seeds: readonly MinionTemplateLocationAffinity[],
  cfg: LocationAffinityConfig = DEFAULT_BALANCE.locationAffinity,
): MinionLocationAffinity[] {
  let next = [...affinities];
  if (seeds.length === 0) {
    return next;
  }
  const byTemplate = new Map<string, MinionTemplateLocationAffinity[]>();
  for (const seed of seeds) {
    const list = byTemplate.get(seed.minionTemplateId) ?? [];
    list.push(seed);
    byTemplate.set(seed.minionTemplateId, list);
  }
  for (const m of minions) {
    for (const seed of byTemplate.get(m.templateId) ?? []) {
      if (seed.score === 0) {
        continue;
      }
      if (findLocationAffinity(next, m.instanceId, seed.locationId) !== undefined) {
        continue;
      }
      next = setLocationAffinityScore(next, m.instanceId, seed.locationId, seed.score, cfg);
    }
  }
  return next;
}

/* ------------------------------------------------------------------------------------------------
 * Run-start seeding
 *
 * The roster is empty at turn 1, so there are no instance pairs to seed yet. Instead a run rolls
 * a fixed table over the catalog's minion **templates**, and each entry lands on the real pair
 * the first time both of those minions are on the roster together.
 * ---------------------------------------------------------------------------------------------- */

/** Scores strictly inside the neutral band and never 0 — a lean, not yet a relationship. */
function neutralBandScores(cfg: MinionAffinityConfig): number[] {
  const out: number[] = [];
  for (let v = cfg.rivalThreshold + 1; v <= cfg.friendThreshold - 1; v += 1) {
    if (v !== 0) {
      out.push(v);
    }
  }
  return out;
}

/**
 * Rolls a run's opening affinities over `minionTemplateIds`:
 *
 * - **one** random pair starts already Friends — a score in `[friendThreshold, allyThreshold − 1]`,
 *   held below the second threshold so no run opens on the strongest bond in the game;
 * - **one other** pair starts already Rivals, mirrored into `[hatedThreshold + 1, rivalThreshold]`;
 * - **half** the remaining pairs (rounded down) get a non-zero score strictly inside the neutral
 *   band, so they lean one way without showing the player anything yet;
 * - everyone else starts flat at 0.
 *
 * Bounds are derived from the thresholds rather than tuned separately, so retuning the track
 * rescales the opening spread with it.
 */
export function rollStartingTemplateAffinities(
  minionTemplateIds: readonly string[],
  rng: () => number,
  cfg: MinionAffinityConfig = DEFAULT_BALANCE.minionAffinity,
): MinionTemplatePairAffinity[] {
  const ids = [...new Set(minionTemplateIds)];
  const pool: [string, string][] = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      pool.push([ids[i]!, ids[j]!]);
    }
  }
  const out: MinionTemplatePairAffinity[] = [];
  const push = (pair: [string, string] | undefined, score: number): void => {
    if (pair === undefined || score === 0) {
      return;
    }
    const [a, b] = orderPair(pair[0], pair[1]);
    out.push({ aTemplateId: a, bTemplateId: b, score });
  };

  push(
    takeRandom(pool, rng),
    randInt(rng, cfg.friendThreshold, Math.max(cfg.friendThreshold, cfg.allyThreshold - 1)),
  );
  push(
    takeRandom(pool, rng),
    randInt(rng, Math.min(cfg.rivalThreshold, cfg.hatedThreshold + 1), cfg.rivalThreshold),
  );

  const lean = neutralBandScores(cfg);
  const weakCount = Math.floor(pool.length / 2);
  for (let i = 0; i < weakCount; i += 1) {
    push(takeRandom(pool, rng), lean.length === 0 ? 0 : lean[Math.floor(rng() * lean.length)]!);
  }
  return out;
}

/**
 * Lands the run-start template table on the roster's real instance pairs. Runs after
 * {@link seedStartingAffinities} so a designer-authored bond always outranks the roll, and skips
 * any pair that already has a row — a run's own history outranks both.
 */
export function applyTemplatePairSeeds(
  affinities: readonly MinionPairAffinity[],
  minions: readonly MinionInstance[],
  seeds: readonly MinionTemplatePairAffinity[],
  cfg: MinionAffinityConfig = DEFAULT_BALANCE.minionAffinity,
): MinionPairAffinity[] {
  let next = [...affinities];
  if (seeds.length === 0) {
    return next;
  }
  const scoreByPair = new Map(
    seeds.map((s) => [pairKey(s.aTemplateId, s.bTemplateId), s.score] as const),
  );
  for (let i = 0; i < minions.length; i += 1) {
    for (let j = i + 1; j < minions.length; j += 1) {
      const a = minions[i]!;
      const b = minions[j]!;
      if (findPairAffinity(next, a.instanceId, b.instanceId) !== undefined) {
        continue;
      }
      const score = scoreByPair.get(pairKey(a.templateId, b.templateId));
      if (score === undefined || score === 0) {
        continue;
      }
      next = setPairAffinityScore(next, a.instanceId, b.instanceId, score, cfg);
    }
  }
  return next;
}

function minionDisplayName(
  catalog: ContentCatalog,
  roster: readonly MinionInstance[],
  instanceId: string,
): string {
  const inst = roster.find((m) => m.instanceId === instanceId);
  if (inst === undefined) {
    return instanceId;
  }
  return catalog.minions.find((t) => t.id === inst.templateId)?.name ?? inst.templateId;
}

/** One report line for a pair that crossed a threshold on this resolve. */
export function formatRelationshipChange(
  catalog: ContentCatalog,
  roster: readonly MinionInstance[],
  change: MinionRelationshipChange,
): string {
  const a = minionDisplayName(catalog, roster, change.aInstanceId);
  const b = minionDisplayName(catalog, roster, change.bInstanceId);
  if (change.to === "neutral") {
    return `${a} and ${b} are no longer ${relationshipLabel(change.from)}.`;
  }
  const deepened =
    Math.abs(RELATIONSHIP_RANK[change.to]) > Math.abs(RELATIONSHIP_RANK[change.from]) &&
    RELATIONSHIP_RANK[change.to] * RELATIONSHIP_RANK[change.from] > 0;
  if (deepened) {
    return change.to === "ally"
      ? `${a} and ${b} became Allies.`
      : `${a} and ${b} now hate each other.`;
  }
  switch (change.to) {
    case "friend":
      return `${a} and ${b} became Friends.`;
    case "ally":
      return `${a} and ${b} became Allies.`;
    case "rival":
      return `${a} and ${b} became Rivals.`;
    case "hated":
      return `${a} and ${b} now hate each other.`;
  }
}

/** `good` when the pair moved toward friendship, `bad` when it moved toward hatred. */
export function relationshipChangeIsPositive(change: MinionRelationshipChange): boolean {
  return RELATIONSHIP_RANK[change.to] > RELATIONSHIP_RANK[change.from];
}

/** One report line for a minion whose standing at a site crossed a threshold this resolve. */
export function formatStandingChange(
  catalog: ContentCatalog,
  roster: readonly MinionInstance[],
  change: MinionLocationStandingChange,
): string {
  const who = minionDisplayName(catalog, roster, change.minionInstanceId);
  const where =
    catalog.locations.find((l) => l.id === change.locationId)?.name ?? change.locationId;
  switch (change.to) {
    case "hero":
      return `${who} became a Hero of ${where}.`;
    case "wanted":
      return `${who} became Wanted in ${where}.`;
    case "neutral":
      return change.from === "hero"
        ? `${who} is no longer a Hero of ${where}.`
        : `${who} is no longer Wanted in ${where}.`;
  }
}

/** `good` when the minion moved toward Hero, `bad` when they moved toward Wanted. */
export function standingChangeIsPositive(change: MinionLocationStandingChange): boolean {
  return STANDING_RANK[change.to] > STANDING_RANK[change.from];
}
