import { describe, expect, it } from "vitest";
import {
  PLAYER_SETTINGS_DEFAULTS,
  PLAYER_SETTINGS_STORAGE_KEY,
  loadPlayerSettings,
  normalizePlayerSettings,
  savePlayerSettings,
  type PlayerSettingsStorage,
} from "./playerSettings";

function fakeStorage(seed: Record<string, string> = {}): PlayerSettingsStorage & {
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

function throwingStorage(): PlayerSettingsStorage {
  return {
    getItem: () => {
      throw new Error("storage disabled");
    },
    setItem: () => {
      throw new Error("storage disabled");
    },
  };
}

describe("player settings defaults", () => {
  it("plays the boot sequence for a player who has never opened settings", () => {
    // The boot is the first thing a new player sees; skipping it is something you opt into.
    expect(PLAYER_SETTINGS_DEFAULTS.skipBootSequence).toBe(false);
  });

  it("keeps the unlock ladder in place for a player who has never opened settings", () => {
    // Most of the catalog being locked is the progression, not an accident; a switch that skips
    // it should never be one a player finds already flipped.
    expect(PLAYER_SETTINGS_DEFAULTS.unlockAllContent).toBe(false);
  });

  it("walks a player who has never opened settings through the opening checklist", () => {
    // The Todo card is the only place the console spells out what Omega Phase 1 wants, and a
    // player who needs it is the last one who would go switching it on.
    expect(PLAYER_SETTINGS_DEFAULTS.disableTutorial).toBe(false);
  });

  it("lets the crew talk unless asked not to", () => {
    // Barks are how the roster reads as people rather than as trait lists, and they are paced so
    // a player never goes looking for the switch; see `ui/minionBarks.ts`.
    expect(PLAYER_SETTINGS_DEFAULTS.disableBarks).toBe(false);
  });

  it("slides the map away from the pointer unless asked not to", () => {
    // The parallax is a reach aid before it is an effect (see `ui/mapParallax.ts`), so it is opt
    // *out*: a player who never opens this screen should still be getting the shorter travel.
    expect(PLAYER_SETTINGS_DEFAULTS.mapParallax).toBe(true);
  });
});

describe("normalizePlayerSettings", () => {
  it("takes a well-formed payload as written", () => {
    expect(
      normalizePlayerSettings({
        skipBootSequence: true,
        mapParallax: false,
        unlockAllContent: true,
        disableTutorial: true,
        disableBarks: true,
      }),
    ).toStrictEqual({
      skipBootSequence: true,
      mapParallax: false,
      unlockAllContent: true,
      disableTutorial: true,
      disableBarks: true,
    });
  });

  it("falls back per field rather than discarding the whole payload", () => {
    // A key parked by an older build that has since changed type should cost that one setting,
    // not every setting beside it.
    expect(normalizePlayerSettings({ skipBootSequence: "yes" })).toStrictEqual(
      PLAYER_SETTINGS_DEFAULTS,
    );
    expect(normalizePlayerSettings({ skipBootSequence: true, mapParallax: "off" })).toStrictEqual({
      skipBootSequence: true,
      mapParallax: PLAYER_SETTINGS_DEFAULTS.mapParallax,
      unlockAllContent: PLAYER_SETTINGS_DEFAULTS.unlockAllContent,
      disableTutorial: PLAYER_SETTINGS_DEFAULTS.disableTutorial,
      disableBarks: PLAYER_SETTINGS_DEFAULTS.disableBarks,
    });
  });

  it("reads a payload parked before a setting existed as that setting's default", () => {
    // What every player who has opened an earlier build already has in storage: the older shape,
    // with no parallax key in it at all.
    expect(normalizePlayerSettings({ skipBootSequence: true })).toStrictEqual({
      skipBootSequence: true,
      mapParallax: PLAYER_SETTINGS_DEFAULTS.mapParallax,
      unlockAllContent: PLAYER_SETTINGS_DEFAULTS.unlockAllContent,
      disableTutorial: PLAYER_SETTINGS_DEFAULTS.disableTutorial,
      disableBarks: PLAYER_SETTINGS_DEFAULTS.disableBarks,
    });
  });

  it("reads anything that is not an object as no settings at all", () => {
    expect(normalizePlayerSettings(null)).toStrictEqual(PLAYER_SETTINGS_DEFAULTS);
    expect(normalizePlayerSettings("true")).toStrictEqual(PLAYER_SETTINGS_DEFAULTS);
    expect(normalizePlayerSettings(undefined)).toStrictEqual(PLAYER_SETTINGS_DEFAULTS);
  });
});

describe("player settings storage", () => {
  it("round-trips a change", () => {
    const storage = fakeStorage();
    savePlayerSettings(storage, {
      skipBootSequence: true,
      mapParallax: false,
      unlockAllContent: true,
      disableTutorial: true,
      disableBarks: true,
    });
    expect(loadPlayerSettings(storage)).toStrictEqual({
      skipBootSequence: true,
      mapParallax: false,
      unlockAllContent: true,
      disableTutorial: true,
      disableBarks: true,
    });
  });

  it("opens on the defaults when nothing has been parked", () => {
    expect(loadPlayerSettings(fakeStorage())).toStrictEqual(PLAYER_SETTINGS_DEFAULTS);
  });

  it("opens on the defaults when what was parked is not JSON", () => {
    const storage = fakeStorage({ [PLAYER_SETTINGS_STORAGE_KEY]: "{oh no" });
    expect(loadPlayerSettings(storage)).toStrictEqual(PLAYER_SETTINGS_DEFAULTS);
  });

  it("survives a browser that throws on storage access", () => {
    // Private mode in some browsers. A preference is not worth failing to open the game over.
    expect(loadPlayerSettings(throwingStorage())).toStrictEqual(PLAYER_SETTINGS_DEFAULTS);
    expect(() =>
      savePlayerSettings(throwingStorage(), {
        skipBootSequence: true,
        mapParallax: true,
        unlockAllContent: false,
        disableTutorial: false,
        disableBarks: false,
      }),
    ).not.toThrow();
  });

  it("does nothing at all without storage", () => {
    expect(loadPlayerSettings(null)).toStrictEqual(PLAYER_SETTINGS_DEFAULTS);
    expect(() =>
      savePlayerSettings(null, {
        skipBootSequence: true,
        mapParallax: true,
        unlockAllContent: false,
        disableTutorial: false,
        disableBarks: false,
      }),
    ).not.toThrow();
  });
});
