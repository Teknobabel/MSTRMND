# Mastermind — system reference for agents

This document describes the **current** architecture, data flow, and content model as of the repo state. Use it to stay consistent when adding features or content.

## Tech stack

- **Vite 6** + **TypeScript** (strict), ES modules.
- **Web UI**: DOM screens for menus (`index.html` + `src/navigation.ts`); **Canvas 2D** for the placeholder game view (`src/canvas/setup.ts`, `src/main.ts`).
- **Content**: JSON files under `content/`, validated with **Zod** in `src/game/contentSchema.ts`.
- **Validation CLI**: `npm run content:validate` runs `scripts/validate-content.ts` (Node + `tsx`). **`npm run build`** runs content validation, then `vite build`.

## Repository layout (relevant paths)

| Path | Role |
|------|------|
| `content/*.json` | Designer-authored catalogs (traits, minions, missions, locations, maps, assets, omega plans, organization names). |
| `src/game/types.ts` | Canonical TypeScript types for templates, catalog shape, and some runtime-only types. |
| `src/game/contentSchema.ts` | Zod schemas, cross-reference checks, **`parseCatalog(...)`** entry point. |
| `src/game/loadContent.ts` | Imports all JSON modules and returns `parseCatalog(...)`. |
| `src/game/minion.ts` | Runtime: create minion from template; **mission XP → level-up** (`awardMissionResolutionExperience`, constants `MINION_XP_PER_MISSION` / `MINION_XP_TO_LEVEL`); ordered trait grant on level (`applyLevelUp` / `nextLevelUpTraitId`); add/remove trait. |
| `src/game/mission.ts` | Runtime: participant trait union, mission success % (linear set rule), roster size 1–3. |
| `src/game/locationCatalog.ts` | Lookups: location/map by id, missions for a location, **`locationTemplatesForOmegaPlan`** (run locations from active plan’s map), **initial location security** snapshots. |
| `src/game/omegaPlan.ts` | Lookups: omega plan by id, **`pickRandomOmegaPlanId`** for new-run selection, mission id at stage/slot indices. |
| `src/game/gameState.ts` | Runtime turn loop: **Main → Summary** (`executePlan`), CP/infamy/minions/assets, hire, **`assignMission`** with **`missionTarget`**, resolve rolls vs `mission.ts`; **infamy**, **participant XP/level-ups**, **security** via **`locationIdForMissionSecurity`**, **`activityLog`**; **`organizationName`** at run start. |
| `src/navigation.ts` | Menu state machine (main / settings / game / pause overlay). |
| `src/main.ts` | Boot: `loadContent()`, game controller (`initGameController`), canvas loop, `initNavigation()`. |

## Content catalog pipeline

1. **Authoring**: Edit JSON under `content/`. Use stable string **`id`** fields for cross-references (lowercase slugs are typical).
2. **Loading (app)**: `loadContent()` in `loadContent.ts` imports JSON and calls **`parseCatalog(traits, minions, missions, locations, maps, assets, omegaPlans, organizationNames)`** (eight arguments, fixed order).
3. **Parsing order inside `parseCatalog`**: Traits first (defines `traitIds`), then minions (trait refs), missions (trait refs), **assets** (standalone), **locations** (mission refs only), **maps** (location refs), **omega plans** (mission refs + **`mapId`** → maps), **organization names** (standalone JSON array of display strings). Returned object is a **`ContentCatalog`** (`types.ts`).

**Cross-reference rules** (enforced in `contentSchema.ts`):

- Minion `startingTraitIds` / `levelUpTraitOrder` → existing trait ids.
- Mission `requiredTraitIds` → traits; unique per mission; at least one required trait per mission.
- Omega plan **`mapId`** → **`MapTemplate.id`**; omega plans parsed **after** maps.
- Omega plan stage `missionIds` (3×3 grid) → missions; **same mission id may repeat** within a plan.
- Location `availableMissionIds` → missions; no duplicate mission id **within the same location’s list**; **same mission may appear on multiple locations**.
- Map `locationIds` → locations; no duplicate location id **within the same map**; a location may appear on multiple maps.
- Asset ids unique in `assets.json`.
- **`organizationNames.json`**: JSON array of at least one non-empty string (no cross-references).

