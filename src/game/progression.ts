/**
 * Cross-session content unlocking: which masterminds, lairs and omega plans a player may pick.
 *
 * This is the player's progress, not the run's — the same split `ui/playerSettings.ts` makes,
 * and for the same reason. `createInitialGameState` rebuilds everything it owns from scratch on
 * every Deploy, so anything that has to survive a run cannot live in `GameState`. Unlocks live
 * in localStorage beside the settings and are read at the point of use.
 *
 * Three sources decide whether a card is pickable, and they are unioned in this order:
 *
 * 1. **`unlockedByDefault`** on the content row — the starting deck, authored in the editor.
 * 2. **Earned ids** in storage — what the player has unlocked since. Nothing writes these yet;
 *    {@link grantContentUnlock} is the door gameplay will come through, and it is already
 *    honoured everywhere the view is read, so wiring the award rules later touches no UI.
 * 3. **Unlock All Content** — the settings toggle, which opens the whole catalog without
 *    touching what has been earned, so turning it back off restores the real progress.
 *
 * Ids are matched against the catalog on the way out rather than on the way in: a save that
 * names a lair a later build removed simply stops matching, and keeping the dead id parked
 * means renaming it back restores the unlock.
 */

import type { ContentCatalog } from "./types";

/** The three slots the title screen fills, which are exactly the things that can be locked. */
export const UNLOCKABLE_KINDS = ["mastermind", "lair", "omegaPlan"] as const;

export type UnlockableKind = (typeof UNLOCKABLE_KINDS)[number];

/**
 * What the player has earned, per kind. A mastermind is keyed by `PlayerProfile.name` because
 * that is the only identity a profile has; the other two by template id.
 */
export type ContentUnlocks = {
  readonly [K in UnlockableKind]: readonly string[];
};

/** A player who has never unlocked anything: the authored starting deck and nothing else. */
export const NO_CONTENT_UNLOCKS: ContentUnlocks = {
  mastermind: [],
  lair: [],
  omegaPlan: [],
};

/** Where progress is parked between sessions. Versioned: the kinds will grow. */
export const CONTENT_UNLOCKS_STORAGE_KEY = "mastermind.unlocks.v1";

/** The slice of `Storage` this module needs — enough to hand it a fake in a test. */
export interface ContentUnlocksStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Every id in the catalog for a kind, in catalog order. */
export function catalogUnlockableIds(
  catalog: ContentCatalog,
  kind: UnlockableKind,
): string[] {
  switch (kind) {
    case "mastermind":
      return catalog.playerProfiles.map((p) => p.name);
    case "lair":
      return catalog.lairs.map((l) => l.id);
    case "omegaPlan":
      return catalog.omegaPlans.map((p) => p.id);
  }
}

/** The ids a brand-new save starts with: the rows the designer flagged `unlockedByDefault`. */
export function defaultUnlockedIds(
  catalog: ContentCatalog,
  kind: UnlockableKind,
): string[] {
  switch (kind) {
    case "mastermind":
      return catalog.playerProfiles.filter((p) => p.unlockedByDefault === true).map((p) => p.name);
    case "lair":
      return catalog.lairs.filter((l) => l.unlockedByDefault === true).map((l) => l.id);
    case "omegaPlan":
      return catalog.omegaPlans.filter((p) => p.unlockedByDefault === true).map((p) => p.id);
  }
}

/** Unique, non-empty strings out of anything; anything else in the array is dropped. */
function normalizeIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry !== "" && !out.includes(entry)) {
      out.push(entry);
    }
  }
  return out;
}

/**
 * Pull anything — a parsed storage read, a payload written by an older build — back to an
 * unlock record. Every kind falls to empty on its own, so one corrupt list costs that kind's
 * progress rather than all of it, and a kind added later reads as empty off an older payload.
 */
export function normalizeContentUnlocks(raw: unknown): ContentUnlocks {
  if (raw === null || typeof raw !== "object") {
    return NO_CONTENT_UNLOCKS;
  }
  const row = raw as Record<string, unknown>;
  return {
    mastermind: normalizeIdList(row.mastermind),
    lair: normalizeIdList(row.lair),
    omegaPlan: normalizeIdList(row.omegaPlan),
  };
}

/**
 * Read parked progress. Progress is worth more than an exception is: private-mode storage
 * throws on access in some browsers and unparsable JSON is as likely as none, so every failure
 * lands on "nothing earned yet" rather than taking the title screen down with it.
 */
export function loadContentUnlocks(storage: ContentUnlocksStorage | null): ContentUnlocks {
  if (storage === null) {
    return NO_CONTENT_UNLOCKS;
  }
  try {
    const text = storage.getItem(CONTENT_UNLOCKS_STORAGE_KEY);
    return text === null ? NO_CONTENT_UNLOCKS : normalizeContentUnlocks(JSON.parse(text));
  } catch {
    return NO_CONTENT_UNLOCKS;
  }
}

