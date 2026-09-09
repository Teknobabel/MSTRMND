import { describe, expect, it } from "vitest";
import mapsJson from "../../../content/maps.json";
import { formatMapCoordinates, mapPointToGeographic } from "./coordinates";

const AUTHORED_MARKERS = mapsJson.flatMap((m) => m.markers ?? []);

describe("mapPointToGeographic", () => {
  it("puts the middle of the map on the equator and the prime meridian", () => {
    // The same two lines the lattice shader picks out. If these disagreed, the readout would be
    // naming a place the graticule draws somewhere else.
    const { latitude, longitude } = mapPointToGeographic(0.5, 0.5);
    expect(latitude).toBeCloseTo(0, 10);
    expect(longitude).toBeCloseTo(0, 10);
  });

  it("runs latitude upward while v runs downward", () => {
    // v is the map's downward axis, so the sign has to flip here. Getting this wrong mirrors the
    // world without moving a single pin, which is exactly the kind of bug nothing else catches.
    expect(mapPointToGeographic(0.5, 0).latitude).toBeCloseTo(90, 10);
    expect(mapPointToGeographic(0.5, 1).latitude).toBeCloseTo(-90, 10);
    expect(mapPointToGeographic(0, 0.5).longitude).toBeCloseTo(-180, 10);
    expect(mapPointToGeographic(1, 0.5).longitude).toBeCloseTo(180, 10);
  });

  it("clamps rather than reporting a place off the edge of the world", () => {
    expect(mapPointToGeographic(-3, 4).longitude).toBeCloseTo(-180, 10);
    expect(mapPointToGeographic(9, -2).latitude).toBeCloseTo(90, 10);
    expect(mapPointToGeographic(Number.NaN, Number.NaN).latitude).toBeCloseTo(90, 10);
  });
});

describe("formatMapCoordinates", () => {
  it("keeps one width for every point on the map", () => {
    // The readout sits in a reticle that follows the pointer from pin to pin. A field that grew
    // a character between 9° and 41° would make the whole thing twitch as the hand moved.
    const widths = new Set<number>();
    for (let u = 0; u <= 1.0001; u += 0.05) {
      for (let v = 0; v <= 1.0001; v += 0.05) {
        widths.add(formatMapCoordinates(u, v).length);
      }
    }
    expect(widths.size).toBe(1);
  });

  it("names the hemisphere rather than showing a sign", () => {
    expect(formatMapCoordinates(0.75, 0.25)).toBe("45.0°N 090.0°E");
    expect(formatMapCoordinates(0.25, 0.75)).toBe("45.0°S 090.0°W");
  });

  it("is stable and distinct across the sites the player can actually hover", () => {
    // Whatever it says has to at least be the same every time for one site and different between
    // two. A readout that wandered between hovers would be noticed at once.
    const seen = new Map<string, string>();
    for (const marker of AUTHORED_MARKERS) {
      const text = formatMapCoordinates(marker.x / 100, marker.y / 100);
      expect(formatMapCoordinates(marker.x / 100, marker.y / 100)).toBe(text);
      expect(seen.has(text)).toBe(false);
      seen.set(text, marker.locationId);
    }
    expect(seen.size).toBe(AUTHORED_MARKERS.length);
  });

  it("orders sites the way the map does", () => {
    // The one property a player could actually check by eye: a site drawn left of another has to
    // read further west, and a site drawn above another further north.
    const west = AUTHORED_MARKERS.reduce((a, b) => (a.x < b.x ? a : b));
    const east = AUTHORED_MARKERS.reduce((a, b) => (a.x > b.x ? a : b));
    expect(mapPointToGeographic(west.x / 100, 0).longitude).toBeLessThan(
      mapPointToGeographic(east.x / 100, 0).longitude,
    );
    const north = AUTHORED_MARKERS.reduce((a, b) => (a.y < b.y ? a : b));
    const south = AUTHORED_MARKERS.reduce((a, b) => (a.y > b.y ? a : b));
    expect(mapPointToGeographic(0, north.y / 100).latitude).toBeGreaterThan(
      mapPointToGeographic(0, south.y / 100).latitude,
    );
  });
});
