/**
 * The viewscreen waking up.
 *
 * A run opens on a console that is not on yet: the shell is in the markup, laid out and sized,
 * but every readout on it is dark. Over the next several seconds it comes up the way a
 * cathode-ray console would — power hits, the world map strikes from a line and opens, a scanner
 * crosses it and every site it passes locks in under the beam, the status readouts light one
 * after another, the menu tabs rise into their row, and the rest of the chrome fills in.
 *
 * **The opening is two acts, and this module plays both of them.**
 *
 *  - **The boot** ({@link BOOT_STAGES}, {@link startBootSequence}) is the console coming up, and
 *    it runs the moment the game screen is revealed. It ends into the run briefing
 *    (`ui/runBriefing.ts`), the classified page laid over the finished map — after holding on
 *    the finished console for a beat first ({@link BOOT_HAND_OVER_MS}).
 *  - **The planner's arrival** ({@link PLANNER_STAGES}, {@link startPlannerArrival}) is the
 *    mission planner sliding in off the left edge, and it waits for the player to dismiss that
 *    page. It used to be the boot's sixth stage, and it was the wrong place for it: the planner
 *    is what the briefing's third row tells the player to go and use, so it arriving *behind* a
 *    modal meant the one piece of furniture the page is about had already finished moving by the
 *    time anyone could look at it. Held back, the dismissal is what brings it in.
 *
 * So the boot *arms* the second act rather than playing it: it leaves the shell carrying
 * {@link PLANNER_HOLD_CLASS}, which parks the panel off-stage on exactly the frame its own
 * animation starts from. Whoever starts a boot therefore owes the shell either a
 * {@link startPlannerArrival} or a {@link clearPlannerHold} — and note that the boot's handle is
 * usually gone by then, because `onDone` fires a briefing before the hold is released, so the
 * hold cannot be the handle's to clean up. `main.ts` owns both ends of that.
 *
 * Each act takes its time, and can afford to: any pointer or key ends it on the spot. The length
 * of each is its stage table's to set and both have been retimed more than once, so nothing
 * outside those tables — here or in the stylesheet — should be written as though it knew a total.
 *
 * Almost all of it is CSS. This module's job is only the four things a stylesheet cannot do for
 * itself:
 *
 *  1. Say *when*. The stage tables are the whole clock, written onto the shell as custom
 *     properties when their act starts, so a sequence can be retimed here rather than by
 *     hunting delays through a dozen `@keyframes` blocks. Both tables publish `--boot-*` names
 *     off their `cssStem`, and the stems are disjoint, so the two acts can never overwrite each
 *     other's clock on the one element they share.
 *  2. Say *in what order*. Stat blocks, drawer tabs and plan sections take their place in their
 *     stage from `--boot-i`, counted off in DOM order.
 *  3. Put the map pins under the scanner. A pin does not light on its turn in a list — it lights
 *     as the beam reaches it, which means its delay is a function of where it ended up on the
 *     plot. That position only exists once the projection has run, so it is read back off the
 *     pin (`--map-py`, written by `syncMapProjection`) two frames in.
 *  4. Stop. Every animation runs `both`, so the resting state is held until the class comes off;
 *     the class comes off once the longest stage has finished, or the moment the player touches
 *     anything, whichever is first.
 *
 * Nothing here is load-bearing for the game: a run whose boot never plays is a run that opened
 * instantly, which is exactly what the "Skip boot up animation" setting asks for — and a run
 * that opened that way never armed the hold, so it gets no planner arrival either, which is the
 * same answer that setting gives to everything else.
 */

/** The class that puts the shell in its dark, pre-power state and arms every stage. */
export const BOOT_SHELL_CLASS = "omega-shell--booting";

/**
 * The class that parks the planner off-stage, armed for {@link startPlannerArrival}.
 *
 * Its rule in the stylesheet is `boot-plan-in`'s own `0%` frame, written out statically — which
 * is what makes the hand-over invisible: the first frame of the animation is the frame that was
 * already on screen.
 */
export const PLANNER_HOLD_CLASS = "omega-shell--planner-held";

/** The class that plays the planner in. Replaces {@link PLANNER_HOLD_CLASS}. */
export const PLANNER_ARRIVAL_CLASS = "omega-shell--planner-arriving";

/** The stages of the boot, in the order a player sees them start. */
export type BootStageId = "power" | "map" | "pins" | "stats" | "tabs" | "chrome";

/** The stages of the planner's arrival. */
export type PlannerStageId = "plan" | "planSections";

