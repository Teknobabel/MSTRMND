/**
 * Global custom tooltip manager that styles all tooltips across the application
 * with the retro-tactical panel appearance.
 *
 * Every tooltip in the app is the **name** of the thing under the pointer, then one short line
 * saying what it is. The name is what a player hovering a bare icon is actually asking for, and
 * the description is the answer they would have had to look up — so a tooltip that opens with a
 * sentence and never names its subject was answering the second question without ever having
 * heard the first.
 *
 * A tooltip may add a **third line**, and only for one job: a fact about the player's own
 * position with respect to the thing described — "You have 3 minions with this skill". It is a
 * separate line rather than a clause on the description because it is a different kind of
 * statement. The description says what a thing *is* and is the same for every player; the note
 * says where *you* stand and changes as the run does. Anything that is neither belongs in the
 * description or nowhere.
 *
 * The lines travel in one attribute (`title`, or `data-tooltip` once this has claimed it),
 * newline-separated: first line names, last line is the note when there are three, everything
 * between describes. {@link tooltipText} and {@link setTooltip} build that string, and call
 * sites should use them rather than writing the newlines out by hand — they are the one place
 * the format is spelled. Text arriving without a second line still shows, as a name with
 * nothing under it.
 *
 * The one exception is deliberate and lives at the call sites, not here: anything that floats a
 * **card** on hover shows the card instead (see `ui/locationBrief.ts`, `ui/missionBrief.ts`),
 * because the card already carries the name, the art and more description than a bubble can.
 */

export interface TooltipApi {
  destroy: () => void;
  hide: () => void;
}

/** Collapses a line's own newlines away, so only the separators this module writes survive. */
function oneLine(text: string | undefined): string {
  return text?.replace(/\s+/g, " ").trim() ?? "";
}

/**
 * The house format, as a string: name, description, and the optional note (see the module
 * comment for what earns the third line).
 *
 * A description spanning several sentences is folded onto the one line rather than rejected —
 * the shape of the tooltip is fixed, and a long line simply wraps inside it. A note given
 * without a description takes the second line, because a tooltip cannot have a hole in it.
 */
export function tooltipText(name: string, description?: string, note?: string): string {
  return [name.trim(), oneLine(description), oneLine(note)].filter((s) => s !== "").join("\n");
}

/** {@link tooltipText}, applied straight to an element. */
export function setTooltip(
  el: HTMLElement,
  name: string,
  description?: string,
  note?: string,
): void {
  el.title = tooltipText(name, description, note);
}

const HOVER_DELAY_MS = 1000;

