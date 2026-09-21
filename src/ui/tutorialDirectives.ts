/**
 * The Directives card: what a player who has never opened this console is supposed to do first.
 *
 * It rides the map's inspector row like a site card — see `renderInspectorPane` in main.ts —
 * so it slides between slots as cards come and go rather than sitting in a fixed corner. The
 * three tasks are the opening loop of a run spelled out: find the places Omega Phase 1 wants,
 * get the gear those missions ask for, hire people who can do them.
 *
 * Each task twirls down onto the phase's missions, one sub-section per mission, because "acquire
 * assets" on its own tells a new player nothing — the answer is always *which* assets, for
 * *which* mission. A task with nothing left to ask for reads as ticked rather than disappearing:
 * a list that empties itself gives the player no way to check their own work.
 *
 * Presentational and data-in / DOM-out, like `ui/locationBrief.ts`: every catalog lookup and
 * every pill is the caller's, handed in already built. The pure helpers below — the ones that
 * decide what is covered and what is still missing — are the testable half, and carry no DOM.
 */
import { setTooltip } from "./tooltip";

/** What a mission's target line says while no site the player has identified can take it. */
export const DIRECTIVES_TARGET_UNKNOWN = "Target Unknown";

const ICON_CARET = '<path d="M9 5l7 7-7 7Z"/>';
const ICON_CHECK = '<path d="M5 12.5l4.5 4.5L19 7.5"/>';

/* ---------------------------------------------------------------------------------------
 * The pure half: what is covered, and what is still outstanding.
 * ------------------------------------------------------------------------------------- */

/** One entry of a mission's `requiredAssetIds`, and whether the player's stock covers it. */
export interface DirectivesAssetNeed {
  readonly assetId: string;
  /** Which unit of this asset the entry is — 1 for the first, 2 for a second copy, and so on. */
  readonly unit: number;
  readonly met: boolean;
}

/**
 * A mission's required assets against the player's inventory, one row per required entry.
 *
 * Duplicate ids mean multiple units (see `MissionTemplate.requiredAssetIds`), so the rows are
 * counted off rather than deduplicated: holding one crate of a mission that wants two lights the
 * first row and leaves the second dark, which is the same arithmetic the planner's asset slots
 * do and the same thing the player will see when they go to stage it.
 */
export function directivesAssetNeeds(
  requiredAssetIds: readonly string[],
  inventory: Readonly<Record<string, number>>,
): DirectivesAssetNeed[] {
  const seen = new Map<string, number>();
  return requiredAssetIds.map((assetId) => {
    const unit = (seen.get(assetId) ?? 0) + 1;
    seen.set(assetId, unit);
    return { assetId, unit, met: (inventory[assetId] ?? 0) >= unit };
  });
}

/** One skill a mission asks for, and whether anyone on the roster has it. */
export interface DirectivesSkillNeed {
  readonly traitId: string;
  readonly met: boolean;
}

/**
 * A mission's required traits against the roster's.
 *
 * One holder is enough, exactly as the mission scores it — any single participant carrying the
 * trait covers it — so this asks whether the trait is on the roster at all rather than counting
 * copies of it.
 */
export function directivesSkillNeeds(
  requiredTraitIds: readonly string[],
  rosterTraitIds: ReadonlySet<string>,
): DirectivesSkillNeed[] {
  return requiredTraitIds.map((traitId) => ({ traitId, met: rosterTraitIds.has(traitId) }));
}

/**
 * Whether a task counts as done: every one of its missions is covered, not just enough of them.
 *
 * A phase can be cleared by fewer missions than it lists (`omegaStageRequiredMissions`), but the
 * tick here is not a reading of the phase — it is a reading of the line the player is looking
 * at. Ticking a task with two of its three missions still short would put a green mark over a
 * list that visibly is not finished, and the sub-sections underneath say so. The tick means what
 * it looks like it means: everything twirled down under it is done.
 *
 * An empty task is not done. Nothing is being asked for, but nothing has been covered either,
 * and a green mark on a list with no lines in it claims work that was never there.
 */
export function directivesTaskDone(
  sections: readonly { readonly done: boolean }[],
): boolean {
  return sections.length > 0 && sections.every((s) => s.done);
}

/* ---------------------------------------------------------------------------------------
 * The model, and the card built from it.
 * ------------------------------------------------------------------------------------- */

/** How a task's note line reads: an answer the player does not have yet, or a settled one. */
export type DirectivesNoteTone = "unknown" | "settled";

/** One mission's sub-section inside a twirled-down task. */
export interface TutorialDirectivesSection {
  /** The mission's name, which is the sub-header the section is filed under. */
  readonly heading: string;
  /** Whether this mission's part of the task is covered. */
  readonly done: boolean;
  /** Pills the caller built — target sites, required assets, or required skills. */
  readonly pills: readonly HTMLElement[];
  /** Shown in place of pills when there is nothing to list ("Target Unknown", and friends). */
  readonly note: string | null;
  readonly noteTone: DirectivesNoteTone;
}

export interface TutorialDirectivesTask {
  /** Stable across renders: the open/closed state is remembered by this. */
  readonly id: string;
  readonly label: string;
  /** What the task is for, in a sentence, on the row's tooltip. */
  readonly hint: string;
  /** One per mission. The task ticks when all of them do; see {@link directivesTaskDone}. */
  readonly sections: readonly TutorialDirectivesSection[];
  /** Shown when the phase has no missions left to talk about. */
  readonly emptyNote: string;
}

export interface TutorialDirectivesModel {
  readonly tasks: readonly TutorialDirectivesTask[];
}

