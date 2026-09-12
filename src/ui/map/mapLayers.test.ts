import { describe, expect, it } from "vitest";
import {
  MAP_LAYERS_STORAGE_KEY,
  MAP_LAYER_DEFAULTS,
  MAP_LAYER_GROUPS,
  MAP_LAYER_KEYS,
  MAP_LAYER_PLOT_CLASSES,
  MAP_OVERLAY_SCALE_DEFAULT,
  MAP_OVERLAY_SCALE_MAX,
  MAP_OVERLAY_SCALE_MIN,
  MAP_OVERLAY_SCALE_STORAGE_KEY,
  clampMapOverlayScale,
  loadMapLayers,
  loadMapOverlayScale,
  mapLayerPlotClasses,
  normalizeMapLayers,
  saveMapLayers,
  saveMapOverlayScale,
  type MapLayerState,
  type MapLayerStorage,
} from "./mapLayers";

function fakeStorage(seed: Record<string, string> = {}): MapLayerStorage & {
  readonly written: Record<string, string>;
} {
  const written: Record<string, string> = { ...seed };
  return {
    written,
    getItem: (key) => written[key] ?? null,
    setItem: (key, value) => {
      written[key] = value;
    },
  };
}

function throwingStorage(): MapLayerStorage {
  return {
    getItem: () => {
      throw new Error("storage disabled");
    },
    setItem: () => {
      throw new Error("storage disabled");
    },
  };
}

describe("map layer defaults", () => {
  it("opens with every site at full strength", () => {
    // The panel dims sites; nothing about opening the game should.
    expect(MAP_LAYER_DEFAULTS.political).toBe(true);
    expect(MAP_LAYER_DEFAULTS.economic).toBe(true);
    expect(MAP_LAYER_DEFAULTS.military).toBe(true);
  });

  it("keeps the four per-pin text overlays off", () => {
    expect(MAP_LAYER_DEFAULTS.names).toBe(false);
    expect(MAP_LAYER_DEFAULTS.intel).toBe(false);
    expect(MAP_LAYER_DEFAULTS.security).toBe(false);
    expect(MAP_LAYER_DEFAULTS.level).toBe(false);
  });

  it("offers every key exactly once across the groups", () => {
    expect(MAP_LAYER_KEYS).toHaveLength(new Set(MAP_LAYER_KEYS).size);
    expect([...MAP_LAYER_KEYS].sort()).toEqual(Object.keys(MAP_LAYER_DEFAULTS).sort());
  });

  it("gives the site rows a swatch and the overlay rows none", () => {
    const [sites, overlays] = MAP_LAYER_GROUPS;
    expect(sites!.options.every((o) => o.swatch !== undefined)).toBe(true);
    expect(overlays!.options.every((o) => o.swatch === undefined)).toBe(true);
  });
});

describe("normalizeMapLayers", () => {
  it("falls back to the defaults for anything that is not an object", () => {
    expect(normalizeMapLayers(null)).toEqual(MAP_LAYER_DEFAULTS);
    expect(normalizeMapLayers("names")).toEqual(MAP_LAYER_DEFAULTS);
    expect(normalizeMapLayers(7)).toEqual(MAP_LAYER_DEFAULTS);
  });

  it("keeps the booleans it recognises and defaults the rest", () => {
    // A build that adds a layer must open it at its default, not at off.
    expect(normalizeMapLayers({ military: false, names: true })).toEqual({
      ...MAP_LAYER_DEFAULTS,
      military: false,
      names: true,
    });
  });

  it("ignores unknown keys and non-boolean values", () => {
    expect(normalizeMapLayers({ nonsense: true, omega: "yes" })).toEqual(MAP_LAYER_DEFAULTS);
  });
});

describe("map layer storage", () => {
  it("round-trips a state", () => {
    const storage = fakeStorage();
    const layers: MapLayerState = { ...MAP_LAYER_DEFAULTS, economic: false, intel: true };
    saveMapLayers(storage, layers);
    expect(storage.written[MAP_LAYERS_STORAGE_KEY]).toBeDefined();
    expect(loadMapLayers(storage)).toEqual(layers);
  });

  it("reads the defaults when nothing is parked", () => {
    expect(loadMapLayers(fakeStorage())).toEqual(MAP_LAYER_DEFAULTS);
  });

  it("survives unparsable storage", () => {
    expect(loadMapLayers(fakeStorage({ [MAP_LAYERS_STORAGE_KEY]: "{not json" }))).toEqual(
      MAP_LAYER_DEFAULTS,
    );
  });

  it("survives storage that throws, in both directions", () => {
    // Private-mode browsers throw on access rather than returning null.
    expect(loadMapLayers(throwingStorage())).toEqual(MAP_LAYER_DEFAULTS);
    expect(() => saveMapLayers(throwingStorage(), MAP_LAYER_DEFAULTS)).not.toThrow();
  });

  it("treats a missing storage as no storage", () => {
    expect(loadMapLayers(null)).toEqual(MAP_LAYER_DEFAULTS);
    expect(() => saveMapLayers(null, MAP_LAYER_DEFAULTS)).not.toThrow();
  });
});

