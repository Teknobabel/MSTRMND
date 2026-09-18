/**
 * The run briefing: the classified page the console puts up over the world map once the
 * viewscreen has finished coming on.
 *
 * A run used to open straight onto a live console with no statement of what the player had just
 * rolled. The two picks the title screen makes — the Omega Plan and the Lair — decide the whole
 * run, and both were only discoverable by opening a drawer and reading a banner. This is that
 * banner, said once, at the moment it is news: who the player is, which plan they are advancing,
 * where they are advancing it from, and what to do about it first.
 *
 * Purely presentational and data-in / DOM-out, in the same way as `ui/locationBrief.ts` and
 * `ui/missionBrief.ts`: it is handed strings and art URLs already resolved against the catalog
 * and knows nothing about `GameState`. `main.ts` builds the model, because the phase copy and
 * the catalog lookups are already in its hand there.
 *
 * The shell — backdrop, head, footer, the Enter Command button — is static markup in
 * `index.html` for the same reason the other overlays' is: it never changes shape, and a
 * `<button>` rebuilt under the player's cursor is a button that loses focus. Only the three rows
 * are built here, and they are cleared again on close so the three heroes' decoded bitmaps are
 * let go of rather than held for the rest of the run (see `ui/cardArt.ts` on what a hero costs).
 */
import { createCardArtImg } from "./cardArt";

/** The mark a row's label wears: line art, or a text glyph like the plan's Ω. */
export type RunBriefingIcon =
  | { readonly kind: "paths"; readonly paths: string }
  | { readonly kind: "text"; readonly text: string };

/** One numbered row of the briefing — a subject, stated once, with its art beside it. */
export interface RunBriefingRow {
  /** What kind of thing the row is about: "Omega Plan", "Your Operation". */
  readonly label: string;
  readonly icon: RunBriefingIcon;
  /** The subject itself — the phase and plan, the lair's name, the directive. */
  readonly title: string;
  readonly body: string;
  /** The stamp under the body, in the console's own `//` form: "Global Impact". */
  readonly tag: string;
  readonly artSrc: string;
  /** The plate over the art: the subject's name, or a motto where it has no name of its own. */
  readonly artCaption: string;
}

export interface RunBriefingModel {
  /** The mastermind this run rolled, as the title's second line. */
  readonly playerName: string;
  /** The paragraph under the title: what the console makes of the situation. */
  readonly lede: string;
  readonly rows: readonly RunBriefingRow[];
}

export interface RunBriefingApi {
  /** Put the briefing up, built from `model`. Replaces one already showing. */
  open(model: RunBriefingModel): void;
  /** Take it down and let go of its art. Idempotent. */
  close(): void;
  readonly isOpen: boolean;
}

function req<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing #${id}`);
  }
  return el as T;
}

/** The label's mark, as either the line art every other console icon is drawn as or a glyph. */
function buildRowIcon(icon: RunBriefingIcon): HTMLElement | SVGElement {
  if (icon.kind === "text") {
    const span = document.createElement("span");
    span.className = "nav-icon nav-icon--text run-briefing-row__icon";
    span.setAttribute("aria-hidden", "true");
    span.textContent = icon.text;
    return span;
  }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "nav-icon run-briefing-row__icon");
  svg.innerHTML = icon.paths;
  return svg;
}

/**
 * One row: the text column, then the art with its name plate over it.
 *
 * `index` is both the row's file number, printed in the corner, and its place in the arrival
 * stagger — the stylesheet reads it off `--brief-i`, the same way the boot sequence's staggered
 * stages read `--boot-i`.
 */
