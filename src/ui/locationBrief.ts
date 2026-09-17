/**
 * The intelligence brief: everything a location card says about a site *below* its art.
 *
 * The card's banner is what the site is — name, category, level, security, intel. The brief is
 * what the player has managed to find out about working it, and it is deliberately built to
 * look **incomplete**: a dossier that fills in as intel rises. At intel 0 it is a blank form
 * with a "no intel" stamp; at 1 the requirements are typed in and the asset manifest lists
 * sealed crates; at 2 the crates are named and photographed; at 3 the opposition is on it.
 *
 * Three framed sections, stacked like a mission card's: the **Intelligence Brief** (file number,
 * intel meter and the site's description), **Requirements** (the site's own traits and its
 * security stack in one two-across grid, since a mission has to beat both), then **Assets**.
 *
 * Purely presentational and data-in / DOM-out: every catalog lookup, tooltip and drag payload
 * is the caller's, handed in as a built pill or a `wire` callback. That keeps the module
 * previewable and testable without a game state behind it.
 */
import { createCardArtImg } from "./cardArt";
import {
  ICON_CRATE,
  ICON_SHIELD,
  briefIcon,
  briefPanel,
  briefPlaceholder,
  briefSectionLabel,
} from "./cardBrief";
import { setTooltip, tooltipText } from "./tooltip";

/** Highest intel a site can reach; the meter draws this many pips. */
const BRIEF_INTEL_PIPS = 3;

const ICON_SKULL =
  '<path d="M12 3c-4 0-7 2.9-7 6.6 0 2.3 1.2 4 2.8 5v2.9c0 .8.6 1.5 1.4 1.5h5.6c.8 0 1.4-.7 1.4-1.5v-2.9c1.6-1 2.8-2.7 2.8-5C19 5.9 16 3 12 3Z"/><circle cx="9.2" cy="10" r="1.3"/><circle cx="14.8" cy="10" r="1.3"/>';
const ICON_LOCK =
  '<rect x="4.5" y="10.5" width="15" height="10" rx="1"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>';
/** The card's own intel sigil with a line struck through it — the same eye, switched off. */
const ICON_EYE_OFF =
  '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path d="M3 21 21 3"/>';

/**
 * A site's file number, shown in the brief header. Flavour rather than data — but it has to be
 * the *same* number every time the same site is looked at, so it is a hash of the id rather
 * than anything rolled. FNV-1a, folded to four digits and a letter.
 */
export function locationDesignation(locationId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < locationId.length; i += 1) {
    h ^= locationId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const digits = String(h % 10000).padStart(4, "0");
  const letter = String.fromCharCode(65 + ((h >>> 16) % 26));
  return `LOC-${digits}-${letter}`;
}

/** One line of the asset manifest. `knowledge` mirrors `intel.ts`'s `AssetSlotKnowledge`. */
export interface LocationBriefAssetRow {
  knowledge: "identified" | "existence" | "empty";
  /** Catalog name when identified; ignored otherwise. */
  name: string;
  /** Thumbnail art URL. Present for identified rows, and the static for hidden ones. */
  art: string | null;
  tooltip: string;
  /** Called with the row element so the caller can hang its drag payload on it. */
  wire?: (el: HTMLElement) => void;
  /**
   * Called with the row element so the caller can float the asset's full card beside it on
   * hover. Only set for rows the player has identified — an existence-only row has no card to
   * show yet, which is the whole point of it. When it is given, the row drops its `title`; see
   * `briefAssetRow`.
   */
  preview?: (el: HTMLElement) => void;
}

export interface LocationBriefModel {
  intelLevel: number;
  /** Below `INTEL_SITE_IDENTITY` the site has no brief to speak of — see the blank-form note. */
  identified: boolean;
  designation: string;
  /** The site's catalog description, shown in the Intelligence Brief section. */
  description: string | null;
  /** Site traits then revealed security traits, built by the caller (captioned grid cells). */
  requirementPills: readonly HTMLElement[];
  /** The security level that reveals each trait the stack still holds back; drawn as sealed
   * rows, not named. */
  classifiedSecurityLevels: readonly number[];
  assets: readonly LocationBriefAssetRow[];
  /** Slots are known to exist but not how many (intel 0, nothing revealed by play). */
  assetCountUnknown: boolean;
  /** Agent chips, built by the caller (they carry catalog art and ability tooltips). */
  agents: readonly HTMLElement[];
  /** The site-wide challenge-trait line under the agents, when there is one. */
  agentNote: HTMLElement | null;
}

