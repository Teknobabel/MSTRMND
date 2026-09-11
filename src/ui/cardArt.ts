import type {
  AgentTemplate,
  Asset,
  LairTemplate,
  LocationTemplate,
  MissionTemplate,
  MinionTemplate,
  OmegaPlanTemplate,
} from "../game/types";

/** Shipped placeholders under `public/assets/cards/`. */
export const DEFAULT_MISSION_CARD_ART = "/assets/cards/mission.png";
export const DEFAULT_MINION_CARD_ART = "/assets/cards/minion.png";
export const DEFAULT_LOCATION_CARD_ART = "/assets/cards/location.png";
export const DEFAULT_LAIR_CARD_ART = "/assets/cards/lair.png";
export const DEFAULT_ASSET_CARD_ART = "/assets/cards/asset.png";
export const DEFAULT_OMEGA_PLAN_CARD_ART = "/assets/cards/mission.png";
/**
 * Animated TV static standing in for a site the player has no intel on. An SVG rather than a
 * CSS effect so it travels through every path a card's art URL does — hero, chip, drag token,
 * and the deferred-art parking below — without any of them knowing it is special.
 */
export const UNKNOWN_LOCATION_CARD_ART = "/assets/cards/location-unknown.svg";
/**
 * The same static held on one frame. Chosen here rather than by a media query inside the SVG:
 * an SVG loaded as an image does not reliably see the page's `prefers-reduced-motion`.
 */
export const UNKNOWN_LOCATION_CARD_ART_STILL = "/assets/cards/location-unknown-still.svg";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

export function resolveMissionCardArt(mission: MissionTemplate | undefined): string {
  return mission?.cardArt ?? DEFAULT_MISSION_CARD_ART;
}

export function resolveOmegaPlanCardArt(plan: OmegaPlanTemplate | undefined): string {
  return plan?.cardArt ?? DEFAULT_OMEGA_PLAN_CARD_ART;
}

export function resolveMinionCardArt(template: MinionTemplate | undefined): string {
  return template?.cardArt ?? DEFAULT_MINION_CARD_ART;
}

/** Agents fall back to the minion placeholder — no agent-specific default is shipped. */
export function resolveAgentCardArt(template: AgentTemplate | undefined): string {
  return template?.cardArt ?? DEFAULT_MINION_CARD_ART;
}

export function resolveLocationCardArt(loc: LocationTemplate | undefined): string {
  return loc?.cardArt ?? DEFAULT_LOCATION_CARD_ART;
}

/** The art the player gets to see: static until the site is identified (see `intel.ts`). */
export function resolvePlayerLocationCardArt(
  loc: LocationTemplate | undefined,
  identified: boolean,
): string {
  if (identified) {
    return resolveLocationCardArt(loc);
  }
  return prefersReducedMotion() ? UNKNOWN_LOCATION_CARD_ART_STILL : UNKNOWN_LOCATION_CARD_ART;
}

export function resolveLairCardArt(lair: LairTemplate | undefined): string {
  return lair?.cardArt ?? DEFAULT_LAIR_CARD_ART;
}

export function resolveAssetCardArt(asset: Asset | undefined): string {
  return asset?.cardArt ?? DEFAULT_ASSET_CARD_ART;
}

/**
 * Deferred art: the card art is the heaviest thing the UI owns. A 16:9 hero is a 1280x720
 * source — 3.5 MB of bitmap once decoded, whatever size it is drawn at — and the menus hold
 * dozens of them. Built all at once that is well over 100 MB of decoded image for a screen
 * showing at most a handful of cards, which is enough to have a phone browser kill the tab.
 *
 * So art can be **parked**: the URL rides in `data-card-art` and the `img` carries no `src`, so
 * the browser never fetches or decodes it. Nothing is parked by default — a card built the
 * ordinary way loads its art the moment it is created. It is {@link withDeferredCardArt} that
 * says a run of cards is being built somewhere nobody can see, and {@link loadCardArt} /
 * {@link unloadCardArt} that move a subtree between the two states as that changes.
 *
 * Both shapes below are sized by CSS rather than by the image (the hero through `aspect-ratio`,
 * the thumbnail through a fixed box), so a parked card lays out exactly like a loaded one and
 * the art fades in where the placeholder already was.
 */
