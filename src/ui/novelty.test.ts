import { describe, expect, it } from "vitest";
import {
  createNoveltyLedger,
  noveltyKind,
  type NoveltyChannel,
  type NoveltySubject,
} from "./novelty";

/** Anything that moves up is news; anything that moves down is not. Enough to exercise the rules. */
const ROSE: NoveltyChannel<number> = {
  facet: "rose",
  isNoteworthy: (before, after) => after > before,
};

/** A second facet on the same subjects, so the two can be shown not to interfere. */
const FELL: NoveltyChannel<number> = {
  facet: "fell",
  isNoteworthy: (before, after) => after < before,
};

function sample(rows: Record<NoveltySubject, number>): Map<NoveltySubject, number> {
  return new Map(Object.entries(rows));
}

describe("noveltyKind", () => {
  it("reads the kind off a subject", () => {
    expect(noveltyKind("site:loc-sydney")).toBe("site");
    expect(noveltyKind("minion:m-4")).toBe("minion");
  });

  it("treats an id containing colons as belonging to the first segment", () => {
    // Ids are author-controlled and may well grow a colon; the kind is still the first word.
    expect(noveltyKind("asset:slot:3")).toBe("asset");
  });

  it("treats a bare subject as its own kind", () => {
    expect(noveltyKind("lair")).toBe("lair");
  });
});

describe("the baseline sample", () => {
  it("raises nothing, however much there is in it", () => {
    // The whole reason a run does not open with every site flagged. Same rule diffReadouts
    // follows when it refuses to roll a number it has never printed.
    const ledger = createNoveltyLedger();
    const raised = ledger.observe(ROSE, sample({ "site:a": 0, "site:b": 3, "site:c": 1 }), 1);
    expect(raised).toStrictEqual([]);
    expect(ledger.count()).toBe(0);
  });

  it("does not flag arrivals either", () => {
    // flagOnFirstSighting is for a subject that shows up mid-run, not for the world existing.
    const arrivals: NoveltyChannel<number> = { ...ROSE, flagOnFirstSighting: () => true };
    const ledger = createNoveltyLedger();
    expect(ledger.observe(arrivals, sample({ "minion:a": 1, "minion:b": 1 }), 1)).toStrictEqual([]);
  });

  it("raises the subjects a channel asks it to point at", () => {
    // The one exception, for a channel whose job is to say "start here" rather than "this moved".
    const opener: NoveltyChannel<number> = { ...ROSE, flagOnBaseline: (s) => s > 0 };
    const ledger = createNoveltyLedger();
    const raised = ledger.observe(opener, sample({ "site:a": 0, "site:b": 3, "site:c": 1 }), 1);
    expect(raised.map((m) => m.subject)).toStrictEqual(["site:b", "site:c"]);
    expect(raised[0]?.turn).toBe(1);
  });

  it("does not let flagOnFirstSighting stand in for flagOnBaseline", () => {
    // The two answer different questions and a channel that only declares the arrival one must
    // still open silent — otherwise every facet quietly flags the whole world on turn 1.
    const arrivals: NoveltyChannel<number> = { ...ROSE, flagOnFirstSighting: () => true };
    const ledger = createNoveltyLedger();
    expect(ledger.observe(arrivals, sample({ "site:a": 5 }), 1)).toStrictEqual([]);
  });

  it("puts a baselined channel back to flagging its opening after a reset", () => {
    // A new run gets the same "start here" marks the last one opened with.
    const opener: NoveltyChannel<number> = { ...ROSE, flagOnBaseline: (s) => s > 0 };
    const ledger = createNoveltyLedger();
    ledger.observe(opener, sample({ "site:a": 1 }), 1);
    ledger.acknowledge("site:a");
    ledger.reset();
    expect(ledger.observe(opener, sample({ "site:a": 1 }), 1)).toHaveLength(1);
  });

  it("is still a baseline when it is empty", () => {
    // A run whose first sample has nothing in it must not treat the second sample as the world
    // arriving — otherwise a map that plots late flags every site on it.
    const arrivals: NoveltyChannel<number> = { ...ROSE, flagOnFirstSighting: () => true };
    const ledger = createNoveltyLedger();
    ledger.observe(arrivals, sample({}), 1);
    expect(ledger.observe(arrivals, sample({ "minion:a": 1 }), 1)).toHaveLength(1);
  });
});