export interface BootStage {
  /** When the stage's first element starts moving, ms after its own act does. */
  readonly atMs: number;
  /** How long one element of the stage takes. */
  readonly durationMs: number;
  /**
   * Gap between consecutive elements of a staggered stage, `0` for stages that move as one.
   *
   * The pins are the exception and are spread by {@link BOOT_PIN_SPAN_MS} instead: they follow
   * where they sit on the map, not how many of them there are.
   */
  readonly stepMs: number;
  /** The `--boot-t-*` / `--boot-d-*` / `--boot-step-*` stem the stylesheet reads. */
  readonly cssStem: string;
}

/**
 * How long the scanner takes to cross the map, and so how long the pins are spread over: a pin
 * sitting `f` of the way down the plot lights at `pins.atMs + f * BOOT_PIN_SPAN_MS`. The sweep
 * band in the stylesheet runs on the same two numbers, which is what welds the two together — a
 * pin lights *because* the beam is on it, not near enough to it.
 */
export const BOOT_PIN_SPAN_MS = 560;

/**
 * A beat of stillness after an act's last stage lands before its class comes off, so the
 * hand-over to the live console is not on the same frame as the last thing to move.
 */
export const BOOT_SETTLE_MS = 140;

/**
 * How long the finished console is left to itself before the run briefing is laid over it.
 *
 * The boot ends on a lit console with the world map open across it, and the briefing then covers
 * most of that. Handing over on the same beat the last stage settled gave the player no moment
 * to look at what they had just watched come up — the map arrived and was immediately papered
 * over — so the sequence holds at its own ending for a second first.
 *
 * Part of the boot's clock ({@link bootSequenceDurationMs}) rather than a timer at the call
 * site, which buys two things. It is cancelled along with everything else when a run is
 * abandoned, so a briefing can never surface on the title screen a second after someone quit.
 * And a player who *skips* the boot does not then sit through it: a skip goes straight to
 * `finish`, which hands over at once, because someone who skipped asked to get on with it.
 *
 * Holding the boot class for the extra second costs nothing to look at. Every stage's `100%`
 * frame is its resting appearance — that is the contract the whole sequence is written on — and
 * both overlays (`.boot-veil`, `.boot-map-fx`) end their keyframes at `opacity: 0`.
 */
export const BOOT_HAND_OVER_MS = 1000;

export const BOOT_STAGES: Readonly<Record<BootStageId, BootStage>> = {
  /* The power surge: a red bloom over the whole shell and one roll of interference. */
  power: { atMs: 30, durationMs: 1420, stepMs: 0, cssStem: "power" },
  /* The map strikes from a line, opens top and bottom, and burns off its overexposure. */
  map: { atMs: 90, durationMs: 2240, stepMs: 0, cssStem: "map" },
  /* Site acquisition, under the scanner. See BOOT_PIN_SPAN_MS. */
  pins: { atMs: 2220, durationMs: 2420, stepMs: 0, cssStem: "pins" },
  /* Command, Infamy, Heat and the rest, lighting along the bar with a starter flicker each. */
  stats: { atMs: 3660, durationMs: 440, stepMs: 65, cssStem: "stats" },
  /* The menu tabs rise into their row along the bottom of the map. */
  tabs: { atMs: 4080, durationMs: 440, stepMs: 55, cssStem: "tabs" },
  /*
   * Everything left: the events ticker, the bottom bar, the map layers panel.
   *
   * Moved up from 6000ms when the planner became its own act. The planner used to fill
   * 5000–6840 and the chrome landed inside it; with that gone, the old timing left the console
   * standing still for more than a second after the tabs had risen, and a console that goes
   * still part-way through reads as one that has finished, or hung.
   */
  chrome: { atMs: 4950, durationMs: 440, stepMs: 0, cssStem: "chrome" },
};

/**
 * The planner's arrival, timed from the moment the briefing is dismissed rather than from the
 * top of the run — which is the whole reason it is a table of its own.
 */
export const PLANNER_STAGES: Readonly<Record<PlannerStageId, BootStage>> = {
  /* The panel itself, in off the left edge. The small lead-in keeps it off the frame the
   * briefing's own `display: none` lands on. */
  plan: { atMs: 40, durationMs: 560, stepMs: 0, cssStem: "plan" },
  /* Its three sections fill in as it comes to rest, not after — a panel that arrives empty and
   * is furnished a beat later reads as two events rather than one arrival. The 500ms between
   * this and the panel is the gap the two carried as boot stages and is the shape of the
   * arrival; retime them together. */
  planSections: { atMs: 540, durationMs: 1340, stepMs: 60, cssStem: "plan-sections" },
};