function buildRow(row: RunBriefingRow, index: number): HTMLElement {
  const article = document.createElement("article");
  article.className = "run-briefing-row";
  article.style.setProperty("--brief-i", String(index));

  const text = document.createElement("div");
  text.className = "run-briefing-row__text";

  const head = document.createElement("h3");
  head.className = "run-briefing-row__label";
  head.appendChild(buildRowIcon(row.icon));
  const labelText = document.createElement("span");
  labelText.className = "run-briefing-row__label-text";
  labelText.textContent = row.label;
  head.appendChild(labelText);
  text.appendChild(head);

  /* The file number, in the row's own corner. Two digits always, so a briefing of three rows
     reads as a numbered document rather than as a list of one, two, three. */
  const num = document.createElement("span");
  num.className = "run-briefing-row__num";
  num.setAttribute("aria-hidden", "true");
  num.textContent = String(index + 1).padStart(2, "0");
  text.appendChild(num);

  const title = document.createElement("h4");
  title.className = "run-briefing-row__title";
  title.textContent = row.title;
  text.appendChild(title);

  const body = document.createElement("p");
  body.className = "run-briefing-row__body";
  body.textContent = row.body;
  text.appendChild(body);

  /* Stamp plus the rule that runs off it — the same ruled strip a plan section's head draws,
     stood on its own at the foot of the row. */
  const stamp = document.createElement("p");
  stamp.className = "run-briefing-row__stamp";
  const tag = document.createElement("span");
  tag.className = "run-briefing-row__tag";
  tag.textContent = row.tag;
  stamp.appendChild(tag);
  const rule = document.createElement("span");
  rule.className = "run-briefing-row__rule";
  rule.setAttribute("aria-hidden", "true");
  stamp.appendChild(rule);
  text.appendChild(stamp);

  article.appendChild(text);

  const figure = document.createElement("figure");
  figure.className = "run-briefing-row__figure";
  figure.appendChild(createCardArtImg(row.artSrc, "run-briefing-row__art"));
  const caption = document.createElement("figcaption");
  caption.className = "run-briefing-row__caption";
  caption.textContent = row.artCaption;
  figure.appendChild(caption);
  article.appendChild(figure);

  return article;
}

/**
 * Wires the briefing overlay. `onDismissed` fires once per dismissal, however it happened — the
 * button or the backdrop — and is where the caller hands the console back to the player.
 *
 * Escape is left to the caller rather than listened for here: `main.ts` already owns one
 * window-level Escape handler that has to decide between the dialogs and an open drawer, and a
 * second listener racing it would make which one wins a matter of registration order.
 */
export function initRunBriefing(onDismissed: () => void = () => {}): RunBriefingApi {
  const overlay = req<HTMLElement>("overlay-run-briefing");
  const backdrop = req<HTMLElement>("run-briefing-backdrop");
  const nameEl = req<HTMLElement>("run-briefing-name");
  const ledeEl = req<HTMLElement>("run-briefing-lede");
  const rowsEl = req<HTMLElement>("run-briefing-rows");
  const btnEnter = req<HTMLButtonElement>("btn-run-briefing-enter");

  let showing = false;

  function close(): void {
    if (!showing) {
      return;
    }
    showing = false;
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    /* Lets go of the three heroes rather than keeping them decoded for the rest of a run that
     * will never show this page again. */
    rowsEl.innerHTML = "";
    onDismissed();
  }

  btnEnter.addEventListener("click", close);
  backdrop.addEventListener("click", close);

  return {
    open(model: RunBriefingModel): void {
      nameEl.textContent = model.playerName;
      ledeEl.textContent = model.lede;
      rowsEl.innerHTML = "";
      model.rows.forEach((row, i) => {
        rowsEl.appendChild(buildRow(row, i));
      });
      showing = true;
      /* `hidden` coming off is what starts the arrival: every animation on the panel and its
       * rows is on an element that was `display: none` a frame ago, which restarts it — so the
       * briefing plays itself in on every run with no class to toggle and no reflow to force. */
      overlay.hidden = false;
      overlay.setAttribute("aria-hidden", "false");
      btnEnter.focus();
    },
    close,
    get isOpen(): boolean {
      return showing;
    },
  };
}