/** Park progress. Silent on failure, for the reasons {@link loadContentUnlocks} gives. */
export function saveContentUnlocks(
  storage: ContentUnlocksStorage | null,
  unlocks: ContentUnlocks,
): void {
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(CONTENT_UNLOCKS_STORAGE_KEY, JSON.stringify(unlocks));
  } catch {
    /* Progress that cannot be parked is still progress for this session. */
  }
}

/**
 * Add an earned id. Returns the same object when the id was already there, so a caller can use
 * identity to decide whether anything is worth persisting — or worth telling the player about,
 * which is what the award notification will want when unlock rules arrive.
 */
export function grantContentUnlock(
  unlocks: ContentUnlocks,
  kind: UnlockableKind,
  id: string,
): ContentUnlocks {
  if (id === "" || unlocks[kind].includes(id)) {
    return unlocks;
  }
  return { ...unlocks, [kind]: [...unlocks[kind], id] };
}

/**
 * A resolved answer to "may this be picked right now", built from a catalog, a save, and the
 * Unlock All setting. Cheap enough to rebuild whenever any of the three moves, which is what
 * the title screen does rather than caching answers.
 */
export interface UnlockView {
  /** True when every card is open because of the setting, rather than because it was earned. */
  readonly unlockAll: boolean;
  isUnlocked(kind: UnlockableKind, id: string): boolean;
  /** Unlocked ids of a kind, in catalog order. */
  unlockedIds(kind: UnlockableKind): string[];
  /** How much of a kind is open, for the progress the title screen's tabs show. */
  counts(kind: UnlockableKind): { unlocked: number; total: number };
}

export function createUnlockView(
  catalog: ContentCatalog,
  unlocks: ContentUnlocks,
  unlockAll: boolean,
): UnlockView {
  const open = new Map<UnlockableKind, Set<string>>();
  for (const kind of UNLOCKABLE_KINDS) {
    const all = catalogUnlockableIds(catalog, kind);
    if (unlockAll) {
      open.set(kind, new Set(all));
      continue;
    }
    const set = new Set(defaultUnlockedIds(catalog, kind));
    for (const id of unlocks[kind]) {
      if (all.includes(id)) {
        set.add(id);
      }
    }
    /*
     * Last resort, not a policy: a kind with content in it but nothing open leaves the player
     * staring at a slot they cannot fill, which is worse than ignoring the flags for it. The
     * content validator makes this unreachable in shipped content — but the editor writes live
     * JSON, and a designer mid-edit should get a title screen rather than a dead end.
     */
    open.set(kind, set.size === 0 ? new Set(all) : set);
  }

  return {
    unlockAll,
    isUnlocked: (kind, id) => open.get(kind)?.has(id) === true,
    unlockedIds: (kind) => catalogUnlockableIds(catalog, kind).filter((id) => open.get(kind)!.has(id)),
    counts: (kind) => ({
      unlocked: open.get(kind)!.size,
      total: catalogUnlockableIds(catalog, kind).length,
    }),
  };
}

/**
 * The live unlock state, and the one place that writes it.
 *
 * `unlockAll` is read through a callback rather than passed by value because it belongs to the
 * settings screen, which can be changed with the title screen already built — see
 * {@link ProgressionApi.refresh}.
 */
export interface ProgressionApi {
  /** The current answer. Re-read at the point of use; never cached by callers. */
  view(): UnlockView;
  /** What the player has earned, for a screen that wants to show progress rather than gate on it. */
  unlocks(): ContentUnlocks;
  /**
   * Award content. Persists and notifies when the id is new; a no-op that returns false when it
   * was already unlocked. Nothing calls this yet — it is the seam the unlock rules will use.
   */
  grant(kind: UnlockableKind, id: string): boolean;
  /** Re-read the Unlock All setting and notify. Called when the settings screen writes it. */
  refresh(): void;
  /** Run `listener` whenever the view changes. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export function initProgression(opts: {
  catalog: ContentCatalog;
  storage: ContentUnlocksStorage | null;
  unlockAll: () => boolean;
}): ProgressionApi {
  let unlocks = loadContentUnlocks(opts.storage);
  let view = createUnlockView(opts.catalog, unlocks, opts.unlockAll());
  const listeners = new Set<() => void>();

  function rebuild(): void {
    view = createUnlockView(opts.catalog, unlocks, opts.unlockAll());
    for (const listener of [...listeners]) {
      listener();
    }
  }

  return {
    view: () => view,
    unlocks: () => unlocks,
    grant(kind, id) {
      const next = grantContentUnlock(unlocks, kind, id);
      if (next === unlocks) {
        return false;
      }
      unlocks = next;
      saveContentUnlocks(opts.storage, unlocks);
      rebuild();
      return true;
    },
    refresh: rebuild,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