function briefIntelMeter(intelLevel: number): HTMLElement {
  const meter = document.createElement("span");
  meter.className = "loc-brief__meter";
  setTooltip(
    meter,
    "Intel Level",
    `${intelLevel} of ${BRIEF_INTEL_PIPS}. Each step uncovers more of this site — its asset slots, then what is in them, then the agents standing there.`,
  );
  meter.setAttribute("aria-label", `Intel ${intelLevel} of ${BRIEF_INTEL_PIPS}`);
  for (let i = 0; i < BRIEF_INTEL_PIPS; i += 1) {
    const pip = document.createElement("i");
    pip.className =
      i < intelLevel ? "loc-brief__pip loc-brief__pip--lit" : "loc-brief__pip";
    meter.appendChild(pip);
  }
  return meter;
}

/**
 * A sealed row: the manifest knows the slot is there, or the security stack knows a trait is
 * coming, but neither can be read yet. Drawn as a redacted bar rather than a word so the player
 * can see how much of the page is still blacked out.
 */
function briefSealedRow(tooltip: string): HTMLElement {
  const li = document.createElement("li");
  li.className = "card-brief__asset card-brief__asset--sealed card-brief__asset--uncoded";
  li.title = tooltip;
  const thumb = document.createElement("span");
  thumb.className = "card-brief__asset-thumb card-brief__asset-thumb--sealed";
  thumb.appendChild(briefIcon(ICON_LOCK, "loc-brief__sealed-icon"));
  li.appendChild(thumb);
  const bar = document.createElement("span");
  bar.className = "loc-brief__redacted";
  bar.textContent = "CLASSIFIED";
  li.appendChild(bar);
  return li;
}

function briefAssetRow(row: LocationBriefAssetRow): HTMLElement {
  const li = document.createElement("li");
  /* The floating card carries the name and the description the tooltip was spelling out, and
   * more besides, so a row that has one does not also get a text bubble sliding out over it a
   * second later. Rows without a preview — anything the player has not identified — keep the
   * tooltip, which is where the "raise intel to read this" line lives. */
  if (row.preview === undefined) {
    li.title = row.tooltip;
  }

  if (row.knowledge === "empty") {
    li.className = "card-brief__asset card-brief__asset--empty card-brief__asset--uncoded";
    const thumb = document.createElement("span");
    thumb.className = "card-brief__asset-thumb card-brief__asset-thumb--empty";
    li.appendChild(thumb);
    const name = document.createElement("span");
    name.className = "card-brief__asset-name";
    name.textContent = "Slot cleared";
    li.appendChild(name);
    return li;
  }

  const identified = row.knowledge === "identified";
  li.className = identified
    ? "card-brief__asset card-brief__asset--revealed card-brief__asset--uncoded"
    : "card-brief__asset card-brief__asset--hidden card-brief__asset--uncoded";

  if (row.art !== null) {
    const img = createCardArtImg(row.art, "card-brief__asset-thumb");
    li.appendChild(img);
  } else {
    const thumb = document.createElement("span");
    thumb.className = "card-brief__asset-thumb card-brief__asset-thumb--sealed";
    li.appendChild(thumb);
  }

  const name = document.createElement("span");
  name.className = "card-brief__asset-name";
  name.textContent = identified ? row.name : "Unidentified";
  li.appendChild(name);

  if (row.wire !== undefined) {
    li.classList.add("card-brief__asset--draggable");
    row.wire(li);
  }
  if (row.preview !== undefined) {
    li.classList.add("card-brief__asset--previewable");
    row.preview(li);
  }
  return li;
}

/**
 * What an unidentified site gets instead of a brief. A form with every field blank is a poor
 * way to say "there is no file here" — it reads as a card that failed to load. So intel 0 drops
 * the whole two-column layout for one plate that fills the space and names the one thing the
 * player can do about it.
 *
 * Anything already uncovered by play still goes below it — see the manifest tail in
 * {@link buildLocationBrief} — because a slot revealed by a mission is the player's, intel or no
 * intel, and it must not disappear behind this.
 */
function briefNoIntelPlate(): HTMLElement {
  const plate = document.createElement("div");
  plate.className = "loc-brief__nointel";

  const badge = document.createElement("span");
  badge.className = "loc-brief__nointel-badge";
  badge.appendChild(briefIcon(ICON_EYE_OFF, "loc-brief__nointel-icon"));
  plate.appendChild(badge);

  const copy = document.createElement("div");
  copy.className = "loc-brief__nointel-copy";
  const title = document.createElement("p");
  title.className = "loc-brief__nointel-title";
  title.textContent = "No Intel Available";
  copy.appendChild(title);
  const note = document.createElement("p");
  note.className = "loc-brief__nointel-note";
  note.textContent =
    "Reconnaissance required to reveal site level, security, target requirements, and known assets.";
  copy.appendChild(note);
  plate.appendChild(copy);

  return plate;
}

/**
 * Builds the brief. Returns the whole block ready to append under a location card's art; the
 * caller decides nothing about its layout.
 */
