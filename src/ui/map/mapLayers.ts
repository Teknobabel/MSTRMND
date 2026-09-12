/**
 * What the world map is allowed to draw.
 *
 * The map is the dashboard's background as much as it is a control, and every run adds more to
 * it — fifteen pins, their names, their readouts, the plan's targets, the gear sitting in them.
 * This is the player's say over how much of that is on at once, held as eight independent
 * booleans and nothing else.
 *
 * Two rules shape the whole model:
 *
 * - **Nothing here removes a site.** Turning a category off *dims* its pins; they stay plotted,
 *   stay clickable, and come back to full strength under the pointer. A visibility control that
 *   could hide a mission target would be a control that loses the player a turn.
 * - **Nothing here is state the game reads.** Every layer resolves to a class on the plot, so a
 *   toggle costs one `classList` write rather than a re-render, and the rules never see it.
 */
import type { LocationType } from "../../game/types";

/**
 * One switch on the panel. The three site categories are deliberately named after
 * {@link LocationType} values so a pin's own category indexes straight into the state.
 */
export type MapLayerKey =
  | LocationType
  | "names"
  | "intel"
  | "security"
  | "level"
  | "omega"
  | "assets";

export type MapLayerState = Readonly<Record<MapLayerKey, boolean>>;

/** The site categories, in the order the panel lists them. */
export const SITE_CATEGORY_LAYER_KEYS: readonly LocationType[] = [
  "political",
  "economic",
  "military",
];

/**
 * The opening state: every site at full strength, the overlays that answer a question the
 * player is already asking (what the plan wants next, what is worth stealing) on, and the
 * three that add text to every pin at once off — names, intel, and security readouts are what
 * turn a map into a wall of labels, so they are opt-in.
 */
export const MAP_LAYER_DEFAULTS: MapLayerState = {
  political: true,
  economic: true,
  military: true,
  names: false,
  intel: false,
  security: false,
  level: false,
  omega: true,
  assets: true,
};

export interface MapLayerOption {
  readonly key: MapLayerKey;
  readonly label: string;
  /** Tooltip text; also what the checkbox describes to assistive tech. */
  readonly hint: string;
  /** Site categories carry the pin's own dot colour as a swatch. */
  readonly swatch?: LocationType;
}

export interface MapLayerGroup {
  readonly label: string;
  readonly options: readonly MapLayerOption[];
}

export const MAP_LAYER_GROUPS: readonly MapLayerGroup[] = [
  {
    label: "Sites",
    options: [
      {
        key: "political",
        label: "Political",
        hint: "Dim political sites. They stay on the map and stay selectable.",
        swatch: "political",
      },
      {
        key: "economic",
        label: "Economic",
        hint: "Dim economic sites. They stay on the map and stay selectable.",
        swatch: "economic",
      },
      {
        key: "military",
        label: "Military",
        hint: "Dim military sites. They stay on the map and stay selectable.",
        swatch: "military",
      },
    ],
  },
  {
    label: "Overlays",
    options: [
      {
        key: "names",
        label: "Site names",
        hint: "Show every site's name at all times instead of on hover.",
      },
      {
        key: "omega",
        label: "Omega targets",
        hint: "Flag every site the active Omega phase's missions can be aimed at.",
      },
      {
        key: "level",
        label: "Site level",
        hint: "Show each site's level on its pin.",
      },
      {
        key: "security",
        label: "Security",
        hint: "Show each site's security level on its pin.",
      },
      {
        key: "intel",
        label: "Intel",
        hint: "Show each site's intel level on its pin.",
      },
      {
        key: "assets",
        label: "Revealed assets",
        hint: "Show how many assets the player has identified at each site.",
      },
    ],
  },
];

/** Every key the panel offers, in panel order. */
export const MAP_LAYER_KEYS: readonly MapLayerKey[] = MAP_LAYER_GROUPS.flatMap((g) =>
  g.options.map((o) => o.key),
);

/**
 * Coerce anything — a storage read, a stale shape from an older build — into a usable state.
 * Unknown keys are dropped and missing ones fall back to {@link MAP_LAYER_DEFAULTS}, so a
 * layer added in a later build opens at its default rather than off.
 */
