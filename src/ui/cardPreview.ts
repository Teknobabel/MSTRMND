/**
 * Floating full-card preview: the card a collapsed chip stands for, shown beside it on hover.
 *
 * A staged pick only shows a thumbnail and a name in the plan column, which is what keeps the
 * column short enough that everything under it stays on screen. The card itself is parked
 * off-slot and floated next to the chip from here.
 *
 * The layer lives on `document.body`, not inside the slot: every panel between a slot and the
 * stage clips its overflow, and a card six times the height of its chip would be cut off. The
 * cost is that it sits outside the scaled stage and has to re-apply `--ui-scale` itself.
 *
 * One layer for the whole page. Both planners use it — the run's, and the title screen's setup
 * planner — so a preview opened from one can never be left hanging by the other.
 */

/** The stage's current scale; see `src/ui/stageScale.ts`. */
function readUiScale(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--ui-scale");
  const scale = Number.parseFloat(raw);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

let layerEl: HTMLElement | null = null;

function layer(): HTMLElement {
  if (layerEl === null) {
    const el = document.createElement("div");
    el.className = "assign-pick-preview";
    el.hidden = true;
    document.body.appendChild(el);
    layerEl = el;
    /* The preview is anchored to a rect measured once, so anything that can move the chip out
     * from under it drops it rather than leaving it floating in the wrong place. */
    document.addEventListener("pointerdown", hideCardPreview, { passive: true });
    window.addEventListener("scroll", hideCardPreview, { capture: true, passive: true });
  }
  return layerEl;
}

export function hideCardPreview(): void {
  if (layerEl === null) {
    return;
  }
  layerEl.hidden = true;
  layerEl.replaceChildren();
}

export function showCardPreview(anchor: HTMLElement, card: HTMLElement): void {
  const el = layer();
  el.replaceChildren(card);
  el.hidden = false;
  el.style.transform = `scale(${readUiScale()})`;
  /* Measured after the transform, so these are on-screen pixels either way. */
  const rect = anchor.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  const margin = 8;
  let left = rect.right + margin;
  if (left + box.width > window.innerWidth - margin) {
    /* No room to the right of the plan column: flip to the other side of the chip. */
    left = Math.max(margin, rect.left - margin - box.width);
  }
  const top = Math.max(margin, Math.min(rect.top, window.innerHeight - box.height - margin));
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

/** Makes `chip` float `card` beside itself on hover or keyboard focus. */
export function attachCardPreview(chip: HTMLElement, card: HTMLElement): void {
  chip.addEventListener("mouseenter", () => {
    showCardPreview(chip, card);
  });
  chip.addEventListener("mouseleave", hideCardPreview);
  chip.addEventListener("focus", () => {
    showCardPreview(chip, card);
  });
  chip.addEventListener("blur", hideCardPreview);
  chip.addEventListener("dragstart", hideCardPreview);
}
