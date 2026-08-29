/**
 * Global custom tooltip manager that styles all tooltips across the application
 * with the retro-tactical panel appearance.
 */

export interface TooltipApi {
  destroy: () => void;
  hide: () => void;
}

const HOVER_DELAY_MS = 1000;

export function initGlobalTooltips(delayMs: number = HOVER_DELAY_MS): TooltipApi {
  const tooltipEl = document.createElement("div");
  tooltipEl.id = "app-global-tooltip";
  tooltipEl.className = "app-global-tooltip";
  tooltipEl.setAttribute("role", "tooltip");
  tooltipEl.setAttribute("aria-hidden", "true");
  document.body.appendChild(tooltipEl);

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
    tooltipEl.textContent = "";
  }

  function show(anchor: HTMLElement, text: string): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      hide();
      return;
    }

    activeAnchor = anchor;
    tooltipEl.textContent = trimmed;
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
      tooltipEl.textContent = "";
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
