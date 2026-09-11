/**
 * Drop hint: while a card is in hand, the mission planning slots that would take it run a bright
 * red shine around their border, so where the card is headed reads at a glance instead of having
 * to be guessed at from the placeholder text. Carried over one of them, the slot locks on —
 * brackets snap to its corners, the shine goes solid, and it spells out what letting go will do.
 * Let go, and the card lands with a stamp and a ring; let go over a slot that will not take it,
 * and the slot shakes it off instead. Only on the release — a card carried *across* a slot on its
 * way somewhere else has done nothing wrong, and the browser's no-drop cursor already says "not
 * here" while it passes.
 *
 * Which slots light up is decided by the card, not by the slot guessing at what is being carried.
 * `dataTransfer.getData` is deliberately blind outside `dragstart`/`drop` — a `dragover` handler
 * cannot read the payload, and a document-level `dragstart` listener runs in capture *before* the
 * card has set it — so the payload never reaches a bystander in time. Instead every card drag
 * goes through `beginCardDrag`, which is what hands the payload to the browser in the first
 * place, and holds it up against every slot wired with `wireDropSlot`: the slot's kind list, then
 * its own finer test (the same one its drop handler makes), so a slot that would turn the card
 * away never lights up for it.
 *
 * Only a lit slot takes the drop. Everywhere else the browser shows its no-drop cursor, and a
 * staged card let go there counts as dragged off its slot — which is what that gesture means
 * everywhere else on the screen. The one exception is the slot the card was picked up out of: it
 * does not shine (it is where the card already is, not where it is going), but it still takes the
 * card back, so dropping a card where it was is a no-op rather than a removal.
 *
 * A filled slot shines exactly like an empty one: dropping onto a filled slot replaces what is in
 * it, so it is just as much a destination.
 *
 * Either side of the drag gets a word too. Before it: resting the pointer on a card registered
 * with `setCardDragPayload` faintly outlines the slots it would go to, so the mapping can be
 * learnt by looking. During it: the card is dimmed where it was picked up, so the only full-
 * strength copy is the one in hand. And a card staged without a drag at all — by its
 * add-to-planner button — lands (`playLanding`) or is shaken off (`playRefusal`) exactly as a
 * dropped one is.
 *
 * Wired in `main.ts` (`initDropHints`, `wireDropSlot`); the look is in `styles.css`.
 */

import {
  discardDragToken,
  isDragTokenLive,
  lockDragToken,
  refuseDragToken,
  returnDragToken,
  settleDragToken,
  startDragToken,
  unlockDragToken,
} from "./dragToken";

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

/**
 * A lit slot's place in the lighting order, top of the planner first. The slots ignite one after
 * another off it rather than all at once: something *starting* to move catches the corner of the
 * eye far better than something that has been moving all along, and a run of starts sweeping down
 * the planner pulls the eye there before the shine settles into its loop.
 */
const HINT_ORDER_PROP = "--plan-slot-hint-order";

/** The lit slot the card is being held over. */
const LOCK_CLASS = "plan-slot--drop-lock";

/** One-shot: the card just landed here. */
const LANDED_CLASS = "plan-slot--landed";

/** One-shot: the slot turned the card away. */
const REJECT_CLASS = "plan-slot--drop-reject";

/** The keyframes each one-shot class runs, so its `animationend` can be told from any other. */
const ONE_SHOT_ANIMATION: Record<string, string> = {
  [LANDED_CLASS]: "plan-slot-land",
  [REJECT_CLASS]: "plan-slot-reject",
};

/** A slot the card under the pointer would drop into, shown before it is picked up. */
const HOVER_HINT_CLASS = "plan-slot--hover-hint";

/** The card being carried, as it is left behind in its menu or on the map. */
const IN_HAND_CLASS = "ui-card-in-hand";

const ACCEPTS_ATTR = "data-drop-accepts";

/** Names a slot so it can be found again after the drop re-renders it. */
const KEY_ATTR = "data-drop-slot";

/** Milliseconds per character of the lock label typing itself out. */
const TYPE_MS = 18;

