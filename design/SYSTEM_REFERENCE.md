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
| `content/*.json` | Designer-authored catalogs (traits, minions, missions, locations, maps, assets, omega plans). |
| `src/game/types.ts` | Canonical TypeScript types for templates, catalog shape, and some runtime-only types. |
| `src/game/contentSchema.ts` | Zod schemas, cross-reference checks, **`parseCatalog(...)`** entry point. |
| `src/game/loadContent.ts` | Imports all JSON modules and returns `parseCatalog(...)`. |
| `src/game/minion.ts` | Runtime: create minion from template, level-up trait grant (ordered list), add/remove trait. |
| `src/game/mission.ts` | Runtime: participant trait union, mission success % (linear set rule), roster size 1–3. |
| `src/game/locationCatalog.ts` | Lookups: location/map by id, missions for a location, **initial location security** snapshots. |
| `src/game/omegaPlan.ts` | Lookups: omega plan by id, **`pickRandomOmegaPlanId`** for new-run selection, mission id at stage/slot indices. |
| `src/game/gameState.ts` | Runtime turn loop: **Main → Summary** (resolve runs inside **Execute Plan**), CP/infamy/minions/assets, hire, mission assignment, resolve rolls vs `mission.ts`. |
| `src/navigation.ts` | Menu state machine (main / settings / game / pause overlay). |
| `src/main.ts` | Boot: `loadContent()`, game controller (`initGameController`), canvas loop, `initNavigation()`. |

## Content catalog pipeline

1. **Authoring**: Edit JSON under `content/`. Use stable string **`id`** fields for cross-references (lowercase slugs are typical).
2. **Loading (app)**: `loadContent()` in `loadContent.ts` imports JSON and calls **`parseCatalog(traits, minions, missions, locations, maps, assets, omegaPlans)`** (seven arguments, fixed order).
3. **Parsing order inside `parseCatalog`**: Traits first (defines `traitIds`), then minions (trait refs), missions (trait refs), omega plans (mission refs), **assets** (standalone), **locations** (mission refs only), maps (location refs). Returned object is a **`ContentCatalog`** (`types.ts`).

**Cross-reference rules** (enforced in `contentSchema.ts`):

- Minion `startingTraitIds` / `levelUpTraitOrder` → existing trait ids.
- Mission `requiredTraitIds` → traits; unique per mission; at least one required trait per mission.
- Omega plan stage `missionIds` (3×3 grid) → missions; **same mission id may repeat** within a plan.
- Location `availableMissionIds` → missions; no duplicate mission id **within the same location’s list**; **same mission may appear on multiple locations**.
- Map `locationIds` → locations; no duplicate location id **within the same map**; a location may appear on multiple maps.
- Asset ids unique in `assets.json`.

## Domain objects (catalog templates)

Enums in JSON are generally **lowercase** strings (e.g. trait `type`, location `locationType`).

### Traits (`content/traits.json`)

- **Trait**: `id`, `name`, `type`: `status` | `primary` | `secondary`.
- Passive definitions; minions and missions reference trait ids.

### Minions (`content/minions.json`)

- **MinionTemplate**: `id`, `name`, `description`, **`hireCommandPoints`** (integer ≥ 0; CP spent when hiring in the Main Phase), optional `startingTraitIds`, `levelUpTraitOrder` (ordered trait ids for level-ups).
- **MinionInstance** (runtime, not in JSON): **`instanceId`** (stable id for roster and missions), `templateId`, `currentLevel`, `currentExperience`, `traitIds`.
- **Creation** (`minion.ts`): `createMinionFromTemplate(template, instanceId, overrides?)` — callers supply `instanceId` (e.g. `crypto.randomUUID()`).
- **Level-up rule** (`minion.ts`): on level up, grant the **first** trait in `levelUpTraitOrder` that the instance does **not** already have.

### Missions (`content/missions.json`)

- **MissionTemplate**: `id`, `name`, `description`, `requiredTraitIds` (unique set per mission), `durationTurns` (integer ≥ 1).
- **Success chance** (`mission.ts`): union of participating minions’ traits vs required set + optional `additionalRequiredTraitIds`; `Math.round(100 * matched / total)`; participants 1–3 minions.

### Locations (`content/locations.json`)

- **LocationTemplate**: `id`, `name`, `description`, `locationType` (`political` | `military` | `economic`), `locationLevel` (1 | 2 | 3), `availableMissionIds`. Per-location **asset placement** is **not** in this JSON; at run start **`createInitialGameState`** assigns **1–3** random catalog assets per location (`LocationAssetSlot`: **`assetId`**, **`visibility`** `hidden` | `revealed`), then reveals **`min(3, total slots)`** slots globally at random.
- **LocationSecurityState** (runtime, not in location JSON): `locationId`, `securityLevel` (1 | 2 | 3). Use `initialLocationSecurityStates(catalog)` in `locationCatalog.ts` for a new run default (all start at 1).

