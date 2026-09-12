/**
 * Dispatch sequence: what starting a mission looks like. Submitting a plan is the main verb of
 * the game and it used to be the quietest thing on the screen — the planner simply went blank.
 * This is the payoff the staging animations (`ui/dropHint.ts`) have been building toward, in
 * three beats:
 *
 *   COMPILE  the staged chips flatten into bright data rows and slam down into Submit,
 *            top of the planner first, on the same stagger the slots ignite with.
 *   UPLOAD   the rows fuse into a packet that flies to the target's map pin along an arc,
 *            drawing a dashed transmission trail that retracts into it on the run-in.
 *   EXECUTE  the packet unpacks at the site: a flash, a ring kicking out, reticle brackets
 *            snapping closed, and the mission's crew fading up in its map callout.
 *
 * The one rule the whole thing is built around: **it never blocks the game.** `assignMission`
 * has already been applied by the time the first row moves, and the planner is restageable the
 * moment the rows have left it — roughly a third of the way in. Launch three operations in a
 * turn and their packets fly at once, which is the point: concurrent uploads read as throughput
 * rather than as a queue. Nothing here reports back into game state; it is all cosmetic, and a
 * sequence interrupted by a re-render, a panel collapse or a cancelled mission simply stops.
 *
 * The mission's callout is the one place the animation touches real UI. Because state commits on
 * click, the crew would otherwise appear at the destination before the packet carrying them got
 * there — so a mission still in flight renders its callout with `map-callout--inbound` (held at
 * zero opacity by CSS, re-applied on every map render so a redraw mid-flight cannot reveal it
 * early) and `onArrive` is what lets it up.
 *
 * Everything is drawn into one fixed overlay on `document.body`, the same place the drag token
 * lives, so no panel's `overflow` can clip a packet crossing it. Positions come from live
 * `getBoundingClientRect()` reads, which already include the stage transform; only the sizes the
 * overlay draws itself have to be scaled by `--ui-scale` by hand.
 */

/* Beat timings, in milliseconds at 1x. Tuned by eye in the standalone prototype rather than
 * reasoned about — the compile beat is deliberately the long one, because it is the beat that
 * carries the weight, and the flight is slow enough to read as a transmission crossing the world
 * rather than a card being thrown at it. */
const COLLAPSE_MS = 380;
const COLLAPSE_STAGGER_MS = 88;
/** Beat between the last row landing and the packet leaving. Zero: the launch is the same event. */
const FUSE_MS = 0;
const FLIGHT_MS = 600;
const LAND_MS = 70;
/** Gap between crew portraits fading up at the site, so the team arrives one by one. */
const CREW_STAGGER_MS = 65;

/* Flight shape. Overshoot and stretch are near zero on purpose: the packet is a signal being
 * transmitted, not a physical object with momentum, so it holds its shape and stops dead. */
const ARC_PX = 53;
const OVERSHOOT_PX = 0;
const STRETCH = 0.05;
/** Fraction of the path the trail spans before it starts retracting into the packet. */
const TRAIL = 1;

/** How long the packet's glyphs hold before rerolling. */
const GLYPH_ROLL_MS = 45;
const GLYPH_COUNT = 7;
const GLYPHS = "0123456789ABCDEF/\\|<>[]{}=+*#%$@";

/** Marks a callout whose mission is still in the air; see the note above. */
export const INBOUND_CALLOUT_CLASS = "map-callout--inbound";

/** Where a staged chip was standing, in viewport pixels. See `DispatchSequenceOptions.rows`. */
export interface DispatchRow {
  /** Centre of the chip. */
  x: number;
  y: number;
  width: number;
}

export interface DispatchSequenceOptions {
  /**
   * Where the staged chips were, measured by the caller *before* the plan was applied. Rects,
   * not elements: applying the plan clears the planner on the same tick, and by the time this
   * runs those chips are detached and would measure zero. The sequence only needs where they
   * were — it draws its own bars rather than animating the live cards.
   */
  rows: readonly DispatchRow[];
  /** The Submit button: where the rows compile to, and where the packet launches from. */
  origin: HTMLElement;
  /**
   * The target's map pin. A target-less operation has no pin to fly to and passes the Execute
   * Plan button instead, which is where it will actually resolve.
   */
  destination: HTMLElement;
  /** Run as the packet lands, to let the crew up at the site. Never run if the sequence aborts. */
  onArrive?: () => void;
}

