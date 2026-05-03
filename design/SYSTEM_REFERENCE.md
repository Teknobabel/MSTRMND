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
| `content/*.json` | Designer-authored catalogs (traits, minions, missions, locations, maps, assets, omega plans, **lairs**, organization names). |
| `src/game/types.ts` | Canonical TypeScript types for templates, catalog shape, and some runtime-only types. |
| `src/game/contentSchema.ts` | Zod schemas, cross-reference checks, **`parseCatalog(...)`** entry point. |
| `src/game/loadContent.ts` | Imports all JSON modules and returns `parseCatalog(...)`. |
| `src/game/minion.ts` | Runtime: create minion from template; **mission XP → level-up** (`awardMissionResolutionExperience`, constants `MINION_XP_PER_MISSION` / `MINION_XP_TO_LEVEL`); ordered trait grant on level (`applyLevelUp` / `nextLevelUpTraitId`); add/remove trait. |
| `src/game/mission.ts` | Runtime: participant trait union, **`MissionSuccessOptions`** (extra traits + **`playerAssets`**), linear **success %** from matched **traits** + matched **asset units** vs total slots; **`mergedRequiredTraitIdsSorted`**, **`countMultiset`**, **`matchedAssetUnits`**; roster size 1–**`player.maxParticipantsPerMission`** (default 3) via **`canAssignParticipants`**. |
| `src/game/missionEffects.ts` | **`orderedMissionEffects`**, **`applyMissionEffects`**: mission completion effects (reveal/steal asset, infamy, stat caps) after baseline infamy in **`executePlan`**. |
| `src/game/locationCatalog.ts` | **getLocationById**, **getMapById**, **`locationTemplatesForOmegaPlan`**, **`activeLocationIds`**, **`initialLocationSecurityStatesForLocations`**, **`maxSecurityLevelForLocation`**, **`rollLocationRequiredTraits`**, **`rollLocationSecurityTraits`**. |
| `src/game/omegaPlan.ts` | Lookups: omega plan by id, **`pickRandomOmegaPlanId`** for new-run selection, mission id at stage/slot indices. |
| `src/game/gameState.ts` | Runtime turn loop: **Main → Summary** (resolve runs inside **Execute Plan**), CP/infamy/minions/assets, hire, mission assignment, resolve rolls vs **`mission.ts`** (traits + assets + location modifiers); **`missionSuccessOptionsForTarget`**, **`revealedSecurityTraitIds`**, **`setLocationSecurityLevel`**; on each finished mission: **baseline + effect infamy**, **`applyMissionEffects`** (reveal/steal/stat deltas), **participant XP/level-ups**, **+1 security** at resolved target (**cap = that location’s `locationLevel`**) via **`getMissionTargetLocationId`**; **`activityLog`**; **`organizationName`** at run start. |
| `src/navigation.ts` | Menu state machine (main / settings / game / pause overlay). |
| `src/main.ts` | Boot: `loadContent()`, game controller (`initGameController`), canvas loop, `initNavigation()`. |

## Content catalog pipeline

1. **Authoring**: Edit JSON under `content/`. Use stable string **`id`** fields for cross-references (lowercase slugs are typical).
2. **Loading (app)**: `loadContent()` in `loadContent.ts` imports JSON and calls **`parseCatalog(traits, minions, missions, locations, maps, assets, omegaPlans, lairs, organizationNames)`** (**nine** arguments, fixed order).
3. **Parsing order inside `parseCatalog`**: The function is invoked with the same argument order as **`loadContent`**. **Logical parse / validation order** is: **Traits** (defines `traitIds`) → **minions** (trait refs) → **assets** (defines `assetIds`) → **missions** (trait + asset refs) → **locations** → **maps** (location refs) → **omega plans** (mission refs + **`mapId`**) → **lairs** (mission refs + optional `startingAssets` asset refs) → **organization names** (standalone array). Returned object is a **`ContentCatalog`** (`types.ts`).

**Cross-reference rules** (enforced in `contentSchema.ts`):

