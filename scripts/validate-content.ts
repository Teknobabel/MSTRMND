import { existsSync, readFileSync } from "node:fs";
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

/* Art paths must resolve to real files under public/ (Node-only check; the browser
 * schema can't touch the filesystem). Catches deleted/renamed art at build time. */
const artRefs: Array<{ where: string; path: string }> = [];
const withCardArt: Array<[string, ReadonlyArray<{ id: string; cardArt?: string }>]> = [
  ["minions", catalog.minions],
  ["agents", catalog.agents],
  ["missions", catalog.missions],
  ["events", catalog.events],
  ["locations", catalog.locations],
  ["assets", catalog.assets],
  ["lairs", catalog.lairs],
  ["omegaPlans", catalog.omegaPlans],
];
for (const [slice, entities] of withCardArt) {
  for (const e of entities) {
    if (e.cardArt !== undefined) {
      artRefs.push({ where: `[${slice}] ${e.id} cardArt`, path: e.cardArt });
    }
  }
}
for (const p of catalog.playerProfiles) {
  artRefs.push({ where: `[playerProfiles] ${p.name} profilePic`, path: p.profilePic });
}

const missingArt = artRefs.filter(
  ({ path }) => !path.startsWith("/") || !existsSync(join(root, "public", path)),
);
if (missingArt.length > 0) {
  console.error(`Content validation failed: ${missingArt.length} art path(s) unresolvable:`);
  for (const { where, path } of missingArt) {
    console.error(`- ${where}: ${path} (expected a site-root path to a file under public/)`);
  }
  process.exit(1);
}

console.log(
  `Content OK: ${catalog.traits.length} traits, ${catalog.minions.length} minion templates, ${catalog.agents.length} agent templates, ${catalog.missions.length} missions, ${catalog.locations.length} locations, ${catalog.maps.length} maps, ${catalog.assets.length} assets, ${catalog.omegaPlans.length} omega plans, ${catalog.lairs.length} lairs, ${catalog.events.length} events, ${catalog.organizationNames.length} organization names, ${catalog.playerProfiles.length} player profiles, ${catalog.wantedLevels.length} wanted levels`,
);