/** How many of each staggered thing the shell actually has, counted when the boot starts. */
export interface BootElementCounts {
  readonly pins: number;
  readonly stats: number;
  readonly tabs: number;
}

function stageEndMs(stage: BootStage, count: number): number {
  return stage.atMs + Math.max(0, count - 1) * stage.stepMs + stage.durationMs;
}

/**
 * When the boot hands the console over: the last thing on screen stopping, plus the settle, plus
 * the beat the finished console is left to itself for ({@link BOOT_HAND_OVER_MS}).
 *
 * Derived rather than written down, so retiming a stage — or a shell that grows a seventh stat
 * block — cannot leave the class on after the animation it was holding has finished, or take it
 * off before.
 */
export function bootSequenceDurationMs(counts: BootElementCounts): number {
  const ends = [
    stageEndMs(BOOT_STAGES.power, 1),
    stageEndMs(BOOT_STAGES.map, 1),
    /* The pins are spread by position rather than by count, so the last of them starts a full
     * span in however many there are — but only if the map put any up at all. */
    counts.pins > 0 ? BOOT_STAGES.pins.atMs + BOOT_PIN_SPAN_MS + BOOT_STAGES.pins.durationMs : 0,
    stageEndMs(BOOT_STAGES.stats, counts.stats),
    stageEndMs(BOOT_STAGES.tabs, counts.tabs),
    stageEndMs(BOOT_STAGES.chrome, 1),
  ];
  return Math.max(...ends) + BOOT_SETTLE_MS + BOOT_HAND_OVER_MS;
}

/**
 * The same, for the second act: when the planner and its last section have come to rest.
 *
 * No hand-over beat on this one. The boot's exists to keep a modal off a console the player has
 * not had a moment to look at; this act *is* what the player is looking at, and it hands over to
 * nothing but the live game.
 */
export function plannerArrivalDurationMs(sections: number): number {
  return (
    Math.max(
      stageEndMs(PLANNER_STAGES.plan, 1),
      stageEndMs(PLANNER_STAGES.planSections, sections),
    ) + BOOT_SETTLE_MS
  );
}

/**
 * A stage table as the stylesheet reads it. Every stage contributes `--boot-t-<stem>` and
 * `--boot-d-<stem>`; a staggered one also contributes `--boot-step-<stem>`.
 */
function stageTimingVars(stages: Readonly<Record<string, BootStage>>): Map<string, string> {
  const vars = new Map<string, string>();
  for (const stage of Object.values(stages)) {
    vars.set(`--boot-t-${stage.cssStem}`, `${stage.atMs}ms`);
    vars.set(`--boot-d-${stage.cssStem}`, `${stage.durationMs}ms`);
    if (stage.stepMs > 0) {
      vars.set(`--boot-step-${stage.cssStem}`, `${stage.stepMs}ms`);
    }
  }
  return vars;
}

/** The boot's clock, plus the sweep span the pin delays are measured against. */
export function bootTimingVars(): ReadonlyMap<string, string> {
  const vars = stageTimingVars(BOOT_STAGES);
  vars.set("--boot-span-pins", `${BOOT_PIN_SPAN_MS}ms`);
  return vars;
}

/** The planner act's clock. Disjoint stems from {@link bootTimingVars}; see the module note. */
export function plannerTimingVars(): ReadonlyMap<string, string> {
  return stageTimingVars(PLANNER_STAGES);
}

/**
 * When a pin sitting `y` px down a plot `height` px tall should light.
 *
 * Clamped rather than trusted: a pin the projection has turned past the edge of the frame can
 * report a position outside the plot, and a plot measured before layout reports no height at
 * all. Both land on the head of the stage, which is the frame the beam enters on.
 */
export function bootPinDelayMs(y: number, height: number): number {
  if (!Number.isFinite(y) || !Number.isFinite(height) || height <= 0) {
    return BOOT_STAGES.pins.atMs;
  }
  const fraction = Math.min(1, Math.max(0, y / height));
  return BOOT_STAGES.pins.atMs + Math.round(fraction * BOOT_PIN_SPAN_MS);
}

