/**
 * The `unlockedByDefault` row, shared by the three slices the title screen picks from.
 *
 * One helper rather than three copies because the flag means exactly the same thing in each —
 * "a player who has unlocked nothing can still pick this" — and a designer reading the Lairs
 * form and then the Omega Plans form should not have to work out whether the wording is hiding
 * a difference. See `src/game/progression.ts` for what reads it.
 */

import type { FormCtx } from "./context";
import { bool, checkboxInput, formRow, hint, type Row } from "../widgets";

/** How many rows of this slice currently carry the flag — what the hint reports back. */
function defaultUnlockedCount(ctx: FormCtx): number {
  const rows = ctx.draft[ctx.slice];
  if (!Array.isArray(rows)) {
    return 0;
  }
  return rows.filter((r) => bool(r as Row, "unlockedByDefault")).length;
}

/**
 * Appends the checkbox and the note under it. `noun` is the singular this slice's rows are
 * called in the hint ("lair", "omega plan", "mastermind").
 */
export function unlockedByDefaultRow(container: HTMLElement, ctx: FormCtx, noun: string): void {
  const on = bool(ctx.row, "unlockedByDefault");
  container.appendChild(
    formRow(
      "unlockedByDefault",
      checkboxInput(on, (v) =>
        ctx.update((row) => {
          /* Written only when true: absent is the default everywhere that reads it, and a file
           * full of `"unlockedByDefault": false` says less than one where the starting set is
           * the only thing spelled out. */
          if (v) {
            row.unlockedByDefault = true;
          } else {
            delete row.unlockedByDefault;
          }
        }),
      ),
    ),
  );
  const count = defaultUnlockedCount(ctx);
  container.appendChild(
    hint(
      `On ⇒ this ${noun} is in a brand-new player's deck at the title screen. Off ⇒ it shows there locked until the player unlocks it (or turns on Unlock All Content in Settings). ${count} ${ctx.slice} row${count === 1 ? " is" : "s are"} currently unlocked by default — content validation fails if that reaches zero, since the slot would be unfillable.`,
    ),
  );
}
