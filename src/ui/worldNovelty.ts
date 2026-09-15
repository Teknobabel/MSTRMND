/**
 * The seam between play and the breadcrumbs.
 *
 * `novelty.ts` knows nothing about this game: it holds subjects, facets and rules. This module
 * is where the run's state is turned into samples it can read, and where the rule for each facet
 * is written down — the same split `map/siteSignals` makes between what the map means and how
 * the map is drawn.
 *
 * Adding a facet is three things, all of them here: a subject speller, a channel saying what
 * counts as news, and a sampler that reduces state to one primitive per subject. The surface
 * that draws the flag then only has to ask the ledger a yes/no question.
 */
import { intelLevelForLocation, isLocationIdentifiedByPlayer } from "../game/intel";
import type { LocationIntelState } from "../game/types";
import type { NoveltyChannel, NoveltyLedger, NoveltyMark, NoveltySubject } from "./novelty";

/**
 * Subject kinds, spelled as the map already spells them.
 *
 * `mapSubjectKey` in main.ts produces exactly these strings for its markers, and that is not a
 * coincidence to be tidied away later — it is what lets a click on a pin acknowledge the same
 * subject the sampler raised, with no translation table in between.
 */
export const NOVELTY_KIND_SITE = "site";

export function siteNoveltySubject(locationId: string): NoveltySubject {
  return `${NOVELTY_KIND_SITE}:${locationId}`;
}

/** Every facet this game raises. One string, named once, so no surface spells it by hand. */
export const NOVELTY_FACET = {
  /**
   * A site the player could not identify has become identifiable — the 0 → 1 intel step that
   * turns an Unknown pin into a named place with a category, a level and a security rating.
   */
  siteIdentified: "site-identified",
} as const;

/**
 * Site identity arriving.
 *
 * Written against {@link isLocationIdentifiedByPlayer} rather than against the number 1, so if
 * `INTEL_SITE_IDENTITY` ever moves, the flag follows the thing it is actually reporting: the
 * moment a pin stops being Unknown. Losing intel again is deliberately *not* news — a flag means
 * "there is something here to go and read", and a site that has gone dark has less to read, not
 * more. It does re-arm: a site that goes 1 → 0 → 1 is flagged again, because by then the player
 * is looking at a pin that has been Unknown since the last time they saw it.
 */
export const SITE_IDENTIFIED_CHANNEL: NoveltyChannel<number> = {
  facet: NOVELTY_FACET.siteIdentified,
  isNoteworthy: (before, after) =>
    !isLocationIdentifiedByPlayer(before) && isLocationIdentifiedByPlayer(after),
  /*
   * A run opens on a map that is mostly Unknown pins, and the few sites that are legible from
   * turn one are the only places a player has anything to reason about. Flagging them is not the
   * same claim the mid-run flag makes — nothing has changed there — but it is the same
   * instruction: *this is worth opening*. Without it a new player's first move is to click
   * fifteen identical pins to find out which of them say anything.
   *
   * Safe against the "fifteen flags is the same as none" failure this option warns about,
   * because it is the identified sites and those are a handful; the Unknown majority get their
   * flag later, one at a time, as intel actually lands on them.
   */
  flagOnBaseline: (signal) => isLocationIdentifiedByPlayer(signal),
};

/**
 * Intel per playable site, as the ledger wants it.
 *
 * Driven by the run's playable set rather than by the intel rows, so a site that is not in this
 * run never enters the ledger at all — and a site that leaves mid-run drops out of the sample,
 * which is how {@link NoveltyLedger.observe} learns to forget it.
 */
export function sampleSiteIntel(
  playableLocationIds: Iterable<string>,
  intelStates: readonly LocationIntelState[],
): Map<NoveltySubject, number> {
  const out = new Map<NoveltySubject, number>();
  for (const locationId of playableLocationIds) {
    out.set(siteNoveltySubject(locationId), intelLevelForLocation(intelStates, locationId));
  }
  return out;
}

/** What {@link observeWorldNovelty} needs from the run. Kept to data, so it is testable as data. */
export interface WorldNoveltyInput {
  readonly turnNumber: number;
  readonly playableLocationIds: Iterable<string>;
  readonly intelStates: readonly LocationIntelState[];
}

/**
 * Push one render's worth of world state through every channel.
 *
 * Called from `refresh()` before anything draws, so a surface rendering later in the same pass
 * sees flags that are already up to date. Cheap and idempotent: an unchanged world raises
 * nothing, which matters because `refresh` runs on every drag and every staged slot, not only on
 * a turn boundary.
 *
 * @returns every mark raised this pass, across all facets — for a caller that wants to react to
 *   the event itself rather than to the state it leaves behind.
 */
export function observeWorldNovelty(
  ledger: NoveltyLedger,
  input: WorldNoveltyInput,
): readonly NoveltyMark[] {
  return ledger.observe(
    SITE_IDENTIFIED_CHANNEL,
    sampleSiteIntel(input.playableLocationIds, input.intelStates),
    input.turnNumber,
  );
}
