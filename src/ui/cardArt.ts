import type {
  Asset,
  LairTemplate,
  LocationTemplate,
  MissionTemplate,
  MinionTemplate,
} from "../game/types";

/** Shipped placeholders under `public/assets/cards/`. */
export const DEFAULT_MISSION_CARD_ART = "/assets/cards/mission.png";
export const DEFAULT_MINION_CARD_ART = "/assets/cards/minion.png";
export const DEFAULT_LOCATION_CARD_ART = "/assets/cards/location.png";
export const DEFAULT_LAIR_CARD_ART = "/assets/cards/lair.png";
export const DEFAULT_ASSET_CARD_ART = "/assets/cards/asset.png";

export function resolveMissionCardArt(mission: MissionTemplate | undefined): string {
  return mission?.cardArt ?? DEFAULT_MISSION_CARD_ART;
}

export function resolveMinionCardArt(template: MinionTemplate | undefined): string {
  return template?.cardArt ?? DEFAULT_MINION_CARD_ART;
}

export function resolveLocationCardArt(loc: LocationTemplate | undefined): string {
  return loc?.cardArt ?? DEFAULT_LOCATION_CARD_ART;
}

export function resolveLairCardArt(lair: LairTemplate | undefined): string {
  return lair?.cardArt ?? DEFAULT_LAIR_CARD_ART;
}

export function resolveAssetCardArt(asset: Asset | undefined): string {
  return asset?.cardArt ?? DEFAULT_ASSET_CARD_ART;
}

export function createCardArtImg(src: string, extraClass = ""): HTMLImageElement {
  const img = document.createElement("img");
  img.className = extraClass === "" ? "card-art" : `card-art ${extraClass}`;
  img.src = src;
  img.alt = "";
  img.decoding = "async";
  img.loading = "lazy";
  img.setAttribute("aria-hidden", "true");
  return img;
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