export function initGlobalTooltips(delayMs: number = HOVER_DELAY_MS): TooltipApi {
  const tooltipEl = document.createElement("div");
  tooltipEl.id = "app-global-tooltip";
  tooltipEl.className = "app-global-tooltip";
  tooltipEl.setAttribute("role", "tooltip");
  tooltipEl.setAttribute("aria-hidden", "true");
  /* Built once and refilled, rather than rebuilt per hover: the bubble is measured immediately
   * after it is filled (see `position`), and swapping children is one less thing between the
   * text landing and that measurement being taken. */
  const nameEl = document.createElement("span");
  nameEl.className = "app-global-tooltip__name";
  const descEl = document.createElement("span");
  descEl.className = "app-global-tooltip__desc";
  const noteEl = document.createElement("span");
  noteEl.className = "app-global-tooltip__note";
  tooltipEl.appendChild(nameEl);
  tooltipEl.appendChild(descEl);
  tooltipEl.appendChild(noteEl);
  document.body.appendChild(tooltipEl);

  /**
   * Splits the house format onto its lines: the first names, the last is the note when there are
   * three of them, and whatever sits between describes. `tooltipText` has already folded each
   * line's own newlines away, so a text arriving with three lines really does carry three
   * statements rather than one that happened to wrap.
   */
  function fill(text: string): void {
    const lines = text.split("\n");
    nameEl.textContent = (lines[0] ?? "").trim();
    const desc = lines.length >= 3 ? lines.slice(1, -1).join(" ").trim() : (lines[1] ?? "").trim();
    const note = lines.length >= 3 ? (lines[lines.length - 1] ?? "").trim() : "";
    descEl.textContent = desc;
    descEl.hidden = desc === "";
    noteEl.textContent = note;
    noteEl.hidden = note === "";
  }

  function clearContent(): void {
    nameEl.textContent = "";
    descEl.textContent = "";
    descEl.hidden = true;
    noteEl.textContent = "";
    noteEl.hidden = true;
  }

  let activeAnchor: HTMLElement | null = null;
  let pendingAnchor: HTMLElement | null = null;
  let hoverTimer: number | null = null;

  function clearHoverTimer(): void {
    if (hoverTimer !== null) {
      window.clearTimeout(hoverTimer);
      hoverTimer = null;
    }
  }

  function hide(): void {
    clearHoverTimer();
    pendingAnchor = null;
    if (!activeAnchor) return;
    activeAnchor = null;
    tooltipEl.classList.remove("is-visible");
    tooltipEl.setAttribute("aria-hidden", "true");
    clearContent();
  }

  function show(anchor: HTMLElement, text: string): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      hide();
      return;
    }

    activeAnchor = anchor;
    fill(trimmed);
    tooltipEl.classList.add("is-visible");
    tooltipEl.setAttribute("aria-hidden", "false");

    position(anchor);
  }

  function scheduleShow(anchor: HTMLElement, text: string): void {
    clearHoverTimer();
    pendingAnchor = anchor;
    if (activeAnchor && activeAnchor !== anchor) {
      activeAnchor = null;
      tooltipEl.classList.remove("is-visible");
      tooltipEl.setAttribute("aria-hidden", "true");
      clearContent();
    }

    hoverTimer = window.setTimeout(() => {
      hoverTimer = null;
      if (pendingAnchor === anchor) {
        show(anchor, text);
      }
    }, delayMs);
  }

  function position(anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    const tooltipRect = tooltipEl.getBoundingClientRect();
    const margin = 6;
    const padding = 8;

    let left = rect.left;
    let top = rect.bottom + margin;

    // Clamp horizontally within viewport
    if (left + tooltipRect.width > window.innerWidth - padding) {
      left = window.innerWidth - tooltipRect.width - padding;
    }
    if (left < padding) {
      left = padding;
    }

    // Flip vertically if overflowing bottom
    if (top + tooltipRect.height > window.innerHeight - padding) {
      const flippedTop = rect.top - tooltipRect.height - margin;
      if (flippedTop >= padding) {
        top = flippedTop;
      } else {
        top = Math.max(
          padding,
          Math.min(top, window.innerHeight - tooltipRect.height - padding),
        );
      }
    }

    tooltipEl.style.left = `${Math.round(left)}px`;
    tooltipEl.style.top = `${Math.round(top)}px`;
  }

  function findTooltipTarget(
    start: HTMLElement | null,
  ): { anchor: HTMLElement; text: string } | null {
    let curr: HTMLElement | null = start;
    while (curr && curr !== document.body && curr !== document.documentElement) {
      const titleAttr = curr.getAttribute("title");
      if (titleAttr !== null && titleAttr.trim().length > 0) {
        const text = titleAttr;
        curr.setAttribute("data-tooltip", text);
        curr.removeAttribute("title");
        return { anchor: curr, text };
      }

      const dataTip = curr.getAttribute("data-tooltip");
      if (dataTip !== null && dataTip.trim().length > 0) {
        return { anchor: curr, text: dataTip };
      }

      curr = curr.parentElement;
    }
    return null;
  }

  function handleOver(e: MouseEvent | FocusEvent): void {
    const target = e.target as HTMLElement | null;
    const found = findTooltipTarget(target);
    if (!found) {
      if (
        (activeAnchor || pendingAnchor) &&
        e.type === "mouseout" &&
        (!target || (!activeAnchor?.contains(target) && !pendingAnchor?.contains(target)))
      ) {
        hide();
      }
      return;
    }

    if (found.anchor !== activeAnchor && found.anchor !== pendingAnchor) {
      scheduleShow(found.anchor, found.text);
    }
  }

  function handleOut(e: MouseEvent | FocusEvent): void {
    if (!activeAnchor && !pendingAnchor) return;
    const related = (e as MouseEvent).relatedTarget as Node | null;
    if (related && ((activeAnchor && activeAnchor.contains(related)) || (pendingAnchor && pendingAnchor.contains(related)))) {
      return;
    }
    hide();
  }

  function handleWindowBlurOrScroll(): void {
    hide();
  }

  document.addEventListener("mouseover", handleOver, { passive: true });
  document.addEventListener("mouseout", handleOut, { passive: true });
  document.addEventListener("focusin", handleOver, { passive: true });
  document.addEventListener("focusout", handleOut, { passive: true });
  document.addEventListener("pointerdown", hide, { passive: true });
  document.addEventListener("dragstart", hide, { passive: true });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      hide();
    }
  });
  window.addEventListener("scroll", handleWindowBlurOrScroll, {
    capture: true,
    passive: true,
  });

  return {
    destroy(): void {
      document.removeEventListener("mouseover", handleOver);
      document.removeEventListener("mouseout", handleOut);
      document.removeEventListener("focusin", handleOver);
      document.removeEventListener("focusout", handleOut);
      document.removeEventListener("pointerdown", hide);
      document.removeEventListener("dragstart", hide);
      window.removeEventListener("scroll", handleWindowBlurOrScroll, {
        capture: true,
      });
      tooltipEl.remove();
    },
    hide,
  };
}
