import assetsJson from "../../content/assets.json";
import locationsJson from "../../content/locations.json";
import mapsJson from "../../content/maps.json";
import minionsJson from "../../content/minions.json";
import missionsJson from "../../content/missions.json";
import omegaPlansJson from "../../content/omegaPlans.json";
import traitsJson from "../../content/traits.json";
import { parseCatalog } from "./contentSchema";
import type { ContentCatalog } from "./types";

export function loadContent(): ContentCatalog {
  return parseCatalog(
    traitsJson,
    minionsJson,
    missionsJson,
    locationsJson,
    mapsJson,
    assetsJson,
    omegaPlansJson,
  );
}
