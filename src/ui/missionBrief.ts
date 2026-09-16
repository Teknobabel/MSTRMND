/**
 * The mission brief: everything a mission card says under its art. Four framed sections — the
 * brief itself, the Requirements grid, and (built in `main.ts`, from the same `briefPanel`)
 * On Success and On Failure — stacked down the card, each a boxed statement about the job with
 * its own ruled header.
 *
 * A location card's Intelligence Brief (`ui/locationBrief.ts`) stays flat and two-columned on
 * purpose: it is one form, filled in as far as the player's intel reaches. A mission's sections
 * are four separate statements, so they are framed separately.
 *
 * Skills and assets used to be two of those columns, each with its own heading. They were never
 * two questions: a mission is offered with a list of things the player either has or does not
 * have, and splitting that list in half by *kind* meant two short columns of different lengths
 * where one continuous list would do. So they are one grid now, two cells across, skills first
 * and assets after — same cell, same size, same build, with a `SKILL` / `ASSET` caption over
 * each name carrying the kind the two headings used to.
 *
 * Both kinds of cell wear a mark rather than a picture: a skill's glyph, and for an asset the
 * generic crate, in the same grey. The asset's own photograph is a poor fit for a box this size
 * — a landscape crop of a scene, shrunk to where it reads as a smudge next to line art — and it
 * made an asset requirement look like a different kind of thing from the skill beside it when it
 * is the same kind of thing: something the mission wants and the player either has or has not.
 * The art is a hover away, on the card the cell floats (`preview`), where it has room to be seen.
 *
 * A location's asset row carries three possible states — identified, existence-only, sealed —
 * because intel gates what the player is allowed to know. A mission has nothing to gate: every
 * required asset is named the moment the mission is offered. So a required-asset cell only ever
 * asks one question — does the player currently hold enough of it — which it answers with the
 * same `--req-have` / `--req-missing` pair the skill cells use.
 *
 * Purely presentational and data-in / DOM-out, like `locationBrief.ts`: the caller builds the
 * skill cells and hands in the asset list already resolved against the roster.
 */
import { ICON_CRATE, briefIcon, briefPanel, briefPlaceholder } from "./cardBrief";

/** One required-asset cell of the requirements grid. */
export interface MissionBriefAssetRow {
  /** Catalog id of the asset this cell is for. Not drawn — it is what a caller wiring `preview`
   * needs in order to build the right card, without re-deriving it from the cell's position. */
  assetId: string;
  name: string;
  /** How many the mission needs of this one asset; duplicates in the requirement list collapse
   * into a single cell with a count rather than repeating the cell. */
  quantity: number;
  /** Whether the player currently holds at least `quantity` of it. */
  have: boolean;
  tooltip: string;
  /**
   * Called with the cell element so the caller can float the asset's full card beside it on
   * hover. Optional so the module stays previewable without a game state behind it; when it is
   * given, the cell drops its `title` — see `missionAssetCell`.
   */
  preview?: (el: HTMLElement) => void;
}

export interface MissionBriefModel {
  description: string | null;
  /** Skill (trait) cells, built by the caller so it can carry roster-match colouring. */
  requirementPills: readonly HTMLElement[];
  assets: readonly MissionBriefAssetRow[];
}

/**
 * One required asset, built as the same slot a skill cell is: the generic crate mark in the icon
 * box, the ruled divider, then the kind caption over the name — so the grid reads as one run of
 * identical cells whichever kind of requirement a given cell happens to hold.
 */
function missionAssetCell(row: MissionBriefAssetRow): HTMLElement {
  const cell = document.createElement("span");
  /* The floating card carries the name and the description the tooltip was spelling out, and
   * more besides, so a cell that has one does not also get a text bubble sliding out over it a
   * second later. Cells without a preview keep the tooltip as their only long form. */
  if (row.preview === undefined) {
    cell.title = row.tooltip;
  }
  cell.className = row.have
    ? "minions-trait-pill minions-trait-pill--asset minions-trait-pill--req-have"
    : "minions-trait-pill minions-trait-pill--asset minions-trait-pill--req-missing";
  cell.tabIndex = 0;

  cell.appendChild(briefIcon(ICON_CRATE, "minions-trait-pill__icon"));

  const text = document.createElement("span");
  text.className = "minions-trait-pill__text";
  const caption = document.createElement("span");
  caption.className = "minions-trait-pill__caption";
  caption.textContent = "Asset";
  text.appendChild(caption);
  const name = document.createElement("span");
  name.className = "minions-trait-pill__label";
  /* Only worth a mark when the mission wants more than one — a "×1" on every other cell is a
   * column of noise for the one case it never has to call out. */
  name.textContent = row.quantity > 1 ? `${row.name} ×${row.quantity}` : row.name;
  text.appendChild(name);
  cell.appendChild(text);

  if (row.preview !== undefined) {
    cell.classList.add("card-brief__req--previewable");
    row.preview(cell);
  }

  return cell;
}

/**
 * Builds the brief. Returns the whole block ready to append under a mission card's art; the
 * caller decides nothing about its layout.
 */
export function buildMissionBrief(model: MissionBriefModel): HTMLElement {
  const root = document.createElement("div");
  root.className = "card-brief card-brief--mission";

  /* ---- The brief proper ---- */
  const brief = briefPanel("Mission Brief");
  if (model.description !== null && model.description !== "") {
    const desc = document.createElement("p");
    desc.className = "asset-card-description";
    desc.textContent = model.description;
    brief.body.appendChild(desc);
  } else {
    brief.body.appendChild(briefPlaceholder("No brief on file"));
  }
  root.appendChild(brief.panel);

  /* ---- Requirements: skills, then assets, in one two-across grid ---- */
  const reqs = briefPanel("Requirements");
  if (model.requirementPills.length === 0 && model.assets.length === 0) {
    reqs.body.appendChild(briefPlaceholder("No requirements"));
  } else {
    const grid = document.createElement("div");
    grid.className = "card-brief__pills card-brief__pills--grid";
    for (const pill of model.requirementPills) {
      grid.appendChild(pill);
    }
    for (const row of model.assets) {
      grid.appendChild(missionAssetCell(row));
    }
    reqs.body.appendChild(grid);
  }
  root.appendChild(reqs.panel);

  return root;
}