- Minion `startingTraitIds` / `levelUpTraitOrder` → existing trait ids.
- Mission **`requiredTraitIds`** → traits; **unique** per mission. Mission **`requiredAssetIds`** → assets; **duplicates allowed** (each occurrence needs one inventory unit). **At least one** of `requiredTraitIds` or `requiredAssetIds` must be non-empty per mission. Missions with **`reveal_target_asset`** or **`steal_target_asset`** in **`onSuccessEffects`** / **`onFailureEffects`** must use **`targetType`** `asset_hidden` or `asset_revealed`.
- Omega plan **`mapId`** → **`MapTemplate.id`**; omega plans parsed **after** maps.
- Omega plan stage `missionIds` (3×3 grid) → missions; **same mission id may repeat** within a plan.
- **Lair** `availableMissionIds` → missions; no duplicate mission id **within the same lair**; **`startingAssets`** keys → asset ids.
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

- **MissionTemplate**: `id`, `name`, `description`, **`targetType`**: `location` | `asset_hidden` | `asset_revealed` | `minion` | `none`, **`startCommandPoints`** (≥ 0), **`requiredTraitIds`** (unique trait ids; may be empty if assets carry the requirement), **`requiredAssetIds`** (catalog asset ids; **multiset** — duplicate ids mean multiple units needed from **`PlayerState.assets`**), **`durationTurns`** (≥ 1), optional **`onSuccessEffects`** / **`onFailureEffects`**: arrays of **`MissionEffect`** (applied in order when a mission resolves; see **`missionEffects.ts`**). **`MissionEffect`** `kind` values: `reveal_target_asset`, `steal_target_asset`, `infamy_delta` (`amount`), `max_concurrent_missions_delta`, `max_roster_size_delta`, `max_hire_offers_delta`, `max_participants_per_mission_delta`, `max_command_points_per_turn_delta` (each with signed integer **`delta`** except infamy). Baseline infamy (−3 / +5) applies first, then effect deltas; **`infamy_delta`** effects **add**; final infamy is clamped 0–100. **`reveal_target_asset`** runs before **`steal_target_asset`** when both are present (stable reorder inside **`orderedMissionEffects`**). Steal leaves an **`empty`** slot at the same index.
- **Success chance** (`mission.ts` + callers): **`successChancePercent(template, participants, options?)`** where **`MissionSuccessOptions`** may include **`additionalRequiredTraitIds`** (from **`missionSuccessOptionsForTarget`** in `gameState.ts`: site **required** traits + **revealed** security traits for the mission’s target location) and **`playerAssets`** (current inventory snapshot). Numerator = matched **distinct** required traits (participant union) + matched **asset units** (per-id `min(requiredCount, quantity)` summed); denominator = trait count + **asset occurrence count**; `Math.round(100 * matched / total)`; empty denominator → 100%. Participants: 1–**`maxParticipantsPerMission`** minions.

### Mission targets (runtime + planning UI)

- **`MissionTarget`** (runtime union in `types.ts`, stored on **`ActiveMission.target`**): `location` (`locationId`), `asset` (`locationId`, `slotIndex`, `visibilityAtAssign`), `minion` (`instanceId`), or `none`. Asset targets reference a **`LocationAssetSlot`** row at run time (by index into **`GameState.locationAssetSlots`** for that location).
- **`assignMission`** validates that the chosen **`MissionTarget`** matches the mission template’s **`targetType`** (see **`missionTargetMatchesTemplate`**). **Location** and **asset** targets require a **playable** map location; **asset** also requires the slot to exist, to be **`occupied`** (not **`empty`**), and **`visibilityAtAssign`** to match the slot’s current visibility. **Minion** targets must be a roster minion not on another mission and **not** among the participants. **`none`** skips target validation.
- **Security bump** on resolve: **`+1`** at **`getMissionTargetLocationId(am.target)`** when non-null, capped at **`maxSecurityLevelForLocation`** = that site’s authored **`locationLevel`** (1–3), not a global 3 for all sites. **Location**- and **asset**-targeted missions affect that asset’s **location**; **minion** / **none** do not change security by target (`raiseSecurityAfterMissionAtLocation` in **`gameState.ts`**). **`setLocationSecurityLevel(state, catalog, locationId, level)`** clamps security for future systems that lower heat; revealed security traits follow **`securityLevel`** (see **Runtime game state**).
- **Plan mission UI** (`main.ts`): **Mission** slot and **Target** slot can be filled in any order. The target **label** updates with the mission’s **`targetType`** (e.g. “Target Location”). If **`targetType === "none"`**, the whole target field (**`#assign-target-field`**) is **hidden**. Dropping a mission that **mismatches** the staged target **clears** the target slot (**`reconcileTargetWithMission`**). **Asset** rows on location cards are **draggable chips** (per-slot identity). Roster minion drags use JSON payloads. Putting a minion in **participants** clears the same minion from the **target** slot, and vice versa.

