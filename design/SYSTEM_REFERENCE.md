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
| `src/game/omegaPlan.ts` | Lookups: omega plan by id, mission id at stage/slot indices. |
| `src/navigation.ts` | Menu state machine (main / settings / game / pause overlay). |
| `src/main.ts` | Boot: `loadContent()`, console catalog summary, canvas loop, `initNavigation()`. |

## Content catalog pipeline

1. **Authoring**: Edit JSON under `content/`. Use stable string **`id`** fields for cross-references (lowercase slugs are typical).
2. **Loading (app)**: `loadContent()` in `loadContent.ts` imports JSON and calls **`parseCatalog(traits, minions, missions, locations, maps, assets, omegaPlans)`** (seven arguments, fixed order).
3. **Parsing order inside `parseCatalog`**: Traits first (defines `traitIds`), then minions (trait refs), missions (trait refs), omega plans (mission refs), **assets** (standalone), **locations** (mission refs + optional asset refs on slots), maps (location refs). Returned object is a **`ContentCatalog`** (`types.ts`).

**Cross-reference rules** (enforced in `contentSchema.ts`):

- Minion `startingTraitIds` / `levelUpTraitOrder` → existing trait ids.
- Mission `requiredTraitIds` → traits; unique per mission; at least one required trait per mission.
- Omega plan stage `missionIds` (3×3 grid) → missions; **same mission id may repeat** within a plan.
- Location `availableMissionIds` → missions; no duplicate mission id **within the same location’s list**; **same mission may appear on multiple locations**.
- Location `assetSlots[].assetId` (when present) → assets; slots may omit `assetId` for future pseudo-random fill at game start.
- Map `locationIds` → locations; no duplicate location id **within the same map**; a location may appear on multiple maps.
- Asset ids unique in `assets.json`.

## Domain objects (catalog templates)

Enums in JSON are generally **lowercase** strings (e.g. trait `type`, location `locationType`).

### Traits (`content/traits.json`)

- **Trait**: `id`, `name`, `type`: `status` | `primary` | `secondary`.
- Passive definitions; minions and missions reference trait ids.

### Minions (`content/minions.json`)

- **MinionTemplate**: `id`, `name`, `description`, optional `startingTraitIds`, `levelUpTraitOrder` (ordered trait ids for level-ups).
- **MinionInstance** (runtime, not in JSON): `templateId`, `currentLevel`, `currentExperience`, `traitIds`.
- **Level-up rule** (`minion.ts`): on level up, grant the **first** trait in `levelUpTraitOrder` that the instance does **not** already have.

### Missions (`content/missions.json`)

- **MissionTemplate**: `id`, `name`, `description`, `requiredTraitIds` (unique set per mission), `durationTurns` (integer ≥ 1).
- **Success chance** (`mission.ts`): union of participating minions’ traits vs required set + optional `additionalRequiredTraitIds`; `Math.round(100 * matched / total)`; participants 1–3 minions.

### Locations (`content/locations.json`)

- **LocationTemplate**: `id`, `name`, `description`, `locationType` (`political` | `military` | `economic`), `locationLevel` (1 | 2 | 3), `availableMissionIds`, `assetSlots` (array of `{ assetId?`, `initialState`: `hidden` | `revealed` }`; default `[]` if omitted).
- **LocationSecurityState** (runtime, not in location JSON): `locationId`, `securityLevel` (1 | 2 | 3). Use `initialLocationSecurityStates(catalog)` in `locationCatalog.ts` for a new run default (all start at 1).

### Maps (`content/maps.json`)

- **MapTemplate**: `id`, `name`, `description`, `locationIds` (ordered list of location ids).

### Assets (`content/assets.json`)

- **Asset**: `id`, `name`, optional `description`. Player-facing stackable resources (quantities and consumption are **not** modeled in catalog yet).

### Omega plans (`content/omegaPlans.json`)

- **OmegaPlanTemplate**: `id`, `name`, `description`, `stages` — exactly **3** stages, each with **`missionIds` of length 3** (fixed 3×3 grid). Win-path content only; **which plan is active** and progress are **not** in JSON (future game state).

## UI / navigation

- Screens: Main (Play, Settings), Settings (Back with return stack from pause vs main), Game (canvas + Pause), Pause overlay (Back / Quit / Settings).
- `navigation.ts` wires visibility and **starts/stops** the canvas RAF loop when the game screen is visible and not paused.
- Canvas draws a placeholder “Game” label; no Mastermind rules implemented on canvas yet.

## Conventions for agents

- Prefer extending **`parseCatalog`** and **`ContentCatalog`** when adding new catalog slices; keep **reference validation** next to Zod shape parsing.
- Keep **designer data** in `content/*.json` and **runtime/progression** in TS types and future `GameState`-style modules (not yet present as a single file).
- After editing JSON, run **`npm run content:validate`** (or `npm run build`) before assuming content is valid.

## Not implemented yet (non-exhaustive)

- Save/load, turn loop, mission assignment to locations, minion instance ids, player inventory for assets, pseudo-random asset allocation to location slots, omega plan activation/progress/win, gameplay on canvas beyond placeholder.
