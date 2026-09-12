/**
 * The mission brief: everything a mission card says under its art, laid out the same way a
 * location card's Intelligence Brief is (`ui/locationBrief.ts`) — a stamped header, then two
 * ruled columns: **Required Skills** on the left, **Required Assets** on the right, formatted
 * as the same boxed manifest rows a location's asset list uses.
 *
 * A location's asset row carries three possible states — identified, existence-only, sealed —
 * because intel gates what the player is allowed to know. A mission has nothing to gate: every
 * required asset is named the moment the mission is offered. So a required-asset row only ever
 * asks one question — does the player currently hold enough of it — which is why it is drawn
 * with its own `--have` / `--missing` pair rather than location's identified/hidden ones.
 *
 * Purely presentational and data-in / DOM-out, like `locationBrief.ts`: the caller builds the
 * skill pills and hands in the asset list already resolved against the roster.
 */
import { createCardArtImg } from "./cardArt";
import { ICON_CLIPBOARD, ICON_CRATE, briefPlaceholder, briefSectionLabel } from "./cardBrief";

/** One line of the required-assets manifest. */
export interface MissionBriefAssetRow {
  name: string;
  /** Thumbnail art URL — always present, since a required asset is always known. */
  art: string;
  /** How many the mission needs of this one asset; duplicates in the requirement list collapse
   * into a single row with a count rather than repeating the row. */
  quantity: number;
  /** Whether the player currently holds at least `quantity` of it. */
  have: boolean;
  tooltip: string;
}

export interface MissionBriefModel {
  description: string | null;
  /** Skill (trait) pills, built by the caller so it can carry roster-match colouring. */
  requirementPills: readonly HTMLElement[];
  assets: readonly MissionBriefAssetRow[];
}

function missionAssetRow(row: MissionBriefAssetRow): HTMLElement {
  const li = document.createElement("li");
  li.title = row.tooltip;
  li.className = row.have
    ? "card-brief__asset card-brief__asset--have"
    : "card-brief__asset card-brief__asset--missing";

  li.appendChild(createCardArtImg(row.art, "card-brief__asset-thumb"));

  const count = document.createElement("span");
  count.className = "card-brief__asset-code";
  count.textContent = row.quantity > 1 ? `×${row.quantity}` : "";
  li.appendChild(count);

  const name = document.createElement("span");
  name.className = "card-brief__asset-name";
  name.textContent = row.name;
  li.appendChild(name);

  return li;
}

/**
 * Builds the brief. Returns the whole block ready to append under a mission card's art; the
 * caller decides nothing about its layout.
 */
export function buildMissionBrief(model: MissionBriefModel): HTMLElement {
  const root = document.createElement("div");
  root.className = "card-brief";

  const head = document.createElement("div");
  head.className = "card-brief__head";
  const stamp = document.createElement("span");
  stamp.className = "card-brief__stamp";
  stamp.textContent = "Mission Brief";
  head.appendChild(stamp);
  root.appendChild(head);

  if (model.description !== null && model.description !== "") {
    const desc = document.createElement("p");
    desc.className = "asset-card-description";
    desc.textContent = model.description;
    root.appendChild(desc);
  }

  const cols = document.createElement("div");
  cols.className = "card-brief__cols";
  root.appendChild(cols);

  /* ---- Left: required skills ---- */
  const skills = document.createElement("section");
  skills.className = "card-brief__col card-brief__col--reqs";
  skills.appendChild(briefSectionLabel(ICON_CLIPBOARD, "Required Skills", null));
  if (model.requirementPills.length === 0) {
    skills.appendChild(briefPlaceholder("No skill requirements"));
  } else {
    const pills = document.createElement("div");
    pills.className = "card-brief__pills";
    for (const pill of model.requirementPills) {
      pills.appendChild(pill);
    }
    skills.appendChild(pills);
  }
  cols.appendChild(skills);

  /* ---- Right: required assets, formatted as a location card's manifest ---- */
  const assets = document.createElement("section");
  assets.className = "card-brief__col card-brief__col--assets";
  const haveCount = model.assets.filter((a) => a.have).length;
  assets.appendChild(
    briefSectionLabel(
      ICON_CRATE,
      "Required Assets",
      model.assets.length === 0 ? null : `${haveCount}/${model.assets.length}`,
    ),
  );
  if (model.assets.length === 0) {
    assets.appendChild(briefPlaceholder("No assets required"));
  } else {
    const list = document.createElement("ul");
    list.className = "card-brief__assets";
    for (const row of model.assets) {
      list.appendChild(missionAssetRow(row));
    }
    assets.appendChild(list);
  }
  cols.appendChild(assets);

  return root;
}