## Domain objects (catalog templates)

Enums in JSON are generally **lowercase** strings (e.g. trait `type`, location `locationType`).

### Traits (`content/traits.json`)

- **Trait**: `id`, `name`, `type`: `status` | `primary` | `secondary`.
- Passive definitions; minions and missions reference trait ids.

### Minions (`content/minions.json`)

- **MinionTemplate**: `id`, `name`, `description`, **`hireCommandPoints`** (integer ≥ 0; CP spent when hiring in the Main Phase), optional `startingTraitIds`, `levelUpTraitOrder` (ordered trait ids for level-ups).
- **MinionInstance** (runtime, not in JSON): **`instanceId`** (stable id for roster and missions), `templateId`, `currentLevel`, `currentExperience`, `traitIds`.
- **Creation** (`minion.ts`): `createMinionFromTemplate(template, instanceId, overrides?)` — callers supply `instanceId` (e.g. `crypto.randomUUID()`).
- **Mission XP & leveling** (`minion.ts` + **`executePlan`** in `gameState.ts`): when a mission **resolves** (duration reaches 0 with valid template and participants), **each participant** gains **`MINION_XP_PER_MISSION`** (**1**) XP. When **`currentExperience`** reaches **`MINION_XP_TO_LEVEL`** (**3**), the minion **levels up** (`currentLevel` +1), **`currentExperience` resets to 0**, and **`applyLevelUp`** runs: grant the **first** trait in `levelUpTraitOrder` the instance does **not** already have (if none left, level still increases but **no** new trait). A **`minion_leveled_up`** activity event is recorded for that turn (see **Activity log** below).
- **Manual / catalog level-up helpers** (`minion.ts`): `nextLevelUpTraitId`, `applyLevelUp`, `addTrait`, `removeTrait` — same ordered trait rule as automatic level-ups.

### Missions (`content/missions.json`)

- **MissionTemplate**: `id`, `name`, `description`, **`startCommandPoints`** (integer ≥ 0; CP spent when starting the mission in the Main Phase), `requiredTraitIds` (unique set per mission), `durationTurns` (integer ≥ 1), **`targetKind`**: `location` | `location_asset` | `minion` | `none` (optional in JSON; defaults to **`location`** in **`contentSchema.ts`**).
- **Success chance** (`mission.ts`): union of participating minions’ traits vs required set + optional `additionalRequiredTraitIds`; `Math.round(100 * matched / total)`; participants 1–3 minions.

### Locations (`content/locations.json`)

- **LocationTemplate**: `id`, `name`, `description`, `locationType` (`political` | `military` | `economic`), `locationLevel` (1 | 2 | 3), `availableMissionIds`. Per-location **asset placement** is **not** in this JSON; at run start **`createInitialGameState`** assigns **1–3** random catalog assets per **playable** location on the active map (`LocationAssetSlot`: **`assetId`**, **`visibility`** `hidden` | `revealed`), then reveals **`min(3, total slots)`** slots globally at random.
- **LocationSecurityState** (runtime, not in location JSON): `locationId`, `securityLevel` (1 | 2 | 3). For a new run use **`initialLocationSecurityStatesForLocations`** with **`locationTemplatesForOmegaPlan(catalog, activeOmegaPlanId)`** (security **1**). If there is **no** omega plan, playable locations are the **full** catalog. **During play**, when a mission **resolves**, **`securityLevel`** at the resolved location increases by **1** (max **3**) only if **`locationIdForMissionSecurity(missionTarget)`** returns that location’s id (**`location`** and **`location_asset`** targets); **`minion`** / **`none`** do not bump security.

### Maps (`content/maps.json`)

- **MapTemplate**: `id`, `name`, `description`, `locationIds` (ordered list of location ids).

### Assets (`content/assets.json`)

- **Asset**: `id`, `name`, optional `description`. Player-facing stackable resources (quantities and consumption are **not** modeled in catalog yet).

