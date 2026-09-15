/**
 * Breadcrumbs: what has changed in the world that the player has not looked at yet.
 *
 * A run moves a lot at once — a turn resolves and intel lands, a minion levels, a mission opens,
 * an asset is uncovered — and most of it happens on a surface the player is not currently
 * looking at. This is the one place that remembers which of those changes are still unseen, so
 * any part of the UI can put a flag on the thing that moved and take it off once the player has
 * been there.
 *
 * Three ideas, and they are deliberately the only three:
 *
 *  - A **subject** is a thing the player can look at, spelled `kind:id` — `site:loc-sydney`,
 *    `minion:m-4`. The map already flattens its markers to exactly this spelling
 *    (`mapSubjectKey` in main.ts), and every other surface should follow it, because the prefix
 *    is what lets a drawer tab ask "how many new things are mine?" without a registry of its own.
 *  - A **facet** is *what* is new about the subject. One subject can carry several at once — a
 *    site can have both become identifiable and grown an asset — and a surface that only cares
 *    about one of them can ask for it by name.
 *  - A **channel** is the rule for one facet: given what a subject's signal was and what it is
 *    now, does the player deserve to be told? Channels are declared once, next to the surface
 *    that reads them, and handed to {@link NoveltyLedger.observe} with a fresh sample.
 *
 * The ledger never reads `GameState` and never touches the DOM. It is handed samples and asked
 * questions, which is what keeps the rule for "what counts as new" in one testable place and
 * out of eight render functions — the same split `map/siteSignals` and `statDelta` make.
 *
 * ## What is deliberately absent
 *
 * There is no subscription mechanism. Everything in this shell renders from state inside
 * `refresh()`, so a surface that wants to draw a flag reads the ledger at render time like it
 * reads everything else; a change notification would only be a second, racier way to learn what
 * the next render is about to show anyway. {@link NoveltyLedger.observe} returns what it raised
 * and {@link NoveltyLedger.acknowledge} returns whether it cleared anything, which covers the
 * one thing polling cannot do: reacting to the event itself.
 *
 * There is also no expiry. A breadcrumb comes off when the player has been shown the thing, not
 * when enough turns have passed — a flag that times out is a flag that lies about whether it was
 * ever read.
 */

/**
 * A thing the player can look at, spelled `kind:id`.
 *
 * The `kind` prefix is load-bearing, not decoration: {@link noveltyKind} reads it, and filters
 * are built on it. A subject with no colon is legal and is its own kind.
 */
export type NoveltySubject = string;

/** What about a subject is new. One subject can carry several at once. */
export type NoveltyFacet = string;

/** The `kind` half of a subject — the part before the first colon. */
export function noveltyKind(subject: NoveltySubject): string {
  const cut = subject.indexOf(":");
  return cut === -1 ? subject : subject.slice(0, cut);
}

export interface NoveltyMark {
  readonly subject: NoveltySubject;
  readonly facet: NoveltyFacet;
  /** The turn it was raised on, so a surface can say *when* without a second ledger. */
  readonly turn: number;
  /**
   * Raise order across the whole ledger. Turn numbers tie constantly — a turn resolving raises
   * a dozen marks at once — so this is what gives "newest first" a stable answer.
   */
  readonly seq: number;
}

/**
 * The rule for one facet.
 *
 * `TSignal` is whatever summarises the subject for this facet, and it must be a **primitive**:
 * signals are compared with `Object.is`, so an object would look changed on every sample. A
 * facet that needs more than one number should encode it as a string (`` `${level}/${xp}` ``),
 * which also keeps the baseline cheap to hold for a few hundred subjects.
 */
