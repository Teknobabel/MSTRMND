/**
 * Drag tether: while a card is in hand, a dashed guide line bows out from the pointer to the
 * nearest planner slot that would take it, its dashes flowing toward the slot and a ping marking
 * where it lands. The drop hint's shine answers *which* slots; the tether answers *which way*, and
 * from wherever the card happens to be — the far end of the map, the bottom of a drawer.
 *
 * It follows the drop hint rather than deciding anything itself: the slots it can point at are
 * exactly the ones `src/ui/dropHint.ts` has lit (`.plan-slot--drop-hint`), and it lets go once the
 * pointer is inside one of them, where the lock-on takes over. The one line goes to the nearest
 * slot only — a fan of lines to every lit slot would be a web, not a direction.
 *
 * The layer lives on `document.body`, outside the scaled stage, and is drawn in viewport space:
 * the pointer and every slot's client rect are already in viewport pixels there, whatever
 * `--ui-scale` or the portrait rotation has done to the stage. Its viewBox is the viewport
 * divided by `--ui-scale`, so stroke widths and dash lengths are still stage pixels and shrink
 * with the rest of the console. Being outside `.screen-game` also keeps it clear of the drag
 * focus blur.
 *
 * Wired in `main.ts` (`initDragTether`); the look is under "Drag tether" in `styles.css`.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** The slots the tether may point at: the ones the drop hint has lit. */
const LIT_SELECTOR = ".plan-slot--drop-hint";

const LIVE_CLASS = "drag-tether--live";

/** Shorter than this (stage pixels), the line would be a stub hidden under the drag image. */
const MIN_LENGTH = 32;

/** How far the line bows out of true, as a share of its length, and at most (stage pixels). */
const BOW = 0.18;
const MAX_BOW = 90;

interface TetherLayer {
  svg: SVGSVGElement;
  gradient: SVGLinearGradientElement;
  line: SVGPathElement;
  cap: SVGCircleElement;
  ping: SVGCircleElement;
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, value);
  }
  return el;
}

function buildLayer(): TetherLayer {
  const svg = svgEl("svg", { class: "drag-tether", "aria-hidden": "true" });
  /* Faint at the pointer, full strength at the slot: the pull grows toward where it is going. */
  const gradient = svgEl("linearGradient", {
    id: "drag-tether-fade",
    gradientUnits: "userSpaceOnUse",
  });
  gradient.append(
    svgEl("stop", { class: "drag-tether__stop drag-tether__stop--tail", offset: "0" }),
    svgEl("stop", { class: "drag-tether__stop drag-tether__stop--mid", offset: "0.4" }),
    svgEl("stop", { class: "drag-tether__stop", offset: "1" }),
  );
  const defs = svgEl("defs", {});
  defs.appendChild(gradient);
  const line = svgEl("path", { class: "drag-tether__line" });
  const ping = svgEl("circle", { class: "drag-tether__ping", r: "4" });
  const cap = svgEl("circle", { class: "drag-tether__cap", r: "3.5" });
  svg.append(defs, line, ping, cap);
  document.body.appendChild(svg);
  return { svg, gradient, line, cap, ping };
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

export function initDragTether(): void {
  let layer: TetherLayer | null = null;
  let scale = 1;
  let pointer: { x: number; y: number } | null = null;
  let frame = 0;

  function hide(): void {
    layer?.svg.classList.remove(LIVE_CLASS);
  }

  function draw(): void {
    frame = 0;
    if (layer === null || pointer === null) {
      return;
    }
    const { x: px, y: py } = pointer;

    /* Nearest lit slot, measured to the closest point of its box — which is also where the line
     * ends, so it meets the slot's edge rather than running in under the card to its middle. */
    let end: { x: number; y: number; distance: number } | null = null;
    for (const slot of Array.from(document.querySelectorAll(LIT_SELECTOR))) {
      const r = slot.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) {
        continue;
      }
      const x = clamp(px, r.left, r.right);
      const y = clamp(py, r.top, r.bottom);
      const distance = Math.hypot(px - x, py - y);
      if (distance === 0) {
        /* Inside a lit slot: it has locked on, and a line to where the card already is says
         * nothing. */
        hide();
        return;
      }
      if (end === null || distance < end.distance) {
        end = { x, y, distance };
      }
    }
    const length = end === null ? 0 : end.distance / scale;
    if (end === null || length < MIN_LENGTH) {
      hide();
      return;
    }

    const x1 = px / scale;
    const y1 = py / scale;
    const x2 = end.x / scale;
    const y2 = end.y / scale;
    /* Always bowed to the same side of its heading — the side that puts the arc *above* a line
     * running left toward the planner, arching over the cards rather than dipping through them. */
    const bow = Math.min(length * BOW, MAX_BOW);
    const cx = (x1 + x2) / 2 - ((y2 - y1) / length) * bow;
    const cy = (y1 + y2) / 2 + ((x2 - x1) / length) * bow;

    layer.line.setAttribute("d", `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`);
    layer.gradient.setAttribute("x1", String(x1));
    layer.gradient.setAttribute("y1", String(y1));
    layer.gradient.setAttribute("x2", String(x2));
    layer.gradient.setAttribute("y2", String(y2));
    for (const dot of [layer.cap, layer.ping]) {
      dot.setAttribute("cx", String(x2));
      dot.setAttribute("cy", String(y2));
    }
    layer.svg.classList.add(LIVE_CLASS);
  }

  function stop(): void {
    pointer = null;
    window.cancelAnimationFrame(frame);
    frame = 0;
    hide();
  }

  /* Capture throughout, as the drop hint and drag focus do: several cards stop `dragstart` and
   * `dragend` from bubbling, and a slot or panel is free to stop a `dragover`. */
  document.addEventListener(
    "dragstart",
    () => {
      layer ??= buildLayer();
      stop();
      /* Read once per drag; the stage does not rescale mid-drag. */
      scale = readUiScale();
      const box = layer.svg.getBoundingClientRect();
      layer.svg.setAttribute("viewBox", `0 0 ${box.width / scale} ${box.height / scale}`);
    },
    { capture: true },
  );

  /* `dragover` rather than `drag`: Firefox reports a `drag` event's coordinates as zero, and
   * `dragover` keeps firing (every 50ms or so) even while the pointer holds still. */
  document.addEventListener(
    "dragover",
    (e) => {
      pointer = { x: e.clientX, y: e.clientY };
      if (frame === 0) {
        frame = window.requestAnimationFrame(draw);
      }
    },
    { capture: true },
  );

  document.addEventListener("dragend", stop, { capture: true });
  document.addEventListener("drop", stop, { capture: true });
}
