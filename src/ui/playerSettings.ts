/**
 * The Settings screen's preferences, and the wiring that keeps the screen and storage in step.
 *
 * These are the player's, not the run's: they are read at the moment they matter rather than
 * copied into `GameState`, and they outlive the run that was open when they were changed. That
 * is the same split the Map Layers panel makes, and for the same reason — `createInitialGameState`
 * rebuilds the rules' data from scratch every time Play is pressed, and a preference that lived
 * in there would be reset by starting a game.
 */

export interface PlayerSettings {
  /**
   * Bypass the viewscreen boot sequence and the opening briefing after it, and open a run on the
   * live console.
   *
   * Off by default: the boot is the first thing a new player sees, and it is worth seeing once.
   * The toggle is for the run after the fiftieth — as is the fact that any click or key cuts the
   * sequence short, which is the out for the runs in between.
   */
  readonly skipBootSequence: boolean;
  /**
   * Slide the world map away from the pointer, so the far side of it comes to meet the cursor.
   *
   * On by default: it is a reach aid before it is an effect — see `ui/mapParallax.ts` — and a
   * player who never finds the toggle is better off with it. The toggle is for the two people it
   * will bother, which on an effect keyed to pointer movement is two people worth having one for.
   */
  readonly mapParallax: boolean;
  /**
   * Open every mastermind, lair and omega plan at the title screen, whatever has been earned.
   *
   * Off by default: the unlock ladder is the reason most of the catalog is not pickable on a
   * new save, and a toggle that quietly skips it is not one a player should find already
   * flipped. It overrides the progress rather than rewriting it — see `game/progression.ts` —
   * so switching it back off hands the player exactly the deck they had.
   */
  readonly unlockAllContent: boolean;
  /**
   * Take the Directives card off the map — the opening checklist a new player is walked through.
   *
   * Off by default, i.e. the tutorial is on: the card is the only place the console spells out
   * what Omega Phase 1 is actually asking for, and a player who needs it is exactly the player
   * who will not think to go looking for a switch that turns it on. It stands down on its own
   * once the plan leaves phase 1, so this is for the run after the first — and for the player
   * who wants the corner of the map back before then.
   */
  readonly disableTutorial: boolean;
}

export const PLAYER_SETTINGS_DEFAULTS: PlayerSettings = {
  skipBootSequence: false,
  mapParallax: true,
  unlockAllContent: false,
  disableTutorial: false,
};

/** Where the settings are parked between sessions. Versioned: the list will grow. */
export const PLAYER_SETTINGS_STORAGE_KEY = "mastermind.settings.v1";

/** The slice of `Storage` this module needs — enough to hand it a fake in a test. */
export interface PlayerSettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Pull anything — a parsed storage read, a file written by an older build — back to a settings
 * object. Every field that is not the right type falls to its default rather than being dropped,
 * so a key added in a later version reads as its default off an older parked payload.
 */
export function normalizePlayerSettings(raw: unknown): PlayerSettings {
  if (raw === null || typeof raw !== "object") {
    return PLAYER_SETTINGS_DEFAULTS;
  }
  const row = raw as Record<string, unknown>;
  return {
    skipBootSequence:
      typeof row.skipBootSequence === "boolean"
        ? row.skipBootSequence
        : PLAYER_SETTINGS_DEFAULTS.skipBootSequence,
    mapParallax:
      typeof row.mapParallax === "boolean"
        ? row.mapParallax
        : PLAYER_SETTINGS_DEFAULTS.mapParallax,
    unlockAllContent:
      typeof row.unlockAllContent === "boolean"
        ? row.unlockAllContent
        : PLAYER_SETTINGS_DEFAULTS.unlockAllContent,
    disableTutorial:
      typeof row.disableTutorial === "boolean"
        ? row.disableTutorial
        : PLAYER_SETTINGS_DEFAULTS.disableTutorial,
  };
}

/**
 * Read the parked settings. A preference is not worth an exception: private-mode storage throws
 * on access in some browsers, and unparsable JSON is as likely as none, so every failure lands
 * on the defaults.
 */
export function loadPlayerSettings(storage: PlayerSettingsStorage | null): PlayerSettings {
  if (storage === null) {
    return PLAYER_SETTINGS_DEFAULTS;
  }
  try {
    const text = storage.getItem(PLAYER_SETTINGS_STORAGE_KEY);
    return text === null ? PLAYER_SETTINGS_DEFAULTS : normalizePlayerSettings(JSON.parse(text));
  } catch {
    return PLAYER_SETTINGS_DEFAULTS;
  }
}

/** Park the settings. Silent on failure, for the reasons {@link loadPlayerSettings} gives. */
export function savePlayerSettings(
  storage: PlayerSettingsStorage | null,
  settings: PlayerSettings,
): void {
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(PLAYER_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* A preference that cannot be parked is still a preference for this session. */
  }
}

export interface SettingsMenuApi {
  /** The settings as they stand right now. Read at the point of use, never cached by callers. */
  read(): PlayerSettings;
  /**
   * Run `listener` after any control is changed, with the setting it wrote.
   *
   * Most settings are read at the moment they matter and need no notice — the boot sequence
   * asks on its way in, the parallax asks on every pointer move. Unlock All and Disable Tutorial
   * are the exceptions: each decides what a screen that is already built is showing (the title
   * screen's decks, the map's Directives card), so those screens have to be told.
   * Returns the unsubscribe, though nothing in the game outlives the settings menu.
   */
  subscribe(listener: (key: keyof PlayerSettings, settings: PlayerSettings) => void): () => void;
}

/** The controls on the Settings screen, by the setting each one writes. */
const SETTINGS_CONTROL_IDS: Readonly<Record<keyof PlayerSettings, string>> = {
  skipBootSequence: "setting-skip-boot",
  mapParallax: "setting-map-parallax",
  unlockAllContent: "setting-unlock-all-content",
  disableTutorial: "setting-disable-tutorial",
};

/**
 * Wire the Settings screen to storage.
 *
 * The screen is plain markup in index.html — there is no list to build, only checkboxes to bind
 * — so this reads the parked settings onto the controls once and writes each change straight
 * back. No Apply button and nothing to cancel: a settings screen that can be wrong until you
 * confirm it is a settings screen that can be left wrong.
 *
 * A control that is missing from the markup is skipped rather than thrown on, so the game still
 * opens on a page that is mid-edit.
 */
export function initSettingsMenu(storage: PlayerSettingsStorage | null): SettingsMenuApi {
  let settings = loadPlayerSettings(storage);
  const listeners = new Set<(key: keyof PlayerSettings, settings: PlayerSettings) => void>();

  for (const [key, id] of Object.entries(SETTINGS_CONTROL_IDS) as [
    keyof PlayerSettings,
    string,
  ][]) {
    const input = document.getElementById(id);
    if (!(input instanceof HTMLInputElement)) {
      continue;
    }
    input.checked = settings[key];
    input.addEventListener("change", () => {
      settings = { ...settings, [key]: input.checked };
      savePlayerSettings(storage, settings);
      for (const listener of [...listeners]) {
        listener(key, settings);
      }
    });
  }

  return {
    read: () => settings,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