/**
 * How long the pointer rests on a card before its slots are previewed. Long enough that sweeping
 * across a drawer full of cards does not strobe the planner; short enough to read as a response
 * to the card rather than a delayed tooltip.
 */
const HOVER_DWELL_MS = 160;

/**
 * A slot's own test of a payload its kind list already lets through — the same check its drop
 * handler makes, so it only lights up for a card it would actually stage.
 */
export type DropFilter = (payload: string) => boolean;

export interface DropSlotOptions {
  /** Unique across the planner: how the slot is found again once a drop has re-rendered it. */
  key: string;
  /** Payload kinds the drop handler honours. */
  accepts: readonly DragPayloadKind[];
  /** The finer test on top of `accepts`; omitted, every payload of those kinds is taken. */
  canTake?: DropFilter;
  /** Whether something is staged here now, which turns "assign" into "replace" on the lock. */
  isFilled: () => boolean;
  /** Stages the dropped card; true when it actually went in. */
  onDrop: (payload: string) => boolean;
}

const canTakeBySlot = new WeakMap<Element, DropFilter>();

/** What each hoverable card would hand over if it were picked up; see `setCardDragPayload`. */
const payloadByCard = new WeakMap<Element, () => string | null>();

/** The slots lit for the drag in progress, so they can be put out again without a re-query. */
let hinted: HTMLElement[] = [];

/** The card being carried, dimmed where it was picked up from. */
let inHand: Element | null = null;

/** The card under the pointer, the dwell before its preview, and the slots it previewed. */
let hoverCard: HTMLElement | null = null;
let hoverTimer: number | undefined;
let hoverHinted: HTMLElement[] = [];

/**
 * Set as a card drag ends, cleared by the first real pointer movement. The browser hears no
 * pointer events during a drag, so as one ends it replays a `pointerover` from where the pointer
 * was *before* the drag — onto the card just picked up, wherever the pointer really is now — and
 * would preview that card into slots it has just been dropped in. Nothing from the pointer counts
 * until it has actually moved.
 */
let hoverAwaitsPointer = false;

/** The pointer's last known position, and where it was when the latest drag began. */
let pointerAt = { x: Number.NaN, y: Number.NaN };
let pointerAtDragStart = pointerAt;

/** The slot the card in hand was picked up out of, if it came out of one. */
let homeSlot: Element | null = null;

/**
 * What the card in hand carries, as `beginCardDrag` was given it. This — not the drag's
 * `dataTransfer` — is what a slot stages on drop. The browser is only *asked* to carry the
 * payload, and some do not: Brave on Windows delivers the drop with no data at all (`types`
 * empty, `getData` blank), so a slot that read it back from the event would light up for the
 * card and then have nothing to stage. Every card drag starts here, so the page already knows.
 */
let cardPayload: string | null = null;

/**
 * Whether a card drag is in progress. A file or a run of text dragged in from outside never goes
 * through `beginCardDrag`, and nothing in the planner should shake at it.
 */
let cardDragLive = false;

/**
 * The element the pointer last crossed into. A refused release fires `dragleave` at the slot
 * before `dragend`, so the slot itself cannot tell a release from the pointer moving off it — but
 * moving off always enters something else first, and a release never does.
 */
let lastEntered: EventTarget | null = null;

/**
 * Bumped at the start and end of every drag, so a slot can tell a stale enter count left over
 * from a drag whose `dragleave` it never heard (cancelled with Escape, say) from this one's.
 */
let dragSerial = 0;

let locked: HTMLElement | null = null;
let typingTimer: number | undefined;

/** The slot that would not take the card in hand, while the pointer is over it. */
let refusingHover: HTMLElement | null = null;

/** When the drag in progress began; see the stray-pointer safety net in `initDropHints`. */
let dragStartedAt = 0;

/**
 * Under this long after `dragstart`, a pointer event can still be one the browser queued before
 * the drag took over, rather than a sign that the drag is over.
 */