describe("raising marks", () => {
  it("raises on a change the channel calls noteworthy", () => {
    const ledger = createNoveltyLedger();
    ledger.observe(ROSE, sample({ "site:a": 0 }), 1);
    const raised = ledger.observe(ROSE, sample({ "site:a": 1 }), 4);
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ subject: "site:a", facet: "rose", turn: 4 });
    expect(ledger.has("site:a")).toBe(true);
  });

  it("stays quiet on a change the channel does not care about", () => {
    const ledger = createNoveltyLedger();
    ledger.observe(ROSE, sample({ "site:a": 3 }), 1);
    expect(ledger.observe(ROSE, sample({ "site:a": 1 }), 2)).toStrictEqual([]);
    expect(ledger.has("site:a")).toBe(false);
  });

  it("stays quiet on a sample that has not moved", () => {
    // refresh() runs on every drag and every staged slot, not only on a turn boundary, so an
    // unchanged world being re-observed has to cost nothing and say nothing.
    const ledger = createNoveltyLedger();
    ledger.observe(ROSE, sample({ "site:a": 0 }), 1);
    for (let i = 0; i < 20; i += 1) {
      expect(ledger.observe(ROSE, sample({ "site:a": 0 }), 1)).toStrictEqual([]);
    }
    expect(ledger.count()).toBe(0);
  });

  it("does not re-report a mark that is already up", () => {
    // Binary from the player's side: a second noteworthy move before they have looked changes
    // nothing they can perceive, and must not double a badge count.
    const ledger = createNoveltyLedger();
    ledger.observe(ROSE, sample({ "site:a": 0 }), 1);
    ledger.observe(ROSE, sample({ "site:a": 1 }), 2);
    expect(ledger.observe(ROSE, sample({ "site:a": 2 }), 3)).toStrictEqual([]);
    expect(ledger.count()).toBe(1);
    // And it keeps the turn it was first raised on, not the latest one.
    expect(ledger.marksFor("site:a")[0]?.turn).toBe(2);
  });

  it("flags a subject that arrives after the baseline", () => {
    const arrivals: NoveltyChannel<number> = { ...ROSE, flagOnFirstSighting: () => true };
    const ledger = createNoveltyLedger();
    ledger.observe(arrivals, sample({ "minion:a": 1 }), 1);
    const raised = ledger.observe(arrivals, sample({ "minion:a": 1, "minion:b": 1 }), 2);
    expect(raised.map((m) => m.subject)).toStrictEqual(["minion:b"]);
  });

  it("lets a channel refuse an arrival", () => {
    const arrivals: NoveltyChannel<number> = { ...ROSE, flagOnFirstSighting: (s) => s > 5 };
    const ledger = createNoveltyLedger();
    ledger.observe(arrivals, sample({ "minion:a": 1 }), 1);
    const raised = ledger.observe(arrivals, sample({ "minion:a": 1, "minion:b": 2 }), 2);
    expect(raised).toStrictEqual([]);
  });

  it("keeps two facets on one subject apart", () => {
    const ledger = createNoveltyLedger();
    ledger.observe(ROSE, sample({ "site:a": 5 }), 1);
    ledger.observe(FELL, sample({ "site:a": 5 }), 1);
    ledger.observe(ROSE, sample({ "site:a": 9 }), 2);
    ledger.observe(FELL, sample({ "site:a": 9 }), 2);
    expect(ledger.has("site:a", "rose")).toBe(true);
    expect(ledger.has("site:a", "fell")).toBe(false);
  });
});

describe("acknowledging", () => {
  it("clears every facet on the subject when no facet is named", () => {
    // What a click on the thing itself means.
    const ledger = createNoveltyLedger();
    ledger.observe(ROSE, sample({ "site:a": 0 }), 1);
    ledger.observe(FELL, sample({ "site:a": 0 }), 1);
    ledger.observe(ROSE, sample({ "site:a": 5 }), 2);
    ledger.observe(FELL, sample({ "site:a": 5 }), 2);
    ledger.observe(ROSE, sample({ "site:a": 1 }), 3);
    ledger.observe(FELL, sample({ "site:a": 1 }), 3);
    expect(ledger.marksFor("site:a")).toHaveLength(2);
    expect(ledger.acknowledge("site:a")).toBe(true);
    expect(ledger.marksFor("site:a")).toStrictEqual([]);
  });

  it("clears only the named facet when one is given", () => {
    const ledger = createNoveltyLedger();
    ledger.observe(ROSE, sample({ "site:a": 0 }), 1);
    ledger.observe(FELL, sample({ "site:a": 0 }), 1);
    ledger.observe(ROSE, sample({ "site:a": 5 }), 2);
    ledger.observe(FELL, sample({ "site:a": 5 }), 2);
    ledger.observe(FELL, sample({ "site:a": 1 }), 3);
    ledger.acknowledge("site:a", "rose");
    expect(ledger.has("site:a", "rose")).toBe(false);
    expect(ledger.has("site:a", "fell")).toBe(true);
  });

  it("reports whether it actually cleared anything", () => {
    // The caller skips a redraw on false.
    const ledger = createNoveltyLedger();
    ledger.observe(ROSE, sample({ "site:a": 0 }), 1);
    expect(ledger.acknowledge("site:a")).toBe(false);
    ledger.observe(ROSE, sample({ "site:a": 1 }), 2);
    expect(ledger.acknowledge("site:a")).toBe(true);
    expect(ledger.acknowledge("site:a")).toBe(false);
  });

  it("does not let the same unchanged signal raise the mark again", () => {
    // The baseline survives an acknowledgement, which is the whole reason it is held apart from
    // the marks. Without this a dismissed flag would be back on the next render.
    const ledger = createNoveltyLedger();
    ledger.observe(ROSE, sample({ "site:a": 0 }), 1);
    ledger.observe(ROSE, sample({ "site:a": 1 }), 2);
    ledger.acknowledge("site:a");
    ledger.observe(ROSE, sample({ "site:a": 1 }), 2);
    ledger.observe(ROSE, sample({ "site:a": 1 }), 3);
    expect(ledger.has("site:a")).toBe(false);
  });

  it("re-arms once the signal moves again", () => {
    const ledger = createNoveltyLedger();
    ledger.observe(ROSE, sample({ "site:a": 0 }), 1);
    ledger.observe(ROSE, sample({ "site:a": 1 }), 2);
    ledger.acknowledge("site:a");
    ledger.observe(ROSE, sample({ "site:a": 2 }), 5);
    expect(ledger.marksFor("site:a")[0]?.turn).toBe(5);
  });

  it("marks a whole kind as seen at once", () => {
    const ledger = createNoveltyLedger();
    ledger.observe(ROSE, sample({ "site:a": 0, "minion:b": 0 }), 1);
    ledger.observe(ROSE, sample({ "site:a": 1, "minion:b": 1 }), 2);
    expect(ledger.acknowledgeAll({ kind: "site" })).toBe(true);
    expect(ledger.has("site:a")).toBe(false);
    expect(ledger.has("minion:b")).toBe(true);
  });
});

