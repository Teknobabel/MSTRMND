/**
 * Drag token: what the player carries while dragging a card. It stands in for the browser's own
 * drag image — a translucent snapshot of the whole card, which the page cannot restyle or animate
 * once the drag has begun, and which is big enough (a mission card is 514x433 stage pixels, a
 * roster minion's portrait card nearly 600 tall) that by the time the pointer reaches the planner
 * it is hanging over the very slots it is being aimed at.
 *
 * The token is the card folded into the chip it will become once staged — thumbnail and name —
 * lifted off with a tilt and a shadow, swaying a little with the pointer's sideways speed. It
 * reacts to where it is: held over a slot that would take it, it is drawn toward the slot and the
 * "release to" label moves onto it; held over one that would not, it greys out under a no-entry
 * badge. Let go, and it flies into the slot it was staged in (the slot's landing plays as it
 * arrives), snaps back to where it was picked up if nothing took it, or drops away if it was a
 * staged card dragged off the planner.
 *
 * It moves on `dragover` coordinates rather than riding the compositor the way the browser's
 * image does. Outside the window it stops at the edge, where `dragover` stops.
 *
 * The drop hint (`src/ui/dropHint.ts`) drives every state change here; `main.ts` says what each
 * payload looks like (`setDragTokenFaces`). A payload with no face falls back to the browser's
 * own drag image and the slot keeps its own lock label, so nothing is ever carried invisibly.
 */

import { createCardArtImg } from "./cardArt";

/** What a payload looks like in hand: the chip it will become in its slot. */
export interface DragTokenFace {
  art: string;
  label: string;
}

type FaceResolver = (payload: string) => DragTokenFace | null;

/** A 1x1 transparent GIF, handed to `setDragImage` so the browser draws nothing of its own. */
const BLANK_GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const LOCKED_CLASS = "drag-token--locked";
const REFUSED_CLASS = "drag-token--refused";

/** Resting tilt while carried — held, not placed. */
const IDLE_TILT_DEG = -3;
const MAX_TILT_DEG = 14;
/** How much of the way from the pointer to the locked slot the token is drawn. */
const MAGNET_PULL = 0.45;
/**
 * Where a staged chip's thumbnail sits in its slot, from the slot's left edge (stage pixels): the
 * slot's padding plus half the 28px thumbnail. The magnet draws the token's thumbnail toward it.
 */
const SLOT_THUMB_X = 23;

const FLY_IN_MS = 190;
const RETURN_MS = 240;
const DISCARD_MS = 220;

interface LiveToken {
  el: HTMLElement;
  verb: HTMLElement;
  /** The thumbnail's centre inside the token, pre-scale: the point that rides the pointer. */
  anchorX: number;
  anchorY: number;
  scale: number;
  /** Where it was picked up, in viewport pixels. */
  origin: { x: number; y: number };
  pointer: { x: number; y: number };
  /** Where the anchor was last drawn, which is where every exit animation starts from. */
  drawn: { x: number; y: number };
  magnet: HTMLElement | null;
  pull: number;
  tilt: number;
  velocityX: number;
  lastX: number;
  frame: number;
}

