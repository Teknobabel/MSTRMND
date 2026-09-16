/**
 * Shared pieces of the "brief" a card draws under its art: the framed section a mission card
 * files each of its statements in, the icon-and-label header a location card's sections open
 * with, and the placeholder either shows instead of collapsing when it has nothing to list.
 * Used by the location card's Intelligence Brief (`ui/locationBrief.ts`) and the mission card's
 * Mission Brief (`ui/missionBrief.ts`) so the two read as the same kind of paperwork — see
 * `.card-brief*` and `.brief-panel*` in styles.css for the rest of the shared visual language.
 */

export const ICON_CLIPBOARD =
  '<path d="M9 3h6v3H9z"/><path d="M15 4.5h3v16H6v-16h3"/><path d="M9 11h6M9 15h4"/>';
export const ICON_CRATE = '<path d="M6.5 3.5h11l4 5.5L12 21 2.5 9l4-5.5Z"/><path d="M2.5 9h19"/>';

export function briefIcon(paths: string, className: string): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", className);
  svg.innerHTML = paths;
  return svg;
}

/** A section's own icon + name + optional tally, e.g. "ASSETS  2/3". */
export function briefSectionLabel(iconPaths: string, text: string, tally: string | null): HTMLElement {
  const h = document.createElement("h5");
  h.className = "card-brief__label";
  h.appendChild(briefIcon(iconPaths, "card-brief__label-icon"));
  const span = document.createElement("span");
  span.className = "card-brief__label-text";
  span.textContent = text;
  h.appendChild(span);
  if (tally !== null) {
    const t = document.createElement("span");
    t.className = "card-brief__tally";
    t.textContent = tally;
    h.appendChild(t);
  }
  return h;
}

/**
 * A boxed section of a mission card: a ruled header strip carrying the console's tick mark and
 * the section's name, then the body it encloses.
 *
 * The mission card's four sections — brief, requirements, and the two outcomes — are each one of
 * these. A location card keeps the flat `briefSectionLabel` headings instead: its brief is one
 * form that fills in as intel arrives, and boxing its halves separately would cut that form in
 * two. A mission's sections are genuinely four separate statements about one job, which is what
 * the frames are for.
 *
 * `modifier` tones the frame — see `.brief-panel--good` / `--bad`.
 */
export function briefPanel(
  title: string,
  modifier?: string,
): { panel: HTMLElement; body: HTMLElement } {
  const panel = document.createElement("section");
  panel.className = modifier === undefined ? "brief-panel" : `brief-panel ${modifier}`;

  const head = document.createElement("h5");
  head.className = "brief-panel__head";
  const mark = document.createElement("span");
  mark.className = "brief-panel__mark";
  mark.setAttribute("aria-hidden", "true");
  head.appendChild(mark);
  const text = document.createElement("span");
  text.className = "brief-panel__title";
  text.textContent = title;
  head.appendChild(text);
  panel.appendChild(head);

  const body = document.createElement("div");
  body.className = "brief-panel__body";
  panel.appendChild(body);

  return { panel, body };
}

/** The "nothing here yet" line a section shows instead of collapsing, so the form reads as blank
 * rather than absent — the whole point of a brief that fills in. */
export function briefPlaceholder(text: string, tooltip?: string): HTMLElement {
  const p = document.createElement("p");
  p.className = "card-brief__empty";
  p.textContent = text;
  if (tooltip !== undefined) {
    p.title = tooltip;
  }
  return p;
}