export interface NoveltyChannel<TSignal> {
  readonly facet: NoveltyFacet;
  /**
   * A subject the ledger has seen before, whose signal has moved. Only called when the signal
   * actually differs, so this never has to check for equality itself.
   */
  readonly isNoteworthy: (before: TSignal, after: TSignal) => boolean;
  /**
   * A subject that has appeared in the sample for the first time — a minion joining the hire
   * pool, a mission becoming available. Omit it (the usual case) and an arrival is silent.
   *
   * Never called for the facet's *first* sample, however many subjects are in it; that one is
   * {@link NoveltyChannel.flagOnBaseline}'s to answer for. See {@link NoveltyLedger.observe}.
   */
  readonly flagOnFirstSighting?: (signal: TSignal) => boolean;
  /**
   * What the world opening already deserves a flag on.
   *
   * The one way to raise a mark from the baseline sample, and the exception that proves the rule
   * the baseline otherwise follows: silence, because a player arriving has not "missed" any of
   * it. Sometimes the point of a flag is not that something changed but that there is somewhere
   * to start — a run opens with a handful of sites the player can actually read, and pointing at
   * them is the difference between a first turn and a blank map.
   *
   * Use it sparingly and never as a shortcut for {@link NoveltyChannel.flagOnFirstSighting}: a
   * channel that says yes to everything here hands a new player fifteen flags, which is the same
   * as none. Omit it (the usual case) and the baseline stays silent.
   */
  readonly flagOnBaseline?: (signal: TSignal) => boolean;
}

/** Narrows a query to one facet, one subject kind, or both. An empty filter matches everything. */
export interface NoveltyFilter {
  readonly facet?: NoveltyFacet;
  /** Matched against {@link noveltyKind} — `"site"`, `"minion"`. */
  readonly kind?: string;
}

export interface NoveltyLedger {
  /**
   * Compare a fresh sample against what this facet last looked like, and raise marks for the
   * subjects the channel says have moved.
   *
   * **The first sample for a facet raises nothing** unless the channel declares
   * {@link NoveltyChannel.flagOnBaseline}. It is the baseline, and its silence is the whole
   * reason a run does not open with every site, mission and minion flagged as new — the same
   * rule `diffReadouts` follows when it refuses to roll a number it has never printed before.
   * {@link reset} puts a facet back in that state, which is what starting a run does.
   *
   * Re-raising a mark that is already up is a no-op: the flag is binary from the player's side,
   * so a second noteworthy move before they have looked changes nothing and is not reported.
   *
   * A subject that has dropped out of the sample loses both its baseline and its marks — a site
   * that is not in this run cannot be new in it.
   *
   * @returns the marks this call raised, newest last. Safe to ignore; the ledger has already
   *   recorded them.
   */
  observe<TSignal>(
    channel: NoveltyChannel<TSignal>,
    sample: ReadonlyMap<NoveltySubject, TSignal>,
    turn: number,
  ): readonly NoveltyMark[];

  /** Whether the subject has an unseen mark — for one facet, or for any of them. */
  has(subject: NoveltySubject, facet?: NoveltyFacet): boolean;

  /** Every unseen mark on one subject, oldest first. */
  marksFor(subject: NoveltySubject): readonly NoveltyMark[];

  /** Every unseen mark the filter matches, oldest first. */
  marks(filter?: NoveltyFilter): readonly NoveltyMark[];

  /** How many unseen marks the filter matches — the number a badge prints. */
  count(filter?: NoveltyFilter): number;

  /**
   * The player has been shown this subject. Clears one facet, or all of them when no facet is
   * given, which is what a click on the thing itself means.
   *
   * The baseline is kept, so the mark does not come straight back on the next sample — it can
   * only be raised again by the signal moving again.
   *
   * @returns whether anything was actually cleared, so a caller can skip a redraw.
   */
  acknowledge(subject: NoveltySubject, facet?: NoveltyFacet): boolean;

  /** {@link acknowledge} across everything the filter matches — "mark all as seen". */
  acknowledgeAll(filter?: NoveltyFilter): boolean;

  /** Forget everything, marks and baselines both. A new run. */
  reset(): void;
}