let resolveFace: FaceResolver | null = null;
let blank: HTMLImageElement | null = null;
let live: LiveToken | null = null;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The stage's current scale; see `src/ui/stageScale.ts`. */
function readUiScale(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--ui-scale");
  const scale = Number.parseFloat(raw);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function transformAt(t: LiveToken, x: number, y: number, tilt: number, scale: number): string {
  return `translate(${x - t.anchorX}px, ${y - t.anchorY}px) rotate(${tilt}deg) scale(${scale})`;
}

/**
 * One frame: the anchor goes to the pointer — exactly, never eased, or the token would trail the
 * hand holding it — except for the magnet's pull toward a locked slot, which is eased so the token
 * glides over rather than jumping. The tilt eases toward a lean proportional to sideways speed.
 */
function frame(): void {
  const t = live;
  if (t === null) {
    return;
  }
  const still = prefersReducedMotion();
  const dx = t.pointer.x - t.lastX;
  t.lastX = t.pointer.x;
  t.velocityX = t.velocityX * 0.8 + dx * 0.2;
  const lean = t.magnet !== null ? 0 : IDLE_TILT_DEG + t.velocityX * 0.9;
  t.tilt += ((still ? 0 : clamp(lean, -MAX_TILT_DEG, MAX_TILT_DEG)) - t.tilt) * 0.25;

  t.pull += ((t.magnet !== null && !still ? MAGNET_PULL : 0) - t.pull) * 0.3;
  let { x, y } = t.pointer;
  if (t.magnet !== null && t.pull > 0.001) {
    const r = t.magnet.getBoundingClientRect();
    x += (r.left + SLOT_THUMB_X * t.scale - x) * t.pull;
    y += (r.top + r.height / 2 - y) * t.pull;
  }
  t.drawn = { x, y };
  t.el.style.transform = transformAt(t, x, y, t.tilt, t.scale);
  t.frame = window.requestAnimationFrame(frame);
}

function stopFrames(t: LiveToken): void {
  window.cancelAnimationFrame(t.frame);
}

/** Takes the token off the page at once, wherever it is in its life. */
function removeNow(): void {
  if (live === null) {
    return;
  }
  stopFrames(live);
  live.el.remove();
  live = null;
}

/**
 * Detaches the live token and plays it out to `to`, removing it once there. The token is no
 * longer live from the first frame of its exit, so a new drag can start over the top of it.
 */
function exit(
  to: { x: number; y: number; tilt: number; scale: number; opacity: number },
  duration: number,
  easing: string,
): Promise<void> {
  const t = live;
  if (t === null) {
    return Promise.resolve();
  }
  live = null;
  stopFrames(t);
  if (prefersReducedMotion()) {
    t.el.remove();
    return Promise.resolve();
  }
  const anim = t.el.animate(
    [
      { transform: transformAt(t, t.drawn.x, t.drawn.y, t.tilt, t.scale), opacity: 1 },
      { transform: transformAt(t, to.x, to.y, to.tilt, to.scale), opacity: to.opacity },
    ],
    { duration, easing, fill: "forwards" },
  );
  return anim.finished.then(
    () => t.el.remove(),
    () => t.el.remove(),
  );
}

/** Says what each payload looks like in hand. Without a face for it, a drag keeps the browser's. */
export function setDragTokenFaces(resolver: FaceResolver): void {
  resolveFace = resolver;
}

export function isDragTokenLive(): boolean {
  return live !== null;
}

/**
 * Starts the token for a drag that is starting now — call from inside `dragstart`, the only time
 * the browser's drag image can be swapped out. False when this payload has no face, in which case
 * the browser's image is left alone.
 */
export function startDragToken(e: DragEvent, payload: string): boolean {
  removeNow();
  const face = resolveFace?.(payload) ?? null;
  if (face === null || blank === null || e.dataTransfer === null) {
    return false;
  }
  e.dataTransfer.setDragImage(blank, 0, 0);

  const el = document.createElement("div");
  el.className = "drag-token";
  el.setAttribute("aria-hidden", "true");
  const body = document.createElement("div");
  body.className = "drag-token__body";
  const thumb = createCardArtImg(face.art, "card-art--chip");
  const name = document.createElement("span");
  name.className = "drag-token__name";
  name.textContent = face.label;
  const verb = document.createElement("span");
  verb.className = "drag-token__verb";
  body.append(thumb, name, verb);
  el.appendChild(body);
  document.body.appendChild(el);

  /* The thumbnail is sized by CSS, not by its image, so it measures true before it has loaded. */
  const anchorX = thumb.offsetLeft + thumb.offsetWidth / 2;
  const anchorY = thumb.offsetTop + thumb.offsetHeight / 2;
  el.style.transformOrigin = `${anchorX}px ${anchorY}px`;
  body.style.transformOrigin = `${anchorX}px ${anchorY}px`;

  const at = { x: e.clientX, y: e.clientY };
  live = {
    el,
    verb,
    anchorX,
    anchorY,
    scale: readUiScale(),
    origin: at,
    pointer: at,
    drawn: at,
    magnet: null,
    pull: 0,
    tilt: prefersReducedMotion() ? 0 : IDLE_TILT_DEG,
    velocityX: 0,
    lastX: at.x,
    frame: 0,
  };
  frame();
  return true;
}

/**
 * Held over a slot that would take it: the token is drawn toward `slot` and carries `label` (the
 * drop hint's typed "release to" line) in place of the slot. False when there is no token, and the
 * slot should show the label itself.
 */
export function lockDragToken(slot: HTMLElement, label: HTMLElement): boolean {
  if (live === null) {
    return false;
  }
  live.magnet = slot;
  live.verb.replaceChildren(label);
  live.el.classList.add(LOCKED_CLASS);
  live.el.classList.remove(REFUSED_CLASS);
  return true;
}

export function unlockDragToken(): void {
  if (live === null) {
    return;
  }
  live.magnet = null;
  live.verb.replaceChildren();
  live.el.classList.remove(LOCKED_CLASS);
}

/** Held over a slot that will not take it (or moved off one). */
export function refuseDragToken(refused: boolean): void {
  live?.el.classList.toggle(REFUSED_CLASS, refused);
}

/**
 * Let go over a slot that staged it: the token flies into `findSlot()` — found afresh, since the
 * drop has just re-rendered it — landing its thumbnail on the new chip's. The slot's contents are
 * held invisible until it arrives, so the chip does not appear first and then get flown into.
 * Resolves on arrival, which is the moment for the slot's landing.
 */
export function settleDragToken(findSlot: () => HTMLElement | null): Promise<void> {
  const t = live;
  if (t === null) {
    return Promise.resolve();
  }
  const slot = findSlot();
  if (slot === null) {
    return exit({ ...t.drawn, tilt: 0, scale: t.scale * 0.6, opacity: 0 }, DISCARD_MS, "ease-in");
  }
  slot.classList.add("plan-slot--incoming");
  const thumb = slot.querySelector(".card-art--chip");
  const r = (thumb ?? slot).getBoundingClientRect();
  const to =
    thumb !== null
      ? { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      : { x: r.left + SLOT_THUMB_X * t.scale, y: r.top + r.height / 2 };
  return exit(
    { ...to, tilt: 0, scale: t.scale, opacity: 0.85 },
    FLY_IN_MS,
    "cubic-bezier(0.3, 0.7, 0.4, 1)",
  ).then(() => {
    slot.classList.remove("plan-slot--incoming");
  });
}

/** Nothing took it: back to where it was picked up, shrinking away as it goes. */
export function returnDragToken(): void {
  const t = live;
  if (t === null) {
    return;
  }
  void exit(
    { ...t.origin, tilt: 0, scale: t.scale * 0.55, opacity: 0 },
    RETURN_MS,
    "cubic-bezier(0.4, 0, 0.6, 1)",
  );
}

/** A staged card dragged off the planner: it tips over and drops out of existence where it was let go. */
export function discardDragToken(): void {
  const t = live;
  if (t === null) {
    return;
  }
  void exit(
    { x: t.drawn.x, y: t.drawn.y + 36 * t.scale, tilt: 28, scale: t.scale * 0.5, opacity: 0 },
    DISCARD_MS,
    "cubic-bezier(0.5, 0, 0.9, 0.6)",
  );
}

export function initDragToken(): void {
  blank = new Image();
  blank.src = BLANK_GIF;
  /* Capture, like every other drag listener here: a slot or panel is free to stop `dragover`.
   * `dragover`, not `drag` — Firefox reports a `drag` event's coordinates as zero. */
  document.addEventListener(
    "dragover",
    (e) => {
      if (live !== null) {
        live.pointer = { x: e.clientX, y: e.clientY };
      }
    },
    { capture: true },
  );
}