describe("querying", () => {
  it("counts by facet and by kind", () => {
    // What a drawer-tab badge will ask.
    const ledger = createNoveltyLedger();
    ledger.observe(ROSE, sample({ "site:a": 0, "site:b": 0, "minion:c": 0 }), 1);
    ledger.observe(FELL, sample({ "site:a": 5 }), 1);
    ledger.observe(ROSE, sample({ "site:a": 1, "site:b": 1, "minion:c": 1 }), 2);
    ledger.observe(FELL, sample({ "site:a": 1 }), 2);
    expect(ledger.count()).toBe(4);
    expect(ledger.count({ kind: "site" })).toBe(3);
    expect(ledger.count({ facet: "fell" })).toBe(1);
    expect(ledger.count({ kind: "site", facet: "rose" })).toBe(2);
    expect(ledger.count({ kind: "nobody" })).toBe(0);
  });

  it("orders marks by when they were raised, across facets", () => {
    // Turn numbers tie constantly — a turn resolving raises a dozen at once — so raise order is
    // the only thing that can answer "newest".
    const ledger = createNoveltyLedger();
    ledger.observe(ROSE, sample({ "site:a": 0, "site:b": 0 }), 1);
    ledger.observe(FELL, sample({ "site:a": 5 }), 1);
    ledger.observe(ROSE, sample({ "site:b": 1, "site:a": 1 }), 2);
    ledger.observe(FELL, sample({ "site:a": 1 }), 2);
    expect(ledger.marks().map((m) => `${m.subject}/${m.facet}`)).toStrictEqual([
      "site:b/rose",
      "site:a/rose",
      "site:a/fell",
    ]);
  });
});

describe("subjects leaving the world", () => {
  it("drops the marks of a subject that is no longer sampled", () => {
    const ledger = createNoveltyLedger();
    ledger.observe(ROSE, sample({ "site:a": 0, "site:b": 0 }), 1);
    ledger.observe(ROSE, sample({ "site:a": 1, "site:b": 1 }), 2);
    expect(ledger.count()).toBe(2);
    ledger.observe(ROSE, sample({ "site:a": 1 }), 3);
    expect(ledger.has("site:b")).toBe(false);
    expect(ledger.count()).toBe(1);
  });

  it("gives a returning subject a fresh baseline rather than diffing against its last life", () => {
    const ledger = createNoveltyLedger();
    ledger.observe(ROSE, sample({ "site:a": 0, "site:b": 0 }), 1);
    ledger.observe(ROSE, sample({ "site:a": 0 }), 2);
    // `site:b` comes back well above where it left. Without a dropped baseline this reads as a
    // rise; with one it is an arrival, which this channel does not flag.
    ledger.observe(ROSE, sample({ "site:a": 0, "site:b": 9 }), 3);
    expect(ledger.has("site:b")).toBe(false);
  });
});

describe("reset", () => {
  it("clears the marks and puts every facet back to needing a baseline", () => {
    // A new run. The first sample after this must be silent even though the ledger has seen
    // these subjects before — otherwise the previous run's intel leaks into this one's flags.
    const ledger = createNoveltyLedger();
    ledger.observe(ROSE, sample({ "site:a": 0 }), 1);
    ledger.observe(ROSE, sample({ "site:a": 3 }), 2);
    expect(ledger.count()).toBe(1);

    ledger.reset();
    expect(ledger.count()).toBe(0);
    expect(ledger.observe(ROSE, sample({ "site:a": 0 }), 1)).toStrictEqual([]);
    expect(ledger.count()).toBe(0);
  });
});
