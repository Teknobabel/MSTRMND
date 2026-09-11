/**
 * Stable rows: keeps a row of cards from reshuffling under the player while they are using it.
 *
 * The Minions drawer's rows are rebuilt from game state on every refresh — cards in state order,
 * then one empty slot per unfilled place — so hiring the first offer would slide every other
 * offer a place to the left. While the drawer is open, `main.ts` lays each row out against the
 * one it last drew instead: whatever is still there stays where it stood, and the row is only
 * put back in order once the drawer has gone down or the turn has moved on.
 */

/** A row as drawn: each place holds a card's key, or `null` for an empty slot. */
export type RowSlots = readonly (string | null)[];

/** The row in its natural order: the cards as given, then the empty slots. */
export function freshRow(keys: readonly string[], emptyCount: number): RowSlots {
  return [...keys, ...Array.from({ length: Math.max(0, emptyCount) }, () => null)];
}

/**
 * The row laid out against `prev`, the one last drawn. A card that has left turns into an empty
 * slot where it stood; a card that has arrived takes the leftmost empty slot, or the end of the
 * row when there is none. The number of empty slots is then brought to `emptyCount` at the right
 * — added at the end, or taken from the rightmost first — so the cards to their left never move.
 */
export function stableRow(
  prev: RowSlots,
  keys: readonly string[],
  emptyCount: number,
): RowSlots {
  const live = new Set(keys);
  const slots = prev.map((key) => (key !== null && live.has(key) ? key : null));

  const placed = new Set(slots);
  for (const key of keys) {
    if (placed.has(key)) {
      continue;
    }
    const hole = slots.indexOf(null);
    if (hole >= 0) {
      slots[hole] = key;
    } else {
      slots.push(key);
    }
  }

  const wanted = Math.max(0, emptyCount);
  let empties = slots.filter((key) => key === null).length;
  for (; empties < wanted; empties += 1) {
    slots.push(null);
  }
  for (let i = slots.length - 1; i >= 0 && empties > wanted; i -= 1) {
    if (slots[i] === null) {
      slots.splice(i, 1);
      empties -= 1;
    }
  }
  return slots;
}