/** What a caller gets back: a way to end the sequence early, and a way to ask if it has ended. */
export interface BootSequenceHandle {
  /**
   * Take the console live now — the player skipped, or left the screen. Idempotent.
   *
   * Ends the boot act only. The planner's hold is deliberately left on, because the usual
   * reason this is called is a player skipping ahead to the briefing, and the planner is meant
   * to arrive after that page rather than under it. Releasing it is {@link startPlannerArrival}
   * or {@link clearPlannerHold}.
   */
  finish(): void;
  /** True once {@link BootSequenceHandle.finish} has run, by skip or by the clock. */
  readonly done: boolean;
}

/** What {@link startPlannerArrival} gives back — the same shape, for the same two reasons. */
export interface PlannerArrivalHandle {
  /** Land the planner now. Idempotent. */
  finish(): void;
  readonly done: boolean;
}

/** A handle for the times there is nothing to play: reduced motion, or no window to play in. */
function noopHandle(): BootSequenceHandle & PlannerArrivalHandle {
  return { finish: () => {}, done: true };
}

/** Everything this module writes onto an element, so a finish can take it all back off. */
const ELEMENT_VARS = ["--boot-i", "--boot-pin-at", "--boot-elapsed"] as const;

/** The planner's three section frames, the one staggered thing in the second act. */
const PLAN_SECTION_SELECTOR = ".game-panel--plan-column .plan-section";

/** Number the elements of a staggered stage in DOM order. Returns how many there were. */
function numberInOrder(root: ParentNode, selector: string, touched: Set<HTMLElement>): number {
  const els = root.querySelectorAll<HTMLElement>(selector);
  els.forEach((el, i) => {
    el.style.setProperty("--boot-i", String(i));
    touched.add(el);
  });
  return els.length;
}