export function normalizeMapLayers(raw: unknown): MapLayerState {
  if (raw === null || typeof raw !== "object") {
    return MAP_LAYER_DEFAULTS;
  }
  const row = raw as Record<string, unknown>;
  const out: Record<string, boolean> = { ...MAP_LAYER_DEFAULTS };
  for (const key of MAP_LAYER_KEYS) {
    const value = row[key];
    if (typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out as MapLayerState;
}

/** Where the panel's state is parked between sessions. Versioned: the key list may grow. */
export const MAP_LAYERS_STORAGE_KEY = "mastermind.mapLayers.v1";

/** The slice of `Storage` this module needs — enough to hand it a fake in a test. */
export interface MapLayerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Read the parked state. A preference is not worth an exception: private-mode storage throws
 * on access in some browsers, and unparsable JSON is just as likely as none, so every failure
 * lands on the defaults.
 */
export function loadMapLayers(storage: MapLayerStorage | null): MapLayerState {
  if (storage === null) {
    return MAP_LAYER_DEFAULTS;
  }
  try {
    const text = storage.getItem(MAP_LAYERS_STORAGE_KEY);
    return text === null ? MAP_LAYER_DEFAULTS : normalizeMapLayers(JSON.parse(text));
  } catch {
    return MAP_LAYER_DEFAULTS;
  }
}

/** Park the state. Silent on failure, for the reasons {@link loadMapLayers} gives. */
export function saveMapLayers(storage: MapLayerStorage | null, layers: MapLayerState): void {
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(MAP_LAYERS_STORAGE_KEY, JSON.stringify(layers));
  } catch {
    /* A preference that cannot be parked is still a preference for this session. */
  }
}

/**
 * How far the Overlays slider can push the size of the per-pin readouts — the name label and
 * the omega/level/security/intel/assets tag rail. Independent of a category being on at all;
 * this only says how big it reads once it is.
 */
export const MAP_OVERLAY_SCALE_MIN = 0.5;
export const MAP_OVERLAY_SCALE_MAX = 2;
export const MAP_OVERLAY_SCALE_STEP = 0.1;
export const MAP_OVERLAY_SCALE_DEFAULT = 1;

/** Where the scale preference is parked between sessions. Its own key: it is not a layer toggle. */
export const MAP_OVERLAY_SCALE_STORAGE_KEY = "mastermind.mapOverlayScale.v1";

/** Pull any input — a slider event, a stale storage read — back into the slider's own range. */
export function clampMapOverlayScale(value: number): number {
  if (!Number.isFinite(value)) {
    return MAP_OVERLAY_SCALE_DEFAULT;
  }
  return Math.min(MAP_OVERLAY_SCALE_MAX, Math.max(MAP_OVERLAY_SCALE_MIN, value));
}

/** Read the parked scale. Same failure handling as {@link loadMapLayers}: a preference is not
 * worth an exception. */
export function loadMapOverlayScale(storage: MapLayerStorage | null): number {
  if (storage === null) {
    return MAP_OVERLAY_SCALE_DEFAULT;
  }
  try {
    const text = storage.getItem(MAP_OVERLAY_SCALE_STORAGE_KEY);
    if (text === null) {
      return MAP_OVERLAY_SCALE_DEFAULT;
    }
    const parsed = Number.parseFloat(text);
    return clampMapOverlayScale(parsed);
  } catch {
    return MAP_OVERLAY_SCALE_DEFAULT;
  }
}

/** Park the scale. Silent on failure, for the reasons {@link loadMapLayers} gives. */
export function saveMapOverlayScale(storage: MapLayerStorage | null, scale: number): void {
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(MAP_OVERLAY_SCALE_STORAGE_KEY, String(scale));
  } catch {
    /* A preference that cannot be parked is still a preference for this session. */
  }
}

/**
 * Every class this module can put on the plot. `renderMapPanel` clears the lot before applying
 * {@link mapLayerPlotClasses}, so the list has to stay exhaustive.
 */
export const MAP_LAYER_PLOT_CLASSES: readonly string[] = [
  ...SITE_CATEGORY_LAYER_KEYS.map((t) => `map-plot--dim-${t}`),
  "map-plot--names",
  "map-plot--intel",
  "map-plot--security",
  "map-plot--level",
  "map-plot--omega",
  "map-plot--assets",
];

/**
 * The classes the plot carries for `layers`.
 *
 * Note the inversion on the categories: the class marks what is **off**, because the common
 * state is everything on and a rule that fires on the exception is the cheaper one to read —
 * both for the browser and for anyone opening the stylesheet.
 */
export function mapLayerPlotClasses(layers: MapLayerState): string[] {
  const classes: string[] = [];
  for (const type of SITE_CATEGORY_LAYER_KEYS) {
    if (!layers[type]) {
      classes.push(`map-plot--dim-${type}`);
    }
  }
  if (layers.names) {
    classes.push("map-plot--names");
  }
  if (layers.intel) {
    classes.push("map-plot--intel");
  }
  if (layers.security) {
    classes.push("map-plot--security");
  }
  if (layers.level) {
    classes.push("map-plot--level");
  }
  if (layers.omega) {
    classes.push("map-plot--omega");
  }
  if (layers.assets) {
    classes.push("map-plot--assets");
  }
  return classes;
}