### Locations (`content/locations.json`)

- **LocationTemplate**: `id`, `name`, `description`, `locationType` (`political` | `military` | `economic`), **`locationLevel`** (1 | 2 | 3). Per-location **asset placement** is **not** in this JSON; at run start **`createInitialGameState`** assigns **1–3** random catalog assets per **playable** location on the active map (`LocationAssetSlot`: **`kind`** `occupied` with **`assetId`** + **`visibility`** `hidden` | `revealed`, or **`kind`** `empty` after a steal), then reveals **`min(3, total slots)`** slots globally at random.
- **LocationSecurityState** (runtime): `locationId`, **`securityLevel`** (`0` | `1` | `2` | `3`). New runs start at **`0`** via **`initialLocationSecurityStatesForLocations`**. Effective maximum per site is the location’s **`locationLevel`** (enforced when raising security). **During play**, each resolved mission at that site (via **`getMissionTargetLocationId`**) increments security by **1** up to that cap.
- **Per-run site traits** (runtime, `GameState`): **`locationRequiredTraits`**: rolled at run start from non-status traits — level **1** → 0 traits, level **2** → 1, level **3** → 2. **`locationSecurityTraits`**: rolled stack of length **`locationLevel`** (reveal order = array order); only the first **`securityLevel`** entries merge into mission requirements (hidden entries do not). Both merge into **`missionSuccessOptionsForTarget`** for **location**/**asset** targets (see **`revealedSecurityTraitIds`**).

### Maps (`content/maps.json`)

- **MapTemplate**: `id`, `name`, `description`, `locationIds` (ordered list of location ids).

### Assets (`content/assets.json`)

- **Asset**: `id`, `name`, optional `description`. Referenced by **missions** (`requiredAssetIds`), **lairs** (`startingAssets`), and **player inventory** **`PlayerState.assets`** (`Record<assetId, quantity>`). **Mission success** and **mission / assign UI** consume **`player.assets`** when computing **`successChancePercent`**.

### Lairs (`content/lairs.json`)

- **LairTemplate**: `id`, `name`, optional `description`, **`availableMissionIds`** (missions assignable with **`missionSource === "lair"`**; no duplicate ids per lair), optional **`startingAssets`** (`Record<assetId, quantity>` merged into **`PlayerState.assets`** at run start). **`GameState.activeLairId`** + **`lairMissionIds`** are seeded from a random lair when the catalog is non-empty.

### Omega plans (`content/omegaPlans.json`)

- **OmegaPlanTemplate**: `id`, `name`, `description`, **`mapId`** (must match **`MapTemplate.id`**), `stages` — exactly **3** stages, each with **`missionIds` of length 3** (fixed 3×3 grid). Win-path content only; **grid layout** is in JSON. **Runtime progress** lives in **`GameState`**: **`activeOmegaStageIndex`**, **`omegaRowProgress`** (three booleans for the current row), updated when **`executePlan`** marks omega slots successful; advancing the stage resets row flags (see **`gameState.ts`**).

### Organization names (`content/organizationNames.json`)

- JSON **array of strings** (each non-empty). At run start **`createInitialGameState`** picks one at random for **`GameState.organizationName`** (shown at the top of the controls panel). No ids or cross-references.

## Runtime game state (`src/game/gameState.ts`)

Not persisted in JSON; created per session via **`createInitialGameState(catalog)`** (requires **`ContentCatalog`** to roll initial hire offers).

- **`TurnPhase`**: `main` | `resolve` | `summary` — today **`executePlan`** goes **`main` → `summary`** in one step after resolve logic; **`resolve`** is part of the union for forward compatibility. Player acts in **main**; **Next Turn** refills CP, increments turn, returns to **main**.
- **`PlayerState`**: `commandPoints` / `maxCommandPoints` (new game: 5/5; **Next Turn** sets `commandPoints = maxCommandPoints`), `infamy` (0–100, clamped), `minions` (`MinionInstance[]`), `assets` (`Record<assetId, quantity>`), **`maxRosterSize`** (default **5**; hire blocked at cap), **`maxHireOffers`** (default **3**; cap on random offers per resolve), **`maxConcurrentMissions`** (default **2**; assign blocked when active mission count is at cap; may exceed current active count after a decrease until missions finish), **`maxParticipantsPerMission`** (default **3**; assign UI and **`canAssignParticipants`** cap).
- **`GameState.organizationName`**: display string for the player’s evil organization, chosen once at **`createInitialGameState`** from **`catalog.organizationNames`**.
- **`GameState.activeOmegaPlanId`**: catalog **`OmegaPlanTemplate.id`** for this run, or **`null`** if **`catalog.omegaPlans`** is empty. Chosen once at **`createInitialGameState`** via **`pickRandomOmegaPlanId`**. Shown in the **Omega Plan** panel (three phases, three missions each, names from mission templates). Defines the active **`mapId`** for location scope. **`GameState.activeOmegaStageIndex`** and **`omegaRowProgress`** track which omega **row** must be cleared next; **`executePlan`** sets slot flags when an omega mission in the current stage succeeds and may advance the stage when all three slots succeed.
- **`GameState.activeLairId`** / **`lairMissionIds`**: random lair at run start when **`catalog.lairs`** is non-empty; **`lairMissionIds`** seeds missions assignable with **`missionSource === "lair"`** (see **`assignMission`**).
- **`GameState.locationSecurityStates`**: one **`LocationSecurityState`** per **playable** location this run, initialized at security **`0`**. Shown in the **Locations** panel; **increments on mission resolution** when the resolved mission’s target maps to that location, capped by **`locationLevel`** (see **Locations**).
- **`GameState.locationRequiredTraits`** / **`locationSecurityTraits`**: `Record<locationId, string[]>` — rolled in **`createInitialGameState`** for playable locations only; merged into **`missionSuccessOptionsForTarget`** for mission success and UI when the target has a location id (**`revealedSecurityTraitIds`** applies the security stack slice).
- **`GameState.locationAssetSlots`**: **`LocationAssetPlacement[]`** (each **`locationId`** + **`slots`** of **`LocationAssetSlot`**). Initialized in **`createInitialGameState`** only for playable locations: each gets **1–3** distinct random **`catalog.assets`** ids (none if the asset catalog is empty); all slots start **occupied** and **hidden**, then **`min(3, total slots)`** slots are set **revealed**. The Locations panel shows label **Asset** with value **"Asset"** when hidden, catalog **name** when **occupied** and **revealed**, or **"—"** when **`empty`**; in **Main Phase**, **occupied** rows are **draggable chips** for targeting (`main.ts`).
- **`GameState.availableMinionTemplateIds`**: template ids currently offered for hire. Initialized randomly at game start (excluding templates **already on the roster**) and **rerolled at the end of each `executePlan`** with the same exclusion plus **`pickRandomMinionTemplateIds`**. During **Main Phase**, the player may spend **1 CP** (**`rerollHireOffers`**) to redraw the pool immediately. Hiring removes that template id from the list for the rest of the phase until the next reroll. **`hireMinion`** only accepts ids in this list.
- **`ActiveMission`**: `id`, `missionTemplateId`, **`target`** (**`MissionTarget`**), **`missionSource`** (`lair` | `omega`), **`omegaStageIndex`** / **`omegaSlotIndex`** (set when source is omega), `participantInstanceIds` (1–**`maxParticipantsPerMission`**), `turnsRemaining` (starts at `MissionTemplate.durationTurns`), **`startedOnTurn`**. Missions tick **only** when the player executes the plan: each active mission decrements `turnsRemaining`; at **0**, success is rolled vs **`successChancePercent`** with **`missionSuccessOptionsForTarget(state, target)`** plus **`playerAssets: player.assets`** (`mission.ts` + **`executePlan`** in **`gameState.ts`**); baseline infamy (−3 success / +5 failure) is applied, then **`onSuccessEffects`** or **`onFailureEffects`** from the template via **`applyMissionEffects`** (**`missionEffects.ts`**). **`mission_completed`** logs **`infamyDelta`** = total infamy change (baseline + effect **`infamy_delta`** entries, clamped). The same tick applies **participant XP** (and possible **level-ups** + **`minion_leveled_up`** events), **+1 security** at the resolved target location when **`getMissionTargetLocationId(am.target)`** is set (per-location cap), **`asset_gained`** when a steal effect fires, and **`mission_completed`** logging.
- **`GameState.activityLog`**: **`TurnActivityEntry[]`** (each **`turnNumber`** + **`events`**). Main-phase actions append via **`appendActivityEvent`**; **`executePlan`** batches resolve outcomes with **`mergeResolveActivityEventsIntoActivityLog`**: **`mission_completed`** rows (with **`target: MissionTarget`**) plus any **`minion_leveled_up`** rows (and other **`ActivityEvent`** kinds as features grow). New turn buckets are **prepended** so the **Activity** panel shows **newest turn first**; the log is **not** cleared on **Next Turn** (session-only persistence until save/load exists). **`ActivityEvent`** union includes at least: `mission_completed`, `mission_started`, `mission_cancelled` (each carries **`target`**), `minion_hired`, `minion_rehired`, `minion_fired`, `minion_leveled_up` (`instanceId`, `templateId`, `newLevel`, optional `traitId`), `asset_gained`, `asset_lost`.

Assignment rules: enforced in **`assignMission`** — **`missionTemplate.targetType`** must match the provided **`MissionTarget`**; **playable** location scope for **location** / **asset** targets (**`activeLocationIds`**); **`missionSource`** **`lair`**: mission id in **`GameState.lairMissionIds`**, omega indices null; **`omega`**: active plan, **`activeOmegaStageIndex`**, and mission id must match **`omegaSlotMissionId`** for the chosen slot; sufficient **`startCommandPoints`**; **1–`maxParticipantsPerMission`** participants not already on a mission; target minion not in participant list; **`activeMissions.length < maxConcurrentMissions`**.

## UI / navigation

- Screens: Main (Play, Settings), Settings (Back with return stack from pause vs main), Game (canvas + **game UI layer**: **controls + Activity** (stacked) / **Omega plan + Locations** / **Minions + Assets**; **bottom HUD** for plan actions, turn/phase, and Pause), Pause overlay (Back / Quit / Settings).
- **Game panel** (`index.html`): **organization name** at the top (from **`GameState.organizationName`**), then stats (CP, infamy, active missions count as **`current / maxConcurrentMissions` missions** in the UI summary), **Plan mission**: **Mission** slot (drag from Omega / Lair) and **Target** slot (drag **location** card, **asset** chip on a location, or **minion** from roster — JSON drag payloads); dynamic **target** label and **hidden** target field when **`targetType === "none"`**; participant slots (count = **`maxParticipantsPerMission`**, up to UI capacity 12)—drag from **roster**, **×** to clear; **`assignMission`** receives **`MissionTarget`**. **Activity panel**: includes **`mission_completed`** / **`mission_started`** / **`mission_cancelled`** text derived from **`MissionTarget`**. **Omega column**: **Locations** show **Site traits**, **Security traits** (revealed vs hidden), security **level**, and draggable **asset** chips per **occupied** slot in Main Phase. **Active missions** tab shows **Target** summary, **Required traits** / **Required assets**, and **success %** (recomputed on **`refresh()`** using current inventory and site modifiers).
- `navigation.ts` wires visibility and **starts/stops** the canvas RAF loop when the game screen is visible and not paused.
- Canvas draws a placeholder “Game” label; rules and economy are driven from the DOM panel, not the canvas.

## Conventions for agents

- Prefer extending **`parseCatalog`** and **`ContentCatalog`** when adding new catalog slices; keep **reference validation** next to Zod shape parsing.
- Keep **designer data** in `content/*.json` and **runtime/progression** in **`gameState.ts`** and related TS modules (`types.ts`, `minion.ts`, `mission.ts`).
- After editing JSON, run **`npm run content:validate`** (or `npm run build`) before assuming content is valid.

## Not implemented yet (non-exhaustive)

- Save/load persistence.
- **Consuming** or automatically **deducting** assets when missions resolve (inventory is only checked for success % today), except when a mission’s **`steal_target_asset`** effect removes the **location** asset into **`player.assets`**.
- Omega plan activation/progress/win (beyond per-row success and stage index in **`executePlan`**).
- Rich gameplay on canvas beyond placeholder label.
