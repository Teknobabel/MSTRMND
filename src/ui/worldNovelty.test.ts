import { describe, expect, it } from "vitest";
import { INTEL_SITE_IDENTITY, MAX_INTEL_LEVEL } from "../game/intel";
import type { IntelLevel, LocationIntelState } from "../game/types";
import { createNoveltyLedger } from "./novelty";
import {
  NOVELTY_FACET,
  SITE_IDENTIFIED_CHANNEL,
  observeWorldNovelty,
  sampleSiteIntel,
  siteNoveltySubject,
} from "./worldNovelty";

function intel(rows: Record<string, number>): LocationIntelState[] {
  return Object.entries(rows).map(([locationId, intelLevel]) => ({
    locationId,
    intelLevel: intelLevel as IntelLevel,
  }));
}

describe("siteNoveltySubject", () => {
  it("spells a subject the way the map spells its markers", () => {
    // main.ts's `mapSubjectKey` produces this exact string for a site marker. A click on a pin
    // acknowledges what a sampler raised only because the two agree, so this is load-bearing.
    expect(siteNoveltySubject("loc-sydney")).toBe("site:loc-sydney");
  });
});

describe("sampleSiteIntel", () => {
  it("reports one signal per playable site", () => {
    const sample = sampleSiteIntel(["a", "b"], intel({ a: 0, b: 2 }));
    expect([...sample]).toStrictEqual([
      ["site:a", 0],
      ["site:b", 2],
    ]);
  });

  it("reads a site with no intel row as zero rather than dropping it", () => {
    // A playable site must be in the sample from the first pass, or its 0 -> 1 step later would
    // look like an arrival instead of a change.
    const sample = sampleSiteIntel(["a"], intel({}));
    expect(sample.get("site:a")).toBe(0);
  });

  it("leaves out sites that are not in this run", () => {
    // Driven by the playable set, not by the intel rows: a site the omega plan did not pick has
    // nothing the player could go and look at.
    const sample = sampleSiteIntel(["a"], intel({ a: 1, b: 3 }));
    expect([...sample.keys()]).toStrictEqual(["site:a"]);
  });
});

describe("SITE_IDENTIFIED_CHANNEL", () => {
  it("fires on the step that turns an Unknown pin into a named place", () => {
    expect(SITE_IDENTIFIED_CHANNEL.isNoteworthy(0, INTEL_SITE_IDENTITY)).toBe(true);
  });

  it("stays quiet on intel climbing between already-identified levels", () => {
    // 1 -> 2 uncovers asset contents, which is a different thing to say and will be its own
    // facet when that surface is hooked up. This one reports identity arriving, only.
    expect(SITE_IDENTIFIED_CHANNEL.isNoteworthy(INTEL_SITE_IDENTITY, MAX_INTEL_LEVEL)).toBe(false);
  });

  it("stays quiet on intel being burned back off a site", () => {
    // A flag says "there is something here to go and read". A site that has gone dark has less
    // to read, not more.
    expect(SITE_IDENTIFIED_CHANNEL.isNoteworthy(MAX_INTEL_LEVEL, 0)).toBe(false);
  });

  it("does not flag sites that merely exist", () => {
    // No flagOnFirstSighting: a site appearing in the sample mid-run is the map being replotted,
    // not intel arriving. Only the opening sample gets to point at things (flagOnBaseline).
    expect(SITE_IDENTIFIED_CHANNEL.flagOnFirstSighting).toBeUndefined();
  });

  it("points at the sites a run opens legible, and only those", () => {
    expect(SITE_IDENTIFIED_CHANNEL.flagOnBaseline?.(0)).toBe(false);
    expect(SITE_IDENTIFIED_CHANNEL.flagOnBaseline?.(INTEL_SITE_IDENTITY)).toBe(true);
    expect(SITE_IDENTIFIED_CHANNEL.flagOnBaseline?.(MAX_INTEL_LEVEL)).toBe(true);
  });
});

