import agentsJson from "../../content/agents.json";
import assetsJson from "../../content/assets.json";
import balanceJson from "../../content/balance.json";
import eventsJson from "../../content/events.json";
import lairsJson from "../../content/lairs.json";
import locationsJson from "../../content/locations.json";
import mapsJson from "../../content/maps.json";
import minionsJson from "../../content/minions.json";
import missionsJson from "../../content/missions.json";
import organizationNamesJson from "../../content/organizationNames.json";
import playerProfilesJson from "../../content/playerProfiles.json";
import omegaPlansJson from "../../content/omegaPlans.json";
import traitsJson from "../../content/traits.json";
import wantedLevelsJson from "../../content/wantedLevels.json";
import { parseCatalog, type RawContentSlices } from "./contentSchema";
import type { ContentCatalog } from "./types";

/*
 * Static imports keep the JSON bundled by Vite; the keys must cover every
 * `ContentSliceKey` in `CONTENT_MANIFEST` (the compiler enforces the record shape).
 */
const rawContentSlices: RawContentSlices = {
  traits: traitsJson,
  minions: minionsJson,
  agents: agentsJson,
  missions: missionsJson,
  locations: locationsJson,
  maps: mapsJson,
  assets: assetsJson,
  omegaPlans: omegaPlansJson,
  lairs: lairsJson,
  events: eventsJson,
  organizationNames: organizationNamesJson,
  playerProfiles: playerProfilesJson,
  wantedLevels: wantedLevelsJson,
  balance: balanceJson,
};

export function loadContent(): ContentCatalog {
  return parseCatalog(rawContentSlices);
}