### Omega plans (`content/omegaPlans.json`)

- **OmegaPlanTemplate**: `id`, `name`, `description`, **`mapId`** (must match **`MapTemplate.id`**), `stages` — exactly **3** stages, each with **`missionIds` of length 3** (fixed 3×3 grid). Win-path content only; **grid layout** is in JSON. **Runtime progress** lives in **`GameState`**: **`activeOmegaStageIndex`**, **`omegaRowProgress`** (three booleans for the current row), updated when **`executePlan`** marks omega slots successful; advancing the stage resets row flags (see **`gameState.ts`**).

### Organization names (`content/organizationNames.json`)

- JSON **array of strings** (each non-empty). At run start **`createInitialGameState`** picks one at random for **`GameState.organizationName`** (shown at the top of the controls panel). No ids or cross-references.

## Runtime game state (`src/game/gameState.ts`)

Not persisted in JSON; created per session via **`createInitialGameState(catalog)`** (requires **`ContentCatalog`** to roll initial hire offers).

- **`TurnPhase`**: `main` | `resolve` | `summary` — today **`executePlan`** goes **`main` → `summary`** in one step after resolve logic; **`resolve`** is part of the union for forward compatibility. Player acts in **main**; **Next Turn** refills CP, increments turn, returns to **main**.
- **`PlayerState`**: `commandPoints` / `maxCommandPoints` (new game: 5/5; **Next Turn** sets `commandPoints = maxCommandPoints`), `infamy` (0–100, clamped), `minions` (`MinionInstance[]`), `assets` (`Record<assetId, quantity>`), **`maxRosterSize`** (default **5**; hire blocked at cap), **`maxHireOffers`** (default **3**; cap on random offers per resolve), **`maxConcurrentMissions`** (default **2**; assign blocked when active mission count is at cap).
- **`GameState.organizationName`**: display string for the player’s evil organization, chosen once at **`createInitialGameState`** from **`catalog.organizationNames`**.
- **`GameState.activeOmegaPlanId`**: catalog **`OmegaPlanTemplate.id`** for this run, or **`null`** if **`catalog.omegaPlans`** is empty. Chosen once at **`createInitialGameState`** via **`pickRandomOmegaPlanId`**. Shown in the **Omega Plan** panel (three phases, three missions each, names from mission templates). Defines the active **`mapId`** for location scope. **`GameState.activeOmegaStageIndex`** and **`omegaRowProgress`** track which omega **row** must be cleared next; **`executePlan`** sets slot flags when an omega mission in the current stage succeeds and may advance the stage when all three slots succeed.
- **`GameState.activeLairId`** / **`lairMissionIds`**: random lair at run start when **`catalog.lairs`** is non-empty; **`lairMissionIds`** seeds missions assignable with **`missionSource === "lair"`** (see **`assignMission`**).
- **`GameState.locationSecurityStates`**: one **`LocationSecurityState`** per **playable** location this run (same set as **`locationTemplatesForOmegaPlan`**), initialized at security **1**. Shown in the **Locations** panel; **increments on mission resolution** when **`locationIdForMissionSecurity`** applies (see **Locations** above).
- **`GameState.locationAssetSlots`**: **`LocationAssetPlacement[]`** (each **`locationId`** + **`slots`** of **`LocationAssetSlot`**). Initialized in **`createInitialGameState`** only for playable locations: each gets **1–3** distinct random **`catalog.assets`** ids (none if the asset catalog is empty); all slots start **hidden**, then **`min(3, total slots)`** slots are set **revealed**. The Locations panel shows label **Asset** with value **"Asset"** when hidden, or the catalog **name** when revealed.
- **`GameState.availableMinionTemplateIds`**: template ids currently offered for hire. Initialized randomly at game start (excluding templates **already on the roster**) and **rerolled at the end of each `executePlan`** with the same exclusion plus **`pickRandomMinionTemplateIds`**. During **Main Phase**, the player may spend **1 CP** (**`rerollHireOffers`**) to redraw the pool immediately. Hiring removes that template id from the list for the rest of the phase until the next reroll. **`hireMinion`** only accepts ids in this list.
- **`ActiveMission`**: `id`, `missionTemplateId`, **`missionTarget`** (discriminated union, must match template **`targetKind`**): **`{ kind: "location", locationId }`**, **`{ kind: "location_asset", locationId, slotIndex }`** (index into that location’s runtime **`slots`**), **`{ kind: "minion", instanceId }`**, **`{ kind: "none" }`**; **`missionSource`** (`lair` | `omega`), **`omegaStageIndex`** / **`omegaSlotIndex`** (omega only), `participantInstanceIds` (1–3), `turnsRemaining`, **`startedOnTurn`**. Resolve: same infamy / XP / **`mission_completed`** / security rules as before, with security keyed off **`locationIdForMissionSecurity(missionTarget)`**.
- **`GameState.activityLog`**: **`TurnActivityEntry[]`** (each **`turnNumber`** + **`events`**). Main-phase actions append via **`appendActivityEvent`**; **`executePlan`** merges resolve rows with **`mergeResolveActivityEventsIntoActivityLog`**. Newest turn first. **`ActivityEvent`** includes **`mission_completed`**, **`mission_started`**, **`mission_cancelled`** (each with **`missionTarget`**), **`minion_hired`**, **`minion_rehired`**, **`minion_fired`**, **`minion_leveled_up`**, **`asset_gained`**, **`asset_lost`**.