export function createNoveltyLedger(): NoveltyLedger {
  /** Last-seen signal per subject, per facet. Also the record of which facets have a baseline. */
  const baselines = new Map<NoveltyFacet, Map<NoveltySubject, unknown>>();
  /** Marks still unseen, per facet. */
  const raised = new Map<NoveltyFacet, Map<NoveltySubject, NoveltyMark>>();
  let seq = 0;

  function matches(mark: NoveltyMark, filter: NoveltyFilter | undefined): boolean {
    if (filter === undefined) {
      return true;
    }
    if (filter.facet !== undefined && mark.facet !== filter.facet) {
      return false;
    }
    return filter.kind === undefined || noveltyKind(mark.subject) === filter.kind;
  }

  /** Every mark in raise order. Facet count is tiny, so this is a walk rather than an index. */
  function allMarks(): NoveltyMark[] {
    const out: NoveltyMark[] = [];
    for (const bySubject of raised.values()) {
      out.push(...bySubject.values());
    }
    out.sort((a, b) => a.seq - b.seq);
    return out;
  }

  return {
    observe<TSignal>(
      channel: NoveltyChannel<TSignal>,
      sample: ReadonlyMap<NoveltySubject, TSignal>,
      turn: number,
    ): readonly NoveltyMark[] {
      const known = baselines.get(channel.facet);
      const isBaselineSample = known === undefined;
      const seen = known ?? new Map<NoveltySubject, unknown>();
      if (isBaselineSample) {
        baselines.set(channel.facet, seen);
      }

      const fresh: NoveltyMark[] = [];
      for (const [subject, after] of sample) {
        const first = !seen.has(subject);
        const before = seen.get(subject) as TSignal | undefined;
        seen.set(subject, after);

        /* The baseline sample is what the world looked like when the player arrived, so nothing
         * in it is news and `flagOnFirstSighting` deliberately does not see it — only a channel
         * that has asked to point at somewhere to start gets a say. */
        const noteworthy = isBaselineSample
          ? channel.flagOnBaseline?.(after) === true
          : first
            ? channel.flagOnFirstSighting?.(after) === true
            : !Object.is(before, after) && channel.isNoteworthy(before as TSignal, after);
        if (!noteworthy) {
          continue;
        }

        let bySubject = raised.get(channel.facet);
        if (bySubject === undefined) {
          bySubject = new Map();
          raised.set(channel.facet, bySubject);
        }
        /* Already flagged and not yet looked at: nothing the player can perceive would change. */
        if (bySubject.has(subject)) {
          continue;
        }
        const mark: NoveltyMark = { subject, facet: channel.facet, turn, seq: seq++ };
        bySubject.set(subject, mark);
        fresh.push(mark);
      }

      /* Gone from the world: drop the baseline with the marks, so a subject id that is reused
       * later starts from a clean baseline rather than diffing against a previous life. */
      for (const subject of [...seen.keys()]) {
        if (!sample.has(subject)) {
          seen.delete(subject);
          raised.get(channel.facet)?.delete(subject);
        }
      }
      return fresh;
    },

    has(subject: NoveltySubject, facet?: NoveltyFacet): boolean {
      if (facet !== undefined) {
        return raised.get(facet)?.has(subject) === true;
      }
      for (const bySubject of raised.values()) {
        if (bySubject.has(subject)) {
          return true;
        }
      }
      return false;
    },

    marksFor(subject: NoveltySubject): readonly NoveltyMark[] {
      return allMarks().filter((m) => m.subject === subject);
    },

    marks(filter?: NoveltyFilter): readonly NoveltyMark[] {
      return allMarks().filter((m) => matches(m, filter));
    },

    count(filter?: NoveltyFilter): number {
      let n = 0;
      for (const bySubject of raised.values()) {
        for (const mark of bySubject.values()) {
          if (matches(mark, filter)) {
            n += 1;
          }
        }
      }
      return n;
    },

    acknowledge(subject: NoveltySubject, facet?: NoveltyFacet): boolean {
      if (facet !== undefined) {
        return raised.get(facet)?.delete(subject) === true;
      }
      let cleared = false;
      for (const bySubject of raised.values()) {
        cleared = bySubject.delete(subject) || cleared;
      }
      return cleared;
    },

    acknowledgeAll(filter?: NoveltyFilter): boolean {
      let cleared = false;
      for (const bySubject of raised.values()) {
        for (const mark of [...bySubject.values()]) {
          if (matches(mark, filter)) {
            bySubject.delete(mark.subject);
            cleared = true;
          }
        }
      }
      return cleared;
    },

    reset(): void {
      baselines.clear();
      raised.clear();
      seq = 0;
    },
  };
}
