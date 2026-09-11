/**
 * Drop hint: while a card is in hand, the mission planning slots that would take it run a bright
 * red shine around their border, so where the card is headed reads at a glance instead of having
 * to be guessed at from the placeholder text.
 *
 * Which slots light up is decided by the card, not by the slot guessing at what is being carried.
 * `dataTransfer.getData` is deliberately blind outside `dragstart`/`drop` — a `dragover` handler
 * cannot read the payload, and a document-level `dragstart` listener runs in capture *before* the
 * card has set it — so the payload never reaches a bystander in time. Instead every card drag
 * goes through `beginCardDrag`, which is what hands the payload to the browser in the first
 * place, and each planner slot carries a `data-drop-accepts` list naming the payload kinds its
 * own drop handler would honour. The target slot rewrites its list whenever the planned mission
 * changes, so a mission that wants a location never lights up for a minion.
 *
 * A filled slot shines exactly like an empty one: dropping onto a filled slot replaces what is in
 * it, so it is just as much a destination.
 *
 * Wired in `main.ts` (`initDropHints`); the shine itself is in `styles.css`.
 */

/** The drag payload kinds a planner slot can name in its `data-drop-accepts` list. */
export type DragPayloadKind =
  | "mastermind-mission"
  | "mastermind-location"
  | "mastermind-asset"
  | "mastermind-minion"
  | "mastermind-asset-card";

const ALL_KINDS: readonly string[] = [
  "mastermind-mission",
  "mastermind-location",
  "mastermind-asset",
  "mastermind-minion",
  "mastermind-asset-card",
];

/** Marks a slot as a live destination for the card in hand; styled in `styles.css`. */
const HINT_CLASS = "plan-slot--drop-hint";

const ACCEPTS_ATTR = "data-drop-accepts";

/** The slots lit for the drag in progress, so they can be put out again without a re-query. */
let hinted: Element[] = [];

/**
 * Declares which payload kinds `el`'s drop handler honours. An empty list drops the attribute
 * altogether: a slot that accepts nothing right now (the target slot of a mission that takes no
 * target) should never light up.
 */
export function setDropAccepts(el: HTMLElement, kinds: readonly DragPayloadKind[]): void {
  if (kinds.length === 0) {
    el.removeAttribute(ACCEPTS_ATTR);
    return;
  }
  el.setAttribute(ACCEPTS_ATTR, kinds.join(" "));
}

export function clearDropHints(): void {
  for (const el of hinted) {
    el.classList.remove(HINT_CLASS);
  }
  hinted = [];
}

/**
 * The kind carried by a drag payload. Minion chips already staged in a slot hand over a bare
 * instance id rather than JSON — the minion slots accept both, so this reads both.
 */
export function dragPayloadKind(payload: string): DragPayloadKind | null {
  const t = payload.trim();
  if (t === "") {
    return null;
  }
  if (!t.startsWith("{")) {
    return "mastermind-minion";
  }
  try {
    const kind = (JSON.parse(t) as { kind?: unknown }).kind;
    if (typeof kind === "string" && ALL_KINDS.includes(kind)) {
      return kind as DragPayloadKind;
    }
  } catch {
    /* Not our payload; nothing in the planner would take it either. */
  }
  return null;
}

/**
 * Starts a card drag: hands `payload` to the browser and lights every planner slot that accepts
 * it. Call this instead of `dataTransfer.setData` — a drag that sets its own data silently skips
 * the hint.
 */
export function beginCardDrag(e: DragEvent, payload: string): void {
  e.dataTransfer?.setData("text/plain", payload);
  clearDropHints();
  const kind = dragPayloadKind(payload);
  if (kind === null) {
    return;
  }
  for (const slot of Array.from(document.querySelectorAll(`[${ACCEPTS_ATTR}]`))) {
    const accepts = (slot.getAttribute(ACCEPTS_ATTR) ?? "").split(/\s+/);
    if (!accepts.includes(kind)) {
      continue;
    }
    slot.classList.add(HINT_CLASS);
    hinted.push(slot);
  }
}

export function initDropHints(): void {
  /* Capture, for the same reason `dragFocus` uses it: several cards stop `dragstart` — and with
   * it the matching `dragend` — from bubbling past the panel behind them. */
  document.addEventListener("dragend", clearDropHints, { capture: true });
  document.addEventListener("drop", clearDropHints, { capture: true });
}