const DRAG_SETTLE_MS = 150;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function clearDropHints(): void {
  for (const el of hinted) {
    el.classList.remove(HINT_CLASS);
    el.style.removeProperty(HINT_ORDER_PROP);
  }
  hinted = [];
  inHand?.classList.remove(IN_HAND_CLASS);
  inHand = null;
  homeSlot = null;
  cardPayload = null;
  /* The token keeps its grey through the exit it is about to play; only the tracking goes. */
  refusingHover = null;
  if (cardDragLive) {
    hoverAwaitsPointer = true;
  }
  cardDragLive = false;
  lastEntered = null;
  dragSerial += 1;
  unlock();
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
 * The planner slots that would take `payload`, top of the planner first, and the one `source`
 * sits in if it was picked up out of a slot — which is never among the takers: it is where the
 * card already is, not where it is going.
 */
function matchSlots(
  payload: string,
  source: Element | null,
): { taking: HTMLElement[]; home: HTMLElement | null } {
  const taking: HTMLElement[] = [];
  let home: HTMLElement | null = null;
  const kind = dragPayloadKind(payload);
  for (const slot of Array.from(document.querySelectorAll<HTMLElement>(`[${ACCEPTS_ATTR}]`))) {
    if (source !== null && slot.contains(source)) {
      home = slot;
      continue;
    }
    if (kind === null) {
      continue;
    }
    const accepts = (slot.getAttribute(ACCEPTS_ATTR) ?? "").split(/\s+/);
    if (!accepts.includes(kind)) {
      continue;
    }
    if (canTakeBySlot.get(slot)?.(payload) === false) {
      continue;
    }
    taking.push(slot);
  }
  return { taking, home };
}

/**
 * Starts a card drag: hands `payload` to the browser and lights every planner slot that would
 * take it. Call this instead of `dataTransfer.setData` — a drag that sets its own data silently
 * skips the hint, and no slot will take its drop.
 */
export function beginCardDrag(e: DragEvent, payload: string): void {
  /* Still set: Firefox will not start a drag that carries no data. */
  e.dataTransfer?.setData("text/plain", payload);
  clearHoverHints();
  clearDropHints();
  cardDragLive = true;
  cardPayload = payload;
  dragStartedAt = performance.now();
  pointerAtDragStart = pointerAt;
  startDragToken(e, payload);
  /* What the browser is carrying: the card, not whichever child the drag was begun on. (Card
   * art is `draggable = false` — see `createCardArtImg` — so it never becomes the source itself.) */
  const source = e.target instanceof Element ? e.target.closest('[draggable="true"]') : null;
  const { taking, home } = matchSlots(payload, source);
  homeSlot = home;
  hinted = taking;
  taking.forEach((slot, order) => {
    /* Document order is top to bottom down the planner, which is the sweep. */
    slot.style.setProperty(HINT_ORDER_PROP, String(order));
    slot.classList.add(HINT_CLASS);
  });
  if (source !== null) {
    markInHand(source);
  }
}

/**
 * Dims the card where it was picked up, so the menu or map it came out of shows a gap where it
 * was, and the only full-strength copy is the one in hand. Held back a tick: the browser snapshots
 * the drag image from the card as it stands once `dragstart` has run, and a card dimmed in that
 * same turn would be carried as a dim ghost of itself.
 */
function markInHand(source: Element): void {
  const serial = dragSerial;
  window.setTimeout(() => {
    /* The drag may already be over — cancelled on the spot, or a drop that re-rendered the card
     * away — and a card left dimmed after its drag has ended would read as unavailable. */
    if (serial !== dragSerial || !source.isConnected) {
      return;
    }
    inHand = source;
    source.classList.add(IN_HAND_CLASS);
  }, 0);
}

/**
 * Registers what `card` would hand over if it were picked up, so resting the pointer on it can
 * preview the slots it would drop into. Return `null` for a card that cannot go to the planner
 * right now; a card that is not `draggable` at the time is skipped regardless.
 */
export function setCardDragPayload(card: HTMLElement, payload: () => string | null): void {
  payloadByCard.set(card, payload);
}

function clearHoverHints(): void {
  window.clearTimeout(hoverTimer);
  hoverTimer = undefined;
  hoverCard = null;
  for (const el of hoverHinted) {
    el.classList.remove(HOVER_HINT_CLASS);
  }
  hoverHinted = [];
}

/** The registered card `node` sits in, if any. */
function hoverableCardFrom(node: EventTarget | null): HTMLElement | null {
  for (let el = node instanceof Element ? node : null; el !== null; el = el.parentElement) {
    if (payloadByCard.has(el) && el instanceof HTMLElement) {
      return el;
    }
  }
  return null;
}

/**
 * Previews, once the pointer has rested on a card, the slots it would drop into — so where a card
 * goes is something the player can learn by looking, before ever picking one up. It asks exactly
 * the question a drag would, through `matchSlots`, so the preview and the drag never disagree.
 */
function onPointerOver(e: PointerEvent): void {
  /* No hover on a touchscreen: the preview would come on under the finger that is about to drag. */
  if (e.pointerType === "touch" || cardDragLive || hoverAwaitsPointer) {
    return;
  }
  const card = hoverableCardFrom(e.target);
  if (card === hoverCard) {
    return;
  }
  clearHoverHints();
  if (card === null || !card.draggable) {
    return;
  }
  hoverCard = card;
  hoverTimer = window.setTimeout(() => {
    hoverTimer = undefined;
    const payload = card.isConnected ? payloadByCard.get(card)?.() : null;
    if (!payload) {
      return;
    }
    hoverHinted = matchSlots(payload, card).taking;
    for (const slot of hoverHinted) {
      slot.classList.add(HOVER_HINT_CLASS);
    }
  }, HOVER_DWELL_MS);
}

function onPointerOut(e: PointerEvent): void {
  if (hoverCard === null) {
    return;
  }
  /* Crossing from the card onto one of its own children is not leaving it. */
  if (e.relatedTarget instanceof Node && hoverCard.contains(e.relatedTarget)) {
    return;
  }
  clearHoverHints();
}

/**
 * What `el` is to the drag in progress: a lit destination, the slot the card came out of, or a
 * bystander that will not take it.
 */
function roleOf(el: Element): "target" | "home" | null {
  if (el === homeSlot) {
    return "home";
  }
  return el.classList.contains(HINT_CLASS) ? "target" : null;
}

/**
 * Lays the lock over `el`: corner brackets and a label that types itself out. The label goes on
 * the drag token when there is one — the token is drawn over the slot, so a label on the slot
 * would sit under it — and over whatever the slot is showing when there is not. It reserves its
 * full width from the first frame, so it types in place rather than growing out of the middle.
 */
function lock(el: HTMLElement, filled: boolean): void {
  unlock();
  locked = el;
  el.classList.add(LOCK_CLASS);

  const text = filled ? "Release to replace" : "Release to assign";
  const overlay = document.createElement("span");
  overlay.className = "plan-slot-lock";
  overlay.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.className = "plan-slot-lock__label";
  const typed = document.createElement("span");
  typed.className = "plan-slot-lock__typed";
  const rest = document.createElement("span");
  rest.className = "plan-slot-lock__rest";
  label.append(typed, rest);
  if (!lockDragToken(el, label)) {
    overlay.appendChild(label);
  }
  el.appendChild(overlay);

  let shown = prefersReducedMotion() ? text.length : 0;
  const render = (): void => {
    typed.textContent = text.slice(0, shown);
    rest.textContent = text.slice(shown);
  };
  render();
  const step = (): void => {
    shown += 1;
    render();
    typingTimer = shown < text.length ? window.setTimeout(step, TYPE_MS) : undefined;
  };
  if (shown < text.length) {
    typingTimer = window.setTimeout(step, TYPE_MS);
  }
}

function unlock(): void {
  window.clearTimeout(typingTimer);
  typingTimer = undefined;
  if (locked === null) {
    return;
  }
  unlockDragToken();
  locked.classList.remove(LOCK_CLASS);
  locked.querySelector(":scope > .plan-slot-lock")?.remove();
  locked = null;
}

/**
 * Runs a one-shot class from the top, restarting it if it is already mid-run, and takes it off
 * once its own animation ends — not one of the slot's children's, whose `animationend` bubbles
 * up here too. Under reduced motion the animation is cut to nothing but still ends, so the class
 * never outstays it.
 */
function playOnce(el: HTMLElement, cls: string): void {
  const name = ONE_SHOT_ANIMATION[cls];
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  const done = (e: AnimationEvent): void => {
    if (e.target !== el || e.pseudoElement !== "" || e.animationName !== name) {
      return;
    }
    el.classList.remove(cls);
    el.removeEventListener("animationend", done);
  };
  el.addEventListener("animationend", done);
}

/**
 * Plays a one-shot on the slot named `key` once the frame's rendering has settled. Whatever just
 * staged the card has usually re-rendered the slot by then, so the element to animate is looked
 * up afresh rather than held on to.
 */
function playOnSlot(key: string, cls: string): void {
  window.requestAnimationFrame(() => {
    const slot = document.querySelector<HTMLElement>(`[${KEY_ATTR}="${CSS.escape(key)}"]`);
    if (slot !== null) {
      playOnce(slot, cls);
    }
  });
}

/**
 * The landing, for a card staged into slot `key` some way other than a drop — a card's
 * add-to-planner button — so the card arrives the same way however it was sent.
 */
export function playLanding(key: string): void {
  playOnSlot(key, LANDED_CLASS);
}

/** The head-shake, for slot `key` turning down a card sent to it some way other than a drop. */
export function playRefusal(key: string): void {
  playOnSlot(key, REJECT_CLASS);
}

/**
 * Makes `el` a planner drop slot: declares what it takes, locks on when a card it takes is held
 * over it, refuses everything else, and plays the landing (or the shake) when a card is let go.
 */
export function wireDropSlot(el: HTMLElement, opts: DropSlotOptions): void {
  el.setAttribute(ACCEPTS_ATTR, opts.accepts.join(" "));
  el.setAttribute(KEY_ATTR, opts.key);
  if (opts.canTake !== undefined) {
    canTakeBySlot.set(el, opts.canTake);
  }

  /*
   * `dragenter` and `dragleave` fire for every child the pointer crosses, and the enter on the
   * child comes *before* the leave on the slot — so the slot counts them rather than trusting
   * the last one it heard, or the lock would flicker off over every chip and placeholder.
   */
  let depth = 0;
  let depthSerial = -1;
  /* Read on every `dragover`, and kept for `drop`: by the time a slot hears its drop, the
   * document's capture listener has already put the hints out — and `cardPayload` with them. */
  let role: "target" | "home" | null = null;
  let payload: string | null = null;

  el.addEventListener("dragenter", (e) => {
    if (depthSerial !== dragSerial) {
      depthSerial = dragSerial;
      depth = 0;
    }
    depth += 1;
    role = roleOf(el);
    payload = cardPayload;
    if (role !== null) {
      e.preventDefault();
    }
    if (depth !== 1) {
      return;
    }
    if (role === "target") {
      lock(el, opts.isFilled());
    } else if (role === null && cardDragLive) {
      refusingHover = el;
      refuseDragToken(true);
    }
  });

  el.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (depth !== 0) {
      return;
    }
    if (locked === el) {
      unlock();
    }
    if (refusingHover === el) {
      refusingHover = null;
      refuseDragToken(false);
    }
  });

  el.addEventListener("dragover", (e) => {
    role = roleOf(el);
    payload = cardPayload;
    if (role === null) {
      return;
    }
    e.preventDefault();
    const dt = e.dataTransfer;
    if (dt) {
      /* A drop effect the source did not allow is refused outright, so match it: staged cards
       * move out of their slot, cards off the menus and the map are copied in. */
      dt.dropEffect = dt.effectAllowed === "move" ? "move" : "copy";
    }
  });

  el.addEventListener("drop", (e) => {
    e.preventDefault();
    const wasTarget = role === "target";
    /* The payload this slot lit up for, not whatever the browser handed back (see
     * `cardPayload`). A drop only fires here after this slot cancelled a `dragover`, which it
     * does only for a card drag, so the held payload is always there; the event's own data is a
     * fallback that should never be needed. */
    const raw = (payload ?? e.dataTransfer?.getData("text/plain") ?? "").trim();
    depth = 0;
    role = null;
    payload = null;
    unlock();
    const staged = raw !== "" && opts.onDrop(raw);
    /* The handler has just re-rendered the slot; the token needs the new one to fly into. */
    const findSlot = (): HTMLElement | null =>
      document.querySelector<HTMLElement>(`[${KEY_ATTR}="${CSS.escape(opts.key)}"]`);
    if (!wasTarget) {
      /* Put back where it was picked up: it settles into its own slot, with no fanfare. */
      void settleDragToken(findSlot);
      return;
    }
    if (staged) {
      void settleDragToken(findSlot).then(() => {
        /* In the same turn the slot's contents come back into view — not a frame later through
         * `playLanding`, or the chip would show at rest for a frame before it lands. */
        const slot = findSlot();
        if (slot !== null) {
          playOnce(slot, LANDED_CLASS);
        }
      });
    } else {
      returnDragToken();
      playOnce(el, REJECT_CLASS);
    }
  });
}

