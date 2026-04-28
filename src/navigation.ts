export type NavigationHooks = {
  setGameLoopRunning: (running: boolean) => void;
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

export function initNavigation(hooks: NavigationHooks): void {
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
    paused = false;
    screen = "game";
    apply();
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
    apply();
  });

  btnPauseSettings.addEventListener("click", () => {
    settingsReturnTarget = "game-paused";
    screen = "settings";
    apply();
  });

  apply();
}
