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
| `src/game/gameState.ts` | Runtime turn loop: **Main → Summary** (resolve runs inside **Execute Plan**), CP/infamy/minions/assets, hire, mission assignment, resolve rolls vs `mission.ts`; on each finished mission: **infamy**, **participant XP/level-ups**, **+1 security at resolved target location when applicable (cap 3)** via **`getMissionTargetLocationId`**, **`activityLog`** events; **`organizationName`** at run start. |
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

- **MissionTemplate**: `id`, `name`, `description`, **`targetType`**: `location` | `asset_hidden` | `asset_revealed` | `minion` | `none` (designer-authored; drives planning UI and **`assignMission`** validation), **`startCommandPoints`** (integer ≥ 0; CP spent when starting the mission in the Main Phase), `requiredTraitIds` (unique set per mission), `durationTurns` (integer ≥ 1).
- **Success chance** (`mission.ts`): union of participating minions’ traits vs required set + optional `additionalRequiredTraitIds`; `Math.round(100 * matched / total)`; participants 1–3 minions.

### Mission targets (runtime + planning UI)

- **`MissionTarget`** (runtime union in `types.ts`, stored on **`ActiveMission.target`**): `location` (`locationId`), `asset` (`locationId`, `slotIndex`, `visibilityAtAssign`), `minion` (`instanceId`), or `none`. Asset targets reference a **`LocationAssetSlot`** row at run time (by index into **`GameState.locationAssetSlots`** for that location).
- **`assignMission`** validates that the chosen **`MissionTarget`** matches the mission template’s **`targetType`** (see **`missionTargetMatchesTemplate`**). **Location** and **asset** targets require a **playable** map location; **asset** also requires the slot to exist and **`visibilityAtAssign`** to match the slot’s current visibility. **Minion** targets must be a roster minion not on another mission and **not** among the participants. **`none`** skips target validation.
- **Security bump** on resolve: **`+1`** (cap **3**) at **`getMissionTargetLocationId(am.target)`** when non-null — i.e. **location-** and **asset-** targeted missions affect that asset’s **location**; **minion** / **none** do not move security by target (see **`executePlan`**).
- **Plan mission UI** (`main.ts`): **Mission** slot and **Target** slot can be filled in any order. The target **label** updates with the mission’s **`targetType`** (e.g. “Target Location”). If **`targetType === "none"`**, the whole target field (**`#assign-target-field`**) is **hidden**. Dropping a mission that **mismatches** the staged target **clears** the target slot (**`reconcileTargetWithMission`**). **Asset** rows on location cards are **draggable chips** (per-slot identity). Roster minion drags use JSON payloads. Putting a minion in **participants** clears the same minion from the **target** slot, and vice versa.

### Locations (`content/locations.json`)