describe("observeWorldNovelty", () => {
  const sites = ["a", "b", "c"];

  it("opens a run pointing at the sites the player can already read", () => {
    // A new player's first move should not be clicking fifteen identical pins to find the four
    // that say anything.
    const ledger = createNoveltyLedger();
    const raised = observeWorldNovelty(ledger, {
      turnNumber: 1,
      playableLocationIds: sites,
      intelStates: intel({ a: 0, b: 1, c: 3 }),
    });
    expect(raised.map((m) => m.subject)).toStrictEqual([
      siteNoveltySubject("b"),
      siteNoveltySubject("c"),
    ]);
  });

  it("leaves the Unknown pins for intel to light later", () => {
    const ledger = createNoveltyLedger();
    observeWorldNovelty(ledger, {
      turnNumber: 1,
      playableLocationIds: sites,
      intelStates: intel({ a: 0, b: 0, c: 0 }),
    });
    expect(ledger.count()).toBe(0);
  });

  it("flags the site that just became identifiable, and only that one", () => {
    const ledger = createNoveltyLedger();
    observeWorldNovelty(ledger, {
      turnNumber: 1,
      playableLocationIds: sites,
      intelStates: intel({ a: 0, b: 0, c: 2 }),
    });
    const raised = observeWorldNovelty(ledger, {
      turnNumber: 2,
      // `a` identifies, `b` stays dark, `c` climbs but was already known.
      intelStates: intel({ a: 1, b: 0, c: 3 }),
      playableLocationIds: sites,
    });
    expect(raised.map((m) => m.subject)).toStrictEqual([siteNoveltySubject("a")]);
    expect(raised[0]?.facet).toBe(NOVELTY_FACET.siteIdentified);
    expect(raised[0]?.turn).toBe(2);
  });

  it("holds the flag across the many refreshes inside one turn", () => {
    // refresh() runs on every drag and every staged slot. The flag has to survive all of them
    // and must not be raised a second time by any.
    const ledger = createNoveltyLedger();
    observeWorldNovelty(ledger, {
      turnNumber: 1,
      playableLocationIds: sites,
      intelStates: intel({ a: 0, b: 0, c: 0 }),
    });
    observeWorldNovelty(ledger, {
      turnNumber: 2,
      playableLocationIds: sites,
      intelStates: intel({ a: 1, b: 0, c: 0 }),
    });
    for (let i = 0; i < 10; i += 1) {
      expect(
        observeWorldNovelty(ledger, {
          turnNumber: 2,
          playableLocationIds: sites,
          intelStates: intel({ a: 1, b: 0, c: 0 }),
        }),
      ).toStrictEqual([]);
    }
    expect(ledger.count()).toBe(1);
  });

  it("keeps a dismissed flag off while the site stays identified", () => {
    const ledger = createNoveltyLedger();
    observeWorldNovelty(ledger, {
      turnNumber: 1,
      playableLocationIds: sites,
      intelStates: intel({ a: 0, b: 0, c: 0 }),
    });
    observeWorldNovelty(ledger, {
      turnNumber: 2,
      playableLocationIds: sites,
      intelStates: intel({ a: 1, b: 0, c: 0 }),
    });
    ledger.acknowledge(siteNoveltySubject("a"));
    observeWorldNovelty(ledger, {
      turnNumber: 3,
      playableLocationIds: sites,
      intelStates: intel({ a: 3, b: 0, c: 0 }),
    });
    expect(ledger.has(siteNoveltySubject("a"))).toBe(false);
  });

  it("flags a site again when it goes dark and is re-identified", () => {
    // By then the player is looking at a pin that has been Unknown since they last saw it, so
    // identity arriving is news for a second time.
    const ledger = createNoveltyLedger();
    observeWorldNovelty(ledger, {
      turnNumber: 1,
      playableLocationIds: sites,
      intelStates: intel({ a: 1, b: 0, c: 0 }),
    });
    /* `a` opens the run flagged, since it opens legible. The player looks at it. */
    ledger.acknowledge(siteNoveltySubject("a"));
    observeWorldNovelty(ledger, {
      turnNumber: 2,
      playableLocationIds: sites,
      intelStates: intel({ a: 0, b: 0, c: 0 }),
    });
    expect(ledger.count()).toBe(0);
    const raised = observeWorldNovelty(ledger, {
      turnNumber: 3,
      playableLocationIds: sites,
      intelStates: intel({ a: 1, b: 0, c: 0 }),
    });
    expect(raised.map((m) => m.subject)).toStrictEqual([siteNoveltySubject("a")]);
  });

  it("counts flagged sites by kind, for a badge that has not been built yet", () => {
    const ledger = createNoveltyLedger();
    observeWorldNovelty(ledger, {
      turnNumber: 1,
      playableLocationIds: sites,
      intelStates: intel({ a: 0, b: 0, c: 0 }),
    });
    observeWorldNovelty(ledger, {
      turnNumber: 2,
      playableLocationIds: sites,
      intelStates: intel({ a: 1, b: 1, c: 0 }),
    });
    expect(ledger.count({ kind: "site" })).toBe(2);
  });
});