/** True when the player has asked their system for less motion. */
function prefersReducedMotion(view: Window): boolean {
  return (
    typeof view.matchMedia === "function" &&
    view.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Take any planner hold off the shell, animating nothing.
 *
 * The belt to {@link startPlannerArrival}'s braces, and not redundant with it: a run abandoned
 * while the briefing is still up has no boot handle left to ask (see the module note), and a
 * hold left behind would be inherited by the next run — including one that opens with the boot
 * skipped and so never calls the second act at all. Safe on a shell carrying neither class.
 */
export function clearPlannerHold(shell: HTMLElement): void {
  shell.classList.remove(PLANNER_HOLD_CLASS, PLANNER_ARRIVAL_CLASS);
  for (const name of plannerTimingVars().keys()) {
    shell.style.removeProperty(name);
  }
  for (const el of shell.querySelectorAll<HTMLElement>(PLAN_SECTION_SELECTOR)) {
    el.style.removeProperty("--boot-i");
  }
}

export interface BootSequenceOptions {
  /** Called once the console is live, however it got there. */
  readonly onDone?: () => void;
  /**
   * Whether a pointer or key anywhere ends the sequence early.
   *
   * On by default, and the clock in {@link BOOT_STAGES} is timed on the assumption: the sequence
   * runs long enough to be worth watching once, which is a good deal longer than a player opening
   * their fiftieth run wants to wait. Turning this off without shortening the stages would leave
   * them waiting it out every time.
   */
  readonly skippable?: boolean;
}

/**
 * Put the shell in its pre-power state and start the clock.
 *
 * The class goes on synchronously, on the same frame the game screen is revealed, so there is
 * never a frame of the finished console showing before the boot hides it. The pin timings need
 * the projection, which needs the plot to have been measured at its revealed size, so that one
 * step waits two frames — by which time the `ResizeObserver` in `main.ts` has run and every pin
 * carries a real `--map-py`. Until then pins fall back to the head of their own stage, which is
 * whole seconds away on the current clock and was never less than a few hundred milliseconds.
 *
 * Also arms the second act, {@link startPlannerArrival}. See the module note for what the caller
 * owes the shell in return.
 */
export function startBootSequence(
  shell: HTMLElement,
  options: BootSequenceOptions = {},
): BootSequenceHandle {
  const { onDone, skippable = true } = options;
  const doc = shell.ownerDocument;
  if (doc.defaultView === null) {
    return noopHandle();
  }
  /* Re-bound past the null check because the timers and listeners below are reached from hoisted
   * function declarations, which narrowing does not follow into. */
  const view: Window = doc.defaultView;
  /* Someone who has asked their system for less motion gets the console, not the show — and no
   * hold either, so the planner is simply there from the first frame. */
  if (prefersReducedMotion(view)) {
    onDone?.();
    return noopHandle();
  }

  const touched = new Set<HTMLElement>();
  let done = false;
  let endTimer: number | null = null;
  let armFrame: number | null = null;
  let observer: MutationObserver | null = null;

  shell.classList.add(BOOT_SHELL_CLASS);
  /* Armed, not played: the planner sits off-stage until the briefing has been read. */
  shell.classList.add(PLANNER_HOLD_CLASS);
  for (const [name, value] of bootTimingVars()) {
    shell.style.setProperty(name, value);
  }

  /*
   * The two overlays the effect needs that are not in the markup: the power flash over the whole
   * shell, and the map's own strike line / wireframe / scanner.
   *
   * Built here rather than in index.html because they exist for one boot a run and mean nothing
   * to anything else — and because the map's live panel (`#map-panel`) is emptied by
   * `renderMapPanel` on every state change, so an overlay parked inside it would not survive
   * one. The map's layers hang off the panel *around* it instead.
   */
  const veil = doc.createElement("div");
  veil.className = "boot-veil";
  veil.setAttribute("aria-hidden", "true");
  for (const part of ["flash", "roll"]) {
    const layer = doc.createElement("div");
    layer.className = `boot-veil__${part}`;
    veil.appendChild(layer);
  }
  shell.appendChild(veil);

  const mapSection = shell.querySelector<HTMLElement>(".game-panel--map");
  let mapFx: HTMLElement | null = null;
  if (mapSection !== null) {
    mapFx = doc.createElement("div");
    mapFx.className = "boot-map-fx";
    mapFx.setAttribute("aria-hidden", "true");
    for (const part of ["line", "grid", "sweep"]) {
      const layer = doc.createElement("div");
      layer.className = `boot-map-fx__${part}`;
      mapFx.appendChild(layer);
    }
    mapSection.appendChild(mapFx);
  }

  /* The static stages can be numbered now: none of this markup is rebuilt by a render. The plan
   * sections are not among them any more — they belong to the second act, which numbers them
   * when it runs, long after `finish` has taken `--boot-i` back off everything written here. */
  const stats = numberInOrder(shell, ".game-stats .stat-block", touched);
  const tabs = numberInOrder(shell, ".drawer-cabinet .drawer-tab", touched);

  const startedAt = view.performance.now();

  /**
   * Hand each pin the moment the beam reaches it.
   *
   * Re-runnable, because `renderMapPanel` throws the pins away and builds new ones whenever the
   * state it reads changes. A pin that arrived mid-boot would otherwise sit at the head of the
   * stage and light late, long after the beam that should have lit it had gone past — so the
   * elapsed time goes on with it, and the stylesheet measures its delay from now rather than
   * from a start it was not there for.
   */
  function timePins(): number {
    const plot = shell.querySelector<HTMLElement>(".map-plot");
    const pins = shell.querySelectorAll<HTMLElement>(".map-plot .map-marker");
    const height = plot?.clientHeight ?? 0;
    const elapsed = Math.max(0, view.performance.now() - startedAt);
    pins.forEach((pin, i) => {
      /* `--map-py` is the projection's own answer for this pin, in plot pixels. A plot that has
       * not been projected yet reports nothing for any of them, and spreading those evenly down
       * the span is a better guess than stacking them all on one frame. */
      const py = Number.parseFloat(pin.style.getPropertyValue("--map-py"));
      const at = Number.isFinite(py)
        ? bootPinDelayMs(py, height)
        : BOOT_STAGES.pins.atMs +
          Math.round((i / Math.max(1, pins.length - 1)) * BOOT_PIN_SPAN_MS);
      pin.style.setProperty("--boot-pin-at", `${at}ms`);
      pin.style.setProperty("--boot-elapsed", `${Math.round(elapsed)}ms`);
      touched.add(pin);
    });
    return pins.length;
  }

  function finish(): void {
    if (done) {
      return;
    }
    done = true;
    if (endTimer !== null) {
      view.clearTimeout(endTimer);
      endTimer = null;
    }
    if (armFrame !== null) {
      view.cancelAnimationFrame(armFrame);
      armFrame = null;
    }
    observer?.disconnect();
    observer = null;
    view.removeEventListener("pointerdown", onSkip, true);
    view.removeEventListener("keydown", onSkip, true);
    shell.classList.remove(BOOT_SHELL_CLASS);
    for (const name of bootTimingVars().keys()) {
      shell.style.removeProperty(name);
    }
    for (const el of touched) {
      for (const name of ELEMENT_VARS) {
        el.style.removeProperty(name);
      }
    }
    touched.clear();
    veil.remove();
    mapFx?.remove();
    /* PLANNER_HOLD_CLASS stays on — see the note on `BootSequenceHandle.finish`. */
    onDone?.();
  }

  function onSkip(): void {
    finish();
  }

  if (skippable) {
    /* Capture, so a click that lands on a drawer tab skips the boot *and* opens the drawer —
     * the player asked for both. */
    view.addEventListener("pointerdown", onSkip, true);
    view.addEventListener("keydown", onSkip, true);
  }

  /* Two frames: one for the reveal to reach layout, one for the `ResizeObserver` that projects
   * the pins onto the freshly measured plot. */
  armFrame = view.requestAnimationFrame(() => {
    armFrame = view.requestAnimationFrame(() => {
      armFrame = null;
      if (done) {
        return;
      }
      const pins = timePins();
      const mapPanel = shell.querySelector<HTMLElement>(".map-panel");
      if (mapPanel !== null) {
        observer = new MutationObserver(() => {
          if (!done) {
            timePins();
          }
        });
        /*
         * The panel's own children only, deliberately not the subtree. A rebuild replaces the
         * whole `.map-plot`, so it shows up here; watching the subtree instead would also catch
         * the map's console clock rewriting its own text once a second, and re-time pins that
         * were part-way through lighting — which would drop each of them back to the head of its
         * animation and pop the whole map a second time.
         */
        observer.observe(mapPanel, { childList: true });
      }
      const total = bootSequenceDurationMs({ pins, stats, tabs });
      endTimer = view.setTimeout(
        finish,
        Math.max(0, total - (view.performance.now() - startedAt)),
      );
    });
  });

  return {
    finish,
    get done(): boolean {
      return done;
    },
  };
}

export interface PlannerArrivalOptions {
  /** Called once the planner is at rest, however it got there. */
  readonly onDone?: () => void;
  /** Whether a pointer or key lands the planner early. On by default, as for the boot. */
  readonly skippable?: boolean;
}

/**
 * Play the act the boot held back: the mission planner in off the left edge, its three sections
 * filling in as it lands, and the Deploy bar under them.
 *
 * Only ever plays an arrival that was *armed* — a shell not carrying {@link PLANNER_HOLD_CLASS}
 * is one whose planner has been on screen since the first frame (the "Skip boot up animation"
 * setting, reduced motion, or an arrival that has already run), and sliding it out and back in
 * would be an animation nobody asked for. So this is safe to call on any dismissal of the
 * briefing without the caller having to remember how the run opened.
 */
export function startPlannerArrival(
  shell: HTMLElement,
  options: PlannerArrivalOptions = {},
): PlannerArrivalHandle {
  const { onDone, skippable = true } = options;
  const doc = shell.ownerDocument;
  if (doc.defaultView === null || !shell.classList.contains(PLANNER_HOLD_CLASS)) {
    onDone?.();
    return noopHandle();
  }
  /* Re-bound past the null check for the same reason `startBootSequence` does it: the timer and
   * listeners below are reached from hoisted function declarations. */
  const view: Window = doc.defaultView;
  if (prefersReducedMotion(view)) {
    clearPlannerHold(shell);
    onDone?.();
    return noopHandle();
  }

  let done = false;
  let endTimer: number | null = null;

  for (const [name, value] of plannerTimingVars()) {
    shell.style.setProperty(name, value);
  }
  const sections = numberInOrder(shell, PLAN_SECTION_SELECTOR, new Set<HTMLElement>());
  /* Added before the hold comes off, though the order does not actually matter: the hold's rule
   * *is* the arrival's `0%` frame, so both orders paint the same first frame. Added first anyway,
   * so no reading of this leaves a window where neither class is on. */
  shell.classList.add(PLANNER_ARRIVAL_CLASS);
  shell.classList.remove(PLANNER_HOLD_CLASS);

  function finish(): void {
    if (done) {
      return;
    }
    done = true;
    if (endTimer !== null) {
      view.clearTimeout(endTimer);
      endTimer = null;
    }
    view.removeEventListener("pointerdown", onSkip, true);
    view.removeEventListener("keydown", onSkip, true);
    clearPlannerHold(shell);
    onDone?.();
  }

  function onSkip(): void {
    finish();
  }

  if (skippable) {
    view.addEventListener("pointerdown", onSkip, true);
    view.addEventListener("keydown", onSkip, true);
  }

  endTimer = view.setTimeout(finish, plannerArrivalDurationMs(sections));

  return {
    finish,
    get done(): boolean {
      return done;
    },
  };
}
