import { describe, expect, it } from "vitest";
import {
  BARK_GAP_MAX_SECONDS,
  BARK_GAP_MIN_SECONDS,
  BARK_MEMORY,
  barkKey,
  nextBarkGapSeconds,
  pickBark,
  rememberBark,
  type BarkSpeaker,
} from "./minionBarks";

function speaker(id: string, lines: string[], templateId = id): BarkSpeaker {
  return { instanceId: id, templateId, name: id.toUpperCase(), lines };
}

/** Deals the given numbers to successive `rng()` calls, then repeats the last one. */
function dealer(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0;
}

describe("nextBarkGapSeconds", () => {
  it("keeps every gap inside the authored window", () => {
    for (const roll of [0, 0.25, 0.5, 0.999]) {
      const gap = nextBarkGapSeconds(() => roll);
      expect(gap).toBeGreaterThanOrEqual(BARK_GAP_MIN_SECONDS);
      expect(gap).toBeLessThanOrEqual(BARK_GAP_MAX_SECONDS);
    }
  });

  it("never lands under half a minute", () => {
    // The floor is the whole reason the feature is not annoying; see the constant's note.
    expect(nextBarkGapSeconds(() => 0)).toBeGreaterThan(20);
  });
});

describe("pickBark", () => {
  it("says nothing when nobody on the map has a line", () => {
    expect(pickBark([], [], null, () => 0)).toBeNull();
    expect(pickBark([speaker("a", [])], [], null, () => 0)).toBeNull();
  });

  it("skips the minion who spoke last while anyone else could", () => {
    const roster = [speaker("a", ["one"]), speaker("b", ["two"])];
    // A roll of 0 would take the first speaker; the filter should have removed it.
    expect(pickBark(roster, [], "a", () => 0)?.instanceId).toBe("b");
  });

  it("lets a lone minion speak twice running rather than going silent", () => {
    const roster = [speaker("a", ["one", "two"])];
    expect(pickBark(roster, [], "a", dealer(0, 0.9))?.instanceId).toBe("a");
  });

  it("passes over lines still in memory", () => {
    const roster = [speaker("a", ["one", "two", "three"])];
    const recent = [barkKey("a", 0), barkKey("a", 2)];
    // Only index 1 is unheard, so any roll has to land on it.
    expect(pickBark(roster, recent, null, () => 0)?.text).toBe("two");
    expect(pickBark(roster, recent, null, () => 0.99)?.text).toBe("two");
  });

  it("repeats a line rather than falling silent once every one is remembered", () => {
    const roster = [speaker("a", ["one", "two"])];
    const recent = [barkKey("a", 0), barkKey("a", 1)];
    expect(pickBark(roster, recent, null, () => 0)?.text).toBe("one");
  });

  it("remembers a line against its template, so a rehire cannot wipe the memory", () => {
    // Instance ids are minted per hire; the lines belong to the template that authored them.
    const bark = pickBark([speaker("inst-9", ["hello"], "knuckles")], [], null, () => 0);
    expect(bark?.key).toBe("knuckles#0");
  });
});

describe("rememberBark", () => {
  it("keeps the newest first", () => {
    expect(rememberBark(["a#0"], "b#1")).toEqual(["b#1", "a#0"]);
  });

  it("moves a repeat to the front instead of holding it twice", () => {
    expect(rememberBark(["b#1", "a#0"], "a#0")).toEqual(["a#0", "b#1"]);
  });

  it("forgets the oldest once the memory is full", () => {
    let recent: string[] = [];
    for (let i = 0; i < BARK_MEMORY + 5; i += 1) {
      recent = rememberBark(recent, `t#${i}`);
    }
    expect(recent).toHaveLength(BARK_MEMORY);
    expect(recent[0]).toBe(`t#${BARK_MEMORY + 4}`);
    expect(recent).not.toContain("t#0");
  });
});