export interface TutorialDirectivesHandlers {
  /** Whether this task was left open. Asked on every build, so a rebuild restores the twirl. */
  isExpanded(taskId: string): boolean;
  /** Told when the player twirls one, so the caller can remember it past the next rebuild. */
  onToggle(taskId: string, expanded: boolean): void;
}

function directiveIcon(paths: string, className: string): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", className);
  svg.innerHTML = paths;
  return svg;
}

/**
 * The tick box at the end of a row. A readout rather than a checkbox: nothing here is the
 * player's to tick, it goes green when the run says the work is done.
 */
function directiveCheck(done: boolean, label: string): HTMLElement {
  const box = document.createElement("span");
  box.className = done ? "tutorial-directives__check tutorial-directives__check--done" : "tutorial-directives__check";
  box.setAttribute("role", "img");
  box.setAttribute("aria-label", done ? `${label}: done` : `${label}: not done`);
  if (done) {
    box.appendChild(directiveIcon(ICON_CHECK, "tutorial-directives__check-mark"));
  }
  return box;
}

function directiveSection(section: TutorialDirectivesSection): HTMLElement {
  const el = document.createElement("section");
  el.className = section.done
    ? "tutorial-directives__section tutorial-directives__section--done"
    : "tutorial-directives__section";

  const head = document.createElement("h6");
  head.className = "tutorial-directives__section-head";
  const name = document.createElement("span");
  name.className = "tutorial-directives__section-name";
  name.textContent = section.heading;
  head.appendChild(name);
  head.appendChild(directiveCheck(section.done, section.heading));
  el.appendChild(head);

  if (section.pills.length > 0) {
    const pills = document.createElement("div");
    pills.className = "tutorial-directives__pills";
    for (const pill of section.pills) {
      pills.appendChild(pill);
    }
    el.appendChild(pills);
  }

  if (section.note !== null) {
    const note = document.createElement("p");
    note.className =
      section.noteTone === "unknown"
        ? "tutorial-directives__note tutorial-directives__note--unknown"
        : "tutorial-directives__note";
    note.textContent = section.note;
    el.appendChild(note);
  }

  return el;
}

function directiveTask(
  task: TutorialDirectivesTask,
  idPrefix: string,
  handlers: TutorialDirectivesHandlers,
): HTMLElement {
  const done = directivesTaskDone(task.sections);
  const li = document.createElement("li");
  li.className = done ? "tutorial-directives__task tutorial-directives__task--done" : "tutorial-directives__task";

  const dropId = `${idPrefix}-${task.id}`;
  const expanded = handlers.isExpanded(task.id);
  if (expanded) {
    li.classList.add("tutorial-directives__task--open");
  }

  const row = document.createElement("div");
  row.className = "tutorial-directives__row";

  const twirl = document.createElement("button");
  twirl.type = "button";
  twirl.className = "tutorial-directives__twirl";
  twirl.setAttribute("aria-expanded", String(expanded));
  twirl.setAttribute("aria-controls", dropId);
  twirl.appendChild(directiveIcon(ICON_CARET, "tutorial-directives__caret"));
  const label = document.createElement("span");
  label.className = "tutorial-directives__label";
  label.textContent = task.label;
  twirl.appendChild(label);
  setTooltip(twirl, task.label, task.hint);
  twirl.addEventListener("click", () => {
    const next = !li.classList.contains("tutorial-directives__task--open");
    li.classList.toggle("tutorial-directives__task--open", next);
    twirl.setAttribute("aria-expanded", String(next));
    handlers.onToggle(task.id, next);
  });
  row.appendChild(twirl);
  row.appendChild(directiveCheck(done, task.label));
  li.appendChild(row);

  /* Two nested boxes because the twirl animates `grid-template-rows` from `0fr` to `1fr`, which
   * is the one way to travel to a height nobody has measured. The inner box is what gets
   * clipped, and it is what goes `visibility: hidden` while closed so the pills inside a shut
   * task stay out of the tab order. */
  const drop = document.createElement("div");
  drop.className = "tutorial-directives__drop";
  drop.id = dropId;
  const inner = document.createElement("div");
  inner.className = "tutorial-directives__drop-inner";

  if (task.sections.length === 0) {
    const empty = document.createElement("p");
    empty.className = "tutorial-directives__note";
    empty.textContent = task.emptyNote;
    inner.appendChild(empty);
  } else {
    for (const section of task.sections) {
      inner.appendChild(directiveSection(section));
    }
  }

  drop.appendChild(inner);
  li.appendChild(drop);
  return li;
}

/**
 * Builds the card's contents, ready to drop into an inspector pane's body.
 *
 * `idPrefix` namespaces the `aria-controls` wiring, for the same reason the lair panel takes
 * one: the card is rebuilt into whichever pane is holding it, and ids shared between two panes
 * would leave every reference ambiguous.
 */
export function buildTutorialDirectives(
  model: TutorialDirectivesModel,
  idPrefix: string,
  handlers: TutorialDirectivesHandlers,
): HTMLElement {
  const root = document.createElement("div");
  root.className = "tutorial-directives";

  const lede = document.createElement("p");
  lede.className = "tutorial-directives__lede";
  lede.textContent = "Phase 1 of your Omega Plan needs three things from you.";
  root.appendChild(lede);

  const list = document.createElement("ul");
  list.className = "tutorial-directives__list";
  for (const task of model.tasks) {
    list.appendChild(directiveTask(task, idPrefix, handlers));
  }
  root.appendChild(list);
  return root;
}
