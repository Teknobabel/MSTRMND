/**
 * Barks: the crew talking to itself over the world map.
 *
 * Every so often one of the minions the player has hired says something in a speech bubble hung
 * over its portrait — on the operation it is running, or at the lair if it is sitting the turn
 * out — and a few seconds later the bubble goes away again. Nothing here is a readout: a bark
 * costs nothing, tells the player nothing they could act on, and is chosen without consulting
 * anything the rules would call state. It is the roster having a personality.
 *
 * Three rules shape the whole module, and all three are about *not being annoying*:
 *
 * 1. **Sparse.** The gap between barks is measured in tens of seconds, not seconds. A line that
 *    lands every few moments is a chat log, and a chat log over a map is something the player
 *    ends up wanting a switch for — which is why there is one, and why it should stay unused.
 * 2. **Never over a menu.** A bark that fires while the player is reading a drawer, a turn
 *    report or the pause screen is a bubble they will find already gone when they look back, or
 *    worse, one that pulls their eye off what they opened. The gate is the caller's (`enabled`),
 *    because only the shell knows what is currently covering the map.
 * 3. **No immediate repeats.** The same speaker twice running, or the same line inside one
 *    session's memory, is what turns character into a loop — see {@link pickBark}.
 *
 * The scheduling and picking half is pure and testable; the director below is the only part that
 * touches the DOM, and it is driven from the shell's existing frame loop rather than from timers
 * of its own, so barks stop dead when the game loop does (a paused game, a screen that is not
 * the game's) with nothing to tear down.
 */

/** A number in [0, 1). Injected so the schedule and the picks are testable. */
export type BarkRng = () => number;

/** One hired minion the map can currently show speaking, and what it has to say. */
export interface BarkSpeaker {
  readonly instanceId: string;
  /** Which template the lines came from — the key a line is remembered by. */
  readonly templateId: string;
  /** The speaker's name, drawn as the bubble's caption. */
  readonly name: string;
  readonly lines: readonly string[];
}

/** A line, ready to be drawn: who says it and what they say. */
export interface Bark {
  readonly instanceId: string;
  readonly name: string;
  readonly text: string;
  /** `templateId#index` — what {@link pickBark} remembers, so a rehire cannot reset the memory. */
  readonly key: string;
}

/**
 * How long the map stays quiet between barks, in seconds.
 *
 * The floor is the important number of the two. Barks were first written at 8–20s and read as a
 * crew that would not shut up — not because any one line was wrong, but because the player is
 * mostly *reading* this screen, and something moving in the corner every few seconds is a
 * reading tax. Half a minute at the low end means a bark is a thing that happens rather than a
 * thing that is happening, and the spread is wide enough that the eye never learns the beat.
 */
export const BARK_GAP_MIN_SECONDS = 28;
export const BARK_GAP_MAX_SECONDS = 62;

/**
 * How long a bubble holds before it fades, in seconds.
 *
 * Long enough to read a short line twice at a glance, and no longer: this is overheard chatter,
 * and chatter that waits to be acknowledged is a notification.
 */
export const BARK_HOLD_SECONDS = 4.6;

/** The fade out. Matches the `.map-bark--leaving` transition in `styles.css`. */
export const BARK_FADE_SECONDS = 0.45;

/**
 * The beat after the map is uncovered before anyone speaks again.
 *
 * A bark that fires on the same frame a drawer slides shut reads as a response to the drawer.
 * Holding the schedule a couple of seconds past the block puts the line back into the ambient
 * where it belongs — and means a player flicking between drawers is never chased by bubbles.
 */
export const BARK_RESUME_GRACE_SECONDS = 2.5;

/**
 * How many lines back the "don't repeat yourself" memory runs.
 *
 * Deliberately larger than any one minion's list: a roster of three with ten lines each is 30
 * lines, and remembering only the last handful means the player hears a line again while they
 * can still remember hearing it. Capped rather than unbounded so a long run eventually recycles
 * instead of running out of things to say and falling back every time.
 */
export const BARK_MEMORY = 24;

/** A gap in seconds before the next bark. */
export function nextBarkGapSeconds(rng: BarkRng): number {
  return BARK_GAP_MIN_SECONDS + rng() * (BARK_GAP_MAX_SECONDS - BARK_GAP_MIN_SECONDS);
}

/** The memory key for one line of one template's list. */
export function barkKey(templateId: string, index: number): string {
  return `${templateId}#${index}`;
}

