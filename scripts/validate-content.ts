import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCatalog } from "../src/game/contentSchema.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

try {
  const traits = JSON.parse(readFileSync(join(root, "content/traits.json"), "utf8"));
  const minions = JSON.parse(readFileSync(join(root, "content/minions.json"), "utf8"));
  const missions = JSON.parse(readFileSync(join(root, "content/missions.json"), "utf8"));
  const locations = JSON.parse(readFileSync(join(root, "content/locations.json"), "utf8"));
  const maps = JSON.parse(readFileSync(join(root, "content/maps.json"), "utf8"));
  const assets = JSON.parse(readFileSync(join(root, "content/assets.json"), "utf8"));
  const omegaPlans = JSON.parse(readFileSync(join(root, "content/omegaPlans.json"), "utf8"));
  const catalog = parseCatalog(traits, minions, missions, locations, maps, assets, omegaPlans);
  console.log(
    `Content OK: ${catalog.traits.length} traits, ${catalog.minions.length} minion templates, ${catalog.missions.length} missions, ${catalog.locations.length} locations, ${catalog.maps.length} maps, ${catalog.assets.length} assets, ${catalog.omegaPlans.length} omega plans`,
  );
} catch (e) {
  console.error(e);
  process.exit(1);
}