Assignment rules: **`assignMission`** — **`missionTarget.kind`** must equal **`missionTemplate.targetKind`**; **`location`** / **`location_asset`** require a **playable** map location (and for assets a valid **`slotIndex`** on **`locationAssetSlots`**); **`minion`** requires a roster **`instanceId`**, not on another mission, and **not** in **`participantInstanceIds`**; **`none`** skips geographic target. Plus **`missionSource`** (**`lair`** / **`omega`**) checks, CP, 1–3 participants, **`maxConcurrentMissions`**.

## UI / navigation

- Screens: Main (Play, Settings), Settings (Back with return stack from pause vs main), Game (canvas + **game UI layer**: **controls + Activity** (stacked) / **Omega plan + Locations** / **Minions + Assets**; **bottom HUD** for plan actions, turn/phase, and Pause), Pause overlay (Back / Quit / Settings).
- **Game panel** (`index.html`): **organization name**, stats (CP, infamy, active missions **`current / maxConcurrentMissions` missions**). **Plan mission**: **Mission** slot; **Target** slot (**`#assign-target-field`** hidden when mission **`targetKind`** is **`none`**); three minion slots (drag roster minions). **Target** by kind: **`location`** — drag a **location** card; **`location_asset`** — drag an **Asset** row (`<dd>`) from a location card; **`minion`** — drag a roster minion (`instanceId` text); **`none`** — no target. **`assignMission`** receives **`missionTarget`** + participant ids. **Activity** / **HUD** / **Omega** / **Locations** / **Minions** / **Assets** / **Active missions** as before; active mission **Target** row summarizes **`missionTarget`** (and location type/level when a location applies).
- `navigation.ts` wires visibility and **starts/stops** the canvas RAF loop when the game screen is visible and not paused.
- Canvas draws a placeholder “Game” label; rules and economy are driven from the DOM panel, not the canvas.

## Conventions for agents

- Prefer extending **`parseCatalog`** and **`ContentCatalog`** when adding new catalog slices; keep **reference validation** next to Zod shape parsing.
- Keep **designer data** in `content/*.json` and **runtime/progression** in **`gameState.ts`** and related TS modules (`types.ts`, `minion.ts`, `mission.ts`).
- After editing JSON, run **`npm run content:validate`** (or `npm run build`) before assuming content is valid.

## Not implemented yet (non-exhaustive)

- Save/load persistence.
- Using **assets** in mechanics beyond the `PlayerState.assets` map (gains/consumption not wired).
- Changing location asset visibility during play (only initial rollout exists).
- Omega plan activation/progress/win (beyond per-row success and stage index in **`executePlan`**).
- Rich gameplay on canvas beyond placeholder label.
