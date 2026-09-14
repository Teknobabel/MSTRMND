import { tryLockLandscape } from "./ui/stageScale";

export type NavigationHooks = {
  setGameLoopRunning: (running: boolean) => void;
  /** Roll the run the title screen is configured for; called as Play is pressed. */
  startRun: () => void;
  /**
   * The game screen has just been revealed for a fresh run, with the new state already
   * rendered into it. Where the viewscreen boot sequence is played from.
   *
   * Only ever fires for a run that is starting. Coming back to the game screen from Settings or
   * from the pause overlay is a resume, and a console that rebooted every time the player
   * glanced at the options would be a console nobody opened the options on.
   */
  gameScreenOpened: () => void;
  /** The game screen is being left — quit, or a run that has ended. Stop anything playing on it. */
  gameScreenClosed: () => void;
};

export type NavigationApi = {
  /** Leave the game screen for the title screen (used when a run ends). */
  returnToMainMenu: () => void;
};

type Screen = "main" | "settings" | "game";
type SettingsReturnTarget = "main" | "game-paused";

function req<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing #${id}`);
  }
  return el as T;
}

function setPanelVisibility(el: HTMLElement, visible: boolean): void {
  el.hidden = !visible;
  el.setAttribute("aria-hidden", visible ? "false" : "true");
}

export function initNavigation(hooks: NavigationHooks): NavigationApi {
  const screenMain = req<HTMLElement>("screen-main");
  const screenSettings = req<HTMLElement>("screen-settings");
  const screenGame = req<HTMLElement>("screen-game");
  const overlayPause = req<HTMLElement>("overlay-pause");

  const btnPlay = req<HTMLButtonElement>("btn-play");
  const btnMainSettings = req<HTMLButtonElement>("btn-main-settings");
  const btnSettingsBack = req<HTMLButtonElement>("btn-settings-back");
  const btnPause = req<HTMLButtonElement>("btn-pause");
  const btnPauseBack = req<HTMLButtonElement>("btn-pause-back");
  const btnPauseQuit = req<HTMLButtonElement>("btn-pause-quit");
  const btnPauseSettings = req<HTMLButtonElement>("btn-pause-settings");

  let screen: Screen = "main";
  let paused = false;
  let settingsReturnTarget: SettingsReturnTarget = "main";

  function apply(): void {
    setPanelVisibility(screenMain, screen === "main");
    setPanelVisibility(screenSettings, screen === "settings");
    setPanelVisibility(screenGame, screen === "game");
    setPanelVisibility(overlayPause, screen === "game" && paused);

    const gameLoopRunning = screen === "game" && !paused;
    hooks.setGameLoopRunning(gameLoopRunning);

    if (screen === "game" && paused) {
      btnPauseBack.focus();
    } else if (screen === "settings") {
      btnSettingsBack.focus();
    }
  }

  btnPlay.addEventListener("click", () => {
    hooks.startRun();
    paused = false;
    screen = "game";
    apply();
    /* After `apply`, so the shell is visible and laid out on the frame the boot sequence puts
     * its first keyframe on — starting it against a `hidden` screen would leave the stages that
     * have to measure the map with nothing to measure. */
    hooks.gameScreenOpened();
    void tryLockLandscape();
  });

  btnMainSettings.addEventListener("click", () => {
    settingsReturnTarget = "main";
    screen = "settings";
    apply();
  });

  btnSettingsBack.addEventListener("click", () => {
    if (settingsReturnTarget === "main") {
      screen = "main";
    } else {
      screen = "game";
      paused = true;
    }
    apply();
  });

  btnPause.addEventListener("click", () => {
    paused = true;
    apply();
  });

  btnPauseBack.addEventListener("click", () => {
    paused = false;
    apply();
  });

  btnPauseQuit.addEventListener("click", () => {
    paused = false;
    screen = "main";
    hooks.gameScreenClosed();
    apply();
  });

  btnPauseSettings.addEventListener("click", () => {
    settingsReturnTarget = "game-paused";
    screen = "settings";
    apply();
  });

  apply();

  return {
    returnToMainMenu(): void {
      paused = false;
      screen = "main";
      hooks.gameScreenClosed();
      apply();
    },
  };
}
