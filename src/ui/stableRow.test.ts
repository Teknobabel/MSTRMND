import { describe, expect, it } from "vitest";
import { freshRow, stableRow } from "./stableRow";

describe("freshRow", () => {
  it("lists the cards in order, then the empty slots", () => {
    expect(freshRow(["a", "b"], 2)).toEqual(["a", "b", null, null]);
  });

  it("draws no empty slots for a row over its capacity", () => {
    expect(freshRow(["a", "b", "c"], -1)).toEqual(["a", "b", "c"]);
  });
});

describe("stableRow", () => {
  it("turns a card that has left into an empty slot where it stood", () => {
    expect(stableRow(["a", "b", "c"], ["b", "c"], 1)).toEqual([null, "b", "c"]);
    expect(stableRow(["a", "b", "c"], ["a", "c"], 1)).toEqual(["a", null, "c"]);
  });

  it("puts an arriving card in the leftmost empty slot", () => {
    expect(stableRow([null, "b", null], ["b", "d"], 1)).toEqual(["d", "b", null]);
  });

  it("appends an arriving card when the row has no empty slot", () => {
    expect(stableRow(["a", "b"], ["a", "b", "c"], 0)).toEqual(["a", "b", "c"]);
  });

  it("refills every place in order when the whole row is replaced", () => {
    expect(stableRow([null, "b", "c"], ["x", "y", "z"], 0)).toEqual(["x", "y", "z"]);
  });

  it("adds empty slots at the end when the row gains capacity", () => {
    expect(stableRow(["a", "b"], ["a", "b"], 2)).toEqual(["a", "b", null, null]);
  });

  it("drops surplus empty slots from the right, leaving the cards where they are", () => {
    /* A card that never held a slot (a re-hire riding on top of the offers) leaves one spare. */
    expect(stableRow(["a", "b", "r", null], ["a", "b"], 1)).toEqual(["a", "b", null]);
    expect(stableRow(["a", null, "c", "r"], ["a", "c"], 1)).toEqual(["a", null, "c"]);
  });

  it("keeps a row that has not changed exactly as it was", () => {
    expect(stableRow([null, "b", "c"], ["b", "c"], 1)).toEqual([null, "b", "c"]);
  });
});
