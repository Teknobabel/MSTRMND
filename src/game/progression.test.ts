import { describe, expect, it } from "vitest";
import { parseCatalog } from "./contentSchema";
import { rawFixtureSlices } from "./testFixtures";
import {
  CONTENT_UNLOCKS_STORAGE_KEY,
  NO_CONTENT_UNLOCKS,
  createUnlockView,
  defaultUnlockedIds,
  grantContentUnlock,
  initProgression,
  loadContentUnlocks,
  normalizeContentUnlocks,
  saveContentUnlocks,
  type ContentUnlocksStorage,
} from "./progression";
import type { ContentCatalog } from "./types";

function fakeStorage(seed: Record<string, string> = {}): ContentUnlocksStorage & {
  readonly written: Record<string, string>;
} {
  const written: Record<string, string> = { ...seed };
  return {
    written,
    getItem: (key) => written[key] ?? null,
    setItem: (key, value) => {
      written[key] = value;
    },
  };
}

function throwingStorage(): ContentUnlocksStorage {
  return {
    getItem: () => {
      throw new Error("storage disabled");
    },
    setItem: () => {
      throw new Error("storage disabled");
    },
  };
}

/**
 * The fixtures ship one row per unlockable slice, which cannot express "some locked". This
 * widens each slice to three rows with only the first flagged — the shape the shipped content
 * actually has, and the only shape the locking rules do anything interesting on.
 */
function ladderCatalog(): ContentCatalog {
  const slices = rawFixtureSlices();
  const plan = slices.omegaPlans[0]!;
  slices.omegaPlans = [
    plan,
    { ...plan, id: "op-2", unlockedByDefault: false },
    { ...plan, id: "op-3", unlockedByDefault: false },
  ];
  const lair = slices.lairs[0]!;
  slices.lairs = [
    lair,
    { ...lair, id: "lair-2", unlockedByDefault: false },
    { ...lair, id: "lair-3", unlockedByDefault: false },
  ];
  const profile = slices.playerProfiles[0]!;
  slices.playerProfiles = [
    profile,
    { ...profile, name: "Runner-Up", unlockedByDefault: false },
    { ...profile, name: "Third Wheel", unlockedByDefault: false },
  ];
  return parseCatalog(slices);
}

describe("defaultUnlockedIds", () => {
  it("is exactly the rows the designer flagged", () => {
    const catalog = ladderCatalog();
    expect(defaultUnlockedIds(catalog, "lair")).toEqual(["lair-1"]);
    expect(defaultUnlockedIds(catalog, "omegaPlan")).toEqual(["op-1"]);
    expect(defaultUnlockedIds(catalog, "mastermind")).toEqual(["Tester"]);
  });
});

