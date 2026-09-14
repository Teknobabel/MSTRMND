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
});

describe("normalizePlayerSettings", () => {
  it("takes a well-formed payload as written", () => {
    expect(normalizePlayerSettings({ skipBootSequence: true })).toStrictEqual({
      skipBootSequence: true,
    });
  });

  it("falls back per field rather than discarding the whole payload", () => {
    // A key parked by an older build that has since changed type should cost that one setting,
    // not every setting beside it.
    expect(normalizePlayerSettings({ skipBootSequence: "yes" })).toStrictEqual(
      PLAYER_SETTINGS_DEFAULTS,
    );
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
    savePlayerSettings(storage, { skipBootSequence: true });
    expect(loadPlayerSettings(storage)).toStrictEqual({ skipBootSequence: true });
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
    expect(() => savePlayerSettings(throwingStorage(), { skipBootSequence: true })).not.toThrow();
  });

  it("does nothing at all without storage", () => {
    expect(loadPlayerSettings(null)).toStrictEqual(PLAYER_SETTINGS_DEFAULTS);
    expect(() => savePlayerSettings(null, { skipBootSequence: true })).not.toThrow();
  });
});