/**
 * Pick who speaks and what they say, or `null` when nobody on the map has a line.
 *
 * The two filters are applied in the order the annoyance shows up in. **Speaker first**: hearing
 * the same minion twice running reads as that minion being the talkative one, however different
 * the two lines are — so a roster with anyone else to hand never repeats a speaker. **Line
 * second**: within the chosen speaker, lines the memory is still holding are skipped.
 *
 * Both filters fall back to the unfiltered set rather than declining to speak. A solo roster
 * *is* the same speaker every time, and a minion whose ten lines are all in memory is better off
 * repeating one than going silent for the rest of the run — the fallback is what keeps a small
 * roster from quietly turning the feature off.
 *
 * @param recent Bark keys already heard, newest first (see {@link BARK_MEMORY}).
 * @param lastSpeakerId The instance that spoke last, or `null` at the top of a run.
 */
export function pickBark(
  speakers: readonly BarkSpeaker[],
  recent: readonly string[],
  lastSpeakerId: string | null,
  rng: BarkRng,
): Bark | null {
  const withLines = speakers.filter((s) => s.lines.length > 0);
  if (withLines.length === 0) {
    return null;
  }
  const fresh = withLines.filter((s) => s.instanceId !== lastSpeakerId);
  const pool = fresh.length > 0 ? fresh : withLines;
  const speaker = pool[Math.floor(rng() * pool.length)] ?? pool[0]!;

  const heard = new Set(recent);
  const indices = speaker.lines.map((_, i) => i);
  const unheard = indices.filter((i) => !heard.has(barkKey(speaker.templateId, i)));
  const choices = unheard.length > 0 ? unheard : indices;
  const index = choices[Math.floor(rng() * choices.length)] ?? choices[0]!;

  return {
    instanceId: speaker.instanceId,
    name: speaker.name,
    text: speaker.lines[index]!,
    key: barkKey(speaker.templateId, index),
  };
}

/** Push a key onto the newest-first memory, trimmed to {@link BARK_MEMORY}. */
export function rememberBark(recent: readonly string[], key: string): string[] {
  return [key, ...recent.filter((k) => k !== key)].slice(0, BARK_MEMORY);
}

/* ---------------------------------------------------------------------------------------
 * The director: the one bubble, and when it is on screen.
 * ------------------------------------------------------------------------------------- */

export interface BarkDirectorOptions {
  /**
   * Everyone who could speak right now. Asked at the moment a bark is due rather than held,
   * because the roster changes under this module every turn and a cached speaker is a bubble
   * over a portrait that is no longer on the map.
   */
  readonly speakers: () => readonly BarkSpeaker[];
  /**
   * That minion's portrait on the map, or `null` when it is not drawn right now. The bubble is
   * hung on the portrait's own parent, so this is also how the director survives the map being
   * rebuilt underneath it mid-bark: it simply asks again.
   */
  readonly portraitFor: (instanceId: string) => HTMLElement | null;
  /** Whether the map is the thing the player is looking at. See rule 2 in the module header. */
  readonly enabled: () => boolean;
  /**
   * The box the bubble must stay inside — the map plot. A bubble over a pin near the edge would
   * otherwise be sheared off by the panel's `overflow: hidden`.
   */
  readonly bounds?: () => HTMLElement | null;
  readonly rng?: BarkRng;
}

export interface BarkDirector {
  /** One frame of the shell's loop. `timeSeconds` need only be monotonic. */
  frame(timeSeconds: number): void;
  /** Take any bubble down now — a run ending, the game screen closing, the toggle going off. */
  clear(): void;
}

/** The class the speaking portrait wears, so the player can see *which* of a crew said it. */
const SPEAKING_CLASS = "map-callout__portrait--speaking";