/** The planner slot a card was just let go over and refused by, if it was. */
function refusingSlotUnderPointer(): HTMLElement | null {
  if (!cardDragLive || !(lastEntered instanceof Element)) {
    return null;
  }
  const slot = lastEntered.closest<HTMLElement>(`[${ACCEPTS_ATTR}]`);
  return slot !== null && roleOf(slot) === null ? slot : null;
}

export function initDropHints(): void {
  /* Capture throughout, for the same reason `dragFocus` uses it: several cards stop `dragstart` —
   * and with it the matching `dragend` — from bubbling past the panel behind them. */
  document.addEventListener(
    "dragenter",
    (e) => {
      lastEntered = e.target;
    },
    { capture: true },
  );
  document.addEventListener(
    "dragend",
    (e) => {
      /* Read before the hints go out: which slots were lit is what says this one refused, and
       * a card that came out of a slot is one the planner is about to drop for being let go. */
      const droppedNowhere = e.dataTransfer?.dropEffect === "none";
      const refused = droppedNowhere ? refusingSlotUnderPointer() : null;
      const offThePlanner = droppedNowhere && homeSlot !== null;
      clearDropHints();
      if (refused !== null) {
        playOnce(refused, REJECT_CLASS);
      }
      /* A drop onto a slot has already sent the token on its way; this is every other ending. */
      if (isDragTokenLive()) {
        if (offThePlanner) {
          discardDragToken();
        } else {
          returnDragToken();
        }
      }
    },
    { capture: true },
  );
  /* Heard as well as `dragend`, because a staged card moved between slots is re-rendered away
   * mid-drop, and a detached card's `dragend` never reaches the document. */
  document.addEventListener("drop", clearDropHints, { capture: true });

  /*
   * Safety net. The browser sends no pointer events while a drag is on, so a pointer moving once
   * a card drag has settled in means the drag is over without anyone here hearing it end — a
   * card re-rendered out from under the pointer mid-drag takes its `dragend` with it. Without
   * this the hints would stay lit and the token would hang where it was last drawn.
   */
  document.addEventListener(
    "pointermove",
    (e) => {
      pointerAt = { x: e.clientX, y: e.clientY };
      if (cardDragLive && performance.now() - dragStartedAt >= DRAG_SETTLE_MS) {
        clearDropHints();
        returnDragToken();
      }
      /* The first real movement after a drag — one from somewhere other than where the drag
       * began, which is where any replayed event would claim to be. The `pointerover` for where
       * it has really landed came just before this and was ignored, so take the hover from here. */
      const moved = e.clientX !== pointerAtDragStart.x || e.clientY !== pointerAtDragStart.y;
      if (hoverAwaitsPointer && !cardDragLive && moved) {
        hoverAwaitsPointer = false;
        onPointerOver(e);
      }
    },
    { passive: true },
  );

  document.addEventListener("pointerover", onPointerOver, { passive: true });
  document.addEventListener("pointerout", onPointerOut, { passive: true });
}