### Maps (`content/maps.json`)

- **MapTemplate**: `id`, `name`, `description`, `locationIds` (ordered list of location ids).

### Assets (`content/assets.json`)

- **Asset**: `id`, `name`, optional `description`. Player-facing stackable resources (quantities and consumption are **not** modeled in catalog yet).

### Omega plans (`content/omegaPlans.json`)

- **OmegaPlanTemplate**: `id`, `name`, `description`, `stages` — exactly **3** stages, each with **`missionIds` of length 3** (fixed 3×3 grid). Win-path content only; **progress** is **not** in JSON (future game state). **`GameState.activeOmegaPlanId`** picks one plan at random when `createInitialGameState(catalog)` runs (if any plans exist).

## Runtime game state (`src/game/gameState.ts`)

Not persisted in JSON; created per session via **`createInitialGameState(catalog)`** (requires **`ContentCatalog`** to roll initial hire offers).

- **`TurnPhase`**: `main` | `resolve` | `summary` — today **`executePlan`** goes **`main` → `summary`** in one step after resolve logic; **`resolve`** is part of the union for forward compatibility. Player acts in **main**; **Next Turn** refills CP, increments turn, returns to **main**.
- **`PlayerState`**: `commandPoints` / `maxCommandPoints` (new game: 5/5; **Next Turn** sets `commandPoints = maxCommandPoints`), `infamy` (0–100, clamped), `minions` (`MinionInstance[]`), `assets` (`Record<assetId, quantity>`), **`maxRosterSize`** (default **5**; hire blocked at cap), **`maxHireOffers`** (default **3**; cap on random offers per resolve).
- **`GameState.activeOmegaPlanId`**: catalog **`OmegaPlanTemplate.id`** for this run, or **`null`** if **`catalog.omegaPlans`** is empty. Chosen once at **`createInitialGameState`** via **`pickRandomOmegaPlanId`**. Display-only in the **Omega Plan** panel (three phases, three missions each, names from mission templates).
- **`GameState.locationSecurityStates`**: one **`LocationSecurityState`** per catalog location, initialized via **`initialLocationSecurityStates(catalog)`** (security **1**). Shown in the **Locations** panel; gameplay may update these later.
- **`GameState.locationAssetSlots`**: **`LocationAssetPlacement[]`** (each **`locationId`** + **`slots`** of **`LocationAssetSlot`**). Initialized in **`createInitialGameState`**: each location gets **1–3** distinct random **`catalog.assets`** ids (none if the asset catalog is empty); all slots start **hidden**, then **`min(3, total slots)`** slots are set **revealed**. The Locations panel shows label **Asset** with value **"Asset"** when hidden, or the catalog **name** when revealed.
- **`GameState.availableMinionTemplateIds`**: template ids currently offered for hire. Initialized randomly at game start (excluding templates **already on the roster**) and **rerolled at the end of each `executePlan`** with the same exclusion plus **`pickRandomMinionTemplateIds`**. During **Main Phase**, the player may spend **1 CP** (**`rerollHireOffers`**) to redraw the pool immediately. Hiring removes that template id from the list for the rest of the phase until the next reroll. **`hireMinion`** only accepts ids in this list.
- **`ActiveMission`**: `id`, `missionTemplateId`, `locationId`, `participantInstanceIds` (1–3), `turnsRemaining` (starts at `MissionTemplate.durationTurns`). Missions tick **only** when the player executes the plan: each active mission decrements `turnsRemaining`; at **0**, success is rolled vs **`successChancePercent`** (`mission.ts`) with `Math.random()`; outcome adjusts infamy (−3 success / +5 failure in the current rules).
- **`lastResolveResult`**: events for the summary UI until **Next Turn** clears it.

Assignment rules: mission id must appear on the chosen location’s **`availableMissionIds`**; minions cannot be on two active missions at once.

## UI / navigation

- Screens: Main (Play, Settings), Settings (Back with return stack from pause vs main), Game (canvas + **game UI layer**: controls / **Omega plan + Locations** / **Minions** + Pause), Pause overlay (Back / Quit / Settings).
- **Game panel** (`index.html`): stats (phase, turn, CP, infamy, active missions), assign mission (location, mission, minion checkboxes), **Execute Plan**, **Next Turn**; **Resolve summary** when in summary phase (`aria-live` on summary region). **Omega column**: **Omega Plan** (active plan, phases, mission names) and **Locations** (each location’s **type**, **level**, **security**, plus **Asset** rows per slot—hidden slots show **"Asset"**, revealed slots show the catalog asset **name**). **Minions panel**: roster plus **Available to hire** (random offer list from **`executePlan`** or **Reroll** for **1 CP** during Main); **Hire** is Main Phase only and disabled when roster is full, CP is insufficient, or the template is off-offer.
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
- Omega plan activation/progress/win.
- Rich gameplay on canvas beyond placeholder label.