interface Point {
  x: number;
  y: number;
}

let layer: HTMLElement | null = null;
let svgLayer: SVGSVGElement | null = null;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The stage's current scale; see `src/ui/stageScale.ts`. */
function readUiScale(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--ui-scale");
  const scale = Number.parseFloat(raw);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** Viewport-space centre of an element, which is the space the whole overlay works in. */
function centerOf(el: Element): Point {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function randomGlyphs(n: number): string {
  let out = "";
  for (let i = 0; i < n; i += 1) {
    out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
  }
  return out;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function quadraticAt(a: Point, control: Point, b: Point, t: number): Point {
  const m = 1 - t;
  return {
    x: m * m * a.x + 2 * m * t * control.x + t * t * b.x,
    y: m * m * a.y + 2 * m * t * control.y + t * t * b.y,
  };
}

/**
 * The overlay every beat draws into: one fixed layer over the whole window, holding an SVG for
 * the trail and the arrival marks and plain elements for the rows and the packet. Built once and
 * left in place — it is inert when nothing is flying.
 */
function ensureLayer(): { host: HTMLElement; svg: SVGSVGElement } {
  if (layer !== null && svgLayer !== null && layer.isConnected) {
    return { host: layer, svg: svgLayer };
  }
  const host = document.createElement("div");
  host.className = "dispatch-fx";
  host.setAttribute("aria-hidden", "true");

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "dispatch-fx__svg");
  host.appendChild(svg);

  document.body.appendChild(host);
  layer = host;
  svgLayer = svg;
  return { host, svg };
}

function svgEl<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS("http://www.w3.org/2000/svg", name);
}

/** Removes a node once its animation has played out, so the overlay never accumulates. */
function removeOnFinish(node: Element, animation: Animation): void {
  animation.addEventListener("finish", () => {
    node.remove();
  });
  animation.addEventListener("cancel", () => {
    node.remove();
  });
}

/**
 * Beat 1. One staged chip, flattened to a bar of light at the place the chip was standing and
 * thrown down into the button. The chips themselves are already gone by the time this runs; the
 * bars are what the player reads as the plan compiling.
 */
function collapseRow(
  host: HTMLElement,
  from: Point,
  to: Point,
  width: number,
  delayMs: number,
  onLand: () => void,
): void {
  const bar = document.createElement("div");
  bar.className = "dispatch-fx__row";
  bar.style.width = `${width}px`;
  host.appendChild(bar);

  const start = `translate(${from.x - width / 2}px, ${from.y}px)`;
  const end = `translate(${to.x - width / 2}px, ${to.y}px)`;
  const animation = bar.animate(
    [
      { transform: `${start} scaleX(1)`, opacity: 0 },
      { transform: `${start} scaleX(1)`, opacity: 1, offset: 0.18 },
      { transform: `${end} scaleX(0.42)`, opacity: 0.9 },
    ],
    {
      duration: COLLAPSE_MS,
      delay: delayMs,
      easing: "cubic-bezier(.55,0,.3,1)",
      fill: "backwards",
    },
  );
  animation.addEventListener("finish", () => {
    bar.remove();
    onLand();
  });
  animation.addEventListener("cancel", () => {
    bar.remove();
  });
}

/**
 * Beat 3. The packet unpacks at the site: a hot flash decaying outward, a ring kicking out the
 * way a pin pings, and four brackets snapping closed on it like the map's targeting reticle.
 * `onArrive` goes off with the flash, which is what lets the crew up in the callout.
 */
function playArrival(svg: SVGSVGElement, at: Point, scale: number, onArrive?: () => void): void {
  /* Every mark here is authored around the SVG origin and carried out to the site by its own
   * transform — the CSS pins `transform-origin` to 0 0 for them. Placing a circle with `cx`/`cy`
   * and then scaling it would scale its offset too, and the arrival would slide off the pin. */
  const place = `translate(${at.x}px, ${at.y}px)`;

  const flash = svgEl("circle");
  flash.setAttribute("r", String(7 * scale));
  flash.setAttribute("class", "dispatch-fx__flash");
  svg.appendChild(flash);
  removeOnFinish(
    flash,
    flash.animate(
      [
        { opacity: 1, transform: `${place} scale(1)` },
        { opacity: 0, transform: `${place} scale(2.6)` },
      ],
      { duration: Math.max(140, LAND_MS * 2), easing: "ease-out", fill: "forwards" },
    ),
  );

  const ring = svgEl("circle");
  ring.setAttribute("r", String(9 * scale));
  ring.setAttribute("class", "dispatch-fx__ring");
  svg.appendChild(ring);
  removeOnFinish(
    ring,
    ring.animate(
      [
        { opacity: 0.95, transform: `${place} scale(.5)` },
        { opacity: 0, transform: `${place} scale(3.4)` },
      ],
      {
        duration: Math.max(220, LAND_MS * 3),
        easing: "cubic-bezier(.2,.7,.3,1)",
        fill: "forwards",
      },
    ),
  );

  /* Brackets are drawn around the origin and carried out to the site by the transform, so all
   * four share one path and differ only by rotation. */
  const reach = 11 * scale;
  const arm = 7 * scale;
  for (const rotation of [0, 90, 180, 270]) {
    const bracket = svgEl("path");
    bracket.setAttribute(
      "d",
      `M ${-reach} ${-reach + arm} L ${-reach} ${-reach} L ${-reach + arm} ${-reach}`,
    );
    bracket.setAttribute("class", "dispatch-fx__bracket");
    svg.appendChild(bracket);
    const placeRotated = `${place} rotate(${rotation}deg)`;
    removeOnFinish(
      bracket,
      bracket.animate(
        [
          { opacity: 0, transform: `${placeRotated} scale(2.1)` },
          { opacity: 1, transform: `${placeRotated} scale(1)`, offset: 0.55 },
          { opacity: 0, transform: `${placeRotated} scale(1)` },
        ],
        {
          duration: Math.max(240, LAND_MS * 3.4),
          easing: "cubic-bezier(.2,.8,.3,1)",
          fill: "forwards",
        },
      ),
    );
  }

  onArrive?.();
}

/**
 * Beat 2. The compiled payload crossing the screen. Driven frame by frame rather than by
 * keyframes because the trail has to be rebuilt from where the packet actually is, and the
 * packet's own stretch is read from its velocity along the curve.
 */
function flyPacket(
  host: HTMLElement,
  svg: SVGSVGElement,
  from: Point,
  to: Point,
  scale: number,
  onArrive?: () => void,
): void {
  const packet = document.createElement("div");
  packet.className = "dispatch-fx__packet";
  packet.textContent = randomGlyphs(GLYPH_COUNT);
  host.appendChild(packet);

  const trail = svgEl("polyline");
  trail.setAttribute("class", "dispatch-fx__trail");
  svg.appendChild(trail);

  /* The arc bows away from the straight run, perpendicular to it and biased upward, so a packet
   * crossing the map clears the panels between the planner and the pin instead of ploughing
   * through them. */
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const span = Math.max(1, Math.hypot(dx, dy));
  const arc = ARC_PX * scale;
  const control: Point = {
    x: (from.x + to.x) / 2 + (-dy / span) * arc * 1.2,
    y: (from.y + to.y) / 2 + (dx / span) * arc * 1.2 - arc,
  };

  const startedAt = performance.now();
  const points: string[] = [];
  const maxPoints = Math.round(4 + TRAIL * 26);
  let lastRoll = startedAt;

  function frame(now: number): void {
    const t = Math.min(1, (now - startedAt) / FLIGHT_MS);
    const eased = easeInOutCubic(t);
    const at = quadraticAt(from, control, to, eased);

    if (OVERSHOOT_PX > 0 && t > 0.62) {
      /* Carried past the pin along the final tangent and drawn back, so the packet arrives with
       * a little weight behind it rather than simply stopping. */
      const swell = Math.sin(Math.PI * Math.min(1, (t - 0.62) / 0.38));
      const tx = to.x - control.x;
      const ty = to.y - control.y;
      const tl = Math.max(1, Math.hypot(tx, ty));
      at.x += (tx / tl) * OVERSHOOT_PX * scale * 0.45 * swell;
      at.y += (ty / tl) * OVERSHOOT_PX * scale * 0.45 * swell;
    }

    const ahead = quadraticAt(from, control, to, Math.min(1, eased + 0.02));
    const vx = ahead.x - at.x;
    const vy = ahead.y - at.y;
    const angle = (Math.atan2(vy, vx) * 180) / Math.PI;
    const speed = Math.min(1, Math.hypot(vx, vy) / 14);
    /* A short squash as it leaves the button, so the launch has a push behind it. */
    const launch = t < 0.14 ? 1 - (1 - t / 0.14) * 0.45 : 1;
    const stretchX = (1 + speed * STRETCH * 0.9) * launch;
    const stretchY = (1 / Math.sqrt(stretchX)) * launch;

    packet.style.transform =
      `translate(${at.x}px, ${at.y}px) rotate(${angle}deg) ` +
      `scale(${stretchX * scale}, ${stretchY * scale})`;

    if (now - lastRoll >= GLYPH_ROLL_MS) {
      packet.textContent = randomGlyphs(GLYPH_COUNT);
      lastRoll = now;
    }

    /* The trail follows the packet out and then retracts into it over the last of the run, so
     * the line reads as a transmission closing rather than a streak left hanging on the map. */
    points.push(`${at.x.toFixed(1)},${at.y.toFixed(1)}`);
    const keep = t > 0.7 ? Math.round(maxPoints * (1 - (t - 0.7) / 0.3)) : maxPoints;
    while (points.length > Math.max(2, keep)) {
      points.shift();
    }
    trail.setAttribute("points", points.join(" "));
    trail.setAttribute("stroke-dashoffset", String(-now / 22));

    if (t < 1) {
      requestAnimationFrame(frame);
      return;
    }
    packet.remove();
    trail.remove();
    playArrival(svg, to, scale, onArrive);
  }

  requestAnimationFrame(frame);
}

/**
 * Runs the whole sequence. Call it straight after the plan has been applied: the rows are read
 * from rects captured by the caller beforehand, so the planner may already have cleared.
 */
export function playDispatchSequence(opts: DispatchSequenceOptions): void {
  const { rows, origin, destination, onArrive } = opts;

  if (prefersReducedMotion()) {
    /* The preference asked for no motion, and an operation launching is not information the
     * player can afford to miss — so the crew still appear, they just appear at once. */
    onArrive?.();
    return;
  }

  const { host, svg } = ensureLayer();
  const scale = readUiScale();
  const originPoint = centerOf(origin);
  const destinationPoint = centerOf(destination);

  /* A zero-width row is a chip that was already gone when it was measured — a collapsed panel,
   * most likely. Dropped rather than drawn as a bar with no length. */
  const measured = rows.filter((row) => row.width > 0);

  let landed = 0;
  const total = measured.length;

  const launch = (): void => {
    flyPacket(host, svg, originPoint, destinationPoint, scale, onArrive);
  };

  if (total === 0) {
    /* Nothing was staged in a way we could see — a collapsed panel, most likely. Skip the
     * compile beat rather than hold the upload up for rows that will never land. */
    launch();
    return;
  }

  measured.forEach((row, i) => {
    collapseRow(host, { x: row.x, y: row.y }, originPoint, row.width, i * COLLAPSE_STAGGER_MS, () => {
      /* The button takes a hit from every row that lands, so the stack builds audibly-ish. */
      origin.classList.add("btn-submit-mission--struck");
      window.setTimeout(() => {
        origin.classList.remove("btn-submit-mission--struck");
      }, 90);

      landed += 1;
      if (landed === total) {
        if (FUSE_MS > 0) {
          window.setTimeout(launch, FUSE_MS);
        } else {
          launch();
        }
      }
    });
  });
}

/**
 * Fades a landed mission's crew up in its map callout, one portrait at a time. Called by the
 * sequence's `onArrive`; safe to call for a callout that has since been re-rendered away.
 */
export function revealInboundCallout(callout: HTMLElement): void {
  callout.classList.remove(INBOUND_CALLOUT_CLASS);
  if (prefersReducedMotion()) {
    return;
  }
  const portraits = Array.from(callout.children) as HTMLElement[];
  portraits.forEach((portrait, i) => {
    portrait.animate(
      [
        { opacity: 0, transform: "translateY(7px) scale(.4)" },
        { opacity: 1, transform: "translateY(-2px) scale(1.16)", offset: 0.6 },
        { opacity: 1, transform: "translateY(0) scale(1)" },
      ],
      {
        duration: Math.max(150, LAND_MS * 2.4),
        delay: i * CREW_STAGGER_MS,
        easing: "cubic-bezier(.2,1.5,.4,1)",
        fill: "backwards",
      },
    );
  });
}