describe("createUnlockView", () => {
  it("opens the starting deck and locks everything else on a fresh save", () => {
    const view = createUnlockView(ladderCatalog(), NO_CONTENT_UNLOCKS, false);
    expect(view.isUnlocked("lair", "lair-1")).toBe(true);
    expect(view.isUnlocked("lair", "lair-2")).toBe(false);
    expect(view.counts("lair")).toStrictEqual({ unlocked: 1, total: 3 });
  });

  it("unions what has been earned onto the starting deck", () => {
    const view = createUnlockView(
      ladderCatalog(),
      { ...NO_CONTENT_UNLOCKS, lair: ["lair-3"] },
      false,
    );
    expect(view.unlockedIds("lair")).toEqual(["lair-1", "lair-3"]);
  });

  it("reports unlocked ids in catalog order, not in the order they were earned", () => {
    // The title screen lays its deck out in this order, and a roster that reshuffles itself
    // every time something new is earned is a roster nobody can learn the shape of.
    const view = createUnlockView(
      ladderCatalog(),
      { ...NO_CONTENT_UNLOCKS, lair: ["lair-3", "lair-2"] },
      false,
    );
    expect(view.unlockedIds("lair")).toEqual(["lair-1", "lair-2", "lair-3"]);
  });

  it("ignores an earned id the catalog no longer has", () => {
    // A save that names content a later build removed. It stays parked (renaming the row back
    // restores it) but it must not be counted as something the player can pick.
    const view = createUnlockView(
      ladderCatalog(),
      { ...NO_CONTENT_UNLOCKS, lair: ["lair-from-a-mod"] },
      false,
    );
    expect(view.counts("lair")).toStrictEqual({ unlocked: 1, total: 3 });
  });

  it("opens everything while Unlock All is on, without consulting the flags", () => {
    const view = createUnlockView(ladderCatalog(), NO_CONTENT_UNLOCKS, true);
    expect(view.unlockAll).toBe(true);
    expect(view.counts("omegaPlan")).toStrictEqual({ unlocked: 3, total: 3 });
    expect(view.isUnlocked("omegaPlan", "op-3")).toBe(true);
  });

  it("opens a slice that flags nothing rather than leaving the slot unfillable", () => {
    // Unreachable in shipped content (the validator refuses it), but the editor writes live
    // JSON and a designer mid-edit should get a title screen, not a dead end. Built by hand
    // rather than through `parseCatalog`, which is the thing that would object.
    const base = ladderCatalog();
    const catalog: ContentCatalog = {
      ...base,
      lairs: base.lairs.map((l) => ({ ...l, unlockedByDefault: false })),
    };
    const view = createUnlockView(catalog, NO_CONTENT_UNLOCKS, false);
    expect(view.counts("lair")).toStrictEqual({ unlocked: 3, total: 3 });
    expect(view.isUnlocked("lair", "lair-3")).toBe(true);
  });

  it("leaves an empty slice empty", () => {
    // Nothing to fall back to, and nothing to be wrong about.
    const catalog = { ...ladderCatalog(), lairs: [] };
    const view = createUnlockView(catalog, NO_CONTENT_UNLOCKS, false);
    expect(view.counts("lair")).toStrictEqual({ unlocked: 0, total: 0 });
    expect(view.isUnlocked("lair", "lair-1")).toBe(false);
  });
});

describe("grantContentUnlock", () => {
  it("adds an id that was not there", () => {
    expect(grantContentUnlock(NO_CONTENT_UNLOCKS, "lair", "lair-2").lair).toEqual(["lair-2"]);
  });

  it("returns the same object for an id already earned", () => {
    // Callers use identity to decide whether there is anything to persist or announce.
    const once = grantContentUnlock(NO_CONTENT_UNLOCKS, "lair", "lair-2");
    expect(grantContentUnlock(once, "lair", "lair-2")).toBe(once);
  });

  it("leaves the other kinds alone", () => {
    const next = grantContentUnlock(NO_CONTENT_UNLOCKS, "lair", "lair-2");
    expect(next.mastermind).toEqual([]);
    expect(next.omegaPlan).toEqual([]);
  });
});

describe("normalizeContentUnlocks", () => {
  it("takes a well-formed payload as written", () => {
    expect(
      normalizeContentUnlocks({ mastermind: ["A"], lair: ["l1"], omegaPlan: ["op"] }),
    ).toStrictEqual({ mastermind: ["A"], lair: ["l1"], omegaPlan: ["op"] });
  });

  it("falls back per kind rather than discarding the whole payload", () => {
    expect(normalizeContentUnlocks({ mastermind: ["A"], lair: "nope" })).toStrictEqual({
      mastermind: ["A"],
      lair: [],
      omegaPlan: [],
    });
  });

  it("drops junk entries and duplicates inside a kind", () => {
    expect(normalizeContentUnlocks({ lair: ["l1", "l1", "", 7, null, "l2"] }).lair).toEqual([
      "l1",
      "l2",
    ]);
  });

  it("reads anything that is not an object as nothing earned", () => {
    expect(normalizeContentUnlocks(null)).toStrictEqual(NO_CONTENT_UNLOCKS);
    expect(normalizeContentUnlocks("[]")).toStrictEqual(NO_CONTENT_UNLOCKS);
    expect(normalizeContentUnlocks(undefined)).toStrictEqual(NO_CONTENT_UNLOCKS);
  });
});

