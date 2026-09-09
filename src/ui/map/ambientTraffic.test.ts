import { describe, expect, it } from "vitest";
import mapsJson from "../../../content/maps.json";
import { ambientTracks } from "./ambientTraffic";

/**
 * Ten minutes at a quarter-second step.
 *
 * Long deliberately. The slots run on cycles of twenty to fifty seconds and are offset against
 * each other, so a short window only catches the arrangement it happens to open on: the first
 * version of this file sampled two minutes and concluded the map is never quiet, which is a
 * statement about the window and not about the traffic.
 */
const SAMPLES = Array.from({ length: 2400 }, (_, i) => i * 0.25);

const AUTHORED_MARKERS = mapsJson.flatMap((m) => m.markers ?? []);

describe("ambientTracks", () => {
  it("is a pure function of the clock, so nothing has to be reset when the panel rebuilds", () => {
    // The whole reason there is no spawn bookkeeping. Asking twice, out of order, has to give
    // the same answer both times or a re-render would visibly restart the traffic.
    for (const t of [0, 3.7, 41.2, 999.5]) {
      expect(ambientTracks(t)).toEqual(ambientTracks(t));
    }
    const late = ambientTracks(88.25);
    ambientTracks(1);
    expect(ambientTracks(88.25)).toEqual(late);
  });

  it("flies only between the anchors, and uses all of them", () => {
    // An arc that begins in open ocean is the one way this reads as a bug rather than as
    // traffic, so endpoints must always come from the table and never be improvised. Which
    // anchors are on land is a question only the art can answer and is checked when the table is
    // generated; what this can hold is that the set is closed, small, and fully used — an
    // unreachable anchor is a bug in the picking, and a stray endpoint is a bug in the routing.
    const anchors = new Set<string>();
    for (const t of SAMPLES) {
      for (const track of ambientTracks(t)) {
        if (track.kind === "arc") {
          anchors.add(`${track.fromU},${track.fromV}`);
          anchors.add(`${track.toU},${track.toV}`);
        }
      }
    }
    expect(anchors.size).toBe(18);
    for (const anchor of anchors) {
      const [u, v] = anchor.split(",").map(Number) as [number, number];
      expect(u).toBeGreaterThan(0.05);
      expect(u).toBeLessThan(0.95);
      expect(v).toBeGreaterThan(0.05);
      expect(v).toBeLessThan(0.95);
    }
  });

  it("never flies a route too short to read as one", () => {
    for (const t of SAMPLES) {
      for (const track of ambientTracks(t)) {
        if (track.kind === "arc") {
          const length = Math.hypot(track.toU - track.fromU, track.toV - track.fromV);
          expect(length).toBeGreaterThanOrEqual(0.22);
        }
      }
    }
  });

  it("never routes a flight through a site the player can click", () => {
    // The point of the separate anchor table. A line drawn between two sites is the map
    // asserting a relationship the rules know nothing about, and a player is right to read one
    // into it — so an ambient endpoint must never land on an authored marker.
    for (const t of SAMPLES.slice(0, 300)) {
      for (const track of ambientTracks(t)) {
        for (const marker of AUTHORED_MARKERS) {
          const u = marker.x / 100;
          const v = marker.y / 100;
          expect(Math.hypot(track.fromU - u, track.fromV - v)).toBeGreaterThan(0.02);
          expect(Math.hypot(track.toU - u, track.toV - v)).toBeGreaterThan(0.02);
        }
      }
    }
  });

  it("bows arcs into the gap between the lattice and the weather", () => {
    // camera.ts floats the grid at 0.055 and the atmosphere at 0.13. Flights belong between
    // them: over the graticule and under the cloud is what makes the stack read as a volume
    // rather than as a line drawn on a picture.
    for (const t of SAMPLES) {
      for (const track of ambientTracks(t)) {
        if (track.kind === "arc") {
          expect(track.bow).toBeGreaterThan(0.055);
          expect(track.bow).toBeLessThan(0.13);
        } else {
          // An orbit lies in the weather layer rather than bowing above it.
          expect(track.bow).toBe(0);
        }
      }
    }
  });

  it("starts and finishes an orbit outside the frame", () => {
    for (const t of SAMPLES) {
      for (const track of ambientTracks(t)) {
        if (track.kind === "orbit") {
          expect(Math.min(track.fromU, track.toU)).toBeLessThan(0);
          expect(Math.max(track.fromU, track.toU)).toBeGreaterThan(1);
          expect(track.fromV).toBeGreaterThan(0);
          expect(track.fromV).toBeLessThan(1);
          expect(track.toV).toBeGreaterThan(0);
          expect(track.toV).toBeLessThan(1);
        }
      }
    }
  });

  it("sends orbits both ways", () => {
    const directions = new Set<boolean>();
    for (const t of SAMPLES) {
      for (const track of ambientTracks(t)) {
        if (track.kind === "orbit") {
          directions.add(track.toU > track.fromU);
        }
      }
    }
    expect(directions.size).toBe(2);
  });

  it("eases every track in and out rather than switching it on", () => {
    for (const t of SAMPLES) {
      for (const track of ambientTracks(t)) {
        expect(track.fade).toBeGreaterThanOrEqual(0);
        expect(track.fade).toBeLessThanOrEqual(1);
      }
    }
    // And actually reaches full strength somewhere in the middle, rather than easing forever.
    const brightest = Math.max(
      ...SAMPLES.flatMap((t) => ambientTracks(t).map((track) => track.fade)),
    );
    expect(brightest).toBeGreaterThan(0.98);
  });

  it("clears the far end before the slot rests", () => {
    // The head runs past 1 by exactly the tail length. If it stopped at 1 the trail would still
    // be lit when the track vanished, which reads as a flight being cut off mid-air.
    for (const t of SAMPLES) {
      for (const track of ambientTracks(t)) {
        expect(track.head).toBeGreaterThanOrEqual(0);
        expect(track.head).toBeLessThanOrEqual(1 + track.tail + 1e-9);
      }
    }
  });

  it("lets the map fall quiet, and does not leave it quiet", () => {
    // Slots that were always in the air would read as permanent lines drawn on the map, and the
    // eye files those away within a minute. Slots that rarely flew would leave the panel dead.
    // Both are failures, and this pins the middle: busy nearly all the time, occasionally empty,
    // and averaging a handful rather than a crowd.
    const counts = SAMPLES.map((t) => ambientTracks(t).length);
    expect(Math.min(...counts)).toBe(0);
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(3);
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    expect(mean).toBeGreaterThan(1.5);
    expect(mean).toBeLessThan(4);
  });

  it("does not open the map with every slot leaving at once", () => {
    // Without the per-slot offset every cycle starts together at t = 0 and the traffic reads as
    // a pulse. At the very start the slots should already be spread through their cycles.
    const heads = ambientTracks(0.5).map((track) => track.head);
    if (heads.length > 1) {
      expect(Math.max(...heads) - Math.min(...heads)).toBeGreaterThan(0.05);
    }
  });

  it("does not send a slot the same route twice running", () => {
    const routes: string[] = [];
    let previous = "";
    for (const t of SAMPLES) {
      for (const track of ambientTracks(t)) {
        if (track.kind !== "arc") {
          continue;
        }
        const route = `${track.fromU},${track.fromV}->${track.toU},${track.toV}`;
        if (route !== previous) {
          routes.push(route);
          previous = route;
        }
      }
    }
    expect(new Set(routes).size).toBeGreaterThan(6);
  });
});
