/**
 * The minion bio: everything a minion card says under its art, opened with the same stamped
 * header the location card's Intelligence Brief and the mission card's Mission Brief use
 * (`ui/locationBrief.ts`, `ui/missionBrief.ts`) — here, "Bio". A minion has no columns to split
 * across, only a flavour line and a trait list, so Skills is the Required Skills column from
 * `ui/missionBrief.ts` run full width instead of sitting beside a second one.
 *
 * Purely presentational and data-in / DOM-out, like the other two briefs: the caller builds the
 * trait pills (roster-match colouring, dynamic-trait tooltips) and hands them in.
 */
import { ICON_CLIPBOARD, briefPlaceholder, briefSectionLabel } from "./cardBrief";

export interface MinionBriefModel {
  description: string | null;
  /** Omit the Skills section entirely — distinct from an empty list, which still draws the
   * section with its placeholder — for the one caller with no minion behind the card at all. */
  skillPills: readonly HTMLElement[] | null;
}

/**
 * Builds the brief. Returns the whole block ready to append under a minion card's art; the
 * caller decides nothing about its layout.
 */
export function buildMinionBrief(model: MinionBriefModel): HTMLElement {
  const root = document.createElement("div");
  root.className = "card-brief";

  const head = document.createElement("div");
  head.className = "card-brief__head";
  const stamp = document.createElement("span");
  stamp.className = "card-brief__stamp";
  stamp.textContent = "Bio";
  head.appendChild(stamp);
  root.appendChild(head);

  if (model.description !== null && model.description !== "") {
    const desc = document.createElement("p");
    desc.className = "minions-card-description";
    desc.textContent = model.description;
    root.appendChild(desc);
  }

  if (model.skillPills !== null) {
    const section = document.createElement("section");
    section.className = "card-brief__col";
    section.appendChild(briefSectionLabel(ICON_CLIPBOARD, "Skills", null));
    if (model.skillPills.length === 0) {
      section.appendChild(briefPlaceholder("No skills"));
    } else {
      const pills = document.createElement("div");
      // A minion's skills are the card's identity, not a checklist against a job the way the
      // mission card's Required Skills column is — so they get the grid of square chips rather
      // than the shared stack of rows. Same pills either way; only the container differs.
      pills.className = "card-brief__pills card-brief__pills--grid";
      for (const pill of model.skillPills) {
        pills.appendChild(pill);
      }
      section.appendChild(pills);
    }
    root.appendChild(section);
  }

  return root;
}