describe("content unlock storage", () => {
  it("round-trips progress", () => {
    const storage = fakeStorage();
    saveContentUnlocks(storage, { mastermind: [], lair: ["lair-2"], omegaPlan: [] });
    expect(loadContentUnlocks(storage).lair).toEqual(["lair-2"]);
  });

  it("opens on nothing earned when storage is empty, unparsable, or absent", () => {
    expect(loadContentUnlocks(fakeStorage())).toStrictEqual(NO_CONTENT_UNLOCKS);
    expect(
      loadContentUnlocks(fakeStorage({ [CONTENT_UNLOCKS_STORAGE_KEY]: "{oh no" })),
    ).toStrictEqual(NO_CONTENT_UNLOCKS);
    expect(loadContentUnlocks(null)).toStrictEqual(NO_CONTENT_UNLOCKS);
  });

  it("survives a browser that throws on storage access", () => {
    // Private mode in some browsers. Losing progress is bad; failing to open the game is worse.
    expect(loadContentUnlocks(throwingStorage())).toStrictEqual(NO_CONTENT_UNLOCKS);
    expect(() => saveContentUnlocks(throwingStorage(), NO_CONTENT_UNLOCKS)).not.toThrow();
  });
});

describe("initProgression", () => {
  it("starts from what was parked", () => {
    const storage = fakeStorage({
      [CONTENT_UNLOCKS_STORAGE_KEY]: JSON.stringify({ lair: ["lair-2"] }),
    });
    const api = initProgression({
      catalog: ladderCatalog(),
      storage,
      unlockAll: () => false,
    });
    expect(api.view().unlockedIds("lair")).toEqual(["lair-1", "lair-2"]);
  });

  it("persists and announces a grant, and says nothing for a repeat", () => {
    const storage = fakeStorage();
    const api = initProgression({
      catalog: ladderCatalog(),
      storage,
      unlockAll: () => false,
    });
    let notices = 0;
    api.subscribe(() => {
      notices += 1;
    });

    expect(api.grant("lair", "lair-3")).toBe(true);
    expect(notices).toBe(1);
    expect(api.view().isUnlocked("lair", "lair-3")).toBe(true);
    expect(JSON.parse(storage.written[CONTENT_UNLOCKS_STORAGE_KEY]!).lair).toEqual(["lair-3"]);

    expect(api.grant("lair", "lair-3")).toBe(false);
    expect(notices).toBe(1);
  });

  it("re-reads Unlock All on refresh and announces the change", () => {
    let unlockAll = false;
    const api = initProgression({
      catalog: ladderCatalog(),
      storage: fakeStorage(),
      unlockAll: () => unlockAll,
    });
    let notices = 0;
    api.subscribe(() => {
      notices += 1;
    });

    expect(api.view().counts("omegaPlan").unlocked).toBe(1);
    unlockAll = true;
    api.refresh();
    expect(notices).toBe(1);
    expect(api.view().counts("omegaPlan").unlocked).toBe(3);
  });

  it("keeps earned progress across an Unlock All round trip", () => {
    // The toggle overrides progress; it must never overwrite it, or a player who flips it on to
    // look around loses the record of what they actually earned.
    let unlockAll = false;
    const api = initProgression({
      catalog: ladderCatalog(),
      storage: fakeStorage(),
      unlockAll: () => unlockAll,
    });
    api.grant("lair", "lair-2");
    unlockAll = true;
    api.refresh();
    unlockAll = false;
    api.refresh();
    expect(api.view().unlockedIds("lair")).toEqual(["lair-1", "lair-2"]);
  });

  it("stops notifying an unsubscribed listener", () => {
    const api = initProgression({
      catalog: ladderCatalog(),
      storage: fakeStorage(),
      unlockAll: () => false,
    });
    let notices = 0;
    const off = api.subscribe(() => {
      notices += 1;
    });
    off();
    api.grant("lair", "lair-2");
    expect(notices).toBe(0);
  });
});