let deferNewCardArt = false;

/**
 * Runs `build` with every card it creates having its art parked rather than loaded. Restores
 * the previous setting afterwards, nested calls included, so a build that renders a visible
 * surface inside a deferred one is not silently parked along with it.
 */
export function withDeferredCardArt<T>(defer: boolean, build: () => T): T {
  const previous = deferNewCardArt;
  deferNewCardArt = defer;
  try {
    return build();
  } finally {
    deferNewCardArt = previous;
  }
}

/** Loads the parked art under `root`, as when the menu holding it is opened. */
export function loadCardArt(root: ParentNode): void {
  for (const img of root.querySelectorAll<HTMLImageElement>("img.card-art[data-card-art]")) {
    const src = img.dataset.cardArt;
    delete img.dataset.cardArt;
    if (src !== undefined && src !== "") {
      img.src = src;
    }
  }
}

/**
 * Parks the art under `root` and lets go of the decoded image, as when the menu holding it is
 * closed. `removeAttribute` rather than `src = ""`, which would resolve against the page and
 * fetch the document back as an image.
 */
export function unloadCardArt(root: ParentNode): void {
  for (const img of root.querySelectorAll<HTMLImageElement>("img.card-art[src]")) {
    img.dataset.cardArt = img.getAttribute("src") ?? "";
    img.removeAttribute("src");
  }
}

export function createCardArtImg(src: string, extraClass = ""): HTMLImageElement {
  const img = document.createElement("img");
  img.className = extraClass === "" ? "card-art" : `card-art ${extraClass}`;
  if (deferNewCardArt) {
    img.dataset.cardArt = src;
  } else {
    img.src = src;
  }
  img.alt = "";
  img.decoding = "async";
  img.loading = "lazy";
  img.setAttribute("aria-hidden", "true");
  /* The art is never its own drag. An image is draggable by default, so grabbing a card by its
   * picture — which is most of the card — would start an *image* drag: the browser packs the
   * art's URL, markup, and the file itself in beside the card's payload. A real OS drag (Windows
   * at least) round-trips that bundle through the system, and the drop comes back without the
   * payload the slot lit up for, so the card never lands. Off, the drag falls through to the
   * card's own `draggable`, carrying only what `beginCardDrag` put there. */
  img.draggable = false;
  return img;
}

/**
 * Art-led card shell: the art runs full-bleed across the top of the card and the card's name
 * and stat line sit on the bottom of the image behind a scrim, so `meta` is the block that
 * rides the art and `body` is everything that follows it under the image.
 *
 * The alternative to {@link appendCardArtShell}'s side thumbnail; shared by location, asset,
 * Omega plan mission and minion cards so they read as the same object. The banner's ratio is
 * CSS's to set — landscape for most, upright for the minion portraits.
 */
export function appendCardHeroShell(
  article: HTMLElement,
  src: string,
): { meta: HTMLDivElement; body: HTMLDivElement } {
  article.classList.add("card-with-hero-art");

  const hero = document.createElement("div");
  hero.className = "card-hero";
  hero.appendChild(createCardArtImg(src));

  const meta = document.createElement("div");
  meta.className = "card-hero__meta";
  hero.appendChild(meta);
  article.appendChild(hero);

  const body = document.createElement("div");
  body.className = "card-body";
  article.appendChild(body);
  return { meta, body };
}

/**
 * Adds `.card-with-art`, a thumbnail `img`, and a `.card-body` wrapper; returns the body for text/stats.
 */
export function appendCardArtShell(article: HTMLElement, src: string): HTMLDivElement {
  article.classList.add("card-with-art");
  article.appendChild(createCardArtImg(src));
  const body = document.createElement("div");
  body.className = "card-body";
  article.appendChild(body);
  return body;
}