- **LocationTemplate**: `id`, `name`, `description`, `locationType` (`political` | `military` | `economic`), `locationLevel` (1 | 2 | 3), `availableMissionIds`. Per-location **asset placement** is **not** in this JSON; at run start **`createInitialGameState`** assigns **1–3** random catalog assets per **playable** location on the active map (`LocationAssetSlot`: **`assetId`**, **`visibility`** `hidden` | `revealed`), then reveals **`min(3, total slots)`** slots globally at random.
- **LocationSecurityState** (runtime, not in location JSON): `locationId`, `securityLevel` (1 | 2 | 3). For a new run use **`initialLocationSecurityStatesForLocations`** with **`locationTemplatesForOmegaPlan(catalog, activeOmegaPlanId)`** (security **1**). If there is **no** omega plan, playable locations are the **full** catalog. **During play**, whenever a mission **resolves**, if **`getMissionTargetLocationId(am.target)`** is non-null, that location’s **`securityLevel`** increases by **1** up to a **maximum of 3** (`raiseSecurityAfterMissionAtLocation` in **`gameState.ts`**).

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
- **`GameState.locationSecurityStates`**: one **`LocationSecurityState`** per **playable** location this run (same set as **`locationTemplatesForOmegaPlan`**), initialized at security **1**. Shown in the **Locations** panel; **increments on mission resolution** when the resolved mission’s target maps to that location (see **Mission targets**).
- **`GameState.locationAssetSlots`**: **`LocationAssetPlacement[]`** (each **`locationId`** + **`slots`** of **`LocationAssetSlot`**). Initialized in **`createInitialGameState`** only for playable locations: each gets **1–3** distinct random **`catalog.assets`** ids (none if the asset catalog is empty); all slots start **hidden**, then **`min(3, total slots)`** slots are set **revealed**. The Locations panel shows label **Asset** with value **"Asset"** when hidden, or the catalog **name** when revealed; in **Main Phase**, each asset row is a **draggable chip** for targeting (`main.ts`).
- **`GameState.availableMinionTemplateIds`**: template ids currently offered for hire. Initialized randomly at game start (excluding templates **already on the roster**) and **rerolled at the end of each `executePlan`** with the same exclusion plus **`pickRandomMinionTemplateIds`**. During **Main Phase**, the player may spend **1 CP** (**`rerollHireOffers`**) to redraw the pool immediately. Hiring removes that template id from the list for the rest of the phase until the next reroll. **`hireMinion`** only accepts ids in this list.
- **`ActiveMission`**: `id`, `missionTemplateId`, **`target`** (**`MissionTarget`**), **`missionSource`** (`lair` | `omega`), **`omegaStageIndex`** / **`omegaSlotIndex`** (set when source is omega), `participantInstanceIds` (1–3), `turnsRemaining` (starts at `MissionTemplate.durationTurns`), **`startedOnTurn`**. Missions tick **only** when the player executes the plan: each active mission decrements `turnsRemaining`; at **0**, success is rolled vs **`successChancePercent`** (`mission.ts`) using the UI’s RNG (currently `Math.random()` passed into **`executePlan`**); outcome adjusts infamy (−3 success / +5 failure in the current rules). The same tick applies **participant XP** (and possible **level-ups** + **`minion_leveled_up`** events), **+1 security** at the **resolved target location** when **`getMissionTargetLocationId(am.target)`** is set (cap **3**), and **`mission_completed`** logging.
- **`GameState.activityLog`**: **`TurnActivityEntry[]`** (each **`turnNumber`** + **`events`**). Main-phase actions append via **`appendActivityEvent`**; **`executePlan`** batches resolve outcomes with **`mergeResolveActivityEventsIntoActivityLog`**: **`mission_completed`** rows (with **`target: MissionTarget`**) plus any **`minion_leveled_up`** rows (and other **`ActivityEvent`** kinds as features grow). New turn buckets are **prepended** so the **Activity** panel shows **newest turn first**; the log is **not** cleared on **Next Turn** (session-only persistence until save/load exists). **`ActivityEvent`** union includes at least: `mission_completed`, `mission_started`, `mission_cancelled` (each carries **`target`**), `minion_hired`, `minion_rehired`, `minion_fired`, `minion_leveled_up` (`instanceId`, `templateId`, `newLevel`, optional `traitId`), `asset_gained`, `asset_lost`.

Assignment rules: enforced in **`assignMission`** — **`missionTemplate.targetType`** must match the provided **`MissionTarget`**; **playable** location scope for **location** / **asset** targets (**`activeLocationIds`**); **`missionSource`** **`lair`**: mission id in **`GameState.lairMissionIds`**, omega indices null; **`omega`**: active plan, **`activeOmegaStageIndex`**, and mission id must match **`omegaSlotMissionId`** for the chosen slot; sufficient **`startCommandPoints`**; **1–3** participants not already on a mission; target minion not in participant list; **`activeMissions.length < maxConcurrentMissions`**.

## UI / navigation

- Screens: Main (Play, Settings), Settings (Back with return stack from pause vs main), Game (canvas + **game UI layer**: **controls + Activity** (stacked) / **Omega plan + Locations** / **Minions + Assets**; **bottom HUD** for plan actions, turn/phase, and Pause), Pause overlay (Back / Quit / Settings).
- **Game panel** (`index.html`): **organization name** at the top (from **`GameState.organizationName`**), then stats (CP, infamy, active missions count as **`current / maxConcurrentMissions` missions** in the UI summary), **Plan mission**: **Mission** slot (drag from Omega / Lair) and **Target** slot (drag **location** card, **asset** chip on a location, or **minion** from roster — JSON drag payloads); dynamic **target** label and **hidden** target field when **`targetType === "none"`**; **three** participant slots—drag from **roster**, **×** to clear; **`assignMission`** receives **`MissionTarget`**. **Activity panel**: includes **`mission_completed`** / **`mission_started`** / **`mission_cancelled`** text derived from **`MissionTarget`**. **Omega column**: **Locations** show draggable **asset** chips per slot in Main Phase. **Active missions** tab shows a **Target** summary string per **`ActiveMission.target`**.
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
