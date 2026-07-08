import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTENT_MANIFEST,
  parseContentCatalog,
  type ContentSliceKey,
} from "../src/game/contentSchema.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const raw = {} as Record<ContentSliceKey, unknown>;
for (const entry of CONTENT_MANIFEST) {
  try {
    raw[entry.key] = JSON.parse(readFileSync(join(root, entry.fileName), "utf8"));
  } catch (e) {
    console.error(`Failed to read/parse ${entry.fileName}: ${String(e)}`);
    process.exit(1);
  }
}

const { catalog, issues } = parseContentCatalog(raw);

if (catalog === null) {
  console.error(`Content validation failed with ${issues.length} issue(s):`);
  for (const issue of issues) {
    const where = `${issue.entityId ?? "(slice)"}${issue.path ? ` ${issue.path}` : ""}`;
    console.error(`- [${issue.slice}] ${where}: ${issue.message}`);
  }
  process.exit(1);
}

console.log(
  `Content OK: ${catalog.traits.length} traits, ${catalog.minions.length} minion templates, ${catalog.agents.length} agent templates, ${catalog.missions.length} missions, ${catalog.locations.length} locations, ${catalog.maps.length} maps, ${catalog.assets.length} assets, ${catalog.omegaPlans.length} omega plans, ${catalog.lairs.length} lairs, ${catalog.events.length} events, ${catalog.organizationNames.length} organization names, ${catalog.playerProfiles.length} player profiles, ${catalog.wantedLevels.length} wanted levels`,
);