export function createBarkDirector(opts: BarkDirectorOptions): BarkDirector {
  const rng = opts.rng ?? Math.random;

  const bubble = document.createElement("div");
  bubble.className = "map-bark";
  /* Flavour, and flavour that appears and vanishes on its own: to a screen reader this is noise
   * interrupting whatever it was reading. Inert to the pointer for the same reason the callout
   * stack is — nothing under it should become unclickable because someone made a joke. */
  bubble.setAttribute("aria-hidden", "true");
  const quote = document.createElement("span");
  quote.className = "map-bark__text";
  bubble.appendChild(quote);
  const caption = document.createElement("span");
  caption.className = "map-bark__name";
  bubble.appendChild(caption);

  let recent: string[] = [];
  let lastSpeakerId: string | null = null;
  /** The bark on screen, or `null` while the map is quiet. */
  let current: Bark | null = null;
  /** The portrait the bubble is currently hung on, so the speaking class can be taken back off. */
  let portrait: HTMLElement | null = null;
  let holdUntil = 0;
  let fadeUntil = 0;
  /** `null` until the first frame — the schedule starts from when the map opened, not from 0. */
  let nextAt: number | null = null;

  function detach(): void {
    portrait?.classList.remove(SPEAKING_CLASS);
    portrait = null;
    bubble.classList.remove("map-bark--leaving");
    bubble.remove();
    current = null;
  }

  function clear(): void {
    detach();
    /* The schedule is left alone on purpose. `clear` is called for a cover going up over the map,
     * and `frame` pushes the next bark out past the grace period every time it finds itself
     * blocked, so there is nothing to reset here. */
  }

  /**
   * Hang the bubble over `bark`'s portrait, or report that there is nowhere to hang it.
   *
   * Placement is two layout reads, once per bark rather than once per frame: where the portrait
   * sits inside its callout (a crew of three shares one box, so the tail has to find the right
   * face), and whether the finished bubble fits inside the plot. Everything after that is CSS.
   */
  function attach(bark: Bark): boolean {
    const face = opts.portraitFor(bark.instanceId);
    const host = face?.parentElement ?? null;
    if (face === null || host === null) {
      return false;
    }
    quote.textContent = bark.text;
    caption.textContent = bark.name;
    bubble.style.removeProperty("--bark-nudge");
    bubble.style.setProperty("--bark-x", `${face.offsetLeft + face.offsetWidth / 2}px`);
    host.appendChild(bubble);
    face.classList.add(SPEAKING_CLASS);
    portrait = face;

    /* Pull the bubble back inside the plot when the pin it belongs to is near an edge. The map
     * panel clips, and half a sentence disappearing into the frame reads as a bug rather than as
     * a bubble that ran out of room. */
    const limit = opts.bounds?.() ?? null;
    if (limit !== null) {
      const box = bubble.getBoundingClientRect();
      const edge = limit.getBoundingClientRect();
      const over = Math.max(0, box.right - edge.right) - Math.max(0, edge.left - box.left);
      if (over !== 0) {
        bubble.style.setProperty("--bark-nudge", `${-over}px`);
      }
    }
    return true;
  }

  return {
    frame(timeSeconds) {
      if (nextAt === null) {
        /* First frame of a run: start the clock here rather than at zero, so the opening bark
         * lands a gap after the map appears instead of instantly. */
        nextAt = timeSeconds + nextBarkGapSeconds(rng);
        return;
      }

      if (!opts.enabled()) {
        if (current !== null) {
          detach();
        }
        nextAt = Math.max(nextAt, timeSeconds + BARK_RESUME_GRACE_SECONDS);
        return;
      }

      if (current !== null) {
        /* The map is rebuilt from scratch on every state change, which takes the bubble with it.
         * Asking for the portrait again is cheaper than being told about the rebuild, and it is
         * also the check for a speaker who has left the map entirely — staged onto a mission,
         * fired, or sent somewhere the pin is no longer drawn. */
        if (!bubble.isConnected && !attach(current)) {
          detach();
          nextAt = timeSeconds + nextBarkGapSeconds(rng);
          return;
        }
        if (timeSeconds >= fadeUntil) {
          detach();
          nextAt = timeSeconds + nextBarkGapSeconds(rng);
        } else if (timeSeconds >= holdUntil) {
          bubble.classList.add("map-bark--leaving");
        }
        return;
      }

      if (timeSeconds < nextAt) {
        return;
      }

      const bark = pickBark(opts.speakers(), recent, lastSpeakerId, rng);
      if (bark === null || !attach(bark)) {
        /* Nobody to speak, or nobody drawn to speak from. Try again on the usual schedule rather
         * than on the next frame: a roster of one that is off the map should not have this
         * function picking and discarding a bark sixty times a second. */
        nextAt = timeSeconds + nextBarkGapSeconds(rng);
        return;
      }
      current = bark;
      recent = rememberBark(recent, bark.key);
      lastSpeakerId = bark.instanceId;
      holdUntil = timeSeconds + BARK_HOLD_SECONDS;
      fadeUntil = holdUntil + BARK_FADE_SECONDS;
    },
    clear,
  };
}