export function buildLocationBrief(model: LocationBriefModel): HTMLElement {
  const root = document.createElement("div");
  root.className = "card-brief";
  root.dataset.intel = String(model.intelLevel);

  if (!model.identified) {
    root.classList.add("loc-brief--nointel");
    root.appendChild(briefNoIntelPlate());
    /* Slots uncovered by play survive the blackout, under a label of their own so they read as
     * the exception they are rather than as the start of a manifest. */
    const known = model.assets.filter((a) => a.knowledge === "identified");
    if (known.length > 0) {
      root.appendChild(briefSectionLabel(ICON_CRATE, "Confirmed Assets", null));
      const list = document.createElement("ul");
      list.className = "card-brief__assets";
      for (const row of known) {
        list.appendChild(briefAssetRow(row));
      }
      root.appendChild(list);
    }
    return root;
  }

  root.classList.add("card-brief--panels");

  /* ---- The brief proper: file number and intel meter on the header strip, description below ---- */
  const brief = briefPanel("Intelligence Brief");
  const code = document.createElement("span");
  code.className = "loc-brief__code";
  code.textContent = model.designation;
  brief.head.appendChild(code);
  brief.head.appendChild(briefIntelMeter(model.intelLevel));
  if (model.description !== null && model.description !== "") {
    const desc = document.createElement("p");
    desc.className = "asset-card-description";
    desc.textContent = model.description;
    brief.body.appendChild(desc);
  } else {
    brief.body.appendChild(briefPlaceholder("No brief on file"));
  }
  root.appendChild(brief.panel);

  /* ---- Requirements: site traits then the security stack, in one two-across grid ---- */
  const reqs = briefPanel("Mission Modifiers");
  if (model.requirementPills.length === 0 && model.classifiedSecurityLevels.length === 0) {
    reqs.body.appendChild(briefPlaceholder("No special requirements"));
  } else {
    const pills = document.createElement("div");
    pills.className = "card-brief__pills card-brief__pills--grid";
    for (const pill of model.requirementPills) {
      pills.appendChild(pill);
    }
    /* Security the site has not had to show yet. The count is no secret — the stack is as deep
     * as the site's level — so saying how much is still sealed costs nothing and tells the
     * player what raising security here will cost them. */
    for (const level of model.classifiedSecurityLevels) {
      const sealed = document.createElement("span");
      sealed.className = "minions-trait-pill loc-brief__pill-sealed";
      sealed.title = tooltipText(
        "Security Measure",
        "As security increases at this location, new mission modifiers are unlocked. Reduce security level to remove these modifiers.",
      );
      sealed.appendChild(briefIcon(ICON_SHIELD, "minions-trait-pill__icon"));
      const text = document.createElement("span");
      text.className = "minions-trait-pill__text";
      const caption = document.createElement("span");
      caption.className = "minions-trait-pill__caption";
      caption.textContent = `Security Lvl ${level}`;
      text.appendChild(caption);
      const label = document.createElement("span");
      label.className = "minions-trait-pill__label";
      label.textContent = "LOCKED";
      text.appendChild(label);
      sealed.appendChild(text);
      pills.appendChild(sealed);
    }
    reqs.body.appendChild(pills);
  }

  /* Opposition rides under the requirements rather than in its own section: an agent standing
   * at the site is one more thing a mission has to beat, so it belongs with what the job takes. */
  if (model.agents.length > 0) {
    reqs.body.appendChild(briefSectionLabel(ICON_SKULL, "Opposition", null));
    const agentsWrap = document.createElement("div");
    agentsWrap.className = "loc-brief__agents";
    for (const chip of model.agents) {
      agentsWrap.appendChild(chip);
    }
    if (model.agentNote !== null) {
      agentsWrap.appendChild(model.agentNote);
    }
    reqs.body.appendChild(agentsWrap);
  }
  root.appendChild(reqs.panel);

  /* ---- The asset manifest ---- */
  const assetsPanel = briefPanel("Assets");
  const assets = assetsPanel.body;

  if (model.assets.length === 0) {
    assets.appendChild(
      model.assetCountUnknown
        ? briefPlaceholder(
            "Manifest sealed",
            tooltipText("Sealed Manifest", "Raise intel at this site to learn how many assets are stored here."),
          )
        : briefPlaceholder("Nothing stored here"),
    );
  } else {
    const list = document.createElement("ul");
    list.className = "card-brief__assets card-brief__assets--grid";
    for (const row of model.assets) {
      list.appendChild(briefAssetRow(row));
    }
    /* Slots the player cannot even count sit after the ones they can, so the manifest reads
     * "here is what I have, and there is more" rather than hiding the known behind the unknown. */
    if (model.assetCountUnknown) {
      list.appendChild(
        briefSealedRow(
          tooltipText("Sealed Manifest", "Raise intel at this site to learn how many assets are stored here."),
        ),
      );
    }
    assets.appendChild(list);
  }

  root.appendChild(assetsPanel.panel);
  return root;
}
