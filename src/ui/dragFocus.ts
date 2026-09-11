/**
 * Drag focus: while a card is in hand, the rest of the console pulls back behind a slight
 * blur so the two ends of the drag — what is being carried and the planner it is headed for —
 * are the only things still in focus.
 *
 * A `filter` blurs an element *and everything inside it*, so there is no rule that can blur a
 * panel while sparing one card in it. What can be done is blur around the card: walk the chain
 * from the game screen down to the card and blur the **siblings** at every step. The chain
 * itself — screen, shell, body, cabinet, the drawer the card is filed in, the list it sits in —
 * stays untouched, which is what leaves the card sharp. The planner is exempt wherever the drag
 * started; it is the drop target, and a drop target you cannot read is no target at all.
 *
 * Wired in `main.ts` (`initDragFocus`). Everything here is driven off the document's own drag
 * events, so a new draggable card anywhere in the UI is covered without being told about.
 */

/** Marks an element as blurred for the duration of a drag; styled in `styles.css`. */
const BLUR_CLASS = "ui-drag-blurred";

/**
 * Where an element's own filter is parked while it is blurred. `filter` is a single property,
 * so the blur has to be *added* to what the element already carried (a drawer's drop shadow,
 * an unavailable asset card's desaturation) rather than replacing it.
 */
const BASE_FILTER_PROP = "--ui-drag-blur-base";

/** The subtree the effect covers: the game screen, menus and overlays included. */
const ROOT_SELECTOR = ".screen-game";

/** Stays sharp wherever the drag started — the planner is where the card is going. */
const KEEP_SHARP_SELECTOR = ".game-panel--plan-column";

/**
 * The ambient backdrop canvas sits behind the map and every panel, so blurring it changes
 * nothing a player can see — and it repaints on the game loop, which would make it the one
 * element in here re-filtered every frame of the drag.
 */
const NEVER_BLUR_SELECTOR = ".game-canvas";

type StyledElement = HTMLElement | SVGElement;

function isStyledElement(node: Element): node is StyledElement {
  return node instanceof HTMLElement || node instanceof SVGElement;
}

export function initDragFocus(): void {
  let blurred: StyledElement[] = [];

  function clear(): void {
    for (const el of blurred) {
      el.classList.remove(BLUR_CLASS);
      el.style.removeProperty(BASE_FILTER_PROP);
    }
    blurred = [];
  }

  function blur(el: StyledElement): void {
    /* Read before the class lands, or this reads back the blur it is meant to compose with. */
    const own = window.getComputedStyle(el).filter;
    if (own !== "" && own !== "none") {
      el.style.setProperty(BASE_FILTER_PROP, own);
    }
    el.classList.add(BLUR_CLASS);
    blurred.push(el);
  }

  /** Blurs the siblings of every step from the game screen down to `source`. */
  function blurAround(source: Element): void {
    const root = source.closest(ROOT_SELECTOR);
    if (root === null) {
      return;
    }
    const chain: Element[] = [];
    for (let node: Element | null = source; node !== null && node !== root; node = node.parentElement) {
      chain.push(node);
    }
    chain.reverse();

    let level: Element = root;
    for (const next of chain) {
      for (const child of Array.from(level.children)) {
        if (child === next || !isStyledElement(child)) {
          continue;
        }
        if (
          child.hasAttribute("hidden") ||
          child.matches(KEEP_SHARP_SELECTOR) ||
          child.matches(NEVER_BLUR_SELECTOR)
        ) {
          continue;
        }
        blur(child);
      }
      level = next;
    }
  }

  /*
   * Capture, because several cards stop `dragstart` from bubbling to keep a drag off the panel
   * behind them — a listener on the document would never hear those.
   */
  document.addEventListener(
    "dragstart",
    (e: DragEvent) => {
      clear();
      const target = e.target;
      if (!(target instanceof Element)) {
        return;
      }
      /* The card is the draggable element itself; a drag begun on a nested image reports that
       * image as the target, so walk up to whatever the browser is actually carrying. */
      const card = target.closest('[draggable="true"]');
      if (card === null) {
        return;
      }
      blurAround(card);
      /* A card whose own handler refuses the drag (`preventDefault` on a stale draggable flag)
       * never gets a `dragend` to clean up after, so check once dispatch is over. */
      window.setTimeout(() => {
        if (e.defaultPrevented) {
          clear();
        }
      }, 0);
    },
    { capture: true },
  );

  document.addEventListener("dragend", clear, { capture: true });
  document.addEventListener("drop", clear, { capture: true });
}
