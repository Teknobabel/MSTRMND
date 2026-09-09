import { describe, expect, it } from "vitest";
import {
  MAP_LAYERS_STORAGE_KEY,
  MAP_LAYER_DEFAULTS,
  MAP_LAYER_GROUPS,
  MAP_LAYER_KEYS,
  MAP_LAYER_PLOT_CLASSES,
  loadMapLayers,
  mapLayerPlotClasses,
  normalizeMapLayers,
  saveMapLayers,
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

  it("keeps the two per-pin text overlays off", () => {
    expect(MAP_LAYER_DEFAULTS.names).toBe(false);
    expect(MAP_LAYER_DEFAULTS.readouts).toBe(false);
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
    const layers: MapLayerState = { ...MAP_LAYER_DEFAULTS, economic: false, readouts: true };
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
      readouts: true,
      omega: false,
      assets: false,
    });
    expect(classes).toContain("map-plot--names");
    expect(classes).toContain("map-plot--readouts");
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
      readouts: true,
      omega: true,
      assets: true,
    };
    for (const cls of mapLayerPlotClasses(everythingOff)) {
      expect(MAP_LAYER_PLOT_CLASSES).toContain(cls);
    }
    expect(mapLayerPlotClasses(everythingOff)).toHaveLength(MAP_LAYER_PLOT_CLASSES.length);
  });
});