describe("mapLayerPlotClasses", () => {
  it("says nothing about a category that is on", () => {
    expect(mapLayerPlotClasses(MAP_LAYER_DEFAULTS)).not.toContain("map-plot--dim-political");
  });

  it("marks the categories that are off", () => {
    const classes = mapLayerPlotClasses({
      ...MAP_LAYER_DEFAULTS,
      political: false,
      military: false,
    });
    expect(classes).toContain("map-plot--dim-political");
    expect(classes).toContain("map-plot--dim-military");
    expect(classes).not.toContain("map-plot--dim-economic");
  });

  it("marks the overlays that are on", () => {
    const classes = mapLayerPlotClasses({
      ...MAP_LAYER_DEFAULTS,
      names: true,
      intel: true,
      security: false,
      omega: false,
      assets: false,
    });
    expect(classes).toContain("map-plot--names");
    expect(classes).toContain("map-plot--intel");
    expect(classes).not.toContain("map-plot--security");
    expect(classes).not.toContain("map-plot--omega");
    expect(classes).not.toContain("map-plot--assets");
  });

  it("only ever emits classes the plot knows how to clear", () => {
    // renderMapPanel wipes MAP_LAYER_PLOT_CLASSES before re-applying; a class outside that
    // list would stick to the plot forever.
    const everythingOff: MapLayerState = {
      political: false,
      economic: false,
      military: false,
      names: true,
      intel: true,
      security: true,
      level: true,
      omega: true,
      assets: true,
    };
    for (const cls of mapLayerPlotClasses(everythingOff)) {
      expect(MAP_LAYER_PLOT_CLASSES).toContain(cls);
    }
    expect(mapLayerPlotClasses(everythingOff)).toHaveLength(MAP_LAYER_PLOT_CLASSES.length);
  });
});

describe("clampMapOverlayScale", () => {
  it("passes values already in range through unchanged", () => {
    expect(clampMapOverlayScale(1)).toBe(1);
    expect(clampMapOverlayScale(1.4)).toBe(1.4);
  });

  it("pulls out-of-range values back to the nearest bound", () => {
    expect(clampMapOverlayScale(MAP_OVERLAY_SCALE_MIN - 1)).toBe(MAP_OVERLAY_SCALE_MIN);
    expect(clampMapOverlayScale(MAP_OVERLAY_SCALE_MAX + 1)).toBe(MAP_OVERLAY_SCALE_MAX);
  });

  it("falls back to the default for anything that is not a finite number", () => {
    expect(clampMapOverlayScale(Number.NaN)).toBe(MAP_OVERLAY_SCALE_DEFAULT);
    expect(clampMapOverlayScale(Number.POSITIVE_INFINITY)).toBe(MAP_OVERLAY_SCALE_DEFAULT);
  });
});

describe("map overlay scale storage", () => {
  it("round-trips a value", () => {
    const storage = fakeStorage();
    saveMapOverlayScale(storage, 1.3);
    expect(storage.written[MAP_OVERLAY_SCALE_STORAGE_KEY]).toBeDefined();
    expect(loadMapOverlayScale(storage)).toBe(1.3);
  });

  it("reads the default when nothing is parked", () => {
    expect(loadMapOverlayScale(fakeStorage())).toBe(MAP_OVERLAY_SCALE_DEFAULT);
  });

  it("survives unparsable storage", () => {
    expect(
      loadMapOverlayScale(fakeStorage({ [MAP_OVERLAY_SCALE_STORAGE_KEY]: "not a number" })),
    ).toBe(MAP_OVERLAY_SCALE_DEFAULT);
  });

  it("survives storage that throws, in both directions", () => {
    expect(loadMapOverlayScale(throwingStorage())).toBe(MAP_OVERLAY_SCALE_DEFAULT);
    expect(() => saveMapOverlayScale(throwingStorage(), MAP_OVERLAY_SCALE_DEFAULT)).not.toThrow();
  });

  it("treats a missing storage as no storage", () => {
    expect(loadMapOverlayScale(null)).toBe(MAP_OVERLAY_SCALE_DEFAULT);
    expect(() => saveMapOverlayScale(null, MAP_OVERLAY_SCALE_DEFAULT)).not.toThrow();
  });

  it("clamps a parked value that falls outside the current range", () => {
    expect(
      loadMapOverlayScale(fakeStorage({ [MAP_OVERLAY_SCALE_STORAGE_KEY]: "99" })),
    ).toBe(MAP_OVERLAY_SCALE_MAX);
  });
});
